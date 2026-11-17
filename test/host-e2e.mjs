/**
 * Host 侧端到端测试（不依赖 Kaggle、不联网）。
 *
 * 做法：起一个 Node mock daemon 模仿远端协议，再用假的 cordis Context 加载 index.js，
 * 把插件路由挂到本地 HTTP 服务上，然后按 docs/SPEC.md 的真实请求形状跑完整链路：
 *   session/start → generate（逐张提交）→ 落盘 → history（分页）→ file
 *   → 任务取消（dequeued / cooperative / already-finished）→ enhance（refine / translate）
 *   → Agent 工具
 *
 * 运行：node test/host-e2e.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply as applyPlugin } from '../index.js'
import { invokeLlm } from '../lib/llm.js'
import { createLogRoutes } from '../lib/routes/logs.js'
import { normalizeSaveTo, resolveWorkspaceWritePath } from '../lib/paths.js'
import { registerTools } from '../lib/tools.js'
import { INTENT, LIMITS, VERSION } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'
import { createFakeContext, json, startHost } from './helpers/fake-context.mjs'

// 1×1 透明 PNG，用于伪造远端返回
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// 8×8 全黑灰度 PNG：充当「空蒙版」的字节载荷。Host 只做 PNG 魔数预检（形状合法），
// 真实 daemon 在执行期解码后按覆盖率拒绝；下面的 mock daemon 用这个常量模拟该拒绝点。
const EMPTY_MASK_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAADElEQVR4nGNgoA4AAABIAAEuuDx+AAAAAElFTkSuQmCC'

const DEV_TOKEN = 'dev-token-test'

/**
 * 假的宿主 llm 服务：记录每次调用的 system prompt / 消息，并回放固定文本。
 * 用它验证「有模型」分支里 prompt / summary / text / label 的分工，而不是只测本地兜底。
 */
function createFakeLlm(reply) {
  const calls = []
  return {
    calls,
    stream: async function* (options) {
      calls.push(options)
      yield { text: reply }
    },
  }
}

function startMockDaemon() {
  // 异步 job 协议（v0.5.0）：POST /generate 只入队并返回 202 + job_id，
  // GET /job?id= 返回状态与结果。任务默认立即完成，端到端测试不会为了轮询间隔变慢。
  // `hold=true` 时任务停在 running，直到测试改回 false（用于取消用例构造「生成中」状态）。
  const state = {
    generateCalls: 0,
    healthCalls: 0,
    lastBody: null,
    generateBodies: [],
    jobs: new Map(),
    held: new Map(),
    hold: false,
  }
  const server = createServer((req, res) => {
    const send = (code, value) => {
      const body = Buffer.from(JSON.stringify(value))
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': String(body.length) })
      res.end(body)
    }
    const auth = req.headers.authorization
    if (auth !== `Bearer ${DEV_TOKEN}`) return send(401, { error: { code: 'unauthorized', message: 'Unauthorized' } })

    if (req.method === 'GET' && req.url === '/health') {
      state.healthCalls += 1
      return send(200, {
        status: 'ok',
        phase: 'ready',
        version: VERSION,
        model_id: 'mock-model',
        device: 'Mock T4',
        device_count: 2,
        idle_seconds: 0,
        idle_timeout_sec: 1800,
        jobs_done: state.generateCalls,
      })
    }

    if (req.method === 'POST' && req.url === '/generate') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        state.generateCalls += 1
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        state.lastBody = body
        state.generateBodies.push(body)
        const jobId = String(body.jobId || `mock-job-${state.generateCalls}`)
        // 空蒙版在执行期（加载模型前）被真 daemon 按覆盖率拦截，HTTP 层仍是 202 入队成功；
        // 这里模拟同一个拒绝点：返回 failed job + invalid_request，用于断言 Host 把它折叠成
        // 「异步任务终态 failed + invalid_request」的透传语义（不是 400 入队拒绝）。
        if (body.reference?.mask_b64 === EMPTY_MASK_B64) {
          state.jobs.set(jobId, {
            status: 'failed',
            job_id: jobId,
            model_id: body.modelId,
            progress: { done: 0, total: 1 },
            load_seconds: 0,
            results: null,
            error: {
              code: 'invalid_request',
              message: '蒙版是空的：没有涂抹任何区域（请在参考图上涂抹需要重绘的区域后重试）',
            },
          })
          send(202, { status: 'accepted', job_id: jobId, model_id: body.modelId })
          return
        }
        // Host 改为逐张提交：正常情况下每个远端 job 的 tasks 只有 1 项。
        const results = body.tasks.map((task) => ({
          name: task.name,
          seed: task.seed,
          seconds: 0.05,
          width: task.width,
          height: task.height,
          steps: task.steps,
          cfg: task.cfg,
          png_bytes: 70,
          image_b64: PNG_B64,
        }))
        const job = {
          status: 'done',
          job_id: jobId,
          model_id: body.modelId,
          progress: { done: results.length, total: results.length },
          load_seconds: 0.1,
          results,
          error: null,
        }
        if (state.hold) {
          // 挂起模式：/job 先返回 running，release 后下一次轮询才拿到结果。
          job.status = 'running'
          job.progress = { done: 0, total: results.length }
          job.results = null
          state.held.set(jobId, results)
        }
        state.jobs.set(jobId, job)
        send(202, { status: 'accepted', job_id: jobId, model_id: body.modelId })
      })
      return
    }

    if (req.method === 'GET' && req.url.startsWith('/job?id=')) {
      const id = decodeURIComponent(req.url.slice('/job?id='.length))
      const job = state.jobs.get(id)
      if (!job) return send(404, { error: { code: 'unknown_job', message: '任务不存在或已过期' } })
      const pending = state.held.get(id)
      if (pending && !state.hold) {
        state.held.delete(id)
        job.status = 'done'
        job.results = pending
        job.progress = { done: pending.length, total: pending.length }
      }
      return send(200, job)
    }

    if (req.method === 'POST' && req.url === '/shutdown') return send(200, { status: 'shutting_down' })
    return send(404, { error: { code: 'not_found', message: 'Not found' } })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, state, endpoint: `http://127.0.0.1:${port}` })
    })
  })
}

/** 轮询 Host 的 GET /job，直到 predicate 成立；超时抛出最后快照便于定位。 */
async function waitUntilJob(origin, id, predicate, { timeoutMs = 8000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const res = await json(origin, `/imagen-api/job?id=${encodeURIComponent(id)}`)
    if (res.status === 200) {
      last = res.body
      if (predicate(last)) return last
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`等待任务超时：${id}，最后一次快照 ${JSON.stringify(last)}`)
}

/**
 * 往工作区播种一条历史产物（模拟历史 GIF 之外的旧记录）：
 * 写入 01.png + meta.json，目录名以时间戳开头（字典序即时间序）。
 */
async function seedHistoryEntry(workspace, dirName, jobId, prompt) {
  const dir = join(workspace, 'imagen-output', `${dirName}-${jobId}`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '01.png'), Buffer.from(PNG_B64, 'base64'))
  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({
      version: 1,
      jobId,
      presetId: 'sdxl-turbo',
      modelId: 'mock-model',
      createdAt: '2099-01-01T00:00:00.000Z',
      finishedAt: '2099-01-01T00:00:01.000Z',
      params: { prompt, negativePrompt: '', width: 512, height: 512, steps: 3, cfg: 1.5, seed: 1, count: 1 },
      images: [{ file: '01.png', seed: 1, seconds: 0.1, width: 512, height: 512, prompt }],
    }),
    'utf8',
  )
}

const { check, summary } = createCheckRunner()

