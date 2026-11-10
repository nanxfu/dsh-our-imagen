#!/usr/bin/env node
/**
 * Host 会话竞态离线回归（对应 task-7，不连 Kaggle、不烧 GPU、不出外网）。
 *
 * 覆盖：
 *   A. `_start` 全程兜底：kaggleUsername / buildKernelFolder / pushKernel 抛异常时
 *      收敛为 error（auth_required / push_failed），不卡在 provisioning，且清理临时目录。
 *   B. start/stop 竞态：push 等待期间 stop，push 返回后必须放弃写状态、不得挂轮询
 *      （不出现 ntfy.sh/null 与 kaggle kernels status 的僵尸请求），state 保持 absent。
 *   C. buildKernelFolder 等待期间 stop：同样作废，临时目录被清理。
 *   D. push 失败发生在 stop 之后：不得把已关机的会话复活成 error。
 *   E. 用户 stop 后 pending job 不得自动拉起 Kernel（job 失败 code='stopped'），
 *      且「未主动 stop 时生成自动唤起」的体验保留；stop 后点「唤起」可正常 start。
 *   F. dispose / fail 时 best-effort requestShutdown（endpoint+token 存在时，3s 超时）。
 *
 * 运行：node test/session-race.mjs
 */

import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JobQueue } from '../lib/jobs.js'
import { SessionManager } from '../lib/session.js'

const PRESET = 'sdxl-lightning'
const FAST = { tickMs: 20, kernelPollMs: 20, healthyIntervalMs: 20, recoveryTimeoutMs: 500 }

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

