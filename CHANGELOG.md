# 变更记录

## 未发布（架构重构 Batch 0 / 1 / 2）

> 对应 [docs/REFACTOR_ARCHITECTURE_SPEC.md](docs/REFACTOR_ARCHITECTURE_SPEC.md)。各批都只改内部模块边界、依赖方向与打包形态，`docs/SPEC.md` 定义的 HTTP 路由、报文、错误码与配置注入契约保持向后兼容。

### 改进

- **Kaggle 访问方式默认改为直连**：`SETTINGS.kaggleTransports` 顺序改为 `['direct','cli']`，`defaultKaggleTransport` 改为 `direct`——新用户装完插件即可用内置 OAuth 登录出图，不再需要 `pip install kaggle` 与本机 Python 环境。`kaggle` CLI 保留为设置抽屉里的「兼容」选项（排障或直连不可用时手动切回），传输层仍是每次调用读设置、切换即时生效。
- **设置文件加 schema 版本并迁移**：`settings.json` 写入 `schema: 2`；加载 v1 文件时，`kaggleTransport: 'cli'` 视为当时的默认值丢弃一次（否则老用户升级后永远走不到新默认），其它覆盖项原样保留；用户之后手动切回 `cli` 会以 `schema=2` 落盘并被保留。
- **旧宿主兼容口径与契约默认值解耦**：`/state` 里没有 `kaggleTransport` 字段时（0.8.x 宿主）仍按 CLI 渲染，不指向不存在的登录路由；非法值才回落契约默认值。判定统一收在 `src/logic/probe.js` 的 `transportOf()`，设置抽屉与会话控制共用。
- **文案**：设置抽屉选项改为「直连 Kaggle（默认，免安装 CLI）」/「本机 kaggle CLI（兼容）」；`docs/SPEC.md`、`docs/ROADMAP.md` 同步口径。

### 工程

- **打包器升级（Batch 0）**：`lib/kernel.js` 从 `# @@INLINE` 行替换改为**内嵌 Base64 ZIP 自引导**——新增 `lib/bundle.js`（零依赖 ZIP 写入器，`node:zlib` deflateRaw + 手写头部，路径排序与固定时间戳保证产物逐字节可复现），`remote/_entry.py` 作为启动器模板，启动时解压到临时目录再把包根挂进 `sys.path`。`remote/` 恢复为普通 Python 包（新增 `__init__.py`），五处 `@@INLINE` 标记从源码移除。
- **配置注入改为函数调用**：启动器不再替换源码里的 `EMBEDDED_CONFIG_B64` 赋值行，而是调用入口模块的 `set_embedded_config()`。这样后续把 `load_config` 搬进 `config.py` 时，只要入口模块 re-export 该函数，注入链路自动跟随（直接赋值模块属性在搬家后会静默丢配置，表现为启动即 `unauthorized`）。
- **契约随包分发**：`remote/contract.json` 现在打进 Kernel 源码包；`package.json` 的 `files` 扩到 `remote/**/*.py` 与 `remote/contract.json`，`scripts/package.mjs` 的 `remote` 目录放行 `.json` 并把 `_entry.py` / `__init__.py` / `contract.json` 列入必需文件。硬编码 `_FALLBACK_LIMITS` 本轮**未删**（会收紧无注入契约时的默认边界，安排到下一批与校验器单测同批做）。
- **验证 payload 复用同一打包器**：`tools/verify-model.mjs` 用 `entryModule: 'payload.verify_model'` + `extraFiles` 把 `tools/payload/verify-model.py` 作为包内模块打进归档，不再各自内联 anima 运行时与 Loader。
- **Host 侧收口（Batch 1）**：`lib/jobs.js`（948 行）拆为 `lib/jobs/{validator,errors,reference-loader,queue}.js`，`lib/kaggle-oauth.js`（674 行）拆为 `lib/kaggle/oauth/{pkce,browser,callback-server,session,text}.js`；两个原文件保留 16 / 23 行的聚合门面，导出名、函数签名与日志 scope 均未变，调用方零改动。
- **远端包化推进到切片⑥（Batch 2）**：`remote/` 已按目标分层落地 `config` / `state` / `observability/health` / `infra/process` / `transport/{validator,http_server}` / `inference/reference_codec` / `jobs/{models,store,runner}` / `app`；`remote/daemon.py` 从 2579 行降到 1533 行，只留配置注入点、ntfy 会合、模型加载与出图执行，以及各域的薄包装。
  - **⑥a 传输层**：`DaemonHandler` 与 `start_http_server` 搬进 `remote/transport/http_server.py`，依赖由 `HttpApi` 显式注入——`config` / `state` 传活对象，其余传 lambda 延迟解析，handler 不再 import daemon。`/health` 的取样顺序（持 `STATE_LOCK` 取快照 → 释放 → 取 `queue_depth`）仍留在 daemon，单测的锁序观察点不变。
  - **⑥b 生命周期**：启动顺序、信号、退出清理与空闲看门狗搬进 `remote/app.py` 的 `DaemonApp`；daemon 末尾以 lambda 装配实例并 re-export `main` / `runtime_boot` / `tunnel_boot`，`mock.patch.object(daemon, "install_dependencies")` 这类替换仍在调用点生效。
  - 剩余切片 ⑥c / ⑥d / ⑥e（`CacheManager` / `TunnelSupervisor` / `LoaderRegistry`）与 ⑥f（删门面 + 测试按域拆分）的施工顺序、以及"为什么不能一次做完"记在 `docs/REFACTOR_ARCHITECTURE_SPEC.md` §4.1。
- **修复 Windows 原子写入抖动**：`lib/fs-atomic.js` 的 `rename` 遇到杀毒软件 / 索引服务瞬时占用会抛 `EPERM`，此前会让 Kaggle 直连登录静默失败（`/state` 只显示「账号接入失败：unknown」）。现对 `EPERM` / `EACCES` / `EBUSY` 做 5 次有界重试（累计约 150ms），`test/kaggle-direct.mjs` 由「3 次跑 2 次失败」变为连跑 4 次全过。

### 测试

- `test/kernel-package.mjs` 重写为源码包口径（15 项）：CRC 标准向量、归档确定性、Python `zipfile.testzip()` 校验、条目与 `remote/` 一致、解包后 `import remote.daemon` 且 `set_embedded_config()` 生效、模板占位符唯一性、`extraFiles`、脚本模式（探针）。
- `test/check-verify-model.mjs` 同步为「payload 从源码包导入 + 归档含 payload 模块」（7 项）。
- `test/daemon-unit.py` 的内联标记断言改为「源码不再含内联标记」，并新增 `set_embedded_config` 注入用例。
- `test/daemon-unit.py` 增至 272 项（切片⑥ 新增 10 项边界用例）：`HttpApi` 的装配身份与「lambda 延迟解析」（patch `daemon.submit_job` 后必须命中）、队列满 → 429、未装配时 handler 立即报错、`Server` 头版本；`DaemonApp` 的启动顺序（HTTP 早于隧道与运行时）、无鉴权 / 端口占用两条退出路径、daemon 暴露的 `APP` 绑定，以及「`app.py` 不得反向 import daemon」——用 AST 看 import 语句，不按字符串匹配（模块头说明文字里就写着这句话）。
- `test/check-contract.mjs` 的 daemon 协议校验改为扫描 `daemon.py` + `transport/http_server.py` + `app.py`：路由搬到传输层、phase 取值搬到生命周期之后，校验仍指向真实实现位置，不因搬家静默空过。
- 全量 `npm test` 通过（含 272 项 Python 单测、契约 11/11）；`npm run package` 产物含 `remote/contract.json` 与 `lib/jobs/`、`lib/kaggle/oauth/`。

## 0.10.0 — 2026-11-14

> v0.10 首个版本：创作参数面板做减法（去风格预设、按模型真实能力显隐排除项、画面设置与参考图互斥、生成张数提权），AI 助手做加法（模型知识单一来源、意图 JSON v2、多轮上下文、通用澄清、确认卡带入参数面板），并把契约、测试、文档与版本收口到 0.10.0。

### 破坏性变更

- **契约**：`shared/contract.js` 的 `VERSION` 升到 `0.10.0`；删除 `STYLE_IDS` 导出与全部风格预设注释；新增 `INTENT`（摘要 / 澄清 / 模型建议的字符与条数边界）与 `LIMITS.intentHistory = { maxMessages: 12, maxMessageChars: 2000 }`。
- **模型资产**：`models/*.json` 新增必填布尔字段 `supportsNegative`（管线是否真的消费 `negative_prompt`）。9 个预设中只有 `flux2-klein-4b` 为 `false`（diffusers `Flux2Pipeline.__call__` 没有该参数）；`tools/build-assets.mjs` 校验并生成到 `shared/models.generated.js` 的 `MODELS` / `PRESETS`，`publicPresets()` 随 `/state.presets` 下发客户端。
- **`POST /imagen-api/intent` 响应 v2**：请求新增 `cfg` 与 `history`（Host 按 `LIMITS.intentHistory` 裁剪）；响应改为 `{ source, prompt, summary, ratioId, negative, clarify, modelHint }`，**删除 `styleId`**；澄清从「ratio / style 固定字段枚举」改为通用问题 + 2~4 个选项；`negative` 只在当前模型与 CFG 真正可用时非空。旧客户端读取 `styleId` 会得到 `undefined`，需按 v2 字段适配。
- **兼容性**：`previousPrompt` 保留，`history` 非空时优先于它；`presetId` / `locale` / `text` 的语义与错误码不变。
- **界面文案键**：删除 `studio.style*`、`studio.chat.clarify.ratio` / `.style`、`studio.chat.styleAuto` 等风格相关键；新增 `studio.rail.followReference*`、`studio.seed.reset`、`studio.refine.collapse/expand`、`studio.chat.intent.handoff*`、`studio.chat.intent.modelHint`、`studio.countShort` 等（`studio.rail.customSize` 沿用既有键，自定义宽高的边界说明复用 `studio.rail.sizeHint`）。中英各 399 键、严格同构。

### 改进

- **移除静态风格预设**：删除 5 个风格试印条（`StylePlate`）与提交时的风格后缀 / 风格负向层拼接（`composePrompt` / `toggleStyle`）；风格回到提示词内容与模型本身表达。
- **排除项按真实能力显隐**：新增 `shared/models-guide.js` 的 `negativePromptActive(preset, cfg)` 作为唯一判定——默认 `CFG=0` 的极速模型与不支持负向词的 `flux2-klein-4b` 默认隐藏「排除项」，抬高 CFG 后出现，恢复默认后再隐藏；隐藏时不渲染、不提交，提交体 `negativePrompt` 置空串；CFG 由不可用抬到可用且模型推荐词非空时自动补词。
- **画面设置**：文生图改为「5 个画幅比例 → 分辨率档位（长边，取自预设 `sizeOptions`，短边按比例换算并对齐 8px）→ 自定义宽高折叠」；有参考图时不再渲染可点却无效的比例 / 档位 / 宽高控件，只显示尺寸读数与「出图尺寸跟随参考图 {size}」说明。
- **宽高编辑与比例高亮**：宽高输入仍是本地草稿（失焦或回车提交，清空恢复原值）；比例高亮按约分后的长宽比匹配（`768` / `1152` 都算 `1:1`，`800 × 600` 算 `4:3`）；尺寸边界说明从契约注入。
- **生成张数提权**：1~4 张从高级折叠区移到页脚，左侧带「张数」标签的分段选择器；立即生成按钮下常驻规格摘要（尺寸 · 比例 · 张数，有参考图时补「参考图」，提示词为空时显示「先写画面描述」）。
- **高级设置自解释**：折叠态标题右侧显示读数摘要（如「4 步 · CFG 0 · 随机种子」）；随机种子补「恢复随机」；分组文案改为「步数 / 引导强度 / 随机种子」。
- **提示词区**：灵感示例仅在提示词为空时出现；润色建议可收起 / 展开（默认展开）；英文软提示改为提示可点「转为英文」，不再引导去创作助手。
- **创作助手**：
  - 新增 `shared/models-guide.js`（纯函数，只 import 契约）：提示词配方展示名与书写规则、负向词能力判定与指导、单模型 / 全库用法摘要；由 `lib/intent.js`、`lib/enhance.js`、`lib/tools.js` 与客户端共用，新增模型不必再改多处提示词逻辑。
  - `lib/intent.js` 改为三段式 system prompt（身份与使命 / 模型手册 / 组织与沟通策略，软性引导），输出意图 v2；`lib/enhance.js` 按模型资产选择润色口径并避开原文已覆盖的维度；`lib/tools.js` 的 `imagen_generate` 描述注入模型库概要，`describeJob` 补模型定位。
  - `lib/llm.js` 支持 `options.messages` 多轮消息（`content` 可为字符串或文本内容块数组，为多模态预留），`options.prompt` 保留单轮兼容；`prepareCall` 优先、`stream` 兜底、超时与空串降级行为不变。
  - 确认卡改为摘要优先（中文摘要 → 可编辑英文提示词 → 比例 → 模型建议弱提示 → 可用时的排除项 → 张数分段 → 锁定种子 → 「按此生成」/「带入参数面板」）；新增通用澄清卡（问题 + 2~4 个选项 +「先按当前设置」；选项作为新一轮输入重解析，空串只清澄清）；「带入参数面板」写表单 + 切到参数表单 + 轻提示；空态示例只填对话草稿，不改表单；确认卡默认随机种子，仅显式勾选「沿用上张构图（锁定种子）」且表单未手填种子时继承上一张。

