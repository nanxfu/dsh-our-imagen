/** 任务集合查询。 */

import { ACTIVE_STATUS } from '../constants.js'

export function stateJobs(state) {
  return Array.isArray(state && state.jobs) ? state.jobs.filter((job) => job && job.id) : []
}

export function activeJobOf(state) {
  return stateJobs(state).find((job) => ACTIVE_STATUS[job.status] === true) ?? null
}
