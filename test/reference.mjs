/**
 * 左栏原生参考图槽测试（阶段十五 Phase C2，不需要浏览器）。
 *
 * 覆盖三层：
 *  1. 纯逻辑（`src/logic/reference.js` + generate/form 的接口）：槽位增删 / 去重 / 上限 /
 *     路径归一 / 能力门控 / 请求体 `references` 拼装 / dirty 指纹 / 新建创作与删除作品清理 /
 *     重试恢复来源 / 文件预检（4 MiB）；
 *  2. 左栏渲染（`Rail` + `ReferenceSection`）：空态、有图态、移除、满额、从作品选择、
 *     不支持模型时的提示与两个动作、支持参考时整块隐藏的边界；
 *  3. 组合层接线（`useStudio`）：拖入参考槽走 `/import` 后入槽且不跳舞台焦点、
 *     动作坞「设为参考图」自动切到支持参考的模型、不支持时点生成被拦下（不发请求）、
 *     主表单与助手确认卡都自动带 references、新建创作 / 回填 / 还原原图的清理语义。
 *
 * 运行：node test/reference.mjs
 */

import assert from 'node:assert/strict'

import {
  buildGenerateBody,
  generateCapabilityOf,
  rerollOverrides,
  retryOverrides,
} from '../src/logic/generate.js'
import { formSnapshotOf, isFormDirty, newCreationPatch } from '../src/logic/form.js'
import {
  nativeReferencePresetOf,
  referenceAdd,
  referenceCapabilityOf,
  referenceFileErrorOf,
  referenceHas,
  referenceLimits,
  referenceListOf,
  referencePathsOf,
  referencePurgeOf,
  referenceRemove,
  supportsReferenceOf,
} from '../src/logic/reference.js'
import { createCheckRunner } from './helpers/check.mjs'
import {
  buttonByText,
  collectText,
  countByClass,
  createTestClient,
  findNodes,
  nodesByClass,
} from './helpers/render.mjs'
import {
  NOW, at, historyItem, image, preset, readyState, studioResponses,
} from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

/** 首期唯一支持原生参考生图的模型（与 supportsImg2Img 互斥，来自 models 资产）。 */
const klein = {
  ...preset,
  id: 'flux2-klein-4b',
  label: 'FLUX.2 Klein 4B',
  short: 'Klein 4B',
  size: 1024,
  steps: 4,
  cfg: 1,
  supportsImg2Img: false,
  supportsReference: true,
  supportsNegative: false,
  negativeHint: '',
}
const kleinState = {
  ...readyState,
  defaultPreset: klein.id,
  presets: [klein],
}
/** 支持 + 不支持两套预设并存：动作坞「设为参考图」自动换模型用。 */
const mixedState = {
  ...readyState,
  defaultPreset: 'sdxl-lightning',
  presets: [preset, klein],
}

const REF_A = 'imagen-output/20261109-120000-job-1/01.png'
const REF_B = 'imagen-output/20261109-120000-job-2/02.png'
const REF_C = 'imagen-output/20261109-120000-job-3/03.png'

const refItem = (path, name) => ({
  path,
  url: `/imagen-api/file?path=${encodeURIComponent(path)}`,
  width: 1024,
  height: 1024,
  name: name || path.split('/').pop(),
})

/** 最小 PNG（只写签名与 IHDR，够客户端魔数与宽高预检）。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
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

/** 拖放 / 选择文件事件的最小替身。 */
function fakeDragEvent(files = []) {
  return {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: { types: ['Files'], files, dropEffect: '' },
  }
}

// ── 1. 纯逻辑 ────────────────────────────────────────────────────────────────

