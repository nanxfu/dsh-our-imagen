# AIGC Studio 独立客户端架构设计与迁移方案

> **文档状态**：规划定稿（基于 `dsh-our-imagen` `0.13.0` 代码库盘底）  
> **目标形态**：独立仓库 `aigc-studio`，采用 **Electron + Vite (React) + 本地 Node.js 服务 + 可插拔 GPU 执行节点** 架构  
> **首期目标（Phase 1）**：零重写剥离 DSH 宿主依赖，先以 **Kaggle / Colab 云端 GPU + 现有图片生成/编辑全功能** 跑通独立客户端；为后续 **私有远程 Worker、本机 GPU 管理、AI 视频生成/轻量编辑、图生/文生 3D 与 MCP Server** 预留清晰演进接口。

---

## 一、 为什么这样设计（核心架构决策）

1. **为什么新建独立仓库而不是继续塞进 DSH 插件**
   - 当前 `src/` 约 2.7 万行、`lib/` 约 1.4 万行、`remote/` 约 8,400 行，打包后的单文件 `client.js` 已达 **905.7 KB**，且在 DSH 中设置了 `immediately: true` 同步预加载。继续叠加视频、3D 预览与本地环境管理会持续拖慢 DSH 启动，且无法使用现代前端分包与独立桌面生命周期（托盘常驻、多工作区、后台保活）。
   - `dsh-our-imagen` 仓库维持在 `0.13.x` 图片工作台稳定维护态；新仓库 `aigc-studio` 轻装演进，未来若需要让 DSH 调用客户端的图像/视频/3D 能力，通过 **标准 MCP Server** 接入，避免双端代码库长期平行开发与兼容包袱。

2. **为什么选 Electron（而不是 Tauri 或重构后端）**
   - **后端零重写**：现有 `lib/`（1.4 万行）中 90% 以上已经是纯 Node.js（Kaggle/Colab OAuth PKCE、会话状态机、任务队列、版本树、原子落盘）。Electron 主进程/Utility Process 原生运行 Node.js，只需为 `index.js` 依赖的 6 个宿主接口编写薄适配层即可直接运行。
   - **开发机友好**：不需要在 Windows 上安装与编译数 GB 的 Rust 工具链与 MSVC Build Tools，纯 JS/Node 工具链可秒级热更新，在轻薄本/弱性能 Windows 上也能高效开发。
   - **多媒体与 3D 兼容性一致**：后续接入视频播放器、WebGL2/WebGPU 3D 模型预览（Three.js `.glb`）时，Electron 在 Windows/macOS/Linux 三端使用统一 Chromium 内核，无系统 WebView 编解码与着色器差异。

3. **为什么保留「本地 HTTP 服务（`127.0.0.1`）」而不是全部改写为 Electron IPC**
   - 保持前端通过 `http://127.0.0.1:<port>/api/*`（携带启动时生成的随机 Bearer Token）访问本地 Node 服务，有三个决定性收益：
     1. **开发态极快**：日常改前端/后端无需每次重启 Electron，浏览器直连 Vite 开发服务器即可调试完整工作台；
     2. **大资产流式传输天然就绪**：未来几十 MB 的视频（MP4 HTTP Range 拖拽播放）和 3D 模型（`.glb` 二进制流）直接走标准 HTTP 流，不受 Electron IPC 序列化拷贝限制；
     3. **现有 `src/api/` 与后端路由测试几乎 100% 复用**。

4. **为什么首期先接云端 GPU（Kaggle / Colab）再做私有 Worker 与本机 GPU**
   - 遵循「一次只换一个变量」原则：先把载体（DSH 插件 → 独立 Electron 客户端）稳定切出来、验证工作区切换、独立 LLM 配置与托盘保活；
   - 在本机性能有限的情况下，第二步优先打通 **私有远程 Worker（Docker/SSH 连向 Linux GPU 节点）**，既满足远程私有部署需求，也为自己调试视频/3D 大模型提供稳定算力，最后再补全本机显卡运行时管理（`uv` 隔离环境 + 显存探测）。

