/**
 * 对话面板渲染测试（不需要浏览器）。
 *
 * 覆盖：确认卡 v2 / 排除项门控 / 通用澄清 / 意图 v2 状态流 / 表单同步与带入参数面板 /
 * 胶卷回填与草稿托管 / 提示词辅助（英文软提示、润色标签）/
 * 阶段十五 Phase A2（助手 1~4 格结果网格、舞台工具镜像卡、单图聚焦面包屑与快捷胶囊）。
 *
 * 运行：$env:OFS_TEST_BUNDLE=".tmp/phase-a/build/timeline.js"; node test/check-client-chat.mjs
 */

import assert from 'node:assert/strict'
import { LIMITS } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'
import { assertStructure, collectText, findNodes, findClass, textareaOfClass, createTestClient } from './helpers/render.mjs'
import {
  NOW, at, preset, realvis, historyItem, readyState, probeOk, toolPreset, studioResponses,
} from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

// ── 对话确认卡 v2（0.10.0：摘要优先 / 张数 / 模型建议 / 带入参数面板 / 通用澄清） ──

/**
 * ChatPanel 的测试替身：领域对象最小化，动作只记录不执行。
 * 返回 client 供「点示例后重渲染」这类需要本地状态落地的用例继续驱动。
 */
async function mountChatPanel(options = {}) {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const calls = {
    edits: [],
    generated: [],
    handed: [],
    modes: [],
    toasts: [],
    resolved: [],
    locked: [],
    patches: [],
    applied: [],
    interpreted: [],
    cleared: [],
    // 阶段十五 Phase A2：结果网格钻取 / 单图聚焦快捷胶囊的调用记录。
    focused: [],
    opens: [],
    zooms: [],
    compares: [],
    rerolls: [],
    imageTools: [],
    backs: [],
    treeLoads: [],
  }
  const chat = {
    messages: options.messages ?? [],
    interpreting: Boolean(options.interpreting),
    interpret: (text) => calls.interpreted.push(text),
    updateIntentField: (id, field, value) => calls.edits.push({ id, field, value }),
    updateIntent: (id, patch) => calls.edits.push({ id, patch }),
    generateIntent: (message) => calls.generated.push(message),
    handoffIntent: (message) => {
      calls.handed.push(message)
      return options.handoffOk !== false
    },
    toggleIntentLockSeed: (id) => calls.locked.push(id),
    canLockSeed: options.canLockSeed !== false,
    resolveClarify: (id, option) => calls.resolved.push({ id, option }),
    newChat: () => calls.cleared.push(true),
    // 单图聚焦返回栈（缺省不聚焦）：渲染用例只关心视图与回调，栈语义在 chat-timeline 里测。
    focus: options.focus ?? null,
    focusDepth: options.focus ? 1 : 0,
    focusBackLabel: options.focusBackLabel ?? '',
    focusImage: (message, image, index) => calls.focused.push({
      messageId: message && message.id,
      path: image && image.path,
      index,
    }),
    focusBack: () => {
      calls.backs.push(true)
      return options.focusBackNext ?? null
    },
  }
  const t = client.internals.i18n.fallbackTranslate(options.locale ?? 'zh')
  try {
    const tree = await client.mountRaw(client.components.ChatPanel, {
      t,
      ui: {
        panelMode: 'chat',
        setPanelMode: (mode) => calls.modes.push(mode),
        showToast: (text) => calls.toasts.push(text),
        compareOpen: options.compareOpen === true,
        setCompareOpen: (value) => calls.compares.push(value),
        setZoom: (value) => calls.zooms.push(value),
      },
      form: {
        patchForm: (patch) => calls.patches.push(patch),
        negativeActive: options.negativeActive === true,
        ...(options.form ?? {}),
      },
      chat,
      library: {
        openMessage: (path) => calls.opens.push(path),
        gallery: options.gallery ?? [],
        items: options.items ?? [],
        selected: options.selected ?? null,
        // 版本树按需回填（测试默认只记录调用）；传 loadTree: null 可模拟旧宿主替身缺该函数。
        ...(options.loadTree === null ? {} : { loadTree: (root) => calls.treeLoads.push(root) }),
      },
      actions: {
        sending: Boolean(options.sending),
        reroll: (entry) => calls.rerolls.push(entry),
        openImageTool: (tool, entry) => calls.imageTools.push({ tool, entry }),
      },
    })
    return { client, tree, calls, t }
  } catch (error) {
    client.unmount()
    throw error
  }
}
await check('渲染：确认卡摘要优先、张数分段、模型建议与带入参数面板', async () => {
  const message = {
    id: 1,
    role: 'assistant',
    kind: 'intent',
    prompt: 'rainy night city street, wet pavement reflecting neon signs',
    summary: '雨夜城市街景，湿润路面倒映霓虹招牌',
    ratioId: '16:9',
    negative: 'blurry, low quality',
    count: 2,
    lockSeed: false,
    clarify: null,
    modelHint: { presetId: 'flux2-klein-4b', reason: '轻量快速，适合草稿' },
    source: 'model',
  }
  const mounted = await mountChatPanel({ messages: [message], negativeActive: true })
  try {
    const { tree, calls, t } = mounted
    const text = collectText(tree).join(' | ')
    // 摘要优先：中文摘要排在英文提示词之前；0.10.0 起不再有风格行。
    assert.ok(text.includes('雨夜城市街景，湿润路面倒映霓虹招牌'), '[intent] 应展示中文摘要')
    assert.ok(text.includes('中文摘要'), '[intent] 摘要应有中文标签')
    assert.ok(text.indexOf('雨夜城市街景，湿润路面倒映霓虹招牌') < text.indexOf('英文提示词'), '[intent] 中文摘要应排在英文提示词之前')
    assert.ok(text.includes('可直接修改后再生成'), '[intent] 应提示可在卡上直接微调')
    assert.ok(text.includes('更合适的模型：FLUX.2 Klein 4B（轻量快速，适合草稿）'), '[intent] 模型建议应带模型名与理由')
    assert.ok(text.includes('16:9'), '[intent] 元信息行应显示比例')
    assert.ok(!text.includes('风格'), '[intent] 0.10.0 起确认卡不再有风格行')
    // 英文提示词 / 排除项都可编辑，长度受契约限制。
    const promptArea = textareaOfClass(tree, 'ofs-intent-prompt')
    assert.ok(promptArea, '[intent] 缺少提示词文本域')
    assert.equal(promptArea.props.value, message.prompt)
    assert.equal(promptArea.props.maxLength, LIMITS.prompt.maxChars)
    assert.equal(promptArea.props['aria-label'], '英文提示词')
    const negativeArea = textareaOfClass(tree, 'ofs-intent-negative')
    assert.ok(negativeArea, '[intent] 负向词可用时应渲染排除项文本域')
    assert.equal(negativeArea.props.value, 'blurry, low quality')
    assert.equal(negativeArea.props.maxLength, LIMITS.negativePrompt.maxChars)
    // 张数：四格分段，当前值来自消息；点击把字段与新值交回 useChatThread。
    const qty = findClass(tree, 'ofs-intent-qty')
    assert.equal(qty.length, 1)
    assert.equal(qty[0].props.role, 'group')
    assert.equal(qty[0].props['aria-label'], '生成张数')
    const qtyOptions = findClass(tree, 'ofs-intent-qty-option')
    assert.equal(qtyOptions.length, 4, '[intent] 生成张数应为 1~4 四格')
    assert.deepEqual(qtyOptions.map((node) => collectText(node).join('')), ['1', '2', '3', '4'])
    assert.deepEqual(qtyOptions.map((node) => node.props['aria-pressed']), [false, true, false, false], '消息 count=2 时第二格高亮')
    qtyOptions[2].props.onClick()
    assert.deepEqual(calls.edits, [{ id: 1, field: 'count', value: 3 }], '[intent] 点张数应把字段与值交回 useChatThread')
    // 行内编辑回调带消息 id 与字段名；白名单校验与契约裁剪由 useChatThread 再做一次。
    promptArea.props.onChange({ target: { value: 'edited rainy street' } })
    negativeArea.props.onChange({ target: { value: 'blurry' } })
    assert.deepEqual(calls.edits.slice(1), [ { id: 1, field: 'prompt', value: 'edited rainy street' }, { id: 1, field: 'negative', value: 'blurry' }, ])
    // 主按钮「按此生成」提交当前消息；次级动作把确认卡写进参数面板并切模式 + 轻提示。
    const goButton = findClass(tree, 'ofs-intent-go')[0]
    assert.ok(goButton, '[intent] 缺少「按此生成」主按钮')
    assert.equal(collectText(goButton).join(''), '按此生成')
    assert.equal(goButton.props.disabled, false)
    goButton.props.onClick()
    assert.equal(calls.generated.length, 1, '[intent] 点「按此生成」应把确认卡交给 generateIntent')
    assert.equal(calls.generated[0].prompt, message.prompt)
    const handoffButton = findClass(tree, 'ofs-intent-handoff')[0]
    assert.ok(handoffButton, '[intent] 缺少「带入参数面板」次级动作')
    assert.equal(collectText(handoffButton).join(''), '带入参数面板')
    handoffButton.props.onClick()
    assert.equal(calls.handed.length, 1, '[intent] 点次级动作应把确认卡交给 handoffIntent')
    assert.deepEqual(calls.modes, ['form'], '[intent] 带入成功后应切回参数表单')
    assert.deepEqual(calls.toasts, [t('studio.chat.intent.handoffDone')], '[intent] 带入成功应给轻提示')
    // 「沿用上张构图（锁定种子）」保持：默认关闭、点一下把这张卡的 id 交回 hook。
    const lockBox = findNodes(tree, (node) => node.type === 'input' && node.props?.type === 'checkbox')[0]
    assert.ok(lockBox, '[intent] 缺少「沿用上张构图」开关')
    assert.equal(lockBox.props.checked, false, '[intent] 锁种开关默认关闭')
    lockBox.props.onChange()
    assert.deepEqual(calls.locked, [1])
    assertStructure('intent-card', tree, {
      required: {
        'ofs-intent': 1,
        'ofs-intent-title': 1,
        'ofs-intent-summary': 1,
        'ofs-intent-summary-label': 1,
        'ofs-intent-edit-hint': 1,
        'ofs-intent-field': 2,
        'ofs-intent-prompt': 1,
        'ofs-intent-negative': 1,
        'ofs-intent-meta': 1,
        'ofs-intent-model-hint': 1,
        'ofs-intent-qty': 1,
        'ofs-intent-qty-option': 4,
        'ofs-intent-lock': 1,
        'ofs-intent-actions': 1,
        'ofs-intent-go': 1,
        'ofs-intent-handoff': 1,
      },
      forbidden: ['ofs-intent-question', 'ofs-intent-clarify', 'ofs-intent-note', 'ofs-suggestions'],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：排除项按 negativeActive 显隐，本地兜底与空提示词状态', async () => {
  const base = {
    id: 2,
    role: 'assistant',
    kind: 'intent',
    prompt: 'rainy night city street',
    summary: '雨夜城市街景',
    ratioId: '',
    negative: 'blurry',
    count: 1,
    clarify: null,
    modelHint: null,
    source: 'model',
  }
  // 负向词不可用（CFG=0 的极速模型 / FLUX.2 等）：整行排除项与「排除项」文案都不渲染。
  const hidden = await mountChatPanel({ messages: [base], negativeActive: false })
  try {
    const text = collectText(hidden.tree).join(' | ')
    assert.ok(!text.includes('排除项'), '[intent] 负向词不可用时不应出现排除项文案')
    assertStructure('intent-negative-hidden', hidden.tree, {
      required: { 'ofs-intent-field': 1, 'ofs-intent-prompt': 1 },
      forbidden: ['ofs-intent-negative'],
    })
    // 没有模型建议时不渲染弱提示行。
    assert.equal(findClass(hidden.tree, 'ofs-intent-model-hint').length, 0)
  } finally {
    hidden.client.unmount()
  }
  // 本地兜底：prompt 与 summary 都是原文，不重复渲染摘要，改为标注「模型未响应」。
  const local = await mountChatPanel({ messages: [{ ...base, prompt: '雨夜街景', summary: '雨夜街景', negative: '', source: 'local' }], negativeActive: false })
  try {
    const text = collectText(local.tree).join(' | ')
    assert.ok(!text.includes('中文摘要'), '[intent] 原文兜底时不应重复显示摘要')
    assert.ok(text.includes('模型未响应'), '[intent] 本地兜底应说明来源')
    assertStructure('intent-local', local.tree, {
      required: { 'ofs-intent-note': 1 },
      forbidden: ['ofs-intent-summary', 'ofs-intent-summary-label'],
    })
  } finally {
    local.client.unmount()
  }
  // 提示词为空：主按钮与次级动作都禁用，避免一次注定被拒的宿主往返。
  const blank = await mountChatPanel({ messages: [{ ...base, prompt: '   ' }], negativeActive: true })
  try {
    assert.equal(findClass(blank.tree, 'ofs-intent-go')[0].props.disabled, true, '[intent] 空提示词时不应提交')
    assert.equal(findClass(blank.tree, 'ofs-intent-handoff')[0].props.disabled, true, '[intent] 空提示词时不能带入面板')
  } finally {
    blank.client.unmount()
  }
})

await check('渲染：通用澄清卡（问题 + 2~4 选项 + 先按当前设置）', async () => {
  const message = {
    id: 7,
    role: 'assistant',
    kind: 'intent',
    prompt: 'draft rainy street',
    summary: '',
    ratioId: '',
    negative: '',
    count: 1,
    clarify: { question: '想要横版还是竖版？', options: ['横版', '竖版'] },
    modelHint: null,
    source: 'model',
  }
  const mounted = await mountChatPanel({ messages: [message] })
  try {
    const { tree, calls } = mounted
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('想先确认一下'), '[clarify] 缺少标题')
    assert.ok(text.includes('想要横版还是竖版？'), '[clarify] 缺少问题')
    assert.ok(text.includes('先按当前设置'), '[clarify] 缺少「先按当前设置」')
    assert.ok(!text.includes('生成确认'), '[clarify] 澄清卡不应显示确认卡标题')
    const options = findClass(tree, 'ofs-suggestion')
    assert.deepEqual(options.map((node) => collectText(node).join('')), ['横版', '竖版', '先按当前设置'], '[clarify] 选项按钮顺序：宿主选项在前，「先按当前设置」在最后')
    options[0].props.onClick()
    assert.deepEqual(calls.resolved, [{ id: 7, option: '横版' }], '[clarify] 点选项应把选项交回 resolveClarify')
    options[2].props.onClick()
    assert.deepEqual(calls.resolved.at(-1), { id: 7, option: '' }, '[clarify] 「先按当前设置」用空串表示只清澄清')
    assertStructure('clarify-card', tree, {
      required: { 'ofs-intent': 1, 'ofs-intent-clarify': 1, 'ofs-intent-question': 1, 'ofs-suggestions': 1, 'ofs-suggestion': 3 },
      forbidden: ['ofs-intent-go', 'ofs-intent-handoff', 'ofs-intent-qty', 'ofs-intent-prompt', 'ofs-intent-negative'],
    })
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：空态示例只填对话草稿，不改参数表单', async () => {
  const mounted = await mountChatPanel({ messages: [] })
  try {
    const { client, calls, t } = mounted
    const examples = findClass(mounted.tree, 'ofs-chat-example')
    assert.equal(examples.length, 5, '[empty] 空态应给出五个灵感示例')
    examples[0].props.onClick()
    const tree = await client.rerenderRaw()
    const composer = findNodes(tree, (node) => node.type === 'textarea')[0]
    assert.equal(composer.props.value, t('studio.inspire.1'), '[empty] 点示例应把示例文案填进对话草稿')
    assert.equal(calls.patches.length, 0, '[empty] 点示例不应越过确认卡直接改参数表单')
  } finally {
    mounted.client.unmount()
  }
})
// 新建对话：清空线程与输入草稿；空线程时按钮禁用（没有可开启的新上下文）。
await check('渲染：新建对话清空线程与输入草稿', async () => {
  const mounted = await mountChatPanel({ messages: [{ id: 1, role: 'user', text: '画一只橘猫' }] })
  try {
    const { client, calls, t } = mounted
    const button = findClass(mounted.tree, 'ofs-chat-new')[0]
    assert.ok(button, '[new-chat] 缺少新建对话按钮')
    assert.equal(collectText(button).join(''), t('studio.chat.newChat'))
    assert.equal(collectText(button).join(''), '新建对话')
    assert.equal(button.props.disabled, false, '有消息时按钮可用')
    // 先在输入区写点草稿：新建对话后草稿也应清空。
    const composer = findNodes(mounted.tree, (node) => node.type === 'textarea')[0]
    composer.props.onChange({ target: { value: '还没发出去的话' } })
    const tree = await client.rerenderRaw()
    assert.equal(findNodes(tree, (node) => node.type === 'textarea')[0].props.value, '还没发出去的话')
    findClass(tree, 'ofs-chat-new')[0].props.onClick()
    assert.deepEqual(calls.cleared, [true], '点击应把「新建对话」交给 useChatThread')
    const after = await client.rerenderRaw()
    assert.equal(findNodes(after, (node) => node.type === 'textarea')[0].props.value, '', '新建对话应清空输入草稿')
  } finally {
    mounted.client.unmount()
  }
  const empty = await mountChatPanel({ messages: [] })
  try {
    const button = findClass(empty.tree, 'ofs-chat-new')[0]
    assert.equal(button.props.disabled, true, '空线程时按钮禁用')
    assert.ok(!collectText(empty.tree).join(' | ').includes('清空对话'), '旧「清空对话」文案应已移除')
  } finally {
    empty.client.unmount()
  }
})
// 阶段十五 Phase A2：助手完成气泡用 1~4 格缩略图网格展示全部结果图（不再只取首图）。
await check('渲染：助手完成气泡按 1~4 张渲染结果网格', async () => {
  const result = (name, seed) => ({
    path: `imagen-output/job-1/${name}`,
    file: name,
    url: `/imagen-api/file?path=imagen-output%2Fjob-1%2F${name}`,
    width: 1024,
    height: 1024,
    seed,
    seconds: 6.2,
  })
  const images = [result('01.png', 7), result('02.png', 8), result('03.png', 9), result('04.png', 10)]
  const done = {
    id: 10,
    role: 'assistant',
    kind: 'job',
    jobId: 'job-grid',
    stage: 'done',
    text: '已生成，点击缩略图放大。',
    images,
    image: images[0].url,
    imagePath: images[0].path,
    meta: '6.2 秒 · 种子 7',
  }
  const mounted = await mountChatPanel({ messages: [done] })
  try {
    const { tree, calls } = mounted
    // 4 张全部进网格：一个任务一张卡，不再截断成首图。
    assertStructure('result-grid-4', tree, {
      required: { 'ofs-msg-grid': 1, 'ofs-msg-grid-item': 4, 'ofs-msg-grid-label': 1 },
      forbidden: ['ofs-msg-thumb'],
    })
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('本次生成 4 张'), '[grid] 多图网格应标注本批张数')
    assert.equal(findNodes(tree, (node) => node.type === 'img').length, 4, '[grid] 4 张结果图都应渲染缩略图')
    // 点第 3 张：舞台切到该图（library.openMessage），并把聚焦意图交给 useChatThread。
    findClass(tree, 'ofs-msg-grid-item')[2].props.onClick()
    assert.deepEqual(calls.opens, [images[2].path], '[grid] 点网格图应调用 library.openMessage 切舞台')
    assert.deepEqual(calls.focused, [{ messageId: 10, path: images[2].path, index: 2 }], '[grid] 应把消息 / 图 / 序号交给单图聚焦')
  } finally {
    mounted.client.unmount()
  }
  // 单张：保持整宽单图观感（is-single），不显示张数标签。
  const single = await mountChatPanel({
    messages: [{ ...done, id: 11, images: [images[0]], image: images[0].url, imagePath: images[0].path }],
  })
  try {
    assertStructure('result-grid-1', single.tree, {
      required: { 'ofs-msg-grid': 1, 'ofs-msg-grid-item': 1 },
      forbidden: ['ofs-msg-grid-label'],
    })
    assert.ok(findClass(single.tree, 'ofs-msg-grid')[0].props.className.includes('is-single'), '[grid] 单张应带 is-single')
    single.tree && findClass(single.tree, 'ofs-msg-grid-item')[0].props.onClick()
    assert.deepEqual(single.calls.focused, [{ messageId: 11, path: images[0].path, index: 0 }])
  } finally {
    single.client.unmount()
  }
  // 0.13 及以前的记录只有首图 image / imagePath：升级后仍要显示成一张网格。
  const legacy = await mountChatPanel({
    messages: [{
      id: 12,
      role: 'assistant',
      kind: 'job',
      stage: 'done',
      text: '已生成，点击缩略图放大。',
      image: images[0].url,
      imagePath: images[0].path,
      meta: '6.2 秒 · 种子 7',
    }],
  })
  try {
    assertStructure('result-grid-legacy', legacy.tree, {
      required: { 'ofs-msg-grid': 1, 'ofs-msg-grid-item': 1 },
      forbidden: [],
    })
    const img = findNodes(legacy.tree, (node) => node.type === 'img')[0]
    assert.equal(img.props.src, images[0].url, '[grid] 旧记录应回退用 image 地址渲染')
  } finally {
    legacy.client.unmount()
  }
})

// 阶段十五 Phase A2：舞台图片工具动作镜像成一条独立卡片（底图缩略图 + 文案 + 可选强度）。
await check('渲染：舞台工具动作镜像记录卡', async () => {
  const toolMessage = {
    id: 20,
    role: 'user',
    kind: 'tool',
    tool: 'inpaint',
    text: '对当前图发起了局部涂抹',
    image: '/imagen-api/file?path=imagen-output%2Fbase%2F01.png',
    imagePath: 'imagen-output/base/01.png',
    width: 1024,
    height: 1024,
    strength: 0.8,
  }
  const mounted = await mountChatPanel({ messages: [toolMessage] })
  try {
    const { tree, calls } = mounted
    assertStructure('tool-sync', tree, {
      required: { 'ofs-tool-sync': 1, 'ofs-tool-sync-card': 1, 'ofs-tool-sync-title': 1, 'ofs-tool-sync-thumb': 1, 'ofs-tool-sync-chip': 1 },
      forbidden: ['ofs-msg--user', 'ofs-form-sync'],
    })
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('对当前图发起了局部涂抹'), '[tool] 应展示工具文案')
    assert.ok(text.includes('重绘强度 0.8'), '[tool] 有强度时应展示强度胶囊')
    findClass(tree, 'ofs-tool-sync-thumb')[0].props.onClick()
    assert.deepEqual(calls.opens, ['imagen-output/base/01.png'], '[tool] 点底图缩略图应切到该图')
  } finally {
    mounted.client.unmount()
  }
  // 整图重绘没有强度胶囊（body 缺 reference.strength 的镜像记录）。
  const img2img = await mountChatPanel({
    messages: [{ ...toolMessage, id: 21, tool: 'img2img', text: '对当前图发起了整图重绘', strength: undefined }],
  })
  try {
    assertStructure('tool-sync-img2img', img2img.tree, {
      required: { 'ofs-tool-sync': 1, 'ofs-tool-sync-title': 1 },
      forbidden: ['ofs-tool-sync-chip'],
    })
    assert.ok(collectText(img2img.tree).join(' | ').includes('对当前图发起了整图重绘'), '[tool] 整图重绘文案')
  } finally {
    img2img.client.unmount()
  }
})

// 阶段十五 Phase A2：单图聚焦视图 = 面包屑返回 + 大图 + 参数胶囊 + 快捷动作胶囊。
await check('渲染：单图聚焦的面包屑与快捷动作胶囊', async () => {
  const focusedImage = {
    path: 'imagen-output/job-1/02.png',
    file: '02.png',
    url: '/imagen-api/file?path=imagen-output%2Fjob-1%2F02.png',
    width: 1024,
    height: 1024,
    seed: 8,
    seconds: 6.2,
  }
  const parentImage = {
    path: 'imagen-output/base/01.png',
    file: '01.png',
    url: '/imagen-api/file?path=imagen-output%2Fbase%2F01.png',
    width: 1024,
    height: 1024,
  }
  const item = { jobId: 'job-1', prompt: '测试用的荷花池塘', sourceImage: parentImage.path, images: [focusedImage] }
  const focus = { messageId: 10, index: 1, count: 4, ...focusedImage }
  const mounted = await mountChatPanel({
    messages: [{ id: 10, role: 'assistant', kind: 'job', stage: 'done', text: '已生成，点击缩略图放大。', images: [focusedImage] }],
    focus,
    focusBackLabel: '4 张生成结果',
    gallery: [{ image: focusedImage, item }],
  })
  try {
    const { tree, calls } = mounted
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('← 返回上一层（4 张生成结果）'), '[focus] 面包屑应展示上一层（本批张数）')
    assert.ok(text.includes('单图聚焦'), '[focus] 应展示聚焦视图标题')
    assert.ok(!text.includes('已生成，点击缩略图放大。'), '[focus] 聚焦时不再渲染普通消息流')
    assertStructure('focus-view', tree, {
      required: {
        'ofs-chat-breadcrumb': 1,
        'ofs-chat-back': 1,
        'ofs-chat-focus': 1,
        'ofs-chat-focus-title': 1,
        'ofs-chat-focus-figure': 1,
        'ofs-chat-focus-meta': 1,
        'ofs-chat-focus-chip': 1,
        'ofs-chat-focus-actions': 1,
        'ofs-chat-focus-action': 4,
      },
      forbidden: ['ofs-msg-grid'],
    })
    const actions = findClass(tree, 'ofs-chat-focus-action')
    assert.deepEqual(actions.map((node) => collectText(node).join('')), ['对比原图', '继续涂抹', '重新生成', '查看大图'])
    // 对比原图：有 sourceImage 的派生版本才能开拉帘对比。
    actions[0].props.onClick()
    assert.deepEqual(calls.compares, [true], '[focus] 对比原图应打开舞台对比层')
    // 继续涂抹：以该图条目为底图打开图片工具。
    actions[1].props.onClick()
    assert.equal(calls.imageTools.length, 1, '[focus] 继续涂抹应调用 openImageTool')
    assert.equal(calls.imageTools[0].tool, 'inpaint')
    assert.equal(calls.imageTools[0].entry.image.path, focusedImage.path)
    assert.equal(calls.imageTools[0].entry.item.sourceImage, parentImage.path, '[focus] 应带完整条目（含 sourceImage）')
    // 重新生成：沿用该作品参数交给组合层 reroll。
    actions[2].props.onClick()
    assert.equal(calls.rerolls.length, 1, '[focus] 重新生成应调用 reroll')
    assert.equal(calls.rerolls[0].image.path, focusedImage.path)
    // 查看大图：确保舞台停在该图并打开放大层。
    actions[3].props.onClick()
    assert.deepEqual(calls.zooms, [true], '[focus] 查看大图应打开放大层')
    assert.equal(calls.opens.at(-1), focusedImage.path, '[focus] 查看大图前应把舞台切到该图')
  } finally {
    mounted.client.unmount()
  }
  // 返回上一层：逐层出栈由 useChatThread 负责；ChatPanel 把舞台切回上一层节点。
  const back = await mountChatPanel({
    focus,
    focusBackLabel: '4 张生成结果',
    gallery: [{ image: focusedImage, item }],
    focusBackNext: { ...parentImage, messageId: 9, index: 0, count: 2 },
  })
  try {
    findClass(back.tree, 'ofs-chat-back')[0].props.onClick()
    assert.deepEqual(back.calls.backs, [true], '[focus] 点面包屑应调用 focusBack')
    assert.equal(back.calls.opens.at(-1), parentImage.path, '[focus] 返回后舞台应切回上一层节点')
  } finally {
    back.client.unmount()
  }
  // 舞台停在别的图时点「对比原图」：先切回焦点图再打开对比（不开关错作品）；
  // 已停在焦点图且 compareOpen=true 时才关闭对比。
  const switched = await mountChatPanel({
    focus,
    focusBackLabel: '4 张生成结果',
    gallery: [{ image: focusedImage, item }],
    selected: { image: parentImage, item: { jobId: 'job-0', prompt: '原图', images: [parentImage] } },
    compareOpen: true,
  })
  try {
    findClass(switched.tree, 'ofs-chat-focus-action')[0].props.onClick()
    assert.equal(switched.calls.opens.at(-1), focusedImage.path, '[focus] 舞台停在别的作品时对比前先切回焦点图')
    assert.deepEqual(switched.calls.compares, [true], '[focus] 切回后应打开对比而非沿用旧图开关反转')
  } finally {
    switched.client.unmount()
  }
  const sameWork = await mountChatPanel({
    focus,
    focusBackLabel: '4 张生成结果',
    gallery: [{ image: focusedImage, item }],
    selected: { image: focusedImage, item },
    compareOpen: true,
  })
  try {
    findClass(sameWork.tree, 'ofs-chat-focus-action')[0].props.onClick()
    assert.equal(sameWork.calls.opens.length, 0, '[focus] 已在焦点图上时不再重复切换')
    assert.deepEqual(sameWork.calls.compares, [false], '[focus] 已在焦点图上再点对比原图应关闭')
  } finally {
    sameWork.client.unmount()
  }
  // 没有 sourceImage 的根图：不出现「对比原图」胶囊，其余动作仍在。
  const root = await mountChatPanel({
    focus,
    focusBackLabel: '4 张生成结果',
    gallery: [{ image: focusedImage, item: { ...item, sourceImage: null } }],
  })
  try {
    assertStructure('focus-view-root', root.tree, {
      required: { 'ofs-chat-focus-action': 3 },
      forbidden: [],
    })
    assert.ok(!collectText(root.tree).join(' | ').includes('对比原图'), '[focus] 根图不应提供对比原图')
  } finally {
    root.client.unmount()
  }
})

