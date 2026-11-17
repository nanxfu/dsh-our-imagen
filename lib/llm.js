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
 *
 * 会话路由标识（sessionId）：部分宿主模型路由（例如 opencode-go）要求请求带
 * `x-opencode-session` 头，宿主适配器只在 `GenerateOptions.sessionId` 存在时才补上；
 * 缺失时请求会以 400 `MissingSessionID` 失败、流里没有正文，最终被调用方当成
 * 「模型不可用」静默退回本地兜底。插件侧调用不属于任何一个 DSH 会话，因此这里用
 * 按 purpose 固定的合成 id（同一类调用复用同一条路由，便于宿主侧缓存与限流）；
 * 调用方若显式给出 `sessionId` 则优先使用。
 *
 * 分片收集：宿主 `StreamChunk` 里 `reasoning-delta` 是模型的思考过程、
 * `text-delta` 才是用户可见正文。只收正文，否则润色结果会混进大段英文推理、
 * 「转英文」也会把第一行推理当成译文。旧宿主没有 `type` 的分片仍按原字段兜底。
 *
 * 思考档位：润色 / 英译这类结构化短输出不需要长推理，默认挑模型支持的最低档
 * （`off` → `minimal` → `low`），降低等待时间并避免推理挤占输出预算；
 * 调用方可用 `options.reasoningEffort` 显式指定，模型不支持时由调用方自行兜底。
 */

import { createLogger } from './log.js'

const defaultLog = createLogger({ scope: 'llm' })

/** 结构化短输出优先使用的思考档位，从低到高排列。 */
const LIGHT_REASONING_EFFORTS = ['off', 'minimal', 'low']

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

/**
 * 从流式分片里取正文：新宿主按 `type` 区分正文与思考（只收 `text-delta`）；
 * 旧宿主没有 `type`，仍按 `text` / `delta.text` / `blocks` / `content` 兜底。
 */
function collectText(chunk) {
  if (!chunk) return ''
  if (typeof chunk === 'string') return chunk
  if (typeof chunk.type === 'string') {
    if (chunk.type === 'text-delta') return typeof chunk.text === 'string' ? chunk.text : ''
    // 思考分片、块结束、用量、终止等都不进入正文。
    if (chunk.type !== 'delta' && chunk.type !== 'message-delta') return ''
  }
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
 * 从模型元数据里挑一个最低可用的思考档位；没有显式要求时不指定，避免把
 * 不支持该档位的请求打到适配器上（适配器会以 UNSUPPORTED_REASONING_EFFORT 拒绝）。
 */
function chooseReasoningEffort(model, explicit) {
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : []
  const supported = new Set(efforts.map((effort) => (effort && typeof effort.id === 'string' ? effort.id : '')))
  for (const candidate of LIGHT_REASONING_EFFORTS) {
    if (supported.has(candidate)) return candidate
  }
  return undefined
}

/**
 * 把终止分片归一成可落盘的短描述：`error` / `aborted` 保留失败码与首行消息，
 * 其它（stop / max-tokens / tool-calls）只记 kind。用于回答「为什么没有正文」。
 */
function describeFinish(finish) {
  if (!finish || typeof finish !== 'object') return 'unknown'
  const kind = typeof finish.kind === 'string' ? finish.kind : 'unknown'
  const failure = finish.failure
  if (!failure || typeof failure !== 'object') return kind
  const code = typeof failure.code === 'string' ? failure.code : 'UNKNOWN'
  const message = String(failure.message ?? '').split(/\r?\n/)[0].slice(0, 300)
  return message ? `${kind} code=${code} message=${message}` : `${kind} code=${code}`
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
 *   sessionId?: string,
 *   reasoningEffort?: string,
 *   fallbackMessage?: string,
 * }} options
 *   prompt：单轮快捷方式的用户消息正文；messages：多轮消息（优先于 prompt）；
 *   sessionId：宿主路由标识，缺省按 purpose 生成固定值（见文件头注释）；
 *   reasoningEffort：显式思考档位，缺省由模型支持的最低档决定；
 *   fallbackMessage：调用异常时的日志文案，供调用方说明自己的兜底去向。
 * @returns {Promise<string>}
 */
