/**
 * 底层 Kaggle JSON API HTTP 客户端与本地凭据管理。
 *
 * 与传输层实现（`lib/kaggle-direct.js`）及浏览器 OAuth 登录管理器（`lib/kaggle-oauth.js`）解耦：
 * 两者共用本模块的凭据路径、读写、过期判定、Bearer/Basic 候选解析、Token 续期/自省与
 * `kaggleApiRequest`，消除 `kaggle-oauth -> kaggle-direct` 的反向依赖。
 *
 * 协议基准见本机 `kaggle` 2.2.5 / `kagglesdk` 0.1.38 源码：
 *  - 请求地址：`POST https://api.kaggle.com/v1/<service>/<Method>`
 *  - 错误判定：HTTP 非 2xx，或 HTTP 200 + `body.code >= 400`
 *  - 凭据优先级：`KAGGLE_API_TOKEN` → `~/.kaggle/access_token(.txt)` → `~/.kaggle/credentials.json` → `~/.kaggle/kaggle.json`
 *  - 所有 HTTP 走 `lib/net.js` 的 `httpText`（fetch 失败自动 curl 代理兜底）。
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { TIMEOUTS } from '../shared/contract.js'
import { writeFileAtomic } from './fs-atomic.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'
import { logText } from './redact.js'

const log = createLogger({ scope: 'kaggle' })

/** 生产环境 API 端点（kagglesdk/kaggle_env.py:24-31）。 */
export const API_ORIGIN = 'https://api.kaggle.com'

/**
 * kagglesdk 默认 User-Agent 是 `kaggle-api/v1.7.0`（kaggle_http_client.py:68）。
 * 直连与 OAuth 沿用同一标识，避免服务端把来源当成未知客户端。
 */
const USER_AGENT = 'kaggle-api/v1.7.0'

export const DEFAULT_TIMEOUT_MS = TIMEOUTS.cliMs

/** access token 默认有效期 12 小时（kaggle_creds.py:15）。 */
const DEFAULT_ACCESS_TOKEN_EXPIRATION_SEC = 12 * 60 * 60
/** 提前 30 分钟视为过期（kaggle_creds.py:117-120）。 */
const EXPIRY_SKEW_MS = 30 * 60 * 1000

