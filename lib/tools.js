/**
 * DSH Agent 工具注册：
 * imagen_generate / imagen_batch / imagen_recipes / imagen_session / imagen_history /
 * imagen_cancel / imagen_upscale。
 *
 * 这里只放「给模型看的描述 + 执行 + 文案」；宿主入口 index.js 只负责装配。
 * 工具参数边界取自 `shared/contract.js` 的 LIMITS（唯一来源）；
 * 风格配方数据来自 `shared/recipes.js`，工具只读检索，不替用户拼接样式后缀。
 *
 * 扩图的 Agent 工具（imagen_outpaint）本轮不接：扩图画布需要像素级的「等比缩放 + 居中 +
 * 白边蒙版」合成，而 Host 保持零图像依赖（不引入 sharp / jimp）；这部分逻辑已经在客户端
 * `src/logic/outpaint.js` 与 OutpaintEditor 里实现，用户从舞台动作坞提交即可。Agent 侧
 * 若要扩图，需要客户端先把画布导出成参考图，超出本轮范围（见 docs/SPEC.md 的评估结论）。
 */

import { readFile } from 'node:fs/promises'

import { LIMITS, PRESETS, UPSCALE } from '../shared/contract.js'
import { modelCatalogText, promptStyleName } from '../shared/models-guide.js'
import {
  RECIPES,
  RECIPE_CATEGORIES,
  SUBJECT_PLACEHOLDER,
  categoryLabelOf,
  searchRecipes,
  templateFor,
} from '../shared/recipes.js'
import { parseImageHeader } from './image-meta.js'
import { scanHistory } from './output.js'
import { OUTPUT_DIR, resolveOutputPath, resolveWorkspaceWritePath } from './paths.js'
import { DEFAULT_PRESET, presetById } from './presets.js'
import { toInt } from './route-kit.js'

/** 把 job 折叠成一段给模型看的文字。 */
export function describeJob(job) {
  if (!job) return '任务不存在'
  const lines = []
  lines.push(`任务 ${job.id}：${job.status}${job.seconds != null ? `（${job.seconds}s）` : ''}`)
  // 补上模型定位：Agent 看到产物时能判断这批图是用什么模型、什么取向生成的。
  if (job.tool === 'upscale') {
    // 高清放大没有扩散参数：只给源图尺寸与倍率，避免出现「0 步 · cfg 0」这类无意义信息。
    lines.push(`高清放大（×${UPSCALE.factor}）· 源图 ${job.params.width ?? '?'}×${job.params.height ?? '?'}`)
  } else {
    const preset = presetById(job.presetId)
    const known = preset && preset.id === job.presetId ? preset : null
    const presetText = known ? `${known.label}（${known.id}）` : job.presetId
    const position = known && known.description ? known.description.zh || known.description.en : ''
    const presetParts = [`预设：${presetText}`]
    if (position) presetParts.push(`定位：${position}`)
    lines.push(
      `${presetParts.join(' · ')} · 尺寸 ${job.params.width}×${job.params.height} · ${job.params.steps} 步 · cfg ${job.params.cfg} · seed ${job.params.seed}`,
    )
  }
  if (job.error) lines.push(`错误：${job.error.code} ${job.error.message}`)
  if (job.output?.images?.length) {
    lines.push('产物：')
    for (const image of job.output.images) {
      lines.push(`- ${image.path}（${image.width}×${image.height}，seed ${image.seed}）`)
      if (image.url) lines.push(`  ${image.url}`)
    }
    // 交付到工作区的副本单独列出：Agent 可以直接把相对路径写进代码或文档引用。
    for (const path of job.output.deliveredPaths ?? []) {
      lines.push(`已交付至：${path}`)
    }
    lines.push('提示：可以直接在回复里用 ![描述](URL) 展示图片。')
  } else if (job.status === 'cancelled') {
    lines.push('任务已取消，没有可展示的图片。')
  } else if (job.status !== 'done') {
    lines.push('任务仍在进行中，可用 imagen_history 或再次调用查看结果。')
  }
  return lines.join('\n')
}

