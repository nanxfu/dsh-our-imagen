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
  fetchHistoryTree,
  fetchLibrary,
} from '../../api/resources.js'
import {
  historyHasMore,
  mergeHistoryPages,
  nextHistoryOffset,
  pendingJobsOf,
} from '../../logic/jobs.js'
import { buildLineage } from '../../logic/lineage.js'

const PAGE_SIZE = LIMITS.history.pageSize

function flattenHistory(items) {
  const images = []
  for (const item of items) {
    const list = Array.isArray(item.images) ? item.images.filter(Boolean) : []
    for (const image of list) images.push({ image, item })
  }
  return images
}

function applyFavorite(list, target, on) {
  const base = Array.isArray(list) ? list : []
  if (on) return base.includes(target) ? base : [...base, target]
  return base.filter((item) => item !== target)
}

function mergePendingFavorites(serverList, pendingMap) {
  let merged = Array.isArray(serverList) ? serverList : []
  for (const [target, entry] of pendingMap.entries()) {
    merged = applyFavorite(merged, target, entry.next)
  }
  return merged
}

export function useWorkLibrary({ t, alive, ui, state }) {
  const [selectedPath, setSelectedPath] = React.useState('')
  const [historyItems, setHistoryItems] = React.useState([])
  const [historyHasMoreState, setHistoryHasMoreState] = React.useState(false)
  const [historyLoadingMore, setHistoryLoadingMore] = React.useState(false)
  const [favorites, setFavorites] = React.useState([])
  // 阶段十三：显式新建绘图态与版本树按需拉取。
  const [workspaceMode, setWorkspaceMode] = React.useState('work')
  const [newDraftPending, setNewDraftPending] = React.useState(false)
  const [treeUnavailable, setTreeUnavailable] = React.useState(false)
  const [treeLoadingRoot, setTreeLoadingRoot] = React.useState('')
  // 已提交、等待出图的 new_draft 任务 id：完成后切回 work 并选中新图。
  const pendingNewDraftRef = React.useRef('')
  const treeUnavailableRef = React.useRef(false)
  const treeLoadedRef = React.useRef(new Set())

  // 最新回调函数与收藏视图放进 ref：异步回调与 effect 不依赖渲染闭包。
  const tRef = React.useRef(t)
  const uiRef = React.useRef(ui)
  tRef.current = t
  uiRef.current = ui
  const favoritesRef = React.useRef(favorites)
  favoritesRef.current = favorites
  // 按路径记录收藏请求代号与在途乐观态：防快速连击或慢响应乱序覆盖/回滚新状态。
  const favSeqRef = React.useRef(new Map())
  const favPendingRef = React.useRef(new Map())

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
      uiRef.current.fail(result.code, result.message)
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
      if (!result.ok) uiRef.current.fail(result.code, result.message)
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
      const merged = mergePendingFavorites(result.data.favorites, favPendingRef.current)
      favoritesRef.current = merged
      setFavorites(merged)
    } else if (!result.ok) {
      uiRef.current.fail(result.code, result.message)
    }
  }, [alive])

  React.useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  // 首张出图提示：只对本次页面观察到的新完成批次、且云端仍就绪时报一次。
  // 首次拿到 /state 时把历史 lastJob 记为基线，避免重挂载后对旧结果再次提示；
  // 云端已关闭时不再宣称「云端就绪」。
  const hasState = Boolean(state)
  const baselineRef = React.useRef(false)
  const seenJobRef = React.useRef('')
  const announcedRef = React.useRef(false)
  const lastJob = state && state.lastJob ? state.lastJob : null
  const lastJobKey = lastJob ? `${lastJob.id}:${lastJob.status}` : ''
  const sessionState = (state && state.session && state.session.state) || 'absent'
  React.useEffect(() => {
    if (!hasState) return
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
    uiRef.current.showToast(tRef.current('studio.toast.firstImage'))
  }, [hasState, lastJobKey, sessionState])

  // 任务完成后刷新历史：重新从第 0 页加载（新图可能连带改变后续分页边界），
  // 首次拿到 /state 时只记下基线（挂载 effect 已拉过第 0 页），避免首屏重复请求 /history。
  const historyBaselineRef = React.useRef(false)
  const lastJobId = state && state.lastJob ? `${state.lastJob.id}:${state.lastJob.finishedAt ?? ''}` : ''
  const lastSeenRef = React.useRef('')
  React.useEffect(() => {
    if (!hasState) return
    if (!historyBaselineRef.current) {
      historyBaselineRef.current = true
      lastSeenRef.current = lastJobId
      return
    }
    if (!lastJobId || lastSeenRef.current === lastJobId) return
    lastSeenRef.current = lastJobId
    loadHistory()
  }, [hasState, lastJobId, loadHistory])

  // 阶段十三：显式新建绘图提交后保持 new_draft，直到该任务完成再切回 work 并选中新图。
  // 历史刷新由上面的 effect 负责（同一个 lastJobId 变化），这里只切焦点，避免重复请求。
  React.useEffect(() => {
    const jobId = pendingNewDraftRef.current
    if (!jobId || !lastJob || lastJob.id !== jobId) return
    if (lastJob.status === 'failed' || lastJob.status === 'cancelled') {
      pendingNewDraftRef.current = ''
      setNewDraftPending(false)
      return
    }
    if (lastJob.status !== 'done') return
    pendingNewDraftRef.current = ''
    setNewDraftPending(false)
    const first = Array.isArray(lastJob.output?.images) ? lastJob.output.images[0] : null
    setWorkspaceMode('work')
    setSelectedPath(first && first.path ? first.path : '')
  }, [hasState, lastJobId])

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
  // new_draft 时没有选中作品：舞台显示显式新建背景，而不是上一张旧图。
  const selected = workspaceMode === 'new_draft'
    ? null
    : ((selectedPath && gallery.find((entry) => entry.image.path === selectedPath)) || newest)

  // 阶段十三版本树：已加载历史 + 在途活动任务 → 按根折叠的作品卡索引。
  // pendingJobs 每次渲染都是新数组，用 id+status 指纹做依赖（任务参数不会中途变化）。
  const pendingJobs = pendingJobsOf(state)
  const pendingSignature = pendingJobs.map((job) => `${job.id}:${job.status}`).join(',')
  const lineage = React.useMemo(
    () => buildLineage({ items: historyItems, pendingJobs }),
    [historyItems, pendingSignature],
  )

  /** 进入显式新建绘图态：清空选中，Stage 切「模糊背景 + 取景框」，作品条出现草稿卡。 */
  function newDraft() {
    pendingNewDraftRef.current = ''
    setNewDraftPending(false)
    setWorkspaceMode('new_draft')
    setSelectedPath('')
  }

  /** 新建绘图提交成功：记下任务 id，等它完成后自动切回 work 并选中新图。 */
  function markNewDraftSubmitted(jobId) {
    pendingNewDraftRef.current = typeof jobId === 'string' ? jobId : ''
    setNewDraftPending(true)
    setWorkspaceMode('new_draft')
    setSelectedPath('')
  }

  /** 切到某张作品：用户显式点选即退出新建态，并作废自动跳转（不抢用户焦点）。 */
  function selectImage(entry) {
    pendingNewDraftRef.current = ''
    setNewDraftPending(false)
    setWorkspaceMode('work')
    setSelectedPath(entry && entry.image ? entry.image.path : '')
  }

  function openMessage(path) {
    if (!path) return
    pendingNewDraftRef.current = ''
    setNewDraftPending(false)
    setWorkspaceMode('work')
    setSelectedPath(path)
  }

  /**
   * 版本面板按需拉树：`GET /history/tree?root=` 补齐跨分页的子版本，条目并入已加载分页。
   * 旧宿主没有该路由（404）时只降级一次：标记 `treeUnavailable`，面板提示后用已加载分页继续。
   */
  async function loadTree(root) {
    const path = typeof root === 'string' ? root.trim() : ''
    if (!path || treeLoadedRef.current.has(path) || treeUnavailableRef.current) return null
    treeLoadedRef.current.add(path)
    setTreeLoadingRoot(path)
    try {
      const result = await alive(fetchHistoryTree(path))
      if (!result) {
        treeLoadedRef.current.delete(path)
        return null
      }
      if (result.ok && result.data && Array.isArray(result.data.items)) {
        const treeItems = result.data.items.filter(Boolean)
        if (treeItems.length > 0) setHistoryItems((prev) => mergeHistoryPages(prev, treeItems))
        return result.data
      }
      if (result.status === 404 || result.code === 'http_404') {
        treeUnavailableRef.current = true
        setTreeUnavailable(true)
        return null
      }
      // 其它失败（网络/5xx）允许下次再试；不改动已有分页。
      treeLoadedRef.current.delete(path)
      uiRef.current.fail(result.code, result.message)
      return null
    } finally {
      setTreeLoadingRoot('')
    }
  }

  function isFavorite(path) {
    return Boolean(path) && favorites.includes(String(path))
  }

  async function toggleFavorite(path) {
    const target = String(path ?? '')
    if (!target) return
    const next = !favoritesRef.current.includes(target)
    const seq = (favSeqRef.current.get(target) || 0) + 1
    favSeqRef.current.set(target, seq)
    favPendingRef.current.set(target, { seq, next })
    // 先本地翻转（同步写 ref 避免快速连击读到旧值），再以宿主返回的列表为准。
    const optimistic = applyFavorite(favoritesRef.current, target, next)
    favoritesRef.current = optimistic
    setFavorites(optimistic)
    const result = await alive(favoriteImage(target, next))
    if (!result) return
    // 同路径已有更新的点击发出后，旧响应（成功或失败）直接丢弃。
    if (favSeqRef.current.get(target) !== seq) return
    favPendingRef.current.delete(target)
    if (result.ok && result.data && Array.isArray(result.data.favorites)) {
      const merged = mergePendingFavorites(result.data.favorites, favPendingRef.current)
      favoritesRef.current = merged
      setFavorites(merged)
      uiRef.current.showToast(next ? tRef.current('studio.toast.favorited') : tRef.current('studio.toast.unfavorited'))
      return
    }
    setFavorites((prev) => {
      const rolled = applyFavorite(prev, target, !next)
      favoritesRef.current = rolled
      return rolled
    })
    uiRef.current.fail(result.code, result.message)
  }

  async function deleteImages(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean)
    if (list.length === 0) return
    const result = await alive(deleteImagesRequest(list))
    if (!result) return
    if (!result.ok) {
      uiRef.current.fail(result.code, result.message)
      return null
    }
    const removed = Array.isArray(result.data.removed) ? result.data.removed : []
    if (removed.length > 0) uiRef.current.showToast(tRef.current('studio.toast.deleted'))
    if (Array.isArray(result.data.failed) && result.data.failed.length > 0) {
      uiRef.current.fail('delete_failed', tRef.current('studio.error.deleteFailed'))
    }
    // 只有被删掉的那张才清空预览选择：删别的图不该把画面上正在看的作品一并收走
    // （selected 会回落到最新一张，看起来像「删 A 却换成了 B」）。
    const removedSet = new Set(removed)
    setSelectedPath((prev) => (removedSet.has(prev) ? '' : prev))
    // 删除会改变记录可达性：重新从第 0 页加载，避免 offset 错位。
    await Promise.all([loadHistory(), loadLibrary()])
    return { removed, failed: Array.isArray(result.data.failed) ? result.data.failed : [] }
  }

  /** 从画廊打开大图：切回创作页并直接进放大层。 */
  function zoomImage(entry) {
    if (!entry) return
    selectImage(entry)
    uiRef.current.setView('studio')
    uiRef.current.setZoom(true)
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
        uiRef.current.showToast(tRef.current('studio.toast.exported'))
        return
      }
    } catch {
      // 退化为提示
    }
    uiRef.current.showToast(text)
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
    // 阶段十三：原始历史条目与版本树索引（Filmstrip 按根折叠、版本面板取数据）。
    items: historyItems,
    lineage,
    // 工作区焦点：new_draft 时 selected 为 null，作品条显示新建草稿卡。
    workspaceMode,
    newDraftPending,
    newDraft,
    markNewDraftSubmitted,
    // 版本树按需拉取与旧宿主降级状态。
    loadTree,
    treeUnavailable,
    treeLoadingRoot,
  }
}
