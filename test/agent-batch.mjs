/**
 * Agent 批量创作与透明配方库的离线测试（不联网、不启动 daemon）。
 *
 * 做法：用假 cordis Context 收集 `registerTools` 注册的工具，用假队列回放
 * `submit` / `waitFor` / `get` 的返回，逐项断言：
 *   参数 schema 边界来自契约、批量上限、单条失败隔离、部分成功汇总、
 *   saveTo 逐项校验、总等待预算有界、配方检索过滤与数据合法性、空结果提示。
 *
 * 运行：node test/agent-batch.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerTools } from '../lib/tools.js'
import { LIMITS, PRESETS, RATIO_IDS, UPSCALE } from '../shared/contract.js'
import {
  RECIPES,
  RECIPE_CATEGORIES,
  SUBJECT_PLACEHOLDER,
  categoryLabelOf,
  searchRecipes,
  templateFor,
  validateRecipes,
} from '../shared/recipes.js'
import { createCheckRunner } from './helpers/check.mjs'

const PRESET_IDS = PRESETS.map((preset) => preset.id)
// 文生图（imagen_generate / imagen_batch）的 presetId 取值域：剔除 inpaintOnly 专用重绘权重。
const TEXT_TO_IMAGE_PRESET_IDS = PRESETS.filter((preset) => preset.inpaintOnly !== true).map((preset) => preset.id)
const TOOL_NAMES = [
  'imagen_batch',
  'imagen_cancel',
  'imagen_generate',
  'imagen_history',
  'imagen_recipes',
  'imagen_session',
  'imagen_upscale',
]

/**
 * 构造「头部可解析」的源图夹具：imagen_upscale 只用 PNG 头部读宽高，测试不引入图像依赖。
 */
function headerOnlyPng(width, height) {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'latin1')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

/** 假任务：默认立即完成；可按 prompt 指定失败 / 挂起状态。 */
function createFakeJob(id, request, state) {
  const params = {
    prompt: request.prompt,
    negativePrompt: request.negativePrompt ?? '',
    width: request.width ?? 1024,
    height: request.height ?? 1024,
    steps: request.steps ?? 4,
    cfg: request.cfg ?? 0,
    seed: request.seed ?? 1,
    count: 1,
  }
  const base = {
    id,
    // 阶段十五 Phase B：工具可用 tool 指定请求类型（imagen_upscale 提交的是 upscale）。
    tool: request.tool ?? 'generate',
    presetId: request.presetId ?? 'sdxl-lightning',
    params,
    seconds: 1,
    output: null,
    error: null,
  }
  if (state === 'failed') {
    return { ...base, status: 'failed', error: { code: 'generate_failed', message: '远端生成失败' } }
  }
  if (state === 'cancelled') return { ...base, status: 'cancelled' }
  if (state === 'queued' || state === 'running') return { ...base, status: state }
  return {
    ...base,
    status: 'done',
    output: {
      images: [
        {
          path: `imagen-output/fake-${id}/01.png`,
          url: `http://127.0.0.1/imagen-api/file?path=fake-${id}`,
          width: params.width,
          height: params.height,
          seed: params.seed,
        },
      ],
      deliveredPaths: request.saveTo ? [request.saveTo] : [],
    },
  }
}

/**
 * 假队列。
 *
 * @param {object} [options]
 * @param {Record<string, string>} [options.submitFailures] prompt → 提交失败原因
 * @param {Record<string, string>} [options.jobStates] prompt → 任务状态（failed / cancelled / queued / running）
 */
function createFakeQueue({ submitFailures = {}, jobStates = {} } = {}) {
  const submits = []
  const waitCalls = []
  const jobs = new Map()
  let sequence = 0
  return {
    submits,
    waitCalls,
    jobs,
    submit(request) {
      submits.push({ ...request })
      if (submitFailures[request.prompt]) {
        return { ok: false, code: 'queue_full', message: submitFailures[request.prompt] }
      }
      sequence += 1
      const job = createFakeJob(`j_batch_${sequence}`, request, jobStates[request.prompt])
      jobs.set(job.id, job)
      return { ok: true, job }
    },
    async waitFor(id, seconds) {
      waitCalls.push({ id, seconds })
      // 离线测试不按真实秒数等待：最多睡 50ms 后返回当前快照。
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(seconds) || 0, 0.05) * 1000))
      return jobs.get(id) ?? null
    },
    get(id) {
      return jobs.get(id) ?? null
    },
  }
}

