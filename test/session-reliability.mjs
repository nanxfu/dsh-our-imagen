#!/usr/bin/env node
/**
 * Host 会话可靠性离线回归（对应 task-5 的 A / B / D，不连 Kaggle、不烧 GPU、不出网）。
 *
 * 覆盖：
 *   A1. ready 之后 Kernel 变为 COMPLETE：Host 必须转 error（session_ended），
 *       不能长期显示「在线」而每张图都失败。
 *   A2. ready 之后心跳丢失但 Kernel 仍 RUNNING：重取一次隧道地址仍失败 →
 *       health_failed（不再无限抖动）。
 *   A3. 短暂心跳抖动：恢复后回到 ready，不误判为失效。
 *   B.  会合点收到 daemon 的 type:'error' 事件：立即转 error（tunnel_timeout），
 *       不再等 45 分钟 queue_timeout。
 *   D.  push 失败：清理临时 Kernel 目录（目录里的 daemon.py 含 token）。
 *   E.  排队超时文案区分 queue_timeout 与 tunnel_timeout。
 *   F.  出图请求底层失败时，任务错误码保留会话错误码（session_ended）。
 *
 * 代理兜底（C）依赖真实 curl 子进程与 DSH 宿主 ctx，不在本文件覆盖；
 * 已用独立一次性脚本验证：fetch 抛错时 health / generate（400KB 响应体）/ shutdown
 * 均改走 curl，并能拿到 200/404/500 状态码与 daemon 错误码。
 *
 * 实现方式：使用真实的 SessionManager 与真实 HTTP 请求，只替换三样东西：
 *   - 假 ntfy：本地 HTTP 服务，返回一条可切换的会合消息；
 *   - 假 daemon 健康接口：本地 HTTP 服务，可切换为断连；
 *   - 假 deps：kernelStatus / kernelLogs / pushKernel / buildKernelFolder / removeKernelFolder。
 * 时钟间隔通过 options 调小以加速测试；默认值的最坏检测延迟在 checkDefaultDetectionBound 里断言。
 *
 * 运行：node test/session-reliability.mjs
 */

import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JobQueue } from '../lib/jobs.js'
import { SessionManager } from '../lib/session.js'

const PRESET = 'sdxl-lightning'
// 加速时钟：默认健康轮询 10s、Kernel 轮询 30s；测试里压到几十毫秒。
const ACCELERATED = { tickMs: 40, kernelPollMs: 80, healthyIntervalMs: 40, recoveryTimeoutMs: 2000 }

const failures = []
let passed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}${detail ? `（${detail}）` : ''}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(label, predicate, { timeoutMs = 8000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await sleep(intervalMs)
  }
  throw new Error(`等待超时：${label}`)
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

// 会话记录会写入工作区：测试用独立临时目录，避免污染仓库根目录的 .imagen/。
let workspace = null

function createCtx() {
  return {
    get(name) {
      return name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined
    },
  }
}

async function closeServer(server) {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(() => resolve()))
}

/** ntfy /json 的行格式：{"event":"message","message":"<JSON 字符串>"} */
function ntfyMessage(payload) {
  return JSON.stringify({ event: 'message', message: JSON.stringify(payload) })
}

async function startFakeNtfy() {
  const state = { line: '', hits: 0 }
  const server = createServer((_req, res) => {
    state.hits += 1
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.end(state.line ? `${state.line}\n` : '')
  })
  const port = await listen(server)
  return { state, port, close: () => closeServer(server) }
}

async function startFakeDaemonHealth() {
  const state = { mode: 'ok', hits: 0 }
  const server = createServer((req, res) => {
    state.hits += 1
    if (state.mode === 'down') {
      // 模拟隧道断开：直接掐掉连接，fetch 会抛错。
      req.destroy()
      return
    }
    const body = JSON.stringify({
      status: 'ok',
      phase: 'ready',
      version: 'test',
      model_id: 'test/model',
      loaded: ['test'],
      device: 'Fake T4',
      device_count: 1,
      idle_seconds: 0,
      idle_timeout_sec: 1800,
      jobs_done: 0,
      queue_depth: 0,
      last_error: null,
    })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  })
  const port = await listen(server)
  return { state, port, close: () => closeServer(server) }
}

