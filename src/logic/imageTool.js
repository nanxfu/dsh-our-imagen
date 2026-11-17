/**
 * 舞台图片工具（方案 B）的纯逻辑。
 *
 * 阶段十二把「针对已生成作品的二次处理」从文生图主表单里彻底抽离：
 * 工具注册表、自动选模、强度档位、提示词回退与请求体拼装都收敛在这里，
 * 不依赖 React / DOM，便于离线断言；状态编排见 `src/studio/hooks/useImageTool.js`，
 * 画布交互见 `src/studio/stage/MaskEditor.jsx`。
 *
 * 交互形态（面向未来的高清化 / 扩图）：
 *  - `instant`：无参工具，点击即按当前图片提交；
 *  - `inline`：舞台下方展开一条轻量参数（整图重绘）；
 *  - `canvas`：整块舞台切成交互画布（局部涂抹 / 扩图）。
 *
 * 阶段十二只有 inpaint（canvas）与 img2img（inline）两个真实可用的工具；
 * upscale / outpaint 是 disabled 占位——远端没有对应推理能力（Lead 决策 D1）。
 */

import { LIMITS } from '../../shared/contract.js'

import { clampInt, clampNumber, clampSize } from './clamp.js'
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

/** 工具交互形态：新增工具时必须落在三类之一，动作坞按它决定打开方式。 */
export const IMAGE_TOOL_FORMS = Object.freeze(['instant', 'inline', 'canvas'])

/** 动作坞分组：图片处理（针对当前作品的二次处理）与创作复用（继续创作）。 */
export const IMAGE_TOOL_GROUPS = Object.freeze(['process', 'reuse'])

/** 局部重绘首选的专用权重预设：当前模型不支持 Inpaint 时优先切到它。 */
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
 *  - `plannedKey`：未开放工具的提示文案键（只有 ready=false 时有值）。
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
    capability: null,
    labelKey: 'studio.imageTool.upscale',
    ready: false,
    plannedKey: 'studio.imageTool.planned',
  }),
  Object.freeze({
    id: 'outpaint',
    form: 'canvas',
    group: 'process',
    icon: 'frame',
    capability: 'supportsInpaint',
    labelKey: 'studio.imageTool.outpaint',
    ready: false,
    plannedKey: 'studio.imageTool.planned',
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
 *  - inpaint：当前预设支持 Inpaint 就沿用；否则优先专用权重 `sdxl-inpaint`（存在且支持时），
 *    再退 `referencePresetOf()` 的通用垫图兜底；一个都没有 → preset: null。
 *  - img2img：当前预设支持整图垫图就沿用；否则退 `referencePresetOf()`。
 *    专用局部重绘权重（inpaintOnly）不能做纯整图重绘，即使它声明 supportsImg2Img 也不沿用。
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

  if (tool.id === 'img2img') {
    if (supportsImg2Img(current) && !inpaintOnlyOf(current)) {
      return { preset: current, switched: false, fallback: false }
    }
    const fallback = referencePresetOf(list)
    if (fallback) return { preset: fallback, switched: true, fallback: true }
    return { preset: null, switched: false, fallback: true }
  }

  // instant 类型目前只有未开放的高清放大：没有可提交的能力路径。
  return missing
}

/**
 * 工具的默认重绘强度（打开工具时套用，用户拖动即退出自动档）。
 *
 * - inpaint：专用 inpaint 权重 0.9，通用模型 0.8（真机验收结论，见 logic/mask.js）；
 * - img2img：契约默认 0.6。
 */
export function toolStrengthDefaultOf(toolId, preset) {
  const tool = imageToolOf(toolId)
  if (tool && tool.id === 'inpaint') {
    return inpaintOnlyOf(preset) ? MASK_STRENGTH_NATIVE : MASK_STRENGTH_DEFAULT
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

/**
 * 提交提示词：工具输入为空时回退目标作品自己的提示词（Lead 决策 D2）。
 *
 * 返回去掉首尾空白并按契约截断后的文本；目标作品也没有提示词时返回空串，
 * 由调用方用 `blockedNoPrompt` 拦下（只有两边都为空才算真的缺提示词）。
 */
export function toolPromptFallback(targetPrompt) {
  return String(targetPrompt ?? '').trim().slice(0, LIMITS.prompt.maxChars)
}

/** 正数像素值；缺失 / 非法返回 null（交给预设 size 兜底）。 */
function positiveSize(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number)
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
 * 提交前置校验：返回第一个拦截原因的文案键（空串表示可以提交）。
 *
 * 检查顺序与界面提示一致：工具可提交 → 有底图 → 有可用预设 → 有提示词 →
 * 专用局部重绘权重必须有蒙版。最后一条复用既有 `studio.mask.onlyHint` 文案，
 * 不再新增键。
 */
export function imageToolBlockedKeyOf(input) {
  const source = input && typeof input === 'object' ? input : {}
  const tool = resolveTool(source.tool)
  if (!tool) return 'studio.imageTool.blockedTarget'
  if (!tool.ready) return tool.plannedKey || 'studio.imageTool.planned'
  const targetPath = typeof source.targetPath === 'string' ? source.targetPath.trim() : ''
  if (!targetPath) return 'studio.imageTool.blockedTarget'
  if (!source.preset || typeof source.preset !== 'object' || !source.preset.id) {
    return 'studio.imageTool.blockedNoPreset'
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
