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
 *
 * 0.13.0 起主表单只做纯文生图：参考图 / 蒙版 / 重绘强度的状态与来源策略迁到
 * `imageTool.js` + `useImageTool`。`buildGenerateBody()` 仍保留 reference / mask 归一，
 * 供 `buildImageToolBody()` 复用同一套请求体构造；表单域不再产出 reference 字段。
 *
 * 阶段十五 Phase C2：左栏参考图槽在 `references` 非空时把路径数组写进请求体
 * （`referencePathsOf` 去重并按契约上限裁剪），与单图 `reference` 互斥；
 * `generateCapabilityOf()` 同时前置判断「当前预设是否支持原生参考生图」。
 */

import { LIMITS, UPSCALE } from '../../shared/contract.js'
import { clampInt, clampNumber, clampSize, parseSeed } from './clamp.js'
import { positiveSize } from './format.js'
import { clampMaskStrength, referenceMaskForSubmit } from './mask.js'
import { inpaintOnlyOf, ratioIdOf, referencePresetOf } from './preset.js'
import { negativeForSubmit } from './prompt.js'
import { referenceCapabilityOf, referencePathsOf } from './reference.js'

/**
 * 表单里的参考图 → 可提交的工作区相对路径。
 *
 * 主表单已不再挂参考图；该函数保留给请求体构造的兼容路径与纯逻辑测试使用。
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

  // 模型原生参考图（Phase C2）：槽位非空时只提交路径数组，与单图 `reference` 互斥。
  // 覆盖项（重试 / 变体）里的 references 优先，其次才是表单槽位；空槽不写字段，
  // 请求体与纯文生图逐字一致。
  const hasOverride = (key) => overrides !== null && Object.prototype.hasOwnProperty.call(overrides, key)
  const references = referencePathsOf(hasOverride('references') ? overrides.references : input.references)
  if (references.length > 0) body.references = references

  // 图生图字段只可能来自图片工具（主表单已不挂参考图）：有参考图路径才输出 reference，
  // 否则请求体与纯文生图逐字一致。覆盖项也能改这两个字段，走同一套归一规则。
  // 与 `references` 互斥：同时给出时以原生参考为准，不把两种图片条件混进一个请求。
  const reference = hasOverride('reference') ? overrides.reference : input.reference
  const referencePath = references.length > 0 ? '' : referencePathOf({ reference })
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
      // prompt 已在上面处理；reference / strength / references 只经归一后进入 body，
      // 避免把 url / 槽位项这类展示字段带出去。
      if (key === 'prompt' || key === 'reference' || key === 'strength' || key === 'references') continue
      body[key] = value
    }
  }
  // 覆盖项也可能带 negativePrompt（对话 / 变体 / 重试链路）：当前配置不消费负向词时
  // 统一清空，保证请求体不出现无效参数。
  if (!negativeActive) body.negativePrompt = ''
  return body
}

// ---- 纯文生图能力预检 ------------------------------------------------------

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
 * 主表单本次请求的能力预检。
 *
 * 两条互斥的图片条件在这里分流：
 *  - `references`（模型原生参考图，Phase C2）非空：当前预设必须 `supportsReference = true`，
 *    否则拦下并给「换模型 / 移除参考图」的说明——不静默丢图，也不自动换模型；
 *  - 专用局部重绘权重（`inpaintOnly`）只能带蒙版使用，不能文生图：本次请求改用可文生图的
 *    兜底预设并给一条轻提示，**不改左栏表单**（决策 D3）；一个能文生图的预设都没有
 *    （旧宿主）时拦下并说明，不能把注定失败的请求交给宿主。
 *
 * 参考图与蒙版已不经过主表单，这里只判断预设本身。
 *
 * @param {object} options
 * @param {object|null} options.preset 当前（或覆盖项解析出的）有效预设
 * @param {Array<object>} options.presets 宿主下发的预设列表
 * @param {unknown} [options.references] 本次请求要带的原生参考图（槽位或覆盖项）
 * @returns {{
 *   ok: boolean,
 *   reason: ''|'preset'|'reference',
 *   blockedKey: string,
 *   notice: null|{key: string, params: object},
 *   preset: object|null,
 * }} preset 是本次请求要改用的兜底预设；空表示沿用有效预设
 */
