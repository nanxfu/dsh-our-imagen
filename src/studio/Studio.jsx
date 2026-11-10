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
import { ChatPanel } from './ChatPanel.jsx'
import { Filmstrip } from './Filmstrip.jsx'
import { Gallery } from './Gallery.jsx'
import { GuidanceCard } from './GuidanceCard.jsx'
import { Rail } from './Rail.jsx'
import { Stage } from './Stage.jsx'
import { Toast } from './Toast.jsx'
import { TopBar } from './TopBar.jsx'
import { useStudio } from './useStudio.js'

export function Studio(props) {
  const s = useStudio(props)
  const now = useNow(Boolean(s.activeJob))
  const elapsedMs = s.activeJob ? jobElapsed(s.activeJob, now) : 0
  const guidanceKind = s.guidanceKind
  const chatMode = s.panelMode === 'chat'

  const panel = chatMode
    ? (
        <ChatPanel
          t={s.t}
          patchForm={s.patchForm}
          sending={s.sending}
          messages={s.messages}
          interpreting={s.interpreting}
          onSend={s.interpret}
          onGenerateIntent={s.generateIntent}
          onResolveClarify={s.resolveClarify}
          onClearThread={s.clearThread}
          onOpenMessage={s.openMessage}
          mode={s.panelMode}
          setMode={s.setPanelMode}
        />
      )
    : (
        <Rail
          t={s.t}
          form={s.form}
          patchForm={s.patchForm}
          styleId={s.styleId}
          applyStyle={s.applyStyle}
          ratioId={s.ratioId}
          applyRatio={s.applyRatio}
          advancedOpen={s.advancedOpen}
          setAdvancedOpen={s.setAdvancedOpen}
          negativeOpen={s.negativeOpen}
          setNegativeOpen={s.setNegativeOpen}
          sending={s.sending}
          onGenerate={() => s.generate()}
          refineGroups={s.refineGroups}
          refineSource={s.refineSource}
          enhancing={s.enhancing}
          onEnhance={s.enhance}
          onToggleRefine={s.toggleRefine}
          onInspire={s.useInspiration}
          mode={s.panelMode}
          setMode={s.setPanelMode}
        />
      )

  return (
    <div className="ofs-root">
      <style>{CSS}</style>

      <div className="ofs-app">
        <TopBar
          t={s.t}
          view={s.view}
          setView={s.setView}
          sessionState={s.sessionState}
          session={s.session}
          quota={s.quota}
          presets={s.presets}
          form={s.form}
          patchForm={s.patchForm}
          busy={s.busy}
          probing={s.probing}
          probe={s.probe}
          probeReport={s.probeReport}
          onStart={s.startSession}
          onStop={s.stopSession}
          onProbe={s.runProbe}
          onRefresh={s.loadHistory}
          onOpenFolder={s.openFolder}
        />

        <GuidanceCard
          t={s.t}
          kind={guidanceKind}
          detail={s.guidanceDetail}
          onReset={s.resetToSafe}
          onWake={s.startSession}
          onRecheck={s.runProbe}
          onRetry={s.retryFocusedJob}
          onClose={s.dismissGuidance}
          onCopyCommand={s.copyInstallCommand}
        />

        <div className={`ofs-body${s.view === 'gallery' ? ' is-gallery' : ''}`}>
          {s.view === 'studio' ? panel : null}

          <div className="ofs-main">
            {s.view === 'gallery' ? (
              <Gallery
                t={s.t}
                gallery={s.gallery}
                now={Date.now()}
                presets={s.presets}
                favorites={s.favorites}
                onDelete={s.deleteImages}
                onExport={s.exportPaths}
                onRecall={s.iterate}
                onVariant={s.reroll}
                onZoom={s.zoomImage}
                onOpen={(entry) => {
                  s.selectImage(entry)
                  s.setView('studio')
                }}
              />
            ) : (
              <Stage
                t={s.t}
                selected={s.selected}
                activeJob={s.activeJob}
                sessionQueued={s.sessionQueued}
                zoom={s.zoom}
                setZoom={s.setZoom}
                onIterate={s.iterate}
                onReroll={s.reroll}
                onCopy={s.copyPath}
                isFavorite={s.isFavorite}
                onToggleFavorite={s.toggleFavorite}
                onUseExample={s.useInspiration}
              />
            )}
          </div>
        </div>

        {s.view === 'studio' ? (
          <Filmstrip
            t={s.t}
            batches={s.batches}
            activeJob={s.activeJob}
            selected={s.selected}
            onSelect={s.selectImage}
            now={now}
            elapsedMs={elapsedMs}
            sessionState={s.sessionState}
            sessionQueued={s.sessionQueued}
            onSessionStart={s.startSession}
            onOpenGallery={() => s.setView('gallery')}
          />
        ) : null}
      </div>

      <Toast toast={s.toast} />
    </div>
  )
}