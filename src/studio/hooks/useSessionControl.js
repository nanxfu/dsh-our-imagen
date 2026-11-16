/**
 * 会话控制域：宿主状态派生、会话启停、换新实例重排、任务取消、环境探测与配额、
 * 打开产物目录。
 *
 * 依赖入参：{ t, host, ui, alive }。host 是宿主状态桥（state / error / refresh），
 * ui 提供 error 与 toast 通道，alive 是统一的卸载边界。
 * startSession 的 presetId 由组合层从表单取当前预设传入，避免与表单域循环依赖。
 */

import React from 'react'

import { TIMEOUTS } from '../../../shared/contract.js'

import {
  cancelJob as cancelJobRequest,
  revealOutput,
  runProbe as runProbeRequest,
  startSession as startSessionRequest,
  stopSession as stopSessionRequest,
} from '../../api/resources.js'
import { formatText } from '../../logic/format.js'
import { pendingJobsOf, stateJobs } from '../../logic/jobs.js'
import { probeOutcomeOf } from '../../logic/probe.js'
import { transportOf } from '../../logic/probe.js'
import {
  queuePolicyOf,
  queueRoundKeyOf,
  queueStalledMinutesOf,
} from '../../logic/queue.js'
import { computeStatusOf } from '../../logic/status.js'
import { updateOf } from '../../logic/update.js'

/** 已发出取消请求、还没在宿主快照里收敛的任务 id；同一个 id 只保留一次。 */
function rememberCancelling(previous, id) {
  if (!Array.isArray(previous)) return [id]
  return previous.includes(id) ? previous : [...previous, id]
}

