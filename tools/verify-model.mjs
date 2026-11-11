#!/usr/bin/env node
/**
 * 模型验证：把单个模型 JSON 打包成一次性 Kaggle Kernel，实跑采样并回填 measured。
 *
 * 流程：
 *   1. 读取并校验模型配置（支持 .tmp 草稿与 models/ 下的正式文件）；
 *   2. buildKernelFolder 把 tools/payload/verify-model.py 与配置注入打包；
 *   3. pushKernel 推送，轮询 kernelStatus 直到结束；
 *   4. 下载产物，校验 PNG 文件头，打印体检数据；
 *   5. --write 时把 measured 就地写回配置。
 *
 * 用法：
 *   node tools/verify-model.mjs --config .tmp/models/xxx.json [--write] [--timeout 30]
 *   node tools/verify-model.mjs --config models/sdxl-lightning.json --dry-run
 *
 * 失败分类：pip_conflict / cuda_oom / import_error / download_failed / disk_full /
 *           invalid_config / timeout / auth_required / push_failed / kernel_error
 */

import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TIMEOUTS } from '../shared/contract.js'
import { downloadKernelOutput, kaggleUsername, kernelLogs, kernelStatus, pushKernel } from '../lib/kaggle.js'
import { buildKernelFolder, hasInlineMarkerLine, randomSlug, removeKernelFolder } from '../lib/kernel.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PAYLOAD_SOURCE = join(ROOT, 'tools', 'payload', 'verify-model.py')
const WORK_DIR = join(ROOT, '.tmp', 'verify')

const PROMPT =
  'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail'
const ACCELERATOR = 'NvidiaTeslaT4'
const DEFAULT_TIMEOUT_MIN = 30
const POLL_MS = 15000
const TERMINAL_STATES = new Set(['COMPLETE', 'ERROR', 'CANCEL_ACKNOWLEDGED'])
const VALID_LOADERS = new Set(['sdxl', 'sdxl-lora', 'flux2', 'anima'])

// ── 失败分类（导出给测试用） ─────────────────────────────────────────────

const FAILURE_RULES = [
  ['pip_conflict', /ResolutionImpossible|Could not find a version that satisfies|No matching distribution|pip install 失败|pip install 退出码|ERROR: Cannot install/i],
  ['disk_full', /No space left on device/i],
  ['cuda_oom', /OutOfMemoryError|CUDA out of memory|CUBLAS_STATUS_ALLOC_FAILED|insufficient memory/i],
  ['import_error', /ModuleNotFoundError|ImportError|undefined symbol|libcudart|libc10/i],
  ['download_failed', /ConnectionError|ConnectTimeout|ReadTimeout|Couldn't connect|Repository Not Found|401 Client Error|Network is unreachable/i],
  ['invalid_config', /KeyError|未知 loader|pipeline\.base 为空|缺少字段/i],
  ['timeout', /timeout|超时/i],
]

/** 按日志文本归因；没有命中具体规则时落到 kernel_error。 */
export function classifyFailure(text) {
  const value = String(text ?? '')
  for (const [code, pattern] of FAILURE_RULES) {
    if (pattern.test(value)) return code
  }
  return 'kernel_error'
}

// ── CLI 参数 ──────────────────────────────────────────────────────────────

function usage() {
  return [
    '用法：node tools/verify-model.mjs --config <模型 JSON> [选项]',
    '',
    '  --config <path>   必选：模型 JSON 路径（.tmp 草稿或 models/ 下的文件）',
    '  --write           验证成功后把 measured 写回该 JSON',
    '  --dry-run         只校验配置并打包 Kernel 目录，不调用 Kaggle CLI',
    '  --timeout <min>   整体超时，默认 30 分钟',
    '  --help            显示本帮助',
  ].join('\n')
}

export function parseArgs(argv) {
  const options = { config: null, write: false, dryRun: false, timeoutMin: DEFAULT_TIMEOUT_MIN }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      options.config = argv[index + 1]
      index += 1
    } else if (arg === '--write') {
      options.write = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--timeout') {
      const value = Number(argv[index + 1])
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout 需要正数（分钟）')
      options.timeoutMin = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (!arg.startsWith('--') && !options.config) {
      options.config = arg
    } else {
      throw new Error(`无法识别的参数：${arg}`)
    }
  }
  if (options.help) return options
  if (!options.config) throw new Error('缺少 --config <模型 JSON 路径>')
  return options
}

// ── 配置校验 ──────────────────────────────────────────────────────────────

