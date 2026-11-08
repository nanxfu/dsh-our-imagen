# 实验记录（EXPERIMENTS）

**用途**：所有实测结论、原始数据、对策集中在此。规格文档（SPEC / ARCHITECTURE / PROTOCOL / WORKBENCH-UI / MODEL-CATALOG）只保留规范内容，并引用本文件的编号，不复制结论。

**读法**：想知道"平台实际是什么样"，看这里；想知道"我们应该怎么做"，看规格文档。两者不一致时，以本文件的实测数据为准，并提 issue 修正规格。

**条目模板**：

```
## E<n> · 主题
- 日期 / 内核 / 参数
- 目的：这次实验想回答什么
- 步骤：怎么做的
- 原始数据：贴数字，不贴解释
- 结论：数据支持的一句话
- 对策：由此改变的规格或实现
- 影响范围：哪些文档/模块因此改动
- 状态：已确认 / 待验证 / 已推翻
```

---

## 索引

| 编号 | 主题 | 结论 | 对策 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| E1 | 冷启动时间分解 | 排队 13~27 分钟，脚本内约 120 秒 | 资源条区分"排队中"与"启动中"；文案不得承诺 2~3 分钟 | 已确认 |
| E2 | 单卡显存边界 | klein 整管在 14.56GiB 卡上加载即 OOM，降分辨率无效 | 该模型必须双卡或 CPU offload | 已确认 |
| E3 | CLI 鉴权间歇失败 | 同一凭据下 `kernels.*` 会随机报未认证 | 所有内核调用加 4 次退避重试 | 已确认 |
| E4 | `kaggle quota` 不可用 | OAuth 登录后仍报未认证 | 配额降级为尽力而为的展示项 | 已确认 |
| E5 | 管线类晚于 diffusers 发版 | MOSS 需 `trust_remote_code` | 加载器支持仓库内代码，并限白名单 | 已确认 |
| E6 | 会话保持的收益边界 | 热态省掉约 120 秒 + 13~27 分钟等待，代价是空闲计费 | 空闲自动关机 30 分钟 | 推算，待实测计费口径 |
| E7 | 磁盘布局与跨会话持久性 | `/kaggle/working` 固定 20G；`/root/.cache` 在共享 overlay；三处均不跨会话保留 | 权重缓存只能走 Dataset 挂载 | 已确认 |
| E8 | 单卡可用基线 | SDXL-Turbo 单卡 1.87s、SDXL-Base 1024² 27.8s（可用档），白名单下载 6.6~6.8GB | 默认档优先 1024² 少步蒸馏 | 已确认 |
| E9 | 容器写入层配额 | 约 52GB 后文件系统变只读，会话报废 | 下载必须白名单 + 单会话总量上限 | 已确认 |
| E10 | OAuth 凭据 3 小时后失效 | token 到期后 `kernels.*` 全拒，`datasets.*` 仍可用 | 主路径改 API token（ADR-0008） | 已确认 |
| E11 | API token 路径验证 | 移走 OAuth 凭据后，仅凭 token 即可调用 `kernels.*` | 引导主路径定为写 `access_token` 文件 | 已确认 |
| E12 | M1 骨架安装与路由验证 | 路由与设置页槽位均生效；右侧面板需 tab 类型支持 | M1 主落点用设置页整页 | 已确认 |

---

## E1 · 冷启动时间分解

- **日期**：2026-11-08；**内核**：`mogudd/free-imagen-bench` v1/v2/v3；**参数**：`--accelerator NvidiaTeslaT4`、`-t 3600`
- **目的**：一次"点生成到拿到图"到底花在哪。
- **步骤**：在内核里按阶段打点：环境探测、pip 安装、`snapshot_download`、`from_pretrained`、首次与稳态推理；同时用 CLI 轮询内核状态记录排队时长。
- **原始数据**：

  | 阶段 | v1 | v2 | v3 | v4 |
  | :--- | :--- | :--- | :--- | :--- |
  | 排队（推送→RUNNING） | 13 min | 27 min | 12 min | 待测 |
  | 环境探测 | 8.6s | 8.6s | 16.3s | — |
  | pip 安装 | 20.4s | 20.9s | 24.5s | — |
  | 下载 | 114.7s（22.6GB） | 76.5s（15.2GB） | 124.4s（25.96GB） | — |
  | 加载 | 65s（失败前） | 28.2s | —（未到该阶段） | — |
  | 首图 | OOM | 15.17s | — | — |
  | 稳态 | — | 10.24s | — | — |

