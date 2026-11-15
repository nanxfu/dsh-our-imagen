/**
 * 环境探测结果归一化：Host 的 /probe 永远回 HTTP 200，成败只能看 payload。
 *
 * - payload.ok：整体是否可用（等价于 auth.ok）
 * - payload.probe.cli / auth / quota：各项状态
 * - payload.probe.notes：给用户看的说明（含安装命令等）
 */

import { normalizeKaggleTransport } from '../../shared/validation.js'
import { shortText } from './guidance.js'

/**
 * 访问方式归一：**字段缺失**（旧宿主 / 旧视图）按 CLI 处理，**非法值**按契约默认值处理。
 *
 * 两者必须分开：契约默认值是 direct，但 0.8.x 宿主既没有 `kaggleTransport` 也没有登录路由，
 * 把界面画成直连会给出一个点了没反应的主操作。
 */
export function transportOf(source) {
  const value = source && typeof source === 'object' ? source.kaggleTransport : undefined
  return value === undefined ? 'cli' : normalizeKaggleTransport(value)
}

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
export function probeFailureCode(probe, options = {}) {
  const status = probeStatusOf(probe)
  if (!status) return ''
  const transport = options && options.transport === 'direct' ? 'direct' : 'cli'
  // 直连模式不依赖本机 kaggle CLI：cli 探测失败只说明还没登录，
  // 不能弹「安装 CLI」卡（那张卡的动作在直连模式下没有意义）。
  if (status.cli === 'failed') return transport === 'direct' ? 'auth_required' : 'cli_missing'
  if (status.auth === 'failed') return 'auth_required'
  return ''
}

/**
 * 访问方式的展示文案键：CLI 模式叫「命令行」，直连模式叫「直连」。
 * 只影响展示，不改判定结构（判定仍看 probe.cli / probe.auth）。
 */
export function accessMethodKey(transport) {
  return transport === 'direct' ? 'studio.probe.direct' : 'studio.probe.cli'
}

/**
 * 访问方式状态的展示文案键：直连模式下 ok/failed 分别表示「直连正常 / 直连未登录」，
 * CLI 模式沿用通用的正常/异常文案。
 */
export function accessStatusKey(transport, status) {
  if (transport !== 'direct') {
    if (status === 'ok') return 'value.ok'
    if (status === 'failed') return 'value.failed'
    return 'value.unknown'
  }
  if (status === 'ok') return 'studio.probe.directOk'
  if (status === 'failed') return 'studio.probe.directLoginRequired'
  return 'value.unknown'
}

/**
 * 访问方式状态的展示值：CLI 模式看 cli 探测；直连模式不依赖本机 CLI，
 * 以账号（auth）探测为准——登录成功才算「直连正常」，401/403 算「直连未登录」。
 */
export function accessStatusOf(status, transport) {
  if (!status || typeof status !== 'object') return 'unknown'
  if (transport !== 'direct') return status.cli || 'unknown'
  if (status.auth === 'ok') return 'ok'
  if (status.auth === 'failed') return 'failed'
  return 'unknown'
}

/**
 * 把 /probe 的响应体归一化成一次检查结果。
 * Host 固定回 HTTP 200，成败只看 payload.ok 与 payload.probe.auth.ok；
 * 响应体缺字段时按失败处理，绝不会被当成成功。
 * options.transport 决定直连模式下 cli 失败归类（见 probeFailureCode）。
 */
export function probeOutcomeOf(payload, options = {}) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const probe = data.probe && typeof data.probe === 'object' ? data.probe : null
  if (data.ok === true) return { ok: true, probe, code: '', detail: '' }
  const code = probeFailureCode(probe, options) || 'probe_failed'
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