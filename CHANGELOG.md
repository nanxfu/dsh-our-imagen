# 变更记录

## 0.5.0 — 2026-11-11

### 改进

- **远端生成改为异步 job 协议，修掉长请求被隧道/代理掐断**：此前 `POST /generate` 同步挂起整段采样，期间不返回任何字节；实测在 Cloudflare quick tunnel + 本地代理链路上，80 秒级的请求（新增的 Anima 模型）会在中途被 `context canceled` 掐断，daemon 仍算完但结果无处可送。协议改为：`POST /generate` 只校验并入队，立即返回 `202 {status:"accepted", job_id}`；Host 每 2 秒 `GET /job?id=<job_id>` 轮询到 `done`（带 `results`）/ `failed`（带 `error.code`）。请求体新增 `jobId` 幂等键，重复提交不会在远端产生重复任务；任务整体预算默认 10 分钟（`generateTimeoutSeconds` 可覆盖），轮询期间容忍连续 5 次网络抖动。
- **远端失败语义不变**：校验失败仍是同步 400 `invalid_request`，phase 未就绪仍是同步 503 `warming`/`load_failed`；运行期失败写进 job 的 `error.code`（`oom` / `load_failed` / `generation_failed` …），Host 原样透传，不需要「提前 200 再丢 500」。

### 工程

- `shared/contract.js`：`VERSION` 0.4.1 → 0.5.0；`PROTOCOL.daemon.routes` 增加 `GET /job`；`TIMEOUTS` 用 `remoteSubmitMs` / `remoteJobRequestMs` / `remoteJobPollMs` / `remoteJobMs` 取代 `remoteGenerateMs`。
- `remote/daemon.py`：新增常驻 worker 线程、job 表（保留 8 个已结束任务，TTL 600 秒）与 `GET /job`；`/health.queue_depth` 改为排队中任务数。
- `lib/remote.js`：新增 `submitGenerate` / `fetchJob` / `waitForJob`，`requestGenerate` 变成「提交 + 轮询」的便捷封装；`lib/jobs.js` 用 `job.id` 做幂等键并按轮询进度更新 `stage`。
- `test/mock-daemon.py`、`test/host-e2e.mjs`、`test/session-pure.mjs`、`test/daemon-unit.py` 跟随新协议；`remote/contract.json` 重新生成。
- 文档：`docs/SPEC.md` 补异步 job 协议说明；`docs/ANIMA_LOADER_SPEC.md` 的批处理限制按新超时更新。

## 未发布

### 改进

- **云端状态按真实阶段展示**：此前顶栏胶囊只看 `session.state`，`connecting` 与 `warming` 都写成「正在装载模型」，于是用户看到「正在申请 GPU → 正在装载模型」的跳变，中间真正耗时最久的排队、建隧道、装依赖阶段没有交代。现在 `src/logic/status.js` 的 `computeStatusOf()` 同时读取 `state + phase`，按「推送环境 → 排队等 GPU → 连接云端 → 准备模型 → 就绪」给出短标签与一句话提示；顶栏胶囊、算力弹层、对话页徽章与新增的过渡态状态条共用这一份派生，不再各写一套。
- **等待过程可见**：新增 `.ofs-sessionbar` 状态条，过渡态下常驻显示「在等什么 + 一句预期 + 已等待时长」，页面隐藏时不再只有一个小圆点在呼吸；窄窗口隐藏提示句、保留标签与计时。
- **任务进度与云端状态分开**：任务进度改用 `jobProgressText()` 区分「等待云端就绪」「排队等待出图」「正在生成」，修掉会话已就绪却显示「正在申请 GPU」的误报。
- **文案去脆化**：排队时间统一为 3~10 分钟（此前帮助文案 5~10、提示框 3~8 互相矛盾）；删掉写死的「6s/张」「首次约 11 秒」，改为弹层里展示当前已载模型的实测单张耗时；删除 `studio.ghost.*`、`studio.stage.rendering` 等重复/死文案；动作与状态统一为「唤醒 / 关闭云端 / 云端已关闭」，宿主侧「重新启动会话」同步改为「点『唤醒』」。
- **等待时长不再虚报**：状态条的「已等待」只在申请 GPU 阶段计时；重连或从本地恢复的会话沿用旧 `startedAt`，不再把整段运行时长当成等待时长。手动关闭云端后，舞台空态改为「云端已关闭，先点『唤醒』再生成」，不再承诺可以直接出图。
- **状态归因更准**：`SessionManager.snapshot()` 增加 `stoppedByUser`，手动关机后显示「云端已关闭」，不再承诺「直接生成会自动启动」；用户主动关机导致的任务失败改用独立的「云端已关闭，任务没有执行」指引卡，不再套用闲置休眠文案；错误态按错误码给出「账号凭据不可用 / 未安装 Kaggle CLI / 推送失败 / 等待超时」短标签；`push_failed` 不再归成「云端异常」。
- **首图提示不再误报**：`useWorkLibrary` 的首图 toast 以首次拿到 `/state` 时的 `lastJob` 为基线，只在观察到新完成批次且云端确实就绪时提示，重挂载或插件重载后不会对旧结果重复提示「云端就绪」。
- **无障碍与英文文案**：大图预览关闭按钮的 `aria-label` 从「知道了」改为「关闭大图」；去掉胶片条重复的 `role="status"`；中英文案同步重写（阶段词大写、排队/连接/预热提示按真实阶段区分）。

