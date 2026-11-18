/**
 * 舞台图片工具组件的渲染测试（假 React，不需要浏览器）。
 *
 * tool-core 自测：mount 真实的 `useImageTool` + `Stage`，
 * 断言动作坞分组、涂抹画布 / 扩图画布 / 整图重绘条的挂载与退出、提交按钮的可用性、
 * 蒙版改变时强度上限的联动、高清放大点击即提交、扩图对比拉帘的区域定位，
 * 以及一次真实的工具提交请求体。
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
/** 扩图合成画布（1024² 四边扩 20% 的版面）。 */
const CANVAS_IMAGE = Buffer.from('fake-outpaint-image').toString('base64')
const CANVAS_MASK = Buffer.from('fake-outpaint-mask').toString('base64')
const OUTPAINT_CANVAS = {
  image: CANVAS_IMAGE,
  mask: CANVAS_MASK,
  width: 1232,
  height: 1232,
  content: { x: 104, y: 104, width: 1024, height: 1024 },
}

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

function createUi(options = {}) {
  const toasts = []
  const failures = []
  const ui = {
    toasts,
    failures,
    zoom: false,
    compareOpen: options.compareOpen === true,
    setZoom() {},
    setCompareOpen(next) {
      ui.compareOpen = Boolean(next)
    },
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
  return ui
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
  assert.equal(typeof client.components.OutpaintEditor, 'function')

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

  const mountStage = async (options = {}) => {
    client.unmount()
    const ui = createUi({ compareOpen: options.compareOpen })
    const harness = createHarness()
    const props = {
      t,
      ui,
      now: NOW,
      compute: { activeJob: null, status: {}, presets: PRESETS, defaultPreset: 'sdxl-lightning' },
      form: { form: { presetId: 'sdxl-lightning', width: 1024, height: 1024 }, useInspiration() {} },
      library: {
        selected: options.selected || { image, item },
        isFavorite: () => false,
        toggleFavorite() {},
      },
    }
    const tree = await client.mountRaw(harness.Harness, props)
    return { tree, harness, ui }
  }
  /** 状态变更后把最新树刷出来（假 React 不自动调度 useEffect 之后的渲染）。 */
  const refresh = () => client.rerenderRaw()

  await check('动作坞：图片处理 / 创作复用两组，四个工具全部可用', async () => {
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
    assert.equal(buttons.length, 6, '四个图片工具 + 重新生成 + 阶段十五 C2 的「设为参考图」')
    // 阶段十五 Phase B：高清放大 / 扩图已开放，不再有禁用占位。
    const disabled = buttons.filter((button) => button.props['aria-disabled'] === 'true')
    assert.equal(disabled.length, 0, '不应再有禁用占位')
    const usable = buttons.filter((button) => button.props['aria-disabled'] !== 'true')
    assert.deepEqual(usable.map(textOf), ['局部重绘', '整图重绘', '高清放大', '扩图', '重新生成', '设为参考图'])
    for (const tool of usable.slice(0, 4)) assert.equal(typeof tool.props.onClick, 'function', '四个工具都应绑定动作')
    // 创作复用组的两个动作都要绑定回调（「设为参考图」把当前作品送进左栏参考槽）。
    assert.equal(typeof usable[4].props.onClick, 'function', '重新生成应绑定动作')
    assert.equal(typeof usable[5].props.onClick, 'function', '设为参考图应绑定动作')
  })

  await check('高清放大：点击即提交（不进入编辑态），toast 专用文案', async () => {
    const { tree, harness, ui } = await mountStage()
    buttonByText(tree, '高清放大').props.onClick()
    await client.settle()
    const next = await refresh()
    assert.equal(harness.api().editorOpen, false, '即时工具不进入编辑态')
    assert.equal(byClass(next, 'ofs-mask-editor').length, 0)
    assert.equal(byClass(next, 'ofs-outpaint-editor').length, 0)
    assert.equal(byClass(next, 'ofs-tool-bar').length, 0, '不出现编辑态提交栏')
    const request = [...client.requests].reverse().find((entry) => entry.path === '/imagen-api/generate')
    assert.ok(request, '应发出 POST /imagen-api/generate')
    assert.equal(request.body.tool, 'upscale')
    assert.equal(request.body.presetId, undefined, '放大请求不带预设')
    assert.equal(request.body.reference.path, image.path)
    assert.equal(request.body.width, 1024)
    assert.equal(request.body.height, 1024)
    assert.equal(request.body.count, 1)
    assert.ok(ui.toasts.includes('已提交高清放大任务'), 'toast 应说明高清放大已提交')
    assert.equal(harness.api().pendingTool.sourceMode, 'upscale')
  })

  await check('高清放大：源图长边超限时提交被拦并给明确提示', async () => {
    const bigImage = { ...image, width: 1536, height: 1024 }
    const bigItem = { ...item, images: [bigImage] }
    const { tree, harness, ui } = await mountStage({ selected: { image: bigImage, item: bigItem } })
    const generateBefore = client.requests.filter((entry) => entry.path === '/imagen-api/generate').length
    buttonByText(tree, '高清放大').props.onClick()
    await client.settle()
    const next = await refresh()
    assert.equal(harness.api().editorOpen, false)
    assert.ok(
      ui.toasts.some((text) => text.includes('超出高清放大的输入上限')),
      `应提示源图过大，实际 toast：${ui.toasts.join(' | ')}`,
    )
    assert.equal(
      client.requests.filter((entry) => entry.path === '/imagen-api/generate').length,
      generateBefore,
      '超限时不应发出请求',
    )
    assert.equal(byClass(next, 'ofs-tool-bar').length, 0)
  })

  await check('扩图：进入画布编辑态，比例胶囊 / 默认模型与强度正确', async () => {
    const { tree, harness, ui } = await mountStage()
    buttonByText(tree, '扩图').props.onClick()
    let next = await refresh()
    const classes = collectClasses(next)
    assert.equal(harness.api().editorOpen, true)
    assert.equal(harness.api().activeTool.id, 'outpaint')
    assert.equal(classes['ofs-outpaint-editor'], 1)
    assert.equal(classes['ofs-outpaint-stage'], 1)
    assert.equal(byClass(next, 'ofs-mask-editor').length, 0, '扩图不挂涂抹画布')
    assert.equal(classes['ofs-tool-bar'], 1)
    // 预览层对屏幕阅读器是图形（role=img），内容框是可聚焦控件（键盘可达、44px 热区）。
    const preview = byClassOne(next, 'ofs-outpaint-preview')
    assert.equal(preview.props.role, 'img')
    assert.ok(String(preview.props['aria-label'] || '').includes('扩图画布'))
    const contentBox = byClassOne(next, 'ofs-outpaint-content')
    assert.equal(contentBox.type, 'button')
    assert.equal(contentBox.props.title, '拖动内容框调整留白位置')
    // 四个比例胶囊：默认选中「四边扩 20%」。
    const ratios = byClass(next, 'ofs-outpaint-ratio')
    assert.equal(ratios.length, 4)
    assert.deepEqual(ratios.map(textOf), ['四边扩20%', '16:9', '9:16', '4:3'])
    assert.equal(ratios[0].props['aria-pressed'], 'true')
    // 默认选中 9 通道专用权重，强度 1.0、上限 inpaintMax。
    assert.equal(harness.api().presetId, 'sdxl-inpaint')
    assert.equal(harness.api().strength, 1.0)
    assert.equal(byClassOne(next, 'ofs-tool-range').props.max, LIMITS.strength.inpaintMax)
    // 画布还没导出：提交禁用并提示 blockedCanvas。
    assert.equal(byClassOne(next, 'ofs-tool-submit').props.disabled, true)
    assert.ok(textOf(byClassOne(next, 'ofs-tool-blocked')).includes('扩图画布尚未生成'))
    assert.ok(ui.toasts.some((text) => text.includes('已自动改用')), '切到专用权重时给一次自动换模提示')
  })

  await check('扩图：切比例后导出画布可提交，请求体带合成图 / 蒙版 / 来源路径', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '扩图').props.onClick()
    let next = await refresh()
    // 切到 16:9：草稿比例更新。
    byClass(next, 'ofs-outpaint-ratio')[1].props.onClick()
    next = await refresh()
    assert.equal(harness.api().outpaint.ratioId, '16:9')
    // 模拟编辑器导出画布（渲染测试的假 DOM 没有 canvas 2D，直接调 hook 的入口）。
    const applied = harness.api().applyOutpaintCanvas(OUTPAINT_CANVAS)
    assert.equal(applied.ok, true)
    next = await refresh()
    assert.equal(harness.api().outpaint.canvas.width, 1232)
    assert.equal(byClassOne(next, 'ofs-tool-submit').props.disabled, false)
    const meta = textOf(byClassOne(next, 'ofs-tool-mask'))
    assert.ok(meta.includes('新增画面'), `覆盖率读数为「新增画面 x%」，实际：${meta}`)
    assert.ok(Math.abs(harness.api().coverage - 0.309158) < 0.000001, `覆盖率应约 30.9%，实际：${harness.api().coverage}`)
    // 提交：请求体走 outpaint 分支。
    byClassOne(next, 'ofs-tool-submit').props.onClick()
    await client.settle()
    next = await refresh()
    const request = [...client.requests].reverse().find((entry) => entry.path === '/imagen-api/generate')
    assert.ok(request, '应发出 POST /imagen-api/generate')
    const body = request.body
    assert.equal(body.tool, 'outpaint')
    assert.equal(body.presetId, 'sdxl-inpaint')
    assert.equal(body.prompt, '测试用的荷花池塘', '工具提示词为空时回退目标作品原提示词')
    assert.equal(body.width, 1232)
    assert.equal(body.height, 1232)
    assert.equal(body.reference.image, CANVAS_IMAGE)
    assert.equal(body.reference.mask, CANVAS_MASK)
    assert.equal(body.reference.sourcePath, image.path)
    assert.equal(body.reference.strength, 1.0)
    assert.equal(harness.api().editorOpen, false)
    assert.equal(byClass(next, 'ofs-outpaint-editor').length, 0)
    assert.equal(harness.api().pendingTool.sourceMode, 'outpaint')
  })

  await check('扩图：内容框拖拽 / 方向键 / 双击回中都会更新锚点并作废旧画布', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '扩图').props.onClick()
    let next = await refresh()
    assert.equal(harness.api().outpaint.ratioId, 'source')
    // 先模拟一次画布导出，验证「参数变化会清掉旧画布」。
    harness.api().applyOutpaintCanvas(OUTPAINT_CANVAS)
    next = await refresh()
    assert.equal(harness.api().outpaint.canvas.width, 1232)
    // 方向键右移 8px：锚点 x 增加，旧画布被清空。
    const content = byClassOne(next, 'ofs-outpaint-content')
    assert.equal(content.props['aria-label'], '拖动内容框调整留白位置')
    content.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
    next = await refresh()
    const shifted = harness.api().outpaint.anchor
    assert.ok(shifted.x > 0.5, `方向键应右移锚点，实际 ${JSON.stringify(shifted)}`)
    assert.equal(shifted.y, 0.5, '上轴没有变化')
    assert.equal(harness.api().outpaint.canvas, null, '锚点变化后旧画布作废，等编辑器重新导出')
    // 双击回中。
    byClassOne(next, 'ofs-outpaint-content').props.onDoubleClick()
    next = await refresh()
    assert.deepEqual(harness.api().outpaint.anchor, { x: 0.5, y: 0.5 })
    // 指针拖拽：从中心往右拖 104px（留白总宽 208 的一半）→ 锚点贴右边界。
    const dragStart = byClassOne(next, 'ofs-outpaint-content')
    dragStart.props.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} })
    dragStart.props.onPointerMove({ clientX: 104, clientY: 0 })
    dragStart.props.onPointerUp({ pointerId: 1 })
    next = await refresh()
    assert.equal(harness.api().outpaint.anchor.x, 1, '拖到最右后锚点钳到 1')
    assert.equal(harness.api().outpaint.anchor.y, 0.5)
    // 比例切换：胶囊高亮跟随 aria-pressed。
    const ratios = byClass(next, 'ofs-outpaint-ratio')
    ratios[2].props.onClick()
    next = await refresh()
    assert.equal(harness.api().outpaint.ratioId, '9:16')
    assert.equal(byClass(next, 'ofs-outpaint-ratio')[2].props['aria-pressed'], 'true')
    assert.equal(byClass(next, 'ofs-outpaint-ratio')[0].props['aria-pressed'], 'false')
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

  await check('对比拉帘：扩图产物按 outpaintContent 定位底图，普通派生仍整幅铺满', async () => {
    // 扩图产物：画布 1232²，原图 1024² 居中（outpaintContent 由历史条目透传，未归一化也可）。
    const outpaintImage = {
      ...image,
      path: 'imagen-output/job-out/01.png',
      file: '01.png',
      url: '/imagen-api/file?path=imagen-output%2Fjob-out%2F01.png',
      width: 1232,
      height: 1232,
      seed: 0,
      seconds: 2.4,
    }
    const outpaintItem = {
      ...item,
      jobId: 'job-out',
      prompt: '扩图后的荷花池塘',
      presetId: 'sdxl-inpaint',
      sourceImage: image.path,
      outpaint: true,
      outpaintContent: { x: 104 / 1232, y: 104 / 1232, width: 1024 / 1232, height: 1024 / 1232 },
      images: [outpaintImage],
    }
    const extension = await mountStage({
      selected: { image: outpaintImage, item: outpaintItem },
      compareOpen: true,
    })
    let next = await extension.tree
    assert.equal(byClass(next, 'ofs-compare').length, 1, '带 sourceImage 的派生作品应挂拉帘')
    const base = byClassOne(next, 'ofs-compare-base')
    assert.equal(base.props.className.split(/\s+/).includes('is-region'), true, '扩图底图应使用 .is-region')
    const style = base.props.style || {}
    const percentOf = (value) => {
      const number = Number.parseFloat(String(value))
      assert.ok(Number.isFinite(number), `style 应为百分比字符串，实际：${value}`)
      return number
    }
    assert.ok(Math.abs(percentOf(style.left) - 8.44) < 0.01, `left 应为 8.44%，实际 ${style.left}`)
    assert.ok(Math.abs(percentOf(style.top) - 8.44) < 0.01, `top 应为 8.44%，实际 ${style.top}`)
    assert.ok(Math.abs(percentOf(style.width) - 83.12) < 0.01, `width 应为 83.12%，实际 ${style.width}`)
    assert.ok(Math.abs(percentOf(style.height) - 83.12) < 0.01, `height 应为 83.12%，实际 ${style.height}`)
    // after 图（扩图整幅）仍铺满对比框，不带区域定位。
    const after = byClassOne(next, 'ofs-compare-image')
    assert.equal(after.props.className, 'ofs-compare-image')
    assert.equal(after.props.style, undefined)

    // 普通派生作品（有 sourceImage、没有 outpaintContent）：底图保持整幅铺满，行为不变。
    const ordinaryItem = { ...item, sourceImage: image.path, images: [image] }
    const ordinary = await mountStage({ selected: { image, item: ordinaryItem }, compareOpen: true })
    next = await ordinary.tree
    assert.equal(byClass(next, 'ofs-compare').length, 1)
    const ordinaryBase = byClassOne(next, 'ofs-compare-base')
    assert.equal(ordinaryBase.props.className, 'ofs-compare-base')
    assert.equal(ordinaryBase.props.style, undefined, '无 outpaintContent 时不得写内联定位')
  })

  // 阶段十五 Phase C0：画布编辑器显式挂 key=target.path——换底图时整块重建，
  // 内部 useState（画笔粗细 / 底图尺寸）不能沿用上一张图。
  await check('画布编辑器：换底图按 target.path 重建，画笔与底图尺寸不残留', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '局部重绘').props.onClick()
    let next = await refresh()
    assert.equal(byClass(next, 'ofs-mask-editor').length, 1)
    // 画笔粗细是 MaskEditor 的本地 state：改到 96 后换底图应回到默认 40。
    const brushValueOf = (node) => {
      const bold = findNodes(node, (item) => item.type === 'b')[0]
      return bold ? collectText(bold).join('') : ''
    }
    assert.equal(brushValueOf(next), '40', '画笔默认粗细 40')
    byClassOne(next, 'ofs-mask-range').props.onChange({ target: { value: 96 } })
    next = await refresh()
    assert.equal(brushValueOf(next), '96', '改画笔后读数更新')
    // 换一张底图（同一工具、不同作品）：编辑器应重建，画笔回到默认值。
    const secondImage = { ...image, path: 'imagen-output/job-2/08.png', file: '08.png', width: 1152, height: 648 }
    const secondItem = { ...item, jobId: 'job-2', images: [secondImage] }
    harness.api().openTool('inpaint', { image: secondImage, item: secondItem })
    next = await refresh()
    assert.equal(harness.api().target.path, secondImage.path, '底图切到第二张作品')
    assert.equal(byClass(next, 'ofs-mask-editor').length, 1)
    assert.equal(brushValueOf(next), '40', '换底图后画笔状态重建，不沿用上一张的 96')
  })

  await check('扩图编辑器：换底图按 target.path 重建，画布比例取自新底图', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '扩图').props.onClick()
    let next = await refresh()
    assert.equal(byClass(next, 'ofs-outpaint-editor').length, 1)
    const source = harness.api().target
    const expandPlan = (target) => client.PURE.outpaintPlanOf({
      sourceWidth: target.width,
      sourceHeight: target.height,
      ratioId: client.PURE.OUTPAINT_EXPAND_ID,
      anchor: { x: 0.5, y: 0.5 },
    })
    const ratioOfTree = (node) => {
      const stage = byClassOne(node, 'ofs-outpaint-stage')
      return String((stage.props.style || {})['--ofs-outpaint-r'])
    }
    const firstPlan = expandPlan(source)
    assert.equal(ratioOfTree(next), String(firstPlan.width / firstPlan.height), '初始画布比例来自第一张底图')
    // 换成 16:9 底图：内部 natural 尺寸必须按新底图重建，否则画布比例仍是方形。
    const wideImage = { ...image, path: 'imagen-output/job-2/09.png', file: '09.png', width: 1152, height: 648 }
    const wideItem = { ...item, jobId: 'job-2', images: [wideImage] }
    harness.api().openTool('outpaint', { image: wideImage, item: wideItem })
    next = await refresh()
    assert.equal(harness.api().target.path, wideImage.path)
    const widePlan = expandPlan(harness.api().target)
    assert.equal(ratioOfTree(next), String(widePlan.width / widePlan.height), '换底图后画布比例取自新底图')
  })

  await check('扩图编辑器：缓存命中（未触发 onLoad）与跨源画布污染兜底导出', async () => {
    const { tree, harness } = await mountStage()
    buttonByText(tree, '扩图').props.onClick()
    let next = await refresh()
    const editor = byClassOne(next, 'ofs-outpaint-editor')
    assert.ok(editor)
    const imgNode = byClassOne(next, 'ofs-outpaint-photo')
    assert.equal(typeof imgNode.props.onLoad, 'function')

    const appliedList = []
    const Outpaint = client.components.OutpaintEditor
    function EditorHarness() {
      return client.react.createElement(Outpaint, {
        t,
        target: { path: 'imagen-output/job-1/07.png', url: 'http://127.0.0.1:5200/imagen-api/file?path=x', width: 1024, height: 768 },
        tool: { id: 'outpaint', form: 'canvas', ready: true },
        outpaint: { ratioId: 'source', anchor: { x: 0.5, y: 0.5 }, canvas: null },
        onRatioChange() {},
        onAnchorChange() {},
        onCanvasApply(payload) {
          appliedList.push(payload)
          return { ok: true }
        },
      })
    }
    client.unmount()
    const editorTree = await client.mountRaw(EditorHarness, {})

    // mountRaw 之后再装 canvas / baseURI 替身（unmount + mountRaw 会重建假 document）。
    const savedDocCreate = globalThis.document.createElement
    const savedBaseUri = globalThis.document.baseURI
    const savedCreateBitmap = globalThis.createImageBitmap
    const savedFetch = globalThis.fetch
    const taintedImg = { complete: true, naturalWidth: 1024, naturalHeight: 768, tainted: true }
    try {
      globalThis.document.baseURI = 'http://127.0.0.1:4100/'
      globalThis.createImageBitmap = async () => ({
        width: 1024,
        height: 768,
        tainted: false,
        close() {},
      })
      globalThis.fetch = async () => ({
        ok: true,
        blob: async () => ({}),
      })
      globalThis.document.createElement = (tag) => {
        if (tag !== 'canvas') return {}
        let hasTaint = false
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect() {},
            drawImage(source) {
              if (source && source.tainted) hasTaint = true
            },
          }),
          toDataURL() {
            if (hasTaint) {
              const err = new Error('Tainted canvases may not be exported')
              err.name = 'SecurityError'
              throw err
            }
            return 'data:image/png;base64,AAAA'
          },
        }
      }

      const renderedImg = byClassOne(editorTree, 'ofs-outpaint-photo')
      // 模拟浏览器缓存命中：不触发 onLoad，只经由回调 ref 传入已 complete 的 <img>，
      // 再推进假时钟触发导出（期间 toDataURL 抛 SecurityError，走同源 fetch 兜底）。
      assert.equal(typeof renderedImg.props.ref, 'function')
      renderedImg.props.ref(taintedImg)
      await client.rerenderRaw()
      globalThis.fetch = async () => ({
        ok: true,
        blob: async () => ({}),
      })
      await client.advanceTimers(10)
      await client.settle()
      await client.rerenderRaw()
      const applied = appliedList[appliedList.length - 1] || null
      assert.ok(applied, '缓存命中 + SecurityError 跨源兜底后仍应成功导出画布')
      assert.equal(applied.image, 'AAAA')
      assert.equal(applied.mask, 'AAAA')
      assert.equal(applied.width, 1232)
      assert.equal(applied.height, 928)
    } finally {
      globalThis.document.createElement = savedDocCreate
      globalThis.document.baseURI = savedBaseUri
      globalThis.createImageBitmap = savedCreateBitmap
      globalThis.fetch = savedFetch
      void harness
    }
  })

  await check('裸本地导入图进图片工具时不拿文件名当扩散提示词；带元数据导入保留原提示词', async () => {
    const { harness } = await mountStage()
    const bareImage = {
      path: 'imagen-output/20261118-01/01.png',
      file: '01.png',
      url: '/imagen-api/file?path=imagen-output%2F20261118-01%2F01.png',
      width: 1280,
      height: 720,
    }
    const bareItem = {
      jobId: 'imp-bare',
      source: 'import',
      prompt: 'e2rtLaj32QMf3G-random-file',
      params: { prompt: 'e2rtLaj32QMf3G-random-file', width: 1280, height: 720 },
      images: [bareImage],
    }
    harness.api().openTool('outpaint', { image: bareImage, item: bareItem })
    await refresh()
    assert.equal(harness.api().target.prompt, '', '裸导入图不应把文件名写入工具回退提示词')

    const metaImage = { ...bareImage, path: 'imagen-output/20261118-02/01.png' }
    const metaItem = {
      jobId: 'imp-meta',
      source: 'import',
      prompt: 'misty mountain train station at dawn',
      params: { prompt: 'misty mountain train station at dawn', steps: 4, cfg: 0, seed: 42 },
      images: [metaImage],
    }
    harness.api().openTool('inpaint', { image: metaImage, item: metaItem })
    await refresh()
    assert.equal(harness.api().target.prompt, 'misty mountain train station at dawn', '带 PNG 元数据的导入图应保留原生成提示词')
  })

  client.unmount()
  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
