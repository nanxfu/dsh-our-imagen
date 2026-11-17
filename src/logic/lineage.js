/**
 * 批与树状版本索引（纯逻辑，不依赖 React / DOM）。
 *
 * 数据来源：
 *  - items：`GET /imagen-api/history` 的分页条目，一条对应一次生成（1~4 张图）。
 *    宿主透传 `sourceImage`（直接父图）、`rootImage`（整棵树的根图）、`inpaint`、`strength`；
 *    旧宿主可能缺后三个字段，此时按 `sourceImage` 链回溯已加载条目。
 *  - pendingJobs：`/state.jobs` 里的活动任务。客户端提交时补 `parentPath` / `rootImage` /
 *    `sourceMode`，井或从 `params.reference.path` 推断父图，用于版本面板里的「生成中」幽灵节点。
 *
 * 设计约定（见 .tmp/plan/INTERFACES.md §4、docs/WORKSPACE_DRAFTS_AND_VERSIONING_PLAN.md）：
 *  1. 一个根图 = 一张作品卡。同一批 4 张文生图各自为根，互不折叠（后续分支独立）。
 *  2. 版本号 `v1 / v2a / v2b`：按 depth + 同父兄弟顺序（a 表示同批第一个分支）；
 *     在途幽灵节点按完成顺序预测下一个序号，避免出图后版本号跳动。
 *  3. 父图不在已加载条目里（被删 / 跨分页缺失）时，子节点提升为局部根并标记
 *     `sourceDeleted: true`：不丢节点、不崩溃，版本面板再按需拉取 /history/tree 合并。
 *  4. 只有能确定父图（或已知根）的活动任务才挂成幽灵节点；显式新建绘图无父图，
 *     不占版本树位置，继续由作品条的排队卡展示。
 */

/** 会话内按作品保存的编辑草稿上限（含蒙版的草稿也算一个，见 Lead 决策 D6）。 */
export const DRAFT_LRU_LIMIT = 8

/** 草稿改动项：顺序固定，圆点提示文案按这个顺序拼接。 */
export const DRAFT_CHANGE_KEYS = Object.freeze(['mask', 'prompt', 'params'])

/** 活动任务状态：只有这些状态会渲染成在途幽灵节点。 */
const PENDING_STATUS = Object.freeze({
  queued: true,
  running: true,
  'waiting-session': true,
})

/** 版本类型：文生 / 整图重绘 / 局部涂抹。 */
export const LINEAGE_KINDS = Object.freeze(['text', 'img2img', 'inpaint'])

/** 旧数据回溯 rootImage 的层数上限，与 Host 侧 resolveRootImage 保持一致。 */
const ROOT_LOOKBACK = 8

/** 深度上限：异常数据成环时不让递归/渲染无限展开。 */
const MAX_DEPTH = 64

const KIND_TEXT = 'text'
const KIND_IMG2IMG = 'img2img'
const KIND_INPAINT = 'inpaint'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrNull(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/** 时间字段 → 毫秒时间戳；解析不了返回 null（缺时间的旧数据按 0 处理）。 */
function timestampOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** 条目 / 任务的时间：完成时间优先，其次创建时间，最后修改时间。 */
function createdAtOf(source) {
  if (!source || typeof source !== 'object') return null
  for (const key of ['finishedAt', 'createdAt', 'mtime', 'startedAt']) {
    const value = timestampOf(source[key])
    if (value !== null) return value
  }
  return null
}

/** 图片路径（工作区相对的 POSIX 路径，Host 已归一）。 */
export function imagePathOf(image) {
  if (!image || typeof image !== 'object') return ''
  return textOf(image.path)
}

/** 条目的条目键：jobId 优先，其次产物目录，最后退回提示词。 */
function itemKeyOf(item, index) {
  if (!item || typeof item !== 'object') return `raw:${index}`
  return textOf(item.jobId) || textOf(item.dir) || `raw:${textOf(item.prompt)}:${index}`
}

/** 条目 → { 图片路径: 条目 } 查找函数；入参可以是条目数组或已建好的 Map。 */
function itemLookupOf(items) {
  if (items instanceof Map) {
    return (path) => items.get(path) ?? null
  }
  const map = new Map()
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const images = Array.isArray(item.images) ? item.images : []
      for (const image of images) {
        const path = imagePathOf(image)
        if (path && !map.has(path)) map.set(path, item)
      }
    }
  }
  return (path) => (path ? map.get(path) ?? null : null)
}

