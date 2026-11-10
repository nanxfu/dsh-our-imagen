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

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 256 * 1024
const CURL_STATUS_MARKER = '\n__IMAGEN_HTTP_STATUS__:'

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
  const outcome = await handle.done.catch(() => ({ exitCode: -1 }))
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
  try {
    return await viaFetch(url, settings)
  } catch (error) {
    if (typeof ctx?.subprocess?.resolveExecutable !== 'function') throw error
    try {
      return await viaCurl(ctx, url, settings)
    } catch (curlError) {
      const wrapped = new Error(`fetch 与 curl 均失败：${curlError?.message ?? curlError}`)
      wrapped.cause = error
      throw wrapped
    }
  }
}

export async function httpJson(ctx, url, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers ?? {}) }
  const body = options.body == null ? null : JSON.stringify(options.body)
  if (body != null) headers['content-type'] = 'application/json'
  const result = await httpText(ctx, url, { ...options, headers, body })
  let value = null
  try {
    value = result.text ? JSON.parse(result.text) : null
  } catch {
    value = null
  }
  return { ...result, value }
}
