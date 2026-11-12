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
  └── Kaggle CLI：负责推送代码、查询状态与拉取日志
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
