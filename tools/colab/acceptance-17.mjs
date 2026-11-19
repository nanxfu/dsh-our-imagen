#!/usr/bin/env node
/**
 * 阶段十七真机验收（Colab L4）：z-image-turbo 连出/重绘 + qwen-image-2.1 多图参考/RGBA。
 *
 * 覆盖 ROADMAP §十七.4 的两条待收口项，单次会话内先跑 z-image-turbo、再切 qwen-image-2.1：
 *
 *   A1 z-image-turbo 文生图第 1 张（记录加载秒数、首图秒数、PNG 宽高与字节数）；
 *   A2 同会话第 2 张连出（期望 load_seconds=0，即「连出稳态」）；
 *   A3 原生 img2img：以 A1 为参考图 + strength 0.6 + 换提示词，出图应为 1024²，
 *      并用 Pillow 计算与 A1 的平均绝对差 / 变化像素比例；
 *   A4 原生 inpaint：A1 + 约 25% 覆盖率的居中白圆蒙版 + strength 0.8 + 定向提示词，
 *      校验日志走 inpaint 分支、from_pipe 复用（load_seconds=0），且蒙版外像素差≈0、
 *      蒙版内明显改变；
 *   B1 qwen-image-2.1 文生图 1024²（记录切模型的加载秒数）；
 *   B2 多图参考 referenceImages=2（A1/A3 缩到长边≤1024），出图 1024² 且参考条件生效
 *      —— 用「同提示词/同 seed 但不带参考图的对照 B2ctl」证明参考图确实改变了输出；
 *   B3 RGBA 事实评估：Pillow 读取 B1/B2/B3 的实际颜色模式与 alpha 分布，再发一张
 *      「透明背景 / 贴纸」提示词，结论只写观察到的可证实事实；
 *   C  收尾：stop() 后确认 assignments=0、CCU assignmentsCount=0、无遗留 Kernel。
 *
 * 产物：
 *   .tmp/colab/acceptance-17.json   结构化报告（session、逐步 job、像素对比、checks、CCU/assignments）
 *   .tmp/colab/acceptance-17/*.png  每步出图 + 蒙版 + 参考图副本（文件名带步骤号）
 *
 * 用法：
 *   node tools/colab/acceptance-17.mjs                 # 完整真机验收（消耗 CCU）
 *   node tools/colab/acceptance-17.mjs --check         # 只做离线校验，不连 Colab
 *   node tools/colab/acceptance-17.mjs --gpu L4 --skip-control
 *   node tools/colab/acceptance-17.mjs --report .tmp/colab/acceptance-17.json --out .tmp/colab/acceptance-17
 *
 * 参数：
 *   --gpu <L4|T4|A100>  Colab GPU 档位（默认 L4；z-image-turbo / qwen-image-2.1 都只在 Colab 提供）
 *   --high-ram          申请高内存机型（默认关闭，与 2026-11-19 的既有实测口径一致）
 *   --skip-control      跳过 B2ctl 对照项（省一张 qwen 推理，但「参考生效」证据会弱一些）
 *   --report <path>     报告落盘路径（默认 .tmp/colab/acceptance-17.json）
 *   --out <dir>         PNG 产物目录（默认 .tmp/colab/acceptance-17）
 *   --check             离线校验（预设/图像分析工具/凭据镜像/路径），不消耗 CCU
 *   --help, -h          显示本帮助
 *
 * 凭据说明：本机 DSH 沙箱禁止写 `~/.imagen/`，而 `lib/colab/client.js` 的 accessToken()
 * 在令牌过期时会刷新并回写凭据文件。脚本因此把凭据镜像到 `<workspace>/.tmp/colab/
 * colab-credentials.json`，并通过该库官方支持的环境变量 `IMAGEN_COLAB_CREDENTIALS`
 * 指向镜像（`.tmp/` 已在 .gitignore 内）。token 绝不打印、绝不写入报告。
 *
 * 图像分析交给 `tools/colab/image-analysis.py`（Pillow + numpy）；结果用 --out JSON
 * 文件回传而不是 stdout 管道：本机沙箱下 Node 用管道捕获子进程输出会 EPERM。
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { LIMITS, PRESETS } from '../../shared/contract.js'
import { mergeSettings } from '../../lib/settings.js'
import { fetchHealth, requestGenerate, requestLogs } from '../../lib/remote.js'
import { SessionManager } from '../../lib/session.js'
import { accessToken, ccuInfo, listAssignments } from '../../lib/colab/client.js'
import { readHfToken } from '../verify-model.mjs'

const WORKSPACE = process.cwd()
const args = process.argv.slice(2)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}
const help = args.includes('--help') || args.includes('-h')
const checkOnly = args.includes('--check')
const skipControl = args.includes('--skip-control')
const highRam = args.includes('--high-ram')
const gpu = String(argValue('--gpu') || 'L4').trim().toUpperCase()
const OUT_DIR = resolve(WORKSPACE, argValue('--out') || '.tmp/colab/acceptance-17')
const REPORT_PATH = resolve(WORKSPACE, argValue('--report') || '.tmp/colab/acceptance-17.json')
const ANALYSIS_DIR = join(OUT_DIR, '_analysis')
const PY_TOOL = join(WORKSPACE, 'tools/colab/image-analysis.py')

// 与 tools/colab/smoke-provider.mjs 的 PROMPT 逐字一致（便于与既有 measured 数据对齐）。
const PROMPT =
  'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail'
const SEED = 42
const IMG2IMG_PROMPT =
  'A red-crowned crane standing in a snowy lotus pond under cold blue moonlight, night, snow, blue tones, Chinese ink painting'
const INPAINT_PROMPT =
  'A large blue elephant with glowing red lanterns standing in a misty lotus pond at dawn, Chinese ink painting, fine detail'
const REFERENCE_PROMPT =
  'Fuse the two reference images into one new scene: a red-crowned crane and a blue elephant together in a misty lotus pond at dawn, Chinese ink painting'
const STICKER_PROMPT =
  'A cute cartoon panda sticker, full body, isolated on a fully transparent background, sticker style, thick white outline, no background, PNG with alpha channel'
const REQUEST_TIMEOUT_MS = 25 * 60 * 1000
const MASK_COVERAGE = 0.25
// 局部重绘保留区统计的外扩像素：远端羽化半径 8 + 高斯半径 4，合计影响范围约 20px。
const MASK_KEEP_PAD = 24

const stamp = () => new Date().toISOString().slice(11, 19)
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const sink = {
  debug: () => {},
  info: (...items) => console.log(`${stamp()} info  ${items.join(' ')}`),
  warn: (...items) => console.log(`${stamp()} warn  ${items.join(' ')}`),
  error: (...items) => console.log(`${stamp()} error ${items.join(' ')}`),
}

const CHECKS = []
function check(name, ok, detail = '') {
  CHECKS.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function usage() {
  return [
    '用法：node tools/colab/acceptance-17.mjs [--gpu L4|T4|A100] [--high-ram] [--skip-control]',
    '                                         [--report <path>] [--out <dir>] [--check] [--help]',
    '',
    '  --gpu <档位>     Colab GPU 档位（默认 L4）',
    '  --high-ram       申请高内存机型（默认关闭）',
    '  --skip-control   跳过 B2ctl 对照项（少一张 qwen 推理）',
    '  --report <path>  报告落盘路径（默认 .tmp/colab/acceptance-17.json）',
    '  --out <dir>      PNG 产物目录（默认 .tmp/colab/acceptance-17）',
    '  --check          只做离线校验，不连 Colab、不消耗 CCU',
    '  --help, -h       显示本帮助',
  ].join('\n')
}

/* ---------------------------------------------------------------- 图像分析 */

