/**
 * 客户端纯逻辑测试（不需要浏览器、不需要构建）。
 *
 * src/logic 与 src/dict 不依赖 react / DOM，可以直接 import，
 * 所以参数钳制、格式化、状态派生这些规则可以脱离渲染单独验证。
 *
 * 运行：node test/check-client-logic.mjs
 */

import assert from 'node:assert/strict'

import { zh } from '../src/dict/zh.js'
import { en } from '../src/dict/en.js'
import { DICT } from '../src/dict/index.js'
import { fallbackTranslate, localized } from '../src/i18n.js'
import * as logic from './helpers/logic.mjs'
import { createCheckRunner } from './helpers/check.mjs'
import {
  DIAG_HOST_LOG_TAIL,
  HOST_LOG_LINE_LIMIT,
  LOG_LINE_LIMIT,
  appendLogLines,
  buildDiagnostics,
  elapsedMsSince,
  formatClockTime,
  quotaText,
  readLogsPayload,
  sanitizeSession,
} from '../src/logic/logs.js'
import { NOTICE_TITLE_PREFIX, completionNotice, isCompletion, stripNoticePrefix } from '../src/logic/notice.js'
import { negativePromptActive, safeResetPatch, stepModeOf, stepTierOf } from '../shared/models-guide.js'
import * as contract from '../shared/contract.js'
import { PUBLIC_PRESETS } from '../shared/models.generated.js'
import * as studioPresets from '../src/studio/presets.js'
import { styles, token } from '../src/theme.js'
import { ACTIVE_STATUS, TRANSIENT_SESSION, PHASE_STATE, NS } from '../src/constants.js'
import { DEFAULT_RATIOS } from '../src/studio/presets.js'
import { RATIO_IDS, LIMITS, LOGS, KAGGLE_LOGIN, SETTINGS, UI_STATE } from '../shared/contract.js'

const t = fallbackTranslate('zh')
const te = fallbackTranslate('en')
const NOW = Date.parse('2026-11-09T05:05:00.000Z')
const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

const { check, summary } = createCheckRunner()

await check('参数钳制符合 SPEC 第 2 节硬性约束', () => {
  assert.equal(logic.clampSize(99999), 1536)
  assert.equal(logic.clampSize(1), 256)
  assert.equal(logic.clampSize(1000), 1000)
  assert.equal(logic.clampSize(253), 256, '应向上取到 8 的整数倍')
  assert.equal(logic.clampSize('x'), 1024, '非法值回落 1024')
  // 缺失值不是 0：空串 / 纯空白 / null / undefined 回退默认尺寸 1024（与 clampStrength 同约定），
  // 否则清空宽高输入框失焦会被 Number('') 当成 0，再静默钳到下限 256。
  assert.equal(logic.clampSize(''), 1024, '空串回退默认尺寸')
  assert.equal(logic.clampSize('   '), 1024, '纯空白回退默认尺寸')
  assert.equal(logic.clampSize(null), 1024)
  assert.equal(logic.clampSize(undefined), 1024)
  assert.equal(logic.clampSize(0), 256, '显式数字 0 仍按契约下限钳制')
  assert.equal(logic.clampInt(999, 1, 60, 4), 60)
  assert.equal(logic.clampInt(0, 1, 60, 4), 1)
  assert.equal(logic.clampInt('x', 1, 60, 4), 4)
  assert.equal(logic.clampNumber(99, 0, 20, 0), 20)
  assert.equal(logic.clampNumber(-1, 0, 20, 0), 0)
})

await check('种子解析', () => {
  assert.equal(logic.parseSeed(''), -1)
  assert.equal(logic.parseSeed('0'), 0)
  assert.equal(logic.parseSeed(' 42 '), 42)
  assert.equal(logic.parseSeed('-5'), -1)
  assert.equal(logic.parseSeed('abc'), -1)
  assert.equal(logic.parseSeed('1e999'), -1, '非有限值按未指定处理')
  assert.equal(logic.parseSeed('4294967296'), 2147483647, '上限钳到契约上界（32 位有符号整数）')
})

await check('参数边界与共享契约一致', () => {
  // clampSize 的边界与步长必须来自 LIMITS.width；否则客户端先按旧边界钳制、宿主再按契约钳一次，
  // 同一份表单会落出两种尺寸。
  assert.equal(logic.clampSize(LIMITS.width.max + 8), LIMITS.width.max)
  assert.equal(logic.clampSize(LIMITS.width.min - 8), LIMITS.width.min)
  assert.equal(logic.clampSize(LIMITS.width.max - 1), LIMITS.width.max, '按 LIMITS.width.step 取整后落到上限')
  assert.equal(logic.clampSize(LIMITS.width.min + 3), LIMITS.width.min, '按 LIMITS.width.step 取整后落到下限')
  // seed 超过契约上界必须钳到 LIMITS.seed.max，避免宿主静默取模后复现不出同一张图。
  assert.equal(logic.parseSeed(String(LIMITS.seed.max + 1)), LIMITS.seed.max)
  assert.equal(logic.parseSeed(LIMITS.seed.max), LIMITS.seed.max)
})

