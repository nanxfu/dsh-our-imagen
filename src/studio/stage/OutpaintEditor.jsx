/**
 * 扩图画布（outpaint 的 canvas 形态）。
 *
 * 交互与 `MaskEditor` 同属画布类工具，但扩图不涂抹：用户只决定「原图放在扩张后画布的什么位置」。
 *  - 顶部比例胶囊：`四边扩 20%`（默认）+ `16:9` / `9:16` / `4:3`；
 *  - 画布预览：扩张后的画面 + 新增区域半透明着色 + 虚线内容框；
 *  - 内容框可拖拽（pointer capture）调整留白分配，方向键按 8px 微调，双击 / 「回中」复位；
 *  - 任意参数变化后在下一帧把画布合成 image（黑底 + 原图）与蒙版（白 = 新增区）导出，
 *    交给 `useImageTool.applyOutpaintCanvas` 归一与体积校验；体积超限只提示、不提交。
 *
 * 几何全部来自纯逻辑 `src/logic/outpaint.js`（`outpaintPlanOf` / `outpaintAnchorShift`），
 * 组件只负责 DOM 绘制与事件；DOM 不可用（渲染测试的假环境）时导出静默跳过，不抛异常。
 */

import React from 'react'

import { formatText } from '../../logic/format.js'
import {
  OUTPAINT_EXPAND_ID,
  outpaintAnchorOf,
  outpaintAnchorShift,
  outpaintPlanOf,
  outpaintRatioOptions,
} from '../../logic/outpaint.js'

/** 工具栏触控热区：移动端最小 44px（与 MaskEditor 同一约定）。 */
const HIT_STYLE = { minHeight: 44, minWidth: 44 }

/** 键盘微调步长（画布像素）：与 8px 对齐口径一致。 */
const KEY_STEP = 8

/** 覆盖率 → 界面百分比：不足 10% 保留一位小数，避免刚扩一点就显示 0%。 */
function percentOf(coverage) {
  const value = Number(coverage)
  if (!Number.isFinite(value) || value <= 0) return 0
  const percent = Math.min(100, value * 100)
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
}

/** canvas.toDataURL() 的返回值 → 裸 base64（工具域统一再归一一次）。 */
function stripDataUrl(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value.startsWith('data:')) return value
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : ''
}

/** 百分比字符串：元素相对画布的定位。 */
function percentOfSize(value, total) {
  if (!(Number(total) > 0)) return '0%'
  return `${(Number(value) / Number(total)) * 100}%`
}

/**
 * 扩图编辑器。
 *
 * props（Stage 透传）：
 *  - `t`、`target`（底图）、`tool`（工具描述符）；
 *  - `outpaint`：`{ ratioId, anchor, canvas }`（hook 的扩图草稿视图）；
 *  - `onRatioChange(id)` / `onAnchorChange({x,y})` / `onCanvasApply(input)`。
 */
