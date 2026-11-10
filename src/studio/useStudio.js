/**
 * 生图工作台的数据编排（组合层）。
 *
 * 5 个域 hook 分别负责界面态 / 表单 / 会话 / 作品库 / 对话线程；
 * 这里只做宿主状态桥接、跨域动作粘合（生成、变体、回填、重试、指引计算）与返回对象拼装。
 * 对外形状与拆分前完全一致，Studio.jsx 不感知拆分。
 *
 * effect 顺序：宿主轮询 → 卸载标记 → Toast 定时 → 宿主错误消费 → 预设同步 → 线程同步
 * → 历史/收藏加载 → 首图提示 → 任务完成刷新历史。
 */

import React from 'react'

import { submitGenerate } from '../api/resources.js'
import { useHostState } from '../hooks/useHostState.js'
import { translator } from '../i18n.js'
import { guidanceDetailOf, guidanceKindOf } from '../logic/guidance.js'
import { iteratePatch, rerollOverrides, retryOverrides } from '../logic/recall.js'
import { useChatThread } from './hooks/useChatThread.js'
import { useSessionControl } from './hooks/useSessionControl.js'
import { useStudioForm } from './hooks/useStudioForm.js'
import { useStudioUi } from './hooks/useStudioUi.js'
import { useWorkLibrary } from './hooks/useWorkLibrary.js'

