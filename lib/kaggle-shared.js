/**
 * Kaggle CLI（`lib/kaggle.js`）与直连 API（`lib/kaggle-direct.js`）共享的纯逻辑与策略常量：
 * 鉴权探测退避、10 分钟用户名缓存、Kernel 日志噪音清洗，以及探测结果/提示文本拼装。
 */

/** 鉴权探测重试退避（kernels.* 接口偶发抖动时短退避重试）。 */
export const AUTH_RETRY_DELAYS_MS = [0, 400, 1200]

/** 用户名缓存时长（10 分钟，CLI 与直连模式保持一致）。 */
export const USERNAME_CACHE_MS = 10 * 60 * 1000

/** Kaggle kernel 日志中的 notebook 转换噪音过滤正则。 */
export const LOG_NOISE = /NbConvertApp|SyntaxWarning|Converting notebook|Writing \d+ bytes|nbconvert|deprecat/i

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 按退避序列执行探测尝试，直到 `attemptFn()` 返回 `{ done: true, value }` 或耗尽次数。
 *
 * @template T
 * @param {() => Promise<{ done: boolean, value: T }>} attemptFn
 * @param {number[]} [delays]
 * @returns {Promise<T>}
 */
export async function runAuthRetry(attemptFn, delays = AUTH_RETRY_DELAYS_MS) {
  let lastValue
  for (const delay of delays) {
    if (delay) await sleep(delay)
    const outcome = await attemptFn()
    lastValue = outcome.value
    if (outcome.done) return lastValue
  }
  return lastValue
}

/**
 * 生成带 TTL 与作用域键的用户名缓存（直连模式按 credentials 路径分桶，避免测试注入串号）。
 *
 * @param {number} [ttlMs]
 */
export function createUsernameCache(ttlMs = USERNAME_CACHE_MS) {
  let entry = { key: null, value: null, at: 0 }
  return {
    get(key = null) {
      if (entry.value && entry.key === key && Date.now() - entry.at < ttlMs) {
        return entry.value
      }
      return null
    },
    set(value, key = null) {
      entry = { key, value, at: Date.now() }
      return value
    },
  }
}

/**
 * 清洗 kernel 日志：兼容 JSON 事件流（旧格式）与纯文本（ListKernelSessionOutput.log），
 * 丢掉 notebook 转换噪音，只留最后 40 行。
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function simplifyKernelLog(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  const chunks = []
  let parsed = false
  for (const line of lines) {
    const cleaned = line.trim().replace(/^,?\[?/, '').replace(/\]$/, '')
    if (!cleaned) continue
    try {
      const entry = JSON.parse(cleaned)
      if (entry && typeof entry.data === 'string') {
        chunks.push(entry.data)
        parsed = true
        continue
      }
    } catch {}
    chunks.push(`${line}\n`)
  }
  const text = parsed ? chunks.join('') : String(raw ?? '')
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !LOG_NOISE.test(line))
    .slice(-40)
    .join('\n')
}

/**
 * 按统一口径拼装 `probeKaggle` 最终返回（notes 顺序、凭据提示与可选 username）。
 *
 * @param {{ cli: object, auth: object, quota: object, username?: string | null,
 *           prefixNotes?: string[], authCredentialNote?: string }} params
 */
export function finalizeProbeResult({ cli, auth, quota, username = null, prefixNotes = [], authCredentialNote = '' }) {
  const notes = [...prefixNotes]
  notes.push(auth.ok ? '账号接入正常' : `账号接入失败：${auth.errorCode}`)
  // 凭据缺失/失效是最容易沉默流失的卡点：把凭据文件位置与获取入口写进 notes，
  // 指引卡会把它作为详情展示（notes 里不放任何 token 值）。
  if (!auth.ok && auth.errorCode === 'auth_required' && authCredentialNote) {
    notes.push(authCredentialNote)
  }
  if (!quota.available) notes.push('配额接口不可用，该项降级显示')
  const nextCli = username ? { ...cli, username } : { ...cli }
  return { provider: 'kaggle', cli: nextCli, auth, quota, notes }
}
