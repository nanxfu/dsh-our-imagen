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
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildKernelFolder, hasInlineMarkerLine, normalizeDatasetSources, removeKernelFolder } from '../lib/kernel.js'
import { buildKernelConfig } from '../lib/session/provisioner.js'
import { VERSION } from '../shared/contract.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON_SOURCE = join(ROOT, 'remote', 'daemon.py')
const ANIMA_RUNTIME_SOURCE = join(ROOT, 'remote', 'anima_runtime.py')

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

/** 本机可用的 python 命令；没有就返回 null（语法编译按任务约定跳过并注明）。 */
function pythonCommand() {
  for (const name of ['python', 'python3']) {
    const result = spawnSync(name, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (result.status === 0) return name
  }
  return null
}

/** 用 python 的 compile() 做语法检查（只编译不执行，不 import torch）。 */
function assertPythonSyntax(filePath) {
  const python = pythonCommand()
  if (!python) {
    console.log('  （跳过 python 语法编译：本机没有 python / python3）')
    return
  }
  const script =
    'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")'
  const result = spawnSync(python, ['-c', script, filePath], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `python 语法编译失败：${result.stderr || result.stdout}`)
}

/**
 * 在临时目录里 import 打包产物，验证它确实是单文件自包含。
 *
 * 只执行模块顶层代码（daemon / payload 都只在 `if __name__ == "__main__"` 里启动），
 * 不 import torch、不联网；模块自身若还有未内联的本地依赖会直接 ImportError。
 */
function assertPythonImports(filePath, symbolNames) {
  const python = pythonCommand()
  if (!python) {
    console.log('  （跳过 python 导入自检：本机没有 python / python3）')
    return
  }
  const script = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("packaged_under_test", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'missing = [name for name in sys.argv[2:] if not hasattr(module, name)]',
    'sys.exit("缺少符号: " + ",".join(missing) if missing else 0)',
  ].join('\n')
  const result = spawnSync(python, ['-c', script, filePath, ...symbolNames], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: tmpdir(),
  })
  assert.equal(result.status, 0, `python 隔离导入失败（未自包含）：${result.stderr || result.stdout}`)
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
      const runtimeSource = await readFile(ANIMA_RUNTIME_SOURCE, 'utf8')
      const markerLineRe = /^[ \t]*from anima_runtime import [^\n]*#\s*@@INLINE:anima_runtime\.py@@[ \t]*$/m
      assert.match(daemonSource, markerLineRe, 'remote/daemon.py 缺少 anima_runtime 内联标记行')
      const expectedSource = daemonSource.replace(markerLineRe, () => runtimeSource.trimEnd())
      assert.equal(stripInjectedConfig(patched), expectedSource)
      assert.equal(patched.match(/^VERSION = "([^"]+)"$/m)?.[1], VERSION)
    })

    await check('打包产物自包含：anima 运行时只内联一份、无残留标记', async () => {
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'a1b2c3d4',
        config,
        enableGpu: false,
      })
      cleanup(folder.dir)
      const patched = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      assert.doesNotMatch(patched, /^[ \t]*from anima_runtime import /m, '仍有未解析的 anima_runtime import 行')
      assert.equal(hasInlineMarkerLine(patched), false, '仍有未处理的 @@INLINE 标记')
      assert.equal(patched.match(/^def _anima_toolkit\(/gm)?.length, 1, '_anima_toolkit 应恰好一份')
      assert.equal(patched.match(/^def load_anima_runtime\(/gm)?.length, 1, 'load_anima_runtime 应恰好一份')
      const runtimeSource = await readFile(ANIMA_RUNTIME_SOURCE, 'utf8')
      assert.ok(patched.includes(runtimeSource.trimEnd()), '产物未包含 remote/anima_runtime.py 全文')
      assertPythonSyntax(join(folder.dir, 'daemon.py'))
      // 隔离目录内 import：产物不依赖 remote/ 目录，证明是真的单文件自包含。
      assertPythonImports(join(folder.dir, 'daemon.py'), ['load_anima_runtime', 'build_pipeline', 'main'])
    })

    await check('源文件保持单份真源：daemon.py 不再复制 anima 运行时', async () => {
      assert.equal(daemonSource.match(/@@INLINE:/g)?.length, 1, 'remote/daemon.py 应只有一处内联标记')
      assert.doesNotMatch(daemonSource, /^def _anima_toolkit\(/m)
      assert.doesNotMatch(daemonSource, /^def load_anima_runtime\(/m)
      const runtimeSource = await readFile(ANIMA_RUNTIME_SOURCE, 'utf8')
      assert.match(runtimeSource, /^def _anima_toolkit\(/m)
      assert.match(runtimeSource, /^def load_anima_runtime\(/m)
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

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})