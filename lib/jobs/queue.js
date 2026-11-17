/**
 * 出图任务队列（协议见 docs/SPEC.md 第 2.2 节）。
 *
 * 远端是单张 GPU 的常驻进程，并发提交只会互相排队并放大 OOM 概率，
 * 因此 Host 侧固定串行：同一时刻最多一个 running job。
 *
 * 从 `lib/jobs.js` 拆出：本文件只放 `JobQueue` 状态机（入队、串行执行、取消、
 * 产物持久化、`waitFor` 长轮询通知）；参数校验在 `./validator.js`，
 * 错误归因在 `./errors.js`，参考图读取在 `./reference-loader.js`。
 */

import { randomBytes } from 'node:crypto'

import { LIMITS, TIMEOUTS, UPSCALE } from '../../shared/contract.js'
import { createLogger } from '../log.js'
import { saveJobOutput } from '../output.js'
import { normalizeSaveTo } from '../paths.js'
import { presetById } from '../presets.js'
import { logText } from '../redact.js'
import { submitGenerate, waitForJob } from '../remote.js'
import { JobCancelled, describeJobError, errorKind, isCancellation, isoNow } from './errors.js'
import { resolveReferenceImagesPayload, resolveReferencePayload } from './reference-loader.js'
import {
  clampInt,
  clampNumber,
  normalizeDimension,
  normalizeReference,
  normalizeReferences,
  normalizeTool,
  normalizeUpscaleRequest,
} from './validator.js'

const log = createLogger({ scope: 'jobs' })

