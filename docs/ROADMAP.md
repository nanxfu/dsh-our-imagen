# 开发计划与路线图 (ROADMAP)

本文档记录插件从 0.2.0 起的演进重点。针对 Kaggle 免费 GPU 的物理特性（单张 1024² 约 6 秒、每周 30 小时上限、冷启动需排队与装依赖），规划稳定性加固与交互升级。

---

## 一、 最新完成的稳定性加固（2026-11-10 基线）

在推进下一阶段前，代码库已先补齐出图链路中的严重故障点（对应 `test/session-reliability.mjs` 等断言）：

1. **会话掉线与失效感知**：
   - 状态进入 `ready` 后，仍以 30 秒周期低频轮询 Kernel 状态；
   - 心跳连续丢失 3 次时主动向 Kaggle 查机器状态：若机器已停止，直接判定为会话结束（`session_ended` / `remote_error`）；若仍为 `RUNNING` 则重新获取隧道地址，恢复窗口（120s）内未恢复才转为 `health_failed`。彻底解决“云端已退但界面永远显示在线、出图一直报错”的问题。
2. **会合失败快速报错**：
   - 解析远端守护进程通过 ntfy 发送的 `type: 'error'` 事件，遇到异常直接报错退出，不再死等 45 分钟超时；文案区分“仍在排队”与“容器已运行但网络未连通”。
3. **代理环境网络降级**：
   - `/health`、`/generate`、`/shutdown` 统一通过 `lib/net.js` 发送：进程内 `fetch` 失败自动降级为本机 `curl`，解决国内环境下“能收到 ntfy 广播但 HTTP 握手与出图必然失败”的问题。
4. **关机与防竞态**：
   - 主动关机后，队列中的排队任务直接失败并标记为 `stopped`，不再自动拉起新实例；
   - 引入启动代次（epoch），`start` 与 `stop` 交叉执行时清理过期代次，不再产生僵尸轮询；
   - 会话销毁时主动向远端发送退出请求（best-effort），尽力避免孤儿 Kernel 浪费 Kaggle 额度；推送失败自动清理本地临时目录。
5. **历史记录与环境检查**：
   - `/history` 接口回传完整参数与完成时间，修复参数回填取错任务的缺陷；
   - 环境检查改为并发探测（总耗时从 90 秒降至约 20~30 秒），明确区分“未安装 CLI”与“执行超时”。
6. **本地库并发原子写**：
   - `library.json` 采用串行执行队列 + 临时文件替换的原子写入机制，多窗口并发操作不丢失收藏数据，文件异常损坏自动备份为 `.corrupt-*`。
7. **V2 界面与文案去 AI 味（0.3.0，详见 `docs/STUDIO_V2_SPEC.md`）**：
   - 术语统一：画面预览 / 最近生成 / 创作 / 作品画廊 / 带回参数 / 生成变体 / 风格预设 / Kaggle 剩余算力；
   - 删除 72px 图标栏，改为固定 320px 单轨创作面板，视图切换与 GPU 状态收归顶栏；
   - 新增悬浮提示，排除项、步数、引导强度、提示词、Kaggle 账号与空闲休眠不再各占一段说明；
   - 提示词下方常驻 5 组灵感预设；润色改为四维结构化标签（光影 / 材质 / 构图 / 氛围），可追加、可撤销；
   - 创作助手改为大模型意图解析：确认卡 + 澄清卡，不再用任务状态气泡冒充对话；
   - 作品画廊支持「带回参数 / 生成变体 / 查看大图」，顶栏支持在文件夹中打开产物目录。

---

## 二、 当前核心重点 (P0)

> **状态：✅ 已在 0.4.0 完成（2026-11-11）**，实现说明见本节各项末尾。

### 1. 会话状态本地持久化（防烧配额）
- **问题现状**：当前会话仅保存在 Host 进程内存中。一旦 DSH Desktop 重启或插件热重载，内存状态丢失，但 Kaggle 上的 GPU 机器依然在后台运行，会持续消耗每周 30 小时宝贵额度。
- **实施方案**：
  - 将当前会话的 `kernelId`、`token`、`topic`、`endpoint` 实时写入 `<workspace>/.imagen/session.json`；
  - 重启后先向已有 `endpoint` 发送 `/health` 探活，若存活直接无缝恢复连接；
  - 若隧道超时，使用保存的 `topic` 重新向 ntfy 订阅找回新隧道地址；确认失联才执行远端清理。
- **实现**：`lib/session/persistence.js` + `SessionManager.restore()`。记录原子读写（目录 0700 / 文件 0600），启动关键节点落盘并做 60 秒节流；恢复顺序为「探活接管 → 用 topic 重新会合 → 尽力关机并清理」；`stop` / 成功的 `dispose` 删除记录，`fail` 保留记录供下次清理；token 不进入日志与对外快照。79 项离线断言见 `test/session-restore.mjs`。

### 2. 远端隧道自愈看护
- **问题现状**：Host 侧已经具备了“心跳丢失后重新拉取隧道地址”的恢复逻辑，但远端守护进程（`remote/daemon.py`）只在开机时上报一次地址。如果 `cloudflared` 进程中途崩溃退出，虽然 Host 想重连，远端却不会重拉。
- **实施方案**：
  - 在 `daemon.py` 内对 `cloudflared` 进程建立常驻守护线程，监控到子进程退出时立即重新拉起；
  - 获取新分配的 trycloudflare 域名后，周期性向 ntfy 重新广播 `ready` 事件，完成端到端隧道自愈。
- **实现**：`tunnel_monitor()` 常驻监管，异常退出后 2→60 秒指数退避重拉并重播 ready；主循环每 300 秒重播一次；`/health` 上报 `tunnel_provider` / `tunnel_state` / `tunnel_restarts`，ready 事件带 `provider`。纯函数与假 Popen 覆盖见 `test/remote/test_tunnel.py`。

---

## 三、 稳定性与可观测性 (P1)

> **状态：✅ 已在 0.4.0 完成（2026-11-11）**。

### 1. 排错日志面板（激活死代码）
- **现状与实施**：`remote/daemon.py` 内部已维护了最多 400 行的日志环，并支持 `GET /logs?since=N` 增量拉取；Host 侧新增 `GET /imagen-api/logs?since=N` 透传，工作台算力弹层可打开日志抽屉（增量轮询、空态/不可用原因、自动滚底、一键复制诊断信息）。
- **实现**：`lib/routes/logs.js` + `src/studio/LogsDrawer.jsx` / `useStudioLogs` / `src/logic/logs.js`；诊断文本剔除 token 类字段。契约新增 `ROUTES.logs`、`logs_unavailable` 错误码与轮询间隔。

### 2. 冷启动可靠性防护
- **版本约束机制**：默认不钉版本（0.4.0 内置的 `transformers<5` 等上限与 diffusers 新版依赖的 `huggingface-hub>=1.32` 冲突，导致 pip 解析失败，0.4.1 已回退）；需要复现时用 `pipConstraints` 显式钉死一组已验证组合，带约束装不上会自动去掉约束重试。安装后独立进程导入自检并打印版本。
- **HuggingFace 匿名限流防护**：新增可选 `hfToken`，注入后设置 `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN`（不落日志）。
- **Flux.2 磁盘预检**：按 pipeline 的 `downloadGb` 估算（1.15 倍余量）并检查 `/kaggle/working` 剩余空间，不足时在下载前给出「需 X GiB / 可用 Y GiB」的明确错误；使用预挂载权重时跳过。
- **事故复盘**：见 [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) 第 1 节（含 venv 为何不采用、如何按 pip 尾部输出判断原因）。

### 3. 配额可见性容错
- **现状与实施**：Kaggle 平台的 `kaggle account quota` 指令由于官方接口变动或代理网络问题，经常出现超时或报错导致配额显示“不可用”。现在探测失败或配额不可读时，算力弹层展示最近一次成功检查时间与当时配额、当前会话已运行时长，并给出 Kaggle 账户设置直达链接。`/state` 增加 `probeLastGood` / `probeLastGoodAt`。

