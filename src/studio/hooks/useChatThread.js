/**
 * 对话线程域：消息列表、意图解析、通用澄清卡与助手气泡同步。
 *
 * 一条助手气泡只反映真实任务进度；意图只进确认卡，用户点「按此生成」或「带入参数面板」前不动表单。
 * 阶段十五 Phase A2 起新增两块协作能力：
 *  - 结果网格与单图聚焦返回栈：气泡收全部 1~4 张结果图，点击某张图进入单图聚焦，
 *    面包屑「返回上一层」逐层回退；聚焦只影响视图，**不改 messages**；
 *  - 舞台图片工具动作镜像：工具提交成功后追加 `kind='tool'` + `kind='job'` 两条记录，
 *    两类记录都带 kind，不会进入 `intentHistory()`。
 * 依赖入参：{ t, isEn, alive, state, form, generate }。form 是表单域对象，
 * generate 由组合层提供（函数声明提升，本 hook 在事件回调里调用时已完成初始化）。
 */

import React from 'react'

import { parseIntentRequest } from '../../api/resources.js'
import { stateJobs } from '../../logic/jobs.js'
import { errorText } from '../../logic/error.js'
import {
  bubblePatch,
  bubbleUnchanged,
  currentFocusOf,
  focusBackLabelOf,
  focusEntryOf,
  gridImagesOf,
  mirrorToolEntries,
  popFocus,
  pushFocus,
} from '../../logic/chat.js'
import {
  INTENT_EDITABLE_FIELDS,
  intentClarify,
  intentCount,
  intentFieldPatch,
  intentFormPatch,
  intentHistory,
  intentModelHint,
  intentNegative,
  intentOverrides,
  intentRatio,
  intentSeedOf,
  lastIntentPrompt,
  lastSeedOf,
} from '../../logic/intent.js'
import { DEFAULT_RATIOS } from '../presets.js'

