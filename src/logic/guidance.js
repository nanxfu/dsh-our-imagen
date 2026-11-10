/**
 * 异常指引：错误码 → 卡片类型、详情摘要与可执行动作所需的常量。
 *
 * 放在 logic/ 里是为了让 check-client-logic 能脱离 React 覆盖全部错误码；
 * GuidanceCard 只负责画。
 */

/** Kaggle 设置页：直接落到 API token 区域，而不是泛设置首页。 */
export const KAGGLE_SETTINGS_URL = 'https://www.kaggle.com/settings/api'
/** 本地未安装 kaggle CLI 时给出的安装命令（与 README / probes notes 一致）。 */
export const KAGGLE_INSTALL_COMMAND = 'pip install -U kaggle'

/** 会话级错误：可以「重新唤醒」。 */
const SESSION_CODES = new Set([
  'push_failed',
  'queue_timeout',
  'tunnel_timeout',
  'health_failed',
  'remote_error',
  'session_error',
  'session_timeout',
  'session_absent',
  'disposed',
])

/** 生成级错误：可以沿用原参数「重试一次」。 */
const GENERATION_CODES = new Set([
  'generation_failed',
  'generate_failed',
  'load_failed',
  'invalid_request',
  'empty_result',
  'invalid_prompt',
  'queue_full',
  'warming',
])

/**
 * 错误码 → 指引卡类型。
 * - ''：不弹卡（没有错误，或纯本地校验错误）
 * - oom / sleep / cli / auth / session / generate / generic
 */
export function guidanceKindOf(code) {
  if (!code) return ''
  if (code === 'need_prompt') return ''
  if (code === 'oom') return 'oom'
  if (code === 'session_ended' || code === 'stopped') return 'sleep'
  if (code === 'cli_missing') return 'cli'
  if (code === 'auth_required') return 'auth'
  if (SESSION_CODES.has(code)) return 'session'
  if (GENERATION_CODES.has(code)) return 'generate'
  return 'generic'
}

/** 折叠空白并截断，避免日志尾巴把卡片撑坏。 */
export function shortText(value, max = 240) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * 指引卡详情：本地错误 → 会话错误 → 焦点任务错误 → 会话说明，取第一个可读的。
 * 只回原文，不拼文案，方便单测与在不同位置复用。
 */
export function guidanceDetailOf(input) {
  const source = input || {}
  const session = source.session || null
  const job = source.job || null
  const candidates = [
    source.error && source.error.message,
    session && session.error && session.error.message,
    job && job.error && job.error.message,
    session && session.detail,
  ]
  for (const candidate of candidates) {
    const text = shortText(candidate)
    if (text) return text
  }
  return ''
}