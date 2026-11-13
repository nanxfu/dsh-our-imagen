#!/usr/bin/env node
/**
 * 内置 Kaggle OAuth 2.0 + PKCE 登录（v0.9 M2）的离线回归：不联网、不拉起真实浏览器。
 *
 * 协议基准：本机 `kaggle` CLI 2.2.5 / `kagglesdk` 0.1.38 源码：
 *  - PKCE：`base64.urlsafe_b64encode(sha256(token_urlsafe(64)))`，challenge 保留 `=` 补位；
 *  - 授权链接参数顺序与编码对齐 `build_start_oauth_url`（quote_plus）；
 *  - 收码换 token：`POST /v1/security.OAuthService/ExchangeOAuthToken`（code/codeVerifier/grantType）；
 *  - 校验并取用户名：`POST /v1/security.OAuthService/IntrospectToken`；
 *  - 凭据落盘 `~/.kaggle/credentials.json`（与 kaggle_creds.py 同字段，0600）。
 *
 * 覆盖：PKCE 参考向量、授权 URL、manual / browser 两种模式、state 校验、取消、超时、
 * 浏览器打开失败降级、失败收敛（换 token / 校验失败），以及 token 不进入对外视图与日志。
 *
 * 运行：node test/kaggle-oauth.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildAuthorizeUrl,
  buildPkcePair,
  canOpenBrowser,
  codeChallengeOf,
  createKaggleLogin,
  extractAuthorizationCode,
  quotePlus,
} from '../lib/kaggle-oauth.js'

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`FAIL ${name}\n     ${error?.stack ?? error}`)
  }
}

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

/** 取一个当前空闲的回环端口（与登录管理器绑定时的竞态窗口很小）。 */
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

/** 用一个空闲端口起步、后续递增的 pickPort（登录管理器最多尝试 20 个候选）。 */
function portPicker(start) {
  let next = start
  return () => next++
}

/** 安装假 fetch：oauth 相关端点返回固定令牌；记录请求便于断言报文。 */
function installFetch({ exchangeStatus = 200, introspectActive = true } = {}) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', body: init.body ?? null }
    if (typeof call.body === 'string') {
      try {
        call.json = JSON.parse(call.body)
      } catch {}
    }
    calls.push(call)
    if (call.url.endsWith('/v1/security.OAuthService/ExchangeOAuthToken')) {
      if (exchangeStatus !== 200) {
        const text = JSON.stringify({ error: { message: 'invalid_grant' } })
        return { ok: false, status: exchangeStatus, text: async () => text }
      }
      const text = JSON.stringify({
        accessToken: 'oauth-access-secret',
        refreshToken: 'oauth-refresh-secret',
        tokenType: 'Bearer',
        expiresIn: 43200,
        username: 'tester',
        userId: 1,
        scope: 'resources.admin:*',
      })
      return { ok: true, status: 200, text: async () => text }
    }
    if (call.url.endsWith('/v1/security.OAuthService/IntrospectToken')) {
      const text = JSON.stringify({ active: introspectActive, username: introspectActive ? 'tester' : '' })
      return { ok: true, status: 200, text: async () => text }
    }
    throw new Error(`unexpected ${call.url}`)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** 记录日志文本的假 logger（断言 token 不落日志）。 */
function fakeLog() {
  const lines = []
  return {
    lines,
    debug: (...args) => lines.push(args.join(' ')),
    info: (...args) => lines.push(args.join(' ')),
    warn: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

async function withWorkspace(fn) {
  const home = await mkdtemp(join(tmpdir(), 'imagen-kaggle-oauth-'))
  try {
    return await fn(home, join(home, '.kaggle', 'credentials.json'))
  } finally {
    // Windows 下目录删除偶发 ENOTEMPTY（凭据文件的临时文件刚 rename/清理），重试几次。
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(home, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 9) throw error
        await sleep(20)
      }
    }
  }
}

/** 建一个浏览器模式可用的登录管理器（平台 win32 + 注入 openBrowser/pickPort）。 */
async function createBrowserLogin({ home, credentialsPath, log, timeoutMs = 3000, openBrowser }) {
  const port = await freePort()
  let openedUrl = null
  const login = createKaggleLogin({
    ctx: {},
    homeDir: home,
    credentialsPath,
    env: {},
    platform: 'win32',
    log,
    timeoutMs,
    pickPort: portPicker(port),
    openBrowser: async (url) => {
      openedUrl = url
      if (openBrowser) return openBrowser(url)
      return true
    },
  })
  return { login, port, openedUrl: () => openedUrl }
}