### 修复

- **深色模式下禁用的主操作文字看不见**：主操作按钮（立即生成、对话确认卡的「按此生成」）被禁用时沿用 36% 透明度，但文字色写死成 `#fff`。浅色主题的主操作是墨黑渐变、白字正好；深色主题的主操作反相成浅色渐变，白字落在浅底上几乎不可见。禁用态文字色改为跟随 `--ofs-accent-ink`（浅色主题白、深色主题墨黑），浅色主题的观感逐像素不变。
- **多个排队任务只显示一个**：队列串行执行，但同时提交的两个任务会被宿主按顺序排好（`/state.jobs` 是「最新在前」）。客户端此前把列表里第一个活跃任务当成「当前任务」，于是后提交的排队任务顶替了真正在生成的那张——进度文案写「排队等待出图…」，底部最近生成栏也只画得出一张卡。现在 `pendingJobsOf()` 按「进行中 → 等待云端 → 排队中（提交顺序）」排序：进行中的任务永远是第 1 位，胶片条给每个待执行任务各画一张卡（进行中带显影扫描光与已用时间，排队中带位次与已排队时长），进度文案、舞台与对话气泡都跟随真正在跑的任务。对话线程也改为每个任务气泡按自己的任务更新，先完成的那条不会再停在「已提交，等待开始…」。
- **算力弹层账号状态误报「不可用」**：此前只要本轮没有手动点过「检查环境」，`/state` 的 `probe` 就是 `null`，弹层里的账号行会落到硬编码的 `unavailable`，于是一边正常出图、一边提示「账号 · 不可用」。现在账号状态由 `accountStatusOf()` 统一推导：探测通过、或会话已推进到 provisioning/connecting/warming/ready/stopping（内核推得上去、GPU 连得上，本身就是真实 API 调用成功），都显示「正常」；只有确实没有任何成功证据时才保留上次探测的失败结论；从未探测过显示「未检查」。新增 `sessionProvesAuth()` 与对应的逻辑/渲染回归测试。

### 工程

