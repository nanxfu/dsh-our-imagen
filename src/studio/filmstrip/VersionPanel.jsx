/**
 * 版本角标与派生面板（展示组件，阶段十三整合时由 Filmstrip 接线）。
 *
 * 交互（防误触，见 docs/WORKSPACE_DRAFTS_AND_VERSIONING_PLAN.md §1.4）：
 *  - 只有存在派生版本 / 在途分支（badgeCount > 0）时才渲染 `⎇ N` 角标；
 *  - 鼠标在缩略图上停留 250ms 后展开面板；移出缩略图后延迟 160ms 收起，
 *    面板与缩略图同处一个容器（面板内的 hover 会清除收起计时），鼠标从缩略图移进面板不会闪烁；
 *  - 点击角标固定展开，再点一次收起；Esc 关闭；面板内按钮可用 Tab 聚焦，焦点留在容器内时保持展开；
 *  - 面板行：版本号、类型图标（文生 / 整图重绘 / 局部涂抹）、缩略图、提示词、草稿圆点；
 *    在途任务显示为幽灵行（不可点击），父图被删的局部根行带说明。
 *
 * 本组件只依赖 props，文案由阶段二从词典组装后经 labels 传入（不直接调用 t()，
 * 避免 dict 尚未加键时产生静态引用）：
 *
 * @param {{
 *   labels: {
 *     title: string, empty: string, loading: string, unavailable: string,
 *     inFlight: string, badge: string, badgeHint: string, close: string, pending: string,
 *     kindText: string, kindImg2img: string, kindInpaint: string,
 *     draftItems: { mask: string, prompt: string, params: string },
 *     draftTitle: string, draftClear: string, sourceDeleted: string,
 *   },
 *   rows: Array<object>,            // lineagePanelRows() 的结果
 *   currentPath?: string,           // 当前舞台展示的版本路径（高亮行）
 *   badgeCount?: number,            // 派生版本数（含在途）；0 时不显示角标
 *   hasPending?: boolean,           // 树里是否有在途分支（角标呼吸态）
 *   loading?: boolean,              // 正在按需拉取版本树
 *   unavailable?: boolean,          // 旧宿主无 /history/tree，已降级为「仅已加载分页」
 *   hoverDelay?: number,            // 悬停展开延迟，默认 250ms
 *   hideDelay?: number,             // 移出后收起延迟，默认 160ms
 *   draftSummary?: object,          // 该树聚合的草稿摘要（workDraftSummary 形状）；有改动时缩略图角上亮圆点
 *   onSelect?: (row) => void,       // 点击版本行
 *   onClearDraft?: (row) => void,   // 清空该版本的未提交草稿
 *   onClearTreeDrafts?: () => void, // 一键清空整棵树的编辑草稿（缩略图圆点）
 *   onOpenChange?: (open: boolean) => void,
 *   children: React.ReactNode,      // 缩略图/作品卡主体
 * }} props
 */

import React from 'react'

import { workDraftSummary } from '../../logic/lineage.js'
import { Icon } from '../icons.jsx'

const DEFAULT_HOVER_DELAY = 250
const DEFAULT_HIDE_DELAY = 160

const KIND_ICONS = Object.freeze({ text: 'sparkles', img2img: 'image', inpaint: 'focus' })

function pickText(value, fallback) {
  return typeof value === 'string' && value ? value : fallback
}

function delayOf(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : fallback
}

/** 简单占位符替换：`{count}` / `{items}` 等。 */
function fillTemplate(template, params) {
  let out = typeof template === 'string' ? template : ''
  for (const key of Object.keys(params || {})) {
    out = out.split(`{${key}}`).join(String(params[key]))
  }
  return out
}

function kindLabelOf(labels, kind) {
  if (kind === 'inpaint') return pickText(labels.kindInpaint, '局部重绘')
  if (kind === 'img2img') return pickText(labels.kindImg2img, '整图重绘')
  return pickText(labels.kindText, '文生图')
}

