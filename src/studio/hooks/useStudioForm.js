/**
 * 表单域：提示词 / 负向 / 预设 / 比例与分辨率档位 / 参考图与重绘强度 / 润色与英译。
 *
 * 负责表单状态、预设同步 effect 与生成请求体拼装。
 * 依赖入参：{ t, isEn, alive, ui, preset, initialPrompt }；preset 是宿主的预设配置
 * { presets, defaultPreset }，由组合层从宿主状态解析后传入。
 *
 * 0.10.0：删除风格与风格后缀；排除项是否可用统一由 shared/models-guide.js 的
 * `negativePromptActive()` 判定，展示与提交用同一个布尔值。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'
import { negativePromptActive } from '../../../shared/models-guide.js'

import { enhancePromptRequest } from '../../api/resources.js'
import { clampInt, clampNumber, clampStrength } from '../../logic/clamp.js'
import { buildGenerateBody } from '../../logic/generate.js'
import {
  customSizePatch,
  detectCjk,
  presetNeedsEnglish,
  presetSelectPatch,
  ratioIdOf,
  referencePresetOf,
  selectedTierOf,
  sizeTiersOf,
  supportsImg2Img,
  tierPatchOf,
} from '../../logic/preset.js'
import {
  applyNegativePatch,
  negativeLayersPatch,
  negativePromptOf,
  resolveNegativeLayers,
  translateOutcomeOf,
} from '../../logic/prompt.js'
import { isRefineApplied, refineSeparator, toggleRefineTerm } from '../../logic/refine.js'
import { DEFAULT_RATIOS, ratioToSize } from '../presets.js'

const EMPTY_FORM = {
  prompt: '',
  negative: '',
  // 负向提示词的两层来源：模型推荐 / 用户手写，合并结果见 negative。
  negativeLayers: { model: '', user: '' },
  presetId: '',
  width: 1024,
  height: 1024,
  steps: 4,
  cfg: 0,
  seed: '',
  count: 1,
  // 图生图：参考图来自画廊「以此图重绘」（{ path, url, width?, height? }），strength 是重绘强度。
  reference: null,
  strength: LIMITS.strength.default,
}

/** 画廊条目 image → 参考图槽位数据；宽高可缺省（旧记录只有路径）。 */
function referenceOf(image, path) {
  const next = { path, url: image && typeof image.url === 'string' ? image.url : '' }
  const width = Number(image && image.width)
  const height = Number(image && image.height)
  if (Number.isFinite(width) && width > 0) next.width = Math.round(width)
  if (Number.isFinite(height) && height > 0) next.height = Math.round(height)
  return next
}

