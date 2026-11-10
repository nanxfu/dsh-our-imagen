/**
 * 提示词润色：调用 DSH 已配置的模型，按光影 / 材质 / 构图 / 氛围四个维度
 * 给出可直接追加到提示词里的短语。
 *
 * 不额外接第三方模型，也不要求用户配置 key：模型来自宿主的 `llm` 服务，
 * 默认选择取自 `agentDefaultModel`。宿主没有可用模型、或模型输出不可解析时，
 * 退回同一结构的本地建议，调用方按 `source` 字段区分（`model` / `local`）。
 */

import { extractJsonObject } from './json.js'

const DIMENSIONS = ['lighting', 'material', 'composition', 'atmosphere']

const LOCALE_NAME = { zh: '中文', en: 'English' }

// 少步快速模型与多步 / 质量优先模型的提示词口径不同。
const FAST_PRESETS = ['sdxl-lightning', 'sdxl-turbo']

const LOCAL_GROUPS = {
  zh: {
    lighting: ['柔和漫射光', '侧逆光轮廓', '霓虹冷暖反光'],
    material: ['湿润粗糙质感', '金属拉丝高光', '磨砂半透明表面'],
    composition: ['对称中心构图', '低角度仰拍', '浅景深电影画幅'],
    atmosphere: ['静谧雾气', '漂浮尘埃粒子', '冷峻夜景基调'],
  },
  en: {
    lighting: ['soft diffused light', 'rim light from the side', 'neon color contrast'],
    material: ['wet rough texture', 'brushed metal highlights', 'frosted translucent surface'],
    composition: ['symmetrical centered frame', 'low angle wide shot', 'shallow cinematic depth'],
    atmosphere: ['quiet fog', 'floating dust particles', 'cold night mood'],
  },
}

function systemPrompt(locale, presetId) {
  const emphasis = FAST_PRESETS.includes(presetId)
    ? '该预设是少步快速模型，优先给明确的主体结构与光影主基调，避免堆砌修辞。'
    : '该预设偏好多步生成或质量优先，可以给更细的细节修饰与质感描写。'
  return [
    '你是文生图提示词的润色助手。',
    '用户会给出一句画面描述，并指定要使用的模型预设。请从 4 个维度各给 2~3 条可以直接追加到提示词里的短语：',
    'lighting（光影）、material（材质）、composition（构图）、atmosphere（氛围）。',
    '要求：短语具体、互补、不重复，不要解释，不要编号；中文每条不超过 12 个字，英文每条不超过 8 个词。',
    emphasis,
    `用${LOCALE_NAME[locale] ?? LOCALE_NAME.zh}输出。`,
    '只输出 JSON，形如 {"groups":[{"dimension":"lighting","options":["…","…"]}, …]}，四个维度都要出现。',
  ].join('\n')
}

/** 本地兜底建议，结构与模型返回一致。 */
export function localGroups(locale) {
  const table = LOCAL_GROUPS[locale] ?? LOCAL_GROUPS.zh
  return DIMENSIONS.map((dimension) => ({
    dimension,
    options: table[dimension].map((text, index) => ({ id: `local-${dimension}-${index}`, text })),
  }))
}

function textOf(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value.text === 'string') return value.text.trim()
  return ''
}

/** 从模型输出里抽出四维建议；解析失败返回空数组，由调用方兜底。 */
function parseGroups(raw) {
  const parsed = extractJsonObject(raw)
  if (!parsed) return []

  const list = Array.isArray(parsed && parsed.groups)
    ? parsed.groups
    : Array.isArray(parsed)
      ? parsed
      : []
  const byDimension = new Map()
  for (const entry of list) {
    const dimension = entry && DIMENSIONS.includes(entry.dimension) ? entry.dimension : ''
    if (!dimension) continue
    const options = (Array.isArray(entry.options) ? entry.options : [])
      .map(textOf)
      .filter(Boolean)
      .slice(0, 3)
    if (options.length === 0) continue
    const merged = (byDimension.get(dimension) || []).concat(options).slice(0, 3)
    byDimension.set(dimension, merged)
  }

  return DIMENSIONS.filter((dimension) => byDimension.has(dimension)).map((dimension) => ({
    dimension,
    options: byDimension.get(dimension).map((item, index) => ({ id: `model-${dimension}-${index}`, text: item })),
  }))
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
async function callModel(ctx, prompt, options) {
  const llm = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('llm') : null
    } catch {
      return null
    }
  })()
  if (!llm) return ''

  const selection = (() => {
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
      return service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
    } catch {
      return null
    }
  })()
  if (!selection || !selection.provider || !selection.model) return ''

  const system = systemPrompt(options.locale, options.presetId)
  const messages = [{ role: 'user', content: [{ type: 'text', text: `画面描述：${prompt}` }] }]
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined

  // 优先走 prepareCall（宿主内部同一套模型路由），失败再试直接 stream。
  try {
    if (typeof llm.prepareCall === 'function') {
      const call = await llm.prepareCall(
        { provider: selection.provider, model: selection.model, maxTokens: 900 },
        signal,
        (controls) => controls,
      )
      const stream = call && typeof call.stream === 'function' ? call.stream : null
      if (stream) {
        const streamOptions = { ...call.config, messages, system, purpose: 'imagen-prompt-refine', signal }
        let buffer = ''
        for await (const chunk of stream(streamOptions)) buffer += collectText(chunk)
        if (buffer.trim()) return buffer
      }
    }
  } catch {
    // 继续尝试下面的方式
  }

  try {
    if (typeof llm.stream === 'function') {
      let buffer = ''
      const streamOptions = {
        provider: selection.provider,
        model: selection.model,
        messages,
        system,
        maxTokens: 900,
        purpose: 'imagen-prompt-refine',
        signal,
      }
      for await (const chunk of llm.stream(streamOptions)) buffer += collectText(chunk)
      if (buffer.trim()) return buffer
    }
  } catch {
    // 交给本地兜底
  }

  return ''
}

/**
 * @param {object} ctx 宿主上下文
 * @param {string} prompt 画面描述
 * @param {{ locale?: 'zh'|'en', presetId?: string }} [options]
 * @returns {Promise<{source: 'model'|'local', groups: Array<{dimension: string, options: Array<{id: string, text: string}>}>}>}
 */
export async function enhancePrompt(ctx, prompt, options = {}) {
  const text = String(prompt ?? '').trim().slice(0, 2000)
  const locale = options.locale === 'en' ? 'en' : 'zh'
  if (!text) return { source: 'local', groups: [] }

  const raw = await callModel(ctx, text, { locale, presetId: options.presetId || '' })
  const groups = parseGroups(raw)
  if (groups.length === 4) return { source: 'model', groups }

  const fallback = localGroups(locale)
  if (groups.length === 0) return { source: 'local', groups: fallback }

  // 模型只给了一部分维度：缺的用本地建议补齐，界面始终是四组。
  return {
    source: 'model',
    groups: fallback.map((group) => groups.find((item) => item.dimension === group.dimension) || group),
  }
}