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
import {
  effectivePresetOf,
  formSummaryOf,
  generateCapabilityOf,
  generateSourcePolicy,
  iteratePatch,
  previewRecallOf,
  rerollOverrides,
  retryReferencePlan,
} from '../logic/generate.js'
import { inpaintOnlyOf } from '../logic/preset.js'
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

  /**
   * 提交生成。
   *
   * 来源策略统一在这里消费（`options.source`）：assistant / variant 强制纯文生图，
   * form / retry 沿用（或恢复出的）参考图；随后用「有效预设 + 有效参考图」做能力校验，
   * 不能用当前表单预设去误拦重试恢复出的、来自别的预设的带蒙版任务。
   */
  async function generate(overrides, options = {}) {
    if (sending) return false
    const policy = generateSourcePolicy(options.source, {
      overrides,
      preset: form.activePreset,
      presets,
    })
    if (!policy.ok) {
      ui.showToast(t(policy.blockedKey))
      return false
    }
    const effectivePreset = effectivePresetOf(policy.overrides, form.activePreset, presets)
    const hasReferenceOverride = Boolean(policy.overrides)
      && Object.prototype.hasOwnProperty.call(policy.overrides, 'reference')
    const effectiveReference = hasReferenceOverride ? policy.overrides.reference : form.reference
    // 参考图 / 蒙版与本次有效预设的能力不匹配时拦下：既不能悄悄丢掉参考图当文生图发出去，
    // 也不该把注定失败的请求交给宿主。提示里写明下一步（切模型或移除参考图）。
    const capability = generateCapabilityOf({
      preset: effectivePreset,
      presets,
      reference: effectiveReference,
    })
    if (!capability.ok) {
      ui.showToast(t(capability.noticeKey))
      return false
    }
    const body = form.buildBody(policy.overrides, { preset: effectivePreset })
    if (!body.prompt) {
      ui.fail('need_prompt', '')
      return false
    }
    // 来源策略的轻提示要在提交结果之后弹：成功提示会覆盖先前的 toast，否则用户看不到
    // 「本次已改用 X 文生图」这类关键说明。
    const showPolicyNotice = () => {
      if (policy.notice) ui.showToast(formatText(t(policy.notice.key), policy.notice.params))
    }
    // 提交时的表单对象：成功回来后只有它仍是当前表单，才记为干净基准。
    const submittedForm = form.form
    pendingRef.current = body
    setSending(true)
    ui.setError(null)
    try {
      const result = await alive(submitGenerate(body))
      if (!result) return false
      if (result.ok && result.data && result.data.id) {
        const jobId = result.data.id
        const entries = []
        // 表单提交同步进助手：除了提示词，再带一份结构化参数摘要（界面渲染成胶囊）。
        // 记录带 kind='form'：与普通用户气泡区分，且不进 intentHistory（见 logic/intent.js）。
        if (options.pushUser !== false) {
          entries.push({
            role: 'user',
            kind: 'form',
            source: options.source || 'form',
            text: body.prompt,
            summary: formSummaryOf(body),
          })
        }
        entries.push({ role: 'assistant', kind: 'job', jobId, stage: 'pending', text: t('studio.chat.pending') })
        chat.pushMessages(entries)
        // 刚提交的内容就是当前的干净版本：之后手动改动才算 dirty。
        // 等 chat 确认卡提交（pushUser=false）由 generateIntent 在表单补丁落地后再标记。
        if (options.pushUser !== false) form.markClean(submittedForm)
        host.refresh()
        // 历史只在任务完成后刷新（见 useWorkLibrary 的 lastJob effect）：
        // 刚提交的任务还没有产物，这里再拉一次会把已加载的分页重置回第一页。
        ui.showToast(t('studio.toast.submitted'))
        showPolicyNotice()
        return true
      }
      showPolicyNotice()
      ui.fail(result.code, result.message)
    } finally {
      // 卸载导致 alive 返回 null、或后续逻辑抛错时也必须复位，否则按钮永远停在「提交中」。
      setSending(false)
    }
    return false
  }

  /** 生成变体：基于当前选中的作品，而不是左侧表单。 */
  function reroll(entry) {
    const target = entry || library.selected
    const overrides = rerollOverrides(target, presets)
    if (!overrides) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides, { source: 'variant' })
  }

  /**
   * 带回参数：提示词与尺寸来自作品本身，steps/cfg 才用 params 或预设推荐值。
   * 回填同时清掉残留参考图，并把表单标记为「正在微调这张作品」。
   */
  function iterate(entry) {
    const target = entry || library.selected
    const patch = iteratePatch(target, form.form, presets)
    if (Object.keys(patch).length === 0) return
    form.applyRecall(patch, target)
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.showToast(t('studio.toast.recalled'))
  }

  /**
   * 创作区胶卷点击：始终切换右侧预览；表单干净时把该作品参数回填到左侧面板。
   *
   * 回填由纯逻辑按优先级判定（见 `previewRecallOf()`）：表单挂着参考图（含蒙版）时
   * 只换预览、绝不回填——涂好的蒙版一旦被隐式清掉，用户得从头再涂一遍；其次是未提交的
   * 手动修改（dirty）保护草稿；两者都没有才回填。画廊视图不接这个动作，保持纯浏览。
   */
  function previewWork(entry) {
    const target = entry && entry.image ? entry : null
    if (!target) return
    library.selectImage(target)
    const patch = iteratePatch(target, form.form, presets)
    const decision = previewRecallOf({ reference: form.reference, dirty: form.dirty, patch })
    if (decision.noticeKey) ui.showToast(t(decision.noticeKey))
    if (decision.action !== 'recall') return
    form.applyRecall(patch, target)
  }

  /**
   * 以此图重绘：把画廊作品设为参考图并切回创作视图。
   *
   * 预设是否支持垫图由表单域判断：不支持时自动切到支持的预设，toast 里说明切到了哪个；
   * 旧宿主一个支持的预设都没有时保持表单不变并明确提示（不把参考图塞给必然拒绝的宿主）。
   * 专用局部重绘权重只能带蒙版使用：设为参考图后直接请求进入涂抹态（见决策 4）。
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
    // 生效预设是专用局部重绘权重：自动进入涂抹，省掉再点一次「局部涂抹」。
    const effectivePreset = result.switchedPreset || form.activePreset
    if (inpaintOnlyOf(effectivePreset)) ui.requestPaint()
    if (result.switchedPreset) {
      const preset = result.switchedPreset
      const label = preset.label || preset.short || preset.id
      ui.showToast(formatText(t('studio.reference.switched'), { preset: label }))
      return
    }
    ui.showToast(t('studio.reference.applied'))
  }

  /**
   * 以此结果继续重绘：把该作品设为新参考图、清空蒙版、进入涂抹（见决策 5）。
   *
   * 选择不自动切换，避免打断用户对比；只有显式点击这个动作才换底图。
   * `applyReference()` 整块替换 reference，旧蒙版随之清掉，不需要再单独清。
   */
  function continueInpaint(entry) {
    const target = entry || library.selected
    const result = form.applyReference(target)
    if (!result || !result.ok) {
      const failedKey = result && result.reason === 'no_path' ? 'studio.reference.noPath' : 'studio.reference.unavailable'
      ui.showToast(t(failedKey))
      return false
    }
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.setZoom(false)
    ui.requestPaint()
    ui.showToast(t('studio.mask.continueHint'))
    return true
  }

  /**
   * 按失败任务原来的参数重试。
   *
   * 参考图的恢复计划由纯逻辑给出：任务本来没有参考图时显式纯文生图；
   * 有参考图且同源提交体还留着蒙版时直接恢复重试；蒙版已不可恢复时只把参考图填回
   * 表单并请求进入涂抹，不自动提交。没有可重试的任务时退回上一次提交的 body。
   */
  function retryFocusedJob() {
    const pending = pendingRef.current
    // 失败任务参数不完整（旧宿主）时退回上一次提交体，保持原有重试兜底。
    let plan = retryReferencePlan(control.focusedJob, { pendingRef: pending })
    if (!plan && pending) plan = retryReferencePlan(pending, { pendingRef: pending })
    if (!plan) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    if (plan.maskLost) {
      const applied = form.applyReference({ image: plan.fillReference })
      if (!applied || !applied.ok) {
        const failedKey = applied && applied.reason === 'no_path' ? 'studio.reference.noPath' : 'studio.reference.unavailable'
        ui.showToast(t(failedKey))
        return
      }
      ui.setView('studio')
      ui.setPanelMode('form')
      if (plan.requestPaint) ui.requestPaint()
      ui.showToast(t(plan.noticeKey))
      return
    }
    generate(plan.overrides, { source: 'retry' })
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
    guidance: { kind: guidanceKind, code: guidanceCode, surface: guidanceSurface, detail: guidanceDetail, key: guidanceKey, dismiss: dismissGuidance },
    actions: { sending, generate, previewWork, reroll, iterate, referenceImage, continueInpaint, retryFocusedJob, resetToSafe },
  }
}