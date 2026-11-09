/**
 * 重启 DSH 后的插件加载检查。
 *
 * 用途：确认 index.js 真的被宿主加载（而不是 apply 抛错后静默跳过）。
 * 只用 HTTP，不依赖任何内部服务。
 *
 * 运行：node test/verify-loaded.mjs [--port 52629]
 */

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex >= 0 ? args[portIndex + 1] : '52629'
const base = `http://127.0.0.1:${port}`

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

async function getJson(path) {
  const res = await fetch(new URL(path, base), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function main() {
  let state
  try {
    state = await getJson('/imagen-api/state')
  } catch (error) {
    console.error(`无法读取 ${base}/imagen-api/state：${error?.message ?? error}`)
    console.error('若返回 404，说明 index.js 没有加载成功；查看 %USERPROFILE%\\.dsh\\logs\\desktop-next.log 中搜索 our-free-imagen。')
    process.exitCode = 1
    return
  }

  await check('版本为 0.2.0', () => {
    if (state.version !== '0.2.0') throw new Error(`实际 ${state.version}`)
  })
  await check('预设列表完整且不泄露 pipeline', () => {
    if (!Array.isArray(state.presets) || state.presets.length < 4) {
      throw new Error(`presets=${Array.isArray(state.presets) ? state.presets.length : 'not array'}`)
    }
    if (state.presets.some((item) => item.pipeline !== undefined)) throw new Error('预设包含 pipeline 字段')
  })
  await check('会话对象字段齐全', () => {
    for (const key of ['state', 'phase', 'detail', 'endpointUrl', 'error']) {
      if (!(key in state.session)) throw new Error(`session 缺少 ${key}`)
    }
  })
  await check('任务与队列字段存在', () => {
    if (!Array.isArray(state.jobs)) throw new Error('jobs 不是数组')
    if (!state.queue || typeof state.queue.pending !== 'number') throw new Error('queue 结构不对')
  })
  await check('历史接口可用', async () => {
    const body = await getJson('/imagen-api/history?limit=3')
    if (!Array.isArray(body.items)) throw new Error('items 不是数组')
  })
  await check('生成接口拒绝空 prompt', async () => {
    const res = await fetch(new URL('/imagen-api/generate', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ prompt: '  ' }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status !== 400) throw new Error(`期望 400，实际 ${res.status}`)
    const body = await res.json()
    if (body?.error?.code !== 'invalid_prompt') throw new Error(`error.code=${body?.error?.code}`)
  })

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) process.exitCode = 1
}

main()
