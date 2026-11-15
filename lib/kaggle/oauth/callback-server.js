/**
 * `127.0.0.1:8000~9000` 回环回调接收。
 *
 * 本模块负责：浏览器模式的本地回调服务——按 8000~9000 随机挑端口（占用则重试）、
 * 监听 127.0.0.1、把回跳 URL 解析成结构化结果（`parseCallback`）、回执 HTML，
 * 以及关闭服务时的「超时强关剩余连接」（`closeServer`）。
 *
 * 从 `lib/kaggle-oauth.js` 拆出：这里只管 HTTP 与端口，不碰登录状态机；
 * 校验 state、收敛成功/失败仍由 `./session.js` 决定（通过 `onRequest` / `onRequestError` 注入）。
 */

import { createServer } from 'node:http'

import { nonEmptyString } from './text.js'

/** 与 kaggle_oauth.py:138 的 random.randint(8000, 9000) 对齐。 */
const CALLBACK_PORT_MIN = 8000
const CALLBACK_PORT_MAX = 9000
/** 端口被占用时的重试次数（每次重新随机）。 */
const CALLBACK_PORT_ATTEMPTS = 20

export const CALLBACK_SUCCESS_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Kaggle 授权完成</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">' +
  '<h1>授权已完成</h1><p>正在换取访问令牌，请回到工作台查看登录结果，本窗口可以关闭。</p></body></html>'
export const CALLBACK_FAILED_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Kaggle 授权失败</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">' +
  '<h1>授权失败</h1><p>请回到工作台查看原因并重新发起登录，本窗口可以关闭。</p></body></html>'

/** 候选端口序列：注入 pickPort 时按注入值（离线测试用），否则在 8000~9000 随机。 */
export function portCandidates(pickPort = null) {
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

export function listenOnce(server, port) {
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

export function closeServer(server) {
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

export function sendHtml(res, status, html) {
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
 * 解析回跳请求（只做 URL 解析与字段提取，不判 state 是否匹配）。
 *
 * 返回 `{ kind }`：
 *  - `favicon`  浏览器自动请求的图标，回 204 即可；
 *  - `invalid`  URL 无法解析；
 *  - `error`    Kaggle 明确拒绝授权（带 `error` / `error_description`）；
 *  - `missing`  `code` 或 `state` 缺失；
 *  - `code`     正常回跳，带 `code` / `state` 待状态机校验。
 */
export function parseCallback(req) {
  let url
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    return { kind: 'invalid' }
  }
  if (url.pathname === '/favicon.ico') return { kind: 'favicon' }
  const code = nonEmptyString(url.searchParams.get('code'))
  const state = nonEmptyString(url.searchParams.get('state'))
  const error = nonEmptyString(url.searchParams.get('error'))
  const description = nonEmptyString(url.searchParams.get('error_description'))
  if (error) return { kind: 'error', error, description }
  if (!code || !state) return { kind: 'missing' }
  return { kind: 'code', code, state }
}

/**
 * 打开回环回调服务：依次尝试候选端口，第一个监听成功的即返回 `{ server, port }`，
 * 全部失败返回 null（调用方据此降级 manual）。
 *
 * @param {{ pickPort?: (() => number) | null, onRequest: Function, onRequestError: Function }} input
 *   onRequest(req, res)：处理一次回调；onRequestError(error)：处理回调自身的异常（不挂在半路）。
 */
export async function openCallbackServer({ pickPort = null, onRequest, onRequestError }) {
  for (const port of portCandidates(pickPort)) {
    const server = createServer((req, res) => {
      try {
        onRequest(req, res)
      } catch (error) {
        // 回调处理自身异常也必须收敛，不能挂在半路。
        sendHtml(res, 400, CALLBACK_FAILED_HTML)
        onRequestError(error)
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
