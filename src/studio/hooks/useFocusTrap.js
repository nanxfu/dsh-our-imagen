/**
 * 弹层 / 抽屉焦点陷阱：打开时将焦点移至指定初始元素，Esc 关闭，Tab/Shift+Tab 在容器内循环；
 * 可选在关闭或卸载时把焦点还给打开前的触发元素。
 *
 * onClose 通过 ref 持有，避免父组件轮询或定时刷新传入新闭包时重复抢夺焦点。
 */

import React from 'react'

/** 弹层内可聚焦元素选择器。 */
export const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function useFocusTrap({ active = true, panelRef, initialFocusRef, returnFocusRef, onClose }) {
  // onClose 每次父渲染都可能变化；用 ref 持有，避免轮询或局部状态变化时重复抢焦点。
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  React.useEffect(() => {
    if (!active) return undefined
    const initial = initialFocusRef && initialFocusRef.current
    if (initial && typeof initial.focus === 'function') initial.focus()

    function onKey(event) {
      if (event.key === 'Escape') {
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        if (typeof onCloseRef.current === 'function') onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef && panelRef.current
      if (!panel || typeof panel.querySelectorAll !== 'function') return
      const nodes = Array.prototype.slice
        .call(panel.querySelectorAll(FOCUSABLE))
        .filter((node) => !node.disabled && (!node.getAttribute || node.getAttribute('aria-hidden') !== 'true'))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const current = document.activeElement
      const outside = !panel.contains || !panel.contains(current)
      if (event.shiftKey && (current === first || outside)) {
        if (event.preventDefault) event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (current === last || outside)) {
        if (event.preventDefault) event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (returnFocusRef) {
        const opener = returnFocusRef.current
        returnFocusRef.current = null
        if (opener && typeof opener.focus === 'function' && opener.isConnected !== false) opener.focus()
      }
    }
  }, [active, panelRef, initialFocusRef, returnFocusRef])
}
