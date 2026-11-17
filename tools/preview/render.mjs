import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STYLE_FILES } from '../../src/styles/manifest.js'
import { loadClient } from '../../test/load-client.mjs'
import {
  at,
  CHAT_ASK,
  CHAT_IMAGE,
  CHAT_INTENT,
  CHAT_ITEM,
  freshHistory,
  HERO_PROMPT,
  historyItems,
  libraryResponse,
  NOW,
  portraitHistory,
  states,
} from './scenarios.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

// 单独挂子组件时组件不会自己注入 <style>，预览层直接读同一组样式文件。
const STYLES_MAP = await Promise.all(
  STYLE_FILES.map(async (file) => [file, await readFile(join(ROOT, 'src/styles', file), 'utf8')]),
)
const CSS = STYLES_MAP.map(([, css]) => css).join('\n')

/** 从 src/styles/tokens.css 提取深色 .ofs-root 变量块，避免在预览脚本里手写第二份色值。 */
function extractDarkTokensCss(tokensCss) {
  const darkAnchor =
    tokensCss.indexOf('@media (prefers-color-scheme: dark)') >= 0
      ? tokensCss.indexOf('@media (prefers-color-scheme: dark)')
      : tokensCss.indexOf('[data-theme="dark"]')
  if (darkAnchor < 0) throw new Error('src/styles/tokens.css 中未找到深色主题块')
  const rootStart = tokensCss.indexOf('.ofs-root', darkAnchor)
  const openBrace = tokensCss.indexOf('{', rootStart)
  if (rootStart < 0 || openBrace < 0) throw new Error('src/styles/tokens.css 深色块中未找到 .ofs-root { ... }')
  let depth = 0
  let closeBrace = -1
  for (let i = openBrace; i < tokensCss.length; i += 1) {
    if (tokensCss[i] === '{') depth += 1
    else if (tokensCss[i] === '}') {
      depth -= 1
      if (depth === 0) {
        closeBrace = i
        break
      }
    }
  }
  if (closeBrace < 0) throw new Error('src/styles/tokens.css 深色块括号未闭合')
  const body = tokensCss.slice(openBrace + 1, closeBrace).trim()
  // 选择器带上 body 提高优先级，确保在浅色系统的无头浏览器里覆盖默认浅色变量。
  return `body .ofs-root {\n  ${body}\n  background: var(--ofs-ground-base);\n}`
}

const tokensEntry = STYLES_MAP.find(([file]) => file === 'tokens.css')
if (!tokensEntry) throw new Error('STYLE_FILES 缺少 tokens.css')
const DARK_TOKENS = extractDarkTokensCss(tokensEntry[1])

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

export function toHtml(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')

  const tag = node.type
  if (typeof tag === 'function') return toHtml(tag({ ...(node.props ?? {}), children: node.children }))
  if (tag === Symbol.for('react.fragment') || typeof tag === 'symbol') return node.children.map(toHtml).join('')
  const props = node.props ?? {}
  if (tag === 'style') return `<style>${node.children.map(String).join('')}</style>`
  if (tag === 'textarea' && props.value != null && node.children.length === 0) {
    return `<textarea ${attrsOf({ ...props, value: undefined }).join(' ')}>${escapeHtml(props.value)}</textarea>`
  }

  const attrs = attrsOf(props)

  if (VOID_TAGS.has(tag)) return `<${tag} ${attrs.join(' ')}>`
  return `<${tag} ${attrs.join(' ')}>${node.children.map(toHtml).join('')}</${tag}>`
}

const FONT = `font-family: -apple-system, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;`

function pageOf(body, options = {}) {
  const themeStyle = options.dark ? `<style>${DARK_TOKENS}</style>` : ''
  const cssStyle = options.injectCss ? `<style>${CSS}</style>` : ''
  const extraStyle = options.extraCss ? `<style>${options.extraCss}</style>` : ''
  const themeAttr = options.dark ? ' data-theme="dark"' : ''
  return `<!doctype html><html lang="zh-CN"${themeAttr}><head><meta charset="utf-8">
<style>*{box-sizing:border-box}html,body{margin:0;height:100%;${FONT}}
body{background:${options.dark ? '#0b0b0d' : '#e6e7e9'};padding:0;}
#stage{height:100vh;width:100vw;overflow:hidden;}
.ofs-root{height:100%;}
</style>${cssStyle}${themeStyle}${extraStyle}</head><body><div id="stage">${body}</div></body></html>`
}

