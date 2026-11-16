/**
 * kaggle CLI 探测与调用工具。
 *
 * 关键运行约束（详见 docs/SPEC.md 第 4 节与 docs/ARCHITECTURE.md）：
 *  - 不使用 `kaggle auth login` 的本地回显判断登录态（仅为本地记录，不代表 API 连通）；
 *  - 不以 `kaggle quota` 失败阻断使用（配额查询可能因权限受限，只作为展示项）；
 *  - kernels.* 接口偶发鉴权抖动，内部内置退避重试；
 *  - 实际鉴权有效性以真实 API 调用成败为准。
 */

// kaggle 2.x 每次都是独立 Python 进程启动，本机实测单次 9~15 秒；20 秒上限过于贴近，
// 冷启动或机器繁忙时会被误判成「CLI 不存在/鉴权失败」。统一放宽（值见 shared/contract.js）。
import { TIMEOUTS } from '../shared/contract.js'
import { createUsernameCache, finalizeProbeResult, runAuthRetry, simplifyKernelLog } from './kaggle-shared.js'
import { createLogger } from './log.js'
import { logText } from './redact.js'

const log = createLogger({ scope: 'kaggle' })

const CLI_TIMEOUT_MS = TIMEOUTS.cliMs
const VERSION_TIMEOUT_MS = TIMEOUTS.cliMs
const QUOTA_TIMEOUT_MS = TIMEOUTS.cliQuotaMs

/**
 * kaggle 子命令归类：日志只记类别，不打印完整 argv
 * （folder 路径、kernelId 等参数可能带账号信息或用户目录）。
 */
function cliCategory(argv = []) {
  const args = argv.slice(1)
  const first = String(args[0] ?? '')
  if (first === '--version' || first === '-V') return 'version'
  if (first === 'quota') return 'quota'
  if (first === 'config') return 'auth'
  if (first === 'kernels') {
    const sub = String(args[1] ?? '')
    if (sub === 'push') return 'push'
    if (sub === 'status') return 'status'
    if (sub === 'logs') return 'logs'
    if (sub === 'output') return 'output'
    // `kernels list` 是鉴权探测（probeKaggle / 账号接入检查）。
    if (sub === 'list') return 'auth'
  }
  return 'other'
}

function originOf(ctx) {
  try {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory?.defaultDirectory) return workingDirectory.defaultDirectory
  } catch {}
  return process.cwd()
}

/**
 * 运行一次 kaggle CLI。
 *
 * 返回值里 `failure` 用于区分失败原因，避免上层把「启动超时」误报成「没装 CLI」：
 *  - `null`：命令正常跑完（退出码可能非 0，交给调用方判断）；
 *  - `'timeout'`：超过 timeoutMs 被中止（stdout 通常为空）；
 *  - `'spawn'`：解析可执行文件或起进程失败（真的没安装 / 无法执行）。
 *
 * 任何失败都以返回值表达，不向外抛异常：kaggle 缺失时 `session.start` 应走可读的
 * 错误状态，而不是让状态机停在半路。
 */
export async function runCli(ctx, argv, timeoutMs = CLI_TIMEOUT_MS) {
  const startedAt = Date.now()
  const category = cliCategory(argv)
  /** 所有返回路径统一在这里打点：类别 / 耗时 / 退出码 / failure 类型。 */
  const finish = (result) => {
    const fields =
      `cmd=${category} elapsedMs=${Date.now() - startedAt} exit=${result.code} failure=${result.failure ?? 'null'}`
    if (result.failure === 'spawn' || result.failure === 'timeout') {
      // CLI 起不来 / 卡死是会话启动失败的高频原因，必须能在 Host 日志里直接定位。
      log.warn(`cli_failed ${fields} detail=${logText(result.stderr)}`)
    } else if (result.code !== 0) {
      log.info(`cli_exit ${fields}`)
    } else {
      log.debug(`cli_ok ${fields}`)
    }
    return result
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let exe
    try {
      exe = await ctx.subprocess.resolveExecutable(argv[0])
    } catch (error) {
      return finish({ code: -1, stdout: '', stderr: String(error?.message ?? error), failure: 'spawn' })
    }

    let handle
    try {
      handle = ctx.subprocess.spawn({
        argv: [exe, ...argv.slice(1)],
        cwd: originOf(ctx),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 128 * 1024 },
          stderr: { maxBytes: 128 * 1024 },
        },
        graceMs: 2000,
        signal: controller.signal,
      })
    } catch (error) {
      return finish({ code: -1, stdout: '', stderr: String(error?.message ?? error), failure: 'spawn' })
    }

    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      if (controller.signal.aborted) {
        return finish({ code: -1, stdout: '', stderr: `timeout after ${timeoutMs}ms`, failure: 'timeout' })
      }
      return finish({ code: -1, stdout: '', stderr: String(error?.message ?? error), failure: 'spawn' })
    }

    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return finish({ code: outcome?.exitCode ?? -1, stdout, stderr, failure: null })
  } finally {
    clearTimeout(timer)
  }
}

