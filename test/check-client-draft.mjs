/**
 * 左栏草稿托管渲染测试（阶段十五 Phase A1，不需要浏览器）。
 *
 * 覆盖 `.tmp/phase-a/INTERFACES.md` §6.1 的 1~7 条状态流转：
 *  1. 点胶片条作品 = 切预览 + 回填原始参数（不再被 dirty 拦截）；
 *  2. 回填后修改字段 → 草稿卡亮起「未提交草稿 / 源自此图」，左栏给草稿状态 + 还原原图，
 *     舞台保持展示来源作品（不闪成空取景框）；
 *  3. 脏状态下点其他作品 → 先托管草稿再回填，提示「已保留当前草稿」；
 *  4. 点草稿卡 → 新建画布焦点 + 恢复草稿内容与来源，取景框提示「源自：…」；
 *  5. 还原原图 → 恢复来源作品原始参数、清草稿、回到该作品；
 *  6. 草稿提交成功 → 清草稿，沿用 new_draft 提交流程；
 *  7. 新建创作 → 清空表单与草稿来源。
 *
 * 状态机本体在 useStudioForm 里：这里用最小 Harness 挂载 `useStudio` 直接读领域对象，
 * 再用一次整页 Studio 挂载检查界面呈现（草稿卡 / 左栏状态 / 舞台取景框）。
 *
 * 运行：$env:OFS_TEST_BUNDLE=".tmp/phase-a/build/semantics.js"; node test/check-client-draft.mjs
 */

import assert from 'node:assert/strict'

import { createCheckRunner } from './helpers/check.mjs'
import {
  assertStructure,
  buttonByText,
  collectText,
  countByClass,
  findNodes,
  createTestClient,
} from './helpers/render.mjs'
import {
  NOW, at, image, preset, probeOk, studioResponses,
} from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

/** 两张独立作品（无版本关系），用来验证「看原图 / 点其他作品」不再被 dirty 拦截。 */
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

const draftPreset = { ...preset, supportsImg2Img: true, supportsInpaint: true }

const draftState = {
  defaultPreset: 'sdxl-lightning',
  presets: [draftPreset],
  session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
  jobs: [],
  lastJob: null,
  probe: probeOk,
}

const draftResponses = (extra = {}) => studioResponses(
  draftState,
  { items: [workA, workB] },
  { '/imagen-api/generate': { id: 'job-draft', status: 'queued' }, ...extra },
)

/**
 * 挂载 useStudio 的最小 Harness：把领域对象挂在 latest.studio 上，
 * 与 check-client-chat.mjs 的端到端粘合用例同一套做法。
 */