### 工程

- 版本同步：`package.json` / `package-lock.json` / `shared/contract.js` / `remote/daemon.py` / `test/mock-daemon.py` / `test/tunnel-probe.py` / `remote/contract.json` / `client.js` 均为 0.10.0。
- 远端链路不变：`remote/daemon.py` 只做版本号变更；负向词仍按 `__call__` 签名与 `cfg > 0` 双条件兜底，不读取客户端能力标记。
- 客户端纯逻辑：`src/logic/preset.js` 新增 `sizeTiersOf` / `tierPatchOf` / `selectedTierOf`，`presetSelectPatch` 去风格且负向模型层按 `negativePromptActive` 写入；`src/logic/prompt.js` 负向层简化为 `{ model, user }` 并新增 `negativeForSubmit`；`src/logic/intent.js` 改为意图 v2 的归一 / 编辑 / 提交纯逻辑（`INTENT_EDITABLE_FIELDS = ['prompt', 'negative', 'count']`）。
- 样式：删除风格试印条样式，新增分辨率档位、张数分段、自定义宽高折叠、页脚摘要与润色头部样式；创作面板细小功能字号由 10.5px 提升到 11px（`docs/DESIGN.md` 的 Caption 字阶同步），并清理窄屏死规则。
- 测试：`check-client-logic` 64、`check-client-render` 70、`check-client-locale` zh/en 各 399 键、`host-e2e` 46、`daemon-unit` 232，其余既有套件不变；`npm test` 全绿。

### 文档

- `docs/SPEC.md`：`/intent` 请求响应 v2、`presets` 公开视图能力字段、`enhance` 的模型配方说明、`imagen_generate` 工具描述与排除项生效条件、§5 布局与尺寸 / 助手相关小节，新增 §5.11「第八批交互补充」。
- `docs/MODEL_ASSET_SPEC.md`：新增 §2.3 `supportsNegative`（语义、flux2 为 false 的理由、与 CFG 的联合判定、下发与消费方式）。
- `docs/ARCHITECTURE.md`：新增 §2.19 模型知识单一来源与 §2.20 助手提示词结构 / 多轮通道。
- `docs/DESIGN.md`：删除风格试印条小节，更新单轨面板结构与 Caption 字阶（11px）。
- `docs/ROADMAP.md`：第六节标记 0.10.0 已落地并回填实现要点。
- `docs/PRODUCT.md` / `README.md` / `README.en.md`：能力清单去风格预设并补充面板减法与助手升级；`docs/WORKBENCH_AUDIT_AND_RELIABILITY_PLAN.md` 在文首补历史说明。
- `skills/model-asset-intake/SKILL.md`：字段模板补 `supportsNegative` 与必填展示 / 配方字段。

## 0.9.0 — 2026-11-13

> v0.9 第三个里程碑（M3：图生图 / 垫图重绘）的发布版本，也是 v0.9 三个里程碑全部落地的收口版本。

### 改进

- **图生图（垫图重绘）**：工作台现在可以把一张已有作品当参考图重绘（Img2Img）。作品画廊卡片与大图预览新增「以此图重绘」：点击后把该作品设为参考图、切回创作视图（当前预设不支持垫图时自动切到 SDXL Lightning 并轻提示）。创作面板在已有参考图时出现精简槽位（缩略图 + 文件名 + 移除）与「重绘强度」滑块（0.2~0.9、步长 0.05、默认 0.6）；未放参考图时文生图界面与之前完全一致。首期只对 SDXL 家族开放：`flux2` / `anima` 预设置灰，参考图存在时切到不支持垫图的预设会拦下生成并提示，不会静默丢弃参考图。
- **远端零额外显存复用**：daemon 首次需要垫图时用 `AutoPipelineForImage2Image.from_pipe(STATEx.pipe)` 从已加载的 txt2img 底座复用组件创建 img2img 管线（不重新加载权重、不额外占显存），随切模型 / 释放一起清理；img2img 的 `__call__` 签名单独缓存，生成 kwargs 按它过滤。提交期只读图片头（loader 白名单、base64、原始字节 ≤ 8 MiB、PNG/JPEG、长边 ≥ 128、强度归一）就把错误收敛成 `400 invalid_request`；执行期在加载模型**之前**完整解码一次，长边超过 1536 时等比 LANCZOS 缩小（只缩不放），损坏图按 `invalid_request` 失败且不白占 GPU。`GET /health` 新增只读 `gpu_memory`（`allocated_mb` / `reserved_mb` / `max_allocated_mb`，不可用时 null）用于真机显存对比。
- **参考图的两条来源**：Host 既支持引用 `imagen-output/` 内作品（`reference.path`，经 `resolveOutputPath` 严格校验，只允许输出目录、拒绝绝对路径与软链接逃逸），也支持前端上传的 base64（`reference.image`，校验体积与 PNG/JPEG 魔数）。出图路由请求体上限按参考图上限单独放宽（其余路由仍是 256 KiB），daemon 的请求体上限也按注入契约推导（旧 Host 无参考图时仍是 8 MB）。
- **产物可回看垫图出处**：`meta.json` 记录 `sourceImage`（参考图工作区相对路径，上传来源为 null）与 `strength`；任务公开视图 `params.reference = { sourcePath, strength }`，参考图二进制绝不进入 `/state` 轮询。
- **模型能力标记**：9 份模型资产新增 `supportsImg2Img`（SDXL 家族 true，`flux2-klein-4b` / `anima-light-lavender` false），生成资产与 `publicPresets()` 自动下发；daemon 不信任该标记，按 loader 白名单独立兜底。字段规则写入 `docs/MODEL_ASSET_SPEC.md` §2.2 与 model-asset-intake skill 模板。

### 工程

- 契约：`LIMITS` 新增 `reference = { maxBytes: 8 MiB, maxEdge: 1536, minEdge: 128 }` 与 `strength = { min: 0.2, max: 0.9, step: 0.05, default: 0.6 }`，并入 `daemonContract().limits`（`remote/contract.json` 由生成脚本产出，含新边界）。
- 测试：`test/daemon-unit.py` 173→232（参考图提交期/执行期校验、等比缩放、from_pipe 惰性缓存与释放、img2img run_task 分支、`/health.gpu_memory`、契约边界不硬编码）；`test/host-e2e.mjs` 40→41（作品参考图走 `/generate` 全链路 + 越界参考图 400）；`test/jobs-wait.mjs` 21→23（参考图入队校验、远端载荷、meta 记录、publicView 不含二进制、无效路径失败码）；`check-client-logic` 59→63、`check-client-render` 57→64（参考图槽位/滑块/移除、画廊与大图带入、请求体 `reference:{path,strength}`、不支持预设拦下、旧宿主不回归）、`check-client-locale` zh/en 各 385→396 键。`npm test` 全绿。
- 真机验证脚本：`node test/gpu-live.mjs --preset sdxl-lightning --img2img [--strength 0.6]` 先文生图再用该图垫图重绘，报告记录 `loadSeconds`（from_pipe 复用应为 0）、参考图实际尺寸与重绘前后 `/health.gpu_memory`。
- 版本升到 0.9.0：契约 / `package.json` / `remote/daemon.py` / `test/mock-daemon.py` / `test/tunnel-probe.py` / `remote/contract.json` / `client.js` 同步。

### 文档

- `docs/SPEC.md`：`POST /generate` 新增 `reference` 参数与校验/失败语义、Job `params.reference`、产物 meta 的 `sourceImage` / `strength`、§1.4 `/health.gpu_memory`、新增 §5.9 第六批交互补充（参考图槽位 / 能力边界 / 画廊带入 / 连续迭代）。
- `docs/ARCHITECTURE.md`：新增 §2.18「图生图（垫图重绘，M3）」——Host 入队校验 → 执行期落盘读取 → 远端头部校验/解码/from_pipe 复用的三段链路与显存要点。
- `docs/MODEL_ASSET_SPEC.md`：新增 §2.2 图生图能力字段（可标 true 的条件、三方消费与校验口径）。
- `docs/ROADMAP.md`：v0.9 M3 标记完成并补实现说明，基线更新到 0.9.0。
- `skills/model-asset-intake/SKILL.md`：字段模板与约束补 `supportsImg2Img`。

### 真机验收

- **M3 图生图（2026-11-13，Kaggle 2×Tesla T4，`node test/gpu-live.mjs --preset sdxl-lightning --img2img`）**：同一会话内先文生图（加载 0s / 出图 15.63s / 1024×1024）再用生成的图垫图重绘（强度 0.6，参考图 1024×1024 → 实际出图 1024×1024，加载 **0s** / 出图 7.0s），证明 `from_pipe` 复用了已加载底座、没有重新加载权重。重绘前后 `/health.gpu_memory`：`allocated_mb` 7000 → 7000、`max_allocated_mb` 10233 → 10233、`reserved_mb` 10776 → 10778（+2 MiB 为噪声），**显存无额外增长**；`reusedBasePipeline=true`、`reservedDeltaMb=2`。产物：`bench-results/gpu-live/2026-11-13T14-43-22/`（`01.png` / `01-img2img.png` / `report.json`）。同次版本快照 python 3.13.16 / torch 2.11.0+cu130 / diffusers 0.43.0 / transformers 5.23.0 / accelerate 1.15.0 / peft 0.21.3 / huggingface-hub 1.33.0 / safetensors 0.8.0 / pillow 13.0.0，已回填 TROUBLESHOOTING 的 LKGR 表。
- **M2 直连传输（2026-11-13 真机复核）**：`probeKaggle` 直接打通真实 Kaggle API（不经过 CLI）：鉴权正常、用户名 `mogudd`、配额 `7.13h / 22.87h / 30h`（重置 2026-11-14T00:00:00Z）。并用直连链路真实推送了一个 CPU 探针 Kernel（`mogudd/imagen-direct-live-f3b313`）：`pushKernel` 返回 URL、`kernelStatus` 轮询到 `COMPLETE`、`kernelLogs` 拉到脚本输出里的校验标记，**直连的推送 / 状态 / 日志三接口全部通过**（CPU 探针不消耗 GPU 配额）。
- **M2 内置 OAuth 登录（2026-11-13 真机闭环验收通过）**：运行 `node tools/kaggle-login.mjs --timeout-minutes 15` 在本机浏览器完成真实 Kaggle OAuth 2.0 + PKCE 授权，脚本自动回调收码并写入 `~/.kaggle/credentials.json`（username `mogudd`，含 `refresh_token`，与 `kaggle auth login` 同格式；旧凭据已备份），随后用**新凭据在隔离目录**做直连探测：鉴权正常、配额 `7.13h / 22.87h / 30h`（重置 2026-11-14T00:00:00Z），登录 → 直连可用全链路闭环。
- **验收中发现并修复的真实缺陷**：Windows 上原用 `cmd.exe /c start` 打开授权页，Node spawn 只给含空格的参数加引号，授权链接里的 `&` 被 cmd 当命令分隔符截断，Kaggle 返回 `{"error":{"code":400,"message":"Must specify State"}}`。已改为 `rundll32 url.dll,FileProtocolHandler`（URL 作为普通参数交给默认浏览器，不经 cmd 解析），验收脚本同时打印完整授权链接供手动复制兜底，并补 `browserCommand` 回归断言（提交 `807f212`）。

## 0.8.2 — 2026-11-13

> v0.9 第二个里程碑（M2：新手零门槛，试验特性）的发布版本。默认仍是稳定的 `kaggle` CLI 路径；直连模式在运行设置里手动开启，可随时切回。

### 改进

