/**
 * 远端运行日志与诊断文本：纯函数，不依赖 React / DOM。
 *
 * 日志抽屉的增量合并、端点响应归一、诊断信息拼装与时间格式化都收在这里，
 * 组件只负责画，`test/check-client-logic.mjs` 可以脱离浏览器覆盖这些规则。
 */

import { DIAGNOSTICS, LOGS } from '../../shared/contract.js'

import { shortText } from './guidance.js'
import { probeStatusOf } from './probe.js'

/** 客户端保留的最大日志行数（与远端 daemon 的日志环一致，口径见契约 LOGS）。 */
export const LOG_LINE_LIMIT = LOGS.remoteLineLimit
/** Host 本地日志路由固定返回的尾部行数（与 lib/routes/logs.js 同口径）。 */
export const HOST_LOG_LINE_LIMIT = LOGS.hostLineLimit
/** 诊断信息里附带的最近远端日志行数。 */
export const DIAG_LOG_TAIL = LOGS.diagRemoteTail
/** 诊断信息里附带的最近 Host 本地日志行数（比远端更短，控制粘贴长度）。 */
export const DIAG_HOST_LOG_TAIL = LOGS.diagHostTail

/** 会话快照里不应出现在诊断文本中的字段（token 只留在 Host 内存里）。 */
const SENSITIVE_KEY = /token|secret|password|authorization|cookie/i

export function isLogLine(value) {
  return typeof value === 'string'
}

/** 增量合并日志：只接受字符串行，超过上限时丢弃最早的。无新增时返回原数组。 */
export function appendLogLines(previous, incoming, max = LOG_LINE_LIMIT) {
  const current = Array.isArray(previous) ? previous : []
  const add = Array.isArray(incoming) ? incoming.filter(isLogLine) : []
  if (add.length === 0) return current
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : LOG_LINE_LIMIT
  const merged = current.concat(add)
  return merged.length > limit ? merged.slice(merged.length - limit) : merged
}

/** 失败原因统一成 { code, message }，供 errorText 翻译。 */
function reasonOf(code, message) {
  return {
    code: typeof code === 'string' && code ? code : 'logs_unavailable',
    message: typeof message === 'string' ? message : '',
  }
}

/** 环境指纹允许的标量类型：字符串（版本号等）、有限数字、布尔开关。 */
function isEnvScalar(value) {
  if (typeof value === 'string' || typeof value === 'boolean') return true
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 归一响应里的诊断环境指纹 `data.env`（契约见 shared/contract.js 的 DIAGNOSTICS）。
 *
 * 只按 `envFields` 白名单取 string / number / boolean，按 `timingFields` 白名单取
 * 有限数字；未知键、对象 / 数组 / null / NaN 一律丢弃，也不做字符串化，
 * 保证诊断文本里不会出现任意对象或配置原文。入参不是对象时返回空对象。
 *
 * @param {unknown} value
 * @returns {{ [field: string]: string | number | boolean, timings?: object }}
 */
export function readDiagnosticEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const env = {}
  for (const field of DIAGNOSTICS.envFields) {
    if (isEnvScalar(value[field])) env[field] = value[field]
  }
  const timings = value.timings
  if (timings && typeof timings === 'object' && !Array.isArray(timings)) {
    const summary = {}
    for (const field of DIAGNOSTICS.timingFields) {
      const item = timings[field]
      if (typeof item === 'number' && Number.isFinite(item)) summary[field] = item
    }
    if (Object.keys(summary).length > 0) env.timings = summary
  }
  return env
}

/**
 * 归一端点响应：HTTP 层失败 / 业务不可用（ok:false）/ 成功三种情况。
 * Host 的日志路由始终回 HTTP 200，因此不能只看 request() 的 ok。
 *
 * `hostLines` 是 Host 本地滚动日志的尾部（已脱敏，固定最多 LOGS.hostLineLimit 行），
 * 与远端 `lines` 分开返回、不混排；老路由没有该字段时按空数组处理，保持向后兼容。
 * `env` 是诊断环境指纹（白名单过滤后），缺失时为空对象，老路由同样兼容。
 */
