/**
 * 出图请求的参数钳制与提交期校验。
 *
 * 本模块负责：把 `imagen_generate` 的入参按 `shared/contract.js` 的 LIMITS 归一化
 * （尺寸对齐步长、步数/CFG/张数钳制、seed 取模、重绘强度对齐），以及图生图 `reference`
 * 字段的格式/边界预检（路径形状、base64、体积、PNG/JPEG 魔数）。
 *
 * 从 `lib/jobs.js` 拆出：原先与队列状态机混在一个文件里，这里只保留纯函数，
 * 不读盘、不发请求，便于离线断言。
 *
 * 阶段十五 Phase B 增加 `tool` 归一（generate / upscale / outpaint）与高清放大的
 * 专项预检：放大只接受一张源图（path 或 image 二选一）、不接受蒙版，宽高按
 * `UPSCALE.maxInputEdge` 护栏；扩图（outpaint）在 Host 侧就是带来源溯源的普通局部重绘。
 *
 * 阶段十五 Phase C1 增加 `references`（模型原生参考图列表）的入口校验：1~N 个
 * `imagen-output/` 内作品路径、与 `reference` 单图垫图互斥；读盘与体积/魔数校验在执行阶段
 * 由 `reference-loader.js` 完成。
 */

import { LIMITS, OUTPAINT, REQUEST_TOOLS, UPSCALE } from '../../shared/contract.js'
import { clampInt, clampNumber } from '../../shared/validation.js'
import { OUTPUT_DIR } from '../paths.js'

export { clampInt, clampNumber }

/** 尺寸钳制：先钳到合法区间，再对齐到 LIMITS 约定的步长（8 的倍数）。 */
export function normalizeDimension(value, fallback, limits = LIMITS.width) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const { min, max, step } = limits
  const clamped = Math.min(max, Math.max(min, Math.round(number)))
  return Math.round(clamped / step) * step
}

// ---- 请求 tool -------------------------------------------------------------
//
// 阶段十五 Phase B 起一个 `POST /imagen-api/generate` 承载三类请求（契约 REQUEST_TOOLS）：
//  - generate：文生图 / 图生图 / 局部重绘（与旧客户端逐字一致）；
//  - upscale：高清放大，只发一张源图，远端走独立超分分支；
//  - outpaint：扩图，Host 侧展开成「带 sourcePath 的普通局部重绘」。
// 缺省是 generate：没有 tool 字段的旧客户端行为不变。

/**
 * 归一请求的 `tool`：缺省 `generate`，只接受契约 `REQUEST_TOOLS` 内的取值。
 *
 * @param {unknown} value 请求里的 tool 字段
 * @returns {{ ok: true, tool: string } | { ok: false, code: 'invalid_request', message: string }}
 */
export function normalizeTool(value) {
  if (value === undefined || value === null || value === '') return { ok: true, tool: 'generate' }
  if (typeof value !== 'string') {
    return { ok: false, code: 'invalid_request', message: 'tool 必须是字符串' }
  }
  const tool = value.trim()
  if (tool === '') return { ok: true, tool: 'generate' }
  if (!REQUEST_TOOLS.includes(tool)) {
    return {
      ok: false,
      code: 'invalid_request',
      message: `tool 只支持 ${REQUEST_TOOLS.join(' / ')}，收到 ${tool}`,
    }
  }
  return { ok: true, tool }
}

// ---- 图生图（M3）/ 局部重绘（Inpaint）参考图 --------------------------------

/** 参考图格式的字节级白名单：Host 只做魔数预检，完整解码与缩小在远端（PIL）。 */
export const REFERENCE_MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
}

/** 局部重绘蒙版只接受 PNG：有损格式会在重绘边界上造出灰边。 */
const MASK_MAGIC = REFERENCE_MAGIC.png

export function hasMagic(buffer, magic) {
  return magic.every((byte, index) => buffer[index] === byte)
}

/**
 * 重绘强度归一：按契约边界钳制、按 step 对齐，保留两位小数（避免浮点尾巴）。
 * 非法输入回退 `LIMITS.strength.default`。
 *
 * `ceiling` 是场景上限：带蒙版的局部重绘传 `LIMITS.strength.inpaintMax`（9 通道模型在
 * 全重绘时需要更高替换力度），普通垫图保持 `LIMITS.strength.max`。上限只允许在
 * `[max, inpaintMax]` 之间取值：调用方传错时不会把 img2img 的保守上限一并放宽。
 */
