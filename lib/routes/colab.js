/**
 * Colab Google OAuth 登录路由（契约 `ROUTES.colabLogin` / `ROUTES.colabLoginAction`）。
 *
 * 与 Kaggle 直连登录共用 `./oauth-login.js` 状态分发，响应额外附带脱敏后的
 * `auth: { authorized, email }` 供设置抽屉实时刷新授权状态。
 */

import { ROUTES } from '../../shared/contract.js'
import { createOAuthLoginRoute } from './oauth-login.js'

/**
 * @param {{ login: object, log: object }} deps
 */
export function createColabRoutes({ login, log }) {
  return createOAuthLoginRoute({
    name: 'colab-login',
    path: ROUTES.colabLogin.path,
    methods: [ROUTES.colabLogin.method, ROUTES.colabLoginAction.method],
    postMethod: ROUTES.colabLoginAction.method,
    login,
    extraPayload: () => (typeof login.authSummary === 'function' ? { auth: login.authSummary() } : {}),
    logPrefix: 'colab_login',
    log,
  })
}
