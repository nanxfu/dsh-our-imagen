/**
 * GPU 链路验证：用真实 Kaggle GPU 跑 remote/daemon.py，端到端出图一次。
 *
 * 与 kaggle-live.mjs 的区别：那个用 CPU 探针验证调度链路，这个验证真实推理，
 * 会消耗 GPU 配额，且需要等 Kaggle 排队（可能十几分钟）。
 *
 * 运行：node test/gpu-live.mjs [--preset sdxl-lightning] [--prompt "…"] [--keep]
 * 产物：bench-results/gpu-live/<时间戳>/01.png 与 report.json
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { SessionManager } from '../lib/session.js'
import { presetById } from '../lib/presets.js'
import { fetchHealth, requestGenerate } from '../lib/remote.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(PLUGIN_ROOT, 'bench-results', 'gpu-live')
const KEEP = process.argv.includes('--keep')

function argOf(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : fallback
}

const PRESET_ID = argOf('preset', 'sdxl-lightning')
const PROMPT = argOf('prompt', 'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail')

function createSubprocess() {
  return {
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
      const done = new Promise((resolve) => {
        child.on('error', (error) => resolve({ exitCode: -1, error: String(error?.message ?? error) }))
        child.on('close', (code, sig) => resolve({ exitCode: code ?? -1, signal: sig }))
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
  }
}

function createContext() {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: PLUGIN_ROOT }
      return undefined
    },
    subprocess: createSubprocess(),
    webServer: { getOrigin: () => '' },
  }
}

function fmt(value) {
  return JSON.stringify(value, null, 2)
}

async function main() {
  const session = new SessionManager({
    ctx: createContext(),
    defaultPreset: PRESET_ID,
    options: {
      enableGpu: true,
      accelerator: 'NvidiaTeslaT4',
      idleTimeoutSec: 900,
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
      kernelTimeoutSec: 10800,
    },
  })

  console.log(`[1/5] 推送 GPU Kernel（预设 ${PRESET_ID}）…`)
  const started = await session.start(PRESET_ID)
  console.log(fmt({ state: started.state, kernelId: started.kernelId, kernelUrl: started.kernelUrl }))
  if (started.state === 'error') throw new Error(started.error?.message)

  console.log('[2/5] 等待排队与模型加载（最多 60 分钟）…')
  let lastLabel = ''
  await session.ensureReady({
    timeoutMs: 60 * 60 * 1000,
    onTick(state) {
      const label = `${state.state}/${state.phase ?? '-'} ${state.kernelStatus ?? ''}`.trim()
      if (label !== lastLabel) {
        lastLabel = label
        console.log(`  · ${label} ${state.detail ?? ''}`)
      }
    },
  }).catch(async (error) => {
    console.error(fmt(session.snapshot()))
    throw error
  })

  const { endpoint, token } = session.connection()
  const health = await fetchHealth(endpoint, token, 8000)
  console.log('[3/5] /health', fmt({ phase: health.phase, device: health.device, count: health.device_count, loaded: health.loaded }))

  console.log('[4/5] 生成一张 …')
  const preset = presetById(PRESET_ID)
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      tasks: [
        {
          name: '01',
          prompt: PROMPT,
          negative_prompt: preset.negativeHint ?? '',
          seed: 42,
          width: preset.size,
          height: preset.size,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const elapsed = ((Date.now() - begin) / 1000).toFixed(1)
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(OUT_DIR, stamp)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '01.png'), png)
  const report = {
    preset: PRESET_ID,
    prompt: PROMPT,
    kernelId: started.kernelId,
    device: health.device,
    deviceCount: health.device_count,
    loadSeconds: response.load_seconds,
    imageSeconds: result.seconds,
    wallSeconds: Number(elapsed),
    pngBytes: png.length,
    isPng,
    generatedAt: new Date().toISOString(),
  }
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log('[4/5] 结果', fmt(report))
  if (!isPng) throw new Error('返回内容不是合法 PNG')

  if (KEEP) {
    console.log('[5/5] --keep：保留 Kernel 便于观察')
    return
  }
  console.log('[5/5] 关机 …')
  const stopped = await session.stop()
  console.log(fmt({ state: stopped.state, detail: stopped.detail }))
  console.log(`\nGPU 链路验证通过，产物：${dir}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n验证失败：', error?.message ?? error)
    process.exit(1)
  })