- **结论**：排队是最大的一项，且完全不受我们控制；脚本内可控部分约 100~150 秒，其中下载占一半以上。
- **排队实测汇总**（同为 `--accelerator NvidiaTeslaT4`）：

  | 轮次 | 队列 | 推送 → 开始运行 |
  | :--- | :--- | :--- |
  | v1 | GPU | 13 分钟 |
  | v2 | GPU | 27 分钟 |
  | v3 | GPU | 约 25 分钟 |
  | v6 | GPU | 34 分钟 |
  | 磁盘探针 | **CPU** | 约 1 分钟 |

  GPU 队列在 13~34 分钟之间浮动，CPU 内核几乎即时——稀缺资源是 GPU，不是算力总量。这直接支持"保持会话比反复重启划算"的结论（见 E6）。
- **对策**：① 资源条把 `provisioning` 文案改为"排队中，可能十余分钟"；② 引导第 4 步禁止承诺"2~3 分钟"；③ 模型卡的"首次约 X 分钟"必须包含排队，并给区间而不是定值；④ 下载量作为模型卡字段展示；⑤ 权重缓存列入 v1.1。
- **影响范围**：`WORKBENCH-UI.md` §4、§5；`MODEL-CATALOG.md` §1、§2；`ROADMAP.md`。
- **状态**：已确认。

---

## E2 · 单卡显存边界

- **日期**：2026-11-08；**内核**：v2；**模型**：`black-forest-labs/FLUX.2-klein-4B`
- **目的**：1024² 到底能不能在单卡 T4 上跑；若不能，卡在哪一层。
- **步骤**：四个独立子进程：`single`（1024²）、`single512`（512²）、`dual`（`device_map="balanced"`）、`offload`（CPU offload）。
- **原始数据**：

  | 方案 | 加载 | 首图 | 稳态中位 | 峰值显存 | 结果 |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | single 1024² | — | — | — | 14.43 GiB 已分配 | OOM，崩在 `.to("cuda")` |
  | single 512² | — | — | — | 14.43 GiB 已分配 | OOM，崩在同一处 |
  | dual 1024² | 28.2s | 15.17s | 10.24s | 7929 MB/卡 | 通过 |
  | offload 1024² | 30.4s | 33.53s | 27.01s | 7996 MB | 通过但慢 |

- **结论**：卡点是权重装载，不是分辨率——512² 与 1024² 崩在同一行，所以"降分辨率省显存"对该模型无效。
- **对策**：① 该模型标记"需 2 卡"；② 单卡模式只提供 offload，并在 UI 标注 27 秒级耗时；③ 准入判定里区分"装不下"与"跑得慢"两类失败。
- **影响范围**：`MODEL-CATALOG.md` §2、§5；`SPEC.md` 硬约束第 8 条。
- **状态**：已确认。

---

## E3 · CLI 鉴权间歇失败

- **日期**：2026-11-08；**路径**：本机 `kaggle` CLI 2.2.5
- **目的**：为什么同一条命令时而成功时而报未认证。
- **步骤**：连续轮询同一内核状态；对 `kernels push` 做失败后立即重试；对照 `datasets list`、`competitions list`。
- **原始数据**：轮询日志中 20 秒间隔出现"成功 / `Permission 'kernels.get' was denied`"交替；`kernels push` 三次出现"第 1 次失败、第 2 次成功"，间隔 5~10 秒；同期 `datasets`、`competitions` 全部正常。凭据文件在窗口期内未变更（mtime 固定）。
- **结论**：不是权限配置问题，是 CLI 或服务端的鉴权路径不稳定；`kernels.*` 尤其明显。
- **对策**：所有 `kernels push/status/logs/output` 包 4 次重试，退避 2/4/8 秒，仅对 `Authentication required` 重试；轮询中连续 3 次失败才算异常。
- **影响范围**：`PROTOCOL.md` §7；`PROVIDER-INTERFACE.md` §3。
- **状态**：已确认。

---

## E4 · `kaggle quota` 不可用

- **日期**：2026-11-08；**前提**：OAuth 登录成功（`credentials.json` 更新为 20:39）
- **目的**：配额能否作为资源条的数据源。
- **步骤**：登录后分别调用 `quota`、`datasets list`、`competitions list`、`kernels list`、`config view`。
- **原始数据**：`datasets list` 正常返回；`competitions list` 正常；`kernels push` 成功；`quota` 与 `kernels list -m` 返回 `Authentication required`（退出码 1）。token scope 为 `resources.admin:*`，有效期约 3 小时。
- **复测（2026-11-09 00:46，改用 API token 后）**：`kaggle quota` **正常返回**：

  ```
  resource  used   remaining  total   refreshAt
  GPU       0.72h  29.28h     30.00h  2026-11-14T00:00:00+00:00
  TPU       0.00h  20.00h     20.00h  2026-11-14T00:00:00+00:00
  ```

