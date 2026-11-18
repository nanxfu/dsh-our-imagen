/**
 * 算力来源门控渲染测试（不需要浏览器）。
 *
 * 覆盖：模型卡对当前 provider 不可用的预设置灰 + 「仅 xx」角标与原因提示、禁用项不可选，
 * 以及绕过选择器（默认预设停在仅 Colab 模型上）时点生成被本地预检拦下、宿主请求不发出；
 * 反向用例确认来源匹配时不误拦、旧资产（缺省 providers）在两种来源下都可选。
 *
 * 资产口径见 docs/MODEL_ASSET_SPEC.md §2.5；纯函数与预检分支见 check-client-logic。
 *
 * 运行：node test/check-client-provider.mjs
 */

import assert from 'node:assert/strict'

import { createCheckRunner } from './helpers/check.mjs'
import { assertStructure, collectText, nodesByClass, createTestClient } from './helpers/render.mjs'
import { NOW, preset, readyState, studioResponses } from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

// 仅 Colab 的 9B 资产（与 models/flux2-klein-9b.json 的能力位同形）：providers 只声明 colab。
const colabOnly = {
  ...preset,
  id: 'flux2-klein-9b',
  label: 'FLUX.2 Klein 9B',
  short: 'Klein 9B',
  family: 'FLUX',
  params: '9.08B',
  steps: 4,
  cfg: 1,
  steadySeconds: null,
  supportsNegative: false,
  negativeHint: '',
  providers: ['colab'],
}
// 反向能力位：只声明 kaggle（当前没有此资产，用来证明门控不是写死「仅 Colab」）。
const kaggleOnly = { ...preset, id: 'kaggle-only', label: 'Kaggle Only', short: 'Kaggle Only', providers: ['kaggle'] }
// 既有 10 个资产的形态：不写 providers，两种来源都必须可选（快照不回归）。
const bothPreset = { ...preset }

const generateCalls = (client) => client.requests.filter((item) => item.path === '/imagen-api/generate')
const textOf = (tree) => collectText(tree).join(' | ')

/** 选项节点按 data-preset-id 索引。 */
const optionById = (tree, id) => nodesByClass(tree, 'ofs-model-option')
  .find((node) => node.props['data-preset-id'] === id) || null

/** 只挂模型卡，返回渲染树、选择记录与翻译函数。 */
async function mountPicker({ presets, value, provider, locale = 'zh' }) {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const calls = []
  const t = client.internals.i18n.fallbackTranslate(locale)
  const tree = await client.mountRaw(client.components.ModelCardPicker, {
    t,
    isEn: locale === 'en',
    presets,
    value,
    defaultPreset: 'sdxl-lightning',
    provider,
    open: true,
    onOpenChange: () => {},
    onChange: (next) => calls.push(next.id),
  })
  client.unmount()
  return { tree, calls, t }
}

// 主场景：Kaggle 下 9B 置灰禁用 + 「仅 Colab」角标，点它不切换预设；普通模型不受影响。
await check('渲染：Kaggle 下仅 Colab 的模型置灰并标「仅 Colab」', async () => {
  const { tree, calls } = await mountPicker({
    presets: [bothPreset, colabOnly],
    value: 'sdxl-lightning',
    provider: 'kaggle',
  })
  const gated = optionById(tree, 'flux2-klein-9b')
  assert.ok(gated, '仅 Colab 的模型仍要出现在菜单里（不在菜单里反而无法解释为什么不可选）')
  assert.equal(gated.props.disabled, true, '来源不可用的模型必须禁用')
  assert.equal(gated.props['aria-disabled'], 'true')
  assert.ok(gated.props.className.includes('is-provider-gated'), '需要单独的置灰标记类')
  assert.equal(nodesByClass(tree, 'ofs-model-provider').length, 1, '置灰项应带一个「仅 Colab」角标')
  const text = textOf(tree)
  assert.ok(text.includes('仅 Colab'), '角标文案必须是「仅 Colab」')
  assert.ok(gated.props.title.includes('Kaggle') && gated.props.title.includes('Colab'), '悬停提示要说明当前 / 所需来源')
  // 直接触发回调（等价于绕过 disabled 的旧宿主调用）：选择动作本身也要拒绝。
  gated.props.onClick()
  assert.deepEqual(calls, [], '点禁用项不得切换预设')
  // 缺省 providers 的普通模型保持可选。
  const plain = optionById(tree, 'sdxl-lightning')
  assert.equal(plain.props.disabled, false, '既有模型（缺省 providers）不能被误禁')
  plain.props.onClick()
  assert.deepEqual(calls, ['sdxl-lightning'], '普通预设仍可正常选择')
  assertStructure('picker-gated', tree, {
    required: { 'ofs-model-option': 2, 'ofs-model-provider': 1 },
    forbidden: [],
  })
})

// 反向 + 英文文案：Colab 下来源匹配的 9B 可选，Kaggle 专用模型置灰；EN 角标同步本地化。
await check('渲染：来源匹配时可选，反向 Kaggle 专用模型置灰，英文角标同步', async () => {
  const colabSide = await mountPicker({
    presets: [bothPreset, colabOnly],
    value: 'flux2-klein-9b',
    provider: 'colab',
  })
  const matched = optionById(colabSide.tree, 'flux2-klein-9b')
  assert.equal(matched.props.disabled, false, 'Colab 下来源匹配的 9B 应可选')
  assert.ok(!matched.props.className.includes('is-provider-gated'), '可选时不应带置灰类')
  // 角标仍要保留：它说明这个模型在 Kaggle 上不可用，而不是只对当前来源生效。
  assert.ok(textOf(colabSide.tree).includes('仅 Colab'), '可选状态仍保留「仅 Colab」角标')
  matched.props.onClick()
  assert.deepEqual(colabSide.calls, ['flux2-klein-9b'], '匹配时应能切换预设')

  const kaggleGated = await mountPicker({
    presets: [bothPreset, kaggleOnly],
    value: 'sdxl-lightning',
    provider: 'colab',
  })
  const gated = optionById(kaggleGated.tree, 'kaggle-only')
  assert.equal(gated.props.disabled, true, 'Colab 下 Kaggle 专用模型同样置灰（门控是双向的）')
  assert.ok(textOf(kaggleGated.tree).includes('仅 Kaggle'), '角标要按模型限制的来源生成')

  const en = await mountPicker({
    presets: [bothPreset, colabOnly],
    value: 'sdxl-lightning',
    provider: 'kaggle',
    locale: 'en',
  })
  assert.ok(textOf(en.tree).includes('Only Colab'), '英文角标应本地化为 Only Colab')
})

// 旧资产 / 非法 provider：缺省 providers 在两种来源下都可选，非法来源按 kaggle 回退。
await check('渲染：缺省 providers 在两种来源下都可选，非法 provider 回退 kaggle', async () => {
  const colabSide = await mountPicker({ presets: [bothPreset], value: 'sdxl-lightning', provider: 'colab' })
  assert.equal(optionById(colabSide.tree, 'sdxl-lightning').props.disabled, false, 'Colab 下旧模型可选')
  assert.equal(nodesByClass(colabSide.tree, 'ofs-model-provider').length, 0, '旧模型不应出现来源角标')

  const noProvider = await mountPicker({ presets: [bothPreset], value: 'sdxl-lightning', provider: undefined })
  assert.equal(optionById(noProvider.tree, 'sdxl-lightning').props.disabled, false, 'provider 缺失时旧模型可选')

  // 非法 provider（旧宿主 / 设置未就绪）按契约默认来源 kaggle 判断：仅 Colab 模型仍应置灰。
  const invalid = await mountPicker({ presets: [colabOnly], value: 'flux2-klein-9b', provider: 'a100' })
  assert.equal(optionById(invalid.tree, 'flux2-klein-9b').props.disabled, true, '非法 provider 回退 kaggle 后仍拦仅 Colab')
})

// 端到端：表单停在仅 Colab 预设（如历史回填 / 草稿恢复 / 默认预设）时，Kaggle 下点生成被拦下。
await check('渲染：算力来源不匹配时点生成被拦下且不发宿主请求', async () => {
  const responses = studioResponses(
    { ...readyState, provider: 'kaggle', presets: [bothPreset, colabOnly], defaultPreset: 'flux2-klein-9b' },
    { items: [] },
    { '/imagen-api/generate': { id: 'job-new', status: 'queued' } },
  )
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { initialPrompt: '雨夜街景' })
    await client.settle()
    tree = await client.rerenderRaw()
    // 表单已同步到仅 Colab 预设：先确认这是「来源不匹配」而不是「模型没切过去」。
    assert.ok(textOf(tree).includes('Klein 9B'), '表单应停在仅 Colab 的 9B 预设上')
    const button = nodesByClass(tree, 'ofs-generate')[0]
    assert.ok(button, '缺左栏「立即生成」按钮')
    button.props.onClick()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.equal(generateCalls(client).length, 0, '预检拦下后不得发出宿主生成请求')
    const toasts = nodesByClass(tree, 'ofs-toast').filter((node) => node.props.role === 'status')
    assert.equal(toasts.length, 1, '拦下时应给一条轻提示')
    const toastText = collectText(toasts[0]).join('')
    assert.ok(toastText.includes('只能运行在 Colab'), `提示要说明所需算力来源，实际：${toastText}`)
    assert.ok(toastText.includes('Klein 9B'), '提示要带模型名')
    assert.ok(toastText.includes('Kaggle'), '提示要说明当前算力来源')
    // 拦下不是「提交中」：按钮回到可点状态，用户可以换算力来源或换模型后重试。
    assert.equal(nodesByClass(tree, 'ofs-generate')[0].props.disabled, false, '拦下后按钮不能停在提交中')
  } finally {
    client.unmount()
  }
})

// 对照：来源匹配时同一套表单正常提交，证明门控没有误伤。
await check('渲染：算力来源匹配时正常提交生成请求', async () => {
  const responses = studioResponses(
    { ...readyState, provider: 'colab', presets: [bothPreset, colabOnly], defaultPreset: 'flux2-klein-9b' },
    { items: [] },
    { '/imagen-api/generate': { id: 'job-new', status: 'queued' } },
  )
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, { initialPrompt: '雨夜街景' })
    await client.settle()
    tree = await client.rerenderRaw()
    nodesByClass(tree, 'ofs-generate')[0].props.onClick()
    await client.settle()
    const calls = generateCalls(client)
    assert.equal(calls.length, 1, '来源匹配时应正常提交一次')
    assert.equal(calls[0].body.presetId, 'flux2-klein-9b', '提交体应沿用当前有效预设')
    assert.equal(calls[0].body.prompt, '雨夜街景')
  } finally {
    client.unmount()
  }
})

summary()
