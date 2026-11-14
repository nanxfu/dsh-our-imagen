/**
 * 生成参数的构造与回填。
 *
 * 两个方向都收敛在这里，避免「请求体构造」与「历史回填」各占一个碎屑文件：
 *  - `buildGenerateBody()`：表单值 + 显式覆盖项 → POST /generate 请求体；
 *  - `iteratePatch()` / `rerollOverrides()` / `retryOverrides()`：当前选中的作品或
 *    失败任务 → 表单补丁 / 生成参数覆盖项。
 *
 * 0.10.0 起提示词不再拼接风格后缀；负向词按 `negativePromptActive` 的结果门控，
 * 当前模型/CFG 不消费负向词时提交空串，不发无效参数。
 */

import { LIMITS } from '../../shared/contract.js'
import { clampInt, clampNumber, clampSize, clampStrength, parseSeed } from './clamp.js'
import { negativeForSubmit } from './prompt.js'

/** 参考图的文件名：路径只用于向宿主定位作品，界面只显示文件名。 */
export function referenceFileName(path) {
  const value = String(path ?? '').trim()
  if (!value) return ''
  const parts = value.split(/[\\/]/)
  return parts[parts.length - 1] || value
}

/**
 * 表单里的参考图 → 可提交的工作区相对路径。
 *
 * 参考图由「以此图重绘」从画廊条目写入（`{ path, url }`）：`path` 与
 * `/imagen-api/file?path=` 使用同一口径，`url` 只用于界面缩略图，绝不进请求体。
 * 没有可用路径时返回空串，按普通文生图处理（不产生 reference 字段）。
 */
export function referencePathOf(form) {
  const input = form && typeof form === 'object' ? form : {}
  const reference = input.reference && typeof input.reference === 'object' ? input.reference : null
  return reference && typeof reference.path === 'string' ? reference.path.trim() : ''
}

/**
 * @param {object} form 表单状态
 * @param {object} [options]
 * @param {string} [options.defaultPreset] 预设兜底 id
 * @param {boolean} [options.negativeActive] `negativePromptActive()` 的结果；
 *   显式 false 时提交体 `negativePrompt` 恒为空串（含覆盖项里的负向词）
 * @param {object} [options.overrides] 显式覆盖项（对话输入 / 生成变体 / 重试）
 * @returns {object} POST /generate（路径由 shared/contract.js 提供）的请求体
 */
export function buildGenerateBody(form, options = {}) {
  const input = form || {}
  const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : null
  const negativeActive = options.negativeActive !== false
  const explicit = overrides && typeof overrides.prompt === 'string' ? overrides.prompt : null
  const maxPromptChars = LIMITS.prompt.maxChars
  const prompt = explicit !== null
    ? explicit.trim().slice(0, maxPromptChars)
    : String(input.prompt ?? '').trim().slice(0, maxPromptChars)

  const body = {
    prompt,
    negativePrompt: negativeForSubmit(input, negativeActive),
    width: clampSize(input.width),
    height: clampSize(input.height),
    steps: clampInt(input.steps, LIMITS.steps.min, LIMITS.steps.max, 4),
    cfg: clampNumber(input.cfg, LIMITS.cfg.min, LIMITS.cfg.max, 0),
    seed: parseSeed(input.seed),
    count: clampInt(input.count, LIMITS.count.min, LIMITS.count.max, 1),
    waitSeconds: 0,
    autoStart: true,
  }
  const presetId = input.presetId || options.defaultPreset || ''
  if (presetId) body.presetId = presetId

  // 图生图：只有表单里确实有参考图才输出 reference；否则请求体与纯文生图逐字一致。
  // 覆盖项也能改这两个字段（重试 / 变体链路），走同一套归一规则。
  const hasOverride = (key) => overrides !== null && Object.prototype.hasOwnProperty.call(overrides, key)
  const referencePath = referencePathOf({
    reference: hasOverride('reference') ? overrides.reference : input.reference,
  })
  if (referencePath) {
    const strength = hasOverride('strength') ? overrides.strength : input.strength
    body.reference = { path: referencePath, strength: clampStrength(strength) }
  }

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      // prompt 已在上面处理；reference / strength 只经归一后进入 body，避免把 url 带出去。
      if (key === 'prompt' || key === 'reference' || key === 'strength') continue
      body[key] = value
    }
  }
  // 覆盖项也可能带 negativePrompt（对话 / 变体 / 重试链路）：当前配置不消费负向词时
  // 统一清空，保证请求体不出现无效参数。
  if (!negativeActive) body.negativePrompt = ''
  return body
}

