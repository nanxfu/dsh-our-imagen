# 生图工作台深度评估、稳定性分析与后续改造方案

> **沉淀日期**：2026-11-13  
> **适用基线**：`v0.7.0`  
> **文档目的**：完整记录针对当前生图工作台的体验排查、99.999% 可用性架构评估、个人服务器中转可行性复盘，以及后续 P0 / P1 / P2 改造路线，作为下一阶段迭代的统一输入。  
> **评审修订**：2026-11-13 已按代码逐条核对，第 5 节列出事实性修正、与既有设计文档的冲突、执行顺序与待决事项。第 1~4 节保留原始记录，与第 5 节冲突处以第 5 节为准。

---

## 0. 背景与定位前提

本工作台（`dsh-our-free-imagen`）是一个依托 **Kaggle 免费 2×Tesla T4 GPU** 运行远程推理、本地通过 DeepSeek Harness（DSH）插件提供交互与产物落盘的轻量生图工作台。

在评估任何体验缺陷或稳定性问题前，需要先锚定两个物理边界：
1. **算力零成本约束**：远端算力依赖 Kaggle 免费容器（单次运行上限 3 小时、每周配额约 30 小时、`/kaggle/working` 可用磁盘约 20 GB、冷启动需重新排队与装包）。
2. **公网穿透链路**：Host（用户本机 DSH）与远端推理守护进程（`remote/daemon.py`）之间默认经过公共会合服务（`ntfy.sh`）与临时反向隧道（Cloudflare Quick Tunnel）。

本轮讨论聚焦三个核心问题：
- **产品体验**：当前工作台在提示词、对话创作、参数控制、画廊浏览上还有哪些不顺手的地方？
- **高可用评估**：系统是否存在不可用场景？现有代码组织能否达到 **99.999%（五个 9）** 可用性？
- **基础设施决策**：手头有一台一年期的国内公网服务器（带宽未知、无域名），是否适合接入作为控制/数据中转节点？

---

## 1. 当前工作台的问题清单（产品与交互层）

