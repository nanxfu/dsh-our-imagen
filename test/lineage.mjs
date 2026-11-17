/**
 * 批与树状版本索引的离线测试（纯逻辑，不需要浏览器、不需要构建）。
 *
 * 覆盖任务要求的数据形状：
 *   items: HistoryItem[]（jobId / prompt / presetId / images[{path,file,url,width,height}]
 *          + 0.13.0 新增 sourceImage / rootImage / inpaint / strength）
 *   pendingJobs: /state.jobs 活动任务（客户端补 parentPath / rootImage / sourceMode）
 *
 * 场景：单根 / 两级派生 / 同批多图 / 父删提升 / 根缺失回溯 / 多分支版本号 /
 *       幽灵节点 / LRU 淘汰 / 草稿摘要 / 面板行遍历。
 *
 * 运行：node test/lineage.mjs
 */

import assert from 'node:assert/strict'

import {
  DRAFT_LRU_LIMIT,
  buildLineage,
  draftKeyOf,
  lineagePanelRows,
  lruDrafts,
  pendingKindOf,
  pendingParentOf,
  rootOfItem,
  siblingLetter,
  versionLabelOf,
  workDraftSummary,
} from '../src/logic/lineage.js'
import { createCheckRunner } from './helpers/check.mjs'

const { check, summary } = createCheckRunner()

const ROOT_DIR = 'imagen-output/20261109-120000-job-1'
const PATH = (dir, file) => `${dir}/${file}`

/** /history 条目：一次生成（1~4 张图）。 */
function item(options = {}) {
  const jobId = options.jobId ?? 'job-1'
  const images = (options.images ?? ['01.png']).map((file, index) => ({
    path: options.imageDir ? `${options.imageDir}/${file}` : `${ROOT_DIR}/${file}`,
    file,
    url: `/imagen-api/file?path=${encodeURIComponent(file)}`,
    width: options.width ?? 1024,
    height: options.height ?? 1024,
    seed: options.seed ?? index + 1,
  }))
  const base = {
    jobId,
    dir: `imagen-output/20261109-1200${String(options.minute ?? 0).padStart(2, '0')}-${jobId}`,
    prompt: options.prompt ?? `提示词 ${jobId}`,
    presetId: options.presetId ?? 'sdxl-lightning',
    finishedAt: options.finishedAt ?? '2026-11-09T05:00:00.000Z',
    images,
  }
  if (options.sourceImage) base.sourceImage = options.sourceImage
  if (options.rootImage) base.rootImage = options.rootImage
  if (options.inpaint) base.inpaint = true
  if (options.strength !== undefined) base.strength = options.strength
  return base
}

/** 简化的 /state.jobs 任务。 */
function job(id, options = {}) {
  const jobObject = {
    id,
    status: options.status ?? 'queued',
    createdAt: options.createdAt ?? '2026-11-09T05:10:00.000Z',
    params: { prompt: options.prompt ?? `任务 ${id}`, width: 1024, height: 1024 },
  }
  if (options.parentPath) jobObject.parentPath = options.parentPath
  if (options.rootImage) jobObject.rootImage = options.rootImage
  if (options.sourceMode) jobObject.sourceMode = options.sourceMode
  if (options.reference) jobObject.params.reference = options.reference
  return jobObject
}

const draft = (changed, extra = {}) => ({
  tool: 'inpaint',
  prompt: '',
  strength: 0.8,
  strengthAuto: true,
  presetId: 'sdxl-inpaint',
  mask: null,
  changed,
  lastTouchedAt: 1000,
  ...extra,
})

// ── 基础场景 ────────────────────────────────────────────────────────────

await check('单根：同批 4 张文生图各自成根，不折叠、无角标', () => {
  const batch = item({ jobId: 'job-1', images: ['01.png', '02.png', '03.png', '04.png'] })
  const { roots, byPath, nodes } = buildLineage({ items: [batch], pendingJobs: [] })
  assert.equal(roots.length, 4, '同批每张图各占一张作品卡')
  assert.equal(nodes.length, 4)
  for (const rootCard of roots) {
    assert.equal(rootCard.count, 1)
    assert.equal(rootCard.derivedCount, 0)
    assert.equal(rootCard.badgeCount, 0, '没有派生版本时不显示 ⎇ N 角标')
    assert.equal(rootCard.pendingCount, 0)
    assert.equal(rootCard.latestPath, rootCard.path, '单节点树的缩略图就是根图')
    assert.equal(byPath[rootCard.path].versionLabel, 'v1')
    assert.equal(byPath[rootCard.path].depth, 0)
    assert.equal(byPath[rootCard.path].kind, 'text')
  }
})

