/**
 * 舞台图片工具（方案 B）的纯逻辑。
 *
 * 阶段十二把「针对已生成作品的二次处理」从文生图主表单里彻底抽离：
 * 工具注册表、自动选模、强度档位、提示词回退与请求体拼装都收敛在这里，
 * 不依赖 React / DOM，便于离线断言；状态编排见 `src/studio/hooks/useImageTool.js`，
 * 画布交互见 `src/studio/stage/MaskEditor.jsx`（涂抹）与 `OutpaintEditor.jsx`（扩图，
 * 版面几何在 `src/logic/outpaint.js`）。
 *
 * 交互形态：
 *  - `instant`：无参工具，点击即按当前图片提交（高清放大）；
 *  - `inline`：舞台下方展开一条轻量参数（整图重绘）；
 *  - `canvas`：整块舞台切成交互画布（局部涂抹 / 扩图）。
 *
 * 阶段十二只有 inpaint（canvas）与 img2img（inline）两个真实可用的工具；
 * 阶段十五 Phase B 点亮了高清放大（instant，远端轻量超分）与扩图（canvas，
 * 客户端合成画布 + 蒙版后按普通 inpaint 提交）。
 */

import { LIMITS, OUTPAINT, OUTPAINT_ENGINE, UPSCALE } from '../../shared/contract.js'

import { clampInt, clampNumber, clampSize } from './clamp.js'
import { positiveSize } from './format.js'
import {
  MASK_STRENGTH_DEFAULT,
  MASK_STRENGTH_NATIVE,
  base64BytesOf,
  clampMaskStrength,
  maskStateOf,
  normalizeMaskData,
} from './mask.js'
import {
  hintOf,
  inpaintOnlyOf,
  referencePresetOf,
  supportsImg2Img,
  supportsInpaint,
} from './preset.js'
import { buildOutpaintContentBody } from './outpaint.js'

/** 工具交互形态：新增工具时必须落在三类之一，动作坞按它决定打开方式。 */
export const IMAGE_TOOL_FORMS = Object.freeze(['instant', 'inline', 'canvas'])

/** 动作坞分组：图片处理（针对当前作品的二次处理）与创作复用（继续创作）。 */
export const IMAGE_TOOL_GROUPS = Object.freeze(['process', 'reuse'])

/**
 * 专用局部重绘权重的预设 id。
 *
 * 阶段十七已把 9 通道专用权重 `sdxl-inpaint` 下线：现役 7 款模型都不再声明
 * `inpaintOnly`，生产路径命中不到这个偏好分支，局部重绘统一走通用底座
 * `from_pipe` 兜底（`referencePresetOf()`）。保留常量与分支是为了将来重新引入
 * 原生 inpaint 权重时直接复用同一套选模规则，不用再改 `toolPresetOf`。
 */
const INPAINT_PRESET_ID = 'sdxl-inpaint'

/**
 * 图片工具注册表（唯一来源）。
 *
 * 字段约定：
 *  - `form`：交互形态，见 `IMAGE_TOOL_FORMS`；
 *  - `group`：动作坞分组，见 `IMAGE_TOOL_GROUPS`；
 *  - `icon`：`src/studio/icons.jsx` 的图标名；
 *  - `capability`：预设上对应的能力字段（null 表示无参工具，不依赖模型能力）；
 *  - `labelKey`：按钮 / 标题文案键；
 *  - `ready`：远端是否真的有对应推理能力；false 的按钮只做占位（禁用 + 规划中提示）；
 *  - `plannedKey`：未开放工具的提示文案键（只有 ready=false 时才会命中）。
 */
export const IMAGE_TOOLS = Object.freeze([
  Object.freeze({
    id: 'inpaint',
    form: 'canvas',
    group: 'process',
    icon: 'focus',
    capability: 'supportsInpaint',
    labelKey: 'studio.imageTool.inpaint',
    ready: true,
  }),
  Object.freeze({
    id: 'img2img',
    form: 'inline',
    group: 'process',
    icon: 'image',
    capability: 'supportsImg2Img',
    labelKey: 'studio.imageTool.img2img',
    ready: true,
  }),
  Object.freeze({
    id: 'upscale',
    form: 'instant',
    group: 'process',
    icon: 'expand',
    // 高清放大走远端 Real-ESRGAN 超分，不依赖扩散模型能力，因此没有预设能力字段。
    capability: null,
    labelKey: 'studio.imageTool.upscale',
    ready: true,
  }),
  Object.freeze({
    id: 'outpaint',
    form: 'canvas',
    group: 'process',
    icon: 'frame',
    capability: 'supportsReference',
    labelKey: 'studio.imageTool.outpaint',
    ready: true,
  }),
])

