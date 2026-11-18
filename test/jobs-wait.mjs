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
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  JobQueue,
  normalizeOutpaintContent,
  normalizeReference,
  normalizeReferences,
  normalizeStrength,
  normalizeTool,
  normalizeUpscaleRequest,
  providerGateOf,
} from '../lib/jobs.js'
import { readHistoryItem, saveJobOutput, scanHistory } from '../lib/output.js'
import { submitGenerate, waitForJob } from '../lib/remote.js'
import { LIMITS, PRESETS, UPSCALE } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'

const PRESET = 'sdxl-turbo'
// 1×1 透明 PNG：走真实的 saveJobOutput 落盘路径。
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * 构造「头部可解析」的源图夹具：测试只依赖 PNG 头部（parseImageHeader / 远端头部校验），
 * 不引入图像编码依赖；放大链路的落盘产物用 mock 远端返回的真实 PNG。
 */
function headerOnlyPng(width, height) {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'latin1')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

const { check, results } = createCheckRunner()

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

/** 播种一个历史作品目录（01.png + 可选 meta.json），用于版本链用例；返回图片工作区相对路径。 */
async function seedWork(dirName, meta = null) {
  const dir = join(workspace, 'imagen-output', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '01.png'), Buffer.from(PNG_B64, 'base64'))
  if (meta) {
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ images: [{ file: '01.png' }], ...meta }), 'utf8')
  }
  return `imagen-output/${dirName}/01.png`
}

/**
 * 用最小 job 形状走真实的 saveJobOutput（落盘链路），返回写入的 meta.json。
 * 不经过远端：版本链解析只发生在落盘阶段，这样单测更聚焦、也不依赖假 daemon。
 */