---

## 四、 体验与性能进阶 (P2)

> **状态：✅ 已在 0.4.0 落地（2026-11-11）**，各项实现方式见下。

### 1. 权重预挂载（省 40 秒冷启动）
- **实施方案**：将 SDXL Lightning / Base 的核心模型权重制作并托管为公开的 Kaggle Dataset。
- **效果**：在 `kernel-metadata.json` 中配置 `dataset_sources` 直接挂载到容器只读目录，省去启动时每次通过网络从 HuggingFace 下载约 6.8GB 权重的 40~45 秒耗时，同时彻底消除下载失败风险。
- **实现**：新增 `datasetSources` 配置写入 `dataset_sources`；`localModels`（仓库 → 容器内目录）命中后直接本地加载，跳过下载与磁盘预检。Dataset 需用户自行发布，仓库结构保持 HuggingFace 原样（含 `model_index.json`）。

### 2. 隧道备用通道（穿透多路复用）
- **实施方案**：国内访问 Cloudflare trycloudflare 偶尔会遇到解析超时。当检测到 Cloudflare 隧道在 90 秒内未能建立时，自动回退到备用通道（如 Bore 或自建 FRP 实例），并在状态栏上报当前通道类型。
- **实现**：`fallbackTunnelCommand`（argv 模板，支持 `{port}`）+ `fallbackTunnelUrlRegex`，cloudflared 失败/超时后按 provider 计划尝试备用命令；`tunnelProvider` 进入会话快照并在算力弹层展示。Host 只信任 `trustedTunnelDomains` 白名单内的 https 地址，避免自定义通道泄露 token。**没有内置公共 bore 服务**（明文 HTTP，跨公网传 token 不安全），备用通道需用户自建并显式配置。

### 3. 界面交互与可访问性打磨
- **窄屏适配**：≤820px 时画面预览置顶（42vh）、面板在下方自身滚动，提交任务后进度与图片始终留在视口。
- **完成提醒**：离开工作台标签后，任务完成会在标签页标题加「● 生成完成 · 」，返回后恢复原标题并提示一次；桌面通知未采用（Web 插件不保证通知权限）。
- **无障碍与细节**：大图预览与日志抽屉增加焦点陷阱、Esc 关闭与焦点归还；图片补齐 alt；触控热区 ≥44px。`docs/DESIGN.md` 的令牌与断点未变。

### 4. 发布与开源合规
- 补齐 MIT `LICENSE` 与 `package.json` 的 `license` 字段；
- `package.json` 版本与 `docs/SPEC.md`、`CHANGELOG.md` 对齐到 0.4.0；
- 新增 `npm run package`：构建后按 `files` 清单产出 `dist/<name>-<version>/` 可加载目录，并尽力生成 zip。

---

## 五、 v0.9 开发计划

> **基线**：`0.9.0`（2026-11-13，v0.9 三个里程碑全部落地；`0.5.0 ~ 0.9.0` 变更详见 [CHANGELOG](../CHANGELOG.md)）。
> **v0.9 主题**：新手零门槛（试验特性） + 图生图闭环 + 遗留体验与可靠性收口。

### 1. M1：体验修复与可靠性收口（纯离线可测）

> **状态：✅ 已在 0.8.1 完成（2026-11-13）**，实现说明见各项末尾。

- **意图确认卡行内微调**：`ChatPanel.jsx` 确认卡里的英文 `prompt` / `negative` 支持行内直接编辑后再点「按此生成」，无需为微调几个词重新发起对话重猜。
  - **实现**：确认卡上提示词与排除项改为受契约上限约束的文本域；`useChatThread` 新增 `updateIntent` / `updateIntentField`（白名单 `prompt` / `negative`，纯函数再兜一层裁剪），生成走 `intentOverrides`——提示词仍合并风格后缀，排除项为空串时显式覆盖（卡上清空即真的不带负向词），提示词为空时按钮禁用。纯逻辑断言在 `test/check-client-logic.mjs`，交互与真实 hook 状态流转在 `test/check-client-render.mjs`。
- **卸载未关机补清理**：保持 `SessionManager.dispose()` 不阻塞卸载的取舍；若 `/shutdown` 未能发出或失败，在 `<workspace>/.imagen/` 记录轻量待清理会话，下次插件启动时优先补发一次关机释放每周 GPU 额度。
  - **实现**：新增 `lib/session/pending-cleanup.js`（版本 1、原子写、目录 0700 / 文件 0600、TTL 24h、最多补发 5 次）。`dispose()` 先**同步**写待清理记录（进程随时可能退出），再 best-effort 关机：成功清记录，失败保留记录并删除 `session.json`（避免下次 `restore()` 接手）。`index.js` 启动改为「`cleanupPendingSession()` → `restore()`」顺序执行。token 只落盘、不进日志；离线断言 65 项见 `test/session-pending-cleanup.mjs`，`test/session-restore.mjs` 的 dispose 用例同步新语义。
- **固定 `cloudflared` 版本与校验和**：`remote/daemon.py` 下载 `cloudflared` 从滚动 `latest` 改为固定版本并做 SHA256 校验，消除上游发版或半截文件导致的冷启动随机失败。
  - **实现**：固定 `2026.11.0`（`cloudflared-linux-amd64`，40,283,099 字节，SHA256 `51f7c68b…a51fd`，已与官方 Release 校验和及本机实下载复算交叉核对）；流式写 `.part` 时边写边算校验和、120 MB 上限、校验不匹配与下载异常各重试一次，第二次失败带「期望 / 实际」报错并回退备用通道。新增 9 项离线断言（假 `urlopen`/假响应流，不联网）。
- **顺手体验与文案修正**：
  - 记住表单「高级设置」折叠区的上次展开状态（默认仍保持收起）——**实现**：新增 `/imagen-api/ui-state`（GET/POST 同 path、白名单字段来自契约 `UI_STATE`）与 `<workspace>/.imagen/ui-state.json`；客户端挂载读一次、切换时 fire-and-forget 保存，失败静默回落默认值。宿主断言 21 项见 `test/ui-state-host.mjs`。
  - 校准 `auth_required` 指引文案：明确 `kaggle auth login` 写入 `~/.kaggle/credentials.json`（OAuth 凭据，靠 `refresh_token` 自动续期），同时兼容网页端手动生成的 `~/.kaggle/access_token` 与旧版 `kaggle.json`——**实现**：客户端拆出三个路径常量，`GuidanceCard`、zh/en 字典与 `lib/kaggle.js` 的探测说明统一口径。
  - 视体量评估是否一并补齐工作区对话历史持久化——**评估结论：本轮不做**。`useChatThread` 的消息里混有任务状态气泡与图片 URL，直接落盘需要额外的消息序列化版本、恢复时的中断态归一（`pending` / `running` 气泡在重启后必须收敛为可读状态）与图片失效处理；本轮已把通用的界面态持久化通道建好，对话历史作为独立批次排在 M1 之后再评估，避免把「界面偏好」与「业务数据」混进同一个文件。

### 2. M2：新手零门槛 — Node.js 直连 Kaggle 与内置 OAuth 授权（试验特性）

> **状态：✅ 已在 0.8.2 完成（离线全绿；真机 OAuth 验收见下方结论）；2026-11-15 起转为默认路径**。
> 直连 + 内置 OAuth 已成为默认（`defaultKaggleTransport: 'direct'`），`kaggle` CLI 保留为设置抽屉里的
> 「兼容」退路；老用户设置按 `schema` v2 迁移一次（v1 里存的 `cli` 视为当时的默认值，升级时丢弃）。
> 实现说明见各项末尾。

