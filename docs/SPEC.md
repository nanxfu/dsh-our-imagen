# 技术规格与接口契约 (SPEC)

> **数据单一来源**：路由、错误码、参数边界、超时、预设与远端协议字段统一由 [`shared/contract.js`](../shared/contract.js) 定义；
> 本文档只描述语义、请求/响应形状与使用约束，不重复维护数值。`node test/check-contract.mjs` 会校验
> 宿主注册的路由、宿主错误码、客户端文案与本文档是否跟随契约。
>
> **版本**：0.3.0（与 `package.json`、`shared/contract.js` 的 `VERSION` 一致）。

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
`kernelStatus`、`endpointUrl`、`device`、`deviceCount`、`modelId`、`startedAt`、`readyAt`、`lastProbeAt`、
`idleTimeoutSec`、`error`（`null` 或 `{ code, message }`）。鉴权 token 不进入任何对外快照
（只在 Host 内部用于请求远端；`endpointUrl` 会下发，供前端展示隧道是否建立）。

### 1.2 任务状态（Job Status）

| `status` | 含义 |
| :--- | :--- |
| `queued` | 已入本地队列，尚未开始 |
| `waiting-session` | 正在等待/唤起远端会话 |
| `running` | 远端生成中 |
| `done` | 完成，`output` 内有图片 |
| `failed` | 失败，`error` 内是错误码与原因 |

### 1.3 错误码字典 (`error.code`)

错误响应统一为 `{ "error": { "code": "...", "message": "..." } }`。错误码词表见
`shared/contract.js` 的 `ERROR_CODES`；下表的 `HTTP` 列是宿主直接返回该码时的状态码。
远端 daemon 的 `{ error: { code, message } }` 由宿主原样透传（`remote` 层 4 个码在宿主字典中也有文案）。

**Host 层（27 个）**

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
| `queue_timeout` | — | Kaggle GPU 排队超时（默认 45 分钟） |
| `tunnel_timeout` | — | 容器已启动但隧道未建立 / 会合失败 |
| `health_failed` | — | 隧道已建立但 `/health` 持续不可达 |
| `remote_error` | — | 远端 daemon 主动报告错误 |
| `session_ended` | — | Kernel 非预期结束（被平台回收等） |
| `unknown` | — | 探测/检查失败但无法归因 |

**Remote 层（4 个，远端产生、宿主透传）**

| 错误码 | 触发场景 |
| :--- | :--- |
| `unauthorized` | 远端 Bearer Token 缺失或错误（远端回 401） |
| `load_failed` | 依赖安装 / 模型加载失败 |
| `generation_failed` | 推理过程异常 |
| `oom` | CUDA 显存不足（远端会先 `torch.cuda.empty_cache()` 再回错） |

> 远端也会复用 Host 层的 `invalid_request`（参数不合法，400）与 `not_found`（未知路径，404）。

**Client 层（6 个，仅客户端本地合成，不会由 Host/远端返回）**

`warming`（收到 503 但没有明确错误码，按可重试处理）、`timeout`（请求被 AbortController 取消）、
`network`（fetch 失败）、`need_prompt`（本地表单校验）、`delete_failed`（删除动作失败）、
`probe_failed`（环境检查失败）。

---

## 2. Host HTTP 路由

所有插件接口统一挂载在 `/imagen-api` 前缀下；除个别例外，成功响应为 `application/json; charset=utf-8`。
异常响应统一为 `{ "error": { "code": "...", "message": "..." } }`。方法不匹配时返回 `405`（带 `Allow` 头、无响应体）。

> **例外**：`GET /imagen-api/file` 返回图片二进制流（`image/png` 等），不是 JSON。

路由总览（15 条，以 `shared/contract.js` 的 `ROUTES` 为准）：

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| GET | `/imagen-api/state` | 插件运行状态全貌（前端轮询数据源） |
| POST | `/imagen-api/probe` | 主动触发本地 Kaggle 环境检测 |
| POST | `/imagen-api/session/start` | 启动远端 GPU 会话（幂等） |
| POST | `/imagen-api/session/stop` | 关机 |
| POST | `/imagen-api/generate` | 提交生图任务 |
| GET | `/imagen-api/job?id=` | 查询单个任务 |
| GET | `/imagen-api/jobs?limit=` | 查询任务列表与队列概况 |
| GET | `/imagen-api/history?limit=` | 查询历史产物 |
| GET | `/imagen-api/file?path=` | 读取产物图片（二进制） |
| GET | `/imagen-api/library` | 读取收藏 / 删除记录 |
| POST | `/imagen-api/library/favorite` | 收藏 / 取消收藏 |
| POST | `/imagen-api/library/delete` | 删除产物 |
| POST | `/imagen-api/enhance` | 提示词润色 |
| POST | `/imagen-api/intent` | 对话意图解析 |
| POST | `/imagen-api/reveal` | 在文件管理器中打开产物目录 |

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
| `jobs` | 最近 10 条任务（`Job` 公开视图，见 §2.2） |
| `lastJob` | 最近一条完成/失败的任务，或 `null` |
| `queue` | `{ running: id \| null, pending: number }` |
| `devMode` | 是否通过 `devEndpoint` 走本地联调 |

