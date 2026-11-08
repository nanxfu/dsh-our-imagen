# 模型目录与准入基准（MODEL-CATALOG）

本文是工作台模型卡的唯一数据来源，也是"一个模型能否进工作台"的判定依据。所有耗时与显存数字以 [bench/bench.py](../bench/bench.py) 的 T4 实测为准；未实测的格子标 `待测`，不得凭外部资料填写。

---

## 1. 模型卡字段规范

每个模型卡必须能回答下面九件事，缺一项就不算合格卡片：

| 字段 | 含义 | 取值示例 |
| :--- | :--- | :--- |
| 所需卡数 | 单卡可跑 / 必须双卡 / 单卡需 offload | `2`（单卡加载即 OOM） |
| 权重体积 | 首次下载的字节数（实测，非上游宣称） | 15.2GB |
| 峰值显存 | 单次出图的 `max_memory_allocated` | 7929MB / 卡 |
| 量化类型 | 原版权重精度 + 可用的量化构建，并标注 T4 是否可用 | fp16 原版；GGUF Q8 可用；fp8r/nvfp4 不可用 |
| 许可 | SPDX 或专有名，标注可否商用 | Apache-2.0 / FLUX Kommunity（<$5M 年收入可商用） |
| gated | 是否需要 Hugging Face 登录并同意协议 | 是 / 否 |
| **冷启动时长** | 从点击"启动 GPU"到第一张图返回，拆成四段：排队 / 下载 / 加载 / 首图 | 13~27min + 76.5s + 28.2s + 15.2s |
| **出图时长** | 会话热态下的稳态中位与抖动范围（1024²） | 10.24s（实测 9.75~15.17s） |
| 会话内切换成本 | 同一会话切到该模型只需重新加载，不重复下载 | 28.2s |

两条时长必须分开写，因为它们的数量级完全不同：冷启动是**分钟级**（且最大的一项是平台排队，不是我们能优化的），出图是**秒级**。把两者混成一个"耗时"字段会让用户以为工作台很慢。

"端到端冷启动"= 排队 + 下载 + 加载 + 首图；"脚本内冷启动"= 下载 + 加载 + 首图（不含排队，因为排队随平台负载波动）。

---

## 2. 候选与收录

资源属性：

| 预设名 | 模型 | 生成器参数 | 权重(fp16) | 卡数 | 峰值显存 | 量化 | 许可 | gated |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `sdxl-turbo` | `stabilityai/sdxl-turbo` | ~3.5B | 6.62GB（白名单 fp16）／52.1GB（整仓，勿用） | 1 | 7666MB | 无 | 非商用研究许可 | 否 |
| `sdxl-base` | `stabilityai/stable-diffusion-xl-base-1.0` | ~3.5B | 6.78GB（白名单 fp16） | 1 | 9966MB | 无 | OpenRAIL++ | 否 |
| `sdxl-lightning` | SDXL + Lightning LoRA | ~3.5B | 约 7GB | 1 | 待测 | 无 | OpenRAIL++ | 否 |
| `flux2-klein-4b` | `black-forest-labs/FLUX.2-klein-4B` | 3.88B | 15.2GB | **2** | 7929MB/卡 | GGUF Q8/Q4 | Apache-2.0 | 否 |
| `flux3-klein` | `black-forest-labs/flux-3-image-klein-base` | 5.54B | 11.2GB（BF16） | 待测 | 待测 | 官方 fp8r / nvfp4 **T4 不可用**；社区 INT8 需自写转换器（§3.1） | FLUX Kommunity | **是** |
| `moss-image` | `OpenMOSS-Team/MOSS-Image-SFT` | 5.08B | 25.96GB（实测） | 待测 | 待测 | 无（需 `trust_remote_code`） | Apache-2.0 | 否 |
| `z-image-turbo` | `Tongyi-MAI/Z-Image-Turbo` | 6.15B | 约 24GB（F32 存储） | 待测 | 待测 | GGUF 可跑 | Apache-2.0 | 否 |
| `krea-2-turbo` | `krea/Krea-2-Turbo` | 12.8B | 约 25GB | 2（临界） | 待测 | 无 | Krea 社区许可 | 是 |

