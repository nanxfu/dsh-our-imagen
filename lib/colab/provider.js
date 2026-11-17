/**
 * ColabProvider：把 Colab（Pro）接成第二个 ComputeProvider。
 *
 * 与 Kaggle 的差异（M0 实测结论，见 docs/COLAB_BACKEND_RESEARCH.md §6）：
 *  - 申请实例是 `assign(accelerator)`，几秒就绪，没有排队；释放是 `unassign`；
 *  - 没有 ntfy：daemon 把 ready 地址写进 `/content/.imagen_endpoint.json`，
 *    Host 经 Jupyter Contents API 读取；
 *  - 必须靠 Kernel WebSocket 心跳保活（30s），另有 60s TFE ping 与约 20min 的
 *    代理令牌刷新；这些节流与防重入都在本类内部完成，定时器仍由 SessionManager 驱动；
 *  - 单卡设备、工作目录 `/content`、无 `/kaggle/working`。
 *
 * 契约见 `lib/providers/provider.js`：`pollEndpoint` 单拍非阻塞；`run.signal` abort 或
 * `teardown()` 时立即关闭 WS 并释放实例。
 */

import { buildRemoteLauncher } from '../kernel.js'
import {
  PENDING_CLEANUP_MAX_ATTEMPTS,
  clearPendingCleanup,
  isPendingCleanupExpired,
} from '../session/pending-cleanup.js'
import { ProviderError } from '../providers/provider.js'
import {
  KernelSocket,
  ProbeError,
  accessToken,
  assign,
  ccuInfo,
  createKernel,
  listAssignments,
  readFileText,
  tfeKeepAlive,
  unassign,
  uploadFile,
} from './client.js'

const BOOTSTRAP_PATH = '/content/imagen_bootstrap.py'
const ENDPOINT_FILE = '/content/.imagen_endpoint.json'
const DAEMON_LOG = '/content/imagen-daemon.log'
const BEAT_INTERVAL_MS = 30_000
const PING_INTERVAL_MS = 60_000
const TOKEN_REFRESH_MS = 20 * 60_000
const BEAT_CODE = "open('/content/.imagen_beat','w').write(str(__import__('time').time()))"

/** 启动器命令行：脱离 Kernel 会话常驻，输出落到文件，Host 可随时读回。 */
const START_DAEMON_CODE = `
import subprocess, sys
_log = open('${DAEMON_LOG}', 'w')
_proc = subprocess.Popen([sys.executable, '-u', '${BOOTSTRAP_PATH}'],
                         stdout=_log, stderr=subprocess.STDOUT, start_new_session=True)
print(_proc.pid)
`

export class ColabProvider {
  /**
   * @param {object} input
   * @param {object} input.ctx
   * @param {object} input.log
   * @param {object} [input.manager] SessionManager（补清理与落盘需要）
   * @param {object} [input.options] 复用 SessionManager 的 options（colabGpu / trustedTunnelDomains）
   */
  constructor({ ctx, log, manager = null, options = {} }) {
    this.id = 'colab'
    this.ctx = ctx
    this.log = log
    this.manager = manager
    this.options = options
    this.sessions = new Map()
    this.lastHandle = null
    this.keepAliveInFlight = null
    this.lastBeatAt = 0
    this.lastPingAt = 0
    this.lastRefreshAt = 0
    this.authHint = 'Colab 尚未授权：请在指引卡或设置抽屉里点击「登录 Google / Colab」完成授权'
    // M0 实测：1.4MB 结果经 Cloudflare 隧道约 13s，默认 8s 轮询必然超时。
    this.jobRequestTimeoutMs = 30_000
  }

  /* ------------------------------------------------------------ 内部工具 */

