# 架构设计与避坑指南 (ARCHITECTURE)

本项目为 DSH Desktop（DeepSeek Harness）的文生图插件，其核心设计思想是：**借用 Kaggle 每周免费 30 小时的 GPU 算力作为远端推理后端，本地仅负责任务调度与图片落盘，无需在本地安装 PyTorch 或准备独立显卡。**

---

## 1. 整体架构与通信链路

系统由三个主要部分构成：

```
[ DSH 独立工作台 / 对话徽章 (Client) ]
                  │
                  ▼ HTTP (/imagen-api/*)
[ DSH 插件宿主进程 (Host / Node.js) ]
  ├── 会话状态机：管理远端 Kernel 推送与保活
  ├── 任务队列：单并发串行排队、参数校验钳制
  ├── 文件落盘：写入当前工作区 imagen-output/ 目录
  └── Kaggle 传输层：默认直连 Kaggle API，保留 CLI 作为兼容退路
                  │
                  ▼ kaggle kernels push
[ Kaggle 容器实例 (Remote / 2×Tesla T4) ]
  ├── 依赖准备：自动卸载冲突库、装载最新 diffusers
  ├── 常驻服务：remote/daemon.py 暴露推理与健康接口
  ├── 内网穿透：cloudflared 申请 *.trycloudflare.com 临时公网地址
  └── 隧道会合：通过公共 ntfy.sh 将临时域名回传给 Host
```

### 契约的唯一来源
路由、错误码、参数边界、超时与远端协议字段统一放在 [`shared/contract.js`](../shared/contract.js)；
模型预设（名称、默认参数、pipeline、实测指标）的唯一来源是 [`models/*.json`](../models/)，
由 `tools/build-assets.mjs` 生成 `shared/models.generated.js`，`contract.js` 只做 re-export。
Host 与 Web Client 直接 import，远端由 `lib/kernel.js` 把 `daemonContract()` 的返回值随注入配置下发。
修改契约后运行 `node test/check-contract.mjs`，它会校验 Host 路由注册、客户端错误码文案、daemon 版本、
模型资产生成文件与 `docs/SPEC.md` 是否跟随。
**接口的权威说明是 [`docs/SPEC.md`](SPEC.md)**（历史上引用过的 `docs/API.md` 从未存在，已废弃）。

### 为什么采用“ntfy 会合”而不是写死域名？
Kaggle 容器运行在受限沙箱中，无法直接对外暴露端口。常规方案是通过 Cloudflare Tunnel 随机生成临时公网二级域名（如 `https://random-subdomain.trycloudflare.com`）。
由于临时域名每次都在容器内随机产生，Daemon 启动后会立即向 `ntfy.sh/<随机Topic>` 发送一条包含该域名的握手消息；本地 Host 订阅该 Topic 拿到域名后，即可建立直接通信。

---

## 2. 核心机制与实机踩坑经验

以下是在真实 Kaggle 环境调优与跑通链路中沉淀的关键工程细节：

### 2.1 Kaggle 磁盘配额陷阱与权重拉取白名单
- **现象**：Kaggle Notebook 容器虽然声称有充足磁盘，但其实际工作目录 `/kaggle/working` 仅有 **20 GB** 额度，且整个容器写入层达到约 **52 GB** 后会直接转为只读（Read-Only），导致后续生图保存或临时文件写入时崩溃。
- **解法**：
  - 下载 HuggingFace 模型权重时，严禁整仓全量 Clone。
  - 在 `remote/daemon.py` 中配置严格的白名单，只按需下载 `fp16` 格式的单文件权重（例如 SDXL Base 只下载 6.6GB 的主权重），并将临时缓存重定向到具有更大空间的分区。

### 2.2 Kaggle 基础镜像的依赖冲突 (`torchao`)
- **现象**：Kaggle 官方镜像预装了 `torchao 0.10.0`，与新版 `diffusers` 和 `transformers` 存在严重的 C++ ABI 冲突，直接 `import diffusers` 会出现段错误或符号找不到而闪退。
- **解法**：Daemon 启动脚本在执行依赖升级前，先显式执行 `pip uninstall -y torchao`，再升级 `diffusers`、`accelerate`、`peft`。

### 2.3 Cloudflared 管道缓冲卡死（Pipe Buffer Deadlock）
- **现象**：在 Python 子进程中运行 `cloudflared` 时，如果仅在启动时读取前几行输出（提取公网 URL）随后不再读取，一旦 cloudflared 产生持续的网络心跳日志，操作系统的 `stderr` 管道缓冲区（通常 64KB）会被写满，导致子进程永久挂起。
- **解法**：拿到域名后，必须启动独立的守护线程持续对 `cloudflared.stderr` 进行 Drain（排空），防止管道阻塞。

