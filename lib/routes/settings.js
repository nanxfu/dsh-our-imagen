/**
 * 运行设置路由：读取脱敏视图与保存用户覆盖项（M2.2）。
 *
 * 注册形态说明：契约里 `settings`(GET) 与 `settingsSave`(POST) 共用同一个 path，
 * 而 DSH webServer 的 exact 路由表以 path 为键、重复 `register()` 会直接抛错
 * （"duplicate exact route"），所以这里只注册一条路由、在 handler 里按 method 分发，
 * 由 route-kit 的 method 数组统一做 405 判定与 Allow 头。
 *
 * 安全约束：
 *  - GET / POST 响应只含 `publicSettingsView()` 的固定字段，绝不回传 hfToken 原文；
 *  - 日志只记字段名与必要的布尔，不记请求体原文（避免 Token 落进主机日志）。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源），本文件不写字面量。
 */

import { ROUTES, TIMEOUTS } from '../../shared/contract.js'
import { sendError, sendJson } from '../http.js'

/** 对外可见的请求字段（用于日志记录字段名；未知字段由 normalizeSettingsPatch 忽略）。 */
const KNOWN_FIELDS = ['idleTimeoutSec', 'accelerator', 'hfToken', 'clearHfToken', 'datasetSources', 'localModels', 'pipConstraints']

const MAX_BODY_BYTES = TIMEOUTS.bodyMaxBytes

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 请求体出现过的字段名（只记名字，不记值）。 */
function fieldNamesOf(body) {
  return KNOWN_FIELDS.filter((name) => Object.prototype.hasOwnProperty.call(body, name)).join(',')
}

/**
 * 读取并解析设置请求体。
 *
 * 与 lib/http.js 的 `readJsonBody` 有意区分：设置接口要求「非对象 body → 400 invalid_body」，
 * 而共享实现为兼容其它路由会把 JSON 标量（null / 字符串 / 数字）静默归一成 `{}`；这里
 * 保留解析后的原始类型，由调用方判定。空 body 仍按 `{}`（无字段补丁）处理。
 */
function readSettingsBody(req) {
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
      if (size > MAX_BODY_BYTES) {
        finish(reject, new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) return finish(resolve, {})
      try {
        finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(reject, new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', (error) => finish(reject, error))
  })
}

/**
 * @param {{ settings: object, session: object, log: object }} deps
 *   settings 为 createSettingsStore() 的返回值；session 只用来读 isActive。
 */
export function createSettingsRoutes({ settings, session, log }) {
  const sessionActive = () => Boolean(session?.isActive)
  const currentView = () => settings.publicView({ sessionActive: sessionActive() })

  async function readSettings(req, res) {
    // 启动加载是异步的：先等磁盘覆盖项就绪，避免第一次 GET 返回静态默认值。
    await settings.whenReady()
    sendJson(res, 200, { ok: true, settings: currentView() })
  }

  async function saveSettings(req, res) {
    let body
    try {
      body = await readSettingsBody(req)
    } catch (error) {
      log.warn('设置请求体不是合法 JSON', error?.message ?? error)
      return sendError(res, 400, 'invalid_body', '请求体必须是合法 JSON 对象')
    }
    if (!isPlainObject(body)) return sendError(res, 400, 'invalid_body', '请求体必须是 JSON 对象')

    await settings.whenReady()
    const result = await settings.save(body)
    if (!result.ok) {
      const code = result.code === 'invalid_request' ? 'invalid_request' : 'internal_error'
      log.info(`settings_rejected code=${code} fields=${fieldNamesOf(body) || 'none'}`)
      return sendError(res, code === 'invalid_request' ? 400 : 500, code, result.message)
    }
    log.info(`settings_saved fields=${fieldNamesOf(body) || 'none'} clearHfToken=${body.clearHfToken === true}`)
    sendJson(res, 200, { ok: true, settings: currentView() })
  }

  return [
    {
      name: 'settings',
      // 同一 path 不能注册两次：一条路由同时接受 GET/POST，handler 内再分发。
      path: ROUTES.settings.path,
      method: [ROUTES.settings.method, ROUTES.settingsSave.method],
      handler(req, res) {
        if (req.method === ROUTES.settingsSave.method) return saveSettings(req, res)
        return readSettings(req, res)
      },
    },
  ]
}
