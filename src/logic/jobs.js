/** 任务集合查询：待执行队列排序、活动任务判定、取消态与历史分页合并。 */

import { LIMITS } from '../../shared/contract.js'
import { ACTIVE_STATUS } from '../constants.js'

export function stateJobs(state) {
  return Array.isArray(state && state.jobs) ? state.jobs.filter((job) => job && job.id) : []
}

/**
 * 待执行任务的执行顺序：正在跑的在前，等云端的次之，纯排队的按提交先后收尾。
 *
 * 宿主是串行队列，同一时刻最多一个 running 与一个 waiting-session；
 * 这两档已经决定了谁先出图，不能靠任务列表的位置判断。
 * `cancelled` 是终态，不在 ACTIVE_STATUS 里，自然不会进入队列。
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

// ---- 取消 -----------------------------------------------------------------

/** 只有三种活动态可以取消；终态（done / failed / cancelled）不再显示取消入口。 */
export function isJobCancellable(job) {
  return Boolean(job && ACTIVE_STATUS[job.status] === true)
}

/**
 * 取消中的展示态：宿主已经标了 `cancelRequested`，或本地请求已发出但快照还没更新。
 *
 * 两个来源要合并，否则从点击到下一轮轮询之间按钮会短暂回到可点状态。
 */
export function isJobCancelling(job, cancellingIds) {
  if (!job) return false
  if (job.cancelRequested === true) return true
  if (!Array.isArray(cancellingIds)) return false
  return cancellingIds.includes(job.id)
}

/** 卡片类名：排队中的暗房卡沿用 is-queued，取消中的卡另加 is-cancelling。 */
export function jobCardClass(job, cancellingIds) {
  const classes = ['ofs-ghost']
  if (job && job.status === 'queued') classes.push('is-queued')
  if (isJobCancelling(job, cancellingIds)) classes.push('is-cancelling')
  return classes.join(' ')
}

// ---- 历史分页 -------------------------------------------------------------

/**
 * 历史条目的唯一键：优先 jobId，其次产物目录 dir，最后退回「时间 + 提示词」组合。
 * 分页加载时宿主可能因为目录写入时序返回重复条目，合并必须去重。
 */
export function historyKeyOf(item) {
  if (!item || typeof item !== 'object') return ''
  if (typeof item.jobId === 'string' && item.jobId) return `job:${item.jobId}`
  if (typeof item.dir === 'string' && item.dir) return `dir:${item.dir}`
  const prompt = typeof item.prompt === 'string' ? item.prompt : ''
  const stamp = item.finishedAt || item.createdAt || item.mtime || ''
  if (!prompt && !stamp) return ''
  return `raw:${stamp}|${prompt}`
}

/**
 * 「加载更多」合并：保持已有顺序（新的在页面顶部第一页），只追加未见过的条目。
 * 失败、空页与重复页都返回原数组引用，避免无意义的重新渲染。
 */
export function mergeHistoryPages(previous, incoming) {
  const head = Array.isArray(previous) ? previous : []
  const tail = Array.isArray(incoming) ? incoming : []
  if (tail.length === 0) return head
  const seen = new Set()
  const merged = []
  for (const item of head.concat(tail)) {
    if (!item || typeof item !== 'object') continue
    const key = historyKeyOf(item)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    merged.push(item)
  }
  return merged
}

/** 下一页的 offset：本次请求起点 + 本次实际返回条数（不是去重后的合并长度）。 */
export function nextHistoryOffset(offset, pageLength) {
  const start = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Math.floor(Number(offset)) : 0
  const length = Number.isFinite(Number(pageLength)) && Number(pageLength) > 0 ? Math.floor(Number(pageLength)) : 0
  return start + length
}

/**
 * 是否还有更早的记录。
 *
 * 新宿主直接给 `hasMore`；旧宿主没有该字段时按「本页是否取满」推断，
 * 这样客户端升级后不会一页之后就停。
 */
export function historyHasMore(data, requestedLimit) {
  const holder = data && typeof data === 'object' ? data : {}
  if (typeof holder.hasMore === 'boolean') return holder.hasMore
  const items = Array.isArray(holder.items) ? holder.items : []
  const limit = Number.isFinite(Number(requestedLimit)) && Number(requestedLimit) > 0
    ? Math.floor(Number(requestedLimit))
    : LIMITS.history.pageSize
  return items.length >= limit
}
