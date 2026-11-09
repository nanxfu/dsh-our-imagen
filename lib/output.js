/**
 * 本地产物：图片落盘、meta.json、历史扫描与预览 URL。
 *
 * 目录结构固定为 `<workspace>/imagen-output/<YYYYMMDD-HHmmss>-<jobId>/`，
 * 目录名以时间戳开头，因此字典序即时间序，历史列表不需要额外索引。
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { OUTPUT_DIR, outputRoot, toRelative } from './paths.js'

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
 * 把远端返回的 Base64 图片写盘，并生成 meta.json。
 * @returns {Promise<{ dir: string, metaFile: string, images: Array<object> }>}
 */
export async function saveJobOutput(ctx, job, results) {
  const dirName = `${stamp()}-${job.id}`
  const root = outputRoot(ctx)
  const absoluteDir = join(root, dirName)
  await mkdir(absoluteDir, { recursive: true })

  const images = []
  const records = []

  for (const result of results) {
    const b64 = typeof result?.image_b64 === 'string' ? result.image_b64 : ''
    if (!b64) continue
    const buffer = Buffer.from(b64, 'base64')
    if (buffer.length === 0) continue

    const file = `${String(result.name ?? images.length + 1).padStart(2, '0')}.png`
    await writeFile(join(absoluteDir, file), buffer)

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
  const metaAbsolute = join(absoluteDir, 'meta.json')
  await writeFile(metaAbsolute, JSON.stringify(meta, null, 2), 'utf8')

  return {
    dir: `${OUTPUT_DIR}/${dirName}`,
    metaFile: toRelative(ctx, metaAbsolute),
    images,
  }
}

/**
 * 扫描历史产物。只读取最近的 limit 个目录，避免大目录下的全量 IO。
 */
export async function scanHistory(ctx, limit = 30) {
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

  const items = []
  for (const name of dirs) {
    if (items.length >= limit) break
    const absoluteDir = join(root, name)
    let meta
    try {
      meta = JSON.parse(await readFile(join(absoluteDir, 'meta.json'), 'utf8'))
    } catch {
      continue
    }
    const images = (await Promise.all(
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
            url: fileUrl(ctx, relative),
            width: image.width ?? null,
            height: image.height ?? null,
            seed: image.seed ?? null,
            seconds: image.seconds ?? null,
          }
        }),
    )).filter(Boolean)
    if (images.length === 0) continue

    items.push({
      jobId: meta.jobId ?? name,
      dir: `${OUTPUT_DIR}/${name}`,
      createdAt: meta.createdAt ?? null,
      presetId: meta.presetId ?? null,
      prompt: meta.params?.prompt ?? '',
      images,
    })
  }
  return items
}
