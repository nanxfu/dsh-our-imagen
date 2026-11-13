/**
 * Node 直连 Kaggle JSON API（试验特性，设置项 `kaggleTransport = 'direct'`）。
 *
 * 与 `lib/kaggle.js`（本机 `kaggle` CLI）提供相同的五个出口、相同返回形状：
 * `probeKaggle` / `kaggleUsername` / `pushKernel` / `kernelStatus` / `kernelLogs`，
 * 因此 `SessionManager` 状态机与 `isKernelEnded` 判断不需要任何改动。
 *
 * 协议唯一依据是本机已安装的 `kaggle` 2.2.5 / `kagglesdk` 0.1.38 源码，逐项对照：
 *  - 请求地址：`POST https://api.kaggle.com/v1/<service>/<Method>`
 *    （kagglesdk/kaggle_http_client.py:288-294，生产环境 PROD 端点见 kaggle_env.py:29）
 *  - 请求体：JSON camelCase，`KaggleObject.to_dict()` 省略默认值
 *    （kagglesdk/kaggle_object.py:307-312）
 *  - 认证头：`Authorization: Bearer <access token>` 或 kaggle.json 的 Basic
 *    （kaggle_http_client.py:264-284）
 *  - 错误：HTTP 非 2xx，或 HTTP 200 + body.code >= 400（kaggle_http_client.py:124-134）
 *  - SaveKernel 字段表：kernels/types/kernels_api_service.py:1965 / 2513-2544；
 *    CLI 组装逻辑 kaggle/api/kaggle_api_extended.py:7145-7285（标题/语言/类型校验、notebook 清洗、
 *    machine_shape 覆盖、session_timeout_seconds）
 *  - status：GetKernelSessionStatus（kernels_api_service.py:790/848；CLI 7631-7661）
 *  - logs：ListKernelSessionOutput 的 `log` 字段（kernels_api_service.py:1616；CLI 7680-7710）
 *  - quota：GetAcceleratorQuotaStatistics 空 body `{}`（kernels_api_service.py:511/521；CLI 6747-6796），
 *    实测响应 `{quotaRefreshTime, gpuQuota:{timeUsed:"25480.101s", totalTimeAllowed:"108000s", ...}}`
 *  - 凭据顺序：KAGGLE_API_TOKEN → ~/.kaggle/access_token(.txt)（kaggle_env.py:91-115）→
 *    ~/.kaggle/credentials.json（refresh 续期，kaggle_creds.py:108-136）→ ~/.kaggle/kaggle.json Basic
 *  - OAuth token 交换 / 续期 / 校验：security.OAuthService.ExchangeOAuthToken / IntrospectToken、
 *    users.AccountService.GenerateAccessToken（services/oauth_service.py:22-44、account_service.py:19-31）
 *
 * 安全约束：
 *  - token 只出现在请求头或请求体（续期/自省时的 token 字段），不写日志、不进返回值、不进错误文本；
 *  - 所有对外错误文本经 `logText` 脱敏（Bearer、URL query、长 token、用户目录）；
 *  - 所有 HTTP 走 `lib/net.js` 的 `httpText`（fetch 失败自动 curl 代理兜底）。
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { TIMEOUTS } from '../shared/contract.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'

const log = createLogger({ scope: 'kaggle' })

/** 生产环境 API / 网页端点（kagglesdk/kaggle_env.py:24-31、kaggle_http_client.py:252-253）。 */
const API_ORIGIN = 'https://api.kaggle.com'
const WEB_ORIGIN = 'https://www.kaggle.com'

/**
 * kagglesdk 默认 User-Agent 是 `kaggle-api/v1.7.0`（kaggle_http_client.py:68）。
 * 直连沿用同一标识，避免服务端把来源当成未知客户端。
 */
const USER_AGENT = 'kaggle-api/v1.7.0'

const DEFAULT_TIMEOUT_MS = TIMEOUTS.cliMs
const PUSH_TIMEOUT_MS = TIMEOUTS.cliPushMs
const LOGS_TIMEOUT_MS = TIMEOUTS.cliLogsMs
const QUOTA_TIMEOUT_MS = TIMEOUTS.cliQuotaMs

