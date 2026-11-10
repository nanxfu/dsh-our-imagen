/**
 * 从 shared/contract.js 的 daemonContract() 生成 remote/contract.json。
 *
 * 背景：daemon.py 是 Kaggle 单文件、mock-daemon.py 是独立 Python，两者都无法 import JS。
 * 这份 JSON 是"daemon 需要的契约子集"的落盘形态，供 mock 启动时加载并与 daemon 的边界对齐；
 * 真机 daemon 仍由 lib/kernel.js 把同一个 daemonContract() 注入 config.contract，不读本文件。
 *
 * 用法：
 *   node tools/gen-contract-json.mjs            # 生成/覆盖 remote/contract.json
 *   node tools/gen-contract-json.mjs --check    # 只比较不写盘；不一致时退出码 1（供 CI/测试复用）
 *
 * 输出约定：UTF-8、LF、2 空格缩进、末尾换行、键序稳定
 * （顶层固定 version→limits；limits 各项的子键按字典序排序）。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { daemonContract } from '../shared/contract.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

export const CONTRACT_PATH = join(ROOT, 'remote', 'contract.json')

/** 按 key 字典序排序，保证生成物逐字节稳定。 */
function sortByKey(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

/**
 * 生成 daemon 契约对象（只保留 daemon 需要的字段，键序固定）。
 * @returns {object}
 */
export function buildDaemonContractJson() {
  const contract = daemonContract()
  return {
    version: contract.version,
    limits: {
      width: sortByKey(contract.limits.width),
      height: sortByKey(contract.limits.height),
      steps: sortByKey(contract.limits.steps),
      cfg: sortByKey(contract.limits.cfg),
      count: sortByKey(contract.limits.count),
      seed: sortByKey(contract.limits.seed),
      prompt: sortByKey(contract.limits.prompt),
      negativePrompt: sortByKey(contract.limits.negativePrompt),
      historyTool: sortByKey(contract.limits.historyTool),
    },
  }
}

/** 生成物全文（含末尾换行）。mock 与 check 都按这个文本比较。 */
export function contractJsonText() {
  return `${JSON.stringify(buildDaemonContractJson(), null, 2)}\n`
}

/** 首个不同字节的偏移，仅用于 --check 失败时帮助定位。 */
function firstDiff(expected, actual) {
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) return index
  }
  return -1
}

async function main() {
  const text = contractJsonText()
  const check = process.argv.includes('--check')

  if (check) {
    let current = null
    try {
      current = await readFile(CONTRACT_PATH, 'utf8')
    } catch {
      current = null
    }
    if (current === text) {
      console.log('remote/contract.json 与 shared/contract.js 一致')
      return
    }
    if (current === null) {
      console.error('remote/contract.json 不存在，请运行 node tools/gen-contract-json.mjs')
    } else {
      console.error(
        `remote/contract.json 与 shared/contract.js 不一致（首个差异偏移 ${firstDiff(text, current)}），` +
          '请运行 node tools/gen-contract-json.mjs',
      )
    }
    process.exitCode = 1
    return
  }

  await writeFile(CONTRACT_PATH, text, 'utf8')
  console.log(`已写入 ${CONTRACT_PATH}（${Buffer.byteLength(text, 'utf8')} 字节）`)
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  await main()
}