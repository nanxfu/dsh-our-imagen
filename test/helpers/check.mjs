/**
 * 离线测试通用的 check() 运行器：统一记录、PASS/FAIL 输出与汇总退出码。
 */

/**
 * 创建测试检查运行器。
 *
 * check() 支持两种写法：
 *  - `check(name, fn)`：await 函数，抛错即失败；
 *  - `check(name, ok, detail?)`：按真值判断（同步布尔断言，如权限 / 日志扫描），
 *    失败时把 detail 打印在下一行。
 *
 * @returns {{
 *   check: (name: string, fnOrOk: unknown, detail?: string) => Promise<void>,
 *   record: (ok: boolean, name: string, error?: unknown) => void,
 *   summary: (options?: { prefix?: string, suffix?: string }) => { total: number, passed: number, failed: number },
 *   results: Array<{ name: string, ok: boolean, error?: unknown }>,
 * }}
 */
export function createCheckRunner() {
  const results = []

  async function check(name, fnOrOk, detail) {
    if (typeof fnOrOk === 'function') {
      try {
        await fnOrOk()
        results.push({ name, ok: true })
        console.log(`PASS ${name}`)
      } catch (error) {
        results.push({ name, ok: false, error })
        console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
      }
      return
    }

    if (fnOrOk) {
      results.push({ name, ok: true })
      console.log(`PASS ${name}`)
      return
    }

    results.push({ name, ok: false })
    console.log(`FAIL ${name}${detail ? `\n  ${detail}` : ''}`)
  }

  function record(ok, name, error) {
    results.push(error === undefined ? { name, ok: Boolean(ok) } : { name, ok: Boolean(ok), error })
  }

  function summary({ prefix = '\n', suffix = '通过' } = {}) {
    const failed = results.filter((item) => !item.ok)
    const passed = results.length - failed.length
    console.log(`${prefix}${passed}/${results.length} ${suffix}`)
    if (failed.length > 0) process.exitCode = 1
    return { total: results.length, passed, failed: failed.length }
  }

  return { check, record, summary, results }
}
