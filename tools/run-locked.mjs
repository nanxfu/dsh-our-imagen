/**
 * 带构建锁的命令包装器（多 agent 并行开发用）。
 *
 * 背景：build.mjs 固定写 `client.js` / `test/.build/client.test.js`，多个进程同时构建会
 * 互相覆盖产物，导致测试读到半截文件或测到别人未完成源码。这里用一个目录锁串行化
 * 「构建 + 客户端测试」这类命令；锁按需要自动重试，进程退出后释放。
 *
 * 用法：
 *   node tools/run-locked.mjs -- node test/check-client-render.mjs
 *   node tools/run-locked.mjs -- npm test
 *
 * 实现：`.tmp/locks/build.lock` 目录原子创建；超过 10 分钟视为陈旧锁（前一进程被杀）并强制回收。
 */

import { spawn } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOCK_DIR = join(ROOT, '.tmp', 'locks', 'build.lock')
const STALE_MS = 10 * 60 * 1000
const WAIT_MS = 15 * 60 * 1000
const RETRY_MS = 500

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function acquire() {
  const startedAt = Date.now()
  // 锁目录本身必须用非递归 mkdir 保证原子性，但父目录可能还不存在（新克隆 / 首次运行），
  // 先把父目录建出来，否则 ENOENT 会被误判成普通错误直接退出。
  await mkdir(dirname(LOCK_DIR), { recursive: true })
  for (;;) {
    try {
      await mkdir(LOCK_DIR, { recursive: false })
      return true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      // 陈旧锁回收：持有者异常退出时目录会留下，超过阈值直接清掉。
      try {
        const info = await stat(LOCK_DIR)
        if (Date.now() - info.mtimeMs > STALE_MS) {
          await rm(LOCK_DIR, { recursive: true, force: true })
          continue
        }
      } catch {
        // 锁刚被释放，下一轮重试。
      }
      if (Date.now() - startedAt > WAIT_MS) {
        console.error(`[run-locked] 等待构建锁超时（${WAIT_MS}ms）：${LOCK_DIR}`)
        return false
      }
      await sleep(RETRY_MS)
    }
  }
}

const separator = process.argv.indexOf('--')
if (separator === -1 || separator === process.argv.length - 1) {
  console.error('用法：node tools/run-locked.mjs -- <command> [args...]')
  process.exit(2)
}
const argv = process.argv.slice(separator + 1)
const command = argv[0]
const commandArgs = argv.slice(1)

const acquired = await acquire()
if (!acquired) process.exit(1)
const release = async () => {
  await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => {})
}
process.on('SIGINT', () => {
  release().finally(() => process.exit(130))
})
process.on('SIGTERM', () => {
  release().finally(() => process.exit(143))
})

const child = spawn(command, commandArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})

child.on('error', (error) => {
  console.error(`[run-locked] 启动命令失败：${error?.message ?? error}`)
  release().then(() => process.exit(1))
})
child.on('exit', (code, signal) => {
  release().then(() => {
    if (signal) process.exit(1)
    process.exit(code ?? 0)
  })
})
