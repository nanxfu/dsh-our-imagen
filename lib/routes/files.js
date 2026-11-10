/**
 * 本地产物相关路由：图片读取（含 HEAD）、在文件管理器里打开产物目录。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源）。
 */

import { readFile } from 'node:fs/promises'

import { ROUTES, TIMEOUTS } from '../../shared/contract.js'
import { sendError, sendJson } from '../http.js'
import { contentTypeOf, resolveOutputDir, resolveOutputPath } from '../paths.js'
import { parseQuery, readBodyOr } from '../route-kit.js'

/**
 * 在系统文件管理器里打开产物目录。
 *
 * explorer.exe 打开目录后往往以非 0 退出，这里只关心进程能否起来，
 * 不把退出码当失败；等待最多 TIMEOUTS.revealWaitMs，避免请求被文件管理器拖住。
 */
async function revealFolder(ctx, dir, log) {
  const platform = process.platform
  const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
  const exe = await ctx.subprocess.resolveExecutable(command)
  const handle = ctx.subprocess.spawn({
    argv: [exe, dir],
    cwd: dir,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4 * 1024 },
      stderr: { maxBytes: 4 * 1024 },
    },
    graceMs: 2000,
  })
  const done =
    handle && typeof handle.done?.then === 'function'
      ? handle.done.catch((error) => {
          log.debug('文件管理器进程异常退出（忽略）', error?.message ?? error)
          return null
        })
      : Promise.resolve(null)
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, TIMEOUTS.revealWaitMs))])
}

/**
 * @param {{ ctx: object, log: object }} deps
 */
export function createFileRoutes({ ctx, log }) {
  return [
    {
      name: 'file',
      path: ROUTES.file.path,
      // 契约只登记 GET；HEAD 是同一资源的读取语义，沿用拆分前的行为。
      method: ['GET', 'HEAD'],
      async handler(req, res) {
        const requested = parseQuery(req, log).get('path') ?? ''
        const found = await resolveOutputPath(ctx, requested).catch((error) => {
          // 越界/不存在的路径是预期输入，按 404 处理即可。
          log.debug('产物路径解析失败（按 404 处理）', error?.message ?? error)
          return null
        })
        if (!found) return sendError(res, 404, 'not_found', '文件不存在或不在输出目录内')
        const data = await readFile(found.absolute).catch((error) => {
          // 校验通过后仍读不到，通常是被并发删除或权限问题，需要留痕。
          log.warn('产物文件读取失败', error?.message ?? error)
          return null
        })
        if (!data) return sendError(res, 404, 'not_found', '文件读取失败')
        res.writeHead(200, {
          'content-type': contentTypeOf(found.absolute),
          'content-length': String(data.length),
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(req.method === 'HEAD' ? undefined : data)
      },
    },
    {
      name: 'reveal',
      path: ROUTES.reveal.path,
      method: ROUTES.reveal.method,
      async handler(req, res) {
        const body = await readBodyOr(req, {}, log)
        const dir = await resolveOutputDir(ctx)
        if (!dir) return sendError(res, 404, 'output_missing', '产物目录还不存在，先出一张图')
        // dryRun 供无界面环境自检：只解析目录，不真的唤起文件管理器。
        if (body && body.dryRun === true) return sendJson(res, 200, { ok: true, dryRun: true, dir })
        try {
          await revealFolder(ctx, dir, log)
          sendJson(res, 200, { ok: true, dir })
        } catch (error) {
          sendError(res, 500, 'reveal_failed', String(error?.message ?? error))
        }
      },
    },
  ]
}