- **结论**：配额**在 OAuth 凭据下不可用，在 API token 下可用**。此前"配额长期不可用"的判断被收窄为"OAuth 路径不可用"。
- **对策**：① 账号接入主路径改为 API token（ADR-0008）；② `probe()` 仍需处理配额不可得的退化分支（OAuth 兜底用户会遇到）；③ 资源条显示真实配额，用尽前给出预警。
- **影响范围**：`PROTOCOL.md` §6；`SPEC.md` 硬约束第 7 条；`WORKBENCH-UI.md` §5。
- **状态**：已修正（原结论过宽）。

---

## E5 · 管线类晚于 diffusers 发版

- **日期**：2026-11-08；**内核**：v3；**模型**：`OpenMOSS-Team/MOSS-Image-SFT`
- **目的**：验证 MOSS 在 T4 上的显存与耗时。
- **步骤**：`pip install -U diffusers` 后用 `DiffusionPipeline.from_pretrained` 加载，单卡与双卡各跑一次。
- **原始数据**：`AttributeError: module diffusers has no attribute MOSSImagePipeline. Did you mean: 'OvisImagePipeline'?`；下载 25.96GB / 124.4s（208.7 MB/s）；两个方案都在加载前失败，wall time 48.5s / 11.2s。
- **复测（v4）**：加上 `trust_remote_code=True` 后**仍是同一错误**，栈顶落在 `pipeline_loading_utils.py:552 getattr(diffusers_module, class_name)`，说明它没有走远端代码分支，而是回落到"在 diffusers 包里找类"。下载 25.96GB / 154.4s（168.1 MB/s）。
- **复测（v5）**：改装 diffusers git 主线后 `diffusers.__version__` = `0.42.0.dev0`，但 `hasattr(diffusers, 'MOSSImagePipeline')` 仍为 **False**（同一次检查里 `ZImagePipeline` 为 True）。因此 MOSS 只能靠 `custom_pipeline` 指定仓库内文件，属于额外适配工作。
- **结论**：MOSS-Image 不进入 v1 候选；它需要自定义管线加载路径，且下载体量 25.96GB 已接近会话写入配额（见 E9）。
- **对策**：① 加载器按"模型声明的依赖"选择安装源，而不是一律 `pip install -U diffusers`；② `trust_remote_code=True` 只对模型目录中显式声明的预设开启；③ 准入基准必须记录"加载器要求"字段；④ 不同步数的模型用 `ms/步` 比较。
- **影响范围**：`MODEL-CATALOG.md` §4；`PROTOCOL.md` §8。
- **状态**：待验证（v5 改用 diffusers git 主线复测）。

---

## E6 · 会话保持的收益边界（推算）

- **目的**：挂着会话与用完即关，哪个更划算。
- **依据**：E1 的分段数据。
- **推算**：

  | 场景 | 用户等待 | 配额消耗 |
  | :--- | :--- | :--- |
  | 冷启动一批 N 张 | 排队 13~27min + 120s + 10.24s×N | 仅运行时长 |
  | 热会话出 N 张 | 10.24s×N | 运行时长 + 空闲时长 |

- **结论**：热会话省掉的是**用户等待**，不是配额；空闲时段仍然计费。因此"挂机"只在"下一批很快到来"时划算。
- **对策**：空闲自动关机设为 30 分钟（相当于周额度约 2.8%），并在资源条常驻倒计时。
- **待验证**：排队时段是否计费。`kaggle quota` 不可用（E4），只能靠 Kaggle 网页配额表前后对比。
- **状态**：推算，待验证。

---

## E7 · 磁盘布局与跨会话持久性

- **日期**：2026-11-08；**内核**：`mogudd/free-imagen-diskprobe` v1（写入）/ v2（检查）；`enable_gpu: false`
- **目的**：权重下载会不会占满用户存储；会话结束后权重是否还在。
- **步骤**：同一内核连推两次。v1 在 `/root/.cache`、`/kaggle/working`、`/kaggle/temp` 各写一个标记文件并记录 `df -h`；v2 检查这三个标记是否仍然存在。
- **原始数据**：

  | 路径 | 文件系统 | 容量 | 剩余 |
  | :--- | :--- | :--- | :--- |
  | `/`（含 `/root/.cache`） | overlay | 8.0T | 967G（共享盘） |
  | `/kaggle/working` | `/dev/loop2` | **20G** | 20G（独立回环盘） |
  | `/kaggle/temp` | 无独立挂载 | — | 运行时可写，会话结束丢失 |

  v2 检查结果：`cache: absent`、`working: absent`、`temp: absent`——三个标记全部消失。`/root/.cache` 列表只剩镜像自带的 `matplotlib`、`node-gyp`、`uv`。

