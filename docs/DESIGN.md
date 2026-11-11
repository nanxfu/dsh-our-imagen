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
  paper: "3px"
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

### 3. 光桌与相纸 (Stage Materials)
界面只有一处允许出现「实物感」：舞台。它是一张下凹的光桌，上面放相纸。这两组变量定义在 `src/styles/tokens.css`，深色值在同一文件的 `prefers-color-scheme: dark` 块与 `tools/preview.mjs` 的 `DARK_TOKENS` 中各有一份，三处必须同步。

| 变量 | 浅色 | 深色 | 用途 |
| :--- | :--- | :--- | :--- |
| `--ofs-mat` | `#f0f0f2` | `#1e1e22` | 光桌表面（比外层玻璃大卡更沉一档，形成下凹） |
| `--ofs-mat-lit` | `rgb(255 255 255 / 92%)` | `rgb(255 255 255 / 7%)` | 光桌顶部柔光（径向渐变，模拟台面透光） |
| `--ofs-mat-inner` | `inset 0 1px 3px rgb(16 16 20 / 6%)` | `inset 0 1px 3px rgb(0 0 0 / 36%)` | 光桌内阴影，说明它是凹进去的台面 |
| `--ofs-print-paper` | `#ffffff` | `#2b2b31` | 相纸，是所在主题里最亮的表面 |
| `--ofs-print-edge` | `rgb(18 18 22 / 10%)` | `rgb(255 255 255 / 13%)` | 纸边发丝线 |
| `--ofs-mark` | `rgb(18 18 22 / 26%)` | `rgb(255 255 255 / 28%)` | 裁切标记与曝光单分隔线 |

深色不是把纸变黑，而是保持「光桌 < 相纸 < 卡片 < 地面（亮度）」的反向关系：相纸在任何主题下都是最亮的表面。

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
- **Print (相纸)**：`0 20px 40px -24px rgb(16 16 20 / 42%), 0 4px 10px -6px rgb(16 16 20 / 18%)`；悬停加深为 `0 26px 50px -24px rgb(16 16 20 / 46%), 0 6px 14px -6px rgb(16 16 20 / 20%)`，同时上移 2px。
- **纸边不用边框画**：`.ofs-print` 用两层 0 模糊的环形阴影（`0 0 0 11px paper` + `0 0 0 12px edge`）在图片外侧描出纸边，不占布局，任何画幅都不会把纸边挤歪。
- **Focus Ring (键盘焦点)**：`0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(20 20 22 / 45%)`

---

## Motion

全站只有一个自主编排的动效：**落定 (Develop)**。其余交互只做 150~220ms 的悬停与展开过渡。

- **落定**：本次页面刚出图（60 秒内完成、且是首屏新到的那张）时播放一次，720~760ms。相纸从 `opacity .42 / translateY(10px)` 落到位，图片同时从 `blur(18px) grayscale(1) contrast(.5) brightness(1.22)` 显到清晰——对应暗房里相纸在显影液里浮出画面。`animation-fill-mode: backwards`，播完即回到基础样式，避免终帧钉住悬停抬升。
- **取景框就位**：空态/等待出图的取景框以 260ms 的 `scale .994 → 1` 淡入，说明「这一格刚放上台面」。
- **显影扫描**：进行中的批次卡里有一道 2.8s 的竖向扫描光，只表示这台机器在工作，不表示进度百分比（远端不上报步进，禁止伪造进度）。
- **光扫**：主按钮悬停时有一道 820ms 的斜向扫光；提交中改为 2.6s 循环，作为忙碌指示。
- 以上全部受 `prefers-reduced-motion: reduce` 约束（`base.css` 全局压成 1ms）。

---

## Shapes

- **圆角梯度**：
  - `xl (24px)`：外壳与居中主画布外框。
  - `lg (18px)`：创作面板主卡片、画廊卡片容器。
  - `md (14px)`：主操作按钮、云端状态条（Session Bar）、弹出层。
  - `sm (10px)`：次级按钮、常规输入框、参数滑块轨道。
  - `pill (999px)`：属性 Chip 胶囊、分段切换轨道、顶栏 View 切换 Tab、Dock 按钮。
- **paper (3px)**：相纸与试印条的纸边圆角。它属于实物表面，不参与上面的 UI 圆角梯度——纸不该被做成药丸。
- **同心圆角规则**：内层元素圆角须满足 `内圆角 = 外圆角 - 间距`（例如 18px 卡片配 7px 边距时，内部图片框为 11px），避免视觉厚薄不均。相纸是放在台面上的物体，不受这条规则约束。

---

## Components

控件风格如同暗室印相器材：金属灰胶囊、圆角灰块与白色相纸卡，唯有主操作由墨黑实心凸显。

### 1. 按钮 (Buttons)
- **Primary CTA**：高 42px、14px 圆角；主操作渐变（`Ink Lift` → `Studio Ink`，深色主题反相为浅色渐变），文字用主题主操作文字色（浅色主题白色、深色主题墨黑）13.5px / 650；悬停上移 1px 并加深阴影，按下微缩至 0.99，禁用时保留渐变但降至 36% 透明度。禁用态的文字色也必须走主题变量，不能写死白色——深色主题的主操作是浅底墨字，写死白字会整行看不见。
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

### 5. 光桌与相纸 (Stage)
舞台不是又一张白卡，而是一张下凹的光桌；画面是落在桌上的一张相纸。这是全站唯一允许出现实物感的区域，控制件一律保持扁平卡片，不参与这套材质。

