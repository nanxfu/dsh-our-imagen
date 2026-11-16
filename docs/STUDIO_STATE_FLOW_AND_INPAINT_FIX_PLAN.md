# 生图工作台状态流转与局部重绘可用性修复规划

> **状态**：✅ 已完成（2026-11-17；P0-a ~ P2 全部落地，离线全绿，真机复验通过）  
> **基线**：`0.12.0` 未发布工作树（局部重绘、Agent 批量创作、工作台流转已提交 `bb5d2a9`）  
> **触发**：0.12.0 局部重绘上线后的逐条代码审计  
> **文档性质**：问题清单 + 已拍板的交互决策 + 分批修复方案 + 落地结果。行为规格同步到 [`docs/SPEC.md`](SPEC.md) §5.16 / §2.2，变更明细记入 [`CHANGELOG.md`](../CHANGELOG.md)。
>
> **落地摘要**：13 项问题全部处理——11 项属实项修复、1 项真机确认后修复（非正方形参考图）、1 项契约权衡按场景放宽（带蒙版 `strength` 1.0）。离线断言全绿（客户端 logic 84 / render 99、host-e2e 50、jobs-wait 26、远端 390、契约 12）；真机 2×Tesla T4 复验通过（非正方形 1024×768、3% 精细小蒙版羽化 4px、强度 0.9/1.0 对比、连续两轮重绘、无遗留 Kernel），结果见 §六。

---

## 一、结论摘要

- 审计列出 13 项问题：**11 项确认属实**、**1 项需真机核实**（非正方形参考图在专用 inpaint 模型下的推理尺寸）、**1 项属契约权衡**（`strength` 上限 0.9 对 9 通道模型偏保守）。
- 与既有设计的关系：胶片条回填本身是 [STUDIO_SYNC_AND_ITERATION_DESIGN.md](STUDIO_SYNC_AND_ITERATION_DESIGN.md) 拍板的交互，本文不改「回填」语义，只补「表单里有参考图/蒙版时不得被隐式回填清掉」的保护。
- 分 4 批实施：**P0-a 状态安全 → P0-b 首次使用与续绘闭环 → P1 正确性 → P2 远端收敛**；每批自带离线断言，最后统一跑 `npm test` 并做一次真机复验后提交。

已拍板决策（2026-11-17）：

1. 表单挂着参考图/蒙版时，胶片条点击**只切预览、不回填**；
2. 助手与生成变体**强制纯文生图**（显式 `reference: null`），当前预设为 `inpaintOnly` 时自动切普通预设并提示；
3. 失败重试**恢复原任务参考图**，蒙版无法恢复时把参考图填回表单并提示重新涂抹（不自动提交）；
4. 蒙版场景 `strength` 上限放宽到 **1.0**（img2img 仍 0.9）；
5. 蒙版羽化半径**按蒙版规模自适应**（小蒙版 2~4px / 大蒙版 6~8px）；
6. 远端**拦截空蒙版**（全白允许）；非正方形尺寸先真机核实再修。

---

## 二、问题清单与判定

### 2.1 状态流转冲突（P0）

| 编号 | 问题 | 判定 | 证据 |
| :--- | :--- | :--- | :--- |
| 一.1 | 提交生成后点胶片条，悄悄清掉参考图与刚涂好的蒙版 | ✅ 属实 | `useStudio.generate()` 成功后 `form.markClean(submittedForm)` 使表单变干净；`previewWork()` 在干净态走 `iteratePatch()` 回填，而 `iteratePatch()` 末尾无条件 `patch.reference = null` |
| 一.2 | 对话助手生成 / 生成变体 / 失败重试与表单参考图、蒙版串台 | ✅ 属实 | `buildGenerateBody()` 只在 overrides 显式给 `reference` 时覆盖，否则读表单；`intentOverrides()` / `rerollOverrides()` / `retryOverrides()` 均未传 `reference: null`。`job.params.reference` 只记录 `sourcePath` / `strength` / `mask` 标记，不含蒙版 base64，重试无法还原蒙版 |

### 2.2 可用性与操作闭环（P0/P1）

| 编号 | 问题 | 判定 | 说明 |
| :--- | :--- | :--- | :--- |
| 二.3 | 选了 `sdxl-inpaint` 但没参考图时缺少「从哪开始」的引导 | ✅ 属实 | `ReferenceSection` 在无参考图时 `return null`，左栏只剩顶部一行文字；空舞台时新用户找不到「以此图重绘」入口 |
| 二.4 | 「以此图重绘」后还要再点一次「局部涂抹」 | ✅ 属实 | `useStudio.referenceImage()` 只切视图与面板模式，不进入涂抹态 |
| 二.5 | 连续局部重绘时，左栏与舞台没有提示「参考图仍是上一轮原图」；左栏看不到蒙版状态 | ✅ 属实 | 生成后舞台切新图，但表单 `reference` / `mask` 不变；`ReferenceSection` 只渲染缩略图、文件名与强度滑块，没有覆盖率与「清空蒙版」 |

