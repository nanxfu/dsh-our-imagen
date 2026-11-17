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

import { formatText, percentOf } from '../../logic/format.js'
import { referenceFileName } from '../../logic/reference.js'
import {
  MASK_BRUSH,
  MASK_CANVAS_EDGE,
  MASK_KEY_STEP,
  MASK_UNDO_LIMIT,
  MASK_ZOOM,
  brushStateOf,
  clampBrushSize,
  clampPan,
  clampZoom,
  emptyMaskState,
  maskCanvasSizeOf,
  maskCoverageOf,
  maskExportVerdict,
  maskStateOf,
  stepBrushSize,
  toggleEraser,
  zoomAtPoint,
} from '../../logic/mask.js'

/** 蒙版工具栏的触控热区：移动端最小 44px，键盘 Tab 顺序沿用原生按钮。 */
const MASK_HIT_STYLE = { minHeight: 44, minWidth: 44 }

/** 文本输入框聚焦时不触发单字母 / Space / Ctrl+Z 等画布快捷键。 */
function isTextInputTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true
  const tag = String(target.tagName || '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = String(target.type || 'text').toLowerCase()
    return type !== 'range' && type !== 'button' && type !== 'checkbox' && type !== 'radio'
  }
  return false
}

/** 涂抹覆盖率 → 界面百分比读数：与提交栏 / 扩图共用 `logic/format.js` 的同一口径。 */

/**
 * 画布编辑器。
 *
 * props 见 `.tmp/plan/INTERFACES.md` §2.5；画布本身不消费时间读数，
 * 因此不接收 `now`（阶段十五 Phase C0 起 1Hz 计时只在流水线与作品条内部）。
 */