// 聚焦图不在已加载分页（/history 未刷新完成或超出分页）时：ChatPanel 按路径向作品库
// 请求版本树条目回填，避免「对比原图」消失、「重新生成」因缺提示词失败。
await check('渲染：聚焦图不在已加载分页时按需回填版本树条目', async () => {
  const focusedImage = {
    path: 'imagen-output/20261109-122000-job-late/01.png',
    url: '/imagen-api/file?path=late-01',
    width: 1024,
    height: 1024,
    seed: 21,
    seconds: 6.2,
  }
  const focus = { messageId: 20, index: 0, count: 1, ...focusedImage }

  // 1) 路径不在 gallery / items：挂载后按聚焦路径触发一次 loadTree。
  const missing = await mountChatPanel({
    focus,
    focusBackLabel: '1 张生成结果',
    gallery: [],
    items: [],
  })
  try {
    assert.deepEqual(missing.calls.treeLoads, [focusedImage.path], '[backfill] 应按聚焦路径请求版本树条目')
    // 条目仍缺失期间（回填在途）：快捷动作照常渲染，对比按钮按无 sourceImage 处理。
    assertStructure('focus-backfill-pending', missing.tree, {
      required: { 'ofs-chat-focus-action': 3 },
      forbidden: [],
    })
  } finally {
    missing.client.unmount()
  }

  // 2) 条目已在已加载分页：不再请求版本树。
  const item = { jobId: 'job-late', prompt: '新完成的任务', sourceImage: null, images: [focusedImage] }
  const found = await mountChatPanel({
    focus,
    focusBackLabel: '1 张生成结果',
    gallery: [{ image: focusedImage, item }],
    items: [item],
  })
  try {
    assert.deepEqual(found.calls.treeLoads, [], '[backfill] 条目已在已加载分页时不再请求')
  } finally {
    found.client.unmount()
  }

  // 3) 旧宿主替身没有 loadTree：安全降级，不抛错（回到栈项兜底行为）。
  const legacy = await mountChatPanel({
    focus,
    focusBackLabel: '1 张生成结果',
    gallery: [],
    items: [],
    loadTree: null,
  })
  try {
    assert.deepEqual(legacy.calls.treeLoads, [])
    assert.ok(collectText(legacy.tree).join(' | ').includes('单图聚焦'), '[backfill] 旧宿主下聚焦视图照常渲染')
  } finally {
    legacy.client.unmount()
  }
})