export function normalizeStrength(value, ceiling = LIMITS.strength.max) {
  const number = Number(value)
  const { min, max, step, default: fallback } = LIMITS.strength
  const hardMax = Math.max(max, Number(LIMITS.strength.inpaintMax) || max)
  const requested = Number(ceiling)
  const upper = Math.min(hardMax, Math.max(max, Number.isFinite(requested) ? requested : max))
  const raw = Number.isFinite(number) ? number : fallback
  const clamped = Math.min(upper, Math.max(min, raw))
  const aligned = min + Math.round((clamped - min) / step) * step
  return Math.round(Math.min(upper, Math.max(min, aligned)) * 100) / 100
}

/** 去掉可选的 data URL 前缀后返回 base64 文本；格式不对返回 null。 */
function referenceBase64Of(image) {
  if (typeof image !== 'string') return null
  const text = image.trim().replace(/^data:image\/(?:png|jpeg);base64,/i, '').replace(/\s+/g, '')
  if (!text || text.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  return text
}

/**
 * 归一蒙版 base64：只接受 PNG 容器，可带 `data:image/png;base64,` 前缀；格式不对返回 null。
 *
 * 与参考图不同，蒙版不接受 JPEG / WEBP 之类的有损容器：客户端导出的是黑白二值 PNG，
 * 有损压缩会让边界像素变成灰度、重绘区域被削弱或溢出。
 */
function maskBase64Of(mask) {
  if (typeof mask !== 'string') return null
  const trimmed = mask.trim().replace(/^data:image\/png;base64,/i, '')
  // 其它 data URL 前缀（jpeg/webp/…）直接判非法，而不是把前缀当正文一起丢掉。
  if (/^data:/i.test(trimmed)) return null
  const text = trimmed.replace(/\s+/g, '')
  if (!text || text.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  return text
}

/**
 * 归一「`imagen-output/` 内的作品路径」：参考图 path、上传来源的 sourcePath、高清放大源图共用同一口径。
 *
 * 只做词法校验（不读盘）：绝对路径、Windows 盘符、`..` / `.` 段与非 `imagen-output/` 前缀一律拒绝；
 * 文件是否存在与软链接逃逸留给执行阶段的 `resolveOutputPath` 兜底（路径来源的参考图允许先入队、
 * 执行时文件被删则任务以 invalid_path 失败，与既有的异步失败语义一致）。
 *
 * @param {string} raw 已确认是字符串的路径文本
 * @param {string} label 错误文案里的主体（参考图 / 来源图 / 源图）
 * @returns {{ ok: true, path: string } | { ok: false, code: 'invalid_path', message: string }}
 */
function normalizeOutputImagePath(raw, label = '参考图') {
  if (raw.includes('\0')) {
    return { ok: false, code: 'invalid_path', message: `${label}路径含有非法字符` }
  }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('\\\\')) {
    return { ok: false, code: 'invalid_path', message: `${label}必须是工作区相对路径` }
  }
  const segments = raw.split(/[\\/]+/).filter((part) => part !== '')
  if (segments.length < 2 || segments.some((part) => part === '..' || part === '.')) {
    return { ok: false, code: 'invalid_path', message: `${label}路径不在 ${OUTPUT_DIR}/ 内` }
  }
  if (segments[0] !== OUTPUT_DIR) {
    return { ok: false, code: 'invalid_path', message: `${label}只能引用 ${OUTPUT_DIR}/ 内的作品` }
  }
  return { ok: true, path: segments.join('/') }
}

// ---- 扩图内容框（Phase B 补修 C）----------------------------------------
//
// 扩图产物是「更大的画布 + 原图放在其中」：对比原图时要把原图按 `outpaintContent`
// （相对画布的归一化矩形）放回真实位置，否则拉帘会整幅铺满、位置与比例错位。
// 该字段只属于 Host/Client（契约 OUTPAINT.content），不下发远端；这里负责请求期校验、
// 落盘前归一，读取历史时再归一一次防 meta 被手改。

/** 内容框的归一化精度（契约 OUTPAINT.content.precision，默认 4 位小数）。 */
const OUTPAINT_CONTENT_PRECISION = (() => {
  const value = Number(OUTPAINT.content?.precision)
  if (!Number.isFinite(value) || value < 0) return 4
  return Math.min(6, Math.round(value))
})()

/** 内容框字段名（契约 OUTPAINT.content.fields，顺序固定为 x/y/width/height）。 */
const OUTPAINT_CONTENT_FIELDS = Array.isArray(OUTPAINT.content?.fields)
  ? OUTPAINT.content.fields
  : ['x', 'y', 'width', 'height']

/**
 * 与 1 比较时的浮点容差：客户端用除法算 `content.x / canvas.width`，
 * 合法内容框的 x+width 可能因浮点误差略大于 1，不应因此 400。
 */
const OUTPAINT_CONTENT_TOLERANCE = 1e-3

/** 按契约精度取整（先钳到 [0,1]，避免浮点尾巴落进公开视图）。 */
function roundToContentPrecision(value) {
  const factor = 10 ** OUTPAINT_CONTENT_PRECISION
  return Math.round(Math.min(1, Math.max(0, value)) * factor) / factor
}

/**
 * 归一化扩图内容框 `outpaintContent`（0~1、相对画布左上角，4 位小数）。
 *
 * 校验规则（FIXES-INTERFACES §C2）：四个字段都是有限数字、各自 0~1、`x+width ≤ 1`、
 * `y+height ≤ 1`、面积 > 0；与边界的浮点容差 1e-3。取整后若和超过 1（四舍五入导致），
 * 以左/上边为准把宽/高收回来，保证返回对象自身始终满足「不越出画布且面积 > 0」。
 *
 * @param {unknown} value reference.outpaintContent
 * @returns {{ ok: true, value: null | { x: number, y: number, width: number, height: number } }
 *   | { ok: false, code: 'invalid_request', message: string }} 缺失返回 null
 */
export function normalizeOutpaintContent(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_request', message: 'outpaintContent 必须是对象' }
  }

  const numbers = {}
  for (const field of OUTPAINT_CONTENT_FIELDS) {
    const raw = value[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return {
        ok: false,
        code: 'invalid_request',
        message: `outpaintContent.${field} 必须是有限数字`,
      }
    }
    if (raw < 0 - OUTPAINT_CONTENT_TOLERANCE || raw > 1 + OUTPAINT_CONTENT_TOLERANCE) {
      return {
        ok: false,
        code: 'invalid_request',
        message: `outpaintContent.${field} 必须在 0~1 之间（收到 ${raw}）`,
      }
    }
    numbers[field] = raw
  }

  const { x, y, width, height } = numbers
  if (x + width > 1 + OUTPAINT_CONTENT_TOLERANCE) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'outpaintContent 的内容框超出画布：x + width 不能大于 1',
    }
  }
  if (y + height > 1 + OUTPAINT_CONTENT_TOLERANCE) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'outpaintContent 的内容框超出画布：y + height 不能大于 1',
    }
  }
  if (!(width * height > 0)) {
    return { ok: false, code: 'invalid_request', message: 'outpaintContent 的面积必须大于 0' }
  }

  const step = 10 ** -OUTPAINT_CONTENT_PRECISION
  const normalizedX = roundToContentPrecision(x)
  const normalizedY = roundToContentPrecision(y)
  // 极小但合法的宽高不能被精度取整抹成 0（否则归一后面积变 0）：至少保留一个精度步长。
  let normalizedWidth = Math.max(step, roundToContentPrecision(width))
  let normalizedHeight = Math.max(step, roundToContentPrecision(height))
  // 取整可能把 x+width 抬高一点点：以左/上边固定，把宽/高收回到剩下空间；
  // 极端情况下（起点被取整到 1）保留一个精度步长，保证返回对象仍有面积。
  if (normalizedX + normalizedWidth > 1) {
    const room = roundToContentPrecision(1 - normalizedX)
    normalizedWidth = room >= step ? room : step
  }
  if (normalizedY + normalizedHeight > 1) {
    const room = roundToContentPrecision(1 - normalizedY)
    normalizedHeight = room >= step ? room : step
  }
  const finalX = normalizedX + normalizedWidth > 1 ? roundToContentPrecision(1 - normalizedWidth) : normalizedX
  const finalY = normalizedY + normalizedHeight > 1 ? roundToContentPrecision(1 - normalizedHeight) : normalizedY
  return {
    ok: true,
    value: {
      x: finalX,
      y: finalY,
      width: normalizedWidth,
      height: normalizedHeight,
    },
  }
}