- **结论**：三处都不跨会话持久。`/kaggle/working` 有 **20GB 硬上限**（不是弹性配额），而 `/root/.cache` 位于 8TB 共享 overlay 上，权重放这里不会被 20GB 卡住，但会话结束即丢失。
- **对策**：① 权重缓存只能通过 Kaggle Dataset / Model 挂载实现，不能指望"上次留在盘上"；② 禁止把权重复制进 `/kaggle/working`（26GB 的模型根本放不下）；③ 产物只有几 MB，不受 20GB 限制影响；④ 模型卡上"首次下载"的体量提示是必要信息，不是装饰。
- **待验证**：账号级存储配额（Kaggle Dataset 总量）——需要实际创建一个缓存数据集才能测，未做。
- **状态**：已确认（持久性、磁盘布局）；账号配额待验证。

---

## E8 · 单卡可用基线（SDXL 系）

- **日期**：2026-11-08；**内核**：v5（整仓）、v6（白名单 fp16）；**模型**：`stabilityai/sdxl-turbo`、`stabilityai/stable-diffusion-xl-base-1.0`；单卡 fp16
- **目的**：在没有双卡、没有量化的情况下，单卡 T4 能跑多快，作为默认档的对照基线。
- **原始数据**：

  | 模型 | 尺寸/步数 | 下载 | 加载 | 首图 | 稳态 | 每步 | 峰值显存 |
  | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
  | sdxl-turbo | 512² / 4 | 6.62GB（28s） | 4.0s | 2.79s | **1.87s** | 468ms | 7666MB |
  | sdxl-base | 1024² / 25 | 6.78GB（36.7s） | 5.8s | 29.73s | **27.8s** | 1112ms | 9966MB |

- **结论**：单卡完全能跑 SDXL 系；1024² 用 25 步需要 27.8 秒，落在"可用档（≤60 秒）"，不满足"快档（≤15 秒）"。按每步 1112ms 推算，1024² 用 4~8 步的蒸馏模型约 4.5~9 秒，可同时满足"1024² + 单卡 + 快档"。
- **对策**：默认档优先考虑 1024² 的少步蒸馏模型（如 SDXL-Lightning）；512² 的 turbo 保留为"最快档"。
- **影响范围**：`MODEL-CATALOG.md` §2、§5。
- **状态**：已确认（蒸馏模型本身待测）。

---

## E9 · 容器写入层有配额，写满后变为只读

- **日期**：2026-11-08；**内核**：v5
- **目的**：连续下载多个模型是否会被磁盘卡住。
- **原始数据**：`sdxl-turbo` 未加白名单直接下载了 **52.1 GB**（241.3s，216.1 MB/s）；随后下载 `sdxl-base` 与 `moss-image` 均失败：

  ```
  OSError: [Errno 30] Read-only file system:
  '/root/.cache/huggingface/hub/models--stabilityai--stable-diffusion-xl-base-1.0/...'
  ```

  文件系统被内核挂成只读，后续所有写操作失败。
- **结论**：E7 里看到的"8.0T / 967G 可用"是宿主共享镜像层，**每个会话的写入层另有配额**；本次约 52GB 后触顶并转为只读。这不是"下载慢"，是"会话报废"。
- **对策**：① 下载必须用 `allow_patterns` 白名单只取 fp16 权重，禁止整仓拉取；② 单会话下载总量设上限（建议 ≤ 20GB），超限即报可读错误而不是静默失败；③ 模型卡的"权重体积"字段按白名单后的实际值标注，不按仓库总大小标注。
- **复测（v6）**：加白名单（`**/*.fp16.safetensors` + 配置与 tokenizer）后，`sdxl-turbo` 从 52.1GB 降到 **6.62GB**、`sdxl-base` 为 **6.78GB**，两者都正常跑完；加载时间同时从 58.7s 降到 4.0~5.8s（不再做 fp32→fp16 转换）。白名单方案有效。
- **影响范围**：`MODEL-CATALOG.md` §1、§2；`PROTOCOL.md` §8。
- **状态**：已确认（配额的具体数值未精确定位，只知道在 52GB 附近）。

