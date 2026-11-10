/**
 * 左侧创作面板（对话式）。
 *
 * 与表单式共用同一张玻璃卡：外框、头部与分段控件来自 panel.css，
 * 这里只负责卡片内部的消息流、空态与底部悬浮输入区。
 *
 * 这里的每次发送都会真的提交任务，助手消息只汇报任务状态与结果，
 * 不额外调用模型（避免和 Agent 会话抢上下文）。助手消息不用头像和
 * 气泡尾巴——它是这条流水线在说话，不是另一个人。
 */

import React from 'react'

import { Icon } from './icons.jsx'

const EXAMPLES = ['studio.example.1', 'studio.example.2', 'studio.example.3']

// 助手消息左上角的状态点：完成是静默的绿点，排队/渲染是呼吸的琥珀点，失败是红点。
const WORKING_STAGES = ['pending', 'queued', 'running']

function isWorking(stage) {
  return WORKING_STAGES.indexOf(stage) >= 0
}

function dotClass(stage) {
  if (stage === 'failed') return 'ofs-dot ofs-chat-dot is-error'
  if (isWorking(stage)) return 'ofs-dot ofs-chat-dot is-warn is-live'
  return 'ofs-dot ofs-chat-dot is-ok'
}

export function ChatPanel(props) {
  const {
    t,
    form,
    patchForm,
    sending,
    onGenerate,
    messages,
    onClearThread,
    mode,
    setMode,
    onEnhance,
    enhancing,
    suggestions,
    onApplySuggestion,
    onOpenMessage,
  } = props

  const [draft, setDraft] = React.useState('')
  const threadRef = React.useRef(null)
  const lastStage = messages.length > 0 ? messages[messages.length - 1].stage : ''

  // 新消息与状态更新都把线程滚到底部；空态时不动。
  React.useEffect(() => {
    const node = threadRef.current
    if (node && typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight })
  }, [messages.length, lastStage])

  function send() {
    const text = draft.trim()
    if (!text) return
    patchForm({ prompt: text })
    setDraft('')
    onGenerate(text)
  }

  function openMessage(message) {
    if (typeof message.onOpen === 'function') message.onOpen()
    else if (typeof onOpenMessage === 'function' && message.imagePath) onOpenMessage(message.imagePath)
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
        className={messages.length === 0 ? 'ofs-thread is-empty' : 'ofs-thread'}
        ref={threadRef}
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
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
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <div className="ofs-msg ofs-msg--user" key={message.id}>
              <p>{message.text}</p>
            </div>
          ) : (
            <div className="ofs-msg ofs-msg--assistant" key={message.id}>
              <div className="ofs-chat-author">
                <span className={dotClass(message.stage)} aria-hidden="true" />
                <span className="ofs-chat-author-name">{t('studio.chat.assistant')}</span>
              </div>
              <div className={isWorking(message.stage) ? 'ofs-msg-card is-working' : 'ofs-msg-card'}>
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
            </div>
          ),
        )}
      </div>

      {/* 抽卡与微调在主舞台已经有入口，这里只留这个面板自己的动作，避免同屏重复 */}
      <div className="ofs-chat-dock">
        {suggestions.length > 0 ? (
          <div className="ofs-chat-suggest">
            {suggestions.slice(0, 3).map((entry) => (
              <button
                type="button"
                key={entry.id}
                className="ofs-chip ofs-chat-suggest-chip"
                onClick={() => onApplySuggestion(entry.text)}
                title={entry.text}
              >
                {entry.text}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ofs-chat-tools">
          <button type="button" className="ofs-chip" onClick={onEnhance} disabled={enhancing}>
            <Icon name="expandText" size={13} />
            {enhancing ? t('studio.enhance.thinking') : t('studio.enhance.button')}
          </button>
          <button type="button" className="ofs-chip" onClick={onClearThread} disabled={messages.length === 0}>
            {t('studio.chat.clear')}
          </button>
        </div>

        <div className="ofs-chat-composer">
          <textarea
            rows={2}
            value={draft}
            maxLength={2000}
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
            disabled={sending || draft.trim().length === 0}
            aria-label={t('studio.generate')}
            title={t('studio.generate')}
          >
            <Icon name="arrowUp" size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}