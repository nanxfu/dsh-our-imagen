/**
 * 左侧创作面板（表单式）。
 *
 * 分区按内容分组；接收 { t, ui, form, actions }。
 *
 * 0.13.0 布局（320px 单轨，自上而下）：
 *  1. 提示词：输入框 / 英译与润色 / 空白态灵感示例 / 润色建议。
 *  2. 画面设置：标题栏实时显示当前像素读数；5 个画幅比例 → 「自定义宽高」折叠。
 *  3. 高级设置（折叠）：排除项仅在当前模型/CFG 可用时出现；步数、CFG、随机种子。
 *  4. 页脚：生成张数 1~4 → 立即生成 → 规格摘要。
 *
 * 阶段十五 Phase A1：面板顶部在有未提交草稿时显示「正在新草稿中编辑（源自此图）」+
 * 「还原原图」，替代原来的「正在微调：{prompt}」行（两者互斥）。
 *
 * 主表单只做纯文生图：参考图 / 蒙版 / 重绘强度随左栏参考图区一起删除，
 * 图片处理入口统一在舞台底部动作坞（见 `studio.rail.imageToolsHint`）。
 */

import React from 'react'

import { COUNT_OPTIONS } from '../constants.js'
import { clampSize } from '../logic/clamp.js'
import { formatText } from '../logic/format.js'
import { Icon } from './icons.jsx'
import { PanelModeTabs } from './PanelModeTabs.jsx'
import { FrameSection } from './rail/FrameSection.jsx'
import { ParamsSection } from './rail/ParamsSection.jsx'
import { PromptSection } from './rail/PromptSection.jsx'

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
    englishPromptHint,
    // 微调来源（从胶卷 / 画廊回填而来）、未提交草稿状态与「新建创作」重置入口。
    tuning,
    newCreation,
    draftView,
  } = form
  const { sending, generate, restoreOriginal } = actions

  const hasPrompt = fields.prompt.trim().length > 0
  const currentWidth = clampSize(fields.width)
  const currentHeight = clampSize(fields.height)
  const frameSizeText = `${currentWidth} × ${currentHeight}`

  // 微调来源：当前参数来自哪张作品；提示只说明状态，不拦截任何操作。
  const tuningPrompt = tuning && typeof tuning === 'object' && typeof tuning.prompt === 'string'
    ? tuning.prompt.trim()
    : ''
  const tuningText = formatText(t('studio.rail.tuning'), {
    prompt: tuningPrompt || t('studio.rail.tuningUnknown'),
  })
  // 未提交草稿（阶段十五 A1）：左栏顶部换成「正在新草稿中编辑（源自此图）」+「还原原图」。
  // 只有确实有来源作品时才给还原入口（来源已丢失时只保留状态文案）。
  const draftSource = draftView && draftView.active && draftView.source ? draftView.source : null
  const draftActive = Boolean(draftView && draftView.active && draftView.source)
  const canRestore = Boolean(draftSource) && typeof restoreOriginal === 'function'
  const startNewCreation = typeof newCreation === 'function' ? newCreation : () => {}

  // 排除项：只有当前模型 + CFG 真的消费负向词时才出现（Host 与 Client 共用同一判定）。
  const showNegative = negativeActive === true
  const negativePlaceholder = negativeHint.length > 60
    ? `${negativeHint.slice(0, 60)}…`
    : (negativeHint || t('studio.negativePlaceholder'))

  // 页脚规格摘要：尺寸 · 比例 · 张数。
  const countValue = Number.isFinite(Number(fields.count)) ? Math.round(Number(fields.count)) : 1
  const specParts = [
    frameSizeText,
    ratioId || t('studio.rail.custom'),
    `${countValue} ${t('unit.image')}`,
  ]

  return (
    <aside className="ofs-panel ofs-panel--form">
      <PanelModeTabs t={t} mode={mode} setMode={setMode} onNewCreation={startNewCreation} />

      {/* 阶段十五 A1：有未提交草稿时顶部换成草稿状态 + 「还原原图」；
          否则保留原有的「正在微调：某张作品」轻量提示行。 */}
      {draftActive ? (
        <div className="ofs-tuning is-draft">
          <p className="ofs-tuning-source" title={draftSource && draftSource.prompt ? draftSource.prompt : undefined}>
            {t('studio.rail.draftStatus')}
          </p>
          {canRestore ? (
            <button
              type="button"
              className="ofs-tuning-restore"
              onClick={() => restoreOriginal()}
              title={t('studio.rail.restoreOriginal')}
            >
              {t('studio.rail.restoreOriginal')}
            </button>
          ) : null}
        </div>
      ) : tuning ? (
        <div className="ofs-tuning">
          <p className="ofs-tuning-source" title={tuningPrompt || undefined}>{tuningText}</p>
        </div>
      ) : null}

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
          refineGroups={refineGroups}
          refineSource={refineSource}
          toggleRefine={toggleRefine}
        />

        <FrameSection
          t={t}
          width={fields.width}
          height={fields.height}
          frameSizeText={frameSizeText}
          ratioId={ratioId}
          applyRatio={applyRatio}
          applyCustomSize={applyCustomSize}
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
