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
import { styles, token } from '../src/theme.js'
import { ACTIVE_STATUS, TRANSIENT_SESSION, PHASE_STATE, NS } from '../src/constants.js'

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
  assert.equal(logic.parseSeed('4294967296'), 4294967295, '上限钳到 32 位')
})

await check('时长格式化', () => {
  assert.equal(logic.formatDuration(t, 9500), '9.5秒')
  assert.equal(logic.formatDuration(t, 30000), '30秒')
  assert.equal(logic.formatDuration(t, 62000), '1分 2秒')
  assert.equal(logic.formatDuration(t, 120000), '2分')
  assert.equal(logic.formatDuration(t, NaN), '—')
  assert.equal(logic.formatSeconds(t, 6.2), '6.2秒')
  assert.equal(logic.formatSeconds(t, 11.6), '12秒')
  assert.equal(logic.formatSeconds(te, 6.2), '6.2s')
})

await check('任务耗时与焦点任务挑选', () => {
  const done = { id: 'a', status: 'done', seconds: 6.2 }
  assert.equal(logic.jobElapsed(done, NOW), 6200)
  assert.equal(logic.jobElapsed({ id: 'b', status: 'running', startedAt: at(-4) }, NOW), 4000)
  assert.equal(logic.jobElapsed(null, NOW), null)

  const state = {
    jobs: [
      { id: 'job-2', status: 'queued' },
      { id: 'job-1', status: 'done' },
    ],
    lastJob: { id: 'job-0', status: 'done' },
  }
  assert.equal(logic.activeJobOf(state).id, 'job-2')
  assert.deepEqual(logic.stateJobs({ jobs: [null, { noId: true }, { id: 'x' }] }).map((job) => job.id), ['x'])
  assert.equal(logic.pickFocusedJob(state, 'job-1')?.id, 'job-1')
  assert.equal(logic.pickFocusedJob(state, 'job-0')?.id, 'job-0')
  assert.equal(logic.pickFocusedJob(state, 'missing'), null)
  assert.equal(logic.pickFocusedJob(state, ''), null)
})

await check('阶段提示映射到会话态', () => {
  assert.equal(logic.phaseHint(t, { state: 'provisioning', phase: 'queue' }), zh['session.hint.provisioning'])
  assert.equal(logic.phaseHint(t, { state: 'provisioning', phase: 'push' }), zh['session.hint.provisioning'])
  assert.equal(logic.phaseHint(t, { state: 'connecting', phase: 'tunnel' }), zh['session.hint.connecting'])
  assert.equal(logic.phaseHint(t, { state: 'warming', phase: 'warm' }), zh['session.hint.warming'])
  assert.equal(logic.phaseHint(t, { state: 'stopping' }), zh['session.hint.stopping'])
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

await check('会话视图派生', () => {
  const absent = logic.buildSessionView(t, { session: null, probe: null, defaultPreset: '', sessionBusy: '', probeBusy: false })
  assert.equal(absent.state, 'absent')
  assert.equal(absent.headline, t('session.state.absent'))
  assert.equal(absent.canStart, true)
  assert.equal(absent.canStop, false)
  assert.equal(absent.accountLabel, t('value.unknown'))
  assert.equal(absent.quotaLabel, t('value.unknown'))
  assert.equal(absent.defaultModel, '—')
  assert.equal(absent.transient, false)

  const queue = logic.buildSessionView(t, {
    session: { state: 'provisioning', phase: 'queue', detail: 'provisioning: waiting for container' },
    probe: { auth: { ok: true }, quota: { available: true, usedHours: 3, totalHours: 30 } },
    defaultPreset: 'sdxl-lightning',
    sessionBusy: '',
    probeBusy: false,
  })
  assert.equal(queue.headline, t('session.state.provisioning'))
  assert.equal(queue.hint, zh['session.hint.provisioning'], '有本地提示时不展示远端 detail')
  assert.equal(queue.note, queue.hint)
  assert.equal(queue.transient, true)
  assert.equal(queue.canStop, true)
  assert.equal(queue.accountLabel, t('value.ok'))
  assert.equal(queue.quotaLabel, '3 / 30 h')
  assert.equal(queue.chipLabel, t('chip.online'))

  const ended = logic.buildSessionView(t, { session: { state: 'error', error: { code: 'session_ended' } }, probe: null })
  assert.equal(ended.ended, true)
  assert.equal(ended.headline, t('workbench.sessionEnded'))
  assert.equal(ended.stateText, t('session.state.error'), '徽章标题仍用状态名')
  assert.equal(ended.canStart, true, 'session_ended 允许重新启动')

  const warming = logic.buildSessionView(t, { session: { state: 'error', error: { code: 'warming' } }, probe: null })
  assert.equal(warming.warming, true)
  assert.equal(warming.headline, t('session.state.error'))

  const stopping = logic.buildSessionView(t, {
    session: { state: 'stopping', detail: 'stopping session' },
    probe: null,
    sessionBusy: 'stop',
    probeBusy: true,
  })
  assert.equal(stopping.canStop, false)
  assert.equal(stopping.canStart, false, '关机进行中不允许再启动')
  assert.equal(stopping.probing, true)
  assert.equal(stopping.hint, zh['session.hint.stopping'])
  assert.equal(stopping.note, zh['session.hint.stopping'])

  // 未知 phase 回落到会话态的提示；会话态也没有文案时，note 回落到远端 detail。
  assert.equal(
    logic.buildSessionView(t, { session: { state: 'connecting', phase: 'unknown', detail: 'detail text' } }).hint,
    zh['session.hint.connecting'],
  )
  const noHint = logic.buildSessionView(t, { session: { state: 'ready', detail: 'ready detail' } })
  assert.equal(noHint.hint, '')
  assert.equal(noHint.note, 'ready detail')
})

await check('预设信息行派生', () => {
  const preset = {
    id: 'sdxl-lightning',
    params: '3.5B + LoRA',
    license: 'OpenRAIL++',
    licenseKind: 'open',
    gpus: 1,
    downloadGb: 6.78,
    steadySeconds: 6.2,
    tier: 'fast',
  }
  assert.equal(logic.buildPresetView(t, null), null)
  const open = logic.buildPresetView(t, preset)
  assert.equal(open.licenseLabel, 'OpenRAIL++')
  assert.equal(open.tierLabel, t('models.tier.fast'))
  assert.match(open.detail, /单张耗时 6\.2秒$/)

  const pending = logic.buildPresetView(t, {
    ...preset,
    license: '非商用研究许可',
    licenseKind: 'restricted',
    tier: 'pending',
    steadySeconds: null,
  })
  assert.equal(pending.licenseLabel, t('models.license.restricted'))
  assert.equal(pending.tierLabel, t('models.tier.pending'))
  assert.match(pending.detail, new RegExp(`${t('models.pending')}$`))
})

await check('状态色与常量表一致', () => {
  assert.equal(logic.sessionColor('ready'), token.ok)
  assert.equal(logic.sessionColor('error'), token.error)
  assert.equal(logic.sessionColor('provisioning'), token.warn)
  assert.equal(logic.sessionColor('absent'), token.idle)
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
  assert.equal(localized(t, 'workbench.title'), t('workbench.title'))
})

await check('样式 token 与命名空间自洽', () => {
  assert.equal(NS, 'our-free-imagen')
  assert.ok(styles.headerChip && styles.headerChipText && typeof styles.dot === 'function', '徽章样式应存在')
  for (const [name, value] of Object.entries(token)) {
    assert.match(value, /^var\(--dsw-alias-[\w-]+\)$/, `token.${name} 必须引用宿主 CSS 变量`)
  }
})

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1