- **模型资产抽象（无行为变化）**：`shared/contract.js` 里的 4 个预设拆成 `models/<id>.json`（单模型单文件、字段扁平，新增 `order`、`runtime: "default"` 与 `measured` 实测块）；新增 `tools/build-assets.mjs` 生成 `shared/models.generated.js`，`contract.js` 只做 re-export；`check-contract` 增加第 k 项「生成文件与 models/ 同步」，`npm test` 接入 `models:check`。生成后的 `PRESETS` 与改造前逐字段深比较一致。
- **模型验证脚本**：新增 `tools/verify-model.mjs` + 远端 payload `tools/payload/verify-model.py`，支持 `--config / --write / --dry-run / --timeout`；复用 `lib/kernel.js` 打包与 `lib/kaggle.js` 推送/日志/产物下载，实跑回填显存、加载、首图、稳态与下载体积；失败按类别归因并打印最后 20 行日志。离线回归 `test/check-verify-model.mjs` 已接入 `npm test`。
- **模型录入 Agent Skill**：新增 `skills/model-asset-intake/SKILL.md`，把「外部链接 → 草稿 → dry-run → 真机验证（先确认配额）→ 失败自愈 → 入库 → build/check/test」固化成可执行 SOP；`docs/MODEL_ASSET_SPEC.md` 补双份 loader 维护约定与阶段状态。
- `.gitignore` 增加 `.tmp/`（模型草稿与验证产物目录）。
- **模型资产扩容（Kaggle 真机实测）**：新增 4 个预设 `playground-v2.5`（美学旗舰）、`realvis-v5`（超写实摄影）、`animagine-xl-3.1`（二次元插画）、`hyper-sdxl-8step`（8 步蒸馏快档），模型总数 4 → 8；`measured` 全部由 `tools/verify-model.mjs --write` 真机回填。四个模型在单张 T4 上显存峰值均低于 10.4 GB，稳态耗时 7.74–28.34 s，全部一次推通、零重试。
- **MiniMax-H3-Image 部署可行性试验（结论：不可部署）**：最小可用文件集 24.74 GB 超出 `/kaggle/working` 实测的 19.52 GiB；官方 diffusers 路线需约 65 GB 峰值显存；ComfyUI + GGUF 路线在 2×T4 上默认模式因 32B 文本编码器差 0.46 GiB 而 OOM，CPU 流式能跑完 6 步但 1 MP 产物为纯白。该模型不纳入 `models/`，定量证据与改造清单写入文档。
- **新增 `anima` loader 与预设 `anima-light-lavender`（Kaggle 真机实测）**：`Johnny-Z/Anima-Light-Lavender` 是 ComfyUI 单文件 checkpoint（Cosmos-Predict2 2B DiT + Qwen3-0.6B 文本编码器 + Qwen-Image VAE + Qwen2/T5 双分词器），没有 diffusers 仓库结构，`from_pretrained` 无从加载。护展 loader 枚举（`sdxl` / `sdxl-lora` / `flux2` / `anima`），`tools/payload/verify-model.py` 与 `remote/daemon.py` 各内嵌一份逐字一致的运行时：按权重布局构造 DiT 与 LLMAdapter、结构化 Danbooru caption 包装、euler + simple（shift 3.0）采样、CFG-Zero★、dtype 按 compute capability 判定（T4 → fp16）、文本编码器编码后卸到 CPU 并按文本缓存 embedding、逐 step latent 有限性检查、解码 OOM/NaN 兜底。模型总数 8 → 9，实测（1024×1024/25 步/CFG 4.0）显存峰值 8470 MB、加载 43.5 s、首图 87.63 s、稳态中位 80.64 s、下载 5.25 GiB，样张与提示词一致。GPU 侧排障两轮：bf16 在 sm_75 上被模拟执行（8.7 s/前向）且 VAE 解码 OOM；fp16 因残差流在 block27 冲到 5.1e4~5.6e4（fp16 上限 65504）而溢出，改为「权重 fp16、残差流与归一化 fp32」后稳定。
- **模型选择卡扩到 9 个预设**：新增 `anima-light-lavender` 海报（Pexels 二次元角色手办特写，概念示意）与选择器映射；9 张海报 base64 合计 20116 字符（含 `data:` 前缀 20323），仍在 20 KB 预算内；家族徽标新增 `Anima`。

### 文档

- **`docs/MODEL_EXPERIMENT_GUIDE.md`**：新增 1.4 实跑结果（4 个模型的显存/加载/稳态/下载实测表与 6 处草案修正）、2.4 MiniMax 实测结论；修正许可证标注（OpenRAIL++ / OpenRAIL++-M）、Hyper-SD LoRA 与非 CFG 配置、`allowPatterns` 收窄与 fp16 变体，并纠正「7.3 GB 轻量文本编码器」的错误表述。
- **`docs/MINIMAX_H3_IMAGE_SPEC.md`**：新增第 7 节 Kaggle 真机实测（磁盘/显存/下载速度/最小文件集/路线对比/出图尝试/上线改造清单），并修正原文「Q4_K_M 可在 Kaggle 跑通」「9B 轻量文本端」两处结论。
- **`docs/MODEL_ASSET_SPEC.md`**：实施状态补阶段 D（模型资产扩容）与阶段 E（新增 `anima` loader、模型总数 8 → 9）。
- **`docs/ANIMA_LOADER_SPEC.md`**（新增）：`anima-light-lavender` 的模型事实、为什么需要新 loader、`pipeline` 字段契约、双份实现落点、Kaggle T4 三轮实测与故障记录、已知限制与量化路线结论。
- **`docs/MODEL_CARD_SPEC.md`**：模型数量 8 → 9，补 `anima-light-lavender` 行与海报来源、更新海报体积预算（20116 字符）与验收标准。
- **`docs/MODEL_EXPERIMENT_GUIDE.md`**：新增 1.5 节，记录 `anima` loader 的实测结论与「为什么 INT4/INT8 量化不是提速手段（T4 缺 FP8 tensor core、无该 checkpoint 的量化版本、weight-only 量化不省时间）」。`README.md` 的模型清单同步为 9 个。
- **`skills/model-asset-intake/SKILL.md`**：loader 清单补 `anima` 与「单文件 ComfyUI 仓库没有 `model_index.json` 时如何判定架构」的说明。

