/**
 * 左栏（表单生成 / 对话模式）共用的顶栏标题与模式切换胶囊。
 *
 * - Rail 与 ChatPanel 共享完全一致的 tablist 语义与高亮状态；
 * - 独立成小组件避免两处模式切换出现交互或文案漂移。
 */

import React from 'react'

import { Icon } from './icons.jsx'

export function PanelModeTabs({ t, mode, setMode, onNewCreation }) {
  return (
    <header className="ofs-panel-head">
      <div className="ofs-panel-head-title">
        <h2>{t('studio.rail.title')}</h2>
        {typeof onNewCreation === 'function' ? (
          <button
            type="button"
            className="ofs-chip ofs-head-new"
            title={t('studio.rail.newCreation')}
            onClick={onNewCreation}
          >
            <Icon name="plus" size={13} />
            <span>{t('studio.rail.newCreation')}</span>
          </button>
        ) : null}
      </div>
      <div className="ofs-seg" role="tablist" aria-label={t('studio.rail.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'form'}
          className={mode === 'form' ? 'is-on' : ''}
          onClick={() => setMode('form')}
        >
          {t('studio.rail.modeForm')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'chat'}
          className={mode === 'chat' ? 'is-on' : ''}
          onClick={() => setMode('chat')}
        >
          {t('studio.rail.modeChat')}
        </button>
      </div>
    </header>
  )
}
