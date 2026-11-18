# 推理加速与显存优化 SOTA 调研及验证方案

> **状态**：📋 调研完成；P0 加速项已按第四节协议在 Kaggle `2×T4` 完成首轮真机 A/B（2026-11-18，见 §4.2/§4.3），**首轮三项均未达合入门槛，默认路径保持未启用**。P1 缓存类优化与 Colab `torchao` FP8 已于阶段十六完成可行性探针与真机评估（见 §4.4）：**当前模型组合下均不适用/无合入价值，不做运行时改造**；`/health.gpu_memory` 峰值口径已改为「当前管线峰值」。  
> **适用范围**：`remote/inference/loaders/` 推理加载与采样路径（Kaggle `2×Tesla T4` 与 Colab `L4 / A100`）  
> **核心原则**：**一切收益以同 Seed / 同尺寸真机对照数据为准**；未经真机实测验证与画质复核的加速项不得合入默认路径，**只有真正落地并跑出实测数据的优化才能写入 `README.md` 对外对比宣传**。

---

## 一、 现状基线与硬件约束（第一性原理）

当前仓库的推理加载（[remote/inference/loaders/diffusers.py](remote/inference/loaders/diffusers.py)）基线策略为：
- 统一使用 `torch.float16` 加载；
- `flux2` 在多卡（`device_count > 1`）时走 `device_map="balanced"`，单卡（Colab L4/T4）走 `pipe.to("cuda")`；
- 少步数加速依赖模型自身的蒸馏权重（`SDXL-Lightning` 4 步、`Hyper-SDXL` 8 步、`FLUX.2 Klein 4B` 4 步），**尚未开启运行时布局/VAE/缓存/量化加速**。

两套目标算力环境的物理差异决定了优化策略不能一刀切：

| 算力环境 | 架构与核心限制 | 优化取向 |
| :--- | :--- | :--- |
| **Kaggle `2×Tesla T4`** | Turing（`sm_75`），16GB×2，**无原生 BF16 / FP8 Tensor Core**，无 FlashAttention-2 硬件支持；短生命周期无状态会话（冷启动敏感），容器约 20GB 可写空间 | 优先**零冷编译开销**、**`fp16` Tensor Core 友好**（`channels_last`、VAE Tiling）、**多步模型跳步缓存**；避免编译耗时和层间 PCIe 频繁搬运 |
| **Colab Pro `L4 / A100`** | Ada（`sm_89`）/ Ampere（`sm_80`），单卡 24GB / 40GB+，**原生支持 BF16 / TF32 / FlashAttention-2**（L4 原生支持 FP8） | 除基础优化外，适合启用 **`torchao` FP8 量化**、**`SageAttention` / FA2**，用来跑 `FLUX.2 Klein 9B`、`FLUX.1-Fill-dev`、`Qwen-Image-Edit` 等大模型 |

---

## 二、 分层候选方案清单

### P0：零新依赖、低风险、立即可验（修改集中在 `loaders/diffusers.py`）

1. **`pipe.enable_vae_tiling()` 与 `pipe.enable_vae_slicing()`**
   - **原理**：高分辨率图（如 `1536×864` 扩图、`1536×1024`）在最后一步 VAE 解码时会瞬间产生数 GB 临时激活；Tiling 将图像切成重叠瓦片分块解码，Slicing 在 batch>1 时逐张解码。
   - **预期收益**：显著压低高分辨率出图的瞬间显存峰值（`max_allocated_mb`），避免边缘 OOM；对单张耗时影响极小（通常 < 0.2s）。
   - **验收要点**：重点在 `sdxl-inpaint` `1536×864` 扩图与 `1536×1024` 文生图上对比峰值显存，并肉眼检查瓦片接缝（Tiling 边界不应出现色差或网格线）。

