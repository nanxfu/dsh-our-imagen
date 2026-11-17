/**
 * 舞台图片工具渲染测试（不需要浏览器）。
 *
 * 覆盖：动作坞分组 / 局部涂抹画布 / 整图重绘条 / 蒙版提交 / 胶片条取消与滚轮 /
 * 纯文生图重试分流 / 作品条根折叠版本树 / 显式新建绘图态与工具草稿。
 *
 * 运行：node test/check-client-tools.mjs
 */

import assert from 'node:assert/strict'
import { MASK_BRUSH } from '../src/logic/mask.js'
import { createCheckRunner } from './helpers/check.mjs'
import { assertStructure, collectText, findNodes, nodesByClass, buttonByText, createTestClient } from './helpers/render.mjs'
import {
  NOW, at, preset, realvis, historyItem, readyState, toolPreset, studioResponses,
} from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

// ── 舞台图片工具（方案 B）：左栏纯文生图 + 动作坞一步直达 ─────────────
//
// 0.13.0 把参考图 / 蒙版 / 重绘强度从左栏表单迁到独立的 `useImageTool` 域，
// 旧「先挂参考图再回左栏生成」用例按新交互改写为「动作坞一步直达 + 工具独立提交」，
// 覆盖点从「表单带 reference」换成「主表单永远无 reference、工具请求体才有」。

