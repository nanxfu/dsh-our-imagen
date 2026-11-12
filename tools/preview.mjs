/**
 * 设计预览：把工作台渲染成静态 HTML，再用无头浏览器截图。
 *
 * 用途：改样式时先看图，不靠猜。预览用的数据和真实 host 一致，
 * 图片优先用 docs/assets/showcase 下的真实出图（manifest 索引），
 * 只有在 showcase 资产缺失时（干净 clone）才退回本地 SVG 柔光占位图。
 *
 *   node tools/preview.mjs            生成 tools/.preview/*.html
 *   node tools/preview.mjs --shot     生成后调用 Edge 无头截图（1440×900）
 *   node tools/preview.mjs --shot --readme  同时把 4 张 README 截图写回 docs/assets
 *   node tools/preview.mjs --shot --mobile  额外截一张 390 宽的窄屏
 *
 * **已知限制**：静态 HTML 由测试替身渲染，替身的 `window.innerWidth` 固定为 1280，
 * 所以凡是「由 JS 按视口宽度决定」的布局都会被烤死在该宽度上——目前是作品画廊的列数
 * （`src/logic/gallery.js` 按 900 / 1180 / 1400 断点算列）。CSS 媒体查询不受影响，
 * 仍会跟随真实截图窗口。要核对真实列数时，用 `--mobile` 之外的真机/浏览器窗口查看，
 * 或临时把替身的 innerWidth 改掉再渲染；`--readme` 写回的 README 截图同样受此限制。
 */

import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { bundle } from '../build.mjs'
import { PRESETS } from '../shared/contract.js'
import { STYLE_FILES } from '../src/styles/manifest.js'
import { loadClient, TEST_ARTIFACT } from '../test/load-client.mjs'

const execFileAsync = promisify(execFile)
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(ROOT, 'tools/.preview')
const NOW = Date.parse('2026-11-09T05:05:00.000Z')
const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

// 单独挂子组件时组件不会自己注入 <style>，预览层直接读同一组样式文件。
const CSS = (await Promise.all(STYLE_FILES.map((file) => readFile(join(ROOT, 'src/styles', file), 'utf8')))).join('\n')