export function generateCapabilityOf(options = {}) {
  const preset = options.preset && typeof options.preset === 'object' ? options.preset : null
  const presets = Array.isArray(options.presets) ? options.presets : []
  const result = { ok: true, reason: '', blockedKey: '', notice: null, preset: null }
  // 预设列表还没拿到（启动瞬间）时不做判断，交给宿主，避免误拦文生图。
  if (presets.length === 0) return result
  // 原生参考图路径优先：槽位非空时不改模型、不丢图，只拦下并说明原因。
  const referenceCapability = referenceCapabilityOf(preset, options.references)
  if (!referenceCapability.ok) {
    result.ok = false
    result.reason = 'reference'
    result.blockedKey = referenceCapability.blockedKey
    return result
  }
  if (!inpaintOnlyOf(preset)) return result
  const fallback = referencePresetOf(presets)
  if (!fallback) {
    result.ok = false
    result.reason = 'preset'
    result.blockedKey = 'studio.form.blockedInpaintOnly'
    return result
  }
  result.preset = fallback
  result.notice = {
    key: 'studio.form.autoText2Image',
    params: { preset: presetLabelOf(fallback) },
  }
  return result
}

/**
 * 胶片条点击的纯判定：预览始终切换（由调用方执行），这里只决定要不要回填表单与如何提示。
 *
 * 阶段十五 Phase A1 起不再拦 dirty（见 docs/STUDIO_UX_POLISH…§2.4）：未提交修改先被
 * 托管进最左端「新建草稿卡」，再回填被点作品的原始参数，因此「看原图设置」随时可用。
 * 参考图与蒙版已迁到舞台图片工具，不再属于左栏表单，也不参与这里的分支。
 *
 * @param {object} options
 * @param {boolean} [options.dirty] 表单是否有未提交修改（有则先托管）
 * @param {boolean} [options.hasDraft] 草稿槽里是否已有托管草稿（保留并提示）
 * @param {object} [options.patch] `iteratePatch()` 的结果
 * @returns {{ action: 'recall'|'idle', park: boolean, noticeKey: string }}
 */
export function previewRecallOf(options = {}) {
  const patch = options.patch && typeof options.patch === 'object' ? options.patch : {}
  if (Object.keys(patch).length === 0) return { action: 'idle', park: false, noticeKey: '' }
  // 当前编辑还没托管：先落进草稿卡，再回填目标作品。
  if (options.dirty === true) return { action: 'recall', park: true, noticeKey: 'studio.toast.draftKept' }
  // 草稿卡里已有内容：回填不影响它，同样提示「草稿已保留」。
  if (options.hasDraft === true) return { action: 'recall', park: false, noticeKey: 'studio.toast.draftKept' }
  return { action: 'recall', park: false, noticeKey: 'studio.toast.recalled' }
}

/**
 * 表单提交的请求体 → 助手里的参数摘要。
 *
 * 只提取结构数据，不做语言拼装：模型名由界面按 `presetId` 本地化，标签文案由
 * ChatPanel 组装成胶囊。未指定种子（提交体里是 -1）归一为 null，表示本次随机。
 * 主表单固定纯文生图，不再输出「是否带参考图」字段。
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
 * 是否为「无生成元数据的导入图」。
 *
 * 本地导入图没有原始生成参数：`meta.json` 的 params 只有展示名与像素尺寸（`source: 'import'`）。
 * 这类作品点胶片条只切预览、不回填任何参数，避免把文件名（如 `photo.png`）写进左栏提示词，
 * 也避免「重新生成」用文件名当提示词出图。带 PNG `tEXt` 生成元数据的导入图会回填
 * prompts / steps / cfg / seed，属于正常回填。
 */
