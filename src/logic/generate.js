/**
 * 生成参数的构造与回填。
 *
 * 两个方向都收敛在这里，避免「请求体构造」与「历史回填」各占一个碎屑文件：
 *  - `buildGenerateBody()`：表单值 + 显式覆盖项 → POST /generate 请求体；
 *  - `iteratePatch()` / `rerollOverrides()` / `retryOverrides()`：当前选中的作品或
 *    失败任务 → 表单补丁 / 生成参数覆盖项。
 *
 * 0.10.0 起提示词不再拼接风格后缀；负向词按 `negativePromptActive` 的结果门控，
 * 当前模型/CFG 不消费负向词时提交空串，不发无效参数。
 */

import { LIMITS, ROUTES } from '../../shared/contract.js'
import { clampInt, clampNumber, clampSize, parseSeed } from './clamp.js'
import {
  clampMaskStrength,
  referenceMaskForSubmit,
  referenceMaskOf,
  referenceWithoutMask,
} from './mask.js'
import { inpaintOnlyOf, ratioIdOf, referencePresetOf, supportsImg2Img } from './preset.js'
import { negativeForSubmit, negativeLayersPatch, normalizeNegativeLayers } from './prompt.js'

/** 参考图的文件名：路径只用于向宿主定位作品，界面只显示文件名。 */
export function referenceFileName(path) {
  const value = String(path ?? '').trim()
  if (!value) return ''
  const parts = value.split(/[\\/]/)
  return parts[parts.length - 1] || value
}

/**
 * 参考图的缩略图地址：与 `lib/output.js` 的 `fileUrl()` 同口径（工作区相对路径做一次 URL 编码）。
 *
 * 重试只能从任务参数拿到 `sourcePath`，把参考图恢复进表单时没有现成的 `image.url`，
 * 这里按同一条 `/imagen-api/file?path=` 口径补出来。
 */
export function referenceUrlOf(path) {
  const value = String(path ?? '').trim()
  if (!value) return ''
  return `${ROUTES.file.path}?path=${encodeURIComponent(value)}`
}

/**
 * 表单里的参考图 → 可提交的工作区相对路径。
 *
 * 参考图由「以此图重绘」从画廊条目写入（`{ path, url }`）：`path` 与
 * `/imagen-api/file?path=` 使用同一口径，`url` 只用于界面缩略图，绝不进请求体。
 * 没有可用路径时返回空串，按普通文生图处理（不产生 reference 字段）。
 */
export function referencePathOf(form) {
  const input = form && typeof form === 'object' ? form : {}
  const reference = input.reference && typeof input.reference === 'object' ? input.reference : null
  return reference && typeof reference.path === 'string' ? reference.path.trim() : ''
}

/**
 * @param {object} form 表单状态
 * @param {object} [options]
 * @param {string} [options.defaultPreset] 预设兜底 id
 * @param {boolean} [options.negativeActive] `negativePromptActive()` 的结果；
 *   显式 false 时提交体 `negativePrompt` 恒为空串（含覆盖项里的负向词）
 * @param {boolean} [options.maskActive] `supportsInpaint()` 的结果；显式 false 时
 *   不提交 `reference.mask`（当前模型不支持局部重绘，蒙版保留在表单里）
 * @param {object} [options.overrides] 显式覆盖项（对话输入 / 生成变体 / 重试）
 * @returns {object} POST /generate（路径由 shared/contract.js 提供）的请求体
 */
