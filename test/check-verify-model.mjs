#!/usr/bin/env node
/**
 * 模型验证脚本的离线回归：只跑配置校验、Kernel 打包演练与失败分类，不联网、不调 Kaggle。
 *
 * 另外校验 anima 运行时的单份维护链路：payload 源码只留 `@@INLINE` 标记，打包后必须
 * 内联成自包含单文件（Kaggle 只接受单个 code_file），且能通过 python 语法编译。
 *
 * 运行：node test/check-verify-model.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildKernelFolder, hasInlineMarkerLine, removeKernelFolder } from '../lib/kernel.js'
import { classifyFailure, payloadConfigOf } from '../tools/verify-model.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOL = join(ROOT, 'tools', 'verify-model.mjs')
const PAYLOAD_SOURCE = join(ROOT, 'tools', 'payload', 'verify-model.py')
const ANIMA_RUNTIME_SOURCE = join(ROOT, 'remote', 'anima_runtime.py')

const failures = []
let passed = 0

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
  }
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
function assertPythonSyntax(sourcePath) {
  const python = pythonCommand()
  if (!python) {
    console.log('  （跳过 python 语法编译：本机没有 python / python3）')
    return
  }
  const script =
    'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")'
  const result = spawnSync(python, ['-c', script, sourcePath], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`python 语法编译失败：${result.stderr || result.stdout}`)
}

/** 在临时目录里 import 打包产物（只执行模块顶层），验证 payload 真的自包含。 */
function assertPythonImports(sourcePath, symbolNames) {
  const python = pythonCommand()
  if (!python) {
    console.log('  （跳过 python 导入自检：本机没有 python / python3）')
    return
  }
  const script = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("packaged_payload", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'missing = [name for name in sys.argv[2:] if not hasattr(module, name)]',
    'sys.exit("缺少符号: " + ",".join(missing) if missing else 0)',
  ].join('\n')
  const result = spawnSync(python, ['-c', script, sourcePath, ...symbolNames], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: tmpdir(),
  })
  if (result.status !== 0) throw new Error(`python 隔离导入失败（未自包含）：${result.stderr || result.stdout}`)
}

function validModel() {
  return {
    id: 'dryrun-model',
    label: '离线演练模型',
    repo: 'test/model',
    params: 'test',
    license: 'MIT',
    licenseKind: 'open',
    gated: false,
    gpus: 1,
    tier: 'fast',
    size: 512,
    steps: 4,
    cfg: 0,
    negativeHint: '',
    sizeOptions: [512],
    runtime: 'default',
    pipeline: {
      loader: 'sdxl',
      base: 'test/model',
      lora: null,
      scheduler: null,
      variant: 'fp16',
      downloadGb: 1,
      allowPatterns: null,
      deviceMap: null,
    },
  }
}

