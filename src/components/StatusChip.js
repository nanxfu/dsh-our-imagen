/** 对话页头部徽章：与工作台顶栏共用同一套云端状态文案。 */

import { h } from '../runtime.js'
import { styles } from '../theme.js'
import { translator } from '../i18n.js'
import { computeStatusOf, jobStatusText } from '../logic/status.js'
import { jobColor, toneColor } from '../logic/color.js'
import { activeJobOf } from '../logic/jobs.js'
import { useHostState } from '../hooks/useHostState.js'

export function StatusChip(props) {
  const t = translator(props)
  const host = useHostState()
  const state = host.state
  const session = (state && state.session) || null
  // 状态文案只走 computeStatusOf，避免对话页显示「排队中」而工作台显示「正在申请 GPU」。
  const status = computeStatusOf(t, { session })
  const running = activeJobOf(state)
  const label = running ? jobStatusText(t, running.status) : status.label
  const color = running ? jobColor(running.status) : toneColor(status.tone)
  const title = [
    running ? jobStatusText(t, running.status) : '',
    status.label,
    status.hint,
  ]
    .filter(Boolean)
    .join(' · ')

  return h(
    'span',
    { style: styles.headerChip, title },
    h('span', { style: styles.dot(color) }),
    h('span', { style: styles.headerChipText }, label),
  )
}