/**
 * 归一化出图请求里的 `reference`（图生图参考图 + 可选局部重绘蒙版）。
 *
 * 支持两种来源（二选一）：
 *  - `path`：`imagen-output/` 内的作品路径（工作区相对路径，与 `/imagen-api/file` 同一口径）；
 *  - `image`：前端上传/缩放后的 base64（可带 `data:image/png;base64,` 前缀）。
 * 参考图体积按 `LIMITS.reference.maxBytes` 校验、只接受 PNG/JPEG；重绘强度按契约钳制，
 * 带蒙版时上限放宽到 `LIMITS.strength.inpaintMax`、否则保持 `LIMITS.strength.max`。
 * 可选 `mask`（PNG base64，白 = 重绘区域、黑 = 保留区域）与参考图一起提交：
 * 体积按 `LIMITS.mask.maxBytes` 校验、只接受 PNG，**没有参考图时带蒙版直接拒绝**。
 * Host 只做字节级预检（base64 / 魔数 / 体积），完整解码与尺寸对齐在远端 Pillow 做一次。
 *
 * 扩图（阶段十五 Phase B）的参考图是前端合成的画布，`image` 来源可再带两个可选字段：
 *  - `sourcePath`（被扩的原始作品路径，规则与 `path` 完全一致），用于版本树溯源；
 *  - `outpaintContent`（原图在画布里的内容框，归一化 0~1），供「对比原图」拉帘对齐。
 * 返回值统一带 `sourcePath`（`path` 来源时就是它自己）与 `outpaintContent`（没有则 null），
 * 调用方不需要再按来源分支。`path` 来源携带 `outpaintContent` 直接拒绝：内容框只属于
 * 前端画布来源，路径来源没有画布坐标系。
 *
 * 返回 `{ ok: true, value: null | { path, imageB64, maskB64, strength, sourcePath, outpaintContent } }`，
 * 非法时给 host 错误码。
 *
 * @param {unknown} request 请求里的 reference 字段
 */
