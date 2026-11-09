/** 时长与任务耗时格式化。 */

export function formatDuration(t, ms) {
  const value = Number(ms)
  if (!Number.isFinite(value)) return '—'
  const seconds = Math.max(0, value) / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}${t('unit.second')}`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest > 0 ? `${minutes}${t('unit.min')} ${rest}${t('unit.second')}` : `${minutes}${t('unit.min')}`
}

export function formatSeconds(t, seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value)) return '—'
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${t('unit.second')}`
}

export function jobElapsed(job, now) {
  if (!job) return null
  if (job.status === 'done' || job.status === 'failed') {
    const seconds = Number(job.seconds)
    if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000
    const start = Date.parse(job.startedAt ?? job.createdAt ?? '')
    const end = Date.parse(job.finishedAt ?? '')
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, end - start)
    return null
  }
  const start = Date.parse(job.startedAt ?? job.createdAt ?? '')
  return Number.isFinite(start) ? Math.max(0, now - start) : null
}
