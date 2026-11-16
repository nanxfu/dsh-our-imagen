/**
 * 左栏第 2 节：参考图槽位、重绘强度与蒙版状态。
 *
 * 三种形态：
 *  - 无参考图且当前模型支持垫图：空槽位。专用局部重绘模型给虚线框与两步引导
 *    （先选参考图 → 再涂抹蒙版），普通垫图模型只给一行轻量入口；
 *  - 无参考图且当前模型不支持垫图：整块不渲染，文生图界面与改造前一致；
 *  - 有参考图：缩略图 / 文件名 / 强度滑块；支持局部重绘时补蒙版读数与
 *    「继续涂抹」「清空蒙版」两个入口（画布本身在 Stage）。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'

import { formatText } from '../../logic/format.js'
import { referenceFileName } from '../../logic/generate.js'
import { Icon } from '../icons.jsx'
import { Fieldset } from './Fieldset.jsx'

/** 蒙版相关按钮的触控热区：与 Stage 的 MASK_HIT_STYLE 同一约定。 */
const MASK_HIT_STYLE = { minHeight: 44, minWidth: 44 }

/** 覆盖率 → 读数百分比：与 Stage 的 percentOf 同口径，不足 10% 保留一位小数。 */
function percentOf(coverage) {
  const value = Number(coverage)
  if (!Number.isFinite(value) || value <= 0) return 0
  const percent = Math.min(100, value * 100)
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
}

export function ReferenceSection({
  t,
  referenceImage,
  referenceSupported,
  strength,
  strengthMax,
  mask,
  inpaintOnly,
  inpaintSupported,
  referenceBlocked,
  applyStrength,
  removeReference,
  onBeginPaint,
  onClearMask,
  onPickFromGallery,
}) {
  const supported = referenceSupported === true
  const hasReference = Boolean(referenceImage)
  const pickFromGallery = typeof onPickFromGallery === 'function' ? onPickFromGallery : () => {}

  // 没有参考图：不支持垫图的模型整块隐藏；支持时给首次使用引导。
  if (!hasReference) {
    if (!supported) return null
    return (
      <Fieldset title={t('studio.reference.title')}>
        {inpaintOnly ? (
          <div className="ofs-reference-empty">
            <span className="ofs-reference-empty-title">{t('studio.reference.emptyTitle')}</span>
            <span className="ofs-reference-empty-hint">{t('studio.reference.emptyHint')}</span>
            <button type="button" className="ofs-reference-pick" style={MASK_HIT_STYLE} onClick={pickFromGallery}>
              <Icon name="images" size={15} />
              {t('studio.reference.emptyAction')}
            </button>
          </div>
        ) : (
          <div className="ofs-reference-entry">
            <span className="ofs-hint ofs-reference-entry-hint">{t('studio.reference.emptySimple')}</span>
            <button type="button" className="ofs-reference-pick" style={MASK_HIT_STYLE} onClick={pickFromGallery}>
              <Icon name="images" size={15} />
              {t('studio.reference.emptyAction')}
            </button>
          </div>
        )}
      </Fieldset>
    )
  }

  const referenceName = referenceFileName(referenceImage.path)
  const strengthValue = Number.isFinite(Number(strength)) ? Number(strength) : LIMITS.strength.default
  // 强度上限由表单域按场景给出：带蒙版 1.0，整图图生图 0.9；旧版本没有该字段时退回契约默认。
  const strengthLimit = Number.isFinite(Number(strengthMax)) ? Number(strengthMax) : LIMITS.strength.max
  const onRemoveReference = typeof removeReference === 'function' ? removeReference : () => {}
  const onStrengthChange = typeof applyStrength === 'function' ? applyStrength : () => {}
  const onBeginPaintAction = typeof onBeginPaint === 'function' ? onBeginPaint : () => {}
  const onClearMaskAction = typeof onClearMask === 'function' ? onClearMask : () => {}
  const showMask = inpaintSupported === true

  return (
    <Fieldset
      title={t('studio.reference.title')}
      action={(
        <button type="button" className="ofs-text-action ofs-reference-remove" onClick={onRemoveReference}>
          {t('studio.reference.remove')}
        </button>
      )}
    >
      <div className={referenceBlocked ? 'ofs-reference is-unsupported' : 'ofs-reference'}>
        <span className="ofs-reference-thumb">
          {referenceImage.url ? (
            <img src={referenceImage.url} alt={referenceName || t('studio.reference.title')} loading="lazy" />
          ) : (
            <Icon name="image" size={18} />
          )}
        </span>
        <div className="ofs-reference-meta">
          <span className="ofs-reference-name" title={referenceName || undefined}>
            {referenceName || '—'}
          </span>
          <label className="ofs-reference-strength" title={t('studio.reference.hint')}>
            <span className="ofs-reference-strength-head">
              {t('studio.reference.strength')}
              <b>{strengthValue.toFixed(2)}</b>
            </span>
            <input
              type="range"
              className="ofs-reference-range"
              min={LIMITS.strength.min}
              max={strengthLimit}
              step={LIMITS.strength.step}
              value={strengthValue}
              disabled={Boolean(referenceBlocked)}
              aria-label={t('studio.reference.strength')}
              onChange={(event) => onStrengthChange(event.target.value)}
            />
          </label>
        </div>
      </div>
      {showMask ? (
        <div className="ofs-reference-mask">
          <span className={mask ? 'ofs-hint ofs-reference-mask-readout' : 'ofs-muted ofs-reference-mask-readout'}>
            {mask
              ? formatText(t('studio.reference.maskCoverage'), { percent: percentOf(mask.coverage) })
              : t('studio.reference.maskEmpty')}
          </span>
          <div className="ofs-reference-mask-actions">
            <button
              type="button"
              className="ofs-reference-action ofs-reference-paint"
              style={MASK_HIT_STYLE}
              onClick={onBeginPaintAction}
            >
              {t('studio.reference.continuePaint')}
            </button>
            <button
              type="button"
              className="ofs-reference-action ofs-reference-clear"
              style={MASK_HIT_STYLE}
              onClick={onClearMaskAction}
              disabled={!mask}
            >
              {t('studio.reference.clearMask')}
            </button>
          </div>
        </div>
      ) : null}
      {referenceBlocked ? (
        <p className="ofs-hint ofs-reference-warn">{t('studio.reference.unsupported')}</p>
      ) : null}
    </Fieldset>
  )
}