async function mountStudioHarness(responses = draftResponses()) {
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-draft-harness' }, String(studio.form.form.prompt))
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

const textOf = (tree) => collectText(tree).join(' | ')
const promptAreaOf = (tree) => findNodes(
  tree,
  (node) => node.type === 'textarea'
    && typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('ofs-composer-input'),
)[0] || null
const thumbsOf = (tree) => findNodes(
  tree,
  (node) => node.type === 'button'
    && typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('ofs-thumb')
)
const draftCardOf = (tree) => findNodes(
  tree,
  (node) => node.type === 'button'
    && typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('ofs-draft-card'),
)[0] || null

// ── §6.1.1 ~ §6.1.5：回填 / 草稿卡亮起 / 切换托管 / 草稿恢复 / 还原原图 ─────────
await check('草稿托管：回填 → 改词亮卡 → 切其他作品托管 → 点草稿卡恢复 → 还原原图', async () => {
  const { client, latest } = await mountStudioHarness()
  try {
    const form = () => latest.studio.form
    // 1) 点作品 A：切预览 + 回填该作品原始参数（干净基准）。
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(latest.studio.library.selected.image.path, workA.images[0].path, '预览切到被点作品')
    assert.equal(form().form.prompt, 'A 的荷花池塘', '提示词来自作品')
    assert.equal(form().form.width, 1024, '尺寸用产物像素')
    assert.equal(form().form.seed, '11', '保留原图 seed')
    assert.equal(form().dirty, false, '回填后是干净基准')
    assert.equal(form().draft, null, '此时还没有草稿')
    assert.equal(latest.studio.library.newDraftCard.draft, false)
    assert.ok(latest.studio.ui.toast.text.includes('参数已回填'), '干净回填给「参数已回填」')

    // 2) 改词 → dirty：草稿卡实时亮起，左栏给草稿状态，舞台仍停在来源作品。
    form().patchForm({ prompt: '把荷花改成雨夜', width: 1280, height: 720 })
    await client.rerenderRaw()
    assert.equal(form().dirty, true, '手动修改后 dirty')
    assert.equal(form().draftView.active, true, '有未提交草稿')
    assert.equal(form().draftView.source && form().draftView.source.prompt, 'A 的荷花池塘', '草稿来源作品 A')
    assert.equal(latest.studio.library.newDraftCard.draft, true, '草稿卡出现「未提交草稿」')
    assert.equal(latest.studio.library.newDraftCard.draftFrom, 'A 的荷花池塘', '草稿卡显示「源自此图」')
    assert.equal(latest.studio.library.workspaceMode, 'work', '舞台保持 work 焦点')
    assert.equal(latest.studio.library.selected.image.path, workA.images[0].path, '舞台继续展示来源作品，不闪成空取景框')

    // 3) 脏状态下点作品 B：先把当前编辑托管进草稿卡，再回填 B，提示草稿保留。
    latest.studio.actions.previewWork(entryB)
    await client.rerenderRaw()
    assert.equal(latest.studio.library.selected.image.path, workB.images[0].path, '预览切到 B')
    assert.equal(form().form.prompt, 'B 的山间晨雾', '回填 B 的原始参数（不再被 dirty 拦截）')
    assert.equal(form().dirty, false, 'B 的回填是干净基准')
    const parked = form().draft
    assert.ok(parked && parked.form, '当前编辑被托管进草稿槽')
    assert.equal(parked.form.prompt, '把荷花改成雨夜', '草稿内容 = 刚才的未提交编辑')
    assert.equal(parked.form.width, 1280, '草稿保存完整表单（含画幅）')
    assert.equal(parked.source && parked.source.path, workA.images[0].path, '草稿记录来源作品 A')
    assert.equal(parked.form.editing, undefined, '表单快照不含 editing 标志')
    assert.equal(latest.studio.library.newDraftCard.draft, true, '草稿卡保持可见')
    assert.equal(latest.studio.library.newDraftCard.draftFrom, 'A 的荷花池塘')
    assert.ok(latest.studio.ui.toast.text.includes('已保留当前草稿'), '提示「已保留当前草稿」')

    // 4) 点草稿卡：切新建画布焦点 + 恢复草稿内容与来源。
    latest.studio.actions.focusNewDraft()
    await client.rerenderRaw()
    assert.equal(latest.studio.library.workspaceMode, 'new_draft', '草稿恢复在新建画布焦点')
    assert.equal(latest.studio.library.selected, null, '新建画布没有选中作品')
    assert.equal(form().form.prompt, '把荷花改成雨夜', '草稿提示词恢复')
    assert.equal(form().form.width, 1280, '草稿画幅恢复')
    assert.equal(form().form.height, 720)
    assert.equal(form().draftView.editing, true, '标志当前表单正在编辑草稿')
    assert.equal(form().origin && form().origin.path, workA.images[0].path, '来源作品恢复为 A')
    assert.equal(latest.studio.library.newDraftCard.draftFrom, 'A 的荷花池塘', '取景框显示「源自：A」')

    // 5) 还原原图：恢复来源作品原始参数、清草稿、回到该作品（work 焦点）。
    const restored = latest.studio.actions.restoreOriginal()
    await client.rerenderRaw()
    assert.equal(restored, true, '有来源时还原成功')
    assert.equal(form().form.prompt, 'A 的荷花池塘', '恢复来源作品原始提示词')
    assert.equal(form().form.width, 1024, '恢复来源作品原始画幅')
    assert.equal(form().dirty, false, '还原后是干净基准')
    assert.equal(form().draft, null, '草稿卡清除')
    assert.equal(latest.studio.library.newDraftCard.draft, false)
    assert.equal(latest.studio.library.workspaceMode, 'work', '回到该作品的 work 焦点')
    assert.equal(latest.studio.library.selected.image.path, workA.images[0].path)
    assert.ok(latest.studio.ui.toast.text.includes('已还原原图参数'), '还原原图给提示')
  } finally {
    client.unmount()
  }
})

// ── §6.1.3 覆盖语义：已有草稿时用当前编辑覆盖，而不是叠加两份 ─────────────────
await check('草稿托管：已有草稿时用当前编辑覆盖内容', async () => {
  const { client, latest } = await mountStudioHarness()
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    // 第一版草稿：改词后点 B，托管。
    form().patchForm({ prompt: '第一版草稿' })
    await client.rerenderRaw()
    latest.studio.actions.previewWork(entryB)
    await client.rerenderRaw()
    assert.equal(form().draft.form.prompt, '第一版草稿')
    // 在 B 上继续改，再点回 A：当前编辑覆盖草稿内容，来源换成 B（现在这版是照 B 改的）。
    form().patchForm({ prompt: '第二版草稿（照 B 改）' })
    await client.rerenderRaw()
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(form().form.prompt, 'A 的荷花池塘', '回填 A')
    assert.equal(form().draft.form.prompt, '第二版草稿（照 B 改）', '草稿内容被当前编辑覆盖')
    assert.equal(form().draft.source && form().draft.source.path, workB.images[0].path, '来源跟随当前编辑（B）')
    assert.equal(latest.studio.library.newDraftCard.draftFrom, 'B 的山间晨雾')
  } finally {
    client.unmount()
  }
})