async function waitFor(label, predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) {
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

/** 只统计被轮询次数，不返回任何会合消息：用来证明 stop 后不再有僵尸轮询。 */
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

function fakeDeps() {
  const calls = { pushed: 0, removed: [], status: 0, logs: 0, shutdown: [] }
  const deps = {
    kaggleUsername: async () => 'tester',
    buildKernelFolder: async () => ({
      dir: '/tmp/fake-kernel-default',
      kernelId: 'tester/imagen-race',
      kernelUrl: 'https://www.kaggle.com/code/tester/imagen-race',
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
    requestShutdown: async (endpoint, token, timeoutMs) => {
      calls.shutdown.push({ endpoint, token, timeoutMs })
      return true
    },
  }
  return { deps, calls }
}

function makeSession({ ntfyPort, deps = {}, options = {} } = {}) {
  return new SessionManager({
    ctx: createCtx(),
    defaultPreset: PRESET,
    deps,
    options: {
      ntfyBase: `http://127.0.0.1:${ntfyPort ?? 9}`,
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 10 * 60 * 1000,
      ...FAST,
      ...options,
    },
  })
}

function makeQueue(session, options = {}) {
  return new JobQueue({
    ctx: createCtx(),
    session,
    defaultPreset: PRESET,
    options: { sessionWaitMs: 4000, generateTimeoutMs: 3000, ...options },
  })
}

// ---- A. _start 兜底 ------------------------------------------------------

async function scenarioStartFailureRecovery() {
  const ntfy = await startCountingNtfy()
  const cases = [
    {
      name: 'kaggleUsername 抛异常',
      patch: (deps) => {
        deps.kaggleUsername = async () => {
          throw new Error('config view 崩了')
        }
      },
      code: 'auth_required',
    },
    {
      name: 'buildKernelFolder 抛异常',
      patch: (deps) => {
        deps.buildKernelFolder = async () => {
          throw new Error('mkdtemp 失败')
        }
      },
      code: 'push_failed',
    },
  ]

  for (const item of cases) {
    const { deps } = fakeDeps()
    item.patch(deps)
    const session = makeSession({ ntfyPort: ntfy.port, deps })
    try {
      const snapshot = await session.start(PRESET)
      check(`${item.name} → ${item.code}`, snapshot.state === 'error' && snapshot.error?.code === item.code, JSON.stringify(snapshot.error))
      check(`${item.name} → 不留定时器`, session.timers.size === 0)
      check(`${item.name} → 不停留在 provisioning`, snapshot.state !== 'provisioning' && snapshot.phase === null)
    } finally {
      session.dispose()
    }
  }

  // push 抛异常：必须清理含 token 的临时目录。
  {
    const { deps, calls } = fakeDeps()
    const dir = '/tmp/fake-kernel-push-throw'
    deps.buildKernelFolder = async () => ({ dir, kernelId: 'tester/imagen-throw', kernelUrl: 'https://example.invalid/x' })
    deps.pushKernel = async () => {
      throw new Error('CLI 进程被系统杀掉')
    }
    const session = makeSession({ ntfyPort: ntfy.port, deps })
    try {
      const snapshot = await session.start(PRESET)
      check('pushKernel 抛异常 → push_failed', snapshot.state === 'error' && snapshot.error?.code === 'push_failed', JSON.stringify(snapshot.error))
      check('pushKernel 抛异常 → 清理临时目录', calls.removed.includes(dir))
      check('pushKernel 抛异常 → 不保留目录引用', session.kernelFolder === null)

      // 修复依赖后可以正常重试（错误状态不是死胡同）。
      // 注意 SessionManager 构造时已拷贝 deps，运行期替换要改实例上的副本。
      session.deps.pushKernel = async () => {
        calls.pushed += 1
        return { ok: true }
      }
      const retried = await session.start(PRESET)
      check('错误状态后可重新启动', retried.state === 'provisioning' && calls.pushed >= 1, retried.state)
    } finally {
      session.dispose()
    }
  }

  await ntfy.close()
}

// ---- B/C/D. start/stop 竞态 ---------------------------------------------

async function scenarioStopDuringPush() {
  const ntfy = await startCountingNtfy()
  const { deps, calls } = fakeDeps()
  let pushStarted = false
  let releasePush = () => {}
  const gate = new Promise((resolve) => {
    releasePush = resolve
  })
  const dir = '/tmp/fake-kernel-race-push'
  deps.buildKernelFolder = async () => ({ dir, kernelId: 'tester/imagen-race', kernelUrl: 'https://example.invalid/x' })
  deps.pushKernel = async () => {
    pushStarted = true
    await gate
    return { ok: true }
  }
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    const starting = session.start(PRESET)
    await waitFor('push 已开始', () => pushStarted)

    const stopped = await session.stop()
    check('push 等待期间 stop → 立即 absent', stopped.state === 'absent')
    check('push 等待期间 stop → 置位 stoppedByUser', session.stoppedByUser === true)
    check('push 等待期间 stop → 清理临时目录', calls.removed.includes(dir))

    releasePush()
    const resolved = await starting
    check('push 返回后启动流程放弃写状态', resolved.state === 'absent' && resolved.error === null, JSON.stringify(resolved.error))

    const hitsAfterStop = ntfy.state.hits
    const statusAfterStop = calls.status
    await sleep(FAST.tickMs * 5)
    check('stop 后不再轮询 ntfy', ntfy.state.hits === hitsAfterStop, `${hitsAfterStop} → ${ntfy.state.hits}`)
    check('stop 后不再轮询 kaggle kernels status', calls.status === statusAfterStop, `${statusAfterStop} → ${calls.status}`)
    check('stop 后也没有残留定时器', session.timers.size === 0)
    check('stop 后状态保持 absent', session.snapshot().state === 'absent')
  } finally {
    session.dispose()
    await ntfy.close()
  }
}

async function scenarioStopDuringBuild() {
  const ntfy = await startCountingNtfy()
  const { deps, calls } = fakeDeps()
  let buildStarted = false
  let releaseBuild = () => {}
  const gate = new Promise((resolve) => {
    releaseBuild = resolve
  })
  deps.buildKernelFolder = async () => {
    buildStarted = true
    await gate
    return { dir: '/tmp/fake-kernel-race-build', kernelId: 'tester/imagen-build', kernelUrl: 'https://example.invalid/x' }
  }
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    const starting = session.start(PRESET)
    await waitFor('build 已开始', () => buildStarted)
    await session.stop()
    releaseBuild()
    const resolved = await starting
    check('build 期间 stop → 启动流程作废', resolved.state === 'absent' && resolved.error === null)
    check('build 期间 stop → 迟到目录被清理', calls.removed.includes('/tmp/fake-kernel-race-build'))
    check('build 期间 stop → 不发 push', calls.pushed === 0)
    const hits = ntfy.state.hits
    await sleep(FAST.tickMs * 4)
    check('build 期间 stop → 无僵尸轮询', ntfy.state.hits === hits && calls.status === 0)
  } finally {
    session.dispose()
    await ntfy.close()
  }
}

async function scenarioPushRejectsAfterStop() {
  const ntfy = await startCountingNtfy()
  const { deps } = fakeDeps()
  let pushStarted = false
  let failPush = () => {}
  const gate = new Promise((_resolve, reject) => {
    failPush = reject
  })
  deps.buildKernelFolder = async () => ({ dir: '/tmp/fake-kernel-race-reject', kernelId: 'tester/imagen-reject', kernelUrl: 'https://example.invalid/x' })
  deps.pushKernel = async () => {
    pushStarted = true
    await gate
  }
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    const starting = session.start(PRESET)
    await waitFor('push 已开始', () => pushStarted)
    await session.stop()
    failPush(new Error('push 超时'))
    const resolved = await starting
    check('stop 后 push 失败不会把会话复活成 error', resolved.state === 'absent' && resolved.error === null, JSON.stringify(resolved.error))
    check('stop 后 push 失败仍保持 stoppedByUser', session.stoppedByUser === true)
  } finally {
    session.dispose()
    await ntfy.close()
  }
}