await check('参考图纯逻辑：槽位增删 / 去重 / 上限 / 路径归一', () => {
  assert.deepEqual(referenceListOf(null), [])
  assert.deepEqual(referenceListOf(undefined), [])

  const added = referenceAdd([], REF_A)
  assert.equal(added.ok, true)
  assert.equal(added.reason, 'added')
  assert.equal(added.item.path, REF_A)
  assert.equal(added.item.name, '01.png')
  assert.equal(added.item.url, `/imagen-api/file?path=${encodeURIComponent(REF_A)}`)
  let slot = added.list

  // 同一张图重复挂载只提示，不产生第二份。
  assert.equal(referenceAdd(slot, REF_A).reason, 'duplicate')
  assert.deepEqual(referenceAdd(slot, REF_A).list.map((item) => item.path), [REF_A])

  // 作品条目 / 槽位项 / 路径三种来源都归一成同一种形状。
  slot = referenceAdd(slot, { image: { path: REF_B, url: '/custom.png', width: 512, height: 768, file: '02.png' } }).list
  assert.equal(slot.length, 2)
  assert.equal(slot[1].url, '/custom.png')
  assert.equal(slot[1].width, 512)
  assert.equal(slot[1].height, 768)
  assert.equal(slot[1].name, '02.png')

  // 契约上限（2 张）：第三张被拒。
  assert.equal(referenceAdd(slot, REF_C).reason, 'full')
  const maxCount = referenceLimits().maxCount
  assert.deepEqual(referencePathsOf([REF_A, REF_A, REF_B, REF_C]), [REF_A, REF_B], '去重后再按上限裁剪')

  // 非法路径：绝对路径 / 盘符 / 上级目录 / 别的根目录 / 空值一律拒绝。
  for (const bad of ['/abs/01.png', 'C:\\Users\\x\\01.png', 'imagen-output/../x.png', 'tmp/01.png', '', null]) {
    assert.equal(referenceAdd([], bad).reason, 'invalid', `应拒绝非法参考图路径：${bad}`)
  }

  // 移除 / 命中判定 / 删除作品后的级联清理。
  assert.deepEqual(referenceRemove(slot, REF_A).map((item) => item.path), [REF_B])
  assert.deepEqual(referenceRemove(slot, REF_C).map((item) => item.path), [REF_A, REF_B], '不在槽位里的路径不影响结果')
  assert.equal(referenceHas(slot, REF_B), true)
  assert.equal(referenceHas(slot, REF_C), false)
  assert.deepEqual(referencePurgeOf(slot, [REF_A, 'imagen-output/other/9.png']).map((item) => item.path), [REF_B])
  assert.equal(maxCount, 2, '契约参考图张数上限')
})

await check('参考图纯逻辑：能力位与切换目标（缺字段按 false）', () => {
  assert.equal(supportsReferenceOf(null), false)
  assert.equal(supportsReferenceOf({ id: 'sdxl-lightning' }), false, '旧宿主缺字段一律按不支持')
  assert.equal(supportsReferenceOf({ id: 'x', supportsReference: 'yes' }), false, '非布尔不算支持')
  assert.equal(supportsReferenceOf(klein), true)

  assert.equal(nativeReferencePresetOf([preset, klein]), klein, '切换目标是第一个支持参考的预设')
  assert.equal(nativeReferencePresetOf([preset]), null)
  assert.equal(nativeReferencePresetOf(null), null)

  const blocked = referenceCapabilityOf(preset, [REF_A])
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blockedKey, 'studio.reference.blockedUnsupported')
  assert.deepEqual(blocked.paths, [REF_A], '拦下时仍带回路径，供界面说明保留了什么')
  assert.equal(referenceCapabilityOf(klein, [REF_A]).ok, true)
  assert.equal(referenceCapabilityOf(preset, []).ok, true, '空槽不受能力位影响')
  assert.equal(referenceCapabilityOf(preset, null).ok, true)
})

await check('参考图请求体：references 路径数组 / 裁剪 / 与单图 reference 互斥', () => {
  const base = {
    prompt: 'a cat',
    negative: '',
    negativeLayers: { model: '', user: '' },
    presetId: klein.id,
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 1,
    seed: '',
    count: 1,
    references: [],
  }
  // 空槽：请求体与纯文生图逐字一致（不出现 references / reference）。
  const plain = buildGenerateBody(base)
  assert.equal('references' in plain, false)
  assert.equal('reference' in plain, false)

  const body = buildGenerateBody({ ...base, references: [REF_A, REF_B] })
  assert.deepEqual(body.references, [REF_A, REF_B])
  assert.equal('reference' in body, false, '原生参考不夹带单图 reference')

  // 覆盖上限：多给的路径按契约裁剪。
  const many = [REF_A, REF_B, REF_C, 'imagen-output/job-4/04.png']
  assert.equal(buildGenerateBody({ ...base, references: many }).references.length, referenceLimits().maxCount)

  // 槽位项（含 url / 宽高）同样只输出 path。
  const fromItems = buildGenerateBody({ ...base, references: [refItem(REF_A), refItem(REF_B)] })
  assert.deepEqual(fromItems.references, [REF_A, REF_B])

  // 与单图 reference 同时给出：以原生参考为准，两种图片条件不混进一个请求。
  const mixed = buildGenerateBody({ ...base, references: [REF_A], reference: { path: REF_A, strength: 0.6 } })
  assert.deepEqual(mixed.references, [REF_A])
  assert.equal('reference' in mixed, false)

  // 覆盖项（重试 / 变体）里的 references 优先，且不会被当成普通字段原样展开。
  const override = buildGenerateBody(base, { overrides: { prompt: 'b', references: [{ path: REF_B }] } })
  assert.deepEqual(override.references, [REF_B])
})

