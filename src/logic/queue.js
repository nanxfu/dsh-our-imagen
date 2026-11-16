/**
 * 排队分级：3 分钟只提示变慢，10 分钟建议换新实例重排，45 分钟由硬超时卡收敛。
 *
 * 阈值优先取宿主 `/state.queuePolicy`（插件配置可覆盖），旧宿主不下发时回落到
 * 契约 TIMEOUTS.queueSlowMs / queueStalledMs。这里只做纯计算，文案与卡片由组件层负责。
 */

import { TIMEOUTS } from '../../shared/contract.js'

/**
 * 归一化排队阈值：非法值回落契约默认值，且保证「卡住」不早于「变慢」
 * （与 Host SessionManager.queuePolicy 的口径一致，避免客户端先于服务端提示重排）。
 *
 * @param {object|null} state 宿主 /state 快照
 * @returns {{ slowMs: number, stalledMs: number }}
 */
export function queuePolicyOf(state) {
  const raw = state && state.queuePolicy && typeof state.queuePolicy === 'object' ? state.queuePolicy : null
  const slowRaw = Number(raw && raw.slowMs)
  const stalledRaw = Number(raw && raw.stalledMs)
  const slowMs = Number.isFinite(slowRaw) && slowRaw > 0 ? slowRaw : TIMEOUTS.queueSlowMs
  const stalledMs = Number.isFinite(stalledRaw) && stalledRaw > 0 ? stalledRaw : TIMEOUTS.queueStalledMs
  return { slowMs, stalledMs: Math.max(slowMs, stalledMs) }
}

/**
 * 「已排队」时长：只在申请 GPU 的 queue 阶段计时。
 *
 * 推送（push）与排队是两段等待，只有排队时长能判断这条队列是不是卡住了；
 * 缺 startedAt（旧宿主或尚未落时间）时返回 null，界面不展示分级提示。
 *
 * @param {object|null} session 宿主快照里的会话
 * @param {number} [now] 当前时刻（毫秒时间戳），缺省用 Date.now()
 * @returns {number|null}
 */
export function queueWaitMsOf(session, now) {
  if (!session || session.state !== 'provisioning' || session.phase !== 'queue') return null
  const start = Date.parse(String(session.startedAt ?? ''))
  if (!Number.isFinite(start)) return null
  const current = Number.isFinite(now) ? now : Date.now()
  return Math.max(0, current - start)
}

/**
 * 排队分级：''（正常）→ 'slow'（超过慢档）→ 'stalled'（超过卡住档）。
 *
 * @param {number|null} waitMs 已排队时长
 * @param {{ slowMs: number, stalledMs: number }} [policy]
 * @returns {''|'slow'|'stalled'}
 */
export function queueLevelOf(waitMs, policy) {
  if (!Number.isFinite(waitMs)) return ''
  const resolved = policy || queuePolicyOf(null)
  if (waitMs >= resolved.stalledMs) return 'stalled'
  if (waitMs >= resolved.slowMs) return 'slow'
  return ''
}

/**
 * 排队轮次键：同一轮排队的提示只弹一次，重排后 startedAt 变新即可再次触发。
 *
 * 用 startedAt + presetId 而不是 index/id：宿主快照里没有稳定的排队 id，
 * 而重排必然换一个新的 startedAt；presetId 只用于在极端情况下避免两轮同时间戳。
 *
 * @param {object|null} session
 * @returns {string} 空串表示无法判定轮次（此时不展示可关闭的卡片，避免重复弹）
 */
export function queueRoundKeyOf(session) {
  if (!session) return ''
  const startedAt = typeof session.startedAt === 'string' ? session.startedAt.trim() : ''
  if (!startedAt) return ''
  const presetId = typeof session.presetId === 'string' ? session.presetId.trim() : ''
  return presetId ? `${startedAt}|${presetId}` : startedAt
}

/**
 * 卡住档换算成标题里的分钟数（10 分钟档默认 10；宿主配置成 6 分钟时标题跟随）。
 * 最小 1 分钟，避免出现「排队超过 0 分钟」。
 *
 * @param {{ slowMs: number, stalledMs: number }} [policy]
 * @returns {number}
 */
export function queueStalledMinutesOf(policy) {
  const resolved = policy || queuePolicyOf(null)
  return Math.max(1, Math.round(resolved.stalledMs / 60000))
}