// ── §6.1.6 / §6.1.7：提交成功清草稿、新建创作清空来源 ─────────────────────────
await check('草稿提交成功清空草稿卡；新建创作清空表单与草稿来源', async () => {
  const { client, latest } = await mountStudioHarness()
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    form().patchForm({ prompt: '要发布的新提示词' })
    await client.rerenderRaw()
    // 点草稿卡 → 新建画布焦点；提交走现有 new_draft 流程。
    latest.studio.actions.focusNewDraft()
    await client.rerenderRaw()
    assert.equal(latest.studio.library.workspaceMode, 'new_draft')
    const ok = await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(ok, true, '草稿提交成功')
    assert.equal(form().draft, null, '提交成功后清草稿')
    assert.equal(form().dirty, false, '提交内容是新的干净基准')
    assert.equal(latest.studio.library.newDraftCard.draft, false, '草稿卡不再显示未提交草稿')
    assert.equal(latest.studio.library.newDraftCard.pending, true, '保持 new_draft 等待出图')
    assert.equal(latest.studio.library.workspaceMode, 'new_draft', '任务完成前留在新建画布')
    // 7) 新建创作：清空表单与草稿来源。
    latest.studio.actions.newDraft()
    await client.rerenderRaw()
    assert.equal(form().form.prompt, '', '新建创作清空提示词')
    assert.equal(form().draft, null)
    assert.equal(form().origin, null, '清空来源作品')
    assert.equal(form().tuning, null, '面板不再提示微调来源')
    assert.equal(form().dirty, false)
  } finally {
    client.unmount()
  }
})

