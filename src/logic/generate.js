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
 */

import { LIMITS, ROUTES } from '../../shared/contract.js'
import { clampInt, clampNumber, clampSize, parseSeed } from './clamp.js'
import { clampMaskStrength, referenceMaskForSubmit } from './mask.js'
import { inpaintOnlyOf, ratioIdOf, referencePresetOf } from './preset.js'
import { negativeForSubmit } from './prompt.js'

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
 * 图片工具的底图来自历史条目，一般已带 `image.url`；旧记录只有路径时用这里补出来，
 * 与 `/imagen-api/file?path=` 保持同一条口径。
 */
export function referenceUrlOf(path) {
  const value = String(path ?? '').trim()
  if (!value) return ''
  return `${ROUTES.file.path}?path=${encodeURIComponent(value)}`
}

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

  // 图生图字段只可能来自图片工具（主表单已不挂参考图）：有参考图路径才输出 reference，
  // 否则请求体与纯文生图逐字一致。覆盖项也能改这两个字段，走同一套归一规则。
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
 * 主表单本次请求的纯文生图能力预检。
 *
 * 专用局部重绘权重（`inpaintOnly`）只能带蒙版使用，不能文生图：本次请求改用可文生图的
 * 兜底预设并给一条轻提示，**不改左栏表单**（决策 D3）；一个能文生图的预设都没有
 * （旧宿主）时拦下并说明，不能把注定失败的请求交给宿主。
 *
 * 参考图与蒙版已不经过主表单，这里只判断预设本身。
 *
 * @param {object} options
 * @param {object|null} options.preset 当前（或覆盖项解析出的）有效预设
 * @param {Array<object>} options.presets 宿主下发的预设列表
 * @returns {{
 *   ok: boolean,
 *   reason: ''|'preset',
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
  if (presets.length === 0 || !inpaintOnlyOf(preset)) return result
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
 * 没有记录有效 seed 时把种子恢复为随机，避免上一张作品的固定种子串到这张图上。
 * 没有可回填字段时返回空补丁。
 */
export function iteratePatch(entry, form, presets) {
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
 *
 * 只服务主表单的纯文生图重试；图片工具任务失败由 `useImageTool` 自己恢复（决策 D5），
 * 不会走到这里。
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
