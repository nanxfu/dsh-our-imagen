/** 画面预览：光桌上的相纸。大图居中，图下一条题注与一条动作行。 */

import React from 'react'

import { INSPIRE_KEYS } from '../constants.js'
import { Icon } from './icons.jsx'
import { formatText, formatSeconds } from '../logic/format.js'
import { referenceFileName } from '../logic/generate.js'
import {
  MASK_BRUSH,
  MASK_CANVAS_EDGE,
  MASK_KEY_STEP,
  brushStateOf,
  clampBrushSize,
  clearMaskState,
  emptyMaskState,
  invertMaskState,
  maskCanvasSizeOf,
  maskCoverageOf,
  maskExportVerdict,
  maskStateOf,
  toggleEraser,
} from '../logic/mask.js'
import { jobCountText } from '../logic/status.js'
import { useFocusTrap } from './hooks/useFocusTrap.js'

/** 出图后一分钟内才算「刚落定」，超过就当历史作品直接陈列。 */
const FRESH_MS = 60_000

/** 蒙版工具栏的触控热区：移动端最小 44px，键盘 Tab 顺序沿用原生按钮。 */
const MASK_HIT_STYLE = { minHeight: 44, minWidth: 44 }

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

/** 接收 { t, ui, compute, form, library, actions } 领域对象。 */
export function Stage(props) {
  const { t, ui, compute, form, library, actions, now } = props
  const { zoom, setZoom, copyPath } = ui
  const { activeJob } = compute
  // 舞台胶囊只保留「还在动 + 第 N/M 张」：阶段名与已等待由顶部生图流水线负责，不重复说两遍。
  const progressText = activeJob ? jobCountText(t, activeJob) : ''
  const { useInspiration } = form
  const { selected, isFavorite, toggleFavorite } = library
  const { iterate, reroll, referenceImage } = actions
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

  // ── 局部重绘（Inpaint）：参考图上的涂抹蒙版 ─────────────────────
  //
  // 蒙版状态由表单域承载（`reference.mask`）；这里只负责画布交互与 PNG 导出。
  // 参考图存在且当前模型支持 Inpaint 时，「以此图重绘」预览态出现「局部涂抹」开关。
  const reference = (form && form.reference) || null
  const inpaintSupported = Boolean(form && form.inpaintSupported === true)
  const mask = (form && form.mask) || null
  const applyMaskAction = form && typeof form.applyMask === 'function' ? form.applyMask : null
  const clearMaskAction = form && typeof form.clearMask === 'function' ? form.clearMask : null
  const canPaint = Boolean(reference && inpaintSupported && applyMaskAction)
  const showToast = ui && typeof ui.showToast === 'function' ? ui.showToast : null

  const referenceWidth = Number(reference && reference.width)
  const referenceHeight = Number(reference && reference.height)
  // 画布尺寸按参考图宽高比换算（远端会按最近邻对齐到参考图精确宽高，同比例才不会错位）。
  const [naturalSize, setNaturalSize] = React.useState(() => ({
    width: Number.isFinite(referenceWidth) && referenceWidth > 0 ? Math.round(referenceWidth) : 0,
    height: Number.isFinite(referenceHeight) && referenceHeight > 0 ? Math.round(referenceHeight) : 0,
  }))
  const canvasSize = maskCanvasSizeOf(naturalSize.width, naturalSize.height, MASK_CANVAS_EDGE)
  const [painting, setPainting] = React.useState(false)
  const [brush, setBrush] = React.useState(() => brushStateOf())
  const [maskState, setMaskState] = React.useState(() => maskStateOf({ coverage: mask ? mask.coverage : 0 }))
  const canvasRef = React.useRef(null)
  const cursorRef = React.useRef(null)
  // 正在绘制的一笔：{ x, y } 是上一个画布坐标点；null 表示没有按住。
  const drawingRef = React.useRef(null)
  // 键盘涂抹的光标位置：与指针绘制分开，避免空格落笔后移动鼠标误连出一笔。
  const keyboardCursorRef = React.useRef(null)
  // 打开涂抹态时要还原的蒙版：只在进入画布的 effect 里读，避免每次渲染都重绘。
  const restoreRef = React.useRef(mask)
  restoreRef.current = mask
  const referenceIdentity = reference
    ? `${reference.path || ''}|${reference.url || ''}|${referenceWidth || ''}|${referenceHeight || ''}`
    : ''
  // 组合层的「进入涂抹」请求计数：大于 0 时由 Stage 消费一次并打开画布。
  const paintRequest = ui && Number.isFinite(Number(ui.paintRequest)) ? Number(ui.paintRequest) : 0
  const clearPaintRequest = ui && typeof ui.clearPaintRequest === 'function' ? ui.clearPaintRequest : null
  // 选中作品标识：涂抹中切换胶卷作品要退出涂抹态，让预览跟随选中作品。
  const selectedIdentity = selected && selected.image
    ? `${selected.image.path || ''}|${selected.image.file || ''}|${selected.image.url || ''}`
    : ''
  const selectedIdentityRef = React.useRef(selectedIdentity)

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
   * 画布 → 黑底白字 PNG base64，并写入表单的 `reference.mask`。
   *
   * 空蒙版（未涂抹 / 全擦掉）不生成字段，并清掉表单里上一笔的蒙版；
   * 体积超限时保留画布内容、只给提示，让用户减少涂抹面积。
   */
  function commitMask(coverageOverride) {
    const geometry = canvasContext()
    if (!geometry) return
    const { canvas, ctx } = geometry
    const coverage = Number.isFinite(Number(coverageOverride))
      ? maskStateOf({ coverage: coverageOverride }).coverage
      : coverageOfCanvas(canvas, ctx)
    setMaskState(maskStateOf({ coverage }))
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
        if (restoreRef.current && clearMaskAction) {
          restoreRef.current = null
          clearMaskAction()
        }
        return
      }
      if (verdict.reason === 'too_large' && showToast) showToast(t('studio.mask.tooLarge'))
      return
    }
    const result = applyMaskAction ? applyMaskAction({ data: verdict.data, coverage: verdict.coverage }) : null
    if (result && result.ok === false && result.reason === 'too_large' && showToast) {
      showToast(t('studio.mask.tooLarge'))
    }
  }

  /** 打开涂抹态：画布尺寸与已有蒙版由上面的 effect 还原。 */
  function openMaskEditor() {
    if (!canPaint) return
    // 进入涂抹模式时把还没调过的重绘强度抬到局部重绘默认档（真机验收：0.6 改动过弱）。
    if (typeof form.beginMaskEdit === 'function') form.beginMaskEdit()
    setPainting(true)
  }

  /** 完成涂抹：蒙版在每一笔结束时已经写进表单，这里只收起画布。 */
  function closeMaskEditor() {
    setPainting(false)
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

  /** 键盘涂抹：方向键移动画笔、空格 / 回车落笔、Esc 完成，触控板与纯键盘都能用。 */
  function onMaskKeyDown(event) {
    const key = event && event.key
    if (key === 'Escape') {
      closeMaskEditor()
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

  /** 清空蒙版：画布归零并清掉表单里已保存的蒙版（回到整图重绘）。 */
  function clearMaskCanvas() {
    const geometry = canvasContext()
    setMaskState(clearMaskState())
    if (geometry) geometry.ctx.clearRect(0, 0, geometry.canvas.width, geometry.canvas.height)
    if (restoreRef.current) {
      restoreRef.current = null
      if (clearMaskAction) clearMaskAction()
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
    commitMask(invertMaskState(maskState).coverage)
  }

  /** 参考图真实加载完成后补充画布比例：旧记录没有宽高时靠 naturalWidth / naturalHeight。 */
  function onReferencePreviewLoad(event) {
    const target = event && event.target ? event.target : null
    const width = Number(target && target.naturalWidth)
    const height = Number(target && target.naturalHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    setNaturalSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  // 换参考图 / 移除参考图：收起涂抹态并重置画布读数（蒙版随 reference 一起被表单清掉）。
  // 「打开涂抹」请求也在同一个 effect 里消费：重试恢复参考图、以此结果续绘都会同时改参考图
  // 并请求涂抹，拆成两个 effect 就会隐式依赖声明顺序（先收起再打开）；合并后只有一条判定链，
  // 顺序写反也不会把刚打开的编辑器再关掉。
  const referenceChangedRef = React.useRef(referenceIdentity)
  React.useEffect(() => {
    const referenceChanged = referenceChangedRef.current !== referenceIdentity
    referenceChangedRef.current = referenceIdentity
    if (referenceChanged) {
      const width = Number(reference && reference.width)
      const height = Number(reference && reference.height)
      setNaturalSize({
        width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
        height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0,
      })
      setMaskState(maskStateOf({ coverage: mask ? mask.coverage : 0 }))
    }
    // 组合层请求进入涂抹态（专用模型「以此图重绘」、失败重试恢复参考图、以此结果续绘）：
    // 计数变化时消费一次；从画廊跨视图切回时 Stage 才挂载，effect 首次执行同样生效。
    if (paintRequest > 0 && canPaint) {
      openMaskEditor()
      if (clearPaintRequest) clearPaintRequest()
      return
    }
    if (referenceChanged) setPainting(false)
  }, [referenceIdentity, paintRequest, canPaint])

  // 能力被切走（例如手动换到不支持 Inpaint 的模型）时收起涂抹态；蒙版本身保留在表单里。
  React.useEffect(() => {
    if (!canPaint) setPainting(false)
  }, [canPaint])

  // 涂抹中切换胶卷作品：退出涂抹态，让预览跟随选中作品；已涂蒙版留在表单里，不丢。
  React.useEffect(() => {
    if (selectedIdentityRef.current === selectedIdentity) return
    selectedIdentityRef.current = selectedIdentity
    setPainting(false)
  }, [selectedIdentity])

  // 进入涂抹态 / 画布尺寸变化：重建画布并把已有蒙版还原上去。
  const maskLayoutKey = `${painting ? 1 : 0}|${canvasSize.width}x${canvasSize.height}`
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof canvas.getContext !== 'function') return undefined
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const stored = painting ? restoreRef.current : null
    if (!stored || !stored.data || typeof Image !== 'function' || typeof document === 'undefined') return undefined
    let cancelled = false
    const maskImage = new Image()
    maskImage.onload = () => {
      if (cancelled) return
      restoreStoredMask(ctx, canvas, maskImage)
      setMaskState(maskStateOf({ coverage: stored.coverage }))
    }
    maskImage.onerror = () => {
      if (!cancelled) setMaskState(emptyMaskState())
    }
    maskImage.src = `data:image/png;base64,${stored.data}`
    return () => {
      cancelled = true
      maskImage.onload = null
      maskImage.onerror = null
    }
  }, [maskLayoutKey])

  // 打开大图时 Esc 退出、Tab 在弹层内循环；打开时把焦点交给关闭按钮，关闭后还给触发按钮。
  useFocusTrap({
    active: Boolean(zoom),
    panelRef: lightboxRef,
    initialFocusRef: closeRef,
    returnFocusRef: zoomOpenerRef,
    onClose: () => setZoom(false),
  })

  // 涂抹态：预览画布里的参考图（不一定是舞台上正在陈列的那张作品，涂抹对象始终是参考图）。
  const referencePreviewUrl = reference && reference.url ? reference.url : ''
  const referenceAlt = prompt || referenceFileName(reference && reference.path) || t('studio.reference.title')
  const editorAspect = naturalSize.width > 0 && naturalSize.height > 0
    ? `${naturalSize.width} / ${naturalSize.height}`
    : '1'
  // CSS 宽度公式用的比例数字：与内联 aspect-ratio 配合，竖图 / 矮窗口下整体缩放而不压扁。
  const maskRatio = naturalSize.width > 0 && naturalSize.height > 0
    ? naturalSize.width / naturalSize.height
    : 1
  const maskPercent = percentOf(maskState.coverage)
  const paintingActive = painting && canPaint
  // 少步快速模型（4~8 步蒸馏）局部重绘的改动幅度有限：给一条换多步模型的弱提示。
  const fastModel = Number(form && form.activePreset && form.activePreset.steps) <= 8

  // 涂抹编辑器在「有选中作品」与「空舞台」两种分支复用：空舞台也能直接涂抹已有参考图。
  const maskEditor = (
    <div className="ofs-mask-editor">
      <div className="ofs-mask-head">
        <span className="ofs-mask-title">{t('studio.mask.title')}</span>
        <span className="ofs-mask-coverage ofs-muted">{formatText(t('studio.mask.coverage'), { percent: maskPercent })}</span>
      </div>

      <div
        className="ofs-mask-stage"
        style={{ '--ofs-mask-r': String(maskRatio), aspectRatio: editorAspect }}
      >
        {referencePreviewUrl ? (
          <img
            src={referencePreviewUrl}
            alt={referenceAlt}
            draggable={false}
            onLoad={onReferencePreviewLoad}
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
        <button type="button" className="ofs-dock-button ofs-mask-close" style={MASK_HIT_STYLE} onClick={closeMaskEditor}>
          {t('studio.mask.close')}
        </button>
      </div>

      <p className="ofs-hint ofs-mask-hint">
        {t('studio.mask.hint')}
      </p>
      <p className="ofs-hint ofs-mask-guide">{t('studio.mask.guide')}</p>
      {fastModel ? <p className="ofs-hint ofs-mask-fast">{t('studio.mask.fastModelHint')}</p> : null}
    </div>
  )

  // 局部涂抹入口：参考图存在且模型支持时出现；空舞台同样显示，便于先涂抹再切回。
  const paintBar = reference && inpaintSupported && !paintingActive ? (
    <div className="ofs-mask-bar">
      <button
        type="button"
        className="ofs-dock-button ofs-mask-toggle"
        style={MASK_HIT_STYLE}
        aria-pressed={false}
        onClick={openMaskEditor}
      >
        <Icon name="focus" size={15} />
        {t('studio.mask.toggle')}
      </button>
      <span className={mask ? 'ofs-hint ofs-mask-status' : 'ofs-muted ofs-mask-status'}>
        {mask ? formatText(t('studio.mask.applied'), { percent: percentOf(mask.coverage) }) : t('studio.mask.empty')}
      </span>
    </div>
  ) : null

  // 模型不支持局部重绘时保留已涂蒙版并说明，不静默丢弃。
  const unsupportedNote = reference && !inpaintSupported ? (
    <div className="ofs-mask-unsupported">
      <p className="ofs-hint ofs-mask-warn">{t('studio.mask.unsupported')}</p>
      {mask ? <p className="ofs-hint ofs-mask-warn">{t('studio.mask.kept')}</p> : null}
    </div>
  ) : null

  if (!image) {
    // 手动关闭云端后不能再说「点击生成即可出图」：生成会被宿主拒绝，先提示唤醒。
    const stopped = Boolean(compute.status && compute.status.stopped)
    // 等待出图时取景框按这次任务的尺寸画；空闲时按当前表单比例画。
    const jobParams = (activeJob && activeJob.params) || {}
    const fields = (form && form.form) || {}
    const frameRatio = ratioOf(jobParams.width || fields.width, jobParams.height || fields.height)
    // 曝光单：这台机器在这个预设上大概多久出一张，先给个准话再让人点生成。
    const preset = (compute.presets || []).find((option) => option && option.id === fields.presetId) || null
    const steady = preset && Number.isFinite(Number(preset.steadySeconds)) ? Number(preset.steadySeconds) : null
    return (
      <section className="ofs-stage">
        <div className="ofs-figure ofs-figure--empty">
          {paintingActive ? maskEditor : (
            <>
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
            </>
          )}
        </div>
        {paintBar}
        {unsupportedNote}
      </section>
    )
  }

  const favorite = isFavorite(image.path || image.file)
  // 「复制文件路径」要给绝对路径：历史条目里带 absolute，老记录退回相对路径。
  const copyTarget = image.absolute || image.path || image.file
  const imageKey = image.path || image.file || image.url
  const printRatio = ratioOf(image.width, image.height)
  // 刚落定的图才播一次显影；翻历史作品直接陈列。
  const developing = isFreshItem(item, now)
  // 续绘闭环：当前结果存在且模型支持局部重绘时，可一键设为新参考图并进入涂抹。
  const continueInpaint = actions && typeof actions.continueInpaint === 'function' ? actions.continueInpaint : null
  const canContinueInpaint = Boolean(image && inpaintSupported && continueInpaint)

  return (
    <section className="ofs-stage">
      <figure className="ofs-figure">
        {paintingActive ? maskEditor : (
          <>
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

            <div className="ofs-figure-tools">
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
          </>
        )}

        {activeJob ? (
          <div className="ofs-stage-progress" aria-hidden="true">
            <span className="ofs-shimmer" aria-hidden="true" />
            <span className="ofs-progress-label">{progressText}</span>
          </div>
        ) : null}
      </figure>

      {paintBar}
      {unsupportedNote}

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

      <div className="ofs-dock">
        {canContinueInpaint ? (
          <button type="button" className="ofs-dock-button ofs-continue-inpaint" onClick={() => continueInpaint(selected)}>
            <Icon name="image" size={15} />
            {t('studio.mask.continueFromResult')}
          </button>
        ) : null}
        <button type="button" className="ofs-dock-button" onClick={() => iterate(selected)}>
          <Icon name="focus" size={15} />
          {t('studio.action.iterate')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={() => reroll(selected)}>
          <Icon name="reroll" size={15} />
          {t('studio.action.reroll')}
        </button>
        <button type="button" className="ofs-dock-button" onClick={() => copyPath(copyTarget)}>
          <Icon name="copy" size={15} />
          {t('studio.action.copyPath')}
        </button>
      </div>

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
          {/* 大图预览里的「以此图重绘」：设为参考图后由组合层收起放大层并切回创作视图。 */}
          <button
            type="button"
            className="ofs-lightbox-action"
            onClick={(event) => {
              // 放大层本身点任意位置都会关闭，这个按钮单独处理，避免先关层再弹提示。
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
              if (typeof referenceImage === 'function') referenceImage(selected)
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
