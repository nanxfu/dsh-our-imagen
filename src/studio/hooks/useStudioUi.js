/**
 * 工作台界面态域：视图 / 缩放 / 面板形态 / 折叠态 / Toast / 错误 / 剪贴板 /
 * 日志抽屉开关，以及页面隐藏期间的完成提醒。
 *
 * 只持有界面状态，不碰业务数据；error 只存 { code, message }，如何展示由组合层决定。
 */

import React from 'react'

import { TIMEOUTS } from '../../../shared/contract.js'

import { fetchState } from '../../api/resources.js'
import { KAGGLE_INSTALL_COMMAND } from '../../logic/guidance.js'
import { activeJobOf } from '../../logic/jobs.js'
import { completionNotice, isCompletion, stripNoticePrefix } from '../../logic/notice.js'

export function useStudioUi({ t, initialView, initialPanelMode }) {
  // 初始视图与面板形态可由 props 指定（预览与测试用），由组合层算好后传入。
  const [view, setView] = React.useState(initialView)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [negativeOpen, setNegativeOpen] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [dismissed, setDismissed] = React.useState('')
  const [toast, setToast] = React.useState(null)
  const [panelMode, setPanelMode] = React.useState(initialPanelMode)
  const [zoom, setZoom] = React.useState(false)
  const [logsOpen, setLogsOpen] = React.useState(false)
  // 打开日志抽屉前的焦点位置：关闭后还回去（通常是顶栏算力按钮）。
  const logsReturnRef = React.useRef(null)

  function showToast(text) {
    setToast({ text, id: Date.now() })
  }

  // 新的本地错误出现时，恢复之前被手动收起的指引卡。
  function fail(code, message) {
    setDismissed('')
    setError({ code, message: message ?? '' })
  }

  /** 收起指引卡：记下当前 code|detail，避免同一条错误立刻又弹回来。 */
  function dismissGuidance(guidanceKey) {
    if (guidanceKey) setDismissed(guidanceKey)
    setError(null)
  }

  // Toast 定时消失；卸载时清理定时器，回调不会在卸载后执行。
  React.useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  async function copyText(text, okKey) {
    const value = String(text ?? '').trim()
    if (!value) return
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value)
        showToast(t(okKey))
        return
      }
    } catch {
      // 非安全上下文或不给权限：退化为提示用户手动复制
    }
    showToast(value)
  }

  function copyPath(value) {
    return copyText(value, 'studio.toast.copied')
  }

  function copyInstallCommand() {
    return copyText(KAGGLE_INSTALL_COMMAND, 'studio.guidance.cli.copied')
  }

  /** 打开日志抽屉：记下触发按钮，关闭后把焦点还回去。 */
  function openLogs(trigger) {
    logsReturnRef.current = trigger || (document.activeElement || null)
    setLogsOpen(true)
  }

  function closeLogs() {
    setLogsOpen(false)
    const target = logsReturnRef.current
    logsReturnRef.current = null
    // 触发按钮可能已经随弹层卸载（isConnected 为 false），此时不强行聚焦。
    if (target && typeof target.focus === 'function' && target.isConnected !== false) target.focus()
  }

  return {
    view,
    setView,
    zoom,
    setZoom,
    panelMode,
    setPanelMode,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    toast,
    error,
    setError,
    dismissed,
    showToast,
    fail,
    dismissGuidance,
    copyText,
    copyPath,
    copyInstallCommand,
    logsOpen,
    openLogs,
    closeLogs,
  }
}

/**
 * 完成提醒：页面隐藏期间任务完成 → 标签页标题加「● 生成完成 · 」前缀；
 * 回到页面时恢复原标题并 toast 一次。首次挂载只记录基线，不提示。
 *
 * 宿主状态轮询在页面隐藏时会暂停，所以这里在「有进行中任务且页面隐藏」时
 * 用同样的活跃轮询间隔补一条轻量 /state 请求，才能及时改标题。
 */
export function useCompletionNotice({ t, ui, job, activeJob }) {
  // undefined = 还没挂载过；null = 已知的「无任务」快照。
  const previousRef = React.useRef(undefined)
  const pendingRef = React.useRef(false)
  const hiddenJobRef = React.useRef(null)
  const returningRef = React.useRef(null)
  const tRef = React.useRef(t)
  const uiRef = React.useRef(ui)
  tRef.current = t
  uiRef.current = ui

  const judge = React.useCallback((nextJob) => {
    const previous = previousRef.current
    previousRef.current = nextJob || null
    if (previous === undefined) return
    const decision = completionNotice({
      previous,
      next: nextJob,
      hidden: Boolean(document.hidden),
      title: document.title,
    })
    if (decision.notify) {
      pendingRef.current = true
      document.title = decision.title
      return
    }
    if (!decision.completed) return
    // 隐藏期间完成、但没赶上标题前缀（例如隐藏轮询失败）：回到页面后补一次 toast。
    if (returningRef.current && isCompletion(returningRef.current, nextJob)) {
      returningRef.current = null
      uiRef.current.showToast(tRef.current('studio.toast.generationDone'))
    }
  }, [])

  // 常规轮询带来的任务快照变化。
  React.useEffect(() => {
    judge(job)
  }, [judge, job && job.id, job && job.status, job && (job.finishedAt ?? '')])

  // 可见性切换：隐藏时补轮询，返回时恢复标题并提示。
  React.useEffect(() => {
    let timer = null
    let alive = true

    function stop() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    async function tick() {
      timer = null
      const result = await fetchState()
      if (!alive) return
      const state = result && result.ok && result.data && typeof result.data === 'object' ? result.data : null
      if (state) judge(state.lastJob || null)
      // 队列彻底空下来就停止补轮询；还有排队/生成任务时继续，直到用户回到页面。
      const busy = Boolean(activeJob) || Boolean(state && activeJobOf(state))
      if (alive && document.hidden && busy) timer = setTimeout(tick, TIMEOUTS.clientStateActivePollMs)
    }

    function rememberHidden() {
      hiddenJobRef.current = previousRef.current ?? null
    }

    function onVisibility() {
      if (document.hidden) {
        rememberHidden()
        if (activeJob && timer === null) tick()
        return
      }
      stop()
      const hiddenJob = hiddenJobRef.current
      hiddenJobRef.current = null
      if (pendingRef.current) {
        pendingRef.current = false
        returningRef.current = null
        document.title = stripNoticePrefix(document.title)
        uiRef.current.showToast(tRef.current('studio.toast.generationDone'))
        return
      }
      if (hiddenJob) returningRef.current = hiddenJob
    }

    document.addEventListener('visibilitychange', onVisibility)
    // 挂载时页面已在后台（例如从后台标签打开）也按隐藏处理，开始补轮询。
    if (document.hidden && activeJob) {
      rememberHidden()
      tick()
    }
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeJob && activeJob.id, judge])
}