async function persistReferenceJob(reference) {
  const job = {
    id: `j_lineage_${Math.random().toString(16).slice(2, 10)}`,
    presetId: PRESET,
    params: {
      prompt: '版本链测试',
      negativePrompt: '',
      width: 512,
      height: 512,
      steps: 3,
      cfg: 1.5,
      seed: 1,
      count: 1,
      reference,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
  }
  const output = await saveJobOutput(makeCtx(), job, doneResults(1))
  return JSON.parse(await readFile(join(workspace, ...output.metaFile.split('/')), 'utf8'))
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

  // ── 图生图（M3）：参考图入队校验 / 远端载荷 / meta 记录 ────────────────
  await check('图生图：参考图入队校验、远端载荷与 meta.json 记录（publicView 不含二进制）', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const seedDir = join(workspace, 'imagen-output', '20260101-000000-seed')
    await mkdir(seedDir, { recursive: true })
    const seedPath = 'imagen-output/20260101-000000-seed/01.png'
    await writeFile(join(seedDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      // 非法参考图在入队前被拒绝（不触发任何远端提交）。
      const invalid = [
        { path: '../escape.png' },
        { path: 'docs/outside.png' },
        { path: '/abs/path.png' },
        { image: 'not-base64!!' },
        { image: Buffer.from('hello').toString('base64') },
        { path: seedPath, image: PNG_B64 },
        {},
      ]
      for (const reference of invalid) {
        const result = queue.submit({ prompt: '非法参考图', reference })
        assert.equal(result.ok, false, JSON.stringify(reference))
        assert.ok(
          result.code === 'invalid_path' || result.code === 'invalid_request',
          `${JSON.stringify(reference)} → ${result.code}`,
        )
      }
      assert.equal(remote.state.generateCalls.length, 0, '非法参考图不得触发远端提交')

      // 合法：路径来源 + strength 按契约对齐（0.777 → 0.8）。
      const submitted = queue.submit({ prompt: '垫图重绘', reference: { path: seedPath, strength: 0.777 } })
      assert.equal(submitted.ok, true, JSON.stringify(submitted))
      assert.deepEqual(submitted.job.params.reference, { sourcePath: seedPath, strength: 0.8 })
      assert.ok(!JSON.stringify(submitted.job).includes(PNG_B64), 'publicView 不得包含参考图 base64')

      const done = await queue.waitFor(submitted.job.id, 10)
      assert.equal(done.status, 'done', JSON.stringify(done.error))
      const call = remote.state.generateCalls.at(-1)
      assert.deepEqual(call.reference, { image_b64: PNG_B64, strength: 0.8 })
      assert.equal(call.tasks.length, 1)

      const meta = JSON.parse(await readFile(join(workspace, done.output.dir, 'meta.json'), 'utf8'))
      assert.equal(meta.sourceImage, seedPath)
      assert.equal(meta.rootImage, seedPath, '父作品没有 meta 时 rootImage 兜底为 sourcePath')
      assert.equal(meta.strength, 0.8)
      assert.equal(meta.params.reference.sourcePath, seedPath)
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('图生图：参考图不存在 → 任务以 invalid_path 失败；base64 来源与强度越界钳制', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      // 路径形状合法但文件不存在：任务在生成阶段失败，错误码是 invalid_path。
      const missing = queue.submit({
        prompt: '参考图丢了',
        reference: { path: 'imagen-output/20260101-000000-missing/01.png' },
      })
      const failed = await queue.waitFor(missing.job.id, 10)
      assert.equal(failed.status, 'failed')
      assert.equal(failed.error?.code, 'invalid_path')
      assert.equal(remote.state.generateCalls.length, 0)

      // base64 来源（前端上传）：直接下发 image_b64；strength 5 → 钳到 img2img 上限（契约 max）。
      const uploaded = queue.submit({ prompt: '上传参考图', reference: { image: PNG_B64, strength: 5 } })
      assert.equal(uploaded.ok, true)
      assert.equal(uploaded.job.params.reference.strength, LIMITS.strength.max)
      const done = await queue.waitFor(uploaded.job.id, 10)
      assert.equal(done.status, 'done', JSON.stringify(done.error))
      const call = remote.state.generateCalls.at(-1)
      assert.deepEqual(call.reference, { image_b64: PNG_B64, strength: LIMITS.strength.max })
      const meta = JSON.parse(await readFile(join(workspace, done.output.dir, 'meta.json'), 'utf8'))
      assert.equal(meta.sourceImage, null, '上传来源没有工作区路径')
      assert.equal(meta.rootImage, null, '动态上传参考图没有可归组的根作品')
      assert.equal(meta.strength, LIMITS.strength.max)
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  // ── 局部重绘（Inpaint）：参考图 + 蒙版入队校验 / 远端载荷 / meta 标记 ──────
  await check('validator：带蒙版 strength 上限 1.0，无蒙版（含纯 img2img）仍 0.9', async () => {
    // 纯函数层先断言：带蒙版用契约 inpaintMax，否则保持契约 max（img2img 行为不变）。
    assert.ok(
      LIMITS.strength.inpaintMax > LIMITS.strength.max,
      `契约应放宽蒙版场景上限：inpaintMax=${LIMITS.strength.inpaintMax} max=${LIMITS.strength.max}`,
    )
    const masked = normalizeReference({ path: 'imagen-output/x/01.png', strength: 5, mask: PNG_B64 })
    assert.equal(masked.ok, true, JSON.stringify(masked))
    assert.equal(masked.value.strength, LIMITS.strength.inpaintMax)
    const plain = normalizeReference({ path: 'imagen-output/x/01.png', strength: 5 })
    assert.equal(plain.ok, true)
    assert.equal(plain.value.strength, LIMITS.strength.max)
    const uploaded = normalizeReference({ image: PNG_B64, strength: 0.95 })
    assert.equal(uploaded.ok, true)
    assert.equal(uploaded.value.strength, LIMITS.strength.max)
    // 蒙版场景的档位对齐不变：0.777 → 0.8。
    const aligned = normalizeReference({ path: 'imagen-output/x/01.png', strength: 0.777, mask: PNG_B64 })
    assert.equal(aligned.value.strength, 0.8)
    // 显式上限参数同样只允许在 [max, inpaintMax] 之间取值。
    assert.equal(normalizeStrength(5), LIMITS.strength.max)
    assert.equal(normalizeStrength(5, LIMITS.strength.inpaintMax), LIMITS.strength.inpaintMax)
    assert.equal(normalizeStrength(-1, LIMITS.strength.inpaintMax), LIMITS.strength.min)
  })

  await check('局部重绘：蒙版入队校验、远端 mask_b64 透传与 meta.inpaint', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const seedDir = join(workspace, 'imagen-output', '20260101-000000-inpaint-seed')
    await mkdir(seedDir, { recursive: true })
    const seedPath = 'imagen-output/20260101-000000-inpaint-seed/01.png'
    await writeFile(join(seedDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      // 蒙版脱离参考图没有意义：入队前直接拒绝，不占队列、不触发远端提交。
      const orphan = queue.submit({ prompt: '只有蒙版', reference: { mask: PNG_B64 } })
      assert.equal(orphan.ok, false)
      assert.equal(orphan.code, 'invalid_request')
      assert.ok(orphan.message.includes('带蒙版时必须同时提供参考图'), orphan.message)

      // 非法蒙版：base64 不合法 / 非 PNG 魔数 / 超过契约体积上限。
      const invalidMasks = [
        'not-base64!!',
        Buffer.from('not a png image').toString('base64'),
        Buffer.alloc(LIMITS.mask.maxBytes + 1, 1).toString('base64'),
      ]
      for (const mask of invalidMasks) {
        const result = queue.submit({ prompt: '非法蒙版', reference: { path: seedPath, mask } })
        assert.equal(result.ok, false, '非法蒙版必须入队前拒绝')
        assert.equal(result.code, 'invalid_request')
        assert.ok(result.message.includes('蒙版'), `错误文案应指明蒙版：${result.message}`)
      }
      assert.equal(remote.state.generateCalls.length, 0, '非法蒙版不得触发远端提交')

      // data URL 前缀归一后与裸 base64 等价；params 只记「是否带蒙版」，不落 base64。
      const submitted = queue.submit({
        prompt: '把天空换成晚霞',
        reference: { path: seedPath, strength: 0.75, mask: `data:image/png;base64,${PNG_B64}` },
      })
      assert.equal(submitted.ok, true, JSON.stringify(submitted))
      assert.deepEqual(submitted.job.params.reference, {
        sourcePath: seedPath,
        strength: 0.75,
        mask: true,
      })
      assert.ok(!JSON.stringify(submitted.job).includes(PNG_B64), 'publicView 不得包含蒙版 base64')

      const done = await queue.waitFor(submitted.job.id, 10)
      assert.equal(done.status, 'done', JSON.stringify(done.error))
      const call = remote.state.generateCalls.at(-1)
      assert.deepEqual(call.reference, { image_b64: PNG_B64, strength: 0.75, mask_b64: PNG_B64 })
      assert.equal(call.tasks.length, 1)

      const meta = JSON.parse(await readFile(join(workspace, done.output.dir, 'meta.json'), 'utf8'))
      assert.equal(meta.inpaint, true, 'meta 必须记 inpaint 标记')
      assert.equal(meta.sourceImage, seedPath)
      assert.equal(meta.rootImage, seedPath, '局部重绘同样记录根作品路径')
      assert.equal(meta.strength, 0.75)
      assert.equal(meta.params.reference.mask, true)

      // 带蒙版时 strength 上限放宽到 inpaintMax（1.0）：params / 远端载荷 / meta 全链路一致。
      const strong = queue.submit({
        prompt: '高强度局部重绘',
        reference: { path: seedPath, strength: 1.0, mask: PNG_B64 },
      })
      assert.equal(strong.ok, true, JSON.stringify(strong))
      assert.equal(strong.job.params.reference.strength, LIMITS.strength.inpaintMax)
      const strongDone = await queue.waitFor(strong.job.id, 10)
      assert.equal(strongDone.status, 'done', JSON.stringify(strongDone.error))
      assert.deepEqual(remote.state.generateCalls.at(-1).reference, {
        image_b64: PNG_B64,
        strength: LIMITS.strength.inpaintMax,
        mask_b64: PNG_B64,
      })
      const strongMeta = JSON.parse(
        await readFile(join(workspace, strongDone.output.dir, 'meta.json'), 'utf8'),
      )
      assert.equal(strongMeta.strength, LIMITS.strength.inpaintMax)
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('专用局部重绘模型（inpaintOnly）：缺蒙版拒绝入队，带蒙版放行', async () => {
    const preset = PRESETS.find((item) => item.id === 'sdxl-inpaint')
    assert.ok(preset, '契约里应有 sdxl-inpaint 预设')
    assert.equal(preset.inpaintOnly, true, 'sdxl-inpaint 应标记 inpaintOnly')
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const seedDir = join(workspace, 'imagen-output', '20260101-000000-inpaint-only')
    await mkdir(seedDir, { recursive: true })
    const seedPath = 'imagen-output/20260101-000000-inpaint-only/01.png'
    await writeFile(join(seedDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      // 1) 纯文生图：直接拒绝（不占队列、不触发远端）。
      const plain = queue.submit({ prompt: '文生图', presetId: 'sdxl-inpaint' })
      assert.equal(plain.ok, false, 'inpaintOnly 预设不能文生图')
      assert.equal(plain.code, 'invalid_request')
      assert.ok(plain.message.includes('只支持局部重绘'), plain.message)

      // 2) 只有参考图、没有蒙版：同样拒绝（纯图生图也不行）。
      const img2img = queue.submit({
        prompt: '纯图生图',
        presetId: 'sdxl-inpaint',
        reference: { path: seedPath },
      })
      assert.equal(img2img.ok, false)
      assert.equal(img2img.code, 'invalid_request')
      assert.ok(img2img.message.includes('涂抹蒙版'), img2img.message)

      // 3) 参考图 + 蒙版：放行并走远端。
      const ok = queue.submit({
        prompt: '局部重绘',
        presetId: 'sdxl-inpaint',
        reference: { path: seedPath, strength: 0.8, mask: PNG_B64 },
      })
      assert.equal(ok.ok, true, JSON.stringify(ok))
      const done = await queue.waitFor(ok.job.id, 10)
      assert.equal(done.status, 'done', JSON.stringify(done.error))
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  // ── 高清放大（Phase B1）：tool 归一 / 单张远端任务 / meta 标记 ──────────────
  await check('validator：tool 归一、upscale 源图与宽高上限（纯函数）', () => {
    assert.deepEqual(normalizeTool(undefined), { ok: true, tool: 'generate' })
    assert.deepEqual(normalizeTool(''), { ok: true, tool: 'generate' })
    assert.deepEqual(normalizeTool('generate'), { ok: true, tool: 'generate' })
    assert.deepEqual(normalizeTool('upscale'), { ok: true, tool: 'upscale' })
    assert.deepEqual(normalizeTool('outpaint'), { ok: true, tool: 'outpaint' })
    for (const bad of ['inpaint', 'UPSCALE', 42, {}]) {
      const result = normalizeTool(bad)
      assert.equal(result.ok, false, JSON.stringify(bad))
      assert.equal(result.code, 'invalid_request')
    }

    // 放大只接受一张源图：缺 reference / 带蒙版 / 越界路径都在入队期拒绝。
    const missing = normalizeUpscaleRequest({ width: 1024, height: 1024 })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'invalid_request')
    assert.match(missing.message, /源图/)
    const masked = normalizeUpscaleRequest({ reference: { path: 'imagen-output/a/01.png', mask: PNG_B64 } })
    assert.equal(masked.ok, false)
    assert.match(masked.message, /蒙版/)
    const escaped = normalizeUpscaleRequest({ reference: { path: '../escape.png' } })
    assert.equal(escaped.ok, false)
    assert.equal(escaped.code, 'invalid_path')

    const ok = normalizeUpscaleRequest({
      reference: { path: 'imagen-output/20260101-000000-a/01.png' },
      width: 1024,
      height: 768,
    })
    assert.equal(ok.ok, true, JSON.stringify(ok))
    assert.equal(ok.width, 1024)
    assert.equal(ok.height, 768)
    assert.equal(ok.reference.sourcePath, 'imagen-output/20260101-000000-a/01.png')

    // 长边超限：文案给出 1280 上限；宽高缺失时不拦（远端解码后按同一上限兜底）。
    const tooLarge = normalizeUpscaleRequest({ reference: { image: PNG_B64 }, width: 1536, height: 1024 })
    assert.equal(tooLarge.ok, false)
    assert.equal(tooLarge.code, 'invalid_request')
    assert.match(tooLarge.message, new RegExp(String(UPSCALE.maxInputEdge)))
    const unknownExtent = normalizeUpscaleRequest({ reference: { image: PNG_B64 } })
    assert.equal(unknownExtent.ok, true)
    assert.equal(unknownExtent.width, null)
    assert.equal(unknownExtent.height, null)

    // image 来源可选 sourcePath（扩图溯源）：非法路径同样按 invalid_path 拒绝，
    // 合法时统一挂在返回值的 sourcePath 上（path 来源则等于 path 自己）。
    const badSource = normalizeReference({ image: PNG_B64, sourcePath: '../x.png' })
    assert.equal(badSource.ok, false)
    assert.equal(badSource.code, 'invalid_path')
    assert.match(badSource.message, /来源图/)
    const withSource = normalizeReference({ image: PNG_B64, sourcePath: 'imagen-output/20260101-000000-a/01.png' })
    assert.equal(withSource.ok, true)
    assert.equal(withSource.value.sourcePath, 'imagen-output/20260101-000000-a/01.png')
    // 旧行为不变：纯 image 来源没有 sourcePath 时就是 null；path 来源的 sourcePath = path。
    assert.equal(normalizeReference({ image: PNG_B64 }).value.sourcePath, null)
    assert.equal(normalizeReference({ path: 'imagen-output/20260101-000000-a/01.png' }).value.sourcePath,
      'imagen-output/20260101-000000-a/01.png')
    // 文生图仍然要求 prompt（放大 / 扩图才允许空提示词）。
    const queue = makeQueue()
    try {
      assert.equal(queue.submit({ prompt: '' }).code, 'invalid_prompt')
    } finally {
      queue.dispose()
    }
  })

  await check('高清放大：单张远端任务（tool=upscale）、进度 total=1 与 meta.upscale', async () => {
    const remote = await startFlakyRemote()
    const upscaleResult = {
      name: '01',
      seed: 0,
      seconds: 0.2,
      width: 2048,
      height: 1536,
      steps: 0,
      cfg: 0,
      png_bytes: 70,
      image_b64: PNG_B64,
      upscale: true,
      scale: 2,
      sourceWidth: 1024,
      sourceHeight: 768,
    }
    // 前两次 /job 返回 running 0/1（观察结构化进度），第三次 done。
    remote.state.nextPolls = [
      { status: 'running', job_id: 'x', progress: { done: 0, total: 1 }, results: null, error: null },
      { status: 'running', job_id: 'x', progress: { done: 0, total: 1 }, results: null, error: null },
      {
        status: 'done',
        job_id: 'x',
        model_id: UPSCALE.id,
        progress: { done: 1, total: 1 },
        load_seconds: 0.1,
        results: [upscaleResult],
        error: null,
      },
    ]
    const seedDir = join(workspace, 'imagen-output', '20260101-000000-upscale-seed')
    await mkdir(seedDir, { recursive: true })
    const seedPath = 'imagen-output/20260101-000000-upscale-seed/01.png'
    await writeFile(join(seedDir, '01.png'), headerOnlyPng(1024, 768))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      const submitted = queue.submit({
        tool: 'upscale',
        prompt: '',
        width: 1024,
        height: 768,
        reference: { path: seedPath },
      })
      assert.equal(submitted.ok, true, JSON.stringify(submitted))
      assert.equal(submitted.job.tool, 'upscale', 'publicView 必须带 tool')
      assert.equal(submitted.job.presetId, UPSCALE.id)
      assert.equal(submitted.job.modelId, UPSCALE.id)
      assert.deepEqual(submitted.job.params.reference, { sourcePath: seedPath, upscale: true })
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
      const running = seen.filter((item) => item.status === 'running')
      assert.ok(running.length > 0, '应记录到 running 快照')
      assert.ok(
        running.every((item) => item.progress?.total === 1),
        `放大进度 total 固定 1：${running.map((item) => JSON.stringify(item.progress))}`,
      )

      // 远端载荷：只有 1 个 job，tool=upscale，不下发 pipeline / tasks / strength。
      assert.equal(remote.state.generateCalls.length, 1, '放大只提交一个远端 job')
      const call = remote.state.generateCalls[0]
      assert.equal(call.tool, 'upscale')
      assert.equal(call.jobId, `${jobId}-01`)
      assert.equal(call.modelId, UPSCALE.id)
      assert.equal(call.pipeline, undefined, '放大请求不应带扩散 pipeline')
      assert.equal(call.tasks, undefined, '放大任务由远端合成，Host 不下发 tasks')
      assert.deepEqual(call.reference, { image_b64: headerOnlyPng(1024, 768).toString('base64') })

      assert.equal(final.output.images.length, 1)
      assert.equal(final.output.images[0].width, 2048)
      assert.equal(final.output.images[0].height, 1536)
      const meta = JSON.parse(await readFile(join(workspace, final.output.dir, 'meta.json'), 'utf8'))
      assert.equal(meta.upscale, true)
      assert.equal(meta.upscaleScale, 2)
      assert.deepEqual(meta.upscaleSource, { width: 1024, height: 768 })
      assert.equal(meta.sourceImage, seedPath)
      assert.equal(meta.rootImage, seedPath)
      assert.equal(meta.inpaint, undefined, '放大不是局部重绘')
      assert.equal(meta.outpaint, undefined)
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('高清放大：远端失败原样透传（oom），源图缺失在生成阶段 invalid_path', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, {
        status: 'failed',
        job_id: body.jobId,
        model_id: UPSCALE.id,
        progress: { done: 0, total: 1 },
        results: null,
        error: { code: 'oom', message: '显存不足：mock 注入' },
      })
    }
    const seedDir = join(workspace, 'imagen-output', '20260101-000000-upscale-fail')
    await mkdir(seedDir, { recursive: true })
    const seedPath = 'imagen-output/20260101-000000-upscale-fail/01.png'
    await writeFile(join(seedDir, '01.png'), headerOnlyPng(1024, 768))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      const submitted = queue.submit({
        tool: 'upscale',
        prompt: '',
        width: 1024,
        height: 768,
        reference: { path: seedPath },
      })
      const failed = await queue.waitFor(submitted.job.id, 10)
      assert.equal(failed.status, 'failed')
      assert.equal(failed.error?.code, 'oom', '远端失败码原样透传')
      assert.match(failed.error?.message, /显存不足/)
      assert.equal(failed.output, null, '失败任务不落产物目录')
      assert.equal(failed.progress, null)

      // 路径形状合法但文件不存在：执行阶段读源图失败 → invalid_path，且不提交远端。
      const before = remote.state.generateCalls.length
      const missing = queue.submit({
        tool: 'upscale',
        prompt: '',
        width: 1024,
        height: 768,
        reference: { path: 'imagen-output/20260101-000000-nope/01.png' },
      })
      assert.equal(missing.ok, true, '路径形状合法即可入队（文件是否存在在执行阶段校验）')
      const missingDone = await queue.waitFor(missing.job.id, 10)
      assert.equal(missingDone.status, 'failed')
      assert.equal(missingDone.error?.code, 'invalid_path')
      assert.equal(remote.state.generateCalls.length, before, '源图缺失不应提交远端')
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('validator：outpaintContent 归一化、来源约束与非法值', () => {
    // 缺失 = 不需要对比框（旧客户端行为）；合法值按契约精度归一。
    assert.deepEqual(normalizeOutpaintContent(undefined), { ok: true, value: null })
    assert.deepEqual(normalizeOutpaintContent(null), { ok: true, value: null })
    const valid = normalizeOutpaintContent({ x: 0.1875, y: 0, width: 0.5625, height: 0.9 })
    assert.equal(valid.ok, true, JSON.stringify(valid))
    assert.deepEqual(valid.value, { x: 0.1875, y: 0, width: 0.5625, height: 0.9 })
    // 4 位小数归一：客户端用除法算出来的浮点尾巴不进公开视图。
    const rounded = normalizeOutpaintContent({ x: 0.12345, y: 0.00004, width: 0.3333333, height: 0.5 })
    assert.equal(rounded.ok, true, JSON.stringify(rounded))
    assert.deepEqual(rounded.value, { x: 0.1235, y: 0, width: 0.3333, height: 0.5 })
    // 浮点容差：x+width 因除法误差略超 1 不拒绝；归一后保证自身不越界。
    const tolerant = normalizeOutpaintContent({ x: 0.5, y: 0.25, width: 0.5004, height: 0.75 })
    assert.equal(tolerant.ok, true, JSON.stringify(tolerant))
    assert.ok(tolerant.value.x + tolerant.value.width <= 1 + 1e-9, JSON.stringify(tolerant.value))

    const invalid = [
      { x: 0, y: 0, width: 1 }, // 缺字段
      { x: '0', y: 0, width: 1, height: 1 }, // 非数字
      { x: 0, y: 0, width: 1.5, height: 1 }, // 越界
      { x: -0.2, y: 0, width: 1, height: 1 }, // 负数越界
      { x: 0.6, y: 0, width: 0.5, height: 1 }, // x+width > 1
      { x: 0, y: 0.6, width: 1, height: 0.5 }, // y+height > 1
      { x: 0.2, y: 0.2, width: 0, height: 0.5 }, // 面积 0
      { x: 0.2, y: 0.2, width: -0.1, height: 0.5 }, // 负宽
      [0, 0, 1, 1], // 数组
      'not-an-object',
    ]
    for (const value of invalid) {
      const result = normalizeOutpaintContent(value)
      assert.equal(result.ok, false, JSON.stringify(value))
      assert.equal(result.code, 'invalid_request')
      assert.match(result.message, /outpaintContent/)
    }

    // 来源约束：path 来源没有画布坐标系，携带内容框 → 400；image 来源合法携带 → 归一后返回。
    const pathWithContent = normalizeReference({
      path: 'imagen-output/20260101-000000-a/01.png',
      outpaintContent: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    })
    assert.equal(pathWithContent.ok, false)
    assert.equal(pathWithContent.code, 'invalid_request')
    assert.match(pathWithContent.message, /outpaintContent/)
    const imageWithContent = normalizeReference({
      image: PNG_B64,
      outpaintContent: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    })
    assert.equal(imageWithContent.ok, true, JSON.stringify(imageWithContent))
    assert.deepEqual(imageWithContent.value.outpaintContent, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
    // 未携带时恒为 null（调用方 / 客户端不必判断字段是否存在）。
    assert.equal(normalizeReference({ image: PNG_B64 }).value.outpaintContent, null)
    assert.equal(
      normalizeReference({ path: 'imagen-output/20260101-000000-a/01.png' }).value.outpaintContent,
      null,
    )
    // 非法内容框在 normalizeReference 里同样以 invalid_request 拒绝（不静默丢弃）。
    const badReference = normalizeReference({
      image: PNG_B64,
      outpaintContent: { x: 0.9, y: 0, width: 0.5, height: 0.5 },
    })
    assert.equal(badReference.ok, false)
    assert.equal(badReference.code, 'invalid_request')
  })

  await check('扩图：tool=outpaint 记 outpaint/inpaint/sourcePath，远端载荷仍是普通局部重绘', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const sourcePath = await seedWork('20260101-000000-outpaint-source')
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      // 画布 base64 由客户端合成；sourcePath 指回被扩的原作品（版本树归组用），
      // outpaintContent 是原图在画布里的内容框（归一化 0~1，对比拉帘对齐用）。
      const content = { x: 0.1, y: 0.05, width: 0.8, height: 0.9 }
      const submitted = queue.submit({
        tool: 'outpaint',
        presetId: 'sdxl-inpaint',
        prompt: '向四周扩展成 16:9 的风景',
        width: 1280,
        height: 720,
        steps: 8,
        cfg: 7,
        count: 1,
        reference: { image: PNG_B64, mask: PNG_B64, sourcePath, strength: 1.0, outpaintContent: content },
      })
      assert.equal(submitted.ok, true, JSON.stringify(submitted))
      assert.equal(submitted.job.tool, 'outpaint')
      assert.equal(submitted.job.presetId, 'sdxl-inpaint')
      // 公开视图只暴露归一后的小对象（不含二进制），内容框随 params 透传给客户端。
      assert.deepEqual(submitted.job.params.reference, {
        sourcePath,
        strength: 1.0,
        outpaintContent: content,
        mask: true,
      })
      assert.ok(!JSON.stringify(submitted.job).includes(PNG_B64), 'publicView 不得回传画布/蒙版二进制')

      const done = await queue.waitFor(submitted.job.id, 10)
      assert.equal(done.status, 'done', JSON.stringify(done.error))
      const call = remote.state.generateCalls.at(-1)
      assert.equal(call.tool, undefined, '远端看不到 outpaint：就是一次普通 inpaint 请求')
      assert.deepEqual(call.reference, { image_b64: PNG_B64, strength: 1.0, mask_b64: PNG_B64 })
      assert.equal(call.reference.outpaintContent, undefined, '内容框只属于 Host/Client，不下发远端')

      const meta = JSON.parse(await readFile(join(workspace, done.output.dir, 'meta.json'), 'utf8'))
      assert.equal(meta.outpaint, true, 'meta 必须记 outpaint 标记')
      assert.equal(meta.inpaint, true, '扩图在远端是局部重绘，inpaint 标记保留')
      assert.equal(meta.sourceImage, sourcePath, 'image 来源也要按 sourcePath 记来源图')
      assert.equal(meta.rootImage, sourcePath, '来源图没有父 meta 时 rootImage 兜底为 sourcePath')
      assert.equal(meta.strength, 1.0)
      assert.equal(meta.params.reference.sourcePath, sourcePath)
      assert.deepEqual(meta.outpaintContent, content, 'meta 必须记录归一后的内容框')

      // /history 透传：合法对象原样回给客户端（读取时再归一一次）。
      const { items } = await scanHistory(makeCtx(), { limit: LIMITS.history.maxLimit })
      const historyItem = items.find((item) => item.jobId === submitted.job.id)
      assert.ok(historyItem, '历史里应有刚完成的扩图')
      assert.deepEqual(historyItem.outpaintContent, content)
      assert.equal(historyItem.outpaint, true)

      // 旧客户端（不带 outpaintContent）：meta 显式写 null，历史端该字段恒存在。
      const legacy = queue.submit({
        tool: 'outpaint',
        presetId: 'sdxl-inpaint',
        prompt: '不带内容框的扩图',
        reference: { image: PNG_B64, mask: PNG_B64, sourcePath, strength: 1.0 },
      })
      assert.equal(legacy.ok, true, JSON.stringify(legacy))
      assert.deepEqual(legacy.job.params.reference, { sourcePath, strength: 1.0, mask: true })
      const legacyDone = await queue.waitFor(legacy.job.id, 10)
      assert.equal(legacyDone.status, 'done', JSON.stringify(legacyDone.error))
      const legacyMeta = JSON.parse(
        await readFile(join(workspace, legacyDone.output.dir, 'meta.json'), 'utf8'),
      )
      assert.equal(legacyMeta.outpaintContent, null, '没有内容框的扩图显式写 null')
      const legacyItems = (await scanHistory(makeCtx(), { limit: LIMITS.history.maxLimit })).items
      const legacyItem = legacyItems.find((item) => item.jobId === legacy.job.id)
      assert.equal(legacyItem.outpaintContent, null, '旧产物 / 无内容框的历史条目恒为 null')

      // 现代扩图（FLUX.2 Klein 4B + Outpaint LoRA，无蒙版绿边画布）：
      // Host 自动注入 pipeline.lora，把画布放入 referenceImages，并在留空时发触发词、填写时拼接追加。
      const modern = queue.submit({
        tool: 'outpaint',
        presetId: 'flux2-klein-4b',
        prompt: '',
        width: 1536,
        height: 864,
        reference: { image: PNG_B64, sourcePath, outpaintContent: content },
      })
      assert.equal(modern.ok, true, JSON.stringify(modern))
      assert.equal(modern.job.params.prompt, '', '公开视图 / meta 不污染英文 LoRA 触发词')
      assert.deepEqual(modern.job.params.reference, { sourcePath, outpaintContent: content })
      const modernDone = await queue.waitFor(modern.job.id, 10)
      assert.equal(modernDone.status, 'done', JSON.stringify(modernDone.error))
      const modernCall = remote.state.generateCalls.at(-1)
      assert.equal(modernCall.reference, undefined, '现代扩图不走单图 reference')
      assert.deepEqual(modernCall.referenceImages, [{ image_b64: PNG_B64 }])
      assert.equal(modernCall.pipeline.lora.repo, 'fal/flux-2-klein-4B-outpaint-lora')
      assert.equal(modernCall.pipeline.lora.weight, 'flux-outpaint-lora.safetensors')
      assert.equal(modernCall.pipeline.lora.scale, 1.1)
      assert.equal(modernCall.tasks[0].prompt, 'Fill the green spaces according to the image')
      assert.equal(modernCall.tasks[0].width, 1536)
      assert.equal(modernCall.tasks[0].height, 864)

      const modernTyped = queue.submit({
        tool: 'outpaint',
        presetId: 'flux2-klein-4b',
        prompt: 'misty pine trees',
        width: 1536,
        height: 864,
        reference: { image: PNG_B64, sourcePath, outpaintContent: content },
      })
      assert.equal(modernTyped.ok, true, JSON.stringify(modernTyped))
      const modernTypedDone = await queue.waitFor(modernTyped.job.id, 10)
      assert.equal(modernTypedDone.status, 'done', JSON.stringify(modernTypedDone.error))
      assert.equal(
        remote.state.generateCalls.at(-1).tasks[0].prompt,
        'Fill the green spaces according to the image, misty pine trees',
      )
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  // ── 模型原生参考生图（supportsReference，阶段十五 Phase C1）─────────────
  await check('validator：references 列表归一、数量上限与重复/越界路径', () => {
    assert.deepEqual(normalizeReferences(undefined), { ok: true, value: null })
    assert.deepEqual(normalizeReferences(''), { ok: true, value: null })
    const okay = normalizeReferences([
      'imagen-output/20260101-000000-ref-a/01.png',
      'imagen-output/20260101-000000-ref-b\\01.png',
    ])
    assert.equal(okay.ok, true, JSON.stringify(okay))
    assert.deepEqual(okay.value, [
      'imagen-output/20260101-000000-ref-a/01.png',
      'imagen-output/20260101-000000-ref-b/01.png',
    ])
    const rejections = [
      [[], 'invalid_request', '不能为空数组'],
      ['not-an-array', 'invalid_request', '必须是数组'],
      [42, 'invalid_request', '必须是数组'],
      [[{ path: 'x' }], 'invalid_request', '必须是工作区相对路径字符串'],
      [['../escape.png'], 'invalid_path', '不在 imagen-output/'],
      [['/abs/path.png'], 'invalid_path', '工作区相对路径'],
      [['docs/hero.png'], 'invalid_path', '只能引用 imagen-output/ 内的作品'],
      [['imagen-output/a/01.png', 'imagen-output/a/01.png'], 'invalid_request', '重复路径'],
    ]
    for (const [value, code, needle] of rejections) {
      const result = normalizeReferences(value)
      assert.equal(result.ok, false, JSON.stringify(value))
      assert.equal(result.code, code, JSON.stringify(value))
      assert.ok(result.message.includes(needle), `${JSON.stringify(value)} → ${result.message}`)
    }
    const tooMany = Array.from(
      { length: LIMITS.referenceImages.maxCount + 1 },
      (_, index) => `imagen-output/20260101-000000-many-${index}/01.png`,
    )
    const overflow = normalizeReferences(tooMany)
    assert.equal(overflow.ok, false)
    assert.ok(overflow.message.includes(`最多 ${LIMITS.referenceImages.maxCount} 张`), overflow.message)
    // 契约字段确实存在且与模型资产能力位分开：flux2 支持原生参考，sdxl 不支持。
    assert.equal(LIMITS.referenceImages.maxBytes, 4 * 1024 * 1024)
    assert.equal(PRESETS.find((preset) => preset.id === 'flux2-klein-4b').supportsReference, true)
    assert.equal(PRESETS.find((preset) => preset.id === 'sdxl-lightning').supportsReference, false)
  })

  await check('参考生图：入队校验、远端 referenceImages 载荷、meta 与 /history 溯源', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const firstDir = join(workspace, 'imagen-output', '20260101-000000-native-ref-a')
    const secondDir = join(workspace, 'imagen-output', '20260101-000000-native-ref-b')
    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })
    const firstPath = 'imagen-output/20260101-000000-native-ref-a/01.png'
    const secondPath = 'imagen-output/20260101-000000-native-ref-b/01.png'
    await writeFile(join(firstDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    await writeFile(join(secondDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: 'flux2-klein-4b',
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      const submitted = queue.submit({
        prompt: '同一主角走进雪山',
        presetId: 'flux2-klein-4b',
        width: 1024,
        height: 768,
        references: [firstPath, secondPath],
        count: 2,
        seed: 7,
      })
      assert.equal(submitted.ok, true, JSON.stringify(submitted))
      // 公开视图只给参考图出处（路径），不含任何二进制；宽高仍是请求值。
      assert.deepEqual(submitted.job.params.referenceSources, [firstPath, secondPath])
      assert.equal(submitted.job.params.width, 1024)
      assert.equal(submitted.job.params.height, 768)
      assert.ok(!JSON.stringify(submitted.job).includes(PNG_B64), '任务视图不得回传参考图二进制')

      const done = await queue.waitFor(submitted.job.id, 10)
      assert.equal(done.status, 'done', JSON.stringify(done.error))
      assert.equal(done.output.images.length, 2)

      const calls = remote.state.generateCalls
      assert.equal(calls.length, 2, '逐张提交：count=2 → 两个远端 job')
      calls.forEach((call, index) => {
        assert.deepEqual(
          call.referenceImages,
          [{ image_b64: PNG_B64 }, { image_b64: PNG_B64 }],
          '远端载荷是 job 级 referenceImages（逐项只含 image_b64）',
        )
        assert.equal(call.reference, undefined, '不得混入单图垫图的 reference 字段')
        assert.equal(call.tasks[0].width, 1024)
        assert.equal(call.tasks[0].height, 768)
        assert.equal(call.tasks[0].seed, 7 + index, '同批 seed 按序号递增')
      })

      const meta = JSON.parse(await readFile(join(workspace, done.output.dir, 'meta.json'), 'utf8'))
      assert.equal(meta.source, 'ai')
      assert.deepEqual(meta.referenceSources, [firstPath, secondPath])
      assert.equal('sourceImage' in meta, false, '原生参考产物不折叠进参考图版本树')
      assert.equal('rootImage' in meta, false)
      assert.deepEqual(meta.params.referenceSources, [firstPath, secondPath])

      const { items } = await scanHistory(makeCtx(), { limit: 100 })
      const item = items.find((entry) => entry.jobId === done.id)
      assert.ok(item, '历史里应能找到本次产物')
      assert.deepEqual(item.referenceSources, [firstPath, secondPath], '/history 必须透传 referenceSources')
      assert.equal(item.rootImage, null, '原生参考产物每张候选图各自为根')
      assert.equal(item.source, 'ai')
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('参考生图：与 reference 互斥、模型能力位与 tool 限制、执行期路径校验', async () => {
    const remote = await startFlakyRemote()
    remote.state.onGenerate = (state, count) => {
      const body = state.generateCalls[count - 1]
      state.jobs.set(body.jobId, doneJob(body.jobId, 1))
    }
    const seedDir = join(workspace, 'imagen-output', '20260101-000000-native-ref-guard')
    await mkdir(seedDir, { recursive: true })
    const seedPath = 'imagen-output/20260101-000000-native-ref-guard/01.png'
    await writeFile(join(seedDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: remote.endpoint, token: 'test-token' }) }),
      defaultPreset: 'flux2-klein-4b',
      options: { generateTimeoutMs: 5000, pollMs: 20 },
    })
    try {
      // 1) 两条参考路径互斥：同时给出必须 400，而不是挑一条静默忽略。
      const mixed = queue.submit({
        prompt: '混用参考图',
        presetId: 'flux2-klein-4b',
        reference: { path: seedPath },
        references: [seedPath],
      })
      assert.equal(mixed.ok, false)
      assert.equal(mixed.code, 'invalid_request')
      assert.ok(mixed.message.includes('不能同时使用'), mixed.message)

      // 2) 模型能力位：不支持 supportsReference 的预设直接拒绝（daemon 侧还有白名单兜底）。
      const unsupported = queue.submit({
        prompt: 'SDXL 用原生参考',
        presetId: 'sdxl-turbo',
        references: [seedPath],
      })
      assert.equal(unsupported.ok, false)
      assert.equal(unsupported.code, 'invalid_request')
      assert.ok(unsupported.message.includes('不支持参考生图'), unsupported.message)

      // 3) 只允许 tool=generate。
      const upscale = queue.submit({
        tool: 'upscale',
        presetId: 'flux2-klein-4b',
        references: [seedPath],
      })
      assert.equal(upscale.ok, false)
      assert.equal(upscale.code, 'invalid_request')
      assert.ok(upscale.message.includes('只支持普通出图'), upscale.message)

      // 4) 数量超限。
      const many = Array.from(
        { length: LIMITS.referenceImages.maxCount + 1 },
        (_, index) => `imagen-output/20260101-000000-many-${index}/01.png`,
      )
      const overflow = queue.submit({
        prompt: '参考图过多',
        presetId: 'flux2-klein-4b',
        references: many,
      })
      assert.equal(overflow.ok, false)
      assert.equal(overflow.code, 'invalid_request')

      assert.equal(remote.state.generateCalls.length, 0, '非法请求不得触发远端提交')

      // 5) 路径形状合法但文件不存在：执行阶段失败 invalid_path（不占远端 GPU）。
      const missing = queue.submit({
        prompt: '参考图丢了',
        presetId: 'flux2-klein-4b',
        references: ['imagen-output/20260101-000000-native-ref-missing/01.png'],
      })
      assert.equal(missing.ok, true)
      const failed = await queue.waitFor(missing.job.id, 10)
      assert.equal(failed.status, 'failed')
      assert.equal(failed.error?.code, 'invalid_path')
      assert.equal(remote.state.generateCalls.length, 0, '读取参考图失败前不得提交远端');

      // 6) 体积超限 / 非 PNG-JPEG 魔数：入队合法、执行阶段 invalid_request。
      const bigDir = join(workspace, 'imagen-output', '20260101-000000-native-ref-big')
      await mkdir(bigDir, { recursive: true })
      await writeFile(join(bigDir, '01.png'), Buffer.alloc(LIMITS.referenceImages.maxBytes + 1, 1))
      const big = queue.submit({
        prompt: '参考图过大',
        presetId: 'flux2-klein-4b',
        references: ['imagen-output/20260101-000000-native-ref-big/01.png'],
      })
      const bigFailed = await queue.waitFor(big.job.id, 10)
      assert.equal(bigFailed.status, 'failed')
      assert.equal(bigFailed.error?.code, 'invalid_request')
      assert.ok(bigFailed.error.message.includes('MB 上限'), bigFailed.error.message)

      const badDir = join(workspace, 'imagen-output', '20260101-000000-native-ref-bad')
      await mkdir(badDir, { recursive: true })
      await writeFile(join(badDir, '01.png'), Buffer.from('not an image at all'))
      const bad = queue.submit({
        prompt: '参考图格式非法',
        presetId: 'flux2-klein-4b',
        references: ['imagen-output/20260101-000000-native-ref-bad/01.png'],
      })
      const badFailed = await queue.waitFor(bad.job.id, 10)
      assert.equal(badFailed.status, 'failed')
      assert.equal(badFailed.error?.code, 'invalid_request')
      assert.ok(badFailed.error.message.includes('PNG / JPEG'), badFailed.error.message)
    } finally {
      queue.dispose()
      await remote.close()
    }
  })

  await check('参考生图：旧 meta 没有 referenceSources 时 /history 恒为 null', async () => {
    // meta 传空对象：seedWork 只有 meta 为真值时才写 meta.json（旧产物同样有 meta、只是没有新字段）。
    const legacyPath = await seedWork('20260101-000000-legacy-history', { jobId: 'j_legacy_history' })
    // 直接读单个产物目录（不依赖分页窗口，避免被后续用例生成的大量目录挤出）。
    const item = await readHistoryItem(makeCtx(), join(workspace, 'imagen-output'), '20260101-000000-legacy-history')
    assert.ok(item, '应能读取播种的历史作品')
    assert.equal(item.images[0].path, legacyPath)
    assert.equal(item.referenceSources, null, '旧产物 / 纯文生图恒为 null，客户端不必判断字段是否存在')
  })

  // ── 版本链（阶段十三）：meta.rootImage 落盘与旧数据回溯 ──────────────────
  await check('版本链：父作品没有 meta.json 时 rootImage 兜底为 sourcePath', async () => {
    const parentPath = await seedWork('20260101-000000-lineage-no-meta')
    const meta = await persistReferenceJob({ sourcePath: parentPath, strength: 0.6 })
    assert.equal(meta.sourceImage, parentPath)
    assert.equal(meta.rootImage, parentPath, '读不到父作品 meta 时应退回来源图本身')
    assert.equal(meta.strength, 0.6)
  })

  await check('版本链：父作品 meta.json 损坏时 rootImage 兜底为 sourcePath', async () => {
    const parentPath = await seedWork('20260101-000000-lineage-broken')
    await writeFile(
      join(workspace, 'imagen-output', '20260101-000000-lineage-broken', 'meta.json'),
      '{ 这不是合法 JSON',
      'utf8',
    )
    const meta = await persistReferenceJob({ sourcePath: parentPath, strength: 0.55 })
    assert.equal(meta.rootImage, parentPath, '父 meta 损坏不得让落盘失败，退回来源图')
  })

  await check('版本链：父作品 meta 有 rootImage 时直接继承（两级派生）', async () => {
    const rootPath = await seedWork('20260101-000000-lineage-root', { jobId: 'j_lineage_root' })
    const childPath = await seedWork('20260101-000001-lineage-child', {
      jobId: 'j_lineage_child',
      sourceImage: rootPath,
      rootImage: rootPath,
      strength: 0.6,
    })
    const meta = await persistReferenceJob({ sourcePath: childPath, strength: 0.5 })
    assert.equal(meta.sourceImage, childPath)
    assert.equal(meta.rootImage, rootPath, '应继承父作品记录的根，而不是把父作品自身当根')
  })

  await check('版本链：旧 meta 无 rootImage 时按 sourceImage 链回溯到根（≤8 层）', async () => {
    const rootPath = await seedWork('20260101-000000-legacy-root', { jobId: 'j_legacy_root' })
    const firstPath = await seedWork('20260101-000001-legacy-1', { sourceImage: rootPath })
    const secondPath = await seedWork('20260101-000002-legacy-2', { sourceImage: firstPath })
    const meta = await persistReferenceJob({ sourcePath: secondPath, strength: 0.6 })
    assert.equal(meta.rootImage, rootPath, '旧数据应沿 sourceImage 链一路回溯到没有来源图的根')
  })

  await check('版本链：回溯深度上限 8 层，超长旧链停在深度上限而不是全量走完', async () => {
    const chain = []
    for (let index = 0; index < 10; index += 1) {
      const previous = chain[index - 1] ?? null
      chain.push(
        await seedWork(`20260101-00000${index}-legacy-deep`, {
          jobId: `j_legacy_deep_${index}`,
          ...(previous ? { sourceImage: previous } : {}),
        }),
      )
    }
    const meta = await persistReferenceJob({ sourcePath: chain[9], strength: 0.6 })
    // 从 chain[9] 起读 8 层 meta（chain[9] … chain[2]）后停在 chain[1]：
    // 深度上限是「旧数据回溯成本」的硬边界，不是必须走完整条链。
    assert.equal(meta.rootImage, chain[1], `应停在 8 层上限处，实际 ${meta.rootImage}`)
    assert.notEqual(meta.rootImage, chain[0], '超过上限后不再继续回溯到真正的根')
  })

  await check('算力来源能力位：Host 侧兜底拒绝当前 provider 跑不了的预设', async () => {
    // 纯函数口径：缺省 / 空数组放行；显式 providers 不匹配时给出可读原因。
    assert.equal(providerGateOf({ id: 'plain' }, 'kaggle'), null, '缺省 providers 两种来源都放行')
    assert.equal(providerGateOf({ id: 'plain', providers: [] }, 'kaggle'), null, '空数组按缺省处理')
    assert.equal(providerGateOf({ id: 'nine', providers: ['colab'] }, 'colab'), null, '匹配来源放行')
    assert.equal(providerGateOf({ id: 'nine', providers: ['colab'] }, undefined), null, '来源未知时不误拦')
    const gated = providerGateOf({ id: 'flux2-klein-9b', label: 'FLUX.2 Klein 9B', providers: ['colab'] }, 'kaggle')
    assert.equal(gated.code, 'invalid_request')
    assert.ok(gated.message.includes('FLUX.2 Klein 9B'), gated.message)
    assert.ok(gated.message.includes('colab') && gated.message.includes('kaggle'), gated.message)

    // 接线口径：submit 用当前 provider 判断，被拒任务不占队列；切换到 colab 后同一请求不再被该门拒绝。
    // 本轮没有发布声明 providers 的资产：临时给默认预设置位，测完还原（不依赖资产是否入库）。
    const target = PRESETS.find((preset) => preset.id === PRESET)
    assert.ok(target, '找不到默认预设')
    target.providers = ['colab']
    const queue = new JobQueue({
      ctx: makeCtx(),
      session: makeSession({ connection: () => ({ endpoint: 'http://127.0.0.1:1', token: 'test-token' }) }),
      defaultPreset: PRESET,
      options: { generateTimeoutMs: 1000, getProvider: () => 'kaggle' },
    })
    try {
      const rejected = queue.submit({ prompt: '在 Kaggle 选仅 Colab 预设' })
      assert.equal(rejected.ok, false)
      assert.equal(rejected.code, 'invalid_request')
      assert.ok(rejected.message.includes(target.label ?? PRESET), rejected.message)
      assert.ok(rejected.message.includes('colab'), rejected.message)
      assert.equal(queue.pending.length, 0, '被拒任务不占队列')

      const colabQueue = new JobQueue({
        ctx: makeCtx(),
        session: makeSession(),
        defaultPreset: PRESET,
        options: { generateTimeoutMs: 1000, getProvider: () => 'colab' },
      })
      // 只验证门控接线：拦下执行阶段（不连远端、不等待会话），避免用例引入异步噪声。
      colabQueue.runNext = () => {}
      const accepted = colabQueue.submit({ prompt: '在 Colab 跑仅 Colab 预设' })
      assert.equal(accepted.ok, true, '切到 colab 后应当放行')
      colabQueue.dispose()
    } finally {
      delete target.providers
      queue.dispose()
    }
  })

  clearTimeout(watchdog)
  console.log('')
  const failed = results.filter((item) => !item.ok).length
  if (failed) {
    console.log(`结果：${failed} 项失败，${results.length - failed} 项通过`)
    process.exitCode = 1
  } else {
    console.log(`结果：${results.length} 项全部通过`)
  }
}

try {
  await main()
} finally {
  if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => {})
}
