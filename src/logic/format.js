/** 时长、任务耗时与计数文案格式化。 */

/**
 * 覆盖率（0~1）→ 界面百分比读数。
 *
 * 不足 10% 时保留一位小数，避免刚涂一点就显示 0%；超过 100% 按 100% 截断。
 * 涂抹 / 扩图画布与提交栏共用这一个口径，读数不会因组件不同而互相漂移。
 */
export function percentOf(coverage) {
  const value = Number(coverage)
  if (!Number.isFinite(value) || value <= 0) return 0
  const percent = Math.min(100, value * 100)
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
}

/**
 * 正数像素值（四舍五入）；缺失 / 非法 / 非正数返回 null。
 *
 * 「缺失」按 null 处理而不是回落到某个默认尺寸：调用方用 `??` 串起多个候选来源
 * （产物像素 → 参数 → 预设推荐值），这里返回 0 会把后续兜底全部短路掉。
 */
export function positiveSize(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number)
}

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
