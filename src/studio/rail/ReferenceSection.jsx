/**
 * 左栏「参考图」小节（阶段十五 Phase C2，模型原生参考生图）。
 *
 * 位置：提示词之后、画面设置之前。整节只服务一件事——把 1~N 张已落盘作品挂成
 * 本次生成的 `references`（Host 协议见 SPEC §2.2「模型原生参考图」）。
 *
 * 交互边界（Lead 已冻结，见 SPEC §5.21）：
 *  - 当前预设 `supportsReference=false` 且槽位为空：整节隐藏，不占左栏空间；
 *  - 支持时：空态给「添加参考图（最多 N 张）」入口（从电脑选择 / 拖入 / 从作品选择）；
 *    有图态给缩略图网格（逐张可移除、未满可追加，满额给说明）；
 *  - 整节自身是 drop target：拖入 PNG / JPEG → 交给组合层走 `/import` 落盘后入槽；
 *  - 当前预设不支持但槽位非空：明确提示 + 两个动作（切到支持参考的模型 / 改用整图重绘），
 *    点生成由组合层前置拦下，不静默丢图。
 *
 * 组件只负责渲染与拖放 / 选择事件，槽位状态与能力判定都在 useStudioForm / logic/reference.js。
 */

import React from 'react'

import { formatText } from '../../logic/format.js'
import { referenceListOf, referenceMaxCount } from '../../logic/reference.js'
import { filesOf, hasFilePayload } from '../drag.js'
import { Icon } from '../icons.jsx'
import { Drawer } from './Drawer.jsx'
import { Fieldset } from './Fieldset.jsx'

/** 从作品选择一次最多列几张：复用已加载的历史分页，不新造页面。 */
const PICK_LIMIT = 8

/** 与契约 `IMPORT.mimeTypes` 对应的 accept 串（真正的格式校验在逻辑层）。 */
const ACCEPT = 'image/png,image/jpeg'

