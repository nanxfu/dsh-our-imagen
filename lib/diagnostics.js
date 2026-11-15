/**
 * 宿主诊断环境指纹：供 `GET /logs` 生成非敏感诊断摘要，供排障贴 Issue 使用。
 * 与主日志器（`lib/log.js`）解耦，避免日志基础设施直接依赖会话与设置快照语义。
 */

/** 代理相关环境变量（大写与小写变体都算）；只看「有没有配置」，不留值。 */
const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0
}

/** 普通对象且至少有一个键（用于 localModels 这类映射开关）。 */
function hasEntries(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

/** 进程平台与 Node 版本：读取本身也可能抛错（极端宿主），失败回退空串。 */
function processInfo() {
  try {
    const platform = typeof process?.platform === 'string' ? process.platform : ''
    const nodeVersion = process?.versions?.node ? String(process.versions.node) : ''
    return { platform, nodeVersion }
  } catch {
    return { platform: '', nodeVersion: '' }
  }
}

/** 时间值（ISO 字符串 / 毫秒数 / Date）→ 毫秒时间戳；无法解析返回 null。 */
function timeOf(value) {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const time = Date.parse(String(value ?? ''))
  return Number.isFinite(time) ? time : null
}

/** 两段时间之间的毫秒差；任一端缺失返回 null，时钟回拨按 0 处理。 */
function durationBetween(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.max(0, to - from)
}

/**
 * 诊断环境指纹：`GET /logs` 响应体 `env` 字段的数据来源，只含非敏感信息。
 *
 * 返回平台 / Node 版本、若干「是否配置」布尔开关与阶段耗时摘要；不返回配置原文、
 * 代理 URL、Token、工作区路径或提示词正文。读取任何配置或会话快照抛错时整体降级为
 * 安全默认值（布尔 false、耗时为 null），绝不把异常抛给日志路由。
 *
 * @param {{ config?: object, session?: { snapshot?: () => object } | null,
 *           settings?: object | null, now?: number }} [input]
 *   settings 为可选的最新合并设置（lib/settings.js 的 current()）：提供时用它判定
 *   Token / 预挂载 / 依赖约束的布尔开关，未提供时保持改造前的行为（只看静态 config）。
 * @returns {{ platform: string, nodeVersion: string, hasProxyEnv: boolean,
 *             hasFallbackTunnel: boolean, hasCustomDatasets: boolean,
 *             hasPipConstraints: boolean, hasHfToken: boolean,
 *             timings: { sessionStartMs: number | null, sessionUptimeMs: number | null,
 *                        readyUptimeMs: number | null } }}
 */
export function buildDiagnosticEnv({ config = {}, session = null, settings = null, now = Date.now() } = {}) {
  const { platform, nodeVersion } = processInfo()
  // 安全默认值：任何一步抛错都原样返回它，形状与正常返回一致。
  const fallback = {
    platform,
    nodeVersion,
    hasProxyEnv: false,
    hasFallbackTunnel: false,
    hasCustomDatasets: false,
    hasPipConstraints: false,
    hasHfToken: false,
    timings: { sessionStartMs: null, sessionUptimeMs: null, readyUptimeMs: null },
  }
  try {
    const staticConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
    // 生效设置来自设置存储；为空时全部沿用静态 config（旧调用行为不变）。
    const effective = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : null
    const source = effective ?? staticConfig
    const snapshot = session && typeof session.snapshot === 'function' ? session.snapshot() : null
    const current = timeOf(now) ?? Date.now()
    const startedAt = snapshot && typeof snapshot === 'object' ? timeOf(snapshot.startedAt) : null
    const readyAt = snapshot && typeof snapshot === 'object' ? timeOf(snapshot.readyAt) : null
    return {
      platform,
      nodeVersion,
      hasProxyEnv: PROXY_ENV_KEYS.some((key) => hasNonEmptyString(process.env?.[key])),
      // 备用隧道命令不在设置抽屉的覆盖项里，始终来自静态 config。
      hasFallbackTunnel: isNonEmptyArray(staticConfig.fallbackTunnelCommand),
      // 自定义预挂载：Dataset 与本地权重映射任一非空；未注入 settings 时只看 config.datasetSources。
      hasCustomDatasets: isNonEmptyArray(source.datasetSources) || (effective ? hasEntries(effective.localModels) : false),
      hasPipConstraints: isNonEmptyArray(source.pipConstraints),
      hasHfToken: hasNonEmptyString(source.hfToken),
      timings: {
        sessionStartMs: durationBetween(startedAt, readyAt),
        sessionUptimeMs: durationBetween(startedAt, current),
        readyUptimeMs: durationBetween(readyAt, current),
      },
    }
  } catch {
    // 诊断信息只用于贴 Issue：任何异常都返回上面的安全默认值，不影响日志路由本身。
    return fallback
  }
}
