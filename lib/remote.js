/**
 * 远端 Daemon 的 HTTP 客户端（协议见 remote/daemon.py 顶部说明）。
 *
 * 所有请求都带 Bearer Token；连接目标是 Cloudflare 临时域名，
 * 因此这里不使用 keep-alive 复用，避免隧道重建后连接指向失效节点。
 *
 * 通道：统一走 lib/net.js（fetch 失败自动降级本机 curl），
 * 否则 DSH 进程内的 fetch 不读系统代理时，代理用户会出现
 * 「会合成功但握手/出图必然失败」。ctx 作为可选尾参数传入；
 * 真机脚本沿用旧签名（不传 ctx）时只走 fetch，行为不变。
 */

import { TIMEOUTS } from '../shared/contract.js'
import { createLogger } from './log.js'
import { httpText } from './net.js'

const log = createLogger({ scope: 'remote' })

/**
 * 单次轮询失败后的退避时长：首次沿用 pollMs，之后指数增长到 backoffMaxMs 封顶。
 * 隧道重建期间连续失败会持续几十秒到几分钟，固定 2 秒节奏只会把失败次数刷得很快；
 * 退避能在不放弃任务的前提下降低无效请求量。
 */
function pollBackoffMs(pollMs, failures, backoffMaxMs) {
  if (failures <= 0) return pollMs
  const base = pollMs * 2 ** Math.min(failures - 1, 5)
  return Math.min(Math.max(pollMs, base), Math.max(pollMs, backoffMaxMs))
}

/** 把重投回调的返回值归一成 job id：允许返回字符串或远端提交响应。 */
function resumedJobId(value) {
  const jobId = typeof value === 'string' ? value : value?.job_id
  return typeof jobId === 'string' && jobId ? jobId : null
}

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  }
}

function isLoopback(url) {
  try {
    const { hostname } = new URL(url)
    // IPv6 主机名在 WHATWG URL 里带方括号（[::1]），两种写法都认。
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
    // 127.0.0.0/8 全部是回环地址。
    return /^127\./.test(hostname)
  } catch (error) {
    log.debug('endpoint 不是合法 URL', error?.message ?? error)
    return false
  }
}

/** 可信域配置项归一化：去空白、大小写不敏感，允许前导点与 `*.` 前缀。 */
function normalizeTrustedDomain(value) {
  if (typeof value !== 'string') return null
  let domain = value.trim().toLowerCase()
  if (!domain) return null
  if (domain.startsWith('*.')) domain = domain.slice(2)
  while (domain.startsWith('.')) domain = domain.slice(1)
  if (!domain || /[/\s:]/.test(domain)) return null
  return domain
}

/** hostname 是否等于某个可信域，或是它的子域。 */
function matchesTrustedDomain(hostname, trustedDomains) {
  if (!Array.isArray(trustedDomains) || trustedDomains.length === 0) return false
  for (const item of trustedDomains) {
    const domain = normalizeTrustedDomain(item)
    if (!domain) continue
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true
  }
  return false
}

/**
 * 隧道地址是否可信。
 *
 * 回环地址（本地联调）与 https 的 *.trycloudflare.com 始终可信；备用隧道（自建 FRP 等）
 * 通过 `trustedDomains` 配置的域名后缀放行，规则：仅 https，hostname 精确等于该域名
 * 或以 `.域名` 结尾；配置项大小写不敏感，允许前导点与 `*.` 前缀。
 * 不可信地址不放行，避免把 Bearer Token 发给会合消息里出现的任意主机。
 */
