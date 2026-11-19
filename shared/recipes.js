/**
 * 透明风格配方库：结构化数据 + 纯函数检索。
 *
 * 用途：Agent 在对话里遇到「日系手绘」「赛博霓虹」「极简海报」这类风格诉求时，
 * 先检索出可读的提示词模板与适配模型，再由 Agent 把模板显式改写进 `prompt`。
 *
 * 设计约束（与 0.10.0 删除静态风格后缀的决策一致）：
 *  - 本文件只提供「看得见的模板」，不替用户拼接任何样式后缀，也不做暗箱改写；
 *  - 模板里的 `{subject}` 是唯一占位符，由调用方替换成具体主体描述；
 *  - `recommendedPresets` 必须引用契约 `PRESETS` 中真实存在的预设 id，
 *    `promptTemplate` 按写法（promptStyle）分别给出，模板写法与模型资产口径一致
 *    （如 Danbooru 标签 / 自然语言 / 简短短语）。
 *
 * 本文件只允许纯数据与纯函数，不得 import `node:*`。
 */

import { LIMITS, PRESETS, RATIO_IDS } from './contract.js'

/** 模板占位符：配方模板里唯一的动态部分（主体描述）。 */
export const SUBJECT_PLACEHOLDER = '{subject}'

/** 风格分类（检索用的稳定 id + 界面可读名称）。 */
export const RECIPE_CATEGORIES = [
  { id: 'illustration', label: '插画' },
  { id: 'photography', label: '摄影' },
  { id: 'cinematic', label: '电影感' },
  { id: 'poster', label: '平面与海报' },
  { id: 'product', label: '产品与静物' },
  { id: 'concept', label: '概念场景' },
]

/** 配方检索的默认返回条数（上限由配方总数决定，不写死数字）。 */
const DEFAULT_SEARCH_LIMIT = 5

/**
 * 配方数据。
 *
 * 字段：
 *  - id：稳定英文标识；title：中文名称；category：风格分类 id（见 RECIPE_CATEGORIES）；
 *  - tags：中英文关键词，供检索与 Agent 判断匹配度；
 *  - recommendedPresets：适配的预设 id（必须存在于契约 PRESETS）；
 *  - ratioId：建议画面比例（必须存在于契约 RATIO_IDS）；
 *  - promptTemplate：按模型写法（promptStyle）给出的可读模板，含 `{subject}` 占位符；
 *  - negativePrompt：负向提示词建议（仅对支持负向词且 CFG > 0 的模型有意义）；
 *  - notes：中文使用说明，讲清这套风格靠哪些描述生效、要避免什么。
 */
