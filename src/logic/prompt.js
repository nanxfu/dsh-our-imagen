/** 最终提示词拼装：用户原文 + 风格后缀。 */

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

/**
 * 切换风格预设：选中时补齐该风格的负向提示词，取消时把它写入的负向一并收回；
 * 用户自己编辑过负向提示词时不动。
 */
export function toggleStyle(form, capsule) {
  const prev = form || {}
  if (!capsule || !capsule.id) return { ...prev }
  if (prev.styleId === capsule.id) {
    return {
      ...prev,
      styleId: '',
      negative: prev.negative === capsule.negative ? '' : prev.negative,
    }
  }
  return {
    ...prev,
    styleId: capsule.id,
    negative: String(prev.negative ?? '').trim() ? prev.negative : capsule.negative,
  }
}