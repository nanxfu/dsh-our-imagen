/** 参数钳制：边界值来自 shared/contract.js 的 LIMITS（与 docs/SPEC.md 第 2 节一致）。 */

import { LIMITS } from '../../shared/contract.js'
import { clampInt, clampNumber } from '../../shared/validation.js'

export { clampInt, clampNumber }

/**
 * 画面尺寸：合法输入按契约边界钳制，并对齐到 `LIMITS.width.step`。
 *
 * 缺失值（`''` / 纯空白 / null / undefined / 布尔）是「没有填写」，回退默认尺寸 1024，
 * 不能走 `Number('') === 0` 再钳到下限——否则清空输入框失焦会静默跳成 256。
 * 这里与 `clampStrength` 的缺失值约定保持一致；`clampSize('x') -> 1024` 的旧契约不变。
 */
export function clampSize(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return 1024
  if (typeof value === 'string' && value.trim() === '') return 1024
  const number = Number(value)
  if (!Number.isFinite(number)) return 1024
  const { min, max, step } = LIMITS.width
  return Math.min(max, Math.max(min, Math.round(number / step) * step))
}

/**
 * 重绘强度：先按契约边界钳制，再对齐到 `LIMITS.strength.step`（从 min 起算）。
 *
 * 滑块本身已按 step 取值，这里兜的是「表单被外部写入 / 旧状态残留」时的边界情况：
 * 越界钳到 min/max，非数字回落默认值，最后按 step 取最近档并清掉浮点噪声
 * （0.2 + 9 × 0.05 会得到 0.6500000000000001，不能原样进请求体）。
 */
export function clampStrength(value) {
  const { min, max, step, default: fallback } = LIMITS.strength
  // 缺失 / null / 空串是「没有填写」，不能用 Number() 当成 0 再钳到下限。
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(max, Math.max(min, number))
  const aligned = min + Math.round((clamped - min) / step) * step
  return Math.round(aligned * 1000) / 1000
}

export function parseSeed(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return -1
  const value = Number(raw)
  if (!Number.isFinite(value)) return -1
  const int = Math.trunc(value)
  if (int < 0) return -1
  return Math.min(int, LIMITS.seed.max)
}
