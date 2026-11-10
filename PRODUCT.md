# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

在 DSH Desktop 里工作的个人创作者、设计师与开发者：本机没有高端显卡，也不想配置 CUDA / PyTorch 环境，但需要在一个会话里连续出图、对比与沉淀图片。辅助人群：在对话中直接让 AI 画图的 DSH 会话用户。

## Product Purpose

把 Kaggle 每周免费 GPU 额度接进 DSH Desktop，作为插件提供一整页免费文生图工作台：在面板里写提示词、调参数、连续出图，产物直接落盘到当前工作区的 `imagen-output/`。成功等于「开机一次，随画随出，图片留在本地」。

## Positioning

不依赖本机显卡、不经过第三方图床、也不需要打开 WebUI：一个 DSH 插件同时提供整页工作台与对话内工具调用，复用同一个远端 Kernel，单张约 6 秒。

## Operating Context

- 运行环境是 DSH Desktop 的插件槽位：`main` 插槽是整页工作台，侧栏入口与对话页状态徽章是旁路。
- 首次唤起云端需要 Kaggle 排队 5~10 分钟并加载模型；就绪后连续出图约 6 秒/张；闲置 30 分钟自动关机。
- Kaggle 账号必须绑定手机号，未绑定会被降级到 CPU。
- 产物与收藏记录通过宿主 API 读写；图片 URL 指向本地文件服务。
- 开发期用 `tools/preview.mjs` 把工作台渲染成静态页再用无头浏览器截图，不连真实 GPU。
- 文案必须中英双语（`src/dict/zh.js`、`en.js`），键集合一致。

## Capabilities and Constraints

已确认的功能：预设模型选择（SDXL Lightning / Turbo / Base 等）、风格胶囊、画面比例、提示词扩写建议、高级参数（步数 / 引导强度 / 种子 / 张数）、负向提示词、批量生成、焦舞台大图与缩放、以图微调、换种子抽卡、收藏、复制文件路径、底部批次胶卷、画廊（时间线分段、搜索、模型过滤、只看收藏、批量删除 / 复制路径）、对话式面板、云端状态与配额胶囊、错误指引卡、Toast。

技术约束：客户端是单文件 bundle，样式以文本形式打进 bundle，不允许依赖宿主样式管线；只能 require 平台共享的 `react` 与 `react/jsx-runtime`；测试用替身 React 只实现 `useState / useRef / useEffect / useCallback`；不发运任何位图资产（图标全部为手写 SVG）；默认 1024 尺寸，尺寸必须是 8 的整数倍且在 256~1536 之间。

## Brand Commitments

产品名「免费生图工作台 / Imagen Studio」；中文语气现代、专业、克制（见 `docs/UI_COPYWRITING.md`）；图标统一 1.6px 圆角描边线稿；中英双语必须同时成立。

## Evidence on Hand

无真实品牌素材与摄影素材。现有视觉资产：`icon.svg`、`src/studio/icons.jsx` 的手写图标；预览与测试里的渐变占位图是合成的示例数据，不得当作真实作品对外宣称。

## Product Principles

1. 图片是主角：界面退到边缘，画布与作品占据视觉重心。
2. 等待必须可读：排队与渲染是明确的状态卡，不是转圈弹窗。
3. 专业能力藏在顺手处：高级参数默认收起，需要时一步可达。
4. 一切留在本地：产物路径直接可见、可复制，不依赖第三方图床。
5. 状态先于装饰：任何视觉选择不能削弱状态、进度与可操作性。

## Accessibility & Inclusion

键盘可达：Ctrl/Cmd+Enter 生成、Esc 关闭放大层、焦点环可见；正文与占位文字对比度 ≥ 4.5:1；深浅主题都要可读；动效不能遮挡内容（`prefers-reduced-motion` 下停用）。