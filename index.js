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
import { createKaggleLogin } from './lib/kaggle-oauth.js'
import { buildDiagnosticEnv } from './lib/diagnostics.js'
import { createKaggleTransport } from './lib/kaggle-transport.js'
import { createLogger, installFileLog } from './lib/log.js'
import { DEFAULT_PRESET, presetById, publicPresets } from './lib/presets.js'
import { registerRoutes, toInt } from './lib/route-kit.js'
import { createFileRoutes } from './lib/routes/files.js'
import { createJobRoutes } from './lib/routes/jobs.js'
import { createKaggleRoutes } from './lib/routes/kaggle.js'
import { createLibraryRoutes } from './lib/routes/library.js'
import { createLogRoutes } from './lib/routes/logs.js'
import { createPromptRoutes } from './lib/routes/prompts.js'
import { createSessionRoutes } from './lib/routes/session.js'
import { createSettingsRoutes } from './lib/routes/settings.js'
import { createUiStateRoutes } from './lib/routes/ui-state.js'
import { SessionManager } from './lib/session.js'
import { createSettingsStore } from './lib/settings.js'
import { registerTools } from './lib/tools.js'

export const name = 'our-imagen'
// cordis 的服务访问是严格的：没有在 inject 里声明过的服务，读取属性会直接抛错，
// 因此 tools 必须显式声明（它同时是 Agent 工具注册的依赖）。
export const inject = ['webServer', 'subprocess', 'tools']

const log = createLogger({ scope: 'index' })

export function apply(ctx, config = {}) {
  // 本地滚动日志：尽早安装，保证后续模块（含模块级 createLogger）的日志都能落盘。
  const fileLog = installFileLog(ctx)
  const defaultPreset = presetById(config.defaultPreset ?? DEFAULT_PRESET).id
  const devEndpoint = config.devEndpoint ?? process.env.OUR_IMAGEN_ENDPOINT ?? null
  const devToken = config.devToken ?? process.env.OUR_IMAGEN_TOKEN ?? 'dev-token'

  // probe：当前探测状态；lastGood：最近一次成功结果（配额不可用时客户端回退展示）。
  const cache = { probe: null, probeAt: 0, probing: null, lastGood: null, lastGoodAt: null }

  // 运行设置：磁盘覆盖项（工作台设置抽屉保存）与静态 config 合并后的生效值。
  // 构造时立即异步加载 `.imagen/settings.json`；读取失败静默降级为仅静态 config。
  const settings = createSettingsStore({ ctx, config })
  void settings.whenReady()

  // Kaggle 访问方式（v0.9 M2 试验特性）：cli = 本机 CLI（默认）；direct = Node 直连 Kaggle API。
  // 传输层每次调用都读最新设置，因此在工作台里切换后，下一次探测 / 唤醒 / 状态轮询即生效。
  const kaggleTransport = createKaggleTransport({ ctx, getSettings: () => settings.current(), log })

  // 内置 OAuth 登录（直连模式用）：单实例，成功凭据写入 ~/.kaggle/credentials.json（与 CLI 同格式）。
  // 与传输方式解耦：CLI 模式下也能调用（两者写同一份凭据文件）。
  const kaggleLogin = createKaggleLogin({ ctx, log })

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
    // 每次启动会话前读取最新合并设置（工作台修改后无需重启插件即可在下次唤醒生效）。
    // Kaggle 相关调用统一经传输层分发：cli / direct 同形状，SessionManager 状态机不感知差异。
    deps: {
      getSettings: () => settings.current(),
      kaggleUsername: (context) => kaggleTransport.kaggleUsername(context),
      pushKernel: (context, folder, options) => kaggleTransport.pushKernel(context, folder, options),
      kernelStatus: (context, kernelId) => kaggleTransport.kernelStatus(context, kernelId),
      kernelLogs: (context, kernelId) => kaggleTransport.kernelLogs(context, kernelId),
    },
  })

  const queue = new JobQueue({
    ctx,
    session,
    defaultPreset,
    options: {
      sessionWaitMs: toInt(config.sessionWaitMinutes, TIMEOUTS.sessionWaitMs / 60000, 5, 240) * 60 * 1000,
      generateTimeoutMs: toInt(config.generateTimeoutSeconds, TIMEOUTS.remoteJobMs / 1000, 30, 1800) * 1000,
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
    // 当前生效的 Kaggle 访问方式（客户端据此把「CLI」字样切为「直连」、决定指引卡主操作）。
    kaggleTransport: kaggleTransport.id(),
  })

  const probes = {
    async run() {
      if (cache.probing) return cache.probing
      cache.probing = (async () => {
        try {
          const probe = await kaggleTransport.probeKaggle(ctx)
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
    // 诊断环境指纹只在 /logs 响应里下发：只含布尔开关、版本号与毫秒耗时，不含配置原文。
    ...createLogRoutes({
      session,
      log,
      ctx,
      env: () => buildDiagnosticEnv({ config, session, settings: settings.current() }),
    }),
    ...createJobRoutes({ ctx, queue, log }),
    ...createFileRoutes({ ctx, log }),
    ...createLibraryRoutes({ ctx, log }),
    ...createPromptRoutes({ ctx, log }),
    // 运行设置：GET 读脱敏视图 / POST 保存覆盖项（hfToken 只回布尔与来源）。
    ...createSettingsRoutes({ settings, session, log }),
    // 工作台界面状态：GET 读归一化视图 / POST 合并白名单字段（同一 path、method 分发）。
    ...createUiStateRoutes({ ctx, log }),
    // Kaggle 直连登录（试验特性）：GET 读登录态 / POST 发起、取消或提交授权码（同一 path、method 分发）。
    ...createKaggleRoutes({ login: kaggleLogin, log }),
  ])

  registerTools(ctx, { queue, session, defaultPreset })

  // DSH 重启或插件热重载后：
  //  1. 先补发上次卸载失败的关机（释放 Kernel 占用的每周 GPU 配额）；
  //  2. 再尝试从 <workspace>/.imagen/session.json 恢复仍在运行的会话（restore 自行清理记录）。
  // 两步顺序执行、各自吞掉异常，都不阻塞插件加载。
  void (async () => {
    try {
      await session.cleanupPendingSession()
    } catch (error) {
      log.warn('启动补清理待关机会话异常（已忽略）', error?.message ?? error)
    }
    try {
      await session.restore()
    } catch (error) {
      log.warn('启动恢复会话异常（已忽略）', error?.message ?? error)
    }
  })()

  ctx.effect(
    () => () => {
      session.dispose()
      queue.dispose()
      // 登录管理器可能正在等待浏览器回调：卸载时取消并释放回环端口（不阻塞卸载）。
      void kaggleLogin.dispose()
      // 卸载尽力 flush 后关闭文件日志；不阻塞插件卸载，异常在 dispose 内部吞掉。
      void fileLog.dispose()
    },
    'imagen:dispose',
  )
}