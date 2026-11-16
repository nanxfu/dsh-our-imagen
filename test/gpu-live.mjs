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
 *     额外记录每个模型的加载/出图耗时、/health 依赖版本快照与远端 [cache] 日志摘要；
 *   - `--img2img`：M3 图生图验收。先文生图一张，再用这张图做垫图重绘，report.json
 *     记录重绘的加载/出图耗时、参考图尺寸与重绘前后 /health.gpu_memory（验证 from_pipe
 *     复用底座不额外占显存）。只能配单个 SDXL 家族预设使用。
 *   - `--inpaint`：M3 局部重绘验收。先文生图一张，再生成一张「中心白色矩形」的程序化蒙版
 *     做 Inpaint，report.json 记录蒙版字节数、对齐后的参考图尺寸与显存对比（验证
 *     `AutoPipelineForInpainting.from_pipe` 复用底座）。`--inpaint-prompt` 可给重绘单独
 *     的提示词，用于确认蒙版区真的按新内容重写。只能配单个支持 Inpaint 的预设使用。
 *
 * 前置条件：默认走直连，本机有可用的 Kaggle 凭据（`~/.kaggle/credentials.json` 等）即可；
加 `--cli` 时才要求本机安装并登录 kaggle CLI。账号需启用 GPU 加速器且当天配额充足。
 * 默认不跑真机：只有显式执行本脚本（且不带 --help）才会推送 Kernel。
 * 产物：bench-results/gpu-live/<时间戳>/report.json 与样张 PNG。
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

import { SessionManager } from '../lib/session.js'
import {
  deleteKernel as directDeleteKernel,
  kaggleUsername as directKaggleUsername,
  kernelLogs as directKernelLogs,
  kernelStatus as directKernelStatus,
  pushKernel as directPushKernel,
} from '../lib/kaggle-direct.js'
import { PRESETS, presetById } from '../lib/presets.js'
import { LIMITS } from '../shared/contract.js'
import { fetchHealth, requestGenerate, requestLogs } from '../lib/remote.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(PLUGIN_ROOT, 'bench-results', 'gpu-live')
const KEEP = process.argv.includes('--keep')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')
// 默认走直连（0.8.2 起的默认访问方式，不需要本机 kaggle CLI）；
// 排障或想复现 CLI 路径时加 `--cli`。
const USE_CLI = process.argv.includes('--cli')
const TRANSPORT_DEPS = USE_CLI
  ? {}
  : {
      kaggleUsername: directKaggleUsername,
      pushKernel: directPushKernel,
      kernelStatus: directKernelStatus,
      kernelLogs: directKernelLogs,
      deleteKernel: directDeleteKernel,
    }
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
  node test/gpu-live.mjs --preset sdxl-lightning --img2img [--strength 0.6]
  node test/gpu-live.mjs --preset sdxl-lightning --inpaint [--strength 0.6]

选项：
  --preset <id>     单预设模式（默认 sdxl-lightning），出图一张
  --presets a,b,c   单会话内按顺序连续切换模型出图，验证切换模型时的 LRU 缓存清理
  --prompt <text>   提示词（两种模式共用）
  --img2img         M3 图生图验收：文生图后用该图垫图重绘，记录显存对比（仅单预设）
  --inpaint         M3 局部重绘验收：文生图后用程序化蒙版做 Inpaint，记录显存对比（仅单预设）
  --inpaint-prompt <text>
                    局部重绘使用单独的提示词（默认与 --prompt 相同）。给一段与文生图不同的描述，
                    才能肉眼确认白色蒙版区真的按新内容重写
  --max-queue-minutes <n>
                    排队超过 n 分钟仍是 QUEUED 时自动换新实例重排（默认 5，0 表示一直等）
  --max-replace <n> 最多换新实例几次（默认 3）；每次会用 DeleteKernel 清理旧 Kernel
  --source-preset <id>
                    局部重绘的源图预设（默认 sdxl-lightning）。专用 inpaint 模型不能文生图，
                    所以先用普通模型出源图，再用 --preset 指定的模型做局部重绘
  --mask-shape <s>  局部重绘蒙版形状：rect（默认）或 circle
  --mask-size <n>   蒙版尺寸占画布边长的比例（0.02~1，默认 0.4）；调小可模拟真实小笔刷
  --mask-center <x,y>
                    蒙版中心位置（0~1 相对坐标，默认 0.5,0.5 画面中心）
  --strength <n>    垫图 / 局部重绘强度（0.2~0.9，默认 0.6）
  --cli             用本机 kaggle CLI 推 Kernel（默认走直连，不需要 CLI）
  --keep            结束后不关机，保留 Kernel 便于手动观察
  --help, -h        显示本帮助；不会推送 Kernel，也不会消耗配额

