# 技术规格与接口契约 (SPEC)

> **数据单一来源**：路由、错误码、参数边界、超时、预设与远端协议字段统一由 [`shared/contract.js`](../shared/contract.js) 定义；
> 本文档只描述语义、请求/响应形状与使用约束，不重复维护数值。`node test/check-contract.mjs` 会校验
> 宿主注册的路由、宿主错误码、客户端文案与本文档是否跟随契约。
>
> **版本**：0.12.0（与 `package.json`、`shared/contract.js` 的 `VERSION` 一致）。本文档覆盖截至 `0.12.0` 的全部契约与接口。

---

## 1. 核心状态与生命周期

### 1.1 会话状态（Session State）

会话由 Host 单例管理，对应远端 Kaggle 容器实例：

| 状态 (`state`) | 含义 | 触发场景 / 转换条件 |
| :--- | :--- | :--- |
| `absent` | 未运行 | 初始状态，或已正常关机 / 远端超时退出 |
| `provisioning` | 启动排队中 | 已推送 Kernel 脚本，等待 Kaggle 分配 GPU 容器 |
| `connecting` | 建立连接中 | 已从会合点拿到 Cloudflare 临时域名，正在探测健康状态 |
| `warming` | 模型准备中 | 隧道已通，远端正在安装依赖或加载模型权重 |
| `ready` | 就绪 | 模型已装载完毕，随时可以接收生图请求 |
| `stopping` | 正在关机 | 正在向远端发送退出通知 |
| `error` | 异常中断 | 任一阶段超时或失败（附带具体的错误码与日志片段） |

会话快照（`/state` 的 `session` 字段）包含：`state`、`phase`、`detail`、`presetId`、`kernelId`、`kernelUrl`、
`kernelStatus`、`endpointUrl`、`device`、`deviceCount`、`modelId`、`tunnelProvider`、`startedAt`、`readyAt`、`lastProbeAt`、
`idleTimeoutSec`、`idleSeconds`、`stoppedByUser`、`error`（`null` 或 `{ code, message }`）。鉴权 token 不进入任何对外快照
（只在 Host 内部用于请求远端；`endpointUrl` 会下发，供前端展示隧道是否建立）。
`tunnelProvider` 为 `cloudflare` / `custom` / `null`，对应 ready 事件与 `/health.tunnel_provider`。

**空闲自动关机（透明化）**：`idleTimeoutSec` 是当前生效的自动关机阈值（来自运行设置，默认 1800 秒），
`idleSeconds` 是远端 `/health` 上报的已空闲秒数（纯只读数值；会话未就绪或远端未上报时为 `null`）。
客户端据此展示「已空闲 X 分钟 / 满 Y 分钟自动关机」，不再让用户猜测实例为什么突然被回收。

**会话本地持久化**：Host 在启动流程的关键节点把 `kernelId`、`token`、`topic`、`endpointUrl` 等写入
`<workspace>/.imagen/session.json`（原子写，目录 0700 / 文件 0600，Windows 忽略 mode 差异）。
下次 DSH 启动或插件热重载时，Host 先读取该记录：`/health` 探活成功则直接接管；地址失效但有 `topic`
则回 ntfy 会合点重新取隧道地址；Kernel 已结束或记录不可用时尽力关机并删除记录。
记录含远端 Bearer Token，只落盘、不进任何日志与对外快照；`session/stop` 与成功的 `dispose` 会删除它。
开发模式（`devEndpoint`）不读写该记录。

**卸载补清理（0.8.1）**：`dispose()` 不阻塞卸载，关机通知只是 best-effort。若通知没能发出或失败，
Host 会**同步**把补发关机所需的最小信息（`endpointUrl` / `token` / `kernelId` / `topic` / `presetId` /
`attempts` / `savedAt`）写入 `<workspace>/.imagen/pending-cleanup.json`（原子写，目录 0700 / 文件 0600），
并删除 `session.json`（用户已明确退出，下次启动不应被 `restore()` 接手）。下次插件启动时先
`cleanupPendingSession()` 补发一次 `/shutdown`，再执行 `restore()`：

- 补发成功 → 清掉待清理记录与残留会话记录；
- 补发失败 → `attempts` 累加后保留，等待下次启动再试；
- 记录超过 24 小时（Kernel 最长运行 3 小时，视为已结束）、补发满 5 次或地址不可信 → 丢弃并记一条 warn。

记录含远端 Bearer Token，只落盘、不进日志；开发模式（`devEndpoint`）不写该记录。

**排队分级与「换新实例重排」（0.12.0）**：Kaggle 免费 GPU 的排队时长不稳定——本机历史日志里 6 次正常会话从推送完成到
隧道会合约 14–22 秒（从会话启动算 18–30 秒；Kernel 日志反推容器启动在推送后 3–6 秒），但偶发队列条目卡住（45 分钟仍
`QUEUED`）。样本很小，且集中在一个账号的几天内，这两组阈值只用于挑「提示时机」，**不代表 Kaggle 排队的普遍保证**。
Host 因此把排队等待拆成四档：

| 档位 | 触发条件 | 行为 |
| :--- | :--- | :--- |
| 正常 | `elapsed < queueSlowMs`（默认 3 分钟） | 胶囊显示「正在排队等 GPU」，流水线停在排队节点 |
| 变慢 | `elapsed ≥ queueSlowMs` | 流水线排队节点转琥珀并标「比平时久」，不弹卡、不改变胶囊色调 |
| 卡住 | `elapsed ≥ queueStalledMs`（默认 10 分钟） | 客户端显示「排队超过 N 分钟还没拿到 GPU」横幅，主操作「换新实例重排」 |
| 硬超时 | `elapsed ≥ provisionMs`（默认 45 分钟） | 收敛为 `error.queue_timeout`，客户端只给「换新实例重排」一个主操作 |

阈值随 `/state.queuePolicy` 下发（插件配置 `queueSlowMinutes` / `queueStalledMinutes` 可覆盖，卡住档不会早于慢档）。

**换新实例重排**：客户端调用 `POST /imagen-api/session/start` 并带 `{ "forceNew": true, "replace": true }`。
Host 会放弃当前会话、best-effort 删除旧 Kernel，然后推送一个新 Kernel（新的排队条目）；本地等待中的任务
继续等待新会话，不会被标记为 `stopped`。同样的旧 Kernel 清理也发生在：排队硬超时（`queue_timeout`）、
隧道握手超时（`tunnel_timeout`）、以及会话仍在排队时的主动关机。旧 Kernel 删除失败（网络/权限）时，
远端 daemon 的 `claim_timeout_sec`（默认 600 秒）兜底：启动后没有任何带 Token 的 Host 请求就自行退出，
避免空转到 `idle_timeout_sec` 才释放 GPU 配额。

### 1.2 任务状态（Job Status）

| `status` | 含义 |
| :--- | :--- |
| `queued` | 已入本地队列，尚未开始 |
| `waiting-session` | 正在等待/唤醒远端会话 |
| `running` | 远端生成中 |
| `done` | 完成，`output` 内有图片 |
| `failed` | 失败，`error` 内是错误码与原因 |
| `cancelled` | 已取消（终态）；取消前已完成的图片仍保留在 `output`，未开始/未完成的部分不再提交 |

### 1.3 错误码字典 (`error.code`)

错误响应统一为 `{ "error": { "code": "...", "message": "..." } }`。错误码词表见
`shared/contract.js` 的 `ERROR_CODES`；下表的 `HTTP` 列是宿主直接返回该码时的状态码。
远端 daemon 的 `{ error: { code, message } }` 由宿主原样透传（`remote` 层 5 个码在宿主字典中也有文案）。

**Host 层（28 个）**

| 错误码 | HTTP | 触发场景 |
| :--- | ---: | :--- |
| `invalid_body` | 400 | 请求体缺失、不是合法 JSON 或缺少必填字段（如 `path` / `paths`） |
| `invalid_request` | 400 | 请求内容不合法（如 `/intent` 的对话内容为空或超过 2000 字符） |
| `invalid_prompt` | 400 | 提示词为空或超过 2000 字符 |
| `invalid_path` | 400 | 路径不在 `imagen-output/` 内或格式非法 |
| `too_many` | 400 | 一次删除的图片数量超过上限（200） |
| `not_found` | 404 | 任务、文件或目标资源不存在 |
| `output_missing` | 404 | 产物目录尚不存在（`/reveal`） |
| `reveal_failed` | 500 | 调起系统文件管理器失败 |
| `logs_unavailable` | — | 远端日志暂时拉不到（会话在但 daemon 不可达 / 协议漂移） |
| `internal_error` | 500 | 未分类的宿主异常（`errorShape` 兜底码） |
| `queue_full` | 400 | 本地待执行队列已满 |
| `stopped` | — | 用户主动关机导致任务未执行 |
| `session_absent` | — | 需要远端连接时会话不存在 |
| `session_timeout` | — | 等待会话就绪超时 |
| `session_error` | — | 会话进入错误态且没有更具体的错误码 |
| `empty_result` | — | 远端未返回任何图片 |
| `generate_failed` | — | 生成失败且没有更具体的错误码 |
| `disposed` | — | 插件已卸载 / 已释放 |
| `auth_required` | — | 未找到 Kaggle 凭证或凭据失效 |
| `cli_missing` | — | 本机未安装 `kaggle` CLI |
| `cli_timeout` | — | `kaggle` CLI 启动超时 |
| `push_failed` | — | 构建/推送 Kernel 失败 |
| `queue_timeout` | — | Kaggle GPU 排队超时（默认 45 分钟）；Host 会放弃这次排队并 best-effort 删除旧 Kernel，客户端建议「换新实例重排」 |
| `tunnel_timeout` | — | 容器已启动但隧道未建立 / 会合失败 |
| `health_failed` | — | 隧道已建立但 `/health` 持续不可达 |
| `remote_error` | — | 远端 daemon 主动报告错误 |
| `session_ended` | — | Kernel 非预期结束（被平台回收等） |
| `unknown` | — | 探测/检查失败但无法归因 |

**Remote 层（5 个，远端产生、宿主透传）**

| 错误码 | 触发场景 |
| :--- | :--- |
| `unauthorized` | 远端 Bearer Token 缺失或错误（远端回 401） |
| `load_failed` | 依赖安装 / 模型加载失败 |
| `generation_failed` | 推理过程异常 |
| `oom` | CUDA 显存不足（远端会先 `torch.cuda.empty_cache()` 再回错） |
| `gpu_unavailable` | 远端容器没有拿到 GPU（`torch.cuda.is_available()` 为 `False`）。Kaggle 账号未完成手机号验证时会静默降级 CPU，远端在启动阶段就明确报错并把该码写入 `/health.last_error_code` 与 ntfy `error` 事件，宿主透传到前端会话指引卡，不再用 CPU 硬跑出模糊的 CUDA 错误 |

> 远端也会复用 Host 层的 `invalid_request`（参数不合法，400）与 `not_found`（未知路径，404）。

**Client 层（6 个，仅客户端本地合成，不会由 Host/远端返回）**

`warming`（收到 503 但没有明确错误码，按可重试处理）、`timeout`（请求被 AbortController 取消）、
`network`（fetch 失败）、`need_prompt`（本地表单校验）、`delete_failed`（删除动作失败）、
`probe_failed`（环境检查失败）。

### 1.4 远端 `/health` 附加字段

远端 daemon 的 `GET /health` 除了 `phase` / `device` / `loaded` 等基础字段，还向宿主提供以下只读信息
（都由 Host 转换为会话快照或诊断数据，不直接暴露给客户端原始响应）：

| 字段 | 类型 | 宿主用途 |
| :--- | :--- | :--- |
| `idle_seconds` | number | → 会话快照 `idleSeconds`；工作台展示「已空闲 X 分钟 / 满 Y 分钟自动关机」 |
| `idle_timeout_sec` | integer | → 会话快照 `idleTimeoutSec`（远端实际生效的自动关机阈值） |
| `last_error_code` | string | 远端错误码；命中契约 `ERROR_CODES` 时宿主原样透传（如 `gpu_unavailable`、`oom`），否则回退 `remote_error` |
| `tunnel_provider` / `tunnel_state` / `tunnel_restarts` | string / string / integer | 会话快照的隧道提供方与重连状态展示 |
| `versions` | object | 依赖版本快照（python / torch / diffusers / transformers / accelerate / peft / huggingface_hub / safetensors / pillow）；纯版本号、无 token 与路径，供 `npm run test:gpu` 的 report 记录「已知良好版本参考（LKGR）」 |
| `gpu_memory` | object \| null | 只读显存诊断（M3）：`{ allocated_mb, reserved_mb, max_allocated_mb }`（MiB 取整）；torch 未加载 / CUDA 不可用 / 读取异常时为 `null`。用于真机验证图生图 `from_pipe` 复用底座时显存无额外增长，不参与会话状态判定 |

---

## 2. Host HTTP 路由

所有插件接口统一挂载在 `/imagen-api` 前缀下；除个别例外，成功响应为 `application/json; charset=utf-8`。
异常响应统一为 `{ "error": { "code": "...", "message": "..." } }`。方法不匹配时返回 `405`（带 `Allow` 头、无响应体）。

> **例外**：`GET /imagen-api/file` 返回图片二进制流（`image/png` 等），不是 JSON。

路由总览（24 条方法 / 21 个唯一路径，以 `shared/contract.js` 的 `ROUTES` 为准；同一 path 的 GET/POST 各占一行）：

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| GET | `/imagen-api/state` | 插件运行状态全貌（前端轮询数据源） |
| POST | `/imagen-api/probe` | 主动触发本地 Kaggle 环境检测 |
| GET | `/imagen-api/logs?since=` | 拉取远端 daemon 的增量运行日志 + Host 本地日志尾部（`hostLines`）与诊断环境指纹（`env`） |
| POST | `/imagen-api/session/start` | 启动远端 GPU 会话（幂等） |
| POST | `/imagen-api/session/stop` | 关机 |
| POST | `/imagen-api/generate` | 提交生图任务 |
| GET | `/imagen-api/job?id=` | 查询单个任务 |
| POST | `/imagen-api/job/cancel` | 取消任务（排队/等待会话立即失效；运行中合作式停止） |
| GET | `/imagen-api/jobs?limit=` | 查询任务列表与队列概况 |
| GET | `/imagen-api/history?limit=&offset=` | 查询历史产物（分页，带 `hasMore`） |
| GET | `/imagen-api/history/tree?root=&limit=` | 按根作品返回整棵版本派生树（跨历史分页补齐版本链） |
| GET | `/imagen-api/file?path=` | 读取产物图片（二进制） |
| POST | `/imagen-api/import` | 本地图片导入：校验后落盘为「导入作品」（阶段十五 Phase A） |
| GET | `/imagen-api/library` | 读取收藏 / 删除记录 |
| POST | `/imagen-api/library/favorite` | 收藏 / 取消收藏 |
| POST | `/imagen-api/library/delete` | 删除产物 |
| POST | `/imagen-api/enhance` | 提示词润色 / 英译 |
| POST | `/imagen-api/intent` | 对话意图解析 |
| POST | `/imagen-api/reveal` | 在文件管理器中打开产物目录 |
| GET | `/imagen-api/settings` | 读取运行设置的脱敏视图（`hfToken` 只回布尔与来源） |
| POST | `/imagen-api/settings` | 保存运行设置（空闲关机 / 加速器 / HF Token / 预挂载 / 依赖约束） |
| GET | `/imagen-api/ui-state` | 读取工作台界面状态（高级设置折叠等白名单字段） |
| POST | `/imagen-api/ui-state` | 保存工作台界面状态（合并白名单字段） |
| GET | `/imagen-api/kaggle/login` | 读取 Kaggle 直连登录态 |
| POST | `/imagen-api/kaggle/login` | 发起 / 取消登录，或提交粘贴的授权码 |

### 2.1 会话与状态

#### `GET /imagen-api/state`

获取当前插件运行状态全貌（前端轮询面板与徽章的数据来源）。

- **响应字段**：

