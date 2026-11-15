#!/usr/bin/env node
/**
 * 工作台界面状态持久化（v0.9 M1 第 4 项）的离线回归，不联网、不执行外部命令。
 *
 * 覆盖：
 *  - lib/ui-state.js：默认视图、写入读回、合并、损坏 / 版本不符 / 超限回落、
 *    未知字段丢弃、原子写与 0700/0600 权限、会话间不串值；
 *  - normalizeUiStatePatch：白名单与类型校验（未知字段忽略、类型错 invalid_request）；
 *  - lib/routes/ui-state.js：GET 读、POST 合并保存、坏 body / 非对象 → invalid_body、
 *    类型错 → invalid_request、同一路径注册一次并按 method 分发、非法方法 405 + Allow；
 *  - index.js 真实装配：ui-state 路由只注册一次且可直接读写工作区文件。
 *
 * 运行：node test/ui-state-host.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UI_STATE } from '../shared/contract.js'
import { apply as applyPlugin } from '../index.js'
import { registerRoutes } from '../lib/route-kit.js'
import { createUiStateRoutes } from '../lib/routes/ui-state.js'
import {
  defaultUiState,
  normalizeUiStatePatch,
  readUiState,
  uiStatePath,
  writeUiState,
} from '../lib/ui-state.js'
import { createCheckRunner } from './helpers/check.mjs'
import { closeServer, createFakeContext, json, startHost, workspaceContext } from './helpers/fake-context.mjs'

const UI_STATE_ROUTE = '/imagen-api/ui-state'

const { check, summary } = createCheckRunner()

const tempDirs = []
async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'imagen-ui-state-test-'))
  tempDirs.push(dir)
  return dir
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} }

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// ── HTTP 测试脚手架 ───────────────────────────────────────

/**
 * 用 route-kit 注册路由：与 index.js 一样经过「method 数组 → 405 + Allow」包装，
 * 返回真实注册的 route 对象（按 path 查找用）。
 */
