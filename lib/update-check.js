/**
 * 插件自身版本检查（Host 侧，唯一发起点）。
 *
 * 目标：让用户在「生图工作台」里知道 npm 上有没有比当前插件更新的版本，而不用去翻
 * 插件管理页。检查**只读**：不下载、不安装、不重启，也不参与出图链路。
 *
 * 口径与边界：
 *  - 版本来源是 npm 注册表的 `<包名>/latest`，先问 npmjs，失败再问 npmmirror；
 *  - 结果缓存在 `<workspace>/.imagen/update-check.json`，24 小时有效；启动后延迟几秒
 *    查一次，之后按 TTL 复查，检查失败静默保留上一次成功结果；
 *  - 只在「远端版本确实比当前版本新」时对外提示；同版本/更旧/不可解析都不提示；
 *  - 不把网络响应体透传给客户端，只保留版本号、`engines.dsh` 要求与 release 链接；
 *  - `enabled=false`（测试、开发模式或用户显式关闭）时不发起任何请求、不写缓存。
 *
 * 测试替身：`fetchText` 与 `now` 均可注入，单测完全不联网（见 test/update-check.mjs）。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isNewerVersion, normalizeVersion } from '../shared/version.js'
import { writeFileAtomic } from './fs-atomic.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'
import { IMAGEN_DIR, workspaceRoot } from './paths.js'

const UPDATE_PACKAGE = 'dsh-our-imagen'

/** 依次尝试的注册表：国内直连 npmjs 常超时，npmmirror 作为兜底（同步有分钟级延迟）。 */
const UPDATE_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']

/** 单次注册表请求的超时；manifest 很小，4 秒足够。 */
const UPDATE_CHECK_TIMEOUT_MS = 4000
/** 成功结果的缓存时长：一天查一次，避免每次开机都打扰注册表。 */
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000
/** 插件启动后第一次检查的延迟：先把出图主链路让出来，别和唤醒抢网络。 */
const UPDATE_CHECK_START_DELAY_MS = 5000

/** 缓存文件版本与文件名（位于工作区 `.imagen/` 下）。 */
export const UPDATE_RECORD_VERSION = 1
const RECORD_FILE = 'update-check.json'
const RECORD_MAX_BYTES = 64 * 1024
/** 远端 `engines.dsh` 范围字符串的展示上限。 */
const MAX_ENGINES_CHARS = 64

const RELEASE_BASE = 'https://github.com/nanxfu/dsh-our-imagen/releases/tag/v'
const log = createLogger({ scope: 'update' })

/** 版本对应的 GitHub Release 页面；版本不可解析时返回 null。 */
export function releaseUrlOf(version) {
  const normalized = normalizeVersion(version)
  return normalized ? `${RELEASE_BASE}${normalized}` : null
}

/** 远端 manifest 里的 `engines.dsh` 要求；只作为展示信息，不做范围求值。 */
function enginesRangeOf(manifest) {
  const engines = manifest && typeof manifest === 'object' ? manifest.engines : null
  const range = engines && typeof engines === 'object' ? engines.dsh : null
  if (typeof range !== 'string') return null
  const text = range.trim()
  if (!text || text.length > MAX_ENGINES_CHARS) return null
  return text
}

/** 读取并校验缓存记录；版本不符 / 缺字段返回 null（按没有缓存处理）。 */
function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== UPDATE_RECORD_VERSION) return null
  const latest = normalizeVersion(value.latest)
  const checkedAt = Number(value.checkedAt)
  if (!latest || !Number.isFinite(checkedAt) || checkedAt <= 0) return null
  const enginesDsh = typeof value.enginesDsh === 'string' && value.enginesDsh.trim()
    ? value.enginesDsh.trim().slice(0, MAX_ENGINES_CHARS)
    : null
  const registry = typeof value.registry === 'string' && value.registry.trim() ? value.registry.trim() : null
  return { checkedAt, latest, enginesDsh, registry }
}

async function readRecord(path) {
  try {
    const text = await readFile(path, 'utf8')
    if (text.length > RECORD_MAX_BYTES) return null
    return normalizeRecord(JSON.parse(text))
  } catch {
    // 不存在 / 损坏 / 权限问题都按「没有缓存」处理：版本检查不能影响插件加载。
    return null
  }
}

