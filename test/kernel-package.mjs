/**
 * Kernel 目录打包测试（不联网、不调 kaggle CLI）。
 *
 * 覆盖 P2.1 的注入链路：
 *   - lib/kernel.js：dataset_sources 合法项写入、非法项过滤、metadata 结构合法、
 *     config 以 base64 注入 daemon.py 的 EMBEDDED_CONFIG_B64 行且其余内容不变、
 *     临时目录可清理；
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

import { buildKernelFolder, normalizeDatasetSources, removeKernelFolder } from '../lib/kernel.js'
import { buildKernelConfig } from '../lib/session/provisioner.js'
import { VERSION } from '../shared/contract.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON_SOURCE = join(ROOT, 'remote', 'daemon.py')

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

/** 只替换注入行，其余内容必须与源文件逐字一致。 */
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

      // 注入只改一行：其余内容必须与 remote/daemon.py 逐字一致（daemon VERSION 也保持）
      assert.equal(stripInjectedConfig(patched), daemonSource)
      assert.equal(patched.match(/^VERSION = "([^"]+)"$/m)?.[1], VERSION)
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

    await check('sourcePath 覆盖：探针脚本同样注入配置', async () => {
      const sourceDir = await mkdtemp(join(tmpdir(), 'imagen-kernel-src-'))
      cleanup(sourceDir)
      const probePath = join(sourceDir, 'probe.py')
      await writeFile(
        probePath,
        '#!/usr/bin/env python3\nVERSION = "0.4.0-probe"\nEMBEDDED_CONFIG_B64 = ""\nprint("probe")\n',
        'utf8',
      )
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