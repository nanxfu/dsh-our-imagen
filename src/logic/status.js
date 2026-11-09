/** 会话态 / 阶段 / 任务状态的文案查询。 */

import { PHASE_STATE } from '../constants.js'
import { localized } from '../i18n.js'

export function sessionStateText(t, state) {
  const key = state ? `session.state.${state}` : 'session.state.absent'
  return localized(t, key) || state || t('value.unknown')
}

export function jobStatusText(t, status) {
  if (!status) return ''
  return localized(t, `job.status.${status}`) || status
}

export function phaseText(t, phase) {
  if (!phase) return ''
  return localized(t, `session.phase.${phase}`) || ''
}

/**
 * 把当前阶段翻译成"正在做什么、还要等多久"的一句话提示。
 * 没有对应文案时返回空串，由调用方回落到远端 detail 字段。
 */

export function phaseHint(t, session) {
  if (!session) return ''
  const phase = typeof session.phase === 'string' ? session.phase : ''
  const state = PHASE_STATE[phase] || (typeof session.state === 'string' ? session.state : '')
  return state ? localized(t, `session.hint.${state}`) || '' : ''
}
