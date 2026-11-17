/** 画面预览：光桌上的相纸。大图居中，图下一条题注与一条动作坞。 */

import React from 'react'

import { INSPIRE_KEYS } from '../constants.js'
import { formatText, formatSeconds } from '../logic/format.js'
import { referenceUrlOf } from '../logic/generate.js'
import { IMAGE_TOOLS } from '../logic/imageTool.js'
import { jobCountText } from '../logic/status.js'
import { Icon } from './icons.jsx'
import { useFocusTrap } from './hooks/useFocusTrap.js'
import { CompareSlider } from './stage/CompareSlider.jsx'
import { ImageDock } from './stage/ImageDock.jsx'
import { ImageDropzone } from './stage/ImageDropzone.jsx'
import { InlineTool } from './stage/InlineTool.jsx'
import { MaskEditor } from './stage/MaskEditor.jsx'
import { ToolSubmitBar } from './stage/ToolSubmitBar.jsx'

/** 出图后一分钟内才算「刚落定」，超过就当历史作品直接陈列。 */
const FRESH_MS = 60_000

function isFreshItem(item, now) {
  const finishedAt = Date.parse(String((item && item.finishedAt) || ''))
  if (!Number.isFinite(finishedAt)) return false
  const current = Number.isFinite(now) ? now : Date.now()
  const delta = current - finishedAt
  return delta > -5_000 && delta < FRESH_MS
}

/** 正数比例；宽高缺失时回落到正方形画幅。 */
function ratioOf(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1
  return w / h
}

/** 涂抹覆盖率 → 界面百分比读数：不足 10% 时保留一位小数，避免刚涂一点就显示 0%。 */
function percentOf(coverage) {
  const value = Number(coverage)
  if (!Number.isFinite(value) || value <= 0) return 0
  const percent = Math.min(100, value * 100)
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
}

/**
 * 舞台：只做编排。
 *
 * - 主表单回归纯文生图后，针对作品的二次处理（局部涂抹 / 整图重绘）全部由
 *   舞台底部动作坞 `ImageDock` 一步直达；编辑态下画布 / 轻量重绘条二选一挂载，
 *   提交栏由 tool-core 的组件内置，Stage 不再自己拼提交参数。
 * - 空舞台没有底图，不再出现涂抹入口；动作坞只在有选中作品时渲染。
 *
 * 接收 { t, ui, compute, form, library, imageTool, actions, now } 领域对象。
 */