// ── 占位图：五种中性明度的抽象构图，模拟真实出图的观感（不含主题色） ──
function placeholder(seed, width = 1024, height = 1024) {
  const variant = Math.abs(Math.round(seed * 7.13)) % 5
  const level = (seed * 37) % 5
  const hue = level % 2 === 0 ? 220 : 32
  const sat = 3 + (level % 3)
  const ink = Math.max(16, 42 - level * 5)
  const mid = 62 - level * 6
  const paper = 96 - level * 2
  const id = `p${seed}`
  const defs = `
    <defs>
      <linearGradient id="${id}-bg" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stop-color="hsl(${hue} ${sat}% ${paper}%)"/>
        <stop offset="52%" stop-color="hsl(${hue} ${sat}% ${mid}%)"/>
        <stop offset="100%" stop-color="hsl(${hue} ${sat}% ${ink}%)"/>
      </linearGradient>
      <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.85)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(${hue} ${sat}% ${paper}%)"/>
        <stop offset="100%" stop-color="hsl(${hue} ${sat}% ${Math.max(58, mid - 6)}%)"/>
      </linearGradient>
      <filter id="${id}-blur" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="${Math.max(width, height) * 0.025}"/>
      </filter>
      <filter id="${id}-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.12"/></feComponentTransfer>
      </filter>
    </defs>`

  let scene = ''
  if (variant === 0) {
    scene = `<rect width="${width}" height="${height}" fill="url(#${id}-bg)"/>
      <ellipse cx="${width * 0.7}" cy="${height * 0.34}" rx="${width * 0.22}" ry="${height * 0.22}" fill="url(#${id}-glow)" filter="url(#${id}-blur)"/>
      <circle cx="${width * 0.7}" cy="${height * 0.34}" r="${Math.min(width, height) * 0.18}" fill="url(#${id}-glow)" opacity="0.75"/>`
  } else if (variant === 1) {
    const horizon = height * 0.62
    scene = `<rect width="${width}" height="${height}" fill="url(#${id}-sky)"/>
      <circle cx="${width * 0.68}" cy="${horizon - height * 0.14}" r="${Math.min(width, height) * 0.1}" fill="url(#${id}-glow)" filter="url(#${id}-blur)" opacity="0.9"/>
      <path d="M0 ${horizon} L${width * 0.22} ${horizon - height * 0.16} L${width * 0.4} ${horizon - height * 0.04} L${width * 0.58} ${horizon - height * 0.2} L${width * 0.78} ${horizon - height * 0.07} L${width} ${horizon - height * 0.18} V${height} H0 Z" fill="hsl(${hue} ${sat}% ${Math.max(20, ink + 8)}%)" opacity="0.86"/>
      <path d="M0 ${horizon + height * 0.14} L${width * 0.3} ${horizon + height * 0.02} L${width * 0.62} ${horizon + height * 0.12} L${width} ${horizon - height * 0.02} V${height} H0 Z" fill="hsl(${hue} ${sat}% ${Math.max(12, ink - 6)}%)"/>`
  } else if (variant === 2) {
    const bands = 5
    let paths = ''
    for (let index = 0; index < bands; index += 1) {
      const y = height * (0.3 + index * 0.13)
      const light = Math.max(16, paper - 12 - index * 14)
      paths += `<path d="M0 ${y} C ${width * 0.3} ${y - height * 0.06}, ${width * 0.62} ${y + height * 0.08}, ${width} ${y - height * 0.02} V${height} H0 Z" fill="hsl(${hue} ${sat}% ${light}%)" opacity="${0.9 - index * 0.12}"/>`
    }
    scene = `<rect width="${width}" height="${height}" fill="url(#${id}-bg)"/>${paths}`
  } else if (variant === 3) {
    scene = `<rect width="${width}" height="${height}" fill="hsl(${hue} ${sat}% ${paper}%)"/>
      <path d="M${width * 0.18} ${height} V${height * 0.42} A ${width * 0.32} ${width * 0.32} 0 0 1 ${width * 0.82} ${height * 0.42} V${height} Z" fill="url(#${id}-bg)"/>
      <circle cx="${width * 0.5}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.07}" fill="url(#${id}-glow)" filter="url(#${id}-blur)"/>`
  } else {
    scene = `<rect width="${width}" height="${height}" fill="url(#${id}-bg)"/>
      <path d="M${width * 0.1} ${height * 0.9} C ${width * 0.34} ${height * 0.5}, ${width * 0.46} ${height * 0.36}, ${width * 0.9} ${height * 0.16}" stroke="url(#${id}-glow)" stroke-width="${Math.min(width, height) * 0.22}" fill="none" filter="url(#${id}-blur)" opacity="0.8"/>`
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${defs}
    ${scene}
    <rect width="${width}" height="${height}" filter="url(#${id}-grain)" opacity="0.55"/>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ── 真实作品：docs/assets/showcase 下的 WebP 是用户实际出图（manifest.json 索引） ──
// HTML 落在 tools/.preview/，图片用相对路径引，file:// 打开即可加载。
// manifest 缺失或条目对应文件不在时，下面所有取图都退回 placeholder()，干净 clone 仍可预览。
const SHOWCASE_DIR = join(ROOT, 'docs/assets/showcase')
const SHOWCASE_URL = '../../docs/assets/showcase'

async function readShowcase() {
  try {
    const manifest = JSON.parse(await readFile(join(SHOWCASE_DIR, 'manifest.json'), 'utf8'))
    const items = Array.isArray(manifest.items) ? manifest.items : []
    const usable = []
    for (const item of items) {
      const file = item && typeof item.file === 'string' ? item.file : ''
      const width = Number(item && item.width)
      const height = Number(item && item.height)
      if (!file || !(width > 0) || !(height > 0)) continue
      try {
        await access(join(SHOWCASE_DIR, file))
      } catch {
        continue
      }
      usable.push({ ...item, width, height, url: `${SHOWCASE_URL}/${file}` })
    }
    return usable
  } catch {
    return []
  }
}

const SHOWCASE = await readShowcase()

// 宽高比接近的样张放同一个池：请求 16:9 就从 16:9 的图里轮换，不把竖图塞进横框。
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4']
const RATIO_VALUE = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4 }
function ratioIdOf(width, height) {
  const target = Number(width) / Number(height)
  if (!Number.isFinite(target) || target <= 0) return '1:1'
  let best = RATIOS[0]
  for (const id of RATIOS) {
    if (Math.abs(RATIO_VALUE[id] - target) < Math.abs(RATIO_VALUE[best] - target)) best = id
  }
  return best
}
const SHOWCASE_POOLS = new Map()
for (const entry of SHOWCASE) {
  const id = ratioIdOf(entry.width, entry.height)
  const pool = SHOWCASE_POOLS.get(id) ?? []
  pool.push(entry)
  SHOWCASE_POOLS.set(id, pool)
}

/** manifest 条目 → 组件期望的 image 视图（字段与 /imagen-api/history 一致）。 */
const sampleImage = (entry) => {
  const file = entry.file.replace(/\.webp$/, '.png')
  return {
    path: `imagen-output/showcase/${file}`,
    file,
    url: entry.url,
    seed: entry.seed,
    seconds: entry.seconds,
    width: entry.width,
    height: entry.height,
  }
}

const image = (seed, width = 1024, height = 1024, seconds = 6.2) => {
  const pool = SHOWCASE_POOLS.get(ratioIdOf(width, height))
  if (!pool || pool.length === 0) {
    return {
      path: `imagen-output/job-${seed}/${seed}.png`,
      file: `${seed}.png`,
      url: placeholder(seed, width, height),
      seed,
      seconds,
      width,
      height,
    }
  }
  // 同一个 seed 永远落到同一张真实图，页面之间不会互相错位。
  return sampleImage(pool[Math.abs(Math.round(seed)) % pool.length])
}

// 预览用的预设来自契约（与 /imagen-api/state 的公开视图同形）：去掉仅下发远端使用的 pipeline。
const publicPreset = (id) => {
  const found = PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`预览缺少预设：${id}`)
  const { pipeline, ...rest } = found
  return rest
}
const preset = publicPreset('sdxl-lightning')
const turbo = publicPreset('sdxl-turbo')
const base = publicPreset('sdxl-base')
// 真实 Host 下发全部预设；预览的「就绪 / 空态」也用全量，模型卡才能截到八档。
const allPresets = PRESETS.map(({ pipeline, ...rest }) => rest)

