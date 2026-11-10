/**
 * DSH 插件宿主端 (Host)
 *
 * 职责（协议见 docs/SPEC.md）：
 *  - 维护单例远端会话（Kaggle Kernel + Cloudflare 隧道）的生命周期；
 *  - 串行执行出图任务并把图片落到 `<workspace>/imagen-output/`；
 *  - 向 Web Client 暴露状态/任务/历史/文件路由（实现在 lib/routes/，本文件只装配）；
 *  - 向 Agent 暴露 imagen_generate / imagen_session / imagen_history 三个工具（lib/tools.js）。
 */

import { TIMEOUTS, VERSION } from './shared/contract.js'
import { JobQueue } from './lib/jobs.js'
import { probeKaggle } from './lib/kaggle.js'
import { createLogger } from './lib/log.js'
import { DEFAULT_PRESET, presetById, publicPresets } from './lib/presets.js'
import { registerRoutes, toInt } from './lib/route-kit.js'
import { createFileRoutes } from './lib/routes/files.js'
import { createJobRoutes } from './lib/routes/jobs.js'
import { createLibraryRoutes } from './lib/routes/library.js'
import { createLogRoutes } from './lib/routes/logs.js'
import { createPromptRoutes } from './lib/routes/prompts.js'
import { createSessionRoutes } from './lib/routes/session.js'
import { SessionManager } from './lib/session.js'
import { registerTools } from './lib/tools.js'

export const name = 'our-free-imagen'
// cordis 的服务访问是严格的：没有在 inject 里声明过的服务，读取属性会直接抛错，
// 因此 tools 必须显式声明（它同时是 Agent 工具注册的依赖）。
export const inject = ['webServer', 'subprocess', 'tools']

const log = createLogger({ scope: 'index' })

export function apply(ctx, config = {}) {
  const defaultPreset = presetById(config.defaultPreset ?? DEFAULT_PRESET).id
  const devEndpoint = config.devEndpoint ?? process.env.OUR_FREE_IMAGEN_ENDPOINT ?? null
  const devToken = config.devToken ?? process.env.OUR_FREE_IMAGEN_TOKEN ?? 'dev-token'

  // probe：当前探测状态；lastGood：最近一次成功结果（配额不可用时客户端回退展示）。
  const cache = { probe: null, probeAt: 0, probing: null, lastGood: null, lastGoodAt: null }

  const session = new SessionManager({
    ctx,
    defaultPreset,
    options: {
      devEndpoint,
      devToken,
      accelerator: config.accelerator ?? 'NvidiaTeslaT4',
      idleTimeoutSec: toInt(config.idleTimeoutSec, TIMEOUTS.idleShutdownSec, 300, 10800),
      provisionTimeoutMs: toInt(config.provisionTimeoutMinutes, TIMEOUTS.provisionMs / 60000, 5, 240) * 60 * 1000,
      // 冷启动可靠性（P1.2）：可选 HuggingFace Token、依赖约束、备用隧道命令。
      hfToken: typeof config.hfToken === 'string' && config.hfToken.trim() ? config.hfToken.trim() : null,
      pipConstraints: Array.isArray(config.pipConstraints) ? config.pipConstraints.filter((item) => typeof item === 'string') : [],
      fallbackTunnelCommand: Array.isArray(config.fallbackTunnelCommand)
        ? config.fallbackTunnelCommand.filter((item) => typeof item === 'string')
        : [],
      // 备用通道的输出格式千差万别（frpc / bore / 自建脚本），允许用户给提取正则。
      fallbackTunnelUrlRegex:
        typeof config.fallbackTunnelUrlRegex === 'string' && config.fallbackTunnelUrlRegex.trim()
          ? config.fallbackTunnelUrlRegex.trim()
          : null,
      // 权重预挂载（P2.1）：kernel 的 dataset_sources 与本地权重目录映射。
      datasetSources: Array.isArray(config.datasetSources) ? config.datasetSources.filter((item) => typeof item === 'string') : [],
      localModels:
        config.localModels && typeof config.localModels === 'object' && !Array.isArray(config.localModels)
          ? config.localModels
          : null,
      // 备用隧道（P2.2）：用户自建通道的域名后缀，用于 Host 侧校验会合地址可信。
      trustedTunnelDomains: Array.isArray(config.trustedTunnelDomains)
        ? config.trustedTunnelDomains.filter((item) => typeof item === 'string')
        : [],
    },
  })

  const queue = new JobQueue({
    ctx,
    session,
    defaultPreset,
    options: {
      sessionWaitMs: toInt(config.sessionWaitMinutes, TIMEOUTS.sessionWaitMs / 60000, 5, 240) * 60 * 1000,
      generateTimeoutMs: toInt(config.generateTimeoutSeconds, TIMEOUTS.remoteGenerateMs / 1000, 30, 1800) * 1000,
    },
  })

  const statePayload = () => ({
    version: VERSION,
    defaultPreset,
    presets: publicPresets(),
    session: session.snapshot(),
    probe: cache.probe,
    probeAt: cache.probeAt,
    probeLastGood: cache.lastGood,
    probeLastGoodAt: cache.lastGoodAt,
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
          // 配额接口偶发不可用：保留最近一次成功结果，客户端可回退展示配额与检查时间。
          if (probe?.auth?.ok === true) {
            cache.lastGood = probe
            cache.lastGoodAt = new Date().toISOString()
          }
          return probe
        } catch (error) {
          // 探测崩溃不等于「环境不可用」，必须留 warn 才能和真正的鉴权失败区分开。
          log.warn('Kaggle 环境探测异常', error?.message ?? error)
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

  registerRoutes(ctx, [
    ...createSessionRoutes({ session, probes, statePayload, defaultPreset, log }),
    ...createLogRoutes({ session, log }),
    ...createJobRoutes({ ctx, queue, log }),
    ...createFileRoutes({ ctx, log }),
    ...createLibraryRoutes({ ctx, log }),
    ...createPromptRoutes({ ctx, log }),
  ])

  registerTools(ctx, { queue, session, defaultPreset })

  // DSH 重启或插件热重载后，远端 Kernel 可能仍在消耗 Kaggle 配额：从工作区
  // <workspace>/.imagen/session.json 尝试恢复连接；无法恢复时由 restore 自行清理记录，
  // 内部吞掉全部异常，不阻塞插件加载。
  void session.restore()

  ctx.effect(
    () => () => {
      session.dispose()
      queue.dispose()
    },
    'imagen:dispose',
  )
}