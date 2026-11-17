/**
 * 落盘文件权限断言：目录 0700、文件 0600。
 *
 * Windows 不区分 POSIX mode，一律跳过（读到的 mode 不可信）。
 */

import { stat } from 'node:fs/promises'

/** 当前平台是否跳过 mode 断言。 */
export const modeUnsupported = process.platform === 'win32'

function octal(mode) {
  return `0${(mode & 0o777).toString(8)}`
}

/**
 * 读取目录 / 文件权限（已去掉文件类型位）。
 *
 * @param {string} dirPath
 * @param {string} filePath
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function verifyMode(dirPath, filePath) {
  if (modeUnsupported) return { ok: true, detail: 'Windows 跳过 mode 断言' }
  const dirMode = (await stat(dirPath)).mode & 0o777
  const fileMode = (await stat(filePath)).mode & 0o777
  return {
    ok: dirMode === 0o700 && fileMode === 0o600,
    detail: `目录 ${octal(dirMode)} / 文件 ${octal(fileMode)}`,
  }
}

/**
 * 断言目录 0700、文件 0600；不符合时抛错（Windows 直接返回）。
 *
 * @param {string} dirPath
 * @param {string} filePath
 */
export async function assertMode(dirPath, filePath) {
  const { ok, detail } = await verifyMode(dirPath, filePath)
  if (!ok) throw new Error(`权限应为目录 0700 / 文件 0600，实际 ${detail}`)
}