- **响应示例**：

```json
{
  "version": "0.3.0",
  "defaultPreset": "sdxl-lightning",
  "presets": [
    {
      "id": "sdxl-lightning",
      "label": "默认 · 1024 快档",
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
      "negativeHint": "blurry, low quality, deformed, extra limbs"
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
    "startedAt": "2026-11-09T04:00:00.000Z",
    "readyAt": "2026-11-09T04:06:00.000Z",
    "lastProbeAt": "2026-11-09T04:07:02.000Z",
    "idleTimeoutSec": 1800,
    "error": null
  },
  "probe": null,
  "probeAt": 0,
  "jobs": [],
  "lastJob": null,
  "queue": { "running": null, "pending": 0 },
  "devMode": false
}
```

> `presets` 是 `publicPresets()` 的结果：不含 `pipeline`（下发远端 daemon 用的加载描述），避免同一份数据在
> 客户端快照里出现两份。

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

- **请求体**：`{ "presetId": "sdxl-lightning" }`（可选；未知 id 回退 `defaultPreset`）
- **响应**：`{ "ok": true, "session": SessionSnapshot }`

#### `POST /imagen-api/session/stop`

关机。通知远端容器退出并清理本地连接状态（best-effort，不等待远端确认）。

- **响应**：`{ "ok": true, "session": { "state": "stopping" | "absent", ... } }`

### 2.2 出图任务

队列在 Host 侧串行执行：同一时刻最多 1 个 `running`，其余按提交顺序排队。

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
| `autoStart` | boolean | 默认 `true`；`false` 时不自动唤起会话 |

- **响应**：**裸 `Job` 对象**（不是 `{ ok, job }` 包装）。`waitSeconds > 0` 时返回的是等待结束后的快照，
  任务可能仍在 `queued` / `running`。

`Job` 结构：

| 字段 | 说明 |
| :--- | :--- |
| `id` | 任务 id（`j_<hex>`） |
| `status` | `queued` / `waiting-session` / `running` / `done` / `failed` |
| `stage` | 给人看的中文阶段文案（如「排队中」「生成中」） |
| `presetId` | 实际使用的预设 id |
| `params` | 归一化后的参数：`{ prompt, negativePrompt, width, height, steps, cfg, seed, count }` |
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

- **错误**：`400 invalid_prompt`（prompt 为空/超长）、`400 queue_full`（待执行队列已满）、`400 invalid_body`（请求体不是合法 JSON）。

#### `GET /imagen-api/job?id=<jobId>`

查询单个任务的状态与结果。

- **响应**：`Job` 对象（结构同上）。
- **错误**：`404 not_found`（任务不存在或已被裁剪）。

#### `GET /imagen-api/jobs?limit=<n>`

查询最近任务列表与队列概况。

- `limit`：1~100，默认 20。
- **响应**：`{ "jobs": Job[], "queue": { "running": "j_... | null", "pending": 0 } }`

#### `GET /imagen-api/history?limit=<n>`

获取工作区 `imagen-output/` 下的历史生成记录，按时间倒序。

- `limit`：1~100，默认 30。
- **响应**：`{ "items": HistoryItem[] }`。

`HistoryItem`：`{ jobId, dir, createdAt, finishedAt, presetId, params, prompt, images[] }`；
`params` 是完整的生成参数（用于「带回参数」），`images[]` 每项：
`{ file, path, absolute, url, width, height, seed, seconds }`（已按文件是否存在过滤，删除过的图不会出现）。

#### `GET /imagen-api/file?path=<encodedPath>`

读取产物图片二进制流，供前端直接预览。

- `path` 必须是工作区相对路径且落在 `imagen-output/` 内（越界路径返回 404，不做目录穿越猜测）。
- 支持 `HEAD`；成功响应带 `content-type`、`content-length`、`cache-control: public, max-age=31536000, immutable`。
- **错误**：`404 not_found`（路径非法、文件不存在或读取失败）。

### 2.3 收藏、文案与本地动作

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

提示词润色：按光影 / 材质 / 构图 / 氛围四个维度返回可追加的短语。

- **请求体**：`{ "prompt": "雨夜街景", "presetId": "sdxl-lightning", "locale": "zh" }`（`presetId` / `locale` 可选，locale 仅 `zh` / `en`）
- **响应**：

