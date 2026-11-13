/**
 * 预设切换与提示词语言的纯逻辑。
 *
 * 切换预设要同时处理四件事：套用推荐尺寸 / 步数 / 引导强度、替换模型负向词层、
 * 从预设的 sizeOptions 得到方形尺寸档位、以及判断当前提示词是否需要英文提醒。
 * 这些规则不碰 React 与网络，便于离线断言。
 */

import { LIMITS } from '../../shared/contract.js'

import { clampInt, clampNumber, clampSize } from './clamp.js'
import { negativeLayersPatch, resolveNegativeLayers } from './prompt.js'

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
 * 预设的方形尺寸档位：`sizeOptions` 是「等宽高的方形尺寸数组」，与画幅比例是两行不同概念。
 *
 * 读到非法值（非数字 / 非正数）直接丢弃，统一按契约边界钳制并去重、升序排列；
 * 旧预设没有 `sizeOptions` 时回退到预设自身的 `size`，保证总有一档可选。
 */
export function presetSizeOptions(preset) {
  const source = preset && typeof preset === 'object' ? preset : {}
  const raw = Array.isArray(source.sizeOptions) ? source.sizeOptions : []
  const options = []
  for (const value of raw) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) continue
    const size = clampSize(number)
    if (!options.includes(size)) options.push(size)
  }
  if (options.length === 0) {
    const fallback = Number(source.size)
    if (Number.isFinite(fallback) && fallback > 0) options.push(clampSize(fallback))
  }
  return options.sort((left, right) => left - right)
}

/**
 * 自定义宽高补丁：只处理传入的字段（宽或高单独改），按契约边界与步长钳制。
 * 传给 `patchForm()` 后分别更新宽/高，比例行与方形档位的选中态由尺寸反推。
 */
export function customSizePatch(partial) {
  const input = partial && typeof partial === 'object' ? partial : {}
  const patch = {}
  if (Object.prototype.hasOwnProperty.call(input, 'width')) patch.width = clampSize(input.width)
  if (Object.prototype.hasOwnProperty.call(input, 'height')) patch.height = clampSize(input.height)
  return patch
}

/**
 * 切换预设 → 表单补丁。
 *
 * 负向提示词的跟随规则（按层）：
 *  - model 层整层替换为新预设的 negativeHint；新预设没有推荐值时清空，
 *    不再残留上一个预设的旧词；
 *  - style 层只在风格仍选中时保留（取消风格由 toggleStyle 处理）；
 *  - user 层原样保留。
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

  const list = Array.isArray(presets) ? presets : []
  const layers = resolveNegativeLayers(form, list)
  const nextLayers = {
    ...layers,
    model: hintOf(target),
    // 没有选中风格时 style 层不应存在；切换预设不负责清除仍选中风格的词。
    style: form.styleId ? layers.style : '',
  }
  // 三层数据与合并后的展示文本一起进补丁，表单状态不会出现半同步。
  Object.assign(patch, negativeLayersPatch(nextLayers))
  return patch
}
