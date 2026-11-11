/**
 * 提示词润色：调用 DSH 已配置的模型，按光影 / 材质 / 构图 / 氛围四个维度
 * 给出可直接追加到提示词里的英文短语。
 *
 * 九个预设都按英文提示词训练，所以每条建议固定拆成两部分：
 *   - text：可直接追加进 prompt 的英文短语（真正发给模型的内容）；
 *   - label：UI 语言的短标签（中文界面显示中文，英文界面与 text 相同）。
 *
 * 不额外接第三方模型，也不要求用户配置 key：模型来自宿主的 `llm` 服务，
 * 默认选择取自 `agentDefaultModel`。宿主没有可用模型、或模型输出不可解析时，
 * 退回同一结构的本地建议，调用方按 `source` 字段区分（`model` / `local`）。
 */

import { extractJsonObject } from './json.js'
import { invokeLlm } from './llm.js'
import { createLogger } from './log.js'

const log = createLogger({ scope: 'enhance' })

const DIMENSIONS = ['lighting', 'material', 'composition', 'atmosphere']

const LOCALE_NAME = { zh: '中文', en: 'English' }

// 少步快速模型与多步 / 质量优先模型的提示词口径不同。
const FAST_PRESETS = ['sdxl-lightning', 'sdxl-turbo']

/**
 * 本地兜底词表：[英文本, 中文 label]。
 * text 与 label 一一对应；英文界面直接复用 text 当标签。
 */
const LOCAL_GROUPS = {
  lighting: [
    ['soft diffused light', '柔和漫射光'],
    ['rim light from the side', '侧逆光轮廓'],
    ['neon color contrast', '霓虹冷暖反光'],
  ],
  material: [
    ['wet rough texture', '湿润粗糙质感'],
    ['brushed metal highlights', '金属拉丝高光'],
    ['frosted translucent surface', '磨砂半透明表面'],
  ],
  composition: [
    ['symmetrical centered frame', '对称中心构图'],
    ['low angle wide shot', '低角度仰拍'],
    ['shallow cinematic depth', '浅景深电影画幅'],
  ],
  atmosphere: [
    ['quiet fog', '静谧雾气'],
    ['floating dust particles', '漂浮尘埃粒子'],
    ['cold night mood', '冷峻夜景基调'],
  ],
}

function systemPrompt(locale, presetId) {
  const emphasis = FAST_PRESETS.includes(presetId)
    ? '该预设是少步快速模型，优先给明确的主体结构与光影主基调，避免堆砌修辞。'
    : '该预设偏好多步生成或质量优先，可以给更细的细节修饰与质感描写。'
  return [
    '你是文生图提示词的润色助手。这些预设都按英文提示词训练，所以追加短语必须是英文。',
    '用户会给出一句画面描述，并指定要使用的模型预设。请从 4 个维度各给 2~3 条可以直接追加到提示词里的建议：',
    'lighting（光影）、material（材质）、composition（构图）、atmosphere（氛围）。',
    '每条建议同时给两部分：text 是英文短语（不超过 8 个词），label 是给用户看的短标签',
    `（中文不超过 12 个字；${LOCALE_NAME[locale] ?? LOCALE_NAME.zh}界面就用对应语言写 label）。`,
    '要求：短语具体、互补、不重复，不要解释，不要编号。',
    emphasis,
    `label 用${LOCALE_NAME[locale] ?? LOCALE_NAME.zh}输出。`,
    '只输出 JSON，形如 {"groups":[{"dimension":"lighting","options":[{"text":"soft diffused light","label":"柔和漫射光"}, …]}, …]}，四个维度都要出现。',
  ].join('\n')
}

/** 本地兜底建议，结构与模型返回一致：text 英文短语、label UI 语言标签。 */
export function localGroups(locale) {
  const labels = locale === 'en' ? null : 'zh'
  return DIMENSIONS.map((dimension) => ({
    dimension,
    options: LOCAL_GROUPS[dimension].map(([text, label], index) => ({
      id: `local-${dimension}-${index}`,
      text,
      label: labels ? label : text,
    })),
  }))
}

function textOf(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value.text === 'string') return value.text.trim()
  return ''
}

/** 把模型给的一条建议归一成 { text, label }；text 为空则丢弃。 */
function readOption(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? { text, label: text } : null
  }
  if (!value || typeof value !== 'object') return null
  const text = textOf(value.text)
  if (!text) return null
  return { text, label: textOf(value.label) || text }
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
      .map(readOption)
      .filter(Boolean)
      .slice(0, 3)
    if (options.length === 0) continue
    const merged = (byDimension.get(dimension) || []).concat(options).slice(0, 3)
    byDimension.set(dimension, merged)
  }

  return DIMENSIONS.filter((dimension) => byDimension.has(dimension)).map((dimension) => ({
    dimension,
    options: byDimension.get(dimension).map((item, index) => ({
      id: `model-${dimension}-${index}`,
      text: item.text,
      label: item.label,
    })),
  }))
}

/**
 * @param {object} ctx 宿主上下文
 * @param {string} prompt 画面描述
 * @param {{ locale?: 'zh'|'en', presetId?: string }} [options]
 * @returns {Promise<{source: 'model'|'local', groups: Array<{dimension: string, options: Array<{id: string, text: string, label: string}>}>}>}
 */
export async function enhancePrompt(ctx, prompt, options = {}) {
  const text = String(prompt ?? '').trim().slice(0, 2000)
  const locale = options.locale === 'en' ? 'en' : 'zh'
  if (!text) return { source: 'local', groups: [] }

  const raw = await invokeLlm(ctx, {
    prompt: `画面描述：${text}`,
    systemPrompt: systemPrompt(locale, options.presetId || ''),
    log,
    maxTokens: 900,
    purpose: 'imagen-prompt-refine',
    fallbackMessage: '模型调用失败，退回本地建议',
  })
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