function errorType(error) {
  return String(error?.name ?? error?.code ?? (error instanceof Error ? 'Error' : typeof error))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function readTextFile(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/** `access_token_expiration` 支持 ISO 字符串（Python `datetime.isoformat()` 产物）。 */
function parseExpirationMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * 解析 Kaggle 凭据路径。
 *
 * 默认 `~/.kaggle`；支持 CLI 的 `KAGGLE_CONFIG_DIR` 覆盖（kaggle_api_extended.py:1152-1160），
 * 以及 `credentialsPath` 显式注入（测试 / 验收脚本用）。
 *
 * @param {{ homeDir?: string, credentialsPath?: string | null, env?: object }} [options]
 * @returns {{ baseDir: string, credentials: string, accessToken: string,
 *             accessTokenTxt: string, kaggleJson: string }}
 */
export function kagglePaths({ homeDir = homedir(), credentialsPath = null, env = process.env } = {}) {
  const envDir = typeof env?.KAGGLE_CONFIG_DIR === 'string' ? env.KAGGLE_CONFIG_DIR.trim() : ''
  const baseDir = envDir ? resolve(envDir) : resolve(String(homeDir), '.kaggle')
  return {
    baseDir,
    credentials: credentialsPath ? resolve(String(credentialsPath)) : join(baseDir, 'credentials.json'),
    accessToken: join(baseDir, 'access_token'),
    accessTokenTxt: join(baseDir, 'access_token.txt'),
    kaggleJson: join(baseDir, 'kaggle.json'),
  }
}

/**
 * 读取 `~/.kaggle/credentials.json`；文件不存在 / 损坏 / 缺 refresh_token 时返回 null
 * （与 kaggle_creds.py:34-63 的 `KaggleCredentials.load` 同口径）。
 *
 * @param {string} filePath
 * @returns {Promise<null | { refreshToken: string, accessToken: string | null,
 *   accessTokenExpiration: number | null, username: string | null, scopes: string[] }>}
 */
export async function readCredentialsFile(filePath) {
  const text = await readTextFile(filePath)
  if (!text || !text.trim()) return null
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(data)) return null
  const refreshToken = nonEmptyString(data.refresh_token)
  if (!refreshToken) return null
  return {
    refreshToken,
    accessToken: nonEmptyString(data.access_token),
    accessTokenExpiration: parseExpirationMs(data.access_token_expiration),
    username: nonEmptyString(data.username),
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((item) => typeof item === 'string') : [],
  }
}

/** access token 是否过期（或即将过期）：提前 30 分钟续期，与 kaggle_creds.py:117-120 一致。 */
export function credentialsExpired(credentials, now = Date.now()) {
  if (!credentials || !nonEmptyString(credentials.accessToken)) return true
  const expiration = credentials.accessTokenExpiration
  if (!Number.isFinite(expiration)) return true
  return expiration < now - EXPIRY_SKEW_MS
}

/**
 * 与 Python `datetime.isoformat()` 兼容的过期时间格式。
 *
 * kagglesdk 用 `datetime.fromisoformat` 解析该字段（kaggle_creds.py:50-52）；Python 3.11+ 虽接受
 * `Z`，但为了让旧版 Python 也能读，这里统一写成 `+00:00`。
 */
export function formatCredentialExpiration(ms) {
  return new Date(ms).toISOString().replace('Z', '+00:00')
}

/**
 * 原子写入 `credentials.json`（目录 0700、文件 0600、同目录临时文件 + rename）。
 * 字段与顺序对齐 kaggle_creds.py:79-95，保证 `kaggle` CLI 可以直接读。
 *
 * @param {string} filePath
 * @param {{ refreshToken: string, accessToken?: string | null,
 *   accessTokenExpiration?: number | string | null, username?: string | null,
 *   scopes?: string[] }} credentials
 * @returns {Promise<object>} 写入的 JSON 对象（不含任何额外字段）
 */
export async function writeCredentialsFile(filePath, credentials) {
  const expiration =
    typeof credentials.accessTokenExpiration === 'number'
      ? formatCredentialExpiration(credentials.accessTokenExpiration)
      : typeof credentials.accessTokenExpiration === 'string'
        ? credentials.accessTokenExpiration
        : ''
  const data = {
    refresh_token: credentials.refreshToken ?? '',
    access_token: credentials.accessToken ?? '',
    access_token_expiration: expiration,
    username: credentials.username ?? '',
    scopes: Array.isArray(credentials.scopes) ? credentials.scopes : [],
  }
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), {
    dirMode: 0o700,
    fileMode: 0o600,
    encoding: 'utf8',
  })
  return data
}

/**
 * 调一次 Kaggle JSON API（kagglesdk `KaggleHttpClient.call` 的 Node 等价物）。
 *
 * @param {object} ctx 宿主上下文（传给 `httpText`，无 `ctx.subprocess` 时不走 curl 兜底）
 * @param {{ endpoint: string, body?: object, authorization?: string | null,
 *           timeoutMs?: number, maxBytes?: number }} options endpoint 形如
 *   `/v1/kernels.KernelsApiService/SaveKernel`
 * @returns {Promise<{ ok: boolean, status: number | null, json: object | null, text: string,
 *   errorCode: 'auth_required' | 'unknown' | null, detail: string }>}
 */
