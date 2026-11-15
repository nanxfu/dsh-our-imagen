/**
 * 「待清理会话」记录：`<workspace>/.imagen/pending-cleanup.json`。
 *
 * 背景：`SessionManager.dispose()` 不阻塞插件卸载，只 best-effort 通知远端关机；
 * 若通知没能发出或失败，Kernel 会继续占用每周 GPU 配额。这里把「还需要补发一次
 * `/shutdown`」的最小信息同步落盘，下次插件启动时先补发一次关机，再走会话恢复。
 *
 * 约束：
 *  - dispose 路径必须同步写（进程随时可能退出，异步写可能来不及）：`writePendingCleanupSync`；
 *  - 记录含远端 Bearer Token：目录 0700、文件 0600（Windows 忽略 mode 差异），
 *    用「同目录临时文件 + rename」原子替换，并清理上次中断留下的临时文件；
 *  - 读取时校验版本与关键字段（token + endpointUrl 必须齐全），损坏 / 版本不符直接清理，
 *    不抛异常；
 *  - TTL 24 小时（Kernel 最长运行 3 小时，超期视为已结束）、最多补发 5 次；
 *  - token 只落盘，不进入任何日志（日志只记 kernelId / attempts / 原因）。
 */

import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { removeStaleTemps, writeFileAtomic, writeFileAtomicSync } from '../fs-atomic.js'
import { workspaceRoot } from '../paths.js'

export const PENDING_CLEANUP_VERSION = 1

/** Kernel 最长运行 3 小时；超过 24 小时视为早已结束，不再补发关机。 */
export const PENDING_CLEANUP_TTL_MS = 24 * 60 * 60 * 1000

/** 最多补发次数：失败通常是隧道 / 代理临时不可达，超过上限就不再纠缠。 */
export const PENDING_CLEANUP_MAX_ATTEMPTS = 5

const IMAGEN_DIR = '.imagen'
const PENDING_FILE = 'pending-cleanup.json'
const TEMP_PREFIX = `${PENDING_FILE}.tmp-`

/** 待清理记录文件的绝对路径。 */
export function pendingCleanupPath(ctx) {
  return join(workspaceRoot(ctx), IMAGEN_DIR, PENDING_FILE)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 从会话快照与 secret 组装待清理记录；没有补发关机所需的信息时返回 null。
 *
 * 补发关机只需要 endpoint + token；kernelId / topic / presetId 仅用于日志与排障。
 * 正常卸载流程中这些字段都已就绪。
 *
 * @param {object} [session] 会话快照
 * @param {{ token?: string, topic?: string }} [secret] 远端凭据
 * @param {number} [now] 时间戳（测试可注入固定时钟）
 */
export function buildPendingCleanupRecord(session = {}, secret = {}, now = Date.now()) {
  const endpointUrl = stringOrNull(session?.endpointUrl)
  const token = stringOrNull(secret?.token)
  if (!endpointUrl || !token) return null
  return {
    version: PENDING_CLEANUP_VERSION,
    savedAt: new Date(now).toISOString(),
    endpointUrl,
    token,
    kernelId: stringOrNull(session?.kernelId),
    topic: stringOrNull(secret?.topic),
    presetId: stringOrNull(session?.presetId),
    attempts: 0,
  }
}

/**
 * 校验并归一化一条记录：版本不符、缺 token / endpoint / 合法 savedAt 都返回 null。
 * 只做内存校验，不碰磁盘。
 */
function normalizeRecord(value) {
  if (!isPlainObject(value)) return null
  if (value.version !== PENDING_CLEANUP_VERSION) return null
  const endpointUrl = stringOrNull(value.endpointUrl)
  const token = stringOrNull(value.token)
  if (!endpointUrl || !token) return null
  const savedAt = stringOrNull(value.savedAt)
  if (!savedAt || Number.isNaN(Date.parse(savedAt))) return null
  const rawAttempts = Number(value.attempts)
  const attempts = Number.isFinite(rawAttempts) ? Math.max(0, Math.round(rawAttempts)) : 0
  return {
    version: PENDING_CLEANUP_VERSION,
    savedAt,
    endpointUrl,
    token,
    kernelId: stringOrNull(value.kernelId),
    topic: stringOrNull(value.topic),
    presetId: stringOrNull(value.presetId),
    attempts,
  }
}

/**
 * 记录是否已超过 TTL（savedAt 缺失 / 非法同样按过期处理）。
 * 重试只累加 attempts、不刷新 savedAt：24 小时从首次落盘开始算，避免无限拖延。
 */
export function isPendingCleanupExpired(record, now = Date.now()) {
  const savedAt = Date.parse(String(record?.savedAt ?? ''))
  if (!Number.isFinite(savedAt)) return true
  return now - savedAt > PENDING_CLEANUP_TTL_MS
}

function serialize(record) {
  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * 同步原子写入待清理记录（dispose 路径专用）。
 *
 * dispose 之后进程可能立刻退出，异步写没有机会完成，所以这里必须同步落盘。
 * 任何异常（磁盘只读、权限不足等）都只返回 false，绝不让卸载路径抛错；
 * 调用方据此决定是否还保留本地会话记录。
 *
 * @returns {boolean} 是否成功落盘
 */
export function writePendingCleanupSync(ctx, record) {
  const normalized = normalizeRecord(record)
  if (!normalized) return false
  const path = pendingCleanupPath(ctx)
  try {
    writeFileAtomicSync(path, serialize(normalized), {
      dirMode: 0o700,
      fileMode: 0o600,
      cleanStale: true,
      tempPrefix: TEMP_PREFIX,
      encoding: 'utf8',
    })
    return true
  } catch {
    return false
  }
}

/**
 * 异步原子写入待清理记录（补发失败累加 attempts 时使用）。
 * 记录无效返回 null；磁盘错误原样抛给调用方（启动流程各自吞掉）。
 */
export async function writePendingCleanup(ctx, record) {
  const normalized = normalizeRecord(record)
  if (!normalized) return null
  const path = pendingCleanupPath(ctx)
  await writeFileAtomic(path, serialize(normalized), {
    dirMode: 0o700,
    fileMode: 0o600,
    cleanStale: true,
    tempPrefix: TEMP_PREFIX,
    encoding: 'utf8',
  })
  return normalized
}

/**
 * 读取待清理记录。
 * 无文件 → null；JSON 损坏 / 版本不符 / 缺关键字段 → 清理后返回 null。
 * 读取本身不抛异常（I/O 失败按无记录处理），保证启动流程不被阻塞。
 *
 * @returns {Promise<object | null>}
 */
export async function readPendingCleanup(ctx) {
  const path = pendingCleanupPath(ctx)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }

  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const record = normalizeRecord(parsed)
  if (record) return record

  // 损坏 / 版本不符 / 缺关键字段：清理掉，避免每次启动反复解析失败。
  await rm(path, { force: true }).catch(() => {})
  await removeStaleTemps(dirname(path), TEMP_PREFIX)
  return null
}

/** 删除待清理记录（best-effort，不抛异常）。 */
export async function clearPendingCleanup(ctx) {
  const path = pendingCleanupPath(ctx)
  await rm(path, { force: true }).catch(() => {})
  await removeStaleTemps(dirname(path), TEMP_PREFIX)
}