export function buildGenerateBody(form, options = {}) {
  const input = form || {}
  const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : null
  const negativeActive = options.negativeActive !== false
  const explicit = overrides && typeof overrides.prompt === 'string' ? overrides.prompt : null
  const maxPromptChars = LIMITS.prompt.maxChars
  const prompt = explicit !== null
    ? explicit.trim().slice(0, maxPromptChars)
    : String(input.prompt ?? '').trim().slice(0, maxPromptChars)

  const body = {
    prompt,
    negativePrompt: negativeForSubmit(input, negativeActive),
    width: clampSize(input.width),
    height: clampSize(input.height),
    steps: clampInt(input.steps, LIMITS.steps.min, LIMITS.steps.max, 4),
    cfg: clampNumber(input.cfg, LIMITS.cfg.min, LIMITS.cfg.max, 0),
    seed: parseSeed(input.seed),
    count: clampInt(input.count, LIMITS.count.min, LIMITS.count.max, 1),
    waitSeconds: 0,
    autoStart: true,
  }
  const presetId = input.presetId || options.defaultPreset || ''
  if (presetId) body.presetId = presetId

  // 图生图：只有表单里确实有参考图才输出 reference；否则请求体与纯文生图逐字一致。
  // 覆盖项也能改这两个字段（重试 / 变体链路），走同一套归一规则。
  const hasOverride = (key) => overrides !== null && Object.prototype.hasOwnProperty.call(overrides, key)
  const reference = hasOverride('reference') ? overrides.reference : input.reference
  const referencePath = referencePathOf({ reference })
  if (referencePath) {
    const strength = hasOverride('strength') ? overrides.strength : input.strength
    // 局部重绘：参考图上带蒙版且当前模型消费 Inpaint 时才提交 reference.mask。
    // `maskActive === false` 表示当前模型不支持局部重绘（或调用方显式要求整图重绘）：
    // 蒙版仍留在表单里，只是这次不提交，避免把必被远端拒绝的字段发出去。
    const mask = options.maskActive === false ? '' : referenceMaskForSubmit(reference)
    // 强度上限跟着「本次是否真的带蒙版」走：蒙版场景放宽到契约 inpaintMax，img2img 仍用通用 max。
    body.reference = { path: referencePath, strength: clampMaskStrength(strength, Boolean(mask)) }
    if (mask) body.reference.mask = mask
  }

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      // prompt 已在上面处理；reference / strength 只经归一后进入 body，避免把 url 带出去。
      if (key === 'prompt' || key === 'reference' || key === 'strength') continue
      body[key] = value
    }
  }
  // 覆盖项也可能带 negativePrompt（对话 / 变体 / 重试链路）：当前配置不消费负向词时
  // 统一清空，保证请求体不出现无效参数。
  if (!negativeActive) body.negativePrompt = ''
  return body
}

// ---- 生成来源策略 ----------------------------------------------------------
//
// 「本次请求的参考图从哪来」只在下面这张表里决定，调用方不再各自往 overrides 里拼
// reference：表单面板沿用表单，助手与变体强制纯文生图，失败重试按冻结参数恢复。

/** 生成来源：form = 左栏表单；assistant = 对话确认卡；variant = 生成变体；retry = 失败重试。 */
export const GENERATE_SOURCES = Object.freeze(['form', 'assistant', 'variant', 'retry'])

/** 来源归一：未知值按面板生成（form）处理，旧调用方不传 source 时行为不变。 */
export function normalizeGenerateSource(value) {
  const source = typeof value === 'string' ? value.trim() : ''
  return GENERATE_SOURCES.includes(source) ? source : 'form'
}

/** 预设展示名：toast 里的 {preset} 只放用户认得出的名字，缺 label 时退回 id。 */
export function presetLabelOf(preset) {
  if (!preset || typeof preset !== 'object') return ''
  if (typeof preset.label === 'string' && preset.label.trim()) return preset.label.trim()
  if (typeof preset.short === 'string' && preset.short.trim()) return preset.short.trim()
  return typeof preset.id === 'string' ? preset.id : ''
}

/**
 * 本次请求的「有效预设」：覆盖项里的 presetId（重试 / 变体 / 兜底切换）优先，
 * 解析不到或没有覆盖项时回落到表单当前预设。
 */
export function effectivePresetOf(overrides, preset, presets) {
  const list = Array.isArray(presets) ? presets : []
  const input = overrides && typeof overrides === 'object' ? overrides : null
  const id = input && typeof input.presetId === 'string' ? input.presetId.trim() : ''
  if (id) {
    const found = list.find((item) => item && item.id === id)
    if (found) return found
  }
  return preset && typeof preset === 'object' ? preset : null
}

