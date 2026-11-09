# 接口契约 (API)

本文件是 Host、Client、远端 Daemon 三方共同的实现依据。字段名一旦写入本文件即为稳定契约，改动需同步四处：`index.js`、`client.js`、`remote/daemon.py`、本文件。

## 1. 角色与进程边界

```
DSH Client (web)  ──HTTP──▶  DSH Host 插件 (index.js)
                                 │
                                 ├── kaggle CLI（本机子进程）
                                 └── fetch ──▶ 远端 Daemon（Kaggle Kernel 内，经 Cloudflare 隧道）
```

- Client 只访问 Host 的 `/imagen-api/*` 路由，不直连远端。
- Host 持有会话的单例状态、任务串行队列与本地产物目录。
- Daemon 只做推理，不知道自己被谁调度；模型加载参数由 Host 在每次请求里下发。

## 2. 会话状态机

```
absent ──start──▶ provisioning ──隧道就绪──▶ connecting ──health 可达──▶ warming ──模型加载完──▶ ready
   ▲                  │                          │                        │                    │
   │                  └──────────── error ◀──────┴────────────────────────┴────────────────────┘
   └────────────────────────── stop（ready/error）──────────── stopping ◀───────────────────┘
```

| state | 含义 | 前端应显示 |
| --- | --- | --- |
| `absent` | 无远端会话 | 未启动 |
| `provisioning` | 已推送 Kernel，等待排队/容器启动 | 排队中，附 `phase` 与已等待时长 |
| `connecting` | 已从会合点拿到隧道地址，正在探测 `/health` | 建立隧道 |
| `warming` | 隧道可用，远端仍在装依赖/加载模型 | 模型加载中 |
| `ready` | 可接单 | 就绪 |
| `stopping` | 正在通知远端退出 | 正在关机 |
| `error` | 失败 | 失败，附 `error.code` / `error.message` |

`session` 对象字段（`GET /state` 内）：

```jsonc
{
  "state": "provisioning",
  "phase": "push | queue | tunnel | health | warm | null",
  "detail": "人类可读的一行说明",
  "presetId": "sdxl-lightning",
  "kernelId": "mogudd/imagen-1a2b3c4d",
  "kernelUrl": "https://www.kaggle.com/code/mogudd/imagen-1a2b3c4d",
  "kernelStatus": "RUNNING",
  "endpointUrl": "https://xxx.trycloudflare.com",
  "device": "Tesla T4",
  "deviceCount": 2,
  "modelId": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
  "startedAt": "2026-11-09T04:00:00.000Z",
  "readyAt": null,
  "lastProbeAt": "2026-11-09T04:00:20.000Z",
  "idleTimeoutSec": 1800,
  "error": { "code": "push_failed", "message": "…" }
}
```

`error.code` 取值：`cli_missing`、`auth_required`、`push_failed`、`queue_timeout`、`tunnel_timeout`、`health_failed`、`remote_error`、`session_ended`、`stopped`。

`session_ended` 表示会话曾在 `ready`，Kernel 随后结束（空闲退出或远端崩溃）；重新调用 `session/start` 即可拉起新会话。

## 3. Host 路由

所有路由挂在 `/imagen-api` 前缀下，`kind: 'exact'`。响应一律 `application/json; charset=utf-8`，`cache-control: no-store`（`/file` 除外）。错误响应体统一为 `{ "error": { "code": "...", "message": "..." } }`。

### GET /imagen-api/state

```jsonc
{
  "version": "0.2.0",
  "defaultPreset": "sdxl-lightning",
  "presets": [ /* 见 lib/presets.js */ ],
  "session": { /* 见上 */ },
  "probe": { /* kaggle 探测结果，可能为 null */ },
  "probeAt": 1762660000000,
  "jobs": [ /* 最近 10 个 job 摘要，倒序 */ ],
  "lastJob": { /* 最近一次完成的 job，可能为 null */ }
}
```

### POST /imagen-api/probe

无请求体。返回 `{ "ok": boolean, "probe": { ... } }`，`probe` 结构与 `lib/kaggle.js` 现有实现一致（`cli` / `auth` / `quota` / `notes`）。

### POST /imagen-api/session/start

```jsonc
{ "presetId": "sdxl-lightning" }
```

幂等：`provisioning` / `connecting` / `warming` / `ready` 状态下直接返回当前 `session`，不重复推送。返回 `{ "ok": true, "session": { ... } }`。`absent` / `error` 状态下才真正发起。

### POST /imagen-api/session/stop

先尝试远端 `POST /shutdown`（3s 超时），再清理本地状态。返回 `{ "ok": true, "session": { ... } }`，状态为 `absent`。远端不可达时仍视为成功，`detail` 说明已转入空闲退出。

### POST /imagen-api/generate

```jsonc
{
  "prompt": "雾中荷塘，工笔",
  "negativePrompt": "blurry, low quality",
  "presetId": "sdxl-lightning",
  "width": 1024,
  "height": 1024,
  "steps": 4,
  "cfg": 0,
  "seed": 42,
  "count": 1,
  "waitSeconds": 0,
  "autoStart": true
}
```