/** 按 id 取工具描述符；未知 id / 空值返回 null（调用方据此拒绝打开）。 */
export function imageToolOf(id) {
  const key = typeof id === 'string' ? id.trim() : ''
  if (!key) return null
  return IMAGE_TOOLS.find((tool) => tool.id === key) || null
}

/** 工具描述符归一：既接受 id，也接受已经解析好的描述符对象。 */
function resolveTool(value) {
  if (value && typeof value === 'object') {
    return typeof value.id === 'string' ? imageToolOf(value.id) || null : null
  }
  return imageToolOf(value)
}

/**
 * 自动选模：工具要用的预设。
 *
 * 规则（Lead 决策：工具内选模不回写左栏表单）：
 *  - inpaint：当前预设支持 Inpaint 就沿用；否则若有专用权重（`INPAINT_PRESET_ID`，阶段十七
 *    下线后生产列表无命中）则用它，再退 `referencePresetOf()` 的通用垫图兜底；
 *    一个都没有 → preset: null。
 *  - img2img：当前预设支持整图垫图就沿用；否则退 `referencePresetOf()`。
 *    专用局部重绘权重（inpaintOnly）不能做纯整图重绘，即使它声明 supportsImg2Img 也不沿用。
 *  - outpaint：优先现代扩图引擎 `flux2-klein-4b`（`OUTPAINT_ENGINE.presetId`，纯绿画布条件
 *    生图）；预设列表缺失它时才依次回退专用 inpaint 权重、当前预设（支持 Inpaint 时）、
 *    通用垫图兜底。
 *  - upscale：远端超分不读扩散预设，返回 `{ preset: null }`（hook 不对它做预设校验）。
 *
 * @param {Array<object>} presets 宿主下发的预设列表
 * @param {string} currentId 当前（左栏或工具草稿里的）预设 id
 * @param {string} toolId 工具 id
 * @returns {{ preset: object|null, switched: boolean, fallback: boolean }}
 *   switched：选中的预设与当前预设不同（界面提示「已自动改用 X」）；
 *   fallback：走的是通用兜底（没有专用/原生支持的模型），包含完全选不出预设的情况。
 */
export function toolPresetOf(presets, currentId, toolId) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : []
  const tool = imageToolOf(toolId)
  const missing = { preset: null, switched: false, fallback: false }
  if (!tool || !tool.ready) return missing
  // 无参工具（高清放大）不参与选模：远端按超分权重执行，没有预设可校验。
  if (tool.id === 'upscale') return missing
  const wanted = typeof currentId === 'string' ? currentId.trim() : ''
  const current = wanted ? list.find((item) => item.id === wanted) || null : null

  if (tool.id === 'inpaint') {
    if (supportsInpaint(current)) return { preset: current, switched: false, fallback: false }
    const native = list.find((item) => item.id === INPAINT_PRESET_ID && supportsInpaint(item)) || null
    if (native) {
      return { preset: native, switched: !current || native.id !== current.id, fallback: false }
    }
    const fallback = referencePresetOf(list)
    if (fallback) return { preset: fallback, switched: true, fallback: true }
    return { preset: null, switched: false, fallback: true }
  }

  if (tool.id === 'outpaint') {
    // 现代扩图引擎：优先固定选用 FLUX.2 Klein 4B + Outpaint LoRA（纯绿画布条件生图）；
    // 预设列表里缺失它时（如老旧测试替身），再按顺序回退专用 inpaint / 通用垫图。
    const modern = list.find((item) => item.id === OUTPAINT_ENGINE.presetId) || null
    if (modern) {
      return { preset: modern, switched: !current || modern.id !== current.id, fallback: false }
    }
    const native = list.find((item) => item.id === INPAINT_PRESET_ID && supportsInpaint(item)) || null
    if (native) {
      return { preset: native, switched: !current || native.id !== current.id, fallback: false }
    }
    if (supportsInpaint(current)) return { preset: current, switched: false, fallback: false }
    const fallback = referencePresetOf(list)
    if (fallback) return { preset: fallback, switched: true, fallback: true }
    return { preset: null, switched: false, fallback: true }
  }

  if (tool.id === 'img2img') {
    if (supportsImg2Img(current) && !inpaintOnlyOf(current)) {
      return { preset: current, switched: false, fallback: false }
    }
    const fallback = referencePresetOf(list)
    if (fallback) return { preset: fallback, switched: true, fallback: true }
    return { preset: null, switched: false, fallback: true }
  }

  return missing
}

