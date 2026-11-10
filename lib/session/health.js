/**
 * 健康轮询与掉线恢复。
 *
 * 边界：解释 `/health` 响应（phase → 状态/阶段/文案）、心跳丢失后的恢复决策、
 * Kernel 状态轮询。状态写入都经 host（SessionManager）；本模块不持有定时器集合，
 * 也不 import 会合模块（需要重新会合时调用 host.watch()，由会话层接线）。
 *
 * phase 文案、Kernel 结束判定与恢复动作拆成纯函数，便于离线断言；
 * 原先的 4 层嵌套三元收成 PHASE_DETAIL 映射表。
 */

import { TIMEOUTS } from '../../shared/contract.js'
import { fetchHealth } from '../remote.js'
import { formatDuration, isoNow } from './state.js'

const PHASE_DETAIL = {
  installing: '远端安装依赖',
  loading: '远端加载模型',
}

/** /health.phase → 给用户看的一句话（未知 phase 视为「远端启动中」）。 */
export function describeHealthPhase(health) {
  if (health?.phase === 'error') return `远端错误：${health?.last_error ?? '未知'}`
  return PHASE_DETAIL[health?.phase] ?? '远端启动中'
}

/** Kernel 是否已经结束（正常完成 / 异常 / 被取消）。 */
export function isKernelEnded(status) {
  return status === 'COMPLETE' || status === 'ERROR' || status === 'CANCEL_ACKNOWLEDGED'
}

/**
 * ready 阶段心跳丢失后的下一步动作（纯函数）：
 *  - 'ended'：Kernel 已结束，收敛为 error 并带日志尾；
 *  - 'reconnect'：Kernel 还活着，认为隧道可能重建，清空地址回会合点重取一次；
 *  - 'giveUp'：已经重取过，判定 health_failed，不再无限抖动。
 */
export function decideReadyHealthLoss(status, reconnectAttempts, maxAttempts) {
  if (isKernelEnded(status)) return 'ended'
  return reconnectAttempts >= maxAttempts ? 'giveUp' : 'reconnect'
}

/** 挂上健康轮询与 Kernel 状态轮询，并立刻打第一拍。 */
export function startHealthLoop(host) {
  host.clearTimers()
  host.every(() => pollHealth(host), host.options.tickMs)
  host.every(() => pollKernelStatus(host), host.options.kernelPollMs)
  void pollHealth(host)
}

export async function pollHealth(host) {
  if (host.disposed || !host.session.endpointUrl) return
  const epoch = host.epoch
  let health
  try {
    health = await fetchHealth(host.session.endpointUrl, host.secret.token, undefined, host.ctx)
    if (!host.canPoll(epoch)) return
    host.healthMisses = 0
    host.recoveringFromReady = false
    host.recoveryStartedAt = 0
  } catch (error) {
    if (!host.canPoll(epoch)) return
    // 心跳失败是预期内的网络事件，按 debug 记录，避免代理抖动时刷屏。
    host.log.debug('健康检查失败', error?.message ?? error)
    host.healthMisses += 1
    if (host.session.state === 'ready') {
      // ready 之后心跳丢失不能只改文案：先确认 Kernel 是否还活着，
      // 再决定「重取隧道地址」还是「判定会话结束」（否则 UI 会一直显示在线）。
      if (host.healthMisses >= TIMEOUTS.readyHealthMissesBeforeCheck) {
        void handleReadyHealthLoss(host)
      } else {
        host.session.detail = '远端心跳丢失，正在确认会话状态'
      }
      return
    }
    if (host.recoveringFromReady) {
      // 从 ready 失联恢复出来的连接仍握手失败：给「网络抖动」留够重试窗口
      // （默认 2 个健康检测周期 = recoveryTimeoutMs），超时才判定会话失效，
      // 避免几十秒的本地网络抖动就杀掉一个还在 RUNNING 的 Kernel（重新排队代价很高）。
      const waited = host.recoveryStartedAt > 0 ? Date.now() - host.recoveryStartedAt : 0
      if (waited > host.options.recoveryTimeoutMs) {
        host.fail(
          'health_failed',
          `重新获取隧道地址后仍无法握手（已等待 ${formatDuration(waited)}，Kernel 状态 ${host.session.kernelStatus ?? '未知'}），请重新启动会话`,
        )
        return
      }
      host.session.detail = '重新获取隧道地址后仍在重试握手'
    } else if (host.healthMisses >= 5) {
      // 隧道可能重建：回到等待上报状态重新取地址（与 watch() 的接线完全一致）。
      host.healthMisses = 0
      host.session.endpointUrl = null
      host.session.state = 'connecting'
      host.session.phase = 'tunnel'
      host.session.detail = '隧道失联，正在重新获取地址'
      host.watch()
    } else if (host.healthMisses >= 3) {
      host.session.detail = '远端心跳丢失，正在重连'
    }
    return
  }

  host.session.lastProbeAt = isoNow()
  if (health?.device) host.session.device = health.device
  if (health?.device_count != null) host.session.deviceCount = health.device_count
  if (health?.model_id) host.session.modelId = health.model_id
  if (health?.idle_timeout_sec) host.session.idleTimeoutSec = health.idle_timeout_sec

  if (health?.phase === 'ready') {
    host.reconnectAttempts = 0
    if (host.session.state !== 'ready') {
      host.session.state = 'ready'
      host.session.phase = null
      host.session.readyAt = host.session.readyAt ?? isoNow()
      host.session.detail = '就绪'
      host.clearTimers()
      host.every(() => pollHealth(host), host.options.healthyIntervalMs)
      // 保留 Kernel 状态轮询：daemon 空闲退出 / 平台回收后，这是唯一能证明
      // 会话已经结束的信号；没有它 UI 会一直显示「在线」而每张图都失败。
      host.every(() => pollKernelStatus(host), host.options.kernelPollMs)
    }
    return
  }

  host.session.state = 'warming'
  host.session.phase = 'warm'
  host.session.detail = describeHealthPhase(health)
  if (health?.phase === 'error') {
    host.fail('remote_error', `远端进入错误状态：${String(health?.last_error ?? '未知').slice(0, 400)}`)
  }
}

