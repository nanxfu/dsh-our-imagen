/**
 * 远端会话生命周期（协议见 docs/SPEC.md 第 1、2 节）。
 *
 * 一次会话 = 一个常驻 Kaggle Kernel + 一条 Cloudflare 隧道：
 *   push → 排队 → 隧道上报 → health 握手 → ready
 * 模型只在 Kernel 内加载一次，后续出图复用同一进程，避免重复排队。
 *
 * 并发模型：start / stop / dispose 都会让「启动代次（epoch）」递增。任何跨越
 * await 的异步步骤（push、轮询、心跳恢复）在恢复执行时都必须校验代次；过期
 * 流程只做清理，不得再写会话状态、不得重新挂轮询定时器——否则用户点「关机」
 * 之后，还在飞的 push 会把会话复活成僵尸轮询。
 */

import { randomBytes } from 'node:crypto'

import { TIMEOUTS, VERSION, daemonContract } from '../shared/contract.js'
import { buildKernelFolder, randomSlug, removeKernelFolder } from './kernel.js'
import { kaggleUsername, kernelLogs, kernelStatus, pushKernel } from './kaggle.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'
import { presetById } from './presets.js'
import { fetchHealth, isTrustedEndpoint, requestShutdown } from './remote.js'

const ACTIVE_STATES = new Set(['provisioning', 'connecting', 'warming', 'ready', 'stopping'])
const NTFY_BASE = 'https://ntfy.sh'
// 时序与阈值统一取自 shared/contract.js 的 TIMEOUTS（唯一来源），本文件不再保留默认值：
//  - kernelPollMs：ready 之后仍要低频轮询 Kernel 状态 —— daemon 空闲退出 / 被平台回收时，
//    只有 Kernel 状态能证明会话已经结束（隧道断了 health 只是失败，不说明原因）；
//  - readyHealthMissesBeforeCheck：ready 阶段心跳连续失败多少次才去查 Kernel，避免一次网络抖动就重置隧道；
//  - reconnectMaxAttempts：ready 阶段允许的「重取隧道地址」轮数；超过就判定会话失效，不再无限抖动；
//  - remoteShutdownMs：best-effort 关机通知的最长等待时间（不阻塞调用方）。

/**
 * 远端调用默认实现。测试可用 `new SessionManager({ deps })` 注入假实现，
 * 这样会话状态机可以离线回归（不需要 kaggle CLI / Kaggle 队列 / GPU）。
 */