export const RECIPES = [
  {
    id: 'anime-illustration',
    title: '日系二次元插画',
    category: 'illustration',
    tags: ['日系', '二次元', '动漫', '插画', '角色', 'anime', 'character', 'illustration'],
    recommendedPresets: ['anima-turbo-v1.1', 'sdxl-lightning'],
    ratioId: '3:4',
    promptTemplate: {
      danbooru:
        'masterpiece, best quality, {subject}, anime style, detailed eyes, clean lineart, soft lighting, pastel colors, simple background',
      concise:
        '{subject}, anime illustration, clean lineart, detailed eyes, soft lighting, pastel colors, simple background, high detail',
      natural:
        'An anime-style illustration of {subject}, clean lineart with soft pastel colors, detailed eyes, gentle lighting, simple background.',
    },
    negativePrompt:
      'nsfw, lowres, bad anatomy, bad hands, worst quality, low quality, jpeg artifacts, watermark, signature, text, extra digits',
    notes:
      'Danbooru 模板以标签短语组织，质量词前缀沿用 Anima Turbo v1.1 的 qualityPrefix；主体可以拆成人数、外貌、服装、动作等标签，不要写完整句子。',
  },
  {
    id: 'cyber-neon',
    title: '赛博霓虹夜景',
    category: 'cinematic',
    tags: ['赛博', '霓虹', '雨夜', '未来城市', '科技感', 'cyberpunk', 'neon', 'night'],
    recommendedPresets: ['z-image-turbo', 'flux2-klein-4b', 'flux2-klein-9b', 'sana-sprint-1.6b'],
    ratioId: '16:9',
    promptTemplate: {
      natural:
        'A cinematic night scene of {subject} in a cyberpunk city, neon signs reflecting on wet asphalt, rain, volumetric fog, teal and magenta light, wide shot, high detail.',
      concise:
        '{subject}, cyberpunk city at night, neon signs, rain, wet reflective asphalt, teal and magenta lighting, volumetric fog, cinematic wide shot',
    },
    negativePrompt: 'blurry, low quality, flat lighting, dull colors, watermark, text',
    notes:
      '色彩与氛围由「霓虹招牌 + 湿润反光 + 青品色调」这组正面描述决定；FLUX.2 / Z-Image / SANA-Sprint 不接受负向词，排除意图要写进正面描述。',
  },
  {
    id: 'photo-portrait',
    title: '写实人像摄影',
    category: 'photography',
    tags: ['人像', '写实', '摄影', '肖像', '真实感', 'portrait', 'photorealistic', 'photo'],
    recommendedPresets: ['z-image-turbo', 'flux2-klein-9b', 'flux2-klein-4b'],
    ratioId: '3:4',
    promptTemplate: {
      natural:
        'A photorealistic portrait of {subject}, natural skin texture, soft window light, shallow depth of field, 85mm lens look, neutral background, fine details.',
    },
    negativePrompt:
      'blurry, low quality, deformed, bad anatomy, over-smoothed skin, plastic skin, watermark, text',
    notes:
      '写实人像的关键在光线、镜头与皮肤质感；少用「beauty, perfect」这类过度修饰词，否则皮肤容易变成塑料感。',
  },
  {
    id: 'minimal-poster',
    title: '极简海报',
    category: 'poster',
    tags: ['极简', '海报', '留白', '平面', '排版', 'minimal', 'poster', 'graphic design'],
    recommendedPresets: ['z-image-turbo', 'flux2-klein-4b', 'sana-sprint-1.6b', 'sdxl-lightning'],
    ratioId: '3:4',
    promptTemplate: {
      natural:
        'A minimalist poster about {subject}, large empty space, restrained two-color palette, simple geometric shapes, clean centered composition, no text.',
      concise:
        '{subject}, minimalist poster, large negative space, two-color palette, simple geometric shapes, clean composition, no text',
    },
    negativePrompt: 'text, watermark, clutter, busy background, low quality, blurry',
    notes:
      '海报靠留白与配色，不靠堆元素；若需要直接在画面内渲染中英文标题排版，可优先使用 Z-Image Turbo。',
  },
  {
    id: 'watercolor-ink',
    title: '水墨水彩插画',
    category: 'illustration',
    tags: ['水墨', '水彩', '国风', '手绘', '留白', 'ink', 'watercolor', 'traditional'],
    recommendedPresets: ['anima-turbo-v1.1', 'z-image-turbo', 'sdxl-lightning'],
    ratioId: '3:4',
    promptTemplate: {
      danbooru:
        'masterpiece, best quality, {subject}, chinese ink painting, watercolor, wet brush strokes, rice paper texture, large negative space, muted colors',
      concise:
        '{subject}, chinese ink and watercolor painting, wet brush strokes, rice paper texture, large negative space, muted colors',
      natural:
        'A chinese ink and watercolor illustration of {subject}, wet brush strokes on rice paper texture, large negative space, muted earthy colors, hand-painted feel.',
    },
    negativePrompt:
      'lowres, bad anatomy, worst quality, low quality, watermark, text, oversaturated, photo',
    notes:
      '水墨效果靠笔触、纸纹与留白描述；颜色保持低饱和，避免「vibrant/colorful」把画面推回厚涂风。',
  },
  {
    id: 'product-stilllife',
    title: '产品静物摄影',
    category: 'product',
    tags: ['产品', '静物', '电商', '质感', 'product', 'still life', 'commercial'],
    recommendedPresets: ['flux2-klein-4b', 'flux2-klein-9b', 'z-image-turbo'],
    ratioId: '1:1',
    promptTemplate: {
      natural:
        'A commercial product photo of {subject}, studio lighting with soft shadows, seamless gradient background, sharp focus, subtle reflections, high-end catalog style.',
      concise:
        '{subject}, product photography, studio lighting, soft shadows, seamless gradient background, sharp focus, subtle reflections',
    },
    negativePrompt: 'blurry, low quality, distorted shape, cluttered background, watermark, text',
    notes:
      '电商图先控光与背景：柔光箱、渐变背景与清晰对焦比华丽形容词更重要；产品外形描述要具体、精确。',
  },
  {
    id: 'picture-book',
    title: '绘本童趣插画',
    category: 'illustration',
    tags: ['绘本', '童趣', '儿童', '插画', '温暖', 'picture book', 'children'],
    recommendedPresets: ['sdxl-lightning', 'sana-sprint-1.6b', 'anima-turbo-v1.1'],
    ratioId: '4:3',
    promptTemplate: {
      concise:
        '{subject}, children picture book illustration, warm colors, soft rounded shapes, simple background, gentle lighting, cheerful mood',
      danbooru:
        'masterpiece, best quality, {subject}, children picture book illustration, warm colors, soft shapes, simple background, gentle lighting',
      natural:
        'A children picture book illustration of {subject}, warm colors and soft rounded shapes, simple background, gentle lighting, cheerful and friendly mood.',
    },
    negativePrompt: 'scary, dark, horror, lowres, worst quality, watermark, text',
    notes:
      '儿童向画面要避免尖锐形状与暗色调；情绪词写成正面短语（warm、friendly、gentle），比写「不要可怕」更有效。',
  },
  {
    id: 'concept-landscape',
    title: '概念场景大景',
    category: 'concept',
    tags: ['场景', '概念', '风景', '大景', '世界观', 'landscape', 'concept art', 'environment'],
    recommendedPresets: ['flux2-klein-4b', 'z-image-turbo', 'sana-sprint-1.6b', 'anima-turbo-v1.1'],
    ratioId: '16:9',
    promptTemplate: {
      natural:
        'A concept art environment of {subject}, epic scale, layered depth, atmospheric perspective, dramatic sky, cinematic lighting, high detail.',
      concise:
        '{subject}, concept art environment, epic scale, layered depth, atmospheric perspective, dramatic sky, cinematic lighting',
      danbooru:
        'no humans, scenery, landscape, {subject}, epic scale, atmospheric perspective, dramatic sky, cinematic lighting, high detail',
    },
    negativePrompt: 'blurry, low quality, flat composition, watermark, text',
    notes:
      '大景先定地貌与天气，再补光影与大气透视；不要一次塞进太多建筑细节，否则画面容易糊成一片。',
  },
]

