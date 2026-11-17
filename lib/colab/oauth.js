/**
 * Google / Colab 内置 OAuth 2.0 登录状态机：本地回环回调 + 手动回跳 URL/授权码兜底。
 *
 * 与 Kaggle 登录共用浏览器拉起、回环 HTTP 与状态机形状（`COLAB_LOGIN` 契约），
 * 差异只在协议细节（2026-11 M0 实测结论）：
 *  - Google 已拒绝官方 CLI 的远程粘贴页（`redirect_uri_mismatch`），
 *    因此 `browser` 与 `manual` 两种模式都使用 `http://localhost:<port>` 回环回调 URI；
 *  - 浏览器无法自动拉起时，仍保留监听中的回环地址（或退回默认回环端口 8765），
 *    用户手动打开授权链接完成授权后，既可能由本地回环自动收码，也可把浏览器跳转后的
 *    完整 `http://localhost:...` 地址（或 `code`）粘贴提交。
 *
 * 安全约束：code / access_token / refresh_token 绝不进入日志、错误文本与对外视图。
 */

import { randomUUID } from 'node:crypto'

import { COLAB_LOGIN } from '../../shared/contract.js'
import { createLogger } from '../log.js'
import { canOpenBrowser, createDefaultBrowserOpener } from '../kaggle/oauth/browser.js'
import {
  closeServer,
  openCallbackServer,
  parseCallback,
  sendHtml,
} from '../kaggle/oauth/callback-server.js'
import { extractAuthorizationCode } from '../kaggle/oauth/pkce.js'
import { nonEmptyString, sanitizeMessage } from '../kaggle/oauth/text.js'
import {
  accountFromIdToken,
  buildAuthUrl,
  exchangeCode,
  readAuthSummary,
  userInfo,
  writeCredentials,
} from './client.js'

const MANUAL_FALLBACK_REDIRECT = 'http://localhost:8765'

const COLAB_SUCCESS_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Colab 授权完成</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">' +
  '<h1>Google / Colab 授权已完成</h1><p>正在换取访问令牌，请回到工作台查看登录结果，本窗口可以关闭。</p></body></html>'

const COLAB_FAILED_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Colab 授权失败</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">' +
  '<h1>授权失败</h1><p>请回到工作台查看原因并重新发起登录，本窗口可以关闭。</p></body></html>'

function createIdleView() {
  return { state: 'idle', mode: null, url: null, message: null, username: null, startedAt: null, finishedAt: null }
}

function describeOAuthError(error, description) {
  if (error === 'access_denied') return '已取消授权，如需使用 Colab 请重新发起登录'
  const detail = nonEmptyString(description)
  return detail ? `授权失败：${sanitizeMessage(detail)}` : `授权失败（${sanitizeMessage(error)}）`
}

/**
 * 创建单实例 Colab 登录管理器。
 *
 * @param {{
 *   ctx?: object, log?: object,
 *   openBrowser?: (url: string) => Promise<boolean>, platform?: string, env?: object,
 *   now?: () => number, timeoutMs?: number, pickPort?: () => number,
 *   buildAuthUrlFn?: Function, exchangeCodeFn?: Function, userInfoFn?: Function,
 *   writeCredentialsFn?: Function, readAuthSummaryFn?: Function,
 * }} [options]
 */
