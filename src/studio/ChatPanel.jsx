/**
 * 创作助手（对话式面板）。
 *
 * 用户用一句话描述想画什么，宿主模型把它整理成生成参数，面板给出确认卡：
 * 中文摘要优先、英文提示词可编辑、张数可选，可以「按此生成」或「带入参数面板」。
 * 信息不足时先给通用澄清卡（问题 + 选项），不让用户重打一遍。
 * 气泡只有两类：参数确认 / 澄清与任务状态、结果。
 *
 * 外框、头部与分段控件来自 panel.css，消息流与确认卡样式在 chat.css。
 * 接收 { t, ui, form, chat, library, actions } 领域对象。
 */

import React from 'react'

import { LIMITS, PRESETS } from '../../shared/contract.js'

import { formatText } from '../logic/format.js'
import { intentCount } from '../logic/intent.js'
import { Icon } from './icons.jsx'

const EXAMPLES = ['studio.inspire.1', 'studio.inspire.2', 'studio.inspire.3', 'studio.inspire.4', 'studio.inspire.5']

// 生成张数固定 1~4 四格；默认 1 张，和契约 LIMITS.count 一致。
const COUNT_OPTIONS = [1, 2, 3, 4]

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

function ratioLabel(t, ratioId) {
  return ratioId || t('studio.chat.ratioAuto')
}

/** 模型建议里展示的模型名；未知 id 返回空串（整行不渲染）。 */
function modelLabelOf(presetId) {
  const preset = PRESETS.find((item) => item && item.id === presetId)
  return preset ? (preset.label || preset.short || preset.id) : ''
}

