/** 参数钳制：与 docs/SPEC.md 第 2 节的硬性约束一一对应。 */

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
  return Math.min(1536, Math.max(256, Math.round(number / 8) * 8))
}

export function parseSeed(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return -1
  const value = Number(raw)
  if (!Number.isFinite(value)) return -1
  const int = Math.trunc(value)
  if (int < 0) return -1
  return Math.min(int, 4294967295)
}