export function useStudio(props) {
  const t = translator(props)
  const isEn = !/^zh/i.test(String((typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en'))
  const host = useHostState()
  const state = host.state
  const refresh = host.refresh
  const hostError = host.error

  // 预览与测试用的初始值在组合层解析，域 hook 只接收结果。
  const initialPrompt = props && typeof props.initialPrompt === 'string' ? props.initialPrompt : ''
  const initialView = props && props.view === 'gallery' ? 'gallery' : 'studio'
  const initialPanelMode = props && props.panelMode === 'chat' ? 'chat' : 'form'

  // 卸载标记：所有域 hook 共用同一个 ref，异步回调返回时据此放弃 setState。
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const [sending, setSending] = React.useState(false)
  // 上一次提交的 body，失败任务没有参数时作为「重试一次」的兜底来源。
  const pendingRef = React.useRef(null)

  const ui = useStudioUi({ t, aliveRef, initialView, initialPanelMode })
  const session = useSessionControl({
    state,
    refresh,
    hostError,
    t,
    aliveRef,
    error: ui.error,
    setError: ui.setError,
    showToast: ui.showToast,
    fail: ui.fail,
  })
  const form = useStudioForm({
    presets: session.presets,
    defaultPreset: session.defaultPreset,
    t,
    isEn,
    aliveRef,
    showToast: ui.showToast,
    fail: ui.fail,
    initialPrompt,
  })
  // generate 是函数声明（提升），chat 在事件回调里调用时已完成初始化。
  const chat = useChatThread({
    state,
    t,
    isEn,
    aliveRef,
    form: form.form,
    patchForm: form.patchForm,
    generate,
  })
  const library = useWorkLibrary({
    state,
    t,
    aliveRef,
    showToast: ui.showToast,
    fail: ui.fail,
    setView: ui.setView,
    setZoom: ui.setZoom,
  })

  async function generate(overrides, options = {}) {
    if (sending) return
    const body = form.buildBody(overrides)
    if (!body.prompt) {
      ui.fail('need_prompt', '')
      return
    }
    pendingRef.current = body
    setSending(true)
    ui.setError(null)
    const result = await submitGenerate(body)
    if (!aliveRef.current) return
    setSending(false)
    if (result.ok && result.data && result.data.id) {
      const jobId = result.data.id
      const entries = []
      if (options.pushUser !== false) entries.push({ role: 'user', text: body.prompt })
      entries.push({ role: 'assistant', kind: 'job', jobId, stage: 'pending', text: t('studio.chat.pending') })
      chat.pushMessages(entries)
      refresh()
      library.loadHistory()
      ui.showToast(t('studio.toast.submitted'))
      return
    }
    ui.fail(result.code, result.message)
  }

  /** 生成变体：基于当前选中的作品，而不是左侧表单。 */
  function reroll(entry) {
    const target = entry || library.selected
    const overrides = rerollOverrides(target, session.presets)
    if (!overrides) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides)
  }

  /** 带回参数：提示词与尺寸来自作品本身，steps/cfg 才用 params 或预设推荐值。 */
  function iterate(entry) {
    const target = entry || library.selected
    const patch = iteratePatch(target, form.form, session.presets)
    if (Object.keys(patch).length === 0) return
    form.patchForm(patch)
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.showToast(t('studio.toast.recalled'))
  }

  /** 按失败任务原来的参数重试；没有任务时退回上一次提交的 body。 */
  function retryFocusedJob() {
    const overrides = retryOverrides(session.focusedJob)
      || (pendingRef.current ? retryOverrides(pendingRef.current) : null)
    if (!overrides) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides)
  }

  /** OOM 指引卡上的「重置参数」：表单回到安全档，并清掉当前错误。 */
  function resetToSafe() {
    form.patchForm({ width: 1024, height: 1024, steps: 4, cfg: 1 })
    ui.setError(null)
    ui.showToast(t('studio.guidance.oom.action'))
  }

  /** 启动会话：预设 id 取自当前表单，默认值来自宿主状态。 */
  function startSession() {
    return session.startSession(form.form.presetId || session.defaultPreset)
  }

  const sessionQueued =
    session.sessionState === 'provisioning' ||
    Boolean(session.activeJob && (session.activeJob.status === 'queued' || session.activeJob.status === 'waiting-session'))

  const preset = session.presets.find((item) => item.id === form.form.presetId) || null

  // 异常指引：操作失败优先，其次是会话错误，最后是当前任务的错误。
  const guidanceCode =
    (ui.error && ui.error.code) ||
    (session.session && session.session.error && session.session.error.code) ||
    (session.focusedJob && session.focusedJob.status === 'failed' && session.focusedJob.error && session.focusedJob.error.code) ||
    ''
  const guidanceDetail = guidanceDetailOf({ error: ui.error, session: session.session, job: session.focusedJob })
  const guidanceKey = guidanceCode ? `${guidanceCode}|${guidanceDetail}` : ''
  const guidanceKind = guidanceCode && ui.dismissed !== guidanceKey ? guidanceKindOf(guidanceCode) : ''

  function dismissGuidance() {
    ui.dismissGuidance(guidanceKey)
  }

  return {
    guidanceKind,
    guidanceDetail,
    dismissGuidance,
    batches: library.batches,
    quota: session.quota,
    probe: session.probe,
    probing: session.probing,
    probeReport: session.probeReport,
    panelMode: ui.panelMode,
    setPanelMode: ui.setPanelMode,
    messages: chat.messages,
    interpreting: chat.interpreting,
    interpret: chat.interpret,
    resolveClarify: chat.resolveClarify,
    generateIntent: chat.generateIntent,
    openFolder: session.openFolder,
    zoomImage: library.zoomImage,
    clearThread: chat.clearThread,
    openMessage: library.openMessage,
    sessionQueued,
    resetToSafe,
    runProbe: session.runProbe,
    exportPaths: library.exportPaths,
    t,
    view: ui.view,
    setView: ui.setView,
    session: session.session,
    sessionState: session.sessionState,
    presets: session.presets,
    preset,
    activeJob: session.activeJob,
    focusedJob: session.focusedJob,
    gallery: library.gallery,
    selected: library.selected,
    selectImage: library.selectImage,
    form: form.form,
    patchForm: form.patchForm,
    styleId: form.styleId,
    applyStyle: form.applyStyle,
    ratioId: form.ratioId,
    applyRatio: form.applyRatio,
    advancedOpen: ui.advancedOpen,
    setAdvancedOpen: ui.setAdvancedOpen,
    negativeOpen: ui.negativeOpen,
    setNegativeOpen: ui.setNegativeOpen,
    sending,
    busy: session.busy,
    error: ui.error,
    toast: ui.toast,
    showToast: ui.showToast,
    favorites: library.favorites,
    isFavorite: library.isFavorite,
    toggleFavorite: library.toggleFavorite,
    deleteImages: library.deleteImages,
    refineGroups: form.refineGroups,
    refineSource: form.refineSource,
    enhancing: form.enhancing,
    enhance: form.enhance,
    toggleRefine: form.toggleRefine,
    useInspiration: form.useInspiration,
    zoom: ui.zoom,
    setZoom: ui.setZoom,
    historyDone: library.historyDone,
    generate,
    reroll,
    iterate,
    retryFocusedJob,
    copyPath: ui.copyPath,
    copyInstallCommand: ui.copyInstallCommand,
    startSession,
    stopSession: session.stopSession,
    loadHistory: library.loadHistory,
  }
}