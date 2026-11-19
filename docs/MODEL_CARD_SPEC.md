# 模型选择卡重构规格说明 (MODEL_CARD_SPEC)

本文档定义工作台顶栏「模型选择卡」的重构规格。替代原有的 HTML 原生 `<select>` 控件，解决模型家族归属不透明、视觉割裂以及信息利用率不足的问题。

> 2026-11-11 修订：解除「纯内联 SVG / 零位图资产 / Bundle ≤4KB」限制；海报改为真实图片，构建期以内联 data URL 注入；模型数量按仓库现状扩展为 8 个。审批记录见 `design-demos/` 的对话与实现说明。
>
> 2026-11-11 二次修订：新增 `anima-light-lavender`（Anima 家族，Cosmos-Predict2 2B 底座），模型数量 8 → 9；海报 9 张，base64 合计 20116 字符（含 `data:` 前缀 20323 字符），仍在 20KB 预算内。架构与实测数据见 [`ANIMA_LOADER_SPEC.md`](ANIMA_LOADER_SPEC.md)。
>
> **2026-11-20 阶段十七修订**：模型阵营由 10 款精简为 7 款现役（下线 8 款旧 SDXL/慢模），下表已替换为现役清单；海报改为 6 份独立图片覆盖 7 张模型卡（`flux2-klein-9b` 复用 `flux2-klein-4b.webp`），base64 合计 17460 字符（含前缀 17598 字符）。

---

## 1. 现状问题与设计目标

### 1.1 现状缺陷
1. **原生 `<select>` 视觉断层**：在 Windows Chromium 下，原生 `<select>` 呼出 OS 原生白底菜单，与深色工作台割裂，无法进行自定义布局、圆角与排版。
2. **模型家族被隐匿**：
   - `FLUX.2-klein-4B`（BFL 出品、双 GPU 加载）被命名为「质量优先」；
   - `SDXL-Turbo`（1.9s 极速）被命名为「极速草稿」；
   - 用户无法识别底层到底运行的是 FLUX 还是 SDXL，容易误以为系统只锁定在单一 SD 模型上。
3. **顶栏信息死锁**：顶栏药丸右侧固定渲染 `3.5B + LoRA`，即使切换为其他模型，视觉认知依然停留在默认配置。
4. **关键性能数据闲置**：底层实测的稳态耗时（`steadySeconds`）、分辨率尺寸集合与步数未在选择期呈现。

### 1.2 重构目标
1. **真实呈现模型谱系**：明确区分 **FLUX 家族** 与 **SDXL 家族**，展示模型来源与核心定位。
2. **真实影像海报卡（风格 1）**：每个模型一张 112×112 WebP 海报，构建期以内联 data URL 注入；运行时零网络请求、离线可用，Bundle 增长预算 ≤20KB。
3. **顶栏联动**：顶栏药丸动态显示当前模型的系列徽标、主名称与耗时，信息随选即动。
4. **符合印相室规范**：遵循 `docs/DESIGN.md` 的黑白灰基底与 `1.6px` 线稿图标，键盘交互（Tab / Arrow / Esc）完全符合 WAI-ARIA Listbox 规范；彩色只存在于海报图片里，不参与控件与选中态。

---

## 2. 信息架构与字段映射

> 家族徽标当前有六族：`SDXL`、`SANA`、`Z-Image`、`Qwen`、`FLUX`、`Anima`（对应 7 款现役模型，2026-11-20 阶段十七修订）。

每个预设条目展示 4 个层级的信息：

```
┌──[ 56×56 海报 ]──┬────────────────────────────────────────────────────────┐
│                  │  [家族标签] 模型主名                        实测稳态耗时   │
│   真实 WebP 图片  │  核心定位描述文本                                      │
│                  │  参数规格 · 默认尺寸 · 推荐步数/GPU        [选中对勾]  │
└──────────────────┴────────────────────────────────────────────────────────┘
```

### 2.1 预设元数据扩充