const MASK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const nativeToolPreset = {
  ...preset,
  id: 'sdxl-inpaint',
  label: 'SDXL Inpaint',
  short: 'Inpaint',
  supportsImg2Img: true,
  supportsInpaint: true,
  inpaintOnly: true,
}
// 不支持垫图 / 局部重绘的模型：只能当纯文生图模型，图片工具应自动绕开。
const noCapabilityPreset = {
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

/** 生成请求（只保留 POST /imagen-api/generate）。 */
const generateCalls = (client) => client.requests.filter((item) => item.path === '/imagen-api/generate')
/** useStudio harness：暴露 latest.studio，直接驱动组合层动作并断言真实状态流转。 */
async function mountToolStudio(responses, failures = {}, { selectFirst = true } = {}) {
  const client = await createTestClient({ now: NOW, responses, failures, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-tool-harness' }, String(studio.form.dirty))
  }
  await client.mountRaw(Harness, {})
  await client.settle()
  await client.rerenderRaw()
  if (selectFirst && latest.studio && latest.studio.library.gallery[0]) {
    latest.studio.library.selectImage(latest.studio.library.gallery[0])
    await client.rerenderRaw()
  }
  return { client, latest }
}
// 画廊「重绘编辑」不再先挂参考图：一步直达局部涂抹画布，左栏保持纯文生图。
await check('渲染：画廊「重绘编辑」一步直达局部涂抹，左栏无参考图区', async () => {
  const client = await createTestClient({
    now: NOW,
        responses: studioResponses({ ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' }, { items: [historyItem] }),
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery', initialPrompt: '雨夜街景' })
    const trigger = buttonByText(tree, '重绘编辑')
    assert.ok(trigger, '画廊卡片应提供「重绘编辑」')
    trigger.props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('tool-open', tree, {
      required: {
        'ofs-panel--form': 1,
        // 提示词 / 画面设置 / 高级设置：左栏仍是三个表单分区，没有参考图区。
        'ofs-fieldset': '1+',
        'ofs-mask-editor': 1,
        'ofs-mask-canvas': 1,
        'ofs-tool-bar': 1,
      },
      forbidden: ['ofs-gallery', 'ofs-print', 'ofs-lightbox'],
    })
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('局部重绘'), '应切到局部重绘画布')
    assert.ok(text.includes('修改描述'), '画布内嵌轻量提交栏')
    assert.ok(text.includes('取消'), '提交栏带取消')
    const photo = nodesByClass(tree, 'ofs-mask-photo')[0]
    assert.ok(photo && photo.props.src === historyItem.images[0].url, '画布底图应是被点作品')
  } finally {
    client.unmount()
  }
})
// 请求体分离：主表单永远是纯文生图；只有图片工具提交体带 reference（有蒙版时带 mask）。
await check('渲染：主表单请求体是纯文生图，图片工具请求体带 reference', async () => {
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-new', status: 'queued' },
  }
  // 1) 左栏「立即生成」：与改造前的文生图请求体逐字一致。
  let client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    const tree = await client.mountRaw(client.components.Studio, { initialPrompt: '雨夜街景' })
    nodesByClass(tree, 'ofs-generate')[0].props.onClick()
    await client.settle()
    const submitted = generateCalls(client).pop()
    assert.ok(submitted, '应提交主表单生成请求')
    assert.ok(!('reference' in submitted.body), '主表单请求体不得出现 reference')
    assert.ok(!('strength' in submitted.body), '主表单请求体不得出现 strength')
    assert.equal(submitted.body.prompt, '雨夜街景')
    assert.equal(submitted.body.presetId, 'sdxl-lightning')
  } finally {
    client.unmount()
  }
  // 2) 动作坞「局部重绘」：工具自己的请求体带底图与回退提示词。
  client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    const openButton = buttonByText(tree, '局部重绘')
    assert.ok(openButton, '动作坞应有「局部重绘」入口')
    openButton.props.onClick()
    tree = await client.rerenderRaw()
    nodesByClass(tree, 'ofs-tool-submit')[0].props.onClick()
    await client.settle()
    const submitted = generateCalls(client).pop()
    assert.ok(submitted && submitted.body.reference, '工具提交体应带 reference')
    assert.deepEqual(submitted.body.reference, { path: historyItem.images[0].path, strength: 0.8 }, '画布工具无蒙版时按 img2img 强度提交')
    assert.equal(submitted.body.prompt, '测试用的荷花池塘', '工具提示词为空时回退目标作品提示词')
    assert.equal(submitted.body.presetId, 'sdxl-lightning', '工具优先沿用左栏当前模型')
    assert.equal(submitted.body.count, 1, '图片工具固定单张')
    assert.equal(submitted.body.waitSeconds, 0, '图片工具不排队等待')
    assert.ok(!('strength' in submitted.body), '强度只在 reference 内部')
  } finally {
    client.unmount()
  }
})
// 主表单模型卡：专用局部重绘预设标成「仅图片工具」且不可选（决策 D3）。
await check('渲染：主表单模型卡把专用局部重绘预设标为仅图片工具且不可选', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const picked = []
  const tree = await client.mountRaw(client.components.ModelCardPicker, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    isEn: false,
    presets: [toolPreset, nativeToolPreset],
    value: 'sdxl-lightning',
    defaultPreset: 'sdxl-lightning',
    onChange: (item) => picked.push(item.id),
    open: true,
    onOpenChange: () => {},
  })
  client.unmount()
  const options = nodesByClass(tree, 'ofs-model-option')
  assert.equal(options.length, 2, '两个预设都应出现在菜单里（不在菜单里反而无法解释为什么不可选）')
  const native = options.find((node) => node.props['data-preset-id'] === 'sdxl-inpaint')
  assert.ok(native, '缺少 sdxl-inpaint 选项')
  assert.equal(native.props.disabled, true, '专用局部重绘预设不能从主表单选择')
  assert.equal(native.props['aria-disabled'], 'true')
  assert.ok(native.props.className.includes('is-tool-only'), '需要单独的视觉标记类')
  assert.ok(collectText(native).join('').includes('仅图片工具'), '选项要说明只在图片工具里可用')
  assert.equal(native.props.title, '仅图片工具')
  native.props.onClick()
  assert.deepEqual(picked, [], '点禁用项不得切换主表单预设')
  options.find((node) => node.props['data-preset-id'] === 'sdxl-lightning').props.onClick()
  assert.deepEqual(picked, ['sdxl-lightning'], '普通预设仍可正常选择')
})
// 大图预览的「以此图重绘」：收起放大层，直接打开局部涂抹。
await check('渲染：大图预览的「以此图重绘」直接打开局部涂抹', async () => {
  const client = await createTestClient({
    now: NOW,
        responses: studioResponses({ ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' }, { items: [historyItem] }),
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    const zoomButton = findNodes(tree, (node) => node.type === 'button' && typeof node.props?.className === 'string' && node.props.className.split(' ').includes('ofs-glass-btn') && node.props['aria-label'] === '点击查看原图' )[0]
    assert.ok(zoomButton, '舞台应有查看原图入口')
    zoomButton.props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('lightbox-open', tree, { required: { 'ofs-lightbox': 1, 'ofs-lightbox-action': 1 }, forbidden: [] })
    assert.ok(collectText(tree).join(' | ').includes('以此图重绘'), '大图预览应提供「以此图重绘」')
    nodesByClass(tree, 'ofs-lightbox-action')[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('lightbox-tool-open', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-tool-bar': 1 },
      forbidden: ['ofs-lightbox'],
    })
    assert.ok(collectText(tree).join(' | ').includes('局部重绘'), '点完后应直接进入局部涂抹')
  } finally {
    client.unmount()
  }
})
// 动作坞结构：图片处理四项（阶段十五 Phase B 起全部可用）、创作复用一项；旧「复制路径 / 继续重绘」已删除。
await check('渲染：动作坞按图片处理 / 创作复用分组，四个工具全部可用', async () => {
  const client = await createTestClient({
    now: NOW,
        responses: studioResponses({ ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' }, { items: [historyItem] }),
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    const dock = nodesByClass(tree, 'ofs-dock')[0]
    assert.ok(dock, '缺少舞台动作坞')
    const groups = nodesByClass(tree, 'ofs-dock-group')
    assert.equal(groups.length, 2, '动作坞应分两组')
    assert.deepEqual(groups.map((group) => group.props['data-group']), ['process', 'reuse'])
    assert.equal(groups[0].props['aria-label'], '图片处理', '图片处理组要可读')
    // 图片处理组：局部重绘 / 整图重绘 / 高清放大 / 扩图（阶段十五 Phase B 起全部可用）。
    const processButtons = groups[0].children.filter((child) => child && child.type === 'button')
    const processLabels = processButtons.map((node) => collectText(node).join(''))
    assert.deepEqual(processLabels, ['局部重绘', '整图重绘', '高清放大', '扩图'])
    const [inpaintButton, img2imgButton, upscaleButton, outpaintButton] = processButtons
    for (const button of [inpaintButton, img2imgButton, upscaleButton, outpaintButton]) {
      assert.equal(typeof button.props.onClick, 'function', '四个图片工具都应可点击')
      assert.equal(button.props['aria-disabled'], undefined, '不再有禁用占位')
    }
    assert.equal(upscaleButton.props.title, '高清放大', '可用工具的 title 是按钮名')
    assert.equal(outpaintButton.props.title, '扩图')
    // 创作复用组：阶段十五 Phase A1 起只剩「重新生成」（「带回参数」已下线）。
    const reuseText = collectText(groups[1]).join(' | ')
    assert.ok(!reuseText.includes('带回参数'), '「带回参数」已从动作坞下线')
    assert.ok(reuseText.includes('重新生成'), '创作复用组保留「重新生成」')
    // 旧动作已删除：dock 不再有复制路径与「以此结果继续重绘」。
    const dockText = collectText(dock).join(' | ')
    assert.ok(!dockText.includes('复制文件路径'), 'dock 里的复制路径已移除（右上角悬浮按钮保留）')
    assert.ok(!dockText.includes('以此结果继续重绘'), '「以此结果继续重绘」按钮已删除')
  } finally {
    client.unmount()
  }
})
// 「整图重绘」原地展开轻量重绘条（不切画布），预设下拉只列支持垫图的模型。
await check('渲染：动作坞「整图重绘」原地展开重绘条，预设只列可用模型', async () => {
  const secondImg2img = { ...realvis, supportsImg2Img: true, supportsInpaint: true }
  const client = await createTestClient({
    now: NOW,
    responses: {
      '/imagen-api/state': {
        ...readyState,
        presets: [toolPreset, secondImg2img, noCapabilityPreset],
        defaultPreset: 'sdxl-lightning',
      },
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    buttonByText(tree, '整图重绘').props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('inline-tool', tree, {
      required: { 'ofs-inline-tool': 1, 'ofs-inline-stage': 1, 'ofs-tool-bar': 1, 'ofs-tool-submit': 1 },
      forbidden: ['ofs-mask-canvas'],
    })
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('整图重绘'), '重绘条应显示当前工具名')
    assert.ok(text.includes('修改描述'), '重绘条带提示词输入')
    assert.ok(text.includes('重绘强度'), '重绘条带强度滑块')
    // 工具预设下拉只列支持整图垫图的模型：flux2（不支持）不得出现。
    const select = nodesByClass(tree, 'ofs-tool-select')[0]
    assert.ok(select, '多个可用模型时应给下拉选择')
    const optionValues = select.children.filter((child) => child && child.type === 'option').map((child) => child.props.value)
    assert.deepEqual(optionValues, ['sdxl-lightning', 'realvis-v5'], '只列支持 supportsImg2Img 的预设')
    const optionText = collectText(select).join(' | ')
    assert.ok(!optionText.includes('Klein'), '不支持垫图的模型不得出现在下拉里')
    // 取消编辑：回到作品预览并丢弃草稿（不保留继续编辑）。
    nodesByClass(tree, 'ofs-tool-exit')[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('inline-tool-closed', tree, {
      required: { 'ofs-print': 1, 'ofs-dock': 1 },
      forbidden: ['ofs-inline-tool', 'ofs-dock-resume'],
    })
  } finally {
    client.unmount()
  }
})
// 涂抹画布：按底图比例换算、工具栏键盘 / 触控可用；退出后草稿保留。
await check('渲染：局部涂抹画布按底图比例渲染，工具栏可键盘 / 触控使用', async () => {
  const portrait = {
    path: 'imagen-output/job-1/portrait.png',
    file: 'portrait.png',
    url: '/imagen-api/file?path=imagen-output%2Fjob-1%2Fportrait.png',
    seed: 11,
    seconds: 6.2,
    width: 768,
    height: 1024,
  }
  const portraitItem = { ...historyItem, images: [portrait] }
  const client = await createTestClient({
    now: NOW,
        responses: studioResponses({ ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' }, { items: [portraitItem] }),
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    buttonByText(tree, '局部重绘').props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('mask-editor', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-mask-tools': 1, 'ofs-mask-cursor': 1, 'ofs-mask-guide': 1, 'ofs-tool-bar': 1 },
      forbidden: ['ofs-print'],
    })
    const stageNode = nodesByClass(tree, 'ofs-mask-stage')[0]
    assert.ok(stageNode, '涂抹态应挂载画布外框')
    assert.equal(stageNode.props.style['--ofs-mask-r'], '0.75', '宽高比变量按 768×1024 换算')
    assert.equal(stageNode.props.style.aspectRatio, '768 / 1024', '内联 aspect-ratio 与底图一致')
    const canvas = findNodes(tree, (node) => node.type === 'canvas')[0]
    assert.ok(canvas, '涂抹态应挂载 canvas 蒙版层')
    assert.equal(canvas.props.role, 'application')
    assert.equal(canvas.props.tabIndex, 0, '画布可键盘聚焦')
    assert.equal(typeof canvas.props.onPointerDown, 'function', '画布支持指针 / 触控绘制')
    assert.equal(typeof canvas.props.onKeyDown, 'function', '画布支持键盘绘制')
    assert.ok(typeof canvas.props['aria-label'] === 'string' && canvas.props['aria-label'].includes('方向键'), '画布要给出键盘操作说明')
    const range = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'range')[0]
    assert.ok(range, '涂抹态应提供画笔大小滑块')
    assert.equal(range.props.min, MASK_BRUSH.min)
    assert.equal(range.props.max, MASK_BRUSH.max)
    assert.equal(range.props.step, MASK_BRUSH.step)
    assert.equal(range.props.value, MASK_BRUSH.default)
    for (const label of ['橡皮擦', '清空蒙版', '反选区域', '暂存涂抹']) {
      const button = buttonByText(tree, label)
      assert.ok(button, `涂抹工具栏缺少「${label}」`)
      assert.ok(Number(button.props.style.minHeight) >= 44, `「${label}」热区高度应不小于 44px`)
    }
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('一次只改一个物体'), '涂抹态要给出蒙版操作要点')
    assert.ok(text.includes('少步快速模型'), '少步模型要提示换多步模型')
    assert.ok(text.includes('已涂抹 0%'), '覆盖率读数从 0% 起')
    // 暂存涂抹：收起画布，草稿仍在 → dock 显示「继续编辑」。
    nodesByClass(tree, 'ofs-mask-close')[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('mask-editor-closed', tree, {
      required: { 'ofs-print': 1, 'ofs-dock-resume': 1 },
      forbidden: ['ofs-mask-editor'],
    })
    nodesByClass(tree, 'ofs-dock-resume')[0].props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('mask-editor-resumed', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1 },
      forbidden: [],
    })
    const resumedPhoto = nodesByClass(tree, 'ofs-mask-photo')[0]
    assert.ok(resumedPhoto && resumedPhoto.props.src === portrait.url, '继续编辑恢复同一张底图')
  } finally {
    client.unmount()
  }
})
// 编辑中切换胶片条：先退出画布编辑态（SPEC §5.17），草稿按作品路径保留；
// 预览与左栏切到被点作品，工具底图仍绑定在打开时确定的那张（阶段十五 Phase C0）。
await check('渲染：涂抹中切换胶片条退出编辑态，工具底图与草稿按路径保留', async () => {
  const client = await createTestClient({
    now: NOW,
        responses: studioResponses({ ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' }, { items: [historyItem] }),
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    buttonByText(tree, '局部重绘').props.onClick()
    tree = await client.rerenderRaw()
    const photoBefore = nodesByClass(tree, 'ofs-mask-photo')[0]
    assert.equal(photoBefore.props.src, historyItem.images[0].url, '底图是舞台当前作品')
    // 涂抹中写一段未提交的修改描述：切走后这份草稿要按作品路径保留。
    nodesByClass(tree, 'ofs-tool-prompt-input')[0].props.onChange({ target: { value: '涂抹中的草稿' } })
    tree = await client.rerenderRaw()
    // 点另一张缩略图：预览与左栏切到被点作品，正在编辑的画布先退出（草稿保留）。
    const thumbs = nodesByClass(tree, 'ofs-thumb')
    assert.equal(thumbs.length, 2, '历史批次应有 2 张缩略图')
    const target = thumbs.find((node) => node.key !== historyItem.images[0].path) || thumbs[1]
    target.props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-mask-editor').length, 0, '切作品退出画布编辑态')
    assert.equal(nodesByClass(tree, 'ofs-print').length, 1, '舞台回到作品预览')
    // 工具底图与草稿仍属于打开时那张：dock 给「继续编辑」，恢复后回到原底图与原描述。
    const resume = nodesByClass(tree, 'ofs-dock-resume')[0]
    assert.ok(resume, '切走后保留原作品的工具草稿，dock 给「继续编辑」')
    resume.props.onClick()
    tree = await client.rerenderRaw()
    const photoAfter = nodesByClass(tree, 'ofs-mask-photo')[0]
    assert.ok(photoAfter, '继续编辑回到涂抹画布')
    assert.equal(photoAfter.props.src, historyItem.images[0].url, '工具底图绑定在打开时确定，不随预览切换')
    assert.equal(
      nodesByClass(tree, 'ofs-tool-prompt-input')[0].props.value,
      '涂抹中的草稿',
      '草稿按作品路径恢复',
    )
    // 编辑态底部由单行提交条接管：提供唯一退出按钮，不重复渲染动作坞。
    assert.equal(nodesByClass(tree, 'ofs-dock').length, 0, '编辑态不重复渲染动作坞')
    assert.equal(nodesByClass(tree, 'ofs-tool-exit').length, 1, '编辑态提供唯一退出按钮')
  } finally {
    client.unmount()
  }
})
// 专用局部重绘预设：主表单本次生成自动兜底并轻提示，左栏表单预设不变；工具选模同样不回写。
await check('渲染：专用局部重绘预设下主表单自动兜底，工具选模不回写左栏', async () => {
  const responses = {
    '/imagen-api/state': {
      ...readyState,
      presets: [toolPreset, nativeToolPreset],
      defaultPreset: 'sdxl-inpaint',
    },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-fallback', status: 'queued' },
  }
  const { client, latest } = await mountToolStudio(responses)
  try {
    assert.equal(latest.studio.form.form.presetId, 'sdxl-inpaint', '旧宿主可把专用预设留作表单默认值')
    // 1) 主表单生成：本次请求改用可文生图的兜底预设，左栏选择不变。
    latest.studio.form.patchForm({ prompt: '雨夜街景' })
    await client.rerenderRaw()
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    const submitted = generateCalls(client).pop()
    assert.equal(submitted.body.presetId, 'sdxl-lightning', '专用预设不能文生图：本次改用兜底预设')
    assert.ok(latest.studio.ui.toast && latest.studio.ui.toast.text.includes('本次已改用 SDXL Lightning 文生图'), '兜底切换要给轻提示')
    assert.equal(latest.studio.form.form.presetId, 'sdxl-inpaint', '左栏表单预设不被改写')
    // 2) 工具选模：优先沿用当前预设（专用预设支持 Inpaint），工具内切换同样不回写左栏。
    assert.equal(latest.studio.actions.openImageTool('inpaint'), true)
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.activeTool.id, 'inpaint')
    assert.equal(latest.studio.imageTool.presetId, 'sdxl-inpaint', '当前预设支持 Inpaint 时工具沿用它')
    assert.equal(latest.studio.imageTool.selectPreset('sdxl-lightning'), true)
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.presetId, 'sdxl-lightning')
    assert.equal(latest.studio.form.form.presetId, 'sdxl-inpaint', '工具预设切换不得写回主表单')
  } finally {
    client.unmount()
  }
  // 3) 左栏是不支持垫图的模型：打开局部涂抹时自动切到专用权重并提示。
  const fluxResponses = {
    ...responses,
    '/imagen-api/state': {
      ...readyState,
      presets: [noCapabilityPreset, toolPreset, nativeToolPreset],
      defaultPreset: 'flux2-klein-4b',
    },
  }
  const second = await mountToolStudio(fluxResponses)
  try {
    assert.equal(second.latest.studio.form.form.presetId, 'flux2-klein-4b')
    assert.equal(second.latest.studio.actions.openImageTool('inpaint'), true)
    await second.client.rerenderRaw()
    assert.equal(second.latest.studio.imageTool.presetId, 'sdxl-inpaint', '不支持 Inpaint 的模型应自动切到专用权重')
    assert.ok(second.latest.studio.ui.toast && second.latest.studio.ui.toast.text.includes('已自动改用 SDXL Inpaint'), '自动选模要 toast 说明')
    assert.equal(second.latest.studio.form.form.presetId, 'flux2-klein-4b', '自动选模不改左栏表单')
  } finally {
    second.client.unmount()
  }
})
// 工具蒙版提交：reference.mask 随工具请求体下发；失败后保留底图 / 提示词 / 蒙版可继续编辑。
await check('渲染：工具蒙版随 reference.mask 提交，失败后保留草稿', async () => {
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-tool', status: 'queued' },
  }
  const { client, latest } = await mountToolStudio(responses)
  try {
    assert.equal(latest.studio.actions.openImageTool('inpaint'), true)
    await client.rerenderRaw()
    assert.deepEqual(latest.studio.imageTool.applyMask({ data: MASK_PNG_B64, coverage: 0.2 }), { ok: true })
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.mask.data, MASK_PNG_B64)
    assert.equal(latest.studio.imageTool.coverage, 0.2)
    assert.equal(latest.studio.imageTool.canSubmit, true)
    await latest.studio.imageTool.submit()
    await client.settle()
    const submitted = generateCalls(client).pop()
    assert.ok(submitted && submitted.body.reference, '工具提交体应带 reference')
    assert.equal(submitted.body.reference.path, historyItem.images[0].path)
    assert.equal(submitted.body.reference.mask, MASK_PNG_B64, '画布蒙版以裸 base64 随 reference.mask 提交')
    assert.equal(submitted.body.reference.strength, 0.8)
    // 成功提交：草稿清空，pendingTool 记录任务信息（阶段十三幽灵节点用）。
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.activeTool, null, '提交成功后清空草稿')
    assert.equal(latest.studio.imageTool.pendingTool && latest.studio.imageTool.pendingTool.jobId, 'job-tool')
  } finally {
    client.unmount()
  }
  // 提交失败：保留底图 / 提示词 / 蒙版，收起编辑态后可「继续编辑」（决策 D5）。
  const failing = await mountToolStudio(responses, { '/imagen-api/generate': 'Failed to fetch' })
  try {
    assert.equal(failing.latest.studio.actions.openImageTool('inpaint'), true)
    await failing.client.rerenderRaw()
    failing.latest.studio.imageTool.setPrompt('把帽子换成红色贝雷帽')
    assert.deepEqual(failing.latest.studio.imageTool.applyMask({ data: MASK_PNG_B64, coverage: 0.2 }), { ok: true })
    await failing.client.rerenderRaw()
    assert.equal(await failing.latest.studio.imageTool.submit(), false)
    await failing.client.settle()
    await failing.client.rerenderRaw()
    const failed = failing.latest.studio.imageTool
    assert.equal(failed.editorOpen, false, '失败后收起编辑态')
    assert.equal(failed.activeTool.id, 'inpaint', '失败后保留工具，dock 可继续编辑')
    assert.equal(failed.target.path, historyItem.images[0].path, '失败后保留底图')
    assert.equal(failed.prompt, '把帽子换成红色贝雷帽', '失败后保留提示词')
    assert.equal(failed.mask.data, MASK_PNG_B64, '失败后保留蒙版')
    assert.ok(failed.pendingTool === null, '失败不产生 pendingTool')
  } finally {
    failing.client.unmount()
  }
})
// 旧宿主：/state.presets 没有能力字段时按不支持处理，纯文生图不受影响，工具入口明确拒绝。
await check('渲染：旧宿主没有图片能力字段时文生图不回归，工具入口明确提示', async () => {
    const responses = studioResponses(readyState, { items: [historyItem] }, { '/imagen-api/generate': { id: 'job-old', status: 'queued' } })
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { initialPrompt: '雨夜街景' })
    nodesByClass(tree, 'ofs-generate')[0].props.onClick()
    await client.settle()
    const submitted = generateCalls(client).pop()
    assert.ok(submitted, '旧宿主下文生图仍应照常提交')
    assert.ok(!('reference' in submitted.body), '旧宿主文生图请求体不带 reference')
    // 没有 supportsInpaint 的预设：打开工具时明确说明没有可用模型，不进入编辑态。
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    buttonByText(tree, '局部重绘').props.onClick()
    tree = await client.rerenderRaw()
    assert.ok(collectText(tree).join(' | ').includes('没有可用的模型，无法执行图片工具'), '缺少可用模型要说明')
    assert.equal(nodesByClass(tree, 'ofs-mask-editor').length, 0, '不得进入空白编辑态')
    assert.equal(nodesByClass(tree, 'ofs-print').length, 1, '停留在作品预览')
  } finally {
    client.unmount()
  }
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
    const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
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
  const buttons = findNodes(ready.tree, (node) => node.type === 'button' && node.props?.className === 'ofs-ghost-cancel')
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
  const pendingButtons = findNodes(pending.tree, (node) => node.type === 'button' && node.props?.className === 'ofs-ghost-cancel')
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
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
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
// ── 阶段十二：舞台动作坞 / 工具草稿 / 纯文生图重试 ────────────────────
//
// 组件层直接用最小 props 挂载 Stage（断言结构），状态流转用 useStudio harness
// 驱动真实 imageTool 与 actions。旧的参考图 / 蒙版 / 续绘用例已在上面按新交互改写。

/** 最小 action 替身：只记录调用，不执行。 */
function stageActionsSpy() {
  const calls = { iterate: 0, reroll: 0, tools: [], closed: 0 }
  return {
    calls,
    iterate: () => { calls.iterate += 1 },
    reroll: () => { calls.reroll += 1 },
    openImageTool: (kind, entry) => {
      calls.tools.push({ kind, path: entry && entry.image ? entry.image.path : '' })
      return true
    },
    closeImageTool: () => { calls.closed += 1 },
  }
}

/** Stage 的真实 props 形状：imageTool 用受控替身，只验证编排与类名。 */
function stagePropsOf(imageTool) {
  const selected = { image: historyItem.images[0], item: historyItem }
  const actions = stageActionsSpy()
  return {
    actions,
    props: {
      t: null,
      ui: { zoom: false, setZoom: () => {}, copyPath: () => {}, showToast: () => {} },
      compute: { activeJob: null, status: {}, presets: [toolPreset] },
      form: { form: { width: 1024, height: 1024, presetId: 'sdxl-lightning' }, useInspiration: () => {} },
      library: { selected, isFavorite: () => false, toggleFavorite: () => {} },
      imageTool,
      actions,
      now: NOW,
    },
  }
}
// 空舞台：没有底图就没有图片工具入口（旧版空舞台涂抹入口已删除）。
await check('渲染：空舞台不出现动作坞与图片工具入口', async () => {
  const responses = {
    '/imagen-api/state': { defaultPreset: 'sdxl-lightning', presets: [preset], session: { state: 'absent', error: null }, jobs: [] },
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  }
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    const tree = await client.mountRaw(client.components.Studio, {})
    assertStructure('empty-no-tools', tree, {
      required: { 'ofs-figure--empty': 1 },
      forbidden: ['ofs-dock', 'ofs-mask-editor', 'ofs-inline-tool', 'ofs-rail-tools-hint'],
    })
    const text = collectText(tree).join(' | ')
    assert.ok(!text.includes('图片处理（局部重绘 / 整图重绘）在舞台底部的动作坞里'), '左栏不再用独立提示行说明动作坞位置')
  } finally {
    client.unmount()
  }
})
// 动作坞的两种编排：非编辑态显示「继续编辑 + 草稿覆盖率」，编辑态只挂画布编辑器。
await check('渲染：动作坞展示工具草稿状态，编辑态只挂载画布编辑器', async () => {
  const selected = { image: historyItem.images[0], item: historyItem }
  const baseTool = {
    id: 'inpaint',
    form: 'canvas',
    group: 'process',
    icon: 'focus',
    capability: 'supportsInpaint',
    labelKey: 'studio.imageTool.inpaint',
    ready: true,
    target: {
      path: selected.image.path,
      url: selected.image.url,
      width: 1024,
      height: 1024,
      item: historyItem,
      prompt: '测试用的荷花池塘',
    },
    prompt: '把帽子换成红色贝雷帽',
    strength: 0.8,
    strengthMax: 0.9,
    strengthAuto: false,
    presetId: 'sdxl-lightning',
    toolPresets: [toolPreset],
    mask: { data: MASK_PNG_B64, coverage: 0.2, digest: 'd-1' },
    coverage: 0.2,
    selectPreset: () => true,
    setPrompt: () => {},
    setStrength: () => {},
    applyMask: () => ({ ok: true }),
    clearMask: () => {},
    submit: async () => true,
    closeTool: () => {},
    canSubmit: true,
    submitBlockedKey: '',
    submitting: false,
    pendingTool: null,
  }
  // 1) 非编辑态 + 有草稿：dock 出现「继续编辑」与覆盖率读数，点击按草稿底图重开。
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  try {
    const draftImageTool = { ...baseTool, activeTool: baseTool, editorOpen: false }
    const { props, actions } = stagePropsOf(draftImageTool)
    let tree = await client.mountRaw(client.components.Stage, { ...props, t })
    assertStructure('dock-draft', tree, {
      required: { 'ofs-dock': 1, 'ofs-dock-resume': 1, 'ofs-dock-draft': 1, 'ofs-print': 1 },
      forbidden: ['ofs-mask-editor', 'ofs-inline-tool'],
    })
    assert.ok(collectText(tree).join(' | ').includes('继续编辑'), 'dock 提供继续编辑')
    assert.ok(collectText(tree).join(' | ').includes('已涂 20%'), 'dock 展示草稿的蒙版覆盖率')
    nodesByClass(tree, 'ofs-dock-resume')[0].props.onClick()
    assert.deepEqual(actions.calls.tools, [{ kind: 'inpaint', path: selected.image.path }], '继续编辑按草稿底图重开工具')
    // 2) 编辑态：画布编辑器顶替预览，下方直接由提交栏接管（不再多挂一条重复退出的 dock）。
    const editingImageTool = { ...baseTool, activeTool: baseTool, editorOpen: true }
    const editing = stagePropsOf(editingImageTool)
    tree = await client.mountRaw(client.components.Stage, { ...editing.props, t })
    assertStructure('dock-editing', tree, {
      required: { 'ofs-figure': 1, 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-tool-bar': 1, 'ofs-tool-exit': 1 },
      forbidden: ['ofs-inline-tool', 'ofs-dock-resume', 'ofs-dock'],
    })
    const photo = nodesByClass(tree, 'ofs-mask-photo')[0]
    assert.ok(photo && photo.props.src === selected.image.url, '画布底图来自工具 target')
    nodesByClass(tree, 'ofs-tool-exit')[0].props.onClick()
  } finally {
    client.unmount()
  }
})
// 助手 / 变体：没有任何参考图分支，请求体保持纯文生图。
await check('渲染：助手与变体请求保持纯文生图', async () => {
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-src', status: 'queued' },
  }
  const { client, latest } = await mountToolStudio(responses)
  try {
    // 1) 助手来源。
    let before = generateCalls(client).length
    assert.equal(await latest.studio.actions.generate({ prompt: '助手提示词' }, { source: 'assistant', pushUser: false }), true)
    await client.settle()
    let submitted = generateCalls(client).pop()
    assert.equal(generateCalls(client).length, before + 1)
    assert.ok(!('reference' in submitted.body), '助手请求不得携带参考图')
    assert.ok(!('strength' in submitted.body), '助手请求不得携带重绘强度')
    assert.equal(submitted.body.prompt, '助手提示词')
    // 2) 变体来源：保留作品提示词，随机种子 + 固定单张。
    before = generateCalls(client).length
    latest.studio.actions.reroll({ image: historyItem.images[1], item: historyItem })
    await client.settle()
    submitted = generateCalls(client).pop()
    assert.equal(generateCalls(client).length, before + 1)
    assert.ok(!('reference' in submitted.body), '生成变体不得携带参考图')
    assert.equal(submitted.body.prompt, '测试用的荷花池塘')
    assert.equal(submitted.body.count, 1, '生成变体固定一张')
    assert.equal(submitted.body.seed, -1, '生成变体使用随机种子')
    // 主表单本身仍是纯文生图：没有任何 reference 字段可被串进请求。
    assert.equal(latest.studio.form.form.reference, undefined, '主表单不再持有 reference')
  } finally {
    client.unmount()
  }
})
// 失败重试分流：纯文生图任务重放参数；图片工具任务引导回动作坞恢复（决策 D5）。
await check('渲染：失败重试只重放纯文生图，图片工具任务引导回动作坞', async () => {
  // 1) 纯文生图失败任务：按任务参数重试，请求体无 reference。
  const textResponses = {
    '/imagen-api/state': {
      ...readyState,
      presets: [toolPreset],
      defaultPreset: 'sdxl-lightning',
      lastJob: {
        id: 'job-failed-text',
        status: 'failed',
        presetId: 'sdxl-lightning',
        params: { prompt: '失败的画面', width: 1152, height: 648, steps: 4, cfg: 0, count: 2, negativePrompt: 'blurry' },
        error: { code: 'generation_failed', message: '远端生成失败' },
      },
    },
    '/imagen-api/history': { items: [historyItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-retried', status: 'queued' },
  }
  const first = await mountToolStudio(textResponses)
  try {
    const before = generateCalls(first.client).length
    first.latest.studio.actions.retryFocusedJob()
    await first.client.settle()
    const submitted = generateCalls(first.client).pop()
    assert.equal(generateCalls(first.client).length, before + 1, '纯文生图失败任务应直接重试')
    assert.equal(submitted.body.prompt, '失败的画面', '提示词按失败任务恢复')
    assert.equal(submitted.body.width, 1152)
    assert.equal(submitted.body.height, 648)
    assert.equal(submitted.body.count, 2)
    assert.equal(submitted.body.presetId, 'sdxl-lightning')
    assert.ok(!('reference' in submitted.body), '纯文生图重试不得携带参考图')
  } finally {
    first.client.unmount()
  }
  // 2) 图片工具任务（params.reference）：不压成文生图重放，指向动作坞「继续编辑」。
  const toolResponses = {
    ...textResponses,
    '/imagen-api/state': {
      ...textResponses['/imagen-api/state'],
      lastJob: {
        id: 'job-failed-tool',
        status: 'failed',
        presetId: 'sdxl-inpaint',
        params: {
          prompt: '局部改成红灯笼',
          reference: { sourcePath: historyItem.images[0].path, strength: 0.8, mask: true },
        },
        error: { code: 'generation_failed', message: '远端生成失败' },
      },
    },
  }
  const second = await mountToolStudio(toolResponses)
  try {
    const before = generateCalls(second.client).length
    second.latest.studio.actions.retryFocusedJob()
    await second.client.settle()
    await second.client.rerenderRaw()
    assert.equal(generateCalls(second.client).length, before, '工具任务不得被压成文生图重试')
    assert.ok(second.latest.studio.ui.toast && second.latest.studio.ui.toast.text.includes('图片工具任务请在舞台动作坞中点「继续编辑」恢复后重新提交'), '工具任务失败要引导回动作坞恢复')
  } finally {
    second.client.unmount()
  }
})
// 专用局部重绘预设下从画廊进入工具：自动沿用专用权重，未涂抹时提交被拦（专用权重必须带蒙版）。
await check('渲染：专用局部重绘预设下画廊入口进入工具并拦下无蒙版提交', async () => {
  const client = await createTestClient({
    now: NOW,
    responses: {
      '/imagen-api/state': {
        ...readyState,
        presets: [toolPreset, nativeToolPreset],
        defaultPreset: 'sdxl-inpaint',
      },
      '/imagen-api/history': { items: [historyItem] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, { view: 'gallery' })
    buttonByText(tree, '重绘编辑').props.onClick()
    tree = await client.rerenderRaw()
    assertStructure('native-tool-open', tree, {
      required: { 'ofs-mask-editor': 1, 'ofs-mask-canvas': 1, 'ofs-tool-bar': 1 },
      forbidden: ['ofs-gallery'],
    })
    const select = nodesByClass(tree, 'ofs-tool-select')[0]
    assert.ok(select, '两个可用 Inpaint 预设时应给下拉')
    assert.equal(select.props.value, 'sdxl-inpaint', '打开工具时沿用当前专用预设')
    assert.deepEqual(select.children.filter((child) => child && child.type === 'option').map((child) => child.props.value), ['sdxl-lightning', 'sdxl-inpaint'], 'Inpaint 工具只列支持 supportsInpaint 的预设')
    // 专用权重没有蒙版时不能提交：ToolSubmitBar 显示拦截原因，按钮禁用。
    const blocked = nodesByClass(tree, 'ofs-tool-blocked')[0]
    assert.ok(blocked, '缺少蒙版时要显示拦截原因')
    assert.ok(collectText(blocked).join('').includes('当前是局部重绘专用模型'), '说明专用权重需要先涂抹')
    assert.equal(nodesByClass(tree, 'ofs-tool-submit')[0].props.disabled, true, '无蒙版时提交按钮禁用')
  } finally {
    client.unmount()
  }
})
// ── 阶段十三：显式新建绘图、根折叠版本树、草稿圆点与旧宿主降级 ─────────
//
// 覆盖 0.13.0 的三个新交互：
//   1. workspaceMode='new_draft' 时舞台是「模糊背景 + 取景框」、作品条最左端是草稿卡；
//      提交后保持 new_draft，任务完成后自动切 work 并选中新图；
//   2. Filmstrip 按根树折叠（一棵树一张卡 + ⎇ N 角标），版本面板可悬停展开、Esc 收起、
//      行内点选切版本；面板首次展开按需拉 /history/tree，旧宿主 404 时降级提示；
//   3. 工具的未提交编辑按作品路径缓存成草稿，缩略图与面板行亮圆点、可一键清空。

/** 一棵两级派生树：根作品 + 从根重绘出来的子作品（带 Host 透传的 sourceImage/rootImage）。 */
function derivedHistoryFixture() {
  const rootImage = {
    path: 'imagen-output/20261109-120000-job-root/01.png',
    file: '01.png',
    url: '/imagen-api/file?path=root-01',
    width: 1024,
    height: 1024,
    seed: 1,
    seconds: 6.2,
  }
  const childImage = {
    path: 'imagen-output/20261109-121000-job-child/01.png',
    file: '01.png',
    url: '/imagen-api/file?path=child-01',
    width: 1024,
    height: 1024,
    seed: 2,
    seconds: 6.2,
  }
  const rootItem = {
    jobId: 'job-root',
    dir: 'imagen-output/20261109-120000-job-root',
    prompt: '根作品提示词',
    presetId: 'sdxl-lightning',
    finishedAt: at(-120),
    images: [rootImage],
    sourceImage: null,
    rootImage: null,
    inpaint: false,
  }
  const childItem = {
    jobId: 'job-child',
    dir: 'imagen-output/20261109-121000-job-child',
    prompt: '派生作品提示词',
    presetId: 'sdxl-lightning',
    finishedAt: at(-30),
    images: [childImage],
    sourceImage: rootImage.path,
    rootImage: rootImage.path,
    inpaint: true,
    strength: 0.8,
  }
  return { rootItem, childItem, rootImage, childImage }
}

await check('渲染：作品条按根折叠——一棵树一张卡 + ⎇ N 角标取最新节点', async () => {
  const { rootItem, childItem, childImage } = derivedHistoryFixture()
  const client = await createTestClient({ now: NOW, responses: studioResponses(readyState, { items: [childItem, rootItem] }), testBuild: true })
  try {
    const tree = await client.mountRaw(client.components.Studio, {})
    assert.equal(nodesByClass(tree, 'ofs-batch').length, 1, '同一棵树只占一张作品卡')
    assert.equal(nodesByClass(tree, 'ofs-version-anchor').length, 1)
    assert.equal(nodesByClass(tree, 'ofs-thumb').length, 1, '折叠后只有最新节点一张缩略图')
    const badge = nodesByClass(tree, 'ofs-version-badge')[0]
    assert.ok(badge, '有派生版本时应显示 ⎇ N 角标')
    assert.ok(collectText(badge).join('').includes('⎇ 1'), `角标应显示 ⎇ 1：${collectText(badge).join('')}`)
    assert.ok(collectText(tree).join(' | ').includes('1 个版本'), '卡下 meta 应显示版本数')
    const thumb = nodesByClass(tree, 'ofs-thumb')[0]
    const thumbImg = findNodes(thumb, (node) => node.type === 'img')[0]
    assert.ok(thumbImg && thumbImg.props.src === childImage.url, '缩略图应是该树最新活跃节点')
  } finally {
    client.unmount()
  }
})

await check('渲染：版本面板——悬停 250ms 展开、v 编号行、点行切版本、Esc 收起', async () => {
  const { rootItem, childItem, childImage } = derivedHistoryFixture()
  const client = await createTestClient({ now: NOW, responses: studioResponses(readyState, { items: [childItem, rootItem] }), testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    const anchor = nodesByClass(tree, 'ofs-version-anchor')[0]
    assert.ok(anchor, '缺少版本角标容器')
    anchor.props.onMouseEnter()
    await client.advanceTimers(300)
    tree = await client.rerenderRaw()
    assertStructure('version-panel', tree, {
      required: { 'ofs-version-panel': 1, 'ofs-version-row': 2, 'ofs-version-label': 2, 'ofs-version-thumb': 2 },
      forbidden: [],
    })
    const labels = nodesByClass(tree, 'ofs-version-label').map((node) => collectText(node).join('')).sort()
    assert.deepEqual(labels, ['v1', 'v2'], '面板里是 v1（根）与 v2（派生）')
    assert.ok(collectText(tree).join(' | ').includes('局部重绘'), '派生版本行带类型图标与文案')
    // 点击派生版本行：舞台切到该版本，面板收起。
    const rowButtons = nodesByClass(tree, 'ofs-version-row-main').filter((node) => node.type === 'button')
    assert.equal(rowButtons.length, 2)
    rowButtons[1].props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-version-panel').length, 0, '选择版本后面板收起')
    const stageImage = nodesByClass(tree, 'ofs-image')[0]
    assert.ok(stageImage && stageImage.props.src === childImage.url, '舞台应切到被点选的派生版本')
    // 再打开面板：点击角标固定展开，鼠标移出也不收起；Esc 关闭。
    nodesByClass(tree, 'ofs-version-anchor')[0].props.onMouseEnter()
    await client.advanceTimers(300)
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-version-panel').length, 1, '悬停应展开版本面板')
    const anchorAgain = nodesByClass(tree, 'ofs-version-anchor')[0]
    nodesByClass(tree, 'ofs-version-badge')[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
    tree = await client.rerenderRaw()
    anchorAgain.props.onMouseLeave()
    await client.advanceTimers(500)
    tree = await client.rerenderRaw()
    const pinnedPanel = nodesByClass(tree, 'ofs-version-panel')[0]
    assert.ok(pinnedPanel, '点击角标固定展开后，鼠标移出不应收起')
    pinnedPanel.props.onKeyDown({ key: 'Escape', stopPropagation() {}, preventDefault() {} })
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-version-panel').length, 0, 'Esc 应收起版本面板')
  } finally {
    client.unmount()
  }
})

await check('渲染：版本面板在途幽灵行 + 展开时按需拉整棵树', async () => {
  const { rootItem, childItem, rootImage } = derivedHistoryFixture()
  const pendingJob = {
    id: 'job-pending',
    status: 'running',
    presetId: 'sdxl-lightning',
    createdAt: at(-5),
    params: {
      prompt: '继续涂抹',
      width: 1024,
      height: 1024,
      count: 1,
      // Host /state 快照的真实形状：reference.sourcePath + 布尔 mask 标记。
      reference: { sourcePath: rootImage.path, strength: 0.8, mask: true },
    },
  }
  const loadCalls = []
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Filmstrip, {
      t: client.internals.i18n.fallbackTranslate('zh'),
      ui: { setView: () => {}, setPanelMode: () => {} },
      compute: {
        pendingJobs: [pendingJob],
        sessionState: 'ready',
        startSession: () => {},
        status: { stopped: false },
        cancellingIds: [],
      },
      library: {
        items: [childItem, rootItem],
        selected: null,
        selectImage: () => {},
        hasMore: true,
        loadTree: (root) => loadCalls.push(root),
        workDrafts: {},
      },
      actions: { previewWork: () => {} },
      now: NOW,
    })
    const badge = nodesByClass(tree, 'ofs-version-badge')[0]
    assert.ok(collectText(badge).join('').includes('⎇ 2'), `派生 1 + 在途 1 应为 ⎇ 2：${collectText(badge).join('')}`)
    nodesByClass(tree, 'ofs-version-anchor')[0].props.onMouseEnter()
    await client.advanceTimers(300)
    tree = await client.rerenderRaw()
    assert.deepEqual(loadCalls, [rootItem.images[0].path], '面板展开时应按需拉该根整棵树')
    const ghostRow = nodesByClass(tree, 'ofs-version-row')
      .find((node) => String(node.props && node.props.className).split(/\s+/).includes('is-ghost'))
    assert.ok(ghostRow, '在途任务应渲染成幽灵行')
    assert.ok(collectText(ghostRow).join('').includes('生成中'), '幽灵行应标「生成中」')
  } finally {
    client.unmount()
  }
})

await check('渲染：工具草稿按作品缓存，圆点摘要与一键清空', async () => {
  const { rootItem, childItem } = derivedHistoryFixture()
  const { client, latest } = await mountToolStudio({
    '/imagen-api/state': { ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [childItem, rootItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  })
  try {
    const entry = { image: childItem.images[0], item: childItem }
    const key = childItem.images[0].path
    assert.equal(latest.studio.actions.openImageTool('inpaint', entry), true)
    await client.rerenderRaw()
    latest.studio.imageTool.setPrompt('改成夜景')
    await client.rerenderRaw()
    assert.ok(latest.studio.imageTool.workDrafts[key], '编辑工具时应把草稿挂到该作品路径下')
    const summary = latest.studio.imageTool.workDraftSummary(key)
    assert.equal(summary.active, true)
    assert.deepEqual(summary.items, ['prompt'])
    assert.equal(latest.studio.library.workDraftSummary(key).active, true, 'library 视图暴露同一份摘要')
    // 退出编辑态再打开同一作品：草稿要能恢复（阶段十三目标）。
    latest.studio.imageTool.closeTool()
    await client.rerenderRaw()
    assert.equal(latest.studio.actions.openImageTool('inpaint', entry), true)
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.prompt, '改成夜景', '重新打开工具应恢复未提交提示词')
    latest.studio.imageTool.clearWorkDraft(key)
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.workDrafts[key], undefined, '清空后草稿表移除该作品')
    assert.equal(latest.studio.imageTool.workDraftSummary(key).active, false)
  } finally {
    client.unmount()
  }
})

await check('渲染：作品条缩略图草稿圆点与版本面板行圆点', async () => {
  const { rootItem, childItem, childImage } = derivedHistoryFixture()
  const childPath = childItem.images[0].path
  const clearCalls = []
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  try {
    const tree = await client.mountRaw(client.components.Filmstrip, {
      t: client.internals.i18n.fallbackTranslate('zh'),
      ui: { setView: () => {}, setPanelMode: () => {} },
      compute: {
        pendingJobs: [],
        sessionState: 'ready',
        startSession: () => {},
        status: { stopped: false },
        cancellingIds: [],
      },
      library: {
        items: [childItem, rootItem],
        selected: null,
        selectImage: () => {},
        workDrafts: {
          [childPath]: {
            tool: 'inpaint',
            prompt: '改成夜景',
            strength: 0.8,
            strengthAuto: false,
            presetId: 'sdxl-lightning',
            mask: null,
            changed: { mask: false, prompt: true, params: false },
            lastTouchedAt: NOW,
          },
        },
        clearWorkDraft: (path) => clearCalls.push(path),
      },
      actions: { previewWork: () => {} },
      now: NOW,
    })
    const dot = nodesByClass(tree, 'ofs-thumb-dot')[0]
    assert.ok(dot, '有未提交草稿的作品缩略图应亮圆点')
    assert.ok(String(dot.props.title || '').includes('提示词'), `圆点 title 应列出改动项：${dot.props.title}`)
    dot.props.onClick({ stopPropagation() {}, preventDefault() {} })
    assert.deepEqual(clearCalls.sort(), [childPath].sort(), '点缩略图圆点一键清空该树草稿')
    // 面板行内圆点与清空按钮也挂在草稿节点上。
    const anchor = nodesByClass(tree, 'ofs-version-anchor')[0]
    anchor.props.onMouseEnter()
    await client.advanceTimers(300)
    const opened = await client.rerenderRaw()
    const draftRows = nodesByClass(opened, 'ofs-version-row')
      .filter((node) => String(node.props && node.props.className).split(/\s+/).includes('has-draft'))
    assert.equal(draftRows.length, 1, '只有存有草稿的版本行亮圆点')
    const rowDot = nodesByClass(opened, 'ofs-version-draft-dot')
    assert.ok(rowDot.length >= 1, '草稿版本的版本行应显示圆点')
    const rowClear = nodesByClass(opened, 'ofs-version-draft-clear')[0]
    assert.ok(rowClear, '草稿版本行应提供清空按钮')
    rowClear.props.onClick()
    assert.ok(clearCalls.includes(childPath), '行内清空按钮同样调用 clearWorkDraft')
    // 缩略图本身仍是派生节点（childImage），确保测试数据没写错。
    const thumbImg = findNodes(nodesByClass(opened, 'ofs-thumb')[0], (node) => node.type === 'img')[0]
    assert.equal(thumbImg.props.src, childImage.url)
  } finally {
    client.unmount()
  }
})

await check('渲染：旧宿主没有 /history/tree 时版本面板降级提示', async () => {
  const { rootItem, childItem } = derivedHistoryFixture()
  const client = await createTestClient({
    now: NOW,
    responses: {
      '/imagen-api/state': readyState,
      // hasMore=true 才需要按需拉树；不给 /imagen-api/history/tree → 404 降级。
      '/imagen-api/history': { items: [childItem, rootItem], hasMore: true },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    nodesByClass(tree, 'ofs-version-anchor')[0].props.onMouseEnter()
    await client.advanceTimers(300)
    tree = await client.rerenderRaw()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.ok(client.requests.some((item) => item.path === '/imagen-api/history/tree'), '展开面板时应按需请求版本树接口')
    const panel = nodesByClass(tree, 'ofs-version-panel')[0]
    assert.ok(panel, '缺少版本面板')
    assert.ok(collectText(panel).join(' | ').includes('当前宿主不支持版本树'), '404 时应给「仅用已加载分页」的降级提示')
  } finally {
    client.unmount()
  }
})

await check('渲染：父作品被删后子版本提升为局部根不崩', async () => {
  const { childItem } = derivedHistoryFixture()
  const client = await createTestClient({ now: NOW, responses: studioResponses(readyState, { items: [childItem] }), testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    assert.equal(nodesByClass(tree, 'ofs-batch').length, 1, '父图未加载时子版本以局部根成卡')
    const card = nodesByClass(tree, 'ofs-batch')[0]
    assert.equal(card.props['data-root'], childItem.images[0].path, '局部根的 root 是子版本自己')
    assert.equal(nodesByClass(tree, 'ofs-version-badge').length, 0, '局部根没有派生角标')
    nodesByClass(tree, 'ofs-thumb')[0].props.onClick()
    tree = await client.rerenderRaw()
    assert.ok(collectText(tree).join(' | ').includes('派生作品提示词'), '局部根仍能正常展示')
  } finally {
    client.unmount()
  }
})

await check('渲染：显式新建绘图态——舞台取景框 + 作品条草稿卡', async () => {
  const { rootItem, childItem } = derivedHistoryFixture()
  const client = await createTestClient({
    now: NOW,
        responses: studioResponses({ ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' }, { items: [childItem, rootItem] }),
    testBuild: true,
  })
  try {
    // 0.13.0：打开工作台时默认进入新建创作态（舞台取景框 + 作品条草稿卡 + 灵感示例）。
    let tree = await client.mountRaw(client.components.Studio, {})
    assertStructure('initial-new-draft-stage', tree, {
      required: { 'ofs-stage--draft': 1, 'ofs-figure--draft': 1, 'ofs-draft-backdrop': 1, 'ofs-frame--draft': 1, 'ofs-draft-card': 1, 'ofs-draft-viewfinder': 1, 'ofs-draft-state': 1, 'ofs-head-new': 1 },
      forbidden: ['ofs-image', 'ofs-figure--empty'],
    })
    assert.equal(nodesByClass(tree, 'ofs-tuning').length, 0, '新建态不占用微调来源空白行')
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('一张还没生成的新画布'), '舞台应说明这是尚未生成的新画布')
    assert.ok(text.includes('正在配置新画布'), '作品条草稿卡应显示未提交态')
    const thumbs = nodesByClass(tree, 'ofs-thumb')
    assert.equal(thumbs.length, 1, '作品树仍然保留')
    assert.equal(thumbs.filter((node) => String(node.props.className).split(/\s+/).includes('is-on')).length, 0, '新建态没有选中作品')
    // 点击底部作品卡切回作品预览态：新建草稿卡仍常驻胶卷最左端（取消激活态），舞台显示作品。
    thumbs[0].props.onClick()
    tree = await client.rerenderRaw()
    const cardAfterSwitch = nodesByClass(tree, 'ofs-draft-card')[0]
    assert.ok(cardAfterSwitch, '切到其它作品时新建画布卡应保持常驻不消失')
    assert.equal(cardAfterSwitch.props['aria-pressed'], false, 'work 态下新建画布卡取消高亮')
    assert.equal(nodesByClass(tree, 'ofs-image').length, 1, '选作品后舞台显示图片')
    // 点常驻草稿卡切回新建画布（同时保留未提交表单态）；点顶栏「新建创作」也能回新建态。
    cardAfterSwitch.props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-draft-card')[0].props['aria-pressed'], true, '点草稿卡回到新建态并重新高亮')
    assert.equal(nodesByClass(tree, 'ofs-stage--draft').length, 1, '点草稿卡后回到新建取景框')
    thumbs[0].props.onClick()
    tree = await client.rerenderRaw()
    buttonByText(tree, '新建创作').props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-draft-card').length, 1, '点新建创作后草稿卡仍保留')
    assert.equal(nodesByClass(tree, 'ofs-stage--draft').length, 1, '点新建创作后回到新建取景框')
  } finally {
    client.unmount()
  }
})

await check('渲染：新建绘图提交后等任务完成再切回作品并选中新图', async () => {
  const { rootItem } = derivedHistoryFixture()
  const newPath = 'imagen-output/20261109-123000-job-new/01.png'
  const responses = {
    '/imagen-api/state': { ...readyState, presets: [toolPreset], defaultPreset: 'sdxl-lightning' },
    '/imagen-api/history': { items: [rootItem] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    '/imagen-api/generate': { id: 'job-new', status: 'queued' },
  }
  const { client, latest } = await mountToolStudio(responses)
  try {
    latest.studio.actions.newDraft()
    await client.rerenderRaw()
    assert.equal(latest.studio.library.workspaceMode, 'new_draft')
    assert.equal(latest.studio.library.selected, null, '新建态没有选中作品')
    assert.equal(latest.studio.library.newDraftCard.active, true)
    latest.studio.form.patchForm({ prompt: '新画布' })
    await client.rerenderRaw()
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(latest.studio.library.workspaceMode, 'new_draft', '提交后保持新建态等待出图')
    assert.equal(latest.studio.library.newDraftPending, true)
    // 宿主任务完成：更新快照与历史，推进一次轮询。
    const newImage = {
      path: newPath,
      file: '01.png',
      url: '/imagen-api/file?path=new-01',
      width: 1024,
      height: 1024,
      seed: 9,
      seconds: 6.2,
    }
    const newItem = {
      jobId: 'job-new',
      dir: 'imagen-output/20261109-123000-job-new',
      prompt: '新画布',
      presetId: 'sdxl-lightning',
      finishedAt: at(-1),
      images: [newImage],
    }
    responses['/imagen-api/state'] = {
      ...readyState,
      presets: [toolPreset],
      defaultPreset: 'sdxl-lightning',
      lastJob: { id: 'job-new', status: 'done', output: { images: [newImage] } },
    }
    responses['/imagen-api/history'] = { items: [newItem, rootItem] }
    await client.advanceTimers(10100)
    await client.settle()
    await client.rerenderRaw()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(latest.studio.library.workspaceMode, 'work', '任务完成后应切回作品态')
    assert.ok(latest.studio.library.selected, '完成后应选中新图')
    assert.equal(latest.studio.library.selected.image.path, newPath, '自动选中该任务的第一张产物')
    assert.equal(latest.studio.library.newDraftPending, false)
  } finally {
    client.unmount()
  }
})

summary()
