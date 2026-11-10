#!/usr/bin/env node
/**
 * 会话本地持久化与启动恢复的离线回归（ROADMAP P0.1，不连 Kaggle、不出外网、不烧 GPU）。
 *
 * 覆盖：
 *   A. persistence.js：保存 → 读取、原子写不残留临时文件、损坏 / 旧版本 / 缺关键字段清理；
 *   B. 健康恢复：endpoint 探活成功 → ready（含 tunnelProvider），warming 阶段按 tick 轮询；
 *   C. 地址死亡但 Kernel 仍 RUNNING：用保存的 topic 回 ntfy 重新会合，接管新 endpoint；
 *   D. Kernel 已结束 / 没有 endpoint+topic：尽力 shutdown 远端并清理记录，restore 返回 null；
 *   E. 生命周期：stop() 删除记录；dispose() 关机成功才删、失败保留；fail() 保留记录；
 *   F. restore 与 stop / start 竞态：过期恢复不写回状态、不挂僵尸定时器；
 *   G. token 只落盘：快照与日志里都不出现。
 *
 * 实现方式与 session-reliability 一致：真实 SessionManager + 本机假 ntfy / 假 daemon，
 * 只替换 kaggle 相关 deps；时钟间隔通过 options 调小以加速测试。
 *
 * 运行：node test/session-restore.mjs
 */

import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '../lib/session.js'
import {
  SESSION_RECORD_VERSION,
  buildSessionRecord,
  clearSessionRecord,
  readSessionRecord,
  sessionRecordPath,
  writeSessionRecord,
} from '../lib/session/persistence.js'
import { emptySession } from '../lib/session/state.js'

const PRESET = 'sdxl-lightning'
// 远端 Bearer Token：只应出现在 session.json 里，绝不能出现在日志或快照里。
const TOKEN = 'restore-secret-token-0123456789'
const TOPIC = 'imagen-restore-topic'
const KERNEL_ID = 'tester/imagen-restore'
const STARTED_AT = '2026-01-01T00:00:00.000Z'
const READY_AT = '2026-01-01T00:05:00.000Z'
const ACCELERATED = { tickMs: 20, kernelPollMs: 40, healthyIntervalMs: 40, recoveryTimeoutMs: 2000 }

const failures = []
const logLines = []
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

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function closeServer(server) {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(() => resolve()))
}

