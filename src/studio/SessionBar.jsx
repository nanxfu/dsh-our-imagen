/**
 * 云端状态条：过渡态（申请 GPU / 连接 / 准备模型 / 关闭）下常驻一行，
 * 说明当前在等什么、还要等多久，并显示已等待时长。
 *
 * 只在会话过渡态出现；就绪、未启动与异常由顶栏胶囊和指引卡负责。
 */

import { formatDuration } from '../logic/format.js'

/** 接收 { t, status, elapsedMs }；elapsedMs 由 Studio 用 useNow 算好传入。 */
export function SessionBar(props) {
  const { t, status, elapsedMs } = props
  if (!status || status.transient !== true) return null
  const showElapsed = status.starting && Number.isFinite(elapsedMs) && elapsedMs > 0
  return (
    <div className={`ofs-sessionbar is-${status.tone}`} role="status" aria-live="polite">
      <i
        className={`ofs-dot is-${status.tone}${status.tone === 'ok' || status.tone === 'warn' ? ' is-live' : ''}`}
        aria-hidden="true"
      />
      <b className="ofs-sessionbar-label">{status.label}</b>
      {status.hint ? <span className="ofs-sessionbar-hint" title={status.hint}>{status.hint}</span> : null}
      {showElapsed ? (
        <span className="ofs-sessionbar-time">
          {t('studio.session.elapsed')} {formatDuration(t, elapsedMs)}
        </span>
      ) : null}
    </div>
  )
}
