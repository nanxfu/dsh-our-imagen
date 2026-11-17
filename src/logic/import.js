/**
 * 本地图片导入的纯逻辑（阶段十五 Phase A3）。
 *
 * 渲染层（`ImageDropzone`）只负责 FileReader / 拖放 / 粘贴这些浏览器动作；这里不碰 DOM，
 * 供组件与 `test/import-client.mjs` 共用：
 *  - 客户端预校验：MIME / 体积 / 魔数 / 最小长边，边界与宿主同一份 `IMPORT` 契约；
 *  - dataURL 归一：去空白、补齐 base64 填充、统一成宿主可读的 dataURL（宿主也接受裸 base64）；
 *  - 展示名清洗与拖入态判定。
 *
 * 宿主仍是最终裁判：这里只是把明显不合法的文件在本地挡掉，避免白跑一次上传。
 */

import { IMPORT } from '../../shared/contract.js'

const MIB = 1024 * 1024

/**
 * 魔数预检只解头部：PNG 的 IHDR 在固定偏移，JPEG 的 SOF 尺寸段通常紧跟几个 APPn 段，
 * 256 KiB 足够覆盖，又不至于为一张 8 MiB 的图做全量 base64 解码。
 */
const HEADER_BYTES = 256 * 1024

/** 补齐填充后的标准 base64（不含空白）。 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * 归一 MIME：兼容 `image/jpg` 与空 type（按扩展名兜底）。
 * 不在 `IMPORT.mimeTypes` 内返回空串，由调用方判定 `invalidType`。
 */
export function importMimeOf(file) {
  const record = file && typeof file === 'object' ? file : {}
  const rawType = String(record.type ?? '').trim().toLowerCase()
  const type = rawType === 'image/jpg' ? 'image/jpeg' : rawType
  if (IMPORT.mimeTypes.includes(type)) return type
  // 明确声明了不支持的 MIME 时直接拒绝，不再按扩展名翻案（文件名可随意改）。
  if (rawType) return ''
  // 有些环境（旧浏览器 / 从压缩包拖出）拿不到 type，只能看扩展名。
  const name = String(record.name ?? '').trim().toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  return ''
}

/** 体积上限（MiB），只用于 `studio.import.tooLarge` 的 `{size}` 占位。 */
export function importMaxMiB() {
  return Math.round(IMPORT.maxBytes / MIB)
}

/**
 * 文件级预校验：类型 → 体积。
 *
 * @returns {'' | 'studio.import.invalidType' | 'studio.import.tooLarge'} 空串表示通过
 */
export function importFileErrorOf(file) {
  if (!importMimeOf(file)) return 'studio.import.invalidType'
  const size = Number(file && file.size)
  // 拿不到 size 时交给宿主兜底（FileReader 之后仍会被体积校验一次）。
  if (Number.isFinite(size) && size > IMPORT.maxBytes) return 'studio.import.tooLarge'
  return ''
}

/**
 * 展示名：优先 `file.name`，去掉控制字符与路径分隔符后按契约截断。
 * 没有可用名字时返回空串，由 UI / 宿主兜底（纯逻辑里不做本地化）。
 */
export function importNameOf(file) {
  const raw = typeof (file && file.name) === 'string' ? file.name : ''
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, ' ')
    .trim()
  return cleaned.slice(0, IMPORT.maxNameChars)
}

/**
 * 拖入 / 粘贴是否接受：图片工具编辑态与批量选择态一律拒绝（不覆盖正在编辑的草稿）。
 *
 * `view` 为签名预留：当前 `ImageDropzone` 只在工作台创作页（studio 视图）挂载，
 * 相册视图没有舞台，不需要再做视图判定。
 *
 * @param {{ editorOpen?: boolean, view?: string, selecting?: boolean }} [state]
 * @returns {'stage' | 'blocked'}
 */
