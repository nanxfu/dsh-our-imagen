/**
 * 本地图片导入客户端测试（阶段十五 Phase A3）。
 *
 * 前半段是纯逻辑（不挂载组件、不联网）：`src/logic/import.js` 的 MIME / 体积 /
 * 最小长边预校验、展示名清洗、编辑态拒绝、dataURL 归一与 PNG / JPEG 魔数解析；
 * 后半段用最小渲染替身挂载真实 Stage，验证集成接线：拖放层包裹、新画布「选择图片」、
 * 编辑态拖入被拒、派生作品「对比原图」开关与拉帘、导入成功后回调 activateImport。
 *
 * 运行：$env:OFS_TEST_BUNDLE=".tmp/phase-a/build/importui.js"; node test/import-client.mjs
 * （纯逻辑段直接 import 源码；渲染段用 OFS_TEST_BUNDLE 指定的测试 bundle。）
 */

import assert from 'node:assert/strict'

import { IMPORT, LIMITS } from '../shared/contract.js'
import {
  imageHeaderOf,
  importDragOf,
  importFileErrorOf,
  importMaxMiB,
  importMetaFoundOf,
  importMimeOf,
  importNameOf,
  importPrecheckOf,
  normalizeImportDataUrl,
} from '../src/logic/import.js'
import { createCheckRunner } from './helpers/check.mjs'
import { preset, probeOk, studioResponses } from './helpers/client-fixtures.mjs'
import { collectText, createTestClient, findNodes } from './helpers/render.mjs'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_BYTES = IMPORT.maxBytes
const NOW = Date.parse('2026-11-09T05:05:00.000Z')

/** 最小 PNG 头（签名 + IHDR 前 16 字节，不写 CRC）：足够读出宽高。 */
function pngBase64(width, height) {
  const buffer = Buffer.alloc(33)
  PNG_SIGNATURE.copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  buffer[24] = 8
  buffer[25] = 6
  return buffer.toString('base64')
}

/** 最小 JPEG 头：SOI + 可选 APP0 + SOF0（只写到宽高，够解析）。 */
function jpegBase64(width, height, options = {}) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ])
  sof[5] = (height >> 8) & 0xff
  sof[6] = height & 0xff
  sof[7] = (width >> 8) & 0xff
  sof[8] = width & 0xff
  const chunks = [Buffer.from([0xff, 0xd8])]
  if (options.app0) {
    // APP0：length=16（含长度字段本身），payload 14 字节。
    chunks.push(Buffer.from([0xff, 0xe0, 0x00, 0x10]))
    chunks.push(Buffer.from('JFIF\0\x01\x02\x00\x00\x01\x00\x01\x00\x00', 'latin1'))
  }
  if (!options.soiOnly) chunks.push(sof)
  chunks.push(Buffer.from([0xff, 0xd9]))
  return Buffer.concat(chunks).toString('base64')
}

function dataUrlOf(mime, base64) {
  return `data:${mime};base64,${base64}`
}

function fileOf(overrides = {}) {
  return { name: 'photo.png', type: 'image/png', size: 2048, ...overrides }
}

// ── Stage 集成测试的最小装置 ─────────────────────────────────────

const LINK_IMAGE = {
  path: 'imagen-output/job-1/7.png',
  file: '7.png',
  url: '/imagen-api/file?path=imagen-output%2Fjob-1%2F7.png',
  width: 1024,
  height: 1024,
  seed: 7,
  seconds: 6.2,
}
const DERIVED_IMAGE = {
  path: 'imagen-output/job-2/2a.png',
  file: '2a.png',
  url: '/imagen-api/file?path=imagen-output%2Fjob-2%2F2a.png',
  width: 1024,
  height: 1024,
  seed: null,
  seconds: null,
}
const DERIVED_ITEM = {
  jobId: 'job-2',
  prompt: '派生作品',
  sourceImage: LINK_IMAGE.path,
  images: [DERIVED_IMAGE],
}
const DERIVED_BEFORE_URL = `/imagen-api/file?path=${encodeURIComponent(LINK_IMAGE.path)}`

function classNameOf(node) {
  return String((node && node.props && node.props.className) || '')
}

