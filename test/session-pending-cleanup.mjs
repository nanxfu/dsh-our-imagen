#!/usr/bin/env node
/**
 * 卸载未关机补清理（v0.9 M1 第 2 项）的离线回归，不连 Kaggle、不出外网、不烧 GPU。
 *
 * 覆盖：
 *   A. pending-cleanup.js 纯函数：记录组装、读取校验、TTL 判定；
 *   B. dispose()：关机成功清待清理记录；失败同步落盘待清理记录并删会话记录；
 *      无连接信息 / 开发模式不落盘；记录 0700/0600、不残留临时文件；
 *   C. cleanupPendingSession()：启动补发成功清记录与会话记录；失败累加 attempts；
 *      达到上限 / 超过 TTL / 地址不可信时丢弃并留 warn；
 *   D. 与 restore() 的顺序语义：先补清理再恢复，补清理成功后 restore 不接手；
 *   E. token 只落盘，不进入日志。
 *
 * 实现方式与 session-restore 一致：真实 SessionManager + 本机假 daemon 健康接口，
 * 只替换 kaggle 相关 deps；时钟间隔通过 options 调小以加速测试。
 *
 * 运行：node test/session-pending-cleanup.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '../lib/session.js'
import {
  PENDING_CLEANUP_MAX_ATTEMPTS,
  PENDING_CLEANUP_TTL_MS,
  PENDING_CLEANUP_VERSION,
  buildPendingCleanupRecord,
  clearPendingCleanup,
  isPendingCleanupExpired,
  pendingCleanupPath,
  readPendingCleanup,
  writePendingCleanup,
} from '../lib/session/pending-cleanup.js'
import {
  buildSessionRecord,
  clearSessionRecord,
  sessionRecordPath,
  writeSessionRecord,
} from '../lib/session/persistence.js'
import { emptySession } from '../lib/session/state.js'

const PRESET = 'sdxl-lightning'
// 远端 Bearer Token：只应出现在 0600 的落盘文件里，绝不能进入日志。
const TOKEN = 'pending-secret-token-0123456789'
const TOPIC = 'imagen-pending-topic'
const KERNEL_ID = 'tester/imagen-pending'
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
  const workspace = await mkdtemp(join(tmpdir(), 'imagen-pending-cleanup-'))
  try {
    return await fn(workspace)
  } finally {
    // dispose 的收尾是异步的：Windows 下并发删除会 ENOTEMPTY，重试即可。
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

/** 假 daemon 的 /health：返回 ready，供 restore() 把 endpoint/token 装进内存。 */
async function startFakeHealth() {
  const state = { hits: 0 }
  const server = createServer((_req, res) => {
    state.hits += 1
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
  return { state, endpoint: `http://127.0.0.1:${port}`, close: () => closeServer(server) }
}

function makeLogSink() {
  const push = (...args) => logLines.push(args.join(' '))
  return { debug: push, info: push, warn: push, error: push }
}

function fakeDeps({ shutdown = true } = {}) {
  const calls = { shutdown: [], status: 0 }
  const deps = {
    kaggleUsername: async () => 'tester',
    buildKernelFolder: async () => ({ dir: null, kernelId: KERNEL_ID, kernelUrl: `https://www.kaggle.com/code/${KERNEL_ID}` }),
    pushKernel: async () => ({ ok: true }),
    removeKernelFolder: async () => {},
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
  }
  return { deps, calls }
}

function makeSession({ workspace, deps = {}, options = {} }) {
  return new SessionManager({
    ctx: makeCtx(workspace),
    defaultPreset: PRESET,
    deps,
    options: {
      ntfyBase: 'http://127.0.0.1:9',
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 10 * 60 * 1000,
      enableGpu: true,
      ...ACCELERATED,
      ...options,
    },
  })
}

/** 构造一条可恢复的会话记录，用于把 endpoint/token 通过 restore() 装进内存。 */
function recordOf({ endpointUrl }) {
  const record = buildSessionRecord(
    {
      ...emptySession({ idleTimeoutSec: 1800 }),
      presetId: PRESET,
      kernelId: KERNEL_ID,
      kernelUrl: `https://www.kaggle.com/code/${KERNEL_ID}`,
      kernelStatus: 'RUNNING',
      endpointUrl,
      startedAt: STARTED_AT,
      readyAt: READY_AT,
      state: 'ready',
    },
    { token: TOKEN, topic: TOPIC },
  )
  if (!record) throw new Error('测试记录构造失败')
  return record
}

/** 组装一条待清理记录（默认未过期、attempts=0）。 */
function pendingRecord({
  endpointUrl = 'http://127.0.0.1:9',
  token = TOKEN,
  savedAt = new Date().toISOString(),
  attempts = 0,
} = {}) {
  return {
    version: PENDING_CLEANUP_VERSION,
    savedAt,
    endpointUrl,
    token,
    kernelId: KERNEL_ID,
    topic: TOPIC,
    presetId: PRESET,
    attempts,
  }
}

/** 启动一个「已就绪」的会话，内存里带 endpoint/token（走真实 restore 流程）。 */
async function seedReadySession({ workspace, health, deps }) {
  const ctx = makeCtx(workspace)
  await writeSessionRecord(ctx, recordOf({ endpointUrl: health.endpoint }))
  const session = makeSession({ workspace, deps })
  const snapshot = await session.restore()
  if (snapshot?.state !== 'ready') throw new Error(`会话未就绪：${JSON.stringify(snapshot?.error)}`)
  return session
}
// ---- A. 纯函数 -----------------------------------------------------------

async function scenarioPureFunctions() {
  console.log('\n── A pending-cleanup.js 纯函数')

  await check('buildPendingCleanupRecord：缺 token / endpoint 返回 null', () => {
    check(
      'buildPendingCleanupRecord 缺地址返回 null',
      buildPendingCleanupRecord({ kernelId: KERNEL_ID }, { token: TOKEN }) === null &&
        buildPendingCleanupRecord({ endpointUrl: 'http://127.0.0.1:9' }, {}) === null,
    )
    const fixedNow = Date.parse('2026-01-02T03:04:05.000Z')
    const record = buildPendingCleanupRecord(
      { endpointUrl: 'http://127.0.0.1:9', kernelId: KERNEL_ID, presetId: PRESET },
      { token: TOKEN, topic: TOPIC },
      fixedNow,
    )
    check(
      'buildPendingCleanupRecord 字段齐全',
      record.version === PENDING_CLEANUP_VERSION &&
        record.savedAt === '2026-01-02T03:04:05.000Z' &&
        record.endpointUrl === 'http://127.0.0.1:9' &&
        record.token === TOKEN &&
        record.kernelId === KERNEL_ID &&
        record.topic === TOPIC &&
        record.presetId === PRESET &&
        record.attempts === 0,
      JSON.stringify({ ...record, token: record.token ? '<token>' : null }),
    )
  })

  await check('isPendingCleanupExpired：TTL 内有效、超期 / 缺 savedAt 视为过期', () => {
    const now = Date.now()
    check('新鲜记录未过期', isPendingCleanupExpired(pendingRecord({ savedAt: new Date(now).toISOString() }), now) === false)
    check(
      '23 小时前的记录未过期',
      isPendingCleanupExpired(pendingRecord({ savedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString() }), now) === false,
    )
    check(
      '超过 24 小时的记录视为过期',
      isPendingCleanupExpired(pendingRecord({ savedAt: new Date(now - PENDING_CLEANUP_TTL_MS - 1000).toISOString() }), now) ===
        true,
    )
    check('非法 savedAt 视为过期', isPendingCleanupExpired({ savedAt: 'not-a-date' }, now) === true)
  })
}

// ---- B. dispose 行为 -----------------------------------------------------

async function scenarioDisposeSuccess() {
  console.log('\n── B1 dispose() 关机成功：清待清理记录与会话记录')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const health = await startFakeHealth()
    const { deps, calls } = fakeDeps({ shutdown: true })
    const pendingPath = pendingCleanupPath(ctx)
    let session = null
    try {
      session = await seedReadySession({ workspace, health, deps })
      session.dispose()
      // dispose 路径同步落盘：不 await 收尾承诺就能看到待清理记录。
      check('dispose() 返回时待清理记录已同步落盘', existsSync(pendingPath))
      check('同步落盘的记录可解析且带 token', JSON.parse(readFileSync(pendingPath, 'utf8')).token === TOKEN)

      await session.disposeCleanup
      check('关机成功 → 待清理记录被删除', !(await exists(pendingPath)))
      check('关机成功 → 会话记录被删除', !(await exists(sessionRecordPath(ctx))))
      check(
        '关机成功 → 通知带 endpoint/token/3s 超时',
        calls.shutdown.length === 1 &&
          calls.shutdown[0].endpoint === health.endpoint &&
          calls.shutdown[0].token === TOKEN &&
          calls.shutdown[0].timeoutMs === 3000,
        JSON.stringify(calls.shutdown.map((item) => ({ ...item, token: '<token>' }))),
      )
    } finally {
      session?.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
      await health.close()
    }
  })
}

