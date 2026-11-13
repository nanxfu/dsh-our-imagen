/**
 * Kaggle 直连登录的会话管理（试验特性）。
 *
 * 一次登录会话的生命周期：
 *   start()  —— POST `{ action: 'start' }`，收到 pending 后按契约 KAGGLE_LOGIN.pollMs 轮询 GET；
 *   submit() —— manual 模式粘贴授权码：POST `{ action: 'submit-code', code }`，之后继续轮询；
 *   cancel() —— POST `{ action: 'cancel' }` 并停止轮询，回到可重新发起；
 *   reset()  —— 本地回到 idle（不发请求）。
 *
 * 停止条件：done / failed / cancelled / 契约 timeoutMs 超时 / 请求失败一次。
 * 网络失败只提示一次并停止轮询，不做无限重试；页面隐藏或组件卸载时清理定时器，
 * 回到前台且登录仍在进行中时恢复轮询（超时仍按本地起点计算）。
 *
 * 依赖入参 { t, ui, onDone }：t 是翻译函数，ui 提供 showToast，onDone 在 done 时回调
 * （组合层用它重跑一次 probe 刷新账号/配额状态）。
 */

import React from 'react'

import { KAGGLE_LOGIN } from '../../../shared/contract.js'

import {
  cancelKaggleLogin,
  fetchKaggleLogin,
  startKaggleLogin,
  submitKaggleLoginCode,
} from '../../api/resources.js'
import {
  emptyLoginView,
  isLoginPending,
  loginFailureKey,
  loginTimedOut,
  loginViewOf,
  validateLoginCode,
} from '../../logic/kaggleLogin.js'

/** 登录相关的一次性失败提示键。 */
const NETWORK_ERROR_KEY = 'studio.guidance.auth.reason.network'
const REQUEST_ERROR_KEY = 'studio.guidance.auth.reason.request'
const UNAVAILABLE_ERROR_KEY = 'studio.guidance.auth.reason.unavailable'
const TIMEOUT_ERROR_KEY = 'studio.guidance.auth.reason.timeout'

