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
import * as logic from '../src/logic/index.js'
import {
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
import { styles, token } from '../src/theme.js'
import { ACTIVE_STATUS, TRANSIENT_SESSION, PHASE_STATE, NS } from '../src/constants.js'
import { DEFAULT_RATIOS, STYLE_CAPSULES } from '../src/studio/presets.js'
import { RATIO_IDS, STYLE_IDS, LIMITS } from '../shared/contract.js'

const t = fallbackTranslate('zh')
const te = fallbackTranslate('en')
const NOW = Date.parse('2026-11-09T05:05:00.000Z')
const at = (offsetSec) => new Date(NOW + offsetSec * 1000).toISOString()

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

await check('参数钳制符合 SPEC 第 2 节硬性约束', () => {
  assert.equal(logic.clampSize(99999), 1536)
  assert.equal(logic.clampSize(1), 256)
  assert.equal(logic.clampSize(1000), 1000)
  assert.equal(logic.clampSize(253), 256, '应向上取到 8 的整数倍')
  assert.equal(logic.clampSize('x'), 1024, '非法值回落 1024')
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
  assert.equal(NS, 'our-free-imagen')
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
  for (const code of ['delete_failed', 'network', 'http_500', 'probe_failed', 'unknown_code']) {
    assert.equal(logic.guidanceKindOf(code), 'generic', `${code} 只应关闭，不应触发重新出图`)
  }
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

await check('风格后缀拼装', () => {
  assert.equal(logic.composePrompt('一只猫', 'cinematic'), '一只猫, cinematic')
  assert.equal(logic.composePrompt('  一只猫  ', '  '), '一只猫')
  assert.equal(logic.composePrompt('', 'cinematic'), '', '没有原文时不产生只有后缀的提示词')
  assert.equal(logic.composePrompt('a, film', 'film'), 'a, film', '后缀已存在时不重复追加')
  assert.equal(logic.composePrompt('a, cinematic film', 'cinematic film'), 'a, cinematic film')
})

await check('最终请求体带风格后缀', () => {
  const form = {
    prompt: ' 一只赛博猫 ',
    negative: ' blurry ',
    presetId: 'sdxl-lightning',
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 0,
    seed: '',
    count: 1,
  }
  const body = logic.buildGenerateBody(form, { styleSuffix: 'cinematic film, 35mm', defaultPreset: 'sdxl-lightning' })
  assert.equal(body.prompt, '一只赛博猫, cinematic film, 35mm', '风格后缀应进入最终请求体')
  assert.equal(body.negativePrompt, 'blurry')
  assert.equal(body.presetId, 'sdxl-lightning')
  assert.equal(body.seed, -1)
  assert.equal(body.waitSeconds, 0)
  assert.equal(body.autoStart, true)

  const chat = logic.buildGenerateBody(form, {
    styleSuffix: 'cinematic film',
    defaultPreset: 'sdxl-lightning',
    overrides: { prompt: '聊天输入' },
  })
  assert.equal(chat.prompt, '聊天输入', '显式 prompt（对话 / 生成变体 / 重试）不追加风格后缀')
  assert.equal(chat.seed, -1)

  const empty = logic.buildGenerateBody({ ...form, prompt: '  ' }, { styleSuffix: 'cinematic film' })
  assert.equal(empty.prompt, '', '没有原文时不产生只有后缀的提示词')
})

await check('风格切换同步负向提示词', () => {
  const capsule = { id: 'film', negative: 'blurry, low quality' }
  const on = logic.toggleStyle({ styleId: '', negative: '' }, capsule)
  assert.equal(on.styleId, 'film')
  assert.equal(on.negative, 'blurry, low quality')
  const off = logic.toggleStyle(on, capsule)
  assert.equal(off.styleId, '')
  assert.equal(off.negative, '', '取消风格时收回它写入的负向')
  const edited = logic.toggleStyle({ styleId: 'film', negative: 'my own' }, capsule)
  assert.equal(edited.styleId, '')
  assert.equal(edited.negative, 'my own', '用户改过的负向保留')
  const keep = logic.toggleStyle({ styleId: '', negative: 'my own' }, capsule)
  assert.equal(keep.negative, 'my own')
})

await check('画面比例与风格 id 由契约唯一登记', () => {
  // 前端只保留「id → 尺寸 / 词表」的数据，清单与顺序必须来自 shared/contract.js。
  assert.deepEqual(DEFAULT_RATIOS.map((ratio) => ratio.id), RATIO_IDS)
  assert.deepEqual(STYLE_CAPSULES.map((capsule) => capsule.id), STYLE_IDS)
  for (const capsule of STYLE_CAPSULES) {
    assert.ok(capsule.labelKey, `${capsule.id} 缺少 labelKey`)
    assert.ok(capsule.suffix && capsule.negative, `${capsule.id} 缺少风格后缀或负向词`)
  }
})

await check('切换预设回填 negativeHint', () => {
  const presets = [
    { id: 'sdxl-lightning', size: 1024, steps: 4, cfg: 0, negativeHint: 'blurry, low quality, deformed, extra limbs' },
    { id: 'sdxl-base', size: 1024, steps: 25, cfg: 7, negativeHint: 'blurry, low quality, deformed, extra limbs' },
    { id: 'animagine-xl-3.1', size: 1024, steps: 28, cfg: 7, negativeHint: 'nsfw, lowres, watermark' },
  ]
  const form = { presetId: 'sdxl-lightning', width: 1024, height: 1024, steps: 4, cfg: 0, negative: '' }

  const filled = logic.presetSelectPatch(presets[2], form, presets)
  assert.equal(filled.presetId, 'animagine-xl-3.1')
  assert.equal(filled.steps, 28, '套用新预设推荐步数')
  assert.equal(filled.cfg, 7, '套用新预设推荐引导强度')
  assert.equal(filled.negative, 'nsfw, lowres, watermark', '负向为空时回填新预设的 negativeHint')

  // 负向仍等于上一个预设的推荐值：属于系统写入，跟随切换。
  const inherited = logic.presetSelectPatch(
    presets[2],
    { ...form, negative: 'blurry, low quality, deformed, extra limbs' },
    presets,
  )
  assert.equal(inherited.negative, 'nsfw, lowres, watermark')

  // 用户自己写过的负向提示词不覆盖。
  const custom = logic.presetSelectPatch(presets[2], { ...form, negative: 'my own words' }, presets)
  assert.equal(Object.prototype.hasOwnProperty.call(custom, 'negative'), false)

  // 新预设没有推荐负向时不要写入空值把用户的草稿清掉。
  const flux = { id: 'flux2-klein-4b', size: 1024, steps: 4, cfg: 1, negativeHint: '' }
  const noHint = logic.presetSelectPatch(flux, { ...form, negative: 'keep me' }, [...presets, flux])
  assert.equal(Object.prototype.hasOwnProperty.call(noHint, 'negative'), false)

  // 越界推荐值按契约钳制；非法入参不产生补丁。
  const oversized = logic.presetSelectPatch(
    { id: 'x', size: 4096, steps: 999, cfg: 99, negativeHint: '' },
    form,
    presets,
  )
  assert.equal(oversized.width, LIMITS.width.max)
  assert.equal(oversized.height, LIMITS.height.max)
  assert.equal(oversized.steps, LIMITS.steps.max)
  assert.equal(oversized.cfg, LIMITS.cfg.max)
  assert.deepEqual(logic.presetSelectPatch(null, form, presets), {})
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
    styleId: 'film',
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
  assert.equal(patch.styleId, '', '回填最终提示词后清空风格，避免后缀重复')
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'negative'), false, '没有作品负向提示词时不覆盖草稿')

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

  assert.deepEqual(logic.iteratePatch(null, form, presets), {})
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

await check('风格预设与灵感文案都在字典里', () => {
  for (const capsule of STYLE_CAPSULES) {
    assert.ok(zh[capsule.labelKey], `缺少中文风格名：${capsule.labelKey}`)
    assert.ok(en[capsule.labelKey], `缺少英文风格名：${capsule.labelKey}`)
    assert.equal(typeof capsule.suffix, 'string')
    assert.ok(capsule.suffix.length > 0)
  }
  for (const suffix of ['1', '2', '3', '4', '5']) {
    const key = `studio.inspire.${suffix}`
    assert.ok(zh[key], `缺少中文灵感：${key}`)
    assert.ok(en[key], `缺少英文灵感：${key}`)
    assert.ok(zh[`${key}.label`], `缺少中文灵感名：${key}.label`)
    assert.ok(en[`${key}.label`], `缺少英文灵感名：${key}.label`)
  }
})

await check('对话意图映射到表单与提示词', () => {
  const messages = [
    { id: 1, role: 'user', text: '画一张横版的雨夜街景' },
    { id: 2, role: 'assistant', kind: 'intent', prompt: '雨夜街景，湿润地面倒映霓虹', ratioId: '16:9', styleId: 'cyberpunk' },
    { id: 3, role: 'user', text: '背景加一只黑猫' },
  ]
  assert.equal(logic.lastIntentPrompt(messages), '雨夜街景，湿润地面倒映霓虹')
  assert.equal(logic.lastIntentPrompt([]), '')
  assert.equal(logic.lastIntentPrompt([{ role: 'assistant', kind: 'job', text: 'x' }]), '')

  const ratios = [
    { id: '1:1', width: 1024, height: 1024 },
    { id: '16:9', width: 1152, height: 648 },
  ]
  assert.deepEqual(
    logic.intentFormPatch({ prompt: '雨夜街景', ratioId: '16:9', styleId: 'cyberpunk' }, ratios),
    { prompt: '雨夜街景', width: 1152, height: 648, styleId: 'cyberpunk' },
  )
  // 没有匹配的比例时不覆盖表单尺寸。
  assert.deepEqual(logic.intentFormPatch({ prompt: 'x', ratioId: '' }, ratios), { prompt: 'x' })

  const capsules = [{ id: 'cyberpunk', suffix: 'cyberpunk neon city' }]
  assert.equal(logic.intentPrompt({ prompt: '雨夜街景', styleId: 'cyberpunk' }, capsules), '雨夜街景, cyberpunk neon city')
  assert.equal(logic.intentPrompt({ prompt: '雨夜街景', styleId: '' }, capsules), '雨夜街景')
  assert.equal(logic.intentPrompt({ prompt: '', styleId: 'cyberpunk' }, capsules), '')
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
  const lines = Array.from({ length: 80 }, (_, index) => `log-${index}`)
  const text = buildDiagnostics(t, {
    version: '0.4.1',
    session,
    probe: { cli: { present: true }, auth: { ok: true }, quota: { available: false }, notes: ['配额接口超时'] },
    probeLastGood: { quota: { available: true, usedHours: 3, totalHours: 30 } },
    probeLastGoodAt: '2026-11-10T10:00:00.000Z',
    queue: { running: 'job-1', pending: 2 },
    lastJob: { id: 'job-0', status: 'done', seconds: 6.2 },
    lines,
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
    'logs (last 60/80)',
  ]) {
    assert.ok(text.includes(needle), `诊断文本应包含：${needle}`)
  }
  assert.ok(!text.includes('super-secret-token'), '诊断文本不得包含 token')
  assert.ok(!text.includes('token:'), '会话里的 token 字段应被剔除')

  const tail = text.split('\n').filter((line) => /^log-\d+$/.test(line))
  assert.equal(tail.length, 60, '只附带最近 60 行日志')
  assert.ok(tail.includes('log-79'))
  assert.ok(!tail.includes('log-19'), '更早的日志被截断')

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

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1