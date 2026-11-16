/**
 * Kernel 目录打包测试（不联网、不调 kaggle CLI）。
 *
 * 覆盖源码包打包链路：
 *   - lib/bundle.js：确定性 ZIP（CRC / deflate / 排序 / 固定时间戳）、路径校验、条目收集；
 *   - lib/kernel.js：dataset_sources 合法项写入、metadata 结构合法、配置以 base64 注入启动器、
 *     remote/ 整包内嵌（含 contract.json）、extraFiles 附加、脚本模式（探针）只注入配置、
 *     模板占位符缺失时给可读错误、临时目录可清理；
 *   - 产物可用性：ZIP 能通过 Python zipfile 校验、解包后 `import remote.daemon` 成功、
 *     启动器本身语法编译通过且导入无副作用。
 *
 * 运行：node test/kernel-package.mjs
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBundle, collectBundleEntries, crc32, createZip } from '../lib/bundle.js'
import { buildKernelFolder, normalizeDatasetSources, removeKernelFolder } from '../lib/kernel.js'
import { buildKernelConfig } from '../lib/session/provisioner.js'
import { VERSION } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'
import { assertPythonImports, assertPythonSyntax, inspectZip, pythonCommand } from './helpers/python-check.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REMOTE_DIR = join(ROOT, 'remote')

const { check, summary } = createCheckRunner()

/** 从打包产物里取出注入配置（base64 JSON）。 */
function readInjectedConfig(source) {
  const match = source.match(/^EMBEDDED_CONFIG_B64 = "([^"]*)"$/m)
  assert.ok(match, 'daemon.py 缺少 EMBEDDED_CONFIG_B64 注入行')
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

/** 从打包产物里取出源码包。 */
function readBundle(source) {
  const match = source.match(/^BUNDLE_B64 = "([^"]*)"$/m)
  assert.ok(match, 'daemon.py 缺少 BUNDLE_B64 源码包')
  return Buffer.from(match[1], 'base64')
}

/** 只把注入行抹平，用于比较「除配置外是否逐字一致」。 */
function stripInjectedConfig(source) {
  assert.match(source, /^EMBEDDED_CONFIG_B64 = "[A-Za-z0-9+/=]*"$/m, '注入行格式不正确')
  return source.replace(/^EMBEDDED_CONFIG_B64 = "[A-Za-z0-9+/=]*"$/m, 'EMBEDDED_CONFIG_B64 = ""')
}