export function useChatThread({ t, isEn, alive, state, form, generate }) {
  const [messages, setMessages] = React.useState([])
  const [interpreting, setInterpreting] = React.useState(false)
  // 单图聚焦返回栈：栈顶就是当前聚焦的图，空栈表示普通线程视图。
  const [focusStack, setFocusStack] = React.useState([])
  const messageSeq = React.useRef(0)
  // 同一 tick 内连按两次回车时，用 ref 挡住第二次解析请求。
  const interpretingRef = React.useRef(false)
  // 线程代次：每次「新建对话」自增。解析请求发出时记下代次，返回时对不上就整条丢弃，
  // 保证旧请求永远不会写进新线程（否则新上下文会凭空多出一张旧确认卡）。
  const threadSeq = React.useRef(0)
  // 聚焦栈在事件回调用 ref 读最新值：同一个 tick 内连续聚焦 / 返回时 state 还没提交。
  const focusRef = React.useRef(focusStack)
  focusRef.current = focusStack
  const focus = currentFocusOf(focusStack)

  // 助手气泡跟着任务状态走，只反映真实进度。
  // 队列串行执行但可能同时有多个待执行任务：每个气泡按自己的任务更新，
  // 不能只看「当前那一个」，否则排队中与先完成的任务都会停在提交时的文案。
  const jobs = stateJobs(state)
  const threadJobs = jobs.length > 0 ? jobs : (state && state.lastJob ? [state.lastJob] : [])
  const threadKey = threadJobs.map((job) => `${job.id}:${job.status}`).join('|')
  React.useEffect(() => {
    if (messages.length === 0 || threadJobs.length === 0) return
    setMessages((prev) => {
      let next = prev
      for (const job of threadJobs) {
        const index = prev.map((item) => item.jobId).lastIndexOf(job.id)
        if (index < 0) continue
        const current = (next === prev ? prev : next)[index]
        const patch = bubblePatch(t, job, current)
        if (!patch) continue
        // 阶段 / 文案 / 首图 / 全部结果图相同就跳过，避免每轮轮询都重写消息数组。
        if (bubbleUnchanged(current, patch)) continue
        if (next === prev) next = prev.slice()
        next[index] = { ...current, ...patch }
      }
      return next
    })
  }, [threadKey])

  function pushMessages(entries) {
    setMessages((prev) => [...prev, ...entries.map((entry) => ({ id: (messageSeq.current += 1), ...entry }))])
  }

  /**
   * 对话模式：把一句话交给宿主模型解析成生成参数（意图 v2）。
   *
   * 请求带上表单当前 CFG 与最近对话：宿主据此判断负向词是否生效、上一轮是延续还是新主题。
   * 宿主返回的 prompt 永远是英文，summary 是 UI 语言的画面概述；模型不可用时宿主会退回
   * 原文＋当前设置，界面仍然给出确认卡，不阻塞出图。
   */
  async function interpret(text) {
    const value = String(text ?? '').trim()
    if (!value || interpreting || interpretingRef.current) return
    // 在单图聚焦视图里发起新一轮对话：先回到普通线程，新的确认卡 / 任务气泡仍按消息流展示。
    clearFocus()
    interpretingRef.current = true
    // 多轮上下文与旧字段都取「这条消息之前」的对话：history 给新宿主，
    // previousPrompt 留给不认 history 的旧宿主。
    const history = intentHistory(messages)
    const previousPrompt = lastIntentPrompt(messages)
    const generation = threadSeq.current
    pushMessages([{ role: 'user', text: value }])
    setInterpreting(true)
    const result = await alive(parseIntentRequest({
      text: value,
      previousPrompt,
      locale: isEn ? 'en' : 'zh',
      // 意图解析按当前预设的提示词配方约束英文提示词，并让宿主知道 CFG 下的负向词能力。
      presetId: form.form.presetId,
      cfg: form.form.cfg,
      history,
    }))
    // 解析期间点了「新建对话」：这次请求属于旧线程，结果直接丢弃，也不复位新线程的状态。
    if (generation !== threadSeq.current) return
    interpretingRef.current = false
    if (!result) return
    setInterpreting(false)
    if (result.ok && result.data && typeof result.data.prompt === 'string') {
      const data = result.data
      // 意图只进确认卡，不动表单：用户还没点「按此生成」之前，
      // 不该丢掉自己在左侧写的提示词或参数。
      pushMessages([{
        role: 'assistant',
        kind: 'intent',
        prompt: data.prompt,
        summary: typeof data.summary === 'string' ? data.summary : '',
        ratioId: intentRatio(data.ratioId),
        negative: intentNegative(data.negative),
        count: intentCount(data.count),
        lockSeed: false,
        clarify: intentClarify(data.clarify),
        modelHint: intentModelHint(data.modelHint, form.form.presetId),
        source: data.source === 'model' ? 'model' : 'local',
      }])
      return
    }
    pushMessages([{ role: 'assistant', kind: 'error', text: errorText(t, result) }])
  }

  /**
   * 通用澄清卡：
   * - 选项非空 → 把选项当作新一轮用户输入、带着该卡草稿提示词重新解析（走多轮 history）；
   * - 空串（「先按当前设置」）→ 只清掉澄清，还原成确认卡，不自动提交。
   *
   * 重新解析前先移除旧澄清卡：选完就应得到新一轮确认卡，线程里不该同时留着
   * 一张旧草稿卡和一张新结果卡，让用户不知道该按哪张生成。旧卡在 closure 的
   * messages 里仍然可见，所以 history 会带上它的草稿提示词。
   */
  function resolveClarify(messageId, option) {
    const value = typeof option === 'string' ? option.trim() : ''
    if (!value) {
      setMessages((prev) => prev.map((message) => (
        message && message.id === messageId ? { ...message, clarify: null } : message
      )))
      return
    }
    setMessages((prev) => prev.filter((message) => !(message && message.id === messageId)))
    interpret(value)
  }

  /**
   * 意图卡行内微调：只接受白名单字段（提示词 / 排除项 / 生成张数），
   * 按契约裁剪后写回消息。比例仍由当前设置或重新解析决定，这里不开放。
   */
  function updateIntent(messageId, patch) {
    const source = patch && typeof patch === 'object' ? patch : {}
    const next = {}
    for (const field of INTENT_EDITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(source, field)) continue
      const applied = intentFieldPatch(field, source[field])
      if (applied) next[field] = applied[field]
    }
    if (Object.keys(next).length === 0) return
    setMessages((prev) => prev.map((message) => (
      message && message.id === messageId ? { ...message, ...next } : message
    )))
  }

  /** 单个字段编辑：textarea / 张数分段控件的 onChange 走这里。 */
  function updateIntentField(messageId, field, value) {
    updateIntent(messageId, { [field]: value })
  }

  /**
   * 生成意图卡：先落表单，再按卡片参数提交。
   *
   * 覆盖项 = 编辑后的提示词、张数、比例尺寸、负向词（仅当前模型/CFG 消费负向词时取卡上值，
   * 否则空串）与种子策略；提示词为空时按钮置灰、这里也再拦一次。
   */
  async function generateIntent(message) {
    const negativeActive = form.negativeActive === true
    const overrides = intentOverrides(message, { negativeActive })
    if (!overrides) return
    const ratio = DEFAULT_RATIOS.find((item) => item.id === message.ratioId)
    if (ratio) {
      overrides.width = ratio.width
      overrides.height = ratio.height
    }
    // 默认随机种子：跨主题对话沿用上一张的种子会让构图僵化，只有卡上显式打开开关才沿用。
    const seed = intentSeedOf(message, state && state.lastJob, form.form.seed)
    if (seed !== null) overrides.seed = seed
    const patch = intentFormPatch(message, DEFAULT_RATIOS, { negativeActive })
    if (Object.keys(patch).length > 0) form.patchForm(patch)
    // 助手确认卡只做纯文生图：source 交给组合层的来源策略，不能带上表单里挂着的参考图。
    const ok = await generate(overrides, { pushUser: false, source: 'assistant' })
    // 确认卡提交成功后表单就是这次生成的内容：补记干净基准，随后点胶卷不会误报「保留草稿」。
    if (ok && typeof form.markClean === 'function') form.markClean()
  }

  /**
   * 带入参数面板：把确认卡内容写进表单（提示词 / 宽高 / 张数 / 可用时的排除项），
   * 切换模式与轻提示由 ChatPanel 负责。返回是否成功，失败时调用方不切换面板。
   */
  function handoffIntent(message) {
    if (!message || typeof form.applyIntent !== 'function') return false
    return Boolean(form.applyIntent(message))
  }

  /** 意图卡上的「沿用上张构图」开关：默认关闭，只改这张卡自己的状态。 */
  function toggleIntentLockSeed(messageId) {
    setMessages((prev) => prev.map((message) => {
      if (!message || message.id !== messageId) return message
      return { ...message, lockSeed: message.lockSeed !== true }
    }))
  }

  /**
   * 点击助手结果网格里的某张图：进入单图聚焦视图（舞台切换由 ChatPanel 调 library.openMessage）。
   *
   * 只改聚焦栈、不改 messages；已在聚焦视图里再次聚焦会压入更深的层级，
   * 面包屑「返回上一层」据此逐层回退。
   *
   * @param {object} message 网格所在的消息（取 id 与本批张数）
   * @param {object} image 被点的结果图（气泡图项或宿主产物图）
   * @param {number} index 该图在本批结果里的序号
   * @returns {boolean} 是否有合法图片可聚焦
   */
  function focusImage(message, image, index) {
    const entry = focusEntryOf({
      messageId: message && message.id,
      image,
      index,
      count: gridImagesOf(message).length,
    })
    if (!entry) return false
    const next = pushFocus(focusRef.current, entry)
    focusRef.current = next
    setFocusStack(next)
    return true
  }

  /**
   * 返回上一层：出栈并返回新的栈顶（栈空返回 null）。
   * ChatPanel 据返回值把舞台切回对应节点，全程不动 messages。
   */
  function focusBack() {
    const next = popFocus(focusRef.current)
    focusRef.current = next
    setFocusStack(next)
    return currentFocusOf(next)
  }

  /** 清空聚焦栈、回到普通线程视图（新建对话 / 发起新一轮对话时用）。 */
  function clearFocus() {
    if (focusRef.current.length === 0) return
    focusRef.current = []
    setFocusStack([])
  }

  /**
   * 舞台图片工具动作镜像（组合层在 `useImageTool.onSubmitted` 里调用）。
   *
   * 追加两条带 `kind` 的记录：用户侧的 `kind='tool'`（底图缩略图 + 工具文案 + 可选强度）
   * 与助手侧的 `kind='job'` 任务气泡；请求失败不会走到这里，因此不需要额外分支。
   *
   * @param {{tool?: 'inpaint'|'img2img', job?: object, target?: object, body?: object}} input
   *   job 是提交响应（取 id）；target 是底图 `{ path, url }`；body 用于读重绘强度。
   * @returns {boolean} 是否追加（参数不全时返回 false，不产生半条记录）
   */
  function mirrorTool(input) {
    const entries = mirrorToolEntries(t, input)
    if (entries.length === 0) return false
    pushMessages(entries)
    return true
  }

  /**
   * 新建对话：清空当前线程、聚焦栈与对话上下文。
   *
   * 解析中点击时同样安全：代次自增让在途请求的返回作废，并把解析中状态就地复位，
   * 用户不必等旧请求回来才能继续输入。
   */
  function newChat() {
    threadSeq.current += 1
    interpretingRef.current = false
    setInterpreting(false)
    setMessages([])
    clearFocus()
  }

  return {
    messages,
    interpreting,
    interpret,
    resolveClarify,
    updateIntent,
    updateIntentField,
    generateIntent,
    handoffIntent,
    toggleIntentLockSeed,
    // 上一张图没有可复用种子时，确认卡上的锁种开关置灰。
    canLockSeed: lastSeedOf(state && state.lastJob) !== null,
    // 阶段十五 Phase A2：结果网格钻取与单图聚焦返回栈。
    focus,
    focusDepth: focusStack.length,
    focusBackLabel: focusBackLabelOf(t, focusStack),
    focusImage,
    focusBack,
    // 舞台图片工具动作镜像：追加 kind='tool' + kind='job' 两条记录。
    mirrorTool,
    newChat,
    pushMessages,
  }
}
