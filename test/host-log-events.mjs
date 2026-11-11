#!/usr/bin/env node
/**
 * Host 关键链路结构化日志落盘离线回归（无 Kaggle / 无 GPU / 无外网）。
 *
 * 覆盖 docs/PRE_RELEASE_SPEC.md §2.2 的出图队列打点：
 *  - 临时工作区 + installFileLog(ctx, { level: 'debug' }) 后，模块级 createLogger
 *    （JobQueue 在 import 时创建）也能写入 Host 日志文件；
 *  - JobQueue 提交任务 → 会话被手动关闭 → stopped 失败路径，断言存在
 *    enqueue / wait_session_start / wait_session_done / canceled_by_stop / job_failed 事件；
 *  - 事件带 promptLen，但 prompt / negativePrompt 正文（唯一哨兵串）不得出现在日志文件里；
 *  - 入参被拒（invalid_prompt）记录 enqueue_rejected，同样不落正文。
 *
 * 运行：node test/host-log-events.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JobQueue } from '../lib/jobs.js'
import { flushHostLog, hostLogPath, installFileLog, readHostLogTail } from '../lib/log.js'
import { LIMITS } from '../shared/contract.js'

const PRESET = 'sdxl-turbo'
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

let workspace = null
let fileLog = null

function makeCtx() {
  return {
    get(name) {
      return name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined
    },
  }
}

/**
 * 假会话：未就绪 + 用户已手动关机。
 * JobQueue 会命中 stopped 失败路径，且不会调用 start / ensureReady（关机后不得自动拉起 Kernel）。
 */
