/**
 * 远端 Daemon 的 HTTP 客户端（协议见 remote/daemon.py 顶部说明）。
 *
 * 所有请求都带 Bearer Token；连接目标是 Cloudflare 临时域名，
 * 因此这里不使用 keep-alive 复用，避免隧道重建后连接指向失效节点。
 *
 * 通道：统一走 lib/net.js（fetch 失败自动降级本机 curl），
 * 否则 DSH 进程内的 fetch 不读系统代理时，代理用户会出现
 * 「会合成功但握手/出图必然失败」。ctx 作为可选尾参数传入；
 * 真机脚本沿用旧签名（不传 ctx）时只走 fetch，行为不变。
 */

import { httpText } from './net.js'

const HEALTH_TIMEOUT_MS = 4000
// 首次生成可能要现下 6.6GB 权重，300s 不够；有 preload 时通常几秒返回。
const GENERATE_TIMEOUT_MS = 600000
const SHUTDOWN_TIMEOUT_MS = 3000
// 一次最多 4 张 1536² PNG，base64 后可达 20MB+，curl 兜底必须放宽采集上限。
const GENERATE_MAX_BYTES = 32 * 1024 * 1024

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  }
}

function isLoopback(url) {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  } catch {
    return false
  }
}

/** 隧道地址只接受 https 的 trycloudflare 域名（本地联调放行回环地址）。 */
export function isTrustedEndpoint(url) {
  if (typeof url !== 'string' || url.length === 0) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (isLoopback(url)) return true
      return parsed.protocol === 'https:' && /\.trycloudflare\.com$/i.test(parsed.hostname)
    }
    return false
  } catch {
    return false
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [timeoutMs]
 * @param {object} [ctx] DSH 宿主 ctx；缺省时只走 fetch（兼容真机脚本旧签名）
 */
export async function fetchHealth(endpoint, token, timeoutMs = HEALTH_TIMEOUT_MS, ctx = null) {
  const result = await httpText(ctx, new URL('/health', endpoint), {
    timeoutMs,
    headers: authHeaders(token),
  })
  if (!result.ok) throw new Error(`health ${result.status ?? 'request failed'}`)
  const payload = parseJson(result.text)
  if (!payload || typeof payload !== 'object') throw new Error('health 返回了非 JSON 响应')
  return payload
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {object} body
 * @param {number} [timeoutMs]
 * @param {object} [ctx]
 */
export async function requestGenerate(endpoint, token, body, timeoutMs = GENERATE_TIMEOUT_MS, ctx = null) {
  const result = await httpText(ctx, new URL('/generate', endpoint), {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
    maxBytes: GENERATE_MAX_BYTES,
  })
  const payload = parseJson(result.text)
  if (!result.ok) {
    const remoteError = payload?.error
    const error = new Error(
      typeof remoteError === 'string' ? remoteError : remoteError?.message ?? `远端返回 ${result.status ?? '请求失败'}`,
    )
    error.code = typeof remoteError === 'object' ? remoteError?.code : undefined
    error.status = result.status
    throw error
  }
  if (!payload || typeof payload !== 'object') throw new Error('远端返回了非 JSON 响应')
  return payload
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [timeoutMs]
 * @param {object} [ctx]
 */
export async function requestShutdown(endpoint, token, timeoutMs = SHUTDOWN_TIMEOUT_MS, ctx = null) {
  try {
    await httpText(ctx, new URL('/shutdown', endpoint), {
      method: 'POST',
      headers: authHeaders(token),
      timeoutMs,
    })
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [since]
 * @param {number} [timeoutMs]
 * @param {object} [ctx]
 */
export async function requestLogs(endpoint, token, since = 0, timeoutMs = HEALTH_TIMEOUT_MS, ctx = null) {
  const result = await httpText(ctx, new URL(`/logs?since=${encodeURIComponent(since)}`, endpoint), {
    timeoutMs,
    headers: authHeaders(token),
  })
  if (!result.ok) throw new Error(`logs ${result.status ?? 'request failed'}`)
  const payload = parseJson(result.text)
  if (!payload || typeof payload !== 'object') throw new Error('logs 返回了非 JSON 响应')
  return payload
}
