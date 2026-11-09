# 系统设计 (DESIGN)

## 目标与边界

用 Kaggle 的免费 GPU 额度换取可长期驻留的文生图服务，接入 DSH 的设置页与对话模型。

不做的事：不在本机跑模型、不做多用户调度、不引入第三方图床——图片只落在当前工作区。

## 三端职责

| 端 | 位置 | 职责 |
| --- | --- | --- |
| Client | `client.js`（Web） | 参数输入、状态展示、图墙与历史；只访问 Host 的 `/imagen-api/*` |
| Host | `index.js` + `lib/`（Node） | 会话单例、任务串行队列、产物落盘、路由与 Agent 工具 |
| Daemon | `remote/daemon.py`（Kaggle 容器） | 加载模型、执行推理、暴露 `/health` `/generate` `/logs` `/shutdown` |

```
[ DSH 设置页 / 会话模型 ]
            │  /imagen-api/*
            ▼
[ Host (Node) ]
  ├── SessionManager  会话状态机 + 隧道轮询
  ├── JobQueue        串行出图队列
  ├── output          imagen-output/<时间戳>-<jobId>/
  └── kaggle CLI      kernels push / status / logs
            │  push
            ▼
[ Kaggle Kernel: daemon.py ]
  ├── 装依赖 → 加载模型 → phase=ready
  ├── cloudflared 暴露 127.0.0.1:7860
  ├── ntfy 上报公网地址
  └── Bearer 鉴权的 HTTP 服务
            ▲
            │  隧道就绪后 Host 直接调用
            └── 结果以 Base64 回传，Host 落盘
```

## 会话生命周期

```
absent ──start──▶ provisioning ──隧道就绪──▶ connecting ──health 可达──▶ warming ──模型加载完──▶ ready
   ▲                  │                          │                        │                    │
   │                  └──────────── error ◀──────┴────────────────────────┴────────────────────┘
   └────────────────────────── stop ─────────────────────────────────────────────────────────────┘
```

- 启动幂等：非 `absent`/`error` 状态重复调用 `session/start` 不会重复推送 Kernel。
- 排队与隧道各有独立超时（默认 45 分钟 / 15 分钟），超时进入 `error` 并附带 Kernel 日志尾段。
- `warming` 期间 `health.phase` 为 `installing` / `loading`，Host 据此给出"装依赖/加载模型"的可见进度。
- Kernel 若在就绪前变成 `COMPLETE` / `ERROR`，Host 拉一次日志并把原因写进 `session.error`。

## 任务队列与落盘

- 单并发：远端只有一张 GPU，并发提交只会互相排队并放大 OOM 概率。
- 提交时校验并钳制参数（尺寸取 8 的倍数、步数 1–60、CFG 0–20、张数 1–4），越界值直接修正而不是报错。
- 同一批多张图使用递增 seed（`seed + i`），保证可复现。
- 结果写入 `<workspace>/imagen-output/<YYYYMMDD-HHmmss>-<jobId>/`，每张图一个 PNG，另有 `meta.json` 记录完整参数与耗时。
- 历史接口按目录名倒序扫描，只读最近 N 个目录，避免大目录全量 IO。

## 隧道、鉴权与失败处理

1. **隧道**：容器内下载 `cloudflared`，用 `--url http://127.0.0.1:7860` 申请 `*.trycloudflare.com` 临时域名。
2. **会合点**：daemon 用 `Content-Type: text/plain` 向 `ntfy.sh/<随机 topic>` 发布一段 JSON。Host 轮询该 topic，校验域名形态后才采用。
3. **鉴权**：每次会话生成一次性 Token，注入 Kernel 脚本；Daemon 用常量时间比较校验。Token 只存在于 Host 内存与临时 Kernel 目录。
4. **失败分级**：`cli_missing` / `auth_required` / `push_failed` / `queue_timeout` / `tunnel_timeout` / `health_failed` / `remote_error`，前端与 Agent 都能读到具体原因。
5. **出站访问**：DSH 进程的 `fetch` 不读系统代理，`lib/net.js` 在失败时改用本机 `curl`，保证 ntfy 与会合点在代理环境下仍可用。

## 远端运行约束

- 镜像自带 `torchao 0.10.0` 与新版 `diffusers` 冲突，daemon 启动时先卸载再升级依赖。
- 权重下载按白名单只取 `fp16` 变体，避免整仓几十 GB 撑爆 20GB 工作目录。
- 4B 以上整管模型单卡放不下，必须 `device_map="balanced"` 走双卡（`--accelerator NvidiaTeslaT4` 提供 2×T4）。
- 空闲超时默认 30 分钟，`os._exit(0)` 直接结束进程以停止计费。

## 可测试性

- `devEndpoint` 配置项让 Host 直连本地 mock daemon，跳过 Kaggle 也能跑通全部路由与落盘。
- `test/host-e2e.mjs` 用假 Context 与 mock daemon 覆盖提交、钳制、落盘、历史、文件越界与三个 Agent 工具。
- `test/kaggle-live.mjs` 推送不占 GPU 的探针 Kernel，验证真实 push → 隧道 → 握手 → 生成 → 关机链路。