### 2.3 技术隐患

| 编号 | 问题 | 判定 | 说明 |
| :--- | :--- | :--- | :--- |
| 三.1 | 非正方形参考图在 9 通道 `sdxl-inpaint` 下被按 1024×1024 推理再拉回，尺寸畸变 | ⚠️ 需真机核实 | `run_task()` 的 `use_inpaint` 分支沿用 img2img 的「不传 width/height」；`StableDiffusionXLInpaintPipeline` 的缺省宽高随 diffusers 版本不同（旧版固定 1024，新版可能从 image 推导）。线上 diffusers 0.43.0 的行为需一次 1024×768 真机用例确认，不能凭记忆下结论 |
| 三.2 | 竖图/矮窗口下画布可能被压扁，光标与笔迹错位 | ✅ 属实（两处叠加） | `.ofs-mask-stage` 固定 `width` + `max-height:100%` + `aspect-ratio`，父 flex 高度不足时收缩破坏宽高比；`placeMaskCursor()` 与指针映射只用 `rect.width / canvas.width` 单一比例，压扁后笔迹在视觉上是椭圆 |
| 三.3a | 空舞台（`!image`）下无法进入涂抹编辑器 | ✅ 属实（边缘态） | `Stage` 在 `!image` 时提前 return，涂抹入口在其后的分支里；表单已有 `reference` 时舞台看不到入口 |
| 三.3b | 涂抹态下点胶片条切换作品「看似没反应」 | ✅ 属实 | `painting` 只在 `referenceIdentity` 变化时复位，`selected` 变化不复位，舞台停在旧涂抹编辑器 |
| 三.3c | 从普通模型涂抹（自动 0.8）切到 `sdxl-inpaint` 后强度仍是 0.8 | ✅ 属实 | `beginMaskEdit()` 只在「当前强度 = 契约默认 0.6」时抬档；0.8 是上一次自动档，切换预设不会按新预设的推荐档更新 |

### 2.4 远端校验与契约权衡

| 编号 | 问题 | 判定 | 说明 |
| :--- | :--- | :--- | :--- |
| 四.1 | 远端缺少空蒙版校验 | ✅ 属实 | `parse_reference_spec()` / `decode_mask_image()` 只校验 PNG、体积与尺寸对齐；外部直接传全黑 PNG 会完整跑一次 GPU 推理后原样输出。全白蒙版属于合法的整图重绘，必须允许 |
| 四.2 | 契约 `strength.max = 0.9` 对 9 通道模型偏保守 | ⚖️ 契约权衡 | 9 通道在全重绘时通常 0.95~1.0 替换效果更好；当前 0.9 是为了兼容通用 img2img 不丢原图。决策：**按场景放宽**，不改 img2img 的 0.9 |
| 四.3 | 羽化固定 8px 对精细边缘偏大 | ✅ 属实 | `MASK_FEATHER_RATIO = 0.008` 在 1024px 图像上固定外扩 8px（`MaxFilter(17)`），只改眼睛、嘴唇等精细区域时会波及周围像素 |

---

## 三、交互决策与行为规格

### 3.1 胶片条（决策 1）

`previewWork(entry)` 的优先级：

1. 始终切换右侧预览（`library.selectImage`）；
2. 表单存在 `reference`（含蒙版）→ **不回填**，提示「已保留当前参考图与蒙版」；
3. 表单 `dirty` → 不回填，提示「已保留当前草稿」（现状）；
4. 表单干净且无参考图 → 回填参数并提示「参数已回填」（现状）。

显式「带回参数」保持原语义（覆盖表单、清理上一轮 `reference`）。切成新作品时如需覆盖参考图，用户应先点「带回参数」。

### 3.2 生成来源策略（决策 2、3）

`generate(overrides, options)` 引入来源策略表，禁止各调用方各自拼 `reference`：

