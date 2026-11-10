/**
 * 下发给远端 daemon 的注入配置；键名与 daemon 的 _KNOWN_CONFIG_KEYS 一一对应。
 *
 * 纯函数：启动编排在 SessionManager 里，这里只负责把会话参数展开成 daemon 配置，
 * 便于离线断言版本 / 契约 / 预设展开是否正确。
 */

import { VERSION, daemonContract } from '../../shared/contract.js'
import { presetById } from '../presets.js'

/**
 * @param {{ presetId: string, token: string, topic: string, idleTimeoutSec: number }} input
 */
export function buildKernelConfig({ presetId, token, topic, idleTimeoutSec }) {
  return {
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
}