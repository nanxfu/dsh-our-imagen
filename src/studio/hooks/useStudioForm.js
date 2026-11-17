/**
 * 表单域：提示词 / 负向 / 预设 / 画幅比例 / 润色与英译。
 *
 * 负责表单状态、预设同步 effect 与生成请求体拼装。
 * 依赖入参：{ t, isEn, alive, ui, preset, initialPrompt }；preset 是宿主的预设配置
 * { presets, defaultPreset }，由组合层从宿主状态解析后传入。
 *
 * 0.10.0：删除风格与风格后缀；排除项是否可用统一由 shared/models-guide.js 的
 * `negativePromptActive()` 判定，展示与提交用同一个布尔值。
 *
 * 0.13.0：参考图 / 蒙版 / 重绘强度整块迁到舞台图片工具（`useImageTool`），
 * 这里只剩纯文生图状态；请求体不再产出 reference 字段。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'
import { negativePromptActive } from '../../../shared/models-guide.js'

import { enhancePromptRequest } from '../../api/resources.js'
import { clampInt, clampNumber } from '../../logic/clamp.js'
import { formSnapshotOf, isFormDirty, newCreationPatch } from '../../logic/form.js'
import { buildGenerateBody } from '../../logic/generate.js'
import {
  customSizePatch,
  detectCjk,
  hintOf,
  presetNeedsEnglish,
  presetSelectPatch,
  ratioIdOf,
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
    setForm((prev) => applyNegativePatch(prev, presetSelectPatch(next, prev, presets)))
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
   * 回填属于「刚从另一张图加载完」，本身不算手动修改，所以同时更新干净基准。
   * 参考图与蒙版不在主表单上，回填不会影响舞台工具域里的草稿。
   */
  function applyRecall(patch, entry) {
    const partial = patch && typeof patch === 'object' ? { ...patch } : {}
    if (Object.keys(partial).length === 0) return false
    const next = applyNegativePatch(formRef.current, partial)
    setForm(next)
    setCleanBaseline(formSnapshotOf(next))
    setTuning(tuningSourceOf(entry, next.prompt))
    return true
  }

  /**
   * 新建创作：清空提示词 / 固定种子，负向层回到当前预设默认推荐状态。
   *
   * 当前模型预设与画幅比例是下一张仍要用的常用设置，保留不动；微调来源与 dirty 一起清掉。
   */
  function newCreation() {
    const next = applyNegativePatch(formRef.current, newCreationPatch(formRef.current, activePreset))
    setForm(next)
    setCleanBaseline(formSnapshotOf(next))
    setTuning(null)
    ui.showToast(t('studio.toast.newCreation'))
  }

  /**
   * 拼装生成请求体（纯文生图）。
   *
   * `options.preset` 指定本次请求的有效预设（专用局部重绘预设的兜底切换）：
   * 预设 id 与负向词门控都按有效预设判断，但左栏表单本身不变。
   */
  function buildBody(overrides, options = {}) {
    const presetOverride = options.preset && typeof options.preset === 'object' ? options.preset : null
    const effectivePreset = presetOverride || activePreset
    const effectiveCfg = overrides && Object.prototype.hasOwnProperty.call(overrides, 'cfg')
      ? overrides.cfg
      : form.cfg
    // 提交值以两层合并结果为准，并按 negativeActive 门控（不可用时置空串）。
    return buildGenerateBody(
      {
        ...form,
        presetId: effectivePreset ? effectivePreset.id : form.presetId,
        negative: negativePromptOf(form),
      },
      {
        defaultPreset,
        overrides,
        negativeActive: negativePromptActive(effectivePreset, effectiveCfg),
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