- **定位与隔离**：作为 **试验特性（Feature Flag）** 接入，默认保持现有 `kaggle` CLI 路径不变，零回归风险；在设置抽屉高级区提供开关（`experimentalDirectKaggle` / `kaggleTransport`）。
  - **实现**：契约新增 `SETTINGS.kaggleTransports = ['cli','direct']` 与 `defaultKaggleTransport: 'cli'`；运行设置抽屉「高级」区新增「Kaggle 访问方式」开关（保存字段 `kaggleTransport`），`/state` 暴露当前生效值。`lib/kaggle-transport.js` 在**每次调用**时读最新设置选择实现，切换后下一次探测 / 唤醒即生效，会话状态机零改动；默认 `cli` 行为与改造前完全一致。
- **直连客户端（`lib/kaggle-direct.js`）**：实现与 `lib/kaggle.js` 相同的调用契约（`probeKaggle`、`kaggleUsername`、`pushKernel`、`kernelStatus`、`kernelLogs`），由 `SessionManager` 通过 `deps` 注入切换；全部请求走 `lib/net.js` 复用系统代理 `curl` 兜底，消除每次 CLI 调用 9~15 秒的 Python 冷启耗时与 Windows `Scripts` PATH 困扰。
  - **实现**：逐项对照本机 `kaggle` CLI 2.2.5 / `kagglesdk` 0.1.38 源码实现 JSON API 协议（`POST https://api.kaggle.com/v1/<service>.<Service>/<Method>`、camelCase 报文、`timedelta` 的 `<seconds>s` 序列化、enum name 序列化）；凭据顺序为 `KAGGLE_API_TOKEN` → `access_token` → `credentials.json`（过期用 `refresh_token` 调 `GenerateAccessToken` 续期并原子回写 0600）→ `kaggle.json` Basic；401/403 → `auth_required`，网络错误 → `unknown`；`probeKaggle` 的 `cli` 返回 `{ present: true, direct: true }`，客户端不再误出 `cli_missing`。离线断言 14 项见 `test/kaggle-direct.mjs`（含真实抓包核对的 URL/报文形状）。
- **内置 OAuth PKCE 登录**：由宿主发起标准 OAuth 2.0 + PKCE（`S256`、`client_id="kagglesdk"`）并拉起系统浏览器授权；回调收码换取 Token 后写入 `~/.kaggle/credentials.json`（权限 `0600`，不写工作区 `.imagen/`、不进日志与诊断），并兼容读取已有 `access_token` / `kaggle.json`。无法打开本地回调的远端无头环境保留复制 URL + 粘贴授权码兜底。
  - **实现**：`lib/kaggle-oauth.js` 单实例登录状态机（`KAGGLE_LOGIN` 契约：`idle/pending/done/failed/cancelled`、`start/cancel/submit-code`、`browser/manual`、`pollMs` / `timeoutMs`），PKCE 与授权 URL 编码逐字对齐 `kaggle_oauth.py`（challenge 保留 `=` 补位）；`127.0.0.1:8000~9000` 回环回调校验 `state`，浏览器打不开自动降级 manual；`GET/POST /imagen-api/kaggle/login` 只暴露状态与授权链接。离线断言 14 项见 `test/kaggle-oauth.mjs`；真机验收脚本 `node tools/kaggle-login.mjs` 复用同一代码路径（备份旧凭据 → 真实授权 → 直连查配额）。
- **指引卡联动**：开启试验开关时，`cli_missing` / `auth_required` 指引卡主操作直接切为「在浏览器中登录 Kaggle」（支持进行中状态、取消与超时保护），完成后自动重跑 `probe` 刷新状态。
  - **实现**：直连模式下两张卡合并为登录卡：pending 显示「正在等待浏览器完成授权…」+ 取消；manual 模式显示可复制授权链接 + 授权码输入 + 提交；done 自动重跑 probe 并轻提示；失败/取消可重试；超时由宿主收敛为 `failed`。CLI 模式与旧宿主行为不变（客户端测试 57 项、逻辑测试 59 项覆盖）。
- **验收**：离线 mock HTTP 覆盖全部直连分支与边界；真机使用真实 Kaggle 账号验证无 CLI 环境下「一键登录 → 唤醒 → 出图」全链路。
  - **验收结果**：离线全绿（`kaggle-direct` 14 项、`kaggle-oauth` 14 项、Host/客户端相关用例见 CHANGELOG）；直连传输真机复核通过（`probe` / `pushKernel` / `kernelStatus` / `kernelLogs` 在真实 Kaggle 上跑通）；**内置 OAuth 真机闭环验收通过（2026-11-13）**：浏览器真实授权 → 写入 `~/.kaggle/credentials.json` → 新凭据直连探测鉴权正常、配额 7.13h / 22.87h / 30h，并顺带修复了 Windows 上 `cmd start` 截断授权链接导致的 `400 Must specify State`（详见 CHANGELOG 0.9.0「真机验收」）。

### 3. M3：图生图（Img2Img / 参考图垫图重绘）

> **状态：✅ 已在 0.9.0 完成（离线全绿；真机显存验收见 [CHANGELOG 0.9.0](../CHANGELOG.md)）**。实现说明见各项末尾。

- **模型能力边界先行**：并非所有运行时都支持 `from_pipe` 零显存派生。`models/*.json` 新增能力标记（如 `supportsImg2Img`），**首期优先对 SDXL 家族（`sdxl` / `sdxl-lora`）开放**，前端对不支持的预设（如 `flux2` / `anima`）置灰并明确提示。
  - **实现**：9 份模型资产新增 `supportsImg2Img`（7 个 SDXL 家族 true，`flux2-klein-4b` / `anima-light-lavender` false），`tools/build-assets.mjs` 校验并生成到 `shared/models.generated.js`，`publicPresets()` 自动下发客户端；daemon 不信任该标记，按 loader 白名单独立兜底。字段规则写入 `docs/MODEL_ASSET_SPEC.md` §2.2 与 model-asset-intake skill 模板。
- **契约与远端推理**：
  - `shared/contract.js` 补充 `strength` 边界与参考图尺寸/体积上限（受 `remoteGenerateMaxBytes` 约束）；
  - Host 支持引用画廊已有 `imagen-output/` 作品（严格校验工作区越界）或接收前端上传/缩放后的参考图；
  - `remote/daemon.py` 的 `run_task` 在收到参考图时通过 `AutoPipelineForImage2Image.from_pipe(pipe)` 复用已加载底座执行重绘（不额外占显存），产物 `meta.json` 记录 `sourceImage` 与 `strength`。
  - **实现**：契约 `LIMITS.reference = { maxBytes: 8 MiB, maxEdge: 1536, minEdge: 128 }` 与 `LIMITS.strength = { min: 0.2, max: 0.9, step: 0.05, default: 0.6 }`，并入 `daemonContract().limits` 与 `remote/contract.json`。Host 在 `JobQueue.submit` 做参考图词法/base64/魔数/体积校验与强度归一，执行期用 `resolveOutputPath` 读取画廊文件（只允许输出目录、拒绝软链接逃逸）后以 job 级 `reference` 下发；`meta.json` 记录 `sourceImage` / `strength`。daemon 提交期只读图片头（loader 白名单、base64、体积、PNG/JPEG、最小长边、强度）→ 400，执行期在加载模型前完整解码一次并等比缩小，再惰性 `from_pipe` 复用底座（`STATE.img2img_pipe`，随切换/释放清空）；`/health` 新增只读 `gpu_memory` 用于真机显存对比；请求体上限按契约参考图上限推导。
- **工作台交互**：画廊卡片与大图预览新增「以此图重绘」一键带入；创作面板新增精简参考图槽位与重绘强度滑块（未放参考图时文生图界面保持不变）。
  - **实现**：参考图槽位只在有图时出现（缩略图 + 文件名 + 移除 + 强度滑块），文生图界面零变化；不支持垫图的预设置灰并在生成时拦下（不发请求、不静默丢图）；从画廊带入时若当前预设不支持，自动切到 `sdxl-lightning` 并轻提示。文案中英文各 +13 键。
