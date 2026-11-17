/**
 * 健康与 Kernel 状态监视器（Health Monitor）：从 `SessionManager` 拆出的心跳探活、
 * 掉线恢复窗口续期、ready 失联判定与 Kernel 状态轮询协作器。
 */

import { TIMEOUTS } from '../../shared/contract.js'
import { logText } from '../redact.js'
import { fetchHealth } from '../remote.js'
import { decideReadyHealthLoss, describeHealthPhase, isKernelEnded, remoteErrorCodeOf } from './health.js'
import { formatDuration, isoNow, normalizeTunnelProvider } from './state.js'

/** 把 `/health` 里的设备、模型与隧道通道写进快照（不涉及 token）。 */
export function applyHealthDetails(mgr, health) {
  mgr.session.lastProbeAt = isoNow()
  if (health?.device) mgr.session.device = health.device
  if (health?.device_count != null) mgr.session.deviceCount = health.device_count
  if (health?.model_id) mgr.session.modelId = health.model_id
  if (health?.idle_timeout_sec) mgr.session.idleTimeoutSec = health.idle_timeout_sec
  // 远端空闲倒计时（M3.4）：只接受有限数字，异常值不覆盖上一次有效值。
  if (health?.idle_seconds != null) {
    const idleSeconds = Number(health.idle_seconds)
    if (Number.isFinite(idleSeconds)) mgr.session.idleSeconds = idleSeconds
  }
  if (health?.tunnel_provider !== undefined) {
    mgr.session.tunnelProvider = normalizeTunnelProvider(health.tunnel_provider)
  }
}

/** 依据 `/health` 的 phase 推进会话状态，并在进入 ready 时切换轮询节奏。 */
export function applyHealthState(mgr, health) {
  if (health?.phase === 'ready') {
    mgr.reconnectAttempts = 0
    if (mgr.session.state !== 'ready') {
      mgr.session.readyAt = mgr.session.readyAt ?? isoNow()
      mgr.transition('ready', { phase: null })
      mgr.session.detail = '就绪'
      mgr.clearTimers()
      mgr.every(() => mgr.pollHealth(), mgr.options.healthyIntervalMs)
      // 保留 Kernel 状态轮询：daemon 空闲退出 / 平台回收后，这是唯一能证明
      // 会话已经结束的信号；没有它 UI 会一直显示「在线」而每张图都失败。
      mgr.every(() => mgr.pollKernelStatus(), mgr.options.kernelPollMs)
    }
    return
  }

  if (health?.phase === 'error') {
    // daemon 的 last_error_code 已在契约登记时原样透传（如 gpu_unavailable），
    // 未登记 / 缺失回退 remote_error，保证客户端一定有对应文案。
    mgr.session.detail = describeHealthPhase(health)
    mgr.fail(remoteErrorCodeOf(health?.last_error_code), `远端进入错误状态：${String(health?.last_error ?? '未知').slice(0, 700)}`)
    return
  }

  mgr.transition('warming', { phase: 'warm' })
  mgr.session.detail = describeHealthPhase(health)
}

/**
 * 恢复窗口续期：确认 Kernel 仍 RUNNING 时续一轮。
 *
 * @returns {boolean} true=已续期；false=不在恢复期或续期轮数用尽
 */
function renewRecoveryWindow(mgr) {
  if (!mgr.recoveringFromReady || mgr.recoveryStartedAt === 0) return false
  if (mgr.recoveryRenewals >= mgr.options.recoveryMaxRenewals) return false
  mgr.recoveryRenewals += 1
  mgr.recoveryStartedAt = Date.now()
  mgr.log.info(
    `recovery_renewed attempt=${mgr.recoveryRenewals}/${mgr.options.recoveryMaxRenewals} ` +
      `kernelStatus=${mgr.session.kernelStatus ?? 'unknown'}`,
  )
  return true
}

