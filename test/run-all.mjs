#!/usr/bin/env node
/**
 * 统一测试入口：按分组顺序执行全部离线回归。
 *
 * 用法：
 *   node test/run-all.mjs                  # 等价 --group all
 *   node test/run-all.mjs --group client   # 只跑客户端组
 *   node test/run-all.mjs --list           # 只打印将要执行的命令
 *
 * 约定：
 *  - 顺序执行（child_process.spawn + stdio inherit），不并行，避免临时目录 / 端口互相干扰；
 *  - 任一步失败不中断，跑完整组后以非零退出码收尾，并列出失败的步骤；
 *  - client 组的 check-client-*.mjs 自动发现，新增拆分文件无需改本文件。
 */

import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(TEST_DIR)

const NODE = 'node'
const PYTHON = 'python'

/** 固定条目：按既有 package.json 清单的顺序排列，保证行为不变。 */
const hostGroup = [
  'agent-batch.mjs',
  'net-fallback.mjs',
  'host-e2e.mjs',
  'import-host.mjs',
  'settings-host.mjs',
  'ui-state-host.mjs',
  'kaggle-direct.mjs',
  'kaggle-oauth.mjs',
  'colab-oauth.mjs',
  'host-log.mjs',
  'host-log-events.mjs',
  { command: PYTHON, args: ['test/remote/run.py'], name: 'test/remote/run.py' },
  'kernel-package.mjs',
  'check-verify-model.mjs',
  'session-pure.mjs',
  'library-atomic.mjs',
  'jobs-wait.mjs',
  'session-reliability.mjs',
  'session-pending-cleanup.mjs',
  'session-race.mjs',
  'session-restore.mjs',
  'update-check.mjs',
]

const contractGroup = ['check-contract.mjs', 'agent-batch.mjs']

/** client 组里非 check-client-* 的固定条目（顺序与旧 test:client 一致）。 */
const clientTail = ['image-tool.mjs', 'image-tool-render.mjs', 'outpaint.mjs', 'chat-timeline.mjs', 'import-client.mjs', 'render-harness.mjs', 'lineage.mjs', 'logs-diagnostics.mjs']

/**
 * 自动发现 client 组的 check-client-*.mjs（含已拆分的 shell / chat / tools / kaggle）。
 */
function discoverClientChecks() {
  return readdirSync(TEST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^check-client-.*\.mjs$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

function toStep(entry) {
  if (typeof entry === 'string') {
    return { name: `test/${entry}`, command: NODE, args: [join('test', entry)] }
  }
  return entry
}

function buildGroups() {
  return {
    contract: contractGroup.map(toStep),
    client: [...discoverClientChecks(), ...clientTail].map(toStep),
    host: hostGroup.map(toStep),
  }
}

function parseArgs(argv) {
  const options = { group: 'all', list: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') {
      options.list = true
      continue
    }
    if (arg === '--group') {
      const value = argv[index + 1]
      if (!value) throw new Error('--group 需要一个值：all | contract | client | host')
      options.group = value
      index += 1
      continue
    }
    if (arg.startsWith('--group=')) {
      options.group = arg.slice('--group='.length)
      continue
    }
    throw new Error(`未知参数：${arg}`)
  }
  if (!['all', 'contract', 'client', 'host'].includes(options.group)) {
    throw new Error(`--group 只支持 all | contract | client | host，收到：${options.group}`)
  }
  return options
}

function runStep(step) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, { cwd: ROOT, stdio: 'inherit', shell: false })
    child.once('error', (error) => resolve({ ok: false, error }))
    child.once('close', (code, signal) => {
      resolve({ ok: code === 0, code, signal })
    })
  })
}

function describe(step) {
  return `${step.command} ${step.args.join(' ')}`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const groups = buildGroups()
  const selected = options.group === 'all' ? ['contract', 'client', 'host'] : [options.group]

  // `agent-batch.mjs` 同时属于 contract 与 host 组：分组单跑时各跑一次，
  // `all` 里只保留第一次，避免同一条命令重复执行。
  const steps = []
  const seen = new Set()
  for (const name of selected) {
    for (const step of groups[name]) {
      const key = describe(step)
      if (selected.length > 1 && seen.has(key)) continue
      seen.add(key)
      steps.push({ group: name, ...step })
    }
  }

  if (options.list) {
    for (const step of steps) console.log(`[${step.group}] ${describe(step)}`)
    console.log(`\n共 ${steps.length} 条命令，分组：${selected.join(', ')}`)
    return
  }

  const failures = []
  let currentGroup = null
  for (const [index, step] of steps.entries()) {
    if (step.group !== currentGroup) {
      currentGroup = step.group
      console.log(`\n════════ ${currentGroup} (${steps.filter((item) => item.group === currentGroup).length} 步) ════════\n`)
    }
    console.log(`\n──── [${index + 1}/${steps.length}] ${describe(step)}\n`)
    const result = await runStep(step)
    if (!result.ok) {
      const reason = result.error ? result.error.message : result.signal ? `signal ${result.signal}` : `exit ${result.code}`
      failures.push({ step, reason })
      console.log(`\n✗ 失败（${reason}）：${describe(step)}`)
    }
  }

  console.log('')
  if (failures.length > 0) {
    console.log(`失败 ${failures.length}/${steps.length} 步：`)
    for (const { step, reason } of failures) console.log(`  - [${step.group}] ${describe(step)}（${reason}）`)
    process.exitCode = 1
    return
  }
  console.log(`全部通过：${steps.length}/${steps.length} 步`)
}

main().catch((error) => {
  console.error(error?.message ?? error)
  process.exitCode = 1
})
