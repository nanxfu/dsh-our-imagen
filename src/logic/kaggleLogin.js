/**
 * Kaggle 直连登录（试验特性）的纯逻辑。
 *
 * 覆盖面：
 *  - 登录接口响应 `{ ok: true, login }` → 内部视图的归一化（字段类型、取值域、URL）；
 *  - 状态判断：是否需要继续轮询、能否发起登录、是否已到契约超时；
 *  - manual 模式下用户粘贴的授权码清洗与校验（返回字典键，不拼文案）；
 *  - 失败原因（宿主给的 message）到字典键的映射。
 *
 * 不依赖 React / DOM，check-client-logic 可直接断言。视图字段与取值域全部来自
 * shared/contract.js 的 KAGGLE_LOGIN，这里不重复定义。
 */

import { KAGGLE_LOGIN } from '../../shared/contract.js'

/** 契约取值域与时间口径的本地别名（避免调用方到处写 KAGGLE_LOGIN.xxx）。 */
export const LOGIN_ACTIONS = KAGGLE_LOGIN.actions
export const LOGIN_STATES = KAGGLE_LOGIN.states
export const LOGIN_MODES = KAGGLE_LOGIN.modes
export const LOGIN_POLL_MS = KAGGLE_LOGIN.pollMs
export const LOGIN_TIMEOUT_MS = KAGGLE_LOGIN.timeoutMs

/** 授权码长度边界：过短基本是误粘贴，过长多半把整段授权链接也贴了进来。 */
export const LOGIN_CODE_MIN_CHARS = 8
export const LOGIN_CODE_MAX_CHARS = 4096
/** 授权码只允许可见 ASCII：内部空白、引号、`code=` 前缀在清洗阶段去掉。 */
const LOGIN_CODE_PATTERN = /^[A-Za-z0-9._~+/=-]+$/

