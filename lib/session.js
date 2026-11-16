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
 * 状态机本体（启动编排、定时器与代次管理、停止与失败收敛）在本类里，
 * 协作者与纯数据/纯协议逻辑拆分在 ./session/ 下，便于按职责阅读与离线断言：
 *  - ./session/state.js           会话快照形状、字段初始值、失败状态写入、隧道通道归一
 *  - ./session/persistence.js     会话记录的原子读写（`.imagen/session.json`）
 *  - ./session/pending-cleanup.js 卸载未关机补清理记录（`.imagen/pending-cleanup.json`）
 *  - ./session/provisioner.js     下发给 daemon 的注入配置（纯函数）
 *  - ./session/rendezvous.js      ntfy 会合消息解析与超时判定（纯函数）
 *  - ./session/health.js          /health 响应解释与掉线恢复决策（纯函数）
 *  - ./session/tunnel-watcher.js  ntfy 会合轮询与建连超时监控
 *  - ./session/health-monitor.js  /health 心跳探活、掉线恢复与 Kernel 状态轮询
 *  - ./session/restorer.js        启动恢复与 pending-cleanup 补关机
 *
 * 会话记录用于 DSH 重启 / 插件热重载后的恢复：启动流程在关键节点把 kernelId、token、
 * topic、endpoint 等写入工作区，`restore()` 在下次启动时先探活、再决定重连或清理远端，
 * 避免内存状态丢失后 Kaggle GPU 继续空烧配额。token 只落盘，不进日志、不进快照。
 *
 * 卸载路径的取舍：`dispose()` 不阻塞卸载，关机通知只是 best-effort；通知没发出或失败时，
 * 同步把「待清理会话」写入工作区，下次启动由 `cleanupPendingSession()` 先补发一次关机，
 * 再执行 `restore()`，避免 Kernel 空烧每周 GPU 配额。
 */

import { randomBytes } from 'node:crypto'

import { SETTINGS, TIMEOUTS } from '../shared/contract.js'
import { kaggleUsername, kernelLogs, kernelStatus, pushKernel } from './kaggle.js'
import { buildKernelFolder, randomSlug, removeKernelFolder } from './kernel.js'
import { createLogger } from './log.js'
import { logText } from './redact.js'
import { isTrustedEndpoint, requestShutdown } from './remote.js'
import { isKernelAlive, isKernelQueued } from './session/health.js'
import { applyHealthDetails as writeHealthDetails, applyHealthState as writeHealthState, checkHealth, checkKernelStatus } from './session/health-monitor.js'
import { buildSessionRecord, clearSessionRecord, readSessionRecord, writeSessionRecord } from './session/persistence.js'
import { buildPendingCleanupRecord, clearPendingCleanup, writePendingCleanupSync } from './session/pending-cleanup.js'
import { buildKernelConfig } from './session/provisioner.js'
import { cleanupPendingSession as runPendingCleanup, runRestore as executeRestore } from './session/restorer.js'
import { ACTIVE_STATES, createSessionFields, emptySession, isoNow, snapshotOf, writeFailure } from './session/state.js'
import { pollTunnel as watchTunnel } from './session/tunnel-watcher.js'

// 时序与阈值统一取自 shared/contract.js 的 TIMEOUTS（唯一来源），本文件不再保留默认值：
//  - kernelPollMs：ready 之后仍要低频轮询 Kernel 状态 —— daemon 空闲退出 / 被平台回收时，
//    只有 Kernel 状态能证明会话已经结束（隧道断了 health 只是失败，不说明原因）；
//  - readyHealthMissesBeforeCheck：ready 阶段心跳连续失败多少次才去查 Kernel，避免一次网络抖动就重置隧道；
//  - reconnectMaxAttempts：ready 阶段允许的「重取隧道地址」轮数；超过即判定会话失效，不再无限抖动；
//  - recoveryMs：ready 失联后的单轮恢复窗口；只要向 Kaggle 确认 Kernel 仍 RUNNING 就按
//    recoveryMaxRenewals 续期，续期用尽才 health_failed（不再一次超时就放弃）；
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

/**
 * 模块级日志器：会话状态机的关键事件默认从 Host 日志出口落盘（文件 sink 由 lib/log.js
 * 进程级安装，写入时查询安装状态）。测试注入 `deps.log` 时以注入的 sink 为准。
 */
const log = createLogger({ scope: 'session' })

/** 失败现场抢救的 Kernel 日志尾上限：约 30 行 / 4000 字符。 */
const KERNEL_TAIL_MAX_LINES = 30
const KERNEL_TAIL_MAX_CHARS = 4000

/**
 * 再次 start() 时允许先检查并接管原 Kernel 的错误码：
 * 仅限等待/连通类异常（远端可能仍在排队或正常运行）；push_failed / auth_required /
 * gpu_unavailable / remote_error / session_ended 均直接走新推流程。
 */
const REATTACHABLE_ERROR_CODES = new Set(['queue_timeout', 'tunnel_timeout', 'health_failed'])

