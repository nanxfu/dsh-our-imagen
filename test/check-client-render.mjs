/**
 * 客户端渲染与产物形状测试（不需要浏览器）。
 *
 * 1. 发布产物 client.js 必须是合法 bundle：导出 inject / apply，且不含测试出口；
 * 2. apply() 注册三个挂载点，且 main.key 与 sidebar.panellist.id 一致；
 * 3. 用假 React 挂载工作台，逐场景断言关键结构类名、关键文案与禁止出现的元素；
 * 4. 面板两种形态（表单 / 对话）都要能渲染，画廊视图不渲染舞台；
 * 5. 测试内探针校验假 React 自身的 hook 语义（useReducer/useMemo/memo/未实现 hook 报错），
 *    探针只存在于本测试文件，不进 src/。
 *
 * 运行：node test/check-client-render.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundle } from '../build.mjs'
import { loadClient, serializeTree, TEST_ARTIFACT } from './load-client.mjs'
import { KAGGLE_LOGIN, LIMITS } from '../shared/contract.js'
import { MASK_BRUSH } from '../src/logic/mask.js'
// 资源层直接 import 源码：渲染测试已经覆盖 UI，这里补「客户端请求形状」的离线断言。
import {
  cancelJob as cancelJobRequest,
  cancelKaggleLogin,
  enhancePromptRequest,
  fetchHistory,
  fetchKaggleLogin,
  fetchSettings as fetchSettingsRequest,
  fetchUiState as fetchUiStateRequest,
  kaggleLoginAction,
  saveSettings as saveSettingsRequest,
  saveUiState as saveUiStateRequest,
  startKaggleLogin,
  startSession as startSessionRequest,
  submitKaggleLoginCode,
} from '../src/api/resources.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PROD_ARTIFACT = join(ROOT, 'client.js')

const NOW = Date.parse('2026-11-09T05:05:00.000Z')
const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

const preset = {
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
const turbo = { ...preset, id: 'sdxl-turbo', label: 'SDXL Turbo', short: 'Turbo', description: { zh: '实时低延迟，适合构图灵感与草稿速探', en: 'Real-time low latency, ideal for drafting' }, license: '非商用研究许可', licenseKind: 'restricted', tier: 'usable' }
// 写实模型：推荐 CFG 5 > 0 且带 negativeHint，默认配置下负向词就可用的样本。
const realvis = {
  ...preset,
  id: 'realvis-v5',
  label: 'RealVisXL V5.0',
  short: 'RealVis V5',
  description: { zh: '写实人像与摄影质感首选', en: 'Photorealistic portraits and photography' },
  cfg: 5,
  steps: 8,
  tier: 'quality',
}

const image = (seed) => ({
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
const historyItem = {
  jobId: 'job-1',
  dir: 'imagen-output/20261109-120000-job-1',
  prompt: '测试用的荷花池塘',
  presetId: 'sdxl-lightning',
  finishedAt: at(-120),
  images: [image(7), image(8)],
}

const probeOk = { cli: { present: true }, auth: { ok: true }, quota: { available: true, usedHours: 3, totalHours: 30 }, notes: [] }

const readyState = {
  defaultPreset: 'sdxl-lightning',
  presets: [preset, turbo],
  session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
  jobs: [],
  lastJob: null,
  probe: probeOk,
}

/**
 * 每个场景的结构断言：
 *   required —— 类名必须出现的精确次数（结构锚点）；
 *   forbidden —— 类名必须完全不出现（用来区分场景：对话态没有表单面板、画廊没有舞台等）。
 * 计数基于组件实际渲染出的 className（全文按空白拆分）。
 */
const scenarios = {
  ready: {
    state: readyState,
    history: { items: [historyItem] },
    props: {},
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
        // 无参考图时三个分区：提示词 / 画面设置 / 高级设置。
        'ofs-fieldset': 3,
        'ofs-fieldset-head': 3,
        'ofs-panel-scroll': 1,
        'ofs-panel-foot': 1,
        'ofs-qty': 1,
        'ofs-qty-option': 4,
        'ofs-generate': 1,
        'ofs-spec-summary': 1,
        'ofs-batch': 1,
        'ofs-thumb': 2,
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
        'ofs-queue-pill',
        'ofs-sessionbar',
        'ofs-pl-node',
        // 0.10.0 删掉的风格试印条，以及默认配置（CFG=0）下不应出现的负向词行 / 参考图跟随。
        'ofs-tile',
        'ofs-row-textarea',
        'ofs-follow-reference',
        'ofs-size-custom',
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
      forbidden: ['ofs-row-textarea', 'ofs-tile'],
    },
  },
  chat: {
    state: readyState,
    history: { items: [historyItem] },
    props: { panelMode: 'chat' },
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
        'ofs-chat-example': 5,
        'ofs-stage': 1,
        'ofs-image': 1,
        'ofs-batch': 1,
      },
      forbidden: ['ofs-panel--form', 'ofs-fieldset', 'ofs-tile', 'ofs-gallery', 'ofs-guidance', 'ofs-figure--empty', 'ofs-toast'],
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
        'ofs-fieldset': 3,
        'ofs-fieldset-head': 3,
        'ofs-panel-foot': 1,
        'ofs-qty-option': 4,
        'ofs-generate': 1,
        'ofs-spec-summary': 1,
        'ofs-stage': 1,
        'ofs-figure--empty': 1,
        'ofs-empty-card': 1,
        'ofs-empty-title': 1,
        'ofs-examples': 1,
        'ofs-example': 5,
        'ofs-filmstrip': 1,
        'ofs-filmstrip-empty': 1,
        'ofs-slot': 3,
        'ofs-link': 1,
      },
      forbidden: ['ofs-image', 'ofs-batch', 'ofs-panel--chat', 'ofs-guidance', 'ofs-gallery', 'ofs-stage-progress', 'ofs-tile', 'ofs-row-textarea'],
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
        'ofs-gallery-action': 5,
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
    props: {},
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
        'ofs-batch': 1,
        'ofs-image': 1,
      },
      forbidden: ['ofs-guidance', 'ofs-figure--empty', 'ofs-toast', 'ofs-sessionbar', 'ofs-queue-pill'],
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
      forbidden: ['ofs-queue-notice', 'ofs-guidance', 'ofs-toast', 'ofs-sessionbar', 'ofs-queue-pill'],
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
      required: {
        'ofs-queue-notice': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-note': 1,
        'ofs-guidance-actions': 1,
      },
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
      forbidden: ['ofs-filmstrip-empty', 'ofs-batch', 'ofs-guidance', 'ofs-queue-pill'],
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
    props: {},
    expect: ['正在生成第 2/4 张', '第 2/4 张', '云端已就绪', '已等待'],
    reject: ['生成中 2/4'],
    structure: {
      required: {
        'ofs-stage-progress': 1,
        'ofs-progress-label': 1,
        'ofs-ghost': 1,
        'ofs-pipeline': 1,
        'ofs-pl-node': 2,
        'ofs-pl-sub': 1,
        'ofs-image': 1,
      },
      forbidden: ['ofs-guidance', 'ofs-figure--empty', 'ofs-toast', 'ofs-queue-pill'],
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
      required: {
        'ofs-pipeline': 1,
        'ofs-pl-node': 5,
        'ofs-pl-label': 5,
        'ofs-stage-progress': 1,
        'ofs-ghost': 1,
      },
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
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-command': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-actions': 1,
        'ofs-figure--empty': 1,
      },
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
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-actions': 1,
        'ofs-figure--empty': 1,
      },
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
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-toast-stack': 1,
        'ofs-toast--notice': 1,
        'ofs-toast-title': 1,
        'ofs-toast-detail': 1,
        'ofs-toast-actions': 1,
        'ofs-figure--empty': 1,
      },
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
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-actions': 1,
      },
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
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-toast-stack': 1,
        'ofs-toast--notice': 1,
        'ofs-toast-title': 1,
        'ofs-toast-detail': 1,
        'ofs-toast-actions': 1,
        'ofs-figure--empty': 1,
      },
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
      required: {
        'ofs-root': 1,
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-note': 1,
        'ofs-guidance-actions': 1,
      },
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
      required: {
        'ofs-guidance': 1,
        'ofs-guidance-command': 1,
        'ofs-guidance-note': 1,
        'ofs-guidance-actions': 1,
      },
      forbidden: ['ofs-image'],
    },
  },
}

const collectText = (node, out = []) => {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node.type === 'function') return collectText(node.type({ ...node.props, children: node.children }), out)
  collectText(node.children, out)
  return out
}

const countByClass = (node, className) => {
  if (!node || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + countByClass(child, className), 0)
  if (typeof node.type === 'function') return countByClass(node.type({ ...node.props, children: node.children }), className)
  const own = typeof node.props?.className === 'string' && node.props.className.split(' ').includes(className) ? 1 : 0
  return own + countByClass(node.children, className)
}

/** 统计整棵树里每个 className token 出现的次数（与 countByClass 不同：一次遍历拿到全部）。 */
const collectClasses = (node, out = {}) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectClasses(child, out)
    return out
  }
  if (typeof node.type === 'function') return collectClasses(node.type({ ...node.props, children: node.children }), out)
  const className = node.props?.className
  if (typeof className === 'string') {
    for (const token of className.split(/\s+/).filter(Boolean)) out[token] = (out[token] ?? 0) + 1
  }
  collectClasses(node.children, out)
  return out
}

const describeClasses = (classMap) =>
  Object.keys(classMap)
    .sort()
    .map((token) => `${token}×${classMap[token]}`)
    .join(' ')

/** 结构断言：失败信息必须同时给出场景名、期望与实际类名集合，便于直接定位。 */
const assertStructure = (name, tree, structure) => {
  const classMap = collectClasses(tree)
  for (const [className, expected] of Object.entries(structure.required ?? {})) {
    const actual = classMap[className] ?? 0
    assert.equal(
      actual,
      expected,
      `[${name}] 结构类名 .${className} 应出现 ${expected} 次，实际 ${actual} 次。实际类名集合：${describeClasses(classMap)}`,
    )
  }
  for (const className of structure.forbidden ?? []) {
    assert.ok(
      !(className in classMap),
      `[${name}] 不应出现结构类名 .${className}，实际出现 ${classMap[className]} 次。实际类名集合：${describeClasses(classMap)}`,
    )
  }
}

/** 收集满足条件的节点，用来直接触发按钮回调（测试替身没有事件系统）。 */
const findNodes = (node, predicate, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, out)
    return out
  }
  if (typeof node.type === 'function') {
    findNodes(node.type({ ...node.props, children: node.children }), predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findNodes(node.children, predicate, out)
  return out
}

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
  }
}

// 构建测试产物（每次运行都重新构建，保证测的是当前源码）
await mkdir(dirname(TEST_ARTIFACT), { recursive: true })
const testBundle = await bundle({ test: true })
await writeFile(TEST_ARTIFACT, testBundle, 'utf8')

await check('发布产物是合法 bundle 且不含测试出口', async () => {
  const artifact = await readFile(PROD_ARTIFACT, 'utf8')
  assert.ok(artifact.startsWith('window.__ModuleLoader__.load({'), '必须以模块加载器调用开头')
  assert.ok(artifact.includes('id: "dsh-our-imagen"'), 'bundle id 必须是包名')
  assert.ok(!artifact.includes('__test'), '发布产物不应包含测试出口')
  assert.ok(artifact.includes('require("react")'), 'react 必须保持 external')
  assert.ok(!/require\(["']\.\//.test(artifact), '不得相对 require 自己的产物')

  const client = await loadClient({ artifact: PROD_ARTIFACT, testBuild: false })
  assert.equal(client.id, 'dsh-our-imagen')
  assert.deepEqual(client.mod.inject, ['slots', 'locale'])
  assert.equal(typeof client.mod.apply, 'function')
})

await check('apply() 注册整页工作台与侧栏入口', async () => {
  const client = await loadClient({ artifact: PROD_ARTIFACT, testBuild: false })
  const slots = []
  const locales = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    locale: {
      register(ns, lang, dict) {
        locales.push({ ns, lang, keys: Object.keys(dict).length })
        return () => {}
      },
      bind: () => (key) => `bound:${key}`,
    },
    slots: {
      inject(name, fn) {
        fn()
        return () => {}
      },
      register(config, component) {
        slots.push({
          name: config.name,
          key: config.key,
          id: config.id,
          order: config.order,
          locale: config.locale,
          label: typeof config.label === 'function' ? config.label() : '',
          component,
        })
        return () => {}
      },
    },
  }

  client.mod.apply(ctx)
  assert.equal(locales.length, 2, '应注册 zh / en 两份字典')
  assert.deepEqual(
    slots.map((item) => item.name).sort(),
    ['conversation.session.header.utilities', 'main', 'sidebar.panellist'],
    '旧设置页工作台应已移除',
  )

  const mainSlot = slots.find((item) => item.name === 'main')
  const sideSlot = slots.find((item) => item.name === 'sidebar.panellist')
  assert.equal(typeof mainSlot.component, 'function')
  assert.equal(mainSlot.key, sideSlot.id, 'main.key 必须与 sidebar.panellist.id 相同，否则点侧栏无法切到面板')
  assert.equal(typeof sideSlot.order, 'number')
  assert.match(sideSlot.label, /^bound:/)
})

for (const [name, scenario] of Object.entries(scenarios)) {
  await check(`渲染：${name}`, async () => {
    const responses = {
      '/imagen-api/state': scenario.state,
      '/imagen-api/history': scenario.history,
      '/imagen-api/library': { favorites: [], deleted: [] },
    }
    const client = await loadClient({
      now: NOW,
      responses,
      failures: scenario.failures ?? {},
      testBuild: true,
    })
    const tree = scenario.view === 'gallery'
      // 画廊是工作台内的一个视图，用组件自身的初始 state 无法直达，这里直接挂 Gallery
      ? await client.mountRaw(client.components.Gallery, {
          t: client.internals.i18n.fallbackTranslate('zh'),
          gallery: [{ image: historyItem.images[0], item: historyItem }],
          now: NOW,
          presets: [preset],
          favorites: [],
          hasMore: false,
          loadingMore: false,
          onLoadMore: () => {},
          onDelete: () => {},
          onExport: () => {},
          onOpen: () => {},
          onRecall: () => {},
          onVariant: () => {},
          onZoom: () => {},
        })
      : await client.mountRaw(client.components.Studio, scenario.props ?? {})
    client.unmount()

    const text = collectText(tree).join(' | ')
    for (const needle of scenario.expect) assert.ok(text.includes(needle), `[${name}] 缺少文案：${needle}`)
    for (const needle of scenario.reject ?? []) assert.ok(!text.includes(needle), `[${name}] 不应出现文案：${needle}`)

    assertStructure(name, tree, scenario.structure)
  })
}

await check('画廊悬停动作把完整作品条目交给回调', async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const received = { recall: null, variant: null, zoom: null, reference: null }
  const entry = { image: historyItem.images[0], item: historyItem }
  const tree = await client.mountRaw(client.components.Gallery, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    gallery: [entry],
    now: NOW,
    presets: [preset],
    favorites: [],
    onDelete: () => {},
    onExport: () => {},
    onOpen: () => {},
    onRecall: (value) => { received.recall = value },
    onVariant: (value) => { received.variant = value },
    onReference: (value) => { received.reference = value },
    onZoom: (value) => { received.zoom = value },
  })
  client.unmount()

  const actions = findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-gallery-action'),
  )
  assert.equal(actions.length, 5, '每张作品应有带回参数 / 生成变体 / 以此图重绘 / 查看大图 / 删除五个动作')
  for (const node of actions) node.props.onClick()

  // 回归：曾经把 entry.item 直接传给动作，导致 iteratePatch 拿不到图片而静默失败。
  assert.equal(received.recall && received.recall.item, historyItem, '带回参数应收到 { image, item } 形状的条目')
  assert.equal(received.recall && received.recall.image, historyItem.images[0], '条目里应带图片信息')
  assert.equal(received.variant && received.variant.item, historyItem, '生成变体应收到完整条目')
  assert.equal(received.reference && received.reference.image, historyItem.images[0], '以此图重绘应收到完整条目')
  assert.equal(received.zoom && received.zoom.item, historyItem, '查看大图应收到完整条目')
})

// 画廊列分配：行优先，第一行从左到右就是最新顺序；列内部保留自然高度。
await check('渲染：画廊按行优先分列，最新作品在第一行最左', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const entries = [image(101), image(102), image(103)].map((img) => ({ image: img, item: historyItem }))
  const tree = await client.mountRaw(client.components.Gallery, {
    t,
    gallery: entries,
    now: NOW,
    presets: [preset],
    favorites: [],
    onDelete: () => {},
    onExport: () => {},
    onOpen: () => {},
    onRecall: () => {},
    onVariant: () => {},
    onZoom: () => {},
    onToggleFavorite: () => {},
  })
  client.unmount()

  const columns = findNodes(tree, (node) => node.props && node.props.className === 'ofs-gallery-col')
  assert.equal(columns.length, 4, '1280px 视口下应是 4 列')
  const srcOf = (column) => findNodes(column, (node) => node.type === 'img').map((node) => node.props.src)
  assert.deepEqual(srcOf(columns[0]), [image(101).url], '最新作品落在第一列第一格')
  assert.deepEqual(srcOf(columns[1]), [image(102).url], '第二新落在第二列')
  assert.deepEqual(srcOf(columns[2]), [image(103).url], '第三新落在第三列')
  assert.deepEqual(srcOf(columns[3]), [], '条目用完后不再往后面的列补位')
})

// 卡片直接收藏：星标是图片按钮的兄弟节点，点击只切收藏，不连带打开大图。
await check('渲染：画廊卡片星标切换收藏，不影响打开大图', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const entries = [image(7), image(8)].map((img) => ({ image: img, item: historyItem }))
  const favoriteCalls = []
  const opened = []
  const baseProps = (extra = {}) => ({
    t,
    gallery: entries,
    now: NOW,
    presets: [preset],
    favorites: [entries[0].image.path],
    onDelete: () => {},
    onExport: () => {},
    onOpen: (entry) => opened.push(entry),
    onRecall: () => {},
    onVariant: () => {},
    onZoom: () => {},
    onToggleFavorite: (path) => favoriteCalls.push(path),
    ...extra,
  })
  const tree = await client.mountRaw(client.components.Gallery, baseProps())
  client.unmount()

  const starButtons = findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-gallery-star'),
  )
  assert.equal(starButtons.length, 2, '每张卡片都应有一个星标按钮')
  assert.equal(starButtons[0].props['aria-pressed'], true, '已收藏的星标是选中态')
  assert.equal(starButtons[1].props['aria-pressed'], false)
  // 星标必须是图片按钮的兄弟节点：嵌套 button 既不合规，也会让点击互相干扰。
  const mediaButtons = findNodes(
    tree,
    (node) => node.type === 'button' && node.props && node.props.className === 'ofs-gallery-media',
  )
  assert.equal(mediaButtons.length, 2)
  for (const media of mediaButtons) {
    assert.equal(countByClass(media, 'ofs-gallery-star'), 0, '星标不应嵌在图片按钮内部')
  }

  starButtons[1].props.onClick({ stopPropagation: () => {} })
  assert.deepEqual(favoriteCalls, [entries[1].image.path], '点星标只把该图路径交给收藏动作')
  assert.equal(opened.length, 0, '点星标不应打开大图')

  // 批量选择态：星标整颗收起，点图片只切换选中，不打开大图也不误触收藏。
  const selectingClient = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const selectingTree = await selectingClient.mountRaw(
    selectingClient.components.Gallery,
    baseProps({ defaultSelecting: true }),
  )
  selectingClient.unmount()
  assert.equal(
    findNodes(
      selectingTree,
      (node) => node.props && typeof node.props.className === 'string'
        && node.props.className.split(' ').includes('ofs-gallery-star'),
    ).length,
    0,
    '批量选择模式下不应出现可点击的星标',
  )
  assert.equal(
    findNodes(selectingTree, (node) => node.props && node.props.className === 'ofs-gallery-pick').length,
    2,
    '批量选择模式下每张卡片显示选择圆点',
  )
  const selectingMedia = findNodes(
    selectingTree,
    (node) => node.type === 'button' && node.props && node.props.className === 'ofs-gallery-media',
  )
  selectingMedia[0].props.onClick()
  assert.equal(opened.length, 0, '批量选择时点图片只切换选中，不打开大图')
  assert.deepEqual(favoriteCalls, [entries[1].image.path], '批量选择时不应触发收藏')
})

// 单张删除：第一次点击只进入确认态，可取消；再点一次才把这一张交给删除动作。
await check('渲染：画廊卡片单张删除需二次确认', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const entry = { image: image(31), item: historyItem }
  const deleted = []
  let tree = await client.mountRaw(client.components.Gallery, {
    t,
    gallery: [entry],
    now: NOW,
    presets: [preset],
    favorites: [],
    onDelete: async (paths) => {
      deleted.push(paths)
      return { removed: paths, failed: [] }
    },
    onExport: () => {},
    onOpen: () => {},
    onRecall: () => {},
    onVariant: () => {},
    onReference: () => {},
    onZoom: () => {},
    onToggleFavorite: () => {},
  })

  const dangerButton = () => findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('is-danger'),
  )[0]

  assert.equal(collectText(dangerButton()).join(''), '删除', '未确认时按钮只写「删除」')
  dangerButton().props.onClick()
  tree = await client.rerenderRaw()
  assert.equal(collectText(dangerButton()).join(''), '确认删除', '第一次点击进入确认态，而不是直接删除')
  assert.equal(deleted.length, 0, '确认前不得发出删除请求')

  // 取消：回到未确认，不触发删除。
  const cancel = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('') === '取消')[0]
  assert.ok(cancel, '确认态应提供「取消」')
  cancel.props.onClick()
  tree = await client.rerenderRaw()
  assert.equal(collectText(dangerButton()).join(''), '删除', '取消后按钮回到未确认态')

  // 指针移出卡片：确认态自动收起，避免下次滑过时误删。
  dangerButton().props.onClick()
  tree = await client.rerenderRaw()
  findNodes(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('ofs-gallery-card'))[0].props.onMouseLeave()
  tree = await client.rerenderRaw()
  assert.equal(collectText(dangerButton()).join(''), '删除', '移出卡片应收起确认态')

  // 二次点击才真正删除，并且只提交这一张的路径。
  dangerButton().props.onClick()
  tree = await client.rerenderRaw()
  await dangerButton().props.onClick()
  assert.deepEqual(deleted, [[entry.image.path]], '确认后只删除这一张')
  tree = await client.rerenderRaw()
  assert.equal(collectText(dangerButton()).join(''), '删除', '删除成功后收起确认态')

  client.unmount()
})

// 历史首屏按契约页长请求，offset 从 0 开始（分页由「加载更多」推进）。
await check('渲染：历史首屏按契约页长与 offset 请求', async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      '/imagen-api/history': { items: [historyItem], limit: LIMITS.history.pageSize, offset: 0, hasMore: false },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  await client.mountRaw(client.components.Studio, {})
  client.unmount()
  assert.ok(
    client.fetches.includes(`/imagen-api/history?limit=${LIMITS.history.pageSize}&offset=0`),
    `历史首屏应取契约页长且 offset=0，实际请求：${client.fetches.join(', ')}`,
  )
  assert.ok(!client.fetches.includes('/imagen-api/history?limit=60'), '不应再写死旧的 60 张上限')
})

