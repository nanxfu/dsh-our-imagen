/**
 * KaggleProvider：把 `lib/session.js` 里原本直接调用的 Kaggle 动作收进一个实现。
 *
 * 这一版的定位是**等价重构**：申请实例的时序、失败码、日志文案、临时目录清理时机
 * 都保持原样，只是调用点从状态机搬到这里。行为差异应当为零——`test/session-*.mjs`
 * 一行不改就能全绿，是这次改造的验收标准。
 *
 * 与状态机的边界：
 *  - provider 只做 I/O 与协议，不改会话状态；进度通过 `onProgress` 回传，失败抛
 *    `ProviderError`，由 SessionManager 决定写什么状态；
 *  - 会合（ntfy）与 Kernel 状态轮询仍由 `lib/session/tunnel-watcher.js` /
 *    `health-monitor.js` 承担，但入口收敛到本类，SessionManager 不再直接接触 ntfy；
 *  - 定时器一律由 SessionManager 的 `every()` 驱动，本类不自建 interval（见 provider.js 第 1 条）。
 */

import { TIMEOUTS } from '../../shared/contract.js'
import { randomSlug } from '../kernel.js'
import { logText } from '../redact.js'
import { isTrustedEndpoint } from '../remote.js'
import { isKernelEnded } from '../session/health.js'
import { checkKernelStatus } from '../session/health-monitor.js'
import {
  PENDING_CLEANUP_MAX_ATTEMPTS,
  clearPendingCleanup,
  isPendingCleanupExpired,
  writePendingCleanup,
} from '../session/pending-cleanup.js'
import { pollTunnel } from '../session/tunnel-watcher.js'
import { buildPendingCleanupRecord } from '../session/pending-cleanup.js'
import { ProviderError } from './provider.js'

export class KaggleProvider {
  /**
   * @param {object} input
   * @param {object} input.ctx 插件上下文（传给 kaggle 客户端）
   * @param {object} input.deps 现有依赖注入表（沿用原键名，测试零改动）
   * @param {object} input.log 日志器
   * @param {object} [input.manager] SessionManager（补清理与关机需要复用其状态与落盘）
   */
  constructor({ ctx, deps, log, manager = null }) {
    this.id = 'kaggle'
    this.ctx = ctx
    this.deps = deps
    this.log = log
    this.manager = manager
    // 单次 /job 轮询的超时：Kaggle 隧道下行快，沿用契约默认值。
    this.jobRequestTimeoutMs = TIMEOUTS.remoteJobRequestMs
  }

  /* ------------------------------------------------------------ 基础能力 */

  async username() {
    return this.deps.kaggleUsername(this.ctx)
  }

  async buildFolder(input) {
    return this.deps.buildKernelFolder(input)
  }

  async push(folderDir, { accelerator, timeoutSec }) {
    return this.deps.pushKernel(this.ctx, folderDir, { accelerator, timeoutSec })
  }

  /** Kernel 状态查询；未注入时返回 null（离线测试允许省略）。 */
  async status(kernelId) {
    if (typeof this.deps.kernelStatus !== 'function' || !kernelId) return null
    return this.deps.kernelStatus(this.ctx, kernelId)
  }

  /** Kernel 日志尾；未注入时返回 null。 */
  async logs(kernelId) {
    if (typeof this.deps.kernelLogs !== 'function' || !kernelId) return null
    return this.deps.kernelLogs(this.ctx, kernelId)
  }

  /** 删除 Kernel；未注入时直接跳过（与原 `discardStaleKernel` 的口径一致）。 */
  async deleteKernel(kernelId) {
    if (typeof this.deps.deleteKernel !== 'function' || !kernelId) return false
    return this.deps.deleteKernel(this.ctx, kernelId)
  }

  async removeFolder(dir) {
    if (!dir) return
    await this.deps.removeKernelFolder(dir)
  }

  /** 向 daemon 发 best-effort 关机通知（地址必须已通过可信校验）。 */
  async shutdownEndpoint(endpoint, token) {
    if (!endpoint || !token) return false
    return this.deps.requestShutdown(endpoint, token, TIMEOUTS.remoteShutdownMs, this.ctx)
  }

  /* -------------------------------------------------------- 契约方法 */

