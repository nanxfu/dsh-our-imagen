/**
 * 下发给远端 daemon 的注入配置；键名与 daemon 的 _KNOWN_CONFIG_KEYS 一一对应。
 *
 * 纯函数：启动编排在 SessionManager 里，这里只负责把会话参数展开成 daemon 配置，
 * 便于离线断言版本 / 契约 / 预设展开是否正确。
 *
 * P1.2 / P2.1 / P2.2 的可选项（HF Token、依赖约束、备用隧道命令、预挂载权重）只在
 * 非空时输出：旧 Host 不下发时 daemon 配置键集合保持不变。
 */

import { VERSION, daemonContract } from '../../shared/contract.js'
import { presetById } from '../presets.js'

/** 只保留非空字符串并去重；空数组表示「不下发」。 */
function cleanStrings(value) {
  if (!Array.isArray(value)) return []
  const items = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed && !items.includes(trimmed)) items.push(trimmed)
  }
  return items
}

/** repo → 本地目录映射：只保留键值都非空字符串的项。 */
function cleanLocalModels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const models = {}
  for (const [repo, dir] of Object.entries(value)) {
    if (typeof repo !== 'string' || !repo.trim()) continue
    if (typeof dir !== 'string' || !dir.trim()) continue
    models[repo.trim()] = dir.trim()
  }
  return models
}

/**
 * @param {object} input
 * @param {string} input.presetId 预设 id
 * @param {string} input.token 远端 Bearer Token
 * @param {string} input.topic ntfy 会合 topic
 * @param {number} input.idleTimeoutSec 空闲退出秒数
 * @param {string | null} [input.hfToken] HuggingFace Token（写入 daemon 的 hf_token）
 * @param {string[]} [input.pipConstraints] pip 依赖约束（包名覆盖内置默认上限）
 * @param {string[]} [input.fallbackTunnelCommand] 备用隧道 argv 模板（支持 {port} 占位）
 * @param {string | null} [input.fallbackTunnelUrlRegex] 备用通道输出里提取地址的正则
 * @param {Record<string, string> | null} [input.localModels] 预挂载权重：repo → 容器内目录
 * @returns {object} daemon 注入配置
 */
export function buildKernelConfig({
  presetId,
  token,
  topic,
  idleTimeoutSec,
  hfToken = null,
  pipConstraints = [],
  fallbackTunnelCommand = [],
  fallbackTunnelUrlRegex = null,
  localModels = null,
}) {
  const config = {
    auth_token: token,
    ntfy_topic: topic,
    idle_timeout_sec: idleTimeoutSec,
    // daemon 只认完整 pipeline 描述；传预设 id 它无法加载（字段见 remote/daemon.py 顶部说明）。
    preload: presetById(presetId).pipeline,
    preset_id: presetId,
    log_level: 'info',
    // 版本与协议契约同源（shared/contract.js）：daemon 侧按 config.contract 校验参数边界。
    version: VERSION,
    contract: daemonContract(),
  }

  // 可选注入：空值不输出，保持与旧 Host 相同的配置键集合。
  if (typeof hfToken === 'string' && hfToken.trim()) config.hf_token = hfToken.trim()

  const constraints = cleanStrings(pipConstraints)
  if (constraints.length) config.pip_constraints = constraints

  const tunnelCommand = cleanStrings(fallbackTunnelCommand)
  if (tunnelCommand.length) config.fallback_tunnel_command = tunnelCommand
  if (typeof fallbackTunnelUrlRegex === 'string' && fallbackTunnelUrlRegex.trim()) {
    config.fallback_tunnel_url_regex = fallbackTunnelUrlRegex.trim()
  }

  const mounted = cleanLocalModels(localModels)
  if (Object.keys(mounted).length) config.local_models = mounted

  return config
}