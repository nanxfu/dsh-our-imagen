/**
 * 异常指引卡：把错误码翻译成一句人话 + 可执行的下一步。
 *
 * - 详情行来自 Host 的 error.message / session.detail / job.error.message；
 * - 每类卡片都有明确的动作：重置参数 / 重新唤醒 / 打开 Kaggle 设置 /
 *   复制安装命令 / 按原参数重试 / 关闭；
 * - 「关闭」只是本地收起，不改变 Host 状态。
 *
 * 接收 { t, guidance, compute, actions, ui } 领域对象。
 */

import React from 'react'

import { Icon } from './icons.jsx'
import {
  KAGGLE_INSTALL_COMMAND,
  KAGGLE_SETTINGS_URL,
} from '../logic/guidance.js'

export function GuidanceCard(props) {
  const { t, guidance, compute, actions, ui } = props
  const { kind, detail, dismiss } = guidance
  const { resetToSafe, retryFocusedJob } = actions
  const { startSession, runProbe } = compute
  const { copyInstallCommand } = ui
  if (!kind) return null

  const cards = {
    oom: {
      title: t('studio.guidance.oom.title'),
      actions: [{ key: 'reset', label: t('studio.guidance.oom.action'), run: resetToSafe }],
    },
    sleep: {
      title: t('studio.guidance.sleep.title'),
      actions: [{ key: 'wake', label: t('studio.guidance.sleep.action'), run: startSession }],
    },
    auth: {
      title: t('studio.guidance.auth.title'),
      actions: [
        { key: 'settings', label: t('studio.guidance.auth.action'), href: KAGGLE_SETTINGS_URL },
        { key: 'recheck', label: t('studio.guidance.cli.action'), run: runProbe },
      ],
    },
    cli: {
      title: t('studio.guidance.cli.title'),
      command: KAGGLE_INSTALL_COMMAND,
      actions: [
        { key: 'copy', label: t('studio.guidance.cli.copy'), run: copyInstallCommand },
        { key: 'recheck', label: t('studio.guidance.cli.action'), run: runProbe },
      ],
    },
    session: {
      title: t('studio.guidance.session.title'),
      actions: [{ key: 'wake', label: t('studio.guidance.sleep.action'), run: startSession }],
    },
    generate: {
      title: t('studio.guidance.generic.title'),
      actions: [{ key: 'retry', label: t('studio.guidance.generic.action'), run: retryFocusedJob }],
    },
    generic: {
      title: t('studio.guidance.other.title'),
      actions: [],
    },
  }
  const card = cards[kind] || cards.generic
  const actionList = card.actions.filter((action) => (action.href ? true : typeof action.run === 'function'))

  return (
    <div className="ofs-guidance" role="alert">
      <span className="ofs-guidance-icon">
        <Icon name="alert" size={15} />
      </span>
      <div className="ofs-guidance-body">
        <p className="ofs-guidance-title">{card.title}</p>
        {card.command ? <code className="ofs-guidance-command">{card.command}</code> : null}
        {detail ? <p className="ofs-guidance-detail" title={detail}>{detail}</p> : null}
        <div className="ofs-guidance-actions">
          {actionList.map((action) => (action.href ? (
            <a
              key={action.key}
              className="ofs-chip is-on"
              href={action.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {action.label}
            </a>
          ) : (
            <button key={action.key} type="button" className="ofs-chip is-on" onClick={action.run}>
              {action.label}
            </button>
          )))}
          {dismiss ? (
            <button type="button" className="ofs-chip" onClick={dismiss}>
              {t('studio.guidance.close')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}