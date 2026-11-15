/**
 * 图生图参考图的落盘读取（工作区 `imagen-output/` 内作品 → base64）。
 *
 * 本模块负责：执行阶段把 `job.reference` 解析成远端载荷 `{ image_b64, strength }`。
 * 画廊路径来源必须经 `resolveOutputPath` 校验（只允许 `imagen-output/` 内、拒绝软链接逃逸），
 * 读取后再做体积与 PNG/JPEG 魔数校验；失败抛带 code 的错误让任务带可读原因失败。
 *
 * 从 `lib/jobs.js` 拆出：这是队列里唯一需要读盘 + 做路径安全校验的部分，
 * 与队列状态机无耦合，单独成文件便于审计「路径越界」这类安全逻辑。
 *
 * 注意：日志器由调用方注入（队列传入 `scope: 'jobs'` 的实例），
 * 保持拆分前的日志 scope 与文案逐字不变。
 */

import { readFile } from 'node:fs/promises'

import { LIMITS } from '../../shared/contract.js'
import { resolveOutputPath } from '../paths.js'
import { logText } from '../redact.js'
import { REFERENCE_MAGIC, hasMagic } from './validator.js'

/**
 * 把任务里的参考图解析成远端载荷：`{ image_b64, strength }`；没有参考图返回 null。
 *
 * @param {object} ctx 插件上下文（用于定位工作区）
 * @param {{ path?: string|null, imageB64?: string|null, strength: number } | null} reference
 * @param {{ jobId?: string, log: object }} deps jobId 只用于日志；log 必须由调用方注入
 * @returns {Promise<{ image_b64: string, strength: number } | null>}
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
  return { image_b64: imageB64, strength: reference.strength }
}
