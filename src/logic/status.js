/**
 * 会话状态、阶段、任务状态与云端展示状态的文案查询。
 *
 * 界面上的云端状态只从这里派生：顶栏胶囊、状态条、弹层、对话页徽章共用
 * `computeStatusOf` / `jobProgressText`，避免同一个阶段出现两种说法。
 */

import { PHASE_STATE, TRANSIENT_SESSION } from '../constants.js'
import { localized } from '../i18n.js'

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
 * 活动任务的进度文案。
 *
 * 关键区分：「等在云端就绪」和「等前一张图画完」是两件事，不能都说成「正在申请 GPU」。
 *
 * @param {(key: string) => string} t
 * @param {object|null} job 进行中的任务
 * @param {string} sessionState 当前会话状态
 */
export function jobProgressText(t, job, sessionState) {
  if (!job) return ''
  if (job.status === 'waiting-session') return localized(t, 'studio.progress.waitingSession') || ''
  if (job.status === 'queued') {
    const key = sessionState === 'ready' ? 'studio.progress.queued' : 'studio.progress.waitingSession'
    return localized(t, key) || ''
  }
  if (job.status === 'running') return localized(t, 'studio.progress.running') || ''
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
