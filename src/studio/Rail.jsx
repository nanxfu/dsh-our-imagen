/**
 * 左侧创作面板（表单式）。
 *
 * 分区按内容分组；接收 { t, ui, form, actions }。
 */

import React from 'react'

import { LIMITS } from '../../shared/contract.js'

import { Tooltip } from '../components/Tooltip.jsx'
import { Icon } from './icons.jsx'
import { DEFAULT_RATIOS, STYLE_CAPSULES } from './presets.js'

/**
 * 风格试印条：五种风格的灰度小样。
 *
 * 风格预设不是抽象色块，而是暗房里先试印出来的一小片相纸：每种风格画一张 64×64 的
 * 单色示意图，选风格时看到的是「这个风格长什么样」，不是「这个按钮是什么颜色」。
 * 全部为内联 SVG，不引入任何位图资产，也不使用彩色；每个小样以 style id 作前缀，
 * 保证渐变 / 滤镜 id 唯一。
 */
const SPECIMENS = {
  // 写实摄影：天空柔光 + 两道山脊的景深
  film: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5f5f7" />
          <stop offset="62%" stopColor="#c5c5cd" />
          <stop offset="100%" stopColor="#9b9ba4" />
        </linearGradient>
        <linearGradient id={`${uid}-far`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8f8f99" />
          <stop offset="100%" stopColor="#5b5b64" />
        </linearGradient>
        <linearGradient id={`${uid}-near`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#33333a" />
          <stop offset="100%" stopColor="#151519" />
        </linearGradient>
        <radialGradient id={`${uid}-sun`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-sky)`} />
      <circle cx="42" cy="27" r="15" fill={`url(#${uid}-sun)`} />
      <path d="M0 38 L12 33 L21 37 L33 30 L45 36 L56 32 L64 35 V64 H0Z" fill={`url(#${uid}-far)`} />
      <path d="M0 64 V47 L16 42 L30 48 L46 43 L64 46 V64Z" fill={`url(#${uid}-near)`} />
    </>
  ),

  // 概念原画：压暗的场景 + 一道边缘光
  concept: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#565661" />
          <stop offset="52%" stopColor="#2b2b32" />
          <stop offset="100%" stopColor="#141417" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
      <circle cx="46" cy="15" r="10" fill="#ffffff" opacity="0.08" />
      <circle cx="46" cy="15" r="5.6" fill="#dcdce4" opacity="0.94" />
      <path d="M0 64 V46 L11 33 L18 40 L27 21 L34 32 L40 17 L48 29 L56 24 L64 32 V64Z" fill="#0d0d10" />
      <path
        d="M11 33 L18 40 M27 21 L34 32 M40 17 L48 29"
        fill="none"
        stroke="#f2f2f7"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.75"
      />
      <rect y="50" width="64" height="3" fill="#ffffff" opacity="0.08" />
    </>
  ),

  // 赛博朋克：两柱灯牌立在楼群剪影里，湿地面留下反光（仍然是单色）
  cyberpunk: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2c2c34" />
          <stop offset="100%" stopColor="#0d0d10" />
        </linearGradient>
        <linearGradient id={`${uid}-refl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-70%" y="-25%" width="240%" height="160%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
      <g filter={`url(#${uid}-glow)`} opacity="0.9">
        <rect x="13" y="17" width="4.2" height="28" rx="1.2" fill="#f4f4f8" />
        <rect x="42" y="11" width="5.2" height="34" rx="1.4" fill="#fbfbfd" />
        <rect x="22" y="27" width="2.4" height="18" rx="1" fill="#cfcfda" />
      </g>
      <path d="M0 64 V41 H7.4 V64Z M7.4 64 V33 H18.6 V64Z M28 64 V46 H36 V64Z M46 64 V36 H64 V64Z" fill="#09090c" />
      <rect y="50" width="64" height="14" fill="#08080b" />
      <g opacity="0.5">
        <rect x="13" y="50" width="4.2" height="11" fill={`url(#${uid}-refl)`} />
        <rect x="42" y="50" width="5.2" height="12" fill={`url(#${uid}-refl)`} />
      </g>
    </>
  ),

  // 水墨写意：两笔淡墨山影、一条水线与一处留白
  ink: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-wash`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#2a2a30" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#2a2a30" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="#fbfbfc" />
      <path d="M2 44 C 10 33 17 28 26 24 C 21 31 15 38 8 45 Z" fill={`url(#${uid}-wash)`} />
      <path d="M30 47 C 37 40 44 36 55 32 C 48 39 42 44 36 49 Z" fill="#3a3a42" opacity="0.7" />
      <path d="M0 52 C 16 49 34 51 64 45" fill="none" stroke="#8e8e98" strokeWidth="0.8" opacity="0.5" />
      <circle cx="48" cy="17" r="2.4" fill="#a0a0aa" />
      <path d="M6 58 C 20 56 36 57 58 52" fill="none" stroke="#c4c4cc" strokeWidth="0.7" opacity="0.65" />
    </>
  ),

  // 3D 渲染：柔和棚拍光下的一颗黏土球
  clay: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#f8f8fa" />
          <stop offset="100%" stopColor="#dcdce2" />
        </linearGradient>
        <radialGradient id={`${uid}-ball`} cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#fdfdfe" />
          <stop offset="52%" stopColor="#cfcfd7" />
          <stop offset="100%" stopColor="#8b8b96" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
      <ellipse cx="32" cy="51" rx="19" ry="5" fill="#26262c" opacity="0.16" />
      <circle cx="32" cy="30" r="17.5" fill={`url(#${uid}-ball)`} />
      <ellipse cx="25" cy="23" rx="5.4" ry="3.4" fill="#ffffff" opacity="0.62" transform="rotate(-24 25 23)" />
      <path d="M20 44 C 26 47 38 47 44 43" fill="none" stroke="#6f6f79" strokeWidth="0.9" opacity="0.32" />
    </>
  ),
}

/** 传 { id }：风格 id 对应 STYLE_CAPSULES 的 id。 */
export function StylePlate(props) {
  const draw = SPECIMENS[props.id]
  if (!draw) return null
  return (
    <svg className="ofs-plate" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {draw(`ofs-plate-${props.id}`)}
    </svg>
  )
}

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
  const { t, ui, form, actions } = props
  const {
    advancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    panelMode: mode,
    setPanelMode: setMode,
  } = ui
  const {
    form: fields,
    patchForm,
    styleId,
    applyStyle,
    ratioId,
    applyRatio,
    refineGroups,
    refineSource,
    enhancing,
    enhance,
    toggleRefine,
    useInspiration,
    englishPromptHint,
  } = form
  const { sending, generate } = actions

  const promptLength = fields.prompt.length
  const hasPrompt = fields.prompt.trim().length > 0

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
              value={fields.prompt}
              maxLength={PROMPT_MAX}
              placeholder={t('studio.promptPlaceholder')}
              spellCheck={false}
              onChange={(event) => patchForm({ prompt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) generate()
              }}
            />
            <div className="ofs-composer-foot">
              <span className="ofs-counter">
                {promptLength} / {PROMPT_MAX}
              </span>
              <button type="button" className="ofs-text-action" onClick={enhance} disabled={enhancing}>
                <Icon name="expandText" size={13} />
                {enhancing ? t('studio.enhance.thinking') : t('studio.enhance.button')}
              </button>
            </div>
          </div>

          {/* 预设都按英文提示词训练：中文输入只提示，不拦截生成。 */}
          {englishPromptHint ? <p className="ofs-hint ofs-prompt-lang-hint">{t('studio.prompt.englishHint')}</p> : null}

          <div className="ofs-inspire">
            <span className="ofs-inspire-label">{t('studio.inspire.title')}</span>
            <div className="ofs-suggestions">
              {INSPIRE_KEYS.map((key) => (
                <button
                  type="button"
                  key={key}
                  className="ofs-suggestion"
                  onClick={() => useInspiration(t(key))}
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
                        // 界面显示 UI 语言标签，插入提示词的始终是英文本。
                        onClick={() => toggleRefine(option.text)}
                        aria-pressed={option.applied}
                        title={option.text}
                      >
                        {option.label || option.text}
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
                <span className="ofs-tile-art" aria-hidden="true">
                  <StylePlate id={capsule.id} />
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
                  value={fields.negative}
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
                      value={fields.steps}
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
                      value={fields.cfg}
                      aria-label={t('studio.cfg')}
                      onChange={(event) => patchForm({ cfg: Number(event.target.value) })}
                    />
                  </div>
                  <div className="ofs-field">
                    <span>{t('studio.seed')}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fields.seed}
                      placeholder={t('studio.random')}
                      aria-label={t('studio.seed')}
                      onChange={(event) => patchForm({ seed: event.target.value })}
                    />
                  </div>
                  <div className="ofs-field">
                    <span>{t('studio.count')}</span>
                    <select
                      value={fields.count}
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
        <button
          type="button"
          className={sending ? 'ofs-btn is-primary ofs-generate is-busy' : 'ofs-btn is-primary ofs-generate'}
          onClick={() => generate()}
          disabled={sending || !hasPrompt}
        >
          <Icon name="sparkles" size={16} />
          {sending ? t('studio.generating') : t('studio.generate')}
        </button>
        <p className="ofs-hint">{hasPrompt ? t('studio.generateHint') : t('studio.promptHint')}</p>
      </div>
    </aside>
  )
}