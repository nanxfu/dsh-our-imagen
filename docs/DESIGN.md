---
name: Imagen Studio Design System
colors:
  # Primary — 强调色体系
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
---

# UI 设计规范与系统设计令牌 (DESIGN)

本文档定义 Imagen Studio 的设计系统令牌、排版阶梯、布局网格与组件视觉规范。代码实现位于 `src/styles/`。

---

## 1. 颜色体系与设计令牌 (Color Tokens)

### 1.1 强调色与灰阶 (Primary & Neutrals)
- **Studio Ink (`#141416`)**：系统主强调色。应用于主按钮渐变、选中边框、激活图标与关键状态。深色模式下反相为近白 `#f2f2f4`。
- **Ink Lift (`#2b2b30`)**：用于主操作按钮渐变上限。
- **Ink Wash (`#f0f0f2`)**：轻量选中背景（Tab 选中、Chip 激活），深色模式对应 14% 白色透明底。
- **Print White (`#ffffff`)**：卡片、主面板与弹出层的主背景色。
- **Frosted Shell (`rgb(255 255 255 / 86%)`)**：外层毛玻璃大卡，搭配 24px 背景模糊与 140% 饱和度。
- **Sunken Well (`#f4f4f6`)**：下凹表面底色，用于输入框、分段轨道、缩略图背景。
- **发丝描边 (Borders)**：统一使用 1px 细线：
  - `Hairline` (`rgb(18 18 22 / 7%)`)：面板内部内容分隔线。
  - `Panel Edge` (`rgb(18 18 22 / 9%)`)：面板与卡片外轮廓。
  - `Shell Edge` (`rgb(18 18 22 / 8%)`)：外壳与玻璃按钮轮廓。

### 1.2 语义色 (Signal Colors)
语义色仅以 7px 圆点或窄幅提示条形式出现，禁止大面积填充或用作主按钮底色：
- **在线/就绪**：`#2f8a5c`（浅底 `#eaf5ef`）。
- **排队/预热**：`#a96a18`（浅底 `#f7f0e4`）。
- **失败/异常**：`#c04444`（浅底 `#f9ecec`）。
- **离线/休眠**：`#a0a0a8`（浅底 `#f1f1f3`）。

---

## 2. 排版字阶规范 (Typography Hierarchy)

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

## 3. 布局网格与响应式断点 (Layout & Breakpoints)

页面整体采用单轨面板加画面预览结构：
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

## 4. 阴影与深度 (Elevation & Shadows)

所有阴影均为中性黑（`rgb(16 16 20)`）带正向 Y 轴偏移，严禁使用彩色阴影或零偏移发光：
- **Card (静止卡片)**：`0 1px 2px rgb(16 16 20 / 5%), 0 10px 24px -16px rgb(16 16 20 / 22%)`
- **Lift (悬浮抬升/Toast/弹出层)**：`0 2px 6px rgb(16 16 20 / 6%), 0 18px 40px -20px rgb(16 16 20 / 26%)`
- **Window (整页外壳)**：`0 1px 3px rgb(16 16 20 / 5%), 0 36px 80px -48px rgb(16 16 20 / 32%)`
- **Focus Ring (键盘焦点)**：`0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(20 20 22 / 45%)`

---

## 5. 组件尺寸阶梯 (Component Sizing)

全系统控件高度严格受控在以下阶梯：
- **42px**：主操作生成按钮（Primary CTA）。
- **38px**：常规表单按钮。
- **34px**：提示词相关图标按钮、搜索框胶囊、顶栏状态胶囊。
- **30px**：次级小按钮、Dock 胶囊。
- **28px**：属性 Chip 胶囊、顶栏 View 切换 Tab。
- **26px**：分段控件内嵌切换项。

---

## 6. 设计红线与约束 (Design Constraints)

1. **单实心操作**：每个视图当前可见范围最多只允许 1 个实心强调按钮（立即生成或发送），其余操作一律采用描边、Ghost 或次级样式。
2. **纯净矢量**：图标仅使用 `24×24` 视口、1.6px 圆角描边的单色 SVG；全系统禁止使用任何外部位图资产或 Emoji 字符作为图标。
3. **同心圆角规则**：内层元素圆角须满足 `内圆角 = 外圆角 - 间距`（例如 18px 卡片配 7px 边距时，内部图片框为 11px），避免视觉错位。