function fakeDeps(overrides = {}) {
  const calls = { removed: [], pushed: 0, status: 0, logs: 0 }
  const deps = {
    kaggleUsername: async () => 'tester',
    buildKernelFolder: async () => ({
      dir: null,
      kernelId: 'tester/imagen-test',
      kernelUrl: 'https://www.kaggle.com/code/tester/imagen-test',
    }),
    pushKernel: async () => {
      calls.pushed += 1
      return { ok: true }
    },
    removeKernelFolder: async (dir) => {
      calls.removed.push(dir)
    },
    kernelStatus: async () => {
      calls.status += 1
      return { ok: true, status: 'RUNNING' }
    },
    kernelLogs: async () => {
      calls.logs += 1
      return { ok: true, tail: 'fake kernel log tail' }
    },
    ...overrides,
  }
  return { deps, calls }
}

function makeSession({ ntfyPort, deps = {}, options = {} }) {
  return new SessionManager({
    ctx: createCtx(),
    defaultPreset: PRESET,
    deps,
    options: {
      ntfyBase: `http://127.0.0.1:${ntfyPort}`,
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 10 * 60 * 1000,
      enableGpu: true,
      ...ACCELERATED,
      ...options,
    },
  })
}

/** 默认时钟下，ready 后失联最坏多久被发现：3 次健康失败 或 一次 Kernel 轮询，取较小者。 */
function checkDefaultDetectionBound() {
  console.log('\n── 默认参数下的检测上限')
  const defaults = new SessionManager({ ctx: {}, defaultPreset: PRESET })
  const bound = Math.min(
    defaults.options.healthyIntervalMs * 3,
    defaults.options.kernelPollMs,
  )
  const recoveryBound = defaults.options.recoveryTimeoutMs
  defaults.dispose()
  check('默认时钟下 ready 失联检测 ≤ 60s', bound <= 60000, `${bound}ms`)
  // recoveryTimeoutMs 只兜底「会合点也不再返回地址」的少见路径，正常路径在 2 个健康周期内收敛。
  check('默认时钟下隧道重建兜底 ≤ 3min', recoveryBound <= 180000, `${recoveryBound}ms`)
}

async function scenarioKernelEndedAfterReady() {
  const ntfy = await startFakeNtfy()
  const health = await startFakeDaemonHealth()
  ntfy.state.line = ntfyMessage({
    type: 'ready',
    endpoint: `http://127.0.0.1:${health.port}`,
    model_id: 'test/model',
    device: 'Fake T4',
  })
  let kernelMode = 'RUNNING'
  const { deps } = fakeDeps({ kernelStatus: async () => ({ ok: true, status: kernelMode }) })
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    await session.start(PRESET)
    await waitFor('会话进入 ready', () => session.snapshot().state === 'ready')

    kernelMode = 'COMPLETE'
    const began = Date.now()
    await waitFor('Kernel COMPLETE 后转入 error', () => session.snapshot().state === 'error')
    const elapsed = Date.now() - began
    const snapshot = session.snapshot()

    check('ready 后 Kernel 结束在 60s 内转 error', elapsed < 60000, `${elapsed}ms（加速时钟）`)
    check('错误码为 session_ended', snapshot.error?.code === 'session_ended', JSON.stringify(snapshot.error))
    check(
      '错误消息带 Kernel 状态与日志尾',
      /COMPLETE/.test(snapshot.error?.message ?? '') && /fake kernel log tail/.test(snapshot.error?.message ?? ''),
    )
    check('不再停留在 ready', snapshot.state === 'error')
  } finally {
    session.dispose()
    await ntfy.close()
    await health.close()
  }
}

async function scenarioHealthLostWhileKernelRunning() {
  const ntfy = await startFakeNtfy()
  const health = await startFakeDaemonHealth()
  ntfy.state.line = ntfyMessage({ type: 'ready', endpoint: `http://127.0.0.1:${health.port}` })
  const { deps, calls } = fakeDeps()
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    await session.start(PRESET)
    await waitFor('会话进入 ready', () => session.snapshot().state === 'ready')

    health.state.mode = 'down'
    const began = Date.now()
    await waitFor('心跳丢失后转入 error', () => session.snapshot().state === 'error')
    const elapsed = Date.now() - began
    const snapshot = session.snapshot()

    check('Kernel 仍 RUNNING 时心跳丢失收敛为 health_failed', snapshot.error?.code === 'health_failed', JSON.stringify(snapshot.error))
    check('恢复失败在兜底时限内收敛（<10s）', elapsed < 10000, `${elapsed}ms（加速时钟）`)
    check('重取隧道地址前查过 Kernel 状态', calls.status > 0)
    check('错误消息给出可读原因', /心跳|隧道/.test(snapshot.error?.message ?? ''))
  } finally {
    session.dispose()
    await ntfy.close()
    await health.close()
  }
}

