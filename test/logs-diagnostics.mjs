/**
 * 日志与诊断系统测试（不需要浏览器、不需要构建）。
 *
 * 覆盖：
 *  - shared/contract.js 的 LOGS / DIAGNOSTICS 口径是否真的被客户端逻辑引用；
 *  - GET /logs 响应 env 的白名单透传、非法字段剔除与旧响应（无 env）向后兼容；
 *  - hostLines 尾部行数上限；
 *  - buildDiagnostics 的环境指纹 / 阶段耗时段与脱敏（不出现 token、代理 URL、
 *    工作区绝对路径、prompt 正文）；
 *  - lib/log.js 的 buildDiagnosticEnv（代理环境变量、配置开关、会话耗时、异常降级）；
 *  - lib/routes/logs.js 三个响应分支都带 env，env 函数抛错降级 {}；
 *  - LogsDrawer 双视图与 GuidanceCard 次级动作的源码结构。
 *
 * 运行：node test/logs-diagnostics.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

import { DIAGNOSTICS, LOGS, VERSION } from '../shared/contract.js'
import { buildDiagnosticEnv } from '../lib/log.js'
import { createLogRoutes } from '../lib/routes/logs.js'
import { fallbackTranslate } from '../src/i18n.js'
import {
  DIAG_HOST_LOG_TAIL,
  DIAG_LOG_TAIL,
  HOST_LOG_LINE_LIMIT,
  LOG_LINE_LIMIT,
  buildDiagnostics,
  readDiagnosticEnv,
  readLogsPayload,
} from '../src/logic/logs.js'

const t = fallbackTranslate('zh')
const NOW = Date.parse('2026-11-11T00:09:00.000Z')

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
  }
}

function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

/** 极简 res 替身：记录 sendJson 写出的状态码与 JSON 体。 */
function makeRes() {
  const state = { code: null, headers: null, body: null }
  return {
    state,
    writeHead(code, headers) {
      state.code = code
      state.headers = headers
    },
    end(body) {
      state.body = body ? JSON.parse(Buffer.from(body).toString('utf8')) : null
    },
  }
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} }

// ── 契约常量 ────────────────────────────────────────────────

await check('日志常量引用共享契约', () => {
  assert.equal(LOG_LINE_LIMIT, LOGS.remoteLineLimit)
  assert.equal(HOST_LOG_LINE_LIMIT, LOGS.hostLineLimit)
  assert.equal(DIAG_LOG_TAIL, LOGS.diagRemoteTail)
  assert.equal(DIAG_HOST_LOG_TAIL, LOGS.diagHostTail)
  assert.deepEqual(
    [LOG_LINE_LIMIT, HOST_LOG_LINE_LIMIT, DIAG_LOG_TAIL, DIAG_HOST_LOG_TAIL],
    [400, 120, 120, 80],
  )
  assert.ok(DIAGNOSTICS.envFields.includes('platform'))
  assert.ok(DIAGNOSTICS.envFields.includes('hasHfToken'))
  assert.deepEqual(DIAGNOSTICS.timingFields, ['sessionStartMs', 'sessionUptimeMs', 'readyUptimeMs'])
})

// ── readLogsPayload：env 白名单 ─────────────────────────────

