/**
 * 舞台图片工具的状态域（阶段十二方案 B）。
 *
 * 把「针对当前作品的二次处理」从文生图主表单里彻底抽离：这里的提示词、预设、
 * 强度、蒙版与底图都只属于工具自己，**不回写左栏表单**，所以左栏永远能做纯文生图。
 * 纯逻辑（选模 / 强度档位 / 请求体 / 前置校验 / 扩图版面）在
 * `src/logic/imageTool.js` 与 `src/logic/outpaint.js`，画布交互在
 * `src/studio/stage/MaskEditor.jsx` / `OutpaintEditor.jsx`，这里只做状态编排与提交。
 *
 * 关键行为（Lead 决策 D2 / D4 / D5）：
 *  - 底图在打开工具时绑定，不随胶片条预览切换；
 *  - 工具提示词默认空，提交时回退目标作品原提示词；
 *  - 提交失败保留底图 / 提示词 / 蒙版（收起编辑态，dock 可「继续编辑」）；
 *  - 提交成功清空草稿并回调 `onSubmitted(job, meta)`，`pendingTool` 留给阶段十三的幽灵节点。
 *
 * 阶段十五 Phase B：高清放大是 `instant` 工具——`openTool()` 不进入编辑态，直接组装
 * `buildUpscaleToolBody()` 提交；扩图是画布工具——编辑器导出画布后写入 `draft.canvas`
 * （大 base64 只留在内存草稿里，不进 `workDrafts`），`submit()` 按三种 builder 分派。
 *
 * 阶段十三（D6）：在既有单草稿状态机旁边加一张按作品路径缓存的 `workDrafts` 表
 * （会话内内存、LRU 上限 8，含蒙版 / 扩图参数的草稿也算一条）。打开工具时优先恢复该作品的草稿，
 * 提交成功后清掉对应条目。既有 `draft` 字段语义与既有返回项全部保持不变。
 */

import React from 'react'

import { LIMITS, OUTPAINT } from '../../../shared/contract.js'
import { negativePromptActive } from '../../../shared/models-guide.js'

import { submitGenerate } from '../../api/resources.js'
import { formatText, positiveSize } from '../../logic/format.js'
import { isBareImportOf, presetLabelOf } from '../../logic/generate.js'
import { referenceUrlOf } from '../../logic/reference.js'
import {
  buildImageToolBody,
  buildOutpaintToolBody,
  buildUpscaleToolBody,
  imageToolBlockedKeyOf,
  imageToolOf,
  normalizeOutpaintCanvas,
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
import {
  base64BytesOf,
  clampMaskStrength,
  maskDigestOf,
  maskExportVerdict,
  normalizeMaskData,
} from '../../logic/mask.js'
import { OUTPAINT_EXPAND_ID, outpaintAnchorOf, outpaintRatioIdOf } from '../../logic/outpaint.js'

/** 扩图草稿的默认比例与锚点：默认「四边扩 20%」、内容居中。 */
function defaultOutpaint() {
  return { ratioId: OUTPAINT_EXPAND_ID, anchor: { x: 0.5, y: 0.5 } }
}

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
    // 扩图草稿：只存小对象（比例 + 锚点）；运行时导出的画布 base64 另存 `canvas`，
    // 不进 workDrafts（避免几 MB 的快照进入 LRU 表），重开时由编辑器重新导出。
    outpaint: defaultOutpaint(),
    canvas: null,
  }
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
  // 裸本地导入图（无 PNG tEXt 元数据）把文件名留在 params.prompt 只作标题展示，不能拿来当扩散提示词。
  const rawPrompt = isBareImportOf({ image, item }) ? '' : (ownPrompt || paramsPrompt)
  const prompt = rawPrompt.slice(0, LIMITS.prompt.maxChars)
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
  // 局部重绘与扩图都提交蒙版，可选模型口径一致（都要求 supportsInpaint）。
  if (tool.id === 'inpaint' || tool.id === 'outpaint') {
    return list.filter((item) => item.supportsInpaint === true)
  }
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
 * @param {Function} input.alive 卸载边界：`await alive(request)` 卸载后返回 null
 * @param {object} input.ui 界面态域（showToast / fail / setError）
 * @param {Array<object>} input.presets 宿主下发的预设列表
 * @param {string} input.defaultPreset 宿主默认预设 id
 * @param {Function} [input.onSubmitted] 提交成功回调，收到响应里的 job 对象
 * @param {string} [input.currentPresetId] 左栏当前预设 id（可选）：工具优先沿用它
 */
