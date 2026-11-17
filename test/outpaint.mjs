/**
 * 扩图版面计算的离线测试（纯逻辑，不需要浏览器、不需要构建）。
 *
 * 覆盖 `src/logic/outpaint.js` 的冻结接口（INTERFACES.md §4.2）：
 *   - 比例胶囊顺序与文案键；
 *   - 「四边扩 20%」的尺寸 / 居中 / 覆盖率；
 *   - 目标画幅（16:9 / 9:16 / 4:3）的单一轴留白；
 *   - maxEdge / maxPixels / minEdge 钳制与 8px 对齐；
 *   - anchor 归一、边界与留白分配；方向键平移；
 *   - 异常输入（源图非法 / 比例非法 / 比例与源相同）的失败原因。
 *
 * 运行：node test/outpaint.mjs
 */

import assert from 'node:assert/strict'

import { LIMITS, OUTPAINT } from '../shared/contract.js'
import {
  OUTPAINT_EXPAND_ID,
  OUTPAINT_RATIO_IDS,
  outpaintAnchorOf,
  outpaintAnchorShift,
  outpaintCoverageOf,
  outpaintPlanOf,
  outpaintRatioIdOf,
  outpaintRatioOptions,
} from '../src/logic/outpaint.js'
import { createCheckRunner } from './helpers/check.mjs'

const { check, summary } = createCheckRunner()

const STEP = LIMITS.width.step

/** 画布 / 内容框所有坐标都是 8 的倍数，且内容框在画布内。 */
function assertAligned(plan) {
  for (const key of ['width', 'height']) {
    assert.equal(plan[key] % STEP, 0, `${key} 应 8 对齐，实际 ${plan[key]}`)
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(plan.content[key] % STEP, 0, `content.${key} 应 8 对齐，实际 ${plan.content[key]}`)
  }
  for (const key of ['left', 'right', 'top', 'bottom']) {
    assert.equal(plan.padding[key] % STEP, 0, `padding.${key} 应 8 对齐，实际 ${plan.padding[key]}`)
    assert.ok(plan.padding[key] >= 0, `padding.${key} 不能为负`)
  }
  assert.equal(plan.content.x + plan.content.width + plan.padding.right, plan.width)
  assert.equal(plan.content.y + plan.content.height + plan.padding.bottom, plan.height)
  assert.equal(plan.padding.left, plan.content.x)
  assert.equal(plan.padding.top, plan.content.y)
}

/** 画布在契约上限内、短边不低于 minEdge。 */
function assertBounds(plan) {
  assert.ok(plan.width <= OUTPAINT.maxEdge, `画布宽 ${plan.width} 超过 maxEdge`)
  assert.ok(plan.height <= OUTPAINT.maxEdge, `画布高 ${plan.height} 超过 maxEdge`)
  assert.ok(plan.width * plan.height <= OUTPAINT.maxPixels, `画布像素 ${plan.width * plan.height} 超过 maxPixels`)
  assert.ok(plan.width >= OUTPAINT.minEdge, `画布宽 ${plan.width} 低于 minEdge`)
  assert.ok(plan.height >= OUTPAINT.minEdge, `画布高 ${plan.height} 低于 minEdge`)
}

await check('比例胶囊：顺序 = 四边扩 20% 在前、其余跟随契约，文案键齐全', () => {
  const options = outpaintRatioOptions()
  assert.deepEqual(options.map((option) => option.id), [OUTPAINT.expandId, ...OUTPAINT.ratioIds])
  for (const option of options) assert.match(option.labelKey, /^studio\.outpaint\.ratio\./)
  assert.equal(options[0].id, OUTPAINT_EXPAND_ID)
  assert.equal(options[0].id, 'source')
  assert.deepEqual([...OUTPAINT_RATIO_IDS], ['16:9', '9:16', '4:3'])
  // 未知 / 空比例 id 归一为默认快捷项。
  assert.equal(outpaintRatioIdOf('16:9'), '16:9')
  assert.equal(outpaintRatioIdOf('source'), 'source')
  assert.equal(outpaintRatioIdOf(''), 'source')
  assert.equal(outpaintRatioIdOf('nope'), 'source')
  assert.equal(outpaintRatioIdOf(null), 'source')
})

