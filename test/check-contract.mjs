/**
 * 契约单一来源校验（A 阶段 P1 验收脚本，只读）。
 *
 * 校验目标：`shared/contract.js` 是唯一契约源，仓库里的宿主 / 客户端 / 远端 / 测试 / 文档
 * 是否都跟着它走。脚本只读文件，不改任何东西；失败时退出码 1，并把缺失/多余项原样列出。
 *
 * 检查项（对应 docs/refactor/REFACTOR_PROPOSAL.md P1）：
 *   a. package.json.version === contract.VERSION
 *   b. index.js 注册路由集合 === ROUTES；index.js 内的 /imagen-api/ 字面量 ⊆ 路由表
 *   c. lib/**\/*.js 内的 /imagen-api/ 字面量 ⊆ 路由表（lib/output.js 拼预览 URL 用得到）
 *   d. src/**\/*.js(x) 不出现 'imagen-api/' 字面量、不 import lib/（必须走 routePath）
 *   e. index.js + lib 内 emit 的错误码 ⊆ ERROR_CODES；hostErrorCodes() 在 zh/en 字典都有文案
 *   f. 版本单源：daemon.py / mock-daemon.py / tunnel-probe.py（及 index.js 若仍有常量）
 *   g. daemon 协议：/health /logs /generate /shutdown 与 healthPhases 全部取值
 *   h. docs/SPEC.md 包含全部路由路径与全部 host+remote 错误码
 *   i. lib/presets.js 不再定义预设数据
 *
 * 运行：node test/check-contract.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  VERSION,
  ROUTES,
  ERROR_CODES,
  PRESETS,
  PROTOCOL,
  hostErrorCodes,
} from '../shared/contract.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROUTE_LIST = Object.values(ROUTES).map((route) => route.path)
const ROUTE_SET = new Set(ROUTE_LIST)
// hostErrorCodes() 已同时包含 host 与 remote 两层（远端码由 Host 透传）。
const HOST_CODES = hostErrorCodes()
const API_CODE_RE = /\/imagen-api\/[A-Za-z0-9_\-/]*/g

let passed = 0
const failedChecks = []

function pass(id, title, note = '') {
  passed += 1
  console.log(`✓ ${id}. ${title}${note ? `（${note}）` : ''}`)
}

function fail(id, title, details = []) {
  failedChecks.push(id)
  console.log(`✗ ${id}. ${title}`)
  for (const detail of details) console.log(`    - ${detail}`)
}

/** 只用于“不算失败”的补充信息。 */
function note(text) {
  console.log(`    · ${text}`)
}

async function readText(relPath) {
  return readFile(join(ROOT, relPath), 'utf8')
}

/** 递归列出相对路径（POSIX 风格），用于 src/ 与 lib/ 的批量扫描。 */
async function listSourceFiles(relDir, extensions) {
  const found = []
  async function walk(absDir) {
    const entries = await readdir(absDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const abs = join(absDir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(relative(ROOT, abs).replace(/\\/g, '/'))
      }
    }
  }
  await walk(join(ROOT, relDir))
  return found.sort()
}

/**
 * 把注释内容替换成空格（保留换行与列位置）。
 * 用途：区分“代码里真的用了字面量”与“注释里提到过”，后者不应算失败。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length))
}

/** 提取文本里所有 /imagen-api/... 字面量（去掉行尾斜杠）。 */
function apiLiterals(text) {
  return [...new Set((text.match(API_CODE_RE) ?? []).map((value) => value.replace(/\/+$/, '')))]
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── a. 包版本 ──────────────────────────────────────────────────────────────
async function checkPackageVersion() {
  const pkg = JSON.parse(await readText('package.json'))
  if (pkg.version === VERSION) return pass('a', 'package.json 版本与契约一致', `version=${VERSION}`)
  fail('a', 'package.json 版本与契约不一致', [`package.json: ${pkg.version}`, `contract.VERSION: ${VERSION}`])
}

// ── b. index.js 路由注册 ───────────────────────────────────────────────────
async function checkHostRoutes() {
  const code = stripComments(await readText('index.js'))
  const registered = []
  const unresolved = []

  // 支持三种写法：path: '/imagen-api/x'、path: ROUTES.x.path、path: ROUTES['x'].path
  for (const match of code.matchAll(/\bpath\s*:\s*([^,\n]+)/g)) {
    const expr = match[1].trim()
    const literal = expr.match(/^'([^']+)'$/) ?? expr.match(/^"([^"]+)"$/)
    if (literal) {
      registered.push(literal[1])
      continue
    }
    const reference = expr.match(
      /^ROUTES\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])\s*\.\s*path$/,
    )
    if (reference) {
      const name = reference[1] ?? reference[2]
      if (ROUTES[name]) {
        registered.push(ROUTES[name].path)
        continue
      }
    }
    unresolved.push(expr)
  }

  const details = []
  const unique = [...new Set(registered)]
  if (unique.length !== ROUTE_LIST.length) {
    details.push(`注册路由数 ${unique.length}，契约 ${ROUTE_LIST.length}`)
  }
  const missing = ROUTE_LIST.filter((route) => !unique.includes(route))
  const extra = unique.filter((route) => !ROUTE_SET.has(route))
  if (missing.length) details.push(`缺：${missing.join(', ')}`)
  if (extra.length) details.push(`多：${extra.join(', ')}`)
  if (unresolved.length) details.push(`无法静态解析的 path 表达式：${unresolved.join(' | ')}`)

  const literals = apiLiterals(code)
  const unknownLiterals = literals.filter((route) => !ROUTE_SET.has(route))
  if (unknownLiterals.length) details.push(`未登记路由字面量：${unknownLiterals.join(', ')}`)

  if (details.length) return fail('b', 'index.js 注册路由与契约不一致', details)
  pass('b', 'index.js 的 15 条注册路由与契约一致', `字面量 ${literals.length} 处均在表内`)
}

