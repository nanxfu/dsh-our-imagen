/**
 * 本地作品库：收藏与删除的持久化。
 *
 * 存放在 `<workspace>/.imagen/library.json`，与产物目录分离，
 * 这样清理 imagen-output 不会丢收藏标记，反过来删图也不影响库文件。
 *
 * 结构：
 *   { "favorites": ["imagen-output/<job>/<file>.png"],
 *     "deleted": [{ "path": "...", "at": "2026-11-09T..." }] }
 *
 * 并发与崩溃安全（多窗口同时收藏/删除）：
 *  - 写入统一走 `serialize()` 的进程内串行队列，读-改-写不会交错丢更新；
 *  - 落盘用「同目录临时文件 + rename」原子替换，读者永远看到完整旧文件或完整新文件，
 *    进程在写入中途被杀也只会留下一个可忽略的临时文件；
 *  - 文件损坏时 readLibrary 返回空库并附 `notes`（不静默），下一次写入前会先把
 *    损坏文件重命名为 `library.json.corrupt-<时间戳>` 备份，避免覆盖后无法追溯。
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { workspaceRoot } from './paths.js'

const LIBRARY_DIR = '.imagen'
const LIBRARY_FILE = 'library.json'
const MAX_DELETED = 500

function libraryPath(ctx) {
  return join(workspaceRoot(ctx), LIBRARY_DIR, LIBRARY_FILE)
}

function emptyLibrary() {
  return { favorites: [], deleted: [] }
}

function normalize(value) {
  const list = Array.isArray(value) ? value : []
  return [...new Set(list.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().replace(/\\/g, '/')))]
}

/** 把文件内容解析成库对象；格式不合法时抛错，由调用方决定降级方式。 */
function parseLibrary(text) {
  const parsed = JSON.parse(text)
  const value = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  return {
    favorites: normalize(value.favorites),
    deleted: Array.isArray(value.deleted) ? value.deleted.filter((item) => item && typeof item.path === 'string') : [],
  }
}

/** 串行化所有写入任务：前一个失败不阻塞后一个。任务在调用时同步入队。 */
let writeChain = Promise.resolve()
function serialize(task) {
  const result = writeChain.then(task, task)
  writeChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** 已存在的文件如果不是合法 JSON，先改名备份，保留用户原始数据。 */
async function backupCorruptLibrary(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  try {
    JSON.parse(text)
    return null
  } catch {
    const backup = `${path}.corrupt-${Date.now()}`
    await rename(path, backup).catch(() => null)
    return backup
  }
}

/** 清掉上次进程中断留下的临时文件（只清本库的命名前缀）。 */
async function removeStaleTemps(dir) {
  const entries = await readdir(dir).catch(() => [])
  const prefix = `${LIBRARY_FILE}.tmp-`
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => {})),
  )
}

async function writeLibraryFile(ctx, data) {
  const path = libraryPath(ctx)
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  await removeStaleTemps(dir)
  await backupCorruptLibrary(path)

  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  const text = `${JSON.stringify({ favorites: data.favorites, deleted: data.deleted }, null, 2)}\n`
  await writeFile(temp, text, 'utf8')
  try {
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  return { favorites: data.favorites, deleted: data.deleted }
}

/**
 * 读取作品库。
 * 文件不存在 → 空库（正常首次使用）；解析失败/读取失败 → 空库 + `notes` 说明，
 * 调用方（HTTP 路由）原样透传，前端可据此提示而不是让用户以为收藏被清空。
 */
export async function readLibrary(ctx) {
  try {
    const text = await readFile(libraryPath(ctx), 'utf8')
    return parseLibrary(text)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyLibrary()
    if (error instanceof SyntaxError) {
      return { ...emptyLibrary(), notes: ['library.json 已损坏，暂按空库显示；下次收藏/删除前会备份原文件'] }
    }
    return { ...emptyLibrary(), notes: [`读取 library.json 失败：${String(error?.code ?? error)}`] }
  }
}

/** 设置 / 取消收藏。 */
export async function setFavorite(ctx, path, favorite) {
  const target = String(path ?? '').trim().replace(/\\/g, '/')
  if (!target) return { ok: false, code: 'invalid_path', favorites: [] }
  const library = await serialize(async () => {
    const current = await readLibrary(ctx)
    const set = new Set(current.favorites)
    if (favorite) set.add(target)
    else set.delete(target)
    return writeLibraryFile(ctx, { favorites: [...set].sort(), deleted: current.deleted })
  })
  return { ok: true, favorites: library.favorites }
}

/** 记录删除：只登记路径，文件由调用方在确认可删后移除。 */
export async function recordDeleted(ctx, paths) {
  const wanted = Array.isArray(paths) ? paths.filter((item) => typeof item === 'string' && item.trim()) : []
  const library = await serialize(async () => {
    const current = await readLibrary(ctx)
    const stamp = new Date().toISOString()
    const known = new Set(current.deleted.map((item) => item.path))
    for (const path of wanted) {
      const target = String(path).trim().replace(/\\/g, '/')
      if (known.has(target)) continue
      current.deleted.unshift({ path: target, at: stamp })
      known.add(target)
    }
    current.deleted = current.deleted.slice(0, MAX_DELETED)
    const deletedSet = new Set(current.deleted.map((item) => item.path))
    const favorites = current.favorites.filter((path) => !deletedSet.has(path))
    return writeLibraryFile(ctx, { favorites, deleted: current.deleted })
  })
  return library
}