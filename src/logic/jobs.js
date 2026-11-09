/** 任务集合查询与焦点任务挑选。 */

import { ACTIVE_STATUS } from '../constants.js'

export function stateJobs(state) {
  return Array.isArray(state && state.jobs) ? state.jobs.filter((job) => job && job.id) : []
}

export function activeJobOf(state) {
  return stateJobs(state).find((job) => ACTIVE_STATUS[job.status] === true) ?? null
}

export function pickFocusedJob(state, selectedId, localJob) {
  if (!selectedId) return null
  const jobs = stateJobs(state)
  const fromState = jobs.find((job) => job.id === selectedId)
  if (fromState) return fromState
  if (state && state.lastJob && state.lastJob.id === selectedId) return state.lastJob
  if (localJob && localJob.id === selectedId && jobs.length === 0) return localJob
  return null
}

/**
 * 会话区展示数据：徽章颜色、标签、按钮可用性、错误态、阶段提示一次算完，
 * 组件只负责画。只依赖入参，可直接单测。
 */