/** 单行：版本号 + 类型 + 缩略图 + 提示词 + 草稿圆点；在途节点渲染成不可点击的幽灵行。 */
function VersionRow(props) {
  const { labels, row, currentPath, onSelect, onClearDraft } = props
  const ghost = row.ghost === true
  const active = Boolean(currentPath) && row.path === currentPath
  const summary = row.draftSummary || workDraftSummary(null)
  const kindLabel = kindLabelOf(labels, row.kind)
  const classes = ['ofs-version-row']
  if (active) classes.push('is-on')
  if (ghost) classes.push('is-ghost')
  if (summary.active) classes.push('has-draft')
  if (row.sourceDeleted) classes.push('is-orphan')
  const depth = Number.isFinite(Number(row.depth)) ? Math.max(0, Math.floor(Number(row.depth))) : 0
  const title = row.prompt || row.path
  const draftItems = summary.items.map((key) => {
    const itemLabels = labels.draftItems && typeof labels.draftItems === 'object' ? labels.draftItems : {}
    return pickText(itemLabels[key], key)
  })
  const draftTitle = fillTemplate(
    pickText(labels.draftTitle, '已修改：{items}'),
    { items: draftItems.join(' · ') },
  )
  const versionText = ghost ? pickText(labels.inFlight, '生成中') : (row.versionLabel || 'v1')
  const body = (
    <>
      <span className="ofs-version-label">{versionText}</span>
      <span className="ofs-version-kind" title={kindLabel} aria-label={kindLabel}>
        <Icon name={KIND_ICONS[row.kind] || 'sparkles'} size={12} />
      </span>
      <span className="ofs-version-thumb">
        {ghost
          ? <span className="ofs-version-thumb-ghost" aria-hidden="true" />
          : (row.url ? <img src={row.url} alt={row.prompt || row.file || ''} loading="lazy" /> : null)}
      </span>
      <span className="ofs-version-prompt">{row.prompt || '—'}</span>
      {summary.active ? (
        <span className="ofs-version-draft-dot" title={draftTitle} aria-label={draftTitle} />
      ) : null}
    </>
  )
  return (
    <div
      className={classes.join(' ')}
      style={{ paddingLeft: `${10 + depth * 12}px` }}
      data-kind={row.kind || 'text'}
      data-ghost={ghost ? 'true' : 'false'}
    >
      {ghost ? (
        <span className="ofs-version-row-main is-ghost">{body}</span>
      ) : (
        <button
          type="button"
          className="ofs-version-row-main"
          title={title}
          aria-current={active ? 'true' : undefined}
          onClick={() => {
            if (typeof onSelect === 'function') onSelect(row)
          }}
        >
          {body}
        </button>
      )}
      {summary.active && !ghost ? (
        <button
          type="button"
          className="ofs-version-draft-clear"
          title={draftTitle}
          aria-label={draftTitle}
          onClick={() => {
            if (typeof onClearDraft === 'function') onClearDraft(row)
          }}
        >
          <span className="ofs-version-draft-dot" aria-hidden="true" />
          <span className="ofs-version-draft-label">{pickText(labels.draftClear, '清空')}</span>
        </button>
      ) : null}
    </div>
  )
}

