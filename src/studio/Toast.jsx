/**
 * 右上角轻量通知区：
 *  1. 瞬时反馈（已提交 / 已复制 / 已带入参数等），几秒后自行消失；
 *  2. 非全局阻塞的可恢复异常（显存不足、单次生成失败、休眠/关机提示、通用失败），
 *     带快捷操作与关闭按钮，不挤占顶部横幅与工作区高度。
 */

import React from 'react'

import { Icon } from './icons.jsx'

function noticeSpecOf(t, kind, compute, actions) {
  if (!kind) return null
  const specs = {
    oom: {
      title: t('studio.guidance.oom.title'),
      action: { label: t('studio.guidance.oom.action'), run: actions && actions.resetToSafe },
    },
    sleep: {
      title: t('studio.guidance.sleep.title'),
      action: { label: t('studio.guidance.sleep.action'), run: compute && compute.startSession },
    },
    closed: {
      title: t('studio.guidance.closed.title'),
      action: { label: t('studio.guidance.sleep.action'), run: compute && compute.startSession },
    },
    generate: {
      title: t('studio.guidance.generic.title'),
      action: { label: t('studio.guidance.generic.action'), run: actions && actions.retryFocusedJob },
      logs: true,
    },
    generic: {
      title: t('studio.guidance.other.title'),
      logs: true,
    },
  }
  return specs[kind] || specs.generic
}

export function Toast(props) {
  const { toast, guidance, compute, actions, ui } = props
  const t = typeof props.t === 'function' ? props.t : (key) => key
  const kind = guidance && guidance.kind ? guidance.kind : ''
  const spec = kind ? noticeSpecOf(t, kind, compute, actions) : null
  if (!toast && !spec) return null

  const detail = guidance && guidance.detail ? guidance.detail : ''
  const dismiss = guidance && typeof guidance.dismiss === 'function' ? guidance.dismiss : null
  const openLogs = ui && typeof ui.openLogs === 'function' ? ui.openLogs : null
  const actionRun = spec && spec.action && typeof spec.action.run === 'function' ? spec.action.run : null

  return (
    <div className="ofs-toast-stack" aria-live="polite">
      {spec ? (
        <div className="ofs-toast ofs-toast--notice" role="alert">
          <span className="ofs-toast-icon" aria-hidden="true">
            <Icon name="alert" size={14} />
          </span>
          <div className="ofs-toast-body">
            <p className="ofs-toast-title">{spec.title}</p>
            {detail ? <p className="ofs-toast-detail" title={detail}>{detail}</p> : null}
            <div className="ofs-toast-actions">
              {actionRun ? (
                <button type="button" className="ofs-chip is-on" onClick={actionRun}>
                  {spec.action.label}
                </button>
              ) : null}
              {spec.logs && openLogs ? (
                <button type="button" className="ofs-chip" onClick={(event) => openLogs(event.currentTarget)}>
                  {t('studio.guidance.viewLogs')}
                </button>
              ) : null}
              {dismiss ? (
                <button type="button" className="ofs-chip" onClick={dismiss}>
                  {t('studio.guidance.close')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className="ofs-toast" role="status" key={toast.id}>
          {toast.text}
        </div>
      ) : null}
    </div>
  )
}