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

export const VERSION = '0.4.1'

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
  remoteGenerateMs: 300000,
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
  // 客户端
  clientProbeMs: 45000,
  clientStatePollMs: 10000,
  clientStateActivePollMs: 2000,
  clientLogsPollMs: 2000,
}

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
 * 模型预设目录（唯一数据来源）。
 *
 * 数字来自 docs/SPEC.md 第 4 节的 T4 实测；未实测的字段为 null，
 * UI 显示"待测"，不得用上游宣称值顶替。
 *
 * `pipeline` 是下发给远端 Daemon 的加载描述（字段见 remote/daemon.py 顶部说明）：
 * Daemon 不认识预设 id，只按 loader 分支加载，因此新增预设不需要改 Python。
 */
const SDXL_ALLOW = [
  'model_index.json',
  '**/config.json',
  '**/*.json',
  '**/*.txt',
  '**/*.fp16.safetensors',
]

export const PRESETS = [
  {
    id: 'sdxl-lightning',
    label: '默认 · 1024 快档',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning',
    params: '3.5B + LoRA',
    license: 'OpenRAIL++',
    licenseKind: 'open',
    gated: false,
    gpus: 1,
    downloadGb: 6.78,
    size: 1024,
    steps: 4,
    cfg: 0,
    peakVramMb: 10347,
    loadSeconds: 7.7,
    steadySeconds: 6.2,
    tier: 'fast',
    negativeHint: 'blurry, low quality, deformed, extra limbs',
    sizeOptions: [768, 1024, 1152],
    pipeline: {
      loader: 'sdxl-lora',
      base: 'stabilityai/stable-diffusion-xl-base-1.0',
      lora: {
        repo: 'ByteDance/SDXL-Lightning',
        weight: 'sdxl_lightning_4step_lora.safetensors',
      },
      scheduler: { type: 'euler', timestepSpacing: 'trailing' },
      variant: 'fp16',
      // 远端下载权重的估算体积（GiB）：daemon 在下载前做磁盘预检。
      downloadGb: 6.78,
      allowPatterns: SDXL_ALLOW,
      deviceMap: null,
    },
  },
  {
    id: 'sdxl-turbo',
    label: '极速草稿',
    repo: 'stabilityai/sdxl-turbo',
    params: '3.5B',
    license: '非商用研究许可',
    licenseKind: 'restricted',
    gated: false,
    gpus: 1,
    downloadGb: 6.62,
    size: 512,
    steps: 4,
    cfg: 0,
    peakVramMb: 7666,
    loadSeconds: 4.0,
    steadySeconds: 1.87,
    tier: 'fast',
    negativeHint: 'blurry, low quality',
    sizeOptions: [512, 768, 1024],
    pipeline: {
      loader: 'sdxl',
      base: 'stabilityai/sdxl-turbo',
      lora: null,
      scheduler: null,
      variant: 'fp16',
      downloadGb: 6.62,
      allowPatterns: SDXL_ALLOW,
      deviceMap: null,
    },
  },
  {
    id: 'sdxl-base',
    label: '标准 1024',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0',
    params: '3.5B',
    license: 'OpenRAIL++',
    licenseKind: 'open',
    gated: false,
    gpus: 1,
    downloadGb: 6.78,
    size: 1024,
    steps: 25,
    cfg: 7.5,
    peakVramMb: 9966,
    loadSeconds: 5.8,
    steadySeconds: 27.8,
    tier: 'usable',
    negativeHint: 'blurry, low quality, deformed, extra limbs',
    sizeOptions: [768, 1024, 1152],
    pipeline: {
      loader: 'sdxl',
      base: 'stabilityai/stable-diffusion-xl-base-1.0',
      lora: null,
      scheduler: null,
      variant: 'fp16',
      downloadGb: 6.78,
      allowPatterns: SDXL_ALLOW,
      deviceMap: null,
    },
  },
  {
    id: 'flux2-klein-4b',
    label: '质量优先',
    repo: 'black-forest-labs/FLUX.2-klein-4B',
    params: '3.88B',
    license: 'Apache-2.0',
    licenseKind: 'open',
    gated: false,
    gpus: 2,
    downloadGb: 15.2,
    size: 1024,
    steps: 4,
    cfg: 1.0,
    peakVramMb: 7929,
    loadSeconds: 28.2,
    steadySeconds: 10.24,
    tier: 'fast',
    negativeHint: '',
    sizeOptions: [768, 1024],
    pipeline: {
      loader: 'flux2',
      base: 'black-forest-labs/FLUX.2-klein-4B',
      lora: null,
      scheduler: null,
      variant: 'fp16',
      downloadGb: 15.2,
      allowPatterns: null,
      deviceMap: 'balanced',
    },
  },
]

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