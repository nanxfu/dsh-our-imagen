/**
 * Kernel 目录构建：把远端源码包与一次性配置打包成 Kaggle 可推送的单文件脚本。
 *
 * 部署形态（Kaggle 只接受单个 `code_file`）：
 * - **归档模式**（默认）：`remote/` 整包压成 ZIP → Base64 内嵌进 `remote/_entry.py` 模板，
 *   启动时解压到临时目录再调用包内入口。业务源码因此可以按标准 Python 包分层。
 * - **脚本模式**（传 `sourcePath`）：直接打包指定的单文件脚本（真机探针
 *   `test/tunnel-probe.py` 走这条），只做配置注入。
 *
 * 配置注入：两种模式都只替换启动器里 `EMBEDDED_CONFIG_B64` 那一行赋值，不再改动业务源码。
 * `datasetSources` 写入 kernel-metadata 的 `dataset_sources`，用于挂载预置权重 Dataset。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildBundle, REMOTE_DIR } from './bundle.js'
import { createLogger } from './log.js'

const ENTRY_TEMPLATE = join(REMOTE_DIR, '_entry.py')
const log = createLogger({ scope: 'kernel' })

/** 启动器里必须被替换的占位符（带引号形态，避免命中模板注释里的同名字面量）。 */
const ENTRY_PLACEHOLDERS = ['"@@CONFIG_B64@@"', '"@@BUNDLE_B64@@"', '"@@ENTRY_MODULE@@"']

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
 * 渲染启动器：把配置、源码包与入口模块名填进 `remote/_entry.py` 模板。
 *
 * @param {object} options
 * @param {object} options.config 注入 daemon 的配置对象
 * @param {Buffer} options.bundle 源码包 ZIP
 * @param {string} [options.entryModule] 包内入口模块
 * @returns {Promise<string>} 启动器源码
 */
async function renderEntry({ config, bundle, entryModule = 'remote.daemon' }) {
  let source
  try {
    source = await readFile(ENTRY_TEMPLATE, 'utf8')
  } catch (error) {
    throw new Error(`读不到启动器模板 remote/_entry.py（${error?.message ?? error}）`)
  }
  if (!Buffer.isBuffer(bundle) || bundle.length === 0) throw new Error('源码包为空，拒绝生成启动器')
  for (const placeholder of ENTRY_PLACEHOLDERS) {
    const hits = source.split(placeholder).length - 1
    if (hits !== 1) {
      throw new Error(`启动器模板占位符 ${placeholder} 出现 ${hits} 次，应恰好 1 次`)
    }
  }
  const encodedConfig = Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
  return source
    .replace('"@@CONFIG_B64@@"', () => JSON.stringify(encodedConfig))
    .replace('"@@BUNDLE_B64@@"', () => JSON.stringify(bundle.toString('base64')))
    .replace('"@@ENTRY_MODULE@@"', () => JSON.stringify(String(entryModule)))
}

/**
 * 只渲染启动器（不建 Kaggle 目录）：Colab 等平台把 remote/ 打成单文件上传即可运行。
 *
 * 与 Kaggle 路径共用同一份启动器模板与打包逻辑，避免两套启动方式漂移。
 *
 * @param {{ config: object, entryModule?: string }} options
 * @returns {Promise<string>} 启动器源码（含注入配置与源码包）
 */
export async function buildRemoteLauncher({ config, entryModule = 'remote.daemon' }) {
  const built = await buildBundle()
  return renderEntry({ config, bundle: built.bytes, entryModule })
}

/**
 * 脚本模式：把配置注入一个单文件脚本，不动其它任何一行。
 * @param {string} source 脚本源码
 * @param {object} config 注入配置
 * @returns {string}
 */
function injectScriptConfig(source, config) {
  // 只替换行首的赋值语句：脚本注释或文档字符串里可能出现同样的字面量。
  const marker = /^EMBEDDED_CONFIG_B64 = ""[ \t]*$/m
  if (!marker.test(source)) throw new Error('源脚本缺少可注入的 EMBEDDED_CONFIG_B64 占位行')
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
  return source.replace(marker, `EMBEDDED_CONFIG_B64 = "${encoded}"`)
}

/**
 * @param {object} options
 * @param {string} options.username Kaggle 用户名
 * @param {string} options.slug kernel 名后缀
 * @param {object} options.config 注入配置（键由 lib/session/provisioner.js 的
 *   buildKernelConfig 组装，daemon 侧接受清单见 remote/daemon.py 的 _KNOWN_CONFIG_KEYS；
 *   其中 `contract` 是 daemonContract() 的子集，daemon 侧据此校验边界与版本）
 * @param {string[]} [options.datasetSources] 预挂载的 Kaggle Dataset（`owner/dataset`）
 * @param {string} [options.sourcePath] 脚本模式：要打包的单文件脚本；不传则打源码包
 * @param {string} [options.entryModule] 归档模式的入口模块，默认 remote.daemon
 * @param {Array<{ from: string, to: string }>} [options.extraFiles] 归档模式的额外文件
 * @param {boolean} [options.enableGpu] 是否申请 GPU（探针脚本用 CPU 即可）
 * @returns {Promise<{ dir: string, kernelId: string, kernelUrl: string, metadata: object, bundle: { digest: string, files: number } | null }>}
 */
export async function buildKernelFolder({
  username,
  slug,
  config,
  datasetSources = [],
  sourcePath = null,
  entryModule = 'remote.daemon',
  extraFiles = [],
  enableGpu = true,
}) {
  const kernelSlug = `imagen-${slug}`
  const kernelId = `${username}/${kernelSlug}`
  const dir = await mkdtemp(join(tmpdir(), 'our-imagen-'))
  try {
    let script
    let bundleInfo = null
    if (sourcePath) {
      script = injectScriptConfig(await readFile(sourcePath, 'utf8'), config)
    } else {
      const built = await buildBundle({ extraFiles })
      bundleInfo = { digest: built.digest, files: built.files.length }
      script = await renderEntry({ config, bundle: built.bytes, entryModule })
    }
    await writeFile(join(dir, 'daemon.py'), script, 'utf8')

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
      bundle: bundleInfo,
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