2. **SDXL `channels_last` 内存排布 + `fuse_qkv_projections()`**
   - **原理**：将 UNet 权重与中间激活切换为 `NHWC`（`pipe.unet.to(memory_format=torch.channels_last)`），更贴合 T4 Tensor Core 访存模式；`fuse_qkv_projections()` 将 Attention 里的 Q/K/V 三次独立投影合并为单次矩阵乘法，减少 CUDA kernel launch 次数。
   - **预期收益**：零画质损失，在 T4 上通常带来 **5%~15%** 的免费稳态耗时下降。
   - **验收要点**：验证切换 `channels_last` 后与 `LoRA` 挂载（`sdxl-lora`）、`AutoPipelineForInpainting.from_pipe()`（img2img/inpaint 复用底座）是否存在兼容性异常。

### P1：高性价比多步模型提速（重点解决 25~30 步模型耗时）

仓库中 `sdxl-inpaint`（30 步 35.4s）、`sdxl-base`（25 步 27.8s）、`realvis-v5`（25 步 24.5s）、`playground-v2.5`（30 步 28.3s）耗时显著高于 4 步模型，核心瓶颈在连续 25~30 次 UNet/DiT 全量前向。

3. **特征缓存跳步：`First-Block Cache (FBCache)` / `TeaCache` / `ParaAttention`**
   - **原理**：扩散去噪中后段相邻步的特征变化高度冗余。FBCache / TeaCache 只计算第一个 Block，若残差变化低于阈值则直接跳过后续几十层网络并复用上一时间步的残差输出；无需重训练或修改权重。
   - **适用边界**：
     - **适用**：≥ 15 步的常规多步模型（`sdxl-base`、`sdxl-inpaint`、`realvis-v5`、`playground-v2.5`、`FLUX.1` 20~28 步模型），预期提速 **1.5× ~ 2.0×**（如 `sdxl-inpaint` 扩图有望从 ~35s 降至 ~18–22s）。
     - **不适用**：4~8 步蒸馏模型（`sdxl-lightning`、`hyper-sdxl-8step`、`flux2-klein-4b`），步数过少且每步变化剧烈，强行跳步会直接糊图。
   - **实现注意**：优先调研 `diffusers` 原生自带的缓存 hook（避免引入冷启动安装复杂的大包）；若需引入轻量模块，需保证镜像/pip 安装耗时 < 5s 且与 `diffusers 0.43 + torch 2.11` 兼容。

4. **多步专用权重叠加蒸馏加速 LoRA（按需可选）**
   - **原理**：在 `sdxl-inpaint` 等 30 步模型上评估是否兼容 `Hyper-SD` / `DMD2` 加速 LoRA（8 步出图），仅作为可选加速档评估，**不默认覆盖原质量档**，防止削弱局部重绘融合度。

### P2：大显存与次世代 DiT 专属（配合 Colab L4 / A100 与 Phase C）

5. **`torchao` 权重量化（FP8 / INT8）**
   - **适用对象**：`FLUX.2 Klein 9B`、`FLUX.1-Fill-dev`（12B）、`Qwen-Image-Edit` 等 16GB~24GB 级大模型。
   - **硬件分化**：
     - **Colab L4（`sm_89`）**：原生支持 FP8 Tensor Core，量化后**显存减半 + 计算加速**双赢；
     - **Kaggle T4（`sm_75`）**：无原生 FP8 硬件加速，FP8 仅作为**“降显存防 OOM”手段**（计算前反量化回 FP16），不能指望在 T4 上提速，甚至可能轻微变慢。

6. **注意力内核：`SageAttention`（面向 L4 / A100 长序列 DiT）**
   - **原理**：将注意力矩阵（$QK^T$ / $PV$）动态量化到 INT8/FP8 执行，针对 FLUX 等高分辨率长序列 DiT 效果显著；PyTorch 2.11 默认 SDPA 在 T4 上已走 memory-efficient attention，`FlashAttention-2` 仅 `sm_80+`（A100/L4）可用，不用于 T4。

---