/** access token 默认有效期 12 小时（kaggle_creds.py:15）。 */
const DEFAULT_ACCESS_TOKEN_EXPIRATION_SEC = 12 * 60 * 60
/** 提前 30 分钟视为过期（kaggle_creds.py:117-120）。 */
const EXPIRY_SKEW_MS = 30 * 60 * 1000
/** 鉴权探测重试退避，与 CLI probe 一致（lib/kaggle.js 的 AUTH_RETRY_DELAYS_MS）。 */
const AUTH_RETRY_DELAYS_MS = [0, 400, 1200]
/** 用户名缓存 10 分钟，与 CLI 实现一致（lib/kaggle.js kaggleUsername）。 */
const USERNAME_CACHE_MS = 10 * 60 * 1000

/** CLI 接受的语言 / 类型（kaggle_api_extended.py:1185-1186）。 */
const VALID_PUSH_LANGUAGES = ['python', 'r', 'rmarkdown']
const VALID_PUSH_KERNEL_TYPES = ['script', 'notebook']

/**
 * 鉴权探测请求体：逐字对照 CLI `kaggle kernels list --page-size 1` 的实际报文
 * （kaggle_api_extended.py:6560-6620 `kernels_list_with_response`，已用 monkeypatch 抓包核对）。
 */
const LIST_KERNELS_PROBE_BODY = {
  competition: '',
  dataset: '',
  parentKernel: '',
  group: 'EVERYONE',
  kernelType: 'all',
  language: 'all',
  outputType: 'all',
  search: '',
  user: '',
  page: 1,
  pageSize: 1,
  pageToken: '',
}

