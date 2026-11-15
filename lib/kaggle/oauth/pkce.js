/**
 * Kaggle OAuth 2.0 授权请求构造：协议常量、PKCE、授权链接、授权码解析。
 *
 * 协议逐项对照本机 `kaggle` 2.2.5 / `kagglesdk` 0.1.38 源码：
 *  - 授权链接：`https://www.kaggle.com/api/v1/oauth2/authorize`，参数与 URL 编码方式对齐
 *    kagglesdk/kaggle_http_client.py:226-247（`urllib.parse.urlencode(..., quote_plus)`）；
 *  - PKCE：`code_verifier = secrets.token_urlsafe(64)`（86 字符），
 *    `code_challenge = base64.urlsafe_b64encode(sha256(verifier))`，带 `=` 补位（44 字符），
 *    方法固定 `S256` —— kagglesdk/kaggle_oauth.py:29-47；
 *  - state：`str(uuid.uuid4())`（kaggle_oauth.py:29-32）；浏览器模式 redirect_uri 为
 *    `http://localhost:<8000~9000 随机端口>`（kaggle_oauth.py:134-140），manual 模式用
 *    `https://www.kaggle.com/account/api/oauth/token`（kaggle_http_client.py:249-250）；
 *  - scopes 默认 `["resources.admin:*"]`（kaggle/api/kaggle_api_extended.py:1860-1869）。
 *
 * 从 `lib/kaggle-oauth.js` 拆出：这里只有纯函数与常量，不触碰网络、浏览器与文件系统。
 */

import { createHash, randomBytes } from 'node:crypto'

import { nonEmptyString } from './text.js'

const WEB_ORIGIN = 'https://www.kaggle.com'
export const OAUTH_CLIENT_ID = 'kagglesdk'
export const OAUTH_SCOPES = ['resources.admin:*']
/** manual 模式的 redirect_uri：授权完成后 Kaggle 会展示可复制的授权码（kaggle_http_client.py:249-250）。 */
export const DEFAULT_REDIRECT_URI = `${WEB_ORIGIN}/account/api/oauth/token`

/**
 * Python `urllib.parse.quote_plus` 的等价实现（kagglesdk 用它对授权参数编码）。
 *
 * `encodeURIComponent` 不会转义 `!'()*`，而 Python 会；`*` 出现在 `resources.admin:*` 里，
 * 因此必须显式补齐，保证与 CLI 发出的授权链接逐字一致。
 */
export function quotePlus(value) {
  return encodeURIComponent(String(value ?? ''))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

/**
 * PKCE code_challenge：`base64.urlsafe_b64encode(sha256(verifier))`，**保留 `=` 补位**。
 * （kagglesdk/kaggle_oauth.py:43-47 没有 rstrip('=')。）
 */
export function codeChallengeOf(verifier) {
  return `${createHash('sha256').update(String(verifier ?? ''), 'utf8').digest('base64url')}=`
}

/**
 * 生成 PKCE 对：verifier 用 64 个随机字节的 urlsafe base64（86 字符，等价
 * `secrets.token_urlsafe(64)`），challenge 为 S256 的 base64url + `=`。
 */
export function buildPkcePair() {
  const verifier = randomBytes(64).toString('base64url')
  return { verifier, challenge: codeChallengeOf(verifier) }
}

/**
 * 构造 Kaggle 授权链接（参数顺序与编码对齐 kagglesdk.build_start_oauth_url）。
 *
 * 实测（Python 侧同参输出）：
 * `https://www.kaggle.com/api/v1/oauth2/authorize?response_type=code&client_id=kagglesdk
 *  &redirect_uri=http%3A%2F%2Flocalhost%3A8123&scope=resources.admin%3A%2A&state=...&
 *  code_challenge=...%3D&code_challenge_method=S256&response_mode=query`
 *
 * @param {{ redirectUri: string, state: string, codeChallenge: string,
 *           scopes?: string[], clientId?: string }} input
 */
export function buildAuthorizeUrl({ redirectUri, state, codeChallenge, scopes = OAUTH_SCOPES, clientId = OAUTH_CLIENT_ID } = {}) {
  const scope = (Array.isArray(scopes) ? scopes : [scopes]).filter((item) => typeof item === 'string' && item.trim()).join(' ')
  const params = [
    ['response_type', 'code'],
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
    ['scope', scope],
    ['state', state],
    ['code_challenge', codeChallenge],
    ['code_challenge_method', 'S256'],
    ['response_mode', 'query'],
  ]
  return `${WEB_ORIGIN}/api/v1/oauth2/authorize?${params.map(([name, value]) => `${name}=${quotePlus(value)}`).join('&')}`
}

/** 把用户粘贴的内容解析成授权码：支持单纯 code，也支持整段回跳 URL / `code=...`。 */
export function extractAuthorizationCode(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  if (text.length > 4096) return null
  if (/[?&]code=|^code=/.test(text)) {
    try {
      const url = new URL(text, 'http://localhost')
      const fromQuery = nonEmptyString(url.searchParams.get('code'))
      if (fromQuery) return fromQuery
    } catch {}
    const match = text.match(/(?:^|[?&])code=([^&\s]+)/)
    if (match) {
      try {
        return nonEmptyString(decodeURIComponent(match[1]))
      } catch {
        return nonEmptyString(match[1])
      }
    }
  }
  return nonEmptyString(text)
}
