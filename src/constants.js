/** 数据形态常量：会话态、任务态与阶段映射。 */

export const NS = 'our-free-imagen'

// ─── 1. 文案字典（zh / en 键集合必须一致） ────────────────────────────────────────
/**
 * 前端文案字典（zh / en 键集合必须完全一致，验收脚本会逐键比对）。
 * 键名以 docs/SPEC.md 为准；SPEC 未覆盖、但本工作台需要的键在两侧同时
 * 补充，不单边新增。
 */

export const ACTIVE_STATUS = { queued: true, 'waiting-session': true, running: true }

export const TRANSIENT_SESSION = { provisioning: true, connecting: true, warming: true, stopping: true }

export const PHASE_STATE = {
  push: 'provisioning',
  queue: 'provisioning',
  tunnel: 'connecting',
  health: 'connecting',
  warm: 'warming',
}