/** 读取并校验模型配置。草稿允许没有 measured；正式数据由 build-assets 另行校验。 */
export async function loadModelConfig(relativePath) {
  const absolute = resolve(process.cwd(), relativePath)
  let text
  try {
    text = await readFile(absolute, 'utf8')
  } catch (error) {
    throw new Error(`读不到模型配置 ${relativePath}：${error?.message ?? error}`)
  }
  let model
  try {
    model = JSON.parse(text)
  } catch (error) {
    throw new Error(`${relativePath} 不是合法 JSON：${error?.message ?? error}`)
  }
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error(`${relativePath} 必须是 JSON 对象`)
  if (typeof model.id !== 'string' || !model.id.trim()) throw new Error('配置缺少 id')

  const pipeline = model.pipeline
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline)) throw new Error('配置缺少 pipeline')
  if (!VALID_LOADERS.has(pipeline.loader)) {
    throw new Error(`pipeline.loader 不支持：${pipeline.loader}（可选 ${[...VALID_LOADERS].join(' / ')}）`)
  }
  if (typeof pipeline.base !== 'string' || !pipeline.base.trim()) throw new Error('pipeline.base 为空')
  if (pipeline.loader === 'sdxl-lora') {
    const lora = pipeline.lora || {}
    if (!lora.repo || !lora.weight) throw new Error('sdxl-lora 需要 pipeline.lora.repo 与 pipeline.lora.weight')
  }
  if (pipeline.loader === 'anima') {
    // 单文件 DiT + 独立文本编码器/VAE/分词器：缺任何一项远端都加载不起来，提前拦下。
    if (typeof pipeline.weight !== 'string' || !pipeline.weight.trim()) {
      throw new Error('anima 需要 pipeline.weight（DiT 单文件权重名）')
    }
    const textEncoder = pipeline.textEncoder || {}
    if (!textEncoder.repo || !textEncoder.weight) {
      throw new Error('anima 需要 pipeline.textEncoder.repo 与 pipeline.textEncoder.weight')
    }
    const vae = pipeline.vae || {}
    if (!vae.repo) throw new Error('anima 需要 pipeline.vae.repo')
    const tokenizers = pipeline.tokenizers || {}
    if (!tokenizers.repo) throw new Error('anima 需要 pipeline.tokenizers.repo（Qwen3 + T5 分词器所在仓库）')
  }
  for (const field of ['size', 'steps', 'cfg']) {
    if (!Number.isFinite(Number(model[field]))) throw new Error(`配置缺少数值字段 ${field}`)
  }
  if (model.runtime !== undefined && model.runtime !== 'default') {
    throw new Error(`runtime 目前只支持 "default"（收到 ${JSON.stringify(model.runtime)}）`)
  }
  return { absolute, model }
}

/** 下发给远端 payload 的配置（prompt/采样次数固定，保证不同模型间可比）。 */
export function payloadConfigOf(model) {
  return {
    id: model.id,
    pipeline: model.pipeline,
    size: Number(model.size),
    steps: Number(model.steps),
    cfg: Number(model.cfg),
    negativeHint: typeof model.negativeHint === 'string' ? model.negativeHint : '',
    prompt: PROMPT,
    seed: 42,
  }
}

// ── 宿主侧 subprocess 适配 ────────────────────────────────────────────────

function createContext() {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: ROOT }
      return undefined
    },
    subprocess: {
      async resolveExecutable(name) {
        return name
      },
      spawn({ argv, cwd, signal }) {
        const child = spawn(argv[0], argv.slice(1), {
          cwd: cwd ?? process.cwd(),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const out = []
        const err = []
        child.stdout.on('data', (chunk) => out.push(chunk))
        child.stderr.on('data', (chunk) => err.push(chunk))
        const done = new Promise((resolveDone) => {
          child.on('error', (error) => resolveDone({ exitCode: -1, error: String(error?.message ?? error) }))
          child.on('close', (code, sig) => resolveDone({ exitCode: code ?? -1, signal: sig }))
        })
        signal?.addEventListener?.('abort', () => child.kill())
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: Buffer.concat(out).toString('utf8') }) },
            stderr: { readFrom: () => ({ text: Buffer.concat(err).toString('utf8') }) },
          },
          terminate: async () => {
            child.kill()
          },
          waitForExit: () => done,
        }
      },
    },
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function logLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
}

function printLogTail(text, limit = 20) {
  const lines = logLines(text)
  if (lines.length === 0) return
  console.error(`\n最后 ${Math.min(limit, lines.length)} 行日志：`)
  for (const line of lines.slice(-limit)) console.error(line)
}

// ── 打包与执行 ────────────────────────────────────────────────────────────

