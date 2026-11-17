#!/usr/bin/env node
/**
 * M0 试验 1：OAuth 与控制面闭环。
 *
 * 验证四件事（对应 docs/COLAB_BACKEND_RESEARCH.md §5 试验 1）：
 *   1. Google 官方 colab-cli 的 client_id 在本机能否走 localhost 回调（不行就退回粘贴码）；
 *   2. `GET /tun/m/ccu-info` 的真实返回结构（余额 / 每小时消耗 / 活跃实例数）；
 *   3. `assign(accelerator=L4)` 的真实返回（endpoint、runtimeProxyInfo、令牌有效期）；
 *   4. `unassign` 能否把实例真正关掉，不留空烧 CCU 的孤儿。
 *
 * 用法：
 *   node tools/colab/probe-auth.mjs                      # 本地回环（默认端口 8765），浏览器回调自动收码
 *   node tools/colab/probe-auth.mjs --print-only         # 只打印链接；页面打不开时把地址栏 URL 贴回来
 *   node tools/colab/probe-auth.mjs --code <授权码或回调URL>  # 用授权码换令牌并落盘
 *   node tools/colab/probe-auth.mjs --status             # 查账号、CCU 余额与活跃实例
 *
 * 关于远端粘贴码流程（--mode remote）：2026-11 实测该 client_id 已被 Google 拒绝
 * `sdk.cloud.google.com/applicationdefaultauthcode.html`，返回 `redirect_uri_mismatch`；
 * 同一 client_id 的 `http://localhost:<port>` 仍然有效。因此默认走回环，remote 仅留作对照。
 *
 * 退出码：0 成功；1 失败；2 等待人工授权码。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

import {
  ACCELERATORS,
  OAUTH,
  WORK_ROOT,
  accessToken,
  accountFromIdToken,
  buildAuthUrl,
  ccuInfo,
  credentialsPath,
  exchangeCode,
  listAssignments,
  makeLog,
  mask,
  readCredentials,
  userInfo,
} from './lib.mjs'

const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(name)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}

const log = makeLog({ verbose: hasFlag('--verbose') })
// 默认走回环：2026-11 实测远端落地页已被 Google 拒绝（redirect_uri_mismatch）。
const mode = argValue('--mode') || 'loopback'
const code = argValue('--code')
const scopes = hasFlag('--scopes-full') ? OAUTH.scopesFull : OAUTH.scopesMinimal
const pendingPath = join(WORK_ROOT, 'oauth-pending.json')
const timeoutMinutes = Number(argValue('--timeout-minutes') || 5)

/** 把待兑换的 redirect_uri / scopes 落盘，供下一次 `--code` 调用沿用。 */
async function savePending(redirectUri) {
  await mkdir(WORK_ROOT, { recursive: true })
  await writeFile(pendingPath, JSON.stringify({ redirectUri, scopes, at: Date.now() }, null, 2))
}

async function loadPending() {
  const { readFile } = await import('node:fs/promises')
  try {
    return JSON.parse(await readFile(pendingPath, 'utf8'))
  } catch {
    return null
  }
}

/** 授权成功后的统一动作：确认账号 + 打一次 CCU，证明令牌真的能用。 */
async function reportAuthorized(record) {
  const me = await userInfo(record.accessToken).catch(() => null)
  const account = me?.email ? me : accountFromIdToken(record.idToken)
  log.out('')
  log.out(`授权完成：${account?.email || '(未取到邮箱)'}`)
  log.out(`凭据文件：${credentialsPath()}`)
  log.out(`授权范围：${record.scope}`)
  log.out(`access_token 有效期至：${new Date(record.expiresAt).toLocaleString()}`)
  log.out(`refresh_token：${record.refreshToken ? '已获得' : '缺失（下次需重新授权）'}`)

  log.step('CCU 账户信息')
  const ccu = await ccuInfo(record.accessToken)
  log.out(`余额 ${ccu?.currentBalance} CU ｜ 速率 ${ccu?.consumptionRateHourly} CU/h ｜ 活跃实例 ${ccu?.assignmentsCount}`)
}

async function printStatus() {
  const token = await accessToken({ log })
  const record = await readCredentials()
  const me = await userInfo(token).catch(() => null)
  log.out(`账号：${me?.email || '(userinfo 不可用)'}`)
  log.out(`凭据：${credentialsPath()}（${record?.scope || 'scope 未知'}）`)

  log.step('CCU')
  const ccu = await ccuInfo(token)
  log.out(JSON.stringify(ccu, null, 2))

  log.step('活跃实例')
  const list = await listAssignments(token)
  if (!list.length) {
    log.out('（无）')
    return
  }
  for (const item of list) {
    log.out(
      [
        `endpoint=${item.endpoint}`,
        `accelerator=${item.accelerator}`,
        `shape=${item.machineShape}`,
        `variant=${item.variant}`,
        `proxy=${String(item.runtimeProxyInfo?.url || '').replace(/\/+$/, '')}`,
        `token=${mask(item.runtimeProxyInfo?.token)}`,
        `tokenTTL=${item.runtimeProxyInfo?.tokenExpiresInSeconds}s`,
      ].join('  '),
    )
  }
  log.out('')
  log.out(`提示：加速器可选 ${ACCELERATORS.join(' / ')}；L4 只有高内存机型，传 shape=hm 会被忽略。`)
}

