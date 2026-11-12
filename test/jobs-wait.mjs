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
 *  - JobQueue.generate 接线：隧道重建后幂等重投复用同一 jobId，并下发分张进度。
 *
 * 运行：node test/jobs-wait.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
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
    } finally {
      queue.dispose()
    }
  })

  await check('JobQueue.generate 接线：隧道重建后幂等重投并下发分张进度', async () => {
    const remote = await startFlakyRemote()
    // 隧道一直断到第二次投递（幂等重投）为止；随后按 running 0/2 → 1/2 → done 的顺序返回。
    remote.state.pollFailures = -1
    remote.state.nextPolls = [
      { status: 'running', job_id: 'x', progress: { done: 0, total: 2 }, results: null, error: null },
      { status: 'running', job_id: 'x', progress: { done: 0, total: 2 }, results: null, error: null },
      { status: 'running', job_id: 'x', progress: { done: 1, total: 2 }, results: null, error: null },
      { status: 'running', job_id: 'x', progress: { done: 1, total: 2 }, results: null, error: null },
      doneJob('x', 2),
    ]
    remote.state.onGenerate = (state, count) => {
      if (count >= 2) state.pollFailures = 0
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
      const submitted = queue.submit({ prompt: '隧道重建续接', count: 2 })
      const jobId = submitted.job.id
      const seen = []
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        const view = queue.get(jobId)
        if (view) seen.push(view)
        if (view && ['done', 'failed'].includes(view.status)) break
        await sleep(5)
      }
      const final = queue.get(jobId)
      assert.equal(final.status, 'done', JSON.stringify(final.error))
      assert.equal(final.output?.images.length, 2)
      assert.equal(remote.state.generateCalls.length, 2, '首次提交 + 一次幂等重投')
      assert.equal(remote.state.generateCalls[1].jobId, remote.state.generateCalls[0].jobId, '重投必须复用同一 jobId')
      assert.equal(remote.state.generateCalls[1].jobId, jobId)

      const runningViews = seen.filter((item) => item.status === 'running')
      assert.ok(runningViews.length > 0, '应记录到 running 快照')
      assert.ok(
        runningViews.every((item) => item.stageCode === 'running'),
        `running 快照的 stageCode 应恒为 running：${runningViews.map((item) => item.stageCode)}`,
      )
      const doneCounts = new Set(runningViews.map((item) => item.progress?.done))
      assert.ok(doneCounts.has(0) && doneCounts.has(1), `running 进度应包含已完成 0 与 1，实际 ${[...doneCounts]}`)
      assert.ok(
        runningViews.every((item) => item.progress?.total === 2),
        `running 进度 total 应恒为 2：${runningViews.map((item) => item.progress?.total)}`,
      )
      const stages = new Set(runningViews.map((item) => item.stage))
      assert.ok(stages.has('生成中 1/2') && stages.has('生成中 2/2'), `stage 文本应保留 done+1 语义：${[...stages]}`)

      assert.equal(final.stageCode, 'done')
      assert.equal(final.progress, null)
      assert.equal(final.stage, '完成')
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
