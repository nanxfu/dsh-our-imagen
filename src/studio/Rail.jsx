/**
 * 左侧创作面板（表单式）。
 *
 * 分区按内容分组；接收 { t, ui, form, actions }。
 *
 * 0.10.0 布局（320px 单轨，自上而下）：
 *  1. 提示词：输入框 / 英译与润色 / 空白态灵感示例 / 润色建议。
 *  2. 参考图槽位（仅已有参考图时）。
 *  3. 画面设置：标题栏实时显示当前像素读数；有参考图时随图尺寸；文生图时是 5 个画幅比例 → 「自定义宽高」折叠。
 *  4. 高级设置（折叠）：排除项仅在当前模型/CFG 可用时出现；步数、CFG、随机种子。
 *  5. 页脚：生成张数 1~4 → 立即生成 → 规格摘要。
 */

import React from 'react'

import { COUNT_OPTIONS } from '../constants.js'
import { clampSize } from '../logic/clamp.js'
import { Icon } from './icons.jsx'
import { PanelModeTabs } from './PanelModeTabs.jsx'
import { FrameSection } from './rail/FrameSection.jsx'
import { ParamsSection } from './rail/ParamsSection.jsx'
import { PromptSection } from './rail/PromptSection.jsx'
import { ReferenceSection } from './rail/ReferenceSection.jsx'

function finiteSize(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
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
    activePreset,
    applyRatio,
    applyCustomSize,
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

  const hasPrompt = fields.prompt.trim().length > 0
  const currentWidth = clampSize(fields.width)
  const currentHeight = clampSize(fields.height)
  const frameSizeText = `${currentWidth} × ${currentHeight}`

  // 排除项：只有当前模型 + CFG 真的消费负向词时才出现（Host 与 Client 共用同一判定）。
  const showNegative = negativeActive === true
  const negativePlaceholder = negativeHint.length > 60
    ? `${negativeHint.slice(0, 60)}…`
    : (negativeHint || t('studio.negativePlaceholder'))

  // 参考图：没有参考图时整块不渲染，文生图界面与改造前一致。
  const referenceImage = reference && typeof reference === 'object' ? reference : null
  const referenceWidth = referenceImage ? finiteSize(referenceImage.width) : null
  const referenceHeight = referenceImage ? finiteSize(referenceImage.height) : null
  const referenceSize = referenceWidth && referenceHeight ? `${referenceWidth} × ${referenceHeight}` : ''

  // 页脚规格摘要：尺寸 · 比例 · 张数；有参考图时补一项「参考图」。
  const countValue = Number.isFinite(Number(fields.count)) ? Math.round(Number(fields.count)) : 1
  const specParts = [
    frameSizeText,
    ratioId || t('studio.rail.custom'),
    `${countValue} ${t('unit.image')}`,
  ]
  if (referenceImage) specParts.push(t('studio.reference.title'))

  return (
    <aside className="ofs-panel ofs-panel--form">
      <PanelModeTabs t={t} mode={mode} setMode={setMode} />

      <div className="ofs-panel-scroll">
        <PromptSection
          t={t}
          prompt={fields.prompt}
          patchForm={patchForm}
          generate={generate}
          translating={translating}
          translate={translate}
          enhancing={enhancing}
          enhance={enhance}
          englishPromptHint={englishPromptHint}
          useInspiration={useInspiration}
          refineGroups={refineGroups}
          refineSource={refineSource}
          toggleRefine={toggleRefine}
        />

        <ReferenceSection
          t={t}
          referenceImage={referenceImage}
          strength={strength}
          referenceBlocked={referenceBlocked}
          applyStrength={applyStrength}
          removeReference={removeReference}
        />

        <FrameSection
          t={t}
          width={fields.width}
          height={fields.height}
          frameSizeText={frameSizeText}
          ratioId={ratioId}
          applyRatio={applyRatio}
          applyCustomSize={applyCustomSize}
          hasReference={Boolean(referenceImage)}
          referenceSize={referenceSize}
        />

        <ParamsSection
          t={t}
          fields={fields}
          activePreset={activePreset}
          patchForm={patchForm}
          applyCfg={applyCfg}
          resetSeed={resetSeed}
          showNegative={showNegative}
          negativeOpen={negativeOpen}
          setNegativeOpen={setNegativeOpen}
          negativePlaceholder={negativePlaceholder}
          advancedOpen={advancedOpen}
          toggleAdvanced={toggleAdvanced}
        />
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
          {specParts.join(' · ')}
        </p>
      </div>
    </aside>
  )
}