/** 风格分类 id → 中文名称；未知分类回落到 id 本身。 */
export function categoryLabelOf(id) {
  return RECIPE_CATEGORIES.find((item) => item.id === id)?.label ?? String(id ?? '')
}

/** 预设 id → 契约预设对象；未知 id 返回 null。 */
function presetOf(id) {
  return PRESETS.find((preset) => preset.id === id) ?? null
}

/**
 * 取某条配方在指定预设下的提示词模板。
 *
 * 模板按预设的 `promptStyle`（写法）选择；数据里缺少该写法时依次回落到
 * natural / concise / 第一条模板，保证调用方总能拿到可读文本。
 *
 * @param {object} recipe 配方
 * @param {object|string} preset 契约预设对象或预设 id
 * @returns {{ style: string, template: string } | null}
 */
export function templateFor(recipe, preset) {
  if (!recipe || !recipe.promptTemplate) return null
  const resolved = typeof preset === 'string' ? presetOf(preset) : preset
  const style = resolved?.promptStyle ?? 'natural'
  const templates = recipe.promptTemplate
  const template = templates[style] ?? templates.natural ?? templates.concise ?? Object.values(templates)[0]
  if (typeof template !== 'string') return null
  // 仅在模板确实来自该写法时才回显写法名，避免把回落模板标成错误的写法。
  const actualStyle = typeof templates[style] === 'string' ? style : 'natural'
  return { style: actualStyle, template }
}