- **不装 kaggle CLI 也能出图（试验特性）**：运行设置 →「高级」→「Kaggle 访问方式」新增 `cli` / `direct` 开关。直连模式由宿主 Node 进程直接调用 Kaggle JSON API（`POST https://api.kaggle.com/v1/<service>.<Service>/<Method>`），报文逐项对照本机 `kaggle` CLI 2.2.5 / `kagglesdk` 0.1.38 源码实现；所有请求走 `lib/net.js` 复用系统代理 `curl` 兜底，去掉每次 CLI 调用 9~15 秒的 Python 冷启动，Windows 上也不再依赖 Python `Scripts` 目录进 PATH。切换在下次探测 / 唤醒时生效，不需要重载插件。
- **直连客户端与 CLI 实现同形状**：新增 `lib/kaggle-direct.js` 实现 `probeKaggle` / `kaggleUsername` / `pushKernel` / `kernelStatus` / `kernelLogs`，由 `lib/kaggle-transport.js` 按当前设置注入 `SessionManager`，会话状态机与 `isKernelEnded` 判断零改动。凭据解析顺序为 `KAGGLE_API_TOKEN` → `~/.kaggle/access_token` → `~/.kaggle/credentials.json`（`access_token` 过期用 `refresh_token` 调 `GenerateAccessToken` 续期并原子回写 0600）→ `~/.kaggle/kaggle.json`（Basic Auth）；401/403 归 `auth_required`、网络错误归 `unknown`；token 只进请求头，不进日志、错误详情与对外快照。
- **内置 OAuth PKCE 登录**：直连模式不需要 CLI，由宿主发起标准 OAuth 2.0 + PKCE（`S256`、`client_id=kagglesdk`、`scope=resources.admin:*`）并拉起系统浏览器，本地 `127.0.0.1:8000~9000` 回环回调校验 `state` 后收码换 token，写入 `~/.kaggle/credentials.json`（OAuth 凭据，含 `refresh_token`，目录 0700 / 文件 0600、原子写），与 `kaggle auth login` 完全同格式——登录一次，CLI 与直连两种模式都能读到同一份凭据。浏览器打不开时自动降级为「复制授权链接 + 粘贴授权码」；支持取消与 5 分钟超时兜底。
- **登录指引卡与直连展示**：直连模式下 `cli_missing` / `auth_required` 合并为一张「登录 Kaggle」卡：点击「在浏览器中登录 Kaggle」后显示等待授权与「取消」；manual 模式展示可复制链接与授权码输入框；成功后轻提示并自动重跑环境探测，失败可重试。顶栏与探测行的「CLI」字样按当前传输方式显示「直连」，直连模式不再提示安装 CLI。CLI 模式与无新接口的旧宿主保持原有行为。
- **新增真机验收脚本**：`node tools/kaggle-login.mjs` 复用同一套 OAuth 代码路径完成真实授权（自动备份旧 `credentials.json`），成功后用直连客户端查一次真实配额，不消耗 GPU；`--manual --code <授权码>` 支持无头环境。

### 工程

- 契约新增 `ROUTES.kaggleLogin`（GET）/ `ROUTES.kaggleLoginAction`（POST，共用 `/imagen-api/kaggle/login`）、`KAGGLE_LOGIN`（动作/状态/模式/轮询与超时）与 `SETTINGS.kaggleTransports` / `defaultKaggleTransport`；`/state` 新增 `kaggleTransport`，运行设置视图新增 `kaggleTransport` 字段。路由总览 23 条方法 / 20 个唯一路径，`node test/check-contract.mjs` 11/11 通过。
- 新增 `lib/kaggle-direct.js`、`lib/kaggle-oauth.js`、`lib/kaggle-transport.js`、`lib/routes/kaggle.js`、`tools/kaggle-login.mjs`；`index.js` 装配传输层与登录路由（卸载时取消进行中的登录并释放回环端口）。
- 测试：新增 `test/kaggle-direct.mjs`（14 项：请求 URL/Bearer/camelCase 报文、凭据优先级与 refresh 续期、401/网络错误映射、SaveKernel/Status/Logs/quota 映射、token 不泄露）与 `test/kaggle-oauth.mjs`（14 项：PKCE 与 Python 参考向量一致、授权 URL 逐字一致、manual/browser 两种模式、state 校验、取消、超时、降级、失败收敛、token 不进视图与日志）；`test/host-e2e.mjs` 31→40（登录路由 GET/400/405、`/state.kaggleTransport`、设置切换即时生效）；`test/settings-host.mjs` 增加 `kaggleTransport` 默认值 / 保存 / 非法值 / 视图断言；`check-client-locale` zh/en 各 350→385 键、`check-client-logic` 54→59、`check-client-render` 48→57（直连开关保存、登录卡各分支、done 后重跑 probe、CLI 模式不回归）。`npm test` 全绿。
- 版本升到 0.8.2：契约 / `package.json` / `remote/daemon.py` / `test/mock-daemon.py` / `test/tunnel-probe.py` / `remote/contract.json` / `client.js` 同步；`client.js` 重新构建。

### 文档

- `docs/SPEC.md`：路由总览与 `/state` / 设置视图新增 `kaggleTransport`，新增 §2.6 Kaggle 直连登录接口（`LoginView` 字段、动作与错误语义）与 §5.8 第五批交互补充（直连开关 / 内置 OAuth 登录 / 直连展示 / 兼容降级）。
- `docs/ARCHITECTURE.md`：新增 §2.16「Kaggle 访问方式：CLI 与 Node 直连（试验特性）」与 §2.17「内置 OAuth PKCE 登录」，写明协议对照来源与安全约束。
- `docs/TROUBLESHOOTING.md`：新增第 9 节「直连模式与内置 OAuth 登录」排错表（浏览器没弹出 / 授权后仍提示未登录 / 401、端口占用、切回 CLI、安全提示）。
- `README.md` / `README.en.md`：三步上手第一步补充「试验特性：不装 CLI 也能用」的开启方式与凭据位置。
- `docs/ROADMAP.md`：v0.9 M2 标记为已完成并逐项补实现说明；M3（图生图）为下一轮。

### 真机验收

- 离线部分：`npm test` 全绿；直连报文与本机 CLI 抓包逐项核对（例如 `GetAcceleratorQuotaStatistics` 返回 `{quotaRefreshTime, gpuQuota:{timeUsed:"25480.101s", totalTimeAllowed:"108000s"}}`）。
- 真实 OAuth：已在 0.9.0 完成真机闭环验收（浏览器授权 → 写入 `~/.kaggle/credentials.json` → 新凭据直连探测鉴权正常、配额可读），详见 0.9.0「真机验收」小节。

## 0.8.1 — 2026-11-13

> v0.9 第一个里程碑（M1：体验修复与可靠性收口）的发布版本；v0.9 主题里的 M2（Node 直连 Kaggle + 内置 OAuth，试验特性）与 M3（图生图）仍按 [ROADMAP](docs/ROADMAP.md) 规划推进。

### 改进

- **对话确认卡可以行内改词**：`ChatPanel.jsx` 的意图确认卡上，英文提示词与排除项从只读文本改为可直接编辑的文本域（分别受 `LIMITS.prompt.maxChars` / `LIMITS.negativePrompt.maxChars` 约束），改完直接点「按此生成」即按卡片当前内容提交，不必为微调几个词重新发起对话让模型重猜。`useChatThread` 新增白名单编辑动作（`updateIntent` / `updateIntentField`），生成走 `intentOverrides`：提示词仍合并当前风格后缀，排除项以卡片当前值为准（在卡上清空后提交即真的不带负向词），提示词为空时按钮禁用、hook 不提交。
- **「高级设置」展开状态会被记住**：表单「高级设置」折叠区默认仍收起，但展开 / 收起状态通过新增的 `GET/POST /imagen-api/ui-state` 持久化到 `<workspace>/.imagen/ui-state.json`，下次打开工作台沿用。客户端挂载时读一次、切换时先改本地状态再 fire-and-forget 保存；读取或保存失败静默回落默认值，不提示、不阻塞出图。白名单字段与默认值由契约 `UI_STATE` 统一定义（Host 与 Client 共用），未知字段保存时丢弃，已登记字段类型不符返回 `400 invalid_request`。
- **卸载时没关掉的云端实例，下次启动会补发关机**：`dispose()` 保持不阻塞卸载，但在关机通知失败时先**同步**把最小连接信息写入 `<workspace>/.imagen/pending-cleanup.json`（含 endpoint / token / kernelId / topic / attempts），并删除 `session.json`——用户已明确退出，下次启动不再让 `restore()` 去接手或长时间等会合。插件启动时先 `cleanupPendingSession()` 补发一次 `/shutdown` 再执行 `restore()`：补发成功清记录，失败累加次数等下次再试；记录超过 24 小时（Kernel 最长运行 3 小时）、补发满 5 次或地址不可信时丢弃并留 warn。token 只落盘、不进日志；开发模式不写该记录。
- **cloudflared 下载改为固定版本 + SHA256 校验**：`remote/daemon.py` 的 cloudflared 下载地址从滚动的 `/releases/latest/download/` 改为固定 tag `2026.11.0`，并对 `cloudflared-linux-amd64` 做 SHA256 校验（`51f7c68b…a51fd`，40,283,099 字节；校验和已与官方 Release 说明及本机实际下载复算交叉核对）。流式下载到 `.part` 时边写边算校验和、超过 120 MB 立即中止；校验不匹配或下载异常各重试一次，第二次仍失败时带「期望 / 实际」校验和报错，由现有 `start_tunnel` 收敛进 `BOOT.tunnel_error` 并回退备用通道。消除上游发版或网络只传半截文件导致的冷启动随机失败。
- **凭据指引校准为三口径**：`auth_required` 卡与 `/probe` 说明统一为——`kaggle auth login` 完成 OAuth 授权并把凭据写入 `%USERPROFILE%\.kaggle\credentials.json`（含 `refresh_token`，过期可自动续期）；Kaggle 网页生成的 API Token 可保存为 `%USERPROFILE%\.kaggle\access_token`；旧版 CLI 的 `%USERPROFILE%\.kaggle\kaggle.json` 仍兼容。中英文字典同步，文案里的反斜杠路径由常量注入。

### 工程

- 契约新增 `ROUTES.uiState` / `ROUTES.uiStateSave`（共用 path `/imagen-api/ui-state`，宿主按 method 数组分发，与运行设置同款）与 `UI_STATE`（白名单字段、默认值、落盘上限 64 KiB）；路由总览为 21 条方法 / 19 个唯一路径；`node test/check-contract.mjs` 11/11 通过（含 `docs/SPEC.md` 跟随）。
- 新增 `lib/ui-state.js`（原子读写、0700/0600、损坏 / 版本不符 / 超限回落默认值）、`lib/routes/ui-state.js`、`lib/session/pending-cleanup.js`；`index.js` 启动流程改为「补清理 → 恢复」顺序执行，各自吞异常、不阻塞插件加载。
- 测试：新增 `test/ui-state-host.mjs`（21 项）与 `test/session-pending-cleanup.mjs`（65 项）；`test/daemon-unit.py` 164→173（固定版本 / 校验和不匹配重试 / 下载异常重试 / 超大小上限中止 / 复用已有文件，全部假 `urlopen` 不联网）；`test/session-restore.mjs` 79→84（dispose 语义重写为「同步写待清理记录 + 失败删会话记录」）；`test/check-client-logic.mjs` 52→54、`test/check-client-render.mjs` 45→48（用新增的 hook 级渲染能力断言真实状态流转与「按此生成」实际提交值）、`check-client-locale` zh/en 各 344→350 键；`test/load-client.mjs` 增加 `requests` 请求记录（method + JSON body）与 `rerender()` / `settle()`。
- 版本升到 0.8.1：契约 / `package.json` / `remote/daemon.py` / `test/mock-daemon.py` / `test/tunnel-probe.py` / `remote/contract.json` / `client.js` 同步；`client.js` 重新构建（429,503 字节）。

### 文档

- `docs/SPEC.md`：§1.1 补「卸载补清理」语义，新增 §2.5 工作台界面状态（ui-state）接口与 §5.7 第四批交互补充（确认卡行内微调 / 折叠记忆 / 凭据三口径）；版本标识与路由总览同步。
- `docs/ARCHITECTURE.md`：§2.9 补 cloudflared 固定版本与校验和，新增 §2.14「卸载未关机的补清理」与 §2.15「工作台界面状态持久化」。
- `docs/TROUBLESHOOTING.md`：隧道排错表补「cloudflared 下载失败 / SHA256 校验失败」一行；会话恢复一节补 `pending-cleanup.json` 的说明；§6 凭据处理改为三口径。
- `README.md` / `README.en.md`：Kaggle 登录说明改为 OAuth 凭据口径（`credentials.json` + `refresh_token`），手动方式保留 `access_token` 与 `kaggle.json` 兼容。
- `docs/ROADMAP.md`：v0.9 M1 标记为已完成（0.8.1）并逐项补实现说明；记录「工作区对话历史持久化」的评估结论（本轮不做，理由与后续排期写清）。

## 0.8.0 — 2026-11-13

### 改进