export function readLogsPayload(result) {
  if (!result || result.ok !== true) {
    return {
      ok: false,
      lines: [],
      hostLines: [],
      next: null,
      env: {},
      reason: reasonOf(result && result.code, result && result.message),
    }
  }
  const data = result.data && typeof result.data === 'object' ? result.data : {}
  const lines = Array.isArray(data.lines) ? data.lines.filter(isLogLine) : []
  const hostLines = Array.isArray(data.hostLines)
    ? data.hostLines.filter(isLogLine).slice(-HOST_LOG_LINE_LIMIT)
    : []
  const next = Number.isFinite(data.next) && data.next >= 0 ? Math.floor(data.next) : null
  const env = readDiagnosticEnv(data.env)
  if (data.ok === true) return { ok: true, lines, hostLines, next, env, reason: null }
  return { ok: false, lines, hostLines, next, env, reason: reasonOf(data.code, data.message) }
}

/** 时间值（ISO 字符串 / 毫秒数 / Date）→ 本地 HH:mm；无法解析时返回空串。 */
export function formatClockTime(value) {
  const time = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(String(value ?? ''))
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 从 startedAt 之类的值算到 now 的时长（毫秒）；无法解析返回 null，负数按 0。 */
export function elapsedMsSince(value, now) {
  const start = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(String(value ?? ''))
  if (!Number.isFinite(start)) return null
  const current = Number.isFinite(now) ? now : Date.now()
  return Math.max(0, current - start)
}

/**
 * 会话快照用于诊断文本：只保留可读字段，剔除任何 token / 密钥类键。
 * 不修改入参，返回新对象；入参不是对象时返回 null。
 */
export function sanitizeSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null
  const clean = {}
  for (const [key, value] of Object.entries(session)) {
    if (SENSITIVE_KEY.test(key)) continue
    const kind = typeof value
    if (value === null || kind === 'string' || kind === 'number' || kind === 'boolean') {
      clean[key] = value
    } else if (key === 'error' && value && typeof value === 'object') {
      clean[key] = { code: value.code ?? '', message: value.message ?? '' }
    }
  }
  return clean
}

/** 配额三元组（used / total 小时）→ 一行可读文本，诊断与弹层共用。 */
export function quotaText(quota) {
  if (!quota || typeof quota !== 'object') return '—'
  if (quota.available !== true) return 'unavailable'
  const used = Number.isFinite(quota.usedHours) ? quota.usedHours : null
  const total = Number.isFinite(quota.totalHours) ? quota.totalHours : null
  if (used === null || total === null) return 'available'
  return `${used} / ${total} h`
}

function sessionBlock(session) {
  if (!session) return ['session: —']
  const rows = [
    `session.state: ${session.state ?? '—'}`,
    `session.phase: ${session.phase ?? '—'}`,
    `session.presetId: ${session.presetId ?? '—'}`,
    `session.modelId: ${session.modelId ?? '—'}`,
    `session.device: ${session.device ?? '—'}`,
    `session.tunnelProvider: ${session.tunnelProvider ?? '—'}`,
    `session.kernelStatus: ${session.kernelStatus ?? '—'}`,
    `session.startedAt: ${session.startedAt ?? '—'}`,
    `session.readyAt: ${session.readyAt ?? '—'}`,
  ]
  if (session.error) {
    const code = session.error.code || '—'
    const message = session.error.message ? ` · ${shortText(session.error.message, 240)}` : ''
    rows.push(`session.error: ${code}${message}`)
  }
  return rows
}

function probeBlock(probe) {
  const info = probeStatusOf(probe)
  if (!info) return ['probe: —']
  const rows = [
    `probe.cli: ${info.cli}`,
    `probe.auth: ${info.auth}`,
    `probe.quota: ${info.quota}`,
  ]
  if (info.notes.length > 0) rows.push(`probe.notes: ${shortText(info.notes.join(' | '), 400)}`)
  return rows
}