async function scenarioDisposeFailure() {
  console.log('\n── B2 dispose() 关机失败：保留待清理记录、删会话记录')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const health = await startFakeHealth()
    const { deps } = fakeDeps({ shutdown: false })
    const pendingPath = pendingCleanupPath(ctx)
    let session = null
    try {
      session = await seedReadySession({ workspace, health, deps })
      session.dispose()
      check('关机失败 → dispose() 返回时记录已同步落盘', existsSync(pendingPath))
      await session.disposeCleanup

      const pending = await readPendingCleanup(ctx)
      check(
        '待清理记录字段可用于下次补发关机',
        pending?.version === PENDING_CLEANUP_VERSION &&
          pending?.endpointUrl === health.endpoint &&
          pending?.token === TOKEN &&
          pending?.kernelId === KERNEL_ID &&
          pending?.topic === TOPIC &&
          pending?.presetId === PRESET &&
          pending?.attempts === 0 &&
          !Number.isNaN(Date.parse(pending?.savedAt ?? '')),
        JSON.stringify({ ...pending, token: pending?.token ? '<token>' : null }),
      )
      check('关机失败 → 会话记录被删除（避免下次 restore 接手/长等会合）', !(await exists(sessionRecordPath(ctx))))
      check('关机失败 → 待清理记录保留', await exists(pendingPath))

      if (process.platform !== 'win32') {
        const dirMode = (await stat(join(workspace, '.imagen'))).mode & 0o777
        const fileMode = (await stat(pendingPath)).mode & 0o777
        check('记录目录 0700、文件 0600', dirMode === 0o700 && fileMode === 0o600, `${dirMode.toString(8)}/${fileMode.toString(8)}`)
      }
      check(
        '不残留临时文件',
        !(await readdir(join(workspace, '.imagen'))).some((name) => name.includes('.tmp-')),
      )
      check('日志不含 token', !logLines.some((line) => line.includes(TOKEN)))
    } finally {
      session?.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
      await health.close()
    }
  })

  await withWorkspace(async (workspace) => {
    console.log('  · 无连接信息 / 开发模式不落盘')
    const ctx = makeCtx(workspace)
    const { deps } = fakeDeps({ shutdown: true })
    const fresh = makeSession({ workspace, deps })
    try {
      fresh.dispose()
      await fresh.disposeCleanup
      check('无连接信息时 dispose() 不写待清理记录', !(await exists(pendingCleanupPath(ctx))))
    } finally {
      fresh.dispose()
    }

    const devSession = makeSession({
      workspace,
      deps: fakeDeps({ shutdown: true }).deps,
      options: { devEndpoint: 'http://127.0.0.1:9', devToken: TOKEN },
    })
    try {
      await devSession.start(PRESET)
      check('开发模式会话直接 ready', devSession.snapshot().state === 'ready')
      check('开发模式不组装待清理记录', devSession.pendingCleanupRecord() === null)
      devSession.dispose()
      await devSession.disposeCleanup
      check('开发模式 dispose() 不写待清理记录', !(await exists(pendingCleanupPath(ctx))))
    } finally {
      devSession.dispose()
    }
  })
}

