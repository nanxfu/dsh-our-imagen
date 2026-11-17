/**
 * 舞台底部动作坞（图片处理组 + 创作复用组）。
 *
 * 结构约定（渲染测试按类名断言，勿改）：
 *   .ofs-dock
 *     ├─ .ofs-dock-group[data-group="process"] > button.ofs-dock-button × N
 *     └─ .ofs-dock-group[data-group="reuse"]   > button.ofs-dock-button × 1（编辑态隐藏）
 *
 * 图片处理组由桌面注册表 `IMAGE_TOOLS` 驱动：`tools` 的每一项由 Stage 补好
 * `label`（翻译后的按钮文案）、`enabled`（能力是否可用）与可选 `hint`（悬停说明）。
 * 未开放的工具（高清放大 / 扩图）保持禁用但可见，`title` 显示规划中说明；
 * 编辑态下只保留「退出」按钮，创作复用组隐藏，避免误操作打断正在涂抹的草稿。
 *
 * 阶段十五 Phase A1：「带回参数」下线（点胶片条已自动回填，§2.3），复用组只剩
 * 「重新生成」——按当前作品提示词与参数、换随机种子再抽一张纯文生图。
 */

import React from 'react'

import { Icon } from '../icons.jsx'

/**
 * 图标回落：契约里 outpaint 的 icon 是 `frame`，而 `icons.jsx` 目前没有这个图形。
 * 渲染层退回 `expand`，不修改别人文件；后续补上 frame 图标后自动改用契约值。
 */
const ICON_FALLBACK = { frame: 'expand' }

export function ImageDock(props) {
  const {
    t,
    tools,
    activeToolId,
    editing,
    resumeLabel,
    draftStatusLabel,
    onOpen,
    onResume,
    onClose,
    onReroll,
    plannedTitle,
  } = props
  const list = Array.isArray(tools) ? tools.filter((item) => item && item.id) : []
  const active = list.find((item) => item.id === activeToolId) || null
  const closeLabel = t('studio.imageTool.exit')

  return (
    <div className="ofs-dock">
      <div className="ofs-dock-group" data-group="process" role="group" aria-label={t('studio.imageTool.groupLabel')}>
        {list.map((tool) => {
          const enabled = tool.enabled !== false && tool.ready !== false
          const label = tool.label || t(tool.labelKey)
          const icon = ICON_FALLBACK[tool.icon] || tool.icon
          const isActive = Boolean(editing) && tool.id === activeToolId
          return (
            <button
              key={tool.id}
              type="button"
              className={isActive ? 'ofs-dock-button is-on' : 'ofs-dock-button'}
              title={enabled ? tool.hint || label : plannedTitle || label}
              aria-disabled={enabled ? undefined : 'true'}
              aria-pressed={isActive ? 'true' : undefined}
              onClick={enabled ? () => onOpen(tool.id) : undefined}
            >
              <Icon name={icon} size={15} />
              {label}
            </button>
          )
        })}

        {active && editing ? (
          <button type="button" className="ofs-dock-button ofs-dock-close" onClick={onClose}>
            <Icon name="close" size={15} />
            {closeLabel}
          </button>
        ) : null}

        {active && !editing && resumeLabel ? (
          <button type="button" className="ofs-dock-button ofs-dock-resume" onClick={onResume}>
            <Icon name="focus" size={15} />
            {resumeLabel}
            {draftStatusLabel ? <span className="ofs-dock-draft">{draftStatusLabel}</span> : null}
          </button>
        ) : null}
      </div>

      {!editing ? (
        <div className="ofs-dock-group" data-group="reuse">
          <button type="button" className="ofs-dock-button" onClick={onReroll}>
            <Icon name="reroll" size={15} />
            {t('studio.action.reroll')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
