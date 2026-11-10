/**
 * Kernel 目录构建：把 remote/daemon.py 连同一次性配置打包成 Kaggle 可推送的脚本。
 *
 * 配置以 Base64 JSON 注入脚本内的 `EMBEDDED_CONFIG_B64` 赋值行，
 * 这样 Kernel 侧不需要任何环境变量或额外文件。
 * `datasetSources` 写入 kernel-metadata 的 `dataset_sources`，用于挂载预置权重 Dataset。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger } from './log.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON_SOURCE = join(PLUGIN_ROOT, 'remote', 'daemon.py')
const log = createLogger({ scope: 'kernel' })

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

  const source = await readFile(sourcePath, 'utf8')
  // 只替换行首的赋值语句：脚本注释或文档字符串里可能出现同样的字面量。
  const marker = /^EMBEDDED_CONFIG_B64 = ""[ \t]*$/m
  if (!marker.test(source)) {
    throw new Error('源脚本缺少可注入的 EMBEDDED_CONFIG_B64 占位行')
  }
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
  const patched = source.replace(marker, `EMBEDDED_CONFIG_B64 = "${encoded}"`)
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
}

/** 清掉临时目录；失败只忽略（临时目录由系统回收）。 */
export async function removeKernelFolder(dir) {
  if (!dir) return
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}