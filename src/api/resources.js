/**
 * Host 资源访问层：把「哪个端点、什么方法、什么请求体」收在一处。
 *
 * 约定：
 *  - 每个函数只做 URL / 方法 / JSON body / 查询串拼装，返回值与 src/api.js 的 request()
 *    完全相同（{ ok, status, code, message } 或 { ok, status, data }），不引入新的 envelope；
 *  - 失败不抛异常，错误码与 message 原样交给调用方，由 UI 层决定 toast / 指引卡；
 *  - 路径唯一来源是 routePath(name)（shared/contract.js 的 ROUTES），这里不写路径字面量。
 */

import { LIMITS } from '../../shared/contract.js'

import { request, routePath } from '../api.js'

/** Host 状态快照（轮询用）。 */
export function fetchState() {
  return request(routePath('state'), { method: 'GET' })
}

/**
 * 远端运行日志增量拉取；since 为上次响应的 next（非负整数，从 0 开始）。
 * Host 始终回 HTTP 200，可用性看响应体的 ok（见 logic/logs.js 的 readLogsPayload）。
 */
export function fetchLogs(since = 0) {
  const cursor = Number.isFinite(Number(since)) && Number(since) > 0 ? Math.floor(Number(since)) : 0
  return request(`${routePath('logs')}?since=${cursor}`, { method: 'GET' })
}

/**
 * 历史分页：limit 每次取契约页长，offset 是已跳过的有效记录数（从 0 开始）。
 * 响应 `{ items, limit, offset, hasMore }` 由 useWorkLibrary 消费。
 */
export function fetchHistory(limit = LIMITS.history.pageSize, offset = 0) {
  const size = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(LIMITS.history.maxLimit, Math.floor(Number(limit)))
    : LIMITS.history.pageSize
  const start = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Math.floor(Number(offset)) : 0
  return request(`${routePath('history')}?limit=${size}&offset=${start}`, { method: 'GET' })
}

/** 收藏库列表。 */
export function fetchLibrary() {
  return request(routePath('library'), { method: 'GET' })
}

/** 启动云端会话。 */
export function startSession(presetId) {
  return request(routePath('sessionStart'), {
    method: 'POST',
    body: JSON.stringify({ presetId }),
  })
}

/** 关闭云端会话。 */
export function stopSession() {
  return request(routePath('sessionStop'), { method: 'POST' })
}

/** 提交一次生成任务。 */
export function submitGenerate(body) {
  return request(routePath('generate'), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * 取消任务；响应 `{ ok, job, disposition }`，disposition ∈ dequeued | cooperative | already-finished。
 * 路径只能走契约的 ROUTES.jobCancel，这里不写路径字面量。
 */
export function cancelJob(id) {
  return request(routePath('jobCancel'), {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

/**
 * 环境探测；signal 由调用方提供（45 秒超时与 AbortController 留在 useStudio）。
 */
export function runProbe(signal) {
  return request(routePath('probe'), {
    method: 'POST',
    ...(signal ? { signal } : {}),
  })
}

/**
 * 提示词增强：`mode='refine'`（缺省）返回四维英文短语建议；
 * `mode='translate'` 返回 `{ ok, mode, source, prompt }`，source='local' 表示没有真正翻译。
 */
export function enhancePromptRequest({ prompt, presetId, locale, mode } = {}) {
  const body = { prompt, presetId, locale }
  if (typeof mode === 'string' && mode) body.mode = mode
  return request(routePath('enhance'), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** 把一句话解析成生成参数。 */
export function parseIntentRequest({ text, previousPrompt, locale, presetId }) {
  return request(routePath('intent'), {
    method: 'POST',
    body: JSON.stringify({ text, previousPrompt, locale, presetId }),
  })
}

/** 在系统文件管理器里打开产物目录。 */
export function revealOutput() {
  return request(routePath('reveal'), { method: 'POST', body: JSON.stringify({}) })
}

/** 设置/取消单张作品的收藏。 */
export function favoriteImage(path, favorite) {
  return request(routePath('libraryFavorite'), {
    method: 'POST',
    body: JSON.stringify({ path, favorite }),
  })
}

/** 删除一批产物文件。 */
export function deleteImages(paths) {
  return request(routePath('libraryDelete'), {
    method: 'POST',
    body: JSON.stringify({ paths }),
  })
}