| 来源 | 参考图策略 | 当前预设为 `inpaintOnly` 时 | 失败/兜底 |
| :--- | :--- | :--- | :--- |
| `form`（面板生成） | 沿用表单参考图 + 蒙版 | 缺蒙版时拦下并提示（现状） | — |
| `assistant`（确认卡生成） | **强制纯文生图**（`reference: null`） | 仅本次请求 `overrides.presetId` 切到 `referencePresetOf()` 兜底预设并轻提示（不改左栏表单） | 不静默带旧参考图 |
| `variant`（生成变体） | **强制纯文生图**（`reference: null`） | 同上（仅覆盖本次请求，不改左栏表单） | 同上 |
| `retry`（失败重试） | 从失败任务恢复 `path` + `strength`；优先匹配 `pendingRef.current`（若与失败任务同源）恢复完整蒙版 | 同 `form` 规则 | 蒙版已不可恢复时：把参考图填回表单、自动打开涂抹、提示「请重新涂抹蒙版」，**不自动提交** |

实现约定：`reference` 策略是纯逻辑（放 `src/logic/`），`generate()` 只消费结果；`pendingRef`（上一次提交体）既作无任务时的重试来源，也在 `focusedJob` 匹配当前会话刚失败的任务时用来补回完整 `reference.mask`。

### 3.3 首次使用闭环（决策 4）

- `ReferenceSection` 按模型能力门控：不支持垫图的模型（`!supportsImg2Img`）仍隐藏；支持垫图且无参考图时渲染「空槽位」（普通模型轻量单行入口 / `inpaintOnly` 预设展示虚线框 + 两步说明「选择参考图 → 涂抹蒙版」+ 「从作品画廊选择」按钮，点击切到画廊视图）。
- `inpaintOnly` 预设下「以此图重绘」成功后通过状态信号（如 `pendingPaint` 标记，由 `Stage` 挂载/渲染消费后清除，兼容从画廊跨视图切回的场景）**自动进入涂抹态**；通用模型保持手动（避免打断纯图生图流程）。
- 空舞台（`!image`）但表单已有参考图时，舞台同样提供涂抹入口（或直接以参考图作为舞台内容）。

### 3.4 连续重绘闭环（决策 5）

- 局部重绘产物在舞台/右栏提供「以此结果继续重绘」：显式点击后把该结果设为新参考图、清空蒙版、自动进入涂抹；**不自动切换**，避免打断用户对比。
- `ReferenceSection` 参考图存在时增加：蒙版覆盖率读数（「已涂抹 X%」）、「继续涂抹」「清空蒙版」按钮；生成按钮旁标注「本次基于 <文件名> 重绘」。
- 涂抹中切换胶片条：退出涂抹态（已涂蒙版保留），让预览跟随选中作品。

### 3.5 强度档位联动（决策 1.3c）

- 记录强度是否处于「自动档」：`beginMaskEdit()` 设置自动档（通用 0.8 / `inpaintOnly` 0.9）并标记 `strengthAuto`；用户拖动滑块后清除标记。
- 切换预设时：`strengthAuto` 为真 → 按新预设的推荐档更新；用户手调过 → 不动。

---

## 四、远端与边界决策

1. **`strength` 上限按场景放宽**：`shared/contract.js` 增加 `LIMITS.strength.inpaintMax = 1.0`；Host `normalizeReference` 与 daemon `parse_reference_spec` 在**带蒙版**时用 `inpaintMax` 校验，否则用 `max`；客户端涂抹模式滑块上限同步 1.0，img2img 保持 0.9。
2. **羽化自适应**：按蒙版覆盖率分档（示例阈值，真机复验后可调）：覆盖率 < 0.5% → 半径 2px；< 5% → 4px；否则 6~8px（短边比例 0.8% 封顶 8px）。
3. **空蒙版拦截**：`decode_mask_image()` 解码后判定非零区域与覆盖率，低于 `LIMITS.mask.minCoverage`（建议 0.05%）直接 `invalid_request`（在加载模型前失败）；全白（整图重绘）允许。
4. **非正方形尺寸**：先跑 `1024×768` 参考图真机用例，记录 `result.width/height` 与日志；若确认被按 1024² 推理，则在 `use_inpaint` 分支显式传 `width/height = (w // 8 * 8, h // 8 * 8)`，并补单测断言 kwargs 含宽高。

---

## 五、分批实现与验收

### P0-a 状态安全 ✅