- **验收**：契约与客户端单测覆盖边界与降级；真机 `2×Tesla T4` 验证单一会话内「文生图 → 垫图重绘」显存无额外增长。
  - **离线**：daemon 单测 232 项（+59，含真实 Pillow 可选集成用例）、`host-e2e` 41 项（含参考图全链路与越界拒绝）、`jobs-wait` 23 项（参考图校验/载荷/meta）、客户端逻辑 63 项 / 渲染 64 项 / 文案 396 键全绿。
  - **真机**：`node test/gpu-live.mjs --preset sdxl-lightning --img2img` 已在 2×Tesla T4 跑通：文生图 15.63s → 垫图重绘 7.0s（`loadSeconds=0`，from_pipe 复用底座），重绘前后 `/health.gpu_memory` 的 `allocated_mb` 7000→7000、`max_allocated_mb` 10233→10233、`reserved_mb` +2 MiB（噪声），**显存无额外增长**；产物与版本快照见 CHANGELOG「真机验收」小节。

---

## 六、 创作面板减法与 AI 助手升级

> **状态：✅ 已在 0.10.0 落地**，实现说明见各项末尾；设计参考见 [STUDIO_PANEL_AND_ASSISTANT_DESIGN.md](STUDIO_PANEL_AND_ASSISTANT_DESIGN.md)，变更明细见 [CHANGELOG](../CHANGELOG.md) 的 0.10.0 条目。

- **创作参数面板重构**：聚焦「快速换词 + 调比例 + 多张抽卡」高频场景——移除静态 5 风格黑盒拼接、按模型能力隐匿无效排除项（`CFG=0` 场景）、理顺画面设置与参考图互斥关系、提权生成张数与折叠摘要。
  - **实现**：删除 5 个风格试印条、`StylePlate` 与提交时的风格后缀 / 负向词拼接；「排除项」改由 `shared/models-guide.js` 的 `negativePromptActive(preset, cfg)` 判定显隐（Host 与 Client 共用），`CFG=0` 的极速模型与不支持负向词的 `flux2-klein-4b` 默认隐藏、提交时不再发无效参数；有参考图时「画面设置」只显示「跟随参考图」读数与说明，文生图时按 `RATIO_IDS` 选比例 → 分辨率档位（长边）→ 自定义宽高折叠，档位数值按比例缩放并对齐 `LIMITS` 步长；生成张数（1~4）从高级区提权到底部主视线；高级设置折叠态显示读数摘要（如 `4 步 · CFG 0 · 随机种子`）并补「恢复随机」；功能标签字号由 10.5px 提升到 11px，同步清理过时文案。
- **AI 助手设计与提示词打磨**：将「助手从 0 到 1 启发与组织、表单从 1 到 N 批量抽卡」两条线打通；向大模型统一注入身份认知、模型库最佳实践与软性引导策略（不依赖强硬分支规则）。
  - **实现**：新增 `shared/models-guide.js` 作为模型知识唯一口径（提示词配方、负向词能力、全库用法摘要），由 `lib/intent.js` / `lib/enhance.js` / `lib/tools.js` 与客户端共同消费；系统提示词改为「身份与使命 / 模型手册 / 组织与沟通策略」三段式；意图 JSON 升级为 v2（`prompt` / `summary` / `ratioId` / `negative` / `clarify` / `modelHint`），边界写入契约 `INTENT`；`lib/llm.js` 支持 `options.messages` 多轮消息（内容块数组为多模态预留），`POST /intent` 请求新增 `history` 并按 `LIMITS.intentHistory` 裁剪；确认卡改为摘要优先、支持内联编辑与张数分段，新增「带入参数面板」，空态示例只填对话草稿，通用澄清卡提供 2~4 个选项与「先按当前设置」。
- **远期迭代方向**：支持参考图视觉理解与交互式追问，以及「灵感图墙 + 关键 Prompt 词拆解」学习体验。

> **验证**：离线断言覆盖负向词显隐、分辨率档位、张数提权、确认卡与通用澄清、多轮 `history`——`check-client-logic` 64、`check-client-render` 70、`check-client-locale` zh/en 各 399 键、`host-e2e` 46、`daemon-unit` 232，其余既有套件不变，`npm test` 全绿。远端链路未改动（`remote/daemon.py` 仅版本号变更），本轮无新增真机验收；变更明细见 [CHANGELOG](../CHANGELOG.md) 的 0.10.0 条目。

---

## 七、 工程架构解耦与代码组织重构

> **状态：✅ 已在 0.11.0 落地（2026-11-15）**。Batch 0–3 全部收口，现版本已实际用于真机开机生图（ZIP 自引导解包、配置注入与推理链路正常）。完整模块边界与后续可选演进项见 [REFACTOR_ARCHITECTURE_SPEC.md](REFACTOR_ARCHITECTURE_SPEC.md)。

针对 `remote/daemon.py`（原 2579 行）的全局状态耦合、胶水转发函数、`if/elif` Loader 分支散落，以及 Host 侧 `lib/jobs.js`（原 948 行）/ `lib/kaggle-oauth.js`（原 674 行）体量偏大问题，分 4 个批次完成重构（打包器先于远端包化，避免子目录包受限于 `@@INLINE` 拼接）：

1. **Batch 0 — 打包器升级**：`lib/kernel.js` 从 `@@INLINE` 行替换改为内嵌 Base64 ZIP 自引导，`lib/bundle.js` 产出确定性归档；配置注入改为 `set_embedded_config()` 函数调用；`remote/contract.json` 随包分发；`verify-model` 复用同一打包器；`package.json` `files` 与 `scripts/package.mjs` 同步放行 `.json`。
2. **Batch 1 — Host 侧收口**：`lib/jobs.js` 拆为 `lib/jobs/{validator,errors,reference-loader,queue}.js`，`lib/kaggle-oauth.js` 拆为 `lib/kaggle/oauth/{pkce,browser,callback-server,session,text}.js`，原路径保留 16 / 23 行聚合门面，调用方零改动。
3. **Batch 2 — 远端包化 + 测试领域化**：按域拆出 `remote/{config,state,observability,infra,inference,jobs,transport}` 与 `app.py` 组装根，引入 `LoaderRegistry` 与表驱动调度器，删掉 `daemon.py` 上 30 个转手转发名与 `JOB_WAKE`，`daemon.py` 降至 1223 行。同步将 `test/daemon-unit.py` 按域拆到 `test/remote/` 下 15 个模块，改用单例原地重置与实例化测试。
4. **Batch 3 — 契约收口与真机验证**：`_FALLBACK_LIMITS` 已删除，`remote/config.py` 导入期直接读内置 `contract.json`（无注入契约时宽高 256–1536、steps ≤ 60、cfg ≤ 20、每批 ≤ 4）；`test/mock-daemon.py` 夹具同步并用 `MockDaemonContractTest` 守卫。离线全绿（`test/remote/` 296 项、契约 11 项），且现版本已通过真机开机生图验证。

> **0.11.0 同期落地的其余改动**：画廊卡片支持单张删除（二次确认）、Kaggle 访问方式默认切换为直连（`settings.json` schema v1 → v2 迁移）、npm 包名切换为 `dsh-our-imagen` 并接入 Trusted Publishing、官网展示与成片更新；另顺带修复了 `lib/fs-atomic.js` 在 Windows 上遇到文件瞬时占用抛 `EPERM` 的问题（`rename` 最多重试 5 次）。

---

## 八、 按模型按需预挂载官方 Kaggle Dataset（规划中）

> **状态**：📝 规划中。完整方案与实施清单见 [PRESET_DATASET_PREMOUNT_PLAN.md](PRESET_DATASET_PREMOUNT_PLAN.md)。

- **目标**：免去普通用户手动配置 `datasetSources` 与 `localModels` 的门槛，按启动时选中的 `presetId` 自动挂载对应精简公开 Dataset（共用 SDXL 底座合并打包），并保留显式开关、用户自定义覆盖优先与 `pushKernel` 404 自动回退 HuggingFace 的容错兜底。

---

## 九、 工作台双向同步与创作流转

> **状态**：✅ 已在 0.12.0 落地。设计参考与边界约定见 [STUDIO_SYNC_AND_ITERATION_DESIGN.md](STUDIO_SYNC_AND_ITERATION_DESIGN.md)，交互规范见 [SPEC.md](SPEC.md) §5.14。

