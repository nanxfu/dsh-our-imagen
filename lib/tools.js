/**
 * DSH Agent 工具注册：imagen_generate / imagen_session / imagen_history。
 *
 * 这里只放「给模型看的描述 + 执行 + 文案」；宿主入口 index.js 只负责装配。
 * 工具参数边界取自 `shared/contract.js` 的 LIMITS（唯一来源）。
 */

import { LIMITS, PRESETS } from '../shared/contract.js'
import { scanHistory } from './output.js'
import { DEFAULT_PRESET, presetById } from './presets.js'
import { toInt } from './route-kit.js'

/** 把 job 折叠成一段给模型看的文字。 */
export function describeJob(job) {
  if (!job) return '任务不存在'
  const lines = []
  lines.push(`任务 ${job.id}：${job.status}${job.seconds != null ? `（${job.seconds}s）` : ''}`)
  lines.push(`预设：${job.presetId} · 尺寸 ${job.params.width}×${job.params.height} · ${job.params.steps} 步 · cfg ${job.params.cfg} · seed ${job.params.seed}`)
  if (job.error) lines.push(`错误：${job.error.code} ${job.error.message}`)
  if (job.output?.images?.length) {
    lines.push('产物：')
    for (const image of job.output.images) {
      lines.push(`- ${image.path}（${image.width}×${image.height}，seed ${image.seed}）`)
      if (image.url) lines.push(`  ${image.url}`)
    }
    lines.push('提示：可以直接在回复里用 ![描述](URL) 展示图片。')
  } else if (job.status !== 'done') {
    lines.push('任务仍在进行中，可用 imagen_history 或再次调用查看结果。')
  }
  return lines.join('\n')
}

/** 把会话快照折叠成一段给模型看的文字。 */
export function describeSession(session) {
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

const defaultPreset = presetById(DEFAULT_PRESET)
const sizeLabel = `${defaultPreset.size}²`

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
    negativePrompt: { type: 'string', description: '反向提示词，仅在 cfg > 0 时生效' },
    presetId: {
      type: 'string',
      enum: PRESETS.map((preset) => preset.id),
      description: `模型预设；默认 ${DEFAULT_PRESET}（${sizeLabel}，${defaultPreset.steps} 步，约 ${Math.round(defaultPreset.steadySeconds)} 秒）`,
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

/**
 * 注册 3 个 Agent 工具；宿主没有 tools 服务时静默跳过。
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
      '首次调用若远端会话未启动，会自动拉起 Kernel（可能需要排队 10 分钟以上），此时建议 waitSeconds 保持较小并稍后用 imagen_history 查看结果。',
    parameters: generateParameters,
    output: textOutput,
    async execute(args = {}) {
      const submitted = queue.submit(args)
      if (!submitted.ok) return { text: `提交失败：${submitted.message}` }
      const waitSeconds = toInt(args.waitSeconds, LIMITS.waitSeconds.default, LIMITS.waitSeconds.min, LIMITS.waitSeconds.max)
      const job = await queue.waitFor(submitted.job.id, waitSeconds)
      return { text: describeJob(job) }
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
      const items = await scanHistory(ctx, limit)
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
}