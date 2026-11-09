/**
 * 远端会话生命周期（协议见 docs/API.md 第 2、6 节）。
 *
 * 一次会话 = 一个常驻 Kaggle Kernel + 一条 Cloudflare 隧道：
 *   push → 排队 → 隧道上报 → health 握手 → ready
 * 模型只在 Kernel 内加载一次，后续出图复用同一进程，避免重复排队。
 */

import { randomBytes } from 'node:crypto'

import { buildKernelFolder, randomSlug, removeKernelFolder } from './kernel.js'
import { kaggleUsername, kernelLogs, kernelStatus, pushKernel } from './kaggle.js'
import { httpText } from './net.js'
import { presetById } from './presets.js'
import { fetchHealth, isTrustedEndpoint, requestShutdown } from './remote.js'

const ACTIVE_STATES = new Set(['provisioning', 'connecting', 'warming', 'ready', 'stopping'])
const NTFY_BASE = 'https://ntfy.sh'
const TICK_MS = 3000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isoNow() {
  return new Date().toISOString()
}

export class SessionManager {
  constructor({ ctx, defaultPreset, options = {} }) {
    this.ctx = ctx
    this.defaultPreset = defaultPreset
    this.options = {
      accelerator: 'NvidiaTeslaT4',
      kernelTimeoutSec: 10800,
      idleTimeoutSec: 1800,
      provisionTimeoutMs: 45 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
      healthyIntervalMs: 10000,
      devEndpoint: null,
      devToken: null,
      sourcePath: null,
      enableGpu: true,
      ...options,
    }
    this.timers = new Set()
    this.kernelFolder = null
    this.secret = { token: null, topic: null }
    this.session = this.emptySession()
    this.starting = null
    this.healthMisses = 0
    this.disposed = false
  }

  emptySession() {
    return {
      state: 'absent',
      phase: null,
      detail: null,
      presetId: null,
      kernelId: null,
      kernelUrl: null,
      kernelStatus: null,
      endpointUrl: null,
      device: null,
      deviceCount: null,
      modelId: null,
      startedAt: null,
      readyAt: null,
      lastProbeAt: null,
      idleTimeoutSec: this.options.idleTimeoutSec,
      error: null,
    }
  }

  snapshot() {
    const value = { ...this.session }
    value.error = this.session.error ? { ...this.session.error } : null
    return value
  }

  /** 供任务执行器取用的一次性连接信息；不进入任何对外快照。 */
  connection() {
    return { endpoint: this.session.endpointUrl, token: this.secret.token }
  }

  get isActive() {
    return ACTIVE_STATES.has(this.session.state)
  }

  get isReady() {
    return this.session.state === 'ready'
  }

  // ---- 定时器 -------------------------------------------------------------

  every(fn, ms) {
    const id = setInterval(() => {
      Promise.resolve()
        .then(fn)
        .catch(() => {})
    }, ms)
    this.timers.add(id)
    return id
  }

  clearTimers() {
    for (const id of this.timers) clearInterval(id)
    this.timers.clear()
  }

  dispose() {
    this.disposed = true
    this.clearTimers()
  }

  // ---- 启动 ---------------------------------------------------------------