/** 每个场景用独立工作区，避免记录文件互相干扰。 */
async function withWorkspace(fn) {
  const workspace = await mkdtemp(join(tmpdir(), 'imagen-session-restore-'))
  try {
    return await fn(workspace)
  } finally {
    // 会话记录是异步写入的：dispose 的收尾可能还在跑，Windows 下并发删除会 ENOTEMPTY，重试即可。
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
}

function makeCtx(workspace) {
  return {
    get(name) {
      return name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined
    },
  }
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

async function startCountingNtfy() {
  const state = { hits: 0 }
  const server = createServer((_req, res) => {
    state.hits += 1
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.end()
  })
  const port = await listen(server)
  return { state, port, close: () => closeServer(server) }
}

/** 假 daemon 的 /health；delayMs 用来构造「探活进行中用户 stop」的竞态。 */
async function startFakeHealth({ phase = 'ready', tunnelProvider = 'cloudflare', delayMs = 0 } = {}) {
  const state = { phase, tunnelProvider, hits: 0, delayMs }
  const server = createServer(async (req, res) => {
    state.hits += 1
    if (state.delayMs) await sleep(state.delayMs)
    if (req.destroyed) return
    const body = JSON.stringify({
      status: 'ok',
      phase: state.phase,
      version: 'test',
      model_id: 'test/model',
      loaded: ['test'],
      device: 'Fake T4',
      device_count: 2,
      idle_seconds: 0,
      idle_timeout_sec: 1800,
      jobs_done: 0,
      queue_depth: 0,
      last_error: null,
      tunnel_provider: state.tunnelProvider,
    })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  })
  const port = await listen(server)
  return { state, endpoint: `http://127.0.0.1:${port}`, close: () => closeServer(server) }
}

/** 已经关闭的端口：制造「endpoint 不可达」。 */
async function closedEndpoint() {
  const probe = createServer(() => {})
  const port = await listen(probe)
  await closeServer(probe)
  return `http://127.0.0.1:${port}`
}

function makeLogSink() {
  const push = (...args) => logLines.push(args.join(' '))
  return { debug: push, info: push, warn: push, error: push }
}

function fakeDeps({ shutdown = true, kernelStatus = null } = {}) {
  const calls = { shutdown: [], status: 0, removed: [] }
  const deps = {
    kaggleUsername: async () => 'tester',
    buildKernelFolder: async () => ({ dir: null, kernelId: KERNEL_ID, kernelUrl: `https://www.kaggle.com/code/${KERNEL_ID}` }),
    pushKernel: async () => ({ ok: true }),
    removeKernelFolder: async (dir) => {
      calls.removed.push(dir)
    },
    kernelStatus: async () => {
      calls.status += 1
      return { ok: true, status: 'RUNNING' }
    },
    kernelLogs: async () => ({ ok: true, tail: 'fake kernel log tail' }),
    requestShutdown: async (endpoint, token, timeoutMs) => {
      calls.shutdown.push({ endpoint, token, timeoutMs })
      if (typeof shutdown === 'function') return shutdown()
      return shutdown
    },
    log: makeLogSink(),
    ...(kernelStatus ? { kernelStatus } : {}),
  }
  return { deps, calls }
}

function makeSession({ workspace, ntfyPort = 9, deps = {}, options = {} }) {
  return new SessionManager({
    ctx: makeCtx(workspace),
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

/** 构造一条可恢复的会话记录（patch 覆盖会话字段，secret 覆盖 token/topic）。 */
function recordOf(patch = {}, secret = {}) {
  const record = buildSessionRecord(
    {
      ...emptySession({ idleTimeoutSec: 1800 }),
      presetId: PRESET,
      kernelId: KERNEL_ID,
      kernelUrl: `https://www.kaggle.com/code/${KERNEL_ID}`,
      kernelStatus: 'RUNNING',
      endpointUrl: null,
      startedAt: STARTED_AT,
      readyAt: READY_AT,
      state: 'ready',
      ...patch,
    },
    { token: TOKEN, topic: TOPIC, ...secret },
  )
  if (!record) throw new Error('测试记录构造失败：缺少 token / 关键字段')
  return record
}

// ---- A. persistence.js 读写与清理 ---------------------------------------

async function scenarioPersistenceRoundtrip() {
  console.log('\n── A1 保存 → 读取与原子写')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const path = sessionRecordPath(ctx)
    const record = recordOf({
      endpointUrl: 'https://abc-def.trycloudflare.com',
      device: 'Fake T4',
      deviceCount: 2,
      modelId: 'test/model',
      tunnelProvider: 'cloudflare',
    })

    check('buildSessionRecord 记录字段齐全', record.version === SESSION_RECORD_VERSION && record.token === TOKEN && record.topic === TOPIC)
    check(
      '无可恢复信息时不生成记录',
      buildSessionRecord({ ...emptySession(), state: 'absent' }, {}) === null &&
        buildSessionRecord({ kernelId: KERNEL_ID }, { token: null }) === null,
    )

    await writeSessionRecord(ctx, record)
    check('记录文件已落盘', await exists(path))
    const raw = await readFile(path, 'utf8')
    check('token 只写在磁盘文件里', raw.includes(TOKEN))
    const entries = await readdir(join(workspace, '.imagen'))
    check('原子写不残留临时文件', !entries.some((name) => name.includes('.tmp-')), entries.join(','))

    const loaded = await readSessionRecord(ctx)
    check(
      '读取后关键字段一致',
      loaded?.version === SESSION_RECORD_VERSION &&
        loaded?.kernelId === KERNEL_ID &&
        loaded?.token === TOKEN &&
        loaded?.topic === TOPIC &&
        loaded?.endpointUrl === 'https://abc-def.trycloudflare.com' &&
        loaded?.tunnelProvider === 'cloudflare' &&
        loaded?.deviceCount === 2 &&
        loaded?.state === 'ready' &&
        Boolean(loaded?.savedAt),
    )

    if (process.platform !== 'win32') {
      const dirMode = (await stat(join(workspace, '.imagen'))).mode & 0o777
      const fileMode = (await stat(path)).mode & 0o777
      check('目录 0700、文件 0600', dirMode === 0o700 && fileMode === 0o600, `${dirMode.toString(8)}/${fileMode.toString(8)}`)
    }

    await clearSessionRecord(ctx)
    check('clearSessionRecord 删除记录', !(await exists(path)))
    check('无记录时读取返回 null', (await readSessionRecord(ctx)) === null)
  })
}

async function scenarioCorruptRecords() {
  console.log('\n── A2 损坏 / 旧版本 / 缺关键字段清理')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const dir = join(workspace, '.imagen')
    const path = sessionRecordPath(ctx)
    await mkdir(dir, { recursive: true })

    await writeFile(path, '{不是 JSON', 'utf8')
    check('损坏 JSON → 返回 null', (await readSessionRecord(ctx)) === null)
    check('损坏 JSON 被清理', !(await exists(path)))

    await writeFile(path, JSON.stringify({ version: 99, token: TOKEN, kernelId: KERNEL_ID }), 'utf8')
    check('旧版本记录 → 返回 null', (await readSessionRecord(ctx)) === null)
    check('旧版本记录被清理', !(await exists(path)))

    await writeFile(path, JSON.stringify({ version: SESSION_RECORD_VERSION, kernelId: KERNEL_ID }), 'utf8')
    check('缺 token 的记录 → 返回 null', (await readSessionRecord(ctx)) === null)
    check('缺 token 的记录被清理', !(await exists(path)))

    await writeFile(path, JSON.stringify({ version: SESSION_RECORD_VERSION, token: TOKEN }), 'utf8')
    check('没有任何地址线索的记录 → 返回 null', (await readSessionRecord(ctx)) === null)

    await writeSessionRecord(ctx, recordOf({ endpointUrl: 'https://abc-def.trycloudflare.com' }))
    check('有效记录不会被清理', (await readSessionRecord(ctx))?.token === TOKEN)
    await clearSessionRecord(ctx)
    check('清理后再次读取返回 null', (await readSessionRecord(ctx)) === null)
  })
}

// ---- B. 健康恢复 ---------------------------------------------------------

async function scenarioRestoreReady() {
  console.log('\n── B1 endpoint 存活 → 恢复 ready')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const health = await startFakeHealth({ phase: 'ready', tunnelProvider: 'cloudflare' })
    const { deps, calls } = fakeDeps()
    const session = makeSession({ workspace, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: health.endpoint }))
      const snapshot = await session.restore()

      check('restore 返回恢复后的快照', snapshot?.state === 'ready', JSON.stringify(snapshot?.error))
      check(
        '记录字段被恢复',
        snapshot?.kernelId === KERNEL_ID &&
          snapshot?.kernelUrl === `https://www.kaggle.com/code/${KERNEL_ID}` &&
          snapshot?.presetId === PRESET &&
          snapshot?.startedAt === STARTED_AT &&
          snapshot?.readyAt === READY_AT,
      )
      check('endpoint 被恢复', snapshot?.endpointUrl === health.endpoint)
      check(
        '健康信息覆盖设备与模型',
        snapshot?.device === 'Fake T4' &&
          snapshot?.deviceCount === 2 &&
          snapshot?.modelId === 'test/model' &&
          snapshot?.idleTimeoutSec === 1800,
      )
      check('tunnelProvider 来自 /health', snapshot?.tunnelProvider === 'cloudflare')
      check('lastProbeAt 已更新', typeof snapshot?.lastProbeAt === 'string')
      check('ready 恢复后挂了健康与 Kernel 两种轮询', session.timers.size === 2, `${session.timers.size}`)
      check('endpoint 探活确实发生', health.state.hits >= 1)
      check('地址存活时不查 Kernel 状态（省一次 CLI）', calls.status === 0)
      check('快照不含 token', !JSON.stringify(snapshot).includes(TOKEN))
      check('恢复文案可读', snapshot?.detail === '已从本地记录恢复会话')

      await session.persistChain
      const saved = await readSessionRecord(ctx)
      check(
        '恢复后记录更新为 ready',
        saved?.state === 'ready' && saved?.endpointUrl === health.endpoint && saved?.tunnelProvider === 'cloudflare',
      )

      const hitsBefore = health.state.hits
      await waitFor('健康轮询继续', () => health.state.hits > hitsBefore, { timeoutMs: 3000 })
      check('恢复后健康轮询不中断', health.state.hits > hitsBefore)

      // 与 stop 竞争的一次写入：删除必须排在挂起写入之后，否则记录会被「复活」。
      session.persistSession({ force: true })
      await session.stop()
      check('stop 后记录被删除', !(await exists(sessionRecordPath(ctx))))
      await sleep(40)
      check('迟到的写入不会复活已删除的记录', !(await exists(sessionRecordPath(ctx))))
      check('stop 后会话回到 absent', session.snapshot().state === 'absent')
    } finally {
      session.dispose()
      await health.close()
    }
  })
}

