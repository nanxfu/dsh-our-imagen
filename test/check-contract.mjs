/**
 * 契约单一来源校验（A 阶段 P1 验收脚本，只读）。
 *
 * 校验目标：`shared/contract.js` 是唯一契约源，仓库里的宿主 / 客户端 / 远端 / 测试 / 文档
 * 是否都跟着它走。脚本只读文件，不改任何东西；失败时退出码 1，并把缺失/多余项原样列出。
 *
 * 检查项（对应 docs/refactor/REFACTOR_PROPOSAL.md P1）：
 *   a. package.json.version === contract.VERSION
 *   b. 路由注册（index.js + lib/**）去重后 === ROUTES；出现的 /imagen-api/ 字面量 ⊆ 路由表
 *   c. lib/**\/*.js 内的 /imagen-api/ 字面量 ⊆ 路由表（lib/output.js 拼预览 URL 用得到）
 *   d. src/**\/*.js(x) 不出现 'imagen-api/' 字面量、不 import lib/（必须走 routePath）
 *   e. index.js + lib 内 emit 的错误码 ⊆ ERROR_CODES；hostErrorCodes() 在 zh/en 字典都有文案
 *   f. 版本单源：daemon.py / mock-daemon.py / tunnel-probe.py（及 index.js 若仍有常量）
 *   g. daemon 协议：/health /logs /generate /shutdown 与 healthPhases 全部取值
 *   h. docs/SPEC.md 包含全部路由路径与全部 host+remote 错误码
 *   i. lib/presets.js 不再定义预设数据
 *   j. remote/contract.json 与 shared/contract.js 的 daemonContract() 一致，且下发对象只含
 *      version + limits（Host/Client 专有的路由、health phase、ntfy 事件、错误码不再下发远端；P10 生成物）
 *   k. models/*.json 与 shared/models.generated.js 同步（模型资产的唯一来源是 models/）
 *
 * 运行：node test/check-contract.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  VERSION,
  ROUTES,
  ERROR_CODES,
  PRESETS,
  PROTOCOL,
  daemonContract,
  hostErrorCodes,
} from '../shared/contract.js'
import { loadModels, renderGenerated, readGenerated } from '../tools/build-assets.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROUTE_LIST = Object.values(ROUTES).map((route) => route.path)
// 同一 path 可以有多条 entry（如 settings 的 GET 读 / POST 存）：注册端按 path 去重比较，
// 因此「期望集合」也要先去重，否则永远差 1 条。
const ROUTE_PATH_LIST = [...new Set(ROUTE_LIST)]
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

// ── b. 路由注册（index.js + lib/**）──────────────────────────────────────
// 路由注册从 index.js 拆到 lib/routes/** 后，注册点可能分布在多处；这里统一扫描
// index.js 与 lib 下所有 .js，支持「字面量」与「ROUTES 引用」两类写法，去重后比对契约。

/** camelCase → kebab-case，用于 effect 标签软检查（sessionStart → session-start）。 */
function kebabCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

