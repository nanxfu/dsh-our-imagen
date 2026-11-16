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
import { guidanceDetailOf, guidanceKindOf, guidanceSurfaceOf, isConnectionCode } from '../logic/guidance.js'
import { formatText } from '../logic/format.js'
import { iteratePatch, rerollOverrides, retryOverrides } from '../logic/generate.js'
import { safeResetPatch } from '../../shared/models-guide.js'
import { accountStatusOf } from '../logic/probe.js'
import { useChatThread } from './hooks/useChatThread.js'
import { useKaggleLogin } from './hooks/useKaggleLogin.js'
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
  // 10 分钟排队横幅的关闭记忆：值为轮次键（startedAt|presetId），同一轮排队只弹一次。
  const [dismissedQueueKey, setDismissedQueueKey] = React.useState('')
  // 直连登录会话：成功（done）后重跑一次 probe，把账号与配额状态刷成最新。
  // CLI 模式下 hook 不会发起任何请求（指引卡使用原有「复制登录命令」动作）。
  const kaggleLogin = useKaggleLogin({ t, ui, onDone: () => control.runProbe() })
  const form = useStudioForm({ t, isEn, alive, ui, preset: { presets, defaultPreset }, initialPrompt })
  // generate 是函数声明（提升），chat 在事件回调里调用时已完成初始化。
  const chat = useChatThread({ t, isEn, alive, state, form, generate })
  const library = useWorkLibrary({ t, alive, ui, state })

  /** 启动会话（默认优先检查并接管仍在排队/运行的原 Kernel）。 */
  function startSession() {
    return control.startSession(form.form.presetId || defaultPreset)
  }

  /**
   * 换新实例重排：跳过接管、删除排不上的旧 Kernel 后推送新 Kernel。
   * busy / 同一 tick 内的重复点击由 useSessionControl 判重，失败走 ui.fail。
   */
  function requeueSession() {
    return control.requeueSession(form.form.presetId || defaultPreset)
  }

  // 排队卡住（10 分钟档）横幅：非错误态通道，只对当前排队轮次弹一次。
  // 「继续等待」只收起卡片、不影响会话；「换新实例重排」收起后发起 replace 请求。
  // 重排成功会换新的 startedAt，新轮次（若仍卡住）可再次触发。
  const queue = control.queue
  const queueNotice = queue.level === 'stalled' && queue.key && queue.key !== dismissedQueueKey
    ? {
        minutes: queue.stalledMinutes,
        dismiss: () => setDismissedQueueKey(queue.key),
        requeue: () => {
          setDismissedQueueKey(queue.key)
          return requeueSession()
        },
      }
    : null

  // 组件层拿到的云端域：宿主派生状态 + 启停动作，startSession 已绑定当前表单预设。
  const compute = {
    ...control,
    presets,
    defaultPreset,
    startSession,
    requeueSession,
    queueNotice,
    retryHost,
    kaggleLogin,
  }

  async function generate(overrides, options = {}) {
    if (sending) return
    // 参考图与当前预设的能力不匹配时拦下本次生成：既不能悄悄丢掉参考图当文生图发出去，
    // 也不该把注定失败的请求交给宿主。提示里写明下一步（切模型或移除参考图）。
    if (form.referenceBlocked) {
      ui.showToast(t('studio.reference.blocked'))
      return
    }
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
        // 历史只在任务完成后刷新（见 useWorkLibrary 的 lastJob effect）：
        // 刚提交的任务还没有产物，这里再拉一次会把已加载的分页重置回第一页。
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

  /**
   * 以此图重绘：把画廊作品设为参考图并切回创作视图。
   *
   * 预设是否支持垫图由表单域判断：不支持时自动切到支持的预设，toast 里说明切到了哪个；
   * 旧宿主一个支持的预设都没有时保持表单不变并明确提示（不把参考图塞给必然拒绝的宿主）。
   */
  function referenceImage(entry) {
    const target = entry || library.selected
    const result = form.applyReference(target)
    if (!result || !result.ok) {
      // 旧记录缺 image.path 与「宿主一个支持垫图的预设都没有」要分开说清楚。
      const failedKey = result && result.reason === 'no_path' ? 'studio.reference.noPath' : 'studio.reference.unavailable'
      ui.showToast(t(failedKey))
      return
    }
    ui.setView('studio')
    ui.setPanelMode('form')
    // 从大图预览触发时一并收起放大层，用户能直接看到左侧参考图槽位。
    ui.setZoom(false)
    if (result.switchedPreset) {
      const preset = result.switchedPreset
      const label = preset.label || preset.short || preset.id
      ui.showToast(formatText(t('studio.reference.switched'), { preset: label }))
      return
    }
    ui.showToast(t('studio.reference.applied'))
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

  /** OOM 指引卡上的「重置参数」：表单回到当前活跃预设的安全默认档，并清掉当前错误。 */
  function resetToSafe() {
    const safe = safeResetPatch(form.activePreset)
    form.patchForm(safe)
    if (guidanceKey) ui.dismissGuidance(guidanceKey)
    else ui.setError(null)
    ui.showToast(formatText(t('studio.guidance.oom.reset'), { size: safe.width, steps: safe.steps }))
  }

  /** 降级指引卡上的「重试」：先收起到期提示，再立刻拉一次宿主状态。 */
  function retryHost() {
    if (guidanceKey) ui.dismissGuidance(guidanceKey)
    else ui.setError(null)
    host.refresh()
  }

  function dismissGuidance() {
    ui.dismissGuidance(guidanceKey)
  }

  // 异常指引：操作失败优先，其次是会话错误，最后是当前任务的错误。
  const rawGuidanceCode =
    (ui.error && ui.error.code) ||
    (control.session && control.session.error && control.session.error.code) ||
    (control.focusedJob && control.focusedJob.status === 'failed' && control.focusedJob.error && control.focusedJob.error.code) ||
    ''
  // 账号已被证明确实可用（探测通过或会话能跑）时，不再因旧快照里的 auth_required / cli_missing
  // 弹登录卡——直连模式下刚登录成功、旧会话错误还没被覆盖时最容易出现这种自相矛盾的提示。
  const authProven = accountStatusOf(control.probe, control.sessionState) === 'ok'
  const suppressAuth = authProven && (rawGuidanceCode === 'auth_required' || rawGuidanceCode === 'cli_missing')
  const guidanceCode = suppressAuth ? '' : rawGuidanceCode
  // 网络层错误不展示浏览器原文（"Failed to fetch" 对用户没有信息量），
  // 换成客户端自己的可读文案；其它错误仍以 Host/远端的原文为准。
  const guidanceDetail = isConnectionCode(guidanceCode)
    ? t('error.network')
    : guidanceDetailOf({ error: ui.error, session: control.session, job: control.focusedJob })
  const guidanceKey = guidanceCode ? `${guidanceCode}|${guidanceDetail}` : ''
  const guidanceKind = guidanceCode && ui.dismissed !== guidanceKey ? guidanceKindOf(guidanceCode) : ''
  const guidanceSurface = guidanceSurfaceOf(guidanceKind)

  return {
    t,
    isEn,
    ui,
    compute,
    form,
    chat,
    library,
    guidance: { kind: guidanceKind, code: guidanceCode, surface: guidanceSurface, detail: guidanceDetail, dismiss: dismissGuidance },
    actions: { sending, generate, reroll, iterate, referenceImage, retryFocusedJob, resetToSafe },
  }
}