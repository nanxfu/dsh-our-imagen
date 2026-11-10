---
name: Imagen Studio
description: '一间黑白灰的印相室：画布居中，控制件退到边缘的灰阶卡片里。'
colors:
  # Primary — 墨黑本身就是唯一强调色
  studio-ink: "#141416"
  ink-lift: "#2b2b30"
  ink-soft: "#3f3f46"
  ink-on: "#ffffff"
  ink-wash: "#f0f0f2"
  ink-wash-edge: "#dedee3"
  # Neutral — 地面、外壳、表面与发丝线
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
  # Signal — 只以小圆点或窄条出现
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
    fontFamily: '-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: "0.01em"
  headline:
    fontFamily: '-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: '-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13.5px"
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: "0.02em"
  body:
    fontFamily: '-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: '-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12.5px"
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: "0.01em"
  caption:
    fontFamily: '-apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
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
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "42px"
    width: "100%"
  button-secondary:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "30px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.studio-ink}"
    typography: "{typography.label}"
    rounded: "8px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    size: "34px"
  chip:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  chip-selected:
    backgroundColor: "{colors.ink-wash}"
    textColor: "{colors.studio-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  segmented-control:
    backgroundColor: "{colors.sunken-well}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px"
  input:
    backgroundColor: "{colors.sunken-well}"
    textColor: "{colors.studio-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
    height: "34px"
    width: "100%"
  card-panel:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.lg}"
    padding: "15px"
  gallery-card:
    backgroundColor: "{colors.print-white}"
    textColor: "{colors.studio-ink}"
    rounded: "{rounded.lg}"
    padding: "6px"
    width: "100%"
  filmstrip-thumb:
    backgroundColor: "{colors.sunken-well}"
    rounded: "12px"
    size: "62px"
---

# Design System: Imagen Studio

## Overview

**Creative North Star: "The Monochrome Print Room"**

这间印相室沿用参考图钉住的构图——单轨创作面板、悬浮画面预览、底部最近生成栏，以及参考图 2/3 的卡片墙——保留了卡片悬浮与宽松留白，但把参考图那层“AI 产品默认皮肤”剥掉了。用户明确拒绝紫色主题色，要求只用黑白灰的关系。于是房间里的所有表面都来自同一条中性灰阶：柔光地面、雾面近白的外壳、白色相纸卡；**唯一带有颜色的是画布上的作品本身**，界面自己不携带任何彩色主张。

承重的判断是“明度即层级”。墨黑（深色下反相为近白）是唯一强调色，只出现在主操作、选中环、激活图标与状态点；辅助文字由深到浅分三层，边框是一根 1px 发丝线，深度来自带偏移的中性柔影。这样做是为了让 1440px 的整页工作台读起来像一件器材，而不是一张营销落地页：图片永远在中心，控制件都是边缘的灰阶卡片。

密度上，页面只有一张雾面大卡，内部再分顶栏、创作面板、画面预览与最近生成栏；画廊切换成 5 列自然高度的作品墙。浅色是母版，深色按同一套明度关系整体反相；语义色只在 7px 状态点或窄条里出现，不参与大面积装饰。这套系统拒绝控制台式密集参数面板、成排等比重卡片、紫色渐变与彩色光晕。

**Key Characteristics:**
- 墨黑（深色下反相为近白）是唯一强调色，只出现在主操作、选中环、激活图标与状态点。
- 中性柔光地面（三层灰渐变）上浮雾面外壳与近白卡片，靠 1px 发丝描边 + 带偏移的中性柔影分层。
- 居中画面预览 + 底部悬浮最近生成栏：图片是唯一主角，其余都是灰色工具。
- 画廊是 5 列自然高度作品墙，不裁切、不统一高度，像印相室墙上的样片。
- 浅色为母版；深色按同一套明度关系反相，不另起一套配色。
- 语义色只在 7px 状态点或窄幅提示条里出现，不做大面积填充。
- 全系统只用系统 UI 字体与 1.6px 圆角描边的单色 SVG；没有位图资产、没有 emoji。

## Colors

只有明度的中性灰阶，加上墨黑这一个强调色；所有彩色都来自生成的作品。

