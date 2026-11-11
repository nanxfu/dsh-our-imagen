#!/usr/bin/env node
/**
 * 模型资产构建：models/*.json → shared/models.generated.js
 *
 * 规则（见 docs/MODEL_ASSET_SPEC.md）：
 *   - models/*.json 是模型定义的唯一来源，单模型单文件、字段扁平；
 *   - 生成 shared/models.generated.js，contract.js 只做 re-export；
 *   - 生成结果不含时间戳，保证相同输入产出相同文件（git diff 只反映模型变化）。
 *
 * 用法：
 *   node tools/build-assets.mjs          生成 shared/models.generated.js
 *   node tools/build-assets.mjs --check  只校验生成文件是否与 models/ 同步
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MODELS_DIR = join(ROOT, 'models')

export const GENERATED_REL = 'shared/models.generated.js'

/** 每个模型文件必须存在的顶层字段。只做存在性检查，不搞字段白名单。 */
const REQUIRED_FIELDS = [
  'id',
  'order',
  'label',
  'family',
  'short',
  'description',
  'repo',
  'params',
  'license',
  'licenseKind',
  'gated',
  'gpus',
  'tier',
  'size',
  'steps',
  'cfg',
  'negativeHint',
  'promptStyle',
  'qualityPrefix',
  'sizeOptions',
  'runtime',
  'pipeline',
  'measured',
]

/** measured 里允许出现的实测指标；缺失或 null 表示尚未实测。 */
const MEASURED_FIELDS = ['peakVramMb', 'loadSeconds', 'steadySeconds', 'downloadGb']

/**
 * 提示词配方：模型按什么口径理解提示词。`danbooru` 逗号标签、`natural` 自然语言段落、
 * `concise` 简短短语；`lib/intent.js` 据此动态约束宿主模型整理出的英文提示词。
 */
export const PROMPT_STYLES = ['danbooru', 'natural', 'concise']

function fail(message) {
  throw new Error(message)
}

