/**
 * 渲染测试共享 fixtures：固定时间线、模型预设、历史条目、场景表，以及跨文件复用的挂载 helper。
 *
 * 只放被两个以上测试文件共用、且与单个功能无关的数据与挂载入口；
 * 功能专用的 mount helper 仍留在各自的功能测试文件里。
 */

import { createTestClient } from './render.mjs'

export const NOW = Date.parse('2026-11-09T05:05:00.000Z')
export const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

export const preset = {
  id: 'sdxl-lightning',
  label: 'SDXL Lightning',
  family: 'SDXL',
  short: 'Lightning',
  description: { zh: '4 步极速出图，平衡画质与耗时', en: '4-step fast generation, balanced quality' },
  params: '3.5B + LoRA',
  license: 'OpenRAIL++',
  licenseKind: 'open',
  gpus: 1,
  downloadGb: 6.78,
  size: 1024,
  // 分辨率档位（长边）：Rail 的档位行消费这个数组。
  sizeOptions: [768, 1024, 1152],
  steps: 4,
  cfg: 0,
  steadySeconds: 6.2,
  tier: 'fast',
  promptStyle: 'concise',
  negativeHint: 'blurry, low quality, deformed, extra limbs',
  // 模型管线是否真的消费 negative_prompt：客户端据此决定排除项是否展示与提交。
  supportsNegative: true,
}
export const turbo = { ...preset, id: 'sdxl-turbo', label: 'SDXL Turbo', short: 'Turbo', description: { zh: '实时低延迟，适合构图灵感与草稿速探', en: 'Real-time low latency, ideal for drafting' }, license: '非商用研究许可', licenseKind: 'restricted', tier: 'usable' }
// 写实模型：推荐 CFG 5 > 0 且带 negativeHint，默认配置下负向词就可用的样本。
export const realvis = {
  ...preset,
  id: 'realvis-v5',
  label: 'RealVisXL V5.0',
  short: 'RealVis V5',
  description: { zh: '写实人像与摄影质感首选', en: 'Photorealistic portraits and photography' },
  cfg: 5,
  steps: 8,
  tier: 'quality',
}

export const image = (seed) => ({
  path: `imagen-output/job-1/${seed}.png`,
  file: `${seed}.png`,
  url: `/imagen-api/file?path=imagen-output%2Fjob-1%2F${seed}.png`,
  seed,
  seconds: 6.2,
  width: 1024,
  height: 1024,
})

// 与真实 Host 的 /imagen-api/history 形状一致：没有 params 字段。
// 舞台提示词与「带回参数」必须只靠 item.prompt / image 像素工作。
export const historyItem = {
  jobId: 'job-1',
  dir: 'imagen-output/20261109-120000-job-1',
  prompt: '测试用的荷花池塘',
  presetId: 'sdxl-lightning',
  finishedAt: at(-120),
  images: [image(7), image(8)],
}

export const probeOk = { cli: { present: true }, auth: { ok: true }, quota: { available: true, usedHours: 3, totalHours: 30 }, notes: [] }

/**
 * 工作台的三个基础应答：/state、/history、/library（默认无收藏、无删除）。
 * extra 用来补单个用例自己的路由（如 /imagen-api/generate）。
 */
export const studioResponses = (state, history = { items: [] }, extra = {}) => ({
  '/imagen-api/state': state,
  '/imagen-api/history': history,
  '/imagen-api/library': { favorites: [], deleted: [] },
  ...extra,
})

export const readyState = {
  defaultPreset: 'sdxl-lightning',
  presets: [preset, turbo],
  session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
  jobs: [],
  lastJob: null,
  probe: probeOk,
}

/**
 * 每个场景的结构断言：
 *   required —— 类名锚点：数字表示精确次数，`'1+'` 表示至少出现一次；
 *   forbidden —— 类名必须完全不出现（用来区分场景：对话态没有表单面板、画廊没有舞台等）。
 * 计数基于组件实际渲染出的 className（全文按空白拆分）。
 */
