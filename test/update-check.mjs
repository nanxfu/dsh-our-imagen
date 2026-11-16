#!/usr/bin/env node
/**
 * 插件自身版本检查的离线回归（不联网、不写工作区）。
 *
 * 覆盖：
 *   A. shared/version.js：归一化、主版本号比较、脏数据不误判；
 *   B. lib/update-check.js：注册表主/备回退、只认更高的版本、结果缓存与重载、
 *      TTL 判定、失败保留上次结果、关闭开关后不发起任何请求。
 *
 * 运行：node test/update-check.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compareVersions, isNewerVersion, normalizeVersion } from '../shared/version.js'
import {
  UPDATE_CHECK_TTL_MS,
  UPDATE_RECORD_VERSION,
  createUpdateChecker,
  releaseUrlOf,
} from '../lib/update-check.js'

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(true)
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push(false)
    console.log(`  ✗ ${name}：${error?.message ?? error}`)
  }
}

const dir = await mkdtemp(join(tmpdir(), 'imagen-update-test-'))

/** 构造一个可以记录调用地址的假 fetch；按调用顺序返回给定结果。 */
function fakeFetch(handler) {
  const calls = []
  const fetchText = async (url, options) => {
    calls.push({ url, options })
    return handler(url, calls.length)
  }
  return { calls, fetchText }
}

function okManifest(manifest) {
  return { ok: true, status: 200, text: JSON.stringify(manifest) }
}

