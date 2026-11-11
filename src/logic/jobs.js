/** 任务集合查询：待执行队列的排序与活动任务判定。 */

import { ACTIVE_STATUS } from '../constants.js'

export function stateJobs(state) {
  return Array.isArray(state && state.jobs) ? state.jobs.filter((job) => job && job.id) : []
}

/**
 * 待执行任务的执行顺序：正在跑的在前，等云端的次之，纯排队的按提交先后收尾。
 *
 * 宿主是串行队列，同一时刻最多一个 running 与一个 waiting-session；
 * 这两档已经决定了谁先出图，不能靠任务列表的位置判断。
 */
const ACTIVE_RANK = { running: 0, 'waiting-session': 1, queued: 2 }

function rankOf(job) {
  const rank = ACTIVE_RANK[job.status]
  return rank === undefined ? 9 : rank
}

/** 提交时间戳（毫秒）；缺字段或非法值时排在最前，保持相对顺序不被打乱。 */
function submittedAt(job) {
  const value = Date.parse(String(job.createdAt ?? ''))
  return Number.isFinite(value) ? value : 0
}

function comparePending(left, right) {
  const rank = rankOf(left) - rankOf(right)
  if (rank !== 0) return rank
  const submitted = submittedAt(left) - submittedAt(right)
  if (submitted !== 0) return submitted
  return String(left.id).localeCompare(String(right.id))
}

/**
 * 全部待执行任务，按真实执行顺序排列（进行中 → 等云端 → 排队中）。
 *
 * 宿主 `/state` 的 `jobs` 是「最新在前」，直接取首个活跃任务会选中刚提交的排队任务：
 * 进度文案因此写成「排队等待出图…」，真正在生成的那一张反而没有位置可显示。
 * 队列展示与进度文案都必须用本函数的顺序。
 */
export function pendingJobsOf(state) {
  return stateJobs(state)
    .filter((job) => ACTIVE_STATUS[job.status] === true)
    .sort(comparePending)
}

export function activeJobOf(state) {
  return pendingJobsOf(state)[0] ?? null
}
