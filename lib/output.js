/**
 * 本地产物：图片落盘、meta.json、历史扫描与预览 URL。
 *
 * 目录结构固定为 `<workspace>/imagen-output/<YYYYMMDD-HHmmss>-<jobId>/`，
 * 目录名以时间戳开头，因此字典序即时间序，历史列表不需要额外索引。
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { LIMITS } from '../shared/contract.js'
import { OUTPUT_DIR, outputRoot, resolveWorkspaceWritePath, toAbsolute, toRelative } from './paths.js'

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
 * 同目录临时文件 + rename 原子替换。
 *
 * 直接 writeFile 到目标路径时，进程中断会留下半截 PNG / 半截 meta.json（历史扫描会把它当
 * 完整产物展示）。写临时文件再 rename 后，读者要么看到完整旧文件、要么看到完整新文件；
 * rename 失败（目标被占用等）时清掉临时文件，不把垃圾留在产物目录里。
 */
async function writeFileAtomic(path, data) {
  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    await writeFile(temp, data)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 多张交付时的文件名：`docs/assets/hero.png` → `docs/assets/hero-01.png`。
 * 序号插在扩展名前；单张交付直接用目标文件名。
 *
 * @param {string} relative 校验过的 saveTo 相对路径（已补扩展名）
 * @param {number} index 0 起的图片序号
 * @param {number} total 本批张数
 */
export function deliveredName(relative, index, total) {
  if (total <= 1) return relative
  const slash = relative.lastIndexOf('/')
  const dir = slash === -1 ? '' : relative.slice(0, slash + 1)
  const name = slash === -1 ? relative : relative.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${dir}${stem}-${String(index + 1).padStart(2, '0')}${ext}`
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
    // 多张时按 -01/-02 追加序号，序号按「本批实际交付顺序」递增。
    if (delivery?.ok) {
      const deliveredRelative = deliveredName(delivery.relative, images.length - 1, deliveryTotal)
      const deliveredAbsolute = toAbsolute(ctx, deliveredRelative)
      await mkdir(dirname(deliveredAbsolute), { recursive: true })
      await writeFileAtomic(deliveredAbsolute, buffer)
      deliveredPaths.push(deliveredRelative)
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
  const metaAbsolute = join(absoluteDir, 'meta.json')
  await writeFileAtomic(metaAbsolute, JSON.stringify(meta, null, 2), 'utf8')

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
async function readHistoryItem(ctx, root, name) {
  const absoluteDir = join(root, name)
  let meta
  try {
    meta = JSON.parse(await readFile(join(absoluteDir, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
  const images = (
    await Promise.all(
      (Array.isArray(meta?.images) ? meta.images : [])
        .filter((image) => image && image.file)
        .map(async (image) => {
          const relative = toRelative(ctx, join(absoluteDir, String(image.file ?? '')))
          // 图片可能已被用户在画廊里删除；meta 里还留着记录，这里按实际文件过滤。
          const exists = await stat(join(absoluteDir, String(image.file))).then(
            (info) => info.isFile(),
            () => false,
          )
          if (!exists) return null
          return {
            file: image.file,
            path: relative,
            // 绝对路径给「复制文件路径」用：客户端拿不到工作区根目录。
            absolute: join(absoluteDir, String(image.file ?? '')),
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
  let validSeen = 0
  let hasMore = false
  for (const name of dirs) {
    const item = await readHistoryItem(ctx, root, name)
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