// 历史条目的展示文案要与图片内容对应，避免「图是动漫、文案写赛博朋克」的错位：
// 有真实样张时按标题给一句中文短句；manifest 里的真实提示词留在 rawPrompt，给对话页意图卡用。
const SHOWCASE_COPY = {
  '雨夜霓虹街道': '雨夜霓虹街道，湿地面反射灯光，青绿与品红配色，远处有人撑伞',
  '海边老渔民肖像': '海边老渔民的写实肖像，羊毛衫与围巾，侧窗自然光',
  '云端瀑布梦境': '云端浮岛与瀑布，粉与薄荷色天空，绘本感的梦幻插画',
  '高山湖泊的金色黄昏': '高山湖泊的金色黄昏，雪山倒影与前景松林',
  '巴洛克静物': '巴洛克静物，瓷瓶玫瑰、葡萄与黄铜烛台，深色木桌侧光',
  '赤月下的武士': '赤月下的武士剪影，深色天空与高对比极简构图',
  '极简京都旅行海报': '极简京都旅行海报，红色鸟居与竹林，顶部 KYOTO 字样',
  '樱花巷口的少女': '樱花巷口的动漫少女，校服与飘落花瓣，柔和春日光线',
  '薰衣草花田的黄昏': '薰衣草花田里的白裙少女，日落暖金光，手绘插画感',
  '水墨山水小舟': '水墨山水与江上一叶小舟，大面积留白，角上一枚红印',
  '兔耳双马尾少女': '兔耳双马尾少女坐在圆舱里挥手，白裙与蓝色蝴蝶结，梦幻感的动漫插画',
  '舱中的少女': '灰发绿眼的少女坐在圆舱里挥手，浅蓝色上衣，明快的动漫配色',
  '哥特教堂': '黄昏的哥特教堂，银发少女穿白裙站在彩窗前，石板地面反光',
  '兔耳蓝裙少女': '兔耳发饰的金发双马尾少女，蓝白蝴蝶结裙，明亮柔光',
  '浪与舟': '浮世绘风格的巨浪与一叶小舟，红橙色调，浪尖上的红衣船夫',
  '红日与浪': '红日下的巨浪与一叶小舟，远山与红橙色调的国风海报',
  '初音未来': '初音未来坐在窗边，蓝绿色长双马尾，自然光',
  'Q 版角色四格': '四格 Q 版角色贴纸，赛车帽、独角兽角、海军帽与王冠',
  '荧光森林': '荧光蘑菇撑起树冠的奇幻森林，青绿色微光，漂浮的孢子',
  '和室里的少女': '和室里的黑发少女，白色和服与红色腰带，纸门透光',
  '白发少女': '白发绿眼的动漫少女半身，浅绿色上衣，柔和室内光',
  '和服少女肖像': '和服少女肖像，红色腰带与樱花发饰，浅色背景与竖排题字',
}
// 对话页首条用户消息：跟舞台首图同主题，读起来像真人在提需求。
const SHOWCASE_ASK = {
  '雨夜霓虹街道': '画一张横版的雨夜霓虹街道，要电影感',
  '极简京都旅行海报': '画一张横版的京都旅行海报，红鸟居和竹林',
  '兔耳双马尾少女': '画一张横版的兔耳双马尾少女',
}

const copyOf = (entry) => SHOWCASE_COPY[entry.title] || entry.prompt

/** 意图卡展示的提示词：英文提示词取开头一句；中文提示词原样返回。 */
function intentOf(item) {
  const raw = String(item.rawPrompt || '').trim()
  if (!raw) return item.prompt
  if (!/^[\x20-\x7E]+$/.test(raw.slice(0, 24))) return item.prompt
  // 控制在两行以内：意图卡在对话面板里放不下更长的提示词。
  const head = raw.slice(0, 60)
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf(', '))
  return stop > 25 ? head.slice(0, stop) : head
}

const DAY_SECONDS = 24 * 3600

/** 画廊按 finishedAt 分今天/本周/更早，这里让三档都有内容。 */
function finishedAtOf(index) {
  if (index < 4) return at(-180 - index * 720)
  if (index < 8) return at(-6 * 3600 - (index - 4) * 18 * 3600)
  return at(-(2 + (index - 8)) * DAY_SECONDS - 1800)
}

/** 一张真实样张就是一次生成；第一张是舞台首图，其余按横 / 方 / 竖排，胶卷顺序稳定。 */
function buildShowcaseHistory(entries) {
  const [hero, ...rest] = entries
  const ordered = [
    hero,
    ...rest.filter((entry) => entry.width > entry.height),
    ...rest.filter((entry) => entry.width === entry.height),
    ...rest.filter((entry) => entry.width < entry.height),
  ]
  return ordered.map((entry, index) => ({
    jobId: `job-${9001 + index}`,
    dir: `imagen-output/showcase-${index + 1}`,
    title: entry.title,
    prompt: copyOf(entry),
    rawPrompt: entry.prompt,
    presetId: entry.presetId,
    finishedAt: finishedAtOf(index),
    images: [sampleImage(entry)],
  }))
}

// 兜底：仓库里没有 showcase 资产时（干净 clone），仍旧用占位图把整页预览跑通。
const fallbackHistory = [
  {
    jobId: 'job-9001',
    dir: 'imagen-output/20261109-120301-job-9001',
    prompt: '黄昏的赛博朋克街道，湿润地面反射霓虹灯，电影感构图',
    presetId: 'sdxl-lightning',
    finishedAt: at(-180),
    images: [image(902, 1152, 648), image(901, 1152, 648), image(903, 648, 1152), image(904, 1024, 1024)],
  },
  {
    jobId: 'job-9000',
    dir: 'imagen-output/20261109-115900-job-9000',
    prompt: '东方水墨风格的远山与孤舟，大面积留白',
    presetId: 'sdxl-turbo',
    finishedAt: at(-9 * 3600),
    images: [image(900), image(910, 648, 1152)],
  },
  {
    jobId: 'job-8999',
    dir: 'imagen-output/20261108-190000-job-8999',
    prompt: '3D 黏土质感的小熊，柔和棚拍光',
    presetId: 'sdxl-lightning',
    finishedAt: at(-30 * 3600),
    images: [image(899), image(898)],
  },
  {
    jobId: 'job-8998',
    dir: 'imagen-output/20261105-161500-job-8998',
    prompt: '极简主义的建筑光影，米白墙面与斜射晨光',
    presetId: 'sdxl-base',
    finishedAt: at(-4 * 24 * 3600),
    images: [image(897, 1152, 648), image(896, 1024, 1024), image(895, 648, 1152)],
  },
]

