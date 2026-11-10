/**
 * 会话控制域：宿主状态派生、会话启停、环境探测与配额、打开产物目录。
 *
 * 依赖入参：{ t, host, ui, alive }。host 是宿主状态桥（state / error / refresh），
 * ui 提供 error 与 toast 通道，alive 是统一的卸载边界。
 * startSession 的 presetId 由组合层从表单取当前预设传入，避免与表单域循环依赖。
 */

import React from 'react'

import { TIMEOUTS } from '../../../shared/contract.js'

import {
  revealOutput,
  runProbe as runProbeRequest,
  startSession as startSessionRequest,
  stopSession as stopSessionRequest,
} from '../../api/resources.js'
import { activeJobOf, stateJobs } from '../../logic/jobs.js'
import { probeOutcomeOf } from '../../logic/probe.js'

export function useSessionControl({ t, host, ui, alive }) {
  const [busy, setBusy] = React.useState('')
  const [probing, setProbing] = React.useState(false)
  const [probeReport, setProbeReport] = React.useState(null)

  const state = host.state
  const session = (state && state.session) || null
  const sessionState = (session && session.state) || 'absent'
  const activeJob = activeJobOf(state)
  // 焦点任务：进行中优先，其次最近完成的，再次列表首个（历史任务的异常也要能出指引）。
  const focusedJob = activeJob || (state && state.lastJob) || stateJobs(state)[0] || null
  const queued =
    sessionState === 'provisioning' ||
    Boolean(activeJob && (activeJob.status === 'queued' || activeJob.status === 'waiting-session'))

  // 宿主状态轮询失败：当前已有更具体的错误时保留它，否则借现有 error/指引通道提示；
  // 按 code+message 去重，避免每 10 秒把同一失败重复弹一遍。
  const hostErrorKeyRef = React.useRef('')
  React.useEffect(() => {
    if (!host.error) return
    const key = `${host.error.code}|${host.error.message ?? ''}`
    if (hostErrorKeyRef.current === key) return
    hostErrorKeyRef.current = key
    ui.setError((prev) => prev || { code: host.error.code, message: host.error.message ?? '' })
  }, [host.error])

  async function startSession(presetId) {
    if (busy) return
    setBusy('start')
    const result = await alive(startSessionRequest(presetId))
    if (!result) return
    setBusy('')
    if (!result.ok) ui.fail(result.code, result.message)
    host.refresh()
  }

  async function stopSession() {
    if (busy) return
    setBusy('stop')
    const result = await alive(stopSessionRequest())
    if (!result) return
    setBusy('')
    if (!result.ok) ui.fail(result.code, result.message)
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
    let result
    try {
      result = await alive(runProbeRequest(controller.signal))
    } finally {
      clearTimeout(timer)
    }
    if (!result) return
    setProbing(false)
    // Host 固定回 HTTP 200，成败只能看 payload.ok / probe.auth.ok。
    if (!result.ok) {
      setProbeReport({ status: result.code === 'timeout' ? 'timeout' : 'failed', message: result.message, probe: null })
      ui.showToast(result.code === 'timeout' ? t('studio.probe.timeout') : t('studio.probe.failed'))
      return
    }
    const outcome = probeOutcomeOf(result.data)
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
  }

  return {
    session,
    sessionState,
    activeJob,
    focusedJob,
    queued,
    quota: (state && state.probe && state.probe.quota) || null,
    probe: (state && state.probe) || null,
    busy,
    probing,
    probeReport,
    startSession,
    stopSession,
    runProbe,
    openFolder,
  }
}