let pySeq = 0

/**
 * 调 Python 分析工具，结果从 --out JSON 文件读回。
 *
 * 不用管道捕获 stdout：本机沙箱下 Node 的 spawnSync 管道 stdio 会 EPERM；
 * `stdio: 'ignore'` + 文件回传是唯一稳定路径。
 */
async function pyTool(command, positional, { allowFailure = false } = {}) {
  await mkdir(ANALYSIS_DIR, { recursive: true })
  pySeq += 1
  const outFile = join(ANALYSIS_DIR, `${String(pySeq).padStart(2, '0')}-${command}.json`)
  const result = spawnSync('python', [PY_TOOL, command, ...positional, '--out', outFile], {
    stdio: 'ignore',
  })
  if (result.error) {
    if (allowFailure) return null
    throw new Error(
      `无法启动 python（${result.error.code ?? result.error.message}）：图像分析需要本机 Python + Pillow + numpy`,
    )
  }
  let payload = null
  try {
    payload = JSON.parse(await readFile(outFile, 'utf8'))
  } catch {
    payload = null
  }
  if (!payload) {
    if (allowFailure) return null
    throw new Error(`python ${command} 未产出结果（exit=${result.status}）`)
  }
  if (payload.ok === false) {
    if (allowFailure) return null
    throw new Error(`python ${command} 失败：${payload.error}`)
  }
  return payload
}

const inspectPng = (path) => pyTool('inspect', [path])
const diffPng = (a, b) => pyTool('diff', [a, b])
const makeRoundMask = (src, out, coverage) => pyTool('mask', [src, out, String(coverage)])
const resizePng = (src, out, maxEdge) => pyTool('resize', [src, out, String(maxEdge)])
const maskedDiff = (generated, reference, mask, pad) =>
  pyTool('masked-diff', [generated, reference, mask, String(pad)])

/** PNG 头读宽高（不依赖第三方库）。 */
function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** 落盘一张出图并返回尺寸/字节数（颜色模式等由 Python 侧补充）。 */
async function savePng(stepId, buffer) {
  await mkdir(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, `${stepId}.png`)
  await writeFile(path, buffer)
  const size = pngSize(buffer)
  return { path, bytes: buffer.length, width: size?.width ?? null, height: size?.height ?? null }
}

/* ---------------------------------------------------------------- 凭据镜像 */

/**
 * 把 `~/.imagen/colab-credentials.json` 镜像到工作区 `.tmp/colab/` 并用环境变量指过去。
 *
 * 原因：DSH 沙箱下 `~/.imagen/` 不可写，而 accessToken() 刷新令牌后必须回写；
 * `IMAGEN_COLAB_CREDENTIALS` 是 lib/colab/client.js 支持的官方覆盖点。
 */
function ensureWorkspaceCredentials() {
  if (process.env.IMAGEN_COLAB_CREDENTIALS) {
    return { path: process.env.IMAGEN_COLAB_CREDENTIALS, mirrored: false, reason: 'env' }
  }
  const mirror = join(WORKSPACE, '.tmp/colab/colab-credentials.json')
  const original = join(homedir(), '.imagen', 'colab-credentials.json')
  if (existsSync(original)) {
    try {
      copyFileSync(original, mirror)
    } catch (error) {
      console.log(`${stamp()} warn  凭据镜像失败（继续用现有镜像）：${error?.message ?? error}`)
    }
  }
  process.env.IMAGEN_COLAB_CREDENTIALS = mirror
  return { path: mirror, mirrored: true, reason: 'sandbox' }
}

/* ---------------------------------------------------------------- 日志与健康 */

const LOG_LINE_PATTERN = /\[(?:gen|load|job|upscale)\]|Traceback|out of memory|OOM|下载|缓存|显存/i

/** 拉取 since 之后的增量日志；失败时返回空增量（不影响主流程）。 */
async function captureLogs(connection, since) {
  const payload = await requestLogs(connection.endpoint, connection.token, Math.max(0, since)).catch(
    () => null,
  )
  if (!payload) return { lines: [], next: since }
  const lines = Array.isArray(payload.lines) ? payload.lines : []
  const next = Number.isFinite(payload.next) ? payload.next : since
  return { lines, next }
}

function interestingLines(lines, limit = 120) {
  return lines.filter((line) => LOG_LINE_PATTERN.test(line)).slice(-limit)
}

