/**
 * 图生图 / 局部重绘 / 模型原生参考图的落盘读取（工作区 `imagen-output/` 内作品 → base64）。
 *
 * 本模块负责执行阶段的两条参考图路径：
 *  - `resolveReferencePayload`：单图垫图（img2img / 局部重绘）的 `job.reference`
 *    → `{ image_b64, strength, mask_b64? }`；
 *  - `resolveReferenceImagesPayload`：模型原生参考生图（Phase C1）的 `job.references`
 *    路径数组 → `[{ image_b64 }, ...]`，含单张体积/魔数校验与总体积预算检查。
 *
 * 画廊路径来源必须经 `resolveOutputPath` 校验（只允许 `imagen-output/` 内、拒绝软链接逃逸），
 * 读取后再做体积与 PNG/JPEG 魔数校验；失败抛带 code 的错误让任务带可读原因失败。
 * 局部重绘蒙版在入队时已做字节级预检，这里原样透传，不在执行阶段二次读盘或解码。
 *
 * 从 `lib/jobs.js` 拆出：这是队列里唯一需要读盘 + 做路径安全校验的部分，
 * 与队列状态机无耦合，单独成文件便于审计「路径越界」这类安全逻辑。
 *
 * 注意：日志器由调用方注入（队列传入 `scope: 'jobs'` 的实例），
 * 保持拆分前的日志 scope 与文案逐字不变。
 */

import { readFile } from 'node:fs/promises'

import { LIMITS, TIMEOUTS } from '../../shared/contract.js'
import { resolveOutputPath } from '../paths.js'
import { logText } from '../redact.js'
import { REFERENCE_MAGIC, hasMagic } from './validator.js'

/**
 * Host→daemon 单次请求体的总体积预算（契约唯一来源）：
 * 与 `remote/config.py` 的 `request_body_limit()` 同量级——原生参考图走基础管线时只有
 * `referenceImages` 一个图片形状，2 × 4 MiB base64 后约 11.2 MB，必须能被现有远端请求体
 * 闸门接收；这里提前在 Host 侧按「估计 base64 总量 + 文本余量」拦一次，避免几十 MB 的请求
 * 穿过隧道 / Colab 代理后才发现远端拒绝（大请求体在隧道上更容易被掐断）。
 */
export const REFERENCE_IMAGES_REQUEST_BUDGET_BYTES = TIMEOUTS.remoteGenerateMaxBytes

/** 文本字段（pipeline / tasks / prompt / jobId 等）的余量：复用契约的默认请求体上限。 */
const REFERENCE_IMAGES_BODY_SLACK_BYTES = TIMEOUTS.bodyMaxBytes

/**
 * 把任务里的原生参考图路径列表读盘并做成远端载荷：`[{ image_b64 }, ...]`；没有参考图返回 null。
 *
 * 与 `resolveReferencePayload`（单图垫图）的区别：
 *  - 只接受工作区 `imagen-output/` 内的已落盘作品路径（原生参考图没有前端上传的来源）；
 *  - 按契约 `LIMITS.referenceImages` 校验单张体积与张数，并额外做一次总体积预算检查；
 *  - 不读 strength / 蒙版：原生参考没有这两项语义。
 *
 * 校验失败都抛带 `code` 的错误（`invalid_path` / `invalid_request`），任务以可读原因失败且
 * 不占用远端 GPU（执行阶段、提交远端请求之前完成）。
 *
 * @param {object} ctx 插件上下文（用于定位工作区）
 * @param {string[] | null | undefined} references 已归一的工作区相对路径数组
 * @param {{ jobId?: string, log: object }} deps
 * @returns {Promise<Array<{ image_b64: string }> | null>}
 */