async function main() {
  const workspace = await mkdtemp(join(tmpdir(), 'imagen-host-test-'))
  const mock = await startMockDaemon()
  const fake = createFakeContext(workspace)
  const host = await startHost(fake.routes)
  fake.setOrigin(host.origin)

  applyPlugin(fake.ctx, { devEndpoint: mock.endpoint, devToken: DEV_TOKEN })
  await new Promise((resolve) => setTimeout(resolve, 50))

  await check('路由已注册', () => {
    const paths = fake.routes.map((route) => route.path)
    for (const expected of [
      '/imagen-api/state',
      '/imagen-api/probe',
      '/imagen-api/session/start',
      '/imagen-api/session/stop',
      '/imagen-api/generate',
      '/imagen-api/job',
      '/imagen-api/job/cancel',
      '/imagen-api/jobs',
      '/imagen-api/history',
      '/imagen-api/history/tree',
      '/imagen-api/file',
      '/imagen-api/library',
      '/imagen-api/library/favorite',
      '/imagen-api/library/delete',
      '/imagen-api/enhance',
    ]) {
      assert.ok(paths.includes(expected), `缺少路由 ${expected}`)
    }
  })

  await check('工具已注册', () => {
    const names = fake.tools.map((tool) => tool.name)
    assert.deepEqual(names.sort(), [
      'imagen_batch',
      'imagen_cancel',
      'imagen_generate',
      'imagen_history',
      'imagen_recipes',
      'imagen_session',
    ])
    for (const tool of fake.tools) {
      assert.ok(tool.output?.render, `${tool.name} 缺少 output.render`)
      assert.ok(tool.parameters?.type === 'object', `${tool.name} 参数根必须是 object`)
      assert.equal(tool.parameters.additionalProperties, false, `${tool.name} 参数必须禁止未知字段`)
    }
    const cancel = fake.tools.find((tool) => tool.name === 'imagen_cancel')
    assert.deepEqual(cancel.parameters.required, ['jobId'], 'imagen_cancel 必须要求 jobId')
    assert.equal(cancel.parameters.properties.jobId.type, 'string')
    assert.equal(cancel.parameters.additionalProperties, false)

    // 批量创作：条数上限与等待预算都取自契约 LIMITS。
    const batch = fake.tools.find((tool) => tool.name === 'imagen_batch')
    assert.deepEqual(batch.parameters.required, ['items'], 'imagen_batch 必须要求 items')
    assert.equal(batch.parameters.properties.items.maxItems, LIMITS.batch.maxItems, '批量上限应引用契约')
    assert.deepEqual(batch.parameters.properties.items.items.required, ['prompt'], '批量条目必须要求 prompt')
    assert.equal(batch.parameters.properties.waitSeconds.type, 'integer')
    assert.match(batch.parameters.properties.waitSeconds.description, /总等待预算/, 'waitSeconds 应是整批总预算')

    // 风格配方：只读检索，无必填参数；可先检索再由 Agent 显式组装 prompt。
    const recipes = fake.tools.find((tool) => tool.name === 'imagen_recipes')
    assert.equal(recipes.parameters.required, undefined, 'imagen_recipes 的过滤条件都可选')
    assert.equal(recipes.parameters.properties.limit.type, 'integer')
    assert.ok(
      fake.tools.find((tool) => tool.name === 'imagen_generate').description.includes('imagen_recipes'),
      'imagen_generate 描述应引导先检索配方',
    )
  })

  await check('Agent 工具描述注入模型库知识', () => {
    const generate = fake.tools.find((tool) => tool.name === 'imagen_generate')
    // 模型知识来自 models/*.json 的单一来源：描述里能看到各模型定位与写法，而不是只有 id 枚举。
    assert.match(generate.description, /可用模型/, '工具描述应带模型库')
    for (const label of ['SDXL Lightning', 'RealVisXL V5.0', 'FLUX.2 Klein 4B', 'Animagine XL 3.1']) {
      assert.ok(generate.description.includes(label), `工具描述应包含模型画像：${label}`)
    }
    assert.ok(generate.description.includes('提示词写法'), '模型库应包含提示词写法')
    assert.match(
      generate.parameters.properties.negativePrompt.description,
      /CFG > 0/,
      'negativePrompt 参数说明应写明负向词生效条件',
    )
    assert.match(
      generate.parameters.properties.negativePrompt.description,
      /不支持负向词/,
      'negativePrompt 参数说明应写明模型能力差异',
    )
    assert.match(generate.parameters.properties.presetId.description, /模型库/, 'presetId 参数说明应指向模型库')
  })

  await check('初始状态为 absent', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/state')
    assert.equal(status, 200)
    assert.equal(body.session.state, 'absent')
    assert.equal(body.devMode, true)
    assert.ok(Array.isArray(body.presets) && body.presets.length >= 4)
    assert.equal(body.presets[0].pipeline, undefined, '预设不应泄露 pipeline 细节')
    // 版本检查快照：开发模式不发起请求，但字段形状稳定（客户端按 hasUpdate 决定是否提示）。
    assert.equal(body.update.current, VERSION)
    assert.equal(body.update.hasUpdate, false)
    assert.equal(body.update.latest, null)
  })

  await check('日志路由无会话时仍返回 hostLines 与老字段', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/logs?since=0')
    assert.equal(status, 200, '日志路由必须始终 HTTP 200')
    assert.equal(body.ok, false)
    assert.equal(body.code, 'session_absent')
    assert.equal(body.since, 0)
    assert.equal(body.next, 0)
    assert.deepEqual(body.lines, [])
    assert.ok(Array.isArray(body.hostLines), 'hostLines 必须是数组')
    for (const line of body.hostLines) assert.equal(typeof line, 'string', 'hostLines 只能是字符串行')
    assert.ok(body.hostLines.length <= 120, 'hostLines 最多 120 行')
  })

  await check('会话启动（开发模式直连）', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presetId: 'sdxl-turbo' }),
    })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.session.state, 'ready')
    assert.equal(body.session.endpointUrl, mock.endpoint)
  })

  await check('日志路由远端不可用时降级并保留 hostLines', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/logs?since=0')
    assert.equal(status, 200)
    assert.equal(body.ok, false)
    assert.equal(body.code, 'logs_unavailable', 'mock daemon 没有 /logs，应走降级分支')
    assert.equal(typeof body.since, 'number')
    assert.equal(typeof body.next, 'number')
    assert.deepEqual(body.lines, [])
    assert.ok(Array.isArray(body.hostLines), 'hostLines 在异常分支也要出现')
    for (const line of body.hostLines) assert.equal(typeof line, 'string')
  })

  let firstJob = null
  await check('生成 2 张并落盘', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '测试用的荷花池塘',
        presetId: 'sdxl-turbo',
        negativePrompt: 'blurry',
        width: 512,
        height: 512,
        steps: 3,
        cfg: 1.5,
        seed: 7,
        count: 2,
        waitSeconds: 30,
      }),
    })
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(body.status, 'done', JSON.stringify(body))
    assert.equal(body.output.images.length, 2)
    assert.equal(body.params.seed, 7)
    assert.equal(body.params.steps, 3)
    firstJob = body

    // 逐张提交（合作式取消的前提）：每张一个远端 job，tasks 只有 1 项，
    // 幂等键是 `<宿主 jobId>-<两位序号>`，同批 seed 仍按序号递增。
    const jobBodies = mock.state.generateBodies.filter((entry) => entry.jobId?.startsWith(`${body.id}-`))
    assert.equal(jobBodies.length, 2, 'count=2 应逐张提交两次')
    for (const entry of jobBodies) assert.equal(entry.tasks.length, 1, '每个远端 job 只含 1 个 task')
    assert.deepEqual(
      jobBodies.map((entry) => entry.jobId),
      [`${body.id}-01`, `${body.id}-02`],
      '幂等键应带两位序号',
    )
    assert.deepEqual(
      jobBodies.map((entry) => entry.tasks[0].seed),
      [7, 8],
      '同批多张的 seed 应递增',
    )
    assert.equal(jobBodies[0].pipeline.loader, 'sdxl')

    for (const image of body.output.images) {
      const absolute = join(workspace, ...image.path.split('/'))
      const info = await stat(absolute)
      assert.ok(info.size > 0, `${image.path} 为空`)
      const bytes = await readFile(absolute)
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG magic 不匹配')
      assert.match(image.url, /\/imagen-api\/file\?path=/)
    }

    const meta = JSON.parse(await readFile(join(workspace, ...body.output.metaFile.split('/')), 'utf8'))
    assert.equal(meta.jobId, body.id)
    assert.equal(meta.images.length, 2)
    assert.equal(meta.params.prompt, '测试用的荷花池塘')
  })

  await check('参数越界被钳制', async () => {
    const { body } = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x', width: 99999, height: 1, steps: 999, cfg: 99, count: 9, waitSeconds: 30 }),
    })
    assert.equal(body.params.width, 1536)
    assert.equal(body.params.height, 256)
    assert.equal(body.params.steps, 60)
    assert.equal(body.params.cfg, 20)
    assert.equal(body.params.count, 4)
  })

  await check('空 prompt 被拒绝', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    })
    assert.equal(status, 400)
    assert.equal(body.error.code, 'invalid_prompt')
  })

  await check('任务查询与列表', async () => {
    const single = await json(host.origin, `/imagen-api/job?id=${firstJob.id}`)
    assert.equal(single.status, 200)
    assert.equal(single.body.id, firstJob.id)
    const list = await json(host.origin, '/imagen-api/jobs?limit=5')
    assert.equal(list.status, 200)
    assert.ok(list.body.jobs.length >= 1)
    assert.ok(list.body.jobs.some((job) => job.id === firstJob.id))
    const missing = await json(host.origin, '/imagen-api/job?id=nope')
    assert.equal(missing.status, 404)
  })

  await check('任务取消：未知 id → 404 not_found；坏 JSON → 400 invalid_body', async () => {
    const headers = { 'content-type': 'application/json' }
    const missing = await json(host.origin, '/imagen-api/job/cancel', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'j_not_exist' }),
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'not_found')

    const bad = await json(host.origin, '/imagen-api/job/cancel', {
      method: 'POST',
      headers,
      body: '{"id":',
    })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'invalid_body')
  })

  await check('任务取消：queued 立即出队（dequeued）、running 合作式收敛（cooperative）、终态 already-finished', async () => {
    const headers = { 'content-type': 'application/json' }
    const beforeCalls = mock.state.generateCalls
    // hold 模式：远端任务停在 running，用来构造「生成中」与「排队中」两个真实状态。
    mock.state.hold = true
    let slow = null
    let queued = null
    try {
      const submittedSlow = await json(host.origin, '/imagen-api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: '取消测试的慢任务', count: 2, seed: 21 }),
      })
      assert.equal(submittedSlow.status, 200, JSON.stringify(submittedSlow.body))
      slow = submittedSlow.body
      await waitUntilJob(host.origin, slow.id, (job) => job.status === 'running')

      const submittedQueued = await json(host.origin, '/imagen-api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: '取消测试的排队任务', count: 1, seed: 22 }),
      })
      queued = submittedQueued.body
      assert.equal(queued.status, 'queued', `串行队列里应处于 queued，实际 ${queued.status}`)

      // queued：立即出队失效，不占 pending 位置。
      const dequeued = await json(host.origin, '/imagen-api/job/cancel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: queued.id }),
      })
      assert.equal(dequeued.status, 200)
      assert.equal(dequeued.body.ok, true)
      assert.equal(dequeued.body.disposition, 'dequeued')
      assert.equal(dequeued.body.job.status, 'cancelled')
      assert.equal(dequeued.body.job.stage, '已取消')
      assert.equal(dequeued.body.job.cancelRequested, false, '终态不再透出未收敛的取消请求')
      const persisted = await json(host.origin, `/imagen-api/job?id=${queued.id}`)
      assert.equal(persisted.body.status, 'cancelled', '取消是持久状态，不是一次性响应')
      const list = await json(host.origin, '/imagen-api/jobs?limit=10')
      assert.equal(list.body.queue.pending, 0, '取消的排队任务应立即释放 pending 位置')

      // 已取消的任务再取消：already-finished，状态不变。
      const again = await json(host.origin, '/imagen-api/job/cancel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: queued.id }),
      })
      assert.equal(again.body.disposition, 'already-finished')
      assert.equal(again.body.job.status, 'cancelled')

      // running：合作式停止，不立即改状态，只置 cancelRequested。
      const cooperative = await json(host.origin, '/imagen-api/job/cancel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: slow.id }),
      })
      assert.equal(cooperative.status, 200)
      assert.equal(cooperative.body.disposition, 'cooperative')
      assert.equal(cooperative.body.job.status, 'running', 'running 只置标记，不立即改状态')
      assert.equal(cooperative.body.job.cancelRequested, true)

      // 放行远端：当前这张出完后不再提交第 2 张，任务最终收敛为 cancelled 且保留已出图片。
      mock.state.hold = false
      const final = await waitUntilJob(host.origin, slow.id, (job) =>
        ['cancelled', 'done', 'failed'].includes(job.status),
      )
      assert.equal(final.status, 'cancelled', JSON.stringify(final.error))
      assert.equal(final.stage, '已取消')
      assert.equal(final.error, null)
      assert.equal(final.cancelRequested, false, '终态不再透出取消请求标记')
      assert.equal(final.output?.images.length, 1, '取消前已完成的图片应保留')
      const absolute = join(workspace, ...final.output.images[0].path.split('/'))
      assert.ok((await stat(absolute)).size > 0, '取消前已完成的图片应真实落盘')

      const slowBodies = mock.state.generateBodies.filter((entry) => entry.jobId?.startsWith(`${slow.id}-`))
      assert.equal(slowBodies.length, 1, '取消后不得再提交剩余张数')
      assert.equal(slowBodies[0].jobId, `${slow.id}-01`)
      assert.equal(mock.state.generateCalls - beforeCalls, 1, '取消后不应产生额外的远端提交')

      // 终态再取消：already-finished。
      const finished = await json(host.origin, '/imagen-api/job/cancel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: slow.id }),
      })
      assert.equal(finished.body.disposition, 'already-finished')
      assert.equal(finished.body.job.status, 'cancelled')
    } finally {
      mock.state.hold = false
    }
  })

  await check('历史扫描', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/history?limit=10')
    assert.equal(status, 200)
    assert.ok(body.items.length >= 1)
    const item = body.items.find((entry) => entry.jobId === firstJob.id)
    assert.ok(item, '历史里应能查到刚生成的任务')
    assert.equal(item.images.length, 2)
    assert.match(item.prompt, /荷花/)
    // 历史条目必须带回完整参数：舞台提示词与「带回参数」都依赖它，
    // 缺 params 会让旧图无法复现（曾经回退到「最近一次任务」的错参）。
    assert.ok(item.params, '历史条目应带 params')
    assert.equal(item.params.prompt, '测试用的荷花池塘')
    assert.equal(item.params.negativePrompt, 'blurry')
    assert.equal(item.params.seed, 7)
    assert.equal(item.params.steps, 3)
    assert.equal(item.params.width, 512)
    assert.ok(item.finishedAt, '历史条目应带 finishedAt')
    // 版本树字段（阶段十三）：纯文生图没有来源图，四个字段恒存在（null / null / false / null）。
    assert.equal(item.sourceImage, null)
    assert.equal(item.rootImage, null)
    assert.equal(item.inpaint, false)
    assert.equal(item.strength, null)
    // 产物文件名由本地序号生成，不拼接远端返回的 name。
    for (const image of item.images) assert.match(image.file, /^\d{2}\.png$/)
  })

  await check('历史分页：limit/offset 与 hasMore（offset 只统计有效记录）', async () => {
    // 追加 3 条有效历史 + 2 个无效目录：无 meta 的目录、meta 里图片已被删的目录。
    // 无效目录用最新时间戳排序在最前，验证它们不会被当作有效记录挤掉真实记录的 offset。
    await seedHistoryEntry(workspace, '20990102-000000', 'j_hist_2', '历史记录二')
    await seedHistoryEntry(workspace, '20990101-000000', 'j_hist_1', '历史记录一')
    await seedHistoryEntry(workspace, '20990100-000000', 'j_hist_0', '历史记录零')
    await mkdir(join(workspace, 'imagen-output', '20991231-000000-j_invalid_meta'), { recursive: true })
    const missingImageDir = join(workspace, 'imagen-output', '20991230-000000-j_invalid_image')
    await mkdir(missingImageDir, { recursive: true })
    await writeFile(
      join(missingImageDir, 'meta.json'),
      JSON.stringify({
        version: 1,
        jobId: 'j_invalid_image',
        createdAt: '2099-12-30T00:00:00.000Z',
        finishedAt: '2099-12-30T00:00:01.000Z',
        params: { prompt: '无效记录' },
        images: [{ file: '01.png', seed: 1 }],
      }),
      'utf8',
    )

    const all = await json(host.origin, `/imagen-api/history?limit=${LIMITS.history.maxLimit}&offset=0`)
    assert.equal(all.status, 200)
    assert.ok(Array.isArray(all.body.items), 'items 必须是数组（旧客户端只读该字段）')
    assert.equal(all.body.limit, LIMITS.history.maxLimit)
    assert.equal(all.body.offset, 0)
    assert.equal(typeof all.body.hasMore, 'boolean')
    const total = all.body.items.length
    assert.ok(total >= 4, `应有至少 4 条有效记录，实际 ${total}`)
    assert.equal(all.body.hasMore, false, 'limit 取满上限后不应再有更多记录')
    // 无效目录被跳过；播种的 3 条有效记录时间最新，按倒序排在真实任务前面。
    assert.ok(!all.body.items.some((item) => String(item.jobId).startsWith('j_invalid')))
    assert.deepEqual(
      all.body.items.slice(0, 3).map((item) => item.jobId),
      ['j_hist_2', 'j_hist_1', 'j_hist_0'],
      '无效目录不得占用 offset 名额',
    )

    const page1 = await json(host.origin, '/imagen-api/history?limit=2&offset=0')
    assert.equal(page1.body.items.length, 2)
    assert.equal(page1.body.limit, 2)
    assert.equal(page1.body.offset, 0)
    assert.equal(page1.body.hasMore, true, '还有更早的记录时 hasMore=true')

    const page2 = await json(host.origin, '/imagen-api/history?limit=2&offset=2')
    assert.equal(page2.body.items.length, Math.min(2, Math.max(0, total - 2)))
    assert.equal(page2.body.hasMore, total > 4)
    assert.notDeepEqual(
      page2.body.items.map((item) => item.jobId),
      page1.body.items.map((item) => item.jobId),
      '第二页不应重复第一页的记录',
    )

    const tail = await json(host.origin, `/imagen-api/history?limit=2&offset=${total - 1}`)
    assert.equal(tail.body.items.length, 1)
    assert.equal(tail.body.hasMore, false, '最后一条之后没有更多记录')

    const beyond = await json(host.origin, `/imagen-api/history?limit=2&offset=${total}`)
    assert.equal(beyond.body.items.length, 0)
    assert.equal(beyond.body.hasMore, false)

    // offset 非法按 0；limit 越界被钳制到契约上限。
    const invalidOffset = await json(host.origin, '/imagen-api/history?limit=2&offset=abc')
    assert.equal(invalidOffset.body.offset, 0)
    assert.equal(invalidOffset.body.items.length, 2)
    const negativeOffset = await json(host.origin, '/imagen-api/history?limit=2&offset=-5')
    assert.equal(negativeOffset.body.offset, 0)
    const clampedLimit = await json(host.origin, '/imagen-api/history?limit=9999')
    assert.equal(clampedLimit.body.limit, LIMITS.history.maxLimit)
    assert.equal(clampedLimit.body.offset, 0)
  })

  await check('文件路由返回 PNG', async () => {
    const image = firstJob.output.images[0]
    const res = await fetch(new URL(image.url, host.origin))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    const bytes = Buffer.from(await res.arrayBuffer())
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  })

  await check('文件路由拒绝目录逃逸', async () => {
    for (const attempt of ['../index.js', 'imagen-output/../../index.js', '/etc/passwd', 'C:/Windows/win.ini']) {
      const res = await fetch(new URL(`/imagen-api/file?path=${encodeURIComponent(attempt)}`, host.origin))
      assert.equal(res.status, 404, `${attempt} 不应被读取`)
    }
  })

  await check('Agent 工具 imagen_generate', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_generate')
    const value = await tool.execute({ prompt: '工具调用测试', count: 1, waitSeconds: 30 }, {})
    assert.equal(typeof value.text, 'string')
    assert.match(value.text, /imagen-output\//)
    assert.match(value.text, /seed/)
    // describeJob 补模型定位：Agent 能看出这批图用的模型与取向。
    assert.match(value.text, /预设：SDXL Lightning（sdxl-lightning）/)
    assert.match(value.text, /定位：4 步极速出图/)
    const rendered = tool.output.render({}, value)
    assert.equal(rendered[0].type, 'text')
  })

  await check('Agent 工具 imagen_history', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_history')
    const value = await tool.execute({ limit: 3 }, {})
    assert.match(value.text, /imagen-output\//)
  })

  await check('Agent 工具 imagen_session', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_session')
    const value = await tool.execute({ action: 'status' }, {})
    assert.match(value.text, /会话状态：ready/)
  })

  await check('Agent 工具 imagen_cancel 四种返回分支', async () => {
    // 队列替身：按 jobId 回放 cancel() 的四种返回值，逐条断言给模型看的文案。
    const canned = {
      dequeued: { ok: true, disposition: 'dequeued', job: { status: 'cancelled' } },
      cooperative: { ok: true, disposition: 'cooperative', job: { status: 'running' } },
      finished: { ok: true, disposition: 'already-finished', job: { status: 'cancelled' } },
      failed: { ok: true, disposition: 'already-finished', job: { status: 'failed' } },
    }
    const registered = []
    const stubCtx = { tools: { register: (tool) => registered.push(tool) } }
    const stubQueue = {
      cancel(id) {
        return canned[id] ?? { ok: false, code: 'not_found' }
      },
    }
    registerTools(stubCtx, {
      queue: stubQueue,
      session: { snapshot: () => ({ state: 'ready' }) },
      defaultPreset: 'sdxl-lightning',
    })
    const tool = registered.find((item) => item.name === 'imagen_cancel')
    assert.ok(tool, 'imagen_cancel 必须注册')

    assert.equal((await tool.execute({ jobId: 'missing' })).text, '未找到任务 missing')
    assert.match((await tool.execute({ jobId: 'dequeued' })).text, /已取消任务 dequeued（已从队列移除）/)
    assert.match(
      (await tool.execute({ jobId: 'cooperative' })).text,
      /已向任务 cooperative 发送合作式取消请求：当前正在生成的单张完成后将停止.*已出图像仍保留/,
    )
    assert.match((await tool.execute({ jobId: 'finished' })).text, /已处于终态（cancelled），无需取消/)
    assert.match((await tool.execute({ jobId: 'failed' })).text, /已处于终态（failed），无需取消/)
    // jobId 前后空白会被裁掉；空 jobId 归到 not_found 分支。
    assert.equal((await tool.execute({ jobId: '  missing  ' })).text, '未找到任务 missing')
    assert.equal((await tool.execute({})).text, '未找到任务 ')
  })

  await check('Agent 工具 imagen_cancel 走真实队列（终态任务）', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_cancel')
    const value = await tool.execute({ jobId: firstJob.id }, {})
    assert.match(value.text, /已处于终态（done），无需取消/)
  })

  await check('Agent 工具 imagen_generate saveTo：单张补扩展名并交付', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_generate')
    const value = await tool.execute(
      { prompt: 'saveTo 单张交付', count: 1, waitSeconds: 30, saveTo: 'docs/assets/hero' },
      {},
    )
    assert.match(value.text, /imagen-output\//, '原始归档必须照常生成')
    assert.match(value.text, /已交付至：docs\/assets\/hero\.png/)
    const delivered = join(workspace, 'docs', 'assets', 'hero.png')
    const info = await stat(delivered)
    assert.ok(info.size > 0, '交付文件不能为空')
    const bytes = await readFile(delivered)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '交付文件应是 PNG')
    // 原子写：交付目录里不允许残留 .tmp-* 临时文件。
    const names = await readdir(join(workspace, 'docs', 'assets'))
    assert.deepEqual(names.filter((name) => name.includes('.tmp-')), [])
  })

  await check('Agent 工具 imagen_generate saveTo：多张追加序号', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_generate')
    const value = await tool.execute(
      { prompt: 'saveTo 多张交付', count: 2, waitSeconds: 30, saveTo: 'docs/assets/logo.png' },
      {},
    )
    assert.match(value.text, /已交付至：docs\/assets\/logo-01\.png/)
    assert.match(value.text, /已交付至：docs\/assets\/logo-02\.png/)
    for (const name of ['logo-01.png', 'logo-02.png']) {
      const info = await stat(join(workspace, 'docs', 'assets', name))
      assert.ok(info.size > 0, `${name} 不能为空`)
    }
    const direct = await stat(join(workspace, 'docs', 'assets', 'logo.png')).then(
      () => true,
      () => false,
    )
    assert.equal(direct, false, '多张时不应直接落盘为目标文件名')
  })

  await check('Agent 工具 imagen_generate saveTo：越界与保留目录拒绝', async () => {
    const tool = fake.tools.find((item) => item.name === 'imagen_generate')
    const attempts = [
      '../outside.png',
      'docs/../../escape.png',
      '/etc/passwd',
      'C:/Windows/hero.png',
      'D:\\data\\hero.png',
      'imagen-output/hero.png',
      '.imagen/hero.png',
      'docs/a\0.png',
    ]
    const before = mock.state.generateCalls
    for (const saveTo of attempts) {
      const value = await tool.execute({ prompt: 'saveTo 拒绝测试', count: 1, waitSeconds: 1, saveTo }, {})
      assert.match(value.text, /^提交失败：/, `${JSON.stringify(saveTo)} 应被拒绝`)
    }
    assert.equal(mock.state.generateCalls, before, '非法 saveTo 不得触发远端生成')
  })

  await check('saveTo 纯函数：归一化与工作区边界', async () => {
    assert.deepEqual(normalizeSaveTo('docs/assets/hero'), { ok: true, relative: 'docs/assets/hero.png' })
    assert.deepEqual(normalizeSaveTo('docs\\assets\\hero.webp'), { ok: true, relative: 'docs/assets/hero.webp' })
    assert.deepEqual(normalizeSaveTo('./docs//hero.png'), { ok: true, relative: 'docs/hero.png' })
    for (const bad of ['', '   ', '../x.png', '/abs.png', 'C:/x.png', 'imagen-output/x.png', '.imagen/x', 42, null]) {
      const result = normalizeSaveTo(bad)
      assert.equal(result.ok, false, `${JSON.stringify(bad)} 应被拒绝`)
      assert.equal(result.code, 'invalid_path')
    }

    const fakeCtx = { get: (name) => (name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined) }
    const good = await resolveWorkspaceWritePath(fakeCtx, 'reports/cover')
    assert.equal(good.ok, true)
    assert.equal(good.relative, 'reports/cover.png')
    assert.equal(good.absolute, join(workspace, 'reports', 'cover.png'))
    const escape = await resolveWorkspaceWritePath(fakeCtx, '../escape.png')
    assert.equal(escape.ok, false)
    assert.equal(escape.code, 'invalid_path')
  })

  await check('HTTP 提交 saveTo：响应带 deliveredPaths，非法路径 400 invalid_path', async () => {
    const headers = { 'content-type': 'application/json' }
    const ok = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'HTTP saveTo 交付', count: 1, seed: 11, waitSeconds: 30, saveTo: 'exports/cover' }),
    })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(ok.body.status, 'done')
    assert.deepEqual(ok.body.output.deliveredPaths, ['exports/cover.png'])
    assert.ok((await stat(join(workspace, 'exports', 'cover.png'))).size > 0)

    const bad = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'HTTP saveTo 越界', saveTo: '../escape.png' }),
    })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'invalid_path')
  })

  await check('收藏与本地库', async () => {
    const initial = await json(host.origin, '/imagen-api/library')
    assert.equal(initial.status, 200)
    assert.deepEqual(initial.body, { favorites: [], deleted: [] })

    const imagePath = firstJob.output.images[0].path
    const added = await json(host.origin, '/imagen-api/library/favorite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: imagePath, favorite: true }),
    })
    assert.equal(added.status, 200)
    assert.deepEqual(added.body.favorites, [imagePath])

    const reread = await json(host.origin, '/imagen-api/library')
    assert.deepEqual(reread.body.favorites, [imagePath], '收藏应持久化')

    const removedFavorite = await json(host.origin, '/imagen-api/library/favorite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: imagePath, favorite: false }),
    })
    assert.deepEqual(removedFavorite.body.favorites, [])

    const bad = await json(host.origin, '/imagen-api/library/favorite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(bad.status, 400)
  })

  await check('批量删除拒绝越权路径', async () => {
    const escape = await json(host.origin, '/imagen-api/library/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['../index.js'] }),
    })
    assert.equal(escape.status, 200)
    assert.deepEqual(escape.body.removed, [], '不应删除输出目录外的文件')
    assert.equal(escape.body.failed[0].code, 'not_found')

    const empty = await json(host.origin, '/imagen-api/library/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: [] }),
    })
    assert.equal(empty.status, 400)
  })

  await check('批量删除图片并记录', async () => {
    const target = firstJob.output.images[1]
    const result = await json(host.origin, '/imagen-api/library/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: [target.path] }),
    })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.removed, [target.path])
    assert.deepEqual(result.body.failed, [])

    const absolute = join(workspace, ...target.path.split('/'))
    await assert.rejects(stat(absolute), '文件应已删除')

    const library = await json(host.origin, '/imagen-api/library')
    assert.ok(library.body.deleted.some((item) => item.path === target.path), '删除应被记录')

    const history = await json(host.origin, '/imagen-api/history?limit=10')
    const item = history.body.items.find((entry) => entry.jobId === firstJob.id)
    assert.equal(item.images.length, 1, '历史里不应再出现已删除的图片')
  })

  await check('提示词润色（无模型时走本地兜底）', async () => {
    const result = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '一只赛博猫', presetId: 'sdxl-lightning', locale: 'zh' }),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.source, 'local', '测试环境没有宿主模型，应走本地兜底')
    assert.equal(result.body.groups.length, 4, '应按四个维度返回')
    assert.deepEqual(
      result.body.groups.map((group) => group.dimension),
      ['lighting', 'material', 'composition', 'atmosphere'],
      '维度顺序固定',
    )
    for (const group of result.body.groups) {
      assert.ok(group.options.length >= 2, `${group.dimension} 至少两条建议`)
      for (const option of group.options) {
        assert.equal(typeof option.id, 'string')
        assert.equal(typeof option.text, 'string')
        assert.ok(option.text.length > 0)
        assert.equal(typeof option.label, 'string')
        assert.ok(option.label.length > 0, '每条建议都要有 UI 语言标签')
        assert.match(option.text, /^[A-Za-z0-9 ,'-]+$/, `text 必须是可直接追加进 prompt 的英文短语：${option.text}`)
        assert.match(option.label, /[\u3400-\u9fff]/, `中文界面的 label 应为中文：${option.label}`)
      }
    }
    assert.equal(result.body.groups[0].options[0].text, 'soft diffused light')
    assert.equal(result.body.groups[0].options[0].label, '柔和漫射光')

    const english = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cyber cat', locale: 'en' }),
    })
    assert.equal(english.body.groups[0].options[0].text, 'soft diffused light', '英文 locale 走英文本地建议')
    assert.equal(english.body.groups[0].options[0].label, 'soft diffused light', '英文界面 label 与 text 相同')

    const blank = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    })
    assert.deepEqual(blank.body.groups, [], '空描述不产生建议')
  })

  await check('提示词润色（有模型）：英文短语 + UI 语言标签', async () => {
    const llm = createFakeLlm(JSON.stringify({
      groups: [
        { dimension: 'lighting', options: [{ text: 'soft rim light', label: '柔和轮廓光' }, 'neon glow'] },
        { dimension: 'material', options: [{ text: 'wet asphalt', label: '湿润沥青' }] },
        { dimension: 'composition', options: [{ text: 'low angle', label: '低角度' }] },
        { dimension: 'atmosphere', options: [{ text: 'quiet fog', label: '静谧雾气' }] },
      ],
    }))
    fake.setLlm(llm)
    try {
      const result = await json(host.origin, '/imagen-api/enhance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '一只赛博猫', presetId: 'sdxl-lightning', locale: 'zh' }),
      })
      assert.equal(result.body.source, 'model')
      const lighting = result.body.groups.find((group) => group.dimension === 'lighting')
      assert.deepEqual(
        [lighting.options[0].text, lighting.options[0].label],
        ['soft rim light', '柔和轮廓光'],
        '模型返回的 text / label 原样透传',
      )
      // 模型只给字符串时 label 回落到 text，建议不丢。
      assert.deepEqual([lighting.options[1].text, lighting.options[1].label], ['neon glow', 'neon glow'])
      assert.ok(llm.calls[0].system.includes('英文短语'), 'system prompt 应要求英文短语')
      assert.ok(llm.calls[0].system.includes('label'), 'system prompt 应要求 UI 语言标签')
      // 模型配方来自模型资产：写法、速度档位、负向词能力都注入 system prompt，不再手写 ID 列表。
      assert.ok(llm.calls[0].system.includes('SDXL Lightning'), 'system prompt 应带当前模型画像')
      assert.ok(llm.calls[0].system.includes('简短短语'), 'concise 模型应要求简短英文短语')
      assert.ok(llm.calls[0].system.includes('快速档'), '快速档模型应要求短语短而聚焦')
      assert.ok(llm.calls[0].system.includes('原文'), '润色应引导避开原文已覆盖的维度')

      const natural = await json(host.origin, '/imagen-api/enhance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '一只赛博猫', presetId: 'realvis-v5', locale: 'zh' }),
      })
      assert.equal(natural.body.source, 'model')
      const naturalCall = llm.calls.at(-1)
      assert.ok(naturalCall.system.includes('RealVisXL V5.0'), 'system prompt 应带目标模型画像')
      assert.ok(naturalCall.system.includes('自然语言段落'), 'natural 模型应要求自然语言段落')
      assert.ok(naturalCall.system.includes('多步质量档'), '多步模型应要求更细的质感描写')

      // 无负向词能力的模型：润色建议必须引导用正面视觉描述表达排除意图。
      const flux = await json(host.origin, '/imagen-api/enhance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '一尘不染的白色房间', presetId: 'flux2-klein-4b', locale: 'zh' }),
      })
      assert.equal(flux.body.source, 'model')
      assert.ok(llm.calls.at(-1).system.includes('不接受负向提示词'), '无负向能力模型应提示用正面描述')
    } finally {
      fake.setLlm(null)
    }
  })

  await check('英译模式（无模型）：明确降级为 local，不假装翻译成功', async () => {
    const result = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '雨夜街景，湿滑路面反射霓虹', mode: 'translate' }),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.mode, 'translate')
    assert.equal(result.body.source, 'local', '测试环境没有宿主模型，必须明确降级')
    assert.equal(result.body.prompt, '雨夜街景，湿滑路面反射霓虹', '降级时返回原文，绝不假装已翻译')
    assert.equal(result.body.note, 'llm_unavailable')
    assert.equal(result.body.groups, undefined, 'translate 响应不返回 refine 的 groups')

    const blank = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ', mode: 'translate' }),
    })
    assert.equal(blank.body.mode, 'translate')
    assert.equal(blank.body.source, 'local')
    assert.equal(blank.body.prompt, '')
    assert.equal(blank.body.note, 'empty')
  })

  await check('英译模式（有模型）：复用同一模型通道转成英文提示词', async () => {
    const llm = createFakeLlm('rainy night street, wet pavement reflecting neon signs')
    fake.setLlm(llm)
    try {
      const result = await json(host.origin, '/imagen-api/enhance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '雨夜街景，湿滑路面反射霓虹', mode: 'translate' }),
      })
      assert.equal(result.status, 200)
      assert.equal(result.body.ok, true)
      assert.equal(result.body.mode, 'translate')
      assert.equal(result.body.source, 'model')
      assert.equal(result.body.prompt, 'rainy night street, wet pavement reflecting neon signs')
      assert.equal(result.body.note, undefined)

      const call = llm.calls[0]
      assert.ok(call.system.includes('只输出英文提示词'), 'system prompt 应要求只输出英文提示词')
      assert.ok(call.system.includes('不解释'), 'system prompt 应禁止解释')
      assert.ok(call.system.includes('不要加戏'), 'system prompt 应禁止添加原文没有的内容')
      assert.equal(call.messages[0].content[0].text, '雨夜街景，湿滑路面反射霓虹', '用户原话应原样发给模型')

      // 非法 mode 按 refine 处理，旧客户端不传 mode 的行为保持不变。
      const invalidMode = await json(host.origin, '/imagen-api/enhance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '一只赛博猫', mode: 'bogus' }),
      })
      assert.equal(invalidMode.body.ok, true)
      assert.equal(invalidMode.body.mode, undefined, 'refine 响应不回显 mode（保持旧字段形状）')
      assert.ok(Array.isArray(invalidMode.body.groups), '非法 mode 应按 refine 返回 groups')
      assert.equal(invalidMode.body.groups.length, 4)
    } finally {
      fake.setLlm(null)
    }
  })

  await check('llm 多轮：messages 字符串 / 内容块与 prompt 单轮兼容', async () => {
    const calls = []
    const llmCtx = {
      get(name) {
        if (name === 'llm') {
          return {
            stream: async function* (options) {
              calls.push(options)
              yield { text: 'ok' }
            },
          }
        }
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock-provider', model: 'mock-model' }) }
        return undefined
      },
    }
    const reply = await invokeLlm(llmCtx, {
      messages: [
        { role: 'user', content: '第一轮：雨夜街景' },
        { role: 'assistant', content: [{ type: 'text', text: 'rainy night street' }] },
        { role: 'user', content: [{ type: 'text', text: '第二轮：加上霓虹' }, { type: 'image', url: 'ignored' }] },
        { role: 'system', content: '' },
        null,
      ],
      systemPrompt: 'sys',
    })
    assert.equal(reply, 'ok')
    assert.deepEqual(calls[0].messages.map((message) => message.role), ['user', 'assistant', 'user'])
    assert.deepEqual(calls[0].messages[0].content, [{ type: 'text', text: '第一轮：雨夜街景' }], '字符串内容归一成文本块')
    assert.deepEqual(
      calls[0].messages[1].content,
      [{ type: 'text', text: 'rainy night street' }],
      '内容块数组原样传递',
    )
    assert.deepEqual(
      calls[0].messages[2].content,
      [{ type: 'text', text: '第二轮：加上霓虹' }],
      '当前只传递文本块，其它类型丢弃',
    )

    // 不传 messages 时仍走 prompt 单轮（旧调用方兼容）。
    await invokeLlm(llmCtx, { prompt: '单轮提示词', systemPrompt: 'sys' })
    assert.deepEqual(calls[1].messages, [{ role: 'user', content: [{ type: 'text', text: '单轮提示词' }] }])
  })

  await check('对话意图解析（无模型时走本地兜底，v2 形状）', async () => {
    const text = '给我画一张横版的雨夜街景，要写实一点'
    const result = await json(host.origin, '/imagen-api/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, presetId: 'animagine-xl-3.1', locale: 'zh' }),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.source, 'local', '测试环境没有宿主模型，应走本地兜底')
    assert.equal(result.body.prompt, text, '无模型时 prompt 保持原文')
    assert.equal(result.body.summary, text, '无模型时 summary 与原文一致')
    assert.equal(result.body.ratioId, '')
    assert.equal(result.body.negative, '', '无模型时 negative 为空串')
    assert.equal(result.body.clarify, null)
    assert.equal(result.body.modelHint, null)
    // v2 去风格：响应里不再有 styleId，字段集合固定。
    assert.equal('styleId' in result.body, false, 'v2 不再返回 styleId')
    assert.deepEqual(Object.keys(result.body).sort(), [
      'clarify',
      'modelHint',
      'negative',
      'ok',
      'prompt',
      'ratioId',
      'source',
      'summary',
    ])

    const blank = await json(host.origin, '/imagen-api/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })
    assert.equal(blank.status, 400, '空对话内容应返回 400')

    const tooLong = await json(host.origin, '/imagen-api/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(LIMITS.intentText.maxChars + 1) }),
    })
    assert.equal(tooLong.status, 400, '超长对话内容应返回 400')
    assert.equal(tooLong.body.error.code, 'invalid_request')
  })

  await check('意图解析（有模型）：英文 prompt、UI 语言摘要与 v2 字段归一', async () => {
    const llm = createFakeLlm(JSON.stringify({
      prompt: 'masterpiece, best quality, highres, rainy night city street, wet pavement reflecting neon signs, cinematic lighting',
      summary: '雨夜城市街景，湿润路面倒映霓虹招牌，电影感光影',
      ratio: '16:9',
      negative: 'blurry, low quality, text, watermark',
      style: 'film',
      clarify: null,
      modelHint: { presetId: 'realvis-v5', reason: '写实街景与皮肤质感更适合 RealVisXL' },
    }))
    fake.setLlm(llm)
    try {
      const result = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '画一张横版的雨夜街景，要写实一点', locale: 'zh', presetId: 'animagine-xl-3.1' }),
      })
      assert.equal(result.status, 200)
      assert.equal(result.body.source, 'model')
      assert.match(result.body.prompt, /^[A-Za-z0-9 ,'-]+$/, '发给模型的 prompt 必须是英文')
      assert.ok(!/[\u3400-\u9fff]/.test(result.body.prompt), '中文不得进入提示词')
      assert.match(result.body.summary, /[\u3400-\u9fff]/, '中文界面的摘要用中文')
      assert.equal(result.body.ratioId, '16:9')
      assert.equal(result.body.negative, 'blurry, low quality, text, watermark', '可用负向词的模型应透传 negative')
      assert.equal(result.body.clarify, null)
      assert.deepEqual(
        result.body.modelHint,
        { presetId: 'realvis-v5', reason: '写实街景与皮肤质感更适合 RealVisXL' },
        '合法 modelHint 原样透传',
      )
      assert.equal('styleId' in result.body, false, '模型输出的旧 style 字段应被忽略')

      // 三段式 system prompt：身份 / 模型手册（当前模型 + 全库）/ 软性策略 + v2 字段规则。
      const call = llm.calls[0]
      assert.equal(call.messages.at(-1).content[0].text, '画一张横版的雨夜街景，要写实一点', '用户原话应原样发给模型')
      assert.ok(call.system.includes('【身份与使命】'), 'system prompt 应有身份与使命段')
      assert.ok(call.system.includes('【模型手册】'), 'system prompt 应有模型手册段')
      assert.ok(call.system.includes('【组织与沟通策略】'), 'system prompt 应有组织与沟通策略段')
      assert.ok(call.system.includes('Animagine XL 3.1'), '模型手册应带当前模型画像')
      assert.ok(call.system.includes('RealVisXL V5.0'), '模型手册应带全库模型')
      assert.ok(call.system.includes('Danbooru'), 'danbooru 预设应要求标签流')
      assert.ok(call.system.includes('masterpiece, best quality, highres'), '质量词前缀应写进 system prompt')
      assert.ok(call.system.includes('summary'), 'system prompt 应约定 summary 字段')
      assert.ok(call.system.includes('"negative"'), 'system prompt 应约定 negative 字段')
      assert.ok(call.system.includes('modelHint') && call.system.includes('clarify'), 'system prompt 应约定澄清与模型建议')
      assert.ok(!call.system.includes('"style"'), 'v2 system prompt 不再要求 style 字段')

      // 自然语言预设：要求换成英文段落；同一个模型输出仍按同一套字段解析。
      const natural = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '画一张横版的雨夜街景，要写实一点', locale: 'zh', presetId: 'realvis-v5' }),
      })
      assert.equal(natural.body.source, 'model')
      assert.ok(llm.calls[1].system.includes('自然语言段落'), 'natural 预设应要求自然语言段落')

      // 没有 history 时，旧的 previousPrompt 仍以「上一轮提示词」注入，兼容旧客户端。
      await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '在雨夜里加一把伞', previousPrompt: 'rainy night street, neon signs' }),
      })
      const withPrevious = llm.calls.at(-1)
      assert.ok(withPrevious.system.includes('上一轮提示词'), 'previousPrompt 应作为上一轮上下文注入')
      assert.ok(withPrevious.system.includes('rainy night street, neon signs'))
    } finally {
      fake.setLlm(null)
    }
  })

  await check('意图解析 v2：negative 按模型能力与 CFG 决定', async () => {
    const llm = createFakeLlm(JSON.stringify({
      prompt: 'rainy street, neon signs',
      summary: '雨夜街道',
      ratio: '1:1',
      negative: 'blurry, low quality',
      clarify: null,
      modelHint: null,
    }))
    fake.setLlm(llm)
    try {
      const request = (body) =>
        json(host.origin, '/imagen-api/intent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })

      // CFG=0（默认 4 步极速模型）：negative 必须空串，system prompt 明确说不生效。
      const zero = await request({ text: '雨夜街道', presetId: 'sdxl-lightning', cfg: 0 })
      assert.equal(zero.body.negative, '', 'CFG=0 时 negative 必须是空串')
      assert.ok(llm.calls.at(-1).system.includes('CFG=0'))
      assert.ok(llm.calls.at(-1).system.includes('负向词不生效'))

      // 用户主动抬高 CFG：模型有能力 + negativeHint 非空 → 生效。
      const raised = await request({ text: '雨夜街道', presetId: 'sdxl-lightning', cfg: 5 })
      assert.equal(raised.body.negative, 'blurry, low quality', 'CFG 抬高后 negative 应透传')
      assert.ok(llm.calls.at(-1).system.includes('CFG=5'))

      // 推荐 CFG>0 且带 negativeHint 的模型：默认即可用负向词。
      const animagine = await request({ text: '二次元少女', presetId: 'animagine-xl-3.1' })
      assert.equal(animagine.body.negative, 'blurry, low quality', '推荐配置可用负向词时应透传')

      // 不支持负向词的模型：即使 CFG 很高也必须空串。
      const flux = await request({ text: '雨夜街道', presetId: 'flux2-klein-4b', cfg: 9 })
      assert.equal(flux.body.negative, '', '不支持负向词的模型必须空串')
      assert.ok(llm.calls.at(-1).system.includes('不支持负向词'))

      // cfg 缺失/非法：回落到预设推荐值（sdxl-lightning 推荐 0）。
      const missing = await request({ text: '雨夜街道', presetId: 'sdxl-lightning' })
      assert.equal(missing.body.negative, '', '缺失 cfg 回落推荐值')
      assert.ok(llm.calls.at(-1).system.includes('CFG=0'))
      const invalid = await request({ text: '雨夜街道', presetId: 'sdxl-lightning', cfg: 'abc' })
      assert.equal(invalid.status, 200, '非法 cfg 忽略而不是报错')
      assert.equal(invalid.body.negative, '')
      assert.ok(llm.calls.at(-1).system.includes('CFG=0'))
    } finally {
      fake.setLlm(null)
    }
  })

  await check('意图解析 v2：clarify / modelHint 按契约边界归一', async () => {
    const llm = createFakeLlm(JSON.stringify({
      prompt: 'rainy street',
      summary: '摘要'.repeat(300),
      ratio: 'bogus',
      negative: 'blurry',
      clarify: {
        question: '你更想要哪一种画面走向？'.repeat(10),
        options: ['写实摄影', '二次元插画', '写实摄影', '   ', '水墨写意', '3D 渲染'],
      },
      modelHint: { presetId: 'sdxl-lightning', reason: '同款模型' },
    }))
    fake.setLlm(llm)
    try {
      const result = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '画个雨夜街道', presetId: 'sdxl-lightning', cfg: 4 }),
      })
      assert.equal(result.body.ratioId, '', '非法比例回落空串')
      assert.ok(result.body.summary.length <= INTENT.summaryMaxChars, 'summary 应按契约截断')
      assert.ok(result.body.clarify, '有效澄清应保留')
      assert.ok(result.body.clarify.question.length <= INTENT.clarifyQuestionMaxChars, '问题应截断')
      assert.deepEqual(
        result.body.clarify.options,
        ['写实摄影', '二次元插画', '水墨写意', '3D 渲染'],
        '选项应去重、丢空、截到 2~4 条',
      )
      for (const option of result.body.clarify.options) {
        assert.ok(option.length <= INTENT.clarifyOptionMaxChars, '选项应截断')
      }
      assert.equal(result.body.modelHint, null, '与当前预设相同的 modelHint 应丢弃')

      // 理由为空：用目标模型的定位补一句；未知预设 id 丢弃。
      fake.setLlm(createFakeLlm(JSON.stringify({
        prompt: 'x',
        summary: 'y',
        ratio: '',
        negative: '',
        clarify: null,
        modelHint: { presetId: 'flux2-klein-4b' },
      })))
      const fallbackReason = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '画个雨夜街道', presetId: 'sdxl-lightning' }),
      })
      assert.equal(fallbackReason.body.modelHint.presetId, 'flux2-klein-4b')
      assert.ok(fallbackReason.body.modelHint.reason.length > 0, '空理由应由模型定位补齐')
      assert.ok(fallbackReason.body.modelHint.reason.length <= INTENT.modelHintReasonMaxChars)
      assert.match(fallbackReason.body.modelHint.reason, /商业级质感/, '理由应取自目标模型定位')

      fake.setLlm(createFakeLlm(JSON.stringify({
        prompt: 'x',
        summary: 'y',
        ratio: '',
        negative: '',
        clarify: { question: '只有一个选项', options: ['唯一选项'] },
        modelHint: { presetId: 'no-such-model', reason: '不存在' },
      })))
      const dropped = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '画个雨夜街道' }),
      })
      assert.equal(dropped.body.clarify, null, '有效选项不足 2 条时丢弃澄清')
      assert.equal(dropped.body.modelHint, null, '不存在的模型 id 应丢弃')

      // 模型仍返回旧字段（style / clarify.field）时不崩、按 v2 归一。
      fake.setLlm(createFakeLlm(JSON.stringify({
        prompt: 'x',
        summary: 'y',
        ratio: '16:9',
        style: 'ink',
        clarify: { field: 'ratio', options: ['1:1', '16:9'] },
      })))
      const legacy = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '画个雨夜街道' }),
      })
      assert.equal(legacy.body.ratioId, '16:9')
      assert.equal(legacy.body.clarify, null, '旧式 clarify 没有 question，按无效丢弃')
      assert.equal('styleId' in legacy.body, false)
    } finally {
      fake.setLlm(null)
    }
  })

  await check('意图解析：history 多轮裁剪与 cfg 透传', async () => {
    const llm = createFakeLlm(JSON.stringify({
      prompt: 'rainy street, heavier rain',
      summary: '雨夜街道，雨势更大',
      ratio: '',
      negative: 'blurry, low quality',
      clarify: null,
      modelHint: null,
    }))
    fake.setLlm(llm)
    try {
      // 构造超量 + 非法项的历史：只保留最近 maxMessages 条合法消息，单条超长截断。
      const history = []
      for (let index = 0; index < LIMITS.intentHistory.maxMessages + 3; index += 1) {
        history.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `第 ${index} 条` })
      }
      history.push({ role: 'system', content: '系统消息应被丢弃' })
      history.push({ role: 'user', content: 42 })
      history.push({ role: 'assistant', content: 'x'.repeat(LIMITS.intentHistory.maxMessageChars + 500) })

      const result = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: '继续修改，把雨下大一点',
          previousPrompt: 'OLD-PROMPT-SHOULD-BE-IGNORED',
          presetId: 'sdxl-lightning',
          cfg: 6,
          history,
        }),
      })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      assert.equal(result.body.source, 'model')
      assert.equal(result.body.negative, 'blurry, low quality', 'cfg=6 透传后负向词应生效')

      const call = llm.calls.at(-1)
      assert.equal(
        call.messages.length,
        LIMITS.intentHistory.maxMessages + 1,
        'history 按 maxMessages 裁剪后追加当前用户消息',
      )
      assert.equal(call.messages.at(-1).role, 'user')
      assert.equal(call.messages.at(-1).content[0].text, '继续修改，把雨下大一点')
      assert.equal(
        call.messages.at(-2).content[0].text.length,
        LIMITS.intentHistory.maxMessageChars,
        '超长历史消息按单条上限截断',
      )
      for (const message of call.messages) {
        assert.ok(['user', 'assistant'].includes(message.role), `历史 role 只允许 user/assistant：${message.role}`)
        assert.equal(message.content[0].type, 'text')
      }
      assert.ok(
        !call.messages.some((message) => message.content[0].text === '系统消息应被丢弃'),
        '非法 role 的历史项应被丢弃',
      )
      assert.ok(call.system.includes('CFG=6'), 'cfg 应透传进 system prompt')
      assert.ok(
        !call.system.includes('OLD-PROMPT-SHOULD-BE-IGNORED'),
        'history 非空时优先 history，不再注入 previousPrompt',
      )

      // history 非数组 / 全非法：不报错，等价于单轮解析。
      const invalidHistory = await json(host.origin, '/imagen-api/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '再来一张', presetId: 'sdxl-lightning', cfg: 6, history: 'not-an-array' }),
      })
      assert.equal(invalidHistory.status, 200)
      assert.equal(llm.calls.at(-1).messages.length, 1, '非法 history 只保留当前用户消息')
    } finally {
      fake.setLlm(null)
    }
  })

  await check('图生图：作品参考图走 /generate 全链路，任务视图只回出处与强度', async () => {
    const dir = join(workspace, 'imagen-output', '20260101-000000-img2img')
    await mkdir(dir, { recursive: true })
    const sourcePath = 'imagen-output/20260101-000000-img2img/01.png'
    await writeFile(join(dir, '01.png'), Buffer.from(PNG_B64, 'base64'))

    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '在雨夜里重绘这张风景',
        presetId: 'sdxl-lightning',
        reference: { path: sourcePath, strength: 0.65 },
        waitSeconds: 15,
      }),
    })
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    const job = submitted.body
    assert.equal(job.status, 'done')
    assert.deepEqual(job.params.reference, { sourcePath, strength: 0.65 })
    assert.ok(!JSON.stringify(job).includes(PNG_B64), '任务视图不得回传参考图二进制')

    const invalid = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '越界参考图', reference: { path: '../escape.png' } }),
    })
    assert.equal(invalid.status, 400, '越界参考图必须在入队前被拒绝')
    assert.equal(invalid.body.error.code, 'invalid_path')
  })

  await check('局部重绘：参考图 + 蒙版走 /generate 全链路，请求体带 mask_b64、meta 记 inpaint', async () => {
    const dir = join(workspace, 'imagen-output', '20260101-000000-inpaint')
    await mkdir(dir, { recursive: true })
    const sourcePath = 'imagen-output/20260101-000000-inpaint/01.png'
    await writeFile(join(dir, '01.png'), Buffer.from(PNG_B64, 'base64'))

    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '把天空换成晚霞',
        presetId: 'sdxl-lightning',
        // data URL 前缀由 Host 归一：远端只收到裸 base64。
        reference: { path: sourcePath, strength: 0.8, mask: `data:image/png;base64,${PNG_B64}` },
        waitSeconds: 15,
      }),
    })
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    const job = submitted.body
    assert.equal(job.status, 'done')
    // 公开视图只回出处、强度与「是否带蒙版」，不回任何二进制。
    assert.deepEqual(job.params.reference, { sourcePath, strength: 0.8, mask: true })
    assert.ok(!JSON.stringify(job).includes(PNG_B64), '任务视图不得回传参考图/蒙版二进制')

    const call = mock.state.lastBody
    assert.deepEqual(
      call.reference,
      { image_b64: PNG_B64, strength: 0.8, mask_b64: PNG_B64 },
      '远端载荷必须带归一后的 mask_b64',
    )

    const meta = JSON.parse(await readFile(join(workspace, job.output.dir, 'meta.json'), 'utf8'))
    assert.equal(meta.inpaint, true, 'meta.json 必须记 inpaint 标记')
    assert.equal(meta.sourceImage, sourcePath)
    assert.equal(meta.strength, 0.8)
    assert.equal(meta.params.reference.mask, true)

    // 非法蒙版（非 PNG / base64 不合法 / 带蒙版却没有参考图）必须在入队前 400。
    const invalidMasks = [
      { reference: { path: sourcePath, mask: 'not-base64!!' } },
      { reference: { path: sourcePath, mask: Buffer.from('not a png').toString('base64') } },
      { reference: { mask: PNG_B64 } },
    ]
    for (const payload of invalidMasks) {
      const invalid = await json(host.origin, '/imagen-api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '非法蒙版', ...payload }),
      })
      assert.equal(invalid.status, 400, JSON.stringify(payload))
      assert.equal(invalid.body.error.code, 'invalid_request')
      assert.ok(invalid.body.error.message.includes('蒙版'), invalid.body.error.message)
    }
  })

  await check('局部重绘：蒙版场景 strength 1.0 全链路透传，纯 img2img 仍钳到 0.9', async () => {
    const dir = join(workspace, 'imagen-output', '20260101-000000-inpaint-strength')
    await mkdir(dir, { recursive: true })
    const sourcePath = 'imagen-output/20260101-000000-inpaint-strength/01.png'
    await writeFile(join(dir, '01.png'), Buffer.from(PNG_B64, 'base64'))

    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '夜空换成极光',
        presetId: 'sdxl-lightning',
        // 带蒙版时上限放宽到 LIMITS.strength.inpaintMax=1.0。
        reference: { path: sourcePath, strength: 1.0, mask: PNG_B64 },
        waitSeconds: 15,
      }),
    })
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    const job = submitted.body
    assert.equal(job.status, 'done')
    assert.deepEqual(job.params.reference, { sourcePath, strength: 1.0, mask: true })

    const call = mock.state.lastBody
    assert.deepEqual(
      call.reference,
      { image_b64: PNG_B64, strength: 1.0, mask_b64: PNG_B64 },
      '远端载荷必须原样带归一后的 1.0 强度',
    )
    const meta = JSON.parse(await readFile(join(workspace, job.output.dir, 'meta.json'), 'utf8'))
    assert.equal(meta.strength, 1.0, 'meta.json 必须记录实际使用的 1.0 强度')
    assert.equal(meta.inpaint, true)

    // 对照：没有蒙版时同一条 1.0 请求仍被钳到 img2img 的 max（0.9），行为不变。
    const plain = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '无蒙版参考图',
        presetId: 'sdxl-lightning',
        reference: { path: sourcePath, strength: 1.0 },
        waitSeconds: 15,
      }),
    })
    assert.equal(plain.status, 200, JSON.stringify(plain.body))
    assert.equal(plain.body.params.reference.strength, LIMITS.strength.max)
    assert.equal(mock.state.lastBody.reference.strength, LIMITS.strength.max)
  })

  await check('局部重绘：空蒙版在执行期被远端拦截 → 异步任务终态 failed + invalid_request', async () => {
    const dir = join(workspace, 'imagen-output', '20260101-000000-inpaint-empty')
    await mkdir(dir, { recursive: true })
    const sourcePath = 'imagen-output/20260101-000000-inpaint-empty/01.png'
    await writeFile(join(dir, '01.png'), Buffer.from(PNG_B64, 'base64'))

    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '空蒙版',
        presetId: 'sdxl-lightning',
        // 全黑 PNG：Host 只做 PNG 魔数预检，请求合法并被远端 202 接单；
        // 真 daemon 在执行期解码后按 minCoverage 拒绝（加载模型前），只在这里模拟同一个拒绝点。
        reference: { path: sourcePath, strength: 0.8, mask: EMPTY_MASK_B64 },
        waitSeconds: 15,
      }),
    })
    assert.equal(submitted.status, 200, `空蒙版不是入队期 400：${JSON.stringify(submitted.body)}`)
    const job = submitted.body
    assert.equal(job.status, 'failed', JSON.stringify(job))
    assert.equal(job.error?.code, 'invalid_request')
    assert.ok(job.error?.message.includes('蒙版是空的'), job.error?.message)
    assert.equal(job.output, null, '失败任务不应落产物目录')
  })

  await check('局部重绘：参考图 + 蒙版接近上限时不被请求体闸门拒掉', async () => {
    // 只按参考图推导请求体上限（修复前）时，这个请求会在路由层被 invalid_body 拒掉：
    // 参考图 8MiB + 蒙版 2MiB 的 base64 体积是 14MB 量级，而旧上限约 11.2MB。
    const paddedPngB64 = (size) => {
      const buffer = Buffer.alloc(size)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
      return buffer.toString('base64')
    }
    const referenceB64 = paddedPngB64(7.5 * 1024 * 1024)
    const maskB64 = paddedPngB64(1.5 * 1024 * 1024)
    const body = JSON.stringify({
      prompt: '大图局部重绘',
      presetId: 'sdxl-lightning',
      reference: { image: referenceB64, strength: 0.6, mask: maskB64 },
      waitSeconds: 15,
    })
    const oldLimit =
      Math.ceil((LIMITS.reference.maxBytes * 4) / 3) + 64 * 1024
    assert.ok(
      Buffer.byteLength(body) > oldLimit,
      `构造的请求体必须超过「只按参考图推导」的旧上限，否则这条用例失去意义（${Buffer.byteLength(body)} vs ${oldLimit}）`,
    )
    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    assert.equal(submitted.body.status, 'done')
    assert.equal(submitted.body.params.reference.mask, true)
  })

  // ── 阶段十三：版本链（rootImage 继承 / 历史透传 / 版本树路由）─────────────
  // 先在「历史透传」用例里播种根作品与旧子作品，后续 tree 用例复用这组夹具。
  let tree = null

  await check('版本链：二级派生继承 rootImage，/history 透传与旧 meta 回溯', async () => {
    // 根作品：纯文生图的产物目录（没有 sourceImage / rootImage），播种时间取 2020，保证比真实任务旧。
    const rootDir = join(workspace, 'imagen-output', '20200102-000000-tree-root')
    await mkdir(rootDir, { recursive: true })
    const rootPath = 'imagen-output/20200102-000000-tree-root/01.png'
    await writeFile(join(rootDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    await writeFile(
      join(rootDir, 'meta.json'),
      JSON.stringify({
        version: 1,
        jobId: 'j_tree_root',
        presetId: 'sdxl-turbo',
        createdAt: '2020-01-02T00:00:00.000Z',
        finishedAt: '2020-01-02T00:00:01.000Z',
        params: { prompt: '版本树根', negativePrompt: '', width: 512, height: 512, steps: 3, cfg: 1.5, seed: 1, count: 1 },
        images: [{ file: '01.png', seed: 1, seconds: 0.1, width: 512, height: 512, prompt: '版本树根' }],
      }),
      'utf8',
    )
    // 旧子作品：只记 sourceImage（0.12 及以前的数据，没有 rootImage），历史接口应回溯到根。
    const legacyDir = join(workspace, 'imagen-output', '20200102-000001-tree-legacy')
    await mkdir(legacyDir, { recursive: true })
    const legacyPath = 'imagen-output/20200102-000001-tree-legacy/01.png'
    await writeFile(join(legacyDir, '01.png'), Buffer.from(PNG_B64, 'base64'))
    await writeFile(
      join(legacyDir, 'meta.json'),
      JSON.stringify({
        version: 1,
        jobId: 'j_tree_legacy',
        presetId: 'sdxl-lightning',
        createdAt: '2020-01-02T00:00:02.000Z',
        finishedAt: '2020-01-02T00:00:03.000Z',
        params: { prompt: '一级派生', negativePrompt: '', width: 512, height: 512, steps: 3, cfg: 1.5, seed: 2, count: 1 },
        images: [{ file: '01.png', seed: 2, seconds: 0.1, width: 512, height: 512, prompt: '一级派生' }],
        sourceImage: rootPath,
        strength: 0.6,
        inpaint: true,
      }),
      'utf8',
    )

    // 从旧子作品再派生一次：走真实 /generate 全链路，落盘 meta 应沿旧 meta 的链回溯到根。
    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '二级派生',
        presetId: 'sdxl-lightning',
        reference: { path: legacyPath, strength: 0.55 },
        waitSeconds: 15,
      }),
    })
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    const job = submitted.body
    assert.equal(job.status, 'done', JSON.stringify(job))
    const meta = JSON.parse(await readFile(join(workspace, job.output.dir, 'meta.json'), 'utf8'))
    assert.equal(meta.sourceImage, legacyPath)
    assert.equal(meta.rootImage, rootPath, '二级派生应沿旧 meta 的 sourceImage 链回溯到根')
    assert.equal(meta.inpaint, undefined, '纯图生图不应写 inpaint 标记')

    // /history 透传：新条目字段与 meta 一致；旧条目 rootImage 由 Host 回溯补齐。
    const history = await json(host.origin, `/imagen-api/history?limit=${LIMITS.history.maxLimit}`)
    const derived = history.body.items.find((entry) => entry.jobId === job.id)
    assert.ok(derived, '历史里应有刚生成的二级派生')
    assert.equal(derived.sourceImage, legacyPath)
    assert.equal(derived.rootImage, rootPath)
    assert.equal(derived.inpaint, false)
    assert.equal(derived.strength, 0.55)

    const seededRoot = history.body.items.find((entry) => entry.jobId === 'j_tree_root')
    assert.equal(seededRoot.sourceImage, null, '根作品没有来源图')
    assert.equal(seededRoot.rootImage, null)
    assert.equal(seededRoot.inpaint, false)
    assert.equal(seededRoot.strength, null)

    const seededLegacy = history.body.items.find((entry) => entry.jobId === 'j_tree_legacy')
    assert.equal(seededLegacy.sourceImage, rootPath)
    assert.equal(seededLegacy.rootImage, rootPath, '旧 meta 缺 rootImage 时 /history 应回溯补齐')
    assert.equal(seededLegacy.inpaint, true, '旧 meta 的 inpaint 标记原样透传')
    assert.equal(seededLegacy.strength, 0.6, '旧 meta 的 strength 原样透传')

    tree = { rootPath, legacyPath, derivedId: job.id }
  })

  await check('版本树：/history/tree 按根命中整棵树、倒序与 limit 分页', async () => {
    const url = `/imagen-api/history/tree?root=${encodeURIComponent(tree.rootPath)}`
    const all = await json(host.origin, url)
    assert.equal(all.status, 200, JSON.stringify(all.body))
    assert.equal(all.body.root, tree.rootPath, 'root 原样回显（归一后的相对路径）')
    assert.deepEqual(
      all.body.items.map((item) => item.jobId),
      [tree.derivedId, 'j_tree_legacy', 'j_tree_root'],
      '树内条目按目录名倒序（新→旧），根节点自身通过图片路径命中',
    )
    assert.equal(all.body.hasMore, false)
    assert.equal(all.body.items[0].rootImage, tree.rootPath)

    // limit 分页：只取最新 2 条，hasMore 指示还有更早的节点。
    const page = await json(host.origin, `${url}&limit=2`)
    assert.equal(page.body.items.length, 2)
    assert.deepEqual(page.body.items.map((item) => item.jobId), [tree.derivedId, 'j_tree_legacy'])
    assert.equal(page.body.hasMore, true)

    const single = await json(host.origin, `${url}&limit=1`)
    assert.equal(single.body.items.length, 1)
    assert.equal(single.body.hasMore, true)
    assert.equal(single.body.items[0].jobId, tree.derivedId)

    // limit 越界钳到契约上限；非法 limit 回默认（pageSize），都不会报错。
    const clamped = await json(host.origin, `${url}&limit=9999`)
    assert.equal(clamped.body.items.length, 3)
    assert.equal(clamped.body.hasMore, false)
    const invalidLimit = await json(host.origin, `${url}&limit=abc`)
    assert.equal(invalidLimit.body.items.length, 3, '非法 limit 按 pageSize 默认值返回')
  })

  await check('版本树：空树 200、root 缺失/越界 400 invalid_request、方法 405', async () => {
    // 没有任何条目归组的根（目录甚至不存在）：仍然是 200 空树，不是 404。
    const missingRoot = 'imagen-output/20300101-000000-no-such-tree/01.png'
    const empty = await json(host.origin, `/imagen-api/history/tree?root=${encodeURIComponent(missingRoot)}`)
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.body, { root: missingRoot, items: [], hasMore: false })

    // 纯文生图的根节点自身也能命中（item.images 任一 path === root）。
    const selfRoot = firstJob.output.images[0].path
    const self = await json(host.origin, `/imagen-api/history/tree?root=${encodeURIComponent(selfRoot)}`)
    assert.equal(self.status, 200)
    assert.deepEqual(self.body.items.map((item) => item.jobId), [firstJob.id])
    assert.equal(self.body.items[0].rootImage, null)

    // root 缺失 / 空串 / 越界 / 非产物目录：统一 400 invalid_request。
    const cases = [
      '/imagen-api/history/tree',
      '/imagen-api/history/tree?root=',
      '/imagen-api/history/tree?root=%20',
      `/imagen-api/history/tree?root=${encodeURIComponent('../index.js')}`,
      `/imagen-api/history/tree?root=${encodeURIComponent('docs/assets/hero.png')}`,
      `/imagen-api/history/tree?root=${encodeURIComponent('/etc/passwd')}`,
      `/imagen-api/history/tree?root=${encodeURIComponent('imagen-output/../../index.js')}`,
    ]
    for (const requestPath of cases) {
      const bad = await json(host.origin, requestPath)
      assert.equal(bad.status, 400, `${requestPath} 应返回 400`)
      assert.equal(bad.body.error.code, 'invalid_request', requestPath)
    }

    // 非 GET：405（与 /history 等其他只读路由一致）。
    const treeUrl = `/imagen-api/history/tree?root=${encodeURIComponent(tree.rootPath)}`
    const notAllowed = await json(host.origin, treeUrl, { method: 'POST' })
    assert.equal(notAllowed.status, 405)
  })

  await check('版本链：动态上传参考图（无 sourcePath）rootImage 为 null', async () => {
    const submitted = await json(host.origin, '/imagen-api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '上传参考图派生', reference: { image: PNG_B64, strength: 0.5 }, waitSeconds: 15 }),
    })
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    const job = submitted.body
    assert.equal(job.status, 'done', JSON.stringify(job))
    const meta = JSON.parse(await readFile(join(workspace, job.output.dir, 'meta.json'), 'utf8'))
    assert.equal(meta.sourceImage, null)
    assert.equal(meta.rootImage, null, '上传来源没有可归组的根作品')

    const history = await json(host.origin, `/imagen-api/history?limit=${LIMITS.history.maxLimit}`)
    const item = history.body.items.find((entry) => entry.jobId === job.id)
    assert.equal(item.sourceImage, null)
    assert.equal(item.rootImage, null)
    assert.equal(item.inpaint, false)
    assert.equal(item.strength, 0.5)
  })

  await check('打开产物目录（dryRun 只解析路径）', async () => {
    const result = await json(host.origin, '/imagen-api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.dryRun, true)
    assert.equal(typeof result.body.dir, 'string')
    assert.ok(result.body.dir.endsWith('imagen-output'), `dir=${result.body.dir}`)
  })

  await check('日志路由直连：hostLines 读取工作区本地日志尾部', async () => {
    // 独立起一份路由，用临时工作区验证 hostLines 的真实读取路径（不依赖 index.js 的装配）。
    const dir = await mkdtemp(join(tmpdir(), 'imagen-logs-route-'))
    const logDir = join(dir, '.imagen', 'logs')
    await mkdir(logDir, { recursive: true })
    await writeFile(join(logDir, 'host.log'), 'host-line-1\nhost-line-2\nhost-line-3\n', 'utf8')
    const routes = createLogRoutes({
      session: { ctx: null, connection: () => ({ endpoint: null, token: null }) },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      ctx: { get: (name) => (name === 'workingDirectory' ? { defaultDirectory: dir } : undefined) },
    })
    const local = await startHost(routes)
    try {
      const { status, body } = await json(local.origin, '/imagen-api/logs?since=0')
      assert.equal(status, 200)
      assert.equal(body.ok, false)
      assert.equal(body.code, 'session_absent')
      assert.ok(Array.isArray(body.hostLines), 'hostLines 必须是数组')
      assert.ok(body.hostLines.includes('host-line-3'), `应从 <workspace>/.imagen/logs/host.log 读到尾部：${JSON.stringify(body.hostLines)}`)
      assert.ok(body.hostLines.length <= 120)
    } finally {
      local.server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  await check('Kaggle 访问方式：/state 暴露当前传输，运行设置可切换并即时生效', async () => {
    const before = await json(host.origin, '/imagen-api/state')
    assert.equal(before.status, 200)
    assert.equal(before.body.kaggleTransport, 'direct', '默认走直连，免装 kaggle CLI')

    const settings = await json(host.origin, '/imagen-api/settings')
    assert.equal(settings.status, 200)
    assert.equal(settings.body.settings.kaggleTransport, 'direct')

    // 兼容退路仍可手动切回 CLI（排障 / 直连不可用时）。
    const saved = await json(host.origin, '/imagen-api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kaggleTransport: 'cli' }),
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.settings.kaggleTransport, 'cli')

    // 传输层每次调用都读最新设置：不需要重载插件，下一次 /state 就应该是 cli。
    const after = await json(host.origin, '/imagen-api/state')
    assert.equal(after.body.kaggleTransport, 'cli')

    const invalid = await json(host.origin, '/imagen-api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kaggleTransport: 'bogus' }),
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error.code, 'invalid_request')

    // 还原成默认，避免影响后续场景。
    await json(host.origin, '/imagen-api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kaggleTransport: 'direct' }),
    })
  })

  await check('Kaggle 直连登录路由：GET 登录态 / 非法动作 400 / 空闲取消幂等 / 405', async () => {
    const initial = await json(host.origin, '/imagen-api/kaggle/login')
    assert.equal(initial.status, 200)
    assert.equal(initial.body.ok, true)
    assert.equal(initial.body.login.state, 'idle')
    for (const key of ['state', 'mode', 'url', 'message', 'username', 'startedAt', 'finishedAt']) {
      assert.ok(Object.prototype.hasOwnProperty.call(initial.body.login, key), `LoginView 缺字段 ${key}`)
    }

    const badAction = await json(host.origin, '/imagen-api/kaggle/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'bogus' }),
    })
    assert.equal(badAction.status, 400)
    assert.equal(badAction.body.error.code, 'invalid_request')

    const missingCode = await json(host.origin, '/imagen-api/kaggle/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit-code' }),
    })
    assert.equal(missingCode.status, 400)
    assert.equal(missingCode.body.error.code, 'invalid_request')

    // 非 pending 状态下 cancel 是幂等的：返回当前视图，不打开浏览器、不占端口。
    const cancelled = await json(host.origin, '/imagen-api/kaggle/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.login.state, 'idle')

    const notAllowed = await json(host.origin, '/imagen-api/kaggle/login', { method: 'PUT' })
    assert.equal(notAllowed.status, 405)
  })

  await check('会话停止', async () => {
    const { body } = await json(host.origin, '/imagen-api/session/stop', { method: 'POST' })
    assert.equal(body.ok, true)
    assert.equal(body.session.state, 'absent')
  })

  fake.dispose()
  host.server.close()
  mock.server.close()
  await rm(workspace, { recursive: true, force: true })

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
