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
import { STYLE_CAPSULES } from '../src/studio/capsules.js'
import { LIMITS } from '../shared/contract.js'

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
  for (const code of ['session_ended', 'stopped']) assert.equal(logic.guidanceKindOf(code), 'sleep', code)
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

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) process.exitCode = 1