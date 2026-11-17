/**
 * 图片头部解析与 PNG tEXt 生成元数据读写（阶段十五 Phase A3）。
 *
 * 用途：
 *  - `POST /imagen-api/import` 校验阶段解析 PNG / JPEG 的宽高，并尝试读出本插件先前
 *    写进 PNG 的生成参数（胶片条点导入图时回填原生成参数）；
 *  - `lib/output.js saveJobOutput()` 出图落盘前把本批生成参数写进 PNG tEXt，用户把图
 *    拖回工作台即可回填（不依赖 meta.json，单张图片自带出处）。
 *
 * tEXt 的 text 字段按 PNG 规范是 Latin-1 文本，直接写 UTF-8 字节会被按 Latin-1 解码
 * 的第三方工具读成乱码。这里采用两端自洽的方案：JSON 先按 UTF-8 编码成字节，再把每个
 * 字节映射成 Latin-1 字符写入 tEXt；读取时反向还原成 UTF-8 再解析。JSON 里带 `app`
 * 标记，只接受本插件写入的元数据，不会把别人的 tEXt 误当成生成参数。
 */

import { LIMITS } from '../shared/contract.js'

/** PNG tEXt 里本插件生成元数据的 keyword（1~79 字节 Latin-1）。 */
export const META_KEYWORD = 'our-imagen'
/** 生成元数据 JSON 的 app 标记：读取时校验，拒绝来源不明的 tEXt。 */
export const META_APP = 'dsh-our-imagen'
/** 生成元数据 JSON 的版本号；结构不兼容时读取端直接判非法。 */
export const META_VERSION = 1

/** PNG 文件签名。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 单条生成元数据 JSON 的字节上限：提示词最长 2000 字符，正常远低于此。 */
const MAX_META_BYTES = 256 * 1024

/** 生成参数里宽高的合法上界（防御被手改的 meta 把异常数值带进表单）。 */
const MAX_GENERATION_EDGE = 100000

/** CRC32 查表（PNG 每个 chunk 都带 CRC32，自行实现避免额外依赖）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value >>> 0
  }
  return table
})()

/** 标准 CRC32（PNG chunk 用：对 chunk type + data 计算，初值与终值均异或 0xffffffff）。 */
function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

/** JPEG 的 SOF 标记：0xC0~0xCF 里排除 DHT(0xC4) / JPG(0xC8) / DAC(0xCC)。 */
function isSofMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * 解析 PNG / JPEG 头部，返回 `{ format: 'png'|'jpeg', width, height }`；无法识别返回 null。
 *
 * PNG 只读固定位置的 IHDR（规范要求它是第一个 chunk）；JPEG 顺序扫描段，直到遇到
 * SOF 段取宽高。只做头部解析，不校验 CRC / 不完整解码，适合在校验阶段快速拒绝坏图。
 *
 * @param {Buffer} buffer 图片字节
 * @returns {{ format: 'png'|'jpeg', width: number, height: number } | null}
 */
export function parseImageHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  try {
    if (isPng(buffer)) {
      if (buffer.length < 24) return null
      if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null
      if (buffer.readUInt32BE(8) < 13) return null
      const width = buffer.readUInt32BE(16)
      const height = buffer.readUInt32BE(20)
      if (!(width > 0 && height > 0)) return null
      return { format: 'png', width, height }
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return parseJpegHeader(buffer)
    return null
  } catch {
    return null
  }
}

/**
 * 顺序扫描 JPEG 段找 SOF（Start Of Frame）里的宽高。
 *
 * 段结构：`FF marker` + 2 字节长度（含长度字段自身）+ 负载；`FF` 填充字节与
 * RST/SOI/EOI 这类无长度段的标记单独跳过。截断或结构异常一律返回 null。
 */
