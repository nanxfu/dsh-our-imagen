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

summary()
