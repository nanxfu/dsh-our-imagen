export const I18N = {
  zh: {
    pageTitle: '生图工作台 · Imagen Studio — 零显卡免费开源生图工作台',
    skipTo: '跳到主要内容',
    brandName: '生图工作台',
    navAria: '页面导航',
    navWorks: '成片墙',
    navLab: '模型暗房',
    navWorkflow: '两种用法',
    navArch: '原理与边界',
    navInstall: '上手指南',
    langAria: '语言切换',
    themeToggle: '切换深浅色主题',
    motionToggle: '切换动效',
    motionOn: '动效已开',
    motionOff: '动效已关',
    motionNotice: '动效已关闭：轮播、滚动显影与背景动画已暂停。',
    motionEnable: '开启动效',

    heroTitle: '不用买显卡，也能用开源模型画图。',
    heroLead:
      'DeepSeek Harness 的免费生图插件。把推理放到 Kaggle 云端双卡 T4 上跑，不用在本地折腾几十 G 的 PyTorch 与 CUDA，画完的图直接存进你电脑的 imagen-output/ 文件夹。',
    heroCtaPrimary: '三步装好开始画',
    heroCtaSecondary: '看 22 张真实成片',
    factModels: '9 款开源模型实测',
    factSpeed: '快档 1.9 秒 / 张',
    factLocal: '成片只写本地工作区',
    heroScroll: '向下滚动，相纸显影',
    heroPrintAria: '打开大图预览',
    heroThumbsAria: '切换样张',
    heroThumbAria: '切换为《{title}》',

    wallTitle: '22 张成片，全部在这台机器上跑出。',
    wallDesc:
      '每一张都在 Kaggle 双卡 T4 上由这个插件实际生成，只转存 WebP，没有后期修图。滚动时相纸逐张显影；把光标移到成片上，安全灯会重新点亮它的颜色。',
    wallCountTpl: '{frames} 张成片 · {models} 款模型 · Kaggle 2×T4',
    wallHint: '点开任意一张，看它的完整曝光单',
    wallPrintAria: '打开《{title}》大图',

    labTitle: '把 9 个模型的底细和成片摊开看。',
    labDesc:
      '以下样张均在 Kaggle 2×T4 上由本插件实际跑出，仅转存 WebP，无后期修图。选择左侧模型查看成片、显存占用与完整提示词。',
    modelFilterAria: '按模型速度筛选',
    filterAll: '全部 9 款',
    filterFast: '极速 (≤11s)',
    filterUsable: '精绘与二次元',
    modelListAria: '选择模型',
    railHeadModel: '内置模型',
    railHeadSpeed: '稳态单张耗时',
    railFast: '快 2s',
    railSlow: '慢 90s',
    labPrintAria: '放大查看成片',
    replayDevelop: '重播显影',
    copyPrompt: '复制提示词',
    promptLabel: '本次生成提示词',
    modelItemAria: '选择 {model}',

    wfTitle: '想精调进工作台，懒得写词直接在聊天里说。',
    wfDesc:
      '两种入口共用同一个云端实例，不需要开两个后台。在聊天框画完的图，随时能点进整页工作台继续重绘或微调参数。',
    wfTabsAria: '工作模式切换',
    wfTabStudio: '独立工作台',
    wfTabChat: '对话里直接画',
    wfShotsAria: '界面截图',
    shotMain: '工作台主视图',
    shotPicker: '深色模型选卡',
    shotGallery: '本地作品画廊',

    archTitle: '算力白用，图片自留，限制也摊在明面上。',
    archDesc:
      '没有中间服务器抽成，也没有公共图床留存。插件只做一件事：把你本机的操作指令安全地递给 Kaggle，再把算完的图接回本地硬盘。',
    topo1Title: '你的电脑 · DSH 界面',
    topo1Sub: '独立工作台 / 聊天工具',
    topoTunnel: '单次 Token 加密隧道',
    topo2Title: '本地 Node.js Host',
    topo2Sub: '管状态、发任务、写硬盘',
    topo3Title: 'Kaggle 2×Tesla T4',
    topo3Sub: 'daemon.py · 30G 显存',
    topoSave: '流式回传落盘',
    topo4Sub: '100% 留存你自己的工作区',

    truth1Title: '每周 30 小时，实际够画多少？',
    truth1Body:
      'Kaggle 给每位手机认证用户每周提供 30 小时免费 2×T4 额度。按主力 SDXL Lightning（1024px，实测 6.2 秒/张）计算，理论上限一周可出 17,000+ 张图。日常每天画几十张，一周只消耗 1~2 小时。',
    truth2Title: '忘关机怎么办？重启会丢机器吗？',
    truth2Body:
      '云端实例连续空闲满 30 分钟会自动关机，避免空耗额度；也能在顶栏随时手动关。本地 .imagen/session.json 会实时记下会话状态，DSH 刷新或重启后自动探活接管旧机器，不重复开机。',
    truth3Title: '先把局限说清楚',
    truth3Body:
      '1) Kaggle 账号必须先完成手机号绑定，否则会被平台静默降级为 CPU；2) 每次冷启动要等 3~10 分钟分配机器与加载权重（开机后出图才稳定在数秒）；3) 目前处于 Preview，Colab 与本地显卡后端仍在接入。',

    driversTitle: '可插拔算力后端进度',
    driversSub: '前端工作台与底层推理引擎解耦',
    thDriver: '后端驱动',
    thStatus: '状态',
    thSpec: '算力规格',
    thCost: '成本',
    thNote: '说明',
    stBuiltIn: '已内置（默认）',
    stProgress: '接入中',
    stPlanned: '规划中',
    costFree: '免费（30 小时/周）',
    costColab: '免费 / Pro 订阅',
    costCustom: '按需 / 私有',
    costLocal: '本地硬件',
    noteKaggle: '开箱即用，支持浏览器 OAuth 直连与自动会合',
    noteColab: '一键 Notebook 挂载与隧道直连，扩充免费算力来源',
    noteCustom: '适合拥有私有 GPU 或需要长驻不关机的创作者',
    noteLocal: '面向本机已有大显存显卡、需要纯离线运行的用户',

    instTitle: '不用配 CUDA，只要一个 Kaggle 账号和 DeepSeek Harness。',
    instDesc:
      '从 0.8.2 版本开始，就算完全不装 kaggle 命令行工具，也能在插件界面里直接用浏览器完成 OAuth 登录。',
    step1Title: '准备好 Kaggle 账号',
    step1BodyA: '注册或登录 Kaggle，在 Account 设置里完成',
    step1BodyEm: '手机号认证（Phone Verification）',
    step1BodyB: '，这是启用免费 GPU 的硬性前提。',
    step1OptA: '方式 A · 不装 CLI（推荐新手）',
    step1OptADesc:
      '先把插件装进 DSH，随后打开「GPU 状态 → 运行设置 → 高级 → Kaggle 访问方式选直连」，在浏览器点一下授权登录即可。',
    step1OptB: '方式 B · 命令行配置',
    step2Title: '把插件装进 DSH',
    instTabGui: '图形界面',
    instTabCli: '一行命令',
    instTabOffline: '离线 / 源码',
    guiStep1A: '打开 DeepSeek Harness，进入',
    guiStep1Em: '设置 → 插件管理 → 安装插件',
    guiStep1B: '；',
    guiStep2: '粘贴下面的仓库地址并确认，完成后重启 DSH：',
    profileLabel: 'Profile：',
    cliHint: '安装或升级后重启 DSH，左侧工具栏会出现「生图工作台」图标。',
    offlineDesc:
      '网络受限可从 GitHub Releases 下载 zip 解压后，在 DSH 插件管理里选「本地加载（Load Bundle）」；开发者调试可直接：',
    step3Title: '点开机，等几分钟，开始画',
    step3BodyA: '进入工作台点击顶部',
    step3BodyEm: '「开机 / 唤醒云端」',
    step3BodyB:
      '。首次启动 Kaggle 约需 3~10 分钟分配机器与拉取模型权重；状态变绿（Online）后，之后每张图通常 2~10 秒直接落入本地 imagen-output/。',
    goGithub: '去 GitHub 看完整文档',
    goReleases: '下载 Releases',

    footerDesc:
      '基于 DeepSeek Harness 插件体系构建，感谢 DSH 团队、Kaggle 免费算力与各开源扩散模型团队。',
    creatorSlogan: '用 AI 把想法变成画面。工作台演示、模型实测和更新记录都会发在这里。',
    footerMeta: '全部成片由本插件在 Kaggle 2×T4 上生成，仅存本地工作区。',

    flowStepLabel: '光路指引',
    flow1: '提示词、画幅与种子留在本机，只有这一次任务的参数被递出去。',
    flow2: 'Host 排队、记录会话状态与落盘路径；中途刷新或重启，任务也不会丢。',
    flow3: '云端容器只做一件事：把权重装进 30G 显存，按参数出图，不做任何留存。',
    flow4: '图片以流式回传直接写进你本地的 imagen-output/，不经过任何图床。',
    lightboxClose: '关闭预览',
    lightboxPrev: '上一张',
    lightboxNext: '下一张',

    copyBtn: '复制',
    copied: '已复制到剪贴板',
    copyFailed: '复制失败，请手动选中文本',
    specLabels: {
      steady: '稳态参考',
      sampleSec: '本张实测',
      stepsCfg: '步数 / CFG',
      vram: '峰值显存',
      size: '样张尺寸',
      seed: 'Seed',
      img2img: '垫图重绘',
      repo: '模型来源',
      yes: '支持',
      no: '暂不支持',
    },
    wfData: {
      studio: {
        title: '单轨专注面板，只显示当前模型真正生效的参数',
        windowTitle: 'DeepSeek Harness · Imagen Studio',
        points: [
          '高频参数都在明面上：比例、长边分辨率、步数、随机种子和生成张数（1~4）一目了然；极速模型和 FLUX.2 Klein 4B 会自动隐藏不生效的排除词框。',
          '四维轻润色（光影、材质、构图、氛围）按一下往英文提示词里追加修饰语，不破坏原意。',
          '画廊里的任何成片都能一键「以此图重绘」或「带回全部参数」，还能直接打开本地文件夹位置。',
        ],
        note: '按画幅选比例时，光桌上的空白相纸会跟着变形；生成完的新图会播一次「显影落定」过渡。',
      },
      chat: {
        title: '不懂英文提示词？在对话里用大白话直接说',
        windowTitle: 'DeepSeek Harness · Chat Tool Confirmation',
        points: [
          '在日常聊天窗里说一句「画个雨夜的赛博朋克街道」，助手自动转成对应模型习惯的英文写法并推断合适画幅。',
          '不会直接扣额度开跑：先弹出一张可内联修改的确认卡片，你核对完点确定才真正执行。',
          '聊天里画出来的图会出现在右侧胶卷里，点一下就能带进整页工作台做批量抽卡或局部重绘。',
        ],
        note: '助手内置 9 款模型的提示词脾气与负向词能力，遇到更适合的模型只给温和提醒，不硬拦你的选择。',
      },
    },
  },

  en: {
    pageTitle: 'Imagen Studio (dsh-our-imagen) — Free Open-Source Image Studio Without a Local GPU',
    skipTo: 'Skip to main content',
    brandName: 'Imagen Studio',
    navAria: 'Page navigation',
    navWorks: 'Prints',
    navLab: 'Model Darkroom',
    navWorkflow: 'Two Modes',
    navArch: 'How It Works',
    navInstall: 'Setup',
    langAria: 'Language',
    themeToggle: 'Toggle light or dark theme',
    motionToggle: 'Toggle motion',
    motionOn: 'Motion is on',
    motionOff: 'Motion is off',
    motionNotice: 'Motion is off: the carousel, scroll develops, and backdrop animation are paused.',
    motionEnable: 'Enable motion',

    heroTitle: 'Run open-source image models without a GPU.',
    heroLead:
      'An open-source image workbench plugin for DeepSeek Harness. Diffusion runs on Kaggle free 2×T4 cloud GPUs, with no PyTorch or CUDA setup on your machine, and every image is saved straight to your local imagen-output/ folder.',
    heroCtaPrimary: 'Install in 3 Steps',
    heroCtaSecondary: 'See 22 Real Prints',
    factModels: '9 tested open models',
    factSpeed: 'Fastest 1.9 s / image',
    factLocal: 'Prints stay in your workspace',
    heroScroll: 'Scroll to develop',
    heroPrintAria: 'Open full-size preview',
    heroThumbsAria: 'Switch print',
    heroThumbAria: 'Switch to {title}',

    wallTitle: 'Twenty-two prints, all rendered on this machine.',
    wallDesc:
      'Every frame was generated by this plugin on Kaggle 2×T4, converted to WebP with zero retouching. Prints develop one by one as you scroll; move the cursor over one and the safelight brings its colour back.',
    wallCountTpl: '{frames} frames · {models} models · Kaggle 2×T4',
    wallHint: 'Open any print for its full exposure note',
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
    labPrintAria: 'Open full-size print',
    replayDevelop: 'Replay Develop',
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
    shotPicker: 'Dark Model Picker',
    shotGallery: 'Local Gallery',

    archTitle: 'Free compute, local files, and honest limits.',
    archDesc:
      'No middleman server taking a cut and no external image hosting. The plugin relays jobs from your local Host to Kaggle over a single-use token tunnel and writes files directly to disk.',
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
      'Kaggle grants 30 weekly GPU hours to every phone-verified account. Using SDXL Lightning (1024px, measured 6.2s/image), the theoretical ceiling is 17,000+ images per week. Heavy daily sessions usually take only 1–2 hours.',
    truth2Title: 'What if I forget to shut it down?',
    truth2Body:
      'The remote kernel shuts down automatically after 30 minutes of idle time (or anytime from the top bar). Local .imagen/session.json tracks your session so restarting DSH re-attaches to the running machine instead of booting a duplicate.',
    truth3Title: 'Upfront limitations',
    truth3Body:
      '1) Your Kaggle account must be phone-verified, otherwise Kaggle silently falls back to CPU; 2) Cold starts take 3–10 minutes to provision and load weights before hitting steady speed; 3) Currently Preview: Colab and local ComfyUI drivers are still in progress.',

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
    step1OptA: 'Option A · No CLI (Recommended)',
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
    footerMeta: 'Every print was generated by this plugin on Kaggle 2×T4 and lives only in your workspace.',

    flowStepLabel: 'Light path',
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
        title: 'Single-track parameter rail that hides controls a model does not use',
        windowTitle: 'DeepSeek Harness · Imagen Studio',
        points: [
          'Aspect ratio, long-edge resolution, steps, seed, and batch count (1–4) stay visible; negative prompt hides automatically on CFG=0 fast presets and FLUX.2 Klein 4B.',
          'Four-axis prompt polish (Lighting, Material, Composition, Mood) appends English phrases without rewriting your core prompt.',
          'Any piece in the local gallery supports one-click img2img redraw, full parameter recall, and opening its folder on disk.',
        ],
        note: 'Switching aspect ratios resizes the blank print frame on the light table live; new prints play a subtle darkroom develop settle.',
      },
      chat: {
        title: 'Describe what you want in plain language inside chat',
        windowTitle: 'DeepSeek Harness · Chat Tool Confirmation',
        points: [
          'Ask in natural language; the assistant adapts your idea to the active model prompt style and picks an appropriate aspect ratio.',
          'Never runs blindly: it presents an inline-editable confirmation card first so you verify prompt, exclusions, and count before starting.',
          'Images generated in chat appear in the filmstrip and can be opened in the full studio at any time.',
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
