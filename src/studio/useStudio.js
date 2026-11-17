/**
 * 生图工作台的数据编排（组合层）。
 *
 * 域 hook 各管一块状态，这里只做宿主状态桥接、跨域动作粘合（生成、重新生成、回填与草稿托管、
 * 重试、指引计算）与领域对象组装。对外返回按领域分组：
 *   { t, ui, compute, form, chat, library, imageTool, guidance, actions }
 *
 * 0.13.0 起主表单只做纯文生图；针对舞台作品的图片处理（局部涂抹 / 整图重绘）
 * 由独立的 `imageTool` 域承载，组合层只负责动作入口与视图切换。
 *
 * 阶段十五 Phase A1：胶片条点击不再被 dirty 拦截——`previewWork` 先把未提交修改托管进
 * 最左端草稿卡（`form.parkDraft`），再回填目标作品；点草稿卡走 `form.openDraft` 恢复，
 * 「还原原图」走 `restoreOriginal`（参数恢复 + 清草稿 + 回到来源作品）。
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
import { useColabLogin, useKaggleLogin } from './hooks/useKaggleLogin.js'
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
  const initialWorkspaceMode = props && props.workspaceMode === 'work' ? 'work' : 'new_draft'

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
  // Colab Google OAuth 登录会话：成功后刷新一次 /state 同步 colabAuth 摘要。
  const colabLogin = useColabLogin({ t, ui, onDone: () => host.refresh() })
  const form = useStudioForm({ t, isEn, alive, ui, preset: { presets, defaultPreset }, initialPrompt })
  // 舞台图片工具域：底图 / 提示词 / 强度 / 蒙版 / 工具预设全部独立于左栏表单。
  const imageTool = useImageTool({
    t,
    alive,
    ui,
    presets,
    defaultPreset,
    // 工具优先沿用左栏当前模型（支持对应能力时），但不回写左栏。
    currentPresetId: form.form.presetId,
    // 阶段十五 A2：舞台图片工具提交成功后，把动作镜像进助手线程（kind 记录不进 intentHistory）。
    onSubmitted: (job, meta) => {
      if (meta && typeof meta === 'object') {
        chat.mirrorTool({ job, tool: meta.tool, target: meta.target, body: meta.body })
      }
      host.refresh()
    },
  })
  // generate 是函数声明（提升），chat 在事件回调里调用时已完成初始化。
  const chat = useChatThread({ t, isEn, alive, state, form, generate })
  const library = useWorkLibrary({ t, alive, ui, state, initialWorkspaceMode })

  /**
   * 点击底部新建画布卡：进入新建画布焦点。
   *
   * 阶段十五 Phase A1 起这里也是「草稿卡」的入口（§6.1.4）：
   *  - 草稿槽里有托管草稿 → 恢复草稿内容并进入草稿编辑态，舞台取景框提示「源自：…」；
   *  - 只有未提交修改 → 当前表单就是草稿，先托管再进入编辑态；
   *  - 两者都没有 → 与原来一致，切到新建画布（保留当前表单内容）。
   * 同时收起图片工具编辑态。
   */
  function focusNewDraft() {
    imageTool.closeTool()
    form.openDraft()
    library.focusDraft()
    ui.setView('studio')
    ui.setPanelMode('form')
  }

  /**
   * 显式新建绘图（阶段十三）：重置表单 + 进入 new_draft 焦点。
   *
   * 入口沿用 Rail 顶部的「新建创作」按钮（它调用 form.newCreation），这里把 form 的
   * newCreation 包装成「重置表单 + 切新建态」；同时暴露 actions.newDraft 供其它入口使用。
   * 表单域本身不感知工作区焦点，避免 hook 之间互相依赖。
   */
  function newDraft() {
    // 新建画布与「正在编辑某张作品」互斥：先退出工具编辑态（未提交草稿仍保存在 workDrafts）；
    // 表单侧的来源作品与托管草稿由 form.newCreation() 一并清掉（§6.1.7）。
    imageTool.closeTool()
    form.newCreation()
    library.newDraft()
    ui.setView('studio')
    ui.setPanelMode('form')
  }
  const formView = { ...form, newCreation: newDraft }

  /**
   * 组件层拿到的作品库视图（阶段十三/十五）：
   * 在 useWorkLibrary 领域对象上补 Filmstrip 需要的草稿表与新建草稿卡数据，
   * 这样 Gallery / Stage / Filmstrip 仍共用同一个 library props，Studio.jsx 不需要改动。
   *
   * 阶段十五 A1：`draft` 相关字段描述「未提交草稿」托管态（§6.1.2~§6.1.4）：
   *  - `draft`：是否有未提交草稿（草稿槽已托管，或当前工作区的脏修改会进草稿卡）；
   *  - `draftFrom`：来源作品的提示词（有来源时才展示「源自此图」）；
   *  - `draftEditing`：当前表单是否正在编辑草稿（点草稿卡恢复后）。
   */
  const draftView = form.draftView
  const draftSource = draftView && draftView.source ? draftView.source : null
  const draftPrompt = draftSource && typeof draftSource.prompt === 'string' ? draftSource.prompt.trim() : ''
  const libraryView = {
    ...library,
    newDraftCard: {
      active: library.workspaceMode === 'new_draft',
      explicit: library.newDraftExplicit === true,
      pending: library.newDraftPending === true,
      width: form.form.width,
      height: form.form.height,
      presetLabel: form.activePreset ? presetLabelOf(form.activePreset) : '',
      prompt: form.form.prompt,
      // 草稿托管态：dirty 时草稿卡实时出现；已托管的草稿点了就恢复。
      // 舞台保持展示来源作品（work 焦点）时不闪空，只有点草稿卡才切到 new_draft 取景框。
      draft: Boolean(draftView && draftView.active) && (Boolean(draftView.parked) || library.workspaceMode === 'work'),
      draftFrom: draftPrompt,
      draftFromSource: Boolean(draftSource),
      draftEditing: Boolean(draftView && draftView.editing),
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
    provider: (state && state.provider) || (control.session && control.session.provider) || 'kaggle',
    colabAuth: (state && state.colabAuth) || null,
    colabLogin,
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
        if (options.pushUser !== false && form.markClean(submittedForm)) {
          // 草稿已经随这次提交发布出去：清掉草稿卡（§6.1.6），后续任务完成自动切新图。
          form.clearDraft()
        }
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

  /** 重新生成：按当前选中作品的提示词与参数、换随机种子再抽一张纯文生图（产生新 v1）。 */
  function reroll(entry) {
    const target = entry || library.selected
    // 高清放大等非扩散产物的参数不可信：传入已加载条目与当前预设，让它回溯父作品的扩散参数。
    const overrides = rerollOverrides(target, presets, library.items, form.activePreset)
    if (!overrides) {
      ui.showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides, { source: 'variant' })
  }

  /**
   * 胶片条 / 画廊点击作品：始终切换右侧预览，并把该作品的原始参数回填到左侧面板。
   *
   * 阶段十五 Phase A1（§6.1.1/§6.1.3）：不再因为 dirty 拦截回填——未提交修改先被托管进
   * 最左端草稿卡（已有草稿则覆盖），再回填目标作品的干净基准，并给「已保留当前草稿」提示。
   * 参考图 / 蒙版已迁到舞台图片工具，不参与这里的判定。
   */
  function previewWork(entry) {
    const target = entry && entry.image ? entry : null
    if (!target) return
    // 高清放大等非扩散产物不直接回填：沿 sourceImage 找到父作品的真实扩散参数（找不到走降级补丁）。
    const patch = iteratePatch(target, form.form, presets, library.items)
    const decision = previewRecallOf({
      dirty: form.dirty,
      hasDraft: Boolean(form.draft),
      patch,
    })
    // 先在原焦点上托管（草稿编辑态切走时同样要留下最新内容），再切换预览与回填。
    if (decision.park || form.draftEditing) form.parkDraft()
    library.selectImage(target)
    if (decision.noticeKey) ui.showToast(t(decision.noticeKey))
    if (decision.action !== 'recall') return
    form.applyRecall(patch, target)
  }

  /**
   * 还原原图（§6.1.5）：放弃当前未提交草稿，恢复来源作品的原始参数并回到该作品。
   *
   * 表单参数与干净基准由 `useStudioForm.restoreOriginal()` 恢复；这里负责清草稿后的
   * 预览焦点（work 焦点回到来源作品）与提示。
   *
   * @returns {boolean} 是否真的还原了（没有来源 / 没有可还原字段时为 false）
   */
  function restoreOriginal() {
    const source = form.restoreOriginal()
    if (!source) return false
    const path = source && typeof source.path === 'string' ? source.path : ''
    if (path) library.selectImage({ image: { path } })
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.setZoom(false)
    ui.showToast(t('studio.toast.restoredOriginal'))
    return true
  }

  /**
   * 一步直达舞台图片工具（决策 D4）。
   *
   * 默认以当前选中的作品为底图；从画廊 / 大图预览触发时由调用方传入条目。
   * 工具会自动选模（不改左栏表单）；没有可处理的底图或没有可用垫图预设时，
   * `openTool` 自己 toast 说明并返回 false，这里不切换视图。
   * 高清放大是即时工具：`openTool` 直接提交、不进入编辑态，这里的视图切换照常执行。
   *
   * @param {'inpaint'|'img2img'|'upscale'|'outpaint'} kind 工具 id
   * @param {object} [entry] 胶卷 / 画廊条目 `{ image, item }`；缺省用当前选中作品
   * @returns {boolean} 是否成功打开（即时工具为是否已发起提交）
   */
  function openImageTool(kind, entry) {
    const target = entry || library.selected
    if (!target) {
      ui.showToast(t('studio.imageTool.blockedTarget'))
      return false
    }
    // 离开草稿编辑焦点：先把最新修改托管进草稿槽（§6.1.3 的同一套托管语义）。
    if (form.draftEditing) form.parkDraft()
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
   * 本地导入完成（阶段十五 Phase A3）：把导入作品切到舞台焦点并刷新历史。
   *
   * 图片已由 Host 落盘为独立 v1（见 SPEC §2.3 `/import`），前端不伪造历史条目：只切焦点、
   * 关闭对比层、给成功提示，再重新拉一次历史，把新目录并入胶片条与版本树。
   * PNG 内嵌生成元数据时提示「可在胶片条点这张图回填」，参数恢复仍由点作品触发的回填完成。
   */
  function activateImport(entry) {
    const target = entry && entry.image ? entry : null
    if (!target) return false
    imageTool.closeTool()
    if (form.draftEditing) form.parkDraft()
    library.selectImage(target)
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.setZoom(false)
    ui.setCompareOpen(false)
    const generation = entry.generation && typeof entry.generation === 'object' ? entry.generation : null
    ui.showToast(t(generation ? 'studio.import.metaFound' : 'studio.import.done'))
    if (typeof library.loadHistory === 'function') library.loadHistory()
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
  // Colab 只能由 colabAuth / 会话就绪自证，不能被 Kaggle 的 probe 误压制。
  const isColabActive = (state && state.provider === 'colab') || (control.session && control.session.provider === 'colab')
  const authProven = isColabActive
    ? Boolean((state && state.colabAuth && state.colabAuth.authorized === true) || control.sessionState === 'ready')
    : accountStatusOf(control.probe, control.sessionState) === 'ok'
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
    actions: {
      sending,
      generate,
      newDraft,
      focusNewDraft,
      previewWork,
      reroll,
      openImageTool,
      activateImport,
      restoreOriginal,
      retryFocusedJob,
      resetToSafe,
    },
  }
}
