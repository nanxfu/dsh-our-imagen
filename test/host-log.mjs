/**
 * Host 本地滚动日志（lib/log.js）回归测试。
 *
 * 不联网、不起端口；每个用例使用独立临时工作区（mkdtemp），避免与并行任务抢目录。
 * 覆盖：落盘格式与级别、轮转与体积上限、统一脱敏、tail 读取、无工作区退化、IO 失败降级、
 * 重复安装替换、控制台行为回归。
 *
 * 运行：node test/host-log.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createLogger,
  flushHostLog,
  hostLogPath,
  installFileLog,
  readHostLogTail,
  redactLogText,
} from '../lib/log.js'

const tempDirs = []

// 模块级 logger：在 installFileLog 之前创建，验证「早于安装也能落盘」。
const earlyLog = createLogger({ scope: 'host-log-test' })

async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'imagen-host-log-test-'))
  tempDirs.push(dir)
  return dir
}

function workspaceContext(workspace) {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      return undefined
    },
  }
}

function hostLogFile(workspace) {
  return join(workspace, '.imagen', 'logs', 'host.log')
}

async function readTextFile(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function splitLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
}

function seqOf(lines) {
  return lines.map((line) => {
    const match = /seq=(\d+)/.exec(line)
    return match ? Number(match[1]) : NaN
  })
}

/** 安装文件日志并在结束时释放；释放前尽力 flush。 */
async function withFileLog(ctx, options, fn) {
  const handle = installFileLog(ctx, options)
  try {
    return await fn(handle)
  } finally {
    await handle.dispose().catch(() => {})
  }
}

// ---- 测试驱动 -----------------------------------------------------------

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
  }
}