/**
 * 一个历史条目的树根路径。
 *
 * 规则：条目自带 `rootImage` 就直接信任；否则沿 `sourceImage` 往上找已加载的父条目，
 * 直到「父条目也没有 sourceImage（它本身就是一张根图）」或「父条目未加载」（它是目前能
 * 确认的最高祖先）或走满 8 层为止。纯文生图条目自己就是根，但一批多张图各自为根，
 * 所以返回空串，由调用方用每张图自己的路径当根。
 *
 * @param {object} item 历史条目
 * @param {Array<object>|Map<string, object>} [items] 已加载的条目（可选，缺省时只能回退到 sourceImage）
 * @returns {string} 根图路径；无法确定共享根时返回空串
 */
export function rootOfItem(item, items) {
  if (!item || typeof item !== 'object') return ''
  const ownRoot = textOf(item.rootImage)
  if (ownRoot) return ownRoot
  const lookup = itemLookupOf(items)
  let parentPath = textOf(item.sourceImage)
  const seen = new Set()
  for (let depth = 0; depth < ROOT_LOOKBACK && parentPath; depth += 1) {
    if (seen.has(parentPath)) break
    seen.add(parentPath)
    const parent = lookup(parentPath)
    // 父条目未加载：这一级父图就是目前能确认的树根。
    if (!parent) return parentPath
    const inherited = textOf(parent.rootImage)
    if (inherited) return inherited
    const up = textOf(parent.sourceImage)
    if (!up) return parentPath
    parentPath = up
  }
  return parentPath
}

/**
 * 在途任务挂到哪个父作品下：客户端补的 `parentPath` 优先，其次是提交体里的参考图路径，
 * 最后退回任务快照里的 sourceImage。
 */
export function pendingParentOf(job) {
  if (!job || typeof job !== 'object') return ''
  const direct = textOf(job.parentPath)
  if (direct) return direct
  const params = job.params && typeof job.params === 'object' ? job.params : null
  if (params) {
    const reference = params.reference && typeof params.reference === 'object' ? params.reference : null
    if (reference) {
      const path = textOf(reference.path) || textOf(reference.sourcePath)
      if (path) return path
    }
    const source = textOf(params.sourceImage)
    if (source) return source
  }
  return textOf(job.sourceImage)
}

/** 在途任务的版本类型：sourceMode 优先，其次看提交体里有没有参考图 / 蒙版。 */
export function pendingKindOf(job) {
  if (!job || typeof job !== 'object') return KIND_TEXT
  const mode = textOf(job.sourceMode)
  if (LINEAGE_KINDS.includes(mode)) return mode
  const params = job.params && typeof job.params === 'object' ? job.params : null
  const reference = params && params.reference && typeof params.reference === 'object' ? params.reference : null
  if (!reference) return KIND_TEXT
  // Host 的 /state 快照里 `reference.mask` 是布尔标记（真实的蒙版本体不公开），
  // 客户端补的提交体则可能是 { data, coverage } 对象——两种形状都要识别成局部涂抹。
  const mask = reference.mask
  if (mask === true) return KIND_INPAINT
  if (mask && typeof mask === 'object' && typeof mask.data === 'string' && mask.data) return KIND_INPAINT
  return KIND_IMG2IMG
}

/** 在途任务的根图提示：客户端补的 rootImage，或提交体里的 rootImage。 */
function pendingRootOf(job) {
  const params = job && job.params && typeof job.params === 'object' ? job.params : null
  return textOf(job && job.rootImage) || textOf(params && params.rootImage)
}

