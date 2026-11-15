/**
 * 任务错误归因、取消信号与时间工具。
 *
 * 本模块负责：把任务执行中抛出的异常折叠成对外 `{ code, message }`（`describeJobError`）、
 * 内部取消信号（`JobCancelled` / `isCancellation`）、日志用的错误分类（`errorKind`）与
 * 统一的 ISO 时间戳（`isoNow`）。
 *
 * 从 `lib/jobs.js` 拆出：错误语义与队列状态机无关，单独成文件后既能被队列复用，
 * 也能在离线测试里直接断言折叠规则。
 */

/** 失败码/错误类型：日志只做分类，不写堆栈。 */
export function errorKind(error) {
  return String(error?.code ?? error?.name ?? (error instanceof Error ? 'Error' : typeof error))
}

export function isoNow() {
  return new Date().toISOString()
}

/**
 * 把任务异常折叠成对外错误（纯函数，便于离线断言）。
 *
 * 规则与拆分前逐字一致：
 *  - 会话失效（session_ended / health_failed）时保留会话错误码：出图请求的底层错误
 *    可能只是 fetch failed，直接标成 generate_failed 会掩盖真实原因；同理，没有远端
 *    错误码时优先展示会话给出的可读原因。
 *  - 等待会话期间用户关机：统一成 stopped，避免显示成 session_absent 这种看不出原因的文案。
 *
 * @param {*} error 任务执行中抛出的错误
 * @param {object} sessionSnapshot `SessionManager.snapshot()` 的结果
 * @param {{ started?: boolean, stoppedByUser?: boolean }} context
 *   started：任务是否已进入远端调用（job.startedAt 是否已写）；
 *   stoppedByUser：用户是否主动关机。
 * @returns {{ code: string, message: string }}
 */
export function describeJobError(error, sessionSnapshot, context = {}) {
  const sessionError = sessionSnapshot?.state === 'error' ? sessionSnapshot.error : null
  let code = error?.code ?? sessionError?.code ?? 'generate_failed'
  let message = (error?.code ? error?.message : null) ?? sessionError?.message ?? error?.message ?? error
  if (!context.started && context.stoppedByUser === true && (code === 'session_absent' || code === 'session_timeout')) {
    code = 'stopped'
    message = '会话已被手动关闭，任务未执行；请先在面板点「唤醒」后重试'
  }
  return { code, message: String(message).slice(0, 600) }
}

/**
 * 取消信号：只在 Host 内部流转。
 *
 * 契约没有「job_cancelled」错误码，也不新增（复用 not_found / invalid_body / internal_error），
 * 所以取消不能伪装成普通 Error 冒泡到 runNext 的失败分支；用带 `cancelled` 标记的类表达。
 */
export class JobCancelled extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'JobCancelled'
    this.cancelled = true
  }
}

export function isCancellation(error) {
  return error instanceof JobCancelled || error?.cancelled === true
}
