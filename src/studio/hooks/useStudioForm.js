/**
 * 表单域：提示词 / 负向 / 预设 / 比例 / 风格 / 润色建议。
 *
 * 负责表单状态、预设同步 effect 与生成请求体拼装。
 * 依赖入参：{ t, isEn, alive, ui, preset, initialPrompt }；preset 是宿主的预设配置
 * { presets, defaultPreset }，由组合层从宿主状态解析后传入。
 */

import React from 'react'

import { enhancePromptRequest } from '../../api/resources.js'
import { buildGenerateBody } from '../../logic/generate.js'
import { detectCjk, presetNeedsEnglish, presetSelectPatch } from '../../logic/preset.js'
import { toggleStyle } from '../../logic/prompt.js'
import { isRefineApplied, refineSeparator, toggleRefineTerm } from '../../logic/refine.js'
import { DEFAULT_RATIOS, STYLE_CAPSULES, ratioToSize } from '../presets.js'

const EMPTY_FORM = {
  prompt: '',
  negative: '',
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

  // 预设同步：只在用户没手动改过时套用推荐值（初始预设同样回填 negativeHint）。
  React.useEffect(() => {
    if (presets.length === 0) return
    setForm((prev) => {
      if (prev.presetId && presets.some((item) => item.id === prev.presetId)) return prev
      const initial = presets.some((item) => item.id === defaultPreset) ? defaultPreset : presets[0].id
      const item = presets.find((option) => option.id === initial)
      if (!item) return prev
      return { ...prev, ...presetSelectPatch(item, prev, presets) }
    })
  }, [presets.length, defaultPreset])

  function patchForm(partial) {
    setForm((prev) => ({ ...prev, ...partial }))
  }

  /**
   * 切换预设：套用推荐尺寸 / 步数 / 引导强度，并在负向提示词为空
   * 或仍是上一个预设的推荐值时跟随新预设的 negativeHint。
   */
  function selectPreset(next) {
    if (!next || !next.id) return
    setForm((prev) => ({ ...prev, ...presetSelectPatch(next, prev, presets) }))
  }

  function buildBody(overrides) {
    return buildGenerateBody(form, { styleSuffix, defaultPreset, overrides })
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
    refineGroups: refineGroups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option, applied: isRefineApplied(form.prompt, option.text) })),
    })),
    refineSource,
    enhancing,
    enhance,
    toggleRefine,
    useInspiration,
  }
}