export function normalizeReference(request) {
  if (request === undefined || request === null || request === '') return { ok: true, value: null }
  if (typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, code: 'invalid_request', message: 'reference 必须是对象' }
  }

  const rawPath = typeof request.path === 'string' ? request.path.trim() : ''
  const rawImage = typeof request.image === 'string' ? request.image.trim() : ''
  // sourcePath 只在 image 来源下有独立语义（path 来源的 sourcePath 就是 path 自己）。
  const hasSourcePath =
    request.sourcePath !== undefined && request.sourcePath !== null && request.sourcePath !== ''
  // 扩图内容框同理：只有前端画布来源（image）有画布坐标系。
  const hasOutpaintContent =
    request.outpaintContent !== undefined && request.outpaintContent !== null && request.outpaintContent !== ''
  const hasMask = request.mask !== undefined && request.mask !== null && request.mask !== ''
  // 强度上限按场景选择：带蒙版走 inpaintMax，其余（含纯 img2img）保持契约 max。
  const strength = normalizeStrength(
    request.strength,
    hasMask ? LIMITS.strength.inpaintMax : LIMITS.strength.max,
  )
  if (rawPath && rawImage) {
    return { ok: false, code: 'invalid_request', message: 'reference 的 path 与 image 只能二选一' }
  }
  // 扩图内容框只属于前端画布来源（image）：path 来源没有画布坐标系，携带即拒绝，
  // 避免客户端把「对画布的描述」错挂到对不上号的路径来源上、产生错位的对比拉帘。
  if (rawPath && hasOutpaintContent) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'path 来源不支持 outpaintContent（扩图内容框只属于 image 画布来源）',
    }
  }
  // 蒙版是参考图的可选字段，脱离参考图没有意义：先给出这条专用文案，再走通用缺参分支。
  if (!rawPath && !rawImage && hasMask) {
    return {
      ok: false,
      code: 'invalid_request',
      message: '带蒙版时必须同时提供参考图（path 或 image）',
    }
  }
  if (!rawPath && !rawImage) {
    return { ok: false, code: 'invalid_request', message: 'reference 需要 path（作品路径）或 image（base64）' }
  }

  let maskB64 = null
  if (hasMask) {
    if (typeof request.mask !== 'string') {
      return { ok: false, code: 'invalid_request', message: '蒙版必须是 base64 字符串' }
    }
    maskB64 = maskBase64Of(request.mask)
    if (!maskB64) {
      return {
        ok: false,
        code: 'invalid_request',
        message: '蒙版不是合法的 base64 PNG（可带 data:image/png;base64, 前缀）',
      }
    }
    const maskBuffer = Buffer.from(maskB64, 'base64')
    if (maskBuffer.length === 0) {
      return { ok: false, code: 'invalid_request', message: '蒙版为空' }
    }
    if (maskBuffer.length > LIMITS.mask.maxBytes) {
      const limitMb = Math.round((LIMITS.mask.maxBytes / 1024 / 1024) * 10) / 10
      return { ok: false, code: 'invalid_request', message: `蒙版超过 ${limitMb} MB 上限` }
    }
    if (!hasMagic(maskBuffer, MASK_MAGIC)) {
      return { ok: false, code: 'invalid_request', message: '蒙版只支持 PNG' }
    }
  }

  if (rawPath) {
    const checked = normalizeOutputImagePath(rawPath, '参考图')
    if (!checked.ok) return checked
    // path 来源的 sourcePath 就是 path 本身：调用方（版本链落盘）不需要再区分来源。
    return {
      ok: true,
      value: {
        path: checked.path,
        imageB64: null,
        maskB64,
        strength,
        sourcePath: checked.path,
        outpaintContent: null,
      },
    }
  }

  const base64 = referenceBase64Of(rawImage)
  if (!base64) return { ok: false, code: 'invalid_request', message: '参考图不是合法的 base64 图片' }
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) return { ok: false, code: 'invalid_request', message: '参考图为空' }
  if (buffer.length > LIMITS.reference.maxBytes) {
    const limitMb = Math.round((LIMITS.reference.maxBytes / 1024 / 1024) * 10) / 10
    return { ok: false, code: 'invalid_request', message: `参考图超过 ${limitMb} MB 上限` }
  }
  if (!hasMagic(buffer, REFERENCE_MAGIC.png) && !hasMagic(buffer, REFERENCE_MAGIC.jpeg)) {
    return { ok: false, code: 'invalid_request', message: '参考图只支持 PNG / JPEG' }
  }

  // 上传来源的可选来源图路径（扩图用）：形状校验与 path 完全一致，非法直接拒绝。
  let sourcePath = null
  if (hasSourcePath) {
    if (typeof request.sourcePath !== 'string') {
      return { ok: false, code: 'invalid_request', message: 'sourcePath 必须是工作区相对路径字符串' }
    }
    const checked = normalizeOutputImagePath(request.sourcePath.trim(), '来源图')
    if (!checked.ok) return checked
    sourcePath = checked.path
  }
  // 上传来源的可选扩图内容框（原图在画布里的位置）：归一化后随 params/meta/history 透传。
  const contentResult = normalizeOutpaintContent(request.outpaintContent)
  if (!contentResult.ok) return contentResult
  return {
    ok: true,
    value: {
      path: null,
      imageB64: base64,
      maskB64,
      strength,
      sourcePath,
      outpaintContent: contentResult.value,
    },
  }
}

