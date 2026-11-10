/**
 * DSH 插件宿主端 (Host)
 *
 * 职责（协议见 docs/SPEC.md）：
 *  - 维护单例远端会话（Kaggle Kernel + Cloudflare 隧道）的生命周期；
 *  - 串行执行出图任务并把图片落到 `<workspace>/imagen-output/`；
 *  - 向 Web Client 暴露状态/任务/历史/文件路由；
 *  - 向 Agent 暴露 imagen_generate / imagen_session / imagen_history 三个工具。
 */

import { readFile, unlink } from 'node:fs/promises'

import { methodNotAllowed, readJsonBody, sendError, sendJson } from './lib/http.js'
import { enhancePrompt } from './lib/enhance.js'
import { parseIntent } from './lib/intent.js'
import { JobQueue } from './lib/jobs.js'
import { probeKaggle } from './lib/kaggle.js'
import { readLibrary, recordDeleted, setFavorite } from './lib/library.js'
import { scanHistory } from './lib/output.js'
import { contentTypeOf, resolveOutputDir, resolveOutputPath } from './lib/paths.js'
import { DEFAULT_PRESET, PRESETS, presetById, publicPresets } from './lib/presets.js'
import { SessionManager } from './lib/session.js'

export const name = 'our-free-imagen'
// cordis 的服务访问是严格的：没有在 inject 里声明过的服务，读取属性会直接抛错，
// 因此 tools 必须显式声明（它同时是 Agent 工具注册的依赖）。
export const inject = ['webServer', 'subprocess', 'tools']

const VERSION = '0.3.0'

function parseQuery(req) {
  try {
    return new URL(req.url ?? '/', 'http://placeholder.local').searchParams
  } catch {
    return new URLSearchParams()
  }
}

function toInt(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * 在系统文件管理器里打开产物目录。
 *
 * explorer.exe 打开目录后往往以非 0 退出，这里只关心进程能否起来，
 * 不把退出码当失败；等待最多 1.5 秒，避免请求被文件管理器拖住。
 */
async function revealFolder(ctx, dir) {
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
  const done = handle && typeof handle.done?.then === 'function' ? handle.done.catch(() => null) : Promise.resolve(null)
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 1500))])
}

/** 把 job 折叠成一段给模型看的文字。 */
function describeJob(job) {
  if (!job) return '任务不存在'
  const lines = []
  lines.push(`任务 ${job.id}：${job.status}${job.seconds != null ? `（${job.seconds}s）` : ''}`)
  lines.push(`预设：${job.presetId} · 尺寸 ${job.params.width}×${job.params.height} · ${job.params.steps} 步 · cfg ${job.params.cfg} · seed ${job.params.seed}`)
  if (job.error) lines.push(`错误：${job.error.code} ${job.error.message}`)
  if (job.output?.images?.length) {
    lines.push('产物：')
    for (const image of job.output.images) {
      lines.push(`- ${image.path}（${image.width}×${image.height}，seed ${image.seed}）`)
      if (image.url) lines.push(`  ${image.url}`)
    }
    lines.push('提示：可以直接在回复里用 ![描述](URL) 展示图片。')
  } else if (job.status !== 'done') {
    lines.push('任务仍在进行中，可用 imagen_history 或再次调用查看结果。')
  }
  return lines.join('\n')
}

function describeSession(session) {
  const lines = [
    `会话状态：${session.state}${session.phase ? `（${session.phase}）` : ''}`,
    session.detail ? `说明：${session.detail}` : null,
    session.kernelUrl ? `Kernel：${session.kernelUrl}` : null,
    session.endpointUrl ? `隧道：已建立` : null,
    session.device ? `设备：${session.device}${session.deviceCount ? ` ×${session.deviceCount}` : ''}` : null,
    session.error ? `错误：${session.error.code} ${session.error.message}` : null,
  ]
  return lines.filter(Boolean).join('\n')
}

