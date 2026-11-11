/**
 * 生图工作台的数据编排（组合层）。
 *
 * 5 个域 hook 各管一块状态，这里只做宿主状态桥接、跨域动作粘合（生成、变体、回填、重试、
 * 指引计算）与领域对象组装。对外返回按领域分组：
 *   { t, ui, compute, form, chat, library, guidance, actions }
 *
 * effect 顺序：宿主轮询 → 卸载边界 → Toast 定时 → 宿主错误消费 → 预设同步 → 线程同步
 * → 历史/收藏加载 → 首图提示 → 任务完成刷新历史。
 */

import React from 'react'

import { submitGenerate } from '../api/resources.js'
import { useHostState } from '../hooks/useHostState.js'
import { translator } from '../i18n.js'
import { guidanceDetailOf, guidanceKindOf } from '../logic/guidance.js'
import { iteratePatch, rerollOverrides, retryOverrides } from '../logic/generate.js'
import { useChatThread } from './hooks/useChatThread.js'
import { useSessionControl } from './hooks/useSessionControl.js'
import { useStudioForm } from './hooks/useStudioForm.js'
import { useStudioUi } from './hooks/useStudioUi.js'
import { useWorkLibrary } from './hooks/useWorkLibrary.js'

/**
 * 组件卸载边界：域 hook 里的异步流程统一 `const result = await alive(request)`；
 * 卸载后 alive 返回 null，调用方直接 return。
 */
function useAlive() {
  const ref = React.useRef(true)
  React.useEffect(() => {
    ref.current = true
    return () => {
      ref.current = false
    }
  }, [])
  return React.useCallback(async (promise) => {
    const value = await promise
    return ref.current ? value : null
  }, [])
}

export function useStudio(props) {
  const t = translator(props)
  const isEn = !/^zh/i.test(String(document.documentElement.lang || 'en'))
  const host = useHostState()
  const alive = useAlive()
  const state = host.state

  // 预览与测试用的初始值在组合层解析，域 hook 只接收结果。
  const initialPrompt = props && typeof props.initialPrompt === 'string' ? props.initialPrompt : ''
  const initialView = props && props.view === 'gallery' ? 'gallery' : 'studio'
  const initialPanelMode = props && props.panelMode === 'chat' ? 'chat' : 'form'

  // 宿主下发的预设配置：表单同步与顶栏展示共用同一份。
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : []
  const defaultPreset = (state && state.defaultPreset) || ''

  const [sending, setSending] = React.useState(false)
  // 上一次提交的 body，失败任务没有参数时作为「重试一次」的兜底来源。
  const pendingRef = React.useRef(null)

  const ui = useStudioUi({ t, initialView, initialPanelMode })
  const control = useSessionControl({ t, host, ui, alive })
  const form = useStudioForm({ t, isEn, alive, ui, preset: { presets, defaultPreset }, initialPrompt })
  // generate 是函数声明（提升），chat 在事件回调里调用时已完成初始化。
  const chat = useChatThread({ t, isEn, alive, state, form, generate })
  const library = useWorkLibrary({ t, alive, ui, state })

  /** 启动会话：预设 id 取自当前表单，默认值来自宿主状态。 */
  function startSession() {
    return control.startSession(form.form.presetId || defaultPreset)
  }

  // 组件层拿到的云端域：宿主派生状态 + 启停动作，startSession 已绑定当前表单预设。
  const compute = { ...control, presets, defaultPreset, startSession }

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
    try {
      const result = await alive(submitGenerate(body))
      if (!result) return
      if (result.ok && result.data && result.data.id) {
        const jobId = result.data.id
        const entries = []
        if (options.pushUser !== false) entries.push({ role: 'user', text: body.prompt })
        entries.push({ role: 'assistant', kind: 'job', jobId, stage: 'pending', text: t('studio.chat.pending') })
        chat.pushMessages(entries)
        host.refresh()
        library.loadHistory()
        ui.showToast(t('studio.toast.submitted'))
        return
      }
      ui.fail(result.code, result.message)
    } finally {
      // 卸载导致 alive 返回 null、或后续逻辑抛错时也必须复位，否则按钮永远停在「提交中」。
      setSending(false)
    }
  }

  /** 生成变体：基于当前选中的作品，而不是左侧表单。 */
  function reroll(entry) {
    const target = entry || library.selected
    const overrides = rerollOverrides(target, presets)
    if (!overrides) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides)
  }

  /** 带回参数：提示词与尺寸来自作品本身，steps/cfg 才用 params 或预设推荐值。 */
  function iterate(entry) {
    const target = entry || library.selected
    const patch = iteratePatch(target, form.form, presets)
    if (Object.keys(patch).length === 0) return
    form.patchForm(patch)
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.showToast(t('studio.toast.recalled'))
  }

  /** 按失败任务原来的参数重试；没有任务时退回上一次提交的 body。 */
  function retryFocusedJob() {
    const overrides = retryOverrides(control.focusedJob)
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
    ui.showToast(t('studio.guidance.oom.reset'))
  }

  function dismissGuidance() {
    ui.dismissGuidance(guidanceKey)
  }

  // 异常指引：操作失败优先，其次是会话错误，最后是当前任务的错误。
  const guidanceCode =
    (ui.error && ui.error.code) ||
    (control.session && control.session.error && control.session.error.code) ||
    (control.focusedJob && control.focusedJob.status === 'failed' && control.focusedJob.error && control.focusedJob.error.code) ||
    ''
  const guidanceDetail = guidanceDetailOf({ error: ui.error, session: control.session, job: control.focusedJob })
  const guidanceKey = guidanceCode ? `${guidanceCode}|${guidanceDetail}` : ''
  const guidanceKind = guidanceCode && ui.dismissed !== guidanceKey ? guidanceKindOf(guidanceCode) : ''

  return {
    t,
    isEn,
    ui,
    compute,
    form,
    chat,
    library,
    guidance: { kind: guidanceKind, detail: guidanceDetail, dismiss: dismissGuidance },
    actions: { sending, generate, reroll, iterate, retryFocusedJob, resetToSafe },
  }
}