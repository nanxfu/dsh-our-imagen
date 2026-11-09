/** 状态色映射。 */

import { token } from '../theme.js'

export function sessionColor(state) {
  if (state === 'ready') return token.ok
  if (state === 'error') return token.error
  if (state === 'provisioning' || state === 'connecting' || state === 'warming' || state === 'stopping') return token.warn
  return token.idle
}

export function jobColor(status) {
  if (status === 'done') return token.ok
  if (status === 'failed') return token.error
  if (status === 'running') return token.brand
  if (status === 'queued' || status === 'waiting-session') return token.warn
  return token.idle
}
