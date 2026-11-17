/**
 * Google Colab 无头控制面 M0 探针的公共库（仅开发期使用，不进 npm 包）。
 *
 * 协议来源：逐行对照 `googlecolab/google-colab-cli`
 *   - `src/colab_cli/client.py`    控制面 /tun/m/*（XSSI 前缀、XSRF 头、nbh 编码）
 *   - `src/colab_cli/runtime.py`   Kernel WebSocket（query 里的 colab-runtime-proxy-token）
 *   - `src/colab_cli/contents.py`  Jupyter Contents API（令牌同样走 query）
 *   - `src/colab_cli/auth.py`      OAuth2 远端粘贴码流程与 scopes
 *
 * 三条硬约束（M0 就是为了验证它们）：
 *   1. 控制面响应带 XSSI 前缀 `)]}'\n`，不剥离就无法 JSON.parse；
 *   2. 代理令牌约 1 小时过期，长时间保活必须定期重新拉 assignments 刷新；
 *   3. Kernel WebSocket 是唯一被证实有效的保活手段，HTTP 流量与 TFE ping 都不够。
 *
 * 本文件不依赖任何第三方包；要求 Node ≥ 22（原生 fetch / WebSocket）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/* ------------------------------------------------------------------ 常量 */

/** Google 官方 colab-cli 的公开 installed-app 客户端（方案 A）。 */
export const OAUTH = {
  clientId: '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com',
  clientSecret: 'd-FL95Q19q7MQmFpd7hHD0Ty',
  authUri: 'https://accounts.google.com/o/oauth2/auth',
  tokenUri: 'https://oauth2.googleapis.com/token',
  /** 远端粘贴码落地页；官方 CLI 用它，但 2026-11 实测该 client_id 已被 Google 拒绝此 redirect。 */
  remoteRedirect: 'https://sdk.cloud.google.com/applicationdefaultauthcode.html',
  /** colab-cli 的完整 scope 集；默认只用前四项（够控制面与控制台用）。 */
  scopesMinimal: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/colaboratory',
  ],
  scopesFull: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/colaboratory',
    'https://www.googleapis.com/auth/drive.file',
  ],
}

export const COLAB = {
  domain: 'https://colab.research.google.com',
  tun: '/tun/m',
  xssi: ")]}'\n",
  clientAgent: 'colab-cli',
}

/** 加速器白名单：与 colab-cli 的 Accelerator 枚举一致。 */
export const ACCELERATORS = ['NONE', 'T4', 'L4', 'A100', 'H100', 'G4', 'V5E1', 'V6E1']
/** 只有高内存机型的加速器：传 shape=hm 会被后端忽略。 */
export const HIGH_MEM_ONLY = new Set(['L4', 'V5E1', 'V6E1'])

export const WORK_ROOT = resolve(process.cwd(), '.tmp/colab')

/* -------------------------------------------------------------- 基础工具 */

const NOOP = () => {}

