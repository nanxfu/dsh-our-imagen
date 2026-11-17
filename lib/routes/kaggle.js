/**
 * Kaggle 直连登录路由（试验特性，契约 `ROUTES.kaggleLogin` / `ROUTES.kaggleLoginAction`）。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源），本文件只做装配，
 * 请求解析与状态分发复用 `./oauth-login.js`。
 */

import { ROUTES } from '../../shared/contract.js'
import { createOAuthLoginRoute } from './oauth-login.js'

/**
 * @param {{ login: object, log: object }} deps
 */
export function createKaggleRoutes({ login, log }) {
  return createOAuthLoginRoute({
    name: 'kaggle-login',
    path: ROUTES.kaggleLogin.path,
    methods: [ROUTES.kaggleLogin.method, ROUTES.kaggleLoginAction.method],
    postMethod: ROUTES.kaggleLoginAction.method,
    login,
    logPrefix: 'kaggle_login',
    log,
  })
}