await check('四边扩 20%：画布 = 内容 × 1.2，内容居中，覆盖率约 30.9%', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: 'source' })
  assert.equal(plan.ok, true)
  assert.equal(plan.ratioId, 'source')
  assert.equal(plan.width, 1232)
  assert.equal(plan.height, 1232)
  assert.deepEqual(plan.content, { x: 104, y: 104, width: 1024, height: 1024 })
  assert.deepEqual(plan.padding, { left: 104, right: 104, top: 104, bottom: 104 })
  assert.ok(plan.coverage > 0.3 && plan.coverage < 0.32, `覆盖率应约 30.9%，实际 ${plan.coverage}`)
  assert.equal(plan.scale, 1, '源图不大时内容按原尺寸放入')
  assertAligned(plan)
  assertBounds(plan)
})

await check('四边扩 20%：非正方形保持两轴留白，内容等比不拉伸', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 768, ratioId: 'source' })
  assert.equal(plan.ok, true)
  assert.equal(plan.width, 1232)
  assert.equal(plan.height, 928)
  assert.deepEqual(plan.content, { x: 104, y: 80, width: 1024, height: 768 })
  assert.equal(plan.padding.left, plan.padding.right)
  assert.equal(plan.padding.top, plan.padding.bottom)
  assert.equal(plan.content.width / plan.content.height, 1024 / 768, '内容框保持源图比例')
  assertAligned(plan)
  assertBounds(plan)
})

await check('四边扩 20%：长边钳到 maxEdge，内容等比缩小', () => {
  // 1536×512：按 1.2 倍会到 1843 宽，必须缩到 maxEdge 以内。
  const plan = outpaintPlanOf({ sourceWidth: 1536, sourceHeight: 512, ratioId: 'source' })
  assert.equal(plan.ok, true)
  assert.equal(plan.width, OUTPAINT.maxEdge)
  assert.ok(plan.height <= OUTPAINT.maxEdge)
  assert.ok(plan.scale < 1, '超出画布上限时内容应等比缩小')
  assert.ok(Math.abs(plan.content.width / plan.content.height - 3) < 0.02, '缩小后仍保持源图 3:1 左右')
  assertAligned(plan)
  assertBounds(plan)
})

await check('四边扩 20%：总像素钳到 maxPixels', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1536, sourceHeight: 1536, ratioId: 'source' })
  assert.equal(plan.ok, true)
  assert.ok(plan.width * plan.height <= OUTPAINT.maxPixels, '画布总像素必须不超过 maxPixels')
  assert.ok(plan.width <= OUTPAINT.maxEdge && plan.height <= OUTPAINT.maxEdge)
  assert.ok(plan.content.width < 1536, '为了满足像素上限，内容会缩到源图以下')
  assertAligned(plan)
  assertBounds(plan)
})

await check('目标画幅 16:9：内容铺满高度，左右留白，居中', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '16:9' })
  assert.equal(plan.ok, true)
  assert.equal(plan.ratioId, '16:9')
  assert.equal(plan.width, 1536)
  assert.equal(plan.height, 864)
  assert.deepEqual(plan.content, { x: 336, y: 0, width: 864, height: 864 })
  assert.deepEqual(plan.padding, { left: 336, right: 336, top: 0, bottom: 0 })
  assert.equal(plan.coverage, 0.4375)
  assertAligned(plan)
  assertBounds(plan)
})