/** 把会话快照折叠成一段给模型看的文字。 */
function describeSession(session) {
  const lines = [
    `会话状态：${session.state}${session.phase ? `（${session.phase}）` : ''}`,
    session.detail ? `说明：${session.detail}` : null,
    session.kernelUrl ? `Kernel：${session.kernelUrl}` : null,
    session.endpointUrl ? `隧道：已建立` : null,
    session.device ? `设备：${session.device}${session.deviceCount ? ` ×${session.deviceCount}` : ''}` : null,
    session.error ? `错误：${session.error.code} ${session.error.message}` : null,
  ]
  return lines.filter(Boolean).join('\n')
}

/** 提示词预览：折叠空白并截断，避免批量汇总把整段 prompt 重复贴出。 */
function promptPreview(prompt, maxChars = 80) {
  const text = String(prompt ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** 预设 id → 「名称（id）」；未知 id 原样返回。 */
function presetLabelOf(presetId) {
  const preset = PRESETS.find((item) => item.id === presetId)
  return preset ? `${preset.label}（${preset.id}）` : String(presetId ?? '未知预设')
}

/**
 * 把批量任务逐条结果折叠成给模型看的汇总文字。
 *
 * 返回值要让模型能继续行动：成功项给出产物路径与 URL；失败项给出可读原因；
 * 未完成项给出 jobId 与轮询/取消方式（本次总等待预算用尽不会取消它们）。
 *
 * @param {Array<object>} records 逐条记录（reject / jobId / job / prompt）
 * @param {number} waitBudget 本次调用的总等待预算（秒）
 */
function describeBatchResult(records, waitBudget) {
  let successCount = 0
  let failedCount = 0
  let pendingCount = 0
  for (const record of records) {
    if (record.reject) {
      failedCount += 1
    } else if (record.job?.status === 'done') {
      successCount += 1
    } else if (record.job?.status === 'failed' || record.job?.status === 'cancelled') {
      failedCount += 1
    } else {
      pendingCount += 1
    }
  }

  const lines = [
    `批量任务汇总：共 ${records.length} 条，成功 ${successCount}，失败 ${failedCount}，未完成 ${pendingCount}。`,
  ]
  records.forEach((record, position) => {
    const label = `[${position + 1}]`
    if (record.reject) {
      lines.push(`${label} 失败（未入队）· 提示词：${promptPreview(record.prompt) || '（空）'}`)
      lines.push(`  原因：${record.reject}`)
      return
    }
    const job = record.job
    if (!job) {
      lines.push(`${label} 未完成 · 任务 ${record.jobId} · 提示词：${promptPreview(record.prompt)}`)
      lines.push('  说明：任务已提交但查询不到快照，可用 imagen_history 确认是否已经落盘。')
      return
    }
    const preset = presetLabelOf(job.presetId)
    const promptLine = `  提示词：${promptPreview(record.prompt)}`
    if (job.status === 'done') {
      lines.push(`${label} 成功 · 任务 ${job.id} · 预设 ${preset}`)
      lines.push(promptLine)
      for (const image of job.output?.images ?? []) {
        lines.push(`  产物：${image.path}（${image.width}×${image.height}，seed ${image.seed}）`)
        if (image.url) lines.push(`  URL：${image.url}`)
      }
      for (const path of job.output?.deliveredPaths ?? []) lines.push(`  已交付至：${path}`)
      return
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      lines.push(`${label} 失败 · 任务 ${job.id} · 预设 ${preset}`)
      lines.push(promptLine)
      if (job.status === 'cancelled') {
        const count = job.output?.images?.length ?? 0
        lines.push(`  原因：任务已取消${count > 0 ? `（已出 ${count} 张，可在 imagen_history 查看）` : ''}`)
      } else {
        lines.push(`  原因：${job.error?.code ?? 'unknown'}：${job.error?.message ?? '生成失败，原因未知'}`)
      }
      return
    }
    lines.push(`${label} 未完成 · 任务 ${job.id}（${job.status}）· 预设 ${preset}`)
    lines.push(promptLine)
  })

  // 尾注只给「下一步能做什么」：未完成不是失败，不要诱导模型重复提交。
  if (pendingCount > 0) {
    lines.push(
      `未完成任务不受本次总等待预算（${waitBudget} 秒）影响，仍在后台继续；` +
        '稍后可用 imagen_history 轮询产物，确实不需要时用 imagen_cancel 按 jobId 取消。',
    )
  }
  if (successCount > 0) lines.push('提示：可以直接在回复里用 ![描述](URL) 展示图片。')
  if (failedCount > 0) {
    lines.push('失败项已逐条隔离，不影响其他任务；修正原因后可用 imagen_generate 单独重试。')
  }
  return lines.join('\n')
}

/**
 * 把配方检索结果折叠成给模型看的说明。
 *
 * 模板按预设的提示词写法分行展示，模型可以直接复制改写；
 * 这里只呈现配方里的可见文本，不生成任何隐藏后缀。
 *
 * @param {{ items: object[], total: number, limit: number, hint: string }} result 检索结果
 * @param {string} [preferredPresetId] 本次按哪个预设过滤（命中时该模型的模板排在最前）
 */
function describeRecipeResult(result, preferredPresetId = '') {
  if (result.items.length === 0) return result.hint

  const lines = []
  const truncated = result.total > result.items.length
  lines.push(
    `找到 ${result.items.length} 条配方` +
      `${truncated ? `（匹配 ${result.total} 条，已按 limit=${result.limit} 截断）` : ''}；` +
      `配方库共 ${RECIPES.length} 条：`,
  )
  for (const recipe of result.items) {
    lines.push(
      `【${recipe.title}】（${recipe.id}）· 分类：${categoryLabelOf(recipe.category)} · 建议比例：${recipe.ratioId}`,
    )
    lines.push(`  标签：${recipe.tags.join('、')}`)
    // 按提示词写法分组：同一写法的多个模型共用一份模板，避免重复贴同一段文本。
    const presetIds =
      preferredPresetId && recipe.recommendedPresets.includes(preferredPresetId)
        ? [preferredPresetId, ...recipe.recommendedPresets.filter((id) => id !== preferredPresetId)]
        : recipe.recommendedPresets
    const groups = new Map()
    for (const presetId of presetIds) {
      const preset = PRESETS.find((item) => item.id === presetId)
      const resolved = templateFor(recipe, preset)
      if (!resolved) continue
      const group = groups.get(resolved.style) ?? {
        style: resolved.style,
        template: resolved.template,
        presets: [],
      }
      group.presets.push(preset ?? { id: presetId, label: presetId })
      groups.set(resolved.style, group)
    }
    lines.push(`  适配模型与提示词模板（把 ${SUBJECT_PLACEHOLDER} 换成具体英文主体描述）：`)
    for (const group of groups.values()) {
      lines.push(
        `  - ${promptStyleName(group.style)} · ${group.presets.map((preset) => `${preset.label}（${preset.id}）`).join('、')}`,
      )
      lines.push(`    模板：${group.template}`)
    }
    lines.push(
      `  负向提示词：${recipe.negativePrompt?.trim() ? recipe.negativePrompt : '留空，主要靠正向描述表达'}`,
    )
    lines.push(`  说明：${recipe.notes}`)
  }
  lines.push(
    `模板里的 ${SUBJECT_PLACEHOLDER} 是唯一占位符：替换成具体的英文主体描述，再按需要在模板上增删词句；` +
      '配方只提供可见文本，工具不会自动追加任何风格后缀。选定 presetId 后调用 imagen_generate 或 imagen_batch。',
  )
  return lines.join('\n')
}

const defaultPreset = presetById(DEFAULT_PRESET)
const sizeLabel = `${defaultPreset.size}²`
// 模型库知识注入工具描述：让 Agent 选 presetId 时看到每个模型的写法、负向词能力与专长。
const modelCatalog = modelCatalogText()

const textOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
}

const generateParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', description: `画面描述，建议英文，不超过 ${LIMITS.prompt.maxChars} 字符` },
    negativePrompt: {
      type: 'string',
      description:
        '排除项（反向提示词）。只在所选模型真的消费负向词且 CFG > 0 时生效：' +
        'CFG=0 的极速模型或不支持负向词的模型会忽略它（各模型能力见工具说明的模型库），' +
        '需要排除内容时改用正面描述',
    },
    presetId: {
      type: 'string',
      enum: PRESETS.map((preset) => preset.id),
      description: `模型预设 id；默认 ${DEFAULT_PRESET}（${sizeLabel}，${defaultPreset.steps} 步，约 ${Math.round(defaultPreset.steadySeconds)} 秒）。具体写法与专长见工具说明的模型库；不确定时保持默认`,
    },
    width: { type: 'integer', description: `宽度 ${LIMITS.width.min}-${LIMITS.width.max}，默认取预设` },
    height: { type: 'integer', description: `高度 ${LIMITS.height.min}-${LIMITS.height.max}，默认取预设` },
    steps: { type: 'integer', description: `采样步数 ${LIMITS.steps.min}-${LIMITS.steps.max}，默认取预设` },
    cfg: { type: 'number', description: `CFG ${LIMITS.cfg.min}-${LIMITS.cfg.max}，默认取预设` },
    seed: { type: 'integer', description: '随机种子，省略则随机' },
    count: { type: 'integer', description: `张数 ${LIMITS.count.min}-${LIMITS.count.max}，默认 ${LIMITS.count.min}` },
    waitSeconds: {
      type: 'integer',
      description: `最多等待多少秒（${LIMITS.waitSeconds.min}-${LIMITS.waitSeconds.max}，默认 ${LIMITS.waitSeconds.default}）。首次生成需要排队与加载模型时可能超时，超时后任务仍在后台继续`,
    },
    saveTo: {
      type: 'string',
      description:
        '可选：把图片同时交付到工作区内的相对路径，例如 docs/assets/hero。' +
        '未写扩展名时自动补 .png；count 大于 1 时按 -01、-02 追加序号；' +
        '只接受相对路径（不允许绝对路径、..、imagen-output/ 或 .imagen/）。原始归档照常生成在 imagen-output/',
    },
  },
}