export const scenarios = {
  ready: {
    state: readyState,
    history: { items: [historyItem] },
    props: { workspaceMode: 'work' },
    expect: ['创作设置', '提示词', '1024 × 1024', '画面设置', '高级设置', '立即生成', '带回参数', '云端就绪', '灵感示例', '测试用的荷花池塘'],
    reject: ['风格预设', '分辨率档位'],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-main': 1,
        'ofs-panel': 1,
        'ofs-panel--form': 1,
        // 无参考图时三个分区：提示词 / 画面设置 / 高级设置（数量交给表单自己的用例守）。
        'ofs-fieldset': '1+',
        'ofs-fieldset-head': '1+',
        'ofs-panel-scroll': 1,
        'ofs-panel-foot': 1,
        'ofs-qty': 1,
        'ofs-qty-option': '1+',
        'ofs-generate': 1,
        'ofs-spec-summary': 1,
        'ofs-batch': '1+',
        'ofs-thumb': '1+',
        'ofs-image': 1,
        'ofs-dock': 1,
        // 就绪且没有任务：流水线只保留收起的外壳，不渲染节点。
        'ofs-pipeline': 1,
      },
      forbidden: [
        'ofs-guidance',
        'ofs-panel--chat',
        'ofs-gallery',
        'ofs-figure--empty',
        'ofs-toast',
        'ofs-stage-progress',
        'ofs-sessionbar',
        'ofs-pl-node',
        'ofs-row-textarea',
        'ofs-size-custom',
        'ofs-mask-editor',
      ],
    },
  },
  // 负向词可用：写实模型默认 CFG 5 > 0 且带推荐负向词，高级设置里应出现「排除项」行；
  // 行默认折叠，所以只有标题没有文本域。
  negativeOn: {
    state: {
      defaultPreset: 'realvis-v5',
      presets: [realvis],
      session: { state: 'ready', modelId: 'realvis-v5', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
      jobs: [],
      lastJob: null,
      probe: probeOk,
    },
    history: { items: [] },
    props: {},
    expect: ['排除项', '高级设置'],
    reject: [],
    structure: {
      required: {
        'ofs-panel--form': 1,
        // 排除项行 + 参数行；两行都可折叠。
        'ofs-row': 2,
        'ofs-row-toggle': 2,
      },
      forbidden: ['ofs-row-textarea'],
    },
  },
  chat: {
    state: readyState,
    history: { items: [historyItem] },
    props: { panelMode: 'chat', workspaceMode: 'work' },
    expect: ['创作助手', '描述你想要的画面', '新建对话'],
    reject: [],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-panel': 1,
        'ofs-panel--chat': 1,
        'ofs-thread': 1,
        'ofs-chat-empty': 1,
        'ofs-chat-composer': 1,
        'ofs-chat-dock': 1,
        'ofs-chat-example': '1+',
        'ofs-stage': 1,
        'ofs-image': 1,
        'ofs-batch': '1+',
      },
      forbidden: ['ofs-panel--form', 'ofs-fieldset', 'ofs-gallery', 'ofs-guidance', 'ofs-figure--empty', 'ofs-toast'],
    },
  },
  empty: {
    state: { defaultPreset: 'sdxl-lightning', presets: [preset], session: { state: 'absent', error: null }, jobs: [] },
    history: { items: [] },
    props: {},
    expect: ['画面预览', '云端尚未启动'],
    reject: [],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-main': 1,
        'ofs-panel--form': 1,
        // 提示词 / 画面设置 / 高级设置：无参考图时三个分区。
        'ofs-fieldset': '1+',
        'ofs-fieldset-head': '1+',
        'ofs-panel-foot': 1,
        'ofs-qty-option': '1+',
        'ofs-generate': 1,
        'ofs-spec-summary': 1,
        'ofs-stage': 1,
        'ofs-figure--empty': 1,
        'ofs-empty-card': 1,
        'ofs-empty-title': 1,
        'ofs-examples': 1,
        'ofs-example': '1+',
        'ofs-filmstrip': 1,
        'ofs-filmstrip-empty': 1,
        // 分页 slot 数是被测行为（一页三格），保留精确计数。
        'ofs-slot': 3,
        'ofs-link': 1,
      },
      forbidden: ['ofs-image', 'ofs-batch', 'ofs-panel--chat', 'ofs-guidance', 'ofs-gallery', 'ofs-stage-progress', 'ofs-row-textarea'],
    },
  },
  gallery: {
    state: readyState,
    history: { items: [historyItem] },
    props: {},
    view: 'gallery',
    expect: ['作品画廊', '全部模型', '测试用的荷花池塘', '今天', '已加载全部作品', '以此图重绘'],
    reject: [],
    structure: {
      required: {
        'ofs-gallery': 1,
        'ofs-gallery-group': 1,
        'ofs-gallery-card': 1,
        // 悬停动作条有五个按钮：精确数量由「画廊悬停动作」用例断言。
        'ofs-gallery-action': '1+',
        // 画廊列由 JS 分桶（行优先）：1280px 视口下 4 列，卡片直接收藏的星标每张一个。
        'ofs-gallery-col': 4,
        'ofs-gallery-star': 1,
        // 分页脚：没有更多记录时给「已加载全部作品」一行提示。
        'ofs-gallery-foot': 1,
        'ofs-gallery-all-loaded': 1,
      },
      // 画廊是独立视图：不应带整页外壳、舞台、单轨面板或胶片条。
      forbidden: ['ofs-root', 'ofs-topbar', 'ofs-stage', 'ofs-panel', 'ofs-filmstrip', 'ofs-guidance', 'ofs-toast', 'ofs-gallery-more'],
    },
  },
  guidance: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'ready', modelId: 'sdxl-lightning', error: null },
      jobs: [
        {
          id: 'job-oom',
          status: 'failed',
          startedAt: at(-30),
          finishedAt: at(-20),
          params: { prompt: '过大的画面' },
          error: { code: 'oom', message: 'CUDA out of memory' },
          output: { images: [] },
        },
      ],
    },
    history: { items: [] },
    props: {},
    expect: ['显存不足', '重置为 1024×1024'],
    reject: [],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-toast-stack': 1,
        'ofs-toast--notice': 1,
        'ofs-toast-title': 1,
        'ofs-toast-detail': 1,
        'ofs-toast-actions': 1,
        'ofs-stage': 1,
        'ofs-figure--empty': 1,
        'ofs-panel--form': 1,
      },
      forbidden: ['ofs-guidance', 'ofs-guidance-command', 'ofs-panel--chat', 'ofs-gallery', 'ofs-image'],
    },
  },
  queued: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'provisioning', phase: 'queue', startedAt: at(-120), error: null },
      jobs: [{ id: 'job-x', status: 'waiting-session', startedAt: at(-60), params: { prompt: '排队中的画面' } }],
      lastJob: null,
    },
    history: { items: [historyItem] },
    props: { workspaceMode: 'work' },
    // 顶部流水线展示五节点，排队节点是当前节点；已等待从这次会话开始时刻算。
    expect: [
      '正在排队等 GPU',
      '推送内核',
      'Kaggle 排队',
      '建立隧道',
      '准备模型',
      '生成',
      '已等待',
      '2:00',
    ],
    reject: ['正在装载模型', '云端正在排队'],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-stage': 1,
        'ofs-pipeline': 1,
        'ofs-pl-rail': 1,
        'ofs-pl-node': 5,
        'ofs-pl-link': 4,
        'ofs-pl-label': 5,
        'ofs-pl-time': 1,
        // 舞台胶囊只保留扫光与分张计数：这里没有计数，标签为空。
        'ofs-stage-progress': 1,
        'ofs-progress-label': 1,
        'ofs-ghost': 1,
        'ofs-ghost-label': 1,
        'ofs-ghost-time': 1,
        'ofs-batch': '1+',
        'ofs-image': 1,
      },
      forbidden: ['ofs-guidance', 'ofs-figure--empty', 'ofs-toast', 'ofs-sessionbar'],
    },
  },
  // 排队慢档（约 3 分钟）：排队节点转琥珀并标「比平时久」，不弹卡片、不影响工作区。
  queueSlow: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: {
        state: 'provisioning',
        phase: 'queue',
        startedAt: at(-200),
        presetId: 'sdxl-lightning',
        error: null,
      },
      jobs: [{ id: 'job-slow', status: 'waiting-session', startedAt: at(-190), params: { prompt: '排队变慢的画面' } }],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: ['正在排队等 GPU', '比平时久', '推送内核', '已等待', '3:20'],
    reject: ['排队超过 10 分钟', '换新实例重排'],
    structure: {
      required: {
        'ofs-pipeline': 1,
        'ofs-pl-node': 5,
        // 慢档只给排队节点加一个「比平时久」的文字标记，不垫色底。
        'ofs-pl-tag': 1,
      },
      forbidden: ['ofs-queue-notice', 'ofs-guidance', 'ofs-toast', 'ofs-sessionbar'],
    },
  },
  // 排队卡住档（约 10 分钟，旧快照没有 queuePolicy）：顶部横幅给「换新实例重排」+「继续等待」。
  queueStalled: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: {
        state: 'provisioning',
        phase: 'queue',
        startedAt: at(-660),
        presetId: 'sdxl-lightning',
        error: null,
      },
      jobs: [],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: [
      '排队超过 10 分钟还没拿到 GPU',
      '多数会话推送后几十秒内就能启动',
      '可能是这条排队卡住了',
      '换新实例重排',
      '继续等待',
    ],
    reject: ['该 Kernel 可能仍在 Kaggle 队列中', '继续等待当前队列', '强制新建实例'],
    structure: {
      required: { 'ofs-queue-notice': 1, 'ofs-guidance-title': 1, 'ofs-guidance-note': 1, 'ofs-guidance-actions': 1, },
      forbidden: ['ofs-toast--notice', 'ofs-stage-progress'],
    },
  },
  queueTwo: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', error: null },
      // 同一时刻两个待执行任务：宿主的 jobs 最新在前，排队中的第二个排在列表首位。
      // 胶片条必须给每个任务一张卡，进度也必须是正在生成的那一张，而不是排队的那张。
      jobs: [
        { id: 'job-second', status: 'queued', createdAt: at(-5), startedAt: null, params: { prompt: '排队中的第二张' } },
        { id: 'job-first', status: 'running', createdAt: at(-30), startedAt: at(-8), params: { prompt: '正在出的第一张' } },
      ],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    // 云端已就绪：前四节点折叠成「云端已就绪」，右侧报后续排队数。
    expect: ['正在生成…', '排队等待出图…', '8.0秒', '5.0秒', '云端已就绪', '另有 1 个排队', '0:30'],
    reject: ['等待云端就绪…'],
    structure: {
      required: {
        'ofs-ghost': 2,
        'ofs-ghost-bar': 1,
        'ofs-ghost-slot': 1,
        'ofs-ghost-label': 2,
        'ofs-ghost-time': 2,
        'ofs-stage-progress': 1,
        // 折叠态：只剩「云端已就绪 → 生成」两个锚点，连接线不拉满整行。
        'ofs-pipeline': 1,
        'ofs-pl-rail': 1,
        'is-folded': 1,
        'ofs-pl-node': 2,
        'ofs-pl-queue': 1,
      },
      forbidden: ['ofs-filmstrip-empty', 'ofs-batch', 'ofs-guidance'],
    },
  },
  // 宿主新下发的 stageCode + progress：生成节点与舞台胶囊共用「第 k/总数 张」口径，
  // 而不是笼统的「正在生成…」，也不能把宿主硬编码的中文 stage 直接搬上界面。
  progress: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', error: null },
      jobs: [
        {
          id: 'job-progress',
          status: 'running',
          stageCode: 'running',
          progress: { done: 1, total: 4 },
          createdAt: at(-30),
          startedAt: at(-8),
          params: { prompt: '正在出四张里的第二张' },
        },
      ],
      lastJob: null,
    },
    history: { items: [historyItem] },
    props: { workspaceMode: 'work' },
    expect: ['正在生成第 2/4 张', '第 2/4 张', '云端已就绪', '已等待'],
    reject: ['生成中 2/4'],
    structure: {
      required: { 'ofs-stage-progress': 1, 'ofs-progress-label': 1, 'ofs-ghost': 1, 'ofs-pipeline': 1, 'ofs-pl-node': 2, 'ofs-pl-sub': 1, 'ofs-image': 1, },
      forbidden: ['ofs-guidance', 'ofs-figure--empty', 'ofs-toast'],
    },
  },
  warming: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      // 用户反馈的场景：连接阶段不再冒充「正在装载模型」；重连沿用旧 startedAt，不显示已等待。
      session: { state: 'warming', phase: 'warm', startedAt: at(-3600), device: 'Tesla T4', error: null },
      jobs: [{ id: 'job-w', status: 'waiting-session', startedAt: at(-200), params: { prompt: '等着出图' } }],
      lastJob: null,
    },
    history: { items: [historyItem] },
    props: {},
    expect: ['正在准备模型', '准备模型'],
    reject: ['正在装载模型', '正在申请 GPU', '已等待'],
    structure: {
      required: { 'ofs-pipeline': 1, 'ofs-pl-node': 5, 'ofs-pl-label': 5, 'ofs-stage-progress': 1, 'ofs-ghost': 1, },
      // 重连沿用旧的会话开始时间：流水线不显示计时，也不该退回旧状态条。
      forbidden: ['ofs-sessionbar', 'ofs-guidance', 'ofs-figure--empty', 'ofs-pl-time'],
    },
  },
  stopped: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      // 用户手动关机：不能再承诺「直接生成会自动启动」，空态也不许说「点击生成即可出图」。
      session: { state: 'absent', stoppedByUser: true, error: null },
      jobs: [],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: ['云端已关闭', '云端已关闭，先点「唤醒」再生成'],
    reject: ['云端未启动', '云端尚未启动', '点击生成即可开始出图'],
    structure: {
      required: { 'ofs-topbar': 1, 'ofs-filmstrip': 1, 'ofs-figure--empty': 1, 'ofs-pipeline': 1 },
      forbidden: ['ofs-sessionbar', 'ofs-guidance', 'ofs-pl-node'],
    },
  },
  cli: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: {
        state: 'error',
        phase: null,
        error: { code: 'cli_missing', message: '未找到 kaggle CLI，请先安装：pip install -U kaggle' },
      },
      jobs: [],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: ['本地没有检测到 Kaggle 命令行', 'pip install -U kaggle', '复制安装命令', '重新检查环境', '关闭', 'Windows 用户安装后若仍提示找不到命令'],
    reject: ['生成没有成功'],
    structure: {
      required: { 'ofs-root': 1, 'ofs-app': 1, 'ofs-guidance': 1, 'ofs-guidance-title': 1, 'ofs-guidance-command': 1, 'ofs-guidance-detail': 1, 'ofs-guidance-actions': 1, 'ofs-figure--empty': 1, },
      forbidden: ['ofs-panel--chat', 'ofs-image', 'ofs-toast', 'ofs-gallery'],
    },
  },
  session: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'error', error: { code: 'push_failed', message: 'Kernel 推送失败：权限不足' } },
      jobs: [],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: ['云端会话没有就绪', '唤醒云端', 'Kernel 推送失败：权限不足'],
    reject: [],
    structure: {
      required: { 'ofs-root': 1, 'ofs-app': 1, 'ofs-guidance': 1, 'ofs-guidance-title': 1, 'ofs-guidance-detail': 1, 'ofs-guidance-actions': 1, 'ofs-figure--empty': 1, },
      forbidden: ['ofs-guidance-command', 'ofs-panel--chat', 'ofs-image', 'ofs-toast'],
    },
  },
  generic: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'ready', modelId: 'sdxl-lightning', error: null },
      jobs: [
        {
          id: 'job-del',
          status: 'failed',
          startedAt: at(-30),
          finishedAt: at(-20),
          params: { prompt: '任意' },
          error: { code: 'delete_failed', message: '有图片没能删除' },
        },
      ],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: ['操作没有完成', '有图片没能删除', '关闭'],
    reject: ['重试一次', '生成没有成功'],
    structure: {
      required: { 'ofs-root': 1, 'ofs-app': 1, 'ofs-toast-stack': 1, 'ofs-toast--notice': 1, 'ofs-toast-title': 1, 'ofs-toast-detail': 1, 'ofs-toast-actions': 1, 'ofs-figure--empty': 1, },
      forbidden: ['ofs-guidance', 'ofs-guidance-command', 'ofs-panel--chat', 'ofs-image'],
    },
  },
  // 回归：宿主 /state 请求在网络层直接失败时，界面曾经把浏览器原文
  // "Failed to fetch" 原样塞进「操作没有完成」卡片；现在必须是可读文案 + 重试动作。
  network: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'ready', modelId: 'sdxl-lightning', error: null },
      jobs: [],
      lastJob: null,
    },
    // state 请求直接抛 TypeError，等价于浏览器里的 "Failed to fetch"。
    failures: { '/imagen-api/state': 'Failed to fetch' },
    history: { items: [] },
    props: {},
    expect: ['连不上本地服务', '本地服务暂无响应，请稍后重试。', '重试', '关闭'],
    reject: ['操作没有完成', 'Failed to fetch'],
    structure: {
      required: { 'ofs-root': 1, 'ofs-app': 1, 'ofs-guidance': 1, 'ofs-guidance-title': 1, 'ofs-guidance-detail': 1, 'ofs-guidance-actions': 1, },
      forbidden: ['ofs-guidance-command', 'ofs-image', 'ofs-toast'],
    },
  },
  generate: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: { state: 'ready', modelId: 'sdxl-lightning', error: null },
      jobs: [
        {
          id: 'job-gen',
          status: 'failed',
          startedAt: at(-30),
          finishedAt: at(-20),
          params: { prompt: '失败的画面', width: 1024, height: 1024, steps: 4, cfg: 0, count: 1 },
          error: { code: 'generation_failed', message: '远端返回了非 JSON 响应' },
        },
      ],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: ['生成没有成功', '重试一次', '远端返回了非 JSON 响应'],
    reject: [],
    structure: {
      required: { 'ofs-root': 1, 'ofs-app': 1, 'ofs-toast-stack': 1, 'ofs-toast--notice': 1, 'ofs-toast-title': 1, 'ofs-toast-detail': 1, 'ofs-toast-actions': 1, 'ofs-figure--empty': 1, },
      forbidden: ['ofs-guidance', 'ofs-guidance-command', 'ofs-panel--chat', 'ofs-image'],
    },
  },
  // 远端容器没拿到 GPU：新卡片给「打开 Kaggle 账户设置 + 唤醒」和两条次级动作，
  // 不能落进「生成没有成功 → 重试一次」那类（重试只会再消耗一次排队）。
  gpu: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: {
        state: 'error',
        error: { code: 'gpu_unavailable', message: '未检测到可用 GPU（当前为 CPU 容器）' },
      },
      jobs: [],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: [
      '云端没有拿到 GPU',
      '打开 Kaggle 账户设置',
      '唤醒云端',
      '手机号验证',
      '未检测到可用 GPU（当前为 CPU 容器）',
      '查看日志',
      '复制诊断信息',
    ],
    reject: ['生成没有成功', '重试一次'],
    structure: {
      required: { 'ofs-root': 1, 'ofs-guidance': 1, 'ofs-guidance-title': 1, 'ofs-guidance-detail': 1, 'ofs-guidance-note': 1, 'ofs-guidance-actions': 1, },
      forbidden: ['ofs-guidance-command', 'ofs-panel--chat', 'ofs-image'],
    },
  },
  // 凭据缺失：卡片要给 Windows 凭据文件位置，并把「打开 Kaggle 设置」保持为 API Token 页。
  auth: {
    state: {
      defaultPreset: 'sdxl-lightning',
      presets: [preset],
      session: {
        state: 'error',
        error: { code: 'auth_required', message: '未找到 kaggle 凭据文件' },
      },
      jobs: [],
      lastJob: null,
    },
    history: { items: [] },
    props: {},
    expect: [
      'Kaggle 账号缺少手机号绑定或凭据不可用',
      'kaggle auth login',
      '%USERPROFILE%\\.kaggle\\credentials.json',
      'refresh_token',
      '%USERPROFILE%\\.kaggle\\access_token',
      '%USERPROFILE%\\.kaggle\\kaggle.json',
      '打开 Kaggle 设置',
      '复制登录命令',
      '重新检查环境',
    ],
    reject: ['生成没有成功'],
    structure: {
      required: { 'ofs-guidance': 1, 'ofs-guidance-command': 1, 'ofs-guidance-note': 1, 'ofs-guidance-actions': 1, },
      forbidden: ['ofs-image'],
    },
  },
}

