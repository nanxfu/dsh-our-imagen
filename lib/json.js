/**
 * 从模型输出里抽出第一个完整的 JSON 对象。
 *
 * 模型经常在 JSON 前后加解释文字或 Markdown 代码围栏；这里按花括号配对扫描，
 * 跳过字符串内部与转义字符，取到第一个配平的对象就解析。
 */

export function extractJsonObject(raw) {
  const text = String(raw ?? '')
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}