await check('目标画幅 9:16：内容铺满宽度，上下留白，居中', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '9:16' })
  assert.equal(plan.ok, true)
  assert.equal(plan.width, 864)
  assert.equal(plan.height, 1536)
  assert.deepEqual(plan.content, { x: 0, y: 336, width: 864, height: 864 })
  assert.deepEqual(plan.padding, { left: 0, right: 0, top: 336, bottom: 336 })
  assertAligned(plan)
  assertBounds(plan)
})

await check('目标画幅 4:3：画布比例贴近 4:3 且不超像素上限，只在左右留白', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '4:3' })
  assert.equal(plan.ok, true)
  const ratio = plan.width / plan.height
  assert.ok(Math.abs(ratio - 4 / 3) < 0.02, `画布比例应约 4:3，实际 ${ratio}`)
  assert.ok(plan.width * plan.height <= OUTPAINT.maxPixels)
  assert.equal(plan.padding.top, 0)
  assert.equal(plan.padding.bottom, 0)
  assert.ok(plan.padding.left > 0 && plan.padding.right > 0)
  assertAligned(plan)
  assertBounds(plan)
})

await check('目标画幅与源图比例相同：没有新增区域，返回 no_padding', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1536, sourceHeight: 864, ratioId: '16:9' })
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'no_padding')
  const portrait = outpaintPlanOf({ sourceWidth: 432, sourceHeight: 768, ratioId: '9:16' })
  assert.equal(portrait.ok, false)
  assert.equal(portrait.reason, 'no_padding')
})

await check('源图太小 / 太极端：返回 too_small，不硬凑画布', () => {
  const tiny = outpaintPlanOf({ sourceWidth: 100, sourceHeight: 100, ratioId: 'source' })
  assert.equal(tiny.ok, false)
  assert.equal(tiny.reason, 'too_small')
  // 极端长宽比：内容缩到满足上限后短边不足 minEdge。
  const wide = outpaintPlanOf({ sourceWidth: 1536, sourceHeight: 120, ratioId: 'source' })
  assert.equal(wide.ok, false)
  assert.equal(wide.reason, 'too_small')
})

await check('非法源图 / 非法比例：返回明确原因', () => {
  for (const bad of [null, undefined, {}, { sourceWidth: 0, sourceHeight: 100 }, { sourceWidth: 'x', sourceHeight: 100 }]) {
    const plan = outpaintPlanOf(bad)
    assert.equal(plan.ok, false, `非法源图应失败：${JSON.stringify(bad)}`)
    assert.equal(plan.reason, 'invalid_source')
  }
  const unknownRatio = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '21:9' })
  assert.equal(unknownRatio.ok, false)
  assert.equal(unknownRatio.reason, 'invalid_ratio')
  // 不传比例时默认「四边扩 20%」。
  assert.equal(outpaintPlanOf({ sourceWidth: 512, sourceHeight: 512 }).ratioId, OUTPAINT.expandId)
})

await check('anchor 归一：钳到 0~1，缺失 / 非法按 0.5 居中', () => {
  assert.deepEqual(outpaintAnchorOf({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 })
  assert.deepEqual(outpaintAnchorOf({ x: -1, y: 2 }), { x: 0, y: 1 })
  assert.deepEqual(outpaintAnchorOf({ x: '0.25', y: 'nope' }), { x: 0.25, y: 0.5 })
  assert.deepEqual(outpaintAnchorOf(null), { x: 0.5, y: 0.5 })
  assert.deepEqual(outpaintAnchorOf({ x: 0.123456, y: 0.98765 }), { x: 0.1235, y: 0.9877 })
})

await check('anchor 边界：四边扩 20% 时内容可贴任意边，留白不为负且 8 对齐', () => {
  const leftTop = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: 'source', anchor: { x: 0, y: 0 } })
  assert.equal(leftTop.ok, true)
  assert.equal(leftTop.padding.left, 0)
  assert.equal(leftTop.padding.top, 0)
  assert.equal(leftTop.padding.right, 208)
  assert.equal(leftTop.padding.bottom, 208)
  assertAligned(leftTop)

  const rightBottom = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: 'source', anchor: { x: 1, y: 1 } })
  assert.equal(rightBottom.padding.right, 0)
  assert.equal(rightBottom.padding.bottom, 0)
  assert.equal(rightBottom.padding.left, 208)
  assert.equal(rightBottom.padding.top, 208)
  assertAligned(rightBottom)

  // 目标画幅只有一个轴有留白：另一轴的 anchor 变化不影响版面。
  const horizontalOnly = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '16:9', anchor: { x: 0, y: 0.9 } })
  assert.equal(horizontalOnly.padding.left, 0)
  assert.equal(horizontalOnly.padding.right, 672)
  assert.equal(horizontalOnly.padding.top, 0)
  assert.equal(horizontalOnly.padding.bottom, 0)
})

