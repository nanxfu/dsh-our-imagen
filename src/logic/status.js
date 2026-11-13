/**
 * 会话状态、阶段、任务状态与云端展示状态的文案查询。
 *
 * 界面上的云端状态只从这里派生：顶栏胶囊、状态条、弹层、对话页徽章共用
 * `computeStatusOf` / `jobProgressText`，避免同一个阶段出现两种说法。
 */

import { PHASE_STATE, TRANSIENT_SESSION } from '../constants.js'
import { localized } from '../i18n.js'
import { formatText } from './format.js'

export function sessionStateText(t, state) {
  const key = state ? `session.state.${state}` : 'session.state.absent'
  return localized(t, key) || (state ? String(state) : t('value.unknown'))
}

export function jobStatusText(t, status) {
  if (!status) return ''
  return localized(t, `job.status.${status}`) || String(status)
}

export function phaseText(t, phase) {
  if (!phase) return ''
  return localized(t, `session.phase.${phase}`) || ''
}

/** 错误态里的「会话已结束」= 云端自己休眠/退出，不是连接故障，不该按红色异常展示。 */
function isAsleepSession(session) {
  return Boolean(
    session
    && session.state === 'error'
    && session.error
    && session.error.code === 'session_ended',
  )
}

/**
 * 把当前阶段翻译成"正在做什么、还要等多久"的一句话提示。
 * 没有对应文案时返回空串，由调用方回落到远端 detail / 错误说明。
 */
export function phaseHint(t, session) {
  if (!session) return ''
  const state = typeof session.state === 'string' ? session.state : ''
  const phase = typeof session.phase === 'string' ? session.phase : ''
  // 老快照可能没有 state，只有 phase：按 phase 回落到所属会话态。
  const resolved = state || PHASE_STATE[phase] || ''
  if (resolved === 'provisioning') {
    const key = phase === 'push'
      ? 'session.hint.push'
      : phase === 'queue'
        ? 'session.hint.queue'
        : 'session.hint.provisioning'
    return localized(t, key) || ''
  }
  if (isAsleepSession(session)) return localized(t, 'session.hint.asleep') || ''
  return resolved ? localized(t, `session.hint.${resolved}`) || '' : ''
}

/** 语义色调，与 CSS 的 .is-ok / .is-warn / .is-error / .is-idle 一一对应。 */
function toneOf(state, asleep) {
  if (asleep) return 'idle'
  if (state === 'ready') return 'ok'
  if (state === 'error') return 'error'
  if (TRANSIENT_SESSION[state] === true) return 'warn'
  return 'idle'
}

/** 错误态按错误码给短标签：比统一的「云端异常」更容易定位，长原因仍交给指引卡。 */
const ERROR_LABEL_KEY = {
  auth_required: 'session.state.errorAuth',
  cli_missing: 'session.state.errorCli',
  push_failed: 'session.state.errorPush',
  queue_timeout: 'session.state.errorTimeout',
  tunnel_timeout: 'session.state.errorTimeout',
  session_timeout: 'session.state.errorTimeout',
}

/** 胶囊短标签的文案键：申请 GPU 阶段再按 phase 细分推送与排队。 */
function labelKeyOf(state, phase, session, asleep) {
  if (asleep) return 'session.state.asleep'
  // 用户主动关机后会话停在 absent；和「从未启动」分开说，避免误导成可自动启动。
  if (state === 'absent' && session && session.stoppedByUser === true) return 'session.state.asleep'
  if (state === 'provisioning') {
    if (phase === 'push') return 'session.state.push'
    if (phase === 'queue') return 'session.state.queue'
  }
  if (state === 'error') {
    const code = session && session.error && session.error.code
    return ERROR_LABEL_KEY[code] || 'session.state.error'
  }
  return `session.state.${state}`
}

/**
 * 云端展示状态：胶囊标签、语义色调、阶段、等待提示与可执行动作。
 *
 * @param {(key: string) => string} t
 * @param {{ session?: object|null }} input 宿主快照里的会话（或 compute.session）
 */
export function computeStatusOf(t, input = {}) {
  const session = input && input.session ? input.session : null
  const state = session && typeof session.state === 'string' && session.state ? session.state : 'absent'
  const phase = session && typeof session.phase === 'string' ? session.phase : ''
  const asleep = isAsleepSession(session)
  const stopped = state === 'absent' && Boolean(session && session.stoppedByUser === true)
  // 休眠/结束统一用「已关闭」的标签与说明；其余状态与状态机一一对应。
  const label = localized(t, labelKeyOf(state, phase, session, asleep)) || sessionStateText(t, state)
  const hint = phaseHint(t, session) || (stopped ? localized(t, 'session.hint.asleep') : '')
  const errorMessage = session && session.error && typeof session.error.message === 'string'
    ? session.error.message.split('\n')[0].trim()
    : ''
  let tooltip = hint
  if (state === 'ready') tooltip = localized(t, 'studio.compute.idleTooltip') || hint
  else if (asleep || stopped) tooltip = localized(t, 'studio.compute.asleepTooltip') || hint
  else if (state === 'absent') tooltip = localized(t, 'studio.compute.offlineTooltip') || hint
  else if (state === 'error') tooltip = localized(t, 'studio.compute.errorTooltip') || errorMessage
  return {
    state,
    phase,
    asleep,
    stopped,
    tone: toneOf(state, asleep || stopped),
    label,
    hint,
    tooltip,
    phaseLabel: phaseText(t, phase),
    // 过渡态：需要持续刷新进度、显示状态条并计时的状态。
    transient: TRANSIENT_SESSION[state] === true,
    // 正在启动/等待云端（stopping 不计时）。
    starting: state === 'provisioning' || state === 'connecting' || state === 'warming',
    ready: state === 'ready',
    canStart: state === 'absent' || state === 'error',
    canStop: state !== 'absent',
  }
}

