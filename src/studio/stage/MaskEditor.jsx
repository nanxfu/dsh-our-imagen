/**
 * 局部涂抹画布（局部重绘的画布形态）。
 *
 * 从改造前的 `src/studio/Stage.jsx` **原样搬移**画布交互：画笔 / 橡皮擦 / 清空 /
 * 反选 / 覆盖率读数 / 指针绘制 / 键盘绘制 / 已有蒙版还原 / 黑底白字 PNG 导出。
 * 交互语义与类名（`.ofs-mask-editor` / `.ofs-mask-stage` / `.ofs-mask-canvas` /
 * `.ofs-mask-tools` / `.ofs-mask-cursor` 等）保持不变；差别只有两点：
 *
 *  1. 蒙版与底图来自图片工具域（`useImageTool`），不再挂在左栏表单上；
 *  2. 画布下方内嵌 `ToolSubmitBar`，提交不依赖左栏「立即生成」。
 */

import React from 'react'

import { formatText } from '../../logic/format.js'
import { referenceFileName } from '../../logic/generate.js'
import {
  MASK_BRUSH,
  MASK_CANVAS_EDGE,
  MASK_KEY_STEP,
  brushStateOf,
  clampBrushSize,
  emptyMaskState,
  maskCanvasSizeOf,
  maskCoverageOf,
  maskExportVerdict,
  maskStateOf,
  toggleEraser,
} from '../../logic/mask.js'

import { ToolSubmitBar } from './ToolSubmitBar.jsx'

/** 蒙版工具栏的触控热区：移动端最小 44px，键盘 Tab 顺序沿用原生按钮。 */
const MASK_HIT_STYLE = { minHeight: 44, minWidth: 44 }

/** 涂抹覆盖率 → 界面百分比读数：不足 10% 时保留一位小数，避免刚涂一点就显示 0%。 */
function percentOf(coverage) {
  const value = Number(coverage)
  if (!Number.isFinite(value) || value <= 0) return 0
  const percent = Math.min(100, value * 100)
  return percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10
}

/**
 * 画布编辑器。
 *
 * props 见 `.tmp/plan/INTERFACES.md` §2.5；`now` 由 Stage 统一透传（渲染测试注入时间），
 * 画布本身不消费它。
 */
