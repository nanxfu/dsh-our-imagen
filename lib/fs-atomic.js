/**
 * 原子文件写入、遗留临时文件清理与进程内串行队列工具。
 *
 * 所有磁盘原子替换统一走「同目录随机临时文件 + rename」模式：
 * 进程中途被杀时读者只会看到完整旧文件或完整新文件，不会读到半截 JSON/PNG；
 * 写入前可按文件前缀清理上次崩溃留下的 `.tmp-*` 文件。
 *
 * Windows 上「rename 覆盖已存在文件」会被杀毒软件 / 索引服务瞬时占住句柄，抛出
 * `EPERM` / `EBUSY` / `EACCES`。这类失败是瞬时的，但直接抛出会让上层看到"写凭据失败"，
 * 表现为 Kaggle 登录静默失败（实测：`/state` 报 `unknown`，日志只有一行 EPERM）。
 * 所以 rename 单独做了有界重试（5 次，累计约 150ms），其它错误照常立即抛出。
 */

import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** 值得重试的 rename 错误码（瞬时占用，重试即可成功）。 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_MAX_ATTEMPTS = 5

/** 同步 sleep：Atomics.wait 是主线程上唯一不用忙等的原生等待。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** rename 的失败重试包装（异步）。 */
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(from, to)
    } catch (error) {
      if (attempt >= RENAME_MAX_ATTEMPTS - 1 || !RENAME_RETRY_CODES.has(error?.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt))
    }
  }
}

/** rename 的失败重试包装（同步）。 */
function renameSyncWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return renameSync(from, to)
    } catch (error) {
      if (attempt >= RENAME_MAX_ATTEMPTS - 1 || !RENAME_RETRY_CODES.has(error?.code)) throw error
      sleepSync(10 * 2 ** attempt)
    }
  }
}

/**
 * 生成同目录原子写入的唯一临时文件路径。
 *
 * @param {string} filePath
 * @returns {string}
 */
function atomicTempPath(filePath) {
  return `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

/**
 * 异步清理目录中指定前缀的遗留临时文件（静默忽略目录缺失或单文件删除失败）。
 *
 * @param {string} dir
 * @param {string} prefix
 * @returns {Promise<void>}
 */
export async function removeStaleTemps(dir, prefix) {
  const entries = await readdir(dir).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => {})),
  )
}

/**
 * 同步清理目录中指定前缀的遗留临时文件。
 *
 * @param {string} dir
 * @param {string} prefix
 * @returns {void}
 */
function removeStaleTempsSync(dir, prefix) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue
    try {
      rmSync(join(dir, name), { force: true })
    } catch {}
  }
}

/**
 * 同目录临时文件 + rename 原子写入（异步）。
 *
 * @param {string} filePath
 * @param {string | Uint8Array | Buffer} data
 * @param {{ ensureDir?: boolean, dirMode?: number, fileMode?: number,
 *   cleanStale?: boolean, tempPrefix?: string, encoding?: BufferEncoding }} [options]
 * @returns {Promise<void>}
 */
export async function writeFileAtomic(filePath, data, options = {}) {
  const { ensureDir = false, dirMode, fileMode, cleanStale = false, tempPrefix, encoding } = options
  const dir = dirname(filePath)
  if (ensureDir || dirMode != null) {
    await mkdir(dir, dirMode != null ? { recursive: true, mode: dirMode } : { recursive: true })
    if (dirMode != null) await chmod(dir, dirMode).catch(() => {})
  }
  if (cleanStale) {
    await removeStaleTemps(dir, tempPrefix ?? `${basename(filePath)}.tmp-`)
  }
  const temp = atomicTempPath(filePath)
  const writeOpts = {}
  if (encoding) writeOpts.encoding = encoding
  if (fileMode != null) writeOpts.mode = fileMode
  try {
    await writeFile(temp, data, Object.keys(writeOpts).length > 0 ? writeOpts : undefined)
    await renameWithRetry(temp, filePath)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  if (fileMode != null) await chmod(filePath, fileMode).catch(() => {})
}

/**
 * 同目录临时文件 + rename 原子写入（同步）。
 *
 * @param {string} filePath
 * @param {string | Uint8Array | Buffer} data
 * @param {{ ensureDir?: boolean, dirMode?: number, fileMode?: number,
 *   cleanStale?: boolean, tempPrefix?: string, encoding?: BufferEncoding }} [options]
 * @returns {void}
 */
export function writeFileAtomicSync(filePath, data, options = {}) {
  const { ensureDir = false, dirMode, fileMode, cleanStale = false, tempPrefix, encoding } = options
  const dir = dirname(filePath)
  if (ensureDir || dirMode != null) {
    mkdirSync(dir, dirMode != null ? { recursive: true, mode: dirMode } : { recursive: true })
    if (dirMode != null) {
      try {
        chmodSync(dir, dirMode)
      } catch {}
    }
  }
  if (cleanStale) {
    removeStaleTempsSync(dir, tempPrefix ?? `${basename(filePath)}.tmp-`)
  }
  const temp = atomicTempPath(filePath)
  const writeOpts = {}
  if (encoding) writeOpts.encoding = encoding
  if (fileMode != null) writeOpts.mode = fileMode
  try {
    writeFileSync(temp, data, Object.keys(writeOpts).length > 0 ? writeOpts : undefined)
    renameSyncWithRetry(temp, filePath)
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {}
    throw error
  }
  if (fileMode != null) {
    try {
      chmodSync(filePath, fileMode)
    } catch {}
  }
}

/**
 * 创建进程内异步串行队列：按调用顺序依次执行任务，前一个失败不阻塞后续任务。
 *
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createSerialQueue() {
  let tail = Promise.resolve()
  return function serialize(task) {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