// ---- C. 启动补发 ---------------------------------------------------------

async function scenarioStartupCleanupSuccess() {
  console.log('\n── C1 启动补发成功：清记录 + 会话记录，restore 不再接手')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    await writePendingCleanup(ctx, pendingRecord())
    // 模拟上次进程在清理会话记录前退出：会话记录还在。
    await writeSessionRecord(ctx, recordOf({ endpointUrl: 'http://127.0.0.1:9' }))

    const { deps, calls } = fakeDeps({ shutdown: true })
    const session = makeSession({ workspace, deps })
    try {
      const cleaned = await session.cleanupPendingSession()
      check('补发成功返回 true', cleaned === true)
      check('补发成功 → 待清理记录被删除', !(await exists(pendingCleanupPath(ctx))))
      check('补发成功 → 残留的会话记录被删除', !(await exists(sessionRecordPath(ctx))))
      check(
        '补发关机带 endpoint/token/3s 超时',
        calls.shutdown.length === 1 &&
          calls.shutdown[0].endpoint === 'http://127.0.0.1:9' &&
          calls.shutdown[0].token === TOKEN &&
          calls.shutdown[0].timeoutMs === 3000,
        JSON.stringify(calls.shutdown.map((item) => ({ ...item, token: '<token>' }))),
      )

      // 顺序语义：cleanup 成功后再 restore，不应重新接手已关机的会话。
      const restored = await session.restore()
      check('随后 restore() 返回 null（不接手已补发关机的会话）', restored === null)
      check('随后 restore() 不挂定时器且状态保持 absent', session.timers.size === 0 && session.snapshot().state === 'absent')
      check('日志记录 pending_cleanup_done', logLines.some((line) => line.includes('pending_cleanup_done')))
      check('日志不含 token', !logLines.some((line) => line.includes(TOKEN)))
    } finally {
      session.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
    }
  })
}

