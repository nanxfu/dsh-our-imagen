/**
 * 本地作品库路由：读取、收藏/取消收藏、批量删除。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源）。
 */

import { unlink } from 'node:fs/promises'

import { LIMITS, ROUTES } from '../../shared/contract.js'
import { sendError, sendJson } from '../http.js'
import { readLibrary, recordDeleted, setFavorite } from '../library.js'
import { resolveOutputPath } from '../paths.js'
import { readBodyOr } from '../route-kit.js'

/**
 * @param {{ ctx: object, log: object }} deps
 */
export function createLibraryRoutes({ ctx, log }) {
  return [
    {
      name: 'library',
      path: ROUTES.library.path,
      method: ROUTES.library.method,
      async handler(req, res) {
        sendJson(res, 200, await readLibrary(ctx))
      },
    },
    {
      name: 'library-favorite',
      path: ROUTES.libraryFavorite.path,
      method: ROUTES.libraryFavorite.method,
      async handler(req, res) {
        const body = await readBodyOr(req, null, log)
        if (!body || typeof body.path !== 'string') return sendError(res, 400, 'invalid_body', '缺少 path')
        const result = await setFavorite(ctx, body.path, body.favorite !== false)
        if (!result.ok) return sendError(res, 400, result.code, '路径无效')
        sendJson(res, 200, result)
      },
    },
    {
      name: 'library-delete',
      path: ROUTES.libraryDelete.path,
      method: ROUTES.libraryDelete.method,
      async handler(req, res) {
        const body = await readBodyOr(req, null, log)
        const requested = Array.isArray(body?.paths) ? body.paths.filter((item) => typeof item === 'string') : []
        if (requested.length === 0) return sendError(res, 400, 'invalid_body', '缺少 paths')
        if (requested.length > LIMITS.libraryDelete.maxPaths) {
          return sendError(res, 400, 'too_many', `一次最多删除 ${LIMITS.libraryDelete.maxPaths} 张`)
        }

        const removed = []
        const failed = []
        for (const path of requested) {
          // 只允许删除 imagen-output 内的文件；解析失败一律拒绝，防止越权。
          const found = await resolveOutputPath(ctx, path).catch((error) => {
            log.debug('待删路径解析失败（按 not_found 记）', error?.message ?? error)
            return null
          })
          if (!found) {
            failed.push({ path, code: 'not_found' })
            continue
          }
          try {
            await unlink(found.absolute)
            removed.push(String(path).replace(/\\/g, '/'))
          } catch (error) {
            failed.push({ path, code: String(error?.code ?? 'unlink_failed') })
          }
        }
        const library = await recordDeleted(ctx, removed)
        sendJson(res, 200, { ok: failed.length === 0, removed, failed, favorites: library.favorites })
      },
    },
  ]
}