在 `models/*.json` 根数据中补充 `family`、`short` 与双语 `description`，由 `tools/build-assets.mjs` 生成到契约层；UI 不再做名称硬编码映射。

| 模型 ID | 家族 (Family) | 研发厂商 | 界面主标题 (label) | 触发器短名 (short) | 定位描述 (zh) | 定位描述 (en) | 关键规格 | 实测耗时 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `sdxl-lightning` | **SDXL** | Stability × ByteDance | SDXL Lightning | Lightning | 4 步极速出图，平衡画质与耗时（默认推荐） | 4-step fast generation, balanced quality | 3.5B+LoRA · 1024px · 4 步 | ~6.2s |
| `sana-sprint-1.6b` | **SANA** | Efficient-Large-Model | SANA-Sprint 1.6B | SANA-Sprint | 1.6B 线性 DiT，2 步超快 1024px 生成，轻量灵感探索 | 1.6B Linear DiT, 2-step ultra-fast 1024px generation | 1.6B+Gemma-2-2B · 1024px · 2 步 | ~4.1s |
| `z-image-turbo` | **Z-Image** | 通义万相（Tongyi-MAI） | Z-Image Turbo | Z-Image | 6B S3-DiT，8 步写实摄影、中英双语文字与局部重绘 | 6B S3-DiT, 8-step photorealism, bilingual text and inpainting | 6B+Qwen3-4B · 1024px · 9 步 | ~30.7s |
| `qwen-image-2.1` | **Qwen** | 阿里 Qwen | Qwen-Image 2.1 | Qwen 2.1 | 7B DiT + Qwen3-VL-8B（8 步 Turbo），强排版/多图编辑/透明背景（非商用） | 7B DiT + Qwen3-VL-8B (8-step Turbo), strong typography, editing & RGBA (non-commercial) | 7B+Qwen3-VL-8B · 1024px · 8 步 | ~43.7s |
| `flux2-klein-4b` | **FLUX** | Black Forest Labs | FLUX.2 Klein 4B | Klein 4B | 下一代前沿架构，商业级质感与光影 | Next-gen architecture, commercial grade | 3.88B · 1024px · 双 GPU · 4 步 | ~10.2s |
| `flux2-klein-9b` | **FLUX** | Black Forest Labs | FLUX.2 Klein 9B | Klein 9B | 9B 蒸馏编辑模型，4 步出图，非商用许可 | 9B distilled editing model, 4-step generation, non-commercial license | 9.08B · 1024px · 4 步 | ~130.9s |
| `anima-turbo-v1.1` | **Anima** | CircleStone Labs | Anima Turbo v1.1 | Anima Turbo | 8~12 步新一代二次元 DiT，支持自然语言与 Danbooru 标签 | 8–12 step next-gen anime DiT supporting natural language and tags | 2B+Qwen3-0.6B · 1024px · 10 步 | ~21.6s |

> 其中 `z-image-turbo`、`qwen-image-2.1`、`flux2-klein-9b` 资产声明 `providers: ["colab"]`，在 Kaggle 来源下模型卡置灰并标「仅 Colab」；其余 4 款两种来源都可用。

字段落点：
- `label`：完整商业名，用于画廊筛选、最近生成栏、契约与无障碍文案；
- `family`：`SDXL` / `FLUX`，用于触发器与卡片上的家族徽标；
- `short`：触发器与卡片主名（去掉家族前缀，避免「SDXL SDXL」重复）；
- `description.zh` / `description.en`：一句话定位，UI 按当前语言取用；
- `measured.steadySeconds`：实测稳态耗时，格式统一为一位小数（`formatSeconds`）。

---

## 3. 视觉资产设计（真实影像海报）

用户已确认：解除纯内联 SVG 与零位图限制，海报使用真实图片。

### 3.1 资产规格