/** 设置接口的脱敏视图：字段形状按宿主约定固定。 */
export const settingsView = {
  idleTimeoutSec: 1800,
  accelerator: 'NvidiaTeslaT4',
  datasetSources: ['owner/dataset'],
  localModels: { 'org/repo': '/kaggle/input/repo' },
  pipConstraints: ['diffusers==0.31.0'],
  hasHfToken: true,
  hfTokenSource: 'config',
  effectiveOnNextSession: true,
}

/**
 * 挂载设置抽屉并拦截设置接口：记录 GET/POST 的 method 与 body，POST 用 savedView 回应。
 * 用来断言「UI 改了什么 → 实际提交什么」，不依赖真实网络。
 */
export async function mountSettingsDrawer(props = {}, options = {}) {
  const view = options.view ?? settingsView
  const client = await createTestClient({ now: NOW, responses: options.responses ?? {}, testBuild: true })
  const passthrough = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET'
    const path = new URL(String(url)).pathname
    const body = init && init.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), path, method, body })
    if (path === '/imagen-api/settings' && method === 'GET' && !options.failGet) {
      return { ok: true, status: 200, json: async () => ({ ok: true, settings: view }) }
    }
    if (path === '/imagen-api/settings' && method === 'POST' && !options.failPost) {
      const saved = options.savedView ?? view
      return { ok: true, status: 200, json: async () => ({ ok: true, settings: saved }) }
    }
    return passthrough(url, init)
  }
  const t = client.internals.i18n.fallbackTranslate(options.locale ?? 'zh')
  const toasts = []
  const closed = []
  let tree = null
  try {
    tree = await client.mountRaw(client.components.SettingsDrawer, {
      t,
      ui: { showToast: (text) => toasts.push(text) },
      onClose: () => closed.push(true),
      ...props,
    })
    return { client, tree, calls, toasts, closed, t }
  } catch (error) {
    client.unmount()
    throw error
  }
}