async function packageKernel(model, username) {
  const config = payloadConfigOf(model)
  const folder = await buildKernelFolder({
    username,
    slug: randomSlug(),
    config,
    sourcePath: PAYLOAD_SOURCE,
    enableGpu: true,
  })
  return { folder, config }
}

/** 校验打包结果：注入配置能解码且与预期一致；payload 已内联成单文件（Kaggle 只收单个 code_file）。 */
async function inspectPackage(folder, config) {
  const source = await readFile(join(folder.dir, 'daemon.py'), 'utf8')
  const match = source.match(/^EMBEDDED_CONFIG_B64 = "([^"]*)"$/m)
  if (!match) throw new Error('打包后的脚本缺少 EMBEDDED_CONFIG_B64 注入行')
  const injected = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  if (JSON.stringify(injected) !== JSON.stringify(config)) throw new Error('注入配置与预期不一致')
  if (/^[ \t]*from anima_runtime import /m.test(source)) {
    throw new Error('打包后的 payload 仍含未内联的 anima_runtime import 行')
  }
  if (hasInlineMarkerLine(source)) throw new Error('打包后的 payload 仍有未处理的 @@INLINE 标记')
  const runtimeDefs = source.match(/^def load_anima_runtime\(/gm) ?? []
  if (runtimeDefs.length !== 1) {
    throw new Error(`打包后的 payload 中 load_anima_runtime 定义 ${runtimeDefs.length} 份，应为 1 份`)
  }
  const metadata = JSON.parse(await readFile(join(folder.dir, 'kernel-metadata.json'), 'utf8'))
  if (metadata.code_file !== 'daemon.py') throw new Error('kernel-metadata.code_file 不是 daemon.py')
  if (metadata.enable_gpu !== true) throw new Error('kernel-metadata.enable_gpu 不是 true')
  return { injected, metadata }
}

async function runDryRun(model) {
  const { folder, config } = await packageKernel(model, 'dry-run-user')
  try {
    await inspectPackage(folder, config)
    console.log(`[dry-run] 配置校验通过：id=${model.id} loader=${model.pipeline.loader} size=${config.size} steps=${config.steps} cfg=${config.cfg}`)
    console.log(`[dry-run] Kernel 打包演练通过：${folder.kernelId}（daemon.py + kernel-metadata.json，enable_gpu=true）`)
    console.log(`[dry-run] 注入配置可解码且字段一致；未调用 Kaggle CLI`)
  } finally {
    await removeKernelFolder(folder.dir)
  }
}

async function waitForTerminal(ctx, kernelId, timeoutMin) {
  const deadline = Date.now() + timeoutMin * 60 * 1000
  let last = ''
  while (Date.now() < deadline) {
    const result = await kernelStatus(ctx, kernelId)
    if (result.ok && result.status) {
      if (result.status !== last) {
        console.log(`  · ${result.status}`)
        last = result.status
      }
      if (TERMINAL_STATES.has(result.status)) return result.status
    } else {
      console.log(`  · 状态查询失败：${(result.output || '').slice(0, 160)}`)
    }
    await sleep(Math.min(POLL_MS, Math.max(1000, deadline - Date.now())))
  }
  return 'TIMEOUT'
}

async function readVerifyReport(kernelDir, ctx, kernelId) {
  try {
    return JSON.parse(await readFile(join(kernelDir, 'verify-report.json'), 'utf8'))
  } catch {
    // 产物下载失败时的兜底：payload 会把同一份 JSON 打到日志里。
    const logs = await kernelLogs(ctx, kernelId)
    const line = logLines(logs.tail).find((item) => item.startsWith('VERIFY_JSON: '))
    if (!line) return null
    try {
      return JSON.parse(line.slice('VERIFY_JSON: '.length))
    } catch {
      return null
    }
  }
}

function measuredOf(report) {
  const number = (value) => {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    peakVramMb: number(report.peak_vram_mb),
    loadSeconds: number(report.load_seconds),
    steadySeconds: number(report.steady_median_s),
    downloadGb: number(report.download_gb),
  }
}

function printMetrics(model, report, samplePath, sampleBytes) {
  console.log('\n验证通过')
  console.log(`  模型      ${model.id}（${model.pipeline.loader}）`)
  console.log(`  显存峰值  ${report.peak_vram_mb} MB`)
  console.log(`  加载耗时  ${report.load_seconds} s`)
  console.log(`  首图耗时  ${report.first_s} s`)
  console.log(`  稳态中位  ${report.steady_median_s} s（${report.samples ?? 3} 次，丢弃首张）`)
  console.log(`  下载体积  ${report.download_gb} GiB`)
  console.log(`  样张      ${relative(ROOT, samplePath).replace(/\\/g, '/')}（${sampleBytes} 字节）`)
}

