/**
 * 左栏第 4 节：排除项（仅在模型消费负向词时显示）与高级参数（步数、CFG、种子）。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'
import { stepModeOf, stepTierOf } from '../../../shared/models-guide.js'

import { Tooltip } from '../../components/Tooltip.jsx'
import { formatText } from '../../logic/format.js'
import { Icon } from '../icons.jsx'
import { Drawer } from './Drawer.jsx'
import { Fieldset } from './Fieldset.jsx'

function AdvancedParamsGrid({
  t,
  fields,
  activePreset,
  patchForm,
  applyCfg,
  resetSeed,
  seedText,
}) {
  const stepMode = stepModeOf(activePreset)
  const stepTier = stepTierOf(activePreset, fields.steps)
  const stepRange = stepMode === 'range' ? activePreset.stepRange : null
  const displayedSteps = stepMode === 'fixed' && Number.isFinite(Number(activePreset?.steps))
    ? Number(activePreset.steps)
    : Number(fields.steps) || 1
  const onResetSeed = typeof resetSeed === 'function' ? resetSeed : () => patchForm({ seed: '' })
  const onCfgChange = typeof applyCfg === 'function'
    ? applyCfg
    : (value) => patchForm({ cfg: Number(value) })

  return (
    <div className="ofs-grid2">
      <div className="ofs-field ofs-field--wide">
        <div className="ofs-step-head">
          <span className="ofs-field-label">
            {t('studio.steps')}
            <Tooltip text={t(stepMode === 'fixed' ? 'studio.stepsFixedTooltip' : 'studio.stepsTooltip')} />
          </span>
          <span className={stepMode === 'fixed' ? 'ofs-step-readout is-fixed' : 'ofs-step-readout'}>
            {formatText(t('studio.stepsReadout'), {
              steps: displayedSteps,
              tier: t(`studio.stepsTier.${stepTier}`),
            })}
          </span>
        </div>
        <input
          type="range"
          className="ofs-step-slider"
          min={stepRange ? stepRange.min : displayedSteps}
          max={stepRange ? stepRange.max : displayedSteps}
          step={stepRange ? stepRange.step : 1}
          value={displayedSteps}
          disabled={stepMode === 'fixed'}
          aria-label={t('studio.steps')}
          onChange={(event) => patchForm({ steps: Number(event.target.value) })}
        />
        {stepRange ? (
          <div className="ofs-step-ticks">
            {(['fast', 'balanced', 'fine']).map((key) => (
              <button
                key={key}
                type="button"
                className={stepTier === key ? 'ofs-step-tick is-on' : 'ofs-step-tick'}
                onClick={() => patchForm({ steps: stepRange[key] })}
              >
                {`${t(`studio.stepsTier.${key}`)} ${stepRange[key]}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="ofs-field ofs-field--wide">
        <span className="ofs-field-label">
          {t('studio.cfg')}
          <Tooltip text={t('studio.cfgTooltip')} />
        </span>
        <input
          type="number"
          min={LIMITS.cfg.min}
          max={LIMITS.cfg.max}
          step={0.5}
          value={fields.cfg}
          aria-label={t('studio.cfg')}
          onChange={(event) => onCfgChange(Number(event.target.value))}
        />
      </div>

      <div className="ofs-field ofs-field--wide">
        <span>{t('studio.seed')}</span>
        <div className="ofs-seed-row">
          <input
            type="text"
            inputMode="numeric"
            value={fields.seed}
            placeholder={t('studio.random')}
            aria-label={t('studio.seed')}
            onChange={(event) => patchForm({ seed: event.target.value })}
          />
          <button
            type="button"
            className="ofs-text-action ofs-seed-reset"
            onClick={onResetSeed}
            disabled={!seedText}
          >
            {t('studio.seed.reset')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ParamsSection({
  t,
  fields,
  activePreset,
  patchForm,
  applyCfg,
  resetSeed,
  showNegative,
  negativeOpen,
  setNegativeOpen,
  negativePlaceholder,
  advancedOpen,
  toggleAdvanced,
}) {
  // 高级设置折叠态读数：一眼看清将用什么参数生成，不必展开。
  const stepsValue = Number.isFinite(Number(fields.steps)) ? Math.round(Number(fields.steps)) : LIMITS.steps.min
  const cfgValue = Number.isFinite(Number(fields.cfg)) ? Number(fields.cfg) : LIMITS.cfg.min
  const seedText = String(fields.seed ?? '').trim()
  const paramsReadout = [
    `${stepsValue} ${t('studio.preset.stepsUnit')}`,
    `CFG ${cfgValue}`,
    seedText ? `${t('studio.meta.seed')} ${seedText}` : t('studio.seed'),
  ].join(' · ')

  return (
    <Fieldset
      title={t('studio.rail.advanced')}
      action={advancedOpen ? null : <span className="ofs-row-readout">{paramsReadout}</span>}
    >
      <div className="ofs-rows">
        {/* 排除项只在当前模型 + CFG 真的消费负向词时出现；隐藏时不写、不提交。 */}
        {showNegative ? (
          <div className={negativeOpen ? 'ofs-row is-open' : 'ofs-row'}>
            <div className="ofs-row-head">
              <button
                type="button"
                className="ofs-row-toggle"
                onClick={() => setNegativeOpen((open) => !open)}
                aria-expanded={negativeOpen}
              >
                <span>{t('studio.negative')}</span>
                <span className={negativeOpen ? 'ofs-chevron is-open' : 'ofs-chevron'} aria-hidden="true">
                  <Icon name="chevronDown" size={14} />
                </span>
              </button>
              <Tooltip text={t('studio.negativeTooltip')} />
            </div>
            {negativeOpen ? (
              <Drawer>
                <textarea
                  className="ofs-row-textarea"
                  rows={3}
                  value={fields.negative}
                  placeholder={negativePlaceholder}
                  spellCheck={false}
                  onChange={(event) => patchForm({ negative: event.target.value })}
                />
              </Drawer>
            ) : null}
          </div>
        ) : null}

        <div className={advancedOpen ? 'ofs-row is-open' : 'ofs-row'}>
          <div className="ofs-row-head">
            <button
              type="button"
              className="ofs-row-toggle"
              onClick={toggleAdvanced}
              aria-expanded={advancedOpen}
            >
              <span>{t('studio.rail.params')}</span>
              <span className={advancedOpen ? 'ofs-chevron is-open' : 'ofs-chevron'} aria-hidden="true">
                <Icon name="chevronDown" size={14} />
              </span>
            </button>
          </div>
          {advancedOpen ? (
            <Drawer>
              <AdvancedParamsGrid
                t={t}
                fields={fields}
                activePreset={activePreset}
                patchForm={patchForm}
                applyCfg={applyCfg}
                resetSeed={resetSeed}
                seedText={seedText}
              />
            </Drawer>
          ) : null}
        </div>
      </div>
    </Fieldset>
  )
}
