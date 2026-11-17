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
 * 直连模式（`/state.kaggleTransport === 'direct'`）：
 *   `cli_missing` 与 `auth_required` 两类卡片合并成一张「登录 Kaggle」卡——直连不依赖本机
 *   kaggle CLI，主操作改为发起内置 OAuth 登录；进行中显示等待提示与取消，manual 模式给出
 *   可复制的授权链接与授权码输入框；失败/取消都回到可重新发起。CLI 模式行为保持不变。
 *
 * 排队超时（`queue_timeout`，45 分钟硬超时）已收敛为单一动作：主按钮「换新实例重排」
 * （forceNew + replace，Host 删除排不上的旧 Kernel 后重新推送），次级只留「查看日志」
 * 与「关闭」。旧版的「继续等待当前队列」「打开 Kaggle Kernel」已删除——继续等待说明
 * 这条排队确实卡住了，去 Kaggle 网页也不会自己变好。
 *
 * 接收 { t, guidance, compute, actions, ui } 领域对象。
 */

import React from 'react'

import { VERSION } from '../../shared/contract.js'

import { Icon } from './icons.jsx'
import { fetchLogs, fetchState } from '../api/resources.js'
import {
  KAGGLE_ACCESS_TOKEN_PATH,
  KAGGLE_ACCOUNT_URL,
  KAGGLE_CREDENTIAL_PATH,
  KAGGLE_INSTALL_COMMAND,
  KAGGLE_LEGACY_CREDENTIAL_PATH,
  KAGGLE_LOGIN_COMMAND,
  KAGGLE_SETTINGS_URL,
} from '../logic/guidance.js'
import { formatText } from '../logic/format.js'
import { buildDiagnostics, readLogsPayload } from '../logic/logs.js'
import { guidanceToneOf } from '../logic/guidance.js'
import { DirectLoginCard } from './guidance/DirectLoginCard.jsx'

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
  const { kind, code: errorCode, detail, dismiss } = guidance
  const { resetToSafe, retryFocusedJob } = actions
  const { startSession, requeueSession, runProbe, retryHost } = compute
  const { copyInstallCommand, copyText, openLogs } = ui
  // 直连模式的登录会话由组合层的 useKaggleLogin / useColabLogin 管理，卡片只负责展示与转发动作。
  const directMode = compute && compute.kaggleTransport === 'direct'
  const login = compute && compute.kaggleLogin ? compute.kaggleLogin : null
  const colabProvider = compute && ((compute.session && compute.session.provider === 'colab') || compute.provider === 'colab')
  const colabLogin = compute && compute.colabLogin ? compute.colabLogin : null
  const isQueueTimeout = kind === 'session' && errorCode === 'queue_timeout'
  if (!kind) return null
  if (colabProvider && colabLogin && kind === 'auth') {
    return (
      <DirectLoginCard
        t={t}
        provider="colab"
        login={colabLogin}
        onRetry={startSession}
        copyText={copyText}
        openLogs={openLogs}
        dismiss={dismiss}
        detail={detail}
      />
    )
  }
  if (directMode && login && (kind === 'auth' || kind === 'cli')) {
    return (
      <DirectLoginCard
        t={t}
        login={login}
        runProbe={runProbe}
        copyText={copyText}
        openLogs={openLogs}
        dismiss={dismiss}
        detail={detail}
      />
    )
  }

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
      // 新版 CLI 一条命令就完成 OAuth 授权，比让用户手动改文件少两步；
      // 凭据位置与网页 Token / 旧版 kaggle.json 的兼容口径都由常量提供。
      command: KAGGLE_LOGIN_COMMAND,
      note: formatText(t('studio.guidance.auth.credentialHint'), {
        path: KAGGLE_CREDENTIAL_PATH,
        token: KAGGLE_ACCESS_TOKEN_PATH,
        legacy: KAGGLE_LEGACY_CREDENTIAL_PATH,
      }),
      actions: [
        { key: 'settings', label: t('studio.guidance.auth.action'), href: KAGGLE_SETTINGS_URL },
        {
          key: 'copyLogin',
          label: t('studio.guidance.auth.copyLogin'),
          run:
            typeof copyText === 'function'
              ? () => copyText(KAGGLE_LOGIN_COMMAND, 'studio.guidance.auth.copied')
              : undefined,
        },
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
    session: isQueueTimeout
      ? {
          title: t('studio.guidance.session.title'),
          note: t('studio.guidance.queueTimeout.hint'),
          // 45 分钟硬超时后排队已确定卡住：只给「换新实例重排」一个主操作。
          actions: [
            { key: 'requeue', label: t('studio.guidance.queueTimeout.requeue'), run: requeueSession },
          ],
        }
      : {
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
  // 排队超时的次级动作只留「查看日志」与「关闭」：复制诊断信息在硬超时场景没有信息增量。
  const canCopyDiagnostics = hasSecondary && !isQueueTimeout

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
    <div className={guidanceToneOf(kind) === 'error' ? 'ofs-guidance is-error' : 'ofs-guidance'} role="alert">
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
          {canCopyDiagnostics ? (
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