await check('参考图能力预检：不支持时拦下，不静默换模型 / 不丢图', () => {
  const sdxl = { ...preset, supportsImg2Img: true }
  const blocked = generateCapabilityOf({ preset: sdxl, presets: [sdxl, klein], references: [REF_A] })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'reference')
  assert.equal(blocked.blockedKey, 'studio.reference.blockedUnsupported')
  assert.equal(blocked.preset, null, '有参考图时不自动换模型')

  const ok = generateCapabilityOf({ preset: klein, presets: [sdxl, klein], references: [REF_A] })
  assert.equal(ok.ok, true)
  assert.equal(ok.preset, null, '支持参考时沿用当前预设')

  // 专用局部重绘预设 + 参考图：同样拦下（不能静默退回文生图丢掉参考图）。
  const inpaintOnly = { ...preset, id: 'sdxl-inpaint', inpaintOnly: true }
  const blockedInpaint = generateCapabilityOf({ preset: inpaintOnly, presets: [inpaintOnly, sdxl], references: [REF_A] })
  assert.equal(blockedInpaint.ok, false)
  assert.equal(blockedInpaint.reason, 'reference')

  // 没有参考图时既有兜底行为不变。
  const fallback = generateCapabilityOf({ preset: inpaintOnly, presets: [inpaintOnly, sdxl] })
  assert.equal(fallback.ok, true)
  assert.equal(fallback.preset.id, sdxl.id)
  assert.equal(fallback.notice.key, 'studio.form.autoText2Image')

  // 启动瞬间预设列表还没下发：不做判断，交给宿主。
  assert.equal(generateCapabilityOf({ preset: sdxl, presets: [], references: [REF_A] }).ok, true)
})

await check('参考图脏指纹与清理：新建创作清空 / 删除作品摘除 / 重试恢复来源', () => {
  const baseForm = {
    prompt: '',
    negative: '',
    negativeLayers: { model: '', user: '' },
    presetId: klein.id,
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 1,
    seed: '',
    count: 1,
    references: [],
  }
  const baseline = formSnapshotOf(baseForm)
  assert.equal(isFormDirty(baseForm, baseline), false)
  assert.equal(isFormDirty({ ...baseForm, references: [refItem(REF_A)] }, baseline), true, '挂载参考图算脏')
  assert.equal(isFormDirty({ ...baseForm, references: [refItem(REF_A)] }, formSnapshotOf({ ...baseForm, references: [REF_A] })), false)

  assert.deepEqual(newCreationPatch({ ...baseForm, references: [refItem(REF_A)] }, klein).references, [])

  const retry = retryOverrides({ params: { prompt: 'p', referenceSources: [REF_A, REF_B] } })
  assert.deepEqual(retry.references, [REF_A, REF_B], '失败任务按 referenceSources 恢复参考图')
  const retryFromBody = retryOverrides({ prompt: 'p', references: [REF_B] })
  assert.deepEqual(retryFromBody.references, [REF_B], '没有任务参数时退回上一次提交体')
  assert.equal('references' in retryOverrides({ params: { prompt: 'p' } }), false, '纯文生图重试不写 references')
  assert.equal(retryOverrides({ params: { prompt: '' } }), null)

  const refEntry = {
    image: { path: 'imagen-output/job-r/01.png', width: 1024, height: 1024, seed: 42 },
    item: { prompt: '主角新场景', presetId: klein.id, referenceSources: [REF_A, REF_B], images: [] },
  }
  const refReroll = rerollOverrides(refEntry, [preset, klein])
  assert.deepEqual(refReroll.references, [REF_A, REF_B], '参考生图作品重新生成保留自身 referenceSources')

  const plainEntry = {
    image: { path: 'imagen-output/job-p/01.png', width: 1024, height: 1024, seed: 7 },
    item: { prompt: '纯文生图', presetId: preset.id, images: [] },
  }
  const plainReroll = rerollOverrides(plainEntry, [preset, klein])
  assert.deepEqual(plainReroll.references, [], '纯文生图重新生成显式清空 references 避免串入左栏槽位')
  const rerollBody = buildGenerateBody({ ...baseForm, references: [refItem(REF_A)] }, { overrides: plainReroll })
  assert.equal('references' in rerollBody, false, '左栏挂着参考图时重绘普通作品不得带出左栏参考图')
  assert.equal(generateCapabilityOf({ preset, presets: [preset, klein], references: plainReroll.references }).ok, true)
})

await check('参考图文件预检：4 MiB 上限与类型', () => {
  const limit = referenceLimits().maxBytes
  const mib = Math.round(limit / 1024 / 1024)
  assert.equal(referenceFileErrorOf({ name: 'a.png', type: 'image/png', size: limit }), null, '恰好到上限放行')
  const tooLarge = referenceFileErrorOf({ name: 'a.png', type: 'image/png', size: limit + 1 })
  assert.equal(tooLarge.key, 'studio.reference.tooLarge')
  assert.deepEqual(tooLarge.params, { size: mib })
  assert.equal(referenceFileErrorOf({ name: 'a.txt', type: 'text/plain', size: 10 }).key, 'studio.import.invalidType')
  assert.equal(referenceFileErrorOf(null).key, 'studio.import.invalidType')
  // 参考图上限比导入上限更紧：8 MiB 内但超过 4 MiB 的图也要先挡掉。
  assert.equal(referenceFileErrorOf({ name: 'big.png', type: 'image/png', size: 6 * 1024 * 1024 }).key, 'studio.reference.tooLarge')
})

