/**
 * Kernel 目录构建：把 remote/daemon.py 连同一次性配置打包成 Kaggle 可推送的脚本。
 *
 * 配置以 Base64 JSON 注入脚本内的 `EMBEDDED_CONFIG_B64` 赋值行，
 * 这样 Kernel 侧不需要任何环境变量或额外文件。
 * `datasetSources` 写入 kernel-metadata 的 `dataset_sources`，用于挂载预置权重 Dataset。
 *
 * Kaggle 只接受单个 `code_file`，所以脚本里带 `# @@INLINE:<模块>.py@@` 标记的行会在
 * 这里被替换成 remote/ 下对应模块的全文（当前只有 anima 运行时）；仓库内仍按普通模块
 * import 维护单份源码，见 `inlineMarkedModules`。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from './log.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REMOTE_DIR = join(PLUGIN_ROOT, 'remote')
const DAEMON_SOURCE = join(REMOTE_DIR, 'daemon.py')
const log = createLogger({ scope: 'kernel' })

/** 内联标记：整行（通常是 `from anima_runtime import ...`）替换为 remote/ 下模块全文。 */
export const INLINE_MARKER_PATTERN = /^[^\n]*#\s*@@INLINE:([A-Za-z0-9_.-]+\.py)@@[ \t]*$/

/** 判断源码里是否还有待处理的内联标记行（打包自检用；普通提及标记的注释不算）。 */
export function hasInlineMarkerLine(source) {
  return String(source)
    .split('\n')
    .some((line) => INLINE_MARKER_PATTERN.test(line))
}