function queueBlock(queue) {
  if (!queue || typeof queue !== 'object') return ['queue: —']
  return [`queue: running=${queue.running ?? '—'} pending=${Number.isFinite(queue.pending) ? queue.pending : 0}`]
}

function lastJobBlock(job) {
  if (!job || typeof job !== 'object') return []
  const parts = [job.id || '—', job.status || '—']
  if (Number.isFinite(job.seconds)) parts.push(`${job.seconds}s`)
  const code = job.error && job.error.code ? ` · ${job.error.code}` : ''
  return [`lastJob: ${parts.join(' ')}${code}`]
}

/**
 * 环境指纹 / 阶段耗时在诊断文本里的键名。
 * 有意使用英文键名且不进字典：这些行会被直接贴进 Issue，保持与代码、日志同形。
 */
const ENV_LABELS = {
  platform: 'env.platform',
  nodeVersion: 'env.node',
  hasProxyEnv: 'env.proxy',
  hasFallbackTunnel: 'env.fallbackTunnel',
  hasCustomDatasets: 'env.customDatasets',
  hasPipConstraints: 'env.pipConstraints',
  hasHfToken: 'env.hfToken',
}

const TIMING_LABELS = {
  sessionStartMs: 'timings.sessionStartMs',
  sessionUptimeMs: 'timings.sessionUptimeMs',
  readyUptimeMs: 'timings.readyUptimeMs',
}

/** 标量 → 诊断文本值；缺失 / 空串统一写 —。 */
function diagnosticValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/** 环境指纹段：只从白名单取标量，绝不拼接任意对象（入参再过滤一次，防御上游误传）。 */
function envBlock(value) {
  const env = readDiagnosticEnv(value)
  const rows = Object.entries(ENV_LABELS).map(
    ([field, label]) => `${label}: ${diagnosticValue(env[field])}`,
  )
  const timings = env.timings && typeof env.timings === 'object' ? env.timings : {}
  for (const field of DIAGNOSTICS.timingFields) {
    rows.push(`${TIMING_LABELS[field]}: ${diagnosticValue(timings[field])}`)
  }
  return rows
}

/**
 * 拼装可一键复制的诊断信息（纯文本）。
 *
 * @param {(key: string) => string} t 翻译函数，只用于首行标题
 * @param {{ version?: string, session?: object, probe?: object, probeLastGood?: object,
 *           probeLastGoodAt?: string, queue?: object, lastJob?: object, lines?: string[],
 *           hostLogs?: string[], env?: object, now?: number }} input
 *   env 为 GET /logs 返回的诊断环境指纹（白名单过滤后）；缺失时各字段写 —。
 */
export function buildDiagnostics(t, input = {}) {
  const source = input || {}
  const session = sanitizeSession(source.session)
  const probe = source.probe && typeof source.probe === 'object' ? source.probe : null
  const lastGood = source.probeLastGood && typeof source.probeLastGood === 'object' ? source.probeLastGood : null
  const lines = Array.isArray(source.lines) ? source.lines.filter(isLogLine) : []
  const tail = lines.slice(Math.max(0, lines.length - DIAG_LOG_TAIL))
  const hostLogs = Array.isArray(source.hostLogs) ? source.hostLogs.filter(isLogLine) : []
  const hostTail = hostLogs.slice(Math.max(0, hostLogs.length - DIAG_HOST_LOG_TAIL))
  const now = Number.isFinite(source.now) ? source.now : Date.now()

  const rows = [
    `${t('studio.logs.diag.title')} · ${new Date(now).toISOString()}`,
    `version: ${source.version || '—'}`,
    ...envBlock(source.env),
    ...sessionBlock(session),
    ...probeBlock(probe),
    `probeLastGoodAt: ${source.probeLastGoodAt || '—'}`,
    `probeLastGood.quota: ${quotaText(lastGood && lastGood.quota)}`,
    ...queueBlock(source.queue),
    ...lastJobBlock(source.lastJob),
    '',
    `logs (last ${tail.length}/${lines.length}):`,
    ...tail,
    '',
    `host logs (last ${hostTail.length}/${hostLogs.length}):`,
    ...hostTail,
  ]
  return rows.join('\n')
}