- **Agent 能取消任务、并把图片直接交付到工作区**：新增第 4 个 Agent 工具 `imagen_cancel`（四种可读结果：未找到 / 已从队列移除 / 合作式停止 / 已是终态）。`imagen_generate` 新增 `saveTo` 参数：原始归档照常写 `imagen-output/`，同时把图片原子复制到工作区相对路径；未写扩展名自动补 `.png`，`count > 1` 按 `-01`、`-02` 追加序号。交付路径记入 `job.output.deliveredPaths`，工具返回的产物段逐条列出「已交付至：<path>」，模型可以直接把路径写进回复、代码或文档。路径只接受工作区相对路径：绝对路径、Windows 盘符、`..`、`imagen-output/`、`.imagen/` 与软链接逃逸一律拒绝，非法路径在入队前就返回 `invalid_path`。
- **工作台内可改运行设置，下次唤醒即生效**：新增 `GET/POST /imagen-api/settings` 与「运行设置」抽屉（顶栏 GPU 状态弹层底部、日志入口旁进入，右侧抽屉带焦点陷阱 / Esc / 关闭归还焦点）。可设置空闲自动关机（15/30/60/120 分钟快捷档位 + 自定义）、GPU 加速器、HuggingFace Token（已配置时只显示状态，可留空保持不变或一键清除），高级折叠区可维护预挂载 Kaggle Dataset、本地模型目录映射（行级校验）与 pip 依赖约束。覆盖项持久化到 `<workspace>/.imagen/settings.json`（目录 0700 / 文件 0600、原子写），宿主每次启动会话前读取合并后的最新值，不必重载插件；实例运行中提示「修改将在下次唤醒时生效」。对外视图只返回 `hasHfToken` 与 `hfTokenSource`，绝不回传 Token 原文。
- **无卡新手四个卡点加固**：① `cli_missing` 卡明确提示 Windows 用户检查 Python Scripts 是否加入 PATH 并重启 DSH Desktop；② `auth_required` 卡写明凭据文件位置 `%USERPROFILE%\.kaggle\kaggle.json`，并提供打开 Kaggle 设置获取 Token 的按钮；③ 远端没拿到 GPU 时新增远端错误码 `gpu_unavailable`——`torch.cuda.is_available()` 为 `False` 立刻报错（文案含手机号验证与 GPU 加速器两步检查），经 `/health.last_error_code` 与 ntfy 透传，前端用独立的「云端没有拿到 GPU」指引卡，不再拿 CPU 硬跑到超时；④ 顶栏算力弹层展示「已空闲 X 分钟 · 满 Y 分钟自动关机」，让空闲关机可预期。
- **切模型不再爆 20GB 磁盘**：远端加载新模型前先 `release_pipeline()` + `gc.collect()` + `torch.cuda.empty_cache()`，按目标 pipeline 的全量依赖构建 keep_set（`local_models` 预挂载仓库与只读挂载目录永不触碰），磁盘余量按 HF 缓存目录所在盘测量；不足时把 `models--*` 按最近修改时间从旧到新逐出，逐条记 `[cache] evicted <repo> freed=<X>GiB`，每次删除后重测、够用即停，清完仍不足才抛「磁盘空间不足：需 X GiB / 可用 Y GiB」。`/health` 新增 `versions` 依赖版本快照，`npm run test:gpu` 支持 `--presets a,b,c` 在单一会话内连续切模型验证。
- **出图不再被隧道抖动误判失败**：轮询容错从「连续 6 次失败即判死」改为按持续时长容忍（默认 120 秒）并指数退避；窗口用尽后用同一 `job.id` 幂等重投接回远端仍在算图的任务（最多 2 次，避免超出 daemon 保留窗口后重复出图）。`404 unknown_job` 仍是终态。
- **隧道重建不再提前杀掉仍在运行的 Kernel**：`ready` 后失联的恢复窗口改为「向 Kaggle 确认 Kernel 仍 RUNNING 就续期」，单轮 120 秒、最多续 10 轮（约 7 分钟兜底），不再一次超时就 `health_failed`。
- **任务进度透出到分张粒度**：`Job` 新增 `stageCode`（稳定英文阶段码）与 `progress: { done, total }`；工作台显示「正在生成第 2/4 张」与「正在加载模型…」，`stage` 的中文文案保留给中文界面与日志，英文界面不再直接展示中文阶段串。
- **对话出图默认不再沿用上一张的种子**：跨主题对话不会因为隐式锁种而构图僵化；意图确认卡新增「沿用上张构图（锁定种子）」开关（默认关闭，无可用种子时置灰）。
- **作品画廊**：卡片上可直接点星标收藏 / 取消收藏（批量选择态自动收起星标，避免误触）；列分配改为行优先，最新作品在每行最左，保留 5 列自然高度、不裁切图片；历史一次加载上限从 60 张提到契约允许的 100 张。
- **窄屏可见排队状态**：`≤820px` 收起底部胶片栏时，画面预览左上角保留排队胶囊，显示当前任务与「另有 n 张排队」。
- **任务可以取消**：新增 `POST /imagen-api/job/cancel`。`queued` / `waiting-session` 立即出队失效——等待会话的任务不再把后面的任务阻塞到 45 分钟会话等待窗口超时；`running` 为合作式停止——当前这张出完后不再提交批内剩余张数，不强杀线程、不改远端采样回调，取消前已完成的图片仍保留在 `output`，任务收敛为 `cancelled`。底部胶片条的暗房卡提供「取消」按钮，取消中显示「正在停止…」并禁用重复点击。
- **历史作品分页**：`GET /imagen-api/history` 支持 `limit` / `offset` 并返回 `hasMore`；画廊底部新增「加载更多」（按契约页长 100 逐页追加，去重合并，失败不清空已加载内容），加载完显示「已加载全部作品」。
- **提示词一键转英文**：`POST /imagen-api/enhance` 新增 `mode: "translate"`，复用宿主已配置的模型把提示词转成英文；模型不可用时明确返回 `source: "local"` 与原文，界面提示「模型不可用，未能翻译」，不把原文假装成译后结果。
- **日志抽屉双视图与可粘贴诊断**：运行日志抽屉可在「远端日志 / Host 日志」间手动切换，远端为空时仍自动兜底展示 Host 日志并保留来源说明（Esc、焦点陷阱、滚底行为不变）；`GET /imagen-api/logs` 新增脱敏环境指纹 `env`（平台、Node 版本、代理/备用隧道/自定义数据集/pip 约束/HF Token 是否配置、阶段耗时摘要）与更长的诊断尾部（远端 120 行 / Host 80 行）；会话、网络、生成、通用、授权五类指引卡新增「查看日志 / 复制诊断信息」次级按钮，离线也能一键导出状态、日志与指纹。
- **方形尺寸档位**：模型预设的 `sizeOptions` 不再被忽略，「画面设置」新增独立「方形尺寸」行（与画幅比例行区分）；「高级设置」允许在契约边界与 8 的步长内自定义宽高，失焦与提交各钳制一次。

### 修复

- **凭据指引对齐 kaggle CLI 2.x（此前口径过时）**：`auth_required` 指引卡与探测提示原先只写旧版 `%USERPROFILE%\.kaggle\kaggle.json`；实际 CLI 2.x 用 `kaggle auth login` 把 `access_token` 写进 `%USERPROFILE%\.kaggle\access_token`（本机验证的 CLI 2.2.5 即此格式）。现在卡片给出可一键复制的 `kaggle auth login`，同时说明凭据写入位置与旧版 `kaggle.json` 兼容；README / TROUBLESHOOTING / SPEC 同步，避免新手照旧文案去手工建文件。
- **代理环境下 curl 兜底必然失败（`value.includes is not a function`）**：`lib/net.js` 的降级路径把 `new URL(...)` 对象直接塞进 DSH subprocess 的 `argv`，并且没有传必需的 `cwd`；`subprocess-local` 会对 `argv` 逐项做字符串校验、把 `cwd` 当字符串校验，于是每次降级都抛 `TypeError`：
  - URL 对象（`/health`、`/generate`、`/job`、`/shutdown`、`/logs`）→ `TypeError: value.includes is not a function`；
  - 字符串 URL（ntfy 会合轮询）→ `TypeError: Cannot read properties of undefined (reading 'includes')`。
  线上后果：需要代理的远端请求在 `fetch` 失败后无法降级，Host 日志刷满 `fetch 与 curl 均失败`，ready 心跳丢失、每 3~4 分钟重取隧道地址，最终 Kernel 空闲退出后会话停在 `session_ended`。修复：`viaCurl()` 先把 URL 归一成字符串再拼参数，显式传 `cwd: process.cwd()`；warn 日志同时记录 fetch 与 curl 两侧的失败原因，不再只有 curl 一侧。
- **界面把浏览器原文 “Failed to fetch” 当错误详情**：宿主状态轮询失败时，客户端把 `TypeError` 原文直接放进「操作没有完成」兜底卡片，而且轮询恢复后这张卡不会消失。现在：
  - 网络层错误单独归为 `network` 指引卡（「连不上本地服务」+「重试」），详情用客户端文案（`error.network`），不再展示英文原文；
  - 宿主状态轮询恢复后自动撤掉这次网络错误提示（去重游标同步重置），不再留下过期的「Failed to fetch」卡片；
  - 「重试」只立即拉一次 `/state`，不触碰云端会话。
- **切换到无负向提示词的预设会残留旧词**：负向提示词改为按来源分层记录（模型 `negativeHint` / 风格词 / 用户手写），切换预设只整层替换模型层——新预设没有 `negativeHint` 时模型层被清空，不再把上一个模型的排除词继续发给远端。
- **取消风格会误清模型负向词**：取消风格现在只移除该风格写入的负向层，模型 `negativeHint` 与用户手写内容保持不变；用户手动编辑与历史回填则落入用户层，提交时三层去重合并。

### 工程

