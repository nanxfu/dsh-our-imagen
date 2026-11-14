/**
 * 宿主模型调用的统一入口。
 *
 * 业务模块只负责给出 system prompt、消息内容与路由参数；流式文本收集、
 * prepareCall 降级到 stream、超时与异常兜底都在这里处理。任何一步不可用
 * 都返回空串，由调用方决定自己的本地兜底。
 *
 * 消息形状支持两种：
 *  - `options.prompt`：单轮快捷方式，等价于一条纯文本 user 消息（旧调用方无需改动）；
 *  - `options.messages`：多轮对话，元素为 `{ role, content }`，`content` 允许字符串或
 *    内容块数组 `[{ type: 'text', text }]`（为后续多模态预留，当前只原样传递文本块）。
 * 两者同时给出时以非空 `messages` 为准。
 */

import { createLogger } from './log.js'

const defaultLog = createLogger({ scope: 'llm' })

/** 内容块数组里的合法文本块；其它类型（含图片等未来扩展）当前阶段丢弃。 */
function normalizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  const blocks = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    blocks.push({ type: 'text', text: block.text })
  }
  return blocks
}

/**
 * 构造发给模型的消息数组：优先 `options.messages`，缺失或全非法时回落到 `options.prompt`。
 * 非法项（非对象、内容为空、无法归一的内容）直接丢弃，不抛错。
 */
function buildMessages(options) {
  if (Array.isArray(options.messages) && options.messages.length > 0) {
    const messages = []
    for (const entry of options.messages) {
      if (!entry || typeof entry !== 'object') continue
      const role = entry.role === 'assistant' || entry.role === 'system' ? entry.role : 'user'
      // 空文本消息没有信息量，直接丢弃（避免把空 system / 占位消息发给模型）。
      const content = normalizeContent(entry.content).filter((block) => block.text.trim() !== '')
      if (content.length === 0) continue
      messages.push({ role, content })
    }
    if (messages.length > 0) return messages
  }
  return [{ role: 'user', content: [{ type: 'text', text: String(options.prompt ?? '') }] }]
}

/** 从流式分片里取文本：兼容裸字符串、`{ text }`、`{ delta.text }` 与文本块数组。 */
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

/**
 * 调用宿主已配置的模型，返回流式收集到的完整文本；未配置模型或调用失败时返回空串。
 *
 * @param {object} ctx 宿主上下文
 * @param {{
 *   prompt?: string,
 *   messages?: Array<{ role: 'user'|'assistant'|'system', content: string|Array<{ type: 'text', text: string }> }>,
 *   systemPrompt: string,
 *   log?: object,
 *   timeoutMs?: number,
 *   maxTokens?: number,
 *   purpose?: string,
 *   fallbackMessage?: string,
 * }} options
 *   prompt：单轮快捷方式的用户消息正文；messages：多轮消息（优先于 prompt）；
 *   fallbackMessage：调用异常时的 debug 日志文案，供调用方说明自己的兜底去向。
 * @returns {Promise<string>}
 */
export async function invokeLlm(ctx, options = {}) {
  const log = options.log ?? defaultLog
  const system = String(options.systemPrompt ?? '')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000
  const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : 900
  const purpose = options.purpose ?? 'imagen-prompt-refine'
  const fallbackMessage = options.fallbackMessage ?? '模型调用失败，退回本地兜底'
  const messages = buildMessages(options)

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

  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined

  // 优先走 prepareCall（宿主内部同一套模型路由），失败再试直接 stream。
  try {
    if (typeof llm.prepareCall === 'function') {
      const call = await llm.prepareCall(
        { provider: selection.provider, model: selection.model, maxTokens },
        signal,
        (controls) => controls,
      )
      const stream = call && typeof call.stream === 'function' ? call.stream : null
      if (stream) {
        const streamOptions = { ...call.config, messages, system, purpose, signal }
        let buffer = ''
        for await (const chunk of stream(streamOptions)) buffer += collectText(chunk)
        if (buffer.trim()) return buffer
      }
    }
  } catch (error) {
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
        maxTokens,
        purpose,
        signal,
      }
      for await (const chunk of llm.stream(streamOptions)) buffer += collectText(chunk)
      if (buffer.trim()) return buffer
    }
  } catch (error) {
    log.debug(fallbackMessage, error?.message ?? error)
  }

  return ''
}