#!/usr/bin/env node
/**
 * 运行设置（M2 Host 侧）与空闲倒计时字段的离线回归。
 *
 * 覆盖：
 *  - lib/settings.js 纯函数：字段校验/钳制、静态 config 与覆盖项的合并、脱敏视图；
 *  - settings.json 原子写、无临时文件残留、重建 store 读回、损坏文件降级、无工作区退化；
 *  - lib/routes/settings.js：GET 默认视图、POST 保存、非法请求体/非法值分支、hfToken 绝不回传；
 *  - clearHfToken 与 hfTokenSource 的 settings / config / none 三态；
 *  - SessionManager 通过 deps.getSettings 在 start 时读取新设置（accelerator / datasetSources /
 *    idle_timeout_sec / hf_token / pip_constraints / local_models）并写入快照；
 *  - session.applyHealthDetails 的 idle_seconds、applyHealthState 的 last_error_code 透传。
 *
 * 不联网、不调用真实 kaggle CLI：SessionManager 用注入的假 deps 驱动启动流程。
 *
 * 运行：node test/settings-host.mjs
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SETTINGS, TIMEOUTS } from '../shared/contract.js'
import { apply as applyPlugin } from '../index.js'
import { createSettingsRoutes } from '../lib/routes/settings.js'
import { SessionManager } from '../lib/session.js'
import {
  createSettingsStore,
  mergeSettings,
  normalizeSettingsPatch,
  publicSettingsView,
  settingsPath,
} from '../lib/settings.js'

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

const tempDirs = []
async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'imagen-settings-test-'))
  tempDirs.push(dir)
  return dir
}

/** 只提供 workingDirectory 的最小宿主上下文。 */
function workspaceContext(workspace) {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      return undefined
    },
  }
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} }

/** 极简 res 替身（GET 分支不需要请求流）。 */
function makeRes() {
  const state = { code: null, headers: null, body: null }
  return {
    state,
    writeHead(code, headers) {
      state.code = code
      state.headers = headers
    },
    end(body) {
      state.body = body ? JSON.parse(Buffer.from(body).toString('utf8')) : null
    },
  }
}

function allows(method, allow) {
  const list = Array.isArray(allow) ? allow : [allow]
  return list.includes(method)
}

