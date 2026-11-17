/**
 * 局部重绘（Inpaint）蒙版的纯逻辑。
 *
 * 蒙版是一张「白 = 重绘区域、黑 = 保留区域」的 PNG，和参考图一起提交：
 *  - 画布绘制、像素反选与 PNG 导出需要 DOM，留在 `src/studio/stage/MaskEditor.jsx`；
 *  - 画笔边界、涂抹状态转换、导出前置校验与 base64 归一放在这里，便于离线断言，
 *    由 MaskEditor 与 `useImageTool` 共用同一套规则。
 *
 * 阶段十二起蒙版不再挂在文生图表单的 `reference.mask` 上，而是图片工具草稿的
 * `mask`（`{ data, coverage, digest }`）：换作品 / 提交成功时由工具域整体清空。
 */

import { LIMITS } from '../../shared/contract.js'

/** 画笔尺寸（画布像素）：边界与步长在这里收敛，滑块与绘制用同一组值。 */
export const MASK_BRUSH = Object.freeze({ min: 8, max: 96, step: 4, default: 40 })

/**
 * 最小有效涂抹比例（占整张画布）。
 *
 * 低于它视为空蒙版：不生成 mask 字段、按整图 img2img 提交，避免把误触的一两个像素
 * 当成局部重绘。取值略小于「默认画笔单击一次」在 1024 长边画布上的占比
 * （默认画笔 40 → 半径 20，约 0.1%~0.2%），一次落点就算有效涂抹。
 */
export const MASK_MIN_COVERAGE = 0.0005

/** canvas.toDataURL() 的默认前缀：提交前剥掉，Host 也接受带前缀的写法。 */
export const MASK_DATA_URL_PREFIX = 'data:image/png;base64,'

/** 键盘涂抹时方向键单次移动的步长（画布像素）。 */
export const MASK_KEY_STEP = 32

/**
 * 涂抹模式的默认重绘强度。
 *
 * 真机验收结论（2026-11-16，SDXL Lightning 4 步、1024² 中心 40% 蒙版）：
 * 契约默认 0.6 只重写约 2 步、蒙版区平均变化约 10/255，肉眼偏弱；0.9 能明显重写
 * （约 25/255）但边界偏硬。0.8 是「能看出来在改」与「边界还能接受」的折中。
 * 只在用户没主动调过强度（仍是契约默认值）时套用，改过的值一律尊重。
 */
export const MASK_STRENGTH_DEFAULT = 0.8

/**
 * 专用 inpaint 权重（9 通道）下的涂抹默认强度。
 *
 * 真机验收（2026-11-16）：这类底座的文本遵循在「整体重绘」时才充分发挥；小蒙版 +
 * 0.8 强度时原图上下文会压过提示词（想插入的新内容几乎不出现），调到接近 1.0 才会
 * 明显替换。契约上限是 0.9，因此这里直接取 0.9。
 */
export const MASK_STRENGTH_NATIVE = 0.9

/**
 * 强度上限：有蒙版时用契约的 `strength.inpaintMax`（局部重绘允许更强替换），
 * 旧契约 / 旧宿主没有该项时回落通用 `strength.max`；img2img 始终用通用上限。
 */
export function strengthMaxOf(hasMask) {
  const max = Number(LIMITS.strength.max)
  if (!hasMask) return max
  const inpaintMax = Number(LIMITS.strength.inpaintMax)
  if (!Number.isFinite(inpaintMax)) return max
  return Math.max(max, inpaintMax)
}

/**
 * mask-aware 的重绘强度归一：边界 / step 对齐 / 浮点噪声规则与 `clampStrength` 一致，
 * 只有上限按「本次是否提交蒙版」切换。表单滑块与请求体都必须走同一套口径。
 */
export function clampMaskStrength(value, hasMask) {
  const { min, step, default: fallback } = LIMITS.strength
  const max = strengthMaxOf(hasMask)
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(max, Math.max(min, number))
  const aligned = min + Math.round((clamped - min) / step) * step
  return Math.round(aligned * 1000) / 1000
}

