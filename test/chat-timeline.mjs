/**
 * 阶段十五 Phase A2：助手时间线测试（结果网格、舞台工具镜像、单图聚焦返回栈、intentHistory 隔离）。
 *
 * 纯逻辑直接 import `src/logic/chat.js` / `src/logic/intent.js`，不依赖 React；
 * hook 行为用 test/helpers/render.mjs 的假渲染器挂 `useChatThread`，断言真实状态流转。
 * 渲染层的网格 / 镜像卡 / 聚焦视图结构断言在 check-client-chat.mjs。
 *
 * 运行：$env:OFS_TEST_BUNDLE=".tmp/phase-a/build/timeline.js"; node test/chat-timeline.mjs
 */

import assert from 'node:assert/strict'

import { LIMITS } from '../shared/contract.js'
import { fallbackTranslate } from '../src/i18n.js'
import {
  bubblePatch,
  bubbleUnchanged,
  currentFocusOf,
  focusBackLabelOf,
  focusEntryOf,
  focusNameOf,
  gridImagesOf,
  imageMetaOf,
  imagesKeyOf,
  mirrorToolEntries,
  popFocus,
  pushFocus,
  strengthLabelOf,
} from '../src/logic/chat.js'
import { intentHistory } from '../src/logic/intent.js'
import { createCheckRunner } from './helpers/check.mjs'
import { createTestClient } from './helpers/render.mjs'
import { NOW } from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()
const t = fallbackTranslate('zh')

/** 一组 4 张样本产物：与宿主 /state 的 job.output.images 同形。 */
const RESULT_IMAGES = [
  { path: 'imagen-output/job-1/01.png', file: '01.png', url: '/imagen-api/file?path=job1-01', width: 1024, height: 1024, seed: 7, seconds: 6.2 },
  { path: 'imagen-output/job-1/02.png', file: '02.png', url: '/imagen-api/file?path=job1-02', width: 1024, height: 1024, seed: 8, seconds: 6.2 },
  { path: 'imagen-output/job-1/03.png', file: '03.png', url: '/imagen-api/file?path=job1-03', width: 1024, height: 1024, seed: 9, seconds: 6.2 },
  { path: 'imagen-output/job-1/04.png', file: '04.png', url: '/imagen-api/file?path=job1-04', width: 1024, height: 1024, seed: 10, seconds: 6.2 },
]

/** 结果消息：模拟 bubblePatch 完成后的气泡形状（含首图兼容字段）。 */
const GRID_MESSAGE = {
  id: 10,
  role: 'assistant',
  kind: 'job',
  jobId: 'job-1',
  stage: 'done',
  text: '已生成，点击缩略图放大。',
  images: RESULT_IMAGES,
  image: RESULT_IMAGES[0].url,
  imagePath: RESULT_IMAGES[0].path,
  meta: '6.2 秒 · 种子 7',
}

// ── 6.2-1：任务完成气泡接收全部 1~4 张结果图 ──────────────────────

