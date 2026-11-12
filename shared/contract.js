/**
 * 全仓唯一契约源（Host / Web Client / Daemon 注入配置共用）。
 *
 * 约定：
 *  - 本文件只允许纯数据与纯函数，不得 import `node:*` 或任何运行时模块，
 *    否则会被打进浏览器 bundle。
 *  - 凡是「跨文件 / 跨端共享」的量（路由、错误码、参数边界、预设、协议字段）都写在这里，
 *    其它位置只能引用，不得重新定义。
 *  - 修改后运行 `node test/check-contract.mjs`：它校验 Host 路由注册、客户端文案、
 *    daemon 版本与文档表格是否跟随本文件。
 *  - 远端 daemon 无法 import JS，由 `lib/kernel.js` 把 `daemonContract()` 的返回值
 *    随注入配置下发（见 `remote/daemon.py` 的 config 解析）。
 */

export const VERSION = '0.7.0'

/**
 * Host HTTP 路由表（index.js 注册时必须逐一对应）。
 * `path` 为宿主注册的绝对路径；客户端请求用 `clientPath()` 得到相对路径，
 * 保持与改动前完全一致的解析方式（`new URL(relative, document.baseURI)`）。
 */
export const ROUTES = {
  state: { method: 'GET', path: '/imagen-api/state' },
  probe: { method: 'POST', path: '/imagen-api/probe' },
  // 远端运行日志（把 daemon 的日志环透传给工作台日志抽屉）。
  logs: { method: 'GET', path: '/imagen-api/logs' },
  sessionStart: { method: 'POST', path: '/imagen-api/session/start' },
  sessionStop: { method: 'POST', path: '/imagen-api/session/stop' },
  generate: { method: 'POST', path: '/imagen-api/generate' },
  job: { method: 'GET', path: '/imagen-api/job' },
  jobs: { method: 'GET', path: '/imagen-api/jobs' },
  history: { method: 'GET', path: '/imagen-api/history' },
  file: { method: 'GET', path: '/imagen-api/file' },
  library: { method: 'GET', path: '/imagen-api/library' },
  libraryFavorite: { method: 'POST', path: '/imagen-api/library/favorite' },
  libraryDelete: { method: 'POST', path: '/imagen-api/library/delete' },
  enhance: { method: 'POST', path: '/imagen-api/enhance' },
  intent: { method: 'POST', path: '/imagen-api/intent' },
  reveal: { method: 'POST', path: '/imagen-api/reveal' },
}

