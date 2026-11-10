/**
 * 会话记录的本地持久化：`<workspace>/.imagen/session.json`。
 *
 * 目的：DSH 重启 / 插件热重载后仍能找回正在运行的 Kaggle 会话，避免远端 GPU
 * 空烧每周配额。记录里含远端 Bearer Token，因此：
 *  - 只写工作区私有目录，目录 0700、文件 0600（Windows 忽略 mode 差异）；
 *  - 落盘用「同目录临时文件 + rename」原子替换，崩溃只会留下可忽略的临时文件；
 *  - 读取时校验版本与关键字段，损坏 / 旧版本记录直接清理，不抛异常；
 *  - token 只在这里落盘，不进入任何日志或对外快照。
 */

import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { workspaceRoot } from '../paths.js'

export const SESSION_RECORD_VERSION = 1

const IMAGEN_DIR = '.imagen'
const SESSION_FILE = 'session.json'

/** 记录文件的绝对路径。 */
export function sessionRecordPath(ctx) {
  return join(workspaceRoot(ctx), IMAGEN_DIR, SESSION_FILE)
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * 从会话快照与 secret 组装落盘记录；没有可恢复信息时返回 null。
 * 正常启动流程在 Kernel 目录构建完成后调用，此时 kernelId / token / topic 都已就绪。
 */
export function buildSessionRecord(session = {}, secret = {}) {
  const token = stringOrNull(secret?.token)
  const kernelId = stringOrNull(session?.kernelId)
  const topic = stringOrNull(secret?.topic)
  const endpointUrl = stringOrNull(session?.endpointUrl)
  if (!token || (!kernelId && !topic && !endpointUrl)) return null
  return {
    version: SESSION_RECORD_VERSION,
    savedAt: new Date().toISOString(),
    kernelId,
    kernelUrl: stringOrNull(session?.kernelUrl),
    kernelStatus: stringOrNull(session?.kernelStatus),
    token,
    topic,
    endpointUrl,
    presetId: stringOrNull(session?.presetId),
    startedAt: stringOrNull(session?.startedAt),
    readyAt: stringOrNull(session?.readyAt),
    idleTimeoutSec: numberOrNull(session?.idleTimeoutSec),
    modelId: stringOrNull(session?.modelId),
    device: stringOrNull(session?.device),
    deviceCount: numberOrNull(session?.deviceCount),
    tunnelProvider: stringOrNull(session?.tunnelProvider),
    state: stringOrNull(session?.state),
  }
}

/** 校验并归一化一条记录；版本不符或缺关键字段返回 null。 */
function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== SESSION_RECORD_VERSION) return null
  const token = stringOrNull(value.token)
  const kernelId = stringOrNull(value.kernelId)
  const topic = stringOrNull(value.topic)
  const endpointUrl = stringOrNull(value.endpointUrl)
  // 没有 token 无法向远端探活/关机；没有任何地址线索也无法恢复，按无效记录处理。
  if (!token || (!kernelId && !topic && !endpointUrl)) return null
  return {
    version: SESSION_RECORD_VERSION,
    savedAt: stringOrNull(value.savedAt),
    kernelId,
    kernelUrl: stringOrNull(value.kernelUrl),
    kernelStatus: stringOrNull(value.kernelStatus),
    token,
    topic,
    endpointUrl,
    presetId: stringOrNull(value.presetId),
    startedAt: stringOrNull(value.startedAt),
    readyAt: stringOrNull(value.readyAt),
    idleTimeoutSec: numberOrNull(value.idleTimeoutSec),
    modelId: stringOrNull(value.modelId),
    device: stringOrNull(value.device),
    deviceCount: numberOrNull(value.deviceCount),
    tunnelProvider: stringOrNull(value.tunnelProvider),
    state: stringOrNull(value.state),
  }
}

/** 清掉上次进程中断时留下的临时文件（只清本记录文件的命名前缀）。 */
async function removeStaleTemps(dir) {
  const entries = await readdir(dir).catch(() => [])
  const prefix = `${SESSION_FILE}.tmp-`
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => {})),
  )
}

/** 原子写入会话记录；目录与文件权限尽力收紧（Windows 忽略 mode 差异）。 */
export async function writeSessionRecord(ctx, record) {
  if (!record) return null
  const path = sessionRecordPath(ctx)
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
  await removeStaleTemps(dir)

  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  const text = `${JSON.stringify({ ...record, version: SESSION_RECORD_VERSION, savedAt: new Date().toISOString() }, null, 2)}\n`
  await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  await chmod(path, 0o600).catch(() => {})
  return { ...record, version: SESSION_RECORD_VERSION }
}

/** 删除记录文件（best-effort，不抛异常）。 */
export async function clearSessionRecord(ctx) {
  const path = sessionRecordPath(ctx)
  await rm(path, { force: true }).catch(() => {})
  await removeStaleTemps(dirname(path))
}

/**
 * 读取会话记录。
 * 无文件 → null（正常首次启动）；JSON 损坏 / 版本过旧 / 缺关键字段 → 清理后返回 null。
 * 所有失败都不抛异常：恢复失败只是少一次机会，不能阻塞 Host 启动。
 */
export async function readSessionRecord(ctx) {
  const path = sessionRecordPath(ctx)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // ENOENT 是正常情况；读取失败（权限等）同样按无记录处理，但不删除文件。
    return null
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const record = parsed ? normalizeRecord(parsed) : null
  if (record) return record

  // 损坏 / 旧版本 / 缺关键字段：清理掉，避免每次启动反复解析失败。
  await rm(path, { force: true }).catch(() => {})
  await removeStaleTemps(dirname(path))
  return null
}