/** Kaggle Dataset 标识：`owner/dataset`（首字符字母数字，允许 `.` `_` `-`）。 */
const DATASET_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 生成 8 位十六进制后缀，用作 kernel slug（同一 slug 反复推送会覆盖同一 kernel）。 */
export function randomSlug() {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

/**
 * 过滤非法的 Kaggle Dataset 标识并去重。
 *
 * `dataset_sources` 里出现非法值时 `kaggle kernels push` 会直接失败，所以这里
 * 按「可选优化项」处理：剔除坏值、留下可用值，不让一处配置笔误拖垮整个会话启动。
 *
 * @param {unknown} list 配置里的 datasetSources
 * @returns {string[]} 合法的 `owner/dataset` 列表（保持原顺序）
 */
export function normalizeDatasetSources(list) {
  if (!Array.isArray(list)) {
    if (list != null) log.warn('datasetSources 不是数组，已忽略')
    return []
  }
  const sources = []
  for (const item of list) {
    if (typeof item !== 'string') {
      log.warn('datasetSources 中的非字符串项已忽略', item)
      continue
    }
    const value = item.trim()
    if (!value) continue
    if (!DATASET_SOURCE_RE.test(value)) {
      log.warn('忽略非法的 Kaggle Dataset 标识（应为 owner/dataset）', value)
      continue
    }
    if (!sources.includes(value)) sources.push(value)
  }
  return sources
}

/**
 * 把脚本里的 `# @@INLINE:<模块>.py@@` 标记行替换为 remote/<模块>.py 的全文。
 *
 * 背景：Kaggle 只接受 kernel-metadata 里的单个 `code_file`，但 `remote/daemon.py` 与
 * `tools/payload/verify-model.py` 需要共用同一份 anima 运行时。约定是两边源码各留一行
 * 带标记的普通 import（本地直接 import），推送前在打包阶段内联成单文件；这样既不用维护
 * 两份实现，也不违反 Kaggle 的单文件约束。
 *
 * - 只替换标记所在的整行，标记外的内容逐字保留；
 * - 同一个模块只允许内联一次（重复标记会让产物出现两份定义，直接报错）；
 * - 没有标记的脚本原样返回（探针脚本 / 其它单文件源仍可走 buildKernelFolder）。
 *
 * @param {string} source 脚本源码
 * @returns {Promise<string>} 内联后的源码（仍为单文件）
 */
export async function inlineMarkedModules(source) {
  const output = []
  const inlined = new Set()
  for (const line of String(source).split('\n')) {
    const match = line.match(INLINE_MARKER_PATTERN)
    if (!match) {
      output.push(line)
      continue
    }
    const moduleName = match[1]
    if (moduleName.includes('..')) throw new Error(`内联标记的模块名非法：${moduleName}`)
    if (inlined.has(moduleName)) {
      throw new Error(`内联标记重复：${moduleName}（产物会包含两份实现）`)
    }
    let text
    try {
      text = await readFile(join(REMOTE_DIR, moduleName), 'utf8')
    } catch (error) {
      throw new Error(`内联失败：读不到 remote/${moduleName}（${error?.message ?? error}）`)
    }
    if (!text.trim()) throw new Error(`内联失败：remote/${moduleName} 是空文件`)
    output.push(...text.replace(/\r\n/g, '\n').trimEnd().split('\n'))
    inlined.add(moduleName)
  }
  return output.join('\n')
}

/**
 * @param {object} options
 * @param {string} options.username Kaggle 用户名
 * @param {string} options.slug kernel 名后缀
 * @param {object} options.config 注入 daemon 的配置（键由 lib/session/provisioner.js 的
 *   buildKernelConfig 组装，daemon 侧接受清单见 remote/daemon.py 的 _KNOWN_CONFIG_KEYS；
 *   其中 `contract` 是 daemonContract() 的子集，daemon 侧据此校验边界与版本）
 * @param {string[]} [options.datasetSources] 预挂载的 Kaggle Dataset（`owner/dataset`）
 * @param {string} [options.sourcePath] 要打包的脚本，默认 remote/daemon.py；测试可换成探针脚本
 * @param {boolean} [options.enableGpu] 是否申请 GPU（探针脚本用 CPU 即可）
 * @returns {Promise<{ dir: string, kernelId: string, kernelUrl: string, metadata: object }>}
 */
export async function buildKernelFolder({
  username,
  slug,
  config,
  datasetSources = [],
  sourcePath = DAEMON_SOURCE,
  enableGpu = true,
}) {
  const kernelSlug = `imagen-${slug}`
  const kernelId = `${username}/${kernelSlug}`
  const dir = await mkdtemp(join(tmpdir(), 'our-free-imagen-'))
  try {
    const source = await readFile(sourcePath, 'utf8')
    // Kaggle 只接受单个 code_file：先把共享模块的标记行内联成全文，保证产物自包含。
    const inlinedSource = await inlineMarkedModules(source)
    // 只替换行首的赋值语句：脚本注释或文档字符串里可能出现同样的字面量。
    const marker = /^EMBEDDED_CONFIG_B64 = ""[ \t]*$/m
    if (!marker.test(inlinedSource)) {
      throw new Error('源脚本缺少可注入的 EMBEDDED_CONFIG_B64 占位行')
    }
    const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
    const patched = inlinedSource.replace(marker, `EMBEDDED_CONFIG_B64 = "${encoded}"`)
    await writeFile(join(dir, 'daemon.py'), patched, 'utf8')

    const metadata = {
      id: kernelId,
      title: kernelSlug,
      code_file: 'daemon.py',
      language: 'python',
      kernel_type: 'script',
      is_private: true,
      enable_gpu: enableGpu,
      enable_tpu: false,
      enable_internet: true,
      machine_shape: '',
      // 预挂载的权重 Dataset（P2.1）：空数组是 Kaggle 接受的最简形态。
      dataset_sources: normalizeDatasetSources(datasetSources),
      competition_sources: [],
      kernel_sources: [],
      model_sources: [],
    }
    await writeFile(join(dir, 'kernel-metadata.json'), JSON.stringify(metadata, null, 2), 'utf8')

    return {
      dir,
      kernelId,
      kernelUrl: `https://www.kaggle.com/code/${kernelId}`,
      metadata,
    }
  } catch (error) {
    // 构建失败也不能留下临时目录：写成功的 daemon.py 里带着本次会话的 auth_token。
    await removeKernelFolder(dir)
    throw error
  }
}

/** 清掉临时目录；失败只忽略（临时目录由系统回收）。 */
export async function removeKernelFolder(dir) {
  if (!dir) return
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}