| 字段 | 说明 |
| :--- | :--- |
| `version` | 插件版本（与契约 `VERSION` 一致） |
| `defaultPreset` | 默认预设 id |
| `presets` | 预设的公开视图数组（见下） |
| `session` | 会话快照（字段见 §1.1） |
| `probe` | 最近一次环境检测结果；未检测时为 `null` |
| `probeAt` | 最近一次检测完成的时间戳（毫秒） |
| `probeLastGood` | 最近一次**成功**的检测结果（用于配额不可用时回退展示）；从未成功为 `null` |
| `probeLastGoodAt` | 最近一次成功检测的时间（ISO 字符串）；从未成功为 `null` |
| `jobs` | 最近 10 条任务（`Job` 公开视图，见 §2.2） |
| `lastJob` | 最近一条完成/失败的任务，或 `null` |
| `queue` | `{ running: id \| null, pending: number }` |
| `devMode` | 是否通过 `devEndpoint` 走本地联调 |
| `kaggleTransport` | 当前生效的 Kaggle 访问方式：`direct`（Node 直连 Kaggle API + 内置 OAuth 登录，**默认**）或 `cli`（调用本机 `kaggle` CLI，兼容退路） |
| `update` | 插件自身版本检查快照：`current` / `latest` / `hasUpdate` / `releaseUrl` / `enginesDsh` / `checkedAt` / `stale` / `error`（见下） |

- **响应示例**：

```json
{
  "version": "0.11.0",
  "defaultPreset": "sdxl-lightning",
  "presets": [
    {
      "id": "sdxl-lightning",
      "label": "SDXL Lightning",
      "family": "SDXL",
      "short": "Lightning",
      "description": {
        "zh": "4 步极速出图，平衡画质与耗时",
        "en": "4-step fast generation, balanced quality"
      },
      "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
      "params": "3.5B + LoRA",
      "license": "OpenRAIL++",
      "licenseKind": "open",
      "gated": false,
      "gpus": 1,
      "downloadGb": 6.78,
      "size": 1024,
      "sizeOptions": [768, 1024, 1152],
      "steps": 4,
      "cfg": 0,
      "peakVramMb": 10347,
      "loadSeconds": 7.7,
      "steadySeconds": 6.2,
      "tier": "fast",
      "negativeHint": "blurry, low quality, deformed, extra limbs",
      "promptStyle": "concise",
      "qualityPrefix": "",
      "supportsImg2Img": true,
      "supportsNegative": true
    }
  ],
  "session": {
    "state": "ready",
    "phase": "warm",
    "detail": null,
    "presetId": "sdxl-lightning",
    "kernelId": "username/imagen-1a2b3c4d",
    "kernelUrl": "https://www.kaggle.com/code/username/imagen-1a2b3c4d",
    "kernelStatus": "RUNNING",
    "endpointUrl": "https://xxxx.trycloudflare.com",
    "device": "Tesla T4",
    "deviceCount": 2,
    "modelId": "sdxl-lightning",
    "tunnelProvider": "cloudflare",
    "startedAt": "2026-11-09T04:00:00.000Z",
    "readyAt": "2026-11-09T04:06:00.000Z",
    "lastProbeAt": "2026-11-09T04:07:02.000Z",
    "idleTimeoutSec": 1800,
    "error": null
  },
  "queuePolicy": { "slowMs": 180000, "stalledMs": 600000 },
  "update": {
    "current": "0.11.0",
    "latest": "0.12.0",
    "hasUpdate": true,
    "releaseUrl": "https://github.com/nanxfu/dsh-our-imagen/releases/tag/v0.12.0",
    "enginesDsh": ">=0.2.0",
    "checkedAt": "2026-11-16T00:00:00.000Z",
    "stale": false,
    "error": null
  },
  "probe": null,
  "probeAt": 0,
  "probeLastGood": null,
  "probeLastGoodAt": null,
  "jobs": [],
  "lastJob": null,
  "queue": { "running": null, "pending": 0 },
  "devMode": false
}
```

> `presets` 是 `publicPresets()` 的结果：不含 `pipeline`（下发远端 daemon 用的加载描述），避免同一份数据在
> 客户端快照里出现两份；`supportsImg2Img` / `supportsNegative` 等能力字段随公开视图下发，客户端据此决定参考图
> 槽位与「排除项」是否可用。
>
> `queuePolicy` 是排队分级阈值（毫秒）：客户端据此决定「排队比平时久」提示与「换新实例重排」横幅的出现时机。
> 旧 Host 不下发该字段时，客户端回落到契约 `TIMEOUTS.queueSlowMs` / `queueStalledMs`。
>
> `update` 是插件**自身**的版本检查快照，与云端会话版本无关：Host 只读查询 npm 注册表的
> `dsh-our-imagen/latest`（npmjs 失败回退 npmmirror，单次 4 秒超时），成功结果缓存在
> `<workspace>/.imagen/update-check.json`（24 小时有效），启动约 5 秒后首次检查、之后按 TTL 复查，
> 失败静默保留上一次成功结果。只有 `hasUpdate=true` 时客户端才在顶栏算力胶囊上显示红点，
> 并在算力弹层给出「新版本 vX 可用（当前 vY）」、`engines.dsh` 要求与 Release 说明链接；
> **不下载、不安装、不阻断出图**。开发模式（`devEndpoint`）或插件配置 `updateCheck: false` 时不发起请求。

#### `POST /imagen-api/probe`

主动触发本地 Kaggle 环境检测（安装/登录状态、配额）。检测会并发调用 `kaggle` CLI，首次约 20~30 秒。

- **响应**：`{ "ok": boolean, "probe": Probe }`，`ok = probe.auth.ok`。

`Probe` 结构：

| 字段 | 说明 |
| :--- | :--- |
| `provider` | 固定 `"kaggle"` |
| `cli.present` | CLI 是否存在 |
| `cli.version` | CLI 版本字符串（可能为 `null`） |
| `cli.username` | 读到的 Kaggle 用户名（可选） |
| `cli.error` | CLI 不可用时的原因（可选） |
| `auth.ok` | 鉴权是否通过 |
| `auth.checkedAt` | 检测时间（ISO 字符串） |
| `auth.errorCode` | 失败时的错误码：`cli_missing` / `cli_timeout` / `auth_required` / `unknown` |
| `auth.detail` | 失败详情（可选，截断 300 字符） |
| `quota.available` | 配额是否可读；不可读时只有 `raw` |
| `quota.usedHours` / `remainingHours` / `totalHours` / `refreshAt` | 配额明细（可读时） |
| `quota.raw` | CLI 原始输出片段 |
| `notes` | 给用户看的说明数组 |

- **响应示例**：

```json
{
  "ok": true,
  "probe": {
    "provider": "kaggle",
    "cli": { "present": true, "version": "2.2.5", "username": "someone" },
    "auth": { "ok": true, "checkedAt": "2026-11-09T04:07:02.000Z" },
    "quota": {
      "available": true,
      "usedHours": 0.72,
      "remainingHours": 29.28,
      "totalHours": 30,
      "refreshAt": "2026-11-14T00:00:00+00:00",
      "raw": "GPU  0.72h  29.28h  30.00h  2026-11-14T00:00:00+00:00"
    },
    "notes": ["kaggle CLI 2.2.5", "账号接入正常"]
  }
}
```

#### `POST /imagen-api/session/start`

启动远端 GPU 会话。具备幂等性（会话已在运行中直接返回当前快照；`error` 态会先清空再重试）。

- **请求体**：`{ "presetId": "sdxl-lightning", "forceNew": false, "replace": false }`
  - `presetId` 可选；未知 id 回退 `defaultPreset`；
  - `forceNew: true`：跳过「接管旧排队」检查，直接推送新 Kernel（`error` 态重试时使用）；
  - `replace: true`：换新实例重排，允许在 `provisioning` / `connecting` 等活跃状态下放弃当前会话——
    Host 先 best-effort 删除旧 Kernel，再推送新 Kernel；等待中的任务继续等待新会话。旧 Host 会忽略该字段。
- **响应**：`{ "ok": true, "session": SessionSnapshot }`

#### `POST /imagen-api/session/stop`

关机。通知远端容器退出并清理本地连接状态（best-effort，不等待远端确认）。

- **响应**：`{ "ok": true, "session": { "state": "stopping" | "absent", ... } }`

#### `GET /imagen-api/logs?since=<n>`

把远端 daemon 的日志环增量透传给工作台日志抽屉（协议见 `remote/daemon.py` 的 `GET /logs`），
同时附带 Host 本地滚动日志的尾部，便于在会话未启动或隧道断开时排障。

- `since`：上次拿到的游标 `next`，非负整数，默认 0；环形缓冲只保留最近 400 行。
- `hostLines`：Host 本地日志文件 `<workspace>/.imagen/logs/host.log` 的最近 120 行（已脱敏，旧的在前），
  与 `lines` **分开返回、不混排**；无文件或读取失败时为 `[]`。该字段在所有响应分支（成功 /
  `session_absent` / `logs_unavailable`）都会出现，老客户端忽略即可。
- `env`：诊断环境指纹，仅供前端「复制诊断信息」使用，**只含非敏感信息**：
  `{ platform, nodeVersion, hasProxyEnv, hasFallbackTunnel, hasCustomDatasets, hasPipConstraints, hasHfToken,
  timings: { sessionStartMs, sessionUptimeMs, readyUptimeMs } }`。布尔开关表示「是否配置」而不是配置值；
  `timings` 是毫秒耗时摘要（缺失为 `null`）。**不允许**出现代理 URL、Token、工作区绝对路径或 prompt 正文。
  该字段在所有响应分支都会出现，老客户端忽略即可。
- **响应**（始终 HTTP 200，用 `ok` 表达可用性，避免客户端把「暂时拿不到日志」当成网络故障）：

```json
{
  "ok": true,
  "since": 0,
  "next": 128,
  "lines": ["[boot] 运行时就绪…", "[tunnel] 隧道就绪：https://…"],
  "hostLines": ["[2026-11-11T23:10:00.123Z] [info] [index] 插件已加载", "[2026-11-11T23:10:03.456Z] [warn] [session] transition absent->starting"],
  "env": {
    "platform": "win32",
    "nodeVersion": "22.14.0",
    "hasProxyEnv": true,
    "hasFallbackTunnel": false,
    "hasCustomDatasets": false,
    "hasPipConstraints": false,
    "hasHfToken": true,
    "timings": { "sessionStartMs": 268000, "sessionUptimeMs": 540000, "readyUptimeMs": 272000 }
  }
}
```

- 会话未启动 / 没有远端连接：`{ "ok": false, "code": "session_absent", "message": "…", "since": 0, "next": 0, "lines": [], "hostLines": [...], "env": {…} }`
- 远端不可达或协议漂移：`{ "ok": false, "code": "logs_unavailable", "message": "…", "since": n, "next": n, "lines": [], "hostLines": [...], "env": {…} }`

### 2.2 出图任务

队列在 Host 侧串行执行：同一时刻最多 1 个 `running`，其余按提交顺序排队。

> **远端异步 job 协议（v0.5.0 起）**：Host 不再同步等待整段采样。提交路径是
> `POST /generate`（远端只校验并返回 `202 {status:"accepted", job_id}`，耗时 <100ms）+
> 每 `TIMEOUTS.remoteJobPollMs`（2s）一次 `GET /job?id=<job_id>` 轮询，
> 直到 `status=done`（带 `results`）、`failed`（带 `error.code`）或宿主整体预算耗尽。
> 这样一条 HTTP 连接不会挂住几十秒而无任何响应字节，Cloudflare quick tunnel 与本地代理
> 不会把「空闲连接」判死；远端失败也仍能通过正常的 HTTP 语义（job 的 `error.code`）表达，
> 不需要提前写 200 而丢掉 500。
>
> **逐张提交**：为了实现运行中的合作式取消，Host 对 `count>1` 的任务**每张单独提交**一个远端 job
> （`tasks` 只含 1 项，幂等键为 `<宿主 job.id>-<两位序号>`），一张完成后才提交下一张；宿主侧
> 汇总 `job.progress = { done, total }`。取消 running 任务时，当前这张照常出完，剩余张数不再提交。
> 提交只是拆成多段，`generateTimeoutMs` 仍是**整个宿主任务**的预算，不会按张数放大。
>
> **轮询容错与幂等续接**：隧道重建期间单次 `GET /job` 失败不判任务失败——连续失败只要
> 仍在持续时长窗口内（`TIMEOUTS.remoteJobPollFailureGraceMs`，默认 120 秒）就按指数退避
> 继续查同一个远端 job。窗口用尽后用**同一个幂等键**重新 `POST /generate`
> 接回原任务（远端命中幂等键会返回原 job，不重复入队），最多重投
> `TIMEOUTS.remoteJobResumeMaxAttempts`（默认 2）次；重投次数用尽或整体预算耗尽才判
> `generate_failed`。`404 unknown_job` 是明确的终态，不重试也不重投。

#### `POST /imagen-api/generate`

提交新的文生图请求。

- **请求体**：

| 字段 | 类型 | 约束（越界自动钳制，不报错） |
| :--- | :--- | :--- |
| `prompt` | string | 必填，trim 后 1~2000 字符；空则 400 `invalid_prompt` |
| `negativePrompt` | string | 可选，截断到 1000 字符；默认空 |
| `presetId` | string | 可选，未知 id 回退默认预设 |
| `width` / `height` | integer | 256~1536，按 8 的倍数对齐；缺省取预设 `size` |
| `steps` | integer | 1~60；缺省取预设 `steps` |
| `cfg` | number | 0~20；缺省取预设 `cfg` |
| `seed` | integer | 0~2147483647；省略则随机。多张时第 `i` 张为 `seed + i` |
| `count` | integer | 1~4，默认 1 |
| `waitSeconds` | integer | 0~600：>0 时该请求最多等待任务结束 N 秒再返回（默认 0，立即返回） |
| `autoStart` | boolean | 默认 `true`；`false` 时不自动唤醒会话 |
| `reference` | object | 可选。图生图 / 局部重绘参考图（M3 / 0.12.0）：`{ path?, image?, strength?, mask? }`，`path` 与 `image` 二选一，`mask` 可叠加；详见下方「图生图参考图」 |

**图生图参考图（M3）与局部重绘蒙版（0.12.0）**：

- `reference.path`：`imagen-output/` 内作品的工作区相对路径（与 `/imagen-api/file?path=` 同一口径，
  严格限定在输出目录内、拒绝绝对路径与 `..`）；`reference.image`：前端上传/缩放后的 base64
  （可带 `data:image/png;base64,` 前缀），两者只能二选一。
- 体积上限 `LIMITS.reference.maxBytes`（8 MiB 原始字节），只接受 PNG / JPEG；长边上限
  `LIMITS.reference.maxEdge`（1536）由远端解码后等比缩小，小于 `LIMITS.reference.minEdge` 的图直接拒绝。
- `reference.strength`：重绘强度，按契约 `LIMITS.strength` 钳制并对齐（步长 0.05，默认 `0.6`）。
  不带蒙版的垫图上限是 `LIMITS.strength.max`（0.9）；带 `mask` 的局部重绘上限放宽到
  `LIMITS.strength.inpaintMax`（1.0）——9 通道 inpaint 权重在全重绘时需要更高的替换力度，
  只放宽这一档，img2img 的保守上限不变（Host 与 daemon 用同一口径）。
- `reference.mask`：可选，局部重绘蒙版。PNG base64（可带 `data:image/png;base64,` 前缀），
  黑白二值图：**白色为重绘区域、黑色为保留区域**；体积上限 `LIMITS.mask.maxBytes`（2 MiB）。
  只允许 PNG（蒙版是程序生成的二值图，JPEG 的压缩噪声会让边界不可控）。带 `mask` 时必须同时有
  `path` / `image` 之一（没有参考图就无从重绘），否则 `400 invalid_request`。远端解码后转灰度 `'L'`
  并用最近邻对齐到参考图精确宽高；未涂抹时不传该字段，请求体与纯图生图逐字一致。
  只对 `supportsInpaint = true` 的模型（SDXL 家族）开放，其它 loader 由远端按白名单返回
  `400 invalid_request`（文案明确「该模型不支持局部重绘」）。