export function isTrustedEndpoint(url, trustedDomains = []) {
  if (typeof url !== 'string' || url.length === 0) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (isLoopback(url)) return true
    if (parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname.toLowerCase()
    if (hostname.endsWith('.trycloudflare.com')) return true
    return matchesTrustedDomain(hostname, trustedDomains)
  } catch (error) {
    log.debug('隧道地址解析失败，按不可信处理', error?.message ?? error)
    return false
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch (error) {
    // health / logs 的响应体不是 JSON 说明 daemon 协议已偏离，值得 warn。
    log.warn('远端响应不是合法 JSON', error?.message ?? error)
    return null
  }
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [timeoutMs]
 * @param {object} [ctx] DSH 宿主 ctx；缺省时只走 fetch（兼容真机脚本旧签名）
 */
export async function fetchHealth(endpoint, token, timeoutMs = TIMEOUTS.remoteHealthMs, ctx = null) {
  const result = await httpText(ctx, new URL('/health', endpoint), {
    timeoutMs,
    headers: authHeaders(token),
  })
  if (!result.ok) throw new Error(`health ${result.status ?? 'request failed'}`)
  const payload = parseJson(result.text)
  if (!payload || typeof payload !== 'object') throw new Error('health 返回了非 JSON 响应')
  return payload
}

/** 把远端错误响应折成带 code 的 Error（/generate、/job 共用）。 */
function remoteFailure(result, payload) {
  const remoteError = payload?.error
  const error = new Error(remoteError?.message ?? `远端返回 ${result.status ?? '请求失败'}`)
  error.code = remoteError?.code
  error.status = result.status
  return error
}

/**
 * 提交生成任务：远端只做校验与入队，立即返回 job_id（不再同步等待整段采样）。
 *
 * 请求体除了旧的 pipeline/tasks，可带 `jobId` 作为幂等键：同 id 重复提交时远端
 * 返回同一个 job_id、不重复入队，Host 重试不会产出重复图片。
 *
 * @returns {Promise<{status: string, job_id: string, model_id?: string, created_at?: string}>}
 */
export async function submitGenerate(endpoint, token, body, timeoutMs = TIMEOUTS.remoteSubmitMs, ctx = null) {
  const result = await httpText(ctx, new URL('/generate', endpoint), {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs,
    maxBytes: TIMEOUTS.bodyMaxBytes,
  })
  const payload = parseJson(result.text)
  if (!result.ok) throw remoteFailure(result, payload)
  if (!payload || typeof payload !== 'object') throw new Error('远端返回了非 JSON 响应')
  if (typeof payload.job_id !== 'string' || !payload.job_id) throw new Error('远端没有返回 job_id')
  return payload
}

/**
 * 查询单个任务状态。
 *
 * @returns {Promise<{status: string, job_id: string, progress?: object, results?: object[], error?: object}>}
 */
export async function fetchJob(endpoint, token, jobId, timeoutMs = TIMEOUTS.remoteJobRequestMs, ctx = null) {
  const result = await httpText(ctx, new URL(`/job?id=${encodeURIComponent(jobId)}`, endpoint), {
    headers: authHeaders(token),
    timeoutMs,
    // 任务完成时 results 里带 base64 PNG，与旧 /generate 的响应体同量级。
    maxBytes: TIMEOUTS.remoteGenerateMaxBytes,
  })
  const payload = parseJson(result.text)
  if (!result.ok) throw remoteFailure(result, payload)
  if (!payload || typeof payload !== 'object') throw new Error('远端返回了非 JSON 响应')
  return payload
}

/**
 * 轮询任务直到结束。
 *
 * 隧道抖动 / 代理重连期间单次 `GET /job` 失败不算任务失败：连续失败只要还落在
 * `failureGraceMs`（默认 120 秒）内就继续退避重试。容忍窗口用尽后，如果调用方给了
 * `resubmit`，就用同一 `jobId` 做一次幂等重投——daemon 的 `submit_job` 命中幂等键会
 * 返回原 job（仍在算就继续轮询，不重复入队）；重投次数用尽或调用方不给重投能力时，
 * 才把连续失败折叠成 `generate_failed`。
 *
 * 404 `unknown_job` 仍是立即终态：daemon 明确回答「任务不存在」时重试/重投都没有意义
 * （重投会重新出图，见 `remoteJobResumeMaxAttempts` 的约束）。
 *
 * 所有等待都受 `timeoutMs`（默认 `remoteJobMs`）整体预算约束，不会突破单任务预算。
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs] 整体预算
 * @param {number} [options.pollMs] 轮询间隔（失败后按退避放大）
 * @param {number} [options.requestMs] 单次请求超时
 * @param {number} [options.failureGraceMs] 连续失败容忍窗口
 * @param {number} [options.backoffMaxMs] 失败退避上限
 * @param {number} [options.resumeMaxAttempts] 幂等重投次数上限
 * @param {object} [options.ctx] DSH 宿主 ctx（走 curl 兜底）
 * @param {(snapshot: object) => void} [options.onProgress] 每次拿到新状态时回调
 * @param {(jobId: string) => Promise<string|object>} [options.resubmit]
 *   连续失败超过容忍窗口时调用；调用方用同一 jobId 幂等重投，返回 job id 或提交响应。
 */
export async function waitForJob(endpoint, token, jobId, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || TIMEOUTS.remoteJobMs
  const pollMs = Number(options.pollMs) || TIMEOUTS.remoteJobPollMs
  const requestMs = Number(options.requestMs) || TIMEOUTS.remoteJobRequestMs
  const ctx = options.ctx ?? null
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  const resubmit = typeof options.resubmit === 'function' ? options.resubmit : null
  const failureGraceMs = Number.isFinite(Number(options.failureGraceMs))
    ? Math.max(0, Number(options.failureGraceMs))
    : TIMEOUTS.remoteJobPollFailureGraceMs
  const backoffMaxMs = Number.isFinite(Number(options.backoffMaxMs))
    ? Math.max(pollMs, Number(options.backoffMaxMs))
    : TIMEOUTS.remoteJobPollBackoffMaxMs
  const resumeMaxAttempts = Number.isFinite(Number(options.resumeMaxAttempts))
    ? Math.max(0, Math.round(Number(options.resumeMaxAttempts)))
    : TIMEOUTS.remoteJobResumeMaxAttempts
  const deadline = Date.now() + timeoutMs
  let currentJobId = jobId
  let failures = 0
  let failureStartedAt = 0
  let resumes = 0
  let last = null

  while (true) {
    let delay = pollMs
    try {
      last = await fetchJob(endpoint, token, currentJobId, requestMs, ctx)
      failures = 0
      failureStartedAt = 0
    } catch (error) {
      // 404 unknown_job 是终态错误（任务不存在或已被淘汰），重试没有意义。
      if (error?.status === 404) throw error
      failures += 1
      if (failureStartedAt === 0) failureStartedAt = Date.now()
      last = null
      delay = pollBackoffMs(pollMs, failures, backoffMaxMs)

      const failedForMs = Date.now() - failureStartedAt
      const canResume = Boolean(resubmit) && resumes < resumeMaxAttempts
      if (failedForMs <= failureGraceMs) {
        // 容忍窗口内：隧道可能正在重建，退避后继续查同一个 job。
      } else if (canResume) {
        resumes += 1
        log.warn(
          `job_resume attempt=${resumes}/${resumeMaxAttempts} jobId=${currentJobId} ` +
            `failedForMs=${failedForMs} errorType=${error?.name ?? 'Error'}，用同一 jobId 幂等重投接回任务`,
        )
        try {
          const resumed = resumedJobId(await resubmit(currentJobId))
          if (!resumed) throw new Error('重投没有返回 job_id')
          currentJobId = resumed
          failures = 0
          failureStartedAt = 0
          delay = pollMs
        } catch (resumeError) {
          // 隧道可能还没恢复：重投失败保留失败链继续退避，由预算与重投次数共同兜底。
          log.debug(
            `job_resume_failed attempt=${resumes} errorType=${resumeError?.name ?? 'Error'}，继续退避重试`,
          )
          delay = pollBackoffMs(pollMs, failures, backoffMaxMs)
        }
      } else {
        const wrapped = new Error(
          `轮询任务状态连续失败 ${Math.round(failedForMs / 1000)} 秒` +
            `${resumes > 0 ? `（已幂等重投 ${resumes} 次）` : ''}：${error?.message ?? error}`,
        )
        wrapped.code = 'generate_failed'
        wrapped.cause = error
        throw wrapped
      }
    }

    if (last) {
      if (onProgress) onProgress(last)
      if (last.status === 'done') {
        const results = Array.isArray(last.results) ? last.results : []
        if (results.length === 0) {
          throw Object.assign(new Error('远端没有返回图片'), { code: 'empty_result' })
        }
        return {
          status: 'ok',
          model_id: last.model_id,
          load_seconds: last.load_seconds,
          results,
        }
      }
      if (last.status === 'failed') {
        const message = last.error?.message ?? '远端生成失败'
        throw Object.assign(new Error(message), { code: last.error?.code ?? 'generation_failed' })
      }
    }

    if (Date.now() + delay > deadline) {
      throw Object.assign(new Error(`等待远端生成超时（${Math.round(timeoutMs / 1000)} 秒）`), {
        code: 'generate_failed',
      })
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, delay))
  }
}

/**
 * 提交并等待任务完成（旧 `requestGenerate` 的语义，供真机探针脚本使用）。
 *
 * @param {object} [options] 见 waitForJob
 */
export async function requestGenerate(endpoint, token, body, options = {}) {
  const ctx = options.ctx ?? null
  const submitted = await submitGenerate(endpoint, token, body, options.submitMs ?? TIMEOUTS.remoteSubmitMs, ctx)
  return waitForJob(endpoint, token, submitted.job_id, { ...options, ctx })
}

/**
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [timeoutMs]
 * @param {object} [ctx]
 */
export async function requestShutdown(endpoint, token, timeoutMs = TIMEOUTS.remoteShutdownMs, ctx = null) {
  try {
    await httpText(ctx, new URL('/shutdown', endpoint), {
      method: 'POST',
      headers: authHeaders(token),
      timeoutMs,
    })
    return true
  } catch (error) {
    // best-effort：关机通知失败不改变本地状态机，只留排障线索。
    log.debug('关机通知失败（忽略）', error?.message ?? error)
    return false
  }
}

/**
 * 日志抽屉：从 daemon 拉增量日志（since = 上次游标）。
 * reserved: ROADMAP 日志抽屉接入后启用（当前无调用方，保留协议实现）。
 * @param {string} endpoint
 * @param {string} token
 * @param {number} [since]
 * @param {number} [timeoutMs]
 * @param {object} [ctx]
 */
export async function requestLogs(endpoint, token, since = 0, timeoutMs = TIMEOUTS.remoteHealthMs, ctx = null) {
  const result = await httpText(ctx, new URL(`/logs?since=${encodeURIComponent(since)}`, endpoint), {
    timeoutMs,
    headers: authHeaders(token),
  })
  if (!result.ok) throw new Error(`logs ${result.status ?? 'request failed'}`)
  const payload = parseJson(result.text)
  if (!payload || typeof payload !== 'object') throw new Error('logs 返回了非 JSON 响应')
  return payload
}
