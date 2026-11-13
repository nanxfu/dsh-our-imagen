/**
 * 运行设置抽屉的纯逻辑：分钟 ↔ 秒、多行文本 ↔ 数组/映射、表单 → POST 请求体。
 *
 * 不依赖 React / DOM，也不引用字典：
 *  - 行级错误的 `message` 是字典键（由 SettingsDrawer 用 t 翻译），`params` 是占位符参数；
 *  - 字段边界全部来自 shared/contract.js 的 SETTINGS / TIMEOUTS，不写死常量。
 */

import { SETTINGS, TIMEOUTS } from '../../shared/contract.js'

import { clampInt } from './clamp.js'
import { errorText } from './error.js'

const IDLE = SETTINGS.idleTimeoutSec
/** 自定义分钟输入的合法区间（由契约秒边界换算，向上/向下取整到整分钟）。 */
export const IDLE_MIN_MINUTES = Math.ceil(IDLE.min / 60)
export const IDLE_MAX_MINUTES = Math.floor(IDLE.max / 60)
/** 宿主没给 idleTimeoutSec 时的默认档位：与 TIMEOUTS.idleShutdownSec 保持一致。 */
const DEFAULT_IDLE_SEC = clampInt(TIMEOUTS.idleShutdownSec, IDLE.min, IDLE.max, 1800)

/** HuggingFace 模型 ID：owner/name 两段，不含空白或额外的斜杠。 */
const REPO_ID_PATTERN = /^[^\s=/]+\/[^\s=/]+$/

/** idleTimeoutSec → 整分钟（非法/缺失回落默认档，并钳制到契约区间）。 */
export function idleMinutesOf(idleTimeoutSec) {
  const fallback = Math.round(DEFAULT_IDLE_SEC / 60)
  const seconds = Number(idleTimeoutSec)
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback
  return clampInt(seconds / 60, IDLE_MIN_MINUTES, IDLE_MAX_MINUTES, fallback)
}

/**
 * 分钟 → idleTimeoutSec。非数值返回 null（调用方按「未修改」处理），
 * 数值按 SETTINGS.idleTimeoutSec 的 min/max 钳制后换算成秒。
 */
export function idleTimeoutSecOf(minutes) {
  const value = Number(minutes)
  if (!Number.isFinite(value) || value <= 0) return null
  const fallback = Math.round(DEFAULT_IDLE_SEC / 60)
  return clampInt(value, IDLE_MIN_MINUTES, IDLE_MAX_MINUTES, fallback) * 60
}

/** 当前输入值命中的快捷档位（分钟），不命中返回 null。 */
export function quickIdleMinutes(value) {
  const minutes = Number(value)
  if (!Number.isInteger(minutes)) return null
  return IDLE.quickMinutes.includes(minutes) ? minutes : null
}

/**
 * 多行文本 → 字符串数组：去空行、去首尾空白、去重、按契约上限截断。
 * 超过单条字数上限的行会被丢弃（Host 侧同样不接受超长项）。
 */
export function parseLineList(text, options = {}) {
  const maxItems = options.maxItems ?? SETTINGS.maxItems
  const maxChars = options.maxItemChars ?? SETTINGS.maxItemChars
  const values = []
  const seen = new Set()
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const value = raw.trim()
    if (!value || value.length > maxChars || seen.has(value)) continue
    seen.add(value)
    values.push(value)
    if (values.length >= maxItems) break
  }
  return values
}

/** 字符串数组 → 多行文本（一行一条，过滤空值与重复项）。 */
export function formatLineList(values) {
  if (!Array.isArray(values)) return ''
  const lines = []
  const seen = new Set()
  for (const item of values) {
    const value = typeof item === 'string' ? item.trim() : ''
    if (!value || seen.has(value)) continue
    seen.add(value)
    lines.push(value)
  }
  return lines.join('\n')
}

/**
 * 本地模型映射文本 → { repo: 容器路径 }，带行级错误。
 * 错误形状：{ line: 行号, message: 字典键, params?: 占位符参数 }。
 */
export function parseLocalModels(text, options = {}) {
  const maxItems = options.maxItems ?? SETTINGS.maxItems
  const maxChars = options.maxItemChars ?? SETTINGS.maxItemChars
  const value = {}
  const errors = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    const lineNumber = index + 1
    if (line.length > maxChars) {
      errors.push({ line: lineNumber, message: 'studio.settings.localModels.errorTooLong' })
      continue
    }
    const separator = line.indexOf('=')
    if (separator < 0) {
      errors.push({ line: lineNumber, message: 'studio.settings.localModels.errorFormat' })
      continue
    }
    const repo = line.slice(0, separator).trim()
    const path = line.slice(separator + 1).trim()
    if (!REPO_ID_PATTERN.test(repo)) {
      errors.push({ line: lineNumber, message: 'studio.settings.localModels.errorRepo' })
      continue
    }
    if (!path.startsWith('/') || /\s/.test(path)) {
      errors.push({ line: lineNumber, message: 'studio.settings.localModels.errorPath' })
      continue
    }
    if (!(repo in value) && Object.keys(value).length >= maxItems) {
      errors.push({
        line: lineNumber,
        message: 'studio.settings.localModels.errorTooMany',
        params: { max: maxItems },
      })
      continue
    }
    value[repo] = path
  }
  return { value, errors }
}

