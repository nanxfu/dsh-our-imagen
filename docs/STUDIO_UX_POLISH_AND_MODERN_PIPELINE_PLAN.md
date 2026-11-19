# 工作台交互语义对齐、双向助手闭环与模型原生参考规划

> **状态**：✅ Phase 0、Phase A、Phase B 与 Phase C 已全部完成（2026-11-18，未发版）。Phase C 遗留项在**阶段十六**收口后，已于**阶段十七**（见 [ROADMAP.md](ROADMAP.md) 第十七节）借助 `dtype` / `cpuOffload` 完成 `FLUX.2 Klein 9B`（L4 实测通过并发布）、`Z-Image-Turbo`、`SANA-Sprint 1.6B`、`Anima Turbo v1.1` 与 `Qwen-Image 2.1` 的现代 DiT 上线（20B 级 `Qwen-Image-Edit-2511` 仍不接入）。  
> **前置基线**：0.13.0（已完成阶段十二「舞台图片处理工具栏解耦」与阶段十三「显式新建绘图、多作品草稿与树状版本管理」）。  
> **核心原则**：UI 保持克制、减少用户参数决策；表单—舞台—助手三向闭环；**不做多模态看图过渡方案**，直接基于图像模型原生能力补齐“参考图与编辑统一体验”；不给 SDXL 堆砌过时外挂技术债。

---

## 一、 背景与第一性原理收敛

经过前十三阶段，工作台已经具备完整的文生图、局部涂抹、整图重绘、版本派生树（`⎇ N`）与 Agent 对话调用能力。在进一步审视日常创作链路后，本阶段聚焦解决四类核心问题：

1. **“带图创作”入口断裂与双能力未分层**：
   - 当前左栏回归纯文生图后，缺少外部本地图片的导入/拖入入口（新建画布与浏览态都无法直接导入电脑图片）；
   - 底层尚未区分**「原地像素改图（`img2img` / `inpaint`）」**与**「现代模型原生参考生新图（`reference`）」**两条路径：SDXL 系只适合前者（锁定原图比例、`strength` 控制），而仓库已内置的 `FLUX.2 Klein 4B` 目前仅接了纯文生图管线，尚未释放原生参考能力。
2. **交互语义与动作颗粒度尚未完全对齐**：
   - 舞台上的「生成变体 (`reroll`)」实际行为是“抄文字参数、换随机种子纯文生图”，与“变体”名不副实；舞台上的「带回参数 (`iterate`)」与点击胶片条自动回填高度重叠；画廊卡片同时存在切页面、盲发后台请求、放大预览等不同颗粒度按钮。
   - 在创作页选中已有作品并在左栏修改提示词/参数时，缺少“自动派生为新草稿、可自由切回看原图设置、可一键还原原图”的完整闭环（目前 `dirty` 会锁死胶片条回填）。
3. **表单、舞台与对话助手尚未真正打通**：
   - 参数表单一次生成 4 张图时，助手线程（`useChatThread.js` 的 `bubblePatch`）只展示第 1 张缩略图；
   - 舞台图片工具（`useImageTool`）的动作没有镜像同步进助手；
   - 点击助手里的结果图无法进入“单图聚焦上下文 + 返回上一层”的逐层迭代体验。
4. **动作坞后处理闭环仍有缺口**：
   - `IMAGE_TOOLS` 中已预留的 `upscale`（高清放大）与 `outpaint`（扩图）尚处于规划占位状态。

---

## 二、 统一产品交互与语义规范

### 2.1 「带图创作」统一心智与版本树边界（`src/logic/lineage.js`）

从用户视角，“带图创作”只有一个起点（选中已有作品或导入本地图片），底层按**“是否有当前画布的像素级继承”**清晰分流为两类，避免参考生图污染版本树：

| 创作意图 | 入口与交互位置 | 输出版本归属 | 说明 |
| :--- | :--- | :--- | :--- |
| **原地改图（Edit）** | 舞台动作坞（`局部涂抹` / `整图重绘` / `扩图` / `高清放大`） | **派生子版本（`v2a` / `v2b` ...）** | 尺寸跟随原图，写入 `sourceImage` + `rootImage` 与加工类型，纳入同一棵版本树并支持「拉帘对比原图」。外部图片导入为舞台底图时，该导入图即为该树的 **`v1`**。 |
| **参考生新图（Reference）** | 左栏参考图槽（支持 1~N 张导入图或从舞台/画廊「设为参考图」送入） | **独立新根（`v1`）** | 保持左栏纯文生图自由度（自由改提示词、自由选 `16:9 / 9:16` 画幅、批量抽 `1~4` 张）。多图参考或跨场景创作不挂入参考图版本树，仅在 `meta.json` 记录 `referenceSources` 用于溯源与一键复现。 |
| **纯文生 / 重新生成** | 左栏提交 / 动作坞「重新生成」/ 助手新生成 | **独立新根（`v1`）** | 同参数换随机种子重抽，新构图不挂进原图版本树。 |

### 2.2 本地图片导入持久化与拖放交互规范

1. **外部图片导入落盘（统一资产模型）**：
   - 新增宿主导入接口（`POST /imagen-api/import`）：复用 `LIMITS.reference` 校验（PNG/JPEG 魔数、体积、最小长边），落盘至工作区输出目录（如 `imagen-output/imports/`）并标记来源为 `import`（不计入 AI 生成计数，可单独筛选或展示 `导入` 角标）。
   - **架构收益**：外部导入图与 AI 生成图拥有完全一致的 `{ path, url, width, height }` 结构，全链路直接复用 `useImageTool`、多作品草稿 `workDrafts`、版本树 `v1 → v2`、拉帘对比与页面刷新恢复，无需在队列和前端维护两套 `base64` / `path` 旁路。