await check('env 白名单透传与非法字段剔除', () => {
  const payload = readLogsPayload({
    ok: true,
    data: {
      ok: true,
      next: 3,
      lines: ['remote-1'],
      hostLines: ['host-1'],
      env: {
        platform: 'win32',
        nodeVersion: 'v18.20.0',
        hasProxyEnv: true,
        hasFallbackTunnel: false,
        hasCustomDatasets: true,
        hasPipConstraints: false,
        hasHfToken: true,
        timings: { sessionStartMs: 268000, sessionUptimeMs: 540000, readyUptimeMs: 272000, extra: 1 },
        // 以下都不是允许的键 / 类型：绝不能出现在归一结果里。
        token: 'hf_NOT_A_REAL_TOKEN_VALUE',
        proxyUrl: 'http://user:pass@127.0.0.1:7890',
        workspace: 'D:\\document\\development\\our-free-imagen',
        prompt: '一只猫',
        nested: { platform: 'linux' },
      },
    },
  })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.env, {
    platform: 'win32',
    nodeVersion: 'v18.20.0',
    hasProxyEnv: true,
    hasFallbackTunnel: false,
    hasCustomDatasets: true,
    hasPipConstraints: false,
    hasHfToken: true,
    timings: { sessionStartMs: 268000, sessionUptimeMs: 540000, readyUptimeMs: 272000 },
  })
  assert.equal(Object.prototype.hasOwnProperty.call(payload.env, 'token'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload.env, 'timings'), true)
  // 非字符串行仍被过滤，env 不影响既有字段语义。
  assert.deepEqual(payload.lines, ['remote-1'])

  // 业务不可用分支（session_absent / logs_unavailable）同样要带 env。
  const unavailable = readLogsPayload({
    ok: true,
    data: {
      ok: false,
      code: 'logs_unavailable',
      message: '隧道断开',
      lines: [],
      hostLines: ['host-1'],
      env: { platform: 'darwin', hasProxyEnv: false },
    },
  })
  assert.equal(unavailable.ok, false)
  assert.deepEqual(unavailable.env, { platform: 'darwin', hasProxyEnv: false })
  assert.deepEqual(unavailable.hostLines, ['host-1'])
})

await check('env 非法类型被剔除、timings 只留有限数字', () => {
  const env = readDiagnosticEnv({
    platform: 123, // 数字在白名单允许的类型内
    nodeVersion: ['v18'],
    hasProxyEnv: 'yes',
    hasFallbackTunnel: null,
    hasCustomDatasets: true,
    hasPipConstraints: Number.NaN,
    hasHfToken: {},
    timings: { sessionStartMs: '268000', sessionUptimeMs: Number.POSITIVE_INFINITY, readyUptimeMs: 0 },
  })
  assert.deepEqual(env, {
    platform: 123,
    hasProxyEnv: 'yes',
    hasCustomDatasets: true,
    timings: { readyUptimeMs: 0 },
  })
  // 非对象入参一律空对象。
  assert.deepEqual(readDiagnosticEnv(null), {})
  assert.deepEqual(readDiagnosticEnv('env'), {})
  assert.deepEqual(readDiagnosticEnv(['platform']), {})
})

// ── 向后兼容 ────────────────────────────────────────────────

await check('旧响应没有 env 时向后兼容', () => {
  const legacy = readLogsPayload({ ok: true, data: { ok: true, lines: ['x'], hostLines: ['h'], next: 1 } })
  assert.equal(legacy.ok, true)
  assert.deepEqual(legacy.env, {}, '缺 env 时归一为空对象')
  assert.deepEqual(legacy.lines, ['x'])
  assert.deepEqual(legacy.hostLines, ['h'])

  const failed = readLogsPayload({ ok: false, code: 'network', message: 'fetch failed' })
  assert.deepEqual(failed.env, {}, 'HTTP 层失败时 env 同样为空对象')

  const absent = readLogsPayload({
    ok: true,
    data: { ok: false, code: 'session_absent', message: '云端会话未启动', lines: [], hostLines: ['h'] },
  })
  assert.equal(absent.ok, false)
  assert.deepEqual(absent.env, {}, 'session_absent 且老路由不带 env 时也兼容')

  // 诊断文本在没有 env 的旧数据下仍然可复制，各字段写 —。
  const text = buildDiagnostics(t, { version: '0.6.0', lines: ['old'], now: NOW })
  assert.ok(text.includes('env.platform: —'))
  assert.ok(text.includes('env.node: —'))
  assert.ok(text.includes('timings.sessionStartMs: —'))
})

// ── hostLines 上限 ──────────────────────────────────────────