/** 蒙版画布长边像素：黑底 PNG 压得很小，1024 足够保留涂抹边界细节。 */
export const MASK_CANVAS_EDGE = 1024

/** 画笔尺寸归一：缺失值回落默认，越界钳制，并按 step 对齐到最近档位。 */
export function clampBrushSize(value) {
  // 与 clampSize / clampStrength 同一约定：null / 空串算「没填」，回默认值；显式 0 才按边界钳。
  if (value === null || value === undefined) return MASK_BRUSH.default
  if (typeof value === 'string' && value.trim() === '') return MASK_BRUSH.default
  const number = Number(value)
  if (!Number.isFinite(number)) return MASK_BRUSH.default
  const clamped = Math.min(MASK_BRUSH.max, Math.max(MASK_BRUSH.min, number))
  const aligned = MASK_BRUSH.min + Math.round((clamped - MASK_BRUSH.min) / MASK_BRUSH.step) * MASK_BRUSH.step
  return Math.min(MASK_BRUSH.max, Math.max(MASK_BRUSH.min, aligned))
}

/** 涂抹工具状态：画笔尺寸 + 是否橡皮擦；缺字段时给出默认值。 */
export function brushStateOf(partial) {
  const input = partial && typeof partial === 'object' ? partial : {}
  return { size: clampBrushSize(input.size), eraser: input.eraser === true }
}

/** 切换橡皮擦，尺寸保留。 */
export function toggleEraser(state) {
  const current = brushStateOf(state)
  return { size: current.size, eraser: !current.eraser }
}

/** 覆盖率归一：非法 / 负数按 0，超过 1 按 1，浮点噪声收在 6 位小数内。 */
function coverageOf(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  if (number >= 1) return 1
  return Number(number.toFixed(6))
}

/**
 * 涂抹结果状态：只保留覆盖率。
 *
 * 画布内容本身在 DOM 里，纯逻辑只需要「有没有有效涂抹 / 涂了多少」这两个派生值，
 * 用来驱动提示文案、空蒙版判定与导出前的体积校验。
 */
export function maskStateOf(partial) {
  const input = partial && typeof partial === 'object' ? partial : {}
  return { coverage: coverageOf(input.coverage) }
}

/** 空涂抹状态（清空蒙版后的状态）。 */
export function emptyMaskState() {
  return { coverage: 0 }
}

/** 当前涂抹是否达到最小有效面积（低于阈值按空蒙版处理）。 */
export function maskHasInk(state) {
  return maskStateOf(state).coverage >= MASK_MIN_COVERAGE
}

/**
 * 涂抹比例：非透明像素 / 总像素。
 *
 * 非法输入按 0 处理（空画布 / 尺寸还没量出来时不会误报）。
 */
export function maskCoverageOf(inkPixels, totalPixels) {
  const ink = Number(inkPixels)
  const total = Number(totalPixels)
  if (!Number.isFinite(ink) || !Number.isFinite(total) || total <= 0 || ink <= 0) return 0
  return coverageOf(ink / total)
}

/**
 * 蒙版画布尺寸：按参考图宽高比把长边缩到 `edge`，短边等比。
 *
 * 远端按最近邻把蒙版对齐到参考图精确宽高，所以画布必须与参考图同比例，
 * 否则导出后拉伸会造成涂抹区域错位。宽高缺失时退回正方形。
 */
export function maskCanvasSizeOf(width, height, edge = MASK_CANVAS_EDGE) {
  const limit = Number.isFinite(Number(edge)) && Number(edge) >= 64 ? Math.round(Number(edge)) : MASK_CANVAS_EDGE
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: limit, height: limit }
  }
  const scale = limit / Math.max(w, h)
  return {
    width: Math.max(48, Math.round(w * scale)),
    height: Math.max(48, Math.round(h * scale)),
  }
}