function looksUnauthenticated(result) {
  const text = `${result.stdout}\n${result.stderr}`
  return result.code !== 0 && /Authentication required|permission .*denied|401|403/i.test(text)
}

function parseQuota(text) {
  const lines = text.split(/\r?\n/)
  // 真实输出是表格：`GPU  0.72h  29.28h  30.00h  2026-11-14T00:00:00+00:00`
  const gpuLine = lines.find((line) => /^\s*GPU\b/i.test(line))
  if (gpuLine) {
    const numbers = gpuLine.match(/\d+(?:\.\d+)?/g) ?? []
    const refreshAt = (gpuLine.match(/\d{4}-\d{2}-\d{2}T[\d:+-]+/) ?? [])[0]
    if (numbers.length >= 3) {
      return {
        available: true,
        usedHours: Number(numbers[0]),
        remainingHours: Number(numbers[1]),
        totalHours: Number(numbers[2]),
        refreshAt,
        raw: gpuLine.trim(),
      }
    }
  }
  // 退化：形如 "12.5h / 30h" 的写法
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h\b/i)
  const total = text.match(/\/\s*(\d+(?:\.\d+)?)\s*h\b/i) ?? text.match(/\bof\s+(\d+(?:\.\d+)?)\s*h\b/i)
  if (!hours) return { available: false, raw: text.trim().slice(0, 400) }
  return {
    available: true,
    usedHours: Number(hours[1]),
    totalHours: total ? Number(total[1]) : undefined,
    raw: text.trim().slice(0, 400),
  }
}

/** 从 `kaggle --version` 输出里取纯版本号（输出形如 `Kaggle CLI 2.2.5`）。 */
function cliVersionOf(result) {
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  const match = text.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
  if (match) return match[1]
  return text.replace(/^kaggle(\s+cli)?\s*/i, '').trim().slice(0, 40) || 'unknown'
}

/** CLI 缺失/不可执行时的统一探测结果。 */
function cliMissingProbe(detail, note) {
  return {
    provider: 'kaggle',
    cli: { present: false, error: String(detail ?? '').trim().slice(0, 300) },
    auth: { ok: false, checkedAt: new Date().toISOString(), errorCode: 'cli_missing' },
    quota: { available: false, raw: '' },
    notes: [note],
  }
}

/**
 * 未安装 CLI 的安装提示。
 *
 * Windows 上「pip 装完但命令仍找不到」是新手最常见的卡点（Scripts 目录没进 PATH），
 * 所以安装命令后面把排查步骤一次写清楚，避免用户以为插件坏了。
 */
const CLI_INSTALL_NOTE =
  '未找到 kaggle CLI，请先安装：pip install -U kaggle' +
  '（Windows 安装后若仍提示找不到命令，请确认 Python Scripts 目录已加入系统 PATH，并重启 DSH Desktop）'

/**
 * Kaggle 凭据缺失时的说明。
 *
 * 口径对齐 kaggle CLI 2.x：`kaggle auth login` 写入 OAuth 凭据（含 refresh_token，可自动续期），
 * 同时兼容网页端生成的 access_token 与旧版 kaggle.json；三个位置都写清楚，
 * 避免新手照旧文档去手工创建文件。
 */