- **光桌**：`--ofs-mat` 底色 + 顶部径向柔光 `--ofs-mat-lit` + 内阴影 `--ofs-mat-inner` + 1px 发丝描边，24px 圆角，不使用投射阴影（凹进去的台面不该浮起来）。
- **相纸**：图片外包 11px 纸边（环形阴影，不占布局）+ 1px 纸边线 + 带偏移的投影响应悬停；焦点态把外侧换成 2px 墨黑环。纸角 `paper (3px)`。
- **空态与等待出图 = 一张还没曝光的空白相纸**：同一材质、同一位置，比例跟随当前画幅（或本次任务的宽高），四角配 15px 裁切标记。切换「画面设置」里的比例时，台面上的纸跟着换形状——这是选择画幅时最直接的反馈。
- **曝光单**：空态纸面底部一行「稳定出图约 6.2秒」，取自当前预设的 `steadySeconds`，两侧用 `--ofs-mark` 发丝线收住；让用户在点生成前就知道这一张要等多久。读不到预设时不显示，绝不编数字。
- **进行中**：还没有图时，进度胶囊落在空取景框正中；已有图时，胶囊浮在相纸下方。
- **题注**：图下一行提示词（12px / ink-2）+ 一行标签式参数（10.5px / +0.07em 字距 / tabular-nums：尺寸 · 耗时 · 种子）。参数行按印相室标签的写法处理，不抢画面。

### 6. 风格预设：试印条 (Test Strips)
5 个风格预设不是抽象的渐变色块，而是 5 张 64×64 的灰度试印小样（`src/studio/plates.jsx`，内联 SVG）：写实摄影=柔光山脊、概念原画=压暗场景与边缘光、赛博朋克=灯牌与湿地面反光、水墨写意=淡墨山影与留白、3D 渲染=棚拍光下的黏土球。
- 小样只描述「这个风格长什么样」，不使用彩色：产品是黑白灰的印相室。
- 试印条本身是一张纸：`--ofs-print-paper` 底 + 1px `--ofs-print-edge` + 小投影 + `paper (3px)` 圆角；选中态用「2px 卡片色 + 4px 墨黑」的双环，和相纸的纸边逻辑一致。
- 禁止换成图标或纯色块：风格是画面问题，不是分类问题。

### 7. 最近生成栏 (Filmstrip)
- **批次卡**：62px 缩略图（小屏 54px）+ 下方模型名与张数，选中项加墨黑描边环，悬停上浮 2px。
- **进行中卡**：一格 46px 虚线取景框（内含一道竖向显影扫描光）+ 阶段文案 + 已等待时间。只描述真实阶段与真实耗时，不显示假进度。
- **排队卡**：队列串行执行，但可能有多个待执行任务，每个任务各占一张卡，按执行顺序从左到右排在批次卡之前。排队中的任务还没开始出图，取景框里不出现显影光，取而代之的是它在队列里的位次（14px 数字），旁边是阶段文案与已排队时长；悬停显示该任务的完整提示词。位次从整条队列算起，「进行中」占第 1 位。
- **空态**：三格虚线空位 + 一句说明；云端未启动时给「唤醒」链接。

### 9. 模型选择卡 (Model Card Picker)
顶栏最右的模型入口，替代原生 `<select>`：
- **触发胶囊**：与云端状态胶囊同高 34px，内容依次为调优图标、家族徽标（SDXL / FLUX，文字徽标而非彩色 Logo）、模型短名、实测稳态耗时（如 `~6.2s`）、折叠箭头；`≤1120px` 收起耗时段。
- **弹层**：宽 `min(380px, 100vw - 32px)`、最大高 420px，与云端状态弹层同构（16px 圆角、`--ofs-shadow-lift`、下移 8px、`z-index 40`）；头部写「出图模型 / 实测稳态耗时」，底部声明「海报为概念示意，非出图样例」。
- **选项卡片**：56×56 海报（唯一允许的彩色区域）+ 家族标签 + 模型短名 + 「默认」标记 + 一行定位描述 + 参数规格 + 右对齐实测耗时；选中项浅墨底、微环与对勾。海报图片本身是 Pexels/Unsplash 真实照片，构建期以 data URL 内联，运行时零外部请求。

### 8. 作品画廊 (Gallery)
5 列自然高度瀑布流卡片墙，展示图片预览、参数题注与模型/种子胶囊；悬停卡片上浮 2px。

---

## Do's and Don'ts

### Do
- **Do** 坚持以画面为主角，让所有控件与参数面板退守至边缘灰阶卡片中。
- **Do** 把相纸与光桌当作真的物体：纸边、裁切标记、题注标签三者一起说明「这是一张已经落定的图」。
- **Do** 仅使用 1.6px 圆角描边的轻量手写 SVG 图标，保持全站视觉语言完全同构。
- **Do** 保持中性黑阴影（`rgb(16 16 20)`）并配合正向 Y 轴位移，呈现真实物理投射感。
- **Do** 保证所有交互按键具备可见的键盘焦点环（Focus Ring），支持动效减退。
- **Do** 等待过程只讲真话：阶段、已等待时长、预设的实测出图速度，都可以显示；进度百分比在远端不上报步进前一律不显示。

### Don't
- **Don't** 使用大面积彩色渐变、炫光或饱和彩色阴影。
- **Don't** 引入外部位图文件、字体包或 Emoji 符号作为系统图标；唯一例外是模型选择卡的 8 张 56×56 海报（112/96px WebP 构建期内联，base64 总量 ≤20KB）。
- **Don't** 在单屏视口内放置两个或以上的实心深色按钮。
- **Don't** 把光桌/相纸这套实物感扩散到其他界面：控制件一律扁平卡片，否则整页会变成一堆拟物盒子。
- **Don't** 破坏同心圆角规则导致内层切角外露或边距不协调（相纸等实物表面按 `paper (3px)` 处理）。
