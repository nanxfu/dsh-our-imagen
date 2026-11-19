/**
 * 工作台跨侧边栏切换的会话级持久化（sessionStorage）。
 *
 * 宿主切换侧栏入口时 `Studio` 会卸载重建，因此把当前焦点（work / new_draft / selectedPath）、
 * 左栏多作品草稿、空白画布草稿与工具草稿存到 `sessionStorage`：
 *  - 同标签页切走再切回自动恢复刚才正在看的作品与未提交草稿；
 *  - 测试环境（Node 下无 sessionStorage）静默退化为无操作；
 *  - 写入遭遇配额限制时优先保住轻量表单草稿与焦点状态。
 */

export const STUDIO_SESSION_KEY = 'our-imagen.studio.session.v1'

function storageOf() {
  try {
    if (typeof window !== 'undefined' && window && window.sessionStorage) return window.sessionStorage
  } catch {
    // 隐私模式或受限上下文拒绝访问 storage 时静默退化。
  }
  return null
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function readStudioSession() {
  const storage = storageOf()
  if (!storage || typeof storage.getItem !== 'function') return null
  try {
    const raw = storage.getItem(STUDIO_SESSION_KEY)
    if (!raw || typeof raw !== 'string') return null
    const parsed = JSON.parse(raw)
    return safeObject(parsed)
  } catch {
    return null
  }
}

export function writeStudioSession(snapshot) {
  const storage = storageOf()
  const payload = safeObject(snapshot)
  if (!storage || typeof storage.setItem !== 'function' || !payload) return false
  try {
    storage.setItem(STUDIO_SESSION_KEY, JSON.stringify(payload))
    return true
  } catch {
    // 蒙版 base64 过大触发配额超限时，退一步只保存表单草稿与焦点状态。
    try {
      const compact = { ...payload, imageToolWorkDrafts: {} }
      storage.setItem(STUDIO_SESSION_KEY, JSON.stringify(compact))
      return true
    } catch {
      return false
    }
  }
}

export function clearStudioSession() {
  const storage = storageOf()
  if (!storage || typeof storage.removeItem !== 'function') return false
  try {
    storage.removeItem(STUDIO_SESSION_KEY)
    return true
  } catch {
    return false
  }
}
