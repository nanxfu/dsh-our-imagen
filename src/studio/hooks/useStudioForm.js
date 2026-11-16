/**
 * 表单域：提示词 / 负向 / 预设 / 画幅比例 / 参考图与重绘强度 / 润色与英译。
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
import { clampInt, clampNumber } from '../../logic/clamp.js'
import { formSnapshotOf, isFormDirty, newCreationPatch } from '../../logic/form.js'
import { buildGenerateBody } from '../../logic/generate.js'
import {
  clampMaskStrength,
  maskDigestOf,
  maskExportVerdict,
  maskStateOf,
  maskStrengthPatch,
  maskStrengthPresetPatch,
  referenceMaskOf,
  referenceWithoutMask,
  strengthMaxOf,
} from '../../logic/mask.js'
import {
  customSizePatch,
  detectCjk,
  hintOf,
  inpaintOnlyOf,
  presetNeedsEnglish,
  presetSelectPatch,
  ratioIdOf,
  referencePresetOf,
  supportsImg2Img,
  supportsInpaint,
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
  // 局部重绘的蒙版挂在 `reference.mask`（{ data, coverage, digest }）上，换/移除参考图时一起清掉。
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

/** 微调来源提示用的一句描述：优先作品提示词，没有提示词时退回文件名。 */
function tuningSourceOf(entry, prompt) {
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (text) return { prompt: text }
  const image = entry && entry.image ? entry.image : null
  const file = image && typeof image.file === 'string' ? image.file.trim() : ''
  return { prompt: file }
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
  // 重绘强度是否处于自动档：进入涂抹时按当前预设套用推荐档，用户手调后退出；
  // 自动档下切换预设会跟随新预设的推荐档，手调过的值保持不动。
  const [strengthAuto, setStrengthAuto] = React.useState(false)
  // 干净基准快照：最近一次「生成提交 / 从作品回填 / 新建创作 / 初始预设同步」时的表单，
  // 与当前表单不一致即为 dirty（胶卷点击时据此保护草稿）。
  const [cleanBaseline, setCleanBaseline] = React.useState('')
  // 微调来源：当前表单是哪张作品回填来的；新建创作时清空。只用于面板的轻量提示。
  const [tuning, setTuning] = React.useState(null)
  // 事件回调里要读最新表单（不依赖渲染闭包），异步动作与快照计算都用它。
  const formRef = React.useRef(form)
  formRef.current = form
  const dirty = isFormDirty(form, cleanBaseline)

  // 比例由当前尺寸反推（按约分后的长宽比，而不是像素精确相等）：
  // 768×768 与 1024×1024 都算 1:1，800×600 算 4:3；切换预设改变宽高时也不会停在旧值上。
  const ratioId = ratioIdOf(form.width, form.height)

  // 当前预设是负向词能力与提示词书写口径的唯一来源。
  const activePreset = presets.find((item) => item.id === form.presetId) || null
  const negativeHint = hintOf(activePreset)
  const negativeActive = negativePromptActive(activePreset, form.cfg)
  // 当前预设决定提示词的书写口径；含中文提示时给一条软提示，不拦截生成。
  const englishPromptHint = detectCjk(form.prompt) && presetNeedsEnglish(activePreset)

  // 图生图能力只在有参考图时才起作用：旧宿主缺 supportsImg2Img 按不支持处理，
  // 但没有参考图时不做任何判断，文生图流程与改造前完全一致。
  const reference = form.reference || null
  const referenceSupported = supportsImg2Img(activePreset)
  // 预设列表还没拿到时不做拦截，交给宿主判断，避免启动瞬间误拦文生图。
  const referenceBlocked = Boolean(reference && presets.length > 0 && !referenceSupported)

  // 局部重绘能力与蒙版：蒙版挂在参考图上，没有参考图时不可能有蒙版。
  // 旧宿主 / 非 SDXL 家族缺 supportsInpaint 时按不支持处理，Stage 只显示说明、不显示涂抹入口。
  const inpaintSupported = supportsInpaint(activePreset)
  const mask = referenceMaskOf(reference)
  // 有能力但有蒙版却切到了不支持的模型：保留蒙版不静默丢弃，本次提交按整图重绘处理。
  const maskBlocked = Boolean(mask && presets.length > 0 && !inpaintSupported)
  // 专用局部重绘模型（9 通道 inpaint 权重）：只能带蒙版使用，不能文生图 / 纯图生图。
  const inpaintOnly = inpaintOnlyOf(activePreset)
  const maskRequiredBlocked = inpaintOnly && !mask

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

  // 预设同步落定后建立干净基准：启动瞬间的空表单与随后套用的推荐值都算「未改过」。
  // 之后基准只在生成提交、作品回填、新建创作时更新，手动修改不再动它。
  React.useEffect(() => {
    if (cleanBaseline || !form.presetId) return
    setCleanBaseline(formSnapshotOf(form))
  }, [cleanBaseline, form.presetId])

  /** 表单补丁统一入口：负向层数据与展示文本在这里保持同步。 */
  function patchForm(partial) {
    setForm((prev) => applyNegativePatch(prev, partial))
  }

  /** 切换预设：套用推荐尺寸 / 步数 / 引导强度，并按负向能力整层替换模型负向词。 */
  function selectPreset(next) {
    if (!next || !next.id) return
    setForm((prev) => {
      const patch = presetSelectPatch(next, prev, presets)
      // 强度自动档跟随新预设的推荐档；用户手调过的值保持不动。
      const strengthPatch = maskStrengthPresetPatch(strengthAuto, { native: inpaintOnlyOf(next) })
      if (strengthPatch) Object.assign(patch, strengthPatch)
      return applyNegativePatch(prev, patch)
    })
  }

  /**
   * 生成提交成功：把当前表单记为新的干净基准。
   *
   * 传入提交时的表单对象时先做一次同一性检查：等待期间用户若继续改表单（React 每次
   * 修改都会产生新对象），新改动没有提交，仍是 dirty，不能被这次成功提示洗白。
   */
  function markClean(submitted) {
    if (submitted && formRef.current !== submitted) return false
    setCleanBaseline(formSnapshotOf(formRef.current))
    return true
  }

  /**
   * 从作品回填（胶卷点击 / 画廊「带回参数」）：套用纯逻辑算好的补丁并记录微调来源。
   *
   * 回填属于「刚从另一张图加载完」，本身不算手动修改，所以同时更新干净基准；
   * 补丁里的 `reference: null` 负责清掉上一轮残留的参考图。
   */
  function applyRecall(patch, entry) {
    const partial = patch && typeof patch === 'object' ? { ...patch } : {}
    if (Object.keys(partial).length === 0) return false
    // 回填是整块替换参考图：上一轮涂抹的蒙版不能跟到新作品的参数里。
    if (Object.prototype.hasOwnProperty.call(partial, 'reference')) {
      partial.reference = referenceWithoutMask(partial.reference)
    }
    const next = applyNegativePatch(formRef.current, partial)
    setForm(next)
    setCleanBaseline(formSnapshotOf(next))
    setTuning(tuningSourceOf(entry, next.prompt))
    return true
  }

  /**
   * 新建创作：清空提示词 / 参考图 / 固定种子，负向层回到当前预设默认推荐状态。
   *
   * 当前模型预设与画幅比例是下一张仍要用的常用设置，保留不动；微调来源与 dirty 一起清掉。
   */
  function newCreation() {
    const next = applyNegativePatch(formRef.current, newCreationPatch(formRef.current, activePreset))
    setForm(next)
    setCleanBaseline(formSnapshotOf(next))
    setTuning(null)
    // 新创作把强度重置回契约默认值：退出自动档，下次涂抹再按预设推荐档抬升。
    setStrengthAuto(false)
    ui.showToast(t('studio.toast.newCreation'))
  }

  /**
   * 拼装生成请求体。
   *
   * `options.preset` 指定本次请求的有效预设（重试恢复 / 兜底切换后的预设）：
   * 负向词门控与蒙版提交都按有效预设重新判断，避免用左栏当前预设误判。
   */
  function buildBody(overrides, options = {}) {
    const presetOverride = options.preset && typeof options.preset === 'object' ? options.preset : null
    const effectivePreset = presetOverride || activePreset
    const effectiveCfg = overrides && Object.prototype.hasOwnProperty.call(overrides, 'cfg')
      ? overrides.cfg
      : form.cfg
    // 提交值以两层合并结果为准，并按 negativeActive 门控（不可用时置空串）。
    // 局部重绘同理：有效预设不支持 Inpaint 时不提交蒙版，蒙版本身保留在表单里。
    return buildGenerateBody(
      { ...form, negative: negativePromptOf(form) },
      {
        defaultPreset,
        overrides,
        negativeActive: negativePromptActive(effectivePreset, effectiveCfg),
        maskActive: supportsInpaint(effectivePreset),
      },
    )
  }

  function applyRatio(id) {
    const ratio = DEFAULT_RATIOS.find((item) => item.id === id)
    if (!ratio) return
    const size = ratioToSize(ratio)
    patchForm({ width: size.width, height: size.height })
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

  /**
   * 重绘强度：滑块按契约 step 取值，这里再兜一次边界与浮点噪声。
   * 有蒙版时上限放宽到契约 inpaintMax（缺省回落通用 max），手调即退出自动档。
   */
  function applyStrength(value) {
    setStrengthAuto(false)
    patchForm({ strength: clampMaskStrength(value, Boolean(mask)) })
  }

  /**
   * 进入涂抹模式：把强度抬到局部重绘的推荐档。
   *
   * 真机验收结论：4 步极速模型在契约默认 0.6 下蒙版区改动偏弱，0.8 才有可见重写；
   * 专用 inpaint 权重（9 通道）需要 0.9 才会明显替换。自动档下无条件跟随推荐档，
   * 用户手调过的强度（且不等于契约默认值）保持不动，避免覆盖明确选择。
   */
  function beginMaskEdit() {
    const patch = maskStrengthPatch(formRef.current.strength, { native: inpaintOnly, auto: strengthAuto })
    if (!patch) return false
    setStrengthAuto(true)
    patchForm(patch)
    return true
  }

  /** 移除参考图：后续生成回到纯文生图，当前预设保持用户选择不变。 */
  function removeReference() {
    // reference 是整体置空：挂在上面的蒙版也一并清掉，不会残留到下一轮。
    patchForm({ reference: null })
  }

  /**
   * 应用涂抹蒙版：Stage 导出黑底白字 PNG base64 后写进 `reference.mask`。
   *
   * 返回值 `{ ok, reason }`：`no_reference` / `unsupported` / `empty` / `too_large` /
   * `invalid` 由 Stage 转成可见提示，不静默丢数据。
   * 当前模型不支持局部重绘时不写入：涂抹入口本来就不会出现，这里再兜一层兜底。
   */
  function applyMask(input) {
    const candidate = input && typeof input === 'object' ? input : { data: input }
    const currentReference = formRef.current.reference
    if (!currentReference || typeof currentReference !== 'object' || !currentReference.path) {
      return { ok: false, reason: 'no_reference' }
    }
    const currentPreset = presets.find((item) => item && item.id === formRef.current.presetId) || null
    if (!supportsInpaint(currentPreset)) return { ok: false, reason: 'unsupported' }
    const verdict = maskExportVerdict(candidate.data, candidate.coverage)
    if (!verdict.ok) return { ok: false, reason: verdict.reason }
    patchForm({
      reference: {
        ...currentReference,
        mask: {
          data: verdict.data,
          coverage: verdict.coverage,
          digest: maskDigestOf(verdict.data),
        },
      },
    })
    return { ok: true }
  }

  /** 清空蒙版：只去掉 reference.mask，参考图本身保留（本次回到整图重绘）。 */
  function clearMask() {
    const currentReference = formRef.current.reference
    if (!currentReference || typeof currentReference !== 'object' || !currentReference.mask) return false
    patchForm({ reference: referenceWithoutMask(currentReference) })
    return true
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
    // 草稿保护与微调来源：dirty 决定胶卷点击能否覆盖；tuning 给面板的来源提示。
    dirty,
    tuning,
    markClean,
    applyRecall,
    newCreation,
    // 排除项：是否可用 / 模型推荐词（供显隐、占位与配置抬升时自动补词）。
    negativeActive,
    negativeHint,
    negativeLayers: form.negativeLayers,
    englishPromptHint,
    applyRatio,
    applyCustomSize,
    applyCfg,
    resetSeed,
    applyIntent,
    // 图生图：参考图 / 重绘强度与它们的能力判断、动作。
    reference,
    strength: clampMaskStrength(form.strength, Boolean(mask)),
    // 强度滑块上限：有蒙版时用契约 inpaintMax（局部重绘允许更强替换），否则通用 max。
    strengthMax: strengthMaxOf(Boolean(mask)),
    // 强度是否处于自动档：自动档下切预设跟随推荐档，用户手调后为 false。
    strengthAuto,
    referenceSupported,
    referenceBlocked,
    applyStrength,
    removeReference,
    applyReference,
    // 局部重绘：蒙版挂在参考图上；能力判断、当前蒙版与写入/清空动作。
    mask,
    inpaintSupported,
    inpaintOnly,
    maskBlocked,
    maskRequiredBlocked,
    applyMask,
    clearMask,
    beginMaskEdit,
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