/** 解包后真实导入包内模块，证明产物离开仓库也能跑。 */
function importBundledDaemon(entryPath) {
  const python = pythonCommand()
  if (!python) return null
  const script = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("entry_under_test", sys.argv[1])',
    'stub = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = stub',
    'spec.loader.exec_module(stub)',
    'root = stub.unpack()',
    'import remote.daemon as daemon',
    'assert hasattr(daemon, "main"), "缺少 main"',
    'assert hasattr(daemon, "validate_generate_spec"), "缺少 validate_generate_spec"',
    'assert hasattr(daemon, "set_embedded_config"), "缺少配置注入入口"',
    'daemon.set_embedded_config("probe")',
    'assert daemon.EMBEDDED_CONFIG_B64 == "probe", "配置注入未落到底层模块"',
    'print(root)',
  ].join('\n')
  const result = spawnSync(python, ['-c', script, entryPath], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`解包后导入失败：${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

async function main() {
  const cleanups = []
  const cleanup = (dir) => {
    if (dir) cleanups.push(dir)
  }

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

    await check('crc32 与 zlib 标准向量一致', () => {
      // 空串 0、'a' 0xe8b7be43、'123456789' 0xcbf43926。
      assert.equal(crc32(Buffer.alloc(0)), 0)
      assert.equal(crc32(Buffer.from('a')), 0xe8b7be43)
      assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
    })

    await check('createZip 拒绝空归档与越界路径', () => {
      assert.throws(() => createZip([]), /不能为空/)
      assert.throws(() => createZip([{ name: '../escape.py', data: 'x' }]), /非法的归档路径/)
      assert.throws(() => createZip([{ name: '/abs.py', data: 'x' }]), /非法的归档路径/)
    })

    await check('源码包确定性：同样输入产出同样字节', async () => {
      const first = await buildBundle()
      const second = await buildBundle()
      assert.equal(first.digest, second.digest)
      assert.equal(Buffer.compare(first.bytes, second.bytes), 0)
      assert.ok(first.files.includes('remote/daemon.py'), '源码包缺少 daemon.py')
      assert.ok(first.files.includes('remote/contract.json'), '源码包缺少契约兜底文件')
      assert.ok(!first.files.some((name) => name.includes('_entry.py')), '启动器模板不该进源码包')
      assert.ok(!first.files.some((name) => name.includes('__pycache__')), '__pycache__ 不该进源码包')
    })

    await check('collectBundleEntries 收录 remote/ 下全部 .py 与 contract.json', async () => {
      const entries = await collectBundleEntries()
      const names = entries.map((entry) => entry.name)
      const expected = (await readdir(REMOTE_DIR))
        .filter((name) => name.endsWith('.py') && name !== '_entry.py')
        .map((name) => `remote/${name}`)
      for (const name of expected) assert.ok(names.includes(name), `漏收 ${name}`)
      assert.ok(names.includes('remote/contract.json'), '漏收 remote/contract.json')
      await assert.rejects(
        () => collectBundleEntries({ extraFiles: [{ from: join(ROOT, 'no-such.py'), to: 'x.py' }] }),
        /读取失败/,
      )
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
      assert.ok(folder.bundle && folder.bundle.files >= 8, '源码包条目数异常')

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
      assert.match(patched, /^ENTRY_MODULE = "remote\.daemon"$/m)
      assert.ok(readBundle(patched).subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), '源码包不是 ZIP')
      assert.ok(!patched.includes('@@INLINE'), '产物仍含内联标记')
    })

    await check('源码包只随源码变化：不同会话配置的产物除注入行外逐字一致', async () => {
      const first = await buildKernelFolder({ username: 'tester', slug: 'same1', config, enableGpu: false })
      const second = await buildKernelFolder({
        username: 'tester',
        slug: 'same2',
        config: { ...config, auth_token: 'another-token' },
        enableGpu: false,
      })
      cleanup(first.dir)
      cleanup(second.dir)
      const left = stripInjectedConfig(await readFile(join(first.dir, 'daemon.py'), 'utf8'))
      const right = stripInjectedConfig(await readFile(join(second.dir, 'daemon.py'), 'utf8'))
      assert.equal(left, right)
    })

    await check('归档可被 Python zipfile 校验，条目与 remote/ 一致', async () => {
      const folder = await buildKernelFolder({ username: 'tester', slug: 'zipcheck', config, enableGpu: false })
      cleanup(folder.dir)
      const source = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      const zipPath = join(folder.dir, 'bundle.zip')
      await writeFile(zipPath, readBundle(source))

      const report = inspectZip(zipPath)
      if (!report) {
        console.log('  （跳过 zipfile 校验：本机没有 python / python3）')
        return
      }
      assert.equal(report.bad, null, '归档损坏')
      const names = report.names
      assert.ok(names.includes('remote/daemon.py'))
      assert.ok(names.includes('remote/contract.json'))
      assert.ok(names.includes('remote/__init__.py'))
      for (const module of ['log_ring', 'pipeline_loader', 'cache_ops', 'anima_runtime', 'tunnel']) {
        assert.ok(names.includes(`remote/${module}.py`), `归档缺少 ${module}.py`)
      }
      assert.deepEqual([...names].sort(), names, '归档条目未按路径排序')
    })

    await check('打包产物自包含：启动器语法编译通过、解包后能 import remote.daemon', async () => {
      const folder = await buildKernelFolder({ username: 'tester', slug: 'a1b2c3d4', config, enableGpu: false })
      cleanup(folder.dir)
      const entryPath = join(folder.dir, 'daemon.py')
      assertPythonSyntax(entryPath)
      assertPythonImports(entryPath, ['unpack', 'run', 'EMBEDDED_CONFIG_B64', 'BUNDLE_B64'], 'entry_import')

      const root = importBundledDaemon(entryPath)
      if (root === null) {
        console.log('  （跳过解包导入：本机没有 python / python3）')
      } else {
        assert.ok(root.length > 0, 'unpack 未返回解压目录')
      }
    })

    await check('端到端：启动器解包 → 导入入口 → 注入配置 → 执行 main', async () => {
      const python = pythonCommand()
      if (!python) {
        console.log('  （跳过端到端启动：本机没有 python / python3）')
        return
      }
      const modDir = await mkdtemp(join(tmpdir(), 'imagen-probe-mod-'))
      cleanup(modDir)
      const probeModule = join(modDir, 'probe_entry.py')
      await writeFile(
        probeModule,
        [
          'EMBEDDED_CONFIG_B64 = ""',
          '',
          '',
          'def set_embedded_config(value):',
          '    global EMBEDDED_CONFIG_B64',
          '    EMBEDDED_CONFIG_B64 = value',
          '',
          '',
          'def main():',
          '    assert EMBEDDED_CONFIG_B64, "启动器没有注入配置"',
          '    import base64, json',
          '    config = json.loads(base64.b64decode(EMBEDDED_CONFIG_B64).decode("utf-8"))',
          '    assert config["auth_token"] == "tok-test", "注入的配置内容不对"',
          '    print("PROBE_MAIN_OK")',
          '',
        ].join('\n'),
        'utf8',
      )
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'e2e00001',
        config,
        entryModule: 'probe_entry',
        extraFiles: [{ from: probeModule, to: 'probe_entry.py' }],
        enableGpu: false,
      })
      cleanup(folder.dir)
      const run = spawnSync(python, [join(folder.dir, 'daemon.py')], { encoding: 'utf8', windowsHide: true })
      assert.equal(run.status, 0, `启动器退出码 ${run.status}
${run.stderr || run.stdout}`)
      assert.match(run.stdout, /\[bundle\] 源码包已解压：/)
      assert.match(run.stdout, /PROBE_MAIN_OK/)
    })

    await check('extraFiles：验证 payload 作为包内模块一起打进归档', async () => {
      const folder = await buildKernelFolder({
        username: 'tester',
        slug: 'payload1',
        config,
        entryModule: 'payload.verify_model',
        extraFiles: [{ from: join(ROOT, 'tools', 'payload', 'verify-model.py'), to: 'payload/verify_model.py' }],
        enableGpu: false,
      })
      cleanup(folder.dir)
      const source = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      assert.match(source, /^ENTRY_MODULE = "payload\.verify_model"$/m)
      const zipPath = join(folder.dir, 'bundle.zip')
      await writeFile(zipPath, readBundle(source))
      const report = inspectZip(zipPath)
      if (!report) {
        console.log('  （跳过 zipfile 校验：本机没有 python / python3）')
        return
      }
      assert.ok(report.names.includes('payload/verify_model.py'), '归档缺少 payload 模块')
      assert.equal(report.bad, null, '归档损坏')
    })

    await check('scriptPath 覆盖：探针脚本只注入配置，不引入源码包', async () => {
      const probeDir = await mkdtemp(join(tmpdir(), 'imagen-probe-'))
      cleanup(probeDir)
      const probePath = join(probeDir, 'probe.py')
      const probeSource = '#!/usr/bin/env python3\nVERSION = "0.4.0-probe"\nEMBEDDED_CONFIG_B64 = ""\nprint("probe")\n'
      await writeFile(probePath, probeSource, 'utf8')

      const folder = await buildKernelFolder({ username: 'tester', slug: 'cafebabe', config, sourcePath: probePath })
      cleanup(folder.dir)
      const patched = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
      assert.equal(folder.bundle, null, '脚本模式不该产出源码包')
      assert.match(patched, /print\("probe"\)/)
      assert.doesNotMatch(patched, /@@INLINE:/)
      assert.doesNotMatch(patched, /def _anima_toolkit\(/)
      assert.equal(stripInjectedConfig(patched), probeSource)
      assert.deepEqual(readInjectedConfig(patched), config)
      assertPythonSyntax(join(folder.dir, 'daemon.py'))
    })

    await check('scriptPath 缺少占位行时给出可读错误', async () => {
      const probeDir = await mkdtemp(join(tmpdir(), 'imagen-probe-'))
      cleanup(probeDir)
      const brokenPath = join(probeDir, 'broken.py')
      await writeFile(brokenPath, 'print("no placeholder")\n', 'utf8')
      await assert.rejects(
        () => buildKernelFolder({ username: 'tester', slug: 'bad00000', config, sourcePath: brokenPath }),
        /缺少可注入的 EMBEDDED_CONFIG_B64 占位行/,
      )
    })

    await check('启动器模板占位符唯一且导入无副作用', async () => {
      const template = await readFile(join(REMOTE_DIR, '_entry.py'), 'utf8')
      for (const placeholder of ['"@@CONFIG_B64@@"', '"@@BUNDLE_B64@@"', '"@@ENTRY_MODULE@@"']) {
        assert.equal(template.split(placeholder).length - 1, 1, `模板占位符 ${placeholder} 应恰好 1 处`)
      }
      assert.match(template, /if __name__ == "__main__":/, '模板缺少 __main__ 保护，导入时不能有副作用')
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
        'claim_timeout_sec',
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

    await check('removeKernelFolder 清理临时目录（目录内含 Token 配置）', async () => {
      const folder = await buildKernelFolder({ username: 'tester', slug: '01234567', config, enableGpu: false })
      await removeKernelFolder(folder.dir)
      assert.equal(await stat(folder.dir).catch(() => null), null)
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
