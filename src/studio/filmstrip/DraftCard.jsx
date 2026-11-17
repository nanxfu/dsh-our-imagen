/**
 * 新建绘图草稿卡（展示组件，阶段十三整合时由 Filmstrip 放在作品条最左端）。
 *
 * 表示「一张尚未生成的新画布」：取景框按当前表单画幅比例展示，下方是画幅与预设标签。
 * `pending` 为真时（任务已提交、草稿正在排队/生成）卡片转成等待态，位置由排队卡接替。
 *
 * 文案由阶段二从词典组装后经 labels 传入（组件内不直接调用 t()）：
 *
 * @param {{
 *   labels: {
 *     title: string, hint: string, active: string, pending: string,
 *     ratio: string, preset: string,
 *   },
 *   width?: number, height?: number,     // 当前表单画幅（取景框比例与标签）
 *   presetLabel?: string,                // 当前预设展示名
 *   prompt?: string,                     // 当前提示词（作 title，便于悬停确认）
 *   active?: boolean,                    // 当前是否处于显式新建态（高亮）
 *   pending?: boolean,                   // 已提交、等待出图
 *   onClick?: () => void,
 * }} props
 *
 * 取景框最大边长 46px，按宽高比收缩到卡片内：竖图更窄、横图更扁，不撑破 62px 的卡位。
 */

import React from 'react'

import { Icon } from '../icons.jsx'

const FRAME_BOX = 46

function pickText(value, fallback) {
  return typeof value === 'string' && value ? value : fallback
}

function sizeOf(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0
}

export function DraftCard(props) {
  const labels = props.labels && typeof props.labels === 'object' ? props.labels : {}
  const width = sizeOf(props.width) || 1024
  const height = sizeOf(props.height) || 1024
  const ratio = width / height
  const viewfinderWidth = Math.max(12, ratio >= 1 ? FRAME_BOX : Math.round(FRAME_BOX * ratio))
  const viewfinderHeight = Math.max(12, ratio >= 1 ? Math.round(FRAME_BOX / ratio) : FRAME_BOX)
  const ratioText = (() => {
    const template = pickText(labels.ratio, '{width} × {height}')
    return template.split('{width}').join(String(width)).split('{height}').join(String(height))
  })()
  const active = Boolean(props.active)
  const pending = Boolean(props.pending)
  const classes = ['ofs-draft-card']
  if (active) classes.push('is-on')
  if (pending) classes.push('is-pending')
  const stateText = pending
    ? pickText(labels.pending, '已提交，等待出图')
    : (active ? pickText(labels.active, '正在填写新画布') : pickText(labels.hint, '新建绘图'))
  const title = props.prompt || pickText(labels.title, '新建绘图')

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-pressed={active}
      title={title}
      onClick={() => {
        if (typeof props.onClick === 'function') props.onClick()
      }}
    >
      <span className="ofs-draft-frame">
        <span
          className="ofs-draft-viewfinder"
          style={{ width: `${viewfinderWidth}px`, height: `${viewfinderHeight}px` }}
          aria-hidden="true"
        >
          <Icon name={pending ? 'clock' : 'plus'} size={12} />
        </span>
        <span className="ofs-draft-state">{stateText}</span>
      </span>
      <span className="ofs-draft-meta">
        <em>{ratioText}</em>
        {props.presetLabel ? <span className="ofs-draft-preset">{props.presetLabel}</span> : null}
      </span>
    </button>
  )
}
