#!/usr/bin/env node
/**
 * 真机 Kaggle OAuth 闭环验收脚本（v0.9 M2 试验特性）。
 *
 * 用与工作台「在浏览器中登录 Kaggle」完全相同的代码路径（lib/kaggle-oauth.js）完成一次真实
 * OAuth 2.0 + PKCE 授权：打开本机浏览器 → 本地回环回调收码 → 换取令牌 → 写入
 * `~/.kaggle/credentials.json`（与 `kaggle auth login` 同格式）→ 再用直连客户端
 * （lib/kaggle-direct.js）查一次真实配额，确认凭据可用。只读配额，不触发 GPU。
 *
 *   node tools/kaggle-login.mjs                 # 浏览器模式（推荐）
 *   node tools/kaggle-login.mjs --manual        # 无头环境：打印授权链接，粘贴授权码
 *   node tools/kaggle-login.mjs --manual --code <授权码>
 *   node tools/kaggle-login.mjs --force         # 已有 credentials.json 也重新登录（默认就会备份旧文件）
 *
 * 安全：不打印 token / refresh_token / 授权码；旧凭据会先备份为 `credentials.json.bak-<时间戳>`。
 * 退出码：0 成功；1 登录或探测失败；2 需要人工提供授权码（无 TTY 且未给 --code）。
 */

import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { kagglePaths, probeKaggle } from '../lib/kaggle-direct.js'
import { createKaggleLogin } from '../lib/kaggle-oauth.js'
import { KAGGLE_LOGIN } from '../shared/contract.js'

const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(name)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}

const manual = hasFlag('--manual')
const codeFromArgs = argValue('--code')
const interactive = Boolean(process.stdin.isTTY)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 只把关键事件打到控制台；登录管理器内部日志保持安静（token 永不经过这里）。 */
const consoleLog = {
  debug() {},
  info() {},
  warn: (message) => console.log(`[警告] ${message}`),
  error: (message) => console.log(`[错误] ${message}`),
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 备份旧凭据：覆盖前先留一份，失败不阻塞登录（只是少一次回退机会）。 */
async function backupCredentials(path) {
  if (!(await exists(path))) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${path}.bak-${stamp}`
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await copyFile(path, backup)
    return backup
  } catch (error) {
    console.log(`[警告] 备份旧凭据失败（继续登录）：${error?.message ?? error}`)
    return null
  }
}

async function askAuthorizationCode() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question('把浏览器页面上的授权码粘贴到这里后回车：')
    return answer.trim()
  } finally {
    rl.close()
  }
}

async function waitForTerminalState(login) {
  const deadline = Date.now() + KAGGLE_LOGIN.timeoutMs + 15000
  let last = null
  while (Date.now() < deadline) {
    last = login.view()
    if (last.state === 'done' || last.state === 'failed' || last.state === 'cancelled') return last
    await sleep(500)
  }
  return last
}

async function main() {
  const paths = kagglePaths({ homeDir: homedir(), env: process.env })
  console.log('Kaggle OAuth 登录验收（与工作台「在浏览器中登录 Kaggle」同一代码路径）')
  console.log(`凭据文件：${paths.credentials}`)
  const backup = await backupCredentials(paths.credentials)
  if (backup) console.log(`已备份旧凭据：${backup}`)

  const login = createKaggleLogin({
    ctx: {},
    log: consoleLog,
    homeDir: homedir(),
    env: process.env,
    platform: process.platform,
  })

  let started
  try {
    started = await login.start(manual ? { mode: 'manual' } : undefined)
  } catch (error) {
    console.log(`[错误] 无法发起登录：${error?.message ?? error}`)
    process.exit(1)
  }

  console.log(`登录状态：${started.state}（模式：${started.mode}）`)
  if (started.mode === 'browser' && started.state === 'pending') {
    console.log('已在默认浏览器中打开 Kaggle 授权页面；请在浏览器里完成登录并点「允许」。')
  }

  // manual 兜底（或浏览器打不开时的自动降级）：把链接交给用户，收授权码。
  const initial = login.view()
  if (initial.mode === 'manual' && initial.url) {
    console.log('\n请在浏览器中打开下面的链接并完成授权（不要分享给他人）：\n')
    console.log(`  ${initial.url}\n`)
    let code = codeFromArgs
    if (!code && interactive) code = await askAuthorizationCode()
    if (!code) {
      console.log('当前不是交互终端：请用 `node tools/kaggle-login.mjs --manual --code <授权码>` 重试。')
      process.exit(2)
    }
    const submitted = await login.submitCode(code)
    console.log(`提交授权码：${submitted.state}`)
  } else if (codeFromArgs) {
    const submitted = await login.submitCode(codeFromArgs)
    console.log(`提交授权码：${submitted.state}`)
  }

  const final = await waitForTerminalState(login)
  if (!final || final.state !== 'done') {
    console.log(`\n[失败] 登录未完成：state=${final?.state ?? 'unknown'} ${final?.message ?? ''}`)
    await login.dispose()
    process.exit(1)
  }

  console.log(`\n登录成功：${final.username ?? '(用户名未知)'}`)
  console.log(`凭据已写入：${paths.credentials}`)

  // 直连客户端真实探测：验证**刚写入的 OAuth 凭据**可用（只查配额，不触发 GPU）。
  // 注意不能直接在 ~/.kaggle 上探测：那里可能还有旧的 access_token 文件，会掩盖 OAuth 凭据的问题。
  // 这里把新凭据复制到临时 home 再探测，保证验证的是本次登录产物。
  console.log('\n用新写入的 OAuth 凭据做直连探测（auth + 配额，不消耗 GPU）…')
  const tempHome = await mkdtemp(join(tmpdir(), 'imagen-oauth-verify-'))
  let probe
  try {
    const tempKaggle = join(tempHome, '.kaggle')
    await mkdir(tempKaggle, { recursive: true, mode: 0o700 })
    await copyFile(paths.credentials, join(tempKaggle, 'credentials.json'))
    probe = await probeKaggle({}, { homeDir: tempHome, env: {} })
  } finally {
    await rm(tempHome, { recursive: true, force: true }).catch(() => {})
  }
  const ok = probe?.auth?.ok === true
  const quota = probe?.quota ?? {}
  if (ok) {
    console.log(`  账号：${probe.cli?.username ?? final.username ?? 'unknown'}（鉴权正常）`)
    if (quota.available) {
      console.log(`  配额：已用 ${quota.usedHours}h / 剩余 ${quota.remainingHours}h / 每周 ${quota.totalHours}h`)
      if (quota.refreshAt) console.log(`  下次重置：${quota.refreshAt}`)
    } else {
      console.log('  配额：接口暂不可用（不影响出图）')
    }
  } else {
    console.log(`  账号探测失败：${probe?.auth?.errorCode ?? 'unknown'} ${probe?.auth?.detail ?? ''}`)
    for (const note of probe?.notes ?? []) console.log(`  - ${note}`)
  }
  await login.dispose()
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})


