/**
 * 对话意图的纯逻辑：找上一轮描述、把解析结果映射成表单补丁与请求参数。
 *
 * 宿主返回的意图只描述「要画什么、用什么比例和风格」；
 * 这里不碰网络与 React，方便离线断言合并规则。
 */

import { LIMITS } from '../../shared/contract.js'

/**
 * 意图确认卡上可直接编辑的字段。
 *
 * 比例与风格仍由澄清卡或当前设置决定，这里不开放，避免编辑动作变成任意状态写入口。
 */
export const INTENT_EDITABLE_FIELDS = ['prompt', 'negative']

/** 最近一条意图卡里的画面描述；没有就返回空串。 */
export function lastIntentPrompt(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message
      && message.role === 'assistant'
      && message.kind === 'intent'
      && typeof message.prompt === 'string'
      && message.prompt.trim()
    ) {
      return message.prompt.trim()
    }
  }
  return ''
}

/** 意图 → 表单补丁：提示词、像素尺寸、风格 id 与卡片上的排除项。 */
export function intentFormPatch(intent, ratios) {
  const patch = {}
  if (!intent || typeof intent !== 'object') return patch
  const prompt = typeof intent.prompt === 'string' ? intent.prompt.trim() : ''
  if (prompt) patch.prompt = prompt
  const ratio = (Array.isArray(ratios) ? ratios : []).find((item) => item && item.id === intent.ratioId)
  if (ratio) {
    patch.width = ratio.width
    patch.height = ratio.height
  }
  if (typeof intent.styleId === 'string' && intent.styleId) patch.styleId = intent.styleId
  // 卡片上的排除项可能被用户改过：落表单时以卡片当前值为准，避免表单与本次提交不一致。
  if (typeof intent.negative === 'string') patch.negative = intentNegative(intent.negative)
  return patch
}

/**
 * 意图 → 最终提示词：带上风格后缀。
 * 对话提交的提示词是显式值，不会再走表单的 composePrompt 拼接，
 * 所以风格词必须在这里合并进去。
 */
export function intentPrompt(intent, capsules) {
  const base = String(intent && intent.prompt ? intent.prompt : '').trim()
  if (!base) return ''
  const capsule = (Array.isArray(capsules) ? capsules : []).find((item) => item && item.id === intent.styleId)
  return capsule ? `${base}, ${capsule.suffix}` : base
}

/**
 * 意图卡字段编辑补丁：字段白名单 + 按契约裁剪。
 *
 * textarea 的 maxLength 只是浏览器行为，粘贴与程序化赋值仍可能超限；
 * 非白名单字段返回 null，调用方应忽略这次编辑。
 */
export function intentFieldPatch(field, value) {
  if (!INTENT_EDITABLE_FIELDS.includes(field)) return null
  const text = typeof value === 'string' ? value : ''
  const max = field === 'prompt' ? LIMITS.prompt.maxChars : LIMITS.negativePrompt.maxChars
  return { [field]: text.slice(0, max) }
}

/** 负向提示词兜底：去首尾空白并按契约上限裁剪；非字符串按空串处理。 */
export function intentNegative(value) {
  return (typeof value === 'string' ? value.trim() : '').slice(0, LIMITS.negativePrompt.maxChars)
}

/**
 * 意图卡 → 生成覆盖项。
 *
 * 提示词仍是「编辑后的卡片文本 + 风格后缀」；负向提示词以卡片当前值为准，
 * 空串也显式覆盖——用户在卡上清空排除项，就应该真的不带负向词。
 * 返回 null 表示提示词为空，调用方应拦下生成。
 */
export function intentOverrides(intent, capsules) {
  const prompt = intentPrompt(intent, capsules)
  if (!prompt) return null
  return { prompt, negativePrompt: intentNegative(intent && intent.negative) }
}

/** 上一张图可复用的种子；缺失或非法返回 null。 */
export function lastSeedOf(lastJob) {
  const params = (lastJob && lastJob.params) || null
  const seed = params ? Number(params.seed) : NaN
  return Number.isFinite(seed) && seed >= 0 ? Math.trunc(seed) : null
}

/**
 * 意图卡提交时的种子覆盖：默认随机（返回 null，不写 seed）。
 *
 * 跨主题对话沿用上一张的种子会让构图僵化，所以只有用户显式打开「沿用上张构图」、
 * 且表单里没有指定种子时才继承上一张；表单写了种子以用户输入为准。
 */
export function intentSeedOf(intent, lastJob, formSeed) {
  if (!intent || intent.lockSeed !== true) return null
  const explicit = typeof formSeed === 'string' ? formSeed.trim() !== '' : formSeed !== null && formSeed !== undefined
  if (explicit) return null
  return lastSeedOf(lastJob)
}
