/**
 * 会话控制域：宿主状态派生、会话启停、环境探测与配额、打开产物目录。
 *
 * 依赖入参：{ state, refresh, hostError, t, aliveRef, error, setError, showToast, fail }。
 * startSession 的 presetId 由组合层从表单取当前预设传入，避免与 form hook 循环依赖。
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

export function useSessionControl({ state, refresh, hostError, t, aliveRef, error, setError, showToast, fail }) {
  const [busy, setBusy] = React.useState('')
  const [probing, setProbing] = React.useState(false)
  const [probeReport, setProbeReport] = React.useState(null)

  const session = (state && state.session) || null
  const sessionState = (session && session.state) || 'absent'
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : []
  const defaultPreset = (state && state.defaultPreset) || ''
  const activeJob = activeJobOf(state)
  // 焦点任务：进行中优先，其次最近完成的，再次列表首个（历史任务的异常也要能出指引）。
  const focusedJob = activeJob || (state && state.lastJob) || stateJobs(state)[0] || null

  // 宿主状态轮询失败：当前已有更具体的错误时保留它，否则借现有 error/指引通道提示；
  // 按 code+message 去重，避免每 10 秒把同一失败重复弹一遍。
  const hostErrorKeyRef = React.useRef('')
  React.useEffect(() => {
    if (!hostError) return
    const key = `${hostError.code}|${hostError.message ?? ''}`
    if (hostErrorKeyRef.current === key) return
    hostErrorKeyRef.current = key
    setError((prev) => prev || { code: hostError.code, message: hostError.message ?? '' })
  }, [hostError])

  async function startSession(presetId) {
    if (busy) return
    setBusy('start')
    const result = await startSessionRequest(presetId)
    if (!aliveRef.current) return
    setBusy('')
    if (!result.ok) fail(result.code, result.message)
    refresh()
  }

  async function stopSession() {
    if (busy) return
    setBusy('stop')
    const result = await stopSessionRequest()
    if (!aliveRef.current) return
    setBusy('')
    if (!result.ok) fail(result.code, result.message)
    refresh()
  }

  /** 在系统文件管理器里打开产物目录。 */
  async function openFolder() {
    const result = await revealOutput()
    if (!aliveRef.current) return
    if (!result.ok) showToast(t('studio.toast.revealFailed'))
  }

  async function runProbe() {
    if (probing) return
    setProbing(true)
    // Host 的 /probe 会串行调用 kaggle CLI，首次检查约 20~30 秒；45 秒兜底，避免无限等待。
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUTS.clientProbeMs) : null
    let result
    try {
      result = await runProbeRequest(controller ? controller.signal : undefined)
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
    if (!aliveRef.current) return
    setProbing(false)
    // Host 固定回 HTTP 200，成败只能看 payload.ok / probe.auth.ok。
    if (!result.ok) {
      setProbeReport({ status: result.code === 'timeout' ? 'timeout' : 'failed', message: result.message, probe: null })
      showToast(result.code === 'timeout' ? t('studio.probe.timeout') : t('studio.probe.failed'))
      return
    }
    const outcome = probeOutcomeOf(result.data)
    if (outcome.ok) {
      setProbeReport({ status: 'ok', message: '', probe: outcome.probe })
      if (error && (error.code === 'cli_missing' || error.code === 'auth_required')) setError(null)
      showToast(t('studio.probe.ok'))
    } else {
      setProbeReport({ status: 'failed', message: outcome.detail, probe: outcome.probe })
      if (outcome.code === 'cli_missing' || outcome.code === 'auth_required') fail(outcome.code, outcome.detail)
      else showToast(t('studio.probe.failed'))
    }
    refresh()
  }

  return {
    session,
    sessionState,
    presets,
    defaultPreset,
    activeJob,
    focusedJob,
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