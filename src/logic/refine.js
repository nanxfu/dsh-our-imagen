/**
 * 润色标签的追加与撤销。
 *
 * 标签就是普通短语，直接拼在提示词尾部；再次点击同一标签要能撤掉。
 * 撤销只删最后一次出现的那一段，避免把用户自己写的同名片段全删掉。
 */

const CJK = /[\u3400-\u9fff]/

/** 中英文混排时用全角逗号，否则用半角逗号加空格。 */
export function refineSeparator(prompt) {
  return CJK.test(String(prompt ?? '')) ? '，' : ', '
}

export function isRefineApplied(prompt, term) {
  const text = String(prompt ?? '')
  const value = String(term ?? '').trim()
  if (!value) return false
  return text.includes(value)
}

export function toggleRefineTerm(prompt, term, separator) {
  const text = String(prompt ?? '')
  const value = String(term ?? '').trim()
  if (!value) return text

  const sep = typeof separator === 'string' && separator ? separator : refineSeparator(text)
  const index = text.lastIndexOf(value)
  if (index >= 0) {
    let start = index
    let end = index + value.length
    if (text.slice(start - sep.length, start) === sep) start -= sep.length
    else if (text.slice(end, end + sep.length) === sep) end += sep.length
    return (text.slice(0, start) + text.slice(end)).trim()
  }

  const trimmed = text.replace(/\s+$/, '')
  if (!trimmed) return value
  if (/[，,、;；]$/.test(trimmed)) return trimmed + value
  return trimmed + sep + value
}