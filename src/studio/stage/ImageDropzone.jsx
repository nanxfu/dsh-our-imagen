/**
 * 舞台拖放层：本地图片导入（阶段十五 Phase A3）。
 *
 * 包住舞台，负责三件事（逻辑校验全部交给 `src/logic/import.js`）：
 *  1. 拖入 PNG / JPEG → 读成 dataURL → 客户端预检 → `POST /imagen-api/import`
 *     → 成功后把条目交给 `onImported(entry)`（组合层再切焦点 / 关对比 / 刷新历史）；
 *  2. `document` 上的粘贴监听：截图 / 复制图片后 Ctrl+V 直接导入；焦点在输入框时让给输入；
 *  3. 新画布「选择图片」入口（隐藏 `input[type=file]`，`accept` 只放 PNG / JPEG）。
 *
 * 编辑态（图片工具打开中）一律拒绝拖入与选择：正在涂抹的蒙版草稿不能被替图覆盖。
 *
 * props：
 *  - `t`            翻译函数
 *  - `ui`           界面态域（只用到 `showToast`）
 *  - `editorOpen`   图片工具编辑态（拒绝导入）
 *  - `selecting`    批量选择态（预留，同样拒绝）
 *  - `onImported`   `(entry) => void`，导入成功后的落点；缺省时本组件自己弹成功 toast
 *  - `showChoose`   是否浮出「选择图片」按钮（新画布 / 空舞台为 true）
 *  - `chooseLabel`  「选择图片」文案键（缺省 `studio.import.choose`）
 *  - `triggerRef`   可选 React ref：挂载后 `current` 是打开选择框的函数，供取景框内按钮调用
 *  - `children`     被包裹的舞台内容
 */

import React from 'react'

import { importImageFile } from '../../api/resources.js'
import { formatText } from '../../logic/format.js'
import {
  importDragOf,
  importFileErrorOf,
  importMaxMiB,
  importMetaFoundOf,
  importMimeOf,
  importPrecheckOf,
} from '../../logic/import.js'
import { filesOf, hasFilePayload } from '../drag.js'
import { readFileAsDataUrl } from '../imageFile.js'
import { Icon } from '../icons.jsx'

/** 与契约 `IMPORT.mimeTypes` 对应的 accept 串（浏览器只做文件选择框过滤，真正的校验在逻辑层）。 */
const ACCEPT = 'image/png,image/jpeg'

function translateOf(t, key, params) {
  const template = typeof t === 'function' ? t(key) : key
  return formatText(template, params)
}

/** 第一张图片文件；没有图片时退回第一个文件，让「只支持 PNG / JPEG」的提示有处可弹。 */
function pickFile(dataTransfer) {
  const files = filesOf(dataTransfer)
  if (files.length === 0) return null
  return files.find((file) => importMimeOf(file)) || files[0]
}

