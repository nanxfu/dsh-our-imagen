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
 *
 * 状态机本体（启动编排、会合轮询、健康轮询、定时器管理）都在本类里；只把纯数据
 * 与纯协议逻辑留在 ./session/ 下，便于离线断言：
 *  - ./session/state.js       会话快照形状、字段初始值、失败状态写入、隧道通道归一
 *  - ./session/persistence.js 会话记录的原子读写（`.imagen/session.json`）
 *  - ./session/provisioner.js 下发给 daemon 的注入配置（纯函数）
 *  - ./session/rendezvous.js  ntfy 会合消息解析与超时判定（纯函数）
 *  - ./session/health.js      /health 响应解释与掉线恢复决策（纯函数）
 *
 * 会话记录用于 DSH 重启 / 插件热重载后的恢复：启动流程在关键节点把 kernelId、token、
 * topic、endpoint 等写入工作区，`restore()` 在下次启动时先探活、再决定重连或清理远端，
 * 避免内存状态丢失后 Kaggle GPU 继续空烧配额。token 只落盘，不进日志、不进快照。
 */

import { randomBytes } from 'node:crypto'

import { TIMEOUTS } from '../shared/contract.js'
import { kaggleUsername, kernelLogs, kernelStatus, pushKernel } from './kaggle.js'
import { buildKernelFolder, randomSlug, removeKernelFolder } from './kernel.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'
import { fetchHealth, isTrustedEndpoint, requestShutdown } from './remote.js'
import { decideReadyHealthLoss, describeHealthPhase, isKernelEnded } from './session/health.js'
import {
  buildSessionRecord,
  clearSessionRecord,
  readSessionRecord,
  writeSessionRecord,
} from './session/persistence.js'
import { buildKernelConfig } from './session/provisioner.js'
import { describeProvisionTimeout, mapRendezvousError, parseRendezvousLine, rendezvousUrl } from './session/rendezvous.js'
import {
  ACTIVE_STATES,
  createSessionFields,
  emptySession,
  formatDuration,
  isoNow,
  normalizeTunnelProvider,
  snapshotOf,
  writeFailure,
} from './session/state.js'

// 时序与阈值统一取自 shared/contract.js 的 TIMEOUTS（唯一来源），本文件不再保留默认值：
//  - kernelPollMs：ready 之后仍要低频轮询 Kernel 状态 —— daemon 空闲退出 / 被平台回收时，
//    只有 Kernel 状态能证明会话已经结束（隧道断了 health 只是失败，不说明原因）；
//  - readyHealthMissesBeforeCheck：ready 阶段心跳连续失败多少次才去查 Kernel，避免一次网络抖动就重置隧道；
//  - reconnectMaxAttempts：ready 阶段允许的「重取隧道地址」轮数；超过即判定会话失效，不再无限抖动；
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