async function scenarioRendezvousError() {
  const ntfy = await startFakeNtfy()
  ntfy.state.line = ntfyMessage({
    type: 'error',
    code: 'tunnel_failed',
    message: 'cloudflared 未给出 trycloudflare 地址（退出码 1）',
  })
  const { deps } = fakeDeps()
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    await session.start(PRESET)
    const began = Date.now()
    await waitFor('收到 error 事件后转入 error', () => session.snapshot().state === 'error', { timeoutMs: 5000 })
    const elapsed = Date.now() - began
    const snapshot = session.snapshot()

    check('ntfy error 事件 10s 内转 error', elapsed < 10000, `${elapsed}ms（加速时钟）`)
    check('错误码映射为 tunnel_timeout', snapshot.error?.code === 'tunnel_timeout', JSON.stringify(snapshot.error))
    check('错误消息保留 daemon 原始原因', /cloudflared/.test(snapshot.error?.message ?? ''))
    check('未继续等待 queue_timeout', snapshot.error?.code !== 'queue_timeout')
  } finally {
    session.dispose()
    await ntfy.close()
  }
}

async function scenarioPushFailureCleansFolder() {
  const ntfy = await startFakeNtfy()
  const kernelDir = '/tmp/fake-imagen-kernel-0000'
  const removed = []
  const { deps } = fakeDeps({
    buildKernelFolder: async () => ({
      dir: kernelDir,
      kernelId: 'tester/imagen-fail',
      kernelUrl: 'https://www.kaggle.com/code/tester/imagen-fail',
    }),
    pushKernel: async () => ({ ok: false, code: 1, output: 'Kernel push error: quota exceeded' }),
    kernelLogs: async () => ({ ok: false, tail: '' }),
    removeKernelFolder: async (dir) => {
      removed.push(dir)
    },
  })
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    const snapshot = await session.start(PRESET)
    check('push 失败转为 push_failed', snapshot.state === 'error' && snapshot.error?.code === 'push_failed', JSON.stringify(snapshot.error))
    check('push 失败清理临时 Kernel 目录', removed.includes(kernelDir), JSON.stringify(removed))
    check('本地不保留临时目录引用', session.kernelFolder === null)
  } finally {
    session.dispose()
    await ntfy.close()
  }
}

/**
 * 排队超时文案要区分「仍在排队」与「容器已运行但没会合」：
 * 前者 queue_timeout，后者 tunnel_timeout（并带 Kernel 状态）。
 */
async function scenarioTimeoutWording() {
  const ntfy = await startFakeNtfy()
  const cases = [
    { kernel: 'RUNNING', code: 'tunnel_timeout', hint: /RUNNING/ },
    { kernel: 'PENDING', code: 'queue_timeout', hint: /队列/ },
  ]
  try {
    for (const item of cases) {
      const { deps } = fakeDeps({ kernelStatus: async () => ({ ok: true, status: item.kernel }) })
      const session = makeSession({
        ntfyPort: ntfy.port,
        deps,
        options: { provisionTimeoutMs: 150, kernelPollMs: 20, tickMs: 40 },
      })
      try {
        await session.start(PRESET)
        await waitFor(`provisioning 超时后转 error（Kernel ${item.kernel}）`, () => session.snapshot().state === 'error', {
          timeoutMs: 4000,
        })
        const snapshot = session.snapshot()
        check(`Kernel ${item.kernel} 时错误码为 ${item.code}`, snapshot.error?.code === item.code, JSON.stringify(snapshot.error))
        check(`Kernel ${item.kernel} 时文案可区分排队与会合`, item.hint.test(snapshot.error?.message ?? ''))
      } finally {
        session.dispose()
      }
    }
  } finally {
    await ntfy.close()
  }
}

