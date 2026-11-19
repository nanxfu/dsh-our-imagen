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
 *   - 测试在 mount 之后点击按钮 / 直接调用动作改变了 state 时，用 rerender() 把新状态刷到树上；
 *     挂起的异步流程用 settle() 等待落地。fake fetch 的完整请求（method + body）记在 requests 里。
 *   - setTimeout / setInterval 只入队不自动到期；需要驱动轮询时用 advanceTimers(ms) 推进假时钟，
 *     Date.now() 随之走向推进后的时刻（未推进时固定为 now 选项的值）。
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

/**
 * 最小 React 替身 + 状态循环。
 *
 * 按树路径（path + key + 组件类型）为每个函数组件实例分配独立的 hook 槽位与 effect 列表；
 * 每次 pass 展开整棵组件树并返回纯宿主元素树，卸载的实例会自动触发清理。
 */
function createRenderer(now) {
  let instances = new Map()
  let activeInstance = null
  let pendingEffects = []
  let dirty = false
  let unmounted = false

  const createElement = (type, props, ...children) => {
    const rawProps = props ?? {}
    const key = rawProps.key !== undefined && rawProps.key !== null ? String(rawProps.key) : null
    const cleanProps = 'key' in rawProps ? (() => {
      const copy = { ...rawProps }
      delete copy.key
      return copy
    })() : rawProps
    return {
      type,
      key,
      props: cleanProps,
      children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true),
    }
  }

  // JSX 自动运行时：jsx(type, props, key) 第三参数是 key；Fragment 展开为子节点。
  const Fragment = (props) => (props && props.children) || null
  const jsx = (type, props, key) => {
    const { children, ...rest } = props ?? {}
    const nextProps = key !== undefined ? { ...rest, key } : rest
    if (children === undefined) return createElement(type, nextProps)
    return createElement(type, nextProps, ...(Array.isArray(children) ? children : [children]))
  }
  const jsxRuntime = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment }

  /** useEffect / useLayoutEffect 共用：本轮渲染后按 deps 决定是否执行。 */
  const registerEffect = (effect, deps) => {
    if (!activeInstance) {
      throw new Error('hook 只能在组件渲染期间调用（useEffect / useLayoutEffect）')
    }
    const inst = activeInstance
    const effectIndex = inst.effectIndex++
    pendingEffects.push({ inst, effectIndex, effect, deps })
  }

  function currentHookSlot() {
    if (!activeInstance) {
      throw new Error('hook 只能在组件渲染期间调用')
    }
    return { inst: activeInstance, index: activeInstance.slotIndex++ }
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
      const { inst, index } = currentHookSlot()
      const slots = inst.slots
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      const setState = (next) => {
        if (unmounted || inst.unmounted) return
        const value = typeof next === 'function' ? next(slots[index]) : next
        if (Object.is(value, slots[index])) return
        slots[index] = value
        dirty = true
      }
      return [slots[index], setState]
    },
    useReducer(reducer, initialArg, init) {
      const { inst, index } = currentHookSlot()
      const slots = inst.slots
      if (!(index in slots)) {
        slots[index] = typeof init === 'function' ? init(initialArg) : initialArg
      }
      // dispatch 立即计算并标脏，交给 mount 循环重跑到收敛（React 会批处理，这里不模拟）。
      const dispatch = (action) => {
        if (unmounted || inst.unmounted) return
        const next = reducer(slots[index], action)
        if (Object.is(next, slots[index])) return
        slots[index] = next
        dirty = true
      }
      return [slots[index], dispatch]
    },
    useRef(init) {
      const { inst, index } = currentHookSlot()
      const slots = inst.slots
      if (!(index in slots)) slots[index] = { current: init }
      return slots[index]
    },
    useMemo(factory, deps) {
      const { inst, index } = currentHookSlot()
      const slots = inst.slots
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
      const { inst, index } = currentHookSlot()
      const slots = inst.slots
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

  function cleanupInstance(inst) {
    inst.unmounted = true
    inst.effectCleanups.forEach((cleanup) => {
      if (typeof cleanup === 'function') cleanup()
    })
    inst.effectCleanups = []
  }

  function acquireInstance(path, type) {
    const existing = instances.get(path)
    if (existing && existing.type === type) {
      existing.slotIndex = 0
      existing.effectIndex = 0
      return existing
    }
    if (existing) cleanupInstance(existing)
    const created = {
      type,
      slots: [],
      slotIndex: 0,
      effectIndex: 0,
      effectDeps: [],
      effectCleanups: [],
      unmounted: false,
    }
    instances.set(path, created)
    return created
  }

  function expandChildList(children, parentPath, visited) {
    const out = []
    const seenKeys = new Map()
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      let seg = String(i)
      if (child && typeof child === 'object' && !Array.isArray(child) && child.key !== null && child.key !== undefined) {
        const rawKey = `k:${child.key}`
        const dup = seenKeys.get(rawKey) || 0
        seenKeys.set(rawKey, dup + 1)
        seg = dup === 0 ? rawKey : `${rawKey}#${dup}`
      }
      const expanded = expandNode(child, `${parentPath}.${seg}`, visited)
      if (expanded === null || expanded === undefined || expanded === false || expanded === true) continue
      if (Array.isArray(expanded)) {
        for (const flat of expanded) {
          if (flat !== null && flat !== undefined && flat !== false && flat !== true) out.push(flat)
        }
      } else {
        out.push(expanded)
      }
    }
    return out
  }

  function expandNode(node, path, visited) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return expandChildList(node, path, visited)
    if (node.type === Fragment) {
      const fragChildren = node.children && node.children.length > 0
        ? node.children
        : (Array.isArray(node.props?.children) ? node.props.children : [node.props?.children])
      return expandChildList(fragChildren, `${path}.F`, visited)
    }
    if (typeof node.type === 'function') {
      const inst = acquireInstance(path, node.type)
      visited.add(path)
      const prevActive = activeInstance
      activeInstance = inst
      let rendered
      try {
        const childProp = node.children.length === 0
          ? node.props.children
          : (node.children.length === 1 ? node.children[0] : node.children)
        rendered = node.type({ ...node.props, children: childProp })
      } finally {
        activeInstance = prevActive
      }
      return expandNode(rendered, `${path}>`, visited)
    }
    return {
      ...node,
      children: expandChildList(node.children || [], path, visited),
    }
  }

  let mountedComponent = null
  let mountedProps = null

  /** 连续渲染到状态收敛；mount 与 rerender 共用，每个组件实例拥有独立的 hook 槽位与清理表。 */
  async function runPasses(maxPasses) {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      dirty = false
      pendingEffects = []
      const visited = new Set()
      const tree = expandNode(createElement(mountedComponent, mountedProps), '0', visited)

      for (const [path, inst] of [...instances.entries()]) {
        if (!visited.has(path)) {
          cleanupInstance(inst)
          instances.delete(path)
        }
      }

      for (const { inst, effectIndex, effect, deps } of pendingEffects) {
        if (inst.unmounted) continue
        if (sameDeps(inst.effectDeps[effectIndex], deps)) continue
        inst.effectDeps[effectIndex] = deps
        if (typeof inst.effectCleanups[effectIndex] === 'function') inst.effectCleanups[effectIndex]()
        const cleanup = effect()
        inst.effectCleanups[effectIndex] = typeof cleanup === 'function' ? cleanup : null
      }
      await settle()
      if (!dirty) return tree
    }
    throw new Error('渲染未在预期轮次内收敛')
  }

  async function mount(component, props, maxPasses = 40) {
    for (const inst of instances.values()) cleanupInstance(inst)
    instances = new Map()
    dirty = false
    unmounted = false
    mountedComponent = component
    mountedProps = props
    return runPasses(maxPasses)
  }

  /**
   * 重新渲染已挂载的组件：外部调用 setState（点击回调、直接调动作）后，
   * 用它在保留 hook 槽位的前提下把新状态刷到树上。effect 依赖未变时不会重跑。
   */
  async function rerender(maxPasses = 40) {
    if (!mountedComponent) throw new Error('尚未挂载组件，无法重新渲染')
    return runPasses(maxPasses)
  }

  function unmount() {
    unmounted = true
    for (const inst of instances.values()) cleanupInstance(inst)
    instances.clear()
    mountedComponent = null
    mountedProps = null
  }

  return { React, jsxRuntime, mount, rerender, settle, unmount }
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
  // `OFS_TEST_BUNDLE`（相对仓库根）供并行开发时使用独立构建产物，避免写冲突。
  const envArtifact = process.env.OFS_TEST_BUNDLE ? join(ROOT, process.env.OFS_TEST_BUNDLE) : null
  const artifact = options.artifact ?? envArtifact ?? TEST_ARTIFACT
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
  // 假时钟：默认固定在 now（保证既有断言里的时间读数不变）；
  // advanceTimers() 会把时钟推进到目标时刻并逐个执行到期回调。
  let clock = now
  const fakeSetTimeout = (fn, ms) => {
    timerId += 1
    const delay = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0
    timers.set(timerId, { fn, ms: delay, dueAt: clock + delay })
    return timerId
  }
  const fakeClear = (id) => timers.delete(id)

  const fetches = []
  // 完整请求记录（method + 解析后的 JSON body）：断言「提交了什么」比只看 URL 更可靠。
  const requests = []
  const fakeFetch = async (url, init) => {
    const parsed = new URL(String(url))
    const key = parsed.pathname
    const method = (init && init.method) || 'GET'
    let body = null
    if (init && typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    requests.push({ path: key, search: parsed.search, method, body })
    fetches.push(`${parsed.pathname}${parsed.search}`)
    if (key in failures) throw new TypeError(failures[key])
    if (!(key in responses)) return { ok: false, status: 404, json: async () => null }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(responses[key])) }
  }