async function scenarioRestoreWarming() {
  console.log('\n── B2 endpoint 存活但仍在加载 → warming 轮询')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    // 故意给非法通道值：应归一为 null 而不是原样透传。
    const health = await startFakeHealth({ phase: 'loading', tunnelProvider: 'frp' })
    const { deps } = fakeDeps()
    const session = makeSession({
      workspace,
      deps,
      options: { tickMs: 5000, kernelPollMs: 5000, healthyIntervalMs: 5000 },
    })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: health.endpoint, state: 'warming', readyAt: null }))
      const snapshot = await session.restore()

      check('恢复为 warming（等健康轮询推进到 ready）', snapshot?.state === 'warming')
      check('phase=warm 且文案来自 /health', snapshot?.phase === 'warm' && snapshot?.detail === '远端加载模型')
      check('非法 tunnel_provider 归一为 null', snapshot?.tunnelProvider === null)
      check('warming 恢复挂心跳与 Kernel 轮询', session.timers.size === 2)
    } finally {
      session.dispose()
      await health.close()
    }
  })
}

// ---- C. 地址死亡后重新会合 ----------------------------------------------

async function scenarioRendezvousWhenEndpointDead() {
  console.log('\n── C1 endpoint 不通 + Kernel 仍运行 → ntfy 重新会合')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const ntfy = await startFakeNtfy()
    const health = await startFakeHealth({ phase: 'ready', tunnelProvider: 'custom' })
    const dead = await closedEndpoint()
    ntfy.state.line = ntfyMessage({
      type: 'ready',
      endpoint: health.endpoint,
      provider: 'custom',
      model_id: 'test/model',
      device: 'Fake T4',
    })
    const { deps, calls } = fakeDeps()
    const session = makeSession({ workspace, ntfyPort: ntfy.port, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: dead }))
      const restored = await session.restore()

      check('地址不可达 → 先进入隧道重会合', restored?.state === 'connecting' && restored?.phase === 'tunnel')
      check('重新会合按新时间计时', Date.parse(restored?.startedAt ?? 0) > Date.parse(STARTED_AT))
      check('会合前查过 Kernel 状态', calls.status >= 1)
      check('未把失效地址留在状态里', restored?.endpointUrl === null)

      await waitFor('重新会合后回到 ready', () => session.snapshot().state === 'ready', { timeoutMs: 5000 })
      const snapshot = session.snapshot()
      check('拿到新的隧道地址', snapshot.endpointUrl === health.endpoint)
      check('ready 事件的 provider 进入快照', snapshot.tunnelProvider === 'custom')
      check('ntfy 会合点被轮询', ntfy.state.hits >= 1)

      await session.persistChain
      const saved = await readSessionRecord(ctx)
      check('重新会合后的地址已落盘', saved?.endpointUrl === health.endpoint && saved?.state === 'ready')
    } finally {
      session.dispose()
      await ntfy.close()
      await health.close()
    }
  })
}