/** 出图请求的底层错误（fetch failed）不应覆盖会话错误码。 */
async function scenarioJobKeepsSessionCode() {
  const probe = createServer(() => {})
  const closedPort = await listen(probe)
  await closeServer(probe)
  const endpoint = `http://127.0.0.1:${closedPort}`
  const stub = {
    isReady: true,
    snapshot: () => ({ state: 'error', error: { code: 'session_ended', message: 'Kernel 已结束（COMPLETE）' } }),
    connection: () => ({ endpoint, token: 'test-token' }),
    start: async () => stub.snapshot(),
    ensureReady: async () => stub.snapshot(),
  }
  const queue = new JobQueue({
    ctx: {},
    session: stub,
    defaultPreset: PRESET,
    options: { generateTimeoutMs: 3000 },
  })
  try {
    const submitted = queue.submit({ prompt: '测试会话失效时的任务错误码' })
    check('任务已提交', submitted.ok === true && Boolean(submitted.job?.id))
    const job = await waitFor('任务进入失败态', () => {
      const current = queue.get(submitted.job.id)
      return current && current.status === 'failed' ? current : null
    })
    check('底层 fetch 失败时保留会话错误码', job.error?.code === 'session_ended', JSON.stringify(job.error))
    check('错误消息不是裸 fetch 错误', /COMPLETE/.test(job.error?.message ?? '') || /Kernel/.test(job.error?.message ?? ''))
  } finally {
    queue.dispose()
  }
}

/** 隧道短暂抖动后恢复：会话应回到 ready，而不是被误判为失效。 */
async function scenarioRecoverySucceeds() {
  const ntfy = await startFakeNtfy()
  const health = await startFakeDaemonHealth()
  ntfy.state.line = ntfyMessage({ type: 'ready', endpoint: `http://127.0.0.1:${health.port}` })
  const { deps } = fakeDeps()
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    await session.start(PRESET)
    await waitFor('会话进入 ready', () => session.snapshot().state === 'ready')

    health.state.mode = 'down'
    await waitFor('心跳丢失后进入隧道重建', () => session.snapshot().state === 'connecting', { timeoutMs: 3000 })
    health.state.mode = 'ok'
    await waitFor('健康恢复后回到 ready', () => session.snapshot().state === 'ready', { timeoutMs: 5000 })
    check('短暂心跳抖动后会话恢复为 ready', session.snapshot().state === 'ready')
    check('未误判为错误状态', session.snapshot().error === null)
  } finally {
    session.dispose()
    await ntfy.close()
    await health.close()
  }
}

async function scenario(title, fn) {
  console.log(`\n── ${title}`)
  try {
    await fn()
  } catch (error) {
    failures.push(title)
    console.log(`  ✗ 场景异常：${error?.message ?? error}`)
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error('\n测试超时（60s），强制退出')
    process.exit(2)
  }, 60000)
  watchdog.unref?.()

  console.log('session-reliability：Host 会话可靠性离线回归（无 Kaggle / 无 GPU / 无外网）')
  workspace = await mkdtemp(join(tmpdir(), 'imagen-session-reliability-'))
  checkDefaultDetectionBound()
  await scenario('A1 ready 后 Kernel 结束', scenarioKernelEndedAfterReady)
  await scenario('A2 ready 后心跳丢失但 Kernel 仍运行', scenarioHealthLostWhileKernelRunning)
  await scenario('A3 短暂心跳抖动后恢复', scenarioRecoverySucceeds)
  await scenario('B 会合点 error 事件', scenarioRendezvousError)
  await scenario('D push 失败清理临时目录', scenarioPushFailureCleansFolder)
  await scenario('E 超时错误码与文案区分', scenarioTimeoutWording)
  await scenario('F 任务保留会话错误码', scenarioJobKeepsSessionCode)

  console.log('')
  if (failures.length) {
    console.log(`结果：${failures.length} 项失败，${passed} 项通过`)
    process.exitCode = 1
  } else {
    console.log(`结果：${passed} 项全部通过`)
  }
  clearTimeout(watchdog)
  // 会话记录异步写入：dispose 的收尾可能还在跑，Windows 下并发删除会 ENOTEMPTY，重试即可。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(workspace, { recursive: true, force: true })
      break
    } catch (error) {
      if (attempt === 9) throw error
      await sleep(20)
    }
  }
}

main().catch((error) => {
  console.error('测试脚本异常：', error)
  process.exitCode = 1
})