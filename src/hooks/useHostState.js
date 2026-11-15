/** 轮询 Host 状态（模块级共享订阅 store）；有进行中的任务时加快节奏。 */

import { TIMEOUTS } from '../../shared/contract.js'

import { React } from '../runtime.js'
import { fetchState } from '../api/resources.js'
import { activeJobOf } from '../logic/jobs.js'

const EMPTY_SNAPSHOT = { state: null, error: null }

let snapshot = EMPTY_SNAPSHOT
const subscribers = new Set()
let timer = null
let generation = 0
let inFlight = false
let listeningVisibility = false

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function notify() {
  for (const listener of [...subscribers]) listener(snapshot)
}

async function tick() {
  timer = null
  if (subscribers.size === 0 || document.hidden || inFlight) return
  inFlight = true
  const myGen = generation
  let result
  try {
    result = await fetchState()
  } finally {
    if (myGen === generation) inFlight = false
  }
  if (subscribers.size === 0 || myGen !== generation) return
  let delay = TIMEOUTS.clientStatePollMs
  if (result.ok && result.data && typeof result.data === 'object') {
    snapshot = { state: result.data, error: null }
    delay = activeJobOf(result.data) ? TIMEOUTS.clientStateActivePollMs : TIMEOUTS.clientStatePollMs
  } else {
    snapshot = { state: snapshot.state, error: { code: result.code, message: result.message } }
  }
  notify()
  if (subscribers.size > 0 && myGen === generation && !document.hidden) {
    timer = setTimeout(tick, delay)
  }
}

function onVisible() {
  if (document.hidden) {
    clearTimer()
    return
  }
  clearTimer()
  tick()
}

function refresh() {
  if (subscribers.size === 0) return
  generation += 1
  inFlight = false
  clearTimer()
  tick()
}

function subscribe(listener) {
  const first = subscribers.size === 0
  subscribers.add(listener)
  if (!first) return
  if (!listeningVisibility) {
    document.addEventListener('visibilitychange', onVisible)
    listeningVisibility = true
  }
  tick()
}

function unsubscribe(listener) {
  subscribers.delete(listener)
  if (subscribers.size > 0) return
  resetHostStateStore()
}

/** 清理共享轮询并复位快照（最后一个订阅者卸载或测试隔离时调用）。 */
export function resetHostStateStore() {
  clearTimer()
  generation += 1
  inFlight = false
  if (listeningVisibility) {
    document.removeEventListener('visibilitychange', onVisible)
    listeningVisibility = false
  }
  snapshot = EMPTY_SNAPSHOT
}

export function useHostState() {
  const [current, setCurrent] = React.useState(() => snapshot)

  React.useEffect(() => {
    subscribe(setCurrent)
    setCurrent(snapshot)
    return () => unsubscribe(setCurrent)
  }, [])

  return { state: current.state, error: current.error, refresh }
}
