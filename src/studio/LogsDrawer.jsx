/**
 * 运行日志抽屉：把远端 daemon 的安装 / 隧道 / 生成日志原样展示出来。
 *
 * - 由算力弹层的「查看运行日志」打开，Esc / 遮罩 / 关闭按钮都能关；
 * - 打开期间每 TIMEOUTS.clientLogsPollMs 增量轮询，关闭即停（数据域见 useStudioLogs）；
 * - 双视图：header 里「远端日志 / Host 日志」手动切换（ofs-chip + aria-pressed），默认远端；
 *   远端为空且 Host 有内容时自动兜底到 Host 日志并保留来源说明，用户手动切换后尊重选择、
 *   不再自动跳转（数据继续轮询，只是视图不跟着跳）；
 * - 日志区等宽字体、自动滚到底，空态与不可用原因分开提示；
 * - 「复制诊断信息」把版本、环境指纹、会话快照（不含 token）、probe、队列、远端日志与
 *   Host 日志拼成纯文本，离线状态也能直接贴进 Issue。
 *
 * 接收 { t, ui, compute, logs, onClose } 领域对象。
 */

import React from 'react'

import { VERSION } from '../../shared/contract.js'

import { Icon } from './icons.jsx'
import { errorText } from '../logic/error.js'
import { buildDiagnostics } from '../logic/logs.js'
import { useHostSnapshot } from './hooks/useStudioLogs.js'

/** 弹层内可聚焦元素（焦点陷阱用）。 */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function LogsDrawer(props) {
  const { t, ui, compute, logs, onClose } = props
  const panelRef = React.useRef(null)
  const closeRef = React.useRef(null)
  const bodyRef = React.useRef(null)
  // 诊断信息需要 probeLastGood / queue / version：打开时向 /state 取一次最新快照。
  const snapshot = useHostSnapshot(true)
  // 老调用方不传 hostLines 时当作空数组，行为与改造前一致。
  const remoteLines = Array.isArray(logs.lines) ? logs.lines : []
  const hostLines = Array.isArray(logs.hostLines) ? logs.hostLines : []
  // manualView 为 null 表示跟随自动兜底；用户点过标签页后固定为 'remote' / 'host'。
  const [manualView, setManualView] = React.useState(null)
  // 自动兜底：远端为空且 Host 有内容时展示 Host 日志，避免会话未启动时抽屉一片空白。
  const autoView = remoteLines.length === 0 && hostLines.length > 0 ? 'host' : 'remote'
  const view = manualView ?? autoView
  const showingHost = view === 'host'
  const autoFallback = manualView === null && autoView === 'host'
  const visibleLines = showingHost ? hostLines : remoteLines

  // Esc 关闭 + Tab 在弹层内循环；打开时焦点落到关闭按钮。
  React.useEffect(() => {
    if (closeRef.current && typeof closeRef.current.focus === 'function') closeRef.current.focus()

    function onKey(event) {
      if (event.key === 'Escape') {
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel || typeof panel.querySelectorAll !== 'function') return
      const nodes = Array.prototype.slice
        .call(panel.querySelectorAll(FOCUSABLE))
        .filter((node) => !node.disabled && node.getAttribute('aria-hidden') !== 'true')
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const outside = !panel.contains || !panel.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        if (event.preventDefault) event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        if (event.preventDefault) event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 切换视图或新日志到达后滚到底部（只操作真实 DOM，测试替身里 ref 为空）。
  React.useEffect(() => {
    const node = bodyRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [view, remoteLines.length, hostLines.length])

  function copyDiagnostics() {
    const context = snapshot || {}
    const session = context.session || (compute && compute.session) || null
    const probe = context.probe || (compute && compute.probe) || null
    const text = buildDiagnostics(t, {
      version: context.version || VERSION,
      session,
      probe,
      probeLastGood: context.probeLastGood,
      probeLastGoodAt: context.probeLastGoodAt,
      queue: context.queue,
      lastJob: context.lastJob,
      lines: remoteLines,
      hostLogs: hostLines,
      env: logs.env,
      now: Date.now(),
    })
    ui.copyText(text, 'studio.logs.copied')
  }

  const loading = logs.status === 'loading' || logs.status === 'idle'
  const unavailable = logs.status === 'unavailable'
  const empty = logs.status === 'empty'

  return (
    <div className="ofs-logs" role="presentation" onClick={onClose}>
      <div
        className="ofs-logs-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('studio.logs.title')}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ofs-logs-head">
          <span className="ofs-logs-title">{t('studio.logs.title')}</span>
          <div className="ofs-logs-tabs" role="group" aria-label={t('studio.logs.title')}>
            <button
              type="button"
              className={`ofs-chip ofs-logs-tab${showingHost ? '' : ' is-on'}`}
              aria-pressed={!showingHost}
              onClick={() => setManualView('remote')}
            >
              {t('studio.logs.tab.remote')}
            </button>
            <button
              type="button"
              className={`ofs-chip ofs-logs-tab${showingHost ? ' is-on' : ''}`}
              aria-pressed={showingHost}
              onClick={() => setManualView('host')}
            >
              {t('studio.logs.tab.host')}
            </button>
          </div>
          <span className="ofs-grow" />
          <button type="button" className="ofs-chip ofs-logs-copy" onClick={copyDiagnostics}>
            <Icon name="copy" size={13} />
            {t('studio.logs.copy')}
          </button>
          <button
            ref={closeRef}
            type="button"
            className="ofs-icon-btn"
            onClick={onClose}
            title={t('studio.logs.close')}
            aria-label={t('studio.logs.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="ofs-logs-body" ref={bodyRef} role="log">
          {autoFallback ? (
            <p className="ofs-logs-fallback" role="status">{t('studio.logs.hostFallbackTitle')}</p>
          ) : null}
          {loading && !showingHost && remoteLines.length === 0 ? (
            <p className="ofs-logs-note">{t('studio.logs.loading')}</p>
          ) : null}
          {unavailable ? (
            <p className="ofs-logs-note is-warn">{errorText(t, logs.reason) || t('error.code.logs_unavailable')}</p>
          ) : null}
          {!showingHost && empty && remoteLines.length === 0 ? (
            <p className="ofs-logs-note">{t('studio.logs.empty')}</p>
          ) : null}
          {showingHost && hostLines.length === 0 ? (
            <p className="ofs-logs-note">{t('studio.logs.hostEmpty')}</p>
          ) : null}
          {showingHost && hostLines.length > 0 ? (
            <p className="ofs-logs-note">{t('studio.logs.hostNote')}</p>
          ) : null}
          {visibleLines.length > 0 ? <pre className="ofs-logs-lines">{visibleLines.join('\n')}</pre> : null}
        </div>
      </div>
    </div>
  )
}