/** 轮询期间的会话记录写盘节流：状态没变化时不值得每拍都写一次文件。 */
const PERSIST_THROTTLE_MS = 60 * 1000

export class SessionManager {
  constructor({ ctx, defaultPreset, options = {}, deps = {} }) {
    this.ctx = ctx
    this.defaultPreset = defaultPreset
    this.deps = { ...DEFAULT_DEPS, ...deps }
    // 测试注入 deps.log 时沿用注入 sink；生产走模块级 logger（文件 sink 由 lib/log.js 统一接管）。
    this.log = deps.log ? createLogger({ scope: 'session', sink: deps.log }) : log
    this.options = {
      accelerator: 'NvidiaTeslaT4',
      kernelTimeoutSec: TIMEOUTS.kernelRunMaxSec,
      idleTimeoutSec: TIMEOUTS.idleShutdownSec,
      provisionTimeoutMs: TIMEOUTS.provisionMs,
      tunnelTimeoutMs: TIMEOUTS.tunnelMs,
      healthyIntervalMs: TIMEOUTS.healthyPollMs,
      // ready 阶段失联后允许的重新会合时长，超过即判定会话失效。
      recoveryTimeoutMs: TIMEOUTS.recoveryMs,
      // 恢复窗口续期轮数：每次确认 Kernel 仍 RUNNING 续一轮，用尽才放弃。
      recoveryMaxRenewals: TIMEOUTS.recoveryMaxRenewals,
      // 会合/健康轮询与 Kernel 状态轮询的间隔，测试可调小以加速离线回归。
      tickMs: TIMEOUTS.sessionTickMs,
      kernelPollMs: TIMEOUTS.kernelPollMs,
      // 排队分级阈值（下发给客户端做「3 分钟软提示 / 10 分钟重排卡片」）。
      queueSlowMs: TIMEOUTS.queueSlowMs,
      queueStalledMs: TIMEOUTS.queueStalledMs,
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
    // 心跳恢复代数：每次 /health 恢复即递增，使并发中的 handleReadyHealthLoss 失效。
    this.healthEpoch = 0
    // 失败现场抢救去重：同一个 Kernel 只拉一次日志尾，避免失败路径重复打远端。
    this.rescuedKernels = new Set()
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

  /**
   * 排队分级阈值（`/state.queuePolicy` 下发客户端）。
   *
   * 两档都可以被插件配置覆盖（index.js 的 queueSlowMinutes / queueStalledMinutes）；
   * 非法值回落到契约默认值，且保证「卡住」不早于「变慢」。
   */
  queuePolicy() {
    const slow = Number(this.options.queueSlowMs)
    const stalled = Number(this.options.queueStalledMs)
    const slowMs = Number.isFinite(slow) && slow > 0 ? slow : TIMEOUTS.queueSlowMs
    const stalledMs = Number.isFinite(stalled) && stalled > 0 ? stalled : TIMEOUTS.queueStalledMs
    return { slowMs, stalledMs: Math.max(slowMs, stalledMs) }
  }

  /**
   * 删除一个已经放弃的 Kernel（best-effort）。
   *
   * 排队超时 / 主动关机 / 强制重排时调用：旧 Kernel 还留在 Kaggle 队列里，之后可能被
   * 调度到并空转（最长 idleShutdownSec）。删除后就不会再有可执行任务；删除失败只记
   * 日志，由远端 claim 超时兜底（daemon 启动后无人接管会自行退出）。
   *
   * deps.deleteKernel 未注入（离线测试）时直接跳过，不产生任何 I/O。
   *
   * @param {string | null | undefined} kernelId
   * @param {string} reason 日志归因（queue_timeout / force_new / requeue / stop_queued）
   * @returns {Promise<boolean>} 是否确认已删除（已不存在也算成功）
   */
  discardStaleKernel(kernelId, reason = 'abandoned') {
    const id = typeof kernelId === 'string' ? kernelId.trim() : ''
    if (!id || this.options.devEndpoint) return Promise.resolve(false)
    if (typeof this.deps.deleteKernel !== 'function') return Promise.resolve(false)
    return Promise.resolve()
      .then(() => this.deps.deleteKernel(this.ctx, id))
      .then((result) => {
        if (result?.ok) {
          this.log.info(`stale_kernel_deleted kernelId=${id} reason=${reason} missing=${Boolean(result.missing)}`)
          return true
        }
        this.log.warn(
          `stale_kernel_delete_failed kernelId=${id} reason=${reason} detail=${logText(result?.output ?? 'unknown', 200)}`,
        )
        return false
      })
      .catch((error) => {
        this.log.debug(`stale_kernel_delete_error kernelId=${id} reason=${reason}`, logText(error?.message ?? error, 200))
        return false
      })
  }

  // ---- 运行设置 -----------------------------------------------------------

  /**
   * 启动前读取最新合并设置（工作台设置抽屉的覆盖项 + 插件静态 config）。
   *
   * `deps.getSettings` 是可选注入：测试不传时完全沿用 this.options，行为与改造前一致。
   * 读取本身或返回值异常时整体回退 options；缺字段按字段回退，绝不让设置读取影响启动流程。
   */
  effectiveSettings() {
    const options = this.options ?? {}
    const fallbackIdle = Number.isFinite(options.idleTimeoutSec)
      ? Math.min(SETTINGS.idleTimeoutSec.max, Math.max(SETTINGS.idleTimeoutSec.min, Math.round(options.idleTimeoutSec)))
      : TIMEOUTS.idleShutdownSec
    const fallback = {
      idleTimeoutSec: fallbackIdle,
      accelerator: options.accelerator,
      hfToken: typeof options.hfToken === 'string' && options.hfToken.trim() ? options.hfToken.trim() : null,
      datasetSources: Array.isArray(options.datasetSources) ? options.datasetSources : [],
      localModels:
        options.localModels && typeof options.localModels === 'object' && !Array.isArray(options.localModels)
          ? options.localModels
          : null,
      pipConstraints: Array.isArray(options.pipConstraints) ? options.pipConstraints : [],
    }

    let raw
    try {
      raw = typeof this.deps.getSettings === 'function' ? this.deps.getSettings() : null
    } catch {
      return fallback
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback

    const idle = Number(raw.idleTimeoutSec)
    return {
      idleTimeoutSec: Number.isFinite(idle)
        ? Math.min(SETTINGS.idleTimeoutSec.max, Math.max(SETTINGS.idleTimeoutSec.min, Math.round(idle)))
        : fallback.idleTimeoutSec,
      accelerator:
        typeof raw.accelerator === 'string' && SETTINGS.accelerators.includes(raw.accelerator)
          ? raw.accelerator
          : fallback.accelerator,
      hfToken:
        raw.hfToken === undefined
          ? fallback.hfToken
          : typeof raw.hfToken === 'string' && raw.hfToken.trim()
            ? raw.hfToken.trim()
            : null,
      datasetSources: Array.isArray(raw.datasetSources)
        ? raw.datasetSources.filter((item) => typeof item === 'string')
        : fallback.datasetSources,
      localModels:
        raw.localModels === undefined
          ? fallback.localModels
          : raw.localModels && typeof raw.localModels === 'object' && !Array.isArray(raw.localModels)
            ? raw.localModels
            : null,
      pipConstraints: Array.isArray(raw.pipConstraints)
        ? raw.pipConstraints.filter((item) => typeof item === 'string')
        : fallback.pipConstraints,
    }
  }

  // ---- 状态跃迁打点 -------------------------------------------------------

  /**
   * 统一状态/阶段写入点（状态机的所有跃迁都必须经过这里）。
   *
   * 收口目的：`transition(from -> to, phase, epoch, presetId, elapsedMs)` 不漏记；
   * 日志只写状态与时长，不写 detail/错误正文，避免把 token 或用户路径带进 Host 日志。
   *
   * @param {string} nextState 目标状态
   * @param {{ phase?: string | null, elapsedMs?: number }} [options]
   *   phase 省略时保留当前阶段；显式传 null 表示进入无阶段状态。
   */
  transition(nextState, { phase = undefined, elapsedMs = undefined } = {}) {
    const from = this.session.state
    const fromPhase = this.session.phase ?? null
    this.session.state = nextState
    if (phase !== undefined) this.session.phase = phase ?? null
    const toPhase = this.session.phase ?? null
    // 状态与阶段都没变时不重复记（同一拍重复调用 transition 不应刷屏）。
    if (from === nextState && fromPhase === toPhase) return
    this.logTransition(from, nextState, { fromPhase, phase: toPhase, elapsedMs })
  }

  /** 只记一条跃迁日志：用于 `this.session` 被整体替换（stop 清理 / restore 接管记录）的场景。 */
  logTransition(from, to, { fromPhase = null, phase = null, elapsedMs = undefined } = {}) {
    const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : this.elapsedMs()
    this.log.info(
      `transition ${from ?? 'null'} -> ${to} phase=${phase ?? 'null'} fromPhase=${fromPhase ?? 'null'} ` +
        `epoch=${this.epoch} presetId=${this.session.presetId ?? this.defaultPreset ?? '-'} ` +
        `elapsedMs=${Math.max(0, Math.round(Number(elapsed) || 0))}`,
    )
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
        .catch((error) => this.log.warn('轮询异常（已忽略，状态保持不变）', logText(error?.message ?? error, 200)))
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
        this.log.debug('会话记录写入失败（不影响会话状态）', logText(error?.message ?? error, 200))
      })
    return this.persistChain
  }

  /** 删除本地会话记录（best-effort）。先等挂起的写入结束，避免删除后被迟到的写入复活。 */
  clearPersistedSession() {
    return Promise.resolve(this.persistChain)
      .catch(() => undefined)
      .then(() => clearSessionRecord(this.ctx))
  }

  /**
   * 卸载：不阻塞、不 await（卸载路径必须立刻返回）。
   *
   * 关机通知是 best-effort：先同步把「待清理会话」写入
   * `<workspace>/.imagen/pending-cleanup.json`（进程随时可能退出，异步写来不及），
   * 再尽力通知远端退出。收尾规则：
   *  - 关机成功：清掉待清理记录与会话记录；
   *  - 关机失败：保留待清理记录（下次启动优先补发一次关机），并清掉会话记录
   *    （用户明确是「退出」，不要让下次启动的 restore() 去接手 / 长等会合）；
   *  - 没有可清理信息且关机未成功：保留会话记录，交给下次启动的 restore() 兜底。
   *
   * 重复调用是幂等的（只执行第一次），测试与宿主多次卸载不会重复补发。
   */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    this.clearTimers()
    // 同步落盘：dispose() 返回后进程可能立刻退出，异步写没有机会完成。
    const record = this.pendingCleanupRecord()
    const handedOff = record ? writePendingCleanupSync(this.ctx, record) : false
    // DSH 退出 / 插件热重载前尽力通知远端退出，否则 Kernel 会继续烧每周 GPU 配额。
    const pending = this.shutdownRemote()
    this.disposeCleanup = Promise.resolve(pending)
      .then(async (ok) => {
        if (ok) await clearPendingCleanup(this.ctx)
        // 关机成功，或失败但已把「补发关机」责任移交下次启动：都删掉会话记录。
        if (ok || handedOff) await this.clearPersistedSession()
        return null
      })
      .catch((error) => {
        this.log.debug('卸载时清理本地记录失败（忽略）', logText(error?.message ?? error, 200))
        return null
      })
  }