export function OutpaintEditor(props) {
  const {
    t,
    target,
    tool,
    outpaint,
    onRatioChange,
    onAnchorChange,
    onCanvasApply,
  } = props
  const targetWidth = Number(target && target.width)
  const targetHeight = Number(target && target.height)
  const [natural, setNatural] = React.useState(() => ({
    width: Number.isFinite(targetWidth) && targetWidth > 0 ? Math.round(targetWidth) : 0,
    height: Number.isFinite(targetHeight) && targetHeight > 0 ? Math.round(targetHeight) : 0,
  }))
  // 底图是否真的加载过：导出画布必须等 <img> 可绘制，否则先渲染预览、加载完再导。
  const [loaded, setLoaded] = React.useState(false)
  // 拖拽中的临时锚点：只影响预览，松手才写回工具草稿（避免每个 pointermove 都触发导出）。
  const [dragging, setDragging] = React.useState(null)
  const [notice, setNotice] = React.useState('')
  const imageRef = React.useRef(null)
  const stageRef = React.useRef(null)
  const dragRef = React.useRef(null)
  const dragAnchorRef = React.useRef(null)
  const applyRef = React.useRef(onCanvasApply)
  applyRef.current = onCanvasApply

  const canEdit = Boolean(target && target.path && tool && tool.id === 'outpaint')
  const ratioId = outpaint && typeof outpaint.ratioId === 'string' && outpaint.ratioId
    ? outpaint.ratioId
    : OUTPAINT_EXPAND_ID
  const anchor = outpaintAnchorOf(outpaint && outpaint.anchor)
  const options = React.useMemo(() => outpaintRatioOptions(), [])
  const plan = outpaintPlanOf({
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    ratioId,
    anchor,
  })
  const previewAnchor = dragging || anchor
  const previewPlan = outpaintPlanOf({
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    ratioId,
    anchor: previewAnchor,
  })

  /**
   * 把当前版面合成两张画布并交给工具域。
   *
   * image = 黑底 + 原图（等比放进内容框）；黑边整体在蒙版内，不参与最终像素；
   * mask = 白底 + 内容框涂黑（白 = 新增区域）。两张图与画布同尺寸，Host 直接按参考图 + 蒙版提交。
   */
  function exportCanvas() {
    if (!plan.ok) return
    const doc = typeof document === 'undefined' ? null : document
    if (!doc || typeof doc.createElement !== 'function') return
    const sourceImage = imageRef.current
    if (!sourceImage || sourceImage.complete === false) return
    const imageCanvas = doc.createElement('canvas')
    imageCanvas.width = plan.width
    imageCanvas.height = plan.height
    const maskCanvas = doc.createElement('canvas')
    maskCanvas.width = plan.width
    maskCanvas.height = plan.height
    const imageCtx = typeof imageCanvas.getContext === 'function' ? imageCanvas.getContext('2d') : null
    const maskCtx = typeof maskCanvas.getContext === 'function' ? maskCanvas.getContext('2d') : null
    if (!imageCtx || !maskCtx) return
    if (typeof imageCanvas.toDataURL !== 'function' || typeof maskCanvas.toDataURL !== 'function') return

    imageCtx.fillStyle = '#000000'
    imageCtx.fillRect(0, 0, plan.width, plan.height)
    try {
      imageCtx.drawImage(
        sourceImage,
        plan.content.x,
        plan.content.y,
        plan.content.width,
        plan.content.height,
      )
    } catch {
      // 底图还没解码好 / 画布被污染：等 onLoad 后的下一轮再导。
      return
    }
    maskCtx.fillStyle = '#ffffff'
    maskCtx.fillRect(0, 0, plan.width, plan.height)
    maskCtx.fillStyle = '#000000'
    maskCtx.fillRect(plan.content.x, plan.content.y, plan.content.width, plan.content.height)

    const result = typeof applyRef.current === 'function'
      ? applyRef.current({
          image: stripDataUrl(imageCanvas.toDataURL('image/png')),
          mask: stripDataUrl(maskCanvas.toDataURL('image/png')),
          width: plan.width,
          height: plan.height,
          content: plan.content,
        })
      : null
    if (result && result.ok === false) {
      if (result.reason === 'too_large') setNotice(t('studio.outpaint.tooLarge'))
      else if (result.reason === 'invalid') setNotice(t('studio.outpaint.invalidCanvas'))
      else setNotice('')
      return
    }
    setNotice('')
  }

  // 参数 / 底图变化后下一帧导出（setTimeout 0）：连续点胶囊不会把每一下都算一遍。
  // 依赖键覆盖所有影响画布内容的量；`loaded` 保证底图可绘制后才导。
  const exportKey = plan.ok
    ? `${plan.ratioId}|${plan.width}x${plan.height}|${plan.content.x},${plan.content.y}|${natural.width}x${natural.height}`
    : ''
  React.useEffect(() => {
    if (!exportKey || !loaded) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled) exportCanvas()
    }, 0)
    return () => {
      cancelled = true
      if (typeof clearTimeout === 'function') clearTimeout(timer)
    }
  }, [exportKey, loaded, anchor.x, anchor.y])

  if (!canEdit) return null

  /** 底图真实尺寸（旧记录没有宽高时靠 naturalWidth / naturalHeight 补）。 */
  function onTargetLoad(event) {
    const imageElement = event && event.target ? event.target : null
    const width = Number(imageElement && imageElement.naturalWidth)
    const height = Number(imageElement && imageElement.naturalHeight)
    setLoaded(true)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    setNatural((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  function centerAnchor() {
    if (typeof onAnchorChange === 'function') onAnchorChange({ x: 0.5, y: 0.5 })
    setDragging(null)
  }

  function onRatioClick(id) {
    if (typeof onRatioChange === 'function') onRatioChange(id)
  }

  function onContentPointerDown(event) {
    if (!previewPlan.ok) return
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event && event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 旧内核不支持指针捕获：不影响拖拽主流程。
      }
    }
    const stage = stageRef.current
    const rect = stage && typeof stage.getBoundingClientRect === 'function' ? stage.getBoundingClientRect() : null
    dragRef.current = {
      startX: Number(event && event.clientX) || 0,
      startY: Number(event && event.clientY) || 0,
      startAnchor: previewAnchor,
      padX: previewPlan.padding.left + previewPlan.padding.right,
      padY: previewPlan.padding.top + previewPlan.padding.bottom,
      scaleX: rect && rect.width > 0 ? previewPlan.width / rect.width : 1,
      scaleY: rect && rect.height > 0 ? previewPlan.height / rect.height : 1,
      moved: false,
    }
    dragAnchorRef.current = previewAnchor
    setDragging(previewAnchor)
  }

  function onContentPointerMove(event) {
    const drag = dragRef.current
    if (!drag || !previewPlan.ok) return
    const dx = ((Number(event && event.clientX) || 0) - drag.startX) * drag.scaleX
    const dy = ((Number(event && event.clientY) || 0) - drag.startY) * drag.scaleY
    if (dx === 0 && dy === 0) return
    drag.moved = true
    const next = { x: drag.startAnchor.x, y: drag.startAnchor.y }
    if (drag.padX > 0) next.x = drag.startAnchor.x + dx / drag.padX
    if (drag.padY > 0) next.y = drag.startAnchor.y + dy / drag.padY
    const normalized = outpaintAnchorOf(next)
    dragAnchorRef.current = normalized
    setDragging(normalized)
  }

  function onContentPointerUp(event) {
    const drag = dragRef.current
    dragRef.current = null
    if (event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // 指针已经释放时忽略。
      }
    }
    const next = dragAnchorRef.current || anchor
    dragAnchorRef.current = null
    setDragging(null)
    if (drag && drag.moved && typeof onAnchorChange === 'function') onAnchorChange(next)
  }

  /** 方向键按 8px 微调；Home 回中。 */
  function onContentKeyDown(event) {
    if (!event || !previewPlan.ok) return
    const key = event.key
    if (key === 'Home') {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      centerAnchor()
      return
    }
    let delta = null
    if (key === 'ArrowLeft') delta = { x: -KEY_STEP, y: 0 }
    else if (key === 'ArrowRight') delta = { x: KEY_STEP, y: 0 }
    else if (key === 'ArrowUp') delta = { x: 0, y: -KEY_STEP }
    else if (key === 'ArrowDown') delta = { x: 0, y: KEY_STEP }
    else return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof onAnchorChange === 'function') {
      onAnchorChange(outpaintAnchorShift(previewPlan, anchor, delta))
    }
  }

  const layout = previewPlan.ok ? previewPlan : null
  const stageRatio = layout ? layout.width / layout.height : 1
  const percent = percentOf(plan.ok ? plan.coverage : 0)
  const coverageText = plan.ok
    ? formatText(t('studio.outpaint.coverage'), { percent })
    : t('studio.outpaint.blockedCanvas')

  return (
    <div className="ofs-outpaint-editor">
      <div className="ofs-outpaint-top">
        <div className="ofs-outpaint-head">
          <span className="ofs-outpaint-title">{t('studio.outpaint.title')}</span>
          <span className="ofs-outpaint-coverage ofs-muted">{coverageText}</span>
        </div>
        <div className="ofs-outpaint-ratios" role="group" aria-label={t('studio.outpaint.ratioLabel')}>
          {options.map((option) => {
            const active = option.id === ratioId
            return (
              <button
                key={option.id}
                type="button"
                className={active ? 'ofs-outpaint-ratio is-on' : 'ofs-outpaint-ratio'}
                style={HIT_STYLE}
                aria-pressed={active ? 'true' : 'false'}
                title={t(option.labelKey)}
                onClick={() => onRatioClick(option.id)}
              >
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="ofs-outpaint-viewport">
        {layout ? (
          <div
            ref={stageRef}
            className="ofs-outpaint-stage"
            style={{ '--ofs-outpaint-r': String(stageRatio) }}
          >
            {/*
              预览层单独挂 role="img"：画布本身是容器，内容框是它的兄弟节点，
              这样屏幕阅读器既能听到「扩图画布预览」，也能聚焦并操作内容框。
            */}
            <div className="ofs-outpaint-preview" role="img" aria-label={t('studio.outpaint.canvasLabel')}>
              {target.url ? (
                <img
                  ref={imageRef}
                  src={target.url}
                  alt={target.prompt || t('studio.image.alt')}
                  className="ofs-outpaint-photo"
                  draggable={false}
                  onLoad={onTargetLoad}
                  style={{
                    left: percentOfSize(layout.content.x, layout.width),
                    top: percentOfSize(layout.content.y, layout.height),
                    width: percentOfSize(layout.content.width, layout.width),
                    height: percentOfSize(layout.content.height, layout.height),
                  }}
                />
              ) : null}
              {layout.padding.top > 0 ? (
                <span
                  className="ofs-outpaint-shade"
                  aria-hidden="true"
                  style={{ left: 0, top: 0, width: '100%', height: percentOfSize(layout.padding.top, layout.height) }}
                />
              ) : null}
              {layout.padding.bottom > 0 ? (
                <span
                  className="ofs-outpaint-shade"
                  aria-hidden="true"
                  style={{
                    left: 0,
                    top: percentOfSize(layout.height - layout.padding.bottom, layout.height),
                    width: '100%',
                    height: percentOfSize(layout.padding.bottom, layout.height),
                  }}
                />
              ) : null}
              {layout.padding.left > 0 ? (
                <span
                  className="ofs-outpaint-shade"
                  aria-hidden="true"
                  style={{
                    left: 0,
                    top: percentOfSize(layout.content.y, layout.height),
                    width: percentOfSize(layout.padding.left, layout.width),
                    height: percentOfSize(layout.content.height, layout.height),
                  }}
                />
              ) : null}
              {layout.padding.right > 0 ? (
                <span
                  className="ofs-outpaint-shade"
                  aria-hidden="true"
                  style={{
                    left: percentOfSize(layout.width - layout.padding.right, layout.width),
                    top: percentOfSize(layout.content.y, layout.height),
                    width: percentOfSize(layout.padding.right, layout.width),
                    height: percentOfSize(layout.content.height, layout.height),
                  }}
                />
              ) : null}
            </div>
            <button
              type="button"
              className="ofs-outpaint-content"
              aria-label={t('studio.outpaint.dragHint')}
              title={t('studio.outpaint.dragHint')}
              style={{
                left: percentOfSize(layout.content.x, layout.width),
                top: percentOfSize(layout.content.y, layout.height),
                width: percentOfSize(layout.content.width, layout.width),
                height: percentOfSize(layout.content.height, layout.height),
              }}
              onPointerDown={onContentPointerDown}
              onPointerMove={onContentPointerMove}
              onPointerUp={onContentPointerUp}
              onPointerCancel={onContentPointerUp}
              onDoubleClick={centerAnchor}
              onKeyDown={onContentKeyDown}
            >
              <span className="ofs-outpaint-grip" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="ofs-hint ofs-outpaint-empty">{t('studio.outpaint.blockedCanvas')}</p>
        )}
      </div>

      <div className="ofs-outpaint-tools">
        <button type="button" className="ofs-dock-button ofs-outpaint-center" style={HIT_STYLE} onClick={centerAnchor}>
          {t('studio.outpaint.center')}
        </button>
        <p className="ofs-hint ofs-outpaint-hint">{t('studio.outpaint.hint')}</p>
      </div>

      {notice ? <p className="ofs-hint ofs-outpaint-warn" role="status">{notice}</p> : null}
    </div>
  )
}
