/**
 * 左侧创作面板（表单式）。
 *
 * 分区按内容分组，不用「01 / 02 / 03」编号——这不是需要按顺序完成的步骤。
 * 每个分区是一块浅底卡片，标题上方留白多于下方。
 */

import React from 'react'

import { LIMITS } from '../../shared/contract.js'

import { Tooltip } from '../components/Tooltip.jsx'
import { Icon } from './icons.jsx'
import { STYLE_CAPSULES } from './capsules.js'
import { DEFAULT_RATIOS } from './ratios.js'

const PROMPT_MAX = LIMITS.prompt.maxChars
const INSPIRE_KEYS = ['studio.inspire.1', 'studio.inspire.2', 'studio.inspire.3', 'studio.inspire.4', 'studio.inspire.5']

function Fieldset(props) {
  return (
    <section className="ofs-fieldset">
      <div className="ofs-fieldset-head">
        <h3>{props.title}</h3>
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
    refineGroups,
    refineSource,
    enhancing,
    onEnhance,
    onToggleRefine,
    onInspire,
    mode,
    setMode,
  } = props

  const promptLength = form.prompt.length
  const hasPrompt = form.prompt.trim().length > 0

  return (
    <aside className="ofs-panel ofs-panel--form">
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

      <div className="ofs-panel-scroll">
        <Fieldset
          title={t('studio.prompt')}
          action={<Tooltip text={t('studio.promptTooltip')} />}
        >
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
                <Icon name="expandText" size={13} />
                {enhancing ? t('studio.enhance.thinking') : t('studio.enhance.button')}
              </button>
            </div>
          </div>

          <div className="ofs-inspire">
            <span className="ofs-inspire-label">{t('studio.inspire.title')}</span>
            <div className="ofs-suggestions">
              {INSPIRE_KEYS.map((key) => (
                <button
                  type="button"
                  key={key}
                  className="ofs-suggestion"
                  onClick={() => onInspire(t(key))}
                  title={t(key)}
                >
                  {t(`${key}.label`)}
                </button>
              ))}
            </div>
          </div>

          {refineGroups.length > 0 ? (
            <div className="ofs-refine">
              <div className="ofs-refine-head">
                <span>{t('studio.refine.title')}</span>
                {refineSource === 'local' ? <span className="ofs-muted">{t('studio.enhance.local')}</span> : null}
              </div>
              {refineGroups.map((group) => (
                <div className="ofs-refine-group" key={group.dimension}>
                  <span className="ofs-refine-dim">{t(`studio.refine.${group.dimension}`)}</span>
                  <div className="ofs-suggestions">
                    {group.options.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={option.applied ? 'ofs-suggestion is-on' : 'ofs-suggestion'}
                        onClick={() => onToggleRefine(option.text)}
                        aria-pressed={option.applied}
                        title={option.text}
                      >
                        {option.text}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="ofs-hint">{t('studio.refine.hint')}</p>
            </div>
          ) : null}
        </Fieldset>

        <Fieldset title={t('studio.style')}>
          <div className="ofs-tiles">
            {STYLE_CAPSULES.map((capsule) => (
              <button
                type="button"
                key={capsule.id}
                className={styleId === capsule.id ? 'ofs-tile is-on' : 'ofs-tile'}
                onClick={() => applyStyle(capsule.id)}
                aria-pressed={styleId === capsule.id}
                title={t(capsule.labelKey)}
              >
                <span className={`ofs-tile-art is-${capsule.id}`} aria-hidden="true">
                  <Icon name={capsule.icon} size={16} />
                </span>
                <span className="ofs-tile-label">{t(capsule.labelKey)}</span>
              </button>
            ))}
          </div>
        </Fieldset>

        <Fieldset title={t('studio.rail.frame')}>
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

        <Fieldset title={t('studio.rail.advanced')}>
          <div className="ofs-rows">
            <div className={negativeOpen ? 'ofs-row is-open' : 'ofs-row'}>
              <div className="ofs-row-head">
                <button
                  type="button"
                  className="ofs-row-toggle"
                  onClick={() => setNegativeOpen((open) => !open)}
                  aria-expanded={negativeOpen}
                >
                  <span>{t('studio.negative')}</span>
                  <span className={negativeOpen ? 'ofs-chevron is-open' : 'ofs-chevron'} aria-hidden="true">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </button>
                <Tooltip text={t('studio.negativeTooltip')} />
              </div>
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

            <div className={advancedOpen ? 'ofs-row is-open' : 'ofs-row'}>
              <div className="ofs-row-head">
                <button
                  type="button"
                  className="ofs-row-toggle"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-expanded={advancedOpen}
                >
                  <span>{t('studio.rail.params')}</span>
                  <span className={advancedOpen ? 'ofs-chevron is-open' : 'ofs-chevron'} aria-hidden="true">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </button>
              </div>
              {advancedOpen ? (
                <div className="ofs-grid2">
                  <div className="ofs-field">
                    <span className="ofs-field-label">
                      {t('studio.steps')}
                      <Tooltip text={t('studio.stepsTooltip')} />
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={form.steps}
                      aria-label={t('studio.steps')}
                      onChange={(event) => patchForm({ steps: Number(event.target.value) })}
                    />
                  </div>
                  <div className="ofs-field">
                    <span className="ofs-field-label">
                      {t('studio.cfg')}
                      <Tooltip text={t('studio.cfgTooltip')} />
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      step={0.5}
                      value={form.cfg}
                      aria-label={t('studio.cfg')}
                      onChange={(event) => patchForm({ cfg: Number(event.target.value) })}
                    />
                  </div>
                  <div className="ofs-field">
                    <span>{t('studio.seed')}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.seed}
                      placeholder={t('studio.random')}
                      aria-label={t('studio.seed')}
                      onChange={(event) => patchForm({ seed: event.target.value })}
                    />
                  </div>
                  <div className="ofs-field">
                    <span>{t('studio.count')}</span>
                    <select
                      value={form.count}
                      aria-label={t('studio.count')}
                      onChange={(event) => patchForm({ count: Number(event.target.value) })}
                    >
                      {[1, 2, 3, 4].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Fieldset>
      </div>

      <div className="ofs-panel-foot">
        <button type="button" className="ofs-btn is-primary ofs-generate" onClick={onGenerate} disabled={sending || !hasPrompt}>
          <Icon name="sparkles" size={16} />
          {sending ? t('studio.generating') : t('studio.generate')}
        </button>
        <p className="ofs-hint">{hasPrompt ? t('studio.generateHint') : t('studio.promptHint')}</p>
      </div>
    </aside>
  )
}