/** 创建注册好工具的环境。 */
function createTools(workspace, queueOptions = {}) {
  const registered = []
  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    get: (name) => (name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined),
  }
  const queue = createFakeQueue(queueOptions)
  registerTools(ctx, {
    queue,
    session: { snapshot: () => ({ state: 'ready' }) },
    defaultPreset: 'sdxl-lightning',
  })
  return {
    registered,
    queue,
    tool(name) {
      const found = registered.find((item) => item.name === name)
      assert.ok(found, `缺少工具 ${name}`)
      return found
    },
  }
}

const { check, summary } = createCheckRunner()

async function main() {
  const workspace = await mkdtemp(join(tmpdir(), 'imagen-agent-batch-'))

  await check('工具注册：7 个工具均带参数 schema 与文本输出', () => {
    const { registered } = createTools(workspace)
    assert.deepEqual(
      registered.map((tool) => tool.name).sort(),
      TOOL_NAMES,
      '注册的工具名单应与任务约定一致',
    )
    for (const tool of registered) {
      assert.equal(tool.parameters?.type, 'object', `${tool.name} 参数根必须是 object`)
      assert.equal(tool.parameters.additionalProperties, false, `${tool.name} 必须禁止未知参数`)
      assert.equal(typeof tool.output?.render, 'function', `${tool.name} 缺少 output.render`)
    }
  })

  await check('imagen_batch 参数 schema 边界来自契约', () => {
    const { tool } = createTools(workspace)
    const batch = tool('imagen_batch').parameters
    const properties = batch.properties

    assert.deepEqual(batch.required, ['items'])
    assert.equal(properties.items.type, 'array')
    assert.equal(properties.items.minItems, 1)
    assert.equal(properties.items.maxItems, LIMITS.batch.maxItems, '批量上限必须引用 LIMITS.batch.maxItems')

    // 公共参数的数字边界与说明必须来自契约，不能各写一份。
    for (const [key, limit] of [
      ['width', LIMITS.width],
      ['height', LIMITS.height],
      ['steps', LIMITS.steps],
      ['cfg', LIMITS.cfg],
    ]) {
      assert.equal(properties[key].type, key === 'cfg' ? 'number' : 'integer', `${key} 类型不正确`)
      assert.ok(
        properties[key].description.includes(`${limit.min}-${limit.max}`),
        `${key} 说明应包含契约边界 ${limit.min}-${limit.max}`,
      )
    }
    assert.ok(
      properties.waitSeconds.description.includes('总等待预算'),
      'waitSeconds 是整批的总等待预算，说明必须写清语义',
    )
    assert.ok(properties.waitSeconds.description.includes(`${LIMITS.waitSeconds.min}-${LIMITS.waitSeconds.max}`))
    assert.ok(properties.waitSeconds.description.includes(`默认 ${LIMITS.waitSeconds.default}`))
    assert.deepEqual(properties.presetId.enum, TEXT_TO_IMAGE_PRESET_IDS, 'presetId 枚举必须剔除 inpaintOnly 专用重绘权重（宿主入队会拒，schema 源头不给这个选项）')

    const item = properties.items.items
    assert.equal(item.type, 'object')
    assert.equal(item.additionalProperties, false)
    assert.deepEqual(item.required, ['prompt'])
    assert.deepEqual(Object.keys(item.properties).sort(), ['negativePrompt', 'prompt', 'saveTo', 'seed'])
    assert.ok(item.properties.prompt.description.includes(`${LIMITS.prompt.maxChars}`), 'prompt 上限应引用契约')
  })

  await check('imagen_generate presetId 枚举与描述模型库同口径剔除 inpaintOnly', () => {
    const { tool } = createTools(workspace)
    const properties = tool('imagen_generate').parameters.properties

    // 文生图 schema 源头剔除专用重绘权重：此前依赖宿主入队时运行时拒绝。
    assert.deepEqual(properties.presetId.enum, TEXT_TO_IMAGE_PRESET_IDS)
    assert.ok(!properties.presetId.enum.includes('sdxl-inpaint'), '文生图 schema 不得出现 sdxl-inpaint')
    assert.ok(properties.presetId.enum.includes('sdxl-lightning'), '可文生图预设照常可选')
    const inpaintOnlyCount = PRESETS.filter((preset) => preset.inpaintOnly === true).length
    assert.equal(properties.presetId.enum.length, PRESET_IDS.length - inpaintOnlyCount, '文生图枚举应剔除全部 inpaintOnly 预设')
    // 描述里的模型库与枚举保持同一份口径：不把枚举外的模型介绍给 Agent。
    const description = tool('imagen_generate').description
    assert.ok(description.includes('sdxl-lightning'), '模型库应包含默认模型')
    assert.ok(!description.includes('sdxl-inpaint'), '模型库不得描述 inpaintOnly 预设')
    // 会话预载可指向任意模型（舞台图片工具要用的专用权重允许先加载）；配方检索是只读过滤。
    assert.deepEqual(tool('imagen_session').parameters.properties.presetId.enum, PRESET_IDS, '会话预载保留全部预设')
    assert.deepEqual(tool('imagen_recipes').parameters.properties.presetId.enum, PRESET_IDS, '配方检索保留全部预设')
  })

  await check('imagen_recipes 参数 schema 引用配方分类与契约预设', () => {
    const { tool } = createTools(workspace)
    const parameters = tool('imagen_recipes').parameters
    assert.deepEqual(parameters.properties.presetId.enum, PRESET_IDS)
    assert.deepEqual(parameters.properties.category.enum, RECIPE_CATEGORIES.map((item) => item.id))
    assert.equal(parameters.properties.tags.type, 'array')
    assert.equal(parameters.properties.limit.type, 'integer')
    assert.ok(
      parameters.properties.limit.description.includes(`${RECIPES.length}`),
      'limit 上界应为配方总数（由数据决定，不写死数字）',
    )
    assert.deepEqual(parameters.required, undefined, 'imagen_recipes 是可选过滤的只读检索，不需要必填参数')
  })

  await check('imagen_upscale：参数 schema、源图宽高读取与 tool=upscale 提交', async () => {
    const { tool, queue } = createTools(workspace)
    const parameters = tool('imagen_upscale').parameters
    assert.deepEqual(parameters.required, ['path'])
    assert.deepEqual(Object.keys(parameters.properties).sort(), ['path', 'saveTo', 'waitSeconds'])
    assert.ok(
      parameters.properties.path.description.includes(`${UPSCALE.maxInputEdge}`),
      'path 说明应给出源图长边上限',
    )

    // 非法路径 / 不存在的作品：直接返回提交失败，不占用队列。
    for (const bad of ['../index.js', '/abs/path.png', 'docs/assets/hero.png', 'imagen-output/no-such/01.png']) {
      const value = await tool('imagen_upscale').execute({ path: bad })
      assert.match(value.text, /^提交失败：/, `${bad} → ${value.text}`)
    }
    assert.equal(queue.submits.length, 0, '非法源图不得提交队列')

    // 合法源图：宽高由 Host 从 PNG 头部读取，固定 1 张、提示词为空、tool=upscale。
    const dir = join(workspace, 'imagen-output', '20260101-000000-upscale-agent')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '01.png'), headerOnlyPng(1024, 768))
    const value = await tool('imagen_upscale').execute({
      path: 'imagen-output/20260101-000000-upscale-agent/01.png',
      waitSeconds: 1,
    })
    assert.match(value.text, /高清放大（×2）/, value.text)
    assert.match(value.text, /源图 1024×768/, '工具应回显从 PNG 头部读出的源图尺寸')
    assert.equal(queue.submits.length, 1)
    const request = queue.submits[0]
    assert.equal(request.tool, 'upscale')
    assert.equal(request.prompt, '')
    assert.equal(request.width, 1024)
    assert.equal(request.height, 768)
    assert.deepEqual(request.reference, { path: 'imagen-output/20260101-000000-upscale-agent/01.png' })
    assert.equal(request.autoStart, true)

    // 超限源图：Host 读头部后按 UPSCALE.maxInputEdge 拒绝，不提交队列。
    const largeDir = join(workspace, 'imagen-output', '20260101-000000-upscale-large')
    await mkdir(largeDir, { recursive: true })
    await writeFile(join(largeDir, '01.png'), headerOnlyPng(1536, 1024))
    const tooLarge = await tool('imagen_upscale').execute({
      path: 'imagen-output/20260101-000000-upscale-large/01.png',
    })
    assert.match(tooLarge.text, /^提交失败：/)
    assert.match(tooLarge.text, new RegExp(String(UPSCALE.maxInputEdge)))
    assert.equal(queue.submits.length, 1, '超限源图不得提交队列')
  })

  await check('imagen_batch 超过单次上限：整批拒绝且不提交任何任务', async () => {
    const { tool, queue } = createTools(workspace)
    const items = Array.from({ length: LIMITS.batch.maxItems + 1 }, (_, index) => ({ prompt: `上限测试 ${index}` }))
    const value = await tool('imagen_batch').execute({ items })
    assert.match(value.text, new RegExp(`超过单次上限 ${LIMITS.batch.maxItems} 条`))
    assert.match(value.text, /本次未提交任何任务/)
    assert.equal(queue.submits.length, 0, '超限时不得提交任何一条任务')
    assert.equal(queue.waitCalls.length, 0)
  })

  await check('imagen_batch 空 items / 非法 items：直接拒绝，不触碰队列', async () => {
    const { tool, queue } = createTools(workspace)
    for (const args of [{}, { items: [] }, { items: 'not-an-array' }]) {
      const value = await tool('imagen_batch').execute(args)
      assert.match(value.text, /^提交失败：items 必须是非空数组/)
    }
    assert.equal(queue.submits.length, 0)
  })

  await check('imagen_batch 单条失败隔离与部分成功汇总', async () => {
    const { tool, queue } = createTools(workspace, {
      submitFailures: { 提交失败项: '队列已满，请等待当前任务完成' },
      jobStates: { 生成失败项: 'failed' },
    })
    const value = await tool('imagen_batch').execute({
      presetId: 'z-image-turbo',
      width: 768,
      height: 1024,
      steps: 9,
      cfg: 0,
      waitSeconds: 30,
      items: [
        { prompt: '成功的荷花', seed: 7 },
        { prompt: '提交失败项' },
        { prompt: '生成失败项' },
        { prompt: '越界交付', saveTo: '../escape.png' },
        { prompt: '交付成功', saveTo: 'docs/cover' },
      ],
    })
    const text = value.text

    // 汇总头：5 条里 2 成功、3 失败；失败的 3 条分别是提交失败、生成失败、saveTo 校验失败。
    assert.match(text, /共 5 条，成功 2，失败 3，未完成 0/)
    assert.match(text, /\[1\] 成功 · 任务 j_batch_1 · 预设 Z-Image Turbo（z-image-turbo）/)
    assert.match(text, /产物：imagen-output\/fake-j_batch_1\/01\.png（768×1024，seed 7）/)
    assert.match(text, /URL：http:\/\/127\.0\.0\.1\/imagen-api\/file\?path=fake-j_batch_1/)
    assert.match(text, /\[2\] 失败（未入队）[\s\S]*原因：queue_full：队列已满/)
    assert.match(text, /\[3\] 失败 · 任务 j_batch_2[\s\S]*原因：generate_failed：远端生成失败/)
    assert.match(text, /\[4\] 失败（未入队）[\s\S]*原因：saveTo 不可用：saveTo 不允许包含 \.\./)
    // 交付目标按归一后的相对路径回显（补 .png）。
    assert.match(text, /\[5\] 成功[\s\S]*已交付至：docs\/cover\.png/)
    assert.match(text, /失败项已逐条隔离/)
    assert.match(text, /!\[描述\]\(URL\)/)

    // 公共参数合并到每条任务；条目 seed 只作用于自己那条。
    assert.equal(queue.submits.length, 4, '校验失败的条目不应占用队列')
    for (const request of queue.submits) {
      assert.equal(request.presetId, 'z-image-turbo')
      assert.equal(request.width, 768)
      assert.equal(request.height, 1024)
      assert.equal(request.steps, 9)
      assert.equal(request.cfg, 0)
    }
    assert.equal(queue.submits[0].seed, 7)
    assert.equal('seed' in queue.submits[1], false, '未指定 seed 的条目不应凭空写入 seed')
    assert.equal(queue.submits[3].saveTo, 'docs/cover.png', 'saveTo 应归一后交给队列')
  })

  await check('imagen_batch 条目参数白名单：未知字段不带进队列', async () => {
    const { tool, queue } = createTools(workspace)
    await tool('imagen_batch').execute({
      items: [{ prompt: '白名单测试', count: 4, reference: { path: 'x.png' }, bogus: true }],
    })
    assert.equal(queue.submits.length, 1)
    const request = queue.submits[0]
    assert.equal(request.count, undefined, '批量条目不允许覆盖 count（每项固定出 1 张）')
    assert.equal(request.reference, undefined, '批量条目不支持参考图字段')
    assert.equal(request.bogus, undefined)
  })

  await check('imagen_batch 总等待预算有界：未完成任务给 jobId 与轮询提示', async () => {
    const { tool, queue } = createTools(workspace, {
      jobStates: { 挂起一: 'queued', 挂起二: 'queued', 挂起三: 'running' },
    })
    const startedAt = Date.now()
    const value = await tool('imagen_batch').execute({
      waitSeconds: 2,
      items: [{ prompt: '挂起一' }, { prompt: '挂起二' }, { prompt: '挂起三' }],
    })
    const elapsedMs = Date.now() - startedAt
    const text = value.text

    assert.match(text, /共 3 条，成功 0，失败 0，未完成 3/)
    assert.match(text, /\[1\] 未完成 · 任务 j_batch_1（queued）/)
    assert.match(text, /\[3\] 未完成 · 任务 j_batch_3（running）/)
    assert.match(text, /总等待预算（2 秒）/)
    assert.match(text, /imagen_history 轮询产物/)
    assert.match(text, /imagen_cancel 按 jobId 取消/)

    // 每次 waitFor 只领「剩余预算」这一段：单次不会超过总预算，且随预算消耗单调不增。
    for (const call of queue.waitCalls) {
      assert.ok(call.seconds <= 2 + 0.01, `单次等待 ${call.seconds} 秒不应超过总预算 2 秒`)
    }
    assert.ok(
      queue.waitCalls.at(-1).seconds <= queue.waitCalls[0].seconds + 0.01,
      '后续等待领取的预算不应比第一次更多',
    )
    assert.ok(elapsedMs < 2000, `总等待预算 2 秒时不应把调用拖到 ${elapsedMs}ms`)
  })

  await check('imagen_batch waitSeconds 越界按契约钳制（默认值 / 上界）', async () => {
    const { tool, queue } = createTools(workspace, { jobStates: { 挂起: 'queued' } })

    await tool('imagen_batch').execute({ items: [{ prompt: '挂起' }] })
    const defaultSeconds = queue.waitCalls.at(-1).seconds
    assert.ok(
      defaultSeconds <= LIMITS.waitSeconds.default + 0.01 && defaultSeconds > LIMITS.waitSeconds.default - 5,
      `省略 waitSeconds 时应按契约默认值 ${LIMITS.waitSeconds.default} 秒`,
    )

    await tool('imagen_batch').execute({ waitSeconds: 9999, items: [{ prompt: '挂起' }] })
    const clampedSeconds = queue.waitCalls.at(-1).seconds
    assert.ok(
      clampedSeconds <= LIMITS.waitSeconds.max + 0.01 && clampedSeconds > LIMITS.waitSeconds.max - 5,
      `超出上界时应钳制到 ${LIMITS.waitSeconds.max} 秒，实际 ${clampedSeconds}`,
    )
  })

  await check('imagen_batch waitSeconds=0：只提交不等待', async () => {
    const { tool, queue } = createTools(workspace, { jobStates: { 不等待: 'queued' } })
    const value = await tool('imagen_batch').execute({
      waitSeconds: 0,
      items: [{ prompt: '不等待' }],
    })
    assert.equal(queue.submits.length, 1)
    assert.equal(queue.waitCalls.length, 0, 'waitSeconds=0 时不应发起等待')
    assert.match(value.text, /未完成 1/)
    assert.match(value.text, /仍在后台继续/)
  })

  await check('imagen_batch saveTo 重复检测：后一条跳过且不覆盖前一条', async () => {
    const { tool, queue } = createTools(workspace)
    const value = await tool('imagen_batch').execute({
      items: [
        { prompt: '第一张', saveTo: 'docs/x' },
        { prompt: '第二张', saveTo: './docs//x.png' },
      ],
    })
    assert.equal(queue.submits.length, 1, '重复 saveTo 的第二条不应提交')
    assert.match(value.text, /\[2\] 失败（未入队）[\s\S]*saveTo 与第 1 条重复/)
    assert.match(value.text, /共 2 条，成功 1，失败 1/)
  })

  await check('imagen_batch 全部预校验失败：成功 0 且不进入等待', async () => {
    const { tool, queue } = createTools(workspace)
    const value = await tool('imagen_batch').execute({
      items: [{ prompt: '越界一', saveTo: '../a.png' }, { prompt: '越界二', saveTo: 'C:/b.png' }],
    })
    assert.equal(queue.submits.length, 0)
    assert.equal(queue.waitCalls.length, 0)
    assert.match(value.text, /共 2 条，成功 0，失败 2，未完成 0/)
    assert.match(value.text, /已逐条隔离/)
  })

  await check('imagen_recipes 关键词检索：返回可读模板与适配模型', async () => {
    const { tool, queue } = createTools(workspace)
    const value = await tool('imagen_recipes').execute({ keyword: '日系' })
    const text = value.text
    assert.match(text, /找到 1 条配方/)
    assert.match(text, /【日系二次元插画】（anime-illustration）/)
    assert.match(text, /分类：插画/)
    assert.match(text, /建议比例：3:4/)
    assert.match(text, /Danbooru 标签 · Anima Turbo v1\.1（anima-turbo-v1\.1）/)
    assert.match(text, /模板：masterpiece, best quality, \{subject\}/)
    assert.match(text, new RegExp(`把 \\{subject\\} 换成具体英文主体描述`))
    assert.match(text, /不会自动追加任何风格后缀/)
    assert.equal(queue.submits.length, 0, '配方检索是只读工具，不得提交任务')
  })

  await check('imagen_recipes 过滤：分类 / presetId / 标签 / limit', async () => {
    const { tool } = createTools(workspace)

    const byCategory = (await tool('imagen_recipes').execute({ category: 'photography' })).text
    assert.match(byCategory, /【写实人像摄影】（photo-portrait）/)
    assert.doesNotMatch(byCategory, /日系二次元插画/)

    const byPreset = (await tool('imagen_recipes').execute({ presetId: 'anima-turbo-v1.1', limit: 10 })).text
    for (const title of ['日系二次元插画', '水墨水彩插画', '绘本童趣插画']) {
      assert.ok(byPreset.includes(title), `presetId 过滤应命中 ${title}`)
    }
    assert.ok(byPreset.indexOf('Danbooru 标签') < byPreset.indexOf('简短短语'), '按 presetId 过滤时该模型的写法应排在最前')
    assert.match(byPreset, /Anima Turbo v1\.1（anima-turbo-v1\.1）/)

    const byTags = (await tool('imagen_recipes').execute({ tags: ['雨夜', '霓虹'] })).text
    assert.match(byTags, /【赛博霓虹夜景】（cyber-neon）/)

    const limited = (await tool('imagen_recipes').execute({ limit: 2 })).text
    assert.equal((limited.match(/【/g) ?? []).length, 2, 'limit 应限制返回条数')
    assert.match(limited, /已按 limit=2 截断/)

    const keywordAnd = (await tool('imagen_recipes').execute({ keyword: '日系 插画' })).text
    assert.match(keywordAnd, /日系二次元插画/)
    assert.doesNotMatch(keywordAnd, /水墨水彩插画/, '多个关键词应同时命中')
  })

  await check('imagen_recipes 空结果提示可执行', async () => {
    const { tool } = createTools(workspace)
    const text = (await tool('imagen_recipes').execute({ keyword: '不存在的风格xyz' })).text
    assert.match(text, /没有匹配的配方/)
    assert.match(text, /省略过滤条件/)
    assert.ok(text.includes(`全部 ${RECIPES.length} 条配方`), '空结果应提示配方总数')
    assert.ok(text.includes('分类可选'), '空结果应列出可用分类')
    assert.doesNotMatch(text, /【/)
  })

  await check('配方数据与契约一致：预设 id / 比例 / 模板写法 / 占位符', () => {
    assert.deepEqual(validateRecipes(), [], '配方数据自检不应有问题')
    const presetIds = new Set(PRESET_IDS)
    const ratioIds = new Set(RATIO_IDS)
    const categoryIds = new Set(RECIPE_CATEGORIES.map((item) => item.id))
    const seen = new Set()
    for (const recipe of RECIPES) {
      assert.ok(!seen.has(recipe.id), `配方 id 重复：${recipe.id}`)
      seen.add(recipe.id)
      assert.ok(categoryIds.has(recipe.category), `分类未登记：${recipe.category}`)
      assert.equal(categoryLabelOf(recipe.category), RECIPE_CATEGORIES.find((item) => item.id === recipe.category).label)
      assert.ok(ratioIds.has(recipe.ratioId), `比例不在契约内：${recipe.ratioId}`)
      assert.ok(recipe.recommendedPresets.length > 0)
      for (const presetId of recipe.recommendedPresets) {
        assert.ok(presetIds.has(presetId), `推荐预设不存在于契约：${presetId}`)
        const preset = PRESETS.find((item) => item.id === presetId)
        const resolved = templateFor(recipe, presetId)
        assert.ok(resolved, `${recipe.id} 缺少 ${presetId} 的模板`)
        assert.ok(
          resolved.template.includes(SUBJECT_PLACEHOLDER),
          `${recipe.id} 的 ${preset.promptStyle} 模板缺少占位符`,
        )
        assert.ok(resolved.template.length <= LIMITS.prompt.maxChars)
      }
    }
    // searchRecipes 是纯函数：空查询返回全部（按 limit 截断），并带上总数。
    const all = searchRecipes({ limit: RECIPES.length })
    assert.equal(all.total, RECIPES.length)
    assert.equal(all.items.length, RECIPES.length)
    assert.equal(all.hint, '')
  })

  await check('工具描述引导先检索配方再显式组装 prompt', () => {
    const { tool } = createTools(workspace)
    const generate = tool('imagen_generate').description
    const batch = tool('imagen_batch').description
    const recipes = tool('imagen_recipes').description
    for (const [name, description] of [
      ['imagen_generate', generate],
      ['imagen_batch', batch],
    ]) {
      assert.ok(description.includes('imagen_recipes'), `${name} 描述应引导先检索配方`)
      assert.match(description, /显式改写进/, `${name} 描述应说明模板要显式改写`)
      assert.match(description, /不会自动追加任何风格后缀/, `${name} 描述应声明不做暗箱拼接`)
    }
    assert.match(batch, /单次 1-8 条|单次 1-\d+ 条/, '批量描述应给出条数上限')
    assert.match(batch, /总等待预算/)
    assert.match(recipes, /只读/, '配方工具应声明只读')
    assert.ok(recipes.includes(SUBJECT_PLACEHOLDER), '配方描述应提到占位符')
  })

  await rm(workspace, { recursive: true, force: true })
  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
