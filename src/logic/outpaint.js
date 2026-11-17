/**
 * 扩图（outpaint）画布构造的纯逻辑。
 *
 * 扩图不新增远端推理能力：客户端把源图缩放后放进更大的画布，把新增区域涂白生成蒙版，
 * 再按普通局部重绘（`sdxl-inpaint` 9 通道权重）提交。所以「画布多大、原图放在哪里、
 * 新增区域占多少」这些几何计算全部收敛在这里，不依赖 React / DOM，便于离线断言；
 * 像素合成与导出见 `src/studio/stage/OutpaintEditor.jsx`，状态编排见
 * `src/studio/hooks/useImageTool.js`。
 *
 * 两种模式（对应舞台顶部的比例胶囊）：
 *  - `source`（四边扩 20%）：画布 = 内容 × `OUTPAINT.expandRatio`，四边都有留白，anchor 两轴都生效；
 *  - 目标画幅（16:9 / 9:16 / 4:3）：画布按目标比例，内容等比放入后**只在一个轴上加留白**，
 *    anchor 只对留白那一轴生效（另一轴内容铺满）。
 *
 * 所有尺寸都按 `LIMITS.width.step`（8px）对齐：画布宽高、内容框宽高、留白偏移都是 8 的倍数，
 * 这样导出的 image / mask 与 Host 的尺寸契约一致，也不会因奇数像素出现半像素接缝。
 */

import { LIMITS, OUTPAINT } from '../../shared/contract.js'

/** 目标画幅胶囊的 id 顺序（不含「四边扩 20%」快捷项）。 */
export const OUTPAINT_RATIO_IDS = [...OUTPAINT.ratioIds]

/** 「四边扩 20%」快捷胶囊的 id。 */
export const OUTPAINT_EXPAND_ID = OUTPAINT.expandId

/** 界面胶囊顺序：快捷项在最前，其余保持契约顺序。 */
export const OUTPAINT_RATIO_ORDER = Object.freeze([OUTPAINT.expandId, ...OUTPAINT.ratioIds])

/** 比例胶囊的文案键；键名与 `src/dict/*.js` 的 `studio.outpaint.ratio.*` 一一对应。 */
const RATIO_LABEL_KEYS = Object.freeze({
  [OUTPAINT.expandId]: 'studio.outpaint.ratio.expand',
  '16:9': 'studio.outpaint.ratio.16x9',
  '9:16': 'studio.outpaint.ratio.9x16',
  '4:3': 'studio.outpaint.ratio.4x3',
})

/** 目标画幅 id → 宽高比；未知 id 返回 null。 */
const RATIO_VALUES = Object.freeze({
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
})

/** 尺寸对齐步长（契约里宽高都是 8 的倍数）。 */
const STEP = Number(LIMITS.width.step) > 0 ? Number(LIMITS.width.step) : 8

/** 源图宽高与目标比例恰好相同时的判定容差：小于它就认为「没有留白可加」。 */
const SAME_RATIO_EPSILON = 0.002

/** 正数像素（四舍五入）；缺失 / 非法返回 null。 */
function positiveSize(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number)
}

/** 向下取整到 8 的倍数；不足 8 返回 8（真正的下限由 minEdge 校验兜住）。 */
function alignDown(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return STEP
  return Math.max(STEP, Math.floor(number / STEP) * STEP)
}

/** 就近取整到 8 的倍数（用于留白分配）。 */
function alignNear(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.max(0, Math.round(number / STEP) * STEP)
}

/** 把数值对齐到 [0, limit] 内、且是 8 的倍数；limit 自身也应是 8 的倍数。 */
function alignWithin(value, limit) {
  const max = Math.max(0, Math.floor(Number(limit) / STEP) * STEP)
  if (max <= 0) return 0
  const aligned = Math.max(0, Math.round(Number(value) / STEP) * STEP)
  return Math.min(max, aligned)
}

/** 0~1 归一，保留 4 位小数（拖拽时避免浮点噪声进状态）。 */
function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.round(Math.min(1, Math.max(0, number)) * 10000) / 10000
}

