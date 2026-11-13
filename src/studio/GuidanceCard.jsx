/**
 * 异常指引卡：把错误码翻译成一句人话 + 可执行的下一步。
 *
 * - 详情行来自 Host 的 error.message / session.detail / job.error.message；
 * - 每类卡片都有明确的动作：重置参数 / 重新唤醒 / 打开 Kaggle 设置 /
 *   复制安装命令 / 按原参数重试 / 关闭；
 * - 会话、网络、生成、通用、鉴权五类卡片多给两个次级动作（不抢主操作的实心样式）：
 *   「查看日志」打开运行日志抽屉，「复制诊断信息」现场拉 /state 与 /logs 后拼纯文本，
 *   远端日志拉取失败也照样给出状态段；
 * - 「关闭」只是本地收起，不改变 Host 状态。
 *
 * 接收 { t, guidance, compute, actions, ui } 领域对象。
 */

import React from 'react'

import { VERSION } from '../../shared/contract.js'

import { Icon } from './icons.jsx'
import { fetchLogs, fetchState } from '../api/resources.js'
import {
  KAGGLE_ACCOUNT_URL,
  KAGGLE_CREDENTIAL_PATH,
  KAGGLE_INSTALL_COMMAND,
  KAGGLE_SETTINGS_URL,
} from '../logic/guidance.js'
import { formatText } from '../logic/format.js'
import { buildDiagnostics, readLogsPayload } from '../logic/logs.js'

/** 带「查看日志 / 复制诊断信息」次级动作的报错类别。 */
const SECONDARY_KINDS = new Set(['session', 'network', 'generate', 'generic', 'auth', 'gpu'])

/** 请求包装：网络层抛错时返回 null，调用方用空快照继续拼诊断文本。 */
async function safeCall(request) {
  try {
    return await request()
  } catch {
    return null
  }
}

/** /state 响应 → 快照对象；失败或形状不对时返回空对象。 */
function snapshotOf(result) {
  return result && result.ok === true && result.data && typeof result.data === 'object' ? result.data : {}
}

export function GuidanceCard(props) {
  const { t, guidance, compute, actions, ui } = props
  const { kind, detail, dismiss } = guidance
  const { resetToSafe, retryFocusedJob } = actions
  const { startSession, runProbe, retryHost } = compute
  const { copyInstallCommand, copyText, openLogs } = ui
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
    closed: {
      title: t('studio.guidance.closed.title'),
      actions: [{ key: 'wake', label: t('studio.guidance.sleep.action'), run: startSession }],
    },
    // 连不上本地服务：宿主轮询会自动重试，这里给一个「重试」让用户能立刻拉一次状态。
    network: {
      title: t('studio.guidance.network.title'),
      actions: [{ key: 'retry', label: t('studio.guidance.network.action'), run: retryHost }],
    },
    auth: {
      title: t('studio.guidance.auth.title'),
      note: formatText(t('studio.guidance.auth.credentialHint'), { path: KAGGLE_CREDENTIAL_PATH }),
      actions: [
        { key: 'settings', label: t('studio.guidance.auth.action'), href: KAGGLE_SETTINGS_URL },
        { key: 'recheck', label: t('studio.guidance.cli.action'), run: runProbe },
      ],
    },
    cli: {
      title: t('studio.guidance.cli.title'),
      command: KAGGLE_INSTALL_COMMAND,
      note: t('studio.guidance.cli.pathHint'),
      actions: [
        { key: 'copy', label: t('studio.guidance.cli.copy'), run: copyInstallCommand },
        { key: 'recheck', label: t('studio.guidance.cli.action'), run: runProbe },
      ],
    },
    // 远端容器没拿到 GPU：重试或唤醒都救不了，先让用户去 Kaggle 账户设置开启 GPU。
    gpu: {
      title: t('studio.guidance.gpu.title'),
      note: t('studio.guidance.gpu.hint'),
      actions: [
        { key: 'settings', label: t('studio.guidance.gpu.action'), href: KAGGLE_ACCOUNT_URL },
        { key: 'wake', label: t('studio.guidance.sleep.action'), run: startSession },
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
  const hasSecondary = SECONDARY_KINDS.has(kind)

  /** 查看日志：交给组合层的 openLogs，稍后关闭时焦点会送回触发元素。 */
  function viewLogs(event) {
    if (typeof openLogs !== 'function') return
    openLogs(event && event.currentTarget ? event.currentTarget : null)
  }

  /**
   * 复制诊断信息：现场拉一次 /state 与 /logs（各一次，不轮询）。
   * 两者都失败时仍用 compute 回退与空日志段拼出可用文本，保证离线也能贴 Issue。
   */
  async function copyDiagnostics() {
    const [stateResult, logsResult] = await Promise.all([
      safeCall(fetchState),
      safeCall(() => fetchLogs(0)),
    ])
    const context = snapshotOf(stateResult)
    const payload = readLogsPayload(logsResult)
    const fallbackSession = compute && compute.session ? compute.session : null
    const fallbackProbe = compute && compute.probe ? compute.probe : null
    const text = buildDiagnostics(t, {
      version: context.version || VERSION,
      session: context.session || fallbackSession,
      probe: context.probe || fallbackProbe,
      probeLastGood: context.probeLastGood,
      probeLastGoodAt: context.probeLastGoodAt,
      queue: context.queue,
      lastJob: context.lastJob,
      lines: payload.lines,
      hostLogs: payload.hostLines,
      env: payload.env,
      now: Date.now(),
    })
    if (typeof copyText === 'function') copyText(text, 'studio.logs.copied')
  }

  return (
    <div className="ofs-guidance" role="alert">
      <span className="ofs-guidance-icon">
        <Icon name="alert" size={15} />
      </span>
      <div className="ofs-guidance-body">
        <p className="ofs-guidance-title">{card.title}</p>
        {card.command ? <code className="ofs-guidance-command">{card.command}</code> : null}
        {detail ? <p className="ofs-guidance-detail" title={detail}>{detail}</p> : null}
        {card.note ? <p className="ofs-guidance-note">{card.note}</p> : null}
        <div className="ofs-guidance-actions">
          {actionList.map((action, index) => (action.href ? (
            <a
              key={action.key}
              className={`ofs-chip${index === 0 ? ' is-on' : ''}`}
              href={action.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {action.label}
            </a>
          ) : (
            <button
              key={action.key}
              type="button"
              className={`ofs-chip${index === 0 ? ' is-on' : ''}`}
              onClick={action.run}
            >
              {action.label}
            </button>
          )))}
          {hasSecondary ? (
            <button type="button" className="ofs-chip" onClick={viewLogs}>
              {t('studio.guidance.viewLogs')}
            </button>
          ) : null}
          {hasSecondary ? (
            <button type="button" className="ofs-chip" onClick={copyDiagnostics}>
              {t('studio.guidance.copyDiag')}
            </button>
          ) : null}
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