/** 客户端请求用的相对路径（与改造前 `request('imagen-api/state')` 完全同形）。 */
export function clientPath(route) {
  return route.path.replace(/^\//, '')
}

/**
 * 参数硬性约束与自动钳制（Host `lib/jobs.js` 与 Client `src/logic/*` 共用）。
 * 值是"钳制边界"而不是"校验报错边界"：越界一律自动校正，见 docs/SPEC.md §2.2。
 */
export const LIMITS = {
  prompt: { maxChars: 2000 },
  negativePrompt: { maxChars: 1000 },
  width: { min: 256, max: 1536, step: 8 },
  height: { min: 256, max: 1536, step: 8 },
  steps: { min: 1, max: 60 },
  cfg: { min: 0, max: 20 },
  count: { min: 1, max: 4 },
  // Kaggle / torch 侧接受 32 位有符号正整数；两端必须用同一个上界，否则用户输入的
  // seed 会被宿主静默取模改写，导致「带回参数」复现不出同一张图。
  seed: { max: 2147483647 },
  waitSeconds: { min: 0, max: 600, default: 90 },
  queue: { maxPending: 20, maxKept: 60 },
  history: { defaultLimit: 30, maxLimit: 100 },
  jobs: { defaultLimit: 20, maxLimit: 100 },
  historyTool: { defaultLimit: 5, maxLimit: 30 },
  libraryDelete: { maxPaths: 200 },
  intentText: { maxChars: 2000 },
}

/** 宿主与远端之间共享的超时（毫秒）。远端层不再各自保留默认值。 */
export const TIMEOUTS = {
  // 远端 HTTP
  remoteHealthMs: 4000,
  remoteLogsMs: 4000,
  // 生成任务：远端改为异步 job（POST /generate 只入队，GET /job 轮询）。
  // 提交与轮询都是短请求，长耗时只存在于远端队列里，隧道/代理不会因为长连接空闲掐断。
  remoteSubmitMs: 15000,
  remoteJobRequestMs: 8000,
  remoteJobPollMs: 2000,
  // 单个任务整体预算（可在配置里用 generateTimeoutSeconds 覆盖）。
  remoteJobMs: 600000,
  // 出图轮询容错（P0-A3）：隧道重建期间 GET /job 会成串失败，旧实现在第 6 次
  // 连续失败（约 12~60 秒）就判任务失败，把仍在远端算图的任务判死。改为按
  // 「连续失败持续时长」容忍，并在窗口用尽后用同一 jobId 幂等重投接回任务。
  remoteJobPollFailureGraceMs: 120000,
  // 失败重试的指数退避上限：隧道重建期不打满远端，恢复后又能快速接上。
  remoteJobPollBackoffMaxMs: 8000,
  // 幂等重投次数上限：daemon 保留窗口为 600s / 最多 8 个已完成 job，
  // 超窗重投会重新入队出图（重复消耗 GPU），所以必须限次。
  remoteJobResumeMaxAttempts: 2,
  remoteShutdownMs: 3000,
  remoteGenerateMaxBytes: 32 * 1024 * 1024,
  // ntfy 会合轮询单次请求
  ntfyPollMs: 8000,
  // 会话状态机
  sessionTickMs: 3000,
  kernelPollMs: 30000,
  healthyPollMs: 10000,
  readyHealthMissesBeforeCheck: 3,
  reconnectMaxAttempts: 1,
  recoveryMs: 120000,
  // 恢复窗口续期上限：ready 失联后每向 Kaggle 确认一次 Kernel 仍 RUNNING，
  // 就把 recoveryMs 窗口续期一轮；续期用尽仍恢复不了才判定 health_failed。
  // 总兜底时长约 recoveryMs + recoveryMaxRenewals × kernelPollMs（约 7 分钟），
  // 避免隧道重建稍久就杀掉一个仍在 RUNNING 的 Kernel（重新排队代价很高）。
  recoveryMaxRenewals: 10,
  provisionMs: 45 * 60 * 1000,
  tunnelMs: 15 * 60 * 1000,
  sessionWaitMs: 45 * 60 * 1000,
  idleShutdownSec: 1800,
  kernelRunMaxSec: 10800,
  // 宿主本地动作
  revealWaitMs: 1500,
  bodyMaxBytes: 256 * 1024,
  // kaggle CLI
  cliMs: 30000,
  cliQuotaMs: 20000,
  cliPushMs: 180000,
  cliLogsMs: 45000,
  cliOutputMs: 180000,
  // 客户端
  clientProbeMs: 45000,
  clientStatePollMs: 10000,
  clientStateActivePollMs: 2000,
  clientLogsPollMs: 2000,
}

/**
 * 画面比例与风格 id 的唯一来源。
 *
 * 前端 `src/studio/ratios.js` / `capsules.js` 只保留「id → 尺寸 / 词表」的数据，
 * 顺序与合法取值以本文件为准；`lib/intent.js` 校验模型返回的 clarify 也引用这里。
 */
export const RATIO_IDS = ['1:1', '16:9', '9:16', '4:3', '3:4']

export const STYLE_IDS = ['film', 'concept', 'cyberpunk', 'ink', 'clay']

/**
 * 错误码词表（唯一来源）。
 *
 * layer 说明：
 *  - host：宿主 index.js / lib 产生，必须配客户端文案；
 *  - remote：远端 daemon 产生，Host 透传给客户端，必须配客户端文案；
 *  - client：客户端本地合成（网络层 / 交互校验），由客户端自己解释。
 * status 仅对 host 有意义：异常响应的 HTTP 状态码。
 * 客户端文案键为 `error.code.<code>`，缺一条 `test/check-contract.mjs` 会失败。
 */
export const ERROR_CODES = {
  // ---- Host ----
  invalid_body: { layer: 'host', status: 400 },
  invalid_request: { layer: 'host', status: 400 },
  invalid_prompt: { layer: 'host', status: 400 },
  invalid_path: { layer: 'host', status: 400 },
  too_many: { layer: 'host', status: 400 },
  not_found: { layer: 'host', status: 404 },
  output_missing: { layer: 'host', status: 404 },
  reveal_failed: { layer: 'host', status: 500 },
  internal_error: { layer: 'host', status: 500 },
  // 远端日志拉取失败：会话在但 daemon 不可达 / 协议漂移，客户端降级展示原因。
  logs_unavailable: { layer: 'host' },
  queue_full: { layer: 'host', status: 400 },
  stopped: { layer: 'host' },
  session_absent: { layer: 'host' },
  session_timeout: { layer: 'host' },
  session_error: { layer: 'host' },
  empty_result: { layer: 'host' },
  generate_failed: { layer: 'host' },
  disposed: { layer: 'host' },
  auth_required: { layer: 'host' },
  cli_missing: { layer: 'host' },
  cli_timeout: { layer: 'host' },
  push_failed: { layer: 'host' },
  queue_timeout: { layer: 'host' },
  tunnel_timeout: { layer: 'host' },
  health_failed: { layer: 'host' },
  remote_error: { layer: 'host' },
  session_ended: { layer: 'host' },
  unknown: { layer: 'host' },
  // ---- Remote daemon ----
  unauthorized: { layer: 'remote' },
  load_failed: { layer: 'remote' },
  generation_failed: { layer: 'remote' },
  oom: { layer: 'remote' },
  // ---- Client ----
  warming: { layer: 'client' },
  timeout: { layer: 'client' },
  network: { layer: 'client' },
  need_prompt: { layer: 'client' },
  delete_failed: { layer: 'client' },
  probe_failed: { layer: 'client' },
}

/** 宿主通过 HTTP 返回的错误码（含远端透传）。 */
export function hostErrorCodes() {
  return Object.entries(ERROR_CODES)
    .filter(([, value]) => value.layer === 'host' || value.layer === 'remote')
    .map(([code]) => code)
}

/**
 * 远端 daemon 协议（Host 客户端与 daemon 实现共用）。
 * daemon 侧字段见 remote/daemon.py 顶部说明；这里是唯一的字段/取值清单。
 *
 * 注入配置的键由 `lib/session/provisioner.js` 的 buildKernelConfig 组装，
 * daemon 侧的接受清单是 `remote/daemon.py` 的 _KNOWN_CONFIG_KEYS——两处各管一端，
 * 本文件不再维护第三份副本。
 */
export const PROTOCOL = {
  daemon: {
    routes: {
      health: { method: 'GET', path: '/health' },
      logs: { method: 'GET', path: '/logs' },
      generate: { method: 'POST', path: '/generate' },
      // 异步 job：POST /generate 只入队并返回 job_id，Host 用 GET /job?id= 轮询。
      job: { method: 'GET', path: '/job' },
      shutdown: { method: 'POST', path: '/shutdown' },
    },
    // /health.phase 的完整取值域；未知值按 warming 处理。
    healthPhases: ['booting', 'installing', 'loading', 'ready', 'error'],
    ntfyEvents: ['ready', 'error'],
    // 隧道提供方：cloudflare = quick tunnel 默认通道；custom = 用户配置的备用命令
    // （自建 FRP / 其他 HTTPS 隧道）。ready 事件与 /health 用同一组取值。
    tunnelProviders: ['cloudflare', 'custom'],
  },
}

/**
 * 模型预设目录：唯一数据来源是仓库根目录的 models/*.json。
 *
 * 修改模型请编辑 models/<id>.json，然后运行 `npm run models:build` 生成
 * `shared/models.generated.js`；本文件只做 re-export，不在这里手写预设数据。
 * `node test/check-contract.mjs` 会校验生成文件是否与 models/ 同步。
 *
 * 每个预设的 `pipeline` 是下发给远端 Daemon 的加载描述（字段见 remote/daemon.py
 * 顶部说明）：Daemon 不认识预设 id，只按 loader 分支加载，因此新增预设不需要改 Python。
 */
import { PRESETS } from './models.generated.js'

export { PRESETS }

export const DEFAULT_PRESET = 'sdxl-lightning'

/** 按 id 取预设；未知 id 回退到默认项。 */
export function presetById(id) {
  return PRESETS.find((item) => item.id === id) ?? PRESETS.find((item) => item.id === DEFAULT_PRESET)
}

/** 面向 Client 的精简视图（去掉下发远端用的 pipeline 细节，避免双份真相）。 */
export function publicPresets() {
  return PRESETS.map(({ pipeline, ...rest }) => rest)
}

/**
 * 下发给远端 daemon 的契约子集（经 lib/kernel.js 注入为 `config.contract`；
 * 同一份对象由 `tools/gen-contract-json.mjs` 落盘为 `remote/contract.json` 供 mock 使用）。
 *
 * 只保留 Python 容器实际消费的元数据：`daemon.py` 读取 `contract.version`
 * （protocol_version）与 `contract.limits`（_limit_spec / _max_tasks）。宿主路由、
 * health phase、ntfy 事件与错误码都只属于 Host/Client，不下发远端。
 */
export function daemonContract() {
  return {
    version: VERSION,
    limits: {
      width: LIMITS.width,
      height: LIMITS.height,
      steps: LIMITS.steps,
      cfg: LIMITS.cfg,
      count: LIMITS.count,
      seed: LIMITS.seed,
      prompt: LIMITS.prompt,
      negativePrompt: LIMITS.negativePrompt,
      historyTool: LIMITS.historyTool,
    },
  }
}