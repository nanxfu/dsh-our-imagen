/**
 * 宿主日志端口 + 本地滚动日志文件。
 *
 * 两路输出彼此解耦：
 *  - 控制台：仍由 `OUR_FREE_IMAGEN_LOG=debug|info|warn|error` 或调用方注入的 `sink` 决定
 *    （保持原有行为，默认不刷宿主终端）；
 *  - 文件：`installFileLog(ctx)` 安装后进程级生效，写到 `<workspace>/.imagen/logs/host.log`，
 *    默认记录 info/warn/error（debug 不落盘），单文件 2 MiB 轮转、最多保留 1 个归档。
 *
 * 安全约束：文件出口统一经过 redactLogText；结构化对象里的 prompt / negativePrompt 只记录
 * 字符数（promptLen / negativePromptLen），不落正文。调用方不得把 auth token、带 query 的
 * 完整 endpoint 或提示词正文当字符串直接写日志。
 *
 * 非阻塞：写入先进入内存队列，由后台异步 append 串行消费；任何 IO 错误静默降级，
 * 不阻塞也不抛给调用方，控制台/内存 sink 不受影响。
 */

import { appendFile, chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

const FILE_LEVEL_DEFAULT = 'info'
const FILE_MAX_BYTES_DEFAULT = 2 * 1024 * 1024
const FILE_MAX_FILES_DEFAULT = 1
const FILE_MAX_FILES_LIMIT = 5
const FILE_MAX_BYTES_LIMIT = 64 * 1024 * 1024
const HOST_LOG_SEGMENTS = ['.imagen', 'logs', 'host.log']
const READ_ARCHIVE_SCAN = 5
const READ_LIMIT_MAX = 5000
const MAX_PERSISTED_LINE_CHARS = 8192
const MAX_IO_FAILURES = 3
const REDACTED = '[REDACTED]'

// ---- 脱敏 ---------------------------------------------------------------

/** 敏感键名（大小写不敏感、兼容 camelCase / snake_case / kebab-case）。 */
const SECRET_FIELD_PATTERN =
  '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|authorization|api[_-]?key|apikey|hf[_-]?token|credential)'

const PROMPT_FIELD_RE = /"(negativePrompt|negative_prompt|prompt)"\s*:\s*"((?:[^"\\]|\\.)*)"/g

const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

const JSON_SECRET_FIELD_RE = new RegExp(`("${SECRET_FIELD_PATTERN}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi')

const SINGLE_QUOTED_SECRET_RE = new RegExp(`('${SECRET_FIELD_PATTERN}'\\s*:\\s*)'[^']*'`, 'gi')

/** URL query 里的敏感参数值（token / sig / code 等）。 */
const URL_SECRET_QUERY_RE = new RegExp(
  `([?&](?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|key|secret|password|passwd|sig|signature|auth|authorization|credential|code)=)(?!\\[REDACTED\\])[^&#\\s]+`,
  'gi',
)

/** `token=xxx` / `secret: xxx` / `apiKey=xxx` 这类键值形式（含引号值）。 */
const KEY_VALUE_SECRET_RE = new RegExp(
  `(\\b${SECRET_FIELD_PATTERN}\\b\\s*[=:]\\s*)(?!\\[REDACTED\\])(?:"[^"]*"|'[^']*'|[^\\s,;&"')\\]}]+)`,
  'gi',
)

/** 常见密钥前缀：hf_xxx / KGAT_xxx / ghp_xxx / sk-xxx / github_pat_xxx / xox?-xxx。 */
const PREFIX_SECRET_RE =
  /\b(?:hf|kgat|ghp|gho|ghs|ghu|github_pat|xox[abprs])[_-][A-Za-z0-9_-]{6,}|\bsk-[A-Za-z0-9_-]{6,}/gi

/** JSON 字符串字面量（含转义序列）解码后的字符数；解码失败退回原文长度。 */
function jsonStringLength(literal) {
  try {
    return JSON.parse(`"${literal}"`).length
  } catch {
    return literal.length
  }
}

