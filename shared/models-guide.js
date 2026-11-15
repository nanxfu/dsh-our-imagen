/**
 * 模型知识的统一口径：把 `models/*.json`（经 `shared/contract.js` 的 publicPresets() 下发）
 * 整理成提示词规则、负向词能力、模型用法摘要，供三处复用：
 *
 *  - Host 助手层（`lib/intent.js`、`lib/enhance.js`、`lib/tools.js`）：告诉大模型每款模型
 *    该怎么写提示词、能不能用负向词、适合什么场景；
 *  - Client（`src/logic/preset.js` 等）：决定「排除项」是否展示、提交时是否携带；
 *  - 测试：直接断言规则本身，不必重复抄一份模型事实。
 *
 * 本文件只允许纯数据与纯函数，不得 import `node:*`，也不在这里写死模型清单
 * （唯一来源是 `models/*.json`）。
 */

import { LIMITS, publicPresets } from './contract.js'

const PROMPT_STYLE_NAMES = {
  danbooru: 'Danbooru 标签',
  natural: '自然语言',
  concise: '简短短语',
}

/** 提示词配方的展示名；未知值回落到「通用英文」。 */
export function promptStyleName(style) {
  return PROMPT_STYLE_NAMES[style] ?? '通用英文'
}

/**
 * 当前模型的提示词书写规则（中文，直接进 system prompt）。
 *
 * 参数来自模型资产的 `promptStyle` 与 `qualityPrefix`，不再由调用方手写分支；
 * 未知配方回落到通用英文要求。
 */
export function promptStyleRule(preset) {
  const style = preset && typeof preset === 'object' && preset.promptStyle ? preset.promptStyle : ''
  const prefix = preset && typeof preset.qualityPrefix === 'string' ? preset.qualityPrefix.trim() : ''
  if (style === 'danbooru') {
    const head = prefix ? `质量词前缀固定为「${prefix}」，写在最前面；` : ''
    return `按 Danbooru 标签风格书写：${head}随后依次是主体、外观、场景、构图、光影，全部是英文逗号分隔的短语，不要写完整句子。`
  }
  if (style === 'natural') {
    const head = prefix ? `先写质量词「${prefix}」，再写画面；` : ''
    return `用英文自然语言段落书写：${head}一到两句完整句子写清主体、环境、光线、材质与镜头。`
  }
  if (style === 'concise') {
    const head = prefix ? `质量词前缀「${prefix}」；` : ''
    return `用简短英文短语书写（约 25 个词以内）：${head}优先主体、场景与光影，避免堆砌形容词与修辞。`
  }
  return '用英文书写，具体、可直接用于文生图。'
}

function effectiveCfgOf(preset, cfg) {
  const value = Number(cfg)
  if (Number.isFinite(value)) return value
  const recommended = Number(preset && preset.cfg)
  return Number.isFinite(recommended) ? recommended : 0
}

/**
 * 当前配置下是否应该使用负向提示词（Host 与 Client 共用，禁止各写一份）。
 *
 * 规则：
 *  1. 预设缺失（旧宿主 / 尚未拿到预设）时只看 `cfg > 0`；
 *  2. 预设声明了 `supportsNegative` 时以它为准；旧宿主预设没有该字段时，
 *     用「`negativeHint` 非空」兜底判断管线是否消费负向词；
 *  3. 必须 `cfg > 0`（CFG=0 的模型会忽略 negative_prompt）；
 *  4. 且满足：模型自带推荐负向词，或用户把 CFG 抬到了推荐值以上。
 *
 * 因此默认 4 步极速模型（cfg=0）与 FLUX.2（管线无 negative_prompt）默认隐藏排除项；
 * 用户主动抬高 CFG 后出现，恢复默认后再次隐藏。
 */
export function negativePromptActive(preset, cfg) {
  const effective = effectiveCfgOf(preset, cfg)
  if (!preset || typeof preset !== 'object') return effective > 0
  const capable = typeof preset.supportsNegative === 'boolean'
    ? preset.supportsNegative
    : typeof preset.negativeHint === 'string' && preset.negativeHint.trim() !== ''
  if (!capable || effective <= 0) return false
  const hint = typeof preset.negativeHint === 'string' ? preset.negativeHint.trim() : ''
  if (hint) return true
  const recommended = Number(preset.cfg)
  return Number.isFinite(recommended) && effective > recommended
}

/**
 * 给大模型的负向词指导（中文一句话）。
 *
 * 关键目的：不要让模型把「不要文字」直译成 `no text` 写进正向提示词——扩散模型里
 * 否定词往往适得其反；无负向能力时应改写为正面视觉描述。
 */
