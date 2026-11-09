/** Host 接口访问：URL 解析与统一请求出口。 */

export function apiUrl(relative) {
  if (typeof document === 'undefined') return relative
  return new URL(relative, document.baseURI).toString()
}

/**
 * 统一请求出口：所有 fetch 都包在 try/catch 里，永远返回结果对象，
 * 不把异常抛到 React 渲染层。网络失败只更新提示，界面保持可用。
 */

export async function request(relative, init) {
  try {
    const res = await fetch(apiUrl(relative), {
      cache: 'no-store',
      credentials: 'same-origin',
      ...init,
      headers: {
        accept: 'application/json',
        ...(init && init.body ? { 'content-type': 'application/json' } : {}),
        ...(init && init.headers ? init.headers : {}),
      },
    })
    let payload = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    if (!res.ok) {
      const envelope = payload && payload.error ? payload.error : null
      return {
        ok: false,
        status: res.status,
        // 远端 daemon 未就绪时 Host 回 503；没有明确错误码就按可重试的 warming 处理。
        code: envelope && envelope.code ? envelope.code : res.status === 503 ? 'warming' : `http_${res.status}`,
        message: envelope && envelope.message ? envelope.message : `HTTP ${res.status}`,
      }
    }
    return { ok: true, status: res.status, data: payload }
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      code: 'network',
      message: String((cause && cause.message) || cause || 'network error'),
    }
  }
}
