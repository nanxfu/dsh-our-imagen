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

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PROD_ARTIFACT = join(ROOT, 'client.js')

const NOW = Date.parse('2026-11-09T05:05:00.000Z')
const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

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
      forbidden: ['ofs-guidance', 'ofs-panel--chat', 'ofs-gallery', 'ofs-figure--empty', 'ofs-toast', 'ofs-stage-progress'],
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
    expect: ['作品画廊', '全部模型', '测试用的荷花池塘', '今天'],
    reject: [],
    structure: {
      required: {
        'ofs-gallery': 1,
        'ofs-gallery-group': 1,
        'ofs-gallery-card': 1,
        'ofs-gallery-action': 3,
      },
      // 画廊是独立视图：不应带整页外壳、舞台、单轨面板或胶片条。
      forbidden: ['ofs-root', 'ofs-topbar', 'ofs-stage', 'ofs-panel', 'ofs-filmstrip', 'ofs-guidance', 'ofs-toast'],
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
        'ofs-batch': 1,
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
    expect: ['本地没有检测到 Kaggle 命令行', 'pip install -U kaggle', '复制安装命令', '重新检查环境', '关闭'],
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
    const client = await loadClient({ now: NOW, responses, testBuild: true })
    const tree = scenario.view === 'gallery'
      // 画廊是工作台内的一个视图，用组件自身的初始 state 无法直达，这里直接挂 Gallery
      ? await client.mountRaw(client.components.Gallery, {
          t: client.internals.i18n.fallbackTranslate('zh'),
          gallery: [{ image: historyItem.images[0], item: historyItem }],
          now: NOW,
          presets: [preset],
          favorites: [],
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