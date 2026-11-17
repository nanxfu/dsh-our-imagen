/**
 * 本地产物：图片落盘、meta.json、历史扫描与预览 URL。
 *
 * 目录结构固定为 `<workspace>/imagen-output/<YYYYMMDD-HHmmss>-<jobId>/`，
 * 目录名以时间戳开头，因此字典序即时间序，历史列表不需要额外索引。
 *
 * 版本树（阶段十三）：图生图/局部重绘产物在 meta 里记录 `rootImage`（根作品图片路径），
 * 落盘时按父作品 meta 继承；旧数据缺失该字段时按 `sourceImage` 链回溯（≤8 层）。
 * 历史接口透传这条链，`/history/tree` 按根跨分页拉整棵树。
 */

import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { LIMITS } from '../shared/contract.js'
import { writeFileAtomic } from './fs-atomic.js'
import { OUTPUT_DIR, isWithin, outputRoot, resolveWorkspaceWritePath, toRelative } from './paths.js'

function pad(value, size = 2) {
  return String(value).padStart(size, '0')
}

export function stamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export function fileUrl(ctx, relativePath) {
  let origin = ''
  try {
    origin = ctx.webServer?.getOrigin?.() ?? ''
  } catch {
    origin = ''
  }
  origin = origin.replace(/\/+$/, '')
  const query = new URLSearchParams({ path: relativePath })
  return `${origin}/imagen-api/file?${query.toString()}`
}

/**
 * 多张交付时的文件名：`docs/assets/hero.png` → `docs/assets/hero-01.png`。
 * 序号插在扩展名前；单张交付直接用目标文件名。
 *
 * @param {string} relative 校验过的 saveTo 相对路径（已补扩展名）
 * @param {number} index 0 起的图片序号
 * @param {number} total 本批张数
 */
