/** 底部胶片坞：按批次聚合的创作轨迹 + 进行态骨架卡。 */

import React from 'react'

import { Icon } from './icons.jsx'
import { formatDuration } from '../logic/format.js'

export function Filmstrip(props) {
  const {
    t,
    batches,
    activeJob,
    selected,
    onSelect,
    elapsedMs,
    onSessionStart,
    sessionState,
    sessionQueued,
    onOpenGallery,
  } = props

  const selectedPath = selected && selected.image ? selected.image.path : ''

  return (
    <footer className="ofs-filmstrip">
      <div className="ofs-roll">
        {activeJob ? (
          <div className="ofs-ghost" role="status">
            <span className="ofs-ghost-bar" aria-hidden="true" />
            <span className="ofs-ghost-label">{sessionQueued ? t('studio.ghost.queued') : t('studio.ghost.rendering')}</span>
            {formatDuration(t, elapsedMs) ? <span className="ofs-ghost-time">{formatDuration(t, elapsedMs)}</span> : null}
          </div>
        ) : null}

        {batches.length === 0 && !activeJob ? (
          <div className="ofs-filmstrip-empty">
            <div className="ofs-slots" aria-hidden="true">
              <span className="ofs-slot" />
              <span className="ofs-slot" />
              <span className="ofs-slot" />
            </div>
            <span>
              {sessionState === 'absent' ? t('studio.filmstrip.offline') : t('studio.filmstrip.empty')}
              {sessionState === 'absent' ? (
                <button type="button" className="ofs-link" onClick={onSessionStart}>
                  {t('studio.compute.start')}
                </button>
              ) : null}
            </span>
          </div>
        ) : null}

        {batches.map((batch) => (
          <div className="ofs-batch" key={batch.key}>
            <div className="ofs-batch-thumbs">
              {batch.entries.map((entry) => {
                const path = entry.image.path || entry.image.file
                const active = path === selectedPath
                return (
                  <button
                    type="button"
                    key={path}
                    className={active ? 'ofs-thumb is-on' : 'ofs-thumb'}
                    onClick={() => onSelect(entry)}
                    title={batch.prompt || path}
                  >
                    <img src={entry.image.url} alt={entry.image.file || 'thumb'} loading="lazy" />
                  </button>
                )
              })}
            </div>
            <span className="ofs-batch-meta">
              {batch.presetId ? <em>{batch.presetId}</em> : <em />}
              <span>
                {batch.entries.length} {t('unit.image')}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="ofs-filmstrip-side">
        <button type="button" className="ofs-filmstrip-link" onClick={onOpenGallery}>
          <Icon name="images" size={15} />
          {t('studio.gallery.title')}
          <Icon name="chevronRight" size={13} />
        </button>
      </div>
    </footer>
  )
}