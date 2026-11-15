/**
 * 左栏（表单生成 / 对话模式）共用的顶栏标题与模式切换胶囊。
 *
 * - Rail 与 ChatPanel 共享完全一致的 tablist 语义与高亮状态；
 * - 独立成小组件避免两处模式切换出现交互或文案漂移。
 */

import React from 'react'

export function PanelModeTabs({ t, mode, setMode }) {
  return (
    <header className="ofs-panel-head">
      <h2>{t('studio.rail.title')}</h2>
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
