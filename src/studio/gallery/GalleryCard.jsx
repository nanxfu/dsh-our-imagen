/**
 * 作品库单张卡片：主缩略图按钮、星标收藏、悬停快捷操作与底部元信息。
 *
 * 键盘焦点只落到主图片按钮（`.ofs-gallery-media`）和独立操作按钮，
 * 底部文案区使用点击容器而非重复相邻 button，避免同一张卡占两个 Tab 焦点位。
 *
 * 删除是破坏性动作：第一次点击只把按钮切成「确认删除」，再点一次才真删；
 * 移出卡片或点「取消」都会收起确认态。确认按钮沿用同一个 key，键盘焦点不会丢。
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
  confirming,
  onTogglePick,
  onOpen,
  onToggleFavorite,
  onRecall,
  onVariant,
  onReference,
  onZoom,
  onAskDelete,
  onCancelDelete,
  onDelete,
}) {
  const prompt = entry.item.prompt || ''
  const favoriteLabel = favorite ? t('studio.action.favorited') : t('studio.action.favorite')
  const openOrPick = () => (selecting ? onTogglePick(cardKey) : onOpen(entry))
  const deleteLabel = confirming ? t('studio.gallery.confirmDelete') : t('studio.gallery.delete')

  // 确认态是「临时武装」：指针离开卡片就自动收起，避免下次滑过时误删。
  return (
    <div
      className={checked ? 'ofs-gallery-card is-picked' : 'ofs-gallery-card'}
      onMouseLeave={confirming ? () => onCancelDelete(entry) : undefined}
    >
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
          <div className={confirming ? 'ofs-gallery-hover is-confirming' : 'ofs-gallery-hover'}>
            {confirming ? null : (
              <>
                <button key="iterate" type="button" className="ofs-gallery-action" onClick={() => onRecall(entry)}>
                  <Icon name="focus" size={12} />
                  {t('studio.action.iterate')}
                </button>
                <button key="variant" type="button" className="ofs-gallery-action" onClick={() => onVariant(entry)}>
                  <Icon name="reroll" size={12} />
                  {t('studio.action.reroll')}
                </button>
                {/* 以此图重绘：把这张作品设为参考图，动作由组合层负责切视图与能力判断。 */}
                <button key="reference" type="button" className="ofs-gallery-action" onClick={() => onReference(entry)}>
                  <Icon name="image" size={12} />
                  {t('studio.action.reference')}
                </button>
                <button key="zoom" type="button" className="ofs-gallery-action" onClick={() => onZoom(entry)}>
                  <Icon name="expand" size={12} />
                  {t('studio.gallery.open')}
                </button>
              </>
            )}
            {/* 破坏性动作单独一档：常态淡红描边，确认态实心红并把其余动作收起，减少误点。
                「取消」排在确认之后、正好压住原来「删除」的位置，习惯性双击只会点到取消。 */}
            <button
              key="delete"
              type="button"
              className={confirming ? 'ofs-gallery-action is-danger is-confirming' : 'ofs-gallery-action is-danger'}
              onClick={() => (confirming ? onDelete(entry) : onAskDelete(entry))}
            >
              <Icon name="trash" size={12} />
              {deleteLabel}
            </button>
            {confirming ? (
              <button key="cancel" type="button" className="ofs-gallery-action" onClick={() => onCancelDelete(entry)}>
                {t('studio.gallery.cancel')}
              </button>
            ) : null}
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