export const idleShutdownSession = {
  state: 'ready',
  modelId: 'sdxl-lightning',
  device: 'Tesla T4',
  idleSeconds: 600,
  idleTimeoutSec: 1800,
  error: null,
}

/** 只挂载 TopBar（算力弹层展开），返回渲染树与 openSettings 调用记录。 */
export async function mountTopBarExpanded(session, computeOverrides = {}) {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const opened = []
  const tree = await client.mountRaw(client.components.TopBar, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: {
      view: 'studio',
      setView: () => {},
      openLogs: () => {},
      openSettings: (trigger) => opened.push(trigger),
    },
    compute: {
      sessionState: 'ready',
      session,
      quota: null,
      presets: [preset],
      busy: '',
      probing: false,
      probe: null,
      probeReport: null,
      startSession: () => {},
      stopSession: () => {},
      runProbe: () => {},
      openFolder: () => {},
      ...computeOverrides,
    },
    form: {
      form: { presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0 },
      patchForm: () => {},
    },
    library: { loadHistory: () => {} },
    defaultOpen: true,
  })
  return { client, tree, opened }
}

// 支持垫图 / 局部重绘的普通预设；专用局部重绘权重（inpaintOnly）只在图片工具里可选。
export const toolPreset = { ...preset, supportsImg2Img: true, supportsInpaint: true }

export const LOGIN_PATH = '/imagen-api/kaggle/login'
