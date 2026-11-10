/**
 * Host 离线回归测试：library 原子写/并发安全 + kaggle probe 超时判定。
 *
 * 不联网、不起端口、不调用真实 kaggle CLI：
 *  - 每个用例用独立临时工作区（mkdtemp），避免与并行任务抢目录；
 *  - kaggle 探测用假 ctx.subprocess（resolveExecutable/spawn）驱动。
 *
 * 运行：node test/library-atomic.mjs
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { probeKaggle, runCli } from '../lib/kaggle.js'
import { readLibrary, recordDeleted, setFavorite } from '../lib/library.js'

const tempDirs = []

async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'imagen-library-test-'))
  tempDirs.push(dir)
  return dir
}

function libraryContext(workspace) {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      return undefined
    },
  }
}

function libraryFile(workspace) {
  return join(workspace, '.imagen', 'library.json')
}

async function readLibraryFile(workspace) {
  return JSON.parse(await readFile(libraryFile(workspace), 'utf8'))
}

function favoritePaths(prefix, count) {
  return Array.from({ length: count }, (_, index) => `imagen-output/${prefix}/img-${index}.png`)
}

// ---- kaggle 假 CLI -------------------------------------------------------

function cliResult({ exitCode = 0, stdout = '', stderr = '', delayMs = 0 } = {}) {
  return {
    done: new Promise((resolve) => setTimeout(() => resolve({ exitCode }), delayMs)),
    collected: {
      stdout: { readFrom: () => ({ text: stdout }) },
      stderr: { readFrom: () => ({ text: stderr }) },
    },
  }
}

function hangingResult(signal) {
  return {
    collected: {
      stdout: { readFrom: () => ({ text: '' }) },
      stderr: { readFrom: () => ({ text: '' }) },
    },
    done: new Promise((_resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'))
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  }
}

/**
 * 假 CLI 上下文：exec(command, signal) 返回 runCli 期望的 handle。
 * @returns {{ ctx: object, started: Array<{command: string, at: number}> }}
 */
function cliContext({ missing = false, exec }) {
  const started = []
  const ctx = {
    get() {
      return undefined
    },
    subprocess: {
      async resolveExecutable(name) {
        if (missing) throw new Error(`command not found: ${name}`)
        return `${name}.exe`
      },
      spawn({ argv, signal }) {
        const command = argv.slice(1).join(' ')
        started.push({ command, at: Date.now() })
        return exec(command, signal)
      },
    },
  }
  return { ctx, started }
}

/** 把 >=1s 的定时器缩短到 10ms，让「30s CLI 超时」这类分支能在毫秒级测完。 */
async function withFastTimers(fn) {
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, delay, ...rest) =>
    realSetTimeout(callback, Number(delay) >= 1000 ? 10 : delay, ...rest)
  try {
    return await fn()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
}

