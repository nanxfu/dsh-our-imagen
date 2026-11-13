/** 最终提示词拼装：用户原文 + 风格后缀；负向提示词按来源分层合并。 */

/**
 * 把风格后缀追加到用户原文后面。
 *
 * - 原文为空时返回空串（生成前会被拦下并提示「先写提示词」）；
 * - 后缀为空时原样返回原文；
 * - 后缀已经出现在原文里时不重复追加（「带回参数」回填的提示词
 *   通常已包含后缀，避免再点一次风格就重复一遍）。
 */
export function composePrompt(base, suffix) {
  const head = String(base ?? '').trim()
  const tail = String(suffix ?? '').trim()
  if (!head) return ''
  if (!tail) return head
  if (head.includes(tail)) return head
  return `${head}, ${tail}`
}

// ---- 负向提示词分层 --------------------------------------------------------
//
// 负向提示词有三个来源，修改其中一层时不能误伤另外两层：
//   model —— 当前预设推荐的 negativeHint（切换预设时整层替换，无推荐值时清空）；
//   style —— 当前风格自带的排除词（切换/取消风格只增删这一层）；
//   user  —— 用户手写或历史回填的整段负向提示词。
//
// 表单里展示与最终提交的都是三层去重合并后的结果，因此「切到无负向预设残留旧词」
// 和「取消风格误清模型负向词」这两个旧问题在数据层就消失了。

const NEGATIVE_LAYER_ORDER = ['model', 'style', 'user']

/** 空的三层结构：每次返回新对象，避免调用方共享可变状态。 */
export function emptyNegativeLayers() {
  return { model: '', style: '', user: '' }
}

function layerText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 归一化三层：非字符串与缺失字段一律按空串处理。 */
export function normalizeNegativeLayers(layers) {
  const source = layers && typeof layers === 'object' ? layers : {}
  const next = emptyNegativeLayers()
  for (const name of NEGATIVE_LAYER_ORDER) next[name] = layerText(source[name])
  return next
}

/** 负向词按逗号（含全角逗号、顿号、分号）切分并 trim。 */
export function splitNegativeTerms(text) {
  return String(text ?? '')
    .split(/[,，、;；]/)
    .map((term) => term.trim())
    .filter(Boolean)
}

/**
 * 三层合并：按 model → style → user 顺序拼接，按不区分大小写去重，保留首次出现。
 * 输出统一用「英文逗号 + 空格」分隔，与提示词拼装口径一致。
 */
export function mergeNegativeLayers(layers) {
  const source = normalizeNegativeLayers(layers)
  const seen = new Set()
  const terms = []
  for (const name of NEGATIVE_LAYER_ORDER) {
    for (const term of splitNegativeTerms(source[name])) {
      const key = term.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      terms.push(term)
    }
  }
  return terms.join(', ')
}

/**
 * 从表单解析三层数据。
 *
 * 新状态始终带 `negativeLayers`；只有旧状态（升级前的草稿/测试输入）才只有
 * `negative`：此时若它正好等于上一个预设的 negativeHint，就归到 model 层，
 * 否则按用户手写处理。这样旧数据切换预设时也能复现新语义。
 */
export function resolveNegativeLayers(form, presets) {
  const input = form && typeof form === 'object' ? form : {}
  if (input.negativeLayers && typeof input.negativeLayers === 'object') {
    return normalizeNegativeLayers(input.negativeLayers)
  }
  const negative = layerText(input.negative)
  if (!negative) return emptyNegativeLayers()
  const list = Array.isArray(presets) ? presets : []
  const previous = list.find((item) => item && item.id === input.presetId)
  const hint = previous && typeof previous.negativeHint === 'string' ? previous.negativeHint.trim() : ''
  if (hint && negative === hint) return { model: negative, style: '', user: '' }
  return { model: '', style: '', user: negative }
}

/** 表单补丁：把三层数据同步到展示文本（提交时还会再合并一次）。 */
export function negativeLayersPatch(layers) {
  const next = normalizeNegativeLayers(layers)
  return { negativeLayers: next, negative: mergeNegativeLayers(next) }
}

/** 最终提交用的负向提示词：有三层数据就用合并结果，否则退回旧字段。 */
export function negativePromptOf(form) {
  const input = form && typeof form === 'object' ? form : {}
  if (input.negativeLayers && typeof input.negativeLayers === 'object') {
    return mergeNegativeLayers(input.negativeLayers)
  }
  return layerText(input.negative)
}

/**
 * 英译响应归一：只有 `source='model'` 且返回非空 prompt 才算真的翻译成功。
 *
 * `source='local'` 表示宿主模型不可用、返回的是原文；旧宿主忽略 mode 时返回的是
 * refine 结构（没有 prompt）。这两种情况都必须让前端明确提示「未翻译」，
 * 绝不能把原文写回表单假装成功。
 */
export function translateOutcomeOf(data) {
  const holder = data && typeof data === 'object' ? data : null
  const prompt = holder && typeof holder.prompt === 'string' ? holder.prompt.trim() : ''
  if (!holder || holder.source !== 'model' || !prompt) return { ok: false, prompt: '' }
  return { ok: true, prompt }
}

/**
 * 表单状态补丁的负向同步：`patchForm()` 只需要这一个入口。
 *
 * - 带 `negativeLayers`：以层数据为准，展示文本同步为合并结果；
 * - 只带 `negative`（用户编辑 / 历史回填）：整段写入 user 层。用户直接改展示文本时
 *   模型层与风格层已包含在这段文本里，若继续保留会在合并时重新插入用户删掉的词，
 *   所以这里整段接管（回填也因此能逐字复现）。
 */
export function applyNegativePatch(form, partial) {
  const prev = form && typeof form === 'object' ? form : {}
  const patch = partial && typeof partial === 'object' ? partial : {}
  if (patch.negativeLayers && typeof patch.negativeLayers === 'object') {
    const layers = normalizeNegativeLayers(patch.negativeLayers)
    return {
      ...prev,
      ...patch,
      negativeLayers: layers,
      negative: typeof patch.negative === 'string' ? patch.negative : mergeNegativeLayers(layers),
    }
  }
  if (typeof patch.negative === 'string') {
    return {
      ...prev,
      ...patch,
      negativeLayers: { model: '', style: '', user: patch.negative },
    }
  }
  return { ...prev, ...patch }
}

/**
 * 切换风格预设：只增删 style 层，model 层与 user 层一律保留。
 *
 * 旧实现把三层揉成一个字符串比较，取消风格时会把模型推荐词一起清掉；
 * 现在 style 层是独立字段，取消时只移除它自己写入的词。
 */
export function toggleStyle(form, capsule) {
  const prev = form && typeof form === 'object' ? form : {}
  if (!capsule || !capsule.id) return { ...prev }
  const layers = resolveNegativeLayers(prev)
  if (prev.styleId === capsule.id) {
    return { ...prev, styleId: '', ...negativeLayersPatch({ ...layers, style: '' }) }
  }
  return {
    ...prev,
    styleId: capsule.id,
    ...negativeLayersPatch({ ...layers, style: layerText(capsule.negative) }),
  }
}