export function createColabLogin(options = {}) {
  const ctx = options.ctx ?? null
  const log = options.log ?? createLogger({ ctx, scope: 'colab-oauth' })
  const openBrowser = options.openBrowser ?? createDefaultBrowserOpener({ ctx, log })
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const now = options.now ?? (() => Date.now())
  const timeoutMs = options.timeoutMs ?? COLAB_LOGIN.timeoutMs
  const pickPort = options.pickPort ?? null
  const buildUrl = options.buildAuthUrlFn ?? buildAuthUrl
  const exchange = options.exchangeCodeFn ?? exchangeCode
  const fetchUserInfo = options.userInfoFn ?? userInfo
  const persistCredentials = options.writeCredentialsFn ?? writeCredentials
  const readSummary = options.readAuthSummaryFn ?? readAuthSummary

  let generation = 0
  let attempt = null
  const viewState = createIdleView()
  let authSummaryState = { authorized: false, email: null }

  const isoNow = () => new Date(now()).toISOString()

  function view() {
    return { ...viewState }
  }

  function authSummary() {
    return { ...authSummaryState }
  }

  async function refreshAuth() {
    try {
      const next = await readSummary()
      authSummaryState = {
        authorized: Boolean(next && next.authorized),
        email: next && typeof next.email === 'string' && next.email ? next.email : null,
      }
    } catch {
      authSummaryState = { authorized: false, email: null }
    }
    return authSummary()
  }

  function clearAttemptTimer() {
    if (attempt?.timer) {
      clearTimeout(attempt.timer)
      attempt.timer = null
    }
  }

  async function cleanupAttempt() {
    if (!attempt) return
    clearAttemptTimer()
    const server = attempt.server ?? null
    attempt.server = null
    if (server) await closeServer(server)
  }

  function settleFailed(gen, message) {
    if (gen !== generation) return false
    generation += 1
    void cleanupAttempt()
    viewState.state = 'failed'
    viewState.url = null
    viewState.message = message
    viewState.username = null
    viewState.finishedAt = isoNow()
    log.warn(`colab_login state=failed mode=${viewState.mode ?? 'none'}`)
    return true
  }

  function settleDone(gen, { email }) {
    if (gen !== generation) return false
    generation += 1
    void cleanupAttempt()
    viewState.state = 'done'
    viewState.url = null
    viewState.message = null
    viewState.username = email || null
    viewState.finishedAt = isoNow()
    authSummaryState = { authorized: true, email: email || null }
    log.info(`colab_login state=done mode=${viewState.mode ?? 'none'}`)
    return true
  }

  async function exchangeAndSave(gen, code, redirectUri) {
    let record
    try {
      record = await exchange({ code, redirectUri })
    } catch (error) {
      if (gen !== generation) return
      return settleFailed(gen, `换取访问令牌失败：${sanitizeMessage(error?.message ?? error)}`)
    }
    if (gen !== generation) return
    if (!record?.refreshToken) {
      return settleFailed(gen, '授权响应缺少 refresh_token，请重试并在授权页勾选完整权限')
    }
    const me = await fetchUserInfo(record.accessToken).catch(() => null)
    if (gen !== generation) return
    const email = nonEmptyString(me?.email) || nonEmptyString(accountFromIdToken(record.idToken)?.email) || null
    if (email && record.email !== email) {
      try {
        await persistCredentials({ ...record, email })
      } catch (error) {
        if (gen !== generation) return
        return settleFailed(gen, `写入凭据失败：${sanitizeMessage(error?.message ?? error)}`)
      }
    }
    if (gen !== generation) return
    settleDone(gen, { email })
  }

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
      sendHtml(res, 400, COLAB_FAILED_HTML)
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
      sendHtml(res, 400, COLAB_FAILED_HTML)
      return
    }
    if (pendingAttempt.callbackHandled) {
      sendHtml(res, 400, COLAB_FAILED_HTML)
      return
    }
    if (parsed.kind === 'error') {
      sendHtml(res, 400, COLAB_FAILED_HTML)
      settleFailed(gen, describeOAuthError(parsed.error, parsed.description))
      return
    }
    if (parsed.kind === 'missing') {
      sendHtml(res, 400, COLAB_FAILED_HTML)
      settleFailed(gen, '授权回调缺少必要参数，请重新发起登录')
      return
    }
    if (parsed.state !== pendingAttempt.stateToken) {
      sendHtml(res, 400, COLAB_FAILED_HTML)
      settleFailed(gen, '授权回调校验失败（state 不匹配），请重新发起登录')
      return
    }
    sendHtml(res, 200, COLAB_SUCCESS_HTML)
    pendingAttempt.callbackHandled = true
    void exchangeAndSave(gen, parsed.code, pendingAttempt.redirectUri).catch((error) => {
      settleFailed(gen, `登录失败：${sanitizeMessage(error?.message ?? error)}`)
    })
  }

  async function start({ mode } = {}) {
    if (viewState.state === 'pending') return view()
    const requestedMode = COLAB_LOGIN.modes.includes(mode) ? mode : null
    const gen = ++generation
    attempt = {
      generation: gen,
      mode: requestedMode ?? 'browser',
      stateToken: randomUUID(),
      redirectUri: MANUAL_FALLBACK_REDIRECT,
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

    // 两种模式都优先绑一个本地回环端口：Google 已拒绝远端粘贴页，回环 URI 对两边都有效；
    // 即便浏览器拉起失败降级 manual，如果用户在同机打开链接也能自动回调收码。
    const listening = await openCallbackServer({
      pickPort,
      onRequest: (req, res) => handleCallback(req, res, gen),
      onRequestError: (error) => {
        settleFailed(gen, `处理授权回调失败：${sanitizeMessage(error?.message ?? error)}`)
      },
    })
    if (gen !== generation) {
      if (listening?.server) void closeServer(listening.server)
      return view()
    }
    if (listening) {
      attempt.server = listening.server
      attempt.redirectUri = `http://localhost:${listening.port}`
    } else if (modeNow === 'browser') {
      modeNow = 'manual'
      log.info('colab_login_fallback reason=callback_port_unavailable')
    }

    const authorizeUrl = buildUrl({
      redirectUri: attempt.redirectUri,
      state: attempt.stateToken,
    })
    attempt.authorizeUrl = authorizeUrl
    attempt.mode = modeNow
    viewState.mode = modeNow
    if (modeNow === 'manual') viewState.url = authorizeUrl

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
        attempt.mode = 'manual'
        viewState.mode = 'manual'
        viewState.url = attempt.authorizeUrl
        log.info('colab_login_fallback reason=browser_open_failed')
      }
    }
    log.info(`colab_login_start mode=${viewState.mode}`)
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
    log.info('colab_login state=cancelled')
    return view()
  }

  async function submitCode(rawCode) {
    const code = extractAuthorizationCode(rawCode)
    if (!code) return view()
    if (viewState.state !== 'pending' || !attempt) return view()
    const gen = generation
    const redirectUri = attempt.redirectUri
    clearAttemptTimer()
    const server = attempt.server ?? null
    attempt.server = null
    if (server) await closeServer(server)
    if (gen !== generation) return view()
    await exchangeAndSave(gen, code, redirectUri)
    return view()
  }

  async function dispose() {
    generation += 1
    await cleanupAttempt()
    attempt = null
  }

  return { view, authSummary, refreshAuth, start, cancel, submitCode, dispose }
}
