/**
 * 底部最近生成栏：显式新建草稿卡 + 待执行暗房卡 + 按根折叠的作品版本卡。
 *
 * 阶段十三（0.13.0）把「按批次平铺」升级为「按根树折叠」：
 *  1. 最左端是新建草稿卡（`workspaceMode === 'new_draft'` 时显示当前表单画幅/预设/未提交态）；
 *  2. 中间是待执行任务的暗房卡（全局队列视图：位次、已用时间、取消按钮——原逻辑不变）；
 *  3. 右侧每棵版本树占一张卡：缩略图取该树最新活跃节点，右上角 `⎇ N` 角标表示派生/在途分支数；
 *     悬停 250ms 或点击角标展开版本派生面板，行内可切到任意版本、看到草稿圆点与在途幽灵节点。
 *
 * 数据来源：`library.lineage`（useWorkLibrary 用已加载历史 + 在途任务建立的索引）、
 * `library.workDrafts`（工具域未提交草稿）、`library.newDraftCard`（新建草稿卡数据）。
 * 阶段十五 A1 起 `newDraftCard` 还带 `draft` / `draftFrom`：左栏未提交修改被托管进最左端
 * 草稿卡（「未提交草稿 · 源自此图」），点它恢复草稿并切到新建画布焦点（§6.1.2、§6.1.4）。
 * 版本树不完整（还有更早分页）时，面板首次打开会按需 `library.loadTree(root)`；
 * 旧宿主没有该接口（404）时面板显示降级提示，继续只用已加载分页。
 *
 * 接收 { t, ui, compute, library, actions, now }；缩略图点击交回组合层
 * `actions.previewWork`（换预览 + 表单干净时回填参数），没有该动作时退回纯选图。
 */

import React from 'react'

import { Icon } from './icons.jsx'
import { formatDuration, formatText, jobElapsed } from '../logic/format.js'
import { isJobCancellable, isJobCancelling, jobCardClass } from '../logic/jobs.js'
import { buildLineage, lineagePanelRows, workDraftSummary } from '../logic/lineage.js'
import { jobProgressText } from '../logic/status.js'
import { DraftCard } from './filmstrip/DraftCard.jsx'
import { VersionPanel } from './filmstrip/VersionPanel.jsx'

/** 草稿圆点聚合时的固定顺序：涂抹 → 提示词 → 参数。 */
const DRAFT_ITEMS = ['mask', 'prompt', 'params']
const EMPTY_ROWS = []

/** 同一棵树的草稿聚合：任意节点有未提交改动就在缩略图角上亮一个圆点。 */
function treeDraftSummary(rootCard, workDrafts, workDraftSummaryFn) {
  if (!rootCard || !Array.isArray(rootCard.nodes) || !workDrafts || typeof workDrafts !== 'object') return null
  const items = []
  let hasMask = false
  let hasPrompt = false
  let hasParams = false
  for (const node of rootCard.nodes) {
    if (!node || node.ghost || !node.path) continue
    const summary = typeof workDraftSummaryFn === 'function'
      ? workDraftSummaryFn(node.path)
      : workDraftSummary(workDrafts[node.path] || null)
    if (!summary || summary.active !== true) continue
    if (summary.hasMask) hasMask = true
    if (summary.hasPrompt) hasPrompt = true
    if (summary.hasParams) hasParams = true
  }
  const flags = { mask: hasMask, prompt: hasPrompt, params: hasParams }
  for (const key of DRAFT_ITEMS) if (flags[key]) items.push(key)
  if (items.length === 0) return null
  return {
    active: true,
    items,
    count: items.length,
    hasMask,
    hasPrompt,
    hasParams,
    tool: '',
    lastTouchedAt: 0,
    coverage: 0,
  }
}

/** 节点 → 作品条目（与历史条目同形，交给组合层切换预览）。 */
function entryOfNode(node) {
  if (!node || !node.path) return null
  return {
    image: {
      path: node.path,
      url: node.url || '',
      file: node.file || '',
      width: node.width,
      height: node.height,
      seed: node.seed,
    },
    item: node.item || null,
  }
}