### Primary
- **Studio Ink** (#141416)：系统里唯一的强调色。主按钮渐变、品牌标、选中环、激活图标、状态文字都用它；深色主题反相为近白 #f2f2f4，按钮文字换成 #161618。
- **Ink Lift** (#2b2b30)：墨黑两段渐变的上端，让实心主操作有一点金属色的光，而不是纯平的色块。
- **Ink Soft** (#3f3f46)：墨黑的第二档，用于对话生成中的微光条中点与次级墨色，不做大面积填充。
- **Ink On** (#ffffff)：压在墨黑上的文字与图标，深色主题下翻为深墨 #161618。
- **Ink Wash** (#f0f0f2)：墨黑稀释到 5% 的选中底，用于 chip 选中、分段控件当前项、激活图标底与选中环内衬。它不是第二强调色，只是墨黑的浅层。
- **Ink Wash Edge** (#dedee3)：定义 Ink Wash 边界的发丝描边，深色主题下是 14% 白。

### Neutral
- **Print White** (#ffffff)：相纸表面。卡片、面板、弹出层的主底色。
- **Frosted Shell** (rgb(255 255 255 / 86%))：唯一的大玻璃壳，配 24px 背景模糊与 140% 饱和，让地面柔光从边缘透进来。
- **Soft-Ground Base** (#f5f5f6)：页面地面底色。
- **Soft-Ground Mist** (#f1f1f2)：右上角径向柔光。
- **Soft-Ground Shade** (#e7e8ea)：左上角径向柔光。
- **Soft-Ground Groove** (#e3e4e6)：底部径向柔光。
- **Sunken Well** (#f4f4f6)：下凹表面。输入框、分段轨道、缩略图底、灰度标签都沉在白面之下半档。
- **Sunken Edge** (rgb(18 18 22 / 8%))：下凹表面的 1px 边，用于输入框、chip、比例块与参数行；深色下是 9% 白。
- **Hairline** (rgb(18 18 22 / 7%))：面板内部分隔线、顶栏底边、面板右边。
- **Shell Edge** (rgb(18 18 22 / 8%))：外壳与玻璃钮的 1px 外边。
- **Panel Edge** (rgb(18 18 22 / 9%))：卡片与面板的 1px 描边。
- **Ink Secondary** (#52525a)：次级正文、控件标签、对话作者名。
- **Ink Tertiary** (#6b6b73)：说明文字、元信息、占位符、静止图标；正文可读性的下限。
- **Ink Quaternary** (#a8a8b0)：只用于禁用文字、折叠箭头与滚动条，不承载任何信息。

### Signal
- **Signal Online** (#2f8a5c) + wash #eaf5ef：在线状态点、完成状态点。
- **Signal Queued** (#a96a18) + wash #f7f0e4：排队/预热状态点、异常指引窄条。
- **Signal Error** (#c04444) + wash #f9ecec：失败状态点、危险 chip 的文字与浅底。
- **Signal Offline** (#a0a0a8) + wash #f1f1f3：离线与静止态。
- 深色主题只换明度：#58c08a / #d8a55c / #e07a7a / #8a8a92，wash 变成 14% 透明或 6% 白。

### Named Rules
**The Ink-Only Accent Rule.** 墨黑（深色下为近白）是系统里唯一的强调色：只出现在主操作、选中环、激活图标和状态点；任何彩色——包括参考图里的紫色与彩色光晕——都不得成为强调色。
**The Signal-Small Rule.** 成功、警告、错误只以 7px 圆点或一条窄幅提示条出现，永远不做大面积填充、卡片底色或主按钮颜色。
**The Same-Lightness Rule.** 深色主题不是另一套配色，而是同一套明度关系的反相：深灰地面、浅灰文字、近白主操作；两套主题里地面 → 卡片 → 文字 → 主操作的相对对比必须保持一致。

## Typography

**Display Font:** system UI stack（-apple-system / Segoe UI / PingFang SC / Microsoft YaHei）
**Body Font:** 同上；没有第二套字体
**Label/Mono Font:** 无。数字用 `font-variant-numeric: tabular-nums` 对齐

**Character:** 只有一种声音：宿主操作系统的 UI 字体。它让工作台读起来像系统里的一件器材，而不是一个带品牌字体的网页；层级靠字号、五档字重与三层墨色叠加，不靠字体切换。

### Hierarchy
- **Display** (650, 16px, 1.55 继承行高, +0.01em)：面板标题「创作设置」与空态主标题；≤520px 降为 14 / 15px。
- **Headline** (650, 15px, 1.3, −0.01em)：画廊标题「作品画廊」。
- **Title** (650, 13.5px, 1.55 继承行高, +0.02em)：品牌名与主按钮文字；≤980px 品牌名降为 13px。
- **Body** (400, 13px, 1.55)：默认正文与提示词输入（1.62 行高）；对话消息 12.5px / 1.62，画廊题注 12.5px / 1.5。
- **Label** (550–600, 12.5px, 1.4, +0.01em)：顶栏切换、分段控件、弹出菜单行、搜索与筛选输入；密集控件用 12 / 11.5 / 11px。
- **Caption** (500, 10.5px, 1.3, +0.02em)：计数、提示、标签与时间戳；10px 用于匹配号与批次角标，9px 只用于批次模型名（uppercase，+0.06em）。

### Named Rules
**The System-Voice Rule.** 只用系统 UI 字栈；不为品牌引入展示字体，也不加载任何字体文件——单文件 bundle 不带字体和位图资产。
**The Weight-Ceiling Rule.** 字重只用 400 / 500 / 550 / 600 / 650 五档，上限 650；强调靠墨色加深与字号，不靠 700+ 的粗体堆叠。

## Layout

页面是一个居中收边的整页工作台：`.ofs-root` 留 18px 中性柔光边距（≤980px 为 10px，≤820px 为 8px），内部一张占满余下空间的雾面大卡（24px 圆角、1px Shell Edge、24px 背景模糊）。

外壳纵向分三段：顶栏 58px（≤980px 54px，≤820px 换行）、主体、底部最近生成栏。主体是两列网格：固定 320px 单轨创作面板 + `minmax(0, 1fr)` 画面预览；切到画廊时只保留单列预览区。面板外边距 14px，预览区外边距 14px；最近生成栏是浮在底部的一条，外边距 14px，最小高度 92px，与预览区左右对齐。

画面预览 24px 圆角、26px 内边距，图片按 contain 居中，最大 94% 宽、100% 高；图下是 10px 间距的信息行与动作胶囊。最近生成栏内是横向滚动的批次缩略图（62×62、12px 圆角、批内 3px 缝、批间 16px），右侧一条发丝线与「作品画廊」入口。

画廊是 `columns` 卡片墙：固定 5 列、列间距 14px、卡片间距 14px，卡片 6px 内边距，图片按自身比例撑高，不裁切、不统一高度。工具卡吸顶（≤900px 取消吸顶），分组标题是 12px 强字重配一条发丝线。

节奏统一在 `--ofs-gap: 14px` 与 `--ofs-pad: 18px` 上；面板内边距 15px，分区之间是 10px 垂直留白 + 1px Hairline。控件高度分六档：42（主操作）/ 38（常规按钮）/ 34（输入、图标钮、顶栏胶囊）/ 30（小按钮、dock 胶囊）/ 28（chip、顶栏切换）/ 26（分段控件内钮）。

响应式按桌面优先收：≤1400px 画廊降到 4 列；≤1120px 品牌副标与模型前缀隐藏；≤980px 外边距收到 10px、缩略图 54px；≤900px 画廊 2 列；≤820px 改为单列堆叠——面板在上、画面预览在下（62vh）、最近生成栏隐藏、顶栏换行；≤700px 画廊工具折行；≤520px 控件再缩一档。

### Named Rules
**The Preview Rule.** 中央画布是页面的唯一焦点：左栏只收纳控制，最近生成栏贴在底部，任何新增控制面都必须落到边缘，不能与画布争夺中心。
**The Print-Wall Rule.** 画廊固定 5 列自然高度（≤1400px 4 列、≤1180px 3 列、≤900px 2 列）；不裁切图片、不强制等高，列宽随窗口收窄。

## Elevation & Depth

混合式深度：先有地面，再有阴影。地面是三层径向柔光叠在底色上的中性光场，让页面像被柔光灯从左上和下方照亮；随后外壳、卡片、最近生成栏按层级浮起，浮起幅度由四档中性阴影控制。所有阴影都带正 Y 偏移与负扩散，颜色是近黑 rgb(16 16 20)，深色主题下换成纯黑并加深，从不使用彩色或零偏移光晕。

背景模糊与明度一起工作：大外壳 24px（saturate 140%），最近生成栏与画廊工具卡 18px，画布上的玻璃钮与提示条 14px，缩略图元信息 8px。图片本身单独用一层更深的投影（`0 30px 64px -28px rgb(16 16 20 / 38%)`）把自己从画布上托起来；放大层的图片用 `0 40px 90px -30px rgb(0 0 0 / 70%)`。

### Shadow Vocabulary
- **card** (`0 1px 2px rgb(16 16 20 / 5%), 0 10px 24px -16px rgb(16 16 20 / 22%)`)：面板、画廊卡片、最近生成栏、画廊工具卡的静止态。
- **lift** (`0 2px 6px rgb(16 16 20 / 6%), 0 18px 40px -20px rgb(16 16 20 / 26%)`)：悬停抬升、弹出层、Toast、画廊卡片 hover。
- **window** (`0 1px 3px rgb(16 16 20 / 5%), 0 36px 80px -48px rgb(16 16 20 / 32%)`)：全页唯一的大玻璃外壳。
- **accent** (`0 8px 18px -10px rgb(16 16 20 / 48%)`)：墨黑主按钮与品牌标下方，仍是中性近黑，不是彩色发光。
- **focus-ring** (`0 0 0 2px var(--ofs-card-solid), 0 0 0 4px rgb(20 20 22 / 45%)`)：所有键盘焦点；深色主题换成 40% 白。

### Named Rules
**The Offset-Neutral Rule.** 阴影永远是中性近黑、带正偏移与柔和扩散；不用零偏移光晕、不用彩色阴影、不做霓虹 glow。
**The Ground-First Rule.** 深度先由地面柔光与表面明度差建立，阴影只补最后一层距离；没有地面关系的纯投影会让卡片看起来像贴纸。

## Shapes

圆角是随面积递减的阶梯：整页外壳、画面预览、画廊空态用 24px；面板、最近生成栏、画廊卡片、对话输入卡用 18px；弹出层与对话气泡大角用 16px；提示词输入卡、比例块、参数行与主按钮用 14px；基础按钮与缩略图 12px；玻璃图标钮与放大层关闭钮 11px；图标按钮、小输入框、参数文本域 10px；品牌标、弹出菜单行、参数输入 9px；标签 6px；所有胶囊与状态胶囊是 999px。

嵌套圆角只在有内边距的图片框上做同心计算：画廊卡片 18px 圆角 + 6px 内边距，内部图片框用 `calc(var(--ofs-r-lg) - 7px)` 得 11px，两层视觉上同心；面板 18px 是容器层级，内部 14px 输入卡属于控制层级，不做同心计算。

边框只有 1px：Hairline 做内部分隔，Shell Edge / Panel Edge 做外轮廓；进行中的骨架卡与空缩略图槽用 1px 虚线（墨黑 36% 或 Sunken 边）。图片在画布上 contain、不裁切；在画廊卡片与最近生成栏缩略图里 cover、填满比例框——同一种图片，两种取景规则。

图标是形状语言的一部分：全部手写 SVG，24×24 网格、1.6px 描边、圆头圆角、单色 currentColor；只有收藏星与状态点在选中时用填充。

### Named Rules
**The Concentric Corner Rule.** 内层表面的圆角 = 外层圆角 − 内边距（18px 卡片 − 7px 内边距 = 11px 图片框）；不要让两层圆角各写一个数，嵌套就会错位。
**The Drawn-Mark Rule.** 图标只来自同一套 24×24 / 1.6px 圆角描边的单色 SVG；不用 emoji、不用 Unicode 符号、不用位图图标。

## Components

控件像印相室里的器材：金属灰的胶囊、圆角灰块、白色相纸卡；只有主操作被墨黑实心标记。

### Buttons
- **Shape:** 主操作 42px 高、14px 圆角；常规按钮 38px / 12px；小按钮 30px / 10px；图标钮 34×34 / 10px；玻璃图标钮 34×34 / 11px。
- **Primary:** 墨黑两段渐变（Ink Lift → Studio Ink），Ink On 文字 13.5px / 600 / +0.02em，宽 100%，放在面板底部的发丝线上；悬停上移 1px 并加深阴影，按下回位并缩到 0.99，禁用时保留渐变但降到 36% 不透明度并去饱和。
- **Hover / Focus:** 所有按钮 150–160ms 过渡；键盘焦点统一两环 focus ring（2px 卡片色空隙 + 2px 墨黑 45%）。
- **Secondary / Ghost:** 次级是白底 + Panel Edge 描边 + card 阴影，悬停边框转 Ink Wash Edge、文字转墨黑；dock 上用 30px 高的胶囊。Ghost 是透明底 Ink Secondary，文字动作是透明底墨黑，悬停落到 Ink Wash。主操作每屏最多一个，见下方规则。

### Chips
- **Style:** 28px 高胶囊，白底、Sunken 边、Ink Secondary 文字 12px / 500；悬停描边与文字变深。
- **State:** 选中用 Ink Wash 底 + Ink Wash Edge 描边 + 墨黑文字；危险态用 Error 文字 + Error wash 浅底，悬停描边转危险色。画廊工具条里的 chip 放大到 32px / 12.5px；对话工具条压到 27px / 11.5px。

### Segmented Control
- 3px 内边距的药丸轨道放在 Sunken Well 上，内部按钮 26px 高、12px / 500；当前项换 Print White 底、600 字重、1px 中性微影。用于面板头部的「表单 / 对话」和顶栏的「创作 / 画廊」。

### Cards / Containers
- **Corner Style:** 面板与画廊卡片 18px；外壳与画布 24px；弹出层 16px。
- **Background:** 卡片一律 Print White；外壳是 86% 白的雾面；最近生成栏是 78% 白的半透明 + 18px 模糊，画廊工具卡用同一雾面外壳（86%）+ 18px 模糊 + 140% 饱和。
- **Shadow Strategy:** 静止 card，悬停 lift；外壳 window；见 Elevation & Depth。
- **Border:** 1px Panel Edge 或 Shell Edge；内部用 1px Hairline。
- **Internal Padding:** 面板 15px（头 15/15/11，底 12/15/14），画廊卡片 6px，最近生成栏 10/12。

### Inputs / Fields
- **Style:** 提示词输入是 18px 外卡片里的 14px 渐变输入区（Print White → Sunken Well），1px Sunken 边；标准输入 34px 高、10px 圆角、Sunken Well 底；搜索是 34px 胶囊；参数输入 30px 高、9px 圆角。
- **Focus:** 输入区 `focus-within` 时描边转 Ink Wash Edge 并加 3px 10% 墨黑光晕；普通输入与搜索用两环 focus ring；占位符 Ink Tertiary，光标墨黑。
- **Error / Disabled:** 禁用文字降到 Ink Quaternary、背景转透明；错误不染红整个输入框，而是走顶部的异常指引条。

### Navigation
- **Style:** 顶栏 58px、内边距 0 16px、间距 14px；品牌标是 30×30、9px 圆角的墨黑渐变方块；品牌名 13.5px / 650，后面跟 10px / 550 / +0.14em 的 uppercase 副标。视图切换是 Sunken Well 药丸轨道上的 28px tab，当前项白底 600 字重。
- **Creation panel:** 固定 320px 的单轨卡片，顶部是标题与「参数表单 / 创作助手」分段控件，底部固定主操作按钮；视图切换只在顶栏，不再有图标栏。
- **Gallery tools:** 吸顶玻璃卡里放标题、计数、34px 胶囊搜索、模型过滤、收藏 chip 与批量动作，整排控件收在 32–34px 的高度带内。

### Status
- **Dot:** 7px 圆点带 3px 20–22% 同色光环；在线时 2.4s 呼吸脉冲，排队/预热是琥珀色，失败是红色，离线是中性灰。
- **GPU status:** 34px 白胶囊，状态点 + 12px / 550 文案 + 11px 额度（tabular-nums）+ 一个 `(i)` 悬浮说明 + 13px 箭头；点开是 248px、16px 圆角的弹出层，列出唤醒 / 休眠 / 检查凭据。
- **Toast:** 居中偏下、最宽 78% 的玻璃药丸（88% 卡片色 + 14px 模糊 + lift 阴影），2.6 秒后自行退场。

### Signature Components
- **Preview Stage:** 居中 contain 的大图，右上角三枚玻璃图标钮（放大 / 复制路径 / 收藏），底部中央渲染进度是玻璃药丸 + 54×4px 的墨黑扫光条；放大层是 72% 墨黑 + 16px 模糊的全屏遮罩。
- **Recent strip:** 按批次聚合的缩略图流，批角标写 10px 张数与 9px uppercase 模型名；进行中的位置不是转圈而是一张 148px 虚线骨架卡（墨黑 36% 虚线 + 扫光条）；选中的缩略图是 2px 墨黑描边 + 3px 20% 墨黑光环。
- **Gallery wall:** 5 列自然高度卡片墙，卡片是「图片 + 两行题注 + 模型/种子标签行」；悬停时图片底部浮出「带回参数 / 生成变体 / 查看大图」操作；批量选择时左上角出现 20px 圆点，选中后填充墨黑渐变；收藏是右上角玻璃圆点星星。悬停上移 2px 换 lift 阴影。
- **Guidance / Empty:** 异常指引是 Warn wash 底 + Warn 26% 描边的窄幅提示条，左侧 28×28、9px 圆角的图标块；空态是一块 54×54、18px 圆角的墨色图标块 + 16px 标题 + 一行说明 + 灵感示例胶囊，全部保持中性。

### Named Rules
**The One Solid Button Rule.** 每个视图最多只有一个墨黑实心按钮（生成或发送）；其余动作一律白底描边、透明 ghost 或文字动作，不允许出现第二个实心强调块。
**The Pill-Only-For-Actions Rule.** 胶囊只给单行控件（chip、tab、dock 按钮、状态胶囊、单行搜索）；面板、卡片与多行输入用 10–18px 的圆角矩形，避免“万物胶囊”。

## Do's and Don'ts

### Do:
- **Do** 用 Studio Ink (#141416) 作为唯一强调色，深色主题反相为近白 #f2f2f4。
- **Do** 让地面保持中性柔光渐变（三层径向 + 底色），卡片用 1px 发丝描边 + 带偏移的中性柔影浮起。
- **Do** 把画布放在中心、把控制收进固定 320px 的单轨面板；新控件先考虑边缘位置。
- **Do** 保持画廊 5 列（≤1400px 4 列）自然高度，图片按原始比例，不裁切。
- **Do** 让深浅主题共用同一套明度关系：地面 → 卡片 → 文字 → 主操作，每一层只差明度。
- **Do** 把语义色限制在 7px 状态点或窄幅提示条；出错时用整行异常指引条，而不是染红整个区域。
- **Do** 用系统 UI 字栈与 24×24 / 1.6px 圆角描边图标；数字用 tabular-nums 对齐。
- **Do** 给键盘焦点两环 focus ring，并在 `prefers-reduced-motion` 下停用脉冲、扫光与过渡。

### Don't:
- **Don't** 引入任何彩色主题色、彩色渐变或彩色光晕；参考图里的紫与蓝已被明确移除。
- **Don't** 把成功、警告、错误做成大面积填充、卡片底色或主按钮颜色。
- **Don't** 用彩色阴影、零偏移 glow 或霓虹描边制造层级。
- **Don't** 用 emoji 或 Unicode 字符当图标（▾、✨、⭐ 都换成手写 SVG）。
- **Don't** 让每个区域都长成同规格的等比重卡片；画布与最近生成栏有明确的主次。
- **Don't** 为“好看”增加第二套字体、加载字体文件或位图资产。
- **Don't** 把胶囊套在容器与多行输入上；胶囊只留给单行动作、状态与搜索。
- **Don't** 用禁用色 Ink Quaternary (#a8a8b0) 承载信息；它只用于禁用态与滚动条。