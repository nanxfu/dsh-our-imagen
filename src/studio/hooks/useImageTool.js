/**
 * 舞台图片工具的状态域（阶段十二方案 B）。
 *
 * 把「针对当前作品的二次处理」从文生图主表单里彻底抽离：这里的提示词、预设、
 * 强度、蒙版与底图都只属于工具自己，**不回写左栏表单**，所以左栏永远能做纯文生图。
 * 纯逻辑（选模 / 强度档位 / 请求体 / 前置校验）在 `src/logic/imageTool.js`，
 * 画布交互在 `src/studio/stage/MaskEditor.jsx`，这里只做状态编排与提交。
 *
 * 关键行为（Lead 决策 D2 / D4 / D5）：
 *  - 底图在打开工具时绑定，不随胶片条预览切换；
 *  - 工具提示词默认空，提交时回退目标作品原提示词；
 *  - 提交失败保留底图 / 提示词 / 蒙版（收起编辑态，dock 可「继续编辑」）；
 *  - 提交成功清空草稿并回调 `onSubmitted(job, meta)`，`pendingTool` 留给阶段十三的幽灵节点。
 *
 * 阶段十三（D6）：在既有单草稿状态机旁边加一张按作品路径缓存的 `workDrafts` 表
 * （会话内内存、LRU 上限 8，含蒙版的草稿也算一条）。打开工具时优先恢复该作品的草稿，
 * 提交成功后清掉对应条目。既有 `draft` 字段语义与既有返回项全部保持不变，
 * 阶段十二写好的 Stage / useStudio 接线不需要任何改动。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'
import { negativePromptActive } from '../../../shared/models-guide.js'

import { submitGenerate } from '../../api/resources.js'
import { formatText } from '../../logic/format.js'
import { presetLabelOf, referenceUrlOf } from '../../logic/generate.js'
import {
  buildImageToolBody,
  imageToolBlockedKeyOf,
  imageToolOf,
  toolPresetOf,
  toolStrengthDefaultOf,
  toolStrengthMaxOf,
  workKeyOf,
} from '../../logic/imageTool.js'
import {
  DRAFT_LRU_LIMIT,
  draftKeyOf,
  lruDrafts,
  workDraftSummary as draftSummaryOf,
} from '../../logic/lineage.js'
import { clampMaskStrength, maskDigestOf, maskExportVerdict } from '../../logic/mask.js'

/** 空草稿：工具未打开、或提交成功后回到这个状态。 */
function emptyDraft() {
  return {
    toolId: '',
    target: null,
    prompt: '',
    strength: LIMITS.strength.default,
    strengthAuto: true,
    presetId: '',
    mask: null,
  }
}

