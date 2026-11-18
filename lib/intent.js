/**
 * 自然语言意图解析（意图 JSON v2）：把对话模式里的一句话整理成可直接执行的生成参数。
 *
 * 模型返回结构：
 *   { prompt, summary, ratio, negative, clarify, modelHint }
 *
 * 设计要点：
 *  - system prompt 采用「身份与使命 / 模型手册 / 组织与沟通策略」三段式，模型知识
 *    全部来自 `shared/models-guide.js`（单一来源），不再手写风格枚举与硬分支；
 *  - prompt 与 negative 恒为英文、不随 UI 语言变化；summary / clarify / modelHint.reason
 *    用 UI 语言，只进界面；
 *  - negative 只在当前模型与配置真的消费负向词（`negativePromptActive`）时才输出，
 *    否则固定空串，避免让用户填一个后端会忽略的参数；
 *  - `history` 是多轮上下文通道（优先于旧的 `previousPrompt`），`cfg` 来自客户端当前表单；
 *  - 宿主没有可用模型或输出不可解析时退回同形状的本地结果（原文当提示词与摘要）。
 */

import { INTENT, LIMITS, RATIO_IDS, presetById } from '../shared/contract.js'
import {
  modelCatalogText,
  modelUsageLine,
  negativeGuidance,
  negativePromptActive,
  promptStyleRule,
  providerIdOf,
} from '../shared/models-guide.js'
import { historyMessages, normalizeClarify, normalizeModelHint } from '../shared/validation.js'
import { extractJsonObject } from './json.js'
import { invokeLlm } from './llm.js'
import { createLogger } from './log.js'

const log = createLogger({ scope: 'intent' })

const LOCALE_NAME = { zh: '中文', en: 'English' }

/** 当前配置下真正生效的 CFG：非法/缺失回落到预设推荐值。 */
function effectiveCfg(value, preset) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  if (Number.isFinite(number)) return number
  const recommended = Number(preset && preset.cfg)
  return Number.isFinite(recommended) ? recommended : 0
}

/** 多轮上下文里给模型的负向词约束（按当前模型能力与 CFG 动态生成）。 */
function negativeRule(active) {
  if (active) {
    return `当前模型与配置可用负向词：用户明确表达「不要 X」时，把对应的英文负面短语写进 negative（逗号分隔，不超过 ${LIMITS.negativePrompt.maxChars} 字符）；用户没有排除诉求时留空。`
  }
  return '当前模型或配置下负向词不生效：negative 必须是空字符串；用正面视觉描述表达排除意图（如 clean background、empty street），不要把 no xxx 写进正向提示词。'
}