export function Stage(props) {
  const { t, ui, compute, form, library, imageTool, actions, now } = props
  const { zoom, setZoom, copyPath } = ui
  const { activeJob } = compute
  // 舞台胶囊只保留「还在动 + 第 N/M 张」：阶段名与已等待由顶部生图流水线负责，不重复说两遍。
  const progressText = activeJob ? jobCountText(t, activeJob) : ''
  const { useInspiration } = form
  const { selected, isFavorite, toggleFavorite } = library
  const image = selected && selected.image ? selected.image : null
  const item = (selected && selected.item) || null
  const params = (item && item.params) || null
  // 真实 Host 的历史条目只保证有 prompt，params 可能不存在；都不能时保持空串。
  const prompt = (item && typeof item.prompt === 'string' && item.prompt)
    || (params && typeof params.prompt === 'string' && params.prompt)
    || ''
  const closeRef = React.useRef(null)
  const lightboxRef = React.useRef(null)
  // 打开大图前的焦点位置：关闭后还给触发按钮。
  const zoomOpenerRef = React.useRef(null)

  function openZoom() {
    zoomOpenerRef.current = document.activeElement || null
    setZoom(true)
  }

  // ── 图片工具编排 ───────────────────────────────────────────────
  //
  // 状态全部在 useImageTool：Stage 只决定「现在显示预览、画布还是重绘条」，
  // 并把动作坞需要的工具描述符补上本地化文案与可用状态。
  const activeTool = imageTool && imageTool.activeTool ? imageTool.activeTool : null
  const editorOpen = Boolean(imageTool && imageTool.editorOpen && activeTool && imageTool.target)

  // ── 本地导入与拉帘对比（阶段十五 Phase A3）────────────────────
  //
  // 导入入口包住整个舞台（含编辑态）：编辑态拖入时由 ImageDropzone 提示并拒绝，
  // 不覆盖正在涂抹的草稿。对比层只对带 sourceImage 的派生作品开放。
  const dropzoneRef = React.useRef(null)
  const compareOpen = Boolean(ui && ui.compareOpen)
  const setCompareOpen = ui && typeof ui.setCompareOpen === 'function' ? ui.setCompareOpen : null
  const imageKey = image ? (image.path || image.file || image.url || '') : ''
  // 真实 Host 的派生条目直接带 sourceImage；旧记录可能只写在 params 里。
  const sourceImage = (item && typeof item.sourceImage === 'string' && item.sourceImage)
    || (params && typeof params.sourceImage === 'string' && params.sourceImage)
    || ''
  const compareUrl = sourceImage ? referenceUrlOf(sourceImage) : ''
  // 切图时收起对比：拉帘不能停在上一张作品的原图上。
  // 用「上一张图的键」而不是首次挂载就关，避免助手胶囊先置 compareOpen=true 再挂载舞台时被立刻关掉。
  const compareKeyRef = React.useRef(imageKey)
  React.useEffect(() => {
    if (compareKeyRef.current === imageKey) return
    compareKeyRef.current = imageKey
    if (setCompareOpen) setCompareOpen(false)
  }, [imageKey, setCompareOpen])
  // 进入图片工具编辑态时同样收起：编辑分支不展示拉帘。
  React.useEffect(() => {
    if (editorOpen && setCompareOpen) setCompareOpen(false)
  }, [editorOpen, setCompareOpen])
  // 新画布与空舞台才给「选择图片」入口；有作品时舞台留给作品与动作坞。
  const hasGallery = Array.isArray(library.gallery) && library.gallery.length > 0
  const draftCard = library.newDraftCard && typeof library.newDraftCard === 'object' ? library.newDraftCard : {}
  const showNewDraft = library.workspaceMode === 'new_draft'
    && (hasGallery || draftCard.pending === true || Boolean(activeJob) || draftCard.explicit === true)
  const showChoose = !editorOpen && !activeJob && (showNewDraft || !image)

  const toolItems = IMAGE_TOOLS.map((tool) => ({
    ...tool,
    label: t(tool.labelKey),
    enabled: tool.ready === true,
    hint: tool.ready === true ? '' : t(tool.plannedKey || 'studio.imageTool.planned'),
  }))
  // 草稿状态：关闭编辑态但仍留有已涂蒙版时，给「继续编辑」一个覆盖率读数。
  const draftStatusLabel = activeTool && !editorOpen && imageTool.mask
    ? formatText(t('studio.imageTool.draftStatus'), { percent: percentOf(imageTool.coverage) })
    : ''
  const resumeLabel = activeTool ? t('studio.imageTool.resumeDraft') : ''

  /** 工具提交栏需要的 props：MaskEditor / InlineTool 共用，避免两处漂移。 */
  const submitProps = {
    t,
    target: imageTool ? imageTool.target : null,
    tool: activeTool,
    // 只列当前工具真正可用的预设（inpaint 要 supportsInpaint、img2img 要 supportsImg2Img 且非 inpaintOnly）：
    // 列全量会让用户选到不支持能力的模型，切换请求被静默拒绝。
    presets: imageTool && Array.isArray(imageTool.toolPresets) ? imageTool.toolPresets : [],
    presetId: imageTool ? imageTool.presetId : '',
    onPresetChange: imageTool ? imageTool.selectPreset : () => {},
    prompt: imageTool ? imageTool.prompt : '',
    onPromptChange: imageTool ? imageTool.setPrompt : () => {},
    strength: imageTool ? imageTool.strength : 0,
    strengthMax: imageTool ? imageTool.strengthMax : 0,
    strengthAuto: imageTool ? imageTool.strengthAuto : false,
    onStrengthChange: imageTool ? imageTool.setStrength : () => {},
    submitting: Boolean(imageTool && imageTool.submitting),
    canSubmit: Boolean(imageTool && imageTool.canSubmit),
    blockedKey: imageTool ? imageTool.submitBlockedKey : '',
    onSubmit: imageTool ? imageTool.submit : () => {},
    // 「暂存涂抹」与 Esc 保留蒙版草稿并收起；底部红色「取消」按钮丢弃草稿并退出。
    onStash: imageTool ? imageTool.closeTool : () => {},
    onExit: imageTool ? (imageTool.discardTool || imageTool.closeTool) : () => {},
  }

  const target = imageTool ? imageTool.target : null
  const promptPlaceholder = (target && target.prompt) || t('studio.imageTool.promptPlaceholder')

  const editorNode = editorOpen
    ? (activeTool.form === 'canvas'
      ? <MaskEditor {...submitProps} mask={imageTool.mask} coverage={imageTool.coverage} onMaskApply={imageTool.applyMask} onMaskClear={imageTool.clearMask} now={now} />
      : <InlineTool {...submitProps} />)
    : null

  const dock = (
    <ImageDock
      t={t}
      tools={toolItems}
      activeToolId={activeTool ? activeTool.id : ''}
      editing={editorOpen}
      resumeLabel={resumeLabel}
      draftStatusLabel={draftStatusLabel}
      onOpen={(toolId) => actions.openImageTool(toolId)}
      onResume={() => {
        if (!activeTool) return
        // 用草稿绑定的底图重新进入编辑态，避免用户切过预览后「继续编辑」串到别的作品。
        const target = imageTool.target
        const entry = target
          ? { image: { path: target.path, url: target.url, width: target.width, height: target.height }, item: target.item || null }
          : selected
        actions.openImageTool(activeTool.id, entry)
      }}
      onClose={() => imageTool.closeTool()}
      onReroll={() => actions.reroll(selected)}
      plannedTitle={t('studio.imageTool.planned')}
    />
  )

  // 编辑态：画布放进 .ofs-figure（画布按容器宽高换算，不挤小），提交条原地落到舞台下方替代动作坞，
  // 整图重绘自带预览与提交条。不再多挂一行重复的「退出」dock。
  let content = null
  if (editorOpen) {
    content = (
      <section className="ofs-stage">
        {activeTool.form === 'canvas' ? (
          <>
            <figure className="ofs-figure">{editorNode}</figure>
            <ToolSubmitBar
              {...submitProps}
              promptPlaceholder={promptPlaceholder}
              maskCoverage={imageTool ? imageTool.coverage : 0}
            />
          </>
        ) : (
          editorNode
        )}
        {activeJob ? (
          <div className="ofs-stage-progress" aria-hidden="true">
            <span className="ofs-shimmer" aria-hidden="true" />
            <span className="ofs-progress-label">{progressText}</span>
          </div>
        ) : null}
      </section>
    )
  } else if (showNewDraft) {
    // 显式新建绘图态（阶段十三）：打开工作台默认新建画布；已有历史或显式点过「新建创作」时
    // 显示模糊动态背景 + 取景框，没有历史且未手动点新建时继续展示新手引导（灵感示例 + 云端提示）。
    const stopped = Boolean(compute.status && compute.status.stopped)
    const fields = (form && form.form) || {}
    const frameRatio = ratioOf(fields.width, fields.height)
    const preset = (compute.presets || []).find((option) => option && option.id === fields.presetId) || null
    const steady = preset && Number.isFinite(Number(preset.steadySeconds)) ? Number(preset.steadySeconds) : null
    content = (
      <section className="ofs-stage ofs-stage--draft">
        <div className="ofs-figure ofs-figure--draft">
          <div className="ofs-draft-backdrop" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="ofs-frame ofs-frame--draft" style={{ '--ofs-frame-r': String(frameRatio) }}>
            <span className="ofs-marks" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <div className="ofs-frame-body">
              <div className="ofs-empty-card ofs-draft-blank">
                <p className="ofs-empty-title">{t('studio.stage.newDraftTitle')}</p>
                <p className="ofs-muted">
                  {draftCard.pending || activeJob
                    ? t('studio.stage.newDraftPending')
                    : (stopped ? t('studio.stage.stoppedHint') : t('studio.stage.newDraftHint'))}
                </p>
                {/* 阶段十五 A1：点草稿卡恢复后，取景框注明草稿的来源作品（§6.1.4）。 */}
                {draftCard.draft === true && draftCard.draftFrom ? (
                  <p className="ofs-draft-source">
                    {formatText(t('studio.stage.draftFrom'), { prompt: draftCard.draftFrom })}
                  </p>
                ) : null}
                {!draftCard.pending && !activeJob && !draftCard.prompt ? (
                  <div className="ofs-examples">
                    <span className="ofs-examples-label">{t('studio.stage.examples')}</span>
                    {INSPIRE_KEYS.map((key) => (
                      <button type="button" key={key} className="ofs-example" onClick={() => useInspiration(t(key))} title={t(key)}>
                        {t(`${key}.label`)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!draftCard.pending && !activeJob && steady !== null ? (
                  <p className="ofs-exposure">
                    <span className="ofs-exposure-rule" aria-hidden="true" />
                    {t('studio.stage.steady')} {formatSeconds(t, steady)}
                    <span className="ofs-exposure-rule" aria-hidden="true" />
                  </p>
                ) : null}

                {/* 进行中：进度胶囊排进引导文案下方（而不是浮在正中压住句子）。 */}
                {activeJob ? (
                  <div className="ofs-stage-progress is-flow" aria-hidden="true">
                    <span className="ofs-shimmer" aria-hidden="true" />
                    <span className="ofs-progress-label">{progressText}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  } else if (!image) {
    // 手动关闭云端后不能再说「点击生成即可出图」：生成会被宿主拒绝，先提示唤醒。
    const stopped = Boolean(compute.status && compute.status.stopped)
    // 等待出图时取景框按这次任务的尺寸画；空闲时按当前表单比例画。
    const jobParams = (activeJob && activeJob.params) || {}
    const fields = (form && form.form) || {}
    const frameRatio = ratioOf(jobParams.width || fields.width, jobParams.height || fields.height)
    // 曝光单：这台机器在这个预设上大概多久出一张，先给个准话再让人点生成。
    const preset = (compute.presets || []).find((option) => option && option.id === fields.presetId) || null
    const steady = preset && Number.isFinite(Number(preset.steadySeconds)) ? Number(preset.steadySeconds) : null
    content = (
      <section className="ofs-stage">
        <div className="ofs-figure ofs-figure--empty">
          <div className="ofs-frame" style={{ '--ofs-frame-r': String(frameRatio) }}>
            <span className="ofs-marks" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>

            <div className="ofs-frame-body">
              {activeJob ? null : (
                <div className="ofs-empty-card">
                  <p className="ofs-empty-title">{t('studio.stage.empty')}</p>
                  <p className="ofs-muted">{stopped ? t('studio.stage.stoppedHint') : t('studio.stage.emptyHint')}</p>
                  <div className="ofs-examples">
                    <span className="ofs-examples-label">{t('studio.stage.examples')}</span>
                    {INSPIRE_KEYS.map((key) => (
                      <button type="button" key={key} className="ofs-example" onClick={() => useInspiration(t(key))} title={t(key)}>
                        {t(`${key}.label`)}
                      </button>
                    ))}
                  </div>
                  {steady !== null ? (
                    <p className="ofs-exposure">
                      <span className="ofs-exposure-rule" aria-hidden="true" />
                      {t('studio.stage.steady')} {formatSeconds(t, steady)}
                      <span className="ofs-exposure-rule" aria-hidden="true" />
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {activeJob ? (
            <div className="ofs-stage-progress is-inside" aria-hidden="true">
              <span className="ofs-shimmer" aria-hidden="true" />
              <span className="ofs-progress-label">{progressText}</span>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  // 作品分支：相纸 + 玻璃按钮 + 动作坞。带 sourceImage 的派生作品可切「对比原图」拉帘，
  // 打开时用 CompareSlider 原位替代相纸（放大 / 收藏 / 复制路径按钮保持可用）。
  if (!content) {
    const favorite = isFavorite(image.path || image.file)
    // 「复制文件路径」要给绝对路径：历史条目里带 absolute，老记录退回相对路径。
    const copyTarget = image.absolute || image.path || image.file
    const printRatio = ratioOf(image.width, image.height)
    // 刚落定的图才播一次显影；翻历史作品直接陈列。
    const developing = isFreshItem(item, now)

    content = (
      <section className="ofs-stage">
        <figure className="ofs-figure">
          <div className="ofs-print-slot">
            {compareOpen && compareUrl ? (
              <CompareSlider
                t={t}
                beforeUrl={compareUrl}
                afterUrl={image.url}
                beforeLabel={t('studio.compare.before')}
                afterLabel={t('studio.compare.after')}
                ratio={printRatio}
              />
            ) : (
              <button
                type="button"
                key={imageKey}
                className={developing ? 'ofs-print is-developing' : 'ofs-print'}
                style={{ '--ofs-print-r': String(printRatio) }}
                onClick={openZoom}
                title={t('studio.stage.zoom')}
              >
                <img src={image.url} alt={prompt || image.file || t('studio.image.alt')} className="ofs-image" />
              </button>
            )}

            <div className="ofs-figure-tools">
              {compareUrl && setCompareOpen ? (
                <button
                  type="button"
                  className={compareOpen ? 'ofs-glass-btn is-on' : 'ofs-glass-btn'}
                  onClick={() => setCompareOpen(!compareOpen)}
                  title={t('studio.compare.toggle')}
                  aria-label={t('studio.compare.toggle')}
                  aria-pressed={compareOpen}
                >
                  <Icon name="images" size={16} />
                </button>
              ) : null}
              <button type="button" className="ofs-glass-btn" onClick={openZoom} title={t('studio.stage.zoom')} aria-label={t('studio.stage.zoom')}>
                <Icon name="expand" size={16} />
              </button>
              <button type="button" className="ofs-glass-btn" onClick={() => copyPath(copyTarget)} title={t('studio.action.copyPath')} aria-label={t('studio.action.copyPath')}>
                <Icon name="copy" size={16} />
              </button>
              <button
                type="button"
                className={favorite ? 'ofs-glass-btn is-on' : 'ofs-glass-btn'}
                onClick={() => toggleFavorite(image.path || image.file)}
                title={favorite ? t('studio.action.favorited') : t('studio.action.favorite')}
                aria-label={favorite ? t('studio.action.favorited') : t('studio.action.favorite')}
                aria-pressed={favorite}
              >
                <Icon name={favorite ? 'starFilled' : 'star'} size={16} />
              </button>
            </div>
          </div>

          {activeJob ? (
            <div className="ofs-stage-progress" aria-hidden="true">
              <span className="ofs-shimmer" aria-hidden="true" />
              <span className="ofs-progress-label">{progressText}</span>
            </div>
          ) : null}
        </figure>

        <div className="ofs-stage-foot">
          <p className="ofs-stage-prompt" title={prompt || undefined}>{prompt}</p>
          <div className="ofs-stage-meta">
            <span>
              {image.width || '—'} × {image.height || '—'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatSeconds(t, image.seconds)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {t('studio.meta.seed')} {image.seed ?? '—'}
            </span>
          </div>
        </div>

        {dock}

        {zoom ? (
          <div
            className="ofs-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={t('studio.stage.zoom')}
            ref={lightboxRef}
            onClick={() => setZoom(false)}
          >
            <img
              src={image.url}
              alt={prompt || image.file || t('studio.image.alt')}
              onClick={(event) => event.stopPropagation()}
            />
            <button
              ref={closeRef}
              type="button"
              className="ofs-lightbox-close"
              onClick={() => setZoom(false)}
              aria-label={t('studio.stage.close')}
            >
              <Icon name="close" size={16} />
            </button>
            {/* 大图预览里的「以此图重绘」：一步直达局部涂抹（决策 D4）。 */}
            <button
              type="button"
              className="ofs-lightbox-action"
              onClick={(event) => {
                // 放大层本身点任意位置都会关闭，这个按钮单独处理，避免先关层再弹提示。
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                actions.openImageTool('inpaint', selected)
              }}
            >
              <Icon name="image" size={15} />
              {t('studio.action.reference')}
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  // 拖放 / 粘贴 / 选择图片包住整个舞台（含编辑态，编辑态拖入由 ImageDropzone 提示并拒绝）。
  // onImported 缺接线时留给组件回退 toast，不伪造焦点切换。
  const onImported = actions && typeof actions.activateImport === 'function' ? actions.activateImport : undefined
  return (
    <ImageDropzone
      t={t}
      ui={ui}
      editorOpen={editorOpen}
      showChoose={showChoose}
      triggerRef={dropzoneRef}
      onImported={onImported}
    >
      {content}
    </ImageDropzone>
  )
}
