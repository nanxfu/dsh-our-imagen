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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { TIMEOUTS } from '../shared/contract.js'
import {
  buildAuthCandidates,
  callWithAuth,
  credentialsExpired,
  DEFAULT_TIMEOUT_MS,
  formatCredentialExpiration,
  introspectAccessToken,
  kaggleApiRequest,
  kagglePaths,
  readCredentialsFile,
  refreshAccessToken,
  writeCredentialsFile,
} from './kaggle-client.js'
import { createUsernameCache, finalizeProbeResult, runAuthRetry, simplifyKernelLog } from './kaggle-shared.js'
import { logText } from './redact.js'

export {
  credentialsExpired,
  formatCredentialExpiration,
  introspectAccessToken,
  kaggleApiRequest,
  kagglePaths,
  readCredentialsFile,
  refreshAccessToken,
  simplifyKernelLog,
  writeCredentialsFile,
}

const WEB_ORIGIN = 'https://www.kaggle.com'

const PUSH_TIMEOUT_MS = TIMEOUTS.cliPushMs
const LOGS_TIMEOUT_MS = TIMEOUTS.cliLogsMs
const QUOTA_TIMEOUT_MS = TIMEOUTS.cliQuotaMs

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
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
  const authOptions = {
    paths: kagglePaths(options),
    env: options.env ?? process.env,
    now: options.now ?? Date.now,
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const authTask = runAuthRetry(async () => {
    const last = await callWithAuth(ctx, authOptions, (auth) =>
      kaggleApiRequest(ctx, {
        endpoint: '/v1/kernels.KernelsApiService/ListKernels',
        body: LIST_KERNELS_PROBE_BODY,
        authorization: auth.authorization,
        timeoutMs,
      }),
    )
    if (last.ok) {
      return { done: true, value: { ok: true, checkedAt: new Date().toISOString() } }
    }
    const value = {
      ok: false,
      checkedAt: new Date().toISOString(),
      errorCode: last?.errorCode === 'auth_required' ? 'auth_required' : 'unknown',
      detail: logText(last?.detail ?? '探测失败', 300),
    }
    // 网络错误再重试只会把一次探测拖得更久；记录后直接返回。
    const done = last.errorCode !== 'auth_required' && last.status === null
    return { done, value }
  })

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

  return finalizeProbeResult({
    cli: { present: true, direct: true },
    auth,
    quota,
    username,
    prefixNotes: ['直连模式：Node 直接调用 Kaggle JSON API（试验特性，无需本机 kaggle CLI）'],
    authCredentialNote: AUTH_CREDENTIAL_NOTE,
  })
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

const usernameCache = createUsernameCache()

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
  const cacheKey = authOptions.paths.credentials
  if (!force) {
    const cached = usernameCache.get(cacheKey)
    if (cached) return cached
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
    if (auth.username) return usernameCache.set(auth.username, cacheKey)
    const introspected = await introspectAccessToken(ctx, auth.token, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS })
    if (introspected.ok && introspected.username) {
      return usernameCache.set(introspected.username, cacheKey)
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
