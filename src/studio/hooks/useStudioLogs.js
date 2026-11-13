/**
 * 日志抽屉的数据域：打开时拉取远端日志并按游标增量轮询，关闭即停。
 *
 * 同一文件还提供 useHostSnapshot：日志诊断与算力弹层的配额回退都需要
 * `/state` 里 `probeLastGood` / `probeLastGoodAt` / `queue` 这些不在 compute
 * 领域对象内的字段，按需拉一次即可（打开弹层 / 抽屉时）。
 */

import React from 'react'

import { TIMEOUTS } from '../../../shared/contract.js'

import { fetchLogs, fetchState } from '../../api/resources.js'
import { appendLogLines, readLogsPayload } from '../../logic/logs.js'

/** 两段日志内容是否相同（hostLines 每次轮询都是新数组，相同内容不触发重渲染）。 */
function sameLines(previous, next) {
  if (previous.length !== next.length) return false
  return previous.every((line, index) => line === next[index])
}

/**
 * 两段诊断环境指纹是否相同：逐字段比较（含 timings 子对象），内容没变不触发重渲染。
 * 服务端按固定白名单顺序生成键，这里用集合兜底未知键，避免多余的一次渲染。
 */
function sameEnv(previous, next) {
  const left = previous && typeof previous === 'object' ? previous : {}
  const right = next && typeof next === 'object' ? next : {}
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (key === 'timings') continue
    if (left[key] !== right[key]) return false
  }
  const leftTimings = left.timings && typeof left.timings === 'object' ? left.timings : {}
  const rightTimings = right.timings && typeof right.timings === 'object' ? right.timings : {}
  const timingKeys = new Set([...Object.keys(leftTimings), ...Object.keys(rightTimings)])
  for (const key of timingKeys) {
    if (leftTimings[key] !== rightTimings[key]) return false
  }
  return true
}

/**
 * @param {boolean} open 抽屉是否打开；关闭时清理定时器并停止请求
 * @returns {{ status: 'idle'|'loading'|'ready'|'empty'|'unavailable',
 *             lines: string[], hostLines: string[],
 *             reason: { code: string, message: string } | null, env: object }}
 *   env 是 /logs 响应里的诊断环境指纹（白名单过滤后），供日志抽屉拼诊断文本。
 */
export function useStudioLogs(open) {
  const [status, setStatus] = React.useState('idle')
  const [lines, setLines] = React.useState([])
  // Host 本地日志尾部：每次轮询整段替换（不按游标累加，也不与远端 lines 混排）。
  const [hostLines, setHostLines] = React.useState([])
  const [reason, setReason] = React.useState(null)
  // 诊断环境指纹：内容不变时保留上一个对象，不触发重渲染。
  const [env, setEnv] = React.useState({})
  // 轮询回调不依赖渲染闭包：行缓冲、游标与环境指纹都放在 ref 里。
  const linesRef = React.useRef([])
  const hostLinesRef = React.useRef([])
  const envRef = React.useRef({})
  const sinceRef = React.useRef(0)

  React.useEffect(() => {
    if (!open) return undefined
    let alive = true
    let timer = null

    linesRef.current = []
    hostLinesRef.current = []
    envRef.current = {}
    sinceRef.current = 0
    setLines([])
    setHostLines([])
    setReason(null)
    setEnv({})
    setStatus('loading')

    const tick = async () => {
      timer = null
      const result = await fetchLogs(sinceRef.current)
      if (!alive) return
      const payload = readLogsPayload(result)
      if (payload.next !== null) sinceRef.current = payload.next
      const merged = appendLogLines(linesRef.current, payload.lines)
      if (merged !== linesRef.current) {
        linesRef.current = merged
        setLines(merged)
      }
      // hostLines 是固定长度的尾部快照：每次都用最新响应整体替换，内容没变就不重渲染。
      if (!sameLines(hostLinesRef.current, payload.hostLines)) {
        hostLinesRef.current = payload.hostLines
        setHostLines(payload.hostLines)
      }
      // 环境指纹同理：只有内容（含阶段耗时）变化才更新状态。
      if (!sameEnv(envRef.current, payload.env)) {
        envRef.current = payload.env
        setEnv(payload.env)
      }
      if (payload.ok) {
        setStatus(merged.length === 0 ? 'empty' : 'ready')
        setReason(null)
      } else {
        setStatus('unavailable')
        setReason(payload.reason)
      }
      // 单次请求可能已经用满超时；这里固定间隔，失败时也继续重试（隧道恢复后自动续上）。
      timer = setTimeout(tick, TIMEOUTS.clientLogsPollMs)
    }

    tick()
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [open])

  return { status, lines, hostLines, reason, env }
}

/**
 * 按需拉取一次宿主 /state 快照（不轮询）：enabled 由 false 变 true 时取最新值。
 * 失败时返回 null，调用方回退到已有的 compute 领域对象。
 */
export function useHostSnapshot(enabled) {
  const [snapshot, setSnapshot] = React.useState(null)

  React.useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    fetchState().then((result) => {
      if (!alive) return
      if (result && result.ok && result.data && typeof result.data === 'object') setSnapshot(result.data)
    })
    return () => {
      alive = false
    }
  }, [enabled])

  return snapshot
}