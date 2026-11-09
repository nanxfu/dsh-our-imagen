/** 会话区与预设信息行的展示数据派生。 */

import { TRANSIENT_SESSION } from '../constants.js'
import { token } from '../theme.js'
import { localized } from '../i18n.js'
import { sessionStateText, phaseText, phaseHint } from './status.js'
import { sessionColor } from './color.js'

export function buildSessionView(t, input) {
  const session = input.session
  const state = (session && session.state) || 'absent'
  const probe = input.probe || null
  const busy = input.sessionBusy || ''
  const errorCode = (session && session.error && session.error.code) || ''
  const ended = state === 'error' && errorCode === 'session_ended'
  const warming = state === 'error' && errorCode === 'warming'
  const accountReady = probe ? probe.auth && probe.auth.ok === true : null
  const quotaTotal = probe && probe.quota && probe.quota.totalHours != null ? probe.quota.totalHours : null
  const hint = phaseHint(t, session)

  return {
    state,
    headline: ended ? t('workbench.sessionEnded') : sessionStateText(t, state),
    stateText: sessionStateText(t, state),
    phaseTag: phaseText(t, session && session.phase),
    hint,
    note: hint || (session && session.detail) || '',
    device: (session && session.device) || '',
    modelId: (session && session.modelId) || '',
    kernelStatus: (session && session.kernelStatus) || '',
    kernelUrl: session && typeof session.kernelUrl === 'string' ? session.kernelUrl : '',
    color: ended || warming ? token.warn : sessionColor(state),
    ended,
    warming,
    transient: TRANSIENT_SESSION[state] === true,
    hasError: !!(session && session.error && (session.error.code || session.error.message)),
    errorCode,
    canStart: !busy && (state === 'absent' || state === 'error'),
    canStop: !busy && state !== 'absent' && state !== 'stopping',
    busy,
    probing: input.probeBusy === true,
    accountReady,
    accountLabel: accountReady === null ? t('value.unknown') : accountReady ? t('value.ok') : t('value.failed'),
    chipLabel: accountReady === true ? t('chip.online') : t('chip.offline'),
    quotaLabel:
      probe && probe.quota && probe.quota.available
        ? `${probe.quota.usedHours ?? '?'} / ${quotaTotal ?? '?'} h`
        : probe
          ? t('value.quotaUnavailable')
          : t('value.unknown'),
    defaultModel: input.defaultPreset || '—',
  }
}

/** 预设信息行的展示数据；没有预设返回 null。 */

export function buildPresetView(t, preset) {
  if (!preset) return null
  return {
    licenseKind: preset.licenseKind,
    licenseLabel: preset.licenseKind === 'open' ? preset.license : t('models.license.restricted'),
    tierLabel: localized(t, `models.tier.${preset.tier}`) || t('models.tier.pending'),
    detail:
      `${t('models.params')} ${preset.params} · ${t('models.download')} ${preset.downloadGb} GB · `
      + `${t('models.gpus')} ${preset.gpus}${t('unit.card')} · ${t('models.steady')} `
      + (preset.steadySeconds == null ? t('models.pending') : `${preset.steadySeconds}${t('unit.second')}`),
  }
}

/** 纯逻辑出口：不碰 React / DOM，test/check-client-logic.mjs 直接调用。 */