/** 执行一次 `/health` 检查并驱动健康/掉线状态推进。 */
export async function checkHealth(mgr) {
  if (mgr.disposed || !mgr.session.endpointUrl) return
  const epoch = mgr.epoch
  let health
  try {
    health = await fetchHealth(mgr.session.endpointUrl, mgr.secret.token, undefined, mgr.ctx)
    if (!mgr.canPoll(epoch)) return
    mgr.healthMisses = 0
    mgr.healthEpoch += 1
    mgr.recoveringFromReady = false
    mgr.recoveryStartedAt = 0
    mgr.recoveryRenewals = 0
    mgr.recoveryBeganAt = 0
  } catch (error) {
    if (!mgr.canPoll(epoch)) return
    // 心跳失败是预期内的网络事件，按 debug 记录，避免代理抖动时刷屏。
    mgr.log.debug('健康检查失败', logText(error?.message ?? error, 200))
    mgr.healthMisses += 1
    if (mgr.session.state === 'ready') {
      // ready 之后心跳丢失不能只改文案：先确认 Kernel 是否还活着，
      // 再决定「重取隧道地址」还是「判定会话结束」（否则 UI 会一直显示在线）。
      if (mgr.healthMisses >= TIMEOUTS.readyHealthMissesBeforeCheck) {
        mgr.log.warn(
          `ready_heartbeat_lost misses=${mgr.healthMisses} kernelStatus=${mgr.session.kernelStatus ?? 'unknown'}，开始确认会话状态`,
        )
        void handleReadyHealthLoss(mgr, epoch, mgr.healthEpoch)
      } else {
        mgr.session.detail = '远端心跳丢失，正在确认会话状态'
      }
      return
    }
    if (mgr.recoveringFromReady) {
      // 从 ready 失联恢复出来的连接仍握手失败：只要 Kernel 仍 RUNNING，Kernel 状态
      // 轮询就会持续续期恢复窗口，续期用尽才判定会话失效。
      if (mgr.recoveryWindowExpired()) {
        mgr.log.warn(
          `recovery_handshake_timeout renewals=${mgr.recoveryRenewals}/${mgr.options.recoveryMaxRenewals} ` +
            `elapsedMs=${Date.now() - mgr.recoveryBeganAt} kernelStatus=${mgr.session.kernelStatus ?? 'unknown'}`,
        )
        mgr.fail(
          'health_failed',
          `重新获取隧道地址后仍无法握手，且恢复窗口续期已用尽（已等待 ` +
            `${formatDuration(Date.now() - mgr.recoveryBeganAt)}，Kernel 状态 ` +
            `${mgr.session.kernelStatus ?? '未知'}），请点「唤醒」重试`,
        )
        return
      }
      mgr.session.detail = '重新获取隧道地址后仍在重试握手'
    } else if (mgr.healthMisses >= 5) {
      // 隧道可能重建：回到等待上报状态重新取地址（与 watch() 的接线完全一致）。
      mgr.log.warn(
        `tunnel_lost misses=${mgr.healthMisses} kernelStatus=${mgr.session.kernelStatus ?? 'unknown'}，重新会合隧道地址`,
      )
      mgr.healthMisses = 0
      mgr.session.endpointUrl = null
      mgr.transition('connecting', { phase: 'tunnel' })
      mgr.session.detail = '隧道失联，正在重新获取地址'
      mgr.watch()
    } else if (mgr.healthMisses >= 3) {
      mgr.session.detail = '远端心跳丢失，正在重连'
    }
    return
  }

  const wasReady = mgr.session.state === 'ready'
  applyHealthDetails(mgr, health)
  applyHealthState(mgr, health)
  // 进入 ready 是关键节点（轮询节奏切换），立即落盘；其余信息按 60s 节流。
  if (mgr.session.state === 'ready' && !wasReady) mgr.persistSession({ force: true })
  else if (mgr.session.state !== 'error') mgr.persistSession()
}

/**
 * ready 阶段连续心跳失败后的恢复决策执行：
 *  - Kernel 已结束（COMPLETE / ERROR / CANCEL_ACKNOWLEDGED）→ 立刻结束会话；
 *  - Kernel 仍 RUNNING → 认为隧道可能重建，清空 endpointUrl 回会合点重取一次；
 *  - 重新会合后再失败 → health_failed，不再无限抖动。
 */
