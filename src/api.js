/** Host 接口访问：URL 解析与统一请求出口。 */

import { ROUTES, clientPath } from '../shared/contract.js'

export function apiUrl(relative) {
  return new URL(relative, document.baseURI).toString()
}

/**
 * 按契约名取客户端请求路径（返回值与改造前的相对路径同形，查询串由调用方拼接）。
 * 路径唯一来源是 shared/contract.js 的 ROUTES。
 */
export function routePath(name) {
  const route = ROUTES[name]
  if (!route) throw new Error(`未知路由：${name}`)
  return clientPath(route)
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
    // 调用方用 AbortController 主动取消（例如探测超时）时单独归类，便于界面提示。
    const aborted = Boolean(cause && (cause.name === 'AbortError' || cause.code === 'ABORT_ERR'))
    return {
      ok: false,
      status: 0,
      code: aborted ? 'timeout' : 'network',
      message: String((cause && cause.message) || cause || (aborted ? 'aborted' : 'network error')),
    }
  }
}
