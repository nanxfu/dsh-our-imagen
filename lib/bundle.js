/**
 * 源码包归档：把 remote/ 目录打成确定性 ZIP，供 lib/kernel.js 内嵌到 Kaggle 启动器里。
 *
 * 为什么自己写 ZIP：Kaggle 的 kernel-metadata.json 只接受单个 `code_file`，而远端源码是
 * 一个标准 Python 包。仓库不引入第三方依赖（esbuild / gsap 之外一律不加），Node 又没有
 * 内置 zip 容器写入能力，所以这里用 node:zlib 的 deflateRaw + 手写头部实现最小 ZIP。
 *
 * 约束与取舍：
 * - **确定性**：文件按路径排序、时间戳固定为 2020-01-01，同样输入必然产出同样字节，
 *   既方便测试比对，也避免"每次打包哈希都变"导致缓存与排查困难；
 * - 只写 STORE 之外的 DEFLATE（method 8），Python 的 zipfile 可直接解；
 * - 不写目录条目：extractall 会按路径自动建目录，少一层出错空间；
 * - 权限位统一 0644：包里没有需要执行权限的文件（cloudflared 是运行时下载的）。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const REMOTE_DIR = join(PLUGIN_ROOT, 'remote')

/** 归档里不参与打包的文件：启动器模板（含占位符）与字节码缓存。 */
const SKIP_DIR_NAMES = new Set(['__pycache__'])
const SKIP_FILE_NAMES = new Set(['_entry.py'])

/** 固定时间戳（DOS 时间只能表示 1980 年起）：保证产物逐字节可复现。 */
const FIXED_TIME = { time: 0, date: ((2020 - 1980) << 9) | (1 << 5) | 1 }

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

/**
 * 标准 CRC-32（IEEE 802.3，ZIP 用的是这个）。
 * @param {Buffer} buffer
 * @returns {number} 无符号 32 位
 */
export function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function u16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value & 0xffff)
  return buffer
}

function u32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

/**
 * 生成 ZIP 字节流。
 *
 * @param {Array<{ name: string, data: Buffer | string }>} entries 归档条目（路径用 `/` 分隔）
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('ZIP 归档不能为空')
  if (entries.length > 0xffff) throw new Error(`ZIP 条目过多：${entries.length}`)

  const sorted = [...entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of sorted) {
    const name = posix.normalize(String(entry.name).replace(/\\/g, '/'))
    if (!name || name.startsWith('/') || name.includes('..')) throw new Error(`非法的归档路径：${entry.name}`)
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const packed = deflateRawSync(raw, { level: 9 })
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(raw)

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // 解压所需版本 2.0
      u16(0), // 通用标志位
      u16(8), // DEFLATE
      u16(FIXED_TIME.time),
      u16(FIXED_TIME.date),
      u32(sum),
      u32(packed.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0), // extra 长度
      nameBytes,
      packed,
    ])
    locals.push(local)

    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // 生成方版本
        u16(20),
        u16(0),
        u16(8),
        u16(FIXED_TIME.time),
        u16(FIXED_TIME.date),
        u32(sum),
        u32(packed.length),
        u32(raw.length),
        u16(nameBytes.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // 起始磁盘
        u16(0), // 内部属性
        u32(0o644 << 16), // 外部属性：普通文件 0644
        u32(offset),
        nameBytes,
      ]),
    )

    offset += local.length
  }

  const central = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(sorted.length),
    u16(sorted.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...locals, central, end])
}

/**
 * 递归收集 remote/ 下要打进归档的文件。
 *
 * @param {object} [options]
 * @param {string} [options.root] 源码根，默认仓库的 remote/
 * @param {string} [options.prefix] 归档内前缀，默认 remote
 * @param {Array<{ from: string, to: string }>} [options.extraFiles] 额外单文件（如验证 payload）
 * @returns {Promise<Array<{ name: string, data: Buffer }>>}
 */
export async function collectBundleEntries({ root = REMOTE_DIR, prefix = 'remote', extraFiles = [] } = {}) {
  const entries = []

  async function walk(dir, archivePrefix) {
    const children = await readdir(dir, { withFileTypes: true })
    for (const child of children) {
      if (child.name.startsWith('.')) continue
      const source = join(dir, child.name)
      if (child.isDirectory()) {
        if (SKIP_DIR_NAMES.has(child.name)) continue
        await walk(source, `${archivePrefix}/${child.name}`)
        continue
      }
      if (SKIP_FILE_NAMES.has(child.name)) continue
      if (!child.name.endsWith('.py') && !child.name.endsWith('.json')) continue
      entries.push({ name: `${archivePrefix}/${child.name}`, data: await readFile(source) })
    }
  }

  const info = await stat(root).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`源码目录不存在：${root}`)
  await walk(root, prefix)

  for (const item of extraFiles) {
    if (!item?.from || !item?.to) throw new Error('extraFiles 需要 from / to')
    const data = await readFile(item.from).catch((error) => {
      throw new Error(`归档附加文件读取失败：${item.from}（${error?.message ?? error}）`)
    })
    if (data.length === 0) throw new Error(`归档附加文件为空：${item.from}`)
    entries.push({ name: item.to, data })
  }

  if (entries.length === 0) throw new Error('源码包为空：remote/ 下没有可打包的 .py / .json')
  return entries
}

/**
 * 打包 remote/ 为 ZIP，并给出可直接写进日志的摘要。
 *
 * @param {object} [options] 透传 collectBundleEntries
 * @returns {Promise<{ bytes: Buffer, files: string[], digest: string }>}
 */
export async function buildBundle(options = {}) {
  const entries = await collectBundleEntries(options)
  const bytes = createZip(entries)
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  return { bytes, files: entries.map((entry) => entry.name).sort(), digest }
}
