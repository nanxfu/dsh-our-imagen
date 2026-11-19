#!/usr/bin/env node
/**
 * 阶段十七补测：z-image-turbo / qwen-image-2.1 稳态文生图耗时（Colab L4）。
 *
 * 协议（docs/MODEL_ASSET_SPEC.md §3.2）：`steadySeconds` 取后续出图耗时的中位数，
 * 至少 3 次、丢弃首张。本脚本单会话内：
 *   1. z-image-turbo 1024² 文生图连出 4 张（同 prompt/seed，纯文生图），第 1 张丢弃，
 *      后 3 张 `results[].seconds` 取中位数；
 *   2. 同一会话切到 qwen-image-2.1，同样连出 4 张（纯文生图、不带参考图），取中位数；
 *   3. stop() 后确认 assignments=0、CCU assignmentsCount=0，无遗留实例。
 *
 * 与 tools/colab/acceptance-17.mjs 的关系：会话启动（SessionManager.start → ensureReady）、
 * 503/排队重试、CCU/assignments 前后快照、任何路径必保 stop() 的结构与它一致；本脚本只做
 * 「同一 pipeline 连续出图 + 中位数」这一件事，不做参考图/蒙版/图像分析，也不写模型资产。
 *
 * 用法：
 *   node tools/colab/steady-17.mjs                      # 完整真机补测（消耗少量 CCU）
 *   node tools/colab/steady-17.mjs --check              # 离线校验，不连 Colab
 *   node tools/colab/steady-17.mjs --samples 4 --gpu L4
 *   node tools/colab/steady-17.mjs --report .tmp/colab/steady-17.json --out .tmp/colab/steady-17
 *
 * 产物：
 *   .tmp/colab/steady-17.json      结构化报告（samples / medianSeconds / peakVramMb / CCU / assignments）
 *   .tmp/colab/steady-17/<id>.png  每个模型最后一次出图（证据留档，可用 --keep-png 全留）
 *
 * 凭据：本机沙箱禁止写 `~/.imagen/`，而 lib/colab/client.js 的 accessToken() 刷新令牌后必须
 * 回写。脚本沿用 acceptance-17 的做法：把凭据镜像到 `<workspace>/.tmp/colab/` 并用该库官方
 * 覆盖点 `IMAGEN_COLAB_CREDENTIALS` 指过去（`.tmp/` 已在 .gitignore 内）。token 不打印、不入报告。
 */

import { copyFileSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { PRESETS } from '../../shared/contract.js'
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
const keepPng = args.includes('--keep-png')
const highRam = args.includes('--high-ram')
const gpu = String(argValue('--gpu') || 'L4').trim().toUpperCase()
const sampleCount = Math.max(4, Number(argValue('--samples')) || 4)
const OUT_DIR = resolve(WORKSPACE, argValue('--out') || '.tmp/colab/steady-17')
const REPORT_PATH = resolve(WORKSPACE, argValue('--report') || '.tmp/colab/steady-17.json')

// 与 tools/colab/smoke-provider.mjs、acceptance-17.mjs 的 PROMPT / SEED 逐字一致，
// 便于与既有 measured 数据（以及 2026-11-19 的首图实测）对齐比对。
const PROMPT =
  'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail'
const SEED = 42
const REQUEST_TIMEOUT_MS = 25 * 60 * 1000
const MAX_START_ATTEMPTS = 6

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
    '用法：node tools/colab/steady-17.mjs [--gpu L4|T4|A100] [--high-ram] [--samples 4]',
    '                                     [--report <path>] [--out <dir>] [--keep-png] [--check] [--help]',
    '',
    '  --gpu <档位>     Colab GPU 档位（默认 L4）',
    '  --high-ram       申请高内存机型（默认关闭）',
    '  --samples <n>    每个模型连出张数（默认 4：首张丢弃 + 后 3 张取中位数）',
    '  --report <path>  报告落盘路径（默认 .tmp/colab/steady-17.json）',
    '  --out <dir>      PNG 产物目录（默认 .tmp/colab/steady-17）',
    '  --keep-png       保留所有样本 PNG（默认每个模型只留最后一张）',
    '  --check          只做离线校验，不连 Colab、不消耗 CCU',
    '  --help, -h       显示本帮助',
  ].join('\n')
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

