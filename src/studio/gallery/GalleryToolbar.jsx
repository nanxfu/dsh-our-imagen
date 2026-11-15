/**
 * 作品库顶部工具条：计数、关键词搜索、模型筛选、仅看收藏与多选导出/删除。
 */

import React from 'react'

import { Icon } from '../icons.jsx'

export function GalleryToolbar({
  t,
  visibleCount,
  keyword,
  onKeywordChange,
  usedPresets,
  presets,
  presetFilter,
  onPresetFilterChange,
  presetNameOf,
  favoriteOnly,
  onToggleFavoriteOnly,
  selecting,
  onEnterSelect,
  onExitSelect,
  picked,
  confirming,
  onStartConfirmDelete,
  onConfirmDelete,
  onExport,
  hasItems,
}) {
  return (
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
          onChange={(event) => onKeywordChange(event.target.value)}
        />
      </label>

      {usedPresets.length > 0 ? (
        <span className="ofs-gallery-select">
          <select
            className="ofs-gallery-select-input"
            value={presetFilter}
            aria-label={t('studio.gallery.allPresets')}
            onChange={(event) => onPresetFilterChange(event.target.value)}
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
        onClick={onToggleFavoriteOnly}
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
            <button type="button" className="ofs-chip" onClick={onExitSelect}>
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
                onClick={onConfirmDelete}
                disabled={picked.length === 0}
              >
                {t('studio.gallery.confirmDelete')}
              </button>
            ) : (
              <button
                type="button"
                className="ofs-chip is-danger"
                onClick={onStartConfirmDelete}
                disabled={picked.length === 0}
              >
                {t('studio.gallery.delete')}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="ofs-chip" onClick={onEnterSelect} disabled={!hasItems}>
            {t('studio.gallery.select')}
          </button>
        )}
      </div>
    </div>
  )
}