/**
 * ready 阶段连续心跳失败后的恢复决策执行：
 *  - Kernel 已结束（COMPLETE / ERROR / CANCEL_ACKNOWLEDGED）→ 立刻结束会话；
 *  - Kernel 仍 RUNNING → 认为隧道可能重建，清空 endpointUrl 回会合点重取一次；
 *  - 重新会合后再失败 → health_failed，不再无限抖动。
 */
export async function handleReadyHealthLoss(host) {
  if (host.livenessCheck) return host.livenessCheck
  const epoch = host.epoch
  if (host.disposed || host.session.state !== 'ready') return null
  host.livenessCheck = (async () => {
    try {
      const kernelId = host.session.kernelId
      const result = await host.deps.kernelStatus(host.ctx, kernelId).catch((error) => {
        host.log.debug('查询 Kernel 状态失败（按未知处理）', error?.message ?? error)
        return null
      })
      if (!host.canPoll(epoch) || host.session.state !== 'ready') return
      const status = result?.status ?? null
      if (status) host.session.kernelStatus = status
      const action = decideReadyHealthLoss(status, host.reconnectAttempts, TIMEOUTS.reconnectMaxAttempts)
      if (action === 'ended') {
        const logs = await host.deps.kernelLogs(host.ctx, kernelId).catch((error) => {
          host.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', error?.message ?? error)
          return null
        })
        if (!host.canPoll(epoch)) return
        const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
        if (status === 'ERROR') {
          host.fail('remote_error', `Kernel 已结束（ERROR），远端异常退出${tail}`)
        } else {
          host.fail('session_ended', `Kernel 已结束（${status}），会话需要重新启动${tail}`)
        }
        return
      }
      if (action === 'giveUp') {
        host.fail(
          'health_failed',
          `远端心跳连续丢失，且 Kernel 状态为 ${status ?? '未知'}；隧道可能已失效，请重新启动会话`,
        )
        return
      }
      host.reconnectAttempts += 1
      host.healthMisses = 0
      host.recoveringFromReady = true
      host.recoveryStartedAt = Date.now()
      host.session.endpointUrl = null
      host.session.state = 'connecting'
      host.session.phase = 'tunnel'
      host.session.detail = '远端心跳丢失，正在重新获取隧道地址'
      host.watch()
    } finally {
      host.livenessCheck = null
    }
  })()
  return host.livenessCheck
}

export async function pollKernelStatus(host) {
  if (host.disposed || !host.session.kernelId) return
  const epoch = host.epoch
  const kernelId = host.session.kernelId
  const result = await host.deps.kernelStatus(host.ctx, kernelId).catch((error) => {
    host.log.debug('轮询 Kernel 状态失败（下一拍重试）', error?.message ?? error)
    return null
  })
  if (!host.canPoll(epoch)) return
  if (!result?.ok) return
  if (result.status) host.session.kernelStatus = result.status

  if (!isKernelEnded(result.status)) return

  const logs = await host.deps.kernelLogs(host.ctx, kernelId).catch((error) => {
    host.log.debug('拉取 Kernel 日志失败（只影响结束原因文案）', error?.message ?? error)
    return null
  })
  if (!host.canPoll(epoch)) return

  const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
  // ready 状态下结束通常是空闲退出或远端崩溃；其余阶段结束说明启动没成功。
  if (result.status !== 'ERROR' && host.session.state === 'ready') {
    host.fail('session_ended', `Kernel 已结束（${result.status}），会话需要重新启动${tail}`)
  } else {
    host.fail('remote_error', `Kernel 已结束（${result.status}）${tail}`)
  }
}