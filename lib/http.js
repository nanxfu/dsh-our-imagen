/**
 * HTTP 小工具：JSON 响应、请求体读取。
 */

import { TIMEOUTS } from '../shared/contract.js'

export function sendJson(res, code, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

export function sendError(res, code, errorCode, message) {
  sendJson(res, code, { error: { code: errorCode, message } })
}

export function methodNotAllowed(res, allow) {
  res.writeHead(405, { allow })
  res.end()
}

const MAX_BODY_BYTES = TIMEOUTS.bodyMaxBytes

/**
 * 读取 JSON 请求体。
 *
 * @param {object} req Node 请求对象
 * @param {number | { maxBytes?: number, strictObject?: boolean }} [maxBytesOrOptions]
 *   本路由的请求体上限（默认 `bodyMaxBytes`）或配置对象。
 *   传入 `{ strictObject: true }` 时，非纯对象 JSON（如数组/数字/字符串/null）将抛错而非静默归一成 `{}`。
 */
export function readJsonBody(req, maxBytesOrOptions = MAX_BODY_BYTES) {
  const options =
    maxBytesOrOptions && typeof maxBytesOrOptions === 'object' ? maxBytesOrOptions : { maxBytes: maxBytesOrOptions }
  const maxBytes = options.maxBytes
  const strictObject = options.strictObject === true
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_BODY_BYTES
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        finish(reject, new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) return finish(resolve, {})
      let value
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        value = JSON.parse(text)
      } catch {
        finish(reject, new Error('请求体不是合法 JSON'))
        return
      }
      if (strictObject && (!value || typeof value !== 'object' || Array.isArray(value))) {
        finish(reject, new Error('请求体必须是 JSON 对象'))
        return
      }
      finish(resolve, value && typeof value === 'object' ? value : {})
    })
    req.on('error', (error) => finish(reject, error))
  })
}
