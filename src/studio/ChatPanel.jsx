/**
 * 创作助手（对话式面板）。
 *
 * 用户用一句话描述想画什么，宿主模型把它整理成生成参数，面板给出确认卡：
 * 提示词、比例、风格与「按此生成」。参数互相矛盾时先给澄清卡，不让用户重打一遍。
 * 这里的助手不扮演聊天对象：每条气泡要么是参数确认，要么是任务状态与结果。
 *
 * 外框、头部与分段控件来自 panel.css，消息流与确认卡样式在 chat.css。
 */

import React from 'react'

import { LIMITS } from '../../shared/contract.js'

import { Icon } from './icons.jsx'
import { STYLE_CAPSULES } from './capsules.js'

const EXAMPLES = ['studio.inspire.1', 'studio.inspire.2', 'studio.inspire.3', 'studio.inspire.4', 'studio.inspire.5']

// 任务型气泡左上角的状态点：完成绿点，排队/生成是呼吸琥珀点，失败红点。
const WORKING_STAGES = ['pending', 'queued', 'running']

function isWorking(stage) {
  return WORKING_STAGES.indexOf(stage) >= 0
}

function dotClass(stage) {
  if (stage === 'failed') return 'ofs-dot ofs-chat-dot is-error'
  if (isWorking(stage)) return 'ofs-dot ofs-chat-dot is-warn is-live'
  return 'ofs-dot ofs-chat-dot is-ok'
}

function styleLabel(t, styleId) {
  const capsule = STYLE_CAPSULES.find((item) => item.id === styleId)
  return capsule ? t(capsule.labelKey) : t('studio.chat.styleAuto')
}

function ratioLabel(t, ratioId) {
  return ratioId || t('studio.chat.ratioAuto')
}

