/**
 * Kernel 目录构建：把 remote/daemon.py 连同一次性配置打包成 Kaggle 可推送的脚本。
 *
 * 配置以 Base64 JSON 注入脚本内的 `EMBEDDED_CONFIG_B64` 赋值行，
 * 这样 Kernel 侧不需要任何环境变量或额外文件。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON_SOURCE = join(PLUGIN_ROOT, 'remote', 'daemon.py')

/** 生成 8 位十六进制后缀，用作 kernel slug（同一 slug 反复推送会覆盖同一 kernel）。 */
export function randomSlug() {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

/**
 * @param {object} options
 * @param {string} options.username Kaggle 用户名
 * @param {string} options.slug kernel 名后缀
 * @param {object} options.config 注入 daemon 的配置（键由 lib/session/provisioner.js 的
 *   buildKernelConfig 组装，daemon 侧接受清单见 remote/daemon.py 的 _KNOWN_CONFIG_KEYS；
 *   其中 `contract` 是 daemonContract() 的子集，daemon 侧据此校验边界与版本）
 * @param {string} [options.sourcePath] 要打包的脚本，默认 remote/daemon.py；测试可换成探针脚本
 * @param {boolean} [options.enableGpu] 是否申请 GPU（探针脚本用 CPU 即可）
 * @returns {Promise<{ dir: string, kernelId: string, kernelUrl: string, metadata: object }>}
 */
export async function buildKernelFolder({ username, slug, config, sourcePath = DAEMON_SOURCE, enableGpu = true }) {
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
    dataset_sources: [],
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