---

## 二、 独立仓库目录结构设计（`aigc-studio/`）

```text
aigc-studio/
├─ package.json                     # 根工程：scripts（dev / build / pack / test）与依赖管理
├─ electron-builder.yml             # Electron 打包配置（NSIS/DMG/AppImage、图标、托盘资源）
├─ vite.config.js                   # Web 前端构建配置（支持按路由/面板懒加载分包，告别单文件内联）
├─ .env.example                     # 开发期环境变量示例（自定义端口、devEndpoint 等）
│
├─ electron/                        # 【桌面壳层】保持极薄，只做 OS 原生能力与子进程托管
│  ├─ main.mjs                      # 应用生命周期、单实例锁、BrowserWindow、全局快捷键
│  ├─ preload.cjs                   # contextBridge 安全白名单（选文件夹、系统通知、窗口控制）
│  ├─ tray.mjs                      # 系统托盘（最小化后台运行、显示当前云端会话状态、安全退出）
│  ├─ server-host.mjs               # 拉起/监控本地 server（传递随机端口、鉴权 Token、退出清理超时保护）
│  └─ native-bridge.mjs             # 原生弹窗（切换工作区目录）、在文件管理器中显示、剪贴板增强
│
├─ server/                          # 【本地控制面】由原 lib/ + index.js 演进，纯 Node.js
│  ├─ standalone.mjs                # 独立服务入口：组装配置、创建 HTTP Server、监听优雅退出
│  ├─ host-context.mjs              # StandaloneContext：实现原 DSH ctx 的 6 个薄适配接口
│  ├─ app.mjs                       # 业务装配层（原 index.js 逻辑：SessionManager、JobQueue、Routes）
│  ├─ auth.mjs                      # 本地访问安全：启动期一次性 Token 校验 + 严格 localhost/CORS 限制
│  ├─ workspace.mjs                 # 多工作区管理（工作区切换、历史列表、全局 appData vs 项目目录分离）
│  ├─ http.mjs                      # HTTP 工具（JSON/流式响应、错误处理，原 lib/http.js）
│  ├─ route-kit.mjs                 # 路由注册器（原 lib/route-kit.js，底层对接原生 node:http Router）
│  ├─ paths.mjs                     # 路径安全校验（原 lib/paths.js，根路径对接 WorkspaceManager）
│  ├─ settings.mjs                  # 运行设置存储（原 lib/settings.js + 新增 LLM/独立端设置项）
│  ├─ llm.mjs                       # 基于 pi-ai 的统一大模型调用（OpenAI/Anthropic/DeepSeek/Ollama + 本地兜底）
│  ├─ agent/                        # 【独立创作 Agent】基于 pi-agent-core 的工具循环与会话编排
│  │  ├─ runtime.mjs                # Agent 实例生命周期、事件订阅与 SSE 桥接（abort / tool_execution）
│  │  ├─ message-adapter.mjs        # 工作台自定义 AgentMessage（确认卡/任务气泡）↔ convertToLlm 映射
│  │  └─ tools.mjs                  # 原 lib/tools.js 迁移，改用 TypeBox Schema 定义（同时复用给 MCP）
│  ├─ enhance.mjs                   # 提示词润色与翻译（走 pi-ai 单轮直出，原 lib/enhance.js）
│  ├─ intent.mjs                    # 创作助手意图解析（走 pi-ai 单轮结构化解析，原 lib/intent.js）
│  ├─ output.mjs                    # 产物落盘与版本树扫描（原 lib/output.js，预留 media kind 扩展）
│  ├─ library.mjs                   # 收藏与本地索引（原 lib/library.js）
│  ├─ image-meta.mjs                # PNG tEXt 元数据读写（原 lib/image-meta.js）
│  ├─ log.mjs                       # 滚动文件日志与脱敏（原 lib/log.js）
│  ├─ redact.mjs                    # 凭据与密钥脱敏（原 lib/redact.js）
│  ├─ diagnostics.mjs               # 诊断指纹（原 lib/diagnostics.js）
│  ├─ fs-atomic.mjs                 # 串行队列原子写（原 lib/fs-atomic.js）
│  ├─ net.mjs                       # 代理感知网络层（原 lib/net.js，curl 兜底）
│  ├─ presets.mjs                   # 预设查询（原 lib/presets.js）
│  ├─ update-check.mjs              # 客户端版本检查（对接 GitHub Releases）
│  ├─ jobs/                         # 任务队列与校验（原 lib/jobs/*）
│  │  ├─ queue.js
│  │  ├─ validator.js
│  │  ├─ reference-loader.js
│  │  └─ errors.js
│  ├─ session/                      # 会话生命周期子模块（原 lib/session/* + lib/session.js）
│  │  ├─ manager.js
│  │  ├─ health-monitor.js
│  │  ├─ health.js
│  │  ├─ pending-cleanup.js
│  │  ├─ persistence.js
│  │  ├─ provisioner.js
│  │  ├─ rendezvous.js
│  │  ├─ restorer.js
│  │  ├─ state.js
│  │  └─ tunnel-watcher.js
│  ├─ providers/                    # 【算力驱动抽象层】
│  │  ├─ provider.js                # ComputeProvider 统一契约（状态/能力上报/流式任务预留）
│  │  ├─ kaggle.js                  # 原 lib/providers/kaggle.js + kaggle-*.js / kernel.js
│  │  ├─ colab.js                   # 原 lib/colab/*
│  │  ├─ private-worker.js          # [Phase 2 预留] 私有服务器 / Docker / AutoDL / SSH 隧道直连
│  │  └─ local-gpu.js               # [Phase 2+ 预留] 本机显卡探测（nvidia-smi）与 uv 隔离环境管理
│  └─ routes/                       # REST + SSE 路由模块（原 lib/routes/*）
│     ├─ session.js
│     ├─ jobs.js
│     ├─ files.js                   # Phase 2 扩展为支持 HTTP Range 的媒体流路由
│     ├─ import.js
│     ├─ library.js
│     ├─ prompts.js
│     ├─ settings.js
│     ├─ ui-state.js
│     ├─ logs.js
│     ├─ kaggle.js
│     ├─ colab.js
│     ├─ workspace.js               # [新增] 获取/切换当前桌面工作区、打开外部目录
│     └─ events.js                  # [Phase 2 预留] SSE 实时任务进度与状态推送
│
├─ web/                             # 【React 工作台前端】由原 src/ 迁移，Vite 标准构建
│  ├─ index.html                    # 桌面窗口 HTML 入口（初始化主题、注入运行时 API 基址/Token）
│  ├─ main.jsx                      # React 18+ 挂载入口（替代原 src/index.js 的 DSH slots 注入）
│  ├─ runtime.js                    # React & Electron desktopBridge 访问封装
│  ├─ constants.js                  # 前端常量
│  ├─ i18n.js                       # 独立国际化钩子（自持中英文切换，不再依赖 ctx.locale）
│  ├─ api.js                        # 统一 fetch（自动附加 Electron 注入的本地端口与 Bearer Token）
│  ├─ api/resources.js              # 资源请求封装
│  ├─ dict/                         # 中英文词典（原 src/dict/*）
│  ├─ hooks/                        # 通用状态 hooks（useHostState / useNow）
│  ├─ logic/                        # 纯逻辑层（原 src/logic/*，完整保留全部纯函数）
│  ├─ components/                   # 通用 UI 基础组件（Tooltip 等）
│  ├─ styles/                       # 原 src/styles/*（tokens.css、stage.css、panel.css 等）
│  └─ studio/                       # 工作台核心视图（原 src/studio/*）
│     ├─ Studio.jsx                 # 主工作台布局（顶栏新增：工作区选择器、模式切换入口）
│     ├─ TopBar.jsx                 # 顶栏（算力状态弹层、设置、日志、画廊切换、工作区显示）
│     ├─ Rail.jsx                   # 参数面板（预留「图片 / 视频 / 3D」工具域切换骨架）
│     ├─ ChatPanel.jsx              # 创作助手
│     ├─ Stage.jsx                  # 主舞台（Phase 1 图片舞台；Phase 2/3 按 kind 挂 Video/3D 预览）
│     ├─ Filmstrip.jsx              # 底部胶片条与版本树
│     ├─ Gallery.jsx                # 作品画廊
│     ├─ SettingsDrawer.jsx         # 设置抽屉（新增：AI 助手 API 配置、工作区设置、算力后端切换）
│     ├─ LogsDrawer.jsx
│     ├─ ModelCardPicker.jsx
│     ├─ GuidanceCard.jsx
│     ├─ hooks/                     # 工作台域 hooks
│     ├─ stage/                     # 图片工具（MaskEditor / OutpaintEditor / CompareSlider 等）
│     │  └─ ...                     # [Phase 2/3 预留] VideoStage.jsx / Mesh3DViewer.jsx
│     ├─ posters/                   # 静态资源，交由 Vite 处理不再强行转 base64
│     └─ ...
│
├─ shared/                          # 【前后端共享唯一契约】原 shared/*
│  ├─ contract.js                   # 路由、超时、限制、错误码、默认参数
│  ├─ models-guide.js               # 模型能力过滤与提示词风格说明
│  ├─ models.generated.js           # 由 tools/build-assets.mjs 生成
│  ├─ recipes.js                    # 风格配方
│  ├─ validation.js                 # 参数校验与清洗
│  └─ version.js
│
├─ models/                          # 【模型资产声明清单】原 models/*.json
│  ├─ flux2-klein-4b.json           # 现阶段图片模型，未来扩充 `mediaType: 'image'|'video'|'3d'`
│  ├─ sdxl-lightning.json
│  └─ ...
│
├─ worker/                          # 【GPU 执行端（原 remote/）】
│  ├─ __init__.py
│  ├─ daemon.py                     # Kaggle/Colab 临时环境守护进程（Phase 1 直接复用）
│  ├─ app.py                        # HTTP 路由层
│  ├─ config.py / state.py / ...
│  ├─ inference/                    # 推理引擎与加载器（diffusers / anima / upscale / future video & 3d）
│  ├─ infra/                        # 缓存、进程与隧道自愈
│  ├─ jobs/                         # 远端作业执行与状态存储
│  └─ worker_server.py              # [Phase 2 预留] 私有云/Docker/本机长驻 Worker 入口（无 ntfy/cloudflared）
│
├─ mcp/                             # [Phase 2 预留] 标准 MCP Server 入口
│  └─ server.mjs                    # 复用原 lib/tools.js 描述与 schema，通过本地 API 暴露给 DSH / Cursor 等
│
├─ tools/                           # 开发期探针与构建校验脚本（原 tools/* + 新增 dev 启动器）
│  ├─ build-assets.mjs              # 模型资产校验与生成 shared/models.generated.js
│  ├─ gen-contract-json.mjs         # 契约投影到 worker/contract.json
│  ├─ colab/                        # Colab 探针
│  ├─ verify-model.mjs              # 新模型真机验证
│  └─ preview/                      # UI 视觉回归预览脚本
│
├─ test/                            # 完整测试套件（延续当前高标准测试体系）
│  ├─ client/                       # 纯逻辑、表单、版本树、参考图、扩图、字典同构测试
│  ├─ server/                       # 队列、校验、会话、设置、Standalone HTTP 端到端测试
│  ├─ contract/                     # 前后端/Python 三端契约一致性校验
│  ├─ worker/                       # Python pytest/unittest 远端测试（原 test/remote/*）
│  └─ live/                         # Kaggle/Colab 真机回归（原 kaggle-live.mjs / gpu-live.mjs）
│
└─ docs/                            # 架构、契约、模型资产规范与排障手册
   ├─ SPEC.md
   ├─ MODEL_ASSET_SPEC.md
   └─ ...
```