export function MaskEditor(props) {
  const {
    t,
    target,
    tool,
    presets,
    presetId,
    onPresetChange,
    prompt,
    onPromptChange,
    strength,
    strengthMax,
    onStrengthChange,
    mask,
    coverage,
    onMaskApply,
    onMaskClear,
    submitting,
    canSubmit,
    blockedKey,
    onSubmit,
    onExit,
  } = props
  const list = Array.isArray(presets) ? presets : []
  const activePreset = list.find((item) => item && item.id === presetId) || null
  const canPaint = Boolean(target && target.path && tool && tool.form === 'canvas')

  const targetWidth = Number(target && target.width)
  const targetHeight = Number(target && target.height)
  // 画布尺寸按底图宽高比换算（远端会按最近邻对齐到参考图精确宽高，同比例才不会错位）。
  const [naturalSize, setNaturalSize] = React.useState(() => ({
    width: Number.isFinite(targetWidth) && targetWidth > 0 ? Math.round(targetWidth) : 0,
    height: Number.isFinite(targetHeight) && targetHeight > 0 ? Math.round(targetHeight) : 0,
  }))
  const canvasSize = maskCanvasSizeOf(naturalSize.width, naturalSize.height, MASK_CANVAS_EDGE)
  const [brush, setBrush] = React.useState(() => brushStateOf())
  // 本地覆盖率读数：每一笔结束立即更新，不等上层状态回流，涂抹时读数不滞后。
  const [inkCoverage, setInkCoverage] = React.useState(() => maskStateOf({ coverage: mask ? mask.coverage : 0 }).coverage)
  // 蒙版体积超限等可见提示（画布内容保留，只提示用户减少涂抹面积）。
  const [maskNotice, setMaskNotice] = React.useState('')
  const canvasRef = React.useRef(null)
  const cursorRef = React.useRef(null)
  // 正在绘制的一笔：{ x, y } 是上一个画布坐标点；null 表示没有按住。
  const drawingRef = React.useRef(null)
  // 键盘涂抹的光标位置：与指针绘制分开，避免空格落笔后移动鼠标误连出一笔。
  const keyboardCursorRef = React.useRef(null)
  // 打开编辑器时要还原的蒙版：只在画布重建的 effect 里读，避免每次渲染都重绘。
  const restoreRef = React.useRef(mask)
  restoreRef.current = mask

  // 上层改写蒙版时同步覆盖率读数（恢复草稿 / 外部写入）：画布自己的每一笔已在
  // commitMask 里先更新本地读数，这里只兜住「不是画布画出来的」那条路径。
  const coverageProp = Number(coverage)
  React.useEffect(() => {
    if (!Number.isFinite(coverageProp)) return
    setInkCoverage(maskStateOf({ coverage: coverageProp }).coverage)
  }, [coverageProp])

  /**
   * 画布上下文：渲染测试的假 DOM 里 canvas 没有 getContext，所有绘制入口都从
   * 这里统一返回 null，保证纯渲染场景不会崩。
   */
  function canvasContext() {
    const canvas = canvasRef.current
    if (!canvas || typeof canvas.getContext !== 'function') return null
    const ctx = canvas.getContext('2d')
    return ctx ? { canvas, ctx } : null
  }

  /** 事件坐标 → 画布像素坐标（画布可能被 CSS 缩放过）。宽高分别换算，压扁时笔迹不变形。 */
  function canvasPointOf(event) {
    const canvas = canvasRef.current
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null
    const rect = canvas.getBoundingClientRect()
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null
    return {
      x: ((Number(event && event.clientX) || 0) - rect.left) * (canvas.width / rect.width),
      y: ((Number(event && event.clientY) || 0) - rect.top) * (canvas.height / rect.height),
    }
  }

  /**
   * 画布在页面上的缩放系数：宽、高分别计算。
   *
   * 正常情况下两者相等；容器被压矮或窄屏时 CSS 仍会保住画布比例，这里按两轴
   * 分别换算，指针落点与光标定位都不依赖「正方形缩放」的假设。
   */
  function canvasScaleOf(canvas) {
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null
    const rect = canvas.getBoundingClientRect()
    if (!rect || !(rect.width > 0) || !(rect.height > 0) || !(canvas.width > 0) || !(canvas.height > 0)) return null
    return {
      rect,
      scaleX: rect.width / canvas.width,
      scaleY: rect.height / canvas.height,
    }
  }

  /** 白色涂抹层（透明底）；橡皮擦走 destination-out，把已涂的像素擦回透明。 */
  function paintDot(ctx, x, y, eraser) {
    ctx.save()
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1, brush.size / 2), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** 两笔之间连线：pointermove 高频调用，只画增量线段。 */
  function paintLine(ctx, from, to, eraser) {
    ctx.save()
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, brush.size)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.restore()
  }

  /** 画布 → 非透明像素占比；getImageData 不可用（测试替身）时按 0 处理。 */
  function coverageOfCanvas(canvas, ctx) {
    if (typeof ctx.getImageData !== 'function') return 0
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = pixels && pixels.data ? pixels.data : []
    let ink = 0
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) ink += 1
    }
    return maskCoverageOf(ink, canvas.width * canvas.height)
  }

  /** 把已保存的黑底白字蒙版还原成透明画布上的白色涂抹层。 */
  function restoreStoredMask(ctx, canvas, imageElement) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
    const scratch = document.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    const scratchCtx = scratch.getContext('2d')
    if (!scratchCtx || typeof scratchCtx.getImageData !== 'function') return
    scratchCtx.drawImage(imageElement, 0, 0, scratch.width, scratch.height)
    const pixels = scratchCtx.getImageData(0, 0, scratch.width, scratch.height)
    const data = pixels.data
    for (let index = 0; index < data.length; index += 4) {
      // 黑底白字 → 透明底白字：亮度超过中位数的像素算涂抹区域。
      const painted = data[index] + data[index + 1] + data[index + 2] > 382
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = painted ? 255 : 0
    }
    ctx.putImageData(pixels, 0, 0)
  }

  /**
   * 画布 → 黑底白字 PNG base64，并交给图片工具域（`useImageTool.applyMask`）。
   *
   * 空蒙版（未涂抹 / 全擦掉）不生成字段，并清掉草稿里上一笔的蒙版；
   * 体积超限时保留画布内容、只给提示，让用户减少涂抹面积。
   */
  function commitMask(coverageOverride) {
    const geometry = canvasContext()
    if (!geometry) return
    const { canvas, ctx } = geometry
    const coverage = Number.isFinite(Number(coverageOverride))
      ? maskStateOf({ coverage: coverageOverride }).coverage
      : coverageOfCanvas(canvas, ctx)
    setInkCoverage(coverage)
    setMaskNotice('')
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
    const exporter = document.createElement('canvas')
    exporter.width = canvas.width
    exporter.height = canvas.height
    const exportCtx = exporter.getContext('2d')
    if (!exportCtx) return
    exportCtx.fillStyle = '#000000'
    exportCtx.fillRect(0, 0, exporter.width, exporter.height)
    exportCtx.drawImage(canvas, 0, 0)
    const verdict = maskExportVerdict(exporter.toDataURL('image/png'), coverage)
    if (!verdict.ok) {
      if (verdict.reason === 'empty') {
        if (restoreRef.current) {
          restoreRef.current = null
          if (typeof onMaskClear === 'function') onMaskClear()
        }
        return
      }
      if (verdict.reason === 'too_large') setMaskNotice(t('studio.mask.tooLarge'))
      return
    }
    const result = typeof onMaskApply === 'function'
      ? onMaskApply({ data: verdict.data, coverage: verdict.coverage })
      : null
    if (result && result.ok === false) {
      if (result.reason === 'too_large' || result.reason === 'invalid') setMaskNotice(t('studio.mask.tooLarge'))
    }
  }

  /** 画布上的涂抹光标圈：鼠标悬停与键盘移动都用同一个元素，直接改样式避免高频重渲染。 */
  function placeMaskCursor(left, top, scale) {
    const cursor = cursorRef.current
    if (!cursor || !cursor.style) return
    const size = Math.max(2, brush.size * scale)
    cursor.style.display = 'block'
    cursor.style.width = `${size}px`
    cursor.style.height = `${size}px`
    cursor.style.left = `${left}px`
    cursor.style.top = `${top}px`
  }

  function hideMaskCursor() {
    const cursor = cursorRef.current
    if (cursor && cursor.style) cursor.style.display = 'none'
  }

  /** 鼠标 / 触控：按下落点、拖动连线、抬起提交。 */
  function onMaskPointerDown(event) {
    const geometry = canvasContext()
    if (!geometry) return
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event && event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 某些旧内核不支持指针捕获；不影响基本绘制。
      }
    }
    const point = canvasPointOf(event)
    if (!point) return
    paintDot(geometry.ctx, point.x, point.y, brush.eraser)
    drawingRef.current = { x: point.x, y: point.y }
    keyboardCursorRef.current = { x: point.x, y: point.y }
    const scale = canvasScaleOf(geometry.canvas)
    if (scale) {
      placeMaskCursor(
        (Number(event.clientX) || 0) - scale.rect.left,
        (Number(event.clientY) || 0) - scale.rect.top,
        Math.min(scale.scaleX, scale.scaleY),
      )
    }
  }

  function onMaskPointerMove(event) {
    const geometry = canvasContext()
    if (!geometry) return
    const point = canvasPointOf(event)
    if (!point) return
    const scale = canvasScaleOf(geometry.canvas)
    if (scale) {
      placeMaskCursor(
        (Number(event.clientX) || 0) - scale.rect.left,
        (Number(event.clientY) || 0) - scale.rect.top,
        Math.min(scale.scaleX, scale.scaleY),
      )
    }
    const previous = drawingRef.current
    if (!previous) return
    paintLine(geometry.ctx, previous, point, brush.eraser)
    drawingRef.current = { x: point.x, y: point.y }
  }

  function onMaskPointerUp(event) {
    if (!drawingRef.current) return
    drawingRef.current = null
    if (event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // 指针已经释放时忽略。
      }
    }
    commitMask()
  }

  /** 键盘涂抹：方向键移动画笔、空格 / 回车落笔、Esc 退出编辑态，触控板与纯键盘都能用。 */
  function onMaskKeyDown(event) {
    const key = event && event.key
    if (key === 'Escape') {
      if (typeof onExit === 'function') onExit()
      return
    }
    const geometry = canvasContext()
    if (!geometry) return
    const canvas = geometry.canvas
    const scale = canvasScaleOf(canvas)
    const scaleX = scale ? scale.scaleX : 1
    const scaleY = scale ? scale.scaleY : 1
    const cursorScale = Math.min(scaleX, scaleY)
    // 键盘光标从上次位置继续，首次按方向键时先落在画布中心。
    const current = keyboardCursorRef.current || { x: canvas.width / 2, y: canvas.height / 2 }
    const point = { x: current.x, y: current.y }
    if (key === 'ArrowLeft') point.x -= MASK_KEY_STEP
    else if (key === 'ArrowRight') point.x += MASK_KEY_STEP
    else if (key === 'ArrowUp') point.y -= MASK_KEY_STEP
    else if (key === 'ArrowDown') point.y += MASK_KEY_STEP
    else if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
      paintDot(geometry.ctx, point.x, point.y, brush.eraser)
      keyboardCursorRef.current = { x: point.x, y: point.y }
      placeMaskCursor(point.x * scaleX, point.y * scaleY, cursorScale)
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      commitMask()
      return
    } else {
      return
    }
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    point.x = Math.min(canvas.width, Math.max(0, point.x))
    point.y = Math.min(canvas.height, Math.max(0, point.y))
    keyboardCursorRef.current = { x: point.x, y: point.y }
    placeMaskCursor(point.x * scaleX, point.y * scaleY, cursorScale)
  }

  /** 清空蒙版：画布归零并清掉草稿里已保存的蒙版（回到整图请求）。 */
  function clearMaskCanvas() {
    const geometry = canvasContext()
    setInkCoverage(0)
    setMaskNotice('')
    if (geometry) geometry.ctx.clearRect(0, 0, geometry.canvas.width, geometry.canvas.height)
    if (restoreRef.current) {
      restoreRef.current = null
      if (typeof onMaskClear === 'function') onMaskClear()
    }
  }

  /** 反选区域：像素级黑白互换（涂抹层是透明底白字，互换即透明 ↔ 白色）。 */
  function invertMaskCanvas() {
    const geometry = canvasContext()
    if (!geometry) return
    const { canvas, ctx } = geometry
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = pixels.data
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0) {
        data[index + 3] = 0
      } else {
        data[index] = 255
        data[index + 1] = 255
        data[index + 2] = 255
        data[index + 3] = 255
      }
    }
    ctx.putImageData(pixels, 0, 0)
    // 像素互补后覆盖率精确等于 1 - 原覆盖率，不必再扫一遍整张画布。
    setMaskNotice('')
    commitMask(inkCoverage > 0 ? 1 - inkCoverage : 1)
  }

  /** 底图真实加载完成后补充画布比例：旧记录没有宽高时靠 naturalWidth / naturalHeight。 */
  function onTargetLoad(event) {
    const imageElement = event && event.target ? event.target : null
    const width = Number(imageElement && imageElement.naturalWidth)
    const height = Number(imageElement && imageElement.naturalHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    setNaturalSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  // 换底图 / 画布尺寸变化：重建画布并把草稿里已有的蒙版还原上去。
  // 依赖里带底图路径：重新绑定另一张作品时即使画布尺寸相同也要重建。
  const targetKey = target ? `${target.path}|${target.width || ''}x${target.height || ''}` : ''
  const maskLayoutKey = `${targetKey}|${canvasSize.width}x${canvasSize.height}`
  React.useEffect(() => {
    setInkCoverage(maskStateOf({ coverage: restoreRef.current ? restoreRef.current.coverage : 0 }).coverage)
    const canvas = canvasRef.current
    if (!canvas || typeof canvas.getContext !== 'function') return undefined
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const stored = restoreRef.current
    if (!stored || !stored.data || typeof Image !== 'function' || typeof document === 'undefined') return undefined
    let cancelled = false
    const maskImage = new Image()
    maskImage.onload = () => {
      if (cancelled) return
      restoreStoredMask(ctx, canvas, maskImage)
      setInkCoverage(maskStateOf({ coverage: stored.coverage }).coverage)
    }
    maskImage.onerror = () => {
      if (!cancelled) setInkCoverage(emptyMaskState().coverage)
    }
    maskImage.src = `data:image/png;base64,${stored.data}`
    return () => {
      cancelled = true
      maskImage.onload = null
      maskImage.onerror = null
    }
  }, [maskLayoutKey])

  if (!canPaint) return null

  const editorAspect = naturalSize.width > 0 && naturalSize.height > 0
    ? `${naturalSize.width} / ${naturalSize.height}`
    : '1'
  // CSS 宽度公式用的比例数字：与内联 aspect-ratio 配合，竖图 / 矮窗口下整体缩放而不压扁。
  const maskRatio = naturalSize.width > 0 && naturalSize.height > 0
    ? naturalSize.width / naturalSize.height
    : 1
  const maskPercent = percentOf(inkCoverage)
  // 少步快速模型（4~8 步蒸馏）局部重绘的改动幅度有限：给一条换多步模型的弱提示。
  const fastModel = Number(activePreset && activePreset.steps) <= 8
  const promptPlaceholder = target.prompt || t('studio.imageTool.promptPlaceholder')

  return (
    <div className="ofs-mask-editor">
      <div className="ofs-mask-head">
        <span className="ofs-mask-title">{t('studio.mask.title')}</span>
        <span className="ofs-mask-coverage ofs-muted">{formatText(t('studio.mask.coverage'), { percent: maskPercent })}</span>
      </div>

      <div
        className="ofs-mask-stage"
        style={{ '--ofs-mask-r': String(maskRatio), aspectRatio: editorAspect }}
      >
        {target.url ? (
          <img
            src={target.url}
            alt={target.prompt || referenceFileName(target.path) || t('studio.image.alt')}
            draggable={false}
            onLoad={onTargetLoad}
            className="ofs-mask-photo"
          />
        ) : null}
        <canvas
          ref={canvasRef}
          className="ofs-mask-canvas"
          role="application"
          tabIndex={0}
          aria-label={t('studio.mask.canvasLabel')}
          onPointerDown={onMaskPointerDown}
          onPointerMove={onMaskPointerMove}
          onPointerUp={onMaskPointerUp}
          onPointerCancel={onMaskPointerUp}
          onPointerLeave={hideMaskCursor}
          onKeyDown={onMaskKeyDown}
          onBlur={hideMaskCursor}
        />
        <span
          ref={cursorRef}
          className="ofs-mask-cursor"
          aria-hidden="true"
          style={{ left: 0, top: 0, width: 0, height: 0 }}
        />
      </div>

      <div className="ofs-mask-tools">
        <label className="ofs-mask-brush">
          <span>{t('studio.mask.brush')}</span>
          <input
            type="range"
            className="ofs-mask-range"
            min={MASK_BRUSH.min}
            max={MASK_BRUSH.max}
            step={MASK_BRUSH.step}
            value={brush.size}
            aria-label={t('studio.mask.brush')}
            onChange={(event) => setBrush((prev) => brushStateOf({ ...prev, size: clampBrushSize(event.target.value) }))}
          />
          <b>{brush.size}</b>
        </label>
        <button
          type="button"
          className={brush.eraser ? 'ofs-dock-button is-on' : 'ofs-dock-button'}
          style={MASK_HIT_STYLE}
          aria-pressed={brush.eraser}
          onClick={() => setBrush((prev) => toggleEraser(prev))}
        >
          {t('studio.mask.eraser')}
        </button>
        <button type="button" className="ofs-dock-button" style={MASK_HIT_STYLE} onClick={clearMaskCanvas}>
          {t('studio.mask.clear')}
        </button>
        <button type="button" className="ofs-dock-button" style={MASK_HIT_STYLE} onClick={invertMaskCanvas}>
          {t('studio.mask.invert')}
        </button>
        <button type="button" className="ofs-dock-button ofs-mask-close" style={MASK_HIT_STYLE} onClick={onExit}>
          {t('studio.mask.close')}
        </button>
      </div>

      {maskNotice ? <p className="ofs-hint ofs-mask-warn" role="status">{maskNotice}</p> : null}
      <p className="ofs-hint ofs-mask-hint">{t('studio.mask.hint')}</p>
      <p className="ofs-hint ofs-mask-guide">{t('studio.mask.guide')}</p>
      {fastModel ? <p className="ofs-hint ofs-mask-fast">{t('studio.mask.fastModelHint')}</p> : null}

      <ToolSubmitBar
        t={t}
        tool={tool}
        presets={list}
        presetId={presetId}
        onPresetChange={onPresetChange}
        prompt={prompt}
        onPromptChange={onPromptChange}
        promptPlaceholder={promptPlaceholder}
        strength={strength}
        strengthMax={strengthMax}
        onStrengthChange={onStrengthChange}
        maskCoverage={inkCoverage}
        submitting={submitting}
        canSubmit={canSubmit}
        blockedKey={blockedKey}
        onSubmit={onSubmit}
        onExit={onExit}
      />
    </div>
  )
}