// 英文界面：流水线节点文案走本地化，不能出现宿主硬编码的中文 stage。
await check('渲染：英文界面的生图流水线', async () => {
  const client = await loadClient({
    now: NOW,
    locale: 'en-US',
    responses: {
      '/imagen-api/state': {
        ...readyState,
        jobs: [
          { id: 'job-e2', status: 'queued', createdAt: at(-5), params: { prompt: 'queued second' } },
          {
            id: 'job-e1',
            status: 'running',
            stageCode: 'running',
            progress: { done: 1, total: 3 },
            createdAt: at(-30),
            startedAt: at(-8),
            params: { prompt: 'running first' },
          },
        ],
      },
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const tree = await client.mountRaw(client.components.Studio, {})
  client.unmount()
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('Cloud ready'), `[pipeline] 英文节点文案应本地化：${text}`)
  assert.ok(text.includes('Image 2/3'), '[pipeline] 英文分张进度应本地化')
  assert.ok(text.includes('1 more queued'), '[pipeline] 英文排队数量应本地化')
  assert.ok(!text.includes('另有'), '[pipeline] 英文界面不应出现中文队列文案')
})

await check('渲染：日志抽屉（就绪 / 空态 / 不可用）', async () => {
  const fallbackState = {
    ...readyState,
    version: '0.4.1',
    probe: { cli: { present: true }, auth: { ok: true }, quota: { available: false }, notes: ['配额接口超时'] },
    probeLastGood: { quota: { available: true, usedHours: 3, totalHours: 30 } },
    probeLastGoodAt: '2026-11-09T04:40:00.000Z',
    queue: { running: null, pending: 0 },
  }
  const responses = {
    '/imagen-api/state': fallbackState,
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  }
  const lines = ['[boot] 运行时就绪', '[tunnel] 隧道就绪：https://example.trycloudflare.com']

  // 就绪：日志行进入等宽文本区，复制诊断信息走 ui.copyText。
  let client = await loadClient({ now: NOW, responses, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const copied = []
  let tree = await client.mountRaw(client.components.LogsDrawer, {
    t,
    ui: { copyText: (text, key) => copied.push({ text, key }) },
    compute: { session: { state: 'ready' }, probe: null },
    logs: { status: 'ready', lines, reason: null },
    onClose: () => {},
  })
  let text = collectText(tree).join(' | ')
  assert.ok(text.includes('运行日志'), '[logs] 缺少标题')
  assert.ok(text.includes('复制诊断信息'), '[logs] 缺少复制诊断按钮')
  assert.ok(text.includes('[tunnel] 隧道就绪'), '[logs] 缺少日志内容')
  assertStructure('logs-ready', tree, {
    required: {
      'ofs-logs': 1,
      'ofs-logs-panel': 1,
      'ofs-logs-head': 1,
      'ofs-logs-title': 1,
      'ofs-logs-body': 1,
      'ofs-logs-lines': 1,
      'ofs-logs-copy': 1,
    },
    forbidden: ['ofs-logs-note'],
  })
  const dialog = findNodes(tree, (node) => node.props && node.props.role === 'dialog')[0]
  assert.ok(dialog, '[logs] 抽屉应以 role="dialog" 渲染')
  assert.equal(dialog.props['aria-modal'], 'true')

  const copyButton = findNodes(
    tree,
    (node) => node.type === 'button' && node.props && node.props.className === 'ofs-chip ofs-logs-copy',
  )[0]
  assert.ok(copyButton, '[logs] 缺少复制按钮元素')
  copyButton.props.onClick()
  assert.equal(copied.length, 1, '[logs] 复制应交给 ui.copyText')
  assert.equal(copied[0].key, 'studio.logs.copied')
  assert.ok(copied[0].text.includes('version: 0.4.1'), '[logs] 诊断文本应带版本')
  assert.ok(copied[0].text.includes('session.state: ready'), '[logs] 诊断文本应带会话快照')
  assert.ok(!copied[0].text.includes('token'), '[logs] 诊断文本不得出现 token 字段')
  client.unmount()

  // 空态：没有日志时只给一句提示，不渲染等宽日志区。
  client = await loadClient({ now: NOW, responses, testBuild: true })
  tree = await client.mountRaw(client.components.LogsDrawer, {
    t,
    ui: { copyText: () => {} },
    compute: { session: null, probe: null },
    logs: { status: 'empty', lines: [], reason: null },
    onClose: () => {},
  })
  client.unmount()
  text = collectText(tree).join(' | ')
  assert.ok(text.includes('暂无日志'), '[logs] 缺少空态文案')
  assertStructure('logs-empty', tree, { required: { 'ofs-logs-note': 1 }, forbidden: ['ofs-logs-lines'] })

  // 不可用：展示原因，同时保留已经拿到的旧日志。
  client = await loadClient({ now: NOW, responses, testBuild: true })
  tree = await client.mountRaw(client.components.LogsDrawer, {
    t,
    ui: { copyText: () => {} },
    compute: { session: null, probe: null },
    logs: { status: 'unavailable', lines: ['[boot] 旧日志'], reason: { code: 'logs_unavailable', message: '隧道断开' } },
    onClose: () => {},
  })
  client.unmount()
  text = collectText(tree).join(' | ')
  assert.ok(text.includes('暂时拿不到远端运行日志'), '[logs] 不可用时应给出错误文案')
  assert.ok(text.includes('隧道断开'), '[logs] 不可用时应带远端原因')
  assertStructure('logs-unavailable', tree, {
    required: { 'ofs-logs-note': 1, 'ofs-logs-lines': 1 },
    forbidden: [],
  })

  // 只有 Host 本地日志（无远端会话）：仍渲染日志区并注明来源，复制诊断带 host logs 段落。
  client = await loadClient({ now: NOW, responses, testBuild: true })
  const hostCopied = []
  const hostLogs = [
    '[2026-11-11T23:10:00.123Z] [info] [jobs] enqueue jobId=j_1',
    '[2026-11-11T23:10:03.456Z] [warn] [session] transition absent->starting',
  ]
  tree = await client.mountRaw(client.components.LogsDrawer, {
    t,
    ui: { copyText: (copy, key) => hostCopied.push({ text: copy, key }) },
    compute: { session: null, probe: null },
    logs: {
      status: 'unavailable',
      lines: [],
      hostLines: hostLogs,
      reason: { code: 'session_absent', message: '云端会话未启动' },
    },
    onClose: () => {},
  })
  text = collectText(tree).join(' | ')
  assert.ok(text.includes('Host 本地运行日志'), '[logs] 只有 Host 日志时应注明来源')
  assert.ok(text.includes('[info] [jobs] enqueue jobId=j_1'), '[logs] 应展示 Host 本地日志内容')
  assert.ok(text.includes('云端会话未启动'), '[logs] 无远端会话时应保留原因提示')
  assertStructure('logs-host-only', tree, {
    required: { 'ofs-logs-note': 2, 'ofs-logs-lines': 1 },
    forbidden: [],
  })
  const hostCopyButton = findNodes(
    tree,
    (node) => node.type === 'button' && node.props && node.props.className === 'ofs-chip ofs-logs-copy',
  )[0]
  assert.ok(hostCopyButton, '[logs] 缺少复制按钮元素')
  hostCopyButton.props.onClick()
  assert.equal(hostCopied.length, 1, '[logs] 复制应交给 ui.copyText')
  assert.ok(hostCopied[0].text.includes('host logs (last 2/2):'), '[logs] 诊断文本应带 Host 日志段落')
  assert.ok(
    hostCopied[0].text.includes('[warn] [session] transition absent->starting'),
    '[logs] 诊断文本应带 Host 日志内容',
  )
  client.unmount()
})

await check('渲染：算力弹层配额回退、隧道通道与日志入口', async () => {
  const fallbackState = {
    ...readyState,
    version: '0.4.1',
    probe: { cli: { present: true }, auth: { ok: true }, quota: { available: false }, notes: ['配额接口超时'] },
    probeLastGood: { quota: { available: true, usedHours: 3, totalHours: 30 } },
    probeLastGoodAt: '2026-11-09T04:40:00.000Z',
    queue: { running: null, pending: 0 },
    session: {
      state: 'ready',
      modelId: 'sdxl-lightning',
      device: 'Tesla T4',
      idleTimeoutSec: 1800,
      tunnelProvider: 'cloudflare',
      startedAt: new Date(NOW - 600000).toISOString(),
      error: null,
    },
  }
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': fallbackState,
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const openLogsCalls = []
  const tree = await client.mountRaw(client.components.TopBar, {
    t,
    ui: {
      view: 'studio',
      setView: () => {},
      openLogs: (trigger) => openLogsCalls.push(trigger),
    },
    compute: {
      sessionState: 'ready',
      session: fallbackState.session,
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
    },
    form: {
      form: { presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0 },
      patchForm: () => {},
      selectPreset: () => {},
    },
    library: { loadHistory: () => {} },
    // 正式界面从关闭态开始；这里为渲染断言直接展开弹层。
    defaultOpen: true,
  })
  client.unmount()

  const text = collectText(tree).join(' | ')
  for (const needle of [
    '配额暂时读不到，先看本地统计',
    '最近一次成功检查',
    '3 / 30 h',
    '本次会话已运行',
    '打开 Kaggle 账户设置',
    '隧道通道',
    'Cloudflare',
    '查看运行日志',
    '云端模型实测',
  ]) {
    assert.ok(text.includes(needle), `[compute] 缺少文案：${needle}`)
  }
  assertStructure('compute-fallback', tree, {
    required: { 'ofs-popover': 1, 'ofs-popover-fallback': 1, 'ofs-popover-link': 1 },
    forbidden: [],
  })

  const link = findNodes(
    tree,
    (node) => node.type === 'a' && node.props && node.props.className === 'ofs-popover-link',
  )[0]
  assert.ok(link, '[compute] 缺少 Kaggle 设置链接')
  assert.equal(link.props.href, 'https://www.kaggle.com/settings')
  assert.equal(link.props.target, '_blank')
  assert.match(String(link.props.rel), /noreferrer/)

  const logsRow = findNodes(
    tree,
    (node) => node.type === 'button'
      && node.props
      && node.props.role === 'menuitem'
      && collectText(node).join('').includes('查看运行日志'),
  )[0]
  assert.ok(logsRow, '[compute] 缺少查看运行日志入口')
  logsRow.props.onClick()
  assert.equal(openLogsCalls.length, 1, '[compute] 点击日志入口应交给 ui.openLogs')

  // 回归：本轮从未点过「检查环境」时 /state 的 probe 为 null，账号状态不能落成「不可用」。
  // 故意不给 /state 应答，避免宿主快照里的 probe 掩盖问题。
  const mountWithoutProbe = async (sessionState, session) => {
    const bare = await loadClient({ now: NOW, responses: {}, testBuild: true })
    const bareTree = await bare.mountRaw(bare.components.TopBar, {
      t,
      ui: { view: 'studio', setView: () => {}, openLogs: () => {} },
      compute: {
        sessionState,
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
      },
      form: {
        form: { presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0 },
        patchForm: () => {},
      },
      library: { loadHistory: () => {} },
      defaultOpen: true,
    })
    bare.unmount()
    return collectText(bareTree).join('')
  }

  // 会话已就绪（能出图）→ 账号正常：会话本身就是凭据有效的证据。
  const readyFlat = await mountWithoutProbe('ready', fallbackState.session)
  assert.ok(readyFlat.includes('账号 · 正常'), `[compute] 会话就绪时账号应为正常，实际：${readyFlat}`)
  assert.ok(!readyFlat.includes('账号 · 不可用'), '[compute] 会话就绪时不应把账号判成不可用')

  // 既没探测过、也没有会话 → 未检查，同样不能落成「不可用」。
  const idleFlat = await mountWithoutProbe('absent', null)
  assert.ok(idleFlat.includes('账号 · 未检查'), `[compute] 未探测时应显示未检查，实际：${idleFlat}`)
  assert.ok(!idleFlat.includes('账号 · 不可用'), '[compute] 未探测不应显示不可用')
})

// ── 运行设置抽屉（M2.3） ───────────────────────────────────────

/** 设置接口的脱敏视图：字段形状按宿主约定固定。 */
const settingsView = {
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
async function mountSettingsDrawer(props = {}, options = {}) {
  const view = options.view ?? settingsView
  const client = await loadClient({ now: NOW, responses: options.responses ?? {}, testBuild: true })
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

const idleShutdownSession = {
  state: 'ready',
  modelId: 'sdxl-lightning',
  device: 'Tesla T4',
  idleSeconds: 600,
  idleTimeoutSec: 1800,
  error: null,
}

/** 只挂载 TopBar（算力弹层展开），返回渲染树与 openSettings 调用记录。 */
async function mountTopBarExpanded(session, computeOverrides = {}) {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
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

await check('渲染：算力弹层运行设置入口与空闲倒计时', async () => {
  // 两个字段都有真实读数：展示「已空闲 X 分钟 · 满 Y 分钟自动关机」。
  const first = await mountTopBarExpanded(idleShutdownSession)
  const firstText = collectText(first.tree).join('')
  assert.ok(
    firstText.includes('已空闲 10 分钟 · 满 30 分钟自动关机'),
    `[idle] 缺少空闲倒计时：${firstText}`,
  )
  const settingsRow = findNodes(
    first.tree,
    (node) => node.type === 'button'
      && node.props
      && node.props.role === 'menuitem'
      && collectText(node).join('').includes('运行设置'),
  )[0]
  assert.ok(settingsRow, '[idle] 缺少运行设置入口')
  settingsRow.props.onClick()
  assert.equal(first.opened.length, 1, '[idle] 点击入口应打开运行设置抽屉')
  first.client.unmount()

  // 缺 idleSeconds（旧宿主 / 没有 /health 的会话态）：不编造倒计时，退回休眠阈值说明。
  const missing = await mountTopBarExpanded({ state: 'ready', modelId: 'sdxl-lightning', idleTimeoutSec: 1800, error: null })
  const missingText = collectText(missing.tree).join('')
  assert.ok(!missingText.includes('已空闲'), '[idle] 缺 idleSeconds 时不应展示倒计时')
  assert.ok(missingText.includes('闲置休眠阈值 30 分'), `[idle] 缺读数时应保留休眠阈值：${missingText}`)
  missing.client.unmount()

  // 两个字段都缺：整行不出现。
  const none = await mountTopBarExpanded({ state: 'ready', modelId: 'sdxl-lightning', error: null })
  const noneText = collectText(none.tree).join('')
  assert.ok(!noneText.includes('已空闲'), '[idle] 缺 idleSeconds 时不应展示倒计时')
  assert.ok(!noneText.includes('闲置休眠阈值'), '[idle] 缺 idleTimeoutSec 时不应展示阈值')
  none.client.unmount()

  // 不足一分钟同样不显示，避免出现「已空闲 0 分钟」。
  const fresh = await mountTopBarExpanded({ ...idleShutdownSession, idleSeconds: 30 })
  assert.ok(
    !collectText(fresh.tree).join('').includes('已空闲'),
    '[idle] 空闲不足一分钟不应展示 0 分钟',
  )
  fresh.client.unmount()
})

await check('渲染：设置抽屉分区、生效提示与 Token 状态', async () => {
  const mounted = await mountSettingsDrawer()
  try {
    const text = collectText(mounted.tree).join(' | ')
    for (const needle of [
      '运行设置',
      '当前云端实例已运行，修改将在下次唤醒时生效',
      '常规运行',
      '空闲自动关机',
      '15 分钟',
      '30 分钟',
      '60 分钟',
      '120 分钟',
      '自定义分钟（5–180）',
      'GPU 加速器',
      '2× Tesla T4（默认推荐）',
      'Tesla P100',
      '模型下载与限流防护',
      'HuggingFace Token',
      '清除 Token',
      '来源：宿主配置',
      '高级：预挂载与依赖锁定',
      '保存设置',
      '取消',
    ]) {
      assert.ok(text.includes(needle), `[settings] 缺少文案：${needle}\n实际：${text}`)
    }
    // 关闭按钮只有图标，文案在 aria-label / title 上。
    const closeButton = findNodes(
      mounted.tree,
      (node) => node.type === 'button' && node.props && node.props['aria-label'] === '关闭设置',
    )[0]
    assert.ok(closeButton, '[settings] 缺少关闭按钮')
    assert.equal(closeButton.props.title, '关闭设置')
    // 默认折叠高级区：三个多行输入都不渲染。
    assert.equal(findNodes(mounted.tree, (node) => node.type === 'textarea').length, 0, '[settings] 高级区应默认折叠')
    assertStructure('settings-drawer', mounted.tree, {
      required: {
        'ofs-settings': 1,
        'ofs-settings-panel': 1,
        'ofs-settings-head': 1,
        'ofs-settings-title': 1,
        'ofs-settings-body': 1,
        'ofs-settings-effective': 1,
        'ofs-settings-section': 3,
        'ofs-settings-section-title': 2,
        'ofs-settings-quick-item': 4,
        'ofs-settings-option': 2,
        'ofs-settings-clear': 1,
        'ofs-settings-save': 1,
      },
      forbidden: ['ofs-settings-advanced', 'ofs-settings-textarea', 'ofs-settings-errors'],
    })
    const dialog = findNodes(mounted.tree, (node) => node.props && node.props.role === 'dialog')[0]
    assert.ok(dialog, '[settings] 抽屉应以 role="dialog" 渲染')
    assert.equal(dialog.props['aria-modal'], 'true')
    assert.equal(dialog.props['aria-label'], '运行设置')

    // 打开时 GET 一次脱敏视图；没有改动时保存按钮禁用。
    assert.equal(mounted.calls.length, 1)
    assert.equal(mounted.calls[0].path, '/imagen-api/settings')
    assert.equal(mounted.calls[0].method, 'GET')
    const saveButton = findNodes(
      mounted.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.ok(saveButton, '[settings] 缺少保存按钮')
    assert.equal(saveButton.props.disabled, true, '没有改动时保存按钮应禁用')
    assert.equal(saveButton.props['aria-busy'], false)

    // hfToken 用 password 输入，视图只回传 hasHfToken，不预填任何原文。
    const passwordInput = findNodes(
      mounted.tree,
      (node) => node.type === 'input' && node.props && node.props.type === 'password',
    )[0]
    assert.ok(passwordInput, '[settings] 缺少 Token 输入框')
    assert.equal(passwordInput.props.value, '')
    assert.equal(passwordInput.props.placeholder, '已配置，留空保持不变')
    assert.equal(passwordInput.props.autoComplete, 'off')

    // 当前视图是 1800 秒 → 30 分钟快捷档高亮。
    const quickItems = findNodes(
      mounted.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-quick-item'),
    )
    assert.deepEqual(quickItems.map((node) => node.props['aria-pressed']), [false, true, false, false])
    const radios = findNodes(mounted.tree, (node) => node.type === 'input' && node.props && node.props.type === 'radio')
    assert.deepEqual(radios.map((node) => node.props.value), ['NvidiaTeslaT4', 'NvidiaTeslaP100'])
    assert.deepEqual(radios.map((node) => node.props.checked), [true, false])
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：设置抽屉高级区与行级校验', async () => {
  // 高级区展开：三个多行输入与示例提示；合法内容不出现错误行。
  const valid = await mountSettingsDrawer({ defaultAdvancedOpen: true })
  try {
    const text = collectText(valid.tree).join(' | ')
    for (const needle of [
      '预挂载 Kaggle Dataset',
      '每行一个 owner/dataset，最多 32 行',
      '本地模型目录映射',
      '每行一条 repo=容器路径',
      'repo 是 HuggingFace 模型 ID',
      'pip 依赖约束',
      '每行一条约束，例如 diffusers==0.31.0',
    ]) {
      assert.ok(text.includes(needle), `[settings-advanced] 缺少文案：${needle}`)
    }
    const textareas = findNodes(valid.tree, (node) => node.type === 'textarea')
    assert.equal(textareas.length, 3, '[settings-advanced] 高级区应有三个多行输入')
    assert.deepEqual(textareas.map((node) => node.props.value), [
      'owner/dataset',
      'org/repo=/kaggle/input/repo',
      'diffusers==0.31.0',
    ])
    assertStructure('settings-advanced', valid.tree, {
      required: {
        'ofs-settings-advanced': 1,
        'ofs-settings-textarea': 3,
        'ofs-settings-hint': 3,
      },
      forbidden: ['ofs-settings-errors', 'ofs-settings-error-item'],
    })
    const saveButton = findNodes(
      valid.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.equal(saveButton.props.disabled, true, '高级区合法但没改动时仍禁用保存')
  } finally {
    valid.client.unmount()
  }

  // 非法行：标出第几行、说明原因，并禁止保存。
  const invalid = await mountSettingsDrawer({
    defaultAdvancedOpen: true,
    defaultDraft: { localModelsText: 'owner/repo=/kaggle/input/repo\nbroken-line' },
  })
  try {
    const text = collectText(invalid.tree).join(' | ')
    assert.ok(text.includes('第 2 行：缺少 =，格式应为 repo=容器路径'), `[settings-advanced] 缺少行级错误：${text}`)
    assert.ok(text.includes('有 1 行需要修正后才能保存'), '[settings-advanced] 缺少修正提示')
    assertStructure('settings-advanced-invalid', invalid.tree, {
      required: { 'ofs-settings-errors': 1, 'ofs-settings-error-item': 1, 'ofs-settings-error': 1 },
      forbidden: [],
    })
    const saveButton = findNodes(
      invalid.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.equal(saveButton.props.disabled, true, '存在非法行时必须禁用保存')
  } finally {
    invalid.client.unmount()
  }
})

await check('渲染：设置抽屉保存流程（只提交改动字段）', async () => {
  const savedView = {
    ...settingsView,
    idleTimeoutSec: 3600,
    accelerator: 'NvidiaTeslaP100',
    hasHfToken: false,
    hfTokenSource: 'none',
  }
  const mounted = await mountSettingsDrawer({
    defaultDraft: { idleMinutes: '60', accelerator: 'NvidiaTeslaP100', clearHfToken: true },
    savedView,
  })
  try {
    const text = collectText(mounted.tree).join(' | ')
    assert.ok(text.includes('保存后将清除已配置的 Token'), `[settings-save] 缺少清除提示：${text}`)
    // 草稿改动立刻反映在档位高亮与单选态上。
    const quickItems = findNodes(
      mounted.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-quick-item'),
    )
    assert.deepEqual(quickItems.map((node) => node.props['aria-pressed']), [false, false, true, false], '60 分钟档应高亮')
    const radios = findNodes(mounted.tree, (node) => node.type === 'input' && node.props && node.props.type === 'radio')
    assert.deepEqual(radios.map((node) => node.props.checked), [false, true], 'P100 应选中')

    const saveButton = findNodes(
      mounted.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.equal(saveButton.props.disabled, false, '有改动时保存按钮应可用')
    saveButton.props.onClick()
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve()
      await new Promise((resolvePromise) => setImmediate(resolvePromise))
    }

    assert.deepEqual(mounted.calls.map((call) => call.method), ['GET', 'POST'], '打开时 GET、保存时 POST')
    const posted = mounted.calls[1]
    assert.equal(posted.path, '/imagen-api/settings')
    assert.deepEqual(posted.body, { idleTimeoutSec: 3600, accelerator: 'NvidiaTeslaP100', clearHfToken: true })
    assert.deepEqual(mounted.toasts, ['运行设置已保存'], '保存成功后应 toast')
  } finally {
    mounted.client.unmount()
  }

  // 另一种改动来源：手输 Token（去首尾空白后提交），不与 clearHfToken 混在一起。
  const tokenMounted = await mountSettingsDrawer({ defaultDraft: { hfToken: ' hf_secret ' } })
  try {
    const saveButton = findNodes(
      tokenMounted.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.equal(saveButton.props.disabled, false)
    saveButton.props.onClick()
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve()
      await new Promise((resolvePromise) => setImmediate(resolvePromise))
    }
    const posted = tokenMounted.calls.find((call) => call.method === 'POST')
    assert.ok(posted, '[settings-save] 手输 Token 应提交 POST')
    assert.deepEqual(posted.body, { hfToken: 'hf_secret' })
    assert.equal(Object.prototype.hasOwnProperty.call(posted.body, 'clearHfToken'), false)
  } finally {
    tokenMounted.client.unmount()
  }
})

await check('渲染：设置抽屉读取失败可重试', async () => {
  const client = await loadClient({
    now: NOW,
    responses: { '/imagen-api/settings': { ok: false, error: { code: 'internal_error', message: '设置读取失败' } } },
    testBuild: true,
  })
  let tree = null
  try {
    tree = await client.mountRaw(client.components.SettingsDrawer, {
      t: client.internals.i18n.fallbackTranslate('zh'),
      ui: { showToast: () => {} },
      onClose: () => {},
    })
  } finally {
    client.unmount()
  }
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('读取运行设置失败'), `[settings-load] 缺少失败提示：${text}`)
  assert.ok(text.includes('本地服务内部错误'), '[settings-load] 应给出可读的错误码文案')
  assert.ok(text.includes('重试'), '[settings-load] 失败态应提供重试按钮')
  assertStructure('settings-load-error', tree, {
    required: { 'ofs-settings': 1, 'ofs-settings-panel': 1, 'ofs-settings-error-state': 1, 'ofs-settings-error': 1 },
    forbidden: ['ofs-settings-form', 'ofs-settings-loading'],
  })
})

await check('渲染：设置抽屉英文界面', async () => {
  const mounted = await mountSettingsDrawer(
    { defaultAdvancedOpen: true },
    { locale: 'en-US', view: { ...settingsView, effectiveOnNextSession: false } },
  )
  try {
    const text = collectText(mounted.tree).join(' | ')
    for (const needle of [
      'Runtime settings',
      'Auto-shutdown when idle',
      '15 min',
      'Custom minutes (5–180)',
      '2× Tesla T4 (recommended)',
      'Tesla P100',
      'Model downloads and rate limits',
      'HuggingFace token',
      'Clear token',
      'Advanced: preloads and pinned dependencies',
      'Pre-mounted Kaggle datasets',
      'One repo=container-path per line',
      'pip dependency constraints',
      'Save settings',
      'Cancel',
    ]) {
      assert.ok(text.includes(needle), `[settings-en] 缺少英文文案：${needle}\n实际：${text}`)
    }
    assert.ok(!text.includes('运行设置'), '[settings-en] 英文界面不应出现中文标题')
    assert.ok(!text.includes('保存设置'), '[settings-en] 英文界面不应出现中文按钮')
    // 已配置 Token 的 placeholder 也走英文字典（placeholder 不进 collectText）。
    const passwordInput = findNodes(
      mounted.tree,
      (node) => node.type === 'input' && node.props && node.props.type === 'password',
    )[0]
    assert.equal(passwordInput.props.placeholder, 'Already configured; leave empty to keep it')
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：gpu / auth / cli 指引卡动作与提示', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  try {
    const t = client.internals.i18n.fallbackTranslate('zh')
    const started = []
    const viewedLogs = []
    const copiedCommands = []
    const copiedLogins = []
    const baseProps = {
      t,
      actions: { resetToSafe: () => {}, retryFocusedJob: () => {} },
      compute: {
        session: null,
        probe: null,
        startSession: () => started.push('start'),
        runProbe: () => started.push('probe'),
        retryHost: () => {},
      },
      ui: {
        openLogs: () => viewedLogs.push(true),
        copyText: () => copiedLogins.push(true),
        copyInstallCommand: () => copiedCommands.push(true),
      },
    }

    // gpu 卡：主操作是外链（账户设置首页，不是 API Token 页），次操作是唤醒，另有两个次级动作。
    const gpuTree = await client.mountRaw(client.components.GuidanceCard, {
      ...baseProps,
      guidance: { kind: 'gpu', detail: '未检测到可用 GPU（当前为 CPU 容器）', dismiss: () => {} },
    })
    const gpuText = collectText(gpuTree).join(' | ')
    for (const needle of [
      '云端没有拿到 GPU',
      '未检测到可用 GPU（当前为 CPU 容器）',
      '手机号验证',
      '打开 Kaggle 账户设置',
      '唤醒云端',
      '查看日志',
      '复制诊断信息',
    ]) {
      assert.ok(gpuText.includes(needle), `[gpu-card] 缺少文案：${needle}`)
    }
    assert.ok(!gpuText.includes('重试一次'), '[gpu-card] 不应给出「重试一次」')
    assertStructure('gpu-card', gpuTree, {
      required: { 'ofs-guidance': 1, 'ofs-guidance-note': 1, 'ofs-guidance-actions': 1 },
      forbidden: ['ofs-guidance-command'],
    })
    const gpuLink = findNodes(gpuTree, (node) => node.type === 'a')[0]
    assert.ok(gpuLink, '[gpu-card] 缺少 Kaggle 账户设置链接')
    assert.equal(gpuLink.props.href, 'https://www.kaggle.com/settings')
    assert.equal(gpuLink.props.target, '_blank')
    assert.match(String(gpuLink.props.rel), /noreferrer/)
    const wakeButton = findNodes(
      gpuTree,
      (node) => node.type === 'button' && collectText(node).join('').includes('唤醒云端'),
    )[0]
    assert.ok(wakeButton, '[gpu-card] 缺少唤醒按钮')
    wakeButton.props.onClick()
    assert.deepEqual(started, ['start'], '[gpu-card] 唤醒按钮应重新启动会话')
    const viewLogsButton = findNodes(
      gpuTree,
      (node) => node.type === 'button' && collectText(node).join('').includes('查看日志'),
    )[0]
    viewLogsButton.props.onClick()
    assert.equal(viewedLogs.length, 1, '[gpu-card] 查看日志应交给 openLogs')

    // auth 卡：给出 CLI 2.x 登录命令（可复制）+ OAuth 凭据位置 + 网页 Token / 旧版兼容位置。
    const authTree = await client.mountRaw(client.components.GuidanceCard, {
      ...baseProps,
      guidance: { kind: 'auth', detail: '', dismiss: () => {} },
    })
    const authText = collectText(authTree).join(' | ')
    for (const needle of [
      'kaggle auth login',
      '%USERPROFILE%\\.kaggle\\credentials.json',
      'refresh_token',
      '%USERPROFILE%\\.kaggle\\access_token',
      '%USERPROFILE%\\.kaggle\\kaggle.json',
      '复制登录命令',
    ]) {
      assert.ok(authText.includes(needle), `[auth-card] 缺少文案：${needle}（实际：${authText}）`)
    }
    const authLink = findNodes(authTree, (node) => node.type === 'a')[0]
    assert.equal(authLink.props.href, 'https://www.kaggle.com/settings/api')
    const copyLoginButton = findNodes(
      authTree,
      (node) => node.type === 'button' && collectText(node).join('').includes('复制登录命令'),
    )[0]
    assert.ok(copyLoginButton, '[auth-card] 缺少复制登录命令按钮')
    copyLoginButton.props.onClick()
    assert.equal(copiedLogins.length, 1, '[auth-card] 复制登录命令应走 ui.copyText')

    // cli 卡：安装命令下给 Windows PATH 提示。
    const cliTree = await client.mountRaw(client.components.GuidanceCard, {
      ...baseProps,
      guidance: { kind: 'cli', detail: '', dismiss: () => {} },
    })
    const cliText = collectText(cliTree).join(' | ')
    assert.ok(cliText.includes('pip install -U kaggle'), '[cli-card] 缺少安装命令')
    assert.ok(cliText.includes('Windows 用户安装后若仍提示找不到命令'), '[cli-card] 缺少 Windows PATH 提示')
    assert.ok(cliText.includes('已加入系统 PATH'), '[cli-card] PATH 提示应说明加入系统 PATH')
    const copyClipboard = findNodes(
      cliTree,
      (node) => node.type === 'button' && collectText(node).join('').includes('复制安装命令'),
    )[0]
    copyClipboard.props.onClick()
    assert.equal(copiedCommands.length, 1, '[cli-card] 复制安装命令应走 ui.copyInstallCommand')
  } finally {
    client.unmount()
  }
})

await check('渲染：queue_timeout 指引卡收敛为「换新实例重排」', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  try {
    const t = client.internals.i18n.fallbackTranslate('zh')
    const calls = []
    const tree = await client.mountRaw(client.components.GuidanceCard, {
      t,
      actions: { resetToSafe: () => {}, retryFocusedJob: () => {} },
      compute: {
        session: {
          state: 'error',
          kernelUrl: 'https://www.kaggle.com/code/tester/imagen-12345678',
          error: { code: 'queue_timeout', message: '等待 GPU 超时（45 分钟），Kernel 仍在队列中（QUEUED）' },
        },
        probe: null,
        startSession: () => calls.push('start'),
        requeueSession: () => calls.push('requeue'),
        runProbe: () => {},
        retryHost: () => {},
      },
      ui: { openLogs: () => {}, copyText: () => {}, copyInstallCommand: () => {} },
      guidance: {
        kind: 'session',
        code: 'queue_timeout',
        detail: '等待 GPU 超时（45 分钟），Kernel 仍在队列中（QUEUED）',
        dismiss: () => {},
      },
    })
    const text = collectText(tree).join(' | ')
    for (const needle of [
      '云端会话没有就绪',
      '换新实例重排',
      '45 分钟仍未拿到 GPU',
      '删除这条排不上的 Kernel',
      '查看日志',
      '关闭',
    ]) {
      assert.ok(text.includes(needle), `[queue-timeout-card] 缺少文案：${needle}（实际：${text}）`)
    }
    // 文案确定化：不再出现「可能仍在队列中」这类不确定表述，也不再提供继续等待 / 去 Kaggle。
    for (const gone of [
      '该 Kernel 可能仍在',
      '继续等待当前队列',
      '前往 Kaggle 查看',
      '强制新建实例',
      '复制诊断信息',
    ]) {
      assert.ok(!text.includes(gone), `[queue-timeout-card] 不应出现：${gone}（实际：${text}）`)
    }
    assert.equal(findNodes(tree, (node) => node.type === 'a').length, 0, '[queue-timeout-card] 不再提供 Kaggle 外链')
    // 动作集合收敛为：主「换新实例重排」+ 「查看日志」+ 「关闭」。
    const buttons = findNodes(tree, (node) => node.type === 'button')
    assert.deepEqual(
      buttons.map((node) => collectText(node).join('')),
      ['换新实例重排', '查看日志', '关闭'],
      '[queue-timeout-card] 动作集合应为换新实例重排 / 查看日志 / 关闭',
    )
    assert.ok(buttons[0].props.className.includes('is-on'), '[queue-timeout-card] 重排应是主操作')
    buttons[0].props.onClick()
    assert.deepEqual(calls, ['requeue'], '[queue-timeout-card] 主操作应调用 requeueSession')
  } finally {
    client.unmount()
  }
})

/**
 * 10 分钟卡住横幅的完整状态：旧快照没有 queuePolicy，靠契约默认值判定卡住；
 * startedAt 与用例里的 NOW 相差 11 分钟。
 */
const stalledQueueState = {
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
}

const mountStalledStudio = async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': stalledQueueState,
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const tree = await client.mountRaw(client.components.Studio, {})
  return { client, tree }
}

// 关闭（继续等待）只收起卡片：宿主仍返回同一轮卡住的会话时，轮询不会把卡片重新弹出来。
await check('渲染：10 分钟卡住横幅关闭后同一轮不再弹回', async () => {
  const { client, tree } = await mountStalledStudio()
  try {
    const collect = (root) => collectText(root).join(' | ')
    assert.ok(collect(tree).includes('排队超过 10 分钟还没拿到 GPU'), '初始应显示排队卡住横幅')
    const waitButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('') === '继续等待',
    )[0]
    assert.ok(waitButton, '[queue-stalled] 缺少「继续等待」按钮')
    waitButton.props.onClick()
    // 宿主轮询仍返回同一轮卡住的会话（startedAt 未变），卡片不能回来。
    await client.advanceTimers(12000)
    const next = await client.rerenderRaw()
    assert.ok(!collect(next).includes('排队超过 10 分钟还没拿到 GPU'), '[queue-stalled] 关闭后同一轮不应重复弹出')
    assert.equal(findNodes(next, (node) => node.props?.className === 'ofs-queue-notice').length, 0)
  } finally {
    client.unmount()
  }
})

// 主操作「换新实例重排」：发一次 POST /session/start，body 带 forceNew + replace；点击后卡片收起。
await check('渲染：10 分钟卡住横幅换新实例重排请求体与防重入', async () => {
  const { client, tree } = await mountStalledStudio()
  try {
    const requeueButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('') === '换新实例重排',
    )[0]
    assert.ok(requeueButton, '[queue-stalled] 缺少「换新实例重排」按钮')
    // 同一 tick 双击：useSessionControl 的同步判重只允许发一次请求。
    requeueButton.props.onClick()
    requeueButton.props.onClick()
    await client.settle()
    const starts = client.requests.filter((item) => item.path === '/imagen-api/session/start')
    assert.equal(starts.length, 1, '[queue-stalled] 重排请求只应发出一次（防重入）')
    assert.equal(starts[0].method, 'POST')
    assert.deepEqual(
      starts[0].body,
      { presetId: 'sdxl-lightning', forceNew: true, replace: true },
      '[queue-stalled] 重排请求体必须是 { presetId, forceNew: true, replace: true }',
    )
    const next = await client.rerenderRaw()
    assert.ok(
      !collectText(next).join(' | ').includes('排队超过 10 分钟还没拿到 GPU'),
      '[queue-stalled] 点击重排后卡片应收起',
    )
  } finally {
    client.unmount()
  }
})


await check('渲染：模型选择卡展开态', async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const tree = await client.mountRaw(client.components.TopBar, {
    t,
    isEn: false,
    ui: { view: 'studio', setView: () => {}, openLogs: () => {} },
    compute: {
      sessionState: 'ready',
      session: readyState.session,
      quota: readyState.probe.quota,
      presets: [preset, turbo],
      defaultPreset: 'sdxl-lightning',
      busy: '',
      probing: false,
      probe: readyState.probe,
      probeReport: null,
      startSession: () => {},
      stopSession: () => {},
      runProbe: () => {},
      openFolder: () => {},
    },
    form: {
      form: { presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0 },
      patchForm: () => {},
      selectPreset: () => {},
    },
    library: { loadHistory: () => {} },
    defaultModelOpen: true,
  })
  client.unmount()

  const text = collectText(tree).join(' | ')
  for (const needle of [
    '出图模型 · 2',
    '实测稳态耗时',
    'Lightning',
    'Turbo',
    '默认',
    '4 步极速出图，平衡画质与耗时',
    '3.5B + LoRA · 1024px · 4 步',
    '~6.2秒',
    '海报为概念示意，非出图样例；切换会套用推荐尺寸与步数。',
  ]) {
    assert.ok(text.includes(needle), `[model-picker] 缺少文案：${needle}`)
  }
  assertStructure('model-picker', tree, {
    required: {
      'ofs-model': 1,
      'ofs-model-menu': 1,
      'ofs-model-option': 2,
      'ofs-model-poster': 2,
      'ofs-model-default': 1,
    },
    forbidden: ['ofs-preset'],
  })

  const options = findNodes(tree, (node) => node.props && node.props.role === 'option')
  assert.equal(options.length, 2, '[model-picker] 应渲染两个模型选项')
  const selected = options.find((node) => node.props['aria-selected'] === 'true')
  assert.ok(selected, '[model-picker] 应有选中项')
  assert.equal(selected.props['aria-selected'], 'true')
  const trigger = findNodes(
    tree,
    (node) => node.type === 'button' && node.props && node.props.className === 'ofs-model',
  )[0]
  assert.ok(trigger, '[model-picker] 缺少触发胶囊')
  assert.equal(trigger.props['aria-expanded'], 'true')
  assert.equal(trigger.props['aria-haspopup'], 'listbox')

  // 组件级：点选回调与中英切换（不依赖浏览器事件，直接调用渲染树上的回调）。
  const pickerClient = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const calls = { open: [], change: [] }
  const pickerTree = await pickerClient.mountRaw(pickerClient.components.ModelCardPicker, {
    t: pickerClient.internals.i18n.fallbackTranslate('zh'),
    isEn: false,
    presets: [preset, turbo],
    value: 'sdxl-lightning',
    defaultPreset: 'sdxl-lightning',
    open: true,
    onOpenChange: (next) => calls.open.push(next),
    onChange: (next) => calls.change.push(next.id),
  })
  pickerClient.unmount()
  const pickerOptions = findNodes(pickerTree, (node) => node.props && node.props.role === 'option')
  pickerOptions[1].props.onClick()
  assert.deepEqual(calls.change, ['sdxl-turbo'], '[model-picker] 点选应把完整预设交给 onChange')
  assert.deepEqual(calls.open, [false], '[model-picker] 点选后应请求关闭')

  const enClient = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const enTree = await enClient.mountRaw(enClient.components.ModelCardPicker, {
    t: enClient.internals.i18n.fallbackTranslate('en'),
    isEn: true,
    presets: [preset],
    value: 'sdxl-lightning',
    defaultPreset: 'sdxl-lightning',
    open: true,
    onOpenChange: () => {},
    onChange: () => {},
  })
  enClient.unmount()
  const enText = collectText(enTree).join(' | ')
  assert.ok(enText.includes('4-step fast generation, balanced quality'), '[model-picker] 英文描述应取自 description.en')
  assert.ok(enText.includes('~6.2s'), '[model-picker] 英文耗时单位应为 s')
})

await check('渲染：大图预览 dialog 与图片 alt', async () => {
  const responses = {
    '/imagen-api/state': readyState,
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  }

  // 工作台：舞台与胶片条的 alt 优先用提示词，不再回落成文件名。
  let client = await loadClient({ now: NOW, responses, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  let tree = await client.mountRaw(client.components.Studio, {})
  client.unmount()
  const studioImages = findNodes(tree, (node) => node.type === 'img')
  assert.ok(studioImages.length >= 2, '舞台与胶片条都应渲染图片')
  for (const node of studioImages) {
    assert.ok(typeof node.props.alt === 'string' && node.props.alt.length > 0, '所有 img 都应有非空 alt')
  }
  assert.ok(
    studioImages.some((node) => node.props.alt === '测试用的荷花池塘'),
    'alt 应优先使用提示词',
  )

  // 大图预览：role="dialog" + aria-modal，图片同样带可读 alt。
  client = await loadClient({ now: NOW, responses, testBuild: true })
  tree = await client.mountRaw(client.components.Stage, {
    t,
    ui: { zoom: true, setZoom: () => {}, copyPath: () => {} },
    compute: { activeJob: null, queued: false },
    form: { useInspiration: () => {} },
    library: {
      selected: { image: historyItem.images[0], item: historyItem },
      isFavorite: () => false,
      toggleFavorite: () => {},
    },
    actions: { iterate: () => {}, reroll: () => {} },
  })
  client.unmount()
  const dialog = findNodes(tree, (node) => node.props && node.props.role === 'dialog')[0]
  assert.ok(dialog, '[stage] 放大层应带 role="dialog"')
  assert.equal(dialog.props['aria-modal'], 'true')
  const lightboxImages = findNodes(tree, (node) => node.type === 'img')
  assert.ok(lightboxImages.length >= 2, '放大层应包含大图')
  for (const node of lightboxImages) {
    assert.ok(typeof node.props.alt === 'string' && node.props.alt.length > 0, '放大层 img 应有非空 alt')
  }
})

// 图生图（M3）：参考图槽位只在有参考图时出现，强度滑块按契约取值，移除后回到文生图界面。
await check('渲染：以此图重绘设置参考图，槽位可调强度、可移除', async () => {
  const img2imgPreset = { ...preset, supportsImg2Img: true }
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': { ...readyState, presets: [img2imgPreset], defaultPreset: 'sdxl-lightning' },
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery' })
    // 文生图界面（画廊）里不存在任何参考图占位。
    assertStructure('no-reference', tree, { required: { 'ofs-gallery': 1 }, forbidden: ['ofs-reference'] })

    const trigger = findNodes(
      tree,
      (node) => node.type === 'button'
        && node.props?.className === 'ofs-gallery-action'
        && collectText(node).join('').includes('以此图重绘'),
    )[0]
    assert.ok(trigger, '画廊卡片应提供「以此图重绘」')
    trigger.props.onClick()
    tree = await client.rerenderRaw()

    // 点击后切回创作视图，参考图槽位出现。
    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('已设为参考图'), '应提示已设为参考图')
    assert.ok(text.includes('重绘强度'), '槽位应带重绘强度滑块')
    assert.ok(text.includes('7.png'), '槽位只显示文件名')
    assertStructure('reference-set', tree, {
      required: {
        'ofs-panel--form': 1,
        'ofs-reference': 1,
        'ofs-reference-thumb': 1,
        'ofs-reference-range': 1,
        'ofs-reference-remove': 1,
      },
      forbidden: ['ofs-gallery', 'ofs-reference-warn'],
    })

    const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    assert.ok(range, '参考图槽位应带重绘强度滑块')
    assert.equal(range.props.min, LIMITS.strength.min)
    assert.equal(range.props.max, LIMITS.strength.max)
    assert.equal(range.props.step, LIMITS.strength.step)
    assert.equal(range.props.value, LIMITS.strength.default)
    assert.equal(range.props['aria-label'], '重绘强度')
    assert.ok(collectText(tree).join('').includes('0.60'), '强度显示两位小数')

    range.props.onChange({ target: { value: '0.75' } })
    tree = await client.rerenderRaw()
    const updatedRange = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    assert.equal(updatedRange.props.value, 0.75, '拖动滑块应更新重绘强度')
    assert.ok(collectText(tree).join(' ').includes('0.75'), '强度读数应跟随滑块')

    const remove = findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-reference-remove'),
    )[0]
    assert.ok(remove, '缺少移除按钮')
    remove.props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('reference-removed', tree, { required: {}, forbidden: ['ofs-reference', 'ofs-reference-range'] })
    text = collectText(tree).join(' | ')
    // toast「已设为参考图，可调整重绘强度」还在，但槽位本身的说明已随参考图一起消失。
    assert.ok(!text.includes('强度越低越贴近参考图'), '移除参考图后界面回到文生图状态')
  } finally {
    client.unmount()
  }
})

// 提交链路：没有参考图时请求体与改造前一致；有参考图时带 reference: { path, strength }，
// 且提交成功后参考图保留，方便连续迭代。
await check('渲染：生成请求体按参考图区分文生图 / 图生图，提交后保留参考图', async () => {
  const img2imgPreset = { ...preset, supportsImg2Img: true }
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [img2imgPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-new', status: 'queued' },
  }
  const findGenerateButton = (tree) => findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-generate'),
  )[0]

  // 1) 纯文生图：请求体里没有 reference / strength。
  let client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    const tree = await client.mountRaw(client.components.Studio, { initialPrompt: '雨夜街景' })
    const generateButton = findGenerateButton(tree)
    assert.ok(generateButton, '缺少生成按钮')
    generateButton.props.onClick()
    await client.settle()
    const txt2img = client.requests.filter((item) => item.path === '/imagen-api/generate').pop()
    assert.ok(txt2img, '应提交生成请求')
    assert.ok(!('reference' in txt2img.body), '文生图请求体不得出现 reference')
    assert.ok(!('strength' in txt2img.body), '文生图请求体不得出现 strength')
  } finally {
    client.unmount()
  }

  // 2) 图生图：先以画廊作品为参考图，再拖动强度后提交。
  client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery', initialPrompt: '雨夜街景' })
    const trigger = findNodes(
      tree,
      (node) => node.type === 'button'
        && node.props?.className === 'ofs-gallery-action'
        && collectText(node).join('').includes('以此图重绘'),
    )[0]
    trigger.props.onClick()
    tree = await client.rerenderRaw()
    const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    range.props.onChange({ target: { value: '0.35' } })
    tree = await client.rerenderRaw()

    const generateButton = findGenerateButton(tree)
    generateButton.props.onClick()
    await client.settle()
    const img2img = client.requests.filter((item) => item.path === '/imagen-api/generate').pop()
    assert.ok(img2img, '应提交图生图请求')
    assert.deepEqual(img2img.body.reference, {
      path: historyItem.images[0].path,
      strength: 0.35,
    }, '请求体应带参考图路径与重绘强度')
    assert.ok(img2img.body.prompt.includes('雨夜街景'), '图生图仍然提交提示词')

    // 提交成功后参考图保留，用户可连续迭代。
    tree = await client.rerenderRaw()
    assertStructure('reference-kept', tree, { required: { 'ofs-reference': 1 }, forbidden: ['ofs-reference-warn'] })
  } finally {
    client.unmount()
  }
})

// 预设能力：以不支持垫图的模型启动，点「以此图重绘」应自动切到支持垫图的预设并说明。
await check('渲染：不支持垫图的预设自动切换并点名模型', async () => {
  const flux = {
    ...preset,
    id: 'flux2-klein-4b',
    label: 'Klein 4B',
    short: 'Klein 4B',
    family: 'FLUX.2',
    description: { zh: '轻量快速，风格化强', en: 'Lightweight and fast' },
    supportsImg2Img: false,
    // FLUX.2 管线不接受 negative_prompt：排除项永远隐藏（用户抬高 CFG 也一样）。
    supportsNegative: false,
    negativeHint: '',
  }
  const lightning = { ...preset, supportsImg2Img: true }
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [flux, lightning], defaultPreset: 'flux2-klein-4b' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-new', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery', initialPrompt: '雨夜街景' })
    const trigger = findNodes(
      tree,
      (node) => node.type === 'button'
        && node.props?.className === 'ofs-gallery-action'
        && collectText(node).join('').includes('以此图重绘'),
    )[0]
    trigger.props.onClick()
    tree = await client.rerenderRaw()

    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('当前模型不支持垫图重绘，已切到 SDXL Lightning'), '自动切换预设要 toast 说明切到了哪个模型')
    const modelNow = findNodes(
      tree,
      (node) => typeof node.props?.className === 'string' && node.props.className.split(' ').includes('ofs-model-now'),
    )[0]
    assert.equal(collectText(modelNow).join(''), 'Lightning', '应切到支持垫图的 sdxl-lightning')
    assertStructure('reference-switched', tree, {
      required: { 'ofs-reference': 1, 'ofs-reference-range': 1 },
      forbidden: ['ofs-reference-warn', 'ofs-gallery'],
    })
    assert.equal(
      findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0].props.disabled,
      false,
      '支持垫图的预设下滑块可用',
    )
  } finally {
    client.unmount()
  }
})