function logFlags(lines) {
  const text = lines.join('\n')
  return {
    sawLoadLine: /\[load\] 模型就绪/.test(text),
    sawUnload: /先卸载旧模型/.test(text),
    sawImg2img: /\[gen\] img2img /.test(text),
    sawFromPipeImg2img: /首次图生图/.test(text),
    sawInpaint: /\[gen\] inpaint /.test(text),
    sawFromPipeInpaint: /首次局部重绘/.test(text),
    sawInpaintComposite: /已按蒙版合成/.test(text),
    sawMaskCoverage: /蒙版覆盖率/.test(text),
    sawReference: /\[gen\] reference /.test(text),
    sawTraceback: /Traceback \(most recent call last\)/.test(text),
    sawOom: /out of memory|OOM/.test(text),
  }
}

const gpuMemoryOf = (health) => health?.gpu_memory ?? null

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  if (help) {
    console.log(usage())
    return
  }

  const creds = ensureWorkspaceCredentials()
  const hfToken = await readHfToken()
  const hfTokenSource =
    hfToken &&
    ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'].some(
      (name) => typeof process.env[name] === 'string' && process.env[name].trim() === hfToken,
    )
      ? 'env'
      : hfToken
        ? 'settings'
        : 'none'

  const zPreset = PRESETS.find((item) => item.id === 'z-image-turbo') ?? null
  const qPreset = PRESETS.find((item) => item.id === 'qwen-image-2.1') ?? null
  console.log(
    `阶段十七真机验收：gpu=${gpu} highRam=${highRam ? 'on' : 'off'} ` +
      `z-image-turbo=${zPreset ? 'ok' : '缺失'} qwen-image-2.1=${qPreset ? 'ok' : '缺失'}`,
  )
  console.log(`  凭据：环境变量覆盖（${creds.reason}）；HF Token ${hfToken ? '已注入（值不打印）' : '缺失'}`)

  if (checkOnly) {
    return runOfflineCheck({ zPreset, qPreset, creds })
  }
  if (!zPreset || !qPreset) {
    throw new Error('models/ 缺少 z-image-turbo 或 qwen-image-2.1 预设（先跑 npm run models:build）')
  }

  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu, colabHighRam: highRam })
  if (effective.colabGpu !== gpu) {
    throw new Error(`Colab GPU 档位不受支持：${gpu}`)
  }

  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(dirname(REPORT_PATH), { recursive: true })

  const report = {
    generatedAt: new Date().toISOString(),
    provider: 'colab',
    gpu,
    highRam,
    stage: '十七.4 真机验收（z-image-turbo 连出/重绘 + qwen-image-2.1 多图参考/RGBA）',
    environment: {
      node: process.version,
      platform: process.platform,
      workspace: WORKSPACE,
      outDir: OUT_DIR,
      pythonTool: PY_TOOL,
    },
    hfToken: { present: Boolean(hfToken), source: hfTokenSource },
    credentials: { mode: creds.reason, path: creds.path },
    models: {
      zImageTurbo: {
        presetId: zPreset.id,
        repo: zPreset.repo,
        steps: zPreset.steps,
        cfg: zPreset.cfg,
        size: zPreset.size,
        pipeline: zPreset.pipeline,
        declaredMeasured: zPreset.measured ?? null,
      },
      qwenImage21: {
        presetId: qPreset.id,
        repo: qPreset.repo,
        steps: qPreset.steps,
        cfg: qPreset.cfg,
        size: qPreset.size,
        pipeline: qPreset.pipeline,
        declaredMeasured: qPreset.measured ?? null,
      },
    },
    session: {
      state: null,
      assignSeconds: null,
      readySeconds: null,
      provisionTotalSeconds: null,
      machineShape: null,
      endpointUrl: null,
      versions: null,
      device: null,
      preloaded: null,
      warmLoad: null,
      attempts: [],
    },
    health: { initial: null, end: null },
    steps: {},
    comparisons: {},
    rgba: { inspections: {}, conclusion: null },
    ccu: { before: null, after: null, delta: null },
    assignments: { before: null, after: null, beforeEndpoints: [], afterEndpoints: [], ourEndpoint: null, ourReleased: null },
    timing: { totalSeconds: null, gpuSessionSeconds: null },
    checks: CHECKS,
    error: null,
    ok: false,
    failedChecks: [],
  }

  const startedAt = Date.now()
  let readyAt = null
  let connection = null
  let logCursor = 0
  let beforeToken = null

  const session = new SessionManager({
    ctx: { workspace: WORKSPACE },
    defaultPreset: zPreset.id,
    deps: { log: sink },
    options: {
      provider: effective.provider,
      colabGpu: effective.colabGpu,
      colabHighRam: effective.colabHighRam,
      hfToken,
      enableGpu: true,
      idleTimeoutSec: 600,
      provisionTimeoutMs: 25 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
    },
  })

  /** 出图一步：提交 → 等完成 → 落盘 → 记录显存/日志/PNG 元信息。 */
  const runStep = async (stepId, plan) => {
    const step = {
      step: stepId,
      kind: plan.kind,
      presetId: plan.preset.id,
      modelId: plan.preset.repo,
      request: {
        prompt: plan.prompt,
        negativePrompt: plan.negativePrompt ?? '',
        seed: plan.seed ?? SEED,
        width: plan.width ?? plan.preset.size,
        height: plan.height ?? plan.preset.size,
        steps: plan.preset.steps,
        cfg: plan.preset.cfg,
        reference: plan.reference
          ? {
              sourceStep: plan.reference.sourceStep ?? null,
              strength: plan.reference.strength ?? null,
              hasMask: Boolean(plan.reference.mask_b64),
              imageBytes: plan.reference.image_b64
                ? Buffer.from(plan.reference.image_b64, 'base64').length
                : null,
            }
          : null,
        referenceImages: plan.referenceImages
          ? plan.referenceImages.map((item, index) => ({
              index: index + 1,
              bytes: Buffer.from(item.image_b64, 'base64').length,
            }))
          : null,
      },
      loadSeconds: null,
      imageSeconds: null,
      wallSeconds: null,
      png: null,
      pngMode: null,
      hasAlpha: null,
      resultMeta: null,
      gpuMemoryBefore: null,
      gpuMemoryAfter: null,
      logLines: [],
      logFlags: {},
      error: null,
    }
    const cursorBefore = logCursor
    let cursorAfter = logCursor
    const jobId = `acc17-${stepId}-${Date.now()}`
    step.jobId = jobId
    try {
      const healthBefore = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
      step.gpuMemoryBefore = gpuMemoryOf(healthBefore)
      const body = {
        pipeline: plan.preset.pipeline,
        modelId: plan.preset.repo,
        jobId,
        tasks: [
          {
            name: stepId,
            prompt: plan.prompt,
            negative_prompt: plan.negativePrompt ?? '',
            seed: plan.seed ?? SEED,
            width: step.request.width,
            height: step.request.height,
            steps: plan.preset.steps,
            cfg: plan.preset.cfg,
          },
        ],
      }
      if (plan.reference) body.reference = plan.reference
      if (plan.referenceImages) body.referenceImages = plan.referenceImages
      console.log(
        `\n=== ${stepId} ${plan.kind}（${plan.preset.id}）${step.request.width}x${step.request.height} ===`,
      )
      const begin = Date.now()
      const response = await requestGenerate(connection.endpoint, connection.token, body, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        requestMs: session.provider.jobRequestTimeoutMs,
      })
      step.wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
      const result = response.results?.[0] ?? null
      step.loadSeconds = response.load_seconds ?? null
      step.imageSeconds = result?.seconds ?? null
      const buffer = Buffer.from(result?.image_b64 ?? '', 'base64')
      const isPng = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      if (!isPng) throw new Error(`${stepId} 返回的不是 PNG（${buffer.length} 字节）`)
      const saved = await savePng(stepId, buffer)
      step.png = { ...saved, pngBytes: result?.png_bytes ?? buffer.length }
      step.resultMeta = {
        width: result?.width ?? null,
        height: result?.height ?? null,
        steps: result?.steps ?? null,
        cfg: result?.cfg ?? null,
        strength: result?.strength ?? null,
        referenceWidth: result?.referenceWidth ?? null,
        referenceHeight: result?.referenceHeight ?? null,
        inpaint: result?.inpaint ?? null,
        maskWidth: result?.maskWidth ?? null,
        maskHeight: result?.maskHeight ?? null,
      }
      try {
        const inspected = await inspectPng(saved.path)
        step.pngMode = inspected.mode
        step.hasAlpha = inspected.hasAlphaChannel
        step.png.format = inspected.format
        step.png.alpha = inspected.alpha
        step.png.colorTypeLabel = inspected.colorTypeLabel ?? null
      } catch (error) {
        step.pngMode = 'inspect_failed'
        step.pngInspectError = String(error?.message ?? error)
      }
      const logs = await captureLogs(connection, cursorBefore)
      cursorAfter = logs.next
      step.logLines = interestingLines(logs.lines)
      step.logFlags = logFlags(logs.lines)
      console.log(
        `  PNG ${step.png.width}x${step.png.height} ${(step.png.bytes / 1024).toFixed(0)} KiB ` +
          `mode=${step.pngMode} load=${step.loadSeconds}s 推理=${step.imageSeconds}s 总 ${step.wallSeconds}s`,
      )
    } catch (error) {
      step.error = { message: String(error?.message ?? error), code: error?.code ?? null }
      const logs = await captureLogs(connection, cursorBefore).catch(() => ({ lines: [], next: cursorBefore }))
      step.logLines = interestingLines(logs.lines)
      step.logFlags = logFlags(logs.lines)
      cursorAfter = Math.max(cursorAfter, logs.next)
      console.log(`  失败：${step.error.message}${step.error.code ? `（${step.error.code}）` : ''}`)
      if (step.logLines.length) console.log(step.logLines.slice(-20).join('\n'))
      throw error
    } finally {
      logCursor = cursorAfter
      const healthAfter = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
      step.gpuMemoryAfter = gpuMemoryOf(healthAfter)
      report.steps[stepId] = step
    }
    return step
  }

  let currentStep = 'provision'
  try {
    /* ---- 基线：CCU / assignments ---- */
    beforeToken = await accessToken({ log: sink }).catch(() => null)
    if (beforeToken) {
      report.assignments.before = await listAssignments(beforeToken)
        .then((list) => (Array.isArray(list) ? list.length : null))
        .catch(() => null)
      const beforeList = await listAssignments(beforeToken).catch(() => [])
      report.assignments.beforeEndpoints = (Array.isArray(beforeList) ? beforeList : []).map(
        (item) => item?.endpoint ?? null,
      )
      report.ccu.before = ccuSummary(await ccuInfo(beforeToken).catch(() => null))
      console.log(
        `  启动前：assignments=${report.assignments.before ?? '?'}，` +
          `CCU assignmentsCount=${report.ccu.before?.assignmentsCount ?? '?'} ` +
          `balance=${report.ccu.before?.currentBalance ?? '?'}`,
      )
      check(
        '启动前无遗留实例',
        report.assignments.before === 0,
        `assignments.before=${report.assignments.before ?? '?'}`,
      )
    } else {
      check('读取 Colab 访问令牌', false, 'accessToken 失败')
    }

    /* ---- 启动会话（含 503/排队重试） ---- */
    currentStep = 'provision'
    console.log(`\n=== 启动 Colab 会话（${gpu} / 默认预设 ${zPreset.id}）===`)
    const MAX_ATTEMPTS = 8
    let snapshot = null
    let provisionedAt = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const attemptStartedAt = Date.now()
      try {
        await session.start(zPreset.id)
        provisionedAt = Date.now()
        let lastState = ''
        snapshot = await session.ensureReady({
          timeoutMs: 25 * 60 * 1000,
          onTick: (tick) => {
            const line = `${tick.state}/${tick.phase ?? '-'} ${tick.detail ?? ''}`.trim()
            if (line !== lastState) {
              lastState = line
              console.log(`  ${stamp()} ${line}`)
            }
          },
        })
        readyAt = Date.now()
        report.session.attempts.push({
          attempt,
          ok: true,
          totalSeconds: Number(((readyAt - attemptStartedAt) / 1000).toFixed(1)),
        })
        break
      } catch (error) {
        const message = String(error?.message ?? error)
        const code = error?.code ?? null
        report.session.attempts.push({ attempt, ok: false, message, code })
        console.log(`  第 ${attempt} 次启动失败：${message}${code ? `（${code}）` : ''}`)
        await session.stop().catch(() => {})
        if (attempt === MAX_ATTEMPTS) throw error
        const backoffMs = attempt < 3 ? 45_000 : 60_000
        console.log(`  ${backoffMs / 1000}s 后重试（${attempt + 1}/${MAX_ATTEMPTS}）`)
        await sleep(backoffMs)
      }
    }
    // 计时口径与 tools/colab/smoke-provider.mjs 一致：assign = 从发起到 start() 返回，
    // ready = 从 start() 返回到会话 ready，provisionTotal = 两者之和（含重试等待时不计入）。
    report.session.assignSeconds = Number(((provisionedAt - startedAt) / 1000).toFixed(1))
    report.session.readySeconds = Number(((readyAt - provisionedAt) / 1000).toFixed(1))
    report.session.provisionTotalSeconds = Number(((readyAt - startedAt) / 1000).toFixed(1))
    report.session.state = snapshot.state
    report.session.machineShape = session.handle?.machineShape ?? null
    connection = { endpoint: session.session.endpointUrl, token: session.secret.token }
    report.session.endpointUrl = connection.endpoint
    // 本会话的 Colab assignment endpoint：stop() 后用它判断「我们自己的实例」确实被释放。
    report.assignments.ourEndpoint = session.handle?.assignmentEndpoint ?? null
    check(
      '会话进入 ready',
      snapshot.state === 'ready',
      `provision 总计 ${report.session.provisionTotalSeconds}s` +
        `（assign ${report.session.assignSeconds}s + ready ${report.session.readySeconds}s，` +
        `重试 ${report.session.attempts.filter((item) => !item.ok).length} 次）`,
    )

    /* ---- 初始 /health 与 daemon 日志 ---- */
    const health = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
    const healthDevice = String(health?.device ?? '')
    report.health.initial = health
      ? {
          phase: health.phase ?? null,
          device: health.device ?? null,
          deviceCount: health.device_count ?? null,
          modelId: health.model_id ?? null,
          gpuMemory: health.gpu_memory ?? null,
          versions: health.versions ?? null,
        }
      : null
    report.session.device = health?.device ?? null
    report.session.versions = health?.versions ?? null
    check(
      '远端 /health 可用',
      Boolean(health),
      health ? `phase=${health.phase} device=${health.device} model=${health.model_id}` : '',
    )
    check('远端 GPU 型号已识别', Boolean(healthDevice.trim()), healthDevice || '未返回 device')

    const daemonLogs = await session.provider.readLogs(session, session.handle).catch(() => null)
    if (daemonLogs) {
      const hasTraceback = /Traceback \(most recent call last\)/.test(daemonLogs)
      report.session.daemonLogTail = daemonLogs.split('\n').slice(-40)
      check('daemon 启动日志无 traceback', !hasTraceback)
    } else {
      check('能读到 daemon 日志', false, 'readLogs 返回空')
    }
    // 默认预设由 Host 下发给 daemon 配置的 `preload`（lib/session/provisioner.js），
    // daemon 会在 warm 阶段就把这套 pipeline 加载好：此时同预设首图 load_seconds=0 属预期，
    // 加载耗时体现在 provision 的 warm 阶段与 daemon 日志的 [load] 行里。
    const preloadedModelId = typeof health?.model_id === 'string' ? health.model_id : null
    report.session.preloaded = Boolean(preloadedModelId && preloadedModelId.includes(String(zPreset.repo)))
    report.session.warmLoad = {
      preloadPurePipe: zPreset.pipeline,
      modelIdAtReady: preloadedModelId,
      warmSeconds: report.session.readySeconds,
      loadLogLines: (report.session.daemonLogTail ?? []).filter((line) => /\[load\]/.test(line)),
    }
    // 日志游标：since 传一个大于当前序号的值，只取 next，不重复拉历史。
    const initial = await captureLogs(connection, 1_000_000_000)
    logCursor = initial.next

    /* ================= A. z-image-turbo ================= */
    const a1 = await runStep('A1', {
      kind: 'txt2img',
      preset: zPreset,
      prompt: PROMPT,
      seed: SEED,
      width: zPreset.size,
      height: zPreset.size,
    })
    check(
      'A1 收到合法 PNG 且 1024²',
      a1.png?.width === 1024 && a1.png?.height === 1024,
      `${a1.png?.width}x${a1.png?.height} / ${(a1.png?.bytes / 1024).toFixed(0)} KiB`,
    )
    check(
      'A1 模型加载口径已记录（warm 预加载或首图 load_seconds>0）',
      report.session.preloaded === true || Number(a1.loadSeconds) > 0,
      report.session.preloaded
        ? `warm 阶段已预加载 ${zPreset.repo}（ready 时 /health.modelId 即该模型），` +
          `首图 load_seconds=${a1.loadSeconds}（预期，加载计入 warm ${report.session.readySeconds}s）`
        : `首图 load_seconds=${a1.loadSeconds}s`,
    )
    check('A1 首图推理耗时已记录', Number(a1.imageSeconds) > 0, `${a1.imageSeconds}s`)

    const a2 = await runStep('A2', {
      kind: 'txt2img',
      preset: zPreset,
      prompt: PROMPT,
      seed: SEED,
      width: zPreset.size,
      height: zPreset.size,
    })
    check('A2 连出 load_seconds=0（同会话稳态）', Number(a2.loadSeconds) === 0, `load_seconds=${a2.loadSeconds}`)
    check(
      'A2 出图 1024²',
      a2.png?.width === 1024 && a2.png?.height === 1024,
      `${a2.png?.width}x${a2.png?.height} / 第 2 张推理 ${a2.imageSeconds}s`,
    )

    const a1Buffer = Buffer.from(await readFile(a1.png.path))
    const a3 = await runStep('A3', {
      kind: 'img2img',
      preset: zPreset,
      prompt: IMG2IMG_PROMPT,
      seed: SEED,
      width: zPreset.size,
      height: zPreset.size,
      reference: { sourceStep: 'A1', image_b64: a1Buffer.toString('base64'), strength: 0.6 },
    })
    const a3Diff = await diffPng(a3.png.path, a1.png.path)
    report.comparisons.A3_vs_A1 = a3Diff
    check(
      'A3 img2img 出图 1024²',
      a3.png?.width === 1024 && a3.png?.height === 1024,
      `${a3.png?.width}x${a3.png?.height} / 推理 ${a3.imageSeconds}s`,
    )
    check('A3 load_seconds=0（from_pipe 复用底座）', Number(a3.loadSeconds) === 0, `load_seconds=${a3.loadSeconds}`)
    check(
      'A3 日志走 img2img 分支',
      a3.logFlags.sawImg2img === true,
      `from_pipe 首建=${a3.logFlags.sawFromPipeImg2img}`,
    )
    check(
      'A3 画面明显改变（img2img 生效）',
      a3Diff.meanAbsDiff >= 5 || a3Diff.changedRatio >= 0.1,
      `平均差 ${a3Diff.meanAbsDiff}/255，变化像素 ${(a3Diff.changedRatio * 100).toFixed(1)}%`,
    )

    const maskInfo = await makeRoundMask(a1.png.path, join(OUT_DIR, 'A4-mask.png'), MASK_COVERAGE)
    report.mask = maskInfo
    const maskBuffer = Buffer.from(await readFile(maskInfo.path))
    const a4 = await runStep('A4', {
      kind: 'inpaint',
      preset: zPreset,
      prompt: INPAINT_PROMPT,
      seed: SEED,
      width: zPreset.size,
      height: zPreset.size,
      reference: {
        sourceStep: 'A1',
        image_b64: a1Buffer.toString('base64'),
        mask_b64: maskBuffer.toString('base64'),
        strength: 0.8,
      },
    })
    const a4Diff = await maskedDiff(a4.png.path, a1.png.path, maskInfo.path, MASK_KEEP_PAD)
    report.comparisons.A4_vs_A1 = a4Diff
    check(
      'A4 inpaint 出图 1024²',
      a4.png?.width === 1024 && a4.png?.height === 1024,
      `${a4.png?.width}x${a4.png?.height} / 推理 ${a4.imageSeconds}s`,
    )
    check('A4 load_seconds=0（from_pipe 复用底座）', Number(a4.loadSeconds) === 0, `load_seconds=${a4.loadSeconds}`)
    check(
      'A4 日志走 inpaint 分支且 from_pipe 复用',
      a4.logFlags.sawInpaint === true &&
        (Number(a4.loadSeconds) === 0 || a4.logFlags.sawFromPipeInpaint === true),
      `inpaint=${a4.logFlags.sawInpaint} 首次局部重绘=${a4.logFlags.sawFromPipeInpaint} 合成=${a4.logFlags.sawInpaintComposite}`,
    )
    check(
      'A4 蒙版内明显改变',
      a4Diff.repaintCore.meanAbsDiff >= 8 || a4Diff.repaintCore.changedRatio >= 0.2,
      `蒙版内平均差 ${a4Diff.repaintCore.meanAbsDiff}/255，变化像素 ${(a4Diff.repaintCore.changedRatio * 100).toFixed(1)}%`,
    )
    check(
      'A4 蒙版外核心保留区像素差≈0',
      a4Diff.keepCore.meanAbsDiff !== null && a4Diff.keepCore.meanAbsDiff <= 0.5,
      `保留核心区平均差 ${a4Diff.keepCore.meanAbsDiff}/255（最大 ${a4Diff.keepCore.maxAbsDiff}），` +
        `保留区整体平均差 ${a4Diff.keepAll.meanAbsDiff}/255`,
    )

    /* ================= B. qwen-image-2.1 ================= */
    const b1 = await runStep('B1', {
      kind: 'txt2img',
      preset: qPreset,
      prompt: PROMPT,
      seed: SEED,
      width: qPreset.size,
      height: qPreset.size,
    })
    check(
      'B1 切模型后收到合法 PNG 且 1024²',
      b1.png?.width === 1024 && b1.png?.height === 1024,
      `${b1.png?.width}x${b1.png?.height} / ${(b1.png?.bytes / 1024).toFixed(0)} KiB`,
    )
    check(
      'B1 记录切模型加载耗时（load_seconds>0）',
      Number(b1.loadSeconds) > 0,
      `load_seconds=${b1.loadSeconds}s，日志切模型卸载=${b1.logFlags.sawUnload}`,
    )

    // 参考图：A1/A3 缩到长边 ≤1024 的 PNG（当前已 1024²，等价于转 RGB 重编码）。
    const refA1 = await resizePng(a1.png.path, join(OUT_DIR, 'B2-ref-A1.png'), 1024)
    const refA3 = await resizePng(a3.png.path, join(OUT_DIR, 'B2-ref-A3.png'), 1024)
    report.referenceImages = { A1: refA1, A3: refA3 }
    const refA1Buffer = Buffer.from(await readFile(refA1.path))
    const refA3Buffer = Buffer.from(await readFile(refA3.path))

    let b2ctl = null
    if (!skipControl) {
      b2ctl = await runStep('B2ctl', {
        kind: 'txt2img-control',
        preset: qPreset,
        prompt: REFERENCE_PROMPT,
        seed: SEED,
        width: qPreset.size,
        height: qPreset.size,
      })
    }

    const b2 = await runStep('B2', {
      kind: 'referenceImages',
      preset: qPreset,
      prompt: REFERENCE_PROMPT,
      seed: SEED,
      width: qPreset.size,
      height: qPreset.size,
      referenceImages: [
        { image_b64: refA1Buffer.toString('base64') },
        { image_b64: refA3Buffer.toString('base64') },
      ],
    })
    const b2vsB1 = await diffPng(b2.png.path, b1.png.path)
    report.comparisons.B2_vs_B1 = b2vsB1
    check(
      'B2 多图参考出图 1024²',
      b2.png?.width === 1024 && b2.png?.height === 1024,
      `${b2.png?.width}x${b2.png?.height} / 推理 ${b2.imageSeconds}s`,
    )
    check('B2 load_seconds=0（同会话切换分支不重载）', Number(b2.loadSeconds) === 0, `load_seconds=${b2.loadSeconds}`)
    check(
      'B2 日志走 referenceImages 分支（2 张）',
      b2.logFlags.sawReference === true,
      `sawReference=${b2.logFlags.sawReference}`,
    )
    check(
      'B2 与 B1 像素不同（参考/提示词生效）',
      b2vsB1.meanAbsDiff >= 3 || b2vsB1.changedRatio >= 0.1,
      `平均差 ${b2vsB1.meanAbsDiff}/255，变化像素 ${(b2vsB1.changedRatio * 100).toFixed(1)}%`,
    )
    if (b2ctl) {
      const b2vsCtl = await diffPng(b2.png.path, b2ctl.png.path)
      report.comparisons.B2_vs_B2ctl = b2vsCtl
      check(
        'B2ctl 对照：参考图确实改变了输出（同提示词/seed）',
        b2vsCtl.meanAbsDiff >= 3 || b2vsCtl.changedRatio >= 0.1,
        `B2 与无参考对照平均差 ${b2vsCtl.meanAbsDiff}/255，变化像素 ${(b2vsCtl.changedRatio * 100).toFixed(1)}%`,
      )
    }

    /* ---- B3 RGBA 透明通道评估 ---- */
    const b3 = await runStep('B3', {
      kind: 'txt2img-transparent',
      preset: qPreset,
      prompt: STICKER_PROMPT,
      seed: SEED,
      width: qPreset.size,
      height: qPreset.size,
    })
    const rgbaInspections = {}
    let alphaPngs = 0
    for (const step of [b1, b2, b3]) {
      const inspector = report.steps[step.step]
      rgbaInspections[step.step] = {
        path: step.png.path,
        mode: step.pngMode,
        hasAlphaChannel: step.hasAlpha,
        colorTypeLabel: step.png.colorTypeLabel ?? null,
        alpha: step.png.alpha ?? null,
      }
      if (step.hasAlpha) alphaPngs += 1
    }
    report.rgba.inspections = rgbaInspections
    report.rgba.conclusion = describeRgba(rgbaInspections)
    console.log(`\n  RGBA 事实：${report.rgba.conclusion}`)
    check(
      'B3 已记录返回 PNG 的实际颜色模式/alpha 事实',
      b3.pngMode !== 'inspect_failed',
      `B1=${rgbaInspections.B1.mode} B2=${rgbaInspections.B2.mode} B3=${rgbaInspections.B3.mode}，` +
        `含 alpha 的 PNG 数=${alphaPngs}`,
    )

    /* ---- 会话末尾 /health（显存峰值口径） ---- */
    const endHealth = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
    report.health.end = endHealth
      ? {
          phase: endHealth.phase ?? null,
          device: endHealth.device ?? null,
          modelId: endHealth.model_id ?? null,
          gpuMemory: endHealth.gpu_memory ?? null,
        }
      : null
  } catch (error) {
    report.error = {
      step: currentStep,
      message: String(error?.message ?? error),
      code: error?.code ?? null,
    }
    console.log(`\n执行失败（${currentStep}）：${report.error.message}${report.error.code ? `（${report.error.code}）` : ''}`)
  } finally {
    /* ---- C. 收尾：stop 并确认实例释放 ---- */
    currentStep = 'stop'
    report.timing.gpuSessionSeconds = readyAt ? Number(((Date.now() - readyAt) / 1000).toFixed(1)) : null
    console.log('\n=== stop() 释放 ===')
    const afterToken = await accessToken({ log: sink }).catch(() => null)
    await session.stop().catch((error) => console.log(`stop 异常：${error?.message ?? error}`))
    await sleep(3000)
    let list = afterToken ? await listAssignments(afterToken).catch(() => null) : null
    for (let attempt = 0; attempt < 6 && Array.isArray(list) && list.length > 0; attempt += 1) {
      await sleep(3000)
      list = await listAssignments(afterToken).catch(() => list)
    }
    const ccu = afterToken ? await ccuInfo(afterToken).catch(() => null) : null
    report.assignments.after = Array.isArray(list) ? list.length : null
    report.assignments.afterEndpoints = (Array.isArray(list) ? list : []).map((item) => item?.endpoint ?? null)
    report.assignments.ourReleased = Array.isArray(list)
      ? !list.some((item) => item?.endpoint && item.endpoint === report.assignments.ourEndpoint)
      : false
    report.ccu.after = ccuSummary(ccu)
    if (report.ccu.before?.currentBalance != null && report.ccu.after?.currentBalance != null) {
      report.ccu.delta = Number(
        (report.ccu.before.currentBalance - report.ccu.after.currentBalance).toFixed(4),
      )
    }
    report.timing.totalSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1))
    check(
      'assignments 已清空',
      Array.isArray(list) && list.length === 0,
      `剩余 ${list?.length ?? '?'} 个；本会话实例已释放=${report.assignments.ourReleased}`,
    )
    check(
      '本会话实例已释放（无遗留 Kernel）',
      report.assignments.ourReleased === true,
      `ourEndpoint=${report.assignments.ourEndpoint ?? '未记录'}`,
    )
    check(
      'CCU 活跃实例归零',
      Number(ccu?.assignmentsCount ?? -1) === 0,
      `assignmentsCount=${ccu?.assignmentsCount} balance=${ccu?.currentBalance?.toFixed?.(3)}`,
    )
    check(
      '单会话 GPU 时间在目标内（≤35 分钟）',
      report.timing.gpuSessionSeconds !== null && report.timing.gpuSessionSeconds <= 35 * 60,
      `ready→stop ${report.timing.gpuSessionSeconds}s`,
    )
    session.dispose()

    const failed = CHECKS.filter((item) => !item.ok)
    report.failedChecks = failed.map((item) => item.name)
    report.ok = failed.length === 0 && !report.error
    report.checks = CHECKS
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(`\n报告已写入：${REPORT_PATH}`)
    console.log(`PNG 目录：${OUT_DIR}`)
    console.log(
      `总耗时 ${report.timing.totalSeconds}s（GPU 会话 ${report.timing.gpuSessionSeconds}s），` +
        `CCU ${report.ccu.before?.currentBalance ?? '?'} → ${report.ccu.after?.currentBalance ?? '?'}，` +
        `assignments ${report.assignments.before ?? '?'} → ${report.assignments.after ?? '?'}`,
    )
    if (report.error) {
      console.log(`执行失败：${report.error.message}`)
      process.exitCode = 1
    } else if (failed.length) {
      console.log(`${failed.length} 项失败：${failed.map((item) => item.name).join('、')}`)
      process.exitCode = 1
    } else {
      console.log('全部通过')
    }
  }
}

