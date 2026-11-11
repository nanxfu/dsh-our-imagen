/**
 * 自然语言意图解析：把对话模式里的一句话整理成可直接执行的生成参数。
 *
 * 参数来自用户自然语言，模型返回结构化结果：
 *   { prompt, summary, ratio, style, clarify }
 *
 * 九个预设都按英文提示词训练，因此 prompt 永远输出英文、不随 UI 语言变化；
 * UI 语言只用于 summary（给用户确认的本轮画面概述）。两者分工固定，
 * 避免中文混进发给模型的提示词。
 *
 * 宿主没有可用模型时退回本地结果（原文当提示词与摘要、比例与风格都用当前设置）。
 * 只有用户自己的要求互相矛盾时才返回澄清项，其余情况一律自动决定、不反问。
 */

import { RATIO_IDS, STYLE_IDS, presetById } from '../shared/contract.js'

import { extractJsonObject } from './json.js'
import { invokeLlm } from './llm.js'
import { createLogger } from './log.js'

const log = createLogger({ scope: 'intent' })

const LOCALE_NAME = { zh: '中文', en: 'English' }

/** 风格 id 的说明文字：id 清单来自契约 STYLE_IDS，这里只写给模型理解的语义。 */
const STYLE_HINTS = {
  film: '写实摄影',
  concept: '概念原画',
  cyberpunk: '赛博朋克',
  ink: '水墨写意',
  clay: '3D 渲染',
}

/** 按预设的提示词配方给出 prompt 书写要求；未知配方回落到通用英文要求。 */
function promptStyleRule(preset) {
  const style = preset && preset.promptStyle ? preset.promptStyle : ''
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

function systemPrompt(locale, previousPrompt, preset) {
  const uiLanguage = LOCALE_NAME[locale] ?? LOCALE_NAME.zh
  const lines = [
    '你是图像生成工作台的意图解析器。把用户这句话整理成可以直接执行的生成参数，只输出 JSON：',
    `{"prompt":"英文画面描述","summary":"${uiLanguage}概述","ratio":"${RATIO_IDS.join('|')}|","style":"${STYLE_IDS.join('|')}|","clarify":null}`,
    '规则：',
    '1. prompt 必须是英文（不随界面语言变化），去掉“画一张”“帮我生成”“要写实一点”这类指令词与形容词指令。',
    `2. ${promptStyleRule(preset)}`,
    `3. summary 用${uiLanguage}写本轮画面概述，一到两句话，供用户确认；summary 只给人看，不会发给模型。`,
    `4. ratio 只允许 ${RATIO_IDS.join('、')}；用户没说尺寸就留空字符串，不要猜。`,
    `5. style 只允许 ${STYLE_IDS.map((id) => `${id}（${STYLE_HINTS[id] ?? id}）`).join('、')}；用户没说风格就留空。`,
    '6. 只有用户给出的要求互相矛盾时（例如同时要横版和竖版、同时要写实和动漫）才输出澄清项：',
    '   "clarify":{"field":"ratio"或"style","options":["合法 id","合法 id"]}；其余情况一律 "clarify":null，不要反问。',
  ]
  if (previousPrompt) {
    lines.push(
      `7. 上一轮的画面描述是：${previousPrompt}`,
      '   本轮消息是在它基础上的增量修改：请把修改合并进完整描述后再输出 prompt，不要只输出增量；summary 同样描述合并后的完整画面。',
    )
  }
  return lines.join('\n')
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJson(raw) {
  return extractJsonObject(raw)
}

function normalizeClarify(value) {
  if (!value || typeof value !== 'object') return null
  const field = value.field === 'ratio' || value.field === 'style' ? value.field : ''
  if (!field) return null
  const allowed = field === 'ratio' ? RATIO_IDS : STYLE_IDS
  const options = (Array.isArray(value.options) ? value.options : [])
    .map(textOf)
    .filter((item) => allowed.includes(item))
  const unique = [...new Set(options)].slice(0, 3)
  if (unique.length < 2) return null
  return { field, options: unique }
}

function normalize(parsed, originalText, locale) {
  const prompt = textOf(parsed.prompt) || originalText
  // 模型没给 summary 时，中文界面退回用户原话（比英文提示词更像「中文摘要」），
  // 英文界面用提示词本身，保证确认卡始终有可读的摘要。
  const summary = textOf(parsed.summary) || (locale === 'en' ? prompt : originalText) || prompt
  const ratioId = RATIO_IDS.includes(textOf(parsed.ratio)) ? textOf(parsed.ratio) : ''
  const styleId = STYLE_IDS.includes(textOf(parsed.style)) ? textOf(parsed.style) : ''
  return { prompt, summary, ratioId, styleId, clarify: normalizeClarify(parsed.clarify) }
}

/**
 * @param {object} ctx 宿主上下文
 * @param {{ text: string, previousPrompt?: string, locale?: 'zh'|'en', presetId?: string }} input
 *   presetId 决定 prompt 的书写口径（danbooru / natural / concise 与质量词前缀），缺省取默认预设。
 * @returns {Promise<{source:'model'|'local', prompt:string, summary:string, ratioId:string, styleId:string, clarify:null|{field:'ratio'|'style',options:string[]}}>}
 */
export async function parseIntent(ctx, input = {}) {
  const text = String(input.text ?? '').trim().slice(0, 2000)
  const locale = input.locale === 'en' ? 'en' : 'zh'
  const previousPrompt = String(input.previousPrompt ?? '').trim().slice(0, 2000)
  // 未知 presetId 由契约的 presetById 回落到默认预设，这里不再自行判断。
  const preset = presetById(input.presetId)
  const fallback = { source: 'local', prompt: text, summary: text, ratioId: '', styleId: '', clarify: null }
  if (!text) return fallback

  const raw = await invokeLlm(ctx, {
    prompt: text,
    systemPrompt: systemPrompt(locale, previousPrompt, preset),
    log,
    maxTokens: 600,
    purpose: 'imagen-chat-intent',
    fallbackMessage: '模型调用失败，退回本地解析',
  })
  const parsed = parseJson(raw)
  if (!parsed) return fallback
  return { source: 'model', ...normalize(parsed, text, locale) }
}
