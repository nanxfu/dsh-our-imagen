/**
 * 出图请求的参数钳制与提交期校验。
 *
 * 本模块负责：把 `imagen_generate` 的入参按 `shared/contract.js` 的 LIMITS 归一化
 * （尺寸对齐步长、步数/CFG/张数钳制、seed 取模、重绘强度对齐），以及图生图 `reference`
 * 字段的格式/边界预检（路径形状、base64、体积、PNG/JPEG 魔数）。
 *
 * 从 `lib/jobs.js` 拆出：原先与队列状态机混在一个文件里，这里只保留纯函数，
 * 不读盘、不发请求，便于离线断言。
 */

import { LIMITS } from '../../shared/contract.js'
import { OUTPUT_DIR } from '../paths.js'

export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** 尺寸钳制：先钳到合法区间，再对齐到 LIMITS 约定的步长（8 的倍数）。 */
export function normalizeDimension(value, fallback, limits = LIMITS.width) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const { min, max, step } = limits
  const clamped = Math.min(max, Math.max(min, Math.round(number)))
  return Math.round(clamped / step) * step
}

// ---- 图生图（M3）参考图 ----------------------------------------------------

/** 参考图格式的字节级白名单：Host 只做魔数预检，完整解码与缩小在远端（PIL）。 */
export const REFERENCE_MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
}

export function hasMagic(buffer, magic) {
  return magic.every((byte, index) => buffer[index] === byte)
}

/**
 * 重绘强度归一：按契约边界钳制、按 step 对齐，保留两位小数（避免浮点尾巴）。
 * 非法输入回退 `LIMITS.strength.default`。
 */
export function normalizeStrength(value) {
  const number = Number(value)
  const { min, max, step, default: fallback } = LIMITS.strength
  const raw = Number.isFinite(number) ? number : fallback
  const clamped = Math.min(max, Math.max(min, raw))
  const aligned = min + Math.round((clamped - min) / step) * step
  return Math.round(Math.min(max, Math.max(min, aligned)) * 100) / 100
}

/** 去掉可选的 data URL 前缀后返回 base64 文本；格式不对返回 null。 */
export function referenceBase64Of(image) {
  if (typeof image !== 'string') return null
  const text = image.trim().replace(/^data:image\/(?:png|jpeg);base64,/i, '').replace(/\s+/g, '')
  if (!text || text.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  return text
}

/**
 * 归一化出图请求里的 `reference`（图生图参考图）。
 *
 * 支持两种来源（二选一）：
 *  - `path`：`imagen-output/` 内的作品路径（工作区相对路径，与 `/imagen-api/file` 同一口径）；
 *  - `image`：前端上传/缩放后的 base64（可带 `data:image/png;base64,` 前缀）。
 * 参考图体积按 `LIMITS.reference.maxBytes` 校验、只接受 PNG/JPEG；重绘强度按契约钳制。
 * 返回 `{ ok: true, value: null | { path, imageB64, strength } }`，非法时给 host 错误码。
 *
 * @param {unknown} request 请求里的 reference 字段
 */
export function normalizeReference(request) {
  if (request === undefined || request === null || request === '') return { ok: true, value: null }
  if (typeof request !== 'object' || Array.isArray(request)) {
    return { ok: false, code: 'invalid_request', message: 'reference 必须是对象' }
  }

  const strength = normalizeStrength(request.strength)
  const rawPath = typeof request.path === 'string' ? request.path.trim() : ''
  const rawImage = typeof request.image === 'string' ? request.image.trim() : ''
  if (rawPath && rawImage) {
    return { ok: false, code: 'invalid_request', message: 'reference 的 path 与 image 只能二选一' }
  }
  if (!rawPath && !rawImage) {
    return { ok: false, code: 'invalid_request', message: 'reference 需要 path（作品路径）或 image（base64）' }
  }

  if (rawPath) {
    if (rawPath.includes('\0')) return { ok: false, code: 'invalid_path', message: '参考图路径含有非法字符' }
    if (rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath) || rawPath.startsWith('\\\\')) {
      return { ok: false, code: 'invalid_path', message: '参考图必须是工作区相对路径' }
    }
    const segments = rawPath.split(/[\\/]+/).filter((part) => part !== '')
    if (segments.length < 2 || segments.some((part) => part === '..' || part === '.')) {
      return { ok: false, code: 'invalid_path', message: '参考图路径不在 imagen-output/ 内' }
    }
    if (segments[0] !== OUTPUT_DIR) {
      return { ok: false, code: 'invalid_path', message: `参考图只能引用 ${OUTPUT_DIR}/ 内的作品` }
    }
    return { ok: true, value: { path: segments.join('/'), imageB64: null, strength } }
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
  return { ok: true, value: { path: null, imageB64: base64, strength } }
}