// ── c. lib 层路由字面量 ────────────────────────────────────────────────────
async function checkLibRoutes() {
  const files = await listSourceFiles('lib', ['.js'])
  const details = []
  let count = 0
  for (const file of files) {
    const code = stripComments(await readFile(join(ROOT, file), 'utf8'))
    const literals = apiLiterals(code)
    count += literals.length
    const unknown = literals.filter((route) => !ROUTE_SET.has(route))
    if (unknown.length) details.push(`${file}: ${unknown.join(', ')}`)
  }
  if (details.length) return fail('c', 'lib 内存在未登记路由字面量', details)
  pass('c', 'lib 内路由字面量均来自契约', `${files.length} 个文件、${count} 处`)
}

// ── d. 客户端不得自带前缀、不得越层 import ─────────────────────────────────
async function checkClientLayer() {
  const files = await listSourceFiles('src', ['.js', '.jsx'])
  const details = []
  const commentMentions = []
  let routePathFiles = 0
  for (const file of files) {
    const raw = await readFile(join(ROOT, file), 'utf8')
    const code = stripComments(raw)
    const codeHits = apiLiterals(code)
    if (codeHits.length) details.push(`${file}: 代码字面量 ${codeHits.join(', ')}`)
    if (raw.includes('imagen-api/') && codeHits.length === 0) commentMentions.push(file)
    if (code.includes('routePath')) routePathFiles += 1
    for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec.split('/').includes('lib')) details.push(`${file}: 越层 import ${spec}`)
    }
  }
  if (commentMentions.length) note(`注释中仍提及 imagen-api/：${commentMentions.join('、')}（不计失败）`)
  if (details.length) return fail('d', '客户端未完全走 routePath 或存在越层 import', details)
  pass('d', '客户端无 imagen-api 字面量、无 lib/ import', `${files.length} 个文件，${routePathFiles} 个使用 routePath`)
}

// ── e. 错误码 ──────────────────────────────────────────────────────────────
const HOST_CODE_PATTERNS = [
  /sendError\(\s*[^,]+,\s*\d+\s*,\s*'([^']+)'/g,
  /\bfail\(\s*'([^']+)'/g,
  /\bcode:\s*'([^']+)'/g,
  /\berrorCode:\s*'([^']+)'/g,
  /\bcode\s*=\s*'([^']+)'/g,
]

async function checkErrorCodes() {
  const files = ['index.js', ...(await listSourceFiles('lib', ['.js']))]
  const emitted = new Map()
  for (const file of files) {
    const code = stripComments(await readFile(join(ROOT, file), 'utf8'))
    for (const pattern of HOST_CODE_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const name = match[1]
        if (!emitted.has(name)) emitted.set(name, new Set())
        emitted.get(name).add(file)
      }
    }
  }

  const details = []
  const unknown = [...emitted.keys()].filter((name) => !(name in ERROR_CODES))
  if (unknown.length) {
    details.push(`未登记错误码：${unknown.map((name) => `${name}（${[...emitted.get(name)].join('/')}）`).join('、')}`)
  }

  const zh = await readText('src/dict/zh.js')
  const en = await readText('src/dict/en.js')
  const missingZh = HOST_CODES.filter((name) => !zh.includes(`'error.code.${name}'`))
  const missingEn = HOST_CODES.filter((name) => !en.includes(`'error.code.${name}'`))
  if (missingZh.length) details.push(`zh 字典缺文案：${missingZh.join(', ')}`)
  if (missingEn.length) details.push(`en 字典缺文案：${missingEn.join(', ')}`)

  if (details.length) return fail('e', '错误码未闭环', details)
  pass('e', `宿主 emit 的 ${emitted.size} 个错误码均登记且有中英文案`, `契约 host+remote ${HOST_CODES.length} 个`)
}