  /**
   * 组装卸载时的待清理记录（只含补发 /shutdown 所需的最小信息）。
   *
   * 开发模式直连本地 Daemon，没有 Kaggle 配额风险，不落盘待清理记录。
   * 返回 null 表示没有可清理的远端信息（或不需要补清理）。
   */
  pendingCleanupRecord() {
    if (this.options.devEndpoint) return null
    return buildPendingCleanupRecord(this.session, this.secret)
  }

  /**
   * 通知远端关机（best-effort，不阻塞）。
   * 返回是否送达：`dispose()` 据此决定是否清掉待清理记录与会话记录。
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
          this.log.debug('best-effort 关机通知失败', logText(error?.message ?? error, 200))
          return false
        },
      )
    } catch (error) {
      // best-effort：关机通知失败不影响本地状态机。
      this.log.debug('best-effort 关机通知异常', logText(error?.message ?? error, 200))
      return Promise.resolve(false)
    }
  }

  // ---- 启动补清理 ---------------------------------------------------------

  /**
   * 启动补清理：补发上次卸载失败的关机通知，释放 Kernel 占用的每周 GPU 配额。
   * 由 index.js 在 `restore()` 之前顺序调用，避免与恢复流程抢同一个远端会话。
   *
   * @returns {Promise<boolean | null>} null=无记录；true=补发成功；false=失败/已丢弃
   */
  cleanupPendingSession() {
    return runPendingCleanup(this)
  }

