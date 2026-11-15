#!/usr/bin/env node
/**
 * 模型验证脚本的离线回归：只跑配置校验、Kernel 打包演练与失败分类，不联网、不调 Kaggle。
 *
 * 另外校验共享源码链路：payload 与 daemon 复用同一份 remote/ 源码包，打包后 payload 作为
 * 包内模块与 remote/ 一起内嵌进启动器（Kaggle 只接受单个 code_file），产物能通过 python 编译。
 *
 * 运行：node test/check-verify-model.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildKernelFolder, removeKernelFolder } from '../lib/kernel.js'
import { classifyFailure, payloadConfigOf } from '../tools/verify-model.mjs'
import { createCheckRunner } from './helpers/check.mjs'
import { assertPythonImports, assertPythonSyntax, inspectZip } from './helpers/python-check.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOL = join(ROOT, 'tools', 'verify-model.mjs')
const PAYLOAD_SOURCE = join(ROOT, 'tools', 'payload', 'verify-model.py')
const ANIMA_RUNTIME_SOURCE = join(ROOT, 'remote', 'anima_runtime.py')
const PIPELINE_LOADER_SOURCE = join(ROOT, 'remote', 'pipeline_loader.py')

const { check, summary } = createCheckRunner()

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
    await check('dry-run 通过：配置校验与 Kernel 打包演练都成功', () => {
      if (valid.status !== 0) throw new Error(`退出码 ${valid.status}\n${valid.stdout}\n${valid.stderr}`)
      if (!valid.stdout.includes('dry-run')) throw new Error(`输出缺少 dry-run 标记\n${valid.stdout}`)
      if (!valid.stdout.includes('Kernel 打包演练通过')) throw new Error(`输出缺少打包结果\n${valid.stdout}`)
    })

    await check('payload 源码不再内嵌共享实现，改为从源码包导入', async () => {
      const source = await readFile(PAYLOAD_SOURCE, 'utf8')
      if (source.includes('@@INLINE')) throw new Error('payload 仍有 @@INLINE 标记')
      if (/^def _anima_toolkit\(/m.test(source)) throw new Error('payload 仍内嵌 _anima_toolkit 实现')
      if (/^def load_anima_runtime\(/m.test(source)) throw new Error('payload 仍内嵌 load_anima_runtime 实现')
      if (/^def load_diffusers_pipeline\(/m.test(source)) {
        throw new Error('payload 仍内嵌 load_diffusers_pipeline 实现')
      }
      if (!/^from anima_runtime import /m.test(source)) throw new Error('payload 未从源码包导入 anima 运行时')
      if (!/^from pipeline_loader import /m.test(source)) throw new Error('payload 未从源码包导入 Loader')
      const runtime = await readFile(ANIMA_RUNTIME_SOURCE, 'utf8')
      if (!runtime.includes('def load_anima_runtime(')) throw new Error('remote/anima_runtime.py 缺少 load_anima_runtime')
      const loader = await readFile(PIPELINE_LOADER_SOURCE, 'utf8')
      if (!loader.includes('def load_diffusers_pipeline(')) {
        throw new Error('remote/pipeline_loader.py 缺少 load_diffusers_pipeline')
      }
    })

    await check('打包后的 payload 自包含：remote 与 payload 一起进归档、python 可编译', async () => {
      const folder = await buildKernelFolder({
        username: 'dry-run-user',
        slug: 'payload0',
        config: payloadConfigOf(validModel()),
        entryModule: 'payload.verify_model',
        extraFiles: [{ from: PAYLOAD_SOURCE, to: 'payload/verify_model.py' }],
      })
      const packagedPath = join(folder.dir, 'daemon.py')
      try {
        const source = await readFile(packagedPath, 'utf8')
        if (source.includes('@@INLINE')) throw new Error('打包后的 payload 仍有 @@INLINE 标记')
        if (!source.includes('"payload.verify_model"')) throw new Error('入口模块不是 payload.verify_model')
        const bundleMatch = source.match(/^BUNDLE_B64 = "([^"]*)"$/m)
        if (!bundleMatch) throw new Error('打包后的 payload 缺少源码包')
        const zipPath = join(folder.dir, 'bundle.zip')
        await writeFile(zipPath, Buffer.from(bundleMatch[1], 'base64'))
        const report = inspectZip(zipPath)
        if (!report) {
          console.log('  （跳过 zipfile 校验：本机没有 python / python3）')
        } else {
          if (report.bad) throw new Error(`归档损坏：${report.bad}`)
          for (const name of ['remote/anima_runtime.py', 'remote/pipeline_loader.py', 'payload/verify_model.py']) {
            if (!report.names.includes(name)) throw new Error(`归档缺少 ${name}`)
          }
        }
        assertPythonSyntax(packagedPath)
        assertPythonImports(packagedPath, ['unpack', 'run'], 'packaged_payload')
      } finally {
        await removeKernelFolder(folder.dir)
      }
    })

    const broken = { ...validModel() }
    delete broken.pipeline
    const brokenPath = join(dir, 'broken.json')
    await writeFile(brokenPath, `${JSON.stringify(broken, null, 2)}\n`, 'utf8')
    const brokenRun = runTool(['--config', brokenPath, '--dry-run'])
    await check('缺少 pipeline 时非零退出并给出可读原因', () => {
      if (brokenRun.status === 0) throw new Error('应当失败却退出 0')
      if (!/配置缺少 pipeline/.test(brokenRun.stderr)) throw new Error(`未给出原因：\n${brokenRun.stderr}`)
    })

    await check('缺少 --config 时非零退出', () => {
      const noConfig = runTool(['--dry-run'])
      if (noConfig.status === 0) throw new Error('应当失败却退出 0')
      if (!/缺少 --config/.test(noConfig.stderr)) throw new Error(`未提示 --config：\n${noConfig.stderr}`)
    })

    await check('payloadConfigOf 只下发验证需要的字段', () => {
      const config = payloadConfigOf(validModel())
      for (const key of ['id', 'pipeline', 'size', 'steps', 'cfg', 'negativeHint', 'prompt', 'seed']) {
        if (!(key in config)) throw new Error(`缺少 ${key}`)
      }
      if (config.pipeline.base !== 'test/model') throw new Error('pipeline 未原样下发')
    })

    await check('失败分类：pip 冲突 / OOM / 磁盘 / 超时 / 兜底', () => {
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

  summary()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})