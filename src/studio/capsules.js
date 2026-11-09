/**
 * 风格胶囊：点击后在提示词尾部注入对应的风格词，并补齐通用排除项。
 * 词表是本地常量，不依赖模型；后续要接 Harness 的模型扩写时，
 * 这里只作为「模型不可用」时的兜底。
 */

export const STYLE_CAPSULES = [
  {
    id: 'film',
    icon: '📷',
    zh: '真实胶片',
    en: 'Cinematic Film',
    suffix: 'cinematic film photography, 35mm, natural skin texture, soft grain',
    negative: 'blurry, low quality, distorted, text, watermark',
  },
  {
    id: 'concept',
    icon: '🎨',
    zh: '概念原画',
    en: 'Concept Art',
    suffix: 'concept art, painterly, dramatic lighting, detailed brushwork',
    negative: 'photo, blurry, low quality, text, watermark',
  },
  {
    id: 'cyberpunk',
    icon: '🌆',
    zh: '赛博霓虹',
    en: 'Cyberpunk',
    suffix: 'cyberpunk neon city, volumetric light, reflective surfaces, night atmosphere',
    negative: 'daylight, blurry, low quality, deformed, text',
  },
  {
    id: 'ink',
    icon: '🖌️',
    zh: '东方水墨',
    en: 'Ink Wash',
    suffix: 'traditional chinese ink wash painting, rice paper texture, negative space',
    negative: 'photo, 3d, saturated colors, blurry, text',
  },
  {
    id: 'clay',
    icon: '🧸',
    zh: '3D 黏土',
    en: 'Cute Clay',
    suffix: 'clay render, soft studio light, pastel palette, playful proportions',
    negative: 'photo, harsh shadows, blurry, distorted, text',
  },
]

/** 追加到提示词的快速增强项。 */
export const PROMPT_BOOSTS = [
  {
    id: 'light',
    icon: '✨',
    zh: '丰富光影与材质细节',
    en: 'Richer light and material detail',
    suffix: 'rich cinematic lighting, detailed materials, subtle reflections',
  },
  {
    id: 'cinema',
    icon: '🎬',
    zh: '增加电影级景深景别',
    en: 'Cinematic depth of field',
    suffix: 'cinematic composition, shallow depth of field, 35mm lens',
  },
]