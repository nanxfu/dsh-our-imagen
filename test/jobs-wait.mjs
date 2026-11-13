#!/usr/bin/env node
/**
 * JobQueue 事件化等待 + 远端轮询容错/幂等续接的离线回归
 * （不连 Kaggle、不出外网、不烧 GPU）。
 *
 * 覆盖：
 *  - job 不存在 → null；waitSeconds <= 0 → 立即返回当前快照；
 *  - 任务在 waitFor 注册前已结束 → 立即返回终态（不挂等待者）；
 *  - 完成 / 失败都唤醒全部等待者，多个等待者互不干扰；
 *  - 超时返回当前快照并清理登记；dispose 立即唤醒而不挂到超时；
 *  - 轮询容错：连续失败超过旧上限（6 次）仍能恢复；容忍窗口用尽才失败；
 *  - 404 unknown_job 仍是立即终态（不重试、不触发幂等重投）；
 *  - 幂等续接：窗口用尽后用同一 jobId 重投接回原任务；重投次数有上限；
 *  - 整体预算：轮询失败不会突破 timeoutMs；
 *  - publicView 结构化进度：stageCode / progress（done 是已完成张数，stage 原样保留）；
 *  - JobQueue.generate 接线：逐张提交（每张一个远端 job、tasks 只含 1 项、幂等键带两位序号），
 *    隧道重建后按同一张的幂等键重投，并下发分张进度；
 *  - 任务取消：未知 id / queued / waiting-session（立即出队、唤醒等待者、不队头阻塞）/
 *    running 合作式（当张完成后不再提交剩余、已完成图片落盘、status=cancelled、cancelRequested 透出）/
 *    终态 already-finished。
 *
 * 运行：node test/jobs-wait.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JobQueue } from '../lib/jobs.js'
import { submitGenerate, waitForJob } from '../lib/remote.js'

const PRESET = 'sdxl-turbo'
// 1×1 透明 PNG：走真实的 saveJobOutput 落盘路径。
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(label, predicate, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(intervalMs)
  }
  throw new Error(`等待超时：${label}`)
}

// 完成路径会用真实落盘（saveJobOutput），用独立临时工作区避免污染仓库。
let workspace = null

function makeCtx() {
  return {
    get(name) {
      return name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined
    },
  }
}

/** 假会话：默认已就绪且连接可用；用例可通过 connection 改造成失败路径。 */
function makeSession({ connection = () => ({ endpoint: 'http://127.0.0.1:1', token: 'test-token' }) } = {}) {
  return {
    isReady: true,
    connection,
    snapshot: () => ({ state: 'ready', error: null }),
    start: async () => ({ state: 'ready', error: null }),
    ensureReady: async () => ({ state: 'ready', error: null }),
  }
}

/**
 * 可控会话：状态由用例显式推进，用于 waiting-session 的取消用例。
 * isReady 必须跟随 snapshot 变化（JobQueue 会先读 isReady 再进等待循环）。
 */
function makeControllableSession(initialState = 'provisioning') {
  const state = { current: initialState, error: null }
  return {
    stoppedByUser: false,
    get isReady() {
      return state.current === 'ready'
    },
    connection: () => ({ endpoint: 'http://127.0.0.1:1', token: 'test-token' }),
    snapshot: () => ({ state: state.current, error: state.error }),
    start: async () => ({ state: state.current, error: state.error }),
    setState(next) {
      state.current = next
    },
  }
}

function makeQueue(session = makeSession()) {
  return new JobQueue({ ctx: makeCtx(), session, defaultPreset: PRESET, options: { generateTimeoutMs: 1000 } })
}

function doneResults(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    image_b64: PNG_B64,
    seed: 7 + index,
    seconds: 0.1,
    width: 512,
    height: 512,
  }))
}

function makeGate() {
  let release = () => {}
  const gate = new Promise((resolve) => {
    release = resolve
  })
  return { gate, release }
}

/** 任务会完成：只替换远端 generate，其余（runNext / persistResult / 唤醒）走真实实现。 */
function completeQueue({ gate = null } = {}) {
  const queue = makeQueue()
  queue.generate = async () => {
    if (gate) await gate
    return { results: doneResults(1), modelId: 'test/model' }
  }
  return queue
}