await check('重绘强度钳制：边界 / step 对齐 / 默认值', () => {
  // 边界来自 LIMITS.strength（min 0.2 / max 0.9 / step 0.05 / default 0.6）。
  assert.equal(logic.clampStrength(LIMITS.strength.default), LIMITS.strength.default)
  assert.equal(logic.clampStrength(0.55), 0.55)
  assert.equal(logic.clampStrength(LIMITS.strength.min), LIMITS.strength.min, '下边界原样保留')
  assert.equal(logic.clampStrength(LIMITS.strength.max), LIMITS.strength.max, '上边界原样保留')
  assert.equal(logic.clampStrength(0.01), LIMITS.strength.min, '低于下界钳到 min')
  assert.equal(logic.clampStrength(3), LIMITS.strength.max, '高于上界钳到 max')
  assert.equal(logic.clampStrength('x'), LIMITS.strength.default, '非法值回落默认值')
  assert.equal(logic.clampStrength(undefined), LIMITS.strength.default)
  assert.equal(logic.clampStrength(null), LIMITS.strength.default)
  // step 对齐：取最近档位（不是简单截断），且浮点噪声不能漏进请求体。
  assert.equal(logic.clampStrength(0.63), 0.65)
  assert.equal(logic.clampStrength(0.62), 0.6)
  assert.equal(logic.clampStrength(0.87), 0.85)
  assert.equal(logic.clampStrength(0.8500000001), 0.85)
  for (const input of [0.2, 0.21, 0.33, 0.444, 0.5555, 0.678, 0.71, 0.899, 0.9]) {
    const value = logic.clampStrength(input)
    assert.ok(value >= LIMITS.strength.min && value <= LIMITS.strength.max, `${input} 钳制后越界：${value}`)
    const steps = (value - LIMITS.strength.min) / LIMITS.strength.step
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${input} 应落在 step 档位上，实际 ${value}`)
    assert.equal(Number(value.toFixed(2)), value, `${input} 不应带浮点噪声，实际 ${value}`)
  }
  assert.equal(logic.clampStrength(0.2 + 9 * 0.05), 0.65, '0.2 + 9×0.05 的浮点尾巴要清掉')
})

await check('参考图文件名只取最后一段', () => {
  assert.equal(logic.referenceFileName('imagen-output/job-1/7.png'), '7.png')
  assert.equal(logic.referenceFileName('imagen-output\\job-1\\8.png'), '8.png')
  assert.equal(logic.referenceFileName('  7.png  '), '7.png')
  assert.equal(logic.referenceFileName(''), '')
  assert.equal(logic.referenceFileName(null), '')
  assert.equal(logic.referenceFileName(undefined), '')
})

await check('时长格式化', () => {
  assert.equal(logic.formatDuration(t, 9500), '9.5秒')
  assert.equal(logic.formatDuration(t, 30000), '30秒')
  assert.equal(logic.formatDuration(t, 62000), '1分 2秒')
  assert.equal(logic.formatDuration(t, 120000), '2分')
  assert.equal(logic.formatDuration(t, NaN), '—')
  assert.equal(logic.formatSeconds(t, 6.2), '6.2秒')
  assert.equal(logic.formatSeconds(t, 11.6), '11.6秒')
  assert.equal(logic.formatSeconds(t, 27.8), '27.8秒')
  assert.equal(logic.formatSeconds(te, 6.2), '6.2s')
})

// 阶段十五 Phase C0：涂抹 / 扩图画布与提交栏共用的两个读数工具收进 logic/format.js，
// 这里直接断言口径，避免四处各存一份副本后互相漂移。
await check('覆盖率百分比与正数像素读数共用同一口径', () => {
  // 百分比：不足 10% 保留一位小数，超过 100% 截断；非法值按 0 处理。
  assert.equal(logic.percentOf(0.004), 0.4, '刚涂一点保留一位小数，不显示 0%')
  assert.equal(logic.percentOf(0.0432), 4.3)
  assert.equal(logic.percentOf(0.4375), 44, '10% 以上取整')
  assert.equal(logic.percentOf(1), 100)
  assert.equal(logic.percentOf(1.5), 100, '覆盖率异常时按上限截断')
  assert.equal(logic.percentOf(0), 0)
  assert.equal(logic.percentOf(-1), 0)
  assert.equal(logic.percentOf('0.123'), 12, '字符串输入同样按数字处理')
  assert.equal(logic.percentOf(null), 0)
  assert.equal(logic.percentOf(undefined), 0)
  assert.equal(logic.percentOf(NaN), 0)
  // 正数像素：缺失 / 非法 / 非正数一律 null，交给调用方的 `??` 兜底链。
  assert.equal(logic.positiveSize(1024), 1024)
  assert.equal(logic.positiveSize('1152'), 1152)
  assert.equal(logic.positiveSize(1023.6), 1024, '四舍五入到整数像素')
  assert.equal(logic.positiveSize(0), null)
  assert.equal(logic.positiveSize(-5), null)
  assert.equal(logic.positiveSize(''), null)
  assert.equal(logic.positiveSize('  '), null)
  assert.equal(logic.positiveSize(null), null)
  assert.equal(logic.positiveSize(undefined), null)
  assert.equal(logic.positiveSize('x'), null)
  assert.equal(logic.positiveSize(Infinity), null)
})

await check('任务耗时与活跃任务查询', () => {
  const done = { id: 'a', status: 'done', seconds: 6.2 }
  assert.equal(logic.jobElapsed(done, NOW), 6200)
  assert.equal(logic.jobElapsed({ id: 'b', status: 'running', startedAt: at(-4) }, NOW), 4000)
  assert.equal(logic.jobElapsed(null, NOW), null)

  const state = {
    jobs: [
      { id: 'job-2', status: 'queued' },
      { id: 'job-1', status: 'done' },
    ],
  }
  assert.equal(logic.activeJobOf(state).id, 'job-2')
  assert.deepEqual(logic.stateJobs({ jobs: [null, { noId: true }, { id: 'x' }] }).map((job) => job.id), ['x'])
})

await check('待执行队列排序：进行中在前，其余按提交先后', () => {
  // 宿主 /state 的 jobs 是「最新在前」：后提交的排队任务排在正在生成的任务前面。
  // 若直接取首个活跃任务，进度文案会显示成「排队等待出图…」而把真正在跑的那张藏起来。
  const state = {
    jobs: [
      { id: 'job-b', status: 'queued', createdAt: at(-5) },
      { id: 'job-a', status: 'running', createdAt: at(-30) },
      { id: 'job-c', status: 'queued', createdAt: at(-9) },
      { id: 'job-0', status: 'done', createdAt: at(-60) },
    ],
  }
  assert.deepEqual(
    logic.pendingJobsOf(state).map((job) => job.id),
    ['job-a', 'job-c', 'job-b'],
    '进行中排第一，其余排队任务按提交时间升序',
  )
  assert.equal(logic.activeJobOf(state).id, 'job-a', '活动任务必须是真正在跑的那个')
  // 同一时刻只有一个 running / waiting-session：等云端的排在纯排队任务之前。
  const waiting = {
    jobs: [
      { id: 'q1', status: 'queued', createdAt: at(-2) },
      { id: 'w1', status: 'waiting-session', createdAt: at(-8) },
      { id: 'q2', status: 'queued', createdAt: at(-5) },
    ],
  }
  assert.deepEqual(logic.pendingJobsOf(waiting).map((job) => job.id), ['w1', 'q2', 'q1'])
  assert.deepEqual(logic.pendingJobsOf({ jobs: [] }), [])
  assert.deepEqual(logic.pendingJobsOf(null), [])
  assert.equal(logic.activeJobOf(null), null)
})

await check('阶段提示映射到会话态', () => {
  assert.equal(logic.phaseHint(t, { state: 'provisioning', phase: 'push' }), zh['session.hint.push'])
  assert.equal(logic.phaseHint(t, { state: 'provisioning', phase: 'queue' }), zh['session.hint.queue'])
  assert.equal(logic.phaseHint(t, { state: 'provisioning' }), zh['session.hint.provisioning'], '未知 phase 回落通用文案')
  assert.equal(logic.phaseHint(t, { state: 'connecting', phase: 'tunnel' }), zh['session.hint.connecting'])
  assert.equal(logic.phaseHint(t, { state: 'warming', phase: 'warm' }), zh['session.hint.warming'])
  assert.equal(logic.phaseHint(t, { state: 'stopping' }), zh['session.hint.stopping'])
  assert.equal(
    logic.phaseHint(t, { state: 'error', error: { code: 'session_ended' } }),
    zh['session.hint.asleep'],
    '会话自然结束按休眠说明，不落到错误态',
  )
  assert.equal(logic.phaseHint(t, { state: 'ready' }), '')
  assert.equal(logic.phaseHint(t, null), '')
  assert.equal(logic.phaseHint(te, { state: 'warming' }), en['session.hint.warming'])
})

await check('错误文案拼装顺序', () => {
  assert.equal(logic.errorText(t, { code: 'need_prompt' }), t('workbench.needPrompt'))
  assert.equal(logic.errorText(t, { code: 'network', message: 'fetch failed' }), t('error.network'))
  assert.equal(logic.errorText(t, { code: 'unknown_code', message: 'boom' }), 'boom')
  assert.equal(logic.errorText(t, { code: 'queue_timeout', message: 'queue 45m' }), `${t('error.code.queue_timeout')} · queue 45m`)
  assert.equal(logic.errorText(t, { code: 'unknown_code' }), t('error.http'))
  assert.equal(logic.errorText(t, null), '')
})

await check('云端状态派生：阶段标签、色调与可执行动作', () => {
  const absent = logic.computeStatusOf(t, { session: null })
  assert.equal(absent.state, 'absent')
  assert.equal(absent.label, t('session.state.absent'))
  assert.equal(absent.tone, 'idle')
  assert.equal(absent.transient, false)
  assert.equal(absent.canStart, true)
  assert.equal(absent.canStop, false)
  assert.equal(absent.tooltip, t('studio.compute.offlineTooltip'))

  // 推送环境与等待配额是两件事：标签与提示必须跟随 phase，不能都写「正在申请 GPU」。
  const pushing = logic.computeStatusOf(t, { session: { state: 'provisioning', phase: 'push' } })
  assert.equal(pushing.label, t('session.state.push'))
  assert.equal(pushing.hint, zh['session.hint.push'])
  assert.match(pushing.label, /准备/, '推送阶段应说明在准备云端')
  assert.equal(pushing.tone, 'warn')

  const queue = logic.computeStatusOf(t, { session: { state: 'provisioning', phase: 'queue' } })
  assert.equal(queue.label, t('session.state.queue'))
  assert.equal(queue.hint, zh['session.hint.queue'])
  assert.equal(queue.transient, true)

  const connecting = logic.computeStatusOf(t, { session: { state: 'connecting', phase: 'tunnel' } })
  assert.equal(connecting.label, t('session.state.connecting'))
  assert.notEqual(connecting.label, t('session.state.warming'), '连接隧道不能写成装载模型')

  const warming = logic.computeStatusOf(t, { session: { state: 'warming', phase: 'warm' } })
  assert.equal(warming.label, t('session.state.warming'))
  assert.equal(warming.phaseLabel, t('session.phase.warm'))

  const ready = logic.computeStatusOf(t, { session: { state: 'ready' } })
  assert.equal(ready.label, t('session.state.ready'))
  assert.equal(ready.tone, 'ok')
  assert.equal(ready.transient, false)
  assert.equal(ready.tooltip, t('studio.compute.idleTooltip'))

  // 会话自然结束：按「已关闭」展示，不落成红色异常；原因由指引卡给出。
  const ended = logic.computeStatusOf(t, { session: { state: 'error', error: { code: 'session_ended' } } })
  assert.equal(ended.asleep, true)
  assert.equal(ended.label, t('session.state.asleep'))
  assert.equal(ended.tone, 'idle')
  assert.equal(ended.canStart, true)
  assert.equal(ended.tooltip, t('studio.compute.asleepTooltip'))

  // 用户手动关机：absent + stoppedByUser，不再承诺「直接生成会自动启动」。
  const stopped = logic.computeStatusOf(t, { session: { state: 'absent', stoppedByUser: true } })
  assert.equal(stopped.stopped, true)
  assert.equal(stopped.label, t('session.state.asleep'))
  assert.equal(stopped.tooltip, t('studio.compute.asleepTooltip'))
  assert.notEqual(stopped.hint, '')

  // 错误态按错误码缩短标签，未知码回落到通用异常。
  const auth = logic.computeStatusOf(t, { session: { state: 'error', error: { code: 'auth_required', message: '缺少凭据' } } })
  assert.equal(auth.label, t('session.state.errorAuth'))
  assert.equal(auth.tone, 'error')
  const timeout = logic.computeStatusOf(t, { session: { state: 'error', error: { code: 'queue_timeout' } } })
  assert.equal(timeout.label, t('session.state.errorTimeout'))
  const unknown = logic.computeStatusOf(t, { session: { state: 'error', error: { code: 'boom' } } })
  assert.equal(unknown.label, t('session.state.error'))
  assert.equal(unknown.tooltip, t('studio.compute.errorTooltip'))
  const pushFailed = logic.computeStatusOf(t, { session: { state: 'error', error: { code: 'push_failed' } } })
  assert.equal(pushFailed.label, t('session.state.errorPush'), '推送失败发生在云端介入前，不能归成云端异常')
})

await check('排队分级：阈值兜底、等待时长与轮次键', () => {
  // 旧宿主不下发 queuePolicy：按契约默认 3 分钟 / 10 分钟兜底。
  assert.deepEqual(logic.queuePolicyOf(null), {
    slowMs: contract.TIMEOUTS.queueSlowMs,
    stalledMs: contract.TIMEOUTS.queueStalledMs,
  })
  assert.deepEqual(logic.queuePolicyOf({ session: {} }), {
    slowMs: contract.TIMEOUTS.queueSlowMs,
    stalledMs: contract.TIMEOUTS.queueStalledMs,
  })
  // 宿主下发的合法阈值原样使用，标题里的分钟数随之换算。
  assert.deepEqual(logic.queuePolicyOf({ queuePolicy: { slowMs: 120000, stalledMs: 300000 } }), {
    slowMs: 120000,
    stalledMs: 300000,
  })
  // 非法值逐字段回落；卡住档不得早于变慢档（与 Host 的归一化口径一致）。
  assert.deepEqual(logic.queuePolicyOf({ queuePolicy: { slowMs: -1, stalledMs: 0 } }), {
    slowMs: contract.TIMEOUTS.queueSlowMs,
    stalledMs: contract.TIMEOUTS.queueStalledMs,
  })
  const inverted = logic.queuePolicyOf({ queuePolicy: { slowMs: 600000, stalledMs: 120000 } })
  assert.equal(inverted.slowMs, 600000)
  assert.equal(inverted.stalledMs, 600000)
  assert.equal(logic.queueStalledMinutesOf({ slowMs: 60000, stalledMs: 300000 }), 5)
  assert.equal(logic.queueStalledMinutesOf(undefined), 10)

  // 「已排队」只认 provisioning + queue：推送与隧道阶段都不算排队。
  const queue = { state: 'provisioning', phase: 'queue', startedAt: at(-200) }
  assert.equal(logic.queueWaitMsOf(queue, NOW), 200000)
  assert.equal(logic.queueWaitMsOf({ ...queue, phase: 'push' }, NOW), null)
  assert.equal(logic.queueWaitMsOf({ ...queue, state: 'connecting', phase: 'tunnel' }, NOW), null)
  assert.equal(logic.queueWaitMsOf({ state: 'provisioning', phase: 'queue' }, NOW), null, '缺 startedAt 时不做分级')
  assert.equal(logic.queueWaitMsOf({ ...queue, startedAt: at(60) }, NOW), 0, '未来时间按 0 处理')
  assert.equal(logic.queueWaitMsOf(null, NOW), null)

  // 分级边界：慢档之前正常，卡住档之前仍只是变慢。
  const policy = logic.queuePolicyOf(null)
  assert.equal(logic.queueLevelOf(null, policy), '')
  assert.equal(logic.queueLevelOf(policy.slowMs - 1, policy), '')
  assert.equal(logic.queueLevelOf(policy.slowMs, policy), 'slow')
  assert.equal(logic.queueLevelOf(policy.stalledMs - 1, policy), 'slow')
  assert.equal(logic.queueLevelOf(policy.stalledMs, policy), 'stalled')
  const custom = { slowMs: 60000, stalledMs: 300000 }
  assert.equal(logic.queueLevelOf(299000, custom), 'slow')
  assert.equal(logic.queueLevelOf(300000, custom), 'stalled')

  // 轮次键：同一轮排队去重用同键，重排换新 startedAt 后可以再次提示。
  const first = { state: 'provisioning', phase: 'queue', startedAt: at(-660), presetId: 'sdxl-lightning' }
  const requeued = { ...first, startedAt: at(-5) }
  assert.equal(logic.queueRoundKeyOf(first), `${first.startedAt}|sdxl-lightning`)
  assert.notEqual(logic.queueRoundKeyOf(first), logic.queueRoundKeyOf(requeued))
  assert.equal(logic.queueRoundKeyOf({ ...first, presetId: undefined }), first.startedAt)
  assert.equal(logic.queueRoundKeyOf({ state: 'provisioning', phase: 'queue' }), '', '没有 startedAt 时无法判定轮次')
  assert.equal(logic.queueRoundKeyOf(null), '')
})

await check('排队分级接入云端状态：慢档只换提示，卡住档给出级别', () => {
  const queue = { state: 'provisioning', phase: 'queue', startedAt: at(-200), presetId: 'sdxl-lightning' }
  const slow = logic.computeStatusOf(t, { session: queue, now: NOW })
  assert.equal(slow.label, t('session.state.queue'), '慢档不改变胶囊标签')
  assert.equal(slow.tone, 'warn')
  assert.equal(slow.hint, zh['session.hint.queueSlow'])
  assert.equal(slow.queueLevel, 'slow')
  assert.equal(slow.queueWaitMs, 200000)

  // 未到慢档：仍是常规排队提示。
  const normal = logic.computeStatusOf(t, { session: { ...queue, startedAt: at(-30) }, now: NOW })
  assert.equal(normal.queueLevel, '')
  assert.equal(normal.hint, zh['session.hint.queue'])

  // 卡住档：状态条仍是同一条慢提示，可操作横幅由组合层另加。
  const stalled = logic.computeStatusOf(t, { session: { ...queue, startedAt: at(-700) }, now: NOW })
  assert.equal(stalled.queueLevel, 'stalled')
  assert.equal(stalled.hint, zh['session.hint.queueSlow'])

  // 宿主下发更短的阈值：分级跟随 policy，而不是写死 3 / 10 分钟。
  const custom = logic.computeStatusOf(t, {
    session: { ...queue, startedAt: at(-320) },
    queuePolicy: { slowMs: 60000, stalledMs: 300000 },
    now: NOW,
  })
  assert.equal(custom.queueLevel, 'stalled')
  assert.equal(logic.queueStalledMinutesOf({ slowMs: 60000, stalledMs: 300000 }), 5)

  // 非排队阶段不参与分级。
  const tunnel = logic.computeStatusOf(t, { session: { ...queue, state: 'connecting', phase: 'tunnel' }, now: NOW })
  assert.equal(tunnel.queueLevel, '')
  assert.equal(tunnel.hint, zh['session.hint.connecting'])
  // 英文界面同样走慢提示，且文案成对存在。
  assert.equal(logic.computeStatusOf(te, { session: queue, now: NOW }).hint, en['session.hint.queueSlow'])
})

await check('任务进度区分「等云端」与「等前一张图」', () => {
  const running = { status: 'running' }
  const waiting = { status: 'waiting-session' }
  const queued = { status: 'queued' }
  assert.equal(logic.jobProgressText(t, running, 'ready'), t('studio.progress.running'))
  assert.equal(logic.jobProgressText(t, waiting, 'provisioning'), t('studio.progress.waitingSession'))
  assert.equal(logic.jobProgressText(t, queued, 'provisioning'), t('studio.progress.waitingSession'))
  assert.equal(logic.jobProgressText(t, queued, 'ready'), t('studio.progress.queued'))
  assert.equal(logic.jobProgressText(t, null, 'ready'), '')
  assert.equal(logic.jobProgressText(te, queued, 'ready'), en['studio.progress.queued'])
})

await check('分张进度来自宿主结构化字段，不解析中文 stage', () => {
  const generating = (progress) => ({ status: 'running', stageCode: 'running', progress })
  assert.equal(logic.jobProgressText(t, generating({ done: 0, total: 4 }), 'ready'), '正在生成第 1/4 张')
  assert.equal(logic.jobProgressText(t, generating({ done: 2, total: 4 }), 'ready'), '正在生成第 3/4 张')
  assert.equal(
    logic.jobProgressText(t, generating({ done: 9, total: 4 }), 'ready'),
    '正在生成第 4/4 张',
    '完成数超过总数时夹到最后一格',
  )
  assert.equal(
    logic.jobProgressText(t, generating({ done: 0, total: 1 }), 'ready'),
    t('studio.progress.running'),
    '单张任务不显示计数',
  )
  assert.equal(
    logic.jobProgressText(t, generating({ done: 0 }), 'ready'),
    t('studio.progress.running'),
    '缺 total 时回落通用文案',
  )
  assert.equal(logic.jobProgressText(t, generating(null), 'ready'), t('studio.progress.running'))
  // 英文界面同样走本地化计数，不能把宿主的硬编码中文 stage 漏出来。
  assert.equal(
    logic.jobProgressText(te, generating({ done: 1, total: 3 }), 'ready'),
    en['studio.progress.generatingCount'].replace('{done}', '2').replace('{total}', '3'),
  )
  // 旧宿主只加 progress 不给 stageCode：status 仍是 running，也认分张进度。
  assert.equal(
    logic.jobProgressText(t, { status: 'running', progress: { done: 1, total: 2 } }, 'ready'),
    '正在生成第 2/2 张',
  )
  // loading：等云端加载模型时不再笼统说「等待云端就绪」。
  assert.equal(
    logic.jobProgressText(t, { status: 'waiting-session', stageCode: 'loading' }, 'warming'),
    t('studio.progress.loading'),
  )
  // stageCode 优先于 status；非法值回落到 status。
  assert.equal(
    logic.jobProgressText(t, { status: 'queued', stageCode: 'waiting-session' }, 'provisioning'),
    t('studio.progress.waitingSession'),
  )
  assert.equal(logic.jobProgressText(t, { status: 'queued', stageCode: 'weird' }, 'ready'), t('studio.progress.queued'))
  assert.equal(logic.jobProgressText(t, { status: 'failed', stageCode: 'failed' }, 'ready'), t('job.status.failed'))
})

await check('生图流水线：五节点映射、折叠、失败与收尾', () => {
  const pipeline = logic.pipelineViewOf
  const node = (view, index) => view.nodes[index]
  const labels = (view) => view.nodes.map((item) => item.label)
  const states = (view) => view.nodes.map((item) => item.state)

  // 冷启动排队：推送走完，排队是当前节点；已等待从这次会话开始时刻算。
  const queued = pipeline(t, {
    session: { state: 'provisioning', phase: 'queue', startedAt: at(-120), error: null },
    activeJob: { id: 'job-1', status: 'waiting-session', createdAt: at(-110) },
    pendingCount: 1,
    now: NOW,
  })
  assert.equal(queued.visible, true)
  assert.equal(queued.mode, 'waiting')
  assert.deepEqual(labels(queued), ['推送内核', 'Kaggle 排队', '建立隧道', '准备模型', '生成'])
  assert.deepEqual(states(queued), ['done', 'active', 'pending', 'pending', 'pending'])
  assert.equal(queued.timeText, '2:00')
  assert.equal(queued.queueText, '')
  // 等云端时不重复给生成节点挂说明：上一段节点已经在讲这件事。
  assert.equal(node(queued, 4).sub, undefined)

  // 慢档：排队节点标「比平时久」，但不改节点状态。
  const slow = pipeline(t, {
    session: { state: 'provisioning', phase: 'queue', startedAt: at(-200) },
    now: NOW,
  })
  assert.equal(node(slow, 1).warn, true)
  assert.equal(node(slow, 1).tag, '比平时久')

  // 连接与准备模型阶段没有可信起点：不显示计时（重连沿用旧 startedAt，读数会虚高）。
  const warming = pipeline(t, {
    session: { state: 'warming', phase: 'warm', startedAt: at(-3600) },
    now: NOW,
  })
  assert.equal(warming.visible, true)
  assert.deepEqual(states(warming), ['done', 'done', 'done', 'active', 'pending'])
  assert.equal(warming.timeText, '')

  // 出现阈值：等待不足 1.5 秒时不闪条。
  const quick = pipeline(t, {
    session: { state: 'provisioning', phase: 'push', startedAt: at(-1) },
    now: NOW,
  })
  assert.equal(quick.visible, false)

  // 云端已就绪：前四节点折叠成「云端已就绪」，生成节点带分张进度与后续排队数。
  const warm = pipeline(t, {
    session: { state: 'ready' },
    activeJob: { id: 'job-2', status: 'running', progress: { done: 1, total: 4 }, createdAt: at(-30) },
    pendingCount: 2,
    now: NOW,
  })
  assert.deepEqual(labels(warm), ['云端已就绪', '生成'])
  assert.deepEqual(states(warm), ['done', 'active'])
  assert.equal(node(warm, 1).sub, '第 2/4 张')
  assert.equal(warm.queueText, '另有 1 个排队')
  assert.equal(warm.timeText, '0:30')

  // 完成态：最后节点读出图完成，计时冻结为耗时；只有刚完成的记录才会亮条。
  const doneJob = { id: 'job-3', status: 'done', startedAt: at(-10), finishedAt: at(-1), seconds: 6 }
  const done = pipeline(t, { session: { state: 'ready' }, focusedJob: doneJob, now: NOW })
  assert.equal(done.mode, 'complete')
  assert.equal(node(done, 1).label, '出图完成')
  assert.equal(done.timeLabel, '用时')
  assert.equal(done.timeText, '0:06')
  assert.equal(logic.pipelineHoldOf(doneJob, NOW), true)
  assert.equal(logic.pipelineHoldOf(doneJob, NOW + 10000), false, '页面重开时旧完成记录不应重新亮条')

  // 失败：停在生成失败节点；指引提示被收起后整条一起收起。
  const failedJob = {
    id: 'job-4',
    status: 'failed',
    createdAt: at(-120),
    startedAt: at(-100),
    finishedAt: at(-2),
    error: { code: 'generation_failed' },
  }
  const failed = pipeline(t, { session: { state: 'ready' }, focusedJob: failedJob, now: NOW })
  assert.equal(failed.mode, 'failed')
  assert.equal(node(failed, 1).label, '生成失败')
  assert.deepEqual(states(failed), ['done', 'failed'])
  const dismissed = pipeline(t, {
    session: { state: 'ready' },
    focusedJob: failedJob,
    failureDismissed: true,
    now: NOW,
  })
  assert.equal(dismissed.visible, false, '收起指引提示后流水线应一起收起')

  // 会话异常：从错误码反推停在哪一段（这里卡在排队）。
  const errored = pipeline(t, {
    session: { state: 'error', phase: null, error: { code: 'queue_timeout' }, startedAt: at(-300) },
    now: NOW,
  })
  assert.equal(errored.mode, 'failed')
  assert.equal(node(errored, 1).state, 'failed')

  // 环境前置错误（没装 CLI / 没登录）：红点落在第一段，而不是冒充「准备模型失败」。
  const cliError = pipeline(t, {
    session: { state: 'error', error: { code: 'cli_missing', message: '未找到 kaggle CLI' } },
    now: NOW,
  })
  assert.equal(cliError.mode, 'failed')
  assert.equal(node(cliError, 0).state, 'failed')
  assert.equal(cliError.timeText, '', '会话级失败没有可信起点，不显示计时')

  // 会话自然结束不属于某一段失败：流水线隐藏，交给指引卡去「唤醒」。
  assert.equal(
    pipeline(t, { session: { state: 'error', error: { code: 'session_ended' } }, now: NOW }).visible,
    false,
  )

  // 关闭云端：只留一行提示，不画节点。
  const closing = pipeline(t, { session: { state: 'stopping' }, now: NOW })
  assert.equal(closing.mode, 'closing')
  assert.equal(closing.nodes.length, 1)
  assert.equal(closing.nodes[0].label, '正在关闭云端…')

  // 没有任何等待：整条隐藏。
  assert.equal(pipeline(t, { session: { state: 'ready' }, now: NOW }).visible, false)

  // 英文界面：节点与计时标签都走字典。
  assert.deepEqual(
    labels(pipeline(te, { session: { state: 'provisioning', phase: 'tunnel', startedAt: at(-30) }, now: NOW })),
    ['Push kernel', 'Kaggle queue', 'Open tunnel', 'Prepare model', 'Generate'],
  )

  // 分秒计时口径。
  assert.equal(logic.clockOf(0), '0:00')
  assert.equal(logic.clockOf(125000), '2:05')
})

await check('指引卡色调：硬错误红窄条，环境前置与状态提示琥珀窄条', () => {
  for (const kind of ['oom', 'session', 'network', 'generate', 'generic']) {
    assert.equal(logic.guidanceToneOf(kind), 'error', `${kind} 应是红色窄条`)
  }
  for (const kind of ['auth', 'cli', 'gpu', 'sleep', 'closed']) {
    assert.equal(logic.guidanceToneOf(kind), 'warn', `${kind} 应是琥珀窄条`)
  }
  assert.equal(logic.guidanceToneOf(''), '')
})

await check('计数文案占位替换', () => {
  assert.equal(logic.formatText('第 {done}/{total} 张', { done: 2, total: 4 }), '第 2/4 张')
  assert.equal(logic.formatText('{count} more queued', { count: 2 }), '2 more queued')
  assert.equal(logic.formatText('{a}-{b}', { a: 1 }), '1-{b}', '缺失的值保留占位符')
  assert.equal(logic.formatText('', {}), '')
  assert.equal(logic.formatText(null, {}), '')
})

await check('画廊列数断点与行优先分列', () => {
  // 列数断点必须与 gallery.css 的响应式断点一致：>1400→5，≤1400→4，≤1180→3，≤900→2。
  assert.equal(logic.galleryColumnCount(1600), 5)
  assert.equal(logic.galleryColumnCount(1401), 5)
  assert.equal(logic.galleryColumnCount(1400), 4)
  assert.equal(logic.galleryColumnCount(1181), 4)
  assert.equal(logic.galleryColumnCount(1180), 3)
  assert.equal(logic.galleryColumnCount(901), 3)
  assert.equal(logic.galleryColumnCount(900), 2)
  assert.equal(logic.galleryColumnCount(520), 2)
  assert.equal(logic.galleryColumnCount(0), 5, '未知宽度按桌面 5 列')
  assert.equal(logic.galleryColumnCount('x'), 5)

  // 行优先：第 1、2、3… 条依次落在第 1、2、3… 列，视觉第一行就是最新顺序。
  assert.deepEqual(logic.galleryColumns([1, 2, 3, 4, 5, 6, 7], 3), [[1, 4, 7], [2, 5], [3, 6]])
  assert.equal(logic.galleryColumns([1, 2, 3], 4).length, 4, '分桶数固定等于列数')
  assert.deepEqual(logic.galleryColumns([], 3), [[], [], []])
  assert.deepEqual(logic.galleryColumns(null, 2), [[], []])
  assert.equal(logic.galleryColumns([1, 2], 0).length, 1, '列数非法时至少保留一列')
})

await check('意图确认卡的种子策略：默认随机，显式锁种才沿用', () => {
  const lastJob = { id: 'job-1', params: { seed: 17 } }
  assert.equal(logic.lastSeedOf(lastJob), 17)
  assert.equal(logic.lastSeedOf({ params: { seed: 0 } }), 0)
  assert.equal(logic.lastSeedOf({ params: {} }), null)
  assert.equal(logic.lastSeedOf({ params: { seed: -3 } }), null)
  assert.equal(logic.lastSeedOf(null), null)

  assert.equal(logic.intentSeedOf({}, lastJob, ''), null, '默认不锁种，交给宿主随机')
  assert.equal(logic.intentSeedOf({ lockSeed: false }, lastJob, ''), null)
  assert.equal(logic.intentSeedOf({ lockSeed: true }, lastJob, ''), 17, '显式打开开关才沿用上一张构图')
  assert.equal(logic.intentSeedOf({ lockSeed: true }, lastJob, '42'), null, '表单指定种子时以用户输入为准')
  assert.equal(logic.intentSeedOf({ lockSeed: true }, lastJob, '   '), 17, '空白种子的表单视为未指定')
  assert.equal(logic.intentSeedOf({ lockSeed: true }, null, ''), null, '没有上一张图时退回随机')
})

await check('意图确认卡行内微调：字段白名单与裁剪', () => {
  // 只有提示词、排除项与张数可编辑；比例仍由当前设置或重新解析决定。
  assert.deepEqual(logic.INTENT_EDITABLE_FIELDS, ['prompt', 'negative', 'count'])
  // 编辑时不 trim：边打字边去空格会让光标跳位，裁剪放到提交时做。
  assert.deepEqual(logic.intentFieldPatch('prompt', ' edited '), { prompt: ' edited ' })
  assert.deepEqual(logic.intentFieldPatch('negative', 'blurry, text'), { negative: 'blurry, text' })
  assert.deepEqual(logic.intentFieldPatch('prompt', null), { prompt: '' }, '非字符串按清空处理')
  assert.equal(logic.intentFieldPatch('ratioId', '16:9'), null, '非白名单字段应忽略')
  assert.equal(logic.intentFieldPatch('styleId', 'ink'), null, '风格字段已删除')
  // textarea 的 maxLength 拦不住粘贴与程序化赋值，纯函数再按契约兜一层。
  assert.equal(
    logic.intentFieldPatch('prompt', 'x'.repeat(LIMITS.prompt.maxChars + 10)).prompt.length,
    LIMITS.prompt.maxChars,
  )
  assert.equal(
    logic.intentFieldPatch('negative', 'x'.repeat(LIMITS.negativePrompt.maxChars + 10)).negative.length,
    LIMITS.negativePrompt.maxChars,
  )

  // 排除项快照：去首尾空白并按契约裁剪。
  assert.equal(logic.intentNegative('  blurry, text  '), 'blurry, text')
  assert.equal(logic.intentNegative(null), '')
  assert.equal(logic.intentNegative('x'.repeat(LIMITS.negativePrompt.maxChars + 5)).length, LIMITS.negativePrompt.maxChars)
})

await check('过渡态已等待时长', () => {
  const session = { state: 'provisioning', startedAt: at(-90) }
  assert.equal(logic.sessionElapsedMs(session, NOW), 90000)
  assert.equal(
    logic.sessionElapsedMs({ state: 'connecting', startedAt: at(-9000) }, NOW),
    null,
    '重连沿用旧 startedAt，不能拿来算等待时长',
  )
  assert.equal(logic.sessionElapsedMs({ state: 'warming', startedAt: at(-9000) }, NOW), null)
  assert.equal(logic.sessionElapsedMs({ state: 'stopping', startedAt: at(-90) }, NOW), null)
  assert.equal(logic.sessionElapsedMs({ state: 'error', startedAt: at(-90) }, NOW), null)
  assert.equal(logic.sessionElapsedMs({ state: 'provisioning' }, NOW), null)
  assert.equal(logic.sessionElapsedMs(null, NOW), null)
})

await check('空闲关机倒计时只认宿主真实读数', () => {
  // 两个字段都来自宿主快照：idleSeconds 来自远端 /health，idleTimeoutSec 是生效阈值。
  assert.deepEqual(logic.idleShutdownOf({ idleSeconds: 600, idleTimeoutSec: 1800 }), {
    idleSeconds: 600,
    idleMinutes: 10,
    totalMinutes: 30,
  })
  assert.deepEqual(logic.idleShutdownOf({ idleSeconds: 3599, idleTimeoutSec: 3600 }), {
    idleSeconds: 3599,
    idleMinutes: 59,
    totalMinutes: 60,
  })
  // 缺任一字段都不展示：宁可暂时没有这一行，也不显示「已空闲 0 分钟」。
  assert.equal(logic.idleShutdownOf({ idleSeconds: null, idleTimeoutSec: 1800 }), null)
  assert.equal(logic.idleShutdownOf({ idleSeconds: 600 }), null)
  assert.equal(logic.idleShutdownOf({ idleTimeoutSec: 1800 }), null)
  // 不足一分钟与非法值同样不展示。
  assert.equal(logic.idleShutdownOf({ idleSeconds: 30, idleTimeoutSec: 1800 }), null)
  assert.equal(logic.idleShutdownOf({ idleSeconds: -5, idleTimeoutSec: 1800 }), null)
  assert.equal(logic.idleShutdownOf({ idleSeconds: 'x', idleTimeoutSec: 1800 }), null)
  assert.equal(logic.idleShutdownOf(null), null)
})

await check('运行设置：分钟换算、钳制与快捷档位', () => {
  const minMinutes = Math.ceil(SETTINGS.idleTimeoutSec.min / 60)
  const maxMinutes = Math.floor(SETTINGS.idleTimeoutSec.max / 60)
  assert.equal(logic.IDLE_MIN_MINUTES, minMinutes)
  assert.equal(logic.IDLE_MAX_MINUTES, maxMinutes)
  // 视图 → 分钟（取整），缺省/非法值回落默认档 30 分钟。
  assert.equal(logic.idleMinutesOf(1800), 30)
  assert.equal(logic.idleMinutesOf(1900), 32)
  assert.equal(logic.idleMinutesOf(undefined), 30)
  assert.equal(logic.idleMinutesOf('x'), 30)
  assert.equal(logic.idleMinutesOf(0), 30)
  // 越界按契约 min/max 钳制。
  assert.equal(logic.idleMinutesOf(60), minMinutes)
  assert.equal(logic.idleMinutesOf(999999), maxMinutes)
  // 分钟 → 秒：非数值返回 null（按未修改处理），越界钳制后换算。
  assert.equal(logic.idleTimeoutSecOf(30), 1800)
  assert.equal(logic.idleTimeoutSecOf('45'), 2700)
  assert.equal(logic.idleTimeoutSecOf(1), minMinutes * 60)
  assert.equal(logic.idleTimeoutSecOf(9999), maxMinutes * 60)
  assert.equal(logic.idleTimeoutSecOf(''), null)
  assert.equal(logic.idleTimeoutSecOf('abc'), null)
  assert.equal(logic.idleTimeoutSecOf(0), null)
  // 快捷档位高亮只认整数命中。
  for (const minutes of SETTINGS.idleTimeoutSec.quickMinutes) {
    assert.equal(logic.quickIdleMinutes(String(minutes)), minutes)
    assert.equal(logic.quickIdleMinutes(minutes), minutes)
  }
  assert.equal(logic.quickIdleMinutes(45), null)
  assert.equal(logic.quickIdleMinutes('30.5'), null)
  assert.equal(logic.quickIdleMinutes(''), null)
})

await check('运行设置：多行文本与数组互转', () => {
  assert.deepEqual(logic.parseLineList(' a/b \n\n c/d \r\nc/d\na/b'), ['a/b', 'c/d'], '去空白、去空行、去重')
  assert.deepEqual(logic.parseLineList(''), [])
  assert.deepEqual(logic.parseLineList(null), [])
  assert.deepEqual(logic.formatLineList([' a ', '', 'b', 'a', null]), 'a\nb')
  assert.equal(logic.formatLineList(null), '')
  // 契约上限：最多 SETTINGS.maxItems 行；超长行丢弃。
  const many = Array.from({ length: SETTINGS.maxItems + 5 }, (_, index) => `owner/ds-${index}`)
  assert.equal(logic.parseLineList(many.join('\n')).length, SETTINGS.maxItems)
  assert.deepEqual(logic.parseLineList(`${'x'.repeat(SETTINGS.maxItemChars + 1)}\nok/item`), ['ok/item'])
})

await check('运行设置：本地模型映射行级校验', () => {
  const valid = logic.parseLocalModels('stabilityai/stable-diffusion-xl-base-1.0=/kaggle/input/sdxl\n\norg/repo = /kaggle/input/repo')
  assert.deepEqual(valid.value, {
    'stabilityai/stable-diffusion-xl-base-1.0': '/kaggle/input/sdxl',
    'org/repo': '/kaggle/input/repo',
  })
  assert.deepEqual(valid.errors, [])

  // 每一行都要能独立定位：缺 =、repo 不是 owner/name、路径不以 / 开头。
  const broken = logic.parseLocalModels([
    'owner/repo=/kaggle/input/repo',
    'missing-equals',
    'no-slash=/kaggle/input/x',
    'owner/repo2=relative/path',
    'owner/repo3=/kaggle/input/ok',
  ].join('\n'))
  assert.deepEqual(broken.value, {
    'owner/repo': '/kaggle/input/repo',
    'owner/repo3': '/kaggle/input/ok',
  })
  assert.deepEqual(broken.errors.map((error) => error.line), [2, 3, 4], '错误必须带行号')
  assert.deepEqual(
    broken.errors.map((error) => error.message),
    [
      'studio.settings.localModels.errorFormat',
      'studio.settings.localModels.errorRepo',
      'studio.settings.localModels.errorPath',
    ],
  )
  for (const error of broken.errors) {
    assert.ok(DICT.zh[error.message], `${error.message} 缺少中文文案`)
    assert.ok(DICT.en[error.message], `${error.message} 缺少英文文案`)
  }

  // 重复 repo 后写覆盖前写，不产生行级错误。
  assert.deepEqual(logic.parseLocalModels('org/repo=/a\norg/repo=/b').value, { 'org/repo': '/b' })
  // 超长行与超项数也走行级错误。
  const tooLong = logic.parseLocalModels(`${'a'.repeat(SETTINGS.maxItemChars + 1)}=/x`)
  assert.equal(tooLong.errors[0].message, 'studio.settings.localModels.errorTooLong')
  const many = Array.from({ length: SETTINGS.maxItems + 1 }, (_, index) => `org/repo-${index}=/kaggle/input/${index}`)
  const overflow = logic.parseLocalModels(many.join('\n'))
  assert.equal(Object.keys(overflow.value).length, SETTINGS.maxItems)
  assert.equal(overflow.errors.length, 1)
  assert.equal(overflow.errors[0].message, 'studio.settings.localModels.errorTooMany')
  assert.equal(overflow.errors[0].params.max, SETTINGS.maxItems)

  assert.equal(logic.formatLocalModels({ 'org/repo': '/kaggle/input/repo' }), 'org/repo=/kaggle/input/repo')
  assert.equal(logic.formatLocalModels(null), '')
})

await check('运行设置：脱敏视图 → 表单', () => {
  const view = {
    idleTimeoutSec: 1800,
    accelerator: 'NvidiaTeslaP100',

    provider: 'kaggle',
    colabGpu: 'L4',
    colabHighRam: false,
    datasetSources: ['owner/dataset'],
    localModels: { 'org/repo': '/kaggle/input/repo' },
    pipConstraints: ['diffusers==0.31.0'],
    hasHfToken: true,
    hfTokenSource: 'config',
    effectiveOnNextSession: true,
  }
  const form = logic.formFromSettings(view)
  assert.deepEqual(form, {
    idleMinutes: '30',
    accelerator: 'NvidiaTeslaP100',

    provider: 'kaggle',
    colabGpu: 'L4',
    colabHighRam: false,
    // 视图缺 kaggleTransport（旧宿主）：按兼容口径 cli 处理，不指向不存在的登录路由。
    kaggleTransport: 'cli',
    // 视图本来就不回传 hfToken 原文：表单永远从空串开始。
    hfToken: '',
    clearHfToken: false,
    datasetSourcesText: 'owner/dataset',
    localModelsText: 'org/repo=/kaggle/input/repo',
    pipConstraintsText: 'diffusers==0.31.0',
  })
  // 未知/缺失字段回落到默认值与空表单。
  const fallback = logic.formFromSettings({})
  assert.equal(fallback.idleMinutes, '30')
  assert.equal(fallback.accelerator, SETTINGS.defaultAccelerator)
  assert.equal(fallback.datasetSourcesText, '')
  assert.equal(fallback.localModelsText, '')
  assert.equal(logic.formFromSettings(null).accelerator, SETTINGS.defaultAccelerator)
  // 响应形状：只认契约的 { ok: true, settings: view }。
  assert.equal(logic.settingsViewOf({ ok: true, data: { settings: view } }), view)
  assert.equal(logic.settingsViewOf({ ok: true, data: view }), null, '缺少 settings 包装不猜测')
  assert.equal(logic.settingsViewOf({ ok: false, data: { settings: view } }), null)
  assert.equal(logic.settingsViewOf(null), null)
})

await check('运行设置：表单 → 请求体只含改动字段', () => {
  const view = {
    idleTimeoutSec: 1800,
    accelerator: 'NvidiaTeslaT4',

    provider: 'kaggle',
    colabGpu: 'L4',
    colabHighRam: false,
    datasetSources: ['owner/dataset'],
    localModels: { 'org/repo': '/kaggle/input/repo' },
    pipConstraints: ['diffusers==0.31.0'],
    hasHfToken: true,
    hfTokenSource: 'settings',
    effectiveOnNextSession: false,
  }
  const form = logic.formFromSettings(view)
  assert.deepEqual(logic.buildSettingsPayload(form, view), {}, '没改任何字段时不提交空 body')
  assert.equal(logic.hasSettingsChanges({}), false)
  assert.equal(logic.hasSettingsChanges({ accelerator: 'NvidiaTeslaP100' }), true)

  // 只改空闲分钟：换算成秒提交。
  assert.deepEqual(logic.buildSettingsPayload({ ...form, idleMinutes: '45' }, view), { idleTimeoutSec: 2700 })
  // 只改加速器。
  assert.deepEqual(
    logic.buildSettingsPayload({ ...form, accelerator: 'NvidiaTeslaP100' }, view),
    { accelerator: 'NvidiaTeslaP100' },
  )
  // hfToken 为空不提交；有内容才提交且去掉首尾空白。
  assert.deepEqual(logic.buildSettingsPayload({ ...form, hfToken: '   ' }, view), {})
  assert.deepEqual(logic.buildSettingsPayload({ ...form, hfToken: ' hf_secret ' }, view), { hfToken: 'hf_secret' })
  // 清除 Token 单独提交 clearHfToken，不与 hfToken 同时出现。
  assert.deepEqual(
    logic.buildSettingsPayload({ ...form, hfToken: '', clearHfToken: true }, view),
    { clearHfToken: true },
  )
  assert.deepEqual(
    logic.buildSettingsPayload({ ...form, hfToken: 'hf_new', clearHfToken: true }, view),
    { clearHfToken: true },
  )
  // 三个多行字段：内容变化按数组/对象提交。
  assert.deepEqual(
    logic.buildSettingsPayload({ ...form, datasetSourcesText: 'owner/dataset\nsecond/ds' }, view),
    { datasetSources: ['owner/dataset', 'second/ds'] },
  )
  assert.deepEqual(
    logic.buildSettingsPayload({ ...form, pipConstraintsText: 'diffusers==0.31.0\ntransformers==4.44.2' }, view),
    { pipConstraints: ['diffusers==0.31.0', 'transformers==4.44.2'] },
  )
  assert.deepEqual(
    logic.buildSettingsPayload({ ...form, localModelsText: 'org/repo=/kaggle/input/repo\norg/repo2=/kaggle/input/repo2' }, view),
    { localModels: { 'org/repo': '/kaggle/input/repo', 'org/repo2': '/kaggle/input/repo2' } },
  )
  // 非法行禁止保存：校验不通过，且请求体不会带 localModels。
  const invalidForm = { ...form, localModelsText: 'broken-line' }
  assert.equal(logic.validateSettingsForm(invalidForm).ok, false)
  assert.equal(logic.validateSettingsForm(invalidForm).errors[0].line, 1)
  assert.deepEqual(logic.buildSettingsPayload(invalidForm, view), {})
  assert.equal(logic.validateSettingsForm(form).ok, true)

  // Token 来源文案键覆盖契约里的全部取值域。
  for (const source of SETTINGS.hfTokenSources) {
    const key = logic.hfTokenSourceKey(source)
    assert.ok(DICT.zh[key], `${key} 缺少中文文案`)
    assert.ok(DICT.en[key], `${key} 缺少英文文案`)
  }
  assert.equal(logic.hfTokenSourceKey('unknown'), logic.hfTokenSourceKey('none'))
})

await check('运行设置：请求错误文案可读', () => {
  // 浏览器原文（Failed to fetch / HTTP 404）不能直接抛给用户。
  assert.equal(logic.settingsErrorText(t, { code: 'network', message: 'Failed to fetch' }), t('error.network'))
  assert.equal(logic.settingsErrorText(t, { code: 'http_404', message: 'HTTP 404' }), t('error.http'))
  assert.equal(
    logic.settingsErrorText(t, { code: 'invalid_request', message: 'localModels 必须是对象' }),
    `${t('error.code.invalid_request')} · localModels 必须是对象`,
  )
  assert.equal(logic.settingsErrorText(t, null), '')
})

await check('运行设置：加速器展示名与错误文案齐全', () => {
  // 展示名只放字典（contract 只登记取值域），每个白名单 id 都要有中英文。
  for (const accelerator of SETTINGS.accelerators) {
    const key = `studio.settings.accelerator.${accelerator}`
    assert.ok(DICT.zh[key], `${key} 缺少中文展示名`)
    assert.ok(DICT.en[key], `${key} 缺少英文展示名`)
    assert.equal(typeof DICT.zh[key], 'string')
  }
  assert.match(DICT.zh['studio.settings.accelerator.NvidiaTeslaT4'], /默认推荐/)
  assert.match(DICT.en['studio.settings.accelerator.NvidiaTeslaT4'], /recommended/i)
  // 抽屉的新键都在两侧有值（静态引用 + 动态命名空间）。
  const settingsKeys = Object.keys(DICT.zh).filter((key) => key.startsWith('studio.settings.'))
  assert.ok(settingsKeys.length >= 40, `运行设置文案过少：${settingsKeys.length}`)
  for (const key of settingsKeys) {
    assert.ok(typeof DICT.en[key] === 'string' && DICT.en[key].length > 0, `${key} 缺少英文文案`)
    assert.ok(typeof DICT.zh[key] === 'string' && DICT.zh[key].length > 0, `${key} 缺少中文文案`)
  }
})

await check('工作台界面态：归一化、响应解析与保存补丁', () => {
  // 白名单字段与默认值来自契约：任何损坏 / 旧版本输入都回落默认值，不抛异常。
  assert.deepEqual(logic.normalizeUiState(null), UI_STATE.defaults)
  assert.deepEqual(logic.normalizeUiState(undefined), UI_STATE.defaults)
  assert.deepEqual(logic.normalizeUiState('x'), UI_STATE.defaults)
  assert.deepEqual(logic.normalizeUiState([]), UI_STATE.defaults)
  assert.deepEqual(logic.normalizeUiState({ advancedOpen: true, mystery: 1 }), { advancedOpen: true }, '未知字段丢弃')
  assert.deepEqual(logic.normalizeUiState({ advancedOpen: 'yes' }), { advancedOpen: false }, '类型不符回落默认值')
  assert.deepEqual(logic.normalizeUiState({ advancedOpen: null }), { advancedOpen: false })
  assert.deepEqual(Object.keys(logic.normalizeUiState({})), Object.keys(UI_STATE.defaults), '归一结果始终是全量视图')

  // 响应形状：只认 `{ ok: true, data: { ok: true, uiState } }`，其余一律 null 由调用方回落默认值。
  assert.deepEqual(
    logic.uiStateViewOf({ ok: true, data: { ok: true, uiState: { advancedOpen: true, extra: 'x' } } }),
    { advancedOpen: true },
  )
  assert.equal(logic.uiStateViewOf({ ok: false, code: 'network' }), null)
  assert.equal(logic.uiStateViewOf({ ok: true, data: { ok: false } }), null)
  assert.equal(logic.uiStateViewOf({ ok: true, data: { ok: true } }), null)
  assert.equal(logic.uiStateViewOf({ ok: true, data: { ok: true, uiState: [] } }), null)
  assert.equal(logic.uiStateViewOf(null), null)

  // 保存补丁：只带白名单字段且类型正确，未知字段与空补丁不提交。
  assert.deepEqual(logic.buildUiStatePatch({ advancedOpen: true }), { advancedOpen: true })
  assert.deepEqual(logic.buildUiStatePatch({ advancedOpen: false }), { advancedOpen: false })
  assert.deepEqual(logic.buildUiStatePatch({ unknown: true }), {})
  assert.deepEqual(logic.buildUiStatePatch({ advancedOpen: 'yes' }), {})
  assert.deepEqual(logic.buildUiStatePatch({}), {})
  assert.deepEqual(logic.buildUiStatePatch(null), {})
  assert.deepEqual(logic.buildUiStatePatch([]), {})
  assert.equal(UI_STATE.defaults.advancedOpen, false, '高级设置默认收起')
})

await check('运行设置：Kaggle 访问方式白名单与保存补丁', () => {
  // 取值域只来自契约；默认是直连（免装 kaggle CLI），cli 作为兼容退路保留。
  assert.deepEqual(SETTINGS.kaggleTransports, ['direct', 'cli'])
  assert.equal(SETTINGS.defaultKaggleTransport, 'direct')
  for (const transport of SETTINGS.kaggleTransports) {
    assert.equal(logic.normalizeKaggleTransport(transport), transport)
  }
  for (const invalid of [undefined, null, '', 'bogus', 'DIRECT', 1, true, {}]) {
    assert.equal(logic.normalizeKaggleTransport(invalid), SETTINGS.defaultKaggleTransport, `非法值应按默认值：${invalid}`)
  }
  // 展示名键按契约取值域派发，中英文案两侧都要有。
  for (const transport of SETTINGS.kaggleTransports) {
    const key = logic.kaggleTransportLabelKey(transport)
    assert.equal(key, `studio.settings.kaggleTransport.option.${transport}`)
    assert.ok(DICT.zh[key], `${key} 缺少中文文案`)
    assert.ok(DICT.en[key], `${key} 缺少英文文案`)
  }
  assert.equal(logic.kaggleTransportLabelKey('bogus'), 'studio.settings.kaggleTransport.option.direct')

  // 表单：视图里的值原样带出；非法值回落契约默认值，字段缺失按旧宿主 cli。
  assert.equal(logic.formFromSettings({ kaggleTransport: 'cli' }).kaggleTransport, 'cli')
  assert.equal(logic.formFromSettings({ kaggleTransport: 'auto' }).kaggleTransport, 'direct')
  assert.equal(logic.formFromSettings({}).kaggleTransport, 'cli')
  // 请求体：只有真正切换时才补丁；旧视图缺字段按 cli 比较。
  const legacyView = { idleTimeoutSec: 1800, accelerator: 'NvidiaTeslaT4' }
  const legacyForm = logic.formFromSettings(legacyView)
  assert.deepEqual(logic.buildSettingsPayload(legacyForm, legacyView), {}, '旧视图 + 未改动不产生补丁')
  assert.deepEqual(
    logic.buildSettingsPayload({ ...legacyForm, kaggleTransport: 'direct' }, legacyView),
    { kaggleTransport: 'direct' },
    '切到直连提交 kaggleTransport',
  )
  assert.deepEqual(
    logic.buildSettingsPayload(legacyForm, { ...legacyView, kaggleTransport: 'direct' }),
    { kaggleTransport: 'cli' },
    '从直连切回 CLI 也要提交',
  )
  // 直连说明文案要带凭据路径占位符。
  assert.match(DICT.zh['studio.settings.kaggleTransport.directHint'], /\{path\}/)
  assert.match(DICT.en['studio.settings.kaggleTransport.directHint'], /\{path\}/)
})

await check('Kaggle 直连登录：响应归一与状态判断', () => {
  // 契约口径：状态、模式、轮询间隔与总时限都从 KAGGLE_LOGIN 取。
  assert.deepEqual(logic.LOGIN_STATES, KAGGLE_LOGIN.states)
  assert.deepEqual(logic.LOGIN_MODES, KAGGLE_LOGIN.modes)
  assert.equal(logic.LOGIN_POLL_MS, KAGGLE_LOGIN.pollMs)
  assert.equal(logic.LOGIN_TIMEOUT_MS, KAGGLE_LOGIN.timeoutMs)

  // 空视图与旧宿主缺字段：可渲染的 idle 视图，不抛异常。
  assert.deepEqual(logic.normalizeLoginView(null), logic.emptyLoginView())
  assert.deepEqual(logic.normalizeLoginView('x'), logic.emptyLoginView())
  assert.deepEqual(logic.normalizeLoginView([]), logic.emptyLoginView())
  const pending = {
    state: 'pending',
    mode: 'manual',
    url: 'https://www.kaggle.com/oauth/authorize?code_challenge=abc',
    message: 'waiting',
    username: null,
    startedAt: at(0),
    finishedAt: null,
  }
  assert.deepEqual(logic.normalizeLoginView(pending), pending)
  // 未知状态按 idle、未知模式按 browser、非 http(s) 链接置空、空白字符串置空。
  const dirty = logic.normalizeLoginView({
    state: 'working',
    mode: 'qr',
    url: 'javascript:alert(1)',
    message: '  ',
    username: '  ',
    startedAt: '',
    finishedAt: 42,
  })
  assert.deepEqual(dirty, {
    state: 'idle',
    mode: 'browser',
    url: null,
    message: null,
    username: null,
    startedAt: null,
    finishedAt: null,
  })

  // 响应形状：只认 `{ ok: true, data: { ok: true, login } }`。
  assert.deepEqual(logic.loginViewOf({ ok: true, data: { ok: true, login: pending } }), pending)
  assert.equal(logic.loginViewOf({ ok: false, code: 'network' }), null)
  assert.equal(logic.loginViewOf({ ok: true, data: { ok: false, error: { code: 'invalid_request' } } }), null)
  assert.equal(logic.loginViewOf({ ok: true, data: { ok: true } }), null, '缺 login 不猜测登录结果')
  assert.equal(logic.loginViewOf(null), null)

  // 状态判断：只有 pending 需要轮询、不能重复发起。
  assert.equal(logic.isLoginPending({ state: 'pending' }), true)
  assert.equal(logic.isLoginPending({ state: 'done' }), false)
  assert.equal(logic.isLoginPending(null), false)
  assert.equal(logic.loginCanStart({ state: 'pending' }), false)
  assert.equal(logic.loginCanStart({ state: 'done' }), false)
  for (const state of ['idle', 'failed', 'cancelled']) {
    assert.equal(logic.loginCanStart({ state }), true, `${state} 应可以重新发起`)
  }
  assert.equal(logic.loginCanStart(null), true)
  assert.equal(logic.loginIsTerminal({ state: 'done' }), true)
  assert.equal(logic.loginIsTerminal({ state: 'pending' }), false)

  // 超时兜底：达到契约 timeoutMs 即超时，起点非法按未超时处理。
  assert.equal(logic.loginTimedOut(1000, 1000 + KAGGLE_LOGIN.timeoutMs - 1), false)
  assert.equal(logic.loginTimedOut(1000, 1000 + KAGGLE_LOGIN.timeoutMs), true)
  assert.equal(logic.loginTimedOut(undefined, 1), false)
  assert.equal(logic.shouldPollLogin({ state: 'pending' }, 0, KAGGLE_LOGIN.timeoutMs - 1), true)
  assert.equal(logic.shouldPollLogin({ state: 'pending' }, 0, KAGGLE_LOGIN.timeoutMs), false)
  assert.equal(logic.shouldPollLogin({ state: 'done' }, 0, 0), false)
})

await check('Kaggle 直连登录：manual 授权码清洗与校验', () => {
  // 清洗：去首尾与内部空白、去 `code=` 前缀、去包裹的引号 / 尖括号。
  assert.equal(logic.cleanLoginCode('  abcdefgh  '), 'abcdefgh')
  assert.equal(logic.cleanLoginCode('abc\ndef\tgh'), 'abcdefgh')
  assert.equal(logic.cleanLoginCode('code=abcdefgh'), 'abcdefgh')
  assert.equal(logic.cleanLoginCode('CODE = "abcdefgh"'), 'abcdefgh')
  assert.equal(logic.cleanLoginCode('<abcdefgh>'), 'abcdefgh')
  assert.equal(logic.cleanLoginCode(null), '')
  assert.equal(logic.cleanLoginCode(42), '')

  // 校验：空 / 过短 / 过长 / 非法字符都给出字典键，合法值只回清洗后的码。
  assert.deepEqual(logic.validateLoginCode(''), {
    ok: false,
    code: '',
    message: 'studio.guidance.auth.codeEmpty',
  })
  assert.equal(logic.validateLoginCode('abc').message, 'studio.guidance.auth.codeTooShort')
  assert.equal(logic.validateLoginCode('a'.repeat(logic.LOGIN_CODE_MAX_CHARS + 1)).message, 'studio.guidance.auth.codeTooLong')
  assert.equal(logic.validateLoginCode('abcd$efgh').message, 'studio.guidance.auth.codeFormat')
  const valid = logic.validateLoginCode('  code=ab_cd-EF.123~45/6=  ')
  assert.equal(valid.ok, true)
  assert.equal(valid.code, 'ab_cd-EF.123~45/6=')
  assert.equal(valid.message, '')
  const colabUrl = logic.validateLoginCode('http://localhost:8765/?state=s1&code=4%2F0AanRRtestCode1234&scope=openid')
  assert.deepEqual(colabUrl, { ok: true, code: '4/0AanRRtestCode1234', message: '' })
  assert.equal(logic.loginCodeCanSubmit('abc'), false)
  assert.equal(logic.loginCodeCanSubmit(valid.code), true)
  for (const key of [
    'studio.guidance.auth.codeEmpty',
    'studio.guidance.auth.codeTooShort',
    'studio.guidance.auth.codeTooLong',
    'studio.guidance.auth.codeFormat',
  ]) {
    assert.ok(DICT.zh[key], `${key} 缺少中文文案`)
    assert.ok(DICT.en[key], `${key} 缺少英文文案`)
  }

  // 请求体：动作名来自契约白名单；submit-code 只接受清洗后的授权码。
  assert.deepEqual(logic.loginActionBody('start'), { action: 'start' })
  assert.deepEqual(logic.loginActionBody('cancel'), { action: 'cancel' })
  assert.deepEqual(logic.loginActionBody('submit-code', ' abcd efgh '), { action: 'submit-code', code: 'abcdefgh' })
  assert.deepEqual(logic.loginActionBody('submit-code', '   '), { action: 'submit-code' })
  assert.equal(logic.loginActionBody('delete', 'x'), null, '白名单外的动作不发请求')
})

await check('Kaggle 直连登录：失败原因与宿主 message 归类', () => {
  const reasonKeys = [
    'studio.guidance.auth.reason.timeout',
    'studio.guidance.auth.reason.state',
    'studio.guidance.auth.reason.browser',
    'studio.guidance.auth.reason.exchange',
    'studio.guidance.auth.reason.network',
    'studio.guidance.auth.reason.unavailable',
    'studio.guidance.auth.reason.request',
    'studio.guidance.auth.reason.unknown',
  ]
  for (const key of reasonKeys) {
    assert.ok(DICT.zh[key], `${key} 缺少中文文案`)
    assert.ok(DICT.en[key], `${key} 缺少英文文案`)
  }
  assert.equal(logic.loginFailureKey({ state: 'failed', message: 'timed out waiting for callback' }), 'studio.guidance.auth.reason.timeout')
  assert.equal(logic.loginFailureKey({ state: 'failed', message: 'state mismatch' }), 'studio.guidance.auth.reason.state')
  assert.equal(logic.loginFailureKey({ state: 'failed', message: 'could not open browser' }), 'studio.guidance.auth.reason.browser')
  assert.equal(logic.loginFailureKey({ state: 'failed', message: 'token exchange failed' }), 'studio.guidance.auth.reason.exchange')
  assert.equal(logic.loginFailureKey({ state: 'failed', message: 'network unreachable' }), 'studio.guidance.auth.reason.network')
  assert.equal(logic.loginFailureKey({ state: 'failed', message: '未知原因' }), 'studio.guidance.auth.reason.unknown')
  assert.equal(logic.loginFailureKey({ state: 'failed', message: null }), 'studio.guidance.auth.reason.unknown')
  // 非失败态不展示失败原因。
  assert.equal(logic.loginFailureKey({ state: 'pending' }), '')
  assert.equal(logic.loginFailureKey(null), '')
})

await check('直连模式：探测失败归类与访问方式展示键', () => {
  // CLI 正常 / 缺失的归类保持不变（旧宿主行为）。
  const cliMissing = { cli: { present: false }, auth: { ok: false } }
  assert.equal(logic.probeFailureCode(cliMissing), 'cli_missing')
  assert.equal(logic.probeFailureCode(cliMissing, { transport: 'cli' }), 'cli_missing')
  // 直连模式：cli 探测失败只说明没登录，不能弹「安装 CLI」卡。
  assert.equal(logic.probeFailureCode(cliMissing, { transport: 'direct' }), 'auth_required')
  assert.equal(
    logic.probeFailureCode({ cli: { present: true, direct: true }, auth: { ok: false } }, { transport: 'direct' }),
    'auth_required',
  )
  // probeOutcomeOf 的 options 透传：同样的响应在两种模式下失败码不同。
  const payload = { ok: false, probe: cliMissing }
  assert.equal(logic.probeOutcomeOf(payload).code, 'cli_missing')
  assert.equal(logic.probeOutcomeOf(payload, { transport: 'direct' }).code, 'auth_required')
  assert.equal(logic.probeOutcomeOf({ ok: true, probe: { cli: { present: true } } }, { transport: 'direct' }).ok, true)

  // 展示键：CLI 模式「命令行」，直连模式「直连」+「直连正常 / 直连未登录」。
  assert.equal(logic.accessMethodKey('cli'), 'studio.probe.cli')
  assert.equal(logic.accessMethodKey('direct'), 'studio.probe.direct')
  assert.equal(logic.accessMethodKey(undefined), 'studio.probe.cli')
  assert.equal(logic.accessStatusKey('cli', 'ok'), 'value.ok')
  assert.equal(logic.accessStatusKey('cli', 'failed'), 'value.failed')
  assert.equal(logic.accessStatusKey('cli', 'unknown'), 'value.unknown')
  assert.equal(logic.accessStatusKey('direct', 'ok'), 'studio.probe.directOk')
  assert.equal(logic.accessStatusKey('direct', 'failed'), 'studio.probe.directLoginRequired')
  assert.equal(logic.accessStatusKey('direct', 'unknown'), 'value.unknown')
  // 状态来源：CLI 模式看 cli 探测，直连模式以账号（auth）为准。
  const probeOkStatus = { cli: 'ok', auth: 'ok', quota: 'ok', notes: [] }
  const probeAuthFailed = { cli: 'ok', auth: 'failed', quota: 'ok', notes: [] }
  const probeCliFailed = { cli: 'failed', auth: 'unknown', quota: 'unknown', notes: [] }
  assert.equal(logic.accessStatusOf(probeOkStatus, 'cli'), 'ok')
  assert.equal(logic.accessStatusOf(probeAuthFailed, 'cli'), 'ok', 'CLI 模式 cli 可用即正常')
  assert.equal(logic.accessStatusOf(probeAuthFailed, 'direct'), 'failed', '直连模式未登录按失败展示')
  assert.equal(logic.accessStatusOf(probeCliFailed, 'direct'), 'unknown', '直连模式缺 auth 信息时不编造登录态')
  assert.equal(logic.accessStatusOf(null, 'direct'), 'unknown')
  for (const key of ['studio.probe.direct', 'studio.probe.directOk', 'studio.probe.directLoginRequired']) {
    assert.ok(DICT.zh[key], `${key} 缺少中文文案`)
    assert.ok(DICT.en[key], `${key} 缺少英文文案`)
  }
})

await check('状态色与常量表一致', () => {
  assert.equal(logic.toneColor('ok'), token.ok)
  assert.equal(logic.toneColor('warn'), token.warn)
  assert.equal(logic.toneColor('error'), token.error)
  assert.equal(logic.toneColor('idle'), token.idle)
  assert.equal(logic.toneColor('unknown'), token.idle)
  assert.equal(logic.jobColor('running'), token.brand)
  assert.equal(logic.jobColor('unknown'), token.idle)
  for (const state of Object.keys(TRANSIENT_SESSION)) {
    assert.equal(TRANSIENT_SESSION[state], true)
    assert.ok(t(`session.state.${state}`) !== `session.state.${state}`, `${state} 缺少状态文案`)
  }
  assert.equal(ACTIVE_STATUS.running, true)
  for (const phase of Object.keys(PHASE_STATE)) assert.ok(t(`session.phase.${phase}`) !== `session.phase.${phase}`)
})

await check('文案字典两侧一致且无空值', () => {
  assert.deepEqual(Object.keys(DICT.en).sort(), Object.keys(DICT.zh).sort())
  for (const key of Object.keys(DICT.zh)) {
    assert.equal(typeof DICT.zh[key], 'string', `${key} 的 zh 文案应为字符串`)
    assert.ok(DICT.zh[key].length > 0, `${key} 的 zh 文案不应为空`)
    assert.ok(DICT.en[key].length > 0, `${key} 的 en 文案不应为空`)
  }
  assert.equal(localized(t, 'no.such.key'), '')
  assert.equal(localized(t, 'studio.brand'), t('studio.brand'))
})

await check('样式 token 与命名空间自洽', () => {
  assert.equal(NS, 'our-imagen')
  assert.ok(styles.headerChip && styles.headerChipText && typeof styles.dot === 'function', '徽章样式应存在')
  for (const [name, value] of Object.entries(token)) {
    assert.match(value, /^var\(--dsw-alias-[\w-]+\)$/, `token.${name} 必须引用宿主 CSS 变量`)
  }
})

await check('错误码映射到指引类型', () => {
  assert.equal(logic.guidanceKindOf(''), '')
  assert.equal(logic.guidanceKindOf('need_prompt'), '', '本地校验错误不弹卡')
  assert.equal(logic.guidanceKindOf('oom'), 'oom')
  assert.equal(logic.guidanceKindOf('session_ended'), 'sleep', '自然结束按休眠卡处理')
  assert.equal(logic.guidanceKindOf('stopped'), 'closed', '手动关机单独归因，不套用闲置休眠文案')
  assert.equal(logic.guidanceKindOf('cli_missing'), 'cli')
  assert.equal(logic.guidanceKindOf('auth_required'), 'auth')
  for (const code of [
    'push_failed',
    'queue_timeout',
    'tunnel_timeout',
    'health_failed',
    'remote_error',
    'session_error',
    'session_timeout',
    'session_absent',
  ]) {
    assert.equal(logic.guidanceKindOf(code), 'session', `${code} 应能重新唤醒`)
  }
  for (const code of ['generation_failed', 'load_failed', 'invalid_request', 'empty_result', 'invalid_prompt', 'queue_full']) {
    assert.equal(logic.guidanceKindOf(code), 'generate', `${code} 应能按原参数重试`)
  }
  for (const code of ['delete_failed', 'http_500', 'probe_failed', 'unknown_code']) {
    assert.equal(logic.guidanceKindOf(code), 'generic', `${code} 只应关闭，不应触发重新出图`)
  }
  // 网络层错误有独立卡片：文案由客户端解释，不给用户看 "Failed to fetch"。
  assert.equal(logic.guidanceKindOf('network'), 'network')
  assert.equal(logic.isConnectionCode('network'), true)
  assert.equal(logic.isConnectionCode('session_error'), false)
  assert.equal(logic.isConnectionCode(''), false)
  // 远端没拿到 GPU 单独归到 gpu 卡：不能复用「生成失败重试」，重试只会再耗一次排队。
  assert.equal(logic.guidanceKindOf('gpu_unavailable'), 'gpu')
  assert.notEqual(logic.guidanceKindOf('gpu_unavailable'), 'generate')
  // 指引展示通道分流：全局阻塞卡留顶部横幅，其余局部/可恢复提示进右上角通知。
  assert.equal(logic.guidanceSurfaceOf(''), '')
  for (const kind of ['auth', 'cli', 'gpu', 'network', 'session']) {
    assert.equal(logic.guidanceSurfaceOf(kind), 'banner', `${kind} 应留在顶部横幅`)
  }
  for (const kind of ['oom', 'generate', 'sleep', 'closed', 'generic']) {
    assert.equal(logic.guidanceSurfaceOf(kind), 'toast', `${kind} 应降级到右上角通知`)
  }
  assert.equal(logic.KAGGLE_ACCOUNT_URL, 'https://www.kaggle.com/settings')
  assert.equal(logic.KAGGLE_SETTINGS_URL, 'https://www.kaggle.com/settings/api')
  // 凭据口径对齐 kaggle CLI 2.x：kaggle auth login 写 OAuth 凭据 credentials.json
  //（含 refresh_token 自动续期），同时兼容网页端生成的 access_token 与旧版 kaggle.json。
  assert.equal(logic.KAGGLE_LOGIN_COMMAND, 'kaggle auth login')
  assert.match(logic.KAGGLE_CREDENTIAL_PATH, /^%USERPROFILE%\\\.kaggle\\credentials\.json$/)
  assert.match(logic.KAGGLE_ACCESS_TOKEN_PATH, /^%USERPROFILE%\\\.kaggle\\access_token$/)
  assert.match(logic.KAGGLE_LEGACY_CREDENTIAL_PATH, /^%USERPROFILE%\\\.kaggle\\kaggle\.json$/)
  // 三个位置互不替代：卡片文案必须同时给出 OAuth 凭据、网页 Token 与旧版兼容位置。
  assert.equal(
    new Set([
      logic.KAGGLE_CREDENTIAL_PATH,
      logic.KAGGLE_ACCESS_TOKEN_PATH,
      logic.KAGGLE_LEGACY_CREDENTIAL_PATH,
    ]).size,
    3,
  )
  const authHint = zh['studio.guidance.auth.credentialHint']
  for (const placeholder of ['{path}', '{token}', '{legacy}']) {
    assert.ok(authHint.includes(placeholder), `凭据指引缺少占位符：${placeholder}`)
  }
  assert.match(authHint, /refresh_token/, '中文凭据指引应说明 OAuth 凭据可自动续期')
  assert.match(en['studio.guidance.auth.credentialHint'], /refresh_token/, '英文凭据指引应说明 OAuth 凭据可自动续期')
})

await check('指引卡详情优先级', () => {
  assert.equal(logic.guidanceDetailOf({}), '')
  assert.equal(logic.guidanceDetailOf({ error: { code: 'x', message: '本地失败' } }), '本地失败')
  assert.equal(
    logic.guidanceDetailOf({ session: { error: { message: '排队超时' } }, job: { error: { message: '任务失败' } } }),
    '排队超时',
    '会话错误优先于历史任务错误',
  )
  assert.equal(
    logic.guidanceDetailOf({ job: { error: { message: '显存不足：CUDA out of memory' } } }),
    '显存不足：CUDA out of memory',
  )
  assert.equal(logic.guidanceDetailOf({ session: { detail: '已关机' } }), '已关机')
  assert.equal(logic.guidanceDetailOf({ error: { message: 'a\n  b' } }), 'a b', '换行折叠成一行')
  assert.ok(logic.guidanceDetailOf({ error: { message: 'x'.repeat(400) } }).length <= 240, '详情应截断')
})

await check('负向词能力判定：模型支持且 CFG > 0 才可用', () => {
  // 规则来自 shared/models-guide.js（Host 与 Client 共用），这里锁客户端消费的结论。
  const capable = { id: 'sdxl-base', cfg: 7, negativeHint: 'blurry, low quality' }
  const incapable = { id: 'flux2-klein-4b', cfg: 1, negativeHint: 'blurry', supportsNegative: false }
  const legacy = { id: 'old-host', cfg: 7, negativeHint: 'blurry' }
  const legacyNoHint = { id: 'old-host', cfg: 7, negativeHint: '' }

  // 1) 旧宿主没有 supportsNegative：用 negativeHint 非空兜底判断管线能力。
  assert.equal(negativePromptActive(legacy, 7), true, '旧宿主有推荐词即视为可用')
  assert.equal(negativePromptActive(legacyNoHint, 7), false, '旧宿主没有推荐词即视为不可用')
  assert.equal(negativePromptActive(legacy, 0), false, 'CFG=0 时仍不可用')

  // 2) 默认 4 步极速模型 cfg=0：默认隐藏排除项。
  assert.equal(negativePromptActive({ id: 'sdxl-lightning', cfg: 0, negativeHint: 'blurry' }, 0), false)
  // 3) 用户主动抬高 CFG 后出现；恢复推荐值后再次隐藏。
  assert.equal(negativePromptActive({ id: 'sdxl-lightning', cfg: 0, negativeHint: 'blurry' }, 1.5), true)
  assert.equal(negativePromptActive({ id: 'sdxl-lightning', cfg: 0, negativeHint: 'blurry' }, 0), false)
  // 4) supportsNegative=false（FLUX.2 管线没有 negative_prompt 参数）永不出现。
  assert.equal(negativePromptActive(incapable, 7), false)
  assert.equal(negativePromptActive({ ...incapable, cfg: 0 }, 20), false)
  assert.equal(negativePromptActive({ id: 'flux2-klein-4b', supportsNegative: false, negativeHint: '' }, 20), false)

  // 没有推荐词但模型声明支持负向词：CFG 必须高于预设推荐值才算「用户主动抬高」。
  const noHint = { id: 'sdxl-turbo', cfg: 1, negativeHint: '', supportsNegative: true }
  assert.equal(negativePromptActive(noHint, 1), false)
  assert.equal(negativePromptActive(noHint, 2), true)

  // 预设缺失（旧宿主 / 尚未拿到预设）：只看 cfg > 0。
  assert.equal(negativePromptActive(null, 0), false)
  assert.equal(negativePromptActive(null, 1.5), true)
  assert.equal(negativePromptActive(undefined, 0), false)
  // 非法 CFG 回落到预设推荐值。
  assert.equal(negativePromptActive(capable, 'x'), true)
  assert.equal(negativePromptActive({ id: 'sdxl-lightning', cfg: 0, negativeHint: 'blurry' }, undefined), false)
})

await check('提交体：负向词按 negativeActive 门控，提示词不再拼接后缀', () => {
  const form = {
    prompt: ' 一只霓虹猫 ',
    negative: ' blurry, low quality ',
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 2,
  }
  // 可用：原样提交合并后的负向词；提示词只有用户原文，没有任何风格后缀。
  const on = logic.buildGenerateBody(form, { negativeActive: true })
  assert.equal(on.prompt, '一只霓虹猫')
  assert.equal(on.negativePrompt, 'blurry, low quality')
  assert.equal(on.count, 2)
  assert.equal(Object.prototype.hasOwnProperty.call(on, 'styleId'), false, '请求体不再有 styleId')
  // 不可用：不发送无效负向参数（字段置空串，而不是省略）。
  const off = logic.buildGenerateBody(form, { negativeActive: false })
  assert.equal(off.negativePrompt, '')
  assert.equal(off.prompt, '一只霓虹猫')
  // 门控同样作用于覆盖项（对话 / 变体 / 重试链路）。
  const overridden = logic.buildGenerateBody(form, {
    negativeActive: false,
    overrides: { prompt: '聊天输入', negativePrompt: 'card negative' },
  })
  assert.equal(overridden.prompt, '聊天输入')
  assert.equal(overridden.negativePrompt, '', '覆盖项里的负向词也不能绕过门控')
  assert.equal(overridden.seed, -1)
  // 不传 negativeActive 的旧调用方保持原有提交行为（不门控）。
  assert.equal(logic.buildGenerateBody(form).negativePrompt, 'blurry, low quality')
  // negativeForSubmit 是 useStudioForm.buildBody 的合并入口。
  assert.equal(logic.negativeForSubmit({ negative: ' blurry ' }, true), 'blurry')
  assert.equal(logic.negativeForSubmit({ negative: 'blurry' }, false), '')
  assert.equal(
    logic.negativeForSubmit({ negativeLayers: { model: 'blurry', user: 'my own' } }, true),
    'blurry, my own',
  )
  // 提示词为空时不产生任何内容。
  assert.equal(logic.buildGenerateBody({ ...form, prompt: '  ' }, { negativeActive: true }).prompt, '')
})

await check('请求体：只有带参考图时才出现 reference（文生图请求体不变）', () => {
  const form = {
    prompt: '一只赛博猫',
    negative: '',
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
  }
  const txt2img = logic.buildGenerateBody(form)
  assert.ok(!('reference' in txt2img), '没有参考图时请求体不得出现 reference 字段')
  // 旧表单形状（没有 strength / reference 字段）与显式 null 必须得到同一个请求体。
  assert.deepEqual(
    logic.buildGenerateBody({ ...form, reference: null, strength: LIMITS.strength.default }),
    txt2img,
    '无参考图时请求体与改造前逐字一致',
  )

  const img2img = logic.buildGenerateBody({
    ...form,
    reference: { path: ' imagen-output/job-1/7.png ', url: '/imagen-api/file?path=x' },
    strength: 0.75,
  })
  assert.deepEqual(
    img2img.reference,
    { path: 'imagen-output/job-1/7.png', strength: 0.75 },
    '参考图只提交 path 与 strength，url 绝不进请求体',
  )
  assert.ok(!JSON.stringify(img2img).includes('/imagen-api/file'), '缩略图 url 不能被序列化进请求体')
  assert.ok(!('strength' in img2img), 'strength 只存在于 reference 内部，不单独出现在顶层')

  // 越界 / 非 step 档位的强度按契约归一后再提交。
  const clamped = logic.buildGenerateBody({ ...form, reference: { path: 'imagen-output/a.png' }, strength: 3 })
  assert.equal(clamped.reference.strength, LIMITS.strength.max)
  // 只有 url 没有路径：按文生图处理，不输出残缺的 reference。
  assert.ok(!('reference' in logic.buildGenerateBody({ ...form, reference: { url: '/x' }, strength: 0.6 })))

  // 覆盖项（对话 / 变体 / 重试链路）同样按同一套规则归一。
  const overridden = logic.buildGenerateBody(form, {
    overrides: { prompt: '聊天输入', reference: { path: 'imagen-output/b.png', url: '/y' }, strength: 0.35 },
  })
  assert.deepEqual(overridden.reference, { path: 'imagen-output/b.png', strength: 0.35 })
  assert.ok(!('strength' in overridden), '覆盖项里的 strength 也只在 reference 内部')
  // 覆盖成 null 时回到文生图（显式移除参考图）。
  assert.ok(!('reference' in logic.buildGenerateBody(
    { ...form, reference: { path: 'imagen-output/a.png' }, strength: 0.6 },
    { overrides: { reference: null } },
  )))
})

// 局部重绘（Inpaint）：蒙版挂在 reference.mask 上，纯逻辑负责画笔/涂抹状态与导出前校验。
const MASK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

await check('局部涂抹：画笔尺寸与涂抹状态归一', () => {
  // 画笔尺寸：默认值 / 边界 / step 对齐（取最近档位，不是简单截断）。
  assert.equal(logic.clampBrushSize(undefined), logic.MASK_BRUSH.default)
  assert.equal(logic.clampBrushSize('x'), logic.MASK_BRUSH.default)
  assert.equal(logic.clampBrushSize(null), logic.MASK_BRUSH.default)
  assert.equal(logic.clampBrushSize(1), logic.MASK_BRUSH.min)
  assert.equal(logic.clampBrushSize(999), logic.MASK_BRUSH.max)
  assert.equal(logic.clampBrushSize(42), 44, '(42-8)/4=8.5 应取最近的 44 档')
  assert.equal(logic.clampBrushSize(43), 44)
  assert.equal(logic.clampBrushSize(40), 40, '默认尺寸本身就在档位上')

  // 工具状态：尺寸保留、橡皮擦可切换，只认严格的布尔。
  assert.deepEqual(logic.brushStateOf({ size: 60, eraser: true }), { size: 60, eraser: true })
  assert.deepEqual(logic.brushStateOf({ size: 60, eraser: 1 }), { size: 60, eraser: false }, '只认严格的 true')
  assert.deepEqual(logic.brushStateOf(null), { size: logic.MASK_BRUSH.default, eraser: false })
  assert.deepEqual(logic.toggleEraser({ size: 60, eraser: false }), { size: 60, eraser: true })
  assert.deepEqual(logic.toggleEraser({ size: 60, eraser: true }), { size: 60, eraser: false })

  // 涂抹状态：覆盖率钳制与空状态。
  assert.deepEqual(logic.emptyMaskState(), { coverage: 0 })
  assert.deepEqual(logic.maskStateOf({ coverage: 0.4 }), { coverage: 0.4 })
  assert.deepEqual(logic.maskStateOf({ coverage: -1 }), { coverage: 0 })
  assert.deepEqual(logic.maskStateOf({ coverage: 3 }), { coverage: 1 })
  assert.deepEqual(logic.maskStateOf(null), { coverage: 0 })
  assert.equal(logic.maskHasInk({ coverage: logic.MASK_MIN_COVERAGE }), true)
  assert.equal(logic.maskHasInk({ coverage: logic.MASK_MIN_COVERAGE / 2 }), false, '低于最小有效面积按空蒙版处理')
  assert.equal(logic.maskCoverageOf(0, 100), 0)
  assert.equal(logic.maskCoverageOf(250, 1000), 0.25)
  assert.equal(logic.maskCoverageOf(2000, 1000), 1, '覆盖率不超过 1')
  assert.equal(logic.maskCoverageOf('x', 100), 0)
  assert.equal(logic.maskCoverageOf(10, 0), 0)

  // 画布缩放 / 平移 / 快捷步进画笔。
  assert.equal(logic.clampZoom(0.5), 1)
  assert.equal(logic.clampZoom(1.01), 1, '贴近 1.0 时自动吸附回 1')
  assert.equal(logic.clampZoom(9), logic.MASK_ZOOM.max)
  assert.deepEqual(logic.clampPan({ x: 50, y: -30 }, { zoom: 1 }), { x: 0, y: 0 }, '1× 下强制居中')
  const zoomed = logic.zoomAtPoint({
    zoom: 1,
    pan: { x: 0, y: 0 },
    anchor: { x: 100, y: -50 },
    nextZoom: 2,
    bounds: { stageWidth: 500, stageHeight: 400, viewWidth: 600, viewHeight: 500 },
  })
  assert.equal(zoomed.zoom, 2)
  assert.deepEqual(zoomed.pan, { x: -100, y: 50 }, '围绕指针位置放大后，同一图像点仍留在指针下')
  assert.deepEqual(
    logic.zoomAtPoint({ zoom: 2, pan: zoomed.pan, anchor: { x: 100, y: -50 }, nextZoom: 1 }),
    { zoom: 1, pan: { x: 0, y: 0 } },
  )
  assert.equal(logic.stepBrushSize(40, 1), 44)
  assert.equal(logic.stepBrushSize(40, -1), 36)
  assert.equal(logic.stepBrushSize(logic.MASK_BRUSH.min, -1), logic.MASK_BRUSH.min)
  assert.equal(logic.stepBrushSize(logic.MASK_BRUSH.max, 1), logic.MASK_BRUSH.max)
})

await check('局部涂抹：推荐强度常量与契约区间一致', () => {
  // 真机验收（2026-11-16）：4 步极速模型在契约默认 0.6 下蒙版区改动偏弱，0.8 才有可见重写；
  // 专用 inpaint 权重（9 通道）需要 0.9 才会明显替换。工具打开时由 `toolStrengthDefaultOf`
  // 按这两个常量套用默认档，用户拖动后保持自己的值。
  assert.ok(logic.MASK_STRENGTH_DEFAULT > LIMITS.strength.default, '涂抹默认强度应高于契约默认值')
  assert.ok(
    logic.MASK_STRENGTH_DEFAULT >= LIMITS.strength.min && logic.MASK_STRENGTH_DEFAULT <= LIMITS.strength.max,
    '涂抹默认强度必须落在契约区间内',
  )
  assert.ok(
    Math.abs((logic.MASK_STRENGTH_DEFAULT - LIMITS.strength.min) % LIMITS.strength.step) < 1e-9,
    '必须对齐契约步长（浮点余量按 1e-9 判断）',
  )
  // 专用 inpaint 权重（9 通道）：小蒙版需要更高的强度才会明显替换，默认抬到 0.9。
  assert.ok(logic.MASK_STRENGTH_NATIVE > logic.MASK_STRENGTH_DEFAULT)
  assert.ok(logic.MASK_STRENGTH_NATIVE <= LIMITS.strength.max, '专用模型默认强度不能超过契约上限')
})

await check('局部涂抹：蒙版导出前置校验与画布比例', () => {
  // 画布长边固定、短边按宽高比（远端按最近邻对齐参考图宽高，同比例才不会错位）。
  assert.deepEqual(logic.maskCanvasSizeOf(1024, 1024, 1024), { width: 1024, height: 1024 })
  assert.deepEqual(logic.maskCanvasSizeOf(1152, 648, 1024), { width: 1024, height: 576 })
  assert.deepEqual(logic.maskCanvasSizeOf(648, 1152, 1024), { width: 576, height: 1024 })
  assert.deepEqual(logic.maskCanvasSizeOf(0, 0), { width: logic.MASK_CANVAS_EDGE, height: logic.MASK_CANVAS_EDGE })
  assert.deepEqual(logic.maskCanvasSizeOf(null, undefined), { width: logic.MASK_CANVAS_EDGE, height: logic.MASK_CANVAS_EDGE })

  // base64 归一：去 data URL 前缀与空白；非 base64 / 其它 data URL 判非法。
  assert.equal(logic.normalizeMaskData(`data:image/png;base64,${MASK_PNG_B64}`), MASK_PNG_B64)
  assert.equal(logic.normalizeMaskData(`  ${MASK_PNG_B64.slice(0, 16)} ${MASK_PNG_B64.slice(16)}  `), MASK_PNG_B64)
  assert.equal(logic.normalizeMaskData(''), '')
  assert.equal(logic.normalizeMaskData('data:image/jpeg;base64,abcd'), '', '蒙版只接受 PNG 容器')
  assert.equal(logic.normalizeMaskData(123), '')
  assert.equal(logic.base64BytesOf(MASK_PNG_B64), 70)
  assert.equal(logic.base64BytesOf(''), 0)

  // 导出判定：合法 PNG + 有效涂抹才算通过，且返回裸 base64。
  const verdict = logic.maskExportVerdict(`data:image/png;base64,${MASK_PNG_B64}`, 0.01)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.data, MASK_PNG_B64, '提交前剥掉 data URL 前缀')
  assert.equal(verdict.coverage, 0.01)
  assert.equal(verdict.bytes, 70)
  assert.deepEqual(logic.maskExportVerdict(MASK_PNG_B64, 0), { ok: false, reason: 'empty' })
  assert.deepEqual(logic.maskExportVerdict(MASK_PNG_B64, logic.MASK_MIN_COVERAGE / 2), { ok: false, reason: 'empty' })
  assert.deepEqual(logic.maskExportVerdict('', 0.5), { ok: false, reason: 'invalid' })
  assert.deepEqual(logic.maskExportVerdict('not base64!', 0.5), { ok: false, reason: 'invalid' })
  // 超过契约字节上限：构造一段足够长的合法 base64。
  const huge = 'A'.repeat(Math.ceil((LIMITS.mask.maxBytes + 1) / 3) * 4)
  assert.ok(logic.base64BytesOf(huge) > LIMITS.mask.maxBytes)
  assert.deepEqual(logic.maskExportVerdict(huge, 0.5), { ok: false, reason: 'too_large' })

  // 指纹：用于表单脏判定，前缀不影响结果；内容不同指纹不同。
  assert.equal(
    logic.maskDigestOf(`data:image/png;base64,${MASK_PNG_B64}`),
    logic.maskDigestOf(MASK_PNG_B64),
    'data URL 前缀不影响蒙版指纹',
  )
  assert.notEqual(logic.maskDigestOf(MASK_PNG_B64), logic.maskDigestOf(huge))
  assert.equal(logic.maskDigestOf(''), '')

  // 表单参考图上的蒙版：兼容对象与裸字符串两种形态，超限不提交。
  const reference = {
    path: 'imagen-output/job-1/7.png',
    mask: { data: `data:image/png;base64,${MASK_PNG_B64}`, coverage: 0.02 },
  }
  assert.equal(logic.referenceMaskDataOf(reference), MASK_PNG_B64)
  assert.equal(logic.referenceMaskForSubmit(reference), MASK_PNG_B64)
  assert.equal(logic.referenceMaskForSubmit({ ...reference, mask: { data: huge } }), '', '超限蒙版退回整图重绘，不提交')
  assert.equal(logic.referenceMaskForSubmit({ path: 'x' }), '')
  assert.equal(logic.referenceMaskForSubmit(null), '')
  assert.equal(logic.referenceMaskDataOf({ mask: MASK_PNG_B64 }), MASK_PNG_B64, '裸字符串形态同样可读')
})

await check('请求体：有蒙版时输出 reference.mask，无蒙版时保持现状', () => {
  const form = {
    prompt: '一只赛博猫',
    negative: '',
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
  }
  const painted = {
    ...form,
    reference: {
      path: 'imagen-output/job-1/7.png',
      url: '/imagen-api/file?path=x',
      mask: { data: `data:image/png;base64,${MASK_PNG_B64}`, coverage: 0.02, digest: logic.maskDigestOf(MASK_PNG_B64) },
    },
    strength: 0.6,
  }
  const body = logic.buildGenerateBody(painted)
  assert.equal(body.reference.mask, MASK_PNG_B64, '请求体里的蒙版是裸 base64（去掉 data URL 前缀）')
  assert.equal(body.reference.path, 'imagen-output/job-1/7.png')
  assert.equal(body.reference.strength, 0.6)
  assert.ok(!JSON.stringify(body).includes('/imagen-api/file'), '缩略图 url 不能进请求体')

  // 未涂抹：reference 里没有 mask 字段，与改造前逐字一致。
  const plain = logic.buildGenerateBody({
    ...painted,
    reference: { path: 'imagen-output/job-1/7.png', url: '/imagen-api/file?path=x' },
  })
  assert.deepEqual(plain.reference, { path: 'imagen-output/job-1/7.png', strength: 0.6 })
  assert.ok(!('mask' in plain.reference))

  // 当前模型不支持局部重绘（maskActive=false）：不提交蒙版，参考图仍按整图重绘提交。
  const gated = logic.buildGenerateBody(painted, { maskActive: false })
  assert.deepEqual(gated.reference, { path: 'imagen-output/job-1/7.png', strength: 0.6 })
  assert.ok(!('mask' in gated.reference))

  // 没有参考图时不会凭空出现 mask（Host 会拒绝「只有蒙版没有参考图」）。
  assert.ok(!('reference' in logic.buildGenerateBody({ ...form, mask: { data: MASK_PNG_B64, coverage: 0.2 } })))

  // 覆盖项里的 reference 同样支持蒙版：对话 / 变体链路沿用同一套归一。
  const overridden = logic.buildGenerateBody(form, {
    overrides: {
      prompt: '聊天输入',
      reference: { path: 'imagen-output/b.png', mask: { data: MASK_PNG_B64, coverage: 0.1 } },
      strength: 0.4,
    },
  })
  assert.equal(overridden.reference.mask, MASK_PNG_B64)
  assert.equal(overridden.reference.strength, 0.4)
})

// 0.13.0：参考图 / 蒙版 / 重绘强度迁到舞台图片工具，主表单快照只比较纯文生图字段。
await check('表单快照：纯文生图字段 + 原生参考图槽指纹（旧 reference / strength 不参与）', () => {
  const base = {
    prompt: 'a',
    negative: '',
    negativeLayers: { model: '', user: '' },
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
    references: [],
  }
  const refPath = 'imagen-output/job-1/7.png'
  const baseline = logic.formSnapshotOf(base)
  assert.equal(logic.isFormDirty(base, baseline), false)
  // 旧表单残留的 reference / strength 字段不写进快照，也不影响脏判定（图片工具域专属字段）。
  assert.equal(
    logic.isFormDirty({ ...base, reference: { path: refPath }, strength: 0.9 }, baseline),
    false,
    '单图 reference / 强度不属于主表单，旧字段不参与脏判定',
  )
  // 阶段十五 Phase C2：挂载 / 移除参考图都算未提交修改（会进草稿卡），只比较有序路径指纹。
  const withRef = { ...base, references: [{ path: refPath, url: '/x', width: 1024, height: 1024, name: '7.png' }] }
  assert.equal(logic.isFormDirty(withRef, baseline), true, '挂载参考图应算脏')
  assert.equal(logic.isFormDirty({ ...base, references: [] }, baseline), false, '空槽不算脏')
  assert.equal(logic.isFormDirty({ ...base, references: [refPath] }, baseline), true, '只有路径的旧槽位也算脏')
  assert.equal(logic.isFormDirty({ ...base, count: 2 }, baseline), true, '改张数仍算脏')
  // 快照里出现的是 references 指纹（而不是旧的 reference 对象字段）。
  assert.ok(logic.formSnapshotOf(withRef).includes('references'), '快照应包含 references 指纹')

  // 新建创作 / 还原原图会清空参考图槽；回填不写参考图字段（槽位由 hook 显式清空）。
  const created = logic.newCreationPatch({ ...base, prompt: '旧提示词', reference: { path: 'x' }, strength: 0.8 }, null)
  assert.deepEqual(created.references, [], '新建创作清空参考图槽')
  assert.equal(Object.prototype.hasOwnProperty.call(created, 'reference'), false, '新建创作不再处理单图参考图')
  assert.equal(Object.prototype.hasOwnProperty.call(created, 'strength'), false, '新建创作不再处理重绘强度')
  const recalled = logic.iteratePatch(
    { image: { path: 'imagen-output/job-2/1.png', width: 512, height: 512 }, item: { prompt: '新图' } },
    base,
    [],
  )
  assert.equal(Object.prototype.hasOwnProperty.call(recalled, 'reference'), false, '回填不再写单图参考图字段')
  assert.equal(Object.prototype.hasOwnProperty.call(recalled, 'references'), false, '回填不写参考图槽（由 hook 清空）')
})

await check('负向分层：model → user 两层合并，用户编辑整段接管', () => {
  // 风格层随静态风格预设一起删除：数据层只剩模型推荐与用户手写两层。
  assert.deepEqual(logic.emptyNegativeLayers(), { model: '', user: '' })
  assert.equal(
    logic.mergeNegativeLayers({ model: 'Blurry, low quality', user: 'blurry, watermark' }),
    'Blurry, low quality, watermark',
    '按 model → user 顺序拼接，不区分大小写去重',
  )
  assert.equal(logic.mergeNegativeLayers(null), '')
  assert.equal(logic.mergeNegativeLayers({ model: ' a ， b ', user: 'b' }), 'a, b', '全角逗号与空格也归一')
  assert.deepEqual(
    logic.normalizeNegativeLayers({ model: '  a ', user: null, style: '遗留风格层' }),
    { model: 'a', user: '' },
    '非法层值与已删除的风格层都按空串处理',
  )
  assert.deepEqual(logic.normalizeNegativeLayers(null), { model: '', user: '' })

  // 旧状态只有 negative、没有层数据：等于当前预设推荐词时归到 model 层，否则按用户手写。
  const presets = [{ id: 'sdxl-base', negativeHint: 'blurry, low quality' }]
  assert.deepEqual(
    logic.resolveNegativeLayers({ presetId: 'sdxl-base', negative: 'blurry, low quality' }, presets),
    { model: 'blurry, low quality', user: '' },
  )
  assert.deepEqual(
    logic.resolveNegativeLayers({ presetId: 'sdxl-base', negative: 'my own' }, presets),
    { model: '', user: 'my own' },
  )

  // 用户编辑展示文本：整段写入 user 层，展示文本与之一致。
  const typed = logic.applyNegativePatch(
    { prompt: 'x', negative: '', negativeLayers: { model: 'blurry', user: '' } },
    { negative: 'my own, text' },
  )
  assert.equal(typed.negative, 'my own, text')
  assert.deepEqual(typed.negativeLayers, { model: '', user: 'my own, text' }, '用户编辑整段写入 user 层')
  // 层数据变更：展示文本同步成去重合并结果。
  const layered = logic.applyNegativePatch({}, { negativeLayers: { model: 'blurry', user: 'blurry, my own' } })
  assert.equal(layered.negative, 'blurry, my own', '展示文本与层数据保持同步')
  // 普通补丁不动负向。
  assert.equal(
    logic.applyNegativePatch({ negative: 'a', negativeLayers: { model: '', user: 'a' } }, { prompt: 'x' }).negative,
    'a',
  )
  // 提交值以层数据合并结果为准；没有层数据时退回旧字段。
  assert.equal(
    logic.negativePromptOf({ negativeLayers: { model: 'blurry, low quality', user: 'my own' } }),
    'blurry, low quality, my own',
  )
  assert.equal(logic.negativePromptOf({ negative: '  legacy  ' }), 'legacy')
  assert.equal(logic.negativePromptOf(null), '')
})

await check('画面比例由契约唯一登记，静态风格数据已删除', () => {
  // 前端只保留「id → 像素」数据，清单与顺序必须来自 shared/contract.js。
  assert.deepEqual(DEFAULT_RATIOS.map((ratio) => ratio.id), RATIO_IDS)
  for (const ratio of DEFAULT_RATIOS) {
    assert.ok(ratio.width > 0 && ratio.height > 0, `${ratio.id} 缺少像素数据`)
    assert.equal(logic.ratioIdOf(ratio.width, ratio.height), ratio.id, `${ratio.id} 的像素应反推回同一比例`)
  }
  // 0.10.0 起没有风格胶囊 / 风格词表 / 风格负向层，契约也不再导出 STYLE_IDS。
  assert.equal('STYLE_CAPSULES' in studioPresets, false, 'presets.js 不应再导出 STYLE_CAPSULES')
  assert.equal('STYLE_IDS' in contract, false, 'contract.js 不应再导出 STYLE_IDS')
})

await check('切换预设按负向能力写入模型负向词层', () => {
  const lightning = { id: 'sdxl-lightning', size: 1024, steps: 4, cfg: 0, negativeHint: 'blurry, low quality, deformed, extra limbs', supportsNegative: true }
  const base = { id: 'sdxl-base', size: 1024, steps: 25, cfg: 7, negativeHint: 'blurry, low quality, deformed, extra limbs', supportsNegative: true }
  const animagine = { id: 'animagine-xl-3.1', size: 1024, steps: 28, cfg: 7, negativeHint: 'nsfw, lowres, watermark', supportsNegative: true }
  const flux = { id: 'flux2-klein-4b', size: 1024, steps: 4, cfg: 1, negativeHint: '', supportsNegative: false }
  const all = [lightning, base, animagine, flux]
  const form = {
    presetId: 'sdxl-base',
    width: 1024,
    height: 1024,
    steps: 25,
    cfg: 7,
    negative: 'blurry, low quality, deformed, extra limbs, my own',
    negativeLayers: { model: 'blurry, low quality, deformed, extra limbs', user: 'my own' },
  }

  // 切到 cfg=0 的极速模型：模型层清空（不挂一串永远不会发出去的词），用户层保留。
  const off = logic.presetSelectPatch(lightning, form, all)
  assert.equal(off.presetId, 'sdxl-lightning')
  assert.equal(off.negativeLayers.model, '', 'CFG=0 的预设不写模型负向词')
  assert.equal(off.negativeLayers.user, 'my own', '用户层原样保留')
  assert.equal(off.negative, 'my own', '展示文本不得残留上一个预设的负向词')
  assert.equal(off.cfg, 0, '套用新预设推荐 CFG')

  // 切到真实消费负向词的预设（cfg=7）：模型层整层替换，用户层保留；已有尺寸与比例原样保留。
  const on = logic.presetSelectPatch(animagine, form, all)
  assert.equal(on.negativeLayers.model, 'nsfw, lowres, watermark')
  assert.equal(on.negativeLayers.user, 'my own')
  assert.equal(on.negative, 'nsfw, lowres, watermark, my own')
  assert.equal(on.steps, 28, '套用新预设推荐步数')
  assert.equal(on.cfg, 7, '套用新预设推荐引导强度')
  assert.equal(on.width, undefined, '已有合法宽高时切模型不覆盖尺寸')
  assert.equal(on.height, undefined)

  // 已选 16:9 或自定义尺寸后切到任意模型（含默认 512 的 turbo），保留当前宽高与画幅比例。
  const keepRatio = logic.presetSelectPatch(
    { id: 'sdxl-turbo', size: 512, steps: 4, cfg: 0, negativeHint: '' },
    { ...form, width: 1152, height: 648 },
    all,
  )
  assert.equal(keepRatio.width, undefined, '切模型应保留用户已选 16:9 宽度')
  assert.equal(keepRatio.height, undefined, '切模型应保留用户已选 16:9 高度')

  // 从极小尺寸（如 Turbo 512×512）切到最低安全尺寸更大的模型时，按原画幅等比放大；不破坏合规大尺寸。
  const rescued = logic.presetSelectPatch(
    { id: 'realvis-v5', size: 1024, sizeOptions: [768, 1024], steps: 30, cfg: 5, negativeHint: '' },
    { ...form, presetId: 'sdxl-turbo', width: 512, height: 288 },
    all,
  )
  assert.equal(rescued.width, 1024, '从 512 切到 minSize>=768 模型应等比升至目标默认边长')
  assert.equal(rescued.height, 576, '放大时应保持原 16:9 画幅比例')

  // 无负向能力的模型永不写模型层。
  const fluxPatch = logic.presetSelectPatch(flux, form, all)
  assert.equal(fluxPatch.negativeLayers.model, '')
  assert.equal(fluxPatch.negativeLayers.user, 'my own')

  // 旧状态只有 negative、没有层数据：等于上一个预设推荐值时按模型层识别。
  const legacy = logic.presetSelectPatch(base, {
    ...form,
    negativeLayers: undefined,
    negative: 'blurry, low quality, deformed, extra limbs',
  }, all)
  assert.equal(legacy.negativeLayers.model, 'blurry, low quality, deformed, extra limbs')
  assert.equal(legacy.negativeLayers.user, '', '旧状态里的模型推荐值不应被误当用户词')
  const legacyUser = logic.presetSelectPatch(flux, { ...form, negativeLayers: undefined, negative: 'my own' }, all)
  assert.equal(legacyUser.negativeLayers.model, '')
  assert.equal(legacyUser.negativeLayers.user, 'my own')

  // 首次初始化（presetId 为空）时写入预设默认尺寸，越界推荐值按契约钳制；非法入参不产生补丁。
  const oversized = logic.presetSelectPatch(
    { id: 'x', size: 4096, steps: 999, cfg: 99, negativeHint: '' },
    { ...form, presetId: '' },
    all,
  )
  assert.equal(oversized.width, LIMITS.width.max)
  assert.equal(oversized.height, LIMITS.height.max)
  assert.equal(oversized.steps, LIMITS.steps.max)
  assert.equal(oversized.cfg, LIMITS.cfg.max)
  assert.deepEqual(logic.presetSelectPatch(null, form, all), {})
})

await check('参考图预设回退：支持能力来自预设公开视图，缺字段按 false', () => {
  const lightning = { id: 'sdxl-lightning', supportsImg2Img: true }
  const turbo = { id: 'sdxl-turbo', supportsImg2Img: true }
  const animagine = { id: 'animagine-xl-3.1', supportsImg2Img: true }
  const flux = { id: 'flux2-klein-4b', supportsImg2Img: false }

  assert.equal(logic.supportsImg2Img(lightning), true)
  assert.equal(logic.supportsImg2Img(flux), false)
  assert.equal(logic.supportsImg2Img({ id: 'legacy' }), false, '旧宿主缺 supportsImg2Img 按不支持处理')
  assert.equal(logic.supportsImg2Img(null), false)
  assert.equal(logic.supportsImg2Img(undefined), false)
  assert.equal(logic.supportsImg2Img({ id: 'truthy', supportsImg2Img: 1 }), false, '只认严格的 true')

  // 优先 sdxl-lightning（默认预设），其次列表里的第一个支持者。
  assert.equal(logic.referencePresetOf([flux, turbo, lightning]), lightning)
  assert.equal(logic.referencePresetOf([flux, animagine, turbo]), animagine)
  assert.equal(logic.referencePresetOf([flux, { id: 'animagine-xl-3.1' }]), null, '一个都不支持时返回 null')
  assert.deepEqual(logic.referencePresetOf(null), null)
  assert.deepEqual(logic.referencePresetOf([]), null)

  // 局部重绘能力是独立字段：缺省 / 旧宿主 / 非严格 true 都按不支持处理。
  assert.equal(logic.supportsInpaint({ id: 'sdxl-lightning', supportsInpaint: true }), true)
  assert.equal(logic.supportsInpaint({ id: 'flux2-klein-4b', supportsInpaint: false }), false)
  assert.equal(logic.supportsInpaint({ id: 'legacy' }), false, '旧宿主缺 supportsInpaint 按不支持处理')
  assert.equal(logic.supportsInpaint(null), false)
  assert.equal(logic.supportsInpaint(undefined), false)
  assert.equal(logic.supportsInpaint({ id: 'truthy', supportsInpaint: 1 }), false, '只认严格的 true')

  // 专用局部重绘模型（inpaintOnly）：缺省 false，只认严格 true；不能当参考图兜底预设。
  const native = { id: 'sdxl-inpaint', supportsImg2Img: true, supportsInpaint: true, inpaintOnly: true }
  assert.equal(logic.inpaintOnlyOf(native), true)
  assert.equal(logic.inpaintOnlyOf(lightning), false, '普通预设缺省按 false 处理')
  assert.equal(logic.inpaintOnlyOf({ id: 'truthy', inpaintOnly: 1 }), false, '只认严格的 true')
  assert.equal(logic.inpaintOnlyOf(null), false)
  // 兜底预设跳过 inpaintOnly：它必须带蒙版，不适合当整图重绘的落点。
  assert.equal(
    logic.referencePresetOf([flux, native, turbo]),
    turbo,
    '参考图兜底要跳过 inpaintOnly 预设',
  )
  assert.deepEqual(logic.referencePresetOf([flux, native]), null, '只剩 inpaintOnly 时返回 null')
})

await check('公开预设的局部重绘能力与模型家族一致', () => {
  const inpaintable = PUBLIC_PRESETS.filter((item) => logic.supportsInpaint(item))
  assert.ok(inpaintable.length > 0, '至少要有 SDXL 家族支持局部重绘')
  // 首期只对 SDXL 家族开放：支持 Inpaint 的必须同时支持图生图，不支持图生图的模型不得支持 Inpaint。
  assert.ok(inpaintable.every((item) => logic.supportsImg2Img(item)), '支持 Inpaint 的模型必须同时支持图生图')
  assert.ok(
    PUBLIC_PRESETS.filter((item) => !logic.supportsImg2Img(item)).every((item) => !logic.supportsInpaint(item)),
    '不支持图生图的模型不得声明 supportsInpaint',
  )
  assert.deepEqual(
    inpaintable.map((item) => item.id).sort(),
    PUBLIC_PRESETS.filter((item) => item.family === 'SDXL').map((item) => item.id).sort(),
    '公开预设里只有 SDXL 家族支持局部重绘',
  )
})

await check('负向层数据与展示文本同步（用户编辑 / 历史回填）', () => {
  const form = {
    prompt: '雨夜街景',
    negative: '',
    negativeLayers: { model: '', user: '' },
  }
  // 用户编辑输入框：整段写入 user 层，展示文本与之一致。
  const typed = logic.applyNegativePatch(form, { negative: 'my own, blurry' })
  assert.equal(typed.negative, 'my own, blurry')
  assert.deepEqual(typed.negativeLayers, { model: '', user: 'my own, blurry' }, '用户编辑整段写入 user 层')
  assert.equal(typed.prompt, '雨夜街景', '不相关字段保持')
  // 层数据变更：展示文本同步成去重合并结果。
  const layered = logic.applyNegativePatch(form, {
    negativeLayers: { model: 'blurry', user: 'blurry, my own' },
  })
  assert.equal(layered.negativeLayers.model, 'blurry')
  assert.equal(layered.negative, 'blurry, my own', '展示文本与层数据保持同步')
  // 普通补丁不动负向。
  assert.equal(logic.applyNegativePatch(form, { prompt: 'x' }).negative, '')
  // 提交值以层数据合并结果为准。
  assert.equal(
    logic.negativePromptOf({ negativeLayers: { model: 'blurry, low quality', user: 'my own' } }),
    'blurry, low quality, my own',
  )
  assert.equal(logic.negativePromptOf({ negative: '  legacy  ' }), 'legacy', '没有层数据时退回旧字段')
  assert.equal(logic.negativePromptOf(null), '')
})

await check('一键英译：只有模型真的翻译了才算成功', () => {
  // 模型可用：返回 trim 后的英文提示词。
  assert.deepEqual(
    logic.translateOutcomeOf({ ok: true, mode: 'translate', source: 'model', prompt: '  rainy night street  ' }),
    { ok: true, prompt: 'rainy night street' },
  )
  // source='local' 表示模型不可用、prompt 还是原文：必须判为未翻译，不能写回表单。
  assert.equal(logic.translateOutcomeOf({ ok: true, mode: 'translate', source: 'local', prompt: '雨夜街景' }).ok, false)
  assert.equal(logic.translateOutcomeOf({ source: 'model', prompt: '   ' }).ok, false, '空译文本不算成功')
  // 旧宿主忽略 mode 时返回 refine 结构（没有 prompt），同样不能假装成功。
  assert.equal(logic.translateOutcomeOf({ ok: true, source: 'model', groups: [] }).ok, false)
  assert.equal(logic.translateOutcomeOf(null).ok, false)
  assert.equal(logic.translateOutcomeOf(undefined).ok, false)
})

await check('自定义宽高补丁按契约边界与步长钳制', () => {
  // 自定义宽高：只改传入的一边，按契约边界与 8 的步长钳制。
  assert.deepEqual(logic.customSizePatch({ width: 99999 }), { width: LIMITS.width.max })
  assert.deepEqual(logic.customSizePatch({ height: 1 }), { height: LIMITS.height.min })
  assert.deepEqual(logic.customSizePatch({ width: '1000', height: 253 }), { width: 1000, height: 256 }, '按 8 的倍数对齐')
  assert.deepEqual(logic.customSizePatch({ width: 'x' }), { width: 1024 }, '非法值回落默认尺寸')
  assert.deepEqual(logic.customSizePatch({ width: '' }), { width: 1024 }, '空串按缺失值回退默认尺寸')
  assert.deepEqual(logic.customSizePatch({}), {})
})

await check('比例高亮按长宽比匹配，而不是像素精确相等', () => {
  // 方形档 768 / 1152 也都是 1:1；任意 4:3 像素都算 4:3。否则点方形档后上方比例高亮会消失。
  assert.equal(logic.ratioIdOf(1024, 1024), '1:1')
  assert.equal(logic.ratioIdOf(768, 768), '1:1', '方形档 768 应属于 1:1')
  assert.equal(logic.ratioIdOf('1152', '1152'), '1:1', '字符串输入同样按数字比较')
  assert.equal(logic.ratioIdOf(1152, 648), '16:9')
  assert.equal(logic.ratioIdOf(648, 1152), '9:16')
  assert.equal(logic.ratioIdOf(800, 600), '4:3', '非预设像素但长宽比匹配')
  assert.equal(logic.ratioIdOf(768, 1024), '3:4')
  assert.equal(logic.ratioIdOf(1000, 800), '', '5:4 不在契约比例里')
  assert.equal(logic.ratioIdOf(1023, 1023), '1:1', '非 8 倍数的像素同样按约分后的长宽比匹配')
  assert.equal(logic.ratioIdOf('', ''), '', '缺失值不匹配任何比例')
  assert.equal(logic.ratioIdOf(null, 1024), '')
  assert.equal(logic.ratioIdOf(1024, 0), '')
})

await check('中文提示词检测与英文软提示判定', () => {
  assert.equal(logic.detectCjk('雨夜街景'), true)
  assert.equal(logic.detectCjk('rainy street, 霓虹招牌'), true)
  assert.equal(logic.detectCjk('rainy street at night'), false)
  assert.equal(logic.detectCjk(''), false)
  assert.equal(logic.detectCjk(null), false)
  // 现役预设都按英文提示词训练；chinese 是将来原生中文模型的显式豁免值。
  for (const style of ['concise', 'natural', 'danbooru']) {
    assert.equal(logic.presetNeedsEnglish({ promptStyle: style }), true)
  }
  assert.equal(logic.presetNeedsEnglish({ promptStyle: 'chinese' }), false)
  assert.equal(logic.presetNeedsEnglish(null), true)
})

await check('带回参数的回填参数', () => {
  const presets = [
    { id: 'sdxl-lightning', size: 1024, steps: 4, cfg: 0 },
    { id: 'sdxl-base', size: 1024, steps: 25, cfg: 7.5 },
  ]
  const form = {
    prompt: '正在写的草稿',
    negative: '',
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
  }
  // 真实 Host 形状：只有 prompt / presetId / images，没有 params。
  const real = {
    image: { path: 'imagen-output/a/01.png', seed: 17, width: 1152, height: 648 },
    item: { jobId: 'job-1', prompt: '作品自己的提示词', presetId: 'sdxl-base', images: [] },
  }
  const patch = logic.iteratePatch(real, form, presets)
  assert.equal(patch.prompt, '作品自己的提示词', '提示词来自作品，而不是最近任务')
  assert.equal(patch.width, 1152)
  assert.equal(patch.height, 648)
  assert.equal(patch.steps, 25, '没有 params 时回落到预设推荐值')
  assert.equal(patch.cfg, 7.5)
  assert.equal(patch.seed, '17')
  assert.equal(patch.presetId, 'sdxl-base')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'styleId'), false, '0.10.0 起回填不再写 styleId')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'negative'), false, '没有作品负向提示词时不覆盖草稿')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'reference'), false, '参考图不再属于主表单，回填不写该字段')

  const withParams = {
    image: real.image,
    item: { ...real.item, params: { negativePrompt: 'blurry', steps: 30, cfg: 5 } },
  }
  const patch2 = logic.iteratePatch(withParams, form, presets)
  assert.equal(patch2.prompt, '作品自己的提示词')
  assert.equal(patch2.steps, 30)
  assert.equal(patch2.cfg, 5)
  assert.equal(patch2.negative, 'blurry')
  assert.equal(patch2.width, 1152, '尺寸始终以产物像素为准')
  assert.equal(Object.prototype.hasOwnProperty.call(patch2, 'reference'), false)

  assert.deepEqual(logic.iteratePatch(null, form, presets), {})
  // 完全没有可回填字段的条目返回空补丁。
  assert.deepEqual(logic.iteratePatch({ image: {}, item: {} }, form, presets), {})
  // 作品没有记录有效 seed：种子恢复为随机（空串），不能沿用上一张作品的固定种子。
  const noSeed = logic.iteratePatch(
    { image: { path: 'imagen-output/b/01.png', width: 1024, height: 1024 }, item: { prompt: '无种子作品' } },
    { seed: '42' },
    presets,
  )
  assert.equal(noSeed.prompt, '无种子作品')
  assert.equal(noSeed.seed, '', '没有有效 seed 时应恢复随机')
})

await check('表单提交摘要、脏判定与新建创作补丁', () => {
  // 表单提交请求体 → 参数摘要：模型 / 比例像素 / 张数 / 种子策略（主表单固定纯文生图）。
  const summary = logic.formSummaryOf({
    prompt: '雨夜街景',
    presetId: 'sdxl-lightning',
    width: 1280,
    height: 720,
    count: 2,
    seed: 42,
  })
  assert.equal(summary.presetId, 'sdxl-lightning')
  assert.equal(summary.ratioId, '16:9', '比例由像素反推')
  assert.equal(summary.width, 1280)
  assert.equal(summary.height, 720)
  assert.equal(summary.count, 2)
  assert.equal(summary.seed, 42, '固定种子按数字展示')
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'hasReference'), false, '摘要不再输出参考图标记')

  const random = logic.formSummaryOf({ prompt: 'x', width: 1024, height: 1024, count: 9, seed: -1 })
  assert.equal(random.ratioId, '1:1')
  assert.equal(random.seed, null, '随机种子（-1 / 缺失）归一为 null')
  assert.equal(random.count, 4, '张数按契约钳制')
  const empty = logic.formSummaryOf(null)
  assert.deepEqual(empty, {
    presetId: '',
    ratioId: '',
    width: null,
    height: null,
    count: 1,
    seed: null,
  })

  // 脏判定：与干净基准逐字段比较；基准未建立时按干净处理。
  const cleanForm = {
    prompt: 'a',
    negative: '',
    negativeLayers: { model: '', user: '' },
    presetId: 'p',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
  }
  const baseline = logic.formSnapshotOf(cleanForm)
  assert.equal(logic.isFormDirty(cleanForm, baseline), false)
  assert.equal(logic.isFormDirty({ ...cleanForm }, baseline), false, '值相同的不同对象是干净的')
  assert.equal(logic.isFormDirty({ ...cleanForm, prompt: 'b' }, baseline), true, '改提示词算脏')
  assert.equal(logic.isFormDirty({ ...cleanForm, seed: '42' }, baseline), true, '改种子算脏')
  assert.equal(logic.isFormDirty({ ...cleanForm, width: 1280 }, baseline), true, '改画幅算脏')
  // 旧表单残留的参考图 / 强度字段不属于主表单，不参与脏判定。
  assert.equal(logic.isFormDirty({ ...cleanForm, reference: { path: 'x' }, strength: 0.8 }, baseline), false)
  assert.equal(logic.isFormDirty(cleanForm, ''), false, '基准未建立时按干净处理')
  // 改回原样后重新变干净：这一层保护不应变成「点过输入框就永久脏」。
  const reverted = { ...cleanForm, prompt: 'b' }
  const revertedBaseline = logic.formSnapshotOf(reverted)
  assert.equal(logic.isFormDirty({ ...reverted, prompt: 'a' }, revertedBaseline), true)
  assert.equal(logic.isFormDirty({ ...reverted }, revertedBaseline), false)

  // 新建创作：清提示词 / 固定种子 + 负向层回到当前预设默认；保留预设与画幅。
  const activePreset = { id: 'realvis-v5', cfg: 5, supportsNegative: true, negativeHint: 'blurry, low quality' }
  const patch = logic.newCreationPatch({
    ...cleanForm,
    prompt: '旧提示词',
    negative: '旧排除项',
    negativeLayers: { model: 'blurry', user: '旧排除项' },
    presetId: 'realvis-v5',
    width: 1152,
    height: 864,
    cfg: 5,
    seed: '42',
    reference: { path: 'imagen-output/a/01.png', strength: 0.7 },
    strength: 0.7,
  }, activePreset)
  assert.equal(patch.prompt, '')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'reference'), false, '新建创作不再处理参考图')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'strength'), false, '新建创作不再处理重绘强度')
  assert.equal(patch.seed, '', '新建创作把种子恢复为随机')
  assert.equal(patch.negative, 'blurry, low quality', '排除项回到当前预设默认推荐状态')
  assert.deepEqual(patch.negativeLayers, { model: 'blurry, low quality', user: '' })
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'presetId'), false, '保留当前模型预设')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'width'), false, '保留当前画幅比例')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'height'), false)
  // CFG=0 / 无负向能力的配置不应挂一串永远提交不出去的排除项。
  const noNegative = logic.newCreationPatch({ cfg: 0 }, { ...activePreset, cfg: 0 })
  assert.equal(noNegative.negative, '')
  assert.deepEqual(noNegative.negativeLayers, { model: '', user: '' })
})

await check('生成变体参数', () => {
  const presets = [
    { id: 'sdxl-lightning', size: 1024, steps: 4, cfg: 0 },
    { id: 'sdxl-base', size: 1024, steps: 25, cfg: 7.5 },
  ]
  const entry = {
    image: { path: 'p', seed: 902, width: 1152, height: 648 },
    item: { jobId: 'job-9', prompt: '黄昏的街道', presetId: 'sdxl-base', images: [] },
  }
  const overrides = logic.rerollOverrides(entry, presets)
  assert.equal(overrides.prompt, '黄昏的街道', '生成变体使用当前图的提示词')
  assert.equal(overrides.seed, -1, '种子换成随机')
  assert.equal(overrides.count, 1, '再画一张')
  assert.equal(overrides.width, 1152)
  assert.equal(overrides.height, 648)
  assert.equal(overrides.steps, 25)
  assert.equal(overrides.cfg, 7.5)
  assert.equal(overrides.presetId, 'sdxl-base')
  assert.equal(logic.rerollOverrides({ image: { seed: 1 }, item: { prompt: '   ' } }, presets), null)
  assert.equal(logic.rerollOverrides(null, presets), null)

  const withParams = { ...entry, item: { ...entry.item, params: { negativePrompt: 'blur', steps: 30, cfg: 5 } } }
  const more = logic.rerollOverrides(withParams, presets)
  assert.equal(more.steps, 30)
  assert.equal(more.cfg, 5)
  assert.equal(more.negativePrompt, 'blur')
})

// ── 阶段十五 Phase B 补修：高清放大产物的回填 / 重新生成不污染扩散参数 ──────
const NON_DIFFUSION_PRESETS = [
  { id: 'sdxl-lightning', size: 1024, steps: 4, cfg: 0 },
  { id: 'sdxl-base', size: 1024, steps: 25, cfg: 7.5 },
  { id: 'sdxl-inpaint', size: 1024, steps: 30, cfg: 8, inpaintOnly: true },
]

/** 放大产物 + 已加载父作品：父作品带真实扩散参数（1024²、25 步、cfg 7.5）。 */
function upscaleRecallFixtures() {
  const parentPath = 'imagen-output/job-1/01.png'
  const parentImage = { path: parentPath, file: '01.png', width: 1024, height: 1024, seed: 17 }
  const parentItem = {
    jobId: 'job-1',
    prompt: '父作品提示词',
    presetId: 'sdxl-base',
    params: { prompt: '父作品提示词', negativePrompt: 'blurry', steps: 25, cfg: 7.5, seed: 17 },
    images: [parentImage],
  }
  const upscalePath = 'imagen-output/job-2/01.png'
  const upscaleImage = { path: upscalePath, file: '01.png', width: 2048, height: 2048, seed: 0 }
  const upscaleItem = {
    jobId: 'job-2',
    prompt: '父作品提示词',
    presetId: 'realesrgan-x2plus',
    upscale: true,
    sourceImage: parentPath,
    upscaleSource: { width: 1024, height: 1024 },
    params: { prompt: '父作品提示词', negativePrompt: 'blurry', width: 2048, height: 2048, steps: 0, cfg: 0, seed: 0 },
    images: [upscaleImage],
  }
  return {
    parentPath,
    parentImage,
    parentItem,
    upscalePath,
    upscaleImage,
    upscaleItem,
    parentEntry: { image: parentImage, item: parentItem },
    upscaleEntry: { image: upscaleImage, item: upscaleItem },
  }
}

await check('放大产物回填：沿 sourceImage 找回父作品的真实扩散参数（不出现超分 id / 0 步 / 2048）', () => {
  const fixtures = upscaleRecallFixtures()
  const items = [fixtures.upscaleItem, fixtures.parentItem]
  const form = { presetId: 'sdxl-lightning', steps: 4, cfg: 0, seed: '' }

  // ① iteratePatch：等于父作品的回填结果，而不是放大记录的占位参数。
  const patch = logic.iteratePatch(fixtures.upscaleEntry, form, NON_DIFFUSION_PRESETS, items)
  assert.deepEqual(patch, logic.iteratePatch(fixtures.parentEntry, form, NON_DIFFUSION_PRESETS, items))
  assert.equal(patch.presetId, 'sdxl-base')
  assert.equal(patch.steps, 25, 'steps 来自父作品，不能是放大记录的 0')
  assert.equal(patch.cfg, 7.5)
  assert.equal(patch.width, 1024, '尺寸来自父作品，不能是放大后的 2048')
  assert.equal(patch.height, 1024)
  assert.equal(patch.prompt, '父作品提示词')
  assert.equal(patch.negative, 'blurry')
  assert.equal(patch.seed, '17')
  assert.equal(JSON.stringify(patch).includes('realesrgan'), false, '补丁不得出现超分模型 id')

  // ② rerollOverrides：预设 / 步数 / 尺寸来自父作品，种子换随机。
  const overrides = logic.rerollOverrides(fixtures.upscaleEntry, NON_DIFFUSION_PRESETS, items)
  assert.deepEqual(overrides, logic.rerollOverrides(fixtures.parentEntry, NON_DIFFUSION_PRESETS, items))
  assert.equal(overrides.presetId, 'sdxl-base')
  assert.equal(overrides.steps, 25)
  assert.equal(overrides.cfg, 7.5)
  assert.equal(overrides.width, 1024)
  assert.equal(overrides.height, 1024)
  assert.equal(overrides.seed, -1)
  assert.equal(overrides.count, 1)
  assert.equal(overrides.negativePrompt, 'blurry')
  assert.equal(JSON.stringify(overrides).includes('realesrgan'), false)

  // 旧 3 参 / 2 参调用（不传 items）：放大记录父作品不可见，走降级补丁而不是抛错。
  const legacyPatch = logic.iteratePatch(fixtures.upscaleEntry, form, NON_DIFFUSION_PRESETS)
  assert.equal(legacyPatch.steps, 4, '降级时用当前表单预设的推荐步数')
  assert.equal(legacyPatch.width, 1024, '降级尺寸来自 upscaleSource')
  assert.equal(JSON.stringify(legacyPatch).includes('realesrgan'), false)
  const legacyOverrides = logic.rerollOverrides(fixtures.upscaleEntry, NON_DIFFUSION_PRESETS)
  assert.equal(legacyOverrides.seed, -1)
  assert.equal(legacyOverrides.steps, 4)
})

await check('放大产物回填：父作品缺失 / 链式放大 / 普通作品回归', () => {
  const fixtures = upscaleRecallFixtures()
  const form = { presetId: 'sdxl-lightning', steps: 4, cfg: 0, seed: '' }

  // ③ 父作品缺失：降级补丁保留提示词，尺寸优先 upscaleSource（不超契约上限），steps > 0。
  const degraded = logic.iteratePatch(fixtures.upscaleEntry, form, NON_DIFFUSION_PRESETS, [fixtures.upscaleItem])
  assert.equal(degraded.prompt, '父作品提示词')
  assert.equal(degraded.negative, 'blurry')
  assert.equal(degraded.width, 1024)
  assert.equal(degraded.height, 1024)
  assert.equal(degraded.presetId, 'sdxl-lightning')
  assert.equal(degraded.steps, 4)
  assert.ok(degraded.steps > 0, '降级补丁不得写 0 步')
  assert.equal(degraded.seed, '', '降级后种子恢复随机')
  assert.equal(Object.prototype.hasOwnProperty.call(degraded, 'cfg'), false, '推荐 cfg=0 时不写 cfg 0')
  assert.equal(JSON.stringify(degraded).includes('realesrgan'), false)
  // 没有 upscaleSource 时把放大记录尺寸钳到契约上限（2048 → 1536）。
  const noSourceItem = { ...fixtures.upscaleItem, upscaleSource: undefined }
  const clamped = logic.iteratePatch(
    { image: fixtures.upscaleImage, item: noSourceItem },
    form,
    NON_DIFFUSION_PRESETS,
    [noSourceItem],
  )
  assert.equal(clamped.width, LIMITS.width.max, '放大后的 2048 必须钳到契约上限')
  assert.equal(clamped.height, LIMITS.height.max)
  // 当前预设是专用 inpaint 权重（不能文生图）：降级时换成第一个可文生图预设。
  const fromInpaintForm = logic.iteratePatch(
    fixtures.upscaleEntry,
    { presetId: 'sdxl-inpaint' },
    NON_DIFFUSION_PRESETS,
    [fixtures.upscaleItem],
  )
  assert.equal(fromInpaintForm.presetId, 'sdxl-lightning')
  // 降级 reroll：提示词为空时仍返回 null（保持既有提示）。
  const noPrompt = { ...fixtures.upscaleItem, prompt: '' }
  assert.equal(logic.rerollOverrides({ image: fixtures.upscaleImage, item: noPrompt }, NON_DIFFUSION_PRESETS, [noPrompt]), null)
  const degradedReroll = logic.rerollOverrides(fixtures.upscaleEntry, NON_DIFFUSION_PRESETS, [fixtures.upscaleItem], { id: 'sdxl-base' })
  assert.equal(degradedReroll.presetId, 'sdxl-base')
  assert.equal(degradedReroll.steps, 25)
  assert.equal(degradedReroll.cfg, 7.5)
  assert.equal(degradedReroll.seed, -1)
  assert.equal(degradedReroll.width, 1024)

  // ④ 链式：放大 → 放大 → 普通作品，一路解析到普通作品。
  const normalImage = { path: 'imagen-output/job-0/01.png', width: 1024, height: 1024, seed: 5 }
  const normalItem = {
    jobId: 'job-0',
    prompt: '更早的父作品',
    presetId: 'sdxl-base',
    params: { prompt: '更早的父作品', steps: 25, cfg: 7.5, seed: 5 },
    images: [normalImage],
  }
  const upAImage = { path: 'imagen-output/job-2/01.png', width: 2048, height: 2048, seed: 0 }
  const upAItem = {
    ...fixtures.upscaleItem,
    jobId: 'job-2b',
    sourceImage: normalImage.path,
    upscaleSource: { width: 1024, height: 1024 },
    images: [upAImage],
  }
  const upBImage = { path: 'imagen-output/job-3/01.png', width: 4096, height: 4096, seed: 0 }
  const upBItem = {
    ...fixtures.upscaleItem,
    jobId: 'job-3',
    sourceImage: upAImage.path,
    upscaleSource: { width: 2048, height: 2048 },
    images: [upBImage],
  }
  const chainItems = [upBItem, upAItem, normalItem]
  const chained = logic.iteratePatch({ image: upBImage, item: upBItem }, form, NON_DIFFUSION_PRESETS, chainItems)
  assert.equal(chained.prompt, '更早的父作品')
  assert.equal(chained.presetId, 'sdxl-base')
  assert.equal(chained.steps, 25)
  assert.equal(chained.width, 1024)
  assert.equal(logic.diffusionSourceOf({ image: upBImage, item: upBItem }, chainItems).item.jobId, 'job-0')
  // 成环数据：不递归爆栈，降级返回合法补丁。
  const loopA = { ...fixtures.upscaleItem, sourceImage: 'imagen-output/loop-b/01.png', images: [{ path: 'imagen-output/loop-a/01.png', width: 2048, height: 2048 }] }
  const loopB = { ...fixtures.upscaleItem, sourceImage: 'imagen-output/loop-a/01.png', images: [{ path: 'imagen-output/loop-b/01.png', width: 2048, height: 2048 }] }
  const loopPatch = logic.iteratePatch({ image: loopA.images[0], item: loopA }, form, NON_DIFFUSION_PRESETS, [loopA, loopB])
  assert.equal(loopPatch.steps, 4)
  assert.equal(loopPatch.width, 1024)

  // ⑤ 普通作品 / 裸导入 / 未知预设的既有行为。
  const ordinary = logic.iteratePatch(fixtures.parentEntry, form, NON_DIFFUSION_PRESETS)
  assert.equal(ordinary.presetId, 'sdxl-base')
  assert.equal(ordinary.steps, 25, '普通作品直接回填自身参数')
  assert.equal(ordinary.width, 1024)
  const bareImport = { image: { path: 'imagen-output/import/01.png', width: 800, height: 600 }, item: { source: 'import', params: {} } }
  assert.deepEqual(logic.iteratePatch(bareImport, form, NON_DIFFUSION_PRESETS), {})
  assert.equal(logic.rerollOverrides(bareImport, NON_DIFFUSION_PRESETS), null)
  // presetId 不在扩散预设列表：同样不能直接回填（走降级，不写未知模型 id）。
  const unknownPreset = {
    image: { path: 'imagen-output/old/01.png', width: 1024, height: 1024 },
    item: { prompt: '旧模型作品', presetId: 'retired-model', params: { steps: 0, cfg: 0 } },
  }
  const unknownPatch = logic.iteratePatch(unknownPreset, form, NON_DIFFUSION_PRESETS)
  assert.equal(unknownPatch.prompt, '旧模型作品')
  assert.equal(unknownPatch.presetId, 'sdxl-lightning')
  assert.equal(JSON.stringify(unknownPatch).includes('retired-model'), false)
  // 判定函数本身。
  assert.equal(logic.isNonDiffusionRecallOf(fixtures.upscaleEntry, NON_DIFFUSION_PRESETS), true)
  assert.equal(logic.isNonDiffusionRecallOf({ image: {}, item: { presetId: 'realesrgan-x2plus' } }, []), true, '超分 id 本身即可判定')
  assert.equal(logic.isNonDiffusionRecallOf(unknownPreset, NON_DIFFUSION_PRESETS), true)
  assert.equal(logic.isNonDiffusionRecallOf(unknownPreset, []), false, '预设还没拿到时不按未知预设误判')
  assert.equal(logic.isNonDiffusionRecallOf(fixtures.parentEntry, NON_DIFFUSION_PRESETS), false)
  // diffusionSourceOf：普通作品返回自身；父作品缺失 / 裸导入父作品返回 null。
  assert.equal(logic.diffusionSourceOf(fixtures.parentEntry, []), fixtures.parentEntry)
  assert.equal(logic.diffusionSourceOf(fixtures.upscaleEntry, []), null)
  const bareParent = { image: { path: 'imagen-output/import/01.png' }, item: { source: 'import', params: {} } }
  assert.equal(logic.diffusionSourceOf(fixtures.upscaleEntry, [bareParent]), null)
})

// ── 阶段十五 Phase C0：局部重绘 / 扩图产物的 inpaintOnly 预设过滤 ─────────────
// 专用局部重绘权重（sdxl-inpaint）只在舞台图片工具里可选，不能写进左栏纯文生图表单
// （否则模型选择器出现空白未选中态）。回填先沿 sourceImage 回溯父作品的扩散参数，
// 找不到时走降级补丁：保留提示词 / 排除项 / 尺寸，预设与步数 / CFG 换成可文生图的推荐值。
await check('局部重绘 / 扩图产物回填：inpaintOnly 预设不写进纯文生图表单', () => {
  const parentPath = 'imagen-output/job-1/01.png'
  const parentImage = { path: parentPath, width: 1024, height: 1024, seed: 17 }
  const parentItem = {
    jobId: 'job-1',
    prompt: '父作品提示词',
    presetId: 'sdxl-base',
    params: { prompt: '父作品提示词', negativePrompt: 'blurry', steps: 25, cfg: 7.5, seed: 17 },
    images: [parentImage],
  }
  const inpaintImage = { path: 'imagen-output/job-2/01.png', width: 1024, height: 1024, seed: 0 }
  const inpaintItem = {
    jobId: 'job-2',
    prompt: '重绘后的提示词',
    presetId: 'sdxl-inpaint',
    inpaint: true,
    sourceImage: parentPath,
    params: { prompt: '重绘后的提示词', negativePrompt: 'blurry', width: 1024, height: 1024, steps: 30, cfg: 8, seed: 0 },
    images: [inpaintImage],
  }
  const inpaintEntry = { image: inpaintImage, item: inpaintItem }
  const form = { presetId: 'sdxl-base', steps: 25, cfg: 7.5, seed: '' }

  // 判定：inpaintOnly 预设产物属于「不能直接回填」的记录；预设还没下发时不误判。
  assert.equal(logic.isNonDiffusionRecallOf(inpaintEntry, NON_DIFFUSION_PRESETS), true, 'inpaintOnly 预设产物不能直接回填')
  assert.equal(logic.isNonDiffusionRecallOf({ image: {}, item: { presetId: 'sdxl-inpaint' } }, []), false, '预设未加载时不按未知预设误判')
  assert.equal(logic.isNonDiffusionRecallOf({ image: {}, item: { presetId: 'sdxl-base' } }, NON_DIFFUSION_PRESETS), false, '普通扩散预设不受影响')

  // ① 有父作品：回填结果等于父作品，不出现 sdxl-inpaint / 30 步 / 8 CFG。
  const items = [inpaintItem, parentItem]
  const patch = logic.iteratePatch(inpaintEntry, form, NON_DIFFUSION_PRESETS, items)
  assert.deepEqual(
    patch,
    logic.iteratePatch({ image: parentImage, item: parentItem }, form, NON_DIFFUSION_PRESETS, items),
    '有父作品时回填沿 sourceImage 回溯父作品',
  )
  assert.equal(patch.presetId, 'sdxl-base')
  assert.equal(patch.steps, 25, '步数来自父作品，而不是局部重绘的 30')
  assert.equal(patch.cfg, 7.5)
  assert.equal(patch.prompt, '父作品提示词')
  assert.equal(logic.diffusionSourceOf(inpaintEntry, items, NON_DIFFUSION_PRESETS).item.jobId, 'job-1')
  assert.equal(JSON.stringify(patch).includes('sdxl-inpaint'), false, '补丁不得出现 inpaintOnly 预设')

  // ② 父作品缺失：降级补丁保留提示词 / 排除项 / 尺寸，预设与步数换成可文生图预设的推荐值。
  const degraded = logic.iteratePatch(inpaintEntry, form, NON_DIFFUSION_PRESETS, [inpaintItem])
  assert.equal(degraded.prompt, '重绘后的提示词')
  assert.equal(degraded.negative, 'blurry')
  assert.equal(degraded.width, 1024)
  assert.equal(degraded.height, 1024)
  assert.equal(degraded.presetId, 'sdxl-base', '降级沿用当前表单预设（合法扩散预设）')
  assert.equal(degraded.steps, 25, '降级步数用合法预设推荐值，不是 inpaintOnly 的 30')
  assert.equal(degraded.seed, '', '降级后种子恢复随机')
  assert.equal(JSON.stringify(degraded).includes('sdxl-inpaint'), false)

  // ③ 当前表单预设本身就是 inpaintOnly：降级选模要跳开它，换成第一个可文生图预设。
  const fromInpaintForm = logic.iteratePatch(inpaintEntry, { presetId: 'sdxl-inpaint' }, NON_DIFFUSION_PRESETS, [inpaintItem])
  assert.equal(fromInpaintForm.presetId, 'sdxl-lightning')

  // ④ 扩图产物同理（outpaint 默认用 sdxl-inpaint 9 通道权重）。
  const outpaintItem = {
    ...inpaintItem,
    jobId: 'job-3',
    outpaint: true,
    prompt: '扩图后的提示词',
    sourceImage: '',
    params: { ...inpaintItem.params, prompt: '扩图后的提示词', width: 1536, height: 864 },
  }
  const outpaintPatch = logic.iteratePatch(
    { image: { ...inpaintImage, width: 1536, height: 864 }, item: outpaintItem },
    form,
    NON_DIFFUSION_PRESETS,
    [outpaintItem],
  )
  assert.equal(outpaintPatch.prompt, '扩图后的提示词')
  assert.equal(outpaintPatch.width, 1536, '降级尺寸取产物像素并钳到契约范围')
  assert.equal(outpaintPatch.presetId, 'sdxl-base')
  assert.equal(JSON.stringify(outpaintPatch).includes('sdxl-inpaint'), false)

  // ⑤ 重新生成同样不能把 inpaintOnly 预设写进覆盖项。
  const overrides = logic.rerollOverrides(inpaintEntry, NON_DIFFUSION_PRESETS, items)
  assert.equal(overrides.presetId, 'sdxl-base')
  assert.equal(overrides.steps, 25)
  assert.equal(overrides.seed, -1)
  assert.equal(JSON.stringify(overrides).includes('sdxl-inpaint'), false)
  const degradedReroll = logic.rerollOverrides(inpaintEntry, NON_DIFFUSION_PRESETS, [inpaintItem], { id: 'sdxl-base' })
  assert.equal(degradedReroll.prompt, '重绘后的提示词')
  assert.equal(degradedReroll.presetId, 'sdxl-base')
  assert.equal(degradedReroll.seed, -1)
})

// 降级补丁的兜底原则：任何情况下都要给出一个可文生图的预设，不能把左栏模型选择器
// 清成「空白未选中」；已下线的旧模型 id 也不会被当成回填来源。
await check('回填降级：已下线预设 / 旧版本产物不会清空表单预设', () => {
  const presets = [
    { id: 'sdxl-lightning', size: 1024, steps: 4, cfg: 0 },
    { id: 'sdxl-base', size: 1024, steps: 25, cfg: 7.5 },
  ]
  const retired = {
    image: { path: 'imagen-output/old/01.png', width: 1024, height: 1024, seed: 3 },
    item: { jobId: 'job-old', prompt: '旧模型画的作品', presetId: 'retired-model', params: { steps: 30, cfg: 5 } },
  }
  const form = { presetId: 'sdxl-base', steps: 25, cfg: 7.5, seed: '42' }
  const patch = logic.iteratePatch(retired, form, presets)
  assert.equal(patch.presetId, 'sdxl-base', '保留表单当前可用预设，不清空')
  assert.equal(patch.prompt, '旧模型画的作品')
  assert.equal(patch.steps, 25, '已下线模型的步数不写进表单')
  assert.equal(patch.cfg, 7.5)
  assert.equal(patch.seed, '', '旧产物的固定种子不串到下一张')
  assert.equal(JSON.stringify(patch).includes('retired-model'), false, '补丁不得出现已下线模型 id')
  // 表单当前预设也不可用（专用局部重绘权重）→ 换成第一个可文生图预设，仍然不留空。
  const fromNative = logic.iteratePatch(
    retired,
    { presetId: 'sdxl-inpaint' },
    [...presets, { id: 'sdxl-inpaint', inpaintOnly: true, steps: 30, cfg: 8 }],
  )
  assert.equal(fromNative.presetId, 'sdxl-lightning')
  // 预设列表还没拿到（启动瞬间）：不按「未知预设」误判，保留历史条目的既有语义。
  assert.equal(logic.iteratePatch(retired, form, []).presetId, 'retired-model')
  // 旧版本产物带 sourceImage 且父作品已加载：回填沿父作品，预设取父作品的合法预设。
  const parentImage = { path: 'imagen-output/job-p/01.png', width: 1024, height: 1024, seed: 5 }
  const parentItem = {
    jobId: 'job-p',
    prompt: '父作品提示词',
    presetId: 'sdxl-base',
    params: { steps: 25, cfg: 7.5, seed: 5 },
    images: [parentImage],
  }
  const withParent = { image: retired.image, item: { ...retired.item, sourceImage: parentImage.path } }
  const parentPatch = logic.iteratePatch(withParent, form, presets, [parentItem])
  assert.equal(parentPatch.presetId, 'sdxl-base')
  assert.equal(parentPatch.prompt, '父作品提示词')
  assert.equal(parentPatch.steps, 25)
  assert.equal(JSON.stringify(parentPatch).includes('retired-model'), false)
})

await check('重试参数构造', () => {
  const job = {
    id: 'job-1',
    presetId: 'sdxl-base',
    params: { prompt: '失败的任务', negativePrompt: 'blur', width: 512, height: 768, steps: 30, cfg: 5, count: 2 },
  }
  const retry = logic.retryOverrides(job)
  assert.equal(retry.prompt, '失败的任务')
  assert.equal(retry.seed, -1)
  assert.equal(retry.count, 2)
  assert.equal(retry.width, 512)
  assert.equal(retry.height, 768)
  assert.equal(retry.steps, 30)
  assert.equal(retry.cfg, 5)
  assert.equal(retry.negativePrompt, 'blur')
  assert.equal(retry.presetId, 'sdxl-base')

  const body = { prompt: '上一次提交', presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0, count: 1, negativePrompt: '' }
  assert.equal(logic.retryOverrides(body).prompt, '上一次提交', '没有任务时可用上一次提交的 body')
  assert.equal(logic.retryOverrides({ params: { prompt: '   ' } }), null)
  assert.equal(logic.retryOverrides(null), null)
})

await check('任务取消：可取消判定、取消中文案与终态收敛', () => {
  // 三种活动态可取消，终态不再显示取消入口。
  assert.equal(logic.isJobCancellable({ id: 'a', status: 'queued' }), true)
  assert.equal(logic.isJobCancellable({ id: 'a', status: 'waiting-session' }), true)
  assert.equal(logic.isJobCancellable({ id: 'a', status: 'running' }), true)
  for (const status of ['done', 'failed', 'cancelled']) {
    assert.equal(logic.isJobCancellable({ id: 'a', status }), false, `${status} 是终态，不应可取消`)
  }
  assert.equal(logic.isJobCancellable(null), false)
  // 取消中 = 宿主已标记 cancelRequested，或本地请求已发出。
  assert.equal(logic.isJobCancelling({ id: 'a', status: 'running', cancelRequested: true }, []), true)
  assert.equal(logic.isJobCancelling({ id: 'a', status: 'running' }, ['a']), true)
  assert.equal(logic.isJobCancelling({ id: 'a', status: 'running' }, ['b']), false)
  assert.equal(logic.isJobCancelling(null, ['a']), false)

  // 取消中的 running 给「正在停止…」，不提前说「已取消」。
  const stopping = { id: 'a', status: 'running', stageCode: 'running', cancelRequested: true, progress: { done: 1, total: 4 } }
  assert.equal(logic.jobProgressText(t, stopping, 'ready'), t('studio.job.cancelling'))
  assert.equal(logic.jobProgressText(te, stopping, 'ready'), en['studio.job.cancelling'])
  // 收敛为终态后显示「已取消」；旧宿主没有 stageCode 也能收敛。
  assert.equal(logic.jobProgressText(t, { status: 'cancelled', stageCode: 'cancelled' }, 'ready'), t('job.status.cancelled'))
  assert.equal(logic.jobProgressText(t, { status: 'cancelled' }, 'ready'), '已取消')
  assert.equal(logic.jobStatusText(t, 'cancelled'), '已取消')
  assert.equal(logic.jobStatusText(te, 'cancelled'), 'Cancelled')
  // 取消中的卡片另加 is-cancelling 结构类名。
  assert.equal(logic.jobCardClass({ id: 'a', status: 'running' }, ['a']), 'ofs-ghost is-cancelling')
  assert.equal(logic.jobCardClass({ id: 'a', status: 'queued' }, []), 'ofs-ghost is-queued')

  // cancelled 不再出现在待执行队列；三个活动态保持原样。
  const state = {
    jobs: [
      { id: 'job-cancelled', status: 'cancelled' },
      { id: 'job-run', status: 'running', createdAt: at(-30) },
      { id: 'job-queued', status: 'queued', createdAt: at(-10) },
    ],
  }
  assert.deepEqual(logic.pendingJobsOf(state).map((job) => job.id), ['job-run', 'job-queued'])
  assert.equal(ACTIVE_STATUS.cancelled, undefined, 'ACTIVE_STATUS 只保留三种活动态')
})

await check('历史分页：追加去重、offset 递增与 hasMore', () => {
  const page1 = [{ jobId: 'j1', prompt: '一' }, { jobId: 'j2', prompt: '二' }, { dir: 'dir-3', prompt: '三' }]
  // 第二页可能因为目录写入时序重复返回上一页的条目，合并必须去重且保持顺序。
  const page2 = [{ dir: 'dir-3', prompt: '三' }, { jobId: 'j4', prompt: '四' }, { jobId: 'j1', prompt: '一' }]
  const merged = logic.mergeHistoryPages(page1, page2)
  assert.deepEqual(merged.map((item) => item.jobId || item.dir), ['j1', 'j2', 'dir-3', 'j4'])
  assert.equal(logic.mergeHistoryPages(page1, []), page1, '空页返回原数组引用')
  assert.equal(logic.mergeHistoryPages(null, page2).length, 3)
  assert.deepEqual(logic.mergeHistoryPages([], null), [])
  // 去重键优先级：jobId → dir → 时间 + 提示词。
  assert.equal(logic.historyKeyOf({ jobId: 'j1', dir: 'd1' }), 'job:j1')
  assert.equal(logic.historyKeyOf({ dir: 'd1' }), 'dir:d1')
  assert.equal(logic.historyKeyOf({ prompt: 'p', finishedAt: 't' }), 'raw:t|p')
  assert.equal(logic.historyKeyOf(null), '')
  // offset 用「本次实际返回条数」推进，不能用去重后的合并长度。
  assert.equal(logic.nextHistoryOffset(0, LIMITS.history.pageSize), LIMITS.history.pageSize)
  assert.equal(logic.nextHistoryOffset(LIMITS.history.pageSize, 40), LIMITS.history.pageSize + 40)
  assert.equal(logic.nextHistoryOffset(undefined, 30), 30)
  assert.equal(logic.nextHistoryOffset(100, 0), 100)
  // hasMore：新宿主给字段，旧宿主按「本页是否取满」推断。
  assert.equal(logic.historyHasMore({ items: [{}], hasMore: true }, 100), true)
  assert.equal(logic.historyHasMore({ items: [{}], hasMore: false }, 100), false)
  assert.equal(logic.historyHasMore({ items: new Array(100).fill({}) }, 100), true)
  assert.equal(logic.historyHasMore({ items: [{}] }, 100), false)
  assert.equal(logic.historyHasMore(null, 100), false)
})

await check('探测结果归一化', () => {
  assert.equal(logic.probeStatusOf(null), null)
  const failed = logic.probeStatusOf({
    cli: { present: false, error: 'not found' },
    auth: { ok: false, errorCode: 'cli_missing' },
    quota: { available: false },
    notes: ['未找到 kaggle CLI，请先安装：pip install -U kaggle', '配额接口不可用'],
  })
  assert.equal(failed.cli, 'failed')
  assert.equal(failed.auth, 'failed')
  assert.equal(failed.quota, 'unavailable')
  assert.equal(failed.notes.length, 2)
  assert.equal(logic.probeFailureCode({ cli: { present: false } }), 'cli_missing')
  assert.equal(logic.probeFailureCode({ cli: { present: true }, auth: { ok: false } }), 'auth_required')
  assert.equal(logic.probeFailureCode({ cli: { present: true }, auth: { ok: true } }), '')
  assert.match(logic.probeFailureDetail({ notes: ['安装 kaggle 后重试'] }), /安装 kaggle/)
  assert.equal(logic.KAGGLE_INSTALL_COMMAND, 'pip install -U kaggle')
  assert.equal(logic.KAGGLE_SETTINGS_URL, 'https://www.kaggle.com/settings/api')

  // HTTP 200 但业务失败：不能当成检查成功。
  const payload = {
    ok: false,
    probe: { cli: { present: false }, auth: { ok: false }, notes: ['未找到 kaggle CLI，请先安装：pip install -U kaggle'] },
  }
  const outcome = logic.probeOutcomeOf(payload)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'cli_missing')
  assert.match(outcome.detail, /pip install -U kaggle/)
  assert.equal(logic.probeOutcomeOf({ ok: true, probe: { auth: { ok: true } } }).ok, true)
  assert.equal(logic.probeOutcomeOf({}).ok, false, '缺字段的 200 响应按失败处理')
  assert.equal(logic.probeOutcomeOf({}).code, 'probe_failed')

  const ok = logic.probeStatusOf({ cli: true, auth: { ok: true }, quota: { available: true, usedHours: 3, totalHours: 30 } })
  assert.equal(ok.cli, 'ok', '兼容布尔型 cli')
  assert.equal(ok.auth, 'ok')
  assert.equal(ok.quota, 'ok')

  // 账号状态：没探测过不等于账号不可用；会话能跑通本身就是凭据有效的证据。
  const probeOk = { cli: { present: true }, auth: { ok: true }, quota: { available: true } }
  const probeFailed = { cli: { present: true }, auth: { ok: false, errorCode: 'auth_required' }, quota: { available: false } }
  assert.equal(logic.sessionProvesAuth('ready'), true)
  assert.equal(logic.sessionProvesAuth('provisioning'), true)
  assert.equal(logic.sessionProvesAuth('absent'), false)
  assert.equal(logic.sessionProvesAuth('error'), false)
  assert.equal(logic.accountStatusOf(null, 'absent'), 'unknown', '从未探测时应是未检查，不能是不可用')
  assert.equal(logic.accountStatusOf(null, 'ready'), 'ok', '会话已就绪（能出图）即证明凭据有效')
  assert.equal(logic.accountStatusOf(null, 'provisioning'), 'ok')
  assert.equal(logic.accountStatusOf(probeOk, 'absent'), 'ok')
  assert.equal(logic.accountStatusOf(probeFailed, 'absent'), 'failed', '探测失败且没有成功证据时如实报失败')
  assert.equal(logic.accountStatusOf(probeFailed, 'ready'), 'ok', '会话跑通优先于上一次探测失败')
})

await check('润色标签的追加与撤销', () => {
  // 中文提示词用全角逗号，英文用半角逗号加空格。
  assert.equal(logic.toggleRefineTerm('雨夜街景', '霓虹冷暖反光'), '雨夜街景，霓虹冷暖反光')
  assert.equal(logic.toggleRefineTerm('雨夜街景，霓虹冷暖反光', '霓虹冷暖反光'), '雨夜街景')
  assert.equal(logic.toggleRefineTerm('rainy street', 'neon reflections'), 'rainy street, neon reflections')
  assert.equal(logic.toggleRefineTerm('rainy street, neon reflections', 'neon reflections'), 'rainy street')
  // 已有分隔符时不重复追加。
  assert.equal(logic.toggleRefineTerm('雨夜街景，', '雾气'), '雨夜街景，雾气')
  // 空提示词直接填入标签本身。
  assert.equal(logic.toggleRefineTerm('', '雾气'), '雾气')
  // 同名标签只撤掉最后一次追加的那一段。
  assert.equal(logic.toggleRefineTerm('雾气，雨夜，雾气', '雾气'), '雾气，雨夜')
  // 撤销不误删用户自己写的内容。
  assert.equal(logic.toggleRefineTerm('雨夜街景，霓虹', '雾'), '雨夜街景，霓虹，雾')
  // 句子里恰好包含同一个词时，不算已追加、撤销也不删句子。
  assert.equal(logic.toggleRefineTerm('霓虹灯光效', '灯光'), '霓虹灯光效，灯光')
  assert.equal(logic.isRefineApplied('霓虹灯光效', '灯光'), false)
  assert.equal(logic.toggleRefineTerm('水面有雾气弥漫', '雾气'), '水面有雾气弥漫，雾气')
  // 中英混排时连同分隔符一起撤掉，不留悬空逗号。
  assert.equal(logic.toggleRefineTerm('rainy street, 静谧雾气', '静谧雾气'), 'rainy street')
  assert.equal(logic.isRefineApplied('rainy street, 静谧雾气', '静谧雾气'), true)
  assert.equal(logic.toggleRefineTerm('雨夜，雾气', '雾气'), '雨夜')
  assert.equal(logic.isRefineApplied('雨夜街景，雾', '雾'), true)
  assert.equal(logic.isRefineApplied('雨夜街景', '雾'), false)
  assert.equal(logic.refineSeparator('雨夜'), '，')
  assert.equal(logic.refineSeparator('rainy'), ', ')
})

await check('润色建议：界面显示中文 label，插入提示词的始终是英文 text', () => {
  const option = { id: 'local-lighting-0', text: 'soft diffused light', label: '柔和漫射光' }
  const prompt = '雨夜街景'
  const next = logic.toggleRefineTerm(prompt, option.text, logic.refineSeparator(prompt))
  assert.equal(next, '雨夜街景，soft diffused light', '插入的是可直接发给模型的英文本')
  assert.equal(logic.isRefineApplied(next, option.text), true, 'applied 判断用 text')
  assert.equal(logic.isRefineApplied(next, option.label), false, '中文 label 不参与 applied 判断')
  // 再点一次撤销的也是英文本，中文 label 不会残留在提示词里。
  assert.equal(logic.toggleRefineTerm(next, option.text, logic.refineSeparator(next)), '雨夜街景')
})

await check('灵感示例文案都在字典里，风格文案已删除', () => {
  for (const suffix of ['1', '2', '3', '4', '5']) {
    const key = `studio.inspire.${suffix}`
    assert.ok(zh[key], `缺少中文灵感：${key}`)
    assert.ok(en[key], `缺少英文灵感：${key}`)
    assert.ok(zh[`${key}.label`], `缺少中文灵感名：${key}.label`)
    assert.ok(en[`${key}.label`], `缺少英文灵感名：${key}.label`)
  }
  // 静态风格相关的文案键随功能一起删除，避免字典里留下永远不展示的文案。
  for (const key of ['studio.style', 'studio.chat.styleAuto', 'studio.chat.clarify.ratio', 'studio.chat.clarify.style']) {
    assert.equal(Object.prototype.hasOwnProperty.call(zh, key), false, `${key} 应已删除`)
    assert.equal(Object.prototype.hasOwnProperty.call(en, key), false, `${key} 的英文文案应已删除`)
  }
})

await check('对话意图 v2：映射到表单与生成参数', () => {
  const messages = [
    { id: 1, role: 'user', text: '画一张横版的雨夜街景' },
    { id: 2, role: 'assistant', kind: 'intent', prompt: 'rainy night street, neon reflections', ratioId: '16:9', negative: 'blurry', count: 3 },
    { id: 3, role: 'user', text: '背景加一只黑猫' },
  ]
  assert.equal(logic.lastIntentPrompt(messages), 'rainy night street, neon reflections')
  assert.equal(logic.lastIntentPrompt([]), '')
  assert.equal(logic.lastIntentPrompt([{ role: 'assistant', kind: 'job', text: 'x' }]), '')
  // 多轮上下文隔离：只认用户自然语言原话与意图卡，表单提交同步记录（kind='form'）不算。
  assert.deepEqual(
    logic.intentHistory([
      { role: 'user', text: '画一张横版的雨夜街景' },
      { role: 'user', kind: 'form', text: '表单里顺手跑的另一张图', summary: { presetId: 'sdxl-lightning' } },
      { role: 'assistant', kind: 'intent', prompt: 'rainy night street, neon reflections' },
      { role: 'assistant', kind: 'job', text: '正在生成…' },
    ]),
    [
      { role: 'user', content: '画一张横版的雨夜街景' },
      { role: 'assistant', content: 'rainy night street, neon reflections' },
    ],
    '表单同步记录与任务气泡不进意图上下文',
  )

  const ratios = [
    { id: '1:1', width: 1024, height: 1024 },
    { id: '16:9', width: 1152, height: 648 },
  ]
  assert.deepEqual(
    logic.intentFormPatch({ prompt: 'rainy night street', ratioId: '16:9', count: 3 }, ratios),
    { prompt: 'rainy night street', width: 1152, height: 648, count: 3 },
    '确认卡写表单：比例换算宽高、张数归一；没有 negativeActive 时不写排除项',
  )
  // 没有匹配的比例时不覆盖表单尺寸；张数钳制 1~4；可用时才写排除项。
  assert.deepEqual(
    logic.intentFormPatch({ prompt: 'x', ratioId: '', count: 9, negative: 'blurry' }, ratios, { negativeActive: true }),
    { prompt: 'x', count: 4, negative: 'blurry' },
  )
  assert.deepEqual(
    logic.intentFormPatch({ prompt: 'x', count: 2, negative: 'blurry' }, ratios, { negativeActive: false }),
    { prompt: 'x', count: 2 },
    '排除项不可用时不写入表单',
  )
  assert.deepEqual(logic.intentFormPatch(null, ratios), {})

  // 生成覆盖项：提示词不合并任何后缀；张数进请求；负向词受 negativeActive 门控。
  const message = { prompt: '  rainy night street  ', negative: ' blurry ', count: 3 }
  assert.deepEqual(logic.intentOverrides(message, { negativeActive: true }), {
    prompt: 'rainy night street',
    count: 3,
    negativePrompt: 'blurry',
  })
  assert.deepEqual(logic.intentOverrides(message, { negativeActive: false }), {
    prompt: 'rainy night street',
    count: 3,
    negativePrompt: '',
  })
  // 张数归一：非数字回落 1，越界钳制到 1~4。
  assert.equal(logic.intentOverrides({ ...message, count: 'x' }, { negativeActive: false }).count, 1)
  assert.equal(logic.intentOverrides({ ...message, count: 9 }, { negativeActive: false }).count, 4)
  assert.equal(logic.intentOverrides({ ...message, count: 2.6 }, { negativeActive: false }).count, 3)
  assert.equal(logic.intentOverrides({ prompt: '   ' }, { negativeActive: false }), null, '空提示词不产生覆盖项')
  // 编辑白名单：prompt / negative / count；count 走纯逻辑归一。
  assert.deepEqual(logic.INTENT_EDITABLE_FIELDS, ['prompt', 'negative', 'count'])
  assert.deepEqual(logic.intentFieldPatch('count', '3'), { count: 3 })
  assert.deepEqual(logic.intentFieldPatch('count', 9), { count: 4 })
  assert.deepEqual(logic.intentFieldPatch('count', 0), { count: 1 })
  assert.deepEqual(logic.intentFieldPatch('count', 2.6), { count: 3 })
  assert.deepEqual(logic.intentFieldPatch('count', 'x'), { count: 1 })
  assert.deepEqual(logic.intentFieldPatch('count', undefined), { count: 1 })
  assert.equal(logic.intentFieldPatch('styleId', 'ink'), null, '非白名单字段应忽略')
  assert.equal(logic.intentFieldPatch('ratioId', '16:9'), null)
})

await check('悬浮提示的定位夹在容器内', () => {
  const frame = { left: 18, top: 18, width: 1400, height: 860 }
  const middle = logic.tooltipPlacement({ anchor: { left: 400, top: 200, bottom: 220, width: 16 }, frame, width: 248 })
  assert.equal(middle.below, false)
  assert.ok(middle.left >= 8, '左侧不越界')
  assert.ok(middle.left + middle.maxWidth <= frame.width - 8 + 0.001, '右侧不越界')
  assert.equal(middle.top, 200 - 18 - 8, '向上展开时贴住触发点上方')

  const leftEdge = logic.tooltipPlacement({ anchor: { left: 40, top: 200, bottom: 220, width: 16 }, frame, width: 248 })
  assert.equal(leftEdge.left, 8, '靠左触发点应被夹到容器内边距上')

  const topEdge = logic.tooltipPlacement({ anchor: { left: 400, top: 30, bottom: 50, width: 16 }, frame, width: 248 })
  assert.equal(topEdge.below, true, '顶部空间不足时向下展开')
  assert.equal(topEdge.top, 50 - 18 + 8)

  const forced = logic.tooltipPlacement({ anchor: { left: 400, top: 200, bottom: 220, width: 16 }, frame, width: 248, preferBelow: true })
  assert.equal(forced.below, true)

  const noFrame = logic.tooltipPlacement({ anchor: { left: 100, top: 200, bottom: 220, width: 16 }, frame: null, width: 400 })
  assert.equal(noFrame.maxWidth, 400)
})

await check('日志增量合并与端点归一', () => {
  assert.deepEqual(appendLogLines([], ['a', 'b']), ['a', 'b'])
  assert.deepEqual(appendLogLines(['a'], []), ['a'], '无新增时保留原数组')
  assert.deepEqual(appendLogLines(['a'], [null, 3, 'b']), ['a', 'b'], '只保留字符串行')

  const many = Array.from({ length: 450 }, (_, index) => `line-${index}`)
  const capped = appendLogLines([], many)
  assert.equal(capped.length, LOG_LINE_LIMIT, '超出上限时保留最近 400 行')
  assert.equal(capped[0], 'line-50', '丢弃最早的日志')
  assert.equal(capped[capped.length - 1], 'line-449')
  assert.equal(appendLogLines(Array.from({ length: 399 }, (_, index) => `old-${index}`), ['new']).length, 400)

  const ok = readLogsPayload({ ok: true, data: { ok: true, since: 0, next: 12, lines: ['x', 1, 'y'] } })
  assert.equal(ok.ok, true)
  assert.equal(ok.next, 12)
  assert.deepEqual(ok.lines, ['x', 'y'])
  assert.equal(ok.reason, null)

  const absent = readLogsPayload({ ok: true, data: { ok: false, code: 'session_absent', message: '云端会话未启动', lines: [] } })
  assert.equal(absent.ok, false)
  assert.equal(absent.reason.code, 'session_absent')
  assert.equal(absent.reason.message, '云端会话未启动')

  const http = readLogsPayload({ ok: false, code: 'network', message: 'fetch failed' })
  assert.equal(http.ok, false)
  assert.equal(http.reason.code, 'network')

  assert.equal(readLogsPayload({ ok: true, data: { ok: false } }).reason.code, 'logs_unavailable', '缺错误码时回退 logs_unavailable')
  assert.equal(readLogsPayload({ ok: true, data: { ok: true, next: 'x', lines: [] } }).next, null, '非数字游标按 null 处理')

  // hostLines：Host 本地日志尾部与远端 lines 分开返回，只保留字符串、最多 120 行。
  const withHost = readLogsPayload({
    ok: true,
    data: { ok: true, next: 3, lines: ['remote-1'], hostLines: ['host-1', 2, null, 'host-2'] },
  })
  assert.equal(withHost.ok, true)
  assert.deepEqual(withHost.lines, ['remote-1'], '远端 lines 不受 hostLines 影响')
  assert.deepEqual(withHost.hostLines, ['host-1', 'host-2'], 'hostLines 只保留字符串行')
  assert.equal(withHost.next, 3)

  // 不可用分支同样带 hostLines（会话未启动时抽屉仍要能展示 Host 日志）。
  const absentHost = readLogsPayload({
    ok: true,
    data: { ok: false, code: 'session_absent', message: '云端会话未启动', lines: [], hostLines: ['host-a'] },
  })
  assert.equal(absentHost.ok, false)
  assert.deepEqual(absentHost.hostLines, ['host-a'])
  assert.equal(absentHost.reason.code, 'session_absent')

  // 老路由没有 hostLines / HTTP 层失败时按空数组处理，保持向后兼容。
  assert.deepEqual(readLogsPayload({ ok: true, data: { ok: true, lines: [] } }).hostLines, [])
  assert.deepEqual(readLogsPayload({ ok: false, code: 'network', message: 'fetch failed' }).hostLines, [])

  const manyHost = readLogsPayload({
    ok: true,
    data: { ok: true, hostLines: Array.from({ length: HOST_LOG_LINE_LIMIT + 30 }, (_, index) => `host-${index}`) },
  })
  assert.equal(manyHost.hostLines.length, HOST_LOG_LINE_LIMIT, 'hostLines 最多保留 120 行')
  assert.equal(manyHost.hostLines[HOST_LOG_LINE_LIMIT - 1], `host-${HOST_LOG_LINE_LIMIT + 29}`, '保留最新的尾部')
})

await check('本地时间与运行时长', () => {
  const local = new Date(2026, 0, 2, 9, 5, 7)
  assert.equal(formatClockTime(local), '09:05')
  assert.equal(formatClockTime(local.toISOString()), '09:05', 'ISO 字符串按本地时区格式化')
  assert.equal(formatClockTime('not-a-date'), '')
  assert.equal(formatClockTime(null), '')

  const start = new Date(2026, 0, 2, 9, 0, 0).toISOString()
  const now = new Date(2026, 0, 2, 9, 4, 30).getTime()
  assert.equal(elapsedMsSince(start, now), 270000)
  assert.equal(elapsedMsSince('bad', now), null)
  assert.equal(elapsedMsSince(new Date(now + 5000).toISOString(), now), 0, '未来时间按 0 处理')
})

await check('诊断信息拼装（不含 token）', () => {
  const session = {
    state: 'ready',
    phase: 'warm',
    presetId: 'sdxl-lightning',
    modelId: 'sdxl-lightning',
    device: 'Tesla T4',
    tunnelProvider: 'cloudflare',
    kernelStatus: 'running',
    startedAt: '2026-11-11T00:00:00.000Z',
    readyAt: '2026-11-11T00:01:00.000Z',
    token: 'super-secret-token',
    endpointUrl: 'https://tunnel.example.com',
    error: { code: 'remote_error', message: 'boom' },
  }
  // 条数与契约 LOGS.diagRemoteTail 同口径：改契约时这里不用再手改数字。
  const lines = Array.from({ length: LOGS.diagRemoteTail + 40 }, (_, index) => `log-${index}`)
  const hostLogs = Array.from({ length: DIAG_HOST_LOG_TAIL + 20 }, (_, index) => `host-${index}`)
  const text = buildDiagnostics(t, {
    version: '0.4.1',
    session,
    probe: { cli: { present: true }, auth: { ok: true }, quota: { available: false }, notes: ['配额接口超时'] },
    probeLastGood: { quota: { available: true, usedHours: 3, totalHours: 30 } },
    probeLastGoodAt: '2026-11-10T10:00:00.000Z',
    queue: { running: 'job-1', pending: 2 },
    lastJob: { id: 'job-0', status: 'done', seconds: 6.2 },
    lines,
    hostLogs,
    now: Date.parse('2026-11-11T00:05:00.000Z'),
  })

  assert.equal(text.split('\n')[0], `${t('studio.logs.diag.title')} · 2026-11-11T00:05:00.000Z`)
  for (const needle of [
    'version: 0.4.1',
    'session.state: ready',
    'session.tunnelProvider: cloudflare',
    'session.error: remote_error · boom',
    'probe.quota: unavailable',
    'probe.notes: 配额接口超时',
    'probeLastGood.quota: 3 / 30 h',
    'queue: running=job-1 pending=2',
    'lastJob: job-0 done 6.2s',
    `logs (last ${LOGS.diagRemoteTail}/${lines.length})`,
  ]) {
    assert.ok(text.includes(needle), `诊断文本应包含：${needle}`)
  }
  assert.ok(!text.includes('super-secret-token'), '诊断文本不得包含 token')
  assert.ok(!text.includes('token:'), '会话里的 token 字段应被剔除')

  const tail = text.split('\n').filter((line) => /^log-\d+$/.test(line))
  assert.equal(tail.length, LOGS.diagRemoteTail, '只附带契约约定的最近日志行数')
  assert.ok(tail.includes(`log-${lines.length - 1}`))
  assert.ok(!tail.includes('log-0'), '更早的日志被截断')

  // Host 本地日志单独成段，跟在远端日志之后，不混排。
  assert.ok(text.includes(`host logs (last ${DIAG_HOST_LOG_TAIL}/${hostLogs.length}):`), '诊断文本应包含 host logs 段落')
  const hostTail = text.split('\n').filter((line) => /^host-\d+$/.test(line))
  assert.equal(hostTail.length, DIAG_HOST_LOG_TAIL, 'Host 日志只附带最近一段尾部')
  assert.ok(hostTail.includes(`host-${hostLogs.length - 1}`), 'Host 日志应包含最新行')
  assert.ok(!hostTail.includes('host-0'), '更早的 Host 日志被截断')
  assert.ok(text.indexOf('logs (last') < text.indexOf('host logs (last'), 'host logs 段落排在远端日志之后')

  // 离线 / 无远端会话：没有 lines 也能复制诊断，Host 日志段落仍在。
  const offline = buildDiagnostics(t, { version: '0.4.1', hostLogs: ['[info] [session] transition absent->starting'], now: Date.parse('2026-11-11T00:05:00.000Z') })
  assert.ok(offline.includes('version: 0.4.1'))
  assert.ok(offline.includes('host logs (last 1/1):'))
  assert.ok(offline.includes('[info] [session] transition absent->starting'))
  assert.ok(offline.includes('logs (last 0/0):'), '没有远端日志时也给空段标题')

  const sanitized = sanitizeSession(session)
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, 'token'), false)
  assert.equal(session.token, 'super-secret-token', '清洗不应修改入参')
  assert.equal(sanitizeSession(null), null)
  assert.equal(quotaText({ available: false }), 'unavailable')
  assert.equal(quotaText({ available: true, usedHours: 1.5, totalHours: 30 }), '1.5 / 30 h')
  assert.equal(quotaText(null), '—')
})

await check('完成提醒纯函数', () => {
  const running = { id: 'job-1', status: 'running' }
  const done = { id: 'job-1', status: 'done', finishedAt: at(-1) }

  assert.equal(
    completionNotice({ previous: undefined, next: done, hidden: true, title: '工作台' }).notify,
    false,
    '首次挂载不触发',
  )
  assert.equal(
    completionNotice({ previous: null, next: done, hidden: true, title: '工作台' }).completed,
    false,
    '没有基线快照不触发',
  )

  const hiddenDone = completionNotice({ previous: running, next: done, hidden: true, title: '工作台' })
  assert.equal(hiddenDone.notify, true)
  assert.equal(hiddenDone.completed, true)
  assert.equal(hiddenDone.title, `${NOTICE_TITLE_PREFIX}工作台`)

  const visibleDone = completionNotice({ previous: running, next: done, hidden: false, title: '工作台' })
  assert.equal(visibleDone.notify, false, '页面可见时不改标题')
  assert.equal(visibleDone.completed, true)
  assert.equal(visibleDone.title, '工作台')

  const again = completionNotice({ previous: running, next: done, hidden: true, title: `${NOTICE_TITLE_PREFIX}工作台` })
  assert.equal(again.title, `${NOTICE_TITLE_PREFIX}工作台`, '已带前缀时不重复叠加')

  assert.equal(isCompletion({ id: 'a', status: 'done' }, { id: 'b', status: 'done' }), true, '换一个任务完成也算')
  assert.equal(isCompletion(done, done), false)
  assert.equal(isCompletion(running, { id: 'job-1', status: 'failed' }), false)
  assert.equal(stripNoticePrefix(`${NOTICE_TITLE_PREFIX}工作台`), '工作台')
  assert.equal(stripNoticePrefix('工作台'), '工作台')
})

await check('模型语言能力、步数分治模式与安全重置补丁', () => {
  assert.equal(logic.presetNeedsEnglish({ id: 'flux2-klein-4b', supportsChinese: true, promptStyle: 'natural' }), false)
  assert.equal(logic.presetNeedsEnglish({ id: 'realvis-v5', supportsChinese: false, promptStyle: 'natural' }), true)
  assert.equal(logic.presetNeedsEnglish(null), true)

  const usable = {
    id: 'realvis-v5',
    tier: 'usable',
    size: 1024,
    steps: 30,
    cfg: 5,
    stepRange: { min: 20, max: 45, step: 1, fast: 22, balanced: 30, fine: 40 },
  }
  const fast = { id: 'sdxl-turbo', tier: 'fast', size: 512, steps: 4, cfg: 0, stepRange: null }

  assert.equal(stepModeOf(usable), 'range')
  assert.equal(stepModeOf(fast), 'fixed')
  assert.equal(stepTierOf(usable, 20), 'fast')
  assert.equal(stepTierOf(usable, 22), 'fast')
  assert.equal(stepTierOf(usable, 30), 'balanced')
  assert.equal(stepTierOf(usable, 40), 'fine')
  assert.equal(stepTierOf(usable, 45), 'fine')
  assert.equal(stepTierOf(fast, 4), 'fixed')

  assert.deepEqual(safeResetPatch(usable), { width: 1024, height: 1024, steps: 30, cfg: 5 })
  assert.deepEqual(safeResetPatch(fast), { width: 512, height: 512, steps: 4, cfg: 0 })
  assert.deepEqual(safeResetPatch(null), { width: 1024, height: 1024, steps: 4, cfg: 1 })
})

await check('更新提示：只在 hasUpdate 时派生，链接与字段做归一', async () => {
  const update = logic.updateOf({
    version: '0.11.0',
    update: {
      current: '0.11.0',
      latest: '0.12.0',
      hasUpdate: true,
      releaseUrl: 'https://github.com/nanxfu/dsh-our-imagen/releases/tag/v0.12.0',
      enginesDsh: '>=0.2.0',
      checkedAt: '2026-01-01T00:00:00.000Z',
    },
  })
  assert.deepEqual(update, {
    latest: '0.12.0',
    current: '0.11.0',
    enginesDsh: '>=0.2.0',
    releaseUrl: 'https://github.com/nanxfu/dsh-our-imagen/releases/tag/v0.12.0',
    checkedAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(logic.updateOf({}), null)
  assert.equal(logic.updateOf({ update: { hasUpdate: false, latest: '0.12.0' } }), null)
  assert.equal(logic.updateOf({ update: { hasUpdate: true } }), null)

  // 旧宿主 / 不完整快照：current 回落到 /state.version，非 https 链接丢弃。
  const fallbackFields = logic.updateOf({
    version: '0.11.0',
    update: { hasUpdate: true, latest: '0.12.0', releaseUrl: 'http://evil.example/x' },
  })
  assert.equal(fallbackFields.current, '0.11.0')
  assert.equal(fallbackFields.releaseUrl, '')
  assert.equal(fallbackFields.enginesDsh, '')
  assert.equal(fallbackFields.checkedAt, null)
})

// 纯文生图能力预检：专用局部重绘预设（inpaintOnly）本次请求改用兜底预设并轻提示；
// 一个可文生图的预设都没有（旧宿主）时拦下。主表单不再校验参考图 / 蒙版。
await check('纯文生图能力预检：专用局部重绘预设自动兜底，无可用预设时拦下', () => {
  const lightning = { id: 'sdxl-lightning', label: 'SDXL Lightning', supportsImg2Img: true, supportsInpaint: true }
  const native = { id: 'sdxl-inpaint', label: 'SDXL Inpaint', supportsImg2Img: true, supportsInpaint: true, inpaintOnly: true }
  const flux = { id: 'flux2-klein-4b', label: 'FLUX.2 Klein', supportsImg2Img: false }
  const presets = [flux, native, lightning]

  // 普通预设：放行，不覆盖任何东西。
  const plain = logic.generateCapabilityOf({ preset: lightning, presets })
  assert.equal(plain.ok, true)
  assert.equal(plain.notice, null)
  assert.equal(plain.preset, null)
  // 预设列表未就绪（启动瞬间）：不做判断，交给宿主。
  assert.equal(logic.generateCapabilityOf({ preset: native, presets: [] }).ok, true)
  assert.equal(logic.generateCapabilityOf({ preset: null, presets }).ok, true)

  // 专用局部重绘预设：本次改用可文生图的兜底预设并给展示名。
  const switched = logic.generateCapabilityOf({ preset: native, presets })
  assert.equal(switched.ok, true)
  assert.equal(switched.preset.id, 'sdxl-lightning', '兜底预设优先 sdxl-lightning')
  assert.equal(switched.notice.key, 'studio.form.autoText2Image')
  assert.equal(switched.notice.params.preset, 'SDXL Lightning', '提示里的预设用展示名')
  assert.equal(native.id, 'sdxl-inpaint', '预设对象本身不能被就地修改')

  // 一个能文生图的预设都没有：拦下并说明切模型。
  const blocked = logic.generateCapabilityOf({ preset: native, presets: [native] })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'preset')
  assert.equal(blocked.blockedKey, 'studio.form.blockedInpaintOnly')

  // 有效预设解析与展示名（重试 / 变体仍按覆盖项解析预设）。
  assert.equal(logic.effectivePresetOf({ presetId: 'sdxl-inpaint' }, lightning, presets), native)
  assert.equal(logic.effectivePresetOf({}, lightning, presets), lightning)
  assert.equal(logic.effectivePresetOf({ presetId: 'gone' }, lightning, presets), lightning)
  assert.equal(logic.effectivePresetOf(null, null, presets), null)
  assert.equal(logic.presetLabelOf(lightning), 'SDXL Lightning')
  assert.equal(logic.presetLabelOf({ id: 'x', short: 'S' }), 'S')
  assert.equal(logic.presetLabelOf({ id: 'x' }), 'x')
  assert.equal(logic.presetLabelOf(null), '')
})

// 算力来源能力位 providers 的纯函数口径：缺省全可用、单来源限制、非法 provider 回退 kaggle。
await check('算力来源能力位：缺省全可用 / 单来源限制 / 非法 provider 回退 kaggle', () => {
  const both = { id: 'sdxl-lightning', label: 'SDXL Lightning' }
  const colabOnly = { id: 'flux2-klein-9b', label: 'FLUX.2 Klein 9B', providers: ['colab'] }
  const kaggleOnly = { id: 'kaggle-only', label: 'Kaggle Only', providers: ['kaggle'] }

  // 缺省 / 空数组 = 契约 providers 全可用（旧资产与旧宿主预设语义不变）。
  assert.deepEqual(logic.presetProvidersOf(both), [...SETTINGS.providers])
  assert.deepEqual(logic.presetProvidersOf({ providers: [] }), [...SETTINGS.providers])
  assert.deepEqual(logic.presetProvidersOf(null), [...SETTINGS.providers])
  assert.deepEqual(logic.presetProvidersOf(colabOnly), ['colab'])
  // 重复项去重、未知来源忽略；全被过滤掉时按全可用兜底（脏数据不把模型从界面里抹掉）。
  assert.deepEqual(logic.presetProvidersOf({ providers: ['colab', 'colab'] }), ['colab'])
  assert.deepEqual(logic.presetProvidersOf({ providers: ['colab', 'a100'] }), ['colab'])
  assert.deepEqual(logic.presetProvidersOf({ providers: ['a100'] }), [...SETTINGS.providers])
  // 返回新数组：调用方修改不会污染预设对象（预设对象来自 /state 的共享快照）。
  const copy = logic.presetProvidersOf(colabOnly)
  copy.push('kaggle')
  assert.deepEqual(colabOnly.providers, ['colab'])

  // 可用性：缺省两种都可用；单来源只认自己；非法 provider 按契约默认来源（kaggle）判断。
  assert.equal(logic.presetAvailableForProvider(both, 'kaggle'), true)
  assert.equal(logic.presetAvailableForProvider(both, 'colab'), true)
  assert.equal(logic.presetAvailableForProvider(colabOnly, 'colab'), true)
  assert.equal(logic.presetAvailableForProvider(colabOnly, 'kaggle'), false)
  assert.equal(logic.presetAvailableForProvider(kaggleOnly, 'kaggle'), true)
  assert.equal(logic.presetAvailableForProvider(kaggleOnly, 'colab'), false)
  assert.equal(logic.providerIdOf('unknown'), SETTINGS.defaultProvider)
  assert.equal(logic.providerIdOf(undefined), SETTINGS.defaultProvider)
  assert.equal(logic.presetAvailableForProvider(kaggleOnly, 'unknown'), true, '非法 provider 回退 kaggle')
  assert.equal(logic.presetAvailableForProvider(colabOnly, 'unknown'), false, '非法 provider 回退 kaggle')
  // 角标限制与展示名键：只有单来源模型需要「仅 xx」角标。
  assert.equal(logic.presetProviderRestrictionOf(colabOnly), 'colab')
  assert.equal(logic.presetProviderRestrictionOf(kaggleOnly), 'kaggle')
  assert.equal(logic.presetProviderRestrictionOf(both), '')
  assert.equal(logic.providerNameKeyOf('colab'), 'studio.preset.providerName.colab')
  assert.equal(logic.providerNameKeyOf('nope'), 'studio.preset.providerName.kaggle')
})

// 生成前预检：当前算力来源跑不了有效预设时拦下（含模型名与来源），不放行、不自动换模型。
await check('生成前预检：算力来源不匹配时拦下并给来源说明', () => {
  const lightning = { id: 'sdxl-lightning', label: 'SDXL Lightning' }
  const colabOnly = { id: 'flux2-klein-9b', label: 'FLUX.2 Klein 9B', providers: ['colab'], supportsReference: true }
  const kaggleOnly = { id: 'kaggle-only', label: 'Kaggle Only', providers: ['kaggle'] }
  const presets = [colabOnly, kaggleOnly, lightning]

  const blocked = logic.generateCapabilityOf({ preset: colabOnly, presets, provider: 'kaggle' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'provider')
  assert.equal(blocked.blockedKey, 'studio.form.blockedProvider')
  assert.deepEqual(blocked.blockedParams, { preset: 'FLUX.2 Klein 9B', provider: 'kaggle', needed: 'colab' })
  // 拦下时不改模型、不带兜底预设 / 轻提示：换算力来源还是换模型由用户自己决定。
  assert.equal(blocked.preset, null)
  assert.equal(blocked.notice, null)

  // 来源匹配 / 缺省 providers / 非法 provider 回退 kaggle / 预设未就绪：都放行。
  assert.equal(logic.generateCapabilityOf({ preset: colabOnly, presets, provider: 'colab' }).ok, true)
  assert.equal(logic.generateCapabilityOf({ preset: kaggleOnly, presets, provider: 'kaggle' }).ok, true)
  assert.equal(logic.generateCapabilityOf({ preset: kaggleOnly, presets, provider: 'bad' }).ok, true, '非法 provider 回退 kaggle')
  assert.equal(logic.generateCapabilityOf({ preset: colabOnly, presets, provider: 'bad' }).ok, false, '非法 provider 回退 kaggle 后仍拦 colab-only')
  assert.equal(logic.generateCapabilityOf({ preset: lightning, presets, provider: 'kaggle' }).ok, true, '缺省 providers 的旧模型不受影响')
  assert.equal(logic.generateCapabilityOf({ preset: lightning, presets, provider: 'colab' }).ok, true)
  assert.equal(logic.generateCapabilityOf({ preset: colabOnly, presets: [], provider: 'kaggle' }).ok, true, '预设列表未就绪不误拦')
  assert.equal(logic.generateCapabilityOf({ preset: null, presets, provider: 'kaggle' }).ok, true)
})

// 新增算力来源门控文案键由 client-ui 维护字典，这里锁键名与占位符两侧都存在。
await check('算力来源门控文案键：中英文两侧齐全', () => {
  for (const key of [
    'studio.preset.providerOnly',
    'studio.preset.providerBlocked',
    'studio.preset.providerName.kaggle',
    'studio.preset.providerName.colab',
    'studio.form.blockedProvider',
  ]) {
    assert.equal(typeof DICT.zh[key], 'string', `${key} 缺少中文文案`)
    assert.ok(DICT.zh[key].length > 0, `${key} 中文文案为空`)
    assert.equal(typeof DICT.en[key], 'string', `${key} 缺少英文文案`)
    assert.ok(DICT.en[key].length > 0, `${key} 英文文案为空`)
  }
  // 占位符与调用方参数键必须对得上：拼错字段名会原样显示 {preset}。
  for (const name of ['preset', 'provider', 'needed']) {
    assert.ok(DICT.zh['studio.form.blockedProvider'].includes(`{${name}}`), `blockedProvider 中文缺少 {${name}} 占位`)
    assert.ok(DICT.en['studio.form.blockedProvider'].includes(`{${name}}`), `blockedProvider 英文缺少 {${name}} 占位`)
  }
})

// 失败重试参数：只重放纯文生图字段；参考图 / 蒙版的恢复迁到 useImageTool（决策 D5）。
await check('失败重试参数：只重放纯文生图字段', () => {
  const job = {
    id: 'job-1',
    presetId: 'sdxl-base',
    params: { prompt: '失败的任务', negativePrompt: 'blur', width: 512, height: 768, steps: 30, cfg: 5, count: 2, seed: 7 },
  }
  const overrides = logic.retryOverrides(job)
  assert.equal(overrides.prompt, '失败的任务')
  assert.equal(overrides.seed, -1, '重试重新抽一张')
  assert.equal(overrides.count, 2)
  assert.equal(overrides.width, 512)
  assert.equal(overrides.height, 768)
  assert.equal(overrides.steps, 30)
  assert.equal(overrides.cfg, 5)
  assert.equal(overrides.negativePrompt, 'blur')
  assert.equal(overrides.presetId, 'sdxl-base')
  assert.equal(Object.prototype.hasOwnProperty.call(overrides, 'reference'), false, '重试覆盖项不再携带参考图')

  // 兼容传上一次提交体：字段平铺在 body 上。
  const fromBody = logic.retryOverrides({ prompt: '上一次提交', width: 1024, height: 1024, count: 1, seed: -1 })
  assert.equal(fromBody.prompt, '上一次提交')
  assert.equal(fromBody.count, 1)
  assert.equal(fromBody.seed, -1)

  // 没有提示词：返回 null，调用方提示「先写提示词」。
  assert.equal(logic.retryOverrides(null), null)
  assert.equal(logic.retryOverrides({ params: { prompt: '  ' } }), null)
  // 工具任务（带 reference）不会被压成纯文生图重试：不产出 reference 覆盖项。
  const toolJob = { params: { prompt: '局部', reference: { sourcePath: 'imagen-output/a.png', strength: 0.8, mask: true } } }
  assert.equal(Object.prototype.hasOwnProperty.call(logic.retryOverrides(toolJob), 'reference'), false)

  // 缩略图地址纯函数（图片工具补 url 用）：空值返回空串，相对路径做一次 URL 编码。
  assert.equal(logic.referenceUrlOf(''), '')
  assert.equal(logic.referenceUrlOf(null), '')
  assert.equal(logic.referenceUrlOf(' imagen-output/a b.png '), `/imagen-api/file?path=${encodeURIComponent('imagen-output/a b.png')}`)
})

// 胶片条点击（阶段十五 A1）：脏不再拦截回填——先把当前编辑托管进草稿卡，再回填目标作品。
await check('胶片条点击判定：脏修改先托管再回填，草稿保留不丢', () => {
  const patch = { prompt: '作品提示词' }
  // 脏：先托管（park=true）再回填，提示「已保留当前草稿」。
  assert.deepEqual(logic.previewRecallOf({ dirty: true, patch }), {
    action: 'recall',
    park: true,
    noticeKey: 'studio.toast.draftKept',
  })
  // 干净但草稿卡里已有托管草稿：回填不影响草稿，同样提示草稿保留。
  assert.deepEqual(logic.previewRecallOf({ dirty: false, hasDraft: true, patch }), {
    action: 'recall',
    park: false,
    noticeKey: 'studio.toast.draftKept',
  })
  // 干净且没有草稿：普通回填。
  assert.deepEqual(logic.previewRecallOf({ dirty: false, patch }), {
    action: 'recall',
    park: false,
    noticeKey: 'studio.toast.recalled',
  })
  assert.deepEqual(logic.previewRecallOf({ dirty: false, patch: {} }), { action: 'idle', park: false, noticeKey: '' })
  assert.deepEqual(logic.previewRecallOf({}), { action: 'idle', park: false, noticeKey: '' })
  // 旧调用方残留的 reference 参数被忽略：不再有「保留参考图」分支。
  assert.deepEqual(logic.previewRecallOf({ reference: { path: 'x' }, dirty: false, patch }), {
    action: 'recall',
    park: false,
    noticeKey: 'studio.toast.recalled',
  })
})

// 草稿托管的纯逻辑：来源作品快照 / 原始参数补丁 / 托管与展示摘要。
await check('草稿托管：来源快照、还原补丁与草稿卡展示状态', () => {
  const entry = {
    image: { path: 'imagen-output/a/01.png', file: '01.png', seed: 7, width: 1024, height: 1024 },
    item: { jobId: 'job-1', prompt: '荷花池塘', presetId: 'sdxl-lightning' },
  }
  const patch = { prompt: '荷花池塘', width: 1024, height: 1024, seed: '7' }
  const source = logic.draftSourceOf(entry, patch)
  assert.deepEqual(source, { path: 'imagen-output/a/01.png', prompt: '荷花池塘', patch }, '来源快照保留路径 / 提示词 / 原始参数补丁')
  // 补丁是拷贝：之后改表单不会污染草稿里留着的原始参数。
  patch.width = 1280
  assert.equal(source.patch.width, 1024)
  // 旧条目没有 prompt 时退回参数里的提示词，再退回文件名。
  const fromParams = logic.draftSourceOf({ image: { path: 'p' }, item: { params: { prompt: '参数里的提示词' } } }, { prompt: 'x' })
  assert.equal(fromParams.prompt, '参数里的提示词')
  const fromFile = logic.draftSourceOf({ image: { file: '02.png' }, item: {} }, {})
  assert.deepEqual(fromFile, { path: '02.png', prompt: '02.png', patch: {} })
  assert.deepEqual(logic.draftSourceOf(null, null), { path: '', prompt: '', patch: {} }, '空条目也返回可序列化的空来源')

  // 「还原原图」只用来源里留下的原始补丁；没有补丁时返回 null（不展示还原入口）。
  assert.deepEqual(logic.originalPatchOf(source), { prompt: '荷花池塘', width: 1024, height: 1024, seed: '7' })
  assert.equal(logic.originalPatchOf({ path: 'p', prompt: 'x', patch: {} }), null)
  assert.equal(logic.originalPatchOf(null), null)
  assert.equal(logic.originalPatchOf({ patch: null }), null)
  // 返回拷贝：还原不影响草稿里留着的来源。
  const restored = logic.originalPatchOf(source)
  restored.prompt = '被改坏'
  assert.equal(source.patch.prompt, '荷花池塘')

  // 托管：没有草稿时建立草稿；已有草稿时用当前编辑覆盖内容、保留来源。
  const first = logic.parkDraftOf(null, source, { prompt: '改到一半' })
  assert.deepEqual(first, { source, form: { prompt: '改到一半' }, editing: false })
  const overwritten = logic.parkDraftOf(first, null, { prompt: '又改了一版' })
  assert.deepEqual(overwritten.form, { prompt: '又改了一版' }, '已有草稿时用当前编辑覆盖内容')
  assert.equal(overwritten.source, source, '没有新来源时沿用草稿原来的来源')
  assert.equal(overwritten.editing, false, '托管后不在草稿编辑态')
  assert.equal(logic.parkDraftOf(first, null, null), first, '没有表单时不覆盖草稿')

  // 展示摘要：脏 + 有来源 = 草稿卡亮起；托管草稿优先于当前脏状态。
  assert.deepEqual(logic.draftViewOf({ draft: null, dirty: true, origin: source }), {
    active: true,
    parked: false,
    editing: false,
    source,
    form: null,
  })
  assert.equal(logic.draftViewOf({ draft: null, dirty: false, origin: source }).active, false, '干净时没有草稿')
  assert.equal(logic.draftViewOf({ draft: null, dirty: true, origin: null }).active, true, '没有来源的脏修改同样是未提交草稿')
  const parkedView = logic.draftViewOf({ draft: { ...first, editing: true }, dirty: false, origin: source })
  assert.deepEqual(parkedView, { active: true, parked: true, editing: true, source, form: { prompt: '改到一半' } })
})

// mask-aware 强度钳制：带蒙版放宽到契约 inpaintMax，img2img 维持 max。
await check('强度 mask-aware 钳制：带蒙版放宽到 inpaintMax，请求体同步', () => {
  const inpaintMax = Number.isFinite(Number(LIMITS.strength.inpaintMax))
    ? Number(LIMITS.strength.inpaintMax)
    : LIMITS.strength.max
  assert.equal(logic.strengthMaxOf(false), LIMITS.strength.max)
  assert.equal(logic.strengthMaxOf(true), inpaintMax, '带蒙版上限来自契约 inpaintMax（缺省回落 max）')
  assert.ok(inpaintMax >= LIMITS.strength.max)

  // 无蒙版：与 clampStrength 同一口径（旧调用点行为不变）。
  for (const value of [0.6, 0.35, 3, 0.01, 'x', undefined]) {
    assert.equal(logic.clampMaskStrength(value, false), logic.clampStrength(value), `无蒙版 ${value} 钳制口径应一致`)
  }
  // 有蒙版：上限放宽，下界与步长不变。
  assert.equal(logic.clampMaskStrength(3, true), inpaintMax)
  assert.equal(logic.clampMaskStrength(inpaintMax, true), inpaintMax)
  assert.equal(logic.clampMaskStrength(LIMITS.strength.min, true), LIMITS.strength.min)
  assert.equal(logic.clampMaskStrength('x', true), LIMITS.strength.default)
  if (inpaintMax > LIMITS.strength.max) {
    // 0.9 + 0.05 带浮点尾巴，期望值按同一套取整口径算。
    const oneStepAbove = Math.round((LIMITS.strength.max + LIMITS.strength.step) * 1000) / 1000
    assert.equal(
      logic.clampMaskStrength(oneStepAbove, true),
      oneStepAbove,
      '带蒙版可超过 img2img 上限一档',
    )
  }

  // 请求体：带有效蒙版时按 inpaintMax 归一；无蒙版 / 蒙版被能力门控掉时仍按 max。
  const base = { prompt: '局部', width: 1024, height: 1024, steps: 4, cfg: 0, count: 1, seed: '', strength: 3 }
  const masked = { ...base, reference: { path: 'imagen-output/a.png', mask: { data: MASK_PNG_B64, coverage: 0.2 } } }
  assert.equal(logic.buildGenerateBody(masked).reference.strength, inpaintMax, '带蒙版的请求体按 inpaintMax 归一')
  assert.equal(logic.buildGenerateBody({ ...base, reference: { path: 'imagen-output/a.png' } }).reference.strength, LIMITS.strength.max)
  assert.equal(logic.buildGenerateBody(masked, { maskActive: false }).reference.strength, LIMITS.strength.max)
  const override = logic.buildGenerateBody(base, {
    overrides: { prompt: '重试', reference: { path: 'imagen-output/a.png', mask: { data: MASK_PNG_B64, coverage: 0.2 } }, strength: inpaintMax },
  })
  assert.equal(override.reference.strength, inpaintMax, '覆盖项（重试恢复的带蒙版任务）同样走 mask-aware 归一')
})

// 新增状态信号文案由 client-ui 维护字典，这里只锁键名两侧都存在。
await check('阶段十二图片工具文案键：中英文两侧齐全', () => {
  for (const key of [
    'studio.form.autoText2Image',
    'studio.form.blockedInpaintOnly',
    'studio.preset.imageToolOnly',
    'studio.rail.imageToolsHint',
    'studio.imageTool.title',
    'studio.imageTool.groupLabel',
    'studio.imageTool.inpaint',
    'studio.imageTool.img2img',
    'studio.imageTool.upscale',
    'studio.imageTool.outpaint',
    'studio.imageTool.planned',
    'studio.imageTool.autoPreset',
    'studio.imageTool.presetLabel',
    'studio.imageTool.promptLabel',
    'studio.imageTool.promptPlaceholder',
    'studio.imageTool.strengthLabel',
    'studio.imageTool.submit',
    'studio.imageTool.exit',
    'studio.imageTool.resumeDraft',
    'studio.imageTool.draftStatus',
    'studio.imageTool.maskEmpty',
    'studio.imageTool.blockedNoPreset',
    'studio.imageTool.blockedNoPrompt',
    'studio.imageTool.blockedTarget',
    'studio.imageTool.submitted',
    'studio.imageTool.retryMoved',
    'studio.mask.onlyHint',
    // 阶段十五 Phase B：高清放大 / 扩图的文案键（中英两侧必须同构）。
    'studio.imageTool.upscaleSubmitted',
    'studio.imageTool.upscaleTooLarge',
    'studio.outpaint.title',
    'studio.outpaint.hint',
    'studio.outpaint.ratioLabel',
    'studio.outpaint.ratio.expand',
    'studio.outpaint.ratio.16x9',
    'studio.outpaint.ratio.9x16',
    'studio.outpaint.ratio.4x3',
    'studio.outpaint.coverage',
    'studio.outpaint.center',
    'studio.outpaint.dragHint',
    'studio.outpaint.canvasLabel',
    'studio.outpaint.blockedCanvas',
    'studio.outpaint.invalidCanvas',
    'studio.outpaint.tooLarge',
    'studio.filmstrip.versionKind.upscale',
    'studio.filmstrip.versionKind.outpaint',
    'studio.chat.tool.upscale',
    'studio.chat.tool.outpaint',
  ]) {
    assert.ok(typeof DICT.zh[key] === 'string' && DICT.zh[key].length > 0, `${key} 缺少中文文案`)
    assert.ok(typeof DICT.en[key] === 'string' && DICT.en[key].length > 0, `${key} 缺少英文文案`)
  }
  // 左栏参考图区相关死键必须一起删掉，避免文案继续误导用户。
  // 阶段十五 Phase C2：`studio.reference.title` 已被「原生参考图槽」重新启用（新交互，
  // 不是旧强度滑块那套），不再属于死键。
  for (const key of [
    'studio.reference.strength',
    'studio.reference.autoText2Image',
    'studio.mask.toggle',
    'studio.mask.continueFromResult',
    'studio.toast.referenceKept',
    'studio.toast.maskLost',
    'studio.rail.followReference',
    'studio.chat.formSync.reference',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(DICT.zh, key), false, `${key} 应随左栏参考图区一起删除`)
    assert.equal(Object.prototype.hasOwnProperty.call(DICT.en, key), false, `${key} 应随左栏参考图区一起删除`)
  }
})

// 阶段十五 Phase B：扩图纯逻辑通过测试聚合出口导出（渲染 / 逻辑测试共用同一份实现）。
await check('扩图纯逻辑：plan / anchor / coverage / ratio 在聚合出口可用', () => {
  for (const name of ['outpaintPlanOf', 'outpaintAnchorOf', 'outpaintAnchorShift', 'outpaintCoverageOf', 'outpaintRatioOptions']) {
    assert.equal(typeof logic[name], 'function', `缺少 ${name} 导出`)
  }
  const plan = logic.outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: 'source' })
  assert.equal(plan.ok, true)
  assert.equal(plan.width % LIMITS.width.step, 0)
  assert.equal(plan.height % LIMITS.width.step, 0)
  assert.ok(plan.coverage > 0 && plan.coverage < 1)
  assert.equal(logic.outpaintCoverageOf(plan), plan.coverage)
  assert.equal(logic.outpaintAnchorOf({ x: 2, y: -1 }).x, 1)
  assert.deepEqual(logic.outpaintRatioOptions().map((option) => option.id), ['source', '16:9', '9:16', '4:3'])
})


// 阶段十五 Phase C2：参考图纯逻辑通过测试聚合出口导出（渲染 / 逻辑测试共用同一份实现）。
await check('参考图纯逻辑：槽位 / 能力 / 请求体在聚合出口可用', () => {
  for (const name of [
    'referenceAdd',
    'referenceListOf',
    'referencePathsOf',
    'referenceCapabilityOf',
    'supportsReferenceOf',
    'nativeReferencePresetOf',
    'referenceFingerprintOf',
    'referenceFileErrorOf',
  ]) {
    assert.equal(typeof logic[name], 'function', `缺少 ${name} 导出`)
  }
  const path = 'imagen-output/20261109-120000-job-1/01.png'
  const added = logic.referenceAdd([], path)
  assert.equal(added.ok, true)
  assert.equal(logic.referenceAdd(added.list, path).reason, 'duplicate')
  assert.equal(logic.referenceAdd(added.list, 'imagen-output/job-2/02.png').list.length, 2)
  // 契约上限来自 LIMITS.referenceImages：新增入口不自己写数字。
  assert.equal(logic.referencePathsOf([added.list[0], added.list[0]]).length, 1)
  assert.equal(logic.referenceLimits().maxCount, LIMITS.referenceImages.maxCount)

  // 请求体：槽位非空才出现 references；空槽保持纯文生图请求体。
  const base = { prompt: 'p', presetId: 'flux2-klein-4b', width: 1024, height: 1024, steps: 4, cfg: 1, seed: '', count: 1 }
  assert.equal(Object.prototype.hasOwnProperty.call(logic.buildGenerateBody(base), 'references'), false)
  const body = logic.buildGenerateBody({ ...base, references: [added.item] })
  assert.deepEqual(body.references, [path])

  // 能力门控：缺字段按 false；支持参考的预设才能过。
  assert.equal(logic.supportsReferenceOf({ id: 'sdxl-lightning' }), false)
  assert.equal(logic.supportsReferenceOf({ id: 'flux2-klein-4b', supportsReference: true }), true)
  const blocked = logic.generateCapabilityOf({
    preset: { id: 'sdxl-lightning' },
    presets: [{ id: 'sdxl-lightning' }, { id: 'flux2-klein-4b', supportsReference: true }],
    references: [path],
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blockedKey, 'studio.reference.blockedUnsupported')
})

summary()
