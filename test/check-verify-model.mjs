#!/usr/bin/env node
/**
 * 模型验证脚本的离线回归：只跑配置校验、Kernel 打包演练与失败分类，不联网、不调 Kaggle。
 *
 * 运行：node test/check-verify-model.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyFailure, payloadConfigOf } from '../tools/verify-model.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOL = join(ROOT, 'tools', 'verify-model.mjs')

const failures = []
let passed = 0

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
  }
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