await check('两级派生：rootImage 归组、depth 与 v 编号递增、latest 指向最新节点', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const v2Dir = 'imagen-output/20261109-121000-job-2'
  const v2Item = item({
    jobId: 'job-2',
    images: ['01.png'],
    imageDir: v2Dir,
    sourceImage: rootPath,
    rootImage: rootPath,
    inpaint: true,
    finishedAt: '2026-11-09T05:01:00.000Z',
  })
  const v2Path = PATH(v2Dir, '01.png')
  const v3Dir = 'imagen-output/20261109-122000-job-3'
  const v3Item = item({
    jobId: 'job-3',
    images: ['01.png'],
    imageDir: v3Dir,
    sourceImage: v2Path,
    rootImage: rootPath,
    inpaint: true,
    finishedAt: '2026-11-09T05:02:00.000Z',
  })
  const { roots, byPath } = buildLineage({ items: [v3Item, v2Item, rootItem], pendingJobs: [] })
  assert.equal(roots.length, 1, '三张图归入同一棵树')
  const rootCard = roots[0]
  assert.equal(rootCard.path, rootPath)
  assert.equal(rootCard.latestPath, PATH(v3Dir, '01.png'))
  assert.equal(rootCard.derivedCount, 2)
  assert.equal(rootCard.badgeCount, 2)
  assert.equal(rootCard.count, 3)
  assert.equal(byPath[rootPath].versionLabel, 'v1')
  assert.equal(byPath[v2Path].versionLabel, 'v2')
  assert.equal(byPath[v2Path].depth, 1)
  assert.equal(byPath[PATH(v3Dir, '01.png')].versionLabel, 'v3')
  assert.equal(byPath[PATH(v3Dir, '01.png')].depth, 2)
  assert.equal(byPath[v2Path].parentPath, rootPath)
  assert.equal(byPath[v2Path].kind, 'inpaint', 'meta.inpaint 决定行类型')
  assert.equal(byPath[PATH(v3Dir, '01.png')].kind, 'inpaint')
})

await check('同批多图：一次重绘的 3 张候选是同一父节点下的 v2a / v2b / v2c', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const branchItem = item({
    jobId: 'job-2',
    images: ['a.png', 'b.png', 'c.png'],
    imageDir: 'imagen-output/20261109-121000-job-2',
    sourceImage: rootPath,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:01:00.000Z',
  })
  const { roots, byPath } = buildLineage({ items: [rootItem, branchItem], pendingJobs: [] })
  assert.equal(roots.length, 1)
  assert.equal(roots[0].derivedCount, 3)
  assert.equal(roots[0].badgeCount, 3)
  const labels = branchItem.images.map((image) => byPath[image.path].versionLabel)
  assert.deepEqual(labels, ['v2a', 'v2b', 'v2c'])
  assert.deepEqual(branchItem.images.map((image) => byPath[image.path].siblingIndex), [0, 1, 2])
  assert.equal(byPath[branchItem.images[0].path].siblingCount, 3)
})

