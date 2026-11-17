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

import { LIMITS, publicPresets } from '../../shared/contract.js'

import { COUNT_OPTIONS, INSPIRE_KEYS } from '../constants.js'
import { formatText } from '../logic/format.js'
import { intentCount } from '../logic/intent.js'
import { Icon } from './icons.jsx'
import { PanelModeTabs } from './PanelModeTabs.jsx'

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

const PUBLIC_PRESET_LIST = publicPresets()

/** 模型建议里展示的模型名；未知 id 返回空串（整行不渲染）。 */
function modelLabelOf(presetId) {
  const preset = PUBLIC_PRESET_LIST.find((item) => item && item.id === presetId)
  return preset ? (preset.label || preset.short || preset.id) : ''
}

/** 表单提交同步记录的小标题：普通表单提交 / 生成变体 / 重试上次参数。 */
function formSyncTitle(t, source) {
  if (source === 'variant') return t('studio.chat.formSync.variant')
  if (source === 'retry') return t('studio.chat.formSync.retry')
  return t('studio.chat.formSync.form')
}

/**
 * 表单提交的参数摘要 → 紧凑胶囊。
 *
 * 展示顺序固定：模型 → 画幅比例与像素 → 张数 → 种子策略，
 * 与表单提交时的请求体一一对应，用户不用回参数面板就能看懂这次是怎么生成的。
 * 主表单固定纯文生图（0.13.0 起参考图迁到舞台图片工具），不再输出「是否带参考图」胶囊。
 */
function formSyncChips(t, message) {
  const summary = message && message.summary && typeof message.summary === 'object' ? message.summary : null
  if (!summary) return []
  const chips = []
  const model = modelLabelOf(summary.presetId) || (typeof summary.presetId === 'string' ? summary.presetId : '')
  if (model) chips.push({ key: 'model', text: model })
  const width = Number(summary.width)
  const height = Number(summary.height)
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    const size = `${Math.round(width)} × ${Math.round(height)}`
    chips.push({
      key: 'size',
      text: typeof summary.ratioId === 'string' && summary.ratioId ? `${summary.ratioId} · ${size}` : size,
    })
  }
  const count = Number(summary.count)
  if (Number.isFinite(count) && count > 0) {
    chips.push({ key: 'count', text: `${Math.round(count)} ${t('unit.image')}` })
  }
  const seedValue = summary.seed
  // Number(null) === 0，不能直接 Number()：没有固定种子时 summary.seed 是 null。
  const seed = seedValue === null || seedValue === undefined || seedValue === '' ? NaN : Number(seedValue)
  if (Number.isFinite(seed) && seed >= 0) {
    chips.push({ key: 'seed', text: formatText(t('studio.chat.formSync.seed'), { seed: Math.trunc(seed) }) })
  } else {
    chips.push({ key: 'seed', text: t('studio.chat.formSync.seedRandom') })
  }
  return chips
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
    newChat,
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

  /** 新建对话：清空线程与输入草稿；解析中的在途请求由 useChatThread 的代次守卫丢弃。 */
  function startNewChat() {
    if (typeof newChat === 'function') newChat()
    setDraft('')
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

  /**
   * 表单提交同步记录：与普通用户气泡区分——白卡 + 标题 + 参数胶囊。
   * 记录只用于回看这次提交是怎么发出去的，不进入意图上下文（见 logic/intent.js）。
   */
  function renderFormSync(message) {
    const chips = formSyncChips(t, message)
    const prompt = typeof message.text === 'string' ? message.text : ''
    return (
      <div className="ofs-msg ofs-form-sync" key={message.id}>
        <div className="ofs-msg-card ofs-form-sync-card">
          <span className="ofs-form-sync-title">{formSyncTitle(t, message.source)}</span>
          {prompt ? <p className="ofs-form-sync-prompt" title={prompt}>{prompt}</p> : null}
          {chips.length > 0 ? (
            <div className="ofs-form-sync-chips">
              {chips.map((chip) => (
                <span className="ofs-chip ofs-form-sync-chip" key={chip.key}>{chip.text}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    )
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

  const startNewCreation = form && typeof form.newCreation === 'function'
    ? form.newCreation
    : (actions && typeof actions.newDraft === 'function' ? actions.newDraft : undefined)

  return (
    <aside className="ofs-panel ofs-panel--chat">
      <PanelModeTabs t={t} mode={mode} setMode={setMode} onNewCreation={startNewCreation} />

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
              {INSPIRE_KEYS.map((key) => (
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

        {messages.map((message) => {
          if (message.role === 'user') {
            // 表单提交同步记录走独立卡片，与自然语言用户气泡区分开。
            if (message.kind === 'form') return renderFormSync(message)
            return (
              <div className="ofs-msg ofs-msg--user" key={message.id}>
                <p>{message.text}</p>
              </div>
            )
          }
          return (
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
        })}

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
          {/* 语义是「开一个新话题」，不是删记录：清空线程并复位解析中状态。 */}
          <button type="button" className="ofs-chip ofs-chat-new" onClick={startNewChat} disabled={messages.length === 0}>
            {t('studio.chat.newChat')}
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