/** 覆盖率保留 6 位小数，与 `logic/mask.js` 的口径一致。 */
function coverageOf(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  if (number >= 1) return 1
  return Number(number.toFixed(6))
}

/** 各边像素下限 / 画布上限：契约缺失时回落到与契约相同的默认值。 */
function boundsOf() {
  const maxEdge = Number(OUTPAINT.maxEdge) > 0 ? Number(OUTPAINT.maxEdge) : 1536
  const maxPixels = Number(OUTPAINT.maxPixels) > 0 ? Number(OUTPAINT.maxPixels) : 1600000
  const minEdge = Number(OUTPAINT.minEdge) > 0 ? Number(OUTPAINT.minEdge) : 256
  const expandRatio = Number(OUTPAINT.expandRatio) > 1 ? Number(OUTPAINT.expandRatio) : 1.2
  return { maxEdge, maxPixels, minEdge, expandRatio }
}

/**
 * 扩图比例胶囊数据：`[{ id, labelKey }]`。
 *
 * 只给顺序与文案键，不掺 DOM；界面按顺序渲染胶囊、用 `labelKey` 取文案。
 */
export function outpaintRatioOptions() {
  return OUTPAINT_RATIO_ORDER.map((id) => ({ id, labelKey: RATIO_LABEL_KEYS[id] || '' }))
}

/** 比例 id 归一：未知 / 空值回落到「四边扩 20%」。 */
export function outpaintRatioIdOf(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (id === OUTPAINT.expandId || OUTPAINT_RATIO_IDS.includes(id)) return id
  return OUTPAINT.expandId
}

/**
 * 留白锚点归一：`{ x, y }` 各自落在 0~1，缺失 / 非法按 0.5（居中）。
 *
 * 0 = 内容贴左边（或上边）、1 = 贴右边（或下边）；单个轴没有留白时该轴的值不影响结果。
 */
export function outpaintAnchorOf(value) {
  const input = value && typeof value === 'object' ? value : {}
  return { x: clamp01(input.x), y: clamp01(input.y) }
}

/** 覆盖率：新增区域（画布 − 内容框）/ 画布，0~1；非法 plan 返回 0。 */
export function outpaintCoverageOf(plan) {
  const source = plan && typeof plan === 'object' && plan.ok === true ? plan : null
  if (!source) return 0
  const width = Number(source.width)
  const height = Number(source.height)
  const content = source.content && typeof source.content === 'object' ? source.content : null
  if (!content) return 0
  const contentWidth = Number(content.width)
  const contentHeight = Number(content.height)
  if (!(width > 0) || !(height > 0) || !(contentWidth > 0) || !(contentHeight > 0)) return 0
  return coverageOf(1 - (contentWidth * contentHeight) / (width * height))
}

/**
 * 方向键 / 拖拽后的锚点平移：`delta` 是内容框在画布坐标系里的像素位移。
 *
 * 只沿「真的有留白」的轴移动（目标画幅模式只有一个轴有留白）；结果自动钳到 0~1，
 * 调用方不必再判断边界。plan 非法时原样返回归一后的锚点。
 */
export function outpaintAnchorShift(plan, anchor, delta) {
  const current = outpaintAnchorOf(anchor)
  const source = plan && typeof plan === 'object' && plan.ok === true ? plan : null
  if (!source) return current
  const padding = source.padding && typeof source.padding === 'object' ? source.padding : {}
  const padX = Math.max(0, Number(padding.left) || 0) + Math.max(0, Number(padding.right) || 0)
  const padY = Math.max(0, Number(padding.top) || 0) + Math.max(0, Number(padding.bottom) || 0)
  const dx = Number(delta && delta.x)
  const dy = Number(delta && delta.y)
  const next = { ...current }
  if (padX > 0 && Number.isFinite(dx) && dx !== 0) next.x = clamp01(current.x + dx / padX)
  if (padY > 0 && Number.isFinite(dy) && dy !== 0) next.y = clamp01(current.y + dy / padY)
  return outpaintAnchorOf(next)
}