const DEFAULT_DEPS = {
  buildKernelFolder,
  removeKernelFolder,
  kaggleUsername,
  pushKernel,
  kernelStatus,
  kernelLogs,
  requestShutdown,
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isoNow() {
  return new Date().toISOString()
}

/** 把毫秒时长格式化成给用户看的文案（45 分钟 / 90 秒）。 */
function formatDuration(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds < 90 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`
}

export class SessionManager {
  constructor({ ctx, defaultPreset, options = {}, deps = {} }) {
    this.ctx = ctx
    this.defaultPreset = defaultPreset
    this.deps = { ...DEFAULT_DEPS, ...deps }
    this.log = createLogger({ scope: 'session', sink: deps.log })
    this.options = {
      accelerator: 'NvidiaTeslaT4',
      kernelTimeoutSec: TIMEOUTS.kernelRunMaxSec,
      idleTimeoutSec: TIMEOUTS.idleShutdownSec,
      provisionTimeoutMs: TIMEOUTS.provisionMs,
      tunnelTimeoutMs: TIMEOUTS.tunnelMs,
      healthyIntervalMs: TIMEOUTS.healthyPollMs,
      // ready 阶段失联后允许的重新会合时长，超过即判定会话失效。
      recoveryTimeoutMs: TIMEOUTS.recoveryMs,
      // 会合/健康轮询与 Kernel 状态轮询的间隔，测试可调小以加速离线回归。
      tickMs: TIMEOUTS.sessionTickMs,
      kernelPollMs: TIMEOUTS.kernelPollMs,
      ntfyBase: NTFY_BASE,
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
    this.startingEpoch = null
    // 启动代次：start / stop / dispose 递增，用于作废在飞的异步流程。
    this.epoch = 0
    // 用户主动 stop 后置位，直到用户再次 start（面板「唤起」）才清除。
    // JobQueue 据此拒绝为排队任务自动拉起新的 Kernel。
    this.stoppedByUser = false
    this.healthMisses = 0
    this.reconnectAttempts = 0
    this.livenessCheck = null
    this.recoveringFromReady = false
    this.recoveryStartedAt = 0
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

  // ---- 代次与定时器 -------------------------------------------------------

  /** 该代次是否已被 stop / dispose / 新的 start 作废。 */
  isStale(epoch) {
    return this.disposed || epoch !== this.epoch
  }

  /** 过期的异步结果不允许再写会话状态（尤其不能覆盖 error）。 */
  canPoll(epoch) {
    return !this.isStale(epoch) && this.session.state !== 'error'
  }

  every(fn, ms) {
    const id = setInterval(() => {
      Promise.resolve()
        .then(fn)
        .catch((error) => this.log.warn('轮询异常（已忽略，状态保持不变）', error?.message ?? error))
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
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    this.clearTimers()
    // DSH 退出 / 插件热重载前尽力通知远端退出，否则 Kernel 会继续烧每周 GPU 配额。
    // 不 await：卸载路径必须立刻返回，失败由 requestShutdown 内部吞掉。
    this.shutdownRemote()
  }

  /** 通知远端关机（best-effort，不阻塞、失败忽略）。 */
  shutdownRemote() {
    const endpoint = this.session.endpointUrl
    const token = this.secret.token
    if (!endpoint || !token) return
    try {
      const pending = this.deps.requestShutdown(endpoint, token, TIMEOUTS.remoteShutdownMs, this.ctx)
      if (pending && typeof pending.catch === 'function') {
        pending.catch((error) => {
          this.log.debug('best-effort 关机通知失败', error?.message ?? error)
          return false
        })
      }
    } catch (error) {
      // best-effort：关机通知失败不影响本地状态机。
      this.log.debug('best-effort 关机通知异常', error?.message ?? error)
    }
  }

  // ---- 启动 ---------------------------------------------------------------

  async start(presetId = this.defaultPreset) {
    if (ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    // 同一代次的启动只允许一份；stop 之后代次变化，新的 start 必须重新发起，
    // 不能被上一轮尚未结束的 _start 承诺挡住。
    if (this.starting && this.startingEpoch === this.epoch) return this.starting

    // 用户主动启动（面板「唤起」/Agent start）清除「已关机」标记。
    this.stoppedByUser = false
    const epoch = (this.epoch += 1)
    this.startingEpoch = epoch
    this.starting = this._start(presetId, epoch).finally(() => {
      if (this.startingEpoch === epoch) {
        this.starting = null
        this.startingEpoch = null
      }
    })
    return this.starting
  }

  async _start(presetId, epoch) {
    let folderDir = null
    try {
      this.clearTimers()
      this.healthMisses = 0
      this.reconnectAttempts = 0
      this.livenessCheck = null
      this.recoveringFromReady = false
      this.recoveryStartedAt = 0
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
        username = await this.deps.kaggleUsername(this.ctx)
      } catch (error) {
        if (this.isStale(epoch)) return this.abandonStart(folderDir)
        return this.fail('auth_required', `读取 Kaggle 用户名失败：${error?.message ?? error}`)
      }
      if (this.isStale(epoch)) return this.abandonStart(folderDir)

      let folder
      try {
        folder = await this.deps.buildKernelFolder({
          username,
          slug: randomSlug(),
          sourcePath: this.options.sourcePath ?? undefined,
          enableGpu: this.options.enableGpu !== false,
          config: {
            auth_token: token,
            ntfy_topic: topic,
            idle_timeout_sec: this.options.idleTimeoutSec,
            // daemon 只认完整 pipeline 描述；传预设 id 它无法加载（字段见 remote/daemon.py 顶部说明）。
            preload: presetById(presetId).pipeline,
            preset_id: presetId,
            log_level: 'info',
            // 版本与协议契约同源（shared/contract.js）：daemon 侧按 config.contract 校验参数边界。
            version: VERSION,
            contract: daemonContract(),
          },
        })
      } catch (error) {
        if (this.isStale(epoch)) return this.abandonStart(folderDir)
        return this.fail('push_failed', `构建 Kernel 目录失败：${error?.message ?? error}`)
      }
      folderDir = folder?.dir ?? null
      if (this.isStale(epoch)) return this.abandonStart(folderDir)

      this.kernelFolder = folder.dir
      this.session.kernelId = folder.kernelId
      this.session.kernelUrl = folder.kernelUrl
      this.session.detail = '正在推送 Kernel'

      let pushed
      try {
        pushed = await this.deps.pushKernel(this.ctx, folder.dir, {
          accelerator: this.options.enableGpu === false ? null : this.options.accelerator,
          timeoutSec: this.options.kernelTimeoutSec,
        })
      } catch (error) {
        if (this.isStale(epoch)) return this.abandonStart(folderDir)
        await this.discardKernelFolder()
        return this.fail('push_failed', `Kernel 推送异常：${error?.message ?? error}`)
      }
      if (this.isStale(epoch)) return this.abandonStart(folderDir)

      if (!pushed.ok) {
        const code = pushed.authFailed ? 'auth_required' : 'push_failed'
        const logs = await this.deps.kernelLogs(this.ctx, folder.kernelId).catch((error) => {
          this.log.debug('拉取 Kernel 日志失败（只影响失败原因文案）', error?.message ?? error)
          return null
        })
        if (this.isStale(epoch)) return this.abandonStart(folderDir)
        const reason = [pushed.output, logs?.tail].filter(Boolean).join('\n').slice(-600)
        // 临时目录里的 daemon.py 含本次会话 token，push 失败后不能留在 %TEMP%。
        await this.discardKernelFolder()
        return this.fail(code, `Kernel 推送失败：${reason || '未知原因'}`)
      }

      this.session.kernelStatus = 'PENDING'
      this.session.phase = 'queue'
      this.session.detail = '已推送，等待 GPU 排队'
      this.watch()
      return this.snapshot()
    } catch (error) {
      // 兜底：任何未预期的异常都必须收敛为可重试的 error 状态并清理临时目录，
      // 绝不能让会话停在 provisioning（那时没有定时器，start() 又会直接命中 ACTIVE_STATES）。
      if (this.isStale(epoch)) return this.abandonStart(folderDir)
      if (folderDir && this.kernelFolder === folderDir) this.kernelFolder = null
      if (folderDir) {
        await this.deps.removeKernelFolder(folderDir).catch((error) => {
          this.log.warn('临时 Kernel 目录清理失败（目录内 daemon.py 含 token）', error?.message ?? error)
        })
      }
      return this.fail('push_failed', `启动会话失败：${error?.message ?? error}`)
    }
  }

  /**
   * 作废的启动流程只做清理：删掉本次的临时 Kernel 目录（内含 token），
   * 不写任何会话状态、不挂定时器，返回当前（可能已是新一轮/已关机）的快照。
   */
  async abandonStart(folderDir) {
    if (folderDir && this.kernelFolder === folderDir) this.kernelFolder = null
    if (folderDir) {
      await this.deps.removeKernelFolder(folderDir).catch((error) => {
        this.log.warn('临时 Kernel 目录清理失败（目录内 daemon.py 含 token）', error?.message ?? error)
      })
    }
    return this.snapshot()
  }

  /**
   * 丢弃本次会话的临时 Kernel 目录（目录内的 daemon.py 含 token）。
   * push 失败与 stop 都必须清理，避免 token 长期留在系统临时目录。
   */
  async discardKernelFolder() {
    const dir = this.kernelFolder
    this.kernelFolder = null
    if (!dir) return
    try {
      await this.deps.removeKernelFolder(dir)
    } catch (error) {
      // 清理失败不影响会话状态（临时目录最终由系统回收），但目录内含 token，需留痕。
      this.log.warn('丢弃临时 Kernel 目录失败（目录内含 token）', error?.message ?? error)
    }
  }

  // ---- 轮询 ---------------------------------------------------------------

  watch() {
    this.clearTimers()
    this.every(() => this.pollTunnel(), this.options.tickMs)
    this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
  }

  elapsedMs() {
    const started = this.session.startedAt ? Date.parse(this.session.startedAt) : Date.now()
    return Date.now() - started
  }

  async pollTunnel() {
    if (this.disposed || this.session.state === 'error' || this.session.endpointUrl) return
    const epoch = this.epoch
    // ready 之后隧道重建失败时不能一直挂在 connecting 状态（旧逻辑要等 60 分钟）。
    if (
      this.recoveringFromReady &&
      this.recoveryStartedAt > 0 &&
      Date.now() - this.recoveryStartedAt > this.options.recoveryTimeoutMs
    ) {
      if (this.isStale(epoch)) return
      this.fail(
        'health_failed',
        `隧道失联后 ${formatDuration(this.options.recoveryTimeoutMs)}内未能重新会合（Kernel 状态 ${this.session.kernelStatus ?? '未知'}），请重新启动会话`,
      )
      return
    }
    if (this.session.state === 'provisioning' && this.elapsedMs() > this.options.provisionTimeoutMs) {
      const kernelId = this.session.kernelId
      const logs = kernelId
        ? await this.deps.kernelLogs(this.ctx, kernelId).catch((error) => {
            this.log.debug('拉取 Kernel 日志失败（只影响超时原因文案）', error?.message ?? error)
            return null
          })
        : null
      if (this.isStale(epoch)) return
      const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
      const status = this.session.kernelStatus
      // 区分「还在排队」与「容器已启动但没收到会合消息」：后者是隧道/ntfy 失败，
      // 文案必须指向正确方向，否则用户会以为只是排队慢。
      const containerUp = Boolean(status) && status !== 'PENDING' && status !== 'QUEUED'
      if (containerUp) {
        this.fail(
          'tunnel_timeout',
          `等待会合超时（${formatDuration(this.options.provisionTimeoutMs)}）：Kernel 已处于 ${status}，但没有收到隧道地址（ntfy / cloudflared 可能失败）${tail}`,
        )
      } else {
        this.fail(
          'queue_timeout',
          `等待 GPU 超时（${formatDuration(this.options.provisionTimeoutMs)}），Kernel 仍在队列中（${status ?? '状态未知'}）${tail}`,
        )
      }
      return
    }
    if (this.session.state === 'connecting' && this.elapsedMs() > this.options.provisionTimeoutMs + this.options.tunnelTimeoutMs) {
      if (this.isStale(epoch)) return
      this.fail('tunnel_timeout', '隧道握手超时：Kernel 已启动但未拿到可访问地址，请重启会话或查看远端日志')
      return
    }

    const url = `${this.options.ntfyBase}/${this.secret.topic}/json?poll=1&since=all`
    const res = await httpText(this.ctx, url, {
      timeoutMs: TIMEOUTS.ntfyPollMs,
      headers: { accept: 'application/x-ndjson' },
    }).catch((error) => {
      // 会合阶段单次轮询失败是常态（ntfy 慢 / 暂无消息），交给下一拍重试。
      this.log.debug('ntfy 会合轮询失败（预期内）', error?.message ?? error)
      return null
    })
    if (!this.canPoll(epoch) || this.session.endpointUrl) return
    if (!res?.ok) return

    for (const line of res.text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let event
      try {
        event = JSON.parse(trimmed)
      } catch (error) {
        this.log.warn('会合消息不是合法 JSON（协议可能已漂移）', error?.message ?? error)
        continue
      }
      if (event?.event !== 'message' || typeof event.message !== 'string') continue
      let payload
      try {
        payload = JSON.parse(event.message)
      } catch (error) {
        this.log.warn('会合消息负载解析失败（协议可能已漂移）', error?.message ?? error)
        continue
      }
      if (payload?.type === 'error') {
        // daemon 在隧道/依赖/预加载失败时会先发 error 事件再退出。
        // 以前这里只认 ready，导致 Host 一直等到 45 分钟 queue_timeout，归因完全错误。
        const remoteCode = String(payload?.code ?? 'remote_error')
        const code = remoteCode === 'tunnel_failed' ? 'tunnel_timeout' : 'remote_error'
        this.fail(code, `远端启动失败（${remoteCode}）：${String(payload?.message ?? '无详情').slice(0, 400)}`)
        return
      }
      if (payload?.type !== 'ready') continue
      if (!isTrustedEndpoint(payload.endpoint)) continue
      // 幂等：并发的两次轮询可能拿到同一条 ready，已在握手中的 endpoint 不重复处理。
      if (this.session.endpointUrl === payload.endpoint) continue

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
    this.every(() => this.pollHealth(), this.options.tickMs)
    this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
    void this.pollHealth()
  }

  async pollHealth() {
    if (this.disposed || !this.session.endpointUrl) return
    const epoch = this.epoch
    let health
    try {
      health = await fetchHealth(this.session.endpointUrl, this.secret.token, undefined, this.ctx)
      if (!this.canPoll(epoch)) return
      this.healthMisses = 0
      this.recoveringFromReady = false
      this.recoveryStartedAt = 0
    } catch (error) {
      if (!this.canPoll(epoch)) return
      // 心跳失败是预期内的网络事件，按 debug 记录，避免代理抖动时刷屏。
      this.log.debug('健康检查失败', error?.message ?? error)
      this.healthMisses += 1
      if (this.session.state === 'ready') {
        // ready 之后心跳丢失不能只改文案：先确认 Kernel 是否还活着，
        // 再决定「重取隧道地址」还是「判定会话结束」（否则 UI 会一直显示在线）。
        if (this.healthMisses >= TIMEOUTS.readyHealthMissesBeforeCheck) {
          void this.handleReadyHealthLoss()
        } else {
          this.session.detail = '远端心跳丢失，正在确认会话状态'
        }
        return
      }
      if (this.recoveringFromReady) {
        // 从 ready 失联恢复出来的连接仍握手失败：给「网络抖动」留够重试窗口
        // （默认 2 个健康检测周期 = recoveryTimeoutMs），超时才判定会话失效，
        // 避免几十秒的本地网络抖动就杀掉一个还在 RUNNING 的 Kernel（重新排队代价很高）。
        const waited = this.recoveryStartedAt > 0 ? Date.now() - this.recoveryStartedAt : 0
        if (waited > this.options.recoveryTimeoutMs) {
          this.fail(
            'health_failed',
            `重新获取隧道地址后仍无法握手（已等待 ${formatDuration(waited)}，Kernel 状态 ${this.session.kernelStatus ?? '未知'}），请重新启动会话`,
          )
          return
        }
        this.session.detail = '重新获取隧道地址后仍在重试握手'
      } else if (this.healthMisses >= 5) {
        // 隧道可能重建：回到等待上报状态重新取地址。
        this.healthMisses = 0
        this.session.endpointUrl = null
        this.session.state = 'connecting'
        this.session.phase = 'tunnel'
        this.session.detail = '隧道失联，正在重新获取地址'
        this.clearTimers()
        this.every(() => this.pollTunnel(), this.options.tickMs)
        this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
      } else if (this.healthMisses >= 3) {
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
      this.reconnectAttempts = 0
      if (this.session.state !== 'ready') {
        this.session.state = 'ready'
        this.session.phase = null
        this.session.readyAt = this.session.readyAt ?? isoNow()
        this.session.detail = '就绪'
        this.clearTimers()
        this.every(() => this.pollHealth(), this.options.healthyIntervalMs)
        // 保留 Kernel 状态轮询：daemon 空闲退出 / 平台回收后，这是唯一能证明
        // 会话已经结束的信号；没有它 UI 会一直显示「在线」而每张图都失败。
        this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
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

  /**
   * ready 阶段连续心跳失败后的恢复决策：
   *  - Kernel 已结束（COMPLETE / ERROR / CANCEL_ACKNOWLEDGED）→ 立刻结束会话；
   *  - Kernel 仍 RUNNING → 认为隧道可能重建，清空 endpointUrl 回会合点重取一次；
   *  - 重新会合后再失败 → health_failed，不再无限抖动。
   */
  async handleReadyHealthLoss() {
    if (this.livenessCheck) return this.livenessCheck
    const epoch = this.epoch
    if (this.disposed || this.session.state !== 'ready') return null
    this.livenessCheck = (async () => {
      try {
        const kernelId = this.session.kernelId
        const result = await this.deps.kernelStatus(this.ctx, kernelId).catch((error) => {
          this.log.debug('查询 Kernel 状态失败（按未知处理）', error?.message ?? error)
          return null
        })
        if (!this.canPoll(epoch) || this.session.state !== 'ready') return
        const status = result?.status ?? null
        if (status) this.session.kernelStatus = status
        const ended = status === 'COMPLETE' || status === 'ERROR' || status === 'CANCEL_ACKNOWLEDGED'
        if (ended) {
          const logs = await this.deps.kernelLogs(this.ctx, kernelId).catch((error) => {
            this.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', error?.message ?? error)
            return null
          })
          if (!this.canPoll(epoch)) return
          const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
          if (status === 'ERROR') {
            this.fail('remote_error', `Kernel 已结束（ERROR），远端异常退出${tail}`)
          } else {
            this.fail('session_ended', `Kernel 已结束（${status}），会话需要重新启动${tail}`)
          }
          return
        }
        if (this.reconnectAttempts >= TIMEOUTS.reconnectMaxAttempts) {
          this.fail(
            'health_failed',
            `远端心跳连续丢失，且 Kernel 状态为 ${status ?? '未知'}；隧道可能已失效，请重新启动会话`,
          )
          return
        }
        this.reconnectAttempts += 1
        this.healthMisses = 0
        this.recoveringFromReady = true
        this.recoveryStartedAt = Date.now()
        this.session.endpointUrl = null
        this.session.state = 'connecting'
        this.session.phase = 'tunnel'
        this.session.detail = '远端心跳丢失，正在重新获取隧道地址'
        this.clearTimers()
        this.every(() => this.pollTunnel(), this.options.tickMs)
        this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
      } finally {
        this.livenessCheck = null
      }
    })()
    return this.livenessCheck
  }

  async pollKernelStatus() {
    if (this.disposed || !this.session.kernelId) return
    const epoch = this.epoch
    const kernelId = this.session.kernelId
    const result = await this.deps.kernelStatus(this.ctx, kernelId).catch((error) => {
      this.log.debug('轮询 Kernel 状态失败（下一拍重试）', error?.message ?? error)
      return null
    })
    if (!this.canPoll(epoch)) return
    if (!result?.ok) return
    if (result.status) this.session.kernelStatus = result.status

    const ended = result.status === 'COMPLETE' || result.status === 'ERROR' || result.status === 'CANCEL_ACKNOWLEDGED'
    if (!ended) return

    const logs = await this.deps.kernelLogs(this.ctx, kernelId).catch((error) => {
      this.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', error?.message ?? error)
      return null
    })
    if (!this.canPoll(epoch)) return

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
    // 递增代次：在飞的 _start / 轮询从这一刻起全部失效，不能再写回状态或挂定时器。
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    // 「用户已关机」标记保持到下一次 start 清除；排队任务不得再自动拉起 Kernel。
    this.stoppedByUser = true
    this.clearTimers()
    this.livenessCheck = null
    this.session.state = 'stopping'

    if (this.session.endpointUrl && this.secret.token) {
      await this.deps
        .requestShutdown(this.session.endpointUrl, this.secret.token, TIMEOUTS.remoteShutdownMs, this.ctx)
        .catch((error) => {
          this.log.debug('关机通知失败（忽略）', error?.message ?? error)
          return false
        })
    }
    await this.discardKernelFolder()
    this.secret = { token: null, topic: null }
    this.healthMisses = 0
    this.reconnectAttempts = 0
    this.recoveringFromReady = false
    this.recoveryStartedAt = 0

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
    this.starting = null
    this.startingEpoch = null
    const text = String(message ?? '未知错误')
    this.session.state = 'error'
    this.session.phase = null
    this.session.detail = text.split('\n')[0].slice(0, 200)
    this.session.error = { code, message: text.slice(0, 800) }
    // 失败时远端可能仍在运行（push 超时 / 隧道超时后 Kernel 还活着）：尽力通知它退出，
    // 不要等到下一个用户操作或空闲超时，白烧 GPU 配额。
    this.shutdownRemote()
    return this.snapshot()
  }
}