/**
 * 生成来源策略：算出本次请求实际使用的覆盖项。
 *
 *  - form：沿用表单参考图 + 蒙版，覆盖项原样透传；
 *  - assistant / variant：强制纯文生图（显式 `reference: null`）；当前有效预设是专用
 *    局部重绘权重时，仅本次请求切到参考图兜底预设并给一条轻提示（不改左栏表单）；
 *  - retry：参考图由 `retryReferencePlan()` 恢复，这里只透传它的覆盖项。
 *
 * @returns {{ source: string, ok: boolean, overrides: object, notice: null|{key: string, params: object}, blockedKey: string }}
 */
export function generateSourcePolicy(source, options = {}) {
  const normalized = normalizeGenerateSource(source)
  const overrides = options.overrides && typeof options.overrides === 'object' ? { ...options.overrides } : {}
  const presets = Array.isArray(options.presets) ? options.presets : []
  const preset = options.preset && typeof options.preset === 'object' ? options.preset : null
  const policy = { source: normalized, ok: true, overrides, notice: null, blockedKey: '' }
  if (normalized !== 'assistant' && normalized !== 'variant') return policy

  // 助手与变体只做纯文生图：显式置空，避免 buildGenerateBody 顺手带上表单里的参考图。
  overrides.reference = null
  const effective = effectivePresetOf(overrides, preset, presets)
  if (!inpaintOnlyOf(effective)) return policy
  const fallback = referencePresetOf(presets)
  if (!fallback) {
    // 一个能做文生图的预设都没有（旧宿主）：本次请求必然被宿主拒绝，直接拦下并说明。
    policy.ok = false
    policy.blockedKey = 'studio.reference.blocked'
    return policy
  }
  overrides.presetId = fallback.id
  policy.notice = {
    key: 'studio.reference.autoText2Image',
    params: { preset: presetLabelOf(fallback) },
  }
  return policy
}

/**
 * 本次请求的能力预检：用「有效预设 + 有效参考图」判断，而不是当前表单。
 *
 * 重试恢复出的带蒙版任务可能来自与表单不同的预设，用表单预设判断会误拦；
 * 旧宿主没有能力字段时按不支持处理（既有口径），预设列表还没拿到时不拦截。
 *
 * @returns {{ ok: boolean, reason: ''|'reference'|'mask', noticeKey: string }}
 */
export function generateCapabilityOf(options = {}) {
  const preset = options.preset && typeof options.preset === 'object' ? options.preset : null
  const presets = Array.isArray(options.presets) ? options.presets : []
  const reference = options.reference && typeof options.reference === 'object' ? options.reference : null
  const result = { ok: true, reason: '', noticeKey: '' }
  // 旧宿主 / 启动瞬间没有预设列表时不做拦截，交给宿主判断，避免误拦文生图。
  if (presets.length > 0 && referencePathOf({ reference }) && !supportsImg2Img(preset)) {
    result.ok = false
    result.reason = 'reference'
    result.noticeKey = 'studio.reference.blocked'
    return result
  }
  // 专用局部重绘权重必须带有效蒙版：缺参考图或没涂抹都直接拦下并说明下一步。
  if (inpaintOnlyOf(preset) && !referenceMaskOf(reference)) {
    result.ok = false
    result.reason = 'mask'
    result.noticeKey = 'studio.mask.onlyHint'
  }
  return result
}

