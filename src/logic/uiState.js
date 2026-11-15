/**
 * 工作台界面态的纯逻辑：归一化、保存补丁与响应解析。
 *
 * 界面态只是体验优化，不是业务数据：白名单字段与归一函数均来自 shared/validation.js，
 * Host（归一 / 落盘）与 Client（初始化 / 归一）引用同一份口径。
 * 不依赖 React / DOM，方便 check-client-logic 离线断言。
 */

import {
  UI_STATE_FIELDS,
  buildUiStatePatch,
  normalizeUiState,
} from '../../shared/validation.js'

export { UI_STATE_FIELDS, buildUiStatePatch, normalizeUiState }

/**
 * 界面态响应 → 归一化视图。
 *
 * 契约形状是 `{ ok: true, uiState: view }`；形状不对返回 null，由调用方静默回落默认值
 * （读取失败不影响出图主链路，也不该弹错误提示）。
 */
export function uiStateViewOf(result) {
  if (!result || result.ok !== true) return null
  const data = result.data && typeof result.data === 'object' ? result.data : null
  if (!data || data.ok !== true) return null
  const view = data.uiState
  if (!view || typeof view !== 'object' || Array.isArray(view)) return null
  return normalizeUiState(view)
}