await check('多分支版本号：不同批次的分支 a / b，嵌套分支继续 v3', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const branchAItem = item({
    jobId: 'job-2',
    images: ['a.png'],
    imageDir: 'imagen-output/20261109-121000-job-2',
    sourceImage: rootPath,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:01:00.000Z',
  })
  const branchBItem = item({
    jobId: 'job-3',
    images: ['b.png'],
    imageDir: 'imagen-output/20261109-122000-job-3',
    sourceImage: rootPath,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:02:00.000Z',
  })
  const branchA = PATH('imagen-output/20261109-121000-job-2', 'a.png')
  const nestedItem = item({
    jobId: 'job-4',
    images: ['c.png'],
    imageDir: 'imagen-output/20261109-123000-job-4',
    sourceImage: branchA,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:03:00.000Z',
  })
  const { byPath } = buildLineage({ items: [rootItem, branchAItem, branchBItem, nestedItem], pendingJobs: [] })
  assert.equal(byPath[branchA].versionLabel, 'v2a')
  assert.equal(byPath[PATH('imagen-output/20261109-122000-job-3', 'b.png')].versionLabel, 'v2b')
  assert.equal(byPath[nestedItem.images[0].path].versionLabel, 'v3')
  assert.equal(byPath[nestedItem.images[0].path].depth, 2)
})

await check('父删提升：父图不在已加载条目里时子节点成为局部根并标记 sourceDeleted', () => {
  const orphanItem = item({
    jobId: 'job-9',
    images: ['09.png'],
    imageDir: 'imagen-output/20261109-121000-job-9',
    sourceImage: 'imagen-output/20261109-115000-job-0/01.png',
    rootImage: 'imagen-output/20261109-115000-job-0/01.png',
    inpaint: true,
    finishedAt: '2026-11-09T05:09:00.000Z',
  })
  const { roots, byPath, nodes } = buildLineage({ items: [orphanItem], pendingJobs: [] })
  assert.equal(nodes.length, 1, '节点不丢')
  assert.equal(roots.length, 1, '提升为一张独立的局部根作品卡')
  const orphan = byPath[PATH('imagen-output/20261109-121000-job-9', '09.png')]
  assert.equal(orphan.sourceDeleted, true)
  assert.equal(orphan.depth, 0)
  assert.equal(orphan.rootPath, orphan.path)
  assert.equal(orphan.versionLabel, 'v1')
  assert.equal(roots[0].sourceDeleted, true)
  assert.equal(roots[0].latestPath, orphan.path)
})

await check('根缺失回溯：无 rootImage 时按 sourceImage 链回溯已加载条目', () => {
  const p1 = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const p1Path = PATH(ROOT_DIR, '01.png')
  const c2 = item({
    jobId: 'job-2',
    images: ['01.png'],
    imageDir: 'imagen-output/20261109-121000-job-2',
    sourceImage: p1Path,
    inpaint: true,
    finishedAt: '2026-11-09T05:01:00.000Z',
  })
  const c2Path = PATH('imagen-output/20261109-121000-job-2', '01.png')
  const c3 = item({
    jobId: 'job-3',
    images: ['01.png'],
    imageDir: 'imagen-output/20261109-122000-job-3',
    sourceImage: c2Path,
    inpaint: true,
    finishedAt: '2026-11-09T05:02:00.000Z',
  })
  const items = [p1, c2, c3]
  assert.equal(rootOfItem(p1, items), '', '纯文生图条目没有共享根（同批每张图各自为根）')
  assert.equal(rootOfItem(c2, items), p1Path, '父条目是纯文生图 → 父图就是根')
  assert.equal(rootOfItem(c3, items), p1Path, '沿 sourceImage 链回溯到根')
  assert.equal(rootOfItem(c2), p1Path, '不传 items 时退回直接父图')
  const { roots, byPath } = buildLineage({ items, pendingJobs: [] })
  assert.equal(roots.length, 1)
  assert.equal(ROOT_OF(roots).path, p1Path)
  assert.equal(byPath[c3.images[0].path].rootPath, p1Path)
  assert.equal(byPath[c3.images[0].path].depth, 2)
  assert.equal(byPath[c3.images[0].path].versionLabel, 'v3')
})

/** 取以 p1 为根的卡片（消除顺序依赖）。 */
function ROOT_OF(roots) {
  return roots.find((rootCard) => rootCard.path.startsWith('imagen-output/20261109-120000-job-1'))
}

