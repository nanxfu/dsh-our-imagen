/**
 * 表单域：提示词 / 负向 / 预设 / 比例 / 方形尺寸 / 风格 / 润色与英译。
 *
 * 负责表单状态、预设同步 effect 与生成请求体拼装。
 * 依赖入参：{ t, isEn, alive, ui, preset, initialPrompt }；preset 是宿主的预设配置
 * { presets, defaultPreset }，由组合层从宿主状态解析后传入。
 */

import React from 'react'

import { enhancePromptRequest } from '../../api/resources.js'
import { clampSize } from '../../logic/clamp.js'
import { buildGenerateBody } from '../../logic/generate.js'
import {
  customSizePatch,
  detectCjk,
  presetNeedsEnglish,
  presetSelectPatch,
  presetSizeOptions,
} from '../../logic/preset.js'
import { applyNegativePatch, negativePromptOf, toggleStyle, translateOutcomeOf } from '../../logic/prompt.js'
import { isRefineApplied, refineSeparator, toggleRefineTerm } from '../../logic/refine.js'
import { DEFAULT_RATIOS, STYLE_CAPSULES, ratioToSize } from '../presets.js'

const EMPTY_FORM = {
  prompt: '',
  negative: '',
  // 负向提示词的三层来源：模型推荐 / 风格自带 / 用户手写，合并结果见 negative。
  negativeLayers: { model: '', style: '', user: '' },
  presetId: '',
  width: 1024,
  height: 1024,
  steps: 4,
  cfg: 0,
  seed: '',
  count: 1,
  styleId: '',
}

