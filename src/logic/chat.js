/**
 * 对话线程的纯逻辑：助手结果图归一与 1~4 格网格、单图聚焦返回栈、
 * 舞台图片工具动作的镜像记录。
 *
 * 不依赖 React / DOM：`useChatThread` 只做状态编排，`ChatPanel` 只做渲染，
 * 结果图字段、面包屑文案与镜像记录形状统一收敛在这里，便于离线断言。
 * 所有镜像记录都带 `kind`，因此不会被 `logic/intent.js` 的 `intentHistory()` 收进模型上下文。
 */

import { LIMITS } from '../../shared/contract.js'

import { errorText } from './error.js'
import { formatSeconds, formatText } from './format.js'
import { referenceUrlOf } from './reference.js'

/** 一次任务最多展示 4 张结果图（契约的生成张数上限）。 */
const MAX_RESULT_IMAGES = LIMITS.count.max

/** 舞台图片工具里会镜像到助手线程的工具 id（局部 / 整图 / 高清放大 / 扩图）。 */
const MIRROR_TOOLS = Object.freeze(['inpaint', 'img2img', 'upscale', 'outpaint'])

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 有限数字；缺失 / 非法返回 null（`Number(null) === 0`，不能直接 Number）。 */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveOrNull(value) {
  const number = numberOrNull(value)
  return number !== null && number > 0 ? Math.round(number) : null
}

/**
 * 任务产物 / 历史图片 → 气泡图项：`{ url, path, width, height, seed, seconds }`。
 *
 * `url` 缺失时按宿主 `/imagen-api/file?path=` 的同口径补出来（旧记录可能只有路径）；
 * 路径与地址都没有时返回 null，调用方过滤掉。
 */
export function imageOf(raw) {
  const source = raw && typeof raw === 'object' ? raw : null
  if (!source) return null
  const path = textOf(source.path)
  const url = textOf(source.url) || referenceUrlOf(path)
  if (!path && !url) return null
  return {
    url,
    path,
    width: positiveOrNull(source.width),
    height: positiveOrNull(source.height),
    seed: numberOrNull(source.seed),
    seconds: numberOrNull(source.seconds),
  }
}

/** 任务快照 → 气泡 `images`：完成态的全部结果图，最多 4 张。 */
export function imagesOfJob(job) {
  const output = job && typeof job === 'object' && job.output && typeof job.output === 'object' ? job.output : null
  const list = output && Array.isArray(output.images) ? output.images : []
  return list.slice(0, MAX_RESULT_IMAGES).map(imageOf).filter(Boolean)
}

/**
 * 消息 → 结果图数组。
 *
 * 新版气泡带 `images`；早期版本的记录只有首图 `image` / `imagePath`，
 * 这里也归一成一项，旧记录不会在升级后突然不再显示缩略图。
 */
export function gridImagesOf(message) {
  const source = message && typeof message === 'object' ? message : null
  if (!source) return []
  const list = Array.isArray(source.images) ? source.images : []
  const images = list.slice(0, MAX_RESULT_IMAGES).map(imageOf).filter(Boolean)
  if (images.length > 0) return images
  const legacy = imageOf({ url: source.image, path: source.imagePath })
  return legacy ? [legacy] : []
}

/** 结果图指纹：状态 effect 用它判断一组图是否真的变了（避免每轮轮询重写气泡）。 */
export function imagesKeyOf(images) {
  const list = Array.isArray(images) ? images : []
  return list.map((image) => (image && (image.path || image.url)) || '').join('|')
}

/** 单张结果的元信息（秒数 · 种子），与旧气泡首图 meta 同一拼法；两者都缺失返回空串。 */
export function imageMetaOf(t, image) {
  if (!image || typeof image !== 'object') return ''
  const parts = []
  if (image.seconds !== null && image.seconds !== undefined) parts.push(formatSeconds(t, image.seconds))
  if (image.seed !== null && image.seed !== undefined) parts.push(`${t('studio.meta.seed')} ${image.seed}`)
  return parts.join(' · ')
}

/** 网格的分组标签：本次生成了几张。 */
export function gridLabelOf(t, count) {
  return formatText(t('studio.chat.gridLabel'), { count })
}

/**
 * 任务快照 → 气泡补丁。只映射真实状态，未知状态返回 null（保持原样）。
 *
 * 完成态给出全部结果图：`images` 是主展示字段，`image` / `imagePath` / `meta`
 * 保留为首图兼容字段（旧组件与旧测试仍可直接读取）。宿主某次快照缺产物时不覆盖已有图。
 */
export function bubblePatch(t, job, current) {
  const base = current && typeof current === 'object' ? current : {}
  if (!job || typeof job !== 'object') return null
  if (job.status === 'waiting-session') return { stage: 'queued', text: t('studio.chat.waitingSession') }
  if (job.status === 'queued') return { stage: 'queued', text: t('studio.chat.queued') }
  if (job.status === 'running') return { stage: 'running', text: t('studio.chat.running') }
  if (job.status === 'done') {
    const produced = imagesOfJob(job)
    const kept = Array.isArray(base.images) ? base.images : []
    const images = produced.length > 0 ? produced : kept
    const first = images[0] || null
    return {
      stage: 'done',
      text: t('studio.chat.done'),
      images,
      image: first ? first.url : base.image,
      imagePath: first ? first.path : base.imagePath,
      meta: first ? imageMetaOf(t, first) : base.meta,
    }
  }
  if (job.status === 'failed') {
    return { stage: 'failed', text: errorText(t, job.error || { code: '', message: '' }) }
  }
  return null
}

