# our-free-imagen

> 借用 Kaggle 每周免费 30 小时 GPU，让你的 DSH Desktop 免费、不卡顿地跑开源文生图大模型。

无需本机配备高端显卡，也无需在电脑上折腾复杂的 PyTorch/CUDA 环境。安装本插件后，你可以在 DSH Desktop 的独立整页工作台里一键唤起远端 GPU 并连续出图，也可以在对话里让 Agent 调用生图工具。图片直接保存在当前工作区，不经过任何第三方图床。

---

## 核心特性

- **零本地负担**：模型推理全部运行在 Kaggle 免费的 2×Nvidia Tesla T4 云端容器中，本地轻量无压力。
- **开机一次，随画随出**：一次会话只拉起一个 Kernel，加载完成后连续出图（SDXL Lightning 单张仅需约 6 秒）。
- **双模使用**：
  - **可视化工作台**：独立整页视图，单轨创作面板 + 画面预览 + 最近生成；支持参数微调、5 组灵感预设、光影 / 材质 / 构图 / 氛围四维润色、作品画廊与「带回参数」。
  - **创作助手**：用一句话描述画面，由宿主模型解析出提示词、比例与风格，先给确认卡再出图。
  - **对话调用**：在聊天窗口中直接对 AI 说 *“帮我画一张赛博朋克风格的雨夜街景”*，模型自动调用工具出图。
- **省电与省额度**：空闲 30 分钟自动关机，也可在面板中一键关机，不浪费 Kaggle 免费算力。
- **断点可恢复**：会话信息实时写入工作区 `.imagen/session.json`，DSH 重启或插件热重载后会先探活、再接管或清理，避免远端 GPU 空转。
- **隧道自愈与备用通道**：远端 cloudflared 中途退出会自动重拉并重新广播；如配置了自建隧道命令，cloudflared 失败时可自动切换。
- **排错可见**：工作台算力弹层可打开运行日志抽屉，直接查看安装 / 隧道 / 生成日志，并一键复制诊断信息。
- **权重预挂载**：可把模型权重做成 Kaggle Dataset 挂载到容器，跳过每次冷启动的下载（见下文配置）。

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
3. 点击左侧边栏新增的 **免费生图** 入口，进入整页工作台。

### 步骤 3：开始出图
- **首次启动**：输入提示词并点击「立即生成」。若云端实例未启动，插件会自动推送任务到 Kaggle。
- **排队等待**：首次启动通常需要 5~10 分钟分配云端机器并加载模型（顶栏 GPU 状态会显示排队与加载进度）。
- **极速产出**：云端就绪后，状态变为「云端在线 · 6s/张」，之后每次出图均在数秒内完成。生成图片自动存放在当前工程的 `imagen-output/` 目录下，可用顶栏的「在文件夹中打开」直接定位。

---

## 日常使用方式

### 1. 工作台操作（独立整页视图）
- **参数预设**：内置 `SDXL Lightning`（推荐，4步高画质）、`SDXL Turbo`（极速草图）、`SDXL Base` 等。切换预设会自动回填实测最佳参数。
- **创作面板**：提示词下方常驻 5 组灵感预设；「润色」按光影 / 材质 / 构图 / 氛围给出四维标签，点一次追加、再点撤销。
- **自定义微调**：支持调整画面比例、采样步数、引导强度、随机种子与生成张数；长篇说明藏在字段旁的 `(i)` 悬浮提示里。
- **画面与历史**：右侧画面预览可放大；底部最近生成按批次展示缩略图，点击可带回主预览。
- **作品画廊**：卡片悬停提供「带回参数 / 生成变体 / 查看大图」；批量模式下可删除或复制绝对路径。

### 2. 创作助手
选面板头部的「创作助手」标签，直接说想画什么：
- *“画一张横版的雨夜街景，要写实一点，画质高一些”* → 助手解析成提示词、16:9 与写实摄影，先给确认卡，点「按此生成」出图。
- 后续消息作为增量修改：“背景加一只撑伞的黑猫”，会继承上一轮描述与参数。

### 3. 对话中让 AI 帮你画
安装插件后，你的 DSH 会话模型会自动获得 3 个画图工具（`imagen_generate`、`imagen_session`、`imagen_history`）：
- *“帮我画一只戴着太空头盔的柴犬，写实风格”*
- *“查看当前生图服务的状态”*
- *“关闭生图云端实例”*

---

## 可选配置