/** 同父兄弟序号 → a / b / ... / z / aa / ab …（超过 26 个分支也有稳定编号）。 */
export function siblingLetter(index) {
  let num = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0
  let out = ''
  do {
    out = ALPHABET[num % ALPHABET.length] + out
    num = Math.floor(num / ALPHABET.length) - 1
  } while (num >= 0)
  return out
}

/**
 * 版本号：`v{depth+1}`；同父兄弟多于一个时追加字母后缀（v2a / v2b）。
 * 根节点与独生子只有 `v1` / `v2` 这种主版本号。
 */
export function versionLabelOf(node) {
  if (!node || typeof node !== 'object') return 'v1'
  const depth = Number.isFinite(Number(node.depth)) ? Math.max(0, Math.floor(Number(node.depth))) : 0
  const base = `v${Math.min(depth, MAX_DEPTH) + 1}`
  const count = Number.isFinite(Number(node.siblingCount)) ? Math.floor(Number(node.siblingCount)) : 1
  if (count <= 1) return base
  const index = Number.isFinite(Number(node.siblingIndex)) ? Math.max(0, Math.floor(Number(node.siblingIndex))) : 0
  return `${base}${siblingLetter(index)}`
}

/** 作品路径键：条目 / 图片 / 字符串 → 稳定 path 键（'' 表示无效）。 */
export function draftKeyOf(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const image = value.image && typeof value.image === 'object' ? value.image : value
  return textOf(image.path)
}

/**
 * 单条草稿的圆点摘要：哪些地方有未提交改动，供缩略图圆点与版本面板行使用。
 *
 * `changed` 是草稿的显式改动表（{ mask, prompt, params }）；老草稿缺这个字段时，
 * 至少按「有蒙版数据」推出 mask 一项，避免圆点静默消失。
 *
 * @param {object|null} draft `{ tool, prompt, strength, strengthAuto, presetId, mask, changed, lastTouchedAt }`
 * @returns {{ active: boolean, items: string[], count: number, hasMask: boolean,
 *             hasPrompt: boolean, hasParams: boolean, tool: string,
 *             lastTouchedAt: number, coverage: number }}
 */
export function workDraftSummary(draft) {
  const source = draft && typeof draft === 'object' ? draft : null
  const mask = source && source.mask && typeof source.mask === 'object' ? source.mask : null
  if (!source) {
    return {
      active: false,
      items: [],
      count: 0,
      hasMask: false,
      hasPrompt: false,
      hasParams: false,
      tool: '',
      lastTouchedAt: 0,
      coverage: 0,
    }
  }
  const changed = source.changed && typeof source.changed === 'object' ? source.changed : {}
  const hasFlag = (key) => Object.prototype.hasOwnProperty.call(changed, key)
  const flags = {
    mask: hasFlag('mask') ? changed.mask === true : Boolean(mask && textOf(mask.data)),
    prompt: hasFlag('prompt') ? changed.prompt === true : false,
    params: hasFlag('params') ? changed.params === true : false,
  }
  const items = DRAFT_CHANGE_KEYS.filter((key) => flags[key] === true)
  const coverage = mask && Number.isFinite(Number(mask.coverage))
    ? Math.max(0, Math.min(1, Number(mask.coverage)))
    : 0
  const lastTouchedAt = Number(source.lastTouchedAt)
  return {
    active: items.length > 0,
    items,
    count: items.length,
    hasMask: flags.mask,
    hasPrompt: flags.prompt,
    hasParams: flags.params,
    tool: textOf(source.tool),
    lastTouchedAt: Number.isFinite(lastTouchedAt) ? lastTouchedAt : 0,
    coverage,
  }
}

/**
 * 草稿表按 LRU 截断：最多保留 `limit` 条，淘汰 `lastTouchedAt` 最旧的。
 * 时间缺失按 0 处理；时间相同时保留在表里更靠前的（调用方按更新时间插入时即最新在前）。
 *
 * @param {object|Map<string, object>} drafts
 * @param {number} [limit]
 * @returns {object} 新的普通对象草稿表
 */