### 2.4 ntfy 通信请求头细节
- **现象**：Kaggle 远端向 `ntfy.sh` 发布临时域名时，若请求头设置为 `Content-Type: application/json`，ntfy 会尝试将 Body 解构为其自身的调度参数，导致接口返回 HTTP 400。
- **解法**：向 ntfy 发布时必须指定 `Content-Type: text/plain`，将待传递的 JSON 字符串作为纯文本传输。

### 2.5 本地代理与网络降级 (`lib/net.js`)
- **现象**：很多国内开发者的系统环境配置了全局或局域网 HTTP 代理。而 DSH 宿主内部的 Node.js `fetch` 默认不遵从 Windows 系统的环境变量代理设置，导致无法解析 `ntfy.sh` 或访问 Cloudflare 临时域名。
- **解法**：`lib/net.js` 封装了自适应网络请求：优先使用内置 `fetch`，若遇到连接超时或网络受阻，无缝降级为调用系统的原生 `curl` 命令（自动继承系统网络代理）。
- **与 DSH subprocess 契约对齐**：降级用的 `ctx.subprocess.spawn` 请求是「完全明确」的——`argv` 每一项必须是字符串，`cwd` 必须是字符串（缺省会直接抛 `TypeError`）。调用方（如 `lib/remote.js`）可能把 `new URL(...)` 对象交给 `httpText`，所以 `viaCurl()` 内部会先把 URL 归一成字符串并显式传 `cwd`；回归用例见 `test/net-fallback.mjs`。

### 2.6 多卡分配与显存优化
- **现象**：单张 T4 的可用显存仅为 14.56 GiB。SDXL 尚能在单卡内稳定运行（占用 7~10.5 GB），但 4B 及以上参数的模型（如 FLUX.2-klein-4B）单卡直接加载必然 OOM。
- **解法**：
  - 推送 Kernel 时指定 `--accelerator NvidiaTeslaT4`（Kaggle 会分配 2 张 T4 显卡）。
  - 在加载大型模型时，通过 `device_map="balanced"` 将模型权重自动平摊到 2 块显卡中。

### 2.7 宿主日志开关
宿主对"吞掉但保持行为"的容错分支（轮询失败、代理降级、关机通知失败等）默认静默，避免桌面端噪音。
排障时设置环境变量 `OUR_FREE_IMAGEN_LOG=debug|info|warn|error` 后重启 DSH，即可在宿主控制台看到带 `[imagen:<scope>]` 前缀的事件流；
日志不会输出 token。实现见 `lib/log.js`，各模块用 `createLogger({ scope })` 获取实例。

### 2.8 会话本地持久化与启动恢复
Host 在启动流程的关键节点（构建 Kernel 目录后、push 成功后、拿到隧道地址、进入 ready）把会话记录写入
`<workspace>/.imagen/session.json`：包含 `kernelId`、Bearer `token`、ntfy `topic`、`endpointUrl`、预设与设备信息。
写入用「同目录临时文件 + rename」原子替换，目录 0700 / 文件 0600。下次启动时 `SessionManager.restore()`：

1. `/health` 探活成功 → 直接接管现有会话（ready 走健康轮询，warming 走会合轮询）；
2. 地址失效但 `topic` 存在 → 回 ntfy 会合点重新取隧道地址（远端会周期性重播 ready）；
3. Kernel 已结束 / 无地址线索 / 记录损坏 → best-effort 关机并删除记录。

记录里带 token，因此只落盘、不进日志与 `/state` 快照；`session/stop` 与成功的 `dispose` 会删除文件。
开发模式（`devEndpoint`）不读写该记录，避免把本地 mock 当成远端会话恢复。

### 2.9 隧道监管与备用通道
`remote/daemon.py` 用常驻线程 `tunnel_monitor()` 监管隧道子进程：cloudflared 中途退出时清空发布状态，
按 2→60 秒指数退避重拉；拿到新地址后重新向 ntfy 广播 ready，主循环每 300 秒再重播一次，
Host 心跳丢失后即可靠会合点重新发现新地址。`/health` 会带上 `tunnel_provider` / `tunnel_state` / `tunnel_restarts`。

