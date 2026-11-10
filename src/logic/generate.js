/**
 * 生成请求体构造：表单值 + 风格后缀 + 显式覆盖项。
 *
 * 抽到 logic/ 是为了让「风格后缀真的进入最终 prompt」这类行为可以离线断言，
 * useStudio 只负责收集状态与发起请求。
 */

import { clampInt, clampNumber, clampSize, parseSeed } from './clamp.js'
import { composePrompt } from './prompt.js'

/**
 * @param {object} form 表单状态
 * @param {object} [options]
 * @param {string} [options.styleSuffix] 当前风格后缀（仅在没有显式 prompt 时追加）
 * @param {string} [options.defaultPreset] 预设兜底 id
 * @param {object} [options.overrides] 显式覆盖项（对话输入 / 抽卡 / 重试）
 * @returns {object} POST /imagen-api/generate 的请求体
 */
export function buildGenerateBody(form, options = {}) {
  const input = form || {}
  const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : null
  const explicit = overrides && typeof overrides.prompt === 'string' ? overrides.prompt : null
  const prompt = explicit !== null
    ? explicit.trim().slice(0, 2000)
    : composePrompt(input.prompt, options.styleSuffix).slice(0, 2000)

  const body = {
    prompt,
    negativePrompt: String(input.negative ?? '').trim(),
    width: clampSize(input.width),
    height: clampSize(input.height),
    steps: clampInt(input.steps, 1, 60, 4),
    cfg: clampNumber(input.cfg, 0, 20, 0),
    seed: parseSeed(input.seed),
    count: clampInt(input.count, 1, 4, 1),
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