export function lruDrafts(drafts, limit) {
  const max = Number.isFinite(Number(limit)) && Number(limit) >= 0
    ? Math.floor(Number(limit))
    : DRAFT_LRU_LIMIT
  const entries = drafts instanceof Map
    ? [...drafts.entries()]
    : (drafts && typeof drafts === 'object' ? Object.entries(drafts) : [])
  const candidates = []
  entries.forEach(([key, draft], order) => {
    const path = draftKeyOf(key)
    if (!path || !draft || typeof draft !== 'object') return
    candidates.push({ path, draft, touched: workDraftSummary(draft).lastTouchedAt, order })
  })
  candidates.sort((left, right) => right.touched - left.touched || left.order - right.order)
  const kept = {}
  for (const entry of candidates.slice(0, max)) kept[entry.path] = entry.draft
  return kept
}

/** 节点排序：同一父节点下按 siblingIndex；缺序号（面板补拉的任务）排最后。 */
function compareSibling(left, right) {
  const leftIndex = Number.isFinite(Number(left.siblingIndex)) ? Number(left.siblingIndex) : Number.MAX_SAFE_INTEGER
  const rightIndex = Number.isFinite(Number(right.siblingIndex)) ? Number(right.siblingIndex) : Number.MAX_SAFE_INTEGER
  if (leftIndex !== rightIndex) return leftIndex - rightIndex
  const leftTime = createdAtOf(left) ?? 0
  const rightTime = createdAtOf(right) ?? 0
  if (leftTime !== rightTime) return leftTime - rightTime
  return textOf(left.path).localeCompare(textOf(right.path))
}

/**
 * 建立批与树状版本索引。
 *
 * @param {{ items?: Array<object>, pendingJobs?: Array<object> }} [input]
 * @returns {{
 *   roots: Array<object>,
 *   byPath: Record<string, object>,
 *   nodes: Array<object>,
 *   ghosts: Array<object>,
 * }}
 *
 * 节点字段：`{ path, url, file, width, height, seed, prompt, presetId, itemKey, item, createdAt,
 *   kind, ghost, parentPath, rootPath, depth, siblingIndex, siblingCount, versionLabel,
 *   sourceDeleted }`；幽灵节点另有 `jobId / status / parentMissing`。
 * 根字段：`{ path, node, latest, latestPath, nodes, count, derivedCount, pendingCount,
 *   badgeCount, hasPending, sourceDeleted }`。
 */