// ── 2. 左栏渲染（Rail + ReferenceSection） ───────────────────────────────────

/** Rail 的最小假域对象：只补齐 Rail 与 ReferenceSection 真正读到的字段。 */
function railHarness(t, options = {}) {
  const calls = { add: [], remove: [], switched: 0, img2img: 0, uploaded: [] }
  const fields = {
    prompt: '',
    negative: '',
    negativeLayers: { model: '', user: '' },
    presetId: options.activePreset ? options.activePreset.id : 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
    references: [],
    ...(options.form || {}),
  }
  const formDomain = {
    form: fields,
    patchForm: () => {},
    selectPreset: () => {},
    buildBody: () => ({}),
    ratioId: '1:1',
    activePreset: options.activePreset || preset,
    applyRatio: () => {},
    applyCustomSize: () => {},
    applyCfg: () => {},
    resetSeed: () => {},
    negativeActive: false,
    negativeHint: '',
    refineGroups: [],
    refineSource: '',
    enhancing: false,
    enhance: () => {},
    translating: false,
    translate: () => {},
    toggleRefine: () => {},
    englishPromptHint: false,
    tuning: null,
    newCreation: () => {},
    draftView: { active: false },
    referenceSupported: options.referenceSupported === true,
    referenceSwitchLabel: options.referenceSwitchLabel || '',
    referenceMax: options.referenceMax || referenceLimits().maxCount,
  }
  const actions = {
    sending: false,
    generate: () => {},
    restoreOriginal: () => {},
    addReference: (entry) => {
      calls.add.push(entry)
      return true
    },
    removeReference: (path) => {
      calls.remove.push(path)
      return []
    },
    switchToReferencePreset: () => {
      calls.switched += 1
      return true
    },
    referenceToImg2img: () => {
      calls.img2img += 1
      return true
    },
    uploadReferenceFiles: (files) => {
      calls.uploaded.push(files)
      return files.length
    },
    referenceUploading: false,
  }
  return {
    props: {
      t,
      ui: {
        advancedOpen: false,
        toggleAdvancedOpen: () => {},
        setAdvancedOpen: () => {},
        negativeOpen: false,
        setNegativeOpen: () => {},
        panelMode: 'form',
        setPanelMode: () => {},
      },
      form: formDomain,
      actions,
      library: { gallery: options.gallery || [] },
    },
    calls,
  }
}

await check('渲染：参考图槽空态入口与「不支持且空槽时整块隐藏」', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  try {
    // 支持参考的模型：空态给「添加参考图（最多 N 张）」入口与拖入 / 选择提示。
    let tree = await client.mountRaw(client.components.Rail, railHarness(t, {
      referenceSupported: true,
      activePreset: klein,
    }).props)
    assert.equal(nodesByClass(tree, 'ofs-ref-zone').length, 1, '支持参考的模型应出现参考图小节')
    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('参考图'), '应有参考图分区')
    assert.ok(text.includes(`添加参考图（最多 ${referenceLimits().maxCount} 张）`), `应有空态入口，实际：${text}`)
    assert.ok(text.includes('从电脑选择、拖入'), '空态应提示拖入 / 选择')
    assert.equal(nodesByClass(tree, 'ofs-ref-add').length, 1)
    // 隐藏的 file input：accept 只放 PNG / JPEG，可多选。
    const inputs = findNodes(tree, (node) => node.type === 'input' && node.props.type === 'file')
    assert.equal(inputs.length, 1)
    assert.equal(inputs[0].props.accept, 'image/png,image/jpeg')
    assert.equal(inputs[0].props.multiple, true)

    // 不支持参考且空槽：整块隐藏，不占左栏空间。
    tree = await client.mountRaw(client.components.Rail, railHarness(t, {
      referenceSupported: false,
      activePreset: preset,
    }).props)
    assert.equal(nodesByClass(tree, 'ofs-ref-zone').length, 0, '不支持参考的模型不显示小节')
    assert.ok(!collectText(tree).join(' | ').includes('添加参考图'), '隐藏时不留空态入口')
  } finally {
    client.unmount()
  }
})

