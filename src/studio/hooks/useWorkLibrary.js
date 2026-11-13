/**
 * 作品库域：生成历史 / 画廊分页 / 选中图 / 收藏 / 删除 / 导出。
 *
 * 负责两处加载 effect、首图提示与任务完成后的历史刷新。
 * 依赖入参：{ t, alive, ui, state }；ui 提供 toast/错误通道与视图切换。
 *
 * 分页约定（见 docs/SPEC.md 2.2 的 history 接口）：
 *  - 首屏请求 limit=LIMITS.history.pageSize、offset=0；
 *  - 「加载更多」按下一页 offset 追加并去重，失败保留已有列表；
 *  - 任务完成后的刷新总是重新从第 0 页开始，而不是只换第一页；
 *    轮询本身不会触发展开刷新，已加载的分页不会被反复重置。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'

import {
  deleteImages as deleteImagesRequest,
  favoriteImage,
  fetchHistory,
  fetchLibrary,
} from '../../api/resources.js'
import {
  historyHasMore,
  mergeHistoryPages,
  nextHistoryOffset,
} from '../../logic/jobs.js'

const PAGE_SIZE = LIMITS.history.pageSize

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
  const [historyHasMoreState, setHistoryHasMoreState] = React.useState(false)
  const [historyLoadingMore, setHistoryLoadingMore] = React.useState(false)
  const [favorites, setFavorites] = React.useState([])

  // 分页推进用 ref：loadMore 在异步回调里读最新位置，不依赖 state 的提交时序。
  const offsetRef = React.useRef(0)
  const hasMoreRef = React.useRef(false)
  const loadingMoreRef = React.useRef(false)

  /** 从第 0 页重新加载（首屏 / 任务完成 / 删除后的刷新都走这里）。 */
  const loadHistory = React.useCallback(async () => {
    const result = await alive(fetchHistory(PAGE_SIZE, 0))
    if (!result) return
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      const items = result.data.items.filter(Boolean)
      setHistoryItems(items)
      offsetRef.current = nextHistoryOffset(Number(result.data.offset) || 0, items.length)
      const more = historyHasMore(result.data, PAGE_SIZE)
      hasMoreRef.current = more
      setHistoryHasMoreState(more)
      return
    }
    if (!result.ok) {
      // 加载失败走错误/指引通道，且不清空已有列表。
      ui.fail(result.code, result.message)
    }
  }, [alive])

  /** 追加下一页；失败只提示不清空已有分页。 */
  const loadMoreHistory = React.useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return
    loadingMoreRef.current = true
    setHistoryLoadingMore(true)
    const offset = offsetRef.current
    try {
      const result = await alive(fetchHistory(PAGE_SIZE, offset))
      if (!result) return
      if (result.ok && result.data && Array.isArray(result.data.items)) {
        const page = result.data.items.filter(Boolean)
        setHistoryItems((prev) => mergeHistoryPages(prev, page))
        offsetRef.current = nextHistoryOffset(offset, page.length)
        // 空页说明已经到底（offset 已越过最后一条），即便宿主误报 hasMore 也不再请求。
        const more = page.length > 0 && historyHasMore(result.data, PAGE_SIZE)
        hasMoreRef.current = more
        setHistoryHasMoreState(more)
        return
      }
      if (!result.ok) ui.fail(result.code, result.message)
    } finally {
      loadingMoreRef.current = false
      setHistoryLoadingMore(false)
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

  // 任务完成后刷新历史：重新从第 0 页加载（新图可能连带改变后续分页边界），
  // 同一个任务只触发一次；宿主轮询本身不会重置已加载的分页。
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
    // 删除会改变记录可达性：重新从第 0 页加载，避免 offset 错位。
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
    // 画廊分页：hasMore 决定底部显示「加载更多」还是「已加载全部作品」。
    offset: offsetRef.current,
    hasMore: historyHasMoreState,
    loadingMore: historyLoadingMore,
    loadMore: loadMoreHistory,
  }
}
