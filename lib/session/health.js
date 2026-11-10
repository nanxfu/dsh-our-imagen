/**
 * `/health` 响应解释与掉线恢复决策（纯函数）。
 *
 * 轮询节奏、状态写入与恢复动作由 SessionManager.pollHealth / handleReadyHealthLoss
 * 执行；这里只保留可离线断言的映射与判定。
 */

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
 * ready 阶段心跳丢失后的下一步动作（纯函数）：
 *  - 'ended'：Kernel 已结束，收敛为 error 并带日志尾；
 *  - 'reconnect'：Kernel 还活着，认为隧道可能重建，清空地址回会合点重取一次；
 *  - 'giveUp'：已经重取过，判定 health_failed，不再无限抖动。
 */
export function decideReadyHealthLoss(status, reconnectAttempts, maxAttempts) {
  if (isKernelEnded(status)) return 'ended'
  return reconnectAttempts >= maxAttempts ? 'giveUp' : 'reconnect'
}