await check('hostLines 尾部行数上限', () => {
  const many = readLogsPayload({
    ok: true,
    data: {
      ok: true,
      hostLines: Array.from({ length: HOST_LOG_LINE_LIMIT + 50 }, (_, index) => `host-${index}`),
    },
  })
  assert.equal(many.hostLines.length, HOST_LOG_LINE_LIMIT)
  assert.equal(many.hostLines[HOST_LOG_LINE_LIMIT - 1], `host-${HOST_LOG_LINE_LIMIT + 49}`, '保留最新尾部')
  assert.equal(many.hostLines[0], 'host-50', '丢弃最早的日志')
})

// ── buildDiagnostics：环境指纹 / 耗时 / 脱敏 ────────────────

await check('诊断信息包含环境指纹与阶段耗时', () => {
  const env = {
    platform: 'win32',
    nodeVersion: 'v18.20.0',
    hasProxyEnv: true,
    hasFallbackTunnel: false,
    hasCustomDatasets: false,
    hasPipConstraints: true,
    hasHfToken: true,
    timings: { sessionStartMs: 268000, sessionUptimeMs: 540000, readyUptimeMs: 272000 },
    // 非法键：必须被 buildDiagnostics 再次过滤掉。
    token: 'hf_NOT_A_REAL_TOKEN_VALUE',
    proxyUrl: 'http://user:pass@127.0.0.1:7890',
    workspace: 'D:\\document\\development\\our-free-imagen',
    prompt: '一只猫',
  }
  const text = buildDiagnostics(t, {
    version: VERSION,
    env,
    session: {
      state: 'ready',
      startedAt: '2026-11-11T00:00:00.000Z',
      readyAt: '2026-11-11T00:04:28.000Z',
      token: 'super-secret-token',
      endpointUrl: 'https://tunnel.example.com',
    },
    lines: ['[boot] ready'],
    hostLogs: ['[info] [index] loaded'],
    now: NOW,
  })
  for (const needle of [
    'env.platform: win32',
    'env.node: v18.20.0',
    'env.proxy: true',
    'env.fallbackTunnel: false',
    'env.customDatasets: false',
    'env.pipConstraints: true',
    'env.hfToken: true',
    'timings.sessionStartMs: 268000',
    'timings.sessionUptimeMs: 540000',
    'timings.readyUptimeMs: 272000',
  ]) {
    assert.ok(text.includes(needle), `诊断文本应包含：${needle}`)
  }
  for (const secret of [
    'hf_NOT_A_REAL_TOKEN_VALUE',
    'super-secret-token',
    '127.0.0.1:7890',
    'our-free-imagen',
    '一只猫',
    'tunnel.example.com',
  ]) {
    assert.ok(!text.includes(secret), `诊断文本不得包含：${secret}`)
  }
  // 旧断言口径仍在：会话快照与日志段落不能回退。
  assert.ok(text.includes('session.state: ready'))
  assert.ok(text.includes('host logs (last 1/1):'))
  assert.ok(text.includes('logs (last 1/1):'))
})

await check('诊断信息缺省值与 null 写 —', () => {
  const text = buildDiagnostics(t, {
    version: '0.7.0',
    env: { platform: 'linux', timings: { sessionStartMs: null } },
    now: NOW,
  })
  assert.ok(text.includes('env.platform: linux'))
  assert.ok(text.includes('env.nodeVersion: ') === false, '输出键名改用 env.node')
  assert.ok(text.includes('env.node: —'))
  assert.ok(text.includes('env.proxy: —'))
  assert.ok(text.includes('timings.sessionStartMs: —'), '显式 null 也写 —')
  assert.ok(text.includes('timings.sessionUptimeMs: —'))
  assert.ok(text.includes('timings.readyUptimeMs: —'))
})

// ── lib/log.js：buildDiagnosticEnv ──────────────────────────