export function ReferenceSection(props) {
  const {
    t,
    references,
    referenceSupported,
    referenceSwitchLabel,
    referenceMax,
    works,
    busy,
    actions,
  } = props
  const items = referenceListOf(references)
  const [picking, setPicking] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef(null)
  // 拖拽进出是按子元素逐层触发的，用深度计数避免内部的 dragleave 提前关掉高亮。
  const dragDepthRef = React.useRef(0)

  // 上限来自契约；父组件没传时（预览 / 旧装配）回落到同一份 `referenceLimits()`。
  const max = Number(referenceMax) > 0 ? Number(referenceMax) : referenceMaxCount()
  const canAdd = items.length < max
  const addedPaths = new Set(items.map((item) => item.path))
  const pickable = (Array.isArray(works) ? works : [])
    .filter((entry) => entry && entry.image && entry.image.path && !addedPaths.has(entry.image.path))
    .slice(0, PICK_LIMIT)

  // 当前预设不支持且还没挂图：整节隐藏（Phase C2 交互边界）。
  if (!referenceSupported && items.length === 0) return null

  function openPicker() {
    // 满额时不再给文件框：界面上「添加」入口已被满额提示替代，这里只做防御。
    if (!canAdd) return
    const input = inputRef.current
    if (input && typeof input.click === 'function') input.click()
  }

  function onFileChange(event) {
    const input = event && event.target
    const files = input && input.files ? Array.from(input.files).filter(Boolean) : []
    // 清空 value：同一张图连续选两次也要能触发 change。
    if (input) input.value = ''
    if (files.length > 0 && actions && typeof actions.uploadReferenceFiles === 'function') {
      actions.uploadReferenceFiles(files)
    }
  }

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
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
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
    const files = filesOf(event.dataTransfer)
    if (files.length > 0 && actions && typeof actions.uploadReferenceFiles === 'function') {
      actions.uploadReferenceFiles(files)
    }
  }

  const zoneClass = `ofs-ref-zone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`

  return (
    <div
      className={zoneClass}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Fieldset
        title={t('studio.reference.title')}
        action={<span className="ofs-ref-count">{`${items.length} / ${max}`}</span>}
      >
        {items.length === 0 ? (
          <button type="button" className="ofs-ref-add is-empty" onClick={openPicker} disabled={busy}>
            <Icon name="plus" size={14} />
            {formatText(t('studio.reference.empty'), { count: max })}
          </button>
        ) : (
          <div className="ofs-ref-grid" role="list" aria-label={t('studio.reference.title')}>
            {items.map((item) => (
              <div className="ofs-ref-item" key={item.path} role="listitem">
                <img
                  className="ofs-ref-thumb"
                  src={item.url}
                  alt={item.name || t('studio.reference.title')}
                  loading="lazy"
                />
                <button
                  type="button"
                  className="ofs-ref-remove"
                  title={t('studio.reference.remove')}
                  aria-label={t('studio.reference.remove')}
                  onClick={() => actions && typeof actions.removeReference === 'function' && actions.removeReference(item.path)}
                >
                  <Icon name="close" size={11} />
                </button>
                <span className="ofs-ref-name" title={item.path}>{item.name}</span>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 ? (
          canAdd ? (
            <button type="button" className="ofs-ref-more" onClick={openPicker} disabled={busy}>
              <Icon name="plus" size={13} />
              {formatText(t('studio.reference.addMore'), { count: items.length, max })}
            </button>
          ) : (
            <p className="ofs-hint">{formatText(t('studio.reference.full'), { max })}</p>
          )
        ) : (
          <p className="ofs-hint">{t('studio.reference.emptyHint')}</p>
        )}

        {/* 从作品选择：复用已加载的历史分页（最多列 8 张），不新造页面。 */}
        <div className="ofs-ref-pick">
          <button
            type="button"
            className="ofs-text-action ofs-ref-pick-toggle"
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            {picking ? t('studio.reference.pickClose') : t('studio.reference.pickWork')}
          </button>
          {picking ? (
            <Drawer>
              {pickable.length > 0 ? (
                <div className="ofs-ref-works" aria-label={t('studio.reference.pickWork')}>
                  {pickable.map((entry) => (
                    <button
                      type="button"
                      key={entry.image.path}
                      className="ofs-ref-work"
                      title={entry.item && entry.item.prompt ? entry.item.prompt : entry.image.path}
                      onClick={() => {
                        if (actions && typeof actions.addReference === 'function') actions.addReference(entry)
                        setPicking(false)
                      }}
                    >
                      <img src={entry.image.url} alt={entry.item && entry.item.prompt ? entry.item.prompt : entry.image.path} loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ofs-hint">{t('studio.reference.pickEmpty')}</p>
              )}
            </Drawer>
          ) : null}
        </div>

        {referenceSupported ? (
          <p className="ofs-hint ofs-ref-quality">{t('studio.reference.qualityHint')}</p>
        ) : (
          <div className="ofs-ref-warn" role="status">
            <p className="ofs-ref-warn-title">{t('studio.reference.unsupported')}</p>
            <p className="ofs-hint">{t('studio.reference.unsupportedHint')}</p>
            <div className="ofs-ref-warn-actions">
              {referenceSwitchLabel && actions && typeof actions.switchToReferencePreset === 'function' ? (
                <button type="button" className="ofs-ref-switch" onClick={() => actions.switchToReferencePreset()}>
                  {formatText(t('studio.reference.switchPreset'), { preset: referenceSwitchLabel })}
                </button>
              ) : null}
              {actions && typeof actions.referenceToImg2img === 'function' ? (
                <button type="button" className="ofs-ref-fallback" onClick={() => actions.referenceToImg2img()}>
                  {t('studio.reference.useImg2img')}
                </button>
              ) : null}
            </div>
          </div>
        )}

        {busy ? (
          <p className="ofs-hint ofs-ref-busy" role="status">
            <span className="ofs-shimmer" aria-hidden="true" />
            {t('studio.reference.uploading')}
          </p>
        ) : null}

        <input
          ref={inputRef}
          className="ofs-ref-input"
          type="file"
          accept={ACCEPT}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          hidden
          onChange={onFileChange}
        />
      </Fieldset>
    </div>
  )
}