---

## 三、 现有模块迁移映射与剥离细节（Phase 1 重点）

### 1. 剥离 DSH 的 6 个 `ctx` 依赖（核心工作量仅此一处）

原项目 `lib/` 中绝大多数文件已经不碰 DSH，只需在 `server/host-context.mjs` 提供一个轻量宿主适配器，并微调以下 6 个边界点：

| 原 DSH 依赖点 | 原代码位置 | 独立客户端方案（`aigc-studio`） |
| :--- | :--- | :--- |
| **`ctx.webServer`** | [index.js](file:///d:/document/development/our-free-imagen/index.js)、[lib/route-kit.js](file:///d:/document/development/our-free-imagen/lib/route-kit.js)、[lib/output.js](file:///d:/document/development/our-free-imagen/lib/output.js) | 用 Node 原生 `http.createServer` 实现轻量精确路由分发与 `getOrigin()`；绑定 `127.0.0.1` 随机空闲端口 + Token 鉴权。 |
| **`ctx.subprocess`** | [lib/routes/files.js](file:///d:/document/development/our-free-imagen/lib/routes/files.js)、[lib/kaggle.js](file:///d:/document/development/our-free-imagen/lib/kaggle.js)、[lib/net.js](file:///d:/document/development/our-free-imagen/lib/net.js) | 封装 `node:child_process.spawn`（包含 `maxBytes` 输出截断、超时 `SIGTERM/taskkill` 树杀与 `which/where` 可执行文件解析）。 |
| **`workingDirectory`** | [lib/paths.js](file:///d:/document/development/our-free-imagen/lib/paths.js) | 引入 `WorkspaceManager`：全局应用状态（最近项目、窗口尺寸、全局 LLM/OAuth 凭据）存系统 `userData`；作品输出（`outputs/` 或沿用 `imagen-output/`）与工作区设置（`.aigc-studio/`）随当前工作区切换。 |
| **`ctx.get('llm')`** | [lib/llm.js](file:///d:/document/development/our-free-imagen/lib/llm.js) | 基于 **`pi`（`pi-ai`）** 实现独立多后端模型调用（OpenAI / Anthropic / DeepSeek / OpenRouter / 本地 Ollama 等），直接保留原 `text-delta` 与 `reasoning` 过滤语义及思考档位控制；设置抽屉增加「创作助手模型（Provider / Base URL / API Key / Model）」，Key 用 OS 级 `safeStorage` 或 `0600` 存放；未配置时静默降级为已有本地规则兜底。 |
| **`ctx.tools` / Agent 循环** | [lib/tools.js](file:///d:/document/development/our-free-imagen/lib/tools.js) | 脱离 DSH 后引入 **`pi-agent-core`** 接管多步自主创作循环（分镜批生成、查历史后放大/重绘等），通过事件订阅把流式状态实时推给前端，并用 `convertToLlm` 把工作台卡片与 LLM 上下文隔离；工具参数改用 TypeBox Schema，Phase 2 可直接零损耗复用给独立 `mcp/server.mjs`。 |
| **`ctx.effect`** | [index.js](file:///d:/document/development/our-free-imagen/index.js)、[lib/route-kit.js](file:///d:/document/development/our-free-imagen/lib/route-kit.js) | 替换为简单的 `DisposableRegistry`，在 Electron `before-quit` / `SIGINT` 时统一触发 `session.dispose()`、`queue.dispose()`、`fileLog.dispose()`。 |

### 2. 前端迁移清单（`src/` → `web/`）

* **删除项**：
  * 移除 [src/index.js](file:///d:/document/development/our-free-imagen/src/index.js) 中的 `ctx.slots.inject` 与 `ctx.locale.register`；
  * 移除 [src/components/StatusChip.js](file:///d:/document/development/our-free-imagen/src/components/StatusChip.js) 与 [src/theme.js](file:///d:/document/development/our-free-imagen/src/theme.js)（原工作台主样式 [tokens.css](file:///d:/document/development/our-free-imagen/src/styles/tokens.css) 已完全独立，不依赖 `--dsw-*` 变量）；
  * 废弃单文件打包器 [build.mjs](file:///d:/document/development/our-free-imagen/build.mjs)。
* **新增/微调项**：
  * `web/main.jsx`：读取 Electron `preload` 注入的 `{ apiBaseUrl, authToken, initialTheme }`（浏览器开发模式则走 Vite proxy），挂载 `<Studio />`；
  * `web/i18n.js`：把语言切换做成顶栏/设置里的独立配置（`zh` / `en`），持久化到应用设置；
  * `web/api.js`：统一在请求头附加 `Authorization: Bearer <localToken>`，且将历史图片 URL 统一解析到 `apiBaseUrl`；
  * `web/studio/TopBar.jsx` & `SettingsDrawer.jsx`：增加当前工作区路径展示与一键切换按钮、AI 助手 API Key 配置区、深浅色主题手动切换开关。

### 3. Electron 安全与防烧额度生命周期规范

1. **防本地网页恶意调用（CSRF / 跨站扫描端口）**：
   - `server` 仅监听 `127.0.0.1`（禁止 `0.0.0.0`），每次启动生成 256-bit 随机 `LOCAL_API_TOKEN`；
   - 除了带签名的静态资源/媒体读取外，所有 `/api/*` 请求必须校验 `Authorization: Bearer <LOCAL_API_TOKEN>`（或者在浏览器预览模式由同源 Cookie/Token 校验），防止本地其他网页利用 `fetch('http://127.0.0.1:...')` 操作文件或触发云端消费。
2. **托盘驻留与安全关机（防 Kaggle/Colab 额度空烧）**：
   - 用户点击窗口右上角 `×` 时：若无活跃云端会话/任务，直接退出；**若云端 GPU 处于 `ready` / `provisioning` / `running` 状态，默认最小化到系统托盘并弹出桌面通知**，避免误关窗口导致云端挂机烧完每周额度；
   - 用户在托盘菜单点击「彻底退出」时：Electron 阻塞退出最多 5~10 秒，等待 `server` 持久化 `.aigc-studio/session.json`（或根据用户设置自动发起远端关机请求）完成后再结束进程；
   - 主进程异常崩溃兜底：`server` 子进程监听与主进程的 `ipc` / `stdin` 通道断开，发现父进程失联时自动进入安全收尾并退出。

---

## 四、 全局配置与项目工作区数据分离

脱离 DSH 单一工作区假设后，磁盘落盘拆成两层，互不污染：

1. **应用全局目录**（Windows: `%APPDATA%\aigc-studio\`，权限私有）：
   - `app-config.json`：最近打开的工作区路径列表、界面语言、主题（浅色/深色/跟随系统）、LLM API 配置（Key 使用 Electron `safeStorage` 加密或 `0600` 存放）；
   - `credentials/`：Kaggle OAuth 凭据（继续兼容 `~/.kaggle/credentials.json`）、Colab OAuth 凭据；
   - `logs/`：桌面壳与本地服务全局滚动日志。
2. **项目工作区目录**（用户选定的任意目录，例如 `D:\AI-Projects\Cyberpunk\`）：
   - `outputs/`（迁移期兼容读取已有 `imagen-output/`）：按 `<YYYYMMDD-HHmmss>-<jobId>/` 归档生成的图片、未来视频（`.mp4`）与 3D 资产（`.glb`）及 `meta.json`；
   - `.aigc-studio/`：该工作区专属的 `library.json`（收藏）、`settings.json`（算力偏好/模型预挂载等）、`session.json`（断线恢复记录）、`ui-state.json`。

---

## 五、 为 Phase 2 / Phase 3 提前守住的架构边界（避免日后返工）

即使 Phase 1 只做云端 GPU + 图片，搭建新仓库时也要守住以下 **4 条契约边界**，否则后面接视频和 3D 时需要大面积重写：

1. **资产类型不能写死为图片**
   - `HistoryItem` 与 `meta.json` 新增归一化字段 `mediaType: 'image' | 'video' | 'mesh3d'`（旧数据缺省回落 `'image'`）；
   - 产物落盘与读取（[server/output.mjs](file:///d:/document/development/our-free-imagen/lib/output.js)、`routes/files.js`）不要写死只认 `.png/.jpg` 或假设输出一定包含像素 `width × height`。
2. **文件读取路线支持 HTTP Range**
   - `GET /api/file?path=...` 从一开始就应使用 `fs.createReadStream` + `Range` 请求头支持（而不是把整文件 `readFile` 读进 Buffer），为未来数十 MB 的视频拖动进度条铺好底层通道。
3. **远端协议与算力后端解耦**
   - 当前 `daemon.py` 的 `/generate` 同步阻塞 + base64 JSON 回传只适用于图片。`ComputeProvider` 接口预留两类执行模式：
     - **Notebook 临时型**（`kaggle` / `colab`：push + ntfy/tunnel 会合 + 空闲自动关机）；
     - **长驻 Worker 型**（`private-worker` / `local-gpu`：直接健康检查 + SSE/WS 进度流 + 二进制 multipart 产物拉取）。
4. **舞台与版本树按 `mediaType` 分发**
   - 版本树（`rootImage` / `sourceImage` / `lineage`）逻辑保持资产无关：一张图片作为 v1，派生的图生视频（v2）或图生 3D 模型（v3）天然挂在同一棵版本树下；
   - `Stage.jsx` 通过组件分发渲染对应预览器（图片画布 / 视频播放器 / Three.js 3D 查看器），动作坞按当前资产类型和模型能力展示可用派生动作（局部重绘 / 扩图 / 图生视频 / 图生 3D）。

---

## 六、 分阶段实施路线图

| 阶段 | 里程碑 | 验收标准 |
| :--- | :--- | :--- |
| **Phase 1：独立客户端上线（图片 + 云端 GPU）** | 1. 建新仓 `aigc-studio`，迁入 `lib`/`src`/`shared`/`models`/`remote`；<br>2. 实现 `host-context.mjs` 与独立 LLM 客户端；<br>3. 前端切 Vite + 移除 DSH 注入；<br>4. 接入 Electron 主进程、Token 鉴权、托盘与工作区切换；<br>5. 跑通全套单测与 Kaggle/Colab 真机出图。 | 双击安装包启动独立桌面窗口，不依赖 DSH；可切换本地作品目录、配置自有 LLM Key 润色，并在 Kaggle/Colab 上完成文生图/重绘/放大/扩图全链路。 |
| **Phase 2：私有部署 Worker + 协议流式升级 + MCP** | 1. 扩展 `ComputeProvider` 支持 `private-worker`（自建 Linux GPU / Docker 容器直连）；<br>2. 升级二进制流产物回传、HTTP Range 媒体路由与 `/api/events` SSE 进度；<br>3. 导出 `mcp/server.mjs` 供 DSH 与外部 Agent 调用；<br>4. （视硬件需求）接入 `local-gpu`（`nvidia-smi` 探针 + `uv` 隔离环境）。 | 可连接自有 GPU 服务器跑大模型；大文件传输不再受 base64 内存限制；DSH/Cursor 可通过 MCP 直接调用本地工作室出图。 |
| **Phase 3：AI 视频生成与 3D 资产闭环** | 1. `models/*.json` 扩展视频与 3D 模型资产声明；<br>2. Stage 接入视频播放器与轻量伴生工具（首尾帧抽取/片段拼接/超分）；<br>3. Stage 接入 Three.js `.glb` 实时预览器，支持「图片 → 3D」并进入同一版本树。 | 实现「文生图底图 → 一键图生视频 / 一键图生 3D → 版本树统一追溯与导出」的完整多模态桌面工作流。 |