// ── §6.1.2 界面呈现：整页 Studio 上的草稿卡 / 左栏状态 / 舞台取景框 ─────────────
await check('渲染：草稿态草稿卡、左栏状态与舞台取景框', async () => {
  const client = await createTestClient({ now: NOW, responses: draftResponses(), testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { workspaceMode: 'work' })
    // 点作品 A 缩略图：回填参数，表单干净。
    const thumbs = thumbsOf(tree)
    assert.equal(thumbs.length, 2, '胶片条应有两张作品缩略图')
    thumbs[0].props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(promptAreaOf(tree).props.value, 'A 的荷花池塘', '点缩略图回填该作品提示词')
    assertStructure('draft-clean', tree, {
      required: { 'ofs-print': 1, 'ofs-dock': 1 },
      forbidden: ['has-draft', 'ofs-draft-from', 'ofs-figure--draft', 'ofs-figure--empty'],
    })

    // 改词：草稿卡实时出现「未提交草稿 / 源自此图」，左栏给草稿状态 + 还原原图。
    promptAreaOf(tree).props.onChange({ target: { value: '雨夜版的荷花池塘' } })
    tree = await client.rerenderRaw()
    const card = draftCardOf(tree)
    assert.ok(card, '草稿卡应渲染在最左端')
    const cardText = collectText(card).join(' | ')
    assert.ok(cardText.includes('未提交草稿'), `草稿卡应显示「未提交草稿」，实际：${cardText}`)
    assert.ok(cardText.includes('源自此图'), `草稿卡应显示「源自此图」，实际：${cardText}`)
    assert.ok((card.props.title || '').includes('A 的荷花池塘'), '草稿卡 title 带来源提示词')
    assert.ok(textOf(tree).includes('正在新草稿中编辑（源自此图）'), '左栏顶部显示草稿状态')
    const restoreButton = buttonByText(tree, '还原原图')
    assert.ok(restoreButton, '左栏顶部应有「还原原图」按钮')
    // 舞台保持展示来源作品，不闪成空取景框 / 新建画布。
    assertStructure('draft-dirty', tree, {
      required: { 'ofs-print': 1, 'has-draft': 1, 'ofs-draft-from': 1, 'ofs-tuning-restore': 1 },
      forbidden: ['ofs-figure--empty', 'ofs-figure--draft'],
    })

    // 脏状态下点作品 B：回填 B，草稿卡保持可见，并提示草稿已保留。
    thumbsOf(tree)[1].props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(promptAreaOf(tree).props.value, 'B 的山间晨雾', '点作品 B 回填其原始参数')
    assert.equal(countByClass(tree, 'has-draft'), 1, '草稿卡保持可见')
    assert.ok(textOf(tree).includes('已保留当前草稿'), '提示「已保留当前草稿」')
    assert.equal(countByClass(tree, 'ofs-print'), 1, '舞台切到 B 而不是空取景框')

    // 点草稿卡：切新建画布焦点、恢复草稿内容，取景框提示来源。
    draftCardOf(tree).props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(countByClass(tree, 'ofs-figure--draft'), 1, '切到新建画布取景框')
    assert.ok(textOf(tree).includes('源自：A 的荷花池塘'), '取景框显示草稿来源')
    assert.equal(promptAreaOf(tree).props.value, '雨夜版的荷花池塘', '恢复草稿内容')
    assert.ok(textOf(tree).includes('未提交草稿'), '草稿卡仍是未提交草稿')
    assert.ok(buttonByText(tree, '还原原图'), '还原原图常驻')

    // 还原原图：草稿清除、回到来源作品的展示。
    buttonByText(tree, '还原原图').props.onClick()
    tree = await client.rerenderRaw()
    assert.equal(countByClass(tree, 'has-draft'), 0, '草稿卡恢复普通态')
    assert.equal(countByClass(tree, 'ofs-figure--draft'), 0, '离开新建画布取景框')
    assert.equal(promptAreaOf(tree).props.value, 'A 的荷花池塘', '还原来源作品原始参数')
    assert.ok(
      !collectText(draftCardOf(tree)).join('').includes('未提交草稿'),
      '草稿卡不再显示未提交草稿（整页文本含 <style>，只查卡片本身）',
    )
    assert.equal(buttonByText(tree, '还原原图'), null, '草稿清除后不再有还原入口')

    // 动作坞（§6.1.8）：只有「重新生成」，「带回参数」已下线。
    const dock = findNodes(tree, (node) => node.props && node.props.className === 'ofs-dock')[0]
    const dockText = collectText(dock).join(' | ')
    assert.ok(dockText.includes('重新生成'), '动作坞保留「重新生成」')
    assert.ok(!dockText.includes('带回参数'), '动作坞不再出现「带回参数」')
    const reuseButtons = findNodes(
      dock,
      (node) => node.type === 'button'
        && typeof node.props?.className === 'string'
        && node.props.className.split(' ').includes('ofs-dock-button'),
    ).filter((node) => collectText(node).join('').includes('重新生成'))
    assert.equal(reuseButtons.length, 1, '复用组只剩「重新生成」一个按钮')
  } finally {
    client.unmount()
  }
})