// 高清放大：源图来自画廊已落盘的作品，只接受工作区相对路径（不接受上传 base64）。
const upscaleParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description:
        `工作区相对的源图路径，必须是 ${OUTPUT_DIR}/ 内的作品，例如 ${OUTPUT_DIR}/20260101-120000-j_1a2b3c4d/01.png。` +
        `源图长边不能超过 ${UPSCALE.maxInputEdge}px（输出长宽固定 ×${UPSCALE.factor}）`,
    },
    waitSeconds: {
      type: 'integer',
      description: `最多等待多少秒（${LIMITS.waitSeconds.min}-${LIMITS.waitSeconds.max}，默认 ${LIMITS.waitSeconds.default}）。超时后任务仍在后台继续`,
    },
    saveTo: {
      type: 'string',
      description:
        '可选：把放大结果同时交付到工作区内的相对路径，例如 docs/assets/hero-upscaled。' +
        '未写扩展名时自动补 .png；只接受相对路径（不允许绝对路径、..、imagen-output/ 或 .imagen/）。原始归档照常生成在 imagen-output/',
    },
  },
}

const sessionParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['start', 'stop', 'status'] },
    presetId: { type: 'string', enum: PRESETS.map((preset) => preset.id) },
  },
}

const historyParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', description: `返回条数 ${LIMITS.historyTool.defaultLimit}-${LIMITS.historyTool.maxLimit}，默认 ${LIMITS.historyTool.defaultLimit}` },
  },
}

const cancelParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: {
    jobId: { type: 'string', description: '要取消的任务 ID（来自 imagen_generate 返回结果）' },
  },
}

// 配方检索的默认条数由数据侧决定（见 shared/recipes.js），工具描述不重复写死数字。
const recipesDefaultLimit = searchRecipes().limit

// 批量条目：每项一个独立任务（每项出 1 张），只允许逐项覆盖与单张出图有关的字段。
const batchItemParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', description: `画面描述，建议英文，不超过 ${LIMITS.prompt.maxChars} 字符` },
    negativePrompt: {
      type: 'string',
      description:
        '本条任务的排除项（反向提示词）。只在所选模型消费负向词且 CFG > 0 时生效，' +
        '不支持负向词的模型会忽略它；需要排除内容时改用正面描述',
    },
    seed: { type: 'integer', description: '本条任务的随机种子，省略则随机' },
    saveTo: {
      type: 'string',
      description:
        '可选：把本条产物同时交付到工作区内的相对路径，例如 docs/assets/hero。' +
        '未写扩展名时自动补 .png；只接受相对路径（不允许绝对路径、..、imagen-output/ 或 .imagen/）；多条任务不要使用同一个 saveTo',
    },
  },
}

const batchParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.batch.maxItems,
      items: batchItemParameters,
      description: `任务列表，1-${LIMITS.batch.maxItems} 条；每条独立入队、独立成败，单条失败不影响其余任务`,
    },
    presetId: {
      type: 'string',
      enum: PRESETS.map((preset) => preset.id),
      description: `公共模型预设，对全部条目生效；默认 ${DEFAULT_PRESET}（${sizeLabel}，${defaultPreset.steps} 步）。具体写法与专长见 imagen_generate 的模型库`,
    },
    width: { type: 'integer', description: `公共宽度 ${LIMITS.width.min}-${LIMITS.width.max}，默认取预设` },
    height: { type: 'integer', description: `公共高度 ${LIMITS.height.min}-${LIMITS.height.max}，默认取预设` },
    steps: { type: 'integer', description: `公共采样步数 ${LIMITS.steps.min}-${LIMITS.steps.max}，默认取预设` },
    cfg: { type: 'number', description: `公共 CFG ${LIMITS.cfg.min}-${LIMITS.cfg.max}，默认取预设` },
    waitSeconds: {
      type: 'integer',
      description:
        `本次调用的总等待预算（${LIMITS.waitSeconds.min}-${LIMITS.waitSeconds.max} 秒，默认 ${LIMITS.waitSeconds.default}），不是每条任务的单独预算：` +
        '预算用尽后返回已完成与未完成情况，未完成任务仍在后台继续，可用返回的 jobId 配合 imagen_history 轮询',
    },
  },
}

const recipesParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keyword: {
      type: 'string',
      description: '风格关键词，例如 日系、赛博霓虹、极简海报；多个词用空格或逗号分隔，需全部命中',
    },
    category: {
      type: 'string',
      enum: RECIPE_CATEGORIES.map((item) => item.id),
      description: `风格分类：${RECIPE_CATEGORIES.map((item) => `${item.id}（${item.label}）`).join('、')}`,
    },
    presetId: {
      type: 'string',
      enum: PRESETS.map((preset) => preset.id),
      description: '按适配的模型预设过滤，例如 animagine-xl-3.1',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '按标签过滤，需全部命中；标签示例见返回结果',
    },
    limit: {
      type: 'integer',
      description: `返回条数 1-${RECIPES.length}，默认 ${recipesDefaultLimit}`,
    },
  },
}

/**
 * 注册 7 个 Agent 工具；宿主没有 tools 服务时静默跳过。
 *
 * @param {object} ctx 宿主上下文
 * @param {{ queue: object, session: object, defaultPreset: string }} deps
 */
export function registerTools(ctx, { queue, session, defaultPreset }) {
  if (!ctx.tools) return

  ctx.tools.register({
    name: 'imagen_generate',
    description:
      '在免费的 Kaggle GPU 上运行开源文生图模型并出图，图片会保存到工作区 imagen-output/ 目录。' +
      '首次调用若远端会话未启动，会自动拉起 Kernel（可能需要排队 10 分钟以上），此时建议 waitSeconds 保持较小并稍后用 imagen_history 查看结果。' +
      '等待超时不影响任务继续执行：返回里的 jobId（形如 j_1a2b3c4d）可配合 imagen_cancel 取消，或用 imagen_history 轮询结果；传入 saveTo 可把图片直接交付到工作区路径。' +
      '需要风格参考时，先用 imagen_recipes 检索公开的提示词模板，再把模板显式改写进 prompt；工具不会自动追加任何风格后缀。' +
      `\n可用模型（presetId，按专长与提示词写法选择；默认 ${DEFAULT_PRESET}）：\n${modelCatalog}`,
    parameters: generateParameters,
    output: textOutput,
    async execute(args = {}) {
      // 交付路径先做完整校验（含软链接逃逸）：非法时直接告诉模型原因，不占用队列。
      if (args.saveTo !== undefined && args.saveTo !== null && args.saveTo !== '') {
        const target = await resolveWorkspaceWritePath(ctx, args.saveTo)
        if (!target.ok) return { text: `提交失败：${target.message}` }
      }
      const submitted = queue.submit(args)
      if (!submitted.ok) return { text: `提交失败：${submitted.message}` }
      const waitSeconds = toInt(args.waitSeconds, LIMITS.waitSeconds.default, LIMITS.waitSeconds.min, LIMITS.waitSeconds.max)
      const job = await queue.waitFor(submitted.job.id, waitSeconds)
      return { text: describeJob(job) }
    },
  })

  ctx.tools.register({
    name: 'imagen_upscale',
    description:
      `把工作区 ${OUTPUT_DIR}/ 里已有的一张作品高清放大 ${UPSCALE.factor} 倍（Real-ESRGAN 轻量超分，不加载扩散模型）。` +
      `只支持 PNG / JPEG 且源图长边不超过 ${UPSCALE.maxInputEdge}px；输出作为该作品的派生版本归档到 ${OUTPUT_DIR}/，` +
      '可在 imagen_history 或版本树里看到。' +
      '首次调用若远端会话未启动会自动拉起 Kernel，等待超时不影响任务继续执行：返回里的 jobId 可配合 imagen_history 轮询，或用 imagen_cancel 取消。',
    parameters: upscaleParameters,
    output: textOutput,
    async execute(args = {}) {
      const requested = typeof args.path === 'string' ? args.path.trim() : ''
      if (!requested) return { text: `提交失败：path 不能为空，需要传入 ${OUTPUT_DIR}/ 内的作品路径` }
      // 源图必须真实存在且落在产物目录内（含软链接逃逸检查）：放大的是本机已落盘的作品。
      const source = await resolveOutputPath(ctx, requested)
      if (!source) return { text: `提交失败：源图不存在或不在 ${OUTPUT_DIR}/ 内（${requested}）` }
      let info = null
      try {
        info = parseImageHeader(await readFile(source.absolute))
      } catch {
        info = null
      }
      if (!info) return { text: '提交失败：源图不是可识别的 PNG / JPEG' }
      const longEdge = Math.max(info.width, info.height)
      if (longEdge > UPSCALE.maxInputEdge) {
        return {
          text: `提交失败：源图长边 ${longEdge}px 超过 ${UPSCALE.maxInputEdge}px 上限，请先换到更小的画幅再放大`,
        }
      }
      // 交付路径与 imagen_generate 同一套校验：非法时直接告诉模型原因，不占用队列。
      let saveTo = null
      if (args.saveTo !== undefined && args.saveTo !== null && args.saveTo !== '') {
        const target = await resolveWorkspaceWritePath(ctx, args.saveTo)
        if (!target.ok) return { text: `提交失败：${target.message}` }
        saveTo = target.relative
      }

      // 宽高由 Host 从 PNG/JPEG 头部读出：客户端（Agent）不需要自己算尺寸，
      // 也避免浏览器侧拿不到图片信息时漏传导致远端兜底失败。
      const request = {
        tool: 'upscale',
        prompt: '',
        width: info.width,
        height: info.height,
        reference: { path: source.relative },
        autoStart: true,
      }
      if (saveTo) request.saveTo = saveTo
      const submitted = queue.submit(request)
      if (!submitted.ok) return { text: `提交失败：${submitted.message}` }
      const waitSeconds = toInt(args.waitSeconds, LIMITS.waitSeconds.default, LIMITS.waitSeconds.min, LIMITS.waitSeconds.max)
      const job = await queue.waitFor(submitted.job.id, waitSeconds)
      return { text: describeJob(job) }
    },
  })

  ctx.tools.register({
    name: 'imagen_batch',
    description:
      `按一组提示词批量出图（单次 1-${LIMITS.batch.maxItems} 条，适合文章配图、分镜与系列插画）：` +
      '全部条目共享 presetId/width/height/steps/cfg，逐条提交到同一串行队列；每条任务只出 1 张图。' +
      '单条校验不通过或生成失败只影响该条，其余任务照常执行；汇总里给出成功产物的路径与 URL、失败原因、未完成任务 jobId。' +
      'waitSeconds 是本次调用的总等待预算（不是每条任务的预算）：预算用尽后未完成任务仍在后台继续，可用 jobId 配合 imagen_history 轮询，或用 imagen_cancel 取消。' +
      '需要风格参考时，先用 imagen_recipes 检索提示词模板，再把模板显式改写进各条 prompt；工具不会自动追加任何风格后缀。',
    parameters: batchParameters,
    output: textOutput,
    async execute(args = {}) {
      const items = args.items
      if (!Array.isArray(items) || items.length === 0) {
        return { text: '提交失败：items 必须是非空数组，每项至少包含 prompt；本次未提交任何任务。' }
      }
      if (items.length > LIMITS.batch.maxItems) {
        return {
          text:
            `提交失败：items 共 ${items.length} 条，超过单次上限 ${LIMITS.batch.maxItems} 条；` +
            '请拆成多次调用，本次未提交任何任务。',
        }
      }

      // 公共参数只取契约登记过的字段；条目参数逐项白名单取值，未知字段不带进队列。
      const jobDefaults = {}
      for (const key of ['presetId', 'width', 'height', 'steps', 'cfg']) {
        if (args[key] !== undefined && args[key] !== null) jobDefaults[key] = args[key]
      }
      const waitBudget = toInt(
        args.waitSeconds,
        LIMITS.waitSeconds.default,
        LIMITS.waitSeconds.min,
        LIMITS.waitSeconds.max,
      )

      const records = []
      const saveToOwners = new Map()
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const record = { index, prompt: '', jobId: null, reject: null, job: null }
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          record.reject = '条目必须是对象，且包含 prompt 字段'
          records.push(record)
          continue
        }
        record.prompt = typeof item.prompt === 'string' ? item.prompt : ''
        // saveTo 逐项做完整校验（含软链接逃逸）：非法项只标记该条失败，不占用队列。
        let saveTo = null
        if (item.saveTo !== undefined && item.saveTo !== null && item.saveTo !== '') {
          const target = await resolveWorkspaceWritePath(ctx, item.saveTo)
          if (!target.ok) {
            record.reject = `saveTo 不可用：${target.message}`
            records.push(record)
            continue
          }
          const key = target.relative.toLowerCase()
          if (saveToOwners.has(key)) {
            record.reject =
              `saveTo 与第 ${saveToOwners.get(key) + 1} 条重复（${target.relative}），为避免互相覆盖已跳过`
            records.push(record)
            continue
          }
          saveToOwners.set(key, index)
          saveTo = target.relative
        }

        const request = { ...jobDefaults, prompt: item.prompt }
        if (item.negativePrompt !== undefined && item.negativePrompt !== null) {
          request.negativePrompt = item.negativePrompt
        }
        if (item.seed !== undefined && item.seed !== null) request.seed = item.seed
        if (saveTo) request.saveTo = saveTo
        try {
          const submitted = queue.submit(request)
          if (submitted.ok) record.jobId = submitted.job.id
          else record.reject = `${submitted.code}：${submitted.message}`
        } catch (error) {
          // 单条提交异常也只影响该条，剩余任务继续入队。
          record.reject = `提交异常：${error?.message ?? error}`
        }
        records.push(record)
      }

      // 所有任务共享同一段等待预算：按提交顺序串行等待，预算用尽即停止等待。
      // 未等待到的任务不会被取消，仍在队列里继续执行。
      const deadline = Date.now() + waitBudget * 1000
      for (const record of records) {
        if (!record.jobId) continue
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) break
        try {
          await queue.waitFor(record.jobId, remainingMs / 1000)
        } catch {
          // 等待异常不应拖垮整批汇总：按当前快照继续收集结果。
          break
        }
      }
      for (const record of records) {
        if (record.jobId) record.job = queue.get(record.jobId)
      }
      return { text: describeBatchResult(records, waitBudget) }
    },
  })

  ctx.tools.register({
    name: 'imagen_recipes',
    description:
      '只读检索透明风格配方库：按关键词、风格分类、标签或 presetId 查找可读的提示词模板与适配模型。' +
      `配方只返回可见文本（模板里用 ${SUBJECT_PLACEHOLDER} 占位），不会替用户拼接任何样式后缀；` +
      '拿到结果后把模板显式改写进 prompt，再调用 imagen_generate 或 imagen_batch。无匹配时返回可执行的检索建议。',
    parameters: recipesParameters,
    output: textOutput,
    async execute(args = {}) {
      const presetId = typeof args.presetId === 'string' ? args.presetId : ''
      const result = searchRecipes({
        keyword: typeof args.keyword === 'string' ? args.keyword : '',
        category: typeof args.category === 'string' ? args.category : '',
        presetId,
        tags: Array.isArray(args.tags) ? args.tags : [],
        limit: args.limit,
      })
      return { text: describeRecipeResult(result, presetId) }
    },
  })

  ctx.tools.register({
    name: 'imagen_session',
    description:
      '管理远端生图会话：start 拉起 Kaggle Kernel（幂等，已在运行则直接返回），stop 关机释放 GPU 配额，status 查看当前状态。',
    parameters: sessionParameters,
    output: textOutput,
    async execute(args = {}) {
      const action = String(args.action ?? 'status')
      if (action === 'start') {
        const snapshot = await session.start(presetById(args.presetId ?? defaultPreset).id)
        return { text: describeSession(snapshot) }
      }
      if (action === 'stop') {
        const snapshot = await session.stop()
        return { text: describeSession(snapshot) }
      }
      return { text: describeSession(session.snapshot()) }
    },
  })

  ctx.tools.register({
    name: 'imagen_history',
    description: '列出最近生成过的图片（工作区 imagen-output/ 下的产物），返回路径与提示词，可用于回填或引用。',
    parameters: historyParameters,
    output: textOutput,
    async execute(args = {}) {
      const limit = toInt(args.limit, LIMITS.historyTool.defaultLimit, 1, LIMITS.historyTool.maxLimit)
      // scanHistory 自历史分页改造后返回 { items, hasMore }；工具只需要最近几条记录。
      const { items } = await scanHistory(ctx, limit)
      if (items.length === 0) return { text: '还没有生成记录。' }
      const lines = []
      for (const item of items) {
        lines.push(`${item.createdAt ?? item.dir} · ${item.presetId ?? '未知预设'}`)
        lines.push(`  ${String(item.prompt ?? '').slice(0, 120)}`)
        for (const image of item.images) lines.push(`  ${image.path}`)
      }
      return { text: lines.join('\n') }
    },
  })

  ctx.tools.register({
    name: 'imagen_cancel',
    description:
      '取消一个已提交的生图任务：排队中的任务立即出队失效；正在生成的任务做合作式停止（当前这张出完后不再生成剩余张数，已出的图仍保留）。jobId 来自 imagen_generate 的返回结果。',
    parameters: cancelParameters,
    output: textOutput,
    async execute(args = {}) {
      const jobId = String(args.jobId ?? '').trim()
      const result = queue.cancel(jobId)
      if (!result.ok) return { text: `未找到任务 ${jobId}` }
      if (result.disposition === 'dequeued') {
        return { text: `已取消任务 ${jobId}（已从队列移除）` }
      }
      if (result.disposition === 'cooperative') {
        return {
          text: `已向任务 ${jobId} 发送合作式取消请求：当前正在生成的单张完成后将停止，不再继续后续张数，已出图像仍保留`,
        }
      }
      return { text: `任务 ${jobId} 已处于终态（${result.job?.status ?? 'unknown'}），无需取消` }
    },
  })
}