function ccuSummary(info) {
  if (!info || typeof info !== 'object') return null
  return {
    assignmentsCount: Number.isFinite(info.assignmentsCount) ? info.assignmentsCount : null,
    currentBalance: Number.isFinite(info.currentBalance) ? info.currentBalance : null,
    consumptionRateHourly: Number.isFinite(info.consumptionRateHourly)
      ? info.consumptionRateHourly
      : null,
  }
}

/** 把 B 组 PNG 的颜色模式 / alpha 实测数据折成一句可证实的结论（不臆测模型能力）。 */
function describeRgba(inspections) {
  const entries = Object.entries(inspections)
  const withAlpha = entries.filter(([, item]) => item.hasAlphaChannel)
  if (withAlpha.length === 0) {
    const modes = [...new Set(entries.map(([, item]) => item.mode))].join('/')
    return (
      `实测返回的 PNG 颜色模式为 ${modes}，无 alpha 通道（PNG 颜色类型见 rgba.inspections）；` +
      '当前 daemon 链路（diffusers 管线输出 → _encode_png 原样保存）不输出透明背景。'
    )
  }
  const parts = withAlpha.map(([stepId, item]) => {
    const alpha = item.alpha ?? {}
    return (
      `${stepId} 为 ${item.mode}（alpha ${alpha.min}~${alpha.max}，唯一值 ${alpha.uniqueCount} 个，` +
      `alpha=0 占 ${((alpha.transparentRatio ?? 0) * 100).toFixed(1)}%，` +
      `alpha=255 占 ${((alpha.opaqueRatio ?? 0) * 100).toFixed(1)}%）`
    )
  })
  const anyTransparent = withAlpha.some(([, item]) => (item.alpha?.transparentRatio ?? 0) > 0)
  const anyOpaque = withAlpha.some(([, item]) => (item.alpha?.opaqueRatio ?? 0) > 0)
  return (
    `${withAlpha.length} 张返回 PNG 含 alpha 通道：${parts.join('；')}。` +
    (anyTransparent && anyOpaque
      ? '即提示词明确要求透明背景时，返回 PNG 含真实透明（alpha=0）区域；未要求透明的提示词下 alpha 近似全不透明。'
      : anyTransparent
        ? '即返回 PNG 含真实透明区域，链路保留 alpha。'
        : '但返回 PNG 没有 alpha=0 的像素，即这批提示词下输出实质不透明。')
  )
}

