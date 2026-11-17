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
import { loginActionBody } from '../logic/kaggleLogin.js'

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

/**
 * 版本树按需拉取：`GET /history/tree?root=&limit=`（阶段十三）。
 *
 * 返回 `{ ok, data: { root, items, hasMore } }`；`items` 与 /history 同形，
 * 调用方直接并入已加载分页即可。旧宿主没有该路由时返回 HTTP 404
 * （`status: 404` / `code: 'http_404'`），由调用方降级成「仅用已加载分页」
 * 并在版本面板提示不可用，这里不做特殊处理。
 *
 * root 必须是 Host 归一过的 `imagen-output/<目录>/<文件>` 相对路径；
 * 空串直接返回失败、不发请求（Host 会回 400，但没必要多跑一趟）。
 */
export function fetchHistoryTree(root, limit = LIMITS.history.pageSize) {
  const value = typeof root === 'string' ? root.trim() : ''
  if (!value) {
    return Promise.resolve({ ok: false, status: 0, code: 'invalid_request', message: 'root 不能为空' })
  }
  const size = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(LIMITS.history.maxLimit, Math.floor(Number(limit)))
    : LIMITS.history.pageSize
  return request(`${routePath('historyTree')}?root=${encodeURIComponent(value)}&limit=${size}`, { method: 'GET' })
}

/**
 * 启动云端会话。
 *
 * - forceNew=true：跳过接管旧排队，强制推送新 Kernel；
 * - replace=true：换新实例重排，Host 会删除排不上的旧 Kernel 再推新 Kernel。
 *
 * 旧 Host 不识别 replace 时按普通启动处理（忽略未知字段），客户端不做额外分支。
 */
export function startSession(presetId, options = {}) {
  const body = { presetId }
  if (options && options.forceNew === true) body.forceNew = true
  if (options && options.replace === true) body.replace = true
  return request(routePath('sessionStart'), {
    method: 'POST',
    body: JSON.stringify(body),
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

/**
 * 把一句话解析成生成参数（意图 v2）。
 *
 * - `cfg`：表单当前 CFG，Host 据此判断负向词是否生效（缺失时回落到预设推荐值）；
 * - `history`：最近对话 `[{ role: 'user'|'assistant', content }]`，由调用方按
 *   `LIMITS.intentHistory` 裁剪后传入，Host 会再裁剪一次；空数组不发送；
 * - `previousPrompt` 保留为旧宿主的兼容字段，新宿主在 history 非空时优先用 history。
 */
export function parseIntentRequest({ text, previousPrompt, locale, presetId, cfg, history } = {}) {
  const body = { text, previousPrompt, locale, presetId }
  // cfg=0 是合法值（极速模型默认不用负向词），不能用真值判断；非数字才省略。
  const cfgValue = Number(cfg)
  if (cfg !== '' && cfg !== null && cfg !== undefined && Number.isFinite(cfgValue)) body.cfg = cfgValue
  if (Array.isArray(history) && history.length > 0) body.history = history
  return request(routePath('intent'), {
    method: 'POST',
    body: JSON.stringify(body),
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

/**
 * 运行设置：GET 返回脱敏视图 `{ ok, settings }`（永不回传 hfToken 原文）。
 * 路径与方法和其它资源函数一样只从契约取，这里不写路径字面量。
 */
export function fetchSettings() {
  return request(routePath('settings'), { method: 'GET' })
}

/** 保存运行设置：payload 只含改动字段，响应与 GET 同为 `{ ok, settings }`。 */
export function saveSettings(payload) {
  return request(routePath('settingsSave'), {
    method: 'POST',
    body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
  })
}

/**
 * 工作台界面态：GET 返回白名单全量视图 `{ ok, uiState }`。
 * 读取失败只回落默认值，不弹错误提示（界面态不是业务数据）。
 */
export function fetchUiState() {
  return request(routePath('uiState'), { method: 'GET' })
}

/** 保存界面态：请求体是扁平补丁（如 `{ advancedOpen: true }`），响应与 GET 相同。 */
export function saveUiState(patch) {
  return request(routePath('uiStateSave'), {
    method: 'POST',
    body: JSON.stringify(patch && typeof patch === 'object' ? patch : {}),
  })
}

function postLoginAction(routeName, action, code) {
  const body = loginActionBody(action, code)
  if (!body) {
    return Promise.resolve({ ok: false, status: 0, code: 'invalid_request', message: `未知的登录动作：${action}` })
  }
  return request(routePath(routeName), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Kaggle 直连登录态：GET 返回 `{ ok, login }`（LoginView，字段见契约 KAGGLE_LOGIN）。
 * 旧宿主没有该路由时回 404，由调用方按「接口不可用」处理，不抛异常。
 */
export function fetchKaggleLogin() {
  return request(routePath('kaggleLogin'), { method: 'GET' })
}

/**
 * 发送一次 Kaggle 登录动作；请求体严格按契约 `KAGGLE_LOGIN.actions` 的形状：
 * `{ action: 'start' }` / `{ action: 'cancel' }` / `{ action: 'submit-code', code }`。
 */
export function kaggleLoginAction(action, code) {
  return postLoginAction('kaggleLoginAction', action, code)
}

/** 发起 Kaggle 浏览器授权（本地回环回调收码）。 */
export function startKaggleLogin() {
  return kaggleLoginAction('start')
}

/** 取消正在等待的 Kaggle 登录。 */
export function cancelKaggleLogin() {
  return kaggleLoginAction('cancel')
}

/** manual 模式提交粘贴的 Kaggle 授权码。 */
export function submitKaggleLoginCode(code) {
  return kaggleLoginAction('submit-code', code)
}

/** Colab Google OAuth 登录态：GET 返回 `{ ok, login, auth }`。 */
export function fetchColabLogin() {
  return request(routePath('colabLogin'), { method: 'GET' })
}

/** 发送一次 Colab 登录动作：start / cancel / submit-code。 */
export function colabLoginAction(action, code) {
  return postLoginAction('colabLoginAction', action, code)
}

/** 发起 Colab Google OAuth 浏览器授权。 */
export function startColabLogin() {
  return colabLoginAction('start')
}

/** 取消正在等待的 Colab 登录。 */
export function cancelColabLogin() {
  return colabLoginAction('cancel')
}

/** manual 模式提交粘贴的 Colab 回调 URL 或授权码。 */
export function submitColabLoginCode(code) {
  return colabLoginAction('submit-code', code)
}

/**
 * 本地图片导入（阶段十五 Phase A）：把 dataURL / 裸 base64 交给宿主落盘。
 *
 * 请求体 `{ data, name }`：name 只用于展示，宿主会清理控制字符并截断；
 * 成功返回 `{ ok, entry: { image, item } }`，entry 与 /history 条目同形，可直接选中。
 */
export function importImageFile({ data, name } = {}) {
  const body = { data: typeof data === 'string' ? data : '' }
  const label = typeof name === 'string' ? name.trim() : ''
  if (label) body.name = label
  return request(routePath('importFile'), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