  async start(presetId = this.defaultPreset) {
    if (ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    if (this.starting) return this.starting
    this.starting = this._start(presetId).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  async _start(presetId) {
    this.clearTimers()
    this.healthMisses = 0
    this.session = this.emptySession()
    this.session.presetId = presetId
    this.session.state = 'provisioning'
    this.session.phase = 'push'
    this.session.detail = '正在准备 Kernel 目录'
    this.session.startedAt = isoNow()

    if (this.options.devEndpoint) {
      this.secret = { token: this.options.devToken ?? '', topic: null }
      this.session.endpointUrl = this.options.devEndpoint
      this.session.state = 'ready'
      this.session.phase = null
      this.session.readyAt = isoNow()
      this.session.detail = '开发模式：直连本地 Daemon'
      this.session.modelId = 'local-mock'
      return this.snapshot()
    }

    const token = randomBytes(24).toString('hex')
    const topic = `imagen-${randomBytes(8).toString('hex')}`
    this.secret = { token, topic }

    let username
    try {
      username = await kaggleUsername(this.ctx)
    } catch (error) {
      return this.fail('auth_required', `读取 Kaggle 用户名失败：${error?.message ?? error}`)
    }

    let folder
    try {
      folder = await buildKernelFolder({
        username,
        slug: randomSlug(),
        sourcePath: this.options.sourcePath ?? undefined,
        enableGpu: this.options.enableGpu !== false,
        config: {
          auth_token: token,
          ntfy_topic: topic,
          idle_timeout_sec: this.options.idleTimeoutSec,
          // daemon 只认完整 pipeline 描述；传预设 id 它无法加载（协议见 docs/API.md 第 6 节）。
          preload: presetById(presetId).pipeline,
          preset_id: presetId,
          log_level: 'info',
          version: '0.2.0',
        },
      })
    } catch (error) {
      return this.fail('push_failed', `构建 Kernel 目录失败：${error?.message ?? error}`)
    }

    this.kernelFolder = folder.dir
    this.session.kernelId = folder.kernelId
    this.session.kernelUrl = folder.kernelUrl
    this.session.detail = '正在推送 Kernel'

    const pushed = await pushKernel(this.ctx, folder.dir, {
      accelerator: this.options.enableGpu === false ? null : this.options.accelerator,
      timeoutSec: this.options.kernelTimeoutSec,
    })
    if (!pushed.ok) {
      const code = pushed.authFailed ? 'auth_required' : 'push_failed'
      const logs = await kernelLogs(this.ctx, folder.kernelId).catch(() => null)
      const reason = [pushed.output, logs?.tail].filter(Boolean).join('\n').slice(-600)
      return this.fail(code, `Kernel 推送失败：${reason || '未知原因'}`)
    }

    this.session.kernelStatus = 'PENDING'
    this.session.phase = 'queue'
    this.session.detail = '已推送，等待 GPU 排队'
    this.watch()
    return this.snapshot()
  }

  // ---- 轮询 ---------------------------------------------------------------

  watch() {
    this.clearTimers()
    this.every(() => this.pollTunnel(), TICK_MS)
    this.every(() => this.pollKernelStatus(), 20000)
  }

  elapsedMs() {
    const started = this.session.startedAt ? Date.parse(this.session.startedAt) : Date.now()
    return Date.now() - started
  }

  async pollTunnel() {
    if (this.disposed || this.session.endpointUrl) return
    if (this.session.state === 'provisioning' && this.elapsedMs() > this.options.provisionTimeoutMs) {
      const logs = this.session.kernelId ? await kernelLogs(this.ctx, this.session.kernelId).catch(() => null) : null
      this.fail('queue_timeout', `等待 GPU 超时（${Math.round(this.options.provisionTimeoutMs / 60000)} 分钟）${logs?.tail ? `\n${logs.tail.slice(-400)}` : ''}`)
      return
    }
    if (this.session.state === 'connecting' && this.elapsedMs() > this.options.provisionTimeoutMs + this.options.tunnelTimeoutMs) {
      this.fail('tunnel_timeout', '隧道握手超时：Kernel 已启动但未拿到可访问地址')
      return
    }

    const url = `${NTFY_BASE}/${this.secret.topic}/json?poll=1&since=all`
    const res = await httpText(this.ctx, url, {
      timeoutMs: 8000,
      headers: { accept: 'application/x-ndjson' },
    }).catch(() => null)
    if (!res?.ok) return

    for (const line of res.text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let event
      try {
        event = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (event?.event !== 'message' || typeof event.message !== 'string') continue
      let payload
      try {
        payload = JSON.parse(event.message)
      } catch {
        continue
      }
      if (payload?.type !== 'ready') continue
      if (!isTrustedEndpoint(payload.endpoint)) continue

      this.session.endpointUrl = payload.endpoint
      this.session.modelId = payload.model_id ?? this.session.modelId
      this.session.device = payload.device ?? this.session.device
      this.session.state = 'connecting'
      this.session.phase = 'tunnel'
      this.session.detail = '隧道已建立，正在握手'
      this.startHealthLoop()
      return
    }
  }

  startHealthLoop() {
    this.clearTimers()
    this.every(() => this.pollHealth(), TICK_MS)
    this.every(() => this.pollKernelStatus(), 30000)
    void this.pollHealth()
  }

  async pollHealth() {
    if (this.disposed || !this.session.endpointUrl) return
    let health
    try {
      health = await fetchHealth(this.session.endpointUrl, this.secret.token)
      this.healthMisses = 0
    } catch {
      this.healthMisses += 1
      if (this.healthMisses >= 5 && this.session.state !== 'ready') {
        // 隧道可能重建：回到等待上报状态重新取地址。
        this.healthMisses = 0
        this.session.endpointUrl = null
        this.session.state = 'connecting'
        this.session.phase = 'tunnel'
        this.session.detail = '隧道失联，正在重新获取地址'
        this.clearTimers()
        this.every(() => this.pollTunnel(), TICK_MS)
        this.every(() => this.pollKernelStatus(), 20000)
      } else if (this.healthMisses >= 3 && this.session.state === 'ready') {
        this.session.detail = '远端心跳丢失，正在重连'
      }
      return
    }

    this.session.lastProbeAt = isoNow()
    if (health?.device) this.session.device = health.device
    if (health?.device_count != null) this.session.deviceCount = health.device_count
    if (health?.model_id) this.session.modelId = health.model_id
    if (health?.idle_timeout_sec) this.session.idleTimeoutSec = health.idle_timeout_sec

    if (health?.phase === 'ready') {
      if (this.session.state !== 'ready') {
        this.session.state = 'ready'
        this.session.phase = null
        this.session.readyAt = this.session.readyAt ?? isoNow()
        this.session.detail = '就绪'
        this.clearTimers()
        this.every(() => this.pollHealth(), this.options.healthyIntervalMs)
      }
      return
    }

    this.session.state = 'warming'
    this.session.phase = 'warm'
    this.session.detail =
      health?.phase === 'installing'
        ? '远端安装依赖'
        : health?.phase === 'loading'
          ? '远端加载模型'
          : health?.phase === 'error'
            ? `远端错误：${health?.last_error ?? '未知'}`
            : '远端启动中'
    if (health?.phase === 'error') {
      this.fail('remote_error', `远端进入错误状态：${String(health?.last_error ?? '未知').slice(0, 400)}`)
    }
  }

  async pollKernelStatus() {
    if (this.disposed || !this.session.kernelId) return
    const result = await kernelStatus(this.ctx, this.session.kernelId).catch(() => null)
    if (!result?.ok) return
    if (result.status) this.session.kernelStatus = result.status

    const ended = result.status === 'COMPLETE' || result.status === 'ERROR' || result.status === 'CANCEL_ACKNOWLEDGED'
    if (!ended) return

    const logs = await kernelLogs(this.ctx, this.session.kernelId).catch(() => null)
    const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
    // ready 状态下结束通常是空闲退出或远端崩溃；其余阶段结束说明启动没成功。
    if (result.status !== 'ERROR' && this.session.state === 'ready') {
      this.fail('session_ended', `Kernel 已结束（${result.status}），会话需要重新启动${tail}`)
    } else {
      this.fail('remote_error', `Kernel 已结束（${result.status}）${tail}`)
    }
  }

  // ---- 停止 ---------------------------------------------------------------

  async stop() {
    const before = this.session.state
    const kernelId = this.session.kernelId
    this.clearTimers()
    this.session.state = 'stopping'

    if (this.session.endpointUrl && this.secret.token) {
      await requestShutdown(this.session.endpointUrl, this.secret.token).catch(() => false)
    }
    await removeKernelFolder(this.kernelFolder)
    this.kernelFolder = null
    this.secret = { token: null, topic: null }
    this.healthMisses = 0

    this.session = this.emptySession()
    this.session.detail =
      before === 'provisioning'
        ? `已放弃跟踪；Kernel ${kernelId ?? ''} 仍在 Kaggle 侧排队，可在网页端停止`
        : before === 'absent'
          ? null
          : '已关机'
    return this.snapshot()
  }

  // ---- 等待 ---------------------------------------------------------------

  async ensureReady({ timeoutMs = 30 * 60 * 1000, onTick = null } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.disposed) throw Object.assign(new Error('插件已卸载'), { code: 'disposed' })
      const state = this.session.state
      if (state === 'ready') return this.snapshot()
      if (state === 'error') {
        throw Object.assign(new Error(this.session.error?.message ?? '会话失败'), {
          code: this.session.error?.code ?? 'session_error',
        })
      }
      if (state === 'absent' || state === 'stopping') {
        throw Object.assign(new Error('会话未启动'), { code: 'session_absent' })
      }
      onTick?.(this.snapshot())
      await sleep(1000)
    }
    throw Object.assign(new Error('等待会话就绪超时'), { code: 'session_timeout' })
  }

  fail(code, message) {
    this.clearTimers()
    const text = String(message ?? '未知错误')
    this.session.state = 'error'
    this.session.phase = null
    this.session.detail = text.split('\n')[0].slice(0, 200)
    this.session.error = { code, message: text.slice(0, 800) }
    return this.snapshot()
  }
}