  // ---- 启动 ---------------------------------------------------------------

  async start(presetId = this.defaultPreset, { forceNew = false, replace = false } = {}) {
    // replace=true 是「换新实例重排」：允许在 provisioning/connecting 等活跃状态下强制
    // 放弃当前会话并重新推送一个 Kernel（普通 start 命中活跃态直接返回快照，保持幂等）。
    if (!replace && ACTIVE_STATES.has(this.session.state)) return this.snapshot()
    // 同一代次的启动只允许一份；stop 之后代次变化，新的 start 必须重新发起，
    // 不能被上一轮尚未结束的启动承诺挡住。
    if (!replace && this.starting && this.startingEpoch === this.epoch) return this.starting

    // 用户主动启动（面板「唤起」/Agent start）清除「已关机」标记。
    this.stoppedByUser = false
    // 重排前先放弃当前会话（清理旧 Kernel），与后续 push 用同一个代次递增序列。
    if (replace) await this.abandonActiveSession('requeue')
    const epoch = (this.epoch += 1)
    this.startingEpoch = epoch
    this.starting = this.provision(presetId, epoch, { forceNew: forceNew || replace }).finally(() => {
      if (this.startingEpoch === epoch) {
        this.starting = null
        this.startingEpoch = null
      }
    })
    return this.starting
  }

