/**
 * 远端 Daemon 的 HTTP 客户端（协议见 docs/API.md 第 6 节）。
 *
 * 所有请求都带 Bearer Token；连接目标是 Cloudflare 临时域名，
 * 因此这里不使用 keep-alive 复用，避免隧道重建后连接指向失效节点。
 */

const HEALTH_TIMEOUT_MS = 4000
// 首次生成可能要现下 6.6GB 权重，300s 不够；有 preload 时通常几秒返回。
const GENERATE_TIMEOUT_MS = 600000
const SHUTDOWN_TIMEOUT_MS = 3000

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

export async function fetchHealth(endpoint, token, timeoutMs = HEALTH_TIMEOUT_MS) {
  const res = await fetch(new URL('/health', endpoint), {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`health ${res.status}`)
  return res.json()
}

export async function requestGenerate(endpoint, token, body, timeoutMs = GENERATE_TIMEOUT_MS) {
  const res = await fetch(new URL('/generate', endpoint), {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!res.ok) {
    const remoteError = payload?.error
    const error = new Error(
      typeof remoteError === 'string' ? remoteError : remoteError?.message ?? `远端返回 ${res.status}`,
    )
    error.code = typeof remoteError === 'object' ? remoteError?.code : undefined
    error.status = res.status
    throw error
  }
  if (!payload || typeof payload !== 'object') throw new Error('远端返回了非 JSON 响应')
  return payload
}

export async function requestShutdown(endpoint, token, timeoutMs = SHUTDOWN_TIMEOUT_MS) {
  try {
    await fetch(new URL('/shutdown', endpoint), {
      method: 'POST',
      headers: authHeaders(token),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return true
  } catch {
    return false
  }
}

export async function requestLogs(endpoint, token, since = 0, timeoutMs = HEALTH_TIMEOUT_MS) {
  const res = await fetch(new URL(`/logs?since=${encodeURIComponent(since)}`, endpoint), {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`logs ${res.status}`)
  return res.json()
}
