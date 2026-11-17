/**
 * Kaggle 登录与访问方式渲染测试（不需要浏览器）。
 *
 * 覆盖：直连登录轮询 / 取消 / 失败 / manual 粘贴码 / 超时与网络失败 / 指引卡全部分支 /
 * 设置抽屉访问方式开关 / 顶栏展示 / CLI 与旧宿主兼容。
 *
 * 运行：node test/check-client-kaggle.mjs
 */

import assert from 'node:assert/strict'
import { KAGGLE_LOGIN } from '../shared/contract.js'
import { createCheckRunner } from './helpers/check.mjs'
import { assertStructure, collectText, countByClass, findNodes, createTestClient } from './helpers/render.mjs'
import {
  NOW, at, preset, historyItem, readyState, LOGIN_PATH, studioResponses,
  settingsView, mountSettingsDrawer, idleShutdownSession, mountTopBarExpanded,
} from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

// ── Kaggle 直连登录（M2：直连模式开关 / 内置 OAuth 登录轮询 / manual 粘贴码 / 超时） ──

/** 构造一个完整的登录视图（形状与契约 LoginView 一致）。 */
const loginView = (patch = {}) => ({
  state: 'idle',
  mode: 'browser',
  url: null,
  message: null,
  username: null,
  startedAt: null,
  finishedAt: null,
  ...patch,
})

const loginRequests = (client, method) => client.requests
  .filter((item) => item.path === LOGIN_PATH && item.method === method)

/**
 * 挂载 useKaggleLogin 的最小 Harness：记录最新 hook 值、toast 与 onDone 回调。
 * responses 与 failures 都是可变对象：轮询类场景在两次请求之间直接改写它们，
 * 模拟宿主登录态变化或网络中断。
 */
async function mountKaggleLogin(options = {}) {
  const responses = options.responses ?? {}
  const failures = options.failures ?? {}
  const client = await createTestClient({ now: NOW, responses, failures, testBuild: true })
  const React = client.react
  const { useKaggleLogin } = client.hooks
  assert.equal(typeof useKaggleLogin, 'function', '测试产物应通过 __test.hooks 暴露 useKaggleLogin')
  const latest = { hook: null }
  const toasts = []
  const done = []
  function Harness(props) {
    const hook = useKaggleLogin({
      t: props.t,
      ui: { showToast: (text) => toasts.push(text) },
      onDone: (view) => done.push(view),
    })
    props.latest.hook = hook
    return React.createElement(
      'div',
      { className: 'ofs-login-harness' },
      React.createElement('span', { className: 'ofs-login-state' }, `${hook.login.state}|${hook.login.mode}`),
      React.createElement('span', { className: 'ofs-login-error' }, hook.errorKey || ''),
      React.createElement('span', { className: 'ofs-login-code-error' }, hook.codeErrorKey || ''),
    )
  }
  try {
    await client.mountRaw(Harness, { latest, t: client.internals.i18n.fallbackTranslate('zh') })
    await client.settle()
    return { client, latest, toasts, done, responses, failures }
  } catch (error) {
    client.unmount()
    throw error
  }
}
await check('渲染：直连登录轮询到 done 后回调 onDone（useKaggleLogin）', async () => {
  const responses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending', startedAt: at(0) }) } }
  const mounted = await mountKaggleLogin({ responses })
  try {
    await mounted.latest.hook.start()
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(mounted.latest.hook.login.state, 'pending', '发起后进入等待授权')
    assert.equal(mounted.latest.hook.pending, true, '等待授权期间视为进行中')
    assert.deepEqual(loginRequests(mounted.client, 'POST').map((item) => item.body), [{ action: 'start' }])
    assert.equal(loginRequests(mounted.client, 'GET').length, 0, '发起后按契约 pollMs 延后轮询，不立刻请求')
    // 页面隐藏：停止轮询并清理定时器；回到前台继续等待。
    assert.ok(mounted.client.timers.size > 0, '等待授权期间应有轮询定时器')
    mounted.client.setHidden(true)
    assert.equal(mounted.client.timers.size, 0, '页面隐藏时应清理轮询定时器')
    mounted.client.setHidden(false)
    assert.ok(mounted.client.timers.size > 0, '回到前台应恢复轮询')
    // 第一次轮询仍是 pending：继续等。
    await mounted.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await mounted.client.rerenderRaw()
    assert.equal(loginRequests(mounted.client, 'GET').length, 1)
    assert.equal(mounted.latest.hook.login.state, 'pending')
    // 第二次轮询拿到 done：停止轮询并回调 onDone（组合层据此重跑 probe）。
    responses[LOGIN_PATH] = {
      ok: true,
      login: loginView({ state: 'done', username: 'alice', startedAt: at(0), finishedAt: at(20) }),
    }
    await mounted.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(mounted.latest.hook.login.state, 'done')
    assert.equal(mounted.latest.hook.login.username, 'alice')
    assert.equal(mounted.done.length, 1, 'done 只回调一次')
    assert.equal(mounted.done[0].state, 'done')
    assert.ok(mounted.toasts.includes('Kaggle 登录成功'), `done 应给成功提示：${mounted.toasts.join(' / ')}`)
    // 终态后不再轮询。
    const before = loginRequests(mounted.client, 'GET').length
    await mounted.client.advanceTimers(KAGGLE_LOGIN.pollMs * 4)
    assert.equal(loginRequests(mounted.client, 'GET').length, before, 'done 之后应停止轮询')
  } finally {
    mounted.client.unmount()
  }
  assert.equal(mounted.client.timers.size, 0, '卸载后应清理轮询定时器')
})

