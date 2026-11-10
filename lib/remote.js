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

import { TIMEOUTS } from '../shared/contract.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'

const log = createLogger({ scope: 'remote' })

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  }
}

function isLoopback(url) {
  try {
    const { hostname } = new URL(url)
    // IPv6 主机名在 WHATWG URL 里带方括号（[::1]），两种写法都认。
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
    // 127.0.0.0/8 全部是回环地址。
    return /^127\./.test(hostname)
  } catch (error) {
    log.debug('endpoint 不是合法 URL', error?.message ?? error)
    return false
  }
}

/** 可信域配置项归一化：去空白、大小写不敏感，允许前导点与 `*.` 前缀。 */
function normalizeTrustedDomain(value) {
  if (typeof value !== 'string') return null
  let domain = value.trim().toLowerCase()
  if (!domain) return null
  if (domain.startsWith('*.')) domain = domain.slice(2)
  while (domain.startsWith('.')) domain = domain.slice(1)
  if (!domain || /[/\s:]/.test(domain)) return null
  return domain
}

/** hostname 是否等于某个可信域，或是它的子域。 */
function matchesTrustedDomain(hostname, trustedDomains) {
  if (!Array.isArray(trustedDomains) || trustedDomains.length === 0) return false
  for (const item of trustedDomains) {
    const domain = normalizeTrustedDomain(item)
    if (!domain) continue
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true
  }
  return false
}

/**
 * 隧道地址是否可信。
 *
 * 回环地址（本地联调）与 https 的 *.trycloudflare.com 始终可信；备用隧道（自建 FRP 等）
 * 通过 `trustedDomains` 配置的域名后缀放行，规则：仅 https，hostname 精确等于该域名
 * 或以 `.域名` 结尾；配置项大小写不敏感，允许前导点与 `*.` 前缀。
 * 不可信地址不放行，避免把 Bearer Token 发给会合消息里出现的任意主机。
 */
export function isTrustedEndpoint(url, trustedDomains = []) {
  if (typeof url !== 'string' || url.length === 0) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (isLoopback(url)) return true
    if (parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname.toLowerCase()
    if (hostname.endsWith('.trycloudflare.com')) return true
    return matchesTrustedDomain(hostname, trustedDomains)
  } catch (error) {
    log.debug('隧道地址解析失败，按不可信处理', error?.message ?? error)
    return false
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch (error) {
    // health / logs 的响应体不是 JSON 说明 daemon 协议已偏离，值得 warn。
    log.warn('远端响应不是合法 JSON', error?.message ?? error)
    return null
  }
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [timeoutMs]
 * @param {object} [ctx] DSH 宿主 ctx；缺省时只走 fetch（兼容真机脚本旧签名）
 */
export async function fetchHealth(endpoint, token, timeoutMs = TIMEOUTS.remoteHealthMs, ctx = null) {
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
export async function requestGenerate(endpoint, token, body, timeoutMs = TIMEOUTS.remoteGenerateMs, ctx = null) {
  const result = await httpText(ctx, new URL('/generate', endpoint), {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
    // 一次最多 4 张 1536² PNG，base64 后可达 20MB+，curl 兜底必须放宽采集上限。
    maxBytes: TIMEOUTS.remoteGenerateMaxBytes,
  })
  const payload = parseJson(result.text)
  if (!result.ok) {
    // 所有生产方（daemon / mock-daemon / host-e2e 内联 mock）都返回对象 envelope
    // `{ error: { code, message } }`；非 JSON 或空响应时 payload 为 null，退回状态码文案。
    const remoteError = payload?.error
    const error = new Error(remoteError?.message ?? `远端返回 ${result.status ?? '请求失败'}`)
    error.code = remoteError?.code
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
export async function requestShutdown(endpoint, token, timeoutMs = TIMEOUTS.remoteShutdownMs, ctx = null) {
  try {
    await httpText(ctx, new URL('/shutdown', endpoint), {
      method: 'POST',
      headers: authHeaders(token),
      timeoutMs,
    })
    return true
  } catch (error) {
    // best-effort：关机通知失败不改变本地状态机，只留排障线索。
    log.debug('关机通知失败（忽略）', error?.message ?? error)
    return false
  }
}

/**
 * 日志抽屉：从 daemon 拉增量日志（since = 上次游标）。
 * reserved: ROADMAP 日志抽屉接入后启用（当前无调用方，保留协议实现）。
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [since]
 * @param {number} [timeoutMs]
 * @param {object} [ctx]
 */
export async function requestLogs(endpoint, token, since = 0, timeoutMs = TIMEOUTS.remoteHealthMs, ctx = null) {
  const result = await httpText(ctx, new URL(`/logs?since=${encodeURIComponent(since)}`, endpoint), {
    timeoutMs,
    headers: authHeaders(token),
  })
  if (!result.ok) throw new Error(`logs ${result.status ?? 'request failed'}`)
  const payload = parseJson(result.text)
  if (!payload || typeof payload !== 'object') throw new Error('logs 返回了非 JSON 响应')
  return payload
}
