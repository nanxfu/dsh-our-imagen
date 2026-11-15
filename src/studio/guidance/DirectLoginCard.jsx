/**
 * 直连模式的 Kaggle OAuth 登录指引卡（当 `/state.kaggleTransport === 'direct'` 且遇到 `auth`/`cli` 时渲染）。
 *
 * 状态映射：
 *   idle / cancelled / failed → 主操作「在浏览器中登录 Kaggle」（失败时文案改为重新发起）；
 *   pending（browser）        → 「正在等待浏览器完成授权…」+ 取消；
 *   pending（manual）         → 等待提示 + 可复制的授权链接 + 授权码输入框 + 取消；
 *   done                      → 成功提示（正常会因 probe 刷新成功而自动消失）。
 */

import React from 'react'

import { formatText } from '../../logic/format.js'
import { KAGGLE_CREDENTIAL_PATH } from '../../logic/guidance.js'
import { loginCodeCanSubmit, loginUsernameOf } from '../../logic/kaggleLogin.js'
import { Icon } from '../icons.jsx'

function statusNotesOf({ t, state, pending, manual, login }) {
  if (pending) {
    return manual
      ? [t('studio.guidance.auth.waiting'), t('studio.guidance.auth.waitingManual')]
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
    return [username
      ? formatText(t('studio.guidance.auth.loginDoneWithUser'), { username })
      : t('studio.guidance.auth.loginDone')]
  }
  return []
}

export function DirectLoginCard({ t, login, runProbe, copyText, openLogs, dismiss, detail }) {
  // manual 模式授权码输入框的本地状态；卡片卸载时自然重置。
  const [code, setCode] = React.useState('')

  const view = login.login && typeof login.login === 'object' ? login.login : {}
  const state = typeof view.state === 'string' ? view.state : 'idle'
  const pending = state === 'pending'
  const manual = view.mode === 'manual'
  const url = typeof view.url === 'string' ? view.url : ''
  const title = t('studio.guidance.auth.directTitle')
  const note = formatText(t('studio.guidance.auth.directHint'), { path: KAGGLE_CREDENTIAL_PATH })
  const notes = statusNotesOf({ t, state, pending, manual, login })

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
                placeholder={t('studio.guidance.auth.codePlaceholder')}
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
                : t('studio.guidance.auth.loginAction')}
            </button>
          )}
          <button type="button" className="ofs-chip" onClick={runProbe}>
            {t('studio.guidance.cli.action')}
          </button>
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