// ── 阶段十五 Phase C0：焦点与来源同源收口（导入图 / 新建画布 / 助手 / 删除） ──────
//
// 这一组覆盖「舞台切了图，左栏却还是上一张作品的参数」这类真实状态漏洞：
//  1. 裸导入图（无生成元数据）→ 先托管 dirty 草稿，再清 prompt / seed / origin（保留预设画幅）；
//  2. 带 PNG tEXt 生成元数据的导入图 → 完成导入后回填原生成参数；
//  3. 空白新建画布 → 不继承上一张浏览作品的提示词 / 固定种子 / 「正在微调」；
//  4. 助手点结果图（library.openMessage）→ 与胶片条同口径回填；
//  5. 切换作品 / 还原原图 → 退出画布编辑态且按路径保留 workDrafts；
//  6. 还原原图时来源作品已不在列表 → 安全收口，不把别的图当成来源；
//  7. 删除作品 → 级联清理工具草稿与来源引用，回退到下一张时刷新左栏回填。

/** 裸导入图：meta.params 只有文件名与像素尺寸，没有生成元数据。 */
const bareImportImage = {
  path: 'imagen-output/import-bare/01.png',
  file: '01.png',
  url: '/imagen-api/file?path=imagen-output%2Fimport-bare%2F01.png',
  width: 800,
  height: 600,
}
const bareImportItem = {
  jobId: 'import-bare',
  prompt: 'photo.png',
  presetId: null,
  source: 'import',
  imported: true,
  images: [bareImportImage],
  params: { prompt: 'photo.png', width: 800, height: 600, count: 1, source: 'import' },
}
const bareImportEntry = { image: bareImportImage, item: bareImportItem, generation: null }

/** 带生成元数据的导入图：params 与 generation 都由 PNG tEXt 回填出来。 */
const metaImportImage = {
  path: 'imagen-output/import-meta/01.png',
  file: '01.png',
  url: '/imagen-api/file?path=imagen-output%2Fimport-meta%2F01.png',
  width: 1152,
  height: 648,
  seed: null,
}
const metaImportItem = {
  jobId: 'import-meta',
  prompt: '湖面上的荷花',
  presetId: 'sdxl-lightning',
  source: 'import',
  imported: true,
  images: [metaImportImage],
  params: {
    prompt: '湖面上的荷花',
    negativePrompt: 'blurry',
    width: 1152,
    height: 648,
    steps: 8,
    cfg: 2.5,
    seed: 123,
    count: 1,
    source: 'import',
  },
}
const metaImportEntry = {
  image: metaImportImage,
  item: metaImportItem,
  generation: { prompt: '湖面上的荷花', presetId: 'sdxl-lightning', width: 1152, height: 648, steps: 8, cfg: 2.5, seed: 123 },
}

await check('焦点同源：裸导入图清空上一张作品的参数与来源，dirty 先托管草稿', async () => {
  const { client, latest } = await mountStudioHarness()
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(form().form.prompt, 'A 的荷花池塘')
    assert.equal(form().origin && form().origin.path, workA.images[0].path, '先绑到作品 A')

    // 脏表单切裸导入图：未提交修改先进草稿槽，再解除绑定（来源快照跟着草稿走）。
    form().patchForm({ prompt: '还没提交的草稿', seed: '42' })
    await client.rerenderRaw()
    latest.studio.actions.previewWork(bareImportEntry)
    await client.rerenderRaw()
    assert.equal(latest.studio.library.selected.image.path, bareImportImage.path, '预览切到导入图')
    const parked = form().draft
    assert.ok(parked && parked.form, '未提交修改先被托管进草稿卡')
    assert.equal(parked.form.prompt, '还没提交的草稿')
    assert.equal(parked.source && parked.source.path, workA.images[0].path, '草稿记录来源作品 A')
    assert.ok(latest.studio.ui.toast.text.includes('已保留当前草稿'), '托管草稿给「已保留当前草稿」提示')
    assert.equal(form().form.prompt, '', '裸导入图不把文件名当提示词回填')
    assert.equal(form().form.seed, '', '清空上一张作品的固定种子')
    assert.equal(form().origin, null, '解除来源作品绑定')
    assert.equal(form().tuning, null, '面板不再显示「正在微调」')
    assert.equal(form().form.presetId, 'sdxl-lightning', '保留当前模型预设')
    assert.equal(form().form.width, 1024, '保留当前画幅')
    assert.equal(form().form.height, 1024)
    assert.equal(form().dirty, false, '解除绑定后是干净基准')
    assert.ok(!latest.studio.ui.toast.text.includes('参数已回填'), '裸导入不宣称「参数已回填」')

    // 已托管草稿保持可见：裸导入不会把草稿卡一起清掉。
    assert.equal(latest.studio.library.newDraftCard.draft, true, '草稿卡保持可见')
    assert.equal(latest.studio.library.newDraftCard.draftFrom, 'A 的荷花池塘')
  } finally {
    client.unmount()
  }
})