// 真实 Host 的 /imagen-api/history 每条含完整 params（用于「带回参数」）；预览只用提示词与图片，故这里省略。
const historyItems = SHOWCASE.length > 0 ? buildShowcaseHistory(SHOWCASE) : fallbackHistory

// 首图与文案：舞台、表单预填、对话页都从这里取，保证三处口径一致。
const HERO_ITEM = historyItems[0]
const HERO_IMAGE = HERO_ITEM.images[0]
const HERO_PROMPT = HERO_ITEM.prompt
// 对话页演示的是「横版画面」，单独挑一张横图，不和舞台首图的方构图混用。
const CHAT_ITEM = historyItems.find((item) => item.title === '极简京都旅行海报') || historyItems.find((item) => item.images[0].width > item.images[0].height) || HERO_ITEM
const CHAT_IMAGE = CHAT_ITEM.images[0]
const CHAT_ASK = SHOWCASE_ASK[CHAT_ITEM.title] || `帮我画一张：${CHAT_ITEM.prompt}`
const CHAT_INTENT = intentOf(CHAT_ITEM)

const states = {
  ready: {
    defaultPreset: 'sdxl-lightning',
    presets: allPresets,
    session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
    jobs: [],
    lastJob: null,
    probe: {
      provider: 'kaggle',
      cli: { present: true, version: '1.6.17' },
      auth: { ok: true },
      quota: { available: true, usedHours: 3, totalHours: 30 },
      notes: ['kaggle CLI 1.6.17', '账号接入正常'],
    },
  },
  empty: {
    defaultPreset: 'sdxl-lightning',
    presets: allPresets,
    session: { state: 'absent', error: null },
    jobs: [],
    lastJob: null,
  },
  queued: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'provisioning', phase: 'queue', startedAt: at(-120), error: null },
    jobs: [{ id: 'job-x', status: 'waiting-session', startedAt: at(-60), params: { prompt: '荧光森林（排队中）' } }],
    lastJob: null,
  },
  // 两个任务同时在队：第一张在生成，第二张排在后面（宿主的 jobs 最新在前）。
  queueTwo: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
    jobs: [
      { id: 'job-two', status: 'queued', createdAt: at(-5), startedAt: null, params: { prompt: '哥特街道（等待中）' } },
      { id: 'job-one', status: 'running', createdAt: at(-30), startedAt: at(-8), params: { prompt: '兔耳双马尾少女（生成中）' } },
    ],
    lastJob: null,
  },
  pushing: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'provisioning', phase: 'push', startedAt: at(-20), error: null },
    jobs: [{ id: 'job-p', status: 'waiting-session', startedAt: at(-10), params: { prompt: '正在推送任务：荧光森林' } }],
    lastJob: null,
  },
  connecting: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'connecting', phase: 'tunnel', startedAt: at(-150), error: null },
    jobs: [{ id: 'job-c', status: 'waiting-session', startedAt: at(-60), params: { prompt: '正在建立隧道：和室里的少女' } }],
    lastJob: null,
  },
  warming: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'warming', phase: 'warm', startedAt: at(-330), device: 'Tesla T4', error: null },
    jobs: [{ id: 'job-w', status: 'waiting-session', startedAt: at(-200), params: { prompt: '正在装载模型：兔耳蓝裙少女' } }],
    lastJob: null,
  },
  asleep: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'error', error: { code: 'session_ended', message: 'Kernel 已结束（COMPLETE），点「唤醒」可重新启动会话' } },
    jobs: [],
    lastJob: null,
  },
  stopped: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'absent', stoppedByUser: true, error: null },
    jobs: [],
    lastJob: null,
  },
  guidance: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset, turbo],
    session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', error: null },
    jobs: [
      {
        id: 'job-oom',
        status: 'failed',
        startedAt: at(-40),
        finishedAt: at(-30),
        params: { prompt: '过大的画面：4096 × 4096' },
        error: { code: 'oom', message: 'CUDA out of memory' },
        output: { images: [] },
      },
    ],
    lastJob: null,
  },
  cli: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset, turbo],
    session: {
      state: 'error',
      phase: null,
      error: { code: 'cli_missing', message: '未找到 kaggle CLI，请先安装：pip install -U kaggle' },
    },
    jobs: [],
    lastJob: null,
    probe: {
      provider: 'kaggle',
      cli: { present: false, error: 'command not found' },
      auth: { ok: false, errorCode: 'cli_missing' },
      quota: { available: false },
      notes: ['未找到 kaggle CLI，请先安装：pip install -U kaggle'],
    },
  },
}

const libraryResponse = {
  favorites: [historyItems[0]?.images[0]?.path, historyItems[2]?.images[0]?.path].filter(Boolean),
  deleted: [],
}