/** 任务参数 / 提交体里冻结的参考图：任务里 mask 只是布尔标记，提交体里是完整蒙版对象。 */
function frozenReferenceOf(source) {
  const holder = source && typeof source === 'object' ? source : null
  if (!holder) return null
  const params = holder.params && typeof holder.params === 'object' ? holder.params : holder
  const raw = params && params.reference && typeof params.reference === 'object' ? params.reference : null
  if (!raw) return null
  const path = typeof raw.sourcePath === 'string'
    ? raw.sourcePath.trim()
    : typeof raw.path === 'string'
      ? raw.path.trim()
      : ''
  const strength = finiteNumber(raw.strength)
  // 任务参数里是 mask: true；直接传上一次提交体时 mask 是完整蒙版对象 / base64 字符串。
  const mask = raw.mask === true
    || typeof raw.mask === 'string'
    || Boolean(raw.mask && typeof raw.mask === 'object')
  return { path, strength, mask }
}

/** 上一次提交体里的参考图（含完整蒙版 base64）；没有时返回 null。 */
function submittedReferenceOf(body) {
  const input = body && typeof body === 'object' ? body : null
  const reference = input && input.reference && typeof input.reference === 'object' ? input.reference : null
  return reference ? { ...reference } : null
}

/**
 * 失败重试的参考图恢复计划。
 *
 * 任务参数只冻结参考图出处与「是否带蒙版」，蒙版 base64 不在 /state 里回传：
 *  - 同源的 `pendingRef`（上一次提交体）还带着完整蒙版 → 直接恢复并重试；
 *  - 蒙版已不可恢复 → 不自动提交：把参考图填回表单并请求进入涂抹，由用户重画；
 *  - 失败任务本来没有参考图 → 显式 `reference: null`，不能静默继承表单里挂着的参考图。
 *
 * @param {object|null} source 失败任务；没有任务时也可以是上一次提交的请求体
 * @param {object} [options]
 * @param {object} [options.pendingRef] 上一次提交的请求体
 * @returns {null | {
 *   overrides: object,
 *   restored: 'none'|'reference'|'mask',
 *   maskLost: boolean,
 *   fillReference: object|null,
 *   requestPaint: boolean,
 *   noticeKey: string,
 * }} null 表示连提示词都没有，调用方给「缺少提示词」的提示
 */
export function retryReferencePlan(source, options = {}) {
  const overrides = retryOverrides(source)
  if (!overrides) return null
  const frozen = frozenReferenceOf(source)
  const plan = {
    overrides,
    restored: 'none',
    maskLost: false,
    fillReference: null,
    requestPaint: false,
    noticeKey: '',
  }
  if (!frozen || !frozen.path) {
    // 失败任务没有参考图：显式纯文生图，表单里的参考图不得串进重试请求。
    overrides.reference = null
    return plan
  }
  const pending = submittedReferenceOf(options.pendingRef)
  const sameSource = Boolean(pending && referencePathOf({ reference: pending }) === frozen.path)
  const pendingMask = sameSource ? referenceMaskForSubmit(pending) : ''
  // 强度跟失败任务走；任务参数缺强度时退回同源提交体里的值。必须在分支判定之前写入：
  // maskLost 分支会提前 return，而「把任务参数填回表单」同样需要这份强度。
  const strength = frozen.strength ?? (sameSource && pending ? finiteNumber(pending.strength) : null)
  if (strength !== null) overrides.strength = strength
  if (sameSource && frozen.mask && pendingMask) {
    // 同源提交体还留着完整蒙版：直接恢复原参数重试。
    overrides.reference = { ...pending, path: frozen.path }
    plan.restored = 'mask'
  } else if (sameSource && !frozen.mask) {
    // 同源提交体可能带着更晚一次涂抹的蒙版：重试的是普通图生图，不能凭它变成局部重绘。
    overrides.reference = referenceWithoutMask({ ...pending, path: frozen.path })
    plan.restored = 'reference'
  } else if (frozen.mask) {
    plan.maskLost = true
    plan.fillReference = { path: frozen.path, url: referenceUrlOf(frozen.path) }
    plan.requestPaint = true
    plan.noticeKey = 'studio.toast.maskLost'
    overrides.reference = null
    return plan
  } else {
    overrides.reference = { path: frozen.path, url: referenceUrlOf(frozen.path) }
    plan.restored = 'reference'
  }
  return plan
}

