/**
 * 直连 OAuth 登录指引卡与公共交互控件（Kaggle 直连模式 & Google / Colab 共用）。
 *
 * 状态映射：
 *   idle / cancelled / failed → 主操作「在浏览器中登录 …」（失败时文案改为重新发起）；
 *   pending（browser）        → 「正在等待浏览器完成授权…」+ 取消；
 *   pending（manual）         → 等待提示 + 可复制的授权链接 + 授权码输入框 + 取消；
 *   done                      → 成功提示。
 */

import React from 'react'

import { formatText } from '../../logic/format.js'
import { COLAB_CREDENTIAL_PATH, KAGGLE_CREDENTIAL_PATH } from '../../logic/guidance.js'
import { loginCodeCanSubmit, loginUsernameOf } from '../../logic/kaggleLogin.js'
import { Icon } from '../icons.jsx'

function statusNotesOf({ t, state, pending, manual, login, provider }) {
  if (pending) {
    return manual
      ? [
          t('studio.guidance.auth.waiting'),
          t(provider === 'colab' ? 'studio.guidance.auth.colabWaitingManual' : 'studio.guidance.auth.waitingManual'),
        ]
      : [t('studio.guidance.auth.waiting')]
  }
  if (state === 'failed') {
    return [formatText(t('studio.guidance.auth.failed'), {
      reason: login.errorKey ? t(login.errorKey) : t('studio.guidance.auth.reason.unknown'),
    })]
  }
  if (state === 'cancelled') return [t('studio.guidance.auth.cancelled')]
  if (state === 'done') {
    const username = loginUsernameOf(login.login)
    if (provider === 'colab') {
      return [username
        ? formatText(t('studio.guidance.auth.colabDoneWithUser'), { username })
        : t('studio.guidance.auth.colabDone')]
    }
    return [username
      ? formatText(t('studio.guidance.auth.loginDoneWithUser'), { username })
      : t('studio.guidance.auth.loginDone')]
  }
  return []
}

/**
 * 复用的 OAuth 手动粘贴 + 状态提示片段（指引卡与设置抽屉共用）。
 */
export function OAuthManualPanel({ t, login, copyText, provider = 'kaggle' }) {
  const [code, setCode] = React.useState('')
  const view = login && login.login && typeof login.login === 'object' ? login.login : {}
  const state = typeof view.state === 'string' ? view.state : 'idle'
  const pending = state === 'pending'
  const manual = view.mode === 'manual'
  const url = typeof view.url === 'string' ? view.url : ''
  const notes = statusNotesOf({ t, state, pending, manual, login, provider })
  const placeholder = t(
    provider === 'colab' ? 'studio.guidance.auth.colabCodePlaceholder' : 'studio.guidance.auth.codePlaceholder',
  )

  return (
    <>
      {pending && manual && url ? (
        <div className="ofs-guidance-manual">
          <div className="ofs-guidance-url">
            <code className="ofs-guidance-command">{url}</code>
            {typeof copyText === 'function' ? (
              <button
                type="button"
                className="ofs-chip"
                onClick={() => copyText(url, 'studio.guidance.auth.urlCopied')}
              >
                {t('studio.guidance.auth.copyUrl')}
              </button>
            ) : null}
          </div>
          <div className="ofs-guidance-code">
            <input
              className="ofs-settings-input ofs-guidance-code-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={code}
              aria-label={t('studio.guidance.auth.codeLabel')}
              placeholder={placeholder}
              onChange={(event) => setCode(event.target.value)}
            />
            <button
              type="button"
              className="ofs-chip"
              disabled={!loginCodeCanSubmit(code) || Boolean(login.busy)}
              onClick={() => login.submit(code)}
            >
              {t('studio.guidance.auth.codeSubmit')}
            </button>
          </div>
          {login.codeErrorKey ? (
            <p className="ofs-guidance-code-error" role="alert">{t(login.codeErrorKey)}</p>
          ) : null}
        </div>
      ) : null}

      {notes.map((text) => (
        <p key={text} className="ofs-guidance-note">{text}</p>
      ))}
    </>
  )
}

export function DirectLoginCard({ t, login, runProbe, onRetry, copyText, openLogs, dismiss, detail, provider = 'kaggle' }) {
  const view = login.login && typeof login.login === 'object' ? login.login : {}
  const state = typeof view.state === 'string' ? view.state : 'idle'
  const pending = state === 'pending'
  const isColab = provider === 'colab'
  const title = t(isColab ? 'studio.guidance.auth.colabTitle' : 'studio.guidance.auth.directTitle')
  const note = formatText(
    t(isColab ? 'studio.guidance.auth.colabHint' : 'studio.guidance.auth.directHint'),
    { path: isColab ? COLAB_CREDENTIAL_PATH : KAGGLE_CREDENTIAL_PATH },
  )
  const actionLabel = t(isColab ? 'studio.guidance.auth.colabAction' : 'studio.guidance.auth.loginAction')

  function viewLogs(event) {
    if (typeof openLogs !== 'function') return
    openLogs(event && event.currentTarget ? event.currentTarget : null)
  }

  return (
    <div className="ofs-guidance" role="alert">
      <span className="ofs-guidance-icon">
        <Icon name="alert" size={15} />
      </span>
      <div className="ofs-guidance-body">
        <p className="ofs-guidance-title">{title}</p>
        {detail ? <p className="ofs-guidance-detail" title={detail}>{detail}</p> : null}

        <OAuthManualPanel t={t} login={login} copyText={copyText} provider={provider} />
        {!pending ? <p className="ofs-guidance-note">{note}</p> : null}

        <div className="ofs-guidance-actions">
          {pending ? (
            <button
              type="button"
              className="ofs-chip is-on"
              disabled={Boolean(login.busy)}
              onClick={login.cancel}
            >
              {t('studio.guidance.auth.cancel')}
            </button>
          ) : state === 'done' ? null : (
            <button
              type="button"
              className="ofs-chip is-on"
              disabled={Boolean(login.pending)}
              onClick={login.start}
            >
              {state === 'failed'
                ? t('studio.guidance.auth.retry')
                : actionLabel}
            </button>
          )}
          {isColab ? (
            typeof onRetry === 'function' ? (
              <button type="button" className="ofs-chip" onClick={onRetry}>
                {t('studio.guidance.auth.colabRetryWake')}
              </button>
            ) : null
          ) : (
            <button type="button" className="ofs-chip" onClick={runProbe}>
              {t('studio.guidance.cli.action')}
            </button>
          )}
          <button type="button" className="ofs-chip" onClick={viewLogs}>
            {t('studio.guidance.viewLogs')}
          </button>
          {dismiss ? (
            <button
              type="button"
              className="ofs-chip"
              onClick={() => {
                // 收起卡片时若还在等待授权，先取消本次登录，避免后台继续轮询。
                if (pending) login.cancel()
                dismiss()
              }}
            >
              {t('studio.guidance.close')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