await check('渲染：参考图槽有图态、移除、满额与从作品选择', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  try {
    const gallery = [{ image: { path: REF_C, url: '/img-c.png', width: 512, height: 512 }, item: { prompt: '可加入的作品' } }]
    // 1 张：缩略图 + 移除 + 追加入口 + 从作品选择。
    let harness = railHarness(t, {
      referenceSupported: true,
      activePreset: klein,
      form: { references: [refItem(REF_A)] },
      gallery,
    })
    let tree = await client.mountRaw(client.components.Rail, harness.props)
    assert.equal(nodesByClass(tree, 'ofs-ref-item').length, 1)
    assert.equal(nodesByClass(tree, 'ofs-ref-thumb').length, 1)
    assert.equal(nodesByClass(tree, 'ofs-ref-thumb')[0].props.src, refItem(REF_A).url, '缩略图用槽位 url')
    assert.equal(nodesByClass(tree, 'ofs-ref-remove').length, 1, '单张可移除')
    assert.equal(nodesByClass(tree, 'ofs-ref-remove')[0].props['aria-label'], '移除参考图', '移除按钮可读且可键盘操作')
    nodesByClass(tree, 'ofs-ref-remove')[0].props.onClick()
    assert.deepEqual(harness.calls.remove, [REF_A])

    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('添加参考图（1/2）'), `未满额时给追加入口，实际：${text}`)
    assert.ok(text.includes('参考图是弱条件'), '支持参考时说明参考图是弱条件（不宣称强一致）')

    // 从作品选择：复用已加载作品列表，点一张即入槽。
    buttonByText(tree, '从作品选择').props.onClick()
    tree = await client.rerenderRaw()
    const works = nodesByClass(tree, 'ofs-ref-work')
    assert.equal(works.length, 1, '从作品选择列出可加入的作品')
    works[0].props.onClick()
    assert.deepEqual(harness.calls.add.map((entry) => entry.image.path), [REF_C])

    // 满额：不再给添加入口，改给满额说明。
    harness = railHarness(t, {
      referenceSupported: true,
      activePreset: klein,
      form: { references: [refItem(REF_A), refItem(REF_B)] },
    })
    tree = await client.mountRaw(client.components.Rail, harness.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('参考图已满 2 张'), `满额应有说明，实际：${text}`)
    assert.equal(nodesByClass(tree, 'ofs-ref-add').length + nodesByClass(tree, 'ofs-ref-more').length, 0, '满额后不再有添加按钮')
    // 已加入的图不再出现在「从作品选择」里。
    harness = railHarness(t, {
      referenceSupported: true,
      activePreset: klein,
      form: { references: [refItem(REF_A)] },
      gallery: [{ image: { path: REF_A, url: '/a.png' }, item: {} }],
    })
    tree = await client.mountRaw(client.components.Rail, harness.props)
    buttonByText(tree, '从作品选择').props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-ref-work').length, 0, '已在槽位里的作品不重复列出')
    assert.ok(collectText(tree).join(' | ').includes('还没有可加入的作品'))
  } finally {
    client.unmount()
  }
})

await check('渲染：槽位非空但模型不支持 → 提示 + 切模型 / 改用整图重绘', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  try {
    const harness = railHarness(t, {
      referenceSupported: false,
      activePreset: preset,
      referenceSwitchLabel: 'FLUX.2 Klein 4B',
      form: { references: [refItem(REF_A)] },
    })
    const tree = await client.mountRaw(client.components.Rail, harness.props)
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('当前模型不支持原生参考生图'), `应有能力提示，实际：${text}`)
    assert.ok(text.includes('切换到 FLUX.2 Klein 4B'), '应给一键切换模型入口')
    assert.ok(text.includes('改用整图重绘'), '应给整图重绘降级入口')
    assert.equal(nodesByClass(tree, 'ofs-ref-warn').length, 1)
    assert.equal(nodesByClass(tree, 'ofs-ref-thumb').length, 1, '不支持时参考图仍保留在槽位里')

    buttonByText(tree, '切换到 FLUX.2 Klein 4B').props.onClick()
    assert.equal(harness.calls.switched, 1, '切换按钮交给组合层换模型')
    buttonByText(tree, '改用整图重绘').props.onClick()
    assert.equal(harness.calls.img2img, 1, '整图重绘按钮交给组合层开工具')
  } finally {
    client.unmount()
  }
})

// ── 3. 组合层集成（useStudio / 整页 Studio） ─────────────────────────────────

/**
 * 挂载 useStudio 的最小 Harness：把领域对象挂在 latest.studio 上，
 * 与 check-client-draft.mjs 的端到端粘合用例同一套做法。
 */
async function mountStudioHarness(responses) {
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-reference-harness' }, String(studio.form.form.references.length))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    return { client, latest }
  } catch (error) {
    client.unmount()
    throw error
  }
}