### 1.1 表单创作与提示词配方割裂
- **缺少一键中翻英入口**：现役预设全部按英文提示词训练（[`preset.js`](../src/logic/preset.js#L17-L26)）。表单侧检测到中文时仅展示一条软提示（[`Rail.jsx`](../src/studio/Rail.jsx#L261-L262)），不提供像对话模式那样的「自动整理/翻译成英文标签或自然语言」按钮，用户仍需自己切到外部翻译或切模式。
- **风格预设与模型预设对负向提示词的修改冲突**：切换模型时会调用 [`presetSelectPatch`](../src/logic/preset.js#L38-L58)（按需更新 `negativeHint`），点击风格试印条会调用 [`toggleStyle`](../src/logic/prompt.js#L24-L39)（仅在 `negative` 为空时写入风格负向词，取消时严格按 `=== capsule.negative` 比对清空）。当「模型负向词」非空时风格负向词被静默跳过；反之若先选风格填了负向词，切换模型后若两者不一致也会保留旧词。
- **画幅比例未按当前模型动态匹配**：[`Rail.jsx`](../src/studio/Rail.jsx#L332-L347) 固定渲染全局 `DEFAULT_RATIOS`，没有消费模型资产自带的 `sizeOptions`（例如 FLUX.2 Klein 4B 定义了 `[768, 1024]`），也缺少自由输入宽高的界面入口。注：`sizeOptions` 是**方形尺寸档位**（512/768/1024/1152），不是画幅比例，不能直接映射到比例行〔§5.1〕。
- **高级参数默认折叠过深**：步数、CFG、Seed、Batch 数量全部藏在可折叠手风琴里（[`Rail.jsx`](../src/studio/Rail.jsx#L378-L450)），高频调参需要多点一次展开。〔与 `docs/PRODUCT.md:62`、`docs/SPEC.md:603` 的既定产品立场冲突，见 §5.2〕

### 1.2 对话式创作（Chat）的隐式耦合与不可控
- **隐式锁定 Seed 导致越聊画面越僵**：[`useChatThread.js`](../src/studio/hooks/useChatThread.js#L141-L145) 在点击确认卡生成时，若表单未填写 `seed`，会自动从 `state.lastJob.params.seed` 继承上一轮的种子。当用户在同一对话里从「画一只猫」跨到「画城市夜景」时，隐式沿用旧种子容易出现构图僵化，且界面上没有任何提示告知「当前正在沿用上一次种子」。
- **意图确认卡为纯只读展示**：[`ChatPanel.jsx`](../src/studio/ChatPanel.jsx#L103-L129) 渲染出的英文 `prompt`、比例与风格没有行内微调能力；发现某个词不准确时，用户无法在确认卡上直接改几个词再点生成，只能重新打一句话再让大模型猜一次。
- **对话线程仅存组件内存**：[`useChatThread.js`](../src/studio/hooks/useChatThread.js#L46) 使用纯 `React.useState([])`，刷新页面或重开标签页后整个对话上下文直接丢失（仅作品库留在磁盘）。

### 1.3 作品画廊与窄屏反馈短板
- **不能在画廊卡片上直接收藏**：[`Gallery.jsx`](../src/studio/Gallery.jsx#L247-L270) 上只展示已收藏星标和「带回参数 / 生成变体 / 看大图」悬浮操作，若想给某张图加星标或取消星标，必须先跳回预览舞台。
- **瀑布流列序与时间浏览直觉相悖**：[`gallery.css`](../src/styles/gallery.css#L255-L258) 使用 `column-count: 5` 做纵向分栏。最新生成的作品会沿着第 1 列从上往下排完再排第 2 列，而不是符合阅读习惯的「左上到右下按时间横向流转」。〔与 `docs/DESIGN.md:183/284`、`docs/SPEC.md:606` 的「5 列自然高度、不裁切」冲突，见 §5.2〕
- **历史加载存在 60 批硬截断**：[`useWorkLibrary.js`](../src/studio/hooks/useWorkLibrary.js#L31-L33) 写死了 `fetchHistory(60)`，且前端没有分页或「加载更多」交互，长期高频出图后较早作品在画廊里不可见。
- **窄屏下待执行队列完全消失**：在 `max-width: 820px` 断点下，[`responsive.css`](../src/styles/responsive.css#L183-L185) 直接隐藏了整个 `.ofs-filmstrip`。由于多任务队列的卡片（[`Filmstrip.jsx`](../src/studio/Filmstrip.jsx#L28-L50)）附着在底部胶片栏里，窄窗/半屏分栏使用时，用户无法看到还有多少任务在排队。

### 1.4 进度透明度与运维配置入口不足
- **批内进度文本被吞掉**：后端在多张生成时会更新 `job.stage`（如 `生成中 2/4`，见 [`jobs.js`](../lib/jobs.js#L417-L421)），但前端 [`jobProgressText`](../src/logic/status.js#L145-L154) 只认 `job.status`，统一显示「生成中」，丢掉了分张进度与模型加载细分提示。
- **高频运维参数缺少 UI 配置面板**：诸如 `hfToken`、`idleTimeoutSec`、`accelerator`、`datasetSources`、`pipConstraints` 虽然已在 [`index.js`](../index.js#L49-L73) 全部接入插件配置，但工作台界面上没有对应设置抽屉，普通用户很难发现和修改。

---

## 2. 可用性与 99.999% SLA 深度评估

### 2.1 第一性原理结论：绝对达不到 99.999%

**99.999%（五个 9）的数学含义是：全年累计不可用时间 ≤ 5.26 分钟（平均每天 < 0.86 秒）**。

从系统链路看，当前工作台处于一个**无冗余、无 SLA 保障的串联模型**：
$$\text{系统可用性} = A_{\text{Kaggle}} \times A_{\text{ntfy}} \times A_{\text{Cloudflare}} \times A_{\text{GitHub/PyPI/HF}} \times A_{\text{本地宿主}}$$

仅 Kaggle 冷启动这一件事（排队 + 装包 + 拉取底座模型，通常 3–10 分钟），发生一次就已经把全年 5.26 分钟的总停机配额耗尽。再加上公共组件无商业 SLA 与故障自动切换机制，这套架构的现实定位属于 **Best-effort（尽力而为）个人工作台**（现实可用率通常在 90%–98% 量级，视本地代理质量与 Kaggle 队列情况波动），与 99.999% 相差 3–4 个数量级。

### 2.2 外部不可控单点失效链
1. **Kaggle GPU 平台约束**：排队等待（[`contract.js`](../shared/contract.js#L94) 预留 45 分钟 `provisionMs`）、每周 30 小时免费配额上限、单次容器最长 3 小时强制回收（`kernelRunMaxSec: 10800`，见 [`contract.js`](../shared/contract.js#L98)）。
2. **公共会合中心单点**：默认固定使用 `https://ntfy.sh`（[`session.js`](../lib/session.js#L141)），无备用会合渠道。会合服务限流或网络不通时会直接导致 `tunnel_timeout`。
3. **临时隧道与启动期外网拉取**：每次冷启动需实时从 GitHub Releases 下载 `cloudflared`（[`daemon.py`](../remote/daemon.py#L83-L85)、[`daemon.py`](../remote/daemon.py#L1867-L1885)），再暴露无持久 SLA 的 `trycloudflare.com` 域名；若未预挂载 Dataset，还需现场执行 unpinned `pip install` 并从 HuggingFace 下载 5.6–15.2 GB 权重。

### 2.3 代码内部已存在的不可用与卡死隐患
即便假设外部网络和 Kaggle 一路畅通，当前代码组织内也存在会直接打断可用性的缺口：

| 风险项 | 代码定位 | 触发表现 |
| :--- | :--- | :--- |
| **切模型不清理磁盘缓存** | [`ensure_pipeline`](../remote/daemon.py#L1293-L1326)<br>[`ensure_disk_capacity`](../remote/daemon.py#L1096-L1109) | 切模型仅调 `release_pipeline()` 释显存，未清理 `~/.cache/huggingface/hub/models--*` 旧文件（全文件无删除动作，预检只看不删）。注意：权重走 `snapshot_download()` 且未传 `cache_dir`，落在 HF 默认缓存；而 `disk_precheck` 只量 `/kaggle/working`，两者是否同一文件系统在仓库内无证据，清理器必须按实际缓存路径量空间〔§5.1 已修订〕。多模型累积后写满容器写入层会触发 `LoadError` 或下载期 ENOSPC |
| **默认依赖未锁定** | [`daemon.py`](../remote/daemon.py#L100-L110) | `PIP_CONSTRAINTS` 默认为空字典，冷启动全量安装最新版 `diffusers / transformers / accelerate / peft`。一旦上游发版引入传递依赖冲突，次日新会话冷启动即会失败（历史已出现过 `pip install 退出码 1`） |
| **串行队列无取消机制** | [`jobs.js`](../lib/jobs.js#L1-L5)<br>[`routes/jobs.js`](../lib/routes/jobs.js#L15-L66) | 远端与宿主均单线程串行执行，且无取消任务的 API。前面一旦排入一个慢模型或卡在权重下载里的任务，后续任务会被阻塞**最长约 55 分钟**（`sessionWaitMs` 45 分钟 + `remoteJobMs` 10 分钟，见 [`contract.js`](../shared/contract.js#L94-L96)）〔§5.1 已修订〕，用户只能手动关机重启整个会话 |
| **ready 阶段二次抖动直接放弃会话** | [`contract.js`](../shared/contract.js#L92)<br>[`health.js`](../lib/session/health.js#L30-L33)<br>[`session.js`](../lib/session.js#L777-L814) | `reconnectMaxAttempts` 为 `1`，语义是「**每个连续 ready 周期内**只允许 1 次重新会合」（每次健康检查成功都会把计数清零，见 [`session.js`](../lib/session.js#L733)）；真正的硬截断是 **120 秒恢复窗口**（`recoveryMs`，见 [`session.js`](../lib/session.js#L547-L557)、[`session.js`](../lib/session.js#L685-L690)），超时即 `giveUp` 并终止会话（`health_failed`），即使查询 Kaggle 确认 Kernel 仍为 `RUNNING`〔§5.1 已修订〕 |
| **出图轮询对网络抖动容忍过窄** | [`remote.js`](../lib/remote.js#L19-L20) | `waitForJob` 在连续 `MAX_POLL_FAILURES + 1 = 6` 次失败后直接判定任务失败（窗口约 12~60 秒，取决于单次请求是快速失败还是 8 秒超时）〔§5.1 已修订〕；遭遇隧道十几秒的重启窗口时，远端实际仍在正常算图，本地却提前报错且恢复后不会凭原 `jobId` 接回结果 |
| **卸载关机通知不等待** | [`dispose`](../lib/session.js#L305-L335) | 插件卸载/退出时向远端发送 `/shutdown` 为 best-effort 且不等待回执，若此时隧道刚好断开，远端 Kernel 会继续空转直到 `idleShutdownSec`（30 分钟），白白消耗每周额度 |

### 2.4 现有代码已经做扎实的可靠性设计（客观保留）
在个人免费云算力场景下，现有代码底子并不脆弱，以下机制应保留并作为后续演进底座：
- **协议抗长连接掐断**：远端 `POST /generate` 快速 202 入队（宿主路由返回 200）+ `GET /job` 短轮询 + `job.id` 幂等键（[`contract.js`](../shared/contract.js#L76-L80)、[`jobs.js`](../lib/jobs.js#L401-L409)）。注：宿主当前从不重试提交，幂等键实际未被使用——这正是 §4 续接方案可以直接复用的抓手〔§5.1〕。
- **状态机防竞态**：`epoch` 代次隔离 + `singleFlight` 轮询单飞，避免重复拉起 `kaggle` 子进程或僵尸轮询复活已停止会话。
- **隧道自愈与断点恢复**：远端隧道监控支持指数退避重拉与定时重播（[`daemon.py`](../remote/daemon.py#L91-L96)）；宿主通过 `<workspace>/.imagen/session.json` 支持重启后 `restore()` 接管存活会话。
- **本地离线解耦**：LLM 润色/意图失败自动退回本地规则，历史作品扫描与收藏库写入均采用同目录 `.tmp + rename` 原子落盘，无云端连接时画廊浏览与管理完全可用。

---

## 3. 个人国内服务器作为中转节点的决策记录（已否决）

### 3.1 讨论背景与服务器条件
曾评估是否利用手头已有的一台 **1 年期国内公网服务器（带宽未知、暂无域名）** 接入工作台，用来替代 `trycloudflare.com` 与 `ntfy.sh`，提升连接稳定性。

### 3.2 与代码机制的契合度分析
经核查代码，宿主和远端确实已为自建通道留了基础钩子，但也存在明确的接入约束：
1. **已有支持**：[`index.js`](../index.js#L55-L73) 与 [`provisioner.js`](../lib/session/provisioner.js#L81-L86) 已支持通过 `fallbackTunnelCommand`、`fallbackTunnelUrlRegex` 和 `trustedTunnelDomains` 下发并校验自定义隧道。
2. **代码缺口（若真接入需补齐）**：
   - **安全协议强约束**：[`isTrustedEndpoint`](../lib/remote.js#L72-L85) 除本机回环地址（`127.0.0.1` / `localhost`）外，**强制要求 `https://` 且命中可信域名白名单**，不接受 `http://公网IP:端口`。
   - **通道优先级**：[`build_tunnel_plan`](../remote/daemon.py#L1930-L1950) 目前永远优先尝试 Cloudflare（最多等 120 秒），失败后才切向 `fallbackTunnelCommand`，不能直接作为首选通道跳过等待。
   - **会合配置未完全透传**：`SessionManager`（`ntfyBase`）与 `daemon.py`（`ntfy_server`）虽各自有字段定义，但 [`index.js`](../index.js#L43-L74) 与 [`buildKernelConfig`](../lib/session/provisioner.js#L62-L90) 尚未透传 `ntfyBase`。

### 3.3 否决原因（从第一性原理权衡）

综合物理约束与工程收益，最终决定**不采用该国内无域名服务器作为生图中转链路**：

1. **小带宽瓶颈反伤吞吐体验**：国内一年期优惠云服务器常见出网带宽为 1–5 Mbps。一次 4 张 `1024×1024` 图像的 base64 响应体约 6–10 MB，经 3 Mbps 服务器中转仅传输就需要 20–30 秒，显著拖慢生图反馈。
2. **跨境链路方向不优**：Kaggle 容器位于海外 GCP，若先回传至国内服务器再转回本机，跨国回程丢包率不一定优于 Cloudflare 边缘节点；且 [`net.js`](../lib/net.js#L4-L10) 已经实现了「进程内 `fetch` 失败后自动降级走系统代理 `curl`」，在本地有代理条件下强行绕回国内服务器属于多此一举且减速。
3. **无域名增加无谓运维成本**：国内机房暴露 80/443 HTTPS 需要域名与 ICP 备案；即便改用「Kaggle → 服务器纯 TCP（`frp`）+ Windows 本机 `ssh -L` 映射 `http://127.0.0.1:端口`」以利用 [`isLoopback`](../lib/remote.js#L29-L40) 豁免 HTTPS，仍无法突破服务器自身带宽上限，且增加了本地常驻维护一条 SSH 隧道的负担。

> **未来重估条件**：若后续拥有 **海外高带宽 VPS（≥ 30 Mbps）+ 已解析域名**，再启用 `Caddy(HTTPS) + frps/rathole + 自建 ntfy` 并补齐 `preferCustomTunnel` 与 `ntfyBase` 透传，届时才具有明显的稳定性正收益。

---

## 4. 后续可执行改造路线（P0 / P1 / P2）

放弃折腾国内服务器中转后，接下来的精力全部收敛到**直接提升实际出图成功率和前端创作效率**的改造上：

### P0：高收益止血与高频卡点修复（优先推进）

#### A. 运行时可靠性加固
1. **切模型磁盘自清理（防 20 GB 爆盘）**：
   - 在 [`ensure_pipeline`](../remote/daemon.py#L1293-L1326) 或 `ensure_disk_capacity` 前，当预估剩余空间不足且非预挂载模型时，按 LRU 自动清理 `~/.cache/huggingface/hub/models--*` 中非当前目标模型的旧缓存；同时前端切模型前对预期大体积模型给出一句轻量空间/耗时提醒。
2. **打破队头阻塞（新增任务取消）**：
   - 宿主路由层（[`routes/jobs.js`](../lib/routes/jobs.js)）与 `JobQueue` 支持取消 `queued` / `waiting-session` 任务（直接出队失效），并为 `running` 任务提供「当前这张出完后停」的合作式取消——daemon 是单 worker 线程内的同步 `pipe()` 调用，无法抢占，只能在两张图之间检查取消标志；要逐步中断必须给 `pipe()` 传 `callback_on_step_end`。
   - 新增的任务状态与错误码必须同步 `shared/contract.js`、`docs/SPEC.md` 与中英文案（`test/check-contract.mjs` 强制覆盖），并尊重既有的 `stoppedByUser` 保护与 `trim()` 不淘汰 running/pending 的不变量〔§5.4〕。
3. **放宽隧道重连容错与任务续接**：
   - 要改的有效对象不是 `reconnectMaxAttempts`（每次健康检查成功都会清零，见 §5.1），而是 **120 秒恢复窗口**：只要向 Kaggle 确认 Kernel 状态仍为 `RUNNING`，允许按跳数续期恢复窗口，而不是一次超时就 `giveUp`。
   - 提高 `waitForJob` 对短时隧道重建的抗性；恢复后用同一 `job.id` 作为幂等键重新提交以接回原任务（daemon 侧 `submit_job` 命中幂等键即返回原 job，保留窗口 `JOB_TTL_SEC=600s`、最多 8 个已完成 job），避免「图画了一半被本地误判失败」。注意超窗后重投会重新出图，必须限制续接次数〔§5.1〕。

#### B. 核心创作体验修复
1. **解除对话式创作隐式锁种**：
   - 修复 [`useChatThread.js`](../src/studio/hooks/useChatThread.js#L141-L145) 自动把上一张 `lastJob.params.seed` 塞入新一轮对话的隐式行为；改为默认随机种子，或在确认卡上显式提供「沿用上张构图（锁定种子）」开关，并支持确认卡英文字段行内微调与对话记录本地持久化。
2. **表单直接英译与模型能力对齐**：
   - 在中文提示词提醒旁增加「一键转为英文提示词」快捷动作（复用后端现有 LLM 能力）；比例选择按当前模型 `sizeOptions` 动态过滤高亮，并开放合规步长内的自定义宽高；整理 [`toggleStyle`](../src/logic/prompt.js#L24-L39) 与 [`presetSelectPatch`](../src/logic/preset.js#L38-L58) 的负向词合并规则，避免静默丢词或相互覆盖。
3. **画廊与窄屏体验修复**：
   - 卡片悬浮操作补齐直接「收藏/取消收藏」；将 [`gallery.css`](../src/styles/gallery.css#L255-L258) 的 `column-count: 5` 改为符合时间顺序的横向网格布局；增加历史分页加载突破 60 批上限；窄屏断点（`≤820px`）保留迷你排队状态胶囊，确保多任务可见。

### P1：状态透明化与可控运维
1. **进度与生命周期细节透出**：前端 [`jobProgressText`](../src/logic/status.js#L145-L154) 消费后端 `job.stage`（展示 `2/4` 等张数进度）与远端加载阶段描述；顶栏算力胶囊或弹层展示基于远端 `/health.idle_seconds` 的空闲自关倒计时，减少意外休眠困惑。
2. **工作台设置面板**：为 `hfToken`、`idleTimeoutSec`、`accelerator`、`pipConstraints` 等配置项提供可视化表单，减少手动改插件配置 JSON 的门槛。
3. **冷启动基线固化**：维护一组经实测验证的 `pipConstraints` 推荐基线与常用模型 `datasetSources` 挂载指引，尽量把冷启动拉包的不确定性压到最低。

### P2：创作链路扩展
1. **图生图 / 参考图重绘**：基于远端现有 pipeline 引入 `AutoPipelineForImage2Image.from_pipe`（复用已加载底座不重占显存），串联「选定已有作品 → 垫图微调 / 局部重绘」闭环，提升连续迭代效率。

---

## 5. 评审修订记录（2026-11-13）

> 本节由逐条代码核对产生，用于在开工前修正第 1~4 节中与实现不符的判断。第 1~4 节的其余结论、以及「可靠性优先于中转折腾」的总方向保留不变。

### 5.1 事实性修正（原始结论不成立或有偏差）

| 位置 | 原文结论 | 核对结果 | 对改造的影响 |
| :--- | :--- | :--- | :--- |
| §2.3 队头阻塞 | 「后续任务被阻塞最长 `remoteJobMs`（默认 10 分钟）」 | 上限是 **约 55 分钟**：`runJob` 先等 `sessionWaitMs`（45 分钟，`shared/contract.js:96`、`index.js:81`），再进 10 分钟生成预算（`lib/jobs.js:317`）。 | 取消功能的优先级从「顺手做」升为 P0 第一项，且必须覆盖 `waiting-session` 段，只改生成超时无效。 |
| §2.3 ready 二次抖动 | 「`reconnectMaxAttempts = 1`，同一生命周期内第二次隧道闪断即 `giveUp`」 | 每次健康检查成功都会把 `reconnectAttempts` 清零（`lib/session.js:733`），真实语义是「每个连续 ready 周期内允许 1 次重新会合」。真正的硬截断是 `recoveryMs = 120s` 窗口（`lib/session.js:547-557`、`685-690`）。 | 只抬 `reconnectMaxAttempts` 不会改变症状；要改恢复窗口的续期条件。 |
| §2.3 出图轮询 | 「连续 `MAX_POLL_FAILURES = 5` 次（约 10 秒窗口）」 | 第 6 次连续失败才判失败（`lib/remote.js:195`），单次失败耗时 0~8 秒，实际窗口 **约 12~60 秒**。 | 续接阈值按最坏 60 秒设计，不要按 10 秒估算。 |
| §2.4 协议 | 「`POST /generate` 快速 202 入队」 | 202 是远端 daemon 的行为（`remote/daemon.py:1833`）；宿主 `POST /imagen-api/generate` 恒返回 200（`lib/routes/jobs.js:33`）。宿主当前从不重试提交，幂等键实际未被使用。 | 续接可直接复用幂等键：隧道恢复后用同一 `job.id` 重投，daemon 命中原 job（`JOB_TTL_SEC=600s`、`JOB_MAX_FINISHED=8`）。 |
| §2.3 缓存爆盘 | 「Kaggle 20 GB 磁盘下 SDXL→FLUX.2 直接爆盘」 | 权重走 `snapshot_download()` 且未传 `cache_dir`，全仓也无 `HF_HOME` 重定向，落在 `~/.cache/huggingface/hub`；而 `disk_precheck` 只量 `/kaggle/working`（`remote/daemon.py:1071-1072`）。两者是否同一文件系统，仓库内无证据。 | 清理器要按 HF 实际缓存路径取 `shutil.disk_usage`；keep-set 必须从 pipeline spec 全量展开（`vae` / `tokenizers` / `textEncoder` / `lora`），并排除 `localModels` 只读挂载，否则会误删当前模型的分词器或 VAE。 |
| §1.1 比例 | 「比例选择按模型 `sizeOptions` 动态过滤」 | `sizeOptions` 是**方形尺寸档位**（512/768/1024/1152），不是画幅比例。 | 应做「尺寸档位」控件，或约束比例换算出的宽高落在档位内，不要映射到比例行。 |
| §1.4 进度 | 「前端只认 `job.status`，丢掉分张进度」 | 成立。补充：`jobProgressText` 在 `queued` 时还会读 `sessionState`（`src/logic/status.js:149`），文案是「正在生成…」；`job.stage` 由宿主拼装且**是硬编码中文**（`lib/jobs.js:224/341/418/438`），`done + 1` 表示「正在出第 k 张」而不是已完成数。 | 英文界面要显示分张进度，必须先让宿主下发结构化字段（`stageCode` + 数字 `progress`），客户端再本地化；本批已按此实现。 |
| §1.1 中翻英 | 「不提供像对话模式那样的自动整理/翻译按钮」 | 对话模式**也没有翻译按钮**：英文由意图解析产出，且模型不可用时直接把中文原文当 prompt（`lib/intent.js:119`），只能靠 `source='local'` 标注。表单侧其实已有宿主 LLM 通道（「润色」按钮 → `lib/enhance.js`），可直接复用其 fallback 结构。 | 「一键转英文」不需要新接模型，但要明确 LLM 不可用时的降级文案，不能假装成功。 |
| §1.1 负向词 | 「风格负向词被静默跳过 / 切换模型后保留旧词」 | 成立，且还有两条漏写的丢词路径：① 切到 `negativeHint` 为空的预设（`flux2-klein-4b`、`anima-light-lavender`）时旧模型负向词永久残留；② 先选风格 → 切模型 → 再取消风格，会把当前模型 hint 一并清成空串。 | 合并规则要按「来源分层」（模型 hint / 风格词 / 用户手写）记录，而不是靠字符串相等比对。 |
| §2.2 cloudflared | 「每次冷启动需实时下载 cloudflared」 | 同一容器内 daemon 重启会复用 `/tmp/cloudflared`（`remote/daemon.py:1868-1870`）；只有新容器才重新下载，且地址是滚动 `latest`、无校验和。 | 方案不要承诺「每次重启都下载」；如需稳定冷启动，应改为固定版本加校验。 |

### 5.2 与既有产品 / 设计文档冲突（需拍板）

1. **§1.1「高级参数默认折叠过深」**：`docs/PRODUCT.md:62`（「高级参数默认收拢保持轻盈，需要微调时一步展开」）与 `docs/SPEC.md:603`（「默认折叠抽屉」）已把它写成产品立场。建议删除该条，或改为「记住上次展开状态」这类不推翻设计的改进。
2. **§1.3「瀑布流列序」**：`docs/DESIGN.md:183/284` 与 `docs/SPEC.md:606` 明确「5 列自然高度、不裁切图片、按时间线分段」。改成横向网格需要等比裁切并同步改三份文档；若目标只是「按时间顺序浏览」，更小的改法是保留瀑布流、修正排序与分段。

### 5.3 无行动落点

以下两条在第 4 节没有任何 P0 / P1 / P2 承接，需要补进去或明确「本轮接受现状」：

- §1.1「高级参数折叠」（若保留该条）。
- §2.3「卸载关机通知不等待」：`dispose()` 不 await 是卸载路径的必要取舍（`lib/session.js:305-320`），若要改善应改为「记录待清理 + 下次启动补发」，而不是阻塞卸载。

### 5.4 可执行性缺口

1. **缺少验收标准**：每条改造应写明「改哪些文件 + 由哪条测试断言 + 是否需要真机验证」。
2. **契约门禁成本被低估**：新增取消路由会同时触发六处改动——`ROUTES`、`ERROR_CODES`（含中英文案）、路由注册、客户端、`docs/SPEC.md`（`test/check-contract.mjs` h 项强制覆盖每个路由与错误码）、`client.js` 重新构建。历史分页同理：`scanHistory` 目前只有 limit，没有 offset/cursor，属于宿主接口扩展。注意两步成本差别很大：**把前端 `fetchHistory(60)` 提到契约上限 100 是零宿主改动的**，真正的「加载更多」才需要 offset。
3. **风险分层缺失**：P0 把「可完全离线单测」与「必须真机 GPU 才能验」的项混在一批，远端改动容易长期停在「已写未验证」。建议按验证成本分三批。
4. **客户端没有持久化惯例**：`src/` 内 `localStorage` / `sessionStorage` / IndexedDB 零使用，收藏与历史全部走宿主接口。因此「对话记录本地持久化」要么新引入 localStorage 惯例，要么照现有模式加宿主接口；这是设计选择，不应在实现时顺手决定。

### 5.5 调整后的执行顺序

- **第一批（可完全离线验证）**：P1.1 进度透出、P0-B1 解除隐式锁种、P0-B3 画廊收藏与窄屏排队胶囊、P0-A3 轮询容错与幂等续接、恢复窗口语义修正。
- **第二批（接口改动，串行推进）**：P0-A2 任务取消（先 `queued` / `waiting-session`，运行中用合作式取消）、历史分页、P0-B2 一键英译与负向词合并规则、尺寸档位。
- **第三批（远端改动，需一次真机验证）**：P0-A1 磁盘缓存清理、A2 的 daemon 侧实现、P1.2 设置面板、P1.3 冷启动基线。

### 5.6 已决事项（2026-11-13）

1. **画廊浏览顺序**：保留 5 列自然高度、不裁切，只改列分配与排序——最新作品优先从左到右排布。`docs/PRODUCT.md` / `DESIGN.md` / `SPEC.md` 的卡片原则不动。
   - 实现含义：CSS `column-count` 是列优先填充，无法做行优先，必须改为 JS 按 `index % 列数` 分桶 + 每列独立 flex 容器（列数随断点 5/4/3/2 变化），才能保证"同一行内越靠右越旧"。
2. **取消语义**：接受两段式——`queued` / `waiting-session` 立即取消；`running` 在当前这张出完后停（中止同批剩余张数）。**不给 `pipe()` 传 `callback_on_step_end`**。
   - 实现含义：daemon 侧只需在 `run_tasks` 的逐张循环开头检查取消标志，属远端改动，随下一批做；本批可先做宿主队列取消（`queued` / `waiting-session` 段，纯宿主、可离线测）。
3. **发布节奏**：拆两批。第一批只收口"可离线全测"的 Host / UX 改造（含历史 `limit` 60 → 100）；`remote/daemon.py` 的缓存清理与远端改动放第二批，按真机 GPU 实测收口。
4. **对话记录持久化**：不引入 `localStorage`。本轮暂缓；后续若要落盘，统一走宿主接口写入工作区，与收藏 / 历史保持同一模式。
5. **合入约束**：当前工作区已有未提交的 `lib/net.js` + `test/net-fallback.mjs`（代理降级修复），合入时不得覆盖或回退该修复。

### 5.7 第一批范围（离线可全测）

| 项 | 落点 | 验收 |
| :--- | :--- | :--- |
| 结构化进度（`stageCode` + 数字 `progress`） | `lib/jobs.js`、`src/logic/status.js`、`src/dict/*` | `test/jobs-wait.mjs` / `check-client-logic` 断言 |
| 出图轮询容错与幂等续接 | `lib/remote.js`、`lib/jobs.js` | 新增用例：连续失败后重投接回原 job；404 仍立即终态 |
| 恢复窗口改为"Kernel 仍 RUNNING 就续期" | `lib/session.js`、`shared/contract.js` | `test/session-reliability.mjs`：续期后不提前 `health_failed` |
| 解除对话隐式锁种（默认随机 + 显式开关） | `src/studio/hooks/useChatThread.js`、`ChatPanel.jsx` | `check-client-render` 意图卡场景 |
| 画廊卡片直接收藏 / 取消收藏 | `src/studio/Gallery.jsx`、`useWorkLibrary.js` | `check-client-render` |
| 画廊列分配改为行优先（最新从左到右） | `Gallery.jsx`、`gallery.css` | 渲染快照 + 列分桶纯函数断言 |
| 窄屏保留排队胶囊 | `responsive.css`、`Filmstrip.jsx` / `TopBar.jsx` | `check-client-render` 窄屏场景 |
| 历史加载 `limit` 60 → 100 | `useWorkLibrary.js` | 断言请求参数为契约上限 |

### 5.8 第一批交付记录（2026-11-13）

| 项 | 落点 | 验证 |
| :--- | :--- | :--- |
| 出图轮询容错 + 幂等续接 | `lib/remote.js`、`lib/jobs.js`、`shared/contract.js`（4 个 TIMEOUTS） | `test/jobs-wait.mjs` 16 项 |
| 恢复窗口按 Kernel 状态续期 | `lib/session.js`、`lib/session/state.js` | `test/session-reliability.mjs` 35 项（含 A4/A5） |
| 结构化进度 `stageCode` / `progress` | `lib/jobs.js`、`src/logic/status.js`、`src/dict/*` | `check-client-logic` / `check-client-render` |
| 解除对话隐式锁种 | `src/logic/intent.js`、`useChatThread.js`、`ChatPanel.jsx` | 渲染断言：默认关闭 / 勾选 / 置灰三态 |
| 画廊卡片收藏、行优先分列 | `src/studio/Gallery.jsx`、`src/logic/gallery.js`、`gallery.css` | 纯函数断点断言 + 渲染断言 |
| 窄屏排队胶囊 | `src/studio/QueuePill.jsx`、`responsive.css` | 渲染断言 + 390px 截图目视 |
| 历史 `limit` 60 → 100 | `src/studio/hooks/useWorkLibrary.js` | 请求 URL 断言 |

收口验证：`npm test` 全量 exit 0（19 个阶段）、`node build.mjs --check` 最新、
`node tools/preview.mjs --shot --mobile` 出图目视通过。列数在真实视口下核对为
1600/1440→5、1200→4、1000→3、390→2。

**遗留**：① 预览工具用测试替身渲染，假 `window.innerWidth` 固定 1280，会把 JS 分列结果
烤死成 4 列（已在 `tools/preview.mjs` 头部注明，`--readme` 截图同样受影响）；
② 第二批待做：`queued` / `waiting-session` 取消（宿主侧即可离线测）、运行中任务的
daemon 逐张检查取消标志、画廊真实"加载更多"、尺寸档位、一键英译与负向词分层合并；
③ 第三批：daemon 缓存清理、设置面板、冷启动基线固化。