function registerWithRouteKit(routes) {
  const registered = []
  const disposers = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    webServer: {
      register(route) {
        registered.push(route)
        return () => {
          const index = registered.indexOf(route)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
  registerRoutes(ctx, routes)
  return { registered, dispose: () => disposers.forEach((fn) => fn()) }
}

function postUiState(origin, value) {
  return json(origin, UI_STATE_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  })
}

// ── 纯函数：契约口径与补丁校验 ────────────────────────────

async function scenarioContractAndNormalize() {
  console.log('\n── 契约口径与 normalizeUiStatePatch')

  await check('契约白名单与默认值可用', () => {
    assert.equal(UI_STATE.version, 1)
    assert.equal(typeof UI_STATE.defaults.advancedOpen, 'boolean')
    assert.equal(UI_STATE.defaults.advancedOpen, false, '高级设置默认收起')
    assert.ok(UI_STATE.maxBytes > 0, '必须登记文件大小上限')
    const first = defaultUiState()
    first.advancedOpen = true
    assert.equal(defaultUiState().advancedOpen, false, 'defaultUiState 每次返回新对象')
  })

  await check('normalizeUiStatePatch：白名单字段归一、未知字段忽略', () => {
    assert.deepEqual(normalizeUiStatePatch({}), { ok: true, value: {} })
    assert.deepEqual(normalizeUiStatePatch({ advancedOpen: true }), { ok: true, value: { advancedOpen: true } })
    assert.deepEqual(normalizeUiStatePatch({ advancedOpen: false }), { ok: true, value: { advancedOpen: false } })
    const unknown = normalizeUiStatePatch({ advancedOpen: true, futureField: 'x', nested: { a: 1 } })
    assert.equal(unknown.ok, true)
    assert.deepEqual(unknown.value, { advancedOpen: true }, '未知字段必须被丢弃')
  })

  await check('normalizeUiStatePatch：已登记字段类型错 → invalid_request', () => {
    for (const patch of [
      { advancedOpen: 'yes' },
      { advancedOpen: 1 },
      { advancedOpen: null },
      { advancedOpen: [] },
      { advancedOpen: {} },
    ]) {
      const result = normalizeUiStatePatch(patch)
      assert.equal(result.ok, false, `应拒绝：${JSON.stringify(patch)}`)
      assert.equal(result.code, 'invalid_request')
      assert.equal(typeof result.message, 'string')
      assert.match(result.message, /advancedOpen/)
    }
    // 非对象入参同样 invalid_request（路由层再区分 invalid_body）。
    for (const patch of [null, 'x', 42, [1]]) {
      assert.equal(normalizeUiStatePatch(patch).ok, false)
    }
  })
}

// ── 模块读写 ──────────────────────────────────────────────

async function scenarioReadWrite() {
  console.log('\n── readUiState / writeUiState')

  await check('无文件时返回默认视图且不抛异常', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    assert.deepEqual(await readUiState(ctx), { advancedOpen: false })
    assert.equal(await pathExists(uiStatePath(ctx)), false, '读取不应创建文件')
  })

  await check('写入 → 读回；文件带版本号并落在 .imagen/ 私有目录', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const written = await writeUiState(ctx, { advancedOpen: true })
    assert.deepEqual(written, { advancedOpen: true })
    assert.deepEqual(await readUiState(ctx), { advancedOpen: true })
    const raw = JSON.parse(await readFile(uiStatePath(ctx), 'utf8'))
    assert.equal(raw.version, UI_STATE.version)
    assert.equal(raw.advancedOpen, true)
    assert.equal(JSON.stringify(raw).includes('unknown'), false)

    const entries = await readdir(join(workspace, '.imagen'))
    assert.deepEqual(
      entries.filter((name) => name.includes('.tmp-')),
      [],
      '原子写不应残留临时文件',
    )

    // 再写一次覆盖旧值。
    await writeUiState(ctx, { advancedOpen: false })
    assert.deepEqual(await readUiState(ctx), { advancedOpen: false })
  })

  await check('未登记字段 / 非法类型在写入时被丢弃', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const written = await writeUiState(ctx, { advancedOpen: true, mystery: 'x', nested: { a: 1 } })
    assert.deepEqual(written, { advancedOpen: true })
    const raw = JSON.parse(await readFile(uiStatePath(ctx), 'utf8'))
    assert.deepEqual(Object.keys(raw).sort(), ['advancedOpen', 'version'])
    // 非法类型不写入，保留默认值。
    const fallback = await writeUiState(ctx, { advancedOpen: 'yes' })
    assert.deepEqual(fallback, { advancedOpen: false })
  })

  await check('目录 0700、文件 0600（Windows 忽略 mode 差异）', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    await writeUiState(ctx, { advancedOpen: true })
    if (process.platform !== 'win32') {
      const dirMode = (await stat(join(workspace, '.imagen'))).mode & 0o777
      const fileMode = (await stat(uiStatePath(ctx))).mode & 0o777
      assert.equal(dirMode, 0o700, `目录权限 ${dirMode.toString(8)}`)
      assert.equal(fileMode, 0o600, `文件权限 ${fileMode.toString(8)}`)
    }
  })

  await check('原子写前清理上次中断留下的临时文件', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const dir = join(workspace, '.imagen')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'ui-state.json.tmp-stale'), '{"broken":', 'utf8')
    await writeUiState(ctx, { advancedOpen: true })
    const entries = await readdir(dir)
    assert.deepEqual(
      entries.filter((name) => name.startsWith('ui-state.json.tmp-')),
      [],
      '应清理旧临时文件',
    )
    assert.deepEqual(await readUiState(ctx), { advancedOpen: true })
  })
}