/** 把 route-kit 形状的路由挂到本机 HTTP 服务上（同路径不同方法要按 method 选择）。 */
function startHost(routes) {
  const server = createServer((req, res) => {
    let pathname = '/'
    try {
      pathname = new URL(req.url, 'http://placeholder.local').pathname
    } catch {}
    const candidates = routes.filter((item) => item.path === pathname)
    if (candidates.length === 0) {
      res.writeHead(404)
      return res.end()
    }
    // 经 route-kit 注册的包装对象没有 method 字段，方法校验在包装 handler 内部完成；
    // 直接传入的 Route 对象带 method（可能是数组），这里先做一次校验。
    const route = candidates[0]
    if (route.method && !allows(req.method, route.method)) {
      res.writeHead(405, { allow: [].concat(route.method).join(', ') })
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
  return { status: res.status, body, text }
}

function postBody(origin, value) {
  return json(origin, '/imagen-api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  })
}

/** 视图固定字段：用于断言 GET 与 save 响应形状一致。 */
function assertViewShape(view) {
  assert.deepEqual(Object.keys(view).sort(), [
    'accelerator',
    'datasetSources',
    'effectiveOnNextSession',
    'hasHfToken',
    'hfTokenSource',
    'idleTimeoutSec',
    'localModels',
    'pipConstraints',
  ])
  assert.ok(SETTINGS.hfTokenSources.includes(view.hfTokenSource), `非法 hfTokenSource：${view.hfTokenSource}`)
  // 安全红线：任何视图都不能带 Token 的任何形状。
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'hfToken'), false)
}

// ── 纯函数：校验 / 合并 / 脱敏 ─────────────────────────────

async function scenarioPureFunctions() {
  console.log('\n── lib/settings.js 纯函数')

  await check('normalizeSettingsPatch：合法输入归一、钳制与去重', () => {
    const result = normalizeSettingsPatch({
      idleTimeoutSec: 1234.6,
      accelerator: ' NvidiaTeslaP100 ',
      hfToken: '  hf_abc  ',
      datasetSources: ['owner/a', ' owner/a ', '', '   ', 'owner/b'],
      pipConstraints: ['diffusers==0.31.0'],
      localModels: { 'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl' },
      unknownField: 'ignored',
    })
    assert.equal(result.ok, true)
    assert.equal(result.value.idleTimeoutSec, 1235)
    assert.equal(result.value.accelerator, 'NvidiaTeslaP100')
    assert.equal(result.value.hfToken, 'hf_abc')
    assert.deepEqual(result.value.datasetSources, ['owner/a', 'owner/b'])
    assert.deepEqual(result.value.pipConstraints, ['diffusers==0.31.0'])
    assert.deepEqual(result.value.localModels, { 'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl' })
    assert.equal(result.value.unknownField, undefined, '未知字段必须忽略')

    // 越界钳制
    assert.equal(normalizeSettingsPatch({ idleTimeoutSec: 999999 }).value.idleTimeoutSec, SETTINGS.idleTimeoutSec.max)
    assert.equal(normalizeSettingsPatch({ idleTimeoutSec: 10 }).value.idleTimeoutSec, SETTINGS.idleTimeoutSec.min)
    // 数组上限与单项长度上限
    const many = Array.from({ length: SETTINGS.maxItems + 10 }, (_, index) => `owner/ds-${index}`)
    assert.equal(normalizeSettingsPatch({ datasetSources: many }).value.datasetSources.length, SETTINGS.maxItems)
    const long = normalizeSettingsPatch({ pipConstraints: ['x'.repeat(SETTINGS.maxItemChars + 50)] })
    assert.equal(long.value.pipConstraints[0].length, SETTINGS.maxItemChars)
  })

  await check('normalizeSettingsPatch：非法字段值统一 invalid_request', () => {
    const cases = [
      { idleTimeoutSec: '900' },
      { idleTimeoutSec: Number.NaN },
      { accelerator: 'NvidiaTeslaV100' },
      { accelerator: '' },
      { datasetSources: 'owner/a' },
      { datasetSources: ['owner/a', 7] },
      { pipConstraints: 3 },
      { localModels: [] },
      { localModels: null },
      { localModels: { 'not-a-repo': '/kaggle/input/x' } },
      { localModels: { 'owner/name': 'kaggle/input/x' } },
      { localModels: { 'owner/name': '' } },
      { hfToken: 42 },
    ]
    for (const patch of cases) {
      const result = normalizeSettingsPatch(patch)
      assert.equal(result.ok, false, `应拒绝：${JSON.stringify(patch)}`)
      assert.equal(result.code, 'invalid_request')
      assert.equal(typeof result.message, 'string')
    }
    // 非对象入参也按 invalid_request（路由层再区分 invalid_body）。
    for (const patch of [null, 'x', [1], 42]) {
      assert.equal(normalizeSettingsPatch(patch).ok, false)
    }
  })

  await check('normalizeSettingsPatch：hfToken 空串保持、clearHfToken 优先', () => {
    // 空串表示保持不变：归一结果里不应出现 hfToken 字段。
    assert.equal(normalizeSettingsPatch({ hfToken: '   ' }).value.hfToken, undefined)
    assert.equal(normalizeSettingsPatch({ hfToken: ' hf_keep ' }).value.hfToken, 'hf_keep')
    const cleared = normalizeSettingsPatch({ hfToken: 'hf_new', clearHfToken: true })
    assert.deepEqual(cleared.value, { clearHfToken: true }, 'clearHfToken 应优先于同请求的 hfToken')
  })

  await check('mergeSettings：覆盖项优先、缺字段回退静态 config', () => {
    const effective = mergeSettings(
      {
        idleTimeoutSec: 1500,
        accelerator: 'NvidiaTeslaP100',
        hfToken: 'hf_config',
        datasetSources: ['owner/cfg'],
        pipConstraints: ['numpy==1.26'],
      },
      {
        idleTimeoutSec: 900,
        accelerator: 'NvidiaTeslaT4',
        hfToken: 'hf_settings',
        datasetSources: ['owner/set', 'owner/set'],
        pipConstraints: ['diffusers==0.31.0'],
        localModels: { 'owner/model': '/kaggle/input/model' },
      },
    )
    assert.equal(effective.idleTimeoutSec, 900)
    assert.equal(effective.accelerator, 'NvidiaTeslaT4')
    assert.equal(effective.hfToken, 'hf_settings')
    assert.deepEqual(effective.datasetSources, ['owner/set'])
    assert.deepEqual(effective.pipConstraints, ['diffusers==0.31.0'])
    assert.deepEqual(effective.localModels, { 'owner/model': '/kaggle/input/model' })

    // 无覆盖项 / 无 config：契约默认值。
    const defaults = mergeSettings(undefined, undefined)
    assert.equal(defaults.idleTimeoutSec, TIMEOUTS.idleShutdownSec)
    assert.equal(defaults.accelerator, SETTINGS.defaultAccelerator)
    assert.equal(defaults.hfToken, null)
    assert.deepEqual(defaults.datasetSources, [])
    assert.deepEqual(defaults.localModels, {})
    assert.deepEqual(defaults.pipConstraints, [])

    // 静态 config 的非法值同样被防御：accelerator 白名单外回退默认，idle 越界被钳制。
    const hostile = mergeSettings({ accelerator: 'bogus', idleTimeoutSec: 1 }, {})
    assert.equal(hostile.accelerator, SETTINGS.defaultAccelerator)
    assert.equal(hostile.idleTimeoutSec, SETTINGS.idleTimeoutSec.min)
  })

  await check('publicSettingsView：固定字段 + hfToken 三态来源 + 生效提示', () => {
    const base = { idleTimeoutSec: 900, accelerator: 'NvidiaTeslaT4', datasetSources: [], localModels: {}, pipConstraints: [] }
    const none = publicSettingsView({ ...base, hfToken: null }, { hasConfigHfToken: false })
    assertViewShape(none)
    assert.equal(none.hasHfToken, false)
    assert.equal(none.hfTokenSource, 'none')
    assert.equal(none.effectiveOnNextSession, false)

    const fromConfig = publicSettingsView({ ...base, hfToken: 'hf_config_secret' }, { hasConfigHfToken: true })
    assert.equal(fromConfig.hasHfToken, true)
    assert.equal(fromConfig.hfTokenSource, 'config')
    assert.ok(!JSON.stringify(fromConfig).includes('hf_config_secret'), '视图不得出现 Token 原文')

    const fromSettings = publicSettingsView(
      { ...base, hfToken: 'hf_settings_secret' },
      { hasConfigHfToken: true, hasSettingsHfToken: true },
    )
    assert.equal(fromSettings.hfTokenSource, 'settings')
    assert.ok(!JSON.stringify(fromSettings).includes('hf_settings_secret'))

    const active = publicSettingsView({ ...base, hfToken: null }, { sessionActive: true })
    assert.equal(active.effectiveOnNextSession, true)
  })
}

// ── 存储 + 路由 ────────────────────────────────────────────

async function scenarioStoreAndRoutes(workspace) {
  console.log('\n── 设置存储与 HTTP 路由')
  const ctx = workspaceContext(workspace)
  const config = { idleTimeoutSec: 1500 }
  const filePath = join(workspace, '.imagen', 'settings.json')
  assert.equal(settingsPath(ctx), filePath, 'settingsPath 应指向 <workspace>/.imagen/settings.json')

  const store = createSettingsStore({ ctx, config })
  const host = await startHost(createSettingsRoutes({ settings: store, session: { isActive: false }, log: silentLog }))
  try {
    await check('GET 默认视图：只读静态 config、无 Token、默认 idleTimeoutSec 来自 config', async () => {
      const { status, body, text } = await json(host.origin, '/imagen-api/settings')
      assert.equal(status, 200)
      assert.equal(body.ok, true)
      const view = body.settings
      assertViewShape(view)
      assert.equal(view.idleTimeoutSec, 1500, '未保存覆盖项时 idleTimeoutSec 应来自静态 config')
      assert.equal(view.accelerator, SETTINGS.defaultAccelerator)
      assert.deepEqual(view.datasetSources, [])
      assert.deepEqual(view.localModels, {})
      assert.deepEqual(view.pipConstraints, [])
      assert.equal(view.hasHfToken, false)
      assert.equal(view.hfTokenSource, 'none')
      assert.equal(view.effectiveOnNextSession, false)
      assert.ok(!text.includes('hfToken"'), 'GET 响应不得包含 hfToken 字段')
    })

    await check('POST 保存全量字段：200、原子落盘、无临时文件残留', async () => {
      const saved = {
        idleTimeoutSec: 900,
        accelerator: 'NvidiaTeslaP100',
        datasetSources: ['owner/ds-a', ' owner/ds-b ', 'owner/ds-a', ''],
        pipConstraints: ['diffusers==0.31.0'],
        localModels: { 'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl' },
      }
      const { status, body } = await postBody(host.origin, saved)
      assert.equal(status, 200, JSON.stringify(body))
      assert.equal(body.ok, true)
      assertViewShape(body.settings)
      assert.equal(body.settings.idleTimeoutSec, 900)
      assert.equal(body.settings.accelerator, 'NvidiaTeslaP100')

      const disk = JSON.parse(await readFile(filePath, 'utf8'))
      // settings.json 只保存用户显式修改过的覆盖项，不做全量快照。
      assert.deepEqual(disk, {
        idleTimeoutSec: 900,
        accelerator: 'NvidiaTeslaP100',
        datasetSources: ['owner/ds-a', 'owner/ds-b'],
        pipConstraints: ['diffusers==0.31.0'],
        localModels: { 'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl' },
      })
      const entries = await readdir(join(workspace, '.imagen'))
      assert.ok(
        !entries.some((name) => name.startsWith('settings.json.tmp-')),
        `不应残留临时文件：${entries.join(', ')}`,
      )
    })

    await check('重建 store 后读回一致（磁盘是唯一持久化来源）', async () => {
      // 顺带验证启动时清理上次中断留下的临时文件。
      await writeFile(join(workspace, '.imagen', 'settings.json.tmp-stale'), '{}', 'utf8')
      const reloaded = createSettingsStore({ ctx, config })
      await reloaded.whenReady()
      const view = reloaded.publicView({ sessionActive: false })
      assert.equal(view.idleTimeoutSec, 900)
      assert.equal(view.accelerator, 'NvidiaTeslaP100')
      assert.deepEqual(view.datasetSources, ['owner/ds-a', 'owner/ds-b'])
      assert.deepEqual(view.pipConstraints, ['diffusers==0.31.0'])
      assert.deepEqual(view.localModels, { 'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl' })
      const entries = await readdir(join(workspace, '.imagen'))
      assert.ok(
        !entries.some((name) => name.startsWith('settings.json.tmp-')),
        `whenReady 应清理遗留临时文件：${entries.join(', ')}`,
      )
    })

    const FAKE_TOKEN = 'hf_settings_host_fake_token_do_not_leak'
    await check('POST hfToken：只回布尔与来源，响应全文不含 Token 原文', async () => {
      const saved = await postBody(host.origin, { hfToken: `  ${FAKE_TOKEN}  ` })
      assert.equal(saved.status, 200)
      assert.equal(saved.body.settings.hasHfToken, true)
      assert.equal(saved.body.settings.hfTokenSource, 'settings')
      assert.ok(!saved.text.includes(FAKE_TOKEN), 'POST 响应不得包含 Token 原文')

      const read = await json(host.origin, '/imagen-api/settings')
      assert.equal(read.body.settings.hasHfToken, true)
      assert.equal(read.body.settings.hfTokenSource, 'settings')
      assert.ok(!read.text.includes(FAKE_TOKEN), 'GET 响应不得包含 Token 原文')
      assert.ok(!read.text.includes('do_not_leak'), 'Token 片段也不能出现')

      // 落盘内容仍只保存在 0600 私有文件里，供 start 时下发给远端。
      const disk = JSON.parse(await readFile(filePath, 'utf8'))
      assert.equal(disk.hfToken, FAKE_TOKEN)
    })

    await check('POST hfToken 空串：保持已保存值不变', async () => {
      const saved = await postBody(host.origin, { hfToken: '   ' })
      assert.equal(saved.status, 200)
      assert.equal(saved.body.settings.hasHfToken, true)
      assert.equal(saved.body.settings.hfTokenSource, 'settings')
    })

    await check('POST clearHfToken：清除保存值并回 none', async () => {
      const cleared = await postBody(host.origin, { clearHfToken: true })
      assert.equal(cleared.status, 200)
      assert.equal(cleared.body.settings.hasHfToken, false)
      assert.equal(cleared.body.settings.hfTokenSource, 'none')
      assert.ok(!cleared.text.includes(FAKE_TOKEN))
      const disk = JSON.parse(await readFile(filePath, 'utf8'))
      assert.equal(Object.prototype.hasOwnProperty.call(disk, 'hfToken'), false)
    })

    await check('非法值分支：400 invalid_request（localModels / accelerator / datasetSources / idleTimeoutSec）', async () => {
      const cases = [
        { localModels: [] },
        { localModels: { 'not-a-repo': '/kaggle/input/x' } },
        { accelerator: 'NvidiaTeslaV100' },
        { datasetSources: 'owner/ds' },
        { idleTimeoutSec: '900' },
      ]
      for (const patch of cases) {
        const res = await postBody(host.origin, patch)
        assert.equal(res.status, 400, `${JSON.stringify(patch)} 应返回 400，实际 ${res.status}`)
        assert.equal(res.body.error.code, 'invalid_request', JSON.stringify(patch))
        assert.equal(typeof res.body.error.message, 'string')
      }
      // 非法请求不得改动已保存的设置。
      const view = (await json(host.origin, '/imagen-api/settings')).body.settings
      assert.equal(view.idleTimeoutSec, 900)
      assert.equal(view.accelerator, 'NvidiaTeslaP100')
    })

    await check('非法请求体分支：坏 JSON / 数组 / 标量 body → 400 invalid_body', async () => {
      const broken = await postBody(host.origin, '{"idleTimeoutSec":')
      assert.equal(broken.status, 400)
      assert.equal(broken.body.error.code, 'invalid_body')

      // 非普通对象（数组与 JSON 标量）同样是 invalid_body，不能当成空补丁静默成功。
      for (const body of ['[1,2,3]', 'null', '"abc"', '42', 'true']) {
        const res = await postBody(host.origin, body)
        assert.equal(res.status, 400, `body=${body} 应返回 400，实际 ${res.status}`)
        assert.equal(res.body.error.code, 'invalid_body', `body=${body}`)
      }
    })

    await check('会话运行中 effectiveOnNextSession=true', async () => {
      const route = createSettingsRoutes({ settings: store, session: { isActive: true }, log: silentLog })[0]
      const res = makeRes()
      await route.handler({ method: 'GET', url: '/imagen-api/settings' }, res)
      assert.equal(res.state.code, 200)
      assert.equal(res.state.body.settings.effectiveOnNextSession, true)
    })
  } finally {
    await new Promise((resolve) => host.server.close(resolve))
  }

  return { ctx, config, filePath }
}

async function scenarioConfigTokenSource() {
  console.log('\n── hfTokenSource 的 config / settings / none 三态')
  const workspace = await makeWorkspace()
  const ctx = workspaceContext(workspace)
  const CONFIG_TOKEN = 'hf_config_source_fake_token_value'
  const SETTINGS_TOKEN = 'hf_settings_source_fake_token_value'
  const store = createSettingsStore({ ctx, config: { hfToken: CONFIG_TOKEN } })
  await store.whenReady()

  await check('静态 config 有 Token：hasHfToken=true / source=config，且不回传原文', () => {
    const view = store.publicView({ sessionActive: false })
    assert.equal(view.hasHfToken, true)
    assert.equal(view.hfTokenSource, 'config')
    assert.ok(!JSON.stringify(view).includes(CONFIG_TOKEN))
  })

  await check('设置抽屉保存 Token 后来源变为 settings；清除后回落到 config', async () => {
    assert.equal((await store.save({ hfToken: SETTINGS_TOKEN })).ok, true)
    let view = store.publicView({ sessionActive: false })
    assert.equal(view.hfTokenSource, 'settings')
    assert.equal(view.hasHfToken, true)
    assert.ok(!JSON.stringify(view).includes(SETTINGS_TOKEN))

    assert.equal((await store.save({ clearHfToken: true })).ok, true)
    view = store.publicView({ sessionActive: false })
    assert.equal(view.hfTokenSource, 'config', '清除设置里的 Token 后应回落到静态 config')
    assert.equal(view.hasHfToken, true)
    assert.ok(!JSON.stringify(view).includes(CONFIG_TOKEN))
  })
}

async function scenarioNoWorkspaceAndCorrupt() {
  console.log('\n── 无工作区退化与损坏文件降级')

  await check('无工作区：settingsPath=null，保存只落内存、不抛异常', async () => {
    const store = createSettingsStore({ ctx: { get: () => undefined }, config: { idleTimeoutSec: 1200 } })
    assert.equal(settingsPath({ get: () => undefined }), null)
    await store.whenReady()
    assert.equal(store.current().idleTimeoutSec, 1200)
    const saved = await store.save({ idleTimeoutSec: 600, accelerator: 'NvidiaTeslaP100' })
    assert.equal(saved.ok, true)
    assert.equal(store.current().idleTimeoutSec, 600)
    assert.equal(store.current().accelerator, 'NvidiaTeslaP100')
    assert.equal(store.publicView({ sessionActive: false }).hfTokenSource, 'none')
    // 非法值仍然拒绝。
    assert.equal((await store.save({ accelerator: 'bogus' })).code, 'invalid_request')
  })

  await check('损坏的 settings.json：静默降级为静态 config 并清理损坏文件', async () => {
    const workspace = await makeWorkspace()
    const ctx = workspaceContext(workspace)
    const filePath = join(workspace, '.imagen', 'settings.json')
    await mkdir(join(workspace, '.imagen'), { recursive: true })
    await writeFile(filePath, '{"idleTimeoutSec": 6', 'utf8')
    const store = createSettingsStore({ ctx, config: { idleTimeoutSec: 1500 } })
    await store.whenReady()
    assert.equal(store.current().idleTimeoutSec, 1500, '损坏文件应降级为静态 config')
    await assert.rejects(() => stat(filePath), '损坏文件应被 best-effort 删除')
  })
}

// ── SessionManager 热生效与 health 字段 ────────────────────

async function scenarioSessionIntegration(workspace, ctx, config) {
  console.log('\n── SessionManager 启动读取最新设置')
  const store = createSettingsStore({ ctx, config })
  await store.whenReady()
  const view = store.publicView({ sessionActive: false })
  assert.equal(view.idleTimeoutSec, 900, '前置条件：设置文件里已保存 idleTimeoutSec=900')
  // 前置条件：设置里保存了 HF Token，验证它会被注入 daemon 配置（响应/日志仍不回传原文）。
  const SESSION_TOKEN = 'hf_session_integration_fake_token_value'
  assert.equal((await store.save({ hfToken: SESSION_TOKEN })).ok, true)

  let capturedFolder = null
  let capturedPush = null
  const session = new SessionManager({
    ctx,
    defaultPreset: 'sdxl-turbo',
    deps: {
      getSettings: () => store.current(),
      kaggleUsername: async () => 'tester',
      buildKernelFolder: async (input) => {
        capturedFolder = input
        return {
          dir: null,
          kernelId: 'tester/imagen-test',
          kernelUrl: 'https://www.kaggle.com/code/tester/imagen-test',
        }
      },
      pushKernel: async (_ctx, _dir, input) => {
        capturedPush = input
        return { ok: true }
      },
      removeKernelFolder: async () => {},
      kernelStatus: async () => ({ ok: true, status: 'RUNNING' }),
      kernelLogs: async () => ({ ok: true, tail: 'fake kernel log tail' }),
      log: silentLog,
    },
    options: {
      ntfyBase: 'http://127.0.0.1:9',
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 10 * 60 * 1000,
      tickMs: 60 * 1000,
      kernelPollMs: 60 * 1000,
      enableGpu: true,
    },
  })

  try {
    await check('start 时 accelerator / datasetSources / 注入配置全部来自最新设置', async () => {
      const snapshot = await session.start('sdxl-turbo')
      assert.equal(snapshot.state, 'provisioning')
      // pushKernel 的 accelerator 来自设置（而非构造时的 options 默认 T4）。
      assert.ok(capturedPush, 'pushKernel 未被调用')
      assert.equal(capturedPush.accelerator, 'NvidiaTeslaP100')
      // 预挂载 Dataset 来自设置。
      assert.deepEqual(capturedFolder.datasetSources, ['owner/ds-a', 'owner/ds-b'])
      // daemon 注入配置来自设置。
      assert.equal(capturedFolder.config.idle_timeout_sec, 900)
      assert.equal(capturedFolder.config.hf_token, SESSION_TOKEN, 'hf_token 应来自设置里的保存值')
      assert.deepEqual(capturedFolder.config.pip_constraints, ['diffusers==0.31.0'])
      assert.deepEqual(capturedFolder.config.local_models, {
        'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl',
      })
      // 快照反映真实生效的空闲关机时长。
      assert.equal(snapshot.idleTimeoutSec, 900)
    })

    await check('会话运行中（provisioning）GET 视图 effectiveOnNextSession=true', async () => {
      const route = createSettingsRoutes({ settings: store, session, log: silentLog })[0]
      const res = makeRes()
      await route.handler({ method: 'GET', url: '/imagen-api/settings' }, res)
      assert.equal(res.state.code, 200)
      assert.equal(res.state.body.settings.effectiveOnNextSession, true)
      assert.equal(res.state.body.settings.idleTimeoutSec, 900)
    })
  } finally {
    await session.stop().catch(() => {})
  }

  await check('无 getSettings 注入时行为与改造前一致（回退 options）', async () => {
    let accelerator = null
    const plain = new SessionManager({
      ctx,
      defaultPreset: 'sdxl-turbo',
      deps: {
        kaggleUsername: async () => 'tester',
        buildKernelFolder: async () => ({ dir: null, kernelId: 'tester/imagen-plain', kernelUrl: 'u' }),
        pushKernel: async (_ctx, _dir, input) => {
          accelerator = input.accelerator
          return { ok: true }
        },
        removeKernelFolder: async () => {},
        kernelStatus: async () => ({ ok: true, status: 'RUNNING' }),
        kernelLogs: async () => ({ ok: true, tail: '' }),
        log: silentLog,
      },
      options: {
        accelerator: 'NvidiaTeslaT4',
        idleTimeoutSec: 1800,
        ntfyBase: 'http://127.0.0.1:9',
        tickMs: 60 * 1000,
        kernelPollMs: 60 * 1000,
      },
    })
    try {
      const snapshot = await plain.start('sdxl-turbo')
      assert.equal(accelerator, 'NvidiaTeslaT4')
      assert.equal(snapshot.idleTimeoutSec, 1800)
    } finally {
      await plain.stop().catch(() => {})
    }
  })
}

async function scenarioHealthFields(workspace) {
  console.log('\n── health 字段：idleSeconds 与 last_error_code 透传')
  const ctx = workspaceContext(workspace)

  await check('applyHealthDetails：idle_seconds 写入快照 idleSeconds，非法值忽略', () => {
    const session = new SessionManager({ ctx, defaultPreset: 'sdxl-turbo', deps: { log: silentLog } })
    assert.equal(session.snapshot().idleSeconds, null, '初始应为 null')
    session.applyHealthDetails({ idle_seconds: 0 })
    assert.equal(session.snapshot().idleSeconds, 0, '0 是合法值，不能被当成缺失')
    session.applyHealthDetails({ idle_seconds: 42.5 })
    assert.equal(session.snapshot().idleSeconds, 42.5)
    session.applyHealthDetails({ idle_seconds: 'oops' })
    assert.equal(session.snapshot().idleSeconds, 42.5, '非数字不得覆盖上一次有效值')
    session.applyHealthDetails({ idle_seconds: null })
    assert.equal(session.snapshot().idleSeconds, 42.5)
    session.applyHealthDetails({ idle_seconds: Number.NaN })
    assert.equal(session.snapshot().idleSeconds, 42.5)
    assert.equal(session.snapshot().idleTimeoutSec, 1800, 'idleTimeoutSec 仍来自 options')
  })

  await check('applyHealthState：phase=error 透传已登记的 last_error_code', () => {
    const session = new SessionManager({ ctx, defaultPreset: 'sdxl-turbo', deps: { log: silentLog } })
    session.applyHealthState({ phase: 'error', last_error_code: 'gpu_unavailable', last_error: 'CUDA 不可用' })
    const snapshot = session.snapshot()
    assert.equal(snapshot.state, 'error')
    assert.equal(snapshot.error.code, 'gpu_unavailable')
    assert.equal(snapshot.error.message, '远端进入错误状态：CUDA 不可用')
  })

  await check('applyHealthState：未登记 / 缺失的 last_error_code 回退 remote_error', () => {
    for (const health of [
      { phase: 'error', last_error_code: 'mystery_code', last_error: '未知远端异常' },
      { phase: 'error', last_error: '没有错误码' },
    ]) {
      const session = new SessionManager({ ctx, defaultPreset: 'sdxl-turbo', deps: { log: silentLog } })
      session.applyHealthState(health)
      assert.equal(session.snapshot().error.code, 'remote_error')
      assert.match(session.snapshot().error.message, /^远端进入错误状态：/)
    }
  })
}

// ── index.js 装配 ─────────────────────────────────────────

/** 假 cordis Context：只为 index.js 装配路由 / 工具用，不执行外部命令。 */
function createFakeContext(workspace) {
  const routes = []
  const tools = []
  const cleanups = []
  const ctx = {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      return undefined
    },
    effect(fn) {
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
      getOrigin: () => '',
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
    dispose() {
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {}
      }
    },
  }
}

async function scenarioIndexAssembly() {
  console.log('\n── index.js 装配（真实插件入口）')
  const workspace = await makeWorkspace()
  const fake = createFakeContext(workspace)
  applyPlugin(fake.ctx, {})
  const host = await startHost(fake.routes)
  try {
    await check('settings 路由已注册（单条路由按 method 分发），GET 返回默认脱敏视图', async () => {
      // DSH webServer 的 exact 路由表以 path 为键、重复注册会抛错：GET/POST 必须合并为一条。
      const settingsRoutes = fake.routes.filter((route) => route.path === '/imagen-api/settings')
      assert.equal(settingsRoutes.length, 1, 'GET 与 POST 应合并为一条注册，否则真实宿主会因重复 path 抛错')
      const { status, body } = await json(host.origin, '/imagen-api/settings')
      assert.equal(status, 200)
      assert.equal(body.ok, true)
      assertViewShape(body.settings)
      assert.equal(body.settings.idleTimeoutSec, TIMEOUTS.idleShutdownSec, '无覆盖项时应为契约默认空闲时长')
      assert.equal(body.settings.hasHfToken, false)
    })

    const FAKE_TOKEN = 'hf_index_assembly_fake_token_value'
    await check('POST 保存后 GET 立即生效，且 /logs 诊断指纹随合并设置变化', async () => {
      const saved = await postBody(host.origin, {
        idleTimeoutSec: 600,
        accelerator: 'NvidiaTeslaP100',
        hfToken: FAKE_TOKEN,
      })
      assert.equal(saved.status, 200, JSON.stringify(saved.body))
      assert.ok(!saved.text.includes(FAKE_TOKEN), 'POST 响应不得包含 Token 原文')

      const read = await json(host.origin, '/imagen-api/settings')
      assert.equal(read.body.settings.idleTimeoutSec, 600)
      assert.equal(read.body.settings.accelerator, 'NvidiaTeslaP100')
      assert.equal(read.body.settings.hasHfToken, true)
      assert.equal(read.body.settings.hfTokenSource, 'settings')
      assert.ok(!read.text.includes(FAKE_TOKEN))

      // /logs 的 env 由 index.js 用 buildDiagnosticEnv({ config, session, settings }) 生成：
      // 只应出现 hasHfToken=true 这类布尔，绝不能出现 Token 原文。
      const logs = await json(host.origin, '/imagen-api/logs?since=0')
      assert.equal(logs.status, 200)
      assert.equal(logs.body.env.hasHfToken, true, '诊断指纹应读取合并后的设置')
      assert.ok(!logs.text.includes(FAKE_TOKEN), '/logs 不得包含 Token 原文')
    })
  } finally {
    await new Promise((resolve) => host.server.close(resolve))
    fake.dispose()
  }
}

// ── main ──────────────────────────────────────────────────

async function main() {
  console.log('settings-host：运行设置存储 / HTTP 路由 / 会话热生效 / 空闲倒计时（离线）')

  const workspace = await makeWorkspace()
  await scenarioPureFunctions()
  const { ctx, config } = await scenarioStoreAndRoutes(workspace)
  await scenarioConfigTokenSource()
  await scenarioNoWorkspaceAndCorrupt()
  await scenarioSessionIntegration(workspace, ctx, config)
  await scenarioHealthFields(workspace)
  await scenarioIndexAssembly()

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}

try {
  await main()
} finally {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
}