export function useSessionControl({ t, host, ui, alive }) {
  const [busy, setBusy] = React.useState('')
  const [probing, setProbing] = React.useState(false)
  const [probeReport, setProbeReport] = React.useState(null)
  const [cancellingIds, setCancellingIds] = React.useState([])
  // 与 cancellingIds 同步的集合：双击/重入时用它做同步判重，不依赖尚未提交的 state。
  const cancellingRef = React.useRef(new Set())
  // 启动/重排请求的同步判重：state 里的 busy 要等下一轮渲染才生效，双击仍会发两次请求。
  const startingRef = React.useRef(false)

  const state = host.state
  const session = (state && state.session) || null
  // 访问方式只影响展示与失败归类：旧宿主 / 旧快照缺字段时按契约默认的 cli 处理。
  const kaggleTransport = transportOf(state)
  const sessionState = (session && session.state) || 'absent'
  // 待执行队列：第 1 个是真正在跑（或等云端）的任务，其余按提交顺序排队。
  // 进度文案、舞台与底部胶片条都按这个顺序取「当前任务」，排队任务才不会被误当成进行中。
  const pendingJobs = pendingJobsOf(state)
  const activeJob = pendingJobs[0] ?? null
  // 焦点任务：进行中优先，其次最近完成的，再次列表首个（历史任务的异常也要能出指引）。
  const focusedJob = activeJob || (state && state.lastJob) || stateJobs(state)[0] || null
  // 排队分级阈值来自 /state.queuePolicy；旧宿主不下发时用契约默认值兜底。
  const queuePolicy = queuePolicyOf(state)
  // 云端展示状态（胶囊 / 状态条 / 弹层 / 对话页徽章共用）。
  // now 每次渲染取当前时刻：过渡态下 Studio 的 useNow 每秒触发重渲染，慢档提示会按时出现。
  const status = computeStatusOf(t, { session, queuePolicy, now: Date.now() })
  // 插件自身版本提示：只在「npm 上有更高版本」时非空（数据由宿主检查并缓存）。
  const update = updateOf(state)
  // 排队轮次键：10 分钟横幅按它去重，重排（新 startedAt）后可再次触发。
  const queue = {
    policy: queuePolicy,
    level: status.queueLevel,
    waitMs: status.queueWaitMs,
    key: queueRoundKeyOf(session),
    stalledMinutes: queueStalledMinutesOf(queuePolicy),
  }

  // 任务离开活动队列（已取消/已完成）后撤掉本地「取消中」标记；
  // 只要 pendingJobs 没变化就不更新状态，避免每次宿主轮询都触发一次重渲染。
  const pendingSignature = pendingJobs.map((job) => job.id).join(',')
  React.useEffect(() => {
    const activeIds = new Set(pendingJobs.map((job) => job.id))
    for (const id of [...cancellingRef.current]) {
      if (!activeIds.has(id)) cancellingRef.current.delete(id)
    }
    setCancellingIds((prev) => {
      const next = prev.filter((id) => activeIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [pendingSignature])

  // 宿主状态轮询失败：当前已有更具体的错误时保留它，否则借现有 error/指引通道提示；
  // 按 code+message 去重，避免每 10 秒把同一失败重复弹一遍。
  // 轮询恢复后要把这次网络错误撤掉——否则一张「Failed to fetch」卡片会一直挂在界面上。
  const hostErrorKeyRef = React.useRef('')
  const hostErrorCodeRef = React.useRef('')
  React.useEffect(() => {
    if (!host.error) {
      if (!hostErrorCodeRef.current) return
      const code = hostErrorCodeRef.current
      hostErrorKeyRef.current = ''
      hostErrorCodeRef.current = ''
      ui.setError((prev) => (prev && prev.code === code ? null : prev))
      return
    }
    const key = `${host.error.code}|${host.error.message ?? ''}`
    if (hostErrorKeyRef.current === key) return
    hostErrorKeyRef.current = key
    hostErrorCodeRef.current = host.error.code
    ui.setError((prev) => prev || { code: host.error.code, message: host.error.message ?? '' })
  }, [host.error])

  /**
   * 启动会话的公共请求：busy 或同一 tick 内重复点击都不再发请求；
   * options 原样交给资源层（forceNew / replace），旧宿主忽略未知字段即可。
   * 失败一律走现有 ui.fail 指引通道，客户端不吞错。
   */
  async function requestStart(presetId, options) {
    if (busy || startingRef.current) return
    startingRef.current = true
    setBusy('start')
    try {
      const result = await alive(startSessionRequest(presetId, options))
      if (!result) return
      if (!result.ok) ui.fail(result.code, result.message)
      else ui.setError(null)
      host.refresh()
    } finally {
      startingRef.current = false
      setBusy('')
    }
  }

  /** 唤醒 / 接管当前会话（默认优先接管仍在排队或运行的原 Kernel）。 */
  function startSession(presetId, options = {}) {
    return requestStart(presetId, options)
  }

  /**
   * 换新实例重排：Host 删除排不上的旧 Kernel 并推送新 Kernel（forceNew + replace）。
   * 旧 Host 不认识 replace 时只按普通启动处理，不产生额外错误提示。
   */
  function requeueSession(presetId) {
    return requestStart(presetId, { forceNew: true, replace: true })
  }

  async function stopSession() {
    if (busy) return
    setBusy('stop')
    try {
      const result = await alive(stopSessionRequest())
      if (!result) return
      if (!result.ok) ui.fail(result.code, result.message)
      host.refresh()
    } finally {
      setBusy('')
    }
  }

  /**
   * 取消任务：queued / waiting-session 立即出队；running 合作式停止（当前这张画完后停）。
   * 失败走错误/指引通道并撤掉本地「取消中」标记，成功立刻刷新宿主快照。
   */
  async function cancelJob(id) {
    const target = typeof id === 'string' ? id.trim() : ''
    if (!target || cancellingRef.current.has(target)) return
    cancellingRef.current.add(target)
    setCancellingIds((prev) => rememberCancelling(prev, target))
    const result = await alive(cancelJobRequest(target))
    if (!result) return
    if (!result.ok) {
      cancellingRef.current.delete(target)
      setCancellingIds((prev) => prev.filter((item) => item !== target))
      ui.fail(result.code, result.message)
      return
    }
    const job = result.data && result.data.job ? result.data.job : null
    const disposition = result.data && result.data.disposition
    // 任务在点击前已经收敛：不谎报「已取消」，刷新快照让卡片自然消失。
    if (disposition === 'already-finished') {
      host.refresh()
      return
    }
    const images = Array.isArray(job && job.output && job.output.images) ? job.output.images.length : 0
    const progressDone = Number(job && job.progress && job.progress.done)
    // 已经出完的图会保留：合作式停止时 output 还没落盘，已完成的张数在 progress.done 里。
    const kept = images > 0 ? images : Number.isFinite(progressDone) && progressDone > 0 ? Math.floor(progressDone) : 0
    if (kept > 0) ui.showToast(formatText(t('studio.toast.cancelPartial'), { done: kept }))
    else ui.showToast(t('studio.toast.cancelled'))
    host.refresh()
  }

  /** 在系统文件管理器里打开产物目录。 */
  async function openFolder() {
    const result = await alive(revealOutput())
    if (!result) return
    if (!result.ok) ui.showToast(t('studio.toast.revealFailed'))
  }

  async function runProbe() {
    if (probing) return
    setProbing(true)
    // Host 的 /probe 会串行调用 kaggle CLI，首次检查约 20~30 秒；45 秒兜底，避免无限等待。
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUTS.clientProbeMs)
    try {
      const result = await alive(runProbeRequest(controller.signal))
      if (!result) return
      // Host 固定回 HTTP 200，成败只能看 payload.ok / probe.auth.ok。
      if (!result.ok) {
        setProbeReport({ status: result.code === 'timeout' ? 'timeout' : 'failed', message: result.message, probe: null })
        ui.showToast(result.code === 'timeout' ? t('studio.probe.timeout') : t('studio.probe.failed'))
        return
      }
      const outcome = probeOutcomeOf(result.data, { transport: kaggleTransport })
      if (outcome.ok) {
        setProbeReport({ status: 'ok', message: '', probe: outcome.probe })
        if (ui.error && (ui.error.code === 'cli_missing' || ui.error.code === 'auth_required')) ui.setError(null)
        ui.showToast(t('studio.probe.ok'))
      } else {
        setProbeReport({ status: 'failed', message: outcome.detail, probe: outcome.probe })
        if (outcome.code === 'cli_missing' || outcome.code === 'auth_required') ui.fail(outcome.code, outcome.detail)
        else ui.showToast(t('studio.probe.failed'))
      }
      host.refresh()
    } finally {
      clearTimeout(timer)
      setProbing(false)
    }
  }

  return {
    session,
    sessionState,
    kaggleTransport,
    status,
    queue,
    update,
    pendingJobs,
    activeJob,
    focusedJob,
    quota: (state && state.probe && state.probe.quota) || null,
    probe: (state && state.probe) || null,
    busy,
    probing,
    probeReport,
    startSession,
    requeueSession,
    stopSession,
    cancelJob,
    cancellingIds,
    runProbe,
    openFolder,
  }
}
