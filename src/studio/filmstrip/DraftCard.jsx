/**
 * 新建绘图草稿卡（展示组件，阶段十三整合时由 Filmstrip 放在作品条最左端）。
 *
 * 表示「一张尚未生成的新画布」：取景框按当前表单画幅比例展示，下方是画幅与预设标签。
 * `pending` 为真时（任务已提交、草稿正在排队/生成）卡片转成等待态，位置由排队卡接替。
 *
 * 阶段十五 Phase A1：同一张卡也承载「未提交草稿」托管态（§6.1.2 / §6.1.4）：
 *  - `draft` 为真 → 卡片显示「未提交草稿」，并在有来源作品时补一行「源自此图」；
 *  - `active` 为真 → 当前处于新建画布焦点（正在配置新画布，或点开草稿后进入编辑）；
 *  - 两者都有 → 草稿恢复焦点。
 * 再点这张卡即恢复草稿内容继续编辑（由组合层 actions.focusNewDraft 处理）。
 *
 * 文案由阶段二从词典组装后经 labels 传入（组件内不直接调用 t()）：
 *
 * @param {{
 *   labels: {
 *     title: string, hint: string, active: string, pending: string,
 *     ratio: string, preset: string,
 *     unsaved?: string, from?: string, fromPrompt?: string,
 *   },
 *   width?: number, height?: number,     // 当前表单画幅（取景框比例与标签）
 *   presetLabel?: string,                // 当前预设展示名
 *   prompt?: string,                     // 当前提示词（作 title，便于悬停确认）
 *   active?: boolean,                    // 当前是否处于显式新建态（高亮）
 *   pending?: boolean,                   // 已提交、等待出图
 *   draft?: boolean,                     // 有未提交草稿（显示「未提交草稿」）
 *   draftFrom?: string,                  // 草稿来源作品的提示词（title 用「源自：…」）
 *   draftFromSource?: boolean,           // 草稿是否有来源作品（决定是否显示「源自此图」）
 *   onClick?: () => void,
 * }} props
 *
 * 取景框最大边长 34px，按宽高比收缩到卡片内，把底部状态字样留出独立空间不压线。
 */

import React from 'react'

import { Icon } from '../icons.jsx'

const FRAME_BOX = 34

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
  const draft = Boolean(props.draft)
  const draftFrom = typeof props.draftFrom === 'string' ? props.draftFrom.trim() : ''
  const fromSource = props.draftFromSource === true || Boolean(draftFrom)
  const classes = ['ofs-draft-card']
  if (active) classes.push('is-on')
  if (pending) classes.push('is-pending')
  if (draft) classes.push('has-draft')
  // 状态文案优先级：等待出图 > 未提交草稿 > 新建画布焦点 > 普通入口。
  const stateText = pending
    ? pickText(labels.pending, '已提交，等待出图')
    : (draft
      ? pickText(labels.unsaved, '未提交草稿')
      : (active ? pickText(labels.active, '正在填写新画布') : pickText(labels.hint, '新建绘图')))
  const fromText = draft && fromSource ? pickText(labels.from, '源自此图') : ''
  const fromTitle = draftFrom
    ? pickText(labels.fromPrompt, '源自：{prompt}').split('{prompt}').join(draftFrom)
    : ''
  const title = pending
    ? pickText(labels.title, '新建绘图')
    : (fromTitle || props.prompt || pickText(labels.title, '新建绘图'))

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
          <Icon name={pending ? 'clock' : (draft ? 'focus' : 'plus')} size={12} />
        </span>
        {fromText ? <span className="ofs-draft-from">{fromText}</span> : null}
        <span className="ofs-draft-state">{stateText}</span>
      </span>
      <span className="ofs-draft-meta">
        <em>{ratioText}</em>
        {props.presetLabel ? <span className="ofs-draft-preset">{props.presetLabel}</span> : null}
      </span>
    </button>
  )
}
