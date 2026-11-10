/** 画面预览：大图居中，图下一条信息行与一条动作行。 */

import React from 'react'

import { Icon } from './icons.jsx'
import { formatSeconds } from '../logic/format.js'

const INSPIRE_KEYS = ['studio.inspire.1', 'studio.inspire.2', 'studio.inspire.3', 'studio.inspire.4', 'studio.inspire.5']

/** 接收 { t, ui, compute, form, library, actions } 领域对象。 */
export function Stage(props) {
  const { t, ui, compute, form, library, actions } = props
  const { zoom, setZoom, copyPath } = ui
  const { activeJob, queued: sessionQueued } = compute
  const { useInspiration } = form
  const { selected, isFavorite, toggleFavorite } = library
  const { iterate, reroll } = actions
  const image = selected && selected.image ? selected.image : null
  const item = (selected && selected.item) || null
  const params = (item && item.params) || null
  // 真实 Host 的历史条目只保证有 prompt，params 可能不存在；都不能时保持空串。
  const prompt = (item && typeof item.prompt === 'string' && item.prompt)
    || (params && typeof params.prompt === 'string' && params.prompt)
    || ''
  const closeRef = React.useRef(null)

  // 看原图时 Esc 退出；打开时把焦点交给关闭按钮。
  React.useEffect(() => {
    if (!zoom) return undefined
    function onKey(event) {
      if (event.key === 'Escape') setZoom(false)
    }
    document.addEventListener('keydown', onKey)
    if (closeRef.current) closeRef.current.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [zoom])

  if (!image) {
    return (
      <section className="ofs-stage">
        <div className="ofs-figure ofs-figure--empty">
          <div className="ofs-empty-card">
            <span className="ofs-empty-icon" aria-hidden="true">
              <Icon name="images" size={26} />
            </span>
            <p className="ofs-empty-title">{t('studio.stage.empty')}</p>
            <p className="ofs-muted">{t('studio.stage.emptyHint')}</p>
            <div className="ofs-examples">
              <span className="ofs-examples-label">{t('studio.stage.examples')}</span>
              {INSPIRE_KEYS.map((key) => (
                <button type="button" key={key} className="ofs-example" onClick={() => useInspiration(t(key))} title={t(key)}>
                  {t(`${key}.label`)}
                </button>
              ))}
            </div>
          </div>

          {activeJob ? (
            <div className="ofs-stage-progress" role="status">
              <span className="ofs-shimmer" aria-hidden="true" />
              <span className="ofs-progress-label">
                {sessionQueued ? t('studio.compute.queued') : t('studio.stage.rendering')}
              </span>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const favorite = isFavorite(image.path || image.file)
  // 「复制文件路径」要给绝对路径：历史条目里带 absolute，老记录退回相对路径。
  const copyTarget = image.absolute || image.path || image.file

  return (
    <section className="ofs-stage">
      <figure className="ofs-figure">
        <button type="button" className="ofs-figure-button" onClick={() => setZoom(true)} title={t('studio.stage.zoom')}>
          <img src={image.url} alt={image.file || 'image'} className="ofs-image" />
        </button>

        <div className="ofs-figure-tools">
          <button type="button" className="ofs-glass-btn" onClick={() => setZoom(true)} title={t('studio.stage.zoom')} aria-label={t('studio.stage.zoom')}>
            <Icon name="expand" size={16} />
          </button>
          <button type="button" className="ofs-glass-btn" onClick={() => copyPath(copyTarget)} title={t('studio.action.copyPath')} aria-label={t('studio.action.copyPath')}>
            <Icon name="copy" size={16} />
          </button>
          <button
            type="button"
            className={favorite ? 'ofs-glass-btn is-on' : 'ofs-glass-btn'}
            onClick={() => toggleFavorite(image.path || image.file)}
            title={favorite ? t('studio.action.favorited') : t('studio.action.favorite')}
            aria-label={favorite ? t('studio.action.favorited') : t('studio.action.favorite')}
            aria-pressed={favorite}
          >
            <Icon name={favorite ? 'starFilled' : 'star'} size={16} />
          </button>
        </div>

        {activeJob ? (
          <div className="ofs-stage-progress" role="status">
            <span className="ofs-shimmer" aria-hidden="true" />
            <span className="ofs-progress-label">
              {sessionQueued ? t('studio.compute.queued') : t('studio.stage.rendering')}
            </span>
          </div>
        ) : null}
      </figure>

      <div className="ofs-stage-foot">
        <p className="ofs-stage-prompt" title={prompt || undefined}>{prompt}</p>
        <div className="ofs-stage-meta">
          <span>
            {image.width || '—'} × {image.height || '—'}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatSeconds(t, image.seconds)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t('studio.meta.seed')} {image.seed ?? '—'}
          </span>
        </div>
      </div>

      <div className="ofs-dock">
        <button type="button" className="ofs-dock-button" onClick={() => iterate(selected)}>
          <Icon name="focus" size={15} />
          {t('studio.action.iterate')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={() => reroll(selected)}>
          <Icon name="reroll" size={15} />
          {t('studio.action.reroll')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={() => copyPath(copyTarget)}>
          <Icon name="copy" size={15} />
          {t('studio.action.copyPath')}
        </button>
      </div>

      {zoom ? (
        <div
          className="ofs-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t('studio.stage.zoom')}
          onClick={() => setZoom(false)}
        >
          <img src={image.url} alt={image.file || 'image'} onClick={(event) => event.stopPropagation()} />
          <button
            ref={closeRef}
            type="button"
            className="ofs-lightbox-close"
            onClick={() => setZoom(false)}
            aria-label={t('studio.dismiss')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
    </section>
  )
}