插件配置写在 DSH 的插件配置项里（键名区分大小写），全部可选：

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `defaultPreset` | `sdxl-lightning` | 默认模型预设 id |
| `accelerator` | `NvidiaTeslaT4` | Kaggle 加速器类型 |
| `idleTimeoutSec` | `1800` | 远端空闲多少秒后自动关机（300~10800） |
| `provisionTimeoutMinutes` | `45` | 等待 Kaggle 分配 GPU 的最长分钟数（5~240） |
| `sessionWaitMinutes` | `45` | 出图任务等待会话就绪的最长分钟数（5~240） |
| `generateTimeoutSeconds` | `300` | 单次生成请求超时秒数（30~1800） |
| `hfToken` | 空 | HuggingFace Token；设置后可避免匿名拉取大模型被 429 限流，也支持 gated 仓库 |
| `pipConstraints` | `[]` | 额外 pip 约束，如 `["diffusers==0.36.0"]`；按包名覆盖内置上限 |
| `datasetSources` | `[]` | 预挂载的 Kaggle Dataset，如 `["owner/sdxl-weights"]`，挂载到 `/kaggle/input/<dataset>` |
| `localModels` | 空 | 权重仓库 → 容器内目录的映射，如 `{"stabilityai/stable-diffusion-xl-base-1.0": "/kaggle/input/sdxl-weights"}`；命中后跳过下载 |
| `fallbackTunnelCommand` | `[]` | 备用隧道命令 argv，支持 `{port}` 占位，如 `["/kaggle/working/bore", "server", "bore.pub", "-p", "{port}"]` |
| `fallbackTunnelUrlRegex` | 内置 https 规则 | 从备用通道输出里提取地址的正则 |
| `trustedTunnelDomains` | `[]` | 备用通道的域名后缀（如 `["tunnel.example.com"]`），Host 只对可信 https 地址发送 token |
| `devEndpoint` / `devToken` | 空 / `dev-token` | 本地联调：直连本机 mock daemon（也可用同名环境变量） |

> 备用通道要求输出 **https** 地址；`trustedTunnelDomains` 是安全白名单，未登记的自建域名不会被信任。
> 权重预挂载需要先自行把模型文件发布为 Kaggle Dataset，目录结构保持 HuggingFace 仓库原样（含 `model_index.json`）。

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

测试按层次划分（离线检查均不需要 Kaggle 账号与 GPU）：

```powershell
# 一次跑完离线检查：构建 + 契约 + 客户端文案/逻辑/渲染 + Host 端到端 + 会话状态机/竞态 + 本地库
npm test

# 只跑契约校验：路由 / 错误码 / 参数边界 / 预设 / 远端协议的唯一来源是 shared/contract.js，
# 改契约后必跑（也校验 remote/contract.json 是否与契约同步）
npm run test:contract

# 只跑 Host 端到端（21 项自动化断言，起本地 mock daemon 跑完整链路）
npm run test:host

# 只跑客户端（文案键完整性 / 纯逻辑 / 渲染结构，需先构建 client.js）
npm run test:client

# Python daemon 的单元测试（需要本机 python 环境；已接入 npm test 与 npm run test:host）
npm run test:daemon   # 纯函数单测（101 项：隧道监管 / 冷启动 / 预挂载 / 备用通道）

# 会话持久化与启动恢复（79 项：探活接管、重新会合、清理、竞态、token 不落日志）
node test/session-restore.mjs

# Kernel 打包注入（dataset_sources / 配置 Base64 / metadata 合法）
node test/kernel-package.mjs

# 重新生成 / 校验下发给远端 daemon 的契约 JSON（改了 shared/contract.js 后）
npm run contract:gen
npm run contract:check
```

发布打包（先构建 client.js，再产出 `dist/` 下可加载目录与 zip）：

```powershell
npm run package
```

真机验证（手动执行，会消耗 Kaggle GPU 额度）：

```powershell
npm run test:live   # 真实 Kaggle CLI 链路（登录、推送、日志）
npm run test:gpu    # 真实 GPU 出图链路（端到端出图）
```

> 契约改动流程：只改 `shared/contract.js`（及需要同步的生成物），然后依次跑 `npm run test:contract` 与 `npm test`；不要在各调用点重新写字面量。

> 「检查环境」每点一次都会启动若干个 `kaggle` CLI 子进程（每个约 10 秒），因此首次检查需要 20~30 秒，面板会显示「检查中」。

---

## 进阶技术文档

- **[技术规格与契约 (docs/SPEC.md)](docs/SPEC.md)**：接口契约单一真理源、生命周期、错误码定义以及 Studio 工作台 UI 交互规范。
- **[架构设计 (docs/ARCHITECTURE.md)](docs/ARCHITECTURE.md)**：底层通信链路、Cloudflare 穿透、心跳保活与 Kaggle 容器避坑指南。
- **[产品定位与约束 (docs/PRODUCT.md)](docs/PRODUCT.md)**：目标人群、运行环境、功能全景矩阵与无障碍设计标准。
- **[设计系统令牌 (docs/DESIGN.md)](docs/DESIGN.md)**：黑白灰视觉令牌、排版字阶、间距网格、阴影体系与响应式断点。
- **[演进路线 (docs/ROADMAP.md)](docs/ROADMAP.md)**：版本里程碑与后续功能规划。
- **[代码重构与整洁化规范 (docs/CODE_REFACTOR_SPEC.md)](docs/CODE_REFACTOR_SPEC.md)**：针对过度设计、伪解耦与测试自嗨的工程整洁化实施指南。
- **[历史归档库 (docs/archive/)](docs/archive/README.md)**：归档历史重构调研底稿与已废弃的前序版本规格。
