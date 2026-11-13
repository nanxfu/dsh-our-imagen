/**
 * Kaggle 访问方式（传输层）选择器（v0.9 M2 试验特性）。
 *
 * 两种实现同形状、同语义：
 *  - `cli`：本机 `kaggle` CLI（`lib/kaggle.js`，默认、稳定）；
 *  - `direct`：Node 直接调 Kaggle JSON API（`lib/kaggle-direct.js`，不依赖本机 CLI）。
 *
 * 关键约束：**每次调用都重新读取当前设置**。工作台切换访问方式后，下一次唤醒 / 探测 / 轮询
 * 就生效，不需要重载插件；`SessionManager` 的 deps 只注入本模块的包装函数，状态机零改动。
 */

import { SETTINGS } from '../shared/contract.js'
import {
  kaggleUsername as cliKaggleUsername,
  kernelLogs as cliKernelLogs,
  kernelStatus as cliKernelStatus,
  probeKaggle as cliProbeKaggle,
  pushKernel as cliPushKernel,
} from './kaggle.js'
import {
  kaggleUsername as directKaggleUsername,
  kernelLogs as directKernelLogs,
  kernelStatus as directKernelStatus,
  probeKaggle as directProbeKaggle,
  pushKernel as directPushKernel,
} from './kaggle-direct.js'
import { createLogger } from './log.js'

/** 两种传输方式的实现表：键必须是契约 `SETTINGS.kaggleTransports` 的取值。 */
const IMPLEMENTATIONS = {
  cli: {
    probeKaggle: cliProbeKaggle,
    kaggleUsername: cliKaggleUsername,
    pushKernel: cliPushKernel,
    kernelStatus: cliKernelStatus,
    kernelLogs: cliKernelLogs,
  },
  direct: {
    probeKaggle: directProbeKaggle,
    kaggleUsername: directKaggleUsername,
    pushKernel: directPushKernel,
    kernelStatus: directKernelStatus,
    kernelLogs: directKernelLogs,
  },
}

/**
 * 归一化访问方式取值：白名单外的值（含 `undefined` / 非字符串）一律回退契约默认值。
 *
 * @param {unknown} value
 * @returns {'cli' | 'direct'}
 */
export function normalizeKaggleTransport(value) {
  return typeof value === 'string' && SETTINGS.kaggleTransports.includes(value)
    ? value
    : SETTINGS.defaultKaggleTransport
}

/**
 * 创建传输层选择器。
 *
 * @param {{ ctx: object, getSettings?: () => object | null, log?: object }} [options]
 *   getSettings 每次操作时调用，返回合并后的生效设置（`createSettingsStore().current()`）。
 * @returns {{
 *   id: () => 'cli' | 'direct',
 *   probeKaggle: (ctx: object) => Promise<object>,
 *   kaggleUsername: (ctx: object, options?: object) => Promise<string>,
 *   pushKernel: (ctx: object, folder: string, options?: object) => Promise<object>,
 *   kernelStatus: (ctx: object, kernelId: string) => Promise<object>,
 *   kernelLogs: (ctx: object, kernelId: string) => Promise<object>,
 * }}
 */
export function createKaggleTransport({ ctx = null, getSettings = null, log = createLogger({ scope: 'kaggle' }) } = {}) {
  function currentId() {
    let settings = null
    try {
      settings = typeof getSettings === 'function' ? getSettings() : null
    } catch (error) {
      // 设置读取失败不应阻断出图：按默认传输方式继续，并留一条 warn 便于定位。
      log.warn('读取 Kaggle 访问方式失败，按默认值处理', error?.message ?? error)
    }
    return normalizeKaggleTransport(settings?.kaggleTransport)
  }

  function current() {
    return IMPLEMENTATIONS[currentId()]
  }

  return {
    id: currentId,
    probeKaggle: (context = ctx, options) => current().probeKaggle(context, options),
    kaggleUsername: (context, options) => current().kaggleUsername(context, options),
    pushKernel: (context, folder, options) => current().pushKernel(context, folder, options),
    kernelStatus: (context, kernelId) => current().kernelStatus(context, kernelId),
    kernelLogs: (context, kernelId) => current().kernelLogs(context, kernelId),
  }
}