const AUTH_CREDENTIAL_NOTE =
  '未找到可用的 Kaggle 凭据：kaggle CLI 2.x 运行 kaggle auth login 会把 OAuth 凭据写入 ' +
  '%USERPROFILE%\\.kaggle\\credentials.json（含 refresh_token，过期可自动续期）；' +
  '也可在 https://www.kaggle.com/settings 生成 API Token 保存为 ' +
  '%USERPROFILE%\\.kaggle\\access_token；旧版 CLI 仍兼容 %USERPROFILE%\\.kaggle\\kaggle.json'

/** CLI 启动超时（不是没安装）时的统一探测结果。 */
function cliTimeoutProbe(detail) {
  return {
    provider: 'kaggle',
    cli: { present: true, version: null, error: `kaggle --version 超过 ${Math.round(VERSION_TIMEOUT_MS / 1000)} 秒未返回` },
    auth: {
      ok: false,
      checkedAt: new Date().toISOString(),
      errorCode: 'cli_timeout',
      detail: String(detail ?? '').trim().slice(0, 300),
    },
    quota: { available: false, raw: '' },
    notes: ['kaggle CLI 启动超时（常见原因：Python 环境过慢或被本地安全软件拦截），请稍后重试'],
  }
}

export async function probeKaggle(ctx) {
  const version = await runCli(ctx, ['kaggle', '--version'], VERSION_TIMEOUT_MS)
  const versionText = `${version.stdout ?? ''}\n${version.stderr ?? ''}`.trim()

  if (version.failure === 'spawn') {
    return cliMissingProbe(version.stderr || versionText, CLI_INSTALL_NOTE)
  }
  if (version.failure === 'timeout') {
    return cliTimeoutProbe(version.stderr)
  }
  if (version.code !== 0 && !/kaggle/i.test(versionText)) {
    return cliMissingProbe(versionText, CLI_INSTALL_NOTE)
  }

  const cli = { present: true, version: cliVersionOf(version) }
  const versionNote = cli.version === 'unknown' ? 'kaggle CLI 已找到（版本未知）' : `kaggle CLI ${cli.version}`

  // CLI 版本确认之后，鉴权 / 配额 / 用户名三件事互不依赖：并发发起，
  // 把一次「检查环境」从 ~35 秒压到约 15 秒（每项都是独立 python 进程，串行等待纯属浪费）。
  const authTask = runAuthRetry(async () => {
    const result = await runCli(ctx, ['kaggle', 'kernels', 'list', '--page-size', '1'])
    if (result.code === 0) {
      return { done: true, value: { ok: true, checkedAt: new Date().toISOString() } }
    }
    const value = {
      ok: false,
      checkedAt: new Date().toISOString(),
      errorCode:
        result.failure === 'timeout'
          ? 'cli_timeout'
          : looksUnauthenticated(result)
            ? 'auth_required'
            : 'unknown',
      detail: (result.stderr || result.stdout).trim().slice(0, 300),
    }
    // CLI 启动超时再重试只会把一次探测拖得更久；记录后直接返回。
    return { done: result.failure === 'timeout', value }
  })

  const quotaTask = runCli(ctx, ['kaggle', 'quota'], QUOTA_TIMEOUT_MS).then((quotaResult) => {
    return quotaResult.code === 0
      ? parseQuota(quotaResult.stdout || quotaResult.stderr)
      : { available: false, raw: '' }
  })

  const usernameTask = kaggleUsername(ctx).catch(() => null)

  const [auth, quota, username] = await Promise.all([authTask, quotaTask, usernameTask])

  return finalizeProbeResult({
    cli,
    auth,
    quota,
    username,
    prefixNotes: [versionNote],
    authCredentialNote: AUTH_CREDENTIAL_NOTE,
  })
}

const usernameCache = createUsernameCache()

/** 读取当前凭据里的 Kaggle 用户名（kernel id 前缀）。结果缓存 10 分钟。 */
export async function kaggleUsername(ctx, { force = false } = {}) {
  if (!force) {
    const cached = usernameCache.get()
    if (cached) return cached
  }
  const result = await runCli(ctx, ['kaggle', 'config', 'view'], TIMEOUTS.cliMs)
  if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().slice(0, 300) || 'kaggle config view 失败')
  const match = result.stdout.match(/^\s*-\s*username:\s*(\S+)\s*$/im)
  if (!match) throw new Error('未在 kaggle config view 输出中找到 username')
  return usernameCache.set(match[1])
}

