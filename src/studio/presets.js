/**
 * 工作台画面比例数据。
 *
 * 0.10.0 起删除静态「风格预设」：风格由提示词内容与模型本身表达，
 * 不再有风格词表、风格负向层与暗箱后缀拼接。
 *
 * id 清单与顺序来自 `shared/contract.js` 的 `RATIO_IDS`（唯一来源），
 * 本文件只保留「id → 像素」数据；分辨率档位（长边）由 `src/logic/preset.js`
 * 按预设的 `sizeOptions` 换算，不在本文件重复。
 *
 * 宽高必须落在 docs/SPEC.md 的约束里（8 的整数倍、256~1536），
 * 因此比例换算出的像素值都先钳制再使用。
 */

import { RATIO_IDS } from '../../shared/contract.js'

import { clampSize } from '../logic/clamp.js'

/** 画面比例 → 像素（按比例算出的近似值，使用前再钳到契约边界）。 */
const RATIO_SPECS = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1152, height: 864 },
  '3:4': { width: 864, height: 1152 },
}

export const DEFAULT_RATIOS = RATIO_IDS
  .map((id) => (RATIO_SPECS[id] ? { id, ...RATIO_SPECS[id] } : null))
  .filter(Boolean)

export function ratioToSize(ratio) {
  return { width: clampSize(ratio.width), height: clampSize(ratio.height) }
}
