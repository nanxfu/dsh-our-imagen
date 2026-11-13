/**
 * 运行设置存储：`<workspace>/.imagen/settings.json`（工作台设置抽屉的宿主侧实现）。
 *
 * 目的：把「空闲自动关机、GPU 加速器、HuggingFace Token、预挂载 Dataset / 本地权重、
 * pip 依赖约束」从只能改插件静态配置，扩展为可在工作台里保存、并在下次启动会话时生效。
 *
 * 设计约束：
 *  - 只保存用户显式修改过的覆盖项，未修改字段继续跟随插件静态 `config`，避免把默认值
 *    固化成旧快照；
 *  - 目录 0700、文件 0600；写入用「同目录临时文件 + rename」原子替换，启动/写入前清理
 *    遗留的 `.tmp-*`，进程中断只会留下可忽略的临时文件；
 *  - 读取失败或 JSON 损坏时静默降级为「仅静态 config」，并 best-effort 删除损坏文件，
 *    绝不阻塞插件加载；没有工作区时只用内存里的覆盖项，不写盘、也不误写 process.cwd()；
 *  - hfToken 只允许落盘在这个 0600 私有文件里并下发给远端；任何对外视图、日志、诊断
 *    都只暴露布尔与来源，不出现原文、长度或前缀。
 *
 * 边界：本文件同时导出纯函数（`normalizeSettingsPatch` / `mergeSettings` /
 * `publicSettingsView`）供离线单测直接 import；存储实例（`createSettingsStore`）只负责
 * 读写、串行化与应用覆盖项，不 import 宿主服务。
 */

import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { SETTINGS, TIMEOUTS } from '../shared/contract.js'

const IMAGEN_DIR = '.imagen'
const SETTINGS_FILE = 'settings.json'
const TEMP_PREFIX = `${SETTINGS_FILE}.tmp-`

/** 用户可显式覆盖的字段（顺序即落盘顺序）；未知字段一律忽略，保持向前兼容。 */
const OVERRIDE_FIELDS = ['idleTimeoutSec', 'accelerator', 'hfToken', 'datasetSources', 'localModels', 'pipConstraints']

/** HF 仓库 id 形状：`org/name`，两段只含字母数字与 `._-` 且不以符号开头。 */
const HF_REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

// ---- 基础判断 -----------------------------------------------------------

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/** 校验失败的统一返回形状（与路由层的 invalid_request 对齐）。 */
function invalid(message) {
  return { ok: false, code: 'invalid_request', message }
}

/** 秒数归一：非数字退回 fallback，其余四舍五入后夹到契约边界内。 */
function clampIdleTimeout(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(SETTINGS.idleTimeoutSec.max, Math.max(SETTINGS.idleTimeoutSec.min, Math.round(number)))
}

// ---- 工作区路径 ---------------------------------------------------------

/**
 * 工作区根目录：只认 DSH 注入的 `workingDirectory`，取不到返回 null。
 * 与 lib/log.js 的判定保持一致——设置文件不能因为取不到工作区就落到 process.cwd()。
 */
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
 * 设置文件绝对路径：`<workspace>/.imagen/settings.json`；无工作区时返回 null。
 *
 * @param {object} ctx
 * @returns {string | null}
 */
export function settingsPath(ctx) {
  const workspace = workspaceDirectory(ctx)
  return workspace ? join(workspace, IMAGEN_DIR, SETTINGS_FILE) : null
}

// ---- 校验与归一 ---------------------------------------------------------

/**
 * 归一化一个字符串数组字段：去空、按首次出现去重、单条截断到上限、最多保留 maxItems 项。
 * 非数组或含非字符串项直接判非法（不静默吞掉用户的错误输入）。
 */
function normalizeStringList(field, input) {
  if (!Array.isArray(input)) return invalid(`${field} 必须是字符串数组`)
  const items = []
  for (const raw of input) {
    if (typeof raw !== 'string') return invalid(`${field} 的每一项都必须是字符串`)
    const item = raw.trim().slice(0, SETTINGS.maxItemChars)
    if (!item || items.includes(item)) continue
    items.push(item)
    if (items.length >= SETTINGS.maxItems) break
  }
  return { ok: true, value: items }
}

