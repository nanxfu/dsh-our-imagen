/**
 * 工作台预设数据：风格胶囊与画面比例。
 *
 * id 清单与顺序来自 `shared/contract.js` 的 `STYLE_IDS` / `RATIO_IDS`（唯一来源），
 * 本文件只保留「id → 词表 / 像素」数据；风格小样由 Rail.jsx 的 StylePlate 按同一 id 画，
 * 这里不管视觉。
 *
 * 宽高必须落在 docs/SPEC.md 的约束里（8 的整数倍、256~1536），
 * 因此比例换算出的像素值都先钳制再使用。
 */

import { RATIO_IDS, STYLE_IDS } from '../../shared/contract.js'

import { clampSize } from '../logic/clamp.js'

/**
 * 风格词表：suffix 追加到提示词尾部，negative 是风格自带的通用排除项。
 * 名称走字典（labelKey），与其余界面文案同一套来源。
 */
const STYLE_SPECS = {
  film: {
    labelKey: 'studio.style.photo',
    suffix: 'cinematic film photography, 35mm, natural skin texture, soft grain',
    negative: 'blurry, low quality, distorted, text, watermark',
  },
  concept: {
    labelKey: 'studio.style.concept',
    suffix: 'concept art, painterly, dramatic lighting, detailed brushwork',
    negative: 'photo, blurry, low quality, text, watermark',
  },
  cyberpunk: {
    labelKey: 'studio.style.cyberpunk',
    suffix: 'cyberpunk neon city, volumetric light, reflective surfaces, night atmosphere',
    negative: 'daylight, blurry, low quality, deformed, text',
  },
  ink: {
    labelKey: 'studio.style.ink',
    suffix: 'traditional chinese ink wash painting, rice paper texture, negative space',
    negative: 'photo, 3d, saturated colors, blurry, text',
  },
  clay: {
    labelKey: 'studio.style.clay',
    suffix: 'clay render, soft studio light, pastel palette, playful proportions',
    negative: 'photo, harsh shadows, blurry, distorted, text',
  },
}

export const STYLE_CAPSULES = STYLE_IDS
  .map((id) => (STYLE_SPECS[id] ? { id, ...STYLE_SPECS[id] } : null))
  .filter(Boolean)

/** 画面比例 → 像素（按比例算出的近似值，使用前再钳到契约边界）。 */
const RATIO_SPECS = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1152, height: 648 },
  '9:16': { width: 648, height: 1152 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
}

export const DEFAULT_RATIOS = RATIO_IDS
  .map((id) => (RATIO_SPECS[id] ? { id, ...RATIO_SPECS[id] } : null))
  .filter(Boolean)

export function ratioToSize(ratio) {
  return { width: clampSize(ratio.width), height: clampSize(ratio.height) }
}
