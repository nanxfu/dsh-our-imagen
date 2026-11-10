/**
 * 生图工作台的数据编排：会话、历史、选中图、表单与动作。
 *
 * 只回传数据与回调，不渲染；组件层保持纯展示。
 */

import React from 'react'

import { LIMITS, TIMEOUTS } from '../../shared/contract.js'

import {
  deleteImages as deleteImagesRequest,
  enhancePromptRequest,
  favoriteImage,
  fetchHistory,
  fetchLibrary,
  parseIntentRequest,
  revealOutput,
  runProbe as runProbeRequest,
  startSession as startSessionRequest,
  stopSession as stopSessionRequest,
  submitGenerate,
} from '../api/resources.js'
import { useHostState } from '../hooks/useHostState.js'
import { translator } from '../i18n.js'
import { activeJobOf, stateJobs } from '../logic/jobs.js'
import { clampInt, clampNumber, clampSize } from '../logic/clamp.js'
import { STYLE_CAPSULES } from './capsules.js'
import { DEFAULT_RATIOS, ratioToSize } from './ratios.js'
import { formatSeconds } from '../logic/format.js'
import { errorText } from '../logic/error.js'
import { buildGenerateBody } from '../logic/generate.js'
import { toggleStyle } from '../logic/prompt.js'
import {
  guidanceDetailOf,
  guidanceKindOf,
  KAGGLE_INSTALL_COMMAND,
} from '../logic/guidance.js'
import { iteratePatch, rerollOverrides, retryOverrides } from '../logic/recall.js'
import { probeOutcomeOf } from '../logic/probe.js'
import { isRefineApplied, refineSeparator, toggleRefineTerm } from '../logic/refine.js'
import { intentFormPatch, intentPrompt, lastIntentPrompt } from '../logic/intent.js'

const EMPTY_FORM = {
  prompt: '',
  negative: '',
  presetId: '',
  width: 1024,
  height: 1024,
  steps: 4,
  cfg: 0,
  seed: '',
  count: 1,
  styleId: '',
}

function flattenHistory(items) {
  const images = []
  for (const item of items) {
    const list = Array.isArray(item.images) ? item.images.filter(Boolean) : []
    for (const image of list) images.push({ image, item })
  }
  return images
}

