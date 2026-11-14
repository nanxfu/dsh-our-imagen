/**
 * 左侧创作面板（表单式）。
 *
 * 分区按内容分组；接收 { t, ui, form, actions }。
 *
 * 0.10.0 布局（320px 单轨，自上而下）：
 *  1. 提示词：输入框 / 英译与润色 / 英文软提示；灵感示例仅在提示词为空时出现，
 *     润色建议可收起。
 *  2. 参考图槽位（仅已有参考图时）。
 *  3. 画面设置：有参考图时只说明「尺寸跟随参考图」；文生图时是 5 个画幅比例 →
 *     分辨率档位（长边）→「自定义宽高」折叠。
 *  4. 高级设置（折叠）：排除项仅在当前模型/CFG 可用时出现；步数、CFG、随机种子。
 *  5. 页脚：生成张数 1~4 → 立即生成 → 规格摘要。
 *
 * 静态风格试印条与风格后缀已删除：风格由提示词内容与模型本身表达。
 */

import React from 'react'

import { LIMITS } from '../../shared/contract.js'

import { Tooltip } from '../components/Tooltip.jsx'
import { clampSize } from '../logic/clamp.js'
import { formatText } from '../logic/format.js'
import { referenceFileName } from '../logic/generate.js'
import { Icon } from './icons.jsx'
import { DEFAULT_RATIOS } from './presets.js'

const PROMPT_MAX = LIMITS.prompt.maxChars
const INSPIRE_KEYS = ['studio.inspire.1', 'studio.inspire.2', 'studio.inspire.3', 'studio.inspire.4', 'studio.inspire.5']
const COUNT_OPTIONS = [1, 2, 3, 4]

/**
 * 表单尺寸 → 宽/高输入框的展示文本。
 *
 * 表单里只存合法数字，这里再归一一次，保证「输入框看到的」与「将提交的」是同一个值；
 * 旧快照 / 测试夹具里出现空串时也不会渲染出空白或 `undefined`。
 */
function sizeDraftOf(fields) {
  const source = fields && typeof fields === 'object' ? fields : {}
  return { width: String(clampSize(source.width)), height: String(clampSize(source.height)) }
}

