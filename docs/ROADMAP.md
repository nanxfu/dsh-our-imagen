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
- **实现**：`tunnel_monitor()` 常驻监管，异常退出后 2→60 秒指数退避重拉并重播 ready；主循环每 300 秒重播一次；`/health` 上报 `tunnel_provider` / `tunnel_state` / `tunnel_restarts`，ready 事件带 `provider`。纯函数与假 Popen 覆盖见 `test/daemon-unit.py`。

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
