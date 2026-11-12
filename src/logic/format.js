/** 时长、任务耗时与计数文案格式化。 */

/**
 * 文案占位符替换：字典是纯键值对、没有插值机制，需要计数的文案统一用 `{name}` 占位。
 * 找不到对应值时保留占位符本身，便于测试直接发现字段名拼错。
 */
export function formatText(template, values) {
  const text = typeof template === 'string' ? template : ''
  if (!text) return ''
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values ? values[name] : undefined
    return value === undefined || value === null ? match : String(value)
  })
}

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
  // 统一保留 1 位小数：顶栏模型卡、舞台曝光单与算力弹层必须给出同一个精度（27.8 不取整成 28）。
  return `${value.toFixed(1)}${t('unit.second')}`
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
