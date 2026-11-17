/**
 * 运行设置抽屉的表单主体：常规运行、下载与 Token、高级节以及底部保存条。
 */

import React from 'react'

import { SETTINGS } from '../../../shared/contract.js'

import { formatText } from '../../logic/format.js'
import {
  IDLE_MAX_MINUTES,
  IDLE_MIN_MINUTES,
  quickIdleMinutes,
  settingsErrorText,
} from '../../logic/settings.js'
import { SettingsAdvancedSection } from './SettingsAdvancedSection.jsx'

export function SettingsForm({
  t,
  view,
  form,
  patchForm,
  validation,
  tokenSource,
  advancedOpen,
  onToggleAdvanced,
  saveError,
  saving,
  canSave,
  onCancel,
  onSubmit,
}) {
  const activeQuick = quickIdleMinutes(form.idleMinutes)

  return (
    <div className="ofs-settings-form">
      {view && view.effectiveOnNextSession === true ? (
        <p className="ofs-settings-effective" role="status">{t('studio.settings.effectiveNext')}</p>
      ) : null}

      <section className="ofs-settings-section">
        <h3 className="ofs-settings-section-title">{t('studio.settings.section.runtime')}</h3>

        <div className="ofs-settings-row">
          <span className="ofs-settings-label">{t('studio.settings.idle.label')}</span>
          <div className="ofs-settings-quick" role="group" aria-label={t('studio.settings.idle.label')}>
            {SETTINGS.idleTimeoutSec.quickMinutes.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`ofs-chip ofs-settings-quick-item${activeQuick === minutes ? ' is-on' : ''}`}
                aria-pressed={activeQuick === minutes}
                onClick={() => patchForm({ idleMinutes: String(minutes) })}
              >
                {formatText(t('studio.settings.idle.quick'), { minutes })}
              </button>
            ))}
          </div>
        </div>

        <label className="ofs-settings-field">
          <span className="ofs-settings-label">
            {formatText(t('studio.settings.idle.custom'), { min: IDLE_MIN_MINUTES, max: IDLE_MAX_MINUTES })}
          </span>
          <input
            className="ofs-settings-input"
            type="number"
            inputMode="numeric"
            min={IDLE_MIN_MINUTES}
            max={IDLE_MAX_MINUTES}
            step={1}
            value={form.idleMinutes}
            onChange={(event) => patchForm({ idleMinutes: event.target.value })}
          />
        </label>

        <div className="ofs-settings-row">
          <span className="ofs-settings-label">{t('studio.settings.provider.label')}</span>
          <div className="ofs-settings-options" role="radiogroup" aria-label={t('studio.settings.provider.label')}>
            {SETTINGS.providers.map((id) => (
              <label key={id} className={`ofs-settings-option${form.provider === id ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="ofs-provider"
                  value={id}
                  checked={form.provider === id}
                  onChange={() => patchForm({ provider: id })}
                />
                <span>{t(`studio.settings.provider.${id}`)}</span>
              </label>
            ))}
          </div>
        </div>

        {form.provider === 'colab' ? (
          <>
            <div className="ofs-settings-row">
              <span className="ofs-settings-label">{t('studio.settings.colabGpu.label')}</span>
              <div className="ofs-settings-options" role="radiogroup" aria-label={t('studio.settings.colabGpu.label')}>
                {SETTINGS.colabGpus.map((id) => (
                  <label key={id} className={`ofs-settings-option${form.colabGpu === id ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name="ofs-colab-gpu"
                      value={id}
                      checked={form.colabGpu === id}
                      onChange={() => patchForm({ colabGpu: id })}
                    />
                    <span>{t(`studio.settings.colabGpu.${id}`)}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="ofs-settings-inline">
              <input
                type="checkbox"
                checked={form.colabHighRam === true}
                onChange={(event) => patchForm({ colabHighRam: event.target.checked })}
              />
              <span className="ofs-settings-label">{t('studio.settings.colabHighRam.label')}</span>
            </label>
            <p className="ofs-settings-muted">{t('studio.settings.colabHighRam.hint')}</p>
          </>
        ) : null}

        <div className="ofs-settings-row">
          <span className="ofs-settings-label">{t('studio.settings.accelerator.label')}</span>
          <div className="ofs-settings-options" role="radiogroup" aria-label={t('studio.settings.accelerator.label')}>
            {SETTINGS.accelerators.map((id) => (
              <label
                key={id}
                className={`ofs-settings-option${form.accelerator === id ? ' is-on' : ''}`}
              >
                <input
                  type="radio"
                  name="ofs-accelerator"
                  value={id}
                  checked={form.accelerator === id}
                  onChange={() => patchForm({ accelerator: id })}
                />
                <span>{t(`studio.settings.accelerator.${id}`)}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="ofs-settings-section">
        <h3 className="ofs-settings-section-title">{t('studio.settings.section.download')}</h3>
        <label className="ofs-settings-field">
          <span className="ofs-settings-label">{t('studio.settings.hfToken.label')}</span>
          <input
            className="ofs-settings-input"
            type="password"
            autoComplete="off"
            value={form.hfToken}
            placeholder={view && view.hasHfToken === true
              ? t('studio.settings.hfToken.placeholderSet')
              : t('studio.settings.hfToken.placeholder')}
            onChange={(event) => patchForm({ hfToken: event.target.value, clearHfToken: false })}
          />
        </label>
        {view && view.hasHfToken === true ? (
          <div className="ofs-settings-inline">
            <span className="ofs-settings-muted">
              {formatText(t('studio.settings.hfToken.source'), { source: tokenSource })}
            </span>
            {form.clearHfToken ? (
              <span className="ofs-settings-muted">{t('studio.settings.hfToken.clearPending')}</span>
            ) : (
              <button
                type="button"
                className="ofs-chip ofs-settings-clear"
                onClick={() => patchForm({ hfToken: '', clearHfToken: true })}
              >
                {t('studio.settings.hfToken.clear')}
              </button>
            )}
          </div>
        ) : null}
      </section>

      <SettingsAdvancedSection
        t={t}
        form={form}
        patchForm={patchForm}
        advancedOpen={advancedOpen}
        onToggleAdvanced={onToggleAdvanced}
        validationErrors={validation.errors}
      />

      <footer className="ofs-settings-foot">
        {!validation.ok ? (
          <p className="ofs-settings-error" role="alert">
            {formatText(t('studio.settings.invalid'), { count: validation.errors.length })}
          </p>
        ) : null}
        {saveError ? (
          <p className="ofs-settings-error" role="alert">{settingsErrorText(t, saveError)}</p>
        ) : null}
        <span className="ofs-grow" />
        <button type="button" className="ofs-chip" onClick={onCancel}>
          {t('studio.settings.cancel')}
        </button>
        <button
          type="button"
          className="ofs-btn is-primary ofs-settings-save"
          disabled={!canSave}
          aria-busy={saving}
          onClick={onSubmit}
        >
          {saving ? t('studio.settings.saving') : t('studio.settings.save')}
        </button>
      </footer>
    </div>
  )
}