export function isBareImportOf(entry) {
  const item = entry && entry.item ? entry.item : null
  if (!item || item.source !== 'import') return false
  const params = item.params && typeof item.params === 'object' ? item.params : null
  if (!params) return true
  // 生成元数据回填时会补 steps / cfg / seed；三者都没有就是「只有文件名」的裸导入。
  return !(
    typeof params.steps === 'number'
    || typeof params.cfg === 'number'
    || typeof params.seed === 'number'
  )
}

// ---- 非扩散产物（高清放大 / 局部重绘 / 扩图）的回填路径 ---------------------
//
// 阶段十五 Phase B1 / Phase C0 起 `/history` 里会出现几类「扩散参数不能直接写进左栏
// 纯文生图表单」的记录：
//  - 高清放大产物：`item.upscale === true`、`presetId: 'realesrgan-x2plus'`、params 全是占位 0；
//  - 专用局部重绘权重（`inpaintOnly`，如 `sdxl-inpaint`）产物：该预设不在文生图选择器里，
//    写进表单会让模型选择器出现「空白未选中」态；
//  - `presetId` 不在当前扩散预设列表里的旧记录。
// 这几类统一先沿 `sourceImage` 回溯父作品的真实扩散参数，找不到时走降级补丁，绝不把不可用
// 预设 / 占位 0 步 / 放大后尺寸写进表单或发成生成请求。

/** 父链回溯层数上限：与 `logic/lineage.js` 的 rootImage 回溯保持一致，防异常数据成环。 */
const DIFFUSION_LOOKBACK = 8

/** 是否为高清放大产物：明确标记 `upscale`，或 `presetId` 就是契约里的超分模型 id。 */
function isUpscaleItem(item) {
  if (!item || typeof item !== 'object') return false
  if (item.upscale === true) return true
  return typeof item.presetId === 'string' && item.presetId.trim() === UPSCALE.id
}

/**
 * 是否为「扩散参数不能直接回填」的记录。
 *
 * 高清放大是明确信号，任何时候都认；预设相关信号只在预设列表拿到后才判定，
 * 避免启动瞬间（presets 还没下发）把正常作品误判成非扩散产物。
 *
 * @param {object} item `/history` 的历史条目
 * @param {Array<object>} [presets] 宿主下发的预设列表
 */
function isNonDiffusionItem(item, presets) {
  if (!item || typeof item !== 'object') return false
  if (isUpscaleItem(item)) return true
  const presetId = typeof item.presetId === 'string' ? item.presetId.trim() : ''
  if (!presetId) return false
  const list = Array.isArray(presets) ? presets.filter((preset) => preset && preset.id) : []
  if (list.length === 0) return false
  const found = presetOf(list, presetId)
  // 认不出的旧模型 id，或专用局部重绘权重（inpaintOnly）：都不能当纯文生图的回填来源。
  return !found || found.inpaintOnly === true
}

/**
 * 是否为「非扩散产物」：高清放大、inpaintOnly 预设产物，或 `presetId` 不在当前扩散预设列表里。
 *
 * 这类记录不能直接回填参数。预设列表还没拿到（启动瞬间）时不按「未知预设」判定，
 * 只认 `upscale` / 超分模型 id 这两个明确信号。
 *
 * @param {object} entry `{ image, item }`
 * @param {Array<object>} [presets] 宿主下发的预设列表
 * @returns {boolean}
 */
export function isNonDiffusionRecallOf(entry, presets) {
  const item = entry && typeof entry === 'object' && entry.item ? entry.item : null
  return isNonDiffusionItem(item, presets)
}