await check('焦点同源：带 PNG 生成元数据的导入图完成导入后回填原参数', async () => {
  const responses = draftResponses()
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    // Host 落盘后 /history 会包含导入条目：先让 fake host 的下一轮历史带上它。
    responses['/imagen-api/history'] = { items: [metaImportItem, bareImportItem, workA, workB] }
    const ok = latest.studio.actions.activateImport(metaImportEntry)
    await client.settle()
    await client.rerenderRaw()
    assert.equal(ok, true)
    assert.equal(latest.studio.library.selected.image.path, metaImportImage.path, '导入完成后舞台切到导入图')
    assert.equal(form().form.prompt, '湖面上的荷花', '导入图的生成参数回填左栏')
    assert.equal(form().form.width, 1152, '尺寸用生成元数据里的像素')
    assert.equal(form().form.height, 648)
    assert.equal(form().form.steps, 8)
    assert.equal(form().form.cfg, 2.5)
    assert.equal(form().form.seed, '123')
    assert.equal(form().origin && form().origin.path, metaImportImage.path, '来源作品切到导入图本身')
    assert.equal(form().dirty, false, '回填后是干净基准')
    assert.ok(latest.studio.ui.toast.text.includes('已识别生成参数'), '主提示仍是「已识别生成参数」')
    assert.ok(!latest.studio.ui.toast.text.includes('参数已回填'), '不叠一条「参数已回填」覆盖主提示')

    // 裸导入：完成导入时同样清空上一张作品的参数（导入前的修改先进草稿）。
    form().patchForm({ prompt: '导入前的草稿' })
    await client.rerenderRaw()
    const bareOk = latest.studio.actions.activateImport(bareImportEntry)
    await client.settle()
    await client.rerenderRaw()
    assert.equal(bareOk, true)
    assert.equal(form().form.prompt, '', '裸导入完成时清空上一张作品的提示词')
    assert.equal(form().origin, null, '裸导入完成后不绑定来源作品')
    assert.ok(form().draft && form().draft.form.prompt === '导入前的草稿', '导入前的未提交修改先托管进草稿')
    assert.ok(latest.studio.ui.toast.text.includes('图片已导入'), '裸导入给「图片已导入」提示')
  } finally {
    client.unmount()
  }
})