// 意图 v2 的真实状态流转：直接挂载 useChatThread，断言请求参数、消息字段、
// 张数钳制、负向词门控、多轮 history、通用澄清与带入参数面板。
await check('渲染：意图 v2 状态流（cfg / history / 张数 / 负向词门控 / 澄清 / 带入面板）', async () => {
  const responses = {
    '/imagen-api/intent': {
      ok: true,
      source: 'model',
      prompt: 'rainy night city street, wet pavement reflecting neon signs',
      summary: '雨夜城市街景，湿润路面倒映霓虹招牌',
      ratioId: '16:9',
      negative: 'blurry, low quality',
      clarify: null,
      modelHint: { presetId: 'flux2-klein-4b', reason: '轻量快速，适合草稿' },
    },
  }
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const { useChatThread } = client.hooks
  const t = client.internals.i18n.fallbackTranslate('zh')
  const latest = { chat: null }
  const calls = { generates: [], patches: [], applied: [] }
  const form = {
    form: { negative: 'blurry', seed: '', presetId: 'sdxl-lightning', cfg: 7 },
    negativeActive: true,
    patchForm: (patch) => calls.patches.push(patch),
    applyIntent: (message) => { calls.applied.push(message); return true },
  }
  function Harness(props) {
    const chat = useChatThread({
      t,
      isEn: false,
      alive: async (promise) => promise,
      state: { lastJob: null },
      form,
      generate: async (overrides) => calls.generates.push(overrides),
    })
    props.latest.chat = chat
    React.useEffect(() => {
      chat.interpret('画一张横版雨夜街景')
    }, [])
    return h('div', { className: 'ofs-intent-harness' }, String(chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, { latest })
    await client.settle()
    // 请求带表单当前 CFG 与预设；首轮还没有多轮上下文，不发空 history。
    const firstRequest = client.requests.find((item) => item.path === '/imagen-api/intent')
    assert.equal(firstRequest.body.text, '画一张横版雨夜街景')
    assert.equal(firstRequest.body.cfg, 7, '请求必须带表单当前 CFG')
    assert.equal(firstRequest.body.presetId, 'sdxl-lightning')
    assert.equal(firstRequest.body.locale, 'zh')
    assert.equal(Object.prototype.hasOwnProperty.call(firstRequest.body, 'history'), false, '首轮没有历史时不应发送空 history')
    // 消息字段 v2：没有 styleId，新增 count / modelHint 等。
    const intent = latest.chat.messages[1]
    assert.equal(intent.kind, 'intent')
    assert.equal(intent.prompt, responses['/imagen-api/intent'].prompt)
    assert.equal(intent.summary, '雨夜城市街景，湿润路面倒映霓虹招牌')
    assert.equal(intent.ratioId, '16:9')
    assert.equal(intent.negative, 'blurry, low quality')
    assert.equal(intent.count, 1, '宿主没给张数时默认 1')
    assert.equal(intent.clarify, null)
    assert.deepEqual(intent.modelHint, { presetId: 'flux2-klein-4b', reason: '轻量快速，适合草稿' })
    assert.equal(intent.source, 'model')
    assert.equal(Object.prototype.hasOwnProperty.call(intent, 'styleId'), false, '意图消息不应再有 styleId')
    // 张数行内编辑：钳制 1~4，非法值回落 1。
    latest.chat.updateIntentField(intent.id, 'count', 3)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages[1].count, 3)
    latest.chat.updateIntentField(intent.id, 'count', 9)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages[1].count, 4, '超过上限应钳制到 4')
    latest.chat.updateIntentField(intent.id, 'count', 0)
    await client.rerenderRaw()
    assert.equal(latest.chat.messages[1].count, 1, '低于下限应钳制到 1')
    latest.chat.updateIntentField(intent.id, 'count', 2)
    await client.rerenderRaw()
    // 按此生成：提示词 / 张数 / 比例尺寸 / 排除项进入覆盖项，并回填表单。
    await latest.chat.generateIntent(latest.chat.messages[1])
    assert.deepEqual(calls.generates, [{ prompt: 'rainy night city street, wet pavement reflecting neon signs', count: 2, negativePrompt: 'blurry, low quality', width: 1280, height: 720 }], '生成覆盖项应带编辑后的张数与比例尺寸')
    assert.deepEqual(calls.patches.at(-1), { prompt: 'rainy night city street, wet pavement reflecting neon signs', count: 2, width: 1280, height: 720, negative: 'blurry, low quality' }, '确认卡参数应回填表单')
    // negativeActive=false（CFG=0 或模型不支持负向词）：覆盖项置空串，表单也不写 negative。
    form.negativeActive = false
    await latest.chat.generateIntent(latest.chat.messages[1])
    assert.equal(calls.generates.at(-1).negativePrompt, '', '负向词不可用时提交空串')
    assert.equal(Object.prototype.hasOwnProperty.call(calls.patches.at(-1), 'negative'), false, '负向词不可用时不应写进表单')
    form.negativeActive = true
    // 第二轮：history 同时包含用户原话与上一张卡片的英文提示词；宿主给通用澄清。
    responses['/imagen-api/intent'] = {
      ok: true,
      source: 'model',
      prompt: 'draft of the next scene',
      summary: '下一幕草稿',
      ratioId: '1:1',
      negative: '',
      clarify: { question: '横版还是竖版？', options: ['横版', '竖版'] },
      modelHint: null,
    }
    await latest.chat.interpret('再画一版')
    await client.settle()
    await client.rerenderRaw()
    const secondRequest = client.requests.filter((item) => item.path === '/imagen-api/intent').at(-1)
    assert.deepEqual(secondRequest.body.history, [ { role: 'user', content: '画一张横版雨夜街景' }, { role: 'assistant', content: 'rainy night city street, wet pavement reflecting neon signs' }, ], 'history 应带上一轮用户原话与英文提示词')
    const clarifyCard = latest.chat.messages.at(-1)
    assert.ok(clarifyCard.clarify, '应生成通用澄清卡')
    assert.deepEqual(clarifyCard.clarify, { question: '横版还是竖版？', options: ['横版', '竖版'] })
    // 点选项：旧澄清卡被替换，选项作为用户消息进入下一轮，history 带上该卡草稿提示词。
    const clarifyCount = latest.chat.messages.length
    latest.chat.resolveClarify(clarifyCard.id, '横版')
    await client.settle()
    await client.rerenderRaw()
    const afterResolve = latest.chat.messages
    assert.equal(afterResolve.some((message) => message.id === clarifyCard.id), false, '选完选项后旧澄清卡应被新一轮结果替换')
    assert.equal(afterResolve.length, clarifyCount + 1, '旧卡移除后新增一条用户消息与一张确认卡')
    assert.equal(afterResolve.at(-2).role, 'user')
    assert.equal(afterResolve.at(-2).text, '横版')
    const thirdRequest = client.requests.filter((item) => item.path === '/imagen-api/intent').at(-1)
    assert.equal(thirdRequest.body.text, '横版', '点选项应以选项文本重新解析')
    assert.deepEqual(thirdRequest.body.history.at(-1), { role: 'assistant', content: 'draft of the next scene\n[Clarify] 横版还是竖版？' }, '重新解析要带上该卡草稿提示词与澄清问题')
    // 「先按当前设置」：只清澄清、不发解析请求，卡片还原为确认卡。
    responses['/imagen-api/intent'] = {
      ok: true,
      source: 'model',
      prompt: 'draft two',
      summary: '',
      ratioId: '',
      negative: '',
      clarify: { question: '要写实还是插画？', options: ['写实', '插画'] },
      modelHint: null,
    }
    await latest.chat.interpret('再来一版')
    await client.settle()
    await client.rerenderRaw()
    const secondClarify = latest.chat.messages.at(-1)
    assert.ok(secondClarify.clarify, '应再次得到澄清卡')
    const requestsBeforeKeep = client.requests.filter((item) => item.path === '/imagen-api/intent').length
    latest.chat.resolveClarify(secondClarify.id, '')
    await client.rerenderRaw()
    const restored = latest.chat.messages.find((message) => message.id === secondClarify.id)
    assert.ok(restored && restored.clarify === null, '空选项只清澄清、还原成确认卡')
    assert.equal(client.requests.filter((item) => item.path === '/imagen-api/intent').length, requestsBeforeKeep, '「先按当前设置」不应再发解析请求')
    // 带入参数面板：转交 form.applyIntent 并把成功与否原样返回。
    assert.equal(latest.chat.handoffIntent(latest.chat.messages.at(-1)), true)
    assert.equal(calls.applied.at(-1).prompt, latest.chat.messages.at(-1).prompt)
    form.applyIntent = () => false
    assert.equal(latest.chat.handoffIntent(latest.chat.messages.at(-1)), false, '表单拒收时应返回 false')
  } finally {
    client.unmount()
  }
})
// 新建对话的代次守卫：解析中的旧请求返回后绝不能写进新线程。
await check('渲染：新建对话丢弃解析中的旧请求结果', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const React = client.react
  const h = React.createElement
  const { useChatThread } = client.hooks
  const t = client.internals.i18n.fallbackTranslate('zh')
  const latest = { chat: null }
  // alive 由测试决定何时放行，模拟「请求还在路上」。
  const pending = []
  function alive(promise) {
    // 真实请求照常发出（fake fetch 立即返回），但 hook 等待的是这里手控的 Promise。
    Promise.resolve(promise).catch(() => {})
    return new Promise((resolve) => pending.push(resolve))
  }
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
      alive,
      state: { lastJob: null },
      form,
      generate: async () => {},
    })
    props.latest.chat = chat
    return h('div', { className: 'ofs-newchat-harness' }, String(chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, { latest })
    await client.settle()
    latest.chat.interpret('旧主题的请求')
    await client.rerenderRaw()
    assert.equal(latest.chat.interpreting, true, '解析中应显示解析状态')
    assert.equal(latest.chat.messages.length, 1, '解析中先落一条用户消息')
    // 解析中点新建对话：线程清空、解析态就地复位，不必等旧请求回来。
    latest.chat.newChat()
    await client.rerenderRaw()
    assert.equal(latest.chat.messages.length, 0, '新建对话应清空线程')
    assert.equal(latest.chat.interpreting, false, '新建对话应复位解析中状态')
    // 旧请求现在才返回：结果整条丢弃，不改新线程。
    pending[0]({
      ok: true,
      data: {
        prompt: 'stale prompt',
        summary: '旧主题',
        ratioId: '1:1',
        negative: '',
        clarify: null,
        modelHint: null,
        source: 'model',
      },
    })
    await client.settle()
    await client.rerenderRaw()
    assert.equal(latest.chat.messages.length, 0, '旧请求返回不得写入新线程')
    assert.equal(latest.chat.interpreting, false, '旧请求不得把新线程重新标记为解析中')
    // 新线程继续可用：下一次解析正常落地。
    latest.chat.interpret('新主题')
    await client.rerenderRaw()
    assert.equal(pending.length, 2, '新线程应能再次发起解析')
    pending[1]({
      ok: true,
      data: {
        prompt: 'fresh prompt',
        summary: '新主题',
        ratioId: '',
        negative: '',
        clarify: null,
        modelHint: null,
        source: 'model',
      },
    })
    await client.settle()
    await client.rerenderRaw()
    const messages = latest.chat.messages
    assert.equal(messages.length, 2, '新线程应有用户消息 + 确认卡')
    assert.equal(messages[0].text, '新主题')
    assert.equal(messages[1].kind, 'intent')
    assert.equal(messages[1].prompt, 'fresh prompt')
  } finally {
    client.unmount()
  }
})
// 带入参数面板的端到端粘合：useChatThread.handoffIntent → useStudioForm.applyIntent，
// 确认卡内容真的写进工作台表单（而不是只在 ChatPanel 的测试替身里记录）。
await check('渲染：带入参数面板写入真实表单（useStudio + handoffIntent）', async () => {
  const responses = {
    '/imagen-api/state': {
      defaultPreset: 'realvis-v5',
      presets: [realvis, preset],
      session: { state: 'ready', modelId: 'realvis-v5', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
      jobs: [],
      lastJob: null,
      probe: probeOk,
    },
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
  }
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({
      t: client.internals.i18n.fallbackTranslate('zh'),
    })
    latest.studio = studio
    return h('div', { className: 'ofs-handoff-harness' }, String(studio.form.form.count))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    // 初始预设同步为 realvis：CFG 5 > 0 且带推荐负向词，排除项可用。
    assert.equal(latest.studio.form.form.presetId, 'realvis-v5')
    assert.equal(latest.studio.form.negativeActive, true)
    const message = { prompt: '  rainy street, neon lights  ', ratioId: '16:9', negative: 'blurry', count: 3, kind: 'intent' }
    assert.equal(latest.studio.chat.handoffIntent(message), true, '带入成功应返回 true')
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.prompt, 'rainy street, neon lights', '提示词去空白后写入表单')
    assert.equal(latest.studio.form.form.width, 1280, '比例换算成宽高')
    assert.equal(latest.studio.form.form.height, 720)
    assert.equal(latest.studio.form.form.count, 3, '张数写入表单')
    assert.equal(latest.studio.form.form.negative, 'blurry', '负向词可用时写入表单')
    // 空提示词：不写表单、返回 false（ChatPanel 据此不切面板、不提示成功）。
    const before = JSON.stringify(latest.studio.form.form)
    assert.equal(latest.studio.chat.handoffIntent({ prompt: '   ', ratioId: '1:1', count: 2 }), false)
    await client.rerenderRaw()
    assert.equal(JSON.stringify(latest.studio.form.form), before, '空提示词不应改动表单')
  } finally {
    client.unmount()
  }
})
// 助手确认卡覆写表单时的状态协同：已有作品脏草稿应先托管、且清掉旧的「正在微调」来源标记。
await check('渲染：助手生成/带入先托管左栏脏草稿并清除旧 origin', async () => {
  const workA = {
    jobId: 'job-a',
    prompt: 'A 的荷花池塘',
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    params: { prompt: 'A 的荷花池塘', width: 1024, height: 1024, steps: 4, cfg: 0, seed: 7 },
    images: [{ path: 'imagen-output/job-a/01.png', file: '01.png', url: '/imagen-api/file?path=a', width: 1024, height: 1024, seed: 7 }],
  }
  const responses = studioResponses(readyState, { items: [workA] }, { '/imagen-api/generate': { id: 'job-b', status: 'queued' } })
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-chat-draft-harness' }, studio.form.form.prompt)
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    // 选中作品 A 并改写提示词形成未提交脏修改。
    latest.studio.actions.previewWork({ image: workA.images[0], item: workA })
    await client.rerenderRaw()
    assert.equal(latest.studio.form.origin && latest.studio.form.origin.path, workA.images[0].path)
    latest.studio.form.patchForm({ prompt: 'A 改到一半的草稿' })
    await client.rerenderRaw()
    assert.equal(latest.studio.form.dirty, true)
    // 点助手「按此生成」：旧脏修改应先托管到草稿卡，不再被覆盖丢弃；旧 origin 清空。
    await latest.studio.chat.generateIntent({ prompt: 'neon alley in rain', ratioId: '16:9', count: 1 })
    await client.settle()
    await client.rerenderRaw()
    assert.equal(latest.studio.form.form.prompt, 'neon alley in rain')
    assert.equal(latest.studio.form.origin, null, '助手确认卡覆写后不应残留旧作品「正在微调」')
    assert.equal(latest.studio.form.tuning, null)
    assert.equal(latest.studio.form.draft && latest.studio.form.draft.form.prompt, 'A 改到一半的草稿', '原左栏未提交修改应托管进草稿卡')
    // 点回草稿卡后 draftEditing 暴露为 true，再切换到空白新建时也能感知草稿编辑态。
    assert.equal(latest.studio.form.openDraft(), true)
    await client.rerenderRaw()
    assert.equal(latest.studio.form.draftEditing, true, 'openDraft 后 draftEditing 必须暴露为 true')
  } finally {
    client.unmount()
  }
})
// 表单提交同步进助手：除提示词外带结构化参数摘要，且这类记录不进入意图上下文。
await check('渲染：表单提交同步进助手带参数摘要且不进意图上下文', async () => {
    const responses = studioResponses(readyState, { items: [] }, { '/imagen-api/generate': { id: 'job-sync', status: 'queued' } })
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-sync-harness' }, String(studio.chat.messages.length))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    latest.studio.form.patchForm({ prompt: '雨夜街景', width: 1280, height: 720, count: 2, seed: '42' })
    await client.rerenderRaw()
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    const messages = latest.studio.chat.messages
    const sync = messages.find((message) => message.kind === 'form')
    assert.ok(sync, '生成提交后应在助手线程里留下参数摘要记录')
    assert.equal(sync.role, 'user', '参数摘要记录挂在用户侧（但带 kind 以示区分）')
    assert.equal(sync.source, 'form', '表单提交的来源标记')
    assert.equal(sync.text, '雨夜街景')
    assert.deepEqual(sync.summary, { presetId: 'sdxl-lightning', ratioId: '16:9', width: 1280, height: 720, count: 2, seed: 42 }, '参数摘要应覆盖模型 / 比例像素 / 张数 / 种子策略（主表单固定纯文生图，不再有参考图字段）')
    const syncIndex = messages.indexOf(sync)
    assert.equal(messages[syncIndex + 1] && messages[syncIndex + 1].kind, 'job', '先参数摘要、后任务气泡')
    // 上下文隔离：参数摘要与任务气泡都不能进意图模型的多轮历史。
    assert.deepEqual(client.PURE.intentHistory(messages), [], '表单同步记录不得进入 intentHistory')
  } finally {
    client.unmount()
  }
})
// 参数摘要的界面呈现：白卡 + 胶囊，与普通用户气泡结构不同；中英文都可用。
await check('渲染：表单同步记录用参数胶囊与普通用户气泡区分', async () => {
  const syncMessage = {
    id: 1,
    role: 'user',
    kind: 'form',
    source: 'form',
    text: '雨夜街景',
    summary: {
      presetId: 'sdxl-lightning',
      ratioId: '16:9',
      width: 1280,
      height: 720,
      count: 2,
      seed: 42,
    },
  }
  const mounted = await mountChatPanel({ messages: [syncMessage, { id: 2, role: 'user', text: '再亮一点' }] })
  try {
    const { tree } = mounted
    assertStructure('form-sync', tree, {
      required: {
        'ofs-form-sync': 1,
        'ofs-form-sync-card': 1,
        'ofs-form-sync-title': 1,
        'ofs-form-sync-prompt': 1,
        'ofs-form-sync-chips': 1,
        // 模型 / 比例像素 / 张数 / 种子：主表单纯文生图后不再有「参考图」胶囊。
        'ofs-form-sync-chip': 4,
        'ofs-msg--user': 1,
      },
      forbidden: [],
    })
    const text = collectText(tree).join(' | ')
    for (const needle of [
      '来自参数表单',
      '雨夜街景',
      'SDXL Lightning',
      '16:9 · 1280 × 720',
      '2 张',
      '种子 42',
      '再亮一点',
    ]) {
      assert.ok(text.includes(needle), `[form-sync] 缺少：${needle}`)
    }
    assert.ok(!text.includes('含参考图') && !text.includes('文生图'), '主表单固定纯文生图，不再显示参考图胶囊')
    // 普通用户消息仍走气泡结构，不能被参数卡片吞掉。
    assert.equal(findClass(tree, 'ofs-msg--user').length, 1)
  } finally {
    mounted.client.unmount()
  }
  // 变体提交：标题与「随机种子」胶囊正确，且没有参考图胶囊。
  const variant = await mountChatPanel({
    messages: [{
      id: 3,
      role: 'user',
      kind: 'form',
      source: 'variant',
      text: '荷花池塘',
      summary: { presetId: 'sdxl-lightning', ratioId: '1:1', width: 1024, height: 1024, count: 1, seed: null },
    }],
  })
  try {
    const text = collectText(variant.tree).join(' | ')
    assert.ok(text.includes('生成变体'), '[form-sync] 变体提交应有独立标题')
    assert.ok(text.includes('随机种子'), '[form-sync] 无固定种子时应标注随机种子')
    assert.ok(text.includes('1024 × 1024'), '[form-sync] 自定义画幅只显示像素')
    assert.ok(!text.includes('文生图'), '[form-sync] 变体同样不再显示参考图胶囊')
  } finally {
    variant.client.unmount()
  }
})
// 等待出图期间继续改表单：这些改动没有提交，生成成功也不能把它们洗成「干净」。
await check('渲染：生成等待期间的手动修改仍算脏', async () => {
    const responses = studioResponses(readyState, { items: [] }, { '/imagen-api/generate': { id: 'job-wait', status: 'queued' } })
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-wait-harness' }, String(studio.form.dirty))
  }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    latest.studio.form.patchForm({ prompt: '第一版提示词' })
    await client.rerenderRaw()
    assert.equal(latest.studio.form.dirty, true)
    // 不 await：先让请求在路上，再模拟用户在等待期间继续输入。
    const pending = latest.studio.actions.generate()
    latest.studio.form.patchForm({ prompt: '等待期间的新草稿' })
    await client.rerenderRaw()
    const ok = await pending
    await client.settle()
    await client.rerenderRaw()
    assert.equal(ok, true, '生成应成功')
    assert.equal(latest.studio.form.form.prompt, '等待期间的新草稿', '等待期间的输入不能被回滚')
    assert.equal(latest.studio.form.dirty, true, '等待期间的修改没有提交，仍应算脏')
  } finally {
    client.unmount()
  }
})
// 胶卷点击的双向同步（阶段十五 Phase A1）：干净表单直接回填（含原图 seed）；
// 脏表单先托管进草稿卡再回填被点作品，并提示「已保留当前草稿」；
// 新建创作清掉绑定上一张作品的状态，但保留当前模型预设与画幅比例。
// 0.13.0：参考图 / 蒙版已迁到舞台图片工具，这里只验证纯文生图字段与草稿保护。
await check('渲染：胶卷点击回填参数、草稿托管与新建创作边界', async () => {
  const state = {
    defaultPreset: 'sdxl-lightning',
    presets: [toolPreset],
    session: { state: 'ready', modelId: 'sdxl-lightning', device: 'Tesla T4', idleTimeoutSec: 1800, error: null },
    jobs: [],
    lastJob: null,
    probe: probeOk,
  }
    const responses = studioResponses(state, { items: [historyItem] }, { '/imagen-api/generate': { id: 'job-flow', status: 'queued' } })
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  const React = client.react
  const h = React.createElement
  const latest = {}
  function Harness() {
    const studio = client.hooks.useStudio({ t: client.internals.i18n.fallbackTranslate('zh') })
    latest.studio = studio
    return h('div', { className: 'ofs-flow-harness' }, String(studio.form.dirty))
  }
  const form = () => latest.studio.form
  const thumbB = { image: historyItem.images[1], item: historyItem }
  try {
    await client.mountRaw(Harness, {})
    await client.settle()
    assert.equal(form().dirty, false, '刚打开时表单是干净的')
    assert.equal(form().form.presetId, 'sdxl-lightning', '初始预设应已同步')
    // 手动改提示词但不点生成 → dirty。
    form().patchForm({ prompt: '我自己的草稿' })
    await client.rerenderRaw()
    assert.equal(form().dirty, true, '手动修改后应标记为脏')
    // 脏时点胶卷：预览照常切换；未提交修改先托管进草稿卡，再回填被点作品（§6.1.3）。
    latest.studio.actions.previewWork(thumbB)
    await client.rerenderRaw()
    assert.equal(latest.studio.library.selected.image.path, thumbB.image.path, '预览应切到被点的图')
    assert.equal(form().form.prompt, '测试用的荷花池塘', '脏表单先托管草稿，再回填被点作品的参数')
    assert.equal(form().dirty, false, '回填后表单是干净基准')
    assert.ok(form().draft && form().draft.form.prompt === '我自己的草稿', '未提交修改应被托管进草稿卡')
    assert.equal(form().draftView && form().draftView.parked, true, '草稿卡应显示已托管草稿')
    assert.ok(latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已保留当前草稿'), '托管草稿应提示「已保留当前草稿」')
    // 生成提交成功后表单回到干净状态（干净基准更新到刚提交的内容），草稿随提交清空。
    await latest.studio.actions.generate()
    await client.settle()
    await client.rerenderRaw()
    assert.equal(form().dirty, false, '刚生成完应回到干净状态')
    assert.equal(form().draft, null, '提交成功后草稿卡应清空')
    // 干净时再点胶卷：完整回填该作品参数，保留原图 seed。
    latest.studio.actions.previewWork(thumbB)
    await client.rerenderRaw()
    assert.equal(form().form.prompt, '测试用的荷花池塘', '提示词来自作品')
    assert.equal(form().form.width, 1024, '尺寸用产物像素')
    assert.equal(form().form.height, 1024)
    assert.equal(form().form.steps, 4, '没有 params 时回落到预设推荐值')
    assert.equal(form().form.cfg, 0)
    assert.equal(form().form.presetId, 'sdxl-lightning', '预设来自作品')
    assert.equal(form().form.seed, '8', '无有效 seed 才随机；有则保留原图 seed')
    assert.equal('reference' in form().form, false, '主表单不再持有参考图字段')
    assert.equal('strength' in form().form, false, '主表单不再持有重绘强度字段')
    assert.equal(form().tuning && form().tuning.prompt, '测试用的荷花池塘', '面板应记录微调来源')
    assert.equal(form().dirty, false, '回填后仍是干净状态')
    assert.ok(latest.studio.ui.toast && latest.studio.ui.toast.text.includes('参数已回填'), '回填成功应给轻提示')
    // 新建创作：清提示词 / 固定 seed，负向层回到当前预设默认，保留模型与画幅。
    form().applyRatio('16:9')
    await client.rerenderRaw()
    assert.equal(form().form.width, 1280)
    form().newCreation()
    await client.rerenderRaw()
    assert.equal(form().form.prompt, '', '新建创作清空提示词')
    assert.equal(form().form.seed, '', '新建创作把种子恢复为随机')
    assert.equal('reference' in form().form, false, '新建创作不再处理参考图')
    assert.equal('strength' in form().form, false, '新建创作不再处理重绘强度')
    assert.equal(form().form.negative, '', 'CFG=0 的预设默认不启用负向词')
    assert.deepEqual(form().form.negativeLayers, { model: '', user: '' })
    assert.equal(form().form.presetId, 'sdxl-lightning', '保留当前模型预设')
    assert.equal(form().form.width, 1280, '保留当前画幅比例（宽）')
    assert.equal(form().form.height, 720, '保留当前画幅比例（高）')
    assert.equal(form().tuning, null, '清除微调来源标记')
    assert.equal(form().dirty, false, '新建创作后是干净状态')
    assert.ok(latest.studio.ui.toast && latest.studio.ui.toast.text.includes('已开始新的创作'), '新建创作应给轻提示')
  } finally {
    client.unmount()
  }
})
// 胶片条缩略图点击要交给组合层：换预览 + （表单干净时）回填参数；没有该动作时退回纯选图。
await check('渲染：胶片条缩略图点击交由组合层回填参数', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const picked = []
  const tree = await client.mountRaw(client.components.Filmstrip, {
    t: client.internals.i18n.fallbackTranslate('zh'),
    ui: { setView: () => {} },
    compute: { pendingJobs: [], sessionState: 'ready', startSession: () => {}, status: { stopped: false }, cancellingIds: [] },
    // 阶段十三：作品条按根树折叠，测试替身给原始历史条目（Filmstrip 会用 buildLineage 兜底建索引）。
    library: {
      items: [{
        jobId: 'job-thumb',
        dir: 'imagen-output/20261109-120000-job-thumb',
        prompt: '作品提示词',
        presetId: 'sdxl-lightning',
        finishedAt: at(-10),
        images: [{ path: 'imagen-output/a/01.png', file: '01.png', url: '/imagen-api/file?path=a', width: 1024, height: 1024 }],
      }],
      selected: null,
      selectImage: () => picked.push('selectImage'),
    },
    actions: { previewWork: (entry) => picked.push(entry.image.path) },
    now: NOW,
  })
  client.unmount()
  const thumb = findNodes(tree, (node) => node.type === 'button' && typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes('ofs-thumb') )[0]
  assert.ok(thumb, '缺少胶卷缩略图按钮')
  thumb.props.onClick()
  assert.deepEqual(picked, ['imagen-output/a/01.png'], '有 previewWork 时应交给组合层（换预览 + 回填参数）')
})
// 意图纯函数：多轮历史裁剪、通用澄清与模型建议归一；不依赖 React，离线断言。
await check('渲染：意图纯函数（history / 澄清 / 模型建议归一）', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  try {
    const pure = client.PURE
    const messages = []
    for (let index = 0; index < 8; index += 1) {
      messages.push({ id: index * 2 + 1, role: 'user', text: `第 ${index} 句` })
      messages.push({
        id: index * 2 + 2,
        role: 'assistant',
        kind: 'intent',
        prompt: `prompt ${index}`,
        summary: `摘要 ${index}`,
      })
    }
    messages.push({ id: 99, role: 'assistant', kind: 'job', text: '正在生成…' })
    const history = pure.intentHistory(messages)
    assert.equal(history.length, LIMITS.intentHistory.maxMessages, 'history 只保留最近 12 条')
    assert.deepEqual(history[0], { role: 'user', content: '第 2 句' })
    assert.deepEqual(history.at(-1), { role: 'assistant', content: 'prompt 7' })
    assert.equal(history.some((item) => item.content.includes('正在生成')), false, '任务气泡不进上下文')
    // 表单提交同步记录（kind='form'）只是界面展示，不进入意图上下文。
    assert.deepEqual(
      pure.intentHistory([
        { role: 'user', text: '画一只橘猫' },
        { role: 'user', kind: 'form', text: '另一个题材的提示词', summary: { presetId: 'sdxl-lightning' } },
        { role: 'assistant', kind: 'intent', prompt: 'an orange cat' },
      ]),
      [
        { role: 'user', content: '画一只橘猫' },
        { role: 'assistant', content: 'an orange cat' },
      ],
      '表单提交同步记录不进意图上下文',
    )
    assert.deepEqual(
      pure.intentHistory([
        { role: 'user', text: '画一只橘猫' },
        {
          role: 'assistant',
          kind: 'intent',
          prompt: 'an orange cat',
          clarify: { question: '想要什么场景和光线？', options: ['窗边午后阳光', '雪夜霓虹'] },
        },
      ]),
      [
        { role: 'user', content: '画一只橘猫' },
        { role: 'assistant', content: 'an orange cat\n[Clarify] 想要什么场景和光线？' },
      ],
      '带澄清问题的意图卡会把问题保留进多轮历史',
    )
    assert.deepEqual(pure.intentHistory(null), [])
    // 澄清归一：2~4 个去重选项；不足 2 个或没有问题时整条丢弃。
    assert.deepEqual(pure.intentClarify({ question: ' 要横版吗？ ', options: [' 横版 ', '横版', '竖版'] }), { question: '要横版吗？', options: ['横版', '竖版'] }, '问题去空白、选项去重')
    assert.equal(pure.intentClarify({ question: '只有一个选项', options: ['横版'] }), null)
    assert.equal(pure.intentClarify({ question: '', options: ['横版', '竖版'] }), null)
    assert.equal(pure.intentClarify(null), null)
    assert.equal(pure.intentClarify({ question: '最多四个？', options: ['1', '2', '3', '4', '5'] }).options.length, 4)
    // 模型建议归一：预设必须真实存在、不能与当前预设相同、理由必填。
    assert.deepEqual(pure.intentModelHint({ presetId: 'flux2-klein-4b', reason: ' 轻量快速 ' }, 'sdxl-lightning'), { presetId: 'flux2-klein-4b', reason: '轻量快速' })
    assert.equal(pure.intentModelHint({ presetId: 'sdxl-lightning', reason: '同款' }, 'sdxl-lightning'), null)
    assert.equal(pure.intentModelHint({ presetId: 'not-a-model', reason: '未知' }, 'sdxl-lightning'), null)
    assert.equal(pure.intentModelHint({ presetId: 'flux2-klein-4b', reason: '  ' }, 'sdxl-lightning'), null)
    // 比例归一：只认契约比例。
    assert.equal(pure.intentRatio('16:9'), '16:9')
    assert.equal(pure.intentRatio('21:9'), '')
  } finally {
    client.unmount()
  }
})