/** 日志摘要：掩掉 token、带 query 的 URL 与用户目录路径，最多 200 字符（与 lib/kaggle.js 同口径）。 */
function logText(value, max = 200) {
  let text = String(value ?? '')
  text = text.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?<redacted>')
  text = text.replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
  text = text.replace(/\b(hf_|KGAT_|ghp_|sk-)[A-Za-z0-9_-]{6,}/g, '$1<redacted>')
  text = text.replace(/\b[0-9a-f]{32,}\b/gi, '<redacted>')
  text = text.replace(/\b(token|secret|password|authorization)\s*[=:]\s*[^\s,;&]+/gi, '$1=<redacted>')
  text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"'<>:]+/g, '<user-home>')
  text = text.replace(/\/(?:Users|home)\/[^/\s"'<>:]+/g, '<user-home>')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function errorType(error) {
  return String(error?.name ?? error?.code ?? (error instanceof Error ? 'Error' : typeof error))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function sleep(ms) {
  return new Promise((ok) => setTimeout(ok, ms))
}

// ---- 凭据路径与读写（供直连客户端与 OAuth 登录管理器共用） ----------------

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
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
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
  const temp = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temp, filePath)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  await chmod(filePath, 0o600).catch(() => {})
  return data
}

// ---- HTTP 调用 ----------------------------------------------------------

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

// ---- 鉴权：候选顺序 + 惰性解析 ------------------------------------------

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
async function buildAuthCandidates(ctx, { paths, env = process.env, now = Date.now } = {}) {
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
async function callWithAuth(ctx, authOptions, call) {
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

// ---- 五出口：probe / username / push / status / logs --------------------

/**
 * 环境探测（直连版）：与 `lib/kaggle.js probeKaggle` 同形状。
 *
 * `cli` 固定返回 `{ present: true, direct: true }`：直连模式不需要本机安装 kaggle CLI，
 * 客户端据此不出 `cli_missing` 指引卡。
 *
 * @param {object} ctx
 * @param {{ homeDir?: string, credentialsPath?: string | null, env?: object, now?: () => number,
 *           timeoutMs?: number }} [options]
 */
export async function probeKaggle(ctx, options = {}) {
  const notes = []
  const authOptions = {
    paths: kagglePaths(options),
    env: options.env ?? process.env,
    now: options.now ?? Date.now,
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  notes.push('直连模式：Node 直接调用 Kaggle JSON API（试验特性，无需本机 kaggle CLI）')

  const authTask = (async () => {
    let last = null
    for (const delay of AUTH_RETRY_DELAYS_MS) {
      if (delay) await sleep(delay)
      last = await callWithAuth(ctx, authOptions, (auth) =>
        kaggleApiRequest(ctx, {
          endpoint: '/v1/kernels.KernelsApiService/ListKernels',
          body: LIST_KERNELS_PROBE_BODY,
          authorization: auth.authorization,
          timeoutMs,
        }),
      )
      if (last.ok) {
        return { ok: true, checkedAt: new Date().toISOString() }
      }
      // 网络错误再重试只会把一次探测拖得更久；记录后直接返回。
      if (last.errorCode !== 'auth_required' && last.status === null) break
    }
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      errorCode: last?.errorCode === 'auth_required' ? 'auth_required' : 'unknown',
      detail: logText(last?.detail ?? '探测失败', 300),
    }
  })()

  const quotaTask = (async () => {
    const result = await callWithAuth(ctx, authOptions, (auth) =>
      kaggleApiRequest(ctx, {
        endpoint: '/v1/kernels.KernelsApiService/GetAcceleratorQuotaStatistics',
        body: {},
        authorization: auth.authorization,
        timeoutMs: options.quotaTimeoutMs ?? QUOTA_TIMEOUT_MS,
      }),
    )
    return result.ok ? mapQuota(result.json) : { available: false, raw: '' }
  })()

  const usernameTask = kaggleUsername(ctx, { ...options, authOptions }).catch(() => null)

  const [auth, quota, username] = await Promise.all([authTask, quotaTask, usernameTask])

  notes.push(auth.ok ? '账号接入正常' : `账号接入失败：${auth.errorCode}`)
  if (!auth.ok && auth.errorCode === 'auth_required') notes.push(AUTH_CREDENTIAL_NOTE)
  if (!quota.available) notes.push('配额接口不可用，该项降级显示')

  const cli = { present: true, direct: true }
  if (username) cli.username = username
  return { provider: 'kaggle', cli, auth, quota, notes }
}

/**
 * 凭据缺失/失效说明（直连口径）。
 *
 * 三口径与 `lib/kaggle.js AUTH_CREDENTIAL_NOTE` 保持一致：内置 OAuth 登录（写入 credentials.json）、
 * 网页端 API Token（access_token）、旧版 kaggle.json。文案不含任何 token 值。
 */
const AUTH_CREDENTIAL_NOTE =
  '未找到可用的 Kaggle 凭据：直连模式可在工作台点「在浏览器中登录 Kaggle」完成授权（凭据写入 ' +
  '%USERPROFILE%\\.kaggle\\credentials.json，含 refresh_token 可自动续期）；' +
  '也可在 https://www.kaggle.com/settings 生成 API Token 保存为 %USERPROFILE%\\.kaggle\\access_token；' +
  '旧版 kaggle.json 仍兼容'

/**
 * timedelta 的 JSON 序列化值转秒数。
 *
 * 服务端格式为 `<seconds>.<nanos>s`（kagglesdk TimeDeltaSerializer，v0.1.38 实测
 * `timeUsed: "25480.101s"`），也兼容纯整数秒与省略 `s` 的写法。
 *
 * @param {unknown} value
 * @returns {number | null} 秒数；无法解析返回 null
 */
export function parseTimeDeltaSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(-?\d+)(?:\.(\d+))?s?$/)
  if (!match) return null
  const fraction = match[2] ? Number(`0.${match[2]}`) : 0
  return Number(match[1]) + fraction
}

function roundHours(hours) {
  return Math.round(hours * 100) / 100
}

/**
 * quota 响应映射为 `lib/kaggle.js` 的 `{available, usedHours, remainingHours, totalHours, refreshAt, raw}`。
 *
 * 字段来源：ApiGetAcceleratorQuotaStatisticsResponse（kernels_api_service.py:521-586）
 *  → quotaRefreshTime / gpuQuota{timeUsed, timeReserved, totalTimeAllowed}。
 */
export function mapQuota(response) {
  const gpu = isPlainObject(response?.gpuQuota) ? response.gpuQuota : null
  if (!gpu) return { available: false, raw: '' }
  const usedSec = parseTimeDeltaSeconds(gpu.timeUsed)
  const totalSec = parseTimeDeltaSeconds(gpu.totalTimeAllowed)
  if (usedSec === null || totalSec === null) return { available: false, raw: '' }
  const usedHours = roundHours(usedSec / 3600)
  const totalHours = roundHours(totalSec / 3600)
  const remainingHours = roundHours(Math.max(0, totalSec - usedSec) / 3600)
  const refreshAt = normalizeDateTime(response?.quotaRefreshTime)
  return {
    available: true,
    usedHours,
    remainingHours,
    totalHours,
    refreshAt,
    raw: `GPU 已用 ${usedHours}h / 剩余 ${remainingHours}h / 每周配额 ${totalHours}h${refreshAt ? `（${refreshAt} 重置）` : ''}`,
  }
}

/** 服务端 DateTime 形如 `2026-11-14T00:00:00Z`（DateTimeSerializer）；能解析就返回 ISO，否则原样保留。 */
function normalizeDateTime(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value.trim()
}

let usernameCache = { key: null, value: null, at: 0 }

/**
 * 读取当前凭据里的 Kaggle 用户名（kernel id 前缀）。
 *
 * 顺序：credentials.json / kaggle.json 里的 username → 对 access token 调 IntrospectToken
 * （kaggle_api_extended.py:1604-1617）。结果缓存 10 分钟，与 CLI 实现一致；
 * 缓存按凭据文件路径区分，切换 HOME / 测试注入时不会串号。
 *
 * @param {object} ctx
 * @param {{ force?: boolean, homeDir?: string, credentialsPath?: string | null, env?: object,
 *           now?: () => number, timeoutMs?: number, authOptions?: object }} [options]
 */
export async function kaggleUsername(ctx, { force = false, authOptions: injectedAuth, ...options } = {}) {
  const authOptions = injectedAuth ?? {
    paths: kagglePaths(options),
    env: options.env ?? process.env,
    now: options.now ?? Date.now,
  }
  if (!force && usernameCache.value && usernameCache.key === authOptions.paths.credentials && Date.now() - usernameCache.at < USERNAME_CACHE_MS) {
    return usernameCache.value
  }
  const candidates = await buildAuthCandidates(ctx, authOptions)
  let lastDetail = '未找到可用的 Kaggle 凭据'
  for (const candidate of candidates) {
    let auth
    try {
      auth = await candidate.describe()
    } catch (error) {
      lastDetail = logText(error?.detail ?? error?.message ?? error, 200)
      continue
    }
    if (auth.username) {
      usernameCache = { key: authOptions.paths.credentials, value: auth.username, at: Date.now() }
      return auth.username
    }
    const introspected = await introspectAccessToken(ctx, auth.token, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
    if (introspected.ok && introspected.username) {
      usernameCache = { key: authOptions.paths.credentials, value: introspected.username, at: Date.now() }
      return introspected.username
    }
    lastDetail = introspected.detail ?? '访问令牌校验失败'
  }
  throw new Error(`读取 Kaggle 用户名失败：${lastDetail}`)
}

/** kernel id 拆分：`owner/slug` 或 `owner/slug/version`（kaggle_api_extended.py:9858-9880）。 */
function parseKernelId(kernelId) {
  const text = nonEmptyString(kernelId)
  if (!text) throw new Error('kernelId 不能为空')
  const parts = text.split('/')
  if (parts.length < 2 || parts.some((part) => !part.trim())) {
    throw new Error('kernelId 必须是 owner/slug 或 owner/slug/version')
  }
  return { owner: parts[0], slug: parts[1], version: parts[2] ?? null }
}

/** 版本号归一为 API 的 `v<N>`（kaggle_api_extended.py:9882-9890）。 */
function versionLabelOf(version) {
  if (!version) return null
  return /^\d+$/.test(version) ? `v${version}` : version
}

function readBool(meta, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(meta, key)) return fallback
  const value = meta[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  throw new Error(`kernel-metadata.json 的 ${key} 不是合法布尔值`)
}

function stringList(meta, key) {
  const value = meta?.[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`kernel-metadata.json 的 ${key} 必须是字符串数组`)
  return value.filter((item) => typeof item === 'string')
}

/** notebook 类型清洗：清空 code cell 的 outputs、把 source 数组拼成字符串（kaggle_api_extended.py:7245-7255）。 */
function normalizeNotebookText(scriptBody) {
  let notebook
  try {
    notebook = JSON.parse(scriptBody)
  } catch {
    throw new Error('kernel_type 为 notebook 时 code_file 必须是合法 ipynb JSON')
  }
  if (isPlainObject(notebook) && Array.isArray(notebook.cells)) {
    for (const cell of notebook.cells) {
      if (!isPlainObject(cell)) continue
      if (cell.cell_type === 'code' && Object.prototype.hasOwnProperty.call(cell, 'outputs')) cell.outputs = []
      if (Array.isArray(cell.source)) cell.source = cell.source.join('')
    }
  }
  return JSON.stringify(notebook)
}

/**
 * 组装 SaveKernel 请求体（字段对照 kaggle_api_extended.py:7257-7284）。
 *
 * @param {object} meta kernel-metadata.json 内容
 * @param {string} scriptBody code_file 文本（notebook 已清洗）
 * @param {{ accelerator?: string | null, timeoutSec?: number | null, noRun?: boolean }} options
 */
export function buildSaveKernelBody(meta, scriptBody, options = {}) {
  const body = {
    slug: nonEmptyString(meta.id) ?? undefined,
    newTitle: nonEmptyString(meta.title) ?? undefined,
    text: scriptBody,
    language: meta.language,
    kernelType: meta.kernel_type,
    isPrivate: readBool(meta, 'is_private', true),
    enableGpu: readBool(meta, 'enable_gpu', false),
    enableTpu: readBool(meta, 'enable_tpu', false),
    enableInternet: readBool(meta, 'enable_internet', true),
    datasetDataSources: stringList(meta, 'dataset_sources'),
    competitionDataSources: stringList(meta, 'competition_sources'),
    kernelDataSources: stringList(meta, 'kernel_sources'),
    modelDataSources: stringList(meta, 'model_sources'),
    categoryIds: stringList(meta, 'keywords'),
  }
  if (meta.id_no !== undefined && meta.id_no !== null) body.id = Number(meta.id_no)
  if (nonEmptyString(meta.docker_image_pinning_type)) body.dockerImagePinningType = meta.docker_image_pinning_type.trim()
  if (nonEmptyString(meta.docker_image)) body.dockerImage = meta.docker_image.trim()
  if (nonEmptyString(options.accelerator) || nonEmptyString(meta.machine_shape)) {
    body.machineShape = nonEmptyString(options.accelerator) ?? meta.machine_shape.trim()
  }
  if (Number.isFinite(Number(options.timeoutSec)) && Number(options.timeoutSec) > 0) {
    body.sessionTimeoutSeconds = Math.round(Number(options.timeoutSec))
  }
  if (options.noRun === true) body.kernelExecutionType = 'QUICK_SAVE'
  // 与 KaggleObject.to_dict(ignore_defaults=True) 同口径：省略 undefined 与空数组。
  return pruneDefaults(body)
}

/** 去掉 undefined 与空数组（服务端把这些字段视为默认值）。 */
function pruneDefaults(value) {
  const output = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    if (Array.isArray(item) && item.length === 0) continue
    output[key] = item
  }
  return output
}

/**
 * 推送 kernel 并触发运行（与 `lib/kaggle.js pushKernel` 同形状）。
 *
 * @param {object} ctx
 * @param {string} folder 含 kernel-metadata.json 的目录
 * @param {{ accelerator?: string | null, timeoutSec?: number | null, noRun?: boolean,
 *           homeDir?: string, credentialsPath?: string | null, env?: object }} [options]
 * @returns {Promise<{ ok: boolean, code: number | string, url: string | null,
 *   authFailed: boolean, output: string }>}
 */
export async function pushKernel(ctx, folder, options = {}) {
  const pushFailed = (output, extra = {}) => ({ ok: false, code: extra.code ?? 0, url: null, authFailed: extra.authFailed === true, output: logText(output, 1200) })

  let metaText
  try {
    metaText = await readFile(join(String(folder), 'kernel-metadata.json'), 'utf8')
  } catch {
    return pushFailed(`读取 kernel-metadata.json 失败：目录 ${folder} 下没有可读的元数据文件`)
  }
  let meta
  try {
    meta = JSON.parse(metaText)
  } catch {
    return pushFailed('kernel-metadata.json 不是合法 JSON')
  }
  if (!isPlainObject(meta)) return pushFailed('kernel-metadata.json 必须是 JSON 对象')

  try {
    if (nonEmptyString(meta.title) && meta.title.trim().length < 5) throw new Error('title 至少需要 5 个字符')
    if (!nonEmptyString(meta.code_file)) throw new Error('缺少 code_file')
    const language = nonEmptyString(meta.language)
    if (!VALID_PUSH_LANGUAGES.includes(language)) {
      throw new Error(`language 必须是 ${VALID_PUSH_LANGUAGES.join(' / ')} 之一`)
    }
    const kernelType = nonEmptyString(meta.kernel_type)
    if (!VALID_PUSH_KERNEL_TYPES.includes(kernelType)) {
      throw new Error(`kernel_type 必须是 ${VALID_PUSH_KERNEL_TYPES.join(' / ')} 之一`)
    }
    const slug = nonEmptyString(meta.id)
    if (!slug && (meta.id_no === undefined || meta.id_no === null)) throw new Error('id 或 id_no 至少需要一个')
    if (slug) {
      const parsed = parseKernelId(slug)
      if (parsed.version) throw new Error("kernel-metadata.json 的 id 不能带版本号")
    }

    let scriptBody = await readFile(join(String(folder), meta.code_file.trim()), 'utf8')
    if (kernelType === 'notebook') scriptBody = normalizeNotebookText(scriptBody)
    const body = buildSaveKernelBody(
      { ...meta, language: kernelType === 'notebook' && language === 'rmarkdown' ? 'r' : language, kernel_type: kernelType },
      scriptBody,
      options,
    )

    const result = await callWithAuth(
      ctx,
      { paths: kagglePaths(options), env: options.env ?? process.env, now: options.now ?? Date.now },
      (auth) =>
        kaggleApiRequest(ctx, {
          endpoint: '/v1/kernels.KernelsApiService/SaveKernel',
          body,
          authorization: auth.authorization,
          timeoutMs: options.timeoutMs ?? PUSH_TIMEOUT_MS,
          // 响应只是推送结果；留足 512KB 应对服务端附带的长错误说明。
          maxBytes: 512 * 1024,
        }),
    )

    if (!result.ok) {
      return {
        ok: false,
        code: result.status ?? 0,
        url: null,
        authFailed: result.errorCode === 'auth_required',
        output: logText(`Kernel push error: ${result.detail || '未知错误'}`, 1200),
      }
    }
    const json = isPlainObject(result.json) ? result.json : {}
    const errorText = nonEmptyString(json.error)
    if (errorText) {
      return { ok: false, code: result.status ?? 0, url: null, authFailed: false, output: logText(`Kernel push error: ${errorText}`, 1200) }
    }
    const url = nonEmptyString(json.url) ?? (nonEmptyString(json.ref) ? `${WEB_ORIGIN}/code/${json.ref}` : null)
    const version = json.versionNumber ? `版本 ${json.versionNumber} ` : ''
    const invalid = [
      ['invalidTags', '标签'],
      ['invalidDatasetSources', 'Dataset 来源'],
      ['invalidCompetitionSources', '竞赛来源'],
      ['invalidKernelSources', 'Kernel 来源'],
      ['invalidModelSources', '模型来源'],
    ]
      .filter(([key]) => Array.isArray(json[key]) && json[key].length > 0)
      .map(([key, label]) => `${label}无效：${json[key].join(', ')}`)
    const output = [`Kernel ${version}已推送${url ? `：${url}` : ''}`, ...invalid].join('\n')
    return { ok: true, code: result.status ?? 200, url, authFailed: false, output: logText(output, 1200) }
  } catch (error) {
    return pushFailed(`Kernel 推送准备失败：${error?.message ?? error}`)
  }
}

/**
 * 查询 kernel 运行状态（与 `lib/kaggle.js kernelStatus` 同形状）。
 *
 * status 直接返回 enum name（`QUEUED` / `RUNNING` / `COMPLETE` / `ERROR` / ...），
 * `SessionManager` 的 `isKernelEnded` 语义不变。
 *
 * @param {object} ctx
 * @param {string} kernelId `owner/slug` 或 `owner/slug/version`
 * @param {{ homeDir?: string, credentialsPath?: string | null, env?: object }} [options]
 * @returns {Promise<{ ok: boolean, status: string | null, output: string }>}
 */
export async function kernelStatus(ctx, kernelId, options = {}) {
  try {
    const parsed = parseKernelId(kernelId)
    const body = { userName: parsed.owner, kernelSlug: parsed.slug }
    const versionLabel = versionLabelOf(parsed.version)
    if (versionLabel) body.versionLabel = versionLabel
    const result = await callWithAuth(
      ctx,
      { paths: kagglePaths(options), env: options.env ?? process.env, now: options.now ?? Date.now },
      (auth) =>
        kaggleApiRequest(ctx, {
          endpoint: '/v1/kernels.KernelsApiService/GetKernelSessionStatus',
          body,
          authorization: auth.authorization,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
    )
    if (!result.ok) return { ok: false, status: null, output: logText(result.detail, 400) }
    const status = nonEmptyString(result.json?.status)
    const failureMessage = nonEmptyString(result.json?.failureMessage)
    return {
      ok: true,
      status,
      output: logText([status, failureMessage].filter(Boolean).join(' / '), 400),
    }
  } catch (error) {
    return { ok: false, status: null, output: logText(error?.message ?? error, 400) }
  }
}

/** 与 CLI `kernels logs` 相同的噪音过滤（lib/kaggle.js SIMPLIFY_KERNEL_LOG）。 */
const LOG_NOISE = /NbConvertApp|SyntaxWarning|Converting notebook|Writing \d+ bytes|nbconvert|deprecat/i

/**
 * 清洗 kernel 日志：兼容 JSON 事件流（旧格式）与纯文本（ListKernelSessionOutput.log），
 * 丢掉 notebook 转换噪音，只留最后 40 行。
 */
export function simplifyKernelLog(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  const chunks = []
  let parsed = false
  for (const line of lines) {
    const cleaned = line.trim().replace(/^,?\[?/, '').replace(/\]$/, '')
    if (!cleaned) continue
    try {
      const entry = JSON.parse(cleaned)
      if (entry && typeof entry.data === 'string') {
        chunks.push(entry.data)
        parsed = true
        continue
      }
    } catch {}
    chunks.push(`${line}\n`)
  }
  const text = parsed ? chunks.join('') : String(raw ?? '')
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !LOG_NOISE.test(line))
    .slice(-40)
    .join('\n')
}

/**
 * 拉取 kernel 日志尾部（与 `lib/kaggle.js kernelLogs` 同形状）。
 *
 * 数据源是 ListKernelSessionOutput 的 `log` 字段（kaggle_api_extended.py:7680-7710）。
 *
 * @param {object} ctx
 * @param {string} kernelId
 * @param {{ homeDir?: string, credentialsPath?: string | null, env?: object }} [options]
 * @returns {Promise<{ ok: boolean, tail: string }>}
 */
export async function kernelLogs(ctx, kernelId, options = {}) {
  try {
    const parsed = parseKernelId(kernelId)
    const body = { userName: parsed.owner, kernelSlug: parsed.slug }
    const versionLabel = versionLabelOf(parsed.version)
    if (versionLabel) body.versionLabel = versionLabel
    const result = await callWithAuth(
      ctx,
      { paths: kagglePaths(options), env: options.env ?? process.env, now: options.now ?? Date.now },
      (auth) =>
        kaggleApiRequest(ctx, {
          endpoint: '/v1/kernels.KernelsApiService/ListKernelSessionOutput',
          body,
          authorization: auth.authorization,
          timeoutMs: options.timeoutMs ?? LOGS_TIMEOUT_MS,
          maxBytes: 1024 * 1024,
        }),
    )
    if (!result.ok) return { ok: false, tail: '' }
    return { ok: true, tail: simplifyKernelLog(result.json?.log ?? '').slice(-2000) }
  } catch {
    return { ok: false, tail: '' }
  }
}
