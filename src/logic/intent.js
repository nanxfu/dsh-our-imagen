/**
 * 对话意图的纯逻辑：多轮上下文、通用澄清 / 模型建议归一、确认卡字段与提交参数。
 *
 * 0.10.0 起意图只描述「要画什么、用什么比例与排除项」，不再有静态风格与后缀拼接；
 * 这里不碰网络与 React，方便离线断言归一与合并规则。
 */

import { LIMITS, RATIO_IDS } from '../../shared/contract.js'
import { historyMessages, normalizeClarify, normalizeModelHint } from '../../shared/validation.js'

/**
 * 意图确认卡上可直接编辑的字段：提示词、排除项、生成张数。
 *
 * 比例仍由当前设置或重新解析决定，这里不开放，避免编辑动作变成任意状态写入口。
 */
export const INTENT_EDITABLE_FIELDS = ['prompt', 'negative', 'count']

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

/**
 * 对话消息 → 意图请求的多轮上下文。
 *
 * 只取用户原话与助手意图卡上的英文提示词：任务气泡、错误气泡、结果缩略图与
 * 表单提交同步记录（`kind='form'`，只是界面展示，不是用户说过的话）都不进模型上下文。
 * 空内容丢弃，单条按契约截断，最后保留最近
 * `LIMITS.intentHistory.maxMessages` 条（首尾顺序不变）。
 */
export function intentHistory(messages) {
  if (!Array.isArray(messages)) return []
  const history = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    let role = ''
    let content = ''
    if (message.role === 'user') {
      // 带 kind 的用户记录（如 kind='form' 的表单提交同步）不是用户原话，不传给意图模型。
      if (message.kind) continue
      role = 'user'
      content = typeof message.text === 'string' ? message.text.trim() : ''
    } else if (message.role === 'assistant' && message.kind === 'intent') {
      role = 'assistant'
      const prompt = typeof message.prompt === 'string' ? message.prompt.trim() : ''
      const question = message.clarify && typeof message.clarify === 'object' && typeof message.clarify.question === 'string'
        ? message.clarify.question.trim()
        : ''
      if (prompt && question) {
        const suffix = `\n[Clarify] ${question}`
        const headLimit = Math.max(0, LIMITS.intentHistory.maxMessageChars - suffix.length)
        content = `${prompt.slice(0, headLimit).trimEnd()}${suffix}`
      } else {
        content = prompt || question
      }
    }
    if (role && content) history.push({ role, content })
  }
  return historyMessages(history)
}

/**
 * 生成张数归一：非有限数字回落 1，四舍五入后钳制到契约边界。
 * 卡片默认 1 张；分段控件与行内编辑都走这里，保证写进消息和提交的值一致。
 */
export function intentCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(LIMITS.count.max, Math.max(LIMITS.count.min, Math.round(number)))
}

/**
 * 通用澄清归一：委托 shared/validation.js 的 normalizeClarify。
 * 问题非空且至少 2 个去重选项才算有效澄清，否则返回 null。
 */
export function intentClarify(value) {
  return normalizeClarify(value)
}

/**
 * 模型建议归一：委托 shared/validation.js 的 normalizeModelHint。
 * 预设必须真实存在、不等于当前预设且理由非空；不满足就整条丢弃。
 */
export function intentModelHint(value, currentPresetId) {
  return normalizeModelHint(value, currentPresetId)
}

/** 比例归一：只接受契约里的比例 id，其余按「自动」处理。 */
export function intentRatio(value) {
  return typeof value === 'string' && RATIO_IDS.includes(value) ? value : ''
}

/**
 * 意图 → 表单补丁：提示词、像素尺寸、生成张数；排除项只在当前配置可用时写入。
 *
 * 不带 negativeActive 的旧调用方只拿到提示词与尺寸，不会把无效负向词写进表单。
 */
export function intentFormPatch(intent, ratios, options = {}) {
  const patch = {}
  if (!intent || typeof intent !== 'object') return patch
  const prompt = typeof intent.prompt === 'string' ? intent.prompt.trim() : ''
  if (prompt) patch.prompt = prompt
  const ratio = (Array.isArray(ratios) ? ratios : []).find((item) => item && item.id === intent.ratioId)
  if (ratio) {
    patch.width = ratio.width
    patch.height = ratio.height
  }
  patch.count = intentCount(intent.count)
  if (options && options.negativeActive === true) patch.negative = intentNegative(intent.negative)
  return patch
}

/**
 * 意图卡字段编辑补丁：字段白名单 + 按契约裁剪。
 *
 * textarea 的 maxLength 只是浏览器行为，粘贴与程序化赋值仍可能超限；
 * 非白名单字段返回 null，调用方应忽略这次编辑。
 */
export function intentFieldPatch(field, value) {
  if (!INTENT_EDITABLE_FIELDS.includes(field)) return null
  if (field === 'count') return { count: intentCount(value) }
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
 * - 提示词用卡上编辑后的文本，不再合并任何后缀；
 * - 负向词受 `negativeActive` 门控：当前模型/CFG 不消费负向词时一律空串，
 *   不把无效参数发给宿主；
 * - 张数钳制 1~4。
 * 返回 null 表示提示词为空，调用方应拦下生成。
 */
export function intentOverrides(intent, options = {}) {
  const prompt = intent && typeof intent.prompt === 'string' ? intent.prompt.trim() : ''
  if (!prompt) return null
  const negativeActive = Boolean(options && options.negativeActive === true)
  return {
    prompt,
    count: intentCount(intent.count),
    negativePrompt: negativeActive ? intentNegative(intent.negative) : '',
  }
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