await check('纯逻辑：完成气泡收全部结果图，保留首图兼容字段', async () => {
  const current = { id: 1, role: 'assistant', kind: 'job', jobId: 'job-1', stage: 'pending', text: '已提交，等待开始…' }
  const patch = bubblePatch(t, { status: 'done', output: { images: RESULT_IMAGES } }, current)
  assert.equal(patch.stage, 'done')
  assert.equal(patch.images.length, 4, '完成态应映射全部 4 张结果图，不再只取首图')
  // images 项只保留气泡需要的六个字段（宿主的 file 等额外字段不进入消息）。
  assert.deepEqual(patch.images[2], {
    url: '/imagen-api/file?path=job1-03',
    path: 'imagen-output/job-1/03.png',
    width: 1024,
    height: 1024,
    seed: 9,
    seconds: 6.2,
  })
  // 首图兼容字段继续可用（旧组件 / 旧断言直接读 image / imagePath / meta）。
  assert.equal(patch.image, RESULT_IMAGES[0].url)
  assert.equal(patch.imagePath, RESULT_IMAGES[0].path)
  assert.ok(patch.meta.includes('6.2') && patch.meta.includes('种子 7'), '首图 meta 保留秒数与种子')
  // 结果图指纹变化时才需要重写气泡。
  assert.equal(imagesKeyOf(patch.images), RESULT_IMAGES.map((image) => image.path).join('|'))
  assert.equal(bubbleUnchanged({ ...current, ...patch }, patch), true, '内容相同的补丁不应重复写入')
  assert.equal(bubbleUnchanged({ ...current, ...patch, images: [RESULT_IMAGES[0]] }, patch), false, '结果图变化必须写入')
  // 缺 url 的旧记录按 /imagen-api/file?path= 补齐；缺失的数值保持 null。
  const withPath = bubblePatch(t, {
    status: 'done',
    output: { images: [{ path: 'imagen-output/old/01.png' }] },
  }, {})
  assert.equal(withPath.images[0].url, '/imagen-api/file?path=imagen-output%2Fold%2F01.png')
  assert.equal(withPath.images[0].seed, null)
  assert.equal(withPath.images[0].seconds, null)
  // 宿主快照临时缺产物时不覆盖已有结果图；非完成态仍是纯状态补丁。
  const kept = bubblePatch(t, { status: 'done', output: { images: [] } }, { images: patch.images })
  assert.deepEqual(kept.images, patch.images)
  assert.deepEqual(bubblePatch(t, { status: 'queued' }), { stage: 'queued', text: '排队等待出图…' })
  assert.deepEqual(bubblePatch(t, { status: 'running' }), { stage: 'running', text: '正在生成…' })
  assert.equal(bubblePatch(t, { status: 'mystery' }), null, '未知状态保持原样')
  // 消息 → 结果图：新版 images、旧版首图、超上限截断。
  assert.equal(gridImagesOf(GRID_MESSAGE).length, 4)
  assert.equal(gridImagesOf({ image: '/legacy/img.png', imagePath: 'imagen-output/a/01.png' }).length, 1, '旧记录回退成一张')
  assert.equal(gridImagesOf({}).length, 0)
  assert.equal(gridImagesOf({ images: [...RESULT_IMAGES, ...RESULT_IMAGES] }).length, LIMITS.count.max, '最多展示 4 张')
  // 网格标签与单图元信息。
  assert.equal(imageMetaOf(t, RESULT_IMAGES[0]), '6.2秒 · 种子 7')
  assert.equal(strengthLabelOf(t, 0.8), '重绘强度 0.8')
  assert.equal(strengthLabelOf(t, null), '')
})

// ── 6.2-2：舞台图片工具提交成功的镜像记录（两条带 kind） ──────────

await check('纯逻辑：舞台工具镜像记录带 kind 且不进意图上下文', async () => {
  const target = {
    path: 'imagen-output/base/01.png',
    url: '/imagen-api/file?path=base-01',
    width: 1024,
    height: 768,
    prompt: '底图提示词',
  }
  const entries = mirrorToolEntries(t, {
    tool: 'inpaint',
    job: { id: 'job-tool-1', status: 'queued' },
    target,
    body: { reference: { path: target.path, strength: 0.8 } },
  })
  assert.equal(entries.length, 2, '一次工具提交应镜像两条记录')
  const [record, job] = entries
  assert.equal(record.role, 'user')
  assert.equal(record.kind, 'tool')
  assert.equal(record.tool, 'inpaint')
  assert.equal(record.text, '对当前图发起了局部涂抹')
  assert.equal(record.image, target.url, '镜像记录带底图缩略图')
  assert.equal(record.imagePath, target.path)
  assert.equal(record.strength, 0.8)
  assert.equal(job.role, 'assistant')
  assert.equal(job.kind, 'job')
  assert.equal(job.jobId, 'job-tool-1', '任务气泡绑定提交响应里的任务 id')
  assert.equal(job.stage, 'pending')
  assert.equal(job.text, '已提交，等待开始…')
  // 整图重绘 / 无请求体：文案换成 img2img，且没有强度胶囊字段。
  const redraw = mirrorToolEntries(t, { tool: 'img2img', job: { id: 'job-tool-2' }, target })
  assert.equal(redraw[0].text, '对当前图发起了整图重绘')
  assert.equal(Object.prototype.hasOwnProperty.call(redraw[0], 'strength'), false)
  // 参数不全 / 未知工具：不追加（失败路径不会留下半条记录）。
  assert.deepEqual(mirrorToolEntries(t, { tool: 'upscale', job: { id: 'x' }, target }), [])
  assert.deepEqual(mirrorToolEntries(t, { tool: 'inpaint', job: {}, target }), [])
  assert.deepEqual(mirrorToolEntries(t, { tool: 'inpaint', job: { id: 'x' } }), [])
  // 上下文隔离：kind='tool' 的用户记录与 kind='job' 的助手记录都被 intentHistory 跳过。
  const messages = [
    { id: 1, role: 'user', text: '画一只橘猫' },
    { id: 2, ...record },
    { id: 3, ...job },
    { id: 4, role: 'assistant', kind: 'intent', prompt: 'an orange cat' },
  ]
  assert.deepEqual(intentHistory(messages), [
    { role: 'user', content: '画一只橘猫' },
    { role: 'assistant', content: 'an orange cat' },
  ], '镜像记录不得进入意图模型的纯文本历史')
})