export async function handleReadyHealthLoss(mgr, expectedEpoch = mgr.epoch, healthToken = mgr.healthEpoch) {
  if (mgr.livenessCheck) return mgr.livenessCheck
  const epoch = expectedEpoch
  if (!mgr.canPoll(epoch) || mgr.session.state !== 'ready' || healthToken !== mgr.healthEpoch) return null
  mgr.livenessCheck = (async () => {
    try {
      const kernelId = mgr.session.kernelId
      const result = await mgr.provider.status(kernelId).catch((error) => {
        mgr.log.debug('查询 Kernel 状态失败（按未知处理）', logText(error?.message ?? error, 200))
        return null
      })
      // 恢复竞态守卫：若等待期间 checkHealth() 已恢复 /health（healthEpoch 递增），禁止拆掉已恢复会话。
      if (!mgr.canPoll(epoch) || mgr.session.state !== 'ready' || healthToken !== mgr.healthEpoch) return
      // Kernel 已被删除（403/404）：没有可恢复的对象，直接按会话结束收敛，不要再去会合点空等。
      if (result?.missing) {
        mgr.log.warn(`kernel_missing_giveup kernelId=${kernelId}`)
        mgr.fail('session_ended', 'Kernel 已不存在（可能已被删除或回收），点「唤醒」可重新启动会话')
        return
      }
      const status = result?.status ?? null
      if (status) {
        mgr.session.kernelStatus = status
        mgr.persistSession()
      }
      const action = decideReadyHealthLoss(status, mgr.reconnectAttempts, TIMEOUTS.reconnectMaxAttempts)
      if (action === 'ended') {
        const logs = await mgr.provider.logs(kernelId).catch((error) => {
          mgr.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', logText(error?.message ?? error, 200))
          return null
        })
        if (!mgr.canPoll(epoch) || mgr.session.state !== 'ready' || healthToken !== mgr.healthEpoch) return
        mgr.log.warn(`kernel_ended status=${status ?? 'unknown'} reconnectAttempts=${mgr.reconnectAttempts}`)
        const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
        if (status === 'ERROR') {
          mgr.fail('remote_error', `Kernel 已结束（ERROR），远端异常退出${tail}`, { logsTail: logs?.tail })
        } else {
          mgr.fail('session_ended', `Kernel 已结束（${status}），点「唤醒」可重新启动会话${tail}`, {
            logsTail: logs?.tail,
          })
        }
        return
      }
      if (action === 'giveUp') {
        mgr.log.warn(`heartbeat_giveup status=${status ?? 'unknown'} reconnectAttempts=${mgr.reconnectAttempts}`)
        mgr.fail(
          'health_failed',
          `远端心跳连续丢失，且 Kernel 状态为 ${status ?? '未知'}；隧道可能已失效，请点「唤醒」重试`,
        )
        return
      }
      mgr.reconnectAttempts += 1
      mgr.healthMisses = 0
      mgr.recoveringFromReady = true
      // 新一轮恢复：重置续期窗口与已经等待的总时长（后续靠 Kernel 状态轮询续期）。
      mgr.recoveryStartedAt = Date.now()
      mgr.recoveryRenewals = 0
      mgr.recoveryBeganAt = mgr.recoveryStartedAt
      mgr.session.endpointUrl = null
      mgr.log.warn(
        `tunnel_reconnect attempt=${mgr.reconnectAttempts} kernelStatus=${status ?? 'unknown'}，重新会合隧道地址`,
      )
      mgr.transition('connecting', { phase: 'tunnel' })
      mgr.session.detail = '远端心跳丢失，正在重新获取隧道地址'
      mgr.watch()
    } finally {
      mgr.livenessCheck = null
    }
  })()
  return mgr.livenessCheck
}

/** 轮询一次 Kaggle Kernel 状态并驱动结束判定或恢复窗口续期。 */
export async function checkKernelStatus(mgr) {
  if (mgr.disposed || !mgr.session.kernelId) return
  const epoch = mgr.epoch
  const kernelId = mgr.session.kernelId
  const result = await mgr.provider.status(kernelId).catch((error) => {
    mgr.log.debug('轮询 Kernel 状态失败（下一拍重试）', logText(error?.message ?? error, 200))
    return null
  })
  if (!mgr.canPoll(epoch)) return
  // Kernel 已不存在（删除 / 被平台回收）：按会话结束收敛，不再无限重试状态查询。
  if (result?.missing) {
    mgr.log.warn(`kernel_missing kernelId=${kernelId} state=${mgr.session.state}`)
    mgr.fail('session_ended', 'Kernel 已不存在（可能已被删除或回收），点「唤醒」可重新启动会话')
    return
  }
  if (!result?.ok) return
  if (result.status && result.status !== mgr.session.kernelStatus) {
    mgr.log.debug(`kernel_status ${mgr.session.kernelStatus ?? 'null'} -> ${result.status}`)
    mgr.session.kernelStatus = result.status
    // Kernel 状态是恢复时判断「要不要清理远端」的关键依据，变化时按节流落盘。
    mgr.persistSession()
  }

  // 恢复期向 Kaggle 确认 Kernel 仍 RUNNING：续期恢复窗口，隧道重建稍久也不判死。
  if (mgr.recoveringFromReady && result.status === 'RUNNING') renewRecoveryWindow(mgr)

  if (!isKernelEnded(result.status)) return

  const logs = await mgr.provider.logs(kernelId).catch((error) => {
    mgr.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', logText(error?.message ?? error, 200))
    return null
  })
  if (!mgr.canPoll(epoch)) return
  mgr.log.warn(`kernel_ended status=${result.status} state=${mgr.session.state}`)

  const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
  // ready 状态下结束通常是空闲退出或远端崩溃；其余阶段结束说明启动没成功。
  if (result.status !== 'ERROR' && mgr.session.state === 'ready') {
    mgr.fail('session_ended', `Kernel 已结束（${result.status}），点「唤醒」可重新启动会话${tail}`, {
      logsTail: logs?.tail,
    })
  } else {
    mgr.fail('remote_error', `Kernel 已结束（${result.status}）${tail}`, { logsTail: logs?.tail })
  }
}
