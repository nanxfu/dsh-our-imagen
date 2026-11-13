/**
 * 异常指引：错误码 → 卡片类型、详情摘要与可执行动作所需的常量。
 *
 * 放在 logic/ 里是为了让 check-client-logic 能脱离 React 覆盖全部错误码；
 * GuidanceCard 只负责画。
 */

/** Kaggle 设置页：直接落到 API token 区域，而不是泛设置首页。 */
export const KAGGLE_SETTINGS_URL = 'https://www.kaggle.com/settings/api'
/** Kaggle 账户设置首页：GPU 加速器与手机号验证都在这一页。 */
export const KAGGLE_ACCOUNT_URL = 'https://www.kaggle.com/settings'
/** 本地未安装 kaggle CLI 时给出的安装命令（与 README / probes notes 一致）。 */
export const KAGGLE_INSTALL_COMMAND = 'pip install -U kaggle'
/**
 * Windows 下的 Kaggle 凭据文件位置。
 * 单独放在常量里而不是字典里：反斜杠在字典源码里会形成转义字面量，
 * 文案改用 {path} 占位符引用，翻译文本里就不必出现反斜杠。
 */
export const KAGGLE_CREDENTIAL_PATH = '%USERPROFILE%\\.kaggle\\kaggle.json'

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
 * 客户端网络层错误：页面根本没拿到宿主响应（浏览器原文是 "Failed to fetch"）。
 *
 * 这类错误由 Host 状态轮询自动重试，界面不该把浏览器英文原文抛给用户，
 * 也不该沿用「操作没有完成」这种什么都说明不了的兜底文案。
 */
const CONNECTION_CODES = new Set(['network'])

/** 是否属于「连不上本地服务」这类客户端网络错误。 */
export function isConnectionCode(code) {
  return CONNECTION_CODES.has(code)
}

/**
 * 错误码 → 指引卡类型。
 * - ''：不弹卡（没有错误，或纯本地校验错误）
 * - oom / sleep / closed / cli / auth / network / session / generate / generic
 */
export function guidanceKindOf(code) {
  if (!code) return ''
  if (code === 'need_prompt') return ''
  if (code === 'oom') return 'oom'
  // 会话自然结束（闲置退出）与用户主动关机要分开：原因不同，动作都是重新唤醒。
  if (code === 'session_ended') return 'sleep'
  if (code === 'stopped') return 'closed'
  if (code === 'cli_missing') return 'cli'
  if (code === 'auth_required') return 'auth'
  // 远端容器没拿到 GPU 与「生成失败重试」是两件事：重试只会再消耗一次排队，
  // 正确动作是去 Kaggle 账户设置开启 GPU / 完成手机号验证后再唤醒。
  if (code === 'gpu_unavailable') return 'gpu'
  if (CONNECTION_CODES.has(code)) return 'network'
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