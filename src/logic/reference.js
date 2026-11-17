/**
 * 左栏参考图槽的纯逻辑（阶段十五 Phase C2）。
 *
 * 参考图是「模型原生参考生图」的输入：1~`LIMITS.referenceImages.maxCount` 张已落盘的
 * 工作区作品路径，作为请求体 `references: string[]` 发给宿主（与单图 `reference` 互斥，
 * Host 协议见 SPEC §2.2「模型原生参考图」）。这里只做与 UI 无关的归一、槽位增删、
 * 请求体拼装与脏判定指纹，组件只负责渲染与拖放事件：
 *  - 槽位项形状固定为 `{ path, url, width, height, name }`：`url` 供缩略图、`name` 供展示，
 *    请求体只取 `path`（不传 base64）；
 *  - 上限与体积上限一律取契约 `LIMITS.referenceImages`，界面文案的 N 也来自这里；
 *  - 能力位 `supportsReference` 由宿主 `/state.presets` 下发，旧宿主缺字段按 false 处理。
 *
 * 质量定位（真机实测，Phase C1）：Klein 4B 的参考条件是**弱参考**——同 prompt / seed 下
 * 参考图只把输出往参考图的方向带一点（MAE 7.7/255），构图与内容仍由提示词与种子主导。
 * 因此文案不得写成「强一致参考」，参考图只作为模型条件参与。
 */

import { LIMITS, ROUTES } from '../../shared/contract.js'

import { importMimeOf } from './import.js'

const MIB = 1024 * 1024

/**
 * 参考图路径的工作区根目录名。
 *
 * 与 `lib/paths.js` 的 `OUTPUT_DIR` 同值（Host 侧常量在 Node 模块里，浏览器产物无法引用）；
 * 客户端只用它做形态预检，真正的越界校验仍由宿主完成。
 */
const REFERENCE_PATH_ROOT = 'imagen-output'

/** 参考图能力不满足时的拦截文案键（生成前置预检与 Rail 提示共用）。 */
export const REFERENCE_BLOCKED_KEY = 'studio.reference.blockedUnsupported'

/** 契约里的参考图边界；字段缺失时按首期实测值兜底，不让旧宿主把槽位打成 NaN。 */
export function referenceLimits() {
  const raw = LIMITS && LIMITS.referenceImages && typeof LIMITS.referenceImages === 'object'
    ? LIMITS.referenceImages
    : {}
  const positive = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }
  return {
    maxCount: Math.round(positive(raw.maxCount, 2)),
    maxBytes: positive(raw.maxBytes, 4 * MIB),
    maxEdge: Math.round(positive(raw.maxEdge, 1024)),
    minEdge: Math.round(positive(raw.minEdge, 128)),
  }
}

/** 参考图张数上限（界面「最多 N 张」与请求体裁剪共用）。 */
export function referenceMaxCount() {
  return referenceLimits().maxCount
}

/** 参考图单张体积上限的 MiB 读数（文案占位用，与契约同口径）。 */
export function referenceMaxMiB() {
  return Math.round(referenceLimits().maxBytes / MIB)
}

/** 参考图的文件名：路径只用于向宿主定位作品，缩略图旁只显示文件名。 */
export function referenceFileName(path) {
  const value = String(path ?? '').trim()
  if (!value) return ''
  const parts = value.split(/[\\/]/)
  return parts[parts.length - 1] || value
}

/**
 * 参考图缩略图地址：与 `lib/output.js` 的 `fileUrl()` 同口径（工作区相对路径做一次 URL 编码）。
 *
 * 历史条目一般已带 `image.url`；只有路径时用这里补出来，与 `/imagen-api/file?path=` 同一口径。
 */
export function referenceUrlOf(path) {
  const value = String(path ?? '').trim()
  if (!value) return ''
  return `${ROUTES.file.path}?path=${encodeURIComponent(value)}`
}

