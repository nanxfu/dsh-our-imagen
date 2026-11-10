/**
 * 宿主日志端口（默认 no-op）。
 *
 * 用途：把"吞掉但保持行为"的容错分支变成可排障事件。默认关闭，避免桌面端输出噪音；
 * 开启方式二选一：
 *  - 环境变量 `OUR_FREE_IMAGEN_LOG=debug|info|warn|error`（输出到 console 对应方法）；
 *  - 调用方注入 sink：`createLogger({ scope, sink })`，sink 需提供同名方法（测试可传收集器）。
 *
 * 安全约束：调用方不得把 auth token / 带 query 的完整 endpoint 写进日志；
 * 本模块只负责前缀与级别过滤，不做脱敏。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

const NOOP = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
})

/** 环境变量决定的最小输出级别；未设置或值非法时返回空串（即默认 no-op）。 */
function envLevel() {
  const raw = String(process.env.OUR_FREE_IMAGEN_LOG ?? '').trim().toLowerCase()
  return LEVELS[raw] ? raw : ''
}

/**
 * @param {{ scope?: string, level?: string, sink?: object }} [options]
 *   level：显式指定最小级别；未指定时，注入了 sink 默认 debug，否则取环境变量，都没有则 no-op。
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(options = {}) {
  const level = options.level ?? (options.sink ? 'debug' : envLevel())
  if (!LEVELS[level]) return NOOP
  const prefix = options.scope ? `[imagen:${options.scope}]` : '[imagen]'
  const sink = options.sink ?? console
  const emit = (name) => (...args) => {
    if (LEVELS[name] < LEVELS[level]) return
    const write = typeof sink?.[name] === 'function' ? sink[name] : sink?.log
    if (typeof write !== 'function') return
    write.call(sink, prefix, ...args)
  }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}