// ---- 测试驱动 -----------------------------------------------------------

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
  // ================= library =================

  await check('首次使用：文件不存在时返回空库且不带 notes', async () => {
    const workspace = await makeWorkspace()
    const library = await readLibrary(libraryContext(workspace))
    assert.deepEqual(library, { favorites: [], deleted: [] })
  })

  await check('20 个并发收藏无丢失，落盘为合法 JSON 且无临时文件残留', async () => {
    const workspace = await makeWorkspace()
    const ctx = libraryContext(workspace)
    const paths = favoritePaths('j1', 20)

    const saved = await Promise.all(paths.map((path) => setFavorite(ctx, path, true)))
    assert.equal(saved.length, 20)
    for (const item of saved) assert.equal(item.ok, true)

    const disk = await readLibraryFile(workspace)
    assert.deepEqual(disk.favorites, [...paths].sort(), '并发写入不应丢收藏')
    assert.deepEqual(disk.deleted, [])

    const entries = await readdir(join(workspace, '.imagen'))
    assert.ok(
      !entries.some((name) => name.startsWith('library.json.tmp-')),
      `不应残留临时文件：${entries.join(', ')}`,
    )
  })

  await check('收藏与删除并发混跑：串行队列保证顺序，删除的收藏被剔除', async () => {
    const workspace = await makeWorkspace()
    const ctx = libraryContext(workspace)
    const favorites = favoritePaths('j2', 20)
    const removed = favorites.slice(0, 10)

    const writes = [
      ...favorites.map((path) => setFavorite(ctx, path, true)),
      ...removed.map((path) => recordDeleted(ctx, [path])),
    ]
    await Promise.all(writes)

    const library = await readLibrary(ctx)
    assert.ok(!library.notes, `不应报告损坏：${JSON.stringify(library.notes)}`)
    assert.deepEqual(library.favorites, favorites.slice(10).sort(), '已被删除的收藏应被剔除且其余收藏保留')
    assert.equal(library.deleted.length, 10, '删除记录不应丢失')
    for (const path of removed) assert.ok(library.deleted.some((item) => item.path === path), `缺少删除记录 ${path}`)
  })

  await check('并发读写：任意时刻读到的都是完整快照（不损坏、不重复、已排序）', async () => {
    const workspace = await makeWorkspace()
    const ctx = libraryContext(workspace)
    const paths = favoritePaths('j3', 30)
    const finalSet = new Set(paths)

    const writers = paths.map((path) => setFavorite(ctx, path, true))
    const snapshots = await Promise.all(Array.from({ length: 40 }, () => readLibrary(ctx)))
    await Promise.all(writers)

    for (const snapshot of snapshots) {
      assert.ok(!snapshot.notes, `读取不应命中损坏态：${JSON.stringify(snapshot.notes)}`)
      assert.equal(new Set(snapshot.favorites).size, snapshot.favorites.length, '快照内不应有重复项')
      assert.deepEqual(snapshot.favorites, [...snapshot.favorites].sort(), '快照应始终是有序的')
      for (const path of snapshot.favorites) assert.ok(finalSet.has(path), `快照出现未写入路径 ${path}`)
    }

    const finalLibrary = await readLibrary(ctx)
    assert.equal(finalLibrary.favorites.length, 30, '全部写完后 30 条收藏都应存在')
  })

  await check('损坏文件：readLibrary 给 notes，写入前备份原文件且新库可用', async () => {
    const workspace = await makeWorkspace()
    const ctx = libraryContext(workspace)
    const corrupt = '{"favorites": ["imagen-output/old/a.png"], '
    await mkdir(join(workspace, '.imagen'), { recursive: true })
    await writeFile(libraryFile(workspace), corrupt, 'utf8')

    const before = await readLibrary(ctx)
    assert.deepEqual(before.favorites, [])
    assert.ok(Array.isArray(before.notes) && before.notes.length > 0, '损坏时应返回可展示的 notes，而不是静默空库')

    const saved = await setFavorite(ctx, 'imagen-output/new/b.png', true)
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.favorites, ['imagen-output/new/b.png'])

    const disk = await readLibraryFile(workspace)
    assert.deepEqual(disk.favorites, ['imagen-output/new/b.png'])

    const entries = await readdir(join(workspace, '.imagen'))
    const backup = entries.find((name) => name.startsWith('library.json.corrupt-'))
    assert.ok(backup, `损坏文件应被备份，实际目录：${entries.join(', ')}`)
    assert.equal(await readFile(join(workspace, '.imagen', backup), 'utf8'), corrupt, '备份应保留原始内容')
  })

  await check('写入失败不破坏旧状态：目标不可替换时抛错且旧目录原样保留', async () => {
    const workspace = await makeWorkspace()
    const ctx = libraryContext(workspace)
    const target = libraryFile(workspace)
    await mkdir(target, { recursive: true })
    const marker = join(target, 'marker.txt')
    await writeFile(marker, 'keep', 'utf8')

    await assert.rejects(() => setFavorite(ctx, 'imagen-output/x/a.png', true))

    assert.equal((await stat(target)).isDirectory(), true, '失败写入不应删除/替换已有目标')
    assert.equal(await readFile(marker, 'utf8'), 'keep', '已有内容不应被截断')
    const entries = await readdir(join(workspace, '.imagen'))
    assert.ok(
      !entries.some((name) => name.startsWith('library.json.tmp-')),
      `失败后不应残留临时文件：${entries.join(', ')}`,
    )
  })

  await check('路径规范化与去重：反斜杠统一为斜杠，重复收藏/删除只记一次', async () => {
    const workspace = await makeWorkspace()
    const ctx = libraryContext(workspace)

    await setFavorite(ctx, 'imagen-output\\a\\b.png', true)
    await setFavorite(ctx, 'imagen-output/a/b.png', true)
    await setFavorite(ctx, 'imagen-output/a/b.png', true)
    let library = await readLibrary(ctx)
    assert.deepEqual(library.favorites, ['imagen-output/a/b.png'])

    await recordDeleted(ctx, ['imagen-output\\c\\d.png', 'imagen-output/c/d.png'])
    await recordDeleted(ctx, ['imagen-output/c/d.png'])
    library = await readLibrary(ctx)
    assert.equal(library.deleted.length, 1)
    assert.equal(library.deleted[0].path, 'imagen-output/c/d.png')
    assert.deepEqual(library.favorites, ['imagen-output/a/b.png'], '删除非收藏路径不影响收藏')
  })

  // ================= kaggle probe =================

  await check('runCli：可执行文件缺失时返回 failure=spawn 而不是抛异常', async () => {
    const { ctx } = cliContext({
      missing: true,
      exec() {
        throw new Error('should not spawn')
      },
    })
    const result = await runCli(ctx, ['kaggle', '--version'], 100)
    assert.equal(result.failure, 'spawn')
    assert.equal(result.code, -1)
    assert.match(result.stderr, /command not found/)
  })

  await check('runCli：命令卡死时返回 failure=timeout 且标注超时', async () => {
    const { ctx } = cliContext({
      exec: (_command, signal) => hangingResult(signal),
    })
    const result = await runCli(ctx, ['kaggle', '--version'], 25)
    assert.equal(result.failure, 'timeout')
    assert.equal(result.code, -1)
    assert.match(result.stderr, /timeout after 25ms/)
  })

  await check('probe：CLI 缺失时给出 cli_missing 与安装提示', async () => {
    const { ctx } = cliContext({
      missing: true,
      exec() {
        throw new Error('should not spawn')
      },
    })
    const probe = await probeKaggle(ctx)
    assert.equal(probe.cli.present, false)
    assert.equal(probe.auth.ok, false)
    assert.equal(probe.auth.errorCode, 'cli_missing')
    assert.ok(probe.notes.some((note) => note.includes('pip install -U kaggle')), `notes=${JSON.stringify(probe.notes)}`)
  })

  await check('probe：版本串不再重复，auth/quota/username 并发发起', async () => {
    const { ctx, started } = cliContext({
      exec(command) {
        if (command.includes('--version')) return cliResult({ stdout: 'Kaggle CLI 2.2.5', delayMs: 20 })
        if (command.includes('kernels list')) return cliResult({ exitCode: 0, delayMs: 20 })
        if (command.includes('quota')) return cliResult({ exitCode: 1, stderr: 'Connection reset by peer', delayMs: 20 })
        if (command.includes('config view')) {
          return cliResult({
            stdout: 'Configuration values from C:\\Users\\test\\.kaggle\n- username: alice\n- auth_method: ACCESS_TOKEN\n',
            delayMs: 20,
          })
        }
        throw new Error(`unexpected command: ${command}`)
      },
    })

    const probe = await probeKaggle(ctx)
    assert.equal(probe.cli.present, true)
    assert.equal(probe.cli.version, '2.2.5', `version=${probe.cli.version}`)
    assert.ok(probe.notes.includes('kaggle CLI 2.2.5'), `notes=${JSON.stringify(probe.notes)}`)
    assert.ok(
      !probe.notes.some((note) => /kaggle CLI CLI/.test(note)),
      `版本串不应重复：${JSON.stringify(probe.notes)}`,
    )
    assert.equal(probe.auth.ok, true)
    assert.equal(probe.quota.available, false, 'quota 失败只降级展示，不影响探测结果')
    assert.equal(probe.cli.username, 'alice')
    assert.ok(probe.notes.some((note) => note.includes('配额接口不可用')))

    const versionCall = started.find((item) => item.command.includes('--version'))
    const followUps = started.filter((item) => !item.command.includes('--version'))
    assert.ok(versionCall, '应先跑 kaggle --version')
    assert.deepEqual(
      followUps.map((item) => item.command.split(' ').slice(0, 2).join(' ')).sort(),
      ['config view', 'kernels list', 'quota'],
      `并发命令集合不符：${JSON.stringify(started.map((item) => item.command))}`,
    )
    const span = Math.max(...followUps.map((item) => item.at)) - Math.min(...followUps.map((item) => item.at))
    assert.ok(span <= 30, `三个检查应并发发起，实际启动间隔 ${span}ms`)
  })

  await check('probe：CLI 启动超时不再误报 cli_missing', async () => {
    const { ctx } = cliContext({
      exec: (_command, signal) => hangingResult(signal),
    })
    const probe = await withFastTimers(() => probeKaggle(ctx))
    assert.equal(probe.cli.present, true, '超时应判定为 CLI 存在但启动超时')
    assert.equal(probe.cli.version, null)
    assert.equal(probe.auth.ok, false)
    assert.equal(probe.auth.errorCode, 'cli_timeout')
    assert.ok(
      !probe.notes.some((note) => note.includes('未找到')),
      `不应再提示未找到 CLI：${JSON.stringify(probe.notes)}`,
    )
    assert.ok(probe.notes.some((note) => note.includes('启动超时')), `notes=${JSON.stringify(probe.notes)}`)
  })
}

try {
  await main()
} finally {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}