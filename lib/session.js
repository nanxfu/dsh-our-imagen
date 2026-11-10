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
 * 本文件只保留状态机本体与对外接口；分出去的部分：
 *  - ./session/state.js       会话快照形状、字段初始值、失败状态写入
 *  - ./session/timers.js      轮询定时器集合（Set 语义）
 *  - ./session/provisioner.js 启动编排（用户名 → kernel 目录 → push → 清理）
 *  - ./session/rendezvous.js  ntfy 会合轮询与消息解析
 *  - ./session/health.js      健康轮询、掉线恢复、Kernel 状态轮询
 *  - ./session/remote-port.js 远端出图端口（载荷构造 + 传输，供 JobQueue 使用）
 */

import { TIMEOUTS } from '../shared/contract.js'
import { kaggleUsername, kernelLogs, kernelStatus, pushKernel } from './kaggle.js'
import { buildKernelFolder, removeKernelFolder } from './kernel.js'
import { createLogger } from './log.js'
import { requestShutdown } from './remote.js'
import { startHealthLoop, pollKernelStatus } from './session/health.js'
import { runProvision, cleanupAbandonedStart, disposeKernelFolder } from './session/provisioner.js'
import { pollTunnel } from './session/rendezvous.js'
import { ACTIVE_STATES, createSessionFields, emptySession, snapshotOf, writeFailure } from './session/state.js'
import { clearTimers as clearAllTimers, every as everyTimer } from './session/timers.js'

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
      ...options,
    }
    // 字段初始值来自 state.js，但仍挂在实例上（测试直接断言这些字段）。
    Object.assign(this, createSessionFields(this.options))
  }

  snapshot() {
    return snapshotOf(this.session)
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
    return everyTimer(this.timers, this.log, fn, ms)
  }

  clearTimers() {
    clearAllTimers(this.timers)
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
    // 不能被上一轮尚未结束的启动承诺挡住。
    if (this.starting && this.startingEpoch === this.epoch) return this.starting

    // 用户主动启动（面板「唤起」/Agent start）清除「已关机」标记。
    this.stoppedByUser = false
    const epoch = (this.epoch += 1)
    this.startingEpoch = epoch
    this.starting = runProvision(this, presetId, epoch).finally(() => {
      if (this.startingEpoch === epoch) {
        this.starting = null
        this.startingEpoch = null
      }
    })
    return this.starting
  }

  /**
   * 作废的启动流程只做清理：删掉本次的临时 Kernel 目录（内含 token），
   * 不写任何会话状态、不挂定时器，返回当前（可能已是新一轮/已关机）的快照。
   */
  async abandonStart(folderDir) {
    return cleanupAbandonedStart(this, folderDir)
  }

  /**
   * 丢弃本次会话的临时 Kernel 目录（目录内的 daemon.py 含 token）。
   * push 失败与 stop 都必须清理，避免 token 长期留在系统临时目录。
   */
  async discardKernelFolder() {
    return disposeKernelFolder(this)
  }

  // ---- 轮询接线 -----------------------------------------------------------

  /** 会合阶段：轮询隧道地址 + 低频查 Kernel 状态。 */
  watch() {
    this.clearTimers()
    this.every(() => pollTunnel(this), this.options.tickMs)
    this.every(() => pollKernelStatus(this), this.options.kernelPollMs)
  }

  elapsedMs() {
    const started = this.session.startedAt ? Date.parse(this.session.startedAt) : Date.now()
    return Date.now() - started
  }

  /** 隧道就绪后的健康轮询（实现在 session/health.js）。 */
  startHealthLoop() {
    return startHealthLoop(this)
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

    this.session = emptySession(this.options)
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
    writeFailure(this.session, code, message)
    // 失败时远端可能仍在运行（push 超时 / 隧道超时后 Kernel 还活着）：尽力通知它退出，
    // 不要等到下一个用户操作或空闲超时，白烧 GPU 配额。
    this.shutdownRemote()
    return this.snapshot()
  }
}