- **目标**：理顺参数表单、创作助手与胶卷之间的流转边界——「清空对话」改为「新建对话」（开启新上下文）；表单生成同步到助手时展示细粒度参数摘要且不污染多轮 `intentHistory`；创作区点击胶卷自动带入原图参数（保留 Seed、保护未提交草稿），并明确「版本微调」与「新建创作」的重置边界。
- **实现**：
  - **新建对话**：`useChatThread.clearThread` 改为 `newChat` 并引入线程代次守卫——解析中点击会就地复位解析态，旧请求返回整条丢弃；按钮同时清空输入草稿。
  - **表单提交同步**：`generate()` 提交成功后写入 `kind='form'` 的参数同步记录（`formSummaryOf` 提供模型 / 比例与像素 / 张数 / 是否含参考图 / 种子策略），助手面板用白卡 + 胶囊渲染；`intentHistory()` 跳过带 `kind` 的用户记录，表单提交不再污染意图模型的多轮上下文。
  - **胶卷回填与草稿保护**：新增 `<studio>.actions.previewWork`，始终切换预览；表单干净时用 `iteratePatch` 回填（含原图 Seed、清理残留 reference），脏时保留草稿并提示「已保留当前草稿」；画廊保持纯浏览。
  - **微调 / 新建创作边界**：新增 `src/logic/form.js`（`formSnapshotOf` / `isFormDirty` / `newCreationPatch`）与表单域的 `dirty` / `tuning` / `markClean` / `applyRecall` / `newCreation`；参数面板顶部显示「正在微调：<作品提示词>」与常驻「新建创作」，重置只清绑定上一张作品的状态，保留当前模型与画幅。
  - **测试**：`check-client-logic` 与 `check-client-render` 覆盖代次守卫、上下文隔离、草稿保护、胶卷接线与新建创作边界；文案 zh/en 严格同构。

---

## 十、 Agent 批量创作、风格配方检索与画布局部重绘 (Inpaint)

> **状态**：✅ 已在 0.12.0 落地（离线全绿；局部重绘真机验收通过，并追加 9 通道专用权重预设 `sdxl-inpaint`）。方案与验收标准见 [AGENT_BATCH_AND_INPAINT_PLAN.md](AGENT_BATCH_AND_INPAINT_PLAN.md)，交互规范见 [SPEC.md](SPEC.md) §3.2 / §3.3 / §5.15。

- **阶段一（Agent 批量与风格配方）**：在 `lib/tools.js` 新增 `imagen_batch`（基于 `lib/jobs/queue.js` 逐项入队、单条失败隔离与统一汇总）与只读检索工具 `imagen_recipes`（提供透明、适配开源模型写法的风格模板，不做暗箱拼接）。
  - **实现**：`imagen_batch` 单次 1~`LIMITS.batch.maxItems`（8）条、每条固定 1 张，`waitSeconds` 是整批总等待预算（预算用尽停止等待但不取消任务，返回 `jobId` 供轮询）；条目数超限整批拒绝，`saveTo` 逐项走交付校验并检测重复，单条异常只影响该条。新增 `shared/recipes.js`（8 条配方、按 `promptStyle` 分键的 `promptTemplate`、`searchRecipes` / `templateFor` / `validateRecipes` 纯函数），工具只返回可见文本与检索建议。离线断言 17 项见 `test/agent-batch.mjs`。
- **阶段二（画布涂抹局部重绘）**：扩展 `shared/contract.js` 的 `reference.mask` 契约，在 `remote/daemon.py` 通过 `AutoPipelineForInpainting.from_pipe` 复用 SDXL 底座实现零显存增量局部重绘，并在 `src/studio/Stage.jsx` 增加轻量涂抹蒙版层。
  - **实现**：契约新增 `LIMITS.mask = { maxBytes: 2 MiB }` 并随 `daemonContract()` 下发（`remote/contract.json` 同步）；模型资产新增 `supportsInpaint`（SDXL 家族 7 个 true，`build-assets` 校验它不能脱离 `supportsImg2Img`）。Host 在 `normalizeReference` 做 PNG 魔数 / 体积 / 无参考图拦截，执行期把 `{ image_b64, strength, mask_b64 }` 透传远端，出图路由请求体上限改为按「参考图 + 蒙版」推导，产物 `meta.json` 记 `inpaint: true`。远端新增 `SUPPORTED_INPAINT_LOADERS` 与 `ensure_inpaint_pipeline()`（`from_pipe` 惰性复用、随切模型 / `release_pipeline()` 清空），`decode_mask_image()` 执行期解码一次、转灰度 `'L'` 并按最近邻对齐参考图宽高，`run_task` 走 `image` + `mask_image` + `strength` 分支（出图尺寸跟随参考图）。客户端新增 `src/logic/mask.js` 纯逻辑与 Stage 涂抹层（画笔大小 / 橡皮擦 / 清空 / 反选，触控 + 键盘，热区 ≥44px），表单按 `supportsInpaint` 门控并在换图 / 回填 / 新建创作时清蒙版，蒙版指纹纳入脏判定。
  - **离线验收**：`test/remote/run.py` 371 项（+18 专用权重分支）、`test/jobs-wait.mjs` 25 项、`test/host-e2e.mjs` 48 项（含参考图 + 蒙版接近上限不被 `invalid_body` 拦截的边界用例）、客户端 logic 77 项 / render 89 项全绿。
  - **追加：9 通道专用权重预设（`sdxl-inpaint`）**：通用底座的 `from_pipe` 路径边界融合有限，因此新增 `models/sdxl-inpaint.json`（`diffusers/stable-diffusion-xl-1.0-inpainting-0.1`），用 `inpaintOnly` + `pipeline.nativeInpaint` 标记「只能带蒙版使用、加载后即为 inpaint 管线」；daemon 用 `AutoPipelineForInpainting.from_pretrained` 加载并直接复用底座，Host / daemon 双层拦截无蒙版请求，客户端缺蒙版时拦下生成并提示、默认强度取 0.9、参考图兜底预设跳过它。真机验收（2×T4）：40% 中心蒙版 + 「蓝色大象」提示词下象头明确生成（蒙版内平均差异 41.9/35.7/30.9，通用模型同用例约 25），保留区逐像素不变（0.00），边界融合更自然；整图蒙版可完整按提示词成图；小蒙版（约 2.5% 面积）时上下文补全压过提示词，属模型行为，已在 UI 提示与文档中说明。1024² / 30 步单张 20.9~24.9s。  - **真机验收（2026-11-16，4 轮通过）**：`node test/gpu-live.mjs --preset sdxl-lightning --inpaint` 在 Kaggle 2×Tesla T4（diffusers 0.43.0 / torch 2.11.0）验证：文生图 9.96~12.34s → 局部重绘 9.25~9.88s，`load_seconds=0`（`from_pipe` 复用已加载底座），出图 1024×1024 与参考图、蒙版尺寸一致；重绘前后 `allocated_mb` 7000→7000、`reserved_mb` 10776→10780（+4 MiB 噪声）、`max_allocated_mb` 不变，**零显存增量**确认。像素对比：蒙版内平均绝对差约 9.7/255，完全落在黑色保留区的边框带仅约 1.5/255（VAE 往返噪声）；换提示词后强度 0.6 只跑 2 步、变化约 3.8/255（偏弱），≥0.76 跑 3 步、变化约 25/255（明显重写），0.8 与 0.9 因 `int(steps × strength)` 量化输出逐字节相同。据此把「进入涂抹模式时的默认强度」定为 0.8（用户调过的值不覆盖），契约区间不变；大面积蒙版在高强度下边界会出现硬接缝（4 通道混回分支的固有表现），实际笔刷小区域更自然，已记入 [CHANGELOG](../CHANGELOG.md)。验收脚本同时补齐：默认直连推 Kernel、`--inpaint-prompt` 对照提示词、`--max-queue-minutes` / `--max-replace` 排队超时自动换新实例重排（本轮第二次验收即靠它从卡住的 QUEUED 恢复）。产物见 `bench-results/gpu-live/`（`01.png` / `02-inpaint.png` / `report.json`）。