/** `/history` 已加载条目 → 图片路径索引（同一张图重复出现时保留先到的一份）。 */
function itemsByImagePathOf(items) {
  const map = new Map()
  if (!Array.isArray(items)) return map
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const images = Array.isArray(item.images) ? item.images : []
    for (const image of images) {
      const path = image && typeof image.path === 'string' ? image.path.trim() : ''
      if (path && !map.has(path)) map.set(path, { item, image })
    }
  }
  return map
}

/**
 * 回填 / 重新生成前的「真实扩散来源」解析。
 *
 *  - 普通作品：返回 entry 自身（调用方据此走既有回填逻辑）；
 *  - 非扩散产物（高清放大 / inpaintOnly 产物等）：沿 `item.sourceImage` 在已加载的 `items` 里
 *    向上找父作品（最多 8 层、防成环；父作品若仍是非扩散记录继续向上），找到即返回父作品的
 *    `{ image, item }`；
 *  - 找不到父作品 / 父作品是无生成元数据的导入图：返回 null（调用方走降级补丁）。
 *
 * @param {object} entry `{ image, item }`
 * @param {Array<object>} [items] `/history` 已加载条目（缺省时等同找不到父作品）
 * @param {Array<object>} [presets] 宿主下发的预设列表（判定 inpaintOnly / 未知预设）
 * @returns {{ image: object, item: object } | null}
 */
export function diffusionSourceOf(entry, items, presets) {
  const holder = entry && typeof entry === 'object' ? entry : null
  if (!holder || !holder.item) return null
  const list = Array.isArray(presets) ? presets.filter((preset) => preset && preset.id) : []
  // 普通作品：自身就是扩散来源，调用方不需要向上找。
  if (!isNonDiffusionItem(holder.item, list)) return holder
  const byPath = itemsByImagePathOf(items)
  const seen = new Set()
  let current = holder
  for (let depth = 0; depth < DIFFUSION_LOOKBACK; depth += 1) {
    const item = current && current.item ? current.item : null
    const sourceImage = item && typeof item.sourceImage === 'string' ? item.sourceImage.trim() : ''
    if (!sourceImage || seen.has(sourceImage)) return null
    seen.add(sourceImage)
    const parent = byPath.get(sourceImage)
    if (!parent) return null
    const parentEntry = {
      image: parent.image && typeof parent.image === 'object' ? parent.image : { path: sourceImage },
      item: parent.item,
    }
    // 裸导入父作品没有生成元数据，不能当扩散参数来源。
    if (isBareImportOf(parentEntry)) return null
    if (!isNonDiffusionItem(parent.item, list)) return parentEntry
    current = parentEntry
  }
  return null
}

/** 合法扩散预设：候选（预设对象 / id）在列表里且不是专用局部重绘权重；否则第一个可文生图预设。 */
function legalDiffusionPresetOf(presets, candidate) {
  const list = Array.isArray(presets) ? presets.filter((preset) => preset && preset.id) : []
  const wanted = typeof candidate === 'string'
    ? candidate.trim()
    : (candidate && typeof candidate === 'object' && typeof candidate.id === 'string' ? candidate.id.trim() : '')
  const found = wanted ? presetOf(list, wanted) : null
  if (found && !inpaintOnlyOf(found)) return found
  return list.find((preset) => !inpaintOnlyOf(preset)) || null
}

/**
 * 降级补丁的模型参数：用合法扩散预设的推荐 steps / cfg。
 *
 * 步数只在推荐值 > 0 时写入（放大记录的 0 步是占位，绝不带回表单）；CFG 只在明确非零时
 * 写入——0 在契约里是合法值，但这里宁可不覆盖表单里已有的 cfg，也不把「0」当回填结果。
 */
