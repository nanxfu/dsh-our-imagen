#!/usr/bin/env node
/**
 * M0 试验 3：Colab Runtime Proxy 能否直连替代 cloudflared（探索项）。
 *
 * 背景：调研文档把"保留 cloudflared（方案 A）"作为主力，但没验证 Colab 的
 * runtimeProxy 是否也能转发任意端口。如果能，未来可以去掉第三方隧道依赖；
 * 如果不能，就死心塌地用 A，不再在这条路上浪费时间。
 *
 * 做法：在容器内起一个 8000 端口的 HTTP 服务，然后从 Host 侧依次尝试几种
 * 代理路径写法，按响应状态与正文判断哪条（如果有）真的转发到了 8000。
 *
 * 用法：
 *   node tools/colab/probe-proxy.mjs                # 申请 L4，测完自动关机
 *   node tools/colab/probe-proxy.mjs --reuse        # 复用试验 2 留下的实例
 *   node tools/colab/probe-proxy.mjs --keep         # 保留实例
 *   node tools/colab/probe-proxy.mjs --port 8000    # 指定容器内端口
 *
 * 退出码：0 至少有一条路径可用；1 全部不可用（预期结论，不算错误）。
 */

import {
  KernelSocket,
  PROBE_SERVER_PY,
  accessToken,
  assign,
  clearSessionState,
  createKernel,
  makeLog,
  proxyBase,
  readFileText,
  readSessionState,
  runtimeFetch,
  unassign,
  uploadFile,
  waitFor,
  assignmentFromState,
  writeSessionState,
} from './lib.mjs'

const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(name)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}

const log = makeLog({ verbose: hasFlag('--verbose') })
const port = Number(argValue('--port') || 8000)
const accelerator = (argValue('--gpu') || 'L4').toUpperCase()
const keepInstance = hasFlag('--keep')
const reuse = hasFlag('--reuse')

/** 候选路径写法：Jupyter 的 server-proxy 约定、直连端口、端口前缀域名等。 */
function candidates(assignment) {
  const base = proxyBase(assignment)
  const url = new URL(base)
  const list = [
    { name: 'jupyter-server-proxy 约定', url: `${base}/proxy/${port}/` },
    { name: '端口作为一级路径', url: `${base}/${port}/` },
    { name: '端口前缀子域名', url: `https://${port}-${url.host}${url.pathname.replace(/\/+$/, '')}/` },
    { name: 'colab 私有前缀', url: `${base}/colab/proxy/${port}/` },
  ]
  return list
}

async function probeUrl(assignment, target, { timeoutMs = 20000 } = {}) {
  // 代理令牌既可以放 header 也可以放 query；两种都带，排除鉴权导致的假阴性。
  const url = new URL(target)
  url.searchParams.set('authuser', '0')
  url.searchParams.set('colab-runtime-proxy-token', assignment.runtimeProxyInfo?.token || '')
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: {
        'X-Colab-Runtime-Proxy-Token': assignment.runtimeProxyInfo?.token || '',
        'X-Colab-Client-Agent': 'colab-cli',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    return { status: res.status, ms: Date.now() - started, body: text.slice(0, 200) }
  } catch (error) {
    return { status: 0, ms: Date.now() - started, body: String(error?.message || error) }
  }
}

async function resolveAssignment(token) {
  if (reuse) {
    const state = await readSessionState()
    const cached = assignmentFromState(state)
    if (!cached?.endpoint) throw new Error('--reuse 需要 .tmp/colab/session.json')
    return cached
  }
  const created = await assign({ token, accelerator, log })
  await writeSessionState({
    endpoint: created.endpoint,
    accelerator: created.accelerator || accelerator,
    machineShape: created.machineShape,
    variant: created.variant,
    proxyUrl: created.runtimeProxyInfo?.url,
    proxyToken: created.runtimeProxyInfo?.token,
    proxyTokenExpiresInSeconds: created.runtimeProxyInfo?.tokenExpiresInSeconds,
  })
  return created
}