/* ---------------------------------------------------------------- 离线校验 */

async function runOfflineCheck({ zPreset, qPreset, creds }) {
  check('z-image-turbo 预设已入库', Boolean(zPreset), zPreset ? `${zPreset.repo}（${zPreset.pipeline?.loader}）` : '')
  check('qwen-image-2.1 预设已入库', Boolean(qPreset), qPreset ? `${qPreset.repo}（${qPreset.pipeline?.loader}）` : '')
  check(
    'zimage 打开 img2img / inpaint 能力标记',
    zPreset?.supportsImg2Img === true && zPreset?.supportsInpaint === true,
    `supportsImg2Img=${zPreset?.supportsImg2Img} supportsInpaint=${zPreset?.supportsInpaint}`,
  )
  check(
    'qwen-image-2.1 打开原生参考能力标记',
    qPreset?.supportsReference === true,
    `supportsReference=${qPreset?.supportsReference}`,
  )
  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu, colabHighRam: highRam })
  check('设置层接受 Colab GPU 档位', effective.colabGpu === gpu, `colabGpu=${effective.colabGpu}`)
  check('strength 在契约区间内', 0.6 <= LIMITS.strength.max && 0.8 <= LIMITS.strength.inpaintMax, `img2img 0.6 / inpaint 0.8`)
  check(
    '出图边长 1024 合法',
    zPreset?.size === 1024 && qPreset?.size === 1024,
    `${zPreset?.size}x${qPreset?.size}`,
  )
  const pythonProbe = spawnSync('python', [PY_TOOL, '--help'], { stdio: 'ignore' })
  check(
    '图像分析工具可用（python + Pillow）',
    !pythonProbe.error && pythonProbe.status === 0,
    pythonProbe.error ? String(pythonProbe.error.code ?? pythonProbe.error.message) : `exit=${pythonProbe.status}`,
  )
  let credMeta = null
  try {
    credMeta = JSON.parse(await readFile(creds.path, 'utf8'))
  } catch (error) {
    credMeta = null
  }
  check(
    'Colab 凭据镜像可读',
    Boolean(credMeta?.accessToken || credMeta?.refreshToken),
    credMeta
      ? `access_token 过期=${Boolean(credMeta.expiresAt && credMeta.expiresAt < Date.now())}，` +
        `refresh_token=${Boolean(credMeta.refreshToken)}（值不打印）`
      : '读不到凭据',
  )
  try {
    await mkdir(OUT_DIR, { recursive: true })
    await mkdir(dirname(REPORT_PATH), { recursive: true })
    check('报告与 PNG 目录可写', true, `${OUT_DIR} / ${REPORT_PATH}`)
  } catch (error) {
    check('报告与 PNG 目录可写', false, String(error?.message ?? error))
  }
  const failed = CHECKS.filter((item) => !item.ok)
  console.log(`\n${failed.length ? `${failed.length} 项失败：${failed.map((item) => item.name).join('、')}` : '离线校验全部通过'}`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n失败：${error?.message ?? error}`)
  if (error?.stack) console.error(error.stack)
  process.exitCode = 1
})