/**
 * 工具的默认重绘强度（打开工具时套用，用户拖动即退出自动档）。
 *
 * - inpaint：专用 inpaint 权重 0.9，通用模型 0.8（真机验收结论，见 logic/mask.js）；
 * - outpaint：扩图覆盖面积大，默认走契约 `OUTPAINT.strength`（1.0，带蒙版上限之内）；
 * - img2img / 其它：契约默认 0.6。
 */
export function toolStrengthDefaultOf(toolId, preset) {
  const tool = imageToolOf(toolId)
  if (tool && tool.id === 'inpaint') {
    return inpaintOnlyOf(preset) ? MASK_STRENGTH_NATIVE : MASK_STRENGTH_DEFAULT
  }
  if (tool && tool.id === 'outpaint') {
    const strength = Number(OUTPAINT.strength)
    return Number.isFinite(strength) ? strength : LIMITS.strength.default
  }
  return LIMITS.strength.default
}

/**
 * 工具强度上限：canvas 且带蒙版时放宽到契约 `inpaintMax`，否则用通用 `max`。
 * 旧契约没有 `inpaintMax` 时回落通用上限，与 `logic/mask.js` 的 `strengthMaxOf` 同口径。
 */
export function toolStrengthMaxOf(toolId, hasMask) {
  const tool = imageToolOf(toolId)
  const max = Number(LIMITS.strength.max)
  if (!tool || tool.form !== 'canvas' || hasMask !== true) return max
  const inpaintMax = Number(LIMITS.strength.inpaintMax)
  return Number.isFinite(inpaintMax) ? Math.max(max, inpaintMax) : max
}

/** 扩图底图（如裸本地导入图）无原提示词时的中性场景延展默认提示词。 */
export const OUTPAINT_DEFAULT_PROMPT =
  'seamless extension of the existing scene, matching lighting, perspective, textures and atmosphere'

/**
 * 提交提示词：工具输入为空时回退目标作品自己的提示词（Lead 决策 D2）。
 *
 * 返回去掉首尾空白并按契约截断后的文本；目标作品也没有提示词时返回空串，
 * 由调用方用 `blockedNoPrompt` 拦下（只有两边都为空才算真的缺提示词）。
 */
export function toolPromptFallback(targetPrompt) {
  return String(targetPrompt ?? '').trim().slice(0, LIMITS.prompt.maxChars)
}

/**
 * 工具提示词输入框占位文案：
 *  - 底图自带原提示词时直接显示原提示词（留空沿用）；
 *  - 裸导入图等无原提示词底图：扩图允许留空走自动延续，其余工具提示必填修改描述，
 *    避免一边显示「留空则沿用原作品提示词」、一边拦截无提示词的自相矛盾。
 */
export function toolPromptPlaceholderOf({ t, toolId, targetPrompt }) {
  if (toolId === 'outpaint') {
    return typeof t === 'function' ? t('studio.outpaint.promptPlaceholderNoTarget') : ''
  }
  const own = toolPromptFallback(targetPrompt)
  if (own) return own
  if (typeof t !== 'function') return ''
  return t('studio.imageTool.promptPlaceholderNoTarget')
}

/** 有限数值；缺失 / 非法返回 null（用于 steps / cfg 这类「没填就用预设推荐值」的字段）。 */
function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** 预设字段 → 钳制后的请求参数；缺失时取契约内的安全默认值。 */
function presetSteps(preset) {
  const raw = finiteNumber(preset && preset.steps)
  return raw === null ? 4 : clampInt(raw, LIMITS.steps.min, LIMITS.steps.max, 4)
}