export function apply(ctx, config = {}) {
  const defaultPreset = presetById(config.defaultPreset ?? DEFAULT_PRESET).id
  const devEndpoint = config.devEndpoint ?? process.env.OUR_FREE_IMAGEN_ENDPOINT ?? null
  const devToken = config.devToken ?? process.env.OUR_FREE_IMAGEN_TOKEN ?? 'dev-token'

  const cache = { probe: null, probeAt: 0, probing: null }

  const session = new SessionManager({
    ctx,
    defaultPreset,
    options: {
      devEndpoint,
      devToken,
      accelerator: config.accelerator ?? 'NvidiaTeslaT4',
      idleTimeoutSec: toInt(config.idleTimeoutSec, 1800, 300, 10800),
      provisionTimeoutMs: toInt(config.provisionTimeoutMinutes, 45, 5, 240) * 60 * 1000,
    },
  })

  const queue = new JobQueue({
    ctx,
    session,
    defaultPreset,
    options: {
      sessionWaitMs: toInt(config.sessionWaitMinutes, 45, 5, 240) * 60 * 1000,
      generateTimeoutMs: toInt(config.generateTimeoutSeconds, 300, 30, 1800) * 1000,
    },
  })

  const statePayload = () => ({
    version: VERSION,
    defaultPreset,
    presets: publicPresets(),
    session: session.snapshot(),
    probe: cache.probe,
    probeAt: cache.probeAt,
    jobs: queue.list(10),
    lastJob: queue.lastFinished,
    queue: queue.queueStats(),
    devMode: Boolean(devEndpoint),
  })

  const probes = {
    async run() {
      if (cache.probing) return cache.probing
      cache.probing = (async () => {
        try {
          const probe = await probeKaggle(ctx)
          cache.probe = probe
          cache.probeAt = Date.now()
          return probe
        } catch (error) {
          const probe = {
            provider: 'kaggle',
            cli: { present: false },
            auth: { ok: false, checkedAt: new Date().toISOString(), errorCode: 'unknown' },
            notes: [String(error?.message ?? error).slice(0, 300)],
          }
          cache.probe = probe
          cache.probeAt = Date.now()
          return probe
        } finally {
          cache.probing = null
        }
      })()
      return cache.probing
    },
  }

  // ---- 路由 ---------------------------------------------------------------

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/state',
        handler(req, res) {
          if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
          sendJson(res, 200, statePayload())
        },
      }),
    'imagen:route-state',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/probe',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const probe = await probes.run()
          sendJson(res, 200, { ok: probe.auth?.ok === true, probe })
        },
      }),
    'imagen:route-probe',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/session/start',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const body = await readJsonBody(req).catch(() => ({}))
          const presetId = typeof body.presetId === 'string' ? body.presetId : defaultPreset
          const snapshot = await session.start(presetById(presetId).id)
          sendJson(res, 200, { ok: snapshot.state !== 'error', session: snapshot })
        },
      }),
    'imagen:route-session-start',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/session/stop',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const snapshot = await session.stop()
          sendJson(res, 200, { ok: true, session: snapshot })
        },
      }),
    'imagen:route-session-stop',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/generate',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          let body
          try {
            body = await readJsonBody(req)
          } catch (error) {
            return sendError(res, 400, 'invalid_body', String(error?.message ?? error))
          }
          const result = queue.submit(body)
          if (!result.ok) return sendError(res, 400, result.code, result.message)
          const waitSeconds = Number(body.waitSeconds) || 0
          const job = waitSeconds > 0 ? await queue.waitFor(result.job.id, waitSeconds) : result.job
          sendJson(res, 200, job)
        },
      }),
    'imagen:route-generate',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/job',
        handler(req, res) {
          if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
          const id = parseQuery(req).get('id') ?? ''
          const job = queue.get(id)
          if (!job) return sendError(res, 404, 'not_found', '任务不存在')
          sendJson(res, 200, job)
        },
      }),
    'imagen:route-job',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/jobs',
        handler(req, res) {
          if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
          const limit = toInt(parseQuery(req).get('limit'), 20, 1, 100)
          sendJson(res, 200, { jobs: queue.list(limit), queue: queue.queueStats() })
        },
      }),
    'imagen:route-jobs',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/history',
        async handler(req, res) {
          if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
          const limit = toInt(parseQuery(req).get('limit'), 30, 1, 100)
          const items = await scanHistory(ctx, limit)
          sendJson(res, 200, { items })
        },
      }),
    'imagen:route-history',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/file',
        async handler(req, res) {
          if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD')
          const requested = parseQuery(req).get('path') ?? ''
          const found = await resolveOutputPath(ctx, requested).catch(() => null)
          if (!found) return sendError(res, 404, 'not_found', '文件不存在或不在输出目录内')
          const data = await readFile(found.absolute).catch(() => null)
          if (!data) return sendError(res, 404, 'not_found', '文件读取失败')
          res.writeHead(200, {
            'content-type': contentTypeOf(found.absolute),
            'content-length': String(data.length),
            'cache-control': 'public, max-age=31536000, immutable',
          })
          res.end(req.method === 'HEAD' ? undefined : data)
        },
      }),
    'imagen:route-file',
  )

  // ---- 本地作品库（收藏 / 删除） ------------------------------------------

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/library',
        async handler(req, res) {
          if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
          sendJson(res, 200, await readLibrary(ctx))
        },
      }),
    'imagen:route-library',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/library/favorite',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const body = await readJsonBody(req).catch(() => null)
          if (!body || typeof body.path !== 'string') return sendError(res, 400, 'invalid_body', '缺少 path')
          const result = await setFavorite(ctx, body.path, body.favorite !== false)
          if (!result.ok) return sendError(res, 400, result.code, '路径无效')
          sendJson(res, 200, result)
        },
      }),
    'imagen:route-library-favorite',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/library/delete',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const body = await readJsonBody(req).catch(() => null)
          const requested = Array.isArray(body?.paths) ? body.paths.filter((item) => typeof item === 'string') : []
          if (requested.length === 0) return sendError(res, 400, 'invalid_body', '缺少 paths')
          if (requested.length > 200) return sendError(res, 400, 'too_many', '一次最多删除 200 张')

          const removed = []
          const failed = []
          for (const path of requested) {
            // 只允许删除 imagen-output 内的文件；解析失败一律拒绝，防止越权。
            const found = await resolveOutputPath(ctx, path).catch(() => null)
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
      }),
    'imagen:route-library-delete',
  )

  // ---- 提示词润色（走宿主已配置的模型） -----------------------------------

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/enhance',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const body = await readJsonBody(req).catch(() => ({}))
          const result = await enhancePrompt(ctx, body?.prompt, {
            locale: body?.locale === 'en' ? 'en' : 'zh',
            presetId: typeof body?.presetId === 'string' ? body.presetId : '',
          })
          sendJson(res, 200, { ok: true, ...result })
        },
      }),
    'imagen:route-enhance',
  )

  // ---- 自然语言意图解析（对话模式） ---------------------------------------

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/intent',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const body = await readJsonBody(req).catch(() => ({}))
          const text = typeof body?.text === 'string' ? body.text.trim() : ''
          if (!text) return sendError(res, 400, 'invalid_request', '对话内容不能为空')
          if (text.length > 2000) return sendError(res, 400, 'invalid_request', '对话内容过长')
          const result = await parseIntent(ctx, {
            text,
            previousPrompt: typeof body?.previousPrompt === 'string' ? body.previousPrompt : '',
            locale: body?.locale === 'en' ? 'en' : 'zh',
          })
          sendJson(res, 200, { ok: true, ...result })
        },
      }),
    'imagen:route-intent',
  )

  // ---- 打开产物文件夹 -----------------------------------------------------

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/imagen-api/reveal',
        async handler(req, res) {
          if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
          const body = await readJsonBody(req).catch(() => ({}))
          const dir = await resolveOutputDir(ctx)
          if (!dir) return sendError(res, 404, 'output_missing', '产物目录还不存在，先出一张图')
          // dryRun 供无界面环境自检：只解析目录，不真的唤起文件管理器。
          if (body && body.dryRun === true) return sendJson(res, 200, { ok: true, dryRun: true, dir })
          try {
            await revealFolder(ctx, dir)
            sendJson(res, 200, { ok: true, dir })
          } catch (error) {
            sendError(res, 500, 'reveal_failed', String(error?.message ?? error))
          }
        },
      }),
    'imagen:route-reveal',
  )

  // ---- Agent 工具 ---------------------------------------------------------

  const toolParameters = {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: '画面描述，建议英文，不超过 2000 字符' },
      negativePrompt: { type: 'string', description: '反向提示词，仅在 cfg > 0 时生效' },
      presetId: {
        type: 'string',
        enum: PRESETS.map((preset) => preset.id),
        description: '模型预设；默认 sdxl-lightning（1024²，4 步，约 6 秒）',
      },
      width: { type: 'integer', description: '宽度 256-1536，默认取预设' },
      height: { type: 'integer', description: '高度 256-1536，默认取预设' },
      steps: { type: 'integer', description: '采样步数 1-60，默认取预设' },
      cfg: { type: 'number', description: 'CFG 0-20，默认取预设' },
      seed: { type: 'integer', description: '随机种子，省略则随机' },
      count: { type: 'integer', description: '张数 1-4，默认 1' },
      waitSeconds: {
        type: 'integer',
        description: '最多等待多少秒（0-600，默认 90）。首次生成需要排队与加载模型时可能超时，超时后任务仍在后台继续',
      },
    },
  }

  const textOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
    },
    render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
  }

  if (ctx.tools) {
    ctx.tools.register({
      name: 'imagen_generate',
      description:
        '在免费的 Kaggle GPU 上运行开源文生图模型并出图，图片会保存到工作区 imagen-output/ 目录。' +
        '首次调用若远端会话未启动，会自动拉起 Kernel（可能需要排队 10 分钟以上），此时建议 waitSeconds 保持较小并稍后用 imagen_history 查看结果。',
      parameters: toolParameters,
      output: textOutput,
      async execute(args = {}) {
        const submitted = queue.submit(args)
        if (!submitted.ok) return { text: `提交失败：${submitted.message}` }
        const waitSeconds = toInt(args.waitSeconds, 90, 0, 600)
        const job = await queue.waitFor(submitted.job.id, waitSeconds)
        return { text: describeJob(job) }
      },
    })

    ctx.tools.register({
      name: 'imagen_session',
      description:
        '管理远端生图会话：start 拉起 Kaggle Kernel（幂等，已在运行则直接返回），stop 关机释放 GPU 配额，status 查看当前状态。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'] },
          presetId: { type: 'string', enum: PRESETS.map((preset) => preset.id) },
        },
      },
      output: textOutput,
      async execute(args = {}) {
        const action = String(args.action ?? 'status')
        if (action === 'start') {
          const snapshot = await session.start(presetById(args.presetId ?? defaultPreset).id)
          return { text: describeSession(snapshot) }
        }
        if (action === 'stop') {
          const snapshot = await session.stop()
          return { text: describeSession(snapshot) }
        }
        return { text: describeSession(session.snapshot()) }
      },
    })

    ctx.tools.register({
      name: 'imagen_history',
      description: '列出最近生成过的图片（工作区 imagen-output/ 下的产物），返回路径与提示词，可用于回填或引用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', description: '返回条数 1-30，默认 5' },
        },
      },
      output: textOutput,
      async execute(args = {}) {
        const limit = toInt(args.limit, 5, 1, 30)
        const items = await scanHistory(ctx, limit)
        if (items.length === 0) return { text: '还没有生成记录。' }
        const lines = []
        for (const item of items) {
          lines.push(`${item.createdAt ?? item.dir} · ${item.presetId ?? '未知预设'}`)
          lines.push(`  ${String(item.prompt ?? '').slice(0, 120)}`)
          for (const image of item.images) lines.push(`  ${image.path}`)
        }
        return { text: lines.join('\n') }
      },
    })
  }

  ctx.effect(
    () => () => {
      session.dispose()
      queue.dispose()
    },
    'imagen:dispose',
  )
}
