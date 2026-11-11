#!/usr/bin/env node
/**
 * 会话层纯函数与端口的离线回归（不连 Kaggle、不出外网，只起一个本机 mock /generate）。
 *
 * 覆盖 P5 拆分后仍保留的纯函数边界（session-race / session-reliability 继续覆盖状态机行为）：
 *  - state.js：空快照、快照拷贝、字段初始值、失败状态截断、时长文案、隧道通道归一；
 *  - SessionManager：interval 注册/清理、轮询异常只记日志不抛出；
 *  - remote.js：隧道地址可信判定（回环 / trycloudflare / 可信域后缀与协议限制）；
 *  - rendezvous.js：会合 URL、NDJSON 解析分类、daemon error 归一、排队超时判定；
 *  - health.js：phase → 文案映射、Kernel 结束判定、心跳丢失恢复动作；
 *  - provisioner.js：注入 daemon 的配置（版本 / 契约 / 预设展开）；
 *  - JobQueue.generate：远端载荷构造、结果映射、连接失败与空结果的错误码、seed 回绕。
 *
 * 运行：node test/session-pure.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { LIMITS, PROTOCOL, VERSION } from '../shared/contract.js'
import { JobQueue } from '../lib/jobs.js'
import { isTrustedEndpoint } from '../lib/remote.js'
import { SessionManager } from '../lib/session.js'
import { describeHealthPhase, decideReadyHealthLoss, isKernelEnded } from '../lib/session/health.js'
import { buildKernelConfig } from '../lib/session/provisioner.js'
import {
  describeProvisionTimeout,
  mapRendezvousError,
  parseRendezvousLine,
  rendezvousUrl,
} from '../lib/session/rendezvous.js'
import {
  ACTIVE_STATES,
  createSessionFields,
  emptySession,
  formatDuration,
  normalizeTunnelProvider,
  snapshotOf,
  writeFailure,
} from '../lib/session/state.js'

const failures = []
let passed = 0

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}：${error?.message ?? error}`)
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

/** 本机 mock 远端：异步 job 协议（POST /generate 入队 + GET /job 轮询），验证端口拼包与结果映射。 */
async function startMockDaemon() {
  const state = { calls: 0, jobCalls: 0, lastBody: null, jobs: new Map() }
  const server = createServer((req, res) => {
    const send = (code, value) => {
      const payload = Buffer.from(JSON.stringify(value))
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': String(payload.length) })
      res.end(payload)
    }
    if (req.method === 'POST' && req.url === '/generate') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        state.calls += 1
        state.lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const jobId = state.lastBody.jobId || `job-${state.calls}`
        state.jobs.set(jobId, {
          status: 'done',
          job_id: jobId,
          model_id: 'test/model',
          progress: { done: 1, total: 1 },
          load_seconds: 0.1,
          results: [{ name: '01', seed: 7, seconds: 0.1, width: 512, height: 512, image_b64: '' }],
          error: null,
        })
        send(202, { status: 'accepted', job_id: jobId, model_id: 'test/model' })
      })
      return
    }
    if (req.method === 'GET' && req.url.startsWith('/job?id=')) {
      state.jobCalls += 1
      const id = decodeURIComponent(req.url.slice('/job?id='.length))
      const job = state.jobs.get(id)
      if (!job) return send(404, { error: { code: 'unknown_job', message: '任务不存在或已过期' } })
      return send(200, job)
    }
    send(404, { error: { code: 'not_found', message: 'not found' } })
  })
  const port = await listen(server)
  return { state, endpoint: `http://127.0.0.1:${port}`, close: () => closeServer(server) }
}

