---
name: our-free-imagen
description: Multi-preset free GPU image generation tool backed by pluggable providers (currently Kaggle T4 GPU). Supports both one-shot Batch mode and persistent Session mode (~1.5s/img interactive generation), with presets for SDXL-Turbo, DreamShaper XL, Playground v2.5, and SDXL Base. Use when the user asks for free image generation, Kaggle GPU text-to-image, or interactive prompt iteration without local GPU.
---

# Our Free Imagen (`our-free-imagen`)

通过免费 GPU 算力后端（当前默认 Provider 为 **Kaggle T4 GPU**，每周 30 小时免费额度）运行开源文生图模型，将生成的 PNG 与 `meta.json` 下载到本地。

## 两种运行模式（向用户说明并按场景选择）

在开始生图前，可根据用户的任务形态向其简要介绍以下两种模式并选择最合适的一种（若当前已有在线的长占会话，脚本会自动优先复用秒级出图）：

| 模式 | 适用场景 | 耗时与计费特点 |
| :--- | :--- | :--- |
| **1. 一次性批量模式 (`--mode batch`，默认)** | 只需生成一轮图片，生完即止 | 冷启动加载模型约 **2~4 分钟**；任务完成后容器**立即自动结束并停止扣配额**，最省心。 |
| **2. 长占会话模式 (`--mode session`)** | 需要连续多轮微调 Prompt、反复看图修改 | 首次启动约 **2~3 分钟**，之后保持 GPU 热在线，**后续每次生图仅需 1.5~3 秒**（且支持中途动态切换不同模型）。会话期间持续计费，内置 **15 分钟无操作自动关机**，也可随时用 `--session stop` **秒级主动关机停费**。 |

---

## 快速命令参考（PowerShell / 跨平台兼容）

入口脚本为 `<skill-dir>/scripts/imagen.py`。

### 1. 状态检查与预设列表

```powershell
# 查看内置模型预设（分辨率、步数、CFG、许可证）
python "<skill-dir>/scripts/imagen.py" --list-presets

# 检查 Kaggle 登录态、剩余 GPU 配额以及当前是否有在线的长占会话
python "<skill-dir>/scripts/imagen.py" --check
```

### 2. 模式一：一次性批量生成（默认 `--mode batch`）

```powershell
# 默认使用 sdxl-turbo（512x512, 4步），跑完即停
python "<skill-dir>/scripts/imagen.py" --prompt "A red-crowned crane in a misty lotus pond at dawn, Chinese ink painting" --seeds "42,2026" --out "./imagen-output"

# 使用 1024px 高清预设 dreamshaper-xl-turbo 并附带负向提示词
python "<skill-dir>/scripts/imagen.py" --preset dreamshaper-xl-turbo --prompt "Cyberpunk alleyway in heavy rain, neon reflections" --negative-prompt "blurry, low quality, deformed" --out "./imagen-output"
```

### 3. 模式二：长占会话连续生图（`--mode session`）

```powershell
# 首次运行拉起常驻 GPU 并出图（若会话已在线，则直接走隧道 2 秒出图）
python "<skill-dir>/scripts/imagen.py" --mode session --preset sdxl-turbo --prompt "A corgi astronaut floating in space, cinematic lighting" --out "./imagen-output"

# 后续任意继续生图（自动复用在线会话，秒级返回；甚至可以直接换用其他预设模型）
python "<skill-dir>/scripts/imagen.py" --mode session --preset playground-v2.5 --prompt "A corgi astronaut on Mars, oil painting style" --out "./imagen-output"

# 用完后主动关闭远端会话，立即停止 GPU 计费（若忘记关闭，默认闲置 15 分钟后也会自动退出）
python "<skill-dir>/scripts/imagen.py" --session stop
```

### 4. 使用 JSON 任务文件（适合复杂 Prompt 或多图不同参数）

当 Prompt 含有复杂引号或需要一次指定多组不同尺寸/参数时，写入本地 `job.json` 并通过 `--job-file` 调用：

```json
{
  "negative_prompt": "blurry, lowres, bad anatomy",
  "tasks": [
    {
      "name": "crane_ink",
      "prompt": "A red-crowned crane in a misty lotus pond at dawn, Chinese ink painting",
      "seeds": [42, 108]
    },
    {
      "name": "cabin_snow",
      "prompt": "A cozy wooden cabin in a snowy pine forest at dusk, photorealistic",
      "width": 1024,
      "height": 768,
      "seed": 2026
    }
  ]
}
```

```powershell
python "<skill-dir>/scripts/imagen.py" --preset dreamshaper-xl-turbo --job-file "./job.json" --out "./imagen-output"
```

---

## 内置模型预设（`configs/models.json`）

可通过编辑 `configs/models.json` 增删预设，或在命令行用 `--model <HF_MODEL_ID> --width ... --steps ... --cfg ...` 覆盖：

| 预设名称 (`--preset`) | HuggingFace 模型 ID | 默认规格 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `sdxl-turbo` (默认) | `stabilityai/sdxl-turbo` | 512x512, 4步, CFG 0.0 | 极速草稿（约 1.5s/张，非商用许可，不支持负向提示词） |
| `dreamshaper-xl-turbo` | `Lykon/dreamshaper-xl-v2-turbo` | 1024x1024, 6步, CFG 2.0 | 兼顾速度（6步）与 1024px 高清细节，支持负向提示词 |
| `playground-v2.5` | `playgroundai/playground-v2.5-1024px-aesthetic` | 1024x1024, 25步, CFG 3.0 | 色彩、光影与美学构图表现优异 |
| `sdxl-base` | `stabilityai/stable-diffusion-xl-base-1.0` | 1024x1024, 25步, CFG 7.5 | 标准 SDXL 1.0 基础模型 |

---

## 常见异常与处理

- **未登录 Kaggle (`exit code 3`)**：引导用户在终端运行 `kaggle auth login` 在浏览器完成 OAuth 登录（切勿读取或索要用户的凭据文件）。
- **静默降级到 CPU (`No GPU detected`)**：Kaggle 账号未验证手机号时会静默将 GPU 任务降级到 CPU。脚本检测到后会立即中断并提示用户在 Kaggle 网页端 `Settings -> Phone Verification` 完成绑定。

## 架构与扩展规范

插件化、本地状态文件（`.state/session.json`）、远端 HTTP 协议以及未来接入 Harness GUI / ComfyUI 的设计规范详见 [docs/SPEC.md](docs/SPEC.md)。
