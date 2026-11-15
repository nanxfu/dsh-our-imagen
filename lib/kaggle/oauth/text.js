/**
 * Kaggle 登录链路共用的文本工具。
 *
 * 本模块负责：消息脱敏（对外 message / 日志里不出现 token、授权码、带 query 的 URL
 * 与用户目录）与「非空字符串」归一。
 *
 * 从 `lib/kaggle-oauth.js` 拆出：这两个私有 helper 被 pkce / browser / callback-server /
 * session 四个职责共用，单独成文件才不会让它们互相 import 成环。
 */

import { logText } from '../../redact.js'

/**
 * 消息脱敏：对外 message / 日志里不出现 token、授权码、带 query 的 URL 与用户目录。
 */
export function sanitizeMessage(value, max = 300) {
  return logText(value, max, { includeOAuthParams: true })
}

export function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
