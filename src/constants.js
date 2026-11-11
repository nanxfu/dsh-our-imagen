/** 数据形态常量：会话态、任务态与阶段映射。 */

export const NS = 'our-free-imagen'

export const ACTIVE_STATUS = { queued: true, 'waiting-session': true, running: true }

export const TRANSIENT_SESSION = { provisioning: true, connecting: true, warming: true, stopping: true }

// 宿主会写入的会话阶段：push（推送内核）→ queue（Kaggle 排队）→ tunnel（会合/握手）→ warm（装载模型）。
export const PHASE_STATE = {
  push: 'provisioning',
  queue: 'provisioning',
  tunnel: 'connecting',
  warm: 'warming',
}