await check('根缺失回溯：回溯层数有上限（8 层）且成环不崩溃', () => {
  const chain = []
  const dirs = []
  for (let index = 0; index <= 10; index += 1) {
    const dir = `imagen-output/20261109-12${String(index).padStart(2, '0')}00-job-${index}`
    dirs.push(dir)
    chain.push(item({
      jobId: `job-${index}`,
      images: ['01.png'],
      imageDir: dir,
      ...(index === 0 ? {} : { sourceImage: PATH(dirs[index - 1], '01.png') }),
      finishedAt: new Date(Date.parse('2026-11-09T05:00:00.000Z') + index * 60000).toISOString(),
    }))
  }
  const leaf = chain[chain.length - 1]
  const root = rootOfItem(leaf, chain)
  assert.ok(root, '回溯结果不能为空')
  assert.notEqual(root, PATH(dirs[0], '01.png'), '超过 8 层时停在可确认的层级，不无限回溯')

  // 两条条目互相指认父图：不能死循环。
  const cycleA = item({ jobId: 'job-a', images: ['01.png'], imageDir: 'imagen-output/loop-a', sourceImage: 'imagen-output/loop-b/01.png' })
  const cycleB = item({ jobId: 'job-b', images: ['01.png'], imageDir: 'imagen-output/loop-b', sourceImage: 'imagen-output/loop-a/01.png' })
  const result = buildLineage({ items: [cycleA, cycleB], pendingJobs: [] })
  assert.ok(result.roots.length >= 1, '成环数据也要能建出作品卡')
  assert.equal(result.nodes.length, 2)
})

// ── 在途幽灵节点 ───────────────────────────────────────────────────────

await check('幽灵节点：按 parentPath / params.reference.path 挂到父节点下并预测版本号', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const pendingBase = '2026-11-09T05:10:00.000Z'
  const pendingJobs = [
    job('p1', { status: 'running', parentPath: rootPath, sourceMode: 'inpaint', createdAt: pendingBase, reference: { path: rootPath, mask: { data: 'b64', coverage: 0.2 } } }),
    job('p2', { status: 'queued', createdAt: '2026-11-09T05:11:00.000Z', reference: { path: rootPath } }),
    job('p3', { status: 'done', parentPath: rootPath }),
    job('p4', { status: 'queued', reference: { path: 'imagen-output/unknown/01.png' } }),
    job('p5', { status: 'queued' }),
  ]
  const { roots, byPath, ghosts, nodes } = buildLineage({ items: [rootItem], pendingJobs })
  assert.equal(ghosts.length, 2, '只保留活动态且能确定父图的任务（p3 终态、p4 未知父图、p5 新建任务都跳过）')
  assert.equal(nodes.length, 3)
  assert.equal(roots.length, 1)
  const rootCard = roots[0]
  assert.equal(rootCard.pendingCount, 2)
  assert.equal(rootCard.badgeCount, 2, '在途派生也算角标')
  assert.equal(rootCard.hasPending, true)
  assert.equal(rootCard.derivedCount, 0, '还没出图，派生数为 0')

  const first = byPath['pending:p1']
  assert.equal(first.ghost, true)
  assert.equal(first.parentPath, rootPath)
  assert.equal(first.depth, 1)
  assert.equal(first.kind, 'inpaint')
  assert.equal(first.status, 'running')
  assert.equal(first.versionLabel, 'v2a', '有 2 个在途分支时按 a / b 预测')
  const second = byPath['pending:p2']
  assert.equal(second.parentPath, rootPath, '没有 parentPath 时从提交体的 reference.path 推断')
  assert.equal(second.kind, 'img2img')
  assert.equal(second.versionLabel, 'v2b')
})

await check('幽灵节点：父图缺失但 rootImage 已知时挂到根下并标记 parentMissing', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const orphanJob = job('p9', {
    status: 'running',
    parentPath: 'imagen-output/20261109-120000-job-1/99.png',
    rootImage: rootPath,
    reference: { path: 'imagen-output/20261109-120000-job-1/99.png' },
  })
  const { byPath, roots } = buildLineage({ items: [rootItem], pendingJobs: [orphanJob] })
  const ghost = byPath['pending:p9']
  assert.ok(ghost, '父图缺失也要显示在途节点')
  assert.equal(ghost.parentPath, rootPath, '挂到已知根下')
  assert.equal(ghost.parentMissing, true)
  assert.equal(ghost.depth, 1)
  assert.equal(roots[0].pendingCount, 1)
})

