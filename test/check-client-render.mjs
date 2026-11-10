/**
 * 客户端渲染与产物形状测试（不需要浏览器）。
 *
 * 1. 发布产物 client.js 必须是合法 bundle：导出 inject / apply，且不含测试出口；
 * 2. apply() 注册三个挂载点，且 main.key 与 sidebar.panellist.id 一致；
 * 3. 用假 React 挂载工作台，逐场景比对渲染结构哈希 + 关键文案；
 * 4. 面板两种形态（表单 / 对话）都要能渲染。
 *
 * 运行：node test/check-client-render.mjs [--update]
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundle } from '../build.mjs'
import { loadClient, serializeTree, TEST_ARTIFACT } from './load-client.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const GOLDEN_PATH = join(ROOT, 'test/render-golden.json')
const PROD_ARTIFACT = join(ROOT, 'client.js')
const UPDATE = process.argv.includes('--update')

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

const scenarios = {
  ready: {
    state: readyState,
    history: { items: [historyItem] },
    props: {},
    expect: ['创作设置', '提示词', '风格预设', '画面设置', '高级设置', '立即生成', '带回参数', '在线', '灵感示例', '测试用的荷花池塘'],
    reject: [],
  },
  chat: {
    state: readyState,
    history: { items: [historyItem] },
    props: { panelMode: 'chat' },
    expect: ['创作助手', '描述你想要的画面', '清空对话'],
    reject: [],
  },
  empty: {
    state: { defaultPreset: 'sdxl-lightning', presets: [preset], session: { state: 'absent', error: null }, jobs: [] },
    history: { items: [] },
    props: {},
    expect: ['画面预览', '云端尚未启动'],
    reject: [],
  },
  gallery: {
    state: readyState,
    history: { items: [historyItem] },
    props: {},
    view: 'gallery',
    expect: ['作品画廊', '全部模型', '测试用的荷花池塘', '今天'],
    reject: [],
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
    expect: ['正在申请 GPU', '云端正在排队'],
    reject: [],
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
    expect: ['云端连接中断', '重新唤醒', 'Kernel 推送失败：权限不足'],
    reject: [],
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
  },
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)

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

// 渲染快照
let golden = {}
try {
  golden = JSON.parse(await readFile(GOLDEN_PATH, 'utf8'))
} catch {
  golden = {}
}

const nextGolden = {}
for (const [name, scenario] of Object.entries(scenarios)) {
  await check(`渲染：${name}`, async () => {
    const responses = {
      '/imagen-api/state': scenario.state,
      '/imagen-api/history': scenario.history,
      '/imagen-api/library': { favorites: [], deleted: [] },
    }
    const client = await loadClient({ now: NOW, responses, testBuild: true })
    if (scenario.view === 'gallery') {
      // 画廊是工作台内的一个视图，用组件自身的初始 state 无法直达，这里直接挂 Gallery
      const tree = await client.mountRaw(client.components.Gallery, {
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
      client.unmount()
      const text = collectText(tree).join(' | ')
      for (const needle of scenario.expect) assert.ok(text.includes(needle), `缺少文案：${needle}`)
      const actual = sha(tree)
      nextGolden[name] = { view: actual }
      if (!golden[name] || UPDATE) return
      assert.equal(actual, golden[name].view, '画廊渲染结构与基准不一致（UI 有意变更请 --update）')
      return
    }

    const tree = await client.mountRaw(client.components.Studio, scenario.props ?? {})
    client.unmount()

    const text = collectText(tree).join(' | ')
    for (const needle of scenario.expect) assert.ok(text.includes(needle), `缺少文案：${needle}`)
    for (const needle of scenario.reject ?? []) assert.ok(!text.includes(needle), `不应出现：${needle}`)

    const actual = { view: sha(tree) }
    if (name === 'ready') {
      assert.equal(countByClass(tree, 'ofs-batch'), 1, '同一批次的 2 张图应聚合成 1 个批次卡')
      assert.equal(countByClass(tree, 'ofs-tile'), 5, '风格预设应为 5 个 tile')
      assert.equal(countByClass(tree, 'ofs-fieldset'), 4, '表单应有 4 个分区')
    }
    nextGolden[name] = actual
    if (!golden[name] || UPDATE) return
    assert.equal(actual.view, golden[name].view, '工作台渲染结构与基准不一致（UI 有意变更请 --update）')
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

await check('渲染：hook 探针（useReducer/useMemo/useLayoutEffect/memo）', async () => {
  const client = await loadClient({ now: NOW, responses: {}, testBuild: true })
  const tree = await client.mountRaw(client.components.HarnessProbe, {})
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
  assert.match(client.components.HarnessProbe.displayName || '', /^Memo\(/, 'memo 应保留 displayName')
  // 未实现的 hook 要给出明确报错，而不是 undefined is not a function。
  assert.throws(() => client.react.useContext({}), /未实现 useContext/)
})

if (UPDATE) {
  await writeFile(GOLDEN_PATH, `${JSON.stringify(nextGolden, null, 2)}\n`, 'utf8')
  console.log(`\n已更新基准：${GOLDEN_PATH}`)
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1