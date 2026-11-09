/** 资产画廊：时间线分段、收藏筛选、批量删除。 */

import React from 'react'

const DAY = 24 * 60 * 60 * 1000

function bucketOf(time, now) {
  if (!Number.isFinite(time)) return 'earlier'
  const diff = now - time
  if (diff < DAY) return 'today'
  if (diff < 7 * DAY) return 'week'
  return 'earlier'
}

export function Gallery(props) {
  const { t, gallery, now, onOpen, favorites, onDelete, onExport } = props
  const [presetFilter, setPresetFilter] = React.useState('')
  const [favoriteOnly, setFavoriteOnly] = React.useState(false)
  const [selecting, setSelecting] = React.useState(false)
  const [picked, setPicked] = React.useState([])
  const [confirming, setConfirming] = React.useState(false)
  const [keyword, setKeyword] = React.useState('')

  const favoriteSet = new Set(favorites ?? [])

  const groups = { today: [], week: [], earlier: [] }
  for (const entry of gallery) {
    if (presetFilter && entry.item.presetId !== presetFilter) continue
    const key = entry.image.path || entry.image.file
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

  const usedPresets = [...new Set(gallery.map((entry) => entry.item.presetId).filter(Boolean))]
  const visibleCount = groups.today.length + groups.week.length + groups.earlier.length
  const visiblePaths = ['today', 'week', 'earlier'].flatMap((bucket) =>
    groups[bucket].map((entry) => entry.image.path || entry.image.file),
  )

  function togglePick(key) {
    setPicked((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  function exitSelect() {
    setSelecting(false)
    setPicked([])
    setConfirming(false)
  }

  async function confirmDelete() {
    if (picked.length === 0) return
    await onDelete(picked)
    exitSelect()
  }

  return (
    <section className="ofs-gallery">
      <div className="ofs-gallery-bar">
        <h3>{t('studio.gallery.title')}</h3>
        <input
          className="ofs-search"
          type="search"
          value={keyword}
          placeholder={t('studio.gallery.search')}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <span className="ofs-grow" />
        {usedPresets.length > 0 ? (
          <select value={presetFilter} onChange={(event) => setPresetFilter(event.target.value)}>
            <option value="">{t('studio.gallery.allPresets')}</option>
            {usedPresets.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className={favoriteOnly ? 'ofs-chip is-on' : 'ofs-chip'}
          onClick={() => setFavoriteOnly((value) => !value)}
        >
          ⭐ {t('studio.gallery.favoriteOnly')}
        </button>
        {selecting ? (
          <>
            <span className="ofs-muted">
              {t('studio.gallery.selectedCount')} {picked.length}
            </span>
            <button type="button" className="ofs-chip" onClick={exitSelect}>
              {t('studio.gallery.cancel')}
            </button>
            {confirming ? (
              <button type="button" className="ofs-chip is-danger" onClick={confirmDelete} disabled={picked.length === 0}>
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
          <button type="button" className="ofs-chip" onClick={() => setSelecting(true)} disabled={gallery.length === 0}>
            {t('studio.gallery.select')}
          </button>
        )}
        {selecting ? (
          <button
            type="button"
            className="ofs-chip"
            onClick={() => onExport(picked.length > 0 ? picked : visiblePaths)}
            disabled={picked.length === 0 && visiblePaths.length === 0}
          >
            {t('studio.gallery.export')}
          </button>
        ) : null}
        <span className="ofs-muted">{visibleCount}</span>
      </div>

      {visibleCount === 0 ? <p className="ofs-muted ofs-gallery-empty">{t('studio.gallery.empty')}</p> : null}

      {['today', 'week', 'earlier'].map((bucket) => {
        const entries = groups[bucket]
        if (entries.length === 0) return null
        return (
          <div className="ofs-gallery-group" key={bucket}>
            <h4>{t(`studio.gallery.${bucket}`)}</h4>
            <div className="ofs-gallery-grid">
              {entries.map((entry) => {
                const key = entry.image.path || entry.image.file
                const checked = picked.includes(key)
                return (
                  <button
                    type="button"
                    key={key}
                    className={checked ? 'ofs-gallery-card is-picked' : 'ofs-gallery-card'}
                    onClick={() => (selecting ? togglePick(key) : onOpen(entry))}
                    title={entry.item.prompt || key}
                  >
                    <img src={entry.image.url} alt={entry.image.file || 'thumb'} loading="lazy" />
                    {favoriteSet.has(key) ? <span className="ofs-gallery-star">⭐</span> : null}
                    {selecting ? <span className={checked ? 'ofs-gallery-check is-on' : 'ofs-gallery-check'} /> : null}
                    <span className="ofs-gallery-caption">{entry.item.prompt || '—'}</span>
                    <span className="ofs-gallery-tags">
                      {entry.item.presetId ? <em>{entry.item.presetId}</em> : null}
                      {entry.image.seed != null ? <span>#{entry.image.seed}</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}