/**
 * 统一日志与错误消息脱敏工具（SSOT）。
 *
 * 导出：
 *  - `redactLogText(text)`：纯文本/JSON 脱敏（保留换行与长度），供 `lib/log.js` 落盘统一过滤；
 *  - `logText(value, max, options)`：单行摘要脱敏，折叠空白、掩掉带 query 的 URL、
 *    长十六进制串、用户目录路径及各类凭据后按最大字符数截断，供各模块日志与错误摘要复用。
 */

const REDACTED = '[REDACTED]'

/** 敏感键名（大小写不敏感、兼容 camelCase / snake_case / kebab-case）。 */
const SECRET_FIELD_PATTERN =
  '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|authorization|api[_-]?key|apikey|hf[_-]?token|credential)'

const PROMPT_FIELD_RE = /"(negativePrompt|negative_prompt|prompt)"\s*:\s*"((?:[^"\\]|\\.)*)"/g

const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

const JSON_SECRET_FIELD_RE = new RegExp(`("${SECRET_FIELD_PATTERN}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi')

const SINGLE_QUOTED_SECRET_RE = new RegExp(`('${SECRET_FIELD_PATTERN}'\\s*:\\s*)'[^']*'`, 'gi')

/** URL query 里的敏感参数值（token / sig / code 等）。 */
const URL_SECRET_QUERY_RE = new RegExp(
  `([?&](?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|key|secret|password|passwd|sig|signature|auth|authorization|credential|code)=)(?!\\[REDACTED\\])[^&#\\s]+`,
  'gi',
)

/** `token=xxx` / `secret: xxx` / `apiKey=xxx` 这类键值形式（含引号值）。 */
const KEY_VALUE_SECRET_RE = new RegExp(
  `(\\b${SECRET_FIELD_PATTERN}\\b\\s*[=:]\\s*)(?!\\[REDACTED\\])(?:"[^"]*"|'[^']*'|[^\\s,;&"')\\]}]+)`,
  'gi',
)

/** 常见密钥前缀：hf_xxx / KGAT_xxx / ghp_xxx / sk-xxx / github_pat_xxx / xox?-xxx。 */
const PREFIX_SECRET_RE =
  /\b(?:hf|kgat|ghp|gho|ghs|ghu|github_pat|xox[abprs])[_-][A-Za-z0-9_-]{6,}|\bsk-[A-Za-z0-9_-]{6,}/gi

const URL_ANY_QUERY_RE = /(https?:\/\/[^\s?#]+)\?[^\s#]*/gi
const LONG_HEX_RE = /\b[0-9a-f]{32,}\b/gi
const OAUTH_KV_RE = /\b(code|state)\s*[=:]\s*[^\s,&;]+/gi
const WIN_USER_HOME_RE = /[A-Za-z]:\\Users\\[^\\\s"'<>:]+/g
const POSIX_USER_HOME_RE = /\/(?:Users|home)\/[^/\s"'<>:]+/g

/** JSON 字符串字面量（含转义序列）解码后的字符数；解码失败退回原文长度。 */
function jsonStringLength(literal) {
  try {
    return JSON.parse(`"${literal}"`).length
  } catch {
    return literal.length
  }
}

/** 结构化对象里的 prompt / negativePrompt 只保留长度，避免把提示词正文落盘。 */
function maskPromptFields(text) {
  return text.replace(PROMPT_FIELD_RE, (_matched, key, literal) => {
    const field = key.toLowerCase().startsWith('negative') ? 'negativePromptLen' : 'promptLen'
    return `"${field}":${jsonStringLength(literal)}`
  })
}

/**
 * 统一脱敏过滤器（纯函数，可重复调用）。
 *
 * 处理：Bearer Token、token/secret/password/authorization/api key 等键值、
 * hf_/KGAT_/ghp_/sk- 等密钥前缀、URL 敏感 query 参数、结构化 prompt 字段。
 *
 * @param {unknown} text
 * @returns {string}
 */
export function redactLogText(text) {
  const source =
    typeof text === 'string' ? text : text === null || text === undefined ? '' : String(text)
  let output = source
  output = maskPromptFields(output)
  output = output.replace(BEARER_RE, `Bearer ${REDACTED}`)
  output = output.replace(JSON_SECRET_FIELD_RE, `$1"${REDACTED}"`)
  output = output.replace(SINGLE_QUOTED_SECRET_RE, `$1'${REDACTED}'`)
  output = output.replace(URL_SECRET_QUERY_RE, `$1${REDACTED}`)
  output = output.replace(KEY_VALUE_SECRET_RE, `$1${REDACTED}`)
  output = output.replace(PREFIX_SECRET_RE, REDACTED)
  return output
}

/**
 * 单行日志/错误摘要脱敏：在 `redactLogText` 基础上掩掉完整 URL query、
 * 长十六进制串与本机用户目录路径，折叠空白并按 `max` 截断。
 *
 * @param {unknown} value
 * @param {number} [max]
 * @param {{ includeOAuthParams?: boolean }} [options]
 * @returns {string}
 */
export function logText(value, max = 200, options = {}) {
  let text = redactLogText(value)
  text = text.replace(URL_ANY_QUERY_RE, `$1?${REDACTED}`)
  text = text.replace(LONG_HEX_RE, REDACTED)
  if (options.includeOAuthParams) {
    text = text.replace(OAUTH_KV_RE, `$1=${REDACTED}`)
  }
  text = text.replace(WIN_USER_HOME_RE, '<user-home>')
  text = text.replace(POSIX_USER_HOME_RE, '<user-home>')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}