## 0.4.1 — 2026-11-11

### 修复

- **pip 依赖约束回归（远端 `load_failed`）**：0.4.0 默认下发的版本上限（`transformers<5` 等）与当前 diffusers 新版依赖的 `huggingface-hub>=1.32` 无法同时满足，pip 解析回溯到 2019 年的 `transformers 4.12.2`，在 Kaggle 镜像中直接以退出码 1 失败。0.4.1 改为**默认不钉版本**，`pipConstraints` 只作为用户显式复现手段；带约束安装失败时自动去掉约束重试一次并记录 WARN。
- **错误可诊断**：pip 安装失败的 `LoadError` 现在附带 pip 输出最后几行（不再只有退出码）；Host 侧 `remote_error` 文案截断从 400 放宽到 700 字符；依赖导入自检增加 `from diffusers import DiffusionPipeline`，把「装上了但 import 不了」提前暴露。
- **版本单源升到 0.4.1**：契约 / package.json / daemon / mock / probe / SPEC 同步，`remote/contract.json` 重新生成。

### 文档

- 新增 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)：pip 版本冲突复盘与判断表、venv 取舍、磁盘/隧道/凭证/会话恢复等已知问题。
- README 的 `pipConstraints` 说明与故障排查入口更新；ARCHITECTURE 增加远端依赖安装策略；ROADMAP 同步 P1.2 结论。

## 0.4.0 — 2026-11-11

### 稳定性（P0）

- **会话本地持久化与启动恢复**：Host 把 `kernelId`、`token`、`topic`、`endpointUrl` 等实时写入 `<workspace>/.imagen/session.json`（同目录临时文件 + rename 原子写，目录 0700 / 文件 0600），DSH 重启或插件热重载后自动恢复：`/health` 探活成功直接接管（ready/warming），地址失效但有 topic 则回 ntfy 重新会合，Kernel 已结束或没有地址线索时尽力关机并清理记录。恢复与 `start`/`stop` 的代次机制共存，过期恢复不写状态、不挂定时器；`stop` 与成功的 `dispose` 删除记录，失败保留供下次清理。token 只落盘，不进日志与对外快照。
- **远端隧道自愈**：`remote/daemon.py` 的隧道启动拆成可测试的纯函数（命令规整、地址提取、通道计划、退避），新增常驻监管线程：cloudflared 中途退出时记录 warn、清空发布状态、按 2→60 秒指数退避重拉，拿到新地址后重新广播 ready；主循环每 300 秒重播一次 ready，Host 心跳丢失后可重新会合。`/health` 新增 `tunnel_provider` / `tunnel_state` / `tunnel_restarts`，ready 事件新增 `provider`。

### 可观测性与冷启动（P1）

- **运行日志抽屉**：新增 `GET /imagen-api/logs?since=N`（始终 HTTP 200，用 `ok` 与 `code` 表达可用性），把远端 daemon 日志环透传给工作台。算力弹层新增「查看运行日志」：打开时增量轮询、关闭即停，支持空态/不可用原因/自动滚底，并可一键复制诊断信息（版本、会话快照（剔除 token）、探测结果、队列、最近 60 行日志）。新增错误码 `logs_unavailable`。
- **冷启动加固**：依赖安装带上 constraints（默认 `diffusers<1.0`、`transformers<5`、`accelerate<2`、`peft<1`，可用 `pipConstraints` 按包名覆盖），安装后独立进程做 `import torch/diffusers/...` 自检并打印版本；支持可选 `hfToken`（HF_TOKEN / HUGGING_FACE_HUB_TOKEN，不落日志）；下载权重前按 `downloadGb` 做磁盘预检（需 1.15 倍余量），不足时报「需 X GiB / 可用 Y GiB」。
- **配额可见性容错**：探测失败或配额不可读时，算力弹层回退展示本地统计——最近一次成功检查时间与当时配额、当前会话已运行时长，并给出 Kaggle 账户设置直达链接。`/state` 新增 `probeLastGood` / `probeLastGoodAt`。
- **隧道通道可见**：会话快照新增 `tunnelProvider`，算力弹层显示当前隧道通道（Cloudflare / 自建通道）。