/** localModels：普通对象，键为 `org/name`，值为容器内绝对路径。 */
function normalizeLocalModels(input) {
  if (!isPlainObject(input)) return invalid('localModels 必须是对象（repo → 容器路径）')
  const value = {}
  let count = 0
  for (const [rawRepo, rawDir] of Object.entries(input)) {
    if (count >= SETTINGS.maxItems) break
    const repo = typeof rawRepo === 'string' ? rawRepo.trim() : ''
    if (!HF_REPO_ID_RE.test(repo)) return invalid('localModels 的键必须是 HuggingFace 仓库 id（org/name）')
    if (typeof rawDir !== 'string' || !rawDir.trim()) {
      return invalid(`localModels.${repo} 必须是容器内绝对路径`)
    }
    const dir = rawDir.trim()
    if (!dir.startsWith('/')) return invalid(`localModels.${repo} 必须以 / 开头（容器内绝对路径）`)
    if (dir.length > SETTINGS.maxItemChars) {
      return invalid(`localModels.${repo} 的路径过长（最多 ${SETTINGS.maxItemChars} 字符）`)
    }
    value[repo] = dir
    count += 1
  }
  return { ok: true, value }
}

/**
 * 校验并归一化来自 UI 的设置补丁。
 *
 * 规则：
 *  - 只认识 `idleTimeoutSec / accelerator / hfToken / clearHfToken / datasetSources /
 *    localModels / pipConstraints`，未知字段忽略（向前兼容）；
 *  - `idleTimeoutSec` 必须是有限数字，四舍五入后钳制到契约区间；显式传入非数字即 invalid_request；
 *  - `accelerator` 必须在契约白名单内；
 *  - `hfToken` 非空（trim 后）才写入；空字符串表示「保持不变」；
 *    `clearHfToken: true` 清除已保存值，且优先于同请求里的 hfToken；
 *  - `datasetSources` / `pipConstraints` 必须是字符串数组，trim、去空、去重、限长；
 *  - `localModels` 必须是普通对象，键按 HF repo id 校验，值必须以 `/` 开头。
 *
 * @param {unknown} patch
 * @returns {{ ok: true, value: object } | { ok: false, code: 'invalid_request', message: string }}
 */
export function normalizeSettingsPatch(patch) {
  if (!isPlainObject(patch)) return invalid('设置必须是 JSON 对象')
  const value = {}

  if (hasOwn(patch, 'idleTimeoutSec')) {
    if (typeof patch.idleTimeoutSec !== 'number' || !Number.isFinite(patch.idleTimeoutSec)) {
      return invalid('idleTimeoutSec 必须是数字（秒）')
    }
    value.idleTimeoutSec = clampIdleTimeout(patch.idleTimeoutSec, SETTINGS.idleTimeoutSec.min)
  }

  if (hasOwn(patch, 'accelerator')) {
    if (!hasNonEmptyString(patch.accelerator)) return invalid('accelerator 必须是非空字符串')
    const accelerator = patch.accelerator.trim()
    if (!SETTINGS.accelerators.includes(accelerator)) {
      return invalid(`accelerator 必须是 ${SETTINGS.accelerators.join(' / ')} 之一`)
    }
    value.accelerator = accelerator
  }

  // hfToken：空串表示「保持不变」，非空才保存；clearHfToken 显式清除并优先。
  const clearHfToken = patch.clearHfToken === true
  if (clearHfToken) value.clearHfToken = true
  if (hasOwn(patch, 'hfToken')) {
    if (typeof patch.hfToken !== 'string') return invalid('hfToken 必须是字符串')
    const token = patch.hfToken.trim()
    if (token && !clearHfToken) value.hfToken = token
  }

  if (hasOwn(patch, 'datasetSources')) {
    const list = normalizeStringList('datasetSources', patch.datasetSources)
    if (!list.ok) return list
    value.datasetSources = list.value
  }
  if (hasOwn(patch, 'pipConstraints')) {
    const list = normalizeStringList('pipConstraints', patch.pipConstraints)
    if (!list.ok) return list
    value.pipConstraints = list.value
  }
  if (hasOwn(patch, 'localModels')) {
    const models = normalizeLocalModels(patch.localModels)
    if (!models.ok) return models
    value.localModels = models.value
  }

  return { ok: true, value }
}

// ---- 合并与脱敏视图 -----------------------------------------------------

/** 宽松清洗字符串数组：只保留非空字符串、trim、按首次出现去重（用于静态 config 兜底）。 */
function cleanStrings(value) {
  if (!Array.isArray(value)) return []
  const items = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const item = entry.trim()
    if (item && !items.includes(item)) items.push(item)
  }
  return items
}