// 竖构图单独出一页：相纸/取景框的尺寸按比例算，竖图是最容易露馅的一种。
// 把第一张竖图提到最前，舞台首图才是竖幅。
const portraitHistory = (() => {
  const index = historyItems.findIndex((item) => {
    const first = item.images[0]
    return first && first.height > first.width
  })
  if (index <= 0) return historyItems
  const portrait = historyItems[index]
  return [portrait, ...historyItems.filter((item) => item !== portrait)]
})()

// 刚落定的图（60 秒内）会播一次显影；这一页把动画停在半程，用来核对显影中的样子。
const freshHistory = [
  { ...historyItems[0], finishedAt: at(-5) },
  ...historyItems.slice(1),
]

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function styleToText(style) {
  if (!style || typeof style !== 'object') return ''
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      return `${cssKey}:${typeof value === 'number' ? `${value}px` : value}`
    })
    .join(';')
}

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link'])

// React 用驼峰写 SVG 属性，静态 HTML 里必须是连字符名，否则属性失效（渐变会变黑、描边变 1px）。
// 预览是视觉真相，这里补齐，别让截图和真机不一样。
const SVG_ATTRS = {
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  clipPath: 'clip-path',
  clipRule: 'clip-rule',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  paintOrder: 'paint-order',
  textAnchor: 'text-anchor',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  letterSpacing: 'letter-spacing',
}

function attrsOf(props) {
  const attrs = []
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key') continue
    if (value === null || value === undefined || value === false) continue
    if (key === 'style') {
      const text = styleToText(value)
      if (text) attrs.push(`style="${escapeHtml(text)}"`)
      continue
    }
    if (typeof value === 'function') continue
    if (key.startsWith('on')) continue
    const name = SVG_ATTRS[key] || key
    if (key === 'className') {
      attrs.push(`class="${escapeHtml(value)}"`)
      continue
    }
    attrs.push(`${name}="${escapeHtml(String(value))}"`)
  }
  return attrs
}

function toHtml(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')

  const tag = node.type
  // 函数组件就地展开；Fragment 直接吐 children。
  if (typeof tag === 'function') return toHtml(tag({ ...(node.props ?? {}), children: node.children }))
  if (tag === Symbol.for('react.fragment') || typeof tag === 'symbol') return node.children.map(toHtml).join('')
  const props = node.props ?? {}
  if (tag === 'style') return `<style>${node.children.map(String).join('')}</style>`
  // 静态 HTML 里 textarea 的初值只能写在标签之间，写在 value 属性上浏览器不显示。
  if (tag === 'textarea' && props.value != null && node.children.length === 0) {
    return `<textarea ${attrsOf({ ...props, value: undefined }).join(' ')}>${escapeHtml(props.value)}</textarea>`
  }

  const attrs = attrsOf(props)

  if (VOID_TAGS.has(tag)) return `<${tag} ${attrs.join(' ')}>`
  return `<${tag} ${attrs.join(' ')}>${node.children.map(toHtml).join('')}</${tag}>`
}

const FONT = `font-family: -apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;`

// 与 src/styles/tokens.css 的深色块保持同一组值（预览里没有真实的系统深色偏好）。
// 选择器带上 body 提高优先级，确保覆盖样式文件里的浅色变量。
const DARK_TOKENS = `
body .ofs-root {
  --ofs-ground-1: #232326; --ofs-ground-2: #17171a; --ofs-ground-3: #26262a; --ofs-ground-base: #101012;
  --ofs-window: rgb(24 24 27 / 88%); --ofs-window-border: rgb(255 255 255 / 9%);
  --ofs-card: #18181b; --ofs-card-solid: #1c1c20; --ofs-card-border: rgb(255 255 255 / 9%);
  --ofs-hairline: rgb(255 255 255 / 8%); --ofs-sunken: rgb(255 255 255 / 5%); --ofs-sunken-border: rgb(255 255 255 / 9%);
  --ofs-ink: #f2f2f4; --ofs-ink-2: #a4a4ac; --ofs-ink-3: #8d8d95; --ofs-ink-4: #5c5c63;
  --ofs-accent: #f2f2f4; --ofs-accent-2: #c8c8cf; --ofs-accent-ink: #161618;
  --ofs-accent-soft: rgb(255 255 255 / 8%); --ofs-accent-soft-border: rgb(255 255 255 / 14%);
  --ofs-accent-grad: linear-gradient(180deg, #fafafa 0%, #dcdce1 100%);
  --ofs-ok: #58c08a; --ofs-ok-soft: rgb(88 192 138 / 14%);
  --ofs-warn: #d8a55c; --ofs-warn-soft: rgb(216 165 92 / 14%);
  --ofs-error: #e07a7a; --ofs-error-soft: rgb(224 122 122 / 14%);
  --ofs-idle: #8a8a92; --ofs-idle-soft: rgb(255 255 255 / 6%);
  --ofs-shadow-card: 0 1px 2px rgb(0 0 0 / 40%), 0 12px 28px -18px rgb(0 0 0 / 70%);
  --ofs-shadow-lift: 0 2px 6px rgb(0 0 0 / 44%), 0 20px 44px -22px rgb(0 0 0 / 76%);
  --ofs-shadow-window: 0 1px 3px rgb(0 0 0 / 40%), 0 40px 88px -48px rgb(0 0 0 / 88%);
  --ofs-shadow-accent: 0 8px 20px -10px rgb(0 0 0 / 60%);
  --ofs-focus-ring: 0 0 0 3px rgb(255 255 255 / 22%);
  --ofs-mat: #1e1e22; --ofs-mat-lit: rgb(255 255 255 / 7%); --ofs-mat-inner: inset 0 1px 3px rgb(0 0 0 / 36%);
  --ofs-print-paper: #2b2b31; --ofs-print-edge: rgb(255 255 255 / 13%);
  --ofs-print-shadow: 0 22px 44px -24px rgb(0 0 0 / 78%), 0 4px 12px -6px rgb(0 0 0 / 50%);
  --ofs-print-shadow-hover: 0 28px 54px -24px rgb(0 0 0 / 82%), 0 6px 16px -6px rgb(0 0 0 / 54%);
  --ofs-mark: rgb(255 255 255 / 28%);
  background: #101012;
}
`