await check('幽灵节点：终态任务与重复 id 不重复建节点', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'] })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const duplicate = [
    job('p1', { status: 'queued', parentPath: rootPath }),
    job('p1', { status: 'queued', parentPath: rootPath }),
    job('p2', { status: 'failed', parentPath: rootPath }),
    job('p3', { status: 'cancelled', parentPath: rootPath }),
  ]
  const { ghosts } = buildLineage({ items: [rootItem], pendingJobs: duplicate })
  assert.equal(ghosts.length, 1)
  assert.equal(pendingParentOf(duplicate[0]), rootPath)
  assert.equal(pendingKindOf(duplicate[0]), 'text', '无参考图即文生任务')
  assert.equal(pendingKindOf({ params: { reference: { path: 'a', mask: { data: 'x' } } } }), 'inpaint')
  // Host /state 快照里 reference.mask 是布尔标记、路径字段叫 sourcePath：要按宿主真实形状识别。
  assert.equal(pendingKindOf({ params: { reference: { sourcePath: 'a', mask: true } } }), 'inpaint', '布尔蒙版标记也算局部涂抹')
  assert.equal(pendingKindOf({ params: { reference: { sourcePath: 'a', strength: 0.6 } } }), 'img2img')
  assert.equal(
    pendingParentOf({ status: 'queued', params: { reference: { sourcePath: 'imagen-output/a/01.png' } } }),
    'imagen-output/a/01.png',
    '没有客户端 parentPath 时从宿主快照的 sourcePath 推断父图',
  )
})

// ── 草稿摘要与 LRU ─────────────────────────────────────────────────────

await check('草稿摘要：改动项顺序固定为 mask → prompt → params', () => {
  const empty = workDraftSummary(null)
  assert.equal(empty.active, false)
  assert.deepEqual(empty.items, [])

  const summaryOfMaskAndPrompt = workDraftSummary(draft({ prompt: true, mask: true }))
  assert.deepEqual(summaryOfMaskAndPrompt.items, ['mask', 'prompt'], '顺序固定，与对象键顺序无关')
  assert.equal(summaryOfMaskAndPrompt.count, 2)
  assert.equal(summaryOfMaskAndPrompt.hasMask, true)
  assert.equal(summaryOfMaskAndPrompt.active, true)
  assert.equal(summaryOfMaskAndPrompt.tool, 'inpaint')

  const paramsOnly = workDraftSummary(draft({ params: true }))
  assert.deepEqual(paramsOnly.items, ['params'])
  assert.equal(paramsOnly.active, true)

  const noChange = workDraftSummary(draft({}))
  assert.equal(noChange.active, false, 'changed 全 false 时不亮圆点')
  assert.equal(noChange.count, 0)

  const legacy = workDraftSummary({ mask: { data: 'b64', coverage: 0.42 }, changed: undefined })
  assert.equal(legacy.active, true, '老草稿没有 changed 时按蒙版数据兜底')
  assert.deepEqual(legacy.items, ['mask'])
  assert.equal(legacy.coverage, 0.42)
  assert.equal(workDraftSummary({ mask: { data: 'b64', coverage: 3 } }).coverage, 1, '覆盖率钳到 0~1')
})

await check(`LRU 淘汰：默认上限 ${DRAFT_LRU_LIMIT}，淘汰最久未编辑的草稿`, () => {
  const drafts = {}
  for (let index = 0; index < 10; index += 1) {
    drafts[`imagen-output/job-${index}/01.png`] = draft({ mask: true }, { lastTouchedAt: 1000 + index })
  }
  const kept = lruDrafts(drafts, 8)
  assert.equal(Object.keys(kept).length, 8)
  assert.equal('imagen-output/job-0/01.png' in kept, false, '最旧的被淘汰')
  assert.equal('imagen-output/job-1/01.png' in kept, false)
  assert.equal('imagen-output/job-9/01.png' in kept, true, '最新的保留')
  assert.deepEqual(lruDrafts(drafts), kept, '不传 limit 时用默认上限 8')
  assert.equal(Object.keys(lruDrafts(drafts, 0)).length, 0)
  assert.deepEqual(lruDrafts(null), {})
  assert.deepEqual(lruDrafts({}), {})

  // Map 输入、非法时间与非法条目：保留有效草稿，非法条目丢弃。
  const map = new Map()
  map.set('imagen-output/a/01.png', draft({ mask: true }, { lastTouchedAt: 5 }))
  map.set('imagen-output/b/01.png', draft({ prompt: true }, { lastTouchedAt: 9 }))
  map.set('', draft({ mask: true }))
  map.set('imagen-output/c/01.png', null)
  const keptMap = lruDrafts(map, 2)
  assert.deepEqual(Object.keys(keptMap).sort(), ['imagen-output/a/01.png', 'imagen-output/b/01.png'])
})

