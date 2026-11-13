/**
 * 工作台界面态的纯逻辑：归一化、保存补丁与响应解析。
 *
 * 界面态只是体验优化，不是业务数据：白名单字段与默认值来自 shared/contract.js 的
 * UI_STATE，Host（归一 / 落盘）与 Client（初始化 / 归一）引用同一份口径。
 * 不依赖 React / DOM，方便 check-client-logic 离线断言。
 */

import { UI_STATE } from '../../shared/contract.js'

/** 已登记的白名单字段（顺序与 UI_STATE.defaults 一致）。 */
export const UI_STATE_FIELDS = Object.keys(UI_STATE.defaults)

/**
 * 归一化界面态：只保留已登记字段，类型不符回落默认值，未知字段一律丢弃。
 * 入参可能是损坏的文件内容、旧版本或宿主响应，任何形状都不应抛异常。
 */
export function normalizeUiState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const view = {}
  for (const field of UI_STATE_FIELDS) {
    const fallback = UI_STATE.defaults[field]
    view[field] = typeof source[field] === typeof fallback ? source[field] : fallback
  }
  return view
}

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

/**
 * 保存补丁：只保留白名单字段且类型正确，未知字段与错误类型一律丢弃。
 * 返回扁平对象（例如 `{ advancedOpen: true }`）；没有可提交字段时返回空对象。
 */
export function buildUiStatePatch(partial) {
  const source = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {}
  const patch = {}
  for (const field of UI_STATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue
    if (typeof source[field] !== typeof UI_STATE.defaults[field]) continue
    patch[field] = source[field]
  }
  return patch
}