export function Filmstrip(props) {
  const { t, ui, compute, library, actions, now } = props
  const { setView } = ui
  const { pendingJobs, sessionState, startSession, status, cancelJob, cancellingIds } = compute
  const stopped = Boolean(status && status.stopped)
  const { selected, selectImage } = library
  const previewWork = actions && typeof actions.previewWork === 'function' ? actions.previewWork : null
  const openWork = previewWork || selectImage

  // 阶段十三数据：优先用 useWorkLibrary 派生的 lineage；渲染测试最小挂载时按 items 兜底重建。
  const items = Array.isArray(library.items) ? library.items : []
  const pendingSignature = pendingJobs.map((job) => `${job.id}:${job.status}`).join(',')
  const fallbackLineage = React.useMemo(
    () => buildLineage({ items, pendingJobs }),
    [items, pendingSignature],
  )
  const lineage = library.lineage && Array.isArray(library.lineage.roots) ? library.lineage : fallbackLineage
  const roots = Array.isArray(lineage.roots) ? lineage.roots : []
  const byPath = lineage.byPath && typeof lineage.byPath === 'object' ? lineage.byPath : {}
  const workDrafts = library.workDrafts && typeof library.workDrafts === 'object' ? library.workDrafts : {}
  const newDraftCard = library.newDraftCard && typeof library.newDraftCard === 'object' ? library.newDraftCard : {}
  const workspaceMode = library.workspaceMode === 'new_draft' ? 'new_draft' : 'work'
  const clearWorkDraft = typeof library.clearWorkDraft === 'function' ? library.clearWorkDraft : null
  const workDraftSummaryFn = typeof library.workDraftSummary === 'function' ? library.workDraftSummary : null

  const selectedPath = selected && selected.image ? selected.image.path : ''
  const stripRef = React.useRef(null)
  const rollRef = React.useRef(null)
  // 当前展开版本面板的根路径（同一时刻只展开一棵树，避免多个浮层叠在一起）。
  const [openRoot, setOpenRoot] = React.useState('')

  // 底部作品条是横向滚动容器：桌面鼠标滚轮默认只有纵向 deltaY，这里转为横向 scrollLeft；
  // 触控板自带横向 deltaX（或系统 Shift+滚轮已转成 deltaX）时交还浏览器原生滚动。
  React.useEffect(() => {
    const strip = stripRef.current
    const roll = rollRef.current
    if (!strip || !roll || typeof strip.addEventListener !== 'function') return undefined

    function onWheel(event) {
      if (roll.scrollWidth <= roll.clientWidth) return
      const deltaX = Number(event.deltaX) || 0
      const deltaY = Number(event.deltaY) || 0
      if (!deltaY || Math.abs(deltaX) > Math.abs(deltaY)) return
      const unit = event.deltaMode === 1 ? 32 : (event.deltaMode === 2 ? roll.clientWidth : 1)
      roll.scrollLeft += deltaY * unit
      if (event.preventDefault) event.preventDefault()
    }

    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      if (typeof strip.removeEventListener === 'function') {
        strip.removeEventListener('wheel', onWheel)
      }
    }
  }, [])

  // 面板行只在展开时计算（收起不付遍历成本）；草稿表或任务列表变化时重算。
  const openRootEntry = roots.find((rootCard) => rootCard && rootCard.path === openRoot) || null
  const panelRows = React.useMemo(
    () => (openRootEntry ? lineagePanelRows(openRootEntry, byPath, workDrafts, pendingJobs) : EMPTY_ROWS),
    [openRootEntry, byPath, workDrafts, pendingSignature],
  )

  // 按需拉版本树：还有更早分页且该根尚未拉过时，面板第一次展开触发一次（loadTree 内部去重/降级）。
  const hasMore = library.hasMore === true
  const loadTree = typeof library.loadTree === 'function' ? library.loadTree : null
  React.useEffect(() => {
    if (!openRootEntry || !hasMore || !loadTree) return
    loadTree(openRootEntry.path)
    // openRootEntry 身份每次 lineage 重算都会变，用 path + hasMore 控制触发次数。
  }, [openRootEntry && openRootEntry.path, hasMore])

  function openVersion(node) {
    const entry = entryOfNode(node)
    if (!entry) return
    if (openWork) openWork(entry)
    setOpenRoot('')
  }

  /** 清空一棵树里所有作品的编辑草稿（缩略图圆点上的「一键清空」）。 */
  function clearTreeDrafts(rootCard) {
    if (!clearWorkDraft || !rootCard || !Array.isArray(rootCard.nodes)) return
    for (const node of rootCard.nodes) {
      if (!node || node.ghost || !node.path) continue
      const summary = typeof workDraftSummaryFn === 'function'
        ? workDraftSummaryFn(node.path)
        : workDraftSummary(workDrafts[node.path] || null)
      if (!summary || summary.active !== true) continue
      clearWorkDraft(node.path)
    }
  }

  // 文案：只在这里组装，展示组件保持纯 props。
  const draftCardLabels = {
    title: t('studio.filmstrip.newDraft'),
    hint: t('studio.filmstrip.draftHint'),
    active: t('studio.filmstrip.draftActive'),
    pending: t('studio.filmstrip.draftPending'),
    ratio: '{width} × {height}',
    // 阶段十五 A1：未提交草稿托管态（§6.1.2）。
    unsaved: t('studio.filmstrip.draftUnsaved'),
    from: t('studio.filmstrip.draftFrom'),
    fromPrompt: t('studio.filmstrip.draftFromPrompt'),
  }
  const panelLabels = {
    title: t('studio.filmstrip.versionPanelTitle'),
    empty: t('studio.filmstrip.versionPanelEmpty'),
    loading: t('studio.filmstrip.versionLoading'),
    unavailable: t('studio.filmstrip.treeUnavailable'),
    inFlight: t('studio.filmstrip.versionInFlight'),
    badge: t('studio.filmstrip.versionBadge'),
    badgeHint: t('studio.filmstrip.versionBadgeHint'),
    kindText: t('studio.filmstrip.versionKind.text'),
    kindImg2img: t('studio.filmstrip.versionKind.img2img'),
    kindInpaint: t('studio.filmstrip.versionKind.inpaint'),
    draftItems: {
      mask: t('studio.filmstrip.draftItems.mask'),
      prompt: t('studio.filmstrip.draftItems.prompt'),
      params: t('studio.filmstrip.draftItems.params'),
    },
    draftTitle: t('studio.filmstrip.draftTitle'),
    draftClear: t('studio.filmstrip.draftClear'),
    sourceDeleted: t('studio.filmstrip.sourceDeleted'),
  }

  // 只要已有作品、在途任务、主动进入过新建态或有未提交草稿，底部新建画布卡始终保留在最左端，
  // 切换到其它作品查看或重绘时也不消失，方便随时点回新建画布 / 草稿。
  const showDraftCard = roots.length > 0
    || pendingJobs.length > 0
    || newDraftCard.pending === true
    || newDraftCard.explicit === true
    || newDraftCard.draft === true
  const hasContent = roots.length > 0 || pendingJobs.length > 0 || showDraftCard

  return (
    <footer className={openRoot ? 'ofs-filmstrip is-version-open' : 'ofs-filmstrip'} ref={stripRef}>
      <div className="ofs-roll" ref={rollRef}>
        {showDraftCard ? (
          <DraftCard
            labels={draftCardLabels}
            width={newDraftCard.width}
            height={newDraftCard.height}
            presetLabel={newDraftCard.presetLabel}
            prompt={newDraftCard.prompt}
            active={workspaceMode === 'new_draft'}
            pending={newDraftCard.pending === true}
            draft={newDraftCard.draft === true}
            draftFrom={newDraftCard.draftFrom}
            draftFromSource={newDraftCard.draftFromSource === true}
            onClick={() => {
              if (actions && typeof actions.focusNewDraft === 'function') {
                actions.focusNewDraft()
              } else if (typeof library.focusDraft === 'function') {
                library.focusDraft()
                if (ui && typeof ui.setPanelMode === 'function') ui.setPanelMode('form')
              } else if (ui && typeof ui.setPanelMode === 'function') {
                ui.setPanelMode('form')
              }
            }}
          />
        ) : null}

        {pendingJobs.map((job, index) => {
          const queued = job.status === 'queued'
          const cancelling = isJobCancelling(job, cancellingIds)
          const cancelLabel = t(cancelling ? 'studio.job.cancelling' : 'studio.job.cancel')
          // 时间缺失（老快照没有 createdAt）时宁可不写，也不要显示成「0.0秒」或「—」。
          const elapsedMs = jobElapsed(job, now)
          const elapsed = Number.isFinite(elapsedMs) ? formatDuration(t, elapsedMs) : ''
          return (
            <div
              className={jobCardClass(job, cancellingIds)}
              key={job.id}
              title={job.params && typeof job.params.prompt === 'string' ? job.params.prompt : undefined}
            >
              <span className="ofs-ghost-frame" aria-hidden="true">
                {queued
                  ? <span className="ofs-ghost-slot">{index + 1}</span>
                  : <span className="ofs-ghost-bar" />}
              </span>
              <span className="ofs-ghost-text">
                <span className="ofs-ghost-label">{jobProgressText(t, job, sessionState)}</span>
                {elapsed ? <span className="ofs-ghost-time">{elapsed}</span> : null}
              </span>
              {isJobCancellable(job) && typeof cancelJob === 'function' ? (
                <button
                  type="button"
                  className="ofs-ghost-cancel"
                  aria-label={cancelLabel}
                  title={cancelling ? cancelLabel : t('studio.job.cancelHint')}
                  disabled={cancelling}
                  onClick={() => cancelJob(job.id)}
                >
                  {cancelLabel}
                </button>
              ) : null}
            </div>
          )
        })}

        {!hasContent ? (
          <div className="ofs-filmstrip-empty">
            <div className="ofs-slots" aria-hidden="true">
              <span className="ofs-slot" />
              <span className="ofs-slot" />
              <span className="ofs-slot" />
            </div>
            <span>
              {sessionState === 'absent'
                ? (stopped ? t('studio.filmstrip.offlineClosed') : t('studio.filmstrip.offline'))
                : t('studio.filmstrip.empty')}
              {sessionState === 'absent' ? (
                <button type="button" className="ofs-link" onClick={startSession}>
                  {t('studio.compute.start')}
                </button>
              ) : null}
            </span>
          </div>
        ) : null}

        {roots.map((rootCard) => {
          const thumbNode = rootCard.latest || rootCard.node
          if (!thumbNode || !thumbNode.path) return null
          const badgeCount = Math.max(0, Number(rootCard.badgeCount) || 0)
          const versionCount = badgeCount
          const summary = treeDraftSummary(rootCard, workDrafts, workDraftSummaryFn)
          const metaText = versionCount > 0
            ? formatText(t('studio.filmstrip.versionsCount'), { count: versionCount })
            : `${Math.max(1, Number(rootCard.count) || 1)} ${t('unit.image')}`
          return (
            <div className="ofs-batch" key={rootCard.path} data-root={rootCard.path}>
              <div className="ofs-batch-thumbs">
                <VersionPanel
                  labels={panelLabels}
                  rows={openRoot === rootCard.path ? panelRows : EMPTY_ROWS}
                  currentPath={selectedPath}
                  badgeCount={badgeCount}
                  hasPending={rootCard.pendingCount > 0}
                  loading={library.treeLoadingRoot === rootCard.path}
                  unavailable={library.treeUnavailable === true}
                  draftSummary={summary}
                  onClearTreeDrafts={() => clearTreeDrafts(rootCard)}
                  onSelect={(row) => openVersion(row.node)}
                  onClearDraft={(row) => {
                    if (clearWorkDraft && row && row.path) clearWorkDraft(row.path)
                  }}
                  onOpenChange={(isOpen) => {
                    setOpenRoot((prev) => {
                      if (isOpen) return rootCard.path
                      return prev === rootCard.path ? '' : prev
                    })
                  }}
                >
                  <button
                    type="button"
                    className={thumbNode.path === selectedPath ? 'ofs-thumb is-on' : 'ofs-thumb'}
                    onClick={() => openWork(entryOfNode(thumbNode))}
                    title={thumbNode.prompt || rootCard.path}
                  >
                    <img
                      src={thumbNode.url}
                      alt={thumbNode.prompt || thumbNode.file || t('studio.image.alt')}
                      loading="lazy"
                    />
                  </button>
                </VersionPanel>
              </div>
              <span className="ofs-batch-meta">
                {thumbNode.presetId ? <em>{thumbNode.presetId}</em> : <em />}
                <span>{metaText}</span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="ofs-filmstrip-side">
        <button type="button" className="ofs-filmstrip-link" onClick={() => setView('gallery')}>
          <Icon name="images" size={15} />
          {t('studio.gallery.title')}
          <Icon name="chevronRight" size={13} />
        </button>
      </div>
    </footer>
  )
}
