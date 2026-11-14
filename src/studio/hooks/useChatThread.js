/**
 * 对话线程域：消息列表、意图解析、通用澄清卡与助手气泡同步。
 *
 * 一条助手气泡只反映真实任务进度；意图只进确认卡，用户点「按此生成」或「带入参数面板」前不动表单。
 * 依赖入参：{ t, isEn, alive, state, form, generate }。form 是表单域对象，
 * generate 由组合层提供（函数声明提升，本 hook 在事件回调里调用时已完成初始化）。
 */

import React from 'react'

import { parseIntentRequest } from '../../api/resources.js'
import { stateJobs } from '../../logic/jobs.js'
import { formatSeconds } from '../../logic/format.js'
import { errorText } from '../../logic/error.js'
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

/**
 * 任务快照 → 气泡补丁。只映射真实状态，未知状态返回 null（保持原样）。
 * 图片与耗时只在完成态给出；调用方按 stage/text/image 比对，相同内容不会重复写入。
 */
function bubblePatch(t, job, current) {
  if (job.status === 'waiting-session') return { stage: 'queued', text: t('studio.chat.waitingSession') }
  if (job.status === 'queued') return { stage: 'queued', text: t('studio.chat.queued') }
  if (job.status === 'running') return { stage: 'running', text: t('studio.chat.running') }
  if (job.status === 'done') {
    const images = Array.isArray(job.output && job.output.images) ? job.output.images : []
    const first = images[0] || null
    return {
      stage: 'done',
      text: t('studio.chat.done'),
      image: first ? first.url : current.image,
      imagePath: first ? first.path : current.imagePath,
      meta: first
        ? `${formatSeconds(t, first.seconds)} · ${t('studio.meta.seed')} ${first.seed ?? '—'}`
        : current.meta,
    }
  }
  if (job.status === 'failed') {
    return { stage: 'failed', text: errorText(t, job.error || { code: '', message: '' }) }
  }
  return null
}

export function useChatThread({ t, isEn, alive, state, form, generate }) {
  const [messages, setMessages] = React.useState([])
  const [interpreting, setInterpreting] = React.useState(false)
  const messageSeq = React.useRef(0)
  // 同一 tick 内连按两次回车时，用 ref 挡住第二次解析请求。
  const interpretingRef = React.useRef(false)

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
        if (current.stage === patch.stage && current.text === patch.text && current.image === patch.image) continue
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
    interpretingRef.current = true
    // 多轮上下文与旧字段都取「这条消息之前」的对话：history 给新宿主，
    // previousPrompt 留给不认 history 的旧宿主。
    const history = intentHistory(messages)
    const previousPrompt = lastIntentPrompt(messages)
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
    await generate(overrides, { pushUser: false })
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

  function clearThread() {
    setMessages([])
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
    clearThread,
    pushMessages,
  }
}
