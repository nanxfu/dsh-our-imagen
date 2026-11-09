/**
 * 工作区与产物路径解析。
 *
 * 所有对外暴露的图片路径都以 `<workspace>` 为根的相对路径（POSIX 分隔符）表示，
 * 读取时再做一次真实路径包含性校验，避免 `..` 与符号链接逃逸。
 */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const OUTPUT_DIR = 'imagen-output'

/** 当前会话的工作区根目录；取不到时退回进程工作目录。 */
export function workspaceRoot(ctx) {
  try {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory?.defaultDirectory) return workingDirectory.defaultDirectory
  } catch {}
  return process.cwd()
}

export function outputRoot(ctx) {
  return join(workspaceRoot(ctx), OUTPUT_DIR)
}

/** 相对路径（统一用 `/` 分隔）→ 绝对路径。 */
export function toAbsolute(ctx, relativePath) {
  return join(workspaceRoot(ctx), ...String(relativePath).split('/'))
}

/** 绝对路径 → 以工作区为根的相对路径。 */
export function toRelative(ctx, absolutePath) {
  return relative(workspaceRoot(ctx), absolutePath).split(sep).join('/')
}

/**
 * 把请求里的 path 参数解析成可信的产物绝对路径。
 * 只允许落在输出根目录内；越界或不存在返回 null。
 */
export async function resolveOutputPath(ctx, requested) {
  if (typeof requested !== 'string' || requested.trim() === '') return null
  if (requested.includes('\0')) return null

  const root = outputRoot(ctx)
  const target = isAbsolute(requested) ? requested : toAbsolute(ctx, requested)
  const resolvedTarget = resolve(target)

  const within = (child, parent) => {
    const rel = relative(parent, child)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }

  if (!within(resolvedTarget, resolve(root))) return null

  let realRoot
  let realTarget
  try {
    realRoot = await realpath(root)
    realTarget = await realpath(resolvedTarget)
  } catch {
    return null
  }
  if (!within(realTarget, realRoot)) return null

  const info = await stat(realTarget).catch(() => null)
  if (!info?.isFile()) return null

  return { absolute: realTarget, relative: toRelative(ctx, realTarget) }
}

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
}

export function contentTypeOf(filePath) {
  const dot = filePath.lastIndexOf('.')
  const ext = dot === -1 ? '' : filePath.slice(dot).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}