/** 本文件里代表 ROUTES 的标识符：默认 ROUTES，外加 `import { ROUTES as R }` 的别名。 */
function routeRoots(code) {
  const roots = ['ROUTES']
  for (const match of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]*shared\/contract\.js['"]/g)) {
    for (const part of match[1].split(',')) {
      const alias = part.trim().match(/^ROUTES\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (alias) roots.push(alias[1])
    }
  }
  return roots
}

/** 单文件内从 ROUTES 解构出的别名（`const { state, probe: p } = ROUTES` → p.path 可解析）。 */
function routeAliases(code, roots) {
  const rootPattern = roots.map(escapeRegExp).join('|')
  const pattern = new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*(?:${rootPattern})\\b`, 'g')
  const aliases = new Map()
  for (const match of code.matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim()
      if (!piece) continue
      const field = piece.match(/^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?$/)
      if (!field) continue
      aliases.set(field[2] ?? field[1], field[1])
    }
  }
  return aliases
}

/**
 * 解析一个 `path:` 表达式：
 *  - literal：字符串或无插值模板字符串（`'/imagen-api/x'`）；
 *  - route：`ROUTES.x.path`、`ROUTES['x'].path`（含 import 别名）或解构别名 `x.path`；
 *  - unresolved：引用了 ROUTES 但无法静态解析（必须报出来，不能静默放过）；
 *  - ignored：与路由无关的 path 属性（如 lib/output.js 的图片记录 `path: relative`）。
 */
function resolvePathExpression(expr, aliases, roots) {
  // 去掉对象/调用收尾的噪音字符（`path: ROUTES.x.path }`、`path: relative })`），
  // 否则同一行没有逗号时会把合法的字面量/引用误判成 ignored。
  const text = expr.trim().replace(/[\s})\]]+$/, '')
  const literal = text.match(/^'([^']*)'$/) ?? text.match(/^"([^"]*)"$/) ?? text.match(/^`([^`$]*)`$/)
  if (literal) return { kind: 'literal', value: literal[1] }
  const rootPattern = roots.map(escapeRegExp).join('|')
  const routeRef = text.match(
    new RegExp(`^(?:${rootPattern})\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*['"]([A-Za-z_$][\\w$]*)['"]\\s*\\])\\s*\\.\\s*path$`),
  )
  if (routeRef) return { kind: 'route', name: routeRef[1] ?? routeRef[2] }
  const aliasRef = text.match(/^([A-Za-z_$][\w$]*)\s*\.\s*path$/)
  if (aliasRef && aliases.has(aliasRef[1])) return { kind: 'route', name: aliases.get(aliasRef[1]) }
  if (new RegExp(`\\b(?:${rootPattern})\\b`).test(text)) return { kind: 'unresolved', expr: text }
  return { kind: 'ignored', expr: text }
}

/**
 * 从 `[{ file, text }]` 收集路由注册；导出给 `%TEMP%` 模拟脚本复用。
 * @returns {{ paths: {file:string,path:string}[], unresolved: {file:string,expr:string}[],
 *             ignored: {file:string,expr:string}[], literals: {file:string,literal:string}[],
 *             effectLabels: Set<string> }}
 */
export function collectRouteRegistrations(entries) {
  const paths = []
  const unresolved = []
  const ignored = []
  const literals = []
  const effectLabels = new Set()
  const routeNames = new Set()
  for (const { file, text } of entries) {
    const code = stripComments(text)
    const roots = routeRoots(code)
    const aliases = routeAliases(code, roots)
    for (const match of code.matchAll(/\bpath\s*:\s*([^,\n]+)/g)) {
      const resolved = resolvePathExpression(match[1], aliases, roots)
      if (resolved.kind === 'literal') {
        if (resolved.value.startsWith('/')) paths.push({ file, path: resolved.value })
        else ignored.push({ file, expr: resolved.value })
      } else if (resolved.kind === 'route') {
        if (ROUTES[resolved.name]) paths.push({ file, path: ROUTES[resolved.name].path })
        else unresolved.push({ file, expr: `ROUTES.${resolved.name}.path（契约未登记）` })
      } else if (resolved.kind === 'unresolved') {
        unresolved.push({ file, expr: resolved.expr })
      } else {
        ignored.push({ file, expr: resolved.expr })
      }
    }
    for (const literal of apiLiterals(code)) literals.push({ file, literal })
    // effect 标签软检查素材：静态标签、路由描述对象的 name（lib/route-kit.js 生成 `imagen:route-${route.name}`）。
    for (const match of code.matchAll(/imagen:route-([a-z0-9-]+)/g)) effectLabels.add(match[1])
    for (const match of code.matchAll(/\bname\s*:\s*'([a-z][a-z0-9-]*)'/g)) routeNames.add(match[1])
  }
  return { paths, unresolved, ignored, literals, effectLabels, routeNames }
}

