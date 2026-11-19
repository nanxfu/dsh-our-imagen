/**
 * 创作面板表单的纯逻辑：脏判定、「新建创作」重置补丁与草稿托管的来源快照。
 *
 * 「脏」的语义是「表单里有还没提交生成、也没从作品回填过的手动修改」：
 *  - 刚打开、刚生成完、刚从胶卷或画廊回填完 → 干净；
 *  - 用户改过提示词 / 参数但还没点生成 → 脏。
 *
 * 判定方式是与「干净基准快照」逐字段比较，而不是一改就置脏：
 * 用户把值改回原样后仍然是干净的，不会因为点过一下输入框就永久失去自动回填。
 * 回填与重置只在这里算补丁，hook 负责落状态、维护基准与来源。
 *
 * 阶段十五 Phase A1 起：脏不再拦截胶片条回填（见 docs/STUDIO_UX_POLISH…§2.4），
 * 未提交修改被托管进最左端「新建草稿卡」。托管槽的形状与来源作品快照由这里定义：
 *  - 草稿槽 `{ source, form, editing }`：source 是来源作品（patch 是回填时的原始参数
 *    补丁，「还原原图」直接用它），form 是托管时的完整表单，editing 表示当前表单正在
 *    编辑这份草稿；
 *  - 来源作品 `{ path, prompt, patch }` 只保留展示与还原需要的字段，不依赖历史分页是否还在。
 *
 * 0.13.0 起参考图 / 蒙版 / 重绘强度迁到舞台图片工具（`useImageTool`），
 * 主表单快照只比较提示词与纯文生图参数。
 *
 * 阶段十五 Phase C2：左栏新增「原生参考图槽」（`references`）。挂载 / 移除 / 换图都算
 * 未提交修改，因此参考图路径指纹纳入表单快照；新建创作与还原原图会清空槽位。
 */

import { LIMITS } from '../../shared/contract.js'
import { negativePromptActive } from '../../shared/models-guide.js'

import { hintOf } from './preset.js'
import { negativeLayersPatch, normalizeNegativeLayers } from './prompt.js'
import { referenceFingerprintOf } from './reference.js'

/** 与生成结果相关的字段；展示用的负向层数据由合并文本代表，不单独比较。 */
const SNAPSHOT_FIELDS = ['prompt', 'negative', 'presetId', 'seed']