cloudflared 二进制**固定版本并校验 SHA256**（0.8.1 起）：下载地址是
`.../releases/download/<固定 tag>/cloudflared-linux-amd64`，不再使用滚动的 `/latest/download/`。
流式下载到 `/tmp/cloudflared.part` 时边写边算校验和，超过 120 MB 立即中止；校验不匹配或下载异常
各重试一次（第二次仍失败则带「期望 / 实际」校验和报错，`start_tunnel` 收敛进 `BOOT.tunnel_error`）。
这样上游发版或网络只传半截文件都不会留下坏二进制，冷启动失败也有可读原因。
校验和是公开信息，日志可打印；token 仍然只来自注入配置、不落日志。

如果配置了 `fallbackTunnelCommand`，cloudflared 失败或超时后会按通道计划尝试备用命令（自建 FRP 等），
成功后 `provider=custom`。Host 侧只信任回环、`*.trycloudflare.com` 与 `trustedTunnelDomains` 白名单内的
https 地址，未登记的域名不会收到 Bearer token。

### 2.10 远端日志透传
daemon 维护最多 400 行日志环，`GET /logs?since=N` 返回增量行与下一游标。Host 的
`GET /imagen-api/logs?since=N` 原样透传（始终 HTTP 200，用 `ok` / `code` 表达可用性），
工作台的日志抽屉按游标轮询并把安装、隧道、生成三阶段输出展示给用户；诊断导出会剔除 token 类字段。

### 2.11 远端依赖安装策略（0.4.1）
Kaggle 镜像的包版本会随平台更新，插件里写死版本上限反而更容易把 pip 解析搞崩：
0.4.0 的 `transformers<5` 与 diffusers 新版要求的 `huggingface-hub>=1.32` 无法同时满足，
远端直接以 `pip install 退出码 1` 失败。当前策略：

1. 默认**不钉版本**，安装最新兼容组合；
2. 用户配置 `pipConstraints` 时带 `-c` 安装；解析失败自动去掉约束重试一次并留 WARN；
3. 安装失败时把 pip 输出尾部带进 `LoadError`，界面直接可见（Host 截断放宽到 700 字符）；
4. 装完用独立 Python 进程做 `import` 自检（含 `from diffusers import DiffusionPipeline`），
   把「装上了但 import 不了」提前暴露成 `load_failed`；
5. 不使用 venv：Kaggle 容器一次性、镜像自带 CUDA torch，venv 要么重装整套依赖、
   要么需要 bootstrap 后 re-exec daemon，收益低于复杂度。详见 `docs/TROUBLESHOOTING.md`。

### 2.12 出图轮询容错与幂等续接
远端异步 job 把长耗时都放进远端队列，但隧道重建期 `GET /job` 会成串失败。旧实现连续 6 次
失败（约 12~60 秒）就把任务判死，远端其实还在正常算图。现在的策略：

1. 按「连续失败持续时长」容忍（`TIMEOUTS.remoteJobPollFailureGraceMs`，默认 120 秒），
   失败重试走指数退避（上限 `remoteJobPollBackoffMaxMs`），不打满远端；
2. 窗口用尽后用**同一个宿主 `job.id`** 作为幂等键重新 `POST /generate` 接回原任务——
   daemon 的 `submit_job` 命中幂等键会返回原 job，不重复入队；
3. 重投最多 `TIMEOUTS.remoteJobResumeMaxAttempts`（默认 2）次：daemon 的 job 表保留窗口是
   `JOB_TTL_SEC=600s` / 最多 8 个已完成 job，超窗重投会**重新入队出图**，必须限次；
4. `404 unknown_job` 是明确终态，不重试也不重投；所有等待仍受单任务预算约束。

### 2.13 就绪后隧道重建的恢复窗口
`ready` 之后心跳丢失不能只看心跳：Kernel 还活着就不能杀会话（重新排队代价很高）。
`handleReadyHealthLoss` 先向 Kaggle 确认 Kernel 状态——已结束则收敛为 `session_ended` /
`remote_error`；仍 `RUNNING` 则清空地址回会合点重取一次，进入恢复期。

恢复期的单轮窗口是 `recoveryMs`（120 秒）。`checkKernelStatus` 在恢复期每确认一次 Kernel
仍 `RUNNING` 就给窗口续期一轮（`renewRecoveryWindow`），最多 `recoveryMaxRenewals`（10）轮，
即总兜底约 7 分钟；续期用尽仍恢复不了才 `health_failed`。续期轮数随 `start` / `stop` /
`restore` / 健康恢复重置。

