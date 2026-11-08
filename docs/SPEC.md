# 免费生图工作台 — 规格总纲（SPEC）

状态：v1 规格冻结
最后更新：2026-11-08
适用包名：`dsh-our-free-imagen`（显示名：免费生图工作台 / Free Imagen Workbench）

---

## 1. 一句话定义

在 Harness 的 Web 界面内常驻一个生图工作台：借 Kaggle 免费 GPU 配额（T4 ×2，每周 30 小时）运行开源文生图模型；首次加载完成账号接入引导，之后以秒级往返出图，并实时展示配额、会话与显存资源。

---

## 2. v1 目标

| 编号 | 目标 | 判定方式 |
| :--- | :--- | :--- |
| G1 | **加载即引导**：首次打开面板给出可执行的接入步骤，而不是报错字符串 | 全新 profile 下从零走到"就绪"，全程无需查文档 |
| G2 | **资源可见**：配额、会话状态、剩余自动关机时间、本机内存、远端设备名在一屏内可见 | 面板顶部固定资源条 |
| G3 | **秒级出图**：会话热态下单张出图在可接受时间内返回 | 快档 ≤15 秒、可用档 ≤60 秒（判据见 [MODEL-CATALOG.md](MODEL-CATALOG.md) §4）；默认档必须落在快档 |
| G4 | **同一份能力**：Agent tool 与 UI 按钮调用同一个后端服务，状态只有一份 | 两处交替操作不产生状态冲突 |
| G5 | **失败可读**：每种失败都有明确归因与下一步动作 | 错误态清单逐条可复现 |

---

## 3. 非目标（明确不做）

- 图库、历史浏览、收藏、检索（v1.1 起再议）
- ComfyUI 运行时接入（v2）
- 第二个 Provider 的实际实现（只留契约，v2 落地）
- 多用户、跨机器共享会话、远程协作
- 移动端布局
- 本地推理（本机无可用推理环境，远程是唯一路径）

---

## 4. 名词表

| 术语 | 含义 | 不要混用 |
| :--- | :--- | :--- |
| Provider | 算力提供方，当前仅 Kaggle | 不叫"后端""引擎" |
| Kernel | Kaggle 上的一次内核执行单元，一次推送产生一个 | 不叫"容器""实例" |
| Session | 租借到的、保持 GPU 热态的远端守护进程及其本地记录 | 不叫"连接""通道" |
| Lease | Session 的计费生命周期（启动到关机） | — |
| Job | 一次出图请求，含 1~4 张图 | 不叫"任务列表" |
| Preset | 模型预设：模型 ID + 默认尺寸/步数/CFG + 许可 | 不叫"模型" |
| Model Card | 工作台里展示 Preset 的 UI 卡片 | — |
| Onboarding | 首次接入的分步引导 | 不叫"初始化向导" |
| Tunnel | 远端守护进程对外的临时 HTTPS 入口 | — |

---

## 5. 分层

| 层 | 语言 | 职责 | 生命周期 |
| :--- | :--- | :--- | :--- |
| 客户端 UI | TypeScript | 面板、模型卡、图墙、引导、状态呈现 | 随页面 |
| 宿主编排 | TypeScript | 状态单例、任务队列、路由、tool 注册、配置与凭据访问 | 随 Harness 进程常驻 |
| Provider 适配 | TypeScript | `kaggle` CLI 子进程、内核轮询、隧道握手、HTTP 调用、落盘 | 随宿主 |
| 远端运行时 | **Python（保留）** | `remote/worker.py`（一次性）、`remote/daemon.py`（常驻） | 随 Kernel |

关键约束：**本地不再有 Python 编排层**；Python 只存在于远端内核，以及作为外部程序被调用的 `kaggle` CLI。

---

## 6. 来自实测的硬约束

> 本节每条都来自真实内核运行。原始数据、测量步骤与对策见 [EXPERIMENTS.md](EXPERIMENTS.md) 对应编号；本节只保留"因此我们必须怎么做"的规范结论，不重复实验过程。