/** 本地回环回调：起一个只服务一次的小 HTTP，收到 code 即兑换。 */
async function runLoopback() {
  const printOnly = hasFlag('--print-only')
  const desiredPort = Number(argValue('--port') || 8765)
  let redirectUri = `http://localhost:${desiredPort}`
  let server = null
  let received = null

  if (!printOnly) {
    server = createServer()
    received = new Promise((resolve, reject) => {
      server.on('request', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== '/') {
          res.writeHead(404).end('not found')
          return
        }
        const error = url.searchParams.get('error')
        const authCode = url.searchParams.get('code')
        const page = error
          ? `<h2>授权失败</h2><p>${error}</p>`
          : '<h2>授权完成</h2><p>可以关闭此页面，回到终端继续。</p>'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<meta charset="utf-8">${page}`)
        if (error) reject(new Error(error))
        else if (authCode) resolve(authCode)
        else reject(new Error('回调缺少 code'))
      })
    })

    const listen = (port) =>
      new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port)
      })

    try {
      await listen(desiredPort)
    } catch {
      log.warn(`端口 ${desiredPort} 不可用，改用随机端口`)
      await listen(0)
    }
    redirectUri = `http://localhost:${server.address().port}`
  }

  await savePending(redirectUri)
  const url = buildAuthUrl({ redirectUri, scopes })

  log.out('')
  log.out(`授权回调地址：${redirectUri}`)
  log.out('在浏览器中打开下面的链接并授权：')
  log.out('')
  log.out(url)
  log.out('')

  if (printOnly) {
    log.out('授权后浏览器会跳回上面的回调地址。如果页面打不开（连接被拒），那是正常的——')
    log.out('把地址栏里的完整 URL 复制下来执行：')
    log.out('  node tools/colab/probe-auth.mjs --code "<粘贴的回调 URL>"')
    log.out('')
    log.out('注意：回调地址里的端口必须与本次一致，否则换令牌时 Google 会报 redirect_uri_mismatch。')
    return
  }

  log.out(`等待回调，最长 ${timeoutMinutes} 分钟…`)
  const timer = setTimeout(() => {
    server.close()
    log.error('等待授权超时，未收到回调。')
    process.exit(1)
  }, Math.max(1, timeoutMinutes) * 60 * 1000)

  try {
    const authCode = await received
    clearTimeout(timer)
    server.close()
    log.info('已收到授权码，正在换取令牌…')
    const record = await exchangeCode({ code: authCode, redirectUri, scopes })
    await reportAuthorized(record)
  } catch (error) {
    clearTimeout(timer)
    server.close()
    log.error(error.message)
    process.exit(1)
  }
}

async function runRemote() {
  await savePending(OAUTH.remoteRedirect)
  const url = buildAuthUrl({ redirectUri: OAUTH.remoteRedirect, scopes })
  log.out('')
  log.out('在浏览器（任意设备均可）打开下面的链接并授权，Google 会在落地页显示一串授权码：')
  log.out('')
  log.out(url)
  log.out('')
  log.out('拿到授权码后执行：')
  log.out('  node tools/colab/probe-auth.mjs --code <授权码>')
  process.exit(2)
}

async function exchangeWithCode() {
  const pending = await loadPending()
  if (!pending?.redirectUri) {
    log.error('没有待兑换的授权请求。先运行一次不带 --code 的授权命令。')
    process.exit(1)
  }
  log.info(`用授权码换取令牌（redirect_uri=${pending.redirectUri}）…`)
  const record = await exchangeCode({ code, redirectUri: pending.redirectUri, scopes: pending.scopes || scopes })
  await reportAuthorized(record)}

async function main() {
  if (code) {
    await exchangeWithCode()
    return
  }
  if (hasFlag('--status')) {
    await printStatus()
    return
  }
  const existing = await readCredentials()
  if (existing?.accessToken && !hasFlag('--force')) {
    log.info('已有凭据；直接查看现状（重新授权加 --force）。')
    await printStatus()
    return
  }
  if (mode === 'remote') {
    log.warn('remote 模式当前会被 Google 拒绝（redirect_uri_mismatch），仅作对照；建议直接用回环。')
    await runRemote()
    return
  }
  await runLoopback()
}

main().catch((error) => {
  log.error(error?.message || String(error))
  if (error?.body) log.debug(`响应体：${String(error.body).slice(0, 500)}`)
  process.exit(1)
})