/** 关键词分词：空格 / 逗号 / 顿号 / 斜杠统一拆分，去空去重。 */
function splitKeyword(keyword) {
  return [...new Set(
    String(keyword ?? '')
      .toLowerCase()
      .split(/[\s,，、;；/]+/)
      .filter(Boolean),
  )]
}

/** 配方的可检索文本（id / 名称 / 标签 / 分类 / 说明），已转小写。 */
function searchableTextOf(recipe) {
  return [
    recipe.id,
    recipe.title,
    categoryLabelOf(recipe.category),
    recipe.category,
    ...recipe.tags,
    recipe.notes,
    ...Object.values(recipe.promptTemplate),
  ]
    .join(' ')
    .toLowerCase()
}

/** 单个关键词是否命中配方：正向包含，或中文输入包含配方标签（如「日系手绘插画」命中「日系」）。 */
function keywordMatches(recipe, token) {
  if (searchableTextOf(recipe).includes(token)) return true
  return recipe.tags.some((tag) => {
    const normalized = String(tag).toLowerCase()
    return token.includes(normalized)
  })
}

/** 单个标签过滤是否命中：允许精确相等或相互包含（如「霓虹」命中标签「赛博霓虹」）。 */
function tagMatches(recipe, tag) {
  const wanted = String(tag).toLowerCase()
  return recipe.tags.some((item) => {
    const normalized = String(item).toLowerCase()
    return normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized)
  })
}

/** 把检索上限归一成 [1, RECIPES.length] 内的整数，非法值回落到默认条数。 */
function normalizeLimit(value) {
  const number = Number(value)
  const fallback = Math.min(DEFAULT_SEARCH_LIMIT, RECIPES.length)
  if (!Number.isFinite(number)) return fallback
  return Math.max(1, Math.min(RECIPES.length, Math.round(number)))
}

/** 空结果提示：告诉 Agent 下一步能怎么查，而不是只回一句「没有」。 */
function emptySearchHint() {
  return (
    `没有匹配的配方。可以换更宽泛的关键词（如 日系、写实、霓虹、海报），` +
    `或省略过滤条件查看全部 ${RECIPES.length} 条配方；` +
    `分类可选：${RECIPE_CATEGORIES.map((item) => `${item.label}（${item.id}）`).join('、')}。`
  )
}

/**
 * 检索配方（纯函数）。
 *
 * 过滤条件之间取交集；`keyword` 按空格/逗号分词后要求全部命中；
 * `tags` 数组同样要求全部命中；`limit` 超出配方总数时按总数截断。
 *
 * @param {object} [query]
 * @param {string} [query.keyword] 风格关键词，如「日系 插画」
 * @param {string} [query.category] 风格分类 id（见 RECIPE_CATEGORIES）
 * @param {string} [query.presetId] 按适配的预设 id 过滤
 * @param {string[]} [query.tags] 按标签过滤（全部命中）
 * @param {number} [query.limit] 返回条数
 * @returns {{ items: object[], total: number, limit: number, hint: string }}
 *   items 按配方声明顺序返回；无结果时 hint 给出下一步检索建议。
 */
export function searchRecipes(query = {}) {
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
  const category = typeof query.category === 'string' ? query.category.trim() : ''
  const presetId = typeof query.presetId === 'string' ? query.presetId.trim() : ''
  const filterTags = Array.isArray(query.tags)
    ? query.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : []
  const tokens = splitKeyword(keyword)
  const limit = normalizeLimit(query.limit)

  const matched = RECIPES.filter((recipe) => {
    if (tokens.length > 0 && !tokens.every((token) => keywordMatches(recipe, token))) return false
    if (category && recipe.category !== category) return false
    if (presetId && !recipe.recommendedPresets.includes(presetId)) return false
    if (filterTags.length > 0 && !filterTags.every((tag) => tagMatches(recipe, tag))) return false
    return true
  })

  return {
    items: matched.slice(0, limit),
    total: matched.length,
    limit,
    hint: matched.length === 0 ? emptySearchHint() : '',
  }
}

