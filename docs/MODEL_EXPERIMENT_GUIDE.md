# 新模型候选与实跑试验指南 (MODEL_EXPERIMENT_GUIDE)

本文档专为后续**大语言模型 (AI Agent) 与开发人员**编写，汇总了从 Hugging Face 精选的两类候选模型资产及实操试验步骤：
1. **即插即用组（Plug-and-Play）**：100% 兼容当前项目已有的 `sdxl` / `sdxl-lora` 加载器，零代码修改，可直接通过 `tools/verify-model.mjs` 推送到 Kaggle 自动化实跑验证。
2. **前沿突破组（MiniMax H3-Image）**：33.1B 参数次世代 DiT，采用 **Q4_K_M (11.6GB) / INT8** 量化切入，突破 Kaggle 磁盘与显存限制的专项试验方案。

> **执行状态（2026-11-11）**
> - 第一部分的 4 个即插即用候选已全部在 Kaggle（2×Tesla T4）真机跑通，`measured` 由 `tools/verify-model.mjs --write` 回填，资产已并入 `models/`。实测数据与相对本草案的修正见 [1.4 实跑结果与修正](#14-实跑结果与修正2026-11-11)。
> - 追加候选 `anima-light-lavender` 需要新 loader（单文件 ComfyUI checkpoint），已新增 `anima` loader 并在 Kaggle T4 验证通过（1024×1024/25 步稳态 80.64 s），见 [1.5](#15-需要新-loader-的候选anima-light-lavender) 与 [`ANIMA_LOADER_SPEC.md`](ANIMA_LOADER_SPEC.md)；`models/` 模型总数 8 → 9。
> - 第二部分的 MiniMax-H3-Image 已完成 Kaggle 真机可行性试验，结论是**当前 Kaggle 免费实例无法部署**（磁盘与文本编码器体积是硬约束），证据与后续条件见 [2.4 实测结论](#24-实测结论kaggle-免费实例不可行)。
> - 本文档保留原始草案用于对照；**最终可用配置以 `models/<id>.json` 为准**。

---

## 目录
- [第一部分：即插即用候选模型（零代码实跑）](#第一部分即插即用候选模型零代码实跑)
  - [1.1 候选清单与核心特性](#11-候选清单与核心特性)
  - [1.2 预制配置草案 JSON](#12-预制配置草案-json)
  - [1.3 大模型自动化验证流水线](#13-大模型自动化验证流水线)
  - [1.4 实跑结果与修正（2026-11-11）](#14-实跑结果与修正2026-11-11)
  - [1.5 需要新 loader 的候选：Anima-Light-Lavender](#15-需要新-loader-的候选anima-light-lavender)
- [第二部分：MiniMax H3-Image 专项试验](#第二部分minimax-h3-image-专项试验)
  - [2.1 核心资产与量化文件定位](#21-核心资产与量化文件定位)
  - [2.2 物理边界防爆原则](#22-物理边界防爆原则)
  - [2.3 部署试验代码范式](#23-部署试验代码范式)
  - [2.4 实测结论：Kaggle 免费实例不可行](#24-实测结论kaggle-免费实例不可行)
- [第三部分：试验验收与合并标准](#第三部分试验验收与合并标准)

---

## 第一部分：即插即用候选模型（零代码实跑）

### 1.1 候选清单与核心特性

以下模型均经过 Hugging Face 生态、权重体积与协议审查，完全符合 Kaggle 单卡 16GB / 双卡 30GB 限制：

| 模型 ID | Hugging Face 仓库 | 类别与亮点 | 预估下载量 | 适配 Loader | 推荐步数与 CFG |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **`playground-v2.5`** | `playgroundai/playground-v2.5-1024px-aesthetic` | **美学旗舰**：人像质感、自然风光与构图色彩大幅超越 SDXL 原版，开源无门槛 | ~6.6 GB | `sdxl` | `steps: 30`<br>`cfg: 3.0` |
| **`realvis-v5`** | `SG161222/RealVisXL_V5.0` | **超写实摄影**：HF 评分极高的人像写实微调，细节扎实，皮肤纹理真实 | ~6.6 GB | `sdxl` | `steps: 25`<br>`cfg: 5.0` |
| **`animagine-xl-3.1`** | `cagliostrolab/animagine-xl-3.1` | **二次元王者**：支持精确 Danbooru Tag，动漫与插画领域的绝对标杆（仓库无 fp16 变体，需 `variant: null`） | ~6.5 GB | `sdxl` | `steps: 28`<br>`cfg: 7.0` |
| **`hyper-sdxl-8step`** | `ByteDance/Hyper-SD` (LoRA) + SDXL Base | **极速蒸馏升级**：字节跳动 8 步/4 步蒸馏，质量完胜老旧的 SDXL-Turbo | ~7.4 GB | `sdxl-lora` | `steps: 8`<br>`cfg: 0` |

> 表中 `hyper-sdxl-8step` 的 CFG 已按官方说明修正为 `0`：`Hyper-SDXL-8steps-CFG-lora` 是为 guidance 5~8 训练的 CFG 版，与 `cfg: 1.0` 搭配属于错配；实测采用非 CFG 版 `Hyper-SDXL-8steps-lora.safetensors` + `guidance_scale=0`。详见 [1.4](#14-实跑结果与修正2026-11-11)。

---

### 1.2 预制配置草案 JSON

> ⚠️ 本节是资料收集阶段的原始草案。实测后对 `license`、`variant`、`allowPatterns`、Hyper-SD 的 LoRA 文件与 CFG 做了修正，`measured` 也必须由真机回填；**最终可用配置以 `models/<id>.json` 为准**，差异清单见 [1.4](#14-实跑结果与修正2026-11-11)。

后续 AI 可直接将以下内容写入对应路径：

#### 配置文件 1：`.tmp/models/playground-v2.5.json`
```json
{
  "id": "playground-v2.5",
  "order": 25,
  "label": "美学旗舰 1024",
  "repo": "playgroundai/playground-v2.5-1024px-aesthetic",
  "params": "3.5B",
  "license": "Playground v2.5 License",
  "licenseKind": "open",
  "gated": false,
  "gpus": 1,
  "tier": "usable",
  "size": 1024,
  "steps": 30,
  "cfg": 3.0,
  "negativeHint": "ugly, deformed, noisy, blurry, distorted",
  "sizeOptions": [768, 1024],
  "runtime": "default",
  "pipeline": {
    "loader": "sdxl",
    "base": "playgroundai/playground-v2.5-1024px-aesthetic",
    "lora": null,
    "scheduler": null,
    "variant": "fp16",
    "downloadGb": 6.6,
    "allowPatterns": [
      "model_index.json",
      "**/config.json",
      "**/*.json",
      "**/*.txt",
      "**/*.fp16.safetensors"
    ],
    "deviceMap": null
  },
  "measured": null
}
```

#### 配置文件 2：`.tmp/models/realvis-v5.json`
```json
{
  "id": "realvis-v5",
  "order": 35,
  "label": "超写实摄影",
  "repo": "SG161222/RealVisXL_V5.0",
  "params": "3.5B",
  "license": "CreativeML OpenRAIL-M",
  "licenseKind": "open",
  "gated": false,
  "gpus": 1,
  "tier": "usable",
  "size": 1024,
  "steps": 25,
  "cfg": 5.0,
  "negativeHint": "blurry, low quality, deformed, extra limbs, ugly, bad anatomy",
  "sizeOptions": [768, 1024],
  "runtime": "default",
  "pipeline": {
    "loader": "sdxl",
    "base": "SG161222/RealVisXL_V5.0",
    "lora": null,
    "scheduler": null,
    "variant": null,
    "downloadGb": 6.6,
    "allowPatterns": [
      "model_index.json",
      "**/config.json",
      "**/*.json",
      "**/*.safetensors"
    ],
    "deviceMap": null
  },
  "measured": null
}
```

#### 配置文件 3：`.tmp/models/hyper-sdxl-8step.json`
```json
{
  "id": "hyper-sdxl-8step",
  "order": 15,
  "label": "Hyper-SD 8步快档",
  "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/Hyper-SD",
  "params": "3.5B + LoRA",
  "license": "Apache-2.0",
  "licenseKind": "open",
  "gated": false,
  "gpus": 1,
  "tier": "fast",
  "size": 1024,
  "steps": 8,
  "cfg": 1.0,
  "negativeHint": "blurry, low quality, deformed",
  "sizeOptions": [768, 1024],
  "runtime": "default",
  "pipeline": {
    "loader": "sdxl-lora",
    "base": "stabilityai/stable-diffusion-xl-base-1.0",
    "lora": {
      "repo": "ByteDance/Hyper-SD",
      "weight": "Hyper-SDXL-8steps-CFG-lora.safetensors"
    },
    "scheduler": { "type": "euler", "timestepSpacing": "trailing" },
    "variant": "fp16",
    "downloadGb": 6.78,
    "allowPatterns": [
      "model_index.json",
      "**/config.json",
      "**/*.json",
      "**/*.txt",
      "**/*.fp16.safetensors"
    ],
    "deviceMap": null
  },
  "measured": null
}
```

---

### 1.3 大模型自动化验证流水线

后续大模型执行验证时，请严格遵照以下步骤（以 `playground-v2.5` 为例）：

```powershell
# 1. 确保 .tmp/models/ 目录存在并写入上述 JSON
New-Item -ItemType Directory -Force -Path .tmp/models

# 2. 离线 Dry-Run 校验（验证语法、字段与打包正确性）
node tools/verify-model.mjs --config .tmp/models/playground-v2.5.json --dry-run

# 3. 推送 Kaggle 实跑采样并回填 measured 实测数据（需联网与 Kaggle 配额）
node tools/verify-model.mjs --config .tmp/models/playground-v2.5.json --write --timeout 30

# 4. 验证成功后转正
Move-Item .tmp/models/playground-v2.5.json models/playground-v2.5.json
npm run models:build
npm run models:check
npm test
```

---

### 1.4 实跑结果与修正（2026-11-11）

**环境**：Kaggle 账号 `mogudd`，加速器 `NvidiaTeslaT4`（= 2×Tesla T4，本轮模型只用 1 张）；远端 Python 3.13.16 / torch 2.11.0+cu130 / CUDA 13.0。工具 `tools/verify-model.mjs --config <草稿> --write --timeout 30`，提示词与采样次数由工具固定（1024×1024，3 次采样，丢弃首张取中位）。

**实测结果**（4 个模型全部 `status=ok`，样张均为 1024×1024 合法 PNG，内容与提示词场景相关）：

| 模型 ID | loader | 显存峰值 MB | 加载耗时 s | 首图 s | 稳态中位 s | 下载体积 GiB | 推送→完成 |
| :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `playground-v2.5` | `sdxl` | 9967 | 5.7 | 31.63 | 28.34 | 6.46 | 251 s |
| `realvis-v5` | `sdxl` | 9967 | 5.2 | 27.19 | 24.53 | 6.46 | 213 s |
| `animagine-xl-3.1` | `sdxl` | 9176 | 4.8 | 26.57 | 26.17 | 6.46 | 约 5 min |
| `hyper-sdxl-8step` | `sdxl-lora` | 10347 | 14.3 | 13.5 | 7.74 | 7.35 | 约 4 min |

样张：`.tmp/verify/<id>.png`；完整报告：`.tmp/verify/<id>.report.json`（`.tmp/` 已被 gitignore，仅本地留存）。四个模型的显存峰值都在 10.4 GB 以内，单张 T4 即可承载。

**相对 1.2 草案的修正**（最终配置见 `models/<id>.json`，以它为准）：

1. `hyper-sdxl-8step`：LoRA 从 `Hyper-SDXL-8steps-CFG-lora.safetensors` 改为非 CFG 版 `Hyper-SDXL-8steps-lora.safetensors`，`cfg` 由 `1.0` 改为 `0`。官方说明 CFG 版 LoRA 配套 guidance 5~8，非 CFG 版配套 `guidance_scale=0`，草案的「CFG 版 + cfg 1.0」是错配。
2. `realvis-v5`：`variant` 由 `null` 改为 `fp16`，并把 `allowPatterns` 收窄到实际用到的 fp16 组件。原草案 `**/*.safetensors` 会额外拉取仓库内的 fp32 副本与顶层单文件 checkpoint，下载量约翻倍；实测 fp16 组件为 6.46 GiB。
3. `playground-v2.5`：同样收窄 `allowPatterns`，排除顶层 `playground-v2.5-1024px-aesthetic.fp16.safetensors` 单文件 checkpoint；license 按仓库实际改为「Playground v2.5 Community License」。
4. `animagine-xl-3.1`：仓库没有 fp16 变体，保持 `variant: null`，直接取非变体 safetensors（其权重本身是 fp16）。
5. 许可证修正：`realvis-v5` 与 `animagine-xl-3.1` 均为 **OpenRAIL++**（草案写的 CreativeML OpenRAIL-M 不准确）；`hyper-sdxl-8step` 的 SDXL LoRA 为 **OpenRAIL++-M**（草案写的 Apache-2.0 不准确，仓库 `LICENSE.md` 明确 SD 系列走 OpenRAIL++-M）。
6. `downloadGb` 预估按实测回填：SDXL fp16 组件 6.46 GiB；`hyper-sdxl-8step` 含 LoRA 共 7.35 GiB。

**入库与回归**：

- 4 个 JSON 移入 `models/`，`npm run models:build` 重新生成 `shared/models.generated.js`（模型总数 4 → 8）；
- `npm run models:check` 通过；`npm test` 全绿（契约 11/11 项，含「生成文件与 models/ 同步：8 个」）；
- 新预设会在 DSH 重启 / 插件重载后出现在工作台模型下拉里。

### 1.5 需要新 loader 的候选：Anima-Light-Lavender

2026-11-11 追加：用户给出的 [`Johnny-Z/Anima-Light-Lavender`](https://huggingface.co/Johnny-Z/Anima-Light-Lavender) 不属于「即插即用」组——它是 **ComfyUI 单文件 checkpoint**（`anima-light-lavender.safetensors`，BF16），没有 diffusers 的 `model_index.json`，架构是 Cosmos-Predict2 2B DiT + Qwen3-0.6B 文本编码器 + Qwen-Image VAE + Qwen2/T5 双分词器。仓库因此新增 loader `anima`，两份运行时（验证 payload 与常驻 daemon）各自自带模型定义与采样循环，不启用 `trust_remote_code`。

**实测结论（Kaggle 单卡 T4，1024×1024 / 25 步 / CFG 4.0）**：`status=ok`，显存峰值 8470 MB、加载 43.5 s、首图 87.63 s、稳态中位 80.64 s、下载 5.25 GiB，样张与提示词场景一致。它是目前最慢的预设（SDXL Lightning 约 6 s），属于「画质与提示词理解优先」的专项模型，`tier` 记为 `usable`。

**关于量化的结论（后续想提速时的参考）**：

- 仓库自带的 `_mxfp8` 变体是 **FP8**，需要 sm_89+ 的 FP8 tensor core，T4（sm_75）不可用；
- 该 checkpoint **没有** INT4/INT8 量化版本；HF 上只有 Anima 家族其它 checkpoint（base / preview / turbo / aesthetic）的 GGUF、FP8、INT8 量化；
- 自己上 weight-only INT4/INT8（bitsandbytes / torchao）在 T4 上仍是「反量化后走 fp16 tensor core」，**省显存不省时间**，也不解决 fp16 溢出的问题；
- GGUF（Q4_K 等）需要 ComfyUI / stable-diffusion.cpp 运行时，属于换后端而不是加 loader；
- 想要更快，正确方向是 **Turbo 蒸馏变体**（`anima-turbo-v1.1`，8 步），可复用同一 loader，单张预计降到十几秒量级（尚未接入验证）。

完整架构映射、loader 字段契约与三轮真机故障（bf16 假阳性 / fp16 残差溢出 / 修复）记录见 [`ANIMA_LOADER_SPEC.md`](ANIMA_LOADER_SPEC.md)。

---

## 第二部分：MiniMax H3-Image 专项试验

### 2.1 核心资产与量化文件定位

MiniMax-H3-Image 为 **33.1B 参数**的前沿 DiT 架构，原生 4K 输出，6 步蒸馏采样。由于原始 BF16 权重达 **135 GB**，**必须使用量化版本进行试验**。

- **推荐主干量化仓库**：[`Abiray/MiniMax-H3-Image-GGUF`](https://huggingface.co/Abiray/MiniMax-H3-Image-GGUF)
  - 核心文件：`MiniMax-H3-Image-Pruned-Q4_K_M.gguf`（**HF API 精确 11.573 GB / 10.78 GiB**）
  - 特性：保留输入 Patchifier 与最终采样头为 FP32，无网格伪影；为 ComfyUI-GGUF（`UnetLoaderGGUF`）准备，需配套 `minimax_h3_image_gguf_fix.py` 补丁。
- **配套文本编码器**：
  - 生成管线的主文本编码器是 MiniMax-H3 的 **Qwen3-VL-32B**（DiT 读其第 50 层 hidden states），没有 9B 级替代：官方 BF16 66.7 GB；Comfy-Org 的 `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` 25.28 GiB、`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` 14.61 GiB（NVFP4 需要 Blackwell，T4 不可用）；GGUF 侧 `qwen3vl_32b_minimax_h3-Q4_K_M.gguf` 13.58 GiB、`Qwen3vl_32b_h3-Q3_K_M.gguf` 11.18 GiB。
  - `qwen3.5_9b_w4a8_gptq.safetensors`（6.84 GiB）**不是**主文本编码器：Comfy-Org README 明确它是 Prompt Enhancer（Generate Text 节点）用的，不能替代 32B 文本编码器。原草案把它当成「轻量文本端」，这是一个关键误判。

---

### 2.2 物理边界防爆原则

> [!CAUTION]
> **严禁操作**：绝对不得在 Kaggle 实例中执行整仓 `snapshot_download("MiniMaxAI/MiniMax-H3-Image")`，该操作会尝试拉取 135GB 权重，100% 触发 `disk_full` 导致容器崩溃封禁。

- **白名单单文件拉取**：必须使用 `huggingface_hub.hf_hub_download` 只拉取指定的 `MiniMax-H3-Image-Pruned-Q4_K_M.gguf` 单个文件。
- **显存保护机制**：
  - 11.6 GB 主干权重在加载到 GPU 后占用约 12 GB 显存；
  - 文本编码器与 VAE 建议开启 CPU Offload（按需加载执行后释放回系统内存），确保在单卡 16GB (P100) 或双卡 30GB (2×T4) 上不会 `cuda_oom`。

---

### 2.3 部署试验代码范式

后续大模型在编写测试/部署脚本时，可参考以下 Python 结构：

```python
import os
import torch
from huggingface_hub import hf_hub_download

def test_minimax_h3_quant_download():
    """验证量化文件能否成功落盘且不超限。"""
    repo_id = "Abiray/MiniMax-H3-Image-GGUF"
    target_filename = "MiniMax-H3-Image-Pruned-Q4_K_M.gguf"
    
    print(f"[MiniMax-H3] 正在精确下载单文件量化主干: {target_filename}...")
    local_path = hf_hub_download(
        repo_id=repo_id,
        filename=target_filename,
        local_dir="./weights/minimax_h3"
    )
    
    size_gb = os.path.getsize(local_path) / (1024 ** 3)
    print(f"[MiniMax-H3] 下载成功！实际体积: {size_gb:.2f} GiB (安全在 20GB 限制内)")
    assert size_gb < 15.0, "文件体积超过安全阈值！"

if __name__ == "__main__":
    test_minimax_h3_quant_download()
```

---

### 2.4 实测结论：Kaggle 免费实例不可行

面向后续 Agent 的一句话结论：**MiniMax-H3-Image 不属于「即插即用候选」，不要按 2.1 的清单直接推送验证。** 实测环境为 Kaggle `NvidiaTeslaT4`（2×T4，单卡可用 14.56 GiB），`/kaggle/working` 实测 19.518 GiB（`/dev/loop2` 物理上限）。完整证据与改造清单见 [`docs/MINIMAX_H3_IMAGE_SPEC.md`](MINIMAX_H3_IMAGE_SPEC.md) 第 7 节。

1. **2.1 的量化路线不成立**：`qwen3.5_9b_w4a8_gptq`（6.84 GiB）是 **Prompt Enhancer**，不能替代 32B 主文本编码器（Comfy-Org README 与官方 GGUF 工作流均可证）。主文本编码器在 T4 上可用的最小构建是 `Qwen3vl_32b_h3-Q3_K_M.gguf` = 12.001 GB。最小可用文件集 = 11.573 GB（DiT Q4_K_M）+ 1.169 GB（24 通道 VAE）+ 12.001 GB（文本编码器）= **24.74 GB / 23.04 GiB**，超出 `/kaggle/working` **3.53 GiB**；写满测试实测再写 7.5 GiB 即 `ENOSPC`。
2. **官方 diffusers 路线也不成立**：BF16 需要 135 GB 磁盘，官方文档给出 4736×3552 出图峰值约 **65 GB** 显存，2×T4 合计只有 29.1 GiB；Kaggle 预装 diffusers 0.42.0 不含 `MiniMaxH3ImagePipeline`（只在 main 分支）。
3. **`/tmp` 可以绕开 20 GiB 盘，但代价大**：`/tmp` 与 `/` 同属 8 TB overlay，实测可用 966.9 GiB，写 40 GiB 无报错，24.74 GB 权重放 `/tmp` 后 `/kaggle/working` 仅占 244 KiB；代价是会话结束即丢，每次会话重下 24.7 GB（实测 90–152 MiB/s，约 3–5 分钟）。
4. **ComfyUI 路线能跑通软件栈，但拿不到可用画面**：ComfyUI 0.45.0 + ComfyUI-GGUF + 作者补丁，节点齐全、工作流 HTTP 200、权重加载成功；默认模式在 32B 文本编码器处 OOM（峰值约 15.02 GiB > 单卡 14.56 GiB，只差 0.46 GiB，第二张 T4 未被使用，`--lowvram` 无效）；降到纯 CPU 流式 `--novram` 能跑完 6 步并写出合法 PNG（1024×1024 单图 396 s，显存峰值 1.3 GiB），但 **1 MP 低于模型 4–20 MP 有效区间，产物为纯白**。
5. **接入工作台的前置改造**：新增 ComfyUI 子进程后端与 `minimax-h3-gguf` loader、权重根目录移出 `/kaggle/working`、尺寸上限放宽到 ≥4 MP、放大生成超时；或先自建 24.74 GB 的 Kaggle Dataset 预挂载（公开资源里没有现成的 image DiT 与 24 通道 image VAE）。当前**不把该模型加入 `models/`**，保留为研究结论。

---

## 第三部分：试验验收与合并标准

后续大模型在完成试验后，需满足以下物理客观断言方可将模型合并至 `models/` 正式目录：

1. **出图有效性**：产物必须是标准的合法 PNG 图片（文件头前 8 字节为 `\x89PNG\r\n\x1a\n`），且分辨率符合预设。
2. **指标客观记录**：`measured` 对象中的 `peakVramMb`、`loadSeconds`、`steadySeconds` 与 `downloadGb` 必须由真机测试自动回填，不得手写上游宣称值。
3. **回归通过**：运行 `npm run models:check` 和 `npm test`，所有离线断言必须全部通过。

本轮执行情况：第一部分的 4 个候选全部满足以上 3 条并已合并（数据见 1.4）；第二部分的 MiniMax-H3-Image 因不满足第 1 条（出图无效）不合并，结论见 2.4。