- **空蒙版拦截**：解码对齐后统计白色（重绘）区域覆盖率，低于 `LIMITS.mask.minCoverage`
  （0.0005，即 0.05%）按空蒙版拒绝——任务在执行期、**加载模型前**以 `invalid_request` 失败，
  不浪费 GPU；全白（整图重绘）是合法请求，必须放行。客户端在导出前也用同一阈值拦住空涂抹。
- **羽化分档**：羽化半径随蒙版覆盖率自适应（精细小蒙版不波及周围像素）：覆盖率 < 0.5% → 2px，
  < 5% → 4px，更大按短边 0.8% 计算并钳在 6~8px。常量集中在 `remote/inference/reference_codec.py`
  顶部，真机复验后可只改常量。
- 首期只对 `supportsImg2Img = true` 的模型（SDXL 家族）开放参考图；远端对不支持的 loader 返回
  `400 invalid_request`。参考图是 job 级参数：一张参考图跑整批 `count`（每张 seed 递增）。
- 专用局部重绘预设（`inpaintOnly = true`，如 `sdxl-inpaint`）：只用于带蒙版的局部重绘，
  **必须同时提供参考图与蒙版**；缺任一项时客户端拦下生成、Host 入队返回 `400 invalid_request`、
  daemon 提交期同样拒绝。这类预设生成的图与普通预设一样落盘、可回填参数。
- 校验失败：路径/文件问题 → `400 invalid_path`；格式、体积、强度或模型能力问题 →
  `400 invalid_request`（执行阶段发现的问题让任务以 `invalid_path` / `invalid_request` 失败，
  不占用 GPU 加载模型）。
- 远端任务结果项在原有字段外带 `strength` / `referenceWidth` / `referenceHeight`（送入模型的参考图
  实际尺寸）；局部重绘再带 `inpaint: true` / `maskWidth` / `maskHeight`（客户端原始蒙版尺寸）。
  Host 只透传不消费，产物 `meta.json` 用 Host 自己的 `sourceImage` / `strength` / `inpaint` 记录出处。
- **非正方形参考图**：局部重绘分支给管线显式下传按 8 对齐的参考图宽高（`w // 8 * 8`、`h // 8 * 8`），
  不再依赖管线的缺省方形尺寸；管线不接受该参数时由 `__call__` 签名过滤丢弃，出图尺寸仍跟随参考图，
  像素合成（composite）保留为尺寸不一致时的兜底。日志会打印 `[gen] inpaint ... kw=...,height,...,width,...`。

- **响应**：**裸 `Job` 对象**（不是 `{ ok, job }` 包装）。`waitSeconds > 0` 时返回的是等待结束后的快照，
  任务可能仍在 `queued` / `running`。

`Job` 结构：

| 字段 | 说明 |
| :--- | :--- |
| `id` | 任务 id（`j_<hex>`） |
| `status` | `queued` / `waiting-session` / `running` / `done` / `failed` / `cancelled` |
| `stage` | 给人看的中文阶段文案（如「排队中」「生成中」「已取消」）。**只用于中文界面与日志，客户端不得解析它做本地化** |
| `stageCode` | 结构化阶段标识（稳定英文）：`queued` / `waiting-session` / `loading` / `running` / `done` / `failed` / `cancelled`。`loading` 专指会话就绪路径上远端仍在加载模型（`sessionState=warming`）；客户端按它选本地化文案 |
| `progress` | 仅在 `running` 时非 `null`：`{ done, total }`，`done` 是**已完成的张数**（0 起）。其余状态为 `null`；客户端用 `done + 1` 展示「正在生成第 k/总数 张」 |
| `cancelRequested` | 是否已收到取消请求（running 合作式停止中为 `true`）；终态/未取消为 `false` |
| `presetId` | 实际使用的预设 id |
| `params` | 归一化后的参数：`{ prompt, negativePrompt, width, height, steps, cfg, seed, count }`；图生图任务额外带 `reference: { sourcePath, strength }`（不包含参考图二进制） |
| `createdAt` / `startedAt` / `finishedAt` | ISO 时间；未发生为 `null` |
| `seconds` | 生成耗时（秒，1 位小数）或 `null` |
| `sessionState` | 任务执行时最近的会话状态 |
| `modelId` | 预设对应的仓库标识（远端可能回传实际值） |
| `output` | 完成时 `{ dir, metaFile, images[] }`，否则 `null` |
| `error` | 失败时 `{ code, message }`，否则 `null` |

`output.images[]` 每项：`{ file, path, url, width, height, seed, seconds }`，其中 `path` 是工作区相对路径，
`url` 是 `/imagen-api/file?path=...` 形式的预览地址。

- **响应示例**：

```json
{
  "id": "j_9f2c1a4b",
  "status": "queued",
  "stage": "排队中",
  "stageCode": "queued",
  "progress": null,
  "presetId": "sdxl-lightning",
  "params": {
    "prompt": "a cinematic portrait of an astronaut",
    "negativePrompt": "blurry, low quality",
    "width": 1024,
    "height": 1024,
    "steps": 4,
    "cfg": 0,
    "seed": 42,
    "count": 1
  },
  "createdAt": "2026-11-09T04:10:00.000Z",
  "startedAt": null,
  "finishedAt": null,
  "seconds": null,
  "sessionState": "ready",
  "modelId": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
  "output": null,
  "error": null
}
```

- **错误**：`400 invalid_prompt`（prompt 为空/超长）、`400 queue_full`（待执行队列已满）、
  `400 invalid_body`（请求体不是合法 JSON）、`400 invalid_path` / `400 invalid_request`（图生图参考图不合法）。

> **图生图产物**：`meta.json` 在原有字段外记录 `sourceImage`（参考图工作区相对路径；上传来源为 `null`）
> 与 `strength`（重绘强度），历史条目通过 `params.reference` 读取同一信息。0.13.0 起再记录
> `rootImage`（版本树根作品图片路径，O(1) 归组整棵树）：落盘时读父作品所在目录的 `meta.json`，
> 有 `rootImage` 直接继承，旧 meta 没有则沿 `sourceImage` 链回溯（最多 8 层，成环/缺失即停），
> 读不到父 meta 时退回 `sourcePath` 本身；前端动态上传的参考图没有可归组的根，`sourceImage` /
> `rootImage` 均写 `null`。

#### `GET /imagen-api/job?id=<jobId>`

查询单个任务的状态与结果。

- **响应**：`Job` 对象（结构同上）。
- **错误**：`404 not_found`（任务不存在或已被裁剪）。

#### `POST /imagen-api/job/cancel`

取消任务。语义按任务当前状态区分：

- `queued` / `waiting-session`：**立即出队失效**，不占用队列位置；等待会话的任务会立刻中止会话等待，
  后续任务不必等到会话等待窗口超时才继续（解除队头阻塞）。
- `running`：**合作式停止**——只置取消标记，当前正在画的这一张出完后不再提交批内剩余张数，
  不强杀线程、不改远端采样回调；取消前已完成的图片仍会落盘，任务最终收敛为 `cancelled`。
- `done` / `failed` / `cancelled`：终态，不做任何改变。

- **请求体**：`{ "id": "j_9f2c1a4b" }`
- **响应**：`{ "ok": true, "job": Job, "disposition": "dequeued" | "cooperative" | "already-finished" }`
  （`disposition` 取值与语义见 `shared/contract.js` 的 `JOB_CANCEL`）。
- **错误**：`404 not_found`（任务不存在）、`400 invalid_body`（请求体不是合法 JSON）。

#### `GET /imagen-api/jobs?limit=<n>`

查询最近任务列表与队列概况。

- `limit`：1~100，默认 20。
- **响应**：`{ "jobs": Job[], "queue": { "running": "j_... | null", "pending": 0 } }`

#### `GET /imagen-api/history?limit=<n>&offset=<n>`

获取工作区 `imagen-output/` 下的历史生成记录，按时间倒序。

- `limit`：1~100，默认 30。
- `offset`：跳过最近 `offset` 条有效记录（有 meta 且至少 1 张现存图片），非负整数，默认 0。
- **响应**：`{ "items": HistoryItem[], "limit": number, "offset": number, "hasMore": boolean }`。
  `items` 保持数组类型（旧客户端只读该字段即可向后兼容）；`hasMore=true` 表示还有更早的记录，
  客户端可在底部继续「加载更多」（前端每次取契约上限 `LIMITS.history.pageSize` = 100 条）。

`HistoryItem`：`{ jobId, dir, createdAt, finishedAt, presetId, params, prompt, images[], source, sourceImage, rootImage, inpaint, strength }`；
`params` 是完整的生成参数（用于「带回参数」），`images[]` 每项：
`{ file, path, absolute, url, width, height, seed, seconds }`（已按文件是否存在过滤，删除过的图不会出现）。
`source` 是作品来源（阶段十五 Phase A）：`"ai"` 为 AI 生成，`"import"` 为用户本地导入（见 §2.3 `/import`，导入图不参与 AI 生成计数）。
`sourceImage` / `rootImage` / `inpaint` / `strength` 是 0.13.0 起的版本链字段（语义见 §5.18）：`sourceImage`
是本次生成所用参考图的工作区相对路径（纯文生图或前端动态上传参考图时为 `null`）；`rootImage` 是整棵
派生树的根作品路径（无参考图的根作品为 `null`，每张候选图各自为根；旧 `meta.json` 缺该字段时由 Host 按
`sourceImage` 链回溯，回溯不到时退回 `sourceImage`）；`inpaint` 为局部重绘标记；`strength` 为重绘强度。

#### `GET /imagen-api/history/tree?root=<encodedPath>&limit=<n>`

按根作品返回整棵派生树（0.13.0 新增）。历史列表是分页的，版本链的根节点可能落在更早的页里；
作品条的版本派生面板按需调用该接口补齐整棵树，避免跨页断链。

- `root`：必填，`imagen-output/` 内作品的工作区相对路径（与 `/imagen-api/file?path=` 同一口径）；
  必须无路径穿越且落在输出目录内，否则 `400 invalid_request`。
- `limit`：1~100，默认 `LIMITS.history.pageSize`。
- **响应**：`{ "root": string, "items": HistoryItem[], "hasMore": boolean }`。`items` 包含根作品本身
  （`images` 里有 `root` 的那条记录）与全部 `rootImage === root` 的衍生作品，按时间倒序；
  `hasMore=true` 表示该树记录数超过 `limit`。
- **错误**：`400 invalid_request`（缺少 `root`、路径非法或越界）。
- 旧宿主没有该路由时返回 404，客户端降级为「仅使用已加载分页」并在版本面板提示不可用，不阻断浏览。

#### `GET /imagen-api/file?path=<encodedPath>`

读取产物图片二进制流，供前端直接预览。

- `path` 必须是工作区相对路径且落在 `imagen-output/` 内（越界路径返回 404，不做目录穿越猜测）。
- 支持 `HEAD`；成功响应带 `content-type`、`content-length`、`cache-control: public, max-age=31536000, immutable`。
- **错误**：`404 not_found`（路径非法、文件不存在或读取失败）。

### 2.3 收藏、文案与本地动作

#### `POST /imagen-api/import`

把用户选择的本地图片（PNG / JPEG）落盘为「导入作品」（阶段十五 Phase A）。

- **请求体**：`{ "data": "data:image/png;base64,…", "name": "photo.png" }`
  - `data`：dataURL 或裸 base64；解码后不超过 `IMPORT.maxBytes`（8 MiB）。
  - `name`：仅用于展示，清理控制字符后截断到 `IMPORT.maxNameChars`（120 字符），不参与落盘路径。
- **校验**：PNG / JPEG 魔数、解析宽高、宽高均不小于 `IMPORT.minEdge`（128 像素）；按原长边落盘，不缩放（上限 `IMPORT.maxEdge` 只用于提示）。
- **落盘**：`imagen-output/<YYYYMMDD-HHmmss>-import-<6 位随机>/`，文件名为 `01.png` / `01.jpg`，`meta.json` 与生成产物同构并追加 `source: "import"`、`imported: true`；若 PNG 内含本插件写入的 tEXt 生成元数据（keyword `our-imagen`），解析后写入 `generation` 并用它覆盖 `params`（胶片条点该图可回填原生成参数）。
- **响应**：`{ "ok": true, "entry": { "image": { "file", "path", "url", "width", "height", "absolute" }, "item": <与 /history 条目同形>, "generation": object|null } }`
  （`generation` 只在 PNG 内嵌本插件生成元数据时非空；客户端据此提示「已识别生成参数」）
- **错误**：`400 invalid_body`（字段缺失 / 非法 JSON）、`400 invalid_request`（超体积、不是 PNG/JPEG、尺寸过小）。
- 导入作品与生成作品一样出现在 `/history` 与 `/history/tree`（`item.source === "import"`，独立根 `v1`），画廊与胶片条显示「导入」角标，不计入 AI 生成数量。

#### `GET /imagen-api/library`

读取本地收藏与删除记录。

- **响应**：`{ "favorites": string[], "deleted": [{ "path": string, "at": string }], "notes"?: string[] }`
- `notes` 只在库文件损坏或读取失败时出现（如 `library.json 已损坏，暂按空库显示…`），前端据此提示而不是静默清空。

#### `POST /imagen-api/library/favorite`

- **请求体**：`{ "path": "imagen-output/…/1.png", "favorite": true }`
- **响应**：`{ "ok": true, "favorites": [...] }`
- **错误**：`400 invalid_body`（缺少 `path`）、`400 invalid_path`（路径为空或非法）。

#### `POST /imagen-api/library/delete`

- **请求体**：`{ "paths": ["imagen-output/…/1.png", ...] }`
- 单次最多 200 条（`400 too_many`）；只允许删除 `imagen-output/` 内的文件。
- **响应**：`{ "ok": boolean, "removed": string[], "failed": [{ "path": string, "code": string }], "favorites": string[] }`
  （`ok` 表示全部成功；越界/不存在的路径进 `failed`，不会中断其余删除）

#### `POST /imagen-api/enhance`

提示词润色与英译。按 `mode` 区分两种用途（`ENHANCE_MODES`）：

- `mode="refine"`（默认）：按光影 / 材质 / 构图 / 氛围四个维度返回可直接追加进提示词的英文短语。
- `mode="translate"`：把提示词转成英文提示词（只复用宿主已配置的模型，不接第三方重模型）。

**refine 模式**

- **请求体**：`{ "prompt": "雨夜街景", "presetId": "sdxl-lightning", "locale": "zh", "mode": "refine" }`
  （`presetId` / `locale` / `mode` 可选，locale 仅 `zh` / `en`）
- **响应**：

```json
{
  "ok": true,
  "source": "model",
  "groups": [
    {
      "dimension": "lighting",
      "options": [{ "id": "model-lighting-0", "text": "soft diffused light", "label": "柔和漫射光" }]
    },
    { "dimension": "material", "options": [] }
  ]
}
```

- 每条建议固定拆成两段：`text` 是要追加进 prompt 的英文短语（九个预设都按英文提示词训练，发给模型的只能是英文），
  `label` 是给用户看的 UI 语言短标签（`locale=en` 时与 `text` 相同）。
- `source`：`model`（宿主模型）/ `local`（同结构本地兜底）；空提示词返回空 `groups`、`source: "local"`。
- `presetId` 决定润色的书写口径：system prompt 由模型资产生成（当前模型的提示词配方与质量词前缀、速度档位、
  负向词能力，见 `shared/models-guide.js`），并要求「原文已覆盖的维度不再重复给同类建议」；`presetId` 缺失或未知时
  按通用口径处理，不把默认预设冒充成用户指定的模型。

**translate 模式**

- **请求体**：`{ "prompt": "雨夜街景", "presetId": "sdxl-lightning", "mode": "translate" }`
- **响应**：`{ "ok": true, "mode": "translate", "source": "model" | "local", "prompt": "..." }`
- `source`：`model` 表示模型返回了英文提示词；`local` 表示模型不可用（`note: "llm_unavailable"`）
  或输入为空（`note: "empty"`），此时 `prompt` 是原文、**没有翻译**。界面必须按「未翻译」明确提示，
  不得把原文当作译后结果展示。

