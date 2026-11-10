/**
 * 对话线程域：消息列表、意图解析、澄清卡与助手气泡同步。
 *
 * 一条助手气泡只反映真实任务进度；意图只进确认卡，不动表单。
 * 依赖入参：{ t, isEn, alive, state, form, generate }。form 是表单域对象，
 * generate 由组合层提供（函数声明提升，本 hook 在事件回调里调用时已完成初始化）。
 */

import React from 'react'

import { parseIntentRequest } from '../../api/resources.js'
import { activeJobOf } from '../../logic/jobs.js'
import { formatSeconds } from '../../logic/format.js'
import { errorText } from '../../logic/error.js'
import { intentFormPatch, intentPrompt, lastIntentPrompt } from '../../logic/intent.js'
import { STYLE_CAPSULES } from '../capsules.js'
import { DEFAULT_RATIOS } from '../ratios.js'

export function useChatThread({ t, isEn, alive, state, form, generate }) {
  const [messages, setMessages] = React.useState([])
  const [interpreting, setInterpreting] = React.useState(false)
  const messageSeq = React.useRef(0)
  // 同一 tick 内连按两次回车时，用 ref 挡住第二次解析请求。
  const interpretingRef = React.useRef(false)

  // 助手气泡跟着任务状态走，只反映真实进度。
  const activeJob = activeJobOf(state)
  const threadJob = activeJob || (state && state.lastJob) || null
  const threadJobKey = threadJob ? `${threadJob.id}:${threadJob.status}` : ''
  React.useEffect(() => {
    if (!threadJob || messages.length === 0) return
    setMessages((prev) => {
      const index = prev.map((item) => item.jobId).lastIndexOf(threadJob.id)
      if (index < 0) return prev
      const current = prev[index]
      let next = null
      if (threadJob.status === 'queued' || threadJob.status === 'waiting-session') {
        next = { ...current, stage: 'queued', text: t('studio.chat.queued') }
      } else if (threadJob.status === 'running') {
        next = { ...current, stage: 'running', text: t('studio.chat.running') }
      } else if (threadJob.status === 'done') {
        const images = Array.isArray(threadJob.output?.images) ? threadJob.output.images : []
        const first = images[0] || null
        next = {
          ...current,
          stage: 'done',
          text: t('studio.chat.done'),
          image: first ? first.url : current.image,
          imagePath: first ? first.path : current.imagePath,
          meta: first
            ? `${formatSeconds(t, first.seconds)} · ${t('studio.meta.seed')} ${first.seed ?? '—'}`
            : current.meta,
        }
      } else if (threadJob.status === 'failed') {
        next = { ...current, stage: 'failed', text: errorText(t, threadJob.error || { code: '', message: '' }) }
      }
      if (!next) return prev
      if (current.stage === next.stage && current.text === next.text && current.image === next.image) return prev
      const copy = prev.slice()
      copy[index] = next
      return copy
    })
  }, [threadJobKey])

  function pushMessages(entries) {
    setMessages((prev) => [...prev, ...entries.map((entry) => ({ id: (messageSeq.current += 1), ...entry }))])
  }

  /**
   * 对话模式：把一句话交给宿主模型解析成生成参数。
   * 模型不可用时宿主会退回原文＋当前设置，界面仍然给出确认卡，不阻塞出图。
   */
  async function interpret(text) {
    const value = String(text ?? '').trim()
    if (!value || interpreting || interpretingRef.current) return
    interpretingRef.current = true
    const previousPrompt = lastIntentPrompt(messages)
    pushMessages([{ role: 'user', text: value }])
    setInterpreting(true)
    const result = await alive(parseIntentRequest({ text: value, previousPrompt, locale: isEn ? 'en' : 'zh' }))
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
        ratioId: typeof data.ratioId === 'string' ? data.ratioId : '',
        styleId: typeof data.styleId === 'string' ? data.styleId : '',
        clarify: data.clarify || null,
        source: data.source === 'model' ? 'model' : 'local',
      }])
      return
    }
    pushMessages([{ role: 'assistant', kind: 'error', text: errorText(t, result) }])
  }

  /** 澄清卡选定后，把答案并回意图卡。 */
  function resolveClarify(messageId, field, value) {
    setMessages((prev) => prev.map((message) => {
      if (!message || message.id !== messageId) return message
      const next = { ...message, clarify: null }
      if (field === 'ratio') next.ratioId = value || ''
      if (field === 'style') next.styleId = value || ''
      return next
    }))
  }

  /** 生成意图卡：先落表单，再按卡片参数提交。 */
  async function generateIntent(message) {
    if (!message || !message.prompt) return
    const overrides = { prompt: intentPrompt(message, STYLE_CAPSULES) }
    const ratio = DEFAULT_RATIOS.find((item) => item.id === message.ratioId)
    if (ratio) {
      overrides.width = ratio.width
      overrides.height = ratio.height
    }
    // 连续迭代时沿用上一张图的种子，便于对比同一构图下的改动。
    const previous = (state && state.lastJob && state.lastJob.params) || null
    if (previous && form.form.seed === '' && Number.isFinite(previous.seed) && previous.seed >= 0) {
      overrides.seed = previous.seed
    }
    const patch = intentFormPatch(message, DEFAULT_RATIOS)
    if (Object.keys(patch).length > 0) form.patchForm(patch)
    await generate(overrides, { pushUser: false })
  }

  function clearThread() {
    setMessages([])
  }

  return {
    messages,
    interpreting,
    interpret,
    resolveClarify,
    generateIntent,
    clearThread,
    pushMessages,
  }
}