- `prompt` 必填，去除首尾空白后 1–2000 字符。
- `width` / `height` 默认取预设 `size`，范围 256–1536 且取 8 的整数倍。
- `steps` 默认取预设，范围 1–60；`cfg` 默认取预设，范围 0–20。
- `seed` 省略或为 `-1` 时随机；响应回填实际使用的 seed。
- `count` 1–4，同一 prompt 使用递增 seed（`seed + i`），名字 `01`、`02`…
- `waitSeconds` 为 0 时立即返回 job；大于 0 时挂起等待该 job 结束（上限 600，超时返回当前 job 状态，HTTP 仍为 200）。
- `autoStart` 默认 true：会话不处于 `ready` / `warming` 时自动调用会话启动。

响应：单个 job 对象（见第 4 节）。

### GET /imagen-api/job?id=JOB_ID

返回单个 job；不存在时 404。

### GET /imagen-api/jobs?limit=20

返回 `{ "jobs": [job...], "queue": { "running": "JOB_ID"|null, "pending": 0 } }`。

### GET /imagen-api/history?limit=30

扫描 `<workspace>/imagen-output/`，按目录名倒序：

```jsonc
{
  "items": [
    {
      "jobId": "j_1a2b3c4d",
      "dir": "imagen-output/20261109-120000-j_1a2b3c4d",
      "createdAt": "2026-11-09T04:00:00.000Z",
      "presetId": "sdxl-lightning",
      "prompt": "雾中荷塘，工笔",
      "images": [
        {
          "file": "01.png",
          "path": "imagen-output/20261109-120000-j_1a2b3c4d/01.png",
          "url": "http://127.0.0.1:58893/imagen-api/file?path=imagen-output%2F…%2F01.png",
          "width": 1024,
          "height": 1024,
          "seed": 42,
          "seconds": 6.2
        }
      ]
    }
  ]
}
```

### GET /imagen-api/file?path=RELATIVE_PATH

- 只允许 `<workspace>/imagen-output/` 下的 `.png` / `.jpg` / `.webp` / `.json`。
- 解析顺序：`realpath` 后必须仍在输出根目录内，否则按不存在处理（统一 404，不区分"越界"与"不存在"，避免泄露路径信息）。
- 命中返回文件字节与正确 `content-type`，`cache-control: public, max-age=31536000, immutable`；未命中 404。

## 4. Job 对象

```jsonc
{
  "id": "j_1a2b3c4d",
  "status": "queued | waiting-session | running | done | failed",
  "stage": "排队中 | 等待会话 | 生成中 | 完成 | 失败",
  "presetId": "sdxl-lightning",
  "params": { "prompt": "…", "negativePrompt": "…", "width": 1024, "height": 1024, "steps": 4, "cfg": 0, "seed": 42, "count": 1 },
  "createdAt": "…", "startedAt": "…", "finishedAt": "…",
  "seconds": 6.2,
  "sessionState": "ready",
  "output": {
    "dir": "imagen-output/20261109-120000-j_1a2b3c4d",
    "metaFile": "imagen-output/20260909-…/meta.json",
    "images": [ /* 结构同 history.images */ ]
  },
  "error": null
}
```

`status` 与 `stage` 一一对应，前端只用 `status` 做逻辑、`stage` 做文案（文案走 locale，见第 7 节）。

## 5. 本地产物

```
<workspace>/imagen-output/<YYYYMMDD-HHmmss>-<jobId>/
  01.png
  02.png
  meta.json
```

`meta.json`：

```jsonc
{
  "version": 1,
  "jobId": "j_1a2b3c4d",
  "presetId": "sdxl-lightning",
  "modelId": "…",
  "createdAt": "…",
  "finishedAt": "…",
  "params": { /* 同 job.params */ },
  "images": [
    { "file": "01.png", "seed": 42, "seconds": 6.2, "width": 1024, "height": 1024, "prompt": "…", "negativePrompt": "" }
  ]
}
```

## 6. 远端 Daemon 协议（v2）

所有请求带 `Authorization: Bearer <authToken>`；`authToken` 由 Host 每次会话随机生成，经 `EMBEDDED_CONFIG_B64` 注入，不落盘、不回传。

### 6.0 Kernel 注入配置

Host 打包 Kernel 时把下列 JSON 做 Base64 注入 `remote/daemon.py` 的行首赋值 `EMBEDDED_CONFIG_B64 = "…"`：

```jsonc
{
  "auth_token": "一次性 Token",
  "ntfy_topic": "imagen-<随机 hex>",
  "idle_timeout_sec": 1800,
  "preload": { /* 与请求里的 pipeline 同结构，用于启动即加载默认模型 */ },
  "preset_id": "sdxl-lightning",
  "log_level": "info",
  "version": "0.2.0"
}
```

`preload` 必须是完整 pipeline 描述（含 `loader`）；只给预设 id 时 daemon 无法加载，会跳过预载。环境变量 `IMAGEN_CONFIG_B64` 可覆盖注入值，仅用于本地调试。

