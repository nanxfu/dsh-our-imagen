# Google Colab 后端接入调研与技术方案（路线 2：Node.js 直连）

> 状态：调研与方案设计（尚未进入编码阶段）  
> 目标：为 `our-free-imagen` 新增 **Google Colab（重点适配 Colab Pro）** 无头计算后端，采用与 [`lib/kaggle-direct.js`](../lib/kaggle-direct.js) 相同的 **纯 Node.js 原生直连控制面 API** 路线，零本机 Python/CLI 依赖，最终交付给开发实现。

---

## 1. 核心调研结论

1. **Colab 已支持官方 Headless 控制面**：  
   Google 官方开源了 [`googlecolab/google-colab-cli`](https://github.com/googlecolab/google-colab-cli)，其底层与 VS Code Colab 扩展共用 `colab.research.google.com/tun/m/*` 与 `colab.pa.googleapis.com` 控制面接口。社区项目 [`incredible404-rgb/colab-gpu-llm-service`](https://github.com/incredible404-rgb/colab-gpu-llm-service) 和 [`incredible404-rgb/Colab-yoga`](https://github.com/incredible404-rgb/Colab-yoga) 已在生产环境验证了 **无头申请 GPU、30s 心跳保活、CCU 余额查询、闲置自动释放** 的完整闭环。
2. **与现有架构高度契合**：  
   [`remote/`](../remote/) 推理服务本身已是平台无关的 Python HTTP Daemon；本地只需将 [`lib/session.js`](../lib/session.js) 中与 Kaggle 耦合的生命周期管理抽离为 Provider 抽象，即可在不改动任务队列、出图协议和前端 Studio 主逻辑的前提下接入 Colab。
3. **Colab Pro 的核心优势与差异**：
   - 支持指定高阶加速器（`T4` / `L4` / `A100` / `H100` / `G4` 等）及 `HIGH_RAM` 规格，单卡显存充足（如 L4 24GB、A100 40GB/80GB），不再受限于 Kaggle 的双 T4 分片或 20GB 工作区写满变只读陷阱。
   - **但 Colab 的保活机制与 Kaggle 完全不同**：仅靠后台常驻进程或 HTTP 流量会被平台在 **21–35 分钟** 内回收，必须周期性通过 Jupyter Kernel WebSocket 发送短执行心跳。

---

## 2. 控制面协议清单（对照 `google-colab-cli` 源码）

协议依据：`googlecolab/google-colab-cli` 源码（`src/colab_cli/oauth_config.json`、`auth.py`、`client.py`、`runtime.py`、`commands/ssh.py`）及 `colab-gpu-llm-service`（`scripts/colab_keepalive.py`）。

### 2.1 OAuth 2.0 认证

- **Client 配置**（来自 `oauth_config.json`）：
  - `client_id`: `764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com`
  - `client_secret`: `d-FL95Q19q7MQmFpd7hHD0Ty`
  - `auth_uri`: `https://accounts.google.com/o/oauth2/auth`
  - `token_uri`: `https://oauth2.googleapis.com/token`
- **授权回调方式**（2026-11-17 实测更正）：
  - `google-colab-cli` 源码使用远程粘贴码落地页 `https://sdk.cloud.google.com/applicationdefaultauthcode.html`（配合 `token_usage=remote`），但**该 redirect 当前已被 Google 拒绝**：同一 `client_id` 请求会直接返回 `Error 400: redirect_uri_mismatch`，且不影响登录页渲染，报错发生在授权页。
  - 同一 `client_id` 的 `http://localhost:<任意端口>` 仍然有效（实测 `localhost:8765` + `openid/userinfo.profile/userinfo.email/colaboratory` 组合可正常进入登录页）。
  - **结论：Node.js 端直接复用 `lib/kaggle/oauth/callback-server.js` 的本地回环回调即可，粘贴码流程仅作为无头环境的兜底**（且需要另寻可用的 redirect_uri，官方 CLI 那个已不可用）。
- **Scopes**（`auth.py`）：
  - `PUBLIC_SCOPES` 包含 `openid`、`https://www.googleapis.com/auth/userinfo.profile`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/colaboratory`（以及可选 Drive scope，若后续需要挂载 Google Drive 缓存权重）。
- **Token 持久化**：
  - 复用现有安全规范，将 `refresh_token` / `access_token` 原子落盘至用户目录/工作区受保护文件（`0700`/`0600`），不进日志、不进快照。

### 2.2 Runtime 生命周期 API（`https://colab.research.google.com/tun/m`）

> 注意：Colab 控制面响应体带有 XSSI 前缀 `)]}'\n`，解析 JSON 前必须剥离；所有请求走 [`lib/net.js`](../lib/net.js) 的 `httpText`（自动兼容本地代理/curl 降级）。

| 能力 | HTTP 方法与路径 | 说明 |
| :--- | :--- | :--- |
| 查询 CCU 余额与消耗速率 | `GET /tun/m/ccu-info` | 返回账户级 Compute Units 余额与计费速率 |
| 列出当前活跃实例 | `GET /tun/m/assignments` | 返回 `assignments[]`，含 `endpoint`、`accelerator`、`machineShape`、`runtimeProxyInfo`（`url` + `token` + `tokenExpiresInSeconds`） |
| 申请 / 接管实例 | `GET /tun/m/assign` → `POST /tun/m/assign` | 参数：`nbh`（WebSafe Base64 编码的 UUID）、`variant=GPU`、`accelerator`（`T4`/`L4`/`A100` 等）、`shape=hm`（可选 High-RAM，L4 等仅高配机型不传）。`GET` 返回 XSRF token（放入 `X-Goog-Colab-Token` 头）后再 `POST`；`412` 表示实例数超限 |
| 释放实例（关机） | `GET /tun/m/unassign/{endpoint}` → `POST /tun/m/unassign/{endpoint}` | 先 `GET` 取 XSRF token，再带 `X-Goog-Colab-Token` 发 `POST` |
| TFE 保活 Ping | `GET /tun/m/{endpoint}/keep-alive/` | 请求头带 `X-Colab-Tunnel: Google`；`ReadTimeout` 视为成功（TFE 已刷新活跃时间），连续 2 次 `4xx` 判定实例已失效 |

### 2.3 远端代码投递与真正有效的保活机制

1. **文件上传与命令执行**：
   - 通过 `runtimeProxyInfo.url`（携带请求头 `X-Colab-Runtime-Proxy-Token: <token>`）访问容器内的 **Jupyter Contents API**（上传打包后的 `remote/` 与配置）和 **Jupyter Kernel WebSocket**（执行启动脚本）。
   - `runtimeProxyInfo.token` 有效期约 **1 小时**，Host 心跳循环需定期调用 `GET /tun/m/assignments` 刷新。
2. **为什么必须用 Kernel WebSocket 心跳**（源自 `colab_keepalive.py` 实测结论）：
   - 仅靠 `GET /tun/m/{endpoint}/keep-alive/`、推理 HTTP 流量或单个长运行 Cell，**无法阻止 Colab 在 21–35 分钟后回收 CLI Runtime**；旧的 `RuntimeService KeepAliveAssignment` RPC 现已返回 `403 USER_PROJECT_DENIED`。
   - **有效解法**：本地 Host 每 **30 秒** 通过 Jupyter Kernel WebSocket 发送一次极轻量的 `execute_request`（如写入 `/content/.keepalive_beat` 时间戳），并配合每 **60 秒** 一次的 TFE keep-alive ping。

---

## 3. 核心问题探索：Colab 后端需不需要网络隧道？

从第一性原理对比 **3 种数据面通信方式**：

| 方案 | 原理 | 优点 | 缺点 / 风险 | 结论 |
| :--- | :--- | :--- | :--- | :--- |
| **A. 复用 `cloudflared`（去掉 `ntfy`）** | 容器内启动 `cloudflared` 暴露 `remote/` HTTP 服务，但**不再通过 `ntfy.sh` 广播**，而是直接由远端写入 `/content/.imagen_endpoint.json` 或在 Jupyter `execute_request` 输出中回传给 Host | 1. 100% 复用现有 [`remote/infra/tunnel.py`](../remote/infra/tunnel.py) 和 [`lib/remote.js`](../lib/remote.js)<br>2. 标准 HTTPS 短连接，大图片传输、超时重试、本地代理降级全部现成<br>3. 去掉了 `ntfy.sh` 公共频道依赖，会合更快更私密 | 容器内需下载一次 `cloudflared` 二进制（约数十 MB，耗时几秒）；偶发隧道断线需重连 | **推荐作为默认主力方案** |
| **B. 走 Colab Runtime Proxy 直连** | 尝试通过 `runtimeProxyInfo.url`（如 Jupyter `/proxy/<port>/`）转发 HTTP | 理论上零第三方隧道 | 1. `google-colab-cli` 本身未走通用 HTTP 端口代理，需实测 Colab 网关是否开放任意端口转发及是否有请求体大小/超时限制<br>2. Proxy Token 每小时过期，[`lib/remote.js`](../lib/remote.js) 需改造鉴权头刷新 | **列为试验 3 候选**，实测可用后再考虑作为无隧道选项 |
| **C. SSH 端口转发（`/colab/ssh`）** | 复用 `colab ssh -L` 的 WebSocket-to-SSH 隧道 | 私密、不依赖 Cloudflare | 需要在纯 Node.js 里实现 SSH over WebSocket 客户端或强制本机依赖 OpenSSH + Ed25519 密钥，违背路线 2 零外部依赖初衷 | **不推荐** |

**结论**：短期先采用 **方案 A（保留 `cloudflared`，移除对 `ntfy` 的依赖）**，工程确定性最高、改动最小；同时在试验阶段顺便验证 **方案 B** 的可行性。

---

## 4. 架构改造蓝图（面向后续代码专员）

为避免破坏现有 Kaggle 稳定性，建议按以下边界拆分重构：

1. **抽象远端算力 Provider 接口（`lib/providers/`）**：
   - 将 [`lib/session.js`](../lib/session.js) 中直接调用的 `pushKernel` / `kernelStatus` / `kernelLogs` / `kaggleUsername` 抽离为统一的 `ComputeProvider` 契约：
     - `authenticate()` / `probe()`（含配额/CCU 余额查询）
     - `provision(config)`（申请实例 + 投递并启动 `remote/`）
     - `pollEndpoint()`（获取/刷新推理 HTTP 地址，Kaggle 走 `ntfy`，Colab 直接读 Jupyter 执行输出或文件）
     - `keepAlive()`（Colab 专属：30s Kernel WS 心跳 + 60s TFE ping + Proxy Token 刷新）
     - `getStatus()` / `getLogs()` / `teardown()`（释放实例）
   - 现有 Kaggle 逻辑收敛为 `KaggleProvider`，行为 100% 保持不变。
2. **新增 `ColabProvider`（纯 Node.js）**：
   - `lib/colab/oauth.js`：Google OAuth 2.0 授权、token 刷新与原子存储。
   - `lib/colab/client.js`：`colab.research.google.com/tun/m/*` 控制面客户端（XSSI 剥离、`assign`/`unassign`/`assignments`/`ccu-info`/`keep-alive`）。
   - `lib/colab/jupyter.js`：基于 `runtimeProxyInfo` 的轻量 Jupyter Contents 上传（使用 Node 原生 `fetch` / `lib/net.js`）与 Kernel WebSocket 客户端（Node 22 原生 `WebSocket` 或轻量 `ws`，用于启动 daemon 与 30s 心跳）。
3. **适配 `remote/` 容器环境**：
   - 排查 `remote/` 中硬编码 `/kaggle/working`、`/kaggle/input` 及 `torchao` 卸载等 Kaggle 专属假设，抽象为环境变量/配置驱动的工作目录（Colab 默认 `/content`）。
   - 针对 Colab Pro 单卡大显存（L4 24GB / A100 40GB）与 T4 15GB 做设备探测适配，不再假设双卡 `device_map="balanced"`。
4. **契约与 UI 扩展（[`shared/contract.js`](../shared/contract.js)）**：
   - 设置项新增后端选择（`provider: 'kaggle' | 'colab'`）、Colab GPU 型号（`T4` / `L4` / `A100` 等）与 `highRam` 开关。
   - 状态栏/会话条支持展示 Colab CCU 余额与消耗速率，确保闲置超时后能可靠触发 `unassign` 防止白烧算力。

---

## 5. 试验验证计划（编码前必做）

在交给代码专员正式实现前，建议通过 **3 个独立最小 Node.js 探针脚本** 在真机环境验证关键假设：

1. **试验 1：OAuth 与控制面闭环**
   - 验证上述 `client_id` 在本机使用 `http://localhost` 回调是否会被 Google 拦截；
   - 验证当前 Colab Pro 账号调用 `ccu-info`、`assign(accelerator='L4')`、`assignments`、`unassign` 的真实返回结构。
2. **试验 2：Jupyter 文件投递、Daemon 启动与保活**
   - 通过 `runtimeProxyInfo` 上传最小脚本并经 Kernel WebSocket 启动；
   - 验证 `cloudflared` 在 Colab 容器内启动耗时、拿到 URL 回传本机耗时，以及 **30s WS 心跳** 能否稳过 35 分钟不回收。
3. **试验 3：Colab Runtime Proxy 能否直连替代 `cloudflared`（探索项）**
   - 容器内起一个测试 HTTP 服务（如 `:8000/health`），测试通过 `runtimeProxyInfo.url` 代理路径直接访问的连通性、大文件（PNG）传输表现与 Token 刷新行为。

---

## 6. M0 实测结果（2026-11-17，Colab Pro 账号）

探针脚本：`tools/colab/probe-auth.mjs`、`probe-runtime.mjs`、`probe-proxy.mjs`（开发期工具，不进 npm 包）。

**认证与授权**

- 官方 CLI 的远端落地页 redirect 已被 Google 拒绝（`Error 400: redirect_uri_mismatch`）；同一 `client_id` 的 `http://localhost:<port>` 正常，回环回调可用。
- 授权范围只需 `openid` + `userinfo.profile` + `userinfo.email` + `colaboratory`，未申请 `cloud-platform` 与 `drive.file` 也能调通控制面。

**控制面**

- 账号权益：`eligibleGpus = [G4, A100, L4, T4]`，`H100` 不在名单；CCU 初始 199.76。
- `assign(L4)` 从 `POST` 到拿到 `endpoint` 仅 **3.2~4.1 秒**，无需排队；返回 `endpoint` 形如 `gpu-l4-s-ass....`，`runtimeProxyInfo.url` 形如 `https://8080-<endpoint>-<zone>.prod.r.colab.dev`，令牌 TTL 3600 秒。
- `unassign` 正常释放，`ccu-info.assignmentsCount` 归零。

**运行时**

- Contents API（base64 单块上传）可用；Kernel 可直接 `POST /api/kernels` 创建，无需 notebook 文件。
- Kernel WS 可用 Node 22 原生 `WebSocket`，令牌放 query 即可，无需自定义头；**刚创建 Kernel 后首次连接可能被拒（`Connection was closed before it was established`），退避重试 2~3 次即恢复**。
- 容器环境：Python 3.13.16、torch 2.14.1+cu130、单卡 **NVIDIA L4**、`cwd=/`、`/`、`/content`、`/tmp` 同为 236 GiB overlay 且可写，`/content/drive` 未挂载，未预设 `HF_HOME`。

**保活（关键结论）**

- 30 秒一次 WS 心跳 + 60 秒一次 TFE ping，**连续 40 分钟 80 次心跳零失败、零重连**，实例始终在 `assignments` 中，Kernel 与容器服务均存活；21~35 分钟回收线未出现。
- 第 20 分钟按计划重新拉 `assignments` 刷新代理令牌成功（TTL 3600s），长会话可无缝续期。

**数据面（方案 B 判定）**

- 同一实例下 `/api/contents` 返回 200，但端口 8000 的四种转发路径全部未命中：`/proxy/8000/` 与端口前缀子域名 20 秒无响应，`/8000/` 与 `/colab/proxy/8000/` 直接 404。
- **结论：B 不成立，数据面按方案 A（容器内 cloudflared）实现。**

**成本**

- 整个 M0（约 43 分钟 L4 + 4 次短程实例）共消耗 **1.31 CU**，折算约 **1.83 CU/h**；200 CU 可支撑约 100 小时 L4 调试与验收。

**对 M1 的直接影响**

1. Kernel WS 客户端用原生 `WebSocket` + 3 次退避重试即可，不需要 `ws` 依赖；
2. 工作目录用 `/content`（与 `/` 同一文件系统，但语义更贴近"用户盘"），`disk_usage_root()` 的回退逻辑可直接复用；
3. 单卡设备，Flux.2 的 `device_map="balanced"` 需按卡数切换（1 卡时不走 balanced）；
4. 保活本身不复杂，风险集中在 WS 断线重连与令牌刷新，二者都已有可复用的重试/刷新路径。

---

## 7. 2a 真机验收（ColabProvider 接入 SessionManager）

脚本：`tools/colab/smoke-provider.mjs`（`node tools/colab/smoke-provider.mjs --gpu L4`）。

- **首个可出图会话 88 秒就绪**：assign 3.2s → 上传单文件启动器 → 建 Kernel → 起 daemon → 读 `/content/.imagen_endpoint.json` 约 16s，随后装依赖 + 加载模型 39s（权重已在 HF 缓存时更快）。
- 环境：Python 3.13.16 / torch 2.14.1，daemon 启动日志无 traceback；单卡 L4 与 SDXL 管线均被正确识别。
- **出图**：sdxl-lightning 4 步，1.07 MB PNG，端到端 18.7s（含 1.46 MB 结果回传）。
- **释放**：`stop()` 后 `unassign` 生效，`assignments` 清空、CCU 活跃实例归零；单次验收消耗约 0.06 CU。
- 远端改动：`remote/config.py` 新增 `work_dir`（Colab 切到 `/content`）与 `endpoint_file`（ready/error 事件原子落盘）；`ntfy_topic` 为空时只跳过发布，不报错。

**新发现：大响应会踩轮询超时**

- 1.46 MB 的 base64 结果经 Cloudflare 隧道下行约 **13 秒**，而默认 `/job` 轮询超时是 8 秒——表现为"服务端每次都回 200、Host 侧每次都超时"，最终触发 120 秒连续失败容忍窗。
- 处理：provider 声明 `jobRequestTimeoutMs`（Colab 30s，Kaggle 仍 8s），任务队列按 provider 取值。后续若结果继续变大，应考虑独立的二进制取图端点，而不是把 base64 塞进轮询响应。

**2b 收尾**

- 契约与设置：`provider` / `colabGpu` / `colabHighRam` 已接入设置抽屉、Host 校验与 `mergeSettings`；`index.js` 按设置装配 provider。
- 恢复：Colab 会话记录带 `provider` 与 `handle`，启动时按 assignment 重新接管；实例已消失则 `unassign` 兜底并清记录。
- 单卡：Flux.2 在 `device_count === 1` 时不再传 `device_map`；CPU 容器提示改为双平台文案。
- 真机（设置链路）：L4 + sdxl-lightning，出图 1071 KiB / 18.6s，stop 后 assignments 归零、余额 198.11。

**Flux.2 结论更正（2026-11-18）**

- 此前记录的"Flux.2 1024² 超过 600 秒"并非 L4 性能问题：`Flux2Loader` 在 `device_count == 1` 跳过 `device_map` 后没有把模型搬到 GPU，权重留在 CPU 上推理；`4087ba4` 让 generator 跟随 `_execution_device`（此时是 cpu）只是掩盖了报错。
- 修正为单卡显式 `pipe.to("cuda")` 后，FLUX.2-klein-4B 在 L4 上 **1024² 出图 1429 KiB / 26.6 秒**，`/health` 设备为 `NVIDIA L4`，日志无 traceback。
- 同一次实例上完成重启接管验收：模拟 Host 崩溃后新建 `SessionManager.restore()`，状态从 `connecting` 收敛到 `ready`，`providerUsage = { balance: 197.65, rate: 1.94, assignments: 1 }` 可见；`stop()` 后 `assignments` 归零。
