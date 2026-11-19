/**
 * 表单域：提示词 / 负向 / 预设 / 画幅比例 / 润色与英译。
 *
 * 负责表单状态、预设同步 effect、草稿托管状态机与生成请求体拼装。
 * 依赖入参：{ t, isEn, alive, ui, preset, initialPrompt }；preset 是宿主的预设配置
 * { presets, defaultPreset }，由组合层从宿主状态解析后传入。
 *
 * 0.10.0：删除风格与风格后缀；排除项是否可用统一由 shared/models-guide.js 的
 * `negativePromptActive()` 判定，展示与提交用同一个布尔值。
 *
 * 0.13.0：参考图 / 蒙版 / 重绘强度整块迁到舞台图片工具（`useImageTool`），
 * 这里只剩纯文生图状态；请求体不再产出 reference 字段。
 *
 * 阶段十五 Phase A1：左栏未提交修改不再拦胶片条回填，而是「托管」进最左端草稿卡：
 *  - `origin`：当前表单参数的来源作品 `{ path, prompt, patch }`；
 *  - `draft`：托管的草稿槽 `{ source, form, editing }`（形状见 logic/form.js）；
 *  - parkDraft / openDraft / clearDraft / restoreOriginal 是这条链路仅有的四个动作，
 *    组合层只在「切预览 / 点草稿卡 / 提交成功 / 新建创作 / 还原原图」时调用它们。
 *
 * 阶段十五 Phase C2：左栏新增原生参考图槽（`references`，形状见 `logic/reference.js`）。
 * 槽位属于表单状态：挂载 / 移除 / 换图都算 dirty，会随草稿一起托管；
 * 回填作品与还原原图清空槽位（展示的是那张作品的干净基准），新建创作同样清空。
 */

import React from 'react'

import { LIMITS } from '../../../shared/contract.js'
import { negativePromptActive } from '../../../shared/models-guide.js'

import { enhancePromptRequest } from '../../api/resources.js'
import { clampInt, clampNumber } from '../../logic/clamp.js'
import {
  draftSourceOf,
  draftViewOf,
  formDraftChangesOf,
  formSnapshotOf,
  isFormDirty,
  lruWorkFormDrafts,
  newCreationPatch,
  originalPatchOf,
  parkDraftOf,
} from '../../logic/form.js'
import { buildGenerateBody, presetLabelOf } from '../../logic/generate.js'
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
import {
  referenceAdd,
  referenceHas,
  referenceMaxCount,
  nativeReferencePresetOf,
  referencePurgeOf,
  referenceRemove,
  supportsReferenceOf,
} from '../../logic/reference.js'
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
  // 原生参考图槽（Phase C2）：槽位项 `{ path, url, width, height, name }`，上限见契约。
  references: [],
}

