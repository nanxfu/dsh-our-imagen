/**
 * 出图任务相关路由：提交、单任务查询、任务列表、历史扫描。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源）。
 */

import { LIMITS, ROUTES } from '../../shared/contract.js'
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
        const limit = toInt(parseQuery(req, log).get('limit'), LIMITS.history.defaultLimit, 1, LIMITS.history.maxLimit)
        const items = await scanHistory(ctx, limit)
        sendJson(res, 200, { items })
      },
    },
  ]
}