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
import { LIMITS } from '../shared/contract.js'
// 资源层直接 import 源码：渲染测试已经覆盖 UI，这里补「客户端请求形状」的离线断言。
import {
  cancelJob as cancelJobRequest,
  enhancePromptRequest,
  fetchHistory,
  fetchSettings as fetchSettingsRequest,
  saveSettings as saveSettingsRequest,
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
  steps: 4,
  cfg: 0,
  steadySeconds: 6.2,
  tier: 'fast',
  promptStyle: 'concise',
  negativeHint: 'blurry, low quality, deformed, extra limbs',
}
const turbo = { ...preset, id: 'sdxl-turbo', label: 'SDXL Turbo', short: 'Turbo', description: { zh: '实时低延迟，适合构图灵感与草稿速探', en: 'Real-time low latency, ideal for drafting' }, license: '非商用研究许可', licenseKind: 'restricted', tier: 'usable' }

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
    expect: ['创作设置', '提示词', '风格预设', '画面设置', '高级设置', '立即生成', '带回参数', '云端就绪', '灵感示例', '测试用的荷花池塘'],
    reject: [],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-main': 1,
        'ofs-panel': 1,
        'ofs-panel--form': 1,
        'ofs-fieldset': 4,
        'ofs-tile': 5,
        'ofs-batch': 1,
        'ofs-thumb': 2,
        'ofs-image': 1,
        'ofs-dock': 1,
      },
      forbidden: ['ofs-guidance', 'ofs-panel--chat', 'ofs-gallery', 'ofs-figure--empty', 'ofs-toast', 'ofs-stage-progress', 'ofs-queue-pill'],
    },
  },
  chat: {
    state: readyState,
    history: { items: [historyItem] },
    props: { panelMode: 'chat' },
    expect: ['创作助手', '描述你想要的画面', '清空对话'],
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
        'ofs-fieldset': 4,
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
      forbidden: ['ofs-image', 'ofs-batch', 'ofs-panel--chat', 'ofs-guidance', 'ofs-gallery', 'ofs-stage-progress'],
    },
  },
  gallery: {
    state: readyState,
    history: { items: [historyItem] },
    props: {},
    view: 'gallery',
    expect: ['作品画廊', '全部模型', '测试用的荷花池塘', '今天', '已加载全部作品'],
    reject: [],
    structure: {
      required: {
        'ofs-gallery': 1,
        'ofs-gallery-group': 1,
        'ofs-gallery-card': 1,
        'ofs-gallery-action': 3,
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
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-actions': 1,
        'ofs-stage': 1,
        'ofs-figure--empty': 1,
        'ofs-panel--form': 1,
      },
      forbidden: ['ofs-guidance-command', 'ofs-toast', 'ofs-panel--chat', 'ofs-gallery', 'ofs-image'],
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
    // 胶囊跟随 phase 显示「排队」，进度位说明在等云端；两者不再是同一个词。
    expect: ['正在排队等 GPU', '正在等待 Kaggle 分配 GPU', '等待云端就绪…', '已等待'],
    reject: ['正在装载模型', '云端正在排队'],
    structure: {
      required: {
        'ofs-root': 1,
        'ofs-app': 1,
        'ofs-topbar': 1,
        'ofs-body': 1,
        'ofs-stage': 1,
        'ofs-stage-progress': 1,
        'ofs-progress-label': 1,
        'ofs-sessionbar': 1,
        'ofs-sessionbar-label': 1,
        'ofs-sessionbar-hint': 1,
        'ofs-sessionbar-time': 1,
        'ofs-ghost': 1,
        'ofs-ghost-label': 1,
        'ofs-ghost-time': 1,
        // 窄屏胶片条收起后，队列状态由预览区的迷你胶囊兜底（宽屏由 CSS 隐藏）。
        'ofs-queue-pill': 1,
        'ofs-batch': 1,
        'ofs-image': 1,
      },
      forbidden: ['ofs-guidance', 'ofs-figure--empty', 'ofs-toast'],
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
    expect: ['正在生成…', '排队等待出图…', '8.0秒', '5.0秒', '另有 1 张排队'],
    reject: ['等待云端就绪…'],
    structure: {
      required: {
        'ofs-ghost': 2,
        'ofs-ghost-bar': 1,
        'ofs-ghost-slot': 1,
        'ofs-ghost-label': 2,
        'ofs-ghost-time': 2,
        'ofs-stage-progress': 1,
        // 迷你胶囊只报「当前任务 + 后续排队数」：1 个在跑、1 个排队。
        'ofs-queue-pill': 1,
        'ofs-queue-pill-count': 1,
      },
      forbidden: ['ofs-filmstrip-empty', 'ofs-batch', 'ofs-guidance'],
    },
  },
  // 宿主新下发的 stageCode + progress：进度位必须显示「正在生成第 k/总数 张」，
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
    expect: ['正在生成第 2/4 张'],
    reject: ['生成中 2/4'],
    structure: {
      required: {
        'ofs-stage-progress': 1,
        'ofs-progress-label': 1,
        'ofs-ghost': 1,
        'ofs-queue-pill': 1,
        'ofs-image': 1,
      },
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
    expect: ['正在准备模型', '正在安装运行环境并加载模型权重', '等待云端就绪…'],
    reject: ['正在装载模型', '正在申请 GPU', '已等待'],
    structure: {
      required: {
        'ofs-sessionbar': 1,
        'ofs-sessionbar-label': 1,
        'ofs-stage-progress': 1,
        'ofs-ghost': 1,
      },
      forbidden: ['ofs-sessionbar-time', 'ofs-guidance', 'ofs-figure--empty'],
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
      required: { 'ofs-topbar': 1, 'ofs-filmstrip': 1, 'ofs-figure--empty': 1 },
      forbidden: ['ofs-sessionbar', 'ofs-guidance'],
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
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-actions': 1,
        'ofs-figure--empty': 1,
      },
      forbidden: ['ofs-guidance-command', 'ofs-panel--chat', 'ofs-image', 'ofs-toast'],
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
        'ofs-guidance': 1,
        'ofs-guidance-title': 1,
        'ofs-guidance-detail': 1,
        'ofs-guidance-actions': 1,
        'ofs-figure--empty': 1,
      },
      forbidden: ['ofs-guidance-command', 'ofs-panel--chat', 'ofs-image', 'ofs-toast'],
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
      '凭据文件位于 %USERPROFILE%\\.kaggle\\kaggle.json',
      '打开 Kaggle 设置',
      '重新检查环境',
    ],
    reject: ['生成没有成功'],
    structure: {
      required: {
        'ofs-guidance': 1,
        'ofs-guidance-note': 1,
        'ofs-guidance-actions': 1,
      },
      forbidden: ['ofs-guidance-command', 'ofs-image'],
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
  assert.ok(artifact.includes('id: "dsh-our-free-imagen"'), 'bundle id 必须是包名')
  assert.ok(!artifact.includes('__test'), '发布产物不应包含测试出口')
  assert.ok(artifact.includes('require("react")'), 'react 必须保持 external')
  assert.ok(!/require\(["']\.\//.test(artifact), '不得相对 require 自己的产物')

  const client = await loadClient({ artifact: PROD_ARTIFACT, testBuild: false })
  assert.equal(client.id, 'dsh-our-free-imagen')
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
  const received = { recall: null, variant: null, zoom: null }
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
    onZoom: (value) => { received.zoom = value },
  })
  client.unmount()

  const actions = findNodes(
    tree,
    (node) => node.type === 'button' && node.props && node.props.className === 'ofs-gallery-action',
  )
  assert.equal(actions.length, 3, '每张作品应有带回参数 / 生成变体 / 查看大图三个动作')
  for (const node of actions) node.props.onClick()

  // 回归：曾经把 entry.item 直接传给动作，导致 iteratePatch 拿不到图片而静默失败。
  assert.equal(received.recall && received.recall.item, historyItem, '带回参数应收到 { image, item } 形状的条目')
  assert.equal(received.recall && received.recall.image, historyItem.images[0], '条目里应带图片信息')
  assert.equal(received.variant && received.variant.item, historyItem, '生成变体应收到完整条目')
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

// 英文界面：窄屏队列胶囊走本地化，不能出现宿主硬编码的中文 stage。
await check('渲染：英文界面的窄屏队列胶囊', async () => {
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
  assert.ok(text.includes('Generating image 2 of 3'), `[queue-pill] 英文分张进度应本地化：${text}`)
  assert.ok(text.includes('1 more queued'), '[queue-pill] 英文排队数量应本地化')
  assert.ok(!text.includes('另有'), '[queue-pill] 英文界面不应出现中文队列文案')
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
async function mountTopBarExpanded(session) {
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
        copyText: () => {},
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

    // auth 卡：凭据文件位置 + 保持 API Token 设置页按钮。
    const authTree = await client.mountRaw(client.components.GuidanceCard, {
      ...baseProps,
      guidance: { kind: 'auth', detail: '', dismiss: () => {} },
    })
    const authText = collectText(authTree).join(' | ')
    assert.ok(
      authText.includes('凭据文件位于 %USERPROFILE%\\.kaggle\\kaggle.json'),
      `[auth-card] 缺少 Windows 凭据路径：${authText}`,
    )
    const authLink = findNodes(authTree, (node) => node.type === 'a')[0]
    assert.equal(authLink.props.href, 'https://www.kaggle.com/settings/api')

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

await check('渲染：意图确认卡同时展示英文提示词与中文摘要', async () => {
  const mountIntent = async (message, options = {}) => {
    const lockCalls = []
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
    const tree = await client.mountRaw(client.components.ChatPanel, {
      t,
      ui: { panelMode: 'chat', setPanelMode: () => {} },
      form: { patchForm: () => {} },
      chat: {
        messages: [message],
        interpreting: false,
        interpret: () => {},
        generateIntent: () => {},
        toggleIntentLockSeed: (id) => lockCalls.push(id),
        canLockSeed: options.canLockSeed !== false,
        resolveClarify: () => {},
        clearThread: () => {},
      },
      library: { openMessage: () => {} },
      actions: { sending: false },
    })
    client.unmount()
    return { tree, text: collectText(tree).join(' | '), lockCalls }
  }

  const modelMessage = {
    id: 1,
    role: 'assistant',
    kind: 'intent',
    prompt: 'rainy night city street, wet pavement reflecting neon signs',
    summary: '雨夜城市街景，湿润路面倒映霓虹招牌',
    ratioId: '16:9',
    styleId: 'film',
    clarify: null,
    source: 'model',
  }
  const model = await mountIntent(modelMessage)
  assert.ok(model.text.includes('rainy night city street, wet pavement reflecting neon signs'), '[intent] 应展示英文提示词')
  assert.ok(model.text.includes('雨夜城市街景，湿润路面倒映霓虹招牌'), '[intent] 应展示中文摘要')
  assert.ok(model.text.includes('中文摘要'), '[intent] 摘要应有中文标签')
  assertStructure('intent-model', model.tree, {
    required: {
      'ofs-intent': 1,
      'ofs-intent-prompt': 1,
      'ofs-intent-summary': 1,
      'ofs-intent-summary-label': 1,
      'ofs-intent-lock': 1,
      'ofs-intent-go': 1,
    },
    forbidden: ['ofs-intent-note', 'ofs-intent-question'],
  })

  // 锁种开关默认关闭：不传 lockSeed 的确认卡渲染成未勾选，点一下才把这张卡的状态交回 hook。
  const lockCheckbox = findNodes(
    model.tree,
    (node) => node.type === 'input' && node.props && node.props.type === 'checkbox',
  )[0]
  assert.ok(lockCheckbox, '[intent] 缺少「沿用上张构图」开关')
  assert.equal(lockCheckbox.props.checked, false, '[intent] 锁种开关默认关闭')
  assert.notEqual(lockCheckbox.props.disabled, true, '[intent] 有上一张图时开关可用')
  lockCheckbox.props.onChange()
  assert.deepEqual(model.lockCalls, [1], '[intent] 点开关应把这张卡的 id 交给 toggleIntentLockSeed')

  // 已勾选 + 没有可复用种子两种状态：勾选态来自 message.lockSeed；无种子时置灰。
  const locked = await mountIntent({ ...modelMessage, lockSeed: true })
  const lockedBox = findNodes(
    locked.tree,
    (node) => node.type === 'input' && node.props && node.props.type === 'checkbox',
  )[0]
  assert.equal(lockedBox.props.checked, true, '[intent] lockSeed 打开时开关应勾选')

  const noSeed = await mountIntent(modelMessage, { canLockSeed: false })
  const noSeedBox = findNodes(
    noSeed.tree,
    (node) => node.type === 'input' && node.props && node.props.type === 'checkbox',
  )[0]
  assert.equal(noSeedBox.props.disabled, true, '[intent] 没有上一张图时锁种开关置灰')
  const disabledLabel = findNodes(
    noSeed.tree,
    (node) => node.props && node.props.className === 'ofs-intent-lock is-disabled',
  )[0]
  assert.ok(disabledLabel, '[intent] 置灰态应有对应的结构类名')

  // 本地兜底：prompt 与 summary 都是原文，不重复渲染摘要，改为标注「模型未响应」。
  const local = await mountIntent({ ...modelMessage, prompt: '雨夜街景', summary: '雨夜街景', source: 'local', ratioId: '', styleId: '' })
  assert.ok(local.text.includes('雨夜街景'))
  assert.ok(!local.text.includes('中文摘要'), '[intent] 原文兜底时不应重复显示摘要')
  assert.ok(local.text.includes('模型未响应'), '[intent] 本地兜底应说明来源')
  assertStructure('intent-local', local.tree, {
    required: { 'ofs-intent-note': 1 },
    forbidden: ['ofs-intent-summary'],
  })
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
      form: { prompt: '', negative: '', presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0, seed: '', count: 1, styleId: '' },
      patchForm: () => {},
      selectPreset: () => {},
      styleId: '',
      applyStyle: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      sizeOptions: [],
      selectedSize: null,
      applySize: () => {},
      applyCustomSize: () => {},
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

// 提示词区：「转为英文」按钮与「润色」并列；画面设置区单独一行方形尺寸档位。
await check('渲染：转为英文按钮与方形尺寸档位', async () => {
  const mountRail = async (formExtra = {}) => {
    const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
    const calls = { translate: 0, size: [], patched: [] }
    const form = {
      form: {
        prompt: '雨夜街景',
        negative: 'blurry, my own',
        negativeLayers: { model: 'blurry', style: '', user: 'my own' },
        presetId: 'sdxl-lightning',
        width: 1024,
        height: 1024,
        steps: 4,
        cfg: 0,
        seed: '',
        count: 1,
        styleId: '',
      },
      patchForm: (partial) => calls.patched.push(partial),
      selectPreset: () => {},
      styleId: '',
      applyStyle: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      sizeOptions: [768, 1024, 1152],
      selectedSize: 1024,
      applySize: (size) => calls.size.push(size),
      applyCustomSize: (partial) => calls.patched.push(client.PURE.customSizePatch(partial)),
      refineGroups: [],
      refineSource: '',
      enhancing: false,
      enhance: () => {},
      translating: false,
      translate: () => { calls.translate += 1 },
      toggleRefine: () => {},
      useInspiration: () => {},
      englishPromptHint: false,
      ...formExtra,
    }
    const tree = await client.mountRaw(client.components.Rail, {
      t: client.internals.i18n.fallbackTranslate('zh'),
      ui: {
        advancedOpen: true,
        setAdvancedOpen: () => {},
        negativeOpen: false,
        setNegativeOpen: () => {},
        panelMode: 'form',
        setPanelMode: () => {},
      },
      form,
      actions: { sending: false, generate: () => {} },
    })
    client.unmount()
    return { tree, calls, client }
  }

  const { tree, calls, client } = await mountRail()
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('转为英文'), '提示词区应有「转为英文」按钮')
  assert.ok(text.includes('润色'), '润色按钮仍在，二者并列')
  assert.ok(text.includes('方形尺寸'), '画面设置区应有独立的方形尺寸行')
  assert.ok(text.includes('预设推荐的等宽高尺寸'), '方形尺寸行应附说明，与画幅比例区分')
  // 方形档位：三个数字按钮，当前 1024×1024 精确匹配时选中。
  const sizeButtons = findNodes(
    tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-size'),
  )
  assert.equal(sizeButtons.length, 3, `方形尺寸档位应消费 sizeOptions，实际：${collectText(tree).join(' | ')}`)
  assert.deepEqual(sizeButtons.map((node) => collectText(node).join('')), ['768', '1024', '1152'])
  assert.equal(sizeButtons[1].props['aria-pressed'], true, '宽高等于 1024 时 1024 档位选中')
  sizeButtons[0].props.onClick()
  assert.deepEqual(calls.size, [768], '点击档位应设置宽高为该值')

  // 转英文按钮：点击交给 translate 动作；翻译中显示 loading 文案并禁用。
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

  // 自定义宽高输入：min/max/step 取自契约，失焦时按 clampSize 钳制。
  const widthInput = findNodes(tree, (node) => node.type === 'input' && node.props?.['aria-label'] === '宽')[0]
  const heightInput = findNodes(tree, (node) => node.type === 'input' && node.props?.['aria-label'] === '高')[0]
  assert.ok(widthInput && heightInput, '高级设置应提供自定义宽/高输入')
  assert.equal(widthInput.props.min, LIMITS.width.min)
  assert.equal(widthInput.props.max, LIMITS.width.max)
  assert.equal(widthInput.props.step, LIMITS.width.step)
  assert.equal(heightInput.props.max, LIMITS.height.max)
  assert.equal(widthInput.props.type, 'number')
  widthInput.props.onChange({ target: { value: '1152' } })
  assert.deepEqual(calls.patched.at(-1), { width: '1152' }, '输入过程先原样进表单')
  widthInput.props.onBlur({ target: { value: '99999' } })
  assert.deepEqual(calls.patched.at(-1), { width: LIMITS.width.max }, '失焦时按契约上限钳制')

  const translating = await mountRail({ translating: true })
  const translatingText = collectText(translating.tree).join(' | ')
  assert.ok(translatingText.includes('正在翻译…'), '翻译中按钮显示进行中文案')
  const translatingButton = findNodes(
    translating.tree,
    (node) => node.type === 'button'
      && typeof node.props?.className === 'string'
      && node.props.className.split(' ').includes('ofs-translate-action'),
  )[0]
  assert.equal(translatingButton.props.disabled, true, '翻译中按钮禁用')
  assert.equal(client.PURE.mergeNegativeLayers({ model: 'blurry', style: '', user: 'my own' }), 'blurry, my own')
})

// 资源层请求形状：取消走契约路由 + JSON body；历史拼 limit/offset；英译带 mode。
await check('资源层：取消 / 历史分页 / 英译的请求形状', async () => {
  const savedFetch = globalThis.fetch
  const savedDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
    ? globalThis.document
    : undefined
  const savedHasDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const calls = []
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

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1