/** 底部最近生成栏：按批次聚合的创作轨迹 + 进行态骨架卡。 */

import React from 'react'

import { Icon } from './icons.jsx'
import { formatDuration } from '../logic/format.js'

/** 接收 { t, ui, compute, library, elapsedMs }；elapsedMs 由 Studio 用 useNow 算好传入。 */
export function Filmstrip(props) {
  const { t, ui, compute, library, elapsedMs } = props
  const { setView } = ui
  const { activeJob, sessionState, queued: sessionQueued, startSession } = compute
  const { batches, selected, selectImage } = library

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
                <button type="button" className="ofs-link" onClick={startSession}>
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
                    onClick={() => selectImage(entry)}
                    title={batch.prompt || path}
                  >
                    <img src={entry.image.url} alt={batch.prompt || entry.image.file || t('studio.image.alt')} loading="lazy" />
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
        <button type="button" className="ofs-filmstrip-link" onClick={() => setView('gallery')}>
          <Icon name="images" size={15} />
          {t('studio.gallery.title')}
          <Icon name="chevronRight" size={13} />
        </button>
      </div>
    </footer>
  )
}