export function buildLineage(input) {
  const source = input && typeof input === 'object' ? input : {}
  const items = Array.isArray(source.items) ? source.items.filter((item) => item && typeof item === 'object') : []
  const pendingJobs = Array.isArray(source.pendingJobs) ? source.pendingJobs : []

  /** @type {Array<object>} */
  const nodes = []
  const byPath = {}

  // 1) 历史条目扁平化：一次生成的多张图各自成节点，各自可以独立分支。
  items.forEach((item, itemIndex) => {
    const images = Array.isArray(item.images) ? item.images.filter((image) => image && typeof image === 'object') : []
    if (images.length === 0) return
    const parentPath = textOf(item.sourceImage)
    const metaRoot = textOf(item.rootImage)
    const createdAt = createdAtOf(item)
    const kind = item.inpaint === true ? KIND_INPAINT : (parentPath ? KIND_IMG2IMG : KIND_TEXT)
    const itemKey = itemKeyOf(item, itemIndex)
    for (const image of images) {
      const path = imagePathOf(image)
      // 同一张图可能因分页重复出现：保留先到的一份，不重复建节点。
      if (!path || byPath[path]) continue
      const node = {
        path,
        url: textOf(image.url),
        file: textOf(image.file),
        width: numberOrNull(image.width),
        height: numberOrNull(image.height),
        seed: image.seed === undefined ? null : image.seed,
        prompt: textOf(item.prompt),
        presetId: textOf(item.presetId),
        itemKey,
        item,
        createdAt,
        kind,
        ghost: false,
        parentPath,
        metaRoot,
        rootPath: '',
        depth: 0,
        siblingIndex: 0,
        siblingCount: 1,
        versionLabel: '',
        sourceDeleted: false,
      }
      nodes.push(node)
      byPath[path] = node
    }
  })

  // 2) 深度与树根：沿父链找到已加载的最高祖先；父图缺失的节点提升为局部根。
  for (const node of nodes) {
    if (!node.parentPath) {
      node.rootPath = node.path
      node.depth = 0
      // 根节点不参与兄弟排序，版本号固定 v1（同一批多张图各自是独立的根）。
      node.siblingIndex = 0
      node.siblingCount = 1
      node.versionLabel = versionLabelOf(node)
      continue
    }
    if (!byPath[node.parentPath]) {
      node.rootPath = node.path
      node.depth = 0
      node.sourceDeleted = true
      continue
    }
    const ancestry = []
    const seen = new Set()
    let current = node
    while (current && typeof current === 'object') {
      if (seen.has(current.path)) break
      seen.add(current.path)
      ancestry.push(current.path)
      if (!current.parentPath) break
      const parent = byPath[current.parentPath]
      if (!parent) break
      current = parent
    }
    const top = ancestry[ancestry.length - 1]
    node.rootPath = top || node.path
    node.depth = Math.min(Math.max(ancestry.length - 1, 0), MAX_DEPTH)
  }

  // 3) 在途幽灵节点：只挂到已加载的父节点（或已知根）下，无锚点的新建任务不进版本树。
  const ghosts = []
  for (const job of pendingJobs) {
    if (!job || typeof job !== 'object' || !job.id) continue
    if (PENDING_STATUS[job.status] !== true) continue
    const parentPath = pendingParentOf(job)
    const rootHint = pendingRootOf(job)
    let anchor = parentPath ? byPath[parentPath] : null
    let parentMissing = false
    if (!anchor && rootHint) {
      anchor = byPath[rootHint] || null
      parentMissing = Boolean(anchor)
    }
    if (!anchor || anchor.ghost) continue
    const path = `pending:${String(job.id)}`
    if (byPath[path]) continue
    const ghost = {
      path,
      url: '',
      file: '',
      width: numberOrNull(job.params && job.params.width),
      height: numberOrNull(job.params && job.params.height),
      seed: null,
      prompt: textOf(job.params && job.params.prompt),
      presetId: textOf(job.presetId) || textOf(job.params && job.params.presetId),
      itemKey: path,
      item: null,
      job,
      jobId: String(job.id),
      createdAt: createdAtOf(job),
      kind: pendingKindOf(job),
      ghost: true,
      parentPath: anchor.path,
      parentMissing,
      metaRoot: rootHint,
      rootPath: anchor.rootPath,
      depth: Math.min((anchor.depth || 0) + 1, MAX_DEPTH),
      siblingIndex: 0,
      siblingCount: 1,
      versionLabel: '',
      sourceDeleted: false,
      status: textOf(job.status),
    }
    ghosts.push(ghost)
    nodes.push(ghost)
    byPath[path] = ghost
  }

  // 4) 同父兄弟排序与版本号：真实节点按生成时间，在途节点排在最后并预测后续序号。
  const childrenByParent = new Map()
  for (const node of nodes) {
    if (!node.parentPath) continue
    if (!childrenByParent.has(node.parentPath)) childrenByParent.set(node.parentPath, [])
    childrenByParent.get(node.parentPath).push(node)
  }
  for (const children of childrenByParent.values()) {
    const real = children
      .filter((node) => !node.ghost)
      .sort((left, right) => (createdAtOf(left) ?? 0) - (createdAtOf(right) ?? 0) || textOf(left.path).localeCompare(textOf(right.path)))
    const pending = children
      .filter((node) => node.ghost)
      .sort((left, right) => (createdAtOf(left) ?? Number.MAX_SAFE_INTEGER) - (createdAtOf(right) ?? Number.MAX_SAFE_INTEGER) || textOf(left.path).localeCompare(textOf(right.path)))
    // 真实节点编号按「本批已出现的分支数」算（把在途节点也计入总数），
    // 这样幽灵节点出图后既有版本号不变，只多出新序号。
    const ordered = [...real, ...pending]
    ordered.forEach((node, index) => {
      node.siblingIndex = index
      node.siblingCount = ordered.length
      node.versionLabel = versionLabelOf(node)
    })
  }

  // 5) 按根聚合作品卡：一个根一张卡，缩略图取该树最新活跃节点。
  const orderIndex = new Map()
  nodes.forEach((node, index) => orderIndex.set(node.path, index))
  const groups = new Map()
  for (const node of nodes) {
    if (!node.rootPath) continue
    if (!groups.has(node.rootPath)) groups.set(node.rootPath, [])
    groups.get(node.rootPath).push(node)
  }
  const roots = []
  for (const [rootPath, group] of groups) {
    const rootNode = byPath[rootPath] && !byPath[rootPath].ghost ? byPath[rootPath] : null
    const real = group.filter((node) => !node.ghost)
    const ghostNodes = group.filter((node) => node.ghost)
    const timeScore = (node) => createdAtOf(node) ?? 0
    let latest = null
    for (const node of real) {
      if (!latest) {
        latest = node
        continue
      }
      const nextScore = timeScore(node)
      const bestScore = timeScore(latest)
      if (nextScore > bestScore) latest = node
      else if (nextScore === bestScore && (orderIndex.get(node.path) ?? Number.MAX_SAFE_INTEGER) < (orderIndex.get(latest.path) ?? Number.MAX_SAFE_INTEGER)) latest = node
    }
    const derivedCount = Math.max(real.length - 1, 0)
    const activity = Math.max(
      latest ? timeScore(latest) : 0,
      ...ghostNodes.map((node) => timeScore(node)),
      0,
    )
    roots.push({
      path: rootPath,
      node: rootNode,
      latest,
      latestPath: latest ? latest.path : rootPath,
      nodes: group,
      count: group.length,
      derivedCount,
      pendingCount: ghostNodes.length,
      badgeCount: derivedCount + ghostNodes.length,
      hasPending: ghostNodes.length > 0,
      sourceDeleted: Boolean(rootNode && rootNode.sourceDeleted),
      activity,
      order: orderIndex.get(rootPath) ?? Number.MAX_SAFE_INTEGER,
    })
  }
  roots.sort((left, right) => right.activity - left.activity || left.order - right.order)

  return { roots, byPath, nodes, ghosts }
}

