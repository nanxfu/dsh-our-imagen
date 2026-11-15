/**
 * 内置 Kaggle OAuth 2.0 + PKCE 登录管理器（试验特性，`kaggleTransport = 'direct'`）。
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
 *  - scopes 默认 `["resources.admin:*"]`（kaggle/api/kaggle_api_extended.py:1860-1869）；
 *  - 收码换 token：`POST /v1/security.OAuthService/ExchangeOAuthToken`，body
 *    `{code, codeVerifier, grantType: "authorization_code"}`（security/types/oauth_service.py:1111-1119）；
 *  - 校验并取用户名：`POST /v1/security.OAuthService/IntrospectToken`（kaggle_oauth.py:190-200、
 *    kaggle_api_extended.py:1604-1617）；
 *  - 凭据落盘：`~/.kaggle/credentials.json`，字段与顺序对齐 kaggle_creds.py:70-95（目录 0700 / 文件 0600、
 *    同目录临时文件 + rename 原子写；默认有效期 12 小时）。
 *
 * 安全约束：code / code_verifier / access_token / refresh_token 绝不进入日志、错误文本与对外视图；
 * 对外 `view()` 只有契约 `KAGGLE_LOGIN` 的字段。
 */

import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { homedir } from 'node:os'

import { KAGGLE_LOGIN, TIMEOUTS } from '../shared/contract.js'
import { introspectAccessToken, kaggleApiRequest, kagglePaths, writeCredentialsFile } from './kaggle-direct.js'
import { createLogger } from './log.js'
import { logText } from './redact.js'

const WEB_ORIGIN = 'https://www.kaggle.com'
const OAUTH_CLIENT_ID = 'kagglesdk'
const OAUTH_SCOPES = ['resources.admin:*']
/** manual 模式的 redirect_uri：授权完成后 Kaggle 会展示可复制的授权码（kaggle_http_client.py:249-250）。 */
const DEFAULT_REDIRECT_URI = `${WEB_ORIGIN}/account/api/oauth/token`
/** 与 kaggle_oauth.py:138 的 random.randint(8000, 9000) 对齐。 */
const CALLBACK_PORT_MIN = 8000
const CALLBACK_PORT_MAX = 9000
/** 端口被占用时的重试次数（每次重新随机）。 */
const CALLBACK_PORT_ATTEMPTS = 20
/** 默认 access token 有效期，与 kaggle_creds.py:15 对齐。 */
const DEFAULT_EXPIRATION_SEC = 12 * 60 * 60
const EXCHANGE_TIMEOUT_MS = TIMEOUTS.cliMs
/** 拉起浏览器的判定超时：spawn 事件不来时不阻塞登录流程（降级 manual）。 */
const BROWSER_OPEN_TIMEOUT_MS = 1500

/**
 * 消息脱敏：对外 message / 日志里不出现 token、授权码、带 query 的 URL 与用户目录。
 */