/** 统一日志：时间戳 + 级别，敏感值由调用方脱敏后再传进来。 */
export function makeLog({ verbose = false } = {}) {
  const stamp = () => new Date().toISOString().slice(11, 19)
  const emit = (level, msg) => {
    if (level === 'debug' && !verbose) return
    process.stderr.write(`${stamp()} ${level.padEnd(5)} ${msg}\n`)
  }
  return {
    info: (msg) => emit('info', msg),
    warn: (msg) => emit('warn', msg),
    error: (msg) => emit('error', msg),
    debug: (msg) => emit('debug', msg),
    step: (msg) => process.stdout.write(`\n== ${msg}\n`),
    out: (msg = '') => process.stdout.write(`${msg}\n`),
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 超时与外部取消合并：任一触发都中止请求（epoch 换代时用它立刻掐断在飞的 assign/上传）。 */
function combineSignals(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([timeout, signal]) : timeout
}

/** 只显示令牌的首尾 4 字符，日志里永不出现完整凭据。 */
export function mask(value) {
  const text = String(value ?? '')
  if (text.length <= 10) return text ? '***' : ''
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

export class ProbeError extends Error {
  constructor(message, { status = 0, body = '' } = {}) {
    super(message)
    this.name = 'ProbeError'
    this.status = status
    this.body = body
  }
}

function jsonOrNull(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- 凭据存储 */

/** 凭据落盘位置：`~/.imagen/colab-credentials.json`（0600），可用环境变量覆盖。 */
export function credentialsPath() {
  return process.env.IMAGEN_COLAB_CREDENTIALS
    ? resolve(process.env.IMAGEN_COLAB_CREDENTIALS)
    : join(homedir(), '.imagen', 'colab-credentials.json')
}

/** 原子写 + 尽量收紧权限；Windows 上 chmod 无效但不报错。 */
async function writePrivateJson(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, path)
  await chmod(path, 0o600).catch(NOOP)
}

export async function readCredentials() {
  try {
    const raw = await readFile(credentialsPath(), 'utf8')
    return jsonOrNull(raw)
  } catch {
    return null
  }
}

export async function writeCredentials(tokens) {
  const path = credentialsPath()
  await writePrivateJson(path, tokens)
  return path
}

/* ------------------------------------------------------------------ OAuth */

function formEncode(pairs) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(pairs)) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  return params
}

/**
 * 生成授权链接。两种落地方式：
 *  - remote：官方 CLI 同款粘贴码（稳，但需要人复制粘贴）；
 *  - loopback：`http://localhost:<port>`（体验好，M0 要实测是否被 Google 拦）。
 */
export function buildAuthUrl({ redirectUri, scopes = OAUTH.scopesMinimal, loginHint = '' }) {
  const params = formEncode({
    client_id: OAUTH.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    // 官方 CLI 用它让 Google 在落地页直接显示授权码；loopback 模式不能带。
    token_usage: redirectUri === OAUTH.remoteRedirect ? 'remote' : undefined,
    login_hint: loginHint || undefined,
  })
  return `${OAUTH.authUri}?${params}`
}

async function tokenRequest(payload) {
  const res = await fetch(OAUTH.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(payload).toString(),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  const body = jsonOrNull(text)
  if (!res.ok) {
    const reason = body?.error_description || body?.error || text.slice(0, 200)
    throw new ProbeError(`换取令牌失败：${reason}`, { status: res.status, body: text })
  }
  if (!body?.access_token) throw new ProbeError('令牌响应缺少 access_token', { body: text })
  return body
}

/** 授权码容错：允许粘贴整条回调 URL、或 URL 编码过的码（Google 落地页复制常见）。 */
export function normalizeAuthCode(input) {
  let text = String(input || '').trim()
  const match = /[?&]code=([^&\s]+)/.exec(text)
  if (match) text = match[1]
  if (text.includes('%')) {
    try {
      text = decodeURIComponent(text)
    } catch {
      // 保持原样，交给 Google 报错。
    }
  }
  return text
}

/** 用授权码换令牌，并把 refresh_token / 过期时间一起落盘。 */
export async function exchangeCode({ code, redirectUri, scopes = OAUTH.scopesMinimal }) {
  const body = await tokenRequest({
    code: normalizeAuthCode(code),
    client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const record = {
    version: 1,
    clientId: OAUTH.clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    idToken: body.id_token || null,
    scope: body.scope || scopes.join(' '),
    tokenType: body.token_type || 'Bearer',
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
    redirectUri,
    obtainedAt: new Date().toISOString(),
  }
  await writeCredentials(record)
  return record
}

/**
 * 取可用的 access_token：未过期直接用，过期且有 refresh_token 就刷新。
 * 刷新失败时清理并抛错，交给上层提示重新授权。
 */
export async function accessToken({ log = makeLog() } = {}) {
  const record = await readCredentials()
  if (!record?.accessToken) {
    throw new ProbeError('尚未授权。先运行 probe-auth.mjs 拿到授权码。')
  }
  const fresh = record.expiresAt && record.expiresAt - 60_000 > Date.now()
  if (fresh) return record.accessToken
  if (!record.refreshToken) throw new ProbeError('access_token 已过期且没有 refresh_token，需要重新授权。')

  const body = await tokenRequest({
    refresh_token: record.refreshToken,
    client_id: OAUTH.clientId,
    client_secret: OAUTH.clientSecret,
    grant_type: 'refresh_token',
  })
  const next = {
    ...record,
    accessToken: body.access_token,
    scope: body.scope || record.scope,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
    refreshedAt: new Date().toISOString(),
  }
  await writeCredentials(next)
  log.info('access_token 已刷新')
  return next.accessToken
}

/** 解出 id_token 里的邮箱（不验签，只用于确认登的是哪个账号）。 */
export function accountFromIdToken(idToken) {
  const payload = String(idToken || '').split('.')[1]
  if (!payload) return null
  const decoded = jsonOrNull(Buffer.from(payload, 'base64url').toString('utf8'))
  return decoded ? { email: decoded.email, name: decoded.name, sub: decoded.sub } : null
}

/* --------------------------------------------------------------- 控制面 */

/** UUID → Colab 的 nbh 口径：`-` 换 `_`，再用 `.` 补到 44 位（不是 base64）。 */
export function uuidToNbh(uuid) {
  const text = String(uuid)
  return `${text.replace(/-/g, '_')}${'.'.repeat(Math.max(0, 44 - text.length))}`
}

/** 剥离 XSSI 前缀；响应体可能为空（unassign 的 POST 就没有正文）。 */
function stripXssi(text) {
  return text.startsWith(COLAB.xssi) ? text.slice(COLAB.xssi.length) : text
}

/**
 * 控制面请求。所有 /tun/m/* 调用都走这里：
 * 带 `authuser=0`、`Accept: application/json`、`X-Colab-Client-Agent`，
 * 响应先剥 XSSI 再解析。非 2xx 抛 ProbeError（带状态码，便于区分 400/412）。
 *
 * `xsrf` 是写操作必须的防伪令牌：assign/unassign 的 POST 都要把 GET 拿到的
 * 值放进 `X-Goog-Colab-Token` 头，否则后端拒绝。
 */
export async function colabRequest(
  path,
  { method = 'GET', params = {}, token, body, xsrf = '', headers: extraHeaders = {}, timeoutMs = 60000, signal } = {},
) {
  const url = new URL(path, COLAB.domain)
  url.searchParams.set('authuser', '0')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  const headers = {
    Accept: 'application/json',
    'X-Colab-Client-Agent': COLAB.clientAgent,
    ...extraHeaders,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (xsrf) headers['X-Goog-Colab-Token'] = xsrf
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: combineSignals(timeoutMs, signal),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new ProbeError(`${method} ${url.pathname} → ${res.status}`, { status: res.status, body: text.slice(0, 800) })
  }
  const parsed = jsonOrNull(stripXssi(text))
  return parsed
}

/** 账户级 CCU 余额与计费速率。 */
export async function ccuInfo(token) {
  return colabRequest(`${COLAB.tun}/ccu-info`, { token })
}

/** 当前活跃实例列表（含代理地址与令牌，令牌约 1 小时过期）。 */
export async function listAssignments(token) {
  const body = await colabRequest(`${COLAB.tun}/assignments`, { token })
  return Array.isArray(body?.assignments) ? body.assignments : []
}

/** 用户名（确认授权的是哪个 Google 账号）。 */
export async function userInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  const body = jsonOrNull(await res.text())
  if (!res.ok) throw new ProbeError(`userinfo → ${res.status}`, { status: res.status })
  return body
}

function assignQuery({ nbh, variant, accelerator, highRam }) {
  const params = { nbh: uuidToNbh(nbh) }
  if (variant) params.variant = variant
  if (accelerator && accelerator !== 'NONE') params.accelerator = accelerator
  // 只有高内存机型以外的加速器才接受 shape=hm；L4 等传了也会被忽略。
  if (highRam && !HIGH_MEM_ONLY.has(accelerator)) params.shape = 'hm'
  return params
}

/**
 * 申请实例。GET 先拿 XSRF token（或直接拿到已有 assignment），再 POST 确认。
 * 与官方 CLI 一致：412 = 实例数/容量超限，400 = 无该加速器权益。
 */
export async function assign({ token, accelerator = 'L4', highRam = false, variant = null, log = makeLog(), timeoutMs = 180000, signal }) {
  const nbh = randomUUID()
  const params = assignQuery({
    nbh,
    variant: variant || (accelerator === 'NONE' ? 'DEFAULT' : 'GPU'),
    accelerator,
    highRam,
  })

  log.info(`申请实例 accelerator=${accelerator} highRam=${highRam || 'off'} nbh=${params.nbh.slice(0, 8)}…`)
  const pending = await colabRequest(`${COLAB.tun}/assign`, { token, params, timeoutMs, signal })
  if (pending?.runtimeProxyInfo && pending?.endpoint) {
    log.info('后端直接返回了已有实例（未新建）')
    return { ...pending, created: false }
  }
  if (!pending?.token) throw new ProbeError('assign GET 未返回 XSRF token', { body: JSON.stringify(pending).slice(0, 400) })

  log.info('拿到 XSRF token，提交 POST 等待调度…')
  const started = Date.now()
  try {
    const created = await colabRequest(`${COLAB.tun}/assign`, {
      method: 'POST',
      token,
      params,
      xsrf: pending.token,
      timeoutMs,
      signal,
    })
    log.info(`实例就绪，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return { ...created, created: true }
  } catch (error) {
    if (error instanceof ProbeError && error.status === 412) {
      throw new ProbeError('申请被拒（412）：实例数超限或该机型暂时无容量。先 unassign 再重试。', { status: 412 })
    }
    if (error instanceof ProbeError && error.status === 400) {
      throw new ProbeError(`申请被拒（400）：账号没有 ${accelerator} 的配额或权益。`, { status: 400 })
    }
    throw error
  }
}

/** 释放实例：GET 取 XSRF token → 带 X-Goog-Colab-Token 发 POST。 */
export async function unassign({ token, endpoint, log = makeLog(), signal }) {
  const path = `${COLAB.tun}/unassign/${encodeURIComponent(endpoint)}`
  const pending = await colabRequest(path, { token, signal })
  if (!pending?.token) throw new ProbeError('unassign GET 未返回 XSRF token')
  await colabRequest(path, {
    method: 'POST',
    token,
    // 与 assign 同一口径：XSRF 放 X-Goog-Colab-Token。
    xsrf: pending.token,
    signal,
  })
  log.info(`已释放实例 ${endpoint}`)
  return true
}

/** TFE 保活 ping：只当作辅助手段，ReadTimeout 也算成功（活跃时间已刷新）。 */
export async function tfeKeepAlive({ token, endpoint, timeoutMs = 15000 }) {
  const url = new URL(`${COLAB.tun}/${encodeURIComponent(endpoint)}/keep-alive/`, COLAB.domain)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Colab-Tunnel': 'Google', 'X-Colab-Client-Agent': COLAB.clientAgent },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { ok: res.ok, status: res.status }
  } catch (error) {
    // 官方 CLI 与社区实现都把读超时视为成功：请求到达即刷新。
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { ok: true, status: 0, timeout: true }
    return { ok: false, status: 0, error: String(error?.message || error) }
  }
}

/* ------------------------------------------------------- 运行时（代理） */

/** runtimeProxyInfo.url 可能带尾斜杠，统一去掉后再拼路径。 */
export function proxyBase(assignment) {
  const raw = assignment?.runtimeProxyInfo?.url || assignment?.url
  if (!raw) throw new ProbeError('assignment 缺少 runtimeProxyInfo.url')
  return String(raw).replace(/\/+$/, '')
}

export function proxyToken(assignment) {
  return assignment?.runtimeProxyInfo?.token || assignment?.token || ''
}

/**
 * 经 runtimeProxy 访问容器内的 Jupyter。令牌必须放 query（Header 亦可，但 query 是官方做法）。
 */
export async function runtimeFetch(assignment, path, { method = 'GET', params = {}, json, timeoutMs = 60000, signal } = {}) {
  const base = proxyBase(assignment)
  const url = new URL(`${base}${path}`)
  url.searchParams.set('authuser', '0')
  url.searchParams.set('colab-runtime-proxy-token', proxyToken(assignment))
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))

  const headers = {
    'X-Colab-Runtime-Proxy-Token': proxyToken(assignment),
    'X-Colab-Client-Agent': COLAB.clientAgent,
  }
  if (json !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    signal: combineSignals(timeoutMs, signal),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new ProbeError(`${method} ${path} → ${res.status}`, { status: res.status, body: text.slice(0, 600) })
  }
  return { status: res.status, text, json: jsonOrNull(text) }
}

/** 上传文件到容器（Contents API，base64 单块）。 */
export async function uploadFile(assignment, remotePath, content, { timeoutMs = 120000, signal } = {}) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  return runtimeFetch(assignment, `/api/contents/${remotePath.replace(/^\/+/, '')}`, {
    method: 'PUT',
    json: {
      name: remotePath.split('/').pop(),
      path: remotePath,
      type: 'file',
      format: 'base64',
      content: data.toString('base64'),
      chunk: 1,
    },
    timeoutMs,
    signal,
  })
}

/** 读取容器内文本文件。 */
export async function readFileText(assignment, remotePath) {
  const res = await runtimeFetch(assignment, `/api/contents/${remotePath.replace(/^\/+/, '')}`, {
    params: { content: '1', type: 'file' },
  })
  const body = res.json
  if (!body) throw new ProbeError(`读取 ${remotePath} 返回非 JSON`)
  if (body.format === 'base64') return Buffer.from(body.content || '', 'base64').toString('utf8')
  return typeof body.content === 'string' ? body.content : JSON.stringify(body.content ?? '')
}

/** 创建 Kernel（不建 notebook 文件，直接 POST /api/kernels）。 */
export async function createKernel(assignment, { name = 'python3' } = {}) {
  const res = await runtimeFetch(assignment, '/api/kernels', { method: 'POST', json: { name } })
  if (!res.json?.id) throw new ProbeError('创建 Kernel 失败：响应缺少 id', { body: res.text.slice(0, 300) })
  return res.json.id
}

/** 列出 Kernel，用于重启后确认旧 Kernel 是否还活着。 */
export async function listKernels(assignment) {
  const res = await runtimeFetch(assignment, '/api/kernels')
  return Array.isArray(res.json) ? res.json : []
}

/* ---------------------------------------------------- 最小 Jupyter WS 客户端 */

/**
 * Jupyter Kernel WebSocket 客户端（只实现本探针需要的 execute_request）。
 *
 * 为什么不引入 jupyter 客户端库：M0 要验证的正是"纯 Node.js 能不能说这套协议"，
 * 引入现成库就失去验证意义。协议是经典 JSON 消息（不带子协议）。
 */
export class KernelSocket {
  constructor(assignment, kernelId, { log = makeLog(), sessionId = randomUUID() } = {}) {
    this.assignment = assignment
    this.kernelId = kernelId
    this.sessionId = sessionId
    this.log = log
    this.ws = null
    this.pending = new Map()
    this.closed = false
    this.lastClose = null
    this.beats = 0
  }

  url() {
    const base = proxyBase(this.assignment)
    const wsBase = base.replace(/^http/i, 'ws')
    const url = new URL(`${wsBase}/api/kernels/${this.kernelId}/channels`)
    url.searchParams.set('session_id', this.sessionId)
    url.searchParams.set('authuser', '0')
    url.searchParams.set('colab-runtime-proxy-token', proxyToken(this.assignment))
    return url.toString()
  }

  async connect({ timeoutMs = 30000, retries = 3, retryDelayMs = 2000, signal } = {}) {
    if (!globalThis.WebSocket) throw new ProbeError('当前 Node 没有原生 WebSocket，需要 Node ≥ 22')
    const url = this.url()
    this.log.info(`连接 Kernel WS ${url.replace(/colab-runtime-proxy-token=[^&]+/, 'colab-runtime-proxy-token=***')}`)

    // 刚创建完 Kernel 立刻连接可能被拒（"Connection was closed before it was
    // established"），官方 CLI 也是 3 次退避重试；实测重试即可恢复。
    let lastError = null
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      if (signal?.aborted) throw new ProbeError('Kernel WS 连接已取消')
      try {
        const ws = await this.#open(url, timeoutMs, signal)
        this.#attach(ws)
        return this
      } catch (error) {
        lastError = error
        if (attempt < retries) {
          this.log.warn(`WS 连接失败（第 ${attempt}/${retries} 次）：${error.message}；${retryDelayMs * attempt}ms 后重试`)
          await sleep(retryDelayMs * attempt)
        }
      }
    }
    throw lastError
  }

  #open(url, timeoutMs, signal) {
    return new Promise((resolvePromise, reject) => {
      let socket
      try {
        socket = new WebSocket(url)
      } catch (error) {
        reject(error)
        return
      }
      const timer = setTimeout(() => {
        try {
          socket.close()
        } catch {}
        reject(new ProbeError(`Kernel WS 连接超时（${timeoutMs}ms）`))
      }, timeoutMs)
      // epoch 换代时立刻断开正在握手/已建立的连接（provider.js 契约第 2 条）。
      const onAbort = () => {
        clearTimeout(timer)
        try {
          socket.close()
        } catch {}
        reject(new ProbeError('Kernel WS 连接已取消'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolvePromise(socket)
      })
      socket.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(new ProbeError(`Kernel WS 连接失败：${event?.message || 'unknown'}`))
      })
      socket.addEventListener('close', (event) => {
        clearTimeout(timer)
        if (socket.readyState !== 1) reject(new ProbeError(`Kernel WS 提前关闭（code=${event.code}）`))
      })
    })
  }

  #attach(ws) {
    this.ws = ws
    ws.addEventListener('message', (event) => this.#onMessage(event.data))
    ws.addEventListener('close', (event) => {
      this.closed = true
      this.lastClose = { code: event.code, reason: event.reason, at: Date.now() }
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new ProbeError(`Kernel WS 已关闭（code=${event.code}）`))
      }
      this.pending.clear()
    })
  }

  #onMessage(raw) {
    const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
    const message = jsonOrNull(text)
    if (!message) return
    const msgType = message?.header?.msg_type
    const parent = message?.parent_header?.msg_id
    if (msgType === 'status' && ['dead', 'restarting'].includes(message?.content?.execution_state)) {
      this.log.warn(`Kernel 状态变为 ${message.content.execution_state}`)
    }
    if (!parent) return
    const entry = this.pending.get(parent)
    if (!entry) return
    if (msgType === 'stream' && message.content?.text) entry.output += message.content.text
    if (msgType === 'error') entry.output += `${message.content?.ename || 'Error'}: ${message.content?.evalue || ''}`
    if (msgType === 'status' && message.content?.execution_state === 'idle') {
      clearTimeout(entry.timer)
      this.pending.delete(parent)
      entry.resolve({ ok: true, output: entry.output.trim() })
      return
    }
    if (msgType === 'execute_reply') {
      entry.reply = message.content
      if (message.content?.status === 'error' && !entry.output) {
        entry.output = `${message.content.ename || 'Error'}: ${message.content.evalue || ''}`
      }
    }
  }

  /** 执行一段代码，等到 iopub idle 视为完成（与官方 CLI 的判据一致）。 */
  execute(code, { timeoutMs = 60000, silent = true, userExpressions = {} } = {}) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new ProbeError('Kernel WS 未连接'))
    const msgId = randomUUID()
    const message = {
      header: {
        msg_id: msgId,
        username: 'imagen-probe',
        session: this.sessionId,
        msg_type: 'execute_request',
        version: '5.3',
        date: new Date().toISOString(),
      },
      parent_header: {},
      metadata: {},
      content: {
        code,
        silent,
        store_history: false,
        user_expressions: userExpressions,
        allow_stdin: false,
        stop_on_error: true,
      },
      channel: 'shell',
      buffers: [],
    }
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msgId)
        reject(new ProbeError(`执行超时（${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(msgId, {
        output: '',
        timer,
        resolve: (value) => {
          this.beats += 1
          resolvePromise(value)
        },
        reject,
      })
      this.ws.send(JSON.stringify(message))
    })
  }

  close() {
    try {
      this.ws?.close()
    } catch {}
  }
}

/* ------------------------------------------------------------- 本地状态 */

export function sessionStatePath() {
  return join(WORK_ROOT, 'session.json')
}

export async function readSessionState() {
  try {
    return jsonOrNull(await readFile(sessionStatePath(), 'utf8'))
  } catch {
    return null
  }
}

/** 探针之间传递 assignment 的最小现场：端点、代理地址、kernel id、加速器。 */
export async function writeSessionState(data) {
  await mkdir(WORK_ROOT, { recursive: true })
  await writePrivateJson(sessionStatePath(), { ...data, savedAt: new Date().toISOString() })
}

export async function clearSessionState() {
  await mkdir(WORK_ROOT, { recursive: true })
  await writeFile(sessionStatePath(), '{}\n', { mode: 0o600 }).catch(NOOP)
}

/** 从现场里挑一个可用的 assignment 结构（统一成控制面返回的形状）。 */
export function assignmentFromState(state) {
  if (!state?.endpoint) return null
  return {
    endpoint: state.endpoint,
    accelerator: state.accelerator,
    machineShape: state.machineShape,
    runtimeProxyInfo: {
      url: state.proxyUrl,
      token: state.proxyToken,
      tokenExpiresInSeconds: state.proxyTokenExpiresInSeconds,
    },
  }
}

/** 指纹（用于日志里区分不同实例，不含敏感信息）。 */
export function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
}

/** 轮询直到 fn 返回真值，超时抛错。用于等容器内服务就绪。 */
export async function waitFor(fn, { timeoutMs = 60000, intervalMs = 2000, label = '条件' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(intervalMs)
  }
  throw new ProbeError(`等待${label}超时（${Math.round(timeoutMs / 1000)}s）${last ? `：${last.message}` : ''}`)
}

/**
 * 容器内的测试 HTTP 服务：给试验 2 提供"真实业务流量"，给试验 3 验证代理转发。
 * 故意只依赖标准库 + 可选的 torch，避免在 Colab 上装任何东西。
 */
export const PROBE_SERVER_PY = `# -*- coding: utf-8 -*-
"""M0 探针用的最小 HTTP 服务：证明端口在容器内可用、且能被外部访问。"""
import http.server
import json
import socketserver
import time

START = time.time()


def gpu_name():
    try:
        import torch
        return torch.cuda.get_device_name(0)
    except Exception as exc:  # noqa: BLE001
        return "unavailable: %s" % exc


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        payload = {
            "ok": True,
            "uptime_sec": round(time.time() - START, 1),
            "path": self.path,
            "gpu": gpu_name(),
            "pid": __import__("os").getpid(),
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 静音，避免日志文件被访问记录刷爆
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


with Server(("0.0.0.0", 8000), Handler) as httpd:
    print("PROBE_SERVER_READY", flush=True)
    httpd.serve_forever()
`