async function scenarioState() {
  console.log('\n── state.js 状态形状与文案')
  await check('emptySession 返回 absent 空快照并带上 idleTimeoutSec', () => {
    const value = emptySession({ idleTimeoutSec: 1800 })
    assert.equal(value.state, 'absent')
    assert.equal(value.error, null)
    assert.equal(value.phase, null)
    assert.equal(value.idleTimeoutSec, 1800)
    assert.equal(value.tunnelProvider, null)
    assert.equal(Object.keys(value).length, 17)
  })

  await check('normalizeTunnelProvider 只放行契约取值域内的通道', () => {
    assert.deepEqual(PROTOCOL.daemon.tunnelProviders, ['cloudflare', 'custom'])
    for (const provider of PROTOCOL.daemon.tunnelProviders) {
      assert.equal(normalizeTunnelProvider(provider), provider)
    }
    for (const value of ['Cloudflare', 'frp', '', undefined, null, 42]) {
      assert.equal(normalizeTunnelProvider(value), null, `非法值应归一为 null：${value}`)
    }
  })

  await check('snapshotOf 深拷贝 error，改副本不影响原状态', () => {
    const session = { ...emptySession({ idleTimeoutSec: 1 }), state: 'error', error: { code: 'oom', message: 'x' } }
    const copy = snapshotOf(session)
    copy.error.message = '变了'
    copy.state = 'ready'
    assert.equal(session.error.message, 'x')
    assert.equal(session.state, 'error')
  })

  await check('createSessionFields 字段初始值（timers 是 Set，epoch=0）', () => {
    const fields = createSessionFields({ idleTimeoutSec: 1800 })
    assert.ok(fields.timers instanceof Set)
    assert.equal(fields.timers.size, 0)
    assert.equal(fields.epoch, 0)
    assert.equal(fields.stoppedByUser, false)
    assert.equal(fields.disposed, false)
    assert.equal(fields.kernelFolder, null)
    assert.deepEqual(fields.secret, { token: null, topic: null })
    assert.equal(fields.session.state, 'absent')
  })

  await check('writeFailure 截断规则：detail 首行 200、message 800、phase 置空', () => {
    const session = emptySession({ idleTimeoutSec: 1800 })
    session.phase = 'warm'
    writeFailure(session, 'health_failed', `${'a'.repeat(1000)}\n第二行`)
    assert.equal(session.state, 'error')
    assert.equal(session.phase, null)
    assert.equal(session.detail.length, 200)
    assert.equal(session.error.code, 'health_failed')
    assert.equal(session.error.message.length, 800)
    assert.equal(session.error.message, 'a'.repeat(800))
  })

  await check('formatDuration 边界：<90s 用秒，否则用分钟', () => {
    assert.equal(formatDuration(0), '1 秒')
    assert.equal(formatDuration(60000), '60 秒')
    assert.equal(formatDuration(89000), '89 秒')
    assert.equal(formatDuration(90000), '2 分钟')
    assert.equal(formatDuration(45 * 60 * 1000), '45 分钟')
  })

  await check('ACTIVE_STATES 覆盖 5 个活跃状态', () => {
    assert.deepEqual([...ACTIVE_STATES].sort(), ['connecting', 'provisioning', 'ready', 'stopping', 'warming'])
  })
}