1. 每个模型一张 56×56 海报；源文件为方形 WebP（112×112 或 96×96，quality 55–75），放在 `src/studio/posters/<model-id>.webp`。当前 6 份图片覆盖 7 张模型卡：`flux2-klein-9b` 复用 `flux2-klein-4b.webp`，不单独占一份图片资产。
2. `build.mjs` 为 esbuild 增加 `.webp: 'dataurl'` loader，构建期把图片内联为 data URL；运行时零网络请求，单文件分发不裂图。
3. 6 份独立海报的 data URL base64 总量预算 ≤20KB（当前实测 raw 合计 13088 B，base64 合计 17460 字符，含 `data:image/webp;base64,` 前缀为 17598 字符；`flux2-klein-9b` 复用 Klein 4B 海报、不新增字节）。组件、样式与文案代码不计入这个图片预算。
4. 来源只用 Pexels / Unsplash 等可商用图库，逐张记录页面 URL、直链、作者、许可到 `src/studio/posters/SOURCES.md`。
5. 海报是「概念示意」，不是该模型的出图样例；面板底部必须写明这一点。

### 3.2 视觉分配

| 模型 | 海报意向 | 来源 |
| :--- | :--- | :--- |
| `sdxl-lightning` | 琥珀破晓光柱 | Pexels |
| `sana-sprint-1.6b` | 夜间高速公路车辆光轨（2 步极速） | Pexels |
| `z-image-turbo` | 香港楼宇橙红霓虹店招（写实摄影 + 中英文字） | Pexels |
| `qwen-image-2.1` | 整面重复排印 `TERRAZA` 的绿色招牌（强排版） | Pexels |
| `flux2-klein-4b` / `flux2-klein-9b` | 深紫棱镜晶体（`flux2-klein-9b` 复用同一张） | Pexels |
| `anima-turbo-v1.1` | 二次元角色手办特写（概念示意，非该模型出图；沿用原 Anima 图） | Pexels |

彩色边界：
- 只允许存在于 56×56 图片本身；
- 边框、阴影、悬停底色、选中环、文字、分隔线一律无彩色；
- 不取图里的颜色做 `accent`，不做外发光、渐变蒙层或彩色底衬。

---

## 4. 组件交互规范与状态机

### 4.1 触发胶囊（TopBar Trigger）

- **尺寸**：高度 `34px`，药丸圆角 (`border-radius: var(--ofs-r-pill)`)。
- **内容呈现**：
  - 左侧：调优图标（Sliders）；
  - 中间：家族徽标（如 `FLUX` / `SDXL`） + 模型主名（如 `Klein 4B` / `Lightning`）；
  - 右侧：实测稳态耗时指示（如 `~6.2s`）；
  - 末端：折叠指示箭头（ChevronDown，展开时旋转 180°）。
- **交互**：
  - 点击或按 `Space` / `Enter` 切换展开状态；
  - 聚焦时高亮外轮廓 (`--ofs-focus-ring`)；
  - `≤1120px` 隐藏耗时段，只保留家族与主名。

### 4.2 浮层面板（Popover Panel）

- **定位**：对齐胶囊右边缘，下偏移 `8px`，`z-index: 40`（与云端状态弹层一致）。
- **尺寸**：宽度 `min(380px, calc(100vw - 32px))`，最大高度 `420px`；头部与底部固定，中间列表内部滚动。
- **容器风格**：`var(--ofs-card-solid)` 实底 + `1px solid var(--ofs-card-border)` + `var(--ofs-shadow-lift)`，16px 圆角。
- **选项卡片交互**：
  - **默认态**：边框透明，浅底，海报处于基础对比度；
  - **悬停/键盘高亮态**：背景过渡为 `var(--ofs-accent-soft)`，边框显现，海报轻微提亮；
  - **当前选中态**：右侧显示选中对勾，外框 `var(--ofs-accent-soft-border)` 微环，浅墨底。
- **两个顶栏弹层互斥**：算力弹层与模型卡不能同时展开。

### 4.3 键盘与无障碍支持 (A11y)

