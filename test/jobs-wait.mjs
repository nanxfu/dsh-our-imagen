#!/usr/bin/env node
/**
 * JobQueue.waitFor 事件化等待的离线回归（不连 Kaggle、不出外网、不烧 GPU）。
 *
 * 对应 A1：waitFor 不再按固定间隔轮询任务状态，而是任务进入终态时由 runNext 的
 * 收尾路径唤醒等待者。覆盖：
 *  - job 不存在 → null；waitSeconds <= 0 → 立即返回当前快照；
 *  - 任务在 waitFor 注册前已结束 → 立即返回终态（不挂等待者）；
 *  - 完成 / 失败都唤醒全部等待者，多个等待者互不干扰；
 *  - 超时返回当前快照并清理登记；dispose 立即唤醒而不挂到超时。
 *
 * 运行：node test/jobs-wait.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JobQueue } from '../lib/jobs.js'

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
