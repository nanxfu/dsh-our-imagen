export const I18N = {
  zh: {
    pageTitle: '生图工作台 · Imagen Studio — 开源免显卡生图工作台',
    skipTo: '跳转到主要内容',
    brandName: '生图工作台',
    navAria: '页面导航',
    navWorks: '生成样张',
    navLab: '模型评测',
    navWorkflow: '操作模式',
    navArch: '架构与特性',
    navInstall: '安装部署',
    langAria: '语言切换',
    themeToggle: '切换深浅色主题',
    motionToggle: '切换动效',
    motionOn: '动效已开启',
    motionOff: '动效已关闭',
    motionNotice: '动效已关闭：已暂停轮播、滚动淡入及背景动画。',
    motionEnable: '开启动效',

    heroTitle: '无需本地 GPU，流畅运行主流开源生图模型。',
    heroLead:
      '面向 DeepSeek Harness 的开源图像生成插件。利用 Kaggle 免费提供的 2×T4 GPU 运行推理，免去本地部署 PyTorch 与 CUDA 环境的复杂流程，生成图像实时回传并保存至本地 imagen-output/ 目录。',
    heroCtaPrimary: '快速安装上手',
    heroCtaSecondary: '浏览 30 张实测样张',
    factModels: '9 款开源模型预置',
    factSpeed: '最快 1.9 秒 / 张',
    factLocal: '图像仅留存于本地',
    heroScroll: '向下滚动查看更多',
    heroPrintAria: '查看大图预览',
    heroThumbsAria: '切换样张',
    heroThumbAria: '切换至《{title}》',

    wallTitle: '30 张实测样张，均由 Kaggle 云端环境直接渲染。',
    wallDesc:
      '样张均在 Kaggle 2×T4 环境下通过本插件实际生成，仅转存为 WebP 格式，无任何后期修饰。滚动页面可浏览生成详情。',
    wallCountTpl: '{frames} 张样张 · {models} 款模型 · Kaggle 2×T4',
    wallDeveloped: '显影进度',
    wallHint: '点击任意样张查看生成参数与硬件开销',
    wallPrintAria: '查看《{title}》大图',

    labTitle: '9 款模型实测数据与生图效果一览。',
    labDesc:
      '所有样张均基于 Kaggle 2×T4 硬件实测生成，保持原始输出并转换为 WebP 格式。在左侧切换模型，查看单张耗时、显存占用及完整 Prompt。',
    modelFilterAria: '按推理速度筛选模型',
    filterAll: '全部 9 款',
    filterFast: '极速档 (≤11s)',
    filterUsable: '高精度与二次元',
    modelListAria: '选择模型',
    railHeadModel: '预置模型',
    railHeadSpeed: '单张稳态耗时',
    railFast: '快 2s',
    railSlow: '慢 90s',
    labPrintAria: '放大查看样张',
    replayDevelop: '重播动效',
    copyPrompt: '复制提示词',
    promptLabel: '生成提示词 (Prompt)',
    modelItemAria: '选择 {model}',

    wfTitle: '支持独立工作台与对话交互双入口。',
    wfDesc:
      '两种使用场景共享同一底层云端实例，无需单独启动。在对话中生成的图像，可随时导入独立工作台做二次重绘或参数精调。',
    wfTabsAria: '切换操作模式',
    wfTabStudio: '独立工作台',
    wfTabChat: '对话快捷生成',
    wfShotsAria: '界面截图预览',
    shotMain: '工作台主视图',
    shotPicker: '模型选择界面',
    shotGallery: '本地历史画廊',

    archTitle: '免费算力直连，数据本地自留，边界清晰透明。',
    archDesc:
      '无需经由第三方中转服务，不托管至任何公共图床。插件仅负责安全传输调度指令至 Kaggle 实例，推理完成后将图片直接流式回传并落盘至本地。',
    topo1Title: '本机 · DSH 界面',
    topo1Sub: '独立工作台 / 聊天工具卡片',
    topoTunnel: '一次性 Token 加密隧道',
    topo2Title: '本地 Node.js Host',
    topo2Sub: '状态维护、任务分发与本地存储',
    topo3Title: 'Kaggle 2×Tesla T4',
    topo3Sub: 'daemon.py · 30GB 共享显存',
    topoSave: '流式回传落盘',
    topo4Sub: '100% 保存在本地工作区',

    truth1Title: '每周 30 小时额度，实际产出能力如何？',
    truth1Body:
      'Kaggle 为已完成手机号认证的用户提供每周 30 小时的免费 2×T4 GPU 算力。以主力模型 SDXL Lightning（1024px，实测约 6.2 秒/张）估算，理论极限每周可达 17,000+ 张。日常按需生成，每周通常仅消耗 1~2 小时。',
    truth2Title: '忘记关闭实例会怎样？重启会重复启动吗？',
    truth2Body:
      '远端实例闲置满 30 分钟会自动终止运行，避免浪费算力配额；界面顶栏也支持随时手动关机。本地通过 .imagen/session.json 维护会话状态，重启或刷新 DSH 后会自动探测并复用运行中的实例，避免重复创建。',
    truth3Title: '使用前需了解的限制与注意事项',
    truth3Body:
      '1) Kaggle 账号须完成手机号验证，否则平台不会分配 GPU 资源；2) 首次冷启动需要 3~10 分钟用于分配云端实例及拉取模型权重，就绪后单张生成时间稳定在数秒级；3) 当前处于预览阶段，Colab 与本地 GPU 后端驱动正在适配中。',

    driversTitle: '算力后端驱动支持进度',
    driversSub: '前端工作台与底层推理引擎完全解耦',
    thDriver: '后端驱动',
    thStatus: '状态',
    thSpec: '算力规格',
    thCost: '成本',
    thNote: '说明',
    stBuiltIn: '内置支持（默认）',
    stProgress: '开发中',
    stPlanned: '规划中',
    costFree: '免费（30 小时/周）',
    costColab: '免费 / Pro 订阅',
    costCustom: '按需付费 / 自建',
    costLocal: '本地硬件',
    noteKaggle: '开箱即用，支持浏览器 OAuth 授权直连与会话复用',
    noteColab: '支持 Notebook 一键挂载与直连隧道，扩展算力选项',
    noteCustom: '适用于拥有私有 GPU 服务器或需要长期常驻的用户',
    noteLocal: '面向拥有本地大显存显卡、追求纯离线运行的用户',

    instTitle: '免去 CUDA 配置，仅需 Kaggle 账号与 DeepSeek Harness。',
    instDesc:
      '自 0.8.2 版本起，无需安装 kaggle 命令行工具，可在插件设置中直接通过浏览器完成 OAuth 快捷登录。',
    step1Title: '准备 Kaggle 账号',
    step1BodyA: '注册或登录 Kaggle，在 Account 设置中完成',
    step1BodyEm: '手机号认证（Phone Verification）',
    step1BodyB: '，这是获取免费 GPU 资源的必要条件。',
    step1OptA: '方案 A · 浏览器授权（推荐）',
    step1OptADesc:
      '安装插件后，打开「GPU 状态 → 运行设置 → 高级 → Kaggle 访问方式选直连」，在浏览器中点击授权完成绑定。',
    step1OptB: '方案 B · Kaggle CLI 配置',
    step2Title: '安装插件至 DSH',
    instTabGui: '图形界面安装',
    instTabCli: '命令行安装',
    instTabOffline: '离线包 / 源码',
    guiStep1A: '打开 DeepSeek Harness，进入',
    guiStep1Em: '设置 → 插件管理 → 安装插件',
    guiStep1B: '；',
    guiStep2: '粘贴下方仓库地址并确认安装，完成后重启 DSH：',
    profileLabel: '环境 Profile：',
    cliHint: '安装或升级后重启 DSH，左侧工具栏即可显示「生图工作台」图标。',
    offlineDesc:
      '在网络受限环境下，可从 GitHub Releases 下载发布包解压后在 DSH 中选择「本地加载（Load Bundle）」；开发者本地调试可执行：',
    step3Title: '启动云端实例并开始生成',
    step3BodyA: '进入工作台，点击顶部',
    step3BodyEm: '「开机 / 唤醒云端」',
    step3BodyB:
      '。首次启动 Kaggle 约需 3~10 分钟分配资源与预热模型权重；就绪后状态显示为 Online，后续单张生成耗时通常在 2~10 秒内，生成结果直接存入本地 imagen-output/。',
    goGithub: '访问 GitHub 仓库',
    goReleases: '查看 Releases 发布页',

    footerDesc:
      '基于 DeepSeek Harness 插件体系构建，感谢 DSH 平台、Kaggle 免费算力与开源扩散模型社区的支持。',
    creatorSlogan: '技术演示、模型评测与版本动态分享。',
    footerMeta: '全部样张均在 Kaggle 2×T4 环境实际生成，数据仅留存在本地。',

    flowStepLabel: '数据流向说明',
    flow1: '提示词、画幅比例与随机种子均保存在本地，仅单次生成任务参数对外传输。',
    flow2: '本地 Host 负责任务排队、记录会话状态与文件落盘路径；重启后任务状态不丢失。',
    flow3: '云端容器负责加载权重至 30GB 显存并执行推理生成，不留存任何用户图像或数据。',
    flow4: '生成结果通过加密流式传输直接写入本地 imagen-output/ 目录，不经过任何外部图床。',
    lightboxClose: '关闭预览',
    lightboxPrev: '上一张',
    lightboxNext: '下一张',

    copyBtn: '复制',
    copied: '已复制到剪贴板',
    copyFailed: '复制失败，请手动选中文本',
    specLabels: {
      steady: '稳态耗时',
      sampleSec: '实测耗时',
      stepsCfg: '采样步数 / CFG',
      vram: '峰值显存',
      size: '输出分辨率',
      seed: '随机种子 (Seed)',
      img2img: '图生图 (Img2Img)',
      repo: '模型开源仓库',
      yes: '支持',
      no: '暂未支持',
    },
    wfData: {
      studio: {
        title: '三个界面串成一条路径：写提示词、选模型、回看历史。',
        windowTitles: [
          '生图工作台 · 创作视图',
          '生图工作台 · 模型选择',
          '生图工作台 · 历史画廊',
        ],
        chips: ['工作台主视图', '模型选择界面', '本地历史画廊'],
        points: [
          '提示词框支持四轴润色建议（光影、材质、构图、氛围），也能把中文一键转为英文，都不改写原始描述；参数面板只显示当前模型用到的项，负向词在 CFG=0 的极速预设上自动隐藏。',
          '9 款预置模型的实测耗时、模型规格与提示词语言（仅英文 / 中英双语）集中在选择界面；换模型后，参数面板自动收敛到该模型支持的选项。',
          '本地历史画廊保留每张图的完整参数，支持一键图生图重绘、参数回溯与在文件管理器中定位原图。',
        ],
        note: '画幅切换与参数调整实时响应；图像生成完成后平滑呈现。',
      },
      chat: {
        title: '支持自然语言快速生成，免去手动编写复杂英文 Prompt。',
        windowTitle: '生图工作台 · 对话确认卡片',
        chips: ['自然语言描述', '参数确认卡片', '历史缩略图栏'],
        points: [
          '在日常对话中直接输入中文自然语言描述，系统自动将其转换为符合目标模型习惯的英文 Prompt 并匹配合适画幅比例。',
          '支持交互式确认机制：任务下发前弹出参数确认卡片，支持就地调整提示词与参数，确认后方才执行。',
          '对话中生成的图像实时同步至历史缩略图栏，支持一键载入独立工作台进行深度重绘或批量生成。',
        ],
        note: '预置 9 款模型特性与负向词规则；若所选模型与描述意图不匹配，系统会给出建议但不会强制干预。',
      },
    },
  },

  en: {
    pageTitle: 'Imagen Studio (dsh-our-imagen) — Free Open-Source Image Studio Without a Local GPU',
    skipTo: 'Skip to main content',
    brandName: 'Imagen Studio',
    navAria: 'Page navigation',
    navWorks: 'Samples',
    navLab: 'Model Benchmarks',
    navWorkflow: 'Workflows',
    navArch: 'Architecture',
    navInstall: 'Setup Guide',
    langAria: 'Language',
    themeToggle: 'Toggle light or dark theme',
    motionToggle: 'Toggle motion',
    motionOn: 'Motion is on',
    motionOff: 'Motion is off',
    motionNotice: 'Motion is off: animations, transitions, and background effects are paused.',
    motionEnable: 'Enable motion',

    heroTitle: 'Run open-source image models without a GPU.',
    heroLead:
      'An open-source image workbench plugin for DeepSeek Harness. Diffusion runs on Kaggle free 2×T4 cloud GPUs, with no PyTorch or CUDA setup on your machine, and every image is saved straight to your local imagen-output/ folder.',
    heroCtaPrimary: 'Install in 3 Steps',
    heroCtaSecondary: 'See 30 Benchmark Samples',
    factModels: '9 tested open models',
    factSpeed: 'Fastest 1.9 s / image',
    factLocal: 'Images stay in your workspace',
    heroScroll: 'Scroll to explore',
    heroPrintAria: 'Open full-size preview',
    heroThumbsAria: 'Switch sample',
    heroThumbAria: 'Switch to {title}',

    wallTitle: 'Thirty benchmark samples, rendered directly in cloud runtime.',
    wallDesc:
      'Every sample was generated by this plugin on Kaggle 2×T4, converted to WebP with zero retouching. Scroll to view generation details and benchmark metrics.',
    wallCountTpl: '{frames} samples · {models} models · Kaggle 2×T4',
    wallDeveloped: 'Developed',
    wallHint: 'Click any sample for full generation parameters and hardware metrics',
    wallPrintAria: 'Open full-size {title}',

    labTitle: 'Nine models, real outputs, measured numbers.',
    labDesc:
      'Every image below was generated on Kaggle 2×T4 using this plugin and converted to WebP with zero post-processing. Pick a model on the left to inspect its outputs, VRAM footprint, and exact prompt.',
    modelFilterAria: 'Filter models by speed',
    filterAll: 'All 9 Models',
    filterFast: 'Fast (≤11s)',
    filterUsable: 'Detailed & Anime',
    modelListAria: 'Choose a model',
    railHeadModel: 'Built-in Presets',
    railHeadSpeed: 'Steady / Image',
    railFast: 'fast 2s',
    railSlow: 'slow 90s',
    labPrintAria: 'Open full-size preview',
    replayDevelop: 'Replay Animation',
    copyPrompt: 'Copy Prompt',
    promptLabel: 'Exact Prompt Used',
    modelItemAria: 'Choose {model}',

    wfTitle: 'Full studio for tuning, chat window for quick ideas.',
    wfDesc:
      'Both views share the same running cloud kernel. Anything you generate inside chat can be pulled into the full studio for parameter recall or img2img redraws.',
    wfTabsAria: 'Switch workflow view',
    wfTabStudio: 'Full Studio',
    wfTabChat: 'In-Chat Tool',
    wfShotsAria: 'Interface screenshots',
    shotMain: 'Studio View',
    shotPicker: 'Model Selector',
    shotGallery: 'Local Gallery',

    archTitle: 'Direct free compute, local storage, transparent boundaries.',
    archDesc:
      'No middleman servers and no external hosting. The plugin sends execution commands securely to Kaggle and streams generated images directly back to local storage.',
    topo1Title: 'Your Machine · DSH UI',
    topo1Sub: 'Studio / Chat Confirmation Card',
    topoTunnel: 'One-Time Token Tunnel',
    topo2Title: 'Local Node.js Host',
    topo2Sub: 'Session state, queue, disk write',
    topo3Title: 'Kaggle 2×Tesla T4',
    topo3Sub: 'daemon.py · 30GB VRAM',
    topoSave: 'Direct Local Stream',
    topo4Sub: '100% saved in your workspace',

    truth1Title: 'How far does 30 hrs/week go?',
    truth1Body:
      'Kaggle grants 30 weekly GPU hours to every phone-verified account. Using SDXL Lightning (1024px, measured 6.2s/image), the theoretical ceiling is 17,000+ images per week. Regular daily usage typically consumes only 1–2 hours per week.',
    truth2Title: 'What happens if I forget to stop the instance?',
    truth2Body:
      'The remote kernel shuts down automatically after 30 minutes of idle time (or manually from the top bar anytime). Local .imagen/session.json tracks session status so restarting DSH reconnects to the running machine without launching duplicates.',
    truth3Title: 'Limitations and prerequisites to know',
    truth3Body:
      '1) Your Kaggle account must be phone-verified to receive GPU allocations; 2) Cold starts take 3–10 minutes to provision runtime and load model weights before reaching steady speed; 3) Currently in Preview: Colab and local GPU backends are under active development.',

    driversTitle: 'Pluggable Backend Drivers',
    driversSub: 'Studio UI is decoupled from the inference engine',
    thDriver: 'Driver',
    thStatus: 'Status',
    thSpec: 'Compute',
    thCost: 'Cost',
    thNote: 'Notes',
    stBuiltIn: 'Built-in (Default)',
    stProgress: 'In Progress',
    stPlanned: 'Planned',
    costFree: 'Free (30 hrs/wk)',
    costColab: 'Free / Pro',
    costCustom: 'Pay-per-use / Private',
    costLocal: 'Local Hardware',
    noteKaggle: 'Works out of the box with browser OAuth or Kaggle CLI',
    noteColab: 'One-click notebook attach and tunnel link',
    noteCustom: 'For creators running private GPU servers or 24/7 boxes',
    noteLocal: 'For users with local high-VRAM GPUs wanting offline runs',

    instTitle: 'No CUDA setup. Just a Kaggle account and DeepSeek Harness.',
    instDesc:
      'Since v0.8.2, you do not even need the Kaggle CLI; sign in via browser OAuth straight from the studio settings.',
    step1Title: 'Prepare a Kaggle account',
    step1BodyA: 'Sign in to Kaggle and complete',
    step1BodyEm: ' Phone Verification',
    step1BodyB: ' in Account Settings. Without it, Kaggle blocks GPU allocation.',
    step1OptA: 'Option A · Browser OAuth (Recommended)',
    step1OptADesc:
      'Install the plugin first, then open GPU Status → Run Settings → Advanced → Direct mode and sign in with Kaggle OAuth in your browser.',
    step1OptB: 'Option B · Kaggle CLI',
    step2Title: 'Install into DeepSeek Harness',
    instTabGui: 'DSH UI',
    instTabCli: 'CLI Command',
    instTabOffline: 'Offline / Local',
    guiStep1A: 'Open DeepSeek Harness →',
    guiStep1Em: 'Settings → Plugins → Install Plugin',
    guiStep1B: ';',
    guiStep2: 'Paste the repository specifier below and restart DSH:',
    profileLabel: 'Profile:',
    cliHint: 'Restart DSH after installing or upgrading; Imagen Studio appears in the left rail.',
    offlineDesc:
      'Behind a restricted network? Grab the zip from GitHub Releases and use Load Bundle in DSH, or link your local clone:',
    step3Title: 'Wake GPU once, then keep drawing',
    step3BodyA: 'Click',
    step3BodyEm: '“Start Cloud GPU”',
    step3BodyB:
      ' in the studio header. Initial provisioning takes 3–10 minutes; once Online, subsequent images land in imagen-output/ in 2–10 seconds.',
    goGithub: 'Read Docs on GitHub',
    goReleases: 'GitHub Releases',

    footerDesc:
      'Built on the DeepSeek Harness plugin system. Thanks to DSH, Kaggle free GPUs, and the open-source diffusion teams.',
    creatorSlogan: 'Demos, model benchmarks, and release notes on Douyin.',
    footerMeta: 'Every sample was generated by this plugin on Kaggle 2×T4 and lives only in your workspace.',

    flowStepLabel: 'Pipeline flow',
    flow1: 'Prompt, aspect ratio, and seed stay on your machine; only this job\u2019s parameters leave.',
    flow2: 'The Host queues the job, records session state, and decides where the file lands.',
    flow3: 'The cloud container loads weights into 30 GB of VRAM, renders, and keeps nothing.',
    flow4: 'Each image streams straight back into your local imagen-output/ \u2014 no image host in between.',
    lightboxClose: 'Close preview',
    lightboxPrev: 'Previous',
    lightboxNext: 'Next',

    copyBtn: 'Copy',
    copied: 'Copied to clipboard',
    copyFailed: 'Copy failed — select the text manually',
    specLabels: {
      steady: 'Steady Ref',
      sampleSec: 'Measured',
      stepsCfg: 'Steps / CFG',
      vram: 'Peak VRAM',
      size: 'Output Size',
      seed: 'Seed',
      img2img: 'Img2Img',
      repo: 'Upstream Repo',
      yes: 'Supported',
      no: 'Not yet',
    },
    wfData: {
      studio: {
        title: 'Three views, one path: write the prompt, pick the model, revisit the gallery.',
        windowTitles: [
          'Imagen Studio · Studio',
          'Imagen Studio · Model Picker',
          'Imagen Studio · Gallery',
        ],
        chips: ['Studio View', 'Model Selector', 'Local Gallery'],
        points: [
          'Four-axis prompt polish suggestions (Lighting, Material, Composition, Mood) plus one-click Chinese-to-English translation, both without rewriting your description; the rail shows only what the active model uses, and negative prompt hides itself on CFG=0 fast presets.',
          'All nine presets list measured latency, model size, and prompt language (English-only or bilingual) in the picker; switching a model re-fits the rail to the options that model supports.',
          'The local gallery keeps every image\u2019s full parameter set, with one-click img2img redraw, parameter recall, and locating the original file on disk.',
        ],
        note: 'Switching aspect ratios updates dimensions live; completed outputs render smoothly on canvas.',
      },
      chat: {
        title: 'Describe what you want in plain language inside chat.',
        windowTitle: 'Imagen Studio · Chat confirmation',
        chips: ['Plain Prompt', 'Confirm Card', 'Thumbnail Rail'],
        points: [
          'Ask in natural language; the assistant adapts your idea to the active model prompt style and picks an appropriate aspect ratio.',
          'Never runs blindly: it presents an inline-editable confirmation card first so you verify prompt, exclusions, and count before starting.',
          'Images generated in chat appear in the thumbnail rail and can be opened in the full studio at any time.',
        ],
        note: 'Model knowledge for all 9 presets is built in; if another model fits your prompt better, it gives a gentle hint without blocking you.',
      },
    },
  },
};

import { state } from './state.js';

/** 中文字典为基准语言；英文必须保持同构（构建期会校验键集合）。 */
export function t(key) {
  return I18N[state.lang]?.[key] ?? I18N.zh[key] ?? key;
}

/** 用 {name} 占位符填充模板；未知占位符原样保留，便于排查。 */
export function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) =>
    key in values ? values[key] : `{${key}}`
  );
}

export function itemTitle(item) {
  if (!item) return '';
  return state.lang === 'en' ? item.titleEn || item.title : item.title;
}

/** 把 data-t / data-t-aria 标注的静态文案同步到当前语言。 */
export function applyTranslations(root = document) {
  const dict = I18N[state.lang];
  root.querySelectorAll('[data-t]').forEach((node) => {
    const value = dict[node.dataset.t];
    if (typeof value === 'string') node.textContent = value;
  });
  root.querySelectorAll('[data-t-aria]').forEach((node) => {
    const value = dict[node.dataset.tAria];
    if (typeof value === 'string') node.setAttribute('aria-label', value);
  });
}

export function applyDocumentTitle() {
  document.title = t('pageTitle');
}