/** PNG 头读宽高（不依赖第三方库）。 */
function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** 中位数：偶数个样本取中间两个的平均（本脚本固定样本数 ≥4，丢弃首张后为奇数）。 */
function median(values) {
  const numbers = values.filter((value) => Number.isFinite(Number(value))).map(Number)
  if (numbers.length === 0) return null
  const sorted = [...numbers].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return Number(value.toFixed(2))
}

function mean(values) {
  const numbers = values.filter((value) => Number.isFinite(Number(value))).map(Number)
  if (numbers.length === 0) return null
  return Number((numbers.reduce((total, value) => total + value, 0) / numbers.length).toFixed(2))
}

/**
 * 把 `~/.imagen/colab-credentials.json` 镜像到工作区 `.tmp/colab/` 并用环境变量指过去。
 *
 * DSH 沙箱下 `~/.imagen/` 不可写，而 accessToken() 刷新令牌后必须回写；
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

const LOG_LINE_PATTERN = /\[(?:gen|load|job)\]|Traceback|out of memory|OOM/i

function interestingLines(lines, limit = 12) {
  return lines.filter((line) => LOG_LINE_PATTERN.test(line)).slice(-limit)
}

function logFlags(lines) {
  const text = lines.join('\n')
  return {
    sawLoadLine: /\[load\] 模型就绪/.test(text),
    sawUnload: /先卸载旧模型/.test(text),
    sawModelSwitchDownload: /预下载/.test(text),
  }
}

async function captureLogs(connection, since) {
  const payload = await requestLogs(connection.endpoint, connection.token, Math.max(0, since)).catch(
    () => null,
  )
  if (!payload) return { lines: [], next: since }
  return {
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    next: Number.isFinite(payload.next) ? payload.next : since,
  }
}

async function main() {
  if (help) {
    console.log(usage())
    return
  }

  const creds = ensureWorkspaceCredentials()
  const zPreset = PRESETS.find((item) => item.id === 'z-image-turbo') ?? null
  const qPreset = PRESETS.find((item) => item.id === 'qwen-image-2.1') ?? null
  const hfToken = await readHfToken()
  console.log(
    `阶段十七稳态补测：gpu=${gpu} samples=${sampleCount}（首张丢弃 + 后 ${sampleCount - 1} 张取中位数）` +
      ` z-image-turbo=${zPreset ? 'ok' : '缺失'} qwen-image-2.1=${qPreset ? 'ok' : '缺失'}`,
  )

  if (checkOnly) {
    return runOfflineCheck({ zPreset, qPreset, creds, hfToken })
  }
  if (!zPreset || !qPreset) {
    throw new Error('models/ 缺少 z-image-turbo 或 qwen-image-2.1 预设（先跑 npm run models:build）')
  }
  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu, colabHighRam: highRam })
  if (effective.colabGpu !== gpu) throw new Error(`Colab GPU 档位不受支持：${gpu}`)

  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(dirname(REPORT_PATH), { recursive: true })

  const report = {
    generatedAt: new Date().toISOString(),
    provider: 'colab',
    gpu,
    highRam,
    purpose: '阶段十七.4 补测：按 MODEL_ASSET_SPEC §3.2 采集两个模型稳态文生图耗时（回填 measured.steadySeconds）',
    protocol: {
      source: 'docs/MODEL_ASSET_SPEC.md §3.2：steadySeconds = 后续出图耗时的中位数（至少 3 次，丢弃首张）',
      samplesPerModel: sampleCount,
      discarded: 'index=1（首张）',
      medianOf: `index=2..${sampleCount}`,
      prompt: PROMPT,
      seed: SEED,
      width: zPreset.size,
      height: zPreset.size,
    },
    environment: { node: process.version, platform: process.platform, workspace: WORKSPACE, outDir: OUT_DIR },
    credentials: { mode: creds.reason, path: creds.path },
    hfToken: { present: Boolean(hfToken) },
    session: {
      state: null,
      assignSeconds: null,
      readySeconds: null,
      provisionTotalSeconds: null,
      machineShape: null,
      endpointUrl: null,
      versions: null,
      device: null,
      preloadedDefault: null,
      attempts: [],
    },
    health: { initial: null, end: null },
    models: {
      zImageTurbo: {
        presetId: zPreset.id,
        repo: zPreset.repo,
        loader: zPreset.pipeline?.loader ?? null,
        steps: zPreset.steps,
        cfg: zPreset.cfg,
        size: zPreset.size,
        // PRESETS 把 models/*.json 的 measured 摊平成三个字段，这里按资产口径还原。
        declaredMeasured: {
          peakVramMb: zPreset.peakVramMb ?? null,
          loadSeconds: zPreset.loadSeconds ?? null,
          steadySeconds: zPreset.steadySeconds ?? null,
        },
        samples: [],
        medianSeconds: null,
        meanSeconds: null,
        discardedSeconds: null,
        peakVramMb: null,
        switchLoadSeconds: null,
      },
      qwenImage21: {
        presetId: qPreset.id,
        repo: qPreset.repo,
        loader: qPreset.pipeline?.loader ?? null,
        steps: qPreset.steps,
        cfg: qPreset.cfg,
        size: qPreset.size,
        declaredMeasured: {
          peakVramMb: qPreset.peakVramMb ?? null,
          loadSeconds: qPreset.loadSeconds ?? null,
          steadySeconds: qPreset.steadySeconds ?? null,
        },
        samples: [],
        medianSeconds: null,
        meanSeconds: null,
        discardedSeconds: null,
        peakVramMb: null,
        switchLoadSeconds: null,
      },
    },
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
  let provisionedAt = null

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

  /**
   * 出一张图：提交 → 等完成 → 记录耗时/显存/日志；`savePath` 非空时落盘 PNG。
   * 与 acceptance-17 的 runStep 同一套字段口径，去掉图像分析与参考图参数。
   */
  const runSample = async (plan) => {
    const sample = {
      key: plan.key,
      index: plan.index,
      presetId: plan.preset.id,
      jobId: plan.jobId,
      loadSeconds: null,
      imageSeconds: null,
      wallSeconds: null,
      pngBytes: null,
      width: null,
      height: null,
      pngPath: null,
      gpuMemoryBefore: null,
      gpuMemoryAfter: null,
      logLines: [],
      logFlags: {},
      error: null,
    }
    const cursorBefore = logCursor
    let cursorAfter = logCursor
    try {
      const healthBefore = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
      sample.gpuMemoryBefore = healthBefore?.gpu_memory ?? null
      const begin = Date.now()
      const response = await requestGenerate(
        connection.endpoint,
        connection.token,
        {
          pipeline: plan.preset.pipeline,
          modelId: plan.preset.repo,
          jobId: plan.jobId,
          tasks: [
            {
              name: plan.key,
              prompt: PROMPT,
              negative_prompt: plan.preset.negativeHint ?? '',
              seed: SEED,
              width: plan.preset.size,
              height: plan.preset.size,
              steps: plan.preset.steps,
              cfg: plan.preset.cfg,
            },
          ],
        },
        { timeoutMs: REQUEST_TIMEOUT_MS, requestMs: session.provider.jobRequestTimeoutMs },
      )
      sample.wallSeconds = Number(((Date.now() - begin) / 1000).toFixed(1))
      const result = response.results?.[0] ?? null
      sample.loadSeconds = response.load_seconds ?? null
      sample.imageSeconds = result?.seconds ?? null
      const buffer = Buffer.from(result?.image_b64 ?? '', 'base64')
      const isPng = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      if (!isPng) throw new Error(`${plan.key} 返回的不是 PNG（${buffer.length} 字节）`)
      const size = pngSize(buffer)
      sample.pngBytes = buffer.length
      sample.width = size?.width ?? null
      sample.height = size?.height ?? null
      if (plan.savePath) {
        await writeFile(plan.savePath, buffer)
        sample.pngPath = plan.savePath
      }
      const logs = await captureLogs(connection, cursorBefore)
      cursorAfter = logs.next
      sample.logLines = interestingLines(logs.lines)
      sample.logFlags = logFlags(logs.lines)
      console.log(
        `  ${plan.key} 第 ${plan.index} 张：推理 ${sample.imageSeconds}s（load ${sample.loadSeconds}s，` +
          `总 ${sample.wallSeconds}s，PNG ${sample.width}x${sample.height} ${(sample.pngBytes / 1024).toFixed(0)} KiB）`,
      )
    } catch (error) {
      sample.error = { message: String(error?.message ?? error), code: error?.code ?? null }
      const logs = await captureLogs(connection, cursorBefore).catch(() => ({ lines: [], next: cursorBefore }))
      sample.logLines = interestingLines(logs.lines)
      sample.logFlags = logFlags(logs.lines)
      cursorAfter = Math.max(cursorAfter, logs.next)
      console.log(`  ${plan.key} 第 ${plan.index} 张失败：${sample.error.message}`)
      throw error
    } finally {
      logCursor = cursorAfter
      const healthAfter = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
      sample.gpuMemoryAfter = healthAfter?.gpu_memory ?? null
    }
    return sample
  }

  /** 一个模型的连续采样：index 1 丢弃，后 n-1 张取中位数。 */
  const runSeries = async (modelReport, plan) => {
    console.log(`\n=== ${modelReport.presetId} 稳态采样：连出 ${sampleCount} 张（${plan.preset.size}²） ===`)
    for (let index = 1; index <= sampleCount; index += 1) {
      const key = `${plan.keyPrefix}${index}`
      const savePath =
        keepPng || index === sampleCount ? join(OUT_DIR, `${modelReport.presetId}-${key}.png`) : null
      const sample = await runSample({
        key,
        index,
        preset: plan.preset,
        jobId: `steady-${key}-${Date.now()}`,
        savePath,
      })
      modelReport.samples.push(sample)
      if (index === 1) modelReport.discardedSeconds = sample.imageSeconds
      if (index === 1 && Number(sample.loadSeconds) > 0) modelReport.switchLoadSeconds = sample.loadSeconds
    }
    const steady = modelReport.samples.slice(1).map((item) => item.imageSeconds)
    modelReport.medianSeconds = median(steady)
    modelReport.meanSeconds = mean(steady)
    const peaks = modelReport.samples
      .map((item) => item.gpuMemoryAfter?.max_allocated_mb)
      .filter((value) => Number.isFinite(value))
    modelReport.peakVramMb = peaks.length ? Math.max(...peaks) : null
    console.log(
      `  ${modelReport.presetId}：丢弃首张 ${modelReport.discardedSeconds}s，` +
        `后 ${steady.length} 张 [${steady.join(', ')}]s → 中位数 ${modelReport.medianSeconds}s，` +
        `峰值显存 ${modelReport.peakVramMb} MiB`,
    )
    return modelReport
  }

  let currentStep = 'provision'
  try {
    /* ---- 基线：CCU / assignments ---- */
    const beforeToken = await accessToken({ log: sink }).catch(() => null)
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
      check('启动前无遗留实例', report.assignments.before === 0, `assignments.before=${report.assignments.before ?? '?'}`)
    } else {
      check('读取 Colab 访问令牌', false, 'accessToken 失败')
    }

    /* ---- 启动会话（503/排队：45~60s 退避，最多 6 次） ---- */
    currentStep = 'provision'
    console.log(`\n=== 启动 Colab 会话（${gpu} / 默认预设 ${zPreset.id}）===`)
    let snapshot = null
    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt += 1) {
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
        if (attempt === MAX_START_ATTEMPTS) throw error
        const backoffMs = attempt < 3 ? 45_000 : 60_000
        console.log(`  ${backoffMs / 1000}s 后重试（${attempt + 1}/${MAX_START_ATTEMPTS}）`)
        await sleep(backoffMs)
      }
    }
    report.session.assignSeconds = Number(((provisionedAt - startedAt) / 1000).toFixed(1))
    report.session.readySeconds = Number(((readyAt - provisionedAt) / 1000).toFixed(1))
    report.session.provisionTotalSeconds = Number(((readyAt - startedAt) / 1000).toFixed(1))
    report.session.state = snapshot.state
    report.session.machineShape = session.handle?.machineShape ?? null
    connection = { endpoint: session.session.endpointUrl, token: session.secret.token }
    report.session.endpointUrl = connection.endpoint
    report.assignments.ourEndpoint = session.handle?.assignmentEndpoint ?? null
    check(
      '会话进入 ready',
      snapshot.state === 'ready',
      `provision 总计 ${report.session.provisionTotalSeconds}s（assign ${report.session.assignSeconds}s + ` +
        `ready ${report.session.readySeconds}s，重试 ${report.session.attempts.filter((item) => !item.ok).length} 次）`,
    )

    /* ---- 初始 /health 与日志游标 ---- */
    const health = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
    report.health.initial = health
      ? {
          phase: health.phase ?? null,
          device: health.device ?? null,
          modelId: health.model_id ?? null,
          gpuMemory: health.gpu_memory ?? null,
          versions: health.versions ?? null,
        }
      : null
    report.session.device = health?.device ?? null
    report.session.versions = health?.versions ?? null
    report.session.preloadedDefault = Boolean(
      health?.model_id && String(health.model_id).includes(String(zPreset.repo)),
    )
    check('远端 /health 可用', Boolean(health), health ? `phase=${health.phase} device=${health.device}` : '')
    const initialLogs = await captureLogs(connection, 1_000_000_000)
    logCursor = initialLogs.next

    /* ---- z-image-turbo：4 张连出 ---- */
    currentStep = 'z-image-turbo'
    await runSeries(report.models.zImageTurbo, { keyPrefix: 'z', preset: zPreset })
    const z = report.models.zImageTurbo
    check(
      'z-image-turbo 采样条数满足协议（≥4，首张丢弃）',
      z.samples.length >= 4,
      `${z.samples.length} 张，丢弃首张 ${z.discardedSeconds}s`,
    )
    check(
      'z-image-turbo 稳态样本均为 1024²',
      z.samples.slice(1).every((item) => item.width === 1024 && item.height === 1024),
      z.samples.slice(1).map((item) => `${item.width}x${item.height}`).join(' / '),
    )
    check(
      'z-image-turbo 同会话复用底座（稳态样本 load_seconds=0）',
      z.samples.slice(1).every((item) => Number(item.loadSeconds) === 0),
      `load_seconds=[${z.samples.slice(1).map((item) => item.loadSeconds).join(', ')}]`,
    )
    check('z-image-turbo 稳态中位数已记录', Number.isFinite(z.medianSeconds), `median=${z.medianSeconds}s`)

    /* ---- qwen-image-2.1：切模型后 4 张连出 ---- */
    currentStep = 'qwen-image-2.1'
    console.log('\n=== 切换到 qwen-image-2.1（daemon 会卸载 zimage 并加载 qwen） ===')
    await runSeries(report.models.qwenImage21, { keyPrefix: 'q', preset: qPreset })
    const q = report.models.qwenImage21
    check(
      'qwen-image-2.1 切模型加载已记录（首张 load_seconds>0）',
      Number(q.samples[0]?.loadSeconds) > 0,
      `load_seconds=${q.samples[0]?.loadSeconds}s`,
    )
    check(
      'qwen-image-2.1 采样条数满足协议（≥4，首张丢弃）',
      q.samples.length >= 4,
      `${q.samples.length} 张，丢弃首张 ${q.discardedSeconds}s`,
    )
    check(
      'qwen-image-2.1 稳态样本均为 1024²',
      q.samples.slice(1).every((item) => item.width === 1024 && item.height === 1024),
      q.samples.slice(1).map((item) => `${item.width}x${item.height}`).join(' / '),
    )
    check(
      'qwen-image-2.1 稳态样本 load_seconds=0',
      q.samples.slice(1).every((item) => Number(item.loadSeconds) === 0),
      `load_seconds=[${q.samples.slice(1).map((item) => item.loadSeconds).join(', ')}]`,
    )
    check('qwen-image-2.1 稳态中位数已记录', Number.isFinite(q.medianSeconds), `median=${q.medianSeconds}s`)

    const endHealth = await fetchHealth(connection.endpoint, connection.token).catch(() => null)
    report.health.end = endHealth
      ? {
          phase: endHealth.phase ?? null,
          device: endHealth.device ?? null,
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
    /* ---- 收尾：stop 并确认实例释放 ---- */
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
      report.ccu.delta = Number((report.ccu.before.currentBalance - report.ccu.after.currentBalance).toFixed(4))
    }
    report.timing.totalSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1))
    check('assignments 已清空', Array.isArray(list) && list.length === 0, `剩余 ${list?.length ?? '?'} 个`)
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
      '单会话 GPU 时间在预期内（≤20 分钟）',
      report.timing.gpuSessionSeconds !== null && report.timing.gpuSessionSeconds <= 20 * 60,
      `ready→stop ${report.timing.gpuSessionSeconds}s`,
    )
    // 回填建议：steadySeconds 按协议取后 3 张中位数；peakVramMb 取本次 /health max_allocated_mb 峰值。
    // 这里只给数值，不写 models/*.json（资产回填由 Lead 统一做）。
    report.backfill = {
      zImageTurbo: {
        steadySeconds: report.models.zImageTurbo.medianSeconds,
        previousSteadySeconds: report.models.zImageTurbo.declaredMeasured?.steadySeconds ?? null,
        peakVramMb: report.models.zImageTurbo.peakVramMb,
        previousPeakVramMb: report.models.zImageTurbo.declaredMeasured?.peakVramMb ?? null,
      },
      qwenImage21: {
        steadySeconds: report.models.qwenImage21.medianSeconds,
        previousSteadySeconds: report.models.qwenImage21.declaredMeasured?.steadySeconds ?? null,
        peakVramMb: report.models.qwenImage21.peakVramMb,
        previousPeakVramMb: report.models.qwenImage21.declaredMeasured?.peakVramMb ?? null,
        switchLoadSeconds: report.models.qwenImage21.switchLoadSeconds,
      },
      note:
        '仅建议回填 measured.steadySeconds（可与 measured.peakVramMb 一并复核）；' +
        '不改 models/*.json，最终数值由 Lead 决定。',
    }
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

