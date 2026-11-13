/**
 * 提示词相关路由：润色（enhance）与自然语言意图解析（intent）。
 *
 * 路径与方法取自 `shared/contract.js` 的 ROUTES（唯一来源）。
 */

import { ENHANCE_MODES, LIMITS, ROUTES } from '../../shared/contract.js'
import { enhancePrompt } from '../enhance.js'
import { sendError, sendJson } from '../http.js'
import { parseIntent } from '../intent.js'
import { readBodyOr } from '../route-kit.js'

/**
 * @param {{ ctx: object, log: object }} deps
 */
export function createPromptRoutes({ ctx, log }) {
  return [
    {
      name: 'enhance',
      path: ROUTES.enhance.path,
      method: ROUTES.enhance.method,
      async handler(req, res) {
        const body = await readBodyOr(req, {}, log)
        // mode 取值域由契约 ENHANCE_MODES 定义；缺失/非法一律按 refine（向后兼容旧客户端）。
        const mode = ENHANCE_MODES.includes(body?.mode) ? body.mode : 'refine'
        const result = await enhancePrompt(ctx, body?.prompt, {
          locale: body?.locale === 'en' ? 'en' : 'zh',
          presetId: typeof body?.presetId === 'string' ? body.presetId : '',
          mode,
        })
        // refine 保持旧的 { ok, source, groups } 形状；translate 额外回显 mode 供前端分支。
        sendJson(res, 200, mode === 'translate' ? { ok: true, mode, ...result } : { ok: true, ...result })
      },
    },
    {
      name: 'intent',
      path: ROUTES.intent.path,
      method: ROUTES.intent.method,
      async handler(req, res) {
        const body = await readBodyOr(req, {}, log)
        const text = typeof body?.text === 'string' ? body.text.trim() : ''
        if (!text) return sendError(res, 400, 'invalid_request', '对话内容不能为空')
        if (text.length > LIMITS.intentText.maxChars) return sendError(res, 400, 'invalid_request', '对话内容过长')
        const result = await parseIntent(ctx, {
          text,
          previousPrompt: typeof body?.previousPrompt === 'string' ? body.previousPrompt : '',
          locale: body?.locale === 'en' ? 'en' : 'zh',
          // 预设决定英文提示词的书写口径（danbooru / natural / concise 与质量词前缀）。
          presetId: typeof body?.presetId === 'string' ? body.presetId : '',
        })
        sendJson(res, 200, { ok: true, ...result })
      },
    },
  ]
}