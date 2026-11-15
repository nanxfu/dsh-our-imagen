/**
 * 内置 Kaggle OAuth 2.0 + PKCE 登录的门面（实现已按职责拆到 `lib/kaggle/oauth/`）。
 *
 * 本文件只做聚合 re-export，保证既有 `import ... from './kaggle-oauth.js'` 的调用方
 * （`index.js`、`tools/kaggle-login.mjs`、`test/kaggle-oauth.mjs`）零改动：
 *  - `./kaggle/oauth/pkce.js`           协议常量 / PKCE / 授权链接 / 授权码解析
 *  - `./kaggle/oauth/browser.js`        系统浏览器拉起与降级判定
 *  - `./kaggle/oauth/callback-server.js` 127.0.0.1:8000~9000 回环回调接收
 *  - `./kaggle/oauth/session.js`        登录状态机、令牌交换、凭据落盘
 */

export {
  OAUTH_CLIENT_ID,
  OAUTH_SCOPES,
  DEFAULT_REDIRECT_URI,
  quotePlus,
  codeChallengeOf,
  buildPkcePair,
  buildAuthorizeUrl,
  extractAuthorizationCode,
} from './kaggle/oauth/pkce.js'
export { canOpenBrowser, browserCommand, createDefaultBrowserOpener } from './kaggle/oauth/browser.js'
export { exchangeOAuthToken, createKaggleLogin } from './kaggle/oauth/session.js'