/** 宽松清洗 localModels：只保留键值都非空的字符串项（用于静态 config 兜底）。 */
function cleanLocalModels(value) {
  const models = {}
  if (!isPlainObject(value)) return models
  for (const [rawRepo, rawDir] of Object.entries(value)) {
    // 配置对象可能来自外部注入：显式跳开会改写原型链的键。
    if (rawRepo === '__proto__' || rawRepo === 'constructor' || rawRepo === 'prototype') continue
    if (!hasNonEmptyString(rawRepo) || !hasNonEmptyString(rawDir)) continue
    models[rawRepo.trim()] = rawDir.trim()
  }
  return models
}

/**
 * 合并静态 `config` 与用户保存的覆盖项，得到当前生效值。
 *
 * 纯函数：任何异常输入都按「该字段回退静态 config / 契约默认值」处理，不抛异常。
 *
 * @param {object} config 插件静态配置（apply(ctx, config) 的原样对象）
 * @param {object} overrides 用户显式覆盖项（settings.json 解析结果）
 * @returns {{ idleTimeoutSec: number, accelerator: string, hfToken: string | null,
 *             datasetSources: string[], localModels: Record<string, string>,
 *             pipConstraints: string[] }}
 */
export function mergeSettings(config, overrides) {
  const base = isPlainObject(config) ? config : {}
  const saved = isPlainObject(overrides) ? overrides : {}

  const fallbackIdle = clampIdleTimeout(TIMEOUTS.idleShutdownSec, SETTINGS.idleTimeoutSec.min)
  const baseIdle = clampIdleTimeout(base.idleTimeoutSec, fallbackIdle)
  const idleTimeoutSec = hasOwn(saved, 'idleTimeoutSec')
    ? clampIdleTimeout(saved.idleTimeoutSec, baseIdle)
    : baseIdle

  const baseAccelerator = SETTINGS.accelerators.includes(base.accelerator)
    ? base.accelerator
    : SETTINGS.defaultAccelerator
  const accelerator =
    hasOwn(saved, 'accelerator') && SETTINGS.accelerators.includes(saved.accelerator)
      ? saved.accelerator
      : baseAccelerator

  const baseHfToken = hasNonEmptyString(base.hfToken) ? base.hfToken.trim() : null
  const savedHfToken = hasOwn(saved, 'hfToken') && hasNonEmptyString(saved.hfToken) ? saved.hfToken.trim() : null

  return {
    idleTimeoutSec,
    accelerator,
    hfToken: savedHfToken ?? baseHfToken,
    datasetSources: Array.isArray(saved.datasetSources)
      ? cleanStrings(saved.datasetSources)
      : cleanStrings(base.datasetSources),
    localModels: isPlainObject(saved.localModels) ? cleanLocalModels(saved.localModels) : cleanLocalModels(base.localModels),
    pipConstraints: Array.isArray(saved.pipConstraints)
      ? cleanStrings(saved.pipConstraints)
      : cleanStrings(base.pipConstraints),
  }
}

/**
 * 对外脱敏视图：绝不返回 hfToken 原文，只给布尔与来源。
 *
 * `hasConfigHfToken` 表示静态 config 里有 Token；`hasSettingsHfToken` 由存储实例传入
 * （用户保存过 Token 时为 true，未保存为 false，调用方不关心来源时可省略）。二者都缺失
 * 或自相矛盾时，按「有 Token 就归到 settings」处理，避免把来源误报成不存在的 none。
 *
 * @param {{ idleTimeoutSec?: number, accelerator?: string, hfToken?: string | null,
 *           datasetSources?: string[], localModels?: object, pipConstraints?: string[] }} effective
 * @param {{ hasConfigHfToken?: boolean, hasSettingsHfToken?: boolean | null, sessionActive?: boolean }} [input]
 * @returns {{ idleTimeoutSec: number, accelerator: string, datasetSources: string[],
 *             localModels: Record<string, string>, pipConstraints: string[],
 *             hasHfToken: boolean, hfTokenSource: 'settings' | 'config' | 'none',
 *             effectiveOnNextSession: boolean }}
 */
export function publicSettingsView(effective, { hasConfigHfToken = false, hasSettingsHfToken = null, sessionActive = false } = {}) {
  const value = isPlainObject(effective) ? effective : {}
  const hasHfToken = hasNonEmptyString(value.hfToken)
  let hfTokenSource = 'none'
  if (hasHfToken) {
    if (hasSettingsHfToken === true) hfTokenSource = 'settings'
    else if (hasConfigHfToken) hfTokenSource = 'config'
    else hfTokenSource = 'settings'
  }
  const accelerator = SETTINGS.accelerators.includes(value.accelerator)
    ? value.accelerator
    : SETTINGS.defaultAccelerator
  return {
    idleTimeoutSec: clampIdleTimeout(value.idleTimeoutSec, TIMEOUTS.idleShutdownSec),
    accelerator,
    datasetSources: cleanStrings(value.datasetSources),
    localModels: cleanLocalModels(value.localModels),
    pipConstraints: cleanStrings(value.pipConstraints),
    hasHfToken,
    hfTokenSource,
    effectiveOnNextSession: Boolean(sessionActive),
  }
}

