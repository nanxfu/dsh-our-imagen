/**
 * 工作台界面态域：视图 / 缩放 / 面板形态 / 折叠态 / Toast / 错误 / 剪贴板。
 *
 * 只持有界面状态，不碰业务数据；error 只存 { code, message }，如何展示由组合层决定。
 * 依赖入参：{ t, aliveRef, initialView, initialPanelMode }。
 */

import React from 'react'

import { KAGGLE_INSTALL_COMMAND } from '../../logic/guidance.js'

export function useStudioUi({ t, aliveRef, initialView, initialPanelMode }) {
  // 初始视图与面板形态可由 props 指定（预览与测试用），由组合层算好后传入。
  const [view, setView] = React.useState(initialView)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [negativeOpen, setNegativeOpen] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [dismissed, setDismissed] = React.useState('')
  const [toast, setToast] = React.useState(null)
  const [panelMode, setPanelMode] = React.useState(initialPanelMode)
  const [zoom, setZoom] = React.useState(false)

  function showToast(text) {
    setToast({ text, id: Date.now() })
  }

  // 新的本地错误出现时，恢复之前被手动收起的指引卡。
  function fail(code, message) {
    setDismissed('')
    setError({ code, message: message ?? '' })
  }

  /** 收起指引卡：记下当前 code|detail，避免同一条错误立刻又弹回来。 */
  function dismissGuidance(guidanceKey) {
    if (guidanceKey) setDismissed(guidanceKey)
    setError(null)
  }

  React.useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => {
      if (aliveRef.current) setToast(null)
    }, 2600)
    return () => clearTimeout(timer)
  }, [toast])

  async function copyText(text, okKey) {
    const value = String(text ?? '').trim()
    if (!value) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value)
        showToast(t(okKey))
        return
      }
    } catch {
      // 非安全上下文或不给权限：退化为提示用户手动复制
    }
    showToast(value)
  }

  function copyPath(value) {
    return copyText(value, 'studio.toast.copied')
  }

  function copyInstallCommand() {
    return copyText(KAGGLE_INSTALL_COMMAND, 'studio.guidance.cli.copied')
  }

  return {
    view,
    setView,
    zoom,
    setZoom,
    panelMode,
    setPanelMode,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    toast,
    error,
    setError,
    dismissed,
    showToast,
    fail,
    dismissGuidance,
    copyPath,
    copyInstallCommand,
  }
}