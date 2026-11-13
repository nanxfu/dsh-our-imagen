/** 底部最近生成栏：按批次聚合的创作轨迹 + 每个待执行任务的暗房计时卡。 */

import React from 'react'

import { Icon } from './icons.jsx'
import { formatDuration, jobElapsed } from '../logic/format.js'
import { isJobCancellable, isJobCancelling, jobCardClass } from '../logic/jobs.js'
import { jobProgressText } from '../logic/status.js'

/**
 * 接收 { t, ui, compute, library, now }；now 由 Studio 用 useNow 算好传入。
 *
 * 队列串行执行，但待执行的任务可能不止一个：每个任务各占一张卡，按真实执行顺序
 * 从左到右排列。第一张是正在跑的（带显影扫描光与已用时间），其余是排队中的
 * （虚线取景框里写位次，附已排队时长）——只展示真实阶段，不画假进度。
 *
 * 每张卡带取消按钮：queued / waiting-session 立即出队，running 合作式停止
 * （当前这张画完后不再提交剩余张数）。取消请求发出后按钮显示「正在停止…」并禁用，
 * 避免重复提交。
 */
export function Filmstrip(props) {
  const { t, ui, compute, library, now } = props
  const { setView } = ui
  const { pendingJobs, sessionState, startSession, status, cancelJob, cancellingIds } = compute
  const stopped = Boolean(status && status.stopped)
  const { batches, selected, selectImage } = library

  const selectedPath = selected && selected.image ? selected.image.path : ''

  return (
    <footer className="ofs-filmstrip">
      <div className="ofs-roll">
        {pendingJobs.map((job, index) => {
          const queued = job.status === 'queued'
          const cancelling = isJobCancelling(job, cancellingIds)
          const cancelLabel = t(cancelling ? 'studio.job.cancelling' : 'studio.job.cancel')
          // 时间缺失（老快照没有 createdAt）时宁可不写，也不要显示成「0.0秒」或「—」。
          const elapsedMs = jobElapsed(job, now)
          const elapsed = Number.isFinite(elapsedMs) ? formatDuration(t, elapsedMs) : ''
          return (
            <div
              className={jobCardClass(job, cancellingIds)}
              key={job.id}
              title={job.params && typeof job.params.prompt === 'string' ? job.params.prompt : undefined}
            >
              <span className="ofs-ghost-frame" aria-hidden="true">
                {queued
                  ? <span className="ofs-ghost-slot">{index + 1}</span>
                  : <span className="ofs-ghost-bar" />}
              </span>
              <span className="ofs-ghost-text">
                <span className="ofs-ghost-label">{jobProgressText(t, job, sessionState)}</span>
                {elapsed ? <span className="ofs-ghost-time">{elapsed}</span> : null}
              </span>
              {isJobCancellable(job) && typeof cancelJob === 'function' ? (
                <button
                  type="button"
                  className="ofs-ghost-cancel"
                  aria-label={cancelLabel}
                  title={cancelling ? cancelLabel : t('studio.job.cancelHint')}
                  disabled={cancelling}
                  onClick={() => cancelJob(job.id)}
                >
                  {cancelLabel}
                </button>
              ) : null}
            </div>
          )
        })}

        {batches.length === 0 && pendingJobs.length === 0 ? (
          <div className="ofs-filmstrip-empty">
            <div className="ofs-slots" aria-hidden="true">
              <span className="ofs-slot" />
              <span className="ofs-slot" />
              <span className="ofs-slot" />
            </div>
            <span>
              {sessionState === 'absent'
                ? (stopped ? t('studio.filmstrip.offlineClosed') : t('studio.filmstrip.offline'))
                : t('studio.filmstrip.empty')}
              {sessionState === 'absent' ? (
                <button type="button" className="ofs-link" onClick={startSession}>
                  {t('studio.compute.start')}
                </button>
              ) : null}
            </span>
          </div>
        ) : null}

        {batches.map((batch) => (
          <div className="ofs-batch" key={batch.key}>
            <div className="ofs-batch-thumbs">
              {batch.entries.map((entry) => {
                const path = entry.image.path || entry.image.file
                const active = path === selectedPath
                return (
                  <button
                    type="button"
                    key={path}
                    className={active ? 'ofs-thumb is-on' : 'ofs-thumb'}
                    onClick={() => selectImage(entry)}
                    title={batch.prompt || path}
                  >
                    <img src={entry.image.url} alt={batch.prompt || entry.image.file || t('studio.image.alt')} loading="lazy" />
                  </button>
                )
              })}
            </div>
            <span className="ofs-batch-meta">
              {batch.presetId ? <em>{batch.presetId}</em> : <em />}
              <span>
                {batch.entries.length} {t('unit.image')}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="ofs-filmstrip-side">
        <button type="button" className="ofs-filmstrip-link" onClick={() => setView('gallery')}>
          <Icon name="images" size={15} />
          {t('studio.gallery.title')}
          <Icon name="chevronRight" size={13} />
        </button>
      </div>
    </footer>
  )
}