await check('集成：拖入参考槽走 /import 后入槽，舞台焦点不跳', async () => {
  const savedReader = globalThis.FileReader
  const fileDataUrl = `data:image/png;base64,${pngBase64(320, 320)}`
  class FakeFileReader {
    constructor() {
      this.result = ''
      this.onload = null
      this.onerror = null
    }

    readAsDataURL() {
      this.result = fileDataUrl
      if (typeof this.onload === 'function') this.onload()
    }
  }
  globalThis.FileReader = FakeFileReader
  const importedImage = {
    path: 'imagen-output/20261118-000000-import-ref/01.png',
    file: '01.png',
    url: '/imagen-api/file?path=imagen-output%2F20261118-000000-import-ref%2F01.png',
    width: 320,
    height: 320,
    seed: null,
    seconds: null,
  }
  const importedItem = {
    jobId: 'job-import-ref',
    dir: 'imagen-output/20261118-000000-import-ref',
    prompt: '',
    presetId: 'import',
    source: 'import',
    finishedAt: at(-10),
    images: [importedImage],
  }
  const responses = studioResponses(
    kleinState,
    { items: [historyItem] },
    { '/imagen-api/import': { ok: true, entry: { image: importedImage, item: importedItem } } },
  )
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { workspaceMode: 'work' })
    assert.equal(nodesByClass(tree, 'ofs-print').length, 1, '挂载后舞台展示历史作品')
    // 支持参考的默认模型：左栏有参考图小节，拖入 PNG 走 /import。
    const zone = nodesByClass(tree, 'ofs-ref-zone')[0]
    assert.ok(zone, '默认模型支持参考时左栏应有参考图小节')
    zone.props.onDrop(fakeDragEvent([{ name: 'ref.png', type: 'image/png', size: 2048 }]))
    await client.settle()
    const imports = client.requests.filter((item) => item.path === '/imagen-api/import')
    assert.equal(imports.length, 1, '拖入参考槽应发起一次导入请求')
    assert.equal(imports[0].method, 'POST')
    assert.equal(imports[0].body.name, 'ref.png')
    assert.ok(imports[0].body.data.startsWith('data:image/png;base64,'), '请求体是归一后的 dataURL')

    await client.settle()
    tree = await client.rerenderRaw()
    const thumbs = nodesByClass(tree, 'ofs-ref-thumb')
    assert.equal(thumbs.length, 1, '导入成功后的作品路径进入参考槽')
    assert.equal(thumbs[0].props.src, importedImage.url)
    // 事件是冒泡到舞台导入层的：不能顺手把新导入图切成舞台焦点（右侧保持浏览中的作品）。
    assert.equal(nodesByClass(tree, 'ofs-print').length, 1, '舞台焦点没有被参考图导入抢走')
    assert.equal(client.requests.filter((item) => item.path === '/imagen-api/generate').length, 0, '入槽不触发生成')
  } finally {
    client.unmount()
    if (savedReader === undefined) delete globalThis.FileReader
    else globalThis.FileReader = savedReader
  }
})

await check('集成：动作坞「设为参考图」入槽并自动切到支持参考的模型', async () => {
  const client = await createTestClient({
    now: NOW,
    responses: studioResponses(mixedState, { items: [historyItem] }),
    testBuild: true,
  })
  try {
    let tree = await client.mountRaw(client.components.Studio, { workspaceMode: 'work' })
    // 默认 sdxl 不支持参考：左栏没有参考图小节。
    assert.equal(nodesByClass(tree, 'ofs-ref-zone').length, 0)
    const dock = nodesByClass(tree, 'ofs-dock')[0]
    const refButton = buttonByText(dock, '设为参考图')
    assert.ok(refButton, '动作坞创作复用组应有「设为参考图」')
    refButton.props.onClick()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-ref-item').length, 1, '当前作品进入参考槽')
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('已切换到 FLUX.2 Klein 4B，参考图保留'), `应提示自动换模型，实际：${text}`)
    // 换成支持参考的模型后，左栏参考图小节可见。
    assert.equal(nodesByClass(tree, 'ofs-ref-zone').length, 1)
    // 再点一次：重复入槽只提示，不产生第二张。
    buttonByText(nodesByClass(tree, 'ofs-dock')[0], '设为参考图').props.onClick()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.equal(nodesByClass(tree, 'ofs-ref-item').length, 1, '同一张图重复设为参考图不重复入槽')
    assert.ok(collectText(tree).join(' | ').includes('这张图已在参考图槽里'))
  } finally {
    client.unmount()
  }
})

await check('请求链路：不支持参考时点生成被拦下（toast、不发请求、不丢图）', async () => {
  const responses = studioResponses(readyState, { items: [historyItem] })
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const studio = () => latest.studio
    const added = studio().actions.addReference(historyItem.images[0])
    await client.rerenderRaw()
    assert.equal(added, true)
    assert.equal(studio().form.form.references.length, 1)
    assert.equal(studio().form.dirty, true, '挂载参考图算未提交修改')

    const result = await studio().actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(result, false, '不支持参考时生成返回失败')
    assert.equal(client.requests.filter((item) => item.path === '/imagen-api/generate').length, 0, '不发请求')
    assert.ok(
      String(studio().ui.toast && studio().ui.toast.text).includes('当前模型不支持原生参考生图'),
      '要有可读的拦截提示',
    )
    assert.equal(studio().form.form.references.length, 1, '被拦下时参考图仍在槽位里，不静默丢图')
  } finally {
    client.unmount()
  }
})

