/**
 * 左侧创作面板（对话式）。
 *
 * 与表单式共用同一份状态：这里的每次发送都会真的提交任务，
 * 助手气泡只汇报任务状态与结果，不额外调用模型（避免和 Agent 会话抢上下文）。
 */

import React from 'react'

import { formatSeconds } from '../logic/format.js'

export function ChatPanel(props) {
  const {
    t,
    form,
    patchForm,
    sending,
    onGenerate,
    messages,
    onReroll,
    onIterate,
    onClearThread,
    hasSelection,
    mode,
    setMode,
    onEnhance,
    enhancing,
    suggestions,
    onApplySuggestion,
  } = props

  const [draft, setDraft] = React.useState('')
  const threadRef = React.useRef(null)

  React.useEffect(() => {
    const node = threadRef.current
    if (node && typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight })
  }, [messages.length])

  function send() {
    const text = draft.trim()
    if (!text) return
    patchForm({ prompt: text })
    setDraft('')
    onGenerate(text)
  }

  return (
    <aside className="ofs-rail ofs-rail--chat">
      <header className="ofs-rail-head">
        <h2>{t('studio.rail.title')}</h2>
        <div className="ofs-mode" role="tablist">
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

      <div className={messages.length === 0 ? "ofs-thread is-empty" : "ofs-thread"} ref={threadRef}>
        {messages.length === 0 ? (
          <div className="ofs-thread-empty">
            <p>{t('studio.chat.empty')}</p>
            <div className="ofs-suggestions">
              {['studio.example.1', 'studio.example.2', 'studio.example.3'].map((key) => (
                <button
                  type="button"
                  key={key}
                  className="ofs-suggestion"
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
              <div className="ofs-msg-head">
                <span className="ofs-msg-avatar" aria-hidden="true">
                  ✧
                </span>
                <span>{t('studio.chat.assistant')}</span>
              </div>
              <p>{message.text}</p>
              {message.image ? (
                <button type="button" className="ofs-msg-thumb" onClick={message.onOpen}>
                  <img src={message.image} alt="" loading="lazy" />
                  <span>{message.meta}</span>
                </button>
              ) : null}
            </div>
          ),
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="ofs-thread-suggestions">
          {suggestions.slice(0, 3).map((entry) => (
            <button
              type="button"
              key={entry.id}
              className="ofs-suggestion"
              onClick={() => onApplySuggestion(entry.text)}
              title={entry.text}
            >
              {entry.text}
            </button>
          ))}
        </div>
      ) : null}

      <div className="ofs-quick">
        <button type="button" className="ofs-chip" onClick={onEnhance} disabled={enhancing}>
          {enhancing ? t('studio.enhance.thinking') : `✨ ${t('studio.enhance.button')}`}
        </button>
        <button type="button" className="ofs-chip" onClick={onReroll}>
          {t('studio.action.reroll')}
        </button>
        <button type="button" className="ofs-chip" onClick={onIterate} disabled={!hasSelection}>
          {t('studio.action.iterate')}
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
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button type="button" className="ofs-chat-send" onClick={send} disabled={sending || draft.trim().length === 0} aria-label={t('studio.generate')}>
          ↑
        </button>
      </div>
    </aside>
  )
}