/** 由内容尺寸与画布尺寸算出内容框位置与四边留白（留白按 anchor 分配并 8px 对齐）。 */
function layoutOf(width, height, contentWidth, contentHeight, anchor, ratioId, scale) {
  const totalX = Math.max(0, width - contentWidth)
  const totalY = Math.max(0, height - contentHeight)
  const left = alignWithin(totalX * anchor.x, totalX)
  const top = alignWithin(totalY * anchor.y, totalY)
  const padding = { left, right: totalX - left, top, bottom: totalY - top }
  const content = { x: left, y: top, width: contentWidth, height: contentHeight }
  const plan = { ok: true, ratioId, width, height, content, padding, coverage: 0, scale }
  plan.coverage = outpaintCoverageOf(plan)
  return plan
}

/**
 * 「四边扩 20%」：内容 = 源图等比缩放，画布 = 内容 × expandRatio。
 *
 * 源图超过画布上限时先整体缩小内容（保持比例），再按 8px 对齐重算留白；
 * 缩到画布短边不足 `minEdge` 时判定放不下（返回 `too_small`），不硬凑一张会糊的画布。
 */
function expandPlanOf(sourceWidth, sourceHeight, anchor) {
  const { maxEdge, maxPixels, minEdge, expandRatio } = boundsOf()
  // 先按「扩展后画布」的原始尺寸倒推允许的最大缩放，后续对齐只会让结果更小。
  let scale = 1
  scale = Math.min(scale, maxEdge / (sourceWidth * expandRatio))
  scale = Math.min(scale, maxEdge / (sourceHeight * expandRatio))
  scale = Math.min(scale, Math.sqrt(maxPixels / (sourceWidth * expandRatio * sourceHeight * expandRatio)))
  if (!(scale > 0)) return { ok: false, reason: 'bounds' }

  let contentWidth = alignDown(sourceWidth * scale)
  let contentHeight = alignDown(sourceHeight * scale)
  if (contentWidth < STEP || contentHeight < STEP) return { ok: false, reason: 'too_small' }

  let padX = alignNear((contentWidth * (expandRatio - 1)) / 2)
  let padY = alignNear((contentHeight * (expandRatio - 1)) / 2)
  let width = contentWidth + padX * 2
  let height = contentHeight + padY * 2

  // 留白向上取整可能把画布顶出上限：按 2% 逐步收回内容，直到满足全部约束。
  for (let guard = 0; guard < 120; guard += 1) {
    if (width <= maxEdge && height <= maxEdge && width * height <= maxPixels) break
    contentWidth = alignDown(contentWidth * 0.98)
    contentHeight = alignDown(contentHeight * 0.98)
    if (contentWidth <= STEP || contentHeight <= STEP) return { ok: false, reason: 'too_small' }
    padX = alignNear((contentWidth * (expandRatio - 1)) / 2)
    padY = alignNear((contentHeight * (expandRatio - 1)) / 2)
    width = contentWidth + padX * 2
    height = contentHeight + padY * 2
  }
  if (width > maxEdge || height > maxEdge || width * height > maxPixels) return { ok: false, reason: 'bounds' }
  if (width < minEdge || height < minEdge) return { ok: false, reason: 'too_small' }

  return layoutOf(width, height, contentWidth, contentHeight, anchor, OUTPAINT.expandId, contentWidth / sourceWidth)
}

/**
 * 目标画幅：内容等比放入目标比例的画布，只在一个轴上加留白。
 *
 * - 源图更宽（aspect > target）：内容铺满画布宽度，上下留白；
 * - 源图更窄（aspect < target）：内容铺满画布高度，左右留白；
 * - 比例相同：没有新增区域，返回 `no_padding`。
 */