// 参考图存在但当前预设不支持垫图：槽位置灰、滑块禁用、给出一行明确说明。
await check('渲染：不支持垫图时参考图槽位置灰并给出说明', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const patched = []
  const tree = await client.mountRaw(client.components.Rail, {
    t,
    ui: {
      advancedOpen: false,
      setAdvancedOpen: () => {},
      negativeOpen: false,
      setNegativeOpen: () => {},
      panelMode: 'form',
      setPanelMode: () => {},
    },
    form: {
      form: {
        prompt: '雨夜街景',
        negative: '',
        presetId: 'flux2-klein-4b',
        width: 1024,
        height: 1024,
        steps: 4,
        cfg: 0,
        seed: '',
        count: 1,
        reference: { path: 'imagen-output/job-1/7.png', url: '/imagen-api/file?path=7.png' },
        strength: 0.6,
      },
      patchForm: (partial) => patched.push(partial),
      selectPreset: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      sizeTiers: [1024],
      selectedTier: 1024,
      applyTier: () => {},
      applyCustomSize: () => {},
      applyCfg: () => {},
      resetSeed: () => {},
      negativeActive: false,
      negativeHint: '',
      refineGroups: [],
      refineSource: '',
      enhancing: false,
      enhance: () => {},
      translating: false,
      translate: () => {},
      toggleRefine: () => {},
      useInspiration: () => {},
      englishPromptHint: false,
      reference: { path: 'imagen-output/job-1/7.png', url: '/imagen-api/file?path=7.png' },
      strength: 0.6,
      referenceSupported: false,
      referenceBlocked: true,
      applyStrength: (value) => patched.push({ strength: Number(value) }),
      removeReference: () => patched.push({ reference: null }),
    },
    actions: { sending: false, generate: () => {} },
  })
  client.unmount()

  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('当前模型不支持垫图重绘，请切换模型或移除参考图'), '置灰槽位要写明下一步')
  assertStructure('reference-unsupported', tree, {
    required: { 'ofs-reference': 1, 'ofs-reference-warn': 1, 'ofs-reference-range': 1 },
    forbidden: ['ofs-reference-hint'],
  })
  const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
  assert.equal(range.props.disabled, true, '不支持垫图时滑块禁用')
  range.props.onChange({ target: { value: '0.7' } })
  assert.deepEqual(patched.at(-1), { strength: 0.7 }, '禁用态滑块仍按契约更新表单（便于切回支持模型后继续用）')
  const remove = findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-reference-remove'),
  )[0]
  remove.props.onClick()
  assert.deepEqual(patched.at(-1), { reference: null }, '移除按钮应清空参考图')
})

// 手动切回不支持垫图的预设后，生成被拦下并 toast 说明；这里直接驱动组合层 hook，
// 避免依赖假渲染器对嵌套组件本地状态的模拟（顶部栏模型卡属于内嵌组件）。
await check('渲染：参考图与预设能力不匹配时生成被拦下（useStudio）', async () => {
  const flux = {
    ...preset,
    id: 'flux2-klein-4b',
    label: 'Klein 4B',
    short: 'Klein 4B',
    family: 'FLUX.2',
    supportsImg2Img: false,
    supportsNegative: false,
    negativeHint: '',
  }
  const lightning = { ...preset, supportsImg2Img: true }
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [flux, lightning], defaultPreset: 'flux2-klein-4b' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-new', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-studio-harness' }, String(studio.form.referenceBlocked))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()

    // 以不支持垫图的 flux 启动：设为参考图会自动切到 sdxl-lightning。
    assert.equal(latest.studio.form.form.presetId, 'flux2-klein-4b', '初始预设应来自 state.defaultPreset')
    const applied = latest.studio.form.applyReference({ image: historyItem.images[0], item: historyItem })
    await client.rerenderRaw()
    assert.equal(applied.ok, true)
    assert.equal(applied.switchedPreset && applied.switchedPreset.id, 'sdxl-lightning', '应回退到支持垫图的预设')
    assert.equal(latest.studio.form.form.reference.path, historyItem.images[0].path, '参考图路径来自作品 image.path')
    assert.equal(latest.studio.form.referenceBlocked, false)

    // 手动切回不支持垫图的预设：不强制改回，而是把状态标成阻塞并给出提示。
    latest.studio.form.selectPreset(flux)
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.presetId, 'flux2-klein-4b')
    assert.equal(latest.studio.form.referenceBlocked, true, '参考图 + 不支持垫图的预设应标记阻塞')

    // 提交被拦下：不发生成请求，toast 说明原因与下一步。
    const before = client.requests.filter((item) => item.path === '/imagen-api/generate').length
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(
      client.requests.filter((item) => item.path === '/imagen-api/generate').length,
      before,
      '必须拦下生成，不能悄悄退回文生图',
    )
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已拦下本次生成'),
      '拦下生成要 toast 说明',
    )

    // 移除参考图后回到正常文生图：同样配置下可以提交。
    latest.studio.form.removeReference()
    await client.rerenderRaw()
    assert.equal(latest.studio.form.referenceBlocked, false)
    latest.studio.form.patchForm({ prompt: '雨夜街景' })
    await client.rerenderRaw()
    await latest.studio.actions.generate()
    await client.settle()
    const submitted = client.requests.filter((item) => item.path === '/imagen-api/generate').pop()
    assert.ok(submitted, '移除参考图后应能继续文生图')
    assert.ok(!('reference' in submitted.body))
  } finally {
    client.unmount()
  }
})

// 专用局部重绘模型（inpaintOnly）：缺蒙版时拦下生成并说明，补上参考图 + 蒙版后可正常提交。
const MASK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

await check('渲染：专用局部重绘模型缺蒙版时拦下生成，补蒙版后按 reference.mask 提交', async () => {
  const native = {
    ...preset,
    id: 'sdxl-inpaint',
    label: 'SDXL Inpaint',
    short: 'Inpaint',
    supportsImg2Img: true,
    supportsInpaint: true,
    inpaintOnly: true,
  }
  const lightning = { ...preset, supportsImg2Img: true }
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [lightning, native], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-native', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-native-harness' }, String(studio.form.maskRequiredBlocked))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    latest.studio.form.patchForm({ prompt: '局部改成红灯笼' })
    await client.rerenderRaw()

    // 切到专用模型：没有参考图 / 蒙版时标记阻塞。
    latest.studio.form.selectPreset(native)
    await client.rerenderRaw()
    assert.equal(latest.studio.form.inpaintOnly, true)
    assert.equal(latest.studio.form.maskRequiredBlocked, true, '专用模型缺蒙版应标记阻塞')

    // 生成被拦下：不发生成请求，toast 说明需要蒙版。
    let before = client.requests.filter((item) => item.path === '/imagen-api/generate').length
    const blocked = await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(blocked, false, '被拦下时 generate 返回 false')
    assert.equal(
      client.requests.filter((item) => item.path === '/imagen-api/generate').length,
      before,
      '缺蒙版时不得提交生成请求',
    )
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('局部重绘专用模型'),
      '拦下时要 toast 说明是专用模型',
    )

    // 补上参考图与蒙版：阻塞解除，提交体带 reference.mask。
    const applied = latest.studio.form.applyReference({ image: historyItem.images[0], item: historyItem })
    assert.equal(applied.ok, true)
    await client.rerenderRaw()
    const maskResult = latest.studio.form.applyMask({ data: MASK_PNG_B64, coverage: 0.2 })
    assert.equal(maskResult.ok, true, JSON.stringify(maskResult))
    await client.rerenderRaw()
    assert.equal(latest.studio.form.maskRequiredBlocked, false, '有蒙版后不再阻塞')
    before = client.requests.filter((item) => item.path === '/imagen-api/generate').length
    await latest.studio.actions.generate()
    await client.settle()
    const submitted = client.requests.filter((item) => item.path === '/imagen-api/generate').pop()
    assert.equal(
      client.requests.filter((item) => item.path === '/imagen-api/generate').length,
      before + 1,
      '补上蒙版后应正常提交',
    )
    assert.ok(submitted && submitted.body.reference, '提交体应带参考图')
    assert.equal(submitted.body.reference.mask, MASK_PNG_B64, '提交体应带裸 base64 蒙版')
  } finally {
    client.unmount()
  }
})
// 旧宿主兼容：/state.presets 没有 supportsImg2Img 时按不支持处理，但纯文生图不受任何影响。
await check('渲染：旧宿主没有 supportsImg2Img 时文生图不回归', async () => {
  const responses = {
    '/imagen-api/state': readyState,
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-old', status: 'queued' },
  }

  // 1) 纯文生图照常提交。
  let client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    const tree = await client.mountRaw(client.components.Studio, { initialPrompt: '雨夜街景' })
    findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-generate'),
    )[0].props.onClick()
    await client.settle()
    const submitted = client.requests.filter((item) => item.path === '/imagen-api/generate').pop()
    assert.ok(submitted, '旧宿主下文生图仍应照常提交')
    assert.ok(!('reference' in submitted.body), '旧宿主文生图请求体不带 reference')
  } finally {
    client.unmount()
  }

  // 2) 「以此图重绘」明确提示宿主不支持，且不把参考图写进表单。
  client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery' })
    const trigger = findNodes(
      tree,
      (node) => node.type === 'button'
        && node.props?.className === 'ofs-gallery-action'
        && collectText(node).join('').includes('以此图重绘'),
    )[0]
    trigger.props.onClick()
    tree = await client.rerenderRaw()
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('当前宿主版本不支持垫图重绘'), '旧宿主要明确提示不支持垫图')
    assertStructure('legacy-host', tree, { required: { 'ofs-gallery': 1 }, forbidden: ['ofs-reference'] })
  } finally {
    client.unmount()
  }
})

// 大图预览里的「以此图重绘」：与卡片动作一致，点完收起放大层并切回创作视图。
await check('渲染：大图预览里的以此图重绘', async () => {
  const img2imgPreset = { ...preset, supportsImg2Img: true }
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': { ...readyState, presets: [img2imgPreset], defaultPreset: 'sdxl-lightning' },
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    const zoomButton = findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-glass-btn')
        && node.props['aria-label'] === '点击查看原图',
    )[0]
    assert.ok(zoomButton, '舞台应有查看原图入口')
    zoomButton.props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('lightbox-open', tree, { required: { 'ofs-lightbox': 1, 'ofs-lightbox-action': 1 }, forbidden: [] })
    assert.ok(collectText(tree).join(' | ').includes('以此图重绘'), '大图预览应提供「以此图重绘」')

    findNodes(tree, (node) => node.type === 'button' && node.props?.className === 'ofs-lightbox-action')[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('lightbox-reference', tree, {
      required: { 'ofs-reference': 1 },
      forbidden: ['ofs-lightbox'],
    })
    assert.ok(collectText(tree).join(' | ').includes('已设为参考图'))
  } finally {
    client.unmount()
  }
})

// ── 局部重绘（Inpaint）：Stage 涂抹入口 + canvas 蒙版层 + 请求体透传 ──

// 涂抹入口按模型能力显隐：支持时出现「局部涂抹」；不支持时只给说明，已涂蒙版保留不静默丢弃。
await check('渲染：局部涂抹入口按模型能力显隐，工具栏可键盘 / 触控使用', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const selected = { image: historyItem.images[0], item: historyItem }
  const reference = {
    path: historyItem.images[0].path,
    url: historyItem.images[0].url,
    width: 1024,
    height: 1024,
  }
  // Stage 的测试替身：表单域只提供局部涂抹相关的字段与动作。
  const stageProps = (form) => ({
    t,
    ui: { zoom: false, setZoom: () => {}, copyPath: () => {}, showToast: () => {} },
    compute: { activeJob: null },
    form: {
      useInspiration: () => {},
      reference,
      mask: null,
      inpaintSupported: true,
      applyMask: () => ({ ok: true }),
      clearMask: () => {},
      ...form,
    },
    library: { selected, isFavorite: () => false, toggleFavorite: () => {} },
    actions: { iterate: () => {}, reroll: () => {}, referenceImage: () => {} },
  })
  try {
    // 1) 支持局部重绘：入口出现，未涂抹时明确说明仍按整图重绘。
    let tree = await client.mountRaw(client.components.Stage, stageProps({}))
    const toggle = findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(/\s+/).includes('ofs-mask-toggle'),
    )[0]
    assert.ok(toggle, '参考图 + 支持 Inpaint 时应有「局部涂抹」入口')
    assert.ok(collectText(toggle).join('').includes('局部涂抹'))
    assert.equal(toggle.props['aria-pressed'], false)
    assert.ok(Number(toggle.props.style.minHeight) >= 44, '涂抹入口热区高度不小于 44px')
    assert.ok(Number(toggle.props.style.minWidth) >= 44, '涂抹入口热区宽度不小于 44px')
    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('还没有涂抹区域'), '未涂抹时说明生成仍按整图重绘')
    assert.ok(!('ofs-mask-editor' in collectClasses(tree)), '未打开涂抹态时不挂载画布')

    // 打开涂抹态：canvas、光标圈与工具栏齐全，热区不小于 44px。
    toggle.props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('mask-editor', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-mask-tools': 1, 'ofs-mask-cursor': 1, 'ofs-mask-guide': 1 },
      forbidden: ['ofs-mask-toggle', 'ofs-print'],
    })
    const canvas = findNodes(tree, (node) => node.type === 'canvas')[0]
    assert.ok(canvas, '涂抹态应挂载 canvas 蒙版层')
    assert.equal(canvas.props.role, 'application')
    assert.equal(canvas.props.tabIndex, 0, '画布可键盘聚焦')
    assert.equal(typeof canvas.props.onPointerDown, 'function', '画布支持指针 / 触控绘制')
    assert.equal(typeof canvas.props.onKeyDown, 'function', '画布支持键盘绘制')
    assert.ok(
      typeof canvas.props['aria-label'] === 'string' && canvas.props['aria-label'].includes('方向键'),
      '画布要给出键盘操作说明',
    )
    const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    assert.ok(range, '涂抹态应提供画笔大小滑块')
    assert.equal(range.props.min, MASK_BRUSH.min)
    assert.equal(range.props.max, MASK_BRUSH.max)
    assert.equal(range.props.step, MASK_BRUSH.step)
    assert.equal(range.props.value, MASK_BRUSH.default)
    for (const label of ['橡皮擦', '清空蒙版', '反选区域', '完成涂抹']) {
      const button = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes(label))[0]
      assert.ok(button, `涂抹工具栏缺少「${label}」`)
      assert.ok(Number(button.props.style.minHeight) >= 44, `「${label}」热区高度应不小于 44px`)
    }
    // 完成涂抹收起画布，已写入表单的蒙版不受影响。
    findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(/\s+/).includes('ofs-mask-close'),
    )[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('mask-editor-closed', tree, { required: { 'ofs-mask-toggle': 1 }, forbidden: ['ofs-mask-editor'] })

    // 少步快速模型：涂抹态额外给出「换多步模型」的弱提示；多步模型不显示该提示。
    tree = await client.mountRaw(client.components.Stage, stageProps({ activePreset: { steps: 4 } }))
    findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(/\s+/).includes('ofs-mask-toggle'),
    )[0].props.onClick()
    tree = await client.rerenderRaw()
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('一次只改一个物体'), '涂抹态要给出蒙版操作要点')
    assert.ok(text.includes('少步快速模型'), '少步模型要提示换多步模型')
    tree = await client.mountRaw(client.components.Stage, stageProps({ activePreset: { steps: 25 } }))
    findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(/\s+/).includes('ofs-mask-toggle'),
    )[0].props.onClick()
    tree = await client.rerenderRaw()
    text = collectText(tree).join(' | ')
    assert.ok(!text.includes('少步快速模型'), '多步模型不应出现换模型提示')

    // 2) 已涂抹：入口旁给出覆盖率读数。
    tree = await client.mountRaw(client.components.Stage, stageProps({
      mask: { data: 'AAAA', coverage: 0.12, digest: 'd-1' },
    }))
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('已涂抹 12%'), '已涂抹时显示覆盖率读数')

    // 3) 模型不支持局部重绘：不出现涂抹入口，显示能力说明；已涂蒙版保留并说明。
    tree = await client.mountRaw(client.components.Stage, stageProps({ inpaintSupported: false }))
    assert.ok(!('ofs-mask-toggle' in collectClasses(tree)), '不支持 Inpaint 时不得出现涂抹入口')
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('当前模型不支持局部重绘'), '不支持时要明确提示能力')
    assert.ok(!text.includes('已涂抹的蒙版会保留'), '没有蒙版时不需要保留提示')

    tree = await client.mountRaw(client.components.Stage, stageProps({
      inpaintSupported: false,
      mask: { data: 'AAAA', coverage: 0.12, digest: 'd-1' },
    }))
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('已涂抹的蒙版会保留'), '切到不支持模型时蒙版保留并说明，不静默丢弃')
  } finally {
    client.unmount()
  }
})

