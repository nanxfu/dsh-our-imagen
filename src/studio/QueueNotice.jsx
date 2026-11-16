/**
 * 排队卡住提示（10 分钟档）：非错误态的顶部横幅。
 *
 * 本机历史日志里，正常会话大多在推送后几十秒内完成隧道会合（样本很少，只作为提示依据）；
 * 排队超过卡住档时，这条排队卡住的可能性明显变大，但并非确定结论。所以这里不按错误处理：
 *   - 色调是「等待」而不是「异常」，不阻挡工作区；
 *   - 主操作「换新实例重排」= forceNew + replace（Host 删除旧 Kernel 后重新推送）；
 *   - 次操作「继续等待」只收起卡片，不改变会话、不影响任务。
 *
 * 卡片是否展示、按哪个轮次去重由组合层决定（见 useStudio 的 queueNotice），
 * 本组件只负责画。接收 { t, notice }，notice 形状：{ minutes, dismiss, requeue }。
 */

import React from 'react'

import { formatText } from '../logic/format.js'
import { Icon } from './icons.jsx'

export function QueueNotice(props) {
  const { t, notice } = props
  if (!notice) return null
  const minutes = Number.isFinite(notice.minutes) ? notice.minutes : 10
  const title = formatText(t('studio.queue.notice.title'), { minutes })
  return (
    <div className="ofs-guidance ofs-queue-notice" role="status" aria-live="polite">
      <span className="ofs-guidance-icon">
        <Icon name="clock" size={15} />
      </span>
      <div className="ofs-guidance-body">
        <p className="ofs-guidance-title">{title}</p>
        <p className="ofs-guidance-note">{t('studio.queue.notice.note')}</p>
        <div className="ofs-guidance-actions">
          {typeof notice.requeue === 'function' ? (
            <button type="button" className="ofs-chip is-on" onClick={notice.requeue}>
              {t('studio.queue.notice.requeue')}
            </button>
          ) : null}
          {typeof notice.dismiss === 'function' ? (
            <button type="button" className="ofs-chip" onClick={notice.dismiss}>
              {t('studio.queue.notice.wait')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