async function scenarioTrustedEndpoint() {
  console.log('\n── remote.js 隧道地址可信判定')
  await check('回环地址始终可信（http / https / IPv6）', () => {
    for (const url of [
      'http://127.0.0.1:8080',
      'https://127.0.0.1:8443',
      'http://localhost:1',
      'https://localhost',
      'http://[::1]:9000',
    ]) {
      assert.equal(isTrustedEndpoint(url), true, url)
    }
  })

  await check('https 的 *.trycloudflare.com 可信，http 与仿冒域名不可信', () => {
    assert.equal(isTrustedEndpoint('https://abc-def-ghi.trycloudflare.com'), true)
    assert.equal(isTrustedEndpoint('https://ABC.TRYCLOUDFLARE.COM'), true)
    assert.equal(isTrustedEndpoint('http://abc.trycloudflare.com'), false)
    assert.equal(isTrustedEndpoint('https://eviltrycloudflare.com'), false)
    assert.equal(isTrustedEndpoint('https://trycloudflare.com.evil.example'), false)
  })

  await check('可信域：精确命中、子域命中、大小写与前导点归一', () => {
    const domains = ['tunnel.example.com']
    assert.equal(isTrustedEndpoint('https://tunnel.example.com', domains), true)
    assert.equal(isTrustedEndpoint('https://a.tunnel.example.com', domains), true)
    assert.equal(isTrustedEndpoint('https://a.b.tunnel.example.com', domains), true)
    assert.equal(isTrustedEndpoint('https://TUNNEL.Example.COM', domains), true)
    assert.equal(isTrustedEndpoint('https://nottunnel.example.com', domains), false)
    assert.equal(isTrustedEndpoint('https://tunnel.example.com.evil.example', domains), false)

    // 配置项允许前导点与 *. 前缀（常见写法），两种都应视作同一个后缀。
    for (const entry of ['.tunnel.example.com', '*.tunnel.example.com', '.Tunnel.Example.Com']) {
      assert.equal(isTrustedEndpoint('https://a.tunnel.example.com', [entry]), true, entry)
      assert.equal(isTrustedEndpoint('https://tunnel.example.com', [entry]), true, entry)
    }
  })

  await check('可信域仅接受 https；空/非法输入一律拒绝', () => {
    const domains = ['tunnel.example.com']
    assert.equal(isTrustedEndpoint('http://tunnel.example.com', domains), false)
    assert.equal(isTrustedEndpoint('ftp://tunnel.example.com', domains), false)
    assert.equal(isTrustedEndpoint('https://a.tunnel.example.com', []), false)
    assert.equal(isTrustedEndpoint('https://a.tunnel.example.com', undefined), false)
    assert.equal(isTrustedEndpoint('not a url', domains), false)
    assert.equal(isTrustedEndpoint('', domains), false)
    assert.equal(isTrustedEndpoint(null, domains), false)
    // 空串 / 空白 / 带路径的配置项不构成可信后缀。
    assert.equal(isTrustedEndpoint('https://evil.example', ['', '  ', 'example.com/path']), false)
  })
}

async function scenarioTimers() {
  console.log('\n── SessionManager 定时器注册与清理')
  await check('every 把 id 放进 Set，clearTimers 清空并停表', async () => {
    const session = new SessionManager({ ctx: {}, defaultPreset: 'sdxl-turbo' })
    const calls = []
    try {
      const id = session.every(() => calls.push(1), 5)
      assert.equal(session.timers.size, 1)
      assert.ok(session.timers.has(id))
      await new Promise((resolve) => setTimeout(resolve, 25))
      session.clearTimers()
      assert.equal(session.timers.size, 0)
      const count = calls.length
      assert.ok(count >= 1, `期望至少触发一次，实际 ${count}`)
      await new Promise((resolve) => setTimeout(resolve, 15))
      assert.equal(calls.length, count, '清理后不应继续触发')
    } finally {
      session.clearTimers()
    }
  })

  await check('轮询异常只记 warn，不抛出且下一拍继续', async () => {
    const warnings = []
    const session = new SessionManager({
      ctx: {},
      defaultPreset: 'sdxl-turbo',
      deps: { log: { warn: (...args) => warnings.push(args) } },
    })
    let calls = 0
    try {
      session.every(() => {
        calls += 1
        throw new Error('boom')
      }, 5)
      await new Promise((resolve) => setTimeout(resolve, 30))
      session.clearTimers()
      assert.ok(calls >= 2, `期望多拍继续，实际 ${calls}`)
      assert.ok(warnings.length >= 2, `期望每拍都记 warn，实际 ${warnings.length}`)
      assert.match(warnings[0][1], /轮询异常/)
      assert.equal(warnings[0][2], 'boom')
    } finally {
      session.clearTimers()
    }
  })

  await check('轮询循环单飞自调度：上一拍未结束时不重叠执行', async () => {
    const session = new SessionManager({ ctx: {}, defaultPreset: 'sdxl-turbo' })
    let calls = 0
    let inFlight = 0
    let peak = 0
    try {
      session.every(async () => {
        calls += 1
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 25))
        inFlight -= 1
      }, 5)
      const deadline = Date.now() + 3000
      while (calls < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      session.clearTimers()
      assert.ok(calls >= 2, `应至少跑两拍，实际 ${calls}`)
      assert.equal(peak, 1, `轮询拍数不应重叠，实际峰值 ${peak}`)
    } finally {
      session.clearTimers()
    }
  })

  await check('clearTimers 取消正在飞的一拍后不再续拍', async () => {
    const session = new SessionManager({ ctx: {}, defaultPreset: 'sdxl-turbo' })
    let calls = 0
    try {
      session.every(async () => {
        calls += 1
        // 拉长单拍，保证「清理发生在拍子还在飞时」；否则测不出「结束后不再排期」。
        await new Promise((resolve) => setTimeout(resolve, 150))
      }, 5)
      const deadline = Date.now() + 3000
      while (calls === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.equal(calls, 1, '第一拍应正在飞')
      session.clearTimers()
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(calls, 1, '清理后正在飞的一拍结束也不应重新排期')
      assert.equal(session.timers.size, 0)
    } finally {
      session.clearTimers()
    }
  })

  await check('pollHealth 单飞：并发调用复用同一请求', async () => {
    let hits = 0
    const server = createServer((_req, res) => {
      hits += 1
      const body = JSON.stringify({ status: 'ok', phase: 'ready', model_id: 'test/model' })
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
    })
    const port = await listen(server)
    const session = new SessionManager({
      ctx: {},
      defaultPreset: 'sdxl-turbo',
      options: { devEndpoint: `http://127.0.0.1:${port}` },
    })
    try {
      await session.start('sdxl-turbo')
      const first = session.pollHealth()
      const second = session.pollHealth()
      assert.equal(first, second, '上一拍还在飞时应复用同一个 Promise')
      await Promise.all([first, second])
      assert.equal(hits, 1, `同一拍不应重复发请求，实际 ${hits} 次`)
    } finally {
      session.dispose()
      await closeServer(server)
    }
  })
}

