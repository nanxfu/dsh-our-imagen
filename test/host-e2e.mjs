/**
 * Host 侧端到端测试（不依赖 Kaggle、不联网）。
 *
 * 做法：起一个 Node mock daemon 模仿远端协议，再用假的 cordis Context 加载 index.js，
 * 把插件路由挂到本地 HTTP 服务上，然后按 docs/SPEC.md 的真实请求形状跑完整链路：
 *   session/start → generate → 落盘 → history → file → Agent 工具
 *
 * 运行：node test/host-e2e.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply as applyPlugin } from '../index.js'
import { VERSION } from '../shared/contract.js'

// 1×1 透明 PNG，用于伪造远端返回
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const DEV_TOKEN = 'dev-token-test'

function startMockDaemon() {
  // 异步 job 协议（v0.5.0）：POST /generate 只入队并返回 202 + job_id，
  // GET /job?id= 返回状态与结果。这里任务立即完成，Host 第一次轮询就能拿到结果，
  // 端到端测试不会为了轮询间隔变慢。
  const state = { generateCalls: 0, healthCalls: 0, lastBody: null, jobs: new Map() }
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
        const jobId = String(body.jobId || `mock-job-${state.generateCalls}`)
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
        state.jobs.set(jobId, {
          status: 'done',
          job_id: jobId,
          model_id: body.modelId,
          progress: { done: results.length, total: results.length },
          load_seconds: 0.1,
          results,
          error: null,
        })
        send(202, { status: 'accepted', job_id: jobId, model_id: body.modelId })
      })
      return
    }

    if (req.method === 'GET' && req.url.startsWith('/job?id=')) {
      const id = decodeURIComponent(req.url.slice('/job?id='.length))
      const job = state.jobs.get(id)
      if (!job) return send(404, { error: { code: 'unknown_job', message: '任务不存在或已过期' } })
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

function createFakeContext(workspace) {
  const routes = []
  const tools = []
  const cleanups = []
  let origin = ''

  const ctx = {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      return undefined
    },
    effect(fn, _label) {
      const disposer = fn()
      if (typeof disposer === 'function') cleanups.push(disposer)
      return disposer
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
      getOrigin: () => origin,
    },
    subprocess: {
      async resolveExecutable(name) {
        throw new Error(`测试环境不执行外部命令：${name}`)
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
  }

  return {
    ctx,
    routes,
    tools,
    setOrigin(value) {
      origin = value
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {}
      }
    },
  }
}

function startHost(routes) {
  const server = createServer((req, res) => {
    let pathname = '/'
    try {
      pathname = new URL(req.url, 'http://placeholder.local').pathname
    } catch {}
    const route = routes.find((item) => item.path === pathname)
    if (!route) {
      res.writeHead(404)
      return res.end()
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(error?.stack ?? error))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }))
  })
}

async function json(base, path, options) {
  const res = await fetch(new URL(path, base), options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
  }
}

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
      '/imagen-api/jobs',
      '/imagen-api/history',
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
    assert.deepEqual(names.sort(), ['imagen_generate', 'imagen_history', 'imagen_session'])
    for (const tool of fake.tools) {
      assert.ok(tool.output?.render, `${tool.name} 缺少 output.render`)
      assert.ok(tool.parameters?.type === 'object', `${tool.name} 参数根必须是 object`)
    }
  })

  await check('初始状态为 absent', async () => {
    const { status, body } = await json(host.origin, '/imagen-api/state')
    assert.equal(status, 200)
    assert.equal(body.session.state, 'absent')
    assert.equal(body.devMode, true)
    assert.ok(Array.isArray(body.presets) && body.presets.length >= 4)
    assert.equal(body.presets[0].pipeline, undefined, '预设不应泄露 pipeline 细节')
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

    assert.equal(mock.state.lastBody.pipeline.loader, 'sdxl')
    assert.equal(mock.state.lastBody.tasks.length, 2)
    assert.deepEqual(
      mock.state.lastBody.tasks.map((task) => task.seed),
      [7, 8],
      '同批多张的 seed 应递增',
    )

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
    // 产物文件名由本地序号生成，不拼接远端返回的 name。
    for (const image of item.images) assert.match(image.file, /^\d{2}\.png$/)
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
    assert.ok(['model', 'local'].includes(result.body.source), `source=${result.body.source}`)
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
      }
    }

    const english = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cyber cat', locale: 'en' }),
    })
    assert.equal(english.body.groups[0].options[0].text, 'soft diffused light', '英文 locale 走英文本地建议')

    const blank = await json(host.origin, '/imagen-api/enhance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    })
    assert.deepEqual(blank.body.groups, [], '空描述不产生建议')
  })

  await check('对话意图解析（无模型时走本地兜底）', async () => {
    const result = await json(host.origin, '/imagen-api/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '给我画一张横版的雨夜街景，要写实一点', locale: 'zh' }),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.source, 'local')
    assert.equal(result.body.prompt, '给我画一张横版的雨夜街景，要写实一点')
    assert.equal(result.body.ratioId, '')
    assert.equal(result.body.styleId, '')
    assert.equal(result.body.clarify, null)

    const blank = await json(host.origin, '/imagen-api/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })
    assert.equal(blank.status, 400, '空对话内容应返回 400')
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

  await check('会话停止', async () => {
    const { body } = await json(host.origin, '/imagen-api/session/stop', { method: 'POST' })
    assert.equal(body.ok, true)
    assert.equal(body.session.state, 'absent')
  })

  fake.dispose()
  host.server.close()
  mock.server.close()
  await rm(workspace, { recursive: true, force: true })

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
