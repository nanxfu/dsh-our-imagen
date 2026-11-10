/**
 * 隧道会合（ntfy）消息解析与判定（纯函数）。
 *
 * 只负责「怎么解释一条会合消息」：URL 构造、NDJSON 解析、ready/error 事件归一、
 * 排队超时判定。轮询节奏与状态写入由 SessionManager.pollTunnel 负责。
 */

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