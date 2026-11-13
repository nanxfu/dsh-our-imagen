/**
 * `/health` 响应解释与掉线恢复决策（纯函数）。
 *
 * 轮询节奏、状态写入与恢复动作由 SessionManager.pollHealth / handleReadyHealthLoss
 * 执行；这里只保留可离线断言的映射与判定。
 */

import { hostErrorCodes } from '../../shared/contract.js'

// 契约登记的 host + remote 错误码：daemon 的 last_error_code 只有命中这里才能原样透传，
// 否则客户端字典没有对应文案，统一收敛为 remote_error。
const HOST_ERROR_CODES = new Set(hostErrorCodes())

const PHASE_DETAIL = {
  installing: '远端安装依赖',
  loading: '远端加载模型',
}

/** /health.phase → 给用户看的一句话（未知 phase 视为「远端启动中」）。 */
export function describeHealthPhase(health) {
  if (health?.phase === 'error') return `远端错误：${health?.last_error ?? '未知'}`
  return PHASE_DETAIL[health?.phase] ?? '远端启动中'
}

/** Kernel 是否已经结束（正常完成 / 异常 / 被取消）。 */
export function isKernelEnded(status) {
  return status === 'COMPLETE' || status === 'ERROR' || status === 'CANCEL_ACKNOWLEDGED'
}

/**
 * 远端 /health 的 `last_error_code` → 宿主透传的错误码。
 *
 * 只放行 `shared/contract.js` 已登记（host + remote）的错误码，保证客户端一定有文案；
 * 未登记 / 非字符串 / 缺失一律回退 `remote_error`。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function remoteErrorCodeOf(value) {
  return typeof value === 'string' && HOST_ERROR_CODES.has(value) ? value : 'remote_error'
}

/**
 * ready 阶段心跳丢失后的下一步动作（纯函数）：
 *  - 'ended'：Kernel 已结束，收敛为 error 并带日志尾；
 *  - 'reconnect'：Kernel 还活着，认为隧道可能重建，清空地址回会合点重取一次；
 *  - 'giveUp'：已经重取过，判定 health_failed，不再无限抖动。
 */
export function decideReadyHealthLoss(status, reconnectAttempts, maxAttempts) {
  if (isKernelEnded(status)) return 'ended'
  return reconnectAttempts >= maxAttempts ? 'giveUp' : 'reconnect'
}