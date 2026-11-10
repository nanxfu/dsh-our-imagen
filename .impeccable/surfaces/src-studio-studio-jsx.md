---
version: 1
slug: "src-studio-studio-jsx"
primary_target: "src/studio/Studio.jsx"
related_targets: []
---

# Surface brief — 整页生图工作台

- Target: `src/studio/Studio.jsx`（`main` 插槽整页视图；含创作面板、画面预览、最近生成栏、画廊、对话形态）
- Mode: Operate
- Platform: web（DSH Desktop 客户端插件）
- Audience / job: 在工作区里连续出图的个人创作者；任务 = 写提示词 → 生成 → 挑选/收藏 → 继续迭代，画廊里翻找历史产物。
- Action / states: 写提示词、选风格/比例、生成、排队与渲染等待、空态、错误指引、收藏、批量删除、offline/error 云端状态。
- Constraints: 单文件 bundle、无位图资产、中英双语、测试替身 React 只有 4 个 hook、宿主深浅主题、桌面整页视图。

## Direction contract

THESIS: 一间黑白灰的工作室式创作台——画面在中央成为唯一焦点，控制件收纳成边缘的灰阶卡片；拒绝控制台式的密集参数面板、彩色渐变与成排等比重卡片。

OWN-WORLD: 中性灰的柔光地面（近白到浅灰，无彩色倾向），上浮 22~24px 圆角的实心近白卡，发丝级描边与中性柔影；墨黑正文、灰阶辅助文字；唯一强调色是墨黑本身，出现在主按钮、选中环、激活图标与状态点；语义色（成功/警告/错误）只以小圆点或窄条出现；控件一律药丸、胶囊与灰阶色块；图标 1.6px 圆角描边。

STORY: 左面板写一句画面 → 画布出现结果与元信息 → 底部悬浮最近生成栏记录每一批；排队与渲染在最近生成栏与顶栏以柔和胶囊呈现；画廊用卡片墙像作品集一样陈列。

FIRST VIEWPORT: 页面留 14~18px 中性柔光边距，内层一张雾面玻璃大卡：顶栏（品牌标 + 创作/画廊分段切换 + 云端 GPU 状态 + 模型选择 + 刷新）、固定 320px 的单轨创作面板、右侧居中的圆角画布与右下角元信息、底部横向悬浮最近生成栏。主操作是面板底部的墨黑「立即生成」。浅色为母版，深色按同一明度关系反相。

FORM: 用户提供的参考图 1（AI 生图工作台：单轨创作面板 + 悬浮画面预览 + 底部最近生成栏）钉住构图，参考图 2/3 的卡片墙钉住画廊视图；seed: none (pinned by user references)。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
