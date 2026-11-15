(function () {
  const dataEl = document.getElementById('site-data');
  if (!dataEl) return;
  const SITE_DATA = JSON.parse(dataEl.textContent || '{}');

  const I18N = {
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

      lightboxClose: '关闭预览',
      lightboxPrev: '上一张',
      lightboxNext: '下一张',

      copyBtn: '复制',
      copied: '已复制到剪贴板',
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

      lightboxClose: 'Close preview',
      lightboxPrev: 'Previous',
      lightboxNext: 'Next',

      copyBtn: 'Copy',
      copied: 'Copied to clipboard',
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

  const HERO_PICKS = [
    'flux2-klein-4b-kyoto-poster.webp',
    'sdxl-lightning-cyberpunk-street.webp',
    'realvis-v5-fisherman-portrait.webp',
    'animagine-xl-3.1-sakura-girl.webp',
  ];

  const WORKFLOW_SHOTS = {
    'studio-light': './assets/studio-light.png',
    'model-picker-dark': './assets/model-picker-dark.png',
    gallery: './assets/gallery.png',
    chat: './assets/chat-tool.png',
  };

  const state = {
    lang: 'zh',
    theme: 'dark',
    motionMode: 'on',
    heroIdx: 0,
    heroAura: -1,
    heroPaused: false,
    heroVisible: true,
    filter: 'all',
    selectedModelId: 'sdxl-lightning',
    selectedSampleFile: null,
    wfMode: 'studio',
    wfStudioShot: 'studio-light',
    instTab: 'gui',
    cliProfile: 'desktop',
    lightboxIdx: -1,
    lightboxReturnFocus: null,
  };

  const root = document.documentElement;
  const models = SITE_DATA.models || [];
  const showcaseItems = SITE_DATA.showcase?.items || [];
  const maxSteady = Math.max(...models.map((m) => m.measured?.steadySeconds || 1), 1);
  const finePointer = window.matchMedia ? window.matchMedia('(pointer: fine)').matches : true;

  function motionEnabled() {
    return state.motionMode !== 'off';
  }

  function applyMotion(persist) {
    if (persist) {
      try {
        localStorage.setItem('imagen-site-motion', state.motionMode);
      } catch {}
    }
    const on = motionEnabled();
    root.setAttribute('data-motion', on ? 'on' : 'off');

    const toggle = document.getElementById('motion-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(on));
      const label = on ? t('motionOn') : t('motionOff');
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
    }

    const notice = document.getElementById('motion-notice');
    if (notice) notice.hidden = on;

    if (on) queueScrollMotion();
    else resetScrollMotion();

    syncHeroCycle();
  }

  const heroItems = HERO_PICKS.map((f) => showcaseItems.find((i) => i.file === f)).filter(Boolean);
  if (heroItems.length === 0 && showcaseItems.length > 0) {
    heroItems.push(...showcaseItems.slice(0, 4));
  }

  let toastTimer = null;

  function t(key) {
    return I18N[state.lang][key] ?? I18N.zh[key] ?? key;
  }

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`));
  }

  function itemTitle(item) {
    if (!item) return '';
    return state.lang === 'en' ? item.titleEn || item.title : item.title;
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('copied'));
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(t('copied'));
    }
  }

  function triggerDevelop(frameEl) {
    if (!frameEl) return;
    frameEl.classList.remove('is-developing');
    void frameEl.offsetWidth;
    frameEl.classList.add('is-developing');
  }

  function setPrintImage(img, frame, src, alt) {
    if (!img) return;
    const run = () => triggerDevelop(frame);
    img.alt = alt;
    img.onload = run;
    if (img.getAttribute('src') !== src) img.src = src;
    if (img.complete && img.naturalWidth) run();
  }

  /* ── Hero 轮播与背景光晕 ─────────────────────────────────── */

  const HERO_CYCLE_MS = 7000;
  let heroTimer = null;

  function updateHeroAura(src) {
    const layers = [document.getElementById('hero-aura-a'), document.getElementById('hero-aura-b')];
    if (!layers[0] || !layers[1]) return;
    state.heroAura = (state.heroAura + 1) % 2;
    const on = layers[state.heroAura];
    const off = layers[1 - state.heroAura];
    if (on.dataset.src !== src) {
      on.dataset.src = src;
      on.style.backgroundImage = `url("${src}")`;
    }
    on.classList.add('is-active');
    off.classList.remove('is-active');
  }

  function stopHeroCycle() {
    clearTimeout(heroTimer);
    heroTimer = null;
    const bar = document.getElementById('hero-cycle-bar');
    if (bar) bar.classList.remove('is-running');
  }

  function startHeroCycle() {
    stopHeroCycle();
    if (!motionEnabled() || state.heroPaused || !state.heroVisible || document.hidden) return;
    if (heroItems.length < 2) return;

    const bar = document.getElementById('hero-cycle-bar');
    if (bar) {
      bar.style.animationDuration = `${HERO_CYCLE_MS}ms`;
      void bar.offsetWidth;
      bar.classList.add('is-running');
    }

    heroTimer = setTimeout(() => {
      if (!motionEnabled() || state.heroPaused || !state.heroVisible || document.hidden) return;
      state.heroIdx = (state.heroIdx + 1) % heroItems.length;
      renderHero(true);
      startHeroCycle();
    }, HERO_CYCLE_MS);
  }

  function syncHeroCycle() {
    stopHeroCycle();
    startHeroCycle();
  }

  /* ── 滚动驱动引擎（不依赖 animation-timeline，所有浏览器一致） ── */

  const scrollMotion = {
    queued: false,
    lite: false,
    heroPrint: null,
    heroCopy: null,
    roomPhoto: null,
    wall: null,
    wallSweep: null,
    sections: [],
  };

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function initScrollMotion() {
    scrollMotion.heroPrint = document.querySelector('.hero-print');
    scrollMotion.heroCopy = document.querySelector('.hero-copy');
    scrollMotion.roomPhoto = document.querySelector('.room-photo');
    scrollMotion.wall = document.querySelector('.wall');
    scrollMotion.wallSweep = document.querySelector('.wall-sweep');
    scrollMotion.sections = Array.from(document.querySelectorAll('main > section'));

    scrollMotion.lite =
      window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 780;

    window.addEventListener('scroll', queueScrollMotion, { passive: true });
    window.addEventListener(
      'resize',
      () => {
        scrollMotion.lite =
          window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 780;
        queueScrollMotion();
      },
      { passive: true }
    );
    queueScrollMotion();
  }

  function queueScrollMotion() {
    if (scrollMotion.queued) return;
    scrollMotion.queued = true;
    requestAnimationFrame(applyScrollMotion);
  }

  function setMotionVar(el, name, value) {
    if (!el) return;
    el.style.setProperty(name, value.toFixed(4));
  }

  function applyScrollMotion() {
    scrollMotion.queued = false;
    if (!motionEnabled()) return;

    const vh = window.innerHeight;
    const y = window.scrollY;
    const heroP = clamp01(y / (vh * 0.86));

    const scrollable = document.documentElement.scrollHeight - vh;
    root.style.setProperty(
      '--scroll-progress',
      (scrollable > 0 ? clamp01(y / scrollable) : 0).toFixed(4)
    );

    setMotionVar(scrollMotion.heroPrint, '--p', heroP);
    setMotionVar(scrollMotion.heroCopy, '--p', heroP);

    if (!scrollMotion.lite) {
      setMotionVar(scrollMotion.roomPhoto, '--p', clamp01(y / 2200));

      if (scrollMotion.wall && scrollMotion.wallSweep) {
        const rect = scrollMotion.wall.getBoundingClientRect();
        setMotionVar(
          scrollMotion.wallSweep,
          '--p',
          clamp01((vh - rect.top) / (vh + rect.height))
        );
      }
    }

    for (const section of scrollMotion.sections) {
      const rect = section.getBoundingClientRect();
      setMotionVar(section, '--rule-p', clamp01((vh - rect.top) / (vh * 0.55)));
    }
  }

  function resetScrollMotion() {
    root.style.removeProperty('--scroll-progress');
    [
      scrollMotion.heroPrint,
      scrollMotion.heroCopy,
      scrollMotion.roomPhoto,
      scrollMotion.wallSweep,
      ...scrollMotion.sections,
    ].forEach((el) => {
      if (!el) return;
      el.style.removeProperty('--p');
      el.style.removeProperty('--rule-p');
    });
  }

  function applyTheme(theme) {
    state.theme = theme;
    root.setAttribute('data-theme', theme);
    const meta = document.getElementById('theme-color');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0a0b' : '#efece5');
    try {
      localStorage.setItem('imagen-site-theme', theme);
    } catch {}
  }

  /* ── Hero ─────────────────────────────────────────────────── */

  function renderHero(replay = true) {
    const item = heroItems[state.heroIdx] || showcaseItems[0];
    if (!item) return;

    const img = document.getElementById('hero-print-img');
    const frame = document.getElementById('hero-print-btn');
    const modelEl = document.getElementById('hero-exp-model');
    const titleEl = document.getElementById('hero-exp-title');
    const numsEl = document.getElementById('hero-exp-nums');

    updateHeroAura(item.src);

    if (replay) {
      setPrintImage(img, frame, item.src, `${item.modelLabel} · ${itemTitle(item)}`);
    } else {
      if (img) {
        img.src = item.src;
        img.alt = `${item.modelLabel} · ${itemTitle(item)}`;
      }
    }
    if (modelEl) modelEl.textContent = item.modelLabel;
    if (titleEl) titleEl.textContent = itemTitle(item);
    if (numsEl) numsEl.textContent = `${item.width}×${item.height} · ${item.seconds}s · seed ${item.seed}`;

    const thumbsWrap = document.getElementById('hero-thumbs');
    if (thumbsWrap) {
      thumbsWrap.innerHTML = '';
      heroItems.forEach((pick, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `hero-thumb${idx === state.heroIdx ? ' is-active' : ''}`;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(idx === state.heroIdx));
        btn.setAttribute('aria-label', fill(t('heroThumbAria'), { title: itemTitle(pick) }));

        const thumbImg = document.createElement('img');
        thumbImg.src = pick.src;
        thumbImg.alt = '';
        thumbImg.loading = 'lazy';
        thumbImg.decoding = 'async';

        const meta = document.createElement('span');
        meta.className = 'hero-thumb-meta';
        const strong = document.createElement('strong');
        strong.textContent = pick.modelLabel;
        const sub = document.createElement('span');
        sub.className = 'tabular';
        sub.textContent = `${pick.seconds}s`;
        meta.append(strong, sub);

        btn.append(thumbImg, meta);
        btn.addEventListener('click', () => {
          state.heroIdx = idx;
          renderHero(true);
          startHeroCycle();
        });
        thumbsWrap.appendChild(btn);
      });
    }
  }

  /* ── 成片墙 ───────────────────────────────────────────────── */

  let wallDevelopObserver = null;
  let wallLayoutQueued = false;
  let lastWallWidth = 0;

  function wallColumnCount(width) {
    if (width <= 860) return 2;
    if (width <= 1180) return 3;
    return 4;
  }

  function layoutWall() {
    const wrap = document.getElementById('wall-items');
    if (!wrap) return;
    const items = wrap.querySelectorAll('.print');
    if (!items.length) return;
    const width = wrap.clientWidth;
    if (!width) return;

    const gap = parseFloat(getComputedStyle(wrap).columnGap) || 20;
    const cols = wallColumnCount(width);
    const colWidth = (width - gap * (cols - 1)) / cols;
    const heights = new Array(cols).fill(0);

    items.forEach((el) => {
      const w = Number(el.dataset.w) || 1;
      const h = Number(el.dataset.h) || 1;
      el.style.width = `${colWidth}px`;
      const meta = el.querySelector('.print-meta');
      const metaHeight = meta ? meta.getBoundingClientRect().height : 16;
      const target = (colWidth * h) / w + metaHeight + 10;

      let col = 0;
      for (let i = 1; i < cols; i += 1) {
        if (heights[i] < heights[col]) col = i;
      }
      el.style.left = `${col * (colWidth + gap)}px`;
      el.style.top = `${heights[col]}px`;
      heights[col] += target + gap;
    });

    wrap.style.height = `${Math.max(0, Math.max(...heights) - gap)}px`;
  }

  function queueWallLayout() {
    if (wallLayoutQueued) return;
    wallLayoutQueued = true;
    requestAnimationFrame(() => {
      wallLayoutQueued = false;
      layoutWall();
    });
  }

  function renderWall() {
    const wall = document.getElementById('wall-items');
    if (!wall) return;
    wall.innerHTML = '';

    if (wallDevelopObserver) wallDevelopObserver.disconnect();
    const canObserve = 'IntersectionObserver' in window;
    wallDevelopObserver = canObserve
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry, i) => {
              if (!entry.isIntersecting) return;
              const el = entry.target;
              el.style.setProperty('--enter-delay', `${Math.min(i * 70, 320)}ms`);
              el.classList.add('is-developed');
              wallDevelopObserver.unobserve(el);
            });
          },
          { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }
        )
      : null;

    showcaseItems.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'print';
      btn.dataset.file = item.file;
      btn.dataset.index = String(idx);
      btn.dataset.w = String(item.width);
      btn.dataset.h = String(item.height);
      btn.setAttribute('aria-label', fill(t('wallPrintAria'), { title: itemTitle(item) }));

      const wrap = document.createElement('span');
      wrap.className = 'print-img';

      const img = document.createElement('img');
      img.className = 'print-color';
      img.src = item.src;
      img.alt = `${item.modelLabel} · ${itemTitle(item)}`;
      img.width = item.width;
      img.height = item.height;
      img.loading = idx < 4 ? 'eager' : 'lazy';
      img.decoding = 'async';

      const mono = document.createElement('img');
      mono.className = 'print-mono';
      mono.src = item.src;
      mono.alt = '';
      mono.setAttribute('aria-hidden', 'true');
      mono.loading = idx < 4 ? 'eager' : 'lazy';
      mono.decoding = 'async';

      wrap.append(img, mono);

      const meta = document.createElement('span');
      meta.className = 'print-meta';
      const strong = document.createElement('strong');
      strong.textContent = item.modelLabel;
      const nums = document.createElement('span');
      nums.className = 'print-nums tabular';
      nums.textContent = `${item.seconds}s`;
      meta.append(strong, nums);

      btn.append(wrap, meta);
      btn.addEventListener('click', () => openLightboxByFile(item.file));
      wall.appendChild(btn);

      if (wallDevelopObserver) wallDevelopObserver.observe(btn);
      else btn.classList.add('is-developed');
    });

    updateWallCount();
    queueWallLayout();
  }

  function updateWallCount() {
    const countEl = document.getElementById('wall-count');
    if (!countEl) return;
    countEl.textContent = fill(t('wallCountTpl'), {
      frames: showcaseItems.length,
      models: models.length,
    });
  }

  /* ── 模型暗房 ─────────────────────────────────────────────── */

  function filteredModels() {
    if (state.filter === 'fast') {
      return models.filter((m) => (m.measured?.steadySeconds ?? 999) <= 11);
    }
    if (state.filter === 'usable') {
      return models.filter((m) => (m.measured?.steadySeconds ?? 0) > 11);
    }
    return models;
  }

  function speedPosition(seconds) {
    const lo = Math.log(1.6);
    const hi = Math.log(Math.max(90, maxSteady));
    const v = Math.log(Math.max(1.6, seconds || 1.6));
    return Math.max(0.015, Math.min(0.985, (v - lo) / (hi - lo)));
  }

  function renderModelList() {
    const listEl = document.getElementById('model-list');
    if (!listEl) return;
    const visible = filteredModels();
    if (!visible.some((m) => m.id === state.selectedModelId) && visible.length > 0) {
      state.selectedModelId = visible[0].id;
      state.selectedSampleFile = null;
    }

    listEl.innerHTML = '';
    visible.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = m.id === state.selectedModelId;
      btn.className = `model-item${active ? ' is-active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(active));
      btn.setAttribute('aria-label', fill(t('modelItemAria'), { model: m.label }));

      const top = document.createElement('div');
      top.className = 'model-item-top';

      const nameWrap = document.createElement('span');
      nameWrap.className = 'model-item-name';
      const nameStrong = document.createElement('strong');
      nameStrong.textContent = m.label;
      const fam = document.createElement('span');
      fam.className = 'model-family-tag';
      fam.textContent = m.family;
      nameWrap.append(nameStrong, fam);

      const sec = document.createElement('span');
      sec.className = 'model-sec tabular';
      sec.textContent = m.measured?.steadySeconds != null ? `~${m.measured.steadySeconds}s` : '—';
      top.append(nameWrap, sec);

      const desc = document.createElement('div');
      desc.className = 'model-item-desc';
      desc.textContent = m.description?.[state.lang] || m.description?.zh || '';

      const speed = document.createElement('div');
      speed.className = 'model-speed';
      speed.style.setProperty('--t', speedPosition(m.measured?.steadySeconds || maxSteady).toFixed(3));
      speed.appendChild(document.createElement('i'));

      btn.append(top, desc, speed);
      btn.addEventListener('click', () => {
        if (state.selectedModelId === m.id) return;
        state.selectedModelId = m.id;
        state.selectedSampleFile = null;
        renderModelList();
        renderLabStage(true);
      });
      listEl.appendChild(btn);
    });
  }

  function renderLabStage(replay = true) {
    const model = models.find((m) => m.id === state.selectedModelId) || models[0];
    if (!model) return;

    const modelSamples = showcaseItems.filter((i) => i.presetId === model.id);
    let sample = modelSamples.find((i) => i.file === state.selectedSampleFile) || modelSamples[0];
    if (!sample) sample = showcaseItems[0];
    if (sample) state.selectedSampleFile = sample.file;

    const frame = document.getElementById('lab-print-btn');
    const img = document.getElementById('lab-print-img');
    if (sample) {
      if (replay) {
        setPrintImage(img, frame, sample.src, `${model.label} · ${itemTitle(sample)}`);
      } else if (img) {
        img.src = sample.src;
        img.alt = `${model.label} · ${itemTitle(sample)}`;
      }
    }

    const strip = document.getElementById('lab-filmstrip');
    if (strip) {
      strip.innerHTML = '';
      if (modelSamples.length > 1) {
        modelSamples.forEach((s) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `film-thumb${s.file === sample.file ? ' is-active' : ''}`;
          b.title = itemTitle(s);
          b.setAttribute('aria-label', itemTitle(s));
          const tImg = document.createElement('img');
          tImg.src = s.src;
          tImg.alt = '';
          tImg.loading = 'lazy';
          tImg.decoding = 'async';
          b.appendChild(tImg);
          b.addEventListener('click', () => {
            state.selectedSampleFile = s.file;
            renderLabStage(true);
          });
          strip.appendChild(b);
        });
      }
    }

    const labels = I18N[state.lang].specLabels;
    const titleEl = document.getElementById('lab-sample-title');
    const famEl = document.getElementById('lab-family-badge');
    const licEl = document.getElementById('lab-license-badge');
    const descEl = document.getElementById('lab-model-desc');
    const ledgerEl = document.getElementById('lab-spec-ledger');
    const promptMetaEl = document.getElementById('lab-prompt-meta');
    const promptTextEl = document.getElementById('lab-prompt-text');

    if (titleEl) titleEl.textContent = sample ? itemTitle(sample) : model.label;
    if (famEl) famEl.textContent = `${model.family} · ${model.params}`;
    if (licEl) licEl.textContent = model.license;
    if (descEl) descEl.textContent = `${model.label} — ${model.description?.[state.lang] || ''}`;

    const cells = [
      [labels.steady, model.measured?.steadySeconds != null ? `~${model.measured.steadySeconds}s` : '—'],
      [labels.sampleSec, sample ? `${sample.seconds}s` : '—'],
      [labels.stepsCfg, `${model.steps} steps · CFG ${model.cfg}`],
      [labels.vram, model.measured?.peakVramMb ? `${(model.measured.peakVramMb / 1024).toFixed(1)} GB` : '—'],
      [labels.size, sample ? `${sample.width}×${sample.height}` : `${model.size}px`],
      [labels.seed, sample ? String(sample.seed) : '—'],
      [labels.img2img, model.supportsImg2Img ? labels.yes : labels.no],
      [labels.repo, model.repo.split(' + ')[0]],
    ];

    if (ledgerEl) {
      ledgerEl.innerHTML = '';
      cells.forEach(([k, v]) => {
        const div = document.createElement('div');
        div.className = 'spec-cell';
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        div.append(dt, dd);
        ledgerEl.appendChild(div);
      });
    }

    if (promptMetaEl) promptMetaEl.textContent = sample ? `${model.label} · ${model.promptStyle}` : '';
    if (promptTextEl) promptTextEl.textContent = sample ? sample.prompt : '';
  }

  /* ── 两种用法 ─────────────────────────────────────────────── */

  function renderWorkflow() {
    const wf = I18N[state.lang].wfData[state.wfMode];
    const subSwitch = document.getElementById('wf-sub-switch');
    const shotImg = document.getElementById('wf-shot-img');
    const winTitle = document.getElementById('wf-window-title');
    const sideTitle = document.getElementById('wf-side-title');
    const pointsEl = document.getElementById('wf-points');
    const noteEl = document.getElementById('wf-note');

    document.querySelectorAll('#workflow-tabs .seg-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.wf === state.wfMode);
    });

    if (subSwitch) {
      subSwitch.classList.toggle('is-hidden', state.wfMode !== 'studio');
      subSwitch.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('is-active', c.dataset.shot === state.wfStudioShot);
      });
    }

    if (shotImg) {
      const key = state.wfMode === 'studio' ? state.wfStudioShot : 'chat';
      shotImg.src = WORKFLOW_SHOTS[key];
      shotImg.alt = wf.title;
    }
    if (winTitle) winTitle.textContent = wf.windowTitle;
    if (sideTitle) sideTitle.textContent = wf.title;
    if (pointsEl) {
      pointsEl.innerHTML = '';
      wf.points.forEach((p) => {
        const li = document.createElement('li');
        li.textContent = p;
        pointsEl.appendChild(li);
      });
    }
    if (noteEl) noteEl.textContent = wf.note;
  }

  /* ── 灯箱 ─────────────────────────────────────────────────── */

  function setPageInert(on) {
    ['header.chrome', 'main', 'footer.footer'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function openLightboxByFile(file) {
    const idx = showcaseItems.findIndex((i) => i.file === file);
    if (idx < 0) return;
    state.lightboxReturnFocus = document.activeElement;
    state.lightboxIdx = idx;
    updateLightbox();
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    setPageInert(true);
    state.heroPaused = true;
    stopHeroCycle();
    const closeBtn = document.getElementById('lightbox-close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeLightbox() {
    const lb = document.getElementById('lightbox');
    if (lb) lb.hidden = true;
    state.lightboxIdx = -1;
    document.body.style.overflow = '';
    setPageInert(false);
    state.heroPaused = false;
    startHeroCycle();
    if (state.lightboxReturnFocus && state.lightboxReturnFocus.focus) {
      state.lightboxReturnFocus.focus({ preventScroll: true });
    }
    state.lightboxReturnFocus = null;
  }

  function updateLightbox() {
    const item = showcaseItems[state.lightboxIdx];
    if (!item) return;
    const img = document.getElementById('lightbox-img');
    const title = document.getElementById('lightbox-title');
    const info = document.getElementById('lightbox-info');
    if (img) {
      img.src = item.src;
      img.alt = `${item.modelLabel} · ${itemTitle(item)}`;
    }
    if (title) title.textContent = `${item.modelLabel} · ${itemTitle(item)}`;
    if (info) {
      info.textContent = `${item.width}×${item.height} · ${item.seconds}s · seed ${item.seed} (${state.lightboxIdx + 1}/${showcaseItems.length})`;
    }
    [state.lightboxIdx + 1, state.lightboxIdx - 1].forEach((i) => {
      const next = showcaseItems[(i + showcaseItems.length) % showcaseItems.length];
      if (next) {
        const pre = new Image();
        pre.src = next.src;
      }
    });
  }

  function stepLightbox(dir) {
    if (state.lightboxIdx < 0) return;
    state.lightboxIdx = (state.lightboxIdx + dir + showcaseItems.length) % showcaseItems.length;
    updateLightbox();
  }

  /* ── 环境光：安全灯与成片墙显色 ───────────────────────────── */

  function initAmbientLight() {
    if (!finePointer) return;
    const lamp = document.getElementById('lamp');
    let targetX = window.innerWidth * 0.68;
    let targetY = window.innerHeight * 0.28;
    let x = targetX;
    let y = targetY;
    let raf = 0;
    let hasPointer = false;

    const canBackdrop =
      CSS.supports && (CSS.supports('backdrop-filter', 'blur(2px)') || CSS.supports('-webkit-backdrop-filter', 'blur(2px)'));
    void canBackdrop;

    if (lamp) root.classList.add('has-lamp');

    function frame() {
      raf = 0;
      x += (targetX - x) * 0.14;
      y += (targetY - y) * 0.14;
      if (lamp) lamp.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

      if (Math.abs(targetX - x) > 0.4 || Math.abs(targetY - y) > 0.4) {
        raf = requestAnimationFrame(frame);
      }
    }

    function kick() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch') return;
        targetX = e.clientX;
        targetY = e.clientY;
        if (!hasPointer) {
          hasPointer = true;
          x = targetX;
          y = targetY;
        }
        kick();
      },
      { passive: true }
    );

    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick, { passive: true });
  }

  /* 悬停成片时，安全灯的光圈跟随指针，只在光圈里恢复颜色 */
  function initWallSafelight() {
    if (!finePointer) return;
    const items = document.getElementById('wall-items');
    if (!items) return;

    items.addEventListener(
      'pointermove',
      (e) => {
        if (!motionEnabled()) return;
        const btn = e.target && e.target.closest ? e.target.closest('.print') : null;
        if (!btn || !items.contains(btn)) return;
        const wrap = btn.querySelector('.print-img');
        const mono = btn.querySelector('.print-mono');
        if (!wrap || !mono) return;
        const rect = wrap.getBoundingClientRect();
        mono.style.setProperty('--lx', `${Math.round(e.clientX - rect.left)}px`);
        mono.style.setProperty('--ly', `${Math.round(e.clientY - rect.top)}px`);
      },
      { passive: true }
    );
  }

  /* ── 语言 / 主题 ──────────────────────────────────────────── */

  function applyLang(lang) {
    state.lang = lang;
    root.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.title = t('pageTitle');

    document.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });

    document.querySelectorAll('[data-t]').forEach((el) => {
      const key = el.dataset.t;
      const value = I18N[lang][key];
      if (typeof value === 'string') el.textContent = value;
    });

    document.querySelectorAll('[data-t-aria]').forEach((el) => {
      const key = el.dataset.tAria;
      const value = I18N[lang][key];
      if (typeof value === 'string') el.setAttribute('aria-label', value);
    });

    renderHero(false);
    renderModelList();
    renderLabStage(false);
    renderWorkflow();
    refreshWallLanguage();
    applyMotion(false);
  }

  function refreshWallLanguage() {
    const wall = document.getElementById('wall');
    if (!wall) return;
    wall.querySelectorAll('.print').forEach((btn) => {
      const idx = Number(btn.dataset.index);
      const item = showcaseItems[idx];
      if (!item) return;
      btn.setAttribute('aria-label', fill(t('wallPrintAria'), { title: itemTitle(item) }));
      const img = btn.querySelector('img');
      if (img) img.alt = `${item.modelLabel} · ${itemTitle(item)}`;
    });
    updateWallCount();
    queueWallLayout();
  }

  /* ── 事件绑定 ─────────────────────────────────────────────── */

  function bindEvents() {
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    document.getElementById('motion-toggle')?.addEventListener('click', () => {
      state.motionMode = motionEnabled() ? 'off' : 'on';
      applyMotion(true);
      if (motionEnabled()) triggerDevelop(document.getElementById('hero-print-btn'));
    });

    document.getElementById('motion-enable')?.addEventListener('click', () => {
      state.motionMode = 'on';
      applyMotion(true);
      triggerDevelop(document.getElementById('hero-print-btn'));
    });

    document.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', () => applyLang(btn.dataset.lang));
    });

    document.querySelectorAll('#model-filter .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        document.querySelectorAll('#model-filter .seg-btn').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        renderModelList();
        renderLabStage(true);
      });
    });

    document.getElementById('replay-develop-btn')?.addEventListener('click', () => {
      triggerDevelop(document.getElementById('lab-print-btn'));
    });

    document.getElementById('copy-prompt-btn')?.addEventListener('click', () => {
      const text = document.getElementById('lab-prompt-text')?.textContent || '';
      if (text) copyText(text);
    });

    document.querySelectorAll('#workflow-tabs .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.wfMode = btn.dataset.wf;
        renderWorkflow();
      });
    });

    document.querySelectorAll('#wf-sub-switch .chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.wfStudioShot = btn.dataset.shot;
        renderWorkflow();
      });
    });

    document.querySelectorAll('#install-tabs .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.instTab = btn.dataset.inst;
        document.querySelectorAll('#install-tabs .seg-btn').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        ['gui', 'cli', 'offline'].forEach((k) => {
          document.getElementById(`inst-pane-${k}`)?.classList.toggle('is-hidden', k !== state.instTab);
        });
      });
    });

    document.querySelectorAll('[data-profile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.cliProfile = btn.dataset.profile;
        document.querySelectorAll('[data-profile]').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        const cmd = `dsh plugin --profile ${state.cliProfile} add github:nanxfu/dsh-our-imagen`;
        const codeEl = document.getElementById('cli-install-cmd');
        const copyBtn = document.getElementById('cli-copy-btn');
        if (codeEl) codeEl.textContent = cmd;
        if (copyBtn) copyBtn.dataset.copy = cmd;
      });
    });

    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.copy;
        if (val) copyText(val);
      });
    });

    document.getElementById('hero-print-btn')?.addEventListener('click', () => {
      const item = heroItems[state.heroIdx] || showcaseItems[0];
      if (item) openLightboxByFile(item.file);
    });

    // Hero 轮播：悬停、键盘聚焦、离开视口、页面隐藏时暂停
    const heroEl = document.querySelector('.hero');
    const heroPrintEl = document.querySelector('.hero-print');
    if (heroPrintEl) {
      heroPrintEl.addEventListener('pointerenter', () => {
        state.heroPaused = true;
        stopHeroCycle();
      });
      heroPrintEl.addEventListener('pointerleave', () => {
        state.heroPaused = false;
        startHeroCycle();
      });
    }
    if (heroEl) {
      heroEl.addEventListener('focusin', () => {
        state.heroPaused = true;
        stopHeroCycle();
      });
      heroEl.addEventListener('focusout', (e) => {
        if (e.relatedTarget && heroEl.contains(e.relatedTarget)) return;
        state.heroPaused = false;
        startHeroCycle();
      });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(
          (entries) => {
            state.heroVisible = entries.some((entry) => entry.isIntersecting);
            syncHeroCycle();
          },
          { threshold: 0.15 }
        ).observe(heroEl);
      }
    }
    document.addEventListener('visibilitychange', syncHeroCycle);

    document.getElementById('lab-print-btn')?.addEventListener('click', () => {
      if (state.selectedSampleFile) openLightboxByFile(state.selectedSampleFile);
    });

    document.getElementById('lightbox-backdrop')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev')?.addEventListener('click', () => stepLightbox(-1));
    document.getElementById('lightbox-next')?.addEventListener('click', () => stepLightbox(1));

    document.addEventListener('keydown', (e) => {
      if (state.lightboxIdx < 0) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLightbox();
      }
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'Tab') {
        const dialog = document.querySelector('.lightbox-dialog');
        if (!dialog) return;
        const focusables = dialog.querySelectorAll('button:not([disabled]), a[href]');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // 顶栏滚动状态
    const chrome = document.getElementById('chrome');
    const onScroll = () => {
      if (chrome) chrome.classList.toggle('is-stuck', window.scrollY > 18);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // 成片墙：按真实列宽重新分配（不依赖多列排版，避免浏览器分栏抖动）
    const wallWrap = document.getElementById('wall-items');
    if (wallWrap) {
      lastWallWidth = wallWrap.clientWidth;
      if ('ResizeObserver' in window) {
        new ResizeObserver(() => {
          if (wallWrap.clientWidth === lastWallWidth) return;
          lastWallWidth = wallWrap.clientWidth;
          queueWallLayout();
        }).observe(wallWrap);
      }
      window.addEventListener('resize', queueWallLayout, { passive: true });
    }
  }

  /* ── 启动 ─────────────────────────────────────────────────── */

  function initPreferences() {
    const params = new URLSearchParams(window.location.search);
    const paramTheme = params.get('theme');
    const paramLang = params.get('lang');
    const paramMotion = params.get('motion');

    let savedTheme = null;
    let savedMotion = null;
    try {
      savedTheme = localStorage.getItem('imagen-site-theme');
      savedMotion = localStorage.getItem('imagen-site-motion');
    } catch {}

    applyTheme(paramTheme === 'dark' || paramTheme === 'light' ? paramTheme : savedTheme || 'dark');
    if (paramLang === 'en' || paramLang === 'zh') state.lang = paramLang;

    if (paramMotion === 'on' || paramMotion === '1') state.motionMode = 'on';
    else if (paramMotion === 'off' || paramMotion === '0') state.motionMode = 'off';
    else if (savedMotion === 'on' || savedMotion === 'off') state.motionMode = savedMotion;
  }

  initPreferences();
  applyLang(state.lang);
  renderWall();
  bindEvents();
  applyMotion(false);
  renderHero(true);
  startHeroCycle();
  initScrollMotion();
  initAmbientLight();
  initWallSafelight();
})();