await check('draftKeyOf：条目 / 图片 / 字符串都归一成 path 键', () => {
  assert.equal(draftKeyOf(' imagen-output/a/01.png '), 'imagen-output/a/01.png')
  assert.equal(draftKeyOf({ image: { path: 'imagen-output/a/01.png' } }), 'imagen-output/a/01.png')
  assert.equal(draftKeyOf({ path: 'imagen-output/a/01.png' }), 'imagen-output/a/01.png')
  assert.equal(draftKeyOf(null), '')
  assert.equal(draftKeyOf({}), '')
  assert.equal(draftKeyOf(42), '')
})

// ── 版本号工具函数 ─────────────────────────────────────────────────────

await check('versionLabelOf / siblingLetter：主版本号与兄弟字母后缀', () => {
  assert.equal(versionLabelOf(null), 'v1')
  assert.equal(versionLabelOf({ depth: 0 }), 'v1')
  assert.equal(versionLabelOf({ depth: 1, siblingCount: 1 }), 'v2')
  assert.equal(versionLabelOf({ depth: 1, siblingCount: 3, siblingIndex: 0 }), 'v2a')
  assert.equal(versionLabelOf({ depth: 1, siblingCount: 3, siblingIndex: 2 }), 'v2c')
  assert.equal(versionLabelOf({ depth: 2, siblingCount: 2, siblingIndex: 1 }), 'v3b')
  assert.equal(versionLabelOf({ depth: 'x', siblingCount: 1 }), 'v1')
  assert.equal(siblingLetter(0), 'a')
  assert.equal(siblingLetter(25), 'z')
  assert.equal(siblingLetter(26), 'aa', '超过 26 个分支继续给稳定字母序号')
  assert.equal(siblingLetter(27), 'ab')
  assert.equal(siblingLetter(-1), 'a')
})

// ── 版本面板行 ─────────────────────────────────────────────────────────

