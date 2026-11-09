# our-free-imagen

DSH Desktop（DeepSeek Harness）的生图插件。调用 Kaggle 免费 GPU（T4 ×2）在远端运行开源文生图模型，向 DSH 界面与 Agent 提供出图能力。

## 运行环境准备

插件依赖本机 `kaggle` 命令行与账号凭据完成远端调度，插件本身不存储凭据。

1. 安装 CLI：
   ```powershell
   pip install -U kaggle
   ```
2. 配置 Token：
   在 [Kaggle 账号设置页](https://www.kaggle.com/settings/api) 点击 **Create New Token**，将内容写入本地凭据文件：
   ```powershell
   Set-Content -NoNewline "$env:USERPROFILE\.kaggle\access_token" "你的Kaggle_Token"
   ```
   > 注：Kaggle 账号必须绑定手机号，否则 GPU 任务会被平台降级至 CPU。

## 安装与启动

1. 在 DSH Desktop 的插件管理中以本地 Bundle 方式加载本项目目录。
2. 打开 DSH 设置页中的 **免费生图工作台**。
3. 点击 **检查环境**，确认 CLI、鉴权与配额状态正常。

## 文档索引

- [docs/DESIGN.md](docs/DESIGN.md)：系统架构、进程边界、Daemon 握手与 HTTP 协议。
- [docs/MODELS_AND_BENCHMARKS.md](docs/MODELS_AND_BENCHMARKS.md)：实测性能数据、显存占用与平台限制。
- [docs/ROADMAP.md](docs/ROADMAP.md)：后续演进规划（权重挂载加速、双卡支持等）。
- [TODO.md](TODO.md)：开发任务清单（供编码 Agent 接手执行）。
