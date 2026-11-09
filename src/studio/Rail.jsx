/**
 * 左侧创作控制面板（表单式）。
 *
 * 结构按编号分区：01 提示词 / 02 风格预设 / 03 画面设置 / 04 高级设置，
 * 底部固定主按钮。参考「创作设置」类面板的组织方式，但不照搬配色与图标。
 */

import React from 'react'

import { PROMPT_BOOSTS, STYLE_CAPSULES } from './capsules.js'
import { DEFAULT_RATIOS } from './ratios.js'

const PROMPT_MAX = 2000

function Fieldset(props) {
  return (
    <section className="ofs-fieldset">
      <div className="ofs-fieldset-head">
        <h3>
          <span className="ofs-num">{props.index}</span>
          {props.title}
        </h3>
        {props.action ? props.action : null}
      </div>
      {props.children}
    </section>
  )
}

export function Rail(props) {
  const {
    t,
    form,
    patchForm,
    isEn,
    styleId,
    applyStyle,
    ratioId,
    applyRatio,
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    sending,
    onGenerate,
    suggestions,
    suggestSource,
    enhancing,
    onEnhance,
    onApplySuggestion,
    presets,
    mode,
    setMode,
  } = props

  const promptLength = form.prompt.length
  const styleList = STYLE_CAPSULES
  const activeSuggestion = suggestions.length > 0 ? suggestions : []

  return (
    <aside className="ofs-rail">
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

      <div className="ofs-rail-scroll">
        <Fieldset index="01" title={t('studio.prompt')}>
          <div className="ofs-composer">
            <textarea
              className="ofs-composer-input"
              value={form.prompt}
              maxLength={PROMPT_MAX}
              placeholder={t('studio.promptPlaceholder')}
              spellCheck={false}
              onChange={(event) => patchForm({ prompt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onGenerate()
              }}
            />
            <div className="ofs-composer-foot">
              <span className="ofs-counter">
                {promptLength} / {PROMPT_MAX}
              </span>
              <button type="button" className="ofs-text-action" onClick={onEnhance} disabled={enhancing}>
                {enhancing ? t('studio.enhance.thinking') : t('studio.enhance.button')}
                <span aria-hidden="true"> ✨</span>
              </button>
            </div>
          </div>

          {activeSuggestion.length > 0 ? (
            <div className="ofs-suggestions">
              {activeSuggestion.map((entry) => (
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
              {suggestSource === 'local' ? <span className="ofs-muted">{t('studio.enhance.local')}</span> : null}
            </div>
          ) : (
            <div className="ofs-suggestions">
              {PROMPT_BOOSTS.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className="ofs-suggestion"
                  onClick={() => onApplySuggestion(entry.suffix)}
                  title={entry.suffix}
                >
                  {entry.icon} {isEn ? entry.en : entry.zh}
                </button>
              ))}
            </div>
          )}
        </Fieldset>

        <Fieldset index="02" title={t('studio.style')}>
          <div className="ofs-tiles">
            {styleList.map((capsule) => (
              <button
                type="button"
                key={capsule.id}
                className={styleId === capsule.id ? 'ofs-tile is-on' : 'ofs-tile'}
                onClick={() => applyStyle(capsule.id)}
                aria-pressed={styleId === capsule.id}
              >
                <span className="ofs-tile-icon" aria-hidden="true">
                  {capsule.icon}
                </span>
                <span className="ofs-tile-label">{isEn ? capsule.en : capsule.zh}</span>
              </button>
            ))}
          </div>
        </Fieldset>

        <Fieldset index="03" title={t('studio.rail.frame')}>
          <div className="ofs-ratio-row">
            {DEFAULT_RATIOS.map((ratio) => (
              <button
                type="button"
                key={ratio.id}
                className={ratioId === ratio.id ? 'ofs-ratio is-on' : 'ofs-ratio'}
                onClick={() => applyRatio(ratio.id)}
                aria-pressed={ratioId === ratio.id}
              >
                <span className={`ofs-ratio-glyph ofs-ratio-glyph--${ratio.id.replace(':', '-')}`} aria-hidden="true" />
                <span className="ofs-ratio-label">{ratio.id}</span>
              </button>
            ))}
          </div>
        </Fieldset>

        <Fieldset index="04" title={t('studio.rail.advanced')}>
          <div className="ofs-rows">
            <div className="ofs-row">
              <button
                type="button"
                className="ofs-row-head"
                onClick={() => setNegativeOpen((open) => !open)}
                aria-expanded={negativeOpen}
              >
                <span>{t('studio.negative')}</span>
                <span className="ofs-chevron" aria-hidden="true">
                  {negativeOpen ? '⌃' : '⌄'}
                </span>
              </button>
              {negativeOpen ? (
                <textarea
                  className="ofs-row-textarea"
                  rows={3}
                  value={form.negative}
                  placeholder={t('studio.negativePlaceholder')}
                  spellCheck={false}
                  onChange={(event) => patchForm({ negative: event.target.value })}
                />
              ) : null}
            </div>

            <div className="ofs-row">
              <button
                type="button"
                className="ofs-row-head"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
              >
                <span>{t('studio.rail.params')}</span>
                <span className="ofs-chevron" aria-hidden="true">
                  {advancedOpen ? '⌃' : '⌄'}
                </span>
              </button>
              {advancedOpen ? (
                <div className="ofs-grid2">
                  <label className="ofs-field">
                    <span>{t('studio.steps')}</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={form.steps}
                      onChange={(event) => patchForm({ steps: Number(event.target.value) })}
                    />
                  </label>
                  <label className="ofs-field">
                    <span>{t('studio.cfg')}</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      step={0.5}
                      value={form.cfg}
                      onChange={(event) => patchForm({ cfg: Number(event.target.value) })}
                    />
                  </label>
                  <label className="ofs-field">
                    <span>{t('studio.seed')}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.seed}
                      placeholder={t('studio.random')}
                      onChange={(event) => patchForm({ seed: event.target.value })}
                    />
                  </label>
                  <label className="ofs-field">
                    <span>{t('studio.count')}</span>
                    <select value={form.count} onChange={(event) => patchForm({ count: Number(event.target.value) })}>
                      {[1, 2, 3, 4].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        </Fieldset>
      </div>

      <div className="ofs-rail-bottom">
        <button type="button" className="ofs-generate" onClick={onGenerate} disabled={sending}>
          {sending ? t('studio.generating') : t('studio.generate')}
        </button>
        <p className="ofs-hint">{t('studio.generateHint')}</p>
      </div>
    </aside>
  )
}