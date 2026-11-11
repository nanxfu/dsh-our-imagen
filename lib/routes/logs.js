/**
 * 远端运行日志路由：把 daemon 的日志环（`GET /logs?since=N`）透传给工作台日志抽屉，
 * 并附带 Host 本地滚动日志的尾部（`hostLines`），会话未启动时也能拿到最近的状态时间线。
 *
 * 约定：
 *  - 始终返回 HTTP 200，用响应体的 `ok` 表达远端可用性：日志拉不到是常态（会话未启动、
 *    隧道刚断、daemon 协议漂移），客户端不该把它当网络故障弹全局错误；
 *  - 游标 `since` / `next` 原样透传，客户端按 `next` 累加，避免重复或丢尾；
 *  - `hostLines` 是固定长度的尾部快照（最近 120 行，已脱敏），成功、session_absent、
 *    异常三个分支都带；读取失败按 [] 降级，不影响远端字段的语义与取值；
 *  - 路径与方法取自 `shared/contract.js` 的 ROUTES，本文件不写字面量。
 */

import { ROUTES, TIMEOUTS } from '../../shared/contract.js'
import { sendJson } from '../http.js'
import { readHostLogTail } from '../log.js'
import { requestLogs } from '../remote.js'
import { parseQuery } from '../route-kit.js'

/** Host 本地日志固定返回的行数（客户端 logic/logs.js 的 HOST_LOG_LINE_LIMIT 与之对齐）。 */
const HOST_LOG_TAIL_LIMIT = 120

/** 游标只接受非负整数；非法值按 0 处理（从缓冲起点拉取）。 */
function readSince(query) {
  const value = Number(query.get('since'))
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 读取 Host 本地日志尾部：任何异常都按 [] 降级，路由绝不因它失败。 */
async function readHostLines(ctx, log) {
  try {
    const lines = await readHostLogTail(ctx, HOST_LOG_TAIL_LIMIT)
    if (!Array.isArray(lines)) return []
    return lines.filter((line) => typeof line === 'string').slice(-HOST_LOG_TAIL_LIMIT)
  } catch (error) {
    log.debug('读取 Host 本地日志失败（按空数组降级）', error?.message ?? error)
    return []
  }
}

/**
 * @param {{ session: object, log: object, ctx?: object }} deps
 *   ctx 用于定位 `<workspace>/.imagen/logs/host.log`；缺省时 hostLines 为空数组。
 */
export function createLogRoutes({ session, log, ctx = null }) {
  return [
    {
      name: 'logs',
      path: ROUTES.logs.path,
      method: ROUTES.logs.method,
      async handler(req, res) {
        const since = readSince(parseQuery(req, log))
        // 先取 Host 日志：它不依赖远端会话，三个响应分支都要带。
        const hostLines = await readHostLines(ctx, log)
        const { endpoint, token } = session.connection()
        if (!endpoint || !token) {
          sendJson(res, 200, {
            ok: false,
            code: 'session_absent',
            message: '云端会话未启动，暂无远端日志',
            since,
            next: since,
            lines: [],
            hostLines,
          })
          return
        }

        try {
          const payload = await requestLogs(endpoint, token, since, TIMEOUTS.remoteLogsMs, session.ctx)
          const lines = Array.isArray(payload?.lines)
            ? payload.lines.filter((line) => typeof line === 'string')
            : []
          const next = Number.isFinite(payload?.next) ? payload.next : since + lines.length
          sendJson(res, 200, { ok: true, since, next, lines, hostLines })
        } catch (error) {
          // 隧道瞬时抖动也会走到这里：日志抽屉降级展示原因，不影响主流程。
          log.debug('拉取远端日志失败（日志抽屉降级展示）', error?.message ?? error)
          sendJson(res, 200, {
            ok: false,
            code: 'logs_unavailable',
            message: String(error?.message ?? '远端日志暂时不可用').slice(0, 200),
            since,
            next: since,
            lines: [],
            hostLines,
          })
        }
      },
    },
  ]
}