  /**
   * 放弃当前会话（「换新实例重排」专用）：停掉轮询与在飞流程，清理旧 Kernel。
   *
   * 与 stop() 的区别：**不置 stoppedByUser**。排队中的任务看到会话进入新一轮
   * provisioning 后继续等待，不会因为这次重排被判 stopped。
   */
  async abandonActiveSession(reason = 'requeue') {
    const before = this.session.state
    const kernelId = this.session.kernelId
    const endpoint = this.session.endpointUrl
    const token = this.secret.token
    // 递增代次：在飞的 push / 轮询从这一刻起全部失效，不能再写回旧会话状态。
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    this.clearTimers()
    this.livenessCheck = null
    this.healthMisses = 0
    this.reconnectAttempts = 0
    this.recoveringFromReady = false
    this.recoveryStartedAt = 0
    this.recoveryRenewals = 0
    this.recoveryBeganAt = 0
    this.log.info(`session_abandon from=${before} kernelId=${kernelId ?? 'none'} reason=${reason}`)

    // 已经建立隧道：先尽力通知远端退出（排队阶段没有 endpoint，直接跳过）。
    if (endpoint && token) {
      const ok = await this.deps
        .requestShutdown(endpoint, token, TIMEOUTS.remoteShutdownMs, this.ctx)
        .catch((error) => {
          this.log.debug('放弃会话时远端关机通知失败（忽略）', logText(error?.message ?? error, 200))
          return false
        })
      if (!ok) this.log.debug('放弃会话时远端关机未送达，继续清理 Kernel')
    }
    // 无论哪个阶段都删除旧 Kernel：排队条目留在 Kaggle 队列里可能之后才被调度到，
    // 不删就会空转烧配额（远端 claim 超时是第二道兜底）。
    if (kernelId) void this.discardStaleKernel(kernelId, reason)

    this.secret = { token: null, topic: null }
    this.session = emptySession(this.options)
    this.logTransition(before, 'absent', { phase: null })
    await this.clearPersistedSession()
  }

  /**
   * 从当前错误态提取可检查接管的旧 Kernel 信息；不满足条件返回 null。
   * 仅当 error 态下确实保留了已推送成功的 kernelId + token + topic 时才尝试接管。
   */
  reattachCandidate(fallbackPresetId) {
    if (this.options.devEndpoint) return null
    if (this.session.state !== 'error') return null
    const errorCode = this.session.error?.code ?? null
    if (!REATTACHABLE_ERROR_CODES.has(errorCode)) return null
    if (!this.session.kernelId || !this.secret.token || !this.secret.topic) return null
    return {
      kernelId: this.session.kernelId,
      kernelUrl: this.session.kernelUrl,
      kernelStatus: this.session.kernelStatus,
      presetId: this.session.presetId ?? fallbackPresetId,
      idleTimeoutSec: this.session.idleTimeoutSec ?? this.options.idleTimeoutSec,
      errorCode,
      token: this.secret.token,
      topic: this.secret.topic,
    }
  }

  /**
   * 唤醒前检查并尝试接管仍在 Kaggle 排队或运行中的旧 Kernel，避免盲目推送第二个
   * 随机 slug 导致孤儿队列浪费配额。
   *
   * @returns {Promise<{ kind: 'reattached', snapshot: object } | { kind: 'stale' } | { kind: 'push_new' }>}
   */
  async tryReattachCandidate(candidate, epoch) {
    this.clearTimers()
    this.healthMisses = 0
    this.reconnectAttempts = 0
    this.livenessCheck = null
    this.recoveringFromReady = false
    this.recoveryStartedAt = 0
    this.recoveryRenewals = 0
    this.recoveryBeganAt = 0

    this.session.error = null
    this.session.endpointUrl = null
    this.session.startedAt = isoNow()
    if (candidate.errorCode === 'queue_timeout') {
      this.transition('provisioning', { phase: 'queue' })
      this.session.detail = '正在确认原 Kernel 队列状态'
    } else {
      this.transition('connecting', { phase: 'tunnel' })
      this.session.detail = '正在确认原 Kernel 状态'
    }

    const statusRes = await this.deps.kernelStatus(this.ctx, candidate.kernelId).catch((error) => {
      this.log.debug('唤醒前查询原 Kernel 状态失败', logText(error?.message ?? error, 200))
      return null
    })
    if (this.isStale(epoch)) return { kind: 'stale' }

    const status = statusRes?.ok ? statusRes.status : null
    // 删除后再查 Kernel 返回 403 PERMISSION_DENIED（不是 404）：传输层用 missing 归一，
    // 这里兼容旧传输返回的文本判定。已不存在的 Kernel 不允许再「乐观保留原队列」。
    const notFound = statusRes?.missing === true || /not\s*found|\b404\b/i.test(String(statusRes?.output ?? ''))
    const aliveConfirmed = Boolean(status && isKernelAlive(status))
    // 队列超时后若暂未查到状态（临时网络抖动，且非 404 已删），宁可继续跟踪原队列也不要盲目双推。
    const optimisticQueueKeep = candidate.errorCode === 'queue_timeout' && !statusRes?.ok && !notFound

    if (!aliveConfirmed && !optimisticQueueKeep) {
      this.log.info(
        `reattach_skipped kernelId=${candidate.kernelId} status=${status ?? 'unknown'} ok=${Boolean(statusRes?.ok)}`,
      )
      return { kind: 'push_new' }
    }

    const nextStatus = status ?? candidate.kernelStatus ?? 'QUEUED'
    this.secret = { token: candidate.token, topic: candidate.topic }
    this.session = {
      ...emptySession(this.options),
      presetId: candidate.presetId,
      kernelId: candidate.kernelId,
      kernelUrl: candidate.kernelUrl,
      kernelStatus: nextStatus,
      idleTimeoutSec: candidate.idleTimeoutSec,
      startedAt: isoNow(),
    }
    if (isKernelQueued(nextStatus)) {
      this.transition('provisioning', { phase: 'queue' })
      this.session.detail = aliveConfirmed
        ? `已接管原队列（${nextStatus}），继续等待 GPU`
        : '暂未确认队列状态，继续等待原 Kernel'
    } else {
      this.transition('connecting', { phase: 'tunnel' })
      this.session.detail = '原 Kernel 仍在运行，正在重新获取隧道地址'
    }
    this.persistSession({ force: true })
    this.watch()
    this.log.info(
      `reattach_existing_kernel kernelId=${candidate.kernelId} status=${nextStatus} fromError=${candidate.errorCode}`,
    )
    return { kind: 'reattached', snapshot: this.snapshot() }
  }