await check('buildDiagnosticEnv 计算配置开关与阶段耗时', () => {
  const env = buildDiagnosticEnv({
    config: {
      fallbackTunnelCommand: ['frpc', '-c', 'frpc.ini'],
      datasetSources: ['owner/dataset'],
      pipConstraints: ['numpy==1.26'],
      hfToken: 'hf_SECRET_TOKEN_VALUE',
    },
    session: {
      snapshot: () => ({
        startedAt: '2026-11-11T00:00:00.000Z',
        readyAt: '2026-11-11T00:04:28.000Z',
      }),
    },
    now: NOW,
  })
  assert.equal(env.platform, process.platform)
  assert.equal(env.nodeVersion, process.versions.node)
  assert.equal(env.hasFallbackTunnel, true)
  assert.equal(env.hasCustomDatasets, true)
  assert.equal(env.hasPipConstraints, true)
  assert.equal(env.hasHfToken, true)
  assert.deepEqual(env.timings, {
    sessionStartMs: 268000,
    sessionUptimeMs: 540000,
    readyUptimeMs: 272000,
  })
  assert.ok(!JSON.stringify(env).includes('hf_SECRET_TOKEN_VALUE'), 'env 不得带配置原文 / token')
})

await check('buildDiagnosticEnv 未就绪 / 异常时安全降级', () => {
  // 未就绪：只有 startedAt，就绪耗时与 readyUptimeMs 为 null。
  const pending = buildDiagnosticEnv({
    session: { snapshot: () => ({ startedAt: '2026-11-11T00:00:00.000Z', readyAt: null }) },
    now: NOW,
  })
  assert.deepEqual(pending.timings, { sessionStartMs: null, sessionUptimeMs: 540000, readyUptimeMs: null })

  // 没有会话：全部 null。
  assert.deepEqual(buildDiagnosticEnv({ now: NOW }).timings, {
    sessionStartMs: null,
    sessionUptimeMs: null,
    readyUptimeMs: null,
  })

  // 快照抛错：返回安全默认值（布尔 false、耗时 null），绝不向外抛。
  const brokenSession = buildDiagnosticEnv({
    config: { hfToken: 'hf_x', pipConstraints: ['numpy'] },
    session: {
      snapshot() {
        throw new Error('snapshot boom')
      },
    },
  })
  assert.equal(brokenSession.hasHfToken, false)
  assert.equal(brokenSession.hasPipConstraints, false)
  assert.deepEqual(brokenSession.timings, {
    sessionStartMs: null,
    sessionUptimeMs: null,
    readyUptimeMs: null,
  })

  // 配置读取本身抛错：整体降级，不抛异常。
  const hostileConfig = {}
  Object.defineProperty(hostileConfig, 'fallbackTunnelCommand', {
    get() {
      throw new Error('config boom')
    },
  })
  const brokenConfig = buildDiagnosticEnv({ config: hostileConfig })
  assert.equal(brokenConfig.hasFallbackTunnel, false)
  assert.equal(brokenConfig.platform, process.platform)

  // 空数组 / 空字符串按「未配置」处理。
  const empty = buildDiagnosticEnv({
    config: { fallbackTunnelCommand: [], datasetSources: [], pipConstraints: [], hfToken: '   ' },
  })
  assert.equal(empty.hasFallbackTunnel, false)
  assert.equal(empty.hasCustomDatasets, false)
  assert.equal(empty.hasPipConstraints, false)
  assert.equal(empty.hasHfToken, false)
})

