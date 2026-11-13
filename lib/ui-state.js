/**
 * 工作台界面状态存储：`<workspace>/.imagen/ui-state.json`。
 *
 * 界面态只是体验优化，不是业务数据，因此：
 *  - 只持久化契约 `UI_STATE.defaults` 登记的字段（白名单），未登记字段在写入前丢弃；
 *  - 文件不存在 / JSON 损坏 / 版本不符 / 超过 `UI_STATE.maxBytes` 时一律回落到默认值，
 *    读取不抛异常，绝不阻塞插件加载与出图主链路；
 *  - 写入用「同目录临时文件 + rename」原子替换，目录 0700、文件 0600
 *    （Windows 忽略 mode 差异），并在写入前清理上次中断留下的临时文件；
 *  - 本模块不 import 宿主服务，只做 I/O 与归一化，便于离线断言。
 */

import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { UI_STATE } from '../shared/contract.js'
import { workspaceRoot } from './paths.js'

const IMAGEN_DIR = '.imagen'
const UI_STATE_FILE = 'ui-state.json'
const TEMP_PREFIX = `${UI_STATE_FILE}.tmp-`

/** 白名单字段（顺序与契约 `UI_STATE.defaults` 一致）。 */
const FIELDS = Object.keys(UI_STATE.defaults)

/** 界面状态文件的绝对路径。 */
export function uiStatePath(ctx) {
  return join(workspaceRoot(ctx), IMAGEN_DIR, UI_STATE_FILE)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** 契约字段类型的中文名（只用于错误文案）。 */
function typeLabel(value) {
  if (typeof value === 'boolean') return '布尔值'
  if (typeof value === 'number') return '数字'
  if (typeof value === 'string') return '字符串'
  return '对象'
}

/** 默认视图：每次返回新对象，调用方改不到契约里的默认值。 */
export function defaultUiState() {
  return { ...UI_STATE.defaults }
}

/**
 * 校验并归一化来自工作台的界面状态补丁（扁平补丁）。
 *
 * 规则：
 *  - 只认识契约 `UI_STATE.defaults` 登记过的字段，未知字段直接忽略（向前兼容）；
 *  - 已登记字段的类型必须与默认值一致（目前只有 boolean），类型不符返回 `invalid_request`；
 *  - 非对象入参同样按 `invalid_request`（路由层再区分 `invalid_body`）。
 *
 * @param {unknown} patch
 * @returns {{ ok: true, value: object } | { ok: false, code: 'invalid_request', message: string }}
 */
export function normalizeUiStatePatch(patch) {
  if (!isPlainObject(patch)) {
    return { ok: false, code: 'invalid_request', message: '界面状态必须是 JSON 对象' }
  }
  const value = {}
  for (const field of FIELDS) {
    if (!hasOwn(patch, field)) continue
    const expected = typeof UI_STATE.defaults[field]
    if (typeof patch[field] !== expected) {
      return { ok: false, code: 'invalid_request', message: `${field} 必须是${typeLabel(UI_STATE.defaults[field])}` }
    }
    value[field] = patch[field]
  }
  return { ok: true, value }
}

/**
 * 磁盘内容 → 白名单视图。
 *
 * 版本不符视为整份记录不可用（`ok: false`，由调用方清理文件后回落默认值）；
 * 版本正确时逐字段校验，某个字段类型不符只丢该字段，其余字段仍然生效。
 */
function normalizeStoredUiState(raw) {
  const value = defaultUiState()
  if (!isPlainObject(raw) || raw.version !== UI_STATE.version) return { ok: false, value }
  for (const field of FIELDS) {
    if (hasOwn(raw, field) && typeof raw[field] === typeof UI_STATE.defaults[field]) value[field] = raw[field]
  }
  return { ok: true, value }
}

/** 清掉上次进程中断时留下的临时文件（只清本文件的命名前缀）。 */
async function removeStaleTemps(dir) {
  const entries = await readdir(dir).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => name.startsWith(TEMP_PREFIX))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => {})),
  )
}

/**
 * 读取界面状态：始终返回白名单全量视图（默认值合并后的结果）。
 *
 * 文件不存在 / 读取失败 / 超过 `UI_STATE.maxBytes` / JSON 损坏 / 版本不符都回落到默认值；
 * 损坏与超限文件顺手删除，避免每次读取重复解析失败。任何情况都不抛异常。
 *
 * @param {object} ctx 宿主上下文
 * @returns {Promise<object>} 例如 `{ advancedOpen: false }`
 */
export async function readUiState(ctx) {
  const path = uiStatePath(ctx)
  // 先看大小再读内容：异常大的文件不整份读进内存。
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return defaultUiState()
  if (info.size > UI_STATE.maxBytes) {
    await rm(path, { force: true }).catch(() => {})
    await removeStaleTemps(dirname(path))
    return defaultUiState()
  }

  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // 权限等读取失败按无记录处理，但不删除文件（可能只是临时占用）。
    return defaultUiState()
  }

  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const normalized = normalizeStoredUiState(parsed)
  if (normalized.ok) return normalized.value

  // 损坏 / 版本不符：清理后回落到默认值。
  await rm(path, { force: true }).catch(() => {})
  await removeStaleTemps(dirname(path))
  return defaultUiState()
}

/**
 * 原子写入界面状态：入参按白名单逐字段归一，返回实际落盘的全量视图。
 *
 * 只接受类型正确的已登记字段，其余字段静默丢弃；目录与文件权限尽力收紧
 * （Windows 忽略 mode 差异）。磁盘错误原样抛给调用方，由路由层转成 500。
 *
 * @param {object} ctx 宿主上下文
 * @param {object} values 界面状态（可包含未登记字段与非法类型，会被丢弃）
 * @returns {Promise<object>} 落盘的全量视图
 */
export async function writeUiState(ctx, values) {
  const state = defaultUiState()
  if (isPlainObject(values)) {
    for (const field of FIELDS) {
      if (hasOwn(values, field) && typeof values[field] === typeof UI_STATE.defaults[field]) {
        state[field] = values[field]
      }
    }
  }

  const path = uiStatePath(ctx)
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
  await removeStaleTemps(dir)

  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  const text = `${JSON.stringify({ version: UI_STATE.version, ...state }, null, 2)}\n`
  await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  await chmod(path, 0o600).catch(() => {})
  return state
}