// ---- E. 关机不被排队任务推翻 -------------------------------------------

async function scenarioStoppedByUserBlocksJob() {
  const { deps, calls } = fakeDeps()
  const session = makeSession({ deps })
  const queue = makeQueue(session)
  try {
    await session.stop()
    check('stop 后 stoppedByUser=true', session.stoppedByUser === true)

    const submitted = queue.submit({ prompt: '关机后提交的任务', autoStart: true })
    check('关机后任务仍可入队（快速失败而非静默丢弃）', submitted.ok === true)
    const job = await waitFor('任务进入失败态', () => {
      const current = queue.get(submitted.job.id)
      return current && current.status === 'failed' ? current : null
    })
    check('关机后任务失败码为 stopped', job.error?.code === 'stopped', JSON.stringify(job.error))
    check('失败文案可读', /手动关闭/.test(job.error?.message ?? ''), job.error?.message)
    await sleep(40)
    check('关机后任务不会自动拉起 Kernel', calls.pushed === 0)
    check('会话保持 absent', session.snapshot().state === 'absent')
  } finally {
    queue.dispose()
    session.dispose()
  }
}

async function scenarioAutoStartStillWorks() {
  const ntfy = await startCountingNtfy()
  const { deps, calls } = fakeDeps()
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  const queue = makeQueue(session)
  try {
    const submitted = queue.submit({ prompt: '未关机时应自动唤起', autoStart: true })
    await waitFor('自动唤起 Kernel', () => calls.pushed >= 1 && session.snapshot().state === 'provisioning')
    const job = queue.get(submitted.job.id)
    check('未主动 stop 时生成仍会自动唤起 Kernel', calls.pushed === 1)
    check('任务进入等待会话态', job.status === 'waiting-session', job.status)
    check('自动唤起不清 stoppedByUser 语义（本就为 false）', session.stoppedByUser === false)
  } finally {
    queue.dispose()
    session.dispose()
    await ntfy.close()
  }
}

