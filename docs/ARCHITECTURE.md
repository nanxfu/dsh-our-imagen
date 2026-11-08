# 架构与状态机（ARCHITECTURE）

本文描述 `dsh-our-free-imagen` 的四层结构、进程边界、数据流与状态机。与 [SPEC.md](SPEC.md) 的分层一致，本文给出可实施的细节。

---

## 1. 进程与边界

```
┌──────────────────────────── Harness 进程（Node） ────────────────────────────┐
│                                                                              │
│  Client（Web UI，浏览器内）                    Host（同进程，插件的 apply）  │
│  ┌──────────────────────────┐   HTTP 轮询      ┌───────────────────────────┐  │
│  │ 面板组件                  │ ───────────────▶ │ /imagen-api/state         │  │
│  │ 模型卡 / 图墙 / 引导       │ ◀─────────────── │ /imagen-api/generate      │  │
│  │ 状态徽章                  │   /imagen-api/img │ /imagen-api/session       │  │
│  └──────────────────────────┘                   │ /imagen-api/probe         │  │
│                                                 └────────────┬──────────────┘  │
│                                                              │                 │
│                              ┌───────────────────────────────▼──────────────┐  │
│                              │ ImagenService（唯一状态写者）                 │  │
│                              │ session 单例 · job 队列 · progress 聚合        │  │
│                              └───────────────┬──────────────────────────────┘  │
│                                              │                                 │
│                              ┌───────────────▼──────────────┐                  │
│                              │ Provider（TS）：kaggle        │                  │
│                              │ 子进程 + 轮询 + HTTP + 落盘    │                  │
│                              └───┬──────────┬───────────┬───┘                  │
└──────────────────────────────────┼──────────┼───────────┼──────────────────────┘
                                   │          │           │
                     kaggle CLI 子进程     ntfy.sh      HTTPS（隧道）
                                   │          │           │
                         ┌─────────▼──────────▼───────────▼─────────┐
                         │ Kaggle Kernel（Python）                  │
                         │ remote/daemon.py 或 remote/worker.py      │
                         │ diffusers · torch · cloudflared           │
                         └──────────────────────────────────────────┘
```

边界规则：

- **只有 `ImagenService` 写状态。** UI 走路由、Agent 走 tool，两者都调用同一批 service 方法，不直接读文件。
- **Provider 不感知 UI。** 它只产出结构化结果与进度事件，由 service 汇总。
- **Client 不直连隧道。** 所有对远端守护进程的请求都由 Host 发起，从而把 Bearer token 留在宿主侧。

---

## 2. 包结构

```
our-free-imagen/                 # 仓库根 = 插件包根
├── package.json                 # dsh.bundle.patch + dsh.client
├── cordis.patch.yml             # 插入插件行
├── index.js                     # Host：apply(ctx, config)
├── client.js                    # Client：__ModuleLoader__.load(...)
├── lib/                         # Host 内部模块（service / provider / routes / queue / fs）
├── src/                         # Client 组件与复用逻辑
├── locale/{zh.json,en.json}     # 元数据文案
├── icon.svg
├── remote/
│   ├── worker.py                # 一次性执行
│   └── daemon.py                # 常驻守护进程
├── bench/                       # T4 准入基准（非运行时依赖）
├── docs/
└── CHANGELOG.md
```

约定：`package.json` 的 `files` 白名单只包含运行期需要的目录（`index.js`、`client.js`、`lib/`、`src/`、`locale/`、`icon.svg`、`remote/`），`docs/`、`bench/` 不随包发布。

---

## 3. 运行时目录

| 内容 | 位置 | 理由 |
| :--- | :--- | :--- |
| 会话状态 `session.json` | 插件数据目录，**全局单例** | GPU 会话是全局资源，两个 workspace 不能各起一个 |
| 任务记录 `jobs/<jobId>.json` | 插件数据目录 | 与 UI 轮询解耦，重启后可恢复列表 |
| 运行日志 `logs/` | 插件数据目录，按会话轮转 | 失败归因需要原始日志 |
| 生成产物 | `<workspace>/imagen-output/<jobId>/` | 用户按项目取图 |
| `meta.json` | 与产物同目录 | 每张图的 prompt、seed、参数、耗时、模型 ID |

产物按 workspace 落盘，会话状态全局唯一：UI 顶部需要标注"当前会话由哪个 workspace 占用"，并提供接管动作。

---

## 4. 状态机

会话状态（`session.state`）：

