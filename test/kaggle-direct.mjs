#!/usr/bin/env node
/**
 * Kaggle 直连客户端（v0.9 M2）的离线回归：不联网、不执行外部命令。
 *
 * 协议基准：本机 `kaggle` CLI 2.2.5 / `kagglesdk` 0.1.38 源码（见 lib/kaggle-direct.js 顶部注释）：
 *  - `POST https://api.kaggle.com/v1/<service>.<Service>/<Method>`，JSON 为 camelCase；
 *  - Python `timedelta` 序列化为 `<seconds>.<nanos>s`（Quota 的 timeUsed / totalTimeAllowed）；
 *  - 401/403 → auth_required，网络层异常 → unknown。
 *
 * 覆盖：
 *  A. 纯函数：凭据路径、timedelta 解析、quota 映射、日志清洗、SaveKernel 请求体；
 *  B. 请求形状：URL / Bearer / JSON 报文（ListKernels / Quota / Introspect / SaveKernel / Status / Logs）；
 *  C. 凭据优先级与 refresh_token 续期（临时 HOME，续期后回写 credentials.json）；
 *  D. 错误映射：401 → auth_required、网络错误 → unknown、push 失败形状；
 *  E. token 不进入返回值与日志文本。
 *
 * 运行：node test/kaggle-direct.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  buildSaveKernelBody,
  deleteKernel,
  isKernelMissingResponse,
  kagglePaths,
  kernelLogs,
  kernelStatus,
  mapQuota,
  parseTimeDeltaSeconds,
  probeKaggle,
  pushKernel,
  readCredentialsFile,
  simplifyKernelLog,
} from '../lib/kaggle-direct.js'
import { createCheckRunner } from './helpers/check.mjs'

const { check, summary } = createCheckRunner()

/** 安装假 fetch：handler(call) 返回 { status, body } 或抛错；同时记录全部请求。 */
function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ?? null,
    }
    if (typeof call.body === 'string') {
      try {
        call.json = JSON.parse(call.body)
      } catch {}
    }
    calls.push(call)
    const outcome = handler(call)
    if (outcome instanceof Error) throw outcome
    const status = outcome?.status ?? 200
    const body = outcome?.body ?? {}
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return { ok: status >= 200 && status < 300, status, text: async () => text }
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

