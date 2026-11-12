/**
 * 作品画廊：作品集式的卡片墙。
 *
 * 时间分组（今天 / 本周 / 更早）、关键词搜索、模型过滤、只看收藏、
 * 批量选择 / 复制路径 / 确认删除、收藏星标、空态。
 * 视觉只依赖 tokens.css 的变量与 base.css 的原语，具体排布见 styles/gallery.css。
 */

import React from 'react'

import { galleryColumnCount, galleryColumns } from '../logic/gallery.js'
import { Icon } from './icons.jsx'

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
    onToggleFavorite,
    defaultSelecting,
  } = props
  const [presetFilter, setPresetFilter] = React.useState('')
  const [favoriteOnly, setFavoriteOnly] = React.useState(false)
  // defaultSelecting 只给渲染测试直达批量选择态，正式界面从关闭开始。
  const [selecting, setSelecting] = React.useState(Boolean(defaultSelecting))
  const [picked, setPicked] = React.useState([])
  const [confirming, setConfirming] = React.useState(false)
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

  function togglePick(key) {
    setPicked((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  function exitSelect() {
    setSelecting(false)
    setPicked([])
    setConfirming(false)
  }

  function clearFilters() {
    setKeyword('')
    setPresetFilter('')
    setFavoriteOnly(false)
  }

  /** 星标只切换收藏；批量选择时星标整颗收起，避免和「点卡片选中」抢同一次点击。 */
  function toggleFavorite(entry) {
    if (typeof onToggleFavorite !== 'function') return
    onToggleFavorite(keyOf(entry))
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

  function renderCard(entry) {
    const key = keyOf(entry)
    const checked = picked.includes(key)
    const favorite = favoriteSet.has(key)
    const aspect = aspectOf(entry)
    const prompt = entry.item.prompt || ''
    const favoriteLabel = favorite ? t('studio.action.favorited') : t('studio.action.favorite')
    return (
      <div className={checked ? 'ofs-gallery-card is-picked' : 'ofs-gallery-card'} key={key}>
        <div className="ofs-gallery-stage">
          <button
            type="button"
            className="ofs-gallery-media"
            style={aspect ? { aspectRatio: aspect } : undefined}
            title={prompt || key}
            aria-pressed={selecting ? checked : undefined}
            onClick={() => (selecting ? togglePick(key) : onOpen(entry))}
          >
            <img src={entry.image.url} alt={prompt || entry.image.file || t('studio.image.alt')} loading="lazy" />
            {selecting ? (
              <span className={checked ? 'ofs-gallery-pick is-on' : 'ofs-gallery-pick'} aria-hidden="true">
                {checked ? <Icon name="check" size={11} /> : null}
              </span>
            ) : null}
          </button>

          {/* 星标是图片上方的独立按钮：只切换收藏，不连带打开大图。 */}
          {selecting ? null : (
            <button
              type="button"
              className={favorite ? 'ofs-gallery-star is-on' : 'ofs-gallery-star'}
              aria-pressed={favorite}
              aria-label={favoriteLabel}
              title={favoriteLabel}
              onClick={(event) => {
                // 虽然和图片按钮是兄弟节点，仍显式阻止冒泡，避免将来外包一层可点区域后误触。
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                toggleFavorite(entry)
              }}
            >
              <Icon name={favorite ? 'starFilled' : 'star'} size={12} />
            </button>
          )}

          {selecting ? null : (
            <div className="ofs-gallery-hover">
              <button type="button" className="ofs-gallery-action" onClick={() => onRecall(entry)}>
                <Icon name="focus" size={12} />
                {t('studio.action.iterate')}
              </button>
              <button type="button" className="ofs-gallery-action" onClick={() => onVariant(entry)}>
                <Icon name="reroll" size={12} />
                {t('studio.action.reroll')}
              </button>
              <button type="button" className="ofs-gallery-action" onClick={() => onZoom(entry)}>
                <Icon name="expand" size={12} />
                {t('studio.gallery.open')}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="ofs-gallery-body"
          onClick={() => (selecting ? togglePick(key) : onOpen(entry))}
        >
          <span className="ofs-gallery-caption">{prompt || '—'}</span>
          <span className="ofs-gallery-tags">
            {entry.item.presetId ? <em>{entry.item.presetId}</em> : null}
            {entry.image.seed != null ? <span>#{entry.image.seed}</span> : null}
          </span>
        </button>
      </div>
    )
  }

  return (
    <section className={visibleCount === 0 ? 'ofs-gallery is-empty' : 'ofs-gallery'}>
      <div className="ofs-gallery-tools">
        <div className="ofs-gallery-headline">
          <h3 className="ofs-gallery-title">{t('studio.gallery.title')}</h3>
          <span className="ofs-gallery-count">
            <b>{visibleCount}</b> {t('unit.image')}
          </span>
        </div>

        <label className="ofs-gallery-search">
          <Icon name="search" size={15} className="ofs-gallery-search-icon" />
          <input
            className="ofs-gallery-search-input"
            type="search"
            value={keyword}
            placeholder={t('studio.gallery.search')}
            aria-label={t('studio.gallery.search')}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>

        {usedPresets.length > 0 ? (
          <span className="ofs-gallery-select">
            <select
              className="ofs-gallery-select-input"
              value={presetFilter}
              aria-label={t('studio.gallery.allPresets')}
              onChange={(event) => setPresetFilter(event.target.value)}
            >
              <option value="">{t('studio.gallery.allPresets')}</option>
              {usedPresets.map((id) => (
                <option key={id} value={id}>
                  {presetNameOf(presets, id)}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={13} className="ofs-gallery-select-caret" />
          </span>
        ) : null}

        <button
          type="button"
          className={favoriteOnly ? 'ofs-chip is-on' : 'ofs-chip'}
          aria-pressed={favoriteOnly}
          onClick={() => setFavoriteOnly((value) => !value)}
        >
          <Icon name={favoriteOnly ? 'starFilled' : 'star'} size={13} />
          {t('studio.gallery.favoriteOnly')}
        </button>

        <div className="ofs-gallery-actions">
          {selecting ? (
            <>
              <span className="ofs-gallery-selected">
                {t('studio.gallery.selectedCount')} <b>{picked.length}</b>
              </span>
              <button type="button" className="ofs-chip" onClick={exitSelect}>
                {t('studio.gallery.cancel')}
              </button>
              <button
                type="button"
                className="ofs-chip"
                onClick={() => onExport(picked)}
                disabled={picked.length === 0}
              >
                <Icon name="copy" size={13} />
                {t('studio.gallery.export')}
              </button>
              {confirming ? (
                <button
                  type="button"
                  className="ofs-chip is-danger"
                  onClick={confirmDelete}
                  disabled={picked.length === 0}
                >
                  {t('studio.gallery.confirmDelete')}
                </button>
              ) : (
                <button
                  type="button"
                  className="ofs-chip is-danger"
                  onClick={() => setConfirming(true)}
                  disabled={picked.length === 0}
                >
                  {t('studio.gallery.delete')}
                </button>
              )}
            </>
          ) : (
            <button type="button" className="ofs-chip" onClick={() => setSelecting(true)} disabled={items.length === 0}>
              {t('studio.gallery.select')}
            </button>
          )}
        </div>
      </div>

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
        BUCKETS.map((bucket) => {
          const entries = groups[bucket]
          if (entries.length === 0) return null
          return (
            <section className="ofs-gallery-group" key={bucket}>
              <h4 className="ofs-gallery-group-title">{t(`studio.gallery.${bucket}`)}</h4>
              {/* 每个时间分组各自按行优先分列，最新作品排在第一行最左侧。 */}
              <div className="ofs-gallery-wall">
                {galleryColumns(entries, columns).map((column, index) => (
                  <div className="ofs-gallery-col" key={index}>
                    {column.map((entry) => renderCard(entry))}
                  </div>
                ))}
              </div>
            </section>
          )
        })
      )}
    </section>
  )
}