- 契约新增：`ROUTES.settings` / `ROUTES.settingsSave`（同一 path 的 GET/POST，宿主按单条路由的 `method` 数组分发，避免 DSH 宿主的 exact 路由表拒绝重复 path）、`SETTINGS`（空闲关机边界与快捷档位、加速器白名单、高级项上限、`hfTokenSources`）、`ERROR_CODES.gpu_unavailable`；`docs/SPEC.md` 同步路由总览（19 条）、§1.4 远端 `/health` 附加字段、§2.4 运行设置接口、§3.4 `imagen_cancel` 与 `saveTo` 交付规则、§4 切模型缓存清理、§5.6 第三批交互补充。
- 新增 `test/settings-host.mjs`（26 项）：设置纯函数（归一/钳制/去重、覆盖项合并、脱敏视图三态来源）、`settings.json` 原子写与重建读回、hfToken 明文零回传、`clearHfToken`、非法值 400 `invalid_request` / 非法 body 400 `invalid_body`、`effectiveOnNextSession`、SessionManager 启动读取最新设置、`idle_seconds` → `idleSeconds`、`last_error_code` 透传与回退、`index.js` 真实装配（路由 + `/logs` 诊断指纹）；已接入 `npm test` 与 `npm run test:host`。
- `test/daemon-unit.py` 从 138 项增至 164 项：pipeline 依赖仓库收集、LRU 逐出顺序 / keep_set 保护 / `local_models` 不触碰 / 空间不足 `LoadError`、`ensure_pipeline` 先清理后加载、无 GPU 的 `gpu_unavailable` 码与文案、`/health.versions` 纯版本号与脱敏；版本期望改为从 `remote/contract.json` 读取，后续升版本不必再改测试常量。
- `test/host-e2e.mjs` 从 31 项增至 38 项：`imagen_cancel` 四种返回分支与真实队列终态、`saveTo` 单张/多张/越界与保留目录拒绝、归一化纯函数边界、HTTP 提交的 `deliveredPaths` 与 400 `invalid_path`。`test/session-pure.mjs` 28→29；`check-client-logic` 44→52、`check-client-render` 36→45、`logs-diagnostics` 覆盖六类指引卡；`check-client-locale` zh/en 各 293→344 键。
- 版本升到 0.8.0：契约 / `package.json` / `remote/daemon.py` / `test/mock-daemon.py` / `test/tunnel-probe.py` / `remote/contract.json` / `client.js` 同步；`docs/SPEC.md` 版本标识与示例同步。
- **M4.2 真机验证通过（2026-11-13）**：`npm run test:gpu -- --presets sdxl-lightning,flux2-klein-4b,anima-light-lavender` 在单个 2×Tesla T4 会话内连续切换三种架构（SDXL-LoRA / FLUX.2 / Anima）全部出图成功，加载 0s / 125.9s / 89.6s、出图 16.2s / 10.1s / 76.3s；依赖快照 python 3.13.16 / torch 2.11.0+cu130 / diffusers 0.43.0 / transformers 5.22.2 / accelerate 1.15.0 / peft 0.21.2 / huggingface-hub 1.33.0 / safetensors 0.8.0 / pillow 13.0.0，已回填 `docs/TROUBLESHOOTING.md` 的 LKGR 表。实测发现当前 Kaggle 镜像的 HF 缓存挂载在 `/`（约 966.6 GiB 可用，`/kaggle/working` 仍约 19.5 GiB），三个模型累计约 27 GB 权重未触发逐出（`evictedCount=0`）、磁盘未爆——逐出逻辑作为小容量镜像的兜底，由 daemon 离线单测（8 项缓存清理用例）覆盖；这也验证了 `disk_usage_target()` 测的是缓存目录自己所在盘，而不是写死 `/kaggle/working`。
- `client.js` 重新构建。
- 新增 `test/net-fallback.mjs`（6 项）：按 DSH `subprocess-local` 的真实校验规则伪造 subprocess（`argv` 必须全为字符串、`cwd` 必须是字符串），覆盖 URL 归一、请求头/请求体透传、状态码解析、fetch 成功不降级、双侧失败的错误链路；已接入 `npm test` 与 `npm run test:host`。
- `test/load-client.mjs` 新增 `failures` 选项（按路径抛 TypeError），`check-client-render` 增加 `network` 场景：断言卡片为「连不上本地服务」+ 本地化详情 +「重试」，且不再出现「操作没有完成 / Failed to fetch」。
- `docs/ARCHITECTURE.md` §2.5 补充与 DSH subprocess 契约对齐的说明；`client.js` 重新构建。
- 宿主可靠性改造的离线断言：`test/jobs-wait.mjs` 新增 8 项（容忍窗口、指数退避、`404` 终态、幂等续接、重投上限、整体预算约束、`publicView` 阶段码与进度映射、分张进度接线），`test/session-reliability.mjs` 新增 2 个场景（Kernel 仍 RUNNING 时续期后可恢复 `ready`、续期用尽收敛 `health_failed`）。
- 客户端新增纯函数：`src/logic/gallery.js`（列数断点 + 行优先分桶）、`src/logic/format.js` 的 `formatText`（字典无插值机制，计数文案用 `{name}` 占位）。`check-client-logic` 39 项、`check-client-render` 30 项、`check-client-locale` zh/en 各 270 键全绿。
- 契约新增 4 个超时常量（`remoteJobPollFailureGraceMs` / `remoteJobPollBackoffMaxMs` / `remoteJobResumeMaxAttempts` / `recoveryMaxRenewals`）；`docs/SPEC.md` 补充 `Job.stageCode`、`Job.progress` 与轮询续接语义，`docs/ARCHITECTURE.md` 新增 §2.12（轮询容错与幂等续接）与 §2.13（恢复窗口）。
- 契约新增取消/分页/英译/日志口径：`ROUTES.jobCancel`、`JOB_STATUS`（含终态 `cancelled`）、`JOB_CANCEL`、`ENHANCE_MODES`、`LIMITS.history.pageSize`、`LOGS`、`DIAGNOSTICS`；`docs/SPEC.md` 同步取消语义、历史分页、英译降级、`Job.cancelRequested` 与 `/logs` 的 `env` 字段，路由总览更新为 17 条。
- 宿主取消实现为「逐张提交远端 job」：`count>1` 时每张一个远端 job（`tasks` 只含 1 项，幂等键 `<job.id>-NN`），一张完成后才提交下一张，取消时不再提交剩余；轮询容错、指数退避与同键重投全部复用原 `waitForJob`，`generateTimeoutMs` 仍是整个宿主任务的预算（不按张数放大）。会话等待改为可按拍取消的轮询（1 秒），替代不可中断的 `session.ensureReady()`。
- 删除/取消相关的返回形状变更：`scanHistory()` 返回 `{ items, hasMore }`（旧签名 `scanHistory(ctx, limit)` 仍兼容），`lib/tools.js` 的 `imagen_history` 与取消任务的描述文案同步适配。
- 测试覆盖：新增 `test/logs-diagnostics.mjs`（15 项：`env` 白名单与非法字段剔除、旧响应向后兼容、诊断敏感串零泄露、三分支 `env`、双视图与次级动作结构），已接入 `npm test` 与 `npm run test:client`；扩展 `test/jobs-wait.mjs`（21 项，含取消三态与逐张提交）、`test/host-e2e.mjs`（31 项，含取消路由、历史分页与英译有/无模型）、`test/check-client-logic.mjs`（44 项）、`test/check-client-render.mjs`（36 项）、`test/daemon-unit.py`（138 项）；`check-client-locale` zh/en 各 293 键全绿。
- 远端缓存探针：`remote/daemon.py` 在模型加载前打印一次 `[cache]` 诊断行（HF 缓存目录、缓存目录与 `/kaggle/working` 的挂载点及剩余空间，token 值脱敏，异常降级 `unknown`），为后续真机确认缓存清理策略提供数据；**本轮不写缓存删除 / LRU 清理逻辑**。
- `client.js` 重新构建。

## 0.7.0 — 2026-11-11

### 改进

- **Host 本地滚动日志与诊断闭环**：运行时的排障信息不再只留在内存里，崩溃、隧道断开或代理异常后仍有本地现场。
  - `lib/log.js` 新增本地文件日志：写入 `<workspace>/.imagen/logs/host.log`，默认记录 info/warn/error（`OUR_FREE_IMAGEN_LOG` 仍只控制控制台噪音）；单文件 2 MiB 轮转、保留 1 个归档（总量约 4 MiB 封顶）；写入走串行内存队列 + 异步 append，任何 IO 错误静默降级，不阻塞请求或状态机。文件出口统一脱敏 Bearer Token、`token`/`secret`/`password`/`authorization`/`api key` 键值、`hf_`/`KGAT_`/`ghp_`/`sk-` 前缀与 URL 敏感 query 参数，并把结构化对象里的 `prompt`/`negativePrompt` 替换为 `promptLen`/`negativePromptLen`。
  - 关键链路补齐结构化打点：出图队列（enqueue / 会话等待 / 远端提交与轮询 / 完成与失败 / 关机取消）、会话状态机（`transition` 统一收口全部状态跃迁，restore 的 `probe_health_ok` / `ntfy_rejoin` / `kernel_ended_cleanup` / `invalid_record` / `no_record` 分支，心跳丢失与隧道重连的 warn）、网络降级（fetch→curl 的主机名、错误类型、耗时、状态码）与 kaggle CLI（子命令类别、耗时、退出码、failure 类型）。会话进入 error 时尽力把 Kernel 日志尾（约 30 行 / 4000 字符）写入 Host 日志，容器销毁后仍保留失败现场。
  - `GET /imagen-api/logs` 在原有 `{ ok, since, next, lines }` 上新增 `hostLines`：最近 120 行已脱敏 Host 日志，成功、`session_absent`、`logs_unavailable` 三个分支都会带，老字段语义与取值不变。工作台日志抽屉在远端日志为空时直接展示 Host 日志；「复制诊断信息」新增 `host logs` 段落，没有活跃云端会话时也能一键导出。
- **中文产品名定为「生图工作台」**：侧边栏标题、品牌名、诊断信息标题与 locale 标题统一为「生图工作台」（英文侧为 “Imagen Studio”）。
- **README 视觉截图与模型示例**：`docs/assets/` 新增工作台浅色主界面、深色模型选择卡、画廊与创作助手四张真实截图；新增 `docs/assets/showcase/`（9 个内置模型的实拍样张 + 索引清单），README / README.en 增加「模型示例」表格；`tools/preview.mjs` 的预览改用真实生图（manifest 缺失时仍退回占位图），并新增 `--readme` 一键刷新截图。

### 工程

- **仓库卫生与本地开发文档保留**：新增 `.gitattributes` 统一 LF 换行，避免 Windows 下整篇换行符假 diff；`.impeccable/`、`bench/`、`docs/archive/` 与 4 份本地规格草稿改为「`.gitignore` + `git rm --cached`」仅从 Git 索引移除，磁盘文件零删除；`docs/ANIMA_LOADER_SPEC.md` 中的真实 Kaggle 账号脱敏为 `<kaggle-username>`。
- **公开发布元信息**：`package.json` 去掉 `private`，补齐 author / repository / homepage / bugs / engines / keywords，`exports` 增加 `./package.json` 与 `./cordis.patch.yml`；`npm pack --dry-run` 产物只含运行必需文件，不含 `docs/`、`test/`、`tools/`、`bench/`。
- **CI / Release 配套**：新增 `.github/workflows/ci.yml`（ubuntu + windows、Node 20 + Python 3.11，跑契约/模型/构建/测试/npm pack 校验）与 `release.yml`（`v*` tag 触发：校验 tag 与版本一致、跑测试、打包 zip 并创建 GitHub Release，配置 `NPM_TOKEN` 时可选发布 npm）；新增 Bug 报告模板与 `CONTRIBUTING.md`。
- **修复离线包打包**：`npm run package` 在 Linux/macOS 下调用 `zip` 时工作目录不对，导致 CI 中 `dist/*.zip` 实际未生成、Release 创建失败；改为在 `dist/` 内压缩，并在 Release workflow 增加 zip 存在性校验。
- **补齐不依赖 npm 的安装方式**：README 新增 GitHub 直装（`dsh plugin add github:...`）、图形界面安装、Release tarball 直装与本地源码 link；Release workflow 额外产出 `dsh-our-free-imagen-<version>.tgz` 并随 Release 上传，商店/npm 未收录时也能一条命令安装。
- **npm 发布拆分为手动 workflow**：`release.yml` 不再包含可选的 npm 发布步骤（未配置凭据时会让发版运行变红），改为手动触发的 `publish-npm.yml`；Release 只负责测试、打包与 GitHub Release。
- **版本升到 0.7.0**：契约 / `package.json` / daemon / mock / tunnel-probe / `remote/contract.json` / `client.js` 同步；`docs/SPEC.md` 的版本标识从 0.4.1 补正为 0.7.0。
- **测试**：新增 `test/host-log.mjs`（11 项：落盘、轮转、脱敏、尾读、无工作区退化、IO 失败静默）与 `test/host-log-events.mjs`（9 项：队列事件、状态跃迁、失败现场、prompt 正文零泄露）；`host-e2e` 增加 `hostLines` 三分支与从临时工作区直读 Host 日志的断言；客户端逻辑/渲染补 hostLines 与离线诊断用例。

## 0.6.0 — 2026-11-11

### 改进

- **中文提示词不再原样送给英文模型**：九个预设都是英文提示词模型，此前中文界面下 `/intent` 会按 UI 语言输出中文 `prompt`（与 README「先翻译为规范的英文提示词」的承诺相反），`/enhance` 也往 prompt 里追加中文短语。现在：
  - `/intent` 的 `prompt` 恒定输出英文，新增 `summary`（UI 语言的本轮画面概述）只用于确认卡展示；
  - 模型资产新增 `promptStyle`（`danbooru` / `natural` / `concise`）与 `qualityPrefix`，意图解析按当前预设动态拼书写口径（Animagine 出 Danbooru 标签、FLUX/Anima 出自然语言段落、蒸馏快档出短句）；
  - `/enhance` 每条建议拆成 `text`（英文短语，真正追加进 prompt）与 `label`（界面语言短标签，中文界面显示中文、插入英文）；
  - 提示词输入框里出现中文时给一条软提示（不拦截生成），Tooltip 文案改为「请尽量用英文」。
- **切换模型自动回填负向提示词**：`models/*.json` 的 `negativeHint` 此前只被验证脚本读取，界面上完全没用上。现在切换预设时，只有在用户没写过负向词（或仍是上一个预设的推荐值）时才填入新预设的 `negativeHint`；用户自己写的负向词不会被覆盖。Animagine 这类 Danbooru 模型因此自动带上 `text, watermark, low quality…` 排除项，减少伪文字。
- **确认卡同时给出英文提示词与中文摘要**：意图卡主展示最终英文 prompt，下面补一行中文概述，用户点「按此生成」前就能看到究竟会发什么给模型。

### 修复