function ratioPlanOf(sourceWidth, sourceHeight, ratioId, anchor) {
  const targetRatio = RATIO_VALUES[ratioId]
  if (!targetRatio) return { ok: false, reason: 'invalid_ratio' }
  const { maxEdge, maxPixels, minEdge } = boundsOf()
  const aspect = sourceWidth / sourceHeight
  if (Math.abs(aspect - targetRatio) <= targetRatio * SAME_RATIO_EPSILON) {
    return { ok: false, reason: 'no_padding' }
  }

  let contentWidth
  let contentHeight
  if (aspect > targetRatio) {
    // 源更宽：宽度铺满；画布高度 = 宽度 / 目标比例。
    const maxWidth = Math.min(maxEdge, maxEdge * targetRatio, Math.sqrt(maxPixels * targetRatio))
    contentWidth = alignDown(Math.min(sourceWidth, maxWidth))
    contentHeight = alignDown(contentWidth / aspect)
  } else {
    // 源更窄：高度铺满；画布宽度 = 高度 × 目标比例。
    const maxHeight = Math.min(maxEdge, maxEdge / targetRatio, Math.sqrt(maxPixels / targetRatio))
    contentHeight = alignDown(Math.min(sourceHeight, maxHeight))
    contentWidth = alignDown(contentHeight * aspect)
  }
  if (contentWidth <= STEP || contentHeight <= STEP) return { ok: false, reason: 'too_small' }

  let width
  let height
  if (aspect > targetRatio) {
    height = contentHeight + alignNear(Math.max(0, alignNear(contentWidth / targetRatio) - contentHeight))
    width = contentWidth
  } else {
    width = contentWidth + alignNear(Math.max(0, alignNear(contentHeight * targetRatio) - contentWidth))
    height = contentHeight
  }

  // 对齐取整可能让画布顶出上限：逐步收回内容后重算。
  for (let guard = 0; guard < 120; guard += 1) {
    if (width <= maxEdge && height <= maxEdge && width * height <= maxPixels) break
    contentWidth = alignDown(contentWidth * 0.98)
    contentHeight = alignDown(contentHeight * 0.98)
    if (contentWidth <= STEP || contentHeight <= STEP) return { ok: false, reason: 'too_small' }
    if (aspect > targetRatio) {
      height = contentHeight + alignNear(Math.max(0, alignNear(contentWidth / targetRatio) - contentHeight))
      width = contentWidth
    } else {
      width = contentWidth + alignNear(Math.max(0, alignNear(contentHeight * targetRatio) - contentWidth))
      height = contentHeight
    }
  }
  if (width > maxEdge || height > maxEdge || width * height > maxPixels) return { ok: false, reason: 'bounds' }
  if (width < minEdge || height < minEdge) return { ok: false, reason: 'too_small' }

  const scale = aspect > targetRatio ? contentWidth / sourceWidth : contentHeight / sourceHeight
  return layoutOf(width, height, contentWidth, contentHeight, anchor, ratioId, scale)
}

/**
 * 扩图版面计算。
 *
 * @param {object} input
 * @param {number} input.sourceWidth 源图宽（画布像素，正整数）
 * @param {number} input.sourceHeight 源图高
 * @param {string} [input.ratioId] `source`（默认）或契约里的目标比例 id
 * @param {{x:number,y:number}} [input.anchor] 留白锚点，默认居中
 * @returns {{ ok: true, ratioId: string, width: number, height: number,
 *   content: {x:number,y:number,width:number,height:number},
 *   padding: {left:number,right:number,top:number,bottom:number},
 *   coverage: number, scale: number } | { ok: false, reason: string }}
 *
 * 失败原因：
 *  - `invalid_source`：源图宽高缺失 / 非正数；
 *  - `invalid_ratio`：比例 id 不在契约列表；
 *  - `no_padding`：目标比例与源图一致，扩不出新增区域；
 *  - `too_small`：画布短边不足 `OUTPAINT.minEdge`（源图太小 / 比例太极端）；
 *  - `bounds`：满足不了 `maxEdge` / `maxPixels` 上限。
 */
