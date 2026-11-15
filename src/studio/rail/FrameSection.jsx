/**
 * 左栏第 3 节：画面比例预设与折叠的自定义宽高草稿输入。
 *
 * 有参考图时尺寸跟随参考图，只显示像素读数并收起比例/宽高控件。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'

import { clampSize } from '../../logic/clamp.js'
import { Icon } from '../icons.jsx'
import { DEFAULT_RATIOS } from '../presets.js'
import { Fieldset } from './Fieldset.jsx'

/**
 * 表单尺寸 → 宽/高输入框的展示文本。
 *
 * 表单里只存合法数字，这里再归一一次，保证「输入框看到的」与「将提交的」是同一个值；
 * 旧快照 / 测试夹具里出现空串时也不会渲染出空白或 `undefined`。
 */
function sizeDraftOf(width, height) {
  return { width: String(clampSize(width)), height: String(clampSize(height)) }
}

export function FrameSection({
  t,
  width,
  height,
  frameSizeText,
  ratioId,
  applyRatio,
  applyCustomSize,
  hasReference,
  referenceSize,
}) {
  // 宽/高输入框的编辑草稿：表单里只存合法数字，输入过程中的原始文本（含空串）先落在本地，
  // 失焦 / 回车时再归一化提交。外部改动（比例、档位、切换模型、带回参数）通过下面这个
  // effect 同步回草稿，保证输入框、读数与将提交的宽高永远是同一个值。
  const [sizeDraft, setSizeDraft] = React.useState(() => sizeDraftOf(width, height))
  const syncedSize = React.useRef(undefined)
  React.useEffect(() => {
    const previous = syncedSize.current
    syncedSize.current = { width, height }
    // 首次挂载的草稿已经由 useState 初始化，不需要再写一次状态。
    if (!previous) return
    if (previous.width === width && previous.height === height) return
    setSizeDraft(sizeDraftOf(width, height))
  }, [width, height])

  // 「自定义宽高」默认折叠；输入草稿逻辑不变，展开后才渲染输入框。
  const [customOpen, setCustomOpen] = React.useState(false)
  const onCustomSize = typeof applyCustomSize === 'function' ? applyCustomSize : () => {}

  /** 改写草稿：输入过程不碰表单，避免半截数字进入提交值。 */
  function updateSizeDraft(key, value) {
    setSizeDraft((prev) => ({ ...prev, [key]: value }))
  }

  /** 提交草稿：空值 / 纯空白恢复修改前的合法值（不写表单）；否则钳制后写回表单。 */
  function commitSizeDraft(key) {
    const raw = String(sizeDraft[key] ?? '').trim()
    const currentValue = key === 'width' ? width : height
    if (!raw) {
      setSizeDraft((prev) => ({ ...prev, [key]: String(clampSize(currentValue)) }))
      return
    }
    const value = clampSize(raw)
    setSizeDraft((prev) => ({ ...prev, [key]: String(value) }))
    if (value !== clampSize(currentValue)) onCustomSize({ [key]: value })
  }

  const sizeFields = [
    { key: 'width', label: t('studio.rail.width'), limits: LIMITS.width },
    { key: 'height', label: t('studio.rail.height'), limits: LIMITS.height },
  ]

  return (
    <Fieldset
      title={t('studio.rail.frame')}
      action={(
        <span className="ofs-frame-readout">
          {hasReference
            ? (referenceSize ? `${referenceSize} · ${t('studio.rail.followReference')}` : t('studio.rail.followReference'))
            : frameSizeText}
        </span>
      )}
    >
      {hasReference ? null : (
        <>
          <div className="ofs-frame-group">
            <span className="ofs-frame-label">{t('studio.rail.ratio')}</span>
            <div className="ofs-ratio-row" role="group" aria-label={t('studio.rail.ratio')}>
              {DEFAULT_RATIOS.map((ratio) => (
                <button
                  type="button"
                  key={ratio.id}
                  className={ratioId === ratio.id ? 'ofs-ratio is-on' : 'ofs-ratio'}
                  onClick={() => applyRatio(ratio.id)}
                  aria-pressed={ratioId === ratio.id}
                >
                  <span className={`ofs-ratio-glyph ofs-ratio-glyph--${ratio.id.replace(':', '-')}`} aria-hidden="true" />
                  <span className="ofs-ratio-label">{ratio.id}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义宽高：默认折叠，编辑过程走本地草稿，失焦才提交。 */}
          <div className="ofs-frame-group">
            <button
              type="button"
              className="ofs-custom-toggle"
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((open) => !open)}
            >
              <span>{t('studio.rail.customSize')}</span>
              <span className={customOpen ? 'ofs-chevron is-open' : 'ofs-chevron'} aria-hidden="true">
                <Icon name="chevronDown" size={14} />
              </span>
            </button>
            {customOpen ? (
              <div className="ofs-custom-body">
                <div className="ofs-size-custom">
                  {sizeFields.map((item, index) => (
                    <React.Fragment key={item.key}>
                      {index > 0 ? <span className="ofs-size-custom-times" aria-hidden="true">×</span> : null}
                      <label className="ofs-size-custom-field">
                        <span>{item.label}</span>
                        <input
                          type="number"
                          min={item.limits.min}
                          max={item.limits.max}
                          step={item.limits.step}
                          value={sizeDraft[item.key]}
                          aria-label={item.label}
                          onChange={(event) => updateSizeDraft(item.key, event.target.value)}
                          onBlur={() => commitSizeDraft(item.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                          }}
                        />
                      </label>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </Fieldset>
  )
}