// 涂抹导出的 PNG base64 随 reference.mask 提交；能力切换与各入口清理按约定生效。
await check('渲染：局部涂抹导出后按 reference.mask 提交，切换能力与清理入口', async () => {
  const inpaintPreset = { ...preset, supportsImg2Img: true, supportsInpaint: true }
  const flux = {
    ...preset,
    id: 'flux2-klein-4b',
    label: 'Klein 4B',
    short: 'Klein 4B',
    family: 'FLUX.2',
    supportsImg2Img: false,
    supportsInpaint: false,
    supportsNegative: false,
    negativeHint: '',
  }
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [inpaintPreset, flux], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-inpaint', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({
      t: client.internals.i18n.fallbackTranslate('zh'),
      initialPrompt: '雨夜街景',
    })
    latest.studio = studio
    return h('div', { className: 'ofs-studio-harness' }, String(studio.form.inpaintSupported))
  }
  // canvas.toDataURL('image/png') 的真实输出形态：带 data URL 前缀的黑底白字 PNG。
  const maskPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.presetId, 'sdxl-lightning')
    assert.equal(latest.studio.form.inpaintSupported, true, 'SDXL 预设应支持局部重绘')
    assert.equal(latest.studio.form.mask, null)

    // 以此图重绘 → 涂抹（画布导出 data URL + 覆盖率）→ 写进表单 reference.mask。
    const applied = latest.studio.form.applyReference({ image: historyItem.images[0], item: historyItem })
    assert.equal(applied.ok, true)
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.reference.path, historyItem.images[0].path)
    // 空蒙版 / 超限蒙版在进入表单前就被拦下，不产生半成品字段。
    assert.deepEqual(latest.studio.form.applyMask({ data: maskPng, coverage: 0 }), { ok: false, reason: 'empty' })
    const huge = 'A'.repeat(Math.ceil((LIMITS.mask.maxBytes + 1) / 3) * 4)
    assert.equal(latest.studio.form.applyMask({ data: huge, coverage: 0.5 }).reason, 'too_large')
    const accepted = latest.studio.form.applyMask({ data: `data:image/png;base64,${maskPng}`, coverage: 0.05 })
    assert.deepEqual(accepted, { ok: true })
    await client.rerenderRaw()
    let formNow = latest.studio.form
    assert.equal(formNow.form.reference.mask.data, maskPng, '表单里的蒙版是去掉前缀的裸 base64')
    assert.ok(formNow.form.reference.mask.digest, '表单保存蒙版指纹供脏判定使用')
    assert.equal(formNow.mask.coverage, 0.05)
    assert.equal(formNow.dirty, true, '涂抹属于未提交的手动修改')
    assert.equal(formNow.maskBlocked, false)

    // 提交：请求体 reference.mask 与参考图一起下发，且不再带缩略图 url。
    await latest.studio.actions.generate()
    await client.settle()
    const submitted = client.requests.filter((item) => item.path === '/imagen-api/generate').pop()
    assert.ok(submitted, '应提交生成请求')
    assert.deepEqual(submitted.body.reference, {
      path: historyItem.images[0].path,
      strength: LIMITS.strength.default,
      mask: maskPng,
    }, '请求体应带裸 base64 蒙版')
    // 提交成功后蒙版保留（可连续迭代），表单回到干净状态。
    await client.rerenderRaw()
    formNow = latest.studio.form
    assert.equal(formNow.mask.data, maskPng, '提交后保留蒙版方便连续迭代')
    assert.equal(formNow.dirty, false, '提交成功即回到干净基准（含蒙版指纹）')

    // 切到不支持 Inpaint 的模型：蒙版保留、标记阻塞，提交体不带 mask（按整图重绘）。
    latest.studio.form.selectPreset(flux)
    await client.rerenderRaw()
    formNow = latest.studio.form
    assert.equal(formNow.inpaintSupported, false)
    assert.equal(formNow.maskBlocked, true, '不支持时标记蒙版阻塞但不丢弃')
    assert.equal(formNow.mask.data, maskPng)
    assert.equal(formNow.applyMask({ data: maskPng, coverage: 0.2 }).reason, 'unsupported', '不把蒙版写进不支持 Inpaint 的模型')
    const gated = formNow.buildBody()
    assert.equal(gated.reference.path, historyItem.images[0].path, '参考图仍按整图重绘提交')
    assert.ok(!('mask' in gated.reference), '不支持 Inpaint 时请求体不带 mask')

    // 切回支持模型：蒙版仍在，可继续提交。
    latest.studio.form.selectPreset(inpaintPreset)
    await client.rerenderRaw()
    formNow = latest.studio.form
    assert.equal(formNow.inpaintSupported, true)
    assert.equal(formNow.maskBlocked, false)
    assert.equal(formNow.mask.data, maskPng, '切回支持模型后蒙版可继续使用')

    // 清空蒙版：字段消失，回到整图 img2img。
    assert.equal(latest.studio.form.clearMask(), true)
    await client.rerenderRaw()
    formNow = latest.studio.form
    assert.equal(formNow.mask, null)
    assert.equal(formNow.dirty, true, '清空蒙版同样算未提交修改')
    assert.ok(!('mask' in formNow.buildBody().reference), '清空后请求体不带 mask')

    // 各入口清理：换参考图 / 移除参考图 / 回填 / 新建创作都不能残留蒙版。
    latest.studio.form.applyMask({ data: maskPng, coverage: 0.2 })
    latest.studio.form.applyReference({ image: historyItem.images[1], item: historyItem })
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.reference.mask, undefined, '换参考图清空蒙版')
    latest.studio.form.applyMask({ data: maskPng, coverage: 0.2 })
    latest.studio.form.removeReference()
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.reference, null, '移除参考图同时清空蒙版')
    latest.studio.form.applyReference({ image: historyItem.images[0], item: historyItem })
    latest.studio.form.applyMask({ data: maskPng, coverage: 0.2 })
    latest.studio.form.newCreation()
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.reference, null, '新建创作清空参考图与蒙版')
    assert.equal(latest.studio.form.mask, null)
    latest.studio.form.applyReference({ image: historyItem.images[0], item: historyItem })
    latest.studio.form.applyMask({ data: maskPng, coverage: 0.2 })
    latest.studio.form.applyRecall({ prompt: '回填的作品', reference: null }, { image: historyItem.images[0], item: historyItem })
    await client.rerenderRaw()
    assert.equal(latest.studio.form.mask, null, '回填参数清空上一轮蒙版')
  } finally {
    client.unmount()
  }
})

// ── 对话确认卡 v2（0.10.0：摘要优先 / 张数 / 模型建议 / 带入参数面板 / 通用澄清） ──

/** 按类名收集节点：ChatPanel 用例只看稳定的结构类名，不锁内部组件拆分。 */
const findClass = (tree, className) => findNodes(
  tree,
  (node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes(className),
)

/** 按类名取第一个文本域（提示词 / 排除项共用）。 */
const textareaOfClass = (tree, className) => findNodes(
  tree,
  (node) => node.type === 'textarea'
    && typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes(className),
)[0] || null

/**
 * ChatPanel 的测试替身：领域对象最小化，动作只记录不执行。
 * 返回 client 供「点示例后重渲染」这类需要本地状态落地的用例继续驱动。
 */
async function mountChatPanel(options = {}) {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const calls = {
    edits: [],
    generated: [],
    handed: [],
    modes: [],
    toasts: [],
    resolved: [],
    locked: [],
    patches: [],
    applied: [],
    interpreted: [],
    cleared: [],
  }
  const chat = {
    messages: options.messages ?? [],
    interpreting: Boolean(options.interpreting),
    interpret: (text) => calls.interpreted.push(text),
    updateIntentField: (id, field, value) => calls.edits.push({ id, field, value }),
    updateIntent: (id, patch) => calls.edits.push({ id, patch }),
    generateIntent: (message) => calls.generated.push(message),
    handoffIntent: (message) => {
      calls.handed.push(message)
      return options.handoffOk !== false
    },
    toggleIntentLockSeed: (id) => calls.locked.push(id),
    canLockSeed: options.canLockSeed !== false,
    resolveClarify: (id, option) => calls.resolved.push({ id, option }),
    newChat: () => calls.cleared.push(true),
  }
  const t = client.internals.i18n.fallbackTranslate(options.locale ?? 'zh')
  try {
    const tree = await client.mountRaw(client.components.ChatPanel, {
      t,
      ui: {
        panelMode: 'chat',
        setPanelMode: (mode) => calls.modes.push(mode),
        showToast: (text) => calls.toasts.push(text),
      },
      form: {
        patchForm: (patch) => calls.patches.push(patch),
        negativeActive: options.negativeActive === true,
        ...(options.form ?? {}),
      },
      chat,
      library: { openMessage: () => {} },
      actions: { sending: Boolean(options.sending) },
    })
    return { client, tree, calls, t }
  } catch (error) {
    client.unmount()
    throw error
  }
}

await check('渲染：确认卡摘要优先、张数分段、模型建议与带入参数面板', async () => {
  const message = {
    id: 1,
    role: 'assistant',
    kind: 'intent',
    prompt: 'rainy night city street, wet pavement reflecting neon signs',
    summary: '雨夜城市街景，湿润路面倒映霓虹招牌',
    ratioId: '16:9',
    negative: 'blurry, low quality',
    count: 2,
    lockSeed: false,
    clarify: null,
    modelHint: { presetId: 'flux2-klein-4b', reason: '轻量快速，适合草稿' },
    source: 'model',
  }
  const mounted = await mountChatPanel({ messages: [message], negativeActive: true })
  try {
    const { tree, calls, t } = mounted
    const text = collectText(tree).join(' | ')

    // 摘要优先：中文摘要排在英文提示词之前；0.10.0 起不再有风格行。
    assert.ok(text.includes('雨夜城市街景，湿润路面倒映霓虹招牌'), '[intent] 应展示中文摘要')
    assert.ok(text.includes('中文摘要'), '[intent] 摘要应有中文标签')
    assert.ok(
      text.indexOf('雨夜城市街景，湿润路面倒映霓虹招牌') < text.indexOf('英文提示词'),
      '[intent] 中文摘要应排在英文提示词之前',
    )
    assert.ok(text.includes('可直接修改后再生成'), '[intent] 应提示可在卡上直接微调')
    assert.ok(text.includes('更合适的模型：FLUX.2 Klein 4B（轻量快速，适合草稿）'), '[intent] 模型建议应带模型名与理由')
    assert.ok(text.includes('16:9'), '[intent] 元信息行应显示比例')
    assert.ok(!text.includes('风格'), '[intent] 0.10.0 起确认卡不再有风格行')

    // 英文提示词 / 排除项都可编辑，长度受契约限制。
    const promptArea = textareaOfClass(tree, 'ofs-intent-prompt')
    assert.ok(promptArea, '[intent] 缺少提示词文本域')
    assert.equal(promptArea.props.value, message.prompt)
    assert.equal(promptArea.props.maxLength, LIMITS.prompt.maxChars)
    assert.equal(promptArea.props['aria-label'], '英文提示词')
    const negativeArea = textareaOfClass(tree, 'ofs-intent-negative')
    assert.ok(negativeArea, '[intent] 负向词可用时应渲染排除项文本域')
    assert.equal(negativeArea.props.value, 'blurry, low quality')
    assert.equal(negativeArea.props.maxLength, LIMITS.negativePrompt.maxChars)

    // 张数：四格分段，当前值来自消息；点击把字段与新值交回 useChatThread。
    const qty = findClass(tree, 'ofs-intent-qty')
    assert.equal(qty.length, 1)
    assert.equal(qty[0].props.role, 'group')
    assert.equal(qty[0].props['aria-label'], '生成张数')
    const qtyOptions = findClass(tree, 'ofs-intent-qty-option')
    assert.equal(qtyOptions.length, 4, '[intent] 生成张数应为 1~4 四格')
    assert.deepEqual(qtyOptions.map((node) => collectText(node).join('')), ['1', '2', '3', '4'])
    assert.deepEqual(
      qtyOptions.map((node) => node.props['aria-pressed']),
      [false, true, false, false],
      '消息 count=2 时第二格高亮',
    )
    qtyOptions[2].props.onClick()
    assert.deepEqual(calls.edits, [{ id: 1, field: 'count', value: 3 }], '[intent] 点张数应把字段与值交回 useChatThread')

    // 行内编辑回调带消息 id 与字段名；白名单校验与契约裁剪由 useChatThread 再做一次。
    promptArea.props.onChange({ target: { value: 'edited rainy street' } })
    negativeArea.props.onChange({ target: { value: 'blurry' } })
    assert.deepEqual(calls.edits.slice(1), [
      { id: 1, field: 'prompt', value: 'edited rainy street' },
      { id: 1, field: 'negative', value: 'blurry' },
    ])

    // 主按钮「按此生成」提交当前消息；次级动作把确认卡写进参数面板并切模式 + 轻提示。
    const goButton = findClass(tree, 'ofs-intent-go')[0]
    assert.ok(goButton, '[intent] 缺少「按此生成」主按钮')
    assert.equal(collectText(goButton).join(''), '按此生成')
    assert.equal(goButton.props.disabled, false)
    goButton.props.onClick()
    assert.equal(calls.generated.length, 1, '[intent] 点「按此生成」应把确认卡交给 generateIntent')
    assert.equal(calls.generated[0].prompt, message.prompt)

    const handoffButton = findClass(tree, 'ofs-intent-handoff')[0]
    assert.ok(handoffButton, '[intent] 缺少「带入参数面板」次级动作')
    assert.equal(collectText(handoffButton).join(''), '带入参数面板')
    handoffButton.props.onClick()
    assert.equal(calls.handed.length, 1, '[intent] 点次级动作应把确认卡交给 handoffIntent')
    assert.deepEqual(calls.modes, ['form'], '[intent] 带入成功后应切回参数表单')
    assert.deepEqual(calls.toasts, [t('studio.chat.intent.handoffDone')], '[intent] 带入成功应给轻提示')

    // 「沿用上张构图（锁定种子）」保持：默认关闭、点一下把这张卡的 id 交回 hook。
    const lockBox = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'checkbox')[0]
    assert.ok(lockBox, '[intent] 缺少「沿用上张构图」开关')
    assert.equal(lockBox.props.checked, false, '[intent] 锁种开关默认关闭')
    lockBox.props.onChange()
    assert.deepEqual(calls.locked, [1])

    assertStructure('intent-card', tree, {
      required: {
        'ofs-intent': 1,
        'ofs-intent-title': 1,
        'ofs-intent-summary': 1,
        'ofs-intent-summary-label': 1,
        'ofs-intent-edit-hint': 1,
        'ofs-intent-field': 2,
        'ofs-intent-prompt': 1,
        'ofs-intent-negative': 1,
        'ofs-intent-meta': 1,
        'ofs-intent-model-hint': 1,
        'ofs-intent-qty': 1,
        'ofs-intent-qty-option': 4,
        'ofs-intent-lock': 1,
        'ofs-intent-actions': 1,
        'ofs-intent-go': 1,
        'ofs-intent-handoff': 1,
      },
      forbidden: ['ofs-intent-question', 'ofs-intent-clarify', 'ofs-intent-note', 'ofs-suggestions'],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：排除项按 negativeActive 显隐，本地兜底与空提示词状态', async () => {
  const base = {
    id: 2,
    role: 'assistant',
    kind: 'intent',
    prompt: 'rainy night city street',
    summary: '雨夜城市街景',
    ratioId: '',
    negative: 'blurry',
    count: 1,
    clarify: null,
    modelHint: null,
    source: 'model',
  }

  // 负向词不可用（CFG=0 的极速模型 / FLUX.2 等）：整行排除项与「排除项」文案都不渲染。
  const hidden = await mountChatPanel({ messages: [base], negativeActive: false })
  try {
    const text = collectText(hidden.tree).join(' | ')
    assert.ok(!text.includes('排除项'), '[intent] 负向词不可用时不应出现排除项文案')
    assertStructure('intent-negative-hidden', hidden.tree, {
      required: { 'ofs-intent-field': 1, 'ofs-intent-prompt': 1 },
      forbidden: ['ofs-intent-negative'],
    })
    // 没有模型建议时不渲染弱提示行。
    assert.equal(findClass(hidden.tree, 'ofs-intent-model-hint').length, 0)
  } finally {
    hidden.client.unmount()
  }

  // 本地兜底：prompt 与 summary 都是原文，不重复渲染摘要，改为标注「模型未响应」。
  const local = await mountChatPanel({
    messages: [{ ...base, prompt: '雨夜街景', summary: '雨夜街景', negative: '', source: 'local' }],
    negativeActive: false,
  })
  try {
    const text = collectText(local.tree).join(' | ')
    assert.ok(!text.includes('中文摘要'), '[intent] 原文兜底时不应重复显示摘要')
    assert.ok(text.includes('模型未响应'), '[intent] 本地兜底应说明来源')
    assertStructure('intent-local', local.tree, {
      required: { 'ofs-intent-note': 1 },
      forbidden: ['ofs-intent-summary', 'ofs-intent-summary-label'],
    })
  } finally {
    local.client.unmount()
  }

  // 提示词为空：主按钮与次级动作都禁用，避免一次注定被拒的宿主往返。
  const blank = await mountChatPanel({ messages: [{ ...base, prompt: '   ' }], negativeActive: true })
  try {
    assert.equal(findClass(blank.tree, 'ofs-intent-go')[0].props.disabled, true, '[intent] 空提示词时不应提交')
    assert.equal(findClass(blank.tree, 'ofs-intent-handoff')[0].props.disabled, true, '[intent] 空提示词时不能带入面板')
  } finally {
    blank.client.unmount()
  }
})

await check('渲染：通用澄清卡（问题 + 2~4 选项 + 先按当前设置）', async () => {
  const message = {
    id: 7,
    role: 'assistant',
    kind: 'intent',
    prompt: 'draft rainy street',
    summary: '',
    ratioId: '',
    negative: '',
    count: 1,
    clarify: { question: '想要横版还是竖版？', options: ['横版', '竖版'] },
    modelHint: null,
    source: 'model',
  }
  const mounted = await mountChatPanel({ messages: [message] })
  try {
    const { tree, calls } = mounted
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('想先确认一下'), '[clarify] 缺少标题')
    assert.ok(text.includes('想要横版还是竖版？'), '[clarify] 缺少问题')
    assert.ok(text.includes('先按当前设置'), '[clarify] 缺少「先按当前设置」')
    assert.ok(!text.includes('生成确认'), '[clarify] 澄清卡不应显示确认卡标题')

    const options = findClass(tree, 'ofs-suggestion')
    assert.deepEqual(
      options.map((node) => collectText(node).join('')),
      ['横版', '竖版', '先按当前设置'],
      '[clarify] 选项按钮顺序：宿主选项在前，「先按当前设置」在最后',
    )
    options[0].props.onClick()
    assert.deepEqual(calls.resolved, [{ id: 7, option: '横版' }], '[clarify] 点选项应把选项交回 resolveClarify')
    options[2].props.onClick()
    assert.deepEqual(calls.resolved.at(-1), { id: 7, option: '' }, '[clarify] 「先按当前设置」用空串表示只清澄清')

    assertStructure('clarify-card', tree, {
      required: {
        'ofs-intent': 1,
        'ofs-intent-clarify': 1,
        'ofs-intent-question': 1,
        'ofs-suggestions': 1,
        'ofs-suggestion': 3,
      },
      forbidden: ['ofs-intent-go', 'ofs-intent-handoff', 'ofs-intent-qty', 'ofs-intent-prompt', 'ofs-intent-negative'],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：空态示例只填对话草稿，不改参数表单', async () => {
  const mounted = await mountChatPanel({ messages: [] })
  try {
    const { client, calls, t } = mounted
    const examples = findClass(mounted.tree, 'ofs-chat-example')
    assert.equal(examples.length, 5, '[empty] 空态应给出五个灵感示例')
    examples[0].props.onClick()
    const tree = await client.rerenderRaw()
    const composer = findNodes(tree, (node) => node.type === 'textarea')[0]
    assert.equal(composer.props.value, t('studio.inspire.1'), '[empty] 点示例应把示例文案填进对话草稿')
    assert.equal(calls.patches.length, 0, '[empty] 点示例不应越过确认卡直接改参数表单')
  } finally {
    mounted.client.unmount()
  }
})

// 新建对话：清空线程与输入草稿；空线程时按钮禁用（没有可开启的新上下文）。
await check('渲染：新建对话清空线程与输入草稿', async () => {
  const mounted = await mountChatPanel({ messages: [{ id: 1, role: 'user', text: '画一只橘猫' }] })
  try {
    const { client, calls, t } = mounted
    const button = findClass(mounted.tree, 'ofs-chat-new')[0]
    assert.ok(button, '[new-chat] 缺少新建对话按钮')
    assert.equal(collectText(button).join(''), t('studio.chat.newChat'))
    assert.equal(collectText(button).join(''), '新建对话')
    assert.equal(button.props.disabled, false, '有消息时按钮可用')
    // 先在输入区写点草稿：新建对话后草稿也应清空。
    const composer = findNodes(mounted.tree, (node) => node.type === 'textarea')[0]
    composer.props.onChange({ target: { value: '还没发出去的话' } })
    const tree = await client.rerenderRaw()
    assert.equal(findNodes(tree, (node) => node.type === 'textarea')[0].props.value, '还没发出去的话')
    findClass(tree, 'ofs-chat-new')[0].props.onClick()
    assert.deepEqual(calls.cleared, [true], '点击应把「新建对话」交给 useChatThread')
    const after = await client.rerenderRaw()
    assert.equal(findNodes(after, (node) => node.type === 'textarea')[0].props.value, '', '新建对话应清空输入草稿')
  } finally {
    mounted.client.unmount()
  }

  const empty = await mountChatPanel({ messages: [] })
  try {
    const button = findClass(empty.tree, 'ofs-chat-new')[0]
    assert.equal(button.props.disabled, true, '空线程时按钮禁用')
    assert.ok(!collectText(empty.tree).join(' | ').includes('清空对话'), '旧「清空对话」文案应已移除')
  } finally {
    empty.client.unmount()
  }
})

// 意图 v2 的真实状态流转：直接挂载 useChatThread，断言请求参数、消息字段、
// 张数钳制、负向词门控、多轮 history、通用澄清与带入参数面板。
await check('渲染：意图 v2 状态流（cfg / history / 张数 / 负向词门控 / 澄清 / 带入面板）', async () => {
  const responses = {
    '/imagen-api/intent': {
      ok: true,
      source: 'model',
      prompt: 'rainy night city street, wet pavement reflecting neon signs',
      summary: '雨夜城市街景，湿润路面倒映霓虹招牌',
      ratioId: '16:9',
      negative: 'blurry, low quality',
      clarify: null,
      modelHint: { presetId: 'flux2-klein-4b', reason: '轻量快速，适合草稿' },
    },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const { useChatThread } = client.hooks
  const t = client.internals.i18n.fallbackTranslate('zh')
  const latest = { chat: null }
  const calls = { generates: [], patches: [], applied: [] }
  const form = {
    form: { negative: 'blurry', seed: '', presetId: 'sdxl-lightning', cfg: 7 },
    negativeActive: true,
    patchForm: (patch) => calls.patches.push(patch),
    applyIntent: (message) => { calls.applied.push(message); return true },
  }
  function Harness(props) {
    const chat = useChatThread({
      t,
      isEn: false,
      alive: async (promise) => promise,
      state: { lastJob: null },
      form,
      generate: async (overrides) => calls.generates.push(overrides),
    })
    props.latest.chat = chat
    React.useEffect(() => {
      chat.interpret('画一张横版雨夜街景')
    }, [])
    return h('div', { className: 'ofs-intent-harness' }, String(chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, { latest })
    await client.settle()

    // 请求带表单当前 CFG 与预设；首轮还没有多轮上下文，不发空 history。
    const firstRequest = client.requests.find((item) => item.path === '/imagen-api/intent')
    assert.equal(firstRequest.body.text, '画一张横版雨夜街景')
    assert.equal(firstRequest.body.cfg, 7, '请求必须带表单当前 CFG')
    assert.equal(firstRequest.body.presetId, 'sdxl-lightning')
    assert.equal(firstRequest.body.locale, 'zh')
    assert.equal(
      Object.prototype.hasOwnProperty.call(firstRequest.body, 'history'),
      false,
      '首轮没有历史时不应发送空 history',
    )

    // 消息字段 v2：没有 styleId，新增 count / modelHint 等。
    const intent = latest.chat.messages[1]
    assert.equal(intent.kind, 'intent')
    assert.equal(intent.prompt, responses['/imagen-api/intent'].prompt)
    assert.equal(intent.summary, '雨夜城市街景，湿润路面倒映霓虹招牌')
    assert.equal(intent.ratioId, '16:9')
    assert.equal(intent.negative, 'blurry, low quality')
    assert.equal(intent.count, 1, '宿主没给张数时默认 1')
    assert.equal(intent.clarify, null)
    assert.deepEqual(intent.modelHint, { presetId: 'flux2-klein-4b', reason: '轻量快速，适合草稿' })
    assert.equal(intent.source, 'model')
    assert.equal(Object.prototype.hasOwnProperty.call(intent, 'styleId'), false, '意图消息不应再有 styleId')

    // 张数行内编辑：钳制 1~4，非法值回落 1。
    latest.chat.updateIntentField(intent.id, 'count', 3)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages[1].count, 3)
    latest.chat.updateIntentField(intent.id, 'count', 9)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages[1].count, 4, '超过上限应钳制到 4')
    latest.chat.updateIntentField(intent.id, 'count', 0)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages[1].count, 1, '低于下限应钳制到 1')
    latest.chat.updateIntentField(intent.id, 'count', 2)
    await client.rerenderRaw()

    // 按此生成：提示词 / 张数 / 比例尺寸 / 排除项进入覆盖项，并回填表单。
    await latest.chat.generateIntent(latest.chat.messages[1])
    assert.deepEqual(calls.generates, [{
      prompt: 'rainy night city street, wet pavement reflecting neon signs',
      count: 2,
      negativePrompt: 'blurry, low quality',
      width: 1280,
      height: 720,
    }], '生成覆盖项应带编辑后的张数与比例尺寸')
    assert.deepEqual(calls.patches.at(-1), {
      prompt: 'rainy night city street, wet pavement reflecting neon signs',
      count: 2,
      width: 1280,
      height: 720,
      negative: 'blurry, low quality',
    }, '确认卡参数应回填表单')

    // negativeActive=false（CFG=0 或模型不支持负向词）：覆盖项置空串，表单也不写 negative。
    form.negativeActive = false
    await latest.chat.generateIntent(latest.chat.messages[1])
    assert.equal(calls.generates.at(-1).negativePrompt, '', '负向词不可用时提交空串')
    assert.equal(
      Object.prototype.hasOwnProperty.call(calls.patches.at(-1), 'negative'),
      false,
      '负向词不可用时不应写进表单',
    )
    form.negativeActive = true

    // 第二轮：history 同时包含用户原话与上一张卡片的英文提示词；宿主给通用澄清。
    responses['/imagen-api/intent'] = {
      ok: true,
      source: 'model',
      prompt: 'draft of the next scene',
      summary: '下一幕草稿',
      ratioId: '1:1',
      negative: '',
      clarify: { question: '横版还是竖版？', options: ['横版', '竖版'] },
      modelHint: null,
    }
    await latest.chat.interpret('再画一版')
    await client.settle()
    await client.rerenderRaw()
    const secondRequest = client.requests.filter((item) => item.path === '/imagen-api/intent').at(-1)
    assert.deepEqual(secondRequest.body.history, [
      { role: 'user', content: '画一张横版雨夜街景' },
      { role: 'assistant', content: 'rainy night city street, wet pavement reflecting neon signs' },
    ], 'history 应带上一轮用户原话与英文提示词')

    const clarifyCard = latest.chat.messages.at(-1)
    assert.ok(clarifyCard.clarify, '应生成通用澄清卡')
    assert.deepEqual(clarifyCard.clarify, { question: '横版还是竖版？', options: ['横版', '竖版'] })

    // 点选项：旧澄清卡被替换，选项作为用户消息进入下一轮，history 带上该卡草稿提示词。
    const clarifyCount = latest.chat.messages.length
    latest.chat.resolveClarify(clarifyCard.id, '横版')
    await client.settle()
    await client.rerenderRaw()
    const afterResolve = latest.chat.messages
    assert.equal(
      afterResolve.some((message) => message.id === clarifyCard.id),
      false,
      '选完选项后旧澄清卡应被新一轮结果替换',
    )
    assert.equal(afterResolve.length, clarifyCount + 1, '旧卡移除后新增一条用户消息与一张确认卡')
    assert.equal(afterResolve.at(-2).role, 'user')
    assert.equal(afterResolve.at(-2).text, '横版')
    const thirdRequest = client.requests.filter((item) => item.path === '/imagen-api/intent').at(-1)
    assert.equal(thirdRequest.body.text, '横版', '点选项应以选项文本重新解析')
    assert.deepEqual(
      thirdRequest.body.history.at(-1),
      { role: 'assistant', content: 'draft of the next scene\n[Clarify] 横版还是竖版？' },
      '重新解析要带上该卡草稿提示词与澄清问题',
    )

    // 「先按当前设置」：只清澄清、不发解析请求，卡片还原为确认卡。
    responses['/imagen-api/intent'] = {
      ok: true,
      source: 'model',
      prompt: 'draft two',
      summary: '',
      ratioId: '',
      negative: '',
      clarify: { question: '要写实还是插画？', options: ['写实', '插画'] },
      modelHint: null,
    }
    await latest.chat.interpret('再来一版')
    await client.settle()
    await client.rerenderRaw()
    const secondClarify = latest.chat.messages.at(-1)
    assert.ok(secondClarify.clarify, '应再次得到澄清卡')
    const requestsBeforeKeep = client.requests.filter((item) => item.path === '/imagen-api/intent').length
    latest.chat.resolveClarify(secondClarify.id, '')
    await client.rerenderRaw()
    const restored = latest.chat.messages.find((message) => message.id === secondClarify.id)
    assert.ok(restored && restored.clarify === null, '空选项只清澄清、还原成确认卡')
    assert.equal(
      client.requests.filter((item) => item.path === '/imagen-api/intent').length,
      requestsBeforeKeep,
      '「先按当前设置」不应再发解析请求',
    )

    // 带入参数面板：转交 form.applyIntent 并把成功与否原样返回。
    assert.equal(latest.chat.handoffIntent(latest.chat.messages.at(-1)), true)
    assert.equal(calls.applied.at(-1).prompt, latest.chat.messages.at(-1).prompt)
    form.applyIntent = () => false
    assert.equal(latest.chat.handoffIntent(latest.chat.messages.at(-1)), false, '表单拒收时应返回 false')
  } finally {
    client.unmount()
  }
})

// 新建对话的代次守卫：解析中的旧请求返回后绝不能写进新线程。
await check('渲染：新建对话丢弃解析中的旧请求结果', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const React = client.react
  const h = React.createElement
  const { useChatThread } = client.hooks
  const t = client.internals.i18n.fallbackTranslate('zh')
  const latest = { chat: null }
  // alive 由测试决定何时放行，模拟「请求还在路上」。
  const pending = []
  function alive(promise) {
    // 真实请求照常发出（fake fetch 立即返回），但 hook 等待的是这里手控的 Promise。
    Promise.resolve(promise).catch(() => {})
    return new Promise((resolve) => pending.push(resolve))
  }
  const form = {
    form: { presetId: 'sdxl-lightning', cfg: 0, seed: '' },
    negativeActive: false,
    patchForm: () => {},
    applyIntent: () => true,
  }
  function Harness(props) {
    const chat = useChatThread({
      t,
      isEn: false,
      alive,
      state: { lastJob: null },
      form,
      generate: async () => {},
    })
    props.latest.chat = chat
    return h('div', { className: 'ofs-newchat-harness' }, String(chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, { latest })
    await client.settle()

    latest.chat.interpret('旧主题的请求')
    await client.rerenderRaw()
    assert.equal(latest.chat.interpreting, true, '解析中应显示解析状态')
    assert.equal(latest.chat.messages.length, 1, '解析中先落一条用户消息')

    // 解析中点新建对话：线程清空、解析态就地复位，不必等旧请求回来。
    latest.chat.newChat()
    await client.rerenderRaw()
    assert.equal(latest.chat.messages.length, 0, '新建对话应清空线程')
    assert.equal(latest.chat.interpreting, false, '新建对话应复位解析中状态')

    // 旧请求现在才返回：结果整条丢弃，不改新线程。
    pending[0]({
      ok: true,
      data: {
        prompt: 'stale prompt',
        summary: '旧主题',
        ratioId: '1:1',
        negative: '',
        clarify: null,
        modelHint: null,
        source: 'model',
      },
    })
    await client.settle()
    await client.rerenderRaw()
    assert.equal(latest.chat.messages.length, 0, '旧请求返回不得写入新线程')
    assert.equal(latest.chat.interpreting, false, '旧请求不得把新线程重新标记为解析中')

    // 新线程继续可用：下一次解析正常落地。
    latest.chat.interpret('新主题')
    await client.rerenderRaw()
    assert.equal(pending.length, 2, '新线程应能再次发起解析')
    pending[1]({
      ok: true,
      data: {
        prompt: 'fresh prompt',
        summary: '新主题',
        ratioId: '',
        negative: '',
        clarify: null,
        modelHint: null,
        source: 'model',
      },
    })
    await client.settle()
    await client.rerenderRaw()
    const messages = latest.chat.messages
    assert.equal(messages.length, 2, '新线程应有用户消息 + 确认卡')
    assert.equal(messages[0].text, '新主题')
    assert.equal(messages[1].kind, 'intent')
    assert.equal(messages[1].prompt, 'fresh prompt')
  } finally {
    client.unmount()
  }
})

// 带入参数面板的端到端粘合：useChatThread.handoffIntent → useStudioForm.applyIntent，
// 确认卡内容真的写进工作台表单（而不是只在 ChatPanel 的测试替身里记录）。
await check('渲染：带入参数面板写入真实表单（useStudio + handoffIntent）', async () => {
  const responses = {
    '/imagen-api/state': {
      defaultPreset: 'realvis-v5',
      presets: [realvis, preset],
      session: { state: 'ready', modelId: 'realvis-v5', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
      jobs: [],
      lastJob: null,
      probe: probeOk,
    },
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({
      t: client.internals.i18n.fallbackTranslate('zh'),
    })
    latest.studio = studio
    return h('div', { className: 'ofs-handoff-harness' }, String(studio.form.form.count))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    // 初始预设同步为 realvis：CFG 5 > 0 且带推荐负向词，排除项可用。
    assert.equal(latest.studio.form.form.presetId, 'realvis-v5')
    assert.equal(latest.studio.form.negativeActive, true)

    const message = { prompt: '  rainy street, neon lights  ', ratioId: '16:9', negative: 'blurry', count: 3, kind: 'intent' }
    assert.equal(latest.studio.chat.handoffIntent(message), true, '带入成功应返回 true')
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.prompt, 'rainy street, neon lights', '提示词去空白后写入表单')
    assert.equal(latest.studio.form.form.width, 1280, '比例换算成宽高')
    assert.equal(latest.studio.form.form.height, 720)
    assert.equal(latest.studio.form.form.count, 3, '张数写入表单')
    assert.equal(latest.studio.form.form.negative, 'blurry', '负向词可用时写入表单')

    // 空提示词：不写表单、返回 false（ChatPanel 据此不切面板、不提示成功）。
    const before = JSON.stringify(latest.studio.form.form)
    assert.equal(latest.studio.chat.handoffIntent({ prompt: '   ', ratioId: '1:1', count: 2 }), false)
    await client.rerenderRaw()
    assert.equal(JSON.stringify(latest.studio.form.form), before, '空提示词不应改动表单')
  } finally {
    client.unmount()
  }
})

// 表单提交同步进助手：除提示词外带结构化参数摘要，且这类记录不进入意图上下文。
await check('渲染：表单提交同步进助手带参数摘要且不进意图上下文', async () => {
  const responses = {
    '/imagen-api/state': readyState,
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-sync', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-sync-harness' }, String(studio.chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    latest.studio.form.patchForm({ prompt: '雨夜街景', width: 1280, height: 720, count: 2, seed: '42' })
    await client.rerenderRaw()
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()

    const messages = latest.studio.chat.messages
    const sync = messages.find((message) => message.kind === 'form')
    assert.ok(sync, '生成提交后应在助手线程里留下参数摘要记录')
    assert.equal(sync.role, 'user', '参数摘要记录挂在用户侧（但带 kind 以示区分）')
    assert.equal(sync.source, 'form', '表单提交的来源标记')
    assert.equal(sync.text, '雨夜街景')
    assert.deepEqual(sync.summary, {
      presetId: 'sdxl-lightning',
      ratioId: '16:9',
      width: 1280,
      height: 720,
      count: 2,
      hasReference: false,
      seed: 42,
    }, '参数摘要应覆盖模型 / 比例像素 / 张数 / 参考图 / 种子策略')
    const syncIndex = messages.indexOf(sync)
    assert.equal(messages[syncIndex + 1] && messages[syncIndex + 1].kind, 'job', '先参数摘要、后任务气泡')
    // 上下文隔离：参数摘要与任务气泡都不能进意图模型的多轮历史。
    assert.deepEqual(client.PURE.intentHistory(messages), [], '表单同步记录不得进入 intentHistory')
  } finally {
    client.unmount()
  }
})

// 参数摘要的界面呈现：白卡 + 胶囊，与普通用户气泡结构不同；中英文都可用。
await check('渲染：表单同步记录用参数胶囊与普通用户气泡区分', async () => {
  const syncMessage = {
    id: 1,
    role: 'user',
    kind: 'form',
    source: 'form',
    text: '雨夜街景',
    summary: {
      presetId: 'sdxl-lightning',
      ratioId: '16:9',
      width: 1280,
      height: 720,
      count: 2,
      hasReference: true,
      seed: 42,
    },
  }
  const mounted = await mountChatPanel({
    messages: [syncMessage, { id: 2, role: 'user', text: '再亮一点' }],
  })
  try {
    const { tree } = mounted
    assertStructure('form-sync', tree, {
      required: {
        'ofs-form-sync': 1,
        'ofs-form-sync-card': 1,
        'ofs-form-sync-title': 1,
        'ofs-form-sync-prompt': 1,
        'ofs-form-sync-chips': 1,
        'ofs-form-sync-chip': 5,
        'ofs-msg--user': 1,
      },
      forbidden: [],
    })
    const text = collectText(tree).join(' | ')
    for (const needle of [
      '来自参数表单',
      '雨夜街景',
      'SDXL Lightning',
      '16:9 · 1280 × 720',
      '2 张',
      '含参考图',
      '种子 42',
      '再亮一点',
    ]) {
      assert.ok(text.includes(needle), `[form-sync] 缺少：${needle}`)
    }
    // 普通用户消息仍走气泡结构，不能被参数卡片吞掉。
    assert.equal(findClass(tree, 'ofs-msg--user').length, 1)
  } finally {
    mounted.client.unmount()
  }

  // 变体提交：标题与「文生图 / 随机种子」两组胶囊都要正确。
  const variant = await mountChatPanel({
    messages: [{
      id: 3,
      role: 'user',
      kind: 'form',
      source: 'variant',
      text: '荷花池塘',
      summary: { presetId: 'sdxl-lightning', ratioId: '1:1', width: 1024, height: 1024, count: 1, hasReference: false, seed: null },
    }],
  })
  try {
    const text = collectText(variant.tree).join(' | ')
    assert.ok(text.includes('生成变体'), '[form-sync] 变体提交应有独立标题')
    assert.ok(text.includes('文生图'), '[form-sync] 无参考图时应显式标注文生图')
    assert.ok(text.includes('随机种子'), '[form-sync] 无固定种子时应标注随机种子')
    assert.ok(text.includes('1024 × 1024'), '[form-sync] 自定义画幅只显示像素')
  } finally {
    variant.client.unmount()
  }
})

// 等待出图期间继续改表单：这些改动没有提交，生成成功也不能把它们洗成「干净」。
await check('渲染：生成等待期间的手动修改仍算脏', async () => {
  const responses = {
    '/imagen-api/state': readyState,
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-wait', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-wait-harness' }, String(studio.form.dirty))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    latest.studio.form.patchForm({ prompt: '第一版提示词' })
    await client.rerenderRaw()
    assert.equal(latest.studio.form.dirty, true)

    // 不 await：先让请求在路上，再模拟用户在等待期间继续输入。
    const pending = latest.studio.actions.generate()
    latest.studio.form.patchForm({ prompt: '等待期间的新草稿' })
    await client.rerenderRaw()
    const ok = await pending
    await client.settle()
    await client.rerenderRaw()

    assert.equal(ok, true, '生成应成功')
    assert.equal(latest.studio.form.form.prompt, '等待期间的新草稿', '等待期间的输入不能被回滚')
    assert.equal(latest.studio.form.dirty, true, '等待期间的修改没有提交，仍应算脏')
  } finally {
    client.unmount()
  }
})

// 胶卷点击的双向同步：干净表单自动回填（含原图 seed、清参考图），脏表单只换预览；
// 新建创作清掉绑定上一张作品的状态，但保留当前模型预设与画幅比例。
await check('渲染：胶卷点击回填参数、草稿保护与新建创作边界', async () => {
  const img2imgPreset = { ...preset, supportsImg2Img: true }
  const state = {
    defaultPreset: 'sdxl-lightning',
    presets: [img2imgPreset],
    session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
    jobs: [],
    lastJob: null,
    probe: probeOk,
  }
  const responses = {
    '/imagen-api/state': state,
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-flow', status: 'queued' },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-flow-harness' }, String(studio.form.dirty))
  }
  const form = () => latest.studio.form
  const thumbA = { image: historyItem.images[0], item: historyItem }
  const thumbB = { image: historyItem.images[1], item: historyItem }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    assert.equal(form().dirty, false, '刚打开时表单是干净的')
    assert.equal(form().form.presetId, 'sdxl-lightning', '初始预设应已同步')

    // 先挂一张参考图，模拟上一轮垫图状态残留。
    const applied = form().applyReference(thumbA)
    await client.rerenderRaw()
    assert.equal(applied.ok, true)
    assert.equal(form().form.reference.path, thumbA.image.path)

    // 手动改提示词但不点生成 → dirty。
    form().patchForm({ prompt: '我自己的草稿' })
    await client.rerenderRaw()
    assert.equal(form().dirty, true, '手动修改后应标记为脏')

    // 脏时点胶卷：预览照常切换，草稿与参考图都保留，并给轻提示。
    // 参考图保护优先于草稿保护：有参考图时提示「已保留当前参考图」，不能只说草稿。
    latest.studio.actions.previewWork(thumbB)
    await client.rerenderRaw()
    assert.equal(latest.studio.library.selected.image.path, thumbB.image.path, '预览应切到被点的图')
    assert.equal(form().form.prompt, '我自己的草稿', '脏表单不得被覆盖')
    assert.equal(form().form.reference.path, thumbA.image.path, '脏表单的参考图也保留')
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已保留当前参考图'),
      '有参考图时应提示「已保留当前参考图」',
    )

    // 生成提交成功后表单回到干净状态（干净基准更新到刚提交的内容）。
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(form().dirty, false, '刚生成完应回到干净状态')

    // 提交成功后参考图仍在表单里：干净态的胶卷点击同样只换预览，不得清掉参考图。
    latest.studio.actions.previewWork(thumbB)
    await client.rerenderRaw()
    assert.equal(form().form.reference.path, thumbA.image.path, '干净态也要保留参考图（决策 1）')
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已保留当前参考图'),
      '干净态保留参考图也要提示',
    )

    // 显式移除参考图并回到干净基准，才是普通回填路径。
    form().removeReference()
    await client.rerenderRaw()
    form().markClean()
    await client.rerenderRaw()
    assert.equal(form().dirty, false, '移除参考图后重新标为干净')

    // 干净时再点胶卷：完整回填该作品参数，保留原图 seed。
    latest.studio.actions.previewWork(thumbB)
    await client.rerenderRaw()
    assert.equal(form().form.prompt, '测试用的荷花池塘', '提示词来自作品')
    assert.equal(form().form.width, 1024, '尺寸用产物像素')
    assert.equal(form().form.height, 1024)
    assert.equal(form().form.steps, 4, '没有 params 时回落到预设推荐值')
    assert.equal(form().form.cfg, 0)
    assert.equal(form().form.presetId, 'sdxl-lightning', '预设来自作品')
    assert.equal(form().form.seed, '8', '无有效 seed 才随机；有则保留原图 seed')
    assert.equal(form().form.reference, null, '回填普通作品要清掉上一轮参考图')
    assert.equal(form().tuning && form().tuning.prompt, '测试用的荷花池塘', '面板应记录微调来源')
    assert.equal(form().dirty, false, '回填后仍是干净状态')
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('参数已回填'),
      '回填成功应给轻提示',
    )

    // 新建创作：清提示词 / 参考图 / 固定 seed，负向层回到当前预设默认，保留模型与画幅。
    form().applyRatio('16:9')
    await client.rerenderRaw()
    assert.equal(form().form.width, 1280)
    form().newCreation()
    await client.rerenderRaw()
    assert.equal(form().form.prompt, '', '新建创作清空提示词')
    assert.equal(form().form.seed, '', '新建创作把种子恢复为随机')
    assert.equal(form().form.reference, null, '新建创作清空参考图')
    assert.equal(form().form.negative, '', 'CFG=0 的预设默认不启用负向词')
    assert.deepEqual(form().form.negativeLayers, { model: '', user: '' })
    assert.equal(form().form.presetId, 'sdxl-lightning', '保留当前模型预设')
    assert.equal(form().form.width, 1280, '保留当前画幅比例（宽）')
    assert.equal(form().form.height, 720, '保留当前画幅比例（高）')
    assert.equal(form().tuning, null, '清除微调来源标记')
    assert.equal(form().dirty, false, '新建创作后是干净状态')
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已开始新的创作'),
      '新建创作应给轻提示',
    )
  } finally {
    client.unmount()
  }
})

