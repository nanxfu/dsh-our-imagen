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
 * 读取客户端表单的 CFG：只接受有限数字（或可转成有限数字的字符串），
 * 非法/缺失返回 undefined，由 `parseIntent` 回落到预设推荐值。
 */
function readCfg(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : undefined
}

/**
 * 裁剪对话历史：role 只允许 user/assistant，单条只接受字符串内容；
 * 非法项直接丢弃不报错，并按契约 `LIMITS.intentHistory` 截断条数与单条长度。
 */
function readHistory(value) {
  if (!Array.isArray(value)) return []
  const { maxMessages, maxMessageChars } = LIMITS.intentHistory
  const items = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (entry.role !== 'user' && entry.role !== 'assistant') continue
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (!content) continue
    items.push({ role: entry.role, content: content.slice(0, maxMessageChars) })
  }
  return items.slice(-maxMessages)
}

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
          // 预设决定英文提示词的书写口径与负向词能力。
          presetId: typeof body?.presetId === 'string' ? body.presetId : '',
          // cfg 是客户端当前表单的 CFG（决定 negative 是否生效）；history 是多轮上下文。
          cfg: readCfg(body?.cfg),
          history: readHistory(body?.history),
        })
        sendJson(res, 200, { ok: true, ...result })
      },
    },
  ]
}
