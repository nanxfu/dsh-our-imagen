/**
 * 润色标签的追加与撤销。
 *
 * 标签是独立短语，追加时与其他短语用分隔符隔开；撤销时只删「独立成段」的那一处，
 * 不碰用户句子里恰好包含同一个词的情况（例如原文「霓虹灯光效」里的「灯光」）。
 */

const SEPARATOR_CHARS = /[，,、;；\n\r\t ]/

const CJK = /[\u3400-\u9fff]/

function isBoundary(char) {
  return char === undefined || SEPARATOR_CHARS.test(char)
}

/** 找一个前后都是分隔符（或字符串边界）的完整短语；重复出现时取最后一次。 */
function findDelimited(text, term) {
  let index = text.lastIndexOf(term)
  while (index >= 0) {
    if (isBoundary(text[index - 1]) && isBoundary(text[index + term.length])) return index
    index = index > 0 ? text.lastIndexOf(term, index - 1) : -1
  }
  return -1
}

/** 中英文混排时用全角逗号，否则用半角逗号加空格。 */
export function refineSeparator(prompt) {
  return CJK.test(String(prompt ?? '')) ? '，' : ', '
}

export function isRefineApplied(prompt, term) {
  const text = String(prompt ?? '')
  const value = String(term ?? '').trim()
  if (!value) return false
  return findDelimited(text, value) >= 0
}

export function toggleRefineTerm(prompt, term, separator) {
  const text = String(prompt ?? '')
  const value = String(term ?? '').trim()
  if (!value) return text

  const sep = typeof separator === 'string' && separator ? separator : refineSeparator(text)
  const index = findDelimited(text, value)
  if (index >= 0) {
    let start = index
    let end = index + value.length
    // 连同紧邻的一组分隔符一起删掉，避免留下悬空逗号或多余空格。
    while (start > 0 && SEPARATOR_CHARS.test(text[start - 1])) start -= 1
    if (start === index) {
      while (end < text.length && SEPARATOR_CHARS.test(text[end])) end += 1
    }
    return (text.slice(0, start) + text.slice(end)).trim()
  }

  const trimmed = text.replace(/\s+$/, '')
  if (!trimmed) return value
  if (/[，,、;；]$/.test(trimmed)) return trimmed + value
  return trimmed + sep + value
}