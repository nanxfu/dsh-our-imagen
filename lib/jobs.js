/**
 * 出图任务队列的门面（实现已按职责拆到 `lib/jobs/`）。
 *
 * 本文件只做聚合 re-export，保证既有 `import ... from './jobs.js'` / `'../jobs.js'`
 * 的调用方零改动：
 *  - `./jobs/validator.js`    参数钳制与提交期校验（含图生图 reference 预检）
 *  - `./jobs/errors.js`       错误归因、取消信号与时间工具
 *  - `./jobs/reference-loader.js` 工作区 `imagen-output/` 参考图的安全读取
 *  - `./jobs/queue.js`        `JobQueue` 状态机（串行执行 / 取消 / 落盘 / waitFor）
 *
 * 协议见 docs/SPEC.md 第 2.2 节：远端是单张 GPU 的常驻进程，Host 侧固定串行。
 */

export {
  normalizeStrength,
  normalizeReference,
  normalizeTool,
  normalizeUpscaleExtent,
  normalizeUpscaleRequest,
} from './jobs/validator.js'
export { describeJobError } from './jobs/errors.js'
export { JobQueue } from './jobs/queue.js'