async function main() {
  // ================= 控制台行为回归 =================

  await check('createLogger 保持原有控制台行为：注入 sink 时按级别前缀输出', () => {
    const memory = []
    const sink = {
      debug: (...args) => memory.push(['debug', ...args]),
      info: (...args) => memory.push(['info', ...args]),
      warn: (...args) => memory.push(['warn', ...args]),
      error: (...args) => memory.push(['error', ...args]),
    }
    const logger = createLogger({ scope: 'memory', sink })
    logger.debug('d')
    logger.info('hello', 1)
    assert.deepEqual(memory[0], ['debug', '[imagen:memory]', 'd'])
    assert.deepEqual(memory[1], ['info', '[imagen:memory]', 'hello', 1])

    const quiet = createLogger({ scope: 'memory', level: 'warn', sink })
    memory.length = 0
    quiet.info('dropped')
    quiet.warn('kept')
    assert.deepEqual(memory.map((item) => item[0]), ['warn'], `level=warn 只应输出 warn：${JSON.stringify(memory)}`)
  })

  // ================= 落盘与格式 =================

  await check('落盘：模块级 logger 早于安装也写入 host.log，格式含 ISO 时间戳/级别/scope', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)

    await withFileLog(ctx, undefined, async () => {
      earlyLog.debug('debug-哨兵-不应落盘')
      earlyLog.info('info 正常日志', 42)
      earlyLog.warn({ event: 'warn-event', count: 3 })
      earlyLog.error(new Error('boom'))
      earlyLog.info('多行第一段\n多行第二段')
      await flushHostLog()

      const filePath = hostLogPath(ctx)
      assert.equal(filePath, hostLogFile(workspace), 'hostLogPath 应为 <workspace>/.imagen/logs/host.log')
      const text = await readTextFile(filePath)
      assert.ok(text, 'host.log 应已创建')
      const lines = splitLines(text)

      const pattern = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[(debug|info|warn|error)\] \[host-log-test\] /
      assert.ok(lines.every((line) => pattern.test(line)), `每行应含时间戳/级别/scope：\n${lines.join('\n')}`)
      assert.equal(lines.filter((line) => line.includes('debug-哨兵')).length, 0, 'debug 默认不应落盘')
      assert.ok(text.includes('[info] [host-log-test] info 正常日志 42'))
      assert.ok(text.includes('"event":"warn-event"'), '对象参数应序列化后落盘')
      assert.ok(text.includes('Error: boom'), 'Error 参数应记录名称与消息')
      assert.ok(text.includes('[info] [host-log-test] 多行第一段'), '多行消息应带前缀')
      assert.ok(text.includes('[info] [host-log-test] 多行第二段'), '多行消息的第二行也应带前缀')

      // POSIX 下校验目录 0700 / 文件 0600（Windows 忽略 mode 差异）。
      if (process.platform !== 'win32') {
        const dirMode = (await stat(join(workspace, '.imagen', 'logs'))).mode & 0o777
        const fileMode = (await stat(filePath)).mode & 0o777
        assert.equal(dirMode, 0o700, `日志目录权限应为 0700，实际 ${dirMode.toString(8)}`)
        assert.equal(fileMode, 0o600, `日志文件权限应为 0600，实际 ${fileMode.toString(8)}`)
      }
    })
  })

  await check('级别可调：level=debug 时 debug 落盘，level=off 时完全不写盘', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    await withFileLog(ctx, { level: 'debug' }, async () => {
      earlyLog.debug('debug-visible-哨兵')
      await flushHostLog()
      assert.ok((await readFile(hostLogFile(workspace), 'utf8')).includes('debug-visible-哨兵'))
    })

    const offWorkspace = await makeWorkspace()
    const offCtx = workspaceContext(offWorkspace)
    await withFileLog(offCtx, { level: 'off' }, async () => {
      earlyLog.info('off-哨兵')
      await flushHostLog()
      assert.equal(await readTextFile(hostLogFile(offWorkspace)), null, 'level=off 时不应创建日志文件')
    })
  })

  // ================= 轮转与体积上限 =================

  await check('轮转：单文件超过 maxBytes 只保留 1 个归档，总大小有界', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const maxBytes = 2048

    await withFileLog(ctx, { maxBytes, maxFiles: 1 }, async () => {
      for (let index = 0; index < 60; index += 1) {
        earlyLog.info(`seq=${String(index).padStart(4, '0')} ${'x'.repeat(90)}`)
      }
      await flushHostLog()

      const logsDir = join(workspace, '.imagen', 'logs')
      const entries = (await readdir(logsDir)).sort()
      assert.deepEqual(entries, ['host.log', 'host.log.1'], `应只保留 host.log 与 host.log.1：${entries.join(', ')}`)

      const current = await readFile(hostLogFile(workspace), 'utf8')
      const archive = await readFile(`${hostLogFile(workspace)}.1`, 'utf8')
      const currentSize = Buffer.byteLength(current)
      const archiveSize = Buffer.byteLength(archive)
      assert.ok(currentSize > 0 && currentSize <= maxBytes, `当前文件大小应在 (0, ${maxBytes}]：${currentSize}`)
      assert.ok(archiveSize > 0 && archiveSize <= maxBytes, `归档文件大小应在 (0, ${maxBytes}]：${archiveSize}`)
      assert.ok(currentSize + archiveSize <= maxBytes * 2, '总占用应有界')

      const archiveSeqs = seqOf(splitLines(archive)).filter(Number.isFinite)
      const currentSeqs = seqOf(splitLines(current)).filter(Number.isFinite)
      assert.ok(archiveSeqs.length > 0 && currentSeqs.length > 0)
      assert.ok(Math.max(...archiveSeqs) < Math.min(...currentSeqs), '归档应只含更早的日志行')
      assert.ok(Math.max(...currentSeqs) === 59, '当前文件应包含最新一行')
    })
  })

  // ================= 脱敏 =================

  await check('redactLogText：Bearer/密钥前缀/键值/URL query/prompt 对象全部掩码', () => {
    assert.equal(redactLogText('Bearer abc.def-123'), 'Bearer [REDACTED]')
    assert.equal(redactLogText('token=abc123'), 'token=[REDACTED]')
    assert.equal(redactLogText('https://example.com/cb?token=abc123&x=1'), 'https://example.com/cb?token=[REDACTED]&x=1')
    assert.equal(redactLogText('hf_ABCDEFGHIJKL'), '[REDACTED]')
    assert.equal(redactLogText('KGAT_ABCDEFGHIJKL'), '[REDACTED]')
    assert.equal(redactLogText('{"prompt":"abcd","negativePrompt":"abcdef"}'), '{"promptLen":4,"negativePromptLen":6}')
    assert.equal(redactLogText('普通正常日志 jobId=j_123'), '普通正常日志 jobId=j_123', '正常内容不应被改写')
    const sample = 'Authorization: Bearer abc token=xyz hf_ABCDEFGHIJ'
    assert.equal(redactLogText(redactLogText(sample)), redactLogText(sample), '脱敏应幂等')
    assert.equal(redactLogText(null), '')
    assert.equal(redactLogText(undefined), '')
  })

  await check('落盘脱敏：Token/HF Token/Kaggle token/URL token 与提示词正文不进文件', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const prompt = 'SECRET_PROMPT_TEXT_正文'
    const negative = 'SECRET_NEGATIVE_PROMPT'
    const sentinels = [
      'SECRET_BEARER_TOKEN',
      'SECRET_HF_TOKEN',
      'SECRET_KAGGLE_TOKEN',
      'SECRET_GITHUB_TOKEN',
      'SECRET_OPENAI_KEY',
      'SECRET_QUERY_TOKEN',
      'SECRET_KV_TOKEN',
      'SECRET_PASSWORD',
      'SECRET_SECRET',
      'SECRET_API_KEY',
      prompt,
      negative,
      '正文',
    ]

    await withFileLog(ctx, undefined, async () => {
      earlyLog.info('Authorization: Bearer SECRET_BEARER_TOKEN')
      earlyLog.info('hf token', 'hf_SECRET_HF_TOKEN_abcdef')
      earlyLog.info('kaggle token', 'KGAT_SECRET_KAGGLE_TOKEN_123456')
      earlyLog.info('github token', 'ghp_SECRET_GITHUB_TOKEN_123456')
      earlyLog.info('openai key', 'sk-SECRET_OPENAI_KEY_123456')
      earlyLog.info('callback url', 'https://example.com/cb?token=SECRET_QUERY_TOKEN&x=1')
      earlyLog.info('kv', 'token=SECRET_KV_TOKEN password=SECRET_PASSWORD secret=SECRET_SECRET apikey=SECRET_API_KEY')
      earlyLog.info('params', { prompt, negativePrompt: negative, steps: 4 })
      await flushHostLog()

      const text = (await readTextFile(hostLogFile(workspace))) ?? ''
      assert.ok(text.length > 0, '日志应已落盘')
      for (const sentinel of sentinels) {
        assert.ok(!text.includes(sentinel), `敏感串不应落盘：${sentinel}`)
      }
      assert.ok(text.includes('[REDACTED]'), '应出现掩码占位符')
      assert.ok(text.includes(`"promptLen":${prompt.length}`), `应记录 prompt 长度：${prompt.length}`)
      assert.ok(text.includes(`"negativePromptLen":${negative.length}`), `应记录 negativePrompt 长度：${negative.length}`)
    })
  })

  // ================= tail 读取 =================

  await check('readHostLogTail：返回最近 N 行、顺序为新在后、跨归档读取', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const maxBytes = 2048

    await withFileLog(ctx, { maxBytes, maxFiles: 1 }, async () => {
      for (let index = 0; index < 40; index += 1) {
        earlyLog.info(`seq=${String(index).padStart(4, '0')} ${'y'.repeat(90)}`)
      }
      await flushHostLog()

      const logsDir = join(workspace, '.imagen', 'logs')
      const currentLines = splitLines(await readFile(hostLogFile(workspace), 'utf8'))
      const archiveLines = splitLines(await readTextFile(`${hostLogFile(workspace)}.1`))
      assert.ok(archiveLines.length > 0, '小 maxBytes 下应产生归档')

      const everything = await readHostLogTail(ctx, 5000)
      assert.deepEqual(everything, archiveLines.concat(currentLines), 'tail 应拼接归档与当前文件（旧在前）')

      const tail = await readHostLogTail(ctx, 5)
      assert.equal(tail.length, 5)
      assert.deepEqual(tail, everything.slice(-5), '返回最近 5 行')
      const seqs = seqOf(tail)
      for (let index = 1; index < seqs.length; index += 1) {
        assert.ok(seqs[index] > seqs[index - 1], `tail 顺序应为旧→新：${seqs.join(',')}`)
      }
      assert.equal(seqs.at(-1), 39, '最后一行应是最新写入的日志')

      // 新日志无需手动 flush：readHostLogTail 内部会等待队列清空。
      earlyLog.info('seq=9999 fresh-line-哨兵')
      const fresh = await readHostLogTail(ctx, 2)
      assert.ok(fresh.some((line) => line.includes('fresh-line-哨兵')), '应读到刚写入且尚未 flush 的日志')
    })
  })

  await check('readHostLogTail：无文件/无工作区时返回空数组且不抛异常', async () => {
    const emptyWorkspace = await makeWorkspace()
    assert.deepEqual(await readHostLogTail(workspaceContext(emptyWorkspace)), [])

    const noWorkspaceCtx = {
      get() {
        return undefined
      },
    }
    assert.deepEqual(await readHostLogTail(noWorkspaceCtx), [])
    assert.deepEqual(await readHostLogTail({}), [])
    assert.deepEqual(await readHostLogTail(undefined), [])
  })

  // ================= 无工作区退化 =================

  await check('无工作区：安全退化不写盘，且不回退 process.cwd()', async () => {
    const cwdProbe = await makeWorkspace()
    const previousCwd = process.cwd()
    process.chdir(cwdProbe)
    try {
      const noWorkspaceCtx = {
        get() {
          return undefined
        },
      }
      assert.equal(hostLogPath(noWorkspaceCtx), null)
      await withFileLog(noWorkspaceCtx, undefined, async () => {
        earlyLog.info('nowhere-to-write-哨兵')
        await flushHostLog()
        await flushHostLog()
        assert.deepEqual(await readdir(cwdProbe), [], '不应回退 process.cwd() 写盘')
      })
    } finally {
      process.chdir(previousCwd)
    }

    // ctx 取服务直接抛错时也不能影响调用方。
    const throwingCtx = {
      get() {
        throw new Error('service unavailable')
      },
    }
    assert.equal(hostLogPath(throwingCtx), null)
    await withFileLog(throwingCtx, undefined, async () => {
      earlyLog.info('throwing-ctx-哨兵')
      await flushHostLog()
    })
  })

  // ================= IO 失败降级 =================

  await check('IO 失败：写入与 flush 静默降级，控制台/内存 sink 不受影响', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    // 用普通文件占住 .imagen，后续 mkdir .imagen/logs 必然失败。
    await writeFile(join(workspace, '.imagen'), 'not a directory', 'utf8')

    const memory = []
    const sink = {
      debug: (...args) => memory.push(['debug', ...args]),
      info: (...args) => memory.push(['info', ...args]),
      warn: (...args) => memory.push(['warn', ...args]),
      error: (...args) => memory.push(['error', ...args]),
    }
    const logger = createLogger({ scope: 'io-failure', sink })

    const handle = installFileLog(ctx)
    try {
      assert.doesNotThrow(() => logger.info('io-fail-哨兵'))
      assert.doesNotThrow(() => logger.warn('io-fail-哨兵-2'))
      await flushHostLog()
      assert.deepEqual(memory.map((item) => item[0]), ['info', 'warn'], '内存 sink 不应受文件 IO 失败影响')
      assert.ok(memory[0].includes('[imagen:io-failure]'))
      assert.equal(await readTextFile(hostLogFile(workspace)), null, 'IO 失败时不应产生日志文件')
    } finally {
      await handle.dispose().catch(() => {})
    }
    // 故障后再次写入也不应抛异常。
    assert.doesNotThrow(() => logger.error('after-dispose-哨兵'))
    await flushHostLog()
  })

  // ================= 重复安装 =================

  await check('重复 installFileLog：新目标生效，旧目标不再接收日志', async () => {
    const workspaceA = await makeWorkspace()
    const workspaceB = await makeWorkspace()
    const ctxA = workspaceContext(workspaceA)
    const ctxB = workspaceContext(workspaceB)

    const handleA = installFileLog(ctxA)
    try {
      earlyLog.info('to-a-only-哨兵')
      await flushHostLog()
    } finally {
      await handleA.flush()
    }

    await withFileLog(ctxB, undefined, async () => {
      earlyLog.info('to-b-only-哨兵')
      await flushHostLog()
    })

    const textA = (await readTextFile(hostLogFile(workspaceA))) ?? ''
    const textB = (await readTextFile(hostLogFile(workspaceB))) ?? ''
    assert.ok(textA.includes('to-a-only-哨兵'), '旧目标应保留安装期间写入的内容')
    assert.ok(!textA.includes('to-b-only-哨兵'), '旧目标不应再接收新日志')
    assert.ok(textB.includes('to-b-only-哨兵'), '新目标应接收切换后的日志')
    assert.ok(!textB.includes('to-a-only-哨兵'), '新目标不应出现切换前的内容')
    await handleA.dispose()
  })
}

try {
  await main()
} finally {
  await flushHostLog()
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}
