/**
 * 顶栏模型选择卡（ModelCardPicker）。
 *
 * 触发器只保留当前模型的三个事实：家族徽标、模型主名、实测稳态耗时；
 * 展开后是一列海报卡：56×56 海报 + 家族 + 主名 + 定位描述 + 参数规格 + 实测耗时。
 *
 * 交互按 WAI-ARIA listbox：方向键循环、Enter/Space 选中、Esc 关闭并把焦点还给触发器、
 * 点击外部关闭；两个顶栏弹层（算力 / 模型）由 TopBar 负责互斥。
 */

import React from 'react'

import { formatSeconds } from '../logic/format.js'
import { Icon } from './icons.jsx'
import posterAnimagine from './posters/animagine-xl-3.1.webp'
import posterAnimaLavender from './posters/anima-light-lavender.webp'
import posterBase from './posters/sdxl-base.webp'
import posterFlux from './posters/flux2-klein-4b.webp'
import posterHyper from './posters/hyper-sdxl-8step.webp'
import posterLightning from './posters/sdxl-lightning.webp'
import posterPlayground from './posters/playground-v2.5.webp'
import posterRealvis from './posters/realvis-v5.webp'
import posterTurbo from './posters/sdxl-turbo.webp'

const MENU_ID = 'ofs-model-menu'

/** 模型海报：按模型 id 对应 src/studio/posters/*.webp，构建期内联为 data URL。 */
const POSTERS = {
  'sdxl-lightning': posterLightning,
  'hyper-sdxl-8step': posterHyper,
  'sdxl-turbo': posterTurbo,
  'playground-v2.5': posterPlayground,
  'sdxl-base': posterBase,
  'realvis-v5': posterRealvis,
  'flux2-klein-4b': posterFlux,
  'animagine-xl-3.1': posterAnimagine,
  'anima-light-lavender': posterAnimaLavender,
}

const LABELS = {
  menuTitle: 'studio.preset.menuTitle',
  measured: 'studio.preset.measured',
  default: 'studio.preset.default',
  footer: 'studio.preset.footer',
  steps: 'studio.preset.stepsUnit',
  dualGpu: 'studio.preset.dualGpu',
}

function shortOf(preset) {
  return preset.short || preset.label || preset.id
}

function descriptionOf(preset, isEn) {
  const value = preset.description
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[isEn ? 'en' : 'zh'] || value.zh || value.en || ''
}

function etaOf(t, preset) {
  const seconds = Number(preset.steadySeconds)
  return Number.isFinite(seconds) ? `~${formatSeconds(t, seconds)}` : ''
}

function specOf(t, preset) {
  const parts = []
  if (preset.params) parts.push(preset.params)
  if (preset.size) parts.push(`${preset.size}px`)
  if (Number(preset.gpus) > 1) parts.push(t(LABELS.dualGpu))
  else if (Number.isFinite(Number(preset.steps))) parts.push(`${preset.steps} ${t(LABELS.steps)}`)
  return parts.join(' · ')
}