// 胶片条缩略图点击要交给组合层：换预览 + （表单干净时）回填参数；没有该动作时退回纯选图。
await check('渲染：胶片条缩略图点击交由组合层回填参数', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const picked = []
  const tree = await client.mountRaw(client.components.Filmstrip, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: { setView: () => {} },
    compute: { pendingJobs: [], sessionState: 'ready', startSession: () => {}, status: { stopped: false }, cancellingIds: [] },
    library: {
      batches: [{
        key: 'batch-1',
        presetId: 'sdxl-lightning',
        prompt: '作品提示词',
        entries: [{ image: { path: 'imagen-output/a/01.png', url: '/imagen-api/file?path=a' }, item: {} }],
      }],
      selected: null,
      selectImage: () => picked.push('selectImage'),
    },
    actions: { previewWork: (entry) => picked.push(entry.image.path) },
    now: NOW,
  })
  client.unmount()
  const thumb = findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(/\s+/).includes('ofs-thumb'),
  )[0]
  assert.ok(thumb, '缺少胶卷缩略图按钮')
  thumb.props.onClick()
  assert.deepEqual(picked, ['imagen-output/a/01.png'], '有 previewWork 时应交给组合层（换预览 + 回填参数）')
})

// 意图纯函数：多轮历史裁剪、通用澄清与模型建议归一；不依赖 React，离线断言。
await check('渲染：意图纯函数（history / 澄清 / 模型建议归一）', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  try {
    const pure = client.PURE
    const messages = []
    for (let index = 0; index < 8; index += 1) {
      messages.push({ id: index * 2 + 1, role: 'user', text: `第 ${index} 句` })
      messages.push({
        id: index * 2 + 2,
        role: 'assistant',
        kind: 'intent',
        prompt: `prompt ${index}`,
        summary: `摘要 ${index}`,
      })
    }
    messages.push({ id: 99, role: 'assistant', kind: 'job', text: '正在生成…' })
    const history = pure.intentHistory(messages)
    assert.equal(history.length, LIMITS.intentHistory.maxMessages, 'history 只保留最近 12 条')
    assert.deepEqual(history[0], { role: 'user', content: '第 2 句' })
    assert.deepEqual(history.at(-1), { role: 'assistant', content: 'prompt 7' })
    assert.equal(history.some((item) => item.content.includes('正在生成')), false, '任务气泡不进上下文')
    // 表单提交同步记录（kind='form'）只是界面展示，不进入意图上下文。
    assert.deepEqual(
      pure.intentHistory([
        { role: 'user', text: '画一只橘猫' },
        { role: 'user', kind: 'form', text: '另一个题材的提示词', summary: { presetId: 'sdxl-lightning' } },
        { role: 'assistant', kind: 'intent', prompt: 'an orange cat' },
      ]),
      [
        { role: 'user', content: '画一只橘猫' },
        { role: 'assistant', content: 'an orange cat' },
      ],
      '表单提交同步记录不进意图上下文',
    )
    assert.deepEqual(
      pure.intentHistory([
        { role: 'user', text: '画一只橘猫' },
        {
          role: 'assistant',
          kind: 'intent',
          prompt: 'an orange cat',
          clarify: { question: '想要什么场景和光线？', options: ['窗边午后阳光', '雪夜霓虹'] },
        },
      ]),
      [
        { role: 'user', content: '画一只橘猫' },
        { role: 'assistant', content: 'an orange cat\n[Clarify] 想要什么场景和光线？' },
      ],
      '带澄清问题的意图卡会把问题保留进多轮历史',
    )
    assert.deepEqual(pure.intentHistory(null), [])

    // 澄清归一：2~4 个去重选项；不足 2 个或没有问题时整条丢弃。
    assert.deepEqual(
      pure.intentClarify({ question: ' 要横版吗？ ', options: [' 横版 ', '横版', '竖版'] }),
      { question: '要横版吗？', options: ['横版', '竖版'] },
      '问题去空白、选项去重',
    )
    assert.equal(pure.intentClarify({ question: '只有一个选项', options: ['横版'] }), null)
    assert.equal(pure.intentClarify({ question: '', options: ['横版', '竖版'] }), null)
    assert.equal(pure.intentClarify(null), null)
    assert.equal(pure.intentClarify({ question: '最多四个？', options: ['1', '2', '3', '4', '5'] }).options.length, 4)

    // 模型建议归一：预设必须真实存在、不能与当前预设相同、理由必填。
    assert.deepEqual(
      pure.intentModelHint({ presetId: 'flux2-klein-4b', reason: ' 轻量快速 ' }, 'sdxl-lightning'),
      { presetId: 'flux2-klein-4b', reason: '轻量快速' },
    )
    assert.equal(pure.intentModelHint({ presetId: 'sdxl-lightning', reason: '同款' }, 'sdxl-lightning'), null)
    assert.equal(pure.intentModelHint({ presetId: 'not-a-model', reason: '未知' }, 'sdxl-lightning'), null)
    assert.equal(pure.intentModelHint({ presetId: 'flux2-klein-4b', reason: '  ' }, 'sdxl-lightning'), null)

    // 比例归一：只认契约比例。
    assert.equal(pure.intentRatio('16:9'), '16:9')
    assert.equal(pure.intentRatio('21:9'), '')
  } finally {
    client.unmount()
  }
})

await check('渲染：中文提示词的英文软提示（不拦截生成）', async () => {
  const mountStudio = async (initialPrompt) => {
    const client = await loadClient({
      now: NOW,
      responses: {
        '/imagen-api/state': readyState,
        '/imagen-api/history': { items: [historyItem] },
        '/imagen-api/library': { favorites: [], deleted: [] },
      },
      testBuild: true,
    })
    const tree = await client.mountRaw(client.components.Studio, { initialPrompt })
    client.unmount()
    return tree
  }

  const tree = await mountStudio('雨夜街景，湿润地面')
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('中文描述可能出图偏差'), '[hint] 中文提示词应给英文软提示')
  assertStructure('cjk-hint', tree, { required: { 'ofs-prompt-lang-hint': 1 }, forbidden: [] })
  const generateButton = findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-generate'),
  )[0]
  assert.ok(generateButton, '[hint] 缺少生成按钮')
  assert.notEqual(generateButton.props.disabled, true, '软提示不应拦住生成')

  const english = await mountStudio('rainy night street, wet pavement')
  assertStructure('english-prompt', english, { required: {}, forbidden: ['ofs-prompt-lang-hint'] })
})

await check('渲染：润色标签显示中文 label、点击插入英文 text', async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const inserted = []
  const tree = await client.mountRaw(client.components.Rail, {
    t,
    ui: {
      advancedOpen: false,
      setAdvancedOpen: () => {},
      negativeOpen: false,
      setNegativeOpen: () => {},
      panelMode: 'form',
      setPanelMode: () => {},
    },
    form: {
      form: { prompt: '', negative: '', presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0, seed: '', count: 1 },
      patchForm: () => {},
      selectPreset: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      sizeTiers: [1024],
      selectedTier: 1024,
      applyTier: () => {},
      applyCustomSize: () => {},
      applyCfg: () => {},
      resetSeed: () => {},
      negativeActive: false,
      negativeHint: '',
      refineGroups: [
        {
          dimension: 'lighting',
          options: [{ id: 'local-lighting-0', text: 'soft diffused light', label: '柔和漫射光', applied: false }],
        },
      ],
      refineSource: 'local',
      enhancing: false,
      enhance: () => {},
      translating: false,
      translate: () => {},
      toggleRefine: (term) => inserted.push(term),
      useInspiration: () => {},
      englishPromptHint: false,
    },
    actions: { sending: false, generate: () => {} },
  })
  client.unmount()
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('柔和漫射光'), '[refine] 界面应显示中文 label')
  assert.ok(!text.includes('soft diffused light'), '[refine] 英文本只作为插入值，不应直接显示为按钮文案')
  const chip = findNodes(
    tree,
    (node) => node.type === 'button'
      && node.props?.title === 'soft diffused light'
      && collectText(node).join('').includes('柔和漫射光'),
  )[0]
  assert.ok(chip, '[refine] 缺少润色标签按钮')
  chip.props.onClick()
  assert.deepEqual(inserted, ['soft diffused light'], '点击应把英文本交给 toggleRefine')
})

// 暗房卡取消：三种活动任务都显示取消按钮；收到取消请求后显示「正在停止…」并禁用。
await check('渲染：胶片条取消按钮与取消中状态', async () => {
  const t = (client) => client.internals.i18n.fallbackTranslate('zh')
  const activeJobs = [
    {
      id: 'job-run',
      status: 'running',
      stageCode: 'running',
      progress: { done: 1, total: 4 },
      createdAt: at(-10),
      startedAt: at(-8),
      params: { prompt: '正在生成的第一张' },
    },
    { id: 'job-queued', status: 'queued', createdAt: at(-2), params: { prompt: '排队中的第二张' } },
    {
      id: 'job-stop',
      status: 'running',
      stageCode: 'running',
      cancelRequested: true,
      createdAt: at(-20),
      startedAt: at(-18),
      params: { prompt: '取消中的第三张' },
    },
  ]
  const mountFilmstrip = async (computeExtra) => {
    const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
    const cancelled = []
    const tree = await client.mountRaw(client.components.Filmstrip, {
      t: t(client),
      ui: { setView: () => {} },
      compute: {
        pendingJobs: activeJobs,
        sessionState: 'ready',
        startSession: () => {},
        status: { stopped: false },
        cancelJob: (id) => cancelled.push(id),
        cancellingIds: [],
        ...computeExtra,
      },
      library: { batches: [], selected: null, selectImage: () => {} },
      now: NOW,
    })
    client.unmount()
    return { tree, cancelled }
  }

  const ready = await mountFilmstrip({})
  const buttons = findNodes(
    ready.tree,
    (node) => node.type === 'button' && node.props?.className === 'ofs-ghost-cancel',
  )
  assert.equal(buttons.length, 3, 'queued / waiting-session / running 三种活动任务都应显示取消按钮')
  assert.equal(buttons[0].props['aria-label'], '取消')
  assert.notEqual(buttons[0].props.disabled, true, '未取消的任务按钮可点击')
  buttons[0].props.onClick()
  assert.deepEqual(ready.cancelled, ['job-run'], '点击取消应把任务 id 交给 cancelJob')
  // 宿主已标记 cancelRequested：文案换成「正在停止…」并禁用，避免重复提交。
  assert.equal(buttons[2].props['aria-label'], '正在停止…')
  assert.equal(buttons[2].props.disabled, true)
  const text = collectText(ready.tree).join(' | ')
  assert.ok(text.includes('正在停止…'), '取消中的卡片应显示停止中文案')

  // 本地请求已发出、宿主快照还没更新：也要立刻进入「取消中」。
  const pending = await mountFilmstrip({ cancellingIds: ['job-queued'] })
  const pendingButtons = findNodes(
    pending.tree,
    (node) => node.type === 'button' && node.props?.className === 'ofs-ghost-cancel',
  )
  assert.equal(pendingButtons[1].props['aria-label'], '正在停止…')
  assert.equal(pendingButtons[1].props.disabled, true, '取消请求发出后按钮应禁用')
  assertStructure('filmstrip-cancelling', pending.tree, {
    // 两个取消中的卡：job-stop 由宿主 cancelRequested 标记，job-queued 由本地请求标记。
    required: { 'ofs-ghost': 3, 'ofs-ghost-cancel': 3, 'is-cancelling': 2 },
    forbidden: [],
  })
})

