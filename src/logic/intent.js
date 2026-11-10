/**
 * 对话意图的纯逻辑：找上一轮描述、把解析结果映射成表单补丁与请求参数。
 *
 * 宿主返回的意图只描述「要画什么、用什么比例和风格」；
 * 这里不碰网络与 React，方便离线断言合并规则。
 */

/** 最近一条意图卡里的画面描述；没有就返回空串。 */
export function lastIntentPrompt(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message
      && message.role === 'assistant'
      && message.kind === 'intent'
      && typeof message.prompt === 'string'
      && message.prompt.trim()
    ) {
      return message.prompt.trim()
    }
  }
  return ''
}

/** 意图 → 表单补丁：提示词、像素尺寸、风格 id。 */
export function intentFormPatch(intent, ratios) {
  const patch = {}
  if (!intent || typeof intent !== 'object') return patch
  const prompt = typeof intent.prompt === 'string' ? intent.prompt.trim() : ''
  if (prompt) patch.prompt = prompt
  const ratio = (Array.isArray(ratios) ? ratios : []).find((item) => item && item.id === intent.ratioId)
  if (ratio) {
    patch.width = ratio.width
    patch.height = ratio.height
  }
  if (typeof intent.styleId === 'string' && intent.styleId) patch.styleId = intent.styleId
  return patch
}

/**
 * 意图 → 最终提示词：带上风格后缀。
 * 对话提交的提示词是显式值，不会再走表单的 composePrompt 拼接，
 * 所以风格词必须在这里合并进去。
 */
export function intentPrompt(intent, capsules) {
  const base = String(intent && intent.prompt ? intent.prompt : '').trim()
  if (!base) return ''
  const capsule = (Array.isArray(capsules) ? capsules : []).find((item) => item && item.id === intent.styleId)
  return capsule ? `${base}, ${capsule.suffix}` : base
}