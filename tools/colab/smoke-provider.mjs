#!/usr/bin/env node
/**
 * 2a 真机验收：用 ColabProvider 驱动完整 SessionManager 链路。
 *
 * 覆盖四件事（首次真机跑通后即可进 2b）：
 *   1. SessionManager 选 `provider: 'colab'` 时能完成 assign → 上传 → 起 Kernel → 读会合文件；
 *   2. 远端 daemon 在 Python 3.13 / torch 2.14 环境能无报错拉起（读 daemon 日志确认）；
 *   3. 经 cloudflared 出图 1 张（默认 sdxl-lightning，4 步），验证推理链路；
 *   4. stop() 后实例确实被 unassign（assignments 为空、CCU 活跃实例 0），不留空烧。
 *
 * 用法：
 *   node tools/colab/smoke-provider.mjs [--gpu L4] [--preset sdxl-lightning]
 *   node tools/colab/smoke-provider.mjs --gpu A100 --preset flux2-klein-9b --report .tmp/colab/klein9b-report.json
 *   node tools/colab/smoke-provider.mjs --check --gpu A100 --preset flux2-klein-9b
 * 退出码：0 全通过；1 任一步失败。
 *
 * 参数：
 *   --gpu <T4|L4|A100|G4>  Colab GPU 档位（默认 L4；flux2-klein-9b 需要 A100/G4 级别显存）
 *   --high-ram            请求高内存机型（Colab 的 A100 只在 shape=hm 下提供；缺省关闭）
 *   --preset <id>          出图预设（默认 sdxl-lightning）
 *   --size <px>            出图边长（默认跟随预设 size；OOM 时可用 768 降档验证）
 *   --report <path>        结构化 JSON 报告落盘路径（token 永不写入报告）
 *   --check                只做离线校验（预设/GPU 档位/HF Token/报告路径），不连 Colab
 *   --restart              模拟 Host 崩溃后 restore() 接管（原行为）
 *   --help, -h             显示本帮助
 *
 * HF Token：优先环境变量 `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN`，其次工作台私有的
 * `<workspace>/.imagen/settings.json` 的 `hfToken`（与 tools/verify-model.mjs 同一实现）。
 * Token 只注入 SessionManager options → daemon config，绝不打印、绝不进报告。
 */

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { LIMITS, PRESETS, SETTINGS } from '../../shared/contract.js'
import { mergeSettings } from '../../lib/settings.js'
import { fetchHealth, requestGenerate, requestLogs } from '../../lib/remote.js'
import { SessionManager } from '../../lib/session.js'
import { accessToken, ccuInfo, listAssignments } from '../../lib/colab/client.js'
import { readHfToken } from '../verify-model.mjs'

const args = process.argv.slice(2)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}
const help = args.includes('--help') || args.includes('-h')
const checkOnly = args.includes('--check')
const restart = args.includes('--restart')
const writeMeasured = args.includes('--write')
// Colab 的 A100 只在高内存机型（assign shape=hm）提供，普通档位申请会 503；G4 同理不可用。
const highRam = args.includes('--high-ram')
const gpu = String(argValue('--gpu') || 'L4').trim().toUpperCase()
const configArg = argValue('--config')
const configPath = configArg ? resolve(process.cwd(), configArg) : null
const presetArg = argValue('--preset')
const reportArg = argValue('--report')
const reportPath = reportArg ? resolve(process.cwd(), reportArg) : null
const outDir = join(process.cwd(), '.tmp/colab')
const stamp = () => new Date().toISOString().slice(11, 19)
// 与 tools/verify-model.mjs 的验证协议同 prompt / 同 seed / 同采样参数，便于 measured 回填比对。
const PROMPT =
  'A red-crowned crane standing in a misty lotus pond at dawn, Chinese ink painting, soft light, fine detail'
const SEED = 42

async function loadTargetPreset() {
  if (configPath) {
    const raw = JSON.parse(await readFile(configPath, 'utf8'))
    return { preset: raw, presetId: String(raw?.id || presetArg || 'custom').trim() }
  }
  const id = String(presetArg || 'sdxl-lightning').trim()
  return { preset: PRESETS.find((item) => item.id === id) || null, presetId: id }
}

/** 出图边长：`--size` 优先，按契约钳制并对齐 8px；缺省跟随预设 size。 */
function resolveSize(preset) {
  const raw = Number(argValue('--size'))
  const base = Number.isFinite(raw) && raw > 0 ? raw : Number(preset?.size) || 1024
  const { min, max, step } = LIMITS.width
  const clamped = Math.min(max, Math.max(min, Math.round(base)))
  return Math.round(clamped / step) * step
}