// ---- 模型原生参考生图（supportsReference，阶段十五 Phase C1）----------------
//
// 与上面的 `reference`（单图垫图重绘 / 局部重绘）是两条互斥的请求形状：
//  - `reference`：一张图，走 AutoPipelineForImage2Image / Inpainting，吃 strength、出图尺寸跟随参考图；
//  - `references`：1~N 张工作区作品路径，走模型原生 `image=[PIL...]` 条件，宽高取请求值、没有 strength。
// Host 只校验「数量 + 路径形状」，读盘 / 体积 / 魔数校验在执行阶段（见 reference-loader.js），
// 避免入队前同步读盘。

/** 原生参考图的张数上限（契约唯一来源）。 */
const REFERENCE_IMAGES_LIMITS = LIMITS.referenceImages

/**
 * 归一化出图请求里的 `references`（模型原生参考生图的图片列表）。
 *
 * 每一项必须是 `imagen-output/` 内作品的工作区相对路径（与 `reference.path` 完全同一口径），
 * 1~`LIMITS.referenceImages.maxCount` 张；空数组视为缺省（不要求参考图时省略字段）。
 * 重复路径直接拒绝：同一张图作为多路参考没有额外信息，只浪费请求体带宽。
 *
 * @param {unknown} request 请求里的 references 字段
 * @returns {{ ok: true, value: null | string[] } | { ok: false, code: string, message: string }}
 */
