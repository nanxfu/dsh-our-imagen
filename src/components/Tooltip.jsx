/**
 * 轻量悬浮提示。
 *
 * 触发方式：鼠标悬停、键盘聚焦、触屏点击；Esc 或点击别处关闭已固定的提示。
 * 弹层用 `position: fixed`，但固定包含块是带 backdrop-filter 的外壳，
 * 所以位置由 logic/tooltip.js 统一换算，避免被外壳裁掉。
 *
 * 用法：<Tooltip text={t('studio.stepsTooltip')} />
 *      tone = 'info' 显示 (i)，tone = 'warn' 显示 (!)
 */

import React from 'react'

import { tooltipPlacement } from '../logic/tooltip.js'

// 弹层的期望宽度上限：实际宽度由内容决定，定位时按上限夹在容器内。
const POPUP_MAX = 248

export function Tooltip(props) {
  const { text, tone = 'info', side = 'top' } = props
  const [open, setOpen] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  const [pos, setPos] = React.useState(null)
  const triggerRef = React.useRef(null)

  const close = React.useCallback(() => {
    setPinned(false)
    setOpen(false)
  }, [])

  const measure = React.useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const node = triggerRef.current
    if (!node || typeof node.getBoundingClientRect !== 'function') return
    const anchor = node.getBoundingClientRect()
    const app = typeof node.closest === 'function' ? node.closest('.ofs-app') : null
    let frame = null
    if (app && typeof app.getBoundingClientRect === 'function') {
      frame = app.getBoundingClientRect()
    } else if (Number(window.innerWidth) > 0) {
      frame = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    }
    setPos(tooltipPlacement({ anchor, frame, width: POPUP_MAX, preferBelow: side === 'bottom' }))
  }, [side])

  React.useEffect(() => {
    if (!open) return undefined
    measure()
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const remeasure = () => measure()
    const onKey = (event) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', onKey)
    }
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('keydown', onKey)
      }
    }
  }, [open, measure, close])

  React.useEffect(() => {
    if (!pinned) return undefined
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
    const onDown = (event) => {
      const node = triggerRef.current
      if (node && event && event.target && typeof node.contains === 'function' && node.contains(event.target)) return
      close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pinned, close])

  if (!text) return null

  const popupStyle = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px`, maxWidth: `${pos.maxWidth}px` }
    : undefined

  return (
    <span className={`ofs-tip ofs-tip--${tone}${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="ofs-tip-trigger"
        aria-label={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned) setOpen(false)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false)
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (pinned) close()
          else {
            setPinned(true)
            setOpen(true)
          }
        }}
      >
        <span aria-hidden="true">{tone === 'warn' ? '!' : 'i'}</span>
      </button>
      {open && pos ? (
        <span role="tooltip" className={pos.below ? 'ofs-tip-pop is-below' : 'ofs-tip-pop'} style={popupStyle}>
          {text}
        </span>
      ) : null}
    </span>
  )
}