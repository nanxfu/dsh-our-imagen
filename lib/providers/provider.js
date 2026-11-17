/**
 * 远端算力 Provider 契约：把「向某个平台申请 GPU、拿到推理地址、保活、释放」收敛成一个接口。
 *
 * 为什么需要这一层：会话状态机（`lib/session.js`）里原本混着 Kaggle 的 kernel 推送、
 * ntfy 会合、Kernel 状态轮询与关机通知。这些动作的**时序**是通用的，**实现**却完全是
 * 平台细节。Colab 的申请方式、会合通道、保活手段都不同，只有把它们挡在接口后面，
 * 状态机才不必为第二个平台再加一套分支。
 *
 * 设计约束（写在这里是为了让后续实现不再重复讨论）：
 *  1. **单拍非阻塞**：`pollEndpoint` / `checkAlive` 每次只做一次探测，未就绪返回 null 或
 *     `{ alive:false }`，由 `SessionManager.every()` 决定节奏。provider 内部不得自建定时器
 *     —— 否则 stop/dispose 换代时无法确定性掐断，Colab 会留下空烧 CCU 的心跳。
 *  2. **abort 即释放**：`run.signal` 触发 abort 或调用 `teardown()` 时，provider 必须立即
 *     关闭自己持有的长连接（Colab 的 Kernel WebSocket、隧道进程句柄），不能等下一次轮询。
 *  3. **句柄可序列化**：`provision` 返回的 handle 会进入会话记录，必须是纯数据。
 *     token 不进 handle（由 SessionManager 单独保管/落盘）。
 *  4. **失败只抛 ProviderError**：code 沿用会话状态机已有的失败码，状态机据此写错误态；
 *     provider 不直接改会话状态。
 */

/** 会话失败码：与 `lib/session/state.js` 的失败文案表保持一致。 */
export const PROVIDER_ERROR_CODES = [
  'auth_required',
  'push_failed',
  'gpu_unavailable',
  'queue_timeout',
  'tunnel_timeout',
  'health_failed',
  'remote_error',
  'session_ended',
]

export class ProviderError extends Error {
  /**
   * @param {string} code 失败码（见 PROVIDER_ERROR_CODES；内部还使用 'stale'）
   * @param {string} message 给用户看的原因
   * @param {{ logsTail?: string | null, kernelId?: string | null, cause?: unknown }} [context]
   */
  constructor(code, message, { logsTail = null, kernelId = null, cause = null } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.logsTail = logsTail
    this.kernelId = kernelId
    this.cause = cause
  }
}

/**
 * Provider 接口（仅作文档与静态检查用；实现见 ./kaggle.js）。
 *
 * @typedef {object} ComputeProvider
 * @property {'kaggle' | 'colab'} id
 * @property {(run: object, options: object) => Promise<object>} provision
 *   申请算力并启动远端 daemon，返回可序列化 handle。
 * @property {(run: object, handle: object) => Promise<{ endpointUrl: string } | null>} pollEndpoint
 *   单拍非阻塞：拿到地址返回 `{ endpointUrl }`，未就绪返回 null。
 * @property {(run: object, handle: object) => Promise<{ alive: boolean, status?: string | null, missing?: boolean, queued?: boolean }>} checkAlive
 * @property {(run: object, handle: object) => Promise<{ ok: boolean, detail?: string }>} keepAlive
 *   只做一次保活动作（Colab：WS beat / TFE ping / 令牌续期）；无保活概念的平台返回 ok。
 * @property {(run: object, handle: object, context?: object) => Promise<{ ok: boolean, detail?: string }>} teardown
 *   释放算力与长连接；必须幂等，重复调用不报错。
 * @property {(record: object) => Promise<boolean | null>} cleanupPending
 *   重启补清理：只凭落盘记录释放上一次进程留下的实例，不依赖会话状态机。
 * @property {(run: object, handle: object, options?: object) => Promise<string | null>} readLogs
 *   可选能力；不支持时返回 null。
 */

/**
 * 记录属于哪个 provider。
 *
 * M1 的落盘记录还没有 `provider` 字段（保持 version=1 与平铺字段，避免动测试），
 * 一律按 Kaggle 处理；M2 引入 Colab 时再随记录格式一起升级。
 */
export function providerIdOf(record) {
  const id = record?.provider
  return id === 'colab' ? 'colab' : 'kaggle'
}