const sink = {
  debug: () => {},
  info: (...items) => console.log(`${stamp()} info  ${items.join(' ')}`),
  warn: (...items) => console.log(`${stamp()} warn  ${items.join(' ')}`),
  error: (...items) => console.log(`${stamp()} error ${items.join(' ')}`),
}

/** PNG 头读宽高（只用于报告，不依赖第三方图像库）。 */
function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** HF Token 来源判定（只报来源，不返回/打印值本身）。 */
async function resolveHfToken() {
  const token = await readHfToken()
  if (!token) return { token: null, source: 'none' }
  for (const name of ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN']) {
    const value = typeof process.env[name] === 'string' ? process.env[name].trim() : ''
    if (value === token) return { token, source: 'env' }
  }
  return { token, source: 'settings' }
}

/** CCU 快照只留数值字段：原始响应的其它字段不进报告。 */
function ccuSummary(info) {
  if (!info || typeof info !== 'object') return null
  return {
    assignmentsCount: Number.isFinite(info.assignmentsCount) ? info.assignmentsCount : null,
    currentBalance: Number.isFinite(info.currentBalance) ? info.currentBalance : null,
  }
}

/** 从 /logs 行里提取实际下载体积（GiB）：排除磁盘可用空间探测行。 */
function downloadGbFromLogs(lines) {
  let last = null
  for (const line of lines ?? []) {
    if (typeof line !== 'string') continue
    if (/可用|free/i.test(line)) continue
    if (!/(?:下载|download).{0,24}([\d.]+)\s*GiB/i.test(line)) continue
    const matches = [...line.matchAll(/([\d.]+)\s*GiB/gi)]
    for (const match of matches) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) last = value
    }
  }
  return last
}

const CHECKS = []
function check(name, ok, detail = '') {
  CHECKS.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function usage() {
  return [
    '用法：node tools/colab/smoke-provider.mjs [--gpu L4|A100|G4|T4] [--high-ram] [--preset <id> | --config <path>] [--size <px>]',
    '                                      [--report <path>] [--write] [--restart] [--check] [--help]',
    '',
    '  --gpu <档位>      Colab GPU 档位（默认 L4；flux2-klein-9b 用 A100，需同时给 --high-ram）',
    '  --high-ram        请求高内存机型（A100 只在 shape=hm 下提供；缺省关闭）',
    '  --preset <id>     出图预设（默认 sdxl-lightning）',
    '  --config <path>   从模型 JSON 草稿文件加载预设（如 .tmp/models/z-image-turbo.json）',
    '  --size <px>       出图边长（默认跟随预设 size；OOM 时用 768 降档）',
    '  --report <path>   结构化 JSON 报告落盘路径（如 .tmp/colab/klein9b-report.json）',
    '  --write           将实测 measured 写回 --config 指定的 JSON 文件',
    '  --check           只做离线校验，不连 Colab、不消耗 CCU',
    '  --restart         模拟 Host 崩溃后 restore() 接管',
    '  --help, -h        显示本帮助',
  ].join('\n')
}

/**
 * 离线校验（--check）：不连 Colab、不消耗 CCU。
 *
 * 校验链路与真机一致：预设存在 → mergeSettings 接受 GPU 档位 → SessionManager
 * effectiveSettings() 接受同一档位并带上 HF Token（只报布尔）→ gated 模型 Token 可用。
 */
async function runCheck(hfToken, { preset, presetId, size }) {
  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu, colabHighRam: highRam })
  check(
    configPath ? '草稿配置已读取' : '预设已入库',
    Boolean(preset),
    preset ? `${presetId} → ${preset.repo}` : `models/ 下没有 ${presetId}`,
  )
  check(
    '设置层接受 Colab GPU 档位',
    effective.colabGpu === gpu,
    `colabGpu=${effective.colabGpu}（支持 ${SETTINGS.colabGpus.join(' / ')}）`,
  )
  check('高内存机型参数', effective.colabHighRam === highRam, `highRam=${effective.colabHighRam}`)
  const session = new SessionManager({
    ctx: { workspace: process.cwd() },
    defaultPreset: presetId,
    deps: { log: sink },
    options: { provider: 'colab', colabGpu: gpu, colabHighRam: highRam, hfToken, enableGpu: true },
  })
  const view = session.effectiveSettings()
  check('SessionManager 接受 Colab GPU 档位', view.colabGpu === gpu, `effective colabGpu=${view.colabGpu}`)
  check(
    'SessionManager 接受 HF Token 注入',
    Boolean(view.hfToken) === Boolean(hfToken),
    hfToken ? '已注入（值不打印）' : '未提供',
  )
  if (preset?.gated === true) {
    check(
      'gated 模型有可用 HF Token',
      Boolean(hfToken),
      hfToken ? 'Token 可用（值不打印）' : '需要 HF_TOKEN 或 .imagen/settings.json 的 hfToken',
    )
  }
  check('报告路径', true, reportPath ?? '未指定 --report（不落盘）')
  check('出图边长', size % LIMITS.width.step === 0, `${size}x${size}`)
  const failed = CHECKS.filter((item) => !item.ok)
  console.log(`\n${failed.length ? `${failed.length} 项失败：${failed.map((item) => item.name).join('、')}` : '离线校验全部通过'}`)
  return failed.length === 0
}