/**
 * 失败重试「蒙版不可恢复」的表单回填补丁：把失败任务的参数整理成表单字段。
 *
 * 只回填与复现任务直接相关的项——提示词、排除项、宽高、步数、CFG、张数与强度；
 * 种子不回填（重试语义是重新抽一张，沿用固定种子反而可能复现失败原因）；
 * 参考图由 `retryRestoreOf()` 与预设一起写入，这里不碰。
 *
 * 排除项走两层结构：任务里冻结的是合并后的文本，整体放进 user 层，保证「提交什么就是什么」
 * 而不是被当前预设的推荐负向词重新拼一遍。
 */
export function retryFormPatch(overrides) {
  const input = overrides && typeof overrides === 'object' ? overrides : {}
  const patch = {}
  if (typeof input.prompt === 'string' && input.prompt.trim()) {
    patch.prompt = input.prompt.trim().slice(0, LIMITS.prompt.maxChars)
  }
  if (typeof input.negativePrompt === 'string') {
    const negative = input.negativePrompt.slice(0, LIMITS.negativePrompt.maxChars)
    const layers = normalizeNegativeLayers({ user: negative })
    Object.assign(patch, negativeLayersPatch(layers))
  }
  const width = positiveSize(input.width)
  const height = positiveSize(input.height)
  if (width !== null) patch.width = clampSize(width)
  if (height !== null) patch.height = clampSize(height)
  const steps = finiteNumber(input.steps)
  if (steps !== null) patch.steps = clampInt(steps, LIMITS.steps.min, LIMITS.steps.max, 4)
  const cfg = finiteNumber(input.cfg)
  if (cfg !== null) patch.cfg = clampNumber(cfg, LIMITS.cfg.min, LIMITS.cfg.max, 0)
  const count = finiteNumber(input.count)
  if (count !== null) patch.count = clampInt(count, LIMITS.count.min, LIMITS.count.max, 1)
  const strength = finiteNumber(input.strength)
  if (strength !== null) patch.strength = clampMaskStrength(strength, true)
  return patch
}

/**
 * 「蒙版不可恢复」重试的表单回填计划：解析目标预设 + 组装参考图与参数补丁。
 *
 * 预设优先恢复失败任务原本使用的那个（必须支持垫图，不能把参考图塞给不支持的模型）；
 * 该预设已被删除或不支持垫图时退回 `referencePresetOf()` 兜底预设，与「以此图重绘」的
 * 降级规则一致。一个可用预设都没有（旧宿主）时返回失败，由调用方明确提示。
 *
 * @param {object} plan `retryReferencePlan()` 的返回值（maskLost 分支）
 * @param {Array<object>} presets 宿主下发的预设列表
 * @returns {{ ok: boolean, reason: ''|'no_path'|'unsupported', preset: object|null, patch: object }}
 */
export function retryRestoreOf(plan, presets) {
  const holder = plan && typeof plan === 'object' ? plan : {}
  const fill = holder.fillReference && typeof holder.fillReference === 'object' ? holder.fillReference : null
  const path = fill && typeof fill.path === 'string' ? fill.path.trim() : ''
  if (!path) return { ok: false, reason: 'no_path', preset: null, patch: {} }
  const list = Array.isArray(presets) ? presets : []
  const overrides = holder.overrides && typeof holder.overrides === 'object' ? holder.overrides : {}
  const wanted = typeof overrides.presetId === 'string' ? overrides.presetId.trim() : ''
  const candidate = wanted ? list.find((item) => item && item.id === wanted) || null : null
  const preset = candidate && supportsImg2Img(candidate) ? candidate : referencePresetOf(list)
  const patch = retryFormPatch(overrides)
  // 缩略图沿用失败任务恢复计划里的同口径 url；旧调用方没带时按同一规则补出来。
  patch.reference = {
    path,
    url: fill && typeof fill.url === 'string' && fill.url ? fill.url : referenceUrlOf(path),
  }
  if (!preset) return { ok: false, reason: 'unsupported', preset: null, patch }
  return { ok: true, reason: '', preset, patch }
}