function presetCfg(preset) {
  const raw = finiteNumber(preset && preset.cfg)
  return raw === null ? 0 : clampNumber(raw, LIMITS.cfg.min, LIMITS.cfg.max, 0)
}

/** 工具请求体里的蒙版：canvas 形态 + 合法蒙版数据才提交，否则整图处理。 */
function maskForSubmit(tool, mask) {
  if (!tool || tool.form !== 'canvas') return ''
  const raw = mask && typeof mask === 'object' ? mask.data : mask
  const data = normalizeMaskData(raw)
  if (!data) return ''
  // 超出契约体积的蒙版宁可退回整图处理，也不发一个必被 Host 拒绝的字段。
  if (base64BytesOf(data) > Number(LIMITS.mask.maxBytes)) return ''
  return data
}

/**
 * 工具请求体拼装：POST /generate 的 `{ presetId, prompt, ..., reference }`。
 *
 * 入参（§2.1 冻结）：
 *  `{ tool, targetPath, targetPrompt, preset, presets, prompt, strength, mask, negativeActive }`
 * 另外接受 `target` / `targetWidth` / `targetHeight` 这类尺寸来源：冻结稿只写了
 * 「宽高跟随目标作品」，尺寸必须由调用方带进来（hook 会同时传 target 与 targetPath）。
 *
 * 行为：
 *  - 宽度 / 高度跟随目标作品，缺失时用预设 size；
 *  - 负向词只在 `negativeActive` 时取 `hintOf(preset)`，否则空串；
 *  - 蒙版只在 canvas 工具且数据合法时提交；
 *  - 张数固定 1、等待 0 秒、自动拉起会话（工具动作都是单张即时任务）。
 *
 * 目标路径或提示词（含回退）都缺失时返回 null，由调用方给可见提示。
 */
export function buildImageToolBody(input) {
  const source = input && typeof input === 'object' ? input : {}
  const tool = resolveTool(source.tool)
  if (!tool || !tool.ready) return null
  // 高清放大 / 扩图有各自的请求体（buildUpscaleToolBody / buildOutpaintToolBody）：
  // 这个通用构造器只服务「参考图 + 可选蒙版」的局部重绘与整图重绘。
  if (tool.form === 'instant' || tool.id === 'outpaint') return null

  const targetPath = typeof source.targetPath === 'string' ? source.targetPath.trim() : ''
  if (!targetPath) return null

  const list = Array.isArray(source.presets) ? source.presets : []
  const wantedId = typeof source.presetId === 'string' ? source.presetId.trim() : ''
  const presetCandidate = source.preset && typeof source.preset === 'object' && source.preset.id
    ? source.preset
    : list.find((item) => item && item.id === wantedId) || null
  if (!presetCandidate) return null
  const preset = presetCandidate

  const typed = typeof source.prompt === 'string' ? source.prompt.trim() : ''
  const prompt = (typed || toolPromptFallback(source.targetPrompt)).slice(0, LIMITS.prompt.maxChars)
  if (!prompt) return null

  const target = source.target && typeof source.target === 'object' ? source.target : null
  const rawWidth = positiveSize(source.targetWidth)
    ?? positiveSize(target && target.width)
    ?? positiveSize(preset.size)
  const rawHeight = positiveSize(source.targetHeight)
    ?? positiveSize(target && target.height)
    ?? positiveSize(preset.size)

  const data = maskForSubmit(tool, source.mask)
  const hasMask = Boolean(data)
  const rawStrength = finiteNumber(source.strength)
  const strength = clampMaskStrength(rawStrength === null ? toolStrengthDefaultOf(tool.id, preset) : rawStrength, hasMask)

  const body = {
    presetId: preset.id,
    prompt,
    negativePrompt: source.negativeActive === true ? hintOf(preset) : '',
    width: clampSize(rawWidth),
    height: clampSize(rawHeight),
    steps: presetSteps(preset),
    cfg: presetCfg(preset),
    seed: '',
    count: 1,
    waitSeconds: 0,
    autoStart: true,
    reference: {
      path: targetPath,
      strength,
    },
  }
  if (data) body.reference.mask = data
  return body
}