async function renderState(state, options = {}) {
  const client = await loadClient({
    now: NOW,
    testBuild: true,
    responses: {
      '/imagen-api/state': state,
      '/imagen-api/history': { items: options.history ?? historyItems },
      '/imagen-api/library': libraryResponse,
    },
  })
  if (options.prepare) options.prepare(client)
  const tree = await client.mountRaw(client.components.Studio, options.props ?? {})
  // 序列化要在 unmount 之前：unmount 会还原 Date.now，晚序列化会让「刚出图」判断走样。
  const html = toHtml(tree)
  client.unmount()
  return pageOf(html, options)
}

async function renderGallery(options = {}) {
  const client = await loadClient({
    now: NOW,
    testBuild: true,
    responses: {
      '/imagen-api/state': states.ready,
      '/imagen-api/history': { items: historyItems },
      '/imagen-api/library': libraryResponse,
    },
  })
  const gallery = historyItems.flatMap((item) => item.images.map((image) => ({ image, item })))
  const tree = await client.mountRaw(client.components.Gallery, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    gallery,
    now: NOW,
    presets: states.ready.presets,
    favorites: libraryResponse.favorites,
    onDelete: () => {},
    onExport: () => {},
    onOpen: () => {},
    onRecall: () => {},
    onVariant: () => {},
  })
  client.unmount()
  return pageOf(
    `<div class="ofs-root"><div class="ofs-app"><div class="ofs-body is-gallery"><div class="ofs-main">${toHtml(tree)}</div></div></div></div>`,
    { ...options, injectCss: true },
  )
}

/** 悬浮操作不是静态渲染能体现的，这里用一条覆盖样式把操作条常显出来。 */
async function renderGalleryHover() {
  return renderGallery({
    extraCss: '.ofs-gallery-hover{opacity:1 !important;pointer-events:auto !important}',
  })
}

/** 对话线程的演示消息：首条需求、意图卡、确认、出图结果，都围绕对话页那张横版真实作品。 */
function chatMessages() {
  return [
    { id: 1, role: 'user', text: CHAT_ASK },
    {
      id: 2,
      role: 'assistant',
      kind: 'intent',
      prompt: CHAT_INTENT,
      ratioId: '16:9',
      styleId: 'concept',
      clarify: null,
      source: 'model',
    },
    { id: 3, role: 'user', text: '可以，就这样生成' },
    {
      id: 4,
      role: 'assistant',
      kind: 'job',
      jobId: CHAT_ITEM.jobId,
      stage: 'done',
      text: '已生成，点击缩略图放大。',
      image: CHAT_IMAGE.url,
      meta: `${CHAT_IMAGE.seconds} 秒 · 种子 ${CHAT_IMAGE.seed}`,
    },
  ]
}

async function renderChat(options = {}) {
  const client = await loadClient({
    now: NOW,
    testBuild: true,
    responses: {
      '/imagen-api/state': states.ready,
      '/imagen-api/history': { items: historyItems },
      '/imagen-api/library': libraryResponse,
    },
  })
  const tree = await client.mountRaw(client.components.ChatPanel, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: { panelMode: 'chat', setPanelMode: () => {} },
    form: { patchForm: () => {} },
    chat: {
      messages: chatMessages(),
      interpreting: false,
      interpret: () => {},
      generateIntent: () => {},
      resolveClarify: () => {},
      clearThread: () => {},
    },
    library: { openMessage: () => {} },
    actions: { sending: false },
  })
  client.unmount()
  return pageOf(
    `<div class="ofs-root"><div class="ofs-app"><div class="ofs-body">${toHtml(tree)}<div class="ofs-main"></div></div></div></div>`,
    { ...options, injectCss: true },
  )
}

/**
 * 对话模式的完整工作台：左侧对话线程（含意图卡与出图结果），右侧画面预览，底部胶卷。
 * 单独挂四个真实组件拼成整页，比 studio-chat（右半边空）和 chat-standalone（无舞台）更适合截图。
 */