export function importDragOf(state) {
  const input = state && typeof state === 'object' ? state : {}
  if (input.editorOpen === true || input.selecting === true) return 'blocked'
  return 'stage'
}

/**
 * 归一 dataURL / 裸 base64。
 *
 * 浏览器 FileReader 产出的是 `data:image/png;base64,...`；宿主契约允许裸 base64，
 * 这里统一成 dataURL，后面的魔数预检再按实际字节纠正 MIME（FileReader 的 type 可能不准）。
 *
 * @param {unknown} value
 * @returns {{ ok: boolean, errorKey: string, mime: string, base64: string, dataUrl: string }}
 */
export function normalizeImportDataUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const failure = { ok: false, errorKey: 'studio.import.invalidType', mime: '', base64: '', dataUrl: '' }
  if (!text) return failure

  let mime = ''
  let payload = text
  if (/^data:/i.test(text)) {
    const comma = text.indexOf(',')
    if (comma < 0) return failure
    const meta = text.slice(0, comma)
    const parts = meta.split(';')
    mime = parts[0].replace(/^data:/i, '').trim().toLowerCase()
    mime = mime === 'image/jpg' ? 'image/jpeg' : mime
    // 只接受 base64 形式的 dataURL（非 base64 的 data: 文本不是图片导入的输入）。
    if (!parts.slice(1).some((part) => part.trim().toLowerCase() === 'base64')) return failure
    if (mime && !IMPORT.mimeTypes.includes(mime)) return failure
    payload = text.slice(comma + 1)
  }

  const compact = payload.replace(/\s+/g, '')
  if (!compact) return failure
  const unpadded = compact.replace(/=+$/, '')
  if (!BASE64_RE.test(compact)) return failure
  // base64 长度模 4 余 1 不可能解码（标准填充只允许余 0/2/3）。
  if (unpadded.length % 4 === 1) return failure
  const base64 = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4)

  return {
    ok: true,
    errorKey: '',
    mime,
    base64,
    // 裸 base64 没有 MIME，等魔数预检出真实格式后再拼。
    dataUrl: mime ? `data:${mime};base64,${base64}` : '',
  }
}

/** 解 base64 的前 `maxBytes` 字节；无 `atob` 或内容损坏返回 null。 */
function decodeBase64Prefix(base64, maxBytes) {
  const decoder = typeof atob === 'function' ? atob : null
  if (!decoder) return null
  const chars = Math.ceil(maxBytes / 3) * 4
  let head = String(base64 || '').slice(0, chars).replace(/=+$/, '')
  const rest = head.length % 4
  if (rest === 1) head = head.slice(0, -1)
  else if (rest === 2) head += '=='
  else if (rest === 3) head += '='
  try {
    const binary = decoder(head)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

/** 扫描 JPEG 段找 SOFn 的宽高；尺寸段在头部窗口之外时返回 0（交给宿主最终校验）。 */
function jpegSizeOf(bytes) {
  let index = 2
  while (index + 3 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1
      continue
    }
    let marker = bytes[index + 1]
    // 允许 0xFF 填充字节。
    while (marker === 0xff && index + 2 < bytes.length) {
      index += 1
      marker = bytes[index + 1]
    }
    // 无长度的标记：SOI / TEM / RSTn。
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2
      continue
    }
    // EOI / SOS：SOF 若还没出现就不会有了。
    if (marker === 0xd9 || marker === 0xda) return { width: 0, height: 0 }
    if (index + 4 > bytes.length) return { width: 0, height: 0 }
    const length = (bytes[index + 2] << 8) | bytes[index + 3]
    if (length < 2) return { width: 0, height: 0 }
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (index + 9 > bytes.length) return { width: 0, height: 0 }
      const height = (bytes[index + 5] << 8) | bytes[index + 6]
      const width = (bytes[index + 7] << 8) | bytes[index + 8]
      return { width, height }
    }
    index += 2 + length
  }
  return { width: 0, height: 0 }
}

