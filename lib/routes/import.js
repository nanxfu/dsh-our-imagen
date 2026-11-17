/**
 * 本地图片导入路由：`POST /imagen-api/import`（阶段十五 Phase A3）。
 *
 * 用户把本地 PNG / JPEG（拖入舞台、选择文件或粘贴）交给工作台时，Host 按与出图产物
 * 完全同构的方式落盘成「导入作品」：`imagen-output/<stamp>-import-<6 位随机>/01.png|01.jpg`
 * + `meta.json`（追加 `source: "import"` / `imported: true`）。这样导入图与 AI 生成图共用
 * 同一套 `{ path, url, width, height }` 资产模型，历史、版本树、局部重绘与拉帘对比都不需要
 * 第二套旁路。
 *
 * 若 PNG 内带本插件写入的 tEXt 生成元数据（`lib/image-meta.js`），把原生成参数回填进
 * `generation` 并用它覆盖 `params`，胶片条点该图即可复现原图。
 *
 * 校验顺序固定为：请求体 JSON / 字段 → dataURL 或 base64 归一 → 解码字节 → 体积 →
 * PNG/JPEG 魔数与宽高解析 → 最小边。错误码只用既有词表：
 * `invalid_body`（JSON / 字段缺失）、`invalid_request`（超限 / 不是图片 / 太小）。
 */

import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { IMPORT, ROUTES, TIMEOUTS } from '../../shared/contract.js'
import { writeFileAtomic } from '../fs-atomic.js'
import { readJsonBody, sendError, sendJson } from '../http.js'
import { parseImageHeader, readGenerationMeta } from '../image-meta.js'
import { outputRoot } from '../paths.js'
import { readHistoryItem, stamp } from '../output.js'

/**
 * 导入请求体上限：图片以 base64 提交，体积约为解码后字节的 4/3。
 * 用契约默认值兜底，避免比默认值还小时反而收紧其它常量。
 */
const IMPORT_BODY_MAX_BYTES = Math.max(
  TIMEOUTS.bodyMaxBytes,
  Math.ceil((IMPORT.maxBytes * 4) / 3) + 64 * 1024,
)

const IMAGE_FORMATS = {
  png: { file: '01.png' },
  jpeg: { file: '01.jpg' },
}

/**
 * 清理展示名：去掉控制字符、首尾空白，按字符截断到 `IMPORT.maxNameChars`。
 * 名字只进 meta / 列表标题，不参与落盘路径。
 */
function cleanName(value) {
  if (typeof value !== 'string') return ''
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  return Array.from(stripped).slice(0, IMPORT.maxNameChars).join('')
}

/**
 * 把请求里的 `data` 归一成图片字节：接受 dataURL（`data:image/png;base64,...`）或裸 base64。
 *
 * 只做格式归一，不判断图片类型：类型由调用方按魔数校验。返回的失败信息统一映射到
 * `invalid_request`（字段缺失在路由入口已按 `invalid_body` 拒绝）。
 *
 * @param {string} data dataURL 或裸 base64
 * @returns {{ ok: true, buffer: Buffer } | { ok: false, message: string }}
 */
function decodeImageData(data) {
  let text = data.trim()
  if (/^data:/i.test(text)) {
    const match = /^data:([^,]*);base64,([\s\S]*)$/i.exec(text)
    if (!match) return { ok: false, message: 'data 不是合法的 dataURL（需要 ...;base64,... 形式）' }
    text = match[2]
  }
  const payload = text.replace(/\s+/g, '')
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    return { ok: false, message: 'data 不是合法的 base64 图片' }
  }
  const buffer = Buffer.from(payload, 'base64')
  if (buffer.length === 0) return { ok: false, message: 'data 解码后为空' }
  return { ok: true, buffer }
}

/**
 * 组装 meta.params。
 *
 * 没有生成元数据时只记录导入图自身的展示名与像素尺寸（胶片条回填不依赖这些字段）；
 * 有生成元数据时用原生成参数覆盖 prompt / negativePrompt / width / height，并按需补
 * steps / cfg / seed，保证「点导入图 = 回到原生成参数」。
 */