async function scenarioRendezvous() {
  console.log('\n── rendezvous.js 会合协议解析')
  await check('rendezvousUrl 与改动前一致', () => {
    assert.equal(
      rendezvousUrl('https://ntfy.sh', 'imagen-abc'),
      'https://ntfy.sh/imagen-abc/json?poll=1&since=all',
    )
  })

  await check('parseRendezvousLine 四类结果', () => {
    const good = parseRendezvousLine(JSON.stringify({ event: 'message', message: JSON.stringify({ type: 'ready' }) }))
    assert.equal(good.kind, 'payload')
    assert.equal(good.payload.type, 'ready')

    assert.equal(parseRendezvousLine(JSON.stringify({ event: 'open' })).kind, 'skip')
    assert.equal(parseRendezvousLine(JSON.stringify({ event: 'message', message: 'not-json' })).kind, 'invalid-payload')
    const broken = parseRendezvousLine('{不是 JSON')
    assert.equal(broken.kind, 'invalid-event')
    assert.ok(broken.error instanceof Error)
  })

  await check('mapRendezvousError：tunnel_failed 归为 tunnel_timeout，其余 remote_error', () => {
    const tunnel = mapRendezvousError({ code: 'tunnel_failed', message: 'cloudflared 未给出地址' })
    assert.equal(tunnel.code, 'tunnel_timeout')
    assert.match(tunnel.message, /远端启动失败（tunnel_failed）：cloudflared/)

    const other = mapRendezvousError({ code: 'load_failed', message: '权重下载失败' })
    assert.equal(other.code, 'remote_error')
    assert.match(other.message, /load_failed/)

    const unknown = mapRendezvousError({})
    assert.equal(unknown.code, 'remote_error')
    assert.match(unknown.message, /remote_error/)
    assert.match(unknown.message, /无详情/)
  })

  await check('describeProvisionTimeout：排队中 → queue_timeout，容器已起 → tunnel_timeout', () => {
    const queued = describeProvisionTimeout({
      kernelStatus: 'PENDING',
      provisionTimeoutMs: 45 * 60 * 1000,
      logTail: '\n日志尾',
    })
    assert.equal(queued.code, 'queue_timeout')
    assert.match(queued.message, /等待 GPU 超时（45 分钟）/)
    assert.match(queued.message, /PENDING/)
    assert.match(queued.message, /日志尾$/)

    const noStatus = describeProvisionTimeout({ kernelStatus: null, provisionTimeoutMs: 60000 })
    assert.equal(noStatus.code, 'queue_timeout')
    assert.match(noStatus.message, /状态未知/)

    const running = describeProvisionTimeout({ kernelStatus: 'RUNNING', provisionTimeoutMs: 60000 })
    assert.equal(running.code, 'tunnel_timeout')
    assert.match(running.message, /等待会合超时/)
    assert.match(running.message, /Kernel 已处于 RUNNING/)
  })
}

