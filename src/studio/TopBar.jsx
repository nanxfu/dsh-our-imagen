/** 工作台顶栏：品牌、视图切换、云端状态与配额、模型预设。 */

import React from 'react'

import { Tooltip } from '../components/Tooltip.jsx'
import { useNow } from '../hooks/useNow.js'
import { formatDuration, formatSeconds } from '../logic/format.js'
import { elapsedMsSince, formatClockTime, quotaText } from '../logic/logs.js'
import { computeStatusOf } from '../logic/status.js'
import { Icon } from './icons.jsx'
import { StudioIcon } from './StudioIcon.jsx'
import { accountStatusOf, probeStatusOf } from '../logic/probe.js'
import { useHostSnapshot } from './hooks/useStudioLogs.js'

/** Kaggle 账户设置页：配额读不到时给用户一个直达入口。 */
const KAGGLE_ACCOUNT_URL = 'https://www.kaggle.com/settings'

/** 接收 { t, ui, compute, form, library }；ui/compute/form/library 是领域对象。 */
export function TopBar(props) {
  const { t, ui, compute, library } = props
  const { form: fields, patchForm } = props.form
  const { view, setView, openLogs } = ui
  const {
    sessionState,
    session,
    quota,
    presets,
    busy,
    probing,
    probe,
    probeReport,
    startSession,
    stopSession,
    runProbe,
    openFolder,
  } = compute
  // 云端状态只走 computeStatusOf：顶栏胶囊与状态条、弹层共用同一份标签与提示。
  const status = compute.status || computeStatusOf(t, { session })
  // defaultOpen 只给预览 / 渲染测试用，正式界面从关闭态开始。
  const [open, setOpen] = React.useState(Boolean(props.defaultOpen))
  const wrapRef = React.useRef(null)
  const pillRef = React.useRef(null)
  // 配额回退与隧道信息需要 /state 里的 probeLastGood 等字段：弹层展开时取一次快照。
  const snapshot = useHostSnapshot(open)
  const now = useNow(open)

  // 菜单：Esc 与点击外部都关闭。
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
  const quotaUsed = quota && Number.isFinite(quota.usedHours) ? quota.usedHours : null
  const quotaTotal = quota && Number.isFinite(quota.totalHours) ? quota.totalHours : null
  const activePreset = presets.find((item) => item.id === fields.presetId) || null
  // 速度只讲实测值，且优先讲云端已加载的模型；没有测量数据的预设不编时间。
  const loadedPreset = presets.find((item) => item.id === (session && session.presetId)) || activePreset
  // 客户端预设有两代形状：公开视图是扁平 steadySeconds，旧测试替身放在 measured 里。
  const steadyRaw = loadedPreset && loadedPreset.steadySeconds !== undefined
    ? loadedPreset.steadySeconds
    : loadedPreset && loadedPreset.measured ? loadedPreset.measured.steadySeconds : null
  const steadySeconds = Number.isFinite(steadyRaw) ? steadyRaw : null
  // 状态弹层优先用宿主轮询到的 probe；刚做过检查时用本次结果兜底。
  const probePayload = probe || (snapshot && snapshot.probe) || (probeReport && probeReport.probe) || null
  const probeInfo = probeStatusOf(probePayload)
  // 账号状态不只看探测：会话能启动、能出图同样证明凭据有效；从未探测时显示「未检查」，
  // 不能默认成「不可用」（可出图却提示账号不可用属于误报）。
  const accountStatus = accountStatusOf(probePayload, sessionState)
  const probeFailed = probeReport && probeReport.status && probeReport.status !== 'ok' ? probeReport : null
  const probeNote = probeInfo && probeInfo.notes.length > 0 ? probeInfo.notes[0] : ''
  // 配额不可读（接口不可用或本次检测失败）时改用本地统计回退展示。
  const quotaUnavailable = Boolean(probeFailed || (probeInfo && probeInfo.quota !== 'ok'))
  const lastGood = (snapshot && snapshot.probeLastGood) || null
  const lastCheckTime = formatClockTime(snapshot && snapshot.probeLastGoodAt)
  const lastGoodQuota = quotaText(lastGood && lastGood.quota)
  const sessionRunMs = session ? elapsedMsSince(session.startedAt, now) : null
  const tunnelProvider = session && session.tunnelProvider ? session.tunnelProvider : ''
  const tunnelLabel =
    tunnelProvider === 'cloudflare'
      ? t('studio.compute.tunnel.cloudflare')
      : tunnelProvider === 'custom'
        ? t('studio.compute.tunnel.custom')
        : ''
  const statusText = (value) => {
    if (value === 'ok') return t('value.ok')
    if (value === 'failed') return t('value.failed')
    if (value === 'unavailable') return t('value.quotaUnavailable')
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

      {openFolder ? (
        <button
          type="button"
          className="ofs-icon-btn"
          onClick={openFolder}
          title={t('studio.action.openFolder')}
          aria-label={t('studio.action.openFolder')}
        >
          <Icon name="folder" size={16} />
        </button>
      ) : null}

      {library.loadHistory ? (
        <button type="button" className="ofs-icon-btn" onClick={library.loadHistory} title={t('studio.refresh')} aria-label={t('studio.refresh')}>
          <Icon name="refresh" size={16} />
        </button>
      ) : null}

      <div className="ofs-pill-wrap" ref={wrapRef}>
        <button
          ref={pillRef}
          type="button"
          className={`ofs-compute is-${status.tone}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <i className={`ofs-dot is-${status.tone}${status.tone === 'ok' || status.tone === 'warn' ? ' is-live' : ''}`} aria-hidden="true" />
          <span>{status.label}</span>
          {quotaUsed !== null && quotaTotal !== null ? (
            <em>
              {quotaUsed} / {quotaTotal} {t('unit.hour')}
            </em>
          ) : null}
          <span className="ofs-pill-caret" aria-hidden="true">
            <Icon name="chevronDown" size={13} />
          </span>
        </button>

        {open ? (
          <div className="ofs-popover" role="menu">
            <div className="ofs-popover-head">
              <span>
                <i className={`ofs-dot is-${status.tone}${status.tone === 'ok' || status.tone === 'warn' ? ' is-live' : ''}`} aria-hidden="true" />
                <b>{status.label}</b>
                <Tooltip text={status.tooltip} side="bottom" />
              </span>
              <span className="ofs-muted">
                {t('studio.compute.quota')} {quotaUsed !== null && quotaTotal !== null ? `${quotaUsed} / ${quotaTotal} ${t('unit.hour')}` : '—'}
              </span>
              {status.phaseLabel ? <span className="ofs-muted">{t('studio.compute.phase')} · {status.phaseLabel}</span> : null}
              {status.ready && steadySeconds !== null ? (
                <span className="ofs-muted">{t('studio.compute.speedLine')} {formatSeconds(t, steadySeconds)}</span>
              ) : null}
              {idleMinutes > 0 ? <span className="ofs-muted">{t('studio.compute.idleFor')} {idleMinutes} {t('unit.min')}</span> : null}
              {session && session.device ? <span className="ofs-muted">{session.device}</span> : null}
              {tunnelLabel ? <span className="ofs-muted">{t('studio.compute.tunnel')} · {tunnelLabel}</span> : null}
            </div>

            {/* 当前阶段的一句话说明：排队/连接/预热分别是不同的等待原因，不能混用同一条提示。 */}
            {status.hint ? <p className="ofs-popover-hint">{status.hint}</p> : null}

            <div className="ofs-popover-note">
              {probing ? <span>{t('action.probing')}</span> : null}
              {probeInfo ? (
                <>
                  <span>{t('studio.probe.cli')} · {statusText(probeInfo.cli)}</span>
                  <span>{t('studio.probe.quota')} · {statusText(probeInfo.quota)}</span>
                </>
              ) : null}
              {/* 手机号绑定警告在任何状态下都要能查到，所以账号行常驻；状态由探测与会话结果共同判定。 */}
              <span>
                {t('studio.probe.account')} · {statusText(accountStatus)}
                <Tooltip text={t('studio.compute.authTooltip')} tone="warn" side="bottom" />
              </span>
              {probeFailed ? (
                <span title={probeFailed.message || undefined}>
                  {probeFailed.status === 'timeout' ? t('studio.probe.timeout') : t('studio.probe.failed')}
                  {probeFailed.message ? ` · ${probeFailed.message}` : ''}
                </span>
              ) : null}
              {probeNote ? <span title={probeInfo.notes.join(' · ')}>{probeNote}</span> : null}
            </div>

            {/* 配额不可读时改看本地统计：最近一次成功检查、当时配额与本次会话运行时长。 */}
            {quotaUnavailable ? (
              <div className="ofs-popover-fallback">
                <span className="ofs-popover-fallback-title">{t('studio.compute.quotaFallback')}</span>
                {lastCheckTime ? (
                  <span>
                    {t('studio.compute.lastGood')} {lastCheckTime} · {t('studio.compute.quota')} {lastGoodQuota}
                  </span>
                ) : (
                  <span>{t('studio.compute.neverChecked')}</span>
                )}
                {sessionRunMs !== null ? (
                  <span>{t('studio.compute.sessionRan')} {formatDuration(t, sessionRunMs)}</span>
                ) : null}
                <a
                  className="ofs-popover-link"
                  href={KAGGLE_ACCOUNT_URL}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                >
                  {t('studio.compute.kaggleSettings')}
                </a>
              </div>
            ) : null}

            <button type="button" role="menuitem" className="ofs-popover-row" onClick={startSession} disabled={!!busy || !status.canStart}>
              <Icon name="cloud" size={15} />
              {t('studio.compute.start')}
            </button>
            <button type="button" role="menuitem" className="ofs-popover-row" onClick={stopSession} disabled={!!busy || !status.canStop}>
              <Icon name="clock" size={15} />
              {t('studio.compute.stop')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="ofs-popover-row"
              onClick={runProbe}
              disabled={!!busy || probing}
              aria-busy={probing}
            >
              <Icon name="refresh" size={15} />
              {probing ? t('action.probing') : t('studio.compute.check')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="ofs-popover-row"
              onClick={() => {
                setOpen(false)
                // 菜单收起后这一行会卸载，焦点交还给常驻的算力按钮。
                if (openLogs) openLogs(pillRef.current)
              }}
            >
              <Icon name="message" size={15} />
              {t('studio.logs.open')}
            </button>
          </div>
        ) : null}
      </div>

      <label className="ofs-preset">
        <Icon name="sliders" size={14} />
        <span className="ofs-preset-label">{t('studio.preset')}</span>
        <select
          value={fields.presetId}
          disabled={presets.length === 0}
          aria-label={t('studio.preset')}
          onChange={(event) => {
            const id = event.target.value
            const next = presets.find((item) => item.id === id)
            patchForm({
              presetId: id,
              ...(next
                ? {
                    width: next.size || fields.width,
                    height: next.size || fields.height,
                    steps: next.steps ?? fields.steps,
                    cfg: next.cfg ?? fields.cfg,
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