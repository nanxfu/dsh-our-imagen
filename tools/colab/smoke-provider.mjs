#!/usr/bin/env node
/**
 * 2a 真机验收：用 ColabProvider 驱动完整 SessionManager 链路。
 *
 * 覆盖四件事（首次真机跑通后即可进 2b）：
 *   1. SessionManager 选 `provider: 'colab'` 时能完成 assign → 上传 → 起 Kernel → 读会合文件；
 *   2. 远端 daemon 在 Python 3.13 / torch 2.14 环境能无报错拉起（读 daemon 日志确认）；
 *   3. 经 cloudflared 出图 1 张（sdxl-lightning，4 步），验证推理链路；
 *   4. stop() 后实例确实被 unassign（assignments 为空、CCU 活跃实例 0），不留空烧。
 *
 * 用法：node tools/colab/smoke-provider.mjs [--gpu L4] [--preset sdxl-lightning]
 * 退出码：0 全通过；1 任一步失败。
 */

import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { presetById } from '../../lib/presets.js'
import { mergeSettings } from '../../lib/settings.js'
import { fetchHealth, requestGenerate } from '../../lib/remote.js'
import { SessionManager } from '../../lib/session.js'
import { ccuInfo, listAssignments } from '../../lib/colab/client.js'
import { accessToken } from '../../lib/colab/client.js'

const args = process.argv.slice(2)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null
}
const gpu = (argValue('--gpu') || 'L4').toUpperCase()
const restart = args.includes('--restart')
const presetId = argValue('--preset') || 'sdxl-lightning'
const preset = presetById(presetId)
const outDir = join(process.cwd(), '.tmp/colab')
const stamp = () => new Date().toISOString().slice(11, 19)