export function ChatPanel(props) {
  const { t, ui, form, chat, library, actions } = props
  const { panelMode: mode, setPanelMode: setMode } = ui
  const {
    messages,
    interpreting,
    interpret,
    updateIntentField,
    generateIntent,
    handoffIntent,
    toggleIntentLockSeed,
    canLockSeed,
    resolveClarify,
    clearThread,
  } = chat
  const { openMessage: openImage } = library
  const { sending } = actions
  // 排除项只在该模型/CFG 真正消费负向词时出现；旧宿主缺这个字段时按「不显示」处理。
  const negativeActive = Boolean(form && form.negativeActive === true)

  const [draft, setDraft] = React.useState('')
  const threadRef = React.useRef(null)
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const lastStage = (lastMessage && lastMessage.stage) || ''

  // 新消息、状态更新与解析中都把线程滚到底部。
  React.useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTo({ top: node.scrollHeight })
  }, [messages.length, lastStage, interpreting])

  function send() {
    const text = draft.trim()
    if (!text || sending || interpreting) return
    setDraft('')
    interpret(text)
  }

  function openMessage(message) {
    if (message.onOpen) message.onOpen()
    else if (message.imagePath) openImage(message.imagePath)
  }

  /** 带入参数面板：写表单 → 切回表单模式 → 轻提示；失败时不切换。 */
  function handoff(message) {
    if (typeof handoffIntent !== 'function') return
    if (!handoffIntent(message)) return
    if (typeof setMode === 'function') setMode('form')
    if (ui && typeof ui.showToast === 'function') ui.showToast(t('studio.chat.intent.handoffDone'))
  }

  /** 通用澄清卡：问题 + 2~4 个选项 + 「先按当前设置」。 */
  function renderClarify(message) {
    const clarify = message.clarify
    const question = clarify && typeof clarify.question === 'string' ? clarify.question : ''
    const options = clarify && Array.isArray(clarify.options) ? clarify.options : []
    return (
      <div className="ofs-msg-card ofs-intent ofs-intent-clarify" key={message.id}>
        <span className="ofs-intent-title">{t('studio.chat.clarify.title')}</span>
        {question ? <p className="ofs-intent-question">{question}</p> : null}
        <div className="ofs-suggestions">
          {options.map((option) => (
            <button
              type="button"
              key={option}
              className="ofs-suggestion"
              onClick={() => resolveClarify(message.id, option)}
            >
              {option}
            </button>
          ))}
          <button type="button" className="ofs-suggestion" onClick={() => resolveClarify(message.id, '')}>
            {t('studio.chat.clarify.auto')}
          </button>
        </div>
      </div>
    )
  }

  function renderIntent(message) {
    if (message.clarify) return renderClarify(message)

    // 预览 / 测试可能只给部分 chat 域，缺编辑动作时文本域退化为只读展示。
    const editField = typeof updateIntentField === 'function' ? updateIntentField : () => {}
    const promptValue = typeof message.prompt === 'string' ? message.prompt : ''
    const negativeValue = typeof message.negative === 'string' ? message.negative : ''
    const canGenerate = promptValue.trim().length > 0
    const summary = typeof message.summary === 'string' ? message.summary.trim() : ''
    const showSummary = summary.length > 0 && summary !== promptValue.trim()
    const count = intentCount(message.count)
    const hint = message.modelHint && typeof message.modelHint === 'object' ? message.modelHint : null
    const hintModel = hint ? modelLabelOf(hint.presetId) : ''
    const hintText = hint && hintModel && typeof hint.reason === 'string'
      ? formatText(t('studio.chat.intent.modelHint'), { model: hintModel, reason: hint.reason })
      : ''

    return (
      <div className="ofs-msg-card ofs-intent" key={message.id}>
        <span className="ofs-intent-title">{t('studio.chat.intent.title')}</span>
        {/* 中文摘要优先：先让用户确认画面对不对，再看真正发给模型的英文提示词。 */}
        {showSummary ? (
          <p className="ofs-intent-summary">
            <span className="ofs-intent-summary-label">{t('studio.chat.intent.summary')}</span>
            {summary}
          </p>
        ) : null}
        <p className="ofs-intent-edit-hint">{t('studio.chat.intent.editHint')}</p>
        {/* 英文提示词是真正发给模型的内容：直接在卡上改，不必为几个词重新对话。 */}
        <label className="ofs-intent-field">
          <span className="ofs-intent-field-label">{t('studio.chat.intent.promptLabel')}</span>
          <textarea
            className="ofs-intent-prompt"
            rows={2}
            value={promptValue}
            maxLength={LIMITS.prompt.maxChars}
            spellCheck={false}
            aria-label={t('studio.chat.intent.promptLabel')}
            onChange={(event) => editField(message.id, 'prompt', event.target.value)}
          />
        </label>
        {/* 比例来自当前设置或本次解析结果；0.10.0 起不再有风格行。 */}
        <div className="ofs-intent-meta">
          <span>{t('studio.rail.ratio')}</span>
          <span>{ratioLabel(t, message.ratioId)}</span>
        </div>
        {/* 模型建议是弱提示：只说明「换哪个更合适」，不拦着用户按当前模型生成。 */}
        {hintText ? <p className="ofs-intent-model-hint">{hintText}</p> : null}
        {/* 排除项只在该模型/CFG 真正消费负向词时出现；在卡上清空后提交就不带负向词。 */}
        {negativeActive ? (
          <label className="ofs-intent-field">
            <span className="ofs-intent-field-label">{t('studio.chat.intent.negativeLabel')}</span>
            <textarea
              className="ofs-intent-negative"
              rows={2}
              value={negativeValue}
              maxLength={LIMITS.negativePrompt.maxChars}
              placeholder={t('studio.chat.intent.negativePlaceholder')}
              spellCheck={false}
              aria-label={t('studio.chat.intent.negativeLabel')}
              onChange={(event) => editField(message.id, 'negative', event.target.value)}
            />
          </label>
        ) : null}
        {/* 生成张数：四格分段，默认 1 张；值写回消息，提交时进入覆盖项。 */}
        <div className="ofs-intent-qty-row">
          <span className="ofs-intent-qty-label">{t('studio.countShort')}</span>
          <div className="ofs-intent-qty" role="group" aria-label={t('studio.count')}>
            {COUNT_OPTIONS.map((option) => (
              <button
                type="button"
                key={option}
                className={option === count ? 'ofs-intent-qty-option is-on' : 'ofs-intent-qty-option'}
                aria-pressed={option === count}
                onClick={() => editField(message.id, 'count', option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        {message.source === 'local' ? <p className="ofs-intent-note">{t('studio.chat.intent.local')}</p> : null}
        {/* 种子默认随机；想对比同一构图时才显式打开，避免跨主题对话被上一张的构图绑住。 */}
        <label className={canLockSeed === false ? 'ofs-intent-lock is-disabled' : 'ofs-intent-lock'}>
          <input
            type="checkbox"
            checked={message.lockSeed === true}
            disabled={canLockSeed === false}
            onChange={() => toggleIntentLockSeed(message.id)}
          />
          <span>{t('studio.chat.intent.lockSeed')}</span>
        </label>
        <div className="ofs-intent-actions">
          <button
            type="button"
            className="ofs-btn is-primary ofs-intent-go"
            onClick={() => generateIntent(message)}
            // 提示词被清空时不允许提交：宿主会以 invalid_prompt 拒绝，没必要走一次往返。
            disabled={sending || !canGenerate}
          >
            {sending ? t('studio.generating') : t('studio.chat.intent.generate')}
          </button>
          {/* 次级动作：把确认卡内容写回参数面板，继续精调或批量抽卡。 */}
          <button
            type="button"
            className="ofs-btn is-quiet ofs-intent-handoff"
            onClick={() => handoff(message)}
            disabled={sending || !canGenerate}
          >
            {t('studio.chat.intent.handoff')}
          </button>
        </div>
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
                  // 空态示例只填对话草稿：参数由确认卡决定，不越过用户直接改表单。
                  onClick={() => setDraft(t(key))}
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
          <button type="button" className="ofs-chip" onClick={clearThread} disabled={messages.length === 0}>
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