/** 气泡状态没变时跳过写入：阶段 / 文案 / 首图 / 全部结果图都相同才算没变。 */
export function bubbleUnchanged(current, patch) {
  const before = current && typeof current === 'object' ? current : {}
  return before.stage === patch.stage
    && before.text === patch.text
    && before.image === patch.image
    && imagesKeyOf(before.images) === imagesKeyOf(patch.images)
}

/**
 * 网格点击 → 聚焦栈项。
 *
 * 入参 `{ messageId, image, index, count }`；`image` 接受气泡图项或宿主产物图，
 * 字段统一成 `{ url, path, width, height, seed, seconds }`，另记来源消息、序号与本批张数
 * （面包屑「{count} 张生成结果」与返回时切舞台都用得到）。图非法返回 null。
 */
export function focusEntryOf(input) {
  const source = input && typeof input === 'object' ? input : {}
  const image = imageOf(source.image)
  if (!image) return null
  const index = numberOrNull(source.index)
  const count = numberOrNull(source.count)
  return {
    messageId: source.messageId ?? null,
    index: index === null ? 0 : Math.max(0, Math.trunc(index)),
    count: count === null || count < 1 ? 1 : Math.min(MAX_RESULT_IMAGES, Math.trunc(count)),
    ...image,
  }
}

/** 压栈：返回新数组，入参保持不变（React 状态更新用）。 */
export function pushFocus(stack, entry) {
  const list = Array.isArray(stack) ? stack : []
  return entry ? [...list, entry] : list
}

/** 出栈：返回新数组；空栈仍是空数组。 */
export function popFocus(stack) {
  return Array.isArray(stack) && stack.length > 0 ? stack.slice(0, -1) : []
}

/** 栈顶聚焦项；栈空返回 null。 */
export function currentFocusOf(stack) {
  return Array.isArray(stack) && stack.length > 0 ? stack[stack.length - 1] : null
}

/** 单图聚焦的层级名：有可读种子时带上种子，供更深层的面包屑引用。 */
export function focusNameOf(t, entry) {
  const title = t('studio.chat.focus.title')
  const seed = entry && entry.seed !== null && entry.seed !== undefined ? entry.seed : null
  return seed === null ? title : `${title} · ${t('studio.meta.seed')} ${seed}`
}

/**
 * 面包屑「上一层」的 label：
 *  - 第一层聚焦来自结果网格 → 本批张数（如「4 张生成结果」）；
 *  - 更深一层来自父级单图 → 父级层级名（如「单图聚焦 · 种子 7」）。
 * 栈空返回空串（不渲染面包屑）。
 */
export function focusBackLabelOf(t, stack) {
  const current = currentFocusOf(stack)
  if (!current) return ''
  if (stack.length <= 1) return formatText(t('studio.chat.focus.batch'), { count: current.count })
  return focusNameOf(t, stack[stack.length - 2])
}

/** 工具强度胶囊文案：0~1 的强度按两位以内小数展示，非法值返回空串（不渲染胶囊）。 */
export function strengthLabelOf(t, value) {
  const number = numberOrNull(value)
  if (number === null) return ''
  return formatText(t('studio.chat.tool.strength'), { value: Math.round(number * 100) / 100 })
}

/** 图片工具请求体里的强度：`body.reference.strength`，缺失返回 null。 */
export function strengthOfBody(body) {
  const reference = body && typeof body === 'object' && body.reference && typeof body.reference === 'object'
    ? body.reference
    : null
  return reference ? numberOrNull(reference.strength) : null
}

/**
 * 舞台图片工具提交成功 → 两条镜像记录：
 *  - `role='user' kind='tool'`：底图缩略图 + 工具文案 + 可选强度；
 *  - `role='assistant' kind='job'`：常规任务气泡，随后由任务状态 effect 更新。
 *
 * 两个 `kind` 都会被 `intentHistory()` 跳过，确保镜像动作不污染大模型多轮上下文。
 * 工具 id 非法 / 没有任务 id / 没有底图时返回 []（失败路径不追加，由调用方保证只在成功时调用）。
 */
export function mirrorToolEntries(t, input) {
  const source = input && typeof input === 'object' ? input : {}
  const tool = MIRROR_TOOLS.includes(source.tool) ? source.tool : ''
  if (!tool) return []
  const job = source.job && typeof source.job === 'object' ? source.job : null
  const jobId = job ? textOf(job.id) : ''
  if (!jobId) return []
  const target = source.target && typeof source.target === 'object' ? source.target : null
  const image = target ? imageOf({ url: target.url, path: target.path }) : null
  if (!image) return []
  const strength = strengthOfBody(source.body)
  const record = {
    role: 'user',
    kind: 'tool',
    tool,
    text: t(`studio.chat.tool.${tool}`),
    image: image.url,
    imagePath: image.path,
    width: image.width,
    height: image.height,
  }
  if (strength !== null) record.strength = strength
  return [
    record,
    { role: 'assistant', kind: 'job', jobId, stage: 'pending', text: t('studio.chat.pending') },
  ]
}