function deliveredName(relative, index, total) {
  if (total <= 1) return relative
  const slash = relative.lastIndexOf('/')
  const dir = slash === -1 ? '' : relative.slice(0, slash + 1)
  const name = slash === -1 ? relative : relative.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${dir}${stem}-${String(index + 1).padStart(2, '0')}${ext}`
}

/** 版本链回溯深度上限：旧 meta 没有 rootImage 时沿 sourceImage 链最多读 8 层。 */
const ROOT_IMAGE_MAX_DEPTH = 8

/**
 * 把 meta / 请求里记录的图片路径归一成 `imagen-output/` 内的 POSIX 相对路径；非法返回 null。
 *
 * meta 是本地文件，但旧版本写入或被用户手改的字段不能把后续读取带出产物目录：
 * 绝对路径、盘符、`..` / `.` 段与非 `imagen-output/` 前缀一律视为无效。
 */
function outputImagePathOf(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.includes('\0')) return null
  const segments = text.split(/[\\/]+/).filter((segment) => segment !== '')
  if (segments.length < 2) return null
  if (segments.some((segment) => segment === '..' || segment === '.')) return null
  if (segments[0] !== OUTPUT_DIR) return null
  return segments.join('/')
}

/**
 * 读取产物目录的 meta.json（按目录名缓存，扫描时同一目录只读一次）。
 * 目录不存在、meta 缺失或 JSON 损坏都返回 null：版本链读取只是尽力而为，不能让历史/版本树接口失败。
 */
async function readWorkMeta(rootAbsolute, dirName, memo) {
  const cached = memo?.metas?.get(dirName)
  if (cached) return cached
  const task = readFile(join(rootAbsolute, dirName, 'meta.json'), 'utf8')
    .then((text) => {
      const meta = JSON.parse(text)
      return meta && typeof meta === 'object' ? meta : null
    })
    .catch(() => null)
  memo?.metas?.set(dirName, task)
  return task
}

/**
 * 解析一张作品图的版本树根作品路径。
 *
 * 规则（.tmp/plan/INTERFACES.md §3.1 / §3.2）：
 *  - 父作品 meta 有 `rootImage` 就直接继承；
 *  - 旧 meta 没有 `rootImage` 但有 `sourceImage`：沿链继续向上，最多 8 层；
 *  - 读不到 meta / 没有 `sourceImage`：当前这张就是根；
 *  - 链出现环或超过深度上限：停在当前这张，返回它的路径（不能回溯时退回来源图）。
 *
 * @param {object} ctx 宿主上下文
 * @param {string|null} sourceImage 来源图工作区相对路径（params.reference.sourcePath 或 meta.sourceImage）
 * @param {{ maxDepth?: number, memo?: { metas?: Map, roots?: Map } }} [options]
 * @returns {Promise<string|null>} 根作品图片路径；没有有效来源图时 null
 */
async function resolveRootImage(ctx, sourceImage, { maxDepth = ROOT_IMAGE_MAX_DEPTH, memo = null } = {}) {
  const start = outputImagePathOf(sourceImage)
  if (!start) return null
  if (memo?.roots?.has(start)) return memo.roots.get(start)

  const root = outputRoot(ctx)
  const seen = new Set([start])
  let current = start
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const meta = await readWorkMeta(root, current.split('/')[1], memo)
    const inherited = meta ? outputImagePathOf(meta.rootImage) : null
    if (inherited) {
      current = inherited
      break
    }
    const parent = meta ? outputImagePathOf(meta.sourceImage) : null
    if (!parent || seen.has(parent)) break
    seen.add(parent)
    current = parent
  }
  memo?.roots?.set(start, current)
  return current
}

/**
 * 把远端返回的 Base64 图片写盘，并生成 meta.json。
 *
 * 顺序固定：先写全部图片、最后写 meta.json，meta 是「本目录已完成」的提交标记；
 * 中途失败时目录里最多只有若干完整图片，没有 meta，历史扫描会忽略该目录而不是展示半截产物。
 *
 * `job.saveTo` 存在时在归档之后额外做一次「工作区交付」：目标路径先经
 * `resolveWorkspaceWritePath` 校验（越界 / 软链接逃逸 / 插件保留目录直接失败），
 * 每张图都以同目录临时文件 + rename 写入，交付成功的相对路径记在 `deliveredPaths`。
 *
 * @returns {Promise<{ dir: string, metaFile: string, images: Array<object>, deliveredPaths: string[] }>}
 */
export async function saveJobOutput(ctx, job, results) {
  // 交付路径先解析：非法时在创建归档目录之前失败，不留半截产物。
  const delivery = job.saveTo ? await resolveWorkspaceWritePath(ctx, job.saveTo) : null
  if (delivery && !delivery.ok) {
    throw Object.assign(new Error(delivery.message), { code: delivery.code })
  }
  const deliveryTotal = Math.max(1, Math.round(Number(job.params?.count) || 1))

  const dirName = `${stamp()}-${job.id}`
  const root = outputRoot(ctx)
  const absoluteDir = join(root, dirName)
  await mkdir(absoluteDir, { recursive: true })

  const images = []
  const records = []
  const deliveredPaths = []

  for (const result of results) {
    const b64 = typeof result?.image_b64 === 'string' ? result.image_b64 : ''
    if (!b64) continue
    const buffer = Buffer.from(b64, 'base64')
    if (buffer.length === 0) continue

    // 远端返回的 name 只用于展示，不参与路径拼接：避免 `../` 之类写出输出目录。
    const file = `${String(images.length + 1).padStart(2, '0')}.png`
    await writeFileAtomic(join(absoluteDir, file), buffer)

    const relative = toRelative(ctx, join(absoluteDir, file))
    images.push({
      file,
      path: relative,
      url: fileUrl(ctx, relative),
      width: result.width ?? job.params.width,
      height: result.height ?? job.params.height,
      seed: result.seed ?? job.params.seed,
      seconds: result.seconds ?? null,
    })
    records.push({
      file,
      seed: result.seed ?? job.params.seed,
      seconds: result.seconds ?? null,
      width: result.width ?? job.params.width,
      height: result.height ?? job.params.height,
      prompt: job.params.prompt,
      negativePrompt: job.params.negativePrompt ?? '',
    })

    // 工作区交付：与归档图片同样的原子写（同目录临时文件 + rename），
    // 多张时按 -01/-02 追加序号，并再次通过 resolveWorkspaceWritePath 校验落点安全。
    if (delivery?.ok) {
      const deliveredRelative = deliveredName(delivery.relative, images.length - 1, deliveryTotal)
      const deliveredCheck = await resolveWorkspaceWritePath(ctx, deliveredRelative)
      if (!deliveredCheck.ok) {
        throw Object.assign(new Error(deliveredCheck.message), { code: deliveredCheck.code })
      }
      await mkdir(dirname(deliveredCheck.absolute), { recursive: true })
      await writeFileAtomic(deliveredCheck.absolute, buffer)
      deliveredPaths.push(deliveredCheck.relative)
    }
  }

  const meta = {
    version: 1,
    jobId: job.id,
    presetId: job.presetId,
    modelId: job.modelId ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? new Date().toISOString(),
    params: job.params,
    images: records,
  }
  // 交付路径写进 meta：历史条目与「复现同一组图」时可以知道文件也落在工作区哪里。
  if (deliveredPaths.length) meta.deliveredPaths = [...deliveredPaths]
  // 图生图（M3）：产物记录参考图出处与重绘强度，便于画廊回看「这张是从哪张图重绘的」。
  // 二选一来源里 image（前端上传）没有工作区路径，sourceImage 记 null。
  // 局部重绘再记 inpaint=true：meta 是「本目录已完成」的提交标记，复现时不必再解析 params。
  // 版本树（阶段十三）：rootImage 记录根作品路径，O(1) 归组整棵树；父作品 meta 有就继承，
  // 旧父作品（无 rootImage）按 sourceImage 链回溯 ≤8 层，读不到 meta 时退回来源图本身。
  // 上传来源没有可归组的根，sourceImage / rootImage 都显式写 null，客户端不必猜字段是否存在。
  if (job.params?.reference) {
    const sourceImage =
      typeof job.params.reference.sourcePath === 'string' ? job.params.reference.sourcePath : null
    meta.sourceImage = sourceImage
    meta.rootImage = sourceImage ? await resolveRootImage(ctx, sourceImage) : null
    meta.strength = job.params.reference.strength
    if (job.params.reference.mask) meta.inpaint = true
  }
  const metaAbsolute = join(absoluteDir, 'meta.json')
  await writeFileAtomic(metaAbsolute, JSON.stringify(meta, null, 2), { encoding: 'utf8' })

  return {
    dir: `${OUTPUT_DIR}/${dirName}`,
    metaFile: toRelative(ctx, metaAbsolute),
    images,
    deliveredPaths,
  }
}

/**
 * 读取单个产物目录，归一成 HistoryItem；目录没有可展示的有效记录时返回 null。
 *
 * 有效记录 = 有 meta.json，且至少一张 meta 中登记的图片文件实际存在
 * （图片可能已被用户在画廊里删除）。历史分页的 offset 只统计有效记录。
 */
async function readHistoryItem(ctx, root, name, memo = null) {
  const absoluteDir = join(root, name)
  let meta
  try {
    meta = JSON.parse(await readFile(join(absoluteDir, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
  const resolvedDir = resolve(absoluteDir)
  const images = (
    await Promise.all(
      (Array.isArray(meta?.images) ? meta.images : [])
        .filter((image) => image && image.file)
        .map(async (image) => {
          const targetAbsolute = resolve(resolvedDir, String(image.file ?? ''))
          if (!isWithin(resolvedDir, targetAbsolute)) return null
          const relative = toRelative(ctx, targetAbsolute)
          // 图片可能已被用户在画廊里删除；meta 里还留着记录，这里按实际文件过滤。
          const exists = await stat(targetAbsolute).then(
            (info) => info.isFile(),
            () => false,
          )
          if (!exists) return null
          return {
            file: image.file,
            path: relative,
            // 绝对路径给「复制文件路径」用：客户端拿不到工作区根目录。
            absolute: targetAbsolute,
            url: fileUrl(ctx, relative),
            width: image.width ?? null,
            height: image.height ?? null,
            seed: image.seed ?? null,
            seconds: image.seconds ?? null,
          }
        }),
    )
  ).filter(Boolean)
  if (images.length === 0) return null

  // 版本树字段（阶段十三）：sourceImage / rootImage / inpaint / strength 恒存在，缺省分别是 null / null / false / null。
  // 新 meta 直接透传 rootImage；0.12 及以前的旧 meta 没有该字段，尽力按 sourceImage 链回溯到根
  // （≤8 层），回溯不到时退回 sourceImage 本身，前端不必自己再拼跨分页的链。
  const sourceImage = outputImagePathOf(meta.sourceImage)
  const rootImage =
    outputImagePathOf(meta.rootImage) ?? (sourceImage ? await resolveRootImage(ctx, sourceImage, { memo }) : null)

  return {
    jobId: meta.jobId ?? name,
    dir: `${OUTPUT_DIR}/${name}`,
    createdAt: meta.createdAt ?? null,
    finishedAt: meta.finishedAt ?? null,
    presetId: meta.presetId ?? null,
    // 客户端「带回参数」与舞台提示词需要完整参数；只回显 prompt 会让历史图无法复现。
    params: meta.params ?? null,
    prompt: meta.params?.prompt ?? '',
    images,
    sourceImage,
    rootImage,
    inpaint: meta.inpaint === true,
    strength: typeof meta.strength === 'number' && Number.isFinite(meta.strength) ? meta.strength : null,
  }
}

/** 分页参数的默认值与边界（与 Host 路由共用契约，避免两套钳制口径）。 */
function normalizeHistoryPage(limitOrOptions, maybeOffset) {
  const options = limitOrOptions && typeof limitOrOptions === 'object' ? limitOrOptions : null
  const rawLimit = options ? options.limit : limitOrOptions
  const rawOffset = options ? options.offset : maybeOffset
  const limitNumber = Number(rawLimit)
  const offsetNumber = Number(rawOffset)
  return {
    limit: Number.isFinite(limitNumber)
      ? Math.max(0, Math.min(LIMITS.history.maxLimit, Math.round(limitNumber)))
      : LIMITS.history.defaultLimit,
    offset: Number.isFinite(offsetNumber) ? Math.max(0, Math.round(offsetNumber)) : 0,
  }
}

/**
 * 扫描历史产物（按目录名倒序 = 时间倒序，支持分页）。
 *
 * 兼容两种调用签名：
 *  - `scanHistory(ctx, limit)`：旧签名，等价于 `{ limit }`；
 *  - `scanHistory(ctx, { limit, offset })`：分页，`offset` 跳过最近的 offset 条有效记录。
 *
 * 只读取有效记录（有 meta.json 且至少 1 张现存图片）；`hasMore` 用一个额外有效记录判断，
 * 不改变 `items` 的元素结构。limit=0 时只判断 hasMore、不返回记录。
 *
 * @param {object} ctx 宿主上下文
 * @param {number|{ limit?: number, offset?: number }} [limitOrOptions]
 * @param {number} [maybeOffset] 旧签名可选的 offset
 * @returns {Promise<{ items: object[], hasMore: boolean }>}
 */
export async function scanHistory(ctx, limitOrOptions = LIMITS.history.defaultLimit, maybeOffset = 0) {
  const { limit, offset } = normalizeHistoryPage(limitOrOptions, maybeOffset)

  const root = outputRoot(ctx)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { items: [], hasMore: false }
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()

  const items = []
  const memo = { metas: new Map(), roots: new Map() }
  let validSeen = 0
  let hasMore = false
  for (const name of dirs) {
    const item = await readHistoryItem(ctx, root, name, memo)
    if (!item) continue
    validSeen += 1
    // offset 按「有效记录」计数，跳过被删空或缺失 meta 的目录不会挤掉真实记录。
    if (validSeen <= offset) continue
    if (items.length >= limit) {
      hasMore = true
      break
    }
    items.push(item)
  }
  return { items, hasMore }
}

/** 版本树分页参数：默认取契约 `LIMITS.history.pageSize`（100），钳制到 1..maxLimit。 */
function normalizeTreeLimit(limit) {
  const number = Number(limit)
  if (!Number.isFinite(number)) return LIMITS.history.pageSize
  return Math.max(1, Math.min(LIMITS.history.maxLimit, Math.round(number)))
}

/**
 * 扫描全部有效历史记录（不早停），供 `/history/tree` 按根过滤。
 *
 * 与 scanHistory 共用 readHistoryItem 和同一份 meta / root 缓存，顺序也与 /history 完全一致
 * （目录名倒序 = 时间倒序）。版本树必须看到全部分页才能判断 hasMore，因此这里不做早停。
 */
async function listHistoryItems(ctx) {
  const root = outputRoot(ctx)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()

  const memo = { metas: new Map(), roots: new Map() }
  const items = []
  for (const name of dirs) {
    const item = await readHistoryItem(ctx, root, name, memo)
    if (item) items.push(item)
  }
  return items
}

/**
 * 按根作品路径扫描整棵版本树（跨 /history 分页）。
 *
 * 命中规则（.tmp/plan/INTERFACES.md §3.3）：条目的任一图片路径等于 root，或条目记录的
 * `rootImage` 等于 root；根节点自身通过「图片路径等于 root」命中。结果与 /history 同形，
 * 按目录名倒序；`hasMore` 表示该树还有更早的条目（limit 上限见 LIMITS.history）。
 *
 * root 为空/越界的 400 由 HTTP 路由转成 `invalid_request`；这里只做归一与防御性校验。
 *
 * @param {object} ctx 宿主上下文
 * @param {{ root?: string, limit?: number }} [options]
 * @returns {Promise<{ ok: true, root: string, items: object[], hasMore: boolean }
 *   | { ok: false, code: 'invalid_request', message: string }>}
 */
export async function scanHistoryTree(ctx, { root: requestedRoot, limit } = {}) {
  const root = outputImagePathOf(requestedRoot)
  if (!root) {
    return { ok: false, code: 'invalid_request', message: 'root 必须是 imagen-output/ 内的作品路径' }
  }
  const pageLimit = normalizeTreeLimit(limit)
  const treeItems = (await listHistoryItems(ctx)).filter(
    (item) => item.rootImage === root || item.images.some((image) => image.path === root),
  )
  return { ok: true, root, items: treeItems.slice(0, pageLimit), hasMore: treeItems.length > pageLimit }
}