/**
 * 胶片条点击的纯判定：预览始终切换（由调用方执行），这里只决定要不要回填表单。
 *
 * 优先级：表单挂着参考图（含蒙版）> 脏草稿 > 干净回填。参考图必须排在草稿之前：
 * 涂抹后即使表单刚提交完被判干净，也不能被隐式回填清掉参考图与蒙版。
 *
 * @param {object} options
 * @param {object|null} [options.reference] 表单当前参考图
 * @param {boolean} [options.dirty] 表单是否有未提交修改
 * @param {object} [options.patch] `iteratePatch()` 的结果
 * @returns {{ action: 'reference'|'draft'|'recall'|'idle', noticeKey: string }}
 */
export function previewRecallOf(options = {}) {
  const reference = options.reference && typeof options.reference === 'object' ? options.reference : null
  if (referencePathOf({ reference })) {
    return {
      action: 'reference',
      noticeKey: referenceMaskOf(reference) ? 'studio.toast.referenceKept' : 'studio.toast.referenceImageKept',
    }
  }
  if (options.dirty === true) return { action: 'draft', noticeKey: 'studio.toast.draftKept' }
  const patch = options.patch && typeof options.patch === 'object' ? options.patch : {}
  if (Object.keys(patch).length === 0) return { action: 'idle', noticeKey: '' }
  return { action: 'recall', noticeKey: 'studio.toast.recalled' }
}

/**
 * 表单提交的请求体 → 助手里的参数摘要。
 *
 * 只提取结构数据，不做语言拼装：模型名由界面按 `presetId` 本地化，标签文案由
 * ChatPanel 组装成胶囊。未指定种子（提交体里是 -1）归一为 null，表示本次随机。
 */
export function formSummaryOf(body) {
  const input = body && typeof body === 'object' ? body : {}
  const width = positiveSize(input.width)
  const height = positiveSize(input.height)
  const count = finiteNumber(input.count)
  const seed = finiteNumber(input.seed)
  return {
    presetId: typeof input.presetId === 'string' ? input.presetId : '',
    ratioId: ratioIdOf(width, height),
    width,
    height,
    count: count === null ? 1 : Math.min(LIMITS.count.max, Math.max(LIMITS.count.min, Math.round(count))),
    hasReference: Boolean(referencePathOf(input)),
    seed: seed !== null && seed >= 0 ? Math.trunc(seed) : null,
  }
}

// ---- 历史回填 -------------------------------------------------------------
//
// 真实 Host 的 history 接口条目只保证有 jobId / createdAt / presetId / prompt / images，
// 不一定带 params；所以回填以 item.prompt / image.width / image.height 为第一来源，
// params 只补 steps / cfg 这类作品本身没记录的字段，预设推荐值作最后兜底。
// 任何一条都不依赖「最近完成的任务」。

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveSize(value) {
  const number = finiteNumber(value)
  if (number === null || number <= 0) return null
  return Math.round(number)
}

function presetOf(presets, id) {
  if (!id || !Array.isArray(presets)) return null
  return presets.find((item) => item && item.id === id) || null
}

function recallOf(entry, presets) {
  const image = (entry && entry.image) || null
  const item = (entry && entry.item) || null
  const params = (item && item.params) || null
  const presetId = (item && item.presetId) || ''
  const preset = presetOf(presets, presetId)
  const prompt = (item && typeof item.prompt === 'string' && item.prompt)
    || (params && typeof params.prompt === 'string' && params.prompt)
    || ''
  const width = positiveSize(image && image.width)
    ?? positiveSize(params && params.width)
    ?? positiveSize(preset && preset.size)
  const height = positiveSize(image && image.height)
    ?? positiveSize(params && params.height)
    ?? positiveSize(preset && preset.size)
  const steps = finiteNumber(params && params.steps) ?? finiteNumber(preset && preset.steps)
  const cfg = finiteNumber(params && params.cfg) ?? finiteNumber(preset && preset.cfg)
  const seed = finiteNumber(image && image.seed) ?? finiteNumber(params && params.seed)
  const negative = params && typeof params.negativePrompt === 'string' ? params.negativePrompt : null
  return { image, item, params, presetId, prompt, width, height, steps, cfg, seed, negative }
}

