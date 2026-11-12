/**
 * lib/net.js 的 curl 降级路径回归。
 *
 * 背景（0.7.1 线上故障）：DSH subprocess 的 spawn 请求是「完全明确」的——
 *  - `argv` 每一项必须是字符串。把 `new URL(...)` 对象直接塞进去会抛
 *    `TypeError: value.includes is not a function`；
 *  - `cwd` 必须是字符串。缺省会抛
 *    `TypeError: Cannot read properties of undefined (reading 'includes')`。
 *
 * 之前的 host-e2e 假宿主里 `resolveExecutable` 永远抛错，curl 分支从未被执行，
 * 于是这个缺陷在测试全绿的情况下发布了出去，线上表现为：
 * `[net] fetch 与 curl 均失败 ... detail=value.includes is not a function`，
 * 代理环境下所有远端请求（/health、/job、ntfy 会合）全部失败。
 *
 * 本文件用一个与 DSH 契约同样严格的假 subprocess 覆盖降级路径，避免回归。
 */

import assert from 'node:assert/strict'

import { httpText } from '../lib/net.js'

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

/**
 * 伪造 DSH subprocess：按 subprocess-local 的真实校验规则拒绝非法请求。
 *
 * @param {{ stdout?: string, stderr?: string, exitCode?: number, status?: number }} options
 * @returns {{ ctx: object, calls: object[] }}
 */
function fakeSubprocess(options = {}) {
  const stdout = options.stdout ?? ''
  const stderr = options.stderr ?? ''
  const exitCode = options.exitCode ?? 0
  const status = options.status ?? 200
  const calls = []

  const subprocess = {
    async resolveExecutable(command) {
      assert.equal(typeof command, 'string', 'resolveExecutable 只接受字符串命令名')
      return `C:\\fake-bin\\${command}.exe`
    },
    spawn(spec) {
      // 对应 subprocess-local 的 validateSubprocessSpec / targetEnvironment。
      assert.ok(spec && typeof spec === 'object', 'spawn 必须收到 spec 对象')
      assert.ok(Array.isArray(spec.argv), 'argv 必须是数组')
      spec.argv.forEach((value, index) => {
        if (typeof value !== 'string') {
          // 线上这条 TypeError 的原文就长这样，保留它便于排查。
          throw new TypeError('value.includes is not a function')
        }
        assert.ok(!value.includes('\0'), `argv[${index}] 不能包含 NUL`)
      })
      if (typeof spec.cwd !== 'string') {
        throw new TypeError("Cannot read properties of undefined (reading 'includes')")
      }
      assert.ok(Number.isFinite(spec.graceMs) && spec.graceMs > 0, 'graceMs 必须是正有限数')
      assert.equal(typeof spec.stdio, 'object', 'stdio 必须是对象')
      calls.push(spec)

      const body = `${stdout}\n__IMAGEN_HTTP_STATUS__:${String(status).padStart(3, '0')}`
      return {
        done: Promise.resolve({ exitCode, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: body, next: body.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, next: stderr.length, lossy: false }) },
        },
      }
    },
  }

  return { ctx: { subprocess }, calls }
}

const originalFetch = globalThis.fetch

async function main() {
  await check('fetch 失败时降级 curl，URL 对象被归一成字符串传给 argv', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const fake = fakeSubprocess({ stdout: '{"status":"ok","phase":"ready"}' })
    const result = await httpText(fake.ctx, new URL('https://example.test/health'), {
      timeoutMs: 4000,
      headers: { authorization: 'Bearer secret-token' },
    })
    assert.deepEqual(
      { ok: result.ok, status: result.status, text: result.text, via: result.via },
      { ok: true, status: 200, text: '{"status":"ok","phase":"ready"}', via: 'curl' },
    )
    assert.equal(fake.calls.length, 1, '应当只启动一次 curl')
    const spec = fake.calls[0]
    assert.ok(spec.argv.every((value) => typeof value === 'string'), 'argv 全部是字符串')
    assert.equal(spec.cwd, process.cwd(), 'cwd 必须是字符串（缺省会抛 TypeError）')
    assert.equal(spec.argv.at(-1), 'https://example.test/health', 'URL 对象要转成字符串')
    assert.ok(spec.argv.includes('-H'), '自定义请求头要透传')
    assert.ok(spec.argv.includes('authorization: Bearer secret-token'), 'Bearer 头要透传')
    assert.ok(spec.argv.includes('--max-time') && spec.argv.includes('4'), '超时秒数要透传')
  })

  await check('字符串 URL 与 POST 请求体同样可用，4xx 按失败返回状态码', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const fake = fakeSubprocess({ stdout: '{"error":{"code":"invalid_request"}}', status: 400 })
    const result = await httpText(fake.ctx, 'https://example.test/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"prompt":"x"}',
      timeoutMs: 15000,
    })
    assert.equal(result.via, 'curl')
    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.equal(result.text, '{"error":{"code":"invalid_request"}}')
    assert.ok(fake.calls[0].argv.includes('--data-binary'), 'POST 请求体要透传')
    assert.ok(fake.calls[0].argv.includes('{"prompt":"x"}'), '请求体内容要透传')
    assert.ok(fake.calls[0].argv.includes('15'), '超时秒数四舍五入取整')
  })

  await check('fetch 成功时不再启动 curl', async () => {
    globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 })
    const fake = fakeSubprocess()
    const result = await httpText(fake.ctx, 'https://example.test/job?id=1', { timeoutMs: 1000 })
    assert.equal(result.via, 'fetch')
    assert.equal(result.text, '{"ok":true}')
    assert.equal(fake.calls.length, 0, 'fetch 成功不应触发降级')
  })

  await check('curl 也失败时抛出的错误带完整降级链路与原因', async () => {
    const fetchError = new TypeError('fetch failed')
    globalThis.fetch = async () => {
      throw fetchError
    }
    const ctx = {
      subprocess: {
        async resolveExecutable() {
          // 对应「本机没装 curl」：subprocess-local 抛 SubprocessExecutableNotFoundError。
          throw new Error('subprocess-local: command "curl" was not found on PATH')
        },
      },
    }
    await assert.rejects(
      () => httpText(ctx, 'https://example.test/health', { timeoutMs: 1000 }),
      (error) => {
        assert.match(String(error.message), /^fetch 与 curl 均失败/)
        assert.match(String(error.message), /was not found on PATH/)
        assert.equal(error.cause, fetchError, '原始 fetch 错误要挂在 cause 上')
        return true
      },
    )
  })

  await check('curl 退出码非 0 时返回失败结果而不是抛错（保持调用方形状）', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const fake = fakeSubprocess({ stdout: '', stderr: 'curl: (7) Failed to connect', exitCode: 7, status: 0 })
    const result = await httpText(fake.ctx, new URL('https://example.test/health'), { timeoutMs: 1000 })
    assert.equal(result.ok, false)
    assert.equal(result.via, 'curl')
    assert.match(result.text, /Failed to connect/, '连接失败时把 stderr 交给上层判断')
  })

  await check('缺少 subprocess 服务时直接抛出 fetch 的原始错误', async () => {
    const fetchError = new TypeError('fetch failed')
    globalThis.fetch = async () => {
      throw fetchError
    }
    await assert.rejects(() => httpText({}, 'https://example.test/health'), (error) => error === fetchError)
  })

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}

try {
  await main()
} finally {
  globalThis.fetch = originalFetch
}
