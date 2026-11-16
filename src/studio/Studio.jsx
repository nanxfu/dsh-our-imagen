/**
 * 生图工作台（Studio）：顶栏 + 顶部生图流水线 + 单轨创作面板 + 画面预览 + 最近生成 + 画廊。
 *
 * 挂载在宿主 shell 的 main 插槽上，作为独立整页视图；
 * 侧栏入口由 index.js 通过 sidebar.panellist 注册。
 *
 * 左侧面板两种形态共用一份状态：
 *   表单式（Rail）—— 适合精确调参；
 *   对话式（ChatPanel）—— 适合自然语言描述与迭代。
 */

import React from 'react'

import { CSS } from '../styles.js'
import { useNow } from '../hooks/useNow.js'
import { guidanceSurfaceOf } from '../logic/guidance.js'
import { pipelineHoldOf, pipelineViewOf } from '../logic/pipeline.js'
import { ChatPanel } from './ChatPanel.jsx'
import { Filmstrip } from './Filmstrip.jsx'
import { Gallery } from './Gallery.jsx'
import { GuidanceCard } from './GuidanceCard.jsx'
import { LogsDrawer } from './LogsDrawer.jsx'
import { PipelineBar } from './PipelineBar.jsx'
import { QueueNotice } from './QueueNotice.jsx'
import { Rail } from './Rail.jsx'
import { SettingsDrawer } from './SettingsDrawer.jsx'
import { Stage } from './Stage.jsx'
import { Toast } from './Toast.jsx'
import { TopBar } from './TopBar.jsx'
import { useStudioLogs } from './hooks/useStudioLogs.js'
import { useCompletionNotice } from './hooks/useStudioUi.js'
import { useStudio } from './useStudio.js'

/** 静态样式节点：1Hz 走字刷新时不重复比对整段 CSS 文本。 */
const StudioStyles = React.memo(function StudioStyles() {
  return <style>{CSS}</style>
})

export function Studio(props) {
  const { t, isEn, ui, compute, form, chat, library, guidance, actions } = useStudio(props)
  const status = compute.status
  // 完成态还要保留一会儿：宿主 2 秒轮询一次，任务真正完成的时刻客户端最晚 2 秒后才知道，
  // 只靠「有活动任务」会停表，完成节点就闪不出来。失败态没有时间变化，不需要额外刷新。
  const pipelineHold = pipelineHoldOf(compute.focusedJob, Date.now())
  const now = useNow(Boolean(compute.activeJob) || status.transient || pipelineHold)
  const chatMode = ui.panelMode === 'chat'
  // 日志抽屉只在打开时轮询；完成提醒在页面隐藏期间用标签页标题提示。
  const logs = useStudioLogs(ui.logsOpen)
  useCompletionNotice({ t, ui, job: compute.focusedJob, activeJob: compute.activeJob })

  // 生图流水线：失败态在指引提示被收起时一起收起，同一条错误只占一条位置。
  const pipeline = pipelineViewOf(t, {
    session: compute.session,
    activeJob: compute.activeJob,
    focusedJob: compute.focusedJob,
    pendingCount: compute.pendingJobs.length,
    queuePolicy: compute.queue.policy,
    failureDismissed: Boolean(guidance.key) && ui.dismissed === guidance.key,
    now: Date.now(),
  })

  const panel = chatMode
    ? <ChatPanel t={t} ui={ui} form={form} chat={chat} library={library} actions={actions} />
    : <Rail t={t} ui={ui} form={form} actions={actions} />

  // 指引按严重度分流：全局阻塞/环境前置卡走顶部横幅，局部可恢复/一次性提醒走右上角通知。
  const guidanceSurface = guidance && guidance.kind
    ? (guidance.surface || guidanceSurfaceOf(guidance.kind))
    : ''
  const bannerGuidance = guidanceSurface === 'banner' ? guidance : null
  const noticeGuidance = guidanceSurface === 'toast' ? guidance : null

  return (
    <div className="ofs-root">
      <StudioStyles />

      <div className="ofs-app">
        <TopBar t={t} isEn={isEn} ui={ui} compute={compute} form={form} library={library} defaultModelOpen={props.defaultModelOpen} />

        {/* 顶部生图流水线：替换原先的一行云端状态条，五节点展示等待流程。 */}
        <PipelineBar view={pipeline} />

        {/* 排队卡住（10 分钟档）是非错误提示：横幅给「换新实例重排」，不阻挡工作区。 */}
        <QueueNotice t={t} notice={compute.queueNotice} />

        {bannerGuidance ? (
          <GuidanceCard t={t} guidance={bannerGuidance} compute={compute} actions={actions} ui={ui} />
        ) : null}

        <div className={`ofs-body${ui.view === 'gallery' ? ' is-gallery' : ''}`}>
          {ui.view === 'studio' ? panel : null}

          <div className="ofs-main">
            {ui.view === 'gallery' ? (
              <Gallery
                t={t}
                gallery={library.gallery}
                now={now}
                presets={compute.presets}
                favorites={library.favorites}
                hasMore={library.hasMore}
                loadingMore={library.loadingMore}
                onLoadMore={library.loadMore}
                onDelete={library.deleteImages}
                onExport={library.exportPaths}
                onRecall={actions.iterate}
                onVariant={actions.reroll}
                onReference={actions.referenceImage}
                onToggleFavorite={library.toggleFavorite}
                onZoom={library.zoomImage}
                onOpen={(entry) => {
                  library.selectImage(entry)
                  ui.setView('studio')
                }}
              />
            ) : (
              <Stage t={t} ui={ui} compute={compute} form={form} library={library} actions={actions} now={now} />
            )}
          </div>
        </div>

        {ui.view === 'studio' ? (
          <Filmstrip t={t} ui={ui} compute={compute} library={library} now={now} />
        ) : null}
      </div>

      {ui.logsOpen ? <LogsDrawer t={t} ui={ui} compute={compute} logs={logs} onClose={ui.closeLogs} /> : null}

      {ui.settingsOpen ? <SettingsDrawer t={t} ui={ui} onClose={ui.closeSettings} /> : null}

      <Toast t={t} toast={ui.toast} guidance={noticeGuidance} compute={compute} actions={actions} ui={ui} />
    </div>
  )
}
