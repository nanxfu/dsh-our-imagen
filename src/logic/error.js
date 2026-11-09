/** 错误文案拼装。 */

import { localized } from '../i18n.js'

export function errorText(t, error) {
  if (!error) return ''
  if (error.code === 'need_prompt') return t('workbench.needPrompt')
  if (error.code === 'network') return t('error.network')
  const label = localized(t, `error.code.${error.code}`)
  const detail = error.message && error.message !== error.code ? String(error.message) : ''
  if (label && detail) return `${label} · ${detail}`
  if (label) return label
  if (detail) return detail
  return t('error.http')
}
