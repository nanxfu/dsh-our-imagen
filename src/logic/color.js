/** 状态色映射。 */

import { token } from '../theme.js'

/** 云端状态的语义色调 → 宿主状态色（与 computeStatusOf().tone 对应）。 */
export function toneColor(tone) {
  if (tone === 'ok') return token.ok
  if (tone === 'warn') return token.warn
  if (tone === 'error') return token.error
  return token.idle
}

export function jobColor(status) {
  if (status === 'done') return token.ok
  if (status === 'failed') return token.error
  if (status === 'running') return token.brand
  if (status === 'queued' || status === 'waiting-session') return token.warn
  return token.idle
}
