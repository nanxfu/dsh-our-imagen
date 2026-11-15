/**
 * 工作台界面状态路由：读取归一化视图 / 保存白名单补丁（v0.9 M1 第 4 项）。
 *
 * 注册形态说明：契约里 `uiState`(GET) 与 `uiStateSave`(POST) 共用同一个 path，
 * 而 DSH webServer 的 exact 路由表以 path 为键、重复 `register()` 会直接抛错
 * （"duplicate exact route"），所以这里只注册一条路由、在 handler 里按 method 分发，
 * 由 route-kit 的 method 数组统一做 405 判定与 Allow 头（与 `lib/routes/settings.js` 一致）。
 *
 * 安全约束：界面态没有敏感信息；日志只记字段名与结果，不记请求体原文。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源），本文件不写字面量。
 */

import { ROUTES, TIMEOUTS } from '../../shared/contract.js'
import { readJsonBody, sendError, sendJson } from '../http.js'
import { normalizeUiStatePatch, patchUiState, readUiState } from '../ui-state.js'

/** 对外可见的请求字段（用于日志记录字段名；未知字段由 normalizeUiStatePatch 忽略）。 */
const KNOWN_FIELDS = ['advancedOpen']

/** 请求体出现过的字段名（只记名字，不记值）。 */
function fieldNamesOf(body) {
  return KNOWN_FIELDS.filter((name) => Object.prototype.hasOwnProperty.call(body, name)).join(',')
}

/**
 * @param {{ ctx: object, log: object }} deps
 *   ctx 用于解析工作区路径（`<workspace>/.imagen/ui-state.json`）。
 */
export function createUiStateRoutes({ ctx, log }) {
  async function readState(req, res) {
    const uiState = await readUiState(ctx)
    sendJson(res, 200, { ok: true, uiState })
  }

  async function saveState(req, res) {
    let body
    try {
      body = await readJsonBody(req, { maxBytes: TIMEOUTS.bodyMaxBytes, strictObject: true })
    } catch (error) {
      log.warn('界面状态请求体不是合法 JSON', error?.message ?? error)
      return sendError(res, 400, 'invalid_body', '请求体必须是合法 JSON 对象')
    }

    const patch = normalizeUiStatePatch(body)
    if (!patch.ok) {
      log.info(`ui_state_rejected fields=${fieldNamesOf(body) || 'none'}`)
      return sendError(res, 400, 'invalid_request', patch.message)
    }

    try {
      const uiState = await patchUiState(ctx, patch.value)
      log.info(`ui_state_saved fields=${fieldNamesOf(patch.value) || 'none'}`)
      sendJson(res, 200, { ok: true, uiState })
    } catch (error) {
      log.warn('界面状态写入失败（不影响出图主链路）', error?.message ?? error)
      sendError(res, 500, 'internal_error', '界面状态保存失败，请检查工作区目录权限')
    }
  }

  return [
    {
      name: 'ui-state',
      // 同一 path 不能注册两次：一条路由同时接受 GET/POST，handler 内再分发。
      path: ROUTES.uiState.path,
      method: [ROUTES.uiState.method, ROUTES.uiStateSave.method],
      handler(req, res) {
        if (req.method === ROUTES.uiStateSave.method) return saveState(req, res)
        return readState(req, res)
      },
    },
  ]
}