/** 回环回调必须走真实 HTTP（假 fetch 只拦截 Kaggle API），这里用 node:http。 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        text += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** 从 authorize URL 里取出 state 与回环端口。 */
function authorizeParts(url) {
  const parsed = new URL(url)
  const redirect = parsed.searchParams.get('redirect_uri') || ''
  const match = redirect.match(/^http:\/\/localhost:(\d+)$/)
  assert.ok(match, `redirect_uri 必须是 http://localhost:<port>，实际 ${redirect}`)
  return { state: parsed.searchParams.get('state'), port: Number(match[1]), parsed }
}

// ── 纯函数 ────────────────────────────────────────────────────────────────

async function checkPureFunctions() {
  await check('PKCE：与 kagglesdk 一致（sha256 + urlsafe base64 且保留 = 补位）', () => {
    const verifier =
      'our-free-imagen-pkce-verifier-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890'
    // 参考值由 Python 侧同参计算：
    // base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode()
    assert.equal(codeChallengeOf(verifier), 'EUm-e-DHZjb48vIIGNG0HA_epMPCa8BLqJCVAEcqft8=')
    assert.ok(codeChallengeOf(verifier).endsWith('='), 'kagglesdk 不 rstrip 补位')

    const pair = buildPkcePair()
    assert.equal(pair.verifier.length, 86, 'token_urlsafe(64) 等价产物为 86 字符')
    assert.equal(pair.challenge.length, 44)
    assert.ok(pair.challenge.endsWith('='))
    assert.ok(/^[A-Za-z0-9_-]{43}=$/.test(pair.challenge), pair.challenge)
  })

  await check('buildAuthorizeUrl：参数顺序 / quote_plus 编码与 kagglesdk 逐字一致', () => {
    const url = buildAuthorizeUrl({
      redirectUri: 'http://localhost:8123',
      state: 'state-xyz',
      codeChallenge: 'EUm-e-DHZjb48vIIGNG0HA_epMPCa8BLqJCVAEcqft8=',
    })
    assert.equal(
      url,
      'https://www.kaggle.com/api/v1/oauth2/authorize' +
        '?response_type=code' +
        '&client_id=kagglesdk' +
        '&redirect_uri=http%3A%2F%2Flocalhost%3A8123' +
        '&scope=resources.admin%3A%2A' +
        '&state=state-xyz' +
        '&code_challenge=EUm-e-DHZjb48vIIGNG0HA_epMPCa8BLqJCVAEcqft8%3D' +
        '&code_challenge_method=S256' +
        '&response_mode=query',
    )
    assert.equal(quotePlus('resources.admin:*'), 'resources.admin%3A%2A')
    assert.equal(quotePlus("a b!'()*"), 'a+b%21%27%28%29%2A')
  })

  await check('extractAuthorizationCode：纯 code / 整段回跳 URL / code=... 片段', () => {
    assert.equal(extractAuthorizationCode('  plain-code  '), 'plain-code')
    assert.equal(
      extractAuthorizationCode('http://localhost:8123/?code=abc123&state=xyz'),
      'abc123',
    )
    assert.equal(extractAuthorizationCode('code=abc123&state=xyz'), 'abc123')
    assert.equal(extractAuthorizationCode('https://www.kaggle.com/account/api/oauth/token?state=x&code=c0de'), 'c0de')
    assert.equal(extractAuthorizationCode(''), null)
    assert.equal(extractAuthorizationCode('x'.repeat(5000)), null)
  })

  await check('canOpenBrowser / browserCommand：平台判定与打开命令', () => {
    assert.equal(canOpenBrowser({ platform: 'win32', env: {} }), true)
    assert.equal(canOpenBrowser({ platform: 'darwin', env: {} }), true)
    assert.equal(canOpenBrowser({ platform: 'linux', env: {} }), false)
    assert.equal(canOpenBrowser({ platform: 'linux', env: { DISPLAY: ':0' } }), true)
  })
}

// ── 登录流程 ──────────────────────────────────────────────────────────────