/**
 * 高清放大请求体（`tool: 'upscale'`，INTERFACES §3.1）。
 *
 * 零参数工具：没有 preset / steps / cfg / seed 语义，尺寸只用于 Host 校验源图上限；
 * 提示词沿用目标作品原提示词（可空串，远端不读扩散参数）。
 * 没有底图路径时返回 null，由调用方给可见提示。
 *
 * @param {{ target?: object, targetPath?: string, targetPrompt?: string,
 *   targetWidth?: number, targetHeight?: number }} input
 */
export function buildUpscaleToolBody(input) {
  const source = input && typeof input === 'object' ? input : {}
  const target = source.target && typeof source.target === 'object' ? source.target : null
  const targetPath = typeof source.targetPath === 'string' && source.targetPath.trim()
    ? source.targetPath.trim()
    : workKeyOf(target)
  if (!targetPath) return null
  const prompt = (typeof source.targetPrompt === 'string' ? source.targetPrompt.trim() : '')
    .slice(0, LIMITS.prompt.maxChars)
  const width = positiveSize(source.targetWidth) ?? positiveSize(target && target.width)
  const height = positiveSize(source.targetHeight) ?? positiveSize(target && target.height)
  const body = {
    tool: 'upscale',
    prompt,
    count: 1,
    waitSeconds: 0,
    autoStart: true,
    reference: { path: targetPath },
  }
  // 宽高未知时留空：Host / 远端会按源图文件兜底，客户端不伪造尺寸。
  if (width !== null) body.width = width
  if (height !== null) body.height = height
  return body
}

/**
 * 扩图请求体（`tool: 'outpaint'`，INTERFACES §3.1）。
 *
 * 远端不新增推理能力：这里提交的是一张已经合成好的画布（`reference.image`）+ 白=新增区的
 * 蒙版（`reference.mask`），`sourcePath` 记录来源作品，供版本树归组。
 *
 * @param {{ targetPath?: string, target?: object, targetPrompt?: string, preset?: object,
 *   presets?: Array<object>, presetId?: string, prompt?: string, strength?: number,
 *   canvas?: object, negativeActive?: boolean }} input
 * @returns {object|null} 缺底图 / 预设 / 画布 / 提示词时返回 null
 */
export function buildOutpaintToolBody(input) {
  const source = input && typeof input === 'object' ? input : {}
  const target = source.target && typeof source.target === 'object' ? source.target : null
  const targetPath = typeof source.targetPath === 'string' && source.targetPath.trim()
    ? source.targetPath.trim()
    : workKeyOf(target)
  if (!targetPath) return null

  const list = Array.isArray(source.presets) ? source.presets : []
  const wantedId = typeof source.presetId === 'string' ? source.presetId.trim() : ''
  const preset = source.preset && typeof source.preset === 'object' && source.preset.id
    ? source.preset
    : list.find((item) => item && item.id === wantedId) || null
  if (!preset) return null

  const canvas = normalizeOutpaintCanvas(source.canvas)
  if (!canvas) return null

  const typed = typeof source.prompt === 'string' ? source.prompt.trim() : ''
  const modernEngine = preset.id === OUTPAINT_ENGINE.presetId && !canvas.mask
  // 现代扩图（FLUX.2 Klein 4B + Outpaint LoRA）留空时由 Host 组装触发词，不在 meta 里写英文触发词也不沿用旧提示词；
  // 旧式 9 通道兜底预设仍允许回退原提示词 / 中性扩图词。
  const prompt = modernEngine
    ? typed.slice(0, LIMITS.prompt.maxChars)
    : (typed || toolPromptFallback(source.targetPrompt) || OUTPAINT_DEFAULT_PROMPT).slice(0, LIMITS.prompt.maxChars)

  const rawStrength = finiteNumber(source.strength)
  const strength = clampMaskStrength(rawStrength === null ? Number(OUTPAINT.strength) : rawStrength, true)
  // 原图在画布里的位置（归一化 0~1）：Host 落盘到 meta.outpaintContent，「对比原图」拉帘
  // 据此把底图放回真实位置。画布校验已通过，这里正常都能算出来；算不出时不发该字段。
  const outpaintContent = buildOutpaintContentBody(canvas)

  return {
    tool: 'outpaint',
    presetId: preset.id,
    prompt,
    negativePrompt: !modernEngine && source.negativeActive === true ? hintOf(preset) : '',
    width: canvas.width,
    height: canvas.height,
    steps: presetSteps(preset),
    cfg: presetCfg(preset),
    seed: '',
    count: 1,
    waitSeconds: 0,
    autoStart: true,
    reference: {
      image: canvas.image,
      ...(canvas.mask ? { mask: canvas.mask, strength } : (!modernEngine ? { strength } : {})),
      sourcePath: targetPath,
      ...(outpaintContent ? { outpaintContent } : {}),
    },
  }
}

