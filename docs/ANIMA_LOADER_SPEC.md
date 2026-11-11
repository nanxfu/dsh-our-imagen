# Anima-Light-Lavender 接入规格 (ANIMA_LOADER_SPEC)

本文档记录 `anima-light-lavender` 从「外部单文件 ComfyUI 模型」到「工作台可用预设」的接入方式：模型事实、为何需要新 loader、loader 契约、单份源码与打包内联落点、实测数据。模型资产本身见 [`models/anima-light-lavender.json`](../models/anima-light-lavender.json)，通用格式见 [`MODEL_ASSET_SPEC.md`](MODEL_ASSET_SPEC.md)。

**结论**：该模型可以在 Kaggle 单卡 Tesla T4 上部署出图，但它是**单文件 ComfyUI checkpoint**，仓库没有 diffusers 目录结构，也不是任何 `AutoPipelineForText2Image` 能加载的管道。仓库因此新增 loader `anima`：按 Hugging Face 官方 demo Space 的纯 PyTorch 复刻实现自包含运行时（Cosmos-Predict2 MiniTrainDIT + Anima LLMAdapter + Qwen3-0.6B 文本编码器 + Qwen-Image VAE），不启用 `trust_remote_code`。

---

## 1. 模型事实

| 项 | 内容 |
| :--- | :--- |
| 权重仓库 | [`Johnny-Z/Anima-Light-Lavender`](https://huggingface.co/Johnny-Z/Anima-Light-Lavender)（`library_name: diffusion-single-file`，非 gated） |
| 底座 | [`circlestone-labs/Anima`](https://huggingface.co/circlestone-labs/Anima) 的 `anima-base-v1.0` 后训练版本，血统追溯到 `nvidia/Cosmos-Predict2-2B-Text2Image` |
| DiT | Cosmos-Predict2 `MiniTrainDIT`，28 层，`model_channels=2048`、16 头、`patch_spatial=2`、in/out 16 通道、`crossattn_emb_channels=1024`、`adaln_lora_dim=256`；含 Anima LLMAdapter（T5 词表 32128 → 1024，6 层 16 头）。**实测 685 个 tensor / 2,091,068,928 参数，全部 BF16，`net.` 前缀** |
| 权重文件 | `anima-light-lavender.safetensors`（BF16，3.90 GiB）；仓库另有 `_mxfp8` 变体（本轮不用） |
| 文本编码器 | Qwen3-0.6B：`circlestone-labs/Anima` 的 `split_files/text_encoders/qwen_3_06b_base.safetensors`（1.11 GiB，310 个 `model.` 前缀 tensor，无 `lm_head`） |
| VAE | Qwen-Image VAE：`Qwen/Qwen-Image` 的 `vae/` 子目录（`AutoencoderKLQwenImage`，0.24 GiB） |
| 分词器 | 两套：`Qwen2Tokenizer`（Qwen 词表，151936）+ `T5TokenizerFast`（T5 词表 32128，LLMAdapter 的 target ids）。文件取自 HF 官方 demo Space `hugging-apps/anima-light-lavender-demo` 的 `qwen25_tokenizer/` 与 `t5_tokenizer/`（约 6.9 MB） |
| 许可证 | CircleStone Labs Non-Commercial License（**仅限非商用**）+ 作为 Cosmos-Predict2 衍生模型受 NVIDIA Open Model License 约束 |
| 推荐参数 | euler + simple 调度（`shift=3.0`）、25 步、CFG 4.0、负向提示词**留空**、分辨率约 1024~1280 |
| 提示词 | 结构化 Danbooru caption（JSON：`year` / `preference_level` / `artist` / `copyright` / `character` / `image_description` / `extra_tags`），核心是 `image_description` 里的长自然语言描述 |

参考实现：HF 官方 demo Space 的 `app.py` 是对 ComfyUI 参考工作流（`anima.json`）的忠实 PyTorch 复刻，本仓库的 anima 运行时代码即由它移植而来（对应 ComfyUI 的 `comfy/ldm/cosmos/predict2.py`、`comfy/ldm/anima/model.py`、`comfy/text_encoders/anima.py`、`comfy/model_sampling.py`、`comfy_extras/nodes_cfg.py`）。

---

## 2. 为什么需要新 loader

1. **没有 diffusers 仓库**：该仓库只有 `README.md`、两个 `.safetensors`、两个 ComfyUI 工作流 JSON 和一张 banner；没有 `model_index.json`，`from_pretrained` / `from_single_file` 都无从匹配。
2. **架构不在 diffusers 的管道里**：即使上游 `nvidia/Cosmos-Predict2-2B-Text2Image` 是 diffusers 目录（transformer/vae/text_encoder），它也是 gated（需登录 + 接受 NVIDIA 协议），且 Cosmos 系列惯例上依赖仓库自定义代码；本仓库不引入 `trust_remote_code`。
3. **三件套自定义组合**：Cosmos DiT + Qwen3 文本编码器 + Qwen-Image VAE 的组合只有 ComfyUI / 官方 demo 实现了推理图，diffusers 没有对应 pipeline。

因此 loader `anima` 直接按权重布局构造模型并手写采样循环（euler + simple + CFG + CFG-Zero★），只借用 diffusers 的 `AutoencoderKLQwenImage` 与 transformers 的 `Qwen3Model` / `Qwen2Tokenizer` / `T5TokenizerFast`。

---

## 3. loader 契约

`models/<id>.json` 的 `pipeline` 字段（下发给远端 daemon 的加载描述）：

```json
{
  "loader": "anima",
  "base": "Johnny-Z/Anima-Light-Lavender",
  "weight": "anima-light-lavender.safetensors",
  "textEncoder": { "repo": "circlestone-labs/Anima", "weight": "split_files/text_encoders/qwen_3_06b_base.safetensors" },
  "vae": { "repo": "Qwen/Qwen-Image", "subfolder": "vae" },
  "tokenizers": { "repo": "hugging-apps/anima-light-lavender-demo", "repoType": "space" },
  "dtype": "auto",
  "shift": 3.0,
  "downloadGb": 5.6
}
```

| 字段 | 说明 |
| :--- | :--- |
| `base` / `weight` | DiT 仓库与单文件权重名（`hf_hub_download` 单文件拉取，不整仓下载） |
| `textEncoder` | Qwen3 文本编码器仓库与权重文件 |
| `vae` | VAE 仓库与子目录（只下载该子目录） |
| `tokenizers` | 分词器所在仓库；`repoType: "space"` 表示 Hugging Face Space 仓库 |
| `dtype` | `auto`（默认）/ `fp16` / `bf16` / `fp32`。`auto` = 仅当 GPU compute capability ≥ 8.0 且 `is_bf16_supported()` 才用 bf16，否则 fp16 |
| `shift` | flow-matching 的 SNR shift，模型卡为 `3.0` |
| `downloadGb` | 四个资产的实测下载体积，用于 daemon 的磁盘预检 |

调用约定（与 diffusers pipeline 对齐）：

- `pipe(prompt, negative_prompt, num_inference_steps, width, height, guidance_scale, generator)` → 返回带 `.images` 的对象；
- `prompt` 会被包装成结构化 caption：`{"year": 2025, "preference_level": "best", "image_description": <prompt>}`，再按 ComfyUI 的括号权重规则转义；
- `width` / `height` 向下取整到 16 的倍数（latent 除以 8，再除以 patch 2）；
- `guidance_scale > 1` 走「标准 CFG + CFG-Zero★」，cond/uncond 拼成一个 batch 前向；`≤ 1` 走单遍（无负向）；
- 负向提示词为空时按空 caption 编码（模型卡推荐留空）；
- 每张图固定 25 步上限内的 `num_inference_steps`，seed 取自传入的 `torch.Generator`。

---

## 4. 实现落点

Anima 运行时只有**一份源码** `remote/anima_runtime.py`。Kaggle 只接受单个 `code_file`，但两份实现是打包阶段的问题，不是源码组织的问题：

| 文件 | 角色 | 关键符号 |
| :--- | :--- | :--- |
| `remote/anima_runtime.py` | 唯一实现（模型定义 + caption/分词/RoPE/调度/CFGZeroStar + `load_anima_runtime()`） | `_anima_toolkit()`、`load_anima_runtime()`、`AnimaRuntime` |
| `tools/payload/verify-model.py` | 一次性 Kaggle 验证 payload | 一行带 `# @@INLINE:anima_runtime.py@@` 的 import；打包时被替换为模块全文 |
| `remote/daemon.py` | 生产常驻 daemon | 同样一行标记 import；另有 `SUPPORTED_LOADERS` 的 `"anima"`、`anima_local_assets()`（预挂载解析）、`build_pipeline()` 的 anima 分支、`release_pipeline()` 调用 `pipe.release()` |

打包链路：`lib/kernel.js` 的 `inlineMarkedModules()` 把标记行整行替换为 `remote/anima_runtime.py` 全文，因此最终推送的 Kernel 仍是自包含单文件（`tools/verify-model.mjs` 复用同一打包器）；仓库内本地运行走同目录普通 import。日志函数保持参数注入（`load_anima_runtime(spec, log=...)`）：daemon 传「日志环 + print」版，payload 传纯 print 版，模块里不写死任何一种。修改时只改 `remote/anima_runtime.py`，不要复制回两个入口文件。

运行期设计要点：

1. **dtype**：`auto` 按 compute capability 判定。T4（sm_75）在 CUDA 13 上 `is_bf16_supported()` 会返回 True，但 bf16 是模拟执行（实测 8.7 s/次前向），必须降到 fp16；A100/H100 等 sm_80+ 用 bf16。
2. **文本编码器卸载与缓存**：编码完 cond/uncond 立即把 Qwen3 移到 CPU，按文本缓存 embedding（≤8 条，CPU 存储），后续采样与 VAE 解码期间文本编码器不占显存。
3. **解码前释放**：采样中间张量出作用域后 `gc.collect()` + `torch.cuda.empty_cache()`，并在入口文件顶部（任何 torch import 之前）`os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")`。
4. **解码兜底**：`vae.decode` 捕获 `torch.OutOfMemoryError` → VAE 临时转 CPU float32 解码（慢但出图）；出现 NaN/Inf 先 VAE fp32 重试；仍失败且当前是 fp16 时，返回占位图并切 bf16、同 seed 重跑当前张，后续沿用 bf16——避免十分钟跑出一张废图却静默成功。
5. **预挂载**：`localModels` 命中时，DiT/文本编码器按单文件、VAE/分词器按子目录判定，命中即跳过下载与磁盘预检。
6. **真实尺寸回传**：Anima 采样前会把宽高向下取整到 16 的倍数（例如 648 → 640），`run_task` 统一回传 PIL 实际出图尺寸，宿主 `meta.json` 记录的是真实像素而非请求值。

---

## 5. 实测记录（Kaggle Tesla T4 ×1）

**环境**：Kaggle 账号 `mogudd`，加速器 `NvidiaTeslaT4`（2×Tesla T4，本轮只用 1 张，单卡容量 14.56 GiB），Python 3.13.16 / torch 2.11.0+cu130 / CUDA 13.0，diffusers·transformers 由 payload 现场安装最新兼容版。工具 `node tools/verify-model.mjs --config .tmp/models/anima-light-lavender.json --write --timeout 45`，提示词与采样次数由工具固定（3 次采样，丢弃首张取中位）。

**最终配置**：`size=1024`、`steps=25`、`cfg=4`、`dtype=auto`（T4 → fp16），`status=ok`。

| 指标 | 实测值 |
| :--- | ---: |
| 显存峰值 `peakVramMb` | 8470 MB |
| 加载耗时 `loadSeconds` | 43.5 s |
| 首图耗时 | 87.63 s |
| 稳态中位 `steadySeconds` | 80.64 s（3 次，丢弃首张） |
| 单步采样 | 3.08 ~ 3.16 s/step（25 步 77 ~ 79 s） |
| VAE 解码 | 4.5 s（首张，含 VAE 上卡）/ 1.2 s（后续） |
| 下载体积 `downloadGb` | 5.25 GiB（DiT 3.90 + 文本编码器 1.11 + VAE 0.24 + 分词器 0.007） |

样张：`.tmp/verify/anima-light-lavender.png`（1024×1024，1.74 MB，内容为工具固定提示词的「雾中荷塘 + 红冠鹤 + 水墨风」）；完整报告：`.tmp/verify/anima-light-lavender.report.json`（`.tmp/` 已在 gitignore，仅本地留存）。

**三轮迭代记录**（这三轮分别对应一次真机故障，保留下来供后续排查参照）：

1. **第一轮：bf16 假阳性 → 慢 + 解码 OOM**。`torch.cuda.is_bf16_supported()` 在 CUDA 13 的 T4 上返回 True，`auto` 因此选 bf16，但 sm_75 只能模拟 bf16：8.7 s/次前向、25 步 435 s；随后 VAE 解码首层 conv3d 申请 5.06 GiB 时 `cuda_oom`（当时空闲 4.99 GiB，已分配 8.65 GiB，其中文本编码器 fp32 占 2.38 GiB）。
2. **第二轮：fp16 数值崩溃 → 自动降级 bf16**。改为按 compute capability 判定 dtype（T4 → fp16），文本编码器编码后移 CPU 并缓存 embedding，解码前 `empty_cache`，decode OOM 退 CPU float32。fp16 采样只需 2.11 s/step（25 步 53 s），但 latent 出现 NaN/Inf（VAE 用 fp32 重解仍是 NaN），运行时按兜底链切 bf16 重跑：单张 506 s、显存峰值 12883 MB，`status=ok` 但速度不可用。
3. **第三轮：定位并修复溢出点（最终）**。把同一份 4.18 GB BF16 权重下载到本地做离线分析：权重本身无溢出（685 个 tensor absmax 最大 123），但用真权重链式跑 fp16 前向时**残差流 absmax 从 block0 的约 50 涨到 block27 的 5.1e4 ~ 5.6e4**，逼近 fp16 上限 65504；挂 hook 确认 self-attn / cross-attn / MLP 子层输出全部 < 1e4 且有限。结论是**溢出发生在残差累加**。修复为「权重保持 fp16、残差流与归一化全程 fp32、子层输出升 fp32 后累加」，并加逐 step 的 velocity / latent 有限性检查。真机 fp16 稳定通过，峰值显存 8470 MB、稳态 80.64 s。

**分辨率与批次的推算**（仅 1024 有实测，其余按 token 数等比推算）：

- 768×768：token 数约为 1024 的 32%（1296 vs 4096），采样约 45 s/张；
- 1152×1152：token 数约为 1024 的 127%，采样约 100 s/张，显存约 10 GiB 量级；
- 工作台单次请求最多 4 张；远端从 v0.5.0 起是异步 job 协议，单个任务的整体预算默认 `TIMEOUTS.remoteJobMs = 600 s`（可用配置 `generateTimeoutSeconds` 覆盖）。按 80 s/张算，1024 分辨率下 4 张约 320 s，仍在预算内。

---

## 6. 已知限制

- **许可证非商用**：CircleStone Labs Non-Commercial License，并在 NVIDIA Open Model License 之下；`licenseKind` 记为 `restricted`，不要用于商业场景。
- **慢档模型**：1 MP / 25 步在单张 T4 上约需一分钟以上，明显慢于 SDXL Lightning（约 6 s）与 FLUX.2 klein（约 10 s）；参数预设里 `tier` 记为 `usable`，适合作为二次元插画专项而非默认模型。
- **提示词格式特殊**：模型按结构化 Danbooru caption 训练，直接堆砌 tag 效果弱；本实现把自由文本统一放进 `image_description`，没有暴露 `artist` / `character` 等字段的 UI。
- **T4 上只能走 fp16**：bf16 在 sm_75 上被模拟执行，数值虽然更稳但速度不可接受；fp16 的数值兜底链见第 4 节。
- **显存主要由 VAE 解码主导**：1024×1024 的 Qwen-Image VAE 解码需要约 5 GiB 峰值，单卡 14.56 GiB 下必须先把文本编码器移出显存。1152×1152 及以上仍需实测确认余量。
- **`_mxfp8` 变体未验证**：仓库提供的 MXFP8 权重（更快推理）依赖 torchao MXFP8 支持，本轮未测。