/**
 * 归一单个参考图路径：只接受 `imagen-output/` 内的工作区相对路径。
 *
 * 绝对路径、盘符、`..` / `.` 段与别的根目录一律返回空串——这些路径发给宿主也只会得到
 * `invalid_path`，不如在入槽时挡掉，避免槽位里出现一张永远无法生成的图。
 *
 * @param {unknown} value
 * @returns {string} 归一后的 POSIX 相对路径；非法时为空串
 */
export function referenceSlotPathOf(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.includes('\0')) return ''
  const segments = text.split(/[\\/]+/).filter((segment) => segment !== '')
  if (segments.length < 2) return ''
  if (segments.some((segment) => segment === '..' || segment === '.')) return ''
  if (segments[0] !== REFERENCE_PATH_ROOT) return ''
  return segments.join('/')
}

function positiveEdge(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

/**
 * 把一个来源（作品条目 `{ image, item }`、槽位项、图片对象或路径字符串）归一成槽位项。
 *
 * 槽位项只保留渲染与提交需要的字段；`path` 非法时返回 null，调用方按「不可用」处理。
 *
 * @param {unknown} value
 * @returns {{path: string, url: string, width: number|null, height: number|null, name: string}|null}
 */
export function referenceItemOf(value) {
  if (typeof value === 'string') {
    const path = referenceSlotPathOf(value)
    if (!path) return null
    return { path, url: referenceUrlOf(path), width: null, height: null, name: referenceFileName(path) }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const holder = value
  const image = holder.image && typeof holder.image === 'object' ? holder.image : holder
  const path = referenceSlotPathOf(image.path || holder.path)
  if (!path) return null
  const url = typeof image.url === 'string' && image.url
    ? image.url
    : (typeof holder.url === 'string' && holder.url ? holder.url : referenceUrlOf(path))
  const name = (typeof holder.name === 'string' && holder.name.trim())
    || (typeof image.file === 'string' && image.file.trim())
    || referenceFileName(path)
  return {
    path,
    url,
    width: positiveEdge(image.width ?? holder.width),
    height: positiveEdge(image.height ?? holder.height),
    name,
  }
}

/**
 * 归一一个槽位列表：逐项转成槽位项、丢弃非法项、按路径去重（保留先到的），并裁到契约上限。
 *
 * 旧快照 / 手改的 `meta` 都可能让槽位里出现重复或非法数据；所有读写入口都先过这一层，
 * 保证表单状态里不会存在「两张同一路径」或「路径不合法」的参考图。
 *
 * @param {unknown} value 表单 `references` 字段或历史 slot 列表
 * @returns {Array<{path: string, url: string, width: number|null, height: number|null, name: string}>}
 */
export function referenceListOf(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  const seen = new Set()
  const max = referenceMaxCount()
  for (const raw of list) {
    const item = referenceItemOf(raw)
    if (!item || seen.has(item.path)) continue
    seen.add(item.path)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

/**
 * 往槽位追加一张参考图。
 *
 * 返回 `reason` 供界面给不同提示（重复 / 满额 / 路径不合法），四种结果都不抛错：
 * 拖入多张时调用方按顺序逐张追加，逐张决定提示即可。
 *
 * @param {unknown} list 当前槽位
 * @param {unknown} value 待加入的作品条目 / 槽位项 / 路径
 * @returns {{ok: boolean, reason: 'added'|'duplicate'|'full'|'invalid', list: Array<object>, item: object|null}}
 */
export function referenceAdd(list, value) {
  const current = referenceListOf(list)
  const item = referenceItemOf(value)
  if (!item) return { ok: false, reason: 'invalid', list: current, item: null }
  if (current.some((entry) => entry.path === item.path)) {
    return { ok: false, reason: 'duplicate', list: current, item }
  }
  if (current.length >= referenceMaxCount()) {
    return { ok: false, reason: 'full', list: current, item }
  }
  return { ok: true, reason: 'added', list: [...current, item], item }
}

/** 从槽位移除一张参考图（按路径）；不在槽位里时原样返回。 */
export function referenceRemove(list, path) {
  const target = referenceSlotPathOf(path)
  const current = referenceListOf(list)
  if (!target) return current
  return current.filter((item) => item.path !== target)
}

/** 槽位里是否已有该路径（动作坞「设为参考图」据此给重复提示）。 */
export function referenceHas(list, path) {
  const target = referenceSlotPathOf(path)
  if (!target) return false
  return referenceListOf(list).some((item) => item.path === target)
}

/** 已删除作品的路径 → 从参考槽里摘掉（删除作品的级联清理，避免槽位指向不存在的图）。 */
export function referencePurgeOf(list, paths) {
  const removed = new Set((Array.isArray(paths) ? paths : []).map((path) => referenceSlotPathOf(path)).filter(Boolean))
  const current = referenceListOf(list)
  if (removed.size === 0) return current
  return current.filter((item) => !removed.has(item.path))
}

/**
 * 参考图槽位的脏判定指纹：只取顺序化后的路径串。
 *
 * 挂载 / 移除 / 换图都会改变指纹（Phase A1 的草稿托管语义要求「挂载参考图也算 dirty」）；
 * 同一张图重复挂载会被 `referenceListOf` 去重，不会产生假脏。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function referenceFingerprintOf(value) {
  return referenceListOf(value).map((item) => item.path).join('\n')
}

/**
 * 请求体里的 `references`：有序路径数组，已去重并按契约上限裁剪；空槽返回空数组。
 *
 * @param {unknown} value 表单 `references` 字段或覆盖项
 * @returns {string[]}
 */
export function referencePathsOf(value) {
  return referenceListOf(value).map((item) => item.path)
}

/** 预设是否支持模型原生参考生图；旧宿主缺字段按 false（与 supportsImg2Img 同一口径）。 */
export function supportsReferenceOf(preset) {
  return Boolean(preset && typeof preset === 'object' && preset.supportsReference === true)
}

/**
 * 第一个支持原生参考生图的预设（「切换到支持参考的模型」的唯一候选来源）。
 *
 * 首期只有 `flux2-klein-4b`；一个都没有（旧宿主 / 能力未下发）时返回 null，
 * 由界面明确提示而不是静默换模型。
 */
export function nativeReferencePresetOf(presets) {
  const list = Array.isArray(presets) ? presets.filter((item) => item && item.id) : []
  return list.find(supportsReferenceOf) || null
}

/**
 * 本次请求的参考图能力预检（纯函数）。
 *
 * 槽位为空时永远 ok（纯文生图不受影响）；槽位非空但当前预设不支持原生参考时拦下：
 * 不静默改模型、也不静默丢图——调用方据此 toast 并让用户自己选「换模型」还是「移除参考图」。
 *
 * @param {object|null} preset 本次请求的有效预设
 * @param {unknown} references 槽位或覆盖项里的参考图
 * @returns {{ok: boolean, paths: string[], blockedKey: string}}
 */
export function referenceCapabilityOf(preset, references) {
  const paths = referencePathsOf(references)
  if (paths.length === 0) return { ok: true, paths, blockedKey: '' }
  if (supportsReferenceOf(preset)) return { ok: true, paths, blockedKey: '' }
  return { ok: false, paths, blockedKey: REFERENCE_BLOCKED_KEY }
}

/**
 * 参考图文件的客户端预检：类型 → 体积（契约 `LIMITS.referenceImages.maxBytes`，4 MiB）。
 *
 * `/import` 自身允许 8 MiB，但参考生图只收 4 MiB：先按参考图上限挡掉，
 * 避免「导入成功了、生成时才失败」。最小长边与魔数校验交给 `importPrecheckOf`（同一份契约）。
 *
 * @param {object} file 浏览器 File 对象（或等价的 `{ name, type, size }`）
 * @returns {null | {key: string, params: object|null}} 通过返回 null
 */
export function referenceFileErrorOf(file) {
  if (!importMimeOf(file)) return { key: 'studio.import.invalidType', params: null }
  const size = Number(file && file.size)
  if (Number.isFinite(size) && size > referenceLimits().maxBytes) {
    return { key: 'studio.reference.tooLarge', params: { size: referenceMaxMiB() } }
  }
  return null
}
