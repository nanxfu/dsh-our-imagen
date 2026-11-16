/**
 * 生图流水线：把会话阶段与任务阶段折算成一条固定五节点的展示序列。
 *
 * 纯计算模块（不依赖 React / DOM / 计时器），组件只负责画：
 *  1. 节点只映射宿主真实可观测的阶段（`session.phase` 的 push/queue/tunnel/warm 与
 *     `job.stageCode`），不造百分比、不编每阶段耗时——宿主没有这些数据（DESIGN.md 也禁止假百分比）；
 *  2. 会话已就绪时前四个节点折叠成一个「云端已就绪」起点，避免常见情况摆一排灰点；
 *  3. 出现有 1.5 秒阈值（极速预设出图快，不闪条）、完成保留约 1.2 秒、失败停在失败节点；
 *     这些规则都在这里，组合层只把快照和时间喂进来。
 */

import { TIMEOUTS } from '../../shared/contract.js'

import { PHASE_STATE, TRANSIENT_SESSION } from '../constants.js'
import { localized } from '../i18n.js'
import { formatText } from './format.js'
import { queueLevelOf, queuePolicyOf, queueWaitMsOf } from './queue.js'
import { jobCountOf } from './status.js'

/** 等待超过这么久才出现：1.9 秒的极速预设不闪条，冷启动、排队与多张生成必然会看到。 */
export const PIPELINE_APPEAR_MS = 1500

/** 完成态保留时长（从任务完成时刻算起）。 */
export const PIPELINE_DONE_HOLD_MS = 1200

/**
 * 完成后额外宽限一个活跃轮询周期：宿主 2 秒轮询一次，任务真正完成的时刻客户端最晚 2 秒后
 * 才知道；只按 1.2 秒判断会让完成态大概率闪不出来。可见时长因此是 1.2~3.2 秒。
 */
const DONE_HOLD_SLACK_MS = TIMEOUTS.clientStateActivePollMs

/** 会话段固定四节点，生成节点单列。 */
const SESSION_NODES = ['push', 'queue', 'tunnel', 'model']

/** 阶段 → 节点序号（push 0 / queue 1 / tunnel 2 / warm 3）。 */
const PHASE_NODE = { push: 0, queue: 1, tunnel: 2, warm: 3 }

/**
 * 会话错误码 → 卡住的节点序号。
 *
 * 失败时 `writeFailure` 会把 `phase` 清空，只能从错误码反推停在哪一段；
 * 认不出的错误码统一按最后一个会话阶段（准备模型）处理，具体原因交给上方的指引卡。
 */
const SESSION_ERROR_NODE = {
  // 环境前置（没装 CLI / 没登录）：推送都还没开始，红点落在第一段。
  auth_required: 0,
  cli_missing: 0,
  push_failed: 0,
  queue_timeout: 1,
  tunnel_timeout: 2,
  gpu_unavailable: 3,
  health_failed: 3,
  remote_error: 3,
  session_error: 3,
  session_timeout: 3,
}

/**
 * 不是「某个阶段失败」的会话错误：会话自然结束 / 已被释放。
 * 这类错误交给指引卡（重新唤醒），不该在流水线上冒充某一段失败。
 */
const NON_STAGE_ERROR_CODES = new Set(['session_ended', 'session_absent', 'disposed'])

/** 缺省节点序号：认不出的会话错误停在这里。 */
const FALLBACK_ERROR_NODE = 3

