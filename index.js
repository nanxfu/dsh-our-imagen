/**
 * Host half of the free-image workbench bundle.
 *
 * M1 范围：环境探测与状态读取。出图、会话生命周期在 M2。
 * 状态只在本进程内存中；真正的凭据与台账在 kaggle CLI 与远端内核里。
 */

import { DEFAULT_PRESET, PRESETS } from './lib/presets.js'
import { probeKaggle } from './lib/kaggle.js'

export const name = 'our-free-imagen'
export const inject = ['webServer', 'subprocess']

const STATE = {
  probe: null,
  probeAt: 0,
  session: { state: 'absent', detail: null },
  lastJob: null,
}

function sendJson(res, code, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function methodNotAllowed(res, allow) {
  res.writeHead(405, { allow })
  res.end()
}

export function apply(ctx, config = {}) {
  const defaultPreset = config.defaultPreset ?? DEFAULT_PRESET

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/state',
        handler(req, res) {
          if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
          sendJson(res, 200, {
            version: '0.1.0',
            defaultPreset,
            presets: PRESETS,
            session: STATE.session,
            probe: STATE.probe,
            probeAt: STATE.probeAt,
            lastJob: STATE.lastJob,
          })
        },
      }),
    'imagen:route-state',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/probe',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          try {
            const probe = await probeKaggle(ctx)
            STATE.probe = probe
            STATE.probeAt = Date.now()
            sendJson(res, 200, { ok: probe.auth?.ok === true, probe })
          } catch (error) {
            const probe = {
              provider: 'kaggle',
              cli: { present: false },
              auth: { ok: false, checkedAt: new Date().toISOString(), errorCode: 'unknown' },
              notes: [String(error?.message ?? error).slice(0, 300)],
            }
            STATE.probe = probe
            STATE.probeAt = Date.now()
            sendJson(res, 200, { ok: false, probe })
          }
        },
      }),
    'imagen:route-probe',
  )
}