### 体验与发布（P2）

- **权重预挂载**：新增 `datasetSources`（写入 kernel-metadata 的 `dataset_sources`）与 `localModels`（仓库 → 容器内目录映射）；远端命中本地目录（含 `model_index.json`）时直接加载并跳过下载与磁盘预检，LoRA 优先使用本地权重文件。非法 Dataset 标识会告警并过滤，不影响会话启动。
- **备用隧道通道**：新增 `fallbackTunnelCommand`（argv 模板，支持 `{port}`）与 `fallbackTunnelUrlRegex`；cloudflared 失败或超时后自动尝试备用命令，成功后 provider 记为 `custom` 并重播 ready，备用进程同样纳入监管重拉。Host 侧用 `trustedTunnelDomains` 白名单校验会合地址，未登记的域名不会收到 token。
- **窄屏与完成提醒**：≤820px 时画面预览置顶、面板在下方自身滚动，提交任务后进度与图片始终留在视口；离开页面期间任务完成会在标签页标题加「● 生成完成 · 」，返回后恢复标题并提示一次，首次挂载不触发。
- **无障碍**：大图预览与日志抽屉加焦点陷阱、Esc 关闭与关闭后焦点归还；所有图片补有意义的 alt（提示词 → 文件名 → 文案回退）；`pointer: coarse` 下图标按钮、玻璃按钮、dock/tab/画廊动作等热区 ≥44px。
- **发布合规**：补齐 MIT `LICENSE`、`package.json` 的 `license` 字段与版本 0.4.0；新增 `npm run package`——构建 `client.js` 后按 `files` 清单产出 `dist/<name>-<version>/` 可加载目录并尽力压缩 zip；`dist/` 加入 `.gitignore`。

### 工程与文档

- 契约新增 `ROUTES.logs`、`TIMEOUTS.remoteLogsMs` / `clientLogsPollMs`、`ERROR_CODES.logs_unavailable`、`PROTOCOL.daemon.tunnelProviders`，预设 pipeline 增加 `downloadGb`；版本号单源升到 0.4.0（契约 / package.json / daemon / mock / probe 同步）。
- 新增 `test/session-restore.mjs`（79 项）、`test/kernel-package.mjs`（5 项）；`test/daemon-unit.py` 51 → 101 项；`npm test` 与 `test:host` 纳入新测试。
- `docs/SPEC.md` 补日志路由、会话持久化、快照与 `/state` 字段、错误码；`README.md` 增加可选配置表、日志/恢复/打包说明；`docs/ROADMAP.md` 标记 P0/P1/P2 完成状态。

## 0.3.0 — 2026-11-10

### 界面与文案去 AI 味（V2 规格）

