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
 *     §六 真机验收的扩展参数：
 *       - `--reference-size WxH`：源文生图按给定宽高出图（非正方形验收，如 1024x768），
 *         程序化蒙版与参考图同比例生成；
 *       - `--mask-scale <0~1>`：中心蒙版面积占比（如 0.05 = 5%），默认沿用 `--mask-size` 旧口径；
 *       - `--strength-compare 0.9,1.0`：同一蒙版按多档强度各重绘一次，记录蒙版内平均差异；
 *       - `--inpaint-rounds <n>`：连续局部重绘轮数（第 2 轮起把上一轮出图当参考图继续重绘）。
 *     report.json 的 `inpaint.rounds[]` 记录每轮 strength / 耗时 / result 宽高 / 参考图与
 *     蒙版尺寸 / 蒙版覆盖率 / 蒙版内平均差异，便于验收文档直接引用。
 *   - `--upscale`：Phase B1 高清放大验收。先文生图（默认 sdxl-lightning 1024x1024，可用
 *     `--reference-size WxH` 指定源图，长边不能超过 UPSCALE.maxInputEdge），再以该图为源发
 *     `tool=upscale`，report.json 记录源图/输出宽高、加载与推理秒数、PNG 字节数、前后
 *     /health.gpu_memory，并断言输出 = 源图 × 2。
 *   - `--outpaint`：Phase B2 扩图验收。先文生图（源图固定 864x864），再用 Node 侧 PNG 工具
 *     构造「画布 1536x864 + 原图 864x864 居中 + 白边蒙版」，以 strength 1.0 提交到
 *     `sdxl-inpaint`（`--preset sdxl-inpaint` 时必须同时给 `--source-preset sdxl-lightning`，
 *     专用 inpaint 模型不能文生图），report.json 记录耗时 / 输出尺寸 / 前后显存，
 *     并用像素差统计验证内容区保留（内容区平均差应 ≈0、无硬接缝）。
 *     report.json 的新字段 `upscale` / `outpaint`（非该模式为 null）。
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
import { deflateSync, inflateSync } from 'node:zlib'

import { SessionManager } from '../lib/session.js'
import {
  deleteKernel as directDeleteKernel,
  kaggleUsername as directKaggleUsername,
  kernelLogs as directKernelLogs,
  kernelStatus as directKernelStatus,
  pushKernel as directPushKernel,
} from '../lib/kaggle-direct.js'
import { PRESETS, presetById } from '../lib/presets.js'
import { LIMITS, OUTPAINT, UPSCALE } from '../shared/contract.js'
import { fetchHealth, requestGenerate, requestLogs, submitGenerate, waitForJob } from '../lib/remote.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = join(PLUGIN_ROOT, 'bench-results', 'gpu-live')
// 扩图真机验收的固定画布（INTERFACES §2.6）：1536x864（16:9）+ 原图 864x864 居中，
// 新增区域就是左右两条 336px 的白边（覆盖率 43.75%）。画布长边贴着远端 width 上限 1536，
// 用来验证 9 通道 inpaint 在大画布上的显存与边缘融合。
const OUTPAINT_CANVAS = { width: 1536, height: 864 }
const OUTPAINT_CONTENT = { x: 336, y: 0, width: 864, height: 864 }
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
  node test/gpu-live.mjs --preset sdxl-inpaint --inpaint --reference-size 1024x768 --mask-scale 0.05
  node test/gpu-live.mjs --preset sdxl-inpaint --inpaint --strength-compare 0.9,1.0
  node test/gpu-live.mjs --preset sdxl-inpaint --inpaint --inpaint-rounds 2
  node test/gpu-live.mjs --preset sdxl-lightning --upscale [--reference-size 768x768]
  node test/gpu-live.mjs --preset sdxl-inpaint --source-preset sdxl-lightning --outpaint

选项：
  --preset <id>     单预设模式（默认 sdxl-lightning），出图一张
  --presets a,b,c   单会话内按顺序连续切换模型出图，验证切换模型时的 LRU 缓存清理
  --prompt <text>   提示词（两种模式共用）
  --img2img         M3 图生图验收：文生图后用该图垫图重绘，记录显存对比（仅单预设）
  --inpaint         M3 局部重绘验收：文生图后用程序化蒙版做 Inpaint，记录显存对比（仅单预设）
  --upscale         Phase B1 高清放大验收：文生图后以该图为源发 tool=upscale，断言输出 = 源×2
  --outpaint        Phase B2 扩图验收：构造 1536x864 画布 + 白边蒙版做局部重绘，
                    并用像素差验证内容区保留（仅单预设；配合 --preset sdxl-inpaint 使用）
  --inpaint-prompt <text>
                    局部重绘使用单独的提示词（默认与 --prompt 相同）。给一段与文生图不同的描述，
                    才能肉眼确认白色蒙版区真的按新内容重写
  --reference-size WxH
                    仅 --inpaint / --upscale：源文生图的宽高（默认跟随 --source-preset 的 size），
                    用于非正方形验收（如 1024x768）；--upscale 时源图长边不能超过
                    UPSCALE.maxInputEdge（1280）
  --mask-scale <0~1>
                    仅 --inpaint：中心蒙版面积占画布的比例（如 0.05 = 5%）。
                    默认沿用 --mask-size 的旧口径（rect 为边长比例 0.4）
  --strength-compare <a,b,...>
                    仅 --inpaint：同一参考图与蒙版按多档强度各重绘一次（如 0.9,1.0），
                    report 记录每档的蒙版内平均差异；不能与 --inpaint-rounds 同时使用
  --inpaint-rounds <n>
                    仅 --inpaint：连续局部重绘轮数（1~3，默认 1）。第 2 轮起把上一轮出图
                    当作参考图继续重绘，用于验证「以结果继续重绘」；模型不重新加载
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
  --strength <n>    垫图 / 局部重绘强度（img2img 0.2~0.9；--inpaint 时上限放宽到 1.0，默认 0.6）
  --cli             用本机 kaggle CLI 推 Kernel（默认走直连，不需要 CLI）
  --keep            结束后不关机，保留 Kernel 便于手动观察
  --help, -h        显示本帮助；不会推送 Kernel，也不会消耗配额

前置条件：
  - 默认直连：本机有可用的 Kaggle 凭据（%USERPROFILE%\\.kaggle\\credentials.json
    或 access_token / kaggle.json），可在工作台用内置 OAuth 登录生成；
  - 加 --cli 时改为要求本机安装并登录 kaggle CLI：pip install -U kaggle；
  - Kaggle 账号已绑定手机号并启用 GPU 加速器，当天 GPU 配额充足

