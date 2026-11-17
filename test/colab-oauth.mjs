#!/usr/bin/env node
/**
 * 内置 Colab Google OAuth 2.0 登录的离线回归：不联网、不拉起真实浏览器。
 *
 * 覆盖：
 *  - buildAuthUrl 支持 state 参数且回环地址不带 remoteRedirect；
 *  - readAuthSummary 从凭据读出授权状态与邮箱（含过期待刷新/有效期/无令牌）；
 *  - createColabLogin 浏览器回环自动收码、state 不匹配拒绝、授权拒绝；
 *  - 浏览器打不开降级 manual 仍使用 http://localhost:<port>，支持粘贴完整回跳 URL 兑换；
 *  - 缺少 refresh_token 失败收敛、cancel、dispose、以及路由 createColabRoutes GET/POST/400。
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { buildAuthUrl, readAuthSummary } from '../lib/colab/client.js'
import { createColabLogin } from '../lib/colab/oauth.js'
import { createColabRoutes } from '../lib/routes/colab.js'
import { ROUTES } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'

const { check, summary } = createCheckRunner()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(fn, predicate, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (predicate(last)) return last
    await sleep(intervalMs)
  }
  throw new Error(`等待条件超时，最后一次：${JSON.stringify(last)}`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

function createFakeLog() {
  const entries = []
  return {
    entries,
    info: (...args) => entries.push({ level: 'info', text: args.join(' ') }),
    warn: (...args) => entries.push({ level: 'warn', text: args.join(' ') }),
    debug: (...args) => entries.push({ level: 'debug', text: args.join(' ') }),
    error: (...args) => entries.push({ level: 'error', text: args.join(' ') }),
  }
}

function fakeRes() {
  const out = { status: 0, headers: {}, body: '' }
  return {
    out,
    writeHead(status, headers) {
      out.status = status
      out.headers = headers || {}
    },
    end(text) {
      out.body = String(text || '')
    },
  }
}

function fakeReq(method, body = null) {
  const raw = body === null ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  const stream = Readable.from(raw ? [Buffer.from(raw, 'utf8')] : [])
  stream.method = method
  stream.headers = {}
  return stream
}

async function main() {
  await check('buildAuthUrl：包含 state 且回环地址不带 token_usage=remote', () => {
    const url = new URL(buildAuthUrl({ redirectUri: 'http://localhost:8765', state: 'csrf-123' }))
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8765')
    assert.equal(url.searchParams.get('state'), 'csrf-123')
    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.equal(url.searchParams.get('token_usage'), null)
  })

  await check('readAuthSummary：读取凭据状态与邮箱且不暴露令牌', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'colab-auth-summary-'))
    const prev = process.env.IMAGEN_COLAB_CREDENTIALS
    const file = join(dir, 'colab-credentials.json')
    process.env.IMAGEN_COLAB_CREDENTIALS = file
    try {
      assert.deepEqual(await readAuthSummary(), { authorized: false, email: null })
      await writeFile(
        file,
        JSON.stringify({
          accessToken: 'secret-access-token',
          refreshToken: 'secret-refresh-token',
          email: 'alice@example.com',
          expiresAt: Date.now() - 1000,
        }),
      )
      const summaryView = await readAuthSummary()
      assert.deepEqual(summaryView, { authorized: true, email: 'alice@example.com' })
      assert.equal(JSON.stringify(summaryView).includes('secret-'), false)
    } finally {
      if (prev === undefined) delete process.env.IMAGEN_COLAB_CREDENTIALS
      else process.env.IMAGEN_COLAB_CREDENTIALS = prev
      await rm(dir, { recursive: true, force: true })
    }
  })

  await check('createColabLogin：browser 回环自动收码、写邮箱并刷新 authSummary', async () => {
    const port1 = await freePort()
    const port2 = await freePort()
    let portIndex = 0
    const ports = [port1, port2]
    const log = createFakeLog()
    const saved = []
    let openedUrl = ''
    const login = createColabLogin({
      log,
      platform: 'win32',
      env: {},
      pickPort: () => ports[Math.min(portIndex++, ports.length - 1)],
      openBrowser: async (url) => {
        openedUrl = url
        return true
      },
      exchangeCodeFn: async ({ code, redirectUri }) => {
        assert.equal(code, '4/0AcvDMrTestCode')
        assert.equal(redirectUri, `http://localhost:${port2}`)
        return {
          accessToken: 'colab-access-secret',
          refreshToken: 'colab-refresh-secret',
          expiresAt: Date.now() + 3600_000,
        }
      },
      userInfoFn: async () => ({ email: 'pro@example.com' }),
      writeCredentialsFn: async (record) => {
        saved.push(record)
        return 'mem'
      },
    })

    try {
      const started = await login.start()
      assert.equal(started.state, 'pending')
      assert.equal(started.mode, 'browser')
      const stateToken = new URL(openedUrl).searchParams.get('state')
      assert.ok(stateToken)

      // state 不匹配应拒绝且不消耗登录会话
      const bad = await httpGet(`http://127.0.0.1:${port1}/?code=abc&state=wrong`)
      assert.equal(bad.status, 400)
      assert.equal(login.view().state, 'failed')

      // 重新发起并走正确回调
      const restarted = await login.start()
      assert.equal(restarted.state, 'pending')
      const state2 = new URL(openedUrl).searchParams.get('state')
      const ok = await httpGet(`http://127.0.0.1:${port2}/?code=4%2F0AcvDMrTestCode&state=${encodeURIComponent(state2)}`)
      assert.equal(ok.status, 200)
      assert.ok(ok.body.includes('Google / Colab 授权已完成'))

      const done = await waitFor(() => login.view(), (v) => v.state === 'done')
      assert.equal(done.username, 'pro@example.com')
      assert.deepEqual(login.authSummary(), { authorized: true, email: 'pro@example.com' })
      assert.equal(saved.length, 1)
      assert.equal(saved[0].email, 'pro@example.com')
      assert.equal(JSON.stringify(log.entries).includes('secret'), false, '日志绝不能出现令牌')
    } finally {
      await login.dispose()
    }
  })

  await check('createColabLogin：浏览器打不开降级 manual 保留 localhost URI，支持粘贴完整回调 URL', async () => {
    const port = await freePort()
    let usedRedirect = ''
    const login = createColabLogin({
      log: createFakeLog(),
      platform: 'linux',
      env: {},
      pickPort: () => port,
      openBrowser: async () => false,
      exchangeCodeFn: async ({ code, redirectUri }) => {
        usedRedirect = redirectUri
        assert.equal(code, '4/0AmanualCode99')
        return {
          accessToken: 'tok',
          refreshToken: 'ref',
          expiresAt: Date.now() + 3600_000,
        }
      },
      userInfoFn: async () => ({ email: 'manual@example.com' }),
      writeCredentialsFn: async () => 'mem',
    })

    try {
      const started = await login.start()
      assert.equal(started.state, 'pending')
      assert.equal(started.mode, 'manual')
      assert.ok(started.url && started.url.includes('redirect_uri=http%3A%2F%2Flocalhost%3A'))
      assert.equal(started.url.includes('applicationdefaultauthcode'), false)

      const view = await login.submitCode(
        `http://localhost:${port}/?state=ignored&code=4%2F0AmanualCode99&scope=openid`,
      )
      assert.equal(view.state, 'done')
      assert.equal(view.username, 'manual@example.com')
      assert.equal(usedRedirect, `http://localhost:${port}`)
    } finally {
      await login.dispose()
    }
  })

  await check('createColabLogin：缺少 refresh_token 失败收敛 + cancel', async () => {
    const port = await freePort()
    const login = createColabLogin({
      log: createFakeLog(),
      platform: 'linux',
      env: {},
      pickPort: () => port,
      exchangeCodeFn: async () => ({ accessToken: 'tok', refreshToken: null }),
    })
    try {
      await login.start()
      const failed = await login.submitCode('4/0AnoRefreshTokenHere')
      assert.equal(failed.state, 'failed')
      assert.ok(failed.message.includes('refresh_token'))

      await login.start()
      const cancelled = await login.cancel()
      assert.equal(cancelled.state, 'cancelled')
    } finally {
      await login.dispose()
    }
  })

  await check('createColabRoutes：GET 附带 auth、POST start/submit-code/非法 action 校验', async () => {
    const port = await freePort()
    const login = createColabLogin({
      log: createFakeLog(),
      platform: 'linux',
      env: {},
      pickPort: () => port,
      exchangeCodeFn: async () => ({ accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3600_000 }),
      userInfoFn: async () => ({ email: 'route@example.com' }),
      writeCredentialsFn: async () => 'mem',
    })
    const [route] = createColabRoutes({ login, log: createFakeLog() })
    assert.equal(route.path, ROUTES.colabLogin.path)
    try {
      const r1 = fakeRes()
      await route.handler(fakeReq('GET'), r1)
      assert.equal(r1.out.status, 200)
      assert.deepEqual(JSON.parse(r1.out.body).auth, { authorized: false, email: null })

      const rBad = fakeRes()
      await route.handler(fakeReq('POST', { action: 'unknown' }), rBad)
      assert.equal(rBad.out.status, 400)

      const rStart = fakeRes()
      await route.handler(fakeReq('POST', { action: 'start' }), rStart)
      assert.equal(rStart.out.status, 200)
      assert.equal(JSON.parse(rStart.out.body).login.state, 'pending')

      const rDone = fakeRes()
      await route.handler(fakeReq('POST', { action: 'submit-code', code: '4/0ArouteCode1234' }), rDone)
      assert.equal(rDone.out.status, 200)
      const parsed = JSON.parse(rDone.out.body)
      assert.equal(parsed.login.state, 'done')
      assert.deepEqual(parsed.auth, { authorized: true, email: 'route@example.com' })
    } finally {
      await login.dispose()
    }
  })

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