/** 测试替身可能没有 snapshot()：取状态失败时退化为 unknown，不影响任务路径。 */
function sessionStateOf(session) {
  try {
    return session?.snapshot?.()?.state ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

const SESSION_STAGE = {
  provisioning: '排队中',
  connecting: '建立隧道',
  warming: '加载模型',
  ready: '生成中',
  stopping: '正在停止',
  error: '会话失败',
}

/** 任务终态：进入后所有等待者立即唤醒，不再继续等（cancelled 也是终态）。 */
const TERMINAL_STATUS = new Set(['done', 'failed', 'cancelled'])

export class JobQueue {
  constructor({ ctx, session, defaultPreset, options = {} }) {
    this.ctx = ctx
    this.session = session
    this.defaultPreset = defaultPreset
    this.options = {
      sessionWaitMs: TIMEOUTS.sessionWaitMs,
      generateTimeoutMs: TIMEOUTS.remoteJobMs,
      // 取消感知等待的轮询间隔：生产 1s；测试可调小以加速离线回归。
      sessionPollMs: 1000,
      ...options,
    }
    this.jobs = []
    this.pending = []
    this.running = null
    this.disposed = false
    this.abortController = new AbortController()
    // waitFor 的等待者：jobId → Set<唤醒函数>。注册在任务进入终态前完成，
    // 唤醒由 runNext 的收尾路径与 dispose() 统一触发（不再按固定间隔轮询）。
    this.waiters = new Map()
  }

  // ---- 读取 ---------------------------------------------------------------

  list(limit = 20) {
    return this.jobs.slice(-limit).reverse().map((job) => this.publicView(job))
  }

  get(id) {
    const job = this.jobs.find((item) => item.id === id)
    return job ? this.publicView(job) : null
  }

  get lastFinished() {
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      const job = this.jobs[index]
      if (TERMINAL_STATUS.has(job.status)) return this.publicView(job)
    }
    return null
  }

  queueStats() {
    return { running: this.running?.id ?? null, pending: this.pending.length }
  }

  /**
   * 结构化阶段标识（稳定英文，客户端按它选本地化文案，不再解析中文 `stage`）。
   *
   * 取值域：queued / waiting-session / loading / running / done / failed / cancelled。
   * `loading` 专指会话已就绪但远端仍在加载模型（`sessionState === 'warming'`），
   * 与「等 Kernel 排队」区分开，英文界面才能分别显示等待与加载。
   */
  stageCodeOf(job) {
    if (job.status === 'waiting-session') {
      return job.sessionState === 'warming' ? 'loading' : 'waiting-session'
    }
    if (job.status === 'running' || job.status === 'done' || job.status === 'failed') return job.status
    if (job.status === 'cancelled') return 'cancelled'
    return 'queued'
  }

  /**
   * 结构化分张进度：只在 running 时给 `{ done, total }`，其他状态为 null。
   *
   * `done` 是「已完成的张数」（0 起）。旧的 `stage` 文本用 `done + 1` 表示「正在出第
   * 几张」，语义不同且要向后兼容，所以 stage 保持原样，客户端用本字段做精确进度。
   */
  progressOf(job) {
    if (job.status !== 'running') return null
    const total = Math.max(1, Math.round(Number(job.progress?.total ?? job.params?.count) || 1))
    const done = Math.round(Number(job.progress?.done) || 0)
    return { done: Math.min(total, Math.max(0, done)), total }
  }

  publicView(job) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      stageCode: this.stageCodeOf(job),
      // 请求类型（generate / upscale / outpaint）：客户端幽灵节点与版本树按它决定展示与归组；
      // 缺省 generate，旧任务与旧客户端读不到该字段时行为不变。
      tool: job.tool ?? 'generate',
      progress: this.progressOf(job),
      presetId: job.presetId,
      params: { ...job.params },
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      seconds: job.seconds,
      sessionState: job.sessionState,
      modelId: job.modelId ?? null,
      output: job.output ?? null,
      error: job.error ? { ...job.error } : null,
      // 「是否还有未收敛的取消请求」：running 合作式停止期间为 true；
      // 终态（done / failed / cancelled）与未取消一律 false（字段始终存在，客户端不必猜）。
      // 内部 job.cancelRequested 保留到收尾完成，供等待循环/逐张循环尽早退出。
      cancelRequested: job.cancelRequested === true && !TERMINAL_STATUS.has(job.status),
    }
  }

  // ---- 提交 ---------------------------------------------------------------

  /**
   * 校验并排队。
   *
   * 阶段十五 Phase B 起按 `tool` 分派三类请求（缺省 generate，旧客户端零影响）：
   *  - generate：文生图 / 图生图 / 局部重绘，与拆分前逐字一致；
   *  - upscale：高清放大，跳过扩散预设，固定 1 张，只收一张源图（无蒙版）；
   *  - outpaint：扩图，与 generate 同路径，额外记录客户端给的来源图 `sourcePath`。
   *
   * @param {object} request 见 docs/SPEC.md 第 2.2 节
   * @returns {{ ok: true, job: object } | { ok: false, code: string, message: string }}
   */
  submit(request = {}) {
    const toolResult = normalizeTool(request.tool)
    if (!toolResult.ok) {
      log.info(`enqueue_rejected code=${toolResult.code} tool=invalid pending=${this.pending.length}`)
      return toolResult
    }
    const tool = toolResult.tool

    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
    // 只有文生图要求提示词：高清放大没有提示词语义；扩图的提示词由客户端始终携带，
    // 但 Host 不把它当成硬门槛（远端 inpaint 只要求非空 prompt，空串会由远端拒绝）。
    if (tool === 'generate' && prompt.length === 0) {
      log.info(`enqueue_rejected code=invalid_prompt promptLen=0 tool=${tool} pending=${this.pending.length}`)
      return { ok: false, code: 'invalid_prompt', message: 'prompt 不能为空' }
    }
    if (prompt.length > LIMITS.prompt.maxChars) {
      log.info(
        `enqueue_rejected code=invalid_prompt promptLen=${prompt.length} tool=${tool} pending=${this.pending.length}`,
      )
      return { ok: false, code: 'invalid_prompt', message: `prompt 超过 ${LIMITS.prompt.maxChars} 字符` }
    }
    if (this.pending.length >= LIMITS.queue.maxPending) {
      log.info(
        `enqueue_rejected code=queue_full promptLen=${prompt.length} tool=${tool} pending=${this.pending.length}`,
      )
      return { ok: false, code: 'queue_full', message: '队列已满，请等待当前任务完成' }
    }

    // saveTo 的格式校验放在入队前（同步纯函数）：非法路径不占队列位置，
    // 调用方立刻拿到 invalid_path；符号链接逃逸检查留给落盘时的真实路径校验。
    let saveTo = null
    if (request.saveTo !== undefined && request.saveTo !== null && request.saveTo !== '') {
      const normalizedSaveTo = normalizeSaveTo(request.saveTo)
      if (!normalizedSaveTo.ok) {
        log.info(
          `enqueue_rejected code=invalid_path saveToLen=${String(request.saveTo).length} pending=${this.pending.length}`,
        )
        return normalizedSaveTo
      }
      saveTo = normalizedSaveTo.relative
    }

    // 参考图 / 源图预检：三类 tool 的规则不同，但都在入队前做（非法值不占队列位置），
    // 真正的文件读取与 base64 化留到执行阶段（画廊路径必须先通过 resolveOutputPath 的越界校验）。
    //
    // 原生参考生图（Phase C1）与单图垫图是两条互斥路径：`references` 只用于 generate，
    // 与 `reference` 同时出现直接 400（不挑一条静默忽略，避免用户以为用上了另一条）。
    const referencesResult = normalizeReferences(request.references)
    if (!referencesResult.ok) {
      log.info(
        `enqueue_rejected code=${referencesResult.code} tool=${tool} references=invalid pending=${this.pending.length}`,
      )
      return referencesResult
    }
    const references = referencesResult.value
    const hasReferenceField =
      request.reference !== undefined && request.reference !== null && request.reference !== ''
    if (references && hasReferenceField) {
      log.info(
        `enqueue_rejected code=invalid_request tool=${tool} references=mixed pending=${this.pending.length}`,
      )
      return {
        ok: false,
        code: 'invalid_request',
        message:
          'references（模型原生参考图列表）与 reference（单图垫图 / 局部重绘）不能同时使用：二者是两条互斥路径',
      }
    }
    if (references && tool !== 'generate') {
      log.info(
        `enqueue_rejected code=invalid_request tool=${tool} references=unsupported_tool pending=${this.pending.length}`,
      )
      return {
        ok: false,
        code: 'invalid_request',
        message: `references（模型原生参考图）只支持普通出图（tool=generate），当前 tool=${tool}`,
      }
    }

    let reference = null
    let upscaleExtent = { width: null, height: null }
    if (tool === 'upscale') {
      // 放大只接受一张源图（path 或 image），不接受蒙版；宽高按 UPSCALE.maxInputEdge 预检。
      const upscaleResult = normalizeUpscaleRequest(request)
      if (!upscaleResult.ok) {
        log.info(`enqueue_rejected code=${upscaleResult.code} tool=upscale pending=${this.pending.length}`)
        return upscaleResult
      }
      reference = upscaleResult.reference
      upscaleExtent = { width: upscaleResult.width, height: upscaleResult.height }
    } else {
      const referenceResult = normalizeReference(request.reference)
      if (!referenceResult.ok) {
        log.info(
          `enqueue_rejected code=${referenceResult.code} tool=${tool} img2img=1 pending=${this.pending.length}`,
        )
        return referenceResult
      }
      reference = referenceResult.value
    }

    // 高清放大不走扩散预设：presetId / modelId 固定记超分模型标识（不进模型选择器）。
    const preset = tool === 'upscale' ? null : presetById(request.presetId ?? this.defaultPreset)
    // 原生参考生图能力：模型资产 `supportsReference` 是客户端与 Host 共用的能力位；
    // daemon 侧还有一层 loader 白名单兜底（不信任客户端标记）。
    if (references && preset?.supportsReference !== true) {
      log.info(
        `enqueue_rejected code=invalid_request presetId=${preset?.id ?? 'none'} references=unsupported_model pending=${this.pending.length}`,
      )
      return {
        ok: false,
        code: 'invalid_request',
        message: '该模型不支持参考生图：请切换到支持原生参考图的模型（如 FLUX.2 Klein 4B）',
      }
    }
    // 专用 inpaint 权重（inpaintOnly）只能带蒙版使用：缺参考图或蒙版时直接拒，
    // 不占用队列与 GPU（daemon 侧还有一层同等语义的兜底）。
    if (preset && preset.inpaintOnly === true && !(reference && reference.maskB64)) {
      log.info(
        `enqueue_rejected code=invalid_request inpaint_only=1 hasReference=${reference ? 1 : 0} pending=${this.pending.length}`,
      )
      return {
        ok: false,
        code: 'invalid_request',
        message: '该模型只支持局部重绘：请先以此图重绘并涂抹蒙版',
      }
    }
    const seedInput = Number(request.seed)
    const seed =
      Number.isFinite(seedInput) && seedInput >= 0
        ? Math.round(seedInput) % LIMITS.seed.max
        : Math.floor(Math.random() * LIMITS.seed.max)

    let params
    if (tool === 'upscale') {
      // 放大没有 steps / cfg / seed 语义：params 里保留 0 供展示，count 固定 1 张。
      // width / height 是源图宽高（客户端带来，缺失时为 null，由远端解码后兜底）。
      params = {
        prompt,
        negativePrompt:
          typeof request.negativePrompt === 'string'
            ? request.negativePrompt.trim().slice(0, LIMITS.negativePrompt.maxChars)
            : '',
        width: upscaleExtent.width,
        height: upscaleExtent.height,
        steps: 0,
        cfg: 0,
        seed: 0,
        count: 1,
        reference: { sourcePath: reference.sourcePath, upscale: true },
      }
    } else {
      params = {
        prompt,
        negativePrompt:
          typeof request.negativePrompt === 'string'
            ? request.negativePrompt.trim().slice(0, LIMITS.negativePrompt.maxChars)
            : '',
        width: normalizeDimension(request.width, preset.size, LIMITS.width),
        height: normalizeDimension(request.height, preset.size, LIMITS.height),
        steps: clampInt(request.steps, LIMITS.steps.min, LIMITS.steps.max, preset.steps),
        cfg: clampNumber(request.cfg, LIMITS.cfg.min, LIMITS.cfg.max, preset.cfg),
        seed,
        count: clampInt(request.count, LIMITS.count.min, LIMITS.count.max, LIMITS.count.min),
      }
      // 公开视图只暴露参考图出处、强度与「是否带蒙版」，不暴露任何二进制
      // （/state 每 2 秒轮询一次；蒙版 base64 只留在内部 job.reference 里直到执行阶段）。
      if (reference) {
        // 扩图的参考图是前端合成的画布：image 来源没有工作区路径，改用客户端给的
        // sourcePath 记录被扩的原作品，版本树才能把扩图产物归组到来源作品。
        params.reference = {
          sourcePath: tool === 'outpaint' ? reference.sourcePath : reference.path,
          strength: reference.strength,
        }
        // 扩图内容框（原图在画布里的位置）只对 outpaint 有意义：其它 tool 一律忽略，
        // 公开视图只暴露这个小对象（0~1 归一化，客户端据此对齐「对比原图」拉帘）。
        if (tool === 'outpaint' && reference.outpaintContent) {
          params.reference.outpaintContent = reference.outpaintContent
        }
        if (reference.maskB64) params.reference.mask = true
      }
      // 原生参考生图：公开视图只暴露参考图出处（工作区相对路径），不暴露任何二进制；
      // 产物 meta 的 `referenceSources` 与 /history 透传都用这组路径。
      if (references) params.referenceSources = [...references]
    }

    const job = {
      id: `j_${randomBytes(4).toString('hex')}`,
      // 请求类型：远端只认 generate / upscale，outpaint 在 Host 侧展开成普通 inpaint 请求。
      tool,
      status: 'queued',
      stage: '排队中',
      presetId: tool === 'upscale' ? UPSCALE.id : preset.id,
      params,
      // 内部参考图（可能带 base64）；不进入 publicView，只用于执行阶段构造远端载荷。
      reference,
      // 模型原生参考图（工作区相对路径数组）：执行阶段读盘并做成远端 referenceImages 载荷；
      // 与 reference 互斥，二者最多一个非空。
      references,
      // 工作区交付目标（已归一成 POSIX 相对路径）；null 表示只写 imagen-output 归档。
      saveTo,
      createdAt: isoNow(),
      startedAt: null,
      finishedAt: null,
      seconds: null,
      sessionState: this.session.snapshot().state,
      modelId: tool === 'upscale' ? UPSCALE.id : preset.repo,
      output: null,
      error: null,
      autoStart: request.autoStart !== false,
    }

    this.jobs.push(job)
    this.pending.push(job)
    this.trim()
    // 只记 prompt 长度：提示词正文与 negativePrompt 正文不得进日志。
    log.info(
      `enqueue jobId=${job.id} tool=${tool} presetId=${job.presetId} size=${params.width}x${params.height} ` +
        `steps=${params.steps} count=${params.count} promptLen=${params.prompt.length} ` +
        `img2img=${reference ? 'on' : 'off'}${reference && tool !== 'upscale' ? ` strength=${reference.strength}` : ''} ` +
        `inpaint=${reference?.maskB64 ? 'on' : 'off'} references=${references ? references.length : 0} ` +
        `pending=${this.pending.length}`,
    )
    void this.runNext()
    return { ok: true, job: this.publicView(job) }
  }

  trim() {
    while (this.jobs.length > LIMITS.queue.maxKept) {
      const index = this.jobs.findIndex((job) => job.id !== this.running?.id && !this.pending.includes(job))
      if (index === -1) return
      this.jobs.splice(index, 1)
    }
  }

  /** 从待执行队列移除任务（已在执行/已不在队列时为空操作）。 */
  dropFromPending(job) {
    const index = this.pending.indexOf(job)
    if (index >= 0) this.pending.splice(index, 1)
  }

  // ---- 取消 ---------------------------------------------------------------

  /**
   * 取消任务（取消语义见 shared/contract.js 的 JOB_CANCEL 与 docs/SPEC.md §2.2）。
   *
   * - `queued`：从 pending 移除并立即置为终态 cancelled；若当前没有 running，
   *   立刻推进后续任务（取消不能把队列卡住）。
   * - `waiting-session`：置 cancelRequested 并立即置终态，同时释放串行槽位——
   *   会话等待循环下一拍（约 1 秒）就会感知取消并退出，不必等满 sessionWaitMs
   *   （45 分钟）才轮到后面的任务（队头阻塞）。
   * - `running`：只置 cancelRequested（合作式）。当前这张远端任务照常出完，
   *   已完成的图片仍落盘，之后不再提交批内剩余张数，任务最终收敛为 cancelled；
   *   远端采样线程不强杀、不改。
   * - `done` / `failed` / `cancelled`：终态不做任何改变，返回 already-finished。
   *
   * @param {string} id 任务 id
   * @returns {{ ok: true, job: object, disposition: 'dequeued'|'cooperative'|'already-finished' }
   *   | { ok: false, code: 'not_found' }}
   */
  cancel(id) {
    const job = this.jobs.find((item) => item.id === id)
    if (!job) return { ok: false, code: 'not_found' }

    if (TERMINAL_STATUS.has(job.status)) {
      return { ok: true, job: this.publicView(job), disposition: 'already-finished' }
    }

    if (job.status === 'queued' || job.status === 'waiting-session') {
      this.dropFromPending(job)
      job.cancelRequested = true
      job.status = 'cancelled'
      job.stage = '已取消'
      job.finishedAt = isoNow()
      job.error = null
      job.sessionState = sessionStateOf(this.session)
      // 等待会话的任务此刻占用串行槽位：立刻让出，后续任务不必等等待循环超时。
      // runNext 的 finally 用 `this.running === job` 守卫，不会误清掉下一个任务的占位。
      if (this.running === job) this.running = null
      // 取消即终态：登记中的 waitFor 等待者立刻拿到 cancelled 快照。
      this.wakeWaiters(job.id)
      // 只记结构化摘要（jobId/张数/disposition），prompt 正文不进日志。
      log.info(
        `job_cancelled jobId=${job.id} disposition=dequeued images=${job.output?.images?.length ?? 0} ` +
          `total=${job.params.count} pending=${this.pending.length}`,
      )
      if (!this.disposed) void this.runNext()
      return { ok: true, job: this.publicView(job), disposition: 'dequeued' }
    }

    // running：合作式停止。不改 status（客户端继续显示生成中/正在停止），由当前张收尾后收敛。
    if (job.cancelRequested !== true) {
      job.cancelRequested = true
      log.info(`job_cancel_requested jobId=${job.id} disposition=cooperative total=${job.params.count}`)
    }
    return { ok: true, job: this.publicView(job), disposition: 'cooperative' }
  }

  // ---- 执行 ---------------------------------------------------------------

  /** 队列记账与串行占位：把任务交给 runJob，失败统一折叠成 job.error。 */
  async runNext() {
    if (this.disposed || this.running || this.pending.length === 0) return
    const job = this.pending.shift()
    this.running = job

    try {
      await this.runJob(job)
    } catch (error) {
      // 取消路径的收尾在 runJob / cancel() 内完成，这里绝不能把已取消的任务改成 failed：
      // waiting-session 的取消会让 cancel() 先改状态、runJob 稍后才退出，此时 job 已是终态。
      if (job.status === 'cancelled') {
        job.sessionState = sessionStateOf(this.session)
      } else {
        job.status = 'failed'
        job.stage = '失败'
        job.finishedAt = isoNow()
        job.error = describeJobError(error, this.session.snapshot(), {
          started: Boolean(job.startedAt),
          stoppedByUser: this.session.stoppedByUser === true,
        })
        // 用户手动关机会把底层 session_absent / session_timeout 折叠成 stopped：
        // 单独记一条 canceled_by_stop，便于在 Host 日志里区分「关机取消」和「真实失败」。
        if (job.error.code === 'stopped') {
          log.warn(`canceled_by_stop jobId=${job.id} promptLen=${job.params.prompt.length}`)
        }
        log.warn(
          `job_failed jobId=${job.id} code=${job.error.code} promptLen=${job.params.prompt.length} message=${logText(job.error.message)}`,
        )
      }
    } finally {
      // 守卫：cancel() 可能已经释放槽位并启动了下一个任务，此时 this.running 不再属于本任务，
      // 不能在这里清掉别人的占位。
      if (this.running === job) this.running = null
      // 收尾路径统一唤醒等待者：正常路径此时已是终态；dispose / 异常路径也返回当前快照，
      // 不把 waitFor 调用方挂死。放在 runNext 里而不是 runJob 内，保证成功与失败只有一处接管。
      this.wakeWaiters(job.id)
      if (!this.disposed) void this.runNext()
    }
  }

  /**
   * 会话等待 + 逐张远端调用；成功路径的落盘与收尾交给 persistResult，
   * 取消路径交给 finalizeCancelled（已完成的图片照常落盘，状态写成 cancelled）。
   */
  async runJob(job) {
    let startedAt = null
    try {
      if (job.cancelRequested) throw new JobCancelled()

      if (this.session.isReady) {
        job.sessionState = 'ready'
      } else {
        job.status = 'waiting-session'
        job.stage = '准备远端会话'
        const waitStartedAt = Date.now()
        log.info(
          `wait_session_start jobId=${job.id} autoStart=${job.autoStart !== false} promptLen=${job.params.prompt.length}`,
        )
        try {
          // 用户手动「关机」后，排队中的任务不得自动把 Kernel 拉起来（否则关机按钮形同虚设）。
          // 标记只由 SessionManager.stop() 置位、下一次 start() 清除。
          if (this.session.stoppedByUser === true) {
            throw Object.assign(
              new Error('会话已被手动关闭，未自动启动新的 Kernel；请先在面板点「唤醒」后再试'),
              { code: 'stopped' },
            )
          }
          if (job.autoStart) {
            await this.session.start(job.presetId)
            // start() 可能耗时（推送 Kernel）；返回后立刻检查取消标记，别再进入等待循环。
            if (job.cancelRequested) throw new JobCancelled()
          }
          job.sessionState = this.session.snapshot().state
          await this.waitSessionReady(job)
          log.info(
            `wait_session_done jobId=${job.id} elapsedMs=${Date.now() - waitStartedAt} state=${sessionStateOf(this.session)}`,
          )
        } catch (error) {
          if (isCancellation(error)) {
            log.info(`wait_session_cancelled jobId=${job.id} elapsedMs=${Date.now() - waitStartedAt}`)
          } else {
            log.warn(
              `wait_session_done jobId=${job.id} elapsedMs=${Date.now() - waitStartedAt} ` +
                `state=${sessionStateOf(this.session)} code=${errorKind(error)} message=${logText(error?.message)}`,
            )
          }
          throw error
        }
      }

      const { endpoint, token } = this.session.connection()
      if (!endpoint || !token) throw Object.assign(new Error('远端连接不可用'), { code: 'session_absent' })

      startedAt = Date.now()
      job.status = 'running'
      job.stage = '生成中'
      job.startedAt = isoNow()

      // 远端载荷构造与传输都在本队列的 generate 里，远端协议细节不进路由层。
      const generateStartedAt = Date.now()
      log.info(
        `remote_generate_start jobId=${job.id} tool=${job.tool ?? 'generate'} presetId=${job.presetId} ` +
          `count=${job.params.count} timeoutMs=${this.options.generateTimeoutMs}`,
      )
      let generated
      try {
        generated = await this.generate(job)
      } catch (error) {
        if (isCancellation(error)) {
          log.info(
            `remote_generate_cancelled jobId=${job.id} tool=${job.tool ?? 'generate'} elapsedMs=${Date.now() - generateStartedAt}`,
          )
        } else {
          log.warn(
            `remote_generate_failed jobId=${job.id} tool=${job.tool ?? 'generate'} elapsedMs=${Date.now() - generateStartedAt} ` +
              `count=${job.params.count} code=${errorKind(error)} message=${logText(error?.message)}`,
          )
        }
        throw error
      }
      const { results, modelId } = generated
      log.info(
        `remote_generate_done jobId=${job.id} tool=${job.tool ?? 'generate'} elapsedMs=${Date.now() - generateStartedAt} ` +
          `images=${results.length} cancelled=${generated.cancelled === true}`,
      )

      if (generated.cancelled) {
        await this.finalizeCancelled(job, { startedAt, results, modelId })
        return
      }
      await this.persistResult(job, results, { startedAt, modelId })
      log.info(
        `job_done jobId=${job.id} seconds=${job.seconds} images=${job.output?.images?.length ?? results.length}`,
      )
    } catch (error) {
      if (!isCancellation(error)) throw error
      await this.finalizeCancelled(job, { startedAt, results: [] })
    }
  }

  /**
   * 可取消的会话等待（替代不可中断的 `session.ensureReady()`）。
   *
   * 每 `sessionPollMs`（生产约 1 秒）读一次 `session.snapshot()`：
   *  - ready 返回快照；error 抛会话错误；absent / stopping 抛 session_absent；
   *  - 先检查 job.cancelRequested 与 queue.disposed：取消后下一拍即退出，
   *    waiting-session 的取消不会卡满 sessionWaitMs（45 分钟队头阻塞）；
   *  - 超时抛 session_timeout。
   * 保留原 onTick 行为：每拍把会话状态写进 job.sessionState / job.stage（SESSION_STAGE 文案）。
   */
  async waitSessionReady(job) {
    const deadline = Date.now() + this.options.sessionWaitMs
    const pollMs = Math.max(5, Number(this.options.sessionPollMs) || 1000)
    while (true) {
      if (this.disposed) throw Object.assign(new Error('插件已卸载'), { code: 'disposed' })
      if (job.cancelRequested) throw new JobCancelled()
      const snapshot = this.session.snapshot()
      const state = snapshot?.state ?? 'unknown'
      job.sessionState = state
      job.stage = SESSION_STAGE[state] ?? job.stage
      if (state === 'ready') return snapshot
      if (state === 'error') {
        throw Object.assign(new Error(snapshot?.error?.message ?? '会话失败'), {
          code: snapshot?.error?.code ?? 'session_error',
        })
      }
      if (state === 'absent' || state === 'stopping') {
        throw Object.assign(new Error('会话未启动'), { code: 'session_absent' })
      }
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('等待会话就绪超时'), { code: 'session_timeout' })
      }
      await new Promise((resolve) => {
        const signal = this.abortController.signal
        if (signal.aborted) return resolve()
        const onAbort = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, pollMs)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }

  /**
   * 单张任务的远端载荷：`tasks` 只含 1 项，幂等键 `<宿主 job.id>-<两位序号>`。
   *
   * 逐张提交是合作式取消的前提：一张完成后才提交下一张，取消时不再提交剩余张数。
   * daemon 的 jobId 只接受字母/数字/点/下划线/短横线且 ≤64 字符，这里的键满足该约束。
   * 图生图时在 job 级带 `reference: { image_b64, strength }`（一张参考图跑整批）；
   * 局部重绘再带 `reference.mask_b64`（同样整批共用一张蒙版）。
   */
  taskPayload(job, preset, index, reference = null, referenceImages = null) {
    const params = job.params
    const payload = {
      pipeline: preset.pipeline,
      modelId: preset.repo,
      jobId: `${job.id}-${String(index + 1).padStart(2, '0')}`,
      tasks: [
        {
          name: String(index + 1).padStart(2, '0'),
          prompt: params.prompt,
          negative_prompt: params.negativePrompt,
          // 同批多张按序号递增 seed；超过契约上界时环形回绕，避免远端按 seed>max 直接 400。
          seed: (params.seed + index) % LIMITS.seed.max,
          width: params.width,
          height: params.height,
          steps: params.steps,
          cfg: params.cfg,
        },
      ],
    }
    if (reference) payload.reference = reference
    // 原生参考生图（Phase C1）：job 级 referenceImages 数组，一张（或多张）参考图跑整批；
    // 逐项只含 image_b64（没有 strength / 蒙版），远端按 loader 白名单与契约边界再校验一次。
    if (referenceImages) payload.referenceImages = referenceImages
    return payload
  }

  /**
   * 把任务里的参考图解析成远端载荷：`{ image_b64, strength, mask_b64? }`；没有参考图返回 null。
   *
   * 实现见 `./reference-loader.js`（路径越界校验 + 体积/魔数校验）；这里只负责把
   * 队列作用域的日志器传下去，保持 `reference_read_failed` 的 scope 与文案不变。
   */
  async resolveReferencePayload(job) {
    return resolveReferencePayload(this.ctx, job.reference, { jobId: job.id, log })
  }

  /**
   * 把任务里的原生参考图路径列表读盘并做成远端载荷：`[{ image_b64 }, ...]`；没有参考图返回 null。
   *
   * 与单图垫图一样只在进入生成时解析一次（整批 count 共用）；失败（文件被删、超体积、
   * 总体积超预算）在提交远端请求之前抛出，任务以 `invalid_path` / `invalid_request` 失败。
   */
  async resolveReferenceImagesPayload(job) {
    return resolveReferenceImagesPayload(this.ctx, job.references, { jobId: job.id, log })
  }

  /**
   * 生成阶段超时错误：逐张提交与高清放大共用同一文案与错误码。
   */
  generateTimeoutError() {
    return Object.assign(
      new Error(`等待远端生成超时（${Math.round(this.options.generateTimeoutMs / 1000)} 秒）`),
      { code: 'generate_failed' },
    )
  }

  /**
   * 提交一张远端任务并轮询到完成（逐张出图与高清放大共用）。
   *
   * 轮询容错、失败退避、同幂等键重投、整体预算全部复用 `waitForJob`：
   * 重投时用同一份 payload（同一 jobId），daemon 命中幂等键返回原 job，不重复出图。
   *
   * @param {object} job 已排队的任务（用于进度与 remoteJobId 记账）
   * @param {object} payload 远端 /generate 请求体（含本张的幂等键）
   * @param {{ endpoint: string, token: string, total: number, done: number, remainingMs: number }} context
   *   done：本张开始前已完成的张数（分张进度与 stage 文本用；0 表示第一张）
   * @returns {Promise<object>} /job 的 done 快照（含 results / model_id）
   */
  async runRemoteImage(job, payload, { endpoint, token, total, done, remainingMs }) {
    const signal = this.abortController.signal
    const submitted = await submitGenerate(endpoint, token, payload, TIMEOUTS.remoteSubmitMs, this.ctx, signal)
    job.remoteJobId = submitted.job_id

    const response = await waitForJob(endpoint, token, submitted.job_id, {
      timeoutMs: remainingMs,
      // 测试可把这些时序调小；生产不传时由 waitForJob 回落到 contract 默认值。
      // provider 可声明自己的单次轮询超时（Colab 大响应经隧道更慢，8s 不够）。
      requestMs: this.session?.provider?.jobRequestTimeoutMs,
      pollMs: this.options.pollMs,
      failureGraceMs: this.options.pollFailureGraceMs,
      backoffMaxMs: this.options.pollBackoffMaxMs,
      resumeMaxAttempts: this.options.resumeMaxAttempts,
      ctx: this.ctx,
      signal,
      // 隧道重建超过容忍窗口后，用同一张的幂等键重投：命中则接回原 job，不重复入队。
      resubmit: async () => {
        const resumed = await submitGenerate(endpoint, token, payload, TIMEOUTS.remoteSubmitMs, this.ctx, signal)
        job.remoteJobId = resumed.job_id
        log.warn(
          `remote_resume jobId=${job.id} remoteJobId=${resumed.job_id} tool=${job.tool ?? 'generate'} ` +
            `index=${done + 1}/${total}`,
        )
        return resumed.job_id
      },
      onProgress: (snapshot) => {
        const remoteDone = Number(snapshot?.progress?.done)
        const withinImage = Number.isFinite(remoteDone) ? Math.max(0, Math.min(1, Math.round(remoteDone))) : 0
        const completed = Math.min(total, done + withinImage)
        // stage 文本保持旧语义（done+1 表示「正在出第几张」），结构化 progress 给准确完成数。
        job.progress = { done: completed, total }
        job.stage = total > 1 ? `生成中 ${Math.min(completed + 1, total)}/${total}` : '生成中'
      },
    })
    if (this.disposed) {
      throw Object.assign(new Error('插件已卸载'), { code: 'disposed' })
    }
    return response
  }

  /**
   * 逐张提交远端异步任务并轮询到完成（每张一个远端 job）；高清放大只有一张。
   *
   * 轮询容错、失败退避、同幂等键重投、整体预算全部复用 `waitForJob`：
   * 重投时用同一张的 payload（同一 jobId），daemon 命中幂等键返回原 job，不重复出图。
   * 每完成一张：results.push、job.progress 更新、job.stage 保持旧语义（done+1 表示正在出第几张）。
   * 每张开始前检查 cancelRequested：已取消就跳出，不再提交剩余张数。
   *
   * upscale（阶段十五 Phase B1）：远端有独立的超分分支，只发 1 个任务、不下发
   * pipeline / tasks / strength，`tool: 'upscale'` + 源图即全部载荷；轮询、取消与
   * 失败语义与普通出图完全一致（取消是合作式的：当前这张放大完成后收尾）。
   *
   * 错误对象与文案固定：session_absent（连接不可用）/ empty_result（无图片）；
   * 远端任务的失败码（oom / load_failed / generation_failed …）原样透传。
   *
   * @param {object} job 已排队的任务（含 tool / presetId / params / id / stage）
   * @returns {Promise<{ results: object[], modelId: string|null, cancelled: boolean }>}
   */
  async generate(job) {
    const { endpoint, token } = this.session.connection()
    if (!endpoint || !token) throw Object.assign(new Error('远端连接不可用'), { code: 'session_absent' })

    const params = job.params
    const tool = job.tool ?? 'generate'
    // 高清放大固定只出一张（远端是独立超分分支，不按 count 拆批）。
    const total = tool === 'upscale' ? 1 : params.count
    const results = []
    let modelId = null
    // 参考图只在进入生成时解析一次：多张出图共用同一张垫图（不重复读盘 / 编码）。
    const referencePayload = await this.resolveReferencePayload(job)
    // 原生参考图同理：整批 count 共用一个 referenceImages 数组（读盘 + base64 只做一次）。
    const referenceImagesPayload = await this.resolveReferenceImagesPayload(job)
    // 进入远端调用即给出 0/N 的结构化进度，客户端不用等第一次轮询才有进度数据。
    job.progress = { done: 0, total }
    // 整体预算：逐张提交只是把一批拆成 N 个远端 job，预算仍按整个宿主任务计算，
    // 避免「每张各自 10 分钟」把整体耗时放大 N 倍。
    const deadline = Date.now() + this.options.generateTimeoutMs

    if (tool === 'upscale') {
      // 源图在入队时已校验；执行阶段读盘失败会走 resolveReferencePayload 的 invalid_path。
      if (!referencePayload?.image_b64) {
        throw Object.assign(new Error('高清放大缺少源图'), { code: 'invalid_request' })
      }
      // 合作式中止点：还没提交远端任务时取消，直接按 cancelled 收尾（与逐张循环的 break 同义）。
      if (job.cancelRequested || this.disposed) {
        return { results, modelId: null, cancelled: true }
      }
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw this.generateTimeoutError()

      // 远端只接受 tool + 源图：不读 pipeline / tasks / strength（幂等键与逐张提交同规则）。
      const payload = {
        tool: 'upscale',
        modelId: UPSCALE.id,
        jobId: `${job.id}-01`,
        reference: { image_b64: referencePayload.image_b64 },
      }
      const response = await this.runRemoteImage(job, payload, { endpoint, token, total, done: 0, remainingMs })
      results.push(...(Array.isArray(response.results) ? response.results : []))
      modelId = response.model_id ?? UPSCALE.id
      job.progress = { done: results.length, total }
      return { results, modelId, cancelled: job.cancelRequested === true || this.disposed }
    }

    const preset = presetById(job.presetId)
    for (let index = 0; index < total; index += 1) {
      // 合作式中止点：一张开始前检查取消标记，置位后剩余张数不再提交。
      if (job.cancelRequested || this.disposed) break

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw this.generateTimeoutError()

      job.progress = { done: results.length, total }
      job.stage = total > 1 ? `生成中 ${Math.min(results.length + 1, total)}/${total}` : '生成中'

      const payload = this.taskPayload(job, preset, index, referencePayload, referenceImagesPayload)
      const response = await this.runRemoteImage(job, payload, {
        endpoint,
        token,
        total,
        done: results.length,
        remainingMs,
      })

      results.push(...(Array.isArray(response.results) ? response.results : []))
      modelId = response.model_id ?? modelId ?? preset.repo
      job.progress = { done: results.length, total }
      job.stage = total > 1 ? `生成中 ${Math.min(results.length + 1, total)}/${total}` : '生成中'
    }

    return { results, modelId, cancelled: job.cancelRequested === true || this.disposed }
  }

  /**
   * 落盘并收尾。
   * 顺序不能改：先写 finishedAt/seconds 再调 saveJobOutput，meta.json 才能带上完成时间；
   * modelId 在落盘之后才覆盖（meta 里保留提交时的 preset.repo，与拆分前一致）。
   */
  async persistResult(job, results, { startedAt, modelId }) {
    if (this.disposed) {
      throw Object.assign(new Error('插件已卸载'), { code: 'disposed' })
    }
    job.finishedAt = isoNow()
    job.seconds = Math.round((Date.now() - startedAt) / 100) / 10
    const output = await saveJobOutput(this.ctx, job, results)
    if (this.disposed) {
      throw Object.assign(new Error('插件已卸载'), { code: 'disposed' })
    }
    job.output = output
    job.modelId = modelId ?? job.modelId
    job.status = 'done'
    job.stage = '完成'
    job.sessionState = this.session.snapshot().state
  }

  /**
   * 取消收尾。
   *
   * 已完成的图片仍落盘（复用 saveJobOutput，与 persistResult 同一套写盘逻辑），但状态
   * 固定写 cancelled —— 绝不写成 done；一张都没完成时 output 保持 null，不生成空产物目录。
   * queued / waiting-session 的取消已由 cancel() 立即收尾（status 已是 cancelled），
   * 这里只补会话状态，不重复写 finishedAt、不覆盖已有 output。
   *
   * @param {object} job 被取消的任务
   * @param {{ startedAt?: number|null, results?: object[], modelId?: string|null }} [context]
   */
  async finalizeCancelled(job, { startedAt = null, results = [], modelId = null } = {}) {
    job.cancelRequested = true
    if (job.status === 'cancelled') {
      job.sessionState = sessionStateOf(this.session)
      if (job.finishedAt == null) job.finishedAt = isoNow()
      this.wakeWaiters(job.id)
      return
    }

    const completed = Array.isArray(results) ? results : []
    job.finishedAt = isoNow()
    if (Number.isFinite(startedAt)) job.seconds = Math.round((Date.now() - startedAt) / 100) / 10
    if (completed.length > 0 && !this.disposed) {
      job.output = await saveJobOutput(this.ctx, job, completed)
      job.modelId = modelId ?? job.modelId
    }
    job.status = 'cancelled'
    job.stage = '已取消'
    job.error = null
    job.sessionState = sessionStateOf(this.session)
    // 只记结构化摘要（jobId/张数），不记 prompt / negativePrompt 正文。
    log.info(
      `job_cancelled jobId=${job.id} disposition=cooperative images=${job.output?.images?.length ?? 0} ` +
        `total=${job.params.count}`,
    )
    this.wakeWaiters(job.id)
  }

  // ---- 等待 ---------------------------------------------------------------

  /** 唤醒并清理某个任务的全部等待者；同一 jobId 的等待者只唤醒一次。 */
  wakeWaiters(id) {
    const waiters = this.waiters.get(id)
    if (!waiters) return
    this.waiters.delete(id)
    for (const wake of waiters) wake()
  }

  /** 卸载时唤醒全部等待者，避免调用方永远挂在 pending Promise 上。 */
  wakeAllWaiters() {
    for (const id of [...this.waiters.keys()]) this.wakeWaiters(id)
  }

  /** 超时路径解除单个等待者登记（其他等待者不受影响）。 */
  removeWaiter(id, waiter) {
    const waiters = this.waiters.get(id)
    if (!waiters) return
    waiters.delete(waiter)
    if (waiters.size === 0) this.waiters.delete(id)
  }

  /**
   * 等待某个 job 结束；超时不抛错，返回当前快照。
   *
   * 事件驱动：任务进入终态时由 runNext 的收尾路径唤醒全部等待者。
   * 注册前先看一次当前状态（get 同步执行），覆盖「任务在 waitFor 之前已结束」的情况；
   * waitSeconds <= 0 或已终态时立即返回，不挂定时器。
   */
  async waitFor(id, waitSeconds = 0) {
    const current = this.get(id)
    if (!current) return null
    const seconds = Math.max(0, Math.min(600, Number(waitSeconds) || 0))
    if (seconds <= 0 || TERMINAL_STATUS.has(current.status) || this.disposed) return current

    return new Promise((resolve) => {
      let timer = null
      const finish = () => {
        if (timer) clearTimeout(timer)
        resolve(this.get(id))
      }
      timer = setTimeout(() => {
        this.removeWaiter(id, finish)
        finish()
      }, seconds * 1000)
      const waiters = this.waiters.get(id)
      if (waiters) waiters.add(finish)
      else this.waiters.set(id, new Set([finish]))
    })
  }

  dispose() {
    log.info(`dispose pending=${this.pending.length} running=${this.running?.id ?? 'none'}`)
    this.disposed = true
    this.pending = []
    this.abortController.abort(Object.assign(new Error('插件已卸载'), { code: 'disposed' }))
    // 先唤醒等待者再返回：卸载不应该让 waitFor 调用方挂到超时。
    this.wakeAllWaiters()
  }
}