  /**
   * 申请 Kernel 并把 `remote/` 推送上去。
   *
   * 与原 `SessionManager.provision` 的 Kaggle 段一一对应：用户名 → 构建目录 → push →
   * 进入排队。任何失败都不留含 token 的临时目录；作废（换代）抛 `stale`，由状态机
   * 决定是否顺带删除远端 Kernel。
   *
   * @param {{ isCurrent: () => boolean, log: object }} run
   * @param {object} options
   * @returns {Promise<object>} 可序列化 handle
   */
  async provision(run, options) {
    const {
      daemonConfig,
      datasetSources = [],
      enableGpu = true,
      accelerator = null,
      timeoutSec,
      sourcePath,
      onProgress = () => {},
    } = options

    let folder = null
    try {
      let username
      try {
        username = await this.username()
      } catch (error) {
        throw new ProviderError('auth_required', `读取 Kaggle 用户名失败：${error?.message ?? error}`)
      }
      if (!run.isCurrent()) throw new ProviderError('stale', '启动流程已作废')

      try {
        folder = await this.buildFolder({
          username,
          slug: randomSlug(),
          sourcePath: sourcePath ?? undefined,
          enableGpu,
          datasetSources,
          config: daemonConfig,
        })
      } catch (error) {
        throw new ProviderError('push_failed', `构建 Kernel 目录失败：${error?.message ?? error}`)
      }
      if (!run.isCurrent()) throw new ProviderError('stale', '启动流程已作废', { kernelId: folder?.kernelId ?? null })

      // 推送前先落盘：push 成功后 Host 崩溃/重载，也能凭 kernelId + topic 找回会话。
      onProgress({
        phase: 'push',
        detail: '正在推送 Kernel',
        kernelId: folder?.kernelId,
        kernelUrl: folder?.kernelUrl,
        folderDir: folder?.dir ?? null,
        persist: true,
      })

      let pushed
      try {
        pushed = await this.push(folder.dir, { accelerator, timeoutSec })
      } catch (error) {
        throw new ProviderError('push_failed', `Kernel 推送异常：${error?.message ?? error}`, {
          kernelId: folder?.kernelId ?? null,
        })
      }
      if (!run.isCurrent()) throw new ProviderError('stale', '启动流程已作废', { kernelId: folder?.kernelId ?? null })

      if (!pushed?.ok) {
        const logs = await this.logs(folder?.kernelId).catch((error) => {
          this.log.debug('拉取 Kernel 日志失败（只影响失败原因文案）', logText(error?.message ?? error, 200))
          return null
        })
        const reason = [pushed?.output, logs?.tail].filter(Boolean).join('\n').slice(-600)
        throw new ProviderError(
          pushed?.authFailed ? 'auth_required' : 'push_failed',
          `Kernel 推送失败：${reason || '未知原因'}`,
          { logsTail: logs?.tail, kernelId: folder?.kernelId ?? null },
        )
      }

      onProgress({
        phase: 'queue',
        kernelStatus: 'PENDING',
        detail: '已推送，等待 GPU 排队',
        persist: true,
      })

      return {
        kind: 'kaggle',
        kernelId: folder?.kernelId ?? null,
        kernelUrl: folder?.kernelUrl ?? null,
        folderDir: folder?.dir ?? null,
      }
    } catch (error) {
      // 临时目录里的 daemon.py 含本次会话 token，任何失败都不能留在 %TEMP%。
      if (folder?.dir) {
        await this.removeFolder(folder.dir).catch((removeError) => {
          this.log.warn(
            '临时 Kernel 目录清理失败（目录内 daemon.py 含 token）',
            logText(removeError?.message ?? removeError, 200),
          )
        })
      }
      throw error
    }
  }

  /**
   * 单拍会合：ntfy 轮询仍由 tunnel-watcher 实现，但对状态机只暴露「一拍」。
   * 未就绪返回 null，由 `SessionManager.every()` 决定下一拍。
   */
  async pollEndpoint(run) {
    await pollTunnel(run)
    return run.session.endpointUrl ? { endpointUrl: run.session.endpointUrl } : null
  }

  /** 单拍状态探测：具体收敛（判死/续期）仍由 health-monitor 执行。 */
  async checkAlive(run) {
    await checkKernelStatus(run)
    return {
      alive: Boolean(run.session.kernelId) && !isKernelEnded(run.session.kernelStatus),
      status: run.session.kernelStatus ?? null,
    }
  }

  /** Kaggle 没有额外保活动作：Kernel 常驻本身就是保活。 */
  async keepAlive() {
    return { ok: true, detail: 'kaggle: noop' }
  }