// ---- D. 清理路径 ---------------------------------------------------------

async function scenarioKernelEndedCleanup() {
  console.log('\n── D1 Kernel 已结束 → 尽力关机并清理')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const dead = await closedEndpoint()
    const { deps, calls } = fakeDeps({ kernelStatus: async () => ({ ok: true, status: 'COMPLETE' }) })
    const session = makeSession({ workspace, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: dead }))
      const restored = await session.restore()

      check('Kernel 已结束 → restore 返回 null', restored === null)
      check('记录被清理', !(await exists(sessionRecordPath(ctx))))
      check(
        '尽力 shutdown 远端（带 endpoint/token/3s 超时）',
        calls.shutdown.length === 1 &&
          calls.shutdown[0].endpoint === dead &&
          calls.shutdown[0].token === TOKEN &&
          calls.shutdown[0].timeoutMs === 3000,
        JSON.stringify(calls.shutdown),
      )
      check('状态保持 absent', session.snapshot().state === 'absent')
      check('没有残留定时器', session.timers.size === 0)
      check('清理文案可读', /清理/.test(session.snapshot().detail ?? ''))
      check('远端 token 未进日志', !logLines.some((line) => line.includes(TOKEN)))
    } finally {
      session.dispose()
    }
  })
}

async function scenarioNoRendezvousCleanup() {
  console.log('\n── D2 没有 endpoint/topic → 直接清理')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps, calls } = fakeDeps()
    const session = makeSession({ workspace, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: null }, { topic: null }))
      const restored = await session.restore()

      check('缺少地址线索 → restore 返回 null', restored === null)
      check('记录被清理', !(await exists(sessionRecordPath(ctx))))
      check('没有地址就不发关机请求（避免泄露 token）', calls.shutdown.length === 0)
      check('状态保持 absent', session.snapshot().state === 'absent')
    } finally {
      session.dispose()
    }
  })
}