时长（1024² 除特别标注；"排队"为 GPU 队列实测区间 13~34 分钟）：

| 预设名 | 排队 | 下载 | 加载 | 首图 | 稳态 | 端到端冷启动 | 会话内切换 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `flux2-klein-4b`（双卡） | 13~27 min | 76.5s | 28.2s | 15.17s | 10.24s | 约 15~29 min | 28.2s |
| `flux2-klein-4b`（单卡 offload） | 同上 | 76.5s | 30.4s | 33.53s | 27.01s | 约 15~30 min | 30.4s |
| `flux2-klein-4b`（单卡整管） | — | 76.5s | — | — | — | 不可用（加载 OOM） | — |
| `sdxl-turbo`（单卡，512²） | 34 min | 28.0s | 4.0s | 2.79s | **1.87s** | 约 35 min | 4.0s |
| `sdxl-base`（单卡，1024²） | 34 min | 36.7s | 5.8s | 29.73s | **27.8s** | 约 35 min | 5.8s |
| `sdxl-lightning` | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| `moss-image` | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| `z-image-turbo` | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |
| `flux3-klein` | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 | 待测 |

选择依据：

- `flux2-klein-4b` 实测单卡加载即 OOM（512² 与 1024² 崩在同一处），双卡稳态 10.24 秒；它是当前唯一有完整 T4 实测数据的默认候选。
- `flux3-klein` 是 2026-10-15 发布的更新一代（BFL 自测 Elo 高于 FLUX.2 klein 9B），但三条约束挡在前面：权重 gated、INT8 build 未进仓库、11.2GB 权重在 14.56GiB 卡上大概率重演加载 OOM。它进入候选池但不进默认档，待实测。
- `moss-image` 是本次调研的意外收获：Apache-2.0、不 gated、diffusers 原生（`MOSSImagePipeline`），体量与 klein 同档。
- `z-image-turbo` 的双语文字渲染最强，但下载体量是 klein 的 1.6 倍，卡片必须显式标注。
- `sdxl-turbo` 保留为极速草稿档，许可限非商用，徽章必须显示。
- `krea-2-turbo` 参数 12.8B，双卡 32GB 只能勉强加载，稳态必然慢，不收录。

---

## 3. v1.1 量化档（默认折叠）

量化档在 UI 中折叠在"更多模型 → 质量优先（慢）"下，选中时弹出提示：单图耗时可能进入分钟级。