function createMemoryStorage() {
  const store = new Map()
  return {
    get length() {
      return store.size
    },
    getItem(key) {
      const k = String(key)
      return store.has(k) ? store.get(k) : null
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
    removeItem(key) {
      store.delete(String(key))
    },
    clear() {
      store.clear()
    },
    key(index) {
      return [...store.keys()][index] ?? null
    },
  }
}

  let registration = null
  // 浏览器里 window 总是存在且带事件 API：生产代码直接调用即可，不必再写 typeof 防御。
  const fakeWindow = {
    __ModuleLoader__: {
      load(module) {
        registration = module
      },
    },
    sessionStorage: options.sessionStorage || createMemoryStorage(),
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
  }

  const renderer = createRenderer(now)
  let installed = false
  // document 事件监听（visibilitychange）：setHidden() 用它模拟页面隐藏/恢复。
  const documentListeners = new Map()
  const install = () => {
    if (installed) return
    installed = true
    globalThis.document = {
      documentElement: { lang: locale },
      baseURI: 'http://localhost/',
      hidden: false,
      addEventListener(type, handler) {
        if (!documentListeners.has(type)) documentListeners.set(type, new Set())
        documentListeners.get(type).add(handler)
      },
      removeEventListener(type, handler) {
        const handlers = documentListeners.get(type)
        if (handlers) handlers.delete(handler)
      },
    }
    globalThis.fetch = fakeFetch
    globalThis.window = fakeWindow
    globalThis.setTimeout = fakeSetTimeout
    globalThis.setInterval = (fn, ms) => fakeSetTimeout(fn, ms)
    globalThis.clearTimeout = fakeClear
    globalThis.clearInterval = fakeClear
    Date.now = () => clock
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

  /**
   * 推进假时钟到 `ms` 毫秒后，按到期顺序执行一遍到期的定时器。
   *
   * 真实浏览器里 setTimeout 会自动触发，测试替身不会；轮询类逻辑（登录、日志、状态）
   * 需要它才能走完「发起 → 轮询 → 终态」。每执行一个回调就等待一轮微任务，
   * 让 async 回调里 `await fetch` 之后的续体有机会继续排下一步定时器。
   * 返回实际执行的回调数，便于断言「停止轮询后不再有定时任务」。
   */
  async function advanceTimers(ms = 0) {
    const target = clock + (Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0)
    let ran = 0
    for (let guard = 0; guard < 5000; guard += 1) {
      let dueId = null
      let dueAt = Infinity
      for (const [id, timer] of timers) {
        if (timer.dueAt <= target && timer.dueAt < dueAt) {
          dueId = id
          dueAt = timer.dueAt
        }
      }
      if (dueId === null) break
      const timer = timers.get(dueId)
      timers.delete(dueId)
      clock = timer.dueAt
      ran += 1
      try {
        timer.fn()
      } catch {
        // 定时器回调异常交给断言侧发现（真实环境里会冒泡到浏览器控制台），
        // 这里不中断时钟推进，否则测试会卡在「定时器没到期」这种次要现象上。
      }
      await renderer.settle()
    }
    clock = Math.max(clock, target)
    return ran
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
      requests,
      timers,
      internals,
      DICT: internals?.dict?.DICT ?? null,
      PURE: internals?.logic ?? null,
      styles: internals?.theme?.styles ?? null,
      KEYFRAMES: internals?.theme?.KEYFRAMES ?? null,
      components: internals?.components ?? null,
      hooks: internals?.hooks ?? null,
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
      /** 外部 setState（点击回调、直接调动作）后把新状态刷到树上。 */
      rerender: async () => {
        install()
        return serializeTree(await renderer.rerender())
      },
      rerenderRaw: async () => {
        install()
        return renderer.rerender()
      },
      /** 等待挂起的异步流程（fetch / 微任务）落地，用于断言副作用。 */
      settle: async (rounds) => {
        install()
        await renderer.settle(rounds)
      },
      /** 推进假时钟并执行到期定时器（轮询类逻辑用），返回执行的回调数。 */
      advanceTimers: async (ms = 0) => {
        install()
        return advanceTimers(ms)
      },
      /**
       * 模拟页面可见性切换：设置 document.hidden 并触发全部 visibilitychange 监听器。
       * 用于断言「隐藏时停止轮询、恢复时继续」。
       */
      setHidden: (hidden) => {
        install()
        globalThis.document.hidden = Boolean(hidden)
        for (const handler of [...(documentListeners.get('visibilitychange') ?? [])]) handler()
      },
      /** 当前假时钟读数（毫秒时间戳）。 */
      now: () => clock,
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