| 状态 | 含义 | 允许的下一步 |
| :--- | :--- | :--- |
| `absent` | 本地无会话记录 | `provisioning` |
| `provisioning` | 正在推送内核、等待调度 | `booting`、`failed` |
| `booting` | 内核运行中，等待隧道握手与模型加载 | `ready`、`failed` |
| `ready` | 守护进程健康，可接任务 | `busy`、`stopping`、`failed` |
| `busy` | 正在出图 | `ready`、`failed` |
| `stopping` | 已发出关机请求，等待确认 | `absent`、`failed` |
| `failed` | 失败，附错误码 | `absent`（清理后） |

失败错误码（`error.code`）：

| 错误码 | 触发条件 | 用户可见动作 |
| :--- | :--- | :--- |
| `auth_required` | `kaggle quota` 返回认证失败 | "重新登录 Kaggle"按钮 |
| `cpu_fallback` | 内核日志含 `cuda available: false` 或 `No GPU detected` | "去完成手机验证"链接 |
| `quota_exhausted` | 配额解析为 0 或推送被拒 | 显示重置时间 |
| `tunnel_failed` | 超时未收到 ntfy 握手 | "重试启动" |
| `daemon_unreachable` | `/health` 连续失败 | "重建会话" |
| `kernel_error` | 内核状态 `ERROR`/`CANCELLED` | 展示日志尾部 |
| `cli_missing` | `kaggle` 不在 PATH | 给出安装命令 |

任务状态（`job.state`）：`queued` → `running` → `succeeded` / `failed` / `cancelled`。取消语义为"取消剩余"：已完成的图保留，未开始的丢弃。

---

## 5. 一次出图的时序

1. UI `POST /imagen-api/generate`，body 含 preset、prompt、negative、尺寸、步数、CFG、seed 列表。
2. `ImagenService` 校验参数（尺寸 256~1536、64 的整数倍；步数 1~100；CFG 0~30），生成 `jobId`，入队。
3. 队列空闲即取任务，若 `session.state` 非 `ready` 先触发启动（走 3a）。
4. `POST {endpoint}/generate`，携带 Bearer token。
5. 守护进程逐张产出，Host 每完成一张就更新 `job.progress` 并立即落盘该图。
6. 全部完成写入 `meta.json`，`job.state=succeeded`，UI 在下一次轮询时展示。

3a 启动分支：`provisioning` → `kaggle kernels push` → 轮询 `kaggle kernels status` 与 ntfy 主题 → 拿到 `endpoint_url` 写 `session.json` → 连续 3 次 `/health` 成功 → `ready`。

---

## 6. 并发与轮询

- 任务**串行**执行：单卡单守护进程下并行没有收益，只会让状态机复杂化。
- Client 轮询节奏：`ready`/`absent` 时 10 秒，`booting`/`busy` 时 2 秒；页面不可见时暂停。
- Host 侧对守护进程 `/health` 的心跳：`ready` 时每 30 秒一次，用于发现会话静默死亡。
- 所有超时与重试参数集中在 `lib/config.js`，可经 Config 覆盖（见 [PROVIDER-INTERFACE.md](PROVIDER-INTERFACE.md) 的 Config 段）。

---

## 7. 配置与凭据
- Config（明文，可热更）：`provider`、`defaultPreset`、`outputDir`、`idleTimeoutMin`、`useSecondGpu`、`pollIntervalMs`、`maxWaitMin`。
- 凭据：不落插件。Kaggle 侧的登录态由 `kaggle` CLI 管理；插件只保存"上次验证成功的时间戳 + 账号句柄"作为展示用缓存，失败即视为无效。
- 敏感值若将来出现（例如自建 ntfy 服务口令），一律走 `ctx.credentials`，不进 Config。

---

## 8. 路由鉴权边界（实施记录）

插件的 `/imagen-api/*` 路由注册在 `webServer` 的具名路由上，**不经过** `dsh web` 自身的访问令牌网关（未带令牌访问 `/` 会得到 401，而访问插件路由得到 200）。当前宿主只监听回环地址、单用户使用，风险可接受；若将来支持远程访问，插件必须自行校验来源与令牌。

---

## 9. 卸载与清理

- 插件卸载时：终止所有子进程、停止定时器、结束残留会话（尽力而为，失败只记日志）。
- 不删除用户产物目录；不删除插件数据目录中的历史日志。
- 会话未正常关闭时，下一次启动先尝试对残留 endpoint 发 `/shutdown`，再覆盖状态。
