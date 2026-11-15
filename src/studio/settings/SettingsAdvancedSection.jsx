/**
 * 运行设置抽屉的「高级：预挂载与依赖锁定」可折叠节。
 */

import React from 'react'

import { SETTINGS } from '../../../shared/contract.js'

import { formatText } from '../../logic/format.js'
import { KAGGLE_CREDENTIAL_PATH } from '../../logic/guidance.js'
import { kaggleTransportLabelKey } from '../../logic/settings.js'
import { Icon } from '../icons.jsx'

export function SettingsAdvancedSection({
  t,
  form,
  patchForm,
  advancedOpen,
  onToggleAdvanced,
  validationErrors,
}) {
  return (
    <section className="ofs-settings-section">
      <button
        type="button"
        className="ofs-settings-advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={onToggleAdvanced}
      >
        <span>{t('studio.settings.advanced.toggle')}</span>
        <span className={`ofs-chevron${advancedOpen ? ' is-open' : ''}`}>
          <Icon name="chevronDown" size={13} />
        </span>
      </button>

      {advancedOpen ? (
        <div className="ofs-settings-advanced">
          {/* Kaggle 访问方式：cli（默认，调用本机 CLI）/ direct（Node 直连，试验特性）。
              切换在下次唤醒或下次环境检查时生效，与「下次会话生效」提示同一口径。 */}
          <div className="ofs-settings-row">
            <span className="ofs-settings-label">{t('studio.settings.kaggleTransport.label')}</span>
            <div
              className="ofs-settings-options"
              role="radiogroup"
              aria-label={t('studio.settings.kaggleTransport.label')}
            >
              {SETTINGS.kaggleTransports.map((transport) => (
                <label
                  key={transport}
                  className={`ofs-settings-option${form.kaggleTransport === transport ? ' is-on' : ''}`}
                >
                  <input
                    type="radio"
                    name="ofs-kaggle-transport"
                    value={transport}
                    checked={form.kaggleTransport === transport}
                    onChange={() => patchForm({ kaggleTransport: transport })}
                  />
                  <span>{t(kaggleTransportLabelKey(transport))}</span>
                </label>
              ))}
            </div>
            {form.kaggleTransport === 'direct' ? (
              <small className="ofs-settings-hint">
                {formatText(t('studio.settings.kaggleTransport.directHint'), {
                  path: KAGGLE_CREDENTIAL_PATH,
                })}
              </small>
            ) : null}
          </div>

          <label className="ofs-settings-field">
            <span className="ofs-settings-label">{t('studio.settings.dataset.label')}</span>
            <textarea
              className="ofs-settings-textarea"
              rows={3}
              value={form.datasetSourcesText}
              placeholder={t('studio.settings.dataset.placeholder')}
              onChange={(event) => patchForm({ datasetSourcesText: event.target.value })}
            />
            <small className="ofs-settings-hint">
              {formatText(t('studio.settings.dataset.hint'), { max: SETTINGS.maxItems })}
            </small>
          </label>

          <label className="ofs-settings-field">
            <span className="ofs-settings-label">{t('studio.settings.localModels.label')}</span>
            <textarea
              className="ofs-settings-textarea"
              rows={3}
              value={form.localModelsText}
              placeholder={t('studio.settings.localModels.placeholder')}
              onChange={(event) => patchForm({ localModelsText: event.target.value })}
            />
            <small className="ofs-settings-hint">{t('studio.settings.localModels.hint')}</small>
          </label>
          {validationErrors.length > 0 ? (
            <ul className="ofs-settings-errors">
              {validationErrors.map((error) => (
                <li key={`${error.line}-${error.message}`} className="ofs-settings-error-item">
                  {formatText(t(error.message), { line: error.line, ...(error.params || {}) })}
                </li>
              ))}
            </ul>
          ) : null}

          <label className="ofs-settings-field">
            <span className="ofs-settings-label">{t('studio.settings.pip.label')}</span>
            <textarea
              className="ofs-settings-textarea"
              rows={3}
              value={form.pipConstraintsText}
              placeholder={t('studio.settings.pip.placeholder')}
              onChange={(event) => patchForm({ pipConstraintsText: event.target.value })}
            />
            <small className="ofs-settings-hint">{t('studio.settings.pip.hint')}</small>
          </label>
        </div>
      ) : null}
    </section>
  )
}