// ---- E. 生命周期清理 -----------------------------------------------------

async function scenarioStopDeletesRecord() {
  console.log('\n── E1 stop() 删除记录')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps, calls } = fakeDeps()
    const session = makeSession({ workspace, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: 'https://abc-def.trycloudflare.com' }))
      check('记录已写入', await exists(sessionRecordPath(ctx)))
      const snapshot = await session.stop()
      check('stop 后记录被删除', !(await exists(sessionRecordPath(ctx))))
      check('stop 后状态为 absent', snapshot.state === 'absent')
      check(
        '内存中没有连接信息时也能按记录尽力关机',
        calls.shutdown.length === 1 &&
          calls.shutdown[0].endpoint === 'https://abc-def.trycloudflare.com' &&
          calls.shutdown[0].token === TOKEN,
        JSON.stringify(calls.shutdown),
      )
    } finally {
      session.dispose()
    }
  })
}

async function scenarioDisposeBranches() {
  console.log('\n── E2 dispose()：关机成功才删记录，失败保留')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const health = await startFakeHealth({ phase: 'ready' })
    const path = sessionRecordPath(ctx)

    // 成功：requestShutdown 返回 true → 删掉记录。
    const ok = fakeDeps()
    const okSession = makeSession({ workspace, deps: ok.deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: health.endpoint }))
      await okSession.restore()
      okSession.dispose()
      await okSession.disposeCleanup
      check('关机成功 → 记录被删除', !(await exists(path)))
      check(
        '关机成功 → 通知带 endpoint/token',
        ok.calls.shutdown.length === 1 && ok.calls.shutdown[0].token === TOKEN,
        JSON.stringify(ok.calls.shutdown),
      )
    } finally {
      okSession.dispose()
    }

    // 失败：requestShutdown 返回 false → 保留记录，下次启动继续清理。
    const failed = fakeDeps({ shutdown: false })
    const failedSession = makeSession({ workspace, deps: failed.deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: health.endpoint }))
      await failedSession.restore()
      failedSession.dispose()
      await failedSession.disposeCleanup
      check('关机失败 → 记录保留', await exists(path))
      check('保留的记录仍可读取', (await readSessionRecord(ctx))?.token === TOKEN)
    } finally {
      failedSession.dispose()
      await clearSessionRecord(ctx)
    }

    // 异常：requestShutdown 抛错同样按失败处理（保留记录）。
    const threw = fakeDeps({
      shutdown: () => {
        throw new Error('网络已断开')
      },
    })
    const threwSession = makeSession({ workspace, deps: threw.deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: health.endpoint }))
      await threwSession.restore()
      threwSession.dispose()
      await threwSession.disposeCleanup
      check('关机通知抛错 → 记录保留', await exists(path))
    } finally {
      threwSession.dispose()
      await clearSessionRecord(ctx)
      await health.close()
    }
  })
}

async function scenarioFailKeepsRecord() {
  console.log('\n── E3 fail() 保留记录（远端可能仍活着）')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps } = fakeDeps()
    const session = makeSession({
      workspace,
      deps,
      options: { devEndpoint: 'http://127.0.0.1:9', devToken: TOKEN },
    })
    try {
      await session.start(PRESET)
      session.fail('remote_error', '模拟远端异常')
      await session.persistChain
      check('fail 后记录保留在磁盘', await exists(sessionRecordPath(ctx)))
      check('保留记录的 state 为 error', (await readSessionRecord(ctx))?.state === 'error')
    } finally {
      session.dispose()
      await session.disposeCleanup
    }
  })
}