try {
  // ── A. 版本号工具 ────────────────────────────────────────────────
  console.log('\n── 版本号工具')

  await check('归一化：合法版本原样保留，非法值返回 null', () => {
    assert.equal(normalizeVersion('0.12.0'), '0.12.0')
    assert.equal(normalizeVersion(' 0.12.0 '), '0.12.0')
    assert.equal(normalizeVersion('1'), '1')
    assert.equal(normalizeVersion('0.12.0-beta.1'), '0.12.0-beta.1')
    assert.equal(normalizeVersion('v0.12.0'), null)
    assert.equal(normalizeVersion(''), null)
    assert.equal(normalizeVersion(null), null)
    assert.equal(normalizeVersion(120), null)
    assert.equal(normalizeVersion('1'.repeat(33)), null)
  })

  await check('比较：按主版本号三段比较，任一侧不可解析返回 null', () => {
    assert.equal(compareVersions('0.12.0', '0.11.9'), 1)
    assert.equal(compareVersions('0.11.9', '0.12.0'), -1)
    assert.equal(compareVersions('0.11.0', '0.11.0'), 0)
    assert.equal(compareVersions('0.11', '0.11.0'), 0)
    assert.equal(compareVersions('bad', '0.11.0'), null)
    assert.equal(compareVersions(undefined, '0.11.0'), null)
  })

  await check('isNewerVersion：只认更高版本，预发布后缀不参与排序', () => {
    assert.equal(isNewerVersion('0.12.0', '0.11.0'), true)
    assert.equal(isNewerVersion('0.11.0', '0.11.0'), false)
    assert.equal(isNewerVersion('0.10.9', '0.11.0'), false)
    assert.equal(isNewerVersion('0.12.0-beta', '0.11.0'), true)
    assert.equal(isNewerVersion('0.11.0', 'bad'), false)
  })

  await check('Release 链接只接受可解析版本', () => {
    assert.equal(
      releaseUrlOf('0.12.0'),
      'https://github.com/nanxfu/dsh-our-imagen/releases/tag/v0.12.0',
    )
    assert.equal(releaseUrlOf('bad'), null)
  })

  // ── B. 检查器 ────────────────────────────────────────────────────
  console.log('\n── 检查器')

  await check('首个注册表成功：识别新版本、附带 engines.dsh 与 release 链接', async () => {
    const fail = fakeFetch(() => okManifest({ version: '0.12.0', engines: { dsh: '>=0.2.0' } }))
    const checker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: fail.fetchText })
    const snapshot = await checker.check()
    assert.equal(snapshot.current, '0.11.0')
    assert.equal(snapshot.latest, '0.12.0')
    assert.equal(snapshot.hasUpdate, true)
    assert.equal(snapshot.enginesDsh, '>=0.2.0')
    assert.equal(snapshot.releaseUrl, 'https://github.com/nanxfu/dsh-our-imagen/releases/tag/v0.12.0')
    assert.equal(snapshot.stale, false)
    assert.equal(fail.calls.length, 1)
    assert.equal(fail.calls[0].url, 'https://registry.npmjs.org/dsh-our-imagen/latest')
    assert.equal(fail.calls[0].options.headers.accept, 'application/json')
  })

  await check('npmjs 失败后回退 npmmirror：直到拿到合法版本为止', async () => {
    const fallback = fakeFetch((url) => {
      if (url.includes('registry.npmjs.org')) return { ok: false, status: 503, text: 'unavailable' }
      return okManifest({ version: '0.12.1' })
    })
    const checker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: fallback.fetchText })
    const snapshot = await checker.check()
    assert.equal(snapshot.hasUpdate, true)
    assert.equal(snapshot.latest, '0.12.1')
    assert.equal(fallback.calls.length, 2)
    assert.ok(fallback.calls[1].url.startsWith('https://registry.npmmirror.com/'))
  })

  await check('两个注册表都失败：不误报更新，错误只留给日志', async () => {
    const offline = fakeFetch(() => {
      throw new Error('fetch failed')
    })
    const checker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: offline.fetchText })
    const snapshot = await checker.check()
    assert.equal(snapshot.hasUpdate, false)
    assert.equal(snapshot.latest, null)
    assert.equal(snapshot.releaseUrl, null)
    assert.equal(snapshot.error, 'network')
    assert.equal(offline.calls.length, 2)
  })

  await check('同版本 / 旧版本：hasUpdate=false', async () => {
    const same = fakeFetch(() => okManifest({ version: '0.11.0' }))
    const sameChecker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: same.fetchText })
    const sameSnapshot = await sameChecker.check()
    assert.equal(sameSnapshot.hasUpdate, false)
    assert.equal(sameSnapshot.latest, '0.11.0')

    const older = fakeFetch(() => okManifest({ version: '0.10.0' }))
    const olderChecker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: older.fetchText })
    const olderSnapshot = await olderChecker.check()
    assert.equal(olderSnapshot.hasUpdate, false)
    assert.equal(olderSnapshot.releaseUrl, null)
  })

  await check('manifest 非法：继续尝试下一个注册表，不把脏版本写进结果', async () => {
    const dirty = fakeFetch((url) => {
      if (url.includes('registry.npmjs.org')) return { ok: true, status: 200, text: 'not json' }
      return okManifest({ version: 'v0.12.0' })
    })
    const checker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: dirty.fetchText })
    const snapshot = await checker.check()
    assert.equal(snapshot.hasUpdate, false)
    assert.equal(snapshot.latest, null)
    assert.equal(dirty.calls.length, 2)
  })

  await check('engines.dsh 只接受短字符串，非法值忽略', async () => {
    const dirty = fakeFetch(() => okManifest({ version: '0.12.0', engines: { dsh: 42 } }))
    const checker = createUpdateChecker({ dir, currentVersion: '0.11.0', fetchText: dirty.fetchText })
    const snapshot = await checker.check()
    assert.equal(snapshot.enginesDsh, null)
  })

  await check('成功检查写入缓存：新实例 load() 不联网也能恢复结果', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'imagen-update-cache-'))
    const online = fakeFetch(() => okManifest({ version: '0.13.0', engines: { dsh: '>=0.2.0' } }))
    const writer = createUpdateChecker({ dir: fresh, currentVersion: '0.11.0', fetchText: online.fetchText })
    await writer.check()
    const raw = JSON.parse(await readFile(join(fresh, '.imagen', 'update-check.json'), 'utf8'))
    assert.equal(raw.version, UPDATE_RECORD_VERSION)
    assert.equal(raw.latest, '0.13.0')

    const offline = fakeFetch(() => {
      throw new Error('should not be called')
    })
    const reader = createUpdateChecker({ dir: fresh, currentVersion: '0.11.0', fetchText: offline.fetchText })
    const snapshot = await reader.load()
    assert.equal(snapshot.latest, '0.13.0')
    assert.equal(snapshot.hasUpdate, true)
    assert.equal(snapshot.stale, false)
    assert.equal(offline.calls.length, 0)
    await rm(fresh, { recursive: true, force: true })
  })

  await check('TTL 过期：stale=true；再次检查后回来', async () => {
    const clock = { time: 1_700_000_000_000 }
    const online = fakeFetch(() => okManifest({ version: '0.12.0' }))
    const checker = createUpdateChecker({
      dir,
      currentVersion: '0.11.0',
      fetchText: online.fetchText,
      now: () => clock.time,
    })
    await checker.check()
    assert.equal(checker.snapshot().stale, false)
    clock.time += UPDATE_CHECK_TTL_MS - 1
    assert.equal(checker.snapshot().stale, false)
    clock.time += 2
    assert.equal(checker.snapshot().stale, true)
  })

  await check('成功之后再失败：保留上次成功结果，error 只做诊断', async () => {
    const dirKeep = await mkdtemp(join(tmpdir(), 'imagen-update-keep-'))
    let mode = 'ok'
    const flaky = fakeFetch(() => {
      if (mode === 'ok') return okManifest({ version: '0.12.5' })
      throw new Error('down')
    })
    const checker = createUpdateChecker({ dir: dirKeep, currentVersion: '0.11.0', fetchText: flaky.fetchText })
    await checker.check()
    mode = 'down'
    const snapshot = await checker.check()
    assert.equal(snapshot.latest, '0.12.5')
    assert.equal(snapshot.hasUpdate, true)
    assert.equal(snapshot.error, 'network')
    await rm(dirKeep, { recursive: true, force: true })
  })

  await check('enabled=false：不发起请求、不写缓存', async () => {
    const disabledDir = await mkdtemp(join(tmpdir(), 'imagen-update-off-'))
    const fetch = fakeFetch(() => okManifest({ version: '9.9.9' }))
    const checker = createUpdateChecker({
      dir: disabledDir,
      currentVersion: '0.11.0',
      enabled: false,
      fetchText: fetch.fetchText,
    })
    const snapshot = await checker.check()
    assert.equal(snapshot.hasUpdate, false)
    assert.equal(snapshot.latest, null)
    assert.equal(fetch.calls.length, 0)
    const cacheExists = await readFile(join(disabledDir, '.imagen', 'update-check.json'), 'utf8').then(
      () => true,
      () => false,
    )
    assert.equal(cacheExists, false)
    await rm(disabledDir, { recursive: true, force: true })
  })
} finally {
  await rm(dir, { recursive: true, force: true })
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
if (failed > 0) process.exitCode = 1