- 胶片条保护、来源策略纯函数 + `generate()` 接线、重试参考图恢复。
- **落地**：`src/logic/generate.js` 新增 `GENERATE_SOURCES` / `normalizeGenerateSource` / `generateSourcePolicy` / `effectivePresetOf` / `generateCapabilityOf` / `retryReferencePlan` / `previewRecallOf` / `referenceUrlOf`，`buildGenerateBody` 的强度归一改为 mask-aware；`useStudio.generate()` 先消费来源策略再用「有效预设 + 有效参考图」做能力预检；`previewWork()` 按「参考图保护 → 草稿保护 → 回填」判定；`retryFocusedJob()` 按恢复计划分支（同源 pendingRef 恢复完整蒙版；蒙版不可恢复时只填回参考图 + 请求涂抹，不提交）；`actions.continueInpaint` 新增。
- 测试：`check-client-logic` 覆盖来源策略表（含 `pendingRef`、蒙版不可恢复分支）、能力预检、胶片条保护优先级（77 → 84 项）；`check-client-render` 覆盖三种来源的实际请求体（无 `reference` / 带 `reference.mask` / 自动切预设）与重试分支。

### P0-b 首次使用与续绘闭环 ✅

- 参考图空槽位 + 画廊入口、`inpaintOnly` 自动涂抹、「以此结果继续重绘」、参考图区蒙版状态与清空/继续涂抹。
- **落地**：`useStudioUi` 新增 `paintRequest` 计数信号（`requestPaint` / `clearPaintRequest`），`Stage` 消费一次即归零，跨视图挂载同样生效；`ReferenceSection` 三形态（`inpaintOnly` 两步引导虚线框 / 普通模型单行入口 / 不支持垫图隐藏）+ 蒙版覆盖率与「继续涂抹 / 清空蒙版」；`Rail` 页脚标注「本次基于 <文件名> 重绘」；舞台动作坞新增「以此结果继续重绘」。
- 测试：`check-client-render` 断言槽位/按钮/覆盖率读数、`paintRequest` 自动涂抹流程、续绘闭环与来源标注。

### P1 正确性 ✅

- 画布比例（`flex-shrink: 0` 或 `max-width/height + width:auto` 联动）、指针两轴映射与光标尺寸、空舞台涂抹入口、涂抹中切图退出、强度档位联动。
- **落地**：`.ofs-mask-stage` 宽度改为 `min(容器宽, 560px, max(120px, (可用高 - 200px) × 参考图比例))` + `aspect-ratio`（与 `.ofs-frame` / `.ofs-print` 同用容器单位），不再被 `max-height` 单独压扁；`Stage.canvasScaleOf()` 按 rect 宽/高分别换算指针与光标；空舞台复用同一蒙版编辑器；选中作品变化时退出涂抹态（蒙版保留）；`useStudioForm` 新增 `strengthAuto` / `strengthMax`，`beginMaskEdit` 套推荐档并标记自动、`applyStrength` 退出自动档、`selectPreset` 自动档跟随新预设。
- 测试：渲染结构断言与 `--ofs-mask-r` 比例变量；CSS 变化未改既有类名。

### P2 远端收敛 ✅

- 空蒙版拦截、羽化自适应、蒙版场景 `strength` 上限 1.0（改动 `shared/contract.js` 后需执行 `npm run contract:gen` 同步 `remote/contract.json`）、非正方形宽高（核实后）。
- **落地**：契约 `LIMITS.strength.inpaintMax = 1.0`、`LIMITS.mask.minCoverage = 0.0005`（`remote/config.py` 的 `LIMIT_NUMERIC_KEYS` 登记新键，注入契约优先）；Host `normalizeReference` 与 daemon `parse_reference_spec` / `_coerce_strength` 按「是否带蒙版」切换上限；`decode_mask_image()` 解码对齐后统计白色覆盖率，低于阈值在加载模型前 `invalid_request`（全白放行）；`feather_mask_image()` 按覆盖率分档 2 / 4 / 6~8px；`run_task()` 的局部重绘分支显式下传按 8 对齐的参考图宽高（`filter_call_kwargs` 过滤不支持者，composite 兜底保留），`execute_job` 打印覆盖率与羽化半径。
- 测试：远端单测新增（空蒙版/全白/羽化半径分档/宽高对齐/强度归一，371 → 390）；`host-e2e` 补 `strength=1.0 + mask` 与空蒙版用例（空蒙版按异步任务终态 `failed` + `invalid_request` 断言，48 → 50）；`jobs-wait` 25 → 26；`check-contract` 11 → 12。

### 每批收口 ✅

`npm test` 全绿（契约、远端、client logic/render、host-e2e）；文档已同步 SPEC §5.16 / §2.2 / §5.15 与 CHANGELOG「未发布」；真机验收见 §六。

### 落地偏差