export async function invokeLlm(ctx, options = {}) {
  const log = options.log ?? defaultLog
  const system = String(options.systemPrompt ?? '')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000
  const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : 900
  const purpose = options.purpose ?? 'imagen-prompt-refine'
  // 合成路由 id：purpose 本身已带 `imagen-` 前缀时直接复用，避免出现双重前缀。
  const sessionId =
    typeof options.sessionId === 'string' && options.sessionId.trim() !== ''
      ? options.sessionId.trim()
      : purpose.startsWith('imagen-')
        ? purpose
        : `imagen-${purpose}`
  const explicitEffort = typeof options.reasoningEffort === 'string' ? options.reasoningEffort.trim() : ''
  const fallbackMessage = options.fallbackMessage ?? '模型调用失败，退回本地兜底'
  const messages = buildMessages(options)

  const llm = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('llm') : null
    } catch (error) {
      log.warn(`llm_unavailable reason=service_error detail=${String(error?.message ?? error)}`)
      return null
    }
  })()
  if (!llm) {
    log.warn('llm_unavailable reason=service_missing')
    return ''
  }

  const selection = (() => {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
      return service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
    } catch (error) {
      log.warn(`llm_unavailable reason=selection_error detail=${String(error?.message ?? error)}`)
      return null
    }
  })()
  if (!selection || !selection.provider || !selection.model) {
    log.warn(`llm_unavailable reason=no_selection detail=${JSON.stringify(selection ?? null)}`)
    return ''
  }

  log.info(`llm_call provider=${selection.provider} model=${selection.model} purpose=${purpose}`)
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined

  // 优先走 prepareCall（宿主内部同一套模型路由），失败再试直接 stream。
  try {
    if (typeof llm.prepareCall === 'function') {
      const call = await llm.prepareCall(
        { provider: selection.provider, model: selection.model, maxTokens },
        signal,
        (controls, model) => {
          const effort = chooseReasoningEffort(model, explicitEffort)
          return effort ? { ...controls, reasoningEffort: effort } : controls
        },
      )
      const stream = call && typeof call.stream === 'function' ? call.stream : null
      if (stream) {
        const streamOptions = { ...call.config, messages, system, purpose, sessionId, signal }
        let buffer = ''
        let finish = null
        for await (const chunk of stream(streamOptions)) {
          if (chunk && chunk.type === 'finish') finish = chunk.reason
          buffer += collectText(chunk)
        }
        if (buffer.trim()) return buffer
        log.warn(`llm_empty path=prepareCall effort=${call.config?.reasoningEffort ?? 'default'} finish=${describeFinish(finish)}`)
      }
    }
  } catch (error) {
    log.warn(`llm_prepare_failed detail=${String(error?.name ?? 'Error')}: ${String(error?.message ?? error)}`)
  }

  try {
    if (typeof llm.stream === 'function') {
      let buffer = ''
      let finish = null
      const streamOptions = {
        provider: selection.provider,
        model: selection.model,
        messages,
        system,
        maxTokens,
        purpose,
        sessionId,
        signal,
        ...(explicitEffort ? { reasoningEffort: explicitEffort } : {}),
      }
      for await (const chunk of llm.stream(streamOptions)) {
        if (chunk && chunk.type === 'finish') finish = chunk.reason
        buffer += collectText(chunk)
      }
      if (buffer.trim()) return buffer
      log.warn(`llm_empty path=stream finish=${describeFinish(finish)} (${fallbackMessage})`)
    }
  } catch (error) {
    log.warn(`llm_stream_failed detail=${String(error?.name ?? 'Error')}: ${String(error?.message ?? error)} (${fallbackMessage})`)
  }

  return ''
}