/** 结构化对象里的 prompt / negativePrompt 只保留长度，避免把提示词正文落盘。 */
function maskPromptFields(text) {
  return text.replace(PROMPT_FIELD_RE, (_matched, key, literal) => {
    const field = key.toLowerCase().startsWith('negative') ? 'negativePromptLen' : 'promptLen'
    return `"${field}":${jsonStringLength(literal)}`
  })
}

/**
 * 统一脱敏过滤器（纯函数，可重复调用）。
 *
 * 处理：Bearer Token、token/secret/password/authorization/api key 等键值、
 * hf_/KGAT_/ghp_/sk- 等密钥前缀、URL 敏感 query 参数、结构化 prompt 字段。
 *
 * @param {unknown} text
 * @returns {string}
 */
export function redactLogText(text) {
  const source =
    typeof text === 'string' ? text : text === null || text === undefined ? '' : String(text)
  let output = source
  output = maskPromptFields(output)
  output = output.replace(BEARER_RE, `Bearer ${REDACTED}`)
  output = output.replace(JSON_SECRET_FIELD_RE, `$1"${REDACTED}"`)
  output = output.replace(SINGLE_QUOTED_SECRET_RE, `$1'${REDACTED}'`)
  output = output.replace(URL_SECRET_QUERY_RE, `$1${REDACTED}`)
  output = output.replace(KEY_VALUE_SECRET_RE, `$1${REDACTED}`)
  output = output.replace(PREFIX_SECRET_RE, REDACTED)
  return output
}

// ---- 控制台 logger ------------------------------------------------------

/** 环境变量决定的最小输出级别；未设置或值非法时返回空串（即默认不输出 console）。 */
function envLevel() {
  const raw = String(process.env.OUR_FREE_IMAGEN_LOG ?? '').trim().toLowerCase()
  return LEVELS[raw] ? raw : ''
}

/**
 * @param {{ scope?: string, level?: string, sink?: object }} [options]
 *   level：显式指定控制台最小级别；未指定时，注入了 sink 默认 debug，否则取环境变量，都没有则不输出。
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(options = {}) {
  const scope = typeof options.scope === 'string' ? options.scope : ''
  const level = options.level ?? (options.sink ? 'debug' : envLevel())
  const consoleEnabled = Boolean(LEVELS[level])
  const sink = options.sink ?? console
  const prefix = scope ? `[imagen:${scope}]` : '[imagen]'
  const emit = (name) => (...args) => {
    if (consoleEnabled && LEVELS[name] >= LEVELS[level]) {
      const write = typeof sink?.[name] === 'function' ? sink[name] : sink?.log
      if (typeof write === 'function') write.call(sink, prefix, ...args)
    }
    // 文件 sink 的级别独立于控制台，安装状态在写入时查询（模块级 logger 早于安装也能落盘）。
    appendHostLog(name, scope, args)
  }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}

// ---- 本地文件日志 -------------------------------------------------------

/** 当前进程安装的文件 sink；null 表示未安装或已卸载。 */
let activeFileLog = null

/** 工作区根目录：只认 DSH 注入的 workingDirectory，取不到返回 null（不回退 process.cwd()）。 */
function workspaceDirectory(ctx) {
  try {
    const service = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : null
    const directory = service?.defaultDirectory
    if (typeof directory !== 'string') return null
    const trimmed = directory.trim()
    if (!trimmed || trimmed.includes('\0') || !isAbsolute(trimmed)) return null
    return resolve(trimmed)
  } catch {
    return null
  }
}

/**
 * 本地 Host 日志绝对路径：`<workspace>/.imagen/logs/host.log`。
 * 无工作区上下文（或上下文取不到）时返回 null。
 *
 * @param {object} ctx
 * @returns {string | null}
 */
export function hostLogPath(ctx) {
  const workspace = workspaceDirectory(ctx)
  return workspace ? join(workspace, ...HOST_LOG_SEGMENTS) : null
}

function normalizeFileLevel(value) {
  if (value === false || value === null) return 'off'
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'off' || raw === 'none' || raw === 'silent' || raw === 'disabled') return 'off'
  return LEVELS[raw] ? raw : FILE_LEVEL_DEFAULT
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

