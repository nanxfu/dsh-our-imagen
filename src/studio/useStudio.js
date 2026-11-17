/**
 * 生图工作台的数据编排（组合层）。
 *
 * 域 hook 各管一块状态，这里只做宿主状态桥接、跨域动作粘合（生成、变体、回填、重试、
 * 指引计算）与领域对象组装。对外返回按领域分组：
 *   { t, ui, compute, form, chat, library, imageTool, guidance, actions }
 *
 * 0.13.0 起主表单只做纯文生图；针对舞台作品的图片处理（局部涂抹 / 整图重绘）
 * 由独立的 `imageTool` 域承载，组合层只负责动作入口与视图切换。
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
  iteratePatch,
  presetLabelOf,
  previewRecallOf,
  rerollOverrides,
  retryOverrides,
} from '../logic/generate.js'
import { safeResetPatch } from '../../shared/models-guide.js'
import { accountStatusOf } from '../logic/probe.js'
import { useChatThread } from './hooks/useChatThread.js'
import { useImageTool } from './hooks/useImageTool.js'
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
  // 舞台图片工具域：底图 / 提示词 / 强度 / 蒙版 / 工具预设全部独立于左栏表单。
  const imageTool = useImageTool({
    t,
    isEn,
    alive,
    ui,
    presets,
    defaultPreset,
    // 工具优先沿用左栏当前模型（支持对应能力时），但不回写左栏。
    currentPresetId: form.form.presetId,
    onSubmitted: () => host.refresh(),
  })
  // generate 是函数声明（提升），chat 在事件回调里调用时已完成初始化。
  const chat = useChatThread({ t, isEn, alive, state, form, generate })
  const library = useWorkLibrary({ t, alive, ui, state })

  /**
   * 显式新建绘图（阶段十三）：重置表单 + 进入 new_draft 焦点。
   *
   * 入口沿用 Rail 顶部的「新建创作」按钮（它调用 form.newCreation），这里把 form 的
   * newCreation 包装成「重置表单 + 切新建态」；同时暴露 actions.newDraft 供其它入口使用。
   * 表单域本身不感知工作区焦点，避免 hook 之间互相依赖。
   */
  function newDraft() {
    // 新建画布与「正在编辑某张作品」互斥：先退出工具编辑态（未提交草稿仍保存在 workDrafts）。
    imageTool.closeTool()
    form.newCreation()
    library.newDraft()
    ui.setView('studio')
    ui.setPanelMode('form')
  }
  const formView = { ...form, newCreation: newDraft }

  /**
   * 组件层拿到的作品库视图（阶段十三）：
   * 在 useWorkLibrary 领域对象上补 Filmstrip 需要的草稿表与新建草稿卡数据，
   * 这样 Gallery / Stage / Filmstrip 仍共用同一个 library props，Studio.jsx 不需要改动。
   */
  const libraryView = {
    ...library,
    newDraftCard: {
      active: library.workspaceMode === 'new_draft',
      pending: library.newDraftPending === true,
      width: form.form.width,
      height: form.form.height,
      presetLabel: form.activePreset ? presetLabelOf(form.activePreset) : '',
      prompt: form.form.prompt,
    },
    // 工具域的未提交编辑草稿：缩略图圆点 / 版本面板圆点与清空都用这一份。
    workDrafts: imageTool.workDrafts,
    clearWorkDraft: imageTool.clearWorkDraft,
    workDraftSummary: imageTool.workDraftSummary,
  }

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
   * 提交生成（纯文生图）。
   *
   * 主表单 / 助手 / 变体 / 重试都只做文生图：参考图与蒙版由舞台图片工具自己的提交路径
   * 负责，不再经过这里，也不会从表单或覆盖项里被带出来。
   *
   * 专用局部重绘预设（`inpaintOnly`）不能文生图：本次请求改用兜底预设并轻提示（决策 D3），
   * 左栏表单保持用户选择不变。
   */
  async function generate(overrides, options = {}) {
    if (sending) return false
    const effectivePreset = effectivePresetOf(overrides, form.activePreset, presets)
    const capability = generateCapabilityOf({ preset: effectivePreset, presets })
    if (!capability.ok) {
      ui.showToast(t(capability.blockedKey))
      return false
    }
    const requestPreset = capability.preset || effectivePreset
    const body = form.buildBody(overrides, { preset: requestPreset })
    if (!body.prompt) {
      ui.fail('need_prompt', '')
      return false
    }
    // 兜底切换的轻提示要在提交结果之后再弹：成功提示会覆盖先前的 toast，
    // 否则用户看不到「本次已改用 X 文生图」这类关键说明。
    const showPolicyNotice = () => {
      if (capability.notice) ui.showToast(formatText(t(capability.notice.key), capability.notice.params))
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
        // 显式新建绘图：保持 new_draft 直到该任务完成，完成后再切 work 并选中新图。
        if (library.workspaceMode === 'new_draft') library.markNewDraftSubmitted(jobId)
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
   * 回填同时把表单标记为「正在微调这张作品」。
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
   * 回填由纯逻辑按优先级判定（见 `previewRecallOf()`）：未提交的手动修改（dirty）保护草稿，
   * 否则回填。参考图 / 蒙版已迁到舞台图片工具，不再参与这里的判定。
   * 画廊视图不接这个动作，保持纯浏览。
   */
  function previewWork(entry) {
    const target = entry && entry.image ? entry : null
    if (!target) return
    library.selectImage(target)
    const patch = iteratePatch(target, form.form, presets)
    const decision = previewRecallOf({ dirty: form.dirty, patch })
    if (decision.noticeKey) ui.showToast(t(decision.noticeKey))
    if (decision.action !== 'recall') return
    form.applyRecall(patch, target)
  }

  /**
   * 一步直达舞台图片工具（决策 D4）。
   *
   * 默认以当前选中的作品为底图；从画廊 / 大图预览触发时由调用方传入条目。
   * 工具会自动选模（不改左栏表单）；没有可处理的底图或没有可用垫图预设时，
   * `openTool` 自己 toast 说明并返回 false，这里不切换视图。
   *
   * @param {'inpaint'|'img2img'} kind 工具 id
   * @param {object} [entry] 胶卷 / 画廊条目 `{ image, item }`；缺省用当前选中作品
   * @returns {boolean} 是否成功进入编辑态
   */
  function openImageTool(kind, entry) {
    const target = entry || library.selected
    if (!target) {
      ui.showToast(t('studio.imageTool.blockedTarget'))
      return false
    }
    // D4：「选中该作品 + 切回舞台 + 打开工具」三步语义一致——退出工具后舞台停在该作品上。
    // 传裸 image 对象时包成条目；selectImage 同时会把工作区焦点从 new_draft 切回 work。
    library.selectImage(target.image ? target : { image: target })
    if (!imageTool.openTool(kind, target)) return false
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.setZoom(false)
    return true
  }

  /**
   * 按失败任务原来的参数重试（纯文生图）。
   *
   * 图片工具任务的失败恢复由 `useImageTool` 自己的草稿机制负责（决策 D5），
   * 这里不能把带底图 / 蒙版的任务压成文生图重放：检测到 reference 参数时只给指引。
   * 没有可重试的任务时退回上一次提交的 body。
   */
  function retryFocusedJob() {
    const pending = pendingRef.current
    const focused = control.focusedJob
    const focusedParams = focused && focused.params && typeof focused.params === 'object' ? focused.params : null
    if (focusedParams && focusedParams.reference) {
      ui.showToast(t('studio.imageTool.retryMoved'))
      return
    }
    const overrides = retryOverrides(focused) || (pending ? retryOverrides(pending) : null)
    if (!overrides) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides, { source: 'retry' })
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
    form: formView,
    chat,
    library: libraryView,
    imageTool,
    guidance: { kind: guidanceKind, code: guidanceCode, surface: guidanceSurface, detail: guidanceDetail, key: guidanceKey, dismiss: dismissGuidance },
    actions: { sending, generate, newDraft, previewWork, reroll, iterate, openImageTool, retryFocusedJob, resetToSafe },
  }
}
