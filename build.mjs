/**
 * 构建脚本：把 src/ 下的 ESM 源码打成 DSH 客户端插件要求的单文件 bundle。
 *
 * 产物形状与官方插件一致（见 @deepseek-ai/dsh-client-modules 文档）：
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 *
 * 约束：bundle 必须是单个模块节点，只能同步 require 平台共享模块（react 等），
 * 不能相对 require 自己的其他产物。所以这里用 esbuild 打成一个自包含文件。
 *
 * 用法：
 *   node build.mjs                 产出 client.js（发布产物）
 *   node build.mjs --test          产出 test/.build/client.test.js（含内部导出，供测试用）
 *   node build.mjs --check         只构建不写盘，用于校对产物是否最新
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const ROOT = dirname(fileURLToPath(import.meta.url))

export const PACKAGE_ID = 'dsh-our-free-imagen'
export const ARTIFACT = join(ROOT, 'client.js')
export const TEST_ARTIFACT = join(ROOT, 'test/.build/client.test.js')

/** 平台共享模块表里的模块：必须保持 external，由宿主 require 注入。 */
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', '@deepseek-ai/*']

const ENVELOPE_HEAD = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PACKAGE_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n`

const ENVELOPE_TAIL = `\t\treturn module.exports;\n\t}\n});\n`

/**
 * 打包并返回 bundle 文本。
 * @param {{ test?: boolean }} options
 */
export async function bundle({ test = false } = {}) {
  const result = await build({
    entryPoints: [join(ROOT, test ? 'src/test-entry.js' : 'src/index.js')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome120'],
    external: PLATFORM_MODULES,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    absWorkingDir: ROOT,
    // JSX 交给 esbuild 转换，运行时走 react/jsx-runtime（平台共享模块表里有）。
    jsx: 'automatic',
    // 样式以文本形式打进 bundle，组件用 <style> 注入，避免依赖宿主的样式管线。
    loader: { '.css': 'text' },
    resolveExtensions: ['.jsx', '.js', '.json'],
  })

  const body = result.outputFiles[0].text.replace(/^\s*"use strict";\s*\n/, '')
  return `${ENVELOPE_HEAD}${body}\n${ENVELOPE_TAIL}`
}

/** 生成发布产物与测试产物，返回两者文本。 */
export async function buildAll() {
  const [prod, test] = await Promise.all([bundle(), bundle({ test: true })])
  return { prod, test }
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2))

  if (flags.has('--test')) {
    const text = await bundle({ test: true })
    await mkdir(dirname(TEST_ARTIFACT), { recursive: true })
    await writeFile(TEST_ARTIFACT, text, 'utf8')
    console.log(`已产出测试 bundle：${TEST_ARTIFACT}（${text.length} 字节）`)
    return
  }

  const text = await bundle()

  if (flags.has('--check')) {
    const current = await readIfExists(ARTIFACT)
    if (current !== text) {
      console.error('client.js 与源码不一致，请运行 node build.mjs 重新构建')
      process.exitCode = 1
      return
    }
    console.log('client.js 是最新的')
    return
  }

  await writeFile(ARTIFACT, text, 'utf8')
  console.log(`已产出 ${ARTIFACT}（${text.length} 字节）`)
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  await main()
}