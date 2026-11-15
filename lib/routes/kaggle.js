/**
 * Kaggle 直连登录路由（试验特性，契约 `ROUTES.kaggleLogin` / `ROUTES.kaggleLoginAction`）。
 *
 * 注册形态：GET / POST 共用同一个 path，DSH webServer 的 exact 路由表以 path 为键、
 * 同一 path 不能注册两次，因此只注册一条路由，由 route-kit 的 method 数组做 405 判定，
 * handler 内按方法分发（与 `lib/routes/settings.js` 相同）。
 *
 * 约定（docs/SPEC.md §2.6）：
 *  - GET → `{ ok: true, login: LoginView }`；
 *  - POST body `{ action: 'start' | 'cancel' | 'submit-code', code? }` → 同形状；
 *  - 非法 action / 缺 code → 400 `invalid_request`；
 *  - 登录失败不抛 500，由登录管理器收敛为 `state = 'failed'`（`LoginView.message` 给可读原因）。
 *
 * 安全：请求体只读 `action` / `code`；`code` 不进日志、不进响应；日志只记 action 与状态。
 */

import { KAGGLE_LOGIN, ROUTES } from '../../shared/contract.js'
import { readJsonBody, sendError, sendJson } from '../http.js'
import { logText } from '../redact.js'

/**
 * @param {{ login: { view: () => object, start: () => Promise<object>,
 *   cancel: () => Promise<object>, submitCode: (code: string) => Promise<object> }, log: object }} deps
 */
export function createKaggleRoutes({ login, log }) {
  const payload = () => ({ ok: true, login: login.view() })

  async function readLogin(req, res) {
    sendJson(res, 200, payload())
  }

  async function handleAction(req, res) {
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      log.warn('kaggle_login_invalid_body', logText(error?.message ?? error, 200, { includeOAuthParams: true }))
      return sendError(res, 400, 'invalid_request', '请求体必须是合法 JSON 对象')
    }
    const action = typeof body?.action === 'string' ? body.action.trim() : ''
    if (!KAGGLE_LOGIN.actions.includes(action)) {
      return sendError(res, 400, 'invalid_request', `action 必须是 ${KAGGLE_LOGIN.actions.join(' / ')} 之一`)
    }

    try {
      if (action === 'start') {
        await login.start()
      } else if (action === 'cancel') {
        await login.cancel()
      } else {
        if (typeof body.code !== 'string' || !body.code.trim()) {
          return sendError(res, 400, 'invalid_request', 'submit-code 需要非空的 code')
        }
        await login.submitCode(body.code)
      }
    } catch (error) {
      // 管理器内部已把可预期失败收敛为 state=failed；这里只兜底，绝不把异常升级成 500。
      log.warn(`kaggle_login_action_failed action=${action} detail=${logText(error?.message ?? error)}`)
    }
    const view = login.view()
    log.info(`kaggle_login_action action=${action} state=${view.state} mode=${view.mode ?? 'none'}`)
    sendJson(res, 200, payload())
  }

  return [
    {
      name: 'kaggle-login',
      path: ROUTES.kaggleLogin.path,
      method: [ROUTES.kaggleLogin.method, ROUTES.kaggleLoginAction.method],
      handler(req, res) {
        if (req.method === ROUTES.kaggleLoginAction.method) return handleAction(req, res)
        return readLogin(req, res)
      },
    },
  ]
}