/** 起点是否在指定根树里（沿 parentPath 往上走，遇到根即命中）。 */
function insideTree(startPath, rootPath, byPath) {
  let current = startPath
  const seen = new Set()
  while (current && !seen.has(current)) {
    if (current === rootPath) return true
    seen.add(current)
    const node = byPath[current]
    if (!node) return false
    current = node.parentPath
  }
  return false
}

/**
 * 版本派生面板的行数据（树的前序遍历）。
 *
 * 优先使用 `buildLineage()` 的 byPath（已含幽灵节点）；`pendingJobs` 里尚未进入 byPath
 * 的活动任务会按父图补成幽灵行（面板按需拉树后数据可能来自两次构建，需要这一步合并）。
 *
 * @param {object|string} root `buildLineage()` 的 roots 元素，或直接给根路径
 * @param {Record<string, object>} byPath `buildLineage().byPath`
 * @param {Record<string, object>|Map<string, object>} [drafts] workKey → 编辑草稿
 * @param {Array<object>} [pendingJobs] 活动任务（用于补幽灵行）
 * @returns {Array<object>} 行：`{ key, path, ghost, jobId, depth, versionLabel, kind, url, file,
 *   width, height, prompt, presetId, status, createdAt, sourceDeleted, parentMissing,
 *   isRoot, isLatest, node, draft, draftSummary }`
 */
