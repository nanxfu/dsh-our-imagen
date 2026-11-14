/**
 * 预设切换、分辨率档位与提示词语言的纯逻辑。
 *
 * 切换预设要同时处理三件事：套用推荐尺寸 / 步数 / 引导强度、替换模型负向词层、
 * 判断当前提示词是否需要英文提醒。分辨率档位按「长边」定义，短边跟随当前画幅比例
 * 换算；这些规则不碰 React 与网络，便于离线断言。
 *
 * 0.10.0 起不再有静态风格预设：这里不处理风格层与风格后缀。
 */

import { DEFAULT_PRESET, LIMITS, RATIO_IDS } from '../../shared/contract.js'
import { negativePromptActive } from '../../shared/models-guide.js'

import { clampInt, clampNumber, clampSize } from './clamp.js'
import { negativeLayersPatch, resolveNegativeLayers } from './prompt.js'

/** 提示词是否含中日韩字符。 */
export function detectCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text ?? ''))
}

/** 最大公约数：用于把像素宽高约分成最简长宽比。 */
function gcd(left, right) {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

/**
 * 画面尺寸 → 画幅比例 id（契约 `RATIO_IDS` 之一，匹配不上返回空串）。
 *
 * 高亮反馈必须按「画幅」而不是按像素精确相等：`768 × 768` 和 `1024 × 1024` 都是 1:1，
 * 点方形档 `768` 之后上方「1:1」应当保持高亮；`800 × 600` 同样是 4:3。
 * 用最大公约数约分成最简比再比对，避免浮点容差带来「相近就算匹配」的歧义。
 */
export function ratioIdOf(width, height) {
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return ''
  const divisor = gcd(w, h)
  const id = `${w / divisor}:${h / divisor}`
  return RATIO_IDS.includes(id) ? id : ''
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
 * 预设的分辨率档位（长边）：`sizeOptions` 是「长边像素」数组，与画幅比例是两行不同概念。
 *
 * 读到非法值（非数字 / 非正数）直接丢弃，统一按契约边界钳制并去重、升序排列；
 * 旧预设没有 `sizeOptions` 时回退到预设自身的 `size`，保证总有一档可选。
 */
export function sizeTiersOf(preset) {
  const source = preset && typeof preset === 'object' ? preset : {}
  const raw = Array.isArray(source.sizeOptions) ? source.sizeOptions : []
  const tiers = []
  for (const value of raw) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) continue
    const tier = clampSize(number)
    if (!tiers.includes(tier)) tiers.push(tier)
  }
  if (tiers.length === 0) {
    const fallback = Number(source.size)
    if (Number.isFinite(fallback) && fallback > 0) tiers.push(clampSize(fallback))
  }
  return tiers.sort((left, right) => left - right)
}

/** 比例入参归一：接受 `{ width, height }`、`{ id }` 或契约比例字符串。 */
function ratioSpecOf(ratio) {
  if (ratio && typeof ratio === 'object') {
    const width = Number(ratio.width)
    const height = Number(ratio.height)
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height }
    }
  }
  const raw = typeof ratio === 'string' ? ratio : String((ratio && ratio.id) || '')
  const parts = raw.split(':').map((part) => Number(part))
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return { width: parts[0], height: parts[1] }
  return null
}

/**
 * 画幅比例 + 长边档位 → 宽高。
 *
 * 长边取档位值；短边按比例四舍五入并对齐契约步长（`LIMITS.width.step`），
 * 最后统一按契约边界钳制。比例缺失时退化为正方形（长边即宽高）。
 */
export function tierPatchOf(ratio, tier) {
  const long = clampSize(tier)
  const spec = ratioSpecOf(ratio)
  if (!spec || spec.width === spec.height) return { width: long, height: long }
  if (spec.width > spec.height) {
    return { width: long, height: clampSize(Math.round((long * spec.height) / spec.width)) }
  }
  return { width: clampSize(Math.round((long * spec.width) / spec.height)), height: long }
}

/**
 * 当前宽高命中的长边档位；长边不在给定档位里（手动改过宽高）时返回 null。
 */
export function selectedTierOf(width, height, tiers) {
  const list = Array.isArray(tiers) ? tiers : []
  const long = Math.max(clampSize(width), clampSize(height))
  return list.includes(long) ? long : null
}

/**
 * 自定义宽高补丁：只处理传入的字段（宽或高单独改），按契约边界与步长钳制。
 * 传给 `patchForm()` 后分别更新宽/高，比例行与档位的选中态由尺寸反推。
 *
 * 空串 / null 交给 `clampSize` 的缺失值约定（回退 1024）；「清空后失焦恢复原值」
 * 属于输入框编辑态，由 Rail 的局部草稿层处理，不在这里兜。
 */
export function customSizePatch(partial) {
  const input = partial && typeof partial === 'object' ? partial : {}
  const patch = {}
  if (Object.prototype.hasOwnProperty.call(input, 'width')) patch.width = clampSize(input.width)
  if (Object.prototype.hasOwnProperty.call(input, 'height')) patch.height = clampSize(input.height)
  return patch
}

/**
 * 预设是否支持垫图重绘（图生图）。
 *
 * `supportsImg2Img` 由宿主 `/state.presets` 下发；旧宿主没有这个字段，
 * 一律按不支持处理。只有用户主动放参考图时才用它判断，文生图流程不受影响。
 */
export function supportsImg2Img(preset) {
  return Boolean(preset && preset.supportsImg2Img === true)
}

/**
 * 参考图兜底预设：优先 `sdxl-lightning`，否则列表里第一个支持图生图的预设。
 * 一个都没有（旧宿主 / 预设都没声明能力）时返回 null，由调用方明确提示。
 */
export function referencePresetOf(presets) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : []
  const preferred = list.find((item) => item.id === DEFAULT_PRESET)
  if (preferred && supportsImg2Img(preferred)) return preferred
  return list.find(supportsImg2Img) || null
}

/**
 * 切换预设 → 表单补丁。
 *
 * 负向提示词的跟随规则（按层）：
 *  - model 层：新预设在当前 CFG 下「真的会消费负向词」时写入其 negativeHint，
 *    否则清空（默认 CFG=0 的极速模型、无负向能力的模型都不该挂着一串不发出去的词）；
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
  // 负向模型层只在「该预设 + 本次生效的 CFG」下真的可用时才写入。
  const effectiveCfg = cfg !== null ? cfg : form.cfg
  const nextLayers = {
    ...layers,
    model: negativePromptActive(target, effectiveCfg) ? hintOf(target) : '',
  }
  // 两层数据与合并后的展示文本一起进补丁，表单状态不会出现半同步。
  Object.assign(patch, negativeLayersPatch(nextLayers))
  return patch
}