async function scenarioStartupCleanupRetry() {
  console.log('\n── C2 启动补发失败：累加 attempts，恢复后清记录')
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const savedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await writePendingCleanup(ctx, pendingRecord({ savedAt }))

    const { deps, calls } = fakeDeps({ shutdown: false })
    const session = makeSession({ workspace, deps })
    try {
      check('补发失败返回 false', (await session.cleanupPendingSession()) === false)
      const afterFirst = await readPendingCleanup(ctx)
      check('失败一次 → attempts=1', afterFirst?.attempts === 1, JSON.stringify(afterFirst?.attempts))
      check('重试不刷新 savedAt（24h 从首次落盘算）', afterFirst?.savedAt === savedAt)
      check('失败后记录仍在', await exists(pendingCleanupPath(ctx)))
      check('失败留 warn 日志', logLines.some((line) => line.includes('pending_cleanup_retry attempts=1/')))

      check('再失败一次返回 false', (await session.cleanupPendingSession()) === false)
      check('失败两次 → attempts=2', (await readPendingCleanup(ctx))?.attempts === 2)
      check('累计发起两次关机通知', calls.shutdown.length === 2)

      // 网络恢复后重试成功：清记录。
      session.deps.requestShutdown = async () => true
      check('恢复后补发成功返回 true', (await session.cleanupPendingSession()) === true)
      check('补发成功后记录被删除', !(await exists(pendingCleanupPath(ctx))))
      check('日志记录 pending_cleanup_done', logLines.some((line) => line.includes('pending_cleanup_done')))
      check('日志不含 token', !logLines.some((line) => line.includes(TOKEN)))
    } finally {
      session.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
    }
  })
}

async function scenarioStartupCleanupDiscard() {
  console.log('\n── C3 启动补发丢弃分支（上限 / TTL / 不可信地址）')

  // attempts 达到上限前最后一次失败：累加后丢弃。
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps, calls } = fakeDeps({ shutdown: false })
    const session = makeSession({ workspace, deps })
    try {
      await writePendingCleanup(ctx, pendingRecord({ attempts: PENDING_CLEANUP_MAX_ATTEMPTS - 1 }))
      check('最后一次补发失败返回 false', (await session.cleanupPendingSession()) === false)
      check('达到上限后丢弃记录', !(await exists(pendingCleanupPath(ctx))))
      check('最后一次仍尝试过一次关机', calls.shutdown.length === 1)
      check('留 warn 日志（max_attempts）', logLines.some((line) => line.includes('pending_cleanup_discard reason=max_attempts')))
    } finally {
      session.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
    }
  })

  // attempts 已用尽：直接丢弃，不再发关机（即使网络看起来可用）。
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps, calls } = fakeDeps({ shutdown: true })
    const session = makeSession({ workspace, deps })
    try {
      await writePendingCleanup(ctx, pendingRecord({ attempts: PENDING_CLEANUP_MAX_ATTEMPTS }))
      check('attempts 已用尽返回 false', (await session.cleanupPendingSession()) === false)
      check('attempts 用尽不再发关机通知', calls.shutdown.length === 0)
      check('attempts 用尽后记录被丢弃', !(await exists(pendingCleanupPath(ctx))))
    } finally {
      session.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
    }
  })

  // 超过 TTL：Kernel 早已结束（最长 3h），不再补发。
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps, calls } = fakeDeps({ shutdown: true })
    const session = makeSession({ workspace, deps })
    try {
      await writePendingCleanup(ctx, pendingRecord({ savedAt: new Date(Date.now() - PENDING_CLEANUP_TTL_MS - 60 * 1000).toISOString() }))
      check('超过 TTL 返回 false', (await session.cleanupPendingSession()) === false)
      check('超过 TTL 不发关机通知', calls.shutdown.length === 0)
      check('超过 TTL 后记录被丢弃', !(await exists(pendingCleanupPath(ctx))))
      check('留 warn 日志（expired）', logLines.some((line) => line.includes('pending_cleanup_discard reason=expired')))
    } finally {
      session.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
    }
  })

  // 不可信地址：不发 token，直接丢弃。
  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const { deps, calls } = fakeDeps({ shutdown: true })
    const session = makeSession({ workspace, deps })
    try {
      await writePendingCleanup(ctx, pendingRecord({ endpointUrl: 'https://evil.example.com' }))
      check('不可信地址返回 false', (await session.cleanupPendingSession()) === false)
      check('不可信地址不发送 token', calls.shutdown.length === 0)
      check('不可信地址记录被丢弃', !(await exists(pendingCleanupPath(ctx))))
      check('留 warn 日志（untrusted_endpoint）', logLines.some((line) => line.includes('reason=untrusted_endpoint')))
    } finally {
      session.dispose()
      await clearPendingCleanup(ctx)
      await clearSessionRecord(ctx)
    }
  })
}