  /**
   * 跑一次启动流程；返回快照。任何异常都在内部收敛为可重试的 error 状态。
   *
   * @param {string} presetId 预设 id
   * @param {number} epoch 本次启动的代次
   * @param {{ forceNew?: boolean }} [options]
   */
  async provision(presetId, epoch, { forceNew = false } = {}) {
    let folderDir = null
    try {
      // 进入新推流程前先记住旧 Kernel：forceNew / 接管失败时它已经没用了，稍后 best-effort 删除。
      const previousKernelId = this.session.kernelId
      const candidate = !forceNew ? this.reattachCandidate(presetId) : null
      if (candidate) {
        const outcome = await this.tryReattachCandidate(candidate, epoch)
        if (outcome.kind === 'stale') return this.snapshot()
        if (outcome.kind === 'reattached') return outcome.snapshot
        // 旧 Kernel 已结束 / 已不存在：不重复接管，走新推流程并清掉旧记录。
        if (outcome.kind === 'push_new') void this.discardStaleKernel(candidate.kernelId, 'reattach_dead')
      } else if (forceNew && previousKernelId) {
        void this.discardStaleKernel(previousKernelId, 'force_new')
      }

      this.clearTimers()
      this.healthMisses = 0
      this.reconnectAttempts = 0
      this.livenessCheck = null
      this.recoveringFromReady = false
      this.recoveryStartedAt = 0
      this.recoveryRenewals = 0
      this.recoveryBeganAt = 0
      // 启动前读一次最新设置：工作台修改后无需重启插件，下次唤醒即按新值注入 Kernel。
      const effective = this.effectiveSettings()
      this.session = emptySession(this.options)
      // 快照反映真正下发给远端的空闲关机秒数（不是构造时的静态 options）。
      this.session.idleTimeoutSec = effective.idleTimeoutSec
      this.session.presetId = presetId
      this.transition('provisioning', { phase: 'push' })
      this.session.detail = '正在准备 Kernel 目录'
      this.session.startedAt = isoNow()

      if (this.options.devEndpoint) {
        this.secret = { token: this.options.devToken ?? '', topic: null }
        this.session.endpointUrl = this.options.devEndpoint
        this.transition('ready', { phase: null })
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
          // /kaggle/input，权重目录映射见 effective.localModels → daemon 的 local_models。
          datasetSources: effective.datasetSources ?? [],
          config: buildKernelConfig({
            presetId,
            token,
            topic,
            idleTimeoutSec: effective.idleTimeoutSec,
            // 冷启动加固与备用通道（P1.2 / P2.2）的注入项；空值由 provisioner 省略。
            hfToken: effective.hfToken,
            pipConstraints: effective.pipConstraints,
            fallbackTunnelCommand: this.options.fallbackTunnelCommand,
            fallbackTunnelUrlRegex: this.options.fallbackTunnelUrlRegex,
            localModels: effective.localModels,
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
          accelerator: this.options.enableGpu === false ? null : effective.accelerator,
          timeoutSec: this.options.kernelTimeoutSec,
        })
      } catch (error) {
        if (this.isStale(epoch)) return this.abandonStart(folderDir)
        await this.discardKernelFolder()
        return this.fail('push_failed', `Kernel 推送异常：${error?.message ?? error}`)
      }
      if (this.isStale(epoch)) return this.abandonStart(folderDir, folder?.kernelId)

      if (!pushed.ok) {
        const code = pushed.authFailed ? 'auth_required' : 'push_failed'
        const logs = await this.deps.kernelLogs(this.ctx, folder.kernelId).catch((error) => {
          this.log.debug('拉取 Kernel 日志失败（只影响失败原因文案）', logText(error?.message ?? error, 200))
          return null
        })
        if (this.isStale(epoch)) return this.abandonStart(folderDir)
        const reason = [pushed.output, logs?.tail].filter(Boolean).join('\n').slice(-600)
        // 临时目录里的 daemon.py 含本次会话 token，push 失败后不能留在 %TEMP%。
        await this.discardKernelFolder()
        return this.fail(code, `Kernel 推送失败：${reason || '未知原因'}`, { logsTail: logs?.tail })
      }

      this.session.kernelStatus = 'PENDING'
      this.transition('provisioning', { phase: 'queue' })
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
          this.log.warn('临时 Kernel 目录清理失败（目录内 daemon.py 含 token）', logText(error?.message ?? error, 200))
        })
      }
      return this.fail('push_failed', `启动会话失败：${error?.message ?? error}`)
    }
  }

  /**
   * 作废的启动流程只做清理：删掉本次的临时 Kernel 目录（内含 token），
   * 不写任何会话状态、不挂定时器，返回当前（可能已是新一轮/已关机）的快照。
   *
   * @param {string | null} folderDir 临时 Kernel 目录
   * @param {string | null} [kernelId] 已经推送成功的 Kernel（作废时它可能仍在 Kaggle 队列里）
   */
  async abandonStart(folderDir, kernelId = null) {
    if (folderDir && this.kernelFolder === folderDir) this.kernelFolder = null
    if (folderDir) {
      await this.deps.removeKernelFolder(folderDir).catch((error) => {
        this.log.warn('临时 Kernel 目录清理失败（目录内 daemon.py 含 token）', logText(error?.message ?? error, 200))
      })
    }
    // 目录清理后再删远端 Kernel：push 成功但代次已过期的 Kernel 不会有人接管，
    // 留着只会在 Kaggle 队列里等到被调度后空转。
    if (kernelId) void this.discardStaleKernel(kernelId, 'abandoned_start')
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
      this.log.warn('丢弃临时 Kernel 目录失败（目录内含 token）', logText(error?.message ?? error, 200))
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

  /** 会合轮询的一拍：超时判定与 ntfy 消息处理（委托给 ./session/tunnel-watcher.js）。 */
  pollTunnel() {
    return watchTunnel(this)
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
    return this.singleFlight('health', () => checkHealth(this))
  }

  /** 把 `/health` 里的设备、模型与隧道通道写进快照（供外部/单测直接调用）。 */
  applyHealthDetails(health) {
    return writeHealthDetails(this, health)
  }

  /** 依据 `/health` 的 phase 推进会话状态（供外部/单测直接调用）。 */
  applyHealthState(health) {
    return writeHealthState(this, health)
  }

  /**
   * 恢复窗口是否已到期。
   *
   * 只看「最近一次续期」之后的 `recoveryTimeoutMs`：恢复期每次向 Kaggle 确认 Kernel
   * 仍 RUNNING 都会把起点推到当下（见 health-monitor.js），所以隧道重建时间超过
   * 单轮窗口也不会判死，直到续期轮数用尽。
   */
  recoveryWindowExpired() {
    return this.recoveryStartedAt > 0 && Date.now() - this.recoveryStartedAt > this.options.recoveryTimeoutMs
  }

  /** Kernel 状态轮询入口（单飞）：kaggle CLI 慢时避免叠加子进程。 */
  pollKernelStatus() {
    return this.singleFlight('kernel', () => checkKernelStatus(this))
  }

  // ---- 停止 ---------------------------------------------------------------

  async stop() {
    const before = this.session.state
    const kernelId = this.session.kernelId
    this.log.info(`stop_requested from=${before} kernelId=${kernelId ?? 'none'}`)
    // 递增代次：在飞的启动 / 轮询从这一刻起全部失效，不能再写回状态或挂定时器。
    this.epoch += 1
    this.starting = null
    this.startingEpoch = null
    // 「用户已关机」标记保持到下一次 start 清除；排队任务不得再自动拉起 Kernel。
    this.stoppedByUser = true
    this.clearTimers()
    this.livenessCheck = null
    const stoppingElapsedMs = this.elapsedMs()
    this.transition('stopping')

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
          this.log.debug('关机通知失败（忽略）', logText(error?.message ?? error, 200))
          return false
        })
    }
    // 排队阶段主动关机：Kernel 可能仍在 Kaggle 队列里排队，删除它避免之后被调度到空转；
    // 其它阶段交给上面的 best-effort /shutdown（进程退出后 Kernel 自然结束）。
    if (before === 'provisioning' && kernelId && !this.options.devEndpoint) {
      void this.discardStaleKernel(kernelId, 'stop_while_queued')
    }
    await this.discardKernelFolder()
    this.secret = { token: null, topic: null }
    this.healthMisses = 0
    this.reconnectAttempts = 0
    this.recoveringFromReady = false
    this.recoveryStartedAt = 0
    this.recoveryRenewals = 0
    this.recoveryBeganAt = 0

    this.session = emptySession(this.options)
    // transition 的 from 是进入 stopping 前的状态；这里 session 已整体替换，只能显式补记。
    this.logTransition('stopping', this.session.state, { phase: null, elapsedMs: stoppingElapsedMs })
    this.session.detail =
      before === 'provisioning'
        ? `已放弃这次排队并清理旧 Kernel（${kernelId ?? '未知'}）；若清理失败，Kernel 上线后无人接管会自行退出`
        : before === 'absent'
          ? null
          : '已关机'
    // 用户主动关机后不再需要启动恢复；记录里的 token 也一并从磁盘清掉。
    await this.clearPersistedSession()
    return this.snapshot()
  }

  // ---- 启动恢复 -----------------------------------------------------------

  /**
   * 从 `<workspace>/.imagen/session.json` 恢复上次运行中的会话（委托给 ./session/restorer.js）。
   * 没有记录、记录损坏、开发模式或被 start()/stop() 作废时返回 null。
   */
  async restore() {
    if (this.disposed) return null
    // 开发模式直连本地 Daemon：本地进程没有 Kaggle 配额风险，不恢复历史远端会话。
    if (this.options.devEndpoint) return null
    if (this.restoring) return this.restoring

    const run = executeRestore(this).finally(() => {
      if (this.restoring === run) this.restoring = null
    })
    this.restoring = run
    return run
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

  /**
   * 进入 error 状态。
   *
   * @param {string} code 失败码
   * @param {string} message 给用户看的原因（可能含远端日志尾）
   * @param {{ logsTail?: string | null }} [context]
   *   调用方已经拉到的 Kernel 日志尾：失败现场抢救直接复用它，避免再打一次远端。
   */
  fail(code, message, { logsTail = null } = {}) {
    const from = this.session.state
    const elapsedMs = this.elapsedMs()
    const text = String(message ?? '未知错误')
    this.clearTimers()
    this.starting = null
    this.startingEpoch = null
    writeFailure(this.session, code, text)
    this.log.warn(
      `fail code=${code} from=${from} elapsedMs=${Math.max(0, Math.round(elapsedMs))} message=${logText(text)}`,
    )
    // 记录保留：失败/超时后远端 Kernel 可能仍在运行，下次启动 restore() 才能据此清理。
    this.persistSession({ force: true })
    // 失败时远端可能仍在运行（push 超时 / 隧道超时后 Kernel 还活着）：尽力通知它退出，
    // 不要等到下一个用户操作或空闲超时，白烧 GPU 配额。
    this.shutdownRemote()
    // 失败现场抢救：远端容器销毁后 Host 日志仍有直接线索（best-effort，不阻塞失败路径）。
    this.rescueKernelLogs(logsTail)
    return this.snapshot()
  }

  /**
   * 失败现场抢救（best-effort）。
   *
   * 会话进入 error（含 session_ended / health_failed）时，把 Kernel 日志尾部约 30 行写入
   * Host 日志，保证远端容器销毁后仍有直接线索。约束：
   *  - 同步部分绝不抛异常，异步失败只记 debug；
   *  - 每个 Kernel 只抢救一次；调用方已拉到日志尾时直接复用，不重复拉取；
   *  - 不 await、不挂定时器，不影响状态机时序。
   */
  rescueKernelLogs(tail = null) {
    try {
      const kernelId = this.session.kernelId
      if (!kernelId) return
      if (this.rescuedKernels.has(kernelId)) return
      this.rescuedKernels.add(kernelId)
      if (typeof tail === 'string' && tail.trim()) {
        this.writeKernelLogTail(kernelId, tail)
        return
      }
      if (typeof this.deps.kernelLogs !== 'function') return
      Promise.resolve()
        .then(() => this.deps.kernelLogs(this.ctx, kernelId))
        .then((logs) => this.writeKernelLogTail(kernelId, logs?.tail))
        .catch((error) => {
          this.log.debug('失败现场 Kernel 日志抢救失败（忽略）', logText(error?.message ?? error, 200))
        })
    } catch (error) {
      // best-effort：抢救不能影响失败路径。
      try {
        this.log.debug('失败现场 Kernel 日志抢救异常（忽略）', logText(error?.message ?? error, 200))
      } catch {}
    }
  }

  /** 把 Kernel 日志尾写进 Host 日志：约 30 行 / 4000 字符上限，逐行脱敏。 */
  writeKernelLogTail(kernelId, tail) {
    try {
      const text = String(tail ?? '')
      if (!text.trim()) return
      const lines = text
        .split(/\r?\n/)
        .map((line) => logText(line, 500))
        .filter((line) => line.length > 0)
        .slice(-KERNEL_TAIL_MAX_LINES)
      const body = lines.join('\n').slice(0, KERNEL_TAIL_MAX_CHARS)
      if (!body) return
      this.log.warn(`kernel_log_tail_on_failure kernelId=${kernelId} lines=${lines.length}\n${body}`)
    } catch {
      // best-effort：日志抢救失败不能影响失败路径。
    }
  }
}