## 三、 明确避雷清单（在当前项目架构下属于负优化）

| 伪优化方案 | 为什么在本项目不推荐 |
| :--- | :--- |
| **`torch.compile()`** | 本项目是用户按需开机、出几张图后空闲关机的短生命周期会话，首次编译卡顿 **40~120 秒**，无法在单次会话内回本。 |
| **`sequential_cpu_offload()`** | 按单层网络通过 PCIe 在 CPU/GPU 间搬运，会把 6~10 秒的推理拖慢到分钟级；仅在实在放不下时考虑模块级 `enable_model_cpu_offload()`。 |
| **`TAESD` 替代成片 VAE** | 虽可把 VAE 解码从 ~0.5s 缩到 0.05s，但损失高频纹理与锐度，不符合本工作台「高清直出 + 2× 超分交付」的画质定位。 |

---

## 四、 专员验证协议与对比基准模板

后续专员在执行规划（如 Phase C 或专项性能批次）时，若顺带落地上述某项优化，**必须执行以下对照验收**，并把结果追加写入本文档与 `bench-results/gpu-live/`：

### 4.1 验收门禁要求
1. **严格控制变量**：同一台 GPU 机型、同一 `presetId`、同一 `prompt`、同一 `seed`（例如 `seed=42`）、同一宽高，分别跑**「未优化基线（普通 `diffusers` `from_pretrained` 默认加载）」**与**「启用优化后」**各 ≥ 2 轮（取稳态 `imageSeconds` 与 `/health.gpu_memory.max_allocated_mb`）。
2. **画质一致性校验**：
   - 无损优化（`vae_tiling`、`channels_last`、`fuse_qkv_projections`）：对比前后输出图的像素平均绝对差（MAE）与肉眼主观细节，确保无网格接缝与色偏。
   - 有损/近似优化（`FBCache` / `TeaCache` / 量化）：保留前后成片 PNG 并排对比，确保提示词遵循度、细节锐度和扩图边界融合不出现明显退化。
3. **跨工具回归**：确认 `from_pipe` 复用的 `img2img` / `inpaint` 与独立 `upscale` 在优化开启后均不报错、显存无残留泄漏。

### 4.2 实测对比记录表（2026-11-18 回填）

判定口径：中位耗时下降 ≥3%、峰值显存不升、同 seed 输出 MAE ≤2/255 才建议合入（由 Lead 最终拍板）。

| 测试环境 | 模型 / 场景 | 优化项 | 基线耗时 (`imageSeconds`) | 优化后耗时 (`imageSeconds`) | 基线峰值显存 (MB) | 优化后峰值显存 (MB) | 画质复核结论 | 是否合入默认路径 |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Kaggle 2×T4 | `sdxl-lightning` 1024² (4步) | `channels_last` + `fuse_qkv` + `vae_tiling` | 6.19s（两轮 6.43 / 5.94） | 5.96s（两轮 5.96 / 5.95），提速 1.04× / +3.9% | 10233 | 11469（+1236） | **不一致**：同 seed 输出 MAE 11.06/255，且构图由「单鹤」变为「双鹤」（4 步蒸馏对数值扰动敏感）；肉眼可辨 | **否**：提速未达显著门槛，峰值显存上升且画质不一致 |
| Kaggle 2×T4 | `sdxl-inpaint` 1536×864 扩图 (30步) | `vae_tiling` | 35.91s（两轮 34.93 / 36.88） | 37.53s（两轮 37.58 / 37.48），提速 0.96×（慢 4.5%） | 11469*（累计口径，见下） | 11469*（同左） | 一致：内容区核心差 0、输出 MAE 3.8/255、左右接缝梯度比 1.62/1.32 → 1.50/1.28（略好），肉眼无新增接缝 | **否**：无提速；累计显存峰值口径无法证实降峰值收益（见 §4.3.5） |
| Kaggle 2×T4 | `sdxl-base` 1024² (25步) | `FBCache` / `TeaCache` | *未测* | *未测* | *未测* | *未测* | *未测* | **否**：本轮未实现该优化，无同 Seed 数据；按 §2 P1 属候选，留待专项批次 |
| Colab L4 (24GB) | `flux2-klein-4b` / `9B` | `torchao` FP8 / `SageAttention` | *未测* | *未测* | *未测* | *未测* | *未测* | **否**：本轮无 Colab L4 环境；T4 无 FP8 硬件加速，不适用 |