注意 `reconnectMaxAttempts` 的语义：它限制的是「每个连续 ready 周期内允许几次重新会合」，
每次健康检查成功都会清零，不是会话生命周期内的总次数——真正的硬上限是上面的续期窗口。

### 2.14 卸载未关机的补清理
`dispose()` 必须立刻返回（DSH 退出 / 插件热重载不能被网络等待拖住），所以 `/shutdown` 只能 best-effort。
但如果这次通知没发出去或失败，Kaggle Kernel 会继续空转、白白消耗每周额度——这正是 0.8.1 补的缺口：

1. `dispose()` 先**同步**把最小连接信息写入 `<workspace>/.imagen/pending-cleanup.json`
   （`endpointUrl` / `token` / `kernelId` / `topic` / `presetId` / `attempts` / `savedAt`，原子写、
   目录 0700 / 文件 0600）。同步写是因为进程随后可能立刻退出，异步写来不及完成；
2. 再 best-effort 发 `/shutdown`：成功则清掉待清理记录与会话记录，失败则保留待清理记录；
3. 无论补发成败，只要责任已经移交下一次启动，就删除 `session.json`——用户明确是「退出」，
   下次启动不该让 `restore()` 去接手或长时间等会合；
4. 下次启动的 `index.js` 先 `cleanupPendingSession()` 补发一次关机，再执行 `restore()`；
   补发失败累加 `attempts` 等下次再试，超过 24 小时（Kernel 最长 3 小时）、补发满 5 次或地址不可信时
   丢弃记录并留 warn。token 只落盘，日志只记 `kernelId` / `attempts` / 原因。

相关离线断言见 `test/session-pending-cleanup.mjs` 与 `test/session-restore.mjs` 的 E2 组。

### 2.14.1 放弃排队的孤儿 Kernel 清理（0.12.0）
Kaggle 对「推送后一直 `QUEUED`」的 Kernel 没有取消 API（`CancelKernelSession` 需要批量 Kernel 拿不到的
`kernel_session_id`），而放弃排队后旧 Kernel 仍可能在之后被调度到并空转。0.12.0 用两道防线处理：

1. **Host 侧删除**：排队硬超时 / 隧道握手超时 / 排队中主动关机 / 「换新实例重排」都会调用
   `deleteKernel`（直连 `DeleteKernel`，CLI `kaggle kernels delete -y`）best-effort 删除旧 Kernel；
   已删除返回 403 时按「已不存在」成功处理。删除失败只记 warn，不影响新会话启动。
2. **远端自证无人接管**：daemon 新增 `claim_timeout_sec`（默认 600 秒）。启动后任何一个带正确 Bearer
   Token 的 Host 请求（`/health`、`/shutdown`、`/generate` 等）都会置位 claim 事件并取消看门狗；
   超时仍无人接管就自行退出，不再空转到 `idle_timeout_sec`（默认 1800 秒）才释放 GPU 配额。

### 2.15 工作台界面状态持久化
「表单高级设置是否展开」这类界面偏好存 `<workspace>/.imagen/ui-state.json`，通过
`GET/POST /imagen-api/ui-state` 读写（同一 path 只注册一条路由、按 method 分发，与运行设置同款）。

- 白名单字段与默认值来自契约 `UI_STATE.defaults`，Host 与 Client 共用；未知字段保存时直接丢弃，
  已登记字段类型不符返回 `400 invalid_request`；
- 文件不存在 / JSON 损坏 / 版本不符 / 超过 `UI_STATE.maxBytes`（64 KiB）一律回落默认值并顺手清理，
  绝不阻塞插件加载；
- 客户端挂载时读一次，失败静默按默认收起；切换时先改本地状态再 fire-and-forget 保存，
  保存失败不回滚、不提示——界面态丢失不影响出图。

相关离线断言见 `test/ui-state-host.mjs`（21 项）与客户端 `check-client-*` 的界面态用例。

### 2.16 Kaggle 访问方式：Node 直连与 CLI 兼容
`0.11.0` 起默认走 Node 直连（`lib/kaggle-direct.js`），可在「运行设置 → 高级 → Kaggle 访问方式」切回本机 `kaggle` CLI（`lib/kaggle.js`）作为兼容退路。直连直接调用 Kaggle 的 JSON API（`POST https://api.kaggle.com/v1/<service>.<Service>/<Method>`，
camelCase 报文，与 `kaggle` CLI 2.x 依赖的 `kagglesdk` 同协议），所有请求经 `lib/net.js` 的 `httpText`
（内置 fetch 失败自动降级系统 `curl`，继承系统代理），省去每次 CLI 调用 9~15 秒的 Python 冷启动，
Windows 上也不依赖 Python `Scripts` 目录进 PATH。

