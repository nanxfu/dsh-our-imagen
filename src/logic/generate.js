/**
 * 生成参数的构造与回填。
 *
 * 两个方向都收敛在这里，避免「请求体构造」与「历史回填」各占一个碎屑文件：
 *  - `buildGenerateBody()`：表单值 + 风格后缀 + 显式覆盖项 → POST /generate 请求体；
 *  - `iteratePatch()` / `rerollOverrides()` / `retryOverrides()`：当前选中的作品或
 *    失败任务 → 表单补丁 / 生成参数覆盖项。
 *
 * 抽到 logic/ 是为了让「风格后缀真的进入最终 prompt」「历史图能复现」这类行为可以
 * 离线断言，useStudio 只负责收集状态与发起请求。
 */

import { LIMITS } from '../../shared/contract.js'
import { clampInt, clampNumber, clampSize, parseSeed } from './clamp.js'
import { composePrompt } from './prompt.js'

/**
 * @param {object} form 表单状态
 * @param {object} [options]
 * @param {string} [options.styleSuffix] 当前风格后缀（仅在没有显式 prompt 时追加）
 * @param {string} [options.defaultPreset] 预设兜底 id
 * @param {object} [options.overrides] 显式覆盖项（对话输入 / 生成变体 / 重试）
 * @returns {object} POST /generate（路径由 shared/contract.js 提供）的请求体
 */
export function buildGenerateBody(form, options = {}) {
  const input = form || {}
  const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : null
  const explicit = overrides && typeof overrides.prompt === 'string' ? overrides.prompt : null
  const maxPromptChars = LIMITS.prompt.maxChars
  const prompt = explicit !== null
    ? explicit.trim().slice(0, maxPromptChars)
    : composePrompt(input.prompt, options.styleSuffix).slice(0, maxPromptChars)

  const body = {
    prompt,
    negativePrompt: String(input.negative ?? '').trim(),
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

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'prompt') continue
      body[key] = value
    }
  }
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
 * steps/cfg 优先作品 params，其次预设推荐值；styleId 清空，避免后缀重复。
 */
export function iteratePatch(entry, form, presets) {
  const base = form || {}
  const recall = recallOf(entry, presets)
  const patch = {}

  const prompt = recall.prompt.trim()
  // 回填的是作品自己的最终提示词（通常已含风格后缀），因此清空风格选择避免重复追加。
  if (prompt) {
    patch.prompt = prompt
    patch.styleId = ''
  }
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
