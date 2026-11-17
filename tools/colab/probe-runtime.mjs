#!/usr/bin/env node
/**
 * M0 试验 2：Jupyter 文件投递、Daemon 启动与保活。
 *
 * 验证（对应 docs/COLAB_BACKEND_RESEARCH.md §5 试验 2）：
 *   1. 经 `runtimeProxyInfo.url` 的 Contents API 上传文件是否可行；
 *   2. Kernel WebSocket 能否说通 Jupyter 协议（execute_request → iopub idle）；
 *   3. 在容器里拉起一个常驻 HTTP 服务，并从 Host 侧证明它还活着；
 *   4. **30 秒 Kernel WS 心跳 + 60 秒 TFE ping 能否让实例活过 35 分钟**（最关键）；
 *   5. 代理令牌 1 小时过期后，重新拉 assignments 能否无缝换新。
 *
 * 用法：
 *   node tools/colab/probe-runtime.mjs                    # 申请 L4，跑 5 分钟保活后关机
 *   node tools/colab/probe-runtime.mjs --minutes 40       # 按调研结论跑满 40 分钟
 *   node tools/colab/probe-runtime.mjs --keep             # 结束时保留实例（接着跑试验 3）
 *   node tools/colab/probe-runtime.mjs --reuse            # 复用 .tmp/colab/session.json 里的实例
 *   node tools/colab/probe-runtime.mjs --stop             # 只释放实例
 *
 * 退出码：0 全部断言通过；1 有断言失败或异常。
 */

import {
  KernelSocket,
  PROBE_SERVER_PY,
  accessToken,
  assignmentFromState,
  assign,
  clearSessionState,
  createKernel,
  listAssignments,
  listKernels,
  makeLog,
  mask,
  proxyBase,
  readFileText,
  readSessionState,
  runtimeFetch,
  tfeKeepAlive,
  unassign,
  uploadFile,
  waitFor,
  writeSessionState,
} from './lib.mjs'

const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(name)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}

const log = makeLog({ verbose: hasFlag('--verbose') })
const minutes = Number(argValue('--minutes') || 5)
const accelerator = (argValue('--gpu') || 'L4').toUpperCase()
const keepInstance = hasFlag('--keep')
const reuse = hasFlag('--reuse')
const stopOnly = hasFlag('--stop')

/** 断言账本：最后统一打印，避免中途失败丢掉已经验证过的结论。 */
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  log.out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

/** 从控制面刷新代理令牌（约 1 小时过期，长时间保活必须换新）。 */
async function refreshProxy(assignment, token) {
  const list = await listAssignments(token)
  const hit = list.find((item) => item.endpoint === assignment.endpoint)
  if (!hit) throw new Error('实例已不在 assignments 列表里（可能被平台回收）')
  assignment.runtimeProxyInfo = hit.runtimeProxyInfo
  return hit
}