// 底部作品条横向滚轮适配：纵向滚轮转换为横向 scrollLeft，触控板横向事件交还原生，卸载时清理监听。
await check('渲染：胶片条支持鼠标纵向滚轮横向滑动', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const listeners = new Map()
  const fakeStrip = {
    addEventListener(type, fn, opts) {
      listeners.set(type, { fn, opts })
    },
    removeEventListener(type, fn) {
      const entry = listeners.get(type)
      if (entry && entry.fn === fn) listeners.delete(type)
    },
  }
  const fakeRoll = {
    scrollWidth: 800,
    clientWidth: 320,
    scrollLeft: 0,
  }
  const origUseRef = client.react.useRef.bind(client.react)
  let refCount = 0
  client.react.useRef = (init) => {
    const ref = origUseRef(init)
    refCount += 1
    if (refCount === 1) ref.current = fakeStrip
    if (refCount === 2) ref.current = fakeRoll
    return ref
  }

  await client.mountRaw(client.components.Filmstrip, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: { setView: () => {} },
    compute: { pendingJobs: [], sessionState: 'ready', startSession: () => {}, status: { stopped: false }, cancellingIds: [] },
    library: { batches: [], selected: null, selectImage: () => {} },
    now: NOW,
  })

  const wheel = listeners.get('wheel')
  assert.ok(wheel, '应在底部作品条上注册 wheel 监听')
  assert.deepEqual(wheel.opts, { passive: false }, 'wheel 监听需关闭 passive 以阻止默认垂直滚动')

  let prevented = 0
  // 1) 普通鼠标纵向滚轮（px 模式）：转成横向 scrollLeft，并调用 preventDefault。
  wheel.fn({ deltaX: 0, deltaY: 120, deltaMode: 0, preventDefault: () => { prevented += 1 } })
  assert.equal(fakeRoll.scrollLeft, 120, '纵向 deltaY 应累加到 scrollLeft')
  assert.equal(prevented, 1)

  // 2) 行模式滚轮（deltaMode === 1）：按 32px/行折算。
  wheel.fn({ deltaX: 0, deltaY: -2, deltaMode: 1, preventDefault: () => { prevented += 1 } })
  assert.equal(fakeRoll.scrollLeft, 56, '行模式负向 deltaY 应向回滚动')
  assert.equal(prevented, 2)

  // 3) 触控板以横向滚动为主（|deltaX| > |deltaY|）：交还原生滚动，不改 scrollLeft 也不拦截。
  wheel.fn({ deltaX: 60, deltaY: 10, deltaMode: 0, preventDefault: () => { prevented += 1 } })
  assert.equal(fakeRoll.scrollLeft, 56, '触控板横向手势不应重复叠加 scrollLeft')
  assert.equal(prevented, 2)

  // 4) 内容未超出容器宽度时不做拦截。
  fakeRoll.scrollWidth = 300
  wheel.fn({ deltaX: 0, deltaY: 100, deltaMode: 0, preventDefault: () => { prevented += 1 } })
  assert.equal(fakeRoll.scrollLeft, 56, '无横向溢出时不应修改 scrollLeft')
  assert.equal(prevented, 2)

  client.unmount()
  assert.equal(listeners.has('wheel'), false, '组件卸载时应移除 wheel 监听')
})

// 画廊分页脚：有更早记录时给「加载更多」，取完后给「已加载全部作品」。
await check('渲染：画廊分页底部（加载更多 / 已加载全部）', async () => {
  const mountGallery = async (extra = {}) => {
    const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
    const calls = []
    const tree = await client.mountRaw(client.components.Gallery, {
      t: client.internals.i18n.fallbackTranslate('zh'),
      gallery: [{ image: historyItem.images[0], item: historyItem }],
      now: NOW,
      presets: [preset],
      favorites: [],
      hasMore: true,
      loadingMore: false,
      onLoadMore: () => calls.push('more'),
      onDelete: () => {},
      onExport: () => {},
      onOpen: () => {},
      onRecall: () => {},
      onVariant: () => {},
      onZoom: () => {},
      ...extra,
    })
    client.unmount()
    return { tree, calls }
  }

  const more = await mountGallery()
  const moreButton = findNodes(
    more.tree,
    (node) => node.type === 'button' && node.props?.className === 'ofs-chip ofs-gallery-more',
  )
  assert.equal(moreButton.length, 1, 'hasMore=true 时应显示「加载更多」')
  assert.ok(collectText(moreButton[0]).join('').includes('加载更多'))
  moreButton[0].props.onClick()
  assert.deepEqual(more.calls, ['more'], '点击加载更多应交给 useWorkLibrary 的 loadMore')

  const busy = await mountGallery({ loadingMore: true })
  const busyButton = findNodes(
    busy.tree,
    (node) => node.type === 'button' && node.props?.className === 'ofs-chip ofs-gallery-more',
  )[0]
  assert.equal(busyButton.props.disabled, true, '加载中按钮禁用')
  assert.equal(busyButton.props['aria-busy'], 'true')

  const done = await mountGallery({ hasMore: false })
  assert.ok(collectText(done.tree).join(' | ').includes('已加载全部作品'), '没有更多记录时显示全部已加载')
  assert.equal(
    findNodes(done.tree, (node) => node.props?.className === 'ofs-chip ofs-gallery-more').length,
    0,
    '取完后不再显示加载更多按钮',
  )
  assertStructure('gallery-foot-done', done.tree, {
    required: { 'ofs-gallery-foot': 1, 'ofs-gallery-all-loaded': 1 },
    forbidden: ['ofs-gallery-more'],
  })
})

// 工作台画廊视图：首屏 offset=0，点「加载更多」后按已加载条数推进 offset。
await check('渲染：画廊加载更多推进 offset 且不重复请求首页', async () => {
  const secondItem = {
    ...historyItem,
    jobId: 'job-2',
    dir: 'imagen-output/20261109-110000-job-2',
    prompt: '第二张作品',
    images: [image(9)],
  }
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      '/imagen-api/history': {
        items: [historyItem, secondItem],
        limit: LIMITS.history.pageSize,
        offset: 0,
        hasMore: true,
      },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  const tree = await client.mountRaw(client.components.Studio, { view: 'gallery' })
  const moreButton = findNodes(
    tree,
    (node) => node.type === 'button' && node.props?.className === 'ofs-chip ofs-gallery-more',
  )[0]
  assert.ok(moreButton, 'hasMore=true 时画廊底部应显示加载更多')
  moreButton.props.onClick()
  // loadMore 是异步请求：给微任务与 setImmediate 几轮时间落地。
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve()
    await new Promise((resolvePromise) => setImmediate(resolvePromise))
  }
  client.unmount()

  const first = `/imagen-api/history?limit=${LIMITS.history.pageSize}&offset=0`
  const next = `/imagen-api/history?limit=${LIMITS.history.pageSize}&offset=2`
  assert.equal(client.fetches.filter((item) => item === first).length, 1, '首屏只请求一次 offset=0')
  assert.ok(client.fetches.includes(next), `加载更多应按已加载 2 条推进 offset，实际请求：${client.fetches.join(', ')}`)
})

// 画面设置（0.10.0）：画幅比例 → 分辨率档位（长边）→「自定义宽高」折叠；
// 自定义输入仍走本地草稿 + 失焦提交，宽高互不联动；页脚是张数 + 生成 + 规格摘要。
await check('渲染：画面设置比例 / 档位 / 自定义宽高与页脚规格摘要', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const calls = { translate: 0, tier: [], ratio: [], patch: [], custom: [] }
  const formProps = {
    form: {
      prompt: '雨夜街景',
      negative: 'blurry, my own',
      negativeLayers: { model: '', user: 'blurry, my own' },
      presetId: 'sdxl-lightning',
      width: 1024,
      height: 1024,
      steps: 4,
      cfg: 0,
      seed: '',
      count: 1,
    },
    patchForm: (partial) => calls.patch.push(partial),
    selectPreset: () => {},
    ratioId: '1:1',
    applyRatio: (id) => calls.ratio.push(id),
    sizeTiers: [768, 1024, 1152],
    selectedTier: 1024,
    applyTier: (tier) => calls.tier.push(tier),
    applyCustomSize: (partial) => calls.custom.push(partial),
    applyCfg: () => {},
    resetSeed: () => {},
    negativeActive: false,
    negativeHint: '',
    refineGroups: [],
    refineSource: '',
    enhancing: false,
    enhance: () => {},
    translating: false,
    translate: () => { calls.translate += 1 },
    toggleRefine: () => {},
    useInspiration: () => {},
    englishPromptHint: false,
  }
  const ui = {
    advancedOpen: false,
    setAdvancedOpen: () => {},
    toggleAdvancedOpen: () => {},
    negativeOpen: false,
    setNegativeOpen: () => {},
    panelMode: 'form',
    setPanelMode: () => {},
  }
  const railProps = (props = {}) => ({
    t,
    ui,
    form: formProps,
    actions: { sending: false, generate: () => {} },
    ...props,
  })
  const textOf = (tree) => collectText(tree).join(' | ')
  const widthInputOf = (tree) => findNodes(
    tree,
    (node) => node.type === 'input' && node.props?.['aria-label'] === '宽',
  )[0]
  const heightInputOf = (tree) => findNodes(
    tree,
    (node) => node.type === 'input' && node.props?.['aria-label'] === '高',
  )[0]
  const customToggleOf = (tree) => findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-custom-toggle'),
  )[0]

  const tree = await client.mountRaw(client.components.Rail, railProps())
  try {
    let text = textOf(tree)
    assert.ok(text.includes('转为英文'), '提示词区应有「转为英文」按钮')
    assert.ok(text.includes('润色'), '润色按钮仍在，二者并列')
    // 画面设置：画幅比例 → 自定义宽高折叠；标题栏显示实时像素读数。
    assert.ok(text.includes('画幅比例'), '画面设置应有画幅比例标签')
    assert.ok(text.includes('1024 × 1024'), '画面设置标题栏应有当前像素读数')
    assert.ok(text.includes('自定义宽高'), '画面设置应有自定义宽高折叠入口')
    assert.ok(!text.includes('分辨率档位'), '不再有分辨率档位行')
    assert.ok(!text.includes('推荐尺寸'), '0.10.0 起不再有方形推荐尺寸行')
    assert.ok(!text.includes('风格'), '参数面板不再有风格预设')
    // 页脚规格摘要：尺寸 · 比例 · 张数。
    assert.ok(text.includes('1024 × 1024 · 1:1 · 1 张'), `页脚应有规格摘要，实际：${text}`)

    // 转英文按钮：点击交给 translate 动作。
    const translateButton = findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-translate-action'),
    )[0]
    assert.ok(translateButton, '缺少「转为英文」按钮')
    assert.notEqual(translateButton.props.disabled, true)
    translateButton.props.onClick()
    assert.equal(calls.translate, 1, '点击应调用 translate()')

    // 画幅比例：5 个按钮，当前 1:1 高亮；点击交给 applyRatio。
    const ratioButtons = findNodes(
      tree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-ratio'),
    )
    assert.equal(ratioButtons.length, 5)
    assert.equal(ratioButtons[0].props['aria-pressed'], true, '宽高 1024×1024 时 1:1 高亮')
    ratioButtons[1].props.onClick()
    assert.deepEqual(calls.ratio, ['16:9'], '点击比例应交给 applyRatio')

    // 自定义宽高默认折叠；展开后才渲染输入框。
    const toggle = customToggleOf(tree)
    assert.ok(toggle, '缺少自定义宽高折叠入口')
    assert.equal(toggle.props['aria-expanded'], false, '自定义宽高默认折叠')
    assert.equal(widthInputOf(tree), undefined, '折叠时不渲染宽输入框')
    toggle.props.onClick()
    let expanded = await client.rerenderRaw()
    assert.equal(customToggleOf(expanded).props['aria-expanded'], true)
    assert.ok(widthInputOf(expanded), '展开后渲染宽输入框')
    assert.equal(widthInputOf(expanded).props.value, '1024')
    assert.equal(widthInputOf(expanded).props.type, 'number')
    assert.equal(widthInputOf(expanded).props.min, LIMITS.width.min)
    assert.equal(widthInputOf(expanded).props.max, LIMITS.width.max)
    assert.equal(widthInputOf(expanded).props.step, LIMITS.width.step)
    assert.equal(heightInputOf(expanded).props.max, LIMITS.height.max)

    // 输入过程只落在本地草稿，不写表单；失焦才归一化提交，且宽高互不联动。
    widthInputOf(expanded).props.onChange({ target: { value: '720' } })
    assert.equal(calls.patch.length, 0, '输入过程不应把原始文本写进表单')
    expanded = await client.rerenderRaw()
    assert.equal(widthInputOf(expanded).props.value, '720', '草稿即时反映输入')
    widthInputOf(expanded).props.onBlur()
    assert.deepEqual(calls.custom, [{ width: 720 }], '修改宽只提交宽，高不联动')

    // 清空后失焦：恢复修改前的合法值（1024），既不提交也不跳成 256。
    expanded = await client.rerenderRaw()
    widthInputOf(expanded).props.onChange({ target: { value: '' } })
    expanded = await client.rerenderRaw()
    assert.equal(widthInputOf(expanded).props.value, '', '清空后输入框为空')
    widthInputOf(expanded).props.onBlur()
    assert.equal(calls.custom.length, 1, '空值失焦不应提交表单')
    expanded = await client.rerenderRaw()
    assert.equal(widthInputOf(expanded).props.value, '1024', '恢复到修改前的合法值')
    assert.notEqual(widthInputOf(expanded).props.value, '256', "不能因 Number('') 钳成下限 256")

    // 改高超界按契约上限钳制，非 8 倍数按 step 对齐；宽保持 1024。
    heightInputOf(expanded).props.onChange({ target: { value: '99999' } })
    expanded = await client.rerenderRaw()
    heightInputOf(expanded).props.onBlur()
    assert.deepEqual(calls.custom.at(-1), { height: LIMITS.height.max }, '超界按契约上限钳制')
    expanded = await client.rerenderRaw()
    assert.equal(widthInputOf(expanded).props.value, '1024', '改高后宽仍保持 1024')
    heightInputOf(expanded).props.onChange({ target: { value: '253' } })
    expanded = await client.rerenderRaw()
    heightInputOf(expanded).props.onBlur()
    assert.deepEqual(calls.custom.at(-1), { height: LIMITS.height.min }, '非 8 倍数按 step 对齐')

    // 回车等价失焦，方便「改完直接按 Enter」。
    const heightForEnter = heightInputOf(expanded)
    let blurred = 0
    heightForEnter.props.onKeyDown({ key: 'Enter', currentTarget: { blur: () => { blurred += 1 } } })
    assert.equal(blurred, 1, '回车应提交（等价失焦）')

    // 高级设置默认折叠：不渲染步数输入，折叠态标题右侧给参数读数。
    assert.equal(
      findNodes(expanded, (node) => node.type === 'input' && node.props?.['aria-label'] === '采样步数').length,
      0,
      '高级设置折叠时不应渲染步数输入',
    )
    assert.ok(textOf(expanded).includes('4 步 · CFG 0 · 随机种子'), '折叠态应有参数读数')

    // 翻译中：按钮显示进行中文案并禁用。
    const translatingClient = await loadClient({ now: NOW, responses: {}, testBuild: true })
    const translatingTree = await translatingClient.mountRaw(
      translatingClient.components.Rail,
      {
        t: translatingClient.internals.i18n.fallbackTranslate('zh'),
        ui,
        form: { ...formProps, translating: true },
        actions: { sending: false, generate: () => {} },
      },
    )
    assert.ok(textOf(translatingTree).includes('正在翻译…'), '翻译中按钮显示进行中文案')
    const translatingButton = findNodes(
      translatingTree,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-translate-action'),
    )[0]
    assert.equal(translatingButton.props.disabled, true, '翻译中按钮禁用')
    translatingClient.unmount()
  } finally {
    client.unmount()
  }
})


await check('资源层：取消 / 历史分页 / 英译的请求形状', async () => {
  const savedFetch = globalThis.fetch
  const savedDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
    ? globalThis.document
    : undefined
  const savedHasDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const calls = []
  const startCalls = []
  globalThis.document = { baseURI: 'http://localhost/' }
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ?? null })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  try {
    await cancelJobRequest('j_123')
    await fetchHistory()
    await fetchHistory(LIMITS.history.pageSize, LIMITS.history.pageSize)
    await enhancePromptRequest({ prompt: '雨夜街景', presetId: 'sdxl-lightning', locale: 'zh', mode: 'translate' })
    await fetchSettingsRequest()
    await saveSettingsRequest({ idleTimeoutSec: 2700, accelerator: 'NvidiaTeslaP100' })
    await fetchUiStateRequest()
    await saveUiStateRequest({ advancedOpen: true })
    await fetchKaggleLogin()
    await startKaggleLogin()
    await cancelKaggleLogin()
    await submitKaggleLoginCode('  code=abcd-efgh-1234  ')
    // 启动会话：普通启动只带 presetId；换新实例重排额外带 forceNew + replace（旧 Host 忽略未知字段）。
    const startIndex = calls.length
    await startSessionRequest('sdxl-lightning')
    await startSessionRequest('sdxl-lightning', { forceNew: true })
    await startSessionRequest('sdxl-lightning', { forceNew: true, replace: true })
    startCalls.push(...calls.slice(startIndex))
  } finally {
    globalThis.fetch = savedFetch
    if (savedHasDocument) globalThis.document = savedDocument
    else delete globalThis.document
  }

  assert.equal(calls[0].url, 'http://localhost/imagen-api/job/cancel', '取消必须走契约 ROUTES.jobCancel')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].body), { id: 'j_123' }, '取消请求体是 { id }')
  assert.equal(calls[1].url, `http://localhost/imagen-api/history?limit=${LIMITS.history.pageSize}&offset=0`)
  assert.equal(
    calls[2].url,
    `http://localhost/imagen-api/history?limit=${LIMITS.history.pageSize}&offset=${LIMITS.history.pageSize}`,
    '加载更多按 offset 逐页请求',
  )
  const enhance = JSON.parse(calls[3].body)
  assert.equal(enhance.mode, 'translate', '英译请求必须带 mode=translate')
  assert.equal(enhance.prompt, '雨夜街景')
  // 运行设置：GET 与 POST 共用契约里的 /settings 路径，POST 只带部分字段。
  assert.equal(calls[4].url, 'http://localhost/imagen-api/settings', '读取设置必须走契约 ROUTES.settings')
  assert.equal(calls[4].method, 'GET')
  assert.equal(calls[5].url, 'http://localhost/imagen-api/settings', '保存设置必须走契约 ROUTES.settingsSave')
  assert.equal(calls[5].method, 'POST')
  assert.deepEqual(
    JSON.parse(calls[5].body),
    { idleTimeoutSec: 2700, accelerator: 'NvidiaTeslaP100' },
    '设置请求体是部分字段对象',
  )
  // 界面态：GET 与 POST 共用契约里的 /ui-state 路径，POST 是扁平补丁。
  assert.equal(calls[6].url, 'http://localhost/imagen-api/ui-state', '读取界面态必须走契约 ROUTES.uiState')
  assert.equal(calls[6].method, 'GET')
  assert.equal(calls[7].url, 'http://localhost/imagen-api/ui-state', '保存界面态必须走契约 ROUTES.uiStateSave')
  assert.equal(calls[7].method, 'POST')
  assert.deepEqual(JSON.parse(calls[7].body), { advancedOpen: true }, '界面态请求体是扁平补丁')
  // Kaggle 登录：GET 与 POST 共用契约里的 /kaggle/login；POST body 严格按 action 形状。
  assert.equal(calls[8].url, 'http://localhost/imagen-api/kaggle/login', '读取登录态必须走契约 ROUTES.kaggleLogin')
  assert.equal(calls[8].method, 'GET')
  assert.equal(calls[8].body, null, '读取登录态不应带请求体')
  assert.equal(calls[9].url, 'http://localhost/imagen-api/kaggle/login', '发起登录必须走契约 ROUTES.kaggleLoginAction')
  assert.equal(calls[9].method, 'POST')
  assert.deepEqual(JSON.parse(calls[9].body), { action: 'start' })
  assert.deepEqual(JSON.parse(calls[10].body), { action: 'cancel' })
  assert.deepEqual(
    JSON.parse(calls[11].body),
    { action: 'submit-code', code: 'abcd-efgh-1234' },
    '授权码要先去空白与 code= 前缀再提交',
  )
  // 白名单外的动作不发请求。
  const beforeInvalid = calls.length
  const invalidAction = await kaggleLoginAction('delete-account', 'x')
  assert.equal(invalidAction.ok, false)
  assert.equal(calls.length, beforeInvalid, '非法登录动作不应发出请求')

  // 启动会话：普通启动只带 presetId；换新实例重排额外带 forceNew + replace（旧 Host 忽略未知字段）。
  assert.equal(startCalls.length, 3)
  assert.equal(startCalls[0].url, 'http://localhost/imagen-api/session/start')
  assert.equal(startCalls[0].method, 'POST')
  assert.deepEqual(JSON.parse(startCalls[0].body), { presetId: 'sdxl-lightning' }, '普通启动只带 presetId')
  assert.deepEqual(JSON.parse(startCalls[1].body), { presetId: 'sdxl-lightning', forceNew: true })
  assert.deepEqual(
    JSON.parse(startCalls[2].body),
    { presetId: 'sdxl-lightning', forceNew: true, replace: true },
    '换新实例重排必须同时带 forceNew 与 replace',
  )
})

// ── 工作台界面态持久化（M1：记住「高级设置」折叠状态） ─────────────

// 域 hook 级：挂载读取一次、切换先本地后保存、失败静默回落默认值。
await check('渲染：高级设置折叠状态读取与保存（useStudioUi）', async () => {
  const mountUi = async (options = {}) => {
    const client = await loadClient({
      now: NOW,
      responses: options.responses ?? {},
      failures: options.failures ?? {},
      testBuild: true,
    })
    const React = client.react
    const { useStudioUi } = client.hooks
    const latest = { ui: null }
    function Harness(props) {
      const ui = useStudioUi({ t: props.t, initialView: 'studio', initialPanelMode: 'form' })
      props.latest.ui = ui
      return React.createElement('div', { className: 'ofs-ui-harness' }, String(ui.advancedOpen))
    }
    try {
      await client.mountRaw(Harness, { latest, t: client.internals.i18n.fallbackTranslate('zh') })
      await client.settle()
      return { client, latest }
    } catch (error) {
      client.unmount()
      throw error
    }
  }
  const uiStateRequests = (client, method) => client.requests
    .filter((item) => item.path === '/imagen-api/ui-state' && item.method === method)

  // 宿主记录为展开：挂载后直接展开。
  const opened = await mountUi({
    responses: { '/imagen-api/ui-state': { ok: true, uiState: { advancedOpen: true } } },
  })
  try {
    assert.equal(opened.latest.ui.advancedOpen, true, '挂载时应读取宿主保存的折叠状态')
    assert.equal(uiStateRequests(opened.client, 'GET').length, 1, '挂载只读取一次界面态')
    // 收起：先更新本地状态，再 fire-and-forget 保存扁平补丁。
    opened.latest.ui.toggleAdvancedOpen()
    await opened.client.settle()
    const collapsedTree = await opened.client.rerender()
    assert.equal(collectText(collapsedTree).join(''), 'false', '切换后本地状态应立刻收起')
    assert.deepEqual(
      uiStateRequests(opened.client, 'POST').map((item) => item.body),
      [{ advancedOpen: false }],
      '收起后应保存扁平补丁',
    )
    // 再展开：保存的补丁跟着变。
    opened.latest.ui.toggleAdvancedOpen()
    await opened.client.settle()
    await opened.client.rerender()
    assert.deepEqual(
      uiStateRequests(opened.client, 'POST').map((item) => item.body),
      [{ advancedOpen: false }, { advancedOpen: true }],
    )
  } finally {
    opened.client.unmount()
  }

  // 读取失败：静默回落默认收起，切换仍然可用并尝试保存。
  const failed = await mountUi({ failures: { '/imagen-api/ui-state': 'Failed to fetch' } })
  try {
    assert.equal(failed.latest.ui.advancedOpen, false, '读取失败应按契约默认值收起')
    failed.latest.ui.toggleAdvancedOpen()
    await failed.client.settle()
    await failed.client.rerender()
    assert.equal(failed.latest.ui.advancedOpen, true, '保存失败不影响本地切换')
    assert.deepEqual(
      uiStateRequests(failed.client, 'POST').map((item) => item.body),
      [{ advancedOpen: true }],
      '读取失败后仍应尝试保存',
    )
  } finally {
    failed.client.unmount()
  }

  // 宿主返回未知字段 / 类型错误：只认白名单且类型正确的值。
  const dirty = await mountUi({
    responses: { '/imagen-api/ui-state': { ok: true, uiState: { advancedOpen: 'yes', mystery: 1 } } },
  })
  try {
    assert.equal(dirty.latest.ui.advancedOpen, false, '类型不符的界面态应按默认值处理')
  } finally {
    dirty.client.unmount()
  }
})

// 工作台级：Rail 真的按读取到的折叠态渲染，点击后收起并保存。
await check('渲染：工作台按宿主界面态展开高级设置并保存折叠', async () => {
  const responses = {
    '/imagen-api/state': readyState,
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/ui-state': { ok: true, uiState: { advancedOpen: true } },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    const stepsInput = (node) => node.type === 'input' && node.props?.['aria-label'] === '采样步数'
    assert.equal(findNodes(tree, stepsInput).length, 1, '界面态为展开时应渲染高级设置')
    const toggle = findNodes(
      tree,
      (node) => node.type === 'button'
        && String(node.props?.className).includes('ofs-row-toggle')
        && collectText(node).join('').includes('步数'),
    )[0]
    assert.ok(toggle, '缺少高级设置折叠按钮')
    assert.equal(toggle.props['aria-expanded'], true, '展开态按钮应带 aria-expanded=true')

    toggle.props.onClick()
    await client.settle()
    tree = await client.rerender()
    assert.equal(findNodes(tree, stepsInput).length, 0, '收起后不再渲染高级设置')
    assert.deepEqual(
      client.requests
        .filter((item) => item.path === '/imagen-api/ui-state' && item.method === 'POST')
        .map((item) => item.body),
      [{ advancedOpen: false }],
      '收起后应保存界面态',
    )
  } finally {
    client.unmount()
  }

  // 读取失败：静默回落默认收起，不弹指引卡。
  const fallback = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    failures: { '/imagen-api/ui-state': 'Failed to fetch' },
    testBuild: true,
  })
  try {
    const tree = await fallback.mountRaw(fallback.components.Studio, {})
    assert.equal(
      findNodes(tree, (node) => node.type === 'input' && node.props?.['aria-label'] === '采样步数').length,
      0,
      '读取失败应按默认值收起',
    )
    assert.ok(
      !collectText(tree).join(' | ').includes('连不上本地服务'),
      '界面态读取失败不应弹指引卡',
    )
  } finally {
    fallback.unmount()
  }
})

// 工作台集成：运行中的任务点取消 → 请求契约里的取消接口并刷新宿主快照。
await check('渲染：工作台点取消按钮请求取消接口', async () => {
  const runningState = {
    ...readyState,
    jobs: [
      {
        id: 'job-cancel',
        status: 'running',
        stageCode: 'running',
        progress: { done: 0, total: 2 },
        createdAt: at(-8),
        startedAt: at(-6),
        params: { prompt: '取消这一张' },
      },
    ],
  }
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': runningState,
      '/imagen-api/history': { items: [], limit: LIMITS.history.pageSize, offset: 0, hasMore: false },
      '/imagen-api/library': { favorites: [], deleted: [] },
      '/imagen-api/job/cancel': {
        ok: true,
        job: { id: 'job-cancel', status: 'cancelled', cancelRequested: true, progress: null, params: { prompt: '取消这一张' } },
        disposition: 'dequeued',
      },
    },
    testBuild: true,
  })
  const tree = await client.mountRaw(client.components.Studio, {})
  const button = findNodes(
    tree,
    (node) => node.type === 'button' && node.props?.className === 'ofs-ghost-cancel',
  )[0]
  assert.ok(button, '运行中任务应显示取消按钮')
  button.props.onClick()
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve()
    await new Promise((resolvePromise) => setImmediate(resolvePromise))
  }
  client.unmount()
  assert.ok(
    client.fetches.includes('/imagen-api/job/cancel'),
    `点击取消应请求取消接口，实际请求：${client.fetches.join(', ')}`,
  )
  assert.equal(
    client.fetches.filter((item) => item === '/imagen-api/state').length >= 2,
    true,
    '取消成功后应刷新宿主快照',
  )
})

// ── Kaggle 直连登录（M2：直连模式开关 / 内置 OAuth 登录轮询 / manual 粘贴码 / 超时） ──

const LOGIN_PATH = '/imagen-api/kaggle/login'

/** 构造一个完整的登录视图（形状与契约 LoginView 一致）。 */
const loginView = (patch = {}) => ({
  state: 'idle',
  mode: 'browser',
  url: null,
  message: null,
  username: null,
  startedAt: null,
  finishedAt: null,
  ...patch,
})