async function scenarioStopWhileJobWaiting() {
  const ntfy = await startCountingNtfy()
  const { deps, calls } = fakeDeps()
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  const queue = makeQueue(session, { sessionWaitMs: 5000 })
  try {
    const submitted = queue.submit({ prompt: '等待会话中被关机', autoStart: true })
    await waitFor('Kernel 已推送并开始等待', () => calls.pushed >= 1 && session.snapshot().state === 'provisioning')

    await session.stop()
    const job = await waitFor('停止后任务收敛为失败', () => {
      const current = queue.get(submitted.job.id)
      return current && current.status === 'failed' ? current : null
    })
    check('等待会话时被关机 → 任务错误码 stopped（不是 session_absent）', job.error?.code === 'stopped', JSON.stringify(job.error))
    await sleep(40)
    check('等待会话时被关机 → 不会重新拉起 Kernel', calls.pushed === 1, `pushed=${calls.pushed}`)
  } finally {
    queue.dispose()
    session.dispose()
    await ntfy.close()
  }
}

async function scenarioStartAgainAfterStop() {
  const ntfy = await startCountingNtfy()
  const { deps, calls } = fakeDeps()
  const session = makeSession({ ntfyPort: ntfy.port, deps })
  try {
    await session.stop()
    check('stop 后标记已置位', session.stoppedByUser === true)
    const snapshot = await session.start(PRESET)
    check('stop 后点「唤起」仍可正常 start', snapshot.state === 'provisioning', snapshot.state)
    check('start 清除已关机标记', session.stoppedByUser === false)
    check('start 确实发起了 push', calls.pushed === 1)
  } finally {
    session.dispose()
    await ntfy.close()
  }
}

// ---- F. dispose / fail 的远端清理 --------------------------------------

async function scenarioDisposeAndFailShutdown() {
  const { deps, calls } = fakeDeps()
  const session = makeSession({
    deps,
    options: { devEndpoint: 'http://127.0.0.1:9', devToken: 'dev-token' },
  })
  try {
    const snapshot = await session.start(PRESET)
    check('开发模式直接 ready', snapshot.state === 'ready' && snapshot.endpointUrl === 'http://127.0.0.1:9')

    session.dispose()
    await sleep(20)
    const disposeCall = calls.shutdown[0]
    check('dispose 发起 best-effort requestShutdown', calls.shutdown.length === 1, `calls=${calls.shutdown.length}`)
    check(
      'shutdown 携带 endpoint/token 且超时 3s',
      disposeCall?.endpoint === 'http://127.0.0.1:9' && disposeCall?.token === 'dev-token' && disposeCall?.timeoutMs === 3000,
      JSON.stringify(disposeCall),
    )
  } finally {
    session.dispose()
  }

  // fail() 同样尽力关掉远端，避免失败后 Kernel 继续烧配额。
  const second = fakeDeps()
  const failing = makeSession({
    deps: second.deps,
    options: { devEndpoint: 'http://127.0.0.1:9', devToken: 'dev-token' },
  })
  try {
    await failing.start(PRESET)
    failing.fail('remote_error', '模拟远端异常')
    await sleep(20)
    check('fail 发起 best-effort requestShutdown', second.calls.shutdown.length === 1, `calls=${second.calls.shutdown.length}`)
    check('fail 后会话进入 error', failing.snapshot().state === 'error')
  } finally {
    failing.dispose()
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

  console.log('session-race：Host 会话竞态离线回归（无 Kaggle / 无 GPU / 无外网）')
  workspace = await mkdtemp(join(tmpdir(), 'imagen-session-race-'))
  await scenario('A _start 异常兜底与可重试', scenarioStartFailureRecovery)
  await scenario('B push 等待期间 stop', scenarioStopDuringPush)
  await scenario('C build 等待期间 stop', scenarioStopDuringBuild)
  await scenario('D stop 后 push 失败不复活', scenarioPushRejectsAfterStop)
  await scenario('E1 关机后排队任务不自动拉起', scenarioStoppedByUserBlocksJob)
  await scenario('E2 未关机时自动唤起仍生效', scenarioAutoStartStillWorks)
  await scenario('E3 等待会话时被关机', scenarioStopWhileJobWaiting)
  await scenario('E4 stop 后「唤起」仍可 start', scenarioStartAgainAfterStop)
  await scenario('F dispose/fail 的远端清理', scenarioDisposeAndFailShutdown)

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