async function scenarioFallbacks() {
  console.log('\n── 损坏 / 版本不符 / 超限回落默认值')

  await check('JSON 损坏 → 默认值，并清理损坏文件', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const path = uiStatePath(ctx)
    await mkdir(join(workspace, '.imagen'), { recursive: true })
    await writeFile(path, '{不是 JSON', 'utf8')
    assert.deepEqual(await readUiState(ctx), { advancedOpen: false })
    assert.equal(await pathExists(path), false, '损坏文件应被清理，避免反复解析失败')
  })

  await check('版本不符 → 默认值，并清理旧版本文件', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const path = uiStatePath(ctx)
    await mkdir(join(workspace, '.imagen'), { recursive: true })
    await writeFile(path, JSON.stringify({ version: UI_STATE.version + 1, advancedOpen: true }), 'utf8')
    assert.deepEqual(await readUiState(ctx), { advancedOpen: false })
    assert.equal(await pathExists(path), false)
  })

  await check('超过 maxBytes → 默认值，并清理超限文件', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const path = uiStatePath(ctx)
    await mkdir(join(workspace, '.imagen'), { recursive: true })
    await writeFile(path, JSON.stringify({ version: UI_STATE.version, advancedOpen: true, pad: 'x'.repeat(UI_STATE.maxBytes) }), 'utf8')
    const info = await stat(path)
    assert.ok(info.size > UI_STATE.maxBytes)
    assert.deepEqual(await readUiState(ctx), { advancedOpen: false })
    assert.equal(await pathExists(path), false)
  })

  await check('版本正确但单字段类型不符 → 该字段回落默认值，其它字段保留', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const path = uiStatePath(ctx)
    await mkdir(join(workspace, '.imagen'), { recursive: true })
    await writeFile(path, JSON.stringify({ version: UI_STATE.version, advancedOpen: 'yes' }), 'utf8')
    assert.deepEqual(await readUiState(ctx), { advancedOpen: false })
    // 单字段坏不删整份文件（下次写入会整体覆盖）。
    assert.equal(await pathExists(path), true)
  })
}

// ── HTTP 路由 ─────────────────────────────────────────────

async function scenarioRoutes() {
  console.log('\n── lib/routes/ui-state.js（GET/POST 同路径分发）')
  const workspace = await makeWorkspace()
  const ctx = workspaceContext(workspace)
  const kit = registerWithRouteKit(createUiStateRoutes({ ctx, log: silentLog }))
  const host = await startHost(kit.registered)
  try {
    await check('同一 path 只注册一条路由（GET/POST 合并，重复注册会抛错）', () => {
      const matched = kit.registered.filter((route) => route.path === UI_STATE_ROUTE)
      assert.equal(matched.length, 1, `应按 path 合并为一条，实际 ${matched.length} 条`)
    })

    await check('GET 返回默认全量视图', async () => {
      const { status, body } = await json(host.origin, UI_STATE_ROUTE)
      assert.equal(status, 200)
      assert.deepEqual(body, { ok: true, uiState: { advancedOpen: false } })
    })

    await check('POST 保存 + GET 读回；扁平补丁合并不覆盖未提交字段', async () => {
      const saved = await postUiState(host.origin, { advancedOpen: true })
      assert.equal(saved.status, 200, saved.text)
      assert.deepEqual(saved.body, { ok: true, uiState: { advancedOpen: true } })

      const read = await json(host.origin, UI_STATE_ROUTE)
      assert.deepEqual(read.body.uiState, { advancedOpen: true })
      assert.deepEqual(JSON.parse(await readFile(uiStatePath(ctx), 'utf8')), {
        version: UI_STATE.version,
        advancedOpen: true,
      })

      // 空补丁 = 保持当前生效值（合并语义）。
      const empty = await postUiState(host.origin, {})
      assert.equal(empty.status, 200)
      assert.deepEqual(empty.body.uiState, { advancedOpen: true })

      const closed = await postUiState(host.origin, { advancedOpen: false })
      assert.deepEqual(closed.body.uiState, { advancedOpen: false })
    })

    await check('未知字段忽略、不报错、不落盘', async () => {
      const res = await postUiState(host.origin, { advancedOpen: true, unknownField: 'x' })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body.uiState, { advancedOpen: true })
      const raw = JSON.parse(await readFile(uiStatePath(ctx), 'utf8'))
      assert.deepEqual(Object.keys(raw).sort(), ['advancedOpen', 'version'])
      assert.equal('unknownField' in raw, false)
    })

    await check('坏 JSON / 非对象 body → 400 invalid_body', async () => {
      for (const raw of ['{不是 JSON', '"just-a-string"', '[1,2]', 'null', '42']) {
        const res = await postUiState(host.origin, raw)
        assert.equal(res.status, 400, `${raw} 应返回 400`)
        assert.equal(res.body.error.code, 'invalid_body', `${raw} 错误码`)
      }
    })

    await check('已登记字段类型错 → 400 invalid_request', async () => {
      const res = await postUiState(host.origin, { advancedOpen: 'yes' })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_request')
      assert.equal('uiState' in res.body, false)
      assert.deepEqual(await readUiState(ctx), { advancedOpen: true }, '被拒绝的请求不得改动已保存状态')
    })

    await check('非法方法 → 405 + Allow: GET, POST', async () => {
      const res = await json(host.origin, UI_STATE_ROUTE, { method: 'PUT' })
      assert.equal(res.status, 405)
      assert.equal(res.headers.get('allow'), 'GET, POST')
      assert.equal(res.text, '', '405 不应带响应体')
    })
  } finally {
    await closeServer(host.server)
    kit.dispose()
  }
}