/** 轮询期间的会话记录写盘节流：状态没变化时不值得每拍都写一次文件。 */
const PERSIST_THROTTLE_MS = 60 * 1000

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
      ntfyBase: 'https://ntfy.sh',
      devEndpoint: null,
      devToken: null,
      sourcePath: null,
      enableGpu: true,
      // 备用隧道（自建 FRP 等）的域名后缀，用于 Host 侧校验会合地址可信。
      trustedTunnelDomains: [],
      ...options,
    }
    // 字段初始值来自 state.js，但仍挂在实例上（测试直接断言这些字段）。
    Object.assign(this, createSessionFields(this.options))
    // 轮询单飞表：同一轮询上一拍还在飞时复用同一个 Promise（见 singleFlight）。
    this.polling = new Map()
  }

  snapshot() {
    const value = snapshotOf(this.session)
    // 用户主动关机标记：客户端据此区分「从未启动」与「已手动关闭」，不再承诺自动启动。
    value.stoppedByUser = this.stoppedByUser === true
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

  /**
   * 挂一个轮询循环：上一拍的 Promise settle 后才安排下一拍（单飞自调度延时链）。
   *
   * 不用 setInterval：网络慢或 kaggle.exe 慢时，固定间隔会让下一拍与上一拍重叠执行、
   * 叠加子进程。这里每拍结束后才排下一次，且 handle.active 由 clearTimers() 关闭，
   * 保证 clearTimers() 之后即使正在飞的一拍结束也不会重新排期。
   * 返回的句柄放进 this.timers（每个循环 1 个条目），clearTimers() 统一取消。
   */
  every(fn, ms) {
    const handle = { timer: null, active: true }
    const tick = () => {
      handle.timer = null
      if (!handle.active) return
      Promise.resolve()
        .then(fn)
        .catch((error) => this.log.warn('轮询异常（已忽略，状态保持不变）', error?.message ?? error))
        .then(() => {
          if (!handle.active) return
          handle.timer = setTimeout(tick, ms)
        })
    }
    handle.timer = setTimeout(tick, ms)
    this.timers.add(handle)
    return handle
  }

  clearTimers() {
    for (const handle of this.timers) {
      handle.active = false
      if (handle.timer) clearTimeout(handle.timer)
    }
    this.timers.clear()
  }

  /**
   * 轮询单飞：同名轮询上一拍还在飞时复用同一个 Promise，避免立即首拍与已排期的一拍
   * （或切换轮询节奏时残留的一拍）重叠执行。
   *
   * 异常原样上抛给 every() 的 catch 记录 warn，不在这里吞掉；finally 清掉占位，
   * 保证某一拍失败后，后续拍不会被「永远在飞」的旧 Promise 挡住。
   */
  singleFlight(name, run) {
    const pending = this.polling.get(name)
    if (pending) return pending
    const promise = Promise.resolve()
      .then(run)
      .finally(() => {
        if (this.polling.get(name) === promise) this.polling.delete(name)
      })
    this.polling.set(name, promise)
    return promise
  }

  // ---- 本地持久化 ---------------------------------------------------------

  /**
   * 把当前会话关键字段写入 `<workspace>/.imagen/session.json`。
   *
   * 轮询中默认按 60s 节流（force 用于启动流程的关键节点）。写入失败只记 debug：
   * 记录只是恢复的辅助信息，不能反过来影响会话状态机。返回写入链，便于测试等待。
   */
  persistSession({ force = false } = {}) {
    const now = Date.now()
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return this.persistChain
    const record = buildSessionRecord(this.session, this.secret)
    if (!record) return this.persistChain
    this.lastPersistAt = now
    this.persistChain = this.persistChain
      .then(() => writeSessionRecord(this.ctx, record))
      .catch((error) => {
        this.log.debug('会话记录写入失败（不影响会话状态）', error?.message ?? error)
      })
    return this.persistChain
  }

  /** 删除本地会话记录（best-effort）。先等挂起的写入结束，避免删除后被迟到的写入复活。 */
  clearPersistedSession() {
    return Promise.resolve(this.persistChain)
      .catch(() => undefined)
      .then(() => clearSessionRecord(this.ctx))
  }

  dispose() {
    this.disposed = true
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    this.clearTimers()
    // DSH 退出 / 插件热重载前尽力通知远端退出，否则 Kernel 会继续烧每周 GPU 配额。
    // 不 await：卸载路径必须立刻返回；关机成功才删本地记录，失败保留给下次启动再清理。
    const pending = this.shutdownRemote()
    this.disposeCleanup = Promise.resolve(pending)
      .then((ok) => (ok ? this.clearPersistedSession() : null))
      .catch((error) => {
        this.log.debug('卸载时清理会话记录失败（忽略）', error?.message ?? error)
        return null
      })
  }

  /**
   * 通知远端关机（best-effort，不阻塞）。
   * 返回是否送达：`dispose()` 据此决定能不能删掉本地会话记录。
   */
  shutdownRemote() {
    const endpoint = this.session.endpointUrl
    const token = this.secret.token
    if (!endpoint || !token) return Promise.resolve(false)
    try {
      const pending = this.deps.requestShutdown(endpoint, token, TIMEOUTS.remoteShutdownMs, this.ctx)
      return Promise.resolve(pending).then(
        (ok) => Boolean(ok),
        (error) => {
          this.log.debug('best-effort 关机通知失败', error?.message ?? error)
          return false
        },
      )
    } catch (error) {
      // best-effort：关机通知失败不影响本地状态机。
      this.log.debug('best-effort 关机通知异常', error?.message ?? error)
      return Promise.resolve(false)
    }
  }

  // ---- 启动 ---------------------------------------------------------------

  async start(presetId = this.defaultPreset) {
    if (ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    // 同一代次的启动只允许一份；stop 之后代次变化，新的 start 必须重新发起，
    // 不能被上一轮尚未结束的启动承诺挡住。
    if (this.starting && this.startingEpoch === this.epoch) return this.starting

    // 用户主动启动（面板「唤起」/Agent start）清除「已关机」标记。
    this.stoppedByUser = false
    const epoch = (this.epoch += 1)
    this.startingEpoch = epoch
    this.starting = this.provision(presetId, epoch).finally(() => {
      if (this.startingEpoch === epoch) {
        this.starting = null
        this.startingEpoch = null
      }
    })
    return this.starting
  }

  /**
   * 跑一次启动流程；返回快照。任何异常都在内部收敛为可重试的 error 状态。
   *
   * @param {string} presetId 预设 id
   * @param {number} epoch 本次启动的代次
   */
  async provision(presetId, epoch) {
    let folderDir = null
    try {
      this.clearTimers()
      this.healthMisses = 0
      this.reconnectAttempts = 0
      this.livenessCheck = null
      this.recoveringFromReady = false
      this.recoveryStartedAt = 0
      this.session = emptySession(this.options)
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
          // 预挂载 Kaggle Dataset（P2.1）：由 kernel-metadata 的 dataset_sources 挂到
          // /kaggle/input，权重目录映射见 options.localModels → daemon 的 local_models。
          datasetSources: this.options.datasetSources ?? [],
          config: buildKernelConfig({
            presetId,
            token,
            topic,
            idleTimeoutSec: this.options.idleTimeoutSec,
            // 冷启动加固与备用通道（P1.2 / P2.2）的注入项；空值由 provisioner 省略。
            hfToken: this.options.hfToken,
            pipConstraints: this.options.pipConstraints,
            fallbackTunnelCommand: this.options.fallbackTunnelCommand,
            fallbackTunnelUrlRegex: this.options.fallbackTunnelUrlRegex,
            localModels: this.options.localModels,
          }),
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
      // 推送前先落盘：push 成功后 Host 崩溃/重载，也能凭 kernelId + topic 找回会话。
      this.persistSession({ force: true })

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
      this.persistSession({ force: true })
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

  // ---- 会合轮询 -----------------------------------------------------------

  /** 会合阶段：轮询隧道地址 + 低频查 Kernel 状态。 */
  watch() {
    this.clearTimers()
    this.every(() => this.pollTunnel(), this.options.tickMs)
    this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
  }

  elapsedMs() {
    const started = this.session.startedAt ? Date.parse(this.session.startedAt) : Date.now()
    return Date.now() - started
  }

  /** 会合轮询的一拍：超时判定与 ntfy 消息处理。 */
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
        `隧道失联后 ${formatDuration(this.options.recoveryTimeoutMs)}内未能重新会合（Kernel 状态 ${this.session.kernelStatus ?? '未知'}），请点「唤醒」重新启动会话`,
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
      const decision = describeProvisionTimeout({
        kernelStatus: this.session.kernelStatus,
        provisionTimeoutMs: this.options.provisionTimeoutMs,
        logTail: tail,
      })
      this.fail(decision.code, decision.message)
      return
    }
    if (this.session.state === 'connecting' && this.elapsedMs() > this.options.provisionTimeoutMs + this.options.tunnelTimeoutMs) {
      if (this.isStale(epoch)) return
      this.fail('tunnel_timeout', '隧道握手超时：Kernel 已启动但未拿到可访问地址，请点「唤醒」重试或查看远端日志')
      return
    }

    const url = rendezvousUrl(this.options.ntfyBase, this.secret.topic)
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
      const parsed = parseRendezvousLine(trimmed)
      if (parsed.kind === 'invalid-event') {
        this.log.warn('会合消息不是合法 JSON（协议可能已漂移）', parsed.error?.message ?? parsed.error)
        continue
      }
      if (parsed.kind === 'skip') continue
      if (parsed.kind === 'invalid-payload') {
        this.log.warn('会合消息负载解析失败（协议可能已漂移）', parsed.error?.message ?? parsed.error)
        continue
      }
      const payload = parsed.payload
      if (payload?.type === 'error') {
        // daemon 在隧道/依赖/预加载失败时会先发 error 事件再退出。
        // 以前这里只认 ready，导致 Host 一直等到 45 分钟 queue_timeout，归因完全错误。
        const decision = mapRendezvousError(payload)
        this.fail(decision.code, decision.message)
        return
      }
      if (payload?.type !== 'ready') continue
      if (!isTrustedEndpoint(payload.endpoint, this.options.trustedTunnelDomains)) continue
      // 幂等：并发的两次轮询可能拿到同一条 ready，已在握手中的 endpoint 不重复处理。
      if (this.session.endpointUrl === payload.endpoint) continue

      this.session.endpointUrl = payload.endpoint
      this.session.modelId = payload.model_id ?? this.session.modelId
      this.session.device = payload.device ?? this.session.device
      this.session.tunnelProvider = normalizeTunnelProvider(payload.provider)
      this.session.state = 'connecting'
      this.session.phase = 'tunnel'
      this.session.detail = '隧道已建立，正在握手'
      this.persistSession({ force: true })
      this.startHealthLoop()
      return
    }
  }

  // ---- 健康轮询与掉线恢复 -------------------------------------------------

  /** 挂上健康轮询与 Kernel 状态轮询，并立刻打第一拍。 */
  startHealthLoop() {
    this.clearTimers()
    this.every(() => this.pollHealth(), this.options.tickMs)
    this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
    void this.pollHealth()
  }

  /** 健康轮询入口（单飞）：立即首拍与已排期的一拍不会重叠。 */
  pollHealth() {
    return this.singleFlight('health', () => this.checkHealth())
  }

  async checkHealth() {
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
            `重新获取隧道地址后仍无法握手（已等待 ${formatDuration(waited)}，Kernel 状态 ${this.session.kernelStatus ?? '未知'}），请点「唤醒」重试`,
          )
          return
        }
        this.session.detail = '重新获取隧道地址后仍在重试握手'
      } else if (this.healthMisses >= 5) {
        // 隧道可能重建：回到等待上报状态重新取地址（与 watch() 的接线完全一致）。
        this.healthMisses = 0
        this.session.endpointUrl = null
        this.session.state = 'connecting'
        this.session.phase = 'tunnel'
        this.session.detail = '隧道失联，正在重新获取地址'
        this.watch()
      } else if (this.healthMisses >= 3) {
        this.session.detail = '远端心跳丢失，正在重连'
      }
      return
    }

    const wasReady = this.session.state === 'ready'
    this.applyHealthDetails(health)
    this.applyHealthState(health)
    // 进入 ready 是关键节点（轮询节奏切换），立即落盘；其余信息按 60s 节流。
    if (this.session.state === 'ready' && !wasReady) this.persistSession({ force: true })
    else if (this.session.state !== 'error') this.persistSession()
  }

  /** 把 /health 里的设备、模型与隧道通道写进快照（不涉及 token）。 */
  applyHealthDetails(health) {
    this.session.lastProbeAt = isoNow()
    if (health?.device) this.session.device = health.device
    if (health?.device_count != null) this.session.deviceCount = health.device_count
    if (health?.model_id) this.session.modelId = health.model_id
    if (health?.idle_timeout_sec) this.session.idleTimeoutSec = health.idle_timeout_sec
    if (health?.tunnel_provider !== undefined) {
      this.session.tunnelProvider = normalizeTunnelProvider(health.tunnel_provider)
    }
  }

  /** 依据 /health 的 phase 推进会话状态，并在进入 ready 时切换轮询节奏。 */
  applyHealthState(health) {
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
    this.session.detail = describeHealthPhase(health)
    if (health?.phase === 'error') {
      this.fail('remote_error', `远端进入错误状态：${String(health?.last_error ?? '未知').slice(0, 700)}`)
    }
  }

  /**
   * ready 阶段连续心跳失败后的恢复决策执行：
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
        if (status) {
          this.session.kernelStatus = status
          this.persistSession()
        }
        const action = decideReadyHealthLoss(status, this.reconnectAttempts, TIMEOUTS.reconnectMaxAttempts)
        if (action === 'ended') {
          const logs = await this.deps.kernelLogs(this.ctx, kernelId).catch((error) => {
            this.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', error?.message ?? error)
            return null
          })
          if (!this.canPoll(epoch)) return
          const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
          if (status === 'ERROR') {
            this.fail('remote_error', `Kernel 已结束（ERROR），远端异常退出${tail}`)
          } else {
            this.fail('session_ended', `Kernel 已结束（${status}），点「唤醒」可重新启动会话${tail}`)
          }
          return
        }
        if (action === 'giveUp') {
          this.fail(
            'health_failed',
            `远端心跳连续丢失，且 Kernel 状态为 ${status ?? '未知'}；隧道可能已失效，请点「唤醒」重试`,
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
        this.watch()
      } finally {
        this.livenessCheck = null
      }
    })()
    return this.livenessCheck
  }

  /** Kernel 状态轮询入口（单飞）：kaggle CLI 慢时避免叠加子进程。 */
  pollKernelStatus() {
    return this.singleFlight('kernel', () => this.checkKernelStatus())
  }

  async checkKernelStatus() {
    if (this.disposed || !this.session.kernelId) return
    const epoch = this.epoch
    const kernelId = this.session.kernelId
    const result = await this.deps.kernelStatus(this.ctx, kernelId).catch((error) => {
      this.log.debug('轮询 Kernel 状态失败（下一拍重试）', error?.message ?? error)
      return null
    })
    if (!this.canPoll(epoch)) return
    if (!result?.ok) return
    if (result.status && result.status !== this.session.kernelStatus) {
      this.session.kernelStatus = result.status
      // Kernel 状态是恢复时判断「要不要清理远端」的关键依据，变化时按节流落盘。
      this.persistSession()
    }

    if (!isKernelEnded(result.status)) return

    const logs = await this.deps.kernelLogs(this.ctx, kernelId).catch((error) => {
      this.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', error?.message ?? error)
      return null
    })
    if (!this.canPoll(epoch)) return

    const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
    // ready 状态下结束通常是空闲退出或远端崩溃；其余阶段结束说明启动没成功。
    if (result.status !== 'ERROR' && this.session.state === 'ready') {
      this.fail('session_ended', `Kernel 已结束（${result.status}），点「唤醒」可重新启动会话${tail}`)
    } else {
      this.fail('remote_error', `Kernel 已结束（${result.status}）${tail}`)
    }
  }

  // ---- 停止 ---------------------------------------------------------------

  async stop() {
    const before = this.session.state
    const kernelId = this.session.kernelId
    // 递增代次：在飞的启动 / 轮询从这一刻起全部失效，不能再写回状态或挂定时器。
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    // 「用户已关机」标记保持到下一次 start 清除；排队任务不得再自动拉起 Kernel。
    this.stoppedByUser = true
    this.clearTimers()
    this.livenessCheck = null
    this.session.state = 'stopping'

    // 关机通知：优先用内存里的连接信息；内存里没有（例如上次进程留下的记录还没被
    // restore() 接管）时从记录里取一次，尽力关掉远端，别让 Kernel 继续烧配额。
    let shutdownEndpoint = this.session.endpointUrl
    let shutdownToken = this.secret.token
    if (!shutdownEndpoint || !shutdownToken) {
      const record = await readSessionRecord(this.ctx)
      if (record && isTrustedEndpoint(record.endpointUrl, this.options.trustedTunnelDomains)) {
        shutdownEndpoint = record.endpointUrl
        shutdownToken = record.token
      }
    }
    if (shutdownEndpoint && shutdownToken) {
      await this.deps
        .requestShutdown(shutdownEndpoint, shutdownToken, TIMEOUTS.remoteShutdownMs, this.ctx)
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

    this.session = emptySession(this.options)
    this.session.detail =
      before === 'provisioning'
        ? `已放弃跟踪；Kernel ${kernelId ?? ''} 仍在 Kaggle 侧排队，可在网页端停止`
        : before === 'absent'
          ? null
          : '已关机'
    // 用户主动关机后不再需要启动恢复；记录里的 token 也一并从磁盘清掉。
    await this.clearPersistedSession()
    return this.snapshot()
  }

  // ---- 启动恢复 -----------------------------------------------------------

  /**
   * 从 `<workspace>/.imagen/session.json` 恢复上次运行中的会话。
   *
   * 恢复成功的判定顺序：
   *   1. endpoint 探活成功 → 直接接管会话（ready 用健康轮询，warming/installing 用会合轮询）；
   *   2. endpoint 不通但有 topic → 回会合点重新取隧道地址（Kernel 可能已重建隧道）；
   *   3. 没有 endpoint/topic 或 Kernel 已结束 → 尽力关机并清理记录。
   * 没有记录、记录损坏、开发模式或被 start()/stop() 作废时返回 null。
   *
   * 与启动代次共存：恢复期间用户 start/stop 会递增 epoch，过期恢复不写状态、不挂定时器。
   */
  async restore() {
    if (this.disposed) return null
    // 开发模式直连本地 Daemon：本地进程没有 Kaggle 配额风险，不恢复历史远端会话。
    if (this.options.devEndpoint) return null
    if (this.restoring) return this.restoring

    const run = this.runRestore().finally(() => {
      if (this.restoring === run) this.restoring = null
    })
    this.restoring = run
    return run
  }

  async runRestore() {
    // 已有活跃会话（用户先手 start 或上一次恢复）时不覆盖。
    if (ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    const record = await readSessionRecord(this.ctx)
    if (!record) return null
    const epoch = this.epoch
    if (this.isStale(epoch)) return this.snapshot()

    // 不可信地址不发 token：既不做探活，也不做关机通知（防止会合消息/记录被篡改后泄露凭据）。
    const endpoint = isTrustedEndpoint(record.endpointUrl, this.options.trustedTunnelDomains)
      ? record.endpointUrl
      : null
    let health = null
    if (endpoint) {
      health = await fetchHealth(endpoint, record.token, undefined, this.ctx).catch((error) => {
        // 地址不可达是恢复的常见路径（隧道重建/进程重启），交给 topic 重新会合。
        this.log.debug('恢复时会话地址探活失败，尝试重新会合', error?.message ?? error)
        return null
      })
      if (this.isStale(epoch) || ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    }

    if (health) {
      this.applyRecord(record, endpoint)
      this.clearTimers()
      this.applyHealthDetails(health)
      if (health.phase === 'ready') {
        this.applyHealthState(health)
        this.session.detail = '已从本地记录恢复会话'
      } else {
        // warming / installing：保持会合轮询节奏，让现有心跳逻辑继续推进到 ready。
        this.every(() => this.pollHealth(), this.options.tickMs)
        this.every(() => this.pollKernelStatus(), this.options.kernelPollMs)
        this.applyHealthState(health)
      }
      this.persistSession({ force: true })
      return this.snapshot()
    }

    // 地址不可用又没有任何会合信息：远端已无法利用，清理记录避免每次启动重复尝试。
    if (!record.topic) {
      return this.cleanupRecordedSession(record, endpoint, epoch, '已清理上次中断的会话记录')
    }

    // 有 topic：先确认 Kernel 是否还活着，已结束就不必再等会合（仍尽力通知远端退出）。
    const status = record.kernelId
      ? await this.deps.kernelStatus(this.ctx, record.kernelId).catch((error) => {
          this.log.debug('恢复时查询 Kernel 状态失败（按未知处理）', error?.message ?? error)
          return null
        })
      : null
    if (this.isStale(epoch) || ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    const kernelStatus = status?.ok ? status.status : record.kernelStatus
    if (isKernelEnded(kernelStatus)) {
      return this.cleanupRecordedSession(record, endpoint, epoch, '上次会话的 Kernel 已结束，已清理本地记录')
    }

    // Kernel 可能仍在运行：回会合点重新取隧道地址。按新会话重新计时，
    // 旧 startedAt 可能早已超过排队/隧道超时窗口，不能再用它判定超时。
    this.applyRecord(record, null)
    this.session.kernelStatus = kernelStatus
    this.session.state = 'connecting'
    this.session.phase = 'tunnel'
    this.session.detail = '正在重新会合已保存的会话'
    this.session.startedAt = isoNow()
    this.session.readyAt = null
    this.watch()
    this.persistSession({ force: true })
    return this.snapshot()
  }

  /** 把本地记录里的会话字段写回实例；endpoint 为 null 表示需要重新会合。 */
  applyRecord(record, endpoint) {
    this.secret = { token: record.token, topic: record.topic }
    this.session = {
      ...emptySession(this.options),
      presetId: record.presetId ?? this.defaultPreset,
      kernelId: record.kernelId,
      kernelUrl: record.kernelUrl,
      kernelStatus: record.kernelStatus,
      endpointUrl: endpoint,
      device: record.device,
      deviceCount: record.deviceCount,
      modelId: record.modelId,
      tunnelProvider: record.tunnelProvider,
      startedAt: record.startedAt ?? isoNow(),
      readyAt: record.readyAt,
      idleTimeoutSec: record.idleTimeoutSec ?? this.options.idleTimeoutSec,
      state: 'connecting',
      phase: 'tunnel',
      detail: '正在恢复已保存的会话',
    }
    this.healthMisses = 0
    this.reconnectAttempts = 0
    this.livenessCheck = null
    this.recoveringFromReady = false
    this.recoveryStartedAt = 0
    this.stoppedByUser = false
  }

  /**
   * 恢复时确认远端不可再用：尽力关机（仅对已确认可信的地址发送 token）并删除记录。
   * 恢复过程被 start()/stop() 作废时不清理，避免误删新一轮会话刚写下的记录。
   */
  async cleanupRecordedSession(record, endpoint, epoch, detail) {
    if (this.isStale(epoch)) return null
    if (endpoint && record.token) {
      await Promise.resolve()
        .then(() => this.deps.requestShutdown(endpoint, record.token, TIMEOUTS.remoteShutdownMs, this.ctx))
        .catch((error) => {
          this.log.debug('恢复清理时关机通知失败（忽略）', error?.message ?? error)
          return false
        })
      if (this.isStale(epoch)) return null
    }
    await this.clearPersistedSession()
    if (this.isStale(epoch)) return null
    this.session.detail = detail
    return null
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
    writeFailure(this.session, code, message)
    // 记录保留：失败/超时后远端 Kernel 可能仍在运行，下次启动 restore() 才能据此清理。
    this.persistSession({ force: true })
    // 失败时远端可能仍在运行（push 超时 / 隧道超时后 Kernel 还活着）：尽力通知它退出，
    // 不要等到下一个用户操作或空闲超时，白烧 GPU 配额。
    this.shutdownRemote()
    return this.snapshot()
  }
}