function fallbackTuningOf(preset) {
  const patch = {}
  if (!preset || typeof preset !== 'object' || !preset.id) return patch
  patch.presetId = preset.id
  const rawSteps = finiteNumber(preset.steps)
  if (rawSteps !== null && rawSteps > 0) {
    patch.steps = clampInt(rawSteps, LIMITS.steps.min, LIMITS.steps.max, LIMITS.steps.min)
  }
  const rawCfg = finiteNumber(preset.cfg)
  if (rawCfg !== null && rawCfg > 0) {
    patch.cfg = clampNumber(rawCfg, LIMITS.cfg.min, LIMITS.cfg.max, rawCfg)
  }
  return patch
}

/**
 * 降级尺寸：优先放大记录里的源图宽高（`upscaleSource`），否则把记录尺寸钳到契约范围。
 * 两者都没有时不写宽高（表单保持原值）。
 */
function fallbackSizeOf(entry) {
  const item = entry && entry.item ? entry.item : null
  const image = entry && entry.image ? entry.image : null
  const params = item && item.params && typeof item.params === 'object' ? item.params : null
  const upscaleSource = item && item.upscaleSource && typeof item.upscaleSource === 'object'
    ? item.upscaleSource
    : null
  const width = positiveSize(upscaleSource && upscaleSource.width)
    ?? positiveSize(image && image.width)
    ?? positiveSize(params && params.width)
  const height = positiveSize(upscaleSource && upscaleSource.height)
    ?? positiveSize(image && image.height)
    ?? positiveSize(params && params.height)
  return {
    width: width === null ? null : clampSize(width),
    height: height === null ? null : clampSize(height),
  }
}

/** 非扩散产物找不到父作品时的回填降级补丁（绝不带超分 id / 0 步 / 超限尺寸）。 */
function degradedIteratePatch(entry, form, presets) {
  const item = entry && entry.item ? entry.item : null
  if (!item) return {}
  const patch = {}
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim().slice(0, LIMITS.prompt.maxChars) : ''
  if (prompt) patch.prompt = prompt
  const params = item.params && typeof item.params === 'object' ? item.params : null
  if (params && typeof params.negativePrompt === 'string') patch.negative = params.negativePrompt
  const size = fallbackSizeOf(entry)
  if (size.width !== null) patch.width = size.width
  if (size.height !== null) patch.height = size.height
  const preset = legalDiffusionPresetOf(presets, form && typeof form === 'object' ? form.presetId : '')
  Object.assign(patch, fallbackTuningOf(preset))
  if (Object.keys(patch).length > 0) patch.seed = ''
  return patch
}

/** 非扩散产物找不到父作品时的「重新生成」降级覆盖项；没有提示词返回 null。 */
function degradedRerollOverrides(entry, presets, fallbackPreset) {
  const item = entry && entry.item ? entry.item : null
  if (!item) return null
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim().slice(0, LIMITS.prompt.maxChars) : ''
  if (!prompt) return null
  // 降级重绘不继承左栏当前的参考图槽，显式置空 references 避免意外混入无关参考图。
  const overrides = { prompt, seed: -1, count: 1, references: [] }
  const params = item.params && typeof item.params === 'object' ? item.params : null
  if (params && typeof params.negativePrompt === 'string') overrides.negativePrompt = params.negativePrompt
  const size = fallbackSizeOf(entry)
  if (size.width !== null) overrides.width = size.width
  if (size.height !== null) overrides.height = size.height
  Object.assign(overrides, fallbackTuningOf(legalDiffusionPresetOf(presets, fallbackPreset)))
  return overrides
}

