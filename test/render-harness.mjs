/**
 * 假 React 自测：校验 test/load-client.mjs 的 hook 语义。
 *
 * 渲染替身坏了，所有渲染断言都会静默失真，所以这条回归独立成文件、只测替身本身，
 * 产品渲染测试里不再出现 HarnessProbe。
 *
 * 运行：node test/render-harness.mjs
 */

import assert from 'node:assert/strict'

import { serializeTree } from './load-client.mjs'
import { createCheckRunner } from './helpers/check.mjs'
import { collectText, countByClass, findNodes, createTestClient } from './helpers/render.mjs'
import { NOW } from './helpers/client-fixtures.mjs'

const { check, summary } = createCheckRunner()

// 测试内探针：校验假 React 替身自身的 hook 语义。替身坏了，上面所有渲染断言都会静默失真，
// 所以这条回归留在测试侧。探针组件不再进入 src/。
await check('渲染：hook 探针（useReducer/useMemo/useLayoutEffect/memo）', async () => {
  const client = await createTestClient({ now: NOW, responses: {}, testBuild: true })
  const React = client.react
  const h = React.createElement
  let memoRuns = 0

  function ProbeChildBase(props) {
    return h('span', { className: 'ofs-harness-child' }, props.label)
  }
  const ProbeChild = React.memo(ProbeChildBase)

  function HarnessProbeBase() {
    const [count, dispatch] = React.useReducer((state, action) => (action === 'inc' ? state + 1 : state), 0)
    const doubled = React.useMemo(() => count * 2, [count])
    const memoStamp = React.useMemo(() => {
      memoRuns += 1
      return memoRuns
    }, [])
    React.useLayoutEffect(() => {
      dispatch('inc')
    }, [])
    return h(
      'div',
      { className: 'ofs-harness-probe' },
      h('span', { className: 'ofs-harness-count' }, String(count)),
      h('span', { className: 'ofs-harness-doubled' }, String(doubled)),
      h('span', { className: 'ofs-harness-memo-stamp' }, String(memoStamp)),
      h(ProbeChild, { label: 'memo-child-ok' }),
      h('button', { type: 'button', className: 'ofs-harness-inc', onClick: () => dispatch('inc') }, 'inc'),
    )
  }
  const HarnessProbe = React.memo(HarnessProbeBase)

  const tree = await client.mountRaw(HarnessProbe, {})
  client.unmount()

  const byClass = (className) => findNodes(
    tree,
    (node) => node.type && node.props && node.props.className === className,
  )[0] || null
  const textOf = (node) => (node ? collectText(node).join('') : '')

  assert.equal(countByClass(tree, 'ofs-harness-probe'), 1, '探针应渲染一个根节点')
  // useReducer + useLayoutEffect：挂载时 dispatch 一次，mount 重新渲染后 count 应为 1。
  assert.equal(textOf(byClass('ofs-harness-count')), '1', 'useReducer dispatch 后应触发重渲染')
  // useMemo：依赖 count 变化后应重算（0 × 2 → 1 × 2）。
  assert.equal(textOf(byClass('ofs-harness-doubled')), '2', 'useMemo 应在依赖变化后重算')
  // useMemo：空依赖必须跨渲染复用，若每轮重算这里会变成 2。
  assert.equal(textOf(byClass('ofs-harness-memo-stamp')), '1', '空依赖 useMemo 应跨重渲染复用')
  // memo：包装组件仍可被 serializeTree 正常展开。
  assert.ok(JSON.stringify(serializeTree(tree)).includes('memo-child-ok'), 'memo 包装的子组件应被序列化展开')
  assert.match(HarnessProbe.displayName || '', /^Memo\(/, 'memo 应保留 displayName')
  // 未实现的 hook 要给出明确报错，而不是 undefined is not a function。
  assert.throws(() => client.react.useContext({}), /未实现 useContext/)
})

summary()
