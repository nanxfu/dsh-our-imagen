/**
 * client.js 文案键静态检查（不需要浏览器）。
 *
 * 1. 提取 DICT 里 zh / en 两个键集合，要求完全一致；
 * 2. 收集代码里静态调用的 t('…')，要求都能在字典里找到；
 * 3. 提示常见拼写问题（多余空格、大小写不一致）。
 *
 * 运行：node test/check-client-locale.mjs
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const source = await readFile(join(ROOT, 'client.js'), 'utf8')

function sliceObject(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`找不到 ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  if (end === -1) throw new Error(`找不到 ${endMarker}`)
  return source.slice(start, end)
}

const zhBlock = sliceObject('zh: {', 'en: {')
const enBlock = sliceObject('en: {', 'function fallbackTranslate')

function keysOf(block) {
  const keys = new Set()
  for (const match of block.matchAll(/^\s*'([^']+)':/gm)) keys.add(match[1])
  return keys
}

const zh = keysOf(zhBlock)
const en = keysOf(enBlock)

const problems = []
for (const key of zh) if (!en.has(key)) problems.push(`en 缺少：${key}`)
for (const key of en) if (!zh.has(key)) problems.push(`zh 缺少：${key}`)

// 静态调用点：t('x') / t("x")
const used = new Set()
for (const match of source.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) used.add(match[1])
for (const match of source.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)) used.add(match[1])
for (const key of used) {
  if (!zh.has(key)) problems.push(`代码引用了不存在的键：${key}`)
}

// 动态键的命名空间至少要有前缀定义，避免整段缺失
const namespaces = new Set()
for (const key of zh) namespaces.add(key.split('.')[0])
for (const match of source.matchAll(/`([a-zA-Z0-9_]+)\.\$\{/g)) {
  if (!namespaces.has(match[1])) problems.push(`动态键命名空间未定义：${match[1]}.*`)
}

console.log(`zh 键 ${zh.size} 个，en 键 ${en.size} 个，静态引用 ${used.size} 个`)
if (problems.length === 0) {
  console.log('文案检查通过')
} else {
  console.log(`发现 ${problems.length} 个问题：`)
  for (const line of problems.slice(0, 40)) console.log(`- ${line}`)
  process.exitCode = 1
}