await check('请求链路：主表单与助手确认卡都自动带 references，提交后槽位保留', async () => {
  const responses = studioResponses(
    kleinState,
    { items: [historyItem] },
    { '/imagen-api/generate': { id: 'job-ref', status: 'queued' } },
  )
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const studio = () => latest.studio
    studio().actions.addReference(historyItem.images[0])
    await client.rerenderRaw()
    studio().form.patchForm({ prompt: '雨后的街景' })
    await client.rerenderRaw()
    const okForm = await studio().actions.generate()
    await client.settle()
    assert.equal(okForm, true)
    const first = client.requests.filter((item) => item.path === '/imagen-api/generate')[0]
    assert.ok(first, '主表单应提交生成请求')
    assert.deepEqual(first.body.references, ['imagen-output/job-1/7.png'], '主表单请求体带参考图路径')
    assert.equal('reference' in first.body, false, '不带单图 reference')
    assert.equal(studio().form.form.references.length, 1, '提交成功后参考槽保留（可连续生成）')

    // 助手确认卡「按此生成」走同一份 buildBody：同样带上当前参考槽。
    studio().actions.removeReference('imagen-output/job-1/7.png')
    studio().actions.addReference(historyItem.images[1])
    await client.rerenderRaw()
    await studio().chat.generateIntent({ prompt: 'assistant scene', count: 2 })
    await client.settle()
    const calls = client.requests.filter((item) => item.path === '/imagen-api/generate')
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].body.references, ['imagen-output/job-1/8.png'], '助手生成路径也自动带参考图')
    assert.equal(calls[1].body.count, 2, '确认卡张数照常生效')
  } finally {
    client.unmount()
  }
})

await check('状态流转：新建创作清空参考槽、回填先托管、草稿卡恢复、还原原图清空', async () => {
  const workA = {
    jobId: 'job-a',
    dir: 'imagen-output/20261109-120000-job-a',
    prompt: 'A 的荷花池塘',
    presetId: 'sdxl-lightning',
    finishedAt: at(-60),
    images: [{ ...image(11), path: 'imagen-output/job-a/11.png', file: '11.png' }],
  }
  const workB = {
    jobId: 'job-b',
    dir: 'imagen-output/20261109-110000-job-b',
    prompt: 'B 的山间晨雾',
    presetId: 'sdxl-lightning',
    finishedAt: at(-120),
    images: [{ ...image(12), path: 'imagen-output/job-b/12.png', file: '12.png' }],
  }
  const entryA = { image: workA.images[0], item: workA }
  const entryB = { image: workB.images[0], item: workB }
  const responses = studioResponses(
    mixedState,
    { items: [workA, workB] },
    { '/imagen-api/generate': { id: 'job-ref', status: 'queued' } },
  )
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const studio = () => latest.studio
    const form = () => studio().form
    studio().actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(studio().actions.addReference(workA.images[0]), true)
    await client.rerenderRaw()
    assert.equal(form().form.references.length, 1)

    // 新建创作：清空参考槽（模型与画幅保留）。
    studio().actions.newDraft()
    await client.rerenderRaw()
    assert.equal(form().form.references.length, 0, '新建创作清空参考槽')
    assert.equal(form().form.presetId, 'sdxl-lightning', '模型预设保留')

    // 回填作品：未提交的参考槽先托管进草稿，再清空当前槽位（展示该作品的干净基准）。
    studio().actions.previewWork(entryA)
    await client.rerenderRaw()
    studio().actions.addReference(workB.images[0])
    await client.rerenderRaw()
    assert.equal(form().dirty, true)
    studio().actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(form().form.references.length, 0, '回填作品时清空参考槽')
    assert.equal(form().draft && form().draft.form.references.length, 1, '未提交的参考槽进了草稿卡')
    assert.equal(form().form.prompt, 'A 的荷花池塘', '回填参数照常生效')

    // 点草稿卡：恢复草稿内容（参考槽跟着回来）。
    studio().actions.focusNewDraft()
    await client.rerenderRaw()
    assert.equal(form().form.references.length, 1, '草稿卡恢复参考槽')

    // 还原原图：放弃草稿，参考槽一并清空。
    const restored = studio().actions.restoreOriginal()
    await client.rerenderRaw()
    assert.equal(restored, true)
    assert.equal(form().form.references.length, 0, '还原原图清空参考槽')
    assert.equal(form().draft, null, '草稿被丢弃')
  } finally {
    client.unmount()
  }
})