/**
 * 魔数 + 尺寸预检：不解全图，只看头部字节。
 *
 * @param {string} base64 已归一的 base64
 * @returns {null | { format: 'png'|'jpeg', width: number, height: number }} 非 PNG/JPEG 返回 null；
 *   宽高解析不到时为 0（宿主仍会按真实尺寸校验）。
 */
export function imageHeaderOf(base64) {
  const bytes = decodeBase64Prefix(base64, HEADER_BYTES)
  if (!bytes || bytes.length < 4) return null
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    if (bytes.length < 24) return { format: 'png', width: 0, height: 0 }
    return { format: 'png', width: readUint32(bytes, 16), height: readUint32(bytes, 20) }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSizeOf(bytes)
    return { format: 'jpeg', width: size.width, height: size.height }
  }
  return null
}

/**
 * 导入结果是否带本插件的生成元数据。
 *
 * `/import` 的 `entry.generation` 是宿主解出的生成参数（PNG tEXt 命中时非空）；
 * 旧宿主可能只把生成参数挂在 `entry.item.generation`（历史条目形状）上，两者都认。
 * 命中时成功提示改用 `studio.import.metaFound`，否则用 `studio.import.done`。
 *
 * @param {object} [entry] `/import` 响应里的 entry
 * @returns {boolean}
 */
export function importMetaFoundOf(entry) {
  if (!entry || typeof entry !== 'object') return false
  if (entry.generation && typeof entry.generation === 'object') return true
  const item = entry.item
  return Boolean(item && typeof item === 'object' && item.generation && typeof item.generation === 'object')
}

function precheckFailure(errorKey, params) {
  return {
    ok: false,
    errorKey,
    params: params || null,
    mime: '',
    width: 0,
    height: 0,
    base64: '',
    dataUrl: '',
    name: '',
  }
}

function precheckParamsOf(errorKey) {
  if (errorKey === 'studio.import.tooLarge') return { size: importMaxMiB() }
  if (errorKey === 'studio.import.tooSmall') return { edge: IMPORT.minEdge }
  return null
}

/**
 * 导入前的完整客户端预检（文件级 → dataURL 归一 → 魔数 → 最小长边）。
 *
 * 通过时给出可直接提交给 `importImageFile()` 的 `dataUrl`（MIME 已按实际魔数纠正）
 * 与展示名；失败时 `errorKey` 是字典键，`params` 是 `formatText()` 的占位值。
 *
 * @param {{ file?: object, dataUrl?: string }} [input]
 */
export function importPrecheckOf(input) {
  const state = input && typeof input === 'object' ? input : {}
  const file = state.file && typeof state.file === 'object' ? state.file : null

  if (file) {
    const fileError = importFileErrorOf(file)
    if (fileError) return precheckFailure(fileError, precheckParamsOf(fileError))
  }

  const parsed = normalizeImportDataUrl(state.dataUrl)
  if (!parsed.ok) return precheckFailure(parsed.errorKey, null)

  const header = imageHeaderOf(parsed.base64)
  if (!header) return precheckFailure('studio.import.invalidType', null)

  const width = Math.max(0, Number(header.width) || 0)
  const height = Math.max(0, Number(header.height) || 0)
  // 宽高解析不到（0）时不拦：宿主会按真实尺寸判定，避免误杀合法的 JPEG 大图。
  if (width > 0 && height > 0 && (width < IMPORT.minEdge || height < IMPORT.minEdge)) {
    return precheckFailure('studio.import.tooSmall', precheckParamsOf('studio.import.tooSmall'))
  }

  const mime = `image/${header.format}`
  return {
    ok: true,
    errorKey: '',
    params: null,
    mime,
    width,
    height,
    base64: parsed.base64,
    dataUrl: `data:${mime};base64,${parsed.base64}`,
    name: importNameOf(file),
  }
}
