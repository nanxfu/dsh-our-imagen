/**
 * 异常指引卡：把错误码翻译成一句人话 + 一个可点的动作。
 *
 * 规格里的三类重点异常（显存不足 / 云端休眠 / 手机验证）在这里有专门文案，
 * 其余错误回落到通用指引。
 */

import React from 'react'

import { Icon } from './icons.jsx'

const KAGGLE_SETTINGS = 'https://www.kaggle.com/settings'

/** 错误码 → 指引标识。 */
export function guidanceKindOf(code) {
  if (!code) return ''
  if (code === 'oom') return 'oom'
  if (code === 'session_ended' || code === 'stopped') return 'sleep'
  if (code === 'auth_required' || code === 'cli_missing') return 'auth'
  if (code === 'need_prompt') return ''
  return 'generic'
}

export function GuidanceCard(props) {
  const { t, kind, onReset, onWake, onRecheck, onRetry } = props
  if (!kind) return null

  const presets = {
    oom: { title: t('studio.guidance.oom.title'), action: t('studio.guidance.oom.action'), run: onReset },
    sleep: { title: t('studio.guidance.sleep.title'), action: t('studio.guidance.sleep.action'), run: onWake },
    auth: { title: t('studio.guidance.auth.title'), action: t('studio.guidance.auth.action'), href: KAGGLE_SETTINGS },
    generic: { title: t('studio.guidance.generic.title'), action: t('studio.guidance.generic.action'), run: onRetry },
  }
  const preset = presets[kind] ?? presets.generic
  const secondary = kind === 'auth' ? t('studio.guidance.cli.action') : ''

  return (
    <div className="ofs-guidance" role="alert">
      <span className="ofs-guidance-icon">
        <Icon name="alert" size={15} />
      </span>
      <div className="ofs-guidance-body">
        <p className="ofs-guidance-title">{preset.title}</p>
        <div className="ofs-guidance-actions">
          {preset.href ? (
            <a className="ofs-chip is-on" href={preset.href} target="_blank" rel="noreferrer noopener">
              {preset.action}
            </a>
          ) : (
            <button type="button" className="ofs-chip is-on" onClick={preset.run}>
              {preset.action}
            </button>
          )}
          {secondary && onRecheck ? (
            <button type="button" className="ofs-chip" onClick={onRecheck}>
              {secondary}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}