function sanitizeMessage(value, max = 300) {
  return logText(value, max, { includeOAuthParams: true })
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

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

/**
 * 用授权码换 token（`security.OAuthService.ExchangeOAuthToken`）。
 *
 * @returns {Promise<{ ok: true, accessToken: string, refreshToken: string | null,
 *   expiresIn: number, username: string | null } | { ok: false, errorCode: string, detail: string }>}
 */
export async function exchangeOAuthToken(ctx, { code, verifier, timeoutMs = EXCHANGE_TIMEOUT_MS } = {}) {
  const normalizedCode = nonEmptyString(code)
  const normalizedVerifier = nonEmptyString(verifier)
  if (!normalizedCode || !normalizedVerifier) {
    return { ok: false, errorCode: 'unknown', detail: '授权码或 code_verifier 缺失' }
  }
  const result = await kaggleApiRequest(ctx, {
    endpoint: '/v1/security.OAuthService/ExchangeOAuthToken',
    // 字段顺序与 ExchangeOAuthTokenRequest.to_dict() 一致（oauth_service.py:1111-1119）。
    body: { code: normalizedCode, codeVerifier: normalizedVerifier, grantType: 'authorization_code' },
    timeoutMs,
  })
  if (!result.ok) return { ok: false, errorCode: result.errorCode, detail: result.detail }
  const accessToken = nonEmptyString(result.json?.accessToken)
  if (!accessToken) return { ok: false, errorCode: 'unknown', detail: '令牌响应缺少 access_token' }
  const expiresIn = Number(result.json?.expiresIn)
  return {
    ok: true,
    accessToken,
    refreshToken: nonEmptyString(result.json?.refreshToken),
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRATION_SEC,
    username: nonEmptyString(result.json?.username),
  }
}

/** 判断当前环境是否值得尝试拉起浏览器（对齐 kagglesdk `_can_open_browser`，kaggle_oauth.py:108-116）。 */
export function canOpenBrowser({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32' || platform === 'darwin') return true
  if (platform === 'linux') return Boolean(nonEmptyString(env?.DISPLAY) || nonEmptyString(env?.WAYLAND_DISPLAY))
  return false
}

/**
 * 各平台打开浏览器的命令（可注入，便于测试与无头环境降级）。
 *
 * Windows 不走 `cmd.exe /c start`：Node 的 spawn 只对含空格的参数加引号，授权链接里没有空格，
 * 于是链接中的 `&` 会被 cmd 当成命令分隔符把 URL 截断——Kaggle 侧表现为
 * `400 Must specify State`（实战踩坑）。`rundll32 url.dll,FileProtocolHandler` 把 URL 当普通
 * 参数交给系统默认浏览器，不经过 cmd 解析，跨 shell 特殊字符安全。
 */
export function browserCommand(platform, url) {
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', String(url)] }
  }
  if (platform === 'darwin') return { command: 'open', args: [String(url)] }
  return { command: 'xdg-open', args: [String(url)] }
}

/**
 * 默认浏览器打开器：spawn 系统命令，`spawn` 事件到来即视为成功（不等待浏览器进程退出）。
 * 失败（命令不存在 / spawn 超时）返回 false，由登录管理器降级为 manual 模式。
 *
 * @param {{ platform?: string, spawnFn?: Function, log?: object }} [options]
 * @returns {(url: string) => Promise<boolean>}
 */
export function createDefaultBrowserOpener({ platform = process.platform, spawnFn = spawn, log = createLogger({ scope: 'kaggle-login' }) } = {}) {
  return function openBrowser(url) {
    return new Promise((resolvePromise) => {
      let settled = false
      let timer = null
      const done = (value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolvePromise(value)
      }
      let child
      try {
        const { command, args } = browserCommand(platform, url)
        child = spawnFn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' })
      } catch (error) {
        log.debug('打开浏览器失败（spawn 抛错），降级 manual', sanitizeMessage(error?.message ?? error))
        return done(false)
      }
      if (!child || typeof child.once !== 'function') return done(false)
      timer = setTimeout(() => done(false), BROWSER_OPEN_TIMEOUT_MS)
      timer.unref?.()
      child.once('error', (error) => {
        log.debug('打开浏览器失败（进程错误），降级 manual', sanitizeMessage(error?.message ?? error))
        done(false)
      })
      child.once('spawn', () => {
        try {
          child.unref?.()
        } catch {}
        done(true)
      })
    })
  }
}

function createIdleView() {
  return { state: 'idle', mode: null, url: null, message: null, username: null, startedAt: null, finishedAt: null }
}

const CALLBACK_SUCCESS_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Kaggle 授权完成</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">' +
  '<h1>授权已完成</h1><p>正在换取访问令牌，请回到工作台查看登录结果，本窗口可以关闭。</p></body></html>'
const CALLBACK_FAILED_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Kaggle 授权失败</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">' +
  '<h1>授权失败</h1><p>请回到工作台查看原因并重新发起登录，本窗口可以关闭。</p></body></html>'

/**
 * 创建单实例登录管理器。
 *
 * @param {{
 *   ctx?: object, log?: object, homeDir?: string, env?: object, credentialsPath?: string | null,
 *   openBrowser?: (url: string) => Promise<boolean>, platform?: string,
 *   now?: () => number, timeoutMs?: number, pickPort?: () => number,
 * }} [options]
 * @returns {{
 *   view: () => object,
 *   start: (input?: { mode?: 'browser' | 'manual' }) => Promise<object>,
 *   cancel: () => Promise<object>,
 *   submitCode: (code: string) => Promise<object>,
 *   dispose: () => Promise<void>,
 *   credentialsPath: () => string,
 * }}
 */
export function createKaggleLogin({
  ctx = null,
  log = createLogger({ scope: 'kaggle-login' }),
  homeDir = homedir(),
  env = process.env,
  credentialsPath = null,
  platform = process.platform,
  openBrowser = createDefaultBrowserOpener({ platform, log }),
  now = Date.now,
  timeoutMs = KAGGLE_LOGIN.timeoutMs,
  pickPort = null,
} = {}) {
  const paths = kagglePaths({ homeDir, credentialsPath, env })
  const viewState = createIdleView()
  /** 当前尝试：verifier / state / 回环服务 / 定时器。终态后置空。 */
  let attempt = null
  /** 代次：cancel / 超时 / 成功后递增，过期的异步回调一律丢弃。 */
  let generation = 0

  function isoNow() {
    return new Date(now()).toISOString()
  }

  function view() {
    return {
      state: viewState.state,
      mode: viewState.mode,
      url: viewState.url,
      message: viewState.message,
      username: viewState.username,
      startedAt: viewState.startedAt,
      finishedAt: viewState.finishedAt,
    }
  }

  function portCandidates() {
    if (typeof pickPort === 'function') {
      return Array.from({ length: CALLBACK_PORT_ATTEMPTS }, () => {
        const value = Number(pickPort())
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
      })
    }
    return Array.from({ length: CALLBACK_PORT_ATTEMPTS }, () =>
      CALLBACK_PORT_MIN + Math.floor(Math.random() * (CALLBACK_PORT_MAX - CALLBACK_PORT_MIN + 1)),
    )
  }

  function listenOnce(server, port) {
    return new Promise((resolvePromise) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolvePromise(value)
      }
      const onError = () => done(false)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        // 监听成功后的 error（如客户端异常断开）不应把进程打崩。
        server.on('error', () => {})
        done(true)
      })
    })
  }

  function closeServer(server) {
    return new Promise((resolvePromise) => {
      if (!server) return resolvePromise()
      let settled = false
      let timer = null
      const done = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolvePromise()
      }
      try {
        server.close(() => done())
        // 没有活动连接时 close 回调立即触发；有连接时最多等 500ms，超时强关剩余连接。
        timer = setTimeout(() => {
          server.closeAllConnections?.()
          done()
        }, 500)
        timer.unref?.()
      } catch {
        done()
      }
    })
  }

  async function openCallbackServer(gen) {
    for (const port of portCandidates()) {
      const server = createServer((req, res) => {
        try {
          handleCallback(req, res, gen)
        } catch (error) {
          // 回调处理自身异常也必须收敛，不能挂在半路。
          sendHtml(res, 400, CALLBACK_FAILED_HTML)
          settleFailed(gen, `处理授权回调失败：${sanitizeMessage(error?.message ?? error)}`)
        }
      })
      const ok = await listenOnce(server, port)
      if (ok) {
        const address = server.address()
        return { server, port: typeof address === 'object' && address ? address.port : port }
      }
      await closeServer(server)
    }
    return null
  }

  function clearAttemptTimer() {
    if (attempt?.timer) {
      clearTimeout(attempt.timer)
      attempt.timer = null
    }
  }

  async function cleanupAttempt() {
    clearAttemptTimer()
    const server = attempt?.server ?? null
    if (attempt) attempt.server = null
    if (server) await closeServer(server)
  }

  /** 收敛为失败态（同一代次只允许一次）。 */
  function settleFailed(gen, message) {
    if (gen !== generation) return
    generation += 1
    void cleanupAttempt()
    viewState.state = 'failed'
    viewState.url = null
    viewState.message = sanitizeMessage(message || '登录失败，请重试')
    viewState.finishedAt = isoNow()
    viewState.username = null
    log.warn(`kaggle_login state=failed mode=${viewState.mode ?? 'none'} reason=${viewState.message}`)
  }

  /** 收敛为成功态并写入 credentials.json。 */
  function settleDone(gen, { username }) {
    if (gen !== generation) return false
    generation += 1
    void cleanupAttempt()
    viewState.state = 'done'
    viewState.url = null
    viewState.message = null
    viewState.username = username
    viewState.finishedAt = isoNow()
    log.info(`kaggle_login state=done mode=${viewState.mode ?? 'none'}`)
    return true
  }

  function respondCallback(gen, code, codeVerifier) {
    clearAttemptTimer()
    void exchangeAndSave(gen, code, codeVerifier).catch((error) => {
      settleFailed(gen, `登录失败：${sanitizeMessage(error?.message ?? error)}`)
    })
  }

  async function exchangeAndSave(gen, code, verifier) {
    const exchanged = await exchangeOAuthToken(ctx, { code, verifier, timeoutMs: EXCHANGE_TIMEOUT_MS })
    if (gen !== generation) return
    if (!exchanged.ok) return settleFailed(gen, `换取访问令牌失败：${exchanged.detail}`)
    const introspected = await introspectAccessToken(ctx, exchanged.accessToken, { timeoutMs: EXCHANGE_TIMEOUT_MS })
    if (gen !== generation) return
    if (!introspected.ok || !introspected.username) {
      return settleFailed(gen, `访问令牌校验失败：${introspected.detail ?? '令牌未激活'}`)
    }
    if (!exchanged.refreshToken) return settleFailed(gen, '授权响应缺少 refresh_token，无法保存登录状态')
    try {
      await writeCredentialsFile(paths.credentials, {
        refreshToken: exchanged.refreshToken,
        accessToken: exchanged.accessToken,
        accessTokenExpiration: now() + exchanged.expiresIn * 1000,
        username: introspected.username,
        scopes: [...OAUTH_SCOPES],
      })
    } catch (error) {
      if (gen !== generation) return
      return settleFailed(gen, `写入凭据失败：${sanitizeMessage(error?.message ?? error)}`)
    }
    if (gen !== generation) return
    settleDone(gen, { username: introspected.username })
  }

  function sendHtml(res, status, html) {
    try {
      const body = Buffer.from(html, 'utf8')
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch {}
  }

  /**
   * 本地回环回调：校验 state、回 HTML、收码换 token。
   * 任何回调请求都会先关闭回环服务（与 kaggle_oauth.py 的 finally stop_server 一致）。
   */
  function handleCallback(req, res, gen) {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      return
    }
    if (url.pathname === '/favicon.ico') {
      try {
        res.writeHead(204)
        res.end()
      } catch {}
      return
    }
    const code = nonEmptyString(url.searchParams.get('code'))
    const receivedState = nonEmptyString(url.searchParams.get('state'))
    const error = nonEmptyString(url.searchParams.get('error'))
    const errorDescription = nonEmptyString(url.searchParams.get('error_description'))
    const pendingAttempt = attempt
    clearAttemptTimer()
    const server = pendingAttempt?.server
    if (server) {
      pendingAttempt.server = null
      void closeServer(server)
    }
    if (gen !== generation || viewState.state !== 'pending' || !pendingAttempt) {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      return
    }
    // 同一个尝试只接受一次有效回调：防止并发请求重复触发换 token。
    if (pendingAttempt.callbackHandled) {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      return
    }
    if (error) {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      settleFailed(gen, describeOAuthError(error, errorDescription))
      return
    }
    if (!code || !receivedState) {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      settleFailed(gen, '授权回调缺少必要参数，请重新发起登录')
      return
    }
    if (receivedState !== pendingAttempt.stateToken) {
      // 不回显期望值 / 收到的 state，避免把 CSRF 令牌写进页面或日志。
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      settleFailed(gen, '授权回调校验失败（state 不匹配），请重新发起登录')
      return
    }
    sendHtml(res, 200, CALLBACK_SUCCESS_HTML)
    pendingAttempt.callbackHandled = true
    respondCallback(gen, code, pendingAttempt.verifier)
  }

  async function start({ mode } = {}) {
    // 已有进行中的登录：直接返回当前态（契约规定 start 幂等）。
    if (viewState.state === 'pending') return view()
    const requestedMode = KAGGLE_LOGIN.modes.includes(mode) ? mode : null
    const gen = ++generation
    const pkce = buildPkcePair()
    attempt = {
      generation: gen,
      mode: requestedMode ?? 'browser',
      verifier: pkce.verifier,
      challenge: pkce.challenge,
      stateToken: randomUUID(),
      redirectUri: DEFAULT_REDIRECT_URI,
      authorizeUrl: null,
      server: null,
      timer: null,
    }
    viewState.state = 'pending'
    viewState.mode = attempt.mode
    viewState.url = null
    viewState.message = null
    viewState.username = null
    viewState.startedAt = isoNow()
    viewState.finishedAt = null

    let modeNow = requestedMode
    if (!modeNow) modeNow = canOpenBrowser({ platform, env }) ? 'browser' : 'manual'

    if (modeNow === 'browser') {
      const listening = await openCallbackServer(gen)
      if (gen !== generation) return view()
      if (listening) {
        attempt.server = listening.server
        attempt.redirectUri = `http://localhost:${listening.port}`
      } else {
        modeNow = 'manual'
        log.info('kaggle_login_fallback reason=callback_port_unavailable')
      }
    }
    attempt.mode = modeNow
    viewState.mode = modeNow
    if (modeNow === 'manual') attempt.redirectUri = DEFAULT_REDIRECT_URI
    const authorizeUrl = buildAuthorizeUrl({
      redirectUri: attempt.redirectUri,
      state: attempt.stateToken,
      codeChallenge: pkce.challenge,
    })
    attempt.authorizeUrl = authorizeUrl
    if (modeNow === 'manual') viewState.url = authorizeUrl

    // 等待授权的总时限：超时收敛为 failed，用户可重新发起（契约 KAGGLE_LOGIN.timeoutMs）。
    attempt.timer = setTimeout(() => {
      if (gen !== generation || viewState.state !== 'pending') return
      settleFailed(gen, '等待授权超时，请重新发起登录')
    }, timeoutMs)
    attempt.timer.unref?.()

    if (modeNow === 'browser') {
      let opened = false
      try {
        opened = await openBrowser(authorizeUrl)
      } catch {
        opened = false
      }
      if (gen !== generation) return view()
      if (!opened) {
        // 浏览器打不开：降级 manual，释放回环端口，改用默认 redirect 重新生成授权链接。
        const server = attempt.server ?? null
        attempt.server = null
        if (server) await closeServer(server)
        attempt.redirectUri = DEFAULT_REDIRECT_URI
        attempt.mode = 'manual'
        viewState.mode = 'manual'
        attempt.authorizeUrl = buildAuthorizeUrl({
          redirectUri: DEFAULT_REDIRECT_URI,
          state: attempt.stateToken,
          codeChallenge: pkce.challenge,
        })
        viewState.url = attempt.authorizeUrl
        log.info('kaggle_login_fallback reason=browser_open_failed')
      }
    }
    log.info(`kaggle_login_start mode=${viewState.mode}`)
    return view()
  }

  async function cancel() {
    if (viewState.state !== 'pending') return view()
    generation += 1
    await cleanupAttempt()
    attempt = null
    viewState.state = 'cancelled'
    viewState.url = null
    viewState.message = null
    viewState.username = null
    viewState.finishedAt = isoNow()
    log.info('kaggle_login state=cancelled')
    return view()
  }

  async function submitCode(rawCode) {
    const code = extractAuthorizationCode(rawCode)
    if (!code) return view()
    if (viewState.state !== 'pending' || !attempt) return view()
    const gen = generation
    const verifier = attempt.verifier
    clearAttemptTimer()
    const server = attempt.server ?? null
    attempt.server = null
    if (server) await closeServer(server)
    if (gen !== generation) return view()
    await exchangeAndSave(gen, code, verifier)
    return view()
  }

  async function dispose() {
    if (viewState.state === 'pending') {
      await cancel()
      return
    }
    await cleanupAttempt()
    attempt = null
  }

  return {
    view,
    start,
    cancel,
    submitCode,
    dispose,
    credentialsPath: () => paths.credentials,
  }
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

/** OAuth 错误参数转可读原因（不回显 code / state）。 */
function describeOAuthError(error, description) {
  const code = String(error ?? '').toLowerCase()
  const base =
    code === 'access_denied'
      ? '您取消了 Kaggle 授权'
      : code === 'invalid_scope'
        ? 'Kaggle 授权范围不被接受，请重试'
        : code === 'server_error' || code === 'temporarily_unavailable'
          ? 'Kaggle 授权服务暂时不可用，请稍后重试'
          : `Kaggle 授权失败（${code}）`
  return description ? `${base}：${description}` : base
}

export { OAUTH_CLIENT_ID, OAUTH_SCOPES, DEFAULT_REDIRECT_URI }