export function ModelCardPicker(props) {
  const { t, isEn, presets, value, defaultPreset, onChange, open, onOpenChange } = props
  const list = Array.isArray(presets) ? presets : []
  const active = list.find((preset) => preset.id === value) || list[0] || null
  const rootRef = React.useRef(null)
  const triggerRef = React.useRef(null)
  const listRef = React.useRef(null)

  // 打开后把焦点交给当前选中项，并保证它在 420px 高度内可见。
  React.useEffect(() => {
    if (!open || !listRef.current) return
    const options = listRef.current.querySelectorAll('[role="option"]')
    if (options.length === 0) return
    const index = Math.max(0, list.findIndex((preset) => preset.id === value))
    const target = options[index] || options[0]
    if (typeof target.focus === 'function') target.focus({ preventScroll: true })
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' })
  }, [open, value, list])

  // 点击外部 / Esc / Tab 关闭；Esc 后焦点回到触发器。
  React.useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onOpenChange(false)
        if (triggerRef.current) triggerRef.current.focus({ preventScroll: true })
      } else if (event.key === 'Tab') {
        onOpenChange(false)
      }
    }
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onOpenChange])

  function choose(preset) {
    if (onChange) onChange(preset)
    onOpenChange(false)
    if (triggerRef.current) triggerRef.current.focus({ preventScroll: true })
  }

  function onListKeyDown(event) {
    if (!listRef.current) return
    const options = Array.prototype.slice.call(listRef.current.querySelectorAll('[role="option"]'))
    if (options.length === 0) return
    const current = options.indexOf(document.activeElement)
    let next = null
    if (event.key === 'ArrowDown') next = options[(current + 1) % options.length]
    else if (event.key === 'ArrowUp') next = options[(current - 1 + options.length) % options.length]
    else if (event.key === 'Home') next = options[0]
    else if (event.key === 'End') next = options[options.length - 1]
    if (!next) return
    event.preventDefault()
    next.focus({ preventScroll: true })
    if (typeof next.scrollIntoView === 'function') next.scrollIntoView({ block: 'nearest' })
  }

  if (!active) {
    return (
      <span className="ofs-model is-empty" aria-hidden="true">
        <Icon name="sliders" size={14} />
        <span className="ofs-model-now">—</span>
      </span>
    )
  }

  const eta = etaOf(t, active)
  const poster = POSTERS[active.id] || ''

  return (
    <div className="ofs-model-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ofs-model"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={MENU_ID}
        aria-label={t('studio.preset')}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            onOpenChange(true)
          }
        }}
      >
        <Icon name="sliders" size={14} />
        {active.family ? <span className="ofs-model-family">{active.family}</span> : null}
        <span className="ofs-model-now">{shortOf(active)}</span>
        {eta ? (
          <>
            <span className="ofs-model-div" aria-hidden="true" />
            <span className="ofs-model-eta">{eta}</span>
          </>
        ) : null}
        <Icon name="chevronDown" size={13} className="ofs-model-caret" />
      </button>

      {open ? (
        <div className="ofs-model-menu" id={MENU_ID}>
          <div className="ofs-model-head">
            <span>{`${t(LABELS.menuTitle)}${list.length > 1 ? ` · ${list.length}` : ''}`}</span>
            <span>{t(LABELS.measured)}</span>
          </div>
          <div className="ofs-model-list" role="listbox" aria-label={t(LABELS.menuTitle)} ref={listRef} onKeyDown={onListKeyDown}>
            {list.map((preset) => {
              const selected = preset.id === active.id
              const image = POSTERS[preset.id] || ''
              const isDefault = preset.id === defaultPreset
              const optionEta = etaOf(t, preset)
              const description = descriptionOf(preset, isEn)
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selected ? 'true' : 'false'}
                  className={`ofs-model-option${selected ? ' is-on' : ''}`}
                  data-preset-id={preset.id}
                  onClick={() => choose(preset)}
                >
                  <span className="ofs-model-poster" aria-hidden="true">
                    {image ? (
                      <img src={image} alt="" width="56" height="56" draggable="false" />
                    ) : (
                      <span className="ofs-model-poster-fallback">{(preset.family || preset.id || 'M').slice(0, 1)}</span>
                    )}
                  </span>
                  <span className="ofs-model-copy">
                    <span className="ofs-model-line">
                      {preset.family ? <span className="ofs-model-fam">{preset.family}</span> : null}
                      <span className="ofs-model-name">{shortOf(preset)}</span>
                      {isDefault ? <span className="ofs-model-default">{t(LABELS.default)}</span> : null}
                    </span>
                    {description ? <span className="ofs-model-desc">{description}</span> : null}
                    <span className="ofs-model-spec">{specOf(t, preset)}</span>
                  </span>
                  <span className="ofs-model-side">
                    {optionEta ? <span className="ofs-model-option-eta">{optionEta}</span> : <span className="ofs-model-option-eta" />}
                    <span className="ofs-model-check" aria-hidden="true">
                      <Icon name="check" size={15} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="ofs-model-foot">{t(LABELS.footer)}</div>
        </div>
      ) : null}
    </div>
  )
}