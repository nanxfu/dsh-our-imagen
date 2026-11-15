/**
 * 作品画廊：作品集式的卡片墙。
 *
 * 时间分组（今天 / 本周 / 更早）、关键词搜索、模型过滤、只看收藏、
 * 批量选择 / 复制路径 / 确认删除、收藏星标、空态。
 * 视觉只依赖 tokens.css 的变量与 base.css 的原语，具体排布见 styles/gallery.css。
 */

import React from 'react'

import { galleryColumnCount, galleryColumns } from '../logic/gallery.js'
import { GalleryCard } from './gallery/GalleryCard.jsx'
import { GalleryToolbar } from './gallery/GalleryToolbar.jsx'

const DAY = 24 * 60 * 60 * 1000
const BUCKETS = ['today', 'week', 'earlier']

function bucketOf(time, now) {
  if (!Number.isFinite(time)) return 'earlier'
  const diff = now - time
  if (diff < DAY) return 'today'
  if (diff < 7 * DAY) return 'week'
  return 'earlier'
}

/** 卡片与批量选择都以文件路径为唯一键，旧记录的 path 可能缺失。 */
function keyOf(entry) {
  return entry.image.path || entry.image.file
}

/** 优先用产物自身记录的像素尺寸，老记录回退到生成参数；没有尺寸就不预留高度。 */
function aspectOf(entry) {
  const { image, item } = entry
  const width = Number(image && image.width) || Number(item && item.params && item.params.width) || 0
  const height = Number(image && image.height) || Number(item && item.params && item.params.height) || 0
  if (width > 0 && height > 0) return String(width / height)
  return ''
}

/** 下拉框用模型的可读名；没有预设列表时退回 id，保证信息不丢。 */
function presetNameOf(presets, id) {
  const found = (presets || []).find((preset) => preset && preset.id === id)
  return (found && found.label) || id
}

/**
 * 画廊列数。CSS 多列是列优先填充、没有行优先选项，所以按视口宽度算好列数后由 JS 分桶；
 * 断点统一在 logic/gallery.js 维护，gallery.css 只负责每列内部的排布。
 */
