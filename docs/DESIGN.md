---
name: Imagen Studio Design System
description: '一间黑白灰的印相室：画布居中，控制件退到边缘的灰阶卡片里。'
colors:
  # Primary — 墨黑本身就是唯一强调色
  studio-ink: "#141416"
  ink-lift: "#2b2b30"
  ink-soft: "#3f3f46"
  ink-on: "#ffffff"
  ink-wash: "#f0f0f2"
  ink-wash-edge: "#dedee3"
  # Neutral — 背景、卡片与边框
  print-white: "#ffffff"
  frosted-shell: "rgb(255 255 255 / 86%)"
  ground-base: "#f5f5f6"
  ground-mist: "#f1f1f2"
  ground-shade: "#e7e8ea"
  ground-groove: "#e3e4e6"
  sunken-well: "#f4f4f6"
  sunken-edge: "rgb(18 18 22 / 8%)"
  hairline: "rgb(18 18 22 / 7%)"
  shell-edge: "rgb(18 18 22 / 8%)"
  panel-edge: "rgb(18 18 22 / 9%)"
  ink-secondary: "#52525a"
  ink-tertiary: "#6b6b73"
  ink-quaternary: "#a8a8b0"
  # Signal — 状态指示色
  signal-ok: "#2f8a5c"
  signal-ok-wash: "#eaf5ef"
  signal-warn: "#a96a18"
  signal-warn-wash: "#f7f0e4"
  signal-error: "#c04444"
  signal-error-wash: "#f9ecec"
  signal-idle: "#a0a0a8"
  signal-idle-wash: "#f1f1f3"
typography:
  display:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: "0.01em"
  headline:
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontSize: "13.5px"
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: "0.02em"
  body:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontSize: "12.5px"
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: "0.01em"
  caption:
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
rounded:
  xl: "24px"
  lg: "18px"
  md: "14px"
  sm: "10px"
  pill: "999px"
spacing:
  pad: "18px"
  gap: "14px"
components:
  button-primary:
    backgroundColor: "{colors.studio-ink}"
    textColor: "{colors.ink-on}"
    rounded: "{rounded.md}"
    height: "42px"
    padding: "0 20px"
  button-secondary:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 14px"
  session-bar:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 12px"
  chip:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    height: "28px"
    padding: "0 10px"
  input-field:
    backgroundColor: "{colors.sunken-well}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 12px"
---

# UI 设计规范与系统设计令牌 (DESIGN)

**Creative North Star: "The Monochrome Print Room"**

Imagen Studio 是一间黑白灰的数字印相室：画面始终处于最核心的聚焦位置，控制面板收敛在边缘的灰阶卡片中。全界面摒弃杂乱渐变与彩色光晕，纯粹通过明度层次、发丝细线与克制的触感构建高品质专业生图体验。

---

## Overview

- **设计主旨**：黑白灰为底，墨黑为唯一强调色。图片资产是视觉的核心与主角，界面元素整体退后，形成沉浸、克制、安静的创作环境。
- **色彩策略**：以墨黑（`#141416`）作为主按钮、选中态与激活状态的唯一强调；语义色仅以小圆点或窄提示条形式存在，绝不侵占主界面。
- **排版原则**：严格基于操作系统 UI 原生字体栈，排布清晰的 6 级字阶体系，数字一律启用等宽对齐。

---

## Colors

### 1. 强调色体系 (Primary & Neutrals)
- **Studio Ink (`#141416`)**：系统主强调色。应用于主生成按钮、选中边框、激活图标与关键状态。深色模式下反相为近白 `#f2f2f4`。
- **Ink Lift (`#2b2b30`)**：用于主操作按钮渐变上限。
- **Ink Wash (`#f0f0f2`)**：轻量选中背景（Tab 选中、Chip 激活），深色模式对应 14% 白色透明底。
- **Print White (`#ffffff`)**：卡片、主面板与弹出层的主背景色。
- **Frosted Shell (`rgb(255 255 255 / 86%)`)**：外层毛玻璃大卡，搭配 24px 背景模糊与 140% 饱和度。
- **Sunken Well (`#f4f4f6`)**：下凹表面底色，用于输入框、分段轨道、缩略图背景。
- **发丝描边 (Borders)**：统一使用 1px 细线：
  - `Hairline` (`rgb(18 18 22 / 7%)`)：面板内部内容分隔线。
  - `Panel Edge` (`rgb(18 18 22 / 9%)`)：面板与卡片外轮廓。
  - `Shell Edge` (`rgb(18 18 22 / 8%)`)：外壳与玻璃按钮轮廓。