function parseJpegHeader(buffer) {
  let offset = 2
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) return null
    let cursor = offset + 1
    // 段标记前允许出现任意个 0xFF 填充字节。
    while (cursor < buffer.length && buffer[cursor] === 0xff) cursor += 1
    if (cursor >= buffer.length) return null
    const marker = buffer[cursor]
    // 独立标记（TEM / RSTn / SOI / EOI）：没有长度字段，跳过。
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) return null
      offset = cursor + 1
      continue
    }
    if (cursor + 2 >= buffer.length) return null
    const length = buffer.readUInt16BE(cursor + 1)
    if (length < 2 || cursor + 1 + length > buffer.length) return null
    if (isSofMarker(marker)) {
      // 负载：精度(1) + 高(2) + 宽(2) + 分量数(1) + ...
      if (length < 8) return null
      const height = buffer.readUInt16BE(cursor + 4)
      const width = buffer.readUInt16BE(cursor + 6)
      if (!(width > 0 && height > 0)) return null
      return { format: 'jpeg', width, height }
    }
    offset = cursor + 1 + length
  }
  return null
}

/** 构造一个 tEXt chunk（length + 'tEXt' + keyword\0text + CRC32）。 */
function buildTextChunk(keywordBytes, textBytes) {
  const data = Buffer.concat([keywordBytes, Buffer.from([0]), textBytes])
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write('tEXt', 4, 'latin1')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}

/**
 * 在 PNG 的 IEND 之前插入一条 tEXt chunk，返回新 Buffer。
 *
 * 非 PNG、参数非法、找不到 IEND 或结构损坏时原样返回输入 buffer（写入元数据是增强能力，
 * 绝不能因为它失败而丢掉图片）。`text` 必须是 Latin-1 可表示的字符串（生成元数据由
 * `writeGenerationMeta` 负责 UTF-8 → Latin-1 的转换），且不能包含 NUL（tEXt 的分隔符）。
 *
 * @param {Buffer} buffer PNG 字节
 * @param {string} keyword tEXt 关键字（1~79 字节 Latin-1）
 * @param {string} text 文本内容（Latin-1）
 * @returns {Buffer} 原 buffer 或插入 tEXt 后的新 buffer
 */
export function writePngText(buffer, keyword, text) {
  try {
    if (!isPng(buffer)) return buffer
    if (typeof keyword !== 'string' || typeof text !== 'string') return buffer
    const keywordBytes = Buffer.from(keyword, 'latin1')
    if (keywordBytes.length < 1 || keywordBytes.length > 79) return buffer
    if (keywordBytes.includes(0)) return buffer
    // 任何超出 Latin-1 的字符都会在编码时被静默截断，直接放弃写入。
    if (/[^\u0000-\u00ff]/.test(keyword)) return buffer
    if (/[^\u0000-\u00ff]/.test(text) || text.includes('\u0000')) return buffer
    const textBytes = Buffer.from(text, 'latin1')

    let offset = 8
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset)
      if (length > 0x7fffffff) return buffer
      const end = offset + 8 + length + 4
      if (end > buffer.length) return buffer
      if (buffer.toString('latin1', offset + 4, offset + 8) === 'IEND') {
        return Buffer.concat([buffer.subarray(0, offset), buildTextChunk(keywordBytes, textBytes), buffer.subarray(offset)])
      }
      offset = end
    }
    return buffer
  } catch {
    return buffer
  }
}

/**
 * 读取 PNG 里全部 tEXt 文本，返回 `{ [keyword]: text }`。
 *
 * 容错策略：非 PNG 返回空对象；chunk 长度越界或 CRC 不匹配时跳过该 chunk，后续结构
 * 已不可信则返回已读到的部分（绝不抛错）。text 按 Latin-1 原样返回，UTF-8 还原由
 * `readGenerationMeta` 负责。
 *
 * @param {Buffer} buffer PNG 字节
 * @returns {Record<string, string>}
 */
