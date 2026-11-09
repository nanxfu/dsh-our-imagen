/** 焦点大图主舞台：大图、元信息浮层与动作胶囊。 */

import React from 'react'

import { formatSeconds } from '../logic/format.js'

export function Stage(props) {
  const { t, selected, activeJob, onIterate, onReroll, onCopy, zoom, setZoom, isFavorite, onToggleFavorite, onUseExample } = props
  const image = selected && selected.image ? selected.image : null
  const params = (selected && selected.item && selected.item.params) || null

  if (!image) {
    return (
      <section className="ofs-stage">
        <div className="ofs-figure ofs-figure--empty">
          <div className="ofs-empty-card">
            <span className="ofs-empty-glyph" aria-hidden="true">
              ✧
            </span>
            <p className="ofs-empty-title">{t('studio.stage.empty')}</p>
            <p className="ofs-muted">{t('studio.stage.emptyHint')}</p>
            <div className="ofs-examples">
              {['studio.example.1', 'studio.example.2', 'studio.example.3'].map((key) => (
                <button type="button" key={key} className="ofs-example" onClick={() => onUseExample(t(key))}>
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="ofs-stage">
      <figure className="ofs-figure">
        <button type="button" className="ofs-figure-button" onClick={() => setZoom(true)} title={t('studio.stage.zoom')}>
          <img src={image.url} alt={image.file || 'image'} className="ofs-image" />
        </button>
        <figcaption className="ofs-meta">
          <span>
            {t('studio.meta.size')} {image.width || '—'}×{image.height || '—'}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t('studio.meta.elapsed')} {formatSeconds(t, image.seconds)}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t('studio.meta.seed')} {image.seed ?? '—'}
          </span>
        </figcaption>
      </figure>

      <div className="ofs-dock">
        <button type="button" className="ofs-dock-button" onClick={() => onIterate(selected)}>
          {t('studio.action.iterate')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={onReroll}>
          {t('studio.action.reroll')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={() => onToggleFavorite(image.path || image.file)}>
          {isFavorite(image.path || image.file) ? t('studio.action.favorited') : t('studio.action.favorite')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={() => onCopy(image.path || image.file)}>
          {t('studio.action.copyPath')}
        </button>
      </div>

      {params && params.prompt ? <p className="ofs-stage-prompt">{params.prompt}</p> : null}

      {activeJob ? (
        <div className="ofs-stage-progress" role="status">
          <span className="ofs-progress-label">{t('studio.stage.rendering')}</span>
          <span className="ofs-shimmer" />
        </div>
      ) : null}

      {zoom ? (
        <div className="ofs-lightbox" role="presentation" onClick={() => setZoom(false)}>
          <img src={image.url} alt={image.file || 'image'} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </section>
  )
}