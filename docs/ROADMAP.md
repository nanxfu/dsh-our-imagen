# 技术路线 (ROADMAP)

## 演进方向

### 1. 模型权重挂载加速（Kaggle Dataset）
- **现状**：每次拉起新 Kernel 需从 Hugging Face 下载 6~8GB 权重，耗时约 1~2 分钟。
- **思路**：将常用模型打包为私有或公开 Kaggle Dataset，Kernel 启动时通过 `dataset_sources` 挂载至 `/kaggle/input/`，直接读取本地文件以跳过下载步骤。

### 2. 双卡与多模型支持
- **现状**：当前默认单卡 T4，较大参数模型（如 FLUX.2-klein-4B）单卡显存不足。
- **思路**：支持切换 `--accelerator NvidiaTeslaT4`（Kaggle 会提供 2 块 T4），并在远端脚本使用 `device_map="balanced"` 分布显存，支持更高质量或更大参数模型。

### 3. 生成历史与参数回填
- **现状**：图片直接保存到工作区目录，前端仅保留当前会话结果。
- **思路**：解析 `imagen-output/` 目录中的 `meta.json`，提供历史缩略图查看，支持点击一键回填 Prompt 与 Seed 参数。

### 4. 连接隧道备份
- **现状**：依赖 Cloudflare Tunnel（trycloudflare.com）进行内网穿透。
- **思路**：在复杂网络环境下增加备用隧道通道，并支持网络抖动后的自动重连。
