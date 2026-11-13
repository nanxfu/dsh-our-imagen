/**
 * 运行设置抽屉：把宿主插件配置里的运行项搬到界面上，风格对齐 LogsDrawer。
 *
 * - 打开时 GET 一次脱敏视图（不轮询）；失败给可重试的错误态，不白屏；
 * - 三段式：常规运行 / 模型下载与限流防护 / 高级（默认折叠的预挂载与依赖锁定）；
 * - 保存只提交真正变化的字段（见 logic/settings.js 的 buildSettingsPayload），
 *   成功后 toast 并把新视图写回表单；保存中禁用按钮；
 * - Esc / 遮罩 / 关闭按钮都能关，Tab 在抽屉内循环，关闭后焦点由 useStudioUi 还给触发元素。
 *
 * 接收 { t, ui, onClose } 领域对象。
 */

import React from 'react'

import { SETTINGS } from '../../shared/contract.js'

import { Icon } from './icons.jsx'
import { fetchSettings, saveSettings } from '../api/resources.js'
import { formatText } from '../logic/format.js'
import {
  IDLE_MAX_MINUTES,
  IDLE_MIN_MINUTES,
  buildSettingsPayload,
  formFromSettings,
  hasSettingsChanges,
  hfTokenSourceKey,
  quickIdleMinutes,
  settingsErrorText,
  settingsViewOf,
  validateSettingsForm,
} from '../logic/settings.js'

/** 弹层内可聚焦元素（焦点陷阱用，与 LogsDrawer 同一份选择器）。 */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function SettingsDrawer(props) {
  const { t, ui, onClose } = props
  // 预览 / 渲染测试用：预展开高级区、预填一份未保存的草稿（正式界面不传）。
  const { defaultAdvancedOpen, defaultDraft } = props
  const panelRef = React.useRef(null)
  const closeRef = React.useRef(null)
  // onClose 每次父渲染都会变；用 ref 持有，避免抽屉内部状态变化时重复抢焦点。
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  const [status, setStatus] = React.useState('loading')
  const [view, setView] = React.useState(null)
  const [form, setForm] = React.useState(null)
  const [loadError, setLoadError] = React.useState(null)
  const [saveError, setSaveError] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(Boolean(defaultAdvancedOpen))
  const [reloadKey, setReloadKey] = React.useState(0)

  // 打开即取一次设置；重试由 reloadKey 推进。组件卸下后不再写状态。
  React.useEffect(() => {
    let alive = true
    setStatus('loading')
    setLoadError(null)
    fetchSettings().then((result) => {
      if (!alive) return
      const next = settingsViewOf(result)
      if (next) {
        setView(next)
        const base = formFromSettings(next)
        setForm(defaultDraft && typeof defaultDraft === 'object' ? { ...base, ...defaultDraft } : base)
        setStatus('ready')
        return
      }
      setStatus('error')
      setLoadError({ code: (result && result.code) || 'internal_error', message: (result && result.message) || '' })
    })
    return () => {
      alive = false
    }
  }, [reloadKey])

  // Esc 关闭 + Tab 在抽屉内循环；打开时焦点落到关闭按钮。
  React.useEffect(() => {
    if (closeRef.current && typeof closeRef.current.focus === 'function') closeRef.current.focus()

    function onKey(event) {
      if (event.key === 'Escape') {
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        if (typeof onCloseRef.current === 'function') onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel || typeof panel.querySelectorAll !== 'function') return
      const nodes = Array.prototype.slice
        .call(panel.querySelectorAll(FOCUSABLE))
        .filter((node) => !node.disabled && node.getAttribute('aria-hidden') !== 'true')
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const outside = !panel.contains || !panel.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        if (event.preventDefault) event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        if (event.preventDefault) event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function patchForm(patch) {
    setForm((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  const validation = form ? validateSettingsForm(form) : { ok: true, errors: [], localModels: {} }
  const payload = form && view ? buildSettingsPayload(form, view) : {}
  const dirty = hasSettingsChanges(payload)
  const canSave = status === 'ready' && Boolean(form) && !saving && dirty && validation.ok
  const tokenSource = view ? t(hfTokenSourceKey(view.hfTokenSource)) : ''

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    const result = await saveSettings(payload)
    const next = settingsViewOf(result)
    setSaving(false)
    if (next) {
      setView(next)
      setForm(formFromSettings(next))
      if (ui && typeof ui.showToast === 'function') ui.showToast(t('studio.settings.saved'))
      return
    }
    setSaveError({ code: (result && result.code) || 'internal_error', message: (result && result.message) || '' })
  }

  /** 错误态：请求失败原因 + 重试按钮，保持抽屉结构可用。 */
  function renderLoadError() {
    return (
      <div className="ofs-settings-error-state">
        <p className="ofs-settings-error" role="alert">
          {t('studio.settings.loadFailed')}
          {loadError && (loadError.code || loadError.message) ? ` · ${settingsErrorText(t, loadError)}` : ''}
        </p>
        <button type="button" className="ofs-chip" onClick={() => setReloadKey((value) => value + 1)}>
          {t('studio.settings.retry')}
        </button>
      </div>
    )
  }

  function renderForm() {
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

        <section className="ofs-settings-section">
          <button
            type="button"
            className="ofs-settings-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <span>{t('studio.settings.advanced.toggle')}</span>
            <span className={`ofs-chevron${advancedOpen ? ' is-open' : ''}`}>
              <Icon name="chevronDown" size={13} />
            </span>
          </button>

          {advancedOpen ? (
            <div className="ofs-settings-advanced">
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
              {validation.errors.length > 0 ? (
                <ul className="ofs-settings-errors">
                  {validation.errors.map((error) => (
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
          <button type="button" className="ofs-chip" onClick={() => onCloseRef.current && onCloseRef.current()}>
            {t('studio.settings.cancel')}
          </button>
          <button
            type="button"
            className="ofs-btn is-primary ofs-settings-save"
            disabled={!canSave}
            aria-busy={saving}
            onClick={submit}
          >
            {saving ? t('studio.settings.saving') : t('studio.settings.save')}
          </button>
        </footer>
      </div>
    )
  }

  return (
    <div className="ofs-settings" role="presentation" onClick={() => onCloseRef.current && onCloseRef.current()}>
      <div
        className="ofs-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('studio.settings.title')}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ofs-settings-head">
          <span className="ofs-settings-title">{t('studio.settings.title')}</span>
          <span className="ofs-grow" />
          <button
            ref={closeRef}
            type="button"
            className="ofs-icon-btn"
            onClick={() => onCloseRef.current && onCloseRef.current()}
            title={t('studio.settings.close')}
            aria-label={t('studio.settings.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="ofs-settings-body">
          {status === 'loading' ? <p className="ofs-settings-note">{t('studio.settings.loading')}</p> : null}
          {status === 'error' ? renderLoadError() : null}
          {status === 'ready' && form ? renderForm() : null}
        </div>
      </div>
    </div>
  )
}