await check('焦点同源：空白新建画布不继承上一张浏览作品的提示词 / 种子 / 来源', async () => {
  // 16:9 的宽幅作品：用于确认新建画布保留「上一张仍在用的」画幅，而不是回到默认方形。
  const wideImage = { ...image(13), path: 'imagen-output/job-c/13.png', file: '13.png', width: 1152, height: 648 }
  const wideWork = {
    jobId: 'job-c',
    dir: 'imagen-output/20261109-100000-job-c',
    prompt: 'C 的宽幅风景',
    presetId: 'sdxl-lightning',
    finishedAt: at(-180),
    images: [wideImage],
  }
  const responses = studioResponses(draftState, { items: [workA, workB, wideWork] })
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork({ image: wideImage, item: wideWork })
    await client.rerenderRaw()
    assert.equal(form().form.prompt, 'C 的宽幅风景')
    assert.equal(form().form.width, 1152, '回填作品 C 的宽幅')
    assert.equal(form().origin && form().origin.path, wideImage.path)

    // 干净、无托管草稿时点「新建草稿卡」：清 prompt / seed / origin，保留预设与画幅。
    latest.studio.actions.focusNewDraft()
    await client.rerenderRaw()
    assert.equal(latest.studio.library.workspaceMode, 'new_draft', '切到新建画布焦点')
    assert.equal(latest.studio.library.selected, null, '新建画布没有选中作品')
    assert.equal(form().form.prompt, '', '不把上一张浏览作品的提示词带进新画布')
    assert.equal(form().form.seed, '', '不把上一张作品的固定种子带进新画布')
    assert.equal(form().origin, null, '不保留「正在微调」来源')
    assert.equal(form().tuning, null)
    assert.equal(form().form.presetId, 'sdxl-lightning', '保留当前模型预设')
    assert.equal(form().form.width, 1152, '保留当前画幅比例（宽）')
    assert.equal(form().form.height, 648, '保留当前画幅比例（高）')
    assert.equal(form().dirty, false)
    assert.equal(form().draft, null, '没有未提交修改时不产生草稿')
  } finally {
    client.unmount()
  }
})

await check('焦点同源：助手点结果图走 previewWork 回填，并进行中的草稿先托管', async () => {
  const { client, latest } = await mountStudioHarness()
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    form().patchForm({ prompt: '助手点击前的草稿' })
    await client.rerenderRaw()
    // 助手结果网格 / 单图聚焦都通过 library.openMessage 打开作品。
    latest.studio.library.openMessage(workB.images[0].path)
    await client.rerenderRaw()
    assert.equal(latest.studio.library.selected.image.path, workB.images[0].path, '舞台切到助手点的图')
    assert.equal(form().form.prompt, 'B 的山间晨雾', '左栏同步回填被点作品参数（图文同源）')
    assert.equal(form().origin && form().origin.path, workB.images[0].path, '来源作品跟着切到被点图')
    assert.equal(form().dirty, false)
    assert.ok(form().draft && form().draft.form.prompt === '助手点击前的草稿', '点击前的未提交修改先托管进草稿')
    assert.ok(latest.studio.ui.toast.text.includes('已保留当前草稿'))

    // 路径不在已加载作品库（新任务尚未进历史）：安全收口——只切预览并解除绑定，不残留旧参数。
    latest.studio.library.openMessage('imagen-output/unknown/99.png')
    await client.rerenderRaw()
    assert.equal(form().form.prompt, '', '未知路径不回填任何提示词')
    assert.equal(form().origin, null, '未知路径解除来源作品绑定')
  } finally {
    client.unmount()
  }
})

await check('切换作品 / 还原原图退出画布编辑态，按路径保留 workDrafts', async () => {
  const { client, latest } = await mountStudioHarness()
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    const opened = latest.studio.actions.openImageTool('inpaint', entryA)
    await client.rerenderRaw()
    assert.equal(opened, true, '局部涂抹打开成功')
    assert.equal(latest.studio.imageTool.editorOpen, true)
    // 在 A 上留一份工具草稿（涂抹描述），随后切走。
    latest.studio.imageTool.setPrompt('A 的涂抹草稿')
    await client.rerenderRaw()
    await client.settle()
    await client.rerenderRaw()
    const draftKeyA = workA.images[0].path
    assert.equal(latest.studio.imageTool.workDrafts[draftKeyA].prompt, 'A 的涂抹草稿', '作品 A 有未提交工具草稿')

    // 切换作品：只收起画布编辑态，草稿按作品路径保留（SPEC §5.17）。
    latest.studio.actions.previewWork(entryB)
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.editorOpen, false, '切作品退出画布编辑态')
    assert.equal(latest.studio.imageTool.workDrafts[draftKeyA].prompt, 'A 的涂抹草稿', 'workDrafts 按路径保留')

    // 重新打开 A：草稿恢复，继续编辑。
    latest.studio.actions.openImageTool('inpaint', entryA)
    await client.rerenderRaw()
    assert.equal(latest.studio.imageTool.editorOpen, true)
    assert.equal(latest.studio.imageTool.prompt, 'A 的涂抹草稿', '重新打开恢复未提交草稿')

    // 还原原图同样退出画布编辑态（来源作品仍是 B）。
    const restored = latest.studio.actions.restoreOriginal()
    await client.rerenderRaw()
    assert.equal(restored, true)
    assert.equal(latest.studio.imageTool.editorOpen, false, '还原原图退出画布编辑态')
    assert.equal(latest.studio.imageTool.workDrafts[draftKeyA].prompt, 'A 的涂抹草稿', '还原原图不清 workDrafts')
    assert.equal(form().form.prompt, 'B 的山间晨雾', '还原到来源作品 B 的原始参数')
  } finally {
    client.unmount()
  }
})

