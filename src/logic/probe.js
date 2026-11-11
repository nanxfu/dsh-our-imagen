/**
 * 环境探测结果归一化：Host 的 /probe 永远回 HTTP 200，成败只能看 payload。
 *
 * - payload.ok：整体是否可用（等价于 auth.ok）
 * - payload.probe.cli / auth / quota：各项状态
 * - payload.probe.notes：给用户看的说明（含安装命令等）
 */

import { shortText } from './guidance.js'

function cliStatus(cli) {
  if (cli === true) return 'ok'
  if (cli === false) return 'failed'
  if (!cli || typeof cli !== 'object') return 'unknown'
  return cli.present === false ? 'failed' : 'ok'
}

function authStatus(auth) {
  if (!auth || typeof auth !== 'object') return 'unknown'
  return auth.ok === true ? 'ok' : 'failed'
}

function quotaStatus(quota) {
  if (!quota || typeof quota !== 'object') return 'unknown'
  return quota.available === true ? 'ok' : 'unavailable'
}

/** 把 probe 对象折叠成 UI 需要的四项；没有 probe 时返回 null。 */
export function probeStatusOf(probe) {
  if (!probe || typeof probe !== 'object') return null
  const notes = Array.isArray(probe.notes)
    ? probe.notes.filter((item) => typeof item === 'string' && item.trim())
    : []
  return {
    cli: cliStatus(probe.cli),
    auth: authStatus(probe.auth),
    quota: quotaStatus(probe.quota),
    notes,
  }
}

/**
 * 会话已经推进到这些状态，说明内核推送与远端连通确实成功过。本插件的判定原则是
 * 「鉴权以真实 API 调用成败为准」（见 lib/kaggle.js），因此这些状态足以证明凭据有效。
 */
const AUTH_PROVEN_SESSION_STATES = ['provisioning', 'connecting', 'warming', 'ready', 'stopping']

/** 会话状态是否足以证明 Kaggle 凭据有效。 */
export function sessionProvesAuth(sessionState) {
  return AUTH_PROVEN_SESSION_STATES.includes(sessionState)
}

/**
 * 账号状态的展示值：`ok` / `failed` / `unknown`。
 *
 * - 有成功证据一律按正常显示：探测通过，或会话能启动、能出图（会话本身即真实 API 调用成功），
 *   上一次探测的偶发失败不该盖过它；
 * - 都没有成功证据时，有探测结果就如实报失败；
 * - 完全没有探测记录时给 `unknown`（未检查）——没检查过不等于账号不可用。
 */
export function accountStatusOf(probe, sessionState) {
  const status = probeStatusOf(probe)
  if ((status && status.auth === 'ok') || sessionProvesAuth(sessionState)) return 'ok'
  return status ? status.auth : 'unknown'
}

/** 根据 probe 结果给出应弹哪类指引卡：cli_missing / auth_required / ''。 */
export function probeFailureCode(probe) {
  const status = probeStatusOf(probe)
  if (!status) return ''
  if (status.cli === 'failed') return 'cli_missing'
  if (status.auth === 'failed') return 'auth_required'
  return ''
}

/**
 * 把 /probe 的响应体归一化成一次检查结果。
 * Host 固定回 HTTP 200，成败只看 payload.ok 与 payload.probe.auth.ok；
 * 响应体缺字段时按失败处理，绝不会被当成成功。
 */
export function probeOutcomeOf(payload) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const probe = data.probe && typeof data.probe === 'object' ? data.probe : null
  if (data.ok === true) return { ok: true, probe, code: '', detail: '' }
  const code = probeFailureCode(probe) || 'probe_failed'
  return { ok: false, probe, code, detail: probeFailureDetail(probe) }
}

/** probe 失败时给用户看的一行说明：notes 优先，其次 auth.detail / cli.error。 */
export function probeFailureDetail(probe) {
  const status = probeStatusOf(probe)
  if (status && status.notes.length > 0) return shortText(status.notes.slice(0, 2).join(' · '))
  const authDetail = probe && probe.auth && typeof probe.auth.detail === 'string' ? probe.auth.detail : ''
  if (authDetail) return shortText(authDetail)
  const cliError = probe && probe.cli && typeof probe.cli.error === 'string' ? probe.cli.error : ''
  return shortText(cliError)
}