/**
 * 画面比例：给出常用成片比例与实际像素。
 *
 * 宽高必须落在 docs/SPEC.md 的约束里（8 的整数倍、256~1536），
 * 因此这里的像素值都先按比例算，再钳制。
 */

import { clampSize } from '../logic/clamp.js'

export const DEFAULT_RATIOS = [
  { id: '1:1', width: 1024, height: 1024 },
  { id: '16:9', width: 1152, height: 648 },
  { id: '9:16', width: 648, height: 1152 },
  { id: '4:3', width: 1024, height: 768 },
  { id: '3:4', width: 768, height: 1024 },
]

export function ratioToSize(ratio) {
  return { width: clampSize(ratio.width), height: clampSize(ratio.height) }
}