  /**
   * 释放：关机通知 / 删除 Kernel / 清理临时目录，全部幂等。
   *
   * 调用方（SessionManager.stop）已经把「用内存还是用记录里的地址」决定好，
   * 这里只执行动作。
   */
  async teardown(run, handle = {}, { deleteKernel = false, removeFolder = true } = {}) {
    const endpoint = handle.endpointUrl ?? run?.session?.endpointUrl
    const token = handle.token ?? run?.secret?.token
    let ok = true
    if (endpoint && token) {
      try {
        ok = Boolean(await this.shutdownEndpoint(endpoint, token))
      } catch (error) {
        this.log.debug('关机通知失败（忽略）', logText(error?.message ?? error, 200))
        ok = false
      }
    }
    if (removeFolder && handle.folderDir) {
      await this.removeFolder(handle.folderDir).catch((error) => {
        this.log.warn('丢弃临时 Kernel 目录失败（目录内含 token）', logText(error?.message ?? error, 200))
      })
    }
    if (deleteKernel && handle.kernelId) {
      void this.deleteKernel(handle.kernelId).catch(() => false)
    }
    return { ok }
  }

  /**
   * 启动补清理：补发上次卸载失败的关机通知。
   *
   * 记录有效性由 provider 自己判断（TTL / 尝试次数 / 隧道域名可信），
   * 公共层不再把 `endpointUrl` 当作唯一准入门槛——Colab 的补清理只需要 endpoint。
   */
  async cleanupPending(record) {
    const mgr = this.manager
    if (!record) return null

    if (isPendingCleanupExpired(record)) {
      mgr.log.warn(`pending_cleanup_discard reason=expired kernelId=${record.kernelId ?? 'none'}`)
      await clearPendingCleanup(mgr.ctx)
      return false
    }
    if (record.attempts >= PENDING_CLEANUP_MAX_ATTEMPTS) {
      mgr.log.warn(
        `pending_cleanup_discard reason=max_attempts attempts=${record.attempts} kernelId=${record.kernelId ?? 'none'}`,
      )
      await clearPendingCleanup(mgr.ctx)
      return false
    }
    // 待清理记录来自本地文件：地址不可信时不发 token（防止记录被篡改后泄露凭据）。
    if (!isTrustedEndpoint(record.endpointUrl, mgr.options.trustedTunnelDomains)) {
      mgr.log.warn(`pending_cleanup_discard reason=untrusted_endpoint kernelId=${record.kernelId ?? 'none'}`)
      await clearPendingCleanup(mgr.ctx)
      return false
    }

    let ok = false
    try {
      ok = Boolean(await this.shutdownEndpoint(record.endpointUrl, record.token))
    } catch (error) {
      // best-effort：补发失败只累加次数，不影响插件加载。
      mgr.log.debug('补发关机通知异常（忽略）', logText(error?.message ?? error, 200))
      ok = false
    }

    const attempts = record.attempts + 1
    if (ok) {
      mgr.log.info(`pending_cleanup_done kernelId=${record.kernelId ?? 'none'} attempts=${attempts}`)
      await clearPendingCleanup(mgr.ctx)
      // 远端已确认退出：磁盘上若还残留会话记录也一并清掉，避免 restore() 再接手。
      await mgr.clearPersistedSession()
      return true
    }

    if (attempts >= PENDING_CLEANUP_MAX_ATTEMPTS) {
      mgr.log.warn(`pending_cleanup_discard reason=max_attempts attempts=${attempts} kernelId=${record.kernelId ?? 'none'}`)
      await clearPendingCleanup(mgr.ctx)
      return false
    }

    mgr.log.warn(`pending_cleanup_retry attempts=${attempts}/${PENDING_CLEANUP_MAX_ATTEMPTS} kernelId=${record.kernelId ?? 'none'}`)
    try {
      await writePendingCleanup(mgr.ctx, { ...record, attempts })
    } catch (error) {
      mgr.log.debug('写入待清理记录失败（忽略）', logText(error?.message ?? error, 200))
    }
    return false
  }

  /** 卸载时落盘的补清理记录（Kaggle 形态：endpointUrl + token）。 */
  buildPendingCleanupRecord(session = {}, secret = {}) {
    return buildPendingCleanupRecord(session, secret)
  }

  /** 日志尾（可选能力）：供诊断与失败现场抢救。 */
  async readLogs(run, handle = {}) {
    const logs = await this.logs(handle.kernelId ?? run?.session?.kernelId)
    return logs?.tail ?? null
  }
}
