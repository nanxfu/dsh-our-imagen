/**
 * 运行日志抽屉：把远端 daemon 的安装 / 隧道 / 生成日志原样展示出来。
 *
 * - 由算力弹层的「查看运行日志」打开，Esc / 遮罩 / 关闭按钮都能关；
 * - 打开期间每 TIMEOUTS.clientLogsPollMs 增量轮询，关闭即停（数据域见 useStudioLogs）；
 * - 日志区等宽字体、自动滚到底，空态与不可用原因分开提示；
 * - 远程日志为空时展示 Host 本地滚动日志（已脱敏）并注明来源，会话未启动时也能排障；
 * - 「复制诊断信息」把版本、会话快照（不含 token）、probe、队列、远端日志与 Host 日志
 *   拼成纯文本，离线状态也能直接贴进 Issue。
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
  const hostLines = Array.isArray(logs.hostLines) ? logs.hostLines : []
  // 远端日志（含历史累计）为空时才用 Host 本地日志兜底，两者不混排。
  const showHost = logs.lines.length === 0 && hostLines.length > 0

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

  // 新日志到达后滚到底部（只操作真实 DOM，测试替身里 ref 为空）。
  React.useEffect(() => {
    const node = bodyRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [logs.lines.length, hostLines.length])

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
      lines: logs.lines,
      hostLogs: hostLines,
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
          {loading && logs.lines.length === 0 && !showHost ? (
            <p className="ofs-logs-note">{t('studio.logs.loading')}</p>
          ) : null}
          {empty && !showHost ? <p className="ofs-logs-note">{t('studio.logs.empty')}</p> : null}
          {unavailable ? (
            <p className="ofs-logs-note is-warn">{errorText(t, logs.reason) || t('error.code.logs_unavailable')}</p>
          ) : null}
          {logs.lines.length > 0 ? <pre className="ofs-logs-lines">{logs.lines.join('\n')}</pre> : null}
          {showHost ? <p className="ofs-logs-note">{t('studio.logs.hostNote')}</p> : null}
          {showHost ? <pre className="ofs-logs-lines">{hostLines.join('\n')}</pre> : null}
        </div>
      </div>
    </div>
  )
}