function useColumnCount() {
  const [columns, setColumns] = React.useState(() => (
    typeof window === 'undefined' ? 5 : galleryColumnCount(window.innerWidth)
  ))
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onResize = () => setColumns(galleryColumnCount(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return columns
}

export function Gallery(props) {
  const {
    t,
    gallery,
    now,
    presets,
    favorites,
    onOpen,
    onZoom,
    onDelete,
    onExport,
    onRecall,
    onVariant,
    onReference,
    onToggleFavorite,
    hasMore,
    loadingMore,
    onLoadMore,
    defaultSelecting,
  } = props
  const [presetFilter, setPresetFilter] = React.useState('')
  const [favoriteOnly, setFavoriteOnly] = React.useState(false)
  // defaultSelecting 只给渲染测试直达批量选择态，正式界面从关闭开始。
  const [selecting, setSelecting] = React.useState(Boolean(defaultSelecting))
  const [picked, setPicked] = React.useState([])
  const [confirming, setConfirming] = React.useState(false)
  // 单张删除的二次确认：只对一张卡生效，避免多张卡同时「上膛」。
  const [confirmKey, setConfirmKey] = React.useState('')
  // 正在删除的路径集合：同一张卡在途时忽略重复点击，不同的卡可以各删各的。
  const deletingRef = React.useRef(new Set())
  const [keyword, setKeyword] = React.useState('')
  const columns = useColumnCount()

  const items = Array.isArray(gallery) ? gallery : []
  const favoriteSet = new Set(favorites ?? [])

  const groups = { today: [], week: [], earlier: [] }
  for (const entry of items) {
    if (presetFilter && entry.item.presetId !== presetFilter) continue
    const key = keyOf(entry)
    if (favoriteOnly && !favoriteSet.has(key)) continue
    if (keyword.trim()) {
      const needle = keyword.trim().toLowerCase()
      const haystack = [entry.item.prompt, entry.item.presetId, entry.item.jobId, key]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) continue
    }
    const time = Date.parse(entry.item.finishedAt || entry.item.createdAt || entry.item.mtime || '')
    groups[bucketOf(time, now)].push(entry)
  }

  const usedPresets = [...new Set(items.map((entry) => entry.item.presetId).filter(Boolean))]
  const visibleCount = BUCKETS.reduce((total, bucket) => total + groups[bucket].length, 0)
  const canLoadMore = hasMore === true && typeof onLoadMore === 'function'

  /**
   * 底部分页脚：还有更早的记录时给「加载更多」，加载中禁用；全部取完给一行提示。
   * 分页脚只跟着有内容的画廊出现，空画廊与筛选无结果的空态不显示。
   */
  function renderFooter() {
    if (items.length === 0) return null
    return (
      <div className="ofs-gallery-foot">
        {canLoadMore ? (
          <button
            type="button"
            className="ofs-chip ofs-gallery-more"
            onClick={onLoadMore}
            disabled={loadingMore === true}
            aria-busy={loadingMore === true ? 'true' : undefined}
          >
            {t('studio.gallery.loadMore')}
          </button>
        ) : (
          <p className="ofs-gallery-all-loaded">{t('studio.gallery.allLoaded')}</p>
        )}
      </div>
    )
  }

  function togglePick(key) {
    setPicked((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  function exitSelect() {
    setSelecting(false)
    setPicked([])
    setConfirming(false)
    setConfirmKey('')
  }

  function enterSelect() {
    setConfirmKey('')
    setSelecting(true)
  }

  function clearFilters() {
    setKeyword('')
    setPresetFilter('')
    setFavoriteOnly(false)
    setConfirmKey('')
  }

  /** 筛选一换，画面里的卡片就换了一批：收起上膛态，别让确认按钮挂到另一张卡上。 */
  function changeKeyword(value) {
    setConfirmKey('')
    setKeyword(value)
  }

  function changePresetFilter(value) {
    setConfirmKey('')
    setPresetFilter(value)
  }

  function toggleFavoriteOnly() {
    setConfirmKey('')
    setFavoriteOnly((value) => !value)
  }

  /** 星标只切换收藏；批量选择时星标整颗收起，避免和「点卡片选中」抢同一次点击。 */
  function toggleFavorite(entry) {
    if (typeof onToggleFavorite !== 'function') return
    onToggleFavorite(keyOf(entry))
  }

  /** 进入 / 退出某张卡的删除确认态；同一时刻只有一张卡上膛。 */
  function askDelete(entry) {
    setConfirmKey(keyOf(entry))
  }

  function cancelDelete() {
    setConfirmKey('')
  }

  /**
   * 单张删除：卡片上第一次点「删除」只是进入确认态，再点「确认删除」才真删。
   * 请求在途时忽略重复点击，避免同一张图连发两次（第二次必然 not_found）。
   */
  async function deleteEntry(entry) {
    if (typeof onDelete !== 'function') return
    const key = keyOf(entry)
    if (!key || deletingRef.current.has(key)) return
    deletingRef.current.add(key)
    try {
      const result = await onDelete([key])
      // 失败（含网络中断）时保留确认态：卡片还在，用户可以就地点一次重试。
      if (!result) return
      if (Array.isArray(result.failed) && result.failed.length > 0) return
      setConfirmKey('')
      setPicked((prev) => prev.filter((item) => item !== key))
    } finally {
      deletingRef.current.delete(key)
    }
  }

  async function confirmDelete() {
    if (picked.length === 0) return
    const result = await onDelete(picked)
    // 删除失败时保留选择，方便用户重试或核对。
    if (result && Array.isArray(result.failed) && result.failed.length > 0) {
      setConfirming(false)
      return
    }
    exitSelect()
  }

  return (
    <section className={visibleCount === 0 ? 'ofs-gallery is-empty' : 'ofs-gallery'}>
      <GalleryToolbar
        t={t}
        visibleCount={visibleCount}
        keyword={keyword}
        onKeywordChange={changeKeyword}
        usedPresets={usedPresets}
        presets={presets}
        presetFilter={presetFilter}
        onPresetFilterChange={changePresetFilter}
        presetNameOf={presetNameOf}
        favoriteOnly={favoriteOnly}
        onToggleFavoriteOnly={toggleFavoriteOnly}
        selecting={selecting}
        onEnterSelect={enterSelect}
        onExitSelect={exitSelect}
        picked={picked}
        confirming={confirming}
        onStartConfirmDelete={() => setConfirming(true)}
        onConfirmDelete={confirmDelete}
        onExport={onExport}
        hasItems={items.length > 0}
      />

      {visibleCount === 0 ? (
        <div className="ofs-gallery-empty">
          {items.length > 0 ? (
            <>
              <p>{t('studio.gallery.noMatch')}</p>
              <div className="ofs-gallery-empty-actions">
                <button type="button" className="ofs-chip" onClick={clearFilters}>
                  {t('studio.gallery.clearFilters')}
                </button>
              </div>
            </>
          ) : (
            <p>{t('studio.gallery.empty')}</p>
          )}
        </div>
      ) : (
        <>
          {BUCKETS.map((bucket) => {
            const entries = groups[bucket]
            if (entries.length === 0) return null
            return (
              <section className="ofs-gallery-group" key={bucket}>
                <h4 className="ofs-gallery-group-title">{t(`studio.gallery.${bucket}`)}</h4>
                {/* 每个时间分组各自按行优先分列，最新作品排在第一行最左侧。 */}
                <div className="ofs-gallery-wall">
                  {galleryColumns(entries, columns).map((column, index) => (
                    <div className="ofs-gallery-col" key={index}>
                      {column.map((entry) => {
                        const cardKey = keyOf(entry)
                        return (
                          <GalleryCard
                            key={cardKey}
                            t={t}
                            entry={entry}
                            cardKey={cardKey}
                            aspect={aspectOf(entry)}
                            selecting={selecting}
                            checked={picked.includes(cardKey)}
                            favorite={favoriteSet.has(cardKey)}
                            confirming={confirmKey === cardKey}
                            onTogglePick={togglePick}
                            onOpen={onOpen}
                            onToggleFavorite={toggleFavorite}
                            onRecall={onRecall}
                            onVariant={onVariant}
                            onReference={onReference}
                            onZoom={onZoom}
                            onAskDelete={askDelete}
                            onCancelDelete={cancelDelete}
                            onDelete={deleteEntry}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
          {renderFooter()}
        </>
      )}
    </section>
  )
}
