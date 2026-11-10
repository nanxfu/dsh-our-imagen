/** 左图标栏：面板分区的快捷入口 + 画廊，底部是云端状态指示。 */

import React from 'react'

import { Icon } from './icons.jsx'

function sessionTone(sessionState) {
  if (sessionState === 'ready') return 'ok'
  if (sessionState === 'error') return 'error'
  if (sessionState === 'absent') return 'idle'
  return 'warn'
}

export function RailNav(props) {
  const { t, view, mode, sessionState, onSection, onGallery } = props
  const tone = sessionTone(sessionState)
  const computeLabel =
    sessionState === 'ready'
      ? t('studio.compute.online')
      : sessionState === 'provisioning'
        ? t('studio.compute.queued')
        : sessionState === 'connecting' || sessionState === 'warming'
          ? t('studio.compute.warming')
          : sessionState === 'stopping'
            ? t('studio.compute.stopping')
            : sessionState === 'error'
              ? t('studio.compute.error')
              : t('studio.compute.offline')
  const studioActive = view === 'studio' && mode === 'form'

  return (
    <aside className="ofs-rail" aria-label={t('studio.rail.tools')}>
      <div className="ofs-rail-group">
        <button
          type="button"
          className={`ofs-rail-btn${studioActive ? ' is-on' : ''}`}
          onClick={() => onSection('prompt')}
          title={t('studio.rail.sectionPrompt')}
        >
          <Icon name="sparkles" size={19} />
          <span>{t('studio.rail.sectionPrompt')}</span>
        </button>
        <button
          type="button"
          className="ofs-rail-btn"
          onClick={() => onSection('style')}
          title={t('studio.rail.sectionStyle')}
        >
          <Icon name="palette" size={19} />
          <span>{t('studio.rail.sectionStyle')}</span>
        </button>
        <button
          type="button"
          className="ofs-rail-btn"
          onClick={() => onSection('advanced')}
          title={t('studio.rail.sectionAdvanced')}
        >
          <Icon name="sliders" size={19} />
          <span>{t('studio.rail.sectionAdvanced')}</span>
        </button>
        <span className="ofs-rail-divider" aria-hidden="true" />
        <button
          type="button"
          className={`ofs-rail-btn${view === 'gallery' ? ' is-on' : ''}`}
          onClick={onGallery}
          aria-pressed={view === 'gallery'}
          title={t('studio.tab.gallery')}
        >
          <Icon name="images" size={19} />
          <span>{t('studio.tab.gallery')}</span>
        </button>
      </div>

      <span className="ofs-grow" />

      <div className={`ofs-rail-status is-${tone}`} title={computeLabel} aria-label={computeLabel}>
        <i className={`ofs-dot is-${tone}${tone === 'ok' ? ' is-live' : ''}`} aria-hidden="true" />
        <span>{t('studio.rail.compute')}</span>
      </div>
    </aside>
  )
}