// ---- D. 读取校验 ---------------------------------------------------------

async function scenarioReadValidation() {
  console.log('\n── D readPendingCleanup 读取校验')

  await withWorkspace(async (workspace) => {
    const ctx = makeCtx(workspace)
    const path = pendingCleanupPath(ctx)
    await mkdir(join(workspace, '.imagen'), { recursive: true })

    check('无文件返回 null', (await readPendingCleanup(ctx)) === null)
    check('无记录时启动补清理返回 null', (await makeSession({ workspace }).cleanupPendingSession()) === null)

    await writeFile(path, '{不是 JSON', 'utf8')
    check('损坏 JSON → null', (await readPendingCleanup(ctx)) === null)
    check('损坏 JSON 被清理', !(await exists(path)))

    await writeFile(path, JSON.stringify({ ...pendingRecord(), version: 99 }), 'utf8')
    check('版本不符 → null', (await readPendingCleanup(ctx)) === null)
    check('版本不符被清理', !(await exists(path)))

    await writeFile(path, JSON.stringify({ ...pendingRecord(), token: '' }), 'utf8')
    check('缺 token → null', (await readPendingCleanup(ctx)) === null)
    check('缺 token 被清理', !(await exists(path)))

    await writeFile(path, JSON.stringify({ ...pendingRecord(), endpointUrl: '' }), 'utf8')
    check('缺 endpointUrl → null', (await readPendingCleanup(ctx)) === null)

    await writeFile(path, JSON.stringify({ ...pendingRecord(), savedAt: 'not-a-date' }), 'utf8')
    check('savedAt 非法 → null', (await readPendingCleanup(ctx)) === null)

    await writeFile(path, JSON.stringify([1, 2, 3]), 'utf8')
    check('非对象记录 → null', (await readPendingCleanup(ctx)) === null)

    await writeFile(path, JSON.stringify(pendingRecord({ attempts: -3 })), 'utf8')
    const negative = await readPendingCleanup(ctx)
    check('负数 attempts 归一为 0', negative?.attempts === 0 && negative?.token === TOKEN)
    await clearPendingCleanup(ctx)
  })
}

// ---- main ----------------------------------------------------------------

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

  console.log('session-pending-cleanup：卸载未关机补清理离线回归（无 Kaggle / 无 GPU / 无外网）')
  await scenario('A 纯函数', scenarioPureFunctions)
  await scenario('B1 dispose 成功', scenarioDisposeSuccess)
  await scenario('B2 dispose 失败 / 无连接信息', scenarioDisposeFailure)
  await scenario('C1 启动补发成功', scenarioStartupCleanupSuccess)
  await scenario('C2 启动补发失败累加 attempts', scenarioStartupCleanupRetry)
  await scenario('C3 启动补发丢弃分支', scenarioStartupCleanupDiscard)
  await scenario('D 读取校验', scenarioReadValidation)

  console.log('\n── E token 只落盘')
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