function textOf(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function numberish(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/**
 * 表单 → 干净基准快照（字符串）。
 *
 * 固定键序后转字符串，比较开销与字段数同级，也不需要深比较工具。
 */
export function formSnapshotOf(form) {
  const input = form && typeof form === 'object' ? form : {}
  const snapshot = {}
  for (const field of SNAPSHOT_FIELDS) {
    snapshot[field] = field === 'seed' ? textOf(input.seed).trim() : textOf(input[field])
  }
  snapshot.width = numberish(input.width)
  snapshot.height = numberish(input.height)
  snapshot.steps = numberish(input.steps)
  snapshot.cfg = numberish(input.cfg)
  snapshot.count = numberish(input.count)
  // 原生参考图槽（Phase C2）：挂载 / 移除都算未提交修改，只比较有序路径指纹。
  snapshot.references = referenceFingerprintOf(input.references)
  return JSON.stringify(snapshot)
}

/**
 * 表单脏判定：与干净基准不一致即为「有未提交的手动修改」。
 *
 * 基准为空（预设还没同步、或旧调用方没传）时按干净处理，避免启动瞬间误报脏。
 */
export function isFormDirty(form, baseline) {
  if (typeof baseline !== 'string' || baseline === '') return false
  return formSnapshotOf(form) !== baseline
}

/**
 * 「新建创作」→ 表单补丁。
 *
 * 只清掉绑定到上一张具体作品的状态：提示词、固定种子、排除项回落到
 * 当前预设的默认推荐状态。模型预设与画幅比例是用户下一张还要用的常用设置，保留不动。
 *
 * 阶段十五 Phase C2：参考图槽也属于「上一张创作」的输入，随新建创作一起清空
 * （清空不弹窗，但槽位内容会先进草稿槽，见 `parkDraft`）。
 */
export function newCreationPatch(form, preset) {
  const input = form && typeof form === 'object' ? form : {}
  const active = preset && typeof preset === 'object' ? preset : null
  const cfg = Number(input.cfg)
  // 与切换预设同一口径：当前 CFG 下真的消费负向词时才挂上模型推荐词。
  const negativeActive = negativePromptActive(active, Number.isFinite(cfg) ? cfg : undefined)
  const layers = normalizeNegativeLayers({
    model: negativeActive ? hintOf(active) : '',
    user: '',
  })
  return {
    prompt: '',
    seed: '',
    references: [],
    ...negativeLayersPatch(layers),
  }
}

// ---- 草稿托管（阶段十五 Phase A1） -----------------------------------------

/**
 * 来源作品快照：当前表单的参数是从哪张图回填来的。
 *
 * `patch` 是 `iteratePatch()` 算出的原始参数补丁，直接留着给「还原原图」用：
 * 之后历史分页刷新、作品被删都不影响还原。条目形状与真实 Host 的 history 条目一致
 * （只保证有 prompt / images，params 可能不存在）。
 *
 * @param {{image?: object, item?: object}} entry 胶卷 / 画廊条目
 * @param {object} patch 该作品回填到表单的参数补丁
 * @returns {{path: string, prompt: string, patch: object}}
 */
export function draftSourceOf(entry, patch) {
  const image = (entry && entry.image) || {}
  const item = (entry && entry.item) || {}
  const params = (item && item.params) || {}
  const path = typeof image.path === 'string' && image.path
    ? image.path
    : (typeof image.file === 'string' ? image.file : '')
  const prompt = (typeof item.prompt === 'string' && item.prompt)
    || (typeof params.prompt === 'string' && params.prompt)
    || (typeof image.file === 'string' ? image.file : '')
  const cleanPatch = patch && typeof patch === 'object' ? { ...patch } : {}
  return { path, prompt, patch: cleanPatch }
}

/**
 * 「还原原图」补丁：来源作品回填时的原始参数。
 *
 * 没有来源或没有可还原字段时返回 null，调用方据此不展示 / 不执行还原入口。
 */
export function originalPatchOf(source) {
  const patch = source && source.patch && typeof source.patch === 'object' ? source.patch : null
  if (!patch || Object.keys(patch).length === 0) return null
  return { ...patch }
}

export const FORM_DRAFT_LRU_LIMIT = 20

/**
 * 比较当前表单与干净基准快照，拆出提示词与参数两项改动标记（与 `workDraftSummary` 对齐）。
 *
 * @param {object} form 当前表单
 * @param {string} baseline `formSnapshotOf()` 生成的基准 JSON 字符串
 * @returns {{ prompt: boolean, params: boolean }}
 */
export function formDraftChangesOf(form, baseline) {
  if (typeof baseline !== 'string' || baseline === '') return { prompt: false, params: false }
  let base
  try {
    base = JSON.parse(baseline)
  } catch {
    return { prompt: false, params: false }
  }
  const current = JSON.parse(formSnapshotOf(form))
  const promptChanged = textOf(current.prompt) !== textOf(base.prompt)
  const paramsChanged = Object.keys(current).some((key) => key !== 'prompt' && current[key] !== base[key])
  return { prompt: promptChanged, params: paramsChanged }
}

/**
 * 把左栏单作品表单草稿转成与 `workDraftSummary` 同构的摘要对象。
 *
 * @param {object|null} entry `{ source, form, baseline, changed, lastTouchedAt }`
 */
export function formDraftSummaryOf(entry) {
  const holder = entry && typeof entry === 'object' && entry.form ? entry : null
  if (!holder) {
    return {
      active: false,
      items: [],
      count: 0,
      hasMask: false,
      hasPrompt: false,
      hasParams: false,
      tool: 'form',
      lastTouchedAt: 0,
      coverage: 0,
    }
  }
  const computed = holder.changed && typeof holder.changed === 'object'
    ? holder.changed
    : formDraftChangesOf(holder.form, holder.baseline)
  let hasPrompt = computed.prompt === true
  let hasParams = computed.params === true
  // 兜底：若草稿存在但基准丢失，至少标记为参数草稿，避免圆点静默消失。
  if (!hasPrompt && !hasParams) hasParams = true
  const items = []
  if (hasPrompt) items.push('prompt')
  if (hasParams) items.push('params')
  const touched = Number(holder.lastTouchedAt)
  return {
    active: items.length > 0,
    items,
    count: items.length,
    hasMask: false,
    hasPrompt,
    hasParams,
    tool: 'form',
    lastTouchedAt: Number.isFinite(touched) ? touched : 0,
    coverage: 0,
  }
}

/**
 * 多作品左栏表单草稿表按 LRU 截断：最多保留 `limit` 条，淘汰 `lastTouchedAt` 最旧的。
 *
 * @param {Record<string, object>} drafts
 * @param {number} [limit]
 * @returns {Record<string, object>}
 */
export function lruWorkFormDrafts(drafts, limit = FORM_DRAFT_LRU_LIMIT) {
  const max = Number.isFinite(Number(limit)) && Number(limit) >= 0
    ? Math.floor(Number(limit))
    : FORM_DRAFT_LRU_LIMIT
  const entries = drafts && typeof drafts === 'object' ? Object.entries(drafts) : []
  const candidates = []
  entries.forEach(([key, entry], order) => {
    const path = typeof key === 'string' ? key.trim() : ''
    if (!path || !entry || typeof entry !== 'object' || !entry.form) return
    const touched = Number(entry.lastTouchedAt)
    candidates.push({ path, entry, touched: Number.isFinite(touched) ? touched : 0, order })
  })
  candidates.sort((left, right) => right.touched - left.touched || left.order - right.order)
  const kept = {}
  for (const item of candidates.slice(0, max)) kept[item.path] = item.entry
  return kept
}

/**
 * 合并舞台图片工具草稿表与左栏表单草稿表，供 Filmstrip / VersionPanel 统一亮圆点与展开行。
 *
 * @param {Record<string, object>} toolDrafts
 * @param {Record<string, object>} formDrafts
 * @returns {Record<string, object>}
 */
export function mergeWorkDrafts(toolDrafts, formDrafts) {
  const tools = toolDrafts && typeof toolDrafts === 'object' ? toolDrafts : {}
  const forms = formDrafts && typeof formDrafts === 'object' ? formDrafts : {}
  const keys = new Set([...Object.keys(tools), ...Object.keys(forms)])
  const merged = {}
  for (const key of keys) {
    const toolEntry = tools[key] && typeof tools[key] === 'object' ? tools[key] : null
    const formEntry = forms[key] && typeof forms[key] === 'object' && forms[key].form ? forms[key] : null
    if (!toolEntry && !formEntry) continue
    if (!formEntry) {
      merged[key] = toolEntry
      continue
    }
    const formSummary = formDraftSummaryOf(formEntry)
    if (!toolEntry) {
      merged[key] = {
        changed: {
          mask: false,
          prompt: formSummary.hasPrompt,
          params: formSummary.hasParams,
        },
        lastTouchedAt: formSummary.lastTouchedAt,
      }
      continue
    }
    const toolChanged = toolEntry.changed && typeof toolEntry.changed === 'object' ? toolEntry.changed : {}
    const toolMask = toolChanged.mask === true || Boolean(toolEntry.mask && textOf(toolEntry.mask.data))
    const toolPrompt = toolChanged.prompt === true
    const toolParams = toolChanged.params === true
    const toolTouched = Number(toolEntry.lastTouchedAt)
    merged[key] = {
      ...toolEntry,
      changed: {
        mask: toolMask,
        prompt: toolPrompt || formSummary.hasPrompt,
        params: toolParams || formSummary.hasParams,
      },
      lastTouchedAt: Math.max(Number.isFinite(toolTouched) ? toolTouched : 0, formSummary.lastTouchedAt),
    }
  }
  return merged
}

/**
 * 托管一次未提交编辑：返回新的草稿槽（主要用于纯空白画布草稿或单草稿兜底）。
 *
 * 已有草稿时用当前表单覆盖内容，来源沿用调用方传入的来源（没有就保留草稿原来的来源）。
 * 没有表单时保持原草稿不变。
 */
export function parkDraftOf(draft, source, form) {
  const prev = draft && typeof draft === 'object' && draft.form ? draft : null
  const shape = form && typeof form === 'object' ? form : null
  if (!shape) return prev
  const nextSource = source && typeof source === 'object'
    ? source
    : (prev && prev.source) || null
  return { source: nextSource, form: shape, editing: false }
}

/**
 * 草稿的展示摘要：只描述「当前正在编辑的表单」是否处于未提交草稿态。
 *
 * - 当 `origin` 指向某张作品时，完全以当前表单与该作品干净基准的比较（`dirty`）或匹配的
 *   托管草稿为准，不会被其它作品的草稿或空白画布草稿遮蔽 `source`；
 * - 当 `origin` 为空（纯空白新建画布）时，读取空白画布草稿或当前 `dirty` 状态。
 *
 * @param {{draft?: object|null, formDraft?: object|null, dirty?: boolean, origin?: object|null}} state
 */
export function draftViewOf(state = {}) {
  const draft = state.draft && typeof state.draft === 'object' && state.draft.form ? state.draft : null
  const formDraft = state.formDraft && typeof state.formDraft === 'object' && state.formDraft.form
    ? state.formDraft
    : null
  const origin = state.origin && typeof state.origin === 'object' ? state.origin : null
  if (origin && origin.path) {
    if (draft && draft.source && draft.source.path === origin.path && draft.editing === true) {
      return {
        active: true,
        parked: true,
        editing: true,
        source: origin,
        form: draft.form,
      }
    }
    if (state.dirty === true) {
      return {
        active: true,
        parked: Boolean(formDraft),
        editing: Boolean(formDraft),
        source: origin,
        form: null,
      }
    }
    return {
      active: false,
      parked: false,
      editing: false,
      source: origin,
      form: null,
    }
  }
  const blank = draft && !(draft.source && draft.source.path) ? draft : null
  const editingBlank = Boolean(blank && blank.editing === true)
  return {
    active: state.dirty === true || editingBlank,
    parked: Boolean(blank),
    editing: editingBlank,
    source: null,
    form: blank ? blank.form : null,
  }
}
