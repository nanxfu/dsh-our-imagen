/**
 * kaggle CLI 探测与调用工具。
 *
 * 关键运行约束（详见 docs/MODELS_AND_BENCHMARKS.md）：
 *  - 不使用 `kaggle auth login` 的本地回显判断登录态（仅为本地记录，不代表 API 连通）；
 *  - 不以 `kaggle quota` 失败阻断使用（配额查询可能因权限受限，只作为展示项）；
 *  - kernels.* 接口偶发鉴权抖动，内部内置退避重试；
 *  - 实际鉴权有效性以真实 API 调用成败为准。
 */

const CLI_TIMEOUT_MS = 20000
const AUTH_RETRY_DELAYS_MS = [0, 400, 1200]

function originOf(ctx) {
  try {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory?.defaultDirectory) return workingDirectory.defaultDirectory
  } catch {}
  return process.cwd()
}

async function runCli(ctx, argv, timeoutMs = CLI_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const exe = await ctx.subprocess.resolveExecutable(argv[0])
    const handle = ctx.subprocess.spawn({
      argv: [exe, ...argv.slice(1)],
      cwd: originOf(ctx),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 2000,
      signal: controller.signal,
    })
    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      if (controller.signal.aborted) return { code: -1, stdout: '', stderr: `timeout after ${timeoutMs}ms` }
      return { code: -1, stdout: '', stderr: String(error?.message ?? error) }
    }
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return { code: outcome?.exitCode ?? -1, stdout, stderr }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function probeKaggle(ctx) {
  const notes = []
  const cli = { present: true }

  const version = await runCli(ctx, ['kaggle', '--version'], 10000)
  if (version.code !== 0 && !/kaggle/i.test(version.stdout)) {
    return {
      provider: 'kaggle',
      cli: { present: false, error: (version.stderr || version.stdout).trim().slice(0, 300) },
      auth: { ok: false, checkedAt: new Date().toISOString(), errorCode: 'cli_missing' },
      notes: ['未找到 kaggle CLI，请先安装：pip install -U kaggle'],
    }
  }
  cli.version = (version.stdout || version.stderr).trim().replace(/^kaggle\s*/i, '')
  notes.push(`kaggle CLI ${cli.version}`)

  let auth = { ok: false, checkedAt: new Date().toISOString() }
  for (const delay of AUTH_RETRY_DELAYS_MS) {
    if (delay) await sleep(delay)
    const result = await runCli(ctx, ['kaggle', 'kernels', 'list', '--page-size', '1'])
    if (result.code === 0) {
      auth = { ok: true, checkedAt: new Date().toISOString() }
      break
    }
    if (looksUnauthenticated(result)) {
      auth = {
        ok: false,
        checkedAt: new Date().toISOString(),
        errorCode: 'auth_required',
        detail: (result.stderr || result.stdout).trim().slice(0, 300),
      }
    } else {
      auth = {
        ok: false,
        checkedAt: new Date().toISOString(),
        errorCode: 'unknown',
        detail: (result.stderr || result.stdout).trim().slice(0, 300),
      }
    }
  }
  notes.push(auth.ok ? '账号接入正常' : `账号接入失败：${auth.errorCode}`)

  const quotaResult = await runCli(ctx, ['kaggle', 'quota'], 15000)
  const quota = quotaResult.code === 0 ? parseQuota(quotaResult.stdout || quotaResult.stderr) : { available: false, raw: '' }
  if (!quota.available) notes.push('配额接口不可用，该项降级显示')

  return { provider: 'kaggle', cli, auth, quota, notes }
}