传输选择由 `lib/kaggle-transport.js` 在**每次调用**时按最新设置解析——工作台切换后，下一次操作或唤醒
即生效，不需要重载插件。它对 `SessionManager` 暴露的五个出口（`probeKaggle` / `kaggleUsername` /
`pushKernel` / `kernelStatus` / `kernelLogs`）与 CLI 实现返回同形状，会话状态机不感知底层传输差异。

直连的凭据解析顺序与 kagglesdk 一致：`KAGGLE_API_TOKEN` 环境变量 → `~/.kaggle/access_token` →
`~/.kaggle/credentials.json`（OAuth，`access_token` 到期用 `refresh_token` 调
`users.AccountApiService/GenerateAccessToken` 续期并原子回写 0600）→ `~/.kaggle/kaggle.json`（Basic Auth）。
401/403 统一归为鉴权失败（`auth_required`），网络错误归 `unknown`；token 只出现在请求头，
不进入日志、错误详情与对外快照。当前默认 `direct`；老用户升级时，`settings.json` 从 schema v1 迁到 v2 会把旧默认 `cli` 丢弃一次，之后手动切回 `cli` 会以 `schema=2` 保留。

### 2.17 内置 OAuth PKCE 登录
直连模式不要求安装 CLI，登录在宿主侧完成（`lib/kaggle-oauth.js`），协议与 `kaggle auth login` 对齐
（`kagglesdk` 0.1.38）：

1. 生成 PKCE 的 `code_verifier`（`token_urlsafe(64)` 等价物）与 `code_challenge`
   （`base64url(sha256(verifier))`，与 kagglesdk 一致保留 `=` 补位）以及随机 `state`；
2. 打开系统浏览器访问 `https://www.kaggle.com/api/v1/oauth2/authorize`（`client_id=kagglesdk`、
   `scope=resources.admin:*`、`response_type=code`、`code_challenge_method=S256`），
   同时在 `127.0.0.1` 的 8000~9000 随机端口监听回环回调；
3. 回调校验 `state` 后把 `code` 换 token（`security.OAuthService/ExchangeOAuthToken`），再用
   `security.OAuthService/IntrospectToken` 确认 `active` 并取用户名；
4. 写入 `~/.kaggle/credentials.json`（`refresh_token` / `access_token` / `access_token_expiration` /
   `username` / `scopes`，目录 0700、文件 0600、原子写），与 CLI 完全同格式——因此登录一次后，
   CLI 与直连两种传输都能读到同一份凭据；
5. 无法打开浏览器（无头 / 远程）时降级为 manual：把授权链接给用户复制到任意浏览器打开，再粘贴
   授权码完成兑换。

登录管理器是单实例状态机（`idle` / `pending` / `done` / `failed` / `cancelled`），支持取消与
`KAGGLE_LOGIN.timeoutMs` 超时；任何阶段的 token / 授权码都不写日志。`GET/POST /imagen-api/kaggle/login`
只暴露状态与（manual 模式下的）授权链接。

### 2.18 图生图与局部重绘（M3 / 0.12.0）
链路分三段，参考图与蒙版只在 Host 与远端内存里短暂存在，不进 `/state` 轮询：

1. **Host 入队校验**（`lib/jobs/`）：`reference` 支持 `path`（`imagen-output/` 内作品）或 `image`
   （base64，可带 data URL 前缀）二选一；入队前做词法校验（相对路径、拒绝 `..`/绝对路径）、
   base64/体积/PNG-JPEG 魔数校验与 `strength` 归一（按契约钳制并对齐 step，带蒙版时上限用
   `LIMITS.strength.inpaintMax`、否则用 `max`）。非法值立即 400，
   不占队列位置。`params.reference = { sourcePath, strength }` 进入公开视图，二进制只留在任务内部。
2. **Host 执行期**：`resolveReferencePayload()` 用 `resolveOutputPath` 校验并读取画廊文件（只允许
   `imagen-output/` 内、拒绝软链接逃逸），再校验体积与格式，base64 后作为 job 级
   `reference: { image_b64, strength }` 随每一次远端提交下发（逐张提交，一张参考图跑整批）。
   产物 `meta.json` 记录 `sourceImage` 与 `strength`。
