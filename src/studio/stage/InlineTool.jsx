/**
 * 整图重绘条（img2img 的 inline 形态）。
 *
 * 不切画布：保留目标图片预览（`.ofs-inline-stage > img.ofs-print`），
 * 下方接一条轻量的 `ToolSubmitBar`（提示词 / 强度 / 预设 / 生成）。
 * 目标作品宽高缺失时按 1:1 陈列，真正的请求宽高由 `buildImageToolBody` 用预设 size 兜底。
 */

import React from 'react'

import { referenceFileName } from '../../logic/generate.js'

import { ToolSubmitBar } from './ToolSubmitBar.jsx'

/** 正数比例；宽高缺失时回落到正方形画幅。 */
function ratioOf(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1
  return w / h
}

export function InlineTool(props) {
  const {
    t,
    target,
    tool,
    presets,
    presetId,
    onPresetChange,
    prompt,
    onPromptChange,
    strength,
    strengthMax,
    onStrengthChange,
    submitting,
    canSubmit,
    blockedKey,
    onSubmit,
    onExit,
  } = props
  if (!target || !target.path) return null
  const list = Array.isArray(presets) ? presets : []
  const ratio = ratioOf(target.width, target.height)
  const promptPlaceholder = target.prompt || t('studio.imageTool.promptPlaceholder')
  return (
    <div className="ofs-inline-tool">
      <div className="ofs-inline-stage" style={{ '--ofs-print-r': String(ratio) }}>
        <img
          src={target.url}
          alt={target.prompt || referenceFileName(target.path) || t('studio.image.alt')}
          className="ofs-print"
          style={{ '--ofs-print-r': String(ratio) }}
          draggable={false}
        />
      </div>
      <ToolSubmitBar
        t={t}
        tool={tool}
        presets={list}
        presetId={presetId}
        onPresetChange={onPresetChange}
        prompt={prompt}
        onPromptChange={onPromptChange}
        promptPlaceholder={promptPlaceholder}
        strength={strength}
        strengthMax={strengthMax}
        onStrengthChange={onStrengthChange}
        maskCoverage={undefined}
        submitting={submitting}
        canSubmit={canSubmit}
        blockedKey={blockedKey}
        onSubmit={onSubmit}
        onExit={onExit}
      />
    </div>
  )
}