function runTool(args) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  })
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'imagen-verify-test-'))
  try {
    const validPath = join(dir, 'dryrun-model.json')
    await writeFile(validPath, `${JSON.stringify(validModel(), null, 2)}\n`, 'utf8')
    const valid = runTool(['--config', validPath, '--dry-run'])
    check('dry-run 通过：配置校验与 Kernel 打包演练都成功', () => {
      if (valid.status !== 0) throw new Error(`退出码 ${valid.status}\n${valid.stdout}\n${valid.stderr}`)
      if (!valid.stdout.includes('dry-run')) throw new Error(`输出缺少 dry-run 标记\n${valid.stdout}`)
      if (!valid.stdout.includes('Kernel 打包演练通过')) throw new Error(`输出缺少打包结果\n${valid.stdout}`)
    })

    await check('payload 源码保持单份真源：只留 anima_runtime 内联标记', async () => {
      const source = await readFile(PAYLOAD_SOURCE, 'utf8')
      if (source.match(/@@INLINE:/g)?.length !== 1) throw new Error('payload 应只有一处 @@INLINE 标记')
      if (/^def _anima_toolkit\(/m.test(source)) throw new Error('payload 仍内嵌 _anima_toolkit 实现')
      if (/^def load_anima_runtime\(/m.test(source)) throw new Error('payload 仍内嵌 load_anima_runtime 实现')
      const runtime = await readFile(ANIMA_RUNTIME_SOURCE, 'utf8')
      if (!runtime.includes('def load_anima_runtime(')) throw new Error('remote/anima_runtime.py 缺少 load_anima_runtime')
    })

    await check('打包后的 payload 自包含：运行时只内联一份、python 语法可编译', async () => {
      const folder = await buildKernelFolder({
        username: 'dry-run-user',
        slug: 'payload0',
        config: payloadConfigOf(validModel()),
        sourcePath: PAYLOAD_SOURCE,
      })
      const packagedPath = join(folder.dir, 'daemon.py')
      try {
        const source = await readFile(packagedPath, 'utf8')
        if (/^[ \t]*from anima_runtime import /m.test(source)) {
          throw new Error('打包后的 payload 仍含未解析的 anima_runtime import 行')
        }
        if (hasInlineMarkerLine(source)) throw new Error('打包后的 payload 仍有未处理的 @@INLINE 标记')
        const runtimeDefs = source.match(/^def load_anima_runtime\(/gm) ?? []
        if (runtimeDefs.length !== 1) throw new Error(`load_anima_runtime 定义 ${runtimeDefs.length} 份，应为 1 份`)
        assertPythonSyntax(packagedPath)
        assertPythonImports(packagedPath, ['load_anima_runtime', 'load_pipe', 'main'])
      } finally {
        await removeKernelFolder(folder.dir)
      }
    })

    const broken = { ...validModel() }
    delete broken.pipeline
    const brokenPath = join(dir, 'broken.json')
    await writeFile(brokenPath, `${JSON.stringify(broken, null, 2)}\n`, 'utf8')
    const brokenRun = runTool(['--config', brokenPath, '--dry-run'])
    check('缺少 pipeline 时非零退出并给出可读原因', () => {
      if (brokenRun.status === 0) throw new Error('应当失败却退出 0')
      if (!/配置缺少 pipeline/.test(brokenRun.stderr)) throw new Error(`未给出原因：\n${brokenRun.stderr}`)
    })

    check('缺少 --config 时非零退出', () => {
      const noConfig = runTool(['--dry-run'])
      if (noConfig.status === 0) throw new Error('应当失败却退出 0')
      if (!/缺少 --config/.test(noConfig.stderr)) throw new Error(`未提示 --config：\n${noConfig.stderr}`)
    })

    check('payloadConfigOf 只下发验证需要的字段', () => {
      const config = payloadConfigOf(validModel())
      for (const key of ['id', 'pipeline', 'size', 'steps', 'cfg', 'negativeHint', 'prompt', 'seed']) {
        if (!(key in config)) throw new Error(`缺少 ${key}`)
      }
      if (config.pipeline.base !== 'test/model') throw new Error('pipeline 未原样下发')
    })

    check('失败分类：pip 冲突 / OOM / 磁盘 / 超时 / 兜底', () => {
      const cases = [
        ['pip_conflict', 'ERROR: Could not find a version that satisfies the requirement transformers<5'],
        ['cuda_oom', 'torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 72.00 MiB'],
        ['disk_full', 'OSError: [Errno 28] No space left on device'],
        ['timeout', '等待超时（30 分钟）'],
        ['download_failed', "Cannot find the requested files: Repository Not Found"],
        ['kernel_error', '一些没有归因的普通错误'],
      ]
      for (const [expected, text] of cases) {
        const actual = classifyFailure(text)
        if (actual !== expected) throw new Error(`${text} → ${actual}，期望 ${expected}`)
      }
    })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  console.log(`\n${passed}/${passed + failures.length} 通过`)
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})