export function useStudio(props) {
  const t = translator(props)
  const isEn = !/^zh/i.test(String((typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en'))
  const host = useHostState()
  const state = host.state
  const refresh = host.refresh
  const hostError = host.error

  const session = (state && state.session) || null
  const sessionState = (session && session.state) || 'absent'
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : []
  const defaultPreset = (state && state.defaultPreset) || ''
  const activeJob = activeJobOf(state)

  const [form, setForm] = React.useState(() => ({
    ...EMPTY_FORM,
    prompt: props && typeof props.initialPrompt === 'string' ? props.initialPrompt : '',
  }))
  // 比例由当前尺寸反推：切换预设改变宽高时，比例按钮不会停在旧值上。
  const ratioId = (() => {
    const match = DEFAULT_RATIOS.find((ratio) => {
      const size = ratioToSize(ratio)
      return size.width === form.width && size.height === form.height
    })
    return match ? match.id : ''
  })()
  // 初始视图同样可由 props 指定（预览与测试用）；正常运行时从创作开始。
  const [view, setView] = React.useState(props && props.view === 'gallery' ? 'gallery' : 'studio')
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [negativeOpen, setNegativeOpen] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [probing, setProbing] = React.useState(false)
  const [probeReport, setProbeReport] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [dismissed, setDismissed] = React.useState('')
  const [toast, setToast] = React.useState(null)
  const [selectedPath, setSelectedPath] = React.useState('')
  const [historyItems, setHistoryItems] = React.useState([])
  const [historyDone, setHistoryDone] = React.useState(false)
  const [favorites, setFavorites] = React.useState([])
  const [refineGroups, setRefineGroups] = React.useState([])
  const [refineSource, setRefineSource] = React.useState('')
  const [enhancing, setEnhancing] = React.useState(false)
  // 初始形态可由 props 指定（预览与测试用）；正常运行时默认表单式。
  const [panelMode, setPanelMode] = React.useState(props && props.panelMode === 'chat' ? 'chat' : 'form')
  const [messages, setMessages] = React.useState([])
  const [interpreting, setInterpreting] = React.useState(false)
  const messageSeq = React.useRef(0)
  const [zoom, setZoom] = React.useState(false)

  const pendingRef = React.useRef(null)
  // 同一 tick 内连按两次回车时，用 ref 挡住第二次解析请求。
  const interpretingRef = React.useRef(false)
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 宿主状态轮询失败：当前已有更具体的错误时保留它，否则借现有 error/指引通道提示；
  // 按 code+message 去重，避免每 10 秒把同一失败重复弹一遍。
  const hostErrorKeyRef = React.useRef('')
  React.useEffect(() => {
    if (!hostError) return
    const key = `${hostError.code}|${hostError.message ?? ''}`
    if (hostErrorKeyRef.current === key) return
    hostErrorKeyRef.current = key
    setError((prev) => prev || { code: hostError.code, message: hostError.message ?? '' })
  }, [hostError])

  // 预设同步：只在用户没手动改过时套用推荐值
  React.useEffect(() => {
    if (presets.length === 0) return
    setForm((prev) => {
      if (prev.presetId && presets.some((item) => item.id === prev.presetId)) return prev
      const initial = presets.some((item) => item.id === defaultPreset) ? defaultPreset : presets[0].id
      const preset = presets.find((item) => item.id === initial)
      if (!preset) return prev
      const size = clampSize(preset.size)
      return {
        ...prev,
        presetId: initial,
        width: size,
        height: size,
        steps: clampInt(preset.steps, LIMITS.steps.min, LIMITS.steps.max, 4),
        cfg: clampNumber(preset.cfg, LIMITS.cfg.min, LIMITS.cfg.max, 0),
      }
    })
  }, [presets.length, defaultPreset])

  const loadHistory = React.useCallback(async () => {
    const result = await fetchHistory(60)
    if (!aliveRef.current) return
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      setHistoryItems(result.data.items.filter(Boolean))
    } else if (!result.ok) {
      // 加载失败不再静默成"暂无作品"：走现有错误/指引通道，且不清空已有列表。
      fail(result.code, result.message)
    }
    setHistoryDone(true)
  }, [])

  React.useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const loadLibrary = React.useCallback(async () => {
    const result = await fetchLibrary()
    if (!aliveRef.current) return
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites)
    } else if (!result.ok) {
      fail(result.code, result.message)
    }
  }, [])

  React.useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  // 对话线程里的助手气泡跟着任务状态走，只反映真实进度，不额外提问。
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

  // 首张出图提示：本次会话第一张成品落地时报一次。
  const firstImageRef = React.useRef(false)
  const finished = state && state.lastJob && state.lastJob.status === 'done' ? state.lastJob : null
  React.useEffect(() => {
    if (!finished || firstImageRef.current) return
    const images = Array.isArray(finished.output?.images) ? finished.output.images : []
    if (images.length === 0) return
    firstImageRef.current = true
    setToast({ text: t('studio.toast.firstImage'), id: Date.now() })
  }, [finished && finished.id])

  // 任务完成后刷新历史，让新图自动出现在最近生成最前面
  const lastJobId = state && state.lastJob ? `${state.lastJob.id}:${state.lastJob.finishedAt ?? ''}` : ''
  const lastSeenRef = React.useRef('')
  React.useEffect(() => {
    if (!lastJobId || lastSeenRef.current === lastJobId) return
    lastSeenRef.current = lastJobId
    loadHistory()
  }, [lastJobId, loadHistory])

  const gallery = flattenHistory(historyItems)
  // 最近生成按批次分组：一次生成（1~4 张）就是一组。
  const batches = historyItems
    .map((item) => ({
      key: item.jobId || item.dir || String(item.prompt),
      prompt: item.prompt || '',
      presetId: item.presetId || '',
      entries: (Array.isArray(item.images) ? item.images.filter(Boolean) : []).map((image) => ({ image, item })),
    }))
    .filter((batch) => batch.entries.length > 0)
  const newest = gallery[0] || null
  const selected = (selectedPath && gallery.find((entry) => entry.image.path === selectedPath)) || newest
  // 焦点任务：进行中优先，其次最近完成的，再次列表首个（历史任务的异常也要能出指引）。
  const focusedJob = activeJob || (state && state.lastJob) || stateJobs(state)[0] || null
  const sessionQueued =
    sessionState === 'provisioning' ||
    Boolean(activeJob && (activeJob.status === 'queued' || activeJob.status === 'waiting-session'))

  const preset = presets.find((item) => item.id === form.presetId) || null

  function patchForm(partial) {
    setForm((prev) => ({ ...prev, ...partial }))
  }

  function showToast(text) {
    setToast({ text, id: Date.now() })
  }

  // 新的本地错误出现时，恢复之前被手动收起的指引卡。
  function fail(code, message) {
    setDismissed('')
    setError({ code, message: message ?? '' })
  }

  React.useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => {
      if (aliveRef.current) setToast(null)
    }, 2600)
    return () => clearTimeout(timer)
  }, [toast])

  async function copyText(text, okKey) {
    const value = String(text ?? '').trim()
    if (!value) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value)
        showToast(t(okKey))
        return
      }
    } catch {
      // 非安全上下文或不给权限：退化为提示用户手动复制
    }
    showToast(value)
  }

  function copyPath(value) {
    return copyText(value, 'studio.toast.copied')
  }

  function copyInstallCommand() {
    return copyText(KAGGLE_INSTALL_COMMAND, 'studio.guidance.cli.copied')
  }

  async function startSession() {
    if (busy) return
    setBusy('start')
    const result = await startSessionRequest(form.presetId || defaultPreset)
    if (!aliveRef.current) return
    setBusy('')
    if (!result.ok) fail(result.code, result.message)
    refresh()
  }

  async function stopSession() {
    if (busy) return
    setBusy('stop')
    const result = await stopSessionRequest()
    if (!aliveRef.current) return
    setBusy('')
    if (!result.ok) fail(result.code, result.message)
    refresh()
  }

  function buildBody(overrides) {
    return buildGenerateBody(form, { styleSuffix, defaultPreset, overrides })
  }

  function pushMessages(entries) {
    setMessages((prev) => [...prev, ...entries.map((entry) => ({ id: (messageSeq.current += 1), ...entry }))])
  }

  async function generate(overrides, options = {}) {
    if (sending) return
    const body = buildBody(overrides)
    if (!body.prompt) {
      fail('need_prompt', '')
      return
    }
    pendingRef.current = body
    setSending(true)
    setError(null)
    const result = await submitGenerate(body)
    if (!aliveRef.current) return
    setSending(false)
    if (result.ok && result.data && result.data.id) {
      const jobId = result.data.id
      const entries = []
      if (options.pushUser !== false) entries.push({ role: 'user', text: body.prompt })
      entries.push({ role: 'assistant', kind: 'job', jobId, stage: 'pending', text: t('studio.chat.pending') })
      pushMessages(entries)
      refresh()
      loadHistory()
      showToast(t('studio.toast.submitted'))
      return
    }
    fail(result.code, result.message)
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
    const result = await parseIntentRequest({ text: value, previousPrompt, locale: isEn ? 'en' : 'zh' })
    interpretingRef.current = false
    if (!aliveRef.current) return
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
    if (previous && form.seed === '' && Number.isFinite(previous.seed) && previous.seed >= 0) {
      overrides.seed = previous.seed
    }
    const patch = intentFormPatch(message, DEFAULT_RATIOS)
    if (Object.keys(patch).length > 0) patchForm(patch)
    await generate(overrides, { pushUser: false })
  }

  /** 从画廊打开大图：切回创作页并直接进放大层。 */
  function zoomImage(entry) {
    if (!entry) return
    selectImage(entry)
    setView('studio')
    setZoom(true)
  }

  /** 在系统文件管理器里打开产物目录。 */
  async function openFolder() {
    const result = await revealOutput()
    if (!aliveRef.current) return
    if (!result.ok) showToast(t('studio.toast.revealFailed'))
  }

  /** 生成变体：基于当前选中的作品，而不是左侧表单。 */
  function reroll(entry) {
    const target = entry || selected
    const overrides = rerollOverrides(target, presets)
    if (!overrides) {
      showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides)
  }

  /** 带回参数：提示词与尺寸来自作品本身，steps/cfg 才用 params 或预设推荐值。 */
  function iterate(entry) {
    const target = entry || selected
    const patch = iteratePatch(target, form, presets)
    if (Object.keys(patch).length === 0) return
    patchForm(patch)
    setView('studio')
    setPanelMode('form')
    showToast(t('studio.toast.recalled'))
  }

  /** 按失败任务原来的参数重试；没有任务时退回上一次提交的 body。 */
  function retryFocusedJob() {
    const overrides = retryOverrides(focusedJob)
      || (pendingRef.current ? retryOverrides(pendingRef.current) : null)
    if (!overrides) {
      showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides)
  }

  function applyStyle(capsuleId) {
    const capsule = STYLE_CAPSULES.find((item) => item.id === capsuleId)
    if (!capsule) return
    setForm((prev) => toggleStyle(prev, capsule))
  }

  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id)
    if (!ratio) return
    const size = ratioToSize(ratio)
    patchForm({ width: size.width, height: size.height })
  }

  function isFavorite(path) {
    return Boolean(path) && favorites.includes(String(path))
  }

  async function toggleFavorite(path) {
    const target = String(path ?? '')
    if (!target) return
    const next = !isFavorite(target)
    // 先本地翻转，再以宿主返回的列表为准，交互不等网络。
    setFavorites((prev) => (next ? [...prev, target] : prev.filter((item) => item !== target)))
    const result = await favoriteImage(target, next)
    if (!aliveRef.current) return
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites)
      showToast(next ? t('studio.toast.favorited') : t('studio.toast.unfavorited'))
      return
    }
    setFavorites((prev) => (next ? prev.filter((item) => item !== target) : [...prev, target]))
    fail(result.code, result.message)
  }

  async function deleteImages(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean)
    if (list.length === 0) return
    const result = await deleteImagesRequest(list)
    if (!aliveRef.current) return
    if (!result.ok) {
      fail(result.code, result.message)
      return null
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : []
    if (removed.length > 0) showToast(t('studio.toast.deleted'))
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      fail('delete_failed', t('studio.error.deleteFailed'))
    }
    setSelectedPath('')
    await Promise.all([loadHistory(), loadLibrary()])
    return { removed, failed: Array.isArray(result.data.failed) ? result.data.failed : [] }
  }

  function resetToSafe() {
    patchForm({ width: 1024, height: 1024, steps: 4, cfg: 1 })
    setError(null)
    showToast(t('studio.guidance.oom.action'))
  }

  async function runProbe() {
    if (probing) return
    setProbing(true)
    // Host 的 /probe 会串行调用 kaggle CLI，首次检查约 20~30 秒；45 秒兜底，避免无限等待。
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUTS.clientProbeMs) : null
    let result
    try {
      result = await runProbeRequest(controller ? controller.signal : undefined)
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
    if (!aliveRef.current) return
    setProbing(false)
    // Host 固定回 HTTP 200，成败只能看 payload.ok / probe.auth.ok。
    if (!result.ok) {
      setProbeReport({ status: result.code === 'timeout' ? 'timeout' : 'failed', message: result.message, probe: null })
      showToast(result.code === 'timeout' ? t('studio.probe.timeout') : t('studio.probe.failed'))
      return
    }
    const outcome = probeOutcomeOf(result.data)
    if (outcome.ok) {
      setProbeReport({ status: 'ok', message: '', probe: outcome.probe })
      if (error && (error.code === 'cli_missing' || error.code === 'auth_required')) setError(null)
      showToast(t('studio.probe.ok'))
    } else {
      setProbeReport({ status: 'failed', message: outcome.detail, probe: outcome.probe })
      if (outcome.code === 'cli_missing' || outcome.code === 'auth_required') fail(outcome.code, outcome.detail)
      else showToast(t('studio.probe.failed'))
    }
    refresh()
  }

  async function exportPaths(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean)
    if (list.length === 0) return
    // 导出的是「复制文件路径」，用宿主给的绝对路径；老记录没有绝对路径时退回原值。
    const absoluteOf = new Map()
    for (const entry of gallery) {
      const image = (entry && entry.image) || {}
      if (image.path && image.absolute) absoluteOf.set(image.path, image.absolute)
    }
    const text = list.map((item) => absoluteOf.get(item) || item).join('\n')
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        showToast(t('studio.toast.exported'))
        return
      }
    } catch {
      // 退化为提示
    }
    showToast(text)
  }

  async function enhance() {
    if (enhancing) return
    if (!form.prompt.trim()) {
      showToast(t('studio.promptHint'))
      return
    }
    setEnhancing(true)
    const result = await enhancePromptRequest({
      prompt: form.prompt,
      presetId: form.presetId,
      locale: isEn ? 'en' : 'zh',
    })
    if (!aliveRef.current) return
    setEnhancing(false)
    if (result.ok && result.data && Array.isArray(result.data.groups)) {
      const groups = result.data.groups.filter((group) => group && Array.isArray(group.options) && group.options.length > 0)
      setRefineGroups(groups)
      setRefineSource(result.data.source === 'model' ? 'model' : 'local')
      return
    }
    fail(result.code, result.message)
  }

  /** 润色标签：点一次追加，再点一次撤销。 */
  function toggleRefine(term) {
    patchForm({ prompt: toggleRefineTerm(form.prompt, term, refineSeparator(form.prompt)) })
  }

  /** 灵感预设：输入框为空时直接填入，已有内容时换行追加。 */
  function useInspiration(text) {
    const value = String(text ?? '').trim()
    if (!value) return
    const base = form.prompt.trim()
    patchForm({ prompt: base ? `${base}\n${value}` : value })
  }

  const styleSuffix = (() => {
    const capsule = STYLE_CAPSULES.find((item) => item.id === form.styleId)
    return capsule ? capsule.suffix : ''
  })()

  // 异常指引：操作失败优先，其次是会话错误，最后是当前任务的错误。
  const guidanceCode =
    (error && error.code) ||
    (session && session.error && session.error.code) ||
    (focusedJob && focusedJob.status === 'failed' && focusedJob.error && focusedJob.error.code) ||
    ''
  const guidanceDetail = guidanceDetailOf({ error, session, job: focusedJob })
  const guidanceKey = guidanceCode ? `${guidanceCode}|${guidanceDetail}` : ''
  const guidanceKind = guidanceCode && dismissed !== guidanceKey ? guidanceKindOf(guidanceCode) : ''

  function dismissGuidance() {
    if (guidanceKey) setDismissed(guidanceKey)
    setError(null)
  }

  return {
    guidanceKind,
    guidanceDetail,
    dismissGuidance,
    batches,
    quota: (state && state.probe && state.probe.quota) || null,
    probe: (state && state.probe) || null,
    probing,
    probeReport,
    panelMode,
    setPanelMode,
    messages,
    interpreting,
    interpret,
    resolveClarify,
    generateIntent,
    openFolder,
    zoomImage,
    clearThread: () => setMessages([]),
    openMessage: (path) => {
      if (path) setSelectedPath(path)
    },
    sessionQueued,
    resetToSafe,
    runProbe,
    exportPaths,
    t,
    view,
    setView,
    session,
    sessionState,
    presets,
    preset,
    activeJob,
    focusedJob,
    gallery,
    selected,
    selectImage: (entry) => setSelectedPath(entry && entry.image ? entry.image.path : ''),
    form,
    patchForm,
    styleId: form.styleId,
    applyStyle,
    ratioId,
    applyRatio,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    sending,
    busy,
    error,
    toast,
    showToast,
    favorites,
    isFavorite,
    toggleFavorite,
    deleteImages,
    refineGroups: refineGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option, applied: isRefineApplied(form.prompt, option.text) })),
    })),
    refineSource,
    enhancing,
    enhance,
    toggleRefine,
    useInspiration,
    zoom,
    setZoom,
    historyDone,
    generate,
    reroll,
    iterate,
    retryFocusedJob,
    copyPath,
    copyInstallCommand,
    startSession,
    stopSession,
    loadHistory,
  }
}