/**
 * 自然语言意图解析：把对话模式里的一句话整理成可直接执行的生成参数。
 *
 * 参数来自用户自然语言，模型返回结构化结果：
 *   { prompt, ratio, style, clarify }
 * 宿主没有可用模型时退回本地结果（原文当提示词、比例与风格都用当前设置）。
 * 只有用户自己的要求互相矛盾时才返回澄清项，其余情况一律自动决定、不反问。
 */

import { extractJsonObject } from './json.js'
import { createLogger } from './log.js'

const log = createLogger({ scope: 'intent' })

const RATIO_IDS = ['1:1', '16:9', '9:16', '4:3', '3:4']
const STYLE_IDS = ['film', 'concept', 'cyberpunk', 'ink', 'clay']

const LOCALE_NAME = { zh: '中文', en: 'English' }

function systemPrompt(locale, previousPrompt) {
  const lines = [
    '你是图像生成工作台的意图解析器。把用户这句话整理成可以直接执行的生成参数，只输出 JSON：',
    '{"prompt":"整理后的画面描述","ratio":"1:1|16:9|9:16|4:3|3:4|","style":"film|concept|cyberpunk|ink|clay|","clarify":null}',
    '规则：',
    '1. prompt 要具体、可直接用于文生图，去掉“画一张”“帮我生成”“要写实一点”这类指令词与形容词指令。',
    '2. ratio 只允许 1:1、16:9、9:16、4:3、3:4 五个值；用户没说尺寸就留空字符串，不要猜。',
    '3. style 只允许 film（写实摄影）、concept（概念原画）、cyberpunk（赛博朋克）、ink（水墨写意）、clay（3D 渲染）；用户没说风格就留空。',
    '4. 只有用户给出的要求互相矛盾时（例如同时要横版和竖版、同时要写实和动漫）才输出澄清项：',
    '   "clarify":{"field":"ratio"或"style","options":["合法 id","合法 id"]}；其余情况一律 "clarify":null，不要反问。',
    `5. 输出语言：${LOCALE_NAME[locale] ?? LOCALE_NAME.zh}。`,
  ]
  if (previousPrompt) {
    lines.push(
      `6. 上一轮的画面描述是：${previousPrompt}`,
      '   本轮消息是在它基础上的增量修改：请把修改合并进完整描述后再输出 prompt，不要只输出增量。',
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

function normalize(parsed, fallbackPrompt) {
  const prompt = textOf(parsed.prompt) || fallbackPrompt
  const ratioId = RATIO_IDS.includes(textOf(parsed.ratio)) ? textOf(parsed.ratio) : ''
  const styleId = STYLE_IDS.includes(textOf(parsed.style)) ? textOf(parsed.style) : ''
  return { prompt, ratioId, styleId, clarify: normalizeClarify(parsed.clarify) }
}

function collectText(chunk) {
  if (!chunk) return ''
  if (typeof chunk === 'string') return chunk
  if (typeof chunk.text === 'string') return chunk.text
  if (chunk.delta && typeof chunk.delta.text === 'string') return chunk.delta.text
  if (Array.isArray(chunk.blocks)) {
    return chunk.blocks.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join('')
  }
  if (Array.isArray(chunk.content)) {
    return chunk.content.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join('')
  }
  return ''
}

/** 调用宿主模型；任何一步不可用都返回空串，由调用方兜底。 */
async function callModel(ctx, input) {
  const llm = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('llm') : null
    } catch (error) {
      log.debug('宿主 llm 服务不可用', error?.message ?? error)
      return null
    }
  })()
  if (!llm) return ''

  const selection = (() => {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
      return service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
    } catch (error) {
      log.debug('宿主 agentDefaultModel 服务不可用', error?.message ?? error)
      return null
    }
  })()
  if (!selection || !selection.provider || !selection.model) return ''

  const system = systemPrompt(input.locale, input.previousPrompt)
  const messages = [{ role: 'user', content: [{ type: 'text', text: input.text }] }]
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined

  try {
    if (typeof llm.prepareCall === 'function') {
      const call = await llm.prepareCall(
        { provider: selection.provider, model: selection.model, maxTokens: 600 },
        signal,
        (controls) => controls,
      )
      const stream = call && typeof call.stream === 'function' ? call.stream : null
      if (stream) {
        let buffer = ''
        for await (const chunk of stream({ ...call.config, messages, system, purpose: 'imagen-chat-intent', signal })) {
          buffer += collectText(chunk)
        }
        if (buffer.trim()) return buffer
      }
    }
  } catch (error) {
    // 继续尝试下面的方式
    log.debug('prepareCall 不可用，改走 stream', error?.message ?? error)
  }

  try {
    if (typeof llm.stream === 'function') {
      let buffer = ''
      const streamOptions = {
        provider: selection.provider,
        model: selection.model,
        messages,
        system,
        maxTokens: 600,
        purpose: 'imagen-chat-intent',
        signal,
      }
      for await (const chunk of llm.stream(streamOptions)) buffer += collectText(chunk)
      if (buffer.trim()) return buffer
    }
  } catch (error) {
    // 交给本地兜底
    log.debug('模型调用失败，退回本地解析', error?.message ?? error)
  }

  return ''
}

/**
 * @param {object} ctx 宿主上下文
 * @param {{ text: string, previousPrompt?: string, locale?: 'zh'|'en' }} input
 * @returns {Promise<{source:'model'|'local', prompt:string, ratioId:string, styleId:string, clarify:null|{field:'ratio'|'style',options:string[]}}>}
 */
export async function parseIntent(ctx, input = {}) {
  const text = String(input.text ?? '').trim().slice(0, 2000)
  const locale = input.locale === 'en' ? 'en' : 'zh'
  const previousPrompt = String(input.previousPrompt ?? '').trim().slice(0, 2000)
  const fallback = { source: 'local', prompt: text, ratioId: '', styleId: '', clarify: null }
  if (!text) return fallback

  const raw = await callModel(ctx, { text, previousPrompt, locale })
  const parsed = parseJson(raw)
  if (!parsed) return fallback
  return { source: 'model', ...normalize(parsed, text) }
}
