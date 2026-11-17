/**
 * 舞台图片工具核心层的离线测试（不联网、不需要 React / DOM）。
 *
 * 覆盖 `src/logic/imageTool.js` 的冻结接口（INTERFACES.md §4.1 / §4.3）：
 *   - 工具注册表与描述符字段（阶段十五 Phase B 起四个工具全部 ready）；
 *   - 自动选模 / 兜底（inpaint 沿用当前模型优先、outpaint 优先专用 9 通道权重、
 *     img2img 跳过 inpaintOnly、upscale 不选模）；
 *   - 强度默认档与上限（canvas + 蒙版放宽到 inpaintMax、outpaint 默认 1.0）；
 *   - 提示词回退（空输入 → 目标作品原提示词）与前置拦截（含 upscale 源图超限）；
 *   - 三类请求体：POST /generate 的 inpaint / img2img / upscale / outpaint 形状；
 *   - 扩图画布归一（base64 / 体积 / 8 对齐 / 画布边界 / 覆盖率）；
 *   - 作品键归一（条目 / 图片 / 字符串）。
 *
 * 运行：node test/image-tool.mjs
 */

import assert from 'node:assert/strict'

import { PRESETS, LIMITS, OUTPAINT, UPSCALE } from '../shared/contract.js'
import {
  IMAGE_TOOL_FORMS,
  IMAGE_TOOL_GROUPS,
  IMAGE_TOOLS,
  buildImageToolBody,
  buildOutpaintToolBody,
  buildUpscaleToolBody,
  imageToolBlockedKeyOf,
  imageToolOf,
  imageToolSummary,
  normalizeOutpaintCanvas,
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
/** 扩图合成画布：image / mask 各一段合法 base64，尺寸与版面取「1024² 四边扩 20%」。 */
const CANVAS_IMAGE = Buffer.from('fake-outpaint-image').toString('base64')
const CANVAS_MASK = Buffer.from('fake-outpaint-mask').toString('base64')
const OUTPAINT_CANVAS = {
  image: CANVAS_IMAGE,
  mask: CANVAS_MASK,
  width: 1232,
  height: 1232,
  content: { x: 104, y: 104, width: 1024, height: 1024 },
}
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
        // 无参工具（高清放大）没有预设能力字段，其余工具必须声明能力字段。
        if (tool.id === 'upscale') assert.equal(tool.capability, null)
        else assert.equal(typeof tool.capability, 'string')
      } else {
        assert.equal(tool.plannedKey, 'studio.imageTool.planned')
      }
    }
    // 阶段十五 Phase B：四个工具全部开放（高清放大 / 扩图不再是禁用占位）。
    assert.deepEqual(IMAGE_TOOLS.filter((tool) => tool.ready).map((tool) => tool.id), ['inpaint', 'img2img', 'upscale', 'outpaint'])
    assert.equal(imageToolOf('inpaint').form, 'canvas')
    assert.equal(imageToolOf('img2img').form, 'inline')
    assert.equal(imageToolOf('upscale').form, 'instant')
    assert.equal(imageToolOf('outpaint').form, 'canvas')
    assert.equal(imageToolOf('upscale').capability, null)
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
    // 高清放大是无参工具，不参与自动选模；未知工具同样返回空。
    assert.equal(toolPresetOf([lightning], 'sdxl-lightning', 'upscale').preset, null)
    assert.equal(toolPresetOf([lightning], 'sdxl-lightning', 'nope').preset, null)
  })

  await check('toolPresetOf：outpaint 优先专用 sdxl-inpaint，其次当前支持 Inpaint 的模型', () => {
    // 当前是通用模型：扩图优先切到 9 通道专用权重。
    const fromLightning = toolPresetOf([lightning, inpaintPreset], 'sdxl-lightning', 'outpaint')
    assert.equal(fromLightning.preset.id, 'sdxl-inpaint')
    assert.equal(fromLightning.switched, true)
    assert.equal(fromLightning.fallback, false)
    // 没有专用权重时沿用当前支持 Inpaint 的通用模型。
    const noNative = toolPresetOf([lightning, flux2], 'sdxl-lightning', 'outpaint')
    assert.equal(noNative.preset.id, 'sdxl-lightning')
    assert.equal(noNative.switched, false)
    assert.equal(noNative.fallback, false)
    // 当前模型不支持 Inpaint：退回通用垫图兜底（referencePresetOf 跳过 inpaintOnly）。
    const fallback = toolPresetOf([flux2, animagine], 'flux2-klein-4b', 'outpaint')
    assert.equal(fallback.preset.id, 'animagine-xl-3.1')
    assert.equal(fallback.switched, true)
    assert.equal(fallback.fallback, true)
    assert.equal(toolPresetOf([flux2], 'flux2-klein-4b', 'outpaint').preset, null)
  })

  await check('toolStrengthDefaultOf：inpaint 0.8 / 专用权重 0.9 / outpaint 1.0 / img2img 契约默认', () => {
    assert.equal(toolStrengthDefaultOf('inpaint', lightning), 0.8)
    assert.equal(toolStrengthDefaultOf('inpaint', inpaintPreset), 0.9)
    assert.equal(toolStrengthDefaultOf('outpaint', lightning), OUTPAINT.strength)
    assert.equal(toolStrengthDefaultOf('outpaint', inpaintPreset), OUTPAINT.strength)
    assert.equal(toolStrengthDefaultOf('img2img', animagine), LIMITS.strength.default)
    assert.equal(toolStrengthDefaultOf('upscale', lightning), LIMITS.strength.default)
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

  await check('buildUpscaleToolBody：零参数请求体（无预设 / 无种子语义）', () => {
    const target = { path: 'imagen-output/job-1/07.png', width: 1024, height: 768, prompt: '一只荷花' }
    const body = buildUpscaleToolBody({ target, targetPrompt: target.prompt })
    assert.deepEqual(Object.keys(body).sort(), [
      'autoStart', 'count', 'height', 'prompt', 'reference', 'tool', 'waitSeconds', 'width',
    ].sort())
    assert.equal(body.tool, 'upscale')
    assert.equal(body.prompt, '一只荷花')
    assert.equal(body.width, 1024)
    assert.equal(body.height, 768)
    assert.equal(body.count, 1)
    assert.equal(body.waitSeconds, 0)
    assert.equal(body.autoStart, true)
    assert.deepEqual(body.reference, { path: target.path })
    for (const key of ['presetId', 'steps', 'cfg', 'seed']) {
      assert.equal(Object.prototype.hasOwnProperty.call(body, key), false, `upscale 请求体不应带 ${key}`)
    }
    // 目标作品没有提示词时 prompt 是空串（远端不读扩散参数）；宽高未知时省略字段交给远端兜底。
    const minimal = buildUpscaleToolBody({ target: { path: 'imagen-output/a/01.png' } })
    assert.equal(minimal.prompt, '')
    assert.equal(Object.prototype.hasOwnProperty.call(minimal, 'width'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(minimal, 'height'), false)
    // 也接受显式 targetPath / targetPrompt。
    const explicit = buildUpscaleToolBody({ targetPath: ' imagen-output/a/01.png ', targetPrompt: '  荷花  ', targetWidth: 512, targetHeight: 512 })
    assert.equal(explicit.reference.path, 'imagen-output/a/01.png')
    assert.equal(explicit.prompt, '荷花')
    assert.equal(explicit.width, 512)
    assert.equal(buildUpscaleToolBody({}), null)
    assert.equal(buildUpscaleToolBody(null), null)
    assert.equal(buildUpscaleToolBody({ target: {} }), null)
  })

  await check('buildOutpaintToolBody：画布 + 蒙版 + 来源路径 + 强度（默认 1.0）', () => {
    const body = buildOutpaintToolBody({
      targetPath: 'imagen-output/job-1/07.png',
      targetPrompt: '一只荷花',
      preset: inpaintPreset,
      presets: [inpaintPreset],
      prompt: '',
      strength: OUTPAINT.strength,
      canvas: OUTPAINT_CANVAS,
      negativeActive: true,
    })
    assert.ok(body)
    assert.equal(body.tool, 'outpaint')
    assert.equal(body.presetId, 'sdxl-inpaint')
    assert.equal(body.prompt, '一只荷花', '工具提示词为空时回退目标作品提示词')
    assert.equal(body.negativePrompt, String(inpaintPreset.negativeHint || '').trim(), '专用权重消费负向词时带上推荐词')
    assert.equal(body.width, 1232)
    assert.equal(body.height, 1232)
    assert.equal(body.steps, inpaintPreset.steps)
    assert.equal(body.cfg, inpaintPreset.cfg)
    assert.equal(body.seed, '')
    assert.equal(body.count, 1)
    assert.equal(body.waitSeconds, 0)
    assert.equal(body.autoStart, true)
    assert.deepEqual(Object.keys(body.reference).sort(), ['image', 'mask', 'sourcePath', 'strength'])
    assert.equal(body.reference.image, CANVAS_IMAGE)
    assert.equal(body.reference.mask, CANVAS_MASK)
    assert.equal(body.reference.sourcePath, 'imagen-output/job-1/07.png')
    assert.equal(body.reference.strength, OUTPAINT.strength, '扩图默认强度走满步（1.0）')
    // 用户调过强度时尊重用户值（带蒙版上限内），负向词门控关闭时为空串。
    const tuned = buildOutpaintToolBody({
      targetPath: 'imagen-output/a/01.png',
      targetPrompt: 'x',
      preset: lightning,
      prompt: '把天空换成晚霞',
      strength: 0.95,
      canvas: { ...OUTPAINT_CANVAS, image: `data:image/png;base64,${CANVAS_IMAGE}` },
      negativeActive: false,
    })
    assert.equal(tuned.reference.strength, 0.95)
    assert.equal(tuned.negativePrompt, '')
    assert.equal(tuned.reference.image, CANVAS_IMAGE, '带 data URL 前缀的导出值会被剥掉')
    // 缺底图 / 预设 / 画布 / 提示词都返回 null。
    const base = {
      targetPath: 'imagen-output/a/01.png',
      targetPrompt: '一只荷花',
      preset: inpaintPreset,
      prompt: '',
      canvas: OUTPAINT_CANVAS,
    }
    assert.equal(buildOutpaintToolBody({ ...base, targetPath: '' }), null)
    assert.equal(buildOutpaintToolBody({ ...base, preset: null }), null)
    assert.equal(buildOutpaintToolBody({ ...base, canvas: null }), null)
    assert.equal(buildOutpaintToolBody({ ...base, prompt: '', targetPrompt: '' }), null)
    assert.equal(buildOutpaintToolBody(null), null)
  })

  await check('normalizeOutpaintCanvas：base64 / 体积 / 8 对齐 / 画布边界校验与覆盖率', () => {
    const canvas = normalizeOutpaintCanvas(OUTPAINT_CANVAS)
    assert.ok(canvas)
    assert.equal(canvas.image, CANVAS_IMAGE)
    assert.equal(canvas.mask, CANVAS_MASK)
    assert.equal(canvas.width, 1232)
    assert.equal(canvas.height, 1232)
    assert.deepEqual(canvas.content, { x: 104, y: 104, width: 1024, height: 1024 })
    assert.ok(Math.abs(canvas.coverage - 0.309158) < 0.000001)
    // 非法 base64 / 缺字段。
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, image: 'not base64!!' }), null)
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, mask: '' }), null)
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, width: null }), null)
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, content: null }), null)
    // 宽高必须 8 对齐且落在契约边界内。
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, width: 1230, height: 1230, content: { x: 0, y: 0, width: 100, height: 100 } }), null)
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, width: OUTPAINT.maxEdge + 8 }), null)
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, width: 200, height: 200, content: { x: 0, y: 0, width: 100, height: 100 } }), null)
    // 内容框必须在画布内且面积为正。
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, content: { x: 200, y: 0, width: 1100, height: 100 } }), null)
    assert.equal(normalizeOutpaintCanvas({ ...OUTPAINT_CANVAS, content: { x: 0, y: 0, width: 0, height: 100 } }), null)
    // 体积超限（image 超过参考图上限 / mask 超过蒙版上限）。
    assert.equal(normalizeOutpaintCanvas({
      ...OUTPAINT_CANVAS,
      image: 'A'.repeat(2 * (LIMITS.reference.maxBytes + 10)),
    }), null)
    assert.equal(normalizeOutpaintCanvas({
      ...OUTPAINT_CANVAS,
      mask: 'A'.repeat(2 * (LIMITS.mask.maxBytes + 10)),
    }), null)
  })

  await check('imageToolBlockedKeyOf：拦截顺序与文案键', () => {
    assert.equal(imageToolBlockedKeyOf({ tool: 'upscale' }), 'studio.imageTool.blockedTarget')
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

  await check('imageToolBlockedKeyOf：upscale 长边超限拦下，宽高未知时放行', () => {
    const target = { path: 'imagen-output/a/01.png', width: 1024, height: 1024 }
    assert.equal(imageToolBlockedKeyOf({ tool: 'upscale', targetPath: target.path, target }), '')
    assert.equal(imageToolBlockedKeyOf({
      tool: 'upscale',
      targetPath: target.path,
      target: { ...target, width: 1280, height: 720 },
    }), '', '长边正好达到上限时应放行')
    assert.equal(imageToolBlockedKeyOf({
      tool: 'upscale',
      targetPath: target.path,
      target: { ...target, width: UPSCALE.maxInputEdge + 8, height: 1024 },
    }), 'studio.imageTool.upscaleTooLarge')
    // 无宽高信息（旧记录）时交给远端兜底，客户端不误拦。
    assert.equal(imageToolBlockedKeyOf({
      tool: 'upscale',
      targetPath: target.path,
      target: { path: target.path },
    }), '')
    assert.equal(imageToolBlockedKeyOf({
      tool: 'upscale',
      targetPath: target.path,
      targetWidth: 2048,
      targetHeight: 1024,
    }), 'studio.imageTool.upscaleTooLarge')
  })

  await check('imageToolBlockedKeyOf：outpaint 依次检查预设 / 画布 / 提示词', () => {
    const base = {
      tool: 'outpaint',
      targetPath: 'imagen-output/a/01.png',
      targetPrompt: '一只荷花',
      preset: inpaintPreset,
      prompt: '',
      canvas: OUTPAINT_CANVAS,
    }
    assert.equal(imageToolBlockedKeyOf({ ...base }), '')
    assert.equal(imageToolBlockedKeyOf({ ...base, preset: null }), 'studio.imageTool.blockedNoPreset')
    assert.equal(imageToolBlockedKeyOf({ ...base, canvas: null }), 'studio.outpaint.blockedCanvas')
    assert.equal(imageToolBlockedKeyOf({ ...base, canvas: { image: 'x' } }), 'studio.outpaint.blockedCanvas')
    assert.equal(imageToolBlockedKeyOf({
      ...base,
      prompt: '',
      targetPrompt: '',
    }), 'studio.imageTool.blockedNoPrompt')
    // 用户输入了提示词时不再依赖作品原提示词。
    assert.equal(imageToolBlockedKeyOf({ ...base, targetPrompt: '', prompt: '把天空换成晚霞' }), '')
    // 专用 inpaint 权重在扩图下不要求涂抹蒙版（画布自带蒙版），不会命中 onlyHint。
    assert.equal(imageToolBlockedKeyOf({ ...base, mask: null }), '')
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