/** 按 className 的单个 token 找宿主节点（与 check-client-shell 的类名锚点同口径）。 */
function nodesByClassToken(tree, token) {
  return findNodes(tree, (node) => classNameOf(node).split(/\s+/).includes(token))
}

function fakeDragEvent(files = []) {
  return {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: { types: ['Files'], files, dropEffect: '' },
  }
}

/** Stage 的最小假域对象：只提供 Stage 渲染与本次集成路径真正读到的字段。 */
function stageHarness(t, overrides = {}) {
  const toasts = []
  const calls = { compare: [], imported: [] }
  const base = {
    t,
    ui: {
      zoom: false,
      setZoom: () => {},
      copyPath: () => {},
      showToast: (text) => toasts.push(text),
      compareOpen: false,
      setCompareOpen: (next) => calls.compare.push(next),
    },
    compute: { activeJob: null, status: {}, presets: [] },
    form: { useInspiration: () => {}, form: { width: 1024, height: 1024, presetId: 'sdxl-lightning' } },
    library: {
      gallery: [],
      selected: null,
      workspaceMode: 'new_draft',
      newDraftCard: { explicit: true },
      isFavorite: () => false,
      toggleFavorite: () => {},
    },
    imageTool: null,
    actions: {
      reroll: () => {},
      openImageTool: () => {},
      activateImport: (entry) => calls.imported.push(entry),
    },
    now: NOW,
  }
  const props = {
    ...base,
    ...overrides,
    ui: { ...base.ui, ...(overrides.ui || {}) },
    library: { ...base.library, ...(overrides.library || {}) },
    actions: { ...base.actions, ...(overrides.actions || {}) },
  }
  return { props, toasts, calls }
}

function selectedDerived() {
  return { image: DERIVED_IMAGE, item: DERIVED_ITEM }
}

