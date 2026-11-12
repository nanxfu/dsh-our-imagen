/**
 * 测试用客户端加载器。
 *
 * client.js 是 DSH 客户端插件 bundle：单个自包含文件，只能同步 require 平台共享模块，
 * 没有可 import 的导出。所以测试的加载方式是：把构建产物整文件求值，注入假的
 * window / React / fetch / 定时器，再从 `factory(require)` 的返回值里取插件对象。
 *
 * 假 React 支持的 API：
 *   - createElement、jsx / jsxs / jsxDEV、Fragment
 *   - useState、useReducer、useRef、useMemo、useCallback
 *   - useEffect、useLayoutEffect（同一套"渲染后执行 + deps 变化时清理"逻辑）
 *   - memo（只做组件包装，不做 props 相等短路）
 *   - 其余 hook（useContext / useSyncExternalStore / useImperativeHandle / forwardRef 等）
 *     未实现，调用时会抛出带说明的错误，避免调用方只看到 "undefined is not a function"。
 *
 * 已知语义差异（够用即可，不追求与 React 等价）：
 *   - 只有 mount 的顶层组件在 hook 槽位管理下渲染；serializeTree / collectText 展开子组件时
 *     直接当普通函数调用，子组件的 hook 会共享同一组槽位，effect 也不会单独调度。
 *   - 没有调度器、并发与 key 复用；状态变更只把本次 mount 标脏，由 mount 循环重跑到收敛。
 *   - useEffect 与 useLayoutEffect 没有执行时机差别，都在本轮提交后立即执行。
 *   - useReducer 的 dispatch 立即计算并标脏（React 会批处理），因此可以在 effect 里
 *     触发下一轮渲染。
 *   - memo 不做 props 比较，不能用来验证"跳过重渲染"；只保证包装后的类型可被渲染器展开。
 *   - useMemo 的依赖按 Object.is 浅比较；deps 为 undefined 时每次渲染重算。
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const TEST_ARTIFACT = join(ROOT, 'test/.build/client.test.js')

const sameDeps = (previous, next) => {
  if (!previous || !next) return false
  if (previous.length !== next.length) return false
  return previous.every((value, index) => Object.is(value, next[index]))
}

/** 假 React 已实现的 hook / API 清单；报错信息复用它，避免两处漂移。 */
const SUPPORTED_HOOKS = 'useState/useReducer/useRef/useMemo/useCallback/useEffect/useLayoutEffect/memo'

