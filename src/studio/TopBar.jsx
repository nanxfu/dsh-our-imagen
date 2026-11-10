/** 工作台顶栏：品牌、视图切换、云端状态与配额、模型预设。 */

import React from 'react'

import { Tooltip } from '../components/Tooltip.jsx'
import { Icon } from './icons.jsx'
import { StudioIcon } from './StudioIcon.jsx'
import { probeStatusOf } from '../logic/probe.js'

function sessionPill(t, sessionState) {
  if (sessionState === 'ready') return { tone: 'ok', label: t('studio.compute.online') }
  if (sessionState === 'provisioning') return { tone: 'warn', label: t('studio.compute.queued') }
  if (sessionState === 'connecting' || sessionState === 'warming') return { tone: 'warn', label: t('studio.compute.warming') }
  if (sessionState === 'stopping') return { tone: 'warn', label: t('studio.compute.stopping') }
  if (sessionState === 'error') return { tone: 'error', label: t('studio.compute.error') }
  return { tone: 'idle', label: t('studio.compute.offline') }
}

export function TopBar(props) {
  const { t, view, setView, sessionState, session, quota, presets, form, patchForm, busy, probing, probe, probeReport, onStart, onStop, onProbe, onRefresh } = props
  const pill = sessionPill(t, sessionState)
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef(null)

  // 菜单：Esc 关闭，点外面也关闭——这不是模态，不该困住用户。
  React.useEffect(() => {
    if (!open) return undefined
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    function onDown(event) {
      const node = wrapRef.current
      if (node && !node.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const idleMinutes = session && session.idleTimeoutSec ? Math.round(session.idleTimeoutSec / 60) : 0
  const createTooltip =
    sessionState === 'provisioning'
      ? t('studio.compute.queuedTooltip')
      : sessionState === 'ready'
        ? t('studio.compute.idleTooltip')
        : t('studio.compute.offlineTooltip')
  const quotaUsed = quota && Number.isFinite(quota.usedHours) ? quota.usedHours : null
  const quotaTotal = quota && Number.isFinite(quota.totalHours) ? quota.totalHours : null
  const notReady = sessionState === 'absent' || sessionState === 'error'
  const activePreset = presets.find((item) => item.id === form.presetId) || null
  const probeInfo = probeStatusOf(probe || (probeReport && probeReport.probe))
  const probeFailed = probeReport && probeReport.status && probeReport.status !== 'ok' ? probeReport : null
  const probeNote = probeInfo && probeInfo.notes.length > 0 ? probeInfo.notes[0] : ''
  const statusText = (status) => {
    if (status === 'ok') return t('value.ok')
    if (status === 'failed') return t('value.failed')
    if (status === 'unavailable') return t('value.quotaUnavailable')
    return t('value.unknown')
  }

  return (
    <header className="ofs-topbar">
      <div className="ofs-brand" title={t('studio.nav.label')}>
        <span className="ofs-brand-mark" aria-hidden="true">
          <StudioIcon size={18} />
        </span>
        <span className="ofs-brand-name">{t('studio.brand')}</span>
        <span className="ofs-brand-sub">{t('studio.brandSub')}</span>
      </div>

      <nav className="ofs-tabs" aria-label={t('studio.tabs')}>
        <button type="button" className={view === 'studio' ? 'ofs-tab is-on' : 'ofs-tab'} onClick={() => setView('studio')}>
          <Icon name="sparkles" size={15} />
          {t('studio.tab.studio')}
        </button>
        <button type="button" className={view === 'gallery' ? 'ofs-tab is-on' : 'ofs-tab'} onClick={() => setView('gallery')}>
          <Icon name="images" size={15} />
          {t('studio.tab.gallery')}
        </button>
      </nav>

      <span className="ofs-grow" />

      {onRefresh ? (
        <button type="button" className="ofs-icon-btn" onClick={onRefresh} title={t('studio.refresh')} aria-label={t('studio.refresh')}>
          <Icon name="refresh" size={16} />
        </button>
      ) : null}

      <div className="ofs-pill-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`ofs-compute is-${pill.tone}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <i className={`ofs-dot is-${pill.tone}${pill.tone === 'ok' ? ' is-live' : ''}`} aria-hidden="true" />
          <span>{pill.label}</span>
          {quotaUsed !== null && quotaTotal !== null ? (
            <em>
              {quotaUsed} / {quotaTotal} {t('unit.hour')}
            </em>
          ) : null}
          <span className="ofs-pill-caret" aria-hidden="true">
            <Icon name="chevronDown" size={13} />
          </span>
        </button>

        <Tooltip t={t} text={createTooltip} side="bottom" />

        {open ? (
          <div className="ofs-popover" role="menu">
            <div className="ofs-popover-head">
              <span>
                <i className={`ofs-dot is-${pill.tone}`} aria-hidden="true" />
                <b>{pill.label}</b>
              </span>
              <span className="ofs-muted">
                {t('studio.compute.quota')} {quotaUsed !== null && quotaTotal !== null ? `${quotaUsed} / ${quotaTotal} ${t('unit.hour')}` : '—'}
              </span>
              {idleMinutes > 0 ? <span className="ofs-muted">{t('studio.compute.idleFor')} {idleMinutes} {t('unit.min')}</span> : null}
              {session && session.device ? <span className="ofs-muted">{session.device}</span> : null}
            </div>

            {probeInfo || probing || probeFailed ? (
              <div className="ofs-popover-note">
                {probing ? <span>{t('action.probing')}</span> : null}
                {probeInfo ? (
                  <>
                    <span>{t('studio.probe.cli')} · {statusText(probeInfo.cli)}</span>
                    <span>
                      {t('studio.probe.account')} · {statusText(probeInfo.auth)}
                      <Tooltip t={t} text={t('studio.compute.authTooltip')} tone="warn" side="bottom" />
                    </span>
                    <span>{t('studio.probe.quota')} · {statusText(probeInfo.quota)}</span>
                  </>
                ) : null}
                {probeFailed ? (
                  <span title={probeFailed.message || undefined}>
                    {probeFailed.status === 'timeout' ? t('studio.probe.timeout') : t('studio.probe.failed')}
                    {probeFailed.message ? ` · ${probeFailed.message}` : ''}
                  </span>
                ) : null}
                {probeNote ? <span title={probeInfo.notes.join(' · ')}>{probeNote}</span> : null}
              </div>
            ) : null}

            <button type="button" role="menuitem" className="ofs-popover-row" onClick={onStart} disabled={!!busy || !notReady}>
              <Icon name="cloud" size={15} />
              {t('studio.compute.start')}
            </button>
            <button type="button" role="menuitem" className="ofs-popover-row" onClick={onStop} disabled={!!busy || sessionState === 'absent'}>
              <Icon name="clock" size={15} />
              {t('studio.compute.stop')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="ofs-popover-row"
              onClick={onProbe}
              disabled={!!busy || probing}
              aria-busy={probing}
            >
              <Icon name="refresh" size={15} />
              {probing ? t('action.probing') : t('studio.compute.check')}
            </button>
          </div>
        ) : null}
      </div>

      <label className="ofs-preset">
        <Icon name="sliders" size={14} />
        <span className="ofs-preset-label">{t('studio.preset')}</span>
        <select
          value={form.presetId}
          disabled={presets.length === 0}
          aria-label={t('studio.preset')}
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
              {item.label || item.id}
            </option>
          ))}
        </select>
        <span className="ofs-preset-meta">{activePreset && activePreset.params ? activePreset.params : ''}</span>
        <Icon name="chevronDown" size={13} className="ofs-preset-caret" />
      </label>
    </header>
  )
}