/** 正数像素；缺失 / 非法返回 null（尺寸交给预设 size 兜底）。 */
function positiveSize(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

/**
 * 条目 / 图片 → 底图绑定对象。
 *
 * 兼容两种入参：胶卷与画廊条目 `{ image, item }`，以及裸 image 对象。
 * 提示词优先取作品自身的（真实 Host 的历史条目只保证 `item.prompt`），
 * 没有则空串；缩略图缺失时按 `/imagen-api/file?path=` 的同口径补出来。
 */
function targetOf(entry) {
  const holder = entry && typeof entry === 'object' ? entry : null
  if (!holder) return null
  const image = holder.image && typeof holder.image === 'object' ? holder.image : holder
  const path = typeof image.path === 'string' ? image.path.trim() : ''
  if (!path) return null
  const item = holder.item && typeof holder.item === 'object' ? holder.item : null
  const params = item && item.params && typeof item.params === 'object' ? item.params : null
  const ownPrompt = item && typeof item.prompt === 'string' ? item.prompt.trim() : ''
  const paramsPrompt = params && typeof params.prompt === 'string' ? params.prompt.trim() : ''
  const prompt = (ownPrompt || paramsPrompt).slice(0, LIMITS.prompt.maxChars)
  return {
    path,
    url: typeof image.url === 'string' && image.url ? image.url : referenceUrlOf(path),
    width: positiveSize(image.width),
    height: positiveSize(image.height),
    item,
    prompt,
  }
}

/** 工具当前可选的预设：只保留支持该工具能力的模型（inpaintOnly 不进整图重绘）。 */
function presetsForTool(list, tool) {
  if (!tool || !tool.capability) return []
  if (tool.id === 'inpaint') return list.filter((item) => item.supportsInpaint === true)
  if (tool.id === 'img2img') {
    return list.filter((item) => item.supportsImg2Img === true && item.inpaintOnly !== true)
  }
  return []
}

/**
 * 图片工具状态域。
 *
 * @param {object} input
 * @param {Function} input.t 翻译函数
 * @param {boolean} [input.isEn] 界面语言（保留给后续提示词增强，与提交无关）
 * @param {Function} input.alive 卸载边界：`await alive(request)` 卸载后返回 null
 * @param {object} input.ui 界面态域（showToast / fail / setError）
 * @param {Array<object>} input.presets 宿主下发的预设列表
 * @param {string} input.defaultPreset 宿主默认预设 id
 * @param {Function} [input.onSubmitted] 提交成功回调，收到响应里的 job 对象
 * @param {string} [input.currentPresetId] 左栏当前预设 id（可选）：工具优先沿用它
 */
export function useImageTool({ t, isEn, alive, ui, presets, defaultPreset, onSubmitted, currentPresetId }) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : []
  const [draft, setDraft] = React.useState(() => emptyDraft())
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  // 成功提交过的任务信息：失败重试恢复 / 阶段十三的幽灵节点从这里取底图与请求体。
  const [pendingTool, setPendingTool] = React.useState(null)
  // 事件回调里要读最新草稿（不依赖渲染闭包），风格与 useStudioForm 的 formRef 一致。
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  // 提交中的同步闸门：连续点击时 useState 的闭包可能还没刷新，用 ref 立即生效。
  const inFlightRef = React.useRef(false)

  // ── 阶段十三：按作品路径缓存的未提交编辑草稿（会话内内存，LRU 上限 8）──────
  //
  // 只做旁路存储：`draft` 仍是唯一的活动草稿来源，Stage / dock 读到的字段完全不变。
  // 每次草稿变化（每次 setDraft 都会产生新对象）同步写入映射；草稿没有实际改动时移除。
  const [workDrafts, setWorkDrafts] = React.useState({})
  // 每个作品「干净基线」的 { presetId, strength }：判断参数是否被用户改过，
  // 恢复草稿时沿用原基线，避免一打开就亮圆点。
  const baselinesRef = React.useRef({})

  const removeWorkDraft = (key) => {
    const path = draftKeyOf(key)
    if (!path) return
    delete baselinesRef.current[path]
    setWorkDrafts((prev) => {
      if (!prev[path]) return prev
      const next = { ...prev }
      delete next[path]
      return next
    })
  }

  React.useEffect(() => {
    const key = draftKeyOf(draft.target)
    if (!key) return
    const baseline = baselinesRef.current[key] || {}
    const changed = {
      mask: Boolean(draft.mask),
      prompt: draft.prompt.trim() !== '',
      params: draft.presetId !== baseline.presetId || draft.strength !== baseline.strength,
    }
    const active = changed.mask || changed.prompt || changed.params
    setWorkDrafts((prev) => {
      if (!active) {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return lruDrafts({
        ...prev,
        [key]: {
          tool: draft.toolId,
          prompt: draft.prompt,
          strength: draft.strength,
          strengthAuto: draft.strengthAuto,
          presetId: draft.presetId,
          mask: draft.mask,
          changed,
          lastTouchedAt: Date.now(),
        },
      }, DRAFT_LRU_LIMIT)
    })
    // draft 是唯一依赖：setWorkDrafts 不会反过来改 draft，不会形成循环。
  }, [draft])

  const activeTool = imageToolOf(draft.toolId)
  const preset = list.find((item) => item.id === draft.presetId) || null
  const toolPresets = presetsForTool(list, activeTool)
  const hasMask = Boolean(draft.mask)
  // 强度读数按「本次是否带蒙版」钳制：清空蒙版后上限回落到通用 max。
  const strength = clampMaskStrength(draft.strength, hasMask)
  const strengthMax = toolStrengthMaxOf(draft.toolId, hasMask)
  const coverage = draft.mask ? draft.mask.coverage : 0
  const blockedKey = imageToolBlockedKeyOf({
    tool: draft.toolId,
    targetPath: draft.target ? draft.target.path : '',
    preset,
    prompt: draft.prompt,
    targetPrompt: draft.target ? draft.target.prompt : '',
    mask: draft.mask,
  })
  const canSubmit = Boolean(activeTool && activeTool.ready && draft.target) && blockedKey === '' && !submitting

  function setPrompt(value) {
    const text = String(value ?? '').slice(0, LIMITS.prompt.maxChars)
    setDraft((prev) => (prev.prompt === text ? prev : { ...prev, prompt: text }))
  }

  /**
   * 打开工具：把 entry 绑定为底图并进入编辑态。
   *
   * - 未开放的工具（upscale / outpaint）直接拒绝并提示「规划中」；
   * - 自动选模：优先沿用当前预设（工具草稿 → 左栏当前预设 → 宿主默认预设），
   *   不支持时切到工具兜底预设并 toast 说明，**不改左栏表单**；
   * - 同一作品同一工具再次打开时恢复草稿；换作品 / 换工具重置草稿。
   *
   * @param {'inpaint'|'img2img'|object} kind 工具 id（也接受描述符）
   * @param {object} entry 胶卷 / 画廊条目 `{ image, item }` 或裸 image
   * @returns {boolean} 是否成功进入编辑态
   */
  function openTool(kind, entry) {
    if (inFlightRef.current) return false
    const tool = imageToolOf(typeof kind === 'string' ? kind : kind && kind.id)
    if (!tool) return false
    if (!tool.ready) {
      const key = tool.plannedKey || 'studio.imageTool.planned'
      ui.showToast(formatText(t(key), { tool: t(tool.labelKey) }))
      return false
    }
    const target = targetOf(entry)
    if (!target) {
      ui.showToast(t('studio.imageTool.blockedTarget'))
      return false
    }
    const previous = draftRef.current
    const workKey = draftKeyOf(target)
    // 阶段十三：同一作品优先恢复 workDrafts 里的草稿（关闭编辑态 / 切到别的作品再回来都不丢）。
    const saved = workKey ? workDrafts[workKey] : null
    const restored = saved && saved.tool === tool.id ? saved : null
    const sameWork = Boolean(previous.target && workKeyOf(previous.target) === workKeyOf(target))
    const sameTool = !restored && sameWork && previous.toolId === tool.id
    // 恢复草稿时沿用上次工具预设；否则按「左栏当前预设 → 宿主默认预设」重新选模。
    const savedPreset = restored ? list.find((item) => item.id === restored.presetId) || null : null
    const restoredPreset = savedPreset || (sameTool ? list.find((item) => item.id === previous.presetId) || null : null)
    const choice = restoredPreset
      ? { preset: restoredPreset, switched: false, fallback: false }
      : toolPresetOf(list, currentPresetId || defaultPreset, tool.id)
    if (!choice.preset) {
      ui.showToast(t('studio.imageTool.blockedNoPreset'))
      return false
    }
    const nextPreset = choice.preset
    const prompt = restored ? restored.prompt : (sameTool ? previous.prompt : '')
    const strength = restored
      ? clampMaskStrength(restored.strength, Boolean(restored.mask))
      : (sameTool ? clampMaskStrength(previous.strength, Boolean(previous.mask)) : toolStrengthDefaultOf(tool.id, nextPreset))
    const strengthAuto = restored ? restored.strengthAuto !== false : (sameTool ? previous.strengthAuto : true)
    const mask = restored ? restored.mask : (sameTool ? previous.mask : null)
    setDraft({
      toolId: tool.id,
      target,
      // 同一作品同一工具：恢复未提交的提示词 / 蒙版 / 强度（修复中断后可继续编辑）。
      prompt,
      strength,
      strengthAuto,
      presetId: nextPreset.id,
      mask,
    })
    // 干净基线只在第一次打开该作品时记：恢复草稿时沿用原基线，圆点状态不会因重开而丢失。
    if (workKey && !baselinesRef.current[workKey]) {
      baselinesRef.current[workKey] = { presetId: nextPreset.id, strength }
    }
    setEditorOpen(true)
    // 只有「这次打开自动换模」才提示；恢复已有草稿不重复打扰。
    if (!restored && !sameTool && (choice.switched || choice.fallback)) {
      ui.showToast(formatText(t('studio.imageTool.autoPreset'), { preset: presetLabelOf(nextPreset) }))
    }
    return true
  }

  /** 暂存并收起编辑态：草稿保留在内存，dock 显示「继续编辑」。 */
  function closeTool() {
    setEditorOpen(false)
  }

  /** 取消本次编辑：丢弃当前作品的未提交草稿（蒙版 / 修改描述 / 参数），并退出编辑态。 */
  function discardTool() {
    if (inFlightRef.current) return false
    const current = draftRef.current
    const key = draftKeyOf(current.target)
    if (key) removeWorkDraft(key)
    setDraft(emptyDraft())
    setEditorOpen(false)
    return true
  }

  /**
   * 切换工具预设：只影响工具自己的请求；自动档强度跟随新预设的推荐档，
   * 用户手调过的强度保持不动（上限仍按当前是否带蒙版钳制）。
   */
  function selectPreset(next) {
    const tool = imageToolOf(draftRef.current.toolId)
    if (!tool) return false
    const wanted = typeof next === 'string' ? next : next && next.id
    if (!wanted) return false
    const found = presetsForTool(list, tool).find((item) => item.id === wanted) || null
    if (!found) return false
    setDraft((prev) => {
      const value = prev.strengthAuto
        ? toolStrengthDefaultOf(tool.id, found)
        : clampMaskStrength(prev.strength, Boolean(prev.mask))
      return { ...prev, presetId: found.id, strength: value }
    })
    return true
  }

  /** 用户拖动强度：立即退出自动档，值按当前上限钳制。 */
  function setStrength(value) {
    setDraft((prev) => {
      const tool = imageToolOf(prev.toolId)
      const withMask = Boolean(prev.mask) && Boolean(tool && tool.form === 'canvas')
      return { ...prev, strengthAuto: false, strength: clampMaskStrength(value, withMask) }
    })
  }

  /**
   * 写入涂抹蒙版（MaskEditor 导出黑底白字 PNG base64 后调用）。
   *
   * @returns {{ ok: boolean, reason: string }} 失败原因交给画布转成可见提示：
   *   `unsupported` 当前工具不是画布形态 / `no_target` 没有底图 / `empty` 空蒙版 /
   *   `too_large` 超过契约体积 / `invalid` 不是合法 base64。
   */
  function applyMask(input) {
    const tool = imageToolOf(draftRef.current.toolId)
    if (!tool || tool.form !== 'canvas') return { ok: false, reason: 'unsupported' }
    if (!draftRef.current.target) return { ok: false, reason: 'no_target' }
    const candidate = input && typeof input === 'object' ? input : { data: input }
    const verdict = maskExportVerdict(candidate.data, candidate.coverage)
    if (!verdict.ok) return { ok: false, reason: verdict.reason }
    setDraft((prev) => ({
      ...prev,
      mask: {
        data: verdict.data,
        coverage: verdict.coverage,
        digest: maskDigestOf(verdict.data),
      },
    }))
    return { ok: true }
  }

  /** 清空蒙版：底图与提示词保留，本次按整图请求（inpaintOnly 预设会被前置校验拦下）。 */
  function clearMask() {
    setDraft((prev) => (prev.mask ? { ...prev, mask: null } : prev))
    return true
  }

  /**
   * 清空某个作品的编辑草稿（作品条圆点 / 版本面板行的「清空」按钮调用）。
   *
   * 如果正在编辑的正是该作品，同时清空活动草稿并退出编辑态——否则同步 effect
   * 会在下一次渲染把刚删掉的草稿又写回映射。
   */
  function clearWorkDraft(value) {
    const key = draftKeyOf(value)
    if (!key) return false
    removeWorkDraft(key)
    if (draftKeyOf(draftRef.current.target) === key) {
      setDraft(emptyDraft())
      setEditorOpen(false)
    }
    return true
  }

  /** 单个作品草稿的圆点摘要（改动项 / 覆盖率 / 最近编辑时间）；无草稿返回空摘要。 */
  function workDraftSummary(value) {
    const key = draftKeyOf(value)
    if (!key) return draftSummaryOf(null)
    return draftSummaryOf(workDrafts[key] || null)
  }

  /** 对当前活动草稿做浅合并（恢复草稿 / 调试用）；写入映射交给同步 effect。 */
  function patchDraft(patch) {
    const partial = patch && typeof patch === 'object' ? patch : null
    if (!partial) return false
    setDraft((prev) => ({ ...prev, ...partial }))
    return true
  }

  /**
   * 提交工具任务：走既有的 `submitGenerate()`，成功收起编辑态并清空草稿，
   * 失败按 D5 收起编辑态但保留草稿（底图 / 提示词 / 蒙版），由 dock 的
   * 「继续编辑」恢复。卸载边界沿用组合层的 `alive()`。
   */
  async function submit() {
    if (inFlightRef.current) return false
    const current = draftRef.current
    const tool = imageToolOf(current.toolId)
    if (!tool || !tool.ready) return false
    const currentPreset = list.find((item) => item.id === current.presetId) || null
    const blocked = imageToolBlockedKeyOf({
      tool: tool.id,
      targetPath: current.target ? current.target.path : '',
      preset: currentPreset,
      prompt: current.prompt,
      targetPrompt: current.target ? current.target.prompt : '',
      mask: current.mask,
    })
    if (blocked) {
      ui.showToast(t(blocked))
      return false
    }
    const body = buildImageToolBody({
      tool: tool.id,
      targetPath: current.target.path,
      targetPrompt: current.target.prompt,
      target: current.target,
      preset: currentPreset,
      presets: list,
      prompt: current.prompt,
      strength: current.strength,
      mask: current.mask,
      negativeActive: negativePromptActive(currentPreset, currentPreset && currentPreset.cfg),
    })
    if (!body) {
      ui.showToast(t('studio.imageTool.blockedTarget'))
      return false
    }
    inFlightRef.current = true
    setSubmitting(true)
    ui.setError(null)
    try {
      const result = await alive(submitGenerate(body))
      if (!result) return false
      if (result.ok && result.data && result.data.id) {
        setPendingTool({
          jobId: result.data.id,
          target: current.target,
          body,
          // 阶段十三：幽灵节点溯源（Host /state 快照里 params.reference.sourcePath 也能推断，
          // 这里再补一份客户端已知的根，父图在更早分页时版本面板仍能挂对位置）。
          parentPath: current.target.path,
          rootImage: (current.target.item && current.target.item.rootImage) || current.target.path,
          sourceMode: tool.id,
        })
        // 提交成功 = 草稿已经变成任务，清掉该作品的未提交草稿（失败分支保留）。
        removeWorkDraft(current.target.path)
        setDraft(emptyDraft())
        setEditorOpen(false)
        ui.showToast(t('studio.imageTool.submitted'))
        if (typeof onSubmitted === 'function') {
          onSubmitted(result.data, { tool: tool.id, target: current.target, body })
        }
        return true
      }
      // 失败：收起编辑态但保留草稿，用户可从 dock 的「继续编辑」恢复后重试。
      setEditorOpen(false)
      ui.fail(result.code, result.message)
      return false
    } finally {
      // 卸载导致 alive 返回 null 时也保证闸门复位（组件已经卸载，置状态无害）。
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  return {
    // 工具与底图：activeTool 关闭编辑态后仍保留（草稿的 owner），用 editorOpen 区分是否在编辑。
    activeTool,
    target: draft.target,
    // 工具自己的提示词输入（默认空；提交时为空回退目标作品提示词）。
    prompt: draft.prompt,
    setPrompt,
    // 强度：自动档跟随预设推荐档，用户拖动后退出自动档。
    strength,
    strengthMax,
    strengthAuto: draft.strengthAuto,
    setStrength,
    // 工具预设：不回写左栏 form.presetId。
    presetId: draft.presetId,
    preset,
    toolPresets,
    selectPreset,
    // 蒙版：{ data, coverage, digest } | null。
    mask: draft.mask,
    coverage,
    applyMask,
    clearMask,
    // 编辑态与提交。
    editorOpen,
    openTool,
    closeTool,
    discardTool,
    canSubmit,
    submitBlockedKey: blockedKey,
    submitting,
    submit,
    // 阶段十三：按作品路径缓存的未提交编辑草稿（LRU 8，会话内内存、不落盘）。
    workDrafts,
    clearWorkDraft,
    workDraftSummary,
    patchDraft,
    // 成功提交的任务信息，供失败重试恢复 / 阶段十三幽灵节点使用。
    pendingTool,
  }
}
