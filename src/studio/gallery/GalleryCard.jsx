/**
 * 作品库单张卡片：主缩略图按钮、星标收藏、悬停快捷操作与底部元信息。
 *
 * 键盘焦点只落到主图片按钮（`.ofs-gallery-media`）和独立操作按钮，
 * 底部文案区使用点击容器而非重复相邻 button，避免同一张卡占两个 Tab 焦点位。
 *
 * 阶段十五 Phase A1（§2.3 / §6.1.9）动作收敛：画廊不直接盲发后台生图请求。
 *  - 主点击 / 「在工作台打开」：切回工作台并打开这张作品（`onOpenStudio`，与主点击同义）；
 *  - 「重绘编辑」：一步进入局部重绘（`onRedraw`，组合层调 `openImageTool('inpaint')`）；
 *  - 「查看大图」：`onZoom`；收藏是图片上方的独立星标；删除仍走二次确认。
 * 原来的「带回参数」「生成变体」已下线（回填由点胶片条 / 打开作品完成，重新生成在舞台动作坞）。
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
  onOpenStudio,
  onRedraw,
  onZoom,
  onToggleFavorite,
  onAskDelete,
  onCancelDelete,
  onDelete,
}) {
  const prompt = entry.item.prompt || ''
  const favoriteLabel = favorite ? t('studio.action.favorited') : t('studio.action.favorite')
  const openOrPick = () => (selecting ? onTogglePick(cardKey) : onOpenStudio(entry))
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
                {/* 在工作台打开与主点击同义：统一颗粒度，后续创作都在工作台里进行。 */}
                <button key="open" type="button" className="ofs-gallery-action" onClick={() => onOpenStudio(entry)}>
                  <Icon name="focus" size={12} />
                  {t('studio.action.openStudio')}
                </button>
                {/* 重绘编辑：把这张作品设为底图，一步进入局部涂抹。 */}
                <button key="redraw" type="button" className="ofs-gallery-action" onClick={() => onRedraw(entry)}>
                  <Icon name="image" size={12} />
                  {t('studio.action.redraw')}
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