/**
 * 数据自检：供测试与排查使用，返回问题描述数组（空数组表示通过）。
 *
 * 校验「配方数据与契约一致」：预设 id 真实存在、比例合法、模板覆盖到每个
 * 推荐模型的写法、长度不超契约上限、id 不重复。
 *
 * @returns {string[]}
 */
export function validateRecipes() {
  const issues = []
  const seen = new Set()
  const presetIds = new Set(PRESETS.map((preset) => preset.id))
  const ratioIds = new Set(RATIO_IDS)

  for (const recipe of RECIPES) {
    const where = `配方 ${recipe.id ?? '（缺 id）'}`
    if (typeof recipe.id !== 'string' || recipe.id.trim() === '') {
      issues.push(`${where}：id 不能为空`)
    } else if (seen.has(recipe.id)) {
      issues.push(`${where}：id 重复`)
    } else {
      seen.add(recipe.id)
    }
    if (typeof recipe.title !== 'string' || recipe.title.trim() === '') {
      issues.push(`${where}：title 不能为空`)
    }
    if (!RECIPE_CATEGORIES.some((item) => item.id === recipe.category)) {
      issues.push(`${where}：category 未在 RECIPE_CATEGORIES 登记（${recipe.category}）`)
    }
    if (!Array.isArray(recipe.tags) || recipe.tags.length === 0) {
      issues.push(`${where}：tags 必须是非空数组`)
    }
    if (!Array.isArray(recipe.recommendedPresets) || recipe.recommendedPresets.length === 0) {
      issues.push(`${where}：recommendedPresets 必须是非空数组`)
      continue
    }
    for (const presetId of recipe.recommendedPresets) {
      if (!presetIds.has(presetId)) issues.push(`${where}：推荐预设不存在（${presetId}）`)
    }
    if (!ratioIds.has(recipe.ratioId)) {
      issues.push(`${where}：ratioId 不在契约 RATIO_IDS 内（${recipe.ratioId}）`)
    }
    if (typeof recipe.negativePrompt !== 'string') {
      issues.push(`${where}：negativePrompt 必须是字符串`)
    } else if (recipe.negativePrompt.length > LIMITS.negativePrompt.maxChars) {
      issues.push(`${where}：negativePrompt 超过 ${LIMITS.negativePrompt.maxChars} 字符`)
    }
    if (typeof recipe.notes !== 'string' || recipe.notes.trim() === '') {
      issues.push(`${where}：notes 不能为空`)
    }
    if (!recipe.promptTemplate || typeof recipe.promptTemplate !== 'object') {
      issues.push(`${where}：promptTemplate 必须是对象（按写法分键）`)
      continue
    }
    // 每个推荐模型的写法都必须有模板：Agent 拿到哪个模型都能读到对应口径的文本。
    for (const presetId of recipe.recommendedPresets) {
      const preset = presetOf(presetId)
      if (!preset) continue
      const template = recipe.promptTemplate[preset.promptStyle]
      if (typeof template !== 'string' || template.trim() === '') {
        issues.push(`${where}：缺少写法 ${preset.promptStyle}（${presetId}）的模板`)
        continue
      }
      if (!template.includes(SUBJECT_PLACEHOLDER)) {
        issues.push(`${where}：写法 ${preset.promptStyle} 的模板缺少 ${SUBJECT_PLACEHOLDER} 占位符`)
      }
      if (template.length > LIMITS.prompt.maxChars) {
        issues.push(`${where}：写法 ${preset.promptStyle} 的模板超过 ${LIMITS.prompt.maxChars} 字符`)
      }
    }
  }
  return issues
}
