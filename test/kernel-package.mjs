/**
 * Kernel 目录打包测试（不联网、不调 kaggle CLI）。
 *
 * 覆盖 P2.1 的注入链路与 C2 的打包内联：
 *   - lib/kernel.js：dataset_sources 合法项写入、非法项过滤、metadata 结构合法、
 *     config 以 base64 注入 daemon.py 的 EMBEDDED_CONFIG_B64 行、@@INLINE 标记行被
 *     remote/anima_runtime.py 全文替换（产物仍是单文件、能通过 python 语法编译）、
 *     内联失败给出可读错误、临时目录可清理；
 *   - 源文件保持单份真源：remote/daemon.py 只留内联标记，不再复制 anima 运行时；
 *   - lib/session/provisioner.js：可选注入键（hf_token / pip_constraints /
 *     fallback_tunnel_command / local_models）只在非空时输出，空值保持旧键集合。
 *
 * 运行：node test/kernel-package.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildKernelFolder, hasInlineMarkerLine, normalizeDatasetSources, removeKernelFolder } from '../lib/kernel.js'
import { buildKernelConfig } from '../lib/session/provisioner.js'
import { VERSION } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'
import { assertPythonImports, assertPythonSyntax } from './helpers/python-check.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON_SOURCE = join(ROOT, 'remote', 'daemon.py')
const INLINE_MODULES = [
  {
    name: 'log_ring',
    file: 'log_ring.py',
    source: join(ROOT, 'remote', 'log_ring.py'),
    marker: /^[ \t]*from log_ring import [^\n]*#\s*@@INLINE:log_ring\.py@@[ \t]*$/m,
    importLine: /^[ \t]*from log_ring import /m,
    defs: ['log', 'install_stream_tee', 'log_since'],
  },
  {
    name: 'pipeline_loader',
    file: 'pipeline_loader.py',
    source: join(ROOT, 'remote', 'pipeline_loader.py'),
    marker: /^[ \t]*from pipeline_loader import [^\n]*#\s*@@INLINE:pipeline_loader\.py@@[ \t]*$/m,
    importLine: /^[ \t]*from pipeline_loader import /m,
    defs: ['load_diffusers_pipeline', 'filter_call_kwargs'],
  },
  {
    name: 'cache_ops',
    file: 'cache_ops.py',
    source: join(ROOT, 'remote', 'cache_ops.py'),
    marker: /^[ \t]*from cache_ops import [^\n]*#\s*@@INLINE:cache_ops\.py@@[ \t]*$/m,
    importLine: /^[ \t]*from cache_ops import /m,
    defs: ['run_disk_precheck', 'evict_cache_dirs'],
  },
  {
    name: 'anima_runtime',
    file: 'anima_runtime.py',
    source: join(ROOT, 'remote', 'anima_runtime.py'),
    marker: /^[ \t]*from anima_runtime import [^\n]*#\s*@@INLINE:anima_runtime\.py@@[ \t]*$/m,
    importLine: /^[ \t]*from anima_runtime import /m,
    defs: ['_anima_toolkit', 'load_anima_runtime'],
  },
  {
    name: 'tunnel',
    file: 'tunnel.py',
    source: join(ROOT, 'remote', 'tunnel.py'),
    marker: /^[ \t]*from tunnel import [^\n]*#\s*@@INLINE:tunnel\.py@@[ \t]*$/m,
    importLine: /^[ \t]*from tunnel import /m,
    defs: ['run_start_tunnel', 'verify_or_download_cloudflared'],
  },
]

const { check, summary } = createCheckRunner()

/** 从打包后的脚本里取出注入的配置（base64 JSON）。 */
function readInjectedConfig(source) {
  const match = source.match(/^EMBEDDED_CONFIG_B64 = "([^"]*)"$/m)
  assert.ok(match, 'daemon.py 缺少 EMBEDDED_CONFIG_B64 注入行')
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

/** 只替换注入行，其余内容必须与源文件（内联后的期望值）逐字一致。 */
function stripInjectedConfig(source) {
  assert.match(source, /^EMBEDDED_CONFIG_B64 = "[A-Za-z0-9+/=]*"$/m, '注入行格式不正确')
  return source.replace(/^EMBEDDED_CONFIG_B64 = "[A-Za-z0-9+/=]*"$/m, 'EMBEDDED_CONFIG_B64 = ""')
}