```json
{
  "ok": true,
  "source": "model",
  "groups": [
    { "dimension": "lighting", "options": [{ "id": "model-lighting-0", "text": "柔和漫射光" }] },
    { "dimension": "material", "options": [] }
  ]
}
```

- `source`：`model`（宿主模型）/ `local`（同结构本地兜底）；空提示词返回空 `groups`、`source: "local"`。

#### `POST /imagen-api/intent`

对话模式意图解析：把一句话整理成生成参数，必要时返回澄清项。

- **请求体**：`{ "text": "画一张横版的雨夜街景", "previousPrompt": "", "locale": "zh" }`（后两者可选）
- **错误**：`400 invalid_request`（`text` 为空或超过 2000 字符）。
- **响应**：

```json
{
  "ok": true,
  "source": "model",
  "prompt": "雨夜街景，湿润地面倒映霓虹招牌",
  "ratioId": "16:9",
  "styleId": "film",
  "clarify": null
}
```

- `ratioId` 取值 `1:1 / 16:9 / 9:16 / 4:3 / 3:4 / ""`；`styleId` 取值 `film / concept / cyberpunk / ink / clay / ""`，留空表示沿用当前设置。
- `clarify` 仅在用户要求互相矛盾时出现：`{ "field": "ratio"|"style", "options": [...] }`。
- 无可用模型时 `source` 为 `local`，`prompt` 为原文。

#### `POST /imagen-api/reveal`

在系统文件管理器中打开产物目录（仅限 `<workspace>/imagen-output/`）。

- **请求体**：`{}`；`{ "dryRun": true }` 只解析目录、不唤起文件管理器（自检用）。
- **响应**：`{ "ok": true, "dir": "…/imagen-output" }`（dryRun 时多一个 `"dryRun": true`）。
- **错误**：`404 output_missing`（目录不存在）、`500 reveal_failed`（调起失败）。

---

## 3. DSH 会话 Agent 工具规范

插件向 DSH 会话模型注入 3 个标准 Tool，支持对话中直接出图：

### 3.1 `imagen_generate`

- **描述**：在免费的 Kaggle GPU 上运行开源文生图模型并出图，图片保存到工作区 `imagen-output/` 目录。
  首次调用若远端会话未启动，会自动拉起 Kernel（可能需要排队 10 分钟以上）。
- **输入参数**（`additionalProperties: false`）：

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `prompt` | string | 是 | 画面描述，建议英文，不超过 2000 字符 |
| `negativePrompt` | string | 否 | 反向提示词，仅在 `cfg > 0` 时生效 |
| `presetId` | string | 否 | 预设 id（枚举来自契约 `PRESETS`），默认 `sdxl-lightning` |
| `width` | integer | 否 | 宽度 256–1536，默认取预设 |
| `height` | integer | 否 | 高度 256–1536，默认取预设 |
| `steps` | integer | 否 | 采样步数 1–60，默认取预设 |
| `cfg` | number | 否 | CFG 0–20，默认取预设 |
| `seed` | integer | 否 | 随机种子，省略则随机 |
| `count` | integer | 否 | 张数 1–4，默认 1 |
| `waitSeconds` | integer | 否 | 最多等待累计秒数 0–600，默认 90；超时后任务仍在后台继续 |

- **返回**：文本（`{ "text": string }`），内容为任务状态 / 参数摘要 / 产物路径（完成时提示可用
  `![描述](URL)` 展示图片）。

### 3.2 `imagen_session`

- **描述**：管理云端 GPU 会话（查询状态、主动开机、主动关机）。
- **输入参数**：`action`（必填，枚举 `start` / `stop` / `status`）、`presetId`（可选，枚举来自契约 `PRESETS`）。
- **返回**：会话状态摘要文本。

### 3.3 `imagen_history`

- **描述**：获取当前工作区最近生成的图片文件列表与参数信息。
- **输入参数**：`limit`（可选，1–30，默认 5）。
- **返回**：最近生成的条目文本（时间、预设、提示词摘要、图片路径）。

---

## 4. 模型基准与硬件实测数据

运行环境：Kaggle Nvidia Tesla T4（分配 2 块 T4，每卡可用显存 14.56 GiB，CUDA 12.x）。
**数值以 `shared/contract.js` 的 `PRESETS` 为准**（`peakVramMb` 为实测峰值显存，`loadSeconds` 为首次加载耗时，
`steadySeconds` 为加载完成后的单张稳定耗时）。

