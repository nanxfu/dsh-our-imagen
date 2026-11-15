/**
 * Kaggle 登录状态机（试验特性，`kaggleTransport = 'direct'`）：收码换 token、落盘凭据。
 *
 * 协议逐项对照本机 `kaggle` 2.2.5 / `kagglesdk` 0.1.38 源码：
 *  - 收码换 token：`POST /v1/security.OAuthService/ExchangeOAuthToken`，body
 *    `{code, codeVerifier, grantType: "authorization_code"}`（security/types/oauth_service.py:1111-1119）；
 *  - 校验并取用户名：`POST /v1/security.OAuthService/IntrospectToken`（kaggle_oauth.py:190-200、
 *    kaggle_api_extended.py:1604-1617）；
 *  - 凭据落盘：`~/.kaggle/credentials.json`，字段与顺序对齐 kaggle_creds.py:70-95（目录 0700 / 文件 0600、
 *    同目录临时文件 + rename 原子写；默认有效期 12 小时）。
 *
 * 安全约束：code / code_verifier / access_token / refresh_token 绝不进入日志、错误文本与对外视图；
 * 对外 `view()` 只有契约 `KAGGLE_LOGIN` 的字段。
 *
 * 从 `lib/kaggle-oauth.js` 拆出：授权请求构造在 `./pkce.js`，浏览器拉起在 `./browser.js`，
 * 回环回调接收在 `./callback-server.js`；本文件只保留状态机与令牌交换。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

import { KAGGLE_LOGIN, TIMEOUTS } from '../../../shared/contract.js'
import { introspectAccessToken, kaggleApiRequest, kagglePaths, writeCredentialsFile } from '../../kaggle-client.js'
import { createLogger } from '../../log.js'
import { canOpenBrowser, createDefaultBrowserOpener } from './browser.js'
import {
  CALLBACK_FAILED_HTML,
  CALLBACK_SUCCESS_HTML,
  closeServer,
  openCallbackServer,
  parseCallback,
  sendHtml,
} from './callback-server.js'
import {
  DEFAULT_REDIRECT_URI,
  OAUTH_SCOPES,
  buildAuthorizeUrl,
  buildPkcePair,
  extractAuthorizationCode,
} from './pkce.js'
import { nonEmptyString, sanitizeMessage } from './text.js'

/** 默认 access token 有效期，与 kaggle_creds.py:15 对齐。 */
const DEFAULT_EXPIRATION_SEC = 12 * 60 * 60
const EXCHANGE_TIMEOUT_MS = TIMEOUTS.cliMs

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

function createIdleView() {
  return { state: 'idle', mode: null, url: null, message: null, username: null, startedAt: null, finishedAt: null }
}

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

  /**
   * 本地回环回调：校验 state、回 HTML、收码换 token。
   * 任何回调请求都会先关闭回环服务（与 kaggle_oauth.py 的 finally stop_server 一致）。
   */
  function handleCallback(req, res, gen) {
    const parsed = parseCallback(req)
    if (parsed.kind === 'favicon') {
      try {
        res.writeHead(204)
        res.end()
      } catch {}
      return
    }
    if (parsed.kind === 'invalid') {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      return
    }
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
    if (parsed.kind === 'error') {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      settleFailed(gen, describeOAuthError(parsed.error, parsed.description))
      return
    }
    if (parsed.kind === 'missing') {
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      settleFailed(gen, '授权回调缺少必要参数，请重新发起登录')
      return
    }
    if (parsed.state !== pendingAttempt.stateToken) {
      // 不回显期望值 / 收到的 state，避免把 CSRF 令牌写进页面或日志。
      sendHtml(res, 400, CALLBACK_FAILED_HTML)
      settleFailed(gen, '授权回调校验失败（state 不匹配），请重新发起登录')
      return
    }
    sendHtml(res, 200, CALLBACK_SUCCESS_HTML)
    pendingAttempt.callbackHandled = true
    respondCallback(gen, parsed.code, pendingAttempt.verifier)
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
      const listening = await openCallbackServer({
        pickPort,
        onRequest: (req, res) => handleCallback(req, res, gen),
        onRequestError: (error) => {
          settleFailed(gen, `处理授权回调失败：${sanitizeMessage(error?.message ?? error)}`)
        },
      })
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
