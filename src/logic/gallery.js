/**
 * 画廊列布局的纯逻辑。
 *
 * CSS 多列（column-count）是列优先填充：最新作品会先填满左列，第一行读起来不是时间顺序。
 * 这里按「行优先」把条目分到固定数量的桶里，每个桶渲染成一列，
 * 第一行从左到右才是最新到更旧；列内部仍按自然高度堆叠，不裁切图片。
 */

/** 列数断点：与 gallery.css 的响应式断点（900 / 1180 / 1400）保持一致。 */
const COLUMN_BREAKPOINTS = [
  [900, 2],
  [1180, 3],
  [1400, 4],
]

/** 视口宽度 → 画廊列数；未知宽度按桌面 5 列。 */
export function galleryColumnCount(width) {
  const value = Number(width)
  if (!Number.isFinite(value) || value <= 0) return 5
  for (const [maxWidth, columns] of COLUMN_BREAKPOINTS) {
    if (value <= maxWidth) return columns
  }
  return 5
}

/**
 * 行优先分桶：条目按「新 → 旧」顺序依次落到 0、1、2… 列，再回到 0 列。
 *
 * @param {Array} items 已按时间倒序排好的条目
 * @param {number} columns 列数
 * @returns {Array<Array>} 每列一组，长度固定等于列数
 */
export function galleryColumns(items, columns) {
  const list = Array.isArray(items) ? items : []
  const count = Math.max(1, Math.floor(Number(columns)) || 1)
  const buckets = Array.from({ length: count }, () => [])
  list.forEach((item, index) => {
    buckets[index % count].push(item)
  })
  return buckets
}
