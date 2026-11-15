/**
 * 离线测试通用的 check() 运行器：统一记录、PASS/FAIL 输出与汇总退出码。
 */

/**
 * 创建测试检查运行器。
 *
 * @returns {{
 *   check: (name: string, fn: () => unknown) => Promise<void>,
 *   record: (ok: boolean, name: string, error?: unknown) => void,
 *   summary: (options?: { prefix?: string, suffix?: string }) => { total: number, passed: number, failed: number },
 *   results: Array<{ name: string, ok: boolean, error?: unknown }>,
 * }}
 */
export function createCheckRunner() {
  const results = []

  async function check(name, fn) {
    try {
      await fn()
      results.push({ name, ok: true })
      console.log(`PASS ${name}`)
    } catch (error) {
      results.push({ name, ok: false, error })
      console.log(`FAIL ${name}\n  ${error?.message ?? error}`)
    }
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
