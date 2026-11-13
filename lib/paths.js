/**
 * 工作区与产物路径解析。
 *
 * 所有对外暴露的图片路径都以 `<workspace>` 为根的相对路径（POSIX 分隔符）表示，
 * 读取时再做一次真实路径包含性校验，避免 `..` 与符号链接逃逸。
 */

import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const OUTPUT_DIR = 'imagen-output'
/** 插件私有元数据目录（会话记录、设置、日志）；不允许作为 saveTo 的落点。 */
export const IMAGEN_DIR = '.imagen'

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

/** child 是否严格位于 parent 之内（parent 本身不算）。 */
export function isWithin(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** saveTo 的落点不允许落在插件保留目录里（它们是产物归档与私有元数据）。 */
const RESERVED_ROOTS = new Set([OUTPUT_DIR, IMAGEN_DIR])

/** Windows 盘符前缀（`C:` / `D:/x`）：POSIX 语义的 isAbsolute 判断不了这种写法。 */
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/

/** 单个路径段是否带扩展名（决定是否自动补 .png）。 */
const HAS_EXTENSION_RE = /\.[A-Za-z0-9]+$/

/**
 * 校验 `imagen_generate` 的 saveTo（工作区相对路径），补齐扩展名并归一成 POSIX 形式。
 *
 * 同步纯函数：入队前先做格式校验，避免非法路径排到队头才失败。
 * 符号链接逃逸需要文件系统信息，由 `resolveWorkspaceWritePath` 补充。
 *
 * @param {unknown} requested
 * @returns {{ ok: true, relative: string } | { ok: false, code: 'invalid_path', message: string }}
 */
export function normalizeSaveTo(requested) {
  const invalid = (message) => ({ ok: false, code: 'invalid_path', message })
  if (typeof requested !== 'string') return invalid('saveTo 必须是字符串')
  const raw = requested.trim()
  if (raw === '') return invalid('saveTo 不能为空')
  if (raw.includes('\0')) return invalid('saveTo 含有非法字符')
  if (isAbsolute(raw) || WINDOWS_DRIVE_RE.test(raw)) return invalid('saveTo 只接受工作区内的相对路径')

  const segments = raw.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) return invalid('saveTo 不是有效路径')
  if (segments.includes('..')) return invalid('saveTo 不允许包含 ..')
  if (RESERVED_ROOTS.has(segments[0])) return invalid(`saveTo 不能写入 ${OUTPUT_DIR}/ 或 ${IMAGEN_DIR}/ 内部`)

  const relativePath = segments.join('/')
  const filename = segments[segments.length - 1]
  // 产物固定是 PNG：未指定扩展名时补 .png（显式写的扩展名原样保留）。
  const withExtension = HAS_EXTENSION_RE.test(filename) ? relativePath : `${relativePath}.png`
  return { ok: true, relative: withExtension }
}

/** 从 path 向上找到第一个已存在的路径（含自身）；一路到根都不存在时返回 null。 */
async function nearestExistingPath(path) {
  let current = path
  while (true) {
    const info = await stat(current).catch(() => null)
    if (info) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * 把 saveTo 解析成工作区内的绝对写入路径（含软链接逃逸检查）。
 *
 * 三道校验：格式（normalizeSaveTo）→ 词法包含性 → 真实路径包含性。目标文件通常还不存在，
 * 所以对「目标自身（若已存在）」与「最近已存在的祖先目录」都做 realpath 校验，
 * 防止工作区内放一个指向工作区外的软链接把文件写出去。
 *
 * @returns {Promise<{ ok: true, relative: string, absolute: string }
 *   | { ok: false, code: 'invalid_path', message: string }>}
 */
export async function resolveWorkspaceWritePath(ctx, requested) {
  const normalized = normalizeSaveTo(requested)
  if (!normalized.ok) return normalized

  const root = resolve(workspaceRoot(ctx))
  const absolute = resolve(root, ...normalized.relative.split('/'))
  if (!isWithin(root, absolute)) {
    return { ok: false, code: 'invalid_path', message: 'saveTo 超出了工作区范围' }
  }

  // 工作区不存在时 realpath 失败：此时不存在可被利用的软链接，词法校验结果已足够。
  const realRoot = await realpath(root).catch(() => null)
  if (!realRoot) return { ok: true, relative: normalized.relative, absolute }

  const existingTarget = await nearestExistingPath(absolute)
  const realExisting = existingTarget ? await realpath(existingTarget).catch(() => null) : null
  // existingTarget 可能等于目标自身（覆盖已有文件），也可能是某个祖先目录；两者都必须落在工作区内。
  if (realExisting && !(realExisting === realRoot || isWithin(realRoot, realExisting))) {
    return { ok: false, code: 'invalid_path', message: 'saveTo 指向了工作区之外的目录' }
  }

  return { ok: true, relative: normalized.relative, absolute }
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

/** 产物根目录的绝对路径；目录不存在时返回 null。 */
export async function resolveOutputDir(ctx) {
  const root = outputRoot(ctx)
  try {
    const info = await stat(root)
    return info.isDirectory() ? root : null
  } catch {
    return null
  }
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
