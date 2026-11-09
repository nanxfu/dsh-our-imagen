/**
 * 本地作品库：收藏与删除的持久化。
 *
 * 存放在 `<workspace>/.imagen/library.json`，与产物目录分离，
 * 这样清理 imagen-output 不会丢收藏标记，反过来删图也不影响库文件。
 *
 * 结构：
 *   { "favorites": ["imagen-output/<job>/<file>.png"],
 *     "deleted": [{ "path": "...", "at": "2026-11-09T..." }] }
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

export async function readLibrary(ctx) {
  try {
    const text = await readFile(libraryPath(ctx), 'utf8')
    const parsed = JSON.parse(text)
    return {
      favorites: normalize(parsed.favorites),
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted.filter((item) => item && typeof item.path === 'string') : [],
    }
  } catch {
    return emptyLibrary()
  }
}

async function saveLibrary(ctx, data) {
  const path = libraryPath(ctx)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return data
}

/** 设置 / 取消收藏。 */
export async function setFavorite(ctx, path, favorite) {
  const target = String(path ?? '').trim().replace(/\\/g, '/')
  if (!target) return { ok: false, code: 'invalid_path', favorites: [] }
  const library = await readLibrary(ctx)
  const set = new Set(library.favorites)
  if (favorite) set.add(target)
  else set.delete(target)
  library.favorites = [...set].sort()
  await saveLibrary(ctx, library)
  return { ok: true, favorites: library.favorites }
}

/** 记录删除：只登记路径，文件由调用方在确认可删后移除。 */
export async function recordDeleted(ctx, paths) {
  const library = await readLibrary(ctx)
  const stamp = new Date().toISOString()
  const known = new Set(library.deleted.map((item) => item.path))
  for (const path of paths) {
    if (known.has(path)) continue
    library.deleted.unshift({ path, at: stamp })
    known.add(path)
  }
  library.deleted = library.deleted.slice(0, MAX_DELETED)
  const deletedSet = new Set(library.deleted.map((item) => item.path))
  library.favorites = library.favorites.filter((path) => !deletedSet.has(path))
  await saveLibrary(ctx, library)
  return { favorites: library.favorites, deleted: library.deleted }
}