/** 工作台顶栏：视图切换、云端算力胶囊、模型预设选择器。 */

import React from 'react'

function sessionPill(t, sessionState, busy, onStart, onStop) {
  if (sessionState === 'ready') return { tone: 'ok', label: t('studio.compute.online'), action: onStop, actionLabel: t('studio.compute.stop') }
  if (sessionState === 'provisioning') return { tone: 'warn', label: t('studio.compute.queued') }
  if (sessionState === 'connecting' || sessionState === 'warming') return { tone: 'warn', label: t('studio.compute.warming') }
  if (sessionState === 'stopping') return { tone: 'warn', label: t('studio.compute.stopping') }
  if (sessionState === 'error') return { tone: 'error', label: t('studio.compute.error'), action: onStart, actionLabel: t('studio.compute.start') }
  return { tone: 'idle', label: t('studio.compute.offline'), action: onStart, actionLabel: t('studio.compute.start') }
}

export function TopBar(props) {
  const { t, view, setView, sessionState, presets, form, patchForm, busy, onStart, onStop, onProbe } = props
  const pill = sessionPill(t, sessionState, busy, onStart, onStop)
  const [open, setOpen] = React.useState(false)

  return (
    <header className="ofs-topbar">
      <nav className="ofs-tabs" aria-label={t('studio.tabs')}>
        <button type="button" className={view === 'studio' ? 'is-on' : ''} onClick={() => setView('studio')}>
          {t('studio.tab.studio')}
        </button>
        <button type="button" className={view === 'gallery' ? 'is-on' : ''} onClick={() => setView('gallery')}>
          {t('studio.tab.gallery')}
        </button>
      </nav>

      <span className="ofs-grow" />

      <div className="ofs-pill-wrap">
        <button
          type="button"
          className={`ofs-pill ofs-pill--${pill.tone}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <i aria-hidden="true" />
          <span>{pill.label}</span>
          <span className="ofs-pill-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open ? (
          <div className="ofs-pill-card" role="dialog">
            <button type="button" onClick={onStop} disabled={!!busy || sessionState === 'absent'}>
              {t('studio.compute.stop')}
            </button>
            <button type="button" onClick={onStart} disabled={!!busy || sessionState === 'ready'}>
              {t('studio.compute.start')}
            </button>
            <button type="button" onClick={onProbe} disabled={!!busy}>
              {t('studio.compute.check')}
            </button>
          </div>
        ) : null}
      </div>

      <label className="ofs-preset">
        <span>{t('studio.preset')}</span>
        <select
          value={form.presetId}
          disabled={presets.length === 0}
          onChange={(event) => {
            const id = event.target.value
            const next = presets.find((item) => item.id === id)
            patchForm({
              presetId: id,
              ...(next
                ? {
                    width: next.size || form.width,
                    height: next.size || form.height,
                    steps: next.steps ?? form.steps,
                    cfg: next.cfg ?? form.cfg,
                  }
                : {}),
            })
          }}
        >
          {presets.length === 0 ? <option value="">—</option> : null}
          {presets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label ? `${item.label} · ${item.id}` : item.id}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}