3. **远端**（`remote/daemon.py`）：提交期 `parse_reference_spec()` 只读图片头部就收敛
   「loader 白名单（仅 `sdxl` / `sdxl-lora`）、base64、原始字节上限、PNG/JPEG、最小长边、strength」
   这些错误（400，不占 GPU）；执行期 `decode_reference_image()` 完整解码恰好一次，
   长边超过 `contract.limits.reference.maxEdge` 时等比 LANCZOS 缩小并转 RGB。
   真正的重绘管线用 `AutoPipelineForImage2Image.from_pipe(STATE.pipe)` 从**已加载的底座复用组件**
   惰性创建（`STATE.img2img_pipe`，切换模型或 `release_pipeline()` 时清空），因此不重复加载权重、
   不额外占显存；img2img 的 `__call__` 签名单独缓存。

**局部重绘（Inpaint，0.12.0）** 复用同一条链路，只多一个可选蒙版：

- 契约 `LIMITS.mask = { maxBytes: 2 MiB, minCoverage: 0.0005 }`，蒙版是客户端生成的 PNG base64
  （白 = 重绘区域、黑 = 保留区域），与 `reference` 一起提交；`reference.mask` 缺省时请求体与纯图生图
  逐字一致。`strength` 带蒙版时上限放宽到 `LIMITS.strength.inpaintMax`（1.0），img2img 仍用 `max`（0.9），
  Host 与 daemon 用同一口径（`lib/jobs/validator.js` / `reference_codec._coerce_strength`）。
- Host 只做词法与字节级预检（PNG 魔数、体积、无参考图时带蒙版直接拒绝），并把
  `reference: { image_b64, strength, mask_b64? }` 透传给远端；产物 `meta.json` 加 `inpaint: true`。
  出图路由的请求体上限按「参考图 + 蒙版」一起推导（`lib/routes/jobs.js`），否则两张图同时顶格时
  会在路由层被 `invalid_body` 拦掉。
- 远端 `ensure_inpaint_pipeline()` 用 `AutoPipelineForInpainting.from_pipe(STATE.pipe)` 惰性创建
  （`STATE.inpaint_pipe`，与 img2img 一样随切模型 / `release_pipeline()` 清空）；`decode_mask_image()`
  执行期完整解码一次、转灰度 `'L'`、用最近邻对齐到参考图精确宽高，并统计白色（重绘）覆盖率：
  低于 `contract.limits.mask.minCoverage` 的空蒙版在加载模型前以 `invalid_request` 失败（全白允许）。
  `feather_mask_image()` 按覆盖率自适应羽化半径（< 0.5% → 2px，< 5% → 4px，更大按短边 0.8% 钳在
  6~8px），出图后再用同一张羽化蒙版做像素级合成。`run_task()` 走 `image` + `mask_image` + `strength`
  分支，并显式下传按 8 对齐的参考图宽高（`w // 8 * 8`、`h // 8 * 8`）——非正方形参考图不再被管线的
  缺省方形推理后拉回；管线不支持该参数时由 `__call__` 签名过滤丢弃，composite 仍是尺寸不一致时的兜底。
- 能力声明：模型资产 `supportsInpaint`（首期仅 SDXL 家族 true，且必须同时 `supportsImg2Img`），
  daemon 侧由 loader 白名单 `SUPPORTED_INPAINT_LOADERS` 独立兜底，不信任客户端标记。
- **专用 inpaint 权重（0.12.0）**：`models/sdxl-inpaint.json` 用 `pipeline.nativeInpaint: true` +
  `inpaintOnly: true` 声明「加载出来就是 9 通道 inpaint 管线」。`SdxlLoader.construct` 在
  `nativeInpaint` 时改用 `AutoPipelineForInpainting.from_pretrained` 加载；`ensure_pipeline()` 把该标记
  写进 `STATE.native_inpaint`，`ensure_inpaint_pipeline()` 遇到它直接复用 `STATE.pipe`（不再 `from_pipe`）。
  这类底座不能文生图 / 纯图生图：Host 入队前拒绝、daemon 提交期 `parse_reference_spec` 与执行期
  `run_task` 各兜一层；客户端 `inpaintOnlyOf()` 据此在缺蒙版时拦下生成并提示。

模型能力由 `models/*.json` 的 `supportsImg2Img` / `supportsInpaint` 标记（首期仅 SDXL 家族为 true），
经生成资产下发到客户端用于置灰与提示；daemon 不信任该标记，按 loader 白名单独立兜底。请求体上限方面：
daemon 与 Host 出图路由都按 `reference.maxBytes + mask.maxBytes` 推导（base64 膨胀后约 13.5 MB），
其余路由仍是 256 KiB。