export function VersionPanel(props) {
  const labels = props.labels && typeof props.labels === 'object' ? props.labels : {}
  const rows = Array.isArray(props.rows) ? props.rows.filter((row) => row && row.path) : []
  const badgeCount = Number.isFinite(Number(props.badgeCount)) ? Math.max(0, Math.floor(Number(props.badgeCount))) : 0
  const hoverDelay = delayOf(props.hoverDelay, DEFAULT_HOVER_DELAY)
  const hideDelay = delayOf(props.hideDelay, DEFAULT_HIDE_DELAY)
  const [open, setOpen] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  const [panelPos, setPanelPos] = React.useState(null)
  const anchorRef = React.useRef(null)
  const timersRef = React.useRef({ hover: null, hide: null })
  const openRef = React.useRef(false)
  const pinnedRef = React.useRef(false)
  openRef.current = open
  pinnedRef.current = pinned

  const computePanelPos = () => {
    const anchor = anchorRef.current
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return null
    if (typeof window === 'undefined' || !(window.innerWidth > 0) || !(window.innerHeight > 0)) return null
    const rect = anchor.getBoundingClientRect()
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return null
    const width = Math.min(272, Math.max(180, window.innerWidth - 24))
    const idealLeft = rect.left + rect.width / 2 - width / 2
    const left = Math.round(Math.max(12, Math.min(window.innerWidth - width - 12, idealLeft)))
    const bottom = Math.round(Math.max(12, window.innerHeight - rect.top + 10))
    return { left: `${left}px`, bottom: `${bottom}px`, width: `${width}px` }
  }

  const clearTimer = (kind) => {
    const id = timersRef.current[kind]
    if (id !== null && id !== undefined && typeof clearTimeout === 'function') clearTimeout(id)
    timersRef.current[kind] = null
  }
  const clearTimers = () => {
    clearTimer('hover')
    clearTimer('hide')
  }
  const emit = (next) => {
    if (typeof props.onOpenChange === 'function') props.onOpenChange(next)
  }
  const openPanel = () => {
    clearTimers()
    const pos = computePanelPos()
    if (pos) setPanelPos(pos)
    if (openRef.current) return
    openRef.current = true
    setOpen(true)
    emit(true)
  }
  const closePanel = (options = {}) => {
    clearTimers()
    pinnedRef.current = false
    setPinned(false)
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    if (!options.silent) emit(false)
  }
  const scheduleOpen = () => {
    clearTimer('hide')
    if (openRef.current) return
    clearTimer('hover')
    timersRef.current.hover = setTimeout(() => {
      timersRef.current.hover = null
      openPanel()
    }, hoverDelay)
  }
  const scheduleHide = () => {
    clearTimer('hover')
    if (!openRef.current || pinnedRef.current) return
    clearTimer('hide')
    timersRef.current.hide = setTimeout(() => {
      timersRef.current.hide = null
      if (!pinnedRef.current) closePanel()
    }, hideDelay)
  }

  // 卸载时清掉悬停计时；Esc 在面板打开期间挂到 document 上，焦点在面板外也能关闭。
  React.useEffect(() => () => {
    clearTimer('hover')
    clearTimer('hide')
  }, [])
  const closeRef = React.useRef(closePanel)
  closeRef.current = closePanel
  React.useEffect(() => {
    if (!open) return undefined
    const doc = typeof document === 'undefined' ? null : document
    if (!doc || typeof doc.addEventListener !== 'function') return undefined
    const onKeyDown = (event) => {
      if (!event || event.key !== 'Escape') return
      if (typeof event.stopPropagation === 'function') event.stopPropagation()
      if (typeof event.preventDefault === 'function') event.preventDefault()
      closeRef.current()
    }
    doc.addEventListener('keydown', onKeyDown)
    const onPointerDown = (event) => {
      const anchor = anchorRef.current
      if (!anchor || typeof anchor.contains !== 'function') return
      if (event && event.target && anchor.contains(event.target)) return
      closeRef.current()
    }
    const syncPosition = () => {
      const pos = computePanelPos()
      if (pos) setPanelPos(pos)
    }
    syncPosition()
    doc.addEventListener('pointerdown', onPointerDown)
    doc.addEventListener('scroll', syncPosition, true)
    const win = typeof window === 'undefined' ? null : window
    if (win && typeof win.addEventListener === 'function') win.addEventListener('resize', syncPosition)
    return () => {
      if (typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('keydown', onKeyDown)
        doc.removeEventListener('pointerdown', onPointerDown)
        doc.removeEventListener('scroll', syncPosition, true)
      }
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('resize', syncPosition)
    }
  }, [open])

  // 派生数归零（例如在途任务全部完成、历史还没刷新）时收起面板，避免露出过期行。
  React.useEffect(() => {
    if (badgeCount === 0 && openRef.current) closeRef.current({ silent: true })
  }, [badgeCount])

  const anchorClasses = ['ofs-version-anchor']
  if (open) anchorClasses.push('is-open')
  if (pinned) anchorClasses.push('is-pinned')
  if (props.hasPending) anchorClasses.push('has-pending')
  // 树级草稿圆点：任一节点留有未提交改动时亮起，title 列出改动项，点击一键清空整棵树草稿。
  const treeSummary = props.draftSummary && typeof props.draftSummary === 'object' && props.draftSummary.active
    ? props.draftSummary
    : null
  const draftItemLabels = labels.draftItems && typeof labels.draftItems === 'object' ? labels.draftItems : {}
  const draftItemsText = treeSummary
    ? treeSummary.items.map((key) => pickText(draftItemLabels[key], key)).join(' · ')
    : ''
  const draftTitle = fillTemplate(pickText(labels.draftTitle, '已修改：{items}'), { items: draftItemsText })
  if (treeSummary) anchorClasses.push('has-draft')

  const badgeText = fillTemplate(pickText(labels.badge, '⎇ {count}'), { count: badgeCount })
  const badgeTitle = pickText(labels.badgeHint, '版本分支')

  return (
    <div
      ref={anchorRef}
      className={anchorClasses.join(' ')}
      data-derivations={badgeCount}
      onMouseEnter={badgeCount > 0 ? scheduleOpen : undefined}
      onMouseLeave={badgeCount > 0 ? scheduleHide : undefined}
      onFocus={badgeCount > 0 ? () => clearTimer('hide') : undefined}
      onBlur={(event) => {
        // 焦点还在容器内（比如 Tab 到面板按钮）时不收起。
        if (event && event.currentTarget && event.relatedTarget
          && typeof event.currentTarget.contains === 'function' && event.currentTarget.contains(event.relatedTarget)) return
        scheduleHide()
      }}
    >
      {props.children}

      {treeSummary ? (
        <button
          type="button"
          className="ofs-thumb-dot"
          title={draftTitle}
          aria-label={draftTitle}
          onClick={(event) => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
            if (event && typeof event.preventDefault === 'function') event.preventDefault()
            if (typeof props.onClearTreeDrafts === 'function') props.onClearTreeDrafts()
          }}
        />
      ) : null}

      {badgeCount > 0 ? (
        <button
          type="button"
          className={pinned ? 'ofs-version-badge is-on' : 'ofs-version-badge'}
          aria-expanded={open ? 'true' : 'false'}
          aria-haspopup="dialog"
          title={badgeTitle}
          onClick={(event) => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
            if (event && typeof event.preventDefault === 'function') event.preventDefault()
            if (pinnedRef.current) {
              closePanel()
              return
            }
            pinnedRef.current = true
            setPinned(true)
            openPanel()
          }}
        >
          {badgeText}
        </button>
      ) : null}

      {open ? (
        <div
          className="ofs-version-panel"
          style={panelPos || undefined}
          role="dialog"
          aria-label={pickText(labels.title, '版本')}
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleHide}
          onKeyDown={(event) => {
            if (!event || event.key !== 'Escape') return
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            closePanel()
          }}
        >
          {(props.loading || props.unavailable) ? (
            <div className="ofs-version-note">
              {props.loading
                ? pickText(labels.loading, '正在拉取版本…')
                : pickText(labels.unavailable, '当前宿主不支持版本树，仅显示已加载分页')}
            </div>
          ) : null}
          {props.loading ? null : (
            <>
              {rows.length === 0 ? (
                <div className="ofs-version-empty">{pickText(labels.empty, '暂无派生版本')}</div>
              ) : (
                <div className="ofs-version-rows">
                  {rows.map((row) => (
                    <VersionRow
                      key={row.key || row.path}
                      labels={labels}
                      row={row}
                      currentPath={props.currentPath}
                      onSelect={(selectedRow) => {
                        // 选中版本即收起面板：父级会把该版本切到舞台，浮层没有继续停留的理由。
                        closePanel()
                        if (typeof props.onSelect === 'function') props.onSelect(selectedRow)
                      }}
                      onClearDraft={props.onClearDraft}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