/** base64 文本 → 原始字节数（用于契约体积校验，不真正解码）。 */
export function base64BytesOf(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding)
}

/**
 * 蒙版数据归一：去掉 PNG data URL 前缀与空白，返回裸 base64；不合法返回空串。
 *
 * 只做「是不是 base64」的轻校验；PNG 魔数、完整解码与尺寸对齐由 Host / 远端负责，
 * 客户端不重复实现一遍图片解析。
 */
export function normalizeMaskData(data) {
  if (typeof data !== 'string') return ''
  let text = data.trim()
  if (text.toLowerCase().startsWith(MASK_DATA_URL_PREFIX)) text = text.slice(MASK_DATA_URL_PREFIX.length)
  text = text.replace(/\s+/g, '')
  if (!text || text.length % 4 !== 0) return ''
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return ''
  return text
}

/**
 * 表单参考图里的蒙版 → 归一后的蒙版对象 `{ data, coverage, digest }`。
 *
 * 兼容两种写法：`reference.mask = { data, coverage }`（表单形态）与
 * `reference.mask = '…base64…'`（外部直接给请求体形态）。没有合法蒙版时返回 null。
 */
export function referenceMaskOf(reference) {
  const mask = reference && typeof reference === 'object' ? reference.mask : null
  if (!mask) return null
  const raw = typeof mask === 'string' ? { data: mask } : mask
  const data = normalizeMaskData(raw.data)
  if (!data) return null
  return {
    data,
    coverage: maskStateOf({ coverage: raw.coverage }).coverage,
    digest: maskDigestOf(data),
  }
}

/** 表单参考图的蒙版数据（裸 base64）；没有合法蒙版返回空串。 */
export function referenceMaskDataOf(reference) {
  const mask = referenceMaskOf(reference)
  return mask ? mask.data : ''
}

/**
 * 提交用蒙版：只有字节数在契约上限内才返回裸 base64。
 *
 * 超出上限时宁可退回整图 img2img，也不提交一个必被 Host 拒绝的字段；
 * 表单侧的 `applyMask()` 会在更早一步拦住超限蒙版并给出提示。
 */
export function referenceMaskForSubmit(reference) {
  const data = referenceMaskDataOf(reference)
  if (!data) return ''
  const bytes = base64BytesOf(data)
  if (bytes <= 0 || bytes > LIMITS.mask.maxBytes) return ''
  return data
}

/**
 * 导出前置校验：画布导出的 PNG base64 + 涂抹覆盖率 → 可提交的蒙版数据或失败原因。
 *
 * 失败原因：
 *  - `empty`：没有达到最小有效涂抹面积（未涂抹 / 全擦掉）；
 *  - `too_large`：原始字节超过 `LIMITS.mask.maxBytes`；
 *  - `invalid`：不是合法的 base64 PNG 文本。
 */
export function maskExportVerdict(data, coverage) {
  const normalized = normalizeMaskData(data)
  if (!normalized) return { ok: false, reason: 'invalid' }
  const state = maskStateOf({ coverage })
  if (!maskHasInk(state)) return { ok: false, reason: 'empty' }
  const bytes = base64BytesOf(normalized)
  if (bytes <= 0) return { ok: false, reason: 'invalid' }
  if (bytes > LIMITS.mask.maxBytes) return { ok: false, reason: 'too_large' }
  return { ok: true, data: normalized, coverage: state.coverage, bytes }
}

/**
 * 蒙版指纹：表单脏判定快照用。
 *
 * 不能把几 MB 的 base64 整个拼进快照（每次渲染都要重算 dirty），这里用 FNV-1a 32 位
 * 加字符长度做键；对同一次会话内的手绘蒙版，碰撞概率可以忽略。
 */
