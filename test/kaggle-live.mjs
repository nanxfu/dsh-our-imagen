/**
 * 真实链路验证：用真实的 kaggle CLI + SessionManager 跑一遍
 *   push → 容器启动 → cloudflared 隧道 → ntfy 上报 → Host 握手 → 生成 → 关机
 *
 * 推的是 test/tunnel-probe.py（CPU、不加载模型、不占 GPU 配额），
 * 所以它验证的是调度链路本身，不验证推理性能。
 *
 * 运行：node test/kaggle-live.mjs [--keep]
 *   --keep  结束后不关机，保留 Kernel 便于继续观察（需手动 stop）
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { SessionManager } from '../lib/session.js'
import { fetchHealth, requestGenerate } from '../lib/remote.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PROBE_SOURCE = join(PLUGIN_ROOT, 'test', 'tunnel-probe.py')
const KEEP = process.argv.includes('--keep')

/** 最小 subprocess 适配器：把 cordis 的接口映射到 node:child_process。 */
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
  const ctx = createContext()
  const session = new SessionManager({
    ctx,
    defaultPreset: 'sdxl-lightning',
    options: {
      sourcePath: PROBE_SOURCE,
      enableGpu: false,
      accelerator: null,
      idleTimeoutSec: 600,
      provisionTimeoutMs: 10 * 60 * 1000,
      tunnelTimeoutMs: 10 * 60 * 1000,
      kernelTimeoutSec: 1800,
    },
  })

  console.log('[1/5] 推送 Kernel …')
  const started = await session.start('sdxl-lightning')
  console.log(fmt({
    state: started.state,
    phase: started.phase,
    kernelId: started.kernelId,
    kernelUrl: started.kernelUrl,
    detail: started.detail,
    error: started.error,
  }))
  if (started.state === 'error') throw new Error(`启动失败：${started.error?.message}`)

  console.log('[2/5] 等待隧道与握手（最多 10 分钟）…')
  let lastLabel = ''
  const ready = await session.ensureReady({
    timeoutMs: 10 * 60 * 1000,
    onTick(state) {
      const label = `${state.state}/${state.phase ?? '-'} ${state.kernelStatus ?? ''}`.trim()
      if (label !== lastLabel) {
        lastLabel = label
        console.log(`  · ${label} ${state.detail ?? ''}`)
      }
    },
  }).catch(async (error) => {
    const snapshot = session.snapshot()
    console.error(fmt({ state: snapshot.state, phase: snapshot.phase, detail: snapshot.detail, error: snapshot.error }))
    throw error
  })

  console.log(fmt({
    state: ready.state,
    endpoint: ready.endpointUrl,
    device: ready.device,
    modelId: ready.modelId,
    readyAt: ready.readyAt,
  }))

  const { endpoint, token } = session.connection()
  console.log('[3/5] GET /health …')
  const health = await fetchHealth(endpoint, token)
  console.log(fmt({
    phase: health.phase,
    version: health.version,
    device: health.device,
    device_count: health.device_count,
    uptime: health.uptime_seconds,
  }))

  console.log('[4/5] POST /generate（探针返回 1×1 PNG）…')
  const generated = await requestGenerate(endpoint, token, {
    pipeline: {
      loader: 'sdxl',
      base: 'probe/no-model',
      lora: null,
      scheduler: null,
      variant: null,
      allowPatterns: null,
      deviceMap: null,
    },
    modelId: 'probe/no-model',
    tasks: [
      { name: '01', prompt: 'probe', negative_prompt: '', seed: 42, width: 512, height: 512, steps: 4, cfg: 0 },
    ],
  })
  const png = Buffer.from(generated.results[0].image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  console.log(fmt({
    results: generated.results.length,
    bytes: png.length,
    isPng,
    seconds: generated.results[0].seconds,
  }))
  if (!isPng) throw new Error('返回内容不是合法 PNG')

  if (KEEP) {
    console.log('[5/5] --keep：保留 Kernel，记得稍后关机')
    console.log(fmt({ kernelId: ready.kernelId }))
    return
  }

  console.log('[5/5] 关机 …')
  const stopped = await session.stop()
  console.log(fmt({ state: stopped.state, detail: stopped.detail }))
  console.log('\n链路验证通过：push → 隧道 → 握手 → 生成 → 关机')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n验证失败：', error?.message ?? error)
    process.exit(1)
  })