function makeStoppedSession() {
  const calls = { start: 0, ensureReady: 0 }
  return {
    isReady: false,
    stoppedByUser: true,
    calls,
    snapshot: () => ({ state: 'absent', error: null }),
    connection: () => ({ endpoint: null, token: null }),
    start: async () => {
      calls.start += 1
      return { state: 'provisioning', error: null }
    },
    ensureReady: async () => {
      calls.ensureReady += 1
      return { state: 'ready', error: null }
    },
  }
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error('\n测试超时（30s），强制退出')
    process.exit(2)
  }, 30000)
  watchdog.unref?.()

  console.log('host-log-events：JobQueue 结构化日志落盘与脱敏离线回归（无 Kaggle / 无 GPU / 无外网）')
  workspace = await mkdtemp(join(tmpdir(), 'imagen-host-log-events-'))
  const ctx = makeCtx()
  fileLog = installFileLog(ctx, { level: 'debug' })

  const promptSentinel = `SENTINEL_PROMPT_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const negativeSentinel = `SENTINEL_NEG_${Math.random().toString(36).slice(2)}`
  const overlongSentinel = `SENTINEL_OVERLONG_${Math.random().toString(36).slice(2)}`
  const overlongPrompt = `${overlongSentinel}${'x'.repeat(LIMITS.prompt.maxChars)}`

  const session = makeStoppedSession()
  const queue = new JobQueue({
    ctx,
    session,
    defaultPreset: PRESET,
    options: { generateTimeoutMs: 1000 },
  })

  let submitted = null
  await check('会话被手动关闭：任务以 stopped 失败且不自动启动 Kernel', async () => {
    submitted = queue.submit({
      prompt: promptSentinel,
      negativePrompt: negativeSentinel,
      size: 512,
      count: 2,
    })
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    const job = await queue.waitFor(submitted.job.id, 5)
    assert.equal(job?.status, 'failed', JSON.stringify(job))
    assert.equal(job?.error?.code, 'stopped', JSON.stringify(job?.error))
    assert.equal(session.calls.start, 0, '手动关机后不应自动启动 Kernel')
    assert.equal(session.calls.ensureReady, 0, '手动关机后不应等待会话就绪')
  })

  await check('非法 prompt 被拒绝（enqueue_rejected）', async () => {
    const empty = queue.submit({ prompt: '   ' })
    assert.equal(empty.ok, false)
    assert.equal(empty.code, 'invalid_prompt')

    const tooLong = queue.submit({ prompt: overlongPrompt })
    assert.equal(tooLong.ok, false)
    assert.equal(tooLong.code, 'invalid_prompt')
  })

  queue.dispose()
  await flushHostLog()

  const filePath = hostLogPath(ctx)
  const lines = await readHostLogTail(ctx, 400)
  const fileText = filePath ? await readFile(filePath, 'utf8') : ''

  await check('Host 日志落盘到 <workspace>/.imagen/logs/host.log', async () => {
    assert.ok(filePath, 'hostLogPath 应有工作区上下文')
    assert.ok(filePath.endsWith(join('.imagen', 'logs', 'host.log')), filePath)
    assert.ok(lines.length > 0, 'readHostLogTail 不应为空')
    assert.ok(fileText.length > 0, 'host.log 不应为空')
  })

  await check('enqueue 事件带 promptLen / presetId / 尺寸 / pending，且不带正文', async () => {
    const jobId = submitted.job.id
    const line = lines.find((row) => row.includes(`enqueue jobId=${jobId}`))
    assert.ok(line, `未找到 enqueue 事件（jobId=${jobId}）`)
    assert.ok(line.includes('[jobs]'), `事件缺少 jobs scope：${line}`)
    assert.ok(line.includes(`promptLen=${promptSentinel.length}`), line)
    assert.ok(line.includes(`presetId=${PRESET}`), line)
    assert.match(line, /size=\d+x\d+/)
    assert.match(line, /pending=\d+/)
    assert.ok(!line.includes(promptSentinel), line)
  })

  await check('会话等待事件（wait_session_start / wait_session_done）', async () => {
    const jobId = submitted.job.id
    const start = lines.find((row) => row.includes(`wait_session_start jobId=${jobId}`))
    assert.ok(start, '缺少 wait_session_start 事件')
    assert.ok(start.includes(`promptLen=${promptSentinel.length}`), start)

    const done = lines.find((row) => row.includes(`wait_session_done jobId=${jobId}`))
    assert.ok(done, '缺少 wait_session_done 事件')
    assert.match(done, /elapsedMs=\d+/)
    assert.ok(done.includes('code=stopped'), done)
  })

  await check('canceled_by_stop 与 job_failed 事件都带 jobId / promptLen / code', async () => {
    const jobId = submitted.job.id
    const canceled = lines.find((row) => row.includes(`canceled_by_stop jobId=${jobId}`))
    assert.ok(canceled, '缺少 canceled_by_stop 事件')
    assert.ok(canceled.includes(`promptLen=${promptSentinel.length}`), canceled)

    const failed = lines.find((row) => row.includes(`job_failed jobId=${jobId}`))
    assert.ok(failed, '缺少 job_failed 事件')
    assert.ok(failed.includes('code=stopped'), failed)
    assert.ok(failed.includes(`promptLen=${promptSentinel.length}`), failed)
    assert.match(failed, /message=/)
  })

  await check('enqueue_rejected 事件记录 code / promptLen', async () => {
    assert.ok(
      lines.some((row) => row.includes('enqueue_rejected code=invalid_prompt promptLen=0')),
      '缺少空 prompt 的 enqueue_rejected',
    )
    assert.ok(
      lines.some((row) =>
        row.includes(`enqueue_rejected code=invalid_prompt promptLen=${overlongPrompt.length}`),
      ),
      '缺少超长 prompt 的 enqueue_rejected',
    )
  })

  await check('dispose 事件记录队列收尾状态', async () => {
    assert.ok(
      lines.some((row) => row.includes('dispose pending=')),
      '缺少 dispose 事件',
    )
  })

  await check('脱敏：prompt / negativePrompt 正文与超长 prompt 都不出现在日志文件里', async () => {
    for (const sentinel of [promptSentinel, negativeSentinel, overlongSentinel]) {
      assert.ok(!fileText.includes(sentinel), `日志文件泄露了提示词哨兵：${sentinel}`)
      assert.ok(!lines.some((row) => row.includes(sentinel)), `readHostLogTail 泄露了提示词哨兵：${sentinel}`)
    }
    // 只允许出现长度字段，不允许出现 prompt= 正文形式。
    assert.ok(!/prompt=/.test(fileText), '日志里不应出现 prompt= 正文')
    assert.ok(!/negativePrompt=/.test(fileText), '日志里不应出现 negativePrompt= 正文')
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
  await fileLog?.dispose?.().catch(() => {})
  if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => {})
}