/* ---------------------------------------------------------------- 离线校验 */

async function runOfflineCheck({ zPreset, qPreset, creds, hfToken }) {
  check('z-image-turbo 预设已入库', Boolean(zPreset), zPreset ? `${zPreset.repo}（${zPreset.pipeline?.loader}）` : '')
  check('qwen-image-2.1 预设已入库', Boolean(qPreset), qPreset ? `${qPreset.repo}（${qPreset.pipeline?.loader}）` : '')
  check('两个预设都是 1024²', zPreset?.size === 1024 && qPreset?.size === 1024, `${zPreset?.size} / ${qPreset?.size}`)
  check('步数/CFG 与资产一致', zPreset?.steps === 9 && qPreset?.steps === 8, `zimage ${zPreset?.steps} 步 / qwen ${qPreset?.steps} 步`)
  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu, colabHighRam: highRam })
  check('设置层接受 Colab GPU 档位', effective.colabGpu === gpu, `colabGpu=${effective.colabGpu}`)
  check('HF Token 可用（gated 检查用）', Boolean(hfToken), hfToken ? '已注入（值不打印）' : '缺失')
  let credMeta = null
  try {
    credMeta = JSON.parse(await readFile(creds.path, 'utf8'))
  } catch {
    credMeta = null
  }
  check(
    'Colab 凭据可读',
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
