# MiniMax H3-Image 技术调研与部署规格说明 (MINIMAX_H3_IMAGE_SPEC)

本文档针对 MiniMax 开源的 **MiniMax-H3-Image** 视觉大模型进行全方位技术调研，重点分析其官方与社区推出的 **INT4 / INT8 / GGUF 量化版本**、显存体积矩阵，以及在消费级显卡与 Kaggle 免费 GPU 实例上的部署可行性，为后续自动化 Agent / 工程师提供明确的操作指南。

---

## 1. 模型概览与基础信息

| 属性 | 说明 |
| :--- | :--- |
| **模型全称** | MiniMax-H3-Image |
| **出品厂商** | MiniMax (名之梦) |
| **官方原始仓库** | [`MiniMaxAI/MiniMax-H3-Image`](https://huggingface.co/MiniMaxAI/MiniMax-H3-Image) (BF16 全量) |
| **官方/社区 INT8 剪枝仓库** | [`Comfy-Org/MiniMax-H3-Image`](https://huggingface.co/Comfy-Org/MiniMax-H3-Image) (ConvRot INT8) |
| **社区 GGUF (INT4/INT5) 仓库** | [`Abiray/MiniMax-H3-Image-GGUF`](https://huggingface.co/Abiray/MiniMax-H3-Image-GGUF) (Q2_K ~ Q5_K_M) |
| **架构类型** | Diffusion Transformer (DiT) 多模态视觉大模型 |
| **参数规模** | **33.1 Billion (331 亿参数)** |
| **推荐采样** | 6 步蒸馏采样 (Distilled 6-step)，无需 CFG (`guidance_scale=1.0`) |
| **原生输出分辨率** | 支持高达 4K (4096×4096) 及 1600 万像素级任意宽高比直出 |
| **开源许可证** | MiniMax H3 Community License（年营收超 100 万美元需商用授权） |

---

## 2. 核心技术特征与优势

1. **原生 4K 超高清与任意画幅**：
   - 摒弃了传统的“512/1024 底座 + 超分放大器 (Upscaler)”的分步管线，直接在 DiT 主干中原生建模高达 4K（4096×4096）的多尺度特征；
   - 原生支持 1:1、16:9、21:9、9:16 等多画幅比例，无拉伸与构图断裂。
2. **多图联合参考编辑（Multi-Reference）**：
   - 支持在同一次推理中挂载**最多 16 张参考图**（人脸特征、服饰质感、色彩基调、空间构图等）；
   - 将文生图 (Text-to-Image) 与图像局部/风格编辑 (Image Editing) 统一在同一个计算图与模型权重内。
3. **6 步极速蒸馏无需 CFG**：
   - 通过高效的轨迹蒸馏技术，将生成步数压缩至 **6 步**；
   - 彻底免去无分类器引导（CFG）带来的双倍前向计算开销，大幅降低单图时间复杂度。
4. **高质量中英文字符渲染**：
   - 得益于 MiniMax 在语言模型上的底座积累，对中英文文字的直接渲染与空间对齐能力明显优于早期的 SD/SDXL 架构。

---

## 3. INT4 / INT8 / GGUF 量化版本深度调研

原始 BF16 权重体积超过 135 GB，无法在消费级硬件或轻量云实例运行。社区与生态官方（Comfy-Org、Abiray 等）已推出成套的 INT4、INT8 与 GGUF 量化方案。

### 3.1 GGUF 规格矩阵（来自 `Abiray/MiniMax-H3-Image-GGUF`）

该系列由 Comfy-Org 剪枝后的检查点转换而来，**核心亮点是保留了敏感层为 FP32**（如 24 通道输入 patchifier、6 步 PDD 输出头 `final_layer`、低秩 AdaLN 调制基底），从而基本消除了低比特量化容易带来的网格条纹伪影（Grid Artifacts）。

| 规格文件 | 文件体积 | 运行显存建议 | 画质评价与适用场景 |
| :--- | :---: | :---: | :--- |
| **`MiniMax-H3-Image-Pruned-Q2_K.gguf`** | **~6.88 GB** | 8 GB ~ 10 GB | 极端显存受限场景，高频细节有轻微损失 |
| **`MiniMax-H3-Image-Pruned-Q3_K_M.gguf`** | **~8.91 GB** | 10 GB ~ 12 GB | 12G 显卡（如 RTX 3060/4070）极速推演 |
| **`MiniMax-H3-Image-Pruned-Q4_K_M.gguf`** | **~11.60 GB** | **12 GB ~ 16 GB** | **黄金平衡点**：画质几乎无损，16G 显卡主力规格 |
| **`MiniMax-H3-Image-Pruned-Q5_K_M.gguf`** | **~14.10 GB** | 16 GB ~ 24 GB | 视觉效果与原版 BF16 难以用肉眼区分 |

### 3.2 官方/生态 INT8 ConvRot 规格（来自 `Comfy-Org/MiniMax-H3-Image`）

- **DiT 主干模型**：`minimax_h3_image_pruned_int8_convrot.safetensors`（**~21 GB**）。
  - 使用 ConvRot 旋转量化技术，直接适配原生 Safetensors 加载器，适合 24GB 显存设备（RTX 3090/4090）满速运行。
- **配套 Text Encoder 方案**：
  - 生成管线的主文本编码器是 MiniMax-H3 的 **Qwen3-VL-32B**（DiT 读其第 50 层 hidden states），没有 9B 级替代。标准方案 `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`（**约 25.3 GiB**，T4 可用）；`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`（约 14.6 GiB）需要 Blackwell（sm_100+）的 FP4 张量核心，T4（Turing sm_75）不可用。
  - `qwen3.5_9b_w4a8_gptq.safetensors`（约 6.8 GiB）**不是主文本编码器**：Comfy-Org 的 README 与官方 GGUF 工作流都表明它是 **Prompt Enhancer（提示词扩写器）**，接 `TextGenerateV2` 节点使用，不能替代 32B 文本编码器。原稿把它写成「轻量文本端」是误判，实测纠正见第 7 节。

---

## 4. 第一性原理再审视：硬件边界与 Kaggle 容器可行性

有了 **Q4_K_M (11.6GB)** 与 **Q3_K_M (8.9GB)** 之后，硬件可行性发生了根本性改变：

| 运行环境 | BF16 全量 (135GB) | INT8 ConvRot (21GB) | GGUF Q4_K_M (11.6GB) |
| :--- | :---: | :---: | :---: |
| **A100 (80G) / H100** | ✅ 完美原生运行 | ✅ 极速批处理 | ✅ 极低显存开销 |
| **消费级 RTX 4090 (24G)** | ❌ 无法加载 | ✅ 舒适跑通（主干 21G） | ✅ 极速（留足 VRAM 给 Text Encoder） |
| **16G 显卡 (T4 / P100 / 4070)** | ❌ 显存/磁盘双爆 | ❌ 显存超出 (21G > 16G) | **✅ 理论可行**（11.6G 主干 + CPU Offload 文本端） |
| **Kaggle 免费容器 (双 T4 30G / 20G 盘)** | ❌ 磁盘 100% 爆满 | ⚠️ 磁盘下载临界 (21G) | ❌ 磁盘不满足：最小可用文件集 24.7 GB > `/kaggle/working` 实测 19.5 GiB（见第 7 节） |

> [!IMPORTANT]
> **2026-11-11 真机实测修正**：上表「GGUF Q4_K_M 可在 Kaggle 跑通」的结论**不成立**。它只算了 DiT 主干 11.6 GB，漏掉了必需的 24 通道图像 VAE（1.17 GB）与 32B 主文本编码器（T4 可用最小构建 12.0 GB）；三者合计 24.74 GB，超出 Kaggle `/kaggle/working` 的 19.52 GiB 上限。体积数字以 HF API `size` 字段为准，不采信 README 宣称值——README 写的「9B 文本端 7.3 GB」是 Prompt Enhancer，不是文本编码器。完整实测见第 7 节。

---

## 5. 针对大模型 / 工程师的实战部署操作指南

后续大模型在尝试部署或编写脚本时，请按以下两种方案执行：

### 方案 A：基于 ComfyUI + ComfyUI-GGUF 部署（最稳妥、生态最成熟）

1. **环境与扩展安装**：
   ```bash
   git clone https://github.com/city96/ComfyUI-GGUF custom_nodes/ComfyUI-GGUF
   pip install --upgrade gguf
   ```
2. **下载关键权重**：
   - DiT 主干（放入 `models/unet` 或 `models/diffusion_models`）：
     下载 `Abiray/MiniMax-H3-Image-GGUF` 下的 `MiniMax-H3-Image-Pruned-Q4_K_M.gguf` (11.6GB)；
   - 文本编码器（放入 `models/clip` 或 `models/text_encoders`）：
     下载 `Comfy-Org/MiniMax-H3-Image` 下的轻量化 `qwen3.5_9b_w4a8_gptq.safetensors` (7.3GB)；
   - VAE（放入 `models/vae`）：下载配套的 MiniMax H3 VAE (safetensors)。
3. **修复补丁（如遇维度报错）**：
   - 确保包含 `minimax_h3_image_gguf_fix.py`，避免 GGUF 张量形状映射冲突。
4. **工作流设置**：
   - 采样步数：`steps = 6`；
   - CFG 引导比率：`cfg = 1.0`；
   - 调度器：`euler` 或 `flow_match`。

---

### 方案 B：纯 Python / Diffusers 脚本部署（在 Kaggle / 独立容器内验证）

```python
import os
import torch
from huggingface_hub import hf_hub_download

# 1. 明确拉取 11.6GB 的 Q4_K_M 权重，避免拉取整仓
repo_id = "Abiray/MiniMax-H3-Image-GGUF"
filename = "MiniMax-H3-Image-Pruned-Q4_K_M.gguf"

print("正在下载 GGUF 权重 (11.6GB)...")
model_path = hf_hub_download(repo_id=repo_id, filename=filename)

# 2. 检查显存分布（双 T4 时可利用 accelerate 均衡切分）
print(f"权重下载就绪：{model_path}，文件大小: {os.path.getsize(model_path) / 1024**3:.2f} GiB")

# 3. 后续通过 GGUF 逆向加载器或 llama.cpp / diffusers 自定义 loader 注入
```

---

## 6. 标准候选模型卡配置草案 (`.tmp/models/minimax-h3-gguf.json`)

```json
{
  "id": "minimax-h3-gguf",
  "order": 50,
  "label": "MiniMax 4K (Q4量化)",
  "repo": "Abiray/MiniMax-H3-Image-GGUF",
  "params": "33.1B (Q4_K_M)",
  "license": "MiniMax Community License",
  "licenseKind": "restricted",
  "gated": false,
  "gpus": 2,
  "tier": "quality",
  "size": 2048,
  "steps": 6,
  "cfg": 1.0,
  "negativeHint": "",
  "sizeOptions": [1024, 2048, 4096],
  "runtime": "gguf",
  "pipeline": {
    "loader": "minimax-gguf",
    "base": "Abiray/MiniMax-H3-Image-GGUF",
    "weight": "MiniMax-H3-Image-Pruned-Q4_K_M.gguf",
    "downloadGb": 11.6,
    "allowPatterns": [
      "MiniMax-H3-Image-Pruned-Q4_K_M.gguf"
    ],
    "deviceMap": "balanced"
  },
  "measured": null
}
```

---

## 7. Kaggle 真机实测（2026-11-11）

> 本节是对第 2–4 节推论的实测校验。机型：Kaggle Notebooks，accelerator `NvidiaTeslaT4`（2× Tesla T4）。原始证据（探测内核日志、HF API 快照、出图尝试记录）在实验工作目录 `.tmp/minimax/`，属于未入库的临时产物。

### 7.1 结论

1. 按本文档第 6 节草案的「Q4_K_M 主干 + 约 7.3 GB 轻量文本端」路线在 Kaggle 免费实例上**不可行**：7.3 GB 的 `qwen3.5_9b_w4a8_gptq` 是 Prompt Enhancer，不是主文本编码器；换成真正可用的最小文本编码器后，最小文件集合计 **24.74 GB**，超出 `/kaggle/working` 实测 **19.52 GiB** 上限 **3.53 GiB**。
2. 官方 diffusers / SGLang / vLLM 的 BF16 路线同样不可行：transformer 与文本编码器各约 62 GiB，官方 diffusers 文档给出的 4736×3552 出图峰值显存约 **65 GB**，而 2×T4 合计只有 29.1 GiB；同时 Kaggle 预装的 diffusers 0.42.0 不含 MiniMax-H3-Image 管线（只在 main 分支）。
3. 有条件可行的组合是「ComfyUI 0.45.0 + ComfyUI-GGUF + Q4_K_M 主干 + Q3_K_M 文本编码器 + 24 通道图像 VAE」，但需要接受三个代价：
   - 权重必须放到 `/tmp`（与 `/` 同一个 8 TB overlay，实测可用 966.9 GiB）绕开 20 GiB 盘；**会话结束即丢，每次会话重下 24.7 GB**（实测下载 87–96 MiB/s，约 5 分钟）；
   - 主干 10.78 GiB 与文本编码器 11.18 GiB 无法在单张 T4 上共存，必须分阶段加载或 CPU offload；ComfyUI 单实例默认只绑 `cuda:0`；
   - 需要作者补丁 `minimax_h3_image_gguf_fix.py` 恢复 PDD 输出头与 24 通道 latent 配置，否则 `ComfyUI-GGUF` 会在反量化/形状恢复阶段报错。
4. **真机出图尝试的结果：软件栈全部对得上，但当前拿不到可用画面。** ComfyUI 0.45.0 原生支持该架构（`MiniMaxH3ImageConditioning` 节点存在、工作流 HTTP 200、GGUF 加载成功），默认 `--force-fp16` 与 `--lowvram` 都卡在 32B 文本编码器前向 OOM（峰值约 15.02 GiB > 单卡可用 14.56 GiB，只差 0.46 GiB，第二张 T4 未被使用）；降到纯 CPU 流式的 `--novram` 后能跑完 6 步、写出合法 1024×1024 PNG（单图 396 s，显存峰值 1.3 GiB），但**画面是纯白**——1 MP 远低于该模型 4–20 MP 的有效区间。详见 7.5。

### 7.2 实测环境与分区

| 项 | 实测值 | 说明 |
| :--- | :--- | :--- |
| `/kaggle/working` | `/dev/loop2`，19.518 GiB，起始可用 19.502 GiB | 物理上限，写满即 `ENOSPC`；不是可弹性调整的软配额 |
| `/kaggle/input` | 独立镜像挂载（1.0 P 命名空间） | 挂载 15 GB 数据集后 `/kaggle/working` 可用仍为 19.50 GiB，不占 20 GiB |
| `/tmp`、`/`、`/root` | overlay，`st_dev=55`，可用 966.9 GiB | 与 `/kaggle/working` 不同设备；实测写入 40 GiB 无报错（249 MiB/s），剩余 926.9 GiB |
| GPU | 2× Tesla T4，15360 MiB/卡（可用 14.56 GiB），compute capability (7,5) | Turing：无 BF16/FP8/FP4 硬件张量核心；fp16 matmul 实测 25.22 / 23.07 TFLOPS |
| 运行环境 | torch 2.11.0+cu130 / CUDA 13.0 / Python 3.13.16 | 预装 diffusers 0.42.0，`MiniMaxH3ImagePipeline` 不存在 |
| HF 下载速度 | VAE 95.67 MiB/s，Q4_K_M 主干 86.93 MiB/s | 直连 HF CDN，网络不是瓶颈 |

### 7.3 最小可运行文件集（HF API `size` 精确体积）

| 用途 | 文件 | 体积 |
| :--- | :--- | ---: |
| DiT 主干 | `Abiray/MiniMax-H3-Image-GGUF` · `MiniMax-H3-Image-Pruned-Q4_K_M.gguf` | 11.573 GB / 10.78 GiB |
| 图像 VAE（24 通道） | `Comfy-Org/MiniMax-H3-Image` · `vae/minimax_h3_image_vae_fp16.safetensors` | 1.169 GB / 1.09 GiB |
| 主文本编码器（T4 可用最小） | `Abiray/Qwen3-VL-32B-Instruct-GGUF` · `Qwen3vl_32b_h3-Q3_K_M.gguf` | 12.001 GB / 11.18 GiB |
| **合计** | | **24.743 GB / 23.04 GiB（缺口 3.53 GiB）** |

补充事实：

- `qwen3.5_9b_w4a8_gptq.safetensors`（6.84 GiB）是 **Prompt Enhancer**：Comfy-Org README 说明它用于 Generate Text 节点，官方 GGUF 工作流里它接 `TextGenerateV2`，图像条件走另一个 `CLIPLoaderGGUF` 加载 32B 文本编码器。
- NVFP4 文本编码器（14.61 GiB）需要 Blackwell（sm_100+）的 FP4 张量核心，T4 不兼容。
- 画质妥协到最低档（Q2_K 主干 6.40 GiB + Q3_K_M 文本编码器 11.18 GiB + VAE 1.09 GiB = 18.67 GiB）能塞进 19.52 GiB，但只剩 0.85 GiB 余量，ComfyUI 源码、日志与输出还需要空间，实际操作不可行，且 Q2_K 画质明显下降。
- README 宣称体积不可信：文本编码器 Q4_K_M 写 ~18.8 GB（实测 14.58 GB）、Q3_K_M 写 ~14.2 GB（实测 12.00 GB）；`Q4_K_S` 与 `Q4_K_M` 字节完全相同（11,573,106,144）。
- 「33.1B 参数」是未剪枝规模；Comfy-Org 的 `pruned_bf16` 为 40.23 GB，剪枝后约 **20.1B** 参数，与 Q4_K_M 的 11.57 GB 自洽。

### 7.4 路线对比（实测更新）

| 路线 | 权重体积 | 磁盘可行性 | 显存可行性 | 当前可得性 | 结论 |
| :--- | ---: | :--- | :--- | :--- | :--- |
| diffusers（官方 BF16） | 135 GB | 只能放 `/tmp` | 官方文档 4736×3552 峰值约 65 GB | Kaggle 预装 0.42.0 无该类，需 main 分支 | **不可行**（显存差 4.5 倍） |
| ComfyUI + ComfyUI-GGUF | 24.74 GB | `/kaggle/working` 不够，`/tmp` 可行 | 主干单卡可放，文本编码器需分阶段 | ComfyUI 0.45.0 原生支持 MiniMaxH3Image，需 ComfyUI-GGUF + 作者补丁 | **条件可行**（见 7.5） |
| Kaggle Dataset 挂载 | 24.74 GB | 不占 20 GiB | 同上 | 公开数据集/模型里没有 image DiT 与 24 通道 image VAE（只有视频模型、NVFP4 文本编码器与未核实的第三方「P」变体） | **当前不可用** |

### 7.5 出图尝试（ComfyUI + ComfyUI-GGUF，2026-11-11）

路线：ComfyUI 0.45.0 + ComfyUI-GGUF + 作者补丁 `minimax_h3_image_gguf_fix.py`，权重全部放 `/tmp`。

**跑通的部分（真机）**

| 步骤 | 结果 |
| :--- | :--- |
| 下载 DiT Q4_K_M（11.573 GB） | 74.5 s，148.16 MiB/s |
| 下载 Q3_K_M 文本编码器（12.001 GB） | 81.0 s，141.38 MiB/s |
| 下载图像 VAE（1.169 GB） | 7.3 s，152.57 MiB/s |
| 全套权重（24.74 GB） | 172.5 s，全部落在 `/tmp`，`/kaggle/working` 仅占 244 KiB |
| ComfyUI 克隆 + 依赖安装 | 3.1 s + 约 43 s，`deps-ok` / `import_check` 通过 |
| 作者补丁 | 3,572 B，仅 monkeypatch `model_base` / `ldm.minimax.model` / `ldm.minimax.sampling`，无网络请求、无 `exec` |
| ComfyUI 启动 | 40.3 s，识别到 cuda:0 / cuda:1 两张 T4 |
| 原生节点可用性 | `MiniMaxH3ImageConditioning`（required `clip/prompt/width/height`，返回 `positive`+`LATENT`）、`UnetLoaderGGUF`、`CLIPLoaderGGUF`、`KSampler` 均在 |
| 工作流提交 | HTTP 200，`node_errors:{}` |

**失败点一：默认显存模式在 32B 文本编码器 OOM（差 0.46 GiB）**

```
node_id: 5 (MiniMaxH3ImageConditioning)
  clip.encode_from_tokens_scheduled → get_input_embeddings()（Q3_K 反量化）
Currently allocated : 14.30 GiB
Requested           : 741.88 MiB
Device limit        : 14.56 GiB
Free (according to CUDA): 18.81 MiB
```

- 峰值需求约 15.02 GiB > 单卡可用 14.56 GiB；`--lowvram` 重试同样 OOM（ComfyUI 的 lowvram 只对扩散主干分块，文本编码器仍整块驻留显存）。
- 双卡实测只用上 GPU0（峰值 14,061 MiB；GPU1 仅 105 MiB），ComfyUI 单实例默认只绑 `cuda:0`。

**失败点二：降到 `--novram` 能出图，但画面是纯白**

| 阶梯 | 启动参数 | 结果 |
| :--- | :--- | :--- |
| 1 | `--force-fp16` | OOM，30.6 s 失败 |
| 2 | `--force-fp16 --lowvram` | 同样 OOM，16.3 s |
| 3 | `--force-fp16 --novram` | `execution_success`，396.0 s 出图 |

第 3 阶梯实测：1024×1024 / 6 步单图 **396.0 s**，显存峰值 GPU0 **1,313 MiB**（权重走主机内存流式），主机内存仍有约 17.1 GiB 可用，冷启动到出图合计 **851.7 s**，产物是合法 PNG（4,317 B，`89 50 4e 47 0d 0a 1a 0a`，1024×1024）但**内容纯白**。

对纯白图的判断（未进一步定位）：最可能是分辨率问题——官方与工作流都写明有效区间约 **4–20 MP、16 MP 最佳**，并提示低分辨率效果差；本实验的 1 MP 远低于下限。也不能排除 T4（sm_75，无 BF16 张量核心）上 fp16 + 4bit 反量化的数值问题。按 token 数线性外推，`--novram` 下 2048×2048 约 26 分钟/张、4096×4096 约 1.8 小时/张（推算值，非实测）。

**结论**：软件栈与权重格式全部对得上，当前卡在「单卡显存差 0.46 GiB」与「模型有效分辨率区间」两处，不能作为可用模型接入工作台。

### 7.6 真要上线所需的条件与改造点

**资源条件**

1. **权重盘**：≥26 GiB 的非 `/kaggle/working` 空间。可选 `/tmp`（实测 967 GiB 可用，但会话结束即丢），或自建一个 24.74 GB 的 Kaggle Dataset（`lib/kernel.js` 已支持 `dataset_sources` 预挂载，唯一可持久复用方式；公开资源里没有现成的 image DiT 与 24 通道 image VAE）。
2. **GPU**：单张 T4 放不下「主干 + 32B 文本编码器」，必须 CPU offload 或跨卡切分；默认模式要额外约 0.5 GiB 显存才够文本编码器。
3. **分辨率**：模型有效区间 4–20 MP，而当前契约 `LIMITS.width/height ≤ 1536`（最大 2.36 MP）低于下限，接入必须放宽到模型专属尺寸表。

**代码改造点（按仓库现状）**

| 位置 | 现状 | 需要的改动 |
| :--- | :--- | :--- |
| `remote/daemon.py` `SUPPORTED_LOADERS` / `load_pipeline()` | 只有 `sdxl` / `sdxl-lora` / `flux2` 三个 diffusers 分支 | 新增非 diffusers 的 ComfyUI 子进程后端（启动 / 健康检查 / 关闭）与 `minimax-h3-gguf` loader |
| `remote/daemon.py` 权重根目录 | 默认落 `/kaggle/working` | 改为可配置根目录并默认 `/tmp`，否则 24.74 GB 必然 `disk_full` |
| `tools/payload/verify-model.py` `load_pipe()` | 只有三个 diffusers 分支，未知 loader 直接 `ValueError` | 增加 GGUF/ComfyUI 分支；PNG 校验可复用 |
| `lib/kernel.js` | 已支持 `dataset_sources` | 直接复用：预挂载权重 Dataset 是唯一可持久方案 |
| `shared/contract.js` `LIMITS` / `TIMEOUTS` | 尺寸 ≤ 1536；单图生成超时 5 分钟 | 模型专属尺寸（≥4 MP）与更大的生成超时；该模型固定 6 步、`cfg=1.0`、不支持负向提示词 |
| 输入协议 | 提示词上限 2000 字符 | 官方要求密集英文长描述；若要接近宣传画质需串接 Prompt Enhancer（9B，6.84 GiB），再增加一份磁盘/显存预算 |