function trimmedOrNull(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

/** 空登录态：与契约 LoginView 同形状，state 为 idle。 */
export function emptyLoginView() {
  return {
    state: 'idle',
    mode: 'browser',
    url: null,
    message: null,
    username: null,
    startedAt: null,
    finishedAt: null,
  }
}

/**
 * 归一化一个 LoginView。
 *
 * 未知 state 按 idle、未知 mode 按 browser、非 http(s) 链接置空；
 * 时间戳只保留非空字符串（展示层不解析宿主时钟）。任何形状都不抛异常，
 * 旧宿主缺字段时也能得到可渲染的视图。
 */
export function normalizeLoginView(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const state = LOGIN_STATES.includes(source.state) ? source.state : 'idle'
  const mode = LOGIN_MODES.includes(source.mode) ? source.mode : 'browser'
  const rawUrl = trimmedOrNull(source.url)
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null
  return {
    state,
    mode,
    url,
    message: trimmedOrNull(source.message),
    username: trimmedOrNull(source.username),
    startedAt: trimmedOrNull(source.startedAt),
    finishedAt: trimmedOrNull(source.finishedAt),
  }
}

/**
 * 登录接口响应 → 归一化视图。
 *
 * 契约形状是 `{ ok: true, data: { ok: true, login } }`（request() 的 envelope）；
 * 形状不对返回 null，由调用方按「接口不可用 / 一次提示」处理，绝不猜测登录结果。
 */
export function loginViewOf(result) {
  if (!result || result.ok !== true) return null
  const data = result.data && typeof result.data === 'object' ? result.data : null
  if (!data || data.ok !== true) return null
  const view = data.login
  if (!view || typeof view !== 'object' || Array.isArray(view)) return null
  return normalizeLoginView(view)
}

/** 登录是否在进行中（等待浏览器授权 / 等待授权码兑换）。 */
export function isLoginPending(view) {
  return Boolean(view) && view.state === 'pending'
}

/** 登录是否已到终态（成功 / 失败 / 取消）。 */
export function loginIsTerminal(view) {
  return Boolean(view) && ['done', 'failed', 'cancelled'].includes(view.state)
}

/**
 * 能否发起一次新的登录：只有 idle / failed / cancelled 可以；
 * pending 表示上一轮还没结束，重复发起会被宿主拒绝。
 */
export function loginCanStart(view) {
  if (!view || typeof view !== 'object') return true
  return !isLoginPending(view) && !(view.state === 'done')
}

/** 本次登录的本地起点是否已经超过契约超时；输入非法时按未超时处理。 */
export function loginTimedOut(startedAtMs, nowMs) {
  const start = Number(startedAtMs)
  const now = Number(nowMs)
  if (!Number.isFinite(start) || !Number.isFinite(now)) return false
  return now - start >= LOGIN_TIMEOUT_MS
}

/**
 * 轮询是否应该继续：只有 pending 且未超时才继续。
 * 宿主侧也有同样的 timeoutMs 兜底，这里是客户端侧的最后一层保护。
 */
export function shouldPollLogin(view, startedAtMs, nowMs) {
  if (!isLoginPending(view)) return false
  return !loginTimedOut(startedAtMs, nowMs)
}

/** 登录成功后写入的凭据位置是否在视图里体现（展示用，不做判定）。 */
export function loginUsernameOf(view) {
  return view && typeof view.username === 'string' && view.username.trim() ? view.username.trim() : ''
}

/**
 * 清洗 manual 模式粘贴的授权码。
 *
 * 常见误粘贴：首尾空白、换行、包裹的引号 / 尖括号、`code=` 前缀，或整条回跳 URL
 * （如 Colab 浏览器跳到 `http://localhost:8765/?state=...&code=...` 后直接整段复制）。
 */
export function cleanLoginCode(raw) {
  let text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return ''
  const urlMatch = text.match(/(?:^|[?&])code=([^&\s#]+)/i)
  if (urlMatch) {
    text = urlMatch[1]
    if (text.includes('%')) {
      try {
        text = decodeURIComponent(text)
      } catch {}
    }
  }
  text = text.replace(/^code\s*=\s*/i, '').trim()
  const quoted = text.match(/^["'`<]([\s\S]+)[>"'`]$/)
  if (quoted) text = quoted[1]
  return text.replace(/\s+/g, '')
}

/**
 * 校验授权码：返回 `{ ok, code, message }`。
 * message 是字典键（空串表示通过），由 GuidanceCard 翻译成文案。
 */
export function validateLoginCode(raw) {
  const code = cleanLoginCode(raw)
  if (!code) return { ok: false, code: '', message: 'studio.guidance.auth.codeEmpty' }
  if (code.length < LOGIN_CODE_MIN_CHARS) {
    return { ok: false, code, message: 'studio.guidance.auth.codeTooShort' }
  }
  if (code.length > LOGIN_CODE_MAX_CHARS) {
    return { ok: false, code, message: 'studio.guidance.auth.codeTooLong' }
  }
  if (!LOGIN_CODE_PATTERN.test(code)) {
    return { ok: false, code, message: 'studio.guidance.auth.codeFormat' }
  }
  return { ok: true, code, message: '' }
}

/** 提交按钮是否可用（只做本地校验，真正成败由宿主返回）。 */
export function loginCodeCanSubmit(raw) {
  return validateLoginCode(raw).ok
}

/**
 * 失败原因关键词 → 字典键。
 *
 * 宿主的 message 是自由文本（可能来自 kagglesdk 的异常），客户端不做协议级解析，
 * 只按关键词归类成可读的一句话；识别不出来就回落到「登录没有完成」。
 */
const FAILURE_RULES = [
  { pattern: /timeout|timed?\s*out|超时/i, key: 'studio.guidance.auth.reason.timeout' },
  { pattern: /\bstate\b|csrf|校验/i, key: 'studio.guidance.auth.reason.state' },
  { pattern: /browser|launch|open|浏览器/i, key: 'studio.guidance.auth.reason.browser' },
  { pattern: /exchange|token|credential|凭据/i, key: 'studio.guidance.auth.reason.exchange' },
  { pattern: /network|fetch|connect|ECONN|socket|网络|连接/i, key: 'studio.guidance.auth.reason.network' },
]

/** 失败原因字典键；非 failed 状态返回空串（不展示失败说明）。 */
export function loginFailureKey(view) {
  if (!view || view.state !== 'failed') return ''
  const message = typeof view.message === 'string' ? view.message : ''
  for (const rule of FAILURE_RULES) {
    if (rule.pattern.test(message)) return rule.key
  }
  return 'studio.guidance.auth.reason.unknown'
}

/** 登录动作名 → POST body；非法动作返回 null（调用方不发请求）。 */
export function loginActionBody(action, code) {
  if (!LOGIN_ACTIONS.includes(action)) return null
  if (action === 'submit-code') {
    const cleaned = cleanLoginCode(code)
    return cleaned ? { action, code: cleaned } : { action }
  }
  return { action }
}