- 遵循 W3C `aria-haspopup="listbox"` 与 `role="listbox"`，触发器带 `aria-expanded` / `aria-controls`；
- 展开后：
  - `ArrowDown` / `ArrowUp`：在模型卡片间线性循环切换焦点，并 `scrollIntoView({ block: 'nearest' })`；
  - `Home` / `End`：跳到第一项 / 最后一项；
  - `Enter` / `Space`：选定当前高亮模型并关闭面板；
  - `Escape`：不保存临时焦点，直接关闭面板，焦点返还触发胶囊；
  - 点击面板外部区域或按 `Tab` 自动关闭；
- 选中项 `aria-selected="true"`；焦点环使用 `--ofs-focus-ring`；动效受 `prefers-reduced-motion` 约束。

---

## 5. 文件变更规划

| 序号 | 文件路径 | 变更类型 | 变更职责 |
| :---: | :--- | :---: | :--- |
| 1 | `src/studio/ModelCardPicker.jsx` | 新增 | 独立的模型卡下拉选择器组件，含内联海报、卡片排版、listbox 键盘交互与算力来源门控。 |
| 2 | `src/studio/TopBar.jsx` | 修改 | 移除原生 `<select>`，接入 `ModelCardPicker`；模型弹层与算力弹层互斥；保留参数回填。 |
| 3 | `src/studio/Studio.jsx` / `src/studio/useStudio.js` | 修改 | 把当前语言 `isEn` 传给顶栏，用于选择中英描述。 |
| 4 | `src/styles/shell.css` / `src/styles/responsive.css` | 修改 | 新增模型卡胶囊、海报容器、多行排版、选中态、滚动与三档响应式；删除旧 `.ofs-preset` 样式。 |
| 5 | `src/dict/zh.js` & `src/dict/en.js` | 修改 | 新增菜单标题、实测标签、默认标记、步数单位、双 GPU、海报声明等文案。 |
| 6 | `models/*.json` + `tools/build-assets.mjs` + `shared/models.generated.js` | 修改/生成 | 7 个现役模型的 label / family / short / description 落库并重新生成契约。 |
| 7 | `build.mjs` | 修改 | esbuild 增加 `.webp: 'dataurl'` loader。 |
| 8 | `src/studio/posters/*.webp` + `SOURCES.md` | 新增 | 6 份模型海报（覆盖 7 张模型卡）与来源记录。 |
| 9 | `src/logic/format.js` | 修改 | `formatSeconds` 统一一位小数，消除 27.8s 与 28s 的分歧。 |
| 10 | `tools/preview.mjs` | 修改 | 新增 `defaultModelOpen` 预览场景（`model-picker` / `model-picker-dark`），供无头截图核对。 |

---

## 6. 验收标准

1. **视觉一致性**：彻底清除系统原生白底 `<select>`，浮层风格与云端算力弹层（`ofs-popover`）完全同构。
2. **血统透明**：用户进入界面即可明确区分 FLUX（`FLUX.2 Klein 4B` / `FLUX.2 Klein 9B`）、SDXL（`SDXL Lightning`）、SANA、Z-Image、Qwen 与 Anima 六类底座，不再误解为单一模型；7 款现役模型都能在列表中看到并选中。模型资产可选 `providers` 能力位会在卡片上按当前算力来源置灰：`z-image-turbo`、`qwen-image-2.1`、`flux2-klein-9b` 声明 `["colab"]`，Kaggle 来源下置灰并标「仅 Colab」。
3. **资产纯净**：6 份独立海报随构建内联为 data URL（`flux2-klein-9b` 复用 Klein 4B 海报），无任何外部图片 HTTP 请求；海报资源 base64 合计 17460 字符（含前缀 17598 字符），低于 20KB 预算。
4. **功能兼容**：切换模型后，画布尺寸、CFG、步数等推荐值联动更新，历史出图的 Recall / Variant 逻辑不受影响。
5. **回归**：`npm test` 全绿；`tools/preview.mjs` 的深色 / 浅色 / 窄屏截图通过人工核对；键盘与 `prefers-reduced-motion` 验证通过。