await check('还原原图：来源作品已不在列表时安全收口，不把别的图当成来源', async () => {
  const responses = draftResponses()
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(form().origin && form().origin.path, workA.images[0].path)
    // A 被删除 / 不在已加载分页：下一轮历史只剩 B，但左栏的来源快照仍指向 A。
    responses['/imagen-api/history'] = { items: [workB] }
    await latest.studio.library.loadHistory()
    await client.settle()
    await client.rerenderRaw()
    const restored = latest.studio.actions.restoreOriginal()
    await client.rerenderRaw()
    assert.equal(restored, true, '有来源快照时参数照常还原')
    assert.equal(form().form.prompt, 'A 的荷花池塘', '参数按来源快照还原')
    assert.equal(latest.studio.library.workspaceMode, 'new_draft', '舞台切回新建画布取景框，不停在别的作品上')
    assert.equal(latest.studio.library.selected, null, '不把别的作品当成来源展示')
    assert.ok(latest.studio.ui.toast.text.includes('已不在列表'), '给出「来源已不在列表」提示')
    assert.equal(form().dirty, false)
  } finally {
    client.unmount()
  }
})

await check('删除作品：级联清理工具草稿与来源引用，回退到下一张时刷新左栏回填', async () => {
  const responses = draftResponses()
  responses['/imagen-api/library/delete'] = { ok: true, removed: [workA.images[0].path], failed: [] }
  const { client, latest } = await mountStudioHarness(responses)
  try {
    const form = () => latest.studio.form
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    // 在 A 上留一份工具草稿：删除后圆点不能还指向已删作品。
    latest.studio.actions.openImageTool('inpaint', entryA)
    await client.rerenderRaw()
    latest.studio.imageTool.setPrompt('A 的未提交涂抹')
    await client.rerenderRaw()
    await client.settle()
    await client.rerenderRaw()
    const draftKeyA = workA.images[0].path
    assert.ok(latest.studio.imageTool.workDrafts[draftKeyA], '删除前存在 A 的工具草稿')
    // 回到 A 的预览态（退出编辑态，草稿保留），确保 A 是当前预览作品与左栏来源。
    latest.studio.actions.previewWork(entryA)
    await client.rerenderRaw()
    assert.equal(form().origin && form().origin.path, draftKeyA)

    const result = await latest.studio.library.deleteImages([draftKeyA])
    await client.settle()
    await client.rerenderRaw()
    assert.deepEqual(result.removed, [draftKeyA])
    assert.equal(latest.studio.imageTool.workDrafts[draftKeyA], undefined, '按 removed 路径清掉工具草稿')
    // 删掉的是当前预览作品：回退到下一张，并同步刷新左栏回填（图文同源）。
    assert.equal(latest.studio.library.selected.image.path, workB.images[0].path, '删除当前预览作品后回退到下一张')
    assert.equal(form().origin && form().origin.path, workB.images[0].path, '来源引用跟着回退作品')
    assert.equal(form().form.prompt, 'B 的山间晨雾', '左栏同步回填回退作品的参数')
    assert.equal(form().dirty, false)
    assert.equal(form().tuning && form().tuning.prompt, 'B 的山间晨雾', '「正在微调」来源也切到回退作品')
  } finally {
    client.unmount()
  }
})

summary()