- **`meta.json` 记录的尺寸与真实图不一致**：Anima loader 会把宽高向下取整到 16 的倍数（16:9 档 1152×648 → 实际 1152×640），但远端 `run_task` 回传的是请求值。现在统一回传 PIL 实际出图尺寸，请求与实际不一致时远端日志会打印差异。
- **任务等待是 700ms 一次的进程内轮询**：`JobQueue.waitFor` 原先 `while + sleep(700)` 反复查自己的内存数组，Agent 工具默认要等 90 秒。改为事件驱动：任务进入终态时唤醒全部等待者，超时/卸载路径各自收敛，返回形状不变。
- **轮询定时器会重叠执行**：`SessionManager.every()` 用 `setInterval` 且不感知回调 Promise，网络慢或 `kaggle.exe` 慢时 `pollTunnel` / `pollKernelStatus` 会叠加多个请求与子进程。改为单飞自调度延时链（上一拍 settle 后才排下一拍），`clearTimers()` 能阻断在飞的一拍续排；立即首拍与排期拍复用同一 Promise。
- **产物落盘不是原子的**：PNG 与 `meta.json` 原先直接 `writeFile`，中断会留下半截文件。改为同目录临时文件 + rename（图片先落、`meta.json` 最后作为完成标记），失败清理临时文件。
- **前端 `sending` 状态可能不复位**：`generate()` 在 `alive()` 返回 null 或后续抛错时会跳过 `setSending(false)`，改用 `try/finally` 兜底。

### 工程

- **Anima 运行时改为单份源码 + 打包内联**：`remote/daemon.py` 与 `tools/payload/verify-model.py` 曾各内嵌一份约 1100 行、注释要求「必须逐字同步」的 Anima 实现。现在抽成唯一的 `remote/anima_runtime.py`，两个入口各保留一行带 `# @@INLINE:anima_runtime.py@@` 标记的普通 import；`lib/kernel.js` 新增 `inlineMarkedModules()`，打包时把标记行整行替换为模块全文，Kaggle 推送产物仍是自包含单文件。daemon 由 3478 行降到 2360 行，验证 payload 由 1442 行降到 315 行；`test/kernel-package.mjs` / `test/check-verify-model.mjs` 增加「无未内联 import / 无残留标记 / 运行时恰好一份 / Python 语法可编译」断言。未做真机 GPU 复跑，推理链路与改动前是同一份源码。
- **前端碎屑文件合并**：`capsules.js` + `ratios.js` 合并为 `src/studio/presets.js`；`plates.jsx`（试印条 SVG）内联进 `Rail.jsx`；`recall.js`（历史回填）并入 `src/logic/generate.js`；意图/预设的纯逻辑改名为 `src/logic/preset.js`，避免两个 `presets.js`。`RATIO_IDS` / `STYLE_IDS` 收敛到契约唯一来源。
- **版本升到 0.6.0**：契约 / package.json / daemon / mock / tunnel-probe / `remote/contract.json` / `client.js` 同步；契约新增 `RATIO_IDS`、`STYLE_IDS` 导出，`PRESETS` 公开视图随模型资产新增 `promptStyle`、`qualityPrefix`。
- **测试**：新增 `test/jobs-wait.mjs`（8 项）；`session-pure` +3（自调度不重叠、清定时器不续拍、健康轮询单飞）；`library-atomic` +2（原子写与失败保留旧产物）；`host-e2e` 增加假宿主 LLM 的意图/润色模型路径断言；`daemon-unit` 127 项、`kernel-package` 8 项、`check-verify-model` 7 项；客户端逻辑 35 项、渲染 24 项。`npm test` 已接入 `jobs-wait`。

### 文档

- `docs/SPEC.md`：`/intent` 新增 `presetId` 请求参数与 `summary` 响应字段并写明「prompt 恒英文」；`/enhance` 响应改为 `{id, text, label}`；预设字段补 `promptStyle` / `qualityPrefix` / `negativeHint` 的回填规则；提示词 Tooltip 与润色说明按新行为改写。
- `docs/MODEL_ASSET_SPEC.md`：新增 §2.1 提示词配方字段；把「双份 loader 逐字同步」改为「单份源码 + 打包内联」。
- `docs/ANIMA_LOADER_SPEC.md`：第 4 节按 `remote/anima_runtime.py` + 标记 import + 打包内联重写，补「真实尺寸回传」说明。
- `docs/DESIGN.md`：试印条出处由已删除的 `plates.jsx` 改为 `Rail.jsx` 内的 `StylePlate`。
- 新增 [docs/EXTERNAL_AUDIT_REVIEW.md](docs/EXTERNAL_AUDIT_REVIEW.md)：外部代码审计的逐条复核结论（属实 / 不成立 / 风格或高风险项），以及 `kaggle kernels logs` 延迟实测数据与「不替换 ntfy」的决策依据。

## 0.5.0 — 2026-11-11

### 改进

- **远端生成改为异步 job 协议，修掉长请求被隧道/代理掐断**：此前 `POST /generate` 同步挂起整段采样，期间不返回任何字节；实测在 Cloudflare quick tunnel + 本地代理链路上，80 秒级的请求（新增的 Anima 模型）会在中途被 `context canceled` 掐断，daemon 仍算完但结果无处可送。协议改为：`POST /generate` 只校验并入队，立即返回 `202 {status:"accepted", job_id}`；Host 每 2 秒 `GET /job?id=<job_id>` 轮询到 `done`（带 `results`）/ `failed`（带 `error.code`）。请求体新增 `jobId` 幂等键，重复提交不会在远端产生重复任务；任务整体预算默认 10 分钟（`generateTimeoutSeconds` 可覆盖），轮询期间容忍连续 5 次网络抖动。
- **远端失败语义不变**：校验失败仍是同步 400 `invalid_request`，phase 未就绪仍是同步 503 `warming`/`load_failed`；运行期失败写进 job 的 `error.code`（`oom` / `load_failed` / `generation_failed` …），Host 原样透传，不需要「提前 200 再丢 500」。

### 工程

- `shared/contract.js`：`VERSION` 0.4.1 → 0.5.0；`PROTOCOL.daemon.routes` 增加 `GET /job`；`TIMEOUTS` 用 `remoteSubmitMs` / `remoteJobRequestMs` / `remoteJobPollMs` / `remoteJobMs` 取代 `remoteGenerateMs`。
- `remote/daemon.py`：新增常驻 worker 线程、job 表（保留 8 个已结束任务，TTL 600 秒）与 `GET /job`；`/health.queue_depth` 改为排队中任务数。
- `lib/remote.js`：新增 `submitGenerate` / `fetchJob` / `waitForJob`，`requestGenerate` 变成「提交 + 轮询」的便捷封装；`lib/jobs.js` 用 `job.id` 做幂等键并按轮询进度更新 `stage`。
- `test/mock-daemon.py`、`test/host-e2e.mjs`、`test/session-pure.mjs`、`test/daemon-unit.py` 跟随新协议；`remote/contract.json` 重新生成。
- 文档：`docs/SPEC.md` 补异步 job 协议说明；`docs/ANIMA_LOADER_SPEC.md` 的批处理限制按新超时更新。

## 0.5.0 补记：模型选择卡、9 个预设与状态文案（已随 0.5.0 发布）

### 改进

- **云端状态按真实阶段展示**：此前顶栏胶囊只看 `session.state`，`connecting` 与 `warming` 都写成「正在装载模型」，于是用户看到「正在申请 GPU → 正在装载模型」的跳变，中间真正耗时最久的排队、建隧道、装依赖阶段没有交代。现在 `src/logic/status.js` 的 `computeStatusOf()` 同时读取 `state + phase`，按「推送环境 → 排队等 GPU → 连接云端 → 准备模型 → 就绪」给出短标签与一句话提示；顶栏胶囊、算力弹层、对话页徽章与新增的过渡态状态条共用这一份派生，不再各写一套。
- **等待过程可见**：新增 `.ofs-sessionbar` 状态条，过渡态下常驻显示「在等什么 + 一句预期 + 已等待时长」，页面隐藏时不再只有一个小圆点在呼吸；窄窗口隐藏提示句、保留标签与计时。
- **任务进度与云端状态分开**：任务进度改用 `jobProgressText()` 区分「等待云端就绪」「排队等待出图」「正在生成」，修掉会话已就绪却显示「正在申请 GPU」的误报。
- **文案去脆化**：排队时间统一为 3~10 分钟（此前帮助文案 5~10、提示框 3~8 互相矛盾）；删掉写死的「6s/张」「首次约 11 秒」，改为弹层里展示当前已载模型的实测单张耗时；删除 `studio.ghost.*`、`studio.stage.rendering` 等重复/死文案；动作与状态统一为「唤醒 / 关闭云端 / 云端已关闭」，宿主侧「重新启动会话」同步改为「点『唤醒』」。
- **等待时长不再虚报**：状态条的「已等待」只在申请 GPU 阶段计时；重连或从本地恢复的会话沿用旧 `startedAt`，不再把整段运行时长当成等待时长。手动关闭云端后，舞台空态改为「云端已关闭，先点『唤醒』再生成」，不再承诺可以直接出图。
- **状态归因更准**：`SessionManager.snapshot()` 增加 `stoppedByUser`，手动关机后显示「云端已关闭」，不再承诺「直接生成会自动启动」；用户主动关机导致的任务失败改用独立的「云端已关闭，任务没有执行」指引卡，不再套用闲置休眠文案；错误态按错误码给出「账号凭据不可用 / 未安装 Kaggle CLI / 推送失败 / 等待超时」短标签；`push_failed` 不再归成「云端异常」。
- **首图提示不再误报**：`useWorkLibrary` 的首图 toast 以首次拿到 `/state` 时的 `lastJob` 为基线，只在观察到新完成批次且云端确实就绪时提示，重挂载或插件重载后不会对旧结果重复提示「云端就绪」。
- **无障碍与英文文案**：大图预览关闭按钮的 `aria-label` 从「知道了」改为「关闭大图」；去掉胶片条重复的 `role="status"`；中英文案同步重写（阶段词大写、排队/连接/预热提示按真实阶段区分）。

### 修复

- **深色模式下禁用的主操作文字看不见**：主操作按钮（立即生成、对话确认卡的「按此生成」）被禁用时沿用 36% 透明度，但文字色写死成 `#fff`。浅色主题的主操作是墨黑渐变、白字正好；深色主题的主操作反相成浅色渐变，白字落在浅底上几乎不可见。禁用态文字色改为跟随 `--ofs-accent-ink`（浅色主题白、深色主题墨黑），浅色主题的观感逐像素不变。
- **多个排队任务只显示一个**：队列串行执行，但同时提交的两个任务会被宿主按顺序排好（`/state.jobs` 是「最新在前」）。客户端此前把列表里第一个活跃任务当成「当前任务」，于是后提交的排队任务顶替了真正在生成的那张——进度文案写「排队等待出图…」，底部最近生成栏也只画得出一张卡。现在 `pendingJobsOf()` 按「进行中 → 等待云端 → 排队中（提交顺序）」排序：进行中的任务永远是第 1 位，胶片条给每个待执行任务各画一张卡（进行中带显影扫描光与已用时间，排队中带位次与已排队时长），进度文案、舞台与对话气泡都跟随真正在跑的任务。对话线程也改为每个任务气泡按自己的任务更新，先完成的那条不会再停在「已提交，等待开始…」。
- **算力弹层账号状态误报「不可用」**：此前只要本轮没有手动点过「检查环境」，`/state` 的 `probe` 就是 `null`，弹层里的账号行会落到硬编码的 `unavailable`，于是一边正常出图、一边提示「账号 · 不可用」。现在账号状态由 `accountStatusOf()` 统一推导：探测通过、或会话已推进到 provisioning/connecting/warming/ready/stopping（内核推得上去、GPU 连得上，本身就是真实 API 调用成功），都显示「正常」；只有确实没有任何成功证据时才保留上次探测的失败结论；从未探测过显示「未检查」。新增 `sessionProvesAuth()` 与对应的逻辑/渲染回归测试。

### 工程

