/**
 * 出图任务相关路由：提交、单任务查询、取消、任务列表、历史扫描。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源）。
 */

import { JOB_CANCEL, LIMITS, ROUTES } from '../../shared/contract.js'
import { readJsonBody, sendError, sendJson } from '../http.js'
import { scanHistory } from '../output.js'
import { parseQuery, toInt } from '../route-kit.js'

/**
 * @param {{ ctx: object, queue: object, log: object }} deps
 */
export function createJobRoutes({ ctx, queue, log }) {
  return [
    {
      name: 'generate',
      path: ROUTES.generate.path,
      method: ROUTES.generate.method,
      async handler(req, res) {
        // 出图主路径：坏 JSON 必须明确报 400，不像其余路由那样用兜底值继续。
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendError(res, 400, 'invalid_body', String(error?.message ?? error))
        }
        const result = queue.submit(body)
        if (!result.ok) return sendError(res, 400, result.code, result.message)
        const waitSeconds = Number(body.waitSeconds) || 0
        const job = waitSeconds > 0 ? await queue.waitFor(result.job.id, waitSeconds) : result.job
        sendJson(res, 200, job)
      },
    },
    {
      name: 'job',
      path: ROUTES.job.path,
      method: ROUTES.job.method,
      handler(req, res) {
        const id = parseQuery(req, log).get('id') ?? ''
        const job = queue.get(id)
        if (!job) return sendError(res, 404, 'not_found', '任务不存在')
        sendJson(res, 200, job)
      },
    },
    {
      // 取消任务：queued / waiting-session 立即出队失效，running 合作式停止。
      // 取消语义（disposition 取值域）由契约 JOB_CANCEL 定义，这里只做透传与校验。
      name: 'job-cancel',
      path: ROUTES.jobCancel.path,
      method: ROUTES.jobCancel.method,
      async handler(req, res) {
        // 与 /generate 一致：坏 JSON 明确报 400 invalid_body，不静默当成缺失参数。
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          return sendError(res, 400, 'invalid_body', String(error?.message ?? error))
        }
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        const result = queue.cancel(id)
        if (!result.ok) return sendError(res, 404, result.code, '任务不存在')
        // disposition 不在契约取值域内说明队列实现漂移；按 internal_error 报出，不新增错误码。
        if (!JOB_CANCEL.dispositions.includes(result.disposition)) {
          return sendError(res, 500, 'internal_error', '取消结果缺少 disposition')
        }
        sendJson(res, 200, { ok: true, job: result.job, disposition: result.disposition })
      },
    },
    {
      name: 'jobs',
      path: ROUTES.jobs.path,
      method: ROUTES.jobs.method,
      handler(req, res) {
        const limit = toInt(parseQuery(req, log).get('limit'), LIMITS.jobs.defaultLimit, 1, LIMITS.jobs.maxLimit)
        sendJson(res, 200, { jobs: queue.list(limit), queue: queue.queueStats() })
      },
    },
    {
      name: 'history',
      path: ROUTES.history.path,
      method: ROUTES.history.method,
      async handler(req, res) {
        const query = parseQuery(req, log)
        const limit = toInt(query.get('limit'), LIMITS.history.defaultLimit, 1, LIMITS.history.maxLimit)
        // offset 是非负整数；非法（非数字/负数）一律按 0 处理。
        const offset = toInt(query.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
        const page = await scanHistory(ctx, { limit, offset })
        // items 保持数组（旧客户端只读 items，向后兼容）；limit/offset/hasMore 供分页客户端使用。
        sendJson(res, 200, { items: page.items, limit, offset, hasMore: page.hasMore })
      },
    },
  ]
}
