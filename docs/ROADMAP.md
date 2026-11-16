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

## 九、 工作台双向同步与创作流转（规划中）

> **状态**：📝 规划中。设计参考与边界约定见 [STUDIO_SYNC_AND_ITERATION_DESIGN.md](STUDIO_SYNC_AND_ITERATION_DESIGN.md)。

- **目标**：理顺参数表单、创作助手与胶卷之间的流转边界——「清空对话」改为「新建对话」（开启新上下文）；表单生成同步到助手时展示细粒度参数摘要且不污染多轮 `intentHistory`；创作区点击胶卷自动带入原图参数（保留 Seed、保护未提交草稿），并明确「版本微调」与「新建创作」的重置边界。