await check('渲染：直连登录取消与失败分支（useKaggleLogin）', async () => {
  const responses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } }
  const cancelled = await mountKaggleLogin({ responses })
  try {
    await cancelled.latest.hook.start()
    await cancelled.client.settle()
    await cancelled.client.rerenderRaw()
    await cancelled.latest.hook.cancel()
    await cancelled.client.settle()
    await cancelled.client.rerenderRaw()
    assert.equal(cancelled.latest.hook.login.state, 'cancelled', '取消后回到可重新发起')
    assert.deepEqual(loginRequests(cancelled.client, 'POST').map((item) => item.body), [{ action: 'start' }, { action: 'cancel' }], '取消要 POST action=cancel')
    const beforeCancel = cancelled.client.requests.length
    await cancelled.client.advanceTimers(KAGGLE_LOGIN.pollMs * 3)
    assert.equal(cancelled.client.requests.length, beforeCancel, '取消后不再轮询')
  } finally {
    cancelled.client.unmount()
  }
  // 轮询拿到 failed：按 message 归类原因并停止轮询。
  const failedResponses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } }
  const failed = await mountKaggleLogin({ responses: failedResponses })
  try {
    await failed.latest.hook.start()
    await failed.client.settle()
    failedResponses[LOGIN_PATH] = { ok: true, login: loginView({ state: 'failed', message: 'state mismatch' }) }
    await failed.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await failed.client.settle()
    await failed.client.rerenderRaw()
    assert.equal(failed.latest.hook.login.state, 'failed')
    assert.equal(failed.latest.hook.errorKey, 'studio.guidance.auth.reason.state')
    const beforeFailed = loginRequests(failed.client, 'GET').length
    await failed.client.advanceTimers(KAGGLE_LOGIN.pollMs * 3)
    assert.equal(loginRequests(failed.client, 'GET').length, beforeFailed, 'failed 之后应停止轮询')
  } finally {
    failed.client.unmount()
  }
})

await check('渲染：直连登录 manual 模式粘贴授权码（useKaggleLogin）', async () => {
  const url = 'https://www.kaggle.com/oauth/authorize?code_challenge=abc'
  const responses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending', mode: 'manual', url }) } }
  const mounted = await mountKaggleLogin({ responses })
  try {
    await mounted.latest.hook.start()
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(mounted.latest.hook.login.mode, 'manual')
    // 非法授权码：只给本地校验提示，不发请求。
    const accepted = await mounted.latest.hook.submit('abc')
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(accepted, false)
    assert.equal(mounted.latest.hook.codeErrorKey, 'studio.guidance.auth.codeTooShort')
    assert.equal(loginRequests(mounted.client, 'POST').filter((item) => item.body.action === 'submit-code').length, 0, '本地校验不通过不发请求')
    // 合法授权码：清洗后提交；宿主回 done 即收敛。
    responses[LOGIN_PATH] = { ok: true, login: loginView({ state: 'done', username: 'bob' }) }
    const ok = await mounted.latest.hook.submit('  code=abcd-efgh-1234  ')
    await mounted.client.settle()
    await mounted.client.rerenderRaw()
    assert.equal(ok, true)
    const submits = loginRequests(mounted.client, 'POST').filter((item) => item.body.action === 'submit-code')
    assert.deepEqual(submits[0].body, { action: 'submit-code', code: 'abcd-efgh-1234' }, '授权码去空白与 code= 前缀后提交')
    assert.equal(mounted.latest.hook.login.state, 'done')
    assert.equal(mounted.done.length, 1)
  } finally {
    mounted.client.unmount()
  }
})

