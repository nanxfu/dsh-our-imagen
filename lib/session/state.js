/**
 * 会话状态的形状与状态写入规则（SessionManager 的数据层）。
 *
 * 边界：只放「会话快照长什么样、怎么做拷贝、失败状态怎么写」这类纯数据逻辑；
 * 不放定时器、不放 I/O、不 import 任何宿主服务。
 *
 * 字段仍直接挂在 SessionManager 实例上（`createSessionFields` 由构造器 Object.assign 进去）：
 * 既有测试断言 `session.timers` / `session.kernelFolder` / `session.stoppedByUser` 等字段，
 * 改成访问器会改变对象形状，因此保持「字段在实例上、定义在模块里」。
 */

/** 视为「正在跑的会话状态」；start() 命中时直接返回当前快照。 */
export const ACTIVE_STATES = new Set(['provisioning', 'connecting', 'warming', 'ready', 'stopping'])

export function isoNow() {
  return new Date().toISOString()
}

/** 把毫秒时长格式化成给用户看的文案（45 分钟 / 90 秒）。 */
export function formatDuration(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds < 90 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`
}

/** 空会话快照（字段顺序保持不变；idleTimeoutSec 来自会话配置）。 */
export function emptySession(options = {}) {
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
    idleTimeoutSec: options.idleTimeoutSec,
    error: null,
  }
}

/** 对外快照：浅拷贝 + error 深拷贝，调用方改不到内部状态。 */
export function snapshotOf(session) {
  const value = { ...session }
  value.error = session.error ? { ...session.error } : null
  return value
}

/** SessionManager 的实例字段初始值。 */
export function createSessionFields(options) {
  return {
    timers: new Set(),
    kernelFolder: null,
    secret: { token: null, topic: null },
    session: emptySession(options),
    starting: null,
    startingEpoch: null,
    // 启动代次：start / stop / dispose 递增，用于作废在飞的异步流程。
    epoch: 0,
    // 用户主动 stop 后置位，直到用户再次 start（面板「唤起」）才清除。
    // JobQueue 据此拒绝为排队任务自动拉起新的 Kernel。
    stoppedByUser: false,
    healthMisses: 0,
    reconnectAttempts: 0,
    livenessCheck: null,
    recoveringFromReady: false,
    recoveryStartedAt: 0,
    disposed: false,
  }
}

/** 写入失败状态：文本截断规则与 error 结构保持不变。 */
export function writeFailure(session, code, message) {
  const text = String(message ?? '未知错误')
  session.state = 'error'
  session.phase = null
  session.detail = text.split('\n')[0].slice(0, 200)
  session.error = { code, message: text.slice(0, 800) }
}