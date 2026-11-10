/**
 * 会话启动编排（一次性的 push → 排队流程）。
 *
 * 边界：只做「读 Kaggle 用户名 → 构建 Kernel 目录 → push → 失败清理」这条流水线；
 * 状态写入、定时器、对外快照都交给传入的 host（SessionManager），epoch 校验统一走
 * `host.isStale()`，本模块不复制代次逻辑。
 */

import { randomBytes } from 'node:crypto'

import { VERSION, daemonContract } from '../../shared/contract.js'
import { kaggleUsername, kernelLogs, pushKernel } from '../kaggle.js'
import { buildKernelFolder, randomSlug, removeKernelFolder } from '../kernel.js'
import { presetById } from '../presets.js'
import { emptySession, isoNow } from './state.js'

/**
 * 下发给远端 daemon 的注入配置（键见 shared/contract.js 的 PROTOCOL.daemon.configKeys）。
 * 纯函数，便于离线断言版本 / 契约 / 预设展开是否正确。
 */
export function buildKernelConfig({ presetId, token, topic, idleTimeoutSec }) {
  return {
    auth_token: token,
    ntfy_topic: topic,
    idle_timeout_sec: idleTimeoutSec,
    // daemon 只认完整 pipeline 描述；传预设 id 它无法加载（字段见 remote/daemon.py 顶部说明）。
    preload: presetById(presetId).pipeline,
    preset_id: presetId,
    log_level: 'info',
    // 版本与协议契约同源（shared/contract.js）：daemon 侧按 config.contract 校验参数边界。
    version: VERSION,
    contract: daemonContract(),
  }
}

/**
 * 跑一次启动流程；返回快照。任何异常都在内部收敛为可重试的 error 状态。
 *
 * @param {object} host SessionManager 实例（只使用其公开字段与方法）
 * @param {string} presetId 预设 id
 * @param {number} epoch 本次启动的代次
 */
export async function runProvision(host, presetId, epoch) {
  let folderDir = null
  try {
    host.clearTimers()
    host.healthMisses = 0
    host.reconnectAttempts = 0
    host.livenessCheck = null
    host.recoveringFromReady = false
    host.recoveryStartedAt = 0
    host.session = emptySession(host.options)
    host.session.presetId = presetId
    host.session.state = 'provisioning'
    host.session.phase = 'push'
    host.session.detail = '正在准备 Kernel 目录'
    host.session.startedAt = isoNow()

    if (host.options.devEndpoint) {
      host.secret = { token: host.options.devToken ?? '', topic: null }
      host.session.endpointUrl = host.options.devEndpoint
      host.session.state = 'ready'
      host.session.phase = null
      host.session.readyAt = isoNow()
      host.session.detail = '开发模式：直连本地 Daemon'
      host.session.modelId = 'local-mock'
      return host.snapshot()
    }

    const token = randomBytes(24).toString('hex')
    const topic = `imagen-${randomBytes(8).toString('hex')}`
    host.secret = { token, topic }

    let username
    try {
      username = await host.deps.kaggleUsername(host.ctx)
    } catch (error) {
      if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)
      return host.fail('auth_required', `读取 Kaggle 用户名失败：${error?.message ?? error}`)
    }
    if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)

    let folder
    try {
      folder = await host.deps.buildKernelFolder({
        username,
        slug: randomSlug(),
        sourcePath: host.options.sourcePath ?? undefined,
        enableGpu: host.options.enableGpu !== false,
        config: buildKernelConfig({
          presetId,
          token,
          topic,
          idleTimeoutSec: host.options.idleTimeoutSec,
        }),
      })
    } catch (error) {
      if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)
      return host.fail('push_failed', `构建 Kernel 目录失败：${error?.message ?? error}`)
    }
    folderDir = folder?.dir ?? null
    if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)

    host.kernelFolder = folder.dir
    host.session.kernelId = folder.kernelId
    host.session.kernelUrl = folder.kernelUrl
    host.session.detail = '正在推送 Kernel'

    let pushed
    try {
      pushed = await host.deps.pushKernel(host.ctx, folder.dir, {
        accelerator: host.options.enableGpu === false ? null : host.options.accelerator,
        timeoutSec: host.options.kernelTimeoutSec,
      })
    } catch (error) {
      if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)
      await disposeKernelFolder(host)
      return host.fail('push_failed', `Kernel 推送异常：${error?.message ?? error}`)
    }
    if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)

    if (!pushed.ok) {
      const code = pushed.authFailed ? 'auth_required' : 'push_failed'
      const logs = await host.deps.kernelLogs(host.ctx, folder.kernelId).catch((error) => {
        host.log.debug('拉取 Kernel 日志失败（只影响失败原因文案）', error?.message ?? error)
        return null
      })
      if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)
      const reason = [pushed.output, logs?.tail].filter(Boolean).join('\n').slice(-600)
      // 临时目录里的 daemon.py 含本次会话 token，push 失败后不能留在 %TEMP%。
      await disposeKernelFolder(host)
      return host.fail(code, `Kernel 推送失败：${reason || '未知原因'}`)
    }

    host.session.kernelStatus = 'PENDING'
    host.session.phase = 'queue'
    host.session.detail = '已推送，等待 GPU 排队'
    host.watch()
    return host.snapshot()
  } catch (error) {
    // 兜底：任何未预期的异常都必须收敛为可重试的 error 状态并清理临时目录，
    // 绝不能让会话停在 provisioning（那时没有定时器，start() 又会直接命中 ACTIVE_STATES）。
    if (host.isStale(epoch)) return cleanupAbandonedStart(host, folderDir)
    if (folderDir && host.kernelFolder === folderDir) host.kernelFolder = null
    if (folderDir) {
      await host.deps.removeKernelFolder(folderDir).catch((error) => {
        host.log.warn('临时 Kernel 目录清理失败（目录内 daemon.py 含 token）', error?.message ?? error)
      })
    }
    return host.fail('push_failed', `启动会话失败：${error?.message ?? error}`)
  }
}

/**
 * 作废的启动流程只做清理：删掉本次的临时 Kernel 目录（内含 token），
 * 不写任何会话状态、不挂定时器，返回当前（可能已是新一轮/已关机）的快照。
 */
export async function cleanupAbandonedStart(host, folderDir) {
  if (folderDir && host.kernelFolder === folderDir) host.kernelFolder = null
  if (folderDir) {
    await host.deps.removeKernelFolder(folderDir).catch((error) => {
      host.log.warn('临时 Kernel 目录清理失败（目录内 daemon.py 含 token）', error?.message ?? error)
    })
  }
  return host.snapshot()
}

/**
 * 丢弃本次会话的临时 Kernel 目录（目录内的 daemon.py 含 token）。
 * push 失败与 stop 都必须清理，避免 token 长期留在系统临时目录。
 */
export async function disposeKernelFolder(host) {
  const dir = host.kernelFolder
  host.kernelFolder = null
  if (!dir) return
  try {
    await host.deps.removeKernelFolder(dir)
  } catch (error) {
    // 清理失败不影响会话状态（临时目录最终由系统回收），但目录内含 token，需留痕。
    host.log.warn('丢弃临时 Kernel 目录失败（目录内含 token）', error?.message ?? error)
  }
}