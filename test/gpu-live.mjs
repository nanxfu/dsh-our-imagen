/**
 * GPU 链路验证：用真实 Kaggle GPU 跑 remote/daemon.py，端到端出图。
 *
 * 与 kaggle-live.mjs 的区别：那个用 CPU 探针验证调度链路，这个验证真实推理，
 * 会消耗 GPU 配额，且需要等 Kaggle 排队（可能十几分钟）。
 *
 * 运行：
 *   node test/gpu-live.mjs [--preset sdxl-lightning] [--prompt "…"] [--keep]
 *   node test/gpu-live.mjs --presets sdxl-lightning,flux2-klein-4b,anima-light-lavender
 *
 * 两种模式：
 *   - 单预设（默认）：出图一张，report.json 保留原有字段，向后兼容；
 *   - `--presets a,b,c`：在同一个 Kaggle 会话内按顺序连续切换模型出图，用于验证
 *     M4.1 的切换模型 LRU 缓存清理（旧权重不删会撑爆 20GB 磁盘）。report.json
 *     额外记录每个模型的加载/出图耗时、/health 依赖版本快照与远端 [cache] 日志摘要。
 *
 * 前置条件：本机已安装并登录 Kaggle CLI、账号已启用 GPU 加速器且当天配额充足。
 * 默认不跑真机：只有显式执行本脚本（且不带 --help）才会推送 Kernel。
 * 产物：bench-results/gpu-live/<时间戳>/report.json 与样张 PNG。
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { SessionManager } from '../lib/session.js'
import { PRESETS, presetById } from '../lib/presets.js'
import { fetchHealth, requestGenerate, requestLogs } from '../lib/remote.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(PLUGIN_ROOT, 'bench-results', 'gpu-live')
const KEEP = process.argv.includes('--keep')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')
const VALID_PRESET_IDS = new Set(PRESETS.map((preset) => preset.id))
const DEFAULT_PROMPT =
  'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail'

function argOf(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : fallback
}

function printHelp() {
  console.log(`GPU 链路验证（真实 Kaggle GPU，会消耗 GPU 配额，默认不自动运行）

用法：
  node test/gpu-live.mjs [--preset <id>] [--prompt <text>] [--keep]
  node test/gpu-live.mjs --presets <id1,id2,...> [--prompt <text>] [--keep]

选项：
  --preset <id>     单预设模式（默认 sdxl-lightning），出图一张
  --presets a,b,c   单会话内按顺序连续切换模型出图，验证切换模型时的 LRU 缓存清理
  --prompt <text>   提示词（两种模式共用）
  --keep            结束后不关机，保留 Kernel 便于手动观察
  --help, -h        显示本帮助；不会推送 Kernel，也不会消耗配额

前置条件：
  - 本机安装并登录 Kaggle CLI：pip install -U kaggle，
    凭证写在 %USERPROFILE%\\.kaggle\\kaggle.json（详见 docs/TROUBLESHOOTING.md 第 6 节）
  - Kaggle 账号已绑定手机号并启用 GPU 加速器，当天 GPU 配额充足

报告：bench-results/gpu-live/<时间戳>/report.json
  - models[]：每个预设的 modelId / pipelineKind / 加载秒数 / 出图秒数 / PNG 字节数
  - versions：远端 /health 上报的依赖版本快照（用于维护 LKGR 基线）
  - cacheLogs：远端 [cache] 日志摘要，拉取失败时为 null（不影响验证结论）

可用预设：${PRESETS.map((preset) => preset.id).join(', ')}`)
}

/** 解析并校验命令行参数；--help 由调用方提前处理，不会走到这里。 */
function parseOptions() {
  const presetArg = String(argOf('preset', 'sdxl-lightning')).trim()
  const presetsArg = String(argOf('presets', '')).trim()
  const rawList = presetsArg ? presetsArg.split(',') : [presetArg]
  const presets = []
  for (const item of rawList) {
    const id = item.trim()
    if (!id) continue
    if (!VALID_PRESET_IDS.has(id)) {
      throw new Error(`未知预设：${id}（可选：${[...VALID_PRESET_IDS].join(', ')}）`)
    }
    presets.push(id)
  }
  if (!presets.length) throw new Error('至少需要一个预设（--preset 或 --presets）')
  return { presets, prompt: String(argOf('prompt', DEFAULT_PROMPT)) }
}

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

/**
 * 在已就绪的会话里加载一个预设并出图一张，返回 PNG 与报告条目。
 *
 * 连续调用即完成「同一会话内连续切换模型」：daemon 在切换时先释放旧 pipeline，
 * 再按目标模型依赖构建 keep_set 清理 HF 缓存，最后下载/加载新模型。
 */