/** 读取并校验 models/ 下的全部资产，按 order 排序返回。 */
export async function loadModels(modelsDir = MODELS_DIR) {
  let entries
  try {
    entries = await readdir(modelsDir, { withFileTypes: true })
  } catch (error) {
    fail(`无法读取 models 目录：${error?.message ?? error}`)
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  if (files.length === 0) fail('models/ 下没有任何模型 JSON 文件')

  const models = []
  const seenIds = new Set()
  const seenOrders = new Set()
  for (const file of files) {
    const path = join(modelsDir, file)
    let model
    try {
      model = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      fail(`${file} 不是合法 JSON：${error?.message ?? error}`)
    }

    const where = relative(ROOT, path)
    if (!model || typeof model !== 'object' || Array.isArray(model)) fail(`${where} 必须是 JSON 对象`)
    for (const field of REQUIRED_FIELDS) {
      if (!(field in model)) fail(`${where} 缺少字段 ${field}`)
    }

    const expectedId = file.replace(/\.json$/, '')
    if (model.id !== expectedId) fail(`${where} 的 id（${model.id}）必须与文件名（${expectedId}）一致`)
    if (seenIds.has(model.id)) fail(`模型 id 重复：${model.id}`)
    seenIds.add(model.id)

    if (!Number.isFinite(model.order)) fail(`${where} 的 order 必须是数字`)
    if (seenOrders.has(model.order)) fail(`模型 order 重复：${model.order}（用于决定预设顺序，必须唯一）`)
    seenOrders.add(model.order)

    // 展示字段：家族、触发器短名与中英双语定位描述。卡面直接消费这三项，缺一不可。
    if (typeof model.family !== 'string' || !model.family.trim()) {
      fail(`${where} 的 family 必须是非空字符串（如 SDXL / FLUX）`)
    }
    if (typeof model.short !== 'string' || !model.short.trim()) {
      fail(`${where} 的 short 必须是非空字符串（触发器用的短名）`)
    }
    if (!model.description || typeof model.description !== 'object' || Array.isArray(model.description)) {
      fail(`${where} 的 description 必须是 { zh, en } 对象`)
    }
    for (const lang of ['zh', 'en']) {
      if (typeof model.description[lang] !== 'string' || !model.description[lang].trim()) {
        fail(`${where} 的 description.${lang} 必须是非空字符串`)
      }
    }

    if (model.runtime !== 'default') {
      fail(`${where} 的 runtime 目前只支持 "default"；特殊运行时模型等后续阶段再开放`)
    }
    if (!model.pipeline || typeof model.pipeline !== 'object' || Array.isArray(model.pipeline)) {
      fail(`${where} 的 pipeline 必须是对象`)
    }
    if (typeof model.pipeline.loader !== 'string' || !model.pipeline.loader) {
      fail(`${where} 的 pipeline.loader 必须是非空字符串`)
    }
    if (!model.measured || typeof model.measured !== 'object' || Array.isArray(model.measured)) {
      fail(`${where} 的 measured 必须是对象（允许指标为 null，表示尚未实测）`)
    }
    for (const field of MEASURED_FIELDS) {
      const value = model.measured[field]
      if (value !== null && !Number.isFinite(value)) {
        fail(`${where} 的 measured.${field} 必须是数字或 null`)
      }
    }
    if (!Array.isArray(model.sizeOptions) || model.sizeOptions.length === 0) {
      fail(`${where} 的 sizeOptions 必须是非空数组`)
    }
    // 提示词配方：意图解析据此切换英文提示词的书写口径；qualityPrefix 允许为空串。
    if (typeof model.promptStyle !== 'string' || !PROMPT_STYLES.includes(model.promptStyle)) {
      fail(`${where} 的 promptStyle 必须是 ${PROMPT_STYLES.join(' | ')} 之一`)
    }
    if (typeof model.qualityPrefix !== 'string') {
      fail(`${where} 的 qualityPrefix 必须是字符串（没有质量词前缀时写空串）`)
    }

    models.push(model)
  }

  return models.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** 完整资产记录（含 measured 与 runtime），供后续验证/诊断使用。 */
function projectModels(models) {
  return models.map((model) => ({
    ...model,
    measured: Object.fromEntries(MEASURED_FIELDS.map((field) => [field, model.measured[field] ?? null])),
  }))
}

/** 契约使用的预设视图：模型事实字段 + 卡面展示字段（family / short / description）。 */
function projectPresets(models) {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    family: model.family,
    short: model.short,
    description: model.description,
    repo: model.repo,
    params: model.params,
    license: model.license,
    licenseKind: model.licenseKind,
    gated: model.gated,
    gpus: model.gpus,
    downloadGb: model.measured.downloadGb,
    size: model.size,
    steps: model.steps,
    cfg: model.cfg,
    peakVramMb: model.measured.peakVramMb,
    loadSeconds: model.measured.loadSeconds,
    steadySeconds: model.measured.steadySeconds,
    tier: model.tier,
    negativeHint: model.negativeHint,
    promptStyle: model.promptStyle,
    qualityPrefix: model.qualityPrefix,
    sizeOptions: model.sizeOptions,
    pipeline: model.pipeline,
  }))
}

/** 渲染生成文件内容（纯函数；供 check-contract 复用）。 */
export function renderGenerated(models) {
  const banner = [
    '/**',
    ' * 本文件由 tools/build-assets.mjs 从 models/*.json 生成，请勿手改。',
    ' * 修改模型请编辑 models/<id>.json，然后运行 npm run models:build。',
    ' */',
    '',
  ].join('\n')
  const modelsJson = JSON.stringify(projectModels(models), null, 2)
  const presetsJson = JSON.stringify(projectPresets(models), null, 2)
  return `${banner}export const MODELS = ${modelsJson}\n\nexport const PRESETS = ${presetsJson}\n`
}

/** 读取生成文件内容；不存在返回 null。 */
export async function readGenerated() {
  try {
    return await readFile(join(ROOT, GENERATED_REL), 'utf8')
  } catch {
    return null
  }
}

/** 生成或校验；返回 { ok, models, wrote }，失败抛错。 */
export async function buildAssets({ check = false } = {}) {
  const models = await loadModels()
  const expected = renderGenerated(models)
  if (check) {
    const actual = await readGenerated()
    if (actual === expected) return { ok: true, models, wrote: false }
    const reason = actual === null ? '生成文件不存在' : '生成文件与 models/ 不同步'
    fail(`${reason}：请运行 npm run models:build`)
  }
  await writeFile(join(ROOT, GENERATED_REL), expected, 'utf8')
  return { ok: true, models, wrote: true }
}

async function main() {
  const check = process.argv.includes('--check')
  const result = await buildAssets({ check })
  const ids = result.models.map((model) => model.id).join(', ')
  if (check) {
    console.log(`模型资产与生成文件一致（${result.models.length} 个：${ids}）`)
    return
  }
  console.log(`已生成 ${GENERATED_REL}（${result.models.length} 个模型：${ids}）`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`模型资产构建失败：${error?.message ?? error}`)
    process.exitCode = 1
  })
}