1. `kaggle auth login` 的"已登录"是本地回显，不做 API 验证；未认证时 `kaggle quota` 以 **exit code 1** 加 `Authentication required to call the Kaggle API.` 失败。CLI 版本实测 2.2.5。
2. T4 为 Turing 架构：有 INT8/INT4 Tensor Core，但**没有 FP8、没有原生 BF16**；扩散管线不会自动走 INT8 路径。任何量化收益必须实测，不得假设。
3. Z-Image-Turbo 官方仓库以 FP32 存储，下载约 24GB；FLUX.2-klein-4B 约 8GB。冷启动的下载时间可能超过模型加载本身。
4. 双卡为 16GB × 2、PCIe 互联、无 NVLink；跨卡张量并行的收益不可假设。
5. Harness 插件没有"页面/路由"概念，只有 slot；PNG 必须经宿主 HTTP 路由输出，Client 使用相对页面 base 的 URL。
6. 插件配置值会落进 profile 的 `cordis.patch.yml` 明文；密钥类内容一律走 `ctx.credentials`。
7. `kaggle` CLI 的鉴权按命令差异化：实测在 OAuth 登录（token scope 为 `resources.admin:*`）下，`datasets`、`competitions`、`kernels push` 正常，而 `quota` 与 `kernels list -m` 返回 `Authentication required`。因此配额属于**尽力而为**的展示项，不得作为出图流程的前置条件。
8. 单卡 T4（可用 14.56 GiB）**装不下** `FLUX.2-klein-4B` 整管：`.to("cuda")` 阶段即 OOM，且 512² 与 1024² 崩在同一处，说明与分辨率无关。1024² 只有双卡 `device_map="balanced"`（稳态 10.24 秒）或 CPU offload（27 秒）两条路。
9. `kernels.*` 子命令存在间歇性鉴权失败：同一条命令可能一次报 `Authentication required`、数秒后成功。所有内核操作必须内置重试。
10. OAuth 的 access token 有效期约 3 小时且**不自动续期**；过期后 `kernels.*` 全部被拒，而 `datasets.*` 仍可用。因此账号接入以 API token 为主路径（长期有效），OAuth 仅作兜底（见 ADR-0008）。

---

## 7. 决策索引

| 编号 | 决策 | 文档 |
| :--- | :--- | :--- |
| ADR-0001 | 本地编排用 TypeScript，远端保留 Python | `docs/ADR/0001-*.md` |
| ADR-0002 | 工作台主落点为右侧面板 slot，并支持退化到设置页 | `docs/ADR/0002-*.md` |
| ADR-0003 | 会话状态全局单例，产物按 workspace 落盘 | `docs/ADR/0003-*.md` |
| ADR-0004 | 凭据交给 kaggle CLI，插件不持久化 token | `docs/ADR/0004-*.md` |
| ADR-0005 | v1 不内置量化加载器，模型准入以实测为准 | `docs/ADR/0005-*.md` |
| ADR-0006 | 单包仓库 + 本地 `install_bundle` 分发 | `docs/ADR/0006-*.md` |
| ADR-0007 | 双卡为显式开关，默认单卡 | `docs/ADR/0007-*.md` |
| ADR-0008 | 凭据主路径改为 API token，OAuth 仅作兜底 | `docs/ADR/0008-*.md` |

---

## 8. v1 完成定义

全部满足才算 v1 结束：

1. 全新 profile 下加载插件，按引导完成 OAuth 后，资源条显示真实配额。
2. 面板内能启动 GPU 会话，看到"启动中 → 就绪"的状态推进与耗时。
3. 选一张模型卡，输入 prompt，1~4 张图在会话热态下数秒返回，图片可见、可定位到磁盘。
4. 重复第二次、第三次出图不重启会话，耗时不退化。
5. 一键关机后资源条回到"未启动"，远端会话在数十秒内消失。
6. 在对话里让 Agent 调用 `imagen_generate`，返回 `jobId` 与状态摘要，随后能取到结果图。
7. 六类失败（未登录、账号降级到 CPU、配额耗尽、隧道失败、守护进程失联、内核报错）逐条呈现明确的归因与下一步。

---

## 9. 相关文档

- 架构与状态机：[ARCHITECTURE.md](ARCHITECTURE.md)
- Provider 契约：[PROVIDER-INTERFACE.md](PROVIDER-INTERFACE.md)
- 远端协议与错误码：[PROTOCOL.md](PROTOCOL.md)
- 工作台界面：[WORKBENCH-UI.md](WORKBENCH-UI.md)
- 模型目录与准入基准：[MODEL-CATALOG.md](MODEL-CATALOG.md)
- 阶段与验收：[ROADMAP.md](ROADMAP.md)
- 协作与迭代：[CONTRIBUTING.md](CONTRIBUTING.md)
