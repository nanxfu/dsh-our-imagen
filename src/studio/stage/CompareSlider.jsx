/**
 * 原图 / 当前图的拉帘对比（阶段十五 Phase A3）。
 *
 * 用于带 `sourceImage` 的派生作品：左半边是原图（before），右半边是当前图（after），
 * 中间一条可拖动的分隔线。交互方式：
 *  - 指针：在画面上按下并拖动；双击回到 50%；
 *  - 键盘：聚焦后 ← / → 微调（4%），Home / End 到两端；
 *  - ARIA：容器是 `role="slider"`，`aria-valuenow` 报告分隔线百分比。
 *
 * props：{ t, beforeUrl, afterUrl, beforeLabel?, afterLabel?, ratio?, initialPosition? }
 *  - ratio：画面宽高比（默认按 1:1 画）；
 *  - beforeLabel / afterLabel：缺省用字典 `studio.compare.before` / `studio.compare.after`。
 */

import React from 'react'

/** 每次键盘微调的步长（百分比）；够细又不至于要按很多下。 */
const KEY_STEP = 0.04

function clampPosition(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.min(1, Math.max(0, number))
}

function ratioOf(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 1
  return number
}

export function CompareSlider(props) {
  const { t, beforeUrl, afterUrl, beforeLabel, afterLabel, ratio, initialPosition } = props
  const [position, setPosition] = React.useState(() => clampPosition(initialPosition ?? 0.5))
  const [dragging, setDragging] = React.useState(false)
  const trackRef = React.useRef(null)

  const label = typeof t === 'function' ? t : (key) => key
  const beforeText = beforeLabel || label('studio.compare.before')
  const afterText = afterLabel || label('studio.compare.after')
  const percent = Math.round(position * 100)
  const frameRatio = ratioOf(ratio)

  /** 指针横坐标 → 0..1；取不到布局时返回 null（不强行跳位置）。 */
  function positionOfPointer(event) {
    const track = trackRef.current
    if (!track || typeof track.getBoundingClientRect !== 'function') return null
    const rect = track.getBoundingClientRect()
    if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return null
    const clientX = Number(event && event.clientX)
    if (!Number.isFinite(clientX)) return null
    return clampPosition((clientX - rect.left) / rect.width)
  }

  function onPointerDown(event) {
    if (event && event.button !== undefined && event.button !== 0) return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    setDragging(true)
    const next = positionOfPointer(event)
    if (next !== null) setPosition(next)
    const target = event && event.currentTarget
    if (target && typeof target.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // 某些环境（测试替身 / 旧浏览器）没有指针捕获：退化为普通 move 事件，不影响拖动。
      }
    }
  }

  function onPointerMove(event) {
    if (!dragging) return
    const next = positionOfPointer(event)
    if (next !== null) setPosition(next)
  }

  function onPointerUp(event) {
    setDragging(false)
    const target = event && event.currentTarget
    if (target && typeof target.releasePointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        // 捕获可能早已释放：忽略。
      }
    }
  }

  function onKeyDown(event) {
    const key = event && event.key
    if (key === 'Home') {
      setPosition(0)
      if (event.preventDefault) event.preventDefault()
      return
    }
    if (key === 'End') {
      setPosition(1)
      if (event.preventDefault) event.preventDefault()
      return
    }
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
    const delta = key === 'ArrowRight' ? KEY_STEP : -KEY_STEP
    setPosition((prev) => clampPosition(prev + delta))
    if (event.preventDefault) event.preventDefault()
  }

  function onDoubleClick() {
    setPosition(0.5)
  }

  const dividerStyle = { left: `${position * 100}%` }
  // 当前图铺在右侧：裁掉分隔线左边的部分，左半边继续露出底下的原图。
  const overlayStyle = { clipPath: `inset(0 0 0 ${position * 100}%)` }

  return (
    <div
      ref={trackRef}
      className={`ofs-compare${dragging ? ' is-dragging' : ''}`}
      style={{ '--ofs-compare-r': String(frameRatio) }}
      role="slider"
      tabIndex={0}
      aria-label={label('studio.compare.hint')}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      <img className="ofs-compare-base" src={beforeUrl} alt={beforeText} draggable={false} />
      <div className="ofs-compare-overlay" style={overlayStyle}>
        <img className="ofs-compare-image" src={afterUrl} alt={afterText} draggable={false} />
      </div>

      <span className="ofs-compare-tag ofs-compare-tag--before">{beforeText}</span>
      <span className="ofs-compare-tag ofs-compare-tag--after">{afterText}</span>

      <div className="ofs-compare-divider" style={dividerStyle} aria-hidden="true">
        <span className="ofs-compare-handle">
          <span className="ofs-compare-arrow is-back">‹</span>
          <span className="ofs-compare-arrow is-forward">›</span>
        </span>
      </div>
    </div>
  )
}