export function ChatPanel(props) {
  const {
    t,
    patchForm,
    sending,
    messages,
    interpreting,
    onSend,
    onGenerateIntent,
    onResolveClarify,
    onClearThread,
    onOpenMessage,
    mode,
    setMode,
  } = props

  const [draft, setDraft] = React.useState('')
  const threadRef = React.useRef(null)
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const lastStage = (lastMessage && lastMessage.stage) || ''

  // 新消息、状态更新与解析中都把线程滚到底部。
  React.useEffect(() => {
    const node = threadRef.current
    if (node && typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight })
  }, [messages.length, lastStage, interpreting])

  function send() {
    const text = draft.trim()
    if (!text || sending || interpreting) return
    setDraft('')
    onSend(text)
  }

  function openMessage(message) {
    if (typeof message.onOpen === 'function') message.onOpen()
    else if (typeof onOpenMessage === 'function' && message.imagePath) onOpenMessage(message.imagePath)
  }

  function renderIntent(message) {
    const clarify = message.clarify
    if (clarify) {
      const isRatio = clarify.field === 'ratio'
      return (
        <div className="ofs-msg-card ofs-intent" key={message.id}>
          <span className="ofs-intent-title">{t('studio.chat.clarify.title')}</span>
          <p className="ofs-intent-question">
            {isRatio ? t('studio.chat.clarify.ratio') : t('studio.chat.clarify.style')}
          </p>
          <div className="ofs-suggestions">
            {clarify.options.map((option) => (
              <button
                type="button"
                key={option}
                className="ofs-suggestion"
                onClick={() => onResolveClarify(message.id, clarify.field, option)}
              >
                {isRatio ? option : styleLabel(t, option)}
              </button>
            ))}
            <button type="button" className="ofs-suggestion" onClick={() => onResolveClarify(message.id, clarify.field, '')}>
              {t('studio.chat.clarify.auto')}
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="ofs-msg-card ofs-intent" key={message.id}>
        <span className="ofs-intent-title">{t('studio.chat.intent.title')}</span>
        <p className="ofs-intent-prompt">{message.prompt}</p>
        <div className="ofs-intent-meta">
          <span>{ratioLabel(t, message.ratioId)}</span>
          <span aria-hidden="true">·</span>
          <span>{styleLabel(t, message.styleId)}</span>
        </div>
        {message.source === 'local' ? <p className="ofs-intent-note">{t('studio.chat.intent.local')}</p> : null}
        <button
          type="button"
          className="ofs-btn is-primary ofs-intent-go"
          onClick={() => onGenerateIntent(message)}
          disabled={sending}
        >
          {sending ? t('studio.generating') : t('studio.chat.intent.generate')}
        </button>
      </div>
    )
  }

  function renderAssistant(message) {
    if (message.kind === 'intent') return renderIntent(message)
    if (message.kind === 'error') {
      return (
        <div className="ofs-msg-card" key={message.id}>
          <p>{message.text}</p>
        </div>
      )
    }
    return (
      <div className="ofs-msg-card" key={message.id}>
        <p>{message.text}</p>
        {isWorking(message.stage) ? <span className="ofs-chat-shimmer" aria-hidden="true" /> : null}
        {message.image ? (
          <button
            type="button"
            className="ofs-msg-thumb"
            onClick={() => openMessage(message)}
            title={message.meta || undefined}
          >
            <img src={message.image} alt="" loading="lazy" />
            {message.meta ? <span className="ofs-msg-thumb-meta">{message.meta}</span> : null}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <aside className="ofs-panel ofs-panel--chat">
      <header className="ofs-panel-head">
        <h2>{t('studio.rail.title')}</h2>
        <div className="ofs-seg" role="tablist" aria-label={t('studio.rail.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'form'}
            className={mode === 'form' ? 'is-on' : ''}
            onClick={() => setMode('form')}
          >
            {t('studio.rail.modeForm')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chat'}
            className={mode === 'chat' ? 'is-on' : ''}
            onClick={() => setMode('chat')}
          >
            {t('studio.rail.modeChat')}
          </button>
        </div>
      </header>

      <div
        className={messages.length === 0 && !interpreting ? 'ofs-thread is-empty' : 'ofs-thread'}
        ref={threadRef}
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 && !interpreting ? (
          <div className="ofs-chat-empty">
            <p className="ofs-chat-empty-text">{t('studio.chat.empty')}</p>
            <div className="ofs-chat-examples">
              {EXAMPLES.map((key) => (
                <button
                  type="button"
                  key={key}
                  className="ofs-chip ofs-chat-example"
                  onClick={() => {
                    patchForm({ prompt: t(key) })
                    setDraft(t(key))
                  }}
                  title={t(key)}
                >
                  {t(`${key}.label`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          message.role === 'user' ? (
            <div className="ofs-msg ofs-msg--user" key={message.id}>
              <p>{message.text}</p>
            </div>
          ) : (
            <div className="ofs-msg ofs-msg--assistant" key={message.id}>
              {message.kind === 'intent' || message.kind === 'error' ? null : (
                <div className="ofs-chat-author">
                  <span className={dotClass(message.stage)} aria-hidden="true" />
                  <span className="ofs-chat-author-name">{t('studio.chat.assistant')}</span>
                </div>
              )}
              {renderAssistant(message)}
            </div>
          )
        ))}

        {interpreting ? (
          <div className="ofs-msg ofs-msg--assistant">
            <div className="ofs-msg-card is-working">
              <p>{t('studio.chat.parsing')}</p>
              <span className="ofs-chat-shimmer" aria-hidden="true" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="ofs-chat-dock">
        <div className="ofs-chat-tools">
          <button type="button" className="ofs-chip" onClick={onClearThread} disabled={messages.length === 0}>
            {t('studio.chat.clear')}
          </button>
        </div>

        <div className="ofs-chat-composer">
          <textarea
            rows={2}
            value={draft}
            maxLength={LIMITS.prompt.maxChars}
            placeholder={t('studio.chat.placeholder')}
            aria-label={t('studio.chat.placeholder')}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              // 中文输入法确认候选词时的回车不算发送。
              if (event.nativeEvent && event.nativeEvent.isComposing) return
              event.preventDefault()
              send()
            }}
          />
          <button
            type="button"
            className="ofs-chat-send"
            onClick={send}
            disabled={sending || interpreting || draft.trim().length === 0}
            aria-label={t('studio.chat.send')}
            title={t('studio.chat.send')}
          >
            <Icon name="arrowUp" size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}