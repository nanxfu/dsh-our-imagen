/** 数据形态常量：会话态、任务态与阶段映射。 */

export const NS = 'our-free-imagen'

export const ACTIVE_STATUS = { queued: true, 'waiting-session': true, running: true }

export const TRANSIENT_SESSION = { provisioning: true, connecting: true, warming: true, stopping: true }

export const PHASE_STATE = {
  push: 'provisioning',
  queue: 'provisioning',
  tunnel: 'connecting',
  health: 'connecting',
  warm: 'warming',
}