async function scenarioHealth() {
  console.log('\n── health.js 响应解释与恢复决策')
  await check('describeHealthPhase 映射表替代嵌套三元', () => {
    assert.equal(describeHealthPhase({ phase: 'installing' }), '远端安装依赖')
    assert.equal(describeHealthPhase({ phase: 'loading' }), '远端加载模型')
    assert.equal(describeHealthPhase({ phase: 'error', last_error: 'CUDA OOM' }), '远端错误：CUDA OOM')
    assert.equal(describeHealthPhase({ phase: 'error' }), '远端错误：未知')
    assert.equal(describeHealthPhase({ phase: 'booting' }), '远端启动中')
    assert.equal(describeHealthPhase(undefined), '远端启动中')
  })

  await check('isKernelEnded 只认三种结束态', () => {
    for (const status of ['COMPLETE', 'ERROR', 'CANCEL_ACKNOWLEDGED']) assert.equal(isKernelEnded(status), true)
    for (const status of ['RUNNING', 'PENDING', 'QUEUED', null]) assert.equal(isKernelEnded(status), false)
  })

  await check('decideReadyHealthLoss：结束优先，其次重试次数', () => {
    assert.equal(decideReadyHealthLoss('COMPLETE', 99, 1), 'ended')
    assert.equal(decideReadyHealthLoss('RUNNING', 0, 1), 'reconnect')
    assert.equal(decideReadyHealthLoss('RUNNING', 1, 1), 'giveUp')
  })
}

async function scenarioProvisioner() {
  console.log('\n── provisioner.js 注入配置')
  await check('buildKernelConfig 键集合、版本与契约同源、预设展开成 pipeline', () => {
    const config = buildKernelConfig({
      presetId: 'sdxl-lightning',
      token: 'tok',
      topic: 'topic-1',
      idleTimeoutSec: 1800,
    })
    assert.deepEqual(Object.keys(config).sort(), [
      'auth_token',
      'contract',
      'idle_timeout_sec',
      'log_level',
      'ntfy_topic',
      'preload',
      'preset_id',
      'version',
    ])
    assert.equal(config.version, VERSION)
    assert.equal(config.contract.version, VERSION)
    assert.equal(config.preset_id, 'sdxl-lightning')
    assert.equal(config.preload.loader, 'sdxl-lora')
    assert.equal(config.idle_timeout_sec, 1800)
    assert.equal(config.log_level, 'info')
  })
}

/** 只实现 connection() 的假会话：验证队列自己的载荷构造与传输，不依赖状态机。 */
function makeGenerationQueue(connection) {
  return new JobQueue({
    ctx: null,
    session: { connection },
    defaultPreset: 'sdxl-turbo',
    options: { generateTimeoutMs: 5000 },
  })
}