function isoMs(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** 分秒计时：流水线右端的「已等待 1:23」统一用这个口径（不随语言变化）。 */
export function clockOf(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value)) return '0:00'
  const total = Math.max(0, Math.floor(value / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function nodeLabelOf(t, key) {
  return localized(t, `studio.pipeline.node.${key}`) || key
}

/** 节点悬停说明：会话段复用会话提示文案，生成与就绪用流水线自己的。 */
function nodeHintOf(t, key) {
  if (key === 'push') return localized(t, 'session.hint.push')
  if (key === 'queue') return localized(t, 'session.hint.queue')
  if (key === 'tunnel') return localized(t, 'session.hint.connecting')
  if (key === 'model') return localized(t, 'session.hint.warming')
  return localized(t, `studio.pipeline.hint.${key}`)
}

/**
 * 会话段进度：已完成节点数、当前节点、失败节点。
 *
 * `active = -1` 表示没有正在进行的会话节点（就绪、未启动或任务阶段）。
 */
function sessionProgressOf(session) {
  const state = session && typeof session.state === 'string' ? session.state : 'absent'
  const phase = session && typeof session.phase === 'string' ? session.phase : ''
  if (state === 'ready') return { done: 4, active: -1, failed: -1 }
  if (state === 'error') {
    const code = session && session.error && typeof session.error.code === 'string' ? session.error.code : ''
    const index = SESSION_ERROR_NODE[code] !== undefined ? SESSION_ERROR_NODE[code] : FALLBACK_ERROR_NODE
    return { done: index, active: -1, failed: index }
  }
  if (TRANSIENT_SESSION[state] !== true) return { done: 0, active: -1, failed: -1 }
  // phase 缺失时按会话态回落到该态的第一个阶段（provisioning 早期还没写 phase）。
  const index = PHASE_NODE[phase] !== undefined
    ? PHASE_NODE[phase]
    : state === 'connecting' || PHASE_STATE[phase] === 'connecting'
      ? 2
      : state === 'warming' || PHASE_STATE[phase] === 'warming'
        ? 3
        : 0
  return { done: index, active: index, failed: -1 }
}

/** 生成节点的状态：active 带计数、done 收尾、failed 停住，其余都算 pending。 */
function generationStateOf(job) {
  const status = job && typeof job.status === 'string' ? job.status : ''
  if (status === 'running') return { state: 'active', count: jobCountOf(job) }
  if (status === 'done') return { state: 'done', count: null }
  if (status === 'failed') return { state: 'failed', count: null }
  if (status === 'cancelled') return { state: 'cancelled', count: null }
  if (!job) return { state: 'pending', count: null }
  // 任务已经排上，但这一张还没开始。
  // 只有「云端已就绪、在等前一张画完」才需要补一句说明；等云端时上一段节点已经在讲了，
  // 再给生成节点挂一句「等待云端就绪…」是重复的噪音。
  return {
    state: 'pending',
    count: null,
    waiting: status === 'queued' ? 'studio.progress.queued' : null,
  }
}

/**
 * 这次等待的起点：只在「申请 GPU」阶段（push / queue）用会话开始时刻。
 *
 * connecting / warming 不能用 startedAt：重连与从本地恢复都会沿用旧的会话开始时间，
 * 拿去算等待会显示成小时级的会话运行时长（与原来状态条的口径一致）。
 * 云端已就绪后由任务提交时刻算；都没有可信起点时返回 null，界面就不显示计时——
 * 宁可不给读数，也不给一个虚高的数。
 */
function waitStartOf(session, job) {
  const state = session && typeof session.state === 'string' ? session.state : 'absent'
  if (TRANSIENT_SESSION[state] === true) {
    return state === 'provisioning' ? isoMs(session && session.startedAt) : null
  }
  if (job) return isoMs(job.createdAt || job.startedAt)
  return null
}

/** 已等待时长：起点不可信时返回 null。 */
function elapsedOf(start, now) {
  if (start === null) return null
  return Math.max(0, Number(now) - start)
}

/** 已完成/失败任务的耗时：优先宿主给的秒数，其次用起止时间戳差。 */
function finishedMsOf(job) {
  const seconds = Number(job && job.seconds)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const start = isoMs(job && (job.startedAt || job.createdAt))
  const end = isoMs(job && job.finishedAt)
  if (start !== null && end !== null) return Math.max(0, end - start)
  return null
}

/**
 * 完成态是否还该占着这条流水线（组合层据此决定是否继续按 1Hz 刷新时间）。
 *
 * 只认「刚完成」的任务：页面重开时历史里的完成记录不会重新亮一次。
 */
export function pipelineHoldOf(job, now) {
  if (!job || job.status !== 'done') return false
  const finished = isoMs(job.finishedAt)
  if (finished === null) return false
  const current = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  return current - finished < PIPELINE_DONE_HOLD_MS + DONE_HOLD_SLACK_MS
}

function buildNodes(t, input) {
  const { progress, generation, folded, queueLevel } = input
  const nodes = []
  if (folded) {
    nodes.push({
      key: 'ready',
      label: nodeLabelOf(t, 'ready'),
      state: 'done',
      title: nodeHintOf(t, 'ready'),
    })
  } else {
    SESSION_NODES.forEach((key, index) => {
      let state = 'pending'
      if (progress.failed === index) state = 'failed'
      else if (progress.active === index) state = 'active'
      else if (index < progress.done) state = 'done'
      const node = { key, label: nodeLabelOf(t, key), state, title: nodeHintOf(t, key) }
      // 排队变慢/卡住的信号只挂在排队节点上：慢档就标「比平时久」，10 分钟卡另由横幅承担。
      if (key === 'queue' && state === 'active' && queueLevel) {
        node.warn = true
        node.tag = localized(t, 'studio.pipeline.slow') || ''
      }
      nodes.push(node)
    })
  }

  const gen = { key: 'generate', label: nodeLabelOf(t, 'generate'), state: generation.state }
  if (generation.state === 'active' && generation.count) {
    gen.sub = formatText(localized(t, 'studio.pipeline.count'), generation.count)
  }
  if (generation.state === 'done') gen.label = nodeLabelOf(t, 'done')
  if (generation.state === 'failed') gen.label = nodeLabelOf(t, 'failed')
  if (generation.state === 'pending' && generation.waiting) {
    gen.sub = localized(t, generation.waiting) || ''
  }
  if (generation.state === 'cancelled') gen.state = 'pending'
  nodes.push(gen)
  return nodes
}

/**
 * 流水线视图。
 *
 * @param {(key: string) => string} t
 * @param {{
 *   session?: object|null,
 *   activeJob?: object|null,
 *   focusedJob?: object|null,
 *   pendingCount?: number,
 *   queuePolicy?: { slowMs: number, stalledMs: number } | null,
 *   failureDismissed?: boolean,
 *   now?: number,
 * }} input
 * @returns {{
 *   visible: boolean,
 *   mode: 'hidden'|'closing'|'waiting'|'complete'|'failed',
 *   nodes: Array<object>,
 *   queueText: string,
 *   timeLabel: string,
 *   timeText: string,
 *   label: string,
 * }}
 */
export function pipelineViewOf(t, input = {}) {
  const session = input.session || null
  const activeJob = input.activeJob || null
  const focusedJob = input.focusedJob || null
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now()
  const pendingCount = Number.isFinite(Number(input.pendingCount))
    ? Math.max(0, Math.floor(Number(input.pendingCount)))
    : 0
  const label = localized(t, 'studio.pipeline.label') || ''
  const hidden = { visible: false, mode: 'hidden', nodes: [], queueText: '', timeLabel: '', timeText: '', label }

  const sessionState = session && typeof session.state === 'string' ? session.state : 'absent'

  // 关闭云端不属于生成流程：同位置只留一行「正在关闭云端…」，不画节点。
  if (sessionState === 'stopping') {
    return {
      visible: true,
      mode: 'closing',
      nodes: [{
        key: 'closing',
        label: localized(t, 'studio.pipeline.node.closing') || '',
        state: 'warn',
        title: localized(t, 'session.hint.stopping') || '',
      }],
      queueText: '',
      timeLabel: '',
      timeText: '',
      label,
    }
  }

  const queuePolicy = queuePolicyOf({ queuePolicy: input.queuePolicy })
  const queueLevel = queueLevelOf(queueWaitMsOf(session, now), queuePolicy)
  const progress = sessionProgressOf(session)
  const generation = generationStateOf(activeJob)
  const sessionErrorCode = session && session.error && typeof session.error.code === 'string'
    ? session.error.code
    : ''
  // 会话自然结束 / 已释放不算「某一段失败」：不画失败节点，交给上方的指引卡。
  const sessionFailed = sessionState === 'error' && !NON_STAGE_ERROR_CODES.has(sessionErrorCode)
  const jobFailed = Boolean(focusedJob && focusedJob.status === 'failed')
  const failed = (sessionFailed || jobFailed) && input.failureDismissed !== true
  const doneHold = !activeJob && pipelineHoldOf(focusedJob, now)
  const folded = sessionState === 'ready' && !sessionFailed

  // 失败：停在失败节点上保持可见，直到开始下一次生成、关闭云端或收起指引提示。
  if (failed) {
    const failureNodes = buildNodes(t, {
      progress,
      generation: sessionFailed && !jobFailed ? { state: 'pending', count: null } : { state: 'failed', count: null },
      folded,
      queueLevel,
    })
    // 会话级失败没有可信的等待起点（错误码里没有时间戳），宁可不显示计时。
    const elapsed = sessionFailed
      ? null
      : (() => {
          const start = waitStartOf(session, focusedJob)
          const finished = isoMs(focusedJob && focusedJob.finishedAt)
          if (start !== null) return Math.max(0, (finished ?? now) - start)
          return finishedMsOf(focusedJob)
        })()
    return {
      visible: true,
      mode: 'failed',
      nodes: failureNodes,
      queueText: '',
      timeLabel: localized(t, 'studio.pipeline.elapsed') || '',
      timeText: elapsed === null || elapsed <= 0 ? '' : clockOf(elapsed),
      label,
    }
  }

  // 完成：最后节点点亮「出图完成」，保留约 1.2 秒再淡出（受 2 秒轮询影响实际 1.2~3.2 秒）。
  if (doneHold) {
    const doneNodes = buildNodes(t, {
      progress,
      generation: { state: 'done', count: null },
      folded,
      queueLevel,
    })
    const used = finishedMsOf(focusedJob)
    return {
      visible: true,
      mode: 'complete',
      nodes: doneNodes,
      queueText: '',
      timeLabel: localized(t, 'studio.pipeline.elapsedDone') || '',
      timeText: clockOf(used ?? 0),
      label,
    }
  }

  const waiting = TRANSIENT_SESSION[sessionState] === true || Boolean(activeJob)
  if (!waiting) return hidden

  // 出现阈值：等待很快结束（极速预设单张）时不闪一条出来。
  const start = waitStartOf(session, activeJob)
  if (start !== null && now - start < PIPELINE_APPEAR_MS) return hidden

  const nodes = buildNodes(t, { progress, generation, folded, queueLevel })
  const others = Math.max(0, pendingCount - (activeJob ? 1 : 0))
  const elapsed = elapsedOf(start, now)
  return {
    visible: true,
    mode: 'waiting',
    nodes,
    queueText: others > 0 ? formatText(localized(t, 'studio.pipeline.busy'), { count: others }) : '',
    timeLabel: localized(t, 'studio.pipeline.elapsed') || '',
    timeText: elapsed === null ? '' : clockOf(elapsed),
    label,
  }
}