export function outpaintPlanOf(input) {
  const source = input && typeof input === 'object' ? input : {}
  const sourceWidth = positiveSize(source.sourceWidth)
  const sourceHeight = positiveSize(source.sourceHeight)
  if (!sourceWidth || !sourceHeight) return { ok: false, reason: 'invalid_source' }
  // 显式给了未知比例 id 视为调用方错误；空值才回落到「四边扩 20%」。
  const requested = typeof source.ratioId === 'string' ? source.ratioId.trim() : ''
  const ratioId = requested || OUTPAINT.expandId
  if (ratioId !== OUTPAINT.expandId && !OUTPAINT_RATIO_IDS.includes(ratioId)) {
    return { ok: false, reason: 'invalid_ratio' }
  }
  const anchor = outpaintAnchorOf(source.anchor)
  if (ratioId === OUTPAINT.expandId) return expandPlanOf(sourceWidth, sourceHeight, anchor)
  return ratioPlanOf(sourceWidth, sourceHeight, ratioId, anchor)
}

// ---- 新增区域填充：四边像素拉伸（edge clamp）------------------------------

/**
 * 版面 → 新增区域的 8 条拉伸条带（内容框坐标 / 画布坐标）。
 *
 * 纯黑填底会在新增区与内容区之间制造一条硬边界（VAE latent 边界跳变，可能被羽化混进
 * 过渡带）。这里按「取内容框内最近边缘像素」的等价实现把新增区切成 8 条：
 * 四角各 1 个内容像素、四边各 1px 边缘带，绘制时按 `sw/cw`、`sh/ch` 映射回源图像素。
 *
 * 条带互不重叠、并集恰好覆盖「画布 − 内容框」的全部像素；宽度或高度为 0 的条带跳过，
 * 没有新增区域（或 plan 非法）时返回空数组。
 *
 * @param {object} plan `outpaintPlanOf()` 的成功结果
 * @returns {Array<{ source: {x:number,y:number,width:number,height:number},
 *   target: {x:number,y:number,width:number,height:number} }>}
 */
export function outpaintEdgeStripsOf(plan) {
  const source = plan && typeof plan === 'object' && plan.ok === true ? plan : null
  if (!source) return []
  const width = Number(source.width)
  const height = Number(source.height)
  const content = source.content && typeof source.content === 'object' ? source.content : null
  if (!content || !(width > 0) || !(height > 0)) return []
  const contentWidth = Number(content.width)
  const contentHeight = Number(content.height)
  if (!(contentWidth > 0) || !(contentHeight > 0)) return []
  const left = Number(content.x)
  const top = Number(content.y)
  if (!Number.isFinite(left) || !Number.isFinite(top)) return []
  const right = width - contentWidth - left
  const bottom = height - contentHeight - top
  if (!(right >= 0) || !(bottom >= 0)) return []
  if (left <= 0 && right <= 0 && top <= 0 && bottom <= 0) return []

  const strips = []
  const push = (sx, sy, sw, sh, tx, ty, tw, th) => {
    if (!(tw > 0) || !(th > 0)) return
    strips.push({
      source: { x: sx, y: sy, width: sw, height: sh },
      target: { x: tx, y: ty, width: tw, height: th },
    })
  }
  // 四角：各取内容框的 1 个角像素。
  push(0, 0, 1, 1, 0, 0, left, top)
  push(contentWidth - 1, 0, 1, 1, left + contentWidth, 0, right, top)
  push(0, contentHeight - 1, 1, 1, 0, top + contentHeight, left, bottom)
  push(contentWidth - 1, contentHeight - 1, 1, 1, left + contentWidth, top + contentHeight, right, bottom)
  // 左右：取内容框整列边缘像素，横向拉伸到留白宽度。
  push(0, 0, 1, contentHeight, 0, top, left, contentHeight)
  push(contentWidth - 1, 0, 1, contentHeight, left + contentWidth, top, right, contentHeight)
  // 上下：取内容框整行边缘像素，纵向拉伸到留白高度。
  push(0, 0, contentWidth, 1, left, 0, contentWidth, top)
  push(0, contentHeight - 1, contentWidth, 1, left, top + contentHeight, contentWidth, bottom)
  return strips
}