async function checkManualMode() {
  await check('manual 模式：授权链接 → 粘贴授权码 → done 并写 credentials.json（0600）', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const log = fakeLog()
      const fetchMock = installFetch()
      const login = createKaggleLogin({
        ctx: {},
        homeDir: home,
        credentialsPath,
        env: {},
        platform: 'linux',
        log,
        timeoutMs: 3000,
      })
      try {
        const started = await login.start()
        assert.equal(started.state, 'pending')
        assert.equal(started.mode, 'manual')
        assert.ok(started.url.includes('https://www.kaggle.com/api/v1/oauth2/authorize'))
        // manual 模式没有本地回环回调：redirect_uri 用 Kaggle 默认地址，由用户复制授权码。
        assert.equal(
          new URL(started.url).searchParams.get('redirect_uri'),
          'https://www.kaggle.com/account/api/oauth/token',
        )
        assert.ok(new URL(started.url).searchParams.get('state'))

        const done = await login.submitCode('oauth-code-from-browser')
        assert.equal(done.state, 'done')
        assert.equal(done.username, 'tester')
        assert.equal(done.url, null)

        const exchange = fetchMock.calls.find((call) => call.url.endsWith('/ExchangeOAuthToken'))
        assert.ok(exchange, '必须调用 ExchangeOAuthToken')
        assert.equal(exchange.json.code, 'oauth-code-from-browser')
        assert.equal(exchange.json.grantType, 'authorization_code')
        assert.ok(exchange.json.codeVerifier.length >= 43, 'code_verifier 必须下发')

        const saved = JSON.parse(await readFile(credentialsPath, 'utf8'))
        assert.equal(saved.refresh_token, 'oauth-refresh-secret')
        assert.equal(saved.access_token, 'oauth-access-secret')
        assert.equal(saved.username, 'tester')
        assert.ok(Array.isArray(saved.scopes) && saved.scopes.includes('resources.admin:*'))
        assert.ok(Date.parse(saved.access_token_expiration) > Date.now())

        // 对外视图与日志都不含 token / 授权码 / verifier。
        const viewText = JSON.stringify(login.view())
        const logText = log.lines.join('\n')
        for (const secret of ['oauth-code-from-browser', 'oauth-access-secret', 'oauth-refresh-secret', exchange.json.codeVerifier]) {
          assert.ok(!viewText.includes(secret), `视图泄露 ${secret}`)
          assert.ok(!logText.includes(secret), `日志泄露 ${secret}`)
        }
        await login.dispose()
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('manual 模式：缺少授权码时不改状态、不发请求', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch()
      const login = createKaggleLogin({
        ctx: {},
        homeDir: home,
        credentialsPath,
        env: {},
        platform: 'linux',
        log: fakeLog(),
        timeoutMs: 1000,
      })
      try {
        await login.start()
        const before = fetchMock.calls.length
        const view = await login.submitCode('   ')
        assert.equal(view.state, 'pending')
        assert.equal(fetchMock.calls.length, before)
        await login.cancel()
      } finally {
        fetchMock.restore()
      }
    })
  })
}