---

## 十一、 状态流转与局部重绘可用性修复

> **状态**：✅ 已在 0.12.0 落地（2026-11-17）。完整问题清单、已拍板的交互决策与分批方案见 [STUDIO_STATE_FLOW_AND_INPAINT_FIX_PLAN.md](STUDIO_STATE_FLOW_AND_INPAINT_FIX_PLAN.md)，交互规范见 [SPEC.md](SPEC.md) §5.16。

- **背景**：0.12.0 局部重绘上线后的代码审计发现 13 项问题，其中 11 项确认属实（2 项状态流转冲突、5 项可用性闭环、画布比例/空舞台/强度档位等），1 项需真机核实（非正方形参考图在 9 通道模型下的推理尺寸），1 项属契约权衡（`strength` 上限 0.9 对 9 通道偏保守）。
- **已拍板**：表单有参考图/蒙版时胶片条只切预览；助手与变体强制纯文生图、`inpaintOnly` 缺省时自动切普通预设；重试恢复原任务参考图；蒙版场景 `strength` 放宽到 1.0；羽化半径自适应；远端拦截空蒙版。
- **实现**：
  - **P0-a 状态安全**：`src/logic/generate.js` 新增来源策略（`generateSourcePolicy` / `effectivePresetOf` / `generateCapabilityOf`）与重试恢复计划（`retryReferencePlan`），`useStudio.generate()` 按 `source`（form / assistant / variant / retry）统一消费，助手与变体显式 `reference: null`、`inpaintOnly` 预设本次请求切兜底预设；胶片条点击优先级改为「参考图保护 → 草稿保护 → 回填」；失败重试恢复参考图与同源蒙版，蒙版不可恢复时只把参考图填回表单并请求重涂（不自动提交）。
  - **P0-b 首次使用与续绘**：`useStudioUi` 新增 `paintRequest` 计数信号（`Stage` 消费后归零，跨视图挂载有效）；`ReferenceSection` 空槽位三形态（`inpaintOnly` 两步引导 / 普通模型单行入口 / 不支持垫图隐藏）+ 蒙版覆盖率与「继续涂抹 / 清空蒙版」；舞台新增「以此结果继续重绘」闭环（设为新参考图、清蒙版、自动涂抹）；页脚标注「本次基于 <文件名> 重绘」。
  - **P1 正确性**：`.ofs-mask-stage` 比例改用容器单位公式（不再被 `max-height` 压扁），指针 / 键盘光标按 rect 宽高两轴换算；空舞台复用蒙版编辑器；涂抹中点胶卷退出涂抹态；强度自动档随 `inpaintOnly` 预设联动、带蒙版上限 1.0。
  - **P2 远端收敛**：契约新增 `LIMITS.strength.inpaintMax = 1.0` 与 `LIMITS.mask.minCoverage = 0.0005`（`remote/contract.json` 同步、`remote/config.py` 登记注入键）；Host 与 daemon 的强度口径按「是否带蒙版」切换；daemon 解码后校验蒙版覆盖率（空蒙版在加载模型前 `invalid_request`，全白放行）；羽化半径按覆盖率分档（2 / 4 / 6~8px）；局部重绘显式下传按 8 对齐的参考图宽高，修复非正方形畸变。
- **测试**：`check-client-logic` 85 项、`check-client-render` 99 项、`check-client-locale` zh/en 各 477 键、`host-e2e` 50 项、`jobs-wait` 26 项、`test/remote/run.py` 390 项、`check-contract` 12 项；`npm test` 全绿。
- **真机验收（2026-11-17，Kaggle 2×Tesla T4，diffusers 0.43.0 / torch 2.11.0）**：
  - **非正方形（9 通道 `sdxl-inpaint`）**：1024×768 源图 + 3% 圆形蒙版，出图 **1024×768**、参考图与蒙版尺寸一致，日志 `kw` 含 `width/height`、`[gen] inpaint 蒙版覆盖率 3.00% 羽化半径 4px`——不再被缺省方形推理后拉回，也没有拉伸畸变；单张 20.1 / 22.7s，`/health.gpu_memory` 的 `max_allocated_mb` 保持 9465 不变。
  - **精细小蒙版**：3% 覆盖率落在「< 5%」档，羽化半径 4px（此前固定 8px）。
  - **强度 0.9 vs 1.0**：同一蒙版、同一提示词（红唇 → 蓝唇）下蒙版内平均差异 26.46 vs 21.92，两次输出不同（882437 / 893187 字节）说明 1.0 有独立效果；差异值不随强度单调递增——「替换更强」不等于「像素差更大」，0.9 与 1.0 均按新提示词重写。
  - **连续两轮局部重绘（通用底座 `from_pipe`）**：`sdxl-lightning` + 1024×768 + 25% 蒙版连跑 2 轮，第 2 轮以第 1 轮出图为参考图（`referenceRole=previous-round`）；两轮 `load_seconds=0`（复用底座）、蒙版内平均差异 16.44 → 21.29（对上轮）/ 32.81（对首轮源图），单张 6.53 / 6.52s；显存 `allocated_mb` 7000→7000、`reserved_mb` +4 MiB、`max_allocated_mb` 不变（零额外占用）。
  - **无遗留 Kernel**：两轮验收结束 `session.stop()` 均返回 `absent`；复验 `GetKernelSessionStatus` 最终 Kernel 为 `COMPLETE`，三次「排队超时换新实例」产生的旧 Kernel 均已删除（403 → missing），无 `RUNNING` / `QUEUED` 条目。


---

## 十二、 舞台图片处理工具栏与交互解耦（已完成）

> **状态**：✅ 已在 0.13.0 落地（2026-11-17，尚未发版）。完整设计与交互规格见 [STAGE_IMAGE_TOOLS_PLAN.md](STAGE_IMAGE_TOOLS_PLAN.md)，交互规范见 [SPEC.md](SPEC.md) §5.17。

- **背景**：当前把参考图与蒙版挂在左栏全局表单上，导致「选图→挂参考图→点涂抹→回左栏生成」链路过长，且容易与文生图表单、胶片条回填、对话助手产生状态串台；同时缺少统一的舞台图片后处理入口（如未来的高清化、扩图）。
- **核心设计（方案 B）**：
  1. **状态彻底解耦**：左栏主表单回归纯粹文生图；抽离独立 `useImageTool` 状态域管理舞台图片处理动作，提交不经过/不污染左栏表单。
  2. **舞台动作坞（`.ofs-dock`）**：围绕当前展示作品提供 **`局部涂抹`**、**`整图重绘`** 等一步直达入口，并预留「高清放大 / 扩图」扩展位（统一 `instant / inline / canvas` 三类交互形态）。
  3. **原地闭环**：点「局部涂抹」直接以当前作品为底图打开画布并内置轻量 Prompt / 强度 / 提交栏，复用第十一阶段沉淀的契约与远端推理底座。