async function generateOne({ endpoint, token, presetId, prompt, index, total }) {
  const preset = presetById(presetId)
  const pipelineKind = preset?.pipeline?.loader ?? null
  console.log(`  · [${index + 1}/${total}] ${presetId}（${pipelineKind ?? '-'}）加载并出图 …`)
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
          prompt,
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
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error(`预设 ${presetId}：远端没有返回图片`)
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error(`预设 ${presetId}：返回内容不是合法 PNG`)
  return {
    png,
    entry: {
      preset: presetId,
      modelId: preset.repo,
      pipelineKind,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
}

/**
 * 拉远端日志并挑出 [cache] 相关行（探针 / 清理 / evicted）。
 * 日志接口失败只告警、返回 null，不影响 GPU 验证结论。
 */
async function collectCacheLogs(endpoint, token) {
  try {
    const payload = await requestLogs(endpoint, token, 0, 8000)
    const lines = Array.isArray(payload?.lines)
      ? payload.lines.filter((line) => typeof line === 'string' && line.includes('[cache]'))
      : []
    const evicted = lines.filter((line) => line.includes('[cache] evicted'))
    return {
      evictedCount: evicted.length,
      evicted,
      lines: lines.slice(-80),
    }
  } catch (error) {
    console.warn(`  · 拉取远端 /logs 失败（忽略，不影响验证结论）：${error?.message ?? error}`)
    return null
  }
}

function artifactName(index, presetId, total) {
  return total === 1 ? '01.png' : `${String(index + 1).padStart(2, '0')}-${presetId}.png`
}

async function main() {
  const options = parseOptions()
  const single = options.presets.length === 1
  const session = new SessionManager({
    ctx: createContext(),
    defaultPreset: options.presets[0],
    options: {
      enableGpu: true,
      accelerator: 'NvidiaTeslaT4',
      idleTimeoutSec: 900,
      provisionTimeoutMs: 60 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
      kernelTimeoutSec: 10800,
    },
  })

  console.log(`[1/5] 推送 GPU Kernel（首个预设 ${options.presets[0]}，共 ${options.presets.length} 个模型）…`)
  let started = null
  try {
    started = await session.start(options.presets[0])
    console.log(fmt({ state: started.state, kernelId: started.kernelId, kernelUrl: started.kernelUrl }))
    if (started.state === 'error') {
      const failure = started.error ?? {}
      throw Object.assign(new Error(failure.message ?? 'Kernel 推送失败'), { code: failure.code })
    }

    console.log('[2/5] 等待排队与模型加载（最多 60 分钟）…')
    let lastLabel = ''
    await session
      .ensureReady({
        timeoutMs: 60 * 60 * 1000,
        onTick(state) {
          const label = `${state.state}/${state.phase ?? '-'} ${state.kernelStatus ?? ''}`.trim()
          if (label !== lastLabel) {
            lastLabel = label
            console.log(`  · ${label} ${state.detail ?? ''}`)
          }
        },
      })
      .catch(async (error) => {
        console.error(fmt(session.snapshot()))
        throw error
      })

    const { endpoint, token } = session.connection()
    const health = await fetchHealth(endpoint, token, 8000)
    console.log(
      '[3/5] /health',
      fmt({
        phase: health.phase,
        device: health.device,
        count: health.device_count,
        loaded: health.loaded,
        versions: health.versions ?? null,
      }),
    )

    console.log(
      single
        ? '[4/5] 生成一张 …'
        : `[4/5] 在同一会话内连续生成 ${options.presets.length} 个模型（验证 LRU 缓存清理）…`,
    )
    const models = []
    const images = []
    for (const [index, presetId] of options.presets.entries()) {
      const { png, entry } = await generateOne({
        endpoint,
        token,
        presetId,
        prompt: options.prompt,
        index,
        total: options.presets.length,
      })
      models.push(entry)
      images.push({ index, presetId, png })
      console.log(
        `  · ${presetId} 完成：加载 ${entry.loadSeconds ?? '-'}s / 出图 ${entry.imageSeconds ?? '-'}s / ${entry.pngBytes} 字节`,
      )
    }

    console.log('[5/5] 汇总 [cache] 日志并写报告 …')
    const cacheLogs = await collectCacheLogs(endpoint, token)
    const finalHealth = await fetchHealth(endpoint, token, 8000).catch(() => health)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = join(OUT_DIR, stamp)
    await mkdir(dir, { recursive: true })
    for (const image of images) {
      await writeFile(join(dir, artifactName(image.index, image.presetId, options.presets.length)), image.png)
    }
    const first = models[0]
    const report = {
      // 单预设兼容字段：与 0.7.0 的报告结构保持一致（多模型模式下取第一个模型）。
      preset: options.presets[0],
      presets: options.presets,
      prompt: options.prompt,
      kernelId: started.kernelId,
      device: health.device,
      deviceCount: health.device_count,
      loadSeconds: first.loadSeconds,
      imageSeconds: first.imageSeconds,
      wallSeconds: first.wallSeconds,
      pngBytes: first.pngBytes,
      isPng: first.isPng,
      // M4.2：逐模型耗时与依赖版本快照，用于固化 LKGR 与核对缓存清理是否生效。
      models,
      versions: health.versions ?? null,
      finalVersions: finalHealth.versions ?? null,
      cacheLogs,
      generatedAt: new Date().toISOString(),
    }
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log('[5/5] 结果', fmt(report))
    console.log(`\nGPU 链路验证通过，产物：${dir}`)
  } finally {
    if (KEEP) {
      console.log('--keep：保留 Kernel 便于观察（需手动关机）')
    } else if (started?.kernelId) {
      console.log('关机 …')
      const stopped = await session
        .stop()
        .catch((error) => ({ state: 'error', detail: error?.message ?? String(error) }))
      console.log(fmt({ state: stopped.state, detail: stopped.detail }))
    }
  }
}

if (HELP) {
  printHelp()
  process.exit(0)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n验证失败：', error?.message ?? error)
    if (['auth_required', 'cli_missing', 'cli_timeout'].includes(error?.code)) {
      console.error(
        '请先确认本机 Kaggle CLI 可用并已登录：pip install -U kaggle，凭证放在 %USERPROFILE%\\.kaggle\\kaggle.json' +
          '（详见 docs/TROUBLESHOOTING.md 第 6 节）。',
      )
    } else if (error?.code === 'gpu_unavailable') {
      console.error(
        '远端容器没有拿到 GPU：请检查 Kaggle 账号是否已完成手机号验证、是否启用 GPU 加速器' +
          '（详见 docs/TROUBLESHOOTING.md 第 6 节）。',
      )
    }
    process.exit(1)
  })