const loginRequests = (client, method) => client.requests
  .filter((item) => item.path === LOGIN_PATH && item.method === method)

/**
 * 挂载 useKaggleLogin 的最小 Harness：记录最新 hook 值、toast 与 onDone 回调。
 * responses 与 failures 都是可变对象：轮询类场景在两次请求之间直接改写它们，
 * 模拟宿主登录态变化或网络中断。
 */
async function mountKaggleLogin(options = {}) {
  const responses = options.responses ?? {}
  const failures = options.failures ?? {}
  const client = await loadClient({ now: NOW, responses, failures, testBuild: true })
  const React = client.react
  const { useKaggleLogin } = client.hooks
  assert.equal(typeof useKaggleLogin, 'function', '测试产物应通过 __test.hooks 暴露 useKaggleLogin')
  const latest = { hook: null }
  const toasts = []
  const done = []
  function Harness(props) {
    const hook = useKaggleLogin({
      t: props.t,
      ui: { showToast: (text) => toasts.push(text) },
      onDone: (view) => done.push(view),
    })
    props.latest.hook = hook
    return React.createElement(
      'div',
      { className: 'ofs-login-harness' },
      React.createElement('span', { className: 'ofs-login-state' }, `${hook.login.state}|${hook.login.mode}`),
      React.createElement('span', { className: 'ofs-login-error' }, hook.errorKey || ''),
      React.createElement('span', { className: 'ofs-login-code-error' }, hook.codeErrorKey || ''),
    )
  }
  try {
    await client.mountRaw(Harness, { latest, t: client.internals.i18n.fallbackTranslate('zh') })
    await client.settle()
    return { client, latest, toasts, done, responses, failures }
  } catch (error) {
    client.unmount()
    throw error
  }
}

await check('渲染：直连登录轮询到 done 后回调 onDone（useKaggleLogin）', async () => {
  const responses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending', startedAt: at(0) }) } }
  const mounted = await mountKaggleLogin({ responses })
  try {
    await mounted.latest.hook.start()
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(mounted.latest.hook.login.state, 'pending', '发起后进入等待授权')
    assert.equal(mounted.latest.hook.pending, true, '等待授权期间视为进行中')
    assert.deepEqual(loginRequests(mounted.client, 'POST').map((item) => item.body), [{ action: 'start' }])
    assert.equal(loginRequests(mounted.client, 'GET').length, 0, '发起后按契约 pollMs 延后轮询，不立刻请求')

    // 页面隐藏：停止轮询并清理定时器；回到前台继续等待。
    assert.ok(mounted.client.timers.size > 0, '等待授权期间应有轮询定时器')
    mounted.client.setHidden(true)
    assert.equal(mounted.client.timers.size, 0, '页面隐藏时应清理轮询定时器')
    mounted.client.setHidden(false)
    assert.ok(mounted.client.timers.size > 0, '回到前台应恢复轮询')

    // 第一次轮询仍是 pending：继续等。
    await mounted.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await mounted.client.rerenderRaw()
    assert.equal(loginRequests(mounted.client, 'GET').length, 1)
    assert.equal(mounted.latest.hook.login.state, 'pending')

    // 第二次轮询拿到 done：停止轮询并回调 onDone（组合层据此重跑 probe）。
    responses[LOGIN_PATH] = {
      ok: true,
      login: loginView({ state: 'done', username: 'alice', startedAt: at(0), finishedAt: at(20) }),
    }
    await mounted.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(mounted.latest.hook.login.state, 'done')
    assert.equal(mounted.latest.hook.login.username, 'alice')
    assert.equal(mounted.done.length, 1, 'done 只回调一次')
    assert.equal(mounted.done[0].state, 'done')
    assert.ok(mounted.toasts.includes('Kaggle 登录成功'), `done 应给成功提示：${mounted.toasts.join(' / ')}`)

    // 终态后不再轮询。
    const before = loginRequests(mounted.client, 'GET').length
    await mounted.client.advanceTimers(KAGGLE_LOGIN.pollMs * 4)
    assert.equal(loginRequests(mounted.client, 'GET').length, before, 'done 之后应停止轮询')
  } finally {
    mounted.client.unmount()
  }
  assert.equal(mounted.client.timers.size, 0, '卸载后应清理轮询定时器')
})

await check('渲染：直连登录取消与失败分支（useKaggleLogin）', async () => {
  const responses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } }
  const cancelled = await mountKaggleLogin({ responses })
  try {
    await cancelled.latest.hook.start()
    await cancelled.client.settle()
    await cancelled.client.rerenderRaw()
    await cancelled.latest.hook.cancel()
    await cancelled.client.settle()
    await cancelled.client.rerenderRaw()
    assert.equal(cancelled.latest.hook.login.state, 'cancelled', '取消后回到可重新发起')
    assert.deepEqual(
      loginRequests(cancelled.client, 'POST').map((item) => item.body),
      [{ action: 'start' }, { action: 'cancel' }],
      '取消要 POST action=cancel',
    )
    const beforeCancel = cancelled.client.requests.length
    await cancelled.client.advanceTimers(KAGGLE_LOGIN.pollMs * 3)
    assert.equal(cancelled.client.requests.length, beforeCancel, '取消后不再轮询')
  } finally {
    cancelled.client.unmount()
  }

  // 轮询拿到 failed：按 message 归类原因并停止轮询。
  const failedResponses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } }
  const failed = await mountKaggleLogin({ responses: failedResponses })
  try {
    await failed.latest.hook.start()
    await failed.client.settle()
    failedResponses[LOGIN_PATH] = { ok: true, login: loginView({ state: 'failed', message: 'state mismatch' }) }
    await failed.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await failed.client.settle()
    await failed.client.rerenderRaw()
    assert.equal(failed.latest.hook.login.state, 'failed')
    assert.equal(failed.latest.hook.errorKey, 'studio.guidance.auth.reason.state')
    const beforeFailed = loginRequests(failed.client, 'GET').length
    await failed.client.advanceTimers(KAGGLE_LOGIN.pollMs * 3)
    assert.equal(loginRequests(failed.client, 'GET').length, beforeFailed, 'failed 之后应停止轮询')
  } finally {
    failed.client.unmount()
  }
})

await check('渲染：直连登录 manual 模式粘贴授权码（useKaggleLogin）', async () => {
  const url = 'https://www.kaggle.com/oauth/authorize?code_challenge=abc'
  const responses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending', mode: 'manual', url }) } }
  const mounted = await mountKaggleLogin({ responses })
  try {
    await mounted.latest.hook.start()
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(mounted.latest.hook.login.mode, 'manual')
    // 非法授权码：只给本地校验提示，不发请求。
    const accepted = await mounted.latest.hook.submit('abc')
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(accepted, false)
    assert.equal(mounted.latest.hook.codeErrorKey, 'studio.guidance.auth.codeTooShort')
    assert.equal(
      loginRequests(mounted.client, 'POST').filter((item) => item.body.action === 'submit-code').length,
      0,
      '本地校验不通过不发请求',
    )
    // 合法授权码：清洗后提交；宿主回 done 即收敛。
    responses[LOGIN_PATH] = { ok: true, login: loginView({ state: 'done', username: 'bob' }) }
    const ok = await mounted.latest.hook.submit('  code=abcd-efgh-1234  ')
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(ok, true)
    const submits = loginRequests(mounted.client, 'POST').filter((item) => item.body.action === 'submit-code')
    assert.deepEqual(submits[0].body, { action: 'submit-code', code: 'abcd-efgh-1234' }, '授权码去空白与 code= 前缀后提交')
    assert.equal(mounted.latest.hook.login.state, 'done')
    assert.equal(mounted.done.length, 1)
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：直连登录超时 / 网络失败一次提示 / 接口不可用（useKaggleLogin）', async () => {
  // 宿主一直 pending：客户端按契约 timeoutMs 兜底，收敛为可重试的失败态。
  const pendingResponses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } }
  const timeout = await mountKaggleLogin({ responses: pendingResponses })
  try {
    await timeout.latest.hook.start()
    await timeout.client.settle()
    await timeout.client.advanceTimers(KAGGLE_LOGIN.timeoutMs + KAGGLE_LOGIN.pollMs)
    await timeout.client.settle()
    await timeout.client.rerenderRaw()
    assert.equal(timeout.latest.hook.login.state, 'failed', '等待超时应收敛为 failed')
    assert.equal(timeout.latest.hook.errorKey, 'studio.guidance.auth.reason.timeout')
    const timeoutGets = loginRequests(timeout.client, 'GET').length
    assert.ok(timeoutGets > 0, '超时前应实际轮询过')
    await timeout.client.advanceTimers(KAGGLE_LOGIN.pollMs * 3)
    assert.equal(loginRequests(timeout.client, 'GET').length, timeoutGets, '超时后停止轮询')
  } finally {
    timeout.client.unmount()
  }

  // 轮询时网络失败：只提示一次并停止轮询，不做无限重试。
  const failures = {}
  const network = await mountKaggleLogin({
    responses: { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } },
    failures,
  })
  try {
    await network.latest.hook.start()
    await network.client.settle()
    failures[LOGIN_PATH] = 'Failed to fetch'
    await network.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await network.client.settle()
    await network.client.rerenderRaw()
    assert.equal(network.latest.hook.login.state, 'failed')
    assert.equal(network.latest.hook.errorKey, 'studio.guidance.auth.reason.network')
    assert.equal(
      network.toasts.filter((text) => text === '网络连接失败，登录没有完成。').length,
      1,
      '网络失败只提示一次',
    )
    const networkGets = loginRequests(network.client, 'GET').length
    await network.client.advanceTimers(KAGGLE_LOGIN.pollMs * 4)
    assert.equal(loginRequests(network.client, 'GET').length, networkGets, '网络失败不无限重试')
  } finally {
    network.client.unmount()
  }

  // 旧宿主没有登录接口（404）：按「接口不可用」提示一次，不轮询、不抛异常。
  const missing = await mountKaggleLogin({ responses: {} })
  try {
    await missing.latest.hook.start()
    await missing.client.settle()
    await missing.client.rerenderRaw()
    assert.equal(missing.latest.hook.login.state, 'failed')
    assert.equal(missing.latest.hook.errorKey, 'studio.guidance.auth.reason.unavailable')
    assert.equal(loginRequests(missing.client, 'GET').length, 0, '接口不可用时不轮询')
  } finally {
    missing.client.unmount()
  }
})

await check('渲染：直连模式指引卡（登录 / 等待 / manual 粘贴码 / 失败 / 取消）', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const manualUrl = 'https://www.kaggle.com/oauth/authorize?code_challenge=abc'
  const makeProps = (overrides = {}, options = {}) => {
    const calls = { start: 0, cancel: 0, probe: 0, submit: [], copy: [] }
    const login = {
      login: { ...loginView(), ...(overrides.login ?? {}) },
      pending: Boolean(overrides.pending),
      busy: Boolean(overrides.busy),
      errorKey: overrides.errorKey ?? '',
      codeErrorKey: overrides.codeErrorKey ?? '',
      start: () => { calls.start += 1 },
      cancel: () => { calls.cancel += 1 },
      submit: (value) => { calls.submit.push(value) },
      reset: () => {},
    }
    return {
      calls,
      props: {
        t,
        guidance: { kind: options.kind ?? 'auth', detail: options.detail ?? '', dismiss: options.dismiss ?? null },
        actions: { resetToSafe: () => {}, retryFocusedJob: () => {} },
        compute: {
          kaggleTransport: 'direct',
          kaggleLogin: login,
          session: null,
          probe: null,
          startSession: () => {},
          runProbe: () => { calls.probe += 1 },
          retryHost: () => {},
        },
        ui: {
          openLogs: () => {},
          copyText: (value, okKey) => calls.copy.push({ value, okKey }),
          copyInstallCommand: () => {},
        },
      },
    }
  }
  try {
    // 1) 未登录：主操作是登录，CLI 相关命令与提示一律不出现。
    const idle = makeProps({}, { detail: '未找到 kaggle 凭据文件' })
    let tree = await client.mountRaw(client.components.GuidanceCard, idle.props)
    let text = collectText(tree).join(' | ')
    for (const needle of ['Kaggle 账号未登录或凭据不可用', '在浏览器中登录 Kaggle', '未找到 kaggle 凭据文件', '%USERPROFILE%\\.kaggle\\credentials.json']) {
      assert.ok(text.includes(needle), `[direct-login] 缺少文案：${needle}（实际：${text}）`)
    }
    for (const banned of ['kaggle auth login', '复制登录命令', 'pip install -U kaggle', '复制安装命令']) {
      assert.ok(!text.includes(banned), `[direct-login] 直连模式不应出现 CLI 文案：${banned}`)
    }
    assert.equal(countByClass(tree, 'ofs-guidance'), 1)
    assert.equal(countByClass(tree, 'ofs-guidance-actions'), 1)
    assert.equal(countByClass(tree, 'ofs-guidance-manual'), 0, '未进入 manual 等待时不显示授权码区')
    const loginButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('在浏览器中登录 Kaggle'),
    )[0]
    assert.ok(loginButton, '缺少登录主操作')
    loginButton.props.onClick()
    assert.equal(idle.calls.start, 1, '登录主操作应调用 start')

    // 2) cli 卡片在直连模式下同样走登录卡，不再提示安装 CLI。
    const cli = makeProps({}, { kind: 'cli' })
    tree = await client.mountRaw(client.components.GuidanceCard, cli.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('在浏览器中登录 Kaggle'), '[direct-login] cli 卡片应改为登录主操作')
    assert.ok(!text.includes('pip install -U kaggle'), '[direct-login] 直连模式不提示安装 CLI')

    // 3) 等待浏览器授权：等待文案 + 取消。
    const pendingBrowser = makeProps({ login: { state: 'pending', mode: 'browser' }, pending: true })
    tree = await client.mountRaw(client.components.GuidanceCard, pendingBrowser.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('正在等待浏览器完成授权…'), `[direct-login] 缺少等待文案：${text}`)
    const cancelButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('取消登录'),
    )[0]
    assert.ok(cancelButton, '缺少取消登录按钮')
    cancelButton.props.onClick()
    assert.equal(pendingBrowser.calls.cancel, 1)
    assert.equal(countByClass(tree, 'ofs-guidance-code-input'), 0, 'browser 模式不显示授权码输入框')

    // 4) manual 模式：可复制的授权链接 + 授权码输入框，空码时提交禁用。
    const pendingManual = makeProps({ login: { state: 'pending', mode: 'manual', url: manualUrl }, pending: true })
    tree = await client.mountRaw(client.components.GuidanceCard, pendingManual.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes(manualUrl), '[direct-login] manual 模式应展示授权链接')
    assert.ok(text.includes('浏览器没有自动打开'), '[direct-login] manual 模式应说明授权链接用途')
    const copyUrl = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('复制授权链接'),
    )[0]
    copyUrl.props.onClick()
    assert.deepEqual(pendingManual.calls.copy, [{ value: manualUrl, okKey: 'studio.guidance.auth.urlCopied' }])
    let codeInput = findNodes(
      tree,
      (node) => node.type === 'input' && String(node.props?.className).includes('ofs-guidance-code-input'),
    )[0]
    assert.ok(codeInput, 'manual 模式缺少授权码输入框')
    assert.equal(codeInput.props.value, '')
    assert.equal(codeInput.props.placeholder, '粘贴浏览器中显示的授权码')
    let submitButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('提交授权码'),
    )[0]
    assert.ok(submitButton)
    assert.equal(submitButton.props.disabled, true, '空授权码时提交应禁用')
    // 输入授权码后提交可用，点击把输入值原样交给 submit（清洗在 hook / 逻辑层）。
    codeInput.props.onChange({ target: { value: ' abcd-efgh ' } })
    tree = await client.rerenderRaw()
    codeInput = findNodes(
      tree,
      (node) => node.type === 'input' && String(node.props?.className).includes('ofs-guidance-code-input'),
    )[0]
    assert.equal(codeInput.props.value, ' abcd-efgh ')
    submitButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('提交授权码'),
    )[0]
    assert.equal(submitButton.props.disabled, false, '有授权码后提交应可用')
    submitButton.props.onClick()
    assert.deepEqual(pendingManual.calls.submit, [' abcd-efgh '])

    // 5) 失败：展示归类后的原因并可重新发起。
    const failed = makeProps({
      login: { state: 'failed', message: 'state mismatch' },
      errorKey: 'studio.guidance.auth.reason.state',
    })
    tree = await client.mountRaw(client.components.GuidanceCard, failed.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('登录失败：授权回调校验失败，请重新发起登录。'), `[direct-login] 缺少失败原因：${text}`)
    const retryButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('重新发起登录'),
    )[0]
    assert.ok(retryButton, '失败后应可重新发起')
    retryButton.props.onClick()
    assert.equal(failed.calls.start, 1)

    // 6) 取消：回到可重新发起。
    const cancelled = makeProps({ login: { state: 'cancelled' } })
    tree = await client.mountRaw(client.components.GuidanceCard, cancelled.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('已取消登录，可重新发起。'), '[direct-login] 取消后应说明可重新发起')
    assert.equal(
      findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('在浏览器中登录 Kaggle')).length,
      1,
      '取消后应能重新发起登录',
    )

    // 7) 授权码本地校验错误提示。
    const codeError = makeProps({
      login: { state: 'pending', mode: 'manual', url: manualUrl },
      pending: true,
      codeErrorKey: 'studio.guidance.auth.codeFormat',
    })
    tree = await client.mountRaw(client.components.GuidanceCard, codeError.props)
    assert.ok(collectText(tree).join(' | ').includes('授权码包含无法识别的字符'), '应展示授权码校验错误')
  } finally {
    client.unmount()
  }
})

await check('渲染：设置抽屉 Kaggle 访问方式开关与保存请求体', async () => {
  const transportView = { ...settingsView, kaggleTransport: 'direct' }
  const mounted = await mountSettingsDrawer(
    { defaultAdvancedOpen: true },
    { view: transportView, savedView: { ...transportView, kaggleTransport: 'cli' } },
  )
  try {
    let text = collectText(mounted.tree).join(' | ')
    for (const needle of ['Kaggle 访问方式', '直连 Kaggle（默认，免安装 CLI）', '本机 kaggle CLI（兼容）']) {
      assert.ok(text.includes(needle), `[settings-transport] 缺少文案：${needle}（实际：${text}）`)
    }
    assert.ok(text.includes('直连模式不需要安装 kaggle CLI'), '默认选中直连时显示免安装说明')
    let radios = findNodes(
      mounted.tree,
      (node) => node.type === 'input' && node.props?.name === 'ofs-kaggle-transport',
    )
    assert.deepEqual(radios.map((node) => node.props.value), ['direct', 'cli'], '访问方式取值来自契约白名单')
    assert.deepEqual(radios.map((node) => node.props.checked), [true, false], '默认选中直连')

    // 切到兼容的 CLI 模式：免安装说明消失，保存按钮可用。
    radios[1].props.onChange()
    const tree = await mounted.client.rerenderRaw()
    text = collectText(tree).join(' | ')
    assert.ok(!text.includes('直连模式不需要安装 kaggle CLI'), '切到 CLI 后不再显示直连说明')
    const saveButton = findNodes(
      tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.equal(saveButton.props.disabled, false, '切换访问方式后保存可用')
    saveButton.props.onClick()
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve()
      await new Promise((resolvePromise) => setImmediate(resolvePromise))
    }
    const posted = mounted.calls.filter((call) => call.method === 'POST')
    assert.equal(posted.length, 1, '只发一次保存请求')
    assert.deepEqual(posted[0].body, { kaggleTransport: 'cli' }, '只提交访问方式补丁')
  } finally {
    mounted.client.unmount()
  }

  // 旧宿主视图缺 kaggleTransport：仍按 CLI 渲染（老宿主没有登录路由），没有改动时保存禁用。
  const legacy = await mountSettingsDrawer({ defaultAdvancedOpen: true })
  try {
    const radios = findNodes(
      legacy.tree,
      (node) => node.type === 'input' && node.props?.name === 'ofs-kaggle-transport',
    )
    assert.deepEqual(radios.map((node) => node.props.checked), [false, true], '旧宿主缺字段时按 CLI 选中')
    assert.ok(!collectText(legacy.tree).join(' | ').includes('直连模式不需要安装 kaggle CLI'))
    const saveButton = findNodes(
      legacy.tree,
      (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save'),
    )[0]
    assert.equal(saveButton.props.disabled, true, '旧视图没有改动时保存禁用')
  } finally {
    legacy.client.unmount()
  }
})

await check('渲染：直连模式顶栏访问方式展示', async () => {
  const directProbe = {
    cli: { present: true, direct: true },
    auth: { ok: false },
    quota: { available: false },
    notes: [],
  }
  const direct = await mountTopBarExpanded(idleShutdownSession, { kaggleTransport: 'direct', probe: directProbe })
  try {
    const plain = collectText(direct.tree).join('')
    assert.ok(plain.includes('直连 · 直连未登录'), `[topbar-direct] 缺少直连状态：${plain}`)
    assert.ok(!plain.includes('命令行'), '[topbar-direct] 直连模式不应再显示命令行')
  } finally {
    direct.client.unmount()
  }

  const cliProbe = {
    cli: { present: true },
    auth: { ok: true },
    quota: { available: true, usedHours: 1, totalHours: 30 },
    notes: [],
  }
  const cli = await mountTopBarExpanded(readyState.session, { probe: cliProbe })
  try {
    const plain = collectText(cli.tree).join('')
    assert.ok(plain.includes('命令行 · 正常'), `[topbar-cli] CLI 模式展示保持不变：${plain}`)
    assert.ok(!plain.includes('直连'), '[topbar-cli] CLI 模式不应出现直连文案')
  } finally {
    cli.client.unmount()
  }
})

await check('渲染：工作台直连模式 auth 指引卡发起登录并在 done 后刷新环境', async () => {
  const directState = {
    ...readyState,
    kaggleTransport: 'direct',
    session: { state: 'error', error: { code: 'auth_required', message: '未找到 kaggle 凭据文件' } },
    probe: {
      cli: { present: true, direct: true },
      auth: { ok: false },
      quota: { available: false },
      notes: ['请先登录 Kaggle'],
    },
  }
  const okState = {
    ...directState,
    session: readyState.session,
    probe: {
      cli: { present: true, direct: true },
      auth: { ok: true },
      quota: { available: true, usedHours: 1, totalHours: 30 },
      notes: [],
    },
  }
  const manualUrl = 'https://www.kaggle.com/oauth/authorize?x=1'
  const responses = {
    '/imagen-api/state': directState,
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending', mode: 'manual', url: manualUrl }) },
    '/imagen-api/probe': { ok: true, probe: okState.probe },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('在浏览器中登录 Kaggle'), `[studio-direct] 直连模式应给登录主操作：${text}`)
    assert.ok(!text.includes('复制登录命令'), '[studio-direct] 直连模式不应出现 CLI 登录命令')
    const loginButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('在浏览器中登录 Kaggle'),
    )[0]
    assert.ok(loginButton, '缺少登录按钮')
    loginButton.props.onClick()
    await client.settle()
    tree = await client.rerenderRaw()
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('正在等待浏览器完成授权…'), '[studio-direct] 点击后应进入等待授权')
    assert.ok(text.includes(manualUrl), '[studio-direct] manual 模式应展示授权链接')
    assert.deepEqual(
      client.requests.filter((item) => item.path === LOGIN_PATH && item.method === 'POST').map((item) => item.body),
      [{ action: 'start' }],
      '发起登录走契约动作形状',
    )

    // 宿主完成授权：轮询到 done 后重跑 probe，账号状态随之刷新。
    responses[LOGIN_PATH] = { ok: true, login: loginView({ state: 'done', username: 'alice' }) }
    responses['/imagen-api/state'] = okState
    await client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await client.settle()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.ok(
      client.requests.some((item) => item.path === '/imagen-api/probe' && item.method === 'POST'),
      `[studio-direct] 登录成功后应重跑 probe，实际请求：${client.requests.map((item) => `${item.method} ${item.path}`).join(', ')}`,
    )
    text = collectText(tree).join(' | ')
    assert.ok(!text.includes('在浏览器中登录 Kaggle'), '[studio-direct] 登录成功且探测通过后应撤掉登录卡')
  } finally {
    client.unmount()
  }
})

await check('渲染：CLI 模式与旧宿主保持原有指引卡行为', async () => {
  const cliState = {
    ...readyState,
    kaggleTransport: 'cli',
    session: { state: 'error', error: { code: 'auth_required', message: '未找到 kaggle 凭据文件' } },
    probe: { cli: { present: true }, auth: { ok: false }, quota: { available: false }, notes: [] },
  }
  const cli = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': cliState,
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    const tree = await cli.mountRaw(cli.components.Studio, {})
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('kaggle auth login'), '[cli-mode] 应保留 CLI 登录命令')
    assert.ok(text.includes('复制登录命令'), '[cli-mode] 应保留复制登录命令动作')
    assert.ok(!text.includes('在浏览器中登录 Kaggle'), '[cli-mode] 不应出现内置登录主操作')
    assert.ok(!cli.requests.some((item) => item.path === LOGIN_PATH), '[cli-mode] CLI 模式不应请求登录接口')
  } finally {
    cli.unmount()
  }

  // 0.8.x 宿主完全没有 kaggleTransport 字段：按 CLI 渲染，不报错、不请求登录接口。
  const legacy = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': {
        ...readyState,
        session: { state: 'error', error: { code: 'cli_missing', message: '未安装 kaggle CLI' } },
        probe: { cli: { present: false }, auth: { ok: false }, quota: { available: false }, notes: [] },
      },
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    const tree = await legacy.mountRaw(legacy.components.Studio, {})
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('pip install -U kaggle'), '[legacy-host] 缺 kaggleTransport 时按 CLI 渲染安装命令')
    assert.ok(text.includes('复制安装命令'), '[legacy-host] 保留 CLI 安装动作')
    assert.ok(!legacy.requests.some((item) => item.path === LOGIN_PATH), '[legacy-host] 不应请求登录接口')
  } finally {
    legacy.unmount()
  }
})

// 测试内探针：校验假 React 替身自身的 hook 语义。替身坏了，上面所有渲染断言都会静默失真，
// 所以这条回归留在测试侧。探针组件不再进入 src/。
await check('渲染：hook 探针（useReducer/useMemo/useLayoutEffect/memo）', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const React = client.react
  const h = React.createElement
  let memoRuns = 0

  function ProbeChildBase(props) {
    return h('span', { className: 'ofs-harness-child' }, props.label)
  }
  const ProbeChild = React.memo(ProbeChildBase)

  function HarnessProbeBase() {
    const [count, dispatch] = React.useReducer((state, action) => (action === 'inc' ? state + 1 : state), 0)
    const doubled = React.useMemo(() => count * 2, [count])
    const memoStamp = React.useMemo(() => {
      memoRuns += 1
      return memoRuns
    }, [])
    React.useLayoutEffect(() => {
      dispatch('inc')
    }, [])
    return h(
      'div',
      { className: 'ofs-harness-probe' },
      h('span', { className: 'ofs-harness-count' }, String(count)),
      h('span', { className: 'ofs-harness-doubled' }, String(doubled)),
      h('span', { className: 'ofs-harness-memo-stamp' }, String(memoStamp)),
      h(ProbeChild, { label: 'memo-child-ok' }),
      h('button', { type: 'button', className: 'ofs-harness-inc', onClick: () => dispatch('inc') }, 'inc'),
    )
  }
  const HarnessProbe = React.memo(HarnessProbeBase)

  const tree = await client.mountRaw(HarnessProbe, {})
  client.unmount()

  const byClass = (className) => findNodes(
    tree,
    (node) => node.type && node.props && node.props.className === className,
  )[0] || null
  const textOf = (node) => (node ? collectText(node).join('') : '')

  assert.equal(countByClass(tree, 'ofs-harness-probe'), 1, '探针应渲染一个根节点')
  // useReducer + useLayoutEffect：挂载时 dispatch 一次，mount 重新渲染后 count 应为 1。
  assert.equal(textOf(byClass('ofs-harness-count')), '1', 'useReducer dispatch 后应触发重渲染')
  // useMemo：依赖 count 变化后应重算（0 × 2 → 1 × 2）。
  assert.equal(textOf(byClass('ofs-harness-doubled')), '2', 'useMemo 应在依赖变化后重算')
  // useMemo：空依赖必须跨渲染复用，若每轮重算这里会变成 2。
  assert.equal(textOf(byClass('ofs-harness-memo-stamp')), '1', '空依赖 useMemo 应跨重渲染复用')
  // memo：包装组件仍可被 serializeTree 正常展开。
  assert.ok(JSON.stringify(serializeTree(tree)).includes('memo-child-ok'), 'memo 包装的子组件应被序列化展开')
  assert.match(HarnessProbe.displayName || '', /^Memo\(/, 'memo 应保留 displayName')
  // 未实现的 hook 要给出明确报错，而不是 undefined is not a function。
  assert.throws(() => client.react.useContext({}), /未实现 useContext/)
})