### GET /health

```jsonc
{
  "status": "ok",
  "phase": "booting | installing | loading | ready | error",
  "version": "0.2.0",
  "model_id": "stabilityai/stable-diffusion-xl-base-1.0",
  "loaded": ["sdxl-lora:stabilityai/stable-diffusion-xl-base-1.0"],
  "device": "Tesla T4",
  "device_count": 2,
  "idle_seconds": 12.0,
  "idle_timeout_sec": 1800,
  "jobs_done": 3,
  "queue_depth": 0,
  "last_error": null,
  "last_error_code": null,
  "detail": null
}
```

`last_error` 是字符串（形如 `"oom: …"`），失败代码另放 `last_error_code`；`detail` 是当前阶段的一句话说明。`phase=ready` 表示可以接单；其余阶段 Host 视作 `warming`。

### GET /logs?since=N

返回 `{ "lines": ["…"], "next": 42 }`，最多保留最近 400 行，`since` 为上次 `next`。

### POST /generate

```jsonc
{
  "pipeline": {
    "loader": "sdxl-lora",
    "base": "stabilityai/stable-diffusion-xl-base-1.0",
    "lora": { "repo": "ByteDance/SDXL-Lightning", "weight": "sdxl_lightning_4step_lora.safetensors" },
    "scheduler": { "type": "euler", "timestepSpacing": "trailing" },
    "variant": "fp16",
    "allowPatterns": ["model_index.json", "**/config.json", "**/*.json", "**/*.txt", "**/*.fp16.safetensors"],
    "deviceMap": null
  },
  "modelId": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
  "tasks": [
    { "name": "01", "prompt": "…", "negative_prompt": "…", "seed": 42, "width": 1024, "height": 1024, "steps": 4, "cfg": 0 }
  ]
}
```

`loader` 取值：`sdxl`（整管直出）、`sdxl-lora`（底座 + Lightning LoRA + Euler trailing）、`flux2`（FLUX.2 klein，需 `deviceMap`）。新增 loader 必须在 daemon 侧有对应分支，未知值返回 400。

响应：

```jsonc
{
  "status": "ok",
  "model_id": "…",
  "load_seconds": 7.7,
  "results": [
    { "name": "01", "seed": 42, "seconds": 6.2, "width": 1024, "height": 1024, "steps": 4, "cfg": 0, "png_bytes": 1234567, "image_b64": "iVBOR…" }
  ]
}
```

失败：HTTP 500 + `{ "error": { "code": "oom | load_failed | invalid_request | generation_failed", "message": "…" } }`。`oom` 要求 daemon 清理缓存并允许重试。

兜底：`phase` 尚未到 `ready` 时返回 503 `{ "error": { "code": "warming" } }` 并带 `Retry-After: 5`。Host 正常会在会话 `ready` 后才提交，此分支只防直接调用。

### POST /shutdown

返回 `{"status":"shutting_down"}`，随后 `os._exit(0)`。Host 不等待该连接的正常关闭。

## 7. 前端文案键

`client.js` 的 locale 字典新增以下键（zh/en 双份，键名固定）：

| 键 | 用途 |
| --- | --- |
| `workbench.title` / `workbench.subtitle` | 工作台标题 |
| `workbench.prompt` / `workbench.promptPlaceholder` | Prompt 输入 |
| `workbench.negative` / `workbench.negativePlaceholder` | 反向提示词 |
| `workbench.preset` / `workbench.size` / `workbench.steps` / `workbench.cfg` / `workbench.seed` / `workbench.count` | 参数标签 |
| `workbench.random` | 随机种子占位 |
| `workbench.generate` / `workbench.generating` | 生成按钮 |
| `workbench.startSession` / `workbench.stopSession` | 会话按钮 |
| `workbench.sessionHint` | 会话状态说明 |
| `workbench.gallery` / `workbench.galleryEmpty` | 图墙 |
| `workbench.history` / `workbench.historyEmpty` / `workbench.openFolder` | 历史 |
| `workbench.error` / `workbench.retry` | 错误 |
| `session.state.<state>` | 七种会话状态文案 |
| `job.status.<status>` | 五种 job 状态文案 |

本节只列约定键名；其余展示型文案（按钮辅助说明、错误提示、`session.phase.*` 等）以 `client.js` 的 `DICT` 为唯一来源，新增时同步 zh/en 两份。

## 8. 约束

1. Host 同时只允许一个远端会话、一个在执行中的 job；队列按提交顺序串行。
2. 图片只在 Host 落盘，Daemon 不保存文件。
3. 任何路径参数都必须先做输出根目录包含性校验。
4. 密钥（`authToken`）只在内存与临时 Kernel 目录中出现，Host 状态接口不得返回完整值。
5. 开发模式：配置 `devEndpoint`（或环境变量 `OUR_FREE_IMAGEN_ENDPOINT`）时，Host 跳过 Kaggle 直接使用该地址，状态接口 `devMode` 为 true；此模式仅供本地联调。