- 计划中的 `pendingPaint` 标记实现为 `ui.paintRequest` **自增计数**（而非一次性布尔）：Stage 可能因视图切换重新挂载，计数语义保证请求恰好被消费一次；未被消费时保留到具备涂抹条件。
- `ReferenceSection` 按 `supportsImg2Img` 门控（计划 §3.3 最终版）：不支持垫图的模型仍整块隐藏，避免给必然被拒绝的入口。
- 重试的蒙版恢复上限受任务参数信息量约束（`/state` 不回传蒙版 base64）：跨刷新 / 提交体被覆盖后重试必然走「重新涂抹」分支，属设计内行为。
- `strengthAuto` 目前只作为表单域状态（供预设联动），未在界面单独显示「自动」标识。

---

## 六、真机验收结果（2026-11-17，2×Tesla T4）

环境：Kaggle 2×Tesla T4（`diffusers 0.43.0` / `torch 2.11.0+cu130` / `transformers 5.23.0` / `pillow 13.0.0`）；产物目录 `bench-results/gpu-live/2026-11-16T18-49-20`（9 通道 `sdxl-inpaint`）与 `bench-results/gpu-live/2026-11-16T19-12-31`（`from_pipe` 连续重绘）。

1. **非正方形 ✅**：`--preset sdxl-inpaint --inpaint --reference-size 1024x768`，源文生图 1024×768，局部重绘出图 **1024×768**、`referenceWidth/Height` 与 `maskWidth/Height` 均为 1024×768；日志 `kw` 含 `width/height`，`[gen] inpaint 蒙版覆盖率 3.00% 羽化半径 4px`。参考图尺寸与出图尺寸一致，无拉伸畸变；`max_allocated_mb` 保持 9465 不变。
2. **精细小蒙版 ✅**：3% 面积圆形蒙版（约嘴部）落在「< 5%」档，羽化半径 **4px**（旧实现固定 8px）；25% 面积蒙版落在「≥ 5%」档，羽化半径 **6px**。
3. **强度 0.9 / 1.0 对比 ✅**：同一蒙版、同一提示词（红唇 → 蓝唇），30 步 9 通道模型下 `strength=0.9` / `1.0` 的蒙版内平均差异 **26.46 / 21.92**，两次输出不同（882437 / 893187 字节）。差异值不随强度单调递增——强度更大不等于像素差更大，但两次都按新提示词重写；单张 20.09s / 22.72s。
4. **连续两次局部重绘 ✅**：`--preset sdxl-lightning --inpaint --reference-size 1024x768 --mask-scale 0.25 --inpaint-rounds 2`，第 2 轮把第 1 轮出图当参考图（`referenceRole=previous-round`，`referenceBytes` 即上一轮产物）。两轮 `load_seconds=0`（`from_pipe` 复用底座，`reusedBasePipeline=true`），出图均 1024×768；蒙版内平均差异 16.44（对源图）→ 21.29（对上轮结果）/ 32.81（对首轮源图）；显存 `allocated_mb` 7000→7000、`reserved_mb` +4 MiB（噪声）、`max_allocated_mb` 9465 不变，单张 6.53s / 6.52s。
5. **无遗留 Kernel ✅**：两轮验收结束 `session.stop()` 均返回 `absent`；复验 `GetKernelSessionStatus`：最终两个 Kernel 为 `COMPLETE`，三次「排队超时换新实例」产生的旧 Kernel 均已删除（`403 PERMISSION_DENIED` → 判定 missing），无 `RUNNING` / `QUEUED` 条目。

> 备注：两轮验收期间各触发了一次「排队超过 6 分钟 → 换新实例重排」，说明该兜底在真实排队下有效；最终 Kernel 均正常关机。

## 七、未决项与风险（收口后）

- **diffusers 版本差异**：已在线上版本（`diffusers 0.43.0`）确认显式 `width/height` 被管线接受且出图尺寸与参考图一致；`filter_call_kwargs` 仍会在不支持该参数的管线（如未来新增家族）上丢弃它，composite 兜底保留。
- **9 通道小蒙版上下文补全**属模型行为（真机结论：约 2.5% 面积蒙版下提示词会被周围上下文压过），已在 `docs/SPEC.md` §5.15 记录；本轮只做引导，不强行改行为。
- **羽化常数与强度上限**已按首版估计固化（2 / 4 / 6~8px、带蒙版 1.0）；真机复验未发现需要调整的证据，后续如遇硬接缝/波及问题只改 `reference_codec.py` 顶部常量。
- **后续可选**：蒙版笔刷硬度/羽化可调、`inpaintOnly` 预设独立推荐尺寸、局部重绘结果与源图的关联记录（meta 增加 `sourceJobId`）。
