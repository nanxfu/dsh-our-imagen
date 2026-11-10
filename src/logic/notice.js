/**
 * 完成提醒：页面不可见期间任务完成时，用标签页标题做轻量提示。
 *
 * 纯函数，不依赖 React / DOM：输入前后两次任务快照、页面是否隐藏与当前标题，
 * 输出应设置的标题与是否需要提示；首次挂载（previous 为 undefined）不触发。
 */

/** 标签页标题前缀：圆点为几何符号，不是 emoji。 */
export const NOTICE_TITLE_PREFIX = '● 生成完成 · '

/** 去掉前缀，拿到原标题；没有前缀时原样返回。 */
export function stripNoticePrefix(title) {
  const value = typeof title === 'string' ? title : ''
  return value.startsWith(NOTICE_TITLE_PREFIX) ? value.slice(NOTICE_TITLE_PREFIX.length) : value
}

/**
 * 前后任务快照是否构成一次「新完成」：
 *  - next 必须已完成；
 *  - 首次挂载（previous 为空）不算，避免刷新页面时把旧结果当成刚完成；
 *  - 不同任务完成算；同一任务从进行中变为完成也算。
 */
export function isCompletion(previous, next) {
  if (!next || next.status !== 'done') return false
  if (!previous || typeof previous !== 'object') return false
  if (previous.id && next.id) {
    if (previous.id !== next.id) return true
    return previous.status !== 'done'
  }
  return previous.status !== 'done'
}

/**
 * 完成提醒决策。
 * @param {{ previous?: object, next?: object, hidden?: boolean, title?: string }} input
 * @returns {{ title: string, notify: boolean, completed: boolean }}
 *   notify 为 true 表示页面隐藏期间完成，调用方应写入 title 并在返回页面时恢复 + 提示；
 *   completed 为 true 表示检测到一次完成（页面可见时由其他通道提示）。
 */
export function completionNotice(input = {}) {
  const title = typeof input.title === 'string' ? input.title : ''
  const completed = isCompletion(input.previous, input.next)
  if (!completed) return { title, notify: false, completed: false }
  if (!input.hidden) return { title, notify: false, completed: true }
  // 已经带前缀时不重复叠加（连续完成多次也只保留一个圆点）。
  return { title: `${NOTICE_TITLE_PREFIX}${stripNoticePrefix(title)}`, notify: true, completed: true }
}