/** 三段式 system prompt：身份与使命 → 模型手册 → 组织与沟通策略（软性引导）。 */
function systemPrompt({ locale, preset, cfg, previousPrompt, provider }) {
  const uiLanguage = LOCALE_NAME[locale] ?? LOCALE_NAME.zh
  const negativeActive = negativePromptActive(preset, cfg)
  const modelLine = (modelUsageLine(preset) || `- ${preset.id}（${preset.label || preset.id}）`).replace(/^-\s*/, '')
  const lines = [
    '【身份与使命】',
    '你是图像生成工作台的「创作导演 + 提示词顾问」，服务对象是创作新手：他们往往不懂摄影术语、模型差异和英文表达。你的任务是用最少的沟通成本，把用户的中文想法整理成能直接出图的英文提示词与生成参数。',
    `prompt 与 negative 必须是英文，不随界面语言变化；summary、clarify、modelHint.reason 用${uiLanguage}写，只给用户看。`,
    '',
    '【模型手册】',
    `当前模型：${modelLine}`,
    `当前配置：CFG=${cfg}（${negativeActive ? '负向词生效' : '负向词不生效'}）`,
    `当前模型的提示词书写规则：${promptStyleRule(preset)}`,
    `负向词指导：${negativeGuidance(preset, cfg)}`,
    // 模型目录按当前算力来源过滤（providers 能力位，如仅 Colab 的大显存模型在 kaggle
    // 来源下不出现），并剔除 inpaintOnly 专用重绘权重（主表单不可选、不能文生图）：
    // modelHint 只推荐用户当前真能切换过去的模型，避免给出无法执行的建议。
    `模型目录（modelHint 只能从这里选 id，不能编造；当前模型不用再建议。目录只列当前算力来源 ${provider} 能运行、且主表单可选的文生图模型）：`,
    modelCatalogText({ textToImageOnly: true, provider }),
    '',
    '【组织与沟通策略】（软性建议，按画面需要自行判断，不要机械套用）',
    '- 把主体、场景、光线、视角、材质拆解得具体可感；少堆「masterpiece, best quality」这类空泛质量词，除非当前模型的书写规则要求。',
    '- 先判断用户是在延续上一轮画面的修改，还是开启了全新主题：延续时把修改合并进完整画面；全新主题时不要强行沿用旧画面的人物、背景与风格。',
    '- 用户说「不要 X」时：negative 可用就写进 negative；不可用就用正面视觉描述表达排除意图（如 clean background、empty street、unobstructed view），绝不要把 no xxx 写进正向提示词。',
    '- 信息不足或存在多条有意思的视觉走向时，给一条轻度澄清问题与 2~4 个选项；意图已经足够明确就直接给出参数，不要反问。',
    '- 只有在用户需求明显更适合另一款模型时，才给 modelHint（合法 presetId + 一句短理由），不要硬拦用户当前选择。',
    '',
    '【输出格式】',
    '只输出一个 JSON 对象，不要解释、不要 Markdown 代码围栏：',
    `{"prompt":"英文提示词","summary":"${uiLanguage}画面概述","ratio":"","negative":"英文负向词或空串","clarify":null,"modelHint":null}`,
    '字段规则：',
    '1. prompt 恒为英文：保留画面主体与关键细节，去掉「画一张」「帮我生成」「要写实一点」这类指令词，输出可以直接出图的完整描述。',
    `2. summary 用${uiLanguage}写本轮画面概述，一到两句话，不超过 ${INTENT.summaryMaxChars} 字符，只给人看。`,
    `3. ratio 只允许 ${RATIO_IDS.join('、')}；用户没说尺寸就留空字符串，不要猜。`,
    `4. negative：${negativeRule(negativeActive)}`,
    `5. clarify：null，或 {"question":"${uiLanguage}问题（不超过 ${INTENT.clarifyQuestionMaxChars} 字符）","options":["选项1","选项2"]}；选项 ${INTENT.clarifyMinOptions}~${INTENT.clarifyMaxOptions} 条、去重、每条不超过 ${INTENT.clarifyOptionMaxChars} 字符。澄清轮也要给出草稿 prompt，不要输出空 prompt。`,
    `6. modelHint：null，或 {"presetId":"模型库里的 id","reason":"${uiLanguage}短理由（不超过 ${INTENT.modelHintReasonMaxChars} 字符）"}；只有明显更合适时才给，presetId 不能是当前模型 ${preset.id}。`,
  ]
  if (previousPrompt) {
    lines.push(
      '',
      `【上一轮提示词】${previousPrompt}`,
      '本轮如果是在它基础上的修改，请把修改合并进完整画面后再输出 prompt；如果用户换了全新主题，就忽略它重新组织。',
    )
  }
  return lines.join('\n')
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 模型输出 → 意图 v2；字段缺失时按原话/当前设置兜底。 */
function normalize(parsed, originalText, locale, { preset, cfg, provider }) {
  const prompt = (textOf(parsed.prompt) || originalText).slice(0, LIMITS.prompt.maxChars)
  // 模型没给 summary 时，中文界面退回用户原话（比英文提示词更像「中文摘要」），
  // 英文界面用提示词本身，保证确认卡始终有可读的摘要。
  const summaryText = textOf(parsed.summary) || (locale === 'en' ? prompt : originalText) || prompt
  const summary = summaryText.slice(0, INTENT.summaryMaxChars)
  const ratioValue = textOf(parsed.ratio) || textOf(parsed.ratioId)
  const ratioId = RATIO_IDS.includes(ratioValue) ? ratioValue : ''
  // 模型可能会「顺带」给负向词；当前模型不消费负向词时必须回落空串。
  const negative = negativePromptActive(preset, cfg)
    ? textOf(parsed.negative).slice(0, LIMITS.negativePrompt.maxChars)
    : ''
  return {
    prompt,
    summary,
    ratioId,
    negative,
    clarify: normalizeClarify(parsed.clarify),
    // provider 一并交给归一层：目录过滤只能约束「看得见的候选」，
    // 模型仍可能编造目录外的 id，这里按同一份能力位判定再拦一道。
    modelHint: normalizeModelHint(parsed.modelHint, preset, { locale, fallbackToDescription: true, provider }),
  }
}

/**
 * @param {object} ctx 宿主上下文
 * @param {{
 *   text: string,
 *   previousPrompt?: string,
 *   locale?: 'zh'|'en',
 *   presetId?: string,
 *   cfg?: number,
 *   history?: Array<{ role: 'user'|'assistant', content: string }>,
 *   provider?: string,
 * }} input
 *   presetId 决定 prompt 的书写口径与负向词能力（未知 id 回退默认预设）；
 *   cfg 是客户端当前表单的 CFG，非法/缺失时回落到预设推荐值；
 *   history 非空时作为多轮上下文，优先于旧的 previousPrompt；
 *   provider 是当前算力来源（宿主路由从运行设置读取）：模型目录与 modelHint
 *   都按它过滤，非法/缺失按契约默认来源归一（与客户端判定同口径）。
 * @returns {Promise<{
 *   source: 'model'|'local',
 *   prompt: string,
 *   summary: string,
 *   ratioId: string,
 *   negative: string,
 *   clarify: null|{ question: string, options: string[] },
 *   modelHint: null|{ presetId: string, reason: string },
 * }>}
 */
export async function parseIntent(ctx, input = {}) {
  const text = String(input.text ?? '').trim().slice(0, LIMITS.intentText.maxChars)
  const locale = input.locale === 'en' ? 'en' : 'zh'
  // 未知 presetId 由契约的 presetById 回落到默认预设，这里不再自行判断。
  const preset = presetById(input.presetId)
  const cfg = effectiveCfg(input.cfg, preset)
  const provider = providerIdOf(input.provider)
  const history = historyMessages(input.history)
  // history 已带上一轮画面时不再单独注入 previousPrompt，避免两套上下文互相打架。
  const previousPrompt = history.length === 0 ? String(input.previousPrompt ?? '').trim().slice(0, LIMITS.prompt.maxChars) : ''
  const fallback = {
    source: 'local',
    prompt: text,
    summary: text,
    ratioId: '',
    negative: '',
    clarify: null,
    modelHint: null,
  }
  if (!text) return fallback

  const raw = await invokeLlm(ctx, {
    messages: [...history, { role: 'user', content: text }],
    systemPrompt: systemPrompt({ locale, preset, cfg, previousPrompt, provider }),
    log,
    maxTokens: 700,
    purpose: 'imagen-chat-intent',
    fallbackMessage: '模型调用失败，退回本地解析',
  })
  const parsed = extractJsonObject(raw)
  if (!parsed) return fallback
  return { source: 'model', ...normalize(parsed, text, locale, { preset, cfg, provider }) }
}