export function lineagePanelRows(root, byPath, drafts, pendingJobs) {
  const pathMap = byPath && typeof byPath === 'object' ? byPath : {}
  const rootEntry = root && typeof root === 'object' ? root : null
  const rootPath = rootEntry ? textOf(rootEntry.path) : textOf(root)
  if (!rootPath) return []
  const rootNode = pathMap[rootPath] || (rootEntry && rootEntry.node) || null
  if (!rootNode || rootNode.ghost) return []

  const draftsOf = (key) => {
    if (!drafts || typeof drafts !== 'object') return null
    if (drafts instanceof Map) return drafts.get(key) || null
    return drafts[key] || null
  }

  const childrenByParent = new Map()
  for (const node of Object.values(pathMap)) {
    if (!node || typeof node !== 'object' || !node.parentPath) continue
    if (node.parentPath === node.path) continue
    if (!childrenByParent.has(node.parentPath)) childrenByParent.set(node.parentPath, [])
    childrenByParent.get(node.parentPath).push(node)
  }

  // 补拉：pendingJobs 里还没进入 byPath 的活动任务，父图属于本树时补一行幽灵。
  const knownJobIds = new Set()
  for (const node of Object.values(pathMap)) {
    if (node && node.ghost && node.jobId) knownJobIds.add(String(node.jobId))
  }
  const pendingList = Array.isArray(pendingJobs) ? pendingJobs : []
  for (const job of pendingList) {
    if (!job || typeof job !== 'object' || !job.id) continue
    if (PENDING_STATUS[job.status] !== true) continue
    const jobId = String(job.id)
    if (knownJobIds.has(jobId)) continue
    const parentPath = pendingParentOf(job)
    if (!parentPath || !pathMap[parentPath]) continue
    if (!insideTree(parentPath, rootPath, pathMap)) continue
    const anchor = pathMap[parentPath]
    const ghost = {
      path: `pending:${jobId}`,
      ghost: true,
      job,
      jobId,
      parentPath,
      prompt: textOf(job.params && job.params.prompt),
      status: textOf(job.status),
      kind: pendingKindOf(job),
      width: numberOrNull(job.params && job.params.width),
      height: numberOrNull(job.params && job.params.height),
      createdAt: createdAtOf(job),
      depth: Math.min((anchor.depth || 0) + 1, MAX_DEPTH),
      siblingIndex: Number.MAX_SAFE_INTEGER,
      siblingCount: 1,
      sourceDeleted: false,
      parentMissing: false,
    }
    knownJobIds.add(jobId)
    if (!childrenByParent.has(parentPath)) childrenByParent.set(parentPath, [])
    childrenByParent.get(parentPath).push(ghost)
  }

  const rows = []
  const visited = new Set()
  const rowOf = (node, depth) => {
    const key = textOf(node.path)
    const draft = draftsOf(key)
    return {
      key,
      path: key,
      ghost: node.ghost === true,
      jobId: node.jobId ? String(node.jobId) : '',
      depth: Number.isFinite(Number(depth)) ? Number(depth) : Number(node.depth) || 0,
      versionLabel: node.versionLabel || versionLabelOf(node),
      kind: node.kind || KIND_TEXT,
      url: textOf(node.url),
      file: textOf(node.file),
      width: node.width === undefined ? null : node.width,
      height: node.height === undefined ? null : node.height,
      prompt: textOf(node.prompt),
      presetId: textOf(node.presetId),
      status: textOf(node.status),
      createdAt: node.createdAt ?? null,
      sourceDeleted: node.sourceDeleted === true,
      parentMissing: node.parentMissing === true,
      isRoot: key === rootPath,
      isLatest: Boolean(rootEntry && rootEntry.latestPath === key),
      node,
      draft,
      draftSummary: workDraftSummary(draft),
    }
  }

  const walk = (path, depth) => {
    if (!path || visited.has(path)) return
    const node = pathMap[path]
    if (!node || node.ghost) return
    visited.add(path)
    rows.push(rowOf(node, depth))
    const children = (childrenByParent.get(path) || []).slice().sort(compareSibling)
    for (const child of children) {
      if (child.ghost) {
        if (visited.has(child.path)) continue
        visited.add(child.path)
        rows.push(rowOf(child, depth + 1))
        continue
      }
      walk(child.path, depth + 1)
    }
  }
  walk(rootPath, 0)
  return rows
}
