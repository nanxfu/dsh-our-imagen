/**
 * 插件自身版本提示的派生逻辑（纯函数，不依赖 React / DOM）。
 *
 * 数据来源是宿主 `/state` 的 `update` 字段（`lib/update-check.js` 的快照）：
 *  - 只在 `hasUpdate === true` 且版本号非空时返回提示对象，客户端据此显示顶栏红点与弹层一行；
 *  - 不做版本比较（比较在宿主完成），这里只做形状归一与链接安全校验，旧宿主没有该字段时返回 null。
 *
 * @typedef {{
 *   latest: string,
 *   current: string,
 *   enginesDsh: string,
 *   releaseUrl: string,
 *   checkedAt: string | null,
 * }} UpdateNotice
 */

/** Release 链接只接受 https，避免宿主快照被篡改后把用户带到非预期地址。 */
function safeUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return ''
  return value
}

/**
 * 从宿主状态派生「有新版本」提示。
 *
 * @param {object | null | undefined} state `/state` 响应
 * @returns {UpdateNotice | null}
 */
export function updateOf(state) {
  const input = state && typeof state === 'object' ? state.update : null
  if (!input || typeof input !== 'object') return null
  if (input.hasUpdate !== true) return null
  const latest = typeof input.latest === 'string' ? input.latest.trim() : ''
  if (!latest) return null
  const current = typeof input.current === 'string' && input.current.trim()
    ? input.current.trim()
    : typeof state.version === 'string' ? state.version : ''
  const enginesDsh = typeof input.enginesDsh === 'string' ? input.enginesDsh.trim() : ''
  const checkedAt = typeof input.checkedAt === 'string' && input.checkedAt.trim() ? input.checkedAt.trim() : null
  return {
    latest,
    current,
    enginesDsh,
    releaseUrl: safeUrl(input.releaseUrl),
    checkedAt,
  }
}