/** 最小 React 替身 + 状态循环。 */
function createRenderer(now) {
  const slots = []
  let slotIndex = 0
  let pendingEffects = []
  let effectDeps = []
  let effectCleanups = []
  let dirty = false
  let unmounted = false

  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
  })

  // JSX 自动运行时：jsx/jsxs 把 children 放在 props 里，这里转成 createElement 调用。
  // Fragment 用一个把 children 原样吐出的函数组件表示。
  const Fragment = (props) => (props && props.children) || null
  const jsx = (type, props) => {
    const { children, ...rest } = props ?? {}
    if (children === undefined) return createElement(type, rest)
    return createElement(type, rest, ...(Array.isArray(children) ? children : [children]))
  }
  const jsxRuntime = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment }

  /** useEffect / useLayoutEffect 共用：本轮渲染后按 deps 决定是否执行。 */
  const registerEffect = (effect, deps) => {
    pendingEffects.push({ effect, deps })
  }

  /** memo：套一层函数组件并保留 displayName；假渲染器不做 props 比较。 */
  function memo(component) {
    if (typeof component !== 'function') {
      throw new Error(`memo() 需要函数组件，收到：${typeof component}`)
    }
    const wrapped = (props) => component(props)
    wrapped.displayName = `Memo(${component.displayName || component.name || 'Component'})`
    return wrapped
  }

  const React = {
    createElement,
    Fragment,
    useState(init) {
      const index = slotIndex++
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      const setState = (next) => {
        if (unmounted) return
        const value = typeof next === 'function' ? next(slots[index]) : next
        if (Object.is(value, slots[index])) return
        slots[index] = value
        dirty = true
      }
      return [slots[index], setState]
    },
    useReducer(reducer, initialArg, init) {
      const index = slotIndex++
      if (!(index in slots)) {
        slots[index] = typeof init === 'function' ? init(initialArg) : initialArg
      }
      // dispatch 立即计算并标脏，交给 mount 循环重跑到收敛（React 会批处理，这里不模拟）。
      const dispatch = (action) => {
        if (unmounted) return
        const next = reducer(slots[index], action)
        if (Object.is(next, slots[index])) return
        slots[index] = next
        dirty = true
      }
      return [slots[index], dispatch]
    },
    useRef(init) {
      const index = slotIndex++
      if (!(index in slots)) slots[index] = { current: init }
      return slots[index]
    },
    useMemo(factory, deps) {
      const index = slotIndex++
      const prev = slots[index]
      const hasDeps = Array.isArray(deps)
      if (prev && hasDeps && sameDeps(prev.deps, deps)) return prev.value
      const value = factory()
      slots[index] = { value, deps: hasDeps ? deps : null }
      return value
    },
    // 假渲染器不区分提交阶段：两者都只是"本轮渲染后执行"，清理逻辑共用。
    useEffect: registerEffect,
    useLayoutEffect: registerEffect,
    useCallback(fn, deps) {
      const index = slotIndex++
      const prev = slots[index]
      if (prev && sameDeps(prev.deps, deps)) return prev.fn
      slots[index] = { fn, deps }
      return fn
    },
    memo,
  }

  // 未实现的 hook / API：调用时给出可操作的报错，替代 "undefined is not a function"。
  const UNSUPPORTED_APIS = [
    'useContext',
    'useSyncExternalStore',
    'useImperativeHandle',
    'useInsertionEffect',
    'useId',
    'useTransition',
    'useDeferredValue',
    'useDebugValue',
    'useOptimistic',
    'createContext',
    'forwardRef',
    'startTransition',
  ]
  for (const name of UNSUPPORTED_APIS) {
    React[name] = () => {
      throw new Error(`假 React 未实现 ${name}：请先在 test/load-client.mjs 里补语义（当前支持 ${SUPPORTED_HOOKS}）`)
    }
  }

  const settle = async (rounds = 6) => {
    for (let round = 0; round < rounds; round += 1) {
      await Promise.resolve()
      await new Promise((resolvePromise) => setImmediate(resolvePromise))
    }
  }

  async function mount(component, props, maxPasses = 40) {
    effectCleanups.forEach((cleanup) => {
      if (typeof cleanup === 'function') cleanup()
    })
    slots.length = 0
    effectDeps = []
    effectCleanups = []
    dirty = false

    for (let pass = 0; pass < maxPasses; pass += 1) {
      dirty = false
      slotIndex = 0
      pendingEffects = []
      const tree = component(props)

      let ranEffect = false
      pendingEffects.forEach((item, index) => {
        if (sameDeps(effectDeps[index], item.deps)) return
        effectDeps[index] = item.deps
        if (typeof effectCleanups[index] === 'function') effectCleanups[index]()
        const cleanup = item.effect()
        effectCleanups[index] = typeof cleanup === 'function' ? cleanup : null
        ranEffect = true
      })
      await settle()
      if (!ranEffect && !dirty) return tree
    }
    throw new Error('渲染未在预期轮次内收敛')
  }

  function unmount() {
    unmounted = true
    effectCleanups.forEach((cleanup) => {
      if (typeof cleanup === 'function') cleanup()
    })
    effectCleanups = []
  }

  return { React, jsxRuntime, mount, unmount }
}

/** 深拷渲染树：保留结构、样式与文本；回调替换成占位串，便于比对。 */
export function serializeTree(node) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(serializeTree)

  // 纯函数组件就地展开，使快照不受"内联还是拆组件"影响，只反映最终结构。
  if (typeof node.type === 'function') return serializeTree(node.type({ ...node.props, children: node.children }))

  const props = {}
  for (const key of Object.keys(node.props).sort()) {
    // key 是 React 的列表标识，不进 DOM，也不应影响快照对比
    if (key === 'children' || key === 'key') continue
    const value = node.props[key]
    props[key] = typeof value === 'function' ? '[fn]' : value
  }
  return { type: node.type, props, children: node.children.map(serializeTree) }
}

/**
 * 求值构建产物，返回插件对象与渲染入口。
 * @param {{
 *   artifact?: string,
 *   locale?: string,
 *   now?: number,
 *   responses?: Record<string, unknown>,
 *   failures?: Record<string, string>,
 *   testBuild?: boolean,
 * }} options
 */