---

## E10 · OAuth 凭据 3 小时后失效且不自动刷新

- **日期**：2026-11-08 20:39 授权 / 23:39 失效 / 2026-11-09 00:00 复现；**环境**：本机 kaggle CLI 2.2.5
- **目的**：长会话是否会被凭据过期打断。
- **原始数据**：
  - `credentials.json` 的 `access_token_expiration` = `11/08/2026 23:39:17`，文件 mtime 仍为 `20:39:17`（**从未刷新**）；
  - 23:39 之后所有 `kernels.*` 调用失败：先是 `Authentication required`，随后变为 `Permission 'kernels.get' was denied`，重试 8 次全部失败；
  - 同期 `datasets list` 仍正常返回数据，`config view` 正常。
- **结论**：OAuth access token 有效期约 3 小时，本机 CLI 未自动续期；过期后 `kernels.*` 被拒，而 `datasets.*` 仍可用——两类接口对过期凭据的容忍度不一致。
- **对策**：① 账号接入主路径改为 API token（长期有效），OAuth 仅作兜底；② 插件每次探测都做真实 API 调用，不缓存"已登录"超过 5 分钟；③ 失效时提示"改用 API token"，而不是只让用户重登；④ 保留托管重登能力（见 [ADR-0008](ADR/0008-api-token-primary.md)）。
- **影响范围**：`SPEC.md` 硬约束；`ADR/0004`；`WORKBENCH-UI.md` 错误态。
- **状态**：已确认；改用 API token 为开放问题。

---

## E11 · API token 路径验证（ADR-0008 主路径）

- **日期**：2026-11-09 00:35；**环境**：本机 kaggle CLI 2.2.5
- **目的**：确认"仅靠 API token"能否替代 OAuth 访问 `kernels.*`。
- **步骤**：把 token 写入 `~/.kaggle/access_token`（37 字节）→ 将 `credentials.json` 临时改名 → 调用 `kaggle kernels list --user mogudd` → 恢复 `credentials.json`。
- **原始数据**：移走 OAuth 凭据后，`kernels list` 正常返回 2 个内核；恢复后文件存在性为 true。
- **结论**：API token 独立可用，不依赖 OAuth 凭据；ADR-0008 的主路径成立。
- **对策**：引导主路径确定为"写 `access_token` 文件 + 用 `kernels list` 验证"；插件仍不读取 token 内容。
- **待验证**：OAuth 已过期但文件仍在时，CLI 是否会回落到 token（需在 12:09 之后复测）；token 自身是否有有效期。
- **状态**：已确认（独立可用性）；回落行为待验证。

---

## E12 · M1 骨架安装与路由验证

- **日期**：2026-11-09 00:45；**包**：`dsh-our-free-imagen@0.1.0`
- **目的**：确认 Host 路由与 Client 槽位在真实页面上生效。
- **步骤**：`plugin_manager install_bundle` 指向仓库根；用 curl 调 Host 路由；用 `Slots.listSubTree` 查 `settings.section` 占位。
- **原始数据**：
  - 安装返回 `application: applied`、`enabled: true`、`bundle: dsh-our-free-imagen@0.1.0`；
  - `GET /imagen-api/state` 返回 4 个预设与 `session.state = absent`；
  - `POST /imagen-api/probe` 返回 `cli: 2.2.5`、`auth.ok = true`、`quota.usedHours = 0.72`；
  - `settings.section` 出现 `id: our-free-imagen`、`order: 40`、`active: true`。
- **结论**：M1 的 Host 与 Client 已打通；`sidebar.right.pane.tab` 是以 tab **类型**为 key 的槽位，插件要新增一个 tab 还需注册 tab 类型与其标题，超出 M1 范围，因此 M1 主落点采用 ADR-0002 的退化路径（`settings.section` 整页）。
- **对策**：M1 以设置页为主界面、会话头 utilities 放状态徽章；右侧面板留到 M2 评估。
- **状态**：已确认。

---

## 待验证清单

| 项 | 验证方式 | 阻塞原因 |
| :--- | :--- | :--- |
| 排队是否计费 | 网页配额表在"推送前 / 排队结束后"各看一次 | 需要用户操作网页 |
| 双卡是否按 2× 扣配额 | 同上，跑一次双卡会话前后对比 | 同上 |
| access token 3 小时有效期是否影响 `kernels.*` | 隔 3 小时后重跑一次 push | 需要等待 |
| FLUX.3 int8 能否被自写转换器加载 | 写转换器后跑通 1024² | 工作量较大，v1.1 |
