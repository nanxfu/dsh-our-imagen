/**
 * OAuth 登录路由工厂（Kaggle 直连登录与 Colab Google OAuth 登录共用）。
 *
 * 约定（docs/SPEC.md §2.6）：
 *  - GET → `{ ok: true, login: LoginView, ...extraPayload }`；
 *  - POST body `{ action: 'start' | 'cancel' | 'submit-code', code? }` → 同形状；
 *  - 非法 action / 缺 code → 400 `invalid_request`；
 *  - 登录失败由管理器收敛为 `state = 'failed'`，绝不抛 500。
 */

import { KAGGLE_LOGIN } from '../../shared/contract.js'
import { readJsonBody, sendError, sendJson } from '../http.js'
import { logText } from '../redact.js'

/**
 * @param {{
 *   name: string,
 *   path: string,
 *   methods: string[],
 *   getMethod: string,
 *   postMethod: string,
 *   login: { view: () => object, start: () => Promise<object>, cancel: () => Promise<object>, submitCode: (code: string) => Promise<object> },
 *   extraPayload?: () => object,
 *   logPrefix: string,
 *   log: object,
 * }} deps
 */
export function createOAuthLoginRoute({
  name,
  path,
  methods,
  postMethod,
  login,
  extraPayload = null,
  logPrefix,
  log,
}) {
  const payload = () => ({
    ok: true,
    login: login.view(),
    ...(typeof extraPayload === 'function' ? extraPayload() : null),
  })

  async function readLogin(req, res) {
    sendJson(res, 200, payload())
  }

  async function handleAction(req, res) {
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      log.warn(`${logPrefix}_invalid_body`, logText(error?.message ?? error, 200, { includeOAuthParams: true }))
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
      log.warn(`${logPrefix}_action_failed action=${action} detail=${logText(error?.message ?? error)}`)
    }
    const view = login.view()
    log.info(`${logPrefix}_action action=${action} state=${view.state} mode=${view.mode ?? 'none'}`)
    sendJson(res, 200, payload())
  }

  return [
    {
      name,
      path,
      method: methods,
      handler(req, res) {
        if (req.method === postMethod) return handleAction(req, res)
        return readLogin(req, res)
      },
    },
  ]
}
