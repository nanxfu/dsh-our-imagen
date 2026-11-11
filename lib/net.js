/**
 * 出站 HTTP 访问。
 *
 * DSH 进程内的 fetch 不读取系统代理设置，而本机到 ntfy / Cloudflare 的访问
 * 可能需要走代理，因此这里做一次降级：直接 fetch 失败时改用本机 curl。
 * 两种方式对调用方返回同一形状，不把差异泄给上层。
 *
 * curl 兜底额外携带 HTTP 状态码（`--write-out` 追加在正文之后），这样
 * /health（401/503）与 /generate（400/500 错误体）走 curl 时也能拿到状态码，
 * 调用方不需要区分底层通道。
 */

import { createLogger } from './log.js'

const log = createLogger({ scope: 'net' })

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 256 * 1024
const CURL_STATUS_MARKER = '\n__IMAGEN_HTTP_STATUS__:'

/** 目标主机名（含端口）：日志只记 host，不记路径与 query，避免泄露 endpoint 细节。 */
function hostOf(url) {
  try {
    return new URL(String(url)).host || 'unknown'
  } catch {
    return 'invalid-url'
  }
}

/** 错误类型：fetch 失败常见 TypeError，spawn 失败常见带 code 的错误。 */
function errorType(error) {
  return String(error?.name ?? error?.code ?? (error instanceof Error ? 'Error' : typeof error))
}

/** 日志摘要：掩掉 token、带 query 的 URL 与用户目录路径，最多 200 字符。 */
function logText(value, max = 200) {
  let text = String(value ?? '')
  text = text.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?<redacted>')
  text = text.replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
  text = text.replace(/\b(hf_|KGAT_|ghp_|sk-)[A-Za-z0-9_-]{6,}/g, '$1<redacted>')
  text = text.replace(/\b[0-9a-f]{32,}\b/gi, '<redacted>')
  text = text.replace(/\b(token|secret|password|authorization)\s*[=:]\s*[^\s,;&]+/gi, '$1=<redacted>')
  text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"'<>:]+/g, '<user-home>')
  text = text.replace(/\/(?:Users|home)\/[^/\s"'<>:]+/g, '<user-home>')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

async function viaFetch(url, { method, headers, body, timeoutMs }) {
  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text, via: 'fetch' }
}

/** 从 curl 输出尾部剥离状态码标记，避免污染正文。 */
function stripStatus(text) {
  const match = text.match(/\n__IMAGEN_HTTP_STATUS__:(\d{3})\s*$/)
  if (!match) return { text, status: undefined }
  return { text: text.slice(0, match.index), status: Number(match[1]) }
}

async function viaCurl(ctx, url, { method, headers, body, timeoutMs, maxBytes }) {
  const limit = Math.max(DEFAULT_MAX_BYTES, Number(maxBytes) || 0)
  const argv = [
    'curl',
    '-sS',
    '--max-time',
    String(Math.ceil(timeoutMs / 1000)),
    '-X',
    method,
    // 关掉 curl 对大请求体自动加的 Expect: 100-continue，避免代理链路的额外往返。
    '-H',
    'expect:',
    // 状态码追加在正文尾部，解析后剥离；连接失败时 curl 也会输出 000。
    '-w',
    `${CURL_STATUS_MARKER}%{http_code}`,
  ]
  for (const [name, value] of Object.entries(headers)) argv.push('-H', `${name}: ${value}`)
  if (body != null) argv.push('--data-binary', body)
  argv.push(url)

  const exe = await ctx.subprocess.resolveExecutable('curl')
  const handle = ctx.subprocess.spawn({
    argv: [exe, ...argv.slice(1)],
    stdio: {
      stdin: 'ignore',
      // 生成接口返回 base64 PNG，最大请求可达 20MB+，调用方可用 maxBytes 放宽。
      stdout: { maxBytes: limit },
      stderr: { maxBytes: 32 * 1024 },
    },
    graceMs: 3000,
  })
  const outcome = await handle.done.catch((error) => {
    // curl 进程异常退出：交给调用方按失败处理，但留一条排障线索。
    log.debug('curl 进程异常退出', error?.message ?? error)
    return { exitCode: -1 }
  })
  const raw = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  const { text, status } = stripStatus(raw)
  const exitCode = outcome?.exitCode ?? -1
  const ok = exitCode === 0 && typeof status === 'number' && status >= 200 && status < 300
  // curl 失败时 stdout 可能为空，把 stderr 一并交给上层判断。
  return { ok, status, text: text || (exitCode === 0 ? '' : stderr), via: 'curl' }
}

export async function httpText(ctx, url, options = {}) {
  const settings = {
    method: 'GET',
    headers: {},
    body: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: DEFAULT_MAX_BYTES,
    ...options,
  }
  const host = hostOf(url)
  const startedAt = Date.now()
  try {
    return await viaFetch(url, settings)
  } catch (error) {
    if (typeof ctx?.subprocess?.resolveExecutable !== 'function') throw error
    // 降级是预期行为（DSH 内 fetch 不读系统代理），只记 debug，不改变调用方看到的形状。
    log.debug(
      `fetch 失败，改用 curl 兜底 host=${host} method=${settings.method} errorType=${errorType(error)} ` +
        `elapsedMs=${Date.now() - startedAt} detail=${logText(error?.message)}`,
    )
    const curlStartedAt = Date.now()
    try {
      const result = await viaCurl(ctx, url, settings)
      log.debug(
        `curl 兜底返回 host=${host} method=${settings.method} status=${result.status ?? 'none'} ` +
          `ok=${result.ok} elapsedMs=${Date.now() - curlStartedAt}`,
      )
      return result
    } catch (curlError) {
      // curl 也失败：调用方最终会拿到异常，这里是唯一能留下完整降级链路的现场。
      log.warn(
        `fetch 与 curl 均失败 host=${host} method=${settings.method} errorType=${errorType(curlError)} ` +
          `elapsedMs=${Date.now() - startedAt} detail=${logText(curlError?.message)}`,
      )
      const wrapped = new Error(`fetch 与 curl 均失败：${curlError?.message ?? curlError}`)
      wrapped.cause = error
      throw wrapped
    }
  }
}
