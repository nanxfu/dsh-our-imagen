/**
 * 预设切换与提示词语言的纯逻辑。
 *
 * 切换预设要同时处理三件事：套用推荐尺寸 / 步数 / 引导强度、跟随新预设的负向提示词、
 * 以及判断当前提示词是否需要英文提醒。这些规则不碰 React 与网络，便于离线断言。
 */

import { LIMITS } from '../../shared/contract.js'

import { clampInt, clampNumber, clampSize } from './clamp.js'

/** 提示词是否含中日韩字符。 */
export function detectCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text ?? ''))
}

/**
 * 当前预设是否需要英文提示词。
 *
 * 九个预设都按英文提示词训练；保留 `chinese` 作为将来「原生中文模型」的显式豁免值，
 * 目前没有预设使用它，因此含中文的提示词对所有现役预设都会提示（只是软提示，不拦截生成）。
 */
export function presetNeedsEnglish(preset) {
  if (!preset || typeof preset !== 'object') return true
  return preset.promptStyle !== 'chinese'
}

function hintOf(preset) {
  return preset && typeof preset.negativeHint === 'string' ? preset.negativeHint.trim() : ''
}

/**
 * 切换预设 → 表单补丁。
 *
 * 负向提示词的跟随规则：只有用户没写过（空）或仍然等于上一个预设的推荐值时才换成
 * 新预设的 negativeHint；用户自己写过的负向提示词不动。
 */
export function presetSelectPatch(next, current, presets) {
  const target = next && typeof next === 'object' && next.id ? next : null
  if (!target) return {}
  const form = current && typeof current === 'object' ? current : {}
  const patch = {
    presetId: target.id,
    width: clampSize(target.size || form.width),
    height: clampSize(target.size || form.height),
  }
  const steps = clampInt(target.steps, LIMITS.steps.min, LIMITS.steps.max, null)
  if (steps !== null) patch.steps = steps
  const cfg = clampNumber(target.cfg, LIMITS.cfg.min, LIMITS.cfg.max, null)
  if (cfg !== null) patch.cfg = cfg

  const hint = hintOf(target)
  const list = Array.isArray(presets) ? presets : []
  const previous = list.find((item) => item && item.id === form.presetId)
  const negative = typeof form.negative === 'string' ? form.negative.trim() : ''
  if (hint && (!negative || negative === hintOf(previous))) patch.negative = hint
  return patch
}