export function useStudioForm({ t, isEn, alive, ui, preset, initialPrompt }) {
  const { presets, defaultPreset } = preset
  const [form, setForm] = React.useState(() => ({
    ...EMPTY_FORM,
    prompt: initialPrompt,
  }))
  const [refineGroups, setRefineGroups] = React.useState([])
  const [refineSource, setRefineSource] = React.useState('')
  const [enhancing, setEnhancing] = React.useState(false)
  const [translating, setTranslating] = React.useState(false)

  // 比例由当前尺寸反推：切换预设改变宽高时，比例按钮不会停在旧值上。
  const ratioId = (() => {
    const match = DEFAULT_RATIOS.find((ratio) => {
      const size = ratioToSize(ratio)
      return size.width === form.width && size.height === form.height
    })
    return match ? match.id : ''
  })()

  const styleSuffix = (() => {
    const capsule = STYLE_CAPSULES.find((item) => item.id === form.styleId)
    return capsule ? capsule.suffix : ''
  })()

  // 当前预设决定提示词的书写口径；含中文提示时给一条软提示，不拦截生成。
  const activePreset = presets.find((item) => item.id === form.presetId) || null
  const englishPromptHint = detectCjk(form.prompt) && presetNeedsEnglish(activePreset)

  // 方形尺寸档位来自当前预设的 sizeOptions；与画幅比例是两行不同的概念。
  const sizeOptions = presetSizeOptions(activePreset)
  // 选中态由尺寸反推：只有精确等于某一档且宽高相等时才高亮，和比例行天然一致。
  const selectedSize = form.width === form.height && sizeOptions.includes(form.width) ? form.width : null

  // 预设同步：只在用户没手动改过时套用推荐值（初始预设同样回填 negativeHint 层）。
  React.useEffect(() => {
    if (presets.length === 0) return
    setForm((prev) => {
      if (prev.presetId && presets.some((item) => item.id === prev.presetId)) return prev
      const initial = presets.some((item) => item.id === defaultPreset) ? defaultPreset : presets[0].id
      const item = presets.find((option) => option.id === initial)
      if (!item) return prev
      return applyNegativePatch(prev, presetSelectPatch(item, prev, presets))
    })
  }, [presets.length, defaultPreset])

  /** 表单补丁统一入口：负向层数据与展示文本在这里保持同步。 */
  function patchForm(partial) {
    setForm((prev) => applyNegativePatch(prev, partial))
  }

  /** 切换预设：套用推荐尺寸 / 步数 / 引导强度，并整层替换模型负向词。 */
  function selectPreset(next) {
    if (!next || !next.id) return
    setForm((prev) => applyNegativePatch(prev, presetSelectPatch(next, prev, presets)))
  }

  function buildBody(overrides) {
    // 提交值以三层合并结果为准，避免展示文本与层数据脱节时发错负向词。
    return buildGenerateBody(
      { ...form, negative: negativePromptOf(form) },
      { styleSuffix, defaultPreset, overrides },
    )
  }

  function applyStyle(capsuleId) {
    const capsule = STYLE_CAPSULES.find((item) => item.id === capsuleId)
    if (!capsule) return
    setForm((prev) => toggleStyle(prev, capsule))
  }

  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id)
    if (!ratio) return
    const size = ratioToSize(ratio)
    patchForm({ width: size.width, height: size.height })
  }

  /** 方形尺寸档位：宽高同时设为该值。 */
  function applySize(size) {
    const value = clampSize(size)
    patchForm({ width: value, height: value })
  }

  /** 自定义宽/高输入：只改对应一边，边界与步长由 customSizePatch 钳制。 */
  function applyCustomSize(partial) {
    patchForm(customSizePatch(partial))
  }

  async function enhance() {
    if (enhancing) return
    if (!form.prompt.trim()) {
      ui.showToast(t('studio.promptHint'))
      return
    }
    setEnhancing(true)
    try {
      const result = await alive(enhancePromptRequest({
        prompt: form.prompt,
        presetId: form.presetId,
        locale: isEn ? 'en' : 'zh',
      }))
      if (!result) return
      if (result.ok && result.data && Array.isArray(result.data.groups)) {
        // 服务端保证 text（英文短语）与 label（UI 语言标签）；这里再兜一层，避免旧宿主缺字段时界面渲染空白。
        const groups = result.data.groups
          .filter((group) => group && Array.isArray(group.options))
          .map((group) => ({
            ...group,
            options: group.options
              .map((option) => {
                const text = option && typeof option.text === 'string' ? option.text.trim() : ''
                if (!text) return null
                const label = option && typeof option.label === 'string' && option.label.trim() ? option.label.trim() : text
                return { ...option, text, label }
              })
              .filter(Boolean),
          }))
          .filter((group) => group.options.length > 0)
        setRefineGroups(groups)
        setRefineSource(result.data.source === 'model' ? 'model' : 'local')
        return
      }
      ui.fail(result.code, result.message)
    } finally {
      // 卸载时 alive 返回 null 会提前 return，这里保证按钮的 loading 状态一定复位。
      setEnhancing(false)
    }
  }

  /**
   * 一键英译：把当前提示词交给宿主模型翻译。
   *
   * `source='local'` 表示宿主模型不可用、请求被本地兜底处理（prompt 还是原文）：
   * 必须明确提示「没有真正翻译」，不能把原文替换回表单假装成功。
   */
  async function translate() {
    if (translating) return
    if (!form.prompt.trim()) {
      ui.showToast(t('studio.promptHint'))
      return
    }
    setTranslating(true)
    try {
      const result = await alive(enhancePromptRequest({
        prompt: form.prompt,
        presetId: form.presetId,
        locale: isEn ? 'en' : 'zh',
        mode: 'translate',
      }))
      if (!result) return
      if (!result.ok) {
        ui.fail(result.code, result.message)
        return
      }
      const outcome = translateOutcomeOf(result.data)
      // 旧宿主可能忽略 mode、或模型不可用退回本地：都按「未翻译」明确提示，不改表单。
      if (!outcome.ok) {
        ui.showToast(t('studio.translate.local'))
        return
      }
      patchForm({ prompt: outcome.prompt })
      ui.showToast(t('studio.translate.done'))
    } finally {
      setTranslating(false)
    }
  }

  /** 润色标签：点一次追加，再点一次撤销。 */
  function toggleRefine(term) {
    patchForm({ prompt: toggleRefineTerm(form.prompt, term, refineSeparator(form.prompt)) })
  }

  /** 灵感预设：输入框为空时直接填入，已有内容时换行追加。 */
  function useInspiration(text) {
    const value = String(text ?? '').trim()
    if (!value) return
    const base = form.prompt.trim()
    patchForm({ prompt: base ? `${base}\n${value}` : value })
  }

  return {
    form,
    patchForm,
    selectPreset,
    buildBody,
    ratioId,
    styleId: form.styleId,
    englishPromptHint,
    applyStyle,
    applyRatio,
    sizeOptions,
    selectedSize,
    applySize,
    applyCustomSize,
    negativeLayers: form.negativeLayers,
    refineGroups: refineGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option, applied: isRefineApplied(form.prompt, option.text) })),
    })),
    refineSource,
    enhancing,
    enhance,
    translating,
    translate,
    toggleRefine,
    useInspiration,
  }
}