export function normalizeReferences(request) {
  if (request === undefined || request === null || request === '') return { ok: true, value: null }
  if (!Array.isArray(request)) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'references 必须是数组（每一项是 imagen-output/ 内的作品路径）',
    }
  }
  if (request.length === 0) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'references 不能为空数组（不需要参考图时请省略该字段）',
    }
  }
  const maxCount = Number(REFERENCE_IMAGES_LIMITS?.maxCount) || 0
  if (maxCount > 0 && request.length > maxCount) {
    return {
      ok: false,
      code: 'invalid_request',
      message: `最多 ${maxCount} 张参考图（收到 ${request.length} 张）`,
    }
  }
  const paths = []
  const seen = new Set()
  for (const [index, raw] of request.entries()) {
    if (typeof raw !== 'string') {
      return {
        ok: false,
        code: 'invalid_request',
        message: `references[${index}] 必须是工作区相对路径字符串`,
      }
    }
    const checked = normalizeOutputImagePath(raw.trim(), `参考图 ${index + 1}`)
    if (!checked.ok) return checked
    if (seen.has(checked.path)) {
      return {
        ok: false,
        code: 'invalid_request',
        message: `references 存在重复路径（${checked.path}）`,
      }
    }
    seen.add(checked.path)
    paths.push(checked.path)
  }
  return { ok: true, value: paths }
}

// ---- 高清放大（Phase B1）-----------------------------------------------

/** 提取一个正整数边长；缺失 / 非法返回 null（由远端在执行阶段按同一上限兜底）。 */
function positiveEdgeOf(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number)
}

/**
 * 高清放大的源图尺寸预检（纯函数）。
 *
 * 客户端从历史条目带来源图宽高；Host 只校验「长边 ≤ `UPSCALE.maxInputEdge`」，不做静默
 * 缩小（缩小再放大没有意义，超限应让用户先换画幅）。宽高缺失时不拦：远端解码源图后
 * 会按同一上限再校验一次。
 *
 * @returns {{ ok: true, width: number|null, height: number|null }
 *   | { ok: false, code: 'invalid_request', message: string }}
 */
export function normalizeUpscaleExtent(width, height) {
  const w = positiveEdgeOf(width)
  const h = positiveEdgeOf(height)
  const longEdge = Math.max(w ?? 0, h ?? 0)
  if (longEdge > UPSCALE.maxInputEdge) {
    return {
      ok: false,
      code: 'invalid_request',
      message:
        `源图长边 ${longEdge}px 超过高清放大上限 ${UPSCALE.maxInputEdge}px` +
        `（收到 ${w ?? '?'}×${h ?? '?'}），请先换到更小的画幅`,
    }
  }
  return { ok: true, width: w, height: h }
}

/**
 * 高清放大请求的专项校验（纯函数）。
 *
 * 与图生图 / 局部重绘的差异：只接受一张源图（path 或 image 二选一），**不接受蒙版**，
 * 不参与 strength / seed / steps 语义；宽高走 `normalizeUpscaleExtent`。
 * 返回的 reference 形状与 `normalizeReference` 一致（含统一后的 `sourcePath`），
 * 便于落盘时记录版本链。
 *
 * @param {{ reference?: unknown, width?: unknown, height?: unknown }} request 出图请求体
 * @returns {{ ok: true, reference: object, width: number|null, height: number|null }
 *   | { ok: false, code: string, message: string }}
 */
export function normalizeUpscaleRequest(request) {
  const rawReference = request?.reference
  if (rawReference && typeof rawReference === 'object' && !Array.isArray(rawReference)) {
    const hasMask = rawReference.mask !== undefined && rawReference.mask !== null && rawReference.mask !== ''
    if (hasMask) {
      return { ok: false, code: 'invalid_request', message: '高清放大只接受一张源图，不支持蒙版' }
    }
  }
  const referenceResult = normalizeReference(rawReference)
  if (!referenceResult.ok) return referenceResult
  const reference = referenceResult.value
  if (!reference) {
    return {
      ok: false,
      code: 'invalid_request',
      message: '高清放大需要源图：reference 的 path 或 image 二选一',
    }
  }
  const extent = normalizeUpscaleExtent(request?.width, request?.height)
  if (!extent.ok) return extent
  return { ok: true, reference, width: extent.width, height: extent.height }
}
