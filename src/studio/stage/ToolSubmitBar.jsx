/**
 * 图片工具的轻量提交栏：MaskEditor / OutpaintEditor / InlineTool 共用的
 * 「预设 + 提示词 + 强度 + 提交」一行。
 *
 * 这里只做受控展示，不持有状态：预设、提示词、强度与拦截原因都来自 `useImageTool`，
 * 通过 Stage 透传进来。提交走工具自己的请求体，与左栏文生图表单完全无关。
 * 扩图通过可选的 `metaLabel` / `metaPercent` 把覆盖率读数换成「新增画面 {percent}%」，
 * 不传时保持局部重绘的既有文案。
 *
 * 结构（对应 `src/styles/stage.css` 的 `.ofs-tool-*`）：
 *   .ofs-tool-bar
 *     ├─ .ofs-tool-bar-head  → 工具名 + 预设（多于一个时给 select 胶囊）
 *     ├─ .ofs-tool-prompt    → 修改描述输入框（默认空，placeholder 是目标作品原提示词）
 *     ├─ .ofs-tool-strength  → 重绘强度滑块 + 读数
 *     ├─ .ofs-tool-mask      → 涂抹覆盖率读数（仅画布工具；扩图用 metaLabel 换文案）
 *     └─ .ofs-tool-actions   → 主按钮 .ofs-tool-submit / 退出 .ofs-tool-exit
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'

import { formatText } from '../../logic/format.js'
import { presetLabelOf } from '../../logic/generate.js'

/**
 * 涂抹覆盖率 → 界面百分比读数。
 *
 * 与旧 Stage 的读数保持同一口径：不足 10% 时保留一位小数，
 * 避免刚涂一点就显示 0%。纯逻辑侧只存 6 位小数的覆盖率。
 */
function percentOf(coverage) {
  const value = Number(coverage)
  if (!Number.isFinite(value) || value <= 0) return 0
  const percent = Math.min(100, value * 100)
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
}

export function ToolSubmitBar(props) {
  const {
    t,
    tool,
    presets,
    presetId,
    onPresetChange,
    prompt,
    onPromptChange,
    promptPlaceholder,
    strength,
    strengthMax,
    onStrengthChange,
    maskCoverage,
    // 可选：画布类工具的覆盖率文案模板（如扩图「新增画面 {percent}%」）。
    // 不传时保持既有「已涂抹 {percent}% / 尚未涂抹蒙版」行为。
    metaLabel,
    metaPercent,
    submitting,
    canSubmit,
    blockedKey,
    onSubmit,
    onExit,
  } = props
  const list = Array.isArray(presets) ? presets : []
  // 画布工具才显示覆盖率读数（整图重绘传 undefined，不占一行）。
  const showCoverage = maskCoverage !== null && maskCoverage !== undefined
  const customMeta = typeof metaLabel === 'string' && metaLabel !== ''
  const percent = percentOf(customMeta ? metaPercent : maskCoverage)
  const max = Number.isFinite(Number(strengthMax)) ? Number(strengthMax) : LIMITS.strength.max
  const value = Number.isFinite(Number(strength)) ? Number(strength) : LIMITS.strength.default
  const busy = submitting === true
  const blocked = !canSubmit && Boolean(blockedKey)

  return (
    <div className="ofs-tool-bar">
      <div className="ofs-tool-row">
        <div className="ofs-tool-bar-head">
          <span className="ofs-tool-name">{tool ? t(tool.labelKey) : ''}</span>
          {list.length > 1 ? (
            <label className="ofs-tool-preset">
              <span className="ofs-tool-preset-label">{t('studio.imageTool.presetLabel')}</span>
              <select
                className="ofs-tool-select"
                value={presetId || ''}
                aria-label={t('studio.imageTool.presetLabel')}
                onChange={(event) => onPresetChange(event.target.value)}
              >
                {list.map((item) => (
                  <option key={item.id} value={item.id}>{presetLabelOf(item)}</option>
                ))}
              </select>
            </label>
          ) : list.length === 1 ? (
            <span className="ofs-tool-preset-name">{presetLabelOf(list[0])}</span>
          ) : null}
        </div>

        <label className="ofs-tool-prompt">
          <span className="ofs-tool-label">{t('studio.imageTool.promptLabel')}</span>
          <textarea
            className="ofs-tool-prompt-input"
            rows={1}
            value={prompt || ''}
            placeholder={promptPlaceholder || ''}
            aria-label={t('studio.imageTool.promptLabel')}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (!event || event.key !== 'Enter' || event.shiftKey || event.isComposing) return
              if (typeof event.preventDefault === 'function') event.preventDefault()
              if (canSubmit === true && !busy && typeof onSubmit === 'function') onSubmit()
            }}
          />
        </label>

        <label className="ofs-tool-strength">
          <span className="ofs-tool-label">{t('studio.imageTool.strengthLabel')}</span>
          <input
            type="range"
            className="ofs-tool-range"
            min={LIMITS.strength.min}
            max={max}
            step={LIMITS.strength.step}
            value={value}
            aria-label={t('studio.imageTool.strengthLabel')}
            onChange={(event) => onStrengthChange(event.target.value)}
          />
          <b className="ofs-tool-readout">{value.toFixed(2)}</b>
        </label>

        <div className="ofs-tool-actions">
          <button
            type="button"
            className="ofs-btn is-primary ofs-tool-submit"
            disabled={canSubmit !== true || busy}
            aria-busy={busy ? 'true' : undefined}
            onClick={onSubmit}
          >
            {t('studio.imageTool.submit')}
          </button>
          <button type="button" className="ofs-btn is-danger-quiet ofs-tool-exit" disabled={busy} onClick={onExit}>
            {t('studio.imageTool.exit')}
          </button>
        </div>
      </div>

      {showCoverage || blocked ? (
        <div className="ofs-tool-meta">
          {showCoverage ? (
            <p className="ofs-tool-mask ofs-hint">
              {customMeta
                ? formatText(metaLabel, { percent })
                : (percent > 0
                  ? formatText(t('studio.mask.coverage'), { percent })
                  : t('studio.imageTool.maskEmpty'))}
            </p>
          ) : null}
          {blocked ? (
            <p className="ofs-hint ofs-tool-blocked" role="status">{t(blockedKey)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