#### `POST /imagen-api/intent`

对话模式意图解析（意图 JSON v2）：把一句话整理成可直接执行的生成参数，必要时返回通用澄清项或模型建议。

- **请求体**：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `text` | string | 必填。本轮用户输入，trim 后 1~`LIMITS.intentText.maxChars`（2000）字符 |
| `previousPrompt` | string | 可选。上一轮英文提示词；`history` 为空时作为上一轮上下文（旧客户端兼容） |
| `locale` | string | 可选，`zh`（默认）/ `en`。只决定 `summary` / `clarify` / `modelHint.reason` 的语言，不影响 `prompt` / `negative` |
| `presetId` | string | 可选。当前预设 id，决定提示词书写口径与负向词能力；未知 id 回退默认预设 |
| `cfg` | number | 可选。客户端当前表单的 CFG，决定本次 `negative` 是否生效；非法 / 缺失时回落预设推荐值 |
| `history` | array | 可选。多轮上下文，元素 `{ role: "user" \| "assistant", content: string }`；Host 按 `LIMITS.intentHistory` 裁剪：角色白名单、单条非空且截断到 2000 字符、只保留最近 12 条，非法项丢弃不报错。`history` 非空时优先于 `previousPrompt` |

请求示例：

```json
{
  "text": "画一张横版的雨夜街景，不要文字",
  "locale": "zh",
  "presetId": "sdxl-base",
  "cfg": 7.5,
  "history": [
    { "role": "user", "content": "上一轮：雨夜街景" },
    { "role": "assistant", "content": "rainy night city street, wet pavement reflecting neon signs" }
  ]
}
```

- **错误**：`400 invalid_request`（`text` 为空或超过 `LIMITS.intentText.maxChars`）。

- **响应**：

```json
{
  "ok": true,
  "source": "model",
  "prompt": "rainy night city street in 16:9, wet pavement reflecting neon signs, cinematic lighting",
  "summary": "横版雨夜街景，湿润路面倒映霓虹招牌，电影感光影",
  "ratioId": "16:9",
  "negative": "text, watermark",
  "clarify": null,
  "modelHint": null
}
```

- `prompt` **恒为英文**，不随 `locale` 变化；`negative` 也恒为英文。
- `ratioId` 只取契约 `RATIO_IDS`（`1:1` / `16:9` / `9:16` / `4:3` / `3:4`），模型无法判断时为空串；不再有风格字段。
- `negative`：仅在 `negativePromptActive(preset, cfg)` 为 true 时可能非空，否则**必须为空串**（避免把无效参数带进表单）；长度受 `LIMITS.negativePrompt.maxChars` 限制。
- `summary`：给用户确认用的本轮画面概述（UI 语言），只进界面、不发给生图模型；截断到 `INTENT.summaryMaxChars`。
- `clarify`：`null` 或 `{ "question": string, "options": string[] }`。`question` ≤ `INTENT.clarifyQuestionMaxChars`；`options` 去重后 2~4 条、每条 ≤ `INTENT.clarifyOptionMaxChars`，不足 2 条时整条丢弃。澄清轮仍必须给出草稿 `prompt`，不再要求空提示词。
- `modelHint`：`null` 或 `{ "presetId": string, "reason": string }`。`presetId` 必须存在于契约 `PRESETS` 且不能等于当前预设；`reason` 是 UI 语言短理由（≤ `INTENT.modelHintReasonMaxChars`），模型没给理由时用该预设的定位描述兜底。模型建议只是弱提示，不改变本次生成使用的预设。
- 无可用模型或输出不可解析时 `source` 为 `local`：`prompt` 与 `summary` 都是用户原话，`ratioId` / `negative` 为空串，`clarify` / `modelHint` 为 `null`；界面会明确提示这是本地兜底结果。

#### `POST /imagen-api/reveal`

在系统文件管理器中打开产物目录（仅限 `<workspace>/imagen-output/`）。

- **请求体**：`{}`；`{ "dryRun": true }` 只解析目录、不唤起文件管理器（自检用）。
- **响应**：`{ "ok": true, "dir": "…/imagen-output" }`（dryRun 时多一个 `"dryRun": true`）。
- **错误**：`404 output_missing`（目录不存在）、`500 reveal_failed`（调起失败）。

### 2.4 运行设置（settings）

工作台「运行设置」抽屉的数据接口。静态默认值来自宿主插件配置（`config`），用户在抽屉里改过的项以覆盖项形式
持久化到 `<workspace>/.imagen/settings.json`（目录 0700 / 文件 0600，同目录临时文件 + `rename` 原子写）。
字段边界与取值域见契约 `SETTINGS`。

#### `GET /imagen-api/settings`

- **响应**：`{ "ok": true, "settings": SettingsView }`

#### `POST /imagen-api/settings`

- **请求体**（都是可选字段，只提交用户改动过的项）：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `idleTimeoutSec` | integer | 空闲自动关机秒数，按契约 `SETTINGS.idleTimeoutSec` 钳制 |
| `accelerator` | string | GPU 加速器，取值域 `SETTINGS.accelerators` |
| `hfToken` | string | HuggingFace Token；空字符串表示「保持不变」 |
| `clearHfToken` | boolean | `true` 时清除本地保存的 Token |
| `datasetSources` | string[] | 预挂载 Kaggle Dataset（`owner/dataset`），去空去重、最多 32 项 |
| `pipConstraints` | string[] | pip 依赖约束（如 `diffusers==0.31.0`），去空去重、最多 32 项 |
| `localModels` | object | 本地权重映射 `repo → 容器内目录`（值必须以 `/` 开头），最多 32 项 |
| `kaggleTransport` | string | Kaggle 访问方式：`direct`（默认，免装 CLI）或 `cli`（兼容），取值域 `SETTINGS.kaggleTransports`；下次唤醒/探测生效 |

- **响应**：`{ "ok": true, "settings": SettingsView }`（与保存后的生效值一致）。
- **错误**：`400 invalid_body`（请求体不是合法 JSON 或不是对象）、`400 invalid_request`（字段值不合法）。

`SettingsView`（脱敏视图，**永不包含 `hfToken` 原文**）：

| 字段 | 说明 |
| :--- | :--- |
| `idleTimeoutSec` | 当前生效的空闲自动关机秒数 |
| `accelerator` | 当前生效的 GPU 加速器 |
| `datasetSources` / `pipConstraints` | 当前生效的字符串数组 |
| `localModels` | 当前生效的本地权重映射 |
| `hasHfToken` | 是否已配置 HuggingFace Token（布尔） |
| `hfTokenSource` | `settings`（抽屉里设置的）/ `config`（宿主插件配置）/ `none` |
| `kaggleTransport` | 当前生效的 Kaggle 访问方式（`direct` / `cli`） |
| `effectiveOnNextSession` | 当前远端实例正在运行、改动要到下次唤醒才生效时为 `true` |

> 设置改动对**下一次** `session.start()` 生效：宿主要在构造下发配置前读取合并后的最新设置，
> 而不是只在插件加载时读一次静态 `config`。诊断环境指纹（`/logs` 的 `env`）同样使用合并后的设置，
> 且只输出布尔开关。
>
> **实现约束（同 path 的 GET/POST）**：DSH 宿主的 exact 路由表以 path 为键，同一 path 不允许注册两次。
> 因此 `/imagen-api/settings` 只注册一条路由，用 `method: [GET, POST]` 在 handler 内按方法分发；
> 方法不匹配时仍返回 `405` 且 `Allow: GET, POST`。契约里的 `settings` / `settingsSave` 是两条语义
> 条目、共用一个 path，新增同 path 方法时沿用这个做法。

---

### 2.5 工作台界面状态（ui-state）

把「表单高级设置折叠区是否展开」这类纯界面偏好持久化到 `<workspace>/.imagen/ui-state.json`
（目录 0700 / 文件 0600，同目录临时文件 + `rename` 原子写），下次打开工作台沿用上次状态。

界面态不是业务数据：只允许契约 `UI_STATE.defaults` 登记的白名单字段，字段类型与默认值以契约为准；
文件不存在、损坏或超过 `UI_STATE.maxBytes` 时一律回落到默认值，绝不阻塞插件加载或出图主链路。
未登记的字段在保存时直接丢弃（不报错），已登记字段类型不匹配才按 `invalid_request` 拒绝。

#### `GET /imagen-api/ui-state`

- **响应**：`{ "ok": true, "uiState": UiStateView }`（始终返回白名单全量视图，不是稀疏补丁）

#### `POST /imagen-api/ui-state`

- **请求体**：扁平补丁（只提交改动过的字段），例如 `{ "advancedOpen": true }`
- **响应**：`{ "ok": true, "uiState": UiStateView }`（与保存后的生效值一致）
- **错误**：`400 invalid_body`（请求体不是合法 JSON 或不是对象）、`400 invalid_request`（已登记字段类型不匹配）

`UiStateView`：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `advancedOpen` | boolean | 表单「高级设置」折叠区是否展开，默认 `false`（收起） |

> **实现约束（同 path 的 GET/POST）**：与 `/imagen-api/settings` 相同，DSH 宿主的 exact 路由表
> 以 path 为键、同一 path 不允许注册两次，因此只注册一条路由、用 `method: [GET, POST]` 在 handler
> 内按方法分发；方法不匹配时返回 `405` 且 `Allow: GET, POST`。

### 2.6 Kaggle 直连登录（kaggle/login）

直连模式（`kaggleTransport = direct`，**自本版起为默认**）不需要本机安装 `kaggle` CLI：宿主用标准 OAuth 2.0 + PKCE
（`client_id=kagglesdk`、`S256`、`scope=resources.admin:*`）完成授权。浏览器模式由宿主拉起系统浏览器，
并在本机回环端口监听回调；无法打开浏览器（无头环境等）时降级为「复制授权链接 + 粘贴授权码」。
成功后凭据写入 `%USERPROFILE%\.kaggle\credentials.json`（OAuth 凭据，含 `refresh_token`；目录 0700 /
文件 0600、同目录临时文件 + `rename` 原子写），与 `kaggle auth login` 完全同格式；`access_token` 过期时
宿主自动用 `refresh_token` 续期。token 不进入任何日志与对外快照。

#### `GET /imagen-api/kaggle/login`

- **响应**：`{ "ok": true, "login": LoginView }`

#### `POST /imagen-api/kaggle/login`

- **请求体**：

| `action` | 说明 |
| :--- | :--- |
| `start` | 发起登录（已有进行中的登录时直接返回当前态） |
| `cancel` | 取消等待中的登录 |
| `submit-code` | `manual` 模式下提交浏览器里拿到的授权码（必须带 `code`） |

- **响应**：`{ "ok": true, "login": LoginView }`
- **错误**：`400 invalid_request`（`action` 不在契约 `KAGGLE_LOGIN.actions` 内，或 `submit-code` 缺少 `code`）。

`LoginView`：

| 字段 | 说明 |
| :--- | :--- |
| `state` | `idle` / `pending` / `done` / `failed` / `cancelled`（取值域契约 `KAGGLE_LOGIN.states`） |
| `mode` | `browser` / `manual`（契约 `KAGGLE_LOGIN.modes`） |
| `url` | 需要用户手动打开的授权链接；`manual` 模式必填，其它情况为 `null` |
| `message` | 失败原因（可读、已脱敏）；非失败态为 `null` |
| `username` | 成功后回填的 Kaggle 用户名（Colab 登录回填 Google 邮箱） |
| `startedAt` / `finishedAt` | ISO 时间（未开始 / 未结束为 `null`） |

客户端按契约 `KAGGLE_LOGIN.pollMs` 轮询 GET 直到进入终态；超过 `KAGGLE_LOGIN.timeoutMs` 由宿主收敛为
`failed`。登录接口与传输方式解耦：CLI 模式下也能调用（`kaggle auth login` 与直连写同一份凭据文件），
界面只在直连模式下把 `cli_missing` / `auth_required` 指引卡的主操作切为「在浏览器中登录 Kaggle」。

#### `GET /imagen-api/colab/login` 与 `POST /imagen-api/colab/login`

- **用途**：Colab Google OAuth 2.0 登录状态机，动作与 `LoginView` 形状复用 `COLAB_LOGIN`（同 `KAGGLE_LOGIN`）。
- **GET 响应**：`{ "ok": true, "login": LoginView, "auth": { "authorized": boolean, "email": string | null } }`
- **POST 请求体**：`{ "action": "start" | "cancel" | "submit-code", "code"?: string }`
  - `start` 发起 Google OAuth 授权（`browser` 与 `manual` 均使用 `http://localhost:<port>` 本地回环回调，Google 已拒绝远程粘贴页）；
  - `submit-code` 支持粘贴完整回跳 URL（`http://localhost:.../?code=...`）或授权码正文；
  - 成功后原子写入 `~/.imagen/colab-credentials.json`（权限 `0600`），仅返回脱敏状态与邮箱，绝不回传或打印任何令牌。

---

## 3. DSH 会话 Agent 工具规范

插件向 DSH 会话模型注入 6 个标准 Tool，支持对话中直接出图：`imagen_generate`（单张/多张）、
`imagen_batch`（一次规划一组任务）、`imagen_recipes`（只读检索风格配方模板）、`imagen_session`、
`imagen_history`、`imagen_cancel`。

### 3.1 `imagen_generate`

- **描述**：在免费的 Kaggle GPU 上运行开源文生图模型并出图，图片保存到工作区 `imagen-output/` 目录。
  首次调用若远端会话未启动，会自动拉起 Kernel（可能需要排队 10 分钟以上）。
  等待超时不影响任务继续执行：返回里的 `jobId`（形如 `j_1a2b3c4d`）可配合 `imagen_cancel` 取消，或用
  `imagen_history` 轮询结果；传 `saveTo` 可把图片直接交付到工作区路径。
  描述末尾注入**模型库概要**：每个预设一行（名称 / 家族 / 步数 / 实测耗时 / 提示词写法 / 默认 CFG 与负向词能力 /
  是否支持垫图 / 定位），让 Agent 能按专长选模型，而不是只看到 id 枚举。
- **输入参数**（`additionalProperties: false`）：

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `prompt` | string | 是 | 画面描述，建议英文，不超过 2000 字符 |
| `negativePrompt` | string | 否 | 排除项（反向提示词）。只在所选模型真的消费负向词且 `CFG > 0` 时生效；`CFG=0` 的极速模型或不支持负向词的模型会忽略它，需要排除内容时改用正面描述 |
| `presetId` | string | 否 | 预设 id（枚举来自契约 `PRESETS`），默认 `sdxl-lightning`；具体写法与专长见工具描述里的模型库 |
| `width` | integer | 否 | 宽度 256–1536，默认取预设 |
| `height` | integer | 否 | 高度 256–1536，默认取预设 |
| `steps` | integer | 否 | 采样步数 1–60，默认取预设 |
| `cfg` | number | 否 | CFG 0–20，默认取预设 |
| `seed` | integer | 否 | 随机种子，省略则随机 |
| `count` | integer | 否 | 张数 1–4，默认 1 |
| `waitSeconds` | integer | 否 | 最多等待累计秒数 0–600，默认 90；超时后任务仍在后台继续 |
| `saveTo` | string | 否 | 工作区内的相对交付路径，见下方「saveTo 交付规则」 |

**saveTo 交付规则**：

1. 原始归档照常生成：`imagen-output/<YYYYMMDD-HHmmss>-<jobId>/` + `meta.json` 不受影响；
   `saveTo` 在其之上做一次**原子复制交付**（同目录临时文件 + `rename`），交付成功的相对路径记入
   `job.output.deliveredPaths`，`describeJob()` 的产物段会逐条列出 `已交付至：<path>`。
