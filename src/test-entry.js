/**
 * 测试专用入口：在发布产物之外额外暴露内部实现，供渲染测试挂载组件。
 *
 * 这个文件只在 `node build.mjs --test` 时打包成 test/.build/client.test.js，
 * 发布产物 client.js 由 src/index.js 打包，不含任何测试出口。
 */

export { inject, apply } from './index.js'

import * as dict from './dict/index.js'
import * as theme from './theme.js'
import * as constants from './constants.js'
import * as logic from './logic/index.js'
import * as runtime from './runtime.js'
import * as api from './api.js'
import * as i18n from './i18n.js'
import { React, h } from './runtime.js'
import { StatusChip } from './components/StatusChip.js'
import { Studio } from './studio/Studio.jsx'
import { StudioIcon } from './studio/StudioIcon.jsx'
import { Gallery } from './studio/Gallery.jsx'
import { Filmstrip } from './studio/Filmstrip.jsx'
import { Rail } from './studio/Rail.jsx'
import { ChatPanel } from './studio/ChatPanel.jsx'
import { Stage } from './studio/Stage.jsx'
import { TopBar } from './studio/TopBar.jsx'

/**
 * 测试替身自检探针：只在测试 bundle 里暴露，生产入口 src/index.js 不引用本文件。
 *
 * 一次挂载内验证四件事：
 *   - useLayoutEffect 里 dispatch 一次，count 从 0 变 1（dispatch 会触发下一轮渲染）；
 *   - doubled 依赖 count，重渲染后应为 2（useMemo 随依赖变化重算）；
 *   - memoStamp 用空依赖，两轮渲染应保持 1（useMemo 跨渲染复用）；
 *   - ProbeChild 用 memo 包装，验证 serializeTree 能把包装组件展开。
 */
let probeMemoRuns = 0

function ProbeChildBase(props) {
  return h('span', { className: 'ofs-harness-child' }, props.label)
}
const ProbeChild = React.memo(ProbeChildBase)

function HarnessProbeBase() {
  const [count, dispatch] = React.useReducer((state, action) => (action === 'inc' ? state + 1 : state), 0)
  const doubled = React.useMemo(() => count * 2, [count])
  const memoStamp = React.useMemo(() => {
    probeMemoRuns += 1
    return probeMemoRuns
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

export const HarnessProbe = React.memo(HarnessProbeBase)

export const __test = {
  dict,
  theme,
  constants,
  logic,
  runtime,
  api,
  i18n,
  components: {
    StatusChip,
    Studio,
    StudioIcon,
    Gallery,
    Filmstrip,
    Rail,
    ChatPanel,
    Stage,
    TopBar,
    HarnessProbe,
  },
}