/** 任务一直不结束：用于立即返回 / 超时 / dispose 用例。 */
function pendingQueue() {
  const queue = makeQueue()
  queue.generate = () => new Promise(() => {})
  return queue
}

// ---- 假远端：隧道重建期的轮询失败与幂等重投 --------------------------------

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

/** 已完成的 /job 快照（走真实的 waitForJob → results 映射）。 */
function doneJob(jobId, count = 1) {
  return {
    status: 'done',
    job_id: jobId,
    model_id: 'test/model',
    progress: { done: count, total: count },
    load_seconds: 0.1,
    results: doneResults(count),
    error: null,
  }
}

/**
 * 本机假 daemon（异步 job 协议），用于构造隧道重建期的请求失败：
 *  - state.pollFailures：GET /job 还要连续「掐连接」几次；-1 表示一直失败；
 *  - state.nextPolls：随后依次返回的 /job 快照（构造 running 进度序列）；
 *  - state.generateCalls：POST /generate 请求体（验证重投复用同一 jobId）；
 *  - state.onGenerate(state, count)：每次入队后的测试钩子（第 N 次投递后让隧道恢复）。
 */
async function startFlakyRemote() {
  const state = { pollFailures: 0, nextPolls: [], jobs: new Map(), generateCalls: [], jobCalls: 0, onGenerate: null }
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
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        state.generateCalls.push(body)
        const jobId = String(body.jobId || `mock-job-${state.generateCalls.length}`)
        if (!state.jobs.has(jobId)) {
          state.jobs.set(jobId, {
            status: 'running',
            job_id: jobId,
            model_id: body.modelId ?? 'test/model',
            progress: { done: 0, total: body.tasks?.length ?? 1 },
            results: null,
            error: null,
          })
        }
        state.onGenerate?.(state, state.generateCalls.length)
        send(202, { status: 'accepted', job_id: jobId, model_id: body.modelId ?? 'test/model' })
      })
      return
    }
    if (req.method === 'GET' && req.url.startsWith('/job?id=')) {
      state.jobCalls += 1
      if (state.pollFailures !== 0) {
        if (state.pollFailures > 0) state.pollFailures -= 1
        // 模拟隧道断开：直接掐掉连接，调用方会拿到 fetch 失败。
        req.destroy()
        return
      }
      if (state.nextPolls.length > 0) return send(200, state.nextPolls.shift())
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

/** publicView 单测用的最小 job 形状（与实际 job 字段一致，可覆盖）。 */
function makePublicJob(overrides = {}) {
  return {
    id: 'j_public',
    status: 'queued',
    stage: '排队中',
    presetId: PRESET,
    params: { count: 4 },
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    seconds: null,
    sessionState: 'ready',
    modelId: null,
    output: null,
    error: null,
    ...overrides,
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error('\n测试超时（30s），强制退出')
    process.exit(2)
  }, 30000)
  watchdog.unref?.()

  console.log('jobs-wait：JobQueue.waitFor 事件化等待离线回归（无 Kaggle / 无 GPU / 无外网）')
  workspace = await mkdtemp(join(tmpdir(), 'imagen-jobs-wait-'))

  await check('job 不存在时返回 null', async () => {
    const queue = completeQueue()
    try {
      assert.equal(await queue.waitFor('j_missing', 5), null)
      assert.equal(queue.waiters.size, 0)
    } finally {
      queue.dispose()
    }
  })

  await check('waitSeconds <= 0 立即返回当前快照，不挂等待者', async () => {
    const queue = pendingQueue()
    try {
      const submitted = queue.submit({ prompt: '立即返回' })
      const began = Date.now()
      const job = await queue.waitFor(submitted.job.id, 0)
      const elapsed = Date.now() - began
      assert.ok(job && job.id === submitted.job.id)
      assert.ok(elapsed < 200, `应立即返回，实际 ${elapsed}ms`)
      assert.ok(['queued', 'waiting-session', 'running'].includes(job.status), job.status)
      assert.equal(queue.waiters.size, 0)
    } finally {
      queue.dispose()
    }
  })

  await check('注册前任务已结束：立即返回终态快照', async () => {
    const queue = completeQueue()
    try {
      const submitted = queue.submit({ prompt: '先完成再等' })
      await waitUntil('任务完成', () => queue.get(submitted.job.id)?.status === 'done')
      const job = await queue.waitFor(submitted.job.id, 5)
      assert.equal(job.status, 'done')
      assert.ok(job.output?.images.length === 1)
      assert.equal(queue.waiters.size, 0, '已终态不应挂等待者')
    } finally {
      queue.dispose()
    }
  })

  await check('完成唤醒：多个并发等待者都拿到 done 快照', async () => {
    const { gate, release } = makeGate()
    const queue = completeQueue({ gate })
    try {
      const submitted = queue.submit({ prompt: '完成唤醒' })
      const waiters = [
        queue.waitFor(submitted.job.id, 10),
        queue.waitFor(submitted.job.id, 10),
        queue.waitFor(submitted.job.id, 10),
      ]
      assert.equal(queue.waiters.get(submitted.job.id)?.size, 3, '三个等待者应同时登记')
      release()
      const snapshots = await Promise.all(waiters)
      for (const snapshot of snapshots) {
        assert.equal(snapshot.id, submitted.job.id)
        assert.equal(snapshot.status, 'done')
        assert.ok(snapshot.output?.images.length === 1)
      }
      assert.equal(queue.waiters.size, 0, '唤醒后应清理登记')
    } finally {
      queue.dispose()
    }
  })

  await check('超时返回当前快照并清理等待者登记', async () => {
    const queue = pendingQueue()
    try {
      const submitted = queue.submit({ prompt: '超时' })
      const began = Date.now()
      const job = await queue.waitFor(submitted.job.id, 0.05)
      const elapsed = Date.now() - began
      assert.ok(elapsed >= 40, `应等待约 50ms，实际 ${elapsed}ms`)
      assert.ok(elapsed < 1000, `超时不应明显超过 50ms，实际 ${elapsed}ms`)
      assert.equal(job.status, 'running')
      assert.equal(queue.waiters.size, 0, '超时后应清理登记')
    } finally {
      queue.dispose()
    }
  })

  await check('失败任务唤醒等待者，返回 failed 与错误码', async () => {
    const queue = makeQueue(makeSession({ connection: () => ({ endpoint: null, token: null }) }))
    try {
      const submitted = queue.submit({ prompt: '失败唤醒' })
      const job = await queue.waitFor(submitted.job.id, 10)
      assert.equal(job.status, 'failed')
      assert.equal(job.error?.code, 'session_absent')
      assert.equal(queue.waiters.size, 0)
    } finally {
      queue.dispose()
    }
  })

  await check('dispose 立即唤醒等待者并清理全部登记', async () => {
    const queue = pendingQueue()
    const submitted = queue.submit({ prompt: 'dispose 唤醒' })
    const pending = queue.waitFor(submitted.job.id, 600)
    try {
      await sleep(10)
      const began = Date.now()
      queue.dispose()
      const job = await pending
      assert.ok(Date.now() - began < 200, 'dispose 应立即唤醒，而不是等超时')
      assert.equal(job.id, submitted.job.id)
      assert.notEqual(job.status, 'done')
      assert.equal(queue.waiters.size, 0, 'dispose 应清理全部登记')
    } finally {
      queue.dispose()
    }
  })

  await check('多等待者互不干扰：一个超时返回，另一个仍等完成', async () => {
    const { gate, release } = makeGate()
    const queue = completeQueue({ gate })
    try {
      const submitted = queue.submit({ prompt: '多等待者' })
      const shortWait = queue.waitFor(submitted.job.id, 0.05)
      const longWait = queue.waitFor(submitted.job.id, 10)
      const timedOut = await shortWait
      assert.equal(timedOut.status, 'running')
      assert.equal(queue.waiters.get(submitted.job.id)?.size, 1, '只应移除超时的那个等待者')
      release()
      const completed = await longWait
      assert.equal(completed.status, 'done')
      assert.equal(queue.waiters.size, 0)
    } finally {
      queue.dispose()
    }
  })

  // ---- 远端轮询容错与幂等续接（P0-A3） ------------------------------------

  await check('轮询容错：连续失败超过旧上限（6 次）后恢复，任务仍成功', async () => {
    const remote = await startFlakyRemote()
    try {
      remote.state.jobs.set('job-ok', doneJob('job-ok', 1))
      remote.state.pollFailures = 9
      const response = await waitForJob(remote.endpoint, 'test-token', 'job-ok', {
        pollMs: 10,
        failureGraceMs: 10000,
        backoffMaxMs: 20,
        timeoutMs: 5000,
      })
      assert.equal(response.status, 'ok')
      assert.equal(response.results.length, 1)
      assert.ok(remote.state.jobCalls >= 10, `应经历 ≥10 次查询，实际 ${remote.state.jobCalls}`)
    } finally {
      await remote.close()
    }
  })

  await check('轮询容错：容忍窗口用尽且无重投能力 → generate_failed', async () => {
    const remote = await startFlakyRemote()
    try {
      remote.state.pollFailures = -1
      const began = Date.now()
      await assert.rejects(
        () =>
          waitForJob(remote.endpoint, 'test-token', 'job-dead', {
            pollMs: 10,
            failureGraceMs: 80,
            backoffMaxMs: 20,
            timeoutMs: 5000,
          }),
        (error) => error.code === 'generate_failed' && /连续失败/.test(error.message),
      )
      const elapsed = Date.now() - began
      assert.ok(elapsed >= 80, `应至少容忍 80ms，实际 ${elapsed}ms`)
      assert.ok(elapsed < 3000, `不应拖到预算耗尽，实际 ${elapsed}ms`)
      assert.ok(remote.state.jobCalls >= 3, `应多次重试，实际 ${remote.state.jobCalls} 次`)
    } finally {
      await remote.close()
    }
  })

  await check('404 unknown_job 仍立即终态：不重试、不触发幂等重投', async () => {
    const remote = await startFlakyRemote()
    try {
      let resumeCalls = 0
      const began = Date.now()
      await assert.rejects(
        () =>
          waitForJob(remote.endpoint, 'test-token', 'job-missing', {
            pollMs: 10,
            failureGraceMs: 0,
            backoffMaxMs: 20,
            timeoutMs: 5000,
            resubmit: async () => {
              resumeCalls += 1
              return 'job-missing'
            },
          }),
        (error) => error.status === 404 && error.code === 'unknown_job',
      )
      assert.equal(resumeCalls, 0, '404 不应触发重投')
      assert.equal(remote.state.jobCalls, 1, `只应查询一次，实际 ${remote.state.jobCalls} 次`)
      assert.ok(Date.now() - began < 1000)
    } finally {
      await remote.close()
    }
  })

  await check('幂等续接：窗口用尽后用同一 jobId 重投，接回原任务继续轮询', async () => {
    const remote = await startFlakyRemote()
    try {
      remote.state.pollFailures = -1
      const resumedIds = []
      const response = await waitForJob(remote.endpoint, 'test-token', 'job-resume', {
        pollMs: 10,
        failureGraceMs: 60,
        backoffMaxMs: 20,
        timeoutMs: 5000,
        resubmit: async (jobId) => {
          resumedIds.push(jobId)
          // 模拟隧道恢复：重投命中 daemon 幂等键（返回同一 job id），/job 恢复可用。
          remote.state.pollFailures = 0
          const submitted = await submitGenerate(remote.endpoint, 'test-token', {
            pipeline: { loader: 'sdxl' },
            modelId: 'test/model',
            jobId,
            tasks: [{ name: '01' }],
          })
          remote.state.jobs.set(submitted.job_id, doneJob(submitted.job_id, 1))
          return submitted.job_id
        },
      })
      assert.deepEqual(resumedIds, ['job-resume'], `重投应复用原 jobId，实际 ${resumedIds}`)
      assert.equal(response.status, 'ok')
      assert.equal(response.results.length, 1)
      assert.equal(remote.state.generateCalls.length, 1)
      assert.equal(remote.state.generateCalls[0].jobId, 'job-resume', '重投载荷必须带同一 jobId')
    } finally {
      await remote.close()
    }
  })

  await check('幂等续接有次数上限：重投持续失败时按上限放弃', async () => {
    const remote = await startFlakyRemote()
    try {
      remote.state.pollFailures = -1
      let resumeCalls = 0
      await assert.rejects(
        () =>
          waitForJob(remote.endpoint, 'test-token', 'job-resume-limit', {
            pollMs: 10,
            failureGraceMs: 40,
            backoffMaxMs: 20,
            timeoutMs: 5000,
            resumeMaxAttempts: 2,
            resubmit: async () => {
              resumeCalls += 1
              throw new Error('tunnel still down')
            },
          }),
        (error) => error.code === 'generate_failed' && /已幂等重投 2 次/.test(error.message),
      )
      assert.equal(resumeCalls, 2, `重投应恰好 2 次，实际 ${resumeCalls} 次`)
    } finally {
      await remote.close()
    }
  })

  await check('整体预算约束：轮询失败不突破 timeoutMs', async () => {
    const remote = await startFlakyRemote()
    try {
      remote.state.pollFailures = -1
      const began = Date.now()
      await assert.rejects(
        () =>
          waitForJob(remote.endpoint, 'test-token', 'job-budget', {
            pollMs: 10,
            failureGraceMs: 60000,
            backoffMaxMs: 20,
            timeoutMs: 120,
          }),
        (error) => error.code === 'generate_failed' && /超时/.test(error.message),
      )
      assert.ok(Date.now() - began < 1500, `不应明显突破 120ms 预算，实际 ${Date.now() - began}ms`)
    } finally {
      await remote.close()
    }
  })

  // ---- 结构化进度字段（供客户端本地化） ----------------------------------

  await check('publicView：stageCode 六态映射与 progress 语义', () => {
    const queue = makeQueue()
    try {
      const view = (overrides) => queue.publicView(makePublicJob(overrides))
      assert.equal(view({}).stageCode, 'queued')
      assert.equal(view({}).progress, null)
      assert.equal(
        view({ status: 'waiting-session', sessionState: 'provisioning', stage: '准备远端会话' }).stageCode,
        'waiting-session',
      )
      assert.equal(view({ status: 'waiting-session', sessionState: 'warming', stage: '加载模型' }).stageCode, 'loading')

      const running = view({ status: 'running', stage: '生成中 2/4', progress: { done: 1, total: 4 } })
      assert.equal(running.stageCode, 'running')
      assert.deepEqual(running.progress, { done: 1, total: 4 })
      assert.equal(running.stage, '生成中 2/4', 'stage 必须保留原样（向后兼容）')

      const runningNoProgress = view({ status: 'running', params: { count: 3 } })
      assert.deepEqual(runningNoProgress.progress, { done: 0, total: 3 }, 'running 时应给出 0/N')

      const done = view({ status: 'done', stage: '完成', progress: { done: 4, total: 4 } })
      assert.equal(done.stageCode, 'done')
      assert.equal(done.progress, null, '非 running 状态 progress 必须为 null')
      assert.equal(view({ status: 'failed', stage: '失败' }).stageCode, 'failed')

      // cancelled 是终态：stageCode 稳定为 cancelled、progress 为 null、cancelRequested 恒为 false。
      const cancelled = view({ status: 'cancelled', stage: '已取消', cancelRequested: true })
      assert.equal(cancelled.stageCode, 'cancelled')
      assert.equal(cancelled.progress, null)
      assert.equal(cancelled.cancelRequested, false, '终态不再透出未收敛的取消请求')
      assert.equal(view({}).cancelRequested, false, '未取消的任务 cancelRequested 恒为 false')
      // running 合作式停止期间：status 不变、cancelRequested=true（客户端据此显示「正在停止…」）。
      const stopping = view({ status: 'running', progress: { done: 1, total: 4 }, cancelRequested: true })
      assert.equal(stopping.stageCode, 'running')
      assert.deepEqual(stopping.progress, { done: 1, total: 4 })
      assert.equal(stopping.cancelRequested, true)
    } finally {
      queue.dispose()
    }
  })

  // ---- 任务取消 ----------------------------------------------------------

  await check('cancel：未知 id 返回 not_found', () => {
    const queue = makeQueue()
    try {
      assert.deepEqual(queue.cancel('j_missing'), { ok: false, code: 'not_found' })
      assert.deepEqual(queue.cancel(''), { ok: false, code: 'not_found' })
    } finally {
      queue.dispose()
    }
  })

  await check('cancel queued：出队、终态 cancelled、立即唤醒等待者，不占队列位置', async () => {
    const queue = pendingQueue()
    try {
      const first = queue.submit({ prompt: '占用串行槽位' })
      await waitUntil('首个任务进入 running', () => queue.get(first.job.id)?.status === 'running')
      const second = queue.submit({ prompt: '排队中的任务' })
      assert.equal(second.job.status, 'queued')
      assert.equal(queue.queueStats().pending, 1)

      const waiter = queue.waitFor(second.job.id, 60)
      const result = queue.cancel(second.job.id)
      assert.equal(result.ok, true)
      assert.equal(result.disposition, 'dequeued')
      assert.equal(result.job.status, 'cancelled')
      assert.equal(result.job.stage, '已取消')
      assert.equal(result.job.cancelRequested, false, '已是终态：不再透出未收敛的取消请求')
      assert.equal(result.job.error, null)
      assert.ok(result.job.finishedAt, '取消应写 finishedAt')
      assert.equal(queue.queueStats().pending, 0, '取消后队列里不应还有该任务')

      const waited = await waiter
      assert.equal(waited.status, 'cancelled', 'waitFor 等待者应被立即唤醒')
      assert.equal(queue.waiters.size, 0)

      const again = queue.cancel(second.job.id)
      assert.equal(again.disposition, 'already-finished')
      assert.equal(again.job.status, 'cancelled')
      assert.equal(again.job.finishedAt, result.job.finishedAt, '终态取消不得改变状态')
    } finally {
      queue.dispose()
    }
  })

  await check('cancel waiting-session：立即出队并释放槽位，后续任务不必等会话等待超时', async () => {
    const session = makeControllableSession('provisioning')
    const queue = new JobQueue({
      ctx: makeCtx(),
      session,
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 1000, sessionPollMs: 10 },
    })
    let generateCalls = 0
    queue.generate = async () => {
      generateCalls += 1
      return { results: doneResults(1), modelId: 'test/model' }
    }
    try {
      const first = queue.submit({ prompt: '等待会话的任务' })
      await waitUntil('首个任务进入 waiting-session', () => queue.get(first.job.id)?.status === 'waiting-session')
      const waiter = queue.waitFor(first.job.id, 60)
      const second = queue.submit({ prompt: '后续任务' })
      assert.equal(queue.get(second.job.id)?.status, 'queued', '串行槽位被等待会话的任务占用')

      const result = queue.cancel(first.job.id)
      assert.equal(result.disposition, 'dequeued')
      assert.equal(result.job.status, 'cancelled')
      assert.equal(result.job.stage, '已取消')
      assert.equal(result.job.output, null, '一张都没完成时 output 必须为 null')
      assert.equal((await waiter).status, 'cancelled', '等待者应立即拿到 cancelled')

      // 关键：cancel 立刻让出串行槽位，第二个任务马上开始，不用等 sessionWaitMs（45 分钟）。
      await waitUntil('后续任务立刻开始', () => queue.get(second.job.id)?.status === 'waiting-session')
      assert.equal(generateCalls, 0, '会话未就绪时不得进入远端出图')

      // 被取消任务的等待循环退出后，不得把终态覆盖成 failed。
      await sleep(80)
      assert.equal(queue.get(first.job.id)?.status, 'cancelled')

      assert.equal(queue.cancel(second.job.id).disposition, 'dequeued')
    } finally {
      queue.dispose()
    }
  })

  await check('cancel running：合作式停止——当张完成后不再提交剩余、已完成图片落盘、收敛 cancelled', async () => {
    const remote = await startFlakyRemote()
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: {
        generateTimeoutMs: 5000,
        pollMs: 10,
        pollFailureGraceMs: 80,
        pollBackoffMaxMs: 20,
        resumeMaxAttempts: 1,
      },
    })
    try {
      const submitted = queue.submit({ prompt: '合作式取消', count: 3, seed: 10 })
      const jobId = submitted.job.id
      await waitUntil('首张已提交远端', () => remote.state.generateCalls.length === 1)

      const running = queue.get(jobId)
      assert.equal(running.status, 'running')
      assert.equal(running.cancelRequested, false)
      // 逐张提交：每个远端 job 的 tasks 只有 1 项，幂等键带两位序号。
      const firstCall = remote.state.generateCalls[0]
      assert.equal(firstCall.tasks.length, 1, '每张单独提交远端 job')
      assert.equal(firstCall.jobId, `${jobId}-01`)
      assert.equal(firstCall.tasks[0].seed, 10)

      const cancelled = queue.cancel(jobId)
      assert.equal(cancelled.disposition, 'cooperative')
      assert.equal(cancelled.job.status, 'running', 'running 只置标记，不立即改状态')
      assert.equal(cancelled.job.cancelRequested, true)

      // 让当前这张完成：之后不再提交第 2、3 张。
      const firstRemoteId = remote.state.generateCalls[0].jobId
      remote.state.jobs.set(firstRemoteId, doneJob(firstRemoteId, 1))

      // 取消后队列不得阻塞：排一个后续任务，等它开始。
      queue.generate = () => new Promise(() => {})
      const later = queue.submit({ prompt: '取消之后的后续任务' })
      assert.equal(queue.get(later.job.id)?.status, 'queued')

      await waitUntil('任务收敛为终态', () => ['cancelled', 'failed', 'done'].includes(queue.get(jobId)?.status))
      const final = queue.get(jobId)
      assert.equal(final.status, 'cancelled', JSON.stringify(final.error))
      assert.equal(final.stage, '已取消')
      assert.equal(final.error, null)
      assert.equal(final.cancelRequested, false, '终态不再透出取消请求标记')
      assert.equal(final.progress, null)
      assert.equal(final.stageCode, 'cancelled')
      assert.ok(final.finishedAt, '取消应收尾 finishedAt')

      const remainingSubmits = remote.state.generateCalls.filter((call) => call.jobId.startsWith(`${jobId}-`))
      assert.equal(remainingSubmits.length, 1, `取消后不得再提交剩余张数，实际 ${remainingSubmits.length} 次`)
      assert.equal(remainingSubmits[0].jobId, `${jobId}-01`)

      // 取消前已完成的图片照常落盘，output 保留但状态不是 done。
      assert.equal(final.output?.images.length, 1, '已完成的那张应保留在 output')
      const absolute = join(workspace, ...final.output.images[0].path.split('/'))
      assert.ok((await stat(absolute)).size > 0, '已完成图片应真实落盘')

      await waitUntil('取消后队列继续推进', () => queue.get(later.job.id)?.status === 'running')
      assert.equal(queue.cancel(jobId).disposition, 'already-finished')
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('cancel 终态：done / failed 的任务只返回 already-finished，状态不变', async () => {
    const failedQueue = makeQueue(makeSession({ connection: () => ({ endpoint: null, token: null }) }))
    try {
      const submitted = failedQueue.submit({ prompt: '失败任务取消' })
      const failed = await failedQueue.waitFor(submitted.job.id, 10)
      assert.equal(failed.status, 'failed')
      const result = failedQueue.cancel(submitted.job.id)
      assert.equal(result.disposition, 'already-finished')
      assert.equal(result.job.status, 'failed')
      assert.equal(result.job.error?.code, 'session_absent')
    } finally {
      failedQueue.dispose()
    }

    const doneQueue = completeQueue()
    try {
      const submitted = doneQueue.submit({ prompt: '完成任务取消' })
      const done = await doneQueue.waitFor(submitted.job.id, 10)
      assert.equal(done.status, 'done')
      const result = doneQueue.cancel(submitted.job.id)
      assert.equal(result.disposition, 'already-finished')
      assert.equal(result.job.status, 'done')
      assert.equal(result.job.output?.images.length, 1)
    } finally {
      doneQueue.dispose()
    }
  })

  await check('JobQueue.generate 逐张提交：每张一个远端 job、同键重投、分张进度', async () => {
    const remote = await startFlakyRemote()
    // 第一张：提交后隧道断开，幂等重投接回同一张；随后 running 0/1 → 1/1 → done。
    remote.state.pollFailures = -1
    remote.state.nextPolls = [
      { status: 'running', job_id: 'x', progress: { done: 0, total: 1 }, results: null, error: null },
      { status: 'running', job_id: 'x', progress: { done: 1, total: 1 }, results: null, error: null },
      doneJob('x', 1),
    ]
    remote.state.onGenerate = (state, count) => {
      if (count === 2) state.pollFailures = 0
      // 第二张提交后直接标记完成，避免测试额外等待。
      if (count >= 3) {
        const body = state.generateCalls[count - 1]
        state.jobs.set(body.jobId, doneJob(body.jobId, 1))
      }
    }
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: {
        generateTimeoutMs: 5000,
        pollMs: 20,
        pollFailureGraceMs: 80,
        pollBackoffMaxMs: 40,
        resumeMaxAttempts: 2,
      },
    })
    try {
      const submitted = queue.submit({ prompt: '隧道重建续接', count: 2, seed: 100 })
      const jobId = submitted.job.id
      const seen = []
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const view = queue.get(jobId)
        if (view) seen.push(view)
        if (view && ['done', 'failed', 'cancelled'].includes(view.status)) break
        await sleep(5)
      }
      const final = queue.get(jobId)
      assert.equal(final.status, 'done', JSON.stringify(final.error))
      assert.equal(final.output?.images.length, 2)

      const calls = remote.state.generateCalls
      assert.equal(calls.length, 3, '第一张首次提交 + 同键重投 + 第二张')
      assert.equal(calls[0].jobId, `${jobId}-01`)
      assert.equal(calls[1].jobId, `${jobId}-01`, '重投必须复用同一张的幂等键')
      assert.equal(calls[2].jobId, `${jobId}-02`)
      for (const call of calls) {
        assert.equal(call.tasks.length, 1, '逐张提交：每个远端 job 只有 1 个 task')
        assert.ok(call.jobId.length <= 64, '幂等键长度不得超过 daemon 上限')
        assert.match(call.jobId, /^[A-Za-z0-9._-]+$/, '幂等键只能含字母/数字/点/下划线/短横线')
      }
      assert.deepEqual(
        calls.filter((call) => call.jobId.endsWith('-01')).map((call) => call.tasks[0].seed),
        [100, 100],
        '同一张重投时 seed 必须不变',
      )
      assert.equal(calls[2].tasks[0].seed, 101, '第二张 seed 递增')

      const runningViews = seen.filter((item) => item.status === 'running')
      assert.ok(runningViews.length > 0, '应记录到 running 快照')
      assert.ok(
        runningViews.every((item) => item.stageCode === 'running'),
        `running 快照的 stageCode 应恒为 running：${runningViews.map((item) => item.stageCode)}`,
      )
      const doneCounts = new Set(runningViews.map((item) => item.progress?.done))
      assert.ok(doneCounts.has(0), `running 进度应包含已完成 0 张，实际 ${[...doneCounts]}`)
      assert.ok(
        runningViews.every((item) => item.progress?.total === 2),
        `running 进度 total 应恒为 2：${runningViews.map((item) => item.progress?.total)}`,
      )
      const stages = new Set(runningViews.map((item) => item.stage))
      assert.ok(stages.has('生成中 1/2'), `stage 文本应保留 done+1 语义：${[...stages]}`)

      assert.equal(final.stageCode, 'done')
      assert.equal(final.progress, null)
      assert.equal(final.stage, '完成')
      assert.equal(final.cancelRequested, false)
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  clearTimeout(watchdog)
  console.log('')
  if (failures.length) {
    console.log(`结果：${failures.length} 项失败，${passed} 项通过`)
    process.exitCode = 1
  } else {
    console.log(`结果：${passed} 项全部通过`)
  }
}

try {
  await main()
} finally {
  if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => {})
}