// ---- 原子读写 -----------------------------------------------------------

/** 清掉上次进程中断时留下的临时文件（只清本设置文件的命名前缀）。 */
async function removeStaleTemps(dir) {
  const entries = await readdir(dir).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => name.startsWith(TEMP_PREFIX))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => {})),
  )
}

/** 原子写入覆盖项；目录与文件权限尽力收紧（Windows 忽略 mode 差异）。 */
async function writeSettingsFile(filePath, overrides) {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
  await removeStaleTemps(dir)

  const temp = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`
  const text = `${JSON.stringify(overrides, null, 2)}\n`
  await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temp, filePath)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  await chmod(filePath, 0o600).catch(() => {})
}

/**
 * 从磁盘读取覆盖项：无工作区/文件不存在/读取失败/损坏都返回空对象。
 * 损坏文件 best-effort 删除，避免每次启动都解析失败；只清理本文件，不碰其它状态。
 */
async function loadOverrides(filePath) {
  if (!filePath) return {}
  await removeStaleTemps(dirname(filePath))
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return {}
  }
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!isPlainObject(parsed)) {
    await rm(filePath, { force: true }).catch(() => {})
    return {}
  }
  return normalizeStoredOverrides(parsed)
}

/** 逐字段重新校验磁盘内容：手工改坏某个字段时只丢该字段，不影响其它覆盖项。 */
function normalizeStoredOverrides(raw) {
  const value = {}
  for (const field of OVERRIDE_FIELDS) {
    if (!hasOwn(raw, field)) continue
    const result = normalizeSettingsPatch({ [field]: raw[field] })
    if (result.ok && hasOwn(result.value, field)) value[field] = result.value[field]
  }
  return value
}

// ---- 存储实例 -----------------------------------------------------------

/**
 * 创建设置存储。
 *
 * 构造时立即异步加载 `<workspace>/.imagen/settings.json`，读取失败静默降级；
 * 调用方在读取视图前 `await whenReady()` 即可拿到加载后的合并结果，`current()`
 * 永远返回同步可用的生效值（加载完成前等于静态 config）。
 *
 * @param {{ ctx?: object, config?: object }} [input]
 * @returns {{ whenReady: () => Promise<object>, current: () => object,
 *             publicView: (input?: { sessionActive?: boolean }) => object,
 *             save: (patch: object) => Promise<{ ok: boolean, code?: string, message?: string }> }}
 */
export function createSettingsStore({ ctx, config } = {}) {
  const staticConfig = isPlainObject(config) ? config : {}
  const filePath = settingsPath(ctx)
  let overrides = {}
  // 写入串行化：并发保存不会交错读改写，前一个失败也不阻塞后一个。
  let writeChain = Promise.resolve()

  const store = {
    whenReady() {
      return loading.then(() => store)
    },
    current() {
      return mergeSettings(staticConfig, overrides)
    },
    publicView({ sessionActive = false } = {}) {
      return publicSettingsView(store.current(), {
        hasConfigHfToken: hasNonEmptyString(staticConfig.hfToken),
        hasSettingsHfToken: hasNonEmptyString(overrides.hfToken),
        sessionActive,
      })
    },
    async save(patch) {
      const normalized = normalizeSettingsPatch(patch)
      if (!normalized.ok) return normalized
      const task = async () => {
        const next = { ...overrides }
        for (const field of OVERRIDE_FIELDS) {
          if (hasOwn(normalized.value, field)) next[field] = normalized.value[field]
        }
        if (normalized.value.clearHfToken === true) delete next.hfToken
        if (filePath) await writeSettingsFile(filePath, next)
        overrides = next
        return { ok: true }
      }
      const pending = writeChain.then(task, task)
      writeChain = pending.then(
        () => undefined,
        () => undefined,
      )
      try {
        return await pending
      } catch {
        // 不把磁盘错误抛给路由；只在内存里保持旧值，避免「界面显示已保存、重启后丢失」。
        return { ok: false, code: 'internal_error', message: '设置保存失败，请检查工作区目录权限' }
      }
    },
  }

  const loading = loadOverrides(filePath)
    .then((value) => {
      overrides = value
    })
    .catch(() => {
      // loadOverrides 理论上不抛；即使抛错也只保留静态 config。
    })

  return store
}