2. **场景 A — 新画布（`workspaceMode === 'new_draft'`）空态**：
   - 舞台中央取景框提供简洁提示：**「写提示词，或拖入图片」**（支持拖拽、点击选择、剪贴板粘贴）。
   - 拖入图片后按落点与动作自然分流（且两者可一键互转）：
     - **拖入舞台画布（或选择“作为底图编辑”）**：图片落盘为 **`v1`** 并切入工作台展示，底部立即展开动作坞（涂抹 / 重绘 / 扩图 / 放大），加工产出 **`v2`**；动作坞同时提供 **`「设为参考图」`** 按钮可随时将其送入左栏参考槽。
     - **拖入左栏参考区（或选择“作为参考图”）**：图片挂载进左栏参考槽，工作区保持 `new_draft` 取景框态，用户自由填写提示词与画幅后点生成，产出新的 **`v1`** 作品。
3. **场景 B — 浏览已有作品（`workspaceMode === 'work'`）时拖入图片**：
   - **非编辑态（普通预览作品 `A`）**：
     - **拖放到左侧参数栏（参考区）**：将新图片 `X` 挂载为左栏参考图，右侧舞台保持展示 `A` 作对照不打断浏览；左栏随后改词/提交按“草稿托管”流转。
     - **拖放到右侧舞台画布**：导入 `X` 并切换舞台焦点至 `X`（作为新的独立 `v1` 打开预览/准备编辑）；原有作品 `A` 如有未提交编辑，由 Stage 13 的 `workDrafts` 自动保留，零丢失。若用户误拖到舞台其实想作参考，点击动作坞「设为参考图」即可一键送入左栏。
   - **正在编辑态（`editorOpen === true`，局部涂抹或整图重绘打开中）**：
     - **舞台画布锁定拒接拖入替图**，给予轻提示（如「请先退出或暂存当前涂抹」），防止手滑覆盖正在涂抹的蒙版草稿；左栏参考槽（若模型支持且面板可用）仍可正常挂载。
4. **不支持参考生图的模型降级引导**：
   - 当左栏参考槽挂有图片，但用户当前选择的是不支持原生参考能力的模型（如 `SDXL` 系或 `Anima`）时，参考区明确提示「当前模型不支持原生参考生图」，并提供一键切换至支持参考的模型（如 `FLUX.2 Klein 4B`）或提示改为使用舞台「整图重绘」。

### 2.3 术语、入口与画廊颗粒度收敛

| 入口位置 | 调整前 | 调整后（对齐方案） | 行为与语义说明 |
| :--- | :--- | :--- | :--- |
| **舞台动作坞 (`ImageDock`)** | `生成变体`、`带回参数` | 改名为 **`重新生成`**；**下线 `带回参数`**；新增 **`设为参考图`**（Phase C 接通原生参考时亮起） | `重新生成` = 使用当前作品提示词与参数、随机种子新抽 1 张纯文生图（产生新 `v1`）。点胶片条已自动回填，不再保留多余的「带回参数」按钮。 |
| **画廊卡片 (`GalleryCard`)** | `带回参数`、`生成变体`、`以此图重绘`、`查看大图`、`删除` | 收敛为：**`在工作台打开`**（点卡片图片亦同）、**`重绘编辑`**、**`查看大图`**（+ 收藏星标 / 删除） | **画廊不直接盲发后台生图请求**。所有后续创作与编辑动作统一在切回工作台并呈现进度流水线后执行，颗粒度完全统一。 |

### 2.4 左栏表单草稿流转与「还原原图」闭环

解决“改了一个词既不知道算不算新作品，又导致点回原图/其他图看不了原本设置”的卡点：

1. **查看作品 = 只读原图真相**：点击底部胶片条任意作品 `A`，舞台展示 `A`，左栏加载 `A` 的原始参数（干净基准）。
2. **一改词 = 自动托管进最左端「新建草稿卡」**：
   - 一旦在左栏修改 `A` 的任意提示词或参数（或挂载左栏参考图），底部作品条最左端（复用 Stage 13 的 `newDraftCard` 位置）自动亮起 **`[ 未提交草稿 ]`** 卡片并实时托管该草稿。
   - 左栏顶部状态条显示：`正在新草稿中编辑（源自此图）`，并常驻轻量 **`[ 还原原图 ]`** 按钮（放弃当前改动，立刻恢复 `A` 的原始参数并清除左端草稿）。
   - *防闪跳细节*：正在 `A` 上输入修改时，右侧舞台保持展示 `A` 作为对照参考，不突然跳成空白取景框。
3. **自由看原图、不丢草稿**：
   - 因未提交修改已被左端「新建草稿卡」接管，此时点击胶片条上的 `A` 或 `B`，**系统不再拦截回填**——舞台与左栏安心展示 `A`/`B` 的真实原图与原始参数；
   - 点击最左端「新建草稿卡」，即切回新建取景画布并恢复刚才改到一半的草稿继续编辑或点生成发布；点草稿卡上的关闭/放弃即可丢弃草稿。

### 2.5 跨面板双向时间线、单图钻取与「返回上一层」

把左侧助手页从“纯文字聊天框”升级为**“全工作台双向时间线 + 聚焦导航”**，同时严格保护大模型多轮上下文不被污染：

1. **多图网格反馈**：参数表单（或助手）一次生成 1~4 张图时，助手消息气泡（`bubblePatch`）完整接收全部结果图，以 **1~4 格缩略图网格** 呈现（修复目前只取 `images[0]` 的截断）。
2. **点击钻取与顶部返回条**：
   - 在助手网格中点击任意一张图（如第 3 张），右侧舞台同步选中该图，左侧助手进入针对该图的**单图聚焦上下文**；
   - 助手面板顶部出现轻量面包屑返回条（如 **`← 返回上一层（4 张生成结果）`**），支持点击逐层回到上一级结果网格或父版本，右侧舞台同步切回对应节点。
