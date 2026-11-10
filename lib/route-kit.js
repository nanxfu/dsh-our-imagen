/**
 * 路由装配小工具。
 *
 * 目的：把每条路由都要重复一遍的「注册形状 + 方法校验 + 查询串解析 + 请求体兜底」
 * 收到一处；具体路由定义放在 `lib/routes/` 下，按资源阅读。
 *
 * 注册形状必须与拆分前逐字一致（宿主卸载时依赖 effect 返回的 disposer 注销路由）：
 *   ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), 'imagen:route-' + name)
 */

import { methodNotAllowed, readJsonBody } from './http.js'

/** 整数钳制：非数字退回 fallback，其余四舍五入后夹到 [min, max]。 */
export function toInt(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** 解析查询串；非法 URL 只记 debug 并返回空参数。 */
export function parseQuery(req, log) {
  try {
    return new URL(req.url ?? '/', 'http://placeholder.local').searchParams
  } catch (error) {
    log.debug('请求 URL 解析失败，按无参数处理', error?.message ?? error)
    return new URLSearchParams()
  }
}

/**
 * 读请求体，非法 JSON 不中断请求：记录一条 warn 后返回调用方给定的兜底值。
 * 这与 /generate 的严格 400 invalid_body 有意区分：那一条是出图主路径，
 * 其余路由缺参时都能用默认值继续，没必要把坏 JSON 升级成 500。
 */
export async function readBodyOr(req, fallback, log) {
  try {
    return await readJsonBody(req)
  } catch (error) {
    log.warn('请求体不是合法 JSON，按兜底值继续', error?.message ?? error)
    return fallback
  }
}

/** 405 响应的 Allow 头文本：`'GET'` / `'GET, HEAD'`。 */
function allowTextOf(method) {
  return Array.isArray(method) ? method.join(', ') : String(method ?? 'GET')
}

function allows(method, allow) {
  const list = Array.isArray(allow) ? allow : [allow]
  return list.includes(method)
}

/**
 * 注册一组路由。
 *
 * @param {object} ctx 宿主上下文
 * @param {Array<{ name: string, path: string, method: string|string[], handler: Function }>} routes
 *   name 只用于生成 effect 标签（'imagen:route-' + name），必须与拆分前的标签一致。
 */
export function registerRoutes(ctx, routes) {
  for (const route of routes) {
    const allow = route.method ?? 'GET'
    const allowText = allowTextOf(allow)
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: route.path,
          handler(req, res) {
            if (!allows(req.method, allow)) return methodNotAllowed(res, allowText)
            return route.handler(req, res)
          },
        }),
      `imagen:route-${route.name}`,
    )
  }
}