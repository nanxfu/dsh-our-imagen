/**
 * 轮询定时器集合。
 *
 * 边界：只管「挂 / 清 interval，并吞掉轮询异常」；集合本身仍是 `Set`
 * （既有测试断言 `session.timers.size`），因此这里接收 timers 而不是自己持有。
 */

/**
 * 挂一个轮询定时器：回调异常只记 warn，不改变状态、不打断后续轮回。
 *
 * @param {Set} timers 定时器集合（SessionManager.timers）
 * @param {{ warn: Function }} log 日志端口
 * @param {Function} fn 每拍执行的回调
 * @param {number} ms 间隔（毫秒）
 * @returns {NodeJS.Timeout} interval id，测试可据此判断「不留定时器」
 */
export function every(timers, log, fn, ms) {
  const id = setInterval(() => {
    Promise.resolve()
      .then(fn)
      .catch((error) => log.warn('轮询异常（已忽略，状态保持不变）', error?.message ?? error))
  }, ms)
  timers.add(id)
  return id
}

/** 清空全部定时器。 */
export function clearTimers(timers) {
  for (const id of timers) clearInterval(id)
  timers.clear()
}