- **模型资产抽象（无行为变化）**：`shared/contract.js` 里的 4 个预设拆成 `models/<id>.json`（单模型单文件、字段扁平，新增 `order`、`runtime: "default"` 与 `measured` 实测块）；新增 `tools/build-assets.mjs` 生成 `shared/models.generated.js`，`contract.js` 只做 re-export；`check-contract` 增加第 k 项「生成文件与 models/ 同步」，`npm test` 接入 `models:check`。生成后的 `PRESETS` 与改造前逐字段深比较一致。
- **模型验证脚本**：新增 `tools/verify-model.mjs` + 远端 payload `tools/payload/verify-model.py`，支持 `--config / --write / --dry-run / --timeout`；复用 `lib/kernel.js` 打包与 `lib/kaggle.js` 推送/日志/产物下载，实跑回填显存、加载、首图、稳态与下载体积；失败按类别归因并打印最后 20 行日志。离线回归 `test/check-verify-model.mjs` 已接入 `npm test`。
- **模型录入 Agent Skill**：新增 `skills/model-asset-intake/SKILL.md`，把「外部链接 → 草稿 → dry-run → 真机验证（先确认配额）→ 失败自愈 → 入库 → build/check/test」固化成可执行 SOP；`docs/MODEL_ASSET_SPEC.md` 补双份 loader 维护约定与阶段状态。
- `.gitignore` 增加 `.tmp/`（模型草稿与验证产物目录）。
- **模型资产扩容（Kaggle 真机实测）**：新增 4 个预设 `playground-v2.5`（美学旗舰）、`realvis-v5`（超写实摄影）、`animagine-xl-3.1`（二次元插画）、`hyper-sdxl-8step`（8 步蒸馏快档），模型总数 4 → 8；`measured` 全部由 `tools/verify-model.mjs --write` 真机回填。四个模型在单张 T4 上显存峰值均低于 10.4 GB，稳态耗时 7.74–28.34 s，全部一次推通、零重试。
- **MiniMax-H3-Image 部署可行性试验（结论：不可部署）**：最小可用文件集 24.74 GB 超出 `/kaggle/working` 实测的 19.52 GiB；官方 diffusers 路线需约 65 GB 峰值显存；ComfyUI + GGUF 路线在 2×T4 上默认模式因 32B 文本编码器差 0.46 GiB 而 OOM，CPU 流式能跑完 6 步但 1 MP 产物为纯白。该模型不纳入 `models/`，定量证据与改造清单写入文档。
- **新增 `anima` loader 与预设 `anima-light-lavender`（Kaggle 真机实测）**：`Johnny-Z/Anima-Light-Lavender` 是 ComfyUI 单文件 checkpoint（Cosmos-Predict2 2B DiT + Qwen3-0.6B 文本编码器 + Qwen-Image VAE + Qwen2/T5 双分词器），没有 diffusers 仓库结构，`from_pretrained` 无从加载。护展 loader 枚举（`sdxl` / `sdxl-lora` / `flux2` / `anima`），`tools/payload/verify-model.py` 与 `remote/daemon.py` 各内嵌一份逐字一致的运行时：按权重布局构造 DiT 与 LLMAdapter、结构化 Danbooru caption 包装、euler + simple（shift 3.0）采样、CFG-Zero★、dtype 按 compute capability 判定（T4 → fp16）、文本编码器编码后卸到 CPU 并按文本缓存 embedding、逐 step latent 有限性检查、解码 OOM/NaN 兜底。模型总数 8 → 9，实测（1024×1024/25 步/CFG 4.0）显存峰值 8470 MB、加载 43.5 s、首图 87.63 s、稳态中位 80.64 s、下载 5.25 GiB，样张与提示词一致。GPU 侧排障两轮：bf16 在 sm_75 上被模拟执行（8.7 s/前向）且 VAE 解码 OOM；fp16 因残差流在 block27 冲到 5.1e4~5.6e4（fp16 上限 65504）而溢出，改为「权重 fp16、残差流与归一化 fp32」后稳定。
- **模型选择卡扩到 9 个预设**：新增 `anima-light-lavender` 海报（Pexels 二次元角色手办特写，概念示意）与选择器映射；9 张海报 base64 合计 20116 字符（含 `data:` 前缀 20323），仍在 20 KB 预算内；家族徽标新增 `Anima`。

### 文档

- **`docs/MODEL_EXPERIMENT_GUIDE.md`**：新增 1.4 实跑结果（4 个模型的显存/加载/稳态/下载实测表与 6 处草案修正）、2.4 MiniMax 实测结论；修正许可证标注（OpenRAIL++ / OpenRAIL++-M）、Hyper-SD LoRA 与非 CFG 配置、`allowPatterns` 收窄与 fp16 变体，并纠正「7.3 GB 轻量文本编码器」的错误表述。
- **`docs/MINIMAX_H3_IMAGE_SPEC.md`**：新增第 7 节 Kaggle 真机实测（磁盘/显存/下载速度/最小文件集/路线对比/出图尝试/上线改造清单），并修正原文「Q4_K_M 可在 Kaggle 跑通」「9B 轻量文本端」两处结论。
- **`docs/MODEL_ASSET_SPEC.md`**：实施状态补阶段 D（模型资产扩容）与阶段 E（新增 `anima` loader、模型总数 8 → 9）。
- **`docs/ANIMA_LOADER_SPEC.md`**（新增）：`anima-light-lavender` 的模型事实、为什么需要新 loader、`pipeline` 字段契约、双份实现落点、Kaggle T4 三轮实测与故障记录、已知限制与量化路线结论。
- **`docs/MODEL_CARD_SPEC.md`**：模型数量 8 → 9，补 `anima-light-lavender` 行与海报来源、更新海报体积预算（20116 字符）与验收标准。
- **`docs/MODEL_EXPERIMENT_GUIDE.md`**：新增 1.5 节，记录 `anima` loader 的实测结论与「为什么 INT4/INT8 量化不是提速手段（T4 缺 FP8 tensor core、无该 checkpoint 的量化版本、weight-only 量化不省时间）」。`README.md` 的模型清单同步为 9 个。
- **`skills/model-asset-intake/SKILL.md`**：loader 清单补 `anima` 与「单文件 ComfyUI 仓库没有 `model_index.json` 时如何判定架构」的说明。

## 0.4.1 — 2026-11-11

### 修复

- **pip 依赖约束回归（远端 `load_failed`）**：0.4.0 默认下发的版本上限（`transformers<5` 等）与当前 diffusers 新版依赖的 `huggingface-hub>=1.32` 无法同时满足，pip 解析回溯到 2019 年的 `transformers 4.12.2`，在 Kaggle 镜像中直接以退出码 1 失败。0.4.1 改为**默认不钉版本**，`pipConstraints` 只作为用户显式复现手段；带约束安装失败时自动去掉约束重试一次并记录 WARN。
- **错误可诊断**：pip 安装失败的 `LoadError` 现在附带 pip 输出最后几行（不再只有退出码）；Host 侧 `remote_error` 文案截断从 400 放宽到 700 字符；依赖导入自检增加 `from diffusers import DiffusionPipeline`，把「装上了但 import 不了」提前暴露。
- **版本单源升到 0.4.1**：契约 / package.json / daemon / mock / probe / SPEC 同步，`remote/contract.json` 重新生成。

### 文档

- 新增 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)：pip 版本冲突复盘与判断表、venv 取舍、磁盘/隧道/凭证/会话恢复等已知问题。
- README 的 `pipConstraints` 说明与故障排查入口更新；ARCHITECTURE 增加远端依赖安装策略；ROADMAP 同步 P1.2 结论。

## 0.4.0 — 2026-11-11

### 稳定性（P0）

- **会话本地持久化与启动恢复**：Host 把 `kernelId`、`token`、`topic`、`endpointUrl` 等实时写入 `<workspace>/.imagen/session.json`（同目录临时文件 + rename 原子写，目录 0700 / 文件 0600），DSH 重启或插件热重载后自动恢复：`/health` 探活成功直接接管（ready/warming），地址失效但有 topic 则回 ntfy 重新会合，Kernel 已结束或没有地址线索时尽力关机并清理记录。恢复与 `start`/`stop` 的代次机制共存，过期恢复不写状态、不挂定时器；`stop` 与成功的 `dispose` 删除记录，失败保留供下次清理。token 只落盘，不进日志与对外快照。
- **远端隧道自愈**：`remote/daemon.py` 的隧道启动拆成可测试的纯函数（命令规整、地址提取、通道计划、退避），新增常驻监管线程：cloudflared 中途退出时记录 warn、清空发布状态、按 2→60 秒指数退避重拉，拿到新地址后重新广播 ready；主循环每 300 秒重播一次 ready，Host 心跳丢失后可重新会合。`/health` 新增 `tunnel_provider` / `tunnel_state` / `tunnel_restarts`，ready 事件新增 `provider`。

### 可观测性与冷启动（P1）

- **运行日志抽屉**：新增 `GET /imagen-api/logs?since=N`（始终 HTTP 200，用 `ok` 与 `code` 表达可用性），把远端 daemon 日志环透传给工作台。算力弹层新增「查看运行日志」：打开时增量轮询、关闭即停，支持空态/不可用原因/自动滚底，并可一键复制诊断信息（版本、会话快照（剔除 token）、探测结果、队列、最近 60 行日志）。新增错误码 `logs_unavailable`。
- **冷启动加固**：依赖安装带上 constraints（默认 `diffusers<1.0`、`transformers<5`、`accelerate<2`、`peft<1`，可用 `pipConstraints` 按包名覆盖），安装后独立进程做 `import torch/diffusers/...` 自检并打印版本；支持可选 `hfToken`（HF_TOKEN / HUGGING_FACE_HUB_TOKEN，不落日志）；下载权重前按 `downloadGb` 做磁盘预检（需 1.15 倍余量），不足时报「需 X GiB / 可用 Y GiB」。
- **配额可见性容错**：探测失败或配额不可读时，算力弹层回退展示本地统计——最近一次成功检查时间与当时配额、当前会话已运行时长，并给出 Kaggle 账户设置直达链接。`/state` 新增 `probeLastGood` / `probeLastGoodAt`。
- **隧道通道可见**：会话快照新增 `tunnelProvider`，算力弹层显示当前隧道通道（Cloudflare / 自建通道）。

### 体验与发布（P2）

- **权重预挂载**：新增 `datasetSources`（写入 kernel-metadata 的 `dataset_sources`）与 `localModels`（仓库 → 容器内目录映射）；远端命中本地目录（含 `model_index.json`）时直接加载并跳过下载与磁盘预检，LoRA 优先使用本地权重文件。非法 Dataset 标识会告警并过滤，不影响会话启动。
- **备用隧道通道**：新增 `fallbackTunnelCommand`（argv 模板，支持 `{port}`）与 `fallbackTunnelUrlRegex`；cloudflared 失败或超时后自动尝试备用命令，成功后 provider 记为 `custom` 并重播 ready，备用进程同样纳入监管重拉。Host 侧用 `trustedTunnelDomains` 白名单校验会合地址，未登记的域名不会收到 token。
- **窄屏与完成提醒**：≤820px 时画面预览置顶、面板在下方自身滚动，提交任务后进度与图片始终留在视口；离开页面期间任务完成会在标签页标题加「● 生成完成 · 」，返回后恢复标题并提示一次，首次挂载不触发。
- **无障碍**：大图预览与日志抽屉加焦点陷阱、Esc 关闭与关闭后焦点归还；所有图片补有意义的 alt（提示词 → 文件名 → 文案回退）；`pointer: coarse` 下图标按钮、玻璃按钮、dock/tab/画廊动作等热区 ≥44px。
- **发布合规**：补齐 MIT `LICENSE`、`package.json` 的 `license` 字段与版本 0.4.0；新增 `npm run package`——构建 `client.js` 后按 `files` 清单产出 `dist/<name>-<version>/` 可加载目录并尽力压缩 zip；`dist/` 加入 `.gitignore`。

### 工程与文档

- 契约新增 `ROUTES.logs`、`TIMEOUTS.remoteLogsMs` / `clientLogsPollMs`、`ERROR_CODES.logs_unavailable`、`PROTOCOL.daemon.tunnelProviders`，预设 pipeline 增加 `downloadGb`；版本号单源升到 0.4.0（契约 / package.json / daemon / mock / probe 同步）。
- 新增 `test/session-restore.mjs`（79 项）、`test/kernel-package.mjs`（5 项）；`test/daemon-unit.py` 51 → 101 项；`npm test` 与 `test:host` 纳入新测试。
- `docs/SPEC.md` 补日志路由、会话持久化、快照与 `/state` 字段、错误码；`README.md` 增加可选配置表、日志/恢复/打包说明；`docs/ROADMAP.md` 标记 P0/P1/P2 完成状态。

## 0.3.0 — 2026-11-10

### 界面与文案去 AI 味（V2 规格）