async function ensureServer(assignment) {
  // 先复用试验 2 可能留下的服务；没有就上传并起一个。
  const existing = await readFileText(assignment, '/content/probe-server.log').catch(() => '')
  if (existing.includes('PROBE_SERVER_READY')) {
    log.info('容器内已有试验 2 留下的服务，直接复用')
    return
  }
  await uploadFile(assignment, '/content/probe_server.py', PROBE_SERVER_PY)
  const kernelId = await createKernel(assignment)
  const socket = new KernelSocket(assignment, kernelId, { log })
  await socket.connect()
  await socket.execute(
    `
import subprocess, sys
_log = open('/content/probe-server.log', 'w')
subprocess.Popen([sys.executable, '-u', '/content/probe_server.py'],
                 stdout=_log, stderr=subprocess.STDOUT, start_new_session=True)
print('started')
`,
    { timeoutMs: 60000 },
  )
  await waitFor(
    async () => {
      const text = await readFileText(assignment, '/content/probe-server.log').catch(() => '')
      return text.includes('PROBE_SERVER_READY')
    },
    { timeoutMs: 90000, label: '容器内服务就绪' },
  )
  socket.close()
}

async function main() {
  const token = await accessToken({ log })
  const assignment = await resolveAssignment(token)
  log.info(`实例 ${assignment.endpoint} ｜ 代理 ${proxyBase(assignment)}`)

  // 对照组：Jupyter 自身的 Contents API 一定通，用它证明代理通道与令牌没问题。
  log.step('对照组：Jupyter Contents API')
  const control = await runtimeFetch(assignment, '/api/contents', { timeoutMs: 20000 })
    .then((res) => res.status)
    .catch((error) => error.status || 0)
  log.out(`GET /api/contents → ${control}${control === 200 ? '（代理通道正常）' : '（异常，后面的结论不可信）'}`)

  await ensureServer(assignment)

  log.step(`探测端口 ${port} 的转发路径`)
  const results = []
  for (const item of candidates(assignment)) {
    const res = await probeUrl(assignment, item.url)
    const hit = res.status === 200 && /"ok":\s*true/.test(res.body)
    results.push({ ...item, ...res, hit })
    log.out(
      `${hit ? 'HIT  ' : 'miss '} ${item.name.padEnd(24)} ${String(res.status).padStart(3)} ${String(res.ms).padStart(5)}ms  ${res.body.replace(/\s+/g, ' ').slice(0, 90)}`,
    )
  }

  const winners = results.filter((item) => item.hit)
  log.step('结论')
  if (winners.length) {
    log.out(`端口 ${port} 可经 "${winners[0].name}" 直连：${winners[0].url}`)
    log.out('方案 B 值得保留为备选，但仍建议默认方案 A（cloudflared），因为 B 依赖 Colab 私有约定。')
  } else {
    log.out(`端口 ${port} 无法经 runtimeProxy 直连（${results.length} 条路径全部未命中）。`)
    log.out('结论：方案 B 不成立，数据面按方案 A（容器内 cloudflared）实现，与调研结论一致。')
    log.out('注意：若 jupyter-server-proxy 未安装，/proxy/<port>/ 返回 404 属正常。')
  }

  if (!keepInstance) {
    await unassign({ token, endpoint: assignment.endpoint, log })
    await clearSessionState()
  } else {
    log.out(`已保留实例：${assignment.endpoint}（记得手动 --stop）`)
  }

  if (!winners.length) process.exitCode = 1
}

main().catch(async (error) => {
  log.error(error?.message || String(error))
  if (error?.body) log.debug(`响应体：${String(error.body).slice(0, 500)}`)
  if (!keepInstance) {
    try {
      const token = await accessToken({ log })
      const state = await readSessionState()
      if (state?.endpoint) {
        await unassign({ token, endpoint: state.endpoint, log })
        await clearSessionState()
      }
    } catch (cleanupError) {
      log.error(`释放失败，请手动运行 probe-runtime.mjs --stop：${cleanupError.message}`)
    }
  }
  process.exit(1)
})