async function main() {
  const { check, summary } = createCheckRunner()

  await check('契约口径：IMPORT 边界与 MiB 文案读数一致', () => {
    assert.deepEqual([...IMPORT.mimeTypes], ['image/png', 'image/jpeg'])
    assert.equal(IMPORT.maxBytes, LIMITS.reference.maxBytes)
    assert.equal(IMPORT.minEdge, 128)
    assert.equal(importMaxMiB(), 8)
  })

  await check('importMimeOf：PNG / JPEG 归一，image/jpg 兼容，扩展名兜底', () => {
    assert.equal(importMimeOf({ type: 'image/png' }), 'image/png')
    assert.equal(importMimeOf({ type: 'image/jpeg' }), 'image/jpeg')
    assert.equal(importMimeOf({ type: 'image/jpg' }), 'image/jpeg')
    assert.equal(importMimeOf({ type: 'IMAGE/PNG' }), 'image/png')
    // 空 type：只能看扩展名。
    assert.equal(importMimeOf({ type: '', name: 'a.PNG' }), 'image/png')
    assert.equal(importMimeOf({ name: 'a.jpeg' }), 'image/jpeg')
    assert.equal(importMimeOf({ name: 'a.jpg' }), 'image/jpeg')
    // 不支持的格式。
    assert.equal(importMimeOf({ type: 'image/webp', name: 'a.webp' }), '')
    assert.equal(importMimeOf({ type: 'image/gif', name: 'a.png' }), '')
    assert.equal(importMimeOf(null), '')
    assert.equal(importMimeOf(undefined), '')
  })

  await check('importFileErrorOf：类型 → 体积，边界值不误杀', () => {
    assert.equal(importFileErrorOf(fileOf()), '')
    assert.equal(importFileErrorOf(fileOf({ type: 'image/webp' })), 'studio.import.invalidType')
    assert.equal(importFileErrorOf(fileOf({ type: undefined, name: 'photo.bmp' })), 'studio.import.invalidType')
    assert.equal(importFileErrorOf(fileOf({ size: MAX_BYTES })), '')
    assert.equal(importFileErrorOf(fileOf({ size: MAX_BYTES + 1 })), 'studio.import.tooLarge')
    // 拿不到 size 时不提前拦截，交给宿主兜底。
    assert.equal(importFileErrorOf(fileOf({ size: undefined })), '')
    assert.equal(importFileErrorOf(null), 'studio.import.invalidType')
  })

  await check('importNameOf：控制字符 / 路径分隔符清洗并按契约截断', () => {
    assert.equal(importNameOf({ name: '清晨的湖面.png' }), '清晨的湖面.png')
    assert.equal(importNameOf({ name: '  space.png  ' }), 'space.png')
    assert.equal(importNameOf({ name: 'bad\u0000\u001f\u007fname.png' }), 'badname.png')
    assert.equal(importNameOf({ name: 'dir\\sub/photo.png' }), 'dir sub photo.png')
    const long = 'a'.repeat(200) + '.png'
    assert.equal(importNameOf({ name: long }), 'a'.repeat(IMPORT.maxNameChars))
    assert.equal(importNameOf({ name: '' }), '')
    assert.equal(importNameOf({}), '')
    assert.equal(importNameOf(null), '')
  })

  await check('importDragOf：编辑态 / 批量选择态拒绝，其余放行', () => {
    assert.equal(importDragOf({}), 'stage')
    assert.equal(importDragOf(), 'stage')
    assert.equal(importDragOf({ editorOpen: false, selecting: false }), 'stage')
    assert.equal(importDragOf({ editorOpen: true }), 'blocked')
    assert.equal(importDragOf({ selecting: true }), 'blocked')
    assert.equal(importDragOf({ editorOpen: true, selecting: true }), 'blocked')
    // view 是签名预留，不参与判定（舞台只在 studio 视图挂载）。
    assert.equal(importDragOf({ view: 'gallery' }), 'stage')
  })

  await check('normalizeImportDataUrl：dataURL / 裸 base64 归一并补 base64 填充', () => {
    const png = pngBase64(200, 300)
    const parsed = normalizeImportDataUrl(dataUrlOf('image/png', png))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.mime, 'image/png')
    assert.equal(parsed.base64, png)
    assert.equal(parsed.dataUrl, dataUrlOf('image/png', png))

    // 空白 / 换行（复制粘贴来的 base64 常带换行）。
    const spaced = `${dataUrlOf('image/png', png.slice(0, 20))}\n${png.slice(20)}  `
    assert.equal(normalizeImportDataUrl(spaced).base64, png)

    // MIME 别名与大小写。
    assert.equal(normalizeImportDataUrl(dataUrlOf('image/jpg', png)).mime, 'image/jpeg')

    // 裸 base64：可用，但 MIME 未知（等魔数预检）。
    const bare = normalizeImportDataUrl(png)
    assert.equal(bare.ok, true)
    assert.equal(bare.mime, '')
    assert.equal(bare.dataUrl, '')

    // 不支持的 MIME / 非 base64 dataURL / 缺逗号 / 空串 / 非法字符。
    assert.equal(normalizeImportDataUrl(dataUrlOf('image/webp', png)).ok, false)
    assert.equal(normalizeImportDataUrl('data:image/png,hello').ok, false)
    assert.equal(normalizeImportDataUrl('data:image/png;base64').ok, false)
    assert.equal(normalizeImportDataUrl('').ok, false)
    assert.equal(normalizeImportDataUrl(null).ok, false)
    assert.equal(normalizeImportDataUrl('data:image/png;base64,a$$$b').ok, false)
    // 长度模 4 余 1 的 base64 不可能解码。
    assert.equal(normalizeImportDataUrl('A'.repeat(5)).ok, false)
  })

  await check('imageHeaderOf：PNG / JPEG 魔数与宽高解析', () => {
    assert.deepEqual(imageHeaderOf(pngBase64(200, 300)), { format: 'png', width: 200, height: 300 })

    // JPEG：SOI 之后先跳过 APP0 再找 SOF0。
    assert.deepEqual(imageHeaderOf(jpegBase64(640, 480)), { format: 'jpeg', width: 640, height: 480 })
    assert.deepEqual(
      imageHeaderOf(jpegBase64(1920, 1080, { app0: true })),
      { format: 'jpeg', width: 1920, height: 1080 },
    )

    // 只有签名（截断）时格式仍可判定，宽高给 0 交给宿主。
    assert.deepEqual(imageHeaderOf(PNG_SIGNATURE.toString('base64')), { format: 'png', width: 0, height: 0 })
    // 找不到 SOFn 的 JPEG 同理。
    const noSof = jpegBase64(0, 0, { soiOnly: true })
    assert.deepEqual(imageHeaderOf(noSof), { format: 'jpeg', width: 0, height: 0 })

    // 非图片 / 魔数不符。
    assert.equal(imageHeaderOf(Buffer.from('this is not an image').toString('base64')), null)
    const webp = Buffer.from('RIFFxxxxWEBPVP8 ', 'latin1').toString('base64')
    assert.equal(imageHeaderOf(webp), null)
  })

  await check('importPrecheckOf：合法 PNG / JPEG 通过并给出可提交 dataURL', () => {
    const png = pngBase64(1024, 768)
    const result = importPrecheckOf({ file: fileOf({ size: 4096 }), dataUrl: dataUrlOf('image/png', png) })
    assert.equal(result.ok, true)
    assert.equal(result.mime, 'image/png')
    assert.equal(result.width, 1024)
    assert.equal(result.height, 768)
    assert.equal(result.name, 'photo.png')
    assert.equal(result.dataUrl, dataUrlOf('image/png', png))

    const jpeg = jpegBase64(512, 512)
    const jpegResult = importPrecheckOf({ file: fileOf({ name: 'shot.jpg', type: 'image/jpeg' }), dataUrl: dataUrlOf('image/jpeg', jpeg) })
    assert.equal(jpegResult.ok, true)
    assert.equal(jpegResult.mime, 'image/jpeg')
    assert.equal(jpegResult.dataUrl, dataUrlOf('image/jpeg', jpeg))
  })

  await check('importPrecheckOf：MIME 按实际魔数纠正（声明 png 实为 jpeg）', () => {
    const jpeg = jpegBase64(300, 200)
    const result = importPrecheckOf({
      file: { name: 'mislabeled.png', type: 'image/png', size: 1024 },
      dataUrl: dataUrlOf('image/png', jpeg),
    })
    assert.equal(result.ok, true)
    assert.equal(result.mime, 'image/jpeg')
    assert.equal(result.dataUrl, dataUrlOf('image/jpeg', jpeg))
  })

  await check('importPrecheckOf：类型 / 体积 / 过小 / 魔数各分支', () => {
    const png = pngBase64(640, 480)

    const tooLarge = importPrecheckOf({ file: fileOf({ size: MAX_BYTES + 1 }), dataUrl: dataUrlOf('image/png', png) })
    assert.equal(tooLarge.ok, false)
    assert.equal(tooLarge.errorKey, 'studio.import.tooLarge')
    assert.deepEqual(tooLarge.params, { size: 8 })

    const badType = importPrecheckOf({ file: fileOf({ type: 'image/webp' }), dataUrl: dataUrlOf('image/webp', png) })
    assert.equal(badType.ok, false)
    assert.equal(badType.errorKey, 'studio.import.invalidType')

    const tooSmall = importPrecheckOf({ file: fileOf(), dataUrl: dataUrlOf('image/png', pngBase64(64, 300)) })
    assert.equal(tooSmall.ok, false)
    assert.equal(tooSmall.errorKey, 'studio.import.tooSmall')
    assert.deepEqual(tooSmall.params, { edge: IMPORT.minEdge })

    const notImage = importPrecheckOf({ file: fileOf(), dataUrl: dataUrlOf('image/png', Buffer.from('nope').toString('base64')) })
    assert.equal(notImage.ok, false)
    assert.equal(notImage.errorKey, 'studio.import.invalidType')

    const brokenDataUrl = importPrecheckOf({ file: fileOf(), dataUrl: 'not-a-data-url' })
    assert.equal(brokenDataUrl.ok, false)
    assert.equal(brokenDataUrl.errorKey, 'studio.import.invalidType')

    // 长边超过 maxEdge 不拦（宿主按参考图口径缩放，minEdge 才是拒绝条件）。
    const wide = importPrecheckOf({ file: fileOf(), dataUrl: dataUrlOf('image/png', pngBase64(4000, 3000)) })
    assert.equal(wide.ok, true)
  })

  await check('importPrecheckOf：没有 File 对象时仍可按 dataURL 预检（粘贴兜底）', () => {
    const png = pngBase64(300, 300)
    const result = importPrecheckOf({ dataUrl: dataUrlOf('image/png', png) })
    assert.equal(result.ok, true)
    assert.equal(result.mime, 'image/png')
    assert.equal(result.name, '')
  })

  await check('importMetaFoundOf：entry.generation 与旧 item.generation 都视为带元数据', () => {
    const generation = { prompt: 'p', presetId: 'sdxl-lightning', width: 1024, height: 1024 }
    assert.equal(importMetaFoundOf({ image: {}, item: {}, generation }), true)
    // 旧宿主把生成参数挂在历史条目上。
    assert.equal(importMetaFoundOf({ image: {}, item: { generation } }), true)
    assert.equal(importMetaFoundOf({ image: {}, item: {}, generation: null }), false)
    assert.equal(importMetaFoundOf({ image: {}, item: { generation: null } }), false)
    assert.equal(importMetaFoundOf({ image: {}, item: { generation: 'not-an-object' } }), false)
    assert.equal(importMetaFoundOf({ image: {}, item: {} }), false)
    assert.equal(importMetaFoundOf({}), false)
    assert.equal(importMetaFoundOf(null), false)
    assert.equal(importMetaFoundOf(undefined), false)
  })

  // ── 渲染集成：Stage 接线 ─────────────────────────────────────
  await check('Stage 集成：拖放层包裹舞台，新画布有「选择图片」入口（隐藏 input accept）', async () => {
    const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
    const t = client.internals.i18n.fallbackTranslate('zh')
    const { props } = stageHarness(t)
    try {
      const tree = await client.mountRaw(client.components.Stage, props)
      const zones = nodesByClassToken(tree, 'ofs-import-zone')
      assert.equal(zones.length, 1, 'Stage 应被 ImageDropzone 包裹一层')
      assert.equal(nodesByClassToken(tree, 'ofs-stage').length, 1, '真实舞台 section 应仍在包裹层内')
      const inputs = findNodes(tree, (node) => node.type === 'input' && node.props && node.props.type === 'file')
      assert.equal(inputs.length, 1, '应有一个隐藏文件选择框')
      assert.equal(inputs[0].props.accept, 'image/png,image/jpeg')
      const choose = nodesByClassToken(tree, 'ofs-import-choose')
      assert.equal(choose.length, 1, '新画布应浮出「选择图片」按钮')
      assert.ok(collectText(choose[0]).join('').includes('选择图片'))
    } finally {
      client.unmount()
    }
  })

  await check('Stage 集成：有作品时不显示选择图片入口', async () => {
    const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
    const t = client.internals.i18n.fallbackTranslate('zh')
    const { props } = stageHarness(t, {
      library: { selected: selectedDerived(), gallery: [selectedDerived()], workspaceMode: 'work', newDraftCard: {} },
    })
    try {
      const tree = await client.mountRaw(client.components.Stage, props)
      assert.equal(nodesByClassToken(tree, 'ofs-import-choose').length, 0, '作品分支不抢舞台空间')
      assert.equal(nodesByClassToken(tree, 'ofs-import-zone').length, 1, '作品分支也保留拖放层')
    } finally {
      client.unmount()
    }
  })

  await check('Stage 集成：编辑态拖入被拒绝并提示，不发起导入请求', async () => {
    const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
    const t = client.internals.i18n.fallbackTranslate('zh')
    const imageTool = {
      editorOpen: true,
      activeTool: { id: 'img2img', form: 'inline', labelKey: 'studio.chat.tool.img2img' },
      target: { path: LINK_IMAGE.path, url: LINK_IMAGE.url, prompt: '底图', width: 1024, height: 1024 },
      mask: null,
      coverage: 0,
    }
    const harness = stageHarness(t, { imageTool })
    try {
      let tree = await client.mountRaw(client.components.Stage, harness.props)
      assert.equal(nodesByClassToken(tree, 'ofs-inline-tool').length, 1, '编辑态本身应正常渲染')
      nodesByClassToken(tree, 'ofs-import-zone')[0].props.onDragEnter(fakeDragEvent())
      // rerenderRaw 保留事件回调（serializeTree 会把函数替换成 '[fn]'）。
      tree = await client.rerenderRaw()
      assert.ok(
        collectText(tree).join(' | ').includes('请先退出或暂存当前涂抹'),
        '编辑态拖入应显示拒绝提示',
      )
      const zone = nodesByClassToken(tree, 'ofs-import-zone')[0]
      zone.props.onDrop(fakeDragEvent([{ name: 'photo.png', type: 'image/png', size: 2048 }]))
      await client.settle()
      assert.ok(
        harness.toasts.some((text) => text.includes('请先退出或暂存当前涂抹')),
        '编辑态 drop 应走拒绝提示',
      )
      assert.equal(
        client.requests.filter((item) => item.path === '/imagen-api/import').length,
        0,
        '编辑态拒绝时不应发起导入请求',
      )
    } finally {
      client.unmount()
    }
  })

  await check('Stage 集成：派生作品出现「对比原图」开关并切换 ui.compareOpen', async () => {
    const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
    const t = client.internals.i18n.fallbackTranslate('zh')
    const harness = stageHarness(t, {
      library: { selected: selectedDerived(), gallery: [selectedDerived()], workspaceMode: 'work', newDraftCard: {} },
    })
    try {
      const tree = await client.mountRaw(client.components.Stage, harness.props)
      // 未打开对比时仍是可放大查看的相纸按钮。
      assert.equal(nodesByClassToken(tree, 'ofs-print').length, 1)
      assert.equal(nodesByClassToken(tree, 'ofs-compare').length, 0)
      const toggle = findNodes(
        tree,
        (node) => node.type === 'button' && node.props && node.props['aria-label'] === '对比原图',
      )[0]
      assert.ok(toggle, '带 sourceImage 的作品应有对比开关')
      assert.equal(toggle.props['aria-pressed'], false)
      toggle.props.onClick()
      assert.deepEqual(harness.calls.compare, [true], '点击开关应把 compareOpen 置为 true')
    } finally {
      client.unmount()
    }
  })

  await check('Stage 集成：compareOpen 时用 CompareSlider 替代相纸（ARIA + 原图/当前图）', async () => {
    const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
    const t = client.internals.i18n.fallbackTranslate('zh')
    const harness = stageHarness(t, {
      ui: { compareOpen: true },
      library: { selected: selectedDerived(), gallery: [selectedDerived()], workspaceMode: 'work', newDraftCard: {} },
    })
    try {
      const tree = await client.mountRaw(client.components.Stage, harness.props)
      assert.equal(nodesByClassToken(tree, 'ofs-print').length, 0, '对比打开时相纸按钮被拉帘替代')
      const sliders = findNodes(tree, (node) => node.props && node.props.role === 'slider')
      assert.equal(sliders.length, 1)
      assert.equal(sliders[0].props['aria-valuenow'], 50)
      assert.equal(sliders[0].props['aria-valuemin'], 0)
      assert.equal(sliders[0].props['aria-valuemax'], 100)
      const srcs = findNodes(tree, (node) => node.type === 'img').map((node) => node.props.src)
      assert.ok(srcs.includes(DERIVED_BEFORE_URL), '拉帘底层应是原图 URL')
      assert.ok(srcs.includes(DERIVED_IMAGE.url), '拉帘上层应是当前图 URL')
      const text = collectText(tree).join(' | ')
      assert.ok(text.includes('原图') && text.includes('当前'), '拉帘应有两侧标签')
      // 切图时关闭对比：模拟新的选中作品。
      const zone = nodesByClassToken(tree, 'ofs-import-zone')[0]
      assert.ok(zone, '对比分支同样在拖放层内')
    } finally {
      client.unmount()
    }
  })

  await check('Stage 集成：拖入合法 PNG 走 /import 并回调 activateImport', async () => {
    const FILE_DATA_URL = `data:image/png;base64,${pngBase64(300, 300)}`
    const savedReader = globalThis.FileReader
    let readResult = ''
    class FakeFileReader {
      constructor() {
        this.result = ''
        this.onload = null
        this.onerror = null
      }

      readAsDataURL() {
        this.result = readResult
        if (typeof this.onload === 'function') this.onload()
      }
    }
    globalThis.FileReader = FakeFileReader
    const entry = { image: DERIVED_IMAGE, item: DERIVED_ITEM, generation: { prompt: '恢复参数' } }
    const client = await createTestClient({
      now: NOW,
      responses: { '/imagen-api/import': { ok: true, entry } },
      testBuild: true,
    })
    try {
      const t = client.internals.i18n.fallbackTranslate('zh')
      readResult = FILE_DATA_URL
      const harness = stageHarness(t)
      const tree = await client.mountRaw(client.components.Stage, harness.props)
      const zone = nodesByClassToken(tree, 'ofs-import-zone')[0]
      zone.props.onDrop(fakeDragEvent([{ name: 'photo.png', type: 'image/png', size: 2048 }]))
      await client.settle()
      const imports = client.requests.filter((item) => item.path === '/imagen-api/import')
      assert.equal(imports.length, 1, '合法拖入应发起一次导入请求')
      assert.equal(imports[0].method, 'POST')
      assert.equal(imports[0].body.name, 'photo.png')
      assert.ok(
        imports[0].body.data.startsWith('data:image/png;base64,'),
        '请求体 data 应是归一后的 dataURL',
      )
      assert.equal(harness.calls.imported.length, 1, '成功后应回调 activateImport')
      assert.deepEqual(harness.calls.imported[0], entry)
    } finally {
      client.unmount()
      if (savedReader === undefined) delete globalThis.FileReader
      else globalThis.FileReader = savedReader
    }
  })

  await check('Studio 集成：useStudio 导出 activateImport，拖入后舞台切换至导入图并刷新历史', async () => {
    const FILE_DATA_URL = `data:image/png;base64,${pngBase64(320, 320)}`
    const savedReader = globalThis.FileReader
    class FakeFileReader {
      constructor() {
        this.result = ''
        this.onload = null
        this.onerror = null
      }

      readAsDataURL() {
        this.result = FILE_DATA_URL
        if (typeof this.onload === 'function') this.onload()
      }
    }
    globalThis.FileReader = FakeFileReader
    const importedImage = {
      path: 'imagen-output/20261118-000000-import-abc123/01.png',
      file: '01.png',
      url: '/imagen-api/file?path=imagen-output%2F20261118-000000-import-abc123%2F01.png',
      width: 320,
      height: 320,
      seed: null,
      seconds: null,
    }
    const importedItem = {
      jobId: 'import-20261118-000000-import-abc123',
      dir: 'imagen-output/20261118-000000-import-abc123',
      prompt: 'studio-photo.png',
      presetId: null,
      source: 'import',
      sourceImage: null,
      rootImage: null,
      finishedAt: new Date(NOW).toISOString(),
      images: [importedImage],
    }
    const responses = studioResponses(
      {
        defaultPreset: 'sdxl-lightning',
        presets: [{ ...preset, supportsImg2Img: true, supportsInpaint: true }],
        session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
        jobs: [],
        lastJob: null,
        probe: probeOk,
      },
      { items: [importedItem], hasMore: false },
      {
        '/imagen-api/import': { ok: true, entry: { image: importedImage, item: importedItem, generation: null } },
      },
    )
    const client = await createTestClient({ now: NOW, responses, testBuild: true })
    try {
      await client.mountRaw(client.components.Studio, {})
      await client.settle()
      const tree = await client.rerenderRaw()
      const beforeHistory = client.requests.filter((item) => item.path === '/imagen-api/history').length
      const zone = nodesByClassToken(tree, 'ofs-import-zone')[0]
      assert.ok(zone, 'Studio 工作台舞台应包裹在拖放层内')
      zone.props.onDrop(fakeDragEvent([{ name: 'studio-photo.png', type: 'image/png', size: 2048 }]))
      await client.settle()
      const updated = await client.rerenderRaw()
      const afterHistory = client.requests.filter((item) => item.path === '/imagen-api/history').length
      assert.ok(afterHistory > beforeHistory, '导入成功后应刷新历史')
      const stageImgs = findNodes(updated, (node) => node.type === 'img').map((node) => node.props.src)
      assert.ok(stageImgs.includes(importedImage.url), '导入成功后舞台应切到新导入的图片')
      const text = collectText(updated).join(' | ')
      assert.ok(text.includes('图片已导入'), '导入成功后应显示已导入提示')
    } finally {
      client.unmount()
      if (savedReader === undefined) delete globalThis.FileReader
      else globalThis.FileReader = savedReader
    }
  })

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
