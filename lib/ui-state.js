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

import { readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { UI_STATE } from '../shared/contract.js'
import {
  UI_STATE_FIELDS as FIELDS,
  defaultUiState,
  normalizeUiState,
  normalizeUiStatePatch,
} from '../shared/validation.js'
import { createSerialQueue, removeStaleTemps, writeFileAtomic } from './fs-atomic.js'
import { workspaceRoot } from './paths.js'

export { defaultUiState, normalizeUiStatePatch }

const IMAGEN_DIR = '.imagen'
const UI_STATE_FILE = 'ui-state.json'
const TEMP_PREFIX = `${UI_STATE_FILE}.tmp-`
const serialize = createSerialQueue()

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

/**
 * 磁盘内容 → 白名单视图。
 *
 * 版本不符视为整份记录不可用（`ok: false`，由调用方清理文件后回落默认值）；
 * 版本正确时逐字段校验，某个字段类型不符只丢该字段，其余字段仍然生效。
 */
function normalizeStoredUiState(raw) {
  if (!isPlainObject(raw) || raw.version !== UI_STATE.version) return { ok: false, value: defaultUiState() }
  return { ok: true, value: normalizeUiState(raw) }
}

async function readUiStateUnlocked(ctx) {
  const path = uiStatePath(ctx)
  // 先看大小再读内容：异常大的文件不整份读进内存。
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return defaultUiState()
  if (info.size > UI_STATE.maxBytes) {
    await rm(path, { force: true }).catch(() => {})
    await removeStaleTemps(dirname(path), TEMP_PREFIX)
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
  await removeStaleTemps(dirname(path), TEMP_PREFIX)
  return defaultUiState()
}

async function writeUiStateUnlocked(ctx, values) {
  const state = defaultUiState()
  if (isPlainObject(values)) {
    for (const field of FIELDS) {
      if (hasOwn(values, field) && typeof values[field] === typeof UI_STATE.defaults[field]) {
        state[field] = values[field]
      }
    }
  }

  const path = uiStatePath(ctx)
  const text = `${JSON.stringify({ version: UI_STATE.version, ...state }, null, 2)}\n`
  await writeFileAtomic(path, text, {
    ensureDir: true,
    dirMode: 0o700,
    fileMode: 0o600,
    cleanStale: true,
    tempPrefix: TEMP_PREFIX,
    encoding: 'utf8',
  })
  return state
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
  return readUiStateUnlocked(ctx)
}

/**
 * 原子写入界面状态：入参按白名单逐字段归一，返回实际落盘的全量视图。
 * 通过进程内串行队列防止并发覆盖。
 *
 * @param {object} ctx 宿主上下文
 * @param {object} values 界面状态（可包含未登记字段与非法类型，会被丢弃）
 * @returns {Promise<object>} 落盘的全量视图
 */
export function writeUiState(ctx, values) {
  return serialize(() => writeUiStateUnlocked(ctx, values))
}

/**
 * 在同一串行队列内原子执行「读取 → 合并补丁 → 落盘」，避免并发 PATCH 丢字段。
 *
 * @param {object} ctx
 * @param {object} patch
 * @returns {Promise<object>}
 */
export function patchUiState(ctx, patch) {
  return serialize(async () => {
    const current = await readUiStateUnlocked(ctx)
    return writeUiStateUnlocked(ctx, { ...current, ...(isPlainObject(patch) ? patch : {}) })
  })
}