async function withHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'imagen-kaggle-direct-'))
  try {
    return await fn(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

const TOKEN = 'direct-secret-token-0123456789'
const REFRESH = 'direct-refresh-token-0123456789'

const QUOTA_BODY = {
  quotaRefreshTime: '2026-11-14T00:00:00Z',
  gpuQuota: {
    timeUsed: '25480.101s',
    timeReserved: '0s',
    totalTimeAllowed: '108000s',
    minimumTimeAllowed: '108000s',
    hasEverRun: true,
  },
  tpuQuota: { timeUsed: '0s', totalTimeAllowed: '72000s', hasEverRun: true },
}

// ── A. 纯函数 ────────────────────────────────────────────────────────────

async function checkPureFunctions() {
  await check('kagglePaths：默认 ~/.kaggle、KAGGLE_CONFIG_DIR 与显式 credentialsPath', () => {
    const base = kagglePaths({ homeDir: 'C:/home/tester', env: {} })
    assert.ok(base.credentials.endsWith('credentials.json'))
    assert.ok(base.accessToken.endsWith('access_token'))
    assert.ok(base.kaggleJson.endsWith('kaggle.json'))

    // 用临时目录构造绝对路径：盘符路径在 POSIX 上会被 path.resolve 当成相对路径，
    // 原断言只在 Windows 成立（Linux CI 因此变红）。比较两侧都过 resolve()。
    const customDir = join(tmpdir(), 'kaggle-cfg')
    const custom = kagglePaths({ homeDir: 'C:/home/tester', env: { KAGGLE_CONFIG_DIR: customDir } })
    assert.equal(custom.baseDir, resolve(customDir))

    const explicitPath = join(tmpdir(), 'creds.json')
    const explicit = kagglePaths({ homeDir: 'C:/home/tester', env: {}, credentialsPath: explicitPath })
    assert.equal(explicit.credentials, resolve(explicitPath))
  })

  await check('parseTimeDeltaSeconds：<seconds>.<nanos>s 与无单位/数字兼容', () => {
    assert.equal(parseTimeDeltaSeconds('25480.101s'), 25480.101)
    assert.equal(parseTimeDeltaSeconds('108000s'), 108000)
    assert.equal(parseTimeDeltaSeconds('0s'), 0)
    assert.equal(parseTimeDeltaSeconds(12.5), 12.5)
    assert.equal(parseTimeDeltaSeconds('12'), 12)
    assert.equal(parseTimeDeltaSeconds('bad'), null)
    assert.equal(parseTimeDeltaSeconds(null), null)
  })

  await check('mapQuota：与 CLI 的 parseQuota 同形状（已用 / 剩余 / 总量 / 重置时间）', () => {
    const quota = mapQuota(QUOTA_BODY)
    assert.equal(quota.available, true)
    assert.equal(quota.usedHours, 7.08)
    assert.equal(quota.remainingHours, 22.92)
    assert.equal(quota.totalHours, 30)
    assert.equal(quota.refreshAt, '2026-11-14T00:00:00.000Z')
    assert.ok(quota.raw.includes('GPU'))
    // 缺字段时不可用，不能凭空造数值。
    assert.deepEqual(mapQuota({}), { available: false, raw: '' })
    assert.deepEqual(mapQuota({ gpuQuota: { timeUsed: 'bad' } }), { available: false, raw: '' })
  })

  await check('simplifyKernelLog：过滤 notebook 噪音、只留尾部 40 行', () => {
    const raw = ['line-1', 'NbConvertApp noise', 'line-2', 'Writing 12 bytes to file'].join('\n')
    const tail = simplifyKernelLog(raw)
    assert.ok(tail.includes('line-1'))
    assert.ok(tail.includes('line-2'))
    assert.ok(!tail.includes('NbConvertApp'))
    assert.ok(!tail.includes('Writing 12 bytes'))

    // 旧格式（每行一个 JSON 事件流）也要还原成纯文本。
    const events = [JSON.stringify({ data: 'event-1\n' }), JSON.stringify({ data: 'event-2\n' })].join('\n')
    assert.equal(simplifyKernelLog(events), 'event-1\nevent-2')
  })

  await check('buildSaveKernelBody：字段逐项对照 CLI kernels_push', () => {
    const meta = {
      id: 'tester/imagen-abc',
      title: 'imagen-abc',
      code_file: 'daemon.py',
      language: 'python',
      kernel_type: 'script',
      is_private: true,
      enable_gpu: true,
      enable_tpu: false,
      enable_internet: true,
      dataset_sources: ['owner/ds', 'owner/ds'],
      competition_sources: [],
      kernel_sources: [],
      model_sources: [],
      keywords: [],
      machine_shape: '',
    }
    const body = buildSaveKernelBody(meta, 'print(1)\n', { accelerator: 'NvidiaTeslaT4', timeoutSec: 3600 })
    assert.equal(body.slug, 'tester/imagen-abc')
    assert.equal(body.newTitle, 'imagen-abc')
    assert.equal(body.text, 'print(1)\n')
    assert.equal(body.language, 'python')
    assert.equal(body.kernelType, 'script')
    assert.equal(body.isPrivate, true)
    assert.equal(body.enableGpu, true)
    assert.equal(body.enableInternet, true)
    assert.equal(body.machineShape, 'NvidiaTeslaT4')
    assert.equal(body.sessionTimeoutSeconds, 3600)
    assert.deepEqual(body.datasetDataSources, ['owner/ds', 'owner/ds'], 'dataset_sources 原样下发（与 CLI 一致，不去重）')
    // 空数组 / undefined 不下发（与 KaggleObject.to_dict(ignore_defaults) 同口径）。
    assert.equal(body.competitionDataSources, undefined)
    assert.equal(body.kernelDataSources, undefined)
    assert.equal(body.categoryIds, undefined)

    // noRun → QUICK_SAVE；id_no 走数字 id。
    const quick = buildSaveKernelBody({ id_no: 42, language: 'python', kernel_type: 'script' }, 'x', { noRun: true })
    assert.equal(quick.id, 42)
    assert.equal(quick.kernelExecutionType, 'QUICK_SAVE')
  })
}

// ── B/C/D. 请求形状、凭据与错误映射 ──────────────────────────────────────

async function checkRequestsAndAuth() {
  await check('probeKaggle：URL / Bearer / camelCase 报文与 CLI 同协议，cli.direct=true', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')

      const fetchMock = installFetch((call) => {
        if (call.url.endsWith('/v1/kernels.KernelsApiService/ListKernels')) return { status: 200, body: { kernels: [] } }
        if (call.url.endsWith('/v1/kernels.KernelsApiService/GetAcceleratorQuotaStatistics')) return { status: 200, body: QUOTA_BODY }
        if (call.url.endsWith('/v1/security.OAuthService/IntrospectToken')) return { status: 200, body: { active: true, username: 'tester' } }
        return new Error(`unexpected ${call.url}`)
      })
      try {
        const probe = await probeKaggle({}, { homeDir: home, env: {} })
        assert.equal(probe.provider, 'kaggle')
        assert.equal(probe.cli.direct, true, '直连探测必须标记 direct，客户端据此不出 cli_missing')
        assert.equal(probe.cli.present, true)
        assert.equal(probe.auth.ok, true)
        assert.equal(probe.quota.available, true)
        assert.equal(probe.cli.username, 'tester')
        assert.ok(probe.notes.some((note) => note.includes('直连')))

        const urls = fetchMock.calls.map((call) => call.url)
        assert.ok(urls.every((url) => url.startsWith('https://api.kaggle.com/v1/')), JSON.stringify(urls))
        for (const call of fetchMock.calls) {
          assert.equal(call.method, 'POST')
          assert.equal(call.headers['content-type'], 'application/json')
          // IntrospectToken 把 token 放在请求体里核对，其余业务调用用 Bearer 头。
          if (!call.url.endsWith('/IntrospectToken')) {
            assert.equal(call.headers.authorization, `Bearer ${TOKEN}`, call.url)
          }
        }
        const listCall = fetchMock.calls.find((call) => call.url.endsWith('/ListKernels'))
        assert.equal(listCall.json.pageSize, 1)
        assert.equal(listCall.json.group, 'EVERYONE')
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('probeKaggle：没有凭据 → auth_required（不发任何 HTTP 请求）', async () => {
    await withHome(async (home) => {
      const fetchMock = installFetch(() => new Error('不应该发起请求'))
      try {
        const probe = await probeKaggle({}, { homeDir: home, env: {} })
        assert.equal(probe.auth.ok, false)
        assert.equal(probe.auth.errorCode, 'auth_required')
        assert.equal(probe.quota.available, false)
        assert.equal(fetchMock.calls.length, 0)
        assert.ok(probe.notes.some((note) => note.includes('credentials.json')))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('credentials.json：过期 access_token → GenerateAccessToken 续期并回写 0600 凭据', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      const credPath = join(dir, 'credentials.json')
      const expired = new Date(Date.now() - 3600 * 1000).toISOString()
      await writeFile(
        credPath,
        JSON.stringify({
          refresh_token: REFRESH,
          access_token: 'expired-access-token',
          access_token_expiration: expired,
          username: 'tester',
          scopes: ['resources.admin:*'],
        }),
        'utf8',
      )

      const fetchMock = installFetch((call) => {
        if (call.url.endsWith('/v1/users.AccountService/GenerateAccessToken')) {
          assert.equal(call.json.refreshToken, REFRESH)
          assert.equal(call.json.apiVersion, 'API_VERSION_V1')
          assert.equal(call.json.expirationDuration, '43200s')
          return { status: 200, body: { token: 'fresh-access-token', expiresIn: 43200, userName: 'tester' } }
        }
        if (call.url.endsWith('/v1/kernels.KernelsApiService/ListKernels')) {
          assert.equal(call.headers.authorization, 'Bearer fresh-access-token', '续期后必须使用新 token')
          return { status: 200, body: { kernels: [] } }
        }
        if (call.url.endsWith('/v1/kernels.KernelsApiService/GetAcceleratorQuotaStatistics')) {
          return { status: 200, body: QUOTA_BODY }
        }
        return new Error(`unexpected ${call.url}`)
      })
      try {
        const probe = await probeKaggle({}, { homeDir: home, env: {} })
        assert.equal(probe.auth.ok, true)
        const saved = JSON.parse(await readFile(credPath, 'utf8'))
        assert.equal(saved.access_token, 'fresh-access-token')
        assert.equal(saved.refresh_token, REFRESH, 'refresh_token 必须保留')
        assert.equal(saved.username, 'tester')
        assert.ok(Date.parse(saved.access_token_expiration) > Date.now() + 11 * 3600 * 1000, saved.access_token_expiration)
        assert.equal(fetchMock.calls[0].url.endsWith('/GenerateAccessToken'), true)
        // 凭据文件是私有的：至少不能被 trivially world-readable（POSIX 下 0600）。
        if (process.platform !== 'win32') {
          const info = await stat(credPath)
          assert.equal(info.mode & 0o777, 0o600)
        }
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('401 → auth_required（换下一个凭据候选，最终失败不误报网络错误）', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const fetchMock = installFetch(() => ({
        status: 401,
        body: { error: { code: 401, message: 'Unauthenticated', status: 'UNAUTHENTICATED' } },
      }))
      try {
        const probe = await probeKaggle({}, { homeDir: home, env: {} })
        assert.equal(probe.auth.ok, false)
        assert.equal(probe.auth.errorCode, 'auth_required')
        assert.ok(probe.auth.detail.includes('Unauthenticated'))
        assert.ok(!probe.auth.detail.includes(TOKEN), '详情不得包含 token')
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('网络错误 → unknown（不能误判成鉴权失败）', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const fetchMock = installFetch(() => new TypeError('fetch failed'))
      try {
        const probe = await probeKaggle({}, { homeDir: home, env: {} })
        assert.equal(probe.auth.ok, false)
        assert.equal(probe.auth.errorCode, 'unknown')
        assert.ok(!probe.auth.detail.includes(TOKEN))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('pushKernel：读取 kernel-metadata + SaveKernel 报文 + 响应映射', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const folder = join(home, 'kernel')
      await mkdir(folder, { recursive: true })
      await writeFile(
        join(folder, 'kernel-metadata.json'),
        JSON.stringify({
          id: 'tester/imagen-abc',
          title: 'imagen-abc',
          code_file: 'daemon.py',
          language: 'python',
          kernel_type: 'script',
          is_private: true,
          enable_gpu: true,
          enable_tpu: false,
          enable_internet: true,
          dataset_sources: ['owner/ds'],
          competition_sources: [],
          kernel_sources: [],
          model_sources: [],
          keywords: [],
          machine_shape: '',
        }),
        'utf8',
      )
      await writeFile(join(folder, 'daemon.py'), 'print("hello")\n', 'utf8')

      const fetchMock = installFetch((call) => {
        if (call.url.endsWith('/v1/kernels.KernelsApiService/SaveKernel')) {
          return { status: 200, body: { ref: 'tester/imagen-abc', url: 'https://www.kaggle.com/code/tester/imagen-abc', versionNumber: 2 } }
        }
        return new Error(`unexpected ${call.url}`)
      })
      try {
        const result = await pushKernel({}, folder, { homeDir: home, env: {}, accelerator: 'NvidiaTeslaT4', timeoutSec: 10800 })
        assert.equal(result.ok, true)
        assert.equal(result.url, 'https://www.kaggle.com/code/tester/imagen-abc')
        assert.equal(result.authFailed, false)
        assert.ok(result.output.includes('版本 2'))
        const call = fetchMock.calls[0]
        assert.ok(call.url.endsWith('/v1/kernels.KernelsApiService/SaveKernel'))
        assert.equal(call.json.slug, 'tester/imagen-abc')
        assert.equal(call.json.language, 'python')
        assert.equal(call.json.kernelType, 'script')
        assert.equal(call.json.text, 'print("hello")\n')
        assert.equal(call.json.machineShape, 'NvidiaTeslaT4')
        assert.equal(call.json.sessionTimeoutSeconds, 10800)
        assert.deepEqual(call.json.datasetDataSources, ['owner/ds'])
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('pushKernel：401 → authFailed，响应 error 字段 → ok=false', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const folder = join(home, 'kernel2')
      await mkdir(folder, { recursive: true })
      await writeFile(
        join(folder, 'kernel-metadata.json'),
        JSON.stringify({ id: 'tester/x', language: 'python', kernel_type: 'script', code_file: 'a.py' }),
        'utf8',
      )
      await writeFile(join(folder, 'a.py'), 'x=1', 'utf8')

      let mode = 'auth'
      const fetchMock = installFetch(() => {
        if (mode === 'auth') return { status: 403, body: { error: { message: 'Permission denied' } } }
        return { status: 200, body: { error: 'Title must be at least five characters', ref: 'tester/x' } }
      })
      try {
        const denied = await pushKernel({}, folder, { homeDir: home, env: {} })
        assert.equal(denied.ok, false)
        assert.equal(denied.authFailed, true)
        assert.ok(denied.output.includes('Kernel push error'))

        mode = 'error'
        const rejected = await pushKernel({}, folder, { homeDir: home, env: {} })
        assert.equal(rejected.ok, false)
        assert.equal(rejected.authFailed, false)
        assert.ok(rejected.output.includes('Title must be at least five characters'))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('kernelStatus / kernelLogs：userId+slug 报文、状态与日志尾部映射', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const fetchMock = installFetch((call) => {
        if (call.url.endsWith('/v1/kernels.KernelsApiService/GetKernelSessionStatus')) {
          assert.equal(call.json.userName, 'tester')
          assert.equal(call.json.kernelSlug, 'imagen-abc')
          return { status: 200, body: { status: 'RUNNING' } }
        }
        if (call.url.endsWith('/v1/kernels.KernelsApiService/ListKernelSessionOutput')) {
          assert.equal(call.json.userName, 'tester')
          return { status: 200, body: { files: [], log: '启动\nNbConvertApp noise\n就绪\n' } }
        }
        return new Error(`unexpected ${call.url}`)
      })
      try {
        const status = await kernelStatus({}, 'tester/imagen-abc', { homeDir: home, env: {} })
        assert.equal(status.ok, true)
        assert.equal(status.status, 'RUNNING')
        assert.equal(status.missing, false)
        assert.equal(status.output, 'RUNNING')

        const logs = await kernelLogs({}, 'tester/imagen-abc', { homeDir: home, env: {} })
        assert.equal(logs.ok, true)
        assert.ok(logs.tail.includes('启动'))
        assert.ok(logs.tail.includes('就绪'))
        assert.ok(!logs.tail.includes('NbConvertApp'))
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('kernelStatus：200 但缺 status 字段 → QUEUED（枚举默认值被省略）', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      // 实测：排队中的 Kernel 返回 HTTP 200 + {}（KernelWorkerStatus.QUEUED = 0 被 protobuf 省略）。
      const fetchMock = installFetch(() => ({ status: 200, body: {} }))
      try {
        const status = await kernelStatus({}, 'tester/imagen-queued', { homeDir: home, env: {} })
        assert.equal(status.ok, true)
        assert.equal(status.status, 'QUEUED')
        assert.equal(status.missing, false)
        assert.equal(status.output, 'QUEUED')
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('kernelStatus：已删除 Kernel 返回 403 → missing（不是 404）', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const fetchMock = installFetch(() => ({
        status: 403,
        body: { error: { code: 403, message: "Permission 'kernels.get' was denied", status: 'PERMISSION_DENIED' } },
      }))
      try {
        const status = await kernelStatus({}, 'tester/imagen-gone', { homeDir: home, env: {} })
        assert.equal(status.ok, false)
        assert.equal(status.missing, true)
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('isKernelMissingResponse：404 / 403 Permission denied / 文本 not found，认证失败不算缺失', () => {
    assert.equal(isKernelMissingResponse({ status: 404 }), true)
    assert.equal(
      isKernelMissingResponse({ status: 403, detail: "Permission 'kernels.get' was denied" }),
      true,
    )
    assert.equal(isKernelMissingResponse({ status: 0, detail: 'kernel not found' }), true)
    // 401 鉴权失败不能当成「Kernel 不存在」，否则会把登录问题静默当成可重推。
    assert.equal(isKernelMissingResponse({ status: 401, detail: 'Unauthorized' }), false)
    assert.equal(isKernelMissingResponse({ status: 500, detail: 'internal error' }), false)
    assert.equal(isKernelMissingResponse(null), false)
  })

  await check('deleteKernel：DeleteKernel 报文、已删除幂等、失败映射', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')

      let mode = 'ok'
      const fetchMock = installFetch((call) => {
        assert.ok(call.url.endsWith('/v1/kernels.KernelsApiService/DeleteKernel'), `unexpected ${call.url}`)
        assert.equal(call.method, 'POST')
        assert.equal(call.json.userName, 'tester')
        assert.equal(call.json.kernelSlug, 'imagen-gone')
        if (mode === 'ok') return { status: 200, body: {} }
        if (mode === 'missing') {
          return {
            status: 403,
            body: { error: { code: 403, message: "Permission 'kernels.get' was denied", status: 'PERMISSION_DENIED' } },
          }
        }
        return { status: 500, body: { error: { message: 'internal error' } } }
      })
      try {
        const ok = await deleteKernel({}, 'tester/imagen-gone', { homeDir: home, env: {} })
        assert.equal(ok.ok, true)
        assert.equal(ok.missing, false)

        mode = 'missing'
        const missing = await deleteKernel({}, 'tester/imagen-gone', { homeDir: home, env: {} })
        assert.equal(missing.ok, true, '已删除的 Kernel 再删应视为成功')
        assert.equal(missing.missing, true)

        mode = 'fail'
        const failed = await deleteKernel({}, 'tester/imagen-gone', { homeDir: home, env: {} })
        assert.equal(failed.ok, false)

        // 带版本号不支持删除：不发起请求直接失败。
        const versioned = await deleteKernel({}, 'tester/imagen-gone/2', { homeDir: home, env: {} })
        assert.equal(versioned.ok, false)
      } finally {
        fetchMock.restore()
      }
    })
  })

  await check('token 只出现在请求头：返回值 / 错误详情不含 token', async () => {
    await withHome(async (home) => {
      const dir = join(home, '.kaggle')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'access_token'), TOKEN, 'utf8')
      const fetchMock = installFetch(() => ({
        status: 500,
        body: { error: { message: 'internal error' } },
      }))
      try {
        const status = await kernelStatus({}, 'tester/imagen-abc', { homeDir: home, env: {} })
        assert.equal(status.ok, false)
        assert.ok(!status.output.includes(TOKEN))
        const logs = await kernelLogs({}, 'tester/imagen-abc', { homeDir: home, env: {} })
        assert.equal(logs.ok, false)
        assert.ok(!logs.tail.includes(TOKEN))
        assert.ok(!JSON.stringify(status).includes(TOKEN))
      } finally {
        fetchMock.restore()
      }
    })
  })
}

async function main() {
  await checkPureFunctions()
  await checkRequestsAndAuth()

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