await check('渲染：顶栏新版本红点与弹层说明', async () => {
  const update = {
    latest: '0.12.0',
    current: '0.11.0',
    enginesDsh: '>=0.2.0',
    releaseUrl: 'https://github.com/nanxfu/dsh-our-imagen/releases/tag/v0.12.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
  }
  const { tree } = await mountTopBarExpanded(idleShutdownSession, { update })
  const plain = collectText(tree).join('')
  assert.ok(plain.includes('新版本 v0.12.0 可用（当前 v0.11.0）'), `[update] 缺少版本提示：${plain}`)
  assert.ok(plain.includes('新版本要求 DSH >=0.2.0'), `[update] 缺少 DSH 要求：${plain}`)
  assert.equal(countByClass(tree, 'ofs-update-dot'), 1, '胶囊上应有版本红点')
  const link = findNodes(
    tree,
    (node) => node.type === 'a' && node.props && node.props.href === update.releaseUrl,
  )[0]
  assert.ok(link, '[update] 缺少更新说明链接')
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noreferrer')
})

await check('渲染：没有新版本时不出现红点与更新说明', async () => {
  const { tree } = await mountTopBarExpanded(idleShutdownSession)
  const plain = collectText(tree).join('')
  assert.equal(countByClass(tree, 'ofs-update-dot'), 0, '无更新时不应出现红点')
  assert.ok(!plain.includes('查看更新说明'), `无更新时不应出现更新说明：${plain}`)
})

// ── 状态流转与局部重绘可用性修复（P0-b / P1） ─────────────────────
//
// 组件层用最小 props 挂载（Rail / Stage），来源策略与重试恢复用 useStudio harness
// 驱动真实状态流转：断言的是「用户操作后发生了什么」，不是内部函数名。

const inpaintPreset = { ...preset, supportsImg2Img: true, supportsInpaint: true }
const nativeInpaintPreset = {
  ...preset,
  id: 'sdxl-inpaint',
  label: 'SDXL Inpaint',
  short: 'Inpaint',
  supportsImg2Img: true,
  supportsInpaint: true,
  inpaintOnly: true,
}

/** useStudio harness：暴露 latest.studio，便于直接驱动动作并断言状态。 */
async function mountStudioHarness(responses) {
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-fix-harness' }, String(studio.form.dirty))
  }
  await client.mountRaw(Harness, {})
  await client.settle()
  await client.rerenderRaw()
  return { client, latest }
}

/** 生成请求列表（只保留 POST /imagen-api/generate）。 */
const generateRequests = (client) => client.requests.filter((item) => item.path === '/imagen-api/generate')

/** 取带某个 class token 的节点。 */
const byClassToken = (tree, token) => findNodes(
  tree,
  (node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(token),
)

/** Rail 渲染替身：参考图区三类形态与蒙版动作的按钮只记录不执行。 */
async function mountReferenceRail(options = {}) {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const calls = { views: [], paints: 0, clears: 0 }
  const form = {
    form: {
      prompt: '',
      negative: '',
      presetId: 'sdxl-lightning',
      width: 1024,
      height: 1024,
      steps: 4,
      cfg: 0,
      seed: '',
      count: 1,
    },
    patchForm: () => {},
    selectPreset: () => {},
    ratioId: '1:1',
    applyRatio: () => {},
    applyCfg: () => {},
    resetSeed: () => {},
    applyCustomSize: () => {},
    negativeActive: false,
    negativeHint: '',
    refineGroups: [],
    refineSource: '',
    enhancing: false,
    enhance: () => {},
    translating: false,
    translate: () => {},
    toggleRefine: () => {},
    useInspiration: () => {},
    englishPromptHint: false,
    reference: null,
    referenceSupported: false,
    referenceBlocked: false,
    strength: LIMITS.strength.default,
    strengthMax: LIMITS.strength.max,
    mask: null,
    inpaintOnly: false,
    inpaintSupported: false,
    applyStrength: () => {},
    removeReference: () => {},
    clearMask: () => { calls.clears += 1 },
    ...(options.form ?? {}),
  }
  const tree = await client.mountRaw(client.components.Rail, {
    t,
    ui: {
      advancedOpen: false,
      setAdvancedOpen: () => {},
      negativeOpen: false,
      setNegativeOpen: () => {},
      panelMode: 'form',
      setPanelMode: () => {},
      setView: (view) => calls.views.push(view),
      requestPaint: () => { calls.paints += 1 },
      ...(options.ui ?? {}),
    },
    form,
    actions: { sending: false, generate: () => {} },
  })
  return { client, tree, calls, t }
}

/** Stage 渲染替身：涂抹态、空舞台与续绘入口。 */
async function mountStageFixture(options = {}) {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const calls = { paints: 0, clears: 0, clearsMask: 0, begins: 0 }
  const reference = options.reference === undefined
    ? { path: historyItem.images[0].path, url: historyItem.images[0].url, width: 1024, height: 1024 }
    : options.reference
  const tree = await client.mountRaw(client.components.Stage, {
    t,
    ui: {
      zoom: false,
      setZoom: () => {},
      copyPath: () => {},
      showToast: () => {},
      paintRequest: options.paintRequest ?? 0,
      clearPaintRequest: () => { calls.clears += 1 },
      ...(options.ui ?? {}),
    },
    compute: { activeJob: null, status: {}, presets: [] },
    form: {
      form: { width: 1024, height: 1024, presetId: 'sdxl-lightning' },
      activePreset: { steps: 25 },
      reference,
      mask: options.mask ?? null,
      inpaintSupported: options.inpaintSupported !== false,
      applyMask: () => ({ ok: true }),
      clearMask: () => { calls.clearsMask += 1 },
      beginMaskEdit: () => { calls.begins += 1 },
      useInspiration: () => {},
      ...(options.form ?? {}),
    },
    library: {
      selected: options.selected === undefined
        ? { image: historyItem.images[0], item: historyItem }
        : options.selected,
      isFavorite: () => false,
      toggleFavorite: () => {},
    },
    actions: {
      iterate: () => {},
      reroll: () => {},
      referenceImage: () => {},
      ...(options.actions ?? {}),
    },
  })
  return { client, tree, calls, t }
}

await check('渲染：参考图空槽位按模型能力门控，画廊入口可点击', async () => {
  // 普通垫图模型：轻量单行入口。
  let mounted = await mountReferenceRail({ form: { referenceSupported: true, inpaintSupported: true } })
  try {
    let tree = mounted.tree
    assert.ok(collectText(tree).join(' | ').includes('可挂一张参考图做垫图重绘'), '普通垫图模型给单行引导')
    assertStructure('reference-empty-simple', tree, {
      required: { 'ofs-reference-entry': 1, 'ofs-reference-pick': 1 },
      forbidden: ['ofs-reference-empty', 'ofs-reference'],
    })
    const pick = byClassToken(tree, 'ofs-reference-pick')[0]
    assert.ok(pick, '空槽位缺少「从作品画廊选择」按钮')
    assert.ok(Number(pick.props.style.minHeight) >= 44, '空槽位按钮触控热区不小于 44px')
    assert.ok(collectText(pick).join('').includes('从作品画廊选择'))
    pick.props.onClick()
    assert.deepEqual(mounted.calls.views, ['gallery'], '点画廊入口应切到画廊视图')
  } finally {
    mounted.client.unmount()
  }

  // 专用局部重绘模型：虚线框 + 两步说明 + 画廊入口。
  mounted = await mountReferenceRail({ form: { referenceSupported: true, inpaintOnly: true, inpaintSupported: true } })
  try {
    const tree = mounted.tree
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('先选一张参考图'), '专用模型空槽位应先提示选参考图')
    assert.ok(text.includes('从作品画廊选一张图，再涂抹要重绘的区域'), '专用模型空槽位应说明第二步涂抹')
    assertStructure('reference-empty-inpaint-only', tree, {
      required: {
        'ofs-reference-empty': 1,
        'ofs-reference-empty-title': 1,
        'ofs-reference-empty-hint': 1,
        'ofs-reference-pick': 1,
      },
      forbidden: ['ofs-reference-entry'],
    })
    byClassToken(tree, 'ofs-reference-pick')[0].props.onClick()
    assert.deepEqual(mounted.calls.views, ['gallery'])
  } finally {
    mounted.client.unmount()
  }

  // 不支持垫图的模型：整块不渲染，纯文生图界面不变。
  mounted = await mountReferenceRail({ form: { referenceSupported: false } })
  try {
    assertStructure('reference-empty-unsupported', mounted.tree, {
      required: {},
      forbidden: ['ofs-reference', 'ofs-reference-entry', 'ofs-reference-empty', 'ofs-reference-pick'],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：参考图区显示蒙版覆盖率，可继续涂抹 / 清空蒙版，强度上限跟随蒙版', async () => {
  const reference = {
    path: historyItem.images[0].path,
    url: historyItem.images[0].url,
    width: 1024,
    height: 1024,
  }
  // 有蒙版：覆盖率读数 + 两个入口 + 强度上限放宽到 inpaintMax。
  let mounted = await mountReferenceRail({
    form: {
      reference,
      referenceSupported: true,
      inpaintSupported: true,
      mask: { data: MASK_PNG_B64, coverage: 0.12, digest: 'd-1' },
      strength: 0.9,
      strengthMax: LIMITS.strength.inpaintMax,
    },
  })
  try {
    let tree = mounted.tree
    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('已涂抹 12%'), `参考图区应显示蒙版覆盖率，实际：${text}`)
    assertStructure('reference-mask-readout', tree, {
      required: {
        'ofs-reference': 1,
        'ofs-reference-mask': 1,
        'ofs-reference-mask-readout': 1,
        'ofs-reference-paint': 1,
        'ofs-reference-clear': 1,
      },
      forbidden: ['ofs-reference-warn'],
    })
    const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    assert.equal(range.props.max, LIMITS.strength.inpaintMax, '有蒙版时滑块上限用 inpaintMax')
    assert.equal(range.props.value, 0.9)
    byClassToken(tree, 'ofs-reference-paint')[0].props.onClick()
    assert.equal(mounted.calls.paints, 1, '「继续涂抹」应请求舞台进入涂抹态')
    byClassToken(tree, 'ofs-reference-clear')[0].props.onClick()
    assert.equal(mounted.calls.clears, 1, '「清空蒙版」应调用清空动作')
    // 页脚标注本次基于哪张参考图重绘。
    assert.ok(collectText(tree).join(' | ').includes('本次基于 7.png 重绘'), '页脚应标注参考图来源')
  } finally {
    mounted.client.unmount()
  }

  // 无蒙版：尚未涂抹、清空按钮禁用、上限回到通用 max。
  mounted = await mountReferenceRail({
    form: {
      reference,
      referenceSupported: true,
      inpaintSupported: true,
      mask: null,
      strength: LIMITS.strength.default,
      strengthMax: LIMITS.strength.max,
    },
  })
  try {
    const tree = mounted.tree
    assert.ok(collectText(tree).join(' | ').includes('尚未涂抹蒙版'))
    const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    assert.equal(range.props.max, LIMITS.strength.max, '无蒙版时滑块上限仍是 img2img 上限')
    assert.equal(byClassToken(tree, 'ofs-reference-clear')[0].props.disabled, true, '没有蒙版时清空按钮禁用')
  } finally {
    mounted.client.unmount()
  }

  // 不支持 Inpaint：不出现蒙版读数与两个入口。
  mounted = await mountReferenceRail({
    form: { reference, referenceSupported: true, inpaintSupported: false, mask: null },
  })
  try {
    assertStructure('reference-mask-unsupported', mounted.tree, {
      required: { 'ofs-reference': 1 },
      forbidden: ['ofs-reference-mask', 'ofs-reference-paint', 'ofs-reference-clear'],
    })
  } finally {
    mounted.client.unmount()
  }

  // strengthMax 的真实值来自表单域：有蒙版 1.0（契约 inpaintMax），否则 0.9。
  const { client: hookClient, latest } = await mountStudioHarness({
    '/imagen-api/state': { ...readyState, presets: [inpaintPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  })
  try {
    const form = () => latest.studio.form
    assert.equal(form().strengthMax, LIMITS.strength.max, '无蒙版时 strengthMax 为 img2img 上限')
    assert.equal(form().applyReference({ image: historyItem.images[0], item: historyItem }).ok, true)
    await hookClient.rerenderRaw()
    assert.equal(form().applyMask({ data: MASK_PNG_B64, coverage: 0.2 }).ok, true)
    await hookClient.rerenderRaw()
    assert.equal(form().strengthMax, LIMITS.strength.inpaintMax, '有蒙版时 strengthMax 为 inpaintMax')
  } finally {
    hookClient.unmount()
  }
})

await check('渲染：Stage 消费涂抹请求自动进入涂抹，空舞台同样可涂抹', async () => {
  // 1) paintRequest > 0 且可涂抹：自动进入涂抹态并消费请求。
  let mounted = await mountStageFixture({ paintRequest: 3 })
  try {
    assertStructure('paint-request-auto', mounted.tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-mask-tools': 1 },
      forbidden: ['ofs-mask-toggle', 'ofs-print'],
    })
    assert.equal(mounted.calls.clears, 1, '消费涂抹请求后必须清掉计数')
    assert.equal(mounted.calls.begins, 1, '自动进入涂抹也要抬升强度')
  } finally {
    mounted.client.unmount()
  }

  // 2) 没有请求：维持普通预览，不擅自进入涂抹。
  mounted = await mountStageFixture({ paintRequest: 0 })
  try {
    assertStructure('paint-request-none', mounted.tree, {
      required: { 'ofs-mask-toggle': 1 },
      forbidden: ['ofs-mask-editor'],
    })
    assert.equal(mounted.calls.clears, 0, '没有请求时不应清计数')
  } finally {
    mounted.client.unmount()
  }

  // 3) 空舞台（没有选中作品）但表单已有参考图：同样提供涂抹入口与编辑器。
  mounted = await mountStageFixture({ selected: null, paintRequest: 0 })
  try {
    let tree = mounted.tree
    assertStructure('empty-stage-paint-entry', tree, {
      required: { 'ofs-mask-toggle': 1, 'ofs-mask-bar': 1, 'ofs-figure--empty': 1 },
      forbidden: ['ofs-mask-editor'],
    })
    assert.ok(collectText(tree).join(' | ').includes('还没有涂抹区域'), '空舞台的涂抹入口也显示蒙版状态')
    byClassToken(tree, 'ofs-mask-toggle')[0].props.onClick()
    tree = await mounted.client.rerenderRaw()
    assertStructure('empty-stage-mask-editor', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1 },
      forbidden: ['ofs-empty-card', 'ofs-frame', 'ofs-mask-toggle'],
    })
    byClassToken(tree, 'ofs-mask-close')[0].props.onClick()
    tree = await mounted.client.rerenderRaw()
    assertStructure('empty-stage-mask-closed', tree, {
      required: { 'ofs-mask-toggle': 1, 'ofs-figure--empty': 1 },
      forbidden: ['ofs-mask-editor'],
    })
  } finally {
    mounted.client.unmount()
  }

  // 4) 空舞台且没有参考图：不出现涂抹入口。
  mounted = await mountStageFixture({ selected: null, reference: null })
  try {
    assertStructure('empty-stage-no-reference', mounted.tree, {
      required: { 'ofs-figure--empty': 1 },
      forbidden: ['ofs-mask-toggle', 'ofs-mask-editor', 'ofs-mask-bar'],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：涂抹画布按参考图比例给出宽高比变量（竖图不被压扁）', async () => {
  // 竖图参考图：画布外框的宽高比与 --ofs-mask-r 都由参考图像素换算，
  // CSS 用它同时约束宽度与可用高度（问题三.2）。
  const mounted = await mountStageFixture({
    reference: { path: 'imagen-output/job-1/portrait.png', url: '/imagen-api/file?path=portrait.png', width: 768, height: 1024 },
    paintRequest: 1,
  })
  try {
    const tree = mounted.tree
    const stageNode = byClassToken(tree, 'ofs-mask-stage')[0]
    assert.ok(stageNode, '涂抹态应挂载画布外框')
    assert.equal(stageNode.props.style['--ofs-mask-r'], '0.75', '宽高比变量按 768×1024 换算')
    assert.equal(stageNode.props.style.aspectRatio, '768 / 1024', '内联 aspect-ratio 与参考图一致')
    assertStructure('mask-stage-ratio', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-mask-photo': 1 },
      forbidden: [],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：舞台动作坞提供「以此结果继续重绘」', async () => {
  const received = []
  let mounted = await mountStageFixture({
    actions: { continueInpaint: (entry) => received.push(entry) },
  })
  try {
    const tree = mounted.tree
    const button = byClassToken(tree, 'ofs-continue-inpaint')[0]
    assert.ok(button, '存在选中作品且支持 Inpaint 时应提供续绘入口')
    assert.ok(collectText(button).join('').includes('以此结果继续重绘'))
    button.props.onClick()
    assert.equal(received.length, 1, '点击应调用 continueInpaint')
    assert.equal(received[0] && received[0].image && received[0].image.path, historyItem.images[0].path, '应把完整选中条目交出去')
  } finally {
    mounted.client.unmount()
  }

  // 当前模型不支持局部重绘：不出现续绘入口。
  mounted = await mountStageFixture({
    inpaintSupported: false,
    actions: { continueInpaint: () => {} },
  })
  try {
    assert.equal(byClassToken(mounted.tree, 'ofs-continue-inpaint').length, 0)
  } finally {
    mounted.client.unmount()
  }

  // 旧调用方没有 continueInpaint 动作：静默不渲染，不能报错。
  mounted = await mountStageFixture({})
  try {
    assert.equal(byClassToken(mounted.tree, 'ofs-continue-inpaint').length, 0)
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：以此结果继续重绘——设为新参考图并自动进入涂抹', async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': { ...readyState, presets: [inpaintPreset], defaultPreset: 'sdxl-lightning' },
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    const tree = await client.mountRaw(client.components.Studio, {})
    assertStructure('continue-before', tree, {
      required: { 'ofs-continue-inpaint': 1, 'ofs-print': 1 },
      forbidden: ['ofs-mask-editor'],
    })
    byClassToken(tree, 'ofs-continue-inpaint')[0].props.onClick()
    const next = await client.rerenderRaw()
    // 结果设为参考图、旧蒙版清空、舞台进入涂抹态：一个动作完成整条续绘闭环。
    assertStructure('continue-after', next, {
      required: { 'ofs-mask-editor': 1, 'ofs-reference': 1, 'ofs-reference-paint': 1 },
      forbidden: ['ofs-print', 'ofs-mask-toggle'],
    })
    const text = collectText(next).join(' | ')
    assert.ok(text.includes('已设为参考图，请涂抹要重绘的区域'), '续绘应提示涂抹下一步')
    assert.ok(text.includes('尚未涂抹蒙版'), '旧蒙版应被清空')
    assert.ok(text.includes('本次基于 7.png 重绘'), '左栏应标注新的参考图来源')
  } finally {
    client.unmount()
  }
})

await check('渲染：涂抹中切换胶卷作品退出涂抹态，参考图与蒙版保留', async () => {
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [inpaintPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  }
  const client = await loadClient({ now: NOW, responses, testBuild: true })
  try {
    // 从画廊设参考图并回到创作视图。
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery' })
    byClassToken(
      tree,
      'ofs-gallery-action',
    ).find((node) => collectText(node).join('').includes('以此图重绘')).props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('switch-thumb-ready', tree, {
      required: { 'ofs-mask-toggle': 1, 'ofs-reference': 1 },
      forbidden: ['ofs-mask-editor', 'ofs-gallery'],
    })
    byClassToken(tree, 'ofs-mask-toggle')[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('switch-thumb-painting', tree, {
      required: { 'ofs-mask-editor': 1 },
      forbidden: ['ofs-print'],
    })

    // 点另一张胶卷作品：退出涂抹态，预览跟随选中作品。
    const thumbs = byClassToken(tree, 'ofs-thumb')
    assert.equal(thumbs.length, 2, '历史批次应有 2 张缩略图')
    const target = thumbs.find((node) => node.key !== historyItem.images[0].path) || thumbs[1]
    target.props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('switch-thumb-after', tree, {
      required: { 'ofs-print': 1, 'ofs-mask-toggle': 1, 'ofs-reference': 1 },
      forbidden: ['ofs-mask-editor'],
    })
  } finally {
    client.unmount()
  }

  // 有蒙版时胶卷点击只换预览：已涂蒙版必须原样留在表单里。
  const { client: hookClient, latest } = await mountStudioHarness({
    '/imagen-api/state': { ...readyState, presets: [inpaintPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  })
  try {
    const form = () => latest.studio.form
    assert.equal(form().applyReference({ image: historyItem.images[0], item: historyItem }).ok, true)
    await hookClient.rerenderRaw()
    assert.equal(form().applyMask({ data: MASK_PNG_B64, coverage: 0.2 }).ok, true)
    await hookClient.rerenderRaw()
    latest.studio.actions.previewWork({ image: historyItem.images[1], item: historyItem })
    await hookClient.rerenderRaw()
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已保留当前参考图与蒙版'),
      '有蒙版的胶卷点击要提示参考图与蒙版已保留',
    )
    assert.equal(form().form.reference.path, historyItem.images[0].path, '参考图必须保留')
    assert.equal(form().form.reference.mask.data, MASK_PNG_B64, '已涂蒙版必须保留')
  } finally {
    hookClient.unmount()
  }
})

await check('渲染：生成来源策略——表单带蒙版提交，助手与变体强制纯文生图', async () => {
  const { client, latest } = await mountStudioHarness({
    '/imagen-api/state': {
      ...readyState,
      presets: [inpaintPreset, nativeInpaintPreset],
      defaultPreset: 'sdxl-lightning',
    },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-src', status: 'queued' },
  })
  try {
    const form = () => latest.studio.form
    form().patchForm({ prompt: '雨夜街景' })
    await client.rerenderRaw()
    assert.equal(form().applyReference({ image: historyItem.images[0], item: historyItem }).ok, true)
    await client.rerenderRaw()
    assert.equal(form().applyMask({ data: MASK_PNG_B64, coverage: 0.2 }).ok, true)
    await client.rerenderRaw()

    // 1) form 来源：参考图 + 蒙版随请求体提交。
    let before = generateRequests(client).length
    assert.equal(await latest.studio.actions.generate(), true)
    await client.settle()
    assert.equal(generateRequests(client).length, before + 1, '表单来源应正常提交')
    let submitted = generateRequests(client).pop()
    assert.deepEqual(submitted.body.reference, {
      path: historyItem.images[0].path,
      strength: LIMITS.strength.default,
      mask: MASK_PNG_B64,
    }, '表单来源请求体应带参考图与蒙版')
    assert.equal(submitted.body.presetId, 'sdxl-lightning')

    // 2) assistant 来源：强制纯文生图，且不改左栏表单挂着的参考图与蒙版。
    before = generateRequests(client).length
    assert.equal(
      await latest.studio.actions.generate({ prompt: '助手提示词' }, { source: 'assistant', pushUser: false }),
      true,
    )
    await client.settle()
    await client.rerenderRaw()
    assert.equal(generateRequests(client).length, before + 1)
    submitted = generateRequests(client).pop()
    assert.ok(!('reference' in submitted.body), '助手来源不得携带参考图')
    assert.ok(!('strength' in submitted.body), '助手来源不得携带重绘强度')
    assert.equal(submitted.body.prompt, '助手提示词')
    assert.equal(form().form.reference.path, historyItem.images[0].path, '助手请求不改左栏参考图')
    assert.equal(form().form.reference.mask.data, MASK_PNG_B64, '助手请求不改左栏蒙版')

    // 3) variant 来源：同样强制纯文生图（保留该作品的提示词与随机种子）。
    before = generateRequests(client).length
    latest.studio.actions.reroll({ image: historyItem.images[1], item: historyItem })
    await client.settle()
    await client.rerenderRaw()
    assert.equal(generateRequests(client).length, before + 1)
    submitted = generateRequests(client).pop()
    assert.ok(!('reference' in submitted.body), '生成变体不得携带参考图')
    assert.equal(submitted.body.count, 1, '生成变体固定一张')
    assert.equal(submitted.body.seed, -1, '生成变体使用随机种子')

    // 4) inpaintOnly 预设 + 助手来源：仅本次请求切到兜底预设并轻提示，左栏表单预设不变。
    form().selectPreset(nativeInpaintPreset)
    await client.rerenderRaw()
    assert.equal(form().inpaintOnly, true)
    before = generateRequests(client).length
    assert.equal(
      await latest.studio.actions.generate({ prompt: '专用预设上的助手请求' }, { source: 'assistant', pushUser: false }),
      true,
    )
    await client.settle()
    await client.rerenderRaw()
    assert.equal(generateRequests(client).length, before + 1)
    submitted = generateRequests(client).pop()
    assert.equal(submitted.body.presetId, 'sdxl-lightning', 'inpaintOnly 预设下助手请求改用兜底预设')
    assert.ok(!('reference' in submitted.body), '改用兜底预设后仍是纯文生图')
    assert.ok(
      latest.studio.ui.toast && latest.studio.ui.toast.text.includes('本次已改用 SDXL Lightning 文生图'),
      '自动切换预设要给轻提示',
    )
    assert.equal(form().form.presetId, 'sdxl-inpaint', '仅覆盖本次请求，不改左栏预设')

    // 5) 表单来源回到 inpaintOnly 预设 + 蒙版：照常带 reference.mask 提交。
    before = generateRequests(client).length
    assert.equal(await latest.studio.actions.generate(), true)
    await client.settle()
    assert.equal(generateRequests(client).length, before + 1)
    submitted = generateRequests(client).pop()
    assert.equal(submitted.body.presetId, 'sdxl-inpaint')
    assert.equal(submitted.body.reference.mask, MASK_PNG_B64, '专用预设的表单来源仍按局部重绘提交')
  } finally {
    client.unmount()
  }
})

await check('渲染：失败重试恢复参考图与蒙版，蒙版不可恢复时只填回参考图并要求重涂', async () => {
  const sourcePath = historyItem.images[0].path
  const failedJob = {
    id: 'job-retry',
    status: 'failed',
    createdAt: at(-60),
    finishedAt: at(-10),
    presetId: 'sdxl-lightning',
    params: {
      prompt: '失败的局部重绘',
      presetId: 'sdxl-lightning',
      width: 1024,
      height: 1024,
      steps: 4,
      cfg: 0,
      reference: { sourcePath, strength: 0.8, mask: true },
    },
    error: { code: 'generation_failed', message: '远端生成失败' },
  }
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [inpaintPreset], defaultPreset: 'sdxl-lightning', lastJob: failedJob },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-retried', status: 'queued' },
  }

  // 分支一：没有同源提交体，蒙版不可恢复 → 不自动提交，填回参考图并请求进入涂抹。
  let harness = await mountStudioHarness(responses)
  try {
    const form = () => harness.latest.studio.form
    const before = generateRequests(harness.client).length
    harness.latest.studio.actions.retryFocusedJob()
    await harness.client.settle()
    await harness.client.rerenderRaw()
    assert.equal(form().form.reference.path, sourcePath, '重试应按失败任务恢复参考图')
    assert.equal(form().form.reference.mask, undefined, '蒙版不可恢复时不得伪造蒙版')
    assert.ok(harness.latest.studio.ui.paintRequest > 0, '恢复参考图后应请求舞台进入涂抹')
    assert.ok(
      harness.latest.studio.ui.toast && harness.latest.studio.ui.toast.text.includes('原任务的蒙版已无法恢复'),
      '蒙版不可恢复要给明确提示',
    )
    assert.equal(generateRequests(harness.client).length, before, '蒙版不可恢复时不得自动提交')
  } finally {
    harness.client.unmount()
  }

  // 分支二：同源提交体仍带完整蒙版 → 恢复参考图与蒙版后按原参数重试。
  harness = await mountStudioHarness(responses)
  try {
    const form = () => harness.latest.studio.form
    form().patchForm({ prompt: '失败的局部重绘' })
    await harness.client.rerenderRaw()
    assert.equal(form().applyReference({ image: historyItem.images[0], item: historyItem }).ok, true)
    await harness.client.rerenderRaw()
    assert.equal(form().applyMask({ data: MASK_PNG_B64, coverage: 0.2 }).ok, true)
    await harness.client.rerenderRaw()
    // 先按表单提交一次，形成与失败任务同源的 pendingRef。
    assert.equal(await harness.latest.studio.actions.generate(), true)
    await harness.client.settle()
    const before = generateRequests(harness.client).length
    harness.latest.studio.actions.retryFocusedJob()
    await harness.client.settle()
    assert.equal(generateRequests(harness.client).length, before + 1, '蒙版可恢复时应直接重试')
    const retried = generateRequests(harness.client).pop()
    assert.equal(retried.body.reference.path, sourcePath, '重试请求带原参考图')
    assert.equal(retried.body.reference.mask, MASK_PNG_B64, '同源提交体的完整蒙版随重试恢复')
    assert.equal(retried.body.reference.strength, 0.8, '重试强度按失败任务恢复')
  } finally {
    harness.client.unmount()
  }
})

await check('渲染：专用局部重绘预设从画廊设参考图后自动进入涂抹', async () => {
  const client = await loadClient({
    now: NOW,
    responses: {
      '/imagen-api/state': {
        ...readyState,
        presets: [inpaintPreset, nativeInpaintPreset],
        defaultPreset: 'sdxl-inpaint',
      },
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    // 从画廊触发：Stage 此刻还没挂载，paintRequest 必须在切回创作视图后仍生效。
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery' })
    byClassToken(
      tree,
      'ofs-gallery-action',
    ).find((node) => collectText(node).join('').includes('以此图重绘')).props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('inpaint-only-auto-paint', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-reference': 1 },
      forbidden: ['ofs-gallery', 'ofs-mask-toggle'],
    })
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('已设为参考图'), '设参考图的提示仍要出现')
    assert.ok(text.includes('尚未涂抹蒙版'), '左栏参考图区应显示蒙版尚未涂抹')
  } finally {
    client.unmount()
  }
})

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1