await check('outpaintAnchorShift：方向键按像素平移，无留白的轴不动，越界钳制', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: 'source' })
  const center = { x: 0.5, y: 0.5 }
  const right = outpaintAnchorShift(plan, center, { x: 8, y: 0 })
  assert.ok(right.x > center.x)
  assert.equal(right.y, center.y, '只移动 x 轴')
  const moved = outpaintAnchorShift(plan, center, { x: 104, y: 0 })
  assert.ok(Math.abs(moved.x - (0.5 + 104 / 208)) < 0.001, '平移 104px 等于半个留白总宽')
  assert.deepEqual(outpaintAnchorShift(plan, center, { x: 99999, y: -99999 }), { x: 1, y: 0 })
  // 16:9 只在 x 轴有留白：y 方向的方向键不改变锚点。
  const wide = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '16:9' })
  assert.deepEqual(outpaintAnchorShift(wide, center, { x: 0, y: 8 }), { x: 0.5, y: 0.5 })
  // 非法 plan 原样返回归一后的锚点。
  assert.deepEqual(outpaintAnchorShift(null, { x: 9, y: -9 }, { x: 8, y: 8 }), { x: 1, y: 0 })
})

await check('覆盖率：与 plan 一致、落在 0~1，非法板块返回 0', () => {
  const plan = outpaintPlanOf({ sourceWidth: 1024, sourceHeight: 1024, ratioId: '16:9' })
  const coverage = outpaintCoverageOf(plan)
  assert.equal(coverage, plan.coverage)
  assert.ok(coverage > 0 && coverage < 1)
  assert.equal(outpaintCoverageOf(null), 0)
  assert.equal(outpaintCoverageOf({ ok: false }), 0)
  assert.equal(outpaintCoverageOf({ ok: true, width: 0, height: 0, content: {} }), 0)
  // 内容占满画布的场景（理论上不会发生）覆盖率按 0 处理。
  assert.equal(outpaintCoverageOf({
    ok: true,
    width: 800,
    height: 800,
    content: { x: 0, y: 0, width: 800, height: 800 },
  }), 0)
})

await check('版面矩阵：常见源尺寸 × 全部比例，尺寸 / 对齐 / 上限恒成立', () => {
  const sources = [
    [1024, 1024],
    [1024, 768],
    [1280, 720],
    [768, 1024],
    [1536, 512],
    [640, 640],
  ]
  for (const [width, height] of sources) {
    for (const option of outpaintRatioOptions()) {
      const plan = outpaintPlanOf({ sourceWidth: width, sourceHeight: height, ratioId: option.id })
      if (!plan.ok) {
        assert.ok(['no_padding', 'too_small', 'bounds'].includes(plan.reason), `意外失败原因：${plan.reason}`)
        continue
      }
      assertAligned(plan)
      assertBounds(plan)
      assert.ok(plan.content.width <= plan.width && plan.content.height <= plan.height)
      assert.ok(plan.coverage > 0 && plan.coverage < 1, '扩图必须有新增区域')
      assert.equal(plan.coverage, outpaintCoverageOf(plan))
    }
  }
})

summary()