/**
 * 「带回参数」→ 表单补丁。
 * prompt 用作品自己的提示词；尺寸用产物像素（不再用最近任务兜底）；
 * steps/cfg 优先作品 params，其次预设推荐值。
 *
 * 普通作品回填时同时清掉上一轮残留的参考图：从「垫图微调」切到一张纯文生图作品时，
 * 旧参考图不该继续挂在新作品的参数里。作品没有记录有效 seed 时把种子恢复为随机，
 * 避免上一张作品的固定种子串到这张图上。没有可回填字段时返回空补丁。
 */
export function iteratePatch(entry, form, presets) {
  const base = form || {}
  const recall = recallOf(entry, presets)
  const patch = {}

  const prompt = recall.prompt.trim()
  if (prompt) patch.prompt = prompt
  if (recall.negative !== null) patch.negative = recall.negative
  if (recall.width !== null) patch.width = recall.width
  if (recall.height !== null) patch.height = recall.height
  if (recall.steps !== null) patch.steps = recall.steps
  if (recall.cfg !== null) patch.cfg = recall.cfg
  if (recall.seed !== null && recall.seed >= 0) patch.seed = String(Math.trunc(recall.seed))
  if (recall.presetId) patch.presetId = recall.presetId
  if (Object.keys(patch).length > 0) {
    if (!Object.prototype.hasOwnProperty.call(patch, 'seed')) patch.seed = ''
    patch.reference = null
  }
  return patch
}

/**
 * 「生成变体」→ 生成参数覆盖项：保持该图的 prompt / 尺寸 / steps / cfg / 预设，
 * 只把 seed 换成随机（-1），并按「再画一张」把张数固定为 1。
 * 没有可用的提示词时返回 null，由调用方给可见提示。
 */
export function rerollOverrides(entry, presets) {
  const recall = recallOf(entry, presets)
  const prompt = recall.prompt.trim()
  if (!prompt) return null
  const overrides = { prompt, seed: -1, count: 1 }
  if (recall.negative !== null) overrides.negativePrompt = recall.negative
  if (recall.width !== null) overrides.width = recall.width
  if (recall.height !== null) overrides.height = recall.height
  if (recall.steps !== null) overrides.steps = recall.steps
  if (recall.cfg !== null) overrides.cfg = recall.cfg
  if (recall.presetId) overrides.presetId = recall.presetId
  return overrides
}

/**
 * 「重试一次」→ 生成参数覆盖项：优先按失败任务的参数重试；
 * 没有任务时也可以传上一次提交的 body（pendingRef）作为来源。
 */
export function retryOverrides(source) {
  const holder = source && typeof source === 'object' ? source : null
  if (!holder) return null
  const params = holder.params && typeof holder.params === 'object' ? holder.params : holder
  const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
  if (!prompt) return null

  const overrides = { prompt, seed: -1 }
  const count = finiteNumber(params.count)
  if (count !== null) overrides.count = Math.min(4, Math.max(1, Math.round(count)))
  const width = positiveSize(params.width)
  const height = positiveSize(params.height)
  if (width !== null) overrides.width = width
  if (height !== null) overrides.height = height
  const steps = finiteNumber(params.steps)
  const cfg = finiteNumber(params.cfg)
  if (steps !== null) overrides.steps = steps
  if (cfg !== null) overrides.cfg = cfg
  if (typeof params.negativePrompt === 'string') overrides.negativePrompt = params.negativePrompt
  const presetId = holder.presetId || params.presetId || ''
  if (presetId) overrides.presetId = presetId
  return overrides
}