2. 只接受非空相对路径；拒绝绝对路径、Windows 盘符前缀、`\0`、任何 `..` 段、以及落在
   `imagen-output/` / `.imagen/` 内的目标。目标路径的最近已存在祖先会做 `realpath` 校验，
   工作区内指向工作区外的软链接同样拒绝。
3. 未写扩展名时自动补 `.png`；`count === 1` 直接落盘为目标文件名，`count > 1` 按 `-01`、`-02`
   追加序号（`docs/assets/hero.png` → `docs/assets/hero-01.png`、`hero-02.png`）。
4. 非法路径在入队前就返回 `invalid_path`（不占用队列、不触发远端生成）。
5. 父目录按需创建；写盘不残留 `.tmp-*` 临时文件。

- **返回**：文本（`{ "text": string }`），内容为任务状态 / 参数摘要 / 产物路径（完成时提示可用
  `![描述](URL)` 展示图片；交付过的副本单独列出）。

### 3.2 `imagen_batch`

- **描述**：按一组提示词批量出图（单次 1–8 条，适合文章配图、分镜与系列插画）。全部条目共享
  `presetId` / `width` / `height` / `steps` / `cfg`，逐条提交到同一串行队列，每条任务只出 1 张图。
  单条校验不通过或生成失败只影响该条；汇总给出成功产物路径与 URL、失败原因、未完成任务 `jobId`。
  需要风格参考时先用 `imagen_recipes` 检索模板，再把模板显式改写进各条 `prompt`（工具不会追加风格后缀）。
- **输入参数**（`additionalProperties: false`，必填 `items`）：

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `items` | array | 是 | 任务列表，1–`LIMITS.batch.maxItems`（8）条；每项 `{ prompt(必填), negativePrompt?, seed?, saveTo? }`，`additionalProperties: false` |
| `presetId` | string | 否 | 公共预设 id（枚举来自契约 `PRESETS`），默认 `sdxl-lightning` |
| `width` / `height` | integer | 否 | 公共宽高 256–1536，默认取预设 |
| `steps` | integer | 否 | 公共采样步数 1–60，默认取预设 |
| `cfg` | number | 否 | 公共 CFG 0–20，默认取预设 |
| `waitSeconds` | integer | 否 | **本次调用的总等待预算**（0–600，默认 90），不是每条任务的预算；预算用尽后返回未完成任务 `jobId`，任务仍在后台继续 |

- **行为**：条目数超过上限 → 整批拒绝、一条都不提交；`saveTo` 逐项走同一套交付校验（含软链接逃逸），
  非法或重复的条目只标记该条失败；`queue.submit` 抛异常也只影响该条。所有任务共享一个 deadline，
  按提交顺序串行等待，预算用尽即停止等待且**不取消**任务。
- **返回**：文本汇总，首行是「共 N 条，成功 X，失败 Y，未完成 Z」，随后逐条给出产物路径 / 尺寸 / seed / URL
  （成功）、`error.code: message`（失败）或 `jobId + 状态`（未完成），末尾给出用 `imagen_history` 轮询与
  `imagen_cancel` 取消的指引。

### 3.3 `imagen_recipes`

- **描述**：只读检索透明风格配方库，按关键词、风格分类、标签或 `presetId` 查找可读的提示词模板与适配模型。
  配方只返回可见文本（模板里用 `{subject}` 占位），不会替用户拼接任何样式后缀；无匹配时返回可执行的检索建议。
- **输入参数**（`additionalProperties: false`，全部可选）：

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `keyword` | string | 风格关键词（如 `日系` / `赛博霓虹` / `极简海报`），多词用空格或逗号分隔，需全部命中 |
| `category` | string | 风格分类，枚举来自 `shared/recipes.js` 的 `RECIPE_CATEGORIES` |
| `presetId` | string | 按适配的模型预设过滤（枚举来自契约 `PRESETS`） |
| `tags` | array | 标签数组，需全部命中 |
| `limit` | integer | 返回条数 1–配方总数，默认 5 |

- **返回**：匹配配方的 `id` / 标题 / 分类 / 标签 / 适配预设 / 推荐比例 / 提示词模板（按目标模型的
  `promptStyle` 给出对应写法）/ 推荐负向词；无匹配时给出可执行的替代检索建议。

### 3.4 `imagen_session`

- **描述**：管理云端 GPU 会话（查询状态、主动开机、主动关机）。
- **输入参数**：`action`（必填，枚举 `start` / `stop` / `status`）、`presetId`（可选，枚举来自契约 `PRESETS`）。
- **返回**：会话状态摘要文本。

### 3.5 `imagen_history`

- **描述**：获取当前工作区最近生成的图片文件列表与参数信息。
- **输入参数**：`limit`（可选，1–30，默认 5）。
- **返回**：最近生成的条目文本（时间、预设、提示词摘要、图片路径）。

### 3.6 `imagen_cancel`

- **描述**：取消一个已提交的生图任务（排队任务立即出队失效；生成中任务合作式停止，当前这张出完后不再提交
  批内剩余张数，已出的图片仍保留）。
- **输入参数**（`additionalProperties: false`，必填 `jobId`）：

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `jobId` | string | 是 | 要取消的任务 ID（来自 `imagen_generate` 返回结果） |

- **返回**（按取消结果折叠成模型可读文本，与 `/imagen-api/job/cancel` 的 `disposition` 一一对应）：

| 场景 | 返回文本 |
| :--- | :--- |
| 任务不存在 | `未找到任务 <jobId>` |
| `dequeued` | `已取消任务 <jobId>（已从队列移除）` |
| `cooperative` | `已向任务 <jobId> 发送合作式取消请求：当前正在生成的单张完成后将停止，不再继续后续张数，已出图像仍保留` |
| `already-finished` | `任务 <jobId> 已处于终态（<status>），无需取消` |

---

## 4. 模型基准与硬件实测数据

运行环境：Kaggle Nvidia Tesla T4（分配 2 块 T4，每卡可用显存 14.56 GiB，CUDA 12.x）。
**数值以 `shared/contract.js` 的 `PRESETS` 为准**（`peakVramMb` 为实测峰值显存，`loadSeconds` 为首次加载耗时，
`steadySeconds` 为加载完成后的单张稳定耗时）。

`presets` 的公开视图随模型资产下发提示词与能力字段：`negativeHint`（该预设推荐的负向提示词，切换预设或把 CFG 抬到可用时自动回填模型负向层）、
`promptStyle`（`danbooru` / `natural` / `concise`，决定意图解析与润色时给模型的书写口径）、`qualityPrefix`（质量词前缀，无则为空串）、
`supportsImg2Img`（是否支持垫图重绘）与 `supportsNegative`（管线是否真的消费 `negative_prompt`）。字段来源是 `models/*.json`。
负向词最终是否可用还要看 CFG 与推荐词，判定规则见 [`docs/MODEL_ASSET_SPEC.md`](MODEL_ASSET_SPEC.md) §2.3。