| 基座 | 量化仓库 | 档位 | 体积 | 许可 | T4 判定 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| FLUX.2-klein-4B | [unsloth/FLUX.2-klein-4B-GGUF](https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF) | Q8 / Q4 | 约 4.2GB / 2.5GB | Apache-2.0 | 可跑 |
| FLUX.3-Klein-Base | 仓库内 [fp8r / nvfp4 变体](https://huggingface.co/black-forest-labs/flux-3-image-klein-base) | fp8 / nvfp4 | 5.6GB | FLUX Kommunity | **不可用**：T4 无 FP8 单元，NVFP4 属 Blackwell |
| Z-Image-Turbo | [unsloth/Z-Image-Turbo-GGUF](https://huggingface.co/unsloth/Z-Image-Turbo-GGUF) | Q8 / Q4 | 约 6.5GB / 3.8GB | Apache-2.0 | 可跑，优先于 FP32 原版 |
| Qwen-Image | [unsloth/Qwen-Image-2.1-GGUF](https://huggingface.co/unsloth/Qwen-Image-2.1-GGUF)、[QuantStack/Qwen-Image-GGUF](https://huggingface.co/QuantStack/Qwen-Image-GGUF) | Q4_K_M / Q8 | 约 12GB / 21GB | 原版 Apache-2.0；2.1 为 `license: other` | Q4 单卡勉强；Q8 需双卡 |
| Qwen-Image-2.1-Turbo | [unsloth/Qwen-Image-2.1-Turbo-GGUF](https://huggingface.co/unsloth/Qwen-Image-2.1-Turbo-GGUF) | GGUF | 同量级 | `license: other` | 可跑，但许可受限，默认隐藏 |

许可证标注规则：

- `Apache-2.0`、MIT：绿色徽章，不折叠。
- 明确"非商用"或 `license: other`：橙色徽章，默认折叠在"更多模型"内，卡片上写明限制。
- 无法判定：灰色徽章 + "许可未明"，同样折叠。


已排除的量化路线（写入即不再讨论）：

- **FP8**（含社区 `fp8_e4m3fn` 权重）：T4 无 FP8 单元，不可用。
- **NVFP4**：Blackwell 专属，不可用。
- **Nunchaku / SVDQuant INT4**：依赖 Ada 及更新的 INT4 Tensor Core，不可用。
- **INT8 权重专用路径**：Turing 虽有 INT8 Tensor Core，但扩散管线不会自动走该路径，收益须实测；v1 不做。

### 3.1 社区 INT8 观察项：`flux-3-image-klein-int8`

仓库：[rootlocalghost/flux-3-image-klein-int8](https://huggingface.co/rootlocalghost/flux-3-image-klein-int8)（未 gated，但许可仍是 FLUX Kommunity，去 gated 不等于授权豁免）。

实测事实（读取 safetensors 头部，未下载整包）：

| 项 | 观测 |
| :--- | :--- |
| 张量 dtype | I8 × 172、F32 × 172、BF16 × 101、U8 × 205 |
| 量化形态 | 每个 I8 权重配一个 `*.weight_scale`（形状 = 输出通道数，如 3072×1），即**逐输出通道的 weight-only INT8** |
| 键名 | `content_mode_blocks.*.qkv` / `mlp_in` / `attn_out`，融合式自定义布局，与 diffusers 的 `mode_blocks.image.0.attn.to_q.weight` 不一致 |
| 索引 | `weight_map` 指向 `diffusion_pytorch_model-0000{1,2}-of-00002.safetensors`，**这两个文件不在仓库里** |
| manifest | 仍是原版导出清单（`dtype: bfloat16`，校验 `model.safetensors`） |
| transformer/config.json | 无 `quantization_config` |

判定：**量化成立，打包不合格**。它是导出物而非可分发格式，stock diffusers 无法加载。要使用需自写转换器：拆分融合 QKV/MLP、按 `weight_scale` 反量化、解析 205 个 U8 张量语义。

潜在价值：transformer int8 约 3GB + Qwen3-VL-4B 编码器 int8 约 2.2GB + VAE，**单卡 14.56GiB 有希望装下**——这是"FLUX.3 在 T4 上不可行"这一判断唯一可能的反转点。

第二个门槛：官方要求必须配 prompt 扩写器（9B、18.8GB），T4 跑不了。可行替代是**用宿主侧对话模型做扩写**（把短 prompt 展开为完整场景描述），不在 GPU 上加载 upsampler。

结论：列为 v1.1 研究项，不进 v1。触发条件：出现符合 diffusers 量化配置规范的 INT8 权重，或自写转换器跑通 1024²。


---

## 4. 准入基准协议

任何模型卡进入工作台前，必须在 T4 上跑完下列六项并回填本文表格：

| 编号 | 指标 | 测量方式 |
| :--- | :--- | :--- |
| B1 | 设备与卡数 | `torch.cuda.device_count()`、每卡显存 |
| B2 | 依赖安装耗时 | 干净内核里安装 `diffusers/transformers/accelerate` 的秒数 |
| B3 | 权重下载吞吐 | `snapshot_download` 的秒数 / 字节数 / MB/s |
| B4 | 加载耗时 | 磁盘到显存的秒数 |
| B5 | 出图耗时 | 1024² 首图与稳态 3 张的逐张秒数 |
| B6 | 峰值显存 | `torch.cuda.max_memory_allocated()` |

判定阈值（v1，按产品要求分两档）：

| 档位 | 稳态出图耗时 | 准入位置 |
| :--- | :--- | :--- |
| 快档 | ≤ 15 秒 | 默认档、连续微调 prompt 的主路径 |
| 可用档 | ≤ 60 秒 | 可收录，但标记为"质量优先/较慢"，不作为默认 |
| 不收录 | > 60 秒 | 除特殊场景外不进工作台 |

其余约束：单卡峰值显存 ≤ 15GB（留 1GB 余量给 VAE 与解码）；下载体量 > 15GB 的模型必须在卡片上明示并默认折叠；步数不同的模型不直接比耗时，需换算 `ms/步` 后再比较（实测已记录该字段）。

加载器策略：部分模型（如 `moss-image`）的管线类尚未进入 diffusers 发布版，只能靠仓库自带的 `pipeline_moss_image.py`，因此远端加载必须支持 `trust_remote_code=True`。该选项会执行仓库自带代码，**只对模型目录中显式声明的预设启用**，不得对任意用户输入开启。

---

## 5. 基准结果

> 本节只做汇总；测量步骤、原始日志与失败分析见 [EXPERIMENTS.md](EXPERIMENTS.md) E1、E2、E5。

环境（2026-11-08，内核 `mogudd/free-imagen-bench`，`--accelerator NvidiaTeslaT4`）：

| 项 | 实测 |
| :--- | :--- |
| Python / torch / CUDA | 3.13.16 / 2.11.0+cu130 / 13.0 |
| 设备 | Tesla T4 ×2，各 14912 MB（可用 14.56 GiB），计算能力 7.5 |
| 依赖安装（pip） | 20.4 s |
| 权重下载（未过滤） | 22.6 GB / 114.7 s（197.3 MB/s） |
| 权重下载（过滤根目录重复单文件后） | **15.2 GB / 76.5 s（199.2 MB/s）** |
| 排队等待 | 13 分钟（v1）/ 26 分钟（v2，21:02 推送 → 21:29 开跑） |

分方案结果（v2，均为 fp16、4 步、CFG 1.0、seed 42~44）：

| 方案 | 尺寸 | 加载 | 首图 | 稳态中位 | 峰值显存 | 结果 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `single` 单卡整管 | 1024² | — | — | — | 14.43 GiB 已分配 | OOM，崩在 `.to("cuda")` |
| `single512` 单卡整管 | 512² | — | — | — | 14.43 GiB 已分配 | OOM，同样崩在加载 |
| `dual` 双卡 `device_map="balanced"` | 1024² | 28.2 s | 15.17 s | **10.24 s** | 7929 MB | 通过 |
| `offload` 单卡 + CPU offload | 1024² | 30.4 s | 33.53 s | 27.01 s | 7996 MB | 通过但慢 |

结论：单卡装不下是**模型体量**问题，与分辨率无关（512² 与 1024² 崩在同一处）；1024² 只能走双卡或 CPU offload。双卡稳态 10.24 秒，落在准入阈值（≤15 秒）内；offload 的 27 秒超出阈值，只作兜底。

`z-image-turbo`：待测（权重 24GB 量级，需先解决缓存策略）。

> 回填要求：注明测量日期、内核 ID、`--accelerator` 取值、是否命中 HF 缓存。

---

## 6. 权重缓存路线

现状：每次冷启动从 Hugging Face 拉取；实测 `flux2-klein-4b` 15.2GB、`moss-image` 25.96GB、`z-image-turbo` 约 24GB。

会话磁盘实测（见 [EXPERIMENTS.md](EXPERIMENTS.md) E7）：`/root/.cache` 位于 8TB 共享 overlay，权重放这里不会被 20GB 卡住，但**会话结束即清除**；`/kaggle/working` 是独立的 20GB 回环盘，装不下大权重。因此"上次留在盘上"这条路不存在。

v1：卡片上明示下载体量与"首次约 X 分钟"；不承诺缓存。

v1.1：引导用户把权重放进一个 Kaggle Dataset，内核元数据经 `dataset_sources` 挂载，命中后跳过下载。可行性取决于用户账号的存储配额（未实测），因此只对体积最小的 1~2 个预设提供引导。

v2：插件自动维护缓存数据集版本。

---

## 7. 与旧配置的关系

现有 `configs/models.json` 在 M1 阶段迁移为 `lib/presets.js`（TypeScript 常量，随包发布）；用户自定义预设不再通过编辑 JSON，而是后续版本的 UI 增删。迁移时保留原有四个预设的名称，避免历史记录里出现无法解释的模型名。