### 2.19 模型知识单一来源（`shared/models-guide.js`）
`models/*.json` 是模型事实的唯一来源，但「这些事实怎么变成提示词要求、负向词能力判断与用法摘要」过去散落在多处：
`lib/intent.js` 手写 `promptStyle` 分支，`lib/enhance.js` 维护过时的 `FAST_PRESETS` 名单，`lib/tools.js` 的
工具描述只列预设 id，客户端再各自判断负向词是否生效。新增一款模型要改多处，容易漏。

0.10.0 起把这层口径收进 `shared/models-guide.js`（纯函数，只 import `shared/contract.js`，不写死模型清单）：

| 函数 | 职责 |
| :--- | :--- |
| `promptStyleName(style)` | 提示词配方的展示名（Danbooru 标签 / 自然语言 / 简短短语） |
| `promptStyleRule(preset)` | 当前模型的英文提示词书写规则（中文句，直接进 system prompt） |
| `negativePromptActive(preset, cfg)` | 当前配置下负向词是否生效，Host 与 Client 共用 |
| `negativeGuidance(preset, cfg)` | 给大模型的负向词一句话指导（无能力时要求用正面描述表达排除意图） |
| `modelUsageLine(preset)` / `modelCatalogText()` | 单模型 / 全库用法摘要（写法、步数、CFG、负向词、垫图、耗时、定位） |

消费方：

- Host 助手层：`lib/intent.js` 拼系统提示词并约束 `negative`，`lib/enhance.js` 选润色口径，`lib/tools.js` 生成 `imagen_generate` 的模型说明；
- 客户端：`src/logic/preset.js` 等按 `negativePromptActive()` 决定「排除项」显隐与提交时是否携带；
- 测试：直接断言规则本身，不重复抄一份模型事实。

因此新增 / 调整模型只改 `models/<id>.json` 并重建生成资产，助手与界面的模型知识自动跟随。

### 2.20 创作助手的提示词结构与多轮通道
助手层（`lib/intent.js`）的系统提示词按三段组织，模型事实与沟通策略分离：

1. **身份与使命**：面向新手创作者的图像生成导演 / 提示词顾问，用最小沟通成本把中文想法变成高出图质量的英文提示词；
2. **模型手册**：当前模型 + 全库概要（来自 `models-guide.js`），写明提示词写法、质量词、负向词能力、垫图能力、速度与专长；明显更合适时允许给模型建议，但不硬拦；
3. **组织与沟通策略**（软性引导，不做硬分支）：主体、场景、光线、视角、材质拆解得具体可感；区分「延续上一轮修改」与「全新主题」；无负向能力时用正面描述表达排除意图（不要把 `no xxx` 写进正向提示词）；信息不足时给轻度澄清，足够明确时直接给参数。

意图接口 `POST /imagen-api/intent` 的 JSON 同步升级到 v2（字段与边界以 `shared/contract.js` 的 `INTENT` 与 `docs/SPEC.md` 为准）：
`prompt` / `summary` / `ratioId` / `negative` / `clarify`（一个问题 + 2~4 个选项）/ `modelHint`（建议模型 + 短理由）。
澄清不再绑死比例 / 风格枚举，澄清轮也要给出草稿 `prompt`；`negative` 在当前配置下不生效时必须为空串。

多轮上下文由 `lib/llm.js` 的 `options.messages` 承载：元素为 `{ role, content }`，`content` 允许字符串或内容块数组
`[{ type: 'text', text }]`（为后续多模态预留），`options.prompt` 保留为单轮快捷方式；`prepareCall` 优先、`stream` 兜底、
超时与空串降级的行为不变。请求侧 `history` 是可选数组：客户端只回传最近若干条消息，Host 再按 `LIMITS.intentHistory`
裁剪（条数、单条长度、`user` / `assistant` 角色白名单），非法项直接丢弃；`history` 非空时优先于旧的 `previousPrompt`。

### 2.21 插件自身版本检查（0.12.0）
只在「npm 上有没有更新版本」这一个问题上做检查，和云端会话版本无关：