// ── f. 版本单源 ────────────────────────────────────────────────────────────
async function checkVersions() {
  const details = []
  const daemon = await readText('remote/daemon.py')
  const daemonVersion = daemon.match(/^VERSION\s*=\s*"([^"]+)"/m)
  if (!daemonVersion) details.push('remote/daemon.py 缺少 VERSION 常量')
  else if (daemonVersion[1] !== VERSION) details.push(`remote/daemon.py VERSION=${daemonVersion[1]}，契约=${VERSION}`)

  for (const file of ['test/mock-daemon.py', 'test/tunnel-probe.py']) {
    const text = await readText(file)
    const match = text.match(/^VERSION\s*=\s*"([^"]+)"/m)
    if (!match) {
      details.push(`${file} 缺少 VERSION 常量`)
      continue
    }
    const base = match[1].split('-')[0]
    if (base !== VERSION) details.push(`${file} VERSION=${match[1]}，前缀不是 ${VERSION}`)
  }

  // index.js 允许保留常量，但值必须与契约一致；改由 contract.VERSION 引用则跳过。
  const index = stripComments(await readText('index.js'))
  const indexVersion = index.match(/const\s+VERSION\s*=\s*'([^']+)'/)
  if (indexVersion && indexVersion[1] !== VERSION) {
    details.push(`index.js const VERSION=${indexVersion[1]}，契约=${VERSION}`)
  }

  if (details.length) return fail('f', '版本号未单源', details)
  pass('f', '版本号单源一致', `VERSION=${VERSION}`)
}

// ── g. daemon 协议 ────────────────────────────────────────────────────────
async function checkDaemonProtocol() {
  const daemon = await readText('remote/daemon.py')
  const details = []
  for (const [name, route] of Object.entries(PROTOCOL.daemon.routes)) {
    const quoted = daemon.includes(`"${route.path}"`) || daemon.includes(`'${route.path}'`)
    if (!quoted) details.push(`缺少 daemon 路由 ${name} ${route.path}`)
  }
  for (const phase of PROTOCOL.daemon.healthPhases) {
    const quoted = daemon.includes(`"${phase}"`) || daemon.includes(`'${phase}'`)
    if (!quoted) details.push(`缺少 health phase 取值 ${phase}`)
  }
  if (details.length) return fail('g', 'daemon 协议与契约不一致', details)
  pass('g', 'daemon 协议端点与 health 阶段齐全', `${Object.keys(PROTOCOL.daemon.routes).length} 路由、${PROTOCOL.daemon.healthPhases.length} 个 phase`)
}

// ── h. SPEC 文档跟随契约 ──────────────────────────────────────────────────
async function checkSpecDoc() {
  const spec = await readText('docs/SPEC.md')
  const details = []
  for (const route of ROUTE_LIST) {
    const pattern = new RegExp(`${escapeRegExp(route)}(?![A-Za-z0-9_\\-/])`)
    if (!pattern.test(spec)) details.push(`缺少路由：${route}`)
  }
  for (const code of HOST_CODES) {
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(code)}(?![A-Za-z0-9_])`)
    if (!pattern.test(spec)) details.push(`缺少错误码：${code}`)
  }
  if (details.length) return fail('h', 'docs/SPEC.md 未跟随契约', details)
  pass('h', 'docs/SPEC.md 覆盖全部路由与 host+remote 错误码', `${ROUTE_LIST.length} 路由、${HOST_CODES.length} 错误码`)
}

// ── i. 预设数据已上移 ─────────────────────────────────────────────────────
async function checkPresetsMoved() {
  const code = stripComments(await readText('lib/presets.js'))
  const hits = ['sdxl-lightning', 'sdxl-turbo', 'sdxl-base', 'flux2-klein-4b'].filter((id) => code.includes(id))
  if (hits.length) return fail('i', 'lib/presets.js 仍在定义预设数据', [`出现预设 id 字面量：${hits.join(', ')}`])
  pass('i', 'lib/presets.js 只引用契约，不再定义预设数据')
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('契约校验（shared/contract.js 为唯一来源）')
  console.log(`VERSION=${VERSION}  路由=${ROUTE_LIST.length}  错误码=${Object.keys(ERROR_CODES).length}（host+remote ${HOST_CODES.length}）  预设=${PRESETS.length}`)
  console.log('')

  await checkPackageVersion()
  await checkHostRoutes()
  await checkLibRoutes()
  await checkClientLayer()
  await checkErrorCodes()
  await checkVersions()
  await checkDaemonProtocol()
  await checkSpecDoc()
  await checkPresetsMoved()

  console.log('')
  if (failedChecks.length === 0) {
    console.log(`契约校验通过：${passed}/9 项`)
    return
  }
  console.log(`契约校验失败：${failedChecks.length}/9 项未通过（${failedChecks.join(', ')}）`)
  process.exitCode = 1
}

main().catch((error) => {
  console.error('契约校验脚本自身出错：', error)
  process.exitCode = 1
})