- **文案全量重写**：中英双语各 220 键，逐条按平实、直接的桌面软件语气改写；去掉装饰性 emoji 与「智能」「即刻」类强调词；废弃焦舞台、胶卷、抽卡、工坊、资产画廊、以此图微调、换种子抽卡等借喻，统一为画面预览、最近生成、创作、作品画廊、带回参数、生成变体。
- **布局**：删除 72px 图标栏（`RailNav.jsx`），改为固定 320px 单轨创作面板，视图切换与 GPU 状态全部收在顶栏；「最近生成」保留底部整页 dock。窄屏仍按「面板在上、画面在下」收纳。
- **悬浮提示**：新增 `Tooltip` 组件（悬停、键盘聚焦、触屏点击触发，`Esc` 或点击别处关闭），提示词、排除项、采样步数、引导强度、Kaggle 账号与空闲休眠六处把长篇说明收敛进 `(i)` / `(!)`。
- **灵感与润色**：提示词下方常驻 5 组灵感预设，输入框为空时填入、已有内容时换行追加；润色改为宿主模型返回光影 / 材质 / 构图 / 氛围四维标签，点击追加、再点撤销，按预设与语言自适应，模型不可用时使用同结构的本地建议。
- **创作助手**：对话模式改为大模型意图解析——一句话生成确认卡（整理后的提示词、比例、风格、「按此生成」）；用户要求互相矛盾时出澄清卡；模型不可用时按当前设置自动决定；后续消息作为增量修改继承上一轮描述。
- **作品画廊**：卡片悬停提供「带回参数 / 生成变体 / 查看大图」；顶栏新增「在文件夹中打开」，由宿主 `subprocess` 调起系统文件管理器且只允许产物目录；历史接口回传绝对路径，复制与批量导出都是绝对路径。
- **接口**：新增 `POST /imagen-api/intent`（意图解析）与 `POST /imagen-api/reveal`（打开产物目录，支持 `dryRun` 自检）；`/imagen-api/enhance` 改为四维结构化输出并接收 `presetId` / `locale`；`/imagen-api/history` 每条图片新增 `absolute`。
- **工程**：文案检查扩扫 `.jsx`；逻辑测试补润色标签、灵感文案与意图映射；新增 `lib/intent.js`、`src/logic/{refine,intent}.js`；预览工具新增润色面板与画廊悬停场景。
- **清理**：删除失效字典键 65 个、`src/studio/RailNav.jsx`、未引用的 `src/utils/clipboard.js`、比例死标签与已无对应 DOM 的 CSS。

### 评审修正（2026-11-10）

- **画廊动作契约**：悬停「带回参数 / 生成变体 / 查看大图」改为接收完整 `{ image, item }` 条目（此前传的是裸 history item，带回参数静默失效、生成变体误报「先写提示词」）；带回参数会切回创作页，查看大图直接进入放大层。补充组件级回归测试。
- **悬浮提示定位**：固定弹层的坐标按真实包含块（带 `backdrop-filter` 的 `.ofs-app`）换算并在容器内夹紧，左侧字段的提示不再被裁掉；定位算法抽到 `src/logic/tooltip.js` 并有单测，另用无头 Edge 截图核对。
- **对话与比例**：解析进行中按回车不再吞掉草稿；意图卡不再提前改写左侧表单；连续迭代沿用上一张图的种子；补齐 4:3 / 3:4 两种画面比例（含意图解析与比例图形）。
- **润色标签**：只撤销「独立成段」的短语，不再误删句子中恰好包含的同名词（如「霓虹灯光效」里的「灯光」），中英混排也不留悬空逗号。
- **其他修正**：意图接口拒绝空内容（400）；排队 / 预热状态点加入呼吸动效；触屏设备常显画廊操作；批量复制仅在已选时可用；删除失败时保留选择；补齐 8 个宿主错误码文案；`docs/SPEC.md` 更新到 0.3.0 并补全新路由。
- **清理**：移除失效 CSS 选择器（`ofs-tag` / `ofs-input*` / `ofs-scroll` / `ofs-error` / `ofs-row-hint` / `ofs-btn--sm`）与仅测试可达的 `buildPresetView` 及其 10 个文案键。

### 可用性硬化（2026-11-10）