\* 峰值显存取 daemon `/health.gpu_memory.max_allocated_mb`；该值是进程内**累计**峰值（`torch.cuda.max_memory_allocated()` 未在档位间 reset），因此 `sdxl-inpaint` 的 off/on 两档读到同一个 11469 MB（完整口径说明见 §4.3.5）。

---

### 4.3 Phase C1 实测记录（2026-11-18，Kaggle 2×T4）

- **会话**：Kernel `mogudd/imagen-a7a3c72f`，同一 Kernel 会话内连续完成三段验收；结束时 Kernel 已删除（`kernelStatus` 返回 `missing`，无 RUNNING/QUEUED 残留）。
- **环境**：Python 3.13.16 / torch 2.11.0+cu130 / diffusers 0.43.0 / transformers 5.23.0 / accelerate 1.16.0；2× Tesla T4（单卡 14912 MB）。
- **配额**：3.90h → 4.10h（消耗 0.20h；排队约 1 分钟，执行约 12 分钟）。
- **产物**：`bench-results/gpu-live/2026-11-17T23-05-24/`（`report.json` + 全部样张 PNG）。

#### 4.3.1 原生参考生图验收（`supportsReference`，flux2-klein-4b）

| 场景 | 加载 (s) | 推理 (s) | 输出尺寸 | 备注 |
| :--- | ---: | ---: | :---: | :--- |
| 白名单预下载 + 首次加载 | 118.8 | — | — | `[load] 预下载 black-forest-labs/FLUX.2-klein-4B（白名单 6 条）… 用时 78.6s`，随后 `from_pretrained` 成功（variant=None + device_map=balanced），**白名单正确性真机通过** |
| 文生图源图 1（seed 42） | 118.8 | 14.54 | 1024×1024 | 首图含 warmup |
| 文生图源图 2（seed 43） | 0 | 8.6 | 1024×1024 | 稳态 |
| 1 张参考图（第 1 轮） | 0 | 20.11 | 1024×1024 | 输出严格等于请求尺寸 |
| 1 张参考图（第 2 轮，同 seed） | 0 | 20.64 | 1024×1024 | **与第 1 轮逐像素一致（MAE 0）** |
| 2 张参考图 | 0 | 39.94 | 1024×1024 | 双参考可用，未截断/无告警 |
| 1 张参考图 + 1280×720 | 0 | 21.64 | **1280×720** | 画幅保持断言通过（不跟随参考图尺寸） |
| 连续参考推理后复测文生图 | 0 | 9.8 | 1024×1024 | 峰值显存无增长（见下） |

- **确定性**：同 seed 两次参考生图 `determinismMae = 0`；`reusedPipeline = true`（后续轮 `load_seconds = 0`）。
- **参考影响度**：同 seed「1 张参考图 vs 无参考图」MAE 7.71，1 张 vs 2 张参考图 MAE 1.99 —— 参考图参与条件但属**弱条件**，成片仍由 prompt + seed 主导（肉眼：构图基本不变，仅细节/笔触差异）。
- **显存稳定性**：参考推理前后与复测后 `/health.gpu_memory.max_allocated_mb` 均为 7928 MB，`maxAllocatedDeltaMb = 0`、`noGrowth = true`。
- **硬件要求**：首次加载（含 78.6s 白名单下载）可用；该模型权重约 15 GB 级（fp16，`device_map="balanced"` 跨 2 卡），**单卡 15GB 级 T4 放不下，最低要求 2×T4 或单卡 ≥24GB**。