| 预设 ID | 基础模型与权重 | 默认尺寸（可选档位） | 步数 / CFG | 加载 / 单张耗时 | 峰值显存 | 下载量 | 卡数 | 档位 | 负向词 |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | :--- | :--- |
| **`sdxl-lightning`** *(默认)* | `stabilityai/stable-diffusion-xl-base-1.0` + `ByteDance/SDXL-Lightning` (4-step LoRA) | 1024（768 / 1024 / 1152） | 4 步 / 0 | 7.7s / 6.2s | 10347 MB | 6.78 GB | 1 | fast | 支持（默认隐藏） |
| **`hyper-sdxl-8step`** | `stabilityai/stable-diffusion-xl-base-1.0` + `ByteDance/Hyper-SD` (8-step LoRA) | 1024（768 / 1024） | 8 步 / 0 | 14.3s / 7.74s | 10347 MB | 7.35 GB | 1 | fast | 支持（默认隐藏） |
| **`sdxl-turbo`** | `stabilityai/sdxl-turbo` | 512（512 / 768 / 1024） | 4 步 / 0 | 4.0s / 1.87s | 7666 MB | 6.62 GB | 1 | fast | 支持（默认隐藏） |
| **`playground-v2.5`** | `playgroundai/playground-v2.5-1024px-aesthetic` | 1024（768 / 1024） | 30 步 / 3 | 5.7s / 28.34s | 9967 MB | 6.46 GB | 1 | usable | 支持 |
| **`sdxl-base`** | `stabilityai/stable-diffusion-xl-base-1.0` | 1024（768 / 1024 / 1152） | 25 步 / 7.5 | 5.8s / 27.8s | 9966 MB | 6.78 GB | 1 | usable | 支持 |
| **`sdxl-inpaint`** *(专用局部重绘)* | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`（9 通道 UNet，`nativeInpaint`） | 1024（768 / 1024 / 1152） | 30 步 / 8 | 待实测 / 22.4s | 待实测 | 7.0 GB | 1 | quality | 支持 |
| **`realvis-v5`** | `SG161222/RealVisXL_V5.0` | 1024（768 / 1024） | 25 步 / 5 | 5.2s / 24.53s | 9967 MB | 6.46 GB | 1 | usable | 支持 |
| **`flux2-klein-4b`** *(实验)* | `black-forest-labs/FLUX.2-klein-4B` | 1024（768 / 1024） | 4 步 / 1.0 | 28.2s / 10.24s | 7929 MB | 15.2 GB | 2 | fast | 不支持 |
| **`animagine-xl-3.1`** | `cagliostrolab/animagine-xl-3.1` | 1024（768 / 1024） | 28 步 / 7 | 4.8s / 26.17s | 9176 MB | 6.46 GB | 1 | usable | 支持 |
| **`anima-light-lavender`** | `Johnny-Z/Anima-Light-Lavender`（Cosmos-Predict2 2B DiT + Qwen3-0.6B + Qwen-Image VAE，单文件 checkpoint，`anima` loader） | 1024（768 / 1024 / 1152） | 25 步 / 4 | 43.5s / 80.64s | 8470 MB | 5.25 GB | 1 | usable | 支持（默认隐藏） |

> **负向词列**：「支持」表示默认配置下「排除项」可见；「支持（默认隐藏）」表示模型有负向词能力，但默认 CFG（0 或等于推荐值）
> 与推荐词条件下不展示，用户抬高 CFG 后出现；「不支持」表示管线 `__call__` 没有 `negative_prompt` 参数（`flux2`），传了也会被丢弃。

> **双卡说明**：`flux2-klein-4b` 的 pipeline 使用 `deviceMap: "balanced"`，Kernel 申请 2×T4 时按 `gpus: 2` 下发；
> 其余预设单卡即可。
>
> **首张生成延迟说明**：远端服务支持在 Kernel 启动时预载模型（`preload`）；但首次推理仍需建立 CUDA Context
> 与内存池，耗时高于 `steadySeconds`，从第二张开始进入稳定速度。

**切模型缓存清理（20GB 磁盘）**：Kaggle 免费容器磁盘约 20 GiB，权重通过 HuggingFace 缓存目录落盘，不会随切模型
自动释放。远端在加载新模型前按以下顺序处理，避免连续切换大模型时爆盘：

1. `release_pipeline()` 释放旧 pipeline，并 `gc.collect()` + `torch.cuda.empty_cache()`；
2. 按目标 pipeline 的全部依赖仓库（`base` / `vae` / `text_encoder` / `tokenizer` / `lora` / `refiner` 等）
   加 `local_models` 预挂载仓库构建不可删除的 keep_set；
3. 磁盘余量按 `hf_hub_cache_dir()` 所在盘测量（不是只看 `/kaggle/working`）；
4. 不足时把缓存目录下 `models--*` 按最近修改时间从旧到新逐出（跳过 keep_set 与预挂载目录），
   每次删除后重新测量，空间足够即停；日志逐条记录 `[cache] evicted <repo> freed=<X>GiB`；
5. 清完仍不足则抛 `load_failed`，文案写明「磁盘空间不足：需 X GiB / 可用 Y GiB」。

排障与真机验证方法见 [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md) 的「已知良好版本参考（LKGR）」章节。

> **实测环境说明（2026-11-13，2×Tesla T4）**：当前 Kaggle 镜像的 HF 缓存挂载在根卷 `/`
> （`[cache]` 探针实测约 966.6 GiB 可用），不在约 19.5 GiB 的 `/kaggle/working` 上；同一会话内
> 连续切换三种架构模型（合计约 27 GB 权重）未触发逐出、磁盘未爆。逐出逻辑是**小容量镜像 /
> 未来镜像变更时的兜底**，判断依据始终是缓存目录自己所在盘的余量，而不是写死 `/kaggle/working`。

---

## 5. 工作台交互与界面规范 (Studio UI Specification)

### 5.1 术语规范（去 AI 自嗨词汇）

界面与交互文案统一采用直观、平实的技术词汇，严禁生造花哨概念：

| 模块 / 概念 | 废弃旧词（AI 味 / 过于花哨） | 标准新词（平实、专业、直接） | 适用场景说明 |
| :--- | :--- | :--- | :--- |
| **主画面预览** | 焦点舞台 (`Focus Stage`) | **画面预览** (`Preview Stage`) | 用户审视大图的视觉主区域 |
| **最近生成栏** | 胶卷 / 胶卷坞 (`Filmstrip`) | **最近生成** (`Recent`) | 底部展示最近批次缩略图 |
| **顶部视图标签** | 工坊 (`Studio`) | **创作** (`Generate`) | 顶栏主创作工作区入口 |
| **历史产物视图** | 资产画廊 (`Asset Gallery`) | **作品画廊** (`Gallery`) | 本地历史生成资产管理 |
| **随机数生成** | 换种子抽卡 (`Reroll`) | **生成变体** (`New Variant`) | 换随机 seed 生成新图 |
| **参数复用** | 以此图微调 (`Iterate`) | **带回参数** (`Recall`) | 将历史图片的完整参数回填表单 |
| **出图模型** | 风格胶囊 (`Capsule`) / 风格预设 (`Style`) | **模型预设** (`Model preset`) | 顶栏模型选择卡里的出图模型及其推荐参数；画风由提示词内容与模型本身表达，0.10.0 起不再有静态风格选择器 |
| **算力状态** | 算力胶囊 (`Compute Pill`) | **GPU 状态** (`GPU Status`) | 顶栏远端算力状态指示条 |
| **额度展示** | 免费额度 (`Free Quota`) | **Kaggle 剩余算力** (`Kaggle Quota`) | 明确指出算力来源与属性 |

### 5.2 布局结构规范

工作台采用桌面优先的**单轨创作面板 + 居中画面自适应预览**布局：
1. **单轨面板 (320px 恒定)**：固定在左侧，自上而下为：提示词（输入框 / 英译与润色 / 英文软提示；灵感示例仅在提示词为空时出现，润色建议可收起）；参考图槽位（仅已有参考图时，含重绘强度）；画面设置（有参考图时只说明「出图尺寸跟随参考图」；文生图时是画幅比例 → 分辨率档位（长边）→「自定义宽高」折叠）；高级设置（默认折叠：可用时的排除项 + 步数 / 引导强度 / 随机种子，折叠态标题右侧显示读数摘要）；页脚（生成张数 1~4 → 立即生成 → 规格摘要）。
2. **顶部生图流水线 (约 40px 高)**：顶栏下方一条节点条，只在有等待时出现；等待超过 1.5 秒淡入（高度与透明度约 200ms 过渡）。左侧固定五节点「推送内核 → Kaggle 排队 → 建立隧道 → 准备模型 → 生成」，右侧「另有 K 个排队 · 已等待 mm:ss」。节点映射、生命周期与异常态见 §5.13。
3. **画面预览区 (自适应填充)**：大图按比例 contain 居中渲染，图下配操作胶囊（带回参数、生成变体、复制绝对路径、在文件夹中打开）。
4. **最近生成栏 (底部常驻)**：横向滚动展示待执行任务与最近批次缩略图（62×62、12px 圆角），支持快速点选切图。队列串行执行，但待执行任务可能不止一个：每个任务各占一张卡，按真实执行顺序从左到右排列——进行中的卡带一份显影扫描光与已用时间，排队中的卡只写位次与已排队时长。
5. **画廊卡片墙 (独立全宽视图)**：5 列自然高度卡片墙，不裁切图片，按时间线分段，支持搜索、模型筛选、批量管理与单张删除（卡片悬停「删除」→「确认删除」两步，删除失败保留确认态可重试）。

### 5.3 悬浮提示 (Tooltip) 部署明细

主界面保持极简，运作原理、生效约束与警示一律收敛于悬浮提示：

| 字段 / 区域 | 界面展示标签 | 悬浮图标 | 悬浮提示完整内容 (Tooltip Content) |
| :--- | :--- | :---: | :--- |
| **排除项** | 排除项 | `(ℹ)` | 画面中不希望出现的元素。仅在所选模型支持负向词且引导强度 (CFG) > 0 时可用；默认 4 步极速模型的 CFG 为 0，不适用排除项。 |
| **采样步数** | 采样步数 | `(ℹ)` | 模型迭代去噪的步数。SDXL Lightning 推荐 4~8 步，SDXL Base 推荐 25~30 步。 |
| **引导强度** | 引导强度 (CFG) | `(ℹ)` | 数值越高越贴合提示词，过高可能产生色彩失真。默认推荐 1.5~7.0。 |
| **Kaggle 账号** | 账号 | `(!)` | Kaggle 账号必须完成手机号绑定。未绑定的账号会被平台静默降级为 CPU，无法出图。 |
| **云端状态** | 云端就绪 / 正在准备模型 / 正在排队等 GPU | `(ℹ)` | 状态胶囊与生图流水线共用一套阶段文案：推送内核 → Kaggle 排队 → 建立隧道 → 准备模型 → 生成 → 出图完成；多数会话几十秒内启动，超过 3 分钟提示「排队比平时久」，超过 10 分钟给「换新实例重排」横幅，45 分钟硬超时（阈值是经验值，非平台保证）。申请 GPU 阶段（推送 / 排队）实时显示已等待时长；连接与准备模型阶段不显示计时（重连会沿用旧的会话开始时间，读数会虚高）。 |
| **空闲休眠** | 闲置休眠阈值 | `(ℹ)` | 云端实例默认闲置 30 分钟自动关机，以节省你的每周 30 小时免费 GPU 额度。 |
| **提示词输入** | 提示词 | `(ℹ)` | 请尽量用英文：九个预设都按英文提示词训练，中文提示词容易偏离预期。输入含中文时会给一条软提示（不拦截生成）。建议包含主体、光影、构图与画风。 |

### 5.4 启发式灵感与模块化分层润色

1. **灵感示例**：仅在提示词为空时显示 5 个预置启发式场景卡（科幻街景、人像摄影、东方意境、3D 萌系、微距自然），点击直接填入；提示词非空时整块隐藏，不再长期占据首屏高度。
2. **结构化维度润色**：调用「润色」时按光影 / 材质 / 构图 / 氛围四个维度返回可点选追加的英文短语，界面显示对应语言的短标签；点击追加到提示词末尾、再次点击撤销，不强制替换原文本。润色区头部提供「收起 / 展开」（默认展开）；模型不可用时回退为同结构的通用建议并明确标注。
3. **模型配方对齐**：润色提示词按当前模型资产的书写配方、质量词前缀、速度档位与负向词能力生成，并要求避开原文已覆盖的维度；不再维护独立的硬编码模型名单。

### 5.5 第二批交互补充（取消 / 分页 / 英译 / 尺寸 / 日志诊断）

1. **任务取消**：最近生成栏的每张暗房卡（`queued` / `waiting-session` / `running`）带「取消」按钮；取消请求发出后按钮显示「正在停止…」并禁用，避免重复提交。`running` 任务为合作式停止，文案不得写成「已取消」直到任务真正进入 `cancelled` 终态。
2. **历史分页**：画廊底部在 `hasMore=true` 时显示「加载更多」（一次性追加下一页并去重），加载完显示「已加载全部作品」；加载失败保留已加载内容，不清空列表。
3. **一键转英文**：提示词输入框下方提供「转为英文」次级动作（与「润色」并列，不抢占底部生成按钮的实心样式）。只有服务端 `source="model"` 且返回非空译文时才替换表单内容；`source="local"` 必须提示「模型不可用，未能翻译」，不得把原文当作译文。
4. **画面尺寸**：「画面设置」在文生图时按「画幅比例 → 分辨率档位（长边）→ 自定义宽高」组织（0.10.0 起，详见 §5.11）；有参考图时只说明出图尺寸跟随参考图。比例高亮按约分后的长宽比匹配，自定义宽高只改对应一边、宽高互不联动。
5. **日志与诊断**：运行日志抽屉缺省展示远端日志，可手动切换到 Host 日志；远端日志为空且 Host 有内容时自动兜底并给出「已切换到 Host 本地日志」的来源说明。会话 / 网络 / 生成 / 通用 / 授权五类指引卡提供「查看日志」与「复制诊断信息」两个次级动作（普通 `ofs-chip`，不占用主操作的实心样式），复制的诊断文本包含脱敏环境指纹与阶段耗时，不含 token、代理 URL、绝对路径与提示词正文。

### 5.6 第三批交互补充（运行设置 / 新手卡点 / 空闲倒计时）

1. **运行设置入口**：顶栏「GPU 状态」弹层底部与日志入口旁各有一个「运行设置」按钮，打开右侧抽屉（与运行日志抽屉同一套焦点陷阱 / `Esc` 关闭 / 关闭归还焦点行为）。抽屉分三段：常规运行（空闲自动关机快捷档位 15/30/60/120 分钟 + 自定义、GPU 加速器）、模型下载与限流防护（HuggingFace Token，已配置时提示「留空保持不变」并提供「清除 Token」）、高级（默认折叠：预挂载 Kaggle Dataset、本地模型目录映射、pip 依赖约束）。高级项支持多行编辑与行级错误提示，非法行禁止保存并标出行号。
2. **设置生效提示**：当前云端实例运行中时，抽屉顶部展示温和提示「当前云端实例已运行，修改将在下次唤醒时生效」，不阻断编辑与保存。
3. **空闲倒计时**：顶栏 GPU 状态弹层在会话就绪时展示「已空闲 X 分钟 / 满 Y 分钟自动关机」，数据来自会话快照的 `idleSeconds` 与 `idleTimeoutSec`；远端未上报时不显示该行（不展示 0 或猜测值）。
4. **新手卡点加固**：
   - `cli_missing` 卡除「复制安装命令」外，明确提示 Windows 用户：安装后若仍提示找不到命令，请确认 Python Scripts 目录已加入系统 PATH 并重启 DSH Desktop。
   - `auth_required` 卡明确 `kaggle auth login` 会把 OAuth 凭据写入 `%USERPROFILE%\.kaggle\credentials.json`
     （含 `refresh_token`，过期可自动续期），同时说明网页端生成的 `%USERPROFILE%\.kaggle\access_token`
     与旧版 `%USERPROFILE%\.kaggle\kaggle.json` 仍然兼容，并提供打开 Kaggle 账户设置获取 API Token 的按钮。
   - `gpu_unavailable` 使用独立卡片（不复用「生成失败，重试一次」），主操作是打开 Kaggle 账户设置完成手机号验证，次级可重新唤醒云端。

### 5.7 第四批交互补充（确认卡行内微调 / 折叠记忆 / 凭据指引）

1. **意图确认卡行内微调**：对话模式生成的确认卡上，英文提示词与排除项都是可直接编辑的文本域（分别受
   `LIMITS.prompt.maxChars` / `LIMITS.negativePrompt.maxChars` 限制）；改完直接点「按此生成」，按卡片当前
   内容提交（不再合并任何风格后缀；负向词是否提交由当前模型 / CFG 是否真的可用决定），不必为改几个词重新发起对话。
   提示词被清空时「按此生成」禁用；卡片上的排除项清空后提交即真的不带负向词。0.10.0 起生成张数也可在卡上直接调整（见 §5.11）。
2. **高级设置折叠记忆**：表单「高级设置」折叠区默认收起，展开/收起状态通过 `/imagen-api/ui-state`
   持久化（见 §2.5），下次打开工作台沿用；读取失败静默回落默认收起，不弹错误提示。界面状态不进
   `/state` 快照，也不参与出图参数。
3. **凭据指引三口径**：`auth_required` 卡与 `/probe` 的说明使用同一口径——`kaggle auth login` 写入
   OAuth 凭据（`credentials.json`，含 `refresh_token` 自动续期）；网页端生成的 API Token 可保存为
   `access_token`；旧版 CLI 的 `kaggle.json` 仍兼容。三个路径都由客户端常量提供，文案里不写死反斜杠。

### 5.8 第五批交互补充（直连开关 / 内置 OAuth 登录）

1. **Kaggle 访问方式开关**：运行设置抽屉「高级」区「Kaggle 访问方式」：`direct`（直连 Kaggle + 内置 OAuth，
   **自本版起为默认**）与 `cli`（调用本机 kaggle CLI，兼容退路）。直连模式提示无需安装 kaggle CLI、登录凭据
   写入 `%USERPROFILE%\.kaggle\credentials.json`；改动在下次唤醒 / 探测时生效，可随时切回 CLI。
   设置文件带 `schema` 版本：v1 里存的 `cli` 视为当时的默认值，升级时丢弃一次；之后手动切回 `cli` 会以
   `schema=2` 落盘并被保留。
2. **内置 OAuth 登录**：直连模式下 `cli_missing` / `auth_required` 指引卡主操作改为「在浏览器中登录 Kaggle」：
   点击后显示「正在等待浏览器完成授权…」与「取消」；无法打开浏览器时切换为 manual 模式，展示可复制的
   授权链接与授权码输入框。成功后轻提示并自动重跑环境探测；失败给出可读原因可重试；整段流程受
   `KAGGLE_LOGIN.timeoutMs` 约束。
3. **直连模式展示**：顶栏/探测行的「CLI」字样改按当前传输方式显示「直连」；直连模式下不再出现
   `cli_missing`（提示安装 CLI）的指引卡，登录问题统一走 `auth_required` + 登录主操作。
4. **兼容与降级**：旧宿主没有 `kaggleTransport` / 登录接口时按 CLI 模式渲染，不弹错误；直连请求失败
   （401 / 网络）按鉴权失败与网络错误分别归类，token 不出现在界面错误详情与诊断文本里。

### 5.9 第六批交互补充（图生图 / 垫图重绘）

1. **参考图槽位**：文生图界面与改造前完全一致——当前模型支持垫图（`supportsImg2Img`）且还没有参考图时，
   左栏出现空槽位（普通模型一行轻量入口；专用局部重绘模型展示虚线框与「先选参考图 → 再涂抹蒙版」两步
   说明，二者都带「从作品画廊选择」按钮）；不支持垫图的模型整块隐藏。有参考图时槽位显示缩略图 + 文件名
   + 「移除」，下方是「重绘强度」滑块（契约 `LIMITS.strength`，0.2~0.9、步长 0.05，默认 0.6；
   带蒙版时上限放宽到 `inpaintMax` 1.0）；支持局部重绘的模型再补蒙版覆盖率读数与「继续涂抹 / 清空蒙版」。
   见 §5.16。
2. **能力边界**：首期只有 SDXL 家族（模型资产 `supportsImg2Img = true`）支持垫图；当前预设不支持时，
   参考图槽位与强度滑块整块置灰并提示「当前模型不支持垫图重绘」，点生成会被**拦下**（提示先切换模型或
   移除参考图，不发请求、也不静默丢弃参考图）。`flux2` / `anima` 预设保持仅文生图。
3. **画廊一键带入**：作品画廊卡片与大图预览新增「以此图重绘」：把该作品设为参考图、切回「创作」视图；
   若当前预设不支持垫图，自动切到支持的预设（优先 `sdxl-lightning`）并轻提示预设名。「带回参数 /
   生成变体」行为不变。
4. **连续迭代**：提交成功后参考图保留在表单里，便于对同一张图连续重绘；用户点「移除」才回到纯文生图。
   参考图与强度随任务参数记录进产物 `meta.json`（`sourceImage` / `strength`），历史回看可知道出处。

### 5.10 第七批交互补充（画面尺寸收口）

> 0.10.0 起「画面设置」的结构再次调整（画幅比例 → 分辨率档位 → 自定义宽高折叠，见 §5.11），
> 本节保留输入与校验层面的规则，这些规则仍然生效。

1. **宽高编辑草稿**：宽 / 高输入框的编辑过程只维护本地草稿，失焦或按 `Enter` 才归一化写回表单；清空或纯空白
   失焦时恢复修改前的合法值（例如 `800`），不会因 `Number('') === 0` 静默跳成契约下限 `256`。输入有效数字
   但越界或不是 `8` 的整数倍时，仍按契约边界钳制并对齐 `LIMITS.width.step`。
2. **比例高亮语义**：比例高亮按约分后的长宽比匹配（`ratioIdOf()`），不再要求像素精确相等——在 `1:1` 比例下点档位
   `768` / `1152` 同样高亮 `1:1`，`800 × 600` 高亮 `4:3`；比例高亮始终是当前尺寸的匹配反馈。
3. **文案与边界单一来源**：自定义宽高的边界说明从 `LIMITS.width` 注入（`formatText`），不写死数字；窄屏下
   「宽 × 高」保持单行不溢出。
4. **尺寸控件收口**：宽高输入与档位选择都在「画面设置」内，不再出现在「高级设置」；「高级设置」只保留采样参数
   （步数 / 引导强度 / 随机种子）与当前模型可用时的排除项。

### 5.11 第八批交互补充（参数面板减法与助手升级，0.10.0）

**参数面板**

1. **删除静态风格预设**：移除 5 个风格试印条、`StylePlate`、`toggleStyle` 与提交时的风格后缀 / 风格负向层拼接；
   风格由提示词内容与模型本身表达。
2. **排除项按真实能力显隐**：界面与提交共用 `shared/models-guide.js` 的 `negativePromptActive(preset, cfg)`。
   默认 `CFG=0` 的极速模型与不支持负向词的 `flux2-klein-4b` 默认不显示排除项；抬高 CFG 后出现，回到默认后再隐藏。
   隐藏时不渲染、不提交，避免「填了但后端忽略」；首次把 CFG 从不可用抬到可用且模型推荐词非空时，自动补上推荐负向词。
3. **画面设置与参考图互斥**：有参考图时不再渲染比例 / 档位 / 宽高控件，只在标题右侧显示尺寸读数，并在正文说明
   「出图尺寸跟随参考图 {size}」；没有宽高信息时显示「出图尺寸跟随参考图」。文生图时结构为：5 个画幅比例 →
   分辨率档位（长边，取当前预设 `sizeOptions`，短边按比例换算并对齐 8px）→「自定义宽高」折叠（草稿 + 失焦 / 回车提交）。
4. **生成张数提权**：生成张数 1~4 改为页脚左侧带「张数」标签的分段选择器；立即生成按钮下方常驻规格摘要
   「`1024 × 1024 · 1:1 · 2 张`」，有参考图时补「参考图」，提示词为空时显示「先写画面描述」。
5. **高级设置自解释**：折叠态标题右侧显示读数摘要（如「4 步 · CFG 0 · 随机种子」）；随机种子输入框旁提供
   「恢复随机」；排除项行仅在可用时出现在高级设置内。
6. **灵感与润色**：灵感示例仅在提示词为空时出现；润色建议可收起 / 展开（默认展开），追加与撤销行为不变。

**创作助手**

7. **模型知识单一来源**：新增 `shared/models-guide.js`，把 `models/*.json` 的模型事实整理成提示词配方、负向词能力判断
   与模型用法摘要；`lib/intent.js`、`lib/enhance.js`、`lib/tools.js` 与客户端共用，不再各自手写模型名单。
8. **三段式提示词**：system prompt 按「身份与使命 → 模型手册（当前模型 + 全库概要）→ 组织与沟通策略（软性引导）」组织；
   负向词写法、模型建议与澄清都由软性策略表达，不做硬分支规则。
9. **意图确认卡**：结构为标题「生成确认」→ 中文摘要（与提示词不同时才显示）→ 编辑提示 → 英文提示词文本域 → 比例 →
   模型建议弱提示（「更合适的模型：{model}（{reason}）」）→ 排除项（仅 `negativePromptActive` 为 true 时）→
   生成张数分段（默认 1 张）→「沿用上张构图（锁定种子）」（默认关闭，没有可复用的上张种子时禁用）→
   「按此生成」主按钮 + 「带入参数面板」次级动作。提示词 / 排除项 / 张数可直接编辑，提示词清空时按钮禁用。
10. **带入参数面板**：把确认卡的提示词、比例对应宽高、生成张数与可用时的排除项写进表单，切到「参数表单」并轻提示；
    提示词为空时不做改动、不切换。
11. **通用澄清卡**：`clarify` 非空时显示「想先确认一下」+ 问题 + 2~4 个选项 +「先按当前设置」。点选项 = 追加一条
    用户消息并以该卡草稿提示词走多轮重新解析（旧卡被新结果替换）；点「先按当前设置」= 只清掉澄清、还原成确认卡，
    不自动提交。
12. **多轮上下文与种子**：解析请求携带当前 `cfg` 与最近对话 `history`（只取用户原话与意图卡上的英文提示词，
    任务 / 错误气泡不进上下文）；Host 裁剪后作为多轮消息送入模型，`history` 非空时优先于 `previousPrompt`。
    确认卡默认随机种子，只有显式勾选「沿用上张构图」且表单未手填种子时才沿用上一张，避免跨主题对话构图僵化。
13. **空态示例**：点击灵感示例只填入对话草稿，不改动参数表单。

### 5.12 第九批交互补充（排队分级与换新实例重排，0.12.0）

Kaggle 免费 GPU 的排队时长不可控：本机历史日志里 6 次正常会话从推送完成到隧道会合约 14–22 秒（样本仅 6 次、
集中在一个账号的几天内，只用于挑阈值，不代表平台保证），但偶发队列条目卡住（45 分钟仍 `QUEUED`），重新推送
一个 Kernel 往往几十秒就能拿到 GPU（同样受平台负载影响，不是保证）。界面据此把「继续等待」与「重排」拆成清晰的三层，不再让用户干等到
45 分钟才发现可能卡住。阈值只影响提示时机，重排永远是用户主动选择，不会自动执行。

1. **排队比平时久（3 分钟软提示）**：流水线排队节点转琥珀并标「比平时久」（悬停说明仍是「排队比平时久（多数会话几十秒内就能启动）」），
   胶囊标签与色调不变，不弹卡、不打断操作。阈值取契约 `TIMEOUTS.queueSlowMs`（默认 3 分钟，插件配置
   `queueSlowMinutes` 可覆盖）。
2. **排队卡住横幅（10 分钟档）**：顶部出现非错误态横幅「排队超过 {N} 分钟还没拿到 GPU」，说明里给出判断依据，
   动作只有两个：主操作「换新实例重排」（`forceNew + replace`：Host 删除旧 Kernel 后推新 Kernel）与
   「继续等待」（只收起横幅，不改变会话）。同一轮排队只弹一次，重排后换了 `startedAt` 才会再次触发。
   阈值取 `TIMEOUTS.queueStalledMs`（默认 10 分钟，配置 `queueStalledMinutes`）。
3. **45 分钟硬超时卡收敛**：`queue_timeout` 错误卡的「继续等待当前队列」「打开 Kaggle Kernel」两个动作删除，
   只保留主操作「换新实例重排」、次级「查看日志」与关闭；文案改为确定表述，不再出现「该 Kernel 可能仍在
   队列中」这类不确定提示，也不再要求用户去 Kaggle 网页手动停止旧任务（Host 会自动清理）。
4. **换新实例重排不打断排队任务**：重排只替换远端会话，本地 `waiting-session` / `queued` 任务继续等待新会话，
   不会被标记为 `stopped`；新旧会话切换期间进度条按新 `startedAt` 重新计时。
5. **旧 Kernel 自动清理**：排队超时、隧道握手超时、排队中主动关机与重排都会 best-effort 删除旧 Kernel；
   远端 daemon 的 `claim_timeout_sec`（默认 600 秒）在删除失败时兜底，避免孤儿 Kernel 空转到 30 分钟才释放配额。

### 5.13 生图流水线节点展示

顶栏下方的生图流水线只在有等待时出现，用固定五节点说明当前走到哪一步；不显示百分比，也不显示每阶段耗时。

**节点与数据映射**

| 节点 | 数据来源 |
| :--- | :--- |
| 推送内核 | `session.phase = push` |
| Kaggle 排队 | `session.phase = queue` |
| 建立隧道 | `session.phase = tunnel` |
| 准备模型 | `session.phase = warm` |
| 生成 | `job.stageCode = running`，节点文字带「第 N/M 张」 |

- 会话已就绪时前四节点折叠成一个起点「云端已就绪」，流水线只保留「云端已就绪 → 生成」。
- 只映射真实可观测的阶段；宿主没有每阶段时间戳与采样步进，界面不显示百分比、不显示每阶段耗时。

1. **生命周期**：有等待时出现，提供「另有 K 个排队」与总已等待；计时只在申请 GPU 阶段（推送 / 排队）从会话开始时刻算，有任务时从任务提交时刻算；连接与准备模型阶段没有可信起点，不显示计时（重连沿用旧会话开始时间，读数会虚高）。完成时最后节点点亮「出图完成」，停约 1.2 秒后整条淡出（宿主 2 秒轮询，实际可见约 1.2~3.2 秒）；取消直接淡出；失败停在失败节点并保持可见，直到开始下一次生成 / 关闭云端 / 收起指引提示。手动关闭云端只显示一行「正在关闭云端…」，不画节点。
2. **异常与升级**：失败节点红色；排队卡住时排队节点转琥珀并标「比平时久」。10 分钟排队卡与异常指引卡仍作为第二行横幅出现，动作留在横幅上。
3. **横幅配色**：横幅与流水线、创作面板使用同一套中性卡片材质；语义色只出现在左缘 2px 窄条（等待 = 琥珀、错误 = 红）与流水线小圆点上，不再使用整块琥珀 / 红底；主操作用墨黑实心胶囊。
4. **窄屏（≤820px）**：只保留当前节点文字，其余节点收成圆点；队列胶囊信息并入这一行。
5. **无障碍**：阶段切换时用 `role="status"` + `aria-live="polite"` 播报一次；每秒走字的计时与舞台胶囊不重复播报。

### 5.14 第十批交互补充（工作台双向同步与创作流转，0.12.0）

> 设计依据：[STUDIO_SYNC_AND_ITERATION_DESIGN.md](STUDIO_SYNC_AND_ITERATION_DESIGN.md)。

1. **「新建对话」取代「清空对话」**：助手面板底部按钮语义是「开一个新上下文」，不是删记录。点击后清空线程与输入草稿；正在解析意图时点击，旧请求返回会被线程代次守卫整条丢弃，不会写进新上下文。
2. **表单提交同步进助手但不出现在模型上下文里**：从参数面板点生成后，助手线程出现一张参数同步卡（模型、比例与像素、张数、是否含参考图、种子策略，用胶囊呈现），与普通用户气泡在结构上区分；点击生成变体 / 重试来源的卡片各有标题。这类记录带 `kind='form'`，`intentHistory()` 会跳过，**不进入**发给意图模型的多轮上下文——在表单里顺手跑一张别的题材不会带偏后续对话。
3. **胶卷点击自动回填参数（仅创作视图）**：底部胶卷缩略图点击时，除了切换画面预览，还会把该作品参数回填进左侧表单（提示词、排除项、宽高、步数、CFG、预设，并保留原图的 Seed；作品没有有效 Seed 时恢复随机），同时清掉上一轮残留的参考图。画廊（Gallery）保持纯浏览心智，不改写表单。
4. **草稿保护**：表单与「干净基准快照」逐字段比较判断是否有未提交的手动修改（改回原样会重新变干净）。有草稿时点胶卷仍然切预览，但保留左侧草稿并提示「已保留当前草稿」；要从作品参数覆盖草稿，仍用大图上的「带回参数」。
5. **「版本微调」与「新建创作」边界**：回填后参数面板顶部显示「正在微调：<作品提示词>」并常驻「新建创作」按钮。新建创作只清掉绑定到上一张作品的状态（提示词、参考图、固定 Seed、微调来源与脏状态），排除项回到当前 CFG 下的预设推荐值；当前模型预设与画幅尺寸保留，避免每次重置都被打回默认。
6. **测试**：纯逻辑 `src/logic/form.js`（`formSnapshotOf` / `isFormDirty` / `newCreationPatch`）与 `src/logic/generate.js` 的 `formSummaryOf`、`iteratePatch` 增强；`check-client-logic` 71 项、`check-client-render` 86 项覆盖代次守卫、上下文隔离、草稿保护与新建创作边界。

### 5.15 第十一批交互补充（画布局部重绘 Inpaint，0.12.0）

> 设计依据：[AGENT_BATCH_AND_INPAINT_PLAN.md](AGENT_BATCH_AND_INPAINT_PLAN.md) §三。

1. **入口与能力门控**：用「以此图重绘」挂上参考图后，画面预览出现「局部涂抹」；只有当前预设
   `supportsInpaint = true`（首期 SDXL 家族）才渲染入口，不支持的模型隐藏入口并说明原因。切到不支持
   的模型时**保留已画的蒙版**并提示会保留，切回支持的模型可继续用，不静默丢弃。
2. **涂抹层**：透明 canvas 蒙版叠在参考图上（screen 混合显示白色笔迹），画布按参考图比例缩放（长边
   1024，避免几 MB 的蒙版）；工具栏提供画笔大小（8~96，步长 4）、橡皮擦、清空蒙版、反选区域与完成。
   指针 / 触控用 Pointer Events + pointer capture，键盘用方向键移动、Space/Enter 落笔、Esc 完成，工具
   热区 ≥44px。
3. **导出与提交**：每笔结束把画布导出为黑底白字 PNG（`canvas.toDataURL()`），剥掉 data URL 前缀后写入
   表单 `reference.mask = { data, coverage, digest }`；提交体为 `reference.mask`（裸 base64，≤
   `LIMITS.mask.maxBytes`）。未涂抹 / 涂抹面积低于最小有效比例（0.05%）时**不出现** `mask` 字段，请求体
   与纯图生图逐字一致。
4. **清理语义**：换参考图、移除参考图、胶卷回填、新建创作都会清掉蒙版（`reference` 整块替换或置空）；
   生成变体 / 重试沿用当前参考图与蒙版；蒙版指纹纳入表单脏判定（`formSnapshotOf` 用 FNV-1a 指纹而不是
   把几 MB base64 拼进快照），画过一笔即视为有未提交修改，胶卷点击走草稿保护。
5. **降级**：当前数据里 `supportsInpaint = false` 的模型同时 `supportsImg2Img = false`，会被既有的
   「参考图与预设能力不匹配」拦下；若将来出现「支持垫图但不支持局部重绘」的模型，`buildBody` 不提交
   `mask`，界面提示会保留蒙版。
6. **测试**：`src/logic/mask.js` 纯逻辑（画笔 / 状态归一、画布比例、导出前置校验、指纹）与 `src/logic/preset.js`
   的 `supportsInpaint` 进 `check-client-logic`；`check-client-render` 覆盖入口按能力显隐、工具栏键盘 / 触控
   结构、导出后按 `reference.mask` 提交与清理入口。真机显存与画质验收见 ROADMAP 第十条。
7. **专用局部重绘预设（`sdxl-inpaint`）**：9 通道 inpaint 专用权重，加载后即为局部重绘管线
   （不走 `from_pipe`）。它是 `inpaintOnly` 预设：只能带参考图 + 蒙版使用，缺任一项时生成按钮旁给出
   说明并拦下提交；参考图兜底预设与「以此图重绘」的自动切换会跳过它。真机验收（2026-11-16）
   结论：整图蒙版 + 提示词时文本遵循完整（如「蓝色大象」可完整生成）；**小蒙版时强度需要接近上限
   才会明显替换**（0.8 下原图上下文压过提示词），因此涂抹模式对这类预设的默认强度取 0.9
   （0.12.0 起带蒙版的上限放宽到 1.0，见 §2.2 与 §5.16）。
8. **重绘强度默认值与量化**：打开涂抹模式时进入「自动档」——强度未被用户手调过（仍是契约默认值
   `LIMITS.strength.default` 0.6，或上一轮仍是自动档）时，按当前预设抬到推荐档
   （通用模型 `MASK_STRENGTH_DEFAULT` 0.8 / `inpaintOnly` 预设 `MASK_STRENGTH_NATIVE` 0.9）；
   用户拖动滑块即退出自动档，之后不再覆盖；自动档下切换预设会跟随新预设的推荐档。
   依据是 2026-11-16 真机验收：4 步 SDXL Lightning 下 `strength=0.6` 只跑 2 步、蒙版区变化
   约 3.8/255（偏弱）；`≥0.76` 跑 3 步、约 25/255（明显重写）。注意 diffusers 的
   `int(num_inference_steps × strength)` 会量化有效步数：4 步模型上 0.76~1.0 都落到同一档（0.8 与 0.9
   输出逐字节相同），所以「强度再往上调」在这类模型上没有额外效果。大面积蒙版在高强度下边界可能有可见
   硬接缝（底座走 4 通道「每步混回未涂抹区」分支的固有表现），实际笔刷小区域更自然。
9. **测试口径**：`src/logic/mask.js` 的强度推荐档 / 自动档判定与 `src/logic/generate.js` 的 mask-aware
   强度归一由 `check-client-logic` 覆盖；`check-client-render` 覆盖滑块上限与提交体。

### 5.16 第十二批交互补充（状态流转与局部重绘可用性修复，0.12.0）

> 规划与问题清单见 [STUDIO_STATE_FLOW_AND_INPAINT_FIX_PLAN.md](STUDIO_STATE_FLOW_AND_INPAINT_FIX_PLAN.md)，
> 本节只记录已生效的交互规则。

1. **胶片条保留参考图（决策 1）**：创作区胶卷点击的优先级固定为「切换预览 → 表单有参考图（含蒙版）则
   不回填并提示 → 有未提交草稿则保留草稿并提示 → 都没有才回填参数」。涂好的蒙版不会被隐式回填清掉；
   要换掉参考图请先点「移除」或使用大图上的「带回参数」。
2. **生成来源策略（决策 2）**：所有生成入口按来源统一决定参考图，调用方不得各自拼装——
   `form`（面板生成）沿用表单参考图与蒙版；`assistant`（确认卡）与 `variant`（生成变体）**强制纯文生图**
   （显式 `reference: null`），不静默带旧参考图；`retry` 从失败任务恢复参考图（见下）。
   当前预设为 `inpaintOnly` 时，助手 / 变体仅本次请求切到参考图兜底预设并轻提示，左栏表单不变。
3. **失败重试恢复参考图（决策 3）**：重试按失败任务参数恢复 `path` + `strength`；任务带蒙版且上一次提交体
   与失败任务同源时一并恢复完整蒙版，可直接重试；蒙版已不可恢复（跨刷新、提交体被覆盖）时不自动提交，
   改为把失败任务的参数**整体**填回表单：预设（原预设仍有垫图能力才用，否则退回兜底预设）、提示词、宽高、
   步数、CFG、张数、排除项与强度，再加上参考图，然后打开涂抹并提示「请重新涂抹后再生成」——重涂后点生成
   即等价重试，不会拿左栏里的旧参数去跑另一个任务。失败任务本来没有参考图时显式纯文生图，
   不会把表单里挂着的参考图串进重试。
4. **首次使用引导（决策 4）**：支持垫图的模型在无参考图时渲染空槽位（见 §5.9.1）；`inpaintOnly` 预设下
   从画廊「以此图重绘」成功后**自动进入涂抹态**（`paintRequest` 计数信号，跨视图挂载也能消费一次），
   通用模型保持手动，不打断纯图生图流程。
5. **连续重绘闭环（决策 5）**：舞台动作坞提供「以此结果继续重绘」：显式点击后把该结果设为新参考图、
   清空蒙版并自动进入涂抹，不自动切换以免打断对比；参考图区显示蒙版覆盖率、「继续涂抹 / 清空蒙版」，
   生成按钮下方标注「本次基于 <文件名> 重绘」。
6. **涂抹中切换作品（问题三.3b）**：涂抹态下点胶卷切换作品会退出涂抹态、预览跟随选中作品，已涂蒙版
   保留在表单里；换参考图 / 移除参考图仍按原语义收起涂抹态。
7. **画布比例与指针映射（问题三.2）**：蒙版编辑器画布宽度同时受容器宽与可用高度约束（与相纸 / 取景框
   一样用容器单位计算），竖图或矮窗口下整体等比缩小而不是被压扁；指针坐标与光标直径按 rect 的宽、高
   分别换算，压扁场景下笔迹不再变成椭圆。
8. **空舞台涂抹入口（问题三.3a）**：舞台没有选中作品、但表单已挂参考图且当前模型支持局部重绘时，
   空舞台同样显示涂抹入口与编辑器，不必先回画廊选图。
9. **强度档位联动（问题三.3c）**：见 §5.15.8；从通用模型（自动档 0.8）切到 `inpaintOnly` 预设后
   自动档跟随到 0.9，用户手调过的强度不受影响。
10. **契约与远端（决策 4/5/6，见 §2.2）**：带蒙版时 `strength` 上限 1.0；蒙版覆盖率低于 0.05% 的空蒙版
    在执行期、加载模型前以 `invalid_request` 失败（全白允许）；羽化半径按覆盖率分档（2 / 4 / 6~8px）；
    局部重绘显式下传按 8 对齐的参考图宽高，非正方形参考图不再被缺省方形推理后拉回。
11. **测试**：`check-client-logic` 85 项（+8：来源策略、重试恢复全分支、蒙版不可恢复的重试回填、能力预检、
    胶片条保护优先级、强度自动档、mask-aware 钳制、新文案键）；`check-client-render` 99 项（+10：四来源
    请求体、空槽位与画廊入口、蒙版读数与动作、paintRequest 自动涂抹、画布比例、续绘闭环、涂抹中切图、
    强度上限、重试恢复与蒙版丢失分支）；`check-client-locale` zh/en 各 477 键同构；`host-e2e` 50 项（+2）、
    `jobs-wait` 26 项（+1）、`test/remote/run.py` 390 项（+19）、`check-contract` 12 项（+1）。
    真机复验结果见 [`docs/ROADMAP.md`](ROADMAP.md) 第十一条与 [`CHANGELOG.md`](../CHANGELOG.md)。

### 5.17 第十三批交互补充（舞台图片处理工具栏与交互解耦，阶段十二）

> 设计依据：[STAGE_IMAGE_TOOLS_PLAN.md](STAGE_IMAGE_TOOLS_PLAN.md)（方案 B）。

1. **左栏主表单回归纯文生图**：参数面板不再承载参考图、蒙版与重绘强度，任何一次面板生成都是纯文生图
   （请求体不出现 `reference`）；「以此图重绘 / 挂参考图」链路与 `ReferenceSection` 一并删除。
   `inpaintOnly` 预设（如 `sdxl-inpaint`）不再出现在主表单预设选择器中，只在图片工具内部可选；
   旧界面态残留该预设时，面板生成自动切到支持文生图的兜底预设并轻提示，不静默失败。
2. **舞台动作坞**：图片下方的 `.ofs-dock` 分两组——图片处理（`局部涂抹`、`整图重绘`、`高清放大`/`扩图`
   占位）与创作复用（`带回参数`、`再画一张`）。高清放大 / 扩图在 0.13.0 仍为禁用占位（`title` 说明
   规划中），交互框架按 `instant / inline / canvas` 三类形态注册，后续接入只补描述符与远端能力。
   `复制路径` 只保留在图片右上角悬浮按钮里，动作坞不再重复。
3. **一步直达局部涂抹**：在舞台或大图预览点 `局部涂抹` 即以当前作品为底图打开画布，无需先「设为参考图」。
   工具内部自动选模：当前预设支持 Inpaint 时沿用，否则优先 `sdxl-inpaint`、再退支持垫图的兜底预设；
   自动改用只发生在工具内，**不回写左栏**的 `presetId`，并在工具条提示当前使用的模型。工具级预设可在
   支持的 Inpaint 预设间切换。
4. **画布 + 内置轻量提交栏**：画布沿用第十一阶段的蒙版能力（画笔 / 橡皮擦 / 清空 / 反选 / 覆盖率、
   指针与键盘操作、黑底白字 PNG 导出、`LIMITS.mask` 上限与空蒙版拦截）；底部内嵌提交栏提供修改描述、
   重绘强度、模型胶囊与「重绘选中区域」。修改描述默认留空、placeholder 显示原作品提示词，提交时为空则
   回退用原提示词；原作品也没有提示词时拦下并提示。强度按工具默认档（通用底座 0.8 / `inpaintOnly` 0.9）
   自动档与手调退出规则不变，带蒙版上限仍为 `LIMITS.strength.inpaintMax`。
5. **整图重绘轻量条**：`整图重绘` 不切画布，在舞台下方展开一行 Prompt + 强度（0.2~0.9）+「生成」；
   当前预设不支持垫图时，仅本次工具请求自动选用支持垫图的兜底预设，左栏表单不变。
6. **提交与失败恢复**：工具提交与面板生成走同一条队列流水线（`activeJob` / 待执行卡 / 取消语义一致），
   提示词与编辑状态记入工具的待提交草稿；失败时保留底图、提示词、强度与蒙版，动作坞出现「继续编辑」
   可原样恢复，不丢弃已涂内容。切换舞台作品只退出编辑态，草稿按作品路径保留（见 §5.18）。
7. **画廊 / 大图入口**：画廊卡片的「以此图重绘」与大图预览的同一动作改为「选中该作品 + 切回舞台 +
   打开局部涂抹」，不再改写左栏表单；宿主没有任何支持垫图的预设时 toast 说明不可用。
8. **状态隔离**：胶卷点击、对话助手、生成变体与左栏回填只服务文生图表单，不读取也不污染图片工具状态；
   图片工具只以「当前舞台作品」为底图，预览切换不影响已绑定的底图与草稿。
9. **测试**：新增 `test/image-tool.mjs`（19 项纯逻辑：注册表、自动选模与兜底、强度档位、请求体、蒙版门控、
   提示词回退、`inpaintOnly` 拦截、作品键）与 `test/image-tool-render.mjs`（6 项 hook / Stage 渲染）；
   `check-client-render` / `check-client-logic` 的旧参考图 / 涂抹 / 续绘 / 来源策略用例逐条改写为
   「主表单无 reference、图片工具提交体带 reference + mask、底图绑定不随预览切换」等新交互断言；
   文案键随左栏参考图区删除而收敛（阶段十二收口时 zh/en 各 470 键，最终键数见 §5.18）。

### 5.18 第十四批交互补充（显式新建绘图、多作品草稿与树状版本管理，阶段十三）

> 设计依据：[WORKSPACE_DRAFTS_AND_VERSIONING_PLAN.md](WORKSPACE_DRAFTS_AND_VERSIONING_PLAN.md)。

1. **显式新建绘图态**：参数面板「新建创作」改为显式进入新建绘图态——舞台切为模糊动态背景 + 取景框
   （`prefers-reduced-motion` 下退化为静态），底部作品条最左端出现新建草稿卡（画幅比例、预设、
   「未提交」标记）。提交入队后草稿卡位置交接给排队 / 渲染卡，舞台显示本次任务的取景框与进度；
   等待期间点任意作品立即切回浏览态，不打断在途任务。任务完成后自动选中新出的作品。
2. **多作品草稿**：图片工具按作品路径（`workKey`）分别保存未提交的编辑草稿（工具、提示词、强度、
   预设、蒙版与改动项），切换作品再回来可继续编辑，不丢笔迹。草稿只存会话内存、不落盘；含蒙版的草稿
   LRU 上限 8，超出淘汰最久未编辑的草稿。缩略图与版本树节点上有草稿圆点，`title` 列出改动项
   （涂抹区域 / 提示词 / 参数），并支持一键清空该作品草稿。
3. **同批与树状版本**：一次提交产出的 1~4 张图各自是一棵独立版本树的根（`v1`）；对某张图做局部涂抹 /
   整图重绘产出的图作为子节点（`v2`），可继续派生（`v3`…）；同一父节点多次派生按创建顺序用 `v2a` /
   `v2b` 区分。产物 `meta.json` 与新 `/history` 字段记录 `sourceImage` / `rootImage`（§2.2），跨会话
   仍能还原整棵树；父作品被删除时子版本提升为局部根，版本面板不崩。
4. **作品条按根折叠**：作品条为每棵版本树保留一张卡，缩略图取该树最新活跃节点，右侧显示 `⎇ N`
   分支角标（无派生不显示）；避免连改几轮后作品条被 v1/v2/v3 撑满。普通点击仍是切预览 / 回填参数的
   既有语义。
5. **版本派生面板**：鼠标在缩略图停留超过 250ms 或点击分支角标时，在作品条上方弹出稳定的树状面板
   （hover bridge + 延迟收起，点击角标可固定展开，Esc 关闭，键盘可 Tab）；面板按层级展示版本行
   （`vN`、来源类型「涂抹 / 整图 / 文生」、缩略图），叠加草稿圆点与在途幽灵节点（哪个节点正在排队生成
   下一版）。点击任意节点把该版本切到舞台，并可基于它继续「局部涂抹 / 整图重绘」。
6. **跨分页补齐**：版本树的根节点可能不在已加载分页内；打开面板时按需调用 `/history/tree` 拉取整棵树
   （见 §2.2），旧宿主 404 时降级为仅用已加载分页并提示「宿主版本过低，无法展开完整版本树」。
7. **在途任务溯源**：提交时记录来源（新建绘图 / 局部涂抹 / 整图重绘 / 生成变体）与父作品路径，
   排队期间在版本树对应父节点下渲染幽灵节点，出图后自动归位到正确的版本树，即使等待期间用户已切去
   浏览其它作品。
8. **状态边界**：版本树与草稿只影响作品条 / 舞台展示，不改变左栏表单的干净基准与回填语义；删除作品后
   版本链与草稿键同步清理，不残留失效节点。
9. **测试**：`host-e2e` 54 项（版本树路由、rootImage 两级继承、动态上传、历史透传、旧 meta 回溯、tree 空树与
   越界、分页）、`jobs-wait` 31 项（rootImage 落盘与旧链回溯上限）；新增 `test/lineage.mjs` 17 项（索引、版本号、
   面板行、幽灵节点、LRU、草稿摘要）。客户端 `check-client-render` 104 项（含版本条根折叠、面板 hover / 固定 /
   Esc / 点行、按需拉树、旧宿主 404 降级、父删局部根、新建绘图态与完成切回）、`check-client-logic` 82 项、
   `check-client-locale` zh/en 各 495 键同构（相对 0.12.0 累计新增 51 键、删除 33 个死键）。

### 5.19 第十五批交互补充（交互语义对齐、双向助手闭环与本地导入，阶段十五 Phase A）

> 设计依据：[STUDIO_UX_POLISH_AND_MODERN_PIPELINE_PLAN.md](STUDIO_UX_POLISH_AND_MODERN_PIPELINE_PLAN.md) §四 Phase A。

1. **动作语义收敛**：舞台动作坞下线「带回参数」（胶片条点击已自动回填），「生成变体」统一改名
   **「重新生成」**（按当前作品提示词与参数、换随机种子重抽 1 张纯文生图，产生新根 `v1`）。
   画廊卡片动作收敛为「在工作台打开（主点击同义）/ 重绘编辑 / 查看大图 / 收藏 / 删除」，
   不再在画廊原地盲发后台生图请求：所有创作与编辑动作都先切回工作台。
2. **左栏草稿托管**：点击胶片条作品 = 切预览 + 回填该作品原始参数（**不再因未提交修改被拦截**）。
   回填后修改任意表单字段即产生「未提交草稿」：作品条最左端草稿卡实时显示「未提交草稿 · 源自此图」，
   左栏顶部显示「正在新草稿中编辑（源自此图）」与常驻「还原原图」；舞台保持展示来源作品，不闪成空取景框。
   切到其他作品时先把当前编辑托管进草稿卡（已有草稿则覆盖）再回填，并提示「已保留当前草稿」；
   点草稿卡切到新建画布焦点并恢复草稿内容与来源（取景框注明「源自：{prompt}」）；
   「还原原图」恢复来源作品参数、清空草稿并回到该作品；草稿提交成功后清空并沿用「新建绘图」的出图切换，
   「新建创作」清空表单与草稿来源。全新画布上手改的内容仍按「正在配置新画布」展示，不抢占新建态。
3. **助手结果网格**：一次任务 1~4 张结果图在助手完成气泡中以缩略图网格完整展示（单张保持单图观感），
   点击任一图把舞台切到该图并进入**单图聚焦**：对话流替换为聚焦视图（大图 + 参数胶囊 + 快捷动作
   「对比原图 / 继续涂抹 / 重新生成 / 查看大图」），顶部出现「← 返回上一层（{label}）」面包屑；
   返回逐层出栈回到上级结果网格。聚焦与返回只改本地视图栈，不写 `messages`。
4. **舞台工具动作镜像**：在舞台发起「局部涂抹 / 整图重绘」并提交成功后，助手线程追加一条镜像记录
   （底图缩略图 + 动作说明 + 可选重绘强度胶囊）与一条任务反馈气泡；完成后气泡展示新版本图。
   镜像记录、表单同步卡与结果卡都带独立 `kind`，不进入 `intentHistory`，不污染意图模型的多轮上下文。
5. **本地图片导入**：舞台支持拖入、粘贴与「选择图片」入口导入 PNG / JPEG（`POST /imagen-api/import`，见 §2.3）：
   导入图原样落盘为独立 `v1`，切到舞台焦点并可立即使用动作坞；新画布与空舞台的取景框提示
   「写提示词，或把图片拖入取景框」。图片工具编辑态拒绝导入并提示（不覆盖涂抹草稿）。
   画廊 / 胶片条对 `item.source === "import"` 的作品显示「导入」角标。
6. **拉帘对比原图**：带 `sourceImage` 的派生作品（重绘 / 涂抹 / 扩图产物，含导入后加工）在舞台玻璃工具区
   出现「对比原图」开关；打开后在相纸位置以可拖动分隔线对比原图与当前版本（指针拖动、双击回 50%、
   ←/→ 4% 步进、Home/End；`role="slider"` + `aria-valuenow`）。切图或进入编辑态自动关闭对比。
7. **PNG 生成元数据**：Host 在生成产物 PNG 中写入 `tEXt` 元数据（keyword `our-imagen`，含提示词 / 排除项 /
   预设 / 尺寸 / 步数 / CFG / 种子 / 任务号）；再次导入这张 PNG 时解出元数据写进 `meta.json` 的
   `generation` 并回填参数，胶片条点该图即可还原原生成参数，并在导入成功时提示「已识别生成参数」。
   元数据写入失败不影响出图（退回原始字节）；JPEG 没有等价容器，导入时按「无元数据」处理。
8. **测试**：新增 `test/check-client-draft.mjs`（4 项，草稿托管状态流转与整页呈现）、
   `test/chat-timeline.mjs`（5 项，结果网格 / 聚焦栈 / 镜像记录与上下文隔离）、
   `test/import-client.mjs`（18 项，导入纯逻辑 + Stage 渲染集成）、`test/import-host.mjs`（17 项，导入路由 /
   PNG tEXt / 历史收录）；`check-client-chat` 19 项、`check-client-shell` 51 项、`check-client-logic` 83 项、
   `check-client-tools` 27 项、`image-tool-render` 6 项、`host-e2e` 56 项、`jobs-wait` 31 项，
   `check-client-locale` zh/en 各 539 键同构；`npm test` 36 步全绿。
