#!/usr/bin/env node
/**
 * 插件分发打包：产出可直接在 DSH Desktop「本地 Bundle」加载的目录，并尽力生成同名 zip。
 *
 * 步骤：
 *   1. 先跑 node build.mjs，保证 client.js 与 src 同步；
 *   2. 按 package.json 的 files 清单复制运行所需文件到 dist/<name>-<version>/；
 *   3. 校验入口与契约版本一致，打印加载说明；
 *   4. 尽力压缩为 zip：Windows 用 PowerShell 的 Compress-Archive，其它平台用系统 zip；
 *      压缩工具不可用时只保留目录（目录本身就是可加载形态）。
 *
 * 用法：npm run package
 */

import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VERSION } from '../shared/contract.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')

// 运行期必需文件：package.json.files 之外的入口与说明文件。
const EXTRA_FILES = ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml']
// 这些目录按扩展名过滤复制，避免把 __pycache__ 等运行残留打进分发目录。
const FILTERED_DIRS = { lib: ['.js'], shared: ['.js'], locale: ['.json'], remote: ['.py'] }
const SKIP_NAMES = new Set(['__pycache__', '.DS_Store', 'Thumbs.db'])

function fail(message) {
  console.error(`打包失败：${message}`)
  process.exit(1)
}

function run(command, args) {
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
}

async function pathExists(path) {
  return Boolean(await stat(path).catch(() => null))
}

/** 递归复制目录，只保留给定扩展名（不传则全量），跳过缓存与系统垃圾文件。 */
async function copyFiltered(from, to, extensions) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      await copyFiltered(source, target, extensions)
      continue
    }
    if (extensions && !extensions.some((ext) => entry.name.endsWith(ext))) continue
    await cp(source, target)
  }
}

async function main() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  if (pkg.version !== VERSION) {
    fail(`package.json 版本 ${pkg.version} 与契约 VERSION ${VERSION} 不一致，先统一版本号`)
  }

  console.log('[package] 1/3 构建 client.js …')
  const build = run(process.execPath, ['build.mjs'])
  if (build.status !== 0) fail('node build.mjs 执行失败')

  console.log('[package] 2/3 复制运行文件 …')
  const target = join(DIST, `${pkg.name}-${pkg.version}`)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  for (const file of EXTRA_FILES) {
    if (await pathExists(join(ROOT, file))) await cp(join(ROOT, file), join(target, file))
  }
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (FILTERED_DIRS[entry.name]) await copyFiltered(join(ROOT, entry.name), join(target, entry.name), FILTERED_DIRS[entry.name])
      continue
    }
    // package.json.files 里的单文件（index.js / client.js / icon.svg / cordis.patch.yml）。
    const listed = (pkg.files ?? []).includes(entry.name) && !EXTRA_FILES.includes(entry.name)
    if (listed) await cp(join(ROOT, entry.name), join(target, entry.name))
  }

  const required = ['index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'lib/route-kit.js', 'shared/contract.js', 'remote/daemon.py', 'remote/anima_runtime.py']
  const missing = []
  for (const file of required) {
    if (!(await pathExists(join(target, ...file.split('/'))))) missing.push(file)
  }
  if (missing.length) fail(`分发目录缺少必需文件：${missing.join(', ')}`)

  console.log(`[package] 已生成候选目录：${relative(ROOT, target).split(sep).join('/')}`)

  console.log('[package] 3/3 尝试压缩 zip …')
  const zipPath = `${target}.zip`
  const powershell =
    process.platform === 'win32'
      ? spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path "${join(target, '*')}" -DestinationPath "${zipPath}" -Force`,
          ],
          { cwd: ROOT, stdio: 'inherit' },
        )
      : null
  const zipped = powershell ? powershell.status === 0 : run('zip', ['-qr', zipPath, relative(DIST, target)]).status === 0

  console.log('')
  console.log(`版本 ${pkg.version} 打包完成。`)
  if (zipped) console.log(`zip：${relative(ROOT, zipPath).split(sep).join('/')}`)
  else console.log('未找到可用的 zip 工具，已保留目录形态（同样可加载）。')
  console.log(`在 DSH Desktop 设置 → 插件管理 → 本地 Bundle 中选择：${relative(ROOT, target).split(sep).join('/')}`)
}

main().catch((error) => fail(error?.message ?? error))