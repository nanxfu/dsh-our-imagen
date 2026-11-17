/**
 * 设计预览：把工作台渲染成静态 HTML，再用无头浏览器截图。
 *
 * 用途：改样式时先看图，不靠猜。预览用的数据和真实 host 一致，
 * 图片优先用 docs/assets/showcase 下的真实出图（manifest 索引），
 * 只有在 showcase 资产缺失时（干净 clone）才退回本地 SVG 柔光占位图。
 *
 *   node tools/preview.mjs            生成 tools/.preview/*.html
 *   node tools/preview.mjs --shot     生成后调用无头浏览器截图（1440×900）
 *   node tools/preview.mjs --shot --readme  同时把 4 张 README 截图写回 docs/assets
 *   node tools/preview.mjs --shot --mobile  额外截一张 390 宽的窄屏
 *
 * 可通过环境变量 `IMAGEN_BROWSER` 或 `EDGE_PATH` 指定无头浏览器可执行文件路径。
 */

import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { execFile, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { bundle } from '../build.mjs'
import { TEST_ARTIFACT } from '../test/load-client.mjs'
import { buildPages } from './preview/render.mjs'

const execFileAsync = promisify(execFile)
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(ROOT, 'tools/.preview')

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolveBrowserExecutable() {
  const fromEnv = [process.env.IMAGEN_BROWSER, process.env.EDGE_PATH].filter(Boolean)
  for (const candidate of fromEnv) {
    if (await fileExists(candidate)) return candidate
    throw new Error(`指定的浏览器可执行文件不存在：${candidate}`)
  }

  const candidates = []
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const local = process.env.LOCALAPPDATA
    candidates.push(
      join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ...(local ? [join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe')] : []),
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which'
  for (const cmd of ['msedge', 'microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser']) {
    const probe = spawnSync(lookup, [cmd], { encoding: 'utf8' })
    if (!probe.error && probe.status === 0 && probe.stdout) {
      const first = probe.stdout.trim().split(/\r?\n/)[0]?.trim()
      if (first) return first
    }
  }

  throw new Error('未找到可用的 Chromium/Edge 浏览器，请设置 IMAGEN_BROWSER 或 EDGE_PATH 环境变量')
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const testBundle = await bundle({ test: true })
  await writeFile(TEST_ARTIFACT, testBundle, 'utf8')

  const pages = await buildPages()
  for (const [name, html] of Object.entries(pages)) {
    await writeFile(join(OUT_DIR, `${name}.html`), html, 'utf8')
  }
  console.log(`已生成 ${Object.keys(pages).length} 个预览页：${OUT_DIR}`)

  if (!process.argv.includes('--shot')) return

  const browser = await resolveBrowserExecutable()
  const shots = Object.keys(pages).map((name) => ({ name, width: 1440, height: 900 }))
  if (process.argv.includes('--mobile')) {
    // 无头浏览器窗口宽度有下限，用 390×844 的 iframe 包住目标页才能截出真实窄屏布局。
    const frameOf = (src) =>
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#e9eaf2}iframe{display:block;width:390px;height:844px;border:0}</style></head><body><iframe src="${src}"></iframe></body></html>`
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
    await execFileAsync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      // iframe 包裹的窄屏页需要等内层文档渲染完再截，否则会拍到空画布。
      '--virtual-time-budget=2500',
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