await check('渲染：直连登录超时 / 网络失败一次提示 / 接口不可用（useKaggleLogin）', async () => {
  // 宿主一直 pending：客户端按契约 timeoutMs 兜底，收敛为可重试的失败态。
  const pendingResponses = { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } }
  const timeout = await mountKaggleLogin({ responses: pendingResponses })
  try {
    await timeout.latest.hook.start()
    await timeout.client.settle()
    await timeout.client.advanceTimers(KAGGLE_LOGIN.timeoutMs + KAGGLE_LOGIN.pollMs)
    await timeout.client.settle()
    await timeout.client.rerenderRaw()
    assert.equal(timeout.latest.hook.login.state, 'failed', '等待超时应收敛为 failed')
    assert.equal(timeout.latest.hook.errorKey, 'studio.guidance.auth.reason.timeout')
    const timeoutGets = loginRequests(timeout.client, 'GET').length
    assert.ok(timeoutGets > 0, '超时前应实际轮询过')
    await timeout.client.advanceTimers(KAGGLE_LOGIN.pollMs * 3)
    assert.equal(loginRequests(timeout.client, 'GET').length, timeoutGets, '超时后停止轮询')
  } finally {
    timeout.client.unmount()
  }
  // 轮询时网络失败：只提示一次并停止轮询，不做无限重试。
  const failures = {}
  const network = await mountKaggleLogin({
    responses: { [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending' }) } },
    failures,
  })
  try {
    await network.latest.hook.start()
    await network.client.settle()
    failures[LOGIN_PATH] = 'Failed to fetch'
    await network.client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await network.client.settle()
    await network.client.rerenderRaw()
    assert.equal(network.latest.hook.login.state, 'failed')
    assert.equal(network.latest.hook.errorKey, 'studio.guidance.auth.reason.network')
    assert.equal(network.toasts.filter((text) => text === '网络连接失败，登录没有完成。').length, 1, '网络失败只提示一次')
    const networkGets = loginRequests(network.client, 'GET').length
    await network.client.advanceTimers(KAGGLE_LOGIN.pollMs * 4)
    assert.equal(loginRequests(network.client, 'GET').length, networkGets, '网络失败不无限重试')
  } finally {
    network.client.unmount()
  }
  // 旧宿主没有登录接口（404）：按「接口不可用」提示一次，不轮询、不抛异常。
  const missing = await mountKaggleLogin({ responses: {} })
  try {
    await missing.latest.hook.start()
    await missing.client.settle()
    await missing.client.rerenderRaw()
    assert.equal(missing.latest.hook.login.state, 'failed')
    assert.equal(missing.latest.hook.errorKey, 'studio.guidance.auth.reason.unavailable')
    assert.equal(loginRequests(missing.client, 'GET').length, 0, '接口不可用时不轮询')
  } finally {
    missing.client.unmount()
  }
})

await check('渲染：直连模式指引卡（登录 / 等待 / manual 粘贴码 / 失败 / 取消）', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const t = client.internals.i18n.fallbackTranslate('zh')
  const manualUrl = 'https://www.kaggle.com/oauth/authorize?code_challenge=abc'
  const makeProps = (overrides = {}, options = {}) => {
    const calls = { start: 0, cancel: 0, probe: 0, submit: [], copy: [] }
    const login = {
      login: { ...loginView(), ...(overrides.login ?? {}) },
      pending: Boolean(overrides.pending),
      busy: Boolean(overrides.busy),
      errorKey: overrides.errorKey ?? '',
      codeErrorKey: overrides.codeErrorKey ?? '',
      start: () => { calls.start += 1 },
      cancel: () => { calls.cancel += 1 },
      submit: (value) => { calls.submit.push(value) },
      reset: () => {},
    }
    return {
      calls,
      props: {
        t,
        guidance: { kind: options.kind ?? 'auth', detail: options.detail ?? '', dismiss: options.dismiss ?? null },
        actions: { resetToSafe: () => {}, retryFocusedJob: () => {} },
        compute: {
          kaggleTransport: 'direct',
          kaggleLogin: login,
          session: null,
          probe: null,
          startSession: () => {},
          runProbe: () => { calls.probe += 1 },
          retryHost: () => {},
        },
        ui: {
          openLogs: () => {},
          copyText: (value, okKey) => calls.copy.push({ value, okKey }),
          copyInstallCommand: () => {},
        },
      },
    }
  }
  try {
    // 1) 未登录：主操作是登录，CLI 相关命令与提示一律不出现。
    const idle = makeProps({}, { detail: '未找到 kaggle 凭据文件' })
    let tree = await client.mountRaw(client.components.GuidanceCard, idle.props)
    let text = collectText(tree).join(' | ')
    for (const needle of ['Kaggle 账号未登录或凭据不可用', '在浏览器中登录 Kaggle', '未找到 kaggle 凭据文件', '%USERPROFILE%\\.kaggle\\credentials.json']) {
      assert.ok(text.includes(needle), `[direct-login] 缺少文案：${needle}（实际：${text}）`)
    }
    for (const banned of ['kaggle auth login', '复制登录命令', 'pip install -U kaggle', '复制安装命令']) {
      assert.ok(!text.includes(banned), `[direct-login] 直连模式不应出现 CLI 文案：${banned}`)
    }
    assert.equal(countByClass(tree, 'ofs-guidance'), 1)
    assert.equal(countByClass(tree, 'ofs-guidance-actions'), 1)
    assert.equal(countByClass(tree, 'ofs-guidance-manual'), 0, '未进入 manual 等待时不显示授权码区')
    const loginButton = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('在浏览器中登录 Kaggle') )[0]
    assert.ok(loginButton, '缺少登录主操作')
    loginButton.props.onClick()
    assert.equal(idle.calls.start, 1, '登录主操作应调用 start')
    // 2) cli 卡片在直连模式下同样走登录卡，不再提示安装 CLI。
    const cli = makeProps({}, { kind: 'cli' })
    tree = await client.mountRaw(client.components.GuidanceCard, cli.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('在浏览器中登录 Kaggle'), '[direct-login] cli 卡片应改为登录主操作')
    assert.ok(!text.includes('pip install -U kaggle'), '[direct-login] 直连模式不提示安装 CLI')
    // 3) 等待浏览器授权：等待文案 + 取消。
    const pendingBrowser = makeProps({ login: { state: 'pending', mode: 'browser' }, pending: true })
    tree = await client.mountRaw(client.components.GuidanceCard, pendingBrowser.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('正在等待浏览器完成授权…'), `[direct-login] 缺少等待文案：${text}`)
    const cancelButton = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('取消登录') )[0]
    assert.ok(cancelButton, '缺少取消登录按钮')
    cancelButton.props.onClick()
    assert.equal(pendingBrowser.calls.cancel, 1)
    assert.equal(countByClass(tree, 'ofs-guidance-code-input'), 0, 'browser 模式不显示授权码输入框')
    // 4) manual 模式：可复制的授权链接 + 授权码输入框，空码时提交禁用。
    const pendingManual = makeProps({ login: { state: 'pending', mode: 'manual', url: manualUrl }, pending: true })
    tree = await client.mountRaw(client.components.GuidanceCard, pendingManual.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes(manualUrl), '[direct-login] manual 模式应展示授权链接')
    assert.ok(text.includes('浏览器没有自动打开'), '[direct-login] manual 模式应说明授权链接用途')
    const copyUrl = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('复制授权链接') )[0]
    copyUrl.props.onClick()
    assert.deepEqual(pendingManual.calls.copy, [{ value: manualUrl, okKey: 'studio.guidance.auth.urlCopied' }])
    let codeInput = findNodes(
      tree,
      (node) => node.type === 'input' && String(node.props?.className).includes('ofs-guidance-code-input'),
    )[0]
    assert.ok(codeInput, 'manual 模式缺少授权码输入框')
    assert.equal(codeInput.props.value, '')
    assert.equal(codeInput.props.placeholder, '粘贴浏览器中显示的授权码')
    let submitButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('提交授权码'),
    )[0]
    assert.ok(submitButton)
    assert.equal(submitButton.props.disabled, true, '空授权码时提交应禁用')
    // 输入授权码后提交可用，点击把输入值原样交给 submit（清洗在 hook / 逻辑层）。
    codeInput.props.onChange({ target: { value: ' abcd-efgh ' } })
    tree = await client.rerenderRaw()
    codeInput = findNodes(
      tree,
      (node) => node.type === 'input' && String(node.props?.className).includes('ofs-guidance-code-input'),
    )[0]
    assert.equal(codeInput.props.value, ' abcd-efgh ')
    submitButton = findNodes(
      tree,
      (node) => node.type === 'button' && collectText(node).join('').includes('提交授权码'),
    )[0]
    assert.equal(submitButton.props.disabled, false, '有授权码后提交应可用')
    submitButton.props.onClick()
    assert.deepEqual(pendingManual.calls.submit, [' abcd-efgh '])
    // 5) 失败：展示归类后的原因并可重新发起。
    const failed = makeProps({
      login: { state: 'failed', message: 'state mismatch' },
      errorKey: 'studio.guidance.auth.reason.state',
    })
    tree = await client.mountRaw(client.components.GuidanceCard, failed.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('登录失败：授权回调校验失败，请重新发起登录。'), `[direct-login] 缺少失败原因：${text}`)
    const retryButton = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('重新发起登录') )[0]
    assert.ok(retryButton, '失败后应可重新发起')
    retryButton.props.onClick()
    assert.equal(failed.calls.start, 1)
    // 6) 取消：回到可重新发起。
    const cancelled = makeProps({ login: { state: 'cancelled' } })
    tree = await client.mountRaw(client.components.GuidanceCard, cancelled.props)
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('已取消登录，可重新发起。'), '[direct-login] 取消后应说明可重新发起')
    assert.equal(findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('在浏览器中登录 Kaggle')).length, 1, '取消后应能重新发起登录')
    // 7) 授权码本地校验错误提示。
    const codeError = makeProps({
      login: { state: 'pending', mode: 'manual', url: manualUrl },
      pending: true,
      codeErrorKey: 'studio.guidance.auth.codeFormat',
    })
    tree = await client.mountRaw(client.components.GuidanceCard, codeError.props)
    assert.ok(collectText(tree).join(' | ').includes('授权码包含无法识别的字符'), '应展示授权码校验错误')
  } finally {
    client.unmount()
  }
})

