/**
 * 舞台图片工具核心层的离线测试（不联网、不需要 React / DOM）。
 *
 * 覆盖 `src/logic/imageTool.js` 的冻结接口（INTERFACES.md §2.1）：
 *   - 工具注册表与描述符字段；
 *   - 自动选模 / 兜底（inpaint 专用权重优先、img2img 跳过 inpaintOnly）；
 *   - 强度默认档与上限（canvas + 蒙版放宽到 inpaintMax）；
 *   - 提示词回退（空输入 → 目标作品原提示词）与前置拦截；
 *   - POST /generate 请求体形状（宽高跟随作品、蒙版门控、负向词门控）；
 *   - 作品键归一（条目 / 图片 / 字符串）。
 *
 * 运行：node test/image-tool.mjs
 */

import assert from 'node:assert/strict'

import { PRESETS, LIMITS } from '../shared/contract.js'
import {
  IMAGE_TOOL_FORMS,
  IMAGE_TOOL_GROUPS,
  IMAGE_TOOLS,
  buildImageToolBody,
  imageToolBlockedKeyOf,
  imageToolOf,
  imageToolSummary,
  toolPresetOf,
  toolPromptFallback,
  toolStrengthDefaultOf,
  toolStrengthMaxOf,
  workKeyOf,
} from '../src/logic/imageTool.js'
import { createCheckRunner } from './helpers/check.mjs'

const byId = (id) => PRESETS.find((preset) => preset.id === id) || null
const lightning = byId('sdxl-lightning')
const inpaintPreset = byId('sdxl-inpaint')
const flux2 = byId('flux2-klein-4b')
const animagine = byId('animagine-xl-3.1')
const anima = byId('anima-light-lavender')

/** 合法蒙版 base64（逻辑层只校验 base64 形状，不解码 PNG）。 */
const MASK_DATA = Buffer.from('fake-inpaint-mask').toString('base64')
/** 超过契约上限的蒙版：base64 字节数 2100000 > LIMITS.mask.maxBytes。 */
const OVERSIZED_MASK = 'A'.repeat(2_800_000)

