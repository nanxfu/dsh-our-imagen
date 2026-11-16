# Agent 批量创作、风格配方检索与画布局部重绘规划

> **状态**：✅ 已在 0.12.0 落地（离线全绿；局部重绘真机显存与画质验收待执行）。实现说明见 [ROADMAP.md](ROADMAP.md) 第十条与 [CHANGELOG](../CHANGELOG.md) 的「未发布」条目。  
> **前置基线**：v0.11.0（已具备 `AutoPipelineForImage2Image.from_pipe` 显存复用与 `shared/models-guide.js` 模型知识口径）

---

## 一、 背景与设计原则

结合 DSH 生态视觉插件的演进经验与本插件**「零硬件门槛、免费云端算力」**的定位，下一阶段重点补齐两项高频创作能力：

1. **不走商业 API 聚合路线**：保持开源模型与免费算力底座，不引入商业 API / 订阅转发。
2. **不做暗箱提示词拼接**：延续 0.10.0 移除静态风格后缀的决策，风格配方以**透明模板**供 Agent 检索并显式改写进 `prompt`，用户可见可调。
3. **零额外显存增量**：Inpaint 沿用 Img2Img 的 `from_pipe` 机制，复用已加载的 SDXL 底座权重。

---

## 二、 阶段一：Agent 批量创作与风格配方检索

### 1. 对话批量生图（`imagen_batch`）
- **目标**：支持用户在对话中用一句话规划一组不同画面的连续出图（如文章配图、分镜、系列插画），充分发挥免费算力不按张数计费的优势。
- **方案**：
  - 在 `lib/tools.js` 新增 `imagen_batch` 工具：接收公共默认参数（`presetId`、`width`、`height`、`steps`、`cfg`、`waitSeconds`）及 `items` 数组（每项独立 `prompt`、可选 `negativePrompt`、`seed`、`saveTo`）。
  - 在 `shared/contract.js` 定义批量上限（如单次最多 8~10 项），受现有 `LIMITS.queue.maxPending` 约束。
  - 逐项调用 `lib/jobs/queue.js` 入队执行；**单条失败或校验不通过不中断其余任务**，最终统一汇总成功产物路径/URL 与失败项原因。

### 2. 透明风格配方库（`imagen_recipes`）
- **目标**：让 Agent 在对话中能根据“日系手绘”“赛博霓虹”“极简海报”等风格诉求，自动匹配适合开源模型的提示词写法与参数建议。
- **方案**：
  - 新增 `shared/recipes.js`（或 JSON 资产）作为结构化配方源：每条包含 `id`、`title`、`tags`、`recommendedPresets`（对齐 `models/*.json` 的特长，如 `animagine-xl-3.1` 的 tag 语法 vs `flux2-klein-4b` 的自然语言）、`promptTemplate`、`negativePrompt`、`ratioId`。
  - 在 `lib/tools.js` 注册只读工具 `imagen_recipes`（支持按关键词、风格分类或 `presetId` 检索），并在 `imagen_generate` / `imagen_batch` 描述中引导 Agent 先检索再显式组装 `prompt`。

### 3. 阶段一验收标准
- 离线单测覆盖 `imagen_batch` 参数校验、部分失败隔离、队列上限保护与 `imagen_recipes` 检索过滤；
- `npm test` 全绿，契约与中英文工具描述同步通过检查。

---

## 三、 阶段二：画布涂抹局部重绘（Inpaint）

### 1. 跨端契约与参数校验
- 在 `shared/contract.js` 的 `reference` 能力上扩展可选 `mask` 字段（PNG base64，黑白二值图：白色为重绘区域、黑色为保留区域），复用 `LIMITS.reference` 的字节与长边边界。
- 复用模型能力标记体系（`models/*.json` 与 `remote/inference/registry.py`），首期仅对 SDXL 家族（`sdxl` / `sdxl-lora`）开放 Inpaint，不支持的模型在前端置灰提示、在服务端明确拦截。

### 2. 远端推理管线（`remote/daemon.py`）
- 仿照 `ensure_img2img_pipeline()` 新增 `ensure_inpaint_pipeline()`，通过 `AutoPipelineForInpainting.from_pipe(base_pipe)` 复用 `STATE.pipe` 底座，切模型或 `release_pipeline()` 时同步清理 `STATE.inpaint_pipe`。
- 执行期解码 `mask` 并强制转为灰度 `'L'` 模式、对齐到 `reference_image` 的精确宽高，随后传入 `image`、`mask_image` 与 `strength` 完成局部重绘。

### 3. 工作台画布交互（`src/studio/`）
- 在 `Stage.jsx` 的「以此图重绘」预览态增加轻量的「局部涂抹」开关，挂载透明 `<canvas>` 蒙版层。
- 提供基础工具：**画笔大小**、**橡皮擦**、**清空蒙版**、**反选区域**。
- 未涂抹时保持现有整图 Img2Img 行为；有涂抹内容时导出黑底白字 PNG base64 随 `reference.mask` 提交。

### 4. 阶段二验收标准
- 离线覆盖：`remote/daemon.py` 补充 Inpaint 参数校验与管线单测（含 Pillow 解码与尺寸对齐）；Host 与前端表单逻辑覆盖 `mask` 透传与降级拦截。
- 真机验证：在 Kaggle `2×Tesla T4` 验证同会话内「文生图 → 局部重绘」显存无额外增长。
