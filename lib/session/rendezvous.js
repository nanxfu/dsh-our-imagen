/**
 * 隧道会合（ntfy 轮询）：URL 构造、NDJSON 解析、ready/error 事件归一、排队超时判定。
 *
 * 边界：只负责「怎么拿到并解释会合消息」。拿到 ready 之后把会话推进到握手阶段、
 * 超时后怎么写 error，都通过 host（SessionManager）的 startHealthLoop / fail 完成，
 * 本模块不挂健康轮询、不直接改定时器集合。
 *
 * 解析与判定尽量拆成纯函数（parseRendezvousLine / mapRendezvousError /
 * describeProvisionTimeout），便于离线断言。
 */

import { TIMEOUTS } from '../../shared/contract.js'
import { httpText } from '../net.js'
import { isTrustedEndpoint } from '../remote.js'
import { formatDuration } from './state.js'

/** ntfy 会合点的轮询 URL：一次取全部历史消息。 */
export function rendezvousUrl(ntfyBase, topic) {
  return `${ntfyBase}/${topic}/json?poll=1&since=all`
}

/**
 * 解析一行 ntfy NDJSON。
 *
 * @returns {{ kind: 'payload', payload: object } | { kind: 'skip' }
 *   | { kind: 'invalid-event', error: * } | { kind: 'invalid-payload', error: * }}
 *   payload：消息体是合法 JSON，可按 daemon 事件处理；
 *   skip：不是 daemon 消息（ntfy 自身的 open/keepalive 等），忽略；
 *   invalid-event：整行不是合法 JSON（协议漂移，调用方记 warn）；
 *   invalid-payload：外层合法但 message 不是 JSON（协议漂移，调用方记 warn）。
 */
export function parseRendezvousLine(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch (error) {
    return { kind: 'invalid-event', error }
  }
  if (event?.event !== 'message' || typeof event.message !== 'string') return { kind: 'skip' }
  try {
    return { kind: 'payload', payload: JSON.parse(event.message) }
  } catch (error) {
    return { kind: 'invalid-payload', error }
  }
}

/** daemon 的启动失败事件 → 宿主错误码与文案（tunnel_failed 归为隧道超时）。 */
export function mapRendezvousError(payload) {
  const remoteCode = String(payload?.code ?? 'remote_error')
  const code = remoteCode === 'tunnel_failed' ? 'tunnel_timeout' : 'remote_error'
  return {
    code,
    message: `远端启动失败（${remoteCode}）：${String(payload?.message ?? '无详情').slice(0, 400)}`,
  }
}

/**
 * 排队超时的错误码与文案（纯函数）。
 * 区分「还在排队」与「容器已启动但没收到会合消息」：后者是隧道/ntfy 失败，
 * 文案必须指向正确方向，否则用户会以为只是排队慢。
 */
export function describeProvisionTimeout({ kernelStatus, provisionTimeoutMs, logTail = '' }) {
  const containerUp = Boolean(kernelStatus) && kernelStatus !== 'PENDING' && kernelStatus !== 'QUEUED'
  if (containerUp) {
    return {
      code: 'tunnel_timeout',
      message: `等待会合超时（${formatDuration(provisionTimeoutMs)}）：Kernel 已处于 ${kernelStatus}，但没有收到隧道地址（ntfy / cloudflared 可能失败）${logTail}`,
    }
  }
  return {
    code: 'queue_timeout',
    message: `等待 GPU 超时（${formatDuration(provisionTimeoutMs)}），Kernel 仍在队列中（${kernelStatus ?? '状态未知'}）${logTail}`,
  }
}

/**
 * 会合轮询的一拍：处理超时判定与 ntfy 消息。
 *
 * @param {object} host SessionManager 实例
 */
export async function pollTunnel(host) {
  if (host.disposed || host.session.state === 'error' || host.session.endpointUrl) return
  const epoch = host.epoch
  // ready 之后隧道重建失败时不能一直挂在 connecting 状态（旧逻辑要等 60 分钟）。
  if (
    host.recoveringFromReady &&
    host.recoveryStartedAt > 0 &&
    Date.now() - host.recoveryStartedAt > host.options.recoveryTimeoutMs
  ) {
    if (host.isStale(epoch)) return
    host.fail(
      'health_failed',
      `隧道失联后 ${formatDuration(host.options.recoveryTimeoutMs)}内未能重新会合（Kernel 状态 ${host.session.kernelStatus ?? '未知'}），请重新启动会话`,
    )
    return
  }
  if (host.session.state === 'provisioning' && host.elapsedMs() > host.options.provisionTimeoutMs) {
    const kernelId = host.session.kernelId
    const logs = kernelId
      ? await host.deps.kernelLogs(host.ctx, kernelId).catch((error) => {
          host.log.debug('拉取 Kernel 日志失败（只影响超时原因文案）', error?.message ?? error)
          return null
        })
      : null
    if (host.isStale(epoch)) return
    const tail = logs?.tail ? `\n${logs.tail.slice(-400)}` : ''
    const decision = describeProvisionTimeout({
      kernelStatus: host.session.kernelStatus,
      provisionTimeoutMs: host.options.provisionTimeoutMs,
      logTail: tail,
    })
    host.fail(decision.code, decision.message)
    return
  }
  if (host.session.state === 'connecting' && host.elapsedMs() > host.options.provisionTimeoutMs + host.options.tunnelTimeoutMs) {
    if (host.isStale(epoch)) return
    host.fail('tunnel_timeout', '隧道握手超时：Kernel 已启动但未拿到可访问地址，请重启会话或查看远端日志')
    return
  }

  const url = rendezvousUrl(host.options.ntfyBase, host.secret.topic)
  const res = await httpText(host.ctx, url, {
    timeoutMs: TIMEOUTS.ntfyPollMs,
    headers: { accept: 'application/x-ndjson' },
  }).catch((error) => {
    // 会合阶段单次轮询失败是常态（ntfy 慢 / 暂无消息），交给下一拍重试。
    host.log.debug('ntfy 会合轮询失败（预期内）', error?.message ?? error)
    return null
  })
  if (!host.canPoll(epoch) || host.session.endpointUrl) return
  if (!res?.ok) return

  for (const line of res.text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseRendezvousLine(trimmed)
    if (parsed.kind === 'invalid-event') {
      host.log.warn('会合消息不是合法 JSON（协议可能已漂移）', parsed.error?.message ?? parsed.error)
      continue
    }
    if (parsed.kind === 'skip') continue
    if (parsed.kind === 'invalid-payload') {
      host.log.warn('会合消息负载解析失败（协议可能已漂移）', parsed.error?.message ?? parsed.error)
      continue
    }
    const payload = parsed.payload
    if (payload?.type === 'error') {
      // daemon 在隧道/依赖/预加载失败时会先发 error 事件再退出。
      // 以前这里只认 ready，导致 Host 一直等到 45 分钟 queue_timeout，归因完全错误。
      const decision = mapRendezvousError(payload)
      host.fail(decision.code, decision.message)
      return
    }
    if (payload?.type !== 'ready') continue
    if (!isTrustedEndpoint(payload.endpoint)) continue
    // 幂等：并发的两次轮询可能拿到同一条 ready，已在握手中的 endpoint 不重复处理。
    if (host.session.endpointUrl === payload.endpoint) continue

    host.session.endpointUrl = payload.endpoint
    host.session.modelId = payload.model_id ?? host.session.modelId
    host.session.device = payload.device ?? host.session.device
    host.session.state = 'connecting'
    host.session.phase = 'tunnel'
    host.session.detail = '隧道已建立，正在握手'
    host.startHealthLoop()
    return
  }
}