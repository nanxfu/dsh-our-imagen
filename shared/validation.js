/**
 * Host 与 Client 共用的纯校验 / 归一模块（唯一来源）。
 *
 * 约定：
 *  - 只允许纯数据与纯函数，严禁 import `node:*` 或任何运行时模块；
 *  - 边界与默认值全部取自 `./contract.js`，本文件不硬编码契约数字。
 */

import { INTENT, LIMITS, SETTINGS, UI_STATE, publicPresets } from './contract.js'

/** HF 仓库 id 形状：`org/name`，两段只含字母数字与 `._-` 且以字母数字开头。 */
export const HF_REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function invalid(message) {
  return { ok: false, code: 'invalid_request', message }
}

// ---- 运行设置（localModels / kaggleTransport / idleTimeoutSec）-------------

/** 判断字符串是否为合法 HuggingFace 仓库 id（`org/name`）。 */
export function isValidHfRepoId(repo) {
  return typeof repo === 'string' && HF_REPO_ID_RE.test(repo)
}

/** 判断容器内挂载路径是否合法：以 `/` 开头、不含空白或 NUL、长度不超过上限。 */
export function isValidContainerPath(path, maxChars = SETTINGS.maxItemChars) {
  return typeof path === 'string' && path.startsWith('/') && !/[\s\0]/.test(path) && path.length <= maxChars
}

/**
 * 校验并归一 `localModels` 对象（Host 请求校验与磁盘覆盖项复用）。
 *
 * @param {unknown} input
 * @param {{ maxItems?: number, maxChars?: number }} [options]
 * @returns {{ ok: true, value: Record<string, string> } | { ok: false, code: 'invalid_request', message: string }}
 */
export function normalizeLocalModels(
  input,
  { maxItems = SETTINGS.maxItems, maxChars = SETTINGS.maxItemChars } = {},
) {
  if (!isPlainObject(input)) return invalid('localModels 必须是对象（repo → 容器路径）')
  const value = {}
  let count = 0
  for (const [rawRepo, rawDir] of Object.entries(input)) {
    if (!hasOwn(input, rawRepo)) continue
    const repo = typeof rawRepo === 'string' ? rawRepo.trim() : ''
    if (!hasOwn(value, repo) && count >= maxItems) break
    if (!isValidHfRepoId(repo)) return invalid('localModels 的键必须是 HuggingFace 仓库 id（org/name）')
    if (typeof rawDir !== 'string' || !rawDir.trim()) {
      return invalid(`localModels.${repo} 必须是容器内绝对路径`)
    }
    const dir = rawDir.trim()
    if (!dir.startsWith('/')) return invalid(`localModels.${repo} 必须以 / 开头（容器内绝对路径）`)
    if (/[\s\0]/.test(dir)) return invalid(`localModels.${repo} 不能包含空白或控制字符`)
    if (dir.length > maxChars) {
      return invalid(`localModels.${repo} 的路径过长（最多 ${maxChars} 字符）`)
    }
    if (!hasOwn(value, repo)) count += 1
    value[repo] = dir
  }
  return { ok: true, value }
}

/**
 * 宽松清洗 `localModels`（用于静态 config 兜底与 kernel 注入配置组装）。
 * 显式跳过可能污染原型链的键名。
 *
 * @param {unknown} input
 * @returns {Record<string, string>}
 */
export function cleanLocalModels(input) {
  const models = {}
  if (!isPlainObject(input)) return models
  for (const [rawRepo, rawDir] of Object.entries(input)) {
    if (rawRepo === '__proto__' || rawRepo === 'constructor' || rawRepo === 'prototype') continue
    if (typeof rawRepo !== 'string' || typeof rawDir !== 'string') continue
    const repo = rawRepo.trim()
    const dir = rawDir.trim()
    if (!repo || !dir) continue
    models[repo] = dir
  }
  return models
}

/**
 * Kaggle 访问方式归一：白名单外（含缺失字段）回退契约默认值。
 *
 * @param {unknown} value
 * @returns {'cli' | 'direct'}
 */
export function normalizeKaggleTransport(value) {
  return typeof value === 'string' && SETTINGS.kaggleTransports.includes(value)
    ? value
    : SETTINGS.defaultKaggleTransport
}

/**
 * 空闲超时秒数归一：非有限数字（或 null / undefined / boolean / 空串）退回 fallback，
 * 其余四舍五入并钳制到契约边界内。
 *
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampIdleTimeout(value, fallback = SETTINGS.idleTimeoutSec.min) {
  if (
    value === null
    || value === undefined
    || typeof value === 'boolean'
    || (typeof value === 'string' && value.trim() === '')
  ) {
    return fallback
  }
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(SETTINGS.idleTimeoutSec.max, Math.max(SETTINGS.idleTimeoutSec.min, Math.round(number)))
}

// ---- 对话意图（history / clarify / modelHint）-----------------------------

/**
 * 把对话历史裁剪成 `{ role: 'user' | 'assistant', content: string }[]`：
 * role 白名单过滤、去空、单条按契约截断、仅保留最近 `maxMessages` 条。
 *
 * @param {unknown} value
 * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
 */