async function renderChatComposed(options = {}) {
  const client = await loadClient({
    now: NOW,
    testBuild: true,
    responses: {
      '/imagen-api/state': states.ready,
      '/imagen-api/history': { items: historyItems },
      '/imagen-api/library': libraryResponse,
    },
  })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const { TopBar, ChatPanel, Stage, Filmstrip } = client.components
  const selected = { image: CHAT_IMAGE, item: CHAT_ITEM }

  const topBar = await client.mountRaw(TopBar, {
    t,
    isEn: false,
    ui: { view: 'studio', setView: () => {}, openLogs: () => {} },
    compute: {
      sessionState: 'ready',
      session: states.ready.session,
      quota: states.ready.probe.quota,
      presets: states.ready.presets,
      busy: '',
      probing: false,
      probe: states.ready.probe,
      probeReport: null,
      startSession: () => {},
      stopSession: () => {},
      runProbe: () => {},
      openFolder: () => {},
    },
    form: {
      form: { presetId: CHAT_ITEM.presetId, width: CHAT_IMAGE.width, height: CHAT_IMAGE.height, steps: 4, cfg: 0 },
      patchForm: () => {},
    },
    library: { loadHistory: () => {} },
  })

  const chatPanel = await client.mountRaw(ChatPanel, {
    t,
    ui: { panelMode: 'chat', setPanelMode: () => {} },
    form: { patchForm: () => {} },
    chat: {
      messages: chatMessages(),
      interpreting: false,
      interpret: () => {},
      generateIntent: () => {},
      resolveClarify: () => {},
      clearThread: () => {},
    },
    library: { openMessage: () => {} },
    actions: { sending: false },
  })

  const stage = await client.mountRaw(Stage, {
    t,
    ui: { zoom: false, setZoom: () => {}, copyPath: () => {} },
    compute: { activeJob: null, sessionState: 'ready', presets: states.ready.presets, status: { stopped: false } },
    form: {
      form: {
        presetId: CHAT_ITEM.presetId,
        width: CHAT_IMAGE.width,
        height: CHAT_IMAGE.height,
        steps: 4,
        cfg: 1.5,
        seed: '',
        count: 1,
      },
      useInspiration: () => {},
    },
    library: { selected, isFavorite: () => true, toggleFavorite: () => {} },
    actions: { iterate: () => {}, reroll: () => {} },
  })

  const batches = historyItems.map((item) => ({
    key: item.jobId,
    presetId: item.presetId,
    prompt: item.prompt,
    entries: item.images.map((image) => ({ image, item })),
  }))
  const filmstrip = await client.mountRaw(Filmstrip, {
    t,
    ui: { setView: () => {} },
    compute: { pendingJobs: [], sessionState: 'ready', startSession: () => {}, status: { stopped: false } },
    library: { batches, selected, selectImage: () => {} },
    now: NOW,
  })

  client.unmount()

  const body = `<div class="ofs-root"><div class="ofs-app">
${toHtml(topBar)}
<div class="ofs-body">${toHtml(chatPanel)}<div class="ofs-main">${toHtml(stage)}</div></div>
${toHtml(filmstrip)}
</div></div>`
  return pageOf(body, { ...options, injectCss: true })
}

async function renderRefine(options = {}) {
  const client = await loadClient({ now: NOW, testBuild: true })
  const groups = [
    { dimension: 'lighting', options: [{ id: 'a', text: '柔和漫射光', applied: true }, { id: 'b', text: '侧逆光轮廓' }] },
    { dimension: 'material', options: [{ id: 'c', text: '湿润粗糙质感' }, { id: 'd', text: '金属拉丝高光' }] },
    { dimension: 'composition', options: [{ id: 'e', text: '对称中心构图' }, { id: 'f', text: '浅景深电影画幅' }] },
    { dimension: 'atmosphere', options: [{ id: 'g', text: '静谧雾气' }, { id: 'h', text: '漂浮尘埃粒子' }] },
  ]
  const tree = await client.mountRaw(client.components.Rail, {
    t: client.internals.i18n.fallbackTranslate('zh'),
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
        prompt: '雨夜的未来城市街景，湿润地面倒映霓虹招牌，柔和漫射光',
        negative: '',
        presetId: 'sdxl-lightning',
        width: 1024,
        height: 1024,
        steps: 4,
        cfg: 1.5,
        seed: '',
        count: 1,
        styleId: 'cyberpunk',
      },
      patchForm: () => {},
      styleId: 'cyberpunk',
      applyStyle: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      refineGroups: groups,
      refineSource: 'model',
      enhancing: false,
      enhance: () => {},
      toggleRefine: () => {},
      useInspiration: () => {},
    },
    actions: { sending: false, generate: () => {} },
  })
  client.unmount()
  return pageOf(
    `<div class="ofs-root"><div class="ofs-app"><div class="ofs-body">${toHtml(tree)}<div class="ofs-main"></div></div></div></div>`,
    { ...options, injectCss: true },
  )
}