await check('渲染：设置抽屉 Kaggle 访问方式开关与保存请求体', async () => {
  const transportView = { ...settingsView, kaggleTransport: 'direct' }
  const mounted = await mountSettingsDrawer(
    { defaultAdvancedOpen: true },
    { view: transportView, savedView: { ...transportView, kaggleTransport: 'cli' } },
  )
  try {
    let text = collectText(mounted.tree).join(' | ')
    for (const needle of ['Kaggle 访问方式', '直连 Kaggle（默认，免安装 CLI）', '本机 kaggle CLI（兼容）']) {
      assert.ok(text.includes(needle), `[settings-transport] 缺少文案：${needle}（实际：${text}）`)
    }
    assert.ok(text.includes('直连模式不需要安装 kaggle CLI'), '默认选中直连时显示免安装说明')
    let radios = findNodes(
      mounted.tree,
      (node) => node.type === 'input' && node.props?.name === 'ofs-kaggle-transport',
    )
    assert.deepEqual(radios.map((node) => node.props.value), ['direct', 'cli'], '访问方式取值来自契约白名单')
    assert.deepEqual(radios.map((node) => node.props.checked), [true, false], '默认选中直连')
    // 切到兼容的 CLI 模式：免安装说明消失，保存按钮可用。
    radios[1].props.onChange()
    const tree = await mounted.client.rerenderRaw()
    text = collectText(tree).join(' | ')
    assert.ok(!text.includes('直连模式不需要安装 kaggle CLI'), '切到 CLI 后不再显示直连说明')
    const saveButton = findNodes(tree, (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save') )[0]
    assert.equal(saveButton.props.disabled, false, '切换访问方式后保存可用')
    saveButton.props.onClick()
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve()
      await new Promise((resolvePromise) => setImmediate(resolvePromise))
    }
    const posted = mounted.calls.filter((call) => call.method === 'POST')
    assert.equal(posted.length, 1, '只发一次保存请求')
    assert.deepEqual(posted[0].body, { kaggleTransport: 'cli' }, '只提交访问方式补丁')
  } finally {
    mounted.client.unmount()
  }
  // 旧宿主视图缺 kaggleTransport：仍按 CLI 渲染（老宿主没有登录路由），没有改动时保存禁用。
  const legacy = await mountSettingsDrawer({ defaultAdvancedOpen: true })
  try {
    const radios = findNodes(legacy.tree, (node) => node.type === 'input' && node.props?.name === 'ofs-kaggle-transport')
    assert.deepEqual(radios.map((node) => node.props.checked), [false, true], '旧宿主缺字段时按 CLI 选中')
    assert.ok(!collectText(legacy.tree).join(' | ').includes('直连模式不需要安装 kaggle CLI'))
    const saveButton = findNodes(legacy.tree, (node) => node.type === 'button' && String(node.props?.className).includes('ofs-settings-save') )[0]
    assert.equal(saveButton.props.disabled, true, '旧视图没有改动时保存禁用')
  } finally {
    legacy.client.unmount()
  }
})

await check('渲染：直连模式顶栏访问方式展示', async () => {
  const directProbe = {
    cli: { present: true, direct: true },
    auth: { ok: false },
    quota: { available: false },
    notes: [],
  }
  const direct = await mountTopBarExpanded(idleShutdownSession, { kaggleTransport: 'direct', probe: directProbe })
  try {
    const plain = collectText(direct.tree).join('')
    assert.ok(plain.includes('直连 · 直连未登录'), `[topbar-direct] 缺少直连状态：${plain}`)
    assert.ok(!plain.includes('命令行'), '[topbar-direct] 直连模式不应再显示命令行')
  } finally {
    direct.client.unmount()
  }
  const cliProbe = {
    cli: { present: true },
    auth: { ok: true },
    quota: { available: true, usedHours: 1, totalHours: 30 },
    notes: [],
  }
  const cli = await mountTopBarExpanded(readyState.session, { probe: cliProbe })
  try {
    const plain = collectText(cli.tree).join('')
    assert.ok(plain.includes('命令行 · 正常'), `[topbar-cli] CLI 模式展示保持不变：${plain}`)
    assert.ok(!plain.includes('直连'), '[topbar-cli] CLI 模式不应出现直连文案')
  } finally {
    cli.client.unmount()
  }
})

await check('渲染：工作台直连模式 auth 指引卡发起登录并在 done 后刷新环境', async () => {
  const directState = {
    ...readyState,
    kaggleTransport: 'direct',
    session: { state: 'error', error: { code: 'auth_required', message: '未找到 kaggle 凭据文件' } },
    probe: {
      cli: { present: true, direct: true },
      auth: { ok: false },
      quota: { available: false },
      notes: ['请先登录 Kaggle'],
    },
  }
  const okState = {
    ...directState,
    session: readyState.session,
    probe: {
      cli: { present: true, direct: true },
      auth: { ok: true },
      quota: { available: true, usedHours: 1, totalHours: 30 },
      notes: [],
    },
  }
  const manualUrl = 'https://www.kaggle.com/oauth/authorize?x=1'
  const responses = {
    '/imagen-api/state': directState,
    '/imagen-api/history': { items: [] },
    '/imagen-api/library': { favorites: [], deleted: [] },
    [LOGIN_PATH]: { ok: true, login: loginView({ state: 'pending', mode: 'manual', url: manualUrl }) },
    '/imagen-api/probe': { ok: true, probe: okState.probe },
  }
  const client = await createTestClient({ now: NOW, responses, testBuild: true })
  try {
    let tree = await client.mountRaw(client.components.Studio, {})
    let text = collectText(tree).join(' | ')
    assert.ok(text.includes('在浏览器中登录 Kaggle'), `[studio-direct] 直连模式应给登录主操作：${text}`)
    assert.ok(!text.includes('复制登录命令'), '[studio-direct] 直连模式不应出现 CLI 登录命令')
    const loginButton = findNodes(tree, (node) => node.type === 'button' && collectText(node).join('').includes('在浏览器中登录 Kaggle') )[0]
    assert.ok(loginButton, '缺少登录按钮')
    loginButton.props.onClick()
    await client.settle()
    tree = await client.rerenderRaw()
    text = collectText(tree).join(' | ')
    assert.ok(text.includes('正在等待浏览器完成授权…'), '[studio-direct] 点击后应进入等待授权')
    assert.ok(text.includes(manualUrl), '[studio-direct] manual 模式应展示授权链接')
    assert.deepEqual(client.requests.filter((item) => item.path === LOGIN_PATH && item.method === 'POST').map((item) => item.body), [{ action: 'start' }], '发起登录走契约动作形状')
    // 宿主完成授权：轮询到 done 后重跑 probe，账号状态随之刷新。
    responses[LOGIN_PATH] = { ok: true, login: loginView({ state: 'done', username: 'alice' }) }
    responses['/imagen-api/state'] = okState
    await client.advanceTimers(KAGGLE_LOGIN.pollMs)
    await client.settle()
    await client.settle()
    tree = await client.rerenderRaw()
    assert.ok(
      client.requests.some((item) => item.path === '/imagen-api/probe' && item.method === 'POST'),
      `[studio-direct] 登录成功后应重跑 probe，实际请求：${client.requests.map((item) => `${item.method} ${item.path}`).join(', ')}`,
    )
    text = collectText(tree).join(' | ')
    assert.ok(!text.includes('在浏览器中登录 Kaggle'), '[studio-direct] 登录成功且探测通过后应撤掉登录卡')
  } finally {
    client.unmount()
  }
})

await check('渲染：CLI 模式与旧宿主保持原有指引卡行为', async () => {
  const cliState = {
    ...readyState,
    kaggleTransport: 'cli',
    session: { state: 'error', error: { code: 'auth_required', message: '未找到 kaggle 凭据文件' } },
    probe: { cli: { present: true }, auth: { ok: false }, quota: { available: false }, notes: [] },
  }
  const cli = await createTestClient({ now: NOW, responses: studioResponses(cliState, { items: [] }), testBuild: true })
  try {
    const tree = await cli.mountRaw(cli.components.Studio, {})
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('kaggle auth login'), '[cli-mode] 应保留 CLI 登录命令')
    assert.ok(text.includes('复制登录命令'), '[cli-mode] 应保留复制登录命令动作')
    assert.ok(!text.includes('在浏览器中登录 Kaggle'), '[cli-mode] 不应出现内置登录主操作')
    assert.ok(!cli.requests.some((item) => item.path === LOGIN_PATH), '[cli-mode] CLI 模式不应请求登录接口')
  } finally {
    cli.unmount()
  }
  // 0.8.x 宿主完全没有 kaggleTransport 字段：按 CLI 渲染，不报错、不请求登录接口。
  const legacy = await createTestClient({
    now: NOW,
    responses: {
      '/imagen-api/state': {
        ...readyState,
        session: { state: 'error', error: { code: 'cli_missing', message: '未安装 kaggle CLI' } },
        probe: { cli: { present: false }, auth: { ok: false }, quota: { available: false }, notes: [] },
      },
      '/imagen-api/history': { items: [] },
      '/imagen-api/library': { favorites: [], deleted: [] },
    },
    testBuild: true,
  })
  try {
    const tree = await legacy.mountRaw(legacy.components.Studio, {})
    const text = collectText(tree).join(' | ')
    assert.ok(text.includes('pip install -U kaggle'), '[legacy-host] 缺 kaggleTransport 时按 CLI 渲染安装命令')
    assert.ok(text.includes('复制安装命令'), '[legacy-host] 保留 CLI 安装动作')
    assert.ok(!legacy.requests.some((item) => item.path === LOGIN_PATH), '[legacy-host] 不应请求登录接口')
  } finally {
    legacy.unmount()
  }
})

summary()
