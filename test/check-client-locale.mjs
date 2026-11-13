/**
 * 文案键静态检查（不需要浏览器）。
 *
 * 1. src/dict 下 zh / en 两个键集合必须完全一致；
 * 2. src 里所有静态调用的 t('…') 都要在字典里存在；
 * 3. 动态键（`xxx.${…}`）的命名空间必须已定义；
 * 4. 契约取值域里的动态键（加速器展示名、Token 来源）两侧都必须存在；
 * 5. 发布产物 client.js 必须与源码同步，且包含全部中文文案。
 *
 * 运行：node test/check-client-locale.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SETTINGS } from '../shared/contract.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SRC = join(ROOT, 'src')

const problems = []

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listSourceFiles(path)))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx')) files.push(path)
  }
  return files
}

function keysOf(text) {
  const keys = new Set()
  for (const match of text.matchAll(/^\s*'([^']+)':/gm)) keys.add(match[1])
  return keys
}

const zhSource = await readFile(join(SRC, 'dict/zh.js'), 'utf8')
const enSource = await readFile(join(SRC, 'dict/en.js'), 'utf8')
const zh = keysOf(zhSource)
const en = keysOf(enSource)

for (const key of zh) if (!en.has(key)) problems.push(`en 缺少：${key}`)
for (const key of en) if (!zh.has(key)) problems.push(`zh 缺少：${key}`)

// 静态调用点与动态键命名空间
const used = new Set()
const namespaces = new Set()
for (const key of zh) namespaces.add(key.split('.')[0])

const files = await listSourceFiles(SRC)
for (const file of files) {
  const text = await readFile(file, 'utf8')
  const shortName = relative(ROOT, file).replace(/\\/g, '/')

  for (const match of text.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) used.add(match[1])
  for (const match of text.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)) used.add(match[1])
  for (const match of text.matchAll(/`([a-zA-Z0-9_]+)\.\$\{/g)) {
    if (!namespaces.has(match[1])) problems.push(`${shortName}：动态键命名空间未定义 ${match[1]}.*`)
  }
}

for (const key of used) {
  if (!zh.has(key)) problems.push(`代码引用了不存在的键：${key}`)
}

// 动态键：命名空间扫描只能证明前缀存在，这里再按契约取值域逐条校验（运行设置抽屉用）。
const dynamicKeys = [
  ...SETTINGS.accelerators.map((id) => `studio.settings.accelerator.${id}`),
  ...SETTINGS.hfTokenSources.map((source) => `studio.settings.hfToken.sourceValue.${source}`),
]
for (const key of dynamicKeys) {
  if (!zh.has(key)) problems.push(`zh 缺少契约取值域动态键：${key}`)
  if (!en.has(key)) problems.push(`en 缺少契约取值域动态键：${key}`)
}

// 发布产物必须包含全部中文文案（防"改了源码忘了构建"）
const artifact = await readFile(join(ROOT, 'client.js'), 'utf8')
for (const key of zh) {
  const value = zhSource.match(new RegExp(`^\\s*'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`, 'm'))?.[1]
  if (!value) continue
  if (!artifact.includes(value)) problems.push(`client.js 缺少文案（未重新构建？）：${key} → ${value}`)
}
if (artifact.includes('__test')) problems.push('client.js 里出现了 __test，发布产物不应包含测试出口')

console.log(`zh 键 ${zh.size} 个，en 键 ${en.size} 个，静态引用 ${used.size} 个，扫描源文件 ${files.length} 个`)
if (problems.length === 0) {
  console.log('文案检查通过')
} else {
  console.log(`发现 ${problems.length} 个问题：`)
  for (const line of problems.slice(0, 40)) console.log(`- ${line}`)
  process.exitCode = 1
}