// ── 6.2-3：单图聚焦返回栈（逐层回退、栈空回线程） ────────────────

await check('纯逻辑：单图聚焦返回栈逐层回退与面包屑文案', async () => {
  const entry = focusEntryOf({ messageId: 10, image: RESULT_IMAGES[2], index: 2, count: 4 })
  assert.ok(entry, '合法图片应生成聚焦栈项')
  assert.equal(entry.messageId, 10)
  assert.equal(entry.index, 2)
  assert.equal(entry.count, 4)
  assert.equal(entry.path, RESULT_IMAGES[2].path)
  assert.equal(entry.seed, 9)
  assert.equal(focusEntryOf({ image: {} }), null, '既无路径也无地址的图不能聚焦')
  let stack = []
  assert.equal(currentFocusOf(stack), null)
  assert.equal(focusBackLabelOf(t, stack), '', '普通线程视图没有面包屑')
  stack = pushFocus(stack, entry)
  assert.equal(stack.length, 1)
  assert.equal(currentFocusOf(stack).path, RESULT_IMAGES[2].path)
  // 第一层的上一层是结果网格：用本批张数（「4 张生成结果」）。
  assert.equal(focusBackLabelOf(t, stack), '4 张生成结果')
  // 再钻一层：上一层变成父级单图，标签用层级名（带种子）。
  const deeper = pushFocus(stack, focusEntryOf({ messageId: 12, image: RESULT_IMAGES[3], index: 0, count: 1 }))
  assert.equal(deeper.length, 2)
  assert.equal(focusNameOf(t, entry), '单图聚焦 · 种子 9')
  assert.equal(focusBackLabelOf(t, deeper), '单图聚焦 · 种子 9')
  // 逐层出栈，入参不被就地修改。
  const backOne = popFocus(deeper)
  assert.equal(deeper.length, 2, 'popFocus 不得改写入参栈')
  assert.equal(backOne.length, 1)
  assert.equal(currentFocusOf(backOne).path, RESULT_IMAGES[2].path)
  const backToThread = popFocus(backOne)
  assert.equal(backToThread.length, 0)
  assert.equal(currentFocusOf(backToThread), null)
  // 无效入参不产生半层。
  assert.equal(pushFocus(stack, null).length, 1)
  assert.equal(popFocus([]).length, 0)
})

// ── hook 行为：mirrorTool / focusImage / focusBack / newChat ──────

/**
 * 挂载 useChatThread 的最小 Harness：state / form / generate 固定，
 * 测试通过 latest.chat 直接调 hook 暴露的动作，断言真实消息与聚焦栈。
 */