// ---- F. restore 竞态 -----------------------------------------------------

async function scenarioRestoreStopRace() {
  console.log('\n── F1 restore 探活期间 stop')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const slow = await startFakeHealth({ phase: 'ready', delayMs: 200 })
    const { deps } = fakeDeps()
    const session = makeSession({ workspace, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: slow.endpoint }))
      const pending = session.restore()
      await sleep(40)
      const stopped = await session.stop()
      const restored = await pending

      check('stop 立即生效', stopped.state === 'absent')
      check('过期的恢复不写回状态', restored?.state === 'absent' && session.snapshot().state === 'absent')
      check('过期的恢复不挂定时器', session.timers.size === 0)
      check('过期的恢复不把 token 装回内存', session.secret.token === null)
      check('stop 已删除记录', !(await exists(sessionRecordPath(ctx))))
    } finally {
      session.dispose()
      await slow.close()
    }
  })
}

async function scenarioRestoreStartRace() {
  console.log('\n── F2 restore 探活期间用户 start')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const slow = await startFakeHealth({ phase: 'ready', delayMs: 200 })
    const ntfy = await startCountingNtfy()
    const { deps } = fakeDeps()
    const session = makeSession({ workspace, ntfyPort: ntfy.port, deps })
    try {
      await writeSessionRecord(ctx, recordOf({ endpointUrl: slow.endpoint }))
      const pending = session.restore()
      await sleep(40)
      const started = await session.start(PRESET)
      check('用户 start 正常启动', started.state === 'provisioning', started.state)

      const restored = await pending
      check('过期的恢复返回当前快照', restored?.state === 'provisioning')
      check('过期的恢复不覆盖新启动', session.snapshot().state === 'provisioning')
      check('过期的恢复不把旧记录 token 装回内存', session.secret.token !== TOKEN)
      await sleep(80)
      check('新启动保持 provisioning', session.snapshot().state === 'provisioning')
      await session.stop()
      check('stop 后清理记录', !(await exists(sessionRecordPath(ctx))))
    } finally {
      session.dispose()
      await slow.close()
      await ntfy.close()
    }
  })
}

async function scenario(title, fn) {
  try {
    await fn()
  } catch (error) {
    failures.push(title)
    console.log(`\n  ✗ ${title} 场景异常：${error?.message ?? error}`)
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error('\n测试超时（60s），强制退出')
    process.exit(2)
  }, 60000)
  watchdog.unref?.()

  console.log('session-restore：会话本地持久化与启动恢复离线回归（无 Kaggle / 无 GPU / 无外网）')
  await scenario('A1 保存 → 读取', scenarioPersistenceRoundtrip)
  await scenario('A2 损坏记录清理', scenarioCorruptRecords)
  await scenario('B1 健康恢复 ready', scenarioRestoreReady)
  await scenario('B2 健康恢复 warming', scenarioRestoreWarming)
  await scenario('C1 地址死亡后重新会合', scenarioRendezvousWhenEndpointDead)
  await scenario('D1 Kernel 已结束清理', scenarioKernelEndedCleanup)
  await scenario('D2 无地址线索清理', scenarioNoRendezvousCleanup)
  await scenario('E1 stop 删除记录', scenarioStopDeletesRecord)
  await scenario('E2 dispose 成功/失败分支', scenarioDisposeBranches)
  await scenario('E3 fail 保留记录', scenarioFailKeepsRecord)
  await scenario('F1 restore 与 stop 竞态', scenarioRestoreStopRace)
  await scenario('F2 restore 与 start 竞态', scenarioRestoreStartRace)

  console.log('\n── G token 只落盘')
  check('所有日志都不含远端 token', !logLines.some((line) => line.includes(TOKEN)))

  console.log('')
  if (failures.length) {
    console.log(`结果：${failures.length} 项失败，${passed} 项通过`)
    process.exitCode = 1
  } else {
    console.log(`结果：${passed} 项全部通过`)
  }
  clearTimeout(watchdog)
}

main().catch((error) => {
  console.error('测试脚本异常：', error)
  process.exitCode = 1
})