#### 4.3.2 P0 推理加速 A/B（同 Kernel、同 seed=42、同 prompt、同尺寸，每档 2 轮取中位）

| 场景 | off 中位 | on 中位 | 提速比 | 峰值显存差 | 同 seed 输出 MAE | 判定 |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| `sdxl-lightning` 1024² 4 步（on = `channels_last`+`fuse_qkv`+`vae_tiling`） | 6.19s | 5.96s | 1.04×（+3.9%） | **+1236 MB** | **11.06/255**（构图改变） | 不合入 |
| `sdxl-inpaint` 1536×864 扩图 30 步（on = `vae_tiling`） | 35.91s | 37.53s | 0.96×（慢 4.5%） | 累计口径不可比 | 3.8/255（内容区核心差 0） | 不合入 |

补充：每档内部两轮输出逐字节一致（PNG 字节数相同），说明配置内确定性成立、差异来自配置本身而非随机性。

#### 4.3.3 原生 inpaint 可行性（探针数据，2026-11-17）

`Flux2KleinInpaintPipeline.from_pretrained("black-forest-labs/FLUX.2-klein-4B", torch_dtype=float16, device_map="balanced")` 可直接加载 4B 权重并出图（加载 56.0s / 缓存命中）：

- 「864×864 原图居中 + 1536×864 画布 + 左右白边蒙版」4 步 strength=1.0：**输出被内部 1MP 面积上限缩为 1360×768**，耗时 22.18s、峰值 17937 MB（两卡汇总），扩图成片自然、接缝梯度比 0.89/1.27、新增区非纯白。
- 「1280×720 画布」（<1MP）：输出严格 1280×720，19.35s，但接缝梯度比 2.09/3.00（肉眼可见竖线）。
- 对比 `sdxl-inpaint` 35.42s 基线：**快 1.60×~1.83×**。
- **结论**：技术可行但 **>1MP 画布不可用 / 4 步接缝质量不足**，本轮不迁移默认扩图引擎；若启用需 ≥8 步且画布限制 ≤1MP。

#### 4.3.4 结论与合入决策

1. **P0 三项全部不合入默认路径**：`channels_last + fuse_qkv` 在 4 步蒸馏模型上提速不显著（+3.9%）、峰值显存上升且画质不一致；`vae_tiling` 在扩图场景无提速、累计口径无法证实降峰值收益。`pipeline.accel` 保留为可选开关（代码能力保留），模型资产全部保持未启用。
2. **原生参考生图能力可用于 Phase C1 契约**（`referenceImages` maxCount=2 / maxEdge=1024 / maxBytes=4 MiB），代价是 1 张参考 +12s、2 张 +31s（相对 8.6s 稳态文生图）；参考语义为弱条件，产品文案不应承诺强风格/构图迁移。
3. **P1 缓存类优化（FBCache/TeaCache）未实现、未实测**：按适用边界不适用于 4~8 步蒸馏模型；SDXL 多步模型（`sdxl-base` 25 步、`sdxl-inpaint` 30 步）仍是有价值候选，需要引入实现后再按同协议验证。
4. **硬件门槛**：`flux2-klein-4b` 需 2×T4（合计 29.8GB）或单卡 ≥24GB；其 t2i 与 inpaint 两套管线各占约 15.2GB 权重，**不能同时驻留**，切换需卸载重载（缓存命中约 56s）。

#### 4.3.5 测量口径与限制（后续复测必须修正）