await check('buildDiagnosticEnv 只暴露代理是否存在', () => {
  const keys = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']
  const saved = {}
  for (const key of keys) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  try {
    assert.equal(buildDiagnosticEnv().hasProxyEnv, false, '全部未设置时为 false')
    // 小写变体同样算配置；环境变量值（含凭据的 URL）不会进入返回值。
    process.env.https_proxy = 'http://user:pass@127.0.0.1:7890'
    const env = buildDiagnosticEnv()
    assert.equal(env.hasProxyEnv, true)
    assert.ok(!JSON.stringify(env).includes('127.0.0.1'), '代理 URL 不得出现在指纹里')
    delete process.env.https_proxy
    process.env.ALL_PROXY = 'socks5://127.0.0.1:7890'
    assert.equal(buildDiagnosticEnv().hasProxyEnv, true, '大写变体同样生效')
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})

// ── lib/routes/logs.js：三个分支都带 env ───────────────────

await check('日志路由 session_absent 分支带 env', async () => {
  let calls = 0
  const route = createLogRoutes({
    session: { connection: () => ({ endpoint: null, token: null }) },
    log: silentLog,
    env: () => {
      calls += 1
      return { platform: 'win32', hasHfToken: true }
    },
  })[0]
  const res = makeRes()
  await route.handler({ url: '/imagen-api/logs?since=0', method: 'GET' }, res)
  assert.equal(res.state.code, 200)
  assert.equal(res.state.body.code, 'session_absent')
  assert.equal(calls, 1, 'env 函数每个请求恰好调用一次')
  assert.deepEqual(res.state.body.env, { platform: 'win32', hasHfToken: true })
  assert.ok(Array.isArray(res.state.body.hostLines))
  assert.equal(res.state.body.next, 0)
})

await check('日志路由成功 / 不可用分支带 env，env 抛错降级 {}', async () => {
  let mode = 'ok'
  const daemon = createServer((req, res) => {
    if (!req.url || !req.url.startsWith('/logs')) {
      res.writeHead(404, { connection: 'close' })
      res.end('{}')
      return
    }
    // 关掉 keep-alive，避免测试进程被空闲连接挂住。
    res.setHeader('connection', 'close')
    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'load_failed', message: 'daemon down' } }))
      return
    }
    const body = JSON.stringify({ lines: ['remote-a', 7, 'remote-b'], next: 2 })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    daemon.once('error', reject)
    daemon.listen(0, '127.0.0.1', resolve)
  })
  try {
    const port = daemon.address().port
    const route = createLogRoutes({
      session: {
        connection: () => ({ endpoint: `http://127.0.0.1:${port}`, token: 'test-token' }),
        ctx: null,
      },
      log: silentLog,
      env: () => ({ platform: 'win32', nodeVersion: 'v18.20.0' }),
    })[0]

    const okRes = makeRes()
    await route.handler({ url: '/imagen-api/logs?since=0', method: 'GET' }, okRes)
    assert.equal(okRes.state.code, 200)
    assert.equal(okRes.state.body.ok, true)
    assert.deepEqual(okRes.state.body.lines, ['remote-a', 'remote-b'])
    assert.equal(okRes.state.body.next, 2)
    assert.deepEqual(okRes.state.body.env, { platform: 'win32', nodeVersion: 'v18.20.0' })
    assert.ok(Array.isArray(okRes.state.body.hostLines))

    mode = 'fail'
    const failRes = makeRes()
    await route.handler({ url: '/imagen-api/logs?since=0', method: 'GET' }, failRes)
    assert.equal(failRes.state.code, 200)
    assert.equal(failRes.state.body.ok, false)
    assert.equal(failRes.state.body.code, 'logs_unavailable')
    assert.deepEqual(failRes.state.body.env, { platform: 'win32', nodeVersion: 'v18.20.0' })
    assert.ok(Array.isArray(failRes.state.body.hostLines))
  } finally {
    if (typeof daemon.closeAllConnections === 'function') daemon.closeAllConnections()
    await new Promise((resolve) => daemon.close(resolve))
  }

  // 未注入 env（老装配）：env 仍存在且为 {}。
  const legacyRoute = createLogRoutes({
    session: { connection: () => ({ endpoint: null, token: null }) },
    log: silentLog,
  })[0]
  const legacyRes = makeRes()
  await legacyRoute.handler({ url: '/imagen-api/logs', method: 'GET' }, legacyRes)
  assert.deepEqual(legacyRes.state.body.env, {})

  // env 函数抛错 / 返回非对象：同样降级 {}，不影响日志响应。
  for (const badEnv of [() => { throw new Error('env boom') }, () => 'not-an-object', () => null]) {
    const badRoute = createLogRoutes({
      session: { connection: () => ({ endpoint: null, token: null }) },
      log: silentLog,
      env: badEnv,
    })[0]
    const badRes = makeRes()
    await badRoute.handler({ url: '/imagen-api/logs?since=0', method: 'GET' }, badRes)
    assert.equal(badRes.state.code, 200)
    assert.deepEqual(badRes.state.body.env, {})
  }
})