- **文案全量重写**：中英双语各 220 键，逐条按平实、直接的桌面软件语气改写；去掉装饰性 emoji 与「智能」「即刻」类强调词；废弃焦舞台、胶卷、抽卡、工坊、资产画廊、以此图微调、换种子抽卡等借喻，统一为画面预览、最近生成、创作、作品画廊、带回参数、生成变体。
- **布局**：删除 72px 图标栏（`RailNav.jsx`），改为固定 320px 单轨创作面板，视图切换与 GPU 状态全部收在顶栏；「最近生成」保留底部整页 dock。窄屏仍按「面板在上、画面在下」收纳。
- **悬浮提示**：新增 `Tooltip` 组件（悬停、键盘聚焦、触屏点击触发，`Esc` 或点击别处关闭），提示词、排除项、采样步数、引导强度、Kaggle 账号与空闲休眠六处把长篇说明收敛进 `(i)` / `(!)`。
- **灵感与润色**：提示词下方常驻 5 组灵感预设，输入框为空时填入、已有内容时换行追加；润色改为宿主模型返回光影 / 材质 / 构图 / 氛围四维标签，点击追加、再点撤销，按预设与语言自适应，模型不可用时使用同结构的本地建议。
- **创作助手**：对话模式改为大模型意图解析——一句话生成确认卡（整理后的提示词、比例、风格、「按此生成」）；用户要求互相矛盾时出澄清卡；模型不可用时按当前设置自动决定；后续消息作为增量修改继承上一轮描述。
- **作品画廊**：卡片悬停提供「带回参数 / 生成变体 / 查看大图」；顶栏新增「在文件夹中打开」，由宿主 `subprocess` 调起系统文件管理器且只允许产物目录；历史接口回传绝对路径，复制与批量导出都是绝对路径。
- **接口**：新增 `POST /imagen-api/intent`（意图解析）与 `POST /imagen-api/reveal`（打开产物目录，支持 `dryRun` 自检）；`/imagen-api/enhance` 改为四维结构化输出并接收 `presetId` / `locale`；`/imagen-api/history` 每条图片新增 `absolute`。
- **工程**：文案检查扩扫 `.jsx`；逻辑测试补润色标签、灵感文案与意图映射；新增 `lib/intent.js`、`src/logic/{refine,intent}.js`；预览工具新增润色面板与画廊悬停场景。
- **清理**：删除失效字典键 65 个、`src/studio/RailNav.jsx`、未引用的 `src/utils/clipboard.js`、比例死标签与已无对应 DOM 的 CSS。

### 评审修正（2026-11-10）

- **画廊动作契约**：悬停「带回参数 / 生成变体 / 查看大图」改为接收完整 `{ image, item }` 条目（此前传的是裸 history item，带回参数静默失效、生成变体误报「先写提示词」）；带回参数会切回创作页，查看大图直接进入放大层。补充组件级回归测试。
- **悬浮提示定位**：固定弹层的坐标按真实包含块（带 `backdrop-filter` 的 `.ofs-app`）换算并在容器内夹紧，左侧字段的提示不再被裁掉；定位算法抽到 `src/logic/tooltip.js` 并有单测，另用无头 Edge 截图核对。
- **对话与比例**：解析进行中按回车不再吞掉草稿；意图卡不再提前改写左侧表单；连续迭代沿用上一张图的种子；补齐 4:3 / 3:4 两种画面比例（含意图解析与比例图形）。
- **润色标签**：只撤销「独立成段」的短语，不再误删句子中恰好包含的同名词（如「霓虹灯光效」里的「灯光」），中英混排也不留悬空逗号。
- **其他修正**：意图接口拒绝空内容（400）；排队 / 预热状态点加入呼吸动效；触屏设备常显画廊操作；批量复制仅在已选时可用；删除失败时保留选择；补齐 8 个宿主错误码文案；`docs/SPEC.md` 更新到 0.3.0 并补全新路由。
- **清理**：移除失效 CSS 选择器（`ofs-tag` / `ofs-input*` / `ofs-scroll` / `ofs-error` / `ofs-row-hint` / `ofs-btn--sm`）与仅测试可达的 `buildPresetView` 及其 10 个文案键。

### 可用性硬化（2026-11-10）

- **会话失效可感知**：进入 `ready` 后不再停掉 Kernel 状态轮询（30s）；心跳连续失败时先查 Kernel——已结束转 `session_ended`/`remote_error`，仍 `RUNNING` 则重取隧道地址，恢复窗口内仍失败转 `health_failed`。修复「空闲 30 分钟后界面永远显示在线、每张图都失败」。
- **会合失败快速报错**：解析 daemon 通过 ntfy 发出的 `type:'error'` 事件立即失败，并区分「仍在排队」与「容器已运行但未会合」；不再等满 45 分钟 `queue_timeout` 再给出归因错误的提示。
- **代理环境可用**：`/health`、`/generate`、`/shutdown` 全部改走 `lib/net.js`（fetch 失败降级本机 curl），curl 兜底按真实 HTTP 状态码解析并支持大响应体。
- **停止语义成立**：用户主动关机后排队任务不再自动拉起新 Kernel（`error.code='stopped'`）；start/stop 竞态不再留下僵尸轮询；dispose/fail 尽力通知远端退出，降低孤儿 Kernel 的配额浪费；push 失败清理含 token 的临时 Kernel 目录。
- **启动异常兜底**：`kaggleUsername` / `buildKernelFolder` / `pushKernel` 抛异常时统一收敛为可读错误并清理目录，不再永久卡在 provisioning。
- **历史与产物**：`/imagen-api/history` 回传完整 `params` 与 `finishedAt`（舞台提示词、以此图微调不再取错参数）；产物文件名改用本地序号，不再拼接远端返回的 name。
- **环境探测**：version 之后 auth/quota/username 三路并发（一次检查从 90s 降到约 20~30s）；区分 `cli_missing` 与 `cli_timeout`，修正重复的版本串；CLI 超时放宽到 30s。
- **客户端**：风格胶囊后缀真正进入最终 prompt、取消风格同步收回负向词；换种子抽卡基于当前选中图；风格/抽卡/重试均走可离线测试的纯逻辑模块；指引卡支持 cli/session/generate/generic 四类、可关闭、带详情行与正确动作；探测有进度、45s 超时兜底，成败只看 `payload.ok`；负向提示词在 cfg=0 时给出说明。
- **本地库**：`library.json` 改为进程内串行队列 + 临时文件 rename 原子写，多窗口并发收藏/删除不丢更新；文件损坏时返回 `notes` 并备份 `.corrupt-*`。
- **测试**：新增 `test/session-reliability.mjs`（26 项）、`test/session-race.mjs`（44 项）、`test/library-atomic.mjs`（12 项），客户端逻辑测试扩到 20 项、渲染场景扩到 12 项；`npm test` 纳入全部离线断言。

### 变更

- **工作台视觉重建（黑白灰工作室）**：整页改成 `工坊 / 画廊` 两视图 + 左图标栏 + 创作面板 + 悬浮画布 + 底部胶片坞的结构；主题色收敛为黑白灰，唯一强调色是墨黑（主按钮、选中环、激活图标），去掉彩色渐变、彩色光晕与「AI 产品画布」式装饰。深色主题按同一明度关系反相：深灰底、浅灰字、浅色主操作。样式从单文件 `src/styles.css` 拆成 `src/styles/` 下的 tokens / base / shell / panel / stage / filmstrip / gallery / chat / responsive 九个模块，由 `src/styles.js` 聚合并仍以文本形式打进单文件 bundle。
- **画廊改为作品卡片墙**：工具条收成一张玻璃卡（搜索、按模型过滤、只看收藏、批量选择、导出、删除），内容按「今天 / 本周 / 更早」分组；卡片按图片原始比例自然高度瀑布流，悬停轻抬升，含两行提示词、模型与种子标签、右上角收藏星标；批量模式下显示选择圆点与确认删除。
- **对话形态重做**：左侧面板的对话形态改为无头像消息流（用户浅灰气泡靠右、助手卡片带状态点与可选缩略图），生成中状态用微光条而不是转圈；底部输入区是悬浮卡片 + 圆形发送钮，扩写与清空入口收在输入区上方。
- **画布与舞台**：图片按比例居中并带柔和投影，右上角悬浮「查看原图 / 复制路径 / 收藏」玻璃按钮；图下一行提示词，右下角显示分辨率 · 耗时 · 种子；动作胶囊（以此图微调 / 换种子抽卡 / 复制文件路径）留在画布下方。
- **胶片坞**：从深色胶片带改为底部悬浮玻璃条，按批次展示缩略图与模型/张数标注；进行中任务显示带微光的骨架卡；右侧入口通往资产画廊。
- **顶栏**：品牌标 + 工坊/画廊分段切换 + 云端算力胶囊（点击查看免费额度、闲置休眠、设备与唤起/休眠/检查凭据）+ 模型预设选择 + 刷新历史。
- **图标**：补齐 `search / sparkles / message / images / expand / dots / plus / refresh / check / chevronRight / clock / cloud` 等手写图标，新增图标栏与对话面板需要的条目，全部保持 24×24、1.6px 圆角描边。
- **对话页徽章**：与工作台同一套黑白灰语言，改为中性胶囊 + 语义状态点，宿主深色主题下自动反相。
- **工程**：新增 `src/studio/RailNav.jsx`；`tools/preview.mjs` 支持整页、独立画廊、独立对话、深色与 390 宽 iframe 预览，占位图改为五种中性抽象构图；测试基准（`test/render-golden.json`）随 DOM 结构更新。

## 0.2.0 — 2026-11-09

### 新增

- **远端会话生命周期**：`lib/session.js` 完整实现 push → 排队 → 隧道 → 握手 → ready 的状态机，带排队/隧道超时、Kernel 状态轮询与失败原因回传。空转视为 `absent`，重复调用幂等。
- **Kernel 打包与配置注入**：`lib/kernel.js` 每次会话生成一次性 Kernel 目录，把 Token、ntfy topic、预载模型描述以 Base64 注入脚本；`--accelerator NvidiaTeslaT4` 申请 2×T4。
- **出图任务队列**：`lib/jobs.js` 串行队列，参数校验与钳制（尺寸取 8 的倍数、步数 1–60、CFG 0–20、张数 1–4），同批多张使用递增 seed。
- **本地产物**：`lib/output.js` 把图片与 `meta.json` 落到 `<workspace>/imagen-output/<时间戳>-<jobId>/`，并提供历史扫描与预览 URL。
- **Host 路由**：新增 `session/start`、`session/stop`、`generate`、`job`、`jobs`、`history`、`file`，`state` 扩展为完整工作台数据源。
- **Agent 工具**：`imagen_generate`、`imagen_session`、`imagen_history`，对话中可直接出图与查询历史。
- **前端工作台**：`client.js` 重写设置页，包含会话控制、参数区、进度、图墙（点击放大、复制路径）与历史；对话页头部徽章显示会话与任务状态。
- **远端 Daemon v2**：`remote/daemon.py` 重写为常驻服务，包含依赖安装、模型加载分支（`sdxl` / `sdxl-lora` / `flux2`）、日志环、`/logs` 增量拉取、错误分级与空闲退出。
- **出站网络降级**：`lib/net.js` 在进程内 `fetch` 失败时改用本机 `curl`，保证代理环境下的 ntfy 访问。
- **测试**：`test/host-e2e.mjs`（mock daemon，15 项断言）、`test/kaggle-live.mjs`（真实 Kaggle 链路）、`test/tunnel-probe.py`（不占 GPU 的探针）、`test/mock-daemon.py`（本地联调）。

### 修复

- **插件整体加载失败**：cordis 的服务访问是严格的，`inject` 未声明 `tools` 时读取 `ctx.tools` 会直接抛错，导致 `apply` 中断、`/imagen-api/*` 全部 404。已把 `tools` 加入 `inject`，并提供 `test/verify-loaded.mjs` 做重启后的加载检查。
- **Kernel 配置注入失效**：占位符按字面量首次匹配，会命中脚本注释里的同名字符串，导致真实赋值行未注入。改为行首锚定的正则替换。
- **Kernel 失败信息不可读**：`kaggle kernels logs` 输出是 JSON 事件流且混有 notebook 转换噪音，直接截尾会把 `Traceback` 挤掉。改为还原文本、过滤噪音后取尾段。
- **ntfy 发布失败**：`Content-Type: application/json` 会被 ntfy 当作发布指令解析而返回 400，改为 `text/plain` 携带 JSON 字符串。
- **cloudflared 管道阻塞**：拿到域名后不再读取 stderr 会让子进程写满管道卡死，改为独立线程持续 drain。
- **Kaggle 镜像依赖冲突**：镜像自带 `torchao 0.10.0` 与新版 `diffusers` 冲突，daemon 启动时先卸载再升级 `diffusers/transformers/accelerate/peft`。
- **权重下载撑爆磁盘**：SDXL 按 `fp16` 白名单预拉取，避免整仓几十 GB 占满 20GB 工作目录。

### 文档

- 新增 `docs/SPEC.md` 作为三端实现契约；根目录 `DESIGN.md` 重写为当前架构；`README.md` 补充使用与测试方式。

## 0.1.0 — 2026-11-09

### 新增与重构

- **文档与工程体系精简**：
  - 清理冗余的规格文档、过度抽象的 Provider 接口及 ADR 记录，聚焦核心开发。
  - 整合输出核心设计 `DESIGN.md` 与实测基准 `docs/SPEC.md` 第 4 节。
  - 明确技术演进路线 `docs/ROADMAP.md`。
- **DSH 插件骨架**：
  - Host 端：提供 `/imagen-api/state` 与 `/imagen-api/probe` 状态及探针路由。
  - Client 端：设置页与状态徽章，支持实时检查 Kaggle CLI、凭据有效性与 GPU 配额。
  - 远端运行环境：收敛至 `remote/daemon.py` 与 `remote/worker.py`。