报告：bench-results/gpu-live/<时间戳>/report.json
  - models[]：每个预设的 modelId / pipelineKind / 加载秒数 / 出图秒数 / 出图宽高 / PNG 字节数
  - inpaint：局部重绘每轮/每档的 result 宽高、参考图与蒙版尺寸、蒙版覆盖率与蒙版内平均差异
  - upscale：--upscale 模式的源图/输出尺寸、加载与推理秒数、PNG 字节与前后显存
  - outpaint：--outpaint 模式的画布/内容区尺寸、新增区覆盖率、内容区像素差与前后显存
  - versions：远端 /health 上报的依赖版本快照（用于维护 LKGR 基线）
  - cacheLogs：远端 [cache] 日志摘要，拉取失败时为 null（不影响验证结论）

可用预设：${PRESETS.map((preset) => preset.id).join(', ')}`)
}

/** 按契约钳制并对齐一个出图尺寸（非正方形验收用）。 */
function normalizeDimensionValue(value, limits = LIMITS.width) {
  const number = Number(value)
  const { min, max, step } = limits
  const base = Number.isFinite(number) ? Math.round(number) : min
  const clamped = Math.min(max, Math.max(min, base))
  return Math.round(clamped / step) * step
}

/**
 * 按契约钳制重绘强度（两位小数，与 Host validator 同口径）。
 * ``ceiling`` 是场景上限：局部重绘传 ``LIMITS.strength.inpaintMax``，img2img 保持 ``max``。
 */
function normalizeStrengthValue(value, ceiling = LIMITS.strength.max) {
  const { min, max, step } = LIMITS.strength
  const hardMax = Math.max(max, Number(LIMITS.strength.inpaintMax) || max)
  const upper = Math.min(hardMax, Math.max(max, Number(ceiling) || max))
  const raw = Number.isFinite(Number(value)) ? Number(value) : LIMITS.strength.default
  const clamped = Math.min(upper, Math.max(min, raw))
  const aligned = min + Math.round((clamped - min) / step) * step
  return Math.round(Math.min(upper, Math.max(min, aligned)) * 100) / 100
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
  // Phase B 的两个验收模式：--upscale（远端 tool=upscale）与 --outpaint（构造画布后走 inpaint）。
  const upscale = process.argv.includes('--upscale')
  if (upscale && presets.length !== 1) throw new Error('--upscale 只能配合单个预设使用')
  const outpaint = process.argv.includes('--outpaint')
  if (outpaint && presets.length !== 1) throw new Error('--outpaint 只能配合单个预设使用')
  const modeCount = [img2img, inpaint, upscale, outpaint].filter(Boolean).length
  if (modeCount > 1) {
    throw new Error('--img2img / --inpaint / --upscale / --outpaint 是互相独立的验收模式，请分开运行')
  }
  // 局部重绘 / 扩图的源图预设：专用 inpaint 模型不能文生图，验收时先用普通模型出源图。
  const sourcePresetArg = String(argOf('source-preset', 'sdxl-lightning')).trim()
  if (!VALID_PRESET_IDS.has(sourcePresetArg)) {
    throw new Error(`未知源图预设：${sourcePresetArg}（可选：${[...VALID_PRESET_IDS].join(', ')}）`)
  }
  if (sourcePresetArg === presets[0] && (inpaint || outpaint)) {
    // 允许，但源图与重绘用同一预设时提示一次（专用模型会在生成阶段被拦）。
    console.log(`  · 提示：源图与重绘使用同一预设 ${sourcePresetArg}`)
  }
  if (outpaint) {
    const targetPreset = presetById(presets[0])
    if (targetPreset?.supportsInpaint !== true) {
      throw new Error(`--outpaint 需要支持局部重绘的预设（当前 ${presets[0]}），例如 sdxl-inpaint`)
    }
    if (targetPreset?.inpaintOnly === true && sourcePresetArg === presets[0]) {
      throw new Error(
        '专用 inpaint 模型不能文生图：--outpaint 请用 --source-preset 指定普通预设（例如 sdxl-lightning）',
      )
    }
  }
  if (upscale) {
    const sourcePreset = presetById(presets[0])
    if (Number(sourcePreset?.size) > UPSCALE.maxInputEdge) {
      throw new Error(
        `--upscale 的源图长边不能超过 ${UPSCALE.maxInputEdge}（预设 ${presets[0]} 是 ${sourcePreset.size}），请用 --reference-size 指定更小的源图`,
      )
    }
  }
  // 强度上限按场景：局部重绘允许契约 inpaintMax（1.0），img2img 仍用 max（0.9）。
  const rawStrength = Number(argOf('strength', String(LIMITS.strength.default)))
  const strength = normalizeStrengthValue(
    Number.isFinite(rawStrength) ? rawStrength : LIMITS.strength.default,
    inpaint ? LIMITS.strength.inpaintMax : LIMITS.strength.max,
  )
  // 非正方形验收：--reference-size WxH 同时决定源文生图宽高（蒙版按参考图同比例生成）。
  let referenceSize = null
  if (process.argv.includes('--reference-size')) {
    if (!inpaint && !upscale) {
      throw new Error('--reference-size 只能配合 --inpaint 或 --upscale 使用')
    }
    const raw = String(argOf('reference-size', '')).trim()
    const match = raw.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
    if (!match) throw new Error(`--reference-size 格式应为 WxH（例如 1024x768），收到 ${raw || '(空)'}`)
    referenceSize = {
      width: normalizeDimensionValue(Number(match[1]), LIMITS.width),
      height: normalizeDimensionValue(Number(match[2]), LIMITS.height),
    }
    if (upscale && Math.max(referenceSize.width, referenceSize.height) > UPSCALE.maxInputEdge) {
      throw new Error(
        `--reference-size 长边不能超过高清放大上限 ${UPSCALE.maxInputEdge}（收到 ${referenceSize.width}x${referenceSize.height}）`,
      )
    }
  }
  // --mask-scale 是中心蒙版的面积占比（rect 用 sqrt 换算边长比例），优先于旧的 --mask-size 口径。
  let maskScale = null
  if (process.argv.includes('--mask-scale')) {
    if (!inpaint) throw new Error('--mask-scale 只能配合 --inpaint 使用')
    const value = Number(argOf('mask-scale', ''))
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`--mask-scale 取值应在 (0, 1]，收到 ${argOf('mask-scale', '') || '(空)'}`)
    }
    maskScale = value
  }
  // 同一蒙版多档强度对比：各出一张，记录蒙版内平均差异（验收 §六 第 3 项）。
  let strengthCompare = null
  if (process.argv.includes('--strength-compare')) {
    if (!inpaint) throw new Error('--strength-compare 只能配合 --inpaint 使用')
    const parts = String(argOf('strength-compare', ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length < 2) {
      throw new Error('--strength-compare 至少给两档，例如 --strength-compare 0.9,1.0')
    }
    const values = []
    for (const part of parts) {
      const value = Number(part)
      if (!Number.isFinite(value)) throw new Error(`--strength-compare 含非法数值：${part}`)
      const normalized = normalizeStrengthValue(value, LIMITS.strength.inpaintMax)
      if (!values.includes(normalized)) values.push(normalized)
    }
    if (values.length < 2) throw new Error('--strength-compare 去重后不足两档')
    strengthCompare = values
  }
  // 连续局部重绘轮数：第 2 轮起把上一轮出图当参考图（验证「以结果继续重绘」）。
  const rawRounds = Number(argOf('inpaint-rounds', '1'))
  const inpaintRounds = Number.isFinite(rawRounds) ? Math.min(3, Math.max(1, Math.round(rawRounds))) : 1
  if (process.argv.includes('--inpaint-rounds') && !inpaint) {
    throw new Error('--inpaint-rounds 只能配合 --inpaint 使用')
  }
  if (strengthCompare && inpaintRounds > 1) {
    throw new Error('--strength-compare 与 --inpaint-rounds 是两种验收方式，请分开运行')
  }
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
    upscale,
    outpaint,
    strength,
    referenceSize,
    maskScale,
    strengthCompare,
    inpaintRounds,
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
 *
 * `width` / `height` 可选（默认跟随预设 size）：`--inpaint --reference-size` 用它生成
 * 非正方形源图，后续局部重绘按参考图同比例生成蒙版。
 */
async function generateOne({ endpoint, token, presetId, prompt, index, total, width, height }) {
  const preset = presetById(presetId)
  const pipelineKind = preset?.pipeline?.loader ?? null
  const taskWidth = width ?? preset.size
  const taskHeight = height ?? preset.size
  console.log(
    `  · [${index + 1}/${total}] ${presetId}（${pipelineKind ?? '-'}）加载并出图 ${taskWidth}x${taskHeight} …`,
  )
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
          width: taskWidth,
          height: taskHeight,
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
      // 实际出图尺寸（anima 会把宽高向下取整到 16 的倍数，与请求值可能不同）。
      width: result.width ?? null,
      height: result.height ?? null,
      requestedWidth: taskWidth,
      requestedHeight: taskHeight,
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
      (line) => typeof line === 'string' && /\[(load|gen|job|upscale)\]/.test(line),
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
 * 返回 `{ png, width, height, coverage, shape }`：`coverage` 是白色像素占全图比例
 * （与远端 decode_mask_image 的统计口径一致），报告里直接引用便于排障与验收记录。
 *
 * 尺寸口径（二者取其一）：
 *  - `scale`（面积占比 0~1）优先：rect 用边长 √scale、circle 用面积 = scale × 画布面积的
 *    圆/椭圆，白色区域面积 ≈ scale；
 *  - 否则沿用旧 `size` 口径：rect 的宽高 = 画布边长 × size，circle 直径 = 短边 × size。
 * `centerX` / `centerY` 是 0~1 的相对位置，默认画面中心；调小面积、移到具体物体上即可
 * 模拟真实笔刷的小面积涂抹。
 */
function buildMaskPng(width, height, options = {}) {
  const w = Math.max(16, Math.round(Number(width) || 0))
  const h = Math.max(16, Math.round(Number(height) || 0))
  const shape = options.shape === 'circle' ? 'circle' : 'rect'
  let radiusX
  let radiusY
  const rawScale = Number(options.scale)
  if (Number.isFinite(rawScale) && rawScale > 0) {
    const target = Math.min(1, rawScale)
    if (shape === 'circle') {
      const radius = Math.sqrt((target * w * h) / Math.PI)
      radiusX = radius
      radiusY = radius
    } else {
      const side = Math.sqrt(target)
      radiusX = (w * side) / 2
      radiusY = (h * side) / 2
    }
  } else {
    const rawSize = Number(options.size)
    const sizeRatio = Number.isFinite(rawSize) ? Math.min(1, Math.max(0.02, rawSize)) : 0.4
    radiusX = ((shape === 'circle' ? Math.min(w, h) : w) * sizeRatio) / 2
    radiusY = ((shape === 'circle' ? Math.min(w, h) : h) * sizeRatio) / 2
  }
  const rawCenterX = Number(options.centerX)
  const rawCenterY = Number(options.centerY)
  const centerX = Math.round(w * (Number.isFinite(rawCenterX) ? Math.min(1, Math.max(0, rawCenterX)) : 0.5))
  const centerY = Math.round(h * (Number.isFinite(rawCenterY) ? Math.min(1, Math.max(0, rawCenterY)) : 0.5))
  const left = Math.round(centerX - radiusX)
  const right = Math.round(centerX + radiusX)
  const top = Math.round(centerY - radiusY)
  const bottom = Math.round(centerY + radiusY)
  const raw = Buffer.alloc((w + 1) * h)
  let whitePixels = 0
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
      if (inside) whitePixels += 1
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return { png, width: w, height: h, coverage: whitePixels / (w * h), shape }
}

/** 读取 PNG 的 IHDR 宽高；非 PNG / 头部不完整返回 null。 */
function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * 最小 PNG 解码器（位深 8、非隔行、灰度/RGB/RGBA）：只用于计算「蒙版内平均差异」。
 *
 * 远端的样张是 PIL 默认保存的 8 位 RGB PNG；调色板 / 16 位 / 隔行图不在验收范围内，
 * 遇到不支持的格式返回 null（报告里的差异记 null，不影响出图验收本身）。
 */
function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  let offset = 8
  let header = null
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (data.length !== length) return null
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!header || header.bitDepth !== 8 || header.interlace !== 0) return null
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType]
  if (!channels) return null
  let raw
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  const stride = header.width * channels
  const pixels = Buffer.alloc(stride * header.height)
  let prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[pos]
    pos += 1
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    if (line.length !== stride) return null
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let value
      switch (filter) {
        case 0:
          value = line[x]
          break
        case 1:
          value = line[x] + a
          break
        case 2:
          value = line[x] + b
          break
        case 3:
          value = line[x] + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          value = line[x] + predictor
          break
        }
        default:
          return null
      }
      out[x] = value & 0xff
    }
    prev = out
  }
  return { width: header.width, height: header.height, channels, pixels }
}

/** 像素亮度：灰度取单通道、RGB/A 取 RGB 均值（与 decodePng 的通道布局对应）。 */
function pixelBrightness(image, index) {
  const offset = index * image.channels
  if (image.channels <= 2) return image.pixels[offset]
  return (image.pixels[offset] + image.pixels[offset + 1] + image.pixels[offset + 2]) / 3
}

/**
 * 两张同尺寸 PNG 在蒙版白色区域内的平均亮度绝对差异（0~255，保留两位小数）。
 * 尺寸不一致或任一张图无法解码时返回 null；蒙版按「任一通道 >=128 视为重绘区」
 * 判定（与远端「白 = 重绘」语义一致）。
 */
function maskedMeanDiff(basePng, otherPng, maskPng) {
  const base = decodePng(basePng)
  const other = decodePng(otherPng)
  const mask = decodePng(maskPng)
  if (!base || !other || !mask) return null
  if (
    base.width !== other.width ||
    base.height !== other.height ||
    base.width !== mask.width ||
    base.height !== mask.height
  ) {
    return null
  }
  let sum = 0
  let count = 0
  const total = mask.width * mask.height
  for (let index = 0; index < total; index += 1) {
    const maskOffset = index * mask.channels
    let white = false
    for (let channel = 0; channel < mask.channels; channel += 1) {
      if (mask.pixels[maskOffset + channel] >= 128) {
        white = true
        break
      }
    }
    if (!white) continue
    sum += Math.abs(pixelBrightness(base, index) - pixelBrightness(other, index))
    count += 1
  }
  if (!count) return null
  return Math.round((sum / count) * 100) / 100
}

/**
 * 把解码后的 RGB(A) 像素按 8 位 RGB 编码成 PNG（filter 0，无隔行）。
 * 扩图验收需要在 Node 侧合成画布：复用脚本里的 CRC/chunk/deflate 工具，不引第三方图像库。
 */
function encodePngRgb(width, height, pixels) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1)
    raw[row] = 0 // filter type: none
    pixels.copy(raw, row + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 构造扩图画布：内容区贴原图，新增区域用「四边 1px 边缘像素延拓」填充（edge clamp）。
 *
 * 为什么不再用纯白/纯黑填底（FIXES-INTERFACES §B）：纯色底在 VAE latent 边界与内容区之间
 * 制造亮度跳变，模型会把这段跳变当成真实画面去重画，成片在边界留下明显分界。边缘延拓让
 * 新增区从原图边缘「拉出去」，模型只需要延续已有纹理。
 *
 * 实现与前端 `outpaintEdgeStripsOf` 的 8 条拉伸条带像素结果完全一致：
 * 画布任意像素取内容框内最近边缘像素 `sx = clamp(x - content.x, 0, sw-1)`、
 * `sy = clamp(y - content.y, 0, sh-1)`；内容框内部这个映射就是恒等映射，所以一次遍历
 * 即可同时完成「延拓 + 贴内容区」，不需要另画条带再覆盖。
 */
function buildOutpaintCanvas(sourcePng, canvas = OUTPAINT_CANVAS, content = OUTPAINT_CONTENT) {
  const source = decodePng(sourcePng)
  if (!source) throw new Error('outpaint：无法解码源图 PNG')
  if (source.width !== content.width || source.height !== content.height) {
    throw new Error(
      `outpaint：源图应为 ${content.width}x${content.height}，收到 ${source.width}x${source.height}`,
    )
  }
  const pixels = Buffer.alloc(canvas.width * canvas.height * 3)
  const maxSourceX = source.width - 1
  const maxSourceY = source.height - 1
  for (let y = 0; y < canvas.height; y += 1) {
    // 内容框外按最近边缘像素延拓（等价于 top/bottom 条带把首/末行拉伸出去）。
    const sy = Math.min(Math.max(y - content.y, 0), maxSourceY)
    const sourceRow = sy * source.width * source.channels
    const targetRow = y * canvas.width * 3
    for (let x = 0; x < canvas.width; x += 1) {
      const sx = Math.min(Math.max(x - content.x, 0), maxSourceX)
      const sourceOffset = sourceRow + sx * source.channels
      const targetOffset = targetRow + x * 3
      pixels[targetOffset] = source.pixels[sourceOffset]
      pixels[targetOffset + 1] =
        source.channels >= 3 ? source.pixels[sourceOffset + 1] : source.pixels[sourceOffset]
      pixels[targetOffset + 2] =
        source.channels >= 3 ? source.pixels[sourceOffset + 2] : source.pixels[sourceOffset]
    }
  }
  return {
    png: encodePngRgb(canvas.width, canvas.height, pixels),
    width: canvas.width,
    height: canvas.height,
    content: { ...content },
    sourceSize: { width: source.width, height: source.height },
    // 可断言标记：report.outpaint.canvasFill 直接引用（FIXES-INTERFACES §B3）。
    fill: 'edge-extend',
  }
}

/** 构造扩图蒙版：白 = 新增区域（内容区之外），黑 = 保留区域（原图内容区）。 */
function buildOutpaintMaskPng(canvas = OUTPAINT_CANVAS, content = OUTPAINT_CONTENT) {
  const raw = Buffer.alloc((canvas.width + 1) * canvas.height)
  let whitePixels = 0
  for (let y = 0; y < canvas.height; y += 1) {
    const row = y * (canvas.width + 1)
    raw[row] = 0
    for (let x = 0; x < canvas.width; x += 1) {
      const inContent =
        x >= content.x &&
        x < content.x + content.width &&
        y >= content.y &&
        y < content.y + content.height
      raw[row + 1 + x] = inContent ? 0 : 255
      if (!inContent) whitePixels += 1
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(canvas.width, 0)
  ihdr.writeUInt32BE(canvas.height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // color type: grayscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return { png, coverage: whitePixels / (canvas.width * canvas.height) }
}

/**
 * 内容区保留度统计：把源图内容逐像素与「出图对应内容区」比较，返回平均亮度绝对差。
 *
 * `margin` 用来避开羽化过渡带（远端按蒙版覆盖率把白色区域外扩 6~8px 再高斯羽化，
 * 内容区边界附近会被生成结果替换）；`margin` 越大越接近「纯保留区」的差异。
 * 尺寸不一致 / 无法解码返回 null。
 */
function contentRegionDiff(sourcePng, outPng, content = OUTPAINT_CONTENT, margin = 0) {
  const source = decodePng(sourcePng)
  const out = decodePng(outPng)
  if (!source || !out) return null
  if (source.width !== content.width || source.height !== content.height) return null
  if (out.width < content.x + content.width || out.height < content.y + content.height) return null
  const x0 = Math.max(0, margin)
  const y0 = Math.max(0, margin)
  const x1 = content.width - Math.max(0, margin)
  const y1 = content.height - Math.max(0, margin)
  if (x1 <= x0 || y1 <= y0) return null
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const sourceIndex = y * content.width + x
      const outIndex = (content.y + y) * out.width + (content.x + x)
      sum += Math.abs(pixelBrightness(source, sourceIndex) - pixelBrightness(out, outIndex))
      count += 1
    }
  }
  if (!count) return null
  return Math.round((sum / count) * 100) / 100
}

/**
 * Phase B1 真机验收：把刚生成的图作为源图发 `tool=upscale`。
 *
 * 远端不读 pipeline / tasks，只收 `{tool, reference:{image_b64}}`；结果里的
 * `sourceWidth` / `sourceHeight` / `scale` 是 daemon 合成的协议字段，这里再断言一次
 * 输出尺寸 = 源图 × factor（PNG 头与 results 字段两边都要对）。
 */
async function runUpscale({ endpoint, token, sourcePng }) {
  const sourceSize = pngSize(sourcePng)
  if (!sourceSize) throw new Error('upscale：无法读取源图尺寸')
  console.log(
    `  · [upscale] 源图 ${sourceSize.width}x${sourceSize.height}（${sourcePng.length} 字节），提交 tool=upscale …`,
  )
  const begin = Date.now()
  // 单独走 submitGenerate + waitForJob（requestGenerate 就是这两步）是为了记录轮询间隔：
  // 2560x1440 的输出 base64 有 ~8MB，/job 单次请求超时是 8s（TIMEOUTS.remoteJobRequestMs），
  // 需要看下载响应体是否逼近超时、有没有触发重试（wallSeconds 会明显大于耗时之和）。
  const submitted = await submitGenerate(endpoint, token, {
    tool: 'upscale',
    reference: { image_b64: sourcePng.toString('base64') },
  })
  const submitMs = Date.now() - begin
  const pollTimes = []
  const response = await waitForJob(endpoint, token, submitted.job_id, {
    timeoutMs: 600000,
    onProgress: () => pollTimes.push(Date.now()),
  })
  const pollGaps = pollTimes.slice(1).map((time, index) => time - pollTimes[index])
  const maxPollGapMs = pollGaps.length ? Math.max(...pollGaps) : null
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('upscale：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('upscale：返回内容不是合法 PNG')
  const outputSize = pngSize(png)
  const factor = Number(result.scale) || UPSCALE.factor
  const expected = { width: sourceSize.width * factor, height: sourceSize.height * factor }
  const actual = {
    width: Number(result.width ?? 0),
    height: Number(result.height ?? 0),
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `upscale：results 尺寸不符，期望 ${expected.width}x${expected.height}，收到 ${actual.width}x${actual.height}`,
    )
  }
  if (outputSize && (outputSize.width !== expected.width || outputSize.height !== expected.height)) {
    throw new Error(
      `upscale：输出 PNG 尺寸不符，期望 ${expected.width}x${expected.height}，收到 ${outputSize.width}x${outputSize.height}`,
    )
  }
  console.log(
    `  · 高清放大完成：${sourceSize.width}x${sourceSize.height} → ${expected.width}x${expected.height}，` +
      `加载 ${response.load_seconds ?? '-'}s / 推理 ${result.seconds ?? '-'}s / PNG ${png.length} 字节`,
  )
  return {
    png,
    entry: {
      sourcePreset: null,
      factor,
      sourceWidth: Number(result.sourceWidth ?? sourceSize.width),
      sourceHeight: Number(result.sourceHeight ?? sourceSize.height),
      width: expected.width,
      height: expected.height,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
      upscale: result.upscale === true,
      // 轮询观测：submitMs / pollCount / maxPollGapMs 用于判断大响应体是否逼近 8s 单次超时。
      submitMs,
      pollCount: pollTimes.length,
      maxPollGapMs,
      imageBase64Bytes: Math.ceil(png.length / 3) * 4,
    },
  }
}

/**
 * Phase B2 真机验收：构造「1536x864 画布 + 864x864 原图居中 + 白边蒙版」发局部重绘。
 *
 * 远端把画布当参考图、把蒙版当重绘区域（白 = 新增区域），strength 固定 1.0（新区域
 * 完全重画）。用内容区像素差验证「原图内容没被改」（≈0 说明 composite 保留生效），
 * margin 16px 避开蒙版羽化过渡带。
 */
async function runOutpaint({ endpoint, token, presetId, sourcePng, prompt }) {
  const preset = presetById(presetId)
  const composed = buildOutpaintCanvas(sourcePng)
  const mask = buildOutpaintMaskPng()
  console.log(
    `  · [outpaint] 画布 ${composed.width}x${composed.height}（内容区 ${composed.content.width}x` +
      `${composed.content.height} @ ${composed.content.x},${composed.content.y}，新增区域 ` +
      `${(mask.coverage * 100).toFixed(2)}%，画布 ${composed.png.length} 字节，蒙版 ${mask.png.length} 字节）…`,
  )
  const begin = Date.now()
  const response = await requestGenerate(
    endpoint,
    token,
    {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      reference: {
        image_b64: composed.png.toString('base64'),
        mask_b64: mask.png.toString('base64'),
        strength: OUTPAINT.strength,
      },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed: 45,
          width: composed.width,
          height: composed.height,
          steps: preset.steps,
          cfg: preset.cfg,
        },
      ],
    },
    { timeoutMs: 600000 },
  )
  const wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
  const result = response.results?.[0]
  if (!result?.image_b64) throw new Error('outpaint：远端没有返回图片')
  const png = Buffer.from(result.image_b64, 'base64')
  const isPng = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!isPng) throw new Error('outpaint：返回内容不是合法 PNG')
  const outputSize = pngSize(png)
  if (
    outputSize &&
    (outputSize.width !== composed.width || outputSize.height !== composed.height)
  ) {
    throw new Error(
      `outpaint：输出尺寸不符，期望 ${composed.width}x${composed.height}，收到 ${outputSize.width}x${outputSize.height}`,
    )
  }
  const contentMeanDiff = contentRegionDiff(sourcePng, png, composed.content, 0)
  const contentCoreMeanDiff = contentRegionDiff(sourcePng, png, composed.content, 16)
  const contentPreserved = contentCoreMeanDiff !== null && contentCoreMeanDiff <= 1.0
  console.log(
    `  · 扩图完成：${composed.width}x${composed.height}，加载 ${response.load_seconds ?? '-'}s / ` +
      `推理 ${result.seconds ?? '-'}s / PNG ${png.length} 字节；内容区平均差 ${contentMeanDiff ?? '-'}` +
      `（核心区 ${contentCoreMeanDiff ?? '-'}，${contentPreserved ? '内容保留正常' : '内容被改动'}）`,
  )
  return {
    png,
    canvasPng: composed.png,
    maskPng: mask.png,
    entry: {
      preset: presetId,
      strength: OUTPAINT.strength,
      sourceWidth: composed.sourceSize.width,
      sourceHeight: composed.sourceSize.height,
      width: outputSize?.width ?? composed.width,
      height: outputSize?.height ?? composed.height,
      canvasWidth: composed.width,
      canvasHeight: composed.height,
      content: composed.content,
      // 画布新增区的填充方式：edge-extend = 四边 1px 边缘像素延拓（FIXES-INTERFACES §B3）。
      canvasFill: composed.fill,
      coveragePercent: Number((mask.coverage * 100).toFixed(4)),
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: result.seconds ?? null,
      wallSeconds,
      pngBytes: png.length,
      isPng,
      contentMeanDiff,
      contentCoreMeanDiff,
      contentPreserved,
    },
  }
}

/**
 * 局部重绘单次执行（一次远端 /generate）：给定参考图 + 程序化蒙版，返回 PNG、蒙版与报告条目。
 *
 * 关键观察点：`load_seconds` 应为 0（`AutoPipelineForInpainting.from_pipe` 复用已加载底座）；
 * 出图尺寸跟随参考图；提交形状与 Host 下发一致：job 级 `reference = { image_b64, strength, mask_b64 }`。
 * 蒙版尺寸按参考图实际尺寸生成（非正方形验收时与源图同比例）。
 */
async function runInpaintOnce({ endpoint, token, presetId, sourcePng, prompt, strength, maskOptions = {} }) {
  const preset = presetById(presetId)
  const sourceSize = pngSize(sourcePng) ?? { width: preset.size, height: preset.size }
  const mask = buildMaskPng(sourceSize.width, sourceSize.height, maskOptions)
  const maskLabel = mask.shape === 'circle' ? '圆形' : '矩形'
  console.log(
    `  · [inpaint] ${presetId} 参考图 ${sourceSize.width}x${sourceSize.height} + ${maskLabel}蒙版 ` +
      `（strength=${strength}，覆盖率 ${(mask.coverage * 100).toFixed(2)}%，${mask.png.length} 字节）…`,
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
        mask_b64: mask.png.toString('base64'),
      },
      tasks: [
        {
          name: '01',
          prompt,
          negative_prompt: preset.negativeHint ?? '',
          seed: 44,
          width: sourceSize.width,
          height: sourceSize.height,
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
    maskPng: mask.png,
    entry: {
      preset: presetId,
      strength,
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      referenceBytes: sourcePng.length,
      maskBytes: mask.png.length,
      maskCoveragePercent: Number((mask.coverage * 100).toFixed(4)),
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

/**
 * 局部重绘验收编排：连续多轮（--inpaint-rounds）或同一参考图多档强度（--strength-compare）。
 *
 * - 连续多轮：第 2 轮起把上一轮出图当参考图继续重绘，模型不重新加载（load_seconds 应为 0）；
 * - 强度对比：同一参考图与同一蒙版重复出图，只换 strength；
 * - 每轮差异 `maskedMeanDiffFromPrevious` 是「本轮出图 vs 本轮参考图」在蒙版内的平均亮度差，
 *   `maskedMeanDiffFromSource` 统一对比最初的源图（尺寸不一致时为 null）。
 *
 * 返回 `{ runs, report }`：runs 供落盘样张，report 是 report.json 里的 inpaint 段。
 */
async function runInpaint({ endpoint, token, presetId, sourcePng, prompt, options, maskOptions = {} }) {
  const compare = Array.isArray(options.strengthCompare) && options.strengthCompare.length > 0
  const strengths = compare ? options.strengthCompare : [options.strength]
  const rounds = compare ? 1 : Math.max(1, options.inpaintRounds ?? 1)
  const totalRuns = compare ? strengths.length : rounds
  const runs = []
  let referencePng = sourcePng
  let previousPng = sourcePng
  for (let index = 0; index < totalRuns; index += 1) {
    const round = index + 1
    const strength = compare ? strengths[index] : options.strength
    const referenceRole = compare || round === 1 ? 'source' : 'previous-round'
    if (compare) {
      console.log(`  · [inpaint] 强度对比 ${round}/${totalRuns}：strength=${strength}`)
    } else if (round > 1) {
      console.log(`  · [inpaint] 连续重绘第 ${round}/${totalRuns} 轮：以上一轮出图为参考图`)
    }
    const run = await runInpaintOnce({
      endpoint,
      token,
      presetId,
      sourcePng: referencePng,
      prompt,
      strength,
      maskOptions,
    })
    const diffFromPrevious = maskedMeanDiff(previousPng, run.png, run.maskPng)
    const diffFromSource =
      referenceRole === 'source' ? diffFromPrevious : maskedMeanDiff(sourcePng, run.png, run.maskPng)
    runs.push({ ...run, round, strength, referenceRole, diffFromPrevious, diffFromSource })
    previousPng = run.png
    if (!compare) referencePng = run.png
    console.log(
      `  · 出图 ${run.entry.width ?? '?'}x${run.entry.height ?? '?'}，蒙版内平均差异 ` +
        `${diffFromPrevious ?? '-'}（对源图 ${diffFromSource ?? '-'}）`,
    )
  }
  const sourceSize = pngSize(sourcePng) ?? { width: null, height: null }
  const perRun = runs.map((run) => ({
    round: run.round,
    strength: run.strength,
    referenceRole: run.referenceRole,
    loadSeconds: run.entry.loadSeconds,
    imageSeconds: run.entry.imageSeconds,
    wallSeconds: run.entry.wallSeconds,
    width: run.entry.width,
    height: run.entry.height,
    sourceWidth: run.entry.sourceWidth,
    sourceHeight: run.entry.sourceHeight,
    referenceWidth: run.entry.referenceWidth,
    referenceHeight: run.entry.referenceHeight,
    maskWidth: run.entry.maskWidth,
    maskHeight: run.entry.maskHeight,
    maskCoveragePercent: run.entry.maskCoveragePercent,
    referenceBytes: run.entry.referenceBytes,
    maskBytes: run.entry.maskBytes,
    pngBytes: run.entry.pngBytes,
    maskedMeanDiffFromPrevious: run.diffFromPrevious,
    maskedMeanDiffFromSource: run.diffFromSource,
  }))
  const first = perRun[0]
  const report = {
    preset: presetId,
    prompt,
    mode: compare ? 'strength-compare' : rounds > 1 ? 'rounds' : 'single',
    sourcePreset: options.sourcePreset,
    requestedReferenceSize: options.referenceSize
      ? [options.referenceSize.width, options.referenceSize.height]
      : null,
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    maskShape: options.maskShape,
    maskSize: options.maskSize,
    maskScale: options.maskScale,
    maskCenter: [options.maskCenterX, options.maskCenterY],
    rounds: perRun,
    // 兼容字段（第一次出图）：旧报告消费方按这些键读单次局部重绘结果。
    strength: first.strength,
    referenceBytes: first.referenceBytes,
    maskBytes: first.maskBytes,
    loadSeconds: first.loadSeconds,
    imageSeconds: first.imageSeconds,
    width: first.width,
    height: first.height,
    referenceWidth: first.referenceWidth,
    referenceHeight: first.referenceHeight,
    maskWidth: first.maskWidth,
    maskHeight: first.maskHeight,
    maskCoveragePercent: first.maskCoveragePercent,
    pngBytes: first.pngBytes,
  }
  return { runs, report }
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
          ? '[4/5] 文生图 + 程序化蒙版局部重绘' +
            `（${options.strengthCompare ? `强度对比 ${options.strengthCompare.join('/')}` : `${options.inpaintRounds ?? 1} 轮`}` +
            `${options.referenceSize ? `，参考尺寸 ${options.referenceSize.width}x${options.referenceSize.height}` : ''}` +
            `${options.maskScale ? `，蒙版面积 ${(options.maskScale * 100).toFixed(1)}%` : ''}）…`
          : options.upscale
            ? '[4/5] 文生图 + tool=upscale 高清放大' +
              `（源图 ${options.referenceSize ? `${options.referenceSize.width}x${options.referenceSize.height}` : '跟随预设 size'}）…`
            : options.outpaint
              ? `[4/5] 文生图 + 扩图（画布 ${OUTPAINT_CANVAS.width}x${OUTPAINT_CANVAS.height}，` +
                `内容区 ${OUTPAINT_CONTENT.width}x${OUTPAINT_CONTENT.height} 居中，strength ${OUTPAINT.strength}）…`
              : single
                ? '[4/5] 生成一张 …'
                : `[4/5] 在同一会话内连续生成 ${options.presets.length} 个模型（验证 LRU 缓存清理）…`,
    )
    const models = []
    const images = []
    let img2imgReport = null
    let inpaintReport = null
    let upscaleReport = null
    let outpaintReport = null
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
      // 真机验收：先文生图，再用程序化蒙版做局部重绘；支持非正方形源图 / 连续多轮 / 强度对比。
      if (!single) throw new Error('--inpaint 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsInpaint !== true) {
        throw new Error(`预设 ${presetId} 不支持局部重绘（supportsInpaint=false），请换 SDXL 家族预设`)
      }
      // 专用 inpaint 模型不能文生图：源图用 --source-preset（默认 sdxl-lightning）先出。
      // --reference-size 同时决定源文生图宽高，局部重绘蒙版按源图实际尺寸（同比例）生成。
      const sourcePresetId = options.sourcePreset
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
        width: options.referenceSize?.width,
        height: options.referenceSize?.height,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ` +
          `${txt2img.entry.width ?? '?'}x${txt2img.entry.height ?? '?'}`,
      )
      const before = await readGpuMemory(endpoint, token)
      const { runs: inpaintRuns, report } = await runInpaint({
        endpoint,
        token,
        presetId,
        sourcePng: txt2img.png,
        prompt: options.inpaintPrompt,
        options,
        maskOptions: {
          shape: options.maskShape,
          size: options.maskSize,
          scale: options.maskScale,
          centerX: options.maskCenterX,
          centerY: options.maskCenterY,
        },
      })
      const after = await readGpuMemory(endpoint, token)
      const multiRun = inpaintRuns.length > 1
      inpaintRuns.forEach((run) => {
        const label = options.strengthCompare
          ? `strength-${run.strength}`
          : multiRun
            ? `round${run.round}`
            : ''
        images.push({
          index: 'inpaint',
          presetId: `${presetId}-inpaint`,
          png: run.png,
          name: label ? `02-inpaint-${label}.png` : '02-inpaint.png',
        })
        console.log(
          `  · 局部重绘${multiRun ? `第 ${run.round}/${inpaintRuns.length} 轮` : ''}完成：加载 ` +
            `${run.entry.loadSeconds ?? '-'}s / 出图 ${run.entry.imageSeconds ?? '-'}s` +
            `（${run.entry.width ?? '?'}x${run.entry.height ?? '?'}，参考图 ` +
            `${run.entry.referenceWidth ?? '?'}x${run.entry.referenceHeight ?? '?'}，蒙版 ` +
            `${run.entry.maskWidth ?? '?'}x${run.entry.maskHeight ?? '?'}，覆盖率 ` +
            `${run.entry.maskCoveragePercent ?? '?'}%，蒙版内平均差异 ${run.diffFromPrevious ?? '-'}）`,
        )
      })
      console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 局部重绘后 ${fmt(after)}`)
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      inpaintReport = {
        ...report,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // from_pipe 复用底座不应重新加载权重：每轮 load_seconds 期望为 0 或接近 0。
        reusedBasePipeline: inpaintRuns.every((run) => (run.entry.loadSeconds ?? 0) === 0),
      }
    } else if (options.upscale) {
      // Phase B1 真机验收：先文生图（默认 preset size，或 --reference-size），再发 tool=upscale。
      if (!single) throw new Error('--upscale 只能配合单个 --preset 使用')
      const sourcePresetId = options.presets[0]
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
        width: options.referenceSize?.width,
        height: options.referenceSize?.height,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      const sourceSize = pngSize(txt2img.png)
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ` +
          `${sourceSize?.width ?? '?'}x${sourceSize?.height ?? '?'}`,
      )
      const before = await readGpuMemory(endpoint, token)
      const upscale = await runUpscale({ endpoint, token, sourcePng: txt2img.png })
      const after = await readGpuMemory(endpoint, token)
      images.push({
        index: 'upscale',
        presetId: `${sourcePresetId}-upscale`,
        png: upscale.png,
        name: '02-upscale.png',
      })
      console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 放大后 ${fmt(after)}`)
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      upscaleReport = {
        ...upscale.entry,
        sourcePreset: sourcePresetId,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // 输出应是源图的整数倍（INTERFACES §2.6 的硬断言）：
        // 宽高比与 factor 在 runUpscale 里已校验，这里补一个可读布尔值供报告消费。
        outputMatchesSource: upscale.entry.width === txt2img.entry.width * upscale.entry.factor,
      }
      if (!upscaleReport.outputMatchesSource) {
        throw new Error(
          `upscale：输出 ${upscale.entry.width}x${upscale.entry.height} 不是源图 ` +
            `${txt2img.entry.width}x${txt2img.entry.height} 的 ${upscale.entry.factor} 倍`,
        )
      }
    } else if (options.outpaint) {
      // Phase B2 真机验收：源图 864x864（专用 inpaint 预设不能文生图，源图先由普通预设出），
      // 然后构造「1536x864 画布 + 白边蒙版」提交局部重绘，并用像素差验证内容区保留。
      if (!single) throw new Error('--outpaint 只能配合单个 --preset 使用')
      const presetId = options.presets[0]
      const preset = presetById(presetId)
      if (preset?.supportsInpaint !== true) {
        throw new Error(`预设 ${presetId} 不支持局部重绘（supportsInpaint=false），请换 SDXL 家族预设`)
      }
      const sourcePresetId = options.sourcePreset
      const txt2img = await generateOne({
        endpoint,
        token,
        presetId: sourcePresetId,
        prompt: options.prompt,
        index: 0,
        total: 1,
        width: OUTPAINT_CONTENT.width,
        height: OUTPAINT_CONTENT.height,
      })
      models.push(txt2img.entry)
      images.push({ index: 0, presetId: sourcePresetId, png: txt2img.png })
      const sourceSize = pngSize(txt2img.png)
      if (
        sourceSize &&
        (sourceSize.width !== OUTPAINT_CONTENT.width || sourceSize.height !== OUTPAINT_CONTENT.height)
      ) {
        throw new Error(
          `outpaint：源图应为 ${OUTPAINT_CONTENT.width}x${OUTPAINT_CONTENT.height}，` +
            `收到 ${sourceSize.width}x${sourceSize.height}`,
        )
      }
      console.log(
        `  · ${sourcePresetId} 文生图完成：加载 ${txt2img.entry.loadSeconds ?? '-'}s / 出图 ` +
          `${sourceSize?.width ?? '?'}x${sourceSize?.height ?? '?'}`,
      )
      const before = await readGpuMemory(endpoint, token)
      const outpaint = await runOutpaint({
        endpoint,
        token,
        presetId,
        sourcePng: txt2img.png,
        prompt: options.prompt,
      })
      const after = await readGpuMemory(endpoint, token)
      images.push(
        {
          index: 'outpaint',
          presetId: `${presetId}-outpaint`,
          png: outpaint.png,
          name: '02-outpaint.png',
        },
        {
          index: 'outpaint-canvas',
          presetId: `${presetId}-outpaint`,
          png: outpaint.canvasPng,
          name: '02-outpaint-canvas.png',
        },
        {
          index: 'outpaint-mask',
          presetId: `${presetId}-outpaint`,
          png: outpaint.maskPng,
          name: '02-outpaint-mask.png',
        },
      )
      console.log(`  · 显存对比（MiB）：文生图后 ${fmt(before)} → 扩图后 ${fmt(after)}`)
      const reservedDeltaMb =
        Number.isFinite(before?.reserved_mb) && Number.isFinite(after?.reserved_mb)
          ? after.reserved_mb - before.reserved_mb
          : null
      outpaintReport = {
        ...outpaint.entry,
        sourcePreset: sourcePresetId,
        gpuMemoryBefore: before,
        gpuMemoryAfter: after,
        reservedDeltaMb,
        // 内容区核心像素与源图应几乎一致（composite 保留原图像素）；
        // 差异过大说明扩图改写了保留区（硬接缝/整图重绘），验收不通过。
        contentPreserved: outpaint.entry.contentPreserved,
      }
      if (!outpaintReport.contentPreserved) {
        throw new Error(
          `outpaint：内容区被改动（核心区平均差 ${outpaint.entry.contentCoreMeanDiff}），` +
            '预期 composite 保留原图像素（≈0）',
        )
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
        image.name ??
        (image.index === 'img2img'
          ? '01-img2img.png'
          : image.index === 'inpaint'
            ? '02-inpaint.png'
            : image.index === 'upscale'
              ? '02-upscale.png'
              : image.index === 'outpaint'
                ? '02-outpaint.png'
                : artifactName(image.index, image.presetId, options.presets.length))
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
      // Phase B1：--upscale 模式下的源图/输出尺寸、加载与推理秒数、显存对比（非该模式为 null）。
      upscale: upscaleReport,
      // Phase B2：--outpaint 模式的画布/内容区、内容区像素差与显存对比（非该模式为 null）。
      outpaint: outpaintReport,
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

// 离线校验 PNG 辅助函数（画布/蒙版/像素差）时置 GPU_LIVE_SKIP_MAIN=1：只加载函数，
// 不推送 Kernel、不消耗配额；真机运行不带该变量，行为与改造前完全一致。
if (process.env.GPU_LIVE_SKIP_MAIN !== '1') {
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
}

// 真机验收脚本不对外提供 API；这里只把 PNG 辅助函数与参数解析导出给离线自检
// （`GPU_LIVE_SKIP_MAIN=1`，不推送 Kernel、不消耗配额）。
export {
  OUTPAINT_CANVAS,
  OUTPAINT_CONTENT,
  buildOutpaintCanvas,
  buildOutpaintMaskPng,
  contentRegionDiff,
  decodePng,
  encodePngRgb,
  parseOptions,
}