| 预设 ID | 基础模型与权重 | 默认尺寸（可选档位） | 步数 / CFG | 加载 / 单张耗时 | 峰值显存 | 下载量 | 卡数 | 档位 |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | :--- |
| **`sdxl-lightning`** *(默认)* | `stabilityai/stable-diffusion-xl-base-1.0` + `ByteDance/SDXL-Lightning` (4-step LoRA) | 1024（768 / 1024 / 1152） | 4 步 / 0 | 7.7s / 6.2s | 10347 MB | 6.78 GB | 1 | fast |
| **`sdxl-turbo`** | `stabilityai/sdxl-turbo` | 512（512 / 768 / 1024） | 4 步 / 0 | 4.0s / 1.87s | 7666 MB | 6.62 GB | 1 | fast |
| **`sdxl-base`** | `stabilityai/stable-diffusion-xl-base-1.0` | 1024（768 / 1024 / 1152） | 25 步 / 7.5 | 5.8s / 27.8s | 9966 MB | 6.78 GB | 1 | usable |
| **`flux2-klein-4b`** *(实验)* | `black-forest-labs/FLUX.2-klein-4B` | 1024（768 / 1024） | 4 步 / 1.0 | 28.2s / 10.24s | 7929 MB | 15.2 GB | 2 | fast |

> **双卡说明**：`flux2-klein-4b` 的 pipeline 使用 `deviceMap: "balanced"`，Kernel 申请 2×T4 时按 `gpus: 2` 下发；
> 其余预设单卡即可。
>
> **首张生成延迟说明**：远端服务支持在 Kernel 启动时预载模型（`preload`）；但首次推理仍需建立 CUDA Context
> 与内存池，耗时高于 `steadySeconds`，从第二张开始进入稳定速度。

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
| **画风标签** | 风格胶囊 (`Capsule`) | **风格预设** (`Style`) | 预置画风选择器 |
| **算力状态** | 算力胶囊 (`Compute Pill`) | **GPU 状态** (`GPU Status`) | 顶栏远端算力状态指示条 |
| **额度展示** | 免费额度 (`Free Quota`) | **Kaggle 剩余算力** (`Kaggle Quota`) | 明确指出算力来源与属性 |

### 5.2 布局结构规范

工作台采用桌面优先的**单轨创作面板 + 居中画面自适应预览**布局：
1. **单轨面板 (320px 恒定)**：固定在左侧，自上而下承载提示词、灵感预设/智能润色、风格画幅、高级参数（采样步数、CFG、种子、张数，默认折叠抽屉）与生成 CTA。
2. **画面预览区 (自适应填充)**：大图按比例 contain 居中渲染，图下配操作胶囊（带回参数、生成变体、复制绝对路径、在文件夹中打开）。
3. **最近生成栏 (底部常驻)**：横向滚动展示最近批次缩略图（62×62、12px 圆角），支持快速点选切图。
4. **画廊卡片墙 (独立全宽视图)**：5 列自然高度卡片墙，不裁切图片，按时间线分段，支持搜索、模型筛选与批量管理。

### 5.3 悬浮提示 (Tooltip) 部署明细

主界面保持极简，运作原理、生效约束与警示一律收敛于悬浮提示：

| 字段 / 区域 | 界面展示标签 | 悬浮图标 | 悬浮提示完整内容 (Tooltip Content) |
| :--- | :--- | :---: | :--- |
| **排除项** | 排除项 | `(ℹ)` | 画面中不希望出现的元素。注意：仅在引导强度 (CFG) > 0 时生效。 |
| **采样步数** | 采样步数 | `(ℹ)` | 模型迭代去噪的步数。SDXL Lightning 推荐 4~8 步，SDXL Base 推荐 25~30 步。 |
| **引导强度** | 引导强度 (CFG) | `(ℹ)` | 数值越高越贴合提示词，过高可能产生色彩失真。默认推荐 1.5~7.0。 |
| **Kaggle 账号** | Kaggle 状态 | `(!)` | Kaggle 账号必须完成手机号绑定。未绑定的账号会被平台静默降级为 CPU，无法出图。 |
| **空闲休眠** | 在线 · 单张约 6s | `(ℹ)` | 云端实例空闲超过 30 分钟将自动关机，以节省你的每周 30 小时免费 GPU 额度。 |
| **提示词输入** | 提示词 | `(ℹ)` | 支持中英文输入。建议包含主体、光影、构图与画风。 |

### 5.4 启发式灵感与模块化分层润色

1. **灵感示例预设**：在提示词输入框为空或点击灵感时，提供预置启发式场景卡（科幻赛博、人像摄影、东方意境、3D 萌系、微距自然），点击直接填入。
2. **结构化维度润色**：当调用智能润色时，由大模型解析提取 4 个可点选追加的维度标签（光影材质、构图视角、画面氛围、色彩基调），用户按需点击追加到提示词末尾，禁止强制一次性替换原文本。