await check('lineagePanelRows：前序遍历、草稿圆点、补拉幽灵行', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const branchDir = 'imagen-output/20261109-121000-job-2'
  const branchItem = item({
    jobId: 'job-2',
    images: ['a.png', 'b.png'],
    imageDir: branchDir,
    sourceImage: rootPath,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:01:00.000Z',
  })
  const branchA = PATH(branchDir, 'a.png')
  const branchB = PATH(branchDir, 'b.png')
  const nestedDir = 'imagen-output/20261109-122000-job-3'
  const nestedItem = item({
    jobId: 'job-3',
    images: ['c.png'],
    imageDir: nestedDir,
    sourceImage: branchA,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:02:00.000Z',
  })
  const nestedPath = PATH(nestedDir, 'c.png')
  const built = buildLineage({ items: [rootItem, branchItem, nestedItem], pendingJobs: [] })

  const drafts = {
    [branchA]: draft({ mask: true, prompt: true }),
    [nestedPath]: draft({ params: true }),
  }
  // 补拉的任务不在 buildLineage 里：按 parentPath 追加成幽灵行。
  const lateJob = job('late-1', { status: 'queued', parentPath: branchB, createdAt: '2026-11-09T05:20:00.000Z' })
  const rows = lineagePanelRows(built.roots[0], built.byPath, drafts, [lateJob])

  assert.ok(rows.length >= 5, `行数应覆盖整棵树，实际 ${rows.length}`)
  assert.equal(rows[0].path, rootPath)
  assert.equal(rows[0].isRoot, true)
  assert.equal(rows[0].depth, 0)
  assert.equal(rows[0].versionLabel, 'v1')
  assert.equal(rows[0].draftSummary.active, false)

  const rowA = rows.find((row) => row.path === branchA)
  assert.ok(rowA, '缺少分支 a 的行')
  assert.equal(rowA.depth, 1)
  assert.equal(rowA.versionLabel, 'v2a')
  assert.equal(rowA.draftSummary.active, true)
  assert.deepEqual(rowA.draftSummary.items, ['mask', 'prompt'])
  assert.ok(rowA.draft, '行里带原始草稿对象，供清空等动作使用')

  const rowNested = rows.find((row) => row.path === nestedPath)
  assert.ok(rowNested)
  assert.deepEqual(rowNested.draftSummary.items, ['params'])
  assert.equal(rowNested.depth, 2)

  const rowLate = rows.find((row) => row.ghost === true && row.jobId === 'late-1')
  assert.ok(rowLate, 'pendingJobs 里未进 byPath 的任务要补成幽灵行')
  assert.equal(rowLate.parentPath, undefined, '行不暴露内部 parentPath 之外的字段，但保留 path')

  // 前序：root → a 及其子树 → b；幽灵行排在真实兄弟之后。
  const orderPaths = rows.map((row) => row.path)
  assert.ok(orderPaths.indexOf(branchA) < orderPaths.indexOf(nestedPath), '子节点紧跟父节点')
  assert.ok(orderPaths.indexOf(branchB) > orderPaths.indexOf(nestedPath), '兄弟 b 在 a 的子树之后')

  // Map 形式的草稿表与字符串根路径都支持。
  const mapRows = lineagePanelRows(rootPath, built.byPath, new Map(Object.entries(drafts)), [])
  assert.equal(mapRows.length, rows.length - 1)
  assert.equal(mapRows.find((row) => row.path === branchA).draftSummary.active, true)

  assert.deepEqual(lineagePanelRows(null, built.byPath, {}), [])
  assert.deepEqual(lineagePanelRows('imagen-output/missing.png', built.byPath, {}), [])
})

await check('lineagePanelRows：isLatest 标记当前树的最新节点', () => {
  const rootItem = item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' })
  const rootPath = PATH(ROOT_DIR, '01.png')
  const latestDir = 'imagen-output/20261109-121000-job-2'
  const latestItem = item({
    jobId: 'job-2',
    images: ['01.png'],
    imageDir: latestDir,
    sourceImage: rootPath,
    rootImage: rootPath,
    finishedAt: '2026-11-09T05:01:00.000Z',
  })
  const built = buildLineage({ items: [rootItem, latestItem], pendingJobs: [] })
  const rows = lineagePanelRows(built.roots[0], built.byPath, {}, [])
  assert.equal(rows.find((row) => row.path === built.roots[0].latestPath).isLatest, true)
  assert.equal(rows.filter((row) => row.isLatest).length, 1)
})

// ── 健壮性 ────────────────────────────────────────────────────────────

await check('空输入与重复数据：不崩溃、不重复建节点、顺序稳定', () => {
  const empty = buildLineage()
  assert.deepEqual(empty.roots, [])
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(empty.byPath, {})
  assert.deepEqual(empty.ghosts, [])
  assert.deepEqual(buildLineage({ items: [null, {}, { images: [] }], pendingJobs: [null, {}] }).roots, [])

  const one = item({ jobId: 'job-1', images: ['01.png'] })
  const duplicated = buildLineage({ items: [one, one], pendingJobs: [] })
  assert.equal(duplicated.nodes.length, 1, '分页重复的同一条目只建一个节点')

  const twoItems = [
    item({ jobId: 'job-1', images: ['01.png'], finishedAt: '2026-11-09T05:00:00.000Z' }),
    item({ jobId: 'job-2', images: ['01.png'], imageDir: 'imagen-output/20261109-121000-job-2', finishedAt: '2026-11-09T05:01:00.000Z' }),
  ]
  const { roots } = buildLineage({ items: twoItems, pendingJobs: [] })
  assert.equal(roots.length, 2)
  assert.ok(roots[0].activity >= roots[1].activity, '作品卡按最新活动倒序')
})

summary()