  /** 把 token / assignment 归一成 client 需要的形状；令牌可能已被刷新。 */
  #assignmentOf(handle) {
    return {
      endpoint: handle.assignmentEndpoint,
      accelerator: handle.accelerator,
      runtimeProxyInfo: {
        url: handle.proxyUrl,
        token: handle.proxyToken,
        tokenExpiresInSeconds: handle.proxyTokenExpiresInSeconds,
      },
    }
  }

  async #token() {
    try {
      return await accessToken({ log: this.log })
    } catch (error) {
      throw new ProviderError('auth_required', this.authHint, { cause: error })
    }
  }

  /** 代理令牌约 1 小时过期：临近过期时重新拉一次 assignments。 */
  async #refreshProxyIfNeeded(handle, { force = false } = {}) {
    const now = Date.now()
    if (!force && handle.proxyTokenExpiresAt && handle.proxyTokenExpiresAt - now > 5 * 60_000) return false
    const list = await listAssignments(await this.#token())
    const hit = list.find((item) => item.endpoint === handle.assignmentEndpoint)
    if (!hit) throw new ProviderError('session_ended', 'Colab 实例已不在 assignments 列表中（可能已被回收）')
    handle.proxyUrl = hit.runtimeProxyInfo?.url || handle.proxyUrl
    handle.proxyToken = hit.runtimeProxyInfo?.token || handle.proxyToken
    handle.proxyTokenExpiresInSeconds = hit.runtimeProxyInfo?.tokenExpiresInSeconds
    handle.proxyTokenExpiresAt = Date.now() + Number(hit.runtimeProxyInfo?.tokenExpiresInSeconds ?? 3600) * 1000
    this.lastRefreshAt = Date.now()
    this.log.info(`colab_proxy_token_refreshed ttl=${handle.proxyTokenExpiresInSeconds}s`)
    return true
  }

  #sessionOf(handle) {
    return handle?.assignmentEndpoint ? this.sessions.get(handle.assignmentEndpoint) : null
  }

  /** 一次 WS 心跳；连接已断则重连（Kernel 仍在时不必重建）。 */
  async #beat(handle, { signal = null } = {}) {
    const session = this.#sessionOf(handle)
    if (!session) throw new ProviderError('session_ended', 'Colab 会话已释放')
    if (session.socket.closed) {
      await this.#refreshProxyIfNeeded(handle)
      session.socket = new KernelSocket(this.#assignmentOf(handle), handle.kernelId, { log: this.log })
      await session.socket.connect({ retries: 2, signal })
    }
    await session.socket.execute(BEAT_CODE, { timeoutMs: 25000 })
    this.lastBeatAt = Date.now()
    return true
  }

  /* -------------------------------------------------------- 契约方法 */

  async provision(run, options) {
    const { daemonConfig, onProgress = () => {}, colabGpu = null, colabHighRam = false } = options
    // 注意：不能复用 Kaggle 的 accelerator（NvidiaTeslaT4 之类），Colab 只认 T4/L4/A100。
    // 优先用本次会话读到的实时设置，构造时的 options 只作兜底。
    const gpu = String(colabGpu || this.options.colabGpu || 'L4').toUpperCase()
    const token = await this.#token()

    onProgress({ phase: 'push', detail: `正在申请 Colab ${gpu} 实例`, persist: false })
    let assignment
    try {
      assignment = await assign({
        token,
        accelerator: gpu,
        highRam: Boolean(colabHighRam),
        log: this.log,
        signal: run.signal,
      })
    } catch (error) {
      if (error instanceof ProbeError && error.status === 400) {
        throw new ProviderError('gpu_unavailable', `账号没有 ${gpu} 的配额或权益：先换一档 GPU 再试`)
      }
      throw new ProviderError('push_failed', `申请 Colab 实例失败：${error?.message ?? error}`, { cause: error })
    }

    const handle = {
      kind: 'colab',
      assignmentEndpoint: assignment.endpoint,
      accelerator: gpu,
      machineShape: assignment.machineShape ?? null,
      proxyUrl: assignment.runtimeProxyInfo?.url,
      proxyToken: assignment.runtimeProxyInfo?.token,
      proxyTokenExpiresInSeconds: assignment.runtimeProxyInfo?.tokenExpiresInSeconds,
      proxyTokenExpiresAt: Date.now() + Number(assignment.runtimeProxyInfo?.tokenExpiresInSeconds ?? 3600) * 1000,
      kernelId: null,
      endpointUrl: null,
    }

    try {
      onProgress({ phase: 'push', detail: '实例就绪，正在上传远端代码', persist: false })
      const launcher = await buildRemoteLauncher({
        config: {
          ...daemonConfig,
          // Colab 没有 ntfy：改成把 ready 事件写到文件，Host 经 Contents 读取。
          ntfy_topic: '',
          work_dir: '/content',
          endpoint_file: ENDPOINT_FILE,
        },
      })
      await uploadFile(this.#assignmentOf(handle), BOOTSTRAP_PATH, launcher, { signal: run.signal })

      onProgress({ phase: 'queue', detail: '代码已上传，正在启动远端 daemon', persist: false })
      handle.kernelId = await createKernel(this.#assignmentOf(handle))
      onProgress({ phase: 'queue', kernelId: handle.kernelId, detail: '远端代码已启动，等待隧道地址', persist: false })
      const socket = new KernelSocket(this.#assignmentOf(handle), handle.kernelId, { log: this.log })
      await socket.connect({ signal: run.signal })
      await socket.execute(START_DAEMON_CODE, { timeoutMs: 90000 })
      this.sessions.set(handle.assignmentEndpoint, { socket, handle })
      this.lastHandle = handle
      onProgress({ phase: 'queue', detail: '远端 daemon 已启动，等待隧道地址', persist: false })
      return handle
    } catch (error) {
      // 启动半途失败：立刻释放实例，别让它空烧 CCU。
      await this.teardown(run, handle, { reason: 'provision_failed' }).catch(() => {})
      throw error instanceof ProviderError
        ? error
        : new ProviderError('push_failed', `启动 Colab 远端失败：${error?.message ?? error}`, { cause: error })
    }
  }

  /** 单拍：读 daemon 写下的 ready 文件；未就绪返回 null。 */
  async pollEndpoint(run, handle) {
    if (!handle?.assignmentEndpoint) return null
    await this.#refreshProxyIfNeeded(handle)
    // 启动慢（装依赖）时也要保活：借这一拍顺手补一次心跳，内部有 30s 节流。
    await this.#beatIfDue(handle).catch((error) => this.log.debug('colab_beat_skip', String(error?.message ?? error)))

    const text = await readFileText(this.#assignmentOf(handle), ENDPOINT_FILE).catch(() => null)
    if (!text) return null
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      return null
    }
    if (payload?.type === 'error') {
      throw new ProviderError(mapBootError(payload.code), String(payload.message || '远端启动失败').slice(0, 700))
    }
    if (!payload?.endpoint) return null
    handle.endpointUrl = payload.endpoint
    return { endpointUrl: payload.endpoint, channel: payload.provider ?? 'cloudflare' }
  }

  /** 单拍存活探测：实例是否仍在 assignments 中。 */
  async checkAlive(run, handle) {
    if (!handle?.assignmentEndpoint) return { alive: false, status: 'GONE' }
    const list = await listAssignments(await this.#token())
    if (!list.some((item) => item.endpoint === handle.assignmentEndpoint)) {
      return { alive: false, missing: true, status: 'GONE' }
    }
    await this.#beatIfDue(handle).catch(() => {})
    return { alive: true, status: 'RUNNING' }
  }

  /**
   * 保活：30s WS 心跳 / 60s TFE ping / 20min 令牌刷新。
   * 由 SessionManager 的 every() 高频调用（10s 一拍），这里按时间戳自节流并防重入。
   */
  keepAlive(run, handle) {
    if (!handle?.assignmentEndpoint) return Promise.resolve({ ok: false, detail: 'no-handle' })
    if (this.keepAliveInFlight) return this.keepAliveInFlight
    this.keepAliveInFlight = this.#doKeepAlive(handle)
      .catch((error) => {
        this.log.debug('colab_keepalive_failed', String(error?.message ?? error))
        return { ok: false, detail: String(error?.message ?? error) }
      })
      .finally(() => {
        this.keepAliveInFlight = null
      })
    return this.keepAliveInFlight
  }

  async #doKeepAlive(handle) {
    const now = Date.now()
    let usage = null
    if (now - this.lastRefreshAt > TOKEN_REFRESH_MS) {
      await this.#refreshProxyIfNeeded(handle, { force: true }).catch(() => false)
      // 顺带刷新账户余额：20 分钟一次，足够状态栏展示，也不至于频繁打 Google 接口。
      usage = await ccuInfo(await this.#token()).catch(() => null)
      handle.usage = usage
        ? { balance: usage.currentBalance, rate: usage.consumptionRateHourly, assignments: usage.assignmentsCount }
        : null
    }
    if (now - this.lastPingAt > PING_INTERVAL_MS) {
      this.lastPingAt = now
      await tfeKeepAlive({ token: await this.#token().catch(() => ''), endpoint: handle.assignmentEndpoint }).catch(() => null)
    }
    if (now - this.lastBeatAt > BEAT_INTERVAL_MS) await this.#beatIfDue(handle)
    return { ok: true, usage: handle.usage ?? null }
  }

  /** 30s 节流的心跳（pollEndpoint / checkAlive 也会调用，避免只为保活多开一拍）。 */
  async #beatIfDue(handle) {
    if (Date.now() - this.lastBeatAt < BEAT_INTERVAL_MS) return false
    return this.#beat(handle)
  }

  /** 释放：先断 WS 再 unassign；幂等，404/410 视为已释放。 */
  async teardown(run, handle = null, { reason = 'stop' } = {}) {
    const target = handle?.assignmentEndpoint ? handle : this.lastHandle
    const endpoint = target?.assignmentEndpoint
    const session = endpoint ? this.sessions.get(endpoint) : null
    if (session) {
      try {
        session.socket.close()
      } catch {}
      this.sessions.delete(endpoint)
    }
    if (!endpoint) return { ok: true, detail: 'no-assignment' }
    try {
      await unassign({ token: await this.#token(), endpoint, log: this.log })
    } catch (error) {
      const status = error instanceof ProbeError ? error.status : 0
      if (status === 404 || status === 410) {
        this.log.info(`colab_unassign_missing endpoint=${endpoint} reason=${reason}`)
      } else {
        this.log.warn(`colab_unassign_failed endpoint=${endpoint} reason=${reason} detail=${error?.message ?? error}`)
        return { ok: false, detail: String(error?.message ?? error) }
      }
    }
    if (this.lastHandle?.assignmentEndpoint === endpoint) this.lastHandle = null
    return { ok: true }
  }

  /** 落盘所需的补清理记录；没有 assignment 时返回 null（不写无意义记录）。 */
  buildPendingCleanupRecord(session = {}, secret = {}) {
    const handle = this.lastHandle
    if (!handle?.assignmentEndpoint) return null
    return {
      version: 2,
      provider: 'colab',
      savedAt: new Date().toISOString(),
      handle: { assignmentEndpoint: handle.assignmentEndpoint, kernelId: handle.kernelId },
      endpointUrl: session?.endpointUrl ?? null,
      kernelId: handle.kernelId ?? null,
      attempts: 0,
    }
  }

  /** 重启补清理：只凭记录释放实例（不需要 daemon token，也不要求 endpointUrl 已就绪）。 */
  async cleanupPending(record) {
    const mgr = this.manager
    if (!record || record.provider !== 'colab') return null
    const endpoint = record.handle?.assignmentEndpoint ?? record.assignmentEndpoint
    if (!endpoint) return null

    if (isPendingCleanupExpired(record)) {
      mgr?.log.warn(`pending_cleanup_discard reason=expired provider=colab endpoint=${endpoint}`)
      await clearPendingCleanup(mgr.ctx)
      return false
    }
    if (record.attempts >= PENDING_CLEANUP_MAX_ATTEMPTS) {
      mgr?.log.warn(`pending_cleanup_discard reason=max_attempts provider=colab endpoint=${endpoint}`)
      await clearPendingCleanup(mgr.ctx)
      return false
    }

    try {
      await unassign({ token: await this.#token(), endpoint, log: this.log })
    } catch (error) {
      const status = error instanceof ProbeError ? error.status : 0
      if (status === 404 || status === 410) {
        await clearPendingCleanup(mgr.ctx)
        return true
      }
      const attempts = record.attempts + 1
      this.log.warn(`colab_pending_cleanup_retry endpoint=${endpoint} attempts=${attempts}`)
      try {
        const { writePendingCleanup } = await import('../session/pending-cleanup.js')
        await writePendingCleanup(mgr.ctx, { ...record, attempts })
      } catch {}
      return false
    }

    mgr?.log.info(`pending_cleanup_done provider=colab endpoint=${endpoint}`)
    await clearPendingCleanup(mgr.ctx)
    await mgr?.clearPersistedSession().catch(() => {})
    return true
  }

  /** 恢复：按记录里的 assignment 重新接管实例（不重新申请），并尽量重连 Kernel WS。 */
  async attach(record) {
    const endpoint = record?.handle?.assignmentEndpoint
    if (!endpoint) return null
    const list = await listAssignments(await this.#token())
    const hit = list.find((item) => item.endpoint === endpoint)
    if (!hit) return null
    const handle = {
      kind: 'colab',
      assignmentEndpoint: endpoint,
      kernelId: record.handle?.kernelId ?? null,
      proxyUrl: hit.runtimeProxyInfo?.url,
      proxyToken: hit.runtimeProxyInfo?.token,
      proxyTokenExpiresInSeconds: hit.runtimeProxyInfo?.tokenExpiresInSeconds,
      proxyTokenExpiresAt: Date.now() + Number(hit.runtimeProxyInfo?.tokenExpiresInSeconds ?? 3600) * 1000,
      endpointUrl: record.endpointUrl ?? null,
    }
    handle.usage = await ccuInfo(await this.#token()).then((info) => ({
      balance: info.currentBalance,
      rate: info.consumptionRateHourly,
      assignments: info.assignmentsCount,
    })).catch(() => null)
    this.lastHandle = handle
    // 无论 WS 是否连上都要登记：后续 #beat 看到 socket 为空/已关闭会重连，
    // 否则重启后保活链路永远接不上。
    let socket = null
    if (handle.kernelId) {
      socket = new KernelSocket(this.#assignmentOf(handle), handle.kernelId, { log: this.log })
      await socket.connect({ retries: 2 }).catch(() => {})
    }
    this.sessions.set(endpoint, { socket, handle })
    return handle
  }

  /** 会话记录里的 Colab 实例释放（2b 实装恢复前的兜底）：只需要 assignment endpoint。 */
  async releaseRecord(record) {
    const endpoint = record?.handle?.assignmentEndpoint
    if (!endpoint) return false
    try {
      await unassign({ token: await this.#token(), endpoint, log: this.log })
      return true
    } catch (error) {
      const status = error instanceof ProbeError ? error.status : 0
      if (status === 404 || status === 410) return true
      throw error
    }
  }

  async readLogs(run, handle = {}) {
    const target = handle.assignmentEndpoint ? handle : this.lastHandle
    if (!target) return null
    const text = await readFileText(this.#assignmentOf(target), DAEMON_LOG).catch(() => null)
    return text ? text.slice(-4000) : null
  }
}

/** 远端启动失败码 → 会话失败码（未登记的回退 remote_error）。 */
function mapBootError(code) {
  const known = new Set(['auth_required', 'push_failed', 'gpu_unavailable', 'remote_error'])
  return known.has(String(code)) ? String(code) : 'remote_error'
}
