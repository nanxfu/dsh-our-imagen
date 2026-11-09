/**
 * 提示词扩写：调用 DSH 已配置的模型，给出 3 条可视化建议。
 *
 * 不额外接第三方模型，也不要求用户配置 key：模型来自宿主的 `llm` 服务，
 * 默认选择取自 `agentDefaultModel`。宿主没有可用模型时返回本地兜底建议，
 * 调用方按 `source` 字段区分（`model` / `local`）。
 */

const SYSTEM_PROMPT = [
  '你是图像生成提示词的写作助手。',
  '根据用户给出的中文或英文描述，写出 3 条可直接用于文生图模型的英文提示词补充建议。',
  '要求：每条不超过 18 个英文单词；互补而不重复；只描述画面元素、光线、材质、构图与风格；不要解释。',
  '只输出 JSON 数组，形如 ["...", "...", "..."]。',
].join('\n')

const LOCAL_FALLBACK = [
  'rich cinematic lighting, detailed materials, subtle reflections',
  'shallow depth of field, 35mm lens, natural color grading',
  'highly detailed textures, balanced composition, soft rim light',
]

function localSuggestions() {
  return LOCAL_FALLBACK.map((text, index) => ({ id: `local-${index}`, text }))
}

/** 从模型输出里抽出 3 条建议；解析失败时按行切。 */
function parseSuggestions(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) {
        const list = parsed.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        if (list.length > 0) return list.slice(0, 3)
      }
    } catch {
      // 落到按行解析
    }
  }
  return text
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.、"']+|["',]+$/g, '').trim())
    .filter((line) => line.length > 4)
    .slice(0, 3)
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

/** 调用宿主模型；任何一步不可用都返回 null，由调用方兜底。 */
async function callModel(ctx, prompt) {
  const llm = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('llm') : null
    } catch {
      return null
    }
  })()
  if (!llm) return null

  const selection = (() => {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
      return service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
    } catch {
      return null
    }
  })()
  if (!selection || !selection.provider || !selection.model) return null

  const messages = [{ role: 'user', content: [{ type: 'text', text: `画面描述：${prompt}` }] }]
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined

  // 优先走 prepareCall（宿主内部同一套模型路由），失败再试直接 stream。
  try {
    if (typeof llm.prepareCall === 'function') {
      const call = await llm.prepareCall(
        { provider: selection.provider, model: selection.model, maxTokens: 300 },
        signal,
        (controls) => controls,
      )
      const stream = call && typeof call.stream === 'function' ? call.stream : null
      if (stream) {
        const options = { ...call.config, messages, system: SYSTEM_PROMPT, purpose: 'imagen-prompt-hints', signal }
        let buffer = ''
        for await (const chunk of stream(options)) buffer += collectText(chunk)
        const suggestions = parseSuggestions(buffer)
        if (suggestions.length > 0) return suggestions
      }
    }
  } catch {
    // 继续尝试下面的方式
  }

  try {
    if (typeof llm.stream === 'function') {
      const options = {
        provider: selection.provider,
        model: selection.model,
        messages,
        system: SYSTEM_PROMPT,
        maxTokens: 300,
        purpose: 'imagen-prompt-hints',
        signal,
      }
      let buffer = ''
      for await (const chunk of llm.stream(options)) buffer += collectText(chunk)
      const suggestions = parseSuggestions(buffer)
      if (suggestions.length > 0) return suggestions
    }
  } catch {
    // 交给本地兜底
  }

  return null
}

/**
 * @returns {Promise<{source: 'model'|'local', suggestions: Array<{id:string,text:string}>}>}
 */
export async function enhancePrompt(ctx, prompt) {
  const text = String(prompt ?? '').trim().slice(0, 2000)
  if (!text) return { source: 'local', suggestions: [] }
  const fromModel = await callModel(ctx, text)
  if (fromModel && fromModel.length > 0) {
    return { source: 'model', suggestions: fromModel.map((item, index) => ({ id: `model-${index}`, text: item })) }
  }
  return { source: 'local', suggestions: localSuggestions() }
}