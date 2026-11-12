/**
 * 窄屏排队胶囊：≤820px 时底部胶片条整条收起，这里保留一个迷你状态入口，
 * 让用户仍能看到当前任务与后续排队数量。宽屏由 CSS 隐藏，信息由胶片条承担。
 */

import { formatText } from '../logic/format.js'
import { jobProgressText } from '../logic/status.js'
import { localized } from '../i18n.js'

/** 接收 { t, compute }；compute 与 Filmstrip 同源。 */
export function QueuePill(props) {
  const { t, compute } = props
  const pendingJobs = compute && Array.isArray(compute.pendingJobs) ? compute.pendingJobs : []
  if (pendingJobs.length === 0) return null
  const activeJob = compute.activeJob || pendingJobs[0]
  const waiting = pendingJobs.length - 1
  return (
    // 不用 role="status"：窄屏上舞台进度胶囊已经在播报同一条进度，避免重复朗读。
    <div className="ofs-queue-pill">
      <i className="ofs-dot is-warn is-live" aria-hidden="true" />
      <span className="ofs-queue-pill-label">{jobProgressText(t, activeJob, compute.sessionState)}</span>
      {waiting > 0 ? (
        <span className="ofs-queue-pill-count">
          {formatText(localized(t, 'studio.queue.waiting'), { count: waiting })}
        </span>
      ) : null}
    </div>
  )
}