async function main() {
  const daemonSource = await readFile(DAEMON_SOURCE, 'utf8')
  const cleanups = []
  const cleanup = (dir) => {
    if (dir) cleanups.push(dir)
  }

  try {
    await check('normalizeDatasetSources 过滤非法项并去重', () => {
      const sources = normalizeDatasetSources([
        'owner/dataset-a',
        ' owner/dataset-a ',
        'owner/dataset-b',
        '',
        'no-slash',
        'a/b/c',
        'owner/name with space',
        42,
        null,
      ])
      assert.deepEqual(sources, ['owner/dataset-a', 'owner/dataset-b'])
      assert.deepEqual(normalizeDatasetSources(null), [])
      assert.deepEqual(normalizeDatasetSources('owner/dataset'), [])
    })

    const config = buildKernelConfig({
      presetId: 'sdxl-lightning',
      token: 'tok-test',
      topic: 'topic-test',
      idleTimeoutSec: 900,
      hfToken: 'hf_test_token',
      pipConstraints: ['diffusers<0.36', 'diffusers<0.36', '', 7],
      fallbackTunnelCommand: ['bore', 'local', '127.0.0.1:{port}', ''],
      localModels: {
        'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl-base',
        invalid: '',
      },
    })

    await check('buildKernelFolder 写入 dataset_sources / 配置 base64 / metadata', async () => {
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'abcd1234',
        config,
        datasetSources: ['owner/dataset-a', 'bad-source', 'owner/dataset-b'],
      })
      cleanup(folder.dir)

      assert.equal(folder.kernelId, 'tester/imagen-abcd1234')
      assert.equal(folder.kernelUrl, 'https://www.kaggle.com/code/tester/imagen-abcd1234')

      const metadata = JSON.parse(await readFile(join(folder.dir, 'kernel-metadata.json'), 'utf8'))
      assert.deepEqual(folder.metadata, metadata)
      assert.deepEqual(metadata.dataset_sources, ['owner/dataset-a', 'owner/dataset-b'])
      assert.equal(metadata.id, 'tester/imagen-abcd1234')
      assert.equal(metadata.title, 'imagen-abcd1234')
      assert.equal(metadata.code_file, 'daemon.py')
      assert.equal(metadata.language, 'python')
      assert.equal(metadata.kernel_type, 'script')
      assert.equal(metadata.is_private, true)
      assert.equal(metadata.enable_gpu, true)
      assert.equal(metadata.enable_tpu, false)
      assert.equal(metadata.enable_internet, true)
      assert.deepEqual(metadata.competition_sources, [])
      assert.deepEqual(metadata.kernel_sources, [])
      assert.deepEqual(metadata.model_sources, [])

      const patched = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      const injected = readInjectedConfig(patched)
      assert.deepEqual(injected, config)
      assert.equal(injected.version, VERSION)
      assert.equal(injected.contract.version, VERSION)
      assert.equal(injected.preload.loader, 'sdxl-lora')
      assert.equal(injected.hf_token, 'hf_test_token')
      assert.deepEqual(injected.pip_constraints, ['diffusers<0.36'])
      assert.deepEqual(injected.fallback_tunnel_command, ['bore', 'local', '127.0.0.1:{port}'])
      assert.deepEqual(injected.local_models, {
        'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl-base',
      })

      // 注入只改一行、内联只替换标记行：其余内容必须与 remote/daemon.py 逐字一致。
      let expectedSource = daemonSource
      for (const mod of INLINE_MODULES) {
        assert.match(daemonSource, mod.marker, `remote/daemon.py 缺少 ${mod.name} 内联标记行`)
        const modSource = await readFile(mod.source, 'utf8')
        expectedSource = expectedSource.replace(mod.marker, () => modSource.trimEnd())
      }
      assert.equal(stripInjectedConfig(patched), expectedSource)
      assert.equal(patched.match(/^VERSION = "([^"]+)"$/m)?.[1], VERSION)
    })

    await check('打包产物自包含：共享模块各只内联一份、无残留标记', async () => {
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'a1b2c3d4',
        config,
        enableGpu: false,
      })
      cleanup(folder.dir)
      const patched = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      assert.equal(hasInlineMarkerLine(patched), false, '仍有未处理的 @@INLINE 标记')
      const exportedSymbols = ['build_pipeline', 'main']
      for (const mod of INLINE_MODULES) {
        assert.doesNotMatch(patched, mod.importLine, `仍有未解析的 ${mod.name} import 行`)
        const modSource = await readFile(mod.source, 'utf8')
        assert.ok(patched.includes(modSource.trimEnd()), `产物未包含 remote/${mod.file} 全文`)
        for (const fn of mod.defs) {
          const defsCount = patched.match(new RegExp(`^def ${fn}\\(`, 'gm'))?.length ?? 0
          assert.equal(defsCount, 1, `${fn} 应恰好一份，实际 ${defsCount} 份`)
          exportedSymbols.push(fn)
        }
      }
      assertPythonSyntax(join(folder.dir, 'daemon.py'))
      // 隔离目录内 import：产物不依赖 remote/ 目录，证明是真的单文件自包含。
      assertPythonImports(join(folder.dir, 'daemon.py'), exportedSymbols)
    })

    await check('源文件保持单份真源：daemon.py 不再复制已抽取的共享模块', async () => {
      assert.equal(
        daemonSource.match(/@@INLINE:/g)?.length,
        INLINE_MODULES.length,
        `remote/daemon.py 应有 ${INLINE_MODULES.length} 处内联标记`,
      )
      for (const mod of INLINE_MODULES) {
        const modSource = await readFile(mod.source, 'utf8')
        for (const fn of mod.defs) {
          assert.doesNotMatch(daemonSource, new RegExp(`^def ${fn}\\(`, 'm'), `daemon.py 仍内嵌 ${fn}`)
          assert.match(modSource, new RegExp(`^def ${fn}\\(`, 'm'), `remote/${mod.file} 缺少 ${fn}`)
        }
      }
      const runtimeSource = await readFile(INLINE_MODULES.find((m) => m.name === 'anima_runtime').source, 'utf8')
      assert.match(runtimeSource, /^import os$/m)
      assert.match(runtimeSource, /^import time$/m)
    })

    await check('内联标记指向缺失模块时给出可读错误', async () => {
      const brokenDir = await mkdtemp(join(tmpdir(), 'imagen-kernel-broken-'))
      cleanup(brokenDir)
      const brokenPath = join(brokenDir, 'broken.py')
      await writeFile(
        brokenPath,
        'EMBEDDED_CONFIG_B64 = ""\nfrom anima_runtime import load_anima_runtime  # @@INLINE:no-such-module.py@@\n',
        'utf8',
      )
      await assert.rejects(
        () =>
          buildKernelFolder({
            username: 'tester',
            slug: 'bad00000',
            config,
            sourcePath: brokenPath,
            enableGpu: false,
          }),
        /读不到 remote\/no-such-module\.py/,
      )
    })

    await check('未配置 datasetSources 时保持空数组，旧调用签名兼容', async () => {
      const plainConfig = buildKernelConfig({
        presetId: 'sdxl-turbo',
        token: 'tok',
        topic: 'topic',
        idleTimeoutSec: 600,
      })
      assert.deepEqual(Object.keys(plainConfig).sort(), [
        'auth_token',
        'contract',
        'idle_timeout_sec',
        'log_level',
        'ntfy_topic',
        'preload',
        'preset_id',
        'version',
      ])

      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'deadbeef',
        config: plainConfig,
        enableGpu: false,
      })
      cleanup(folder.dir)
      const metadata = JSON.parse(await readFile(join(folder.dir, 'kernel-metadata.json'), 'utf8'))
      assert.deepEqual(metadata.dataset_sources, [])
      assert.equal(metadata.enable_gpu, false)
      const patched = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      assert.deepEqual(readInjectedConfig(patched), plainConfig)
    })

    await check('sourcePath 覆盖：探针脚本同样注入配置，且不引入内联内容', async () => {
      const sourceDir = await mkdtemp(join(tmpdir(), 'imagen-kernel-src-'))
      cleanup(sourceDir)
      const probePath = join(sourceDir, 'probe.py')
      const probeSource = '#!/usr/bin/env python3\nVERSION = "0.4.0-probe"\nEMBEDDED_CONFIG_B64 = ""\nprint("probe")\n'
      await writeFile(probePath, probeSource, 'utf8')
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'cafebabe',
        config,
        sourcePath: probePath,
        enableGpu: false,
      })
      cleanup(folder.dir)
      const patched = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      assert.match(patched, /print\("probe"\)/)
      assert.deepEqual(readInjectedConfig(patched), config)
      assert.doesNotMatch(patched, /@@INLINE:/)
      assert.doesNotMatch(patched, /def _anima_toolkit\(/)
      assert.equal(stripInjectedConfig(patched), probeSource)
    })

    await check('removeKernelFolder 清理临时目录（目录内含 Token 配置）', async () => {
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: '01234567',
        config,
        enableGpu: false,
      })
      await removeKernelFolder(folder.dir)
      await assert.rejects(() => readFile(join(folder.dir, 'daemon.py'), 'utf8'))
    })
  } finally {
    for (const dir of cleanups.reverse()) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})