/**
 * 推送 kernel 并触发运行。
 * @param {object} ctx
 * @param {string} folder 含 kernel-metadata.json 的目录
 * @param {{ accelerator?: string, timeoutSec?: number }} options
 */
export async function pushKernel(ctx, folder, options = {}) {
  const argv = ['kaggle', 'kernels', 'push', '-p', folder]
  if (options.accelerator) argv.push('--accelerator', options.accelerator)
  if (options.timeoutSec) argv.push('-t', String(options.timeoutSec))
  const result = await runCli(ctx, argv, TIMEOUTS.cliPushMs)
  const text = `${result.stdout}\n${result.stderr}`
  return {
    ok: result.code === 0 && !/Kernel push error|error:/i.test(text),
    code: result.code,
    url: (text.match(/https:\/\/www\.kaggle\.com\/code\/[\w./-]+/) ?? [])[0] ?? null,
    authFailed: looksUnauthenticated(result),
    output: text.trim().slice(0, 1200),
  }
}

/** CLI 输出是否表示「Kernel 不存在 / 已删除 / 无权访问」。 */
function looksMissingKernel(text) {
  return /not\s*found|\b404\b|cannot access kernel|permission 'kernels\.get' was denied|does not exist/i.test(
    String(text ?? ''),
  )
}

/** 查询 kernel 运行状态；返回 `RUNNING` / `COMPLETE` 之类的短状态。 */
export async function kernelStatus(ctx, kernelId) {
  const result = await runCli(ctx, ['kaggle', 'kernels', 'status', kernelId], TIMEOUTS.cliMs)
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout).trim().slice(0, 400)
    return { ok: false, status: null, missing: looksMissingKernel(output), output }
  }
  const quoted = result.stdout.match(/has status\s+"([^"]+)"/i)?.[1] ?? ''
  return {
    ok: true,
    status: quoted.replace(/^KernelWorkerStatus\./i, '') || quoted || null,
    missing: false,
    output: result.stdout.trim().slice(0, 400),
  }
}

/**
 * 删除一个 Kernel（`kaggle kernels delete -y`）。
 *
 * 用途：放弃一条卡住的排队时清掉旧 Kernel，避免它之后被调度到时空转烧 GPU 配额。
 * 已删除 / 不存在按成功处理（`missing: true`）：调用方只关心「现在没有这个 Kernel」。
 *
 * @param {object} ctx
 * @param {string} kernelId `owner/slug`
 * @returns {Promise<{ ok: boolean, missing: boolean, output: string }>}
 */
export async function deleteKernel(ctx, kernelId) {
  const result = await runCli(ctx, ['kaggle', 'kernels', 'delete', '-y', kernelId], TIMEOUTS.cliMs)
  const text = `${result.stdout}\n${result.stderr}`.trim()
  const missing = looksMissingKernel(text)
  return {
    ok: result.code === 0 || missing,
    missing,
    output: (missing ? 'Kernel 已不存在' : text).slice(0, 400),
  }
}

/** 拉取 kernel 日志尾部，便于失败时给出可读原因。 */
export async function kernelLogs(ctx, kernelId) {
  const result = await runCli(ctx, ['kaggle', 'kernels', 'logs', kernelId], TIMEOUTS.cliLogsMs)
  const text = result.stdout || result.stderr || ''
  return { ok: result.code === 0, tail: simplifyKernelLog(text).slice(-2000) }
}

/**
 * 下载 kernel 运行产物到指定目录（模型验证脚本用）。
 * `-o` 覆盖已有文件：验证产物同名，重复跑不会被旧文件卡住。
 */
export async function downloadKernelOutput(ctx, kernelId, destination, timeoutMs = TIMEOUTS.cliOutputMs) {
  const result = await runCli(
    ctx,
    ['kaggle', 'kernels', 'output', kernelId, '-p', destination, '-o'],
    timeoutMs,
  )
  const text = (result.stdout || result.stderr || '').trim()
  return { ok: result.code === 0, output: text.slice(0, 800), failure: result.failure }
}