// ---- 历史回填 -------------------------------------------------------------
//
// 真实 Host 的 history 接口条目只保证有 jobId / createdAt / presetId / prompt / images，
// 不一定带 params；所以回填以 item.prompt / image.width / image.height 为第一来源，
// params 只补 steps / cfg 这类作品本身没记录的字段，预设推荐值作最后兜底。
// 任何一条都不依赖「最近完成的任务」。

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveSize(value) {
  const number = finiteNumber(value)
  if (number === null || number <= 0) return null
  return Math.round(number)
}

function presetOf(presets, id) {
  if (!id || !Array.isArray(presets)) return null
  return presets.find((item) => item && item.id === id) || null
}

function recallOf(entry, presets) {
  const image = (entry && entry.image) || null
  const item = (entry && entry.item) || null
  const params = (item && item.params) || null
  const presetId = (item && item.presetId) || ''
  const preset = presetOf(presets, presetId)
  const prompt = (item && typeof item.prompt === 'string' && item.prompt)
    || (params && typeof params.prompt === 'string' && params.prompt)
    || ''
  const width = positiveSize(image && image.width)
    ?? positiveSize(params && params.width)
    ?? positiveSize(preset && preset.size)
  const height = positiveSize(image && image.height)
    ?? positiveSize(params && params.height)
    ?? positiveSize(preset && preset.size)
  const steps = finiteNumber(params && params.steps) ?? finiteNumber(preset && preset.steps)
  const cfg = finiteNumber(params && params.cfg) ?? finiteNumber(preset && preset.cfg)
  const seed = finiteNumber(image && image.seed) ?? finiteNumber(params && params.seed)
  const negative = params && typeof params.negativePrompt === 'string' ? params.negativePrompt : null
  return { image, item, params, presetId, prompt, width, height, steps, cfg, seed, negative }
}

/**
 * 「带回参数」→ 表单补丁。
 * prompt 用作品自己的提示词；尺寸用产物像素（不再用最近任务兜底）；
 * steps/cfg 优先作品 params，其次预设推荐值。
 */
export function iteratePatch(entry, form, presets) {
  const base = form || {}
  const recall = recallOf(entry, presets)
  const patch = {}

  const prompt = recall.prompt.trim()
  if (prompt) patch.prompt = prompt
  if (recall.negative !== null) patch.negative = recall.negative
  if (recall.width !== null) patch.width = recall.width
  if (recall.height !== null) patch.height = recall.height
  if (recall.steps !== null) patch.steps = recall.steps
  if (recall.cfg !== null) patch.cfg = recall.cfg
  if (recall.seed !== null && recall.seed >= 0) patch.seed = String(Math.trunc(recall.seed))
  if (recall.presetId) patch.presetId = recall.presetId
  return patch
}

/**
 * 「生成变体」→ 生成参数覆盖项：保持该图的 prompt / 尺寸 / steps / cfg / 预设，
 * 只把 seed 换成随机（-1），并按「再画一张」把张数固定为 1。
 * 没有可用的提示词时返回 null，由调用方给可见提示。
 */
export function rerollOverrides(entry, presets) {
  const recall = recallOf(entry, presets)
  const prompt = recall.prompt.trim()
  if (!prompt) return null
  const overrides = { prompt, seed: -1, count: 1 }
  if (recall.negative !== null) overrides.negativePrompt = recall.negative
  if (recall.width !== null) overrides.width = recall.width
  if (recall.height !== null) overrides.height = recall.height
  if (recall.steps !== null) overrides.steps = recall.steps
  if (recall.cfg !== null) overrides.cfg = recall.cfg
  if (recall.presetId) overrides.presetId = recall.presetId
  return overrides
}

/**
 * 「重试一次」→ 生成参数覆盖项：优先按失败任务的参数重试；
 * 没有任务时也可以传上一次提交的 body（pendingRef）作为来源。
 */
export function retryOverrides(source) {
  const holder = source && typeof source === 'object' ? source : null
  if (!holder) return null
  const params = holder.params && typeof holder.params === 'object' ? holder.params : holder
  const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
  if (!prompt) return null

  const overrides = { prompt, seed: -1 }
  const count = finiteNumber(params.count)
  if (count !== null) overrides.count = Math.min(4, Math.max(1, Math.round(count)))
  const width = positiveSize(params.width)
  const height = positiveSize(params.height)
  if (width !== null) overrides.width = width
  if (height !== null) overrides.height = height
  const steps = finiteNumber(params.steps)
  const cfg = finiteNumber(params.cfg)
  if (steps !== null) overrides.steps = steps
  if (cfg !== null) overrides.cfg = cfg
  if (typeof params.negativePrompt === 'string') overrides.negativePrompt = params.negativePrompt
  const presetId = holder.presetId || params.presetId || ''
  if (presetId) overrides.presetId = presetId
  return overrides
}