- daemon `/health.gpu_memory.max_allocated_mb` 取自 `torch.cuda.max_memory_allocated()`，是**进程内累计峰值**，档位切换时不会 reset：本轮顺序跑 off → on 时，on 档读到的 11469 MB 是累计值，因此 `vae_tiling` 是否真能压低扩图峰值**未被证实**（也不好证伪）。
- 后续复测建议二选一：① 每档独立重启 daemon（或独立 Kernel）后再读数；② daemon 在 `ensure_pipeline` 加载新配置后调用 `torch.cuda.reset_peak_memory_stats()`，让 `/health` 反映当前档位峰值。本轮不改 daemon（避免与 task-2 交付并行冲突）。
- 同 seed 一致性只对「同配置内」成立；切换 `channels_last/fuse_qkv` 会改变数值路径，4 步蒸馏模型会把微小数值差异放大成不同构图，不能按「无损优化」宣传。

#### 4.3.6 样张与报告索引

- `bench-results/gpu-live/2026-11-17T23-05-24/report.json`（reference / accel 全量数据）
- 参考生图：`01-source-1.png`、`01-source-2.png`、`02-reference-1ref-1024x1024.png`、`02-reference-1ref-1024x1024-round2.png`、`02-reference-2ref-1024x1024.png`、`02-reference-1ref-1280x720-frame.png`、`03-txt2img-after-refs.png`
- 加速 A/B：`02-accel-{off,on}-round{1,2}.png`、`02-outpaint-{off,on}-round{1,2}.png`、`02-outpaint-canvas.png`、`02-outpaint-mask.png`
- 原生 inpaint 探针：`bench-results/gpu-live/2026-11-17T22-02-48-probe/`（含 `PROBE-SUMMARY.md`）

---

### 4.4 P1 缓存与 Colab FP8 评估（2026-11-18，阶段十六收口）

> 目标：按 §2 P1 条款验证「多步模型跳步缓存（FBCache / TeaCache）」与「Colab L4 `torchao` FP8」能否在当前模型组合上带来可合入收益。结论：**两者均不适用/无合入价值，不做运行时改造**；`pipeline.accel` 保留 P0 四个稳定布尔开关，不新增量化或缓存字段。

#### 4.4.1 实验条件与实现

- **实现**：`remote/inference/loaders/diffusers.py` 的 `apply_accel` 新增实验性 `accel.cache = { type: 'firstBlock', threshold? }`（默认 `threshold=0.05`），只在请求级 `pipeline` 覆盖里使用；**不进入 `PIPELINE_ACCEL_KEYS`、不写入任何模型资产**。特性检测 diffusers `FirstBlockCacheConfig` / `apply_first_block_cache`，只对 `pipe.transformer` 生效；所有不适用场景只打印 `[accel] WARN cache 不适用：<原因>` 后继续出图（探针语义，不阻断）。
- **静态预检**：应用前检查 block 数量、`TransformerBlockRegistry` 是否注册以及各 block 返回形状是否同类；不通过即跳过，避免挂半套 hook 后前向崩溃。
- **环境**：Kaggle 2×Tesla T4、Python 3.13.16 / torch 2.11.0+cu130 / diffusers 0.43.0 / transformers 5.23.0；Kernel `mogudd/imagen-99e55e1c`（已关机，无残留）。

#### 4.4.2 FBCache 真机 A/B（`flux2-klein-4b`，1024² / 4 步 / seed 42，每档 2 轮）

| 档位 | 轮次耗时（s） | 中位耗时（s） | 两档输出 MAE | 峰值显存（`max_allocated_mb`） |
| :--- | :--- | ---: | ---: | ---: |
| off | 13.27 / 9.38 | 11.33 | — | 7928 |
| on（`cache.firstBlock`） | 9.57 / 9.76 | 9.66 | **0**（四张 PNG 字节数完全相同，1905413 B） | 7928 |

