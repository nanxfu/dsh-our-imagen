/** 对话页头部徽章。 */

import { h } from '../runtime.js'
import { styles } from '../theme.js'
import { translator } from '../i18n.js'
import { jobStatusText } from '../logic/status.js'
import { jobColor } from '../logic/color.js'
import { activeJobOf } from '../logic/jobs.js'
import { buildSessionView } from '../logic/view.js'
import { useHostState } from '../hooks/useHostState.js'

export function StatusChip(props) {
  const t = translator(props)
  const host = useHostState()
  const state = host.state
  const session = (state && state.session) || null
  const view = buildSessionView(t, {
    session,
    probe: state && state.probe,
    defaultPreset: state && state.defaultPreset,
    sessionBusy: '',
    probeBusy: false,
  })
  const running = activeJobOf(state)
  const label = running ? jobStatusText(t, running.status) : view.headline
  const color = running ? jobColor(running.status) : view.color
  const title = [
    running ? jobStatusText(t, running.status) : '',
    view.ended ? t('workbench.restartSession') : '',
    view.warming ? t('error.code.warming') : '',
    view.stateText,
    view.note,
    view.chipLabel,
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
