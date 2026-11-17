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

export const VERSION = '0.11.0'

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
  // 取消任务：queued / waiting-session 立即出队失效；running 合作式停止（见 JOB_CANCEL）。
  jobCancel: { method: 'POST', path: '/imagen-api/job/cancel' },
  jobs: { method: 'GET', path: '/imagen-api/jobs' },
  // 历史分页：limit / offset 查询参数，响应补 hasMore（向后兼容只读 items 的旧客户端）。
  history: { method: 'GET', path: '/imagen-api/history' },
  // 版本树：按根作品路径（root，工作区相对路径）返回整棵派生树，供作品条版本面板按需展开。
  // 旧宿主没有该路由时客户端按 404 降级为「仅用已加载分页」。
  historyTree: { method: 'GET', path: '/imagen-api/history/tree' },
  file: { method: 'GET', path: '/imagen-api/file' },
  // 本地图片导入（阶段十五 Phase A）：用户选择的 PNG / JPEG 落盘到产物目录并登记为导入作品。
  importFile: { method: 'POST', path: '/imagen-api/import' },
  library: { method: 'GET', path: '/imagen-api/library' },
  libraryFavorite: { method: 'POST', path: '/imagen-api/library/favorite' },
  libraryDelete: { method: 'POST', path: '/imagen-api/library/delete' },
  enhance: { method: 'POST', path: '/imagen-api/enhance' },
  intent: { method: 'POST', path: '/imagen-api/intent' },
  reveal: { method: 'POST', path: '/imagen-api/reveal' },
  // 运行设置抽屉：GET 读脱敏视图（hfToken 只回布尔与来源），POST 保存用户覆盖项。
  settings: { method: 'GET', path: '/imagen-api/settings' },
  settingsSave: { method: 'POST', path: '/imagen-api/settings' },
  // 工作台界面状态（高级设置折叠等）：GET 读归一化视图，POST 合并保存白名单字段。
  uiState: { method: 'GET', path: '/imagen-api/ui-state' },
  uiStateSave: { method: 'POST', path: '/imagen-api/ui-state' },
  // Kaggle 直连登录（试验特性）：GET 读登录态，POST 按 action 发起 / 取消 / 提交授权码。
  kaggleLogin: { method: 'GET', path: '/imagen-api/kaggle/login' },
  kaggleLoginAction: { method: 'POST', path: '/imagen-api/kaggle/login' },
  // Colab Google OAuth 登录：GET 读登录态与授权摘要，POST 按 action 发起 / 取消 / 提交回调或授权码。
  colabLogin: { method: 'GET', path: '/imagen-api/colab/login' },
  colabLoginAction: { method: 'POST', path: '/imagen-api/colab/login' },
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
  // 图生图（M3）参考图：maxBytes 是原始图片字节上限（Host 与 daemon 双重校验，
  // 受 `remoteGenerateMaxBytes`（base64 后体积）约束）；解码后长边超过 maxEdge 由远端
  // 按比例缩小（不超过 minEdge 的图直接拒绝），避免小图放大出噪点、大图占显存。
  reference: { maxBytes: 8 * 1024 * 1024, maxEdge: 1536, minEdge: 128 },
  // 重绘强度：越小越贴近原图，越大越放飞；首期只对 SDXL 家族（supportsImg2Img）开放。
  // 上限按场景区分：`max` 是普通垫图（img2img）的保守上限，避免把原图丢得太狠；
  // `inpaintMax` 是带蒙版局部重绘的上限——9 通道 inpaint 模型在全重绘时需要更高替换力度，
  // 只放宽这一档，img2img 行为完全不变。
  strength: { min: 0.2, max: 0.9, inpaintMax: 1.0, step: 0.05, default: 0.6 },
  // 局部重绘（Inpaint）蒙版：客户端导出的黑白 PNG（白 = 重绘区域，黑 = 保留区域），
  // 与参考图一起提交；尺寸由远端按参考图精确对齐，因此这里只管字节上限与最小覆盖率。
  // `minCoverage` 是「白色重绘像素占全图的最小比例」：低于它的蒙版视为空蒙版直接拒绝
  // （错误码 invalid_request，远端在加载模型前失败），全白（整图重绘）必须放行。
  // 0.0005 = 0.05%：挡掉误传全黑蒙版这类「整图重绘但实际没有涂抹区域」的请求。
  // 单独成项而不挂在 reference 下：远端 limit_spec() 只按「单层数值键」合并兜底值。
  mask: { maxBytes: 2 * 1024 * 1024, minCoverage: 0.0005 },
  // Kaggle / torch 侧接受 32 位有符号正整数；两端必须用同一个上界，否则用户输入的
  // seed 会被宿主静默取模改写，导致「带回参数」复现不出同一张图。
  seed: { max: 2147483647 },
  waitSeconds: { min: 0, max: 600, default: 90 },
  queue: { maxPending: 20, maxKept: 60 },
  // pageSize 是前端「加载更多」每次请求的固定步长，取契约上限 100：
  // Host 的 limit 仍按 maxLimit 钳制，旧客户端只传 limit 时行为不变。
  history: { defaultLimit: 30, maxLimit: 100, pageSize: 100 },
  jobs: { defaultLimit: 20, maxLimit: 100 },
  historyTool: { defaultLimit: 5, maxLimit: 30 },
  libraryDelete: { maxPaths: 200 },
  // Agent 批量创作（imagen_batch）：单次对话最多规划多少条任务。
  // 队列本身另有 maxPending 上限，两者叠加后不会把云端排队撑爆。
  batch: { maxItems: 8 },
  intentText: { maxChars: 2000 },
  // 对话多轮上下文：客户端只回传最近若干条消息，Host 路由再裁剪一次，
  // 避免把整段聊天记录塞进模型（也约束请求体大小）。
  intentHistory: { maxMessages: 12, maxMessageChars: 2000 },
}

