/**
 * 舞台图片工具组件的渲染测试（假 React，不需要浏览器）。
 *
 * 阶段十二的 tool-core 自测：mount 真实的 `useImageTool` + `Stage`，
 * 断言动作坞分组、涂抹画布 / 整图重绘条的挂载与退出、提交按钮的可用性、
 * 蒙版改变时强度上限的联动，以及一次真实的工具提交请求体。
 *
 * 注意：
 *  - 树遍历 helper 与其它渲染测试共用 `test/helpers/render.mjs`；
 *  - 需要测试产物：运行时先 `bundle({ test: true })` 写到 `test/.build/client.test.js`；
 *  - 跑法（构建与渲染测试共用锁）：
 *      node tools/run-locked.mjs -- node test/image-tool-render.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { bundle } from '../build.mjs'
import { LIMITS } from '../shared/contract.js'
import { loadClient, TEST_ARTIFACT } from './load-client.mjs'
import { createCheckRunner } from './helpers/check.mjs'
import { collectClasses, collectText, findNodes } from './helpers/render.mjs'

const NOW = Date.parse('2026-11-09T05:05:00.000Z')

/** 合法蒙版 base64（逻辑层只校验 base64 形状，不解码 PNG）。 */
const MASK_DATA = Buffer.from('fake-inpaint-mask').toString('base64')

/** 最小预设样本：能力字段是渲染分支的唯一依据，数值取契约内的常见档位。 */
function presetOf(id, extra = {}) {
  return {
    id,
    label: id,
    short: id,
    steps: 4,
    cfg: 0,
    size: 1024,
    negativeHint: '',
    supportsNegative: false,
    supportsInpaint: true,
    supportsImg2Img: true,
    ...extra,
  }
}

const PRESETS = [
  presetOf('sdxl-lightning'),
  presetOf('sdxl-inpaint', {
    inpaintOnly: true,
    steps: 30,
    cfg: 8,
    supportsNegative: true,
    negativeHint: 'blurry, low quality',
  }),
  presetOf('flux2-klein-4b', { supportsImg2Img: false, supportsInpaint: false }),
]

const image = {
  path: 'imagen-output/job-1/07.png',
  file: '07.png',
  url: '/imagen-api/file?path=imagen-output%2Fjob-1%2F07.png',
  width: 1024,
  height: 1024,
  seed: 7,
  seconds: 6.2,
}
const item = {
  jobId: 'job-1',
  dir: 'imagen-output/20261109-job-1',
  prompt: '测试用的荷花池塘',
  presetId: 'sdxl-lightning',
  finishedAt: new Date(NOW - 120_000).toISOString(),
  images: [image],
}

const textOf = (node) => collectText(node).join('').replace(/\s+/g, '')