async function checkHostRoutes() {
  const files = ['index.js', ...(await listSourceFiles('lib', ['.js']))]
  const entries = []
  for (const file of files) entries.push({ file, text: await readFile(join(ROOT, file), 'utf8') })
  const { paths, unresolved, ignored, literals, effectLabels, routeNames } = collectRouteRegistrations(entries)

  const details = []
  const unique = [...new Set(paths.map((item) => item.path))]
  // 契约里同一 path 可能对应多条位（GET/POST），注册端只能按 path 表达，故按唯一路径比较。
  if (unique.length !== ROUTE_PATH_LIST.length) {
    details.push(`注册路由数 ${unique.length}，契约唯一路径 ${ROUTE_PATH_LIST.length}（共 ${ROUTE_LIST.length} 条 entry）`)
  }
  const missing = ROUTE_PATH_LIST.filter((route) => !unique.includes(route))
  const extra = unique.filter((route) => !ROUTE_SET.has(route))
  if (missing.length) details.push(`缺：${missing.join(', ')}`)
  if (extra.length) details.push(`多：${extra.join(', ')}`)
  if (unresolved.length) {
    details.push(
      `无法静态解析的 path 表达式：${unresolved.map((item) => `${item.file}: ${item.expr}`).join(' | ')}`,
    )
  }

  const uniqueLiterals = [...new Set(literals.map((item) => item.literal))]
  const unknownLiterals = uniqueLiterals.filter((literal) => !ROUTE_SET.has(literal))
  if (unknownLiterals.length) {
    details.push(
      `未登记路由字面量：${unknownLiterals
        .map((literal) => {
          const where = [...new Set(literals.filter((item) => item.literal === literal).map((item) => item.file))]
          return `${literal}（${where.join('/')}）`
        })
        .join(', ')}`,
    )
  }

  if (ignored.length) {
    const samples = [...new Set(ignored.map((item) => `${item.file}: path: ${item.expr}`))].slice(0, 3)
    note(`忽略 ${ignored.length} 处非路由 path 表达式（如 ${samples.join('；')}）`)
  }
  // effect 标签软检查：拆分前每条路由注册的标签是 `imagen:route-<kebab(name)>`；
  // 拆分后由 lib/route-kit.js 用 `imagen:route-${route.name}` 生成，因此同时接受
  // “静态标签”和“路由描述对象的 name 字段”两种证据。只 note、不计失败。
  const expectedNames = Object.keys(ROUTES).map((name) => kebabCase(name))
  const covered = expectedNames.filter((name) => effectLabels.has(name) || routeNames.has(name))
  const missingNames = expectedNames.filter((name) => !covered.includes(name))
  if (covered.length > 0 && missingNames.length) {
    note(
      `effect 标签覆盖 ${covered.length}/${expectedNames.length}（不计失败）：缺 ${missingNames
        .map((name) => `imagen:route-${name}`)
        .join(', ')}`,
    )
  }

  if (details.length) return fail('b', '路由注册（index.js + lib/**）与契约不一致', details)
  const filesWithRoutes = [...new Set(paths.map((item) => item.file))]
  pass(
    'b',
    `路由注册与契约一致（去重 ${unique.length} 条路径）`,
    `契约 ${ROUTE_LIST.length} 条 entry、扫描 ${files.length} 个文件，命中 ${filesWithRoutes.length} 个`,
  )
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

// ── j. remote/contract.json 与 daemonContract() 一致 ──────────────────────

/** 深比较两个 JSON 值，把差异路径收集到 `out`（键顺序不计）。 */
export function collectContractDiff(expected, actual, out = [], path = '') {
  const kind = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)
  const expectedKind = kind(expected)
  const actualKind = kind(actual)
  if (expectedKind !== actualKind) {
    out.push(`${path || '（根）'}: 期望 ${expectedKind}，实际 ${actualKind}`)
    return out
  }
  if (expectedKind === 'object') {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      const child = path ? `${path}.${key}` : key
      if (!(key in expected)) out.push(`${child}: 实际多出 ${JSON.stringify(actual[key])}`)
      else if (!(key in actual)) out.push(`${child}: 实际缺失（期望 ${JSON.stringify(expected[key])}）`)
      else collectContractDiff(expected[key], actual[key], out, child)
    }
    return out
  }
  if (expectedKind === 'array') {
    if (expected.length !== actual.length) {
      out.push(`${path}: 数组长度 期望 ${expected.length}，实际 ${actual.length}`)
      return out
    }
    expected.forEach((item, index) => collectContractDiff(item, actual[index], out, `${path}[${index}]`))
    return out
  }
  if (!Object.is(expected, actual)) {
    out.push(`${path || '（根）'}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
  return out
}

async function checkRemoteContract() {
  const rel = 'remote/contract.json'
  let text
  try {
    text = await readText(rel)
  } catch {
    return fail('j', `${rel} 不存在或不可读`, [
      '契约导出物缺失：先运行 `node tools/gen-contract-json.mjs` 生成（P10-a）',
    ])
  }
  let actual
  try {
    actual = JSON.parse(text)
  } catch (error) {
    return fail('j', `${rel} 不是合法 JSON`, [String(error?.message ?? error)])
  }
  const expected = daemonContract()
  // 形状锁定：daemon 只消费 contract.version 与 contract.limits。routes / healthPhases /
  // ntfyEvents / errorCodes 属于 Host/Client，若被重新塞回下发对象，这里必须失败。
  const topKeys = Object.keys(expected).sort()
  if (topKeys.join(',') !== 'limits,version') {
    return fail('j', 'daemonContract() 顶层字段不符合远端契约（应只含 version + limits）', [
      `实际顶层键：${topKeys.join(', ') || '（空）'}`,
    ])
  }
  const diffs = collectContractDiff(expected, actual)
  if (diffs.length) {
    const shown = diffs.slice(0, 20)
    if (diffs.length > shown.length) shown.push(`…共 ${diffs.length} 处差异`)
    return fail('j', `${rel} 与 daemonContract() 不一致`, shown)
  }
  pass('j', `${rel} 与 daemonContract() 一致`, `${Object.keys(expected).length} 个顶层键：${topKeys.join(' + ')}`)
}

// ── k. 模型资产生成文件同步 ───────────────────────────────────────────────
// models/*.json 是模型定义的唯一来源；shared/models.generated.js 是构建产物。
// 这里直接复用 build-assets 的读取/渲染函数，避免两套校验口径。
async function checkModelAssets() {
  try {
    const models = await loadModels()
    const expected = renderGenerated(models)
    const actual = await readGenerated()
    if (actual === expected) {
      const ids = models.map((model) => model.id).join(', ')
      return pass('k', '模型资产生成文件与 models/ 同步', `${models.length} 个：${ids}`)
    }
    return fail('k', 'shared/models.generated.js 与 models/ 不同步', [
      actual === null ? '生成文件缺失' : '生成文件内容与 models/ 不一致',
      '修改模型后运行 npm run models:build（node tools/build-assets.mjs）',
    ])
  } catch (error) {
    return fail('k', '模型资产校验未通过', [String(error?.message ?? error)])
  }
}

// ── main ──────────────────────────────────────────────────────────────────
const CHECKS = [
  checkPackageVersion,
  checkHostRoutes,
  checkLibRoutes,
  checkClientLayer,
  checkErrorCodes,
  checkVersions,
  checkDaemonProtocol,
  checkSpecDoc,
  checkPresetsMoved,
  checkRemoteContract,
  checkModelAssets,
]

async function main() {
  console.log('契约校验（shared/contract.js 为唯一来源）')
  console.log(`VERSION=${VERSION}  路由=${ROUTE_LIST.length}  错误码=${Object.keys(ERROR_CODES).length}（host+remote ${HOST_CODES.length}）  预设=${PRESETS.length}`)
  console.log('')

  for (const check of CHECKS) await check()

  console.log('')
  const total = CHECKS.length
  if (failedChecks.length === 0) {
    console.log(`契约校验通过：${passed}/${total} 项`)
    return
  }
  console.log(`契约校验失败：${failedChecks.length}/${total} 项未通过（${failedChecks.join(', ')}）`)
  process.exitCode = 1
}

// 仅当本文件被直接执行时跑校验；被 `%TEMP%` 模拟脚本 import 时只复用 collectRouteRegistrations。
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error('契约校验脚本自身出错：', error)
    process.exitCode = 1
  })
}