- **实现**（阶段十二三条 Phase 全部落地，纯前端改动、远端推理与 HTTP 契约零改动）：
  - **Phase 1 状态抽离与动作坞**：新增纯逻辑 `src/logic/imageTool.js`（`IMAGE_TOOLS` 注册表按 `instant / inline / canvas` 三类形态描述，inpaint / img2img 为真实可用工具，upscale / outpaint 为禁用占位；`toolPresetOf` 自动选模、`toolStrengthDefaultOf` / `toolStrengthMaxOf` 强度档位、`buildImageToolBody` 请求体、`imageToolBlockedKeyOf` 提交前拦截）与独立状态域 `src/studio/hooks/useImageTool.js`（底图 / 提示词 / 工具预设 / 强度 / 蒙版，提交不经过左栏表单）。`Stage` 拆出 `src/studio/stage/{ImageDock,MaskEditor,InlineTool,ToolSubmitBar}.jsx`，动作坞按「图片处理 / 创作复用」分组；`ModelCardPicker` 把 `inpaintOnly` 预设移出主表单并标记「仅图片工具可用」。
  - **Phase 2 舞台内嵌提交栏与表单净化**：涂抹画布与整图重绘条内置轻量提交栏（修改描述 / 重绘强度 / 模型胶囊 / 提交 / 退出）；提示词默认空、placeholder 显示原作品提示词，提交为空回退原提示词（Lead 决策 D2）。删除左栏 `ReferenceSection` 与 `useStudioForm` 的 `reference` / `strength` / `mask` / 来源策略 / 重试恢复逻辑（`generate.js` 缩减 303 行），主表单请求体不再可能携带 `reference`；`inpaintOnly` 预设下主表单生成自动切兜底预设并轻提示。工具任务失败保留底稿，动作坞「继续编辑」恢复。
  - **Phase 3 统一工具扩展框架**：按 `instant / inline / canvas` 三类交互形态收敛注册表，用 inpaint（canvas）与 img2img（inline）两个真实工具完成端到端验证；高清放大 / 扩图保留禁用占位与 `planned` 提示（远端暂无对应推理能力，Lead 决策 D1，需新权重与真机显存验收后再接入）。
  - **测试**：新增 `test/image-tool.mjs`（19 项纯逻辑）与 `test/image-tool-render.mjs`（6 项 hook/Stage 渲染）；`check-client-render` 95 项、`check-client-logic` 83 项（旧参考图 / 涂抹 / 续绘 / 来源策略用例逐条改写为新交互断言，清单见 CHANGELOG 与本轮提交说明）、`check-client-locale` zh/en 各 470 键同构。
  - **遗留**：`src/studio/icons.jsx` 暂无 `frame` 图标（扩图占位在渲染层回退 `expand`）；`stage.css` 两条旧入口死样式由阶段十三随手清理。

---

## 十三、 显式新建绘图、多作品草稿与树状版本管理（已完成）

> **状态**：✅ 已在 0.13.0 落地（2026-11-17，尚未发版）。完整设计与状态模型见 [WORKSPACE_DRAFTS_AND_VERSIONING_PLAN.md](WORKSPACE_DRAFTS_AND_VERSIONING_PLAN.md)，交互规范见 [SPEC.md](SPEC.md) §5.18。

- **背景**：将创作体验从「表单为中心」进一步升级为「以作品和草稿为中心」的工作区——明确区分「新建绘图」与「基于已有作品迭代」，支持多图切换保留编辑草稿、同批候选图各自独立派生树状版本。
- **核心设计**：
  1. **显式新建绘图态**：点击「新建绘图」时舞台切入模糊动态背景与取景框，底部作品条左端插入「新建草稿卡」；提交入队后转成排队卡，等待期间可自由切换浏览与编辑其它作品。
  2. **多作品草稿 + 圆点标记**：按 `workKey` 缓存未提交的涂抹蒙版与重绘微调（带 LRU 上限），作品条缩略图及版本节点以圆点提示改动项，避免切图丢稿。
  3. **批与树状版本管理**：同一批提交的 1~4 张候选图各自作为独立迭代起点（`v1`），记录 `sourceImage` + `rootImage` 形成树状版本链；作品条按根折叠并展示 `⎇ N` 角标，支持延迟 hover / 点击固定展开「版本派生树面板」（含草稿圆点与在途幽灵节点）。
- **实现**（Phase 1–3 全部落地；远端推理零改动，Host 只补元数据与历史接口）：
  - **Phase 1 Host 版本链**：`lib/output.js` 新增 `rootImage` 解析（父作品 meta 继承 / 旧 meta 沿 `sourceImage` 链回溯 ≤8 层 / 读不到退回 `sourcePath`；动态上传参考图写 `null`），`/history` 每条 item 透传 `sourceImage / rootImage / inpaint / strength`；新增 `GET /imagen-api/history/tree?root=&limit=`（`ROUTES.historyTree`，越界/空 root 400 `invalid_request`，默认 limit=`LIMITS.history.pageSize`），供版本面板跨分页补齐。旧数据无需迁移。
  - **Phase 2 显式新建绘图态与多草稿**：`workspaceMode`（`new_draft` / `work`）与 `actions.newDraft()`；Stage 在新建态渲染模糊动态背景 + 按表单画幅的取景框（`prefers-reduced-motion` 静态化），Filmstrip 最左端出现新建草稿卡；提交后保持新建态，任务完成后自动切 `work` 并选中新图（用户中途点作品则立即切 `work`）。`useImageTool` 以加法方式旁路扩展 `workDrafts`：按 `workKey` 缓存未提交编辑（工具 / 提示词 / 强度 / 预设 / 蒙版 / 改动项 / `lastTouchedAt`），LRU 8、仅会话内存；打开工具优先恢复该作品草稿，提交成功清除、失败保留；提供 `clearWorkDraft / workDraftSummary / patchDraft`。
  - **Phase 3 版本树归并与派生面板**：新增纯逻辑 `src/logic/lineage.js`（`buildLineage`：rootImage/sourceImage 归组、depth 与 `v1/v2a/v2b` 版本号、同父兄弟排序、父图缺失提升局部根 `sourceDeleted`、在途任务幽灵节点；`lineagePanelRows` 前序遍历 + 草稿摘要；`rootOfItem` 旧数据回溯；`lruDrafts` / `workDraftSummary` / `draftKeyOf`）。Filmstrip 按根折叠（一树一卡、缩略图取最新活跃节点、`⎇ N` = 派生 + 在途），复用 `VersionPanel`（悬停 250ms / 点击角标固定 / Esc 收起 / hover bridge、行内版本号 / 来源类型 / 草稿圆点 / 幽灵行），打开时 footer 加 `is-version-open` 放开 `.ofs-roll` 溢出；根不在已加载分页时按需 `fetchHistoryTree`，旧宿主 404 只降级提示一次。
  - **交互修正**：画廊 / 大图「以此图重绘」补齐「选中该作品 + 切回舞台 + 打开局部涂抹」（`openImageTool` 收 entry 时 `library.selectImage`）；清理阶段十二遗留的 `.ofs-continue-inpaint` / `.ofs-mask-bar` 死样式。
  - **测试**：`host-e2e` 54 项、`jobs-wait` 31 项、新增 `test/lineage.mjs` 17 项；客户端 `check-client-render` 104 项（+9：根折叠角标、面板悬停/固定/Esc/点行、幽灵行 + 按需拉树、草稿缓存/圆点/清空、旧宿主 404 降级、父删局部根、新建态渲染、新建提交完成切回）、`check-client-logic` 82 项、`check-client-locale` zh/en 各 495 键同构。
  - **已知取舍**：`workDrafts` 仅存内存（刷新丢失，设计如此）；版本面板的溢出处理目前是 CSS 打开态方案，真机极端溢出时需改 fixed 定位；`/history/tree` 无 offset 游标（`hasMore` 时前端只用首屏 100 条）；同一作品同一时刻只有一份编辑草稿（换工具会覆盖上一工具的草稿，再点开时才按工具 `changed` 判断是否显示圆点）。

---

## 十四、 Google Colab（重点 Colab Pro）后端接入（规划中）

> **状态**：📝 调研完成、待排期验证（2026-11-17）。完整协议与架构蓝图见 [COLAB_BACKEND_RESEARCH.md](COLAB_BACKEND_RESEARCH.md)。