await check('渲染：中文提示词的英文软提示（不拦截生成）', async () => {
  const mountStudio = async (initialPrompt) => {
    const client = await createTestClient({ now: NOW, responses: studioResponses(readyState, { items: [historyItem] }), testBuild: true })
    const tree = await client.mountRaw(client.components.Studio, { initialPrompt })
    client.unmount()
    return tree
  }
  const tree = await mountStudio('雨夜街景，湿润地面')
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('中文描述可能出图偏差'), '[hint] 中文提示词应给英文软提示')
  assertStructure('cjk-hint', tree, { required: { 'ofs-prompt-lang-hint': 1 }, forbidden: [] })
  const generateButton = findNodes(tree, (node) => node.type === 'button' && typeof node.props?.className === 'string' && node.props.className.split(' ').includes('ofs-generate') )[0]
  assert.ok(generateButton, '[hint] 缺少生成按钮')
  assert.notEqual(generateButton.props.disabled, true, '软提示不应拦住生成')
  const english = await mountStudio('rainy night street, wet pavement')
  assertStructure('english-prompt', english, { required: {}, forbidden: ['ofs-prompt-lang-hint'] })
})

await check('渲染：润色标签显示中文 label、点击插入英文 text', async () => {
  const client = await createTestClient({ now: NOW, responses: studioResponses(readyState, { items: [] }), testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const inserted = []
  const tree = await client.mountRaw(client.components.Rail, {
    t,
    ui: {
      advancedOpen: false,
      setAdvancedOpen: () => {},
      negativeOpen: false,
      setNegativeOpen: () => {},
      panelMode: 'form',
      setPanelMode: () => {},
    },
    form: {
      form: { prompt: '', negative: '', presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0, seed: '', count: 1 },
      patchForm: () => {},
      selectPreset: () => {},
      ratioId: '1:1',
      applyRatio: () => {},
      sizeTiers: [1024],
      selectedTier: 1024,
      applyTier: () => {},
      applyCustomSize: () => {},
      applyCfg: () => {},
      resetSeed: () => {},
      negativeActive: false,
      negativeHint: '',
      refineGroups: [
        {
          dimension: 'lighting',
          options: [{ id: 'local-lighting-0', text: 'soft diffused light', label: '柔和漫射光', applied: false }],
        },
      ],
      refineSource: 'local',
      enhancing: false,
      enhance: () => {},
      translating: false,
      translate: () => {},
      toggleRefine: (term) => inserted.push(term),
      useInspiration: () => {},
      englishPromptHint: false,
    },
    actions: { sending: false, generate: () => {} },
  })
  client.unmount()
  const text = collectText(tree).join(' | ')
  assert.ok(text.includes('柔和漫射光'), '[refine] 界面应显示中文 label')
  assert.ok(!text.includes('soft diffused light'), '[refine] 英文本只作为插入值，不应直接显示为按钮文案')
  const chip = findNodes(tree, (node) => node.type === 'button' && node.props?.title === 'soft diffused light' && collectText(node).join('').includes('柔和漫射光') )[0]
  assert.ok(chip, '[refine] 缺少润色标签按钮')
  chip.props.onClick()
  assert.deepEqual(inserted, ['soft diffused light'], '点击应把英文本交给 toggleRefine')
})

summary()