前置条件：
  - 默认直连：本机有可用的 Kaggle 凭据（%USERPROFILE%\\.kaggle\\credentials.json
    或 access_token / kaggle.json），可在工作台用内置 OAuth 登录生成；
  - 加 --cli 时改为要求本机安装并登录 kaggle CLI：pip install -U kaggle；
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
  const img2img = process.argv.includes('--img2img')
  if (img2img && presets.length !== 1) throw new Error('--img2img 只能配合单个预设使用')
  const inpaint = process.argv.includes('--inpaint')
  if (inpaint && presets.length !== 1) throw new Error('--inpaint 只能配合单个预设使用')
  // 局部重绘的源图预设：专用 inpaint 模型不能文生图，验收时先用普通模型出源图。
  const sourcePresetArg = String(argOf('source-preset', 'sdxl-lightning')).trim()
  if (!VALID_PRESET_IDS.has(sourcePresetArg)) {
    throw new Error(`未知源图预设：${sourcePresetArg}（可选：${[...VALID_PRESET_IDS].join(', ')}）`)
  }
  if (sourcePresetArg === presets[0] && process.argv.includes('--inpaint')) {
    // 允许，但源图与重绘用同一预设时提示一次（专用模型会在生成阶段被拦）。
    console.log(`  · 提示：源图与重绘使用同一预设 ${sourcePresetArg}`)
  }
  if (img2img && inpaint) throw new Error('--img2img 与 --inpaint 是两种独立验收，请分开运行')
  const rawStrength = Number(argOf('strength', String(LIMITS.strength.default)))
  const { min, max } = LIMITS.strength
  const strength = Number.isFinite(rawStrength) ? Math.min(max, Math.max(min, rawStrength)) : LIMITS.strength.default
  // 局部重绘的提示词可以单独给：用与文生图不同的描述，才能肉眼确认「白色蒙版区真的按新内容重写」。
  const prompt = String(argOf('prompt', DEFAULT_PROMPT))
  const inpaintPrompt = String(argOf('inpaint-prompt', '')).trim() || prompt
  // 排队超过阈值仍不运行就换新实例重排：Kaggle 免费 GPU 偶发条目卡在 QUEUED，
  // 重推一个 Kernel 往往几十秒就能拿到卡（与工作台的「换新实例重排」同一机制）。
  const rawQueueMinutes = Number(argOf('max-queue-minutes', '5'))
  const maxQueueMinutes =
    Number.isFinite(rawQueueMinutes) && rawQueueMinutes >= 0 ? rawQueueMinutes : 5
  const rawReplace = Number(argOf('max-replace', '3'))
  const maxReplace = Number.isFinite(rawReplace) && rawReplace >= 0 ? Math.min(10, Math.round(rawReplace)) : 3
  // 局部重绘的蒙版形状/大小/位置：默认是验收用的「中心 40% 矩形」，调小并挪到具体物体上
  // 就能模拟真实笔刷的小面积涂抹。
  const maskShape = String(argOf('mask-shape', 'rect')).trim().toLowerCase() === 'circle' ? 'circle' : 'rect'
  const rawMaskSize = Number(argOf('mask-size', '0.4'))
  const maskSize = Number.isFinite(rawMaskSize) ? Math.min(1, Math.max(0.02, rawMaskSize)) : 0.4
  const centerParts = String(argOf('mask-center', '0.5,0.5')).split(',').map((part) => Number(part.trim()))
  const maskCenterX = Number.isFinite(centerParts[0]) ? Math.min(1, Math.max(0, centerParts[0])) : 0.5
  const maskCenterY = Number.isFinite(centerParts[1]) ? Math.min(1, Math.max(0, centerParts[1])) : 0.5
  return {
    presets,
    prompt,
    inpaintPrompt,
    img2img,
    inpaint,
    strength,
    maxQueueMinutes,
    maxReplace,
    sourcePreset: sourcePresetArg,
    maskShape,
    maskSize,
    maskCenterX,
    maskCenterY,
  }
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
/** 拉取远端日志里与推理相关的行（[load]/[gen]/[job]），排障与验收报告用。 */
async function collectGenLogs(endpoint, token) {
  try {
    const payload = await requestLogs(endpoint, token, 0, 8000)
    const lines = Array.isArray(payload?.lines) ? payload.lines : []
    return lines.filter(
      (line) => typeof line === 'string' && /\[(load|gen|job)\]/.test(line),
    )
  } catch (error) {
    return [`（远端日志拉取失败：${String(error?.message ?? error).slice(0, 120)}）`]
  }
}

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

