/**
 * 生图工作台（Studio）：顶栏 + 单轨创作面板 + 画面预览 + 最近生成 + 画廊。
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
import { jobElapsed } from '../logic/format.js'
import { sessionElapsedMs } from '../logic/status.js'
import { ChatPanel } from './ChatPanel.jsx'
import { Filmstrip } from './Filmstrip.jsx'
import { Gallery } from './Gallery.jsx'
import { GuidanceCard } from './GuidanceCard.jsx'
import { LogsDrawer } from './LogsDrawer.jsx'
import { Rail } from './Rail.jsx'
import { SessionBar } from './SessionBar.jsx'
import { Stage } from './Stage.jsx'
import { Toast } from './Toast.jsx'
import { TopBar } from './TopBar.jsx'
import { useStudioLogs } from './hooks/useStudioLogs.js'
import { useCompletionNotice } from './hooks/useStudioUi.js'
import { useStudio } from './useStudio.js'

export function Studio(props) {
  const { t, ui, compute, form, chat, library, guidance, actions } = useStudio(props)
  const status = compute.status
  // 有任务或云端处于过渡态时每秒刷新，进度文案与「已等待」都能走字。
  const now = useNow(Boolean(compute.activeJob) || status.transient)
  const elapsedMs = compute.activeJob ? jobElapsed(compute.activeJob, now) : 0
  const sessionElapsed = status.transient ? sessionElapsedMs(compute.session, now) : null
  const chatMode = ui.panelMode === 'chat'
  // 日志抽屉只在打开时轮询；完成提醒在页面隐藏期间用标签页标题提示。
  const logs = useStudioLogs(ui.logsOpen)
  useCompletionNotice({ t, ui, job: compute.focusedJob, activeJob: compute.activeJob })

  const panel = chatMode
    ? <ChatPanel t={t} ui={ui} form={form} chat={chat} library={library} actions={actions} />
    : <Rail t={t} ui={ui} form={form} actions={actions} />

  return (
    <div className="ofs-root">
      <style>{CSS}</style>

      <div className="ofs-app">
        <TopBar t={t} ui={ui} compute={compute} form={form} library={library} />

        <SessionBar t={t} status={status} elapsedMs={sessionElapsed} />

        <GuidanceCard t={t} guidance={guidance} compute={compute} actions={actions} ui={ui} />

        <div className={`ofs-body${ui.view === 'gallery' ? ' is-gallery' : ''}`}>
          {ui.view === 'studio' ? panel : null}

          <div className="ofs-main">
            {ui.view === 'gallery' ? (
              <Gallery
                t={t}
                gallery={library.gallery}
                now={Date.now()}
                presets={compute.presets}
                favorites={library.favorites}
                onDelete={library.deleteImages}
                onExport={library.exportPaths}
                onRecall={actions.iterate}
                onVariant={actions.reroll}
                onZoom={library.zoomImage}
                onOpen={(entry) => {
                  library.selectImage(entry)
                  ui.setView('studio')
                }}
              />
            ) : (
              <Stage t={t} ui={ui} compute={compute} form={form} library={library} actions={actions} />
            )}
          </div>
        </div>

        {ui.view === 'studio' ? (
          <Filmstrip t={t} ui={ui} compute={compute} library={library} elapsedMs={elapsedMs} />
        ) : null}
      </div>

      {ui.logsOpen ? <LogsDrawer t={t} ui={ui} compute={compute} logs={logs} onClose={ui.closeLogs} /> : null}

      <Toast toast={ui.toast} />
    </div>
  )
}