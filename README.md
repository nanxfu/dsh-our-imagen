# our-free-imagen

DSH Desktop（DeepSeek Harness）的生图插件。借用 Kaggle 的免费 GPU 额度，在远端常驻运行开源文生图模型，向 DSH 界面和会话模型提供出图能力。

一次会话只拉起一个 Kaggle Kernel，模型加载一次后反复出图；图片直接保存在当前工作区，不经过第三方存储。

## 能力

- **会话管理**：一键推送 Kernel、等待 GPU 排队、建立 Cloudflare 隧道、健康检查，任意环节的失败都有明确状态与原因。
- **出图任务**：串行队列，参数校验与钳制，结果图片与 `meta.json` 落在 `<workspace>/imagen-output/`。
- **界面工作台**：DSH 设置页内的参数区、进度、图墙与历史；对话页头部有状态徽章。
- **模型可调用**：`imagen_generate`、`imagen_session`、`imagen_history` 三个工具，可在对话中直接"帮我画一张…"。

## 运行环境准备

插件依赖本机 `kaggle` 命令行与账号凭据完成远端调度，插件本身不存储凭据。

1. 安装 CLI：
   ```powershell
   pip install -U kaggle
   ```
2. 配置 Token：在 [Kaggle 账号设置页](https://www.kaggle.com/settings/api) 点击 **Create New Token**，把内容写入本地凭据文件：
   ```powershell
   Set-Content -NoNewline "$env:USERPROFILE\.kaggle\access_token" "你的Kaggle_Token"
   ```
   > 账号必须绑定手机号，否则 GPU 任务会被平台静默降级到 CPU。

3. 在 Kaggle 网页端确认账号可创建 Script Kernel（首次推送会自动创建私有 Kernel）。

## 安装与启动

1. 在 DSH Desktop 的插件管理中以本地 Bundle 方式加载本项目目录。
2. 打开 DSH 设置页中的 **免费生图工作台**，点 **检查环境** 确认 CLI、鉴权与配额。
3. 输入画面描述，点 **开始生成**。首次生成时若会话未启动，插件会自动推送 Kernel；GPU 排队通常需要 10 分钟以上，期间界面显示排队状态。

## 使用方式

### 界面

设置页工作台包含：会话状态与启动/关机、Prompt 与反向提示词、预设与尺寸/步数/CFG/种子/张数、当前任务进度、结果图墙（点击放大，可复制路径）、历史产物。

切换预设时按该预设的实测推荐值回填参数；手动改过的值以手动值为准。

### 对话

安装后可直接对模型说"画一张…"，模型会调用 `imagen_generate`。首次调用可能返回"任务仍在进行中"，再问一次或让它查 `imagen_history` 即可拿到图片路径与预览链接。

### 关机

远端进程空闲 30 分钟自动退出；也可以在工作台点 **一键关机**，或在对话中让模型调用 `imagen_session` 的 `stop`。

## 配置项

插件配置写在加载项里（`cordis.patch.yml` 的 `config`），全部可选：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `defaultPreset` | `sdxl-lightning` | 默认模型预设 |
| `accelerator` | `NvidiaTeslaT4` | Kaggle 加速器名，T4 会分配 2 张卡 |
| `idleTimeoutSec` | `1800` | 远端空闲退出时间 |
| `provisionTimeoutMinutes` | `45` | 等待 GPU 排队的上限 |
| `sessionWaitMinutes` | `45` | 任务等待会话就绪的上限 |
| `generateTimeoutSeconds` | `600` | 单次生成请求的远端超时 |
| `devEndpoint` / `devToken` | 空 | 本地联调时直连 mock daemon，跳过 Kaggle |

## 开发与测试

```powershell
# 纯本地，不需要 Kaggle：内置 mock daemon，覆盖提交→落盘→历史→文件路由→工具
node test/host-e2e.mjs

# 真实链路：推送一个不占 GPU 的探针 Kernel，验证 push → 隧道 → 握手 → 生成 → 关机
node test/kaggle-live.mjs

# 真实 GPU 出图（会消耗配额，需要排队）
node test/gpu-live.mjs

# 重启 DSH 后确认插件真的加载了（路由 404 时最先跑这个）
node test/verify-loaded.mjs --port 52629

# 前端文案键一致性
node test/check-client-locale.mjs
```

本地联调前端时，可以用 mock daemon 顶替远端，跳过 Kaggle：

```powershell
python test/mock-daemon.py --port 17860 --token dev-token
$env:OUR_FREE_IMAGEN_ENDPOINT = "http://127.0.0.1:17860"
$env:OUR_FREE_IMAGEN_TOKEN = "dev-token"
# 重启 DSH 后，会话状态直接是 ready
```

## 目录结构

```
index.js             Host 入口：路由、状态、Agent 工具
client.js            Web Client：设置页工作台与状态徽章
lib/
  presets.js         模型预设与远端加载描述（唯一数据来源）
  session.js         会话状态机（push → 排队 → 隧道 → 握手）
  kernel.js          Kernel 目录构建与配置注入
  kaggle.js          kaggle CLI 封装（探测、推送、状态、日志）
  jobs.js            串行出图队列
  output.js          图片落盘、meta.json、历史扫描
  remote.js          远端 Daemon 客户端
  net.js             出站 HTTP（fetch 失败降级 curl）
  paths.js           工作区路径与越界校验
  http.js            JSON 响应与请求体读取
remote/
  daemon.py          Kaggle 内的常驻推理服务
  worker.py          单次批处理脚本（bench 用，保留）
test/
  host-e2e.mjs       Host 端到端测试（mock daemon，15 项断言）
  kaggle-live.mjs    真实链路验证（不占 GPU 的探针 Kernel）
  gpu-live.mjs       真实 GPU 出图验证
  verify-loaded.mjs  重启后确认插件已加载
  check-client-locale.mjs  前端文案键一致性检查
  tunnel-probe.py    不占 GPU 的探针 Kernel
  mock-daemon.py     本地 mock Daemon（不依赖 torch）
  smoke-daemon.py    mock Daemon 的协议验收
```

## 文档索引

- [docs/API.md](docs/API.md)：Host 路由、状态机、任务对象与远端协议（实现契约）。
- [docs/DESIGN.md](docs/DESIGN.md)：系统架构、进程边界与关键约束。
- [docs/MODELS_AND_BENCHMARKS.md](docs/MODELS_AND_BENCHMARKS.md)：实测性能数据、显存占用与平台限制。
- [docs/ROADMAP.md](docs/ROADMAP.md)：后续演进规划。
- [TODO.md](TODO.md)：待办清单。