export function useKaggleLogin({ t, ui, onDone } = {}) {
  const translate = typeof t === 'function' ? t : (key) => key
  const [login, setLogin] = React.useState(emptyLoginView)
  const [busy, setBusy] = React.useState(false)
  // 卡片上展示的失败原因字典键（本地网络失败 / 超时），由视图里的 message 兜底更具体的原因。
  const [errorKey, setErrorKey] = React.useState('')
  // 授权码输入框的本地校验提示键。
  const [codeErrorKey, setCodeErrorKey] = React.useState('')

  const timerRef = React.useRef(null)
  const startedAtRef = React.useRef(0)
  // 请求在途标记：与 busy state 同步的 ref，双击时不必等重渲染就能拒绝重入。
  const busyRef = React.useRef(false)
  // 会话代号：每次 start / cancel / reset 递增，旧轮询的回包直接丢弃。
  const sessionRef = React.useRef(0)
  const aliveRef = React.useRef(true)
  // 最新视图（可见性恢复时判断是否继续轮询），不参与渲染。
  const viewRef = React.useRef(emptyLoginView())
  const onDoneRef = React.useRef(onDone)
  onDoneRef.current = onDone

  function toast(key) {
    if (ui && typeof ui.showToast === 'function') ui.showToast(translate(key))
  }

  function markBusy(next) {
    busyRef.current = next
    setBusy(next)
  }

  function stopPolling() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function schedulePoll(token) {
    if (timerRef.current !== null || !aliveRef.current || sessionRef.current !== token) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      tick(token)
    }, KAGGLE_LOGIN.pollMs)
  }

  function commitView(view, token) {
    if (!aliveRef.current || sessionRef.current !== token) return false
    viewRef.current = view
    setLogin(view)
    setErrorKey('')
    return true
  }

  /** 失败收敛：停止轮询、置 failed 并只提示一次。 */
  function failOnce(key, token) {
    if (!aliveRef.current || (token !== undefined && sessionRef.current !== token)) return
    stopPolling()
    const base = viewRef.current && typeof viewRef.current === 'object' ? viewRef.current : emptyLoginView()
    const view = { ...base, state: 'failed', message: null, finishedAt: new Date().toISOString() }
    viewRef.current = view
    setLogin(view)
    setErrorKey(key)
    toast(key)
  }

  /** 请求结果不是契约形状：按状态码区分「接口不可用」与一般失败。 */
  function failFromResult(result, token) {
    const code = result && typeof result.code === 'string' ? result.code : ''
    const status = result && Number.isFinite(result.status) ? result.status : 0
    if (status === 404 || code === 'http_404') failOnce(UNAVAILABLE_ERROR_KEY, token)
    else if (code === 'network') failOnce(NETWORK_ERROR_KEY, token)
    else failOnce(REQUEST_ERROR_KEY, token)
  }

  function applyTerminalOrPending(view, token) {
    if (!commitView(view, token)) return
    if (view.state === 'done') {
      stopPolling()
      if (typeof onDoneRef.current === 'function') onDoneRef.current(view)
      toast('studio.guidance.auth.loginDone')
      return
    }
    if (!isLoginPending(view)) {
      stopPolling()
      return
    }
    schedulePoll(token)
  }

  async function tick(token) {
    if (!aliveRef.current || sessionRef.current !== token) return
    // 客户端超时兜底：超过契约 timeoutMs 不再轮询，卡片给出可重试的失败态。
    if (loginTimedOut(startedAtRef.current, Date.now())) {
      failOnce(TIMEOUT_ERROR_KEY, token)
      return
    }
    const result = await fetchKaggleLogin()
    if (!aliveRef.current || sessionRef.current !== token) return
    const view = loginViewOf(result)
    if (!view) {
      failFromResult(result, token)
      return
    }
    applyTerminalOrPending(view, token)
  }

  /** 发起登录：宿主返回 pending 后开始轮询；已是终态则直接收敛。 */
  async function start() {
    if (busyRef.current) return
    const token = sessionRef.current + 1
    sessionRef.current = token
    stopPolling()
    markBusy(true)
    setErrorKey('')
    setCodeErrorKey('')
    const result = await startKaggleLogin()
    if (!aliveRef.current || sessionRef.current !== token) return
    markBusy(false)
    const view = loginViewOf(result)
    if (!view) {
      failFromResult(result, token)
      return
    }
    startedAtRef.current = Date.now()
    if (!commitView(view, token)) return
    if (view.state === 'done') {
      stopPolling()
      if (typeof onDoneRef.current === 'function') onDoneRef.current(view)
      toast('studio.guidance.auth.loginDone')
      return
    }
    if (isLoginPending(view)) schedulePoll(token)
  }

  /** 取消等待：无论宿主是否成功响应，本地都收敛为可重新发起。 */
  async function cancel() {
    const token = sessionRef.current + 1
    sessionRef.current = token
    stopPolling()
    markBusy(true)
    const result = await cancelKaggleLogin()
    if (!aliveRef.current || sessionRef.current !== token) return
    markBusy(false)
    const view = loginViewOf(result)
    const base = view || viewRef.current || emptyLoginView()
    const cancelled = {
      ...base,
      state: 'cancelled',
      message: null,
      finishedAt: new Date().toISOString(),
    }
    viewRef.current = cancelled
    setLogin(cancelled)
    setErrorKey('')
    setCodeErrorKey('')
    toast('studio.guidance.auth.cancelled')
  }

  /** 提交授权码：本地校验通过才发请求，仍处于 pending 时继续轮询。 */
  async function submit(raw) {
    const check = validateLoginCode(raw)
    if (!check.ok) {
      setCodeErrorKey(check.message)
      return false
    }
    setCodeErrorKey('')
    if (busyRef.current) return false
    markBusy(true)
    const result = await submitKaggleLoginCode(check.code)
    if (!aliveRef.current) return false
    markBusy(false)
    const view = loginViewOf(result)
    if (!view) {
      failOnce(NETWORK_ERROR_KEY)
      return false
    }
    applyTerminalOrPending(view, sessionRef.current)
    return true
  }

  /** 本地重置：停止轮询并回到 idle，不发请求。 */
  function reset() {
    sessionRef.current += 1
    stopPolling()
    viewRef.current = emptyLoginView()
    setLogin(viewRef.current)
    markBusy(false)
    setErrorKey('')
    setCodeErrorKey('')
  }

  // 页面隐藏时停表，卸载时清理；回到前台且仍在等待授权则恢复轮询。
  React.useEffect(() => {
    aliveRef.current = true
    function onVisibility() {
      if (document.hidden) {
        stopPolling()
        return
      }
      if (isLoginPending(viewRef.current)) schedulePoll(sessionRef.current)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      aliveRef.current = false
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return {
    login,
    // pending = 登录会话仍在进行（请求在途或等待授权），用于禁用重复发起。
    pending: busy || isLoginPending(login),
    busy,
    errorKey: errorKey || loginFailureKey(login),
    codeErrorKey,
    start,
    cancel,
    submit,
    reset,
  }
}