/** 单条参数 → 文本；对象按 JSON 序列化，供后续统一脱敏。 */
function serializeArg(value) {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'object') {
    if (value instanceof Error) return `${value.name}: ${value.message}`
    try {
      const text = JSON.stringify(value)
      return typeof text === 'string' ? text : String(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function truncateLine(text) {
  return text.length <= MAX_PERSISTED_LINE_CHARS ? text : `${text.slice(0, MAX_PERSISTED_LINE_CHARS)}…(truncated)`
}

/** 一次调用 → 若干行 `[ISO] [level] [scope] message`（消息内换行拆成独立行）。 */
function formatPersistedLines(level, scope, args) {
  const stamp = new Date().toISOString()
  const safeScope = String(scope).replace(/[\r\n\[\]]/g, '')
  const prefix = `[${stamp}] [${level}]${safeScope ? ` [${safeScope}]` : ''} `
  const body = args.map(serializeArg).join(' ').replace(/\r\n/g, '\n')
  return body.split('\n').map((row) => prefix + truncateLine(redactLogText(row)))
}

function createFileTarget(ctx, options = {}) {
  const filePath = hostLogPath(ctx)
  const levelName = normalizeFileLevel(options.level)
  const enabled = Boolean(filePath) && levelName !== 'off' && options.enabled !== false
  return {
    filePath,
    enabled,
    level: LEVELS[levelName] ?? LEVELS[FILE_LEVEL_DEFAULT],
    maxBytes: clampInteger(options.maxBytes, FILE_MAX_BYTES_DEFAULT, 1, FILE_MAX_BYTES_LIMIT),
    maxFiles: clampInteger(options.maxFiles, FILE_MAX_FILES_DEFAULT, 0, FILE_MAX_FILES_LIMIT),
    pending: [],
    running: null,
    scheduled: null,
    ensurePromise: null,
    fileBytes: 0,
    ready: false,
    broken: false,
    disposed: false,
    ioFailures: 0,
  }
}

/** 日志调用入口：入队后立即返回，实际写盘由后台队列串行完成。 */
function appendHostLog(level, scope, args) {
  const target = activeFileLog
  if (!target || !target.enabled || target.disposed) return
  if (LEVELS[level] < target.level) return
  let lines
  try {
    lines = formatPersistedLines(level, scope, args)
  } catch {
    return
  }
  if (lines.length === 0) return
  target.pending.push(...lines)
  scheduleDrain(target)
}

function scheduleDrain(target) {
  if (target.running || target.scheduled) return
  target.scheduled = setImmediate(() => {
    target.scheduled = null
    void startDrain(target)
  })
}

async function ensureTargetReady(target) {
  if (target.ready) return
  if (!target.ensurePromise) {
    target.ensurePromise = (async () => {
      const directory = dirname(target.filePath)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      try {
        await chmod(directory, 0o700)
      } catch {}
      let size = 0
      try {
        const info = await stat(target.filePath)
        if (!info.isFile()) throw new Error('host.log 不是普通文件')
        size = info.size
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        size = 0
      }
      try {
        if (size > 0) await chmod(target.filePath, 0o600)
      } catch {}
      target.fileBytes = size
      target.ready = true
    })()
  }
  return target.ensurePromise
}

/** 轮转：host.log → host.log.1 → … → host.log.N，最多保留 maxFiles 个归档。 */
async function rotate(target) {
  if (target.maxFiles <= 0) {
    await rm(target.filePath, { force: true }).catch(() => {})
    target.fileBytes = 0
    return
  }
  for (let index = target.maxFiles - 1; index >= 1; index -= 1) {
    await rm(`${target.filePath}.${index + 1}`, { force: true }).catch(() => {})
    await rename(`${target.filePath}.${index}`, `${target.filePath}.${index + 1}`).catch(() => {})
  }
  await rm(`${target.filePath}.1`, { force: true }).catch(() => {})
  let archived = false
  try {
    await rename(target.filePath, `${target.filePath}.1`)
    archived = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  target.fileBytes = 0
  if (archived) {
    try {
      await chmod(`${target.filePath}.1`, 0o600)
    } catch {}
  }
}

/** 追加一批日志行；逐行检查体积上限，必要时先轮转再写。 */
async function writeLines(target, lines) {
  let chunk = []
  let chunkBytes = 0
  const appendChunk = async () => {
    if (chunk.length === 0) return
    const data = `${chunk.join('\n')}\n`
    await appendFile(target.filePath, data, { mode: 0o600 })
    target.fileBytes += chunkBytes
    chunk = []
    chunkBytes = 0
  }
  for (const line of lines) {
    const bytes = Buffer.byteLength(line, 'utf8') + 1
    // chunkBytes 也要计入，否则同一批写入会绕过轮转检查。
    const committed = target.fileBytes + chunkBytes
    if (committed > 0 && committed + bytes > target.maxBytes) {
      await appendChunk()
      await rotate(target)
    }
    chunk.push(line)
    chunkBytes += bytes
  }
  await appendChunk()
}

/** 串行消费队列；任何 IO 错误都静默降级，连续失败后停用文件 sink。 */
function startDrain(target) {
  if (target.running) return target.running
  if (target.pending.length === 0) return Promise.resolve()
  target.running = (async () => {
    try {
      if (!target.enabled || target.broken) {
        target.pending.length = 0
        return
      }
      await ensureTargetReady(target)
      while (target.pending.length > 0) {
        const batch = target.pending.splice(0)
        try {
          await writeLines(target, batch)
          target.ioFailures = 0
        } catch {
          target.ioFailures += 1
          if (target.ioFailures >= MAX_IO_FAILURES) {
            target.broken = true
            target.pending.length = 0
          }
        }
      }
    } catch {
      target.broken = true
      target.pending.length = 0
    } finally {
      target.running = null
    }
  })()
  return target.running
}

async function flushTarget(target) {
  try {
    for (let attempt = 0; attempt < 512; attempt += 1) {
      if (target.pending.length === 0 && !target.running) return
      if (!target.running) startDrain(target)
      await target.running
    }
  } catch {}
}

/**
 * 等待文件写入队列清空；从未安装、已卸载或 IO 失败时都安静返回，永不抛异常。
 *
 * @returns {Promise<void>}
 */
export async function flushHostLog() {
  try {
    await flushTarget(activeFileLog)
  } catch {}
}

/**
 * 安装进程级文件 sink；重复调用会替换旧目标（旧目标尽力 flush 后停用）。
 *
 * @param {object} ctx DSH 上下文（用于取 workingDirectory）
 * @param {{ level?: string | false, maxBytes?: number, maxFiles?: number, enabled?: boolean }} [options]
 * @returns {{ flush: () => Promise<void>, dispose: () => Promise<void> }}
 */
export function installFileLog(ctx, options = {}) {
  const previous = activeFileLog
  const target = createFileTarget(ctx, options)
  activeFileLog = target
  if (previous && previous !== target) {
    previous.disposed = true
    void flushTarget(previous)
  }
  return {
    flush: () => flushTarget(target),
    dispose: () => disposeTarget(target),
  }
}

async function disposeTarget(target) {
  target.disposed = true
  if (activeFileLog === target) activeFileLog = null
  await flushTarget(target)
}

async function readTextFile(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

// ---- 诊断环境指纹 -------------------------------------------------------

/** 代理相关环境变量（大写与小写变体都算）；只看「有没有配置」，不留值。 */
const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0
}

/** 进程平台与 Node 版本：读取本身也可能抛错（极端宿主），失败回退空串。 */
function processInfo() {
  try {
    const platform = typeof process?.platform === 'string' ? process.platform : ''
    const nodeVersion = process?.versions?.node ? String(process.versions.node) : ''
    return { platform, nodeVersion }
  } catch {
    return { platform: '', nodeVersion: '' }
  }
}

/** 时间值（ISO 字符串 / 毫秒数 / Date）→ 毫秒时间戳；无法解析返回 null。 */
function timeOf(value) {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const time = Date.parse(String(value ?? ''))
  return Number.isFinite(time) ? time : null
}

/** 两段时间之间的毫秒差；任一端缺失返回 null，时钟回拨按 0 处理。 */
function durationBetween(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.max(0, to - from)
}

/**
 * 诊断环境指纹：`GET /logs` 响应体 `env` 字段的数据来源，只含非敏感信息。
 *
 * 返回平台 / Node 版本、若干「是否配置」布尔开关与阶段耗时摘要；不返回配置原文、
 * 代理 URL、Token、工作区路径或提示词正文。读取任何配置或会话快照抛错时整体降级为
 * 安全默认值（布尔 false、耗时为 null），绝不把异常抛给日志路由。
 *
 * @param {{ config?: object, session?: { snapshot?: () => object } | null, now?: number }} [input]
 * @returns {{ platform: string, nodeVersion: string, hasProxyEnv: boolean,
 *             hasFallbackTunnel: boolean, hasCustomDatasets: boolean,
 *             hasPipConstraints: boolean, hasHfToken: boolean,
 *             timings: { sessionStartMs: number | null, sessionUptimeMs: number | null,
 *                        readyUptimeMs: number | null } }}
 */
export function buildDiagnosticEnv({ config = {}, session = null, now = Date.now() } = {}) {
  const { platform, nodeVersion } = processInfo()
  // 安全默认值：任何一步抛错都原样返回它，形状与正常返回一致。
  const fallback = {
    platform,
    nodeVersion,
    hasProxyEnv: false,
    hasFallbackTunnel: false,
    hasCustomDatasets: false,
    hasPipConstraints: false,
    hasHfToken: false,
    timings: { sessionStartMs: null, sessionUptimeMs: null, readyUptimeMs: null },
  }
  try {
    const settings = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
    const snapshot = session && typeof session.snapshot === 'function' ? session.snapshot() : null
    const current = timeOf(now) ?? Date.now()
    const startedAt = snapshot && typeof snapshot === 'object' ? timeOf(snapshot.startedAt) : null
    const readyAt = snapshot && typeof snapshot === 'object' ? timeOf(snapshot.readyAt) : null
    return {
      platform,
      nodeVersion,
      hasProxyEnv: PROXY_ENV_KEYS.some((key) => hasNonEmptyString(process.env?.[key])),
      hasFallbackTunnel: isNonEmptyArray(settings.fallbackTunnelCommand),
      hasCustomDatasets: isNonEmptyArray(settings.datasetSources),
      hasPipConstraints: isNonEmptyArray(settings.pipConstraints),
      hasHfToken: hasNonEmptyString(settings.hfToken),
      timings: {
        sessionStartMs: durationBetween(startedAt, readyAt),
        sessionUptimeMs: durationBetween(startedAt, current),
        readyUptimeMs: durationBetween(readyAt, current),
      },
    }
  } catch {
    // 诊断信息只用于贴 Issue：任何异常都返回上面的安全默认值，不影响日志路由本身。
    return fallback
  }
}

/**
 * 读取最近 N 行本地 Host 日志（新的在后），跨 host.log.1 / host.log 读取。
 * 无文件、无工作区上下文或读取失败时返回空数组，不抛异常。
 *
 * @param {object} ctx
 * @param {number} [limit]
 * @returns {Promise<string[]>}
 */
export async function readHostLogTail(ctx, limit = 120) {
  try {
    const filePath = hostLogPath(ctx)
    if (!filePath) return []
    const wanted = clampInteger(limit, 120, 1, READ_LIMIT_MAX)
    const active = activeFileLog
    if (active && active.enabled && active.filePath === filePath) await flushHostLog()

    const candidates = [filePath]
    for (let index = 1; index <= READ_ARCHIVE_SCAN; index += 1) candidates.push(`${filePath}.${index}`)

    let lines = []
    for (const candidate of candidates) {
      if (lines.length >= wanted) break
      const text = await readTextFile(candidate)
      if (text === null) continue
      const fileLines = text.split(/\r?\n/).filter((line) => line.length > 0)
      // 当前文件先读（最新），归档后读；每轮把更旧的内容拼到前面，最终顺序为旧 → 新。
      lines = fileLines.concat(lines)
    }
    return lines.slice(-wanted)
  } catch {
    return []
  }
}