/**
 * 本地图片导入（`POST /imagen-api/import`，阶段十五 Phase A）的共享口径。
 *
 * 导入图后续要作为局部重绘 / 整图重绘的底图，因此沿用参考图那套体积与长边边界，
 * 不再单独定义第二份数值；字段与格式只在这里登记一次，Host 与 Client 都从这里取。
 */
export const IMPORT = {
  // 只接受这两种位图：PNG 无损失、JPEG 是相机/截图最常见的格式。
  mimeTypes: ['image/png', 'image/jpeg'],
  // 解码后的原始字节上限（与图生图参考图一致，Host 同时受请求体上限约束）。
  maxBytes: LIMITS.reference.maxBytes,
  // 长边上限 / 短边下限（宽、高都要 >= minEdge，避免把小图放大成噪点）。
  maxEdge: LIMITS.reference.maxEdge,
  minEdge: LIMITS.reference.minEdge,
  // 展示名上限：只用于 meta.prompt 与列表标题，不参与落盘路径。
  maxNameChars: 120,
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
  // 排队分级提示：本机历史日志里 6 次正常会话从推送完成到隧道会合约 14–22 秒
  // （从会话启动算 18–30 秒）；样本很小，只用于挑提示阈值，不代表 Kaggle 排队的普遍保证。
  // 超过慢档只更新一句状态提示（不打断用户），超过卡住档才建议换新实例重排（不自动执行）。
  // 两档都可以被插件配置覆盖（见 index.js 的 queueSlowMinutes / queueStalledMinutes）。
  queueSlowMs: 3 * 60 * 1000,
  queueStalledMs: 10 * 60 * 1000,
  provisionMs: 45 * 60 * 1000,
  tunnelMs: 15 * 60 * 1000,
  sessionWaitMs: 45 * 60 * 1000,
  idleShutdownSec: 1800,
  // Kernel 启动后等待宿主接管的时限（秒）：超过仍没有收到任何带 Token 的 Host 请求，
  // daemon 自行退出。用于回收「放弃排队后仍被调度到」的孤儿 Kernel，避免空转到
  // idleShutdownSec 才释放 GPU 配额。
  kernelClaimSec: 600,
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
 * 运行设置（工作台设置抽屉 ↔ Host 设置存储 `lib/settings.js` 共用的唯一来源）。
 *
 * 设置项只在宿主侧注入远端；本文件只登记「字段边界与取值域」，不存任何界面文案
 * （accelerator 的展示名由客户端字典 `studio.settings.accelerator.<id>` 维护）。
 */
export const SETTINGS = {
  // 空闲自动关机：秒。quickMinutes 是客户端快捷档位（分钟），自定义输入按 min/max 钳制。
  idleTimeoutSec: { min: 300, max: 10800, quickMinutes: [15, 30, 60, 120] },
  // GPU 加速器白名单：值必须是 `kaggle kernels push` 接受的 accelerator 名称。
  accelerators: ['NvidiaTeslaT4', 'NvidiaTeslaP100'],
  defaultAccelerator: 'NvidiaTeslaT4',
  // 高级项上限：数组/映射最多 32 项，单条最长 256 字符。
  maxItems: 32,
  maxItemChars: 256,
  // `publicSettingsView()` 的脱敏字段取值域：settings=用户在抽屉里设置的，config=宿主插件配置。
  hfTokenSources: ['settings', 'config', 'none'],
  // Kaggle 访问方式：direct = Node 直连 Kaggle JSON API + 内置 OAuth 登录（默认，无需本机
  // kaggle CLI）；cli = 调用本机 `kaggle` CLI（兼容退路，排障或直连不可用时手动切回）。
  // 切换在下次操作/唤醒时生效，不需要重载插件。数组顺序即设置抽屉里的选项顺序。
  kaggleTransports: ['direct', 'cli'],
  defaultKaggleTransport: 'direct',
  // 远端算力来源：kaggle 默认；colab 需要先完成一次 Google 授权（tools/colab/probe-auth.mjs），
  // 且只在 Colab Pro 账号下有意义（免费档申请不到 L4/A100）。切换在下次唤醒/启动时生效。
  providers: ['kaggle', 'colab'],
  defaultProvider: 'kaggle',
  // Colab 可用加速器：必须在 assign 接口接受的白名单内；H100 等按账号权益可能被后端 400。
  colabGpus: ['T4', 'L4', 'A100', 'G4'],
  defaultColabGpu: 'L4',
}

/**
 * Kaggle 直连登录（试验特性）的共享口径：`GET/POST /imagen-api/kaggle/login`。
 *
 * POST 用 `action` 区分动作：`start` 发起浏览器授权（本地回环回调收码），`cancel` 取消等待，
 * `submit-code` 在浏览器打不开 / 无头环境时用粘贴授权码兜底；GET 恒为当前登录态。
 * 登录成功后凭据写入 `~/.kaggle/credentials.json`（OAuth，含 refresh_token），
 * 与 CLI 2.x 的 `kaggle auth login` 完全同格式。
 */
export const KAGGLE_LOGIN = {
  actions: ['start', 'cancel', 'submit-code'],
  // idle 未开始 / pending 等待浏览器授权 / done 成功 / failed 失败 / cancelled 用户取消
  states: ['idle', 'pending', 'done', 'failed', 'cancelled'],
  // browser = 拉起本机浏览器 + 本地回环回调；manual = 复制授权链接 + 粘贴授权码。
  modes: ['browser', 'manual'],
  // 客户端轮询登录态的间隔；host 等待授权的总时限（超时转 failed，可重新发起）。
  pollMs: 1500,
  timeoutMs: 5 * 60 * 1000,
}

/** Colab Google OAuth 登录与 Kaggle 直连登录共用同一套状态机契约。 */
export const COLAB_LOGIN = KAGGLE_LOGIN

/**
 * 工作台界面状态的持久化口径（`<workspace>/.imagen/ui-state.json`）。
 *
 * 界面态只是体验优化，不是业务数据：只允许下列白名单字段，字段类型与默认值由这里决定，
 * Host（归一 / 落盘）与 Client（初始化 / 归一）共同引用，未登记的字段一律丢弃。
 * 文件损坏、超限或不存在都回落到默认值，绝不影响出图主链路。
 */
export const UI_STATE = {
  version: 1,
  defaults: {
    // 表单「高级设置」折叠区是否展开：默认收起，没有记录时也回落到 false。
    advancedOpen: false,
  },
  // 落盘文件大小上限：超过按损坏记录处理（界面态丢失不影响出图）。
  maxBytes: 64 * 1024,
}

/**
 * 画面比例 id 的唯一来源。
 *
 * 前端 `src/studio/presets.js` 只保留「id → 像素」数据，顺序与合法取值以本文件为准；
 * `lib/intent.js` 校验模型返回的比例也引用这里。
 *
 * 0.10.0 起移除静态「风格预设」：风格由提示词内容与模型本身表达，
 * 不再有 STYLE_IDS / styleId 这套暗箱后缀机制。
 */
export const RATIO_IDS = ['1:1', '16:9', '9:16', '4:3', '3:4']

/**
 * 对话意图解析（`POST /imagen-api/intent`）的结构边界。
 *
 * Host 按这里归一模型输出，Client 不重复校验；改结构时同步 `docs/SPEC.md` 与测试。
 */
export const INTENT = {
  // 中文摘要只进界面，给用户的确认信息，写太长没有意义。
  summaryMaxChars: 400,
  // 通用澄清：一条问题 + 2~4 个选项（点击后作为新一轮用户输入重新解析）。
  clarifyMinOptions: 2,
  clarifyMaxOptions: 4,
  clarifyQuestionMaxChars: 80,
  clarifyOptionMaxChars: 40,
  // 模型建议：只允许合法预设 id，且不能是当前预设。
  modelHintReasonMaxChars: 80,
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
  // 远端容器没拿到 GPU（torch.cuda.is_available() 为 False）：Kaggle 会静默降级成 CPU，
  // 必须先明确报错，不能继续用 CPU 硬跑导致超时或模糊的 CUDA 报错。
  gpu_unavailable: { layer: 'remote' },
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
 * 取消语义（`POST /imagen-api/job/cancel`，请求体 `{ id }`）。
 *
 * 响应始终带 `job` 与 `disposition`：
 *  - `dequeued`：queued / waiting-session 立即出队失效，不再占用队列位置，
 *    后续任务不必等到 45 分钟会话等待窗口超时才继续；
 *  - `cooperative`：running 只置 `cancelRequested` 标记，当前这张图画完后不再提交
 *    批内剩余张数（不强杀线程、不改远端采样回调），之后收敛为 cancelled；
 *  - `already-finished`：任务已是终态，取消请求不改变任何状态。
 */
export const JOB_CANCEL = {
  dispositions: ['dequeued', 'cooperative', 'already-finished'],
}

/**
 * 提示词增强通道的两种模式（`POST /imagen-api/enhance` 的 `mode`，缺省 `refine`）。
 *
 *  - `refine`：四维英文短语建议，响应保持 `{ ok, source, groups }`（向后兼容）；
 *  - `translate`：把提示词转成英文，响应 `{ ok, mode, source, prompt }`；
 *    `source: 'local'` 表示宿主模型不可用、没有真正翻译，前端必须明确提示
 *    「未翻译 / 模型不可用」，不得把原文本当作译后结果展示。
 * 两种模式都只复用宿主已配置的模型，不接第三方重模型。
 */
export const ENHANCE_MODES = ['refine', 'translate']

/**
 * 日志与诊断的共享口径（Host `lib/routes/logs.js` 与 Client `src/logic/logs.js` 共用）。
 */
export const LOGS = {
  // 远端 daemon 日志环与客户端保留行数上限。
  remoteLineLimit: 400,
  // GET /logs 下发的 Host 本地日志尾部行数上限（Host 路由与客户端归一都按它）。
  hostLineLimit: 120,
  // 诊断文本附带的行数：远端可多给一些，Host 更短以控制粘贴长度。
  diagRemoteTail: 120,
  diagHostTail: 80,
}

/**
 * 诊断环境指纹（`GET /logs` 响应体的 `env` 字段，仅供前端诊断报告使用）。
 *
 * 只允许非敏感信息：布尔开关、版本号与毫秒耗时摘要；严禁出现代理 URL、Token、
 * 工作区绝对路径与 prompt 正文。`timings` 字段由 Host 按会话快照计算：
 *  - sessionStartMs：startedAt → readyAt 的就绪耗时（未就绪为 null）；
 *  - sessionUptimeMs：startedAt → now；
 *  - readyUptimeMs：readyAt → now。
 */
export const DIAGNOSTICS = {
  envFields: ['platform', 'nodeVersion', 'hasProxyEnv', 'hasFallbackTunnel', 'hasCustomDatasets', 'hasPipConstraints', 'hasHfToken'],
  timingFields: ['sessionStartMs', 'sessionUptimeMs', 'readyUptimeMs'],
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
import { PRESETS, PUBLIC_PRESETS } from './models.generated.js'

export { PRESETS }

export const DEFAULT_PRESET = 'sdxl-lightning'

/** 按 id 取预设；未知 id 回退到默认项。 */
export function presetById(id) {
  return PRESETS.find((item) => item.id === id) ?? PRESETS.find((item) => item.id === DEFAULT_PRESET)
}

/** 面向 Client 的精简视图（去掉下发远端用的 pipeline 细节，避免双份真相）。 */
export function publicPresets() {
  return PUBLIC_PRESETS.map((preset) => ({ ...preset }))
}

/**
 * 下发给远端 daemon 的契约子集（经 lib/kernel.js 注入为 `config.contract`；
 * 同一份对象由 `tools/gen-contract-json.mjs` 落盘为 `remote/contract.json` 供 mock 使用）。
 *
 * 只保留 Python 容器实际消费的元数据：`daemon.py` 读取 `contract.version`
 * （protocol_version）与 `contract.limits`（_limit_spec / _max_tasks）。宿主路由、
 * health phase、ntfy 事件、historyTool 与错误码都只属于 Host/Client，不下发远端。
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
      // 图生图的参考图边界与重绘强度：daemon 依此校验请求（来源与 Host 同一份契约）。
      reference: LIMITS.reference,
      strength: LIMITS.strength,
      // 局部重绘蒙版边界（与参考图一起下发；daemon 请求体上限也按它推导）。
      mask: LIMITS.mask,
    },
  }
}