async function resolveAssignment(token) {
  if (reuse) {
    const state = await readSessionState()
    const cached = assignmentFromState(state)
    if (!cached?.endpoint) throw new Error('--reuse 需要 .tmp/colab/session.json，先跑一次不带 --reuse 的探针')
    log.info(`复用实例 ${cached.endpoint}（保存于 ${state.savedAt}）`)
    const fresh = await refreshProxy(cached, token)
    log.info(`代理令牌已刷新：${mask(fresh.runtimeProxyInfo?.token)} TTL=${fresh.runtimeProxyInfo?.tokenExpiresInSeconds}s`)
    return cached
  }

  const created = await assign({ token, accelerator, log })
  if (!created?.endpoint) throw new Error('assign 未返回 endpoint')
  log.info(`实例 ${created.endpoint} ｜ shape=${created.machineShape ?? '?'} ｜ proxy=${proxyBase(created)}`)
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

async function stopInstance(token) {
  const state = await readSessionState()
  const endpoint = state?.endpoint
  if (!endpoint) {
    log.info('没有记录中的实例，无需释放')
    return
  }
  try {
    await unassign({ token, endpoint, log })
  } finally {
    await clearSessionState()
  }
}

/** 容器侧环境自检：Python 版本、GPU 型号与显存、磁盘，决定远程/内容适配的假设。 */
const ENV_PROBE = `
import json, platform, shutil, sys
info = {"python": platform.python_version(), "platform": platform.platform()}
try:
    import torch
    info["torch"] = torch.__version__
    info["cuda"] = torch.cuda.is_available()
    if info["cuda"]:
        info["gpu"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
        info["vram_gb"] = [round(torch.cuda.get_device_properties(i).total_memory / 2**30, 1)
                           for i in range(torch.cuda.device_count())]
except Exception as exc:
    info["torch_error"] = str(exc)
info["cwd"] = __import__("os").getcwd()
info["disk_free_gb"] = round(shutil.disk_usage(info["cwd"]).free / 2**30, 1)
info["kaggle_working"] = __import__("os").path.isdir("/kaggle/working")
print("ENV_JSON:" + json.dumps(info))
`

const BEAT_CODE = "open('/content/.imagen_beat','w').write(str(__import__('time').time()))"

async function main() {
  const token = await accessToken({ log })

  if (stopOnly) {
    await stopInstance(token)
    return
  }
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes 必须是正数')

  const assignment = await resolveAssignment(token)

  // 1) Contents API：先证明能上传，再证明能读回。
  log.step('1/5 文件投递（Contents API）')
  await uploadFile(assignment, '/content/probe_server.py', PROBE_SERVER_PY)
  const echoed = await readFileText(assignment, '/content/probe_server.py')
  check('Contents API 上传成功', echoed.includes('PROBE_SERVER_READY'), `${echoed.split('\n').length} 行`)

  // 2) Kernel：创建 + WS 握手。
  log.step('2/5 Kernel 与 WebSocket')
  const kernelId = await createKernel(assignment)
  log.info(`Kernel ${kernelId}`)
  let socket = new KernelSocket(assignment, kernelId, { log })
  await socket.connect()
  const env = await socket.execute(ENV_PROBE, { timeoutMs: 90000 })
  const envJson = /ENV_JSON:(\{.*\})/s.exec(env.output || '')?.[1]
  const envInfo = envJson ? JSON.parse(envJson) : null
  check('Kernel WS 执行 Python 成功', Boolean(envInfo), envInfo ? `python ${envInfo.python}` : env.output.slice(0, 200))
  if (envInfo) {
    log.out(`       GPU=${JSON.stringify(envInfo.gpu || null)} torch=${envInfo.torch || 'n/a'}`)
    log.out(`       cwd=${envInfo.cwd} 磁盘剩余=${envInfo.disk_free_gb}GiB /kaggle/working=${envInfo.kaggle_working}`)
    check('设备是单卡（不再假设双 T4）', Array.isArray(envInfo.gpu) && envInfo.gpu.length <= 1, `count=${envInfo.gpu?.length ?? 0}`)
    check('工作目录不是 /kaggle/working', envInfo.kaggle_working === false, `cwd=${envInfo.cwd}`)
  }

  // 3) 容器内常驻服务：模拟未来的 remote daemon。
  log.step('3/5 启动容器内常驻服务')
  const startCode = `
import subprocess, sys
_log = open('/content/probe-server.log', 'w')
_proc = subprocess.Popen([sys.executable, '-u', '/content/probe_server.py'],
                         stdout=_log, stderr=subprocess.STDOUT, start_new_session=True)
print(_proc.pid)
`
  const started = await socket.execute(startCode, { timeoutMs: 60000 })
  const pid = Number((started.output || '').trim())
  log.info(`服务进程 pid=${Number.isFinite(pid) ? pid : '?'}`)
  const ready = await waitFor(
    async () => {
      const text = await readFileText(assignment, '/content/probe-server.log').catch(() => '')
      return text.includes('PROBE_SERVER_READY') ? text : null
    },
    { timeoutMs: 90000, label: '容器内服务就绪' },
  )
  check('容器内 HTTP 服务启动', Boolean(ready), '/content/probe-server.log 出现 READY')

  // 4) 保活：这是 M0 的核心问题。
  log.step(`4/5 保活 ${minutes} 分钟（30s WS 心跳 + 60s TFE ping）`)
  const startedAt = Date.now()
  const endAt = startedAt + minutes * 60 * 1000
  let beats = 0
  let beatFails = 0
  let lastPing = 0
  let lastRefresh = Date.now()
  let reconnects = 0
  let busy = false

  const reconnect = async () => {
    reconnects += 1
    log.warn(`Kernel WS 已断开（code=${socket.lastClose?.code ?? '?'}），第 ${reconnects} 次重连`)
    socket = new KernelSocket(assignment, kernelId, { log })
    await socket.connect()
  }

  const timer = setInterval(async () => {
    if (Date.now() >= endAt) return
    // 上一拍还没回来时跳过这一拍，避免 WS 卡住时任务堆积。
    if (busy) {
      log.debug('上一拍未完成，跳过本次心跳')
      return
    }
    busy = true
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
    try {
      if (socket.closed) {
        await reconnect()
      }
      const res = await socket.execute(BEAT_CODE, { timeoutMs: 25000 })
      beats += 1
      if (!res) throw new Error('空响应')
    } catch (error) {
      beatFails += 1
      log.warn(`心跳失败 #${beatFails}（${error.message}）`)
      try {
        if (socket.closed) await reconnect()
      } catch (reconnectError) {
        log.error(`重连失败：${reconnectError.message}`)
      }
    }

    // 每 60 秒一次 TFE ping（辅助手段，失败不算致命）。
    if (Date.now() - lastPing > 60000) {
      lastPing = Date.now()
      try {
        const ping = await tfeKeepAlive({ token, endpoint: assignment.endpoint })
        log.debug(`TFE ping ok=${ping.ok} status=${ping.status}`)
      } catch (error) {
        log.debug(`TFE ping 异常：${error.message}`)
      }
    }

    // 每 20 分钟换一次代理令牌（TTL 约 1 小时，留足余量）。
    if (Date.now() - lastRefresh > 20 * 60 * 1000) {
      lastRefresh = Date.now()
      try {
        const fresh = await refreshProxy(assignment, token)
        await writeSessionState({
          endpoint: assignment.endpoint,
          accelerator: assignment.accelerator,
          machineShape: assignment.machineShape,
          proxyUrl: fresh.runtimeProxyInfo?.url,
          proxyToken: fresh.runtimeProxyInfo?.token,
          proxyTokenExpiresInSeconds: fresh.runtimeProxyInfo?.tokenExpiresInSeconds,
        })
        log.info(`代理令牌已刷新 TTL=${fresh.runtimeProxyInfo?.tokenExpiresInSeconds}s`)
      } catch (error) {
        log.warn(`刷新代理令牌失败：${error.message}`)
      }
    }

    busy = false
    if (beats % 2 === 0) {
      log.out(`  [${elapsedMin}min] 心跳 ${beats} 次，失败 ${beatFails} 次，重连 ${reconnects} 次`)
    }
  }, 30000)

  // 先打一拍，确认心跳通路立刻可用。
  await socket.execute(BEAT_CODE, { timeoutMs: 25000 })
  beats += 1

  await new Promise((resolve) => {
    const tick = setInterval(() => {
      if (Date.now() >= endAt) {
        clearInterval(tick)
        clearInterval(timer)
        resolve()
      }
    }, 2000)
  })

  // 5) 收尾核验：实例还在、Kernel 还在、容器服务还能读文件。
  log.step('5/5 收尾核验')
  const survivedMs = Date.now() - startedAt
  const alive = await listAssignments(token).then(
    (list) => list.some((item) => item.endpoint === assignment.endpoint),
    () => false,
  )
  check('实例仍在 assignments 列表中', alive, `存活 ${(survivedMs / 60000).toFixed(1)} 分钟`)
  check('WS 心跳无累积失败或已自动恢复', beatFails === 0 || reconnects > 0, `beats=${beats} fails=${beatFails} reconnects=${reconnects}`)

  let kernels = []
  try {
    kernels = await listKernels(assignment)
  } catch (error) {
    log.warn(`列 Kernel 失败：${error.message}`)
  }
  check('Kernel 仍存在', kernels.some((item) => item.id === kernelId), `共 ${kernels.length} 个`)

  const beatFile = await readFileText(assignment, '/content/.imagen_beat').catch(() => '')
  check('心跳文件已写入', beatFile.trim().length > 0, `内容=${beatFile.trim()}`)

  const health = await runtimeFetch(assignment, '/api/contents/content/probe-server.log', { params: { content: '1' } })
    .then(() => true)
    .catch(() => false)
  check('代理通道仍可用', health)

  socket.close()

  log.step('结论')
  log.out(`存活 ${(survivedMs / 60000).toFixed(1)} 分钟，心跳 ${beats} 次，失败 ${beatFails} 次，重连 ${reconnects} 次。`)
  const failed = checks.filter((item) => !item.ok)
  log.out(failed.length ? `${failed.length} 项断言失败：${failed.map((item) => item.name).join('、')}` : '全部断言通过。')
  log.out(`提示：容器内服务仍在运行（pid 记于日志），可从试验 3 继续验证代理直连。`)

  if (!keepInstance) {
    await stopInstance(token)
  } else {
    log.out(`已保留实例：${assignment.endpoint}（记得手动 --stop）`)
  }

  if (failed.length) process.exitCode = 1
}

// Ctrl+C 时尽量别把实例留在云端空烧 CCU。
process.on('SIGINT', async () => {
  log.warn('收到中断，尝试释放实例…')
  try {
    const token = await accessToken({ log })
    await stopInstance(token)
  } catch (error) {
    log.error(`释放失败，请手动运行 --stop：${error.message}`)
  }
  process.exit(130)
})

main().catch(async (error) => {
  log.error(error?.message || String(error))
  if (error?.body) log.debug(`响应体：${String(error.body).slice(0, 500)}`)
  if (!keepInstance) {
    log.warn('异常退出，尝试释放实例以免空烧 CCU…')
    try {
      await stopInstance(await accessToken({ log }))
    } catch (cleanupError) {
      log.error(`释放失败，请手动运行 --stop：${cleanupError.message}`)
    }
  }
  process.exit(1)
})
