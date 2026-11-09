/**
 * 设计预览：把工作台渲染成静态 HTML，再用无头浏览器截图。
 *
 * 用途：改样式时先看图，不靠猜。预览用的数据和真实 host 一致，
 * 图片换成本地 SVG 占位，避免真的去请求 imagen-api。
 *
 *   node tools/preview.mjs            生成 tools/.preview/*.html
 *   node tools/preview.mjs --shot     生成后调用 Edge 无头截图
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { bundle } from '../build.mjs'
import { loadClient, TEST_ARTIFACT } from '../test/load-client.mjs'

const execFileAsync = promisify(execFile)
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(ROOT, 'tools/.preview')
const NOW = Date.parse('2026-11-09T05:05:00.000Z')
const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

// ── 占位图：按种子生成一张柔和的渐变图，模拟真实出图 ─────────────────────
function placeholder(seed, width = 1024, height = 1024) {
  const hue = (seed * 37) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue} 68% 72%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 48) % 360} 52% 44%)"/>
      </linearGradient>
      <radialGradient id="r" cx="30%" cy="20%" r="80%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.75)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect width="${width}" height="${height}" fill="url(#r)"/>
    <circle cx="${width * 0.72}" cy="${height * 0.68}" r="${width * 0.16}" fill="rgba(255,255,255,0.28)"/>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const image = (seed, width = 1024, height = 1024) => ({
  path: `imagen-output/job-${seed}/${seed}.png`,
  file: `${seed}.png`,
  url: placeholder(seed, width, height),
  seed,
  seconds: 6.2,
  width,
  height,
})

const preset = {
  id: 'sdxl-lightning',
  label: '默认 · 1024 快档',
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
}
const turbo = { ...preset, id: 'sdxl-turbo', label: '极速草稿', license: '非商用研究许可', licenseKind: 'restricted', tier: 'usable' }

const historyItems = [
  {
    jobId: 'job-9001',
    dir: 'imagen-output/20261109-120301-job-9001',
    prompt: '黄昏的赛博朋克街道，湿润地面反射霓虹灯，电影感构图',
    presetId: 'sdxl-lightning',
    finishedAt: at(-180),
    images: [image(901), image(902), image(903), image(904)],
  },
  {
    jobId: 'job-9000',
    dir: 'imagen-output/20261109-115900-job-9000',
    prompt: '东方水墨风格的远山与孤舟，留白',
    presetId: 'sdxl-turbo',
    finishedAt: at(-9 * 3600),
    images: [image(900)],
  },
  {
    jobId: 'job-8999',
    dir: 'imagen-output/20261108-190000-job-8999',
    prompt: '3D 黏土质感的小熊，柔和棚拍光',
    presetId: 'sdxl-lightning',
    finishedAt: at(-30 * 3600),
    images: [image(899), image(898)],
  },
]

const states = {
  ready: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset, turbo],
    session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
    jobs: [],
    lastJob: null,
    probe: { auth: { ok: true }, quota: { available: true, usedHours: 3, totalHours: 30 } },
  },
  empty: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset, turbo],
    session: { state: 'absent', error: null },
    jobs: [],
    lastJob: null,
  },
  queued: {
    defaultPreset: 'sdxl-lightning',
    presets: [preset],
    session: { state: 'provisioning', phase: 'queue', startedAt: at(-120), error: null },
    jobs: [{ id: 'job-x', status: 'waiting-session', startedAt: at(-60), params: { prompt: '排队中的画面' } }],
    lastJob: null,
  },
}

const libraryResponse = { favorites: [image(901).path, image(902).path], deleted: [] }

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
    if (key === 'className') {
      attrs.push(`class="${escapeHtml(value)}"`)
      continue
    }
    attrs.push(`${key}="${escapeHtml(String(value))}"`)
  }

  if (VOID_TAGS.has(tag)) return `<${tag} ${attrs.join(' ')}>`
  return `<${tag} ${attrs.join(' ')}>${node.children.map(toHtml).join('')}</${tag}>`
}

const FONT = `font-family: -apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;`

const DARK_TOKENS = [
  ':root{',
  '--dsw-alias-bg-layer-1:#1b1e26;--dsw-alias-bg-layer-2:#22262f;',
  '--dsw-alias-border-l1:#313643;--dsw-alias-label-primary:#e9ecf2;',
  '--dsw-alias-label-secondary:#a2a9bb;--dsw-alias-brand-primary:#8b95ff;',
  '--dsw-alias-state-success-primary:#3ecf8e;--dsw-alias-state-warn-primary:#f5a524;',
  '--dsw-alias-state-error-primary:#ff6b6b;--dsw-alias-state-idle-primary:#6b7280;',
  '--dsw-alias-bg-canvas:#14161c;',
  '}',
  'body{background:#0f1116;}',
].join('')

async function renderState(name, state, options = {}) {
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
  client.unmount()
  const body = toHtml(tree)
  const darkStyle = options.dark ? `<style>${DARK_TOKENS}</style>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;${FONT}}
body{background:#eef0f6;padding:22px;}
#stage{height:calc(100vh - 44px);border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.16);background:var(--dsw-alias-bg-layer-1,#fff);}
.ofs-root{height:100%}
</style>${darkStyle}</head><body><div id="stage">${body}</div></body></html>`
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const testBundle = await bundle({ test: true })
  await writeFile(TEST_ARTIFACT, testBundle, 'utf8')

  const pages = {
    'studio-ready': await renderState('ready', states.ready),
    'studio-chat': await renderState('ready', states.ready, { props: { panelMode: 'chat' } }),
    'studio-dark': await renderState('ready', states.ready, { dark: true }),
    'studio-empty': await renderState('empty', states.empty, { history: [] }),
    'studio-queued': await renderState('queued', states.queued, { history: historyItems.slice(0, 1) }),
  }

  for (const [name, html] of Object.entries(pages)) {
    await writeFile(join(OUT_DIR, `${name}.html`), html, 'utf8')
  }
  console.log(`已生成 ${Object.keys(pages).length} 个预览页：${OUT_DIR}`)

  if (!process.argv.includes('--shot')) return

  for (const name of Object.keys(pages)) {
    const htmlPath = join(OUT_DIR, `${name}.html`)
    const shotPath = join(OUT_DIR, `${name}.png`)
    await execFileAsync(EDGE, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1440,900',
      `--screenshot=${shotPath}`,
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ])
    console.log(`截图：${shotPath}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})