async function scenarioRemotePort() {
  console.log('\n── JobQueue.generate 载荷构造与错误码')
  const mock = await startMockDaemon()
  try {
    const params = {
      prompt: '测试画面',
      negativePrompt: 'blurry',
      seed: 7,
      width: 512,
      height: 1024,
      steps: 3,
      cfg: 1.5,
      count: 2,
    }
    const queue = makeGenerationQueue(() => ({ endpoint: mock.endpoint, token: 'test-token' }))

    await check('成功路径：tasks 递增 seed / 字段名转换 / 返回 modelId', async () => {
      const { results, modelId } = await queue.generate({ id: 'job-1', presetId: 'sdxl-turbo', params })
      assert.equal(mock.state.calls, 1)
      assert.equal(mock.state.lastBody.pipeline.loader, 'sdxl')
      assert.equal(mock.state.lastBody.modelId, 'stabilityai/sdxl-turbo')
      assert.deepEqual(
        mock.state.lastBody.tasks.map((task) => task.name),
        ['01', '02'],
      )
      assert.deepEqual(
        mock.state.lastBody.tasks.map((task) => task.seed),
        [7, 8],
      )
      assert.equal(mock.state.lastBody.tasks[0].negative_prompt, 'blurry')
      assert.deepEqual(
        { width: mock.state.lastBody.tasks[0].width, height: mock.state.lastBody.tasks[0].height },
        { width: 512, height: 1024 },
      )
      assert.equal(results.length, 1)
      assert.equal(modelId, 'test/model')
    })

    await check('seed 接近上界时环形回绕：全部落在契约范围内且按序递增', async () => {
      const wrapped = { ...params, seed: LIMITS.seed.max - 1, count: 4 }
      await queue.generate({ id: 'job-2', presetId: 'sdxl-turbo', params: wrapped })
      const seeds = mock.state.lastBody.tasks.map((task) => task.seed)
      assert.deepEqual(seeds, [LIMITS.seed.max - 1, 0, 1, 2], `回绕结果：${seeds}`)
      assert.ok(
        seeds.every((seed) => seed >= 0 && seed <= LIMITS.seed.max),
        `seed 越界：${seeds}`,
      )
    })

    await check('连接不可用 → session_absent（原文案）', async () => {
      const offline = makeGenerationQueue(() => ({ endpoint: null, token: null }))
      await assert.rejects(
        () => offline.generate({ id: 'job-3', presetId: 'sdxl-turbo', params }),
        (error) => error.code === 'session_absent' && error.message === '远端连接不可用',
      )
    })
  } finally {
    await mock.close()
  }

  await check('空结果 → empty_result（原文案）', async () => {
    // 异步协议下「空结果」= 任务 done 但 results 为空数组。
    const server = createServer((req, res) => {
      const send = (code, value) => {
        const payload = Buffer.from(JSON.stringify(value))
        res.writeHead(code, { 'content-type': 'application/json', 'content-length': String(payload.length) })
        res.end(payload)
      }
      if (req.method === 'POST' && req.url === '/generate') {
        req.resume()
        req.on('end', () => send(202, { status: 'accepted', job_id: 'empty-job', model_id: 'm' }))
        return
      }
      if (req.method === 'GET' && req.url.startsWith('/job?id=')) {
        return send(200, {
          status: 'done',
          job_id: 'empty-job',
          model_id: 'm',
          progress: { done: 0, total: 1 },
          results: [],
          error: null,
        })
      }
      send(404, { error: { code: 'not_found', message: 'not found' } })
    })
    const port = await listen(server)
    try {
      const queue = makeGenerationQueue(() => ({ endpoint: `http://127.0.0.1:${port}`, token: 't' }))
      await assert.rejects(
        () =>
          queue.generate({
            id: 'job-empty',
            presetId: 'sdxl-turbo',
            params: { prompt: 'x', negativePrompt: '', seed: 1, width: 512, height: 512, steps: 1, cfg: 0, count: 1 },
          }),
        (error) => error.code === 'empty_result' && error.message === '远端没有返回图片',
      )
    } finally {
      await closeServer(server)
    }
  })
}

async function main() {
  console.log('session-pure：会话层纯函数与端口离线回归（无 Kaggle / 无 GPU / 无外网）')
  await scenarioState()
  await scenarioTrustedEndpoint()
  await scenarioTimers()
  await scenarioRendezvous()
  await scenarioHealth()
  await scenarioProvisioner()
  await scenarioRemotePort()

  console.log('')
  if (failures.length) {
    console.log(`结果：${failures.length} 项失败，${passed} 项通过`)
    process.exitCode = 1
  } else {
    console.log(`结果：${passed} 项全部通过`)
  }
}

main().catch((error) => {
  console.error('测试脚本异常：', error)
  process.exitCode = 1
})