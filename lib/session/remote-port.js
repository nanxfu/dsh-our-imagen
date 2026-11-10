/**
 * 远端出图端口（H5：远端出口收敛到会话层）。
 *
 * 边界：只做「取会话连接 + 展开预设 + 构造 tasks 载荷 + 调 remote / 空结果判定」。
 * 状态机、排队、落盘都不在这里；JobQueue 只依赖本函数与会话的 `connection()`，
 * 不再 import `remote.requestGenerate`，也不再自己拼远端载荷。
 *
 * 为什么是独立函数而不是 SessionManager 方法：既有的离线测试用一个只实现
 * `connection/snapshot/...` 的假会话回归"底层传输失败时保留会话错误码"，
 * 把端口做成独立函数，这个场景仍然走真实的传输失败路径，而不是变成 TypeError。
 *
 * 错误对象与文案与收敛前一致：session_absent（连接不可用）/ empty_result（无图片）。
 */

import { presetById } from '../presets.js'
import { requestGenerate } from '../remote.js'

/**
 * @param {object} options
 * @param {object} options.session SessionManager 实例（只用 connection()）
 * @param {object} options.ctx 宿主上下文
 * @param {string} options.presetId 预设 id
 * @param {object} options.params 已校验的生成参数（prompt/negativePrompt/seed/width/height/steps/cfg/count）
 * @param {number} options.timeoutMs 单次生成超时
 * @returns {Promise<{ results: object[], modelId: string }>}
 */
export async function requestJobGeneration({ session, ctx, presetId, params, timeoutMs }) {
  const { endpoint, token } = session.connection()
  if (!endpoint || !token) throw Object.assign(new Error('远端连接不可用'), { code: 'session_absent' })

  const preset = presetById(presetId)
  const tasks = Array.from({ length: params.count }, (_, index) => ({
    name: String(index + 1).padStart(2, '0'),
    prompt: params.prompt,
    negative_prompt: params.negativePrompt,
    seed: params.seed + index,
    width: params.width,
    height: params.height,
    steps: params.steps,
    cfg: params.cfg,
  }))

  const response = await requestGenerate(
    endpoint,
    token,
    { pipeline: preset.pipeline, modelId: preset.repo, tasks },
    timeoutMs,
    ctx,
  )
  const results = Array.isArray(response?.results) ? response.results : []
  if (results.length === 0) throw Object.assign(new Error('远端没有返回图片'), { code: 'empty_result' })
  return { results, modelId: response?.model_id ?? preset.repo }
}