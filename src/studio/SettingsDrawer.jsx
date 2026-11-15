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

import { Icon } from './icons.jsx'
import { fetchSettings, saveSettings } from '../api/resources.js'
import { useFocusTrap } from './hooks/useFocusTrap.js'
import { SettingsForm } from './settings/SettingsForm.jsx'
import {
  buildSettingsPayload,
  formFromSettings,
  hasSettingsChanges,
  hfTokenSourceKey,
  settingsErrorText,
  settingsViewOf,
  validateSettingsForm,
} from '../logic/settings.js'

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
  useFocusTrap({ panelRef, initialFocusRef: closeRef, onClose })

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
          {status === 'ready' && form ? (
            <SettingsForm
              t={t}
              view={view}
              form={form}
              patchForm={patchForm}
              validation={validation}
              tokenSource={tokenSource}
              advancedOpen={advancedOpen}
              onToggleAdvanced={() => setAdvancedOpen((value) => !value)}
              saveError={saveError}
              saving={saving}
              canSave={canSave}
              onCancel={() => onCloseRef.current && onCloseRef.current()}
              onSubmit={submit}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