export function useStudioForm({ t, isEn, alive, ui, preset, initialPrompt, initialSession }) {
  const { presets, defaultPreset } = preset
  const saved = initialSession && typeof initialSession === 'object' ? initialSession : null
  const [form, setForm] = React.useState(() => {
    if (!initialPrompt && saved && saved.form && typeof saved.form === 'object') {
      return { ...EMPTY_FORM, ...saved.form }
    }
    return {
      ...EMPTY_FORM,
      prompt: initialPrompt,
    }
  })
  const [refineGroups, setRefineGroups] = React.useState([])
  const [refineSource, setRefineSource] = React.useState('')
  const [enhancing, setEnhancing] = React.useState(false)
  const [translating, setTranslating] = React.useState(false)
  // 干净基准快照：最近一次「生成提交 / 从作品回填 / 新建创作 / 初始预设同步」时的表单，
  // 与当前表单不一致即为 dirty（dirty 现在意味着「有一次要被托管的未提交修改」）。
  const [cleanBaseline, setCleanBaseline] = React.useState(() => (
    !initialPrompt && saved && typeof saved.cleanBaseline === 'string' ? saved.cleanBaseline : ''
  ))
  // 参数来源作品：当前表单是哪张作品的原始参数；同时充当「还原原图」的还原目标。
  const [origin, setOrigin] = React.useState(() => (
    !initialPrompt && saved && saved.origin && typeof saved.origin === 'object' ? saved.origin : null
  ))
  // 多作品左栏表单草稿表：按作品 path 独立存放未提交的参数/提示词草稿，互不覆盖。
  const [workFormDrafts, setWorkFormDrafts] = React.useState(() => (
    !initialPrompt && saved && saved.workFormDrafts && typeof saved.workFormDrafts === 'object'
      ? lruWorkFormDrafts(saved.workFormDrafts)
      : {}
  ))
  // 纯空白画布草稿槽（origin 为 null 时使用）。
  const [blankDraft, setBlankDraft] = React.useState(() => (
    !initialPrompt && saved && saved.blankDraft && typeof saved.blankDraft === 'object' && saved.blankDraft.form
      ? saved.blankDraft
      : null
  ))
  // 事件回调里要读最新表单（不依赖渲染闭包），异步动作与快照计算都用它。
  const formRef = React.useRef(form)
  formRef.current = form
  const cleanBaselineRef = React.useRef(cleanBaseline)
  cleanBaselineRef.current = cleanBaseline
  const originRef = React.useRef(origin)
  originRef.current = origin
  const workFormDraftsRef = React.useRef(workFormDrafts)
  workFormDraftsRef.current = workFormDrafts
  const blankDraftRef = React.useRef(blankDraft)
  blankDraftRef.current = blankDraft
  const dirty = isFormDirty(form, cleanBaseline)
  const currentWorkDraft = origin && origin.path ? (workFormDrafts[origin.path] || null) : null
  const draft = currentWorkDraft || (origin && origin.path ? null : blankDraft)
  // 草稿派生状态：Rail 顶部状态行与「还原原图」只看当前表单及其所属作品。
  const draftView = draftViewOf({ draft: blankDraft, formDraft: currentWorkDraft, dirty, origin })

  // 比例由当前尺寸反推（按约分后的长宽比，而不是像素精确相等）：
  // 768×768 与 1024×1024 都算 1:1，800×600 算 4:3；切换预设改变宽高时也不会停在旧值上。
  const ratioId = ratioIdOf(form.width, form.height)

  // 当前预设是负向词能力与提示词书写口径的唯一来源。
  const activePreset = presets.find((item) => item.id === form.presetId) || null
  const negativeHint = hintOf(activePreset)
  const negativeActive = negativePromptActive(activePreset, form.cfg)
  // 当前预设决定提示词的书写口径；含中文提示时给一条软提示，不拦截生成。
  const englishPromptHint = detectCjk(form.prompt) && presetNeedsEnglish(activePreset)
  // 原生参考图能力（Phase C2）：能力位来自当前预设；切换目标取列表里第一个 supportsReference
  // 的预设（首期只有 FLUX.2 Klein 4B），没有候选时界面只给说明、不静默换模型。
  const referenceSupported = supportsReferenceOf(activePreset)
  const referenceSwitchPreset = nativeReferencePresetOf(presets)
  const referenceSwitchLabel = referenceSwitchPreset ? presetLabelOf(referenceSwitchPreset) : ''
  const referenceMax = referenceMaxCount()

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
    const nextBaseline = formSnapshotOf(form)
    cleanBaselineRef.current = nextBaseline
    setCleanBaseline(nextBaseline)
  }, [cleanBaseline, form.presetId])

  /** 表单补丁统一入口：负向层数据与展示文本在这里保持同步。 */
  function patchForm(partial) {
    const next = applyNegativePatch(formRef.current, partial)
    formRef.current = next
    setForm(next)
  }

  /** 切换预设：套用推荐尺寸 / 步数 / 引导强度，并按负向能力整层替换模型负向词。 */
  function selectPreset(next) {
    if (!next || !next.id) return
    const updated = applyNegativePatch(formRef.current, presetSelectPatch(next, formRef.current, presets))
    formRef.current = updated
    setForm(updated)
  }

  // ---- 原生参考图槽（阶段十五 Phase C2） -----------------------------------

  /**
   * 往参考图槽追加一张（作品条目 / 槽位项 / 路径都行）。
   *
   * 同一事件里可能连续追加多张（一次拖入多个文件），因此同步更新 `formRef`：
   * 后续追加与脏判定读到的都是最新槽位，不依赖 React 是否已经重渲染。
   *
   * @returns {{ok: boolean, reason: 'added'|'duplicate'|'full'|'invalid', list: Array<object>, item: object|null}}
   */
  function addReference(value) {
    const result = referenceAdd(formRef.current.references, value)
    if (result.ok) {
      const next = { ...formRef.current, references: result.list }
      formRef.current = next
      setForm(next)
    }
    return result
  }

  /** 从参考图槽移除一张（按路径）；不在槽位里时保持原状态，不制造假脏。 */
  function removeReference(path) {
    const current = formRef.current.references
    if (!referenceHas(current, path)) return current
    const nextList = referenceRemove(current, path)
    const next = { ...formRef.current, references: nextList }
    formRef.current = next
    setForm(next)
    return nextList
  }

  /**
   * 生成提交成功：把当前表单记为新的干净基准。
   *
   * 传入提交时的表单对象时先做一次同一性检查：等待期间用户若继续改表单（React 每次
   * 修改都会产生新对象），新改动没有提交，仍是 dirty，不能被这次成功提示洗白。
   */
  function markClean(submitted) {
    if (submitted && formRef.current !== submitted) return false
    const nextBaseline = formSnapshotOf(formRef.current)
    cleanBaselineRef.current = nextBaseline
    setCleanBaseline(nextBaseline)
    return true
  }

  /**
   * 从作品回填（胶片条点击 / 画廊打开作品）：套用纯逻辑算好的补丁并记录来源作品。
   *
   * 若目标作品已有尚未提交的表单草稿，优先恢复该作品草稿，并保留该作品原始参数作干净基准
   * （这样「还原原图」与胶片条草稿圆点始终保持准确）。
   */
  function applyRecall(patch, entry) {
    const partial = patch && typeof patch === 'object' ? { ...patch } : {}
    if (Object.keys(partial).length === 0) return false
    const nextOrigin = draftSourceOf(entry, partial)
    const saved = nextOrigin.path ? workFormDraftsRef.current[nextOrigin.path] : null
    // 离开空白画布草稿编辑态，但保留空白草稿本身以便随时点回新建画布卡。
    const currentBlank = blankDraftRef.current
    if (currentBlank && currentBlank.editing === true) {
      const parkedBlank = { ...currentBlank, editing: false }
      blankDraftRef.current = parkedBlank
      setBlankDraft(parkedBlank)
    }
    if (saved && saved.form) {
      partial.references = []
      const fallbackBaseline = formSnapshotOf(applyNegativePatch(formRef.current, partial))
      const baseline = typeof saved.baseline === 'string' && saved.baseline ? saved.baseline : fallbackBaseline
      if (isFormDirty(saved.form, baseline)) {
        const resolvedOrigin = saved.source && saved.source.path ? saved.source : nextOrigin
        formRef.current = saved.form
        cleanBaselineRef.current = baseline
        originRef.current = resolvedOrigin
        setForm(saved.form)
        setCleanBaseline(baseline)
        setOrigin(resolvedOrigin)
        return true
      }
    }
    // 清参考图槽与「干净基准」同源：回填后表单就是那张作品的参数，不残留上一张的参考图。
    partial.references = []
    const next = applyNegativePatch(formRef.current, partial)
    const baseline = formSnapshotOf(next)
    formRef.current = next
    cleanBaselineRef.current = baseline
    originRef.current = nextOrigin
    setForm(next)
    setCleanBaseline(baseline)
    setOrigin(nextOrigin)
    return true
  }

  /**
   * 新建创作：清空提示词 / 固定种子，负向层回到当前预设默认推荐状态。
   *
   * 当前模型预设与画幅比例是下一张仍要用的常用设置，保留不动；
   * 显式重置当前焦点（清掉当前作品或空白画布的草稿与 origin），但不误删其它作品已托管的草稿。
   */
  function newCreation() {
    const currentOrigin = originRef.current
    if (currentOrigin && currentOrigin.path && workFormDraftsRef.current[currentOrigin.path]) {
      const nextDrafts = { ...workFormDraftsRef.current }
      delete nextDrafts[currentOrigin.path]
      workFormDraftsRef.current = nextDrafts
      setWorkFormDrafts(nextDrafts)
    }
    const next = applyNegativePatch(formRef.current, newCreationPatch(formRef.current, activePreset))
    const nextBaseline = formSnapshotOf(next)
    formRef.current = next
    cleanBaselineRef.current = nextBaseline
    originRef.current = null
    blankDraftRef.current = null
    setForm(next)
    setCleanBaseline(nextBaseline)
    setOrigin(null)
    setBlankDraft(null)
    ui.showToast(t('studio.toast.newCreation'))
  }

  /**
   * 解除表单与上一张作品的绑定（阶段十五 Phase C0）。
   *
   * 裸导入图（没有 PNG `tEXt` 生成元数据）与空白新建画布都不该继承上一张作品的提示词、
   * 固定种子与「正在微调」来源：按 `newCreationPatch` 级清 prompt / seed，负向层回到当前
   * 预设推荐档，来源作品置空；模型预设与画幅比例是下一次仍要用的设置，保留不动。
   *
   * 草稿槽不在这里清：调用方负责先 `parkDraft()` 托管未提交修改，再调用本动作。
   */
  function detachOrigin() {
    const next = applyNegativePatch(formRef.current, newCreationPatch(formRef.current, activePreset))
    const nextBaseline = formSnapshotOf(next)
    formRef.current = next
    cleanBaselineRef.current = nextBaseline
    originRef.current = null
    const currentBlank = blankDraftRef.current
    if (currentBlank && currentBlank.editing === true) {
      const parkedBlank = { ...currentBlank, editing: false }
      blankDraftRef.current = parkedBlank
      setBlankDraft(parkedBlank)
    }
    setForm(next)
    setCleanBaseline(nextBaseline)
    setOrigin(null)
    return true
  }

  /** 清空来源作品绑定：助手确认卡覆写表单时避免继续显示旧作品的「正在微调」。 */
  function clearOrigin() {
    if (!originRef.current) return false
    originRef.current = null
    setOrigin(null)
    return true
  }

  /**
   * 删除作品后的引用清理（阶段十五 Phase C0）。
   *
   * 来源作品与多作品草稿表都可能指向刚被删掉的图：清理被删作品的草稿与引用，
   * 并摘除草稿参考槽里指向已删图的路径。
   *
   * @param {Array<string>} paths 被删除的图片路径
   * @returns {boolean} 是否有引用被清理
   */
  function forgetRemovedPaths(paths) {
    const removed = new Set((Array.isArray(paths) ? paths : []).filter(Boolean))
    if (removed.size === 0) return false
    let changed = false
    const currentOrigin = originRef.current
    if (currentOrigin && currentOrigin.path && removed.has(currentOrigin.path)) {
      originRef.current = null
      setOrigin(null)
      changed = true
    }
    const prevDrafts = workFormDraftsRef.current
    let draftsDirty = false
    const nextDrafts = {}
    for (const [key, entry] of Object.entries(prevDrafts)) {
      if (removed.has(key) || (entry && entry.source && removed.has(entry.source.path))) {
        draftsDirty = true
        continue
      }
      if (entry && entry.form && Array.isArray(entry.form.references) && entry.form.references.length > 0) {
        const keptRefs = referencePurgeOf(entry.form.references, [...removed])
        if (keptRefs.length !== entry.form.references.length) {
          const updatedForm = { ...entry.form, references: keptRefs }
          nextDrafts[key] = {
            ...entry,
            form: updatedForm,
            changed: formDraftChangesOf(updatedForm, entry.baseline),
          }
          draftsDirty = true
          continue
        }
      }
      nextDrafts[key] = entry
    }
    if (draftsDirty) {
      workFormDraftsRef.current = nextDrafts
      setWorkFormDrafts(nextDrafts)
      changed = true
    }
    const currentBlank = blankDraftRef.current
    if (currentBlank && currentBlank.form && Array.isArray(currentBlank.form.references) && currentBlank.form.references.length > 0) {
      const keptRefs = referencePurgeOf(currentBlank.form.references, [...removed])
      if (keptRefs.length !== currentBlank.form.references.length) {
        const nextBlank = { ...currentBlank, form: { ...currentBlank.form, references: keptRefs } }
        blankDraftRef.current = nextBlank
        setBlankDraft(nextBlank)
        changed = true
      }
    }
    // 参考图槽里指向已删作品的路径也要摘掉：留着只会让生成请求以 invalid_path 失败。
    const currentRefs = formRef.current.references
    if (Array.isArray(currentRefs) && currentRefs.length > 0) {
      const keptRefs = referencePurgeOf(currentRefs, [...removed])
      if (keptRefs.length !== currentRefs.length) {
        const next = { ...formRef.current, references: keptRefs }
        formRef.current = next
        setForm(next)
        changed = true
      }
    }
    return changed
  }

  // ---- 多作品草稿托管（按作品 path 独立存储 + 空白画布草稿槽） ----------------

  function hasWorkDraft(path) {
    const key = typeof path === 'string' ? path.trim() : ''
    return Boolean(key && workFormDraftsRef.current[key] && workFormDraftsRef.current[key].form)
  }

  /**
   * 托管当前未提交修改：
   *  - 来自作品时写入 `workFormDrafts[origin.path]`，不同作品互不覆盖；
   *  - 空白新建画布时写入 `blankDraft`。
   */
  function parkDraft() {
    const currentOrigin = originRef.current
    const baseline = cleanBaselineRef.current
    const isDirty = isFormDirty(formRef.current, baseline)
    if (currentOrigin && currentOrigin.path) {
      if (!isDirty) return workFormDraftsRef.current[currentOrigin.path] || null
      const nextEntry = {
        source: currentOrigin,
        form: formRef.current,
        baseline,
        changed: formDraftChangesOf(formRef.current, baseline),
        lastTouchedAt: Date.now(),
      }
      const nextDrafts = lruWorkFormDrafts({
        ...workFormDraftsRef.current,
        [currentOrigin.path]: nextEntry,
      })
      workFormDraftsRef.current = nextDrafts
      setWorkFormDrafts(nextDrafts)
      return nextEntry
    }
    const prevBlank = blankDraftRef.current
    const parked = prevBlank && prevBlank.editing === true
    if (!isDirty && !parked) return prevBlank
    const nextBlank = {
      ...parkDraftOf(prevBlank, null, formRef.current),
      baseline: baseline || (prevBlank && prevBlank.baseline) || '',
    }
    blankDraftRef.current = nextBlank
    setBlankDraft(nextBlank)
    return nextBlank
  }

  /**
   * 点最左端新建画布卡：先把当前作品的未提交改动托管进它自己的草稿槽，
   * 若存在空白画布草稿则恢复它，否则返回 false 交由调用方进入干净空白画布。
   */
  function openDraft() {
    const currentOrigin = originRef.current
    if (currentOrigin && currentOrigin.path && isFormDirty(formRef.current, cleanBaselineRef.current)) {
      parkDraft()
    }
    const prevBlank = blankDraftRef.current
    if (prevBlank && prevBlank.form) {
      const fallbackBaseline = formSnapshotOf(
        applyNegativePatch(prevBlank.form, newCreationPatch(prevBlank.form, activePreset)),
      )
      const baseline = typeof prevBlank.baseline === 'string' && prevBlank.baseline
        ? prevBlank.baseline
        : fallbackBaseline
      const nextBlank = { ...prevBlank, editing: true }
      formRef.current = prevBlank.form
      cleanBaselineRef.current = baseline
      originRef.current = null
      blankDraftRef.current = nextBlank
      setForm(prevBlank.form)
      setCleanBaseline(baseline)
      setOrigin(null)
      setBlankDraft(nextBlank)
      return true
    }
    if (!currentOrigin && isFormDirty(formRef.current, cleanBaselineRef.current)) {
      const baseline = cleanBaselineRef.current
      const nextBlank = {
        ...parkDraftOf(null, null, formRef.current),
        baseline,
        editing: true,
      }
      blankDraftRef.current = nextBlank
      setBlankDraft(nextBlank)
      return true
    }
    return false
  }

  /** 清空当前焦点的草稿槽（提交成功时只清当前作品/空白画布的草稿，不动其它作品）。 */
  function clearDraft() {
    const currentOrigin = originRef.current
    if (currentOrigin && currentOrigin.path) {
      if (!workFormDraftsRef.current[currentOrigin.path]) return
      const nextDrafts = { ...workFormDraftsRef.current }
      delete nextDrafts[currentOrigin.path]
      workFormDraftsRef.current = nextDrafts
      setWorkFormDrafts(nextDrafts)
      return
    }
    if (blankDraftRef.current) {
      blankDraftRef.current = null
      setBlankDraft(null)
    }
  }

  /** 按路径清空某张作品的左栏表单草稿（胶片条圆点 / 版本面板清空按钮调用）。 */
  function clearWorkDraft(path) {
    const key = typeof path === 'string' ? path.trim() : ''
    if (!key) return false
    const hadStored = Boolean(workFormDraftsRef.current[key])
    if (hadStored) {
      const nextDrafts = { ...workFormDraftsRef.current }
      delete nextDrafts[key]
      workFormDraftsRef.current = nextDrafts
      setWorkFormDrafts(nextDrafts)
    }
    const currentOrigin = originRef.current
    if (currentOrigin && currentOrigin.path === key && isFormDirty(formRef.current, cleanBaselineRef.current)) {
      const patch = originalPatchOf(currentOrigin)
      if (patch) {
        const next = applyNegativePatch(formRef.current, { ...patch, references: [] })
        const nextBaseline = formSnapshotOf(next)
        formRef.current = next
        cleanBaselineRef.current = nextBaseline
        setForm(next)
        setCleanBaseline(nextBaseline)
      }
      return true
    }
    return hadStored
  }

  /**
   * 还原原图（§6.1.5）：恢复来源作品的原始参数、清掉该作品的草稿，回到干净基准。
   *
   * 参考图槽属于被放弃的那份草稿，一并清空（来源作品的参数里没有槽位）。
   *
   * 返回来源作品（供组合层切回该作品的预览焦点）；没有可还原的来源时返回 null。
   */
  function restoreOriginal() {
    const source = originRef.current
    const patch = originalPatchOf(source)
    if (!patch) return null
    const next = applyNegativePatch(formRef.current, { ...patch, references: [] })
    const nextBaseline = formSnapshotOf(next)
    formRef.current = next
    cleanBaselineRef.current = nextBaseline
    originRef.current = source
    setForm(next)
    setCleanBaseline(nextBaseline)
    setOrigin(source)
    if (source && source.path && workFormDraftsRef.current[source.path]) {
      const nextDrafts = { ...workFormDraftsRef.current }
      delete nextDrafts[source.path]
      workFormDraftsRef.current = nextDrafts
      setWorkFormDrafts(nextDrafts)
    }
    return source
  }

  // 实时托管：
  //  - 正在编辑某张作品时，只要相对该作品基准有改动就同步进 workFormDrafts[origin.path]，
  //    改回原样时自动移除草稿；
  //  - 正在编辑空白画布草稿时，改动同步写回 blankDraft。
  React.useEffect(() => {
    const currentOrigin = originRef.current
    const baseline = cleanBaselineRef.current
    if (currentOrigin && currentOrigin.path) {
      if (!baseline) return
      if (isFormDirty(form, baseline)) {
        const nextEntry = {
          source: currentOrigin,
          form,
          baseline,
          changed: formDraftChangesOf(form, baseline),
          lastTouchedAt: Date.now(),
        }
        setWorkFormDrafts((prev) => {
          const existing = prev[currentOrigin.path]
          if (existing && existing.form === form && existing.baseline === baseline) return prev
          const updated = lruWorkFormDrafts({ ...prev, [currentOrigin.path]: nextEntry })
          workFormDraftsRef.current = updated
          return updated
        })
      } else if (workFormDraftsRef.current[currentOrigin.path]) {
        setWorkFormDrafts((prev) => {
          if (!prev[currentOrigin.path]) return prev
          const next = { ...prev }
          delete next[currentOrigin.path]
          workFormDraftsRef.current = next
          return next
        })
      }
      return
    }
    const currentBlank = blankDraftRef.current
    if (!currentBlank || currentBlank.editing !== true || currentBlank.form === form) return
    const nextBlank = { ...currentBlank, form }
    blankDraftRef.current = nextBlank
    setBlankDraft(nextBlank)
  }, [form])

  /**
   * 拼装生成请求体（纯文生图 + 可选原生参考图）。
   *
   * 参考图槽非空时 `buildGenerateBody()` 会把有序路径数组写进 `references`
   * （去重、按契约上限裁剪）；空槽时请求体与纯文生图逐字一致。
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
    const next = clampNumber(value, LIMITS.cfg.min, LIMITS.cfg.max, formRef.current.cfg)
    const prev = formRef.current
    const current = presets.find((item) => item.id === prev.presetId) || null
    const patch = { cfg: next }
    const wasActive = negativePromptActive(current, prev.cfg)
    const isActive = negativePromptActive(current, next)
    if (!wasActive && isActive) {
      const layers = resolveNegativeLayers(prev, presets)
      const hint = hintOf(current)
      if (!layers.model && hint) Object.assign(patch, negativeLayersPatch({ ...layers, model: hint }))
    }
    const updated = applyNegativePatch(prev, patch)
    formRef.current = updated
    setForm(updated)
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
    // 原生参考图槽（Phase C2）：槽位本体在 form 上，读写动作与能力派生在这里。
    addReference,
    removeReference,
    referenceSupported,
    referenceSwitchPreset,
    referenceSwitchLabel,
    referenceMax,
    // 脏判定：现在只表示「有一次未提交修改，切作品时会被托管进对应作品的草稿槽」。
    dirty,
    cleanBaseline,
    // 来源作品（面板顶部的轻量提示）：保留 tuning 的旧形状给 Rail / 助手面板使用。
    tuning: origin ? { prompt: origin.prompt, path: origin.path } : null,
    origin,
    markClean,
    applyRecall,
    newCreation,
    // 阶段十五 Phase C0：解除与上一张作品的绑定、删除作品后的引用清理。
    detachOrigin,
    clearOrigin,
    forgetRemovedPaths,
    // 多作品草稿托管：按作品 path 独立存储的 workFormDrafts + 空白画布 blankDraft。
    draft,
    workFormDrafts,
    blankDraft,
    hasWorkDraft,
    clearWorkDraft,
    draftView,
    draftEditing: Boolean(draftView && draftView.editing),
    parkDraft,
    openDraft,
    clearDraft,
    restoreOriginal,
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