- **背景**：新增 **Google Colab（重点适配 Colab Pro）** 无头计算后端，沿用纯 Node.js 原生直连控制面路线（零本机 Python/CLI 依赖），以支持 `L4`（24GB）/ `A100`（40GB/80GB）/ `HIGH_RAM` 等单卡大显存规格，突破 Kaggle 双 T4 分片与 20GB 磁盘只读限制。
- **排期与里程碑**（后端算力线，与前端十二/十三阶段解耦，可并行或在十一收口后穿插推进）：
  1. **M0 — 真机探针验证（前置门禁，编码前必做）**：运行 3 个独立最小 Node.js 探针脚本，依次验证 ① OAuth `localhost` 回调与 `ccu-info` / `assign(L4)` / `unassign` 控制面返回；② Jupyter Contents 上传 + Kernel WebSocket 启动与 **30s 心跳防回收（过 35 分钟验证）** + `cloudflared` URL 回传；③ 探索 Colab Runtime Proxy 能否替代 `cloudflared`（不阻塞主线）。
  2. **M1 — 算力 Provider 抽象抽离**：将 `lib/session.js` 中与 Kaggle 耦合的生命周期抽为 `ComputeProvider` 契约（`authenticate` / `probe` / `provision` / `pollEndpoint` / `keepAlive` / `teardown`），现有逻辑收敛为 `KaggleProvider`，回归全套 `session-*` 测试零退化。
  3. **M2 — `ColabProvider` 与 `remote/` 容器适配**：实现 `lib/colab/{oauth,client,jupyter}.js`（OAuth 原子存盘、XSSI 剥离、30s Kernel WS 心跳 + 60s TFE ping + Proxy Token 刷新）；消除 `remote/` 中 `/kaggle/working`、`/kaggle/input` 与双卡 `device_map="balanced"` 等硬编码假设，适配 `/content` 与单卡大显存。
  4. **M3 — 契约、UI 接线与真机验收**：`shared/contract.js` 扩展 `provider: 'kaggle' | 'colab'`、GPU 型号（`T4/L4/A100`）与 `highRam` 设置项；状态栏展示 Colab CCU 余额与消耗速率、空闲关机可靠触发 `unassign`；完成 Colab Pro 真机开机出图 + 35 分钟保活 + 关机释放验收。

---

## 十五、 工作台交互语义对齐、双向助手闭环与模型原生参考演进（规划中）

> **状态**：🟡 Phase 0 与 Phase A 已完成（2026-11-18，未发版），Phase B / C 待排期。完整方案与分期路径见 [STUDIO_UX_POLISH_AND_MODERN_PIPELINE_PLAN.md](STUDIO_UX_POLISH_AND_MODERN_PIPELINE_PLAN.md)。

- **背景**：0.13.0 收口舞台工具解耦与版本树后，继续解决「外部图片导入与全局可发现性」「文生图原生参考能力缺失」「表单-舞台-助手三向协同」及「后处理闭环」问题；放弃多模态看图过渡方案，直接基于图像模型原生能力演进，避免为 SDXL 堆砌过时外挂技术债。
- **核心设计**：
  1. **语义、导入与版本树边界**：舞台动作坞「生成变体」改名「重新生成」并下线「带回参数」，画廊卡片收敛至切回工作台统一颗粒度；左栏编辑自动托管进最左端「新建草稿卡」并提供「还原原图」；新增本地图片导入落盘（`/imagen-api/import`），明确「原地改图（`v1 → v2`）」与「左栏参考生新图（`参考槽 → 新 v1`）」的语义边界，并定义新画布与浏览态的按区拖放与编辑态保护规则。
  2. **双向聚焦时间线**：助手支持 1~4 张结果网格、镜像同步舞台图片工具动作、点击单图钻取聚焦与顶部「返回上一层」导航（不污染 `intentHistory`）。
  3. **四阶段推进（Phase 0 → A → B → C）**：先修复 DSH 宿主 `llm` 注入与流式调用（润色/英译/对话）→ 落地交互收敛、双向聚焦、本地导入、拉帘对比与 PNG 元数据 → 点亮动作坞「高清放大（`upscale`）」与「快捷比例扩图（`outpaint`）」→ 先在 Kaggle `2×T4` 真机实测 `FLUX.2 Klein 4B` 参考推理并抽象 `supportsReference` 能力，再落地左栏多图参考槽与批量分镜（并在 Colab L4/A100 后顺势引入 `FLUX.2 Klein 9B` / `Qwen-Image-Edit`）。
- **实现（Phase A 已完成，2026-11-18）**：
  - **A1 动作语义与草稿托管**：`ImageDock` 下线「带回参数」，「生成变体」改名「重新生成」；`GalleryCard` 动作收敛为「在工作台打开 / 重绘编辑 / 查看大图 / 收藏 / 删除」，画廊不再盲发生成。胶片条点击不再被未提交修改拦截：脏修改先托管进最左端草稿卡（「未提交草稿 · 源自此图」），再回填目标作品；左栏出现「正在新草稿中编辑（源自此图）」+「还原原图」，点草稿卡恢复草稿并切新建画布焦点，提交 / 新建创作正确清理。纯逻辑在 `src/logic/form.js`（`draftSourceOf` / `originalPatchOf` / `parkDraftOf` / `draftViewOf`）与 `previewRecallOf` 的新语义。
  - **A2 双向时间线**：助手完成气泡展示任务全部 1~4 张结果图（网格，单张保持原观感）；舞台图片工具提交后向助手线程追加镜像动作记录与任务气泡；点击结果图进入单图聚焦视图（大图 + 参数胶囊 + 对比原图 / 继续涂抹 / 重新生成 / 查看大图），顶部「← 返回上一层（{label}）」逐层回退。镜像 / 同步 / 结果记录均带 `kind`，不进入 `intentHistory`。纯逻辑在 `src/logic/chat.js`。
  - **A3 本地导入与对比**：新增 `POST /imagen-api/import`（PNG / JPEG 魔数、8 MiB、最小边 128 校验后原样落盘为独立 `v1`，写同构 `meta.json` 并标 `source: "import"`），导入图自动进入 `/history` 与 `/history/tree`，作品条 / 画廊显示「导入」角标；舞台支持拖入、粘贴与「选择图片」，新画布提示「写提示词，或把图片拖入取景框」，编辑态拒绝导入；带 `sourceImage` 的派生作品提供可拖动「对比原图」拉帘。新增 `lib/image-meta.js` 在生成 PNG 写入 `tEXt` 生成元数据（失败退回原字节），导入自带元数据的 PNG 时回填 `generation` 并恢复原生成参数。
  - **契约与字典**：`ROUTES.importFile` + `IMPORT` 进入 `shared/contract.js`，`HistoryItem` 增加 `source`；`useStudioUi` 新增 `compareOpen`；中英字典各 539 键同构。
  - **测试**：新增 `check-client-draft`（4）、`chat-timeline`（5）、`import-client`（18）、`import-host`（17）；`check-client-chat` 19、`check-client-shell` 51、`check-client-logic` 83、`check-client-tools` 27、`image-tool-render` 6、`host-e2e` 56、`jobs-wait` 31、`check-contract` 12，`npm test` 36 步全绿。变更明细见 [CHANGELOG](../CHANGELOG.md) 的对应条目。

---

## 后续阶段排期总览

| 阶段 | 主题 | 所属条线 | 前置依赖 | 预计定位 |
| :--- | :--- | :--- | :--- | :--- |
| **十一** | 状态流转与局部重绘可用性修复（P0-a ~ P2） | 前端 + 远端收敛 | 0.12.0 基线 | **✅ 已完成（0.12.0）** |
| **十二** | 舞台图片处理工具栏与交互解耦（方案 B） | 前端交互重构 | 十一完成收口 | **✅ 已完成（0.13.0，未发版）** |
| **十三** | 显式新建绘图、多作品草稿圆点与树状版本管理 | 前端 + Host 元数据 | 十二（方案 B 底座） | **✅ 已完成（0.13.0，未发版）** |
| **十四** | Google Colab（Colab Pro）后端接入 | Host 算力扩展 + `remote/` 适配 | 十一收口后可与十二/十三并行（需先过 M0 探针） | 独立后端里程碑（与界面解耦） |
| **十五** | 交互语义对齐、双向助手闭环与模型原生参考演进（Phase 0~C） | 全链路体验 + 导入 + 后处理与 DiT 原生参考 | 十三（工作区草稿与版本树） | 🟡 Phase 0 / Phase A 已完成（未发版）；Phase B / C 待排期 |