/** 算力弹层：展开态不是静态渲染能体现的，直接挂 TopBar 并给 defaultOpen 截一张。 */
async function renderComputePopover(options = {}) {
  const state = states.ready
  const client = await loadClient({
    now: NOW,
    testBuild: true,
    responses: {
      '/imagen-api/state': state,
      '/imagen-api/history': { items: historyItems },
      '/imagen-api/library': libraryResponse,
    },
  })
  const tree = await client.mountRaw(client.components.TopBar, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: { view: 'studio', setView: () => {}, openLogs: () => {} },
    compute: {
      sessionState: 'ready',
      session: state.session,
      quota: state.probe.quota,
      presets: state.presets,
      busy: '',
      probing: false,
      probe: state.probe,
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
  client.unmount()
  return pageOf(
    `<div class="ofs-root"><div class="ofs-app" style="overflow:visible"><div class="ofs-topbar-slot">${toHtml(tree)}</div></div></div>`,
    { ...options, injectCss: true },
  )
}

function pageOf(body, options = {}) {
  const themeStyle = options.dark ? `<style>${DARK_TOKENS}</style>` : ''
  const cssStyle = options.injectCss ? `<style>${CSS}</style>` : ''
  const extraStyle = options.extraCss ? `<style>${options.extraCss}</style>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;${FONT}}
body{background:${options.dark ? '#0b0b0d' : '#e6e7e9'};padding:0;}
#stage{height:100vh;width:100vw;overflow:hidden;}
.ofs-root{height:100%;}
</style>${cssStyle}${themeStyle}${extraStyle}</head><body><div id="stage">${body}</div></body></html>`
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const testBundle = await bundle({ test: true })
  await writeFile(TEST_ARTIFACT, testBundle, 'utf8')

  const pages = {
    'studio-ready': await renderState(states.ready, { props: { initialPrompt: HERO_PROMPT } }),
    'studio-portrait': await renderState(states.ready, {
      history: portraitHistory,
      props: { initialPrompt: portraitHistory[0].prompt },
    }),
    // 显影动画停在半程：核对「刚落定」这一下的观感，而不是终帧。
    'studio-fresh': await renderState(states.ready, {
      history: freshHistory,
      props: { initialPrompt: HERO_PROMPT },
    }),
    // 第一次出图：还没有任何历史，光桌上只有一只按任务尺寸画出的取景框。
    'studio-pending': await renderState(
      {
        ...states.ready,
        jobs: [{ id: 'job-first', status: 'running', startedAt: at(-8), params: { prompt: '第一张画面：兔耳双马尾少女', width: 720, height: 1280 } }],
      },
      { history: [] },
    ),
    'studio-chat': await renderState(states.ready, { props: { panelMode: 'chat' } }),
    'studio-gallery': await renderState(states.ready, { props: { view: 'gallery' } }),
    'studio-dark': await renderState(states.ready, { dark: true, props: { initialPrompt: HERO_PROMPT } }),
    // 深色 + 空提示词：主操作按钮处于禁用态，用来核对深色下禁用文字仍然可读。
    'studio-disabled-dark': await renderState(states.ready, { dark: true, history: [] }),
    'studio-empty': await renderState(states.empty, { history: [] }),
    'studio-queued': await renderState(states.queued, { history: [] }),
    // 两个任务同时在队：底部左侧应该出现两张卡（进行中 + 排队位次）。
    'studio-queue-two': await renderState(states.queueTwo, { history: [] }),
    'studio-queue-two-dark': await renderState(states.queueTwo, { dark: true, history: [] }),
    'studio-pushing': await renderState(states.pushing, { history: [] }),
    'studio-connecting': await renderState(states.connecting, { history: [] }),
    'studio-warming': await renderState(states.warming, { history: [] }),
    'studio-asleep': await renderState(states.asleep, { history: historyItems }),
    'studio-stopped': await renderState(states.stopped, { history: [] }),
    'studio-guidance': await renderState(states.guidance, { history: historyItems }),
    'studio-cli': await renderState(states.cli, { history: [] }),
    'gallery-wide': await renderGallery(),
    'gallery-hover': await renderGalleryHover(),
    'chat-standalone': await renderChat(),
    'chat-composed': await renderChatComposed(),
    'studio-refine': await renderRefine(),
    'compute-popover': await renderComputePopover(),
    'model-picker': await renderState(states.ready, {
      props: { defaultModelOpen: true, initialPrompt: HERO_PROMPT },
    }),
    'model-picker-dark': await renderState(states.ready, {
      dark: true,
      props: { defaultModelOpen: true, initialPrompt: HERO_PROMPT },
    }),
  }

  for (const [name, html] of Object.entries(pages)) {
    await writeFile(join(OUT_DIR, `${name}.html`), html, 'utf8')
  }
  console.log(`已生成 ${Object.keys(pages).length} 个预览页：${OUT_DIR}`)

  if (!process.argv.includes('--shot')) return

  const shots = Object.keys(pages).map((name) => ({ name, width: 1440, height: 900 }))
  if (process.argv.includes('--mobile')) {
    // Edge headless 的窗口宽度有下限，直接在 390 宽的窗口里截图会按更宽的视口排版。
    // 用一层 390×844 的 iframe 把真实窄屏视口装起来，外层窗口截图就得到真实窄屏布局。
    const frameOf = (src) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#e9eaf2}iframe{display:block;width:390px;height:844px;border:0}</style></head><body><iframe src="${src}"></iframe></body></html>`
    await writeFile(join(OUT_DIR, 'mobile-frame.html'), frameOf('studio-ready.html'), 'utf8')
    await writeFile(join(OUT_DIR, 'mobile-frame-gallery.html'), frameOf('studio-gallery.html'), 'utf8')
    await writeFile(join(OUT_DIR, 'mobile-frame-warming.html'), frameOf('studio-warming.html'), 'utf8')
    shots.push({ name: 'mobile-frame', width: 390, height: 844, out: 'studio-ready-mobile.png' })
    shots.push({ name: 'mobile-frame-gallery', width: 390, height: 844, out: 'studio-gallery-mobile.png' })
    shots.push({ name: 'mobile-frame-warming', width: 390, height: 844, out: 'studio-warming-mobile.png' })
  }

  for (const shot of shots) {
    const htmlPath = join(OUT_DIR, `${shot.name}.html`)
    const shotPath = join(OUT_DIR, shot.out ?? `${shot.name}.png`)
    await execFileAsync(EDGE, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${shot.width},${shot.height}`,
      `--screenshot=${shotPath}`,
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ])
    console.log(`截图：${shotPath}`)
  }

  // README 里的 4 张图固定用这四个页面，路径在 README 中已引用，这里只更新内容。
  if (process.argv.includes('--readme')) {
    const targets = [
      ['studio-ready.png', 'studio-light.png'],
      ['model-picker-dark.png', 'model-picker-dark.png'],
      ['gallery-wide.png', 'gallery.png'],
      ['chat-composed.png', 'chat-tool.png'],
    ]
    for (const [source, target] of targets) {
      await copyFile(join(OUT_DIR, source), join(ROOT, 'docs/assets', target))
      console.log(`README 截图：docs/assets/${target}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