async function writeRecord(path, state) {
  const record = {
    version: UPDATE_RECORD_VERSION,
    checkedAt: state.checkedAt,
    latest: state.latest,
    enginesDsh: state.enginesDsh,
    registry: state.registry,
  }
  await writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`, {
    dirMode: 0o700,
    fileMode: 0o600,
    cleanStale: true,
    tempPrefix: `${RECORD_FILE}.tmp-`,
    encoding: 'utf8',
  })
}

/**
 * 创建版本检查器。
 *
 * @param {object} options
 * @param {object} [options.ctx] 宿主上下文（用 `workspaceRoot` 推导缓存目录、`httpText` 发请求）
 * @param {string} options.currentVersion 当前插件版本（契约 VERSION）
 * @param {string} [options.dir] 工作区根目录；不传时用 `workspaceRoot(ctx)`
 * @param {boolean} [options.enabled=true] false 时不发请求、不写缓存（测试 / 开发模式 / 配置关闭）
 * @param {(url: string, options: object) => Promise<{ ok: boolean, status?: number, text: string }>} [options.fetchText]
 * @param {() => number} [options.now] 时钟注入（单测用）
 */
export function createUpdateChecker({
  ctx = null,
  currentVersion,
  dir,
  enabled = true,
  fetchText,
  now = () => Date.now(),
} = {}) {
  const current = normalizeVersion(currentVersion)
  const baseDir = dir ?? (ctx ? workspaceRoot(ctx) : null)
  const recordPath = baseDir ? join(baseDir, IMAGEN_DIR, RECORD_FILE) : null
  const fetchOnce = typeof fetchText === 'function' ? fetchText : (url, options) => httpText(ctx, url, options)

  /** 最近一次检查结果；检查失败时保留旧值，只更新 error。 */
  let state = { checkedAt: 0, latest: null, enginesDsh: null, registry: null }
  let lastError = null
  let inFlight = null
  let disposed = false
  let startTimer = null
  let refreshTimer = null

  function clearTimers() {
    if (startTimer) clearTimeout(startTimer)
    if (refreshTimer) clearInterval(refreshTimer)
    startTimer = null
    refreshTimer = null
  }

  /** 对外快照：纯数据、无异常，客户端只看 `hasUpdate`。 */
  function snapshot() {
    const checkedAt = state.checkedAt > 0 ? new Date(state.checkedAt).toISOString() : null
    const hasUpdate = Boolean(state.latest && current && isNewerVersion(state.latest, current))
    return {
      current,
      latest: state.latest,
      hasUpdate,
      releaseUrl: hasUpdate ? releaseUrlOf(state.latest) : null,
      enginesDsh: state.enginesDsh,
      checkedAt,
      stale: state.checkedAt === 0 || now() - state.checkedAt >= UPDATE_CHECK_TTL_MS,
      error: lastError,
    }
  }

  async function load() {
    if (!recordPath) return snapshot()
    const record = await readRecord(recordPath)
    if (record && !disposed) {
      state = { checkedAt: record.checkedAt, latest: record.latest, enginesDsh: record.enginesDsh, registry: record.registry }
    }
    return snapshot()
  }

  /** 依次尝试各注册表；第一个能读出合法版本的注册表决定结果。全失败时保留旧结果。 */
  async function check() {
    if (!enabled || disposed || !current) return snapshot()
    if (inFlight) return inFlight
    inFlight = (async () => {
      for (const registry of UPDATE_REGISTRIES) {
        const url = `${registry}/${UPDATE_PACKAGE}/latest`
        try {
          const result = await fetchOnce(url, {
            timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
            maxBytes: 64 * 1024,
            headers: { accept: 'application/json' },
          })
          if (!result?.ok) {
            lastError = `registry_http_${result?.status ?? 'failed'}`
            continue
          }
          let manifest
          try {
            manifest = JSON.parse(result.text)
          } catch {
            lastError = 'invalid_manifest'
            continue
          }
          const latest = normalizeVersion(manifest?.version)
          if (!latest) {
            lastError = 'invalid_version'
            continue
          }
          state = {
            checkedAt: now(),
            latest,
            enginesDsh: enginesRangeOf(manifest),
            registry,
          }
          lastError = null
          log.info(`update_check_ok latest=${latest} current=${current} registry=${registry}`)
          if (recordPath) await writeRecord(recordPath, state).catch((error) => {
            log.warn('写入版本检查缓存失败（忽略）', String(error?.message ?? error).slice(0, 200))
          })
          return snapshot()
        } catch (error) {
          lastError = 'network'
          log.debug('注册表查询失败（尝试下一个）', String(error?.message ?? error).slice(0, 200))
        }
      }
      log.debug(`update_check_failed current=${current} error=${lastError ?? 'unknown'}`)
      return snapshot()
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  /** 启动后台检查：先读缓存，再在启动延迟 / 剩余 TTL 后查一次，之后每 TTL 复查。 */
  function start() {
    if (!enabled || disposed) return
    void load().then(() => {
      if (disposed) return
      const elapsed = state.checkedAt > 0 ? now() - state.checkedAt : Infinity
      const delay = elapsed >= UPDATE_CHECK_TTL_MS
        ? UPDATE_CHECK_START_DELAY_MS
        : Math.max(UPDATE_CHECK_START_DELAY_MS, UPDATE_CHECK_TTL_MS - elapsed)
      startTimer = setTimeout(() => {
        startTimer = null
        void check()
      }, delay)
      startTimer.unref?.()
      refreshTimer = setInterval(() => {
        void check()
      }, UPDATE_CHECK_TTL_MS)
      refreshTimer.unref?.()
    })
  }

  function dispose() {
    disposed = true
    clearTimers()
  }

  return { snapshot, load, check, start, dispose }
}