/** 读取远端只读显存诊断（/health.gpu_memory）；不可用时返回 null，不影响验证结论。 */
async function readGpuMemory(endpoint, token) {
  try {
    const health = await fetchHealth(endpoint, token, 8000)
    return health?.gpu_memory ?? null
  } catch {
    return null
  }
}

/**
 * M3 真机验收：在同一会话里用刚生成的图片做一次垫图重绘。
 *
 * 关键观察点：`load_seconds` 应为 0（`AutoPipelineForImage2Image.from_pipe` 复用已加载底座，
 * 不重新加载权重），且 `gpu_memory.reserved_mb` / `max_allocated_mb` 相比文生图结束时应基本持平。
 * 直接按远端 job 协议提交（与 Host lib/jobs.js 的下发形状一致：job 级 `reference`）。
 */
async function runImg2Img({ endpoint, token, presetId, sourcePng, prompt, strength }) {
  const preset = presetById(presetId)
  console.log(`  · [img2img] ${presetId} 以刚生成的图做垫图重绘（strength=${strength}）…`)
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      reference: { image_b64: sourcePng.toString('base64'), strength },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed: 43,
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
  if (!result?.image_b64) throw new Error('img2img：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('img2img：返回内容不是合法 PNG')
  return {
    png,
    entry: {
      preset: presetId,
      strength,
      referenceBytes: sourcePng.length,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      referenceWidth: result.referenceWidth ?? null,
      referenceHeight: result.referenceHeight ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
}

// CRC32 查表：PNG 每个 chunk 都要带，生成测试蒙版不引入额外依赖。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[n] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 组装一个 PNG chunk：长度 + 类型 + 数据 + CRC。 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/**
 * 生成程序化黑白蒙版 PNG（8 位灰度），供 --inpaint 真机验收使用。
 *
 * 语义与客户端 canvas 导出完全一致：白 = 重绘区域、黑 = 保留区域。
 * 尺寸不必与参考图相同（远端按最近邻对齐），这里直接用目标出图尺寸，便于核对 maskWidth/Height。
 *
 * `shape` 支持 `rect`（居中矩形，宽高取画布边长 × size）与 `circle`（居中圆，直径取短边 × size）；
 * `centerX` / `centerY` 是 0~1 的相对位置，默认画面中心。用 `--mask-size` 调小、`--mask-center`
 * 移到具体物体上，即可模拟真实笔刷的小面积涂抹。
 */
function maskPngOf(width, height, options = {}) {
  const w = Math.max(16, Math.round(Number(width) || 0))
  const h = Math.max(16, Math.round(Number(height) || 0))
  const shape = options.shape === 'circle' ? 'circle' : 'rect'
  const rawSize = Number(options.size)
  const sizeRatio = Number.isFinite(rawSize) ? Math.min(1, Math.max(0.02, rawSize)) : 0.4
  const rawCenterX = Number(options.centerX)
  const rawCenterY = Number(options.centerY)
  const centerX = Math.round(w * (Number.isFinite(rawCenterX) ? Math.min(1, Math.max(0, rawCenterX)) : 0.5))
  const centerY = Math.round(h * (Number.isFinite(rawCenterY) ? Math.min(1, Math.max(0, rawCenterY)) : 0.5))
  const radiusX = (shape === 'circle' ? Math.min(w, h) : w) * sizeRatio / 2
  const radiusY = (shape === 'circle' ? Math.min(w, h) : h) * sizeRatio / 2
  const left = Math.round(centerX - radiusX)
  const right = Math.round(centerX + radiusX)
  const top = Math.round(centerY - radiusY)
  const bottom = Math.round(centerY + radiusY)
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y += 1) {
    const row = y * (w + 1)
    raw[row] = 0 // filter type: none
    for (let x = 0; x < w; x += 1) {
      let inside
      if (shape === 'circle') {
        const dx = (x - centerX) / Math.max(1, radiusX)
        const dy = (y - centerY) / Math.max(1, radiusY)
        inside = dx * dx + dy * dy <= 1
      } else {
        inside = x >= left && x < right && y >= top && y < bottom
      }
      raw[row + 1 + x] = inside ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * M3 局部重绘真机验收：同一会话里用刚生成的图 + 程序化黑白蒙版做一次 Inpaint。
 *
 * 关键观察点：`load_seconds` 应为 0（`AutoPipelineForInpainting.from_pipe` 复用已加载底座），
 * `gpu_memory` 相比文生图结束时应基本持平；出图尺寸跟随参考图（与 img2img 一致）。
 * 提交形状与 Host 下发一致：job 级 `reference = { image_b64, strength, mask_b64 }`。
 */
async function runInpaint({ endpoint, token, presetId, sourcePng, prompt, strength, mask = {} }) {
  const preset = presetById(presetId)
  const maskPng = maskPngOf(preset.size, preset.size, mask)
  const maskLabel = mask.shape === 'circle' ? '圆形' : '矩形'
  console.log(
    `  · [inpaint] ${presetId} 以刚生成的图 + 程序化蒙版做局部重绘（strength=${strength}，` +
      `${maskLabel}蒙版 ${maskPng.length} 字节，中心 ${mask.centerX}/${mask.centerY}）…`,
  )
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      reference: {
        image_b64: sourcePng.toString('base64'),
        strength,
        mask_b64: maskPng.toString('base64'),
      },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed: 44,
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
  if (!result?.image_b64) throw new Error('inpaint：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('inpaint：返回内容不是合法 PNG')
  return {
    png,
    entry: {
      preset: presetId,
      strength,
      referenceBytes: sourcePng.length,
      maskBytes: maskPng.length,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      referenceWidth: result.referenceWidth ?? null,
      referenceHeight: result.referenceHeight ?? null,
      maskWidth: result.maskWidth ?? null,
      maskHeight: result.maskHeight ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
    },
  }
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
    // 默认直连 Kaggle JSON API（凭证在 ~/.kaggle/credentials.json）；`--cli` 时用本机 kaggle CLI。
    deps: TRANSPORT_DEPS,
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
    let replaceCount = 0
    let queueSince = Date.now()
    for (;;) {
      let stalled = false
      try {
        await session.ensureReady({
          timeoutMs: 60 * 60 * 1000,
          onTick(state) {
            const label = `${state.state}/${state.phase ?? '-'} ${state.kernelStatus ?? ''}`.trim()
            if (label !== lastLabel) {
              lastLabel = label
              console.log(`  · ${label} ${state.detail ?? ''}`)
            }
            // 只在「已推送、还在排队」阶段计数：连接与加载模型阶段不该被重排打断。
            if (state.state !== 'provisioning' || state.phase !== 'queue') return
            if (options.maxQueueMinutes <= 0) return
            if (replaceCount >= options.maxReplace) return
            if (Date.now() - queueSince < options.maxQueueMinutes * 60 * 1000) return
            stalled = true
            throw Object.assign(new Error('排队超时'), { code: 'queue_stalled' })
          },
        })
        break
      } catch (error) {
        if (!stalled) {
          console.error(fmt(session.snapshot()))
          throw error
        }
        replaceCount += 1
        console.log(
          `  · 排队超过 ${options.maxQueueMinutes} 分钟仍未拿到 GPU，换新实例重排（第 ${replaceCount}/${options.maxReplace} 次）…`,
        )
        started = await session.start(options.presets[0], { replace: true })
        console.log(fmt({ state: started.state, kernelId: started.kernelId, kernelUrl: started.kernelUrl }))
        if (started.state === 'error') {
          const failure = started.error ?? {}
          throw Object.assign(new Error(failure.message ?? '重排后 Kernel 推送失败'), { code: failure.code })
        }
        lastLabel = ''
        queueSince = Date.now()
      }
    }

    const { endpoint, token } = session.connection()
    const health = await fetchHealth(endpoint, token, 8000)
    console.log(
      '[3/5] /health',
      fmt({
        phase: health.phase,
        device: health.device,
        count: health.device_count,
        loaded: health.loaded,
        gpuMemory: health.gpu_memory ?? null,
        versions: health.versions ?? null,
      }),
    )

    console.log(
      options.img2img
        ? '[4/5] 文生图 + 垫图重绘 …'
        : options.inpaint
          ? '[4/5] 文生图 + 程序化蒙版局部重绘 …'
          : single
            ? '[4/5] 生成一张 …'
            : `[4/5] 在同一会话内连续生成 ${options.presets.length} 个模型（验证 LRU 缓存清理）…`,
    )
    const models = []
    const images = []
    let img2imgReport = null
    let inpaintReport = null
    if (options.img2img) {
      // M3 真机验收：先文生图，再用刚生成的图做垫图重绘；对比 /health.gpu_memory。
      if (!single) throw new Error('--img2img 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsImg2Img !== true) {
        throw new Error(`预设 ${presetId} 不支持图生图（supportsImg2Img=false），请换 SDXL 家族预设`)
      }
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId, png: txt2img.png })
      console.log(
        `  · ${presetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ${txt2img.entry.imageSeconds ?? '-'}s`,
      )
      const before = await readGpuMemory(endpoint, token)
      const redraw = await runImg2Img({
        endpoint,
        token,
        presetId,
        sourcePng: txt2img.png,
        prompt: options.prompt,
        strength: options.strength,
      })
      const after = await readGpuMemory(endpoint, token)
      images.push({ index: 'img2img', presetId: `${presetId}-img2img`, png: redraw.png })
      console.log(
        `  · 垫图重绘完成：加载 ${redraw.entry.loadSeconds ?? '-'}s / 出图 ${redraw.entry.imageSeconds ?? '-'}s` +
          `（参考图 ${redraw.entry.referenceWidth ?? '?'}x${redraw.entry.referenceHeight ?? '?'}）`,
      )
      console.log(
        `  · 显存对比（MiB）：文生图后 ${fmt(before)} → 重绘后 ${fmt(after)}`,
      )
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      img2imgReport = {
        preset: presetId,
        strength: redraw.entry.strength,
        referenceBytes: redraw.entry.referenceBytes,
        loadSeconds: redraw.entry.loadSeconds,
        imageSeconds: redraw.entry.imageSeconds,
        width: redraw.entry.width,
        height: redraw.entry.height,
        referenceWidth: redraw.entry.referenceWidth,
        referenceHeight: redraw.entry.referenceHeight,
        pngBytes: redraw.entry.pngBytes,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // from_pipe 复用底座不应重新加载权重：load_seconds 期望为 0 或接近 0。
        reusedBasePipeline: (redraw.entry.loadSeconds ?? 0) === 0,
      }
    } else if (options.inpaint) {
      // M3 真机验收：先文生图，再用程序化蒙版做局部重绘；对比 /health.gpu_memory。
      if (!single) throw new Error('--inpaint 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsInpaint !== true) {
        throw new Error(`预设 ${presetId} 不支持局部重绘（supportsInpaint=false），请换 SDXL 家族预设`)
      }
      // 专用 inpaint 模型不能文生图：源图用 --source-preset（默认 sdxl-lightning）先出。
      const sourcePresetId = options.sourcePreset
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ${txt2img.entry.imageSeconds ?? '-'}s`,
      )
      const before = await readGpuMemory(endpoint, token)
      const redraw = await runInpaint({
        endpoint,
        token,
        presetId,
        sourcePng: txt2img.png,
        prompt: options.inpaintPrompt,
        strength: options.strength,
        mask: {
          shape: options.maskShape,
          size: options.maskSize,
          centerX: options.maskCenterX,
          centerY: options.maskCenterY,
        },
      })
      const after = await readGpuMemory(endpoint, token)
      images.push({ index: 'inpaint', presetId: `${presetId}-inpaint`, png: redraw.png })
      console.log(
        `  · 局部重绘完成：加载 ${redraw.entry.loadSeconds ?? '-'}s / 出图 ${redraw.entry.imageSeconds ?? '-'}s` +
          `（参考图 ${redraw.entry.referenceWidth ?? '?'}x${redraw.entry.referenceHeight ?? '?'}，` +
          `蒙版 ${redraw.entry.maskWidth ?? '?'}x${redraw.entry.maskHeight ?? '?'}）`,
      )
      console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 局部重绘后 ${fmt(after)}`)
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      inpaintReport = {
        preset: presetId,
        prompt: options.inpaintPrompt,
        strength: redraw.entry.strength,
        sourcePreset: options.sourcePreset,
        maskShape: options.maskShape,
        maskSize: options.maskSize,
        maskCenter: [options.maskCenterX, options.maskCenterY],
        referenceBytes: redraw.entry.referenceBytes,
        maskBytes: redraw.entry.maskBytes,
        loadSeconds: redraw.entry.loadSeconds,
        imageSeconds: redraw.entry.imageSeconds,
        width: redraw.entry.width,
        height: redraw.entry.height,
        referenceWidth: redraw.entry.referenceWidth,
        referenceHeight: redraw.entry.referenceHeight,
        maskWidth: redraw.entry.maskWidth,
        maskHeight: redraw.entry.maskHeight,
        pngBytes: redraw.entry.pngBytes,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // from_pipe 复用底座不应重新加载权重：load_seconds 期望为 0 或接近 0。
        reusedBasePipeline: (redraw.entry.loadSeconds ?? 0) === 0,
      }
    } else {
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
    }

    console.log('[5/5] 汇总 [cache] 日志并写报告 …')
    const cacheLogs = await collectCacheLogs(endpoint, token)
    const genLogs = await collectGenLogs(endpoint, token)
    const finalHealth = await fetchHealth(endpoint, token, 8000).catch(() => health)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = join(OUT_DIR, stamp)
    await mkdir(dir, { recursive: true })
    for (const image of images) {
      const name =
        image.index === 'img2img'
          ? '01-img2img.png'
          : image.index === 'inpaint'
            ? '02-inpaint.png'
            : artifactName(image.index, image.presetId, options.presets.length)
      await writeFile(join(dir, name), image.png)
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
      // M3：--img2img 模式下的垫图重绘结果与显存对比（非该模式为 null）。
      img2img: img2imgReport,
      // M3：--inpaint 模式下的局部重绘结果、蒙版尺寸与显存对比（非该模式为 null）。
      inpaint: inpaintReport,
      versions: health.versions ?? null,
      finalVersions: finalHealth.versions ?? null,
      cacheLogs,
      genLogs,
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
        '请先确认 Kaggle 凭据可用：默认直连读 %USERPROFILE%\\.kaggle\\credentials.json，' +
          '也可在工作台用内置 OAuth 登录；加 --cli 时才需要本机 kaggle CLI（详见 docs/TROUBLESHOOTING.md 第 6 节）。',
      )
    } else if (error?.code === 'gpu_unavailable') {
      console.error(
        '远端容器没有拿到 GPU：请检查 Kaggle 账号是否已完成手机号验证、是否启用 GPU 加速器' +
          '（详见 docs/TROUBLESHOOTING.md 第 6 节）。',
      )
    }
    process.exit(1)
  })
