/**
 * 创作面板表单的纯逻辑：脏判定与「新建创作」重置补丁。
 *
 * 「脏」的语义是「表单里有还没提交生成、也没从作品回填过的手动修改」：
 *  - 刚打开、刚生成完、刚从胶卷或画廊回填完 → 干净，点击胶卷可以放心覆盖；
 *  - 用户改过提示词 / 参数但还没点生成 → 脏，点击胶卷只换预览、保留草稿。
 *
 * 判定方式是与「干净基准快照」逐字段比较，而不是一改就置脏：
 * 用户把值改回原样后仍然是干净的，不会因为点过一下输入框就永久失去自动回填。
 * 回填与重置只在这里算补丁，hook 负责落状态、维护基准与微调来源。
 */

import { LIMITS } from '../../shared/contract.js'
import { negativePromptActive } from '../../shared/models-guide.js'

import { maskDigestOf } from './mask.js'
import { hintOf } from './preset.js'
import { negativeLayersPatch, normalizeNegativeLayers } from './prompt.js'

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
 * 蒙版快照：优先用表单里已经算好的指纹，避免每次渲染都对几 MB 的 base64 重新哈希。
 * 外部直接塞字符串（没有指纹）时才现算。
 */
function maskSnapshot(mask) {
  if (!mask) return ''
  if (typeof mask === 'object' && typeof mask.digest === 'string' && mask.digest) return mask.digest
  const data = typeof mask === 'object' ? mask.data : mask
  return maskDigestOf(data)
}

/** 参考图归一成可比较的五元组（路径 / 缩略图 / 宽高 / 蒙版指纹）；没有参考图时是 null。 */
function referenceSnapshot(reference) {
  if (!reference || typeof reference !== 'object') return null
  return [
    textOf(reference.path).trim(),
    textOf(reference.url),
    numberish(reference.width),
    numberish(reference.height),
    // 蒙版也是未提交的手动修改：涂完还没生成就切胶卷，同样要按草稿保护处理。
    maskSnapshot(reference.mask),
  ]
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
  snapshot.strength = numberish(input.strength)
  snapshot.reference = referenceSnapshot(input.reference)
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
 * 只清掉绑定到上一张具体作品的状态：提示词、参考图、固定种子、排除项回落到
 * 当前预设的默认推荐状态。模型预设与画幅比例是用户下一张还要用的常用设置，保留不动。
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
    reference: null,
    seed: '',
    strength: LIMITS.strength.default,
    ...negativeLayersPatch(layers),
  }
}