/**
 * 「带回参数」→ 表单补丁。
 * prompt 用作品自己的提示词；尺寸用产物像素（不再用最近任务兜底）；
 * steps/cfg 优先作品 params，其次预设推荐值。
 *
 * 没有记录有效 seed 时把种子恢复为随机，避免上一张作品的固定种子串到这张图上。
 * 没有可回填字段时返回空补丁；无生成元数据的导入图直接返回空补丁（见 isBareImportOf）。
 *
 * 阶段十五 Phase B 补修 / Phase C0：高清放大等非扩散产物、以及专用局部重绘权重
 * （`inpaintOnly`）产物不直接回填——先沿 `sourceImage` 在 `items` 里找父作品的真实扩散参数；
 * 找不到时走降级补丁（尺寸来自源图 / 钳到契约范围，步数 / CFG 用合法扩散预设推荐值），
 * 绝不把超分 id、inpaintOnly 预设、0 步或放大后尺寸带进左栏表单。
 *
 * @param {object} entry `{ image, item }`
 * @param {object} form 当前表单（只读 presetId 用于降级选模）
 * @param {Array<object>} [presets] 宿主下发的预设列表
 * @param {Array<object>} [items] `/history` 已加载条目（旧 3 参调用保持既有行为）
 */
export function iteratePatch(entry, form, presets, items) {
  if (isBareImportOf(entry)) return {}
  if (isNonDiffusionRecallOf(entry, presets)) {
    const source = diffusionSourceOf(entry, items, presets)
    if (source && source !== entry) return iteratePatch(source, form, presets, items)
    return degradedIteratePatch(entry, form, presets)
  }
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
  }
  return patch
}

/**
 * 「重新生成」→ 生成参数覆盖项：保持该图的 prompt / 尺寸 / steps / cfg / 预设，
 * 只把 seed 换成随机（-1），并按「再画一张」把张数固定为 1。
 * 没有可用的提示词时返回 null，由调用方给可见提示；裸导入图同样返回 null。
 *
 * 非扩散产物（高清放大 / inpaintOnly 产物等）同样先解析父作品的真实扩散参数；父作品缺失时
 * 用降级覆盖项（`fallbackPreset` 通常是左栏当前预设，缺失时取第一个可文生图预设）。
 *
 * @param {object} entry `{ image, item }`
 * @param {Array<object>} [presets] 宿主下发的预设列表
 * @param {Array<object>} [items] `/history` 已加载条目
 * @param {object|string} [fallbackPreset] 降级时的候选预设（当前表单预设）
 */
export function rerollOverrides(entry, presets, items, fallbackPreset) {
  if (isBareImportOf(entry)) return null
  if (isNonDiffusionRecallOf(entry, presets)) {
    const source = diffusionSourceOf(entry, items, presets)
    if (source && source !== entry) return rerollOverrides(source, presets, items, fallbackPreset)
    return degradedRerollOverrides(entry, presets, fallbackPreset)
  }
  const recall = recallOf(entry, presets)
  const prompt = recall.prompt.trim()
  if (!prompt) return null
  const item = entry && typeof entry === 'object' && entry.item && typeof entry.item === 'object'
    ? entry.item
    : null
  const itemParams = item && item.params && typeof item.params === 'object' ? item.params : null
  // 明确按作品自身是否带 referenceSources 写入 references（纯文生图作品写 []），
  // 防止左栏当前挂着的参考图槽在点击任意旧作品「重新生成」时串入请求或误触发模型拦截。
  const references = referencePathsOf((item && item.referenceSources) || (itemParams && itemParams.referenceSources))
  const overrides = { prompt, seed: -1, count: 1, references }
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
 *
 * 只服务主表单的纯文生图重试；图片工具任务失败由 `useImageTool` 自己恢复（决策 D5），
 * 不会走到这里。
 *
 * 原生参考图任务（Phase C2）按任务参数里的 `referenceSources`（或上一次提交体里的
 * `references`）恢复同一组参考图；恢复出来的槽位仍要过生成前置预检，当前模型不支持时
 * 会被拦下并说明，不会静默丢弃。
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
  // 参考图来源按「任务参数 referenceSources → 提交体 references」的顺序取，空数组不写字段。
  const references = referencePathsOf(params.referenceSources || params.references)
  if (references.length > 0) overrides.references = references
  const presetId = holder.presetId || params.presetId || ''
  if (presetId) overrides.presetId = presetId
  return overrides
}
