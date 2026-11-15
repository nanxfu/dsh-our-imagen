/**
 * 作品库单张卡片：主缩略图按钮、星标收藏、悬停快捷操作与底部元信息。
 *
 * 键盘焦点只落到主图片按钮（`.ofs-gallery-media`）和独立操作按钮，
 * 底部文案区使用点击容器而非重复相邻 button，避免同一张卡占两个 Tab 焦点位。
 */

import React from 'react'

import { Icon } from '../icons.jsx'

export function GalleryCard({
  t,
  entry,
  cardKey,
  aspect,
  selecting,
  checked,
  favorite,
  onTogglePick,
  onOpen,
  onToggleFavorite,
  onRecall,
  onVariant,
  onReference,
  onZoom,
}) {
  const prompt = entry.item.prompt || ''
  const favoriteLabel = favorite ? t('studio.action.favorited') : t('studio.action.favorite')
  const openOrPick = () => (selecting ? onTogglePick(cardKey) : onOpen(entry))

  return (
    <div className={checked ? 'ofs-gallery-card is-picked' : 'ofs-gallery-card'}>
      <div className="ofs-gallery-stage">
        <button
          type="button"
          className="ofs-gallery-media"
          style={aspect ? { aspectRatio: aspect } : undefined}
          title={prompt || cardKey}
          aria-pressed={selecting ? checked : undefined}
          onClick={openOrPick}
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
              onToggleFavorite(entry)
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
            {/* 以此图重绘：把这张作品设为参考图，动作由组合层负责切视图与能力判断。 */}
            <button type="button" className="ofs-gallery-action" onClick={() => onReference(entry)}>
              <Icon name="image" size={12} />
              {t('studio.action.reference')}
            </button>
            <button type="button" className="ofs-gallery-action" onClick={() => onZoom(entry)}>
              <Icon name="expand" size={12} />
              {t('studio.gallery.open')}
            </button>
          </div>
        )}
      </div>

      <div className="ofs-gallery-body" onClick={openOrPick}>
        <span className="ofs-gallery-caption">{prompt || '—'}</span>
        <span className="ofs-gallery-tags">
          {entry.item.presetId ? <em>{entry.item.presetId}</em> : null}
          {entry.image.seed != null ? <span>#{entry.image.seed}</span> : null}
        </span>
      </div>
    </div>
  )
}