async function mountChatThread() {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const React = client.react
  const h = React.createElement
  const { useChatThread } = client.hooks
  const latest = {}
  const form = {
    form: { presetId: 'sdxl-lightning', cfg: 0, seed: '' },
    negativeActive: false,
    patchForm: () => {},
    applyIntent: () => true,
  }
  function Harness(props) {
    const chat = useChatThread({
      t,
      isEn: false,
      alive: async (promise) => promise,
      state: { lastJob: null },
      form,
      generate: async () => true,
    })
    props.latest.chat = chat
    return h('div', { className: 'ofs-timeline-harness' }, String(chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, { latest })
    await client.settle()
    return { client, latest }
  } catch (error) {
    client.unmount()
    throw error
  }
}

await check('hook：mirrorTool 追加工具记录与任务气泡，newChat 清空聚焦栈', async () => {
  const { client, latest } = await mountChatThread()
  try {
    // 舞台工具提交成功：组合层调用 mirrorTool（参数形状即 useStudio 的接线口径）。
    const ok = latest.chat.mirrorTool({
      tool: 'inpaint',
      job: { id: 'job-tool-1', status: 'queued' },
      target: { path: 'imagen-output/base/01.png', url: '/imagen-api/file?path=base-01', width: 1024, height: 1024 },
      body: { reference: { path: 'imagen-output/base/01.png', strength: 0.8 } },
    })
    assert.equal(ok, true, '合法入参应追加镜像记录')
    await client.rerenderRaw()
    let messages = latest.chat.messages
    assert.equal(messages.length, 2, '一条工具记录 + 一条任务气泡')
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[0].kind, 'tool')
    assert.equal(messages[0].imagePath, 'imagen-output/base/01.png')
    assert.equal(messages[1].role, 'assistant')
    assert.equal(messages[1].kind, 'job')
    assert.equal(messages[1].jobId, 'job-tool-1')
    assert.deepEqual(intentHistory(messages), [], '镜像记录不得进入意图上下文')
    // 参数不全时返回 false 且不追加半条记录。
    assert.equal(latest.chat.mirrorTool({ tool: 'inpaint', job: { id: '' } }), false)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages.length, 2)
    // 聚焦后再新建对话：聚焦栈清空、线程清空。
    assert.equal(latest.chat.focusImage(GRID_MESSAGE, RESULT_IMAGES[2], 2), true)
    await client.rerenderRaw()
    assert.equal(latest.chat.focusDepth, 1, '点图后应进入单图聚焦')
    latest.chat.newChat()
    await client.rerenderRaw()
    assert.equal(latest.chat.focus, null, '新建对话应清空聚焦栈')
    assert.equal(latest.chat.focusDepth, 0)
    assert.equal(latest.chat.messages.length, 0)
    assert.equal(latest.chat.focusBackLabel, '')
  } finally {
    client.unmount()
  }
})

await check('hook：聚焦逐层回退且全程不改 messages', async () => {
  const { client, latest } = await mountChatThread()
  try {
    latest.chat.pushMessages([{ ...GRID_MESSAGE }])
    await client.rerenderRaw()
    const message = latest.chat.messages[0]
    const snapshot = JSON.stringify(latest.chat.messages)
    // 点击第 3 张 → 进入单图聚焦；messages 一个字都不该变。
    assert.equal(latest.chat.focusImage(message, RESULT_IMAGES[2], 2), true)
    await client.rerenderRaw()
    assert.equal(latest.chat.focus.path, RESULT_IMAGES[2].path)
    assert.equal(latest.chat.focus.index, 2)
    assert.equal(latest.chat.focus.count, 4, '聚焦栈项记录本批张数')
    assert.equal(latest.chat.focusBackLabel, '4 张生成结果')
    assert.equal(JSON.stringify(latest.chat.messages), snapshot, '聚焦不得改 messages')
    // 再钻一层（更深的层级），面包屑改为父级单图。
    latest.chat.focusImage(message, RESULT_IMAGES[1], 1)
    await client.rerenderRaw()
    assert.equal(latest.chat.focusDepth, 2)
    assert.equal(latest.chat.focus.path, RESULT_IMAGES[1].path)
    assert.equal(latest.chat.focusBackLabel, '单图聚焦 · 种子 9', '上一层是父级单图')
    // 逐层返回：第一次回到第 3 张，第二次回到普通线程。
    const first = latest.chat.focusBack()
    await client.rerenderRaw()
    assert.equal(first.path, RESULT_IMAGES[2].path, 'focusBack 返回新的栈顶供舞台同步')
    assert.equal(latest.chat.focusDepth, 1)
    assert.equal(latest.chat.focus.path, RESULT_IMAGES[2].path)
    const second = latest.chat.focusBack()
    await client.rerenderRaw()
    assert.equal(second, null, '栈空时返回 null，界面回到普通线程')
    assert.equal(latest.chat.focus, null)
    assert.equal(latest.chat.focusBackLabel, '')
    assert.equal(JSON.stringify(latest.chat.messages), snapshot, '返回全程不得改 messages')
  } finally {
    client.unmount()
  }
})

summary()
