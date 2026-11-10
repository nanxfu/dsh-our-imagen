/**
 * 生图工作台的数据编排：会话、历史、选中图、表单与动作。
 *
 * 只回传数据与回调，不渲染；组件层保持纯展示。
 */

import React from 'react'

import { request } from '../api.js'
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
  const host = useHostState()
  const state = host.state
  const refresh = host.refresh

  const session = (state && state.session) || null
  const sessionState = (session && session.state) || 'absent'
  const presets = Array.isArray(state && state.presets) ? state.presets.filter((item) => item && item.id) : []
  const defaultPreset = (state && state.defaultPreset) || ''
  const activeJob = activeJobOf(state)

  const [form, setForm] = React.useState(() => ({
    ...EMPTY_FORM,
    prompt: props && typeof props.initialPrompt === 'string' ? props.initialPrompt : '',
  }))
  // 初始视图同样可由 props 指定（预览与测试用）；正常运行时从工坊开始。
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
  const [suggestions, setSuggestions] = React.useState([])
  const [suggestSource, setSuggestSource] = React.useState('')
  const [enhancing, setEnhancing] = React.useState(false)
  // 初始形态可由 props 指定（预览与测试用）；正常运行时默认表单式。
  const [panelMode, setPanelMode] = React.useState(props && props.panelMode === 'chat' ? 'chat' : 'form')
  const [messages, setMessages] = React.useState([])
  const messageSeq = React.useRef(0)
  const [zoom, setZoom] = React.useState(false)
  const [ratioId, setRatioId] = React.useState('1:1')

  const pendingRef = React.useRef(null)
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

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
        steps: clampInt(preset.steps, 1, 60, 4),
        cfg: clampNumber(preset.cfg, 0, 20, 0),
      }
    })
  }, [presets.length, defaultPreset])

  const loadHistory = React.useCallback(async () => {
    const result = await request('imagen-api/history?limit=60', { method: 'GET' })
    if (!aliveRef.current) return
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      setHistoryItems(result.data.items.filter(Boolean))
    }
    setHistoryDone(true)
  }, [])

  React.useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const loadLibrary = React.useCallback(async () => {
    const result = await request('imagen-api/library', { method: 'GET' })
    if (!aliveRef.current) return
    if (result.ok && result.data && Array.isArray(result.data.favorites)) setFavorites(result.data.favorites)
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

  // 任务完成后刷新历史，让新图自动出现在胶卷流最前面
  const lastJobId = state && state.lastJob ? `${state.lastJob.id}:${state.lastJob.finishedAt ?? ''}` : ''
  const lastSeenRef = React.useRef('')
  React.useEffect(() => {
    if (!lastJobId || lastSeenRef.current === lastJobId) return
    lastSeenRef.current = lastJobId
    loadHistory()
  }, [lastJobId, loadHistory])

  const gallery = flattenHistory(historyItems)
  // 胶卷流按批次分组：一次生成（1~4 张）就是一组。
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
    const result = await request('imagen-api/session/start', { method: 'POST', body: JSON.stringify({ presetId: form.presetId || defaultPreset }) })
    if (!aliveRef.current) return
    setBusy('')
    if (!result.ok) fail(result.code, result.message)
    refresh()
  }

  async function stopSession() {
    if (busy) return
    setBusy('stop')
    const result = await request('imagen-api/session/stop', { method: 'POST' })
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

  async function generate(overrides) {
    if (sending) return
    const body = buildBody(overrides)
    if (!body.prompt) {
      fail('need_prompt', '')
      return
    }
    pendingRef.current = body
    setSending(true)
    setError(null)
    const result = await request('imagen-api/generate', { method: 'POST', body: JSON.stringify(body) })
    if (!aliveRef.current) return
    setSending(false)
    if (result.ok && result.data && result.data.id) {
      const jobId = result.data.id
      pushMessages([
        { role: 'user', text: body.prompt },
        { role: 'assistant', jobId, stage: 'pending', text: t('studio.chat.pending') },
      ])
      refresh()
      loadHistory()
      showToast(t('studio.toast.submitted'))
      return
    }
    fail(result.code, result.message)
  }

  /** 换种子抽卡：基于当前选中的作品，而不是左侧表单。 */
  function reroll(entry) {
    const target = entry || selected
    const overrides = rerollOverrides(target, presets)
    if (!overrides) {
      showToast(t('workbench.needPrompt'))
      return
    }
    generate(overrides)
  }

  /** 以此图微调：提示词与尺寸来自作品本身，steps/cfg 才用 params 或预设推荐值。 */
  function iterate(entry) {
    const target = entry || selected
    const patch = iteratePatch(target, form, presets)
    if (Object.keys(patch).length === 0) return
    patchForm(patch)
    if (patch.width != null && patch.height != null) {
      const match = DEFAULT_RATIOS.find((ratio) => {
        const size = ratioToSize(ratio)
        return size.width === patch.width && size.height === patch.height
      })
      setRatioId(match ? match.id : '')
    }
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
    setRatioId(id)
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
    const result = await request('imagen-api/library/favorite', {
      method: 'POST',
      body: JSON.stringify({ path: target, favorite: next }),
    })
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
    const result = await request('imagen-api/library/delete', {
      method: 'POST',
      body: JSON.stringify({ paths: list }),
    })
    if (!aliveRef.current) return
    if (!result.ok) {
      fail(result.code, result.message)
      return
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : []
    if (removed.length > 0) showToast(t('studio.toast.deleted'))
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      fail('delete_failed', t('studio.error.deleteFailed'))
    }
    setSelectedPath('')
    await Promise.all([loadHistory(), loadLibrary()])
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
    const timer = controller ? setTimeout(() => controller.abort(), 45000) : null
    let result
    try {
      result = await request('imagen-api/probe', {
        method: 'POST',
        ...(controller ? { signal: controller.signal } : {}),
      })
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
    const text = list.join('\n')
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
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
    setEnhancing(true)
    const result = await request('imagen-api/enhance', {
      method: 'POST',
      body: JSON.stringify({ prompt: form.prompt }),
    })
    if (!aliveRef.current) return
    setEnhancing(false)
    if (result.ok && result.data && Array.isArray(result.data.suggestions)) {
      setSuggestions(result.data.suggestions.filter((item) => item && item.text))
      setSuggestSource(result.data.source === 'model' ? 'model' : 'local')
      return
    }
    fail(result.code, result.message)
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
    clearThread: () => setMessages([]),
    generateWithText: (text) => generate({ prompt: String(text ?? '').trim() }),
    openMessage: (path) => {
      if (path) setSelectedPath(path)
    },
    sessionQueued,
    resetToSafe,
    runProbe,
    exportPaths,
    t,
    isEn: !/^zh/i.test(String((typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en')),
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
    suggestions,
    suggestSource,
    enhancing,
    enhance,
    applySuggestion: (text) => {
      const base = form.prompt.trim()
      patchForm({ prompt: base ? `${base}, ${text}` : text })
    },
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