### 2. 状态指示色 (Signal Colors)
语义色仅以 7px 圆点或窄幅提示条形式出现，禁止大面积填充或用作主按钮底色：
- **在线/就绪**：`#2f8a5c`（浅底 `#eaf5ef`）。
- **排队/预热**：`#a96a18`（浅底 `#f7f0e4`）。
- **失败/异常**：`#c04444`（浅底 `#f9ecec`）。
- **离线/已关闭**：`#a0a0a8`（浅底 `#f1f1f3`）。

---

## Typography

全站严格采用宿主系统 UI 字体栈：`-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。不外链任何第三方字体，数字一律启用 `font-variant-numeric: tabular-nums` 对齐。

| 层级 | 字号 | 字重 | 行高 | 字距 | 典型应用场景 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Display** | 16px | 650 | 1.55 | +0.01em | 面板主标题「创作设置」、空态引导标题（小屏降为 14/15px） |
| **Headline**| 15px | 650 | 1.30 | -0.01em | 画廊主标题「作品画廊」 |
| **Title**   | 13.5px| 650 | 1.55 | +0.02em | 品牌名、主操作 CTA 按钮文字 |
| **Body**    | 13px | 400 | 1.55 | normal  | 提示词正文输入框、对话文本、画廊描述 |
| **Label**   | 12.5px| 550~600| 1.40| +0.01em | 顶栏 Tab、分段控件、弹窗菜单、输入标签 |
| **Caption** | 10.5px| 500 | 1.30 | +0.02em | 批次计数、状态时间戳、模型标签（大写） |

---

## Layout

页面整体采用单轨创作面板加居中画面预览结构：
- **外边距与间距**：`--ofs-pad: 18px`，`--ofs-gap: 14px`。
- **创作面板宽度**：恒定 320px。
- **画廊网格**：基础为 5 列瀑布流，卡片内边距 6px，列间距 14px，图片按原生比例自适应撑高。

### 响应式断点规则
- **≤ 1400px**：画廊降为 4 列。
- **≤ 1180px**：画廊降为 3 列，品牌副标隐藏。
- **≤ 980px**：页面外边距收窄为 10px，缩略图尺寸缩小为 54px。
- **≤ 900px**：画廊降为 2 列。
- **≤ 820px**：切换为垂直单列堆叠布局（面板在上、画面预览在下占据 62vh，底部最近生成栏隐藏）。
- **≤ 520px**：控件高度与字号缩减一档。

---

## Elevation & Depth

所有阴影均为中性黑（`rgb(16 16 20)`）带正向 Y 轴偏移，严禁使用彩色阴影或零偏移发光：
- **Card (静止卡片)**：`0 1px 2px rgb(16 16 20 / 5%), 0 10px 24px -16px rgb(16 16 20 / 22%)`
- **Lift (悬浮抬升/Toast/弹出层)**：`0 2px 6px rgb(16 16 20 / 6%), 0 18px 40px -20px rgb(16 16 20 / 26%)`
- **Window (整页外壳)**：`0 1px 3px rgb(16 16 20 / 5%), 0 36px 80px -48px rgb(16 16 20 / 32%)`
- **Focus Ring (键盘焦点)**：`0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(20 20 22 / 45%)`

---

## Shapes

- **圆角梯度**：
  - `xl (24px)`：外壳与居中主画布外框。
  - `lg (18px)`：创作面板主卡片、画廊卡片容器。
  - `md (14px)`：主操作按钮、云端状态条（Session Bar）、弹出层。
  - `sm (10px)`：次级按钮、常规输入框、参数滑块轨道。
  - `pill (999px)`：属性 Chip 胶囊、分段切换轨道、顶栏 View 切换 Tab、Dock 按钮。
- **同心圆角规则**：内层元素圆角须满足 `内圆角 = 外圆角 - 间距`（例如 18px 卡片配 7px 边距时，内部图片框为 11px），避免视觉厚薄不均。

---

## Components

控件风格如同暗室印相器材：金属灰胶囊、圆角灰块与白色相纸卡，唯有主操作由墨黑实心凸显。

### 1. 按钮 (Buttons)
- **Primary CTA**：高 42px、14px 圆角；墨黑两段渐变（`Ink Lift` → `Studio Ink`），文字为白色 13.5px / 650；悬停上移 1px 并加深阴影，按下微缩至 0.99，禁用时保留渐变但降至 36% 透明度。
- **Secondary / Ghost**：次级按钮白底 + Panel Edge 细线 + Card 阴影；Ghost 按钮为透明底搭配 `Ink Secondary` 文字，悬停切换至 `Ink Wash` 底色。
- **单实心原则**：每个独立视口最多只允许出现 1 个实心墨黑主操作按钮（立即生成或发送）。

### 2. 云端状态条 (Session Bar)
过渡态（申请 GPU / 连接云端 / 准备模型 / 关闭云端）在顶栏下方常驻一条 34px 状态条，说明当前在等什么、已经等了多久：
- **结构**：7px 语义色圆点 + 状态标签（12px / 600 / 墨黑）+ 一句话提示（12px / ink-3，单行省略）+ 右对齐「已等待」计时（11px / tabular-nums，左侧 1px 发丝分隔）。
- **表面**：卡片底色 `--ofs-card` + 1px `--ofs-hairline` 描边 + 14px 圆角，不使用阴影；语义色只出现在圆点上，条体保持中性，不作为主操作强调。
- **响应式**：≤ 820px 隐藏提示句，只保留状态标签与计时，避免单行被挤成碎片；状态条与顶栏胶囊共用同一份文案，不重复造词。

### 3. 标签与分段控件 (Chips & Segmented Controls)
- **Chips**：28px 高胶囊，白色背景、Sunken 发丝描边；激活态切换为 `Ink Wash` 底色 + 墨黑文字。
- **分段控件**：3px 内边距的 Sunken Well 药丸轨道，内部切换项 26px 高；选中项使用白色背景、600 字重与 1px 微阴影。

### 4. 输入框 (Inputs & Search)
- **提示词区域**：外层 18px 卡片内嵌 14px 渐变浅槽（Print White → Sunken Well）；获取焦点时边框高亮并带有 3px 墨黑微光晕。
- **常规参数输入**：30px 高度、9px 圆角；单行搜索框采用 34px 高度全圆角胶囊。

### 5. 画布与画廊 (Canvas & Gallery)
- **焦点画布 (Stage)**：居中自适应容器，右上角配悬浮三联玻璃图标（放大 / 复制绝对路径 / 收藏）；渲染中展示墨黑动态扫光条。
- **作品画廊 (Gallery)**：5 列自然高度瀑布流卡片墙，展示图片预览、参数题注与模型/种子胶囊；悬停卡片上浮 2px。

---

## Do's and Don'ts

### Do
- **Do** 坚持以画面为主角，让所有控件与参数面板退守至边缘灰阶卡片中。
- **Do** 仅使用 1.6px 圆角描边的轻量手写 SVG 图标，保持全站视觉语言完全同构。
- **Do** 保持中性黑阴影（`rgb(16 16 20)`）并配合正向 Y 轴位移，呈现真实物理投射感。
- **Do** 保证所有交互按键具备可见的键盘焦点环（Focus Ring），支持动效减退。

### Don't
- **Don't** 使用大面积彩色渐变、炫光或饱和彩色阴影。
- **Don't** 引入外部位图文件、字体包或 Emoji 符号作为系统图标。
- **Don't** 在单屏视口内放置两个或以上的实心深色按钮。
- **Don't** 破坏同心圆角规则导致内层切角外露或边距不协调。