export function historyMessages(value) {
  if (!Array.isArray(value)) return []
  const { maxMessages, maxMessageChars } = LIMITS.intentHistory
  const messages = []
  for (const entry of value) {
    if (!isPlainObject(entry)) continue
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : ''
    if (!role) continue
    const content = textOf(entry.content)
    if (!content) continue
    messages.push({ role, content: content.slice(0, maxMessageChars) })
  }
  return messages.slice(-maxMessages)
}

/**
 * 通用澄清归一：`null` 或 `{ question, options }`。
 * 问题为空或去重后有效选项不足 `clarifyMinOptions` 条时返回 `null`。
 *
 * @param {unknown} value
 * @returns {{ question: string, options: string[] } | null}
 */
export function normalizeClarify(value) {
  if (!isPlainObject(value)) return null
  const question = textOf(value.question).slice(0, INTENT.clarifyQuestionMaxChars)
  if (!question) return null
  const options = []
  const seen = new Set()
  for (const item of Array.isArray(value.options) ? value.options : []) {
    const option = textOf(item).slice(0, INTENT.clarifyOptionMaxChars)
    if (!option || seen.has(option)) continue
    seen.add(option)
    options.push(option)
    if (options.length >= INTENT.clarifyMaxOptions) break
  }
  if (options.length < INTENT.clarifyMinOptions) return null
  return { question, options }
}

/**
 * 模型建议归一：`presetId` 必须在公开预设清单中且不等于当前预设。
 * 默认要求 `reason` 非空（Client 语义）；传 `fallbackToDescription: true` 时（Host 语义）
 * 在理由为空时回退到目标预设对应语言的定位描述。
 *
 * @param {unknown} value
 * @param {string | { id?: string } | null | undefined} currentPresetOrId
 * @param {{ locale?: 'zh' | 'en', fallbackToDescription?: boolean, presets?: Array<object> }} [options]
 * @returns {{ presetId: string, reason: string } | null}
 */
export function normalizeModelHint(value, currentPresetOrId, options = {}) {
  if (!isPlainObject(value)) return null
  const currentId = typeof currentPresetOrId === 'string'
    ? currentPresetOrId.trim()
    : isPlainObject(currentPresetOrId)
      ? textOf(currentPresetOrId.id)
      : ''
  const presetId = textOf(value.presetId)
  if (!presetId || !currentId || presetId === currentId) return null
  const presets = Array.isArray(options.presets) ? options.presets : publicPresets()
  const target = presets.find((preset) => preset && preset.id === presetId)
  if (!target) return null
  let reason = textOf(value.reason)
  if (!reason && options.fallbackToDescription === true) {
    const description = isPlainObject(target.description) ? target.description : {}
    const locale = options.locale === 'en' ? 'en' : 'zh'
    reason = textOf(locale === 'en' ? description.en || description.zh : description.zh || description.en)
  }
  reason = reason.slice(0, INTENT.modelHintReasonMaxChars)
  if (!reason) return null
  return { presetId: target.id, reason }
}

// ---- 工作台界面态（uiState）------------------------------------------------

/** 已登记的白名单字段（顺序与 `UI_STATE.defaults` 一致）。 */
export const UI_STATE_FIELDS = Object.freeze(Object.keys(UI_STATE.defaults))

/** 默认界面态视图（每次返回新对象，避免调用方修改契约常量）。 */
export function defaultUiState() {
  return { ...UI_STATE.defaults }
}

/**
 * 归一化界面态：只保留白名单字段，类型不符回落默认值，未知字段一律丢弃。
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function normalizeUiState(value) {
  const source = isPlainObject(value) ? value : {}
  const view = {}
  for (const field of UI_STATE_FIELDS) {
    const fallback = UI_STATE.defaults[field]
    view[field] = typeof source[field] === typeof fallback ? source[field] : fallback
  }
  return view
}

/**
 * 构造界面态保存补丁（Client 语义）：只保留白名单且类型正确的字段，其余静默丢弃。
 *
 * @param {unknown} partial
 * @returns {Record<string, unknown>}
 */
export function buildUiStatePatch(partial) {
  const source = isPlainObject(partial) ? partial : {}
  const patch = {}
  for (const field of UI_STATE_FIELDS) {
    if (!hasOwn(source, field)) continue
    if (typeof source[field] !== typeof UI_STATE.defaults[field]) continue
    patch[field] = source[field]
  }
  return patch
}

function typeLabel(value) {
  if (typeof value === 'boolean') return '布尔值'
  if (typeof value === 'number') return '数字'
  if (typeof value === 'string') return '字符串'
  return '对象'
}

/**
 * 校验并归一界面态补丁（Host 语义）：非对象或已登记字段类型不符返回 `invalid_request`。
 *
 * @param {unknown} patch
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, code: 'invalid_request', message: string }}
 */
export function normalizeUiStatePatch(patch) {
  if (!isPlainObject(patch)) {
    return invalid('界面状态必须是 JSON 对象')
  }
  const value = {}
  for (const field of UI_STATE_FIELDS) {
    if (!hasOwn(patch, field)) continue
    if (typeof patch[field] !== typeof UI_STATE.defaults[field]) {
      return invalid(`${field} 必须是${typeLabel(UI_STATE.defaults[field])}`)
    }
    value[field] = patch[field]
  }
  return { ok: true, value }
}
