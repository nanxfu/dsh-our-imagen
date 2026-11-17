/**
 * 拖放事件的小工具（阶段十五 Phase A3 / Phase C2）。
 *
 * 舞台导入层与左栏参考图槽都要判断「这次拖拽带没带文件」并取出文件列表；
 * 不同浏览器给出的 `dataTransfer.types` / `items` 形态不一样，统一收在这里，
 * 两处调用只关心「有没有文件 / 有哪些文件」。
 */

/** `DataTransfer.types` 在部分浏览器里是数组、部分是 DOMStringList，统一成字符串数组。 */
export function dataTransferTypesOf(dataTransfer) {
  const types = dataTransfer && dataTransfer.types
  if (!types) return []
  if (typeof types === 'string') return [types]
  const out = []
  const length = Number(types.length) || 0
  for (let index = 0; index < length; index += 1) {
    const type = types[index]
    if (typeof type === 'string') out.push(type)
  }
  return out
}

/** 这次拖拽是否携带文件（拖文字 / 拖链接不显示导入层，也不拦默认行为）。 */
export function hasFilePayload(event) {
  const dataTransfer = event && event.dataTransfer
  if (!dataTransfer) return false
  if (dataTransferTypesOf(dataTransfer).includes('Files')) return true
  const files = dataTransfer.files
  if (files && Number(files.length) > 0) return true
  const items = dataTransfer.items
  if (items) {
    const length = Number(items.length) || 0
    for (let index = 0; index < length; index += 1) {
      if (items[index] && items[index].kind === 'file') return true
    }
  }
  return false
}

/** 从 DataTransfer 里按顺序取文件：优先 files，其次 items 里的文件项。 */
export function filesOf(dataTransfer) {
  const out = []
  const files = dataTransfer && dataTransfer.files
  if (files) {
    const length = Number(files.length) || 0
    for (let index = 0; index < length; index += 1) {
      if (files[index]) out.push(files[index])
    }
  }
  if (out.length > 0) return out
  const items = dataTransfer && dataTransfer.items
  if (items) {
    const length = Number(items.length) || 0
    for (let index = 0; index < length; index += 1) {
      const item = items[index]
      if (!item || item.kind !== 'file') continue
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
      if (file) out.push(file)
    }
  }
  return out
}
