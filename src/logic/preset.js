/**
 * 预设切换与提示词语言的纯逻辑。
 *
 * 切换预设要同时处理三件事：按需初始化默认尺寸、套用推荐步数 / 引导强度、
 * 替换模型负向词层，并判断当前提示词是否需要英文提醒；这些规则不碰 React 与网络，
 * 便于离线断言。
 *
 * 0.10.0 起不再有静态风格预设：这里不处理风格层与风格后缀。
 */

import { DEFAULT_PRESET, LIMITS, RATIO_IDS } from '../../shared/contract.js'
import { negativePromptActive, providerIdOf } from '../../shared/models-guide.js'

// 算力来源能力位（providers）的判定口径在 `shared/models-guide.js`（Host 意图模型推荐
// 与 Client 界面共用同一份）：这里只做薄 re-export，本文件不再维护第二套实现。
export {
  presetAvailableForProvider,
  presetProviderRestrictionOf,
  presetProvidersOf,
  providerIdOf,
} from '../../shared/models-guide.js'

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
 * 原生支持中文的模型（`supportsChinese === true`，例如 FLUX.2-klein-4B）免于提示；
 * 仅按英文语料训练的 SDXL / Playground / Animagine / Anima 模型返回 true，提示用户使用英文或点击英译。
 */
export function presetNeedsEnglish(preset) {
  if (!preset || typeof preset !== 'object') return true
  if (preset.supportsChinese === true || preset.promptStyle === 'chinese') return false
  return true
}

/** 当前预设推荐的负向词；没有则空串。 */
export function hintOf(preset) {
  return preset && typeof preset.negativeHint === 'string' ? preset.negativeHint.trim() : ''
}

/**
 * 自定义宽高补丁：只处理传入的字段（宽或高单独改），按契约边界与步长钳制。
 * 传给 `patchForm()` 后分别更新宽/高，比例高亮由尺寸反推。
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
 * 预设是否支持局部重绘（Inpaint）。
 *
 * `supportsInpaint` 由宿主 `/state.presets` 下发（首期仅 SDXL 家族为 true），旧宿主
 * 没有这个字段一律按不支持处理：不显示涂抹入口、不提交蒙版，文生图与整图图生图不受影响。
 */
export function supportsInpaint(preset) {
  return Boolean(preset && preset.supportsInpaint === true)
}

/**
 * 预设是否是「专用局部重绘」权重（只能带蒙版使用）。
 *
 * `inpaintOnly` 由宿主 `/state.presets` 下发：这类底座（9 通道 inpaint 权重）不能文生图、
 * 也不能只放参考图做整图重绘；缺蒙版时客户端直接拦下并提示，宿主的入队校验还会兜一层。
 * 旧宿主没有该字段一律按普通模型处理，不影响既有流程。
 */
export function inpaintOnlyOf(preset) {
  return Boolean(preset && preset.inpaintOnly === true)
}

/**
 * 参考图兜底预设：优先 `sdxl-lightning`，否则列表里第一个支持图生图的预设。
 * 跳过 inpaintOnly（专用局部重绘）预设：它必须带蒙版，不适合当整图重绘的兜底。
 * 一个都没有（旧宿主 / 预设都没声明能力）时返回 null，由调用方明确提示。
 */
export function referencePresetOf(presets) {
  const list = Array.isArray(presets)
    ? presets.filter((item) => item && item.id && !inpaintOnlyOf(item))
    : []
  const preferred = list.find((item) => item.id === DEFAULT_PRESET)
  if (preferred && supportsImg2Img(preferred)) return preferred
  return list.find(supportsImg2Img) || null
}

// ---- 算力来源能力位（providers） ----------------------------------------
//
// 判定语义（见 shared/models-guide.js 的唯一口径）：
//  - 资产未声明 `providers`（或声明值全部非法）时视为两种来源都支持；
//  - 显式声明：只保留契约 `SETTINGS.providers` 白名单内的取值；
//  - 当前来源非法 / 缺失时按契约默认来源（kaggle）判断，不因脏值把模型全判不可用。
// 渲染层（模型卡置灰）与生成前预检（`generateCapabilityOf`）从这里取判定。

/** 算力来源展示名的字典键（模型卡角标 / 生成前预检提示共用）。 */
export function providerNameKeyOf(provider) {
  const id = providerIdOf(provider)
  return `studio.preset.providerName.${id}`
}

/**
 * 切换预设 → 表单补丁。
 *
 * 尺寸与画幅跟随原则：
 *  - 用户已经选过预设且当前宽高合法时，切模型保留当前画幅比例与像素尺寸，
 *    避免刚选好的 16:9 / 3:4 / 自定义宽高被切模型抹回 1:1；
 *  - 首次初始化（form.presetId 为空）或当前宽高缺失时，才回填预设默认尺寸。
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
  const hasActiveSize = Boolean(form.presetId) && Number(form.width) > 0 && Number(form.height) > 0
  const patch = {
    presetId: target.id,
  }
  if (!hasActiveSize) {
    patch.width = clampSize(target.size || form.width)
    patch.height = clampSize(target.size || form.height)
  } else {
    // 若从低分辨率模型（如 512×512 Turbo）切到最低安全尺寸更大的模型，按原画幅等比放大避免畸变。
    const options = Array.isArray(target.sizeOptions)
      ? target.sizeOptions.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : []
    const minSafe = options.length > 0 ? Math.min(...options) : 0
    const curW = Number(form.width)
    const curH = Number(form.height)
    const curLong = Math.max(curW, curH)
    const targetSize = clampSize(target.size || minSafe)
    if (minSafe > 0 && curLong > 0 && curLong < minSafe && targetSize > curLong) {
      const scale = targetSize / curLong
      patch.width = clampSize(curW * scale)
      patch.height = clampSize(curH * scale)
    }
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
