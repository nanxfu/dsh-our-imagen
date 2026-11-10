/**
 * 会话相关路由：状态快照、环境探测、启动、关机。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源），本文件不写字面量。
 */

import { ROUTES } from '../../shared/contract.js'
import { sendJson } from '../http.js'
import { presetById } from '../presets.js'
import { readBodyOr } from '../route-kit.js'

/**
 * @param {{ session: object, probes: object, statePayload: () => object, defaultPreset: string, log: object }} deps
 */
export function createSessionRoutes({ session, probes, statePayload, defaultPreset, log }) {
  return [
    {
      name: 'state',
      path: ROUTES.state.path,
      method: ROUTES.state.method,
      handler(req, res) {
        sendJson(res, 200, statePayload())
      },
    },
    {
      name: 'probe',
      path: ROUTES.probe.path,
      method: ROUTES.probe.method,
      async handler(req, res) {
        const probe = await probes.run()
        sendJson(res, 200, { ok: probe.auth?.ok === true, probe })
      },
    },
    {
      name: 'session-start',
      path: ROUTES.sessionStart.path,
      method: ROUTES.sessionStart.method,
      async handler(req, res) {
        const body = await readBodyOr(req, {}, log)
        const presetId = typeof body.presetId === 'string' ? body.presetId : defaultPreset
        const snapshot = await session.start(presetById(presetId).id)
        sendJson(res, 200, { ok: snapshot.state !== 'error', session: snapshot })
      },
    },
    {
      name: 'session-stop',
      path: ROUTES.sessionStop.path,
      method: ROUTES.sessionStop.method,
      async handler(req, res) {
        const snapshot = await session.stop()
        sendJson(res, 200, { ok: true, session: snapshot })
      },
    },
  ]
}