export function MaskEditor(props) {
  const {
    t,
    target,
    tool,
    presets,
    presetId,
    mask,
    coverage,
    onMaskApply,
    onMaskClear,
    onStash,
    onExit,
  } = props
  // 「暂存涂抹」与 Esc 保留蒙版收起编辑态；未注入 onStash 时兼容旧调用方回落 onExit。
  const handleStash = typeof onStash === 'function' ? onStash : onExit
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
  const [view, setView] = React.useState(() => ({ zoom: MASK_ZOOM.default, pan: { x: 0, y: 0 } }))
  const [spaceHeld, setSpaceHeld] = React.useState(false)
  const [panning, setPanning] = React.useState(false)
  const [undoDepth, setUndoDepth] = React.useState(0)
  // 本地覆盖率读数：每一笔结束立即更新，不等上层状态回流，涂抹时读数不滞后。
  const [inkCoverage, setInkCoverage] = React.useState(() => maskStateOf({ coverage: mask ? mask.coverage : 0 }).coverage)
  // 蒙版体积超限等可见提示（画布内容保留，只提示用户减少涂抹面积）。
  const [maskNotice, setMaskNotice] = React.useState('')
  const editorRef = React.useRef(null)
  const viewportRef = React.useRef(null)
  const stageRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const cursorRef = React.useRef(null)
  // 正在绘制的一笔：{ x, y } 是上一个画布坐标点；null 表示没有按住。
  const drawingRef = React.useRef(null)
  // 平移状态：{ startX, startY, origPan }；与绘制状态互斥。
  const panningRef = React.useRef(null)
  // 最近一次悬停/落笔的画布像素坐标：快捷键调整画笔粗细时同步刷新光标圈大小。
  const lastCursorPointRef = React.useRef(null)
  // 键盘涂抹的光标位置：与指针绘制分开，避免空格平移或移鼠标时误连笔。
  const keyboardCursorRef = React.useRef(null)
  const viewRef = React.useRef(view)
  viewRef.current = view
  const brushRef = React.useRef(brush)
  brushRef.current = brush
  const spaceHeldRef = React.useRef(spaceHeld)
  spaceHeldRef.current = spaceHeld
  // 撤销快照栈：存放 ImageData（或兼容替身），最多 MASK_UNDO_LIMIT 条。
  const undoStackRef = React.useRef([])
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
        restoreRef.current = null
        if (typeof onMaskClear === 'function') onMaskClear()
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

  /**
   * 画布上的涂抹光标圈：直接用画布内部百分比位置 + 未缩放基准直径。
   * 光标位于 .ofs-mask-stage 内部，画面 zoom 放大时浏览器会自动随父级一起等比放大，
   * 不必反复除以 zoom，任何倍率下都能与笔迹直径严丝合缝。
   */
  function placeMaskCursor(point, sizeOverride) {
    const cursor = cursorRef.current
    const canvas = canvasRef.current
    if (!cursor || !cursor.style || !canvas || !(canvas.width > 0) || !(canvas.height > 0)) return
    lastCursorPointRef.current = { x: point.x, y: point.y }
    const stageEl = stageRef.current
    const baseWidth = stageEl && Number(stageEl.clientWidth) > 0
      ? stageEl.clientWidth
      : ((canvasScaleOf(canvas)?.rect.width || canvas.width) / (viewRef.current.zoom || 1))
    const size = Math.max(2, (sizeOverride ?? brushRef.current.size) * (baseWidth / canvas.width))
    cursor.style.display = 'block'
    cursor.style.width = `${size}px`
    cursor.style.height = `${size}px`
    cursor.style.left = `${(point.x / canvas.width) * 100}%`
    cursor.style.top = `${(point.y / canvas.height) * 100}%`
  }

  function hideMaskCursor() {
    lastCursorPointRef.current = null
    const cursor = cursorRef.current
    if (cursor && cursor.style) cursor.style.display = 'none'
  }

  /** 把当前画布像素压入撤销栈（每次落笔、清空、反选前调用）。 */
  function pushUndoSnapshot() {
    const geometry = canvasContext()
    if (!geometry) return
    const { canvas, ctx } = geometry
    if (typeof ctx.getImageData !== 'function') return
    try {
      const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const stack = undoStackRef.current
      stack.push(snap)
      if (stack.length > MASK_UNDO_LIMIT) stack.shift()
      setUndoDepth(stack.length)
    } catch {
      // 忽略异常画布读取
    }
  }

  /** 撤销最后一笔（Ctrl+Z 或点击工具栏撤销按钮）。 */
  function undoMask() {
    const geometry = canvasContext()
    if (!geometry) return false
    const { ctx } = geometry
    const stack = undoStackRef.current
    if (stack.length === 0 || typeof ctx.putImageData !== 'function') return false
    const previous = stack.pop()
    setUndoDepth(stack.length)
    ctx.putImageData(previous, 0, 0)
    setMaskNotice('')
    commitMask()
    return true
  }

  /** 读取视口与画布基准尺寸，供缩放居中与平移钳制使用。 */
  function viewBounds() {
    const stageEl = stageRef.current
    const viewportEl = viewportRef.current
    return {
      stageWidth: stageEl && Number(stageEl.clientWidth) > 0 ? stageEl.clientWidth : 0,
      stageHeight: stageEl && Number(stageEl.clientHeight) > 0 ? stageEl.clientHeight : 0,
      viewWidth: viewportEl && Number(viewportEl.clientWidth) > 0 ? viewportEl.clientWidth : 0,
      viewHeight: viewportEl && Number(viewportEl.clientHeight) > 0 ? viewportEl.clientHeight : 0,
    }
  }

  /** 以视口中指定屏幕坐标为中心缩放到目标倍率。 */
  function applyZoomAt(nextZoom, clientX, clientY) {
    const viewportEl = viewportRef.current
    const bounds = viewBounds()
    let anchor = { x: 0, y: 0 }
    if (viewportEl && typeof viewportEl.getBoundingClientRect === 'function' && Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const vRect = viewportEl.getBoundingClientRect()
      anchor = {
        x: clientX - (vRect.left + vRect.width / 2),
        y: clientY - (vRect.top + vRect.height / 2),
      }
    }
    const next = zoomAtPoint({
      zoom: viewRef.current.zoom,
      pan: viewRef.current.pan,
      anchor,
      nextZoom,
      bounds,
    })
    setView(next)
  }

  function resetView() {
    setView({ zoom: MASK_ZOOM.default, pan: { x: 0, y: 0 } })
  }

  function stepBrush(direction) {
    setBrush((prev) => {
      const nextSize = stepBrushSize(prev.size, direction)
      if (nextSize === prev.size) return prev
      if (lastCursorPointRef.current) placeMaskCursor(lastCursorPointRef.current, nextSize)
      return { ...prev, size: nextSize }
    })
  }

  /** 鼠标 / 触控：支持 Space+左键 或 中键拖动画布平移，其余左键/触控正常落笔。 */
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
    const isMiddle = event && event.button === 1
    if (isMiddle || spaceHeldRef.current) {
      hideMaskCursor()
      panningRef.current = {
        startX: Number(event && event.clientX) || 0,
        startY: Number(event && event.clientY) || 0,
        origPan: { ...viewRef.current.pan },
      }
      setPanning(true)
      return
    }
    const point = canvasPointOf(event)
    if (!point) return
    pushUndoSnapshot()
    paintDot(geometry.ctx, point.x, point.y, brush.eraser)
    drawingRef.current = { x: point.x, y: point.y }
    keyboardCursorRef.current = { x: point.x, y: point.y }
    placeMaskCursor(point)
  }

  function onMaskPointerMove(event) {
    if (panningRef.current) {
      const dx = (Number(event && event.clientX) || 0) - panningRef.current.startX
      const dy = (Number(event && event.clientY) || 0) - panningRef.current.startY
      const nextPan = clampPan(
        { x: panningRef.current.origPan.x + dx, y: panningRef.current.origPan.y + dy },
        { ...viewBounds(), zoom: viewRef.current.zoom },
      )
      setView((prev) => ({ ...prev, pan: nextPan }))
      return
    }
    const geometry = canvasContext()
    if (!geometry) return
    const point = canvasPointOf(event)
    if (!point) return
    if (spaceHeldRef.current) {
      hideMaskCursor()
      return
    }
    placeMaskCursor(point)
    const previous = drawingRef.current
    if (!previous) return
    paintLine(geometry.ctx, previous, point, brush.eraser)
    drawingRef.current = { x: point.x, y: point.y }
  }

  function onMaskPointerUp(event) {
    const wasPanning = Boolean(panningRef.current)
    const wasDrawing = Boolean(drawingRef.current)
    panningRef.current = null
    drawingRef.current = null
    if (wasPanning) setPanning(false)
    if (event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // 指针已经释放时忽略。
      }
    }
    if (wasDrawing) commitMask()
  }

  /** 键盘涂抹：方向键移动画笔、回车键落笔、Esc 退出编辑态，触控板与纯键盘都能用。 */
  function onMaskKeyDown(event) {
    const key = event && event.key
    if (key === 'Escape') {
      if (typeof onExit === 'function') onExit()
      return
    }
    const geometry = canvasContext()
    if (!geometry) return
    const canvas = geometry.canvas
    // 键盘光标从上次位置继续，首次按方向键时先落在画布中心。
    const current = keyboardCursorRef.current || { x: canvas.width / 2, y: canvas.height / 2 }
    const point = { x: current.x, y: current.y }
    if (key === 'ArrowLeft') point.x -= MASK_KEY_STEP
    else if (key === 'ArrowRight') point.x += MASK_KEY_STEP
    else if (key === 'ArrowUp') point.y -= MASK_KEY_STEP
    else if (key === 'ArrowDown') point.y += MASK_KEY_STEP
    else if (key === 'Enter') {
      pushUndoSnapshot()
      paintDot(geometry.ctx, point.x, point.y, brush.eraser)
      keyboardCursorRef.current = { x: point.x, y: point.y }
      placeMaskCursor(point)
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
    placeMaskCursor(point)
  }

  /** 清空蒙版：画布归零并清掉草稿里已保存的蒙版（回到整图请求）。 */
  function clearMaskCanvas() {
    const geometry = canvasContext()
    pushUndoSnapshot()
    setInkCoverage(0)
    setMaskNotice('')
    if (geometry) geometry.ctx.clearRect(0, 0, geometry.canvas.width, geometry.canvas.height)
    restoreRef.current = null
    if (typeof onMaskClear === 'function') onMaskClear()
  }

  /** 反选区域：像素级黑白互换（涂抹层是透明底白字，互换即透明 ↔ 白色）。 */
  function invertMaskCanvas() {
    const geometry = canvasContext()
    if (!geometry) return
    const { canvas, ctx } = geometry
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return
    pushUndoSnapshot()
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

  // 换底图 / 画布尺寸变化：重建画布、重置视图与撤销栈，并把草稿里已有的蒙版还原上去。
  // 依赖里带底图路径：重新绑定另一张作品时即使画布尺寸相同也要重建。
  const targetKey = target ? `${target.path}|${target.width || ''}x${target.height || ''}` : ''
  const maskLayoutKey = `${targetKey}|${canvasSize.width}x${canvasSize.height}`
  React.useEffect(() => {
    setView({ zoom: MASK_ZOOM.default, pan: { x: 0, y: 0 } })
    undoStackRef.current = []
    setUndoDepth(0)
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

  // 非被动滚轮事件：画布区域直接滚轮 / 捏合缩放，Shift + 滚轮调整画笔大小。
  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof viewport.addEventListener !== 'function') return undefined
    const onWheel = (event) => {
      if (!event) return
      if (typeof event.preventDefault === 'function') event.preventDefault()
      const deltaY = Number(event.deltaY) || 0
      if (deltaY === 0) return
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        stepBrush(deltaY < 0 ? 1 : -1)
        return
      }
      const step = event.ctrlKey
        ? -deltaY * 0.01
        : (deltaY < 0 ? MASK_ZOOM.step : -MASK_ZOOM.step)
      applyZoomAt(viewRef.current.zoom + step, Number(event.clientX), Number(event.clientY))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      if (typeof viewport.removeEventListener === 'function') viewport.removeEventListener('wheel', onWheel)
    }
  }, [canPaint])

  // 全局画布快捷键：非文本输入焦点下支持 Space 平移、E/B 切橡皮擦、[ / ] 调画笔、
  // Ctrl+Z 撤销、0 复位视图与 Esc 退出；窗口失焦时复位 Space 抓手态防止卡死。
  React.useEffect(() => {
    if (!canPaint) return undefined
    const doc = typeof document === 'undefined' ? null : document
    const win = typeof window === 'undefined' ? null : window
    if (!doc || typeof doc.addEventListener !== 'function') return undefined

    const onKeyDown = (event) => {
      if (!event) return
      const key = event.key
      if (key === 'Escape') {
        if (typeof handleStash === 'function') handleStash()
        return
      }
      if (isTextInputTarget(event.target)) return
      const hasMod = Boolean(event.ctrlKey || event.metaKey)
      if (hasMod && String(key).toLowerCase() === 'z' && !event.shiftKey) {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        undoMask()
        return
      }
      if (hasMod && (key === '=' || key === '+' || key === '-')) {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        const delta = key === '-' ? -MASK_ZOOM.step : MASK_ZOOM.step
        applyZoomAt(clampZoom(viewRef.current.zoom + delta))
        return
      }
      if (key === '0') {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        resetView()
        return
      }
      if (hasMod || event.altKey) return
      if (key === ' ' || key === 'Spacebar') {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true
          setSpaceHeld(true)
          hideMaskCursor()
        }
        return
      }
      const lower = String(key).toLowerCase()
      if (lower === 'e') {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        setBrush((prev) => toggleEraser(prev))
      } else if (lower === 'b') {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        setBrush((prev) => (prev.eraser ? { ...prev, eraser: false } : prev))
      } else if (key === '[') {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        stepBrush(-1)
      } else if (key === ']') {
        if (typeof event.preventDefault === 'function') event.preventDefault()
        stepBrush(1)
      }
    }

    const onKeyUp = (event) => {
      if (!event || (event.key !== ' ' && event.key !== 'Spacebar')) return
      spaceHeldRef.current = false
      setSpaceHeld(false)
    }

    const onBlur = () => {
      spaceHeldRef.current = false
      setSpaceHeld(false)
      panningRef.current = null
      setPanning(false)
    }

    doc.addEventListener('keydown', onKeyDown)
    doc.addEventListener('keyup', onKeyUp)
    if (win && typeof win.addEventListener === 'function') win.addEventListener('blur', onBlur)
    return () => {
      if (typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('keydown', onKeyDown)
        doc.removeEventListener('keyup', onKeyUp)
      }
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('blur', onBlur)
    }
  }, [canPaint])

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
  const zoomed = view.zoom > MASK_ZOOM.min
  const stageTransform = zoomed || view.pan.x !== 0 || view.pan.y !== 0
    ? `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`
    : undefined
  const stageClass = [
    'ofs-mask-stage',
    spaceHeld ? 'is-panning' : '',
    panning ? 'is-panning-active' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="ofs-mask-editor" ref={editorRef}>
      <div className="ofs-mask-head">
        <span className="ofs-mask-title">{t('studio.mask.title')}</span>
        <span className="ofs-mask-coverage ofs-muted">{formatText(t('studio.mask.coverage'), { percent: maskPercent })}</span>
        {zoomed ? (
          <button
            type="button"
            className="ofs-mask-zoom"
            title={t('studio.mask.resetView')}
            onClick={resetView}
          >
            {`${view.zoom.toFixed(1)}×`}
          </button>
        ) : null}
      </div>

      <div className={fastModel ? 'ofs-mask-help is-warn' : 'ofs-mask-help'}>
        <button
          type="button"
          className="ofs-glass-btn ofs-mask-help-btn"
          aria-label={t('studio.mask.hint')}
          title={t('studio.mask.guide')}
        >
          ?
        </button>
        <div className="ofs-mask-tips" role="tooltip">
          <p className="ofs-hint ofs-mask-hint">{t('studio.mask.hint')}</p>
          <p className="ofs-hint ofs-mask-guide">{t('studio.mask.guide')}</p>
          {fastModel ? <p className="ofs-hint ofs-mask-fast">{t('studio.mask.fastModelHint')}</p> : null}
          <div className="ofs-mask-shortcuts">
            <span className="ofs-mask-shortcuts-title">{t('studio.mask.shortcutsTitle')}</span>
            <ul className="ofs-mask-shortcuts-list">
              <li>{t('studio.mask.shortcuts.zoom')}</li>
              <li>{t('studio.mask.shortcuts.pan')}</li>
              <li>{t('studio.mask.shortcuts.brush')}</li>
              <li>{t('studio.mask.shortcuts.eraser')}</li>
              <li>{t('studio.mask.shortcuts.undo')}</li>
              <li>{t('studio.mask.shortcuts.reset')}</li>
            </ul>
          </div>
        </div>
      </div>

      <div
        className="ofs-mask-viewport"
        ref={viewportRef}
        onDoubleClick={() => {
          if (viewRef.current.zoom > MASK_ZOOM.min) resetView()
        }}
      >
        <div
          ref={stageRef}
          className={stageClass}
          style={{
            '--ofs-mask-r': String(maskRatio),
            aspectRatio: editorAspect,
            ...(stageTransform ? { transform: stageTransform } : {}),
          }}
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
          className="ofs-dock-button"
          style={MASK_HIT_STYLE}
          disabled={undoDepth === 0}
          title={t('studio.mask.shortcuts.undo')}
          onClick={undoMask}
        >
          {t('studio.mask.undo')}
        </button>
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
        <button type="button" className="ofs-dock-button ofs-mask-close" style={MASK_HIT_STYLE} onClick={handleStash}>
          {t('studio.mask.close')}
        </button>
      </div>

      {maskNotice ? <p className="ofs-hint ofs-mask-warn" role="status">{maskNotice}</p> : null}
    </div>
  )
}