// ── 组件源码结构 ────────────────────────────────────────────

await check('LogsDrawer 双视图与兜底结构', async () => {
  const source = await readSource('../src/studio/LogsDrawer.jsx')
  for (const needle of [
    'studio.logs.tab.remote',
    'studio.logs.tab.host',
    'studio.logs.hostFallbackTitle',
    'studio.logs.hostNote',
    'aria-pressed={!showingHost}',
    'aria-pressed={showingHost}',
    'ofs-chip',
    'const FOCUSABLE =',
    "'Escape'",
    'scrollTop',
    'studio.logs.close',
    'env: logs.env',
  ]) {
    assert.ok(source.includes(needle), `LogsDrawer 应包含：${needle}`)
  }
  // 默认远端：没有任何 useState('host') 的默认值，视图由 autoView（remote 优先）决定。
  assert.ok(!source.includes("useState('host')"), '默认视图必须是远端，不能把 host 写死为初始值')
  assert.match(source, /manualView \?\? autoView/, '手动选择优先于自动兜底')
  assert.match(
    source,
    /remoteLines\.length === 0 && hostLines\.length > 0 \? 'host' : 'remote'/,
    '远端为空且 Host 有内容时自动兜底',
  )
  // 新旧日志滚动、空态与不可用原因分别提示。
  assert.ok(source.includes("logs.status === 'unavailable'"))
  assert.ok(source.includes("logs.status === 'empty'"))
})

await check('GuidanceCard 五类卡片两个次级动作', async () => {
  const source = await readSource('../src/studio/GuidanceCard.jsx')
  for (const needle of [
    'studio.guidance.viewLogs',
    'studio.guidance.copyDiag',
    'openLogs',
    'fetchState',
    'fetchLogs(0)',
    'buildDiagnostics',
    'readLogsPayload',
    "copyText(text, 'studio.logs.copied')",
  ]) {
    assert.ok(source.includes(needle), `GuidanceCard 应包含：${needle}`)
  }
  const kindsLine = source.split(/\r?\n/).find((line) => line.includes('SECONDARY_KINDS'))
  assert.ok(kindsLine, '缺少次级动作的卡片类别声明')
  for (const kind of ['session', 'network', 'generate', 'generic', 'auth']) {
    assert.ok(kindsLine.includes(`'${kind}'`), `次级动作应覆盖 ${kind} 卡片`)
  }
  const plainChips = source
    .split(/\r?\n/)
    .filter((line) => line.includes('className="ofs-chip"'))
  assert.ok(plainChips.length >= 2, '两个次级按钮必须是普通 ofs-chip（不带 is-on）')
  assert.match(source, /index === 0 \? ' is-on' : ''/, '每张卡只有一个实心主操作')
})

await check('useStudioLogs 返回 env 且内容不变不重渲染', async () => {
  const source = await readSource('../src/studio/hooks/useStudioLogs.js')
  assert.ok(source.includes('sameEnv'), '环境指纹需要内容比较')
  assert.ok(
    source.includes('return { status, lines, hostLines, reason, env }'),
    '数据域需要把 env 返回给日志抽屉',
  )
  assert.ok(source.includes('payload.env'), 'env 必须来自 /logs 响应')
})

// ── 汇总 ────────────────────────────────────────────────────

const failed = results.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} 项失败：`)
  for (const item of failed) console.error(`  - ${item.name}: ${item.error?.message ?? item.error}`)
  process.exitCode = 1
} else {
  console.log(`\n全部通过（${results.length} 项）`)
}