export function useImageTool({ t, alive, ui, presets, defaultPreset, onSubmitted, currentPresetId }) {
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
    const out = draft.outpaint || defaultOutpaint()
    const baseAnchor = baseline.anchor || defaultOutpaint().anchor
    // 扩图没有蒙版，改动项归到 params：比例 / 锚点变化也要让作品条亮圆点。
    const outpaintChanged = draft.toolId === 'outpaint' && (
      out.ratioId !== (baseline.ratioId || OUTPAINT_EXPAND_ID)
      || out.anchor.x !== baseAnchor.x
      || out.anchor.y !== baseAnchor.y
    )
    const changed = {
      mask: Boolean(draft.mask),
      prompt: draft.prompt.trim() !== '',
      params: draft.presetId !== baseline.presetId || draft.strength !== baseline.strength || outpaintChanged,
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
          outpaint: out,
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
  const outpaint = draft.outpaint || defaultOutpaint()
  // 扩图必然带蒙版（新增区域），画布还没导出时也按「有蒙版」钳制强度上限，
  // 否则默认 1.0 会被暂时压到 img2img 的通用上限 0.9。
  const hasMask = Boolean(draft.mask) || Boolean(activeTool && activeTool.id === 'outpaint')
  // 强度读数按「本次是否带蒙版」钳制：清空蒙版后上限回落到通用 max。
  const strength = clampMaskStrength(draft.strength, hasMask)
  const strengthMax = toolStrengthMaxOf(draft.toolId, hasMask)
  const coverage = activeTool && activeTool.id === 'outpaint'
    ? (draft.canvas ? draft.canvas.coverage : 0)
    : (draft.mask ? draft.mask.coverage : 0)
  const blockedKey = imageToolBlockedKeyOf({
    tool: draft.toolId,
    target: draft.target,
    targetPath: draft.target ? draft.target.path : '',
    preset,
    prompt: draft.prompt,
    targetPrompt: draft.target ? draft.target.prompt : '',
    mask: draft.mask,
    canvas: draft.canvas,
  })
  const canSubmit = Boolean(activeTool && activeTool.ready && draft.target) && blockedKey === '' && !submitting

  function setPrompt(value) {
    const text = String(value ?? '').slice(0, LIMITS.prompt.maxChars)
    setDraft((prev) => (prev.prompt === text ? prev : { ...prev, prompt: text }))
  }

  /**
   * 打开工具。
   *
   * - 高清放大是零参数即时工具：绑定底图后**不进入编辑态**，直接组装请求体提交；
   * - 扩图与局部重绘进入画布编辑态，扩图额外恢复比例 / 锚点草稿（画布由编辑器重新导出）；
   * - 自动选模：恢复草稿时沿用原预设，否则优先沿用当前预设（工具草稿 → 左栏当前预设 →
   *   宿主默认预设），不支持时切到工具兜底预设并 toast 说明，**不改左栏表单**；
   * - 同一作品同一工具再次打开时恢复草稿；换作品 / 换工具重置草稿。
   *
   * @param {'inpaint'|'img2img'|'upscale'|'outpaint'|object} kind 工具 id（也接受描述符）
   * @param {object} entry 胶卷 / 画廊条目 `{ image, item }` 或裸 image
   * @returns {boolean|Promise<boolean>} 是否成功打开 / 提交（即时工具返回提交结果）
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
    // 即时工具：不进入编辑态，点击即提交（重复点击由 inFlightRef 拦截）。
    if (tool.form === 'instant') return sendInstant(tool, target)

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
    const restoredMask = restored ? restored.mask : null
    const sameMask = sameTool ? previous.mask : null
    // 扩图始终带蒙版：强度按带蒙版上限（1.0）归一，不能被暂时压成通用 max。
    const maskClamp = tool.id === 'outpaint' ? true : Boolean(restoredMask || sameMask)
    const strength = restored
      ? clampMaskStrength(restored.strength, maskClamp)
      : (sameTool ? clampMaskStrength(previous.strength, maskClamp) : toolStrengthDefaultOf(tool.id, nextPreset))
    const strengthAuto = restored ? restored.strengthAuto !== false : (sameTool ? previous.strengthAuto : true)
    const mask = tool.id === 'outpaint' ? null : (restored ? restoredMask : sameMask)
    // 扩图草稿：恢复已保存的比例 / 锚点；同一工具重开时沿用内存里的画布，等编辑器按最新参数重导。
    const nextOutpaint = restored && restored.outpaint && typeof restored.outpaint === 'object'
      ? { ratioId: outpaintRatioIdOf(restored.outpaint.ratioId), anchor: outpaintAnchorOf(restored.outpaint.anchor) }
      : (sameTool && previous.outpaint ? previous.outpaint : defaultOutpaint())
    const canvas = tool.id === 'outpaint' && sameTool ? previous.canvas : null
    setDraft({
      toolId: tool.id,
      target,
      // 同一作品同一工具：恢复未提交的提示词 / 蒙版 / 强度（修复中断后可继续编辑）。
      prompt,
      strength,
      strengthAuto,
      presetId: nextPreset.id,
      mask,
      outpaint: nextOutpaint,
      canvas,
    })
    // 干净基线只在第一次打开该作品时记：恢复草稿时沿用原基线，圆点状态不会因重开而丢失。
    if (workKey && !baselinesRef.current[workKey]) {
      baselinesRef.current[workKey] = {
        presetId: nextPreset.id,
        strength,
        ratioId: nextOutpaint.ratioId,
        anchor: nextOutpaint.anchor,
      }
    }
    setEditorOpen(true)
    // 只有「这次打开自动换模」才提示；恢复已有草稿不重复打扰。
    if (!restored && !sameTool && (choice.switched || choice.fallback)) {
      ui.showToast(formatText(t('studio.imageTool.autoPreset'), { preset: presetLabelOf(nextPreset) }))
    }
    return true
  }

  /**
   * 即时工具（高清放大）的提交：不进入编辑态、不写 workDrafts。
   *
   * 成功提示 `studio.imageTool.upscaleSubmitted`；`pendingTool` 与普通工具同形，
   * 幽灵节点 / 助手镜像据此显示。源图长边超限由前置校验拦下并给出明确提示。
   *
   * @returns {Promise<boolean>} 是否提交成功
   */
  async function sendInstant(tool, target) {
    if (inFlightRef.current) return false
    const blocked = imageToolBlockedKeyOf({
      tool: tool.id,
      target,
      targetPath: target.path,
      targetPrompt: target.prompt,
    })
    if (blocked) {
      ui.showToast(t(blocked))
      return false
    }
    const body = buildUpscaleToolBody({ target, targetPrompt: target.prompt })
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
          target,
          body,
          parentPath: target.path,
          rootImage: (target.item && target.item.rootImage) || target.path,
          sourceMode: tool.id,
        })
        ui.showToast(t('studio.imageTool.upscaleSubmitted'))
        if (typeof onSubmitted === 'function') {
          onSubmitted(result.data, { tool: tool.id, target, body })
        }
        return true
      }
      ui.fail(result.code, result.message)
      return false
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  /**
   * 导出 / 调试入口：按工具 id + 条目直接发起即时提交。
   * `openTool` 内部已复用 `sendInstant`，这里只补一层「条目 → 底图」的归一。
   */
  function submitInstant(kind, entry) {
    const tool = imageToolOf(typeof kind === 'string' ? kind : kind && kind.id)
    if (!tool || tool.form !== 'instant' || !tool.ready) return Promise.resolve(false)
    const target = targetOf(entry)
    if (!target) {
      ui.showToast(t('studio.imageTool.blockedTarget'))
      return Promise.resolve(false)
    }
    return sendInstant(tool, target)
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
      const withMask = tool.id === 'outpaint' ? true : Boolean(prev.mask)
      const value = prev.strengthAuto
        ? toolStrengthDefaultOf(tool.id, found)
        : clampMaskStrength(prev.strength, withMask)
      return { ...prev, presetId: found.id, strength: value }
    })
    return true
  }

  /** 用户拖动强度：立即退出自动档，值按当前上限钳制。 */
  function setStrength(value) {
    setDraft((prev) => {
      const tool = imageToolOf(prev.toolId)
      const withMask = Boolean(tool && tool.form === 'canvas')
        && (tool.id === 'outpaint' || Boolean(prev.mask))
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
   * 扩图比例：切换比例后画布尺寸变化，已导出的画布立即作废，
   * 由 `OutpaintEditor` 在下一帧按新比例重新导出。
   */
  function setOutpaintRatio(value) {
    const tool = imageToolOf(draftRef.current.toolId)
    if (!tool || tool.id !== 'outpaint') return false
    const ratioId = outpaintRatioIdOf(value)
    setDraft((prev) => {
      const current = prev.outpaint || defaultOutpaint()
      if (current.ratioId === ratioId) return prev
      return { ...prev, outpaint: { ...current, ratioId }, canvas: null }
    })
    return true
  }

  /** 扩图锚点（0~1 归一）：变化后旧画布作废，等编辑器重新导出。 */
  function setOutpaintAnchor(value) {
    const tool = imageToolOf(draftRef.current.toolId)
    if (!tool || tool.id !== 'outpaint') return false
    const anchor = outpaintAnchorOf(value)
    setDraft((prev) => {
      const current = prev.outpaint || defaultOutpaint()
      if (current.anchor.x === anchor.x && current.anchor.y === anchor.y) return prev
      return { ...prev, outpaint: { ...current, anchor }, canvas: null }
    })
    return true
  }

  /**
   * 写入扩图编辑器导出的画布（扩张后的 image + 白=新增区蒙版）。
   *
   * 体积超限 / 数据非法时返回失败原因而不改草稿：编辑器据此显示可见提示，
   * 不会把一个必被 Host 拒绝的字段发出去。
   *
   * @returns {{ ok: boolean, reason?: string, canvas?: object }}
   *   reason：`unsupported` / `no_target` / `invalid` / `too_large`
   */
  function applyOutpaintCanvas(input) {
    const tool = imageToolOf(draftRef.current.toolId)
    if (!tool || tool.id !== 'outpaint') return { ok: false, reason: 'unsupported' }
    if (!draftRef.current.target) return { ok: false, reason: 'no_target' }
    const candidate = input && typeof input === 'object' ? input : {}
    const canvas = normalizeOutpaintCanvas(candidate)
    if (!canvas) {
      const image = normalizeMaskData(candidate.image)
      const mask = normalizeMaskData(candidate.mask)
      if (!image || !mask) return { ok: false, reason: 'invalid' }
      if (base64BytesOf(image) > Number(LIMITS.reference.maxBytes)) return { ok: false, reason: 'too_large' }
      if (base64BytesOf(mask) > Number(LIMITS.mask.maxBytes)) return { ok: false, reason: 'too_large' }
      return { ok: false, reason: 'invalid' }
    }
    setDraft((prev) => ({ ...prev, canvas }))
    return { ok: true, canvas }
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
   * 提交工具任务：按工具 id 分派到对应的请求体构造器，成功后收起编辑态并清空草稿，
   * 失败按 D5 收起编辑态但保留草稿（底图 / 提示词 / 蒙版 / 扩图参数），由 dock 的
   * 「继续编辑」恢复。卸载边界沿用组合层的 `alive()`。
   */
  async function submit() {
    if (inFlightRef.current) return false
    const current = draftRef.current
    const tool = imageToolOf(current.toolId)
    if (!tool || !tool.ready) return false
    // 即时工具不会进入编辑态；这里仍按同一套入口兜住（例如调试直接调用 submit）。
    if (tool.form === 'instant') return sendInstant(tool, current.target)
    const currentPreset = list.find((item) => item.id === current.presetId) || null
    const blocked = imageToolBlockedKeyOf({
      tool: tool.id,
      target: current.target,
      targetPath: current.target ? current.target.path : '',
      preset: currentPreset,
      prompt: current.prompt,
      targetPrompt: current.target ? current.target.prompt : '',
      mask: current.mask,
      canvas: current.canvas,
    })
    if (blocked) {
      ui.showToast(t(blocked))
      return false
    }
    const negativeActive = negativePromptActive(currentPreset, currentPreset && currentPreset.cfg)
    let body = null
    if (tool.id === 'outpaint') {
      body = buildOutpaintToolBody({
        target: current.target,
        targetPath: current.target.path,
        targetPrompt: current.target.prompt,
        preset: currentPreset,
        presets: list,
        prompt: current.prompt,
        strength: current.strength,
        canvas: current.canvas,
        negativeActive,
      })
    } else {
      body = buildImageToolBody({
        tool: tool.id,
        targetPath: current.target.path,
        targetPrompt: current.target.prompt,
        target: current.target,
        preset: currentPreset,
        presets: list,
        prompt: current.prompt,
        strength: current.strength,
        mask: current.mask,
        negativeActive,
      })
    }
    if (!body) {
      ui.showToast(t(tool.id === 'outpaint' ? 'studio.outpaint.blockedCanvas' : 'studio.imageTool.blockedTarget'))
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
    // 扩图草稿：小对象进 workDrafts；canvas（大 base64）只留在活动草稿内存里，
    // 关闭编辑态 / 重开时由 OutpaintEditor 按 outpaint 重新导出。
    outpaint: {
      ratioId: outpaint.ratioId,
      anchor: outpaint.anchor,
      canvas: draft.canvas,
    },
    setOutpaintRatio,
    setOutpaintAnchor,
    applyOutpaintCanvas,
    // 编辑态与提交。
    editorOpen,
    openTool,
    closeTool,
    discardTool,
    canSubmit,
    submitBlockedKey: blockedKey,
    submitting,
    submit,
    // 即时工具（高清放大）的显式入口：点击动作坞已经由 openTool 直达提交，
    // 这里导出方便渲染测试与后续「大图预览里的放大按钮」复用。
    submitInstant,
    // 阶段十三：按作品路径缓存的未提交编辑草稿（LRU 8，会话内内存、不落盘）。
    workDrafts,
    clearWorkDraft,
    workDraftSummary,
    patchDraft,
    // 成功提交的任务信息，供失败重试恢复 / 阶段十三幽灵节点使用。
    pendingTool,
  }
}