3. **舞台动作镜像同步**：
   - 在舞台发起「局部涂抹 / 整图重绘 / 高清放大 / 扩图」并提交后，助手线程自动追加一条镜像动作记录（含底图缩略图与动作说明，如 `对当前图发起了 局部涂抹`）和一条任务反馈气泡；
   - 生成完成后，助手气泡展示新版本图（`v2`）并附带**极简后续动作胶囊**（`对比原图`、`继续涂抹`、`高清放大` 等），点击结果图可继续向下钻取。
4. **上下文隔离约定**：
   - 表单同步卡与舞台镜像动作卡继续带有独立 `kind` 标记，**不进入**发给意图大模型的纯文本历史（`intentHistory()`），避免污染对话推理。

---

## 三、 模型能力分层与算力适配策略

### 3.1 借用 DSH 宿主大模型原则（聚焦现有文本能力）

* **唯一通道**：提示词润色、英译与对话意图解析继续复用 DSH 宿主提供的模型服务（`ctx.get('llm')` + `ctx.get('agentDefaultModel')`），不引入第三方 API 配置，**也不将宿主 LLM 用于“看图反推提示词”的参考图过渡**。
* **前置排查项（已定位并修复，结论与最初假设不同）**：「润色 / 转为英文」静默退回本地兜底的根因**不是** Cordis `inject` 未声明（`ctx.get()` 本身不要求注入清单，实测服务能取到），而是调用请求缺少宿主路由要求的会话标识：opencode-go 等路由要求 `x-opencode-session`，宿主适配器只在 `GenerateOptions.sessionId` 存在时补头，缺失时请求以 400 `MissingSessionID` 失败、流里没有正文。修复与验证细节见 [ARCHITECTURE.md §2.23](ARCHITECTURE.md#223-宿主模型通道的请求约束)。

### 3.2 模型原生参考能力（`supportsReference`）与算力基线

* **硬件基线约束**：Kaggle 默认提供 `2×Tesla T4`（16GB×2 Turing 架构，支持 `fp16`，无原生 `bf16`/`fp8` 硬件加速，容器约 20GB 可写空间）；规划中的路线图十四（Google Colab Pro `L4 24GB / A100 40GB`）则支持 `bf16`/`fp8` 与大显存单卡。
* **推理层能力显式拆分（不混用）**：
  1. **`supportsImg2Img` / `supportsInpaint`（SDXL 系）**：保留用于像素级局部涂抹与整图重绘，走 `AutoPipelineForImage2Image` / `AutoPipelineForInpainting`，受 `strength` 控制且尺寸跟随原图。停止为 SDXL 新增 IP-Adapter / ControlNet 插件栈。
  2. **`supportsReference`（现代 DiT 原生参考，首期载体 `FLUX.2 Klein 4B`）**：
     - [flux2-klein-4b.json](file:///d:/document/development/our-free-imagen/models/flux2-klein-4b.json) 在 `2×T4` 上 `fp16` 纯文生图峰值约 `7929 MB`、4 步出图 ~10.2 秒；
     - 在推理层走基础管线直接接收单图/多图 `image` 条件（不经过 `AutoPipelineForImage2Image`，不使用 `strength`），完整保留用户指定画幅与 `width`/`height`；
     - **前置真机门禁**：必须先在 Kaggle `2×T4` 实测 `Flux2KleinPipeline` 传入 1~N 张参考图时的显存峰值、耗时与参考图分辨率/数量上限，再锁定契约参数。
  3. **高阶算力储备模型**：Kaggle T4 阶段可评估 `Z-Image-Turbo`；路线图十四（Colab Pro `L4 24GB / A100 40GB`）已落地，可在此大显存基线上顺势引入 **`FLUX.2 Klein 9B`**、**`Qwen-Image-Edit`**（高保真多图一致性与无蒙版指令修图）以及 **`FLUX.1-Fill-dev`**（大显存下的原生掩码补全/扩图）。
  4. **架构无关后处理与扩图演进路线**：
     - 超分（`upscale`）独立于扩散底座（Real-ESRGAN `RRDBNet x2`）；
     - 扩图（`outpaint`）Phase B 基线由前端扩展画布与蒙版，远端复用已验证的 `sdxl-inpaint` 9 通道管线；
     - **现代扩图演进（Phase C / 大显存备选）**：`FLUX.2 Klein 4B` 原生主打文生图与多参考图一致性编辑（`Flux2KleinPipeline` 暂不直接接收二值 mask 参数；若直接喂填充画布加通用提示词，模型易将整张画布当作新构图而缩放/位移原图主体并产生边线）。因此在 **Phase C1** 打通 `Flux2KleinPipeline` 图像条件通道后，可顺手验证 **`FLUX.2 Klein 4B + Outpaint LoRA`**（如 `fal/flux-2-klein-4B-outpaint-lora`，通过特定边界填充 + 触发词锁定原图空间位置、4 步约 10s 推理，峰值 < 8 GB 可跑在 Kaggle 2×T4 上），替代耗时 35s 且色温易漂移的 `sdxl-inpaint`；在 Colab `L4 / A100` 上则可进一步评估 `FLUX.1-Fill-dev` 或 `FLUX.2 Klein 9B` 扩图。

---

## 四、 分阶段实施路线（Phase 0 → A → B → C）

### Phase 0：宿主 LLM 通道诊断与修复（地基清理）——✅ 已完成

* **目标**：确保「润色」「转为英文」「对话意图解析」在真实 DSH 环境中稳定调用宿主默认大模型。
* **已完成的工作**：
  - `lib/llm.js` 每次调用补 `sessionId`（按 `purpose` 合成的固定路由 id）——修复 400 `MissingSessionID` 导致的静默降级；
  - 流式分片只收 `text-delta` 正文，`reasoning-delta` 思考过程不再污染润色 JSON / 英译首行；
  - 结构化短输出默认选模型支持的最低思考档（`off` → `minimal` → `low`），降低等待时间；
  - 失败原因（服务缺失 / 无默认模型 / `prepareCall` 异常 / 空流 + `finish` 失败码）以 warn 写入宿主日志，每次调用记 `llm_call provider=… model=… purpose=…`；
  - 用独立宿主进程（`dsh --profile headless|web --patch`）在真实 provider 上复验 `enhancePrompt` / `parseIntent` 均返回 `source=model`，离线测试新增两条 `llm` 用例。

### Phase A：交互语义收敛、本地导入与双向时间线 —— ✅ 已完成（2026-11-18）

> **实现说明**（与下方原始分期一致，三条线同批落地；交互规范见 [SPEC.md](SPEC.md) §5.19，变更明细见 [CHANGELOG](../CHANGELOG.md)）。
>
> - **A1 动作语义与草稿托管**：`ImageDock` 下线「带回参数」，「生成变体」改名「重新生成」；`GalleryCard` 收敛为「在工作台打开 / 重绘编辑 / 查看大图 / 收藏 / 删除」并移除盲发生成。胶片条点击不再被未提交修改拦截：脏修改先托管进最左端草稿卡（「未提交草稿 · 源自此图」），再回填目标作品；左栏显示「正在新草稿中编辑（源自此图）」+「还原原图」；点草稿卡恢复草稿并切新建画布焦点；提交 / 新建创作正确清理。纯逻辑落在 `src/logic/form.js`（`draftSourceOf` / `originalPatchOf` / `parkDraftOf` / `draftViewOf`）与 `previewRecallOf`。
> - **A2 双向时间线**：`bubblePatch` 接收全部 1~4 张结果图，`ChatPanel` 以缩略图网格渲染（单张保持原观感）；`useImageTool` 提交成功后由组合层调用 `chat.mirrorTool` 追加镜像动作记录与任务气泡；点击结果图进入单图聚焦视图（大图 + 参数胶囊 + 对比原图 / 继续涂抹 / 重新生成 / 查看大图），顶部「← 返回上一层（{label}）」逐层出栈。镜像 / 同步 / 结果记录都带 `kind`，不进入 `intentHistory`。纯逻辑在 `src/logic/chat.js`。
> - **A3 本地导入与对比**：新增 `POST /imagen-api/import`（`shared/contract.js` 的 `ROUTES.importFile` / `IMPORT`），PNG / JPEG 校验后原样落盘为独立 `v1`，`HistoryItem.source` 区分 `ai` / `import`，作品条与画廊显示「导入」角标；舞台支持拖入 / 粘贴 / 选择图片，新画布提示「写提示词，或把图片拖入取景框」，编辑态拒绝导入；新增 `lib/image-meta.js` 写入 PNG `tEXt` 生成元数据（失败退回原字节），导入自带元数据的 PNG 时恢复原生成参数。带 `sourceImage` 的派生作品提供可拖动「对比原图」拉帘（`useStudioUi.compareOpen`）。
> - **测试**：新增 `check-client-draft`（4）、`chat-timeline`（5）、`import-client`（18）、`import-host`（17）；`check-client-chat` 19、`check-client-shell` 51、`check-client-logic` 83、`check-client-tools` 27、`image-tool-render` 6、`host-e2e` 56、`jobs-wait` 31、`check-contract` 12；`npm test` 36 步全绿。

* **目标**：理顺“草稿/原图/重新生成/画廊”语义，打通本地图片导入与表单—舞台—助手三向协同。
* **Phase A1（语义对齐与草稿闭环）**：
  - `ImageDock` 下线「带回参数」，「生成变体」统一改名「重新生成」；
  - `GalleryCard` 动作收敛为「在工作台打开」「重绘编辑」「查看大图」（及收藏/删除），移除画廊原地盲发生成；
  - 左栏编辑自动托管进最左端「新建草稿卡」，增加「源自此图 · 还原原图」并解除切换胶片条看原图设置的锁定。
* **Phase A2（双向时间线与聚焦返回栈）**：
  - `useChatThread` 支持 1~4 张图网格反馈卡；
  - `useImageTool` 提交/完成镜像同步至助手线程，结果卡带快捷后续动作胶囊；
  - 实现点击图钻取单图上下文 + 顶部 `← 返回上一层` 导航栈，严格不污染 `intentHistory`。
* **Phase A3（本地导入落盘、拉帘对比与拖入行为基础）**：
  - 新增 `POST /imagen-api/import`（魔数/体积/尺寸校验，落盘至工作区并标为 `import`），支持新画布提示「写提示词 / 拖入图片」及浏览态拖入舞台打开编辑（含涂抹/重绘中的编辑态保护）；
  - **拉帘对比原图**：所有带有 `sourceImage` 的 `v2` 派生版本（无论原图来自生成还是导入）提供交互式对比滑块；
  - **PNG 元数据写入与读取**：Host 写入标准 PNG `tEXt` 元数据块，拖入本地图片时若含有效元数据支持一键还原参数。

### Phase B：图像后处理闭环（点亮 `upscale` 与 `outpaint`）—— ✅ 已完成（2026-11-18）

> **实现说明**（与下方原始分期一致；交互规范见 [SPEC.md](SPEC.md) §5.20，远端协议与 Agent 工具见 §2.2 / §3.7，
> 变更明细见 [CHANGELOG](../CHANGELOG.md) 的 0.13.0 条目）。
>
> - **B1 高清放大（`upscale`，`instant`）**：新增 `remote/inference/upscale.py`——自包含 Real-ESRGAN
>   `RRDBNet(x2)`（conv_first 12 通道 + pixel_unshuffle + 23×RRDB + 两次 nearest 上采样），**不引入
>   basicsr / realesrgan**（避免与新版 torch 冲突）。权重固定 HF 镜像（GitHub Release 兜底），下载边写边算
>   SHA256（`67061725` 字节 / `49fafd45…abb`），`.part` + 失败自动换源；CUDA fp16、奇数宽高 reflect pad
>   后裁回、执行结束卸载模型并 `empty_cache`。远端 `POST /generate` 新增 `tool: 'upscale'`
>   （只读源图头、不读 pipeline / loader 白名单、不允许蒙版），`Job.tool` 与公开载荷透传；Host
>   `JobQueue` 按 tool 分派（固定 1 张、无 preset/steps/seed 语义、沿用同一套轮询与幂等重投），
>   产物 `meta.json` 写 `upscale` / `upscaleScale` / `upscaleSource`，`/history` 恒存在透传。
>   客户端动作坞点「高清放大」零参数即时提交（不进入编辑态），源图长边 > `UPSCALE.maxInputEdge`（1280）
>   时前置拦下，产物作为源图子版本进入版本树并镜像到助手线程。新增 Agent 工具 `imagen_upscale`
>   （`path` 必须是 `imagen-output/` 内作品）。
> - **B2 扩图（`outpaint`，`canvas`）**：**不新增远端推理能力**——客户端把原图放进更大的画布、把新增区域
>   涂白生成蒙版，再按普通局部重绘提交，远端复用已验证的 `sdxl-inpaint` 9 通道管线。新增
>   `src/logic/outpaint.js`（四边扩 20% 与 16:9 / 9:16 / 4:3 两种模式、锚点分配留白、8px 对齐、
>   `maxEdge`（1536）/ `maxPixels`（1.6 MP）/ `minEdge`（256）约束）与
>   `src/studio/stage/OutpaintEditor.jsx`（比例胶囊、扩张画面预览与新增区斜纹着色、内容框拖拽 /
>   方向键 8px / 双击与「回中」复位、导出画布 + 白边蒙版）；`ToolSubmitBar` 覆盖率读数在扩图下改为
>   「新增画面 N%」。Host `normalizeReference` 支持 `image` 来源携带 `sourcePath` 溯源，
>   `meta.outpaint = true` 且 `sourceImage` / `rootImage` 指回原图，扩图产物直接挂进原图版本树。
>   `imagen_outpaint` 本轮不提供 Agent 工具（画布合成需要像素级处理，Host 保持零图像依赖），
>   评估结论写在 SPEC §3.7。
> - **契约与版本树**：`UPSCALE` / `OUTPAINT` / `REQUEST_TOOLS` 进入 `shared/contract.js`，
>   `daemonContract().limits.upscale` 下发远端、`PROTOCOL.daemon.requestTools` 登记远端取值域；
>   `Job` 增加 `tool` 字段，`HistoryItem` 增加 `upscale` / `upscaleScale` / `outpaint`；
>   `LINEAGE_KINDS` 增加 `upscale` / `outpaint`，版本面板与助手镜像同步支持四类工具。
> - **测试**：新增 `test/outpaint.mjs`（16）与 `test/remote/test_upscale.py`（49）；`image-tool`
>   19 → 25、`image-tool-render` 6 → 11、`lineage` 17 → 18、`check-client-logic` 83 → 84、
>   `host-e2e` 56 → 60、`jobs-wait` 31 → 35、`agent-batch` 17 → 18、`test/remote/run.py` 391 → 440；
>   `npm test` 38 步全绿。
> - **真机验收（Kaggle 2×T4，3 轮全过）**：1024² → 2048²（加载 2.25s / 推理 1.45s / PNG 4.01 MB，
>   `allocated_mb` 7000→7000、`max_allocated_mb` 不变，模型卸载后 `reserved` 反降 3746 MB；
>   Laplacian 方差 59.8 vs 双三次 13.4）；1280×720 → 2560×1440 上限档（推理 1.32s，4.84 MB
>   base64 响应约 3.2s 取回、低于 8s 轮询超时）；`sdxl-inpaint` 扩图 864² 内容 → 1536×864 画布
>   （覆盖率 43.75%、30 步 35.4s、输出 1.67 MB，保留区核心像素差 0.00/255、无硬接缝，
>   显存峰值 9715 MB < 14.56 GB，无 OOM）。

* **目标**：激活舞台动作坞预留的两个工具位，补齐从“初稿生成”到“成片交付”的完整链路，并接入 Agent 工具。
* **Phase B1 — 一键 2× 高清放大（`upscale`，`instant` 形态）**：
  - **前端**：动作坞点击「高清放大」零参数直接提交；完成后作为 `v2` 挂载进版本树，支持「拉帘对比原图」；
  - **远端**：接入轻量超分推理路径（如 Real-ESRGAN / Swin2SR），执行完毕按需释放显存；
  - **真机验收**：在 Kaggle `2×T4` 验证文生图 → 2× 高清放大的显存峰值、耗时与恢复能力。
* **Phase B2 — 快捷比例扩图（`outpaint`，`canvas` 形态）**：
  - **前端**：进入扩图画布态，顶部提供零计算快捷比例胶囊（`16:9` / `9:16` / `4:3` / `四边扩 20%`）与画框微调手柄，自动构造扩展画布与羽化蒙版；
  - **远端**：优先复用已验证的 `sdxl-inpaint` 9 通道管线，按 8 对齐像素提交并产出 `v2`；
  - **Agent 工具**：评估在 `lib/tools.js` 补齐 `imagen_upscale` / `imagen_outpaint` 工具。

### Phase C：模型原生参考生图（直通 `FLUX.2 Klein` 与左栏参考交互）—— ✅ 已完成（2026-11-18）

> **实现说明**（与下方原始分期一致；交互规范见 [SPEC.md](SPEC.md) §5.21，接口与真机数据见 §4.3 与 [CHANGELOG](../CHANGELOG.md)）。
>
> - **C0 状态同步与焦点同源收口**：`useStudio` 新增 `recallTarget()` 统一「按需托管 dirty 草稿 → 回填参数与 `origin` → 退出画布编辑态（按路径保留 `workDrafts`）」；裸导入图 / 空白新建画布解除上一张作品绑定（`detachOrigin`），导入自带 PNG 元数据时回填原参数；助手结果图走 `openPath()` → `previewWork` 同口径；`restoreOriginal` 来源缺失时切回新建取景框并提示；删除作品经 `onImagesRemoved` 级联清理草稿与来源引用。`generate.js` 把 `inpaintOnly` / 已下线预设统一按非扩散产物处理（沿 `sourceImage` 回溯，否则降级补丁），专用预设不再污染纯文生图表单。渲染卫生：`useNow` 下沉到 `PipelineBar` / `Filmstrip` 叶子、编辑器与拉帘补 `key`、`percentOf` / `positiveSize` 收敛到 `src/logic/format.js`。
> - **C1 契约、能力与远端参考分支**：`LIMITS.referenceImages`（maxCount 2 / 4 MiB / maxEdge 1024 / minEdge 128）+ `PROTOCOL.daemon.referenceImages`；模型资产新增必填 `supportsReference`（仅 `flux2-klein-4b`，与 `supportsImg2Img` 互斥）；Host 请求 `references: string[]` → job 级 `referenceImages: [{image_b64}]`，远端提交期只读图片头、执行期整批解码一次，`run_task` 以基础管线 `image=[PIL...]` 条件出图且宽高严格取请求值；`meta.json` 写 `referenceSources` 并由 `/history` / `/history/tree` 透传（独立新根，不进版本树）。`flux2-klein-4b` 资产修正 `variant=null` + 组件 `allowPatterns` 白名单（跳过 7.75 GB 单文件重复副本）+ `downloadGb 16.0`，白名单在真机首次即加载成功。新增 `pipeline.accel` 加速开关脚手架（缺省逐字不变、fuse 幂等）。
> - **C1 真机结论**：参考生图 1 张约 20~21s、2 张约 40s（纯文生图稳态 8.6s），同 seed 两轮逐像素一致，1280×720 画幅保持通过，显存全程无增长；参考条件为**弱参考**（有参考 vs 无参考 MAE 7.71/255，prompt + seed 主导），产品文案不承诺强一致。P0 加速（`channels_last + fuse_qkv`、`vae_tiling`）实测为「提速不显著 / 画质不一致 / 扩图反而变慢」，**全部不合入默认路径**，模型资产不启用 `pipeline.accel`；原生 `Flux2KleinInpaintPipeline` 可加载但因 1 MP 画布上限与 4 步接缝质量，本轮不迁移默认扩图引擎。
> - **C2 左栏参考图槽与交互**：新增 `src/logic/reference.js`（槽位增删 / 去重 / 上限 / 路径归一 / 能力门控 / dirty 指纹 / 请求体拼装）与 `src/studio/rail/ReferenceSection.jsx`（提示词之后、画面设置之前；空态 / 1~2 张网格 / 单张移除 / 满额提示 / 从作品选择 / 拖入本机图片经 `/import` 落盘后入槽 / 弱参考提示）；不支持参考的预设就地提示并给「切换到 FLUX.2 Klein 4B」与「改用整图重绘」，生成前拦下（不发请求、不静默丢图）；动作坞复用组新增「设为参考图」；助手生成经同一 `buildBody` 自动携带参考槽；参考槽计入表单 dirty 指纹并随新建创作 / 还原原图 / 回填清理。字典 zh/en 各 616 键同构。
> - **C1 遗留（阶段十六收口）**：`Flux2Loader` 支持 `pipeline.lora`（预挂载 / `hf_hub_download` / `set_adapters`，离线 15 项断言）；`test/gpu-live.mjs --outpaint-lora` 在 Kaggle 2×T4 完成 `flux2-klein-4b + fal Outpaint LoRA` 真机评估——加载 33.8s / 推理 22.5s / 输出严格 1536×864 / 绿边残留 0.00% / 接缝比 1.14~1.15 / 内容区色偏 max 3.47，对比 `sdxl-inpaint` 历史中位 **提速 1.57×**；因内容区为整图重绘（平均差 12.87/255）不满足「扩图保留原图」的像素保真语义，**决策不迁移默认引擎**，列为下一阶段首选候选。P1 缓存（FBCache）真机探针得到 `[accel] WARN cache 不适用：block 输出形状混合`（两档输出逐像素一致、显存同为 7928 MiB，中位 1.17× 属冷启动噪声），SDXL 家族为 UNet 无 transformer，**P1 缓存不成立、不合入**；Colab L4 `torchao` FP8 经预算评估无合入价值（9B fp8 transformer + 15.26GB 文本编码器仍超 L4 可用显存）。详见 [INFERENCE_ACCELERATION_RESEARCH.md](INFERENCE_ACCELERATION_RESEARCH.md) §4.4。
> - **C2 遗留（阶段十六收口）**：新增 `providers` 算力来源能力位（资产可选字段 + 构建校验 + 客户端模型卡置灰 + `generateCapabilityOf` 的 `blockedProvider` 预检 + Host `providerGateOf` 兜底）；`flux2-klein-9b`（9.08B distilled / 4 步 / CFG 1.0 / 组件权重 32.32 GiB / HF 受限仓库 / FLUX NCL）的资产草稿与 Colab 验证脚本已就绪，但 **Colab A100 真机验证受容量限制（assign 持续 503）未取得 measured，按 SOP 本轮不发布模型资产**；**Qwen-Image-Edit-2511 本轮不接入**——BF16 全量 53.76GiB 超出 2×T4 / L4 / A100-40GB 全部预算，社区 FP8 单文件 + BF16 文本端仍约 34.6GiB，重启条件为单卡 ≥80GB 或自研量化运行时。详见 [ROADMAP.md](ROADMAP.md) 第十六节。
> - **测试**：新增 `test/reference.mjs`（17）、`test/remote/test_reference_images.py`（36）、`test/remote/test_flux2_lora.py`（15）、`test/remote/test_accel_cache.py`（21）、`test/check-client-provider.mjs`（5）；`check-client-logic` 90 → 93、`check-client-shell` 53、`check-client-draft` 11、`image-tool-render` 14、`check-contract` 14、`jobs-wait` 40、`host-e2e` 63、`test/remote/run.py` 476 → 518；`npm test` 全绿。

* **目标**：基于模型原生能力实现极简的“参考生新图（自由换场景、换画幅、批量抽卡）”与同主角批量分镜，同时收口 Phase A / B 检阅发现的状态同步与后处理遗留问题。
* **Phase C0 — 状态同步漏洞与 Phase B 检阅遗留收口（顺手必修）**：
  1. **工作台焦点与左栏表单 / 来源同源收口**（修复导入图 / 新建草稿卡残留上一张作品参数及同源切换漏洞）：
     - **裸导入图 & 刚导入完成（`previewWork` / `activateImport`）**：切到无生成参数的本地导入图时（`isBareImportOf`），若当前表单 `dirty` 须先 `parkDraft()` 托管，再**清空绑定到上一张作品的 `prompt`、`seed`、`origin`**（保留当前模型与常用画幅），避免左栏继续显示上一张生图作品的参数和「正在微调」状态；导入自带 PNG `tEXt` 元数据的图片时，完成导入后同步回填参数。
     - **点「新建草稿卡」（`focusNewDraft`）**：当不存在已托管草稿且当前不脏（`draft === null && !dirty`）时，若当前左栏表单仍绑定着某作品的 `origin`（刚浏览过历史作品），切回空白新建取景框时须同步重置 `prompt` / `seed` / `origin`（调用 `newCreationPatch` 级清理，保留预设与画幅），不得把上一张浏览作品的提示词、固定种子和「正在微调」带进新画布。
     - **助手点击结果图（`ChatPanel.openPath` / `library.openMessage`）**：改为走与胶片条同口径的 `previewWork`（先按需托管 `dirty` 草稿、再回填目标图参数与 `origin`），消除图文不同步。
     - **切换作品 / 还原原图时退出画布编辑态**：`previewWork` 与 `restoreOriginal` 入口统一调用 `imageTool.closeTool()`（按路径保留 `workDrafts`，仅收起当前画布编辑态，符合 [SPEC.md §5.17](SPEC.md)）；`restoreOriginal` 找不到已删来源图时给出提示或安全收口，不发生图文错位。
     - **删除作品级联清理（`useWorkLibrary.deleteImages`）**：按 `removed` 路径清理对应 `imageTool.workDrafts` 与表单 `origin` / `draft.source` 引用；若删掉了当前预览作品并回退到下一张图，同步刷新左栏回填。
  2. **衍生作品回填与重新生成过滤（`src/logic/generate.js`）**：
     - ✅ **已完成（`dd3ade4`）** **高清放大（`upscale`）**：`isNonDiffusionRecallOf` / `diffusionSourceOf` 已沿 `sourceImage` 回溯父作品扩散参数，父作品缺失时走降级补丁（合法预设 + `upscaleSource`/钳制尺寸 + 推荐步数），不再将 `realesrgan-x2plus` / `steps: 0` / `2048px` 写入表单或生成请求。
     - ✅ **已完成（`58ed11b`，本轮复核确认）** **`inpaint` / `outpaint` 的 `inpaintOnly` 预设过滤**：当 `item.presetId` 为 `inpaintOnly`（如 `sdxl-inpaint`）时，回填左栏纯文生图表单不写入该不可用预设（避免左栏模型选择器显示空白未选中态）；实现落在 `src/logic/generate.js` 的 `isNonDiffusionRecallOf` / `diffusionSourceOf` / `iteratePatch` / `rerollOverrides`——沿 `sourceImage` 在已加载历史里回溯父作品的真实扩散参数（最多 8 层、防成环、跳过裸导入父作品），父作品缺失时走降级补丁（合法扩散预设 + 钳制尺寸 + 推荐步数/CFG + 随机种子），绝不把 `sdxl-inpaint`、0 步或超限尺寸带进表单或生成请求。用例见 `test/check-client-logic.mjs` 的「阶段十五 Phase C0：局部重绘 / 扩图产物的 inpaintOnly 预设过滤」一节（回填、重新生成、降级选模、链式回溯）。
  3. ✅ **已完成（`dd3ade4`）** **Phase B 扩图画质与拉帘对齐收口**：
     - ✅ **统一扩图画布填底为边缘像素延拓（edge-clamp）**：`outpaintEdgeStripsOf` + `OutpaintEditor.jsx` + `test/gpu-live.mjs` 已统一为边缘像素延拓并完成真机复验（逐像素比对 0 差异）。
     - ✅ **扩图「对比原图」拉帘子矩形对齐**：契约 `OUTPAINT.content` / `reference.outpaintContent` / `meta.outpaintContent` / `/history` 透传与 `CompareSlider.jsx` 百分比子矩形定位均已落地通过。
  4. **React 架构与渲染卫生顺修（高 ROI 项）**：
     - **焦点协调收口 & 消减被动 `useEffect`**：在 `useStudio` 侧把「退画布编辑态 → 托管旧草稿 → 同步/重置表单与 `origin` → 切舞台与关对比」收口到事件入口（减少 `Stage.jsx` 关对比、`useStudioForm` 同步 `draft`、`useImageTool` 同步 `workDrafts` 这类靠 `useEffect` 二次提交触发的冗余渲染与中间态）。
     - **下沉 `useNow` 1Hz 定时器**：把 `Studio.jsx` 顶层的 `useNow(...)` 下沉到真正读秒/显影判断的叶子节点（`PipelineBar` / `Stage` 对应片段），避免任务等待期间每秒驱动整页重渲染。
     - **补齐组件实例 `key`**：在 `Stage.jsx` 为 `<MaskEditor key={target.path} />`、`<OutpaintEditor key={target.path} />` 与 `<CompareSlider key={...} />` 显式挂 `key`，避免内部 `useState` 残留上一张图的尺寸/加载态。
     - **去重公共小工具**：把在 `Stage.jsx` / `ToolSubmitBar.jsx` / `OutpaintEditor.jsx` / `MaskEditor.jsx` 重复 4 份的 `percentOf` 及多处重复的 `positiveSize` 收进 `src/logic/format.js` 等纯工具模块。
     - *明确不作为本轮重活*：render 内写 `*Ref.current` 的并发安全改造与 `MaskEditor.jsx`（846 行）拆 hook 留作按需专项，不在无功能需求时为洁癖做大面积重写。
* **Phase C1 — `FLUX.2 Klein 4B` 参考能力与 Outpaint LoRA 真机验证与推理抽象** —— ✅ **已完成（Phase C1 主体 2026-11-18；Outpaint LoRA 与 P1 加速于阶段十六收口）**：
  - ✅ 在 Kaggle `2×T4` 实测 `Flux2KleinPipeline` 在 `fp16`（及按需 CPU offload）下单图与多图参考输入的显存峰值、耗时与参考图数量/尺寸安全边界（1 张 20~21s / 2 张 40s，显存无增长，弱参考结论见 §四 C1 真机结论）；
  - ✅ 已评估 **`FLUX.2 Klein 4B + Outpaint LoRA`**（`fal/flux-2-klein-4B-outpaint-lora` + 绿边填充约定）在 2×T4 上的扩图接缝、主体锁定与耗时：推理 22.5s（对比 `sdxl-inpaint` 历史中位 35.31s，**提速 1.57×**）、绿边残留 0.00%、接缝比 1.14~1.15、色偏 max 3.47，但内容区为整图重绘（平均差 12.87/255）；**决策：暂不迁移默认引擎**，数据与理由见 [ROADMAP 十六](ROADMAP.md) §2；
  - ✅ 已按 [INFERENCE_ACCELERATION_RESEARCH.md](INFERENCE_ACCELERATION_RESEARCH.md) 完成 P0/P1 对照：P0（`vae_tiling`、`channels_last + fuse_qkv`）此前已判定不合入；P1（`FBCache` / 多步模型跳步缓存）真机探针得到「flux2 双栈输出形状混合、SDXL UNet 无 transformer，均不适用」，两档输出逐像素一致，**不合入**；Colab L4 `torchao` FP8 经预算评估无合入价值（详见 INFERENCE §4.4）；**未按「验证后同步 README」执行，因为没有任何一项达到合入门槛**；
  - ✅ 在 `shared/contract.js`、`models/*.json` 与 `remote/inference/loaders/` 新增独立能力字段 `supportsReference`（及参考图列表限制，与 `supportsImg2Img` 隔离），打通 `daemon.py` 按 `referenceImages`（保留 `width`/`height`）的文生图推理分支。
* **Phase C2 — 左栏参考槽、拖放分流与批量分镜** —— ✅ **已完成（C2 主体 2026-11-18；大显存模型于阶段十六收口）**：
  - ✅ 左栏顶部参考图槽（1~2 张、从新画布/浏览态拖放挂载、动作坞一键「设为参考图」）；
  - ✅ 所选模型不支持 `supportsReference` 时在参考区提示，并支持一键切到支持模型或跳转舞台「整图重绘」；
  - ✅ 生成产物写入独立 `v1` 根（元数据记 `referenceSources` 用于溯源，不折叠进参考图版本树）；
  - ✅ 对话助手与 `imagen_batch` 支持带参考图的批量分镜生成（助手经同一 `buildBody` 自动携带参考槽；`imagen_batch` 新增公共 `references` 参数，全部条目共用同一组参考图）；
  - ✅ 完成 **`FLUX.2 Klein 9B`** 的接入准备（资产草稿 `.tmp/models/flux2-klein-9b.verified-pending.json` + `providers: ["colab"]` 能力位与工作台 / Host 双层门控）；**真机验证受阻于 Colab A100 容量（assign 持续 503），按 SOP 未取得 measured 的资产不入库，本轮不发布**；**`Qwen-Image-Edit` 本轮不接入**，原因与重启条件见 [ROADMAP 十六](ROADMAP.md) §5。

---

## 五、 工程约束与验收门禁

1. **契约与字典同构**：所有新增路由（如 `/import`）、能力字段（`supportsReference`）、工具类型与参数边界必须先收口至 [shared/contract.js](file:///d:/document/development/our-free-imagen/shared/contract.js)（并同步 `remote/contract.json`）；中英字典（`src/dict/zh.js` / `src/dict/en.js`）保持键集合严格同构。
2. **离线与真机分层门禁**：
   - Phase 0 / Phase A：以 `npm test` 全套离线单测（契约、Host、Client 逻辑与渲染）+ 实际 DSH 环境联调验收为主；
   - Phase B / Phase C：每接入一项远端新推理能力（超分、扩图、`FLUX.2 Klein` 原生参考），必须附带真机实测的耗时、显存占用（`/health.gpu_memory`）与成片质量复核，确认无 OOM 与显存泄漏后合入。