export function readPngTexts(buffer) {
  const texts = {}
  if (!isPng(buffer)) return texts
  try {
    let offset = 8
    let guard = 0
    while (offset + 8 <= buffer.length) {
      guard += 1
      if (guard > 100000) return texts
      const length = buffer.readUInt32BE(offset)
      if (length > 0x7fffffff) return texts
      const dataEnd = offset + 8 + length
      const end = dataEnd + 4
      if (end > buffer.length) return texts
      const type = buffer.toString('latin1', offset + 4, offset + 8)
      if (type === 'tEXt') {
        const storedCrc = buffer.readUInt32BE(dataEnd)
        if (crc32(buffer.subarray(offset + 4, dataEnd)) === storedCrc) {
          const data = buffer.subarray(offset + 8, dataEnd)
          const separator = data.indexOf(0)
          if (separator > 0) {
            const keyword = data.toString('latin1', 0, separator)
            texts[keyword] = data.toString('latin1', separator + 1)
          }
        }
      }
      if (type === 'IEND') break
      offset = end
    }
    return texts
  } catch {
    return texts
  }
}

/** 数值边界校验：整数且在 [min, max] 内才返回，否则 null。 */
function boundedInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

/** 数值边界校验：有限数字且在 [min, max] 内才返回，否则 null。 */
function boundedNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

/**
 * 归一化生成元数据 JSON：校验 app / 版本 / 宽高边界，把可选数值字段收敛到合法值。
 *
 * 返回对象字段固定（缺失的可选字段为 null），导入路由可以无脑回填 params。
 * app 不符、版本不兼容、宽高缺失或越界时返回 null（整体判非法）。
 */
function normalizeGenerationMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.app !== META_APP || value.version !== META_VERSION) return null
  const width = boundedInt(value.width, 1, MAX_GENERATION_EDGE)
  const height = boundedInt(value.height, 1, MAX_GENERATION_EDGE)
  if (width === null || height === null) return null
  return {
    app: META_APP,
    version: META_VERSION,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt : '',
    presetId: typeof value.presetId === 'string' && value.presetId.trim() ? value.presetId.trim() : null,
    width,
    height,
    steps: boundedInt(value.steps, 1, 1000),
    cfg: boundedNumber(value.cfg, 0, 100),
    seed: boundedInt(value.seed, 0, LIMITS.seed.max),
    jobId: typeof value.jobId === 'string' && value.jobId ? value.jobId : null,
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : null,
  }
}

/**
 * 把生成参数写入 PNG 的 tEXt（keyword `our-imagen`），返回新 Buffer。
 *
 * JSON 先 `JSON.stringify`，再按 UTF-8 → Latin-1 的字节映射写进 tEXt；`app` / `version`
 * 由本函数统一盖章，调用方只传业务字段。任何失败（非 PNG、序列化异常、超限）都返回
 * 原始 buffer，调用方可以直接落盘。
 *
 * @param {Buffer} buffer PNG 字节
 * @param {object} meta 生成参数（prompt / negativePrompt / presetId / width / height /
 *   steps / cfg / seed / jobId / createdAt）
 * @returns {Buffer}
 */
export function writeGenerationMeta(buffer, meta) {
  try {
    if (!isPng(buffer)) return buffer
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return buffer
    const value = { ...meta, app: META_APP, version: META_VERSION }
    const json = JSON.stringify(value)
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_META_BYTES) return buffer
    return writePngText(buffer, META_KEYWORD, Buffer.from(json, 'utf8').toString('latin1'))
  } catch {
    return buffer
  }
}

/**
 * 读取 PNG 里的生成元数据；非 PNG、没有本插件的 tEXt、JSON 损坏或边界非法都返回 null。
 *
 * @param {Buffer} buffer 图片字节
 * @returns {object | null} 归一化后的生成参数（字段固定，见 `normalizeGenerationMeta`）
 */
export function readGenerationMeta(buffer) {
  try {
    const text = readPngTexts(buffer)[META_KEYWORD]
    if (typeof text !== 'string') return null
    const json = Buffer.from(text, 'latin1').toString('utf8')
    return normalizeGenerationMeta(JSON.parse(json))
  } catch {
    return null
  }
}