// ---- 扩图内容框的归一化（Host / Client 同规则）-----------------------------

/** 内容框字段名与精度以契约为唯一来源（`OUTPAINT.content`）。 */
const CONTENT_FIELDS = Array.isArray(OUTPAINT.content && OUTPAINT.content.fields)
  ? OUTPAINT.content.fields
  : ['x', 'y', 'width', 'height']
const CONTENT_PRECISION = Number.isFinite(Number(OUTPAINT.content && OUTPAINT.content.precision))
  ? Math.max(0, Math.min(8, Math.floor(Number(OUTPAINT.content.precision))))
  : 4
/** 与 Host 一致的浮点容差：归一化值只允许 1e-3 量级的噪声越界。 */
const CONTENT_TOLERANCE = 1e-3

/** 非负整数；缺失 / 非法返回 null。 */
function nonNegativeInt(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number)
}

/** 四舍五入到契约精度（默认 4 位小数）。 */
function roundContent(value) {
  const factor = 10 ** CONTENT_PRECISION
  return Math.round(Number(value) * factor) / factor
}

/**
 * 扩图内容框归一化：`{ x, y, width, height }` 归一化到 0~1（相对画布左上角）。
 *
 * 规则与 Host 的校验一致：四个字段都是有限数、各自落在 0~1（负值容差 1e-3）、
 * `width * height > 0`、`x + width ≤ 1`、`y + height ≤ 1`。非法 / 缺失返回 null，
 * 合法时按契约精度（4 位小数）输出。供「对比原图」拉帘把底图放回它在扩图画布里的位置。
 *
 * @param {unknown} value 历史条目上的 `outpaintContent`（`/history` 透传）
 * @returns {{ x:number, y:number, width:number, height:number } | null}
 */
export function normalizeOutpaintContent(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!source) return null
  const raw = {}
  for (const field of CONTENT_FIELDS) {
    const number = source[field]
    if (typeof number !== 'number' || !Number.isFinite(number)) return null
    raw[field] = number
  }
  const { x, y, width, height } = raw
  if (width <= 0 || height <= 0) return null
  if (x < -CONTENT_TOLERANCE || y < -CONTENT_TOLERANCE) return null
  if (width > 1 + CONTENT_TOLERANCE || height > 1 + CONTENT_TOLERANCE) return null
  const left = Math.max(0, x)
  const top = Math.max(0, y)
  if (left + width > 1 + CONTENT_TOLERANCE) return null
  if (top + height > 1 + CONTENT_TOLERANCE) return null
  return {
    x: roundContent(Math.min(1, left)),
    y: roundContent(Math.min(1, top)),
    width: roundContent(Math.min(1, width)),
    height: roundContent(Math.min(1, height)),
  }
}

/**
 * 合成的扩图画布 → 归一化内容框（`reference.outpaintContent` 的值）。
 *
 * @param {{ width:number, height:number, content:{x:number,y:number,width:number,height:number} }} canvas
 * @returns {{ x:number, y:number, width:number, height:number } | null} 画布 / 内容框非法时 null
 */
export function buildOutpaintContentBody(canvas) {
  const source = canvas && typeof canvas === 'object' && !Array.isArray(canvas) ? canvas : null
  if (!source) return null
  const width = positiveSize(source.width)
  const height = positiveSize(source.height)
  const content = source.content && typeof source.content === 'object' ? source.content : null
  if (!width || !height || !content) return null
  const contentWidth = positiveSize(content.width)
  const contentHeight = positiveSize(content.height)
  const x = nonNegativeInt(content.x)
  const y = nonNegativeInt(content.y)
  if (contentWidth === null || contentHeight === null || x === null || y === null) return null
  if (x + contentWidth > width || y + contentHeight > height) return null
  return normalizeOutpaintContent({
    x: x / width,
    y: y / height,
    width: contentWidth / width,
    height: contentHeight / height,
  })
}
