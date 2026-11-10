/**
 * 轻量悬浮提示。
 *
 * 触发方式：鼠标悬停、键盘聚焦、触屏点击；Esc 或点击别处关闭已固定的提示。
 * 弹层用 `position: fixed` 定位，避免被创作面板的滚动容器裁剪。
 *
 * 用法：<Tooltip t={t} text={t('studio.stepsTooltip')} />
 *      tone = 'info' 显示 (i)，tone = 'warn' 显示 (!)
 */

import React from 'react'

// 弹层的估算宽度：只用于把它夹在视口内，实际宽度由内容决定。
const POPUP_MAX = 248

export function Tooltip(props) {
  const { t, text, tone = 'info', side = 'top' } = props
  const [open, setOpen] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  const [pos, setPos] = React.useState(null)
  const triggerRef = React.useRef(null)

  const measure = React.useCallback(() => {
    if (typeof window === 'undefined' || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = Math.min(POPUP_MAX, Math.max(120, window.innerWidth - 16))
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.max(8, Math.min(centered, window.innerWidth - width - 8))
    const below = side === 'bottom' || rect.top < 140
    setPos({ left, top: rect.top - 8, bottom: rect.bottom + 8, below })
  }, [side])

  const close = React.useCallback(() => {
    setPinned(false)
    setOpen(false)
  }, [])

  React.useEffect(() => {
    if (!open) return undefined
    measure()
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const remeasure = () => measure()
    const onKey = (event) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, measure, close])

  React.useEffect(() => {
    if (!pinned) return undefined
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
    const onDown = (event) => {
      const node = triggerRef.current
      if (node && event && event.target && node.contains(event.target)) return
      close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pinned, close])

  if (!text) return null

  const label =
    tone === 'warn'
      ? typeof t === 'function' ? t('studio.tooltip.warning') : 'Warning'
      : typeof t === 'function' ? t('studio.tooltip.more') : 'More info'

  const popupStyle = pos
    ? { left: `${pos.left}px`, top: `${pos.below ? pos.bottom : pos.top}px` }
    : undefined
  const popupClass =
    'ofs-tip-pop'
    + (pos && pos.below ? ' is-below' : '')
    + (open ? ' is-on' : '')

  return (
    <span className={`ofs-tip ofs-tip--${tone}${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="ofs-tip-trigger"
        aria-label={label}
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
        <span role="tooltip" className={popupClass} style={popupStyle}>
          {text}
        </span>
      ) : null}
    </span>
  )
}