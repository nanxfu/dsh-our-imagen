/**
 * 悬浮提示的定位计算。
 *
 * 弹层用 `position: fixed`，但它真正的包含块是带 `backdrop-filter` 的外壳（`.ofs-app`），
 * 不是视口。因此这里把所有坐标换算成「相对外壳左上角」，并只在外壳范围内夹紧，
 * 避免靠左字段的提示被裁掉。
 */

const GAP = 8
const PAD = 8

/**
 * @param {object} input
 * @param {{left:number, top:number, bottom:number, width:number}} input.anchor 触发点的视口矩形
 * @param {{left:number, top:number, width:number, height:number}|null} [input.frame] 包含块的视口矩形
 * @param {number} input.width 期望的最大宽度
 * @param {boolean} [input.preferBelow] 强制向下展开
 * @returns {{left:number, top:number, below:boolean, maxWidth:number}}
 */
export function tooltipPlacement(input) {
  const anchor = input.anchor || { left: 0, top: 0, bottom: 0, width: 0 }
  const frame = input.frame || null
  const frameLeft = frame ? Number(frame.left) || 0 : 0
  const frameTop = frame ? Number(frame.top) || 0 : 0
  const frameWidth = frame && Number(frame.width) > 0 ? Number(frame.width) : 0
  const requested = Number(input.width) > 0 ? Number(input.width) : 240

  const maxWidth = frameWidth > 0 ? Math.min(requested, Math.max(120, frameWidth - PAD * 2)) : requested
  const anchorLeft = (Number(anchor.left) || 0) - frameLeft
  const anchorTop = (Number(anchor.top) || 0) - frameTop
  const anchorBottom = (Number(anchor.bottom) || 0) - frameTop
  const anchorWidth = Number(anchor.width) || 0

  const centered = anchorLeft + anchorWidth / 2 - maxWidth / 2
  const left = frameWidth > 0
    ? Math.max(PAD, Math.min(centered, frameWidth - maxWidth - PAD))
    : centered

  // 顶部空间不足时翻到下方，避免弹出层跑到窗口外。
  const below = input.preferBelow === true || anchorTop < 140
  return {
    left,
    top: below ? anchorBottom + GAP : anchorTop - GAP,
    below,
    maxWidth,
  }
}