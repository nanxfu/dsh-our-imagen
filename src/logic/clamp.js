/** 参数钳制：边界值来自 shared/contract.js 的 LIMITS（与 docs/SPEC.md 第 2 节一致）。 */

import { LIMITS } from '../../shared/contract.js'

export function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function clampSize(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1024
  const { min, max, step } = LIMITS.width
  return Math.min(max, Math.max(min, Math.round(number / step) * step))
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