const byClass = (tree, className) => findNodes(
  tree,
  (node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(className),
)
const byClassOne = (tree, className) => {
  const list = byClass(tree, className)
  assert.equal(list.length, 1, `结构类名 .${className} 应出现 1 次，实际 ${list.length} 次`)
  return list[0]
}
const buttonByText = (tree, text) => {
  const button = findNodes(tree, (node) => node.type === 'button').find((node) => textOf(node).includes(text))
  assert.ok(button, `应存在文案为「${text}」的按钮`)
  return button
}

function createUi() {
  const toasts = []
  const failures = []
  return {
    toasts,
    failures,
    zoom: false,
    setZoom() {},
    copyPath() {},
    setView() {},
    setPanelMode() {},
    setError() {},
    showToast(text) {
      toasts.push(String(text))
    },
    fail(code, message) {
      failures.push({ code, message })
    },
  }
}

async function main() {
  const { check, summary } = createCheckRunner()

  await mkdir(dirname(TEST_ARTIFACT), { recursive: true })
  await writeFile(TEST_ARTIFACT, await bundle({ test: true }), 'utf8')

  const client = await loadClient({
    testBuild: true,
    now: NOW,
    responses: {
      // 工具提交：Host 返回任务 id 即可（hook 只依赖 data.id）。
      '/imagen-api/generate': { ok: true, id: 'j_tool_1' },
    },
  })
  const t = client.internals.i18n.fallbackTranslate('zh-CN')
  assert.equal(typeof client.components.Stage, 'function')
  assert.equal(typeof client.hooks.useImageTool, 'function')
  assert.equal(typeof client.components.MaskEditor, 'function')

  const createHarness = () => {
    let latest = null
    function Harness(props) {
      // 真实组合层的最小替身：Stage 的动作坞通过 actions.openImageTool 打开工具。
      const imageTool = client.hooks.useImageTool({
        t: props.t,
        isEn: false,
        alive: async (promise) => promise,
        ui: props.ui,
        presets: props.compute.presets,
        defaultPreset: props.compute.defaultPreset,
        currentPresetId: props.form.form.presetId,
        onSubmitted: () => {},
      })
      latest = imageTool
      const actions = {
        openImageTool: (kind, entry) => imageTool.openTool(kind, entry || props.library.selected),
        iterate: () => {},
        reroll: () => {},
      }
      return client.react.createElement(client.components.Stage, { ...props, imageTool, actions })
    }
    return { Harness, api: () => latest }
  }

  const mountStage = async () => {
    client.unmount()
    const ui = createUi()
    const harness = createHarness()
    const props = {
      t,
      ui,
      now: NOW,
      compute: { activeJob: null, status: {}, presets: PRESETS, defaultPreset: 'sdxl-lightning' },
      form: { form: { presetId: 'sdxl-lightning', width: 1024, height: 1024 }, useInspiration() {} },
      library: { selected: { image, item }, isFavorite: () => false, toggleFavorite() {} },
    }
    const tree = await client.mountRaw(harness.Harness, props)
    return { tree, harness, ui }
  }
  /** 状态变更后把最新树刷出来（假 React 不自动调度 useEffect 之后的渲染）。 */
  const refresh = () => client.rerenderRaw()

  await check('动作坞：图片处理 / 创作复用两组，未开放工具禁用并带规划中说明', async () => {
    const { tree } = await mountStage()
    const classes = collectClasses(tree)
    assert.equal(classes['ofs-dock'], 1)
    assert.equal(classes['ofs-dock-group'], 2)
    const groups = findNodes(tree, (node) => node.type === 'div' && node.props && node.props['data-group'])
    assert.deepEqual(groups.map((group) => group.props['data-group']), ['process', 'reuse'])

    const allButtons = findNodes(tree, (node) => node.type === 'button')
    const buttons = allButtons.filter(
      (button) => typeof button.props.className === 'string' && button.props.className.split(/\s+/).includes('ofs-dock-button'),
    )
    assert.equal(buttons.length, 6, '四个图片工具 + 带回参数 + 再画一张')
    const disabled = buttons.filter((button) => button.props['aria-disabled'] === 'true')
    assert.deepEqual(disabled.map(textOf), ['高清放大', '扩图'])
    for (const button of disabled) assert.equal(button.props.title, '规划中，暂未开放')
    const usable = buttons.filter((button) => button.props['aria-disabled'] !== 'true')
    assert.deepEqual(usable.map(textOf), ['局部重绘', '整图重绘', '带回参数', '生成变体'])
  })

  await check('点「局部重绘」进入画布：画布 / 工具栏 / 提交栏挂载，复用组收起', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '局部重绘').props.onClick()
    const next = await refresh()
    const classes = collectClasses(next)
    assert.equal(harness.api().editorOpen, true)
    assert.equal(harness.api().activeTool.id, 'inpaint')
    assert.equal(classes['ofs-mask-editor'], 1)
    assert.equal(classes['ofs-mask-stage'], 1)
    assert.equal(classes['ofs-mask-tools'], 1)
    assert.equal(classes['ofs-mask-canvas'], 1)
    assert.equal(classes['ofs-tool-bar'], 1)
    assert.equal(classes['ofs-dock'] ?? 0, 0, '编辑态直接由提交栏接管底部，不重复渲染动作坞')
    assert.equal(classes['ofs-tool-exit'], 1)
    assert.equal(classes['ofs-mask-fast'], 1, '4 步极速模型应给弱提示')
    const canvas = byClassOne(next, 'ofs-mask-canvas')
    assert.equal(canvas.props.role, 'application')
    assert.equal(canvas.props.tabIndex, 0)
  })

  await check('inpaintOnly + 无蒙版：提交按钮禁用并显示拦截文案；涂抹后恢复可提交', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '局部重绘').props.onClick()
    let next = await refresh()
    const select = findNodes(next, (node) => node.type === 'select')
    assert.equal(select.length, 1, '多预设时应渲染模型下拉')
    select[0].props.onChange({ target: { value: 'sdxl-inpaint' } })
    next = await refresh()
    assert.equal(harness.api().presetId, 'sdxl-inpaint')
    assert.equal(harness.api().strength, 0.9, '专用权重默认强度 0.9')
    assert.equal(byClassOne(next, 'ofs-tool-submit').props.disabled, true)
    assert.ok(textOf(byClassOne(next, 'ofs-tool-blocked')).includes('局部重绘专用模型'))
    assert.equal(byClassOne(next, 'ofs-tool-range').props.max, LIMITS.strength.max)

    harness.api().applyMask({ data: MASK_DATA, coverage: 0.25 })
    next = await refresh()
    assert.equal(byClassOne(next, 'ofs-tool-submit').props.disabled, false)
    assert.equal(byClass(next, 'ofs-tool-blocked').length, 0)
    assert.ok(textOf(byClassOne(next, 'ofs-tool-mask')).includes('25%'))
    assert.equal(byClassOne(next, 'ofs-tool-range').props.max, LIMITS.strength.inpaintMax, '带蒙版后强度上限放宽')
  })

  await check('暂存涂抹保留草稿，点「取消」则丢弃草稿并退出', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '局部重绘').props.onClick()
    await refresh()
    harness.api().applyMask({ data: MASK_DATA, coverage: 0.25 })
    let next = await refresh()
    buttonByText(next, '暂存涂抹').props.onClick()
    next = await refresh()
    assert.equal(harness.api().editorOpen, false)
    assert.equal(byClass(next, 'ofs-mask-editor').length, 0)
    const resume = byClassOne(next, 'ofs-dock-resume')
    assert.ok(textOf(resume).includes('继续编辑'))
    assert.ok(textOf(resume).includes('已涂25%'), '草稿状态应带覆盖率读数')

    resume.props.onClick()
    next = await refresh()
    assert.equal(harness.api().editorOpen, true)
    assert.equal(byClass(next, 'ofs-mask-editor').length, 1)
    assert.ok(textOf(byClassOne(next, 'ofs-tool-mask')).includes('25%'))
    assert.equal(byClassOne(next, 'ofs-tool-range').props.max, LIMITS.strength.inpaintMax)

    buttonByText(next, '取消').props.onClick()
    next = await refresh()
    assert.equal(harness.api().editorOpen, false)
    assert.equal(harness.api().activeTool, null, '点「取消」应彻底丢弃当前草稿')
    assert.equal(harness.api().mask, null)
    assert.equal(byClass(next, 'ofs-dock-resume').length, 0, '取消后不应再出现继续编辑')
  })

  await check('整图重绘：展开轻量重绘条（不切画布），切到 inpaintOnly 预设被拒绝', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '整图重绘').props.onClick()
    let next = await refresh()
    const classes = collectClasses(next)
    assert.equal(classes['ofs-inline-tool'], 1)
    assert.equal(classes['ofs-inline-stage'], 1)
    assert.equal(classes['ofs-tool-bar'], 1)
    assert.equal(classes['ofs-mask-editor'] ?? 0, 0, '整图重绘不切画布')
    assert.equal(byClassOne(next, 'ofs-tool-range').props.max, LIMITS.strength.max, '整图重绘用通用上限')
    // 目标作品有原提示词 → 工具输入留空也可提交（提交时回退）。
    assert.equal(byClassOne(next, 'ofs-tool-submit').props.disabled, false)
    // 整图重绘的可选预设只有通用垫图模型：专用局部重绘权重与不支持的模型都不出现。
    assert.deepEqual(harness.api().toolPresets.map((preset) => preset.id), ['sdxl-lightning'])
    assert.equal(harness.api().selectPreset('sdxl-inpaint'), false, 'inpaintOnly 预设不能当整图重绘底座')
    next = await refresh()
    assert.equal(harness.api().presetId, 'sdxl-lightning')
  })

  await check('提交工具任务：请求体带底图 / 蒙版 / 强度，成功后收起编辑态并清空草稿', async () => {
    const { tree, harness, ui } = await mountStage()
    buttonByText(tree, '局部重绘').props.onClick()
    await refresh()
    harness.api().applyMask({ data: MASK_DATA, coverage: 0.25 })
    let next = await refresh()
    byClassOne(next, 'ofs-tool-submit').props.onClick()
    await client.settle()
    next = await refresh()

    const request = [...client.requests].reverse().find((entry) => entry.path === '/imagen-api/generate')
    assert.ok(request, '应发出 POST /imagen-api/generate')
    assert.equal(request.method, 'POST')
    const body = request.body
    assert.equal(body.presetId, 'sdxl-lightning')
    assert.equal(body.prompt, '测试用的荷花池塘', '工具提示词为空时回退目标作品原提示词')
    assert.equal(body.width, 1024)
    assert.equal(body.height, 1024)
    assert.equal(body.count, 1)
    assert.equal(body.seed, '')
    assert.equal(body.reference.path, image.path)
    assert.equal(body.reference.mask, MASK_DATA)
    assert.equal(body.reference.strength, 0.8, '通用模型的局部重绘默认强度 0.8')
    assert.equal(body.negativePrompt, '')

    assert.equal(harness.api().editorOpen, false)
    assert.equal(byClass(next, 'ofs-mask-editor').length, 0)
    assert.equal(byClass(next, 'ofs-dock-resume').length, 0, '成功后草稿清空，不再有继续编辑')
    assert.equal(harness.api().pendingTool.jobId, 'j_tool_1')
    assert.ok(ui.toasts.includes('已提交图片处理任务'))
  })

  client.unmount()
  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