/** 非负整数；缺失 / 非法返回 null。 */
function nonNegativeInt(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number)
}

/**
 * 扩图画布归一：校验导出值并补出覆盖率。
 *
 * 入参来自 `OutpaintEditor` 的导出：`{ image, mask, width, height, content }`。
 * 校验项（任何一项不满足返回 null，由调用方转成可见提示）：
 *  - image / mask 是合法 base64，且不超过参考图 / 蒙版契约体积；
 *  - 画布宽高是正整数、按 `LIMITS.width.step` 对齐、在 `OUTPAINT.maxEdge / maxPixels / minEdge` 之内；
 *  - 内容框在画布边界内且面积为正。
 *
 * @returns {{ image: string, mask: string, width: number, height: number,
 *   content: {x:number,y:number,width:number,height:number}, coverage: number } | null}
 */
export function normalizeOutpaintCanvas(input) {
  const source = input && typeof input === 'object' ? input : {}
  const image = normalizeMaskData(source.image)
  const mask = normalizeMaskData(source.mask)
  if (!image) return null
  // 现代绿边画布走 referenceImages（上限 4 MiB），旧带蒙版路径走 reference（8 MiB）与 mask（2 MiB）。
  const imageMaxBytes = mask ? Number(LIMITS.reference.maxBytes) : Number(LIMITS.referenceImages.maxBytes)
  if (base64BytesOf(image) > imageMaxBytes) return null
  if (mask && base64BytesOf(mask) > Number(LIMITS.mask.maxBytes)) return null

  const step = Number(LIMITS.width.step) > 0 ? Number(LIMITS.width.step) : 8
  const maxEdge = Number(OUTPAINT.maxEdge)
  const maxPixels = Number(OUTPAINT.maxPixels)
  const minEdge = Number(OUTPAINT.minEdge)
  const width = positiveSize(source.width)
  const height = positiveSize(source.height)
  if (width === null || height === null) return null
  if (width % step !== 0 || height % step !== 0) return null
  if (width > maxEdge || height > maxEdge) return null
  if (width * height > maxPixels) return null
  if (width < minEdge || height < minEdge) return null

  const contentInput = source.content && typeof source.content === 'object' ? source.content : null
  if (!contentInput) return null
  const x = nonNegativeInt(contentInput.x)
  const y = nonNegativeInt(contentInput.y)
  const contentWidth = positiveSize(contentInput.width)
  const contentHeight = positiveSize(contentInput.height)
  if (x === null || y === null || contentWidth === null || contentHeight === null) return null
  if (x + contentWidth > width || y + contentHeight > height) return null
  const content = { x, y, width: contentWidth, height: contentHeight }
  const coverage = Math.max(0, Math.min(1, 1 - (contentWidth * contentHeight) / (width * height)))
  return {
    image,
    mask,
    width,
    height,
    content,
    coverage: Number(coverage.toFixed(6)),
  }
}

/**
 * 提交前置校验：返回第一个拦截原因的文案键（空串表示可以提交）。
 *
 * 检查顺序与界面提示一致：工具可提交 → 有底图。之后按工具分支：
 *  - upscale：源图长边超过 `UPSCALE.maxInputEdge` → `upscaleTooLarge`；宽高未知时放行（远端兜底）；
 *  - outpaint：有可用预设 → 有画布 → 有提示词（含回退）；
 *  - inpaint / img2img：有可用预设 → 有提示词 → 专用局部重绘权重必须有蒙版。
 * 最后一条复用既有 `studio.mask.onlyHint` 文案，不再新增键。
 */
