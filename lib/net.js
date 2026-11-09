/**
 * 出站 HTTP 访问。
 *
 * DSH 进程内的 fetch 不读取系统代理设置，而本机到 ntfy / Cloudflare 的访问
 * 可能需要走代理，因此这里做一次降级：直接 fetch 失败时改用本机 curl。
 * 两种方式对调用方返回同一形状，不把差异泄给上层。
 */

const DEFAULT_TIMEOUT_MS = 10000

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

async function viaCurl(ctx, url, { method, headers, body, timeoutMs }) {
  const argv = ['curl', '-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-X', method]
  for (const [name, value] of Object.entries(headers)) argv.push('-H', `${name}: ${value}`)
  if (body != null) argv.push('--data-binary', body)
  argv.push(url)

  const exe = await ctx.subprocess.resolveExecutable('curl')
  const handle = ctx.subprocess.spawn({
    argv: [exe, ...argv.slice(1)],
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 256 * 1024 },
      stderr: { maxBytes: 32 * 1024 },
    },
    graceMs: 1500,
  })
  const outcome = await handle.done.catch(() => ({ exitCode: -1 }))
  const text = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  // curl 失败时 stdout 可能为空，把 stderr 一并交给上层判断。
  return { ok: (outcome?.exitCode ?? -1) === 0, status: undefined, text: text || stderr, via: 'curl' }
}

export async function httpText(ctx, url, options = {}) {
  const settings = {
    method: 'GET',
    headers: {},
    body: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
