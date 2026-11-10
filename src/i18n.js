/** 翻译查询：字典回落、静态文案查询与局部化。 */

import { DICT } from './dict/index.js'

export function fallbackTranslate(lang) {
  const dict = lang && lang.toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
  return (key) => dict[key] ?? DICT.en[key] ?? key
}

export function translator(props) {
  if (props && typeof props.t === 'function') return props.t
  return fallbackTranslate(document.documentElement.lang)
}

export function localized(t, key) {
  const value = t(key)
  return typeof value === 'string' && value !== key ? value : ''
}