export function imageToolBlockedKeyOf(input) {
  const source = input && typeof input === 'object' ? input : {}
  const tool = resolveTool(source.tool)
  if (!tool) return 'studio.imageTool.blockedTarget'
  if (!tool.ready) return tool.plannedKey || 'studio.imageTool.planned'
  const targetPath = typeof source.targetPath === 'string' && source.targetPath.trim()
    ? source.targetPath.trim()
    : workKeyOf(source.target)
  if (!targetPath) return 'studio.imageTool.blockedTarget'
  if (tool.id === 'upscale') {
    const target = source.target && typeof source.target === 'object' ? source.target : null
    const width = positiveSize(source.targetWidth) ?? positiveSize(target && target.width)
    const height = positiveSize(source.targetHeight) ?? positiveSize(target && target.height)
    // 长边只对已知尺寸生效：旧记录没有宽高时交给远端兜底，客户端不误拦。
    if (width !== null && height !== null && Math.max(width, height) > Number(UPSCALE.maxInputEdge)) {
      return 'studio.imageTool.upscaleTooLarge'
    }
    return ''
  }
  if (!source.preset || typeof source.preset !== 'object' || !source.preset.id) {
    return 'studio.imageTool.blockedNoPreset'
  }
  if (tool.id === 'outpaint') {
    if (!normalizeOutpaintCanvas(source.canvas)) return 'studio.outpaint.blockedCanvas'
    return ''
  }
  const typed = typeof source.prompt === 'string' ? source.prompt.trim() : ''
  if (!typed && !toolPromptFallback(source.targetPrompt)) return 'studio.imageTool.blockedNoPrompt'
  // 专用局部重绘权重必须带蒙版；只对画布形态生效（整图重绘在选模阶段就会换成通用垫图模型）。
  if (tool.form === 'canvas' && inpaintOnlyOf(source.preset) && !maskForSubmit(tool, source.mask)) {
    return 'studio.mask.onlyHint'
  }
  return ''
}

/**
 * 作品键：条目 / 图片 / 字符串 → 稳定的工作区相对路径。
 *
 * 工具的底图绑定、草稿恢复（阶段十三）都按这个键判「是不是同一张作品」；
 * 拿不到路径时返回空串，调用方按「无有效底图」处理。
 */
export function workKeyOf(value) {
  if (typeof value === 'string') return value.trim()
  const holder = value && typeof value === 'object' ? value : null
  if (!holder) return ''
  const image = holder.image && typeof holder.image === 'object' ? holder.image : holder
  const path = typeof image.path === 'string'
    ? image.path.trim()
    : typeof image.file === 'string'
      ? image.file.trim()
      : ''
  return path
}

/**
 * 工具状态摘要：给确认卡 / 诊断日志用的轻量结构（不包含蒙版 base64）。
 *
 * 只做展示与排障，不参与提交判定；`promptChars` 是工具输入本身的长度，
 * 回退目标作品提示词的情况由 `promptFallback` 标出。
 */
export function imageToolSummary(input) {
  const source = input && typeof input === 'object' ? input : {}
  const tool = resolveTool(source.tool)
  const data = maskForSubmit(tool, source.mask)
  const hasMask = Boolean(data)
  const typed = typeof source.prompt === 'string' ? source.prompt.trim() : ''
  return {
    tool: tool ? tool.id : '',
    form: tool ? tool.form : '',
    targetPath: typeof source.targetPath === 'string' ? source.targetPath.trim() : '',
    presetId: source.preset && typeof source.preset === 'object' && source.preset.id ? source.preset.id : '',
    promptChars: typed.length,
    promptFallback: Boolean(!typed && toolPromptFallback(source.targetPrompt)),
    strength: clampMaskStrength(source.strength, hasMask),
    hasMask,
    coverage: hasMask && source.mask && typeof source.mask === 'object'
      ? maskStateOf({ coverage: source.mask.coverage }).coverage
      : 0,
    negative: source.negativeActive === true,
  }
}
