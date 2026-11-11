/**
 * 风格预设：点击后在提示词尾部注入对应的风格词，并补齐通用排除项。
 *
 * 词表是本地常量，不依赖模型；名称走字典（labelKey），
 * 这样中英文与其余界面文案同一套来源。
 *
 * 面板上的小样由 plates.jsx 按同一个 id 画（试印条），这里只管文案与词表。
 */

export const STYLE_CAPSULES = [
  {
    id: 'film',
    labelKey: 'studio.style.photo',
    suffix: 'cinematic film photography, 35mm, natural skin texture, soft grain',
    negative: 'blurry, low quality, distorted, text, watermark',
  },
  {
    id: 'concept',
    labelKey: 'studio.style.concept',
    suffix: 'concept art, painterly, dramatic lighting, detailed brushwork',
    negative: 'photo, blurry, low quality, text, watermark',
  },
  {
    id: 'cyberpunk',
    labelKey: 'studio.style.cyberpunk',
    suffix: 'cyberpunk neon city, volumetric light, reflective surfaces, night atmosphere',
    negative: 'daylight, blurry, low quality, deformed, text',
  },
  {
    id: 'ink',
    labelKey: 'studio.style.ink',
    suffix: 'traditional chinese ink wash painting, rice paper texture, negative space',
    negative: 'photo, 3d, saturated colors, blurry, text',
  },
  {
    id: 'clay',
    labelKey: 'studio.style.clay',
    suffix: 'clay render, soft studio light, pastel palette, playful proportions',
    negative: 'photo, harsh shadows, blurry, distorted, text',
  },
]