export async function resolveReferenceImagesPayload(ctx, references, { jobId = 'unknown', log } = {}) {
  if (!Array.isArray(references) || references.length === 0) return null
  const limits = LIMITS.referenceImages
  const maxCount = Number(limits.maxCount) || 0
  if (maxCount > 0 && references.length > maxCount) {
    throw Object.assign(new Error(`最多 ${maxCount} 张参考图（收到 ${references.length} 张）`), {
      code: 'invalid_request',
    })
  }
  const items = []
  let encodedTotal = 0
  for (const [index, referencePath] of references.entries()) {
    const label = `第 ${index + 1} 张参考图`
    const found = await resolveOutputPath(ctx, referencePath).catch(() => null)
    if (!found) {
      throw Object.assign(new Error(`${label}不存在或不在 imagen-output/ 内`), { code: 'invalid_path' })
    }
    const data = await readFile(found.absolute).catch((error) => {
      log.warn(
        `reference_images_read_failed jobId=${jobId} index=${index + 1} message=${logText(error?.message ?? error)}`,
      )
      return null
    })
    if (!data || data.length === 0) {
      throw Object.assign(new Error(`${label}读取失败`), { code: 'invalid_path' })
    }
    if (data.length > limits.maxBytes) {
      const limitMb = Math.round((limits.maxBytes / 1024 / 1024) * 10) / 10
      throw Object.assign(new Error(`${label}超过 ${limitMb} MB 上限`), { code: 'invalid_request' })
    }
    if (!hasMagic(data, REFERENCE_MAGIC.png) && !hasMagic(data, REFERENCE_MAGIC.jpeg)) {
      throw Object.assign(new Error(`${label}只支持 PNG / JPEG`), { code: 'invalid_request' })
    }
    // base64 膨胀 4/3：先估算累计体积，超出契约预算时立即拒绝（不把超大请求发过隧道）。
    encodedTotal += Math.ceil(data.length / 3) * 4
    if (
      encodedTotal + REFERENCE_IMAGES_BODY_SLACK_BYTES >
      REFERENCE_IMAGES_REQUEST_BUDGET_BYTES
    ) {
      const budgetMb = Math.round((REFERENCE_IMAGES_REQUEST_BUDGET_BYTES / 1024 / 1024) * 10) / 10
      throw Object.assign(
        new Error(`参考图总体积过大：编码后超过远端请求体预算约 ${budgetMb} MB，请减少张数或压缩图片`),
        { code: 'invalid_request' },
      )
    }
    items.push({ image_b64: data.toString('base64') })
  }
  return items
}

/**
 * 把任务里的参考图解析成远端载荷：`{ image_b64, strength, mask_b64? }`；没有参考图返回 null。
 *
 * @param {object} ctx 插件上下文（用于定位工作区）
 * @param {{ path?: string|null, imageB64?: string|null, maskB64?: string|null, strength: number } | null} reference
 * @param {{ jobId?: string, log: object }} deps jobId 只用于日志；log 必须由调用方注入
 * @returns {Promise<{ image_b64: string, strength: number, mask_b64?: string } | null>}
 */
export async function resolveReferencePayload(ctx, reference, { jobId = 'unknown', log } = {}) {
  if (!reference) return null
  let imageB64 = reference.imageB64
  if (!imageB64) {
    const found = await resolveOutputPath(ctx, reference.path).catch(() => null)
    if (!found) {
      throw Object.assign(new Error('参考图不存在或不在 imagen-output/ 内'), { code: 'invalid_path' })
    }
    const data = await readFile(found.absolute).catch((error) => {
      log.warn(`reference_read_failed jobId=${jobId} message=${logText(error?.message ?? error)}`)
      return null
    })
    if (!data || data.length === 0) {
      throw Object.assign(new Error('参考图读取失败'), { code: 'invalid_path' })
    }
    if (data.length > LIMITS.reference.maxBytes) {
      const limitMb = Math.round((LIMITS.reference.maxBytes / 1024 / 1024) * 10) / 10
      throw Object.assign(new Error(`参考图超过 ${limitMb} MB 上限`), { code: 'invalid_request' })
    }
    if (!hasMagic(data, REFERENCE_MAGIC.png) && !hasMagic(data, REFERENCE_MAGIC.jpeg)) {
      throw Object.assign(new Error('参考图只支持 PNG / JPEG'), { code: 'invalid_request' })
    }
    imageB64 = data.toString('base64')
  }
  const payload = { image_b64: imageB64, strength: reference.strength }
  // 蒙版原样透传：远端按 `contract.limits.mask.maxBytes` 再校验一次并负责解码/对齐。
  if (reference.maskB64) payload.mask_b64 = reference.maskB64
  return payload
}
