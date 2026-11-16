/**
 * 版本号的归一化与比较（纯函数，不 import `node:*`，可被 Host 与浏览器 bundle 共用）。
 *
 * 只服务于「插件自身版本检查」这类展示与提示场景：
 *  - 远端来源（npm manifest）与本地来源（契约 VERSION / package.json）都是语义化版本；
 *  - 比较只取主版本号三段数字，预发布/构建后缀不参与排序（`0.12.0-beta` 与
 *    `0.12.0` 视为同一版本），避免把预发布误判成「有更新」。
 *
 * 这里不做完整 semver 能力（不支持 `^`/`~` 范围、不解析 `v` 前缀）：需要范围判断的
 * 地方（`engines.dsh`）由 DSH 自己在安装时校验，插件侧只把要求原样展示给用户。
 */

/** 语义化版本的最小合法形态：最多三段数字 + 可选预发布/构建后缀。 */
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/
/** 版本号长度上限：防止远端脏数据把状态快照撑大。 */
const MAX_VERSION_CHARS = 32

/** 归一化：合法返回去空白后的字符串，非法/空值返回 null。 */
export function normalizeVersion(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > MAX_VERSION_CHARS) return null
  return VERSION_PATTERN.test(text) ? text : null
}

/** 取主版本号三段（缺省的段落补 0）；不可解析返回 null。 */
export function parseVersionCore(value) {
  const text = normalizeVersion(value)
  if (!text) return null
  const core = text.split(/[-+]/, 1)[0]
  const parts = core.split('.').map((part) => Number(part))
  if (parts.length === 0 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

/**
 * 按主版本号三段比较。
 *
 * @returns {number | null} 1 = left 更新、0 = 相同、-1 = left 更旧；任一侧不可解析返回 null
 */
export function compareVersions(left, right) {
  const first = parseVersionCore(left)
  const second = parseVersionCore(right)
  if (!first || !second) return null
  for (let index = 0; index < 3; index += 1) {
    if (first[index] !== second[index]) return first[index] > second[index] ? 1 : -1
  }
  return 0
}

/** candidate 是否真的比 current 新（任一侧不可解析按「不更新」处理）。 */
export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) === 1
}