function buildParams({ generation, name, header }) {
  const params = {
    prompt: name,
    width: header.width,
    height: header.height,
    count: 1,
    source: 'import',
  }
  if (!generation) return params
  params.prompt = generation.prompt || name
  params.negativePrompt = generation.negativePrompt
  params.width = generation.width
  params.height = generation.height
  if (generation.steps !== null) params.steps = generation.steps
  if (generation.cfg !== null) params.cfg = generation.cfg
  if (generation.seed !== null) params.seed = generation.seed
  return params
}

/**
 * @param {{ ctx: object, log: object }} deps
 */
export function createImportRoutes({ ctx, log }) {
  return [
    {
      name: 'import-file',
      path: ROUTES.importFile.path,
      method: ROUTES.importFile.method,
      async handler(req, res) {
        // 导入主路径：坏 JSON / 非对象 body 必须明确 400 invalid_body，不能静默当空对象。
        let body
        try {
          body = await readJsonBody(req, { maxBytes: IMPORT_BODY_MAX_BYTES, strictObject: true })
        } catch (error) {
          return sendError(res, 400, 'invalid_body', String(error?.message ?? error))
        }
        if (typeof body?.data !== 'string' || body.data.trim() === '') {
          return sendError(res, 400, 'invalid_body', '缺少 data（dataURL 或 base64 字符串）')
        }

        const decoded = decodeImageData(body.data)
        if (!decoded.ok) return sendError(res, 400, 'invalid_request', decoded.message)
        const buffer = decoded.buffer

        if (buffer.length > IMPORT.maxBytes) {
          const limitMb = Math.round((IMPORT.maxBytes / 1024 / 1024) * 10) / 10
          return sendError(res, 400, 'invalid_request', `图片超过 ${limitMb} MB 上限`)
        }
        const header = parseImageHeader(buffer)
        if (!header) return sendError(res, 400, 'invalid_request', '只支持 PNG / JPEG 图片')
        if (header.width < IMPORT.minEdge || header.height < IMPORT.minEdge) {
          return sendError(
            res,
            400,
            'invalid_request',
            `图片太小（${header.width}×${header.height}），宽高都至少需要 ${IMPORT.minEdge} 像素`,
          )
        }

        const name = cleanName(body.name)
        // 生成元数据只存在 PNG tEXt 里；JPEG 没有等价容器，consistent 地按「无元数据」处理。
        const generation = header.format === 'png' ? readGenerationMeta(buffer) : null
        const params = buildParams({ generation, name, header })
        const format = IMAGE_FORMATS[header.format]
        const now = new Date().toISOString()
        const dirName = `${stamp()}-import-${randomBytes(3).toString('hex')}`
        const jobId = `import-${dirName}`
        const absoluteDir = join(outputRoot(ctx), dirName)
        const file = format.file

        // 先写图片、最后写 meta.json（commit 标记）：中途失败时目录里没有 meta，
        // 历史扫描会忽略这半截产物，而不是展示一条坏记录。
        await mkdir(absoluteDir, { recursive: true })
        await writeFileAtomic(join(absoluteDir, file), buffer)
        const meta = {
          version: 1,
          jobId,
          // 导入图没有「生成模型」，只有内嵌生成元数据时才能恢复出原预设。
          presetId: generation?.presetId ?? null,
          createdAt: now,
          finishedAt: now,
          params,
          images: [
            {
              file,
              seed: null,
              seconds: null,
              width: header.width,
              height: header.height,
              prompt: params.prompt,
            },
          ],
          source: 'import',
          imported: true,
          generation,
        }
        await writeFileAtomic(join(absoluteDir, 'meta.json'), JSON.stringify(meta, null, 2), {
          encoding: 'utf8',
        })

        // 直接复用历史扫描的归一逻辑，保证响应里的 item 与 /history 条目逐字段同形。
        const item = await readHistoryItem(ctx, outputRoot(ctx), dirName)
        if (!item) {
          log.warn(`import_readback_failed dir=${dirName}（图片已落盘但历史条目归一失败）`)
          return sendError(res, 500, 'internal_error', '导入已落盘但读取失败，请刷新历史')
        }
        // generation 只在响应里额外给一份（meta.json 里也有）：客户端据此提示「已识别生成参数」，
        // 不必再为 /history 条目增加字段。
        sendJson(res, 200, { ok: true, entry: { image: item.images[0], item, generation } })
      },
    },
  ]
}