/**
 * 空闲关机倒计时：只从宿主快照里已经存在的两个字段派生。
 *
 * `session.idleSeconds` 来自远端 /health（仅在有 /health 的会话态才有值），
 * `session.idleTimeoutSec` 是当前生效的自动关机阈值。任一缺失、或空闲不足
 * 一分钟时不展示——宁可暂时不显示，也不给「已空闲 0 分钟」这种假读数。
 *
 * @param {object|null} session 宿主快照里的会话
 * @returns {{ idleSeconds: number, idleMinutes: number, totalMinutes: number } | null}
 */
export function idleShutdownOf(session) {
  if (!session || typeof session !== 'object') return null
  const idleSeconds = Number(session.idleSeconds)
  const timeoutSeconds = Number(session.idleTimeoutSec)
  if (!Number.isFinite(idleSeconds) || !Number.isFinite(timeoutSeconds)) return null
  if (idleSeconds <= 0 || timeoutSeconds <= 0) return null
  const idleMinutes = Math.floor(idleSeconds / 60)
  if (idleMinutes < 1) return null
  return {
    idleSeconds: Math.floor(idleSeconds),
    idleMinutes,
    totalMinutes: Math.max(1, Math.round(timeoutSeconds / 60)),
  }
}

/**
 * 宿主的结构化阶段码；缺字段时按 job.status 回落，兼容旧版本宿主。
 *
 * `cancelled` 是终态而非「正在做的事」：它只用于把任务收敛成「已取消」文案，
 * 取消中的 running 任务靠 `cancelRequested` 单独提示「正在停止…」。
 */
const STAGE_CODES = new Set(['queued', 'waiting-session', 'loading', 'running', 'done', 'failed', 'cancelled'])

function stageCodeOf(job) {
  // 任务一旦收敛为 cancelled，即便旧宿主残留 stageCode=running 也按终态展示。
  if (job.status === 'cancelled') return 'cancelled'
  const code = typeof job.stageCode === 'string' ? job.stageCode : ''
  if (STAGE_CODES.has(code)) return code
  // 旧宿主没有 stageCode：status 与阶段码同名，可直接回溯。
  return STAGE_CODES.has(job.status) ? job.status : ''
}

/**
 * 分张进度：宿主只给「已完成张数」，这里换算成「正在出第几张」并夹在 1..total。
 * 单张任务不显示计数（宿主同样只在 total > 1 时给阶段追加计数）。
 */
function progressOf(job) {
  const progress = job && job.progress
  if (!progress || typeof progress !== 'object') return null
  const done = Number(progress.done)
  const total = Number(progress.total)
  if (!Number.isFinite(done) || !Number.isFinite(total)) return null
  const count = Math.floor(total)
  if (count <= 1) return null
  return { done: Math.min(Math.max(0, Math.floor(done)) + 1, count), total: count }
}

/**
 * 活动任务的进度文案。
 *
 * 关键区分：「等在云端就绪」和「等前一张图画完」是两件事，不能都说成「正在申请 GPU」。
 * 阶段只认宿主下发的 stageCode：job.stage 是宿主硬编码的中文，英文界面不能直接展示。
 *
 * 取消语义：running 任务收到取消请求后不会再提交剩余张数，但当前这张仍要画完，
 * 因此先给「正在停止…」而不是直接说「已取消」；真正进入终态后才显示「已取消」。
 *
 * @param {(key: string) => string} t
 * @param {object|null} job 进行中的任务
 * @param {string} sessionState 当前会话状态
 */
export function jobProgressText(t, job, sessionState) {
  if (!job) return ''
  const stage = stageCodeOf(job)
  if (stage === 'cancelled') return jobStatusText(t, 'cancelled')
  if (job.cancelRequested === true) return localized(t, 'studio.job.cancelling') || ''
  if (stage === 'running') {
    const progress = progressOf(job)
    if (progress) {
      const text = formatText(localized(t, 'studio.progress.generatingCount'), progress)
      if (text) return text
    }
    return localized(t, 'studio.progress.running') || ''
  }
  if (stage === 'loading') {
    return localized(t, 'studio.progress.loading') || localized(t, 'studio.progress.waitingSession') || ''
  }
  if (stage === 'waiting-session') return localized(t, 'studio.progress.waitingSession') || ''
  if (stage === 'queued') {
    const key = sessionState === 'ready' ? 'studio.progress.queued' : 'studio.progress.waitingSession'
    return localized(t, key) || ''
  }
  return jobStatusText(t, job.status)
}

/**
 * 「已等待」时长：只在申请 GPU（push / queue）阶段计时。
 *
 * `startedAt` 是整段会话的起点；会话重连或从本地恢复后它不会重置，
 * 若拿去算 connecting / warming 的等待时长，会显示成小时级的会话运行时长。
 * 申请 GPU 阶段不会中途重连，用它可以得到可信的排队耗时。
 */
export function sessionElapsedMs(session, now) {
  if (!session || session.state !== 'provisioning') return null
  const start = Date.parse(String(session.startedAt ?? ''))
  if (!Number.isFinite(start)) return null
  const current = Number.isFinite(now) ? now : Date.now()
  return Math.max(0, current - start)
}