function finiteSize(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

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
    toggleAdvancedOpen,
    setAdvancedOpen,
    negativeOpen,
    setNegativeOpen,
    panelMode: mode,
    setPanelMode: setMode,
  } = ui
  // 业务路径由 useStudioUi 的 toggleAdvancedOpen 更新并持久化；
  // 预览 / 测试只注入 setAdvancedOpen 时退化为纯本地切换。
  const toggleAdvanced = typeof toggleAdvancedOpen === 'function'
    ? toggleAdvancedOpen
    : () => setAdvancedOpen((open) => !open)
  const {
    form: fields,
    patchForm,
    ratioId,
    applyRatio,
    applyCustomSize,
    sizeTiers,
    selectedTier,
    applyTier,
    applyCfg,
    resetSeed,
    negativeActive,
    negativeHint,
    refineGroups,
    refineSource,
    enhancing,
    enhance,
    translating,
    translate,
    toggleRefine,
    useInspiration,
    englishPromptHint,
    reference,
    strength,
    referenceBlocked,
    applyStrength,
    removeReference,
  } = form
  const { sending, generate } = actions

  // 宽/高输入框的编辑草稿：表单里只存合法数字，输入过程中的原始文本（含空串）先落在本地，
  // 失焦 / 回车时再归一化提交。外部改动（比例、档位、切换模型、带回参数）通过下面这个
  // effect 同步回草稿，保证输入框、读数与将提交的宽高永远是同一个值。
  const [sizeDraft, setSizeDraft] = React.useState(() => sizeDraftOf(fields))
  const syncedSize = React.useRef(undefined)
  React.useEffect(() => {
    const previous = syncedSize.current
    syncedSize.current = { width: fields.width, height: fields.height }
    // 首次挂载的草稿已经由 useState 初始化，不需要再写一次状态。
    if (!previous) return
    if (previous.width === fields.width && previous.height === fields.height) return
    setSizeDraft(sizeDraftOf(fields))
  }, [fields.width, fields.height])

  // 「自定义宽高」默认折叠；输入草稿逻辑不变，展开后才渲染输入框。
  const [customOpen, setCustomOpen] = React.useState(false)
  // 润色建议默认展开，头部可收起。
  const [refineOpen, setRefineOpen] = React.useState(true)

  const onCustomSize = typeof applyCustomSize === 'function' ? applyCustomSize : () => {}
  const onTier = typeof applyTier === 'function' ? applyTier : () => {}
  const onResetSeed = typeof resetSeed === 'function' ? resetSeed : () => patchForm({ seed: '' })
  const onCfgChange = typeof applyCfg === 'function'
    ? applyCfg
    : (value) => patchForm({ cfg: Number(value) })

  /** 改写草稿：输入过程不碰表单，避免半截数字进入提交值。 */
  function updateSizeDraft(key, value) {
    setSizeDraft((prev) => ({ ...prev, [key]: value }))
  }

  /** 提交草稿：空值 / 纯空白恢复修改前的合法值（不写表单）；否则钳制后写回表单。 */
  function commitSizeDraft(key) {
    const raw = String(sizeDraft[key] ?? '').trim()
    if (!raw) {
      setSizeDraft((prev) => ({ ...prev, [key]: String(clampSize(fields[key])) }))
      return
    }
    const value = clampSize(raw)
    setSizeDraft((prev) => ({ ...prev, [key]: String(value) }))
    if (value !== clampSize(fields[key])) onCustomSize({ [key]: value })
  }

  const promptLength = fields.prompt.length
  const hasPrompt = fields.prompt.trim().length > 0
  // 防御式取档位：预览/测试可能只给部分表单字段，缺失时该行整体不渲染。
  const tiers = Array.isArray(sizeTiers) ? sizeTiers : []
  // 排除项：只有当前模型 + CFG 真的消费负向词时才出现（Host 与 Client 共用同一判定）。
  const showNegative = negativeActive === true
  // 占位提示用模型推荐词，但过长的推荐词（如 Animagine 的 200+ 字符）会撑乱输入框，截断展示。
  const negativePlaceholder = negativeHint.length > 60
    ? `${negativeHint.slice(0, 60)}…`
    : (negativeHint || t('studio.negativePlaceholder'))

  // 参考图：没有参考图时整块不渲染，文生图界面与改造前一致。
  const referenceImage = reference && typeof reference === 'object' ? reference : null
  const referenceName = referenceImage ? referenceFileName(referenceImage.path) : ''
  const referenceWidth = referenceImage ? finiteSize(referenceImage.width) : null
  const referenceHeight = referenceImage ? finiteSize(referenceImage.height) : null
  const referenceSize = referenceWidth && referenceHeight ? `${referenceWidth} × ${referenceHeight}` : ''
  const strengthValue = Number.isFinite(Number(strength)) ? Number(strength) : LIMITS.strength.default
  const onRemoveReference = typeof removeReference === 'function' ? removeReference : () => {}
  const onStrengthChange = typeof applyStrength === 'function' ? applyStrength : () => {}

  // 高级设置折叠态读数：一眼看清将用什么参数生成，不必展开。
  const stepsValue = Number.isFinite(Number(fields.steps)) ? Math.round(Number(fields.steps)) : LIMITS.steps.min
  const cfgValue = Number.isFinite(Number(fields.cfg)) ? Number(fields.cfg) : LIMITS.cfg.min
  const seedText = String(fields.seed ?? '').trim()
  const paramsReadout = [
    `${stepsValue} ${t('studio.preset.stepsUnit')}`,
    `CFG ${cfgValue}`,
    seedText ? `${t('studio.meta.seed')} ${seedText}` : t('studio.seed'),
  ].join(' · ')

  // 页脚规格摘要：尺寸 · 比例 · 张数；有参考图时补一项「参考图」。
  const countValue = Number.isFinite(Number(fields.count)) ? Math.round(Number(fields.count)) : 1
  const specParts = [
    `${clampSize(fields.width)} × ${clampSize(fields.height)}`,
    ratioId || t('studio.rail.custom'),
    `${countValue} ${t('unit.image')}`,
  ]
  if (referenceImage) specParts.push(t('studio.reference.title'))

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
              <span className="ofs-composer-actions">
                {/* 英译只是把当前提示词换成英文，不改写内容；模型不可用时明确提示，不假装成功。 */}
                <button
                  type="button"
                  className="ofs-text-action ofs-translate-action"
                  onClick={translate}
                  disabled={translating || enhancing}
                >
                  {translating ? t('studio.translate.thinking') : t('studio.translate.button')}
                </button>
                <button type="button" className="ofs-text-action" onClick={enhance} disabled={enhancing || translating}>
                  <Icon name="expandText" size={13} />
                  {enhancing ? t('studio.enhance.thinking') : t('studio.enhance.button')}
                </button>
              </span>
            </div>
          </div>

          {/* 预设都按英文提示词训练：中文输入只提示，不拦截生成。 */}
          {englishPromptHint ? <p className="ofs-hint ofs-prompt-lang-hint">{t('studio.prompt.englishHint')}</p> : null}

          {/* 灵感示例只在提示词为空时出现，不长期占据首屏高度。 */}
          {hasPrompt ? null : (
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
          )}

          {refineGroups.length > 0 ? (
            <div className="ofs-refine">
              <div className="ofs-refine-head">
                <span>{t('studio.refine.title')}</span>
                <span className="ofs-refine-head-actions">
                  {refineSource === 'local' ? <span className="ofs-muted">{t('studio.enhance.local')}</span> : null}
                  <button
                    type="button"
                    className="ofs-text-action ofs-refine-toggle"
                    aria-expanded={refineOpen}
                    onClick={() => setRefineOpen((open) => !open)}
                  >
                    {refineOpen ? t('studio.refine.collapse') : t('studio.refine.expand')}
                  </button>
                </span>
              </div>
              {refineOpen ? (
                <>
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
                </>
              ) : null}
            </div>
          ) : null}
        </Fieldset>

        {/* 参考图：只在已有参考图时出现（来自画廊「以此图重绘」）。
            当前预设不支持垫图时槽位置灰，并写明下一步该切模型还是移除参考图。 */}
        {referenceImage ? (
          <Fieldset
            title={t('studio.reference.title')}
            action={(
              <button type="button" className="ofs-text-action ofs-reference-remove" onClick={onRemoveReference}>
                {t('studio.reference.remove')}
              </button>
            )}
          >
            <div className={referenceBlocked ? 'ofs-reference is-unsupported' : 'ofs-reference'}>
              <span className="ofs-reference-thumb">
                {referenceImage.url ? (
                  <img src={referenceImage.url} alt={referenceName || t('studio.reference.title')} loading="lazy" />
                ) : (
                  <Icon name="image" size={18} />
                )}
              </span>
              <div className="ofs-reference-meta">
                <span className="ofs-reference-name" title={referenceName || undefined}>
                  {referenceName || '—'}
                </span>
                <label className="ofs-reference-strength">
                  <span className="ofs-reference-strength-head">
                    {t('studio.reference.strength')}
                    <b>{strengthValue.toFixed(2)}</b>
                  </span>
                  <input
                    type="range"
                    className="ofs-reference-range"
                    min={LIMITS.strength.min}
                    max={LIMITS.strength.max}
                    step={LIMITS.strength.step}
                    value={strengthValue}
                    disabled={Boolean(referenceBlocked)}
                    aria-label={t('studio.reference.strength')}
                    onChange={(event) => onStrengthChange(event.target.value)}
                  />
                </label>
              </div>
            </div>
            {referenceBlocked ? (
              <p className="ofs-hint ofs-reference-warn">{t('studio.reference.unsupported')}</p>
            ) : (
              <p className="ofs-hint ofs-reference-hint">{t('studio.reference.hint')}</p>
            )}
          </Fieldset>
        ) : null}

        {/* 画面设置：有参考图时尺寸由参考图决定，后端不再消费宽高，
            因此收起比例 / 档位 / 宽高控件，只说明事实，避免「可点却无效」。 */}
        <Fieldset
          title={t('studio.rail.frame')}
          action={referenceImage
            ? <span className="ofs-frame-readout">{referenceSize || t('studio.rail.followReference')}</span>
            : null}
        >
          {referenceImage ? (
            referenceSize ? (
              <p className="ofs-hint ofs-follow-reference-hint">
                {formatText(t('studio.rail.followReferenceSize'), { size: referenceSize })}
              </p>
            ) : null
          ) : (
            <>
              <div className="ofs-frame-group">
                <span className="ofs-frame-label">{t('studio.rail.ratio')}</span>
                <div className="ofs-ratio-row" role="group" aria-label={t('studio.rail.ratio')}>
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
              </div>

              {/* 分辨率档位按长边定义：长边取档，短边按当前画幅比例换算。 */}
              {tiers.length > 0 ? (
                <div className="ofs-frame-group">
                  <span className="ofs-frame-label">{t('studio.rail.size')}</span>
                  <div className="ofs-size-options" role="group" aria-label={t('studio.rail.sizeAria')}>
                    {tiers.map((tier) => (
                      <button
                        type="button"
                        key={tier}
                        className={selectedTier === tier ? 'ofs-size is-on' : 'ofs-size'}
                        onClick={() => onTier(tier)}
                        aria-pressed={selectedTier === tier}
                        title={`${tier} px`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 自定义宽高：默认折叠，编辑过程走本地草稿，失焦才提交。 */}
              <div className="ofs-frame-group">
                <button
                  type="button"
                  className="ofs-custom-toggle"
                  aria-expanded={customOpen}
                  onClick={() => setCustomOpen((open) => !open)}
                >
                  <span>{t('studio.rail.customSize')}</span>
                  <span className={customOpen ? 'ofs-chevron is-open' : 'ofs-chevron'} aria-hidden="true">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </button>
                {customOpen ? (
                  <div className="ofs-custom-body">
                    <div className="ofs-size-custom">
                      <label className="ofs-size-custom-field">
                        <span>{t('studio.rail.width')}</span>
                        <input
                          type="number"
                          min={LIMITS.width.min}
                          max={LIMITS.width.max}
                          step={LIMITS.width.step}
                          value={sizeDraft.width}
                          aria-label={t('studio.rail.width')}
                          onChange={(event) => updateSizeDraft('width', event.target.value)}
                          onBlur={() => commitSizeDraft('width')}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                          }}
                        />
                      </label>
                      <span className="ofs-size-custom-times" aria-hidden="true">×</span>
                      <label className="ofs-size-custom-field">
                        <span>{t('studio.rail.height')}</span>
                        <input
                          type="number"
                          min={LIMITS.height.min}
                          max={LIMITS.height.max}
                          step={LIMITS.height.step}
                          value={sizeDraft.height}
                          aria-label={t('studio.rail.height')}
                          onChange={(event) => updateSizeDraft('height', event.target.value)}
                          onBlur={() => commitSizeDraft('height')}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur()
                          }}
                        />
                      </label>
                    </div>
                    <p className="ofs-hint ofs-size-hint">
                      {formatText(t('studio.rail.sizeHint'), {
                        min: LIMITS.width.min,
                        max: LIMITS.width.max,
                        step: LIMITS.width.step,
                      })}
                    </p>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </Fieldset>

        <Fieldset
          title={t('studio.rail.advanced')}
          action={advancedOpen ? null : <span className="ofs-row-readout">{paramsReadout}</span>}
        >
          <div className="ofs-rows">
            {/* 排除项只在当前模型 + CFG 真的消费负向词时出现；隐藏时不写、不提交。 */}
            {showNegative ? (
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
                    placeholder={negativePlaceholder}
                    spellCheck={false}
                    onChange={(event) => patchForm({ negative: event.target.value })}
                  />
                ) : null}
              </div>
            ) : null}

            <div className={advancedOpen ? 'ofs-row is-open' : 'ofs-row'}>
              <div className="ofs-row-head">
                <button
                  type="button"
                  className="ofs-row-toggle"
                  onClick={toggleAdvanced}
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
                      min={LIMITS.steps.min}
                      max={LIMITS.steps.max}
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
                      min={LIMITS.cfg.min}
                      max={LIMITS.cfg.max}
                      step={0.5}
                      value={fields.cfg}
                      aria-label={t('studio.cfg')}
                      onChange={(event) => onCfgChange(Number(event.target.value))}
                    />
                  </div>
                  <div className="ofs-field ofs-field--wide">
                    <span>{t('studio.seed')}</span>
                    <div className="ofs-seed-row">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fields.seed}
                        placeholder={t('studio.random')}
                        aria-label={t('studio.seed')}
                        onChange={(event) => patchForm({ seed: event.target.value })}
                      />
                      <button
                        type="button"
                        className="ofs-text-action ofs-seed-reset"
                        onClick={onResetSeed}
                        disabled={!seedText}
                      >
                        {t('studio.seed.reset')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Fieldset>
      </div>

      <div className="ofs-panel-foot">
        {/* 生成张数提权到页脚：抽卡是高频动作，不再埋进高级折叠区。 */}
        <div className="ofs-qty-row">
          <span className="ofs-qty-label">{t('studio.countShort')}</span>
          <div className="ofs-qty" role="group" aria-label={t('studio.count')}>
            {COUNT_OPTIONS.map((value) => (
              <button
                type="button"
                key={value}
                className={countValue === value ? 'ofs-qty-option is-on' : 'ofs-qty-option'}
                onClick={() => patchForm({ count: value })}
                aria-pressed={countValue === value}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={sending ? 'ofs-btn is-primary ofs-generate is-busy' : 'ofs-btn is-primary ofs-generate'}
          onClick={() => generate()}
          disabled={sending || !hasPrompt}
        >
          <Icon name="sparkles" size={16} />
          {sending ? t('studio.generating') : t('studio.generate')}
        </button>
        <p className="ofs-hint ofs-spec-summary">
          {hasPrompt ? specParts.join(' · ') : t('studio.promptHint')}
        </p>
      </div>
    </aside>
  )
}