export async function kaggleApiRequest(ctx, { endpoint, body = {}, authorization = null, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = 256 * 1024 } = {}) {
  const startedAt = Date.now()
  const headers = { 'user-agent': USER_AGENT, 'content-type': 'application/json' }
  if (authorization) headers.authorization = authorization
  let response
  try {
    response = await httpText(ctx, `${API_ORIGIN}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      timeoutMs,
      maxBytes,
    })
  } catch (error) {
    // 网络层异常（DNS / 代理 / 超时）一律归 unknown：不能误报成鉴权失败。
    log.warn(`direct_network_failed endpoint=${endpoint} errorType=${errorType(error)} elapsedMs=${Date.now() - startedAt} detail=${logText(error?.message)}`)
    return { ok: false, status: null, json: null, text: '', errorCode: 'unknown', detail: `网络请求失败：${logText(error?.message ?? error)}` }
  }

  const text = typeof response?.text === 'string' ? response.text : ''
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  const status = Number.isFinite(response?.status) ? Number(response.status) : null
  // 服务端可能用 HTTP 200 + body.code >= 400 表达业务错误（kaggle_http_client.py:128-131）。
  const bodyCode = Number.isFinite(json?.code) ? Number(json.code) : null
  const failureStatus = status !== null && status >= 400 ? status : bodyCode !== null && bodyCode >= 400 ? bodyCode : null

  if (failureStatus !== null || response?.ok !== true) {
    const errorCode = failureStatus === 401 || failureStatus === 403 ? 'auth_required' : 'unknown'
    const rawDetail = nonEmptyString(json?.message) ?? nonEmptyString(json?.error) ?? text
    const detail = rawDetail ? logText(rawDetail, 300) : `HTTP ${failureStatus ?? status ?? 'unknown'}`
    log.info(`direct_call endpoint=${endpoint} status=${status ?? 'none'} errorCode=${errorCode} elapsedMs=${Date.now() - startedAt} detail=${detail}`)
    return { ok: false, status, json, text, errorCode, detail }
  }

  log.debug(`direct_ok endpoint=${endpoint} status=${status ?? 'none'} elapsedMs=${Date.now() - startedAt}`)
  return { ok: true, status, json, text, errorCode: null, detail: '' }
}

async function accessTokenFromEnv(env) {
  const raw = nonEmptyString(env?.KAGGLE_API_TOKEN)
  if (!raw) return null
  // KAGGLE_API_TOKEN 既可以是 token 本身，也可以是文件路径（kaggle_env.py:97-104）。
  const fromFile = await readTextFile(raw)
  return nonEmptyString(fromFile) ?? raw
}

async function accessTokenFromFile(filePath) {
  const text = await readTextFile(filePath)
  return nonEmptyString(text)
}

async function basicAuthFromKaggleJson(filePath) {
  const text = await readTextFile(filePath)
  if (!text || !text.trim()) return null
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(data)) return null
  const username = nonEmptyString(data.username)
  const key = nonEmptyString(data.key)
  if (!username || !key) return null
  return {
    authorization: `Basic ${Buffer.from(`${username}:${key}`, 'utf8').toString('base64')}`,
    username,
  }
}

/**
 * 按 kagglesdk 的口径收集鉴权候选（顺序即优先级）：
 * env token → access_token 文件 → credentials.json（含 refresh）→ kaggle.json Basic。
 * 每个候选只在真正使用时才读盘 / 续期（`describe()`），因此解析失败不会拖慢探测。
 *
 * 说明：CLI 的 `authenticate()`（kaggle_api_extended.py:1483-1509）把 kaggle.json 排在 OAuth 之前；
 * 这里按任务口径把可续期的 OAuth 凭据放在 kaggle.json 之前——credentials.json 是 CLI 2.x 登录产物，
 * 语义上比旧版 kaggle.json 更"新"。
 */
export async function buildAuthCandidates(ctx, { paths, env = process.env, now = Date.now } = {}) {
  const candidates = []

  const envToken = await accessTokenFromEnv(env)
  if (envToken) {
    candidates.push({
      source: 'env',
      async describe() {
        return { authorization: `Bearer ${envToken}`, token: envToken, username: null }
      },
    })
  }

  for (const [source, filePath] of [
    ['accessToken', paths.accessToken],
    ['accessTokenTxt', paths.accessTokenTxt],
  ]) {
    const token = await accessTokenFromFile(filePath)
    if (!token) continue
    candidates.push({
      source,
      async describe() {
        return { authorization: `Bearer ${token}`, token, username: null }
      },
    })
  }

  const credentials = await readCredentialsFile(paths.credentials)
  if (credentials) {
    candidates.push({
      source: 'credentials',
      async describe() {
        if (!credentialsExpired(credentials, now())) {
          return { authorization: `Bearer ${credentials.accessToken}`, token: credentials.accessToken, username: credentials.username }
        }
        const refreshed = await refreshAccessToken(ctx, { refreshToken: credentials.refreshToken, timeoutMs: DEFAULT_TIMEOUT_MS })
        if (!refreshed.ok) {
          const error = new Error(refreshed.detail || '凭据续期失败')
          error.errorCode = refreshed.errorCode
          throw error
        }
        const next = {
          refreshToken: credentials.refreshToken,
          accessToken: refreshed.accessToken,
          accessTokenExpiration: now() + refreshed.expiresIn * 1000,
          username: refreshed.username ?? credentials.username ?? '',
          scopes: credentials.scopes.length ? credentials.scopes : ['resources.admin:*'],
        }
        await writeCredentialsFile(paths.credentials, next)
        log.info('direct_credentials_refreshed')
        return { authorization: `Bearer ${next.accessToken}`, token: next.accessToken, username: next.username || null }
      },
    })
  }

  const basic = await basicAuthFromKaggleJson(paths.kaggleJson)
  if (basic) {
    candidates.push({
      source: 'kaggleJson',
      async describe() {
        return { authorization: basic.authorization, token: null, username: basic.username }
      },
    })
  }

  return candidates
}

/**
 * 带鉴权执行一次 API 调用：按候选顺序重试。
 *
 * 只有「鉴权失败」才切换到下一个凭据（例如过期的 access_token 文件 + 有效的 credentials.json）；
 * 网络错误直接返回，避免用坏网络逐条打满所有凭据。
 */
export async function callWithAuth(ctx, authOptions, call) {
  const candidates = await buildAuthCandidates(ctx, authOptions)
  if (candidates.length === 0) {
    return { ok: false, status: null, json: null, text: '', errorCode: 'auth_required', detail: '未找到可用的 Kaggle 凭据' }
  }
  let lastFailure = null
  for (const candidate of candidates) {
    let auth
    try {
      auth = await candidate.describe()
    } catch (error) {
      lastFailure = {
        ok: false,
        status: null,
        json: null,
        text: '',
        errorCode: error?.errorCode === 'auth_required' ? 'auth_required' : 'unknown',
        detail: logText(error?.detail ?? error?.message ?? error, 200),
      }
      continue
    }
    const result = await call(auth)
    if (result.ok) return result
    if (result.errorCode !== 'auth_required') return result
    lastFailure = result
  }
  return lastFailure ?? { ok: false, status: null, json: null, text: '', errorCode: 'auth_required', detail: '未找到可用的 Kaggle 凭据' }
}

/** 用 refresh_token 换新的 access token（users.AccountService.GenerateAccessToken）。 */
export async function refreshAccessToken(ctx, { refreshToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const result = await kaggleApiRequest(ctx, {
    endpoint: '/v1/users.AccountService/GenerateAccessToken',
    body: {
      refreshToken,
      // ApiVersion.API_VERSION_V1 的枚举序列化值（EnumSerializer：序列化为 .name）
      apiVersion: 'API_VERSION_V1',
      // timedelta(hours=12) 的 TimeDeltaSerializer 序列化值
      expirationDuration: `${DEFAULT_ACCESS_TOKEN_EXPIRATION_SEC}s`,
    },
    timeoutMs,
  })
  if (!result.ok) return { ok: false, errorCode: result.errorCode, detail: result.detail }
  const accessToken = nonEmptyString(result.json?.token)
  if (!accessToken) return { ok: false, errorCode: 'unknown', detail: '续期响应缺少 access_token' }
  const expiresIn = Number(result.json?.expiresIn)
  return {
    ok: true,
    accessToken,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_ACCESS_TOKEN_EXPIRATION_SEC,
    username: nonEmptyString(result.json?.userName),
  }
}

/** 校验 access token 并取用户名（security.OAuthService.IntrospectToken）。 */
export async function introspectAccessToken(ctx, token, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!nonEmptyString(token)) {
    return { ok: false, active: false, username: null, errorCode: 'auth_required', detail: '缺少访问令牌' }
  }
  const result = await kaggleApiRequest(ctx, {
    endpoint: '/v1/security.OAuthService/IntrospectToken',
    body: { token },
    timeoutMs,
  })
  if (!result.ok) return { ok: false, active: false, username: null, errorCode: result.errorCode, detail: result.detail }
  if (result.json?.active !== true) return { ok: false, active: false, username: null, errorCode: 'auth_required', detail: '访问令牌已失效' }
  return { ok: true, active: true, username: nonEmptyString(result.json?.username) }
}