/** 焦点在输入控件 / 可编辑区域时，粘贴事件不归导入层处理。 */
function isTextEditingTarget(target) {
  if (!target || typeof target !== 'object') return false
  const tag = String(target.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable === true
}

export function ImageDropzone(props) {
  const { t, ui, editorOpen, selecting, onImported, showChoose, chooseLabel, triggerRef, children } = props
  const [dragging, setDragging] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const inputRef = React.useRef(null)
  const dragDepthRef = React.useRef(0)
  const busyRef = React.useRef(false)
  const aliveRef = React.useRef(true)
  // 最新回调 / 文案放进 ref：document 粘贴监听只注册一次，不随父组件重渲染反复解绑。
  const startImportRef = React.useRef(null)

  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const blocked = importDragOf({
    editorOpen: editorOpen === true,
    selecting: selecting === true,
  }) === 'blocked'

  function toast(key, params) {
    if (ui && typeof ui.showToast === 'function') ui.showToast(translateOf(t, key, params))
  }

  function openPicker() {
    if (blocked) {
      toast('studio.import.blockedEditing')
      return
    }
    const input = inputRef.current
    if (input && typeof input.click === 'function') input.click()
  }

  async function startImport(file) {
    if (!file || busyRef.current) return
    if (blocked) {
      toast('studio.import.blockedEditing')
      return
    }
    const fileError = importFileErrorOf(file)
    if (fileError) {
      // 体积提示要带上限：MiB 读数与契约一致（8 MiB）。
      toast(fileError, fileError === 'studio.import.tooLarge' ? { size: importMaxMiB() } : null)
      return
    }
    busyRef.current = true
    setBusy(true)
    toast('studio.import.importing')
    try {
      const rawDataUrl = await readFileAsDataUrl(file)
      const precheck = importPrecheckOf({ file, dataUrl: rawDataUrl })
      if (!precheck.ok) {
        toast(precheck.errorKey, precheck.params)
        return
      }
      const result = await importImageFile({
        data: precheck.dataUrl,
        name: precheck.name || undefined,
      })
      if (!aliveRef.current) return
      const entry = result && result.ok && result.data ? result.data.entry : null
      if (!entry) {
        toast('studio.import.failed')
        return
      }
      if (typeof onImported === 'function') {
        // 组合层（actions.activateImport）负责切焦点、关对比与成功 toast。
        onImported(entry)
        return
      }
      // 没有接线时也不静默：自己给一次成功提示（entry.generation 命中说明带生成元数据）。
      toast(importMetaFoundOf(entry) ? 'studio.import.metaFound' : 'studio.import.done')
    } catch {
      if (aliveRef.current) toast('studio.import.failed')
    } finally {
      busyRef.current = false
      if (aliveRef.current) setBusy(false)
    }
  }
  startImportRef.current = startImport

  // 把触发入口交给外部按钮（例如取景框内的「选择图片」），卸载时清空。
  React.useEffect(() => {
    if (!triggerRef || typeof triggerRef !== 'object') return undefined
    triggerRef.current = openPicker
    return () => {
      if (triggerRef.current === openPicker) triggerRef.current = null
    }
  })

  // 剪贴板粘贴：只在舞台挂载期间监听；焦点在输入框里时不拦截。
  React.useEffect(() => {
    function onPaste(event) {
      const target = (event && event.target) || (typeof document !== 'undefined' ? document.activeElement : null)
      if (isTextEditingTarget(target)) return
      const file = pickFile(event && event.clipboardData)
      if (!file) return
      if (typeof event.preventDefault === 'function') event.preventDefault()
      if (startImportRef.current) startImportRef.current(file)
    }
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  function onDragEnter(event) {
    if (!hasFilePayload(event)) return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof event.stopPropagation === 'function') event.stopPropagation()
    dragDepthRef.current += 1
    if (!dragging) setDragging(true)
  }

  function onDragOver(event) {
    if (!hasFilePayload(event)) return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    const dataTransfer = event.dataTransfer
    if (dataTransfer) dataTransfer.dropEffect = blocked ? 'none' : 'copy'
  }

  function onDragLeave(event) {
    if (!hasFilePayload(event)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0 && dragging) setDragging(false)
  }

  function onDrop(event) {
    if (!hasFilePayload(event)) return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof event.stopPropagation === 'function') event.stopPropagation()
    dragDepthRef.current = 0
    if (dragging) setDragging(false)
    const file = pickFile(event.dataTransfer)
    if (file) startImport(file)
  }

  function onFileChange(event) {
    const input = event && event.target
    const file = input && input.files ? input.files[0] : null
    // 清空 value：同一张图连续选两次也要能触发 change。
    if (input) input.value = ''
    if (file) startImport(file)
  }

  const zoneClass = `ofs-import-zone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`

  return (
    <div
      className={zoneClass}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}

      {dragging ? (
        <div className="ofs-import-overlay" aria-hidden="true">
          <div className={blocked ? 'ofs-import-hint is-blocked' : 'ofs-import-hint'}>
            <Icon name={blocked ? 'alert' : 'image'} size={18} />
            <span>{translateOf(t, blocked ? 'studio.import.blockedEditing' : 'studio.import.dropHint')}</span>
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="ofs-import-status" role="status">
          <span className="ofs-shimmer" aria-hidden="true" />
          <span>{translateOf(t, 'studio.import.importing')}</span>
        </div>
      ) : null}

      {showChoose && !blocked ? (
        <button type="button" className="ofs-import-choose" onClick={openPicker} disabled={busy}>
          <Icon name="image" size={15} />
          {translateOf(t, chooseLabel || 'studio.import.choose')}
        </button>
      ) : null}

      <input
        ref={inputRef}
        className="ofs-import-input"
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        hidden
        onChange={onFileChange}
      />
    </div>
  )
}