const sink = {
  debug: () => {},
  info: (...args) => console.log(`${stamp()} info  ${args.join(' ')}`),
  warn: (...args) => console.log(`${stamp()} warn  ${args.join(' ')}`),
  error: (...args) => console.log(`${stamp()} error ${args.join(' ')}`),
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  if (!preset) throw new Error(`未知预设：${presetId}`)

  // 走真实设置链路（契约 + mergeSettings），确保 UI 保存的 provider/colabGpu 能落到会话。
  const effective = mergeSettings({}, { provider: 'colab', colabGpu: gpu })
  const session = new SessionManager({
    ctx: { workspace: process.cwd() },
    defaultPreset: presetId,
    deps: { log: sink },
    options: {
      provider: effective.provider,
      colabGpu: effective.colabGpu,
      colabHighRam: effective.colabHighRam,
      enableGpu: true,
      // 出图链路较长：给足排队/装依赖/下权重的时间，但空闲关机仍按 10 分钟。
      idleTimeoutSec: 600,
      provisionTimeoutMs: 25 * 60 * 1000,
      tunnelTimeoutMs: 15 * 60 * 1000,
    },
  })

  const startedAt = Date.now()
  let smokeJobId = null
  try {
    console.log(`\n=== 启动 Colab 会话（${gpu} / ${presetId}）===`)
    await session.start(presetId)
    let lastState = ''
    const snapshot = await session.ensureReady({
      timeoutMs: 25 * 60 * 1000,
      onTick: (snap) => {
        const line = `${snap.state}/${snap.phase ?? '-'} ${snap.detail ?? ''}`.trim()
        if (line !== lastState) {
          lastState = line
          console.log(`  ${stamp()} ${line}`)
        }
      },
    })
    check('会话进入 ready', snapshot.state === 'ready', `耗时 ${((Date.now() - startedAt) / 1000).toFixed(0)}s`)

    const endpoint = session.session.endpointUrl
    const token = session.secret.token
    console.log(`\nendpoint=${endpoint}`)

    const health = await fetchHealth(endpoint, token).catch(() => null)
    check('远端 /health 可用', Boolean(health), health ? `phase=${health.phase} device=${health.device} model=${health.model_id}` : '')
    check('单卡 L4 被识别', String(health?.device ?? '').includes('L4'), String(health?.device ?? ''))

    const logs = await session.provider.readLogs(session, session.handle).catch(() => null)
    if (logs) {
      const python = /python[= ]([\d.]+)/i.exec(logs)?.[1] ?? ''
      const torchLine = /torch[= ]([\d.]+)/i.exec(logs)?.[1] ?? ''
      const hasTraceback = /Traceback \(most recent call last\)/.test(logs)
      check('daemon 启动日志无 traceback', !hasTraceback)
      console.log(`  日志摘要：python=${python || '?'} torch=${torchLine || '?'} 行数=${logs.split('\n').length}`)
    } else {
      check('能读到 daemon 日志', false, 'readLogs 返回空')
    }

    // 诊断：/health 正常但 /job 超时时，先分清是 undici、cloudflared 还是响应分帧的问题。
    const probe = async (label, path, headers) => {
      const begin = Date.now()
      try {
        const res = await fetch(new URL(path, endpoint), {
          headers: { Authorization: `Bearer ${token}`, ...headers },
          signal: AbortSignal.timeout(8000),
        })
        const text = await res.text()
        console.log(`  probe ${label}: ${res.status} ${text.length}B ${Date.now() - begin}ms`)
      } catch (error) {
        console.log(`  probe ${label}: ERR ${error?.message ?? error} ${Date.now() - begin}ms`)
      }
    }
    await probe('health', '/health', {})
    await probe('job-default', '/job?id=missing', {})
    await probe('job-identity-close', '/job?id=missing', { 'Accept-Encoding': 'identity', Connection: 'close' })

    console.log(`\n=== 出图 1 张 ===`)
    smokeJobId = `smoke-${Date.now()}`
    const begin = Date.now()
    const response = await requestGenerate(
      endpoint,
      token,
      {
        pipeline: preset.pipeline,
        modelId: preset.repo,
        jobId: smokeJobId,
        tasks: [
          {
            name: '01',
            prompt: 'a red fox sitting in fresh snow, soft morning light, detailed fur',
            negative_prompt: preset.negativeHint ?? '',
            seed: 42,
            width: 1024,
            height: 1024,
            steps: preset.steps,
            cfg: preset.cfg,
          },
        ],
      },
      { timeoutMs: 10 * 60 * 1000, requestMs: session.provider.jobRequestTimeoutMs },
    )
    const image = Buffer.from(response.results?.[0]?.image_b64 ?? '', 'base64')
    const isPng = image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    check('收到合法 PNG', isPng, `${(image.length / 1024).toFixed(0)} KiB / ${((Date.now() - begin) / 1000).toFixed(1)}s`)
    if (isPng) {
      await mkdir(outDir, { recursive: true })
      const file = join(outDir, `smoke-${Date.now()}.png`)
      await writeFile(file, image)
      console.log(`  已保存：${file}`)
    }
    if (restart) {
      console.log('\n=== 模拟 Host 崩溃后 restore 接管 ===')
      // 崩溃：只停本地定时器，不 dispose（dispose 会 unassign），也不清记录。
      session.clearTimers()
      session.disposed = true
      const second = new SessionManager({
        ctx: { workspace: process.cwd() },
        defaultPreset: presetId,
        deps: { log: sink },
        options: { provider: 'colab', colabGpu: gpu, idleTimeoutSec: 600, provisionTimeoutMs: 25 * 60 * 1000 },
      })
      const restored = await second.restore()
      check('restore 返回快照', Boolean(restored), restored?.state)
      const snap2 = await second.ensureReady({ timeoutMs: 180000 })
      check('restore 后重新 ready', snap2.state === 'ready', snap2.state)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      check(
        '顶栏数据 providerUsage 可见',
        Number.isFinite(second.session.providerUsage?.balance),
        JSON.stringify(second.session.providerUsage),
      )
      await second.stop()
    }
  } catch (error) {
    console.log(`\n失败：${error?.message ?? error}`)
    const logs = await session.provider.readLogs(session, session.handle).catch(() => null)
    if (logs) {
      console.log('\n--- daemon 日志尾部 ---')
      console.log(logs.split('\n').slice(-60).join('\n'))
    }
    // 大响应专项：同一个已完成 job 分别用 fetch 默认头 / identity+close / curl 拉一次。
    if (smokeJobId && session.session.endpointUrl) {
      const ep = session.session.endpointUrl
      const tk = session.secret.token
      for (const item of [
        ['default', {}],
        ['identity-close', { 'Accept-Encoding': 'identity', Connection: 'close' }],
      ]) {
        const begin = Date.now()
        try {
          const res = await fetch(new URL(`/job?id=${smokeJobId}`, ep), {
            headers: { Authorization: `Bearer ${tk}`, ...item[1] },
            signal: AbortSignal.timeout(20000),
          })
          const text = await res.text()
          console.log(`  bigjob ${item[0]}: ${res.status} ${text.length}B ${Date.now() - begin}ms`)
        } catch (error) {
          console.log(`  bigjob ${item[0]}: ERR ${error?.message ?? error} ${Date.now() - begin}ms`)
        }
      }
      const curl = spawnSync(
        'curl',
        ['-sS', '-m', '20', '-o', join(outDir, 'job.json'), '-w', '%{http_code} %{size_download} %{time_total}',
          '-H', `authorization: Bearer ${tk}`, `${ep}/job?id=${smokeJobId}`],
        { encoding: 'utf8' },
      )
      console.log(`  bigjob curl: ${curl.stdout ?? ''} ${curl.stderr ? curl.stderr.trim() : ''}`)
    }
    process.exitCode = 1
  } finally {
    console.log('\n=== stop() 释放 ===')
    const token = await accessToken({ log: sink }).catch(() => null)
    await session.stop().catch((error) => console.log(`stop 异常：${error.message}`))
    await new Promise((resolve) => setTimeout(resolve, 3000))
    if (token) {
      const list = await listAssignments(token).catch(() => null)
      check('assignments 已清空', Array.isArray(list) && list.length === 0, `剩余 ${list?.length ?? '?'} 个`)
      const ccu = await ccuInfo(token).catch(() => null)
      check('CCU 活跃实例归零', Number(ccu?.assignmentsCount ?? -1) === 0, `assignmentsCount=${ccu?.assignmentsCount} balance=${ccu?.currentBalance?.toFixed?.(2)}`)
    }
    session.dispose()
  }

  const failed = checks.filter((item) => !item.ok)
  console.log(`\n${failed.length ? `${failed.length} 项失败：${failed.map((item) => item.name).join('、')}` : '全部通过'}`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n失败：${error?.message ?? error}`)
  process.exitCode = 1
})