/** 本地模型映射 → 多行文本（repo=容器路径）。 */
export function formatLocalModels(localModels) {
  if (!localModels || typeof localModels !== 'object' || Array.isArray(localModels)) return ''
  const lines = []
  for (const [repo, path] of Object.entries(localModels)) {
    if (typeof repo !== 'string' || !repo.trim()) continue
    if (typeof path !== 'string' || !path.trim()) continue
    lines.push(`${repo.trim()}=${path.trim()}`)
  }
  return lines.join('\n')
}

/**
 * 脱敏设置视图 → 表单状态。
 * 注意 hfToken 永远从空串开始（视图本来就不回传原文），留空表示保持不变。
 */
export function formFromSettings(view) {
  const source = view && typeof view === 'object' ? view : {}
  const accelerator = SETTINGS.accelerators.includes(source.accelerator)
    ? source.accelerator
    : SETTINGS.defaultAccelerator
  return {
    idleMinutes: String(idleMinutesOf(source.idleTimeoutSec)),
    accelerator,
    hfToken: '',
    clearHfToken: false,
    datasetSourcesText: formatLineList(source.datasetSources),
    localModelsText: formatLocalModels(source.localModels),
    pipConstraintsText: formatLineList(source.pipConstraints),
  }
}

/** 表单校验：目前只有本地模型映射是行级强校验（非法行禁止保存）。 */
export function validateSettingsForm(form) {
  const source = form || {}
  const localModels = parseLocalModels(source.localModelsText)
  return {
    ok: localModels.errors.length === 0,
    errors: localModels.errors,
    localModels: localModels.value,
  }
}

function sameLineList(a, b) {
  return a.join('\n') === b.join('\n')
}

/**
 * 表单 → POST 请求体：只包含真正变化的字段。
 *
 * 语义约定：
 *  - hfToken 为空不提交；`clearHfToken` 只在用户点了「清除 Token」时单独提交；
 *  - 非法行的 localModels 不进入请求体（抽屉会先禁用保存，这里再兜一层）；
 *  - 视图缺字段时按等价默认值比较，不会因为字段缺失就产生一条空改动。
 */
export function buildSettingsPayload(form, view) {
  const source = form || {}
  const base = view && typeof view === 'object' ? view : {}
  const payload = {}

  const idleSeconds = idleTimeoutSecOf(source.idleMinutes)
  if (idleSeconds !== null && idleSeconds !== idleTimeoutSecOf(idleMinutesOf(base.idleTimeoutSec))) {
    payload.idleTimeoutSec = idleSeconds
  }

  const accelerator = SETTINGS.accelerators.includes(source.accelerator)
    ? source.accelerator
    : SETTINGS.defaultAccelerator
  const baseAccelerator = SETTINGS.accelerators.includes(base.accelerator)
    ? base.accelerator
    : SETTINGS.defaultAccelerator
  if (accelerator !== baseAccelerator) payload.accelerator = accelerator

  const token = typeof source.hfToken === 'string' ? source.hfToken.trim() : ''
  if (source.clearHfToken === true) payload.clearHfToken = true
  else if (token) payload.hfToken = token

  const datasets = parseLineList(source.datasetSourcesText)
  if (!sameLineList(datasets, parseLineList(formatLineList(base.datasetSources)))) {
    payload.datasetSources = datasets
  }

  const pip = parseLineList(source.pipConstraintsText)
  if (!sameLineList(pip, parseLineList(formatLineList(base.pipConstraints)))) {
    payload.pipConstraints = pip
  }

  const models = parseLocalModels(source.localModelsText)
  if (models.errors.length === 0 && formatLocalModels(models.value) !== formatLocalModels(base.localModels)) {
    payload.localModels = models.value
  }

  return payload
}

/** 请求体是否有改动（决定保存按钮是否可用）。 */
export function hasSettingsChanges(payload) {
  return Boolean(payload && typeof payload === 'object' && Object.keys(payload).length > 0)
}

/**
 * 设置请求错误的可读文案：网络层与未知 HTTP 状态不外抛浏览器原文，
 * 其余错误码沿用通用 errorText（会带 error.code.* 文案与远端 detail）。
 */
export function settingsErrorText(t, error) {
  if (!error) return ''
  if (error.code === 'network') return t('error.network')
  if (typeof error.code === 'string' && error.code.startsWith('http_')) return t('error.http')
  return errorText(t, error)
}

/**
 * 设置接口响应 → 脱敏视图。
 * 契约形状是 `{ ok: true, settings: view }`；形状不对返回 null，由抽屉给出可重试错误态。
 */
export function settingsViewOf(result) {
  if (!result || result.ok !== true || !result.data || typeof result.data !== 'object') return null
  const view = result.data.settings
  if (!view || typeof view !== 'object' || Array.isArray(view)) return null
  return view
}

/** Token 来源的文案键；未知来源按 none 处理。 */
export function hfTokenSourceKey(source) {
  const value = SETTINGS.hfTokenSources.includes(source) ? source : 'none'
  return `studio.settings.hfToken.sourceValue.${value}`
}