/** 当前预设推荐的负向词；没有则空串。 */
function hintOf(preset) {
  return preset && typeof preset.negativeHint === 'string' ? preset.negativeHint.trim() : ''
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

  // 比例由当前尺寸反推（按约分后的长宽比，而不是像素精确相等）：
  // 768×768 与 1024×1024 都算 1:1，800×600 算 4:3；切换预设改变宽高时也不会停在旧值上。
  const ratioId = ratioIdOf(form.width, form.height)

  // 当前预设是负向词能力、尺寸档位与提示词书写口径的唯一来源。
  const activePreset = presets.find((item) => item.id === form.presetId) || null
  const negativeHint = hintOf(activePreset)
  const negativeActive = negativePromptActive(activePreset, form.cfg)
  // 当前预设决定提示词的书写口径；含中文提示时给一条软提示，不拦截生成。
  const englishPromptHint = detectCjk(form.prompt) && presetNeedsEnglish(activePreset)

  // 分辨率档位按「长边」定义：档位来自预设的 sizeOptions，短边跟随当前画幅比例换算。
  const sizeTiers = sizeTiersOf(activePreset)
  const selectedTier = selectedTierOf(form.width, form.height, sizeTiers)

  // 图生图能力只在有参考图时才起作用：旧宿主缺 supportsImg2Img 按不支持处理，
  // 但没有参考图时不做任何判断，文生图流程与改造前完全一致。
  const reference = form.reference || null
  const referenceSupported = supportsImg2Img(activePreset)
  // 预设列表还没拿到时不做拦截，交给宿主判断，避免启动瞬间误拦文生图。
  const referenceBlocked = Boolean(reference && presets.length > 0 && !referenceSupported)

  // 预设同步：只在用户没手动改过时套用推荐值（初始预设同样回填负向模型层）。
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

  /** 切换预设：套用推荐尺寸 / 步数 / 引导强度，并按负向能力整层替换模型负向词。 */
  function selectPreset(next) {
    if (!next || !next.id) return
    setForm((prev) => applyNegativePatch(prev, presetSelectPatch(next, prev, presets)))
  }

  function buildBody(overrides) {
    // 提交值以两层合并结果为准，并按 negativeActive 门控（不可用时置空串）。
    return buildGenerateBody(
      { ...form, negative: negativePromptOf(form) },
      { defaultPreset, overrides, negativeActive },
    )
  }

  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id)
    if (!ratio) return
    const size = ratioToSize(ratio)
    patchForm({ width: size.width, height: size.height })
  }

  /**
   * 分辨率档位：长边取档位，短边按当前画幅比例换算。
   * 当前尺寸已是自定义比例（匹配不上契约比例）时按现有宽高比缩放。
   */
  function applyTier(tier) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === ratioId)
      || { width: form.width, height: form.height }
    patchForm(tierPatchOf(ratio, tier))
  }

  /**
   * 引导强度：写入 CFG；当它把负向词从「不可用」抬到「可用」且模型层为空时，
   * 自动补上当前模型推荐的负向词，用户不必自己再找一遍。
   */
  function applyCfg(value) {
    const next = clampNumber(value, LIMITS.cfg.min, LIMITS.cfg.max, form.cfg)
    setForm((prev) => {
      const current = presets.find((item) => item.id === prev.presetId) || null
      const patch = { cfg: next }
      const wasActive = negativePromptActive(current, prev.cfg)
      const isActive = negativePromptActive(current, next)
      if (!wasActive && isActive) {
        const layers = resolveNegativeLayers(prev, presets)
        const hint = hintOf(current)
        if (!layers.model && hint) Object.assign(patch, negativeLayersPatch({ ...layers, model: hint }))
      }
      return applyNegativePatch(prev, patch)
    })
  }

  /** 恢复随机种子：清空输入，提交时按未指定种子处理。 */
  function resetSeed() {
    patchForm({ seed: '' })
  }

  /**
   * 带回参数面板：把对话确认卡上的内容写进表单。
   *
   * - prompt 为空时不做任何改动，返回 false（调用方给可见提示）；
   * - 比例命中契约比例才覆盖宽高，其余字段不受影响；
   * - 张数按契约钳制到 1~4，缺省 1；
   * - 排除项只在当前模型/CFG 真的可用时写入，避免写进一个永远不会提交的字段。
   */
  function applyIntent(intent) {
    if (!intent || typeof intent !== 'object') return false
    const prompt = typeof intent.prompt === 'string' ? intent.prompt.trim().slice(0, LIMITS.prompt.maxChars) : ''
    if (!prompt) return false
    const patch = {
      prompt,
      count: clampInt(intent.count, LIMITS.count.min, LIMITS.count.max, 1),
    }
    const ratio = DEFAULT_RATIOS.find((item) => item.id === intent.ratioId)
    if (ratio) {
      const size = ratioToSize(ratio)
      patch.width = size.width
      patch.height = size.height
    }
    if (negativeActive && typeof intent.negative === 'string') {
      patch.negative = intent.negative.trim().slice(0, LIMITS.negativePrompt.maxChars)
    }
    patchForm(patch)
    return true
  }

  /** 自定义宽/高输入：只改对应一边，边界与步长由 customSizePatch 钳制。 */
  function applyCustomSize(partial) {
    patchForm(customSizePatch(partial))
  }

  /** 重绘强度：滑块本身按契约 step 取值，这里再兜一次边界与浮点噪声。 */
  function applyStrength(value) {
    patchForm({ strength: clampStrength(value) })
  }

  /** 移除参考图：后续生成回到纯文生图，当前预设保持用户选择不变。 */
  function removeReference() {
    patchForm({ reference: null })
  }

  /**
   * 以此图重绘：把画廊条目设为参考图。
   *
   * - 当前预设支持图生图：只写入参考图；
   * - 不支持：自动切到支持图生图的预设（优先 `sdxl-lightning`）并套用其推荐参数，
   *   返回 switchedPreset 供组合层 toast；
   * - 一个支持的预设都没有（旧宿主）：什么都不改，返回失败让组合层明确提示。
   *
   * 参考图取 `image.path`（提交用）、`image.url`（缩略图）与 `image.width/height`
   * （「出图尺寸跟随参考图」读数）；path 缺失时按失败处理。
   */
  function applyReference(entry) {
    const image = entry && entry.image ? entry.image : null
    const path = image && typeof image.path === 'string' ? image.path.trim() : ''
    if (!path) return { ok: false, switchedPreset: null, reason: 'no_path' }
    const referencePatch = referenceOf(image, path)
    const active = presets.find((item) => item.id === form.presetId) || null
    if (supportsImg2Img(active)) {
      patchForm({ reference: referencePatch })
      return { ok: true, switchedPreset: null, reason: '' }
    }
    const target = referencePresetOf(presets)
    if (!target) return { ok: false, switchedPreset: null, reason: 'unsupported' }
    // 换预设与写参考图合成一次提交：尺寸 / 步数 / 负向词与参考图同时到位。
    setForm((prev) => applyNegativePatch(prev, {
      ...presetSelectPatch(target, prev, presets),
      reference: referencePatch,
    }))
    return { ok: true, switchedPreset: target, reason: '' }
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

  /** 灵感预设：提示词为空时直接填入（Rail 只在空提示词时展示这些入口）。 */
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
    activePreset,
    // 排除项：是否可用 / 模型推荐词（供显隐、占位与配置抬升时自动补词）。
    negativeActive,
    negativeHint,
    negativeLayers: form.negativeLayers,
    englishPromptHint,
    applyRatio,
    // 分辨率档位（长边）与自定义宽高。
    sizeTiers,
    selectedTier,
    applyTier,
    applyCustomSize,
    applyCfg,
    resetSeed,
    applyIntent,
    // 图生图：参考图 / 重绘强度与它们的能力判断、动作。
    reference,
    strength: clampStrength(form.strength),
    referenceSupported,
    referenceBlocked,
    applyStrength,
    removeReference,
    applyReference,
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
