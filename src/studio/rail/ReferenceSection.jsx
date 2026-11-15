/**
 * 左栏第 2 节：参考图槽位与重绘强度（仅在已有参考图时渲染）。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'

import { referenceFileName } from '../../logic/generate.js'
import { Icon } from '../icons.jsx'
import { Fieldset } from './Fieldset.jsx'

export function ReferenceSection({
  t,
  referenceImage,
  strength,
  referenceBlocked,
  applyStrength,
  removeReference,
}) {
  if (!referenceImage) return null
  const referenceName = referenceFileName(referenceImage.path)
  const strengthValue = Number.isFinite(Number(strength)) ? Number(strength) : LIMITS.strength.default
  const onRemoveReference = typeof removeReference === 'function' ? removeReference : () => {}
  const onStrengthChange = typeof applyStrength === 'function' ? applyStrength : () => {}

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
              max={LIMITS.strength.max}
              step={LIMITS.strength.step}
              value={strengthValue}
              disabled={Boolean(referenceBlocked)}
              aria-label={t('studio.reference.strength')}
              onChange={(event) => onStrengthChange(event.target.value)}
            />
          </label>
        </div>
      </div>
      {referenceBlocked ? (
        <p className="ofs-hint ofs-reference-warn">{t('studio.reference.unsupported')}</p>
      ) : null}
    </Fieldset>
  )
}