async function createPreviewClient(state = states.ready, history = historyItems) {
  return loadClient({
    now: NOW,
    testBuild: true,
    responses: {
      '/imagen-api/state': state,
      '/imagen-api/history': { items: history },
      '/imagen-api/library': libraryResponse,
    },
  })
}

async function renderState(state, options = {}) {
  const client = await createPreviewClient(state, options.history ?? historyItems)
  if (options.prepare) options.prepare(client)
  const tree = await client.mountRaw(client.components.Studio, options.props ?? {})
  // 序列化要在 unmount 之前：unmount 会还原 Date.now，晚序列化会让「刚出图」判断走样。
  const html = toHtml(tree)
  client.unmount()
  return pageOf(html, options)
}

async function renderGallery(options = {}) {
  const client = await createPreviewClient()
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

async function renderGalleryHover() {
  return renderGallery({
    extraCss: '.ofs-gallery-hover{opacity:1 !important;pointer-events:auto !important}',
  })
}

function chatMessages() {
  return [
    { id: 1, role: 'user', text: CHAT_ASK },
    {
      id: 2,
      role: 'assistant',
      kind: 'intent',
      prompt: CHAT_INTENT,
      summary: '极简京都旅行海报：红色鸟居与竹林，顶部 KYOTO 字样，横版构图',
      ratioId: '16:9',
      negative: '',
      count: 1,
      lockSeed: false,
      clarify: null,
      modelHint: null,
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

function chatFormStub() {
  return {
    form: { prompt: '', negative: '', presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0, seed: '', count: 1 },
    patchForm: () => {},
    negativeActive: false,
    applyIntent: () => true,
  }
}

async function renderChat(options = {}) {
  const client = await createPreviewClient()
  const tree = await client.mountRaw(client.components.ChatPanel, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: { panelMode: 'chat', setPanelMode: () => {}, showToast: () => {} },
    form: chatFormStub(),
    chat: {
      messages: chatMessages(),
      interpreting: false,
      interpret: () => {},
      generateIntent: () => {},
      resolveClarify: () => {},
      newChat: () => {},
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

async function renderChatComposed(options = {}) {
  const client = await createPreviewClient()
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
    ui: { panelMode: 'chat', setPanelMode: () => {}, showToast: () => {} },
    form: chatFormStub(),
    chat: {
      messages: chatMessages(),
      interpreting: false,
      interpret: () => {},
      generateIntent: () => {},
      resolveClarify: () => {},
      newChat: () => {},
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
      },
      patchForm: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      applyCustomSize: () => {},
      negativeActive: true,
      negativeHint: 'blurry, low quality, deformed, extra limbs',
      applyCfg: () => {},
      resetSeed: () => {},
      refineGroups: groups,
      refineSource: 'model',
      enhancing: false,
      enhance: () => {},
      translating: false,
      translate: () => {},
      toggleRefine: () => {},
      useInspiration: () => {},
      englishPromptHint: false,
    },
    actions: { sending: false, generate: () => {} },
  })
  client.unmount()
  return pageOf(
    `<div class="ofs-root"><div class="ofs-app"><div class="ofs-body">${toHtml(tree)}<div class="ofs-main"></div></div></div></div>`,
    { ...options, injectCss: true },
  )
}

async function renderComputePopover(options = {}) {
  const state = states.ready
  const client = await createPreviewClient(state)
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

export async function buildPages() {
  return {
    'studio-ready': await renderState(states.ready, { props: { initialPrompt: HERO_PROMPT } }),
    'studio-portrait': await renderState(states.ready, {
      history: portraitHistory,
      props: { initialPrompt: portraitHistory[0].prompt },
    }),
    'studio-fresh': await renderState(states.ready, {
      history: freshHistory,
      props: { initialPrompt: HERO_PROMPT },
    }),
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
    'studio-disabled-dark': await renderState(states.ready, { dark: true, history: [] }),
    'studio-empty': await renderState(states.empty, { history: [] }),
    'studio-queued': await renderState(states.queued, { history: [] }),
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
}