export function maskDigestOf(data) {
  const normalized = normalizeMaskData(data)
  if (!normalized) return ''
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16)}-${normalized.length}`
}

/** 画布视图缩放区间：1×（贴合光桌）到 4×（细节边缘），小步进供滚轮与快捷键共用。 */
export const MASK_ZOOM = Object.freeze({ min: 1, max: 4, step: 0.15, default: 1 })

/** 蒙版撤销栈上限：单张 1024² ImageData 约 4MB，15 步在实用与内存之间平衡。 */
export const MASK_UNDO_LIMIT = 15

/** 缩放倍率归一：越界钳制，贴近 1.0 时直接吸附为 1，避免出现 1.01× 还显示复位按钮。 */
export function clampZoom(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= MASK_ZOOM.min + 0.02) return MASK_ZOOM.min
  if (num >= MASK_ZOOM.max) return MASK_ZOOM.max
  return Math.round(num * 100) / 100
}

/**
 * 画布平移边界钳制：zoom = 1 时强制回中；放大后最多允许把画布中心移到容器半宽/半高加余量处，
 * 确保任意角度都能拖进视野中心且不会把整张画布拖飞出视口。
 */
export function clampPan(pan, options = {}) {
  const zoom = clampZoom(options.zoom)
  if (zoom <= MASK_ZOOM.min) return { x: 0, y: 0 }
  const input = pan && typeof pan === 'object' ? pan : {}
  const x = Number(input.x)
  const y = Number(input.y)
  const stageW = Math.max(0, Number(options.stageWidth) || 0)
  const stageH = Math.max(0, Number(options.stageHeight) || 0)
  const viewW = Math.max(0, Number(options.viewWidth) || 0)
  const viewH = Math.max(0, Number(options.viewHeight) || 0)
  // 若未提供容器尺寸，不截断（仅取有限数值）；有尺寸时至少保留 20% 画面在光桌内。
  const maxX = stageW > 0 && viewW > 0 ? Math.max(0, (stageW * zoom + viewW * 0.6) / 2 - viewW * 0.2) : Infinity
  const maxY = stageH > 0 && viewH > 0 ? Math.max(0, (stageH * zoom + viewH * 0.6) / 2 - viewH * 0.2) : Infinity
  return {
    x: Number.isFinite(x) ? Math.round(Math.min(maxX, Math.max(-maxX, x)) * 100) / 100 : 0,
    y: Number.isFinite(y) ? Math.round(Math.min(maxY, Math.max(-maxY, y)) * 100) / 100 : 0,
  }
}

/**
 * 以指针所在位置为中心缩放画布。
 *
 * `anchor` 是指针相对于「未平移时的画布中心」的偏移（px）；缩放前后同一图像点
 * 仍落在 `anchor` 处：nextPan = anchor - (anchor - pan) * (nextZoom / zoom)。
 */
export function zoomAtPoint({ zoom, pan, anchor, nextZoom, bounds }) {
  const currentZoom = clampZoom(zoom)
  const targetZoom = clampZoom(nextZoom)
  if (targetZoom <= MASK_ZOOM.min) {
    return { zoom: MASK_ZOOM.min, pan: { x: 0, y: 0 } }
  }
  const currentPan = pan && typeof pan === 'object' ? pan : { x: 0, y: 0 }
  const ax = Number(anchor && anchor.x) || 0
  const ay = Number(anchor && anchor.y) || 0
  const ratio = targetZoom / currentZoom
  const rawPan = {
    x: ax - (ax - (Number(currentPan.x) || 0)) * ratio,
    y: ay - (ay - (Number(currentPan.y) || 0)) * ratio,
  }
  return {
    zoom: targetZoom,
    pan: clampPan(rawPan, { ...(bounds || {}), zoom: targetZoom }),
  }
}

/** 按步进调整画笔尺寸（delta > 0 放大，< 0 缩小），用于 Shift+滚轮 与 [ / ] 快捷键。 */
export function stepBrushSize(current, direction) {
  const size = clampBrushSize(current)
  const dir = Number(direction)
  if (!Number.isFinite(dir) || dir === 0) return size
  const step = dir > 0 ? MASK_BRUSH.step : -MASK_BRUSH.step
  return clampBrushSize(size + step)
}