await check('状态流转：删除作品时参考槽摘除对应路径', async () => {
  const workA = {
    jobId: 'job-a',
    dir: 'imagen-output/20261109-120000-job-a',
    prompt: 'A 的荷花池塘',
    presetId: 'sdxl-lightning',
    finishedAt: at(-60),
    images: [{ ...image(11), path: 'imagen-output/job-a/11.png', file: '11.png' }],
  }
  const workB = {
    jobId: 'job-b',
    dir: 'imagen-output/20261109-110000-job-b',
    prompt: 'B 的山间晨雾',
    presetId: 'sdxl-lightning',
    finishedAt: at(-120),
    images: [{ ...image(12), path: 'imagen-output/job-b/12.png', file: '12.png' }],
  }
  const responses = studioResponses(
    mixedState,
    { items: [workA, workB] },
    { '/imagen-api/library/delete': { ok: true, removed: [workB.images[0].path], failed: [] } },
  )
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const studio = () => latest.studio
    // 预览 A（删除的预览才会触发回退），槽位里挂 A + B。
    studio().actions.previewWork({ image: workA.images[0], item: workA })
    await client.rerenderRaw()
    studio().actions.addReference(workA.images[0])
    studio().actions.addReference(workB.images[0])
    await client.rerenderRaw()
    assert.equal(studio().form.form.references.length, 2)

    // 删掉非预览作品 B：只摘掉槽位里的 B，A 保留，舞台焦点不动。
    await studio().library.deleteImages([workB.images[0].path])
    await client.settle()
    await client.rerenderRaw()
    assert.deepEqual(
      studio().form.form.references.map((item) => item.path),
      [workA.images[0].path],
      '删除作品后参考槽摘掉对应路径',
    )
  } finally {
    client.unmount()
  }
})

await check('上传预检：超过参考图体积上限的文件不发导入请求', async () => {
  const responses = studioResponses(kleinState, { items: [] })
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const studio = () => latest.studio
    const limit = referenceLimits().maxBytes
    const added = await studio().actions.uploadReferenceFiles([
      { name: 'huge.png', type: 'image/png', size: limit + 1 },
    ])
    await client.settle()
    await client.rerenderRaw()
    assert.equal(added, 0, '超限文件不进入参考槽')
    assert.equal(client.requests.filter((item) => item.path === '/imagen-api/import').length, 0, '超限文件不发起导入')
    assert.ok(String(studio().ui.toast && studio().ui.toast.text).includes('参考图超过'), '要有明确的体积提示')
  } finally {
    client.unmount()
  }
})



await check('集成：图片工具编辑态下左栏参考槽仍可挂载（文档 §2.2 场景 B）', async () => {
  const savedReader = globalThis.FileReader
  const fileDataUrl = `data:image/png;base64,${pngBase64(300, 300)}`
  class FakeFileReader {
    constructor() {
      this.result = ''
      this.onload = null
      this.onerror = null
    }

    readAsDataURL() {
      this.result = fileDataUrl
      if (typeof this.onload === 'function') this.onload()
    }
  }
  globalThis.FileReader = FakeFileReader
  const importedImage = {
    path: 'imagen-output/20261118-000000-import-ref2/01.png',
    file: '01.png',
    url: '/imagen-api/file?path=imagen-output%2F20261118-000000-import-ref2%2F01.png',
    width: 300,
    height: 300,
    seed: null,
    seconds: null,
  }
  // klein 支持参考但没有垫图能力；工具会自己选支持垫图 / 局部重绘的预设（不回写左栏）。
  const toolCapable = { ...preset, supportsImg2Img: true, supportsInpaint: true }
  const state = {
    ...readyState,
    defaultPreset: klein.id,
    presets: [klein, toolCapable],
  }
  const responses = studioResponses(
    state,
    { items: [historyItem] },
    { '/imagen-api/import': { ok: true, entry: { image: importedImage, item: null } } },
  )
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { workspaceMode: 'work' })
    // 进入局部涂抹编辑态（舞台锁定拖入），左栏参考槽仍然可用。
    buttonByText(nodesByClass(tree, 'ofs-dock')[0], '局部重绘').props.onClick()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.equal(countByClass(tree, 'ofs-mask-editor'), 1, '应进入局部涂抹编辑态')
    assert.equal(nodesByClass(tree, 'ofs-ref-zone').length, 1, '编辑态下左栏参考槽仍在')
    const zone = nodesByClass(tree, 'ofs-ref-zone')[0]
    zone.props.onDrop(fakeDragEvent([{ name: 'ref2.png', type: 'image/png', size: 2048 }]))
    await client.settle()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.equal(client.requests.filter((item) => item.path === '/imagen-api/import').length, 1, '编辑态下参考槽拖入照常导入')
    assert.equal(nodesByClass(tree, 'ofs-ref-thumb').length, 1, '导入结果进入参考槽')
  } finally {
    client.unmount()
    if (savedReader === undefined) delete globalThis.FileReader
    else globalThis.FileReader = savedReader
  }
})

summary()
