/**
 * 「日志里不出现敏感串（远端 token / 提示词正文）」的统一断言。
 *
 * 入参可以是单个字符串，也可以是若干行日志的数组。
 */

/**
 * @param {string | string[] | null | undefined} logText
 * @returns {string}
 */
function flatten(logText) {
  return Array.isArray(logText) ? logText.join('\n') : String(logText ?? '')
}

/**
 * 日志里是否出现了 token。
 *
 * @param {string | string[] | null | undefined} logText
 * @param {string} token
 * @returns {boolean}
 */
export function logLeaksToken(logText, token) {
  return flatten(logText).includes(token)
}

/**
 * 断言日志里不含 token，否则抛错。
 *
 * @param {string | string[] | null | undefined} logText
 * @param {string} token
 * @param {string} [label]
 */
export function assertNoToken(logText, token, label = '日志') {
  if (!token) throw new Error('assertNoToken 需要一个非空 token 用于比对')
  if (logLeaksToken(logText, token)) throw new Error(`${label}泄露了敏感串（${token.length} 字符）`)
}