async function main() {
  if (help) {
    console.log(usage())
    return
  }

  const { preset, presetId } = await loadTargetPreset()
  const size = resolveSize(preset)
  const { token: hfToken, source: hfTokenSource } = await resolveHfToken()
  console.log(`colab 冒烟：gpu=${gpu} highRam=${highRam ? 'on' : 'off'} preset=${presetId} size=${size}x${size}`)
  if (hfToken) console.log('  · 已注入 HF Token（来源：环境变量或私有设置文件，值不打印）')

  if (checkOnly) {
    const ok = await runCheck(hfToken, { preset, presetId, size })
    if (!ok) process.exitCode = 1
    return
  }

  if (!preset) throw new Error(`未知预设：${presetId}（请确认 models/ 已收录并已跑 npm run models:build）`)

  // 走真实设置链路（契约 + mergeSettings），确保 UI 保存的 provider/colabGpu 能落到会话。
  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu, colabHighRam: highRam })
  if (effective.colabGpu !== gpu) {
    throw new Error(`Colab GPU 档位不受支持：${gpu}（支持 ${SETTINGS.colabGpus.join(' / ')}）`)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    provider: 'colab',
    gpu,
    highRam,
    presetId,
    presetRepo: preset.repo ?? null,
    gated: preset.gated === true,
    size: { width: size, height: size },
    hfToken: { present: Boolean(hfToken), source: hfTokenSource },
    session: { state: null, assignSeconds: null, readySeconds: null, provisionTotalSeconds: null },
    health: null,
    daemon: null,
    job: null,
    measured: {
      loadSeconds: null,
      steadySeconds: null,
      peakVramMb: null,
      downloadGb: null,
      declaredDownloadGb: preset.pipeline?.downloadGb ?? null,
    },
    ccu: { before: null, after: null },
    assignments: { before: null, after: null },
    restart: null,
    checks: CHECKS,
    error: null,
    ok: false,
  }

  const session = new SessionManager({
    ctx: { workspace: process.cwd() },
    defaultPreset: presetId,
    deps: { log: sink },
    options: {
      provider: effective.provider,
      colabGpu: effective.colabGpu,
      colabHighRam: effective.colabHighRam,
      hfToken,
      enableGpu: true,
      // 出图链路较长：给足排队/装依赖/下权重的时间，但空闲关机仍按 10 分钟。
      idleTimeoutSec: 600,
      provisionTimeoutMs: 25 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
    },
  })

  const startedAt = Date.now()
  let smokeJobId = null
  let provisionedAt = null
  let readyAt = null
  let beforeToken = null
  try {
    // CCU / assignments 基线（stop 后再取一次，确认不留实例）。
    beforeToken = await accessToken({ log: sink }).catch(() => null)
    if (beforeToken) {
      report.assignments.before = await listAssignments(beforeToken)
        .then((list) => (Array.isArray(list) ? list.length : null))
        .catch(() => null)
      report.ccu.before = ccuSummary(await ccuInfo(beforeToken).catch(() => null))
      console.log(
        `  · 启动前：assignments=${report.assignments.before ?? '?'}，` +
          `CCU assignmentsCount=${report.ccu.before?.assignmentsCount ?? '?'}`,
      )
    }

    console.log(`\n=== 启动 Colab 会话（${gpu} / ${presetId} / ${size}x${size}）===`)
    await session.start(presetId)
    provisionedAt = Date.now()
    report.session.assignSeconds = Number(((provisionedAt - startedAt) / 1000).toFixed(1))
    let lastState = ''
    const snapshot = await session.ensureReady({
      timeoutMs: 25 * 60 * 1000,
      onTick: (snap) => {
        const line = `${snap.state}/${snap.phase ?? '-'} ${snap.detail ?? ''}`.trim()
        if (line !== lastState) {
          lastState = line
          console.log(`  ${stamp()} ${line}`)
        }
      },
    })
    readyAt = Date.now()
    report.session.readySeconds = Number(((readyAt - provisionedAt) / 1000).toFixed(1))
    report.session.provisionTotalSeconds = Number(((readyAt - startedAt) / 1000).toFixed(1))
    report.session.state = snapshot.state
    // Colab 的 machineShape 能佐证是否拿到了高内存机型（shape=hm 时通常为 1）。
    report.session.machineShape = session.handle?.machineShape ?? null
    check(
      '会话进入 ready',
      snapshot.state === 'ready',
      `provision 总计 ${report.session.provisionTotalSeconds}s（assign ${report.session.assignSeconds}s + ready ${report.session.readySeconds}s）`,
    )

    const endpoint = session.session.endpointUrl
    const token = session.secret.token
    console.log(`\nendpoint=${endpoint}`)

    const health = await fetchHealth(endpoint, token).catch(() => null)
    const healthDevice = String(health?.device ?? '').trim()
    report.health = health
      ? {
          phase: health.phase ?? null,
          device: health.device ?? null,
          deviceCount: health.device_count ?? null,
          modelId: health.model_id ?? null,
          gpuMemory: health.gpu_memory ?? null,
          versions: health.versions ?? null,
          deviceMatchesGpu: healthDevice.toUpperCase().includes(gpu),
        }
      : null
    check('远端 /health 可用', Boolean(health), health ? `phase=${health.phase} device=${health.device} model=${health.model_id}` : '')
    // 档位断言只要求 device 非空且与 --gpu 不冲突：A100/G4 的 device 字符串各平台写法不同，
    // 硬编码「包含 L4」会在 A100 上误报；不匹配只作为 device 型号证据记录。
    check('远端 GPU 型号已识别', Boolean(healthDevice), healthDevice)
    if (healthDevice && !healthDevice.toUpperCase().includes(gpu)) {
      console.log(`  · 提示：/health.device=${healthDevice} 未包含档位名 ${gpu}，以 device 为准记录`)
    }

    const logs = await session.provider.readLogs(session, session.handle).catch(() => null)
    if (logs) {
      const python = /python[= ]([\d.]+)/i.exec(logs)?.[1] ?? ''
      const torchLine = /torch[= ]([\d.]+)/i.exec(logs)?.[1] ?? ''
      const hasTraceback = /Traceback \(most recent call last\)/.test(logs)
      report.daemon = { python: python || null, torch: torchLine || null, hasTraceback }
      check('daemon 启动日志无 traceback', !hasTraceback)
      console.log(`  日志摘要：python=${python || '?'} torch=${torchLine || '?'} 行数=${logs.split('\n').length}`)
    } else {
      check('能读到 daemon 日志', false, 'readLogs 返回空')
    }

    // 诊断：/health 正常但 /job 超时时，先分清是 undici、cloudflared 还是响应分帧的问题。
    const probe = async (label, path, headers) => {
      const begin = Date.now()
      try {
        const res = await fetch(new URL(path, endpoint), {
          headers: { Authorization: `Bearer ${token}`, ...headers },
          signal: AbortSignal.timeout(8000),
        })
        const text = await res.text()
        console.log(`  probe ${label}: ${res.status} ${text.length}B ${Date.now() - begin}ms`)
      } catch (error) {
        console.log(`  probe ${label}: ERR ${error?.message ?? error} ${Date.now() - begin}ms`)
      }
    }
    await probe('health', '/health', {})
    await probe('job-default', '/job?id=missing', {})
    await probe('job-identity-close', '/job?id=missing', { 'Accept-Encoding': 'identity', Connection: 'close' })

    console.log(`\n=== 出图 1 张（${size}x${size}）===`)
    smokeJobId = `smoke-${Date.now()}`
    const gpuMemoryBefore = health?.gpu_memory ?? null
    const jobBegin = Date.now()
    const response = await requestGenerate(
      endpoint,
      token,
      {
        pipeline: preset.pipeline,
        modelId: preset.repo,
        jobId: smokeJobId,
        tasks: [
          {
            name: '01',
            prompt: PROMPT,
            negative_prompt: preset.negativeHint ?? '',
            seed: SEED,
            width: size,
            height: size,
            steps: preset.steps,
            cfg: preset.cfg,
          },
        ],
      },
      // 大模型（如 32GiB 权重的 flux2-klein-9b）首次作业包含下载 + 加载，10 分钟不够；
      // 25 分钟与 provisionTimeoutMs 同量级，小模型照常很快返回。
      { timeoutMs: 25 * 60 * 1000, requestMs: session.provider.jobRequestTimeoutMs },
    )
    const wallSeconds = Number(((Date.now() - jobBegin) / 1000).toFixed(1))
    const image = Buffer.from(response.results?.[0]?.image_b64 ?? '', 'base64')
    const isPng = image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    const imageSize = isPng ? pngSize(image) : null
    const afterHealth = await fetchHealth(endpoint, token).catch(() => null)
    const gpuMemoryAfter = afterHealth?.gpu_memory ?? null
    if (gpuMemoryAfter) report.health.gpuMemory = gpuMemoryAfter
    const jobLogs = await requestLogs(endpoint, token, 0, 8000)
      .then((payload) => (Array.isArray(payload?.lines) ? payload.lines : []))
      .catch(() => [])
    report.job = {
      jobId: smokeJobId,
      loadSeconds: response.load_seconds ?? null,
      imageSeconds: response.results?.[0]?.seconds ?? null,
      wallSeconds,
      pngBytes: image.length,
      width: imageSize?.width ?? null,
      height: imageSize?.height ?? null,
      requestedWidth: size,
      requestedHeight: size,
      isPng,
      gpuMemoryBefore,
      gpuMemoryAfter,
    }
    // measured 四要素（供资产回填）：加载秒数 / 单张稳态秒数 / 峰值显存 / 下载体积。
    report.measured.loadSeconds = report.job.loadSeconds
    report.measured.steadySeconds = report.job.imageSeconds
    report.measured.peakVramMb = Number.isFinite(gpuMemoryAfter?.max_allocated_mb)
      ? gpuMemoryAfter.max_allocated_mb
      : null
    const measuredDownloadGb = downloadGbFromLogs(jobLogs)
    report.measured.downloadGb = measuredDownloadGb
    report.measured.downloadGbNote =
      measuredDownloadGb === null
        ? '日志里没有可解析的下载体积；declaredDownloadGb 来自预设 pipeline.downloadGb，实测值以 verify-model 报告为准'
        : '从 daemon 日志解析到下载体积'
    check(
      '收到合法 PNG',
      isPng,
      `${(image.length / 1024).toFixed(0)} KiB / ${wallSeconds}s（加载 ${report.job.loadSeconds ?? '-'}s / 推理 ${report.job.imageSeconds ?? '-'}s / ${imageSize?.width ?? '?'}x${imageSize?.height ?? '?'}）`,
    )
    if (isPng) {
      await mkdir(outDir, { recursive: true })
      const file = join(outDir, `smoke-${Date.now()}.png`)
      await writeFile(file, image)
      report.job.pngPath = file
      console.log(`  已保存：${file}`)
    }
    console.log(
      `  显存（MiB）：出图前 ${JSON.stringify(gpuMemoryBefore)} → 出图后 ${JSON.stringify(gpuMemoryAfter)}`,
    )
    console.log(
      `  measured：load=${report.measured.loadSeconds ?? '-'}s steady=${report.measured.steadySeconds ?? '-'}s ` +
        `peakVram=${report.measured.peakVramMb ?? '-'}MB download=${report.measured.downloadGb ?? '未解析'}` +
        `GiB（声明 ${report.measured.declaredDownloadGb ?? '-'}）`,
    )

    if (restart) {
      console.log('\n=== 模拟 Host 崩溃后 restore 接管 ===')
      // 崩溃：只停本地定时器，不 dispose（dispose 会 unassign），也不清记录。
      session.clearTimers()
      session.disposed = true
      const second = new SessionManager({
        ctx: { workspace: process.cwd() },
        defaultPreset: presetId,
        deps: { log: sink },
        options: {
          provider: 'colab',
          colabGpu: gpu,
          hfToken,
          idleTimeoutSec: 600,
          provisionTimeoutMs: 25 * 60 * 1000,
        },
      })
      const restored = await second.restore()
      check('restore 返回快照', Boolean(restored), restored?.state)
      const snap2 = await second.ensureReady({ timeoutMs: 180000 })
      check('restore 后重新 ready', snap2.state === 'ready', snap2.state)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      check(
        '顶栏数据 providerUsage 可见',
        Number.isFinite(second.session.providerUsage?.balance),
        JSON.stringify(second.session.providerUsage),
      )
      report.restart = { restoredState: restored?.state ?? null, readyState: snap2.state ?? null }
      await second.stop()
    }
  } catch (error) {
    console.log(`\n失败：${error?.message ?? error}`)
    report.error = { message: String(error?.message ?? error), code: error?.code ?? null }
    const logs = await session.provider.readLogs(session, session.handle).catch(() => null)
    if (logs) {
      console.log('\n--- daemon 日志尾部 ---')
      report.error.daemonLogTail = logs.split('\n').slice(-60)
      console.log(report.error.daemonLogTail.join('\n'))
    }
    // 大响应专项：同一个已完成 job 分别用 fetch 默认头 / identity+close / curl 拉一次。
    if (smokeJobId && session.session.endpointUrl) {
      const ep = session.session.endpointUrl
      const tk = session.secret.token
      for (const item of [
        ['default', {}],
        ['identity-close', { 'Accept-Encoding': 'identity', Connection: 'close' }],
      ]) {
        const begin = Date.now()
        try {
          const res = await fetch(new URL(`/job?id=${smokeJobId}`, ep), {
            headers: { Authorization: `Bearer ${tk}`, ...item[1] },
            signal: AbortSignal.timeout(20000),
          })
          const text = await res.text()
          console.log(`  bigjob ${item[0]}: ${res.status} ${text.length}B ${Date.now() - begin}ms`)
        } catch (fetchError) {
          console.log(`  bigjob ${item[0]}: ERR ${fetchError?.message ?? fetchError} ${Date.now() - begin}ms`)
        }
      }
      const curl = spawnSync(
        'curl',
        ['-sS', '-m', '20', '-o', join(outDir, 'job.json'), '-w', '%{http_code} %{size_download} %{time_total}',
          '-H', `authorization: Bearer ${tk}`, `${ep}/job?id=${smokeJobId}`],
        { encoding: 'utf8' },
      )
      console.log(`  bigjob curl: ${curl.stdout ?? ''} ${curl.stderr ? curl.stderr.trim() : ''}`)
    }
    process.exitCode = 1
  } finally {
    console.log('\n=== stop() 释放 ===')
    const token = await accessToken({ log: sink }).catch(() => null)
    await session.stop().catch((error) => console.log(`stop 异常：${error.message}`))
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const list = token ? await listAssignments(token).catch(() => null) : null
    const ccu = token ? await ccuInfo(token).catch(() => null) : null
    report.assignments.after = Array.isArray(list) ? list.length : null
    report.ccu.after = ccuSummary(ccu)
    check('assignments 已清空', Array.isArray(list) && list.length === 0, `剩余 ${list?.length ?? '?'} 个`)
    check(
      'CCU 活跃实例归零',
      Number(ccu?.assignmentsCount ?? -1) === 0,
      `assignmentsCount=${ccu?.assignmentsCount} balance=${ccu?.currentBalance?.toFixed?.(2)}`,
    )
    session.dispose()

    const failed = CHECKS.filter((item) => !item.ok)
    report.ok = failed.length === 0 && !report.error
    report.failedChecks = failed.map((item) => item.name)
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      console.log(`\n报告已写入：${reportPath}`)
    }
    if (report.ok && writeMeasured && configPath) {
      const next = {
        ...preset,
        measured: {
          peakVramMb: report.measured.peakVramMb,
          loadSeconds: report.measured.loadSeconds,
          steadySeconds: report.measured.steadySeconds,
          downloadGb: report.measured.downloadGb,
        },
      }
      if (report.measured.downloadGb !== null && next.pipeline && typeof next.pipeline === 'object') {
        next.pipeline = { ...next.pipeline, downloadGb: report.measured.downloadGb }
      }
      await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      console.log(`measured 已写回：${configPath}`)
    }
    if (report.error) {
      console.log(`\n执行失败：${report.error.message}${report.error.code ? `（${report.error.code}）` : ''}`)
      process.exitCode = 1
    } else if (failed.length) {
      console.log(`\n${failed.length} 项失败：${failed.map((item) => item.name).join('、')}`)
      process.exitCode = 1
    } else {
      console.log('\n全部通过')
    }
  }
}

main().catch((error) => {
  console.error(`\n失败：${error?.message ?? error}`)
  process.exitCode = 1
})