// ── index.js 真实装配 ─────────────────────────────────────

/** 假 cordis Context：只为 index.js 装配路由 / 工具用，不执行外部命令。 */
async function scenarioIndexAssembly() {
  console.log('\n── index.js 真实装配')
  const workspace = await makeWorkspace()
  const fake = createFakeContext(workspace)
  // 开发模式：启动恢复流程保持惰性，避免测试触发 Kaggle / ntfy 请求。
  applyPlugin(fake.ctx, { devEndpoint: 'http://127.0.0.1:9', devToken: 'dev-token' })
  const host = await startHost(fake.routes)
  try {
    await check('ui-state 路由已注册且同一 path 只注册一次', () => {
      const matched = fake.routes.filter((route) => route.path === UI_STATE_ROUTE)
      assert.equal(matched.length, 1, 'GET 与 POST 必须合并为一条注册，否则真实宿主会因重复 path 抛错')
    })

    await check('装配后的 GET/POST 走真实工作区文件', async () => {
      const read = await json(host.origin, UI_STATE_ROUTE)
      assert.equal(read.status, 200, read.text)
      assert.deepEqual(read.body, { ok: true, uiState: { advancedOpen: false } })

      const saved = await postUiState(host.origin, { advancedOpen: true })
      assert.equal(saved.status, 200, saved.text)
      assert.deepEqual(saved.body.uiState, { advancedOpen: true })

      const raw = JSON.parse(await readFile(join(workspace, '.imagen', 'ui-state.json'), 'utf8'))
      assert.equal(raw.version, UI_STATE.version)
      assert.equal(raw.advancedOpen, true)
      // 只写工作区私有目录，不落到仓库 cwd。
      assert.equal(await pathExists(join(workspace, '.imagen', 'ui-state.json')), true)
    })
  } finally {
    await closeServer(host.server)
    fake.dispose()
  }
}

// ── main ──────────────────────────────────────────────────

async function main() {
  console.log('ui-state-host：工作台界面状态持久化与路由（离线）')
  await scenarioContractAndNormalize()
  await scenarioReadWrite()
  await scenarioFallbacks()
  await scenarioRoutes()
  await scenarioIndexAssembly()

  summary()
}

try {
  await main()
} finally {
  // 原子写是异步的：插件卸载收尾可能还在跑，Windows 下并发删除会 ENOTEMPTY，重试即可。
  for (const dir of tempDirs) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 9) {
          console.error(`临时目录清理失败：${dir}（${error?.message ?? error}）`)
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  }
}
