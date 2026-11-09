/**
 * 生图工作台（Studio）：顶栏 + 创作面板 + 焦点舞台 + 胶卷流 + 画廊。
 *
 * 挂载在宿主 shell 的 main 插槽上，作为独立整页视图；
 * 侧栏入口由 index.js 通过 sidebar.panellist 注册。
 *
 * 左侧面板两种形态共用一份状态：
 *   表单式（Rail）—— 适合精确调参；
 *   对话式（ChatPanel）—— 适合连续描述与追问。
 */

import React from 'react'

import css from '../styles.css'
import { useNow } from '../hooks/useNow.js'
import { jobElapsed } from '../logic/format.js'
import { ChatPanel } from './ChatPanel.jsx'
import { Filmstrip } from './Filmstrip.jsx'
import { Gallery } from './Gallery.jsx'
import { GuidanceCard, guidanceKindOf } from './GuidanceCard.jsx'
import { Rail } from './Rail.jsx'
import { Stage } from './Stage.jsx'
import { Toast } from './Toast.jsx'
import { TopBar } from './TopBar.jsx'
import { useStudio } from './useStudio.js'

export function Studio(props) {
  const s = useStudio(props)
  const now = useNow(Boolean(s.activeJob))
  const elapsedMs = s.activeJob ? jobElapsed(s.activeJob, now) : 0
  const guidanceKind = guidanceKindOf(s.guidanceCode)
  const chatMode = s.panelMode === 'chat'

  const panel = chatMode
    ? (
        <ChatPanel
          t={s.t}
          form={s.form}
          patchForm={s.patchForm}
          sending={s.sending}
          onGenerate={s.generateWithText}
          messages={s.messages}
          onReroll={s.reroll}
          onIterate={() => s.iterate(s.selected)}
          onClearThread={s.clearThread}
          onOpenMessage={s.openMessage}
          hasSelection={Boolean(s.selected)}
          mode={s.panelMode}
          setMode={s.setPanelMode}
          onEnhance={s.enhance}
          enhancing={s.enhancing}
          suggestions={s.suggestions}
          onApplySuggestion={s.applySuggestion}
        />
      )
    : (
        <Rail
          t={s.t}
          form={s.form}
          patchForm={s.patchForm}
          isEn={s.isEn}
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
          suggestions={s.suggestions}
          suggestSource={s.suggestSource}
          enhancing={s.enhancing}
          onEnhance={s.enhance}
          onApplySuggestion={s.applySuggestion}
          presets={s.presets}
          mode={s.panelMode}
          setMode={s.setPanelMode}
        />
      )

  return (
    <div className="ofs-root">
      <style>{css}</style>

      <TopBar
        t={s.t}
        view={s.view}
        setView={s.setView}
        sessionState={s.sessionState}
        presets={s.presets}
        form={s.form}
        patchForm={s.patchForm}
        busy={s.busy}
        onStart={s.startSession}
        onStop={s.stopSession}
        onProbe={s.runProbe}
      />

      <div className="ofs-shell">
        <GuidanceCard
          t={s.t}
          kind={guidanceKind}
          onReset={s.resetToSafe}
          onWake={s.startSession}
          onRecheck={s.runProbe}
          onRetry={s.reroll}
        />

        <div className={`ofs-body ${chatMode ? 'is-chat' : ''}`}>
          {panel}

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
                zoom={s.zoom}
                setZoom={s.setZoom}
                onIterate={s.iterate}
                onReroll={s.reroll}
                onCopy={s.copyPath}
                isFavorite={s.isFavorite}
                onToggleFavorite={s.toggleFavorite}
                onUseExample={(text) => s.patchForm({ prompt: text })}
              />
            )}
          </div>
        </div>
      </div>

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
      />

      <Toast toast={s.toast} />
    </div>
  )
}