- **会话失效可感知**：进入 `ready` 后不再停掉 Kernel 状态轮询（30s）；心跳连续失败时先查 Kernel——已结束转 `session_ended`/`remote_error`，仍 `RUNNING` 则重取隧道地址，恢复窗口内仍失败转 `health_failed`。修复「空闲 30 分钟后界面永远显示在线、每张图都失败」。
- **会合失败快速报错**：解析 daemon 通过 ntfy 发出的 `type:'error'` 事件立即失败，并区分「仍在排队」与「容器已运行但未会合」；不再等满 45 分钟 `queue_timeout` 再给出归因错误的提示。
- **代理环境可用**：`/health`、`/generate`、`/shutdown` 全部改走 `lib/net.js`（fetch 失败降级本机 curl），curl 兜底按真实 HTTP 状态码解析并支持大响应体。
- **停止语义成立**：用户主动关机后排队任务不再自动拉起新 Kernel（`error.code='stopped'`）；start/stop 竞态不再留下僵尸轮询；dispose/fail 尽力通知远端退出，降低孤儿 Kernel 的配额浪费；push 失败清理含 token 的临时 Kernel 目录。
- **启动异常兜底**：`kaggleUsername` / `buildKernelFolder` / `pushKernel` 抛异常时统一收敛为可读错误并清理目录，不再永久卡在 provisioning。
- **历史与产物**：`/imagen-api/history` 回传完整 `params` 与 `finishedAt`（舞台提示词、以此图微调不再取错参数）；产物文件名改用本地序号，不再拼接远端返回的 name。
- **环境探测**：version 之后 auth/quota/username 三路并发（一次检查从 90s 降到约 20~30s）；区分 `cli_missing` 与 `cli_timeout`，修正重复的版本串；CLI 超时放宽到 30s。
- **客户端**：风格胶囊后缀真正进入最终 prompt、取消风格同步收回负向词；换种子抽卡基于当前选中图；风格/抽卡/重试均走可离线测试的纯逻辑模块；指引卡支持 cli/session/generate/generic 四类、可关闭、带详情行与正确动作；探测有进度、45s 超时兜底，成败只看 `payload.ok`；负向提示词在 cfg=0 时给出说明。
- **本地库**：`library.json` 改为进程内串行队列 + 临时文件 rename 原子写，多窗口并发收藏/删除不丢更新；文件损坏时返回 `notes` 并备份 `.corrupt-*`。
- **测试**：新增 `test/session-reliability.mjs`（26 项）、`test/session-race.mjs`（44 项）、`test/library-atomic.mjs`（12 项），客户端逻辑测试扩到 20 项、渲染场景扩到 12 项；`npm test` 纳入全部离线断言。

### 变更

- **工作台视觉重建（黑白灰工作室）**：整页改成 `工坊 / 画廊` 两视图 + 左图标栏 + 创作面板 + 悬浮画布 + 底部胶片坞的结构；主题色收敛为黑白灰，唯一强调色是墨黑（主按钮、选中环、激活图标），去掉彩色渐变、彩色光晕与「AI 产品画布」式装饰。深色主题按同一明度关系反相：深灰底、浅灰字、浅色主操作。样式从单文件 `src/styles.css` 拆成 `src/styles/` 下的 tokens / base / shell / panel / stage / filmstrip / gallery / chat / responsive 九个模块，由 `src/styles.js` 聚合并仍以文本形式打进单文件 bundle。
- **画廊改为作品卡片墙**：工具条收成一张玻璃卡（搜索、按模型过滤、只看收藏、批量选择、导出、删除），内容按「今天 / 本周 / 更早」分组；卡片按图片原始比例自然高度瀑布流，悬停轻抬升，含两行提示词、模型与种子标签、右上角收藏星标；批量模式下显示选择圆点与确认删除。
- **对话形态重做**：左侧面板的对话形态改为无头像消息流（用户浅灰气泡靠右、助手卡片带状态点与可选缩略图），生成中状态用微光条而不是转圈；底部输入区是悬浮卡片 + 圆形发送钮，扩写与清空入口收在输入区上方。
- **画布与舞台**：图片按比例居中并带柔和投影，右上角悬浮「查看原图 / 复制路径 / 收藏」玻璃按钮；图下一行提示词，右下角显示分辨率 · 耗时 · 种子；动作胶囊（以此图微调 / 换种子抽卡 / 复制文件路径）留在画布下方。
- **胶片坞**：从深色胶片带改为底部悬浮玻璃条，按批次展示缩略图与模型/张数标注；进行中任务显示带微光的骨架卡；右侧入口通往资产画廊。
- **顶栏**：品牌标 + 工坊/画廊分段切换 + 云端算力胶囊（点击查看免费额度、闲置休眠、设备与唤起/休眠/检查凭据）+ 模型预设选择 + 刷新历史。
- **图标**：补齐 `search / sparkles / message / images / expand / dots / plus / refresh / check / chevronRight / clock / cloud` 等手写图标，新增图标栏与对话面板需要的条目，全部保持 24×24、1.6px 圆角描边。
- **对话页徽章**：与工作台同一套黑白灰语言，改为中性胶囊 + 语义状态点，宿主深色主题下自动反相。
- **工程**：新增 `src/studio/RailNav.jsx`；`tools/preview.mjs` 支持整页、独立画廊、独立对话、深色与 390 宽 iframe 预览，占位图改为五种中性抽象构图；测试基准（`test/render-golden.json`）随 DOM 结构更新。

## 0.2.0 — 2026-11-09

### 新增