export async function loadClient(options = {}) {
  const artifact = options.artifact ?? TEST_ARTIFACT
  const locale = options.locale ?? 'zh-CN'
  const responses = options.responses ?? {}
  // 路径 → 异常消息：模拟网络层失败（浏览器里就是 TypeError: Failed to fetch）。
  const failures = options.failures ?? {}
  const now = options.now ?? Date.parse('2026-11-09T05:05:00.000Z')

  const source = await readFile(artifact, 'utf8')

  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
    dateNow: Date.now,
  }

  const timers = new Map()
  let timerId = 0
  const fakeSetTimeout = (fn, ms) => {
    timerId += 1
    timers.set(timerId, { fn, ms })
    return timerId
  }
  const fakeClear = (id) => timers.delete(id)

  const fetches = []
  const fakeFetch = async (url) => {
    const parsed = new URL(String(url))
    const key = parsed.pathname
    fetches.push(`${parsed.pathname}${parsed.search}`)
    if (key in failures) throw new TypeError(failures[key])
    if (!(key in responses)) return { ok: false, status: 404, json: async () => null }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(responses[key])) }
  }

  let registration = null
  // 浏览器里 window 总是存在且带事件 API：生产代码直接调用即可，不必再写 typeof 防御。
  const fakeWindow = {
    __ModuleLoader__: {
      load(module) {
        registration = module
      },
    },
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
  }

  const renderer = createRenderer(now)
  let installed = false
  const install = () => {
    if (installed) return
    installed = true
    globalThis.document = {
      documentElement: { lang: locale },
      baseURI: 'http://localhost/',
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
    }
    globalThis.fetch = fakeFetch
    globalThis.window = fakeWindow
    globalThis.setTimeout = fakeSetTimeout
    globalThis.setInterval = (fn, ms) => fakeSetTimeout(fn, ms)
    globalThis.clearTimeout = fakeClear
    globalThis.clearInterval = fakeClear
    Date.now = () => now
  }
  const restore = () => {
    if (!installed) return
    installed = false
    globalThis.document = saved.document
    globalThis.fetch = saved.fetch
    globalThis.window = saved.window
    globalThis.setTimeout = saved.setTimeout
    globalThis.setInterval = saved.setInterval
    globalThis.clearTimeout = saved.clearTimeout
    globalThis.clearInterval = saved.clearInterval
    Date.now = saved.dateNow
  }

  install()
  try {
    // bundle 顶层直接调用 window.__ModuleLoader__.load(...)，求值即注册 factory。
    // eslint-disable-next-line no-new-func
    new Function('window', source)(fakeWindow)
    if (!registration || typeof registration.factory !== 'function') {
      throw new Error(`${artifact} 没有注册 factory`)
    }
    const mod = registration.factory((name) => {
      if (name === 'react') return renderer.React
      if (name === 'react/jsx-runtime') return renderer.jsxRuntime
      throw new Error(`测试环境不提供平台模块：${name}`)
    })

    const internals = mod.__test ?? null
    if (options.testBuild !== false && !internals) {
      throw new Error(`${artifact} 不含测试出口，请用 node build.mjs --test 构建`)
    }

    return {
      id: registration.id,
      mod,
      react: renderer.React,
      fetches,
      timers,
      internals,
      DICT: internals?.dict?.DICT ?? null,
      PURE: internals?.logic ?? null,
      styles: internals?.theme?.styles ?? null,
      KEYFRAMES: internals?.theme?.KEYFRAMES ?? null,
      components: internals?.components ?? null,
      Workbench: internals?.components?.Workbench ?? null,
      StatusChip: internals?.components?.StatusChip ?? null,
      Lightbox: internals?.components?.Lightbox ?? null,
      render: (component, props) => component(props),
      snapshot: (component, props) => serializeTree(component(props)),
      mount: async (component, props) => {
        install()
        return serializeTree(await renderer.mount(component, props))
      },
      /** 挂载并返回原始元素树，供静态预览转成 HTML。 */
      mountRaw: async (component, props) => {
        install()
        return renderer.mount(component, props)
      },
      unmount: () => {
        renderer.unmount()
        restore()
      },
    }
  } catch (error) {
    restore()
    throw error
  }
}