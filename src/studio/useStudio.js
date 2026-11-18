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
 * 阶段十五 Phase C0：焦点与来源「同源收口」全部走 `recallTarget()` 这一个口径——
 * 胶片条 / 画廊 / 助手结果图 / 导入完成 / 删除后的回退都先按需托管草稿、再回填参数与
 * `origin`，并统一退出舞台画布编辑态；裸导入图与空白新建画布改为解除与上一张作品的绑定。
 *
 * 阶段十五 Phase C2：左栏参考图槽的导入（拖入 / 选择文件 → `/import` 落盘）由
 * `useReferenceSlot` 负责，本层只做「建槽 / 去重 / 满额 / 换模型 / 送到舞台重绘」这些
 * 跨域动作；生成请求体里是否带 `references` 统一由 `form.buildBody()` 决定。
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
  isBareImportOf,
  iteratePatch,
  presetLabelOf,
  previewRecallOf,
  rerollOverrides,
  retryOverrides,
} from '../logic/generate.js'
import { safeResetPatch } from '../../shared/models-guide.js'
import { accountStatusOf } from '../logic/probe.js'
import { providerNameKeyOf } from '../logic/preset.js'
import { referenceListOf, referencePathsOf } from '../logic/reference.js'
import { useChatThread } from './hooks/useChatThread.js'
import { useImageTool } from './hooks/useImageTool.js'
import { useColabLogin, useKaggleLogin } from './hooks/useKaggleLogin.js'
import { useReferenceSlot } from './hooks/useReferenceSlot.js'
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
  const library = useWorkLibrary({
    t,
    alive,
    ui,
    state,
    initialWorkspaceMode,
    // 阶段十五 Phase C0：删除作品后的级联清理（工具草稿 + 左栏来源引用 + 回退图回填）。
    onImagesRemoved: handleImagesRemoved,
  })
  // 左栏参考图槽的导入动作（阶段十五 Phase C2）：拖入 / 选择文件 → /import → 槽位追加。
  const referenceSlot = useReferenceSlot({ t, alive, ui, form, library })

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
    const opened = form.openDraft()
    // 阶段十五 Phase C0：既没有托管草稿也没有未提交修改时，切空白新建画布不能把上一张
    // 浏览作品的提示词 / 固定种子 / 「正在微调」来源带进来（保留当前预设与画幅）。
    if (!opened && form.origin) form.detachOrigin()
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
    // 阶段十五 Phase C0：助手点结果图 / 单图聚焦返回与胶片条同口径——先按需托管 dirty
    // 草稿，再回填目标图参数与 origin，消除「舞台换了图、左栏还是上一张」的图文不同步。
    openMessage: openPath,
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
   * 提交生成（纯文生图，可带模型原生参考图）。
   *
   * 主表单 / 助手 / 变体 / 重试都只做文生图：蒙版由舞台图片工具自己的提交路径负责，
   * 不会从这里被带出来；左栏参考图槽非空时，`form.buildBody()` 会把有序路径数组写进
   * `references`（Phase C2，所有入口共用同一份拼装，助手与重试不会漏带）。
   *
   * 三条前置预检（都不发请求）：
   *  - 当前算力来源跑不了的有效预设（资产 `providers` 能力位，如 9B 仅 Colab）：
   *    拦下并说明当前 / 所需来源与模型名，算力来源取组合层唯一的 `compute.provider`；
   *  - 参考图槽非空但当前模型不支持原生参考：拦下并提示换模型 / 移除参考图（不静默丢图）；
   *  - 专用局部重绘预设（`inpaintOnly`）不能文生图：本次请求改用兜底预设并轻提示（决策 D3），
   *    左栏表单保持用户选择不变。
   */
  async function generate(overrides, options = {}) {
    if (sending) return false
    const effectivePreset = effectivePresetOf(overrides, form.activePreset, presets)
    // 覆盖项（重试 / 变体）里的 references 优先：预检与请求体必须看同一组参考图。
    const requestedReferences = referencePathsOf(
      overrides && Object.prototype.hasOwnProperty.call(overrides, 'references')
        ? overrides.references
        : form.form.references,
    )
    const capability = generateCapabilityOf({
      preset: effectivePreset,
      presets,
      references: requestedReferences,
      // 与顶栏模型卡同源：provider 只在组合层归一一次（compute.provider），不在这里重复推导。
      provider: compute.provider,
    })
    if (!capability.ok) {
      // blockedParams 里是算力来源 id；提示文案要用本地化展示名，拼装只在组合层做一次。
      const blocked = capability.blockedParams
      const params = blocked
        ? {
            ...blocked,
            provider: t(providerNameKeyOf(blocked.provider)),
            needed: t(providerNameKeyOf(blocked.needed)),
          }
        : undefined
      ui.showToast(formatText(t(capability.blockedKey), params))
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
   * 按路径在已加载作品库里找条目 `{ image, item }`（助手结果图 / 单图聚焦 / 还原原图用）。
   *
   * 新完成任务在 /history 刷新前可能还不在 gallery 里，退一步按 items 里的图拼最小条目；
   * 都找不到时返回 null，调用方按「路径不在当前列表」安全收口。
   */
  function entryByPath(path) {
    const target = typeof path === 'string' ? path.trim() : ''
    if (!target) return null
    const gallery = Array.isArray(library.gallery) ? library.gallery : []
    const found = gallery.find((entry) => entry && entry.image && entry.image.path === target)
    if (found) return found
    const items = Array.isArray(library.items) ? library.items : []
    for (const item of items) {
      const images = item && Array.isArray(item.images) ? item.images : []
      const image = images.find((candidate) => candidate && candidate.path === target)
      if (image) return { image, item }
    }
    return null
  }

  /**
   * 把作品参数回填进左栏（阶段十五 Phase C0 的「焦点与来源同源收口」）。
   *
   * 所有切换作品的入口（胶片条 / 画廊 / 助手结果图 / 导入完成 / 删除后的回退）共用这一份口径：
   *  - 裸导入图没有生成参数：有未提交修改先托管，再解除表单与上一张作品的绑定（清
   *    prompt / seed / origin，保留预设与画幅），不残留上一张生图的参数与「正在微调」；
   *  - 其他作品：`iteratePatch` 算补丁（非扩散产物沿 sourceImage 回溯父作品），
   *    dirty 时先 `parkDraft()` 再回填，并沿用既有提示键。
   *
   * @param {{image: object, item: object}} target 目标作品条目
   * @param {{notice?: boolean}} [options] notice=false 时不弹「已保留当前草稿 / 参数已回填」
   *   （导入完成、删除回退这类入口自己有提示语，避免后弹的提示覆盖主提示）
   */
  function recallTarget(target, options = {}) {
    const notice = options.notice !== false
    if (isBareImportOf(target)) {
      if (form.dirty || form.draftEditing) {
        form.parkDraft()
        if (notice) ui.showToast(t('studio.toast.draftKept'))
      }
      form.detachOrigin()
      return
    }
    // 高清放大 / inpaintOnly 等非扩散产物不直接回填：沿 sourceImage 找父作品的真实扩散参数。
    const patch = iteratePatch(target, form.form, presets, library.items)
    const decision = previewRecallOf({
      dirty: form.dirty,
      hasDraft: Boolean(form.draft),
      patch,
    })
    // 先在原焦点上托管（草稿编辑态切走时同样要留下最新内容），再回填目标作品的干净基准。
    if (decision.park || form.draftEditing) form.parkDraft()
    if (notice && decision.noticeKey) ui.showToast(t(decision.noticeKey))
    if (decision.action !== 'recall') return
    form.applyRecall(patch, target)
  }

  /**
   * 胶片条 / 画廊 / 助手结果图点击作品：切换右侧预览，并把该作品的原始参数回填到左侧面板。
   *
   * 阶段十五 Phase A1（§6.1.1/§6.1.3）：不再因为 dirty 拦截回填——未提交修改先被托管进
   * 最左端草稿卡（已有草稿则覆盖），再回填目标作品的干净基准，并给「已保留当前草稿」提示。
   * 阶段十五 Phase C0：先退出舞台画布编辑态（`closeTool()` 只收编辑态、按作品路径保留
   * `workDrafts`，符合 SPEC §5.17）；裸导入图走 `recallTarget` 的解除绑定分支。
   */
  function previewWork(entry) {
    const target = entry && entry.image ? entry : null
    if (!target) return
    imageTool.closeTool()
    library.selectImage(target)
    recallTarget(target)
  }

  /**
   * 助手结果图 / 单图聚焦按路径打开作品：与胶片条同口径走 `previewWork`
   * （先按需托管 dirty 草稿、再回填参数与 origin），消除图文不同步。
   *
   * 路径不在已加载作品库时按裸作品安全收口：只切预览，并解除表单与上一张作品的绑定。
   */
  function openPath(path) {
    const target = typeof path === 'string' ? path.trim() : ''
    if (!target) return
    const entry = entryByPath(target)
    if (entry) {
      previewWork(entry)
      return
    }
    imageTool.closeTool()
    if (form.dirty || form.draftEditing) form.parkDraft()
    library.openMessage(target)
    form.detachOrigin()
  }

  /**
   * 还原原图（§6.1.5）：放弃当前未提交草稿，恢复来源作品的原始参数并回到该作品。
   *
   * 表单参数与干净基准由 `useStudioForm.restoreOriginal()` 恢复；这里负责清草稿后的
   * 预览焦点（work 焦点回到来源作品）、退出舞台画布编辑态与提示。
   *
   * 阶段十五 Phase C0：来源作品已不在当前已加载列表（被删除 / 不在分页内）时，参数照常还原，
   * 但舞台切回新建画布取景框并说明情况——不能停在别的作品上冒充来源，避免图文错位。
   *
   * @returns {boolean} 是否真的还原了（没有来源 / 没有可还原字段时为 false）
   */
  function restoreOriginal() {
    const source = form.restoreOriginal()
    if (!source) return false
    imageTool.closeTool()
    const path = source && typeof source.path === 'string' ? source.path.trim() : ''
    const entry = path ? entryByPath(path) : null
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.setZoom(false)
    if (path && !entry) {
      library.focusDraft()
      ui.showToast(t('studio.toast.restoredOriginalMissing'))
      return true
    }
    if (entry) library.selectImage(entry)
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
   * 左栏参考图槽（阶段十五 Phase C2）：增删、能力引导与「送到舞台重绘」。
   *
   * 槽位本体由 `useStudioForm` 维护（挂载即 dirty、随草稿托管）；这里只做组合层的提示、
   * 视图切换与工具跳转，避免 UI 组件各自拼一套文案。
   */
  function addReference(entry) {
    const outcome = form.addReference(entry)
    if (outcome.ok) {
      ui.showToast(t('studio.reference.addedToSlot'))
      return true
    }
    if (outcome.reason === 'duplicate') ui.showToast(t('studio.reference.duplicate'))
    else if (outcome.reason === 'full') ui.showToast(formatText(t('studio.reference.full'), { max: form.referenceMax }))
    else ui.showToast(t('studio.reference.invalidPath'))
    return false
  }

  function removeReference(path) {
    return form.removeReference(path)
  }

  /** 一键切到第一个支持原生参考生图的预设（参考图保留）；没有候选时给明确提示。 */
  function switchToReferencePreset() {
    if (form.referenceSupported) return false
    const target = form.referenceSwitchPreset
    if (!target) {
      ui.showToast(t('studio.reference.noPreset'))
      return false
    }
    form.selectPreset(target)
    ui.showToast(formatText(t('studio.reference.switched'), { preset: form.referenceSwitchLabel }))
    return true
  }

  /**
   * 动作坞「设为参考图」：把当前选中（或指定）作品 path 加入左栏参考图槽。
   *
   * - 去重 / 满额只提示，不改槽位；
   * - 当前预设不支持原生参考时自动切到第一个 supportsReference 预设（参考图保留）并提示；
   * - 切回创作视图与参数表单，让槽位可见、接着改提示词。
   */
  function useAsReference(entry) {
    const target = entry || library.selected
    if (!target || !target.image) {
      ui.showToast(t('studio.reference.noTarget'))
      return false
    }
    const outcome = form.addReference(target)
    if (!outcome.ok) {
      if (outcome.reason === 'duplicate') ui.showToast(t('studio.reference.duplicate'))
      else if (outcome.reason === 'full') ui.showToast(formatText(t('studio.reference.full'), { max: form.referenceMax }))
      else ui.showToast(t('studio.reference.invalidPath'))
      return false
    }
    if (form.referenceSupported) {
      ui.showToast(t('studio.reference.addedToSlot'))
    } else if (form.referenceSwitchPreset) {
      // 自动换到支持参考的模型：参考图不丢，用户点生成即可出图（提示由切换动作统一给）。
      switchToReferencePreset()
    } else {
      ui.showToast(t('studio.reference.addedUnsupported'))
    }
    ui.setView('studio')
    ui.setPanelMode('form')
    ui.setZoom(false)
    return true
  }

  /** 「改用整图重绘」：以第一张参考图为底图打开舞台 img2img 工具（不支持参考时的降级引导）。 */
  function referenceToImg2img() {
    const first = referenceListOf(form.form.references)[0]
    if (!first) {
      ui.showToast(t('studio.reference.emptySlot'))
      return false
    }
    // 优先用已加载的历史条目（带原始 prompt / 预设）；没有时按槽位项拼最小条目即可。
    const entry = entryByPath(first.path) || {
      image: { path: first.path, url: first.url, width: first.width, height: first.height },
      item: null,
    }
    return openImageTool('img2img', entry)
  }

  /**
   * 本地导入完成（阶段十五 Phase A3 / Phase C0）：切到舞台焦点、回填参数并刷新历史。
   *
   * 图片已由 Host 落盘为独立 v1（见 SPEC §2.3 `/import`），前端不伪造历史条目：只切焦点、
   * 退出画布编辑态、关闭对比层，再重新拉一次历史，把新目录并入胶片条与版本树。
   *  - 带 PNG `tEXt` 生成元数据的导入图：完成导入后直接回填原生成参数（舞台与左栏同源）；
   *  - 裸导入图（无生成参数）：解除表单与上一张作品的绑定（清 prompt / seed / origin，
   *    保留预设与画幅），避免左栏继续显示上一张生图作品的参数与「正在微调」。
   */
  function activateImport(entry) {
    const target = entry && entry.image ? entry : null
    if (!target) return false
    imageTool.closeTool()
    library.selectImage(target)
    // 导入入口自己有「已识别生成参数 / 图片已导入」提示，回填链路不再叠一条「参数已回填」。
    recallTarget(target, { notice: false })
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
   * 删除作品后的级联清理（阶段十五 Phase C0，由 `useWorkLibrary.deleteImages` 回调）。
   *
   *  - 按 `removed` 路径清掉舞台图片工具里对应的未提交草稿（圆点不能指向已删作品）；
   *  - 清掉左栏表单 origin / draft.source 里对已删路径的引用（「还原原图」不能指向不存在的图）；
   *  - 删掉的正是当前预览作品、或左栏正绑着它时，回退到下一张图并同步刷新左栏回填，
   *    避免「舞台换了图、左栏还是被删作品的参数」。
   */
  function handleImagesRemoved({ removed, fallback, selectedRemoved }) {
    const list = Array.isArray(removed) ? removed.filter(Boolean) : []
    if (list.length === 0) return
    for (const path of list) imageTool.clearWorkDraft(path)
    const originRemoved = Boolean(form.origin && form.origin.path && list.includes(form.origin.path))
    form.forgetRemovedPaths(list)
    // 删的不是当前预览、也没绑着左栏：只需清理引用，不抢用户焦点。
    if (!(selectedRemoved === true || originRemoved)) return
    // 删掉的是当前预览作品 → 回退到下一张（作品库已把 selectedPath 指向它）。
    const next = selectedRemoved === true ? fallback : library.selected
    if (next) {
      recallTarget(next, { notice: false })
      return
    }
    // 没有可回退的图：解除绑定，不残留已删作品的提示词 / 固定种子。
    form.detachOrigin()
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
      // 左栏参考图槽（阶段十五 Phase C2）：增删 / 导入 / 换模型 / 送到舞台重绘。
      addReference,
      removeReference,
      useAsReference,
      switchToReferencePreset,
      referenceToImg2img,
      uploadReferenceFiles: referenceSlot.uploadFiles,
      referenceUploading: referenceSlot.busy,
    },
  }
}