export function negativeGuidance(preset, cfg) {
  if (!preset || typeof preset !== 'object') {
    return '模型信息未知：不要输出 negative，按正面描述书写，用「干净/空旷/无遮挡」这类正面视觉表达排除意图。'
  }
  const limit = LIMITS.negativePrompt.maxChars
  if (preset.supportsNegative !== true) {
    return `该模型管线不接受负向提示词：negative 必须是空字符串，用正面视觉描述表达排除意图（如 clean background、empty street、unobstructed view），不要把 no xxx 写进正向提示词（不超过 ${limit} 字符）。`
  }
  if (!negativePromptActive(preset, cfg)) {
    const effective = effectiveCfgOf(preset, cfg)
    return `当前配置（CFG=${effective}）下负向词不生效：negative 必须是空字符串；用正面视觉描述表达排除意图，不要在正向提示词里写 no xxx。`
  }
  return `当前模型支持负向词：只在用户明确表达「不要 X」时，把对应的英文负面短语写进 negative（逗号分隔，不超过 ${limit} 字符）；用户没有否定诉求时 negative 留空。`
}

function finiteSeconds(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? `${number.toFixed(1)} 秒` : ''
}

/**
 * 单模型用法摘要（中文一行）。用于 system prompt、Agent 工具描述与测试断言。
 *
 * 例：`SDXL Lightning（sdxl-lightning，SDXL）：4 步极速 · 约 6.2 秒/张 ·
 * 提示词写法：简短短语 · 默认 CFG 0（不使用负向词）· 支持垫图 · 定位：4 步极速出图，平衡画质与耗时`
 */
export function modelUsageLine(preset) {
  if (!preset || typeof preset !== 'object' || !preset.id) return ''
  const label = preset.label || preset.id
  const family = preset.family ? `，${preset.family}` : ''
  const seconds = finiteSeconds(preset.steadySeconds)
  const description = preset.description && (preset.description.zh || preset.description.en)
  const cfg = Number(preset.cfg)
  const cfgText = Number.isFinite(cfg) ? `${cfg}` : '—'
  const negative = preset.supportsNegative === true
    ? (negativePromptActive(preset, cfg) ? '可用负向词' : '负向词默认留空')
    : '不支持负向词'
  const parts = [
    `${label}（${preset.id}${family}）`,
    `${preset.steps ?? '—'} 步`,
    seconds ? `约 ${seconds}/张` : '',
    `提示词写法：${promptStyleName(preset.promptStyle)}`,
    `默认 CFG ${cfgText}（${negative}）`,
    preset.supportsImg2Img === true ? '支持垫图' : '',
    description ? `定位：${description}` : '',
  ].filter(Boolean)
  return `- ${parts.join(' · ')}`
}

/** 全部模型的一行摘要（每行一个，供 system prompt / 工具描述直接拼接）。 */
export function modelCatalogText() {
  return publicPresets().map(modelUsageLine).filter(Boolean).join('\n')
}

/**
 * 步数控制模式（按模型类型分治）：
 *  - 'range'：多步可调模型（usable 且声明了完整 stepRange），前端展示连续滑块与三档刻度；
 *  - 'fixed'：蒸馏 / 极速锁步模型（fast 或未声明 stepRange），前端锁定为模型推荐步数。
 */
export function stepModeOf(preset) {
  const r = preset && typeof preset === 'object' ? preset.stepRange : null
  if (
    preset &&
    preset.tier === 'usable' &&
    r &&
    typeof r === 'object' &&
    Number.isFinite(Number(r.min)) &&
    Number.isFinite(Number(r.max)) &&
    Number.isFinite(Number(r.fast)) &&
    Number.isFinite(Number(r.balanced)) &&
    Number.isFinite(Number(r.fine)) &&
    Number(r.min) < Number(r.max)
  ) {
    return 'range'
  }
  return 'fixed'
}

/**
 * 当前步数所属的语义档位（用于滑块实时标签与刻度高亮）：
 *  - 'fixed'：锁步模型；
 *  - 'fast' / 'balanced' / 'fine'：较快 / 均衡 / 精绘。
 */
export function stepTierOf(preset, steps) {
  if (stepModeOf(preset) !== 'range') return 'fixed'
  const r = preset.stepRange
  const val = Number(steps)
  if (!Number.isFinite(val)) return 'balanced'
  const fastMid = (Number(r.fast) + Number(r.balanced)) / 2
  const fineMid = (Number(r.balanced) + Number(r.fine)) / 2
  if (val < fastMid) return 'fast'
  if (val <= fineMid) return 'balanced'
  return 'fine'
}

/**
 * OOM / 显存报错后的安全重置参数补丁：回退到当前选中预设自身的默认安全参数
 * （而不是硬编码成 1024 / 4 步 / CFG 1，以免把 RealVis 等多步模型打成 4 步半成品噪点图）。
 */
export function safeResetPatch(preset) {
  const rawSize = Number(preset?.size)
  const size = Number.isFinite(rawSize) && rawSize > 0
    ? Math.min(Math.max(Math.round(rawSize / LIMITS.width.step) * LIMITS.width.step, LIMITS.width.min), LIMITS.width.max)
    : 1024
  const rawSteps = Number(preset?.steps)
  const steps = Number.isFinite(rawSteps)
    ? Math.min(Math.max(Math.round(rawSteps), LIMITS.steps.min), LIMITS.steps.max)
    : 4
  const rawCfg = Number(preset?.cfg)
  const cfg = Number.isFinite(rawCfg)
    ? Math.min(Math.max(rawCfg, LIMITS.cfg.min), LIMITS.cfg.max)
    : 1
  return { width: size, height: size, steps, cfg }
}
