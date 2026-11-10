/**
 * 资产画廊：作品集式的卡片墙。
 *
 * 行为保持不变：时间分组（今天 / 本周 / 更早）、关键词搜索、模型过滤、
 * 只看收藏、批量选择 / 复制路径 / 确认删除、收藏星标、空态。
 * 视觉只依赖 tokens.css 的变量与 base.css 的原语，具体排布见 styles/gallery.css。
 */

import React from 'react'

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

export function Gallery(props) {
  const { t, gallery, now, presets, favorites, onOpen, onDelete, onExport } = props
  const [presetFilter, setPresetFilter] = React.useState('')
  const [favoriteOnly, setFavoriteOnly] = React.useState(false)
  const [selecting, setSelecting] = React.useState(false)
  const [picked, setPicked] = React.useState([])
  const [confirming, setConfirming] = React.useState(false)
  const [keyword, setKeyword] = React.useState('')

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
  const visiblePaths = BUCKETS.flatMap((bucket) => groups[bucket].map((entry) => keyOf(entry)))

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

  async function confirmDelete() {
    if (picked.length === 0) return
    await onDelete(picked)
    exitSelect()
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
                onClick={() => onExport(picked.length > 0 ? picked : visiblePaths)}
                disabled={picked.length === 0 && visiblePaths.length === 0}
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
              <div className="ofs-gallery-wall">
                {entries.map((entry) => {
                  const key = keyOf(entry)
                  const checked = picked.includes(key)
                  const favorite = favoriteSet.has(key)
                  const aspect = aspectOf(entry)
                  const prompt = entry.item.prompt || ''
                  return (
                    <button
                      type="button"
                      key={key}
                      className={checked ? 'ofs-gallery-card is-picked' : 'ofs-gallery-card'}
                      title={prompt || key}
                      aria-pressed={selecting ? checked : undefined}
                      onClick={() => (selecting ? togglePick(key) : onOpen(entry))}
                    >
                      <span
                        className="ofs-gallery-media"
                        style={aspect ? { aspectRatio: aspect } : undefined}
                      >
                        <img src={entry.image.url} alt={prompt || entry.image.file || 'thumb'} loading="lazy" />
                        {selecting ? (
                          <span className={checked ? 'ofs-gallery-pick is-on' : 'ofs-gallery-pick'} aria-hidden="true">
                            {checked ? <Icon name="check" size={11} /> : null}
                          </span>
                        ) : null}
                        {favorite ? (
                          <span className="ofs-gallery-star" aria-hidden="true">
                            <Icon name="starFilled" size={12} />
                          </span>
                        ) : null}
                      </span>
                      <span className="ofs-gallery-body">
                        <span className="ofs-gallery-caption">{prompt || '—'}</span>
                        <span className="ofs-gallery-tags">
                          {entry.item.presetId ? <em>{entry.item.presetId}</em> : null}
                          {entry.image.seed != null ? <span>#{entry.image.seed}</span> : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </section>
  )
}