async function writeMeasured(absolutePath, model, measured) {
  const updated = { ...model, measured }
  await writeFile(absolutePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
  console.log(`\n已把 measured 写回：${relative(ROOT, absolutePath).replace(/\\/g, '/')}`)
  if (absolutePath.startsWith(join(ROOT, 'models'))) {
    console.log('提示：运行 npm run models:build 同步 shared/models.generated.js')
  }
}

async function runVerify(options, model, absolutePath) {
  const ctx = createContext()
  const timeoutMin = options.timeoutMin
  console.log(`[1/5] 打包 Kernel（模型 ${model.id}）…`)
  const username = await kaggleUsername(ctx).catch((error) => {
    throw new Error(`读取 Kaggle 用户名失败：${error?.message ?? error}`)
  })
  const { folder } = await packageKernel(model, username)
  try {
    await inspectPackage(folder, payloadConfigOf(model))
    console.log(`[2/5] 推送 Kernel：${folder.kernelId}（accelerator=${ACCELERATOR}，超时 ${timeoutMin} 分钟）`)
    const pushed = await pushKernel(ctx, folder.dir, {
      accelerator: ACCELERATOR,
      timeoutSec: Math.ceil(timeoutMin * 60),
    })
    if (!pushed.ok) {
      printLogTail(pushed.output)
      throw Object.assign(new Error(pushed.authFailed ? 'Kaggle 鉴权失败' : 'Kernel 推送失败'), {
        failureCode: pushed.authFailed ? 'auth_required' : 'push_failed',
      })
    }

    console.log('[3/5] 等待 Kaggle 排队与执行…')
    const status = await waitForTerminal(ctx, folder.kernelId, timeoutMin)
    if (status !== 'COMPLETE') {
      const logs = await kernelLogs(ctx, folder.kernelId)
      const code = status === 'TIMEOUT' ? 'timeout' : classifyFailure(logs.tail)
      printLogTail(logs.tail)
      throw Object.assign(new Error(status === 'TIMEOUT' ? `等待超时（${timeoutMin} 分钟）` : `Kernel 执行失败（${status}）`), {
        failureCode: code,
      })
    }

    console.log('[4/5] 下载验证产物…')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const kernelDir = join(WORK_DIR, `${model.id}-${stamp}`)
    await mkdir(kernelDir, { recursive: true })
    const download = await downloadKernelOutput(ctx, folder.kernelId, kernelDir)
    if (!download.ok) {
      throw Object.assign(new Error('验证产物下载失败'), { failureCode: 'download_failed', detail: download.output })
    }

    const report = await readVerifyReport(kernelDir, ctx, folder.kernelId)
    if (!report) throw Object.assign(new Error('没有读到 verify-report.json'), { failureCode: 'invalid_report' })
    if (report.status !== 'ok') {
      const text = `${report.error ?? ''}\n${report.traceback ?? ''}`
      printLogTail(text)
      throw Object.assign(new Error(report.error ?? '远端验证失败'), {
        failureCode: classifyFailure(`${text}\n${JSON.stringify(report.env ?? {})}`),
      })
    }

    const sampleSource = join(kernelDir, 'verify-sample.png')
    const png = await readFile(sampleSource).catch(() => null)
    if (!png || png.length < 8 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw Object.assign(new Error('样张不是合法 PNG'), { failureCode: 'invalid_report' })
    }
    await mkdir(WORK_DIR, { recursive: true })
    const samplePath = join(WORK_DIR, `${model.id}.png`)
    await copyFile(sampleSource, samplePath)
    await writeFile(join(WORK_DIR, `${model.id}.report.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    const measured = measuredOf(report)
    const missing = Object.entries(measured).filter(([, value]) => value === null).map(([key]) => key)
    if (missing.length > 0) {
      throw Object.assign(new Error(`实测数据不完整：${missing.join(', ')}`), { failureCode: 'invalid_report' })
    }

    printMetrics(model, report, samplePath, png.length)
    if (options.write) await writeMeasured(absolutePath, model, measured)
    else console.log('\n未指定 --write，measured 未写回。')
  } finally {
    await removeKernelFolder(folder.dir)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const { absolute, model } = await loadModelConfig(options.config)
  if (options.dryRun) {
    await runDryRun(model)
    return
  }
  await runVerify(options, model, absolute)
}

// 只有直接执行时才跑 main；被测试 import 时只导出纯函数。
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      const code = error?.failureCode ? ` [${error.failureCode}]` : ''
      console.error(`\n验证失败${code}：${error?.message ?? error}`)
      if (error?.detail) printLogTail(error.detail)
      process.exit(1)
    })
}

export { main }