1. **检查链路**（`lib/update-check.js`）：Host 只读请求 `<registry>/dsh-our-imagen/latest`，先 npmjs、失败回退 npmmirror，单次 4 秒超时；成功结果（版本号 + `engines.dsh` 要求）原子写入 `<workspace>/.imagen/update-check.json`，24 小时有效。插件启动约 5 秒后首次检查，之后按 TTL 复查；全部失败静默保留上一次成功结果，只记 debug/警告日志。
2. **提示**：`GET /state` 下发 `update` 快照（`current` / `latest` / `hasUpdate` / `releaseUrl` / `enginesDsh` / `checkedAt` / `stale` / `error`）；客户端 `src/logic/update.js` 只在 `hasUpdate=true` 时派生提示，顶栏算力胶囊显示红点、算力弹层给出版本对比、`engines.dsh` 要求与 Release 说明链接。**不下载、不安装、不阻断出图**。
3. **开关**：开发模式（`devEndpoint`）或插件配置 `updateCheck: false` 时不发起任何请求（离线测试同样走这个开关）。`package.json` 的 `engines.dsh` 供 DSH 插件管理在安装 / 更新时校验运行版本。

比较口径是主版本号三段（`shared/version.js` 纯函数）：只在远端版本更高时提示，同版本 / 更旧 / 不可解析都不提示；不引入 semver 依赖。

### 2.22 Agent 批量创作与透明风格配方（0.12.0）
免费算力不按张数计费，所以「一句话规划一组图」比单张重复调用更划算；同时 0.10.0 已删除静态风格后缀，
风格知识必须以**可见模板**的形式交给模型，而不是在服务端偷偷拼接。

- **`imagen_batch`（`lib/tools.js`）**：公共参数（预设、宽高、步数、CFG）对整批生效，`items` 每项只描述
  本条的画面（`prompt` 必填，可选 `negativePrompt` / `seed` / `saveTo`），单次 1~`LIMITS.batch.maxItems`（8）条。
  每条独立走 `queue.submit`，因此参数钳制、`saveTo` 交付校验（含软链接逃逸）与队列上限全部复用同一条入口；
  单条失败只影响该条。`waitSeconds` 是**整批共享的总等待预算**：按提交顺序串行等待，预算用尽即停止等待，
  但不取消任务，返回未完成任务的 `jobId` 供 `imagen_history` 轮询。
- **`imagen_recipes`（`shared/recipes.js`）**：配方是纯数据 + 纯函数检索，每条给出 `tags`、适配预设、
  推荐比例、按 `promptStyle`（danbooru / natural / concise）分键的 `promptTemplate` 与推荐负向词，
  用 `{subject}` 作为唯一占位符。工具只读、只返回文本，由模型显式改写进 `prompt`；无匹配时返回
  可执行的替代检索建议（换关键词 / 换分类 / 换预设）。
- **契约与测试**：条数上限进 `LIMITS.batch`；`test/agent-batch.mjs` 用假 `queue` / `ctx.tools` 覆盖
  上限拒绝、失败隔离、总预算、`saveTo` 逐项校验与配方检索过滤，不依赖网络与 GPU。

---

## 3. 本地脱机调试技巧（不烧 Kaggle 额度）

为了在开发 DSH 插件前端界面与路由时无需每次等待 10 分钟 Kaggle GPU 排队，项目内置了本地 Mock 机制：

1. **启动本地 Mock Daemon**：
   ```powershell
   python test/mock-daemon.py --port 17860 --token dev-token
   ```
   Mock Daemon 会模拟真实的握手与生图协议（生成带有随机噪点的占位图片），且完全不需要本地安装 PyTorch。

2. **为 DSH 注入调试环境变量**：
   ```powershell
   $env:OUR_FREE_IMAGEN_ENDPOINT = "http://127.0.0.1:17860"
   $env:OUR_FREE_IMAGEN_TOKEN = "dev-token"
   ```

3. **重启 DSH Desktop**：
   插件会直接识别为 `ready` 状态，所有界面交互、任务队列、图片落盘、图墙与历史回放功能均可实现秒级联调。

---

## 4. 故障诊断速查

| 现象 | 排查命令与检查点 |
| :--- | :--- |
| **Kaggle 排队超时** | 查看手机验证状态：未绑手机号会被 Kaggle 平台丢入极低优先级队列或降级 CPU。<br/>`kaggle kernels status <kernelId>` 确认云端实际状态。 |
| **容器直接报错退出** | 运行 `kaggle kernels logs <kernelId>` 查看尾部堆栈，重点检查依赖下载是否超时或磁盘写满。 |
| **隧道一直连不上** | 检查本地能否访问 `ntfy.sh`；在浏览器中直接打开 `trycloudflare.com` 地址确认是否被本地网络策略阻断。 |
| **修改插件后 DSH 报 404** | 运行 `node test/verify-loaded.mjs` 确认插件 bundle 是否被 DSH 正确加载，检查注入模块声明。 |