- **缓存未生效**：远端日志为 `[accel] WARN cache 不适用：block 输出形状混合（tensor 与 (encoder, hidden) 元组并存），firstBlock 不支持`。diffusers 0.43 的 `apply_first_block_cache` 把首个 block 当 head、最后一个 block 当 tail，并按「首尾输出同构」的假设做残差相加；`Flux2Transformer2DModel` 是双栈结构（`transformer_blocks` 返回元组、`single_transformer_blocks` 返回张量），不满足该假设，强行应用会在运行期报错。
- **off 档 11.33s 的中位偏高是首轮冷启动**：第二轮 off 9.38s vs on 9.76s（on 反而略慢 4%）。因缓存未应用且两档输出逐像素一致，**不能把 1.17× 的中位比当作加速收益**。
- **SDXL 家族**：`sdxl-*` 是 UNet 管线，没有 `pipe.transformer`，firstBlock cache 天然不适用；要覆盖 25~30 步 SDXL 需要自研 UNet 级跳步缓存，属第三方研究项，不在本轮范围。

#### 4.4.3 Colab L4 `torchao` FP8 评估（不做运行时改造）

- **diffusers 0.43 现状**：`TorchAoConfig`（`Float8WeightOnlyConfig` 等）只对管线内的 transformer 权重做量化，文本编码器保持原精度；换言之 9B 级模型的显存大头（8B Qwen3 文本编码器，15.26GB）无法靠 FP8 缩掉。
- **显存预算**：`flux2-klein-9b` transformer fp8 约 9.1GB + 文本编码器 fp16 15.26GB + VAE 0.16GB ≈ 24.5GB，仍超过 L4 的 22.4GiB 可用显存；Colab A100 40GB 已能直接跑 fp16 全量。FP8 的目标机型（L4/G4 等 Ada/Blackwell）要么装不下，要么本就不需要它。
- **收益面**：`flux2-klein-4b` 在 L4 上 fp16 已可运行，FP8 只可能带来吞吐收益，但需引入 `torchao` 依赖与量化缓存，且与「免费云端、零额外依赖、冷启动优先」的定位冲突。
- **结论**：本轮不引入 `torchao` FP8；若后续接入 20B 级编辑模型并落到 80GB 单卡，再按「fp8 + 量化文本编码器 + 新运行时」整体评估。

#### 4.4.4 测量口径修正（已合入）

- `remote/daemon.py` 新增 `reset_peak_memory_stats()`，在 `ensure_pipeline` 加载/切换成功后调用；`/health.gpu_memory.max_allocated_mb` 从「进程累计峰值」改为「当前管线峰值」，档位之间可比较（§4.3.5 复测建议②）。
- 注意：本修正之前的历史报告（§4.2/§4.3）是累计口径，不能与修正后的数字直接相减比较；同一次真机会话内的「加载前 → 生成后」对比仍然有效（会话内只加载一次时不触发重置）。

#### 4.4.5 产物索引

- 报告与样张：`bench-results/gpu-live/2026-11-18T08-05-25/`（`report.json` 的 `accelCache` 段 + `01/02-cache-{off,on}-round{1,2}.png`）
- 运行日志：`.tmp/colab/accel-cache.log`

---

## 五、 README 对外宣传回填规范（验证后执行）

**前置条件**：严禁在未完成真机实测前把预估加速比写进 `README.md` / `README.en.md`。  
待第四节对比表中的优化真机验证通过并合入 `main` 后，可按如下结构在 `README.md` 与 `README.en.md` 同步补充「推理加速与显存优化」对比卡片/表格，直观体现与普通默认 `diffusers` 部署方案的差异：

- **对比维度建议**：
  1. **出图耗时对比**：普通默认部署（`from_pretrained` 默认管线） vs 本插件优化部署（`channels_last` + `FBCache/TeaCache` + 蒸馏少步模型）在 Kaggle 免费 `2×T4` / Colab `L4` 上的实测秒数与提速倍率；
  2. **显存安全余量**：开启 `vae_tiling` / `torchao` / 模型按需释放后，16GB T4 甚至可稳定跑通 `1536×864` 扩图与 `2560×1440` 超分而不 OOM；
  3. **冷启动策略取舍**：说明为何主动放弃高首帧编译延迟的 `torch.compile`，做到「即开即画、不白烧免费 GPU 配额」。