async function checkBrowserMode() {
  await check('browser 模式：回环回调收码 → done，回调 HTML 提示成功', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const log = fakeLog()
      const fetchMock = installFetch()
      const { login, openedUrl } = await createBrowserLogin({ home, credentialsPath, log })
      try {
        const started = await login.start()
        assert.equal(started.state, 'pending')
        assert.equal(started.mode, 'browser')
        assert.equal(started.url, null, 'browser 模式不把链接推给前端')
        const parts = authorizeParts(openedUrl())
        assert.ok(parts.port >= 1024)

        const callback = await httpGet(`http://127.0.0.1:${parts.port}/?code=browser-code&state=${encodeURIComponent(parts.state)}`)
        assert.equal(callback.status, 200)
        assert.ok(callback.text.includes('授权已完成'), callback.text)

        const done = await waitFor(() => login.view(), (view) => view.state !== 'pending')
        assert.equal(done.state, 'done')
        assert.equal(done.username, 'tester')

        const saved = JSON.parse(await readFile(credentialsPath, 'utf8'))
        assert.equal(saved.refresh_token, 'oauth-refresh-secret')
        const exchange = fetchMock.calls.find((call) => call.url.endsWith('/ExchangeOAuthToken'))
        assert.equal(exchange.json.code, 'browser-code')
        await login.dispose()
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('browser 模式：state 不匹配 → failed，且不写入凭据', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch()
      const { login, openedUrl } = await createBrowserLogin({ home, credentialsPath, log: fakeLog() })
      try {
        await login.start()
        const parts = authorizeParts(openedUrl())
        const callback = await httpGet(`http://127.0.0.1:${parts.port}/?code=evil-code&state=wrong-state`)
        assert.equal(callback.status, 400)
        const failed = await waitFor(() => login.view(), (view) => view.state !== 'pending')
        assert.equal(failed.state, 'failed')
        assert.ok(failed.message.includes('state'), failed.message)
        assert.equal(fetchMock.calls.some((call) => call.url.endsWith('/ExchangeOAuthToken')), false)
        await assert.rejects(readFile(credentialsPath, 'utf8'))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('browser 打不开 → 自动降级 manual，返回可复制链接', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch()
      const { login } = await createBrowserLogin({
        home,
        credentialsPath,
        log: fakeLog(),
        openBrowser: async () => false,
      })
      try {
        const started = await login.start()
        assert.equal(started.state, 'pending')
        assert.equal(started.mode, 'manual')
        assert.ok(started.url.includes('/api/v1/oauth2/authorize'))
        // 降级后的 redirect_uri 用 Kaggle 默认地址（由用户复制授权码）。
        assert.equal(
          new URL(started.url).searchParams.get('redirect_uri'),
          'https://www.kaggle.com/account/api/oauth/token',
        )
        await login.cancel()
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('取消：pending → cancelled，回环端口随之释放', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch()
      const { login, openedUrl } = await createBrowserLogin({ home, credentialsPath, log: fakeLog() })
      try {
        await login.start()
        const parts = authorizeParts(openedUrl())
        const cancelled = await login.cancel()
        assert.equal(cancelled.state, 'cancelled')
        await assert.rejects(httpGet(`http://127.0.0.1:${parts.port}/`), /fetch failed|ECONNREFUSED/)
        // 非 pending 状态的取消是幂等的。
        assert.equal((await login.cancel()).state, 'cancelled')
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('超时：等待授权超时 → failed（可重新发起）', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch()
      const { login } = await createBrowserLogin({ home, credentialsPath, log: fakeLog(), timeoutMs: 80 })
      try {
        await login.start()
        const failed = await waitFor(() => login.view(), (view) => view.state === 'failed', { timeoutMs: 2000 })
        assert.ok(failed.message.includes('超时'), failed.message)
        // 超时后重新 start 可以再次进入 pending。
        const again = await login.start()
        assert.equal(again.state, 'pending')
        await login.cancel()
      } finally {
        fetchMock.restore()
      }
    })
  })
}

async function checkFailures() {
  await check('换 token 失败：收敛为 failed 且原因可读（不回显授权码）', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const log = fakeLog()
      const fetchMock = installFetch({ exchangeStatus: 400 })
      const login = createKaggleLogin({
        ctx: {},
        homeDir: home,
        credentialsPath,
        env: {},
        platform: 'linux',
        log,
        timeoutMs: 1000,
      })
      try {
        await login.start()
        const done = await login.submitCode('bad-code-secret')
        assert.equal(done.state, 'failed')
        assert.ok(done.message.includes('换取访问令牌失败'), done.message)
        assert.ok(!done.message.includes('bad-code-secret'))
        assert.ok(!log.lines.join('\n').includes('bad-code-secret'))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('introspect 未激活：failed，不写凭据', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch({ introspectActive: false })
      const login = createKaggleLogin({
        ctx: {},
        homeDir: home,
        credentialsPath,
        env: {},
        platform: 'linux',
        log: fakeLog(),
        timeoutMs: 1000,
      })
      try {
        await login.start()
        const done = await login.submitCode('some-code')
        assert.equal(done.state, 'failed')
        assert.ok(done.message.includes('校验失败') || done.message.includes('未激活'), done.message)
        await assert.rejects(readFile(credentialsPath, 'utf8'))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('dispose：卸载时取消等待中的登录（释放端口）', async () => {
    await withWorkspace(async (home, credentialsPath) => {
      const fetchMock = installFetch()
      const { login, openedUrl } = await createBrowserLogin({ home, credentialsPath, log: fakeLog() })
      try {
        await login.start()
        const parts = authorizeParts(openedUrl())
        await login.dispose()
        assert.equal(login.view().state, 'cancelled')
        await assert.rejects(httpGet(`http://127.0.0.1:${parts.port}/`))
      } finally {
        fetchMock.restore()
      }
    })
  })
}

async function main() {
  await checkPureFunctions()
  await checkManualMode()
  await checkBrowserMode()
  await checkFailures()

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  // 某些失败分支可能留下未关闭的回环服务/定时器句柄；测试进程显式退出，避免挂住 CI。
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})


