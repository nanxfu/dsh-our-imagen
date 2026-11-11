/**
 * 作品库域：生成历史 / 画廊 / 选中图 / 收藏 / 删除 / 导出。
 *
 * 负责两处加载 effect、首图提示与任务完成后的历史刷新。
 * 依赖入参：{ t, alive, ui, state }；ui 提供 toast/错误通道与视图切换。
 */

import React from 'react'

import {
  deleteImages as deleteImagesRequest,
  favoriteImage,
  fetchHistory,
  fetchLibrary,
} from '../../api/resources.js'

function flattenHistory(items) {
  const images = []
  for (const item of items) {
    const list = Array.isArray(item.images) ? item.images.filter(Boolean) : []
    for (const image of list) images.push({ image, item })
  }
  return images
}

export function useWorkLibrary({ t, alive, ui, state }) {
  const [selectedPath, setSelectedPath] = React.useState('')
  const [historyItems, setHistoryItems] = React.useState([])
  const [favorites, setFavorites] = React.useState([])

  const loadHistory = React.useCallback(async () => {
    const result = await alive(fetchHistory(60))
    if (!result) return
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      setHistoryItems(result.data.items.filter(Boolean))
    } else if (!result.ok) {
      // 加载失败走错误/指引通道，且不清空已有列表。
      ui.fail(result.code, result.message)
    }
  }, [alive])

  React.useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const loadLibrary = React.useCallback(async () => {
    const result = await alive(fetchLibrary())
    if (!result) return
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites)
    } else if (!result.ok) {
      ui.fail(result.code, result.message)
    }
  }, [alive])

  React.useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  // 首张出图提示：只对本次页面观察到的新完成批次、且云端仍就绪时报一次。
  // 首次拿到 /state 时把历史 lastJob 记为基线，避免重挂载后对旧结果再次提示；
  // 云端已关闭时不再宣称「云端就绪」。
  const baselineRef = React.useRef(false)
  const seenJobRef = React.useRef('')
  const announcedRef = React.useRef(false)
  const lastJob = state && state.lastJob ? state.lastJob : null
  const lastJobKey = lastJob ? `${lastJob.id}:${lastJob.status}` : ''
  const sessionState = (state && state.session && state.session.state) || 'absent'
  React.useEffect(() => {
    if (!state) return
    if (!baselineRef.current) {
      baselineRef.current = true
      seenJobRef.current = lastJob ? lastJob.id : ''
      return
    }
    if (!lastJob || lastJob.id === seenJobRef.current) return
    seenJobRef.current = lastJob.id
    if (announcedRef.current || lastJob.status !== 'done' || sessionState !== 'ready') return
    const images = Array.isArray(lastJob.output?.images) ? lastJob.output.images : []
    if (images.length === 0) return
    announcedRef.current = true
    ui.showToast(t('studio.toast.firstImage'))
  }, [lastJobKey, sessionState])

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

  function selectImage(entry) {
    setSelectedPath(entry && entry.image ? entry.image.path : '')
  }

  function openMessage(path) {
    if (path) setSelectedPath(path)
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
    const result = await alive(favoriteImage(target, next))
    if (!result) return
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      setFavorites(result.data.favorites)
      ui.showToast(next ? t('studio.toast.favorited') : t('studio.toast.unfavorited'))
      return
    }
    setFavorites((prev) => (next ? prev.filter((item) => item !== target) : [...prev, target]))
    ui.fail(result.code, result.message)
  }

  async function deleteImages(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean)
    if (list.length === 0) return
    const result = await alive(deleteImagesRequest(list))
    if (!result) return
    if (!result.ok) {
      ui.fail(result.code, result.message)
      return null
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : []
    if (removed.length > 0) ui.showToast(t('studio.toast.deleted'))
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      ui.fail('delete_failed', t('studio.error.deleteFailed'))
    }
    setSelectedPath('')
    await Promise.all([loadHistory(), loadLibrary()])
    return { removed, failed: Array.isArray(result.data.failed) ? result.data.failed : [] }
  }

  /** 从画廊打开大图：切回创作页并直接进放大层。 */
  function zoomImage(entry) {
    if (!entry) return
    selectImage(entry)
    ui.setView('studio')
    ui.setZoom(true)
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
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        ui.showToast(t('studio.toast.exported'))
        return
      }
    } catch {
      // 退化为提示
    }
    ui.showToast(text)
  }

  return {
    gallery,
    batches,
    selected,
    selectImage,
    openMessage,
    favorites,
    isFavorite,
    toggleFavorite,
    deleteImages,
    exportPaths,
    zoomImage,
    loadHistory,
  }
}