async function main() {
  const { check, summary } = createCheckRunner()

  await check('工具注册表：形态 / 分组 / 描述符字段完整且冻结', () => {
    assert.ok(Object.isFrozen(IMAGE_TOOL_FORMS))
    assert.deepEqual([...IMAGE_TOOL_FORMS], ['instant', 'inline', 'canvas'])
    assert.ok(Object.isFrozen(IMAGE_TOOL_GROUPS))
    assert.deepEqual([...IMAGE_TOOL_GROUPS], ['process', 'reuse'])
    assert.ok(Object.isFrozen(IMAGE_TOOLS))
    assert.equal(IMAGE_TOOLS.length, 4)

    const ids = IMAGE_TOOLS.map((tool) => tool.id)
    assert.deepEqual(ids, ['inpaint', 'img2img', 'upscale', 'outpaint'])
    for (const tool of IMAGE_TOOLS) {
      assert.ok(Object.isFrozen(tool), `${tool.id} 描述符应冻结`)
      assert.ok(IMAGE_TOOL_FORMS.includes(tool.form), `${tool.id} 的 form 未登记`)
      assert.ok(IMAGE_TOOL_GROUPS.includes(tool.group), `${tool.id} 的 group 未登记`)
      assert.equal(typeof tool.icon, 'string')
      assert.match(tool.labelKey, /^studio\.imageTool\./)
      assert.equal(typeof tool.ready, 'boolean')
      if (tool.ready) {
        assert.equal(tool.plannedKey, undefined, `${tool.id} 已开放时不应有规划中提示`)
        assert.equal(typeof tool.capability, 'string')
      } else {
        assert.equal(tool.plannedKey, 'studio.imageTool.planned')
      }
    }
    // 阶段十二只有局部涂抹 / 整图重绘真实可用；高清放大 / 扩图是禁用占位（Lead 决策 D1）。
    assert.deepEqual(IMAGE_TOOLS.filter((tool) => tool.ready).map((tool) => tool.id), ['inpaint', 'img2img'])
    assert.equal(imageToolOf('inpaint').form, 'canvas')
    assert.equal(imageToolOf('img2img').form, 'inline')
    assert.equal(imageToolOf('upscale').ready, false)
    assert.equal(imageToolOf('nope'), null)
    assert.equal(imageToolOf(''), null)
    assert.equal(imageToolOf(null), null)
  })

  await check('工具能力与模型资产一致：inpaintOnly 专用权重存在', () => {
    assert.ok(inpaintPreset, '模型资产里应有 sdxl-inpaint')
    assert.equal(inpaintPreset.inpaintOnly, true)
    assert.equal(inpaintPreset.supportsInpaint, true)
    assert.ok(PRESETS.some((preset) => preset.supportsInpaint === true), '至少一款模型支持局部重绘')
    assert.ok(PRESETS.some((preset) => preset.supportsImg2Img === true), '至少一款模型支持整图垫图')
    assert.equal(lightning.inpaintOnly ?? false, false)
    assert.equal(anima.supportsInpaint, false)
  })

  await check('toolPresetOf：inpaint 沿用支持 Inpaint 的当前模型', () => {
    const result = toolPresetOf([lightning, flux2], 'sdxl-lightning', 'inpaint')
    assert.equal(result.preset.id, 'sdxl-lightning')
    assert.equal(result.switched, false)
    assert.equal(result.fallback, false)
  })

  await check('toolPresetOf：inpaint 优先切到 sdxl-inpaint 专用权重', () => {
    const result = toolPresetOf([lightning, flux2, inpaintPreset], 'flux2-klein-4b', 'inpaint')
    assert.equal(result.preset.id, 'sdxl-inpaint')
    assert.equal(result.switched, true)
    assert.equal(result.fallback, false)
    // 当前没有预设 id（旧宿主表单为空）时同样应选中专用权重。
    const fromEmpty = toolPresetOf([flux2, inpaintPreset], '', 'inpaint')
    assert.equal(fromEmpty.preset.id, 'sdxl-inpaint')
    assert.equal(fromEmpty.switched, true)
  })

  await check('toolPresetOf：inpaint 无专用权重时退通用垫图兜底（跳过 inpaintOnly）', () => {
    const result = toolPresetOf([flux2, animagine], 'flux2-klein-4b', 'inpaint')
    assert.equal(result.preset.id, 'animagine-xl-3.1')
    assert.equal(result.switched, true)
    assert.equal(result.fallback, true)
    // 只有 inpaintOnly 模型、没有可做图生图的模型 → 选不出来（referencePresetOf 跳过专用权重）。
    const onlyInpaint = { id: 'only-inpaint', supportsInpaint: true, supportsImg2Img: true, inpaintOnly: true }
    const none = toolPresetOf([flux2, onlyInpaint], 'flux2-klein-4b', 'inpaint')
    assert.equal(none.preset, null)
    assert.equal(none.fallback, true)
    assert.equal(toolPresetOf([], '', 'inpaint').preset, null)
  })

  await check('toolPresetOf：img2img 沿用支持垫图的当前模型 / 跳过 inpaintOnly', () => {
    const reuse = toolPresetOf([lightning, flux2], 'sdxl-lightning', 'img2img')
    assert.equal(reuse.preset.id, 'sdxl-lightning')
    assert.equal(reuse.switched, false)
    assert.equal(reuse.fallback, false)
    // 当前是专用局部重绘权重：不能拿它做纯整图重绘，退回通用垫图模型。
    const fromInpaint = toolPresetOf([inpaintPreset, lightning], 'sdxl-inpaint', 'img2img')
    assert.equal(fromInpaint.preset.id, 'sdxl-lightning')
    assert.equal(fromInpaint.switched, true)
    assert.equal(fromInpaint.fallback, true)
    // 尚未开放的工具不参与自动选模。
    assert.equal(toolPresetOf([lightning], 'sdxl-lightning', 'upscale').preset, null)
    assert.equal(toolPresetOf([lightning], 'sdxl-lightning', 'nope').preset, null)
  })

  await check('toolStrengthDefaultOf：inpaint 0.8 / 专用权重 0.9 / img2img 契约默认', () => {
    assert.equal(toolStrengthDefaultOf('inpaint', lightning), 0.8)
    assert.equal(toolStrengthDefaultOf('inpaint', inpaintPreset), 0.9)
    assert.equal(toolStrengthDefaultOf('img2img', animagine), LIMITS.strength.default)
    assert.equal(toolStrengthDefaultOf('nope', null), LIMITS.strength.default)
  })

  await check('toolStrengthMaxOf：canvas + 蒙版才放宽到 inpaintMax', () => {
    assert.equal(toolStrengthMaxOf('inpaint', true), LIMITS.strength.inpaintMax)
    assert.equal(toolStrengthMaxOf('inpaint', false), LIMITS.strength.max)
    assert.equal(toolStrengthMaxOf('img2img', true), LIMITS.strength.max)
    assert.equal(toolStrengthMaxOf('nope', true), LIMITS.strength.max)
    assert.ok(toolStrengthMaxOf('inpaint', true) >= toolStrengthMaxOf('inpaint', false))
  })

  await check('toolPromptFallback：去空白并按契约截断，空输入返回空串', () => {
    assert.equal(toolPromptFallback('  一只荷花  '), '一只荷花')
    assert.equal(toolPromptFallback(''), '')
    assert.equal(toolPromptFallback(null), '')
    assert.equal(toolPromptFallback(undefined), '')
    assert.equal(toolPromptFallback('x'.repeat(LIMITS.prompt.maxChars + 20)).length, LIMITS.prompt.maxChars)
  })

  await check('buildImageToolBody：请求体形状 / 宽高跟随作品 / 蒙版随画布工具提交', () => {
    const body = buildImageToolBody({
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      target: { width: 1024, height: 768 },
      preset: animagine,
      presets: [animagine],
      prompt: '',
      strength: 0.8,
      mask: { data: MASK_DATA, coverage: 0.2 },
      negativeActive: false,
    })
    assert.ok(body, '合法输入应产出请求体')
    assert.deepEqual(Object.keys(body).sort(), [
      'autoStart', 'cfg', 'count', 'height', 'negativePrompt', 'presetId', 'prompt',
      'reference', 'seed', 'steps', 'waitSeconds', 'width',
    ].sort())
    assert.equal(body.presetId, 'animagine-xl-3.1')
    assert.equal(body.prompt, '一只荷花', '工具提示词为空时应回退目标作品提示词')
    assert.equal(body.negativePrompt, '')
    assert.equal(body.width, 1024)
    assert.equal(body.height, 768)
    assert.equal(body.steps, animagine.steps)
    assert.equal(body.cfg, animagine.cfg)
    assert.equal(body.seed, '')
    assert.equal(body.count, 1)
    assert.equal(body.waitSeconds, 0)
    assert.equal(body.autoStart, true)
    assert.deepEqual(Object.keys(body.reference).sort(), ['mask', 'path', 'strength'])
    assert.equal(body.reference.path, 'imagen-output/job-1/07.png')
    assert.equal(body.reference.strength, 0.8)
    assert.equal(body.reference.mask, MASK_DATA)
  })

  await check('buildImageToolBody：宽高缺失用预设 size，工具提示词优先', () => {
    const body = buildImageToolBody({
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '原提示词',
      preset: animagine,
      prompt: ' 把帽子换成红色贝雷帽 ',
      strength: 0.8,
      mask: { data: MASK_DATA, coverage: 0.2 },
      negativeActive: true,
    })
    assert.equal(body.prompt, '把帽子换成红色贝雷帽')
    assert.equal(body.width, animagine.size)
    assert.equal(body.height, animagine.size)
    assert.equal(body.negativePrompt, String(animagine.negativeHint || '').trim(), '负向词可用时才带模型推荐词')
  })

  await check('buildImageToolBody：img2img 不提交蒙版，强度按通用上限钳制', () => {
    const body = buildImageToolBody({
      tool: 'img2img',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: animagine,
      prompt: '',
      strength: 0.95,
      mask: { data: MASK_DATA, coverage: 0.2 },
      negativeActive: false,
    })
    assert.equal(body.reference.mask, undefined)
    assert.equal(body.reference.strength, LIMITS.strength.max, 'img2img 的上限是通用 max')
  })

  await check('buildImageToolBody：画布工具带蒙版时上限放宽到 inpaintMax', () => {
    const withMask = buildImageToolBody({
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: animagine,
      prompt: '',
      strength: 0.95,
      mask: { data: MASK_DATA, coverage: 0.2 },
      negativeActive: false,
    })
    assert.equal(withMask.reference.strength, 0.95)
    assert.equal(withMask.reference.strength <= LIMITS.strength.inpaintMax, true)
    const withoutMask = buildImageToolBody({
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: animagine,
      prompt: '',
      strength: 0.95,
      mask: null,
      negativeActive: false,
    })
    assert.equal(withoutMask.reference.mask, undefined)
    assert.equal(withoutMask.reference.strength, LIMITS.strength.max)
  })

  await check('buildImageToolBody：非法 / 超限蒙版退回整图处理', () => {
    const base = {
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: animagine,
      prompt: '',
      strength: 0.8,
      negativeActive: false,
    }
    assert.equal(buildImageToolBody({ ...base, mask: { data: 'not base64!!', coverage: 0.2 } }).reference.mask, undefined)
    assert.equal(buildImageToolBody({ ...base, mask: { data: OVERSIZED_MASK, coverage: 0.2 } }).reference.mask, undefined)
    assert.equal(buildImageToolBody({ ...base, mask: { data: MASK_DATA } }).reference.mask, MASK_DATA)
  })

  await check('buildImageToolBody：缺少底图 / 预设 / 提示词或工具未开放时返回 null', () => {
    const base = {
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: animagine,
      prompt: '',
      strength: 0.8,
      negativeActive: false,
    }
    assert.equal(buildImageToolBody({ ...base, targetPath: '' }), null)
    assert.equal(buildImageToolBody({ ...base, targetPath: null }), null)
    assert.equal(buildImageToolBody({ ...base, preset: null }), null)
    assert.equal(buildImageToolBody({ ...base, prompt: '', targetPrompt: '' }), null)
    assert.equal(buildImageToolBody({ ...base, tool: 'upscale' }), null)
    assert.equal(buildImageToolBody(null), null)
    // 预设只给 id 时用 presets 列表解析。
    const resolved = buildImageToolBody({ ...base, preset: null, presetId: 'animagine-xl-3.1', presets: [animagine] })
    assert.equal(resolved.presetId, 'animagine-xl-3.1')
  })

  await check('imageToolBlockedKeyOf：拦截顺序与文案键', () => {
    assert.equal(imageToolBlockedKeyOf({ tool: 'upscale' }), 'studio.imageTool.planned')
    assert.equal(imageToolBlockedKeyOf({ tool: 'nope', targetPath: 'a.png' }), 'studio.imageTool.blockedTarget')
    assert.equal(imageToolBlockedKeyOf({ tool: 'inpaint' }), 'studio.imageTool.blockedTarget')
    assert.equal(imageToolBlockedKeyOf({
      tool: 'inpaint',
      targetPath: 'a.png',
      preset: null,
      prompt: 'hi',
    }), 'studio.imageTool.blockedNoPreset')
    assert.equal(imageToolBlockedKeyOf({
      tool: 'inpaint',
      targetPath: 'a.png',
      preset: animagine,
      prompt: '',
      targetPrompt: '',
    }), 'studio.imageTool.blockedNoPrompt')
    assert.equal(imageToolBlockedKeyOf({
      tool: 'inpaint',
      targetPath: 'a.png',
      preset: animagine,
      prompt: '加一顶帽子',
    }), '')
    // 目标作品有原提示词时，工具输入为空也算可提交（提交时回退）。
    assert.equal(imageToolBlockedKeyOf({
      tool: 'inpaint',
      targetPath: 'a.png',
      preset: animagine,
      prompt: '',
      targetPrompt: '一只荷花',
    }), '')
  })

  await check('imageToolBlockedKeyOf：专用局部重绘权重必须带蒙版', () => {
    const base = {
      tool: 'inpaint',
      targetPath: 'a.png',
      preset: inpaintPreset,
      prompt: '把帽子换成红色贝雷帽',
    }
    assert.equal(imageToolBlockedKeyOf({ ...base }), 'studio.mask.onlyHint')
    assert.equal(imageToolBlockedKeyOf({ ...base, mask: null }), 'studio.mask.onlyHint')
    assert.equal(imageToolBlockedKeyOf({ ...base, mask: { data: MASK_DATA, coverage: 0.2 } }), '')
    // 整图重绘不需要蒙版，即使当前是专用权重也会在选模阶段被换掉。
    assert.equal(imageToolBlockedKeyOf({ ...base, tool: 'img2img' }), '')
  })

  await check('workKeyOf：条目 / 图片 / 字符串 → 稳定路径键', () => {
    assert.equal(workKeyOf('  imagen-output/job-1/07.png '), 'imagen-output/job-1/07.png')
    assert.equal(workKeyOf({ image: { path: 'imagen-output/job-1/07.png', url: 'x' } }), 'imagen-output/job-1/07.png')
    assert.equal(workKeyOf({ path: 'imagen-output/job-1/07.png', file: '07.png' }), 'imagen-output/job-1/07.png')
    assert.equal(workKeyOf({ file: '07.png' }), '07.png')
    assert.equal(workKeyOf({ image: null }), '')
    assert.equal(workKeyOf(null), '')
    assert.equal(workKeyOf(undefined), '')
    assert.equal(workKeyOf(42), '')
  })

  await check('imageToolSummary：轻量摘要不携带蒙版 base64', () => {
    const summary = imageToolSummary({
      tool: 'inpaint',
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: animagine,
      prompt: '',
      strength: 0.8,
      mask: { data: MASK_DATA, coverage: 0.2 },
      negativeActive: true,
    })
    assert.equal(summary.tool, 'inpaint')
    assert.equal(summary.form, 'canvas')
    assert.equal(summary.targetPath, 'imagen-output/job-1/07.png')
    assert.equal(summary.presetId, 'animagine-xl-3.1')
    assert.equal(summary.promptChars, 0)
    assert.equal(summary.promptFallback, true)
    assert.equal(summary.hasMask, true)
    assert.equal(summary.coverage, 0.2)
    assert.equal(summary.negative, true)
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'data'), false)
    assert.equal(JSON.stringify(summary).includes(MASK_DATA), false)
  })

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
