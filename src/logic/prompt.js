/**
 * 提示词相关纯逻辑：负向提示词分层合并与提交门控、英译结果归一。
 *
 * 0.10.0 起提示词不再拼接任何「风格后缀」：用户写什么就发什么。
 */

// ---- 负向提示词分层 --------------------------------------------------------
//
// 负向提示词只有两个来源，修改其中一层时不能误伤另一层：
//   model —— 当前预设推荐的 negativeHint（切换预设时整层替换，无推荐值时清空）；
//   user  —— 用户手写或历史回填的整段负向提示词。
//
// 表单里展示与最终提交的都是两层去重合并后的结果，因此「切到无负向预设残留旧词」
// 这个旧问题在数据层就消失了。风格层随静态风格预设一起删除（0.10.0）。

const NEGATIVE_LAYER_ORDER = ['model', 'user']

/** 空的两层结构：每次返回新对象，避免调用方共享可变状态。 */
export function emptyNegativeLayers() {
  return { model: '', user: '' }
}

function layerText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 归一化两层：非字符串与缺失字段一律按空串处理。 */
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
 * 两层合并：按 model → user 顺序拼接，按不区分大小写去重，保留首次出现。
 * 输出统一用「英文逗号 + 空格」分隔。
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
 * 从表单解析两层数据。
 *
 * 新状态始终带 `negativeLayers`；只有旧状态（升级前的草稿/测试输入）才只有
 * `negative`：此时若它正好等于上一个预设的 negativeHint，就归到 model 层，
 * 否则按用户手写处理。
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
  if (hint && negative === hint) return { model: negative, user: '' }
  return { model: '', user: negative }
}

/** 表单补丁：把两层数据同步到展示文本（提交时还会再合并一次）。 */
export function negativeLayersPatch(layers) {
  const next = normalizeNegativeLayers(layers)
  return { negativeLayers: next, negative: mergeNegativeLayers(next) }
}

/** 最终提交用的负向提示词：有两层数据就用合并结果，否则退回旧字段。 */
export function negativePromptOf(form) {
  const input = form && typeof form === 'object' ? form : {}
  if (input.negativeLayers && typeof input.negativeLayers === 'object') {
    return mergeNegativeLayers(input.negativeLayers)
  }
  return layerText(input.negative)
}

/**
 * 提交门控：当前配置不使用负向词时一律提交空串，不发无效参数。
 *
 * `active` 来自 `shared/models-guide.js` 的 `negativePromptActive()`（Host 与 Client
 * 共用同一口径）；只在显式 `false` 时清空，旧调用方不传时保持原有提交行为。
 */
export function negativeForSubmit(form, active) {
  if (active === false) return ''
  return negativePromptOf(form)
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
 *   模型层已包含在这段文本里，若继续保留会在合并时重新插入用户删掉的词，
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
      negativeLayers: { model: '', user: patch.negative },
    }
  }
  return { ...prev, ...patch }
}