- **远端会话生命周期**：`lib/session.js` 完整实现 push → 排队 → 隧道 → 握手 → ready 的状态机，带排队/隧道超时、Kernel 状态轮询与失败原因回传。空转视为 `absent`，重复调用幂等。
- **Kernel 打包与配置注入**：`lib/kernel.js` 每次会话生成一次性 Kernel 目录，把 Token、ntfy topic、预载模型描述以 Base64 注入脚本；`--accelerator NvidiaTeslaT4` 申请 2×T4。
- **出图任务队列**：`lib/jobs.js` 串行队列，参数校验与钳制（尺寸取 8 的倍数、步数 1–60、CFG 0–20、张数 1–4），同批多张使用递增 seed。
- **本地产物**：`lib/output.js` 把图片与 `meta.json` 落到 `<workspace>/imagen-output/<时间戳>-<jobId>/`，并提供历史扫描与预览 URL。
- **Host 路由**：新增 `session/start`、`session/stop`、`generate`、`job`、`jobs`、`history`、`file`，`state` 扩展为完整工作台数据源。
- **Agent 工具**：`imagen_generate`、`imagen_session`、`imagen_history`，对话中可直接出图与查询历史。
- **前端工作台**：`client.js` 重写设置页，包含会话控制、参数区、进度、图墙（点击放大、复制路径）与历史；对话页头部徽章显示会话与任务状态。
- **远端 Daemon v2**：`remote/daemon.py` 重写为常驻服务，包含依赖安装、模型加载分支（`sdxl` / `sdxl-lora` / `flux2`）、日志环、`/logs` 增量拉取、错误分级与空闲退出。
- **出站网络降级**：`lib/net.js` 在进程内 `fetch` 失败时改用本机 `curl`，保证代理环境下的 ntfy 访问。
- **测试**：`test/host-e2e.mjs`（mock daemon，15 项断言）、`test/kaggle-live.mjs`（真实 Kaggle 链路）、`test/tunnel-probe.py`（不占 GPU 的探针）、`test/mock-daemon.py`（本地联调）。

### 修复

- **插件整体加载失败**：cordis 的服务访问是严格的，`inject` 未声明 `tools` 时读取 `ctx.tools` 会直接抛错，导致 `apply` 中断、`/imagen-api/*` 全部 404。已把 `tools` 加入 `inject`，并提供 `test/verify-loaded.mjs` 做重启后的加载检查。
- **Kernel 配置注入失效**：占位符按字面量首次匹配，会命中脚本注释里的同名字符串，导致真实赋值行未注入。改为行首锚定的正则替换。
- **Kernel 失败信息不可读**：`kaggle kernels logs` 输出是 JSON 事件流且混有 notebook 转换噪音，直接截尾会把 `Traceback` 挤掉。改为还原文本、过滤噪音后取尾段。
- **ntfy 发布失败**：`Content-Type: application/json` 会被 ntfy 当作发布指令解析而返回 400，改为 `text/plain` 携带 JSON 字符串。
- **cloudflared 管道阻塞**：拿到域名后不再读取 stderr 会让子进程写满管道卡死，改为独立线程持续 drain。
- **Kaggle 镜像依赖冲突**：镜像自带 `torchao 0.10.0` 与新版 `diffusers` 冲突，daemon 启动时先卸载再升级 `diffusers/transformers/accelerate/peft`。
- **权重下载撑爆磁盘**：SDXL 按 `fp16` 白名单预拉取，避免整仓几十 GB 占满 20GB 工作目录。

### 文档

- 新增 `docs/SPEC.md` 作为三端实现契约；根目录 `DESIGN.md` 重写为当前架构；`README.md` 补充使用与测试方式。

## 0.1.0 — 2026-11-09

### 新增与重构

- **文档与工程体系精简**：
  - 清理冗余的规格文档、过度抽象的 Provider 接口及 ADR 记录，聚焦核心开发。
  - 整合输出核心设计 `DESIGN.md` 与实测基准 `docs/SPEC.md` 第 4 节。
  - 明确技术演进路线 `docs/ROADMAP.md`。
- **DSH 插件骨架**：
  - Host 端：提供 `/imagen-api/state` 与 `/imagen-api/probe` 状态及探针路由。
  - Client 端：设置页与状态徽章，支持实时检查 Kaggle CLI、凭据有效性与 GPU 配额。
  - 远端运行环境：收敛至 `remote/daemon.py` 与 `remote/worker.py`。
