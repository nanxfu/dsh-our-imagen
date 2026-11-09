# our-free-imagen

> 借用 Kaggle 每周免费 30 小时 GPU，让你的 DSH Desktop 免费、不卡顿地跑开源文生图大模型。

无需本机配备高端显卡，也无需在电脑上折腾复杂的 PyTorch/CUDA 环境。安装本插件后，你可以在 DSH Desktop 中一键唤起远端 GPU，并在设置页工作台或对话框中直接生图。图片直接保存在当前工作区，不经过任何第三方图床。

---

## 核心特性

- **零本地负担**：模型推理全部运行在 Kaggle 免费的 2×Nvidia Tesla T4 云端容器中，本地轻量无压力。
- **开机一次，随画随出**：一次会话只拉起一个 Kernel，加载完成后连续出图（SDXL Lightning 单张仅需约 6 秒）。
- **双模使用**：
  - **可视化工作台**：在 DSH 设置页提供专属面板，支持参数微调、实时进度、图墙预览与一键复制本地路径。
  - **自然对话调用**：在聊天窗口中直接对 AI 说 *“帮我画一张赛博朋克风格的雨夜街景”*，模型自动调用工具出图。
- **省电与省额度**：空闲 30 分钟自动关机，也可在面板中一键关机，不浪费 Kaggle 免费算力。

---

## 3 步快速上手

### 步骤 1：安装与配置 Kaggle 凭证
插件通过本机 `kaggle` 命令行与云端调度，插件本身不保存任何账号密码。

1. 在终端安装官方命令行：
   ```powershell
   pip install -U kaggle
   ```
2. 前往 [Kaggle 账号设置页](https://www.kaggle.com/settings/api)，点击 **Create New Token**。
3. 将下载的 Token 写入本地配置：
   ```powershell
   Set-Content -NoNewline "$env:USERPROFILE\.kaggle\access_token" "你的_Kaggle_Token"
   ```

> ⚠️ **重要提示**：Kaggle 账号**必须绑定手机号**。未完成手机验证的账号会被平台静默降级为 CPU 运行，导致无法启动 GPU 实例。

### 步骤 2：在 DSH Desktop 中加载插件
1. 打开 DSH Desktop 设置，进入插件管理。
2. 以「本地 Bundle」方式选择本项目目录完成加载。
3. 进入设置页左侧新增的 **免费生图工作台**。

### 步骤 3：开始出图
- **首次启动**：输入提示词并点击「开始生成」。若云端实例未启动，插件会自动推送任务到 Kaggle。
- **排队等待**：首次启动通常需要 5~10 分钟分配云端机器并加载模型（面板会显示实时排队与加载进度）。
- **极速产出**：云端就绪后，状态变为「在线」，之后每次出图均在数秒内完成。生成图片自动存放在当前工程的 `imagen-output/` 目录下。

---

## 日常使用方式

### 1. 工作台操作（DSH 设置页）
- **参数预设**：内置 `SDXL Lightning`（推荐，4步高画质）、`SDXL Turbo`（极速草图）、`SDXL Base` 等。切换预设会自动回填实测最佳参数。
- **自定义微调**：支持调整分辨率（默认 1024×1024）、采样步数、CFG 引导值、随机种子与批量张数。
- **产物图墙**：右侧展示生成结果，支持点击放大预览、一键复制文件绝对路径。

### 2. 对话中让 AI 帮你画
安装插件后，你的 DSH 会话模型会自动获得 3 个画图工具（`imagen_generate`、`imagen_session`、`imagen_history`）：
- *“帮我画一只戴着太空头盔的柴犬，写实风格”*
- *“查看当前生图服务的状态”*
- *“关闭生图云端实例”*

---

## 开发与本地脱机联调

如果你在开发插件本身，无需每次都等待 Kaggle 排队，可使用内置的本地 Mock 服务：

```powershell
# 1. 启动本地 Mock 推理服务（秒级返回占位图，无需显卡）
python test/mock-daemon.py --port 17860 --token dev-token

# 2. 注入联调环境变量
$env:OUR_FREE_IMAGEN_ENDPOINT = "http://127.0.0.1:17860"
$env:OUR_FREE_IMAGEN_TOKEN = "dev-token"

# 3. 重启 DSH Desktop，插件即刻进入 Ready 状态
```

更多测试与真机验证命令：
```powershell
# 运行 Host 端到端功能测试（15 项自动化断言）
node test/host-e2e.mjs

# 检查前端国际化文案键完整性
node test/check-client-locale.mjs
```

---

## 进阶技术文档

- 想要了解底层链路原理、Cloudflare 穿透细节与 Kaggle 避坑指南？请参阅 [架构设计 (ARCHITECTURE.md)](docs/ARCHITECTURE.md)。
- 想要查看精准接口定义、Agent Tool 规范与硬件实测性能对比？请参阅 [技术规格 (SPEC.md)](docs/SPEC.md)。
- 想要了解后续规划？请参阅 [演进路线 (ROADMAP.md)](docs/ROADMAP.md)。
