/**
 * 渲染测试共享工具：假 React 渲染树的遍历、类名统计与结构断言，以及测试产物加载。
 *
 * 这些 helper 原先内联在 check-client-render.mjs 里，拆文件后由各渲染测试共用。
 * 树遍历函数对「组件节点就地展开」的语义与假渲染器（test/load-client.mjs）保持一致：
 * 遇到函数组件直接当纯函数调用，因此断言只反映最终宿主元素树。
 */

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { bundle } from '../../build.mjs'
import { loadClient, TEST_ARTIFACT } from '../load-client.mjs'

/** 收集整棵树里的文本节点（数字转字符串；布尔子节点按空处理）。 */
export const collectText = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node.type === 'function') return collectText(node.type({ ...node.props, children: node.children }), out)
  collectText(node.children, out)
  return out
}

/** 统计某个 class token 在整棵树里出现的次数。 */
export const countByClass = (node, className) => {
  if (!node || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + countByClass(child, className), 0)
  if (typeof node.type === 'function') return countByClass(node.type({ ...node.props, children: node.children }), className)
  const own = typeof node.props?.className === 'string' && node.props.className.split(' ').includes(className) ? 1 : 0
  return own + countByClass(node.children, className)
}

/** 统计整棵树里每个 className token 出现的次数（一次遍历拿到全部）。 */
export const collectClasses = (node, out = {}) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectClasses(child, out)
    return out
  }
  if (typeof node.type === 'function') return collectClasses(node.type({ ...node.props, children: node.children }), out)
  const className = node.props?.className
  if (typeof className === 'string') {
    for (const token of className.split(/\s+/).filter(Boolean)) out[token] = (out[token] ?? 0) + 1
  }
  collectClasses(node.children, out)
  return out
}

const describeClasses = (classMap) =>
  Object.keys(classMap)
    .sort()
    .map((token) => `${token}×${classMap[token]}`)
    .join(' ')

/**
 * 结构断言：失败信息必须同时给出场景名、期望与实际类名集合，便于直接定位。
 *
 * required 的值有两种写法：
 *   - 数字：类名必须出现的精确次数（结构锚点 / 计数本身即被测行为的场景）；
 *   - '1+'：只要求至少出现一次，用于「有几个子元素」这类与视觉细节耦合的计数。
 */
export const assertStructure = (name, tree, structure) => {
  const classMap = collectClasses(tree)
  for (const [className, expected] of Object.entries(structure.required ?? {})) {
    const actual = classMap[className] ?? 0
    if (typeof expected === 'number') {
      assert.equal(
        actual,
        expected,
        `[${name}] 结构类名 .${className} 应出现 ${expected} 次，实际 ${actual} 次。实际类名集合：${describeClasses(classMap)}`,
      )
      continue
    }
    const min = Number.parseInt(String(expected), 10) || 1
    assert.ok(
      actual >= min,
      `[${name}] 结构类名 .${className} 至少应出现 ${min} 次，实际 ${actual} 次。实际类名集合：${describeClasses(classMap)}`,
    )
  }
  for (const className of structure.forbidden ?? []) {
    assert.ok(
      !(className in classMap),
      `[${name}] 不应出现结构类名 .${className}，实际出现 ${classMap[className]} 次。实际类名集合：${describeClasses(classMap)}`,
    )
  }
}

/** 收集满足条件的节点，用来直接触发按钮回调（测试替身没有事件系统）。 */
export const findNodes = (node, predicate, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, out)
    return out
  }
  if (typeof node.type === 'function') {
    findNodes(node.type({ ...node.props, children: node.children }), predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findNodes(node.children, predicate, out)
  return out
}

/** 按 class token 收集节点（token 命中 className 的任意一段即可）。 */
export const nodesByClass = (tree, token) => findNodes(
  tree,
  (node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(token),
)

/** 同上，但语义上用于「按类名找组件」，供对话面板用例使用。 */
export const findClass = (tree, className) => findNodes(
  tree,
  (node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes(className),
)

/** 按按钮文案找按钮；找不到返回 null（调用方自己断言）。 */
export const buttonByText = (tree, text) => findNodes(
  tree,
  (node) => node.type === 'button' && collectText(node).join('').includes(text),
)[0] || null

/** 按类名取第一个文本域（提示词 / 排除项共用）。 */
export const textareaOfClass = (tree, className) => findNodes(
  tree,
  (node) => node.type === 'textarea'
    && typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes(className),
)[0] || null

/** 构建测试产物：同一个进程内只构建一次，供多次 loadClient 复用。 */
let testBuildPromise = null
const ensureTestBuild = () => {
  if (!testBuildPromise) {
    testBuildPromise = (async () => {
      await mkdir(dirname(TEST_ARTIFACT), { recursive: true })
      await writeFile(TEST_ARTIFACT, await bundle({ test: true }), 'utf8')
    })()
  }
  return testBuildPromise
}

/**
 * 加载客户端：先保证 test/.build/client.test.js 是当前源码构建出来的，
 * 再交给 loadClient 求值。每个测试文件独立调用，不依赖别的文件先跑过。
 *
 * @param {Parameters<typeof loadClient>[0]} [options] 透传给 loadClient；
 *   显式传入 artifact（如发布产物 client.js）时跳过测试产物构建。
 */
export async function createTestClient(options = {}) {
  if (!options.artifact) await ensureTestBuild()
  return loadClient(options)
}
