/**
 * 出图任务队列（协议见 docs/SPEC.md 第 2.2 节）。
 *
 * 远端是单张 GPU 的常驻进程，并发提交只会互相排队并放大 OOM 概率，
 * 因此 Host 侧固定串行：同一时刻最多一个 running job。
 */

import { randomBytes } from 'node:crypto'

import { LIMITS, TIMEOUTS } from '../shared/contract.js'
import { createLogger } from './log.js'
import { saveJobOutput } from './output.js'
import { normalizeSaveTo } from './paths.js'
import { presetById } from './presets.js'
import { submitGenerate, waitForJob } from './remote.js'

const log = createLogger({ scope: 'jobs' })

/**
 * 日志只留脱敏摘要：错误/远端文案最多 200 字符，且掩掉 token、带 query 的 URL
 * 与用户目录绝对路径，避免把整段日志尾或隐私信息写进 Host 日志。
 * 调用方禁止把 prompt / negativePrompt 正文传进来（只传长度）。
 */
function logText(value, max = 200) {
  let text = String(value ?? '')
  text = text.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?<redacted>')
  text = text.replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
  text = text.replace(/\b(hf_|KGAT_|ghp_|sk-)[A-Za-z0-9_-]{6,}/g, '$1<redacted>')
  text = text.replace(/\b[0-9a-f]{32,}\b/gi, '<redacted>')
  text = text.replace(/\b(token|secret|password|authorization)\s*[=:]\s*[^\s,;&]+/gi, '$1=<redacted>')
  text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"'<>:]+/g, '<user-home>')
  text = text.replace(/\/(?:Users|home)\/[^/\s"'<>:]+/g, '<user-home>')
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 失败码/错误类型：日志只做分类，不写堆栈。 */
function errorKind(error) {
  return String(error?.code ?? error?.name ?? (error instanceof Error ? 'Error' : typeof error))
}

/** 测试替身可能没有 snapshot()：取状态失败时退化为 unknown，不影响任务路径。 */
function sessionStateOf(session) {
  try {
    return session?.snapshot?.()?.state ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function isoNow() {
  return new Date().toISOString()
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** 尺寸钳制：先钳到合法区间，再对齐到 LIMITS 约定的步长（8 的倍数）。 */
function normalizeDimension(value, fallback, limits = LIMITS.width) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const { min, max, step } = limits
  const clamped = Math.min(max, Math.max(min, Math.round(number)))
  return Math.round(clamped / step) * step
}

/**
 * 把任务异常折叠成对外错误（纯函数，便于离线断言）。
 *
 * 规则与拆分前逐字一致：
 *  - 会话失效（session_ended / health_failed）时保留会话错误码：出图请求的底层错误
 *    可能只是 fetch failed，直接标成 generate_failed 会掩盖真实原因；同理，没有远端
 *    错误码时优先展示会话给出的可读原因。
 *  - 等待会话期间用户关机：统一成 stopped，避免显示成 session_absent 这种看不出原因的文案。
 *
 * @param {*} error 任务执行中抛出的错误
 * @param {object} sessionSnapshot `SessionManager.snapshot()` 的结果
 * @param {{ started?: boolean, stoppedByUser?: boolean }} context
 *   started：任务是否已进入远端调用（job.startedAt 是否已写）；
 *   stoppedByUser：用户是否主动关机。
 * @returns {{ code: string, message: string }}
 */
export function describeJobError(error, sessionSnapshot, context = {}) {
  const sessionError = sessionSnapshot?.state === 'error' ? sessionSnapshot.error : null
  let code = error?.code ?? sessionError?.code ?? 'generate_failed'
  let message = (error?.code ? error?.message : null) ?? sessionError?.message ?? error?.message ?? error
  if (!context.started && context.stoppedByUser === true && (code === 'session_absent' || code === 'session_timeout')) {
    code = 'stopped'
    message = '会话已被手动关闭，任务未执行；请先在面板点「唤醒」后重试'
  }
  return { code, message: String(message).slice(0, 600) }
}

const SESSION_STAGE = {
  provisioning: '排队中',
  connecting: '建立隧道',
  warming: '加载模型',
  ready: '生成中',
  stopping: '正在停止',
  error: '会话失败',
}

/**
 * 取消信号：只在 Host 内部流转。
 *
 * 契约没有「job_cancelled」错误码，也不新增（复用 not_found / invalid_body / internal_error），
 * 所以取消不能伪装成普通 Error 冒泡到 runNext 的失败分支；用带 `cancelled` 标记的类表达。
 */
class JobCancelled extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'JobCancelled'
    this.cancelled = true
  }
}

function isCancellation(error) {
  return error instanceof JobCancelled || error?.cancelled === true
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
   * @param {object} request 见 docs/SPEC.md 第 2.2 节
   * @returns {{ ok: true, job: object } | { ok: false, code: string, message: string }}
   */
  submit(request = {}) {
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
    if (prompt.length === 0) {
      log.info(`enqueue_rejected code=invalid_prompt promptLen=0 pending=${this.pending.length}`)
      return { ok: false, code: 'invalid_prompt', message: 'prompt 不能为空' }
    }
    if (prompt.length > LIMITS.prompt.maxChars) {
      log.info(
        `enqueue_rejected code=invalid_prompt promptLen=${prompt.length} pending=${this.pending.length}`,
      )
      return { ok: false, code: 'invalid_prompt', message: `prompt 超过 ${LIMITS.prompt.maxChars} 字符` }
    }
    if (this.pending.length >= LIMITS.queue.maxPending) {
      log.info(
        `enqueue_rejected code=queue_full promptLen=${prompt.length} pending=${this.pending.length}`,
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

    const preset = presetById(request.presetId ?? this.defaultPreset)
    const seedInput = Number(request.seed)
    const seed =
      Number.isFinite(seedInput) && seedInput >= 0
        ? Math.round(seedInput) % LIMITS.seed.max
        : Math.floor(Math.random() * LIMITS.seed.max)

    const params = {
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

    const job = {
      id: `j_${randomBytes(4).toString('hex')}`,
      status: 'queued',
      stage: '排队中',
      presetId: preset.id,
      params,
      // 工作区交付目标（已归一成 POSIX 相对路径）；null 表示只写 imagen-output 归档。
      saveTo,
      createdAt: isoNow(),
      startedAt: null,
      finishedAt: null,
      seconds: null,
      sessionState: this.session.snapshot().state,
      modelId: preset.repo,
      output: null,
      error: null,
      autoStart: request.autoStart !== false,
    }

    this.jobs.push(job)
    this.pending.push(job)
    this.trim()
    // 只记 prompt 长度：提示词正文与 negativePrompt 正文不得进日志。
    log.info(
      `enqueue jobId=${job.id} presetId=${job.presetId} size=${params.width}x${params.height} ` +
        `steps=${params.steps} count=${params.count} promptLen=${params.prompt.length} pending=${this.pending.length}`,
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
        `remote_generate_start jobId=${job.id} presetId=${job.presetId} count=${job.params.count} timeoutMs=${this.options.generateTimeoutMs}`,
      )
      let generated
      try {
        generated = await this.generate(job)
      } catch (error) {
        if (isCancellation(error)) {
          log.info(`remote_generate_cancelled jobId=${job.id} elapsedMs=${Date.now() - generateStartedAt}`)
        } else {
          log.warn(
            `remote_generate_failed jobId=${job.id} elapsedMs=${Date.now() - generateStartedAt} ` +
              `count=${job.params.count} code=${errorKind(error)} message=${logText(error?.message)}`,
          )
        }
        throw error
      }
      const { results, modelId } = generated
      log.info(
        `remote_generate_done jobId=${job.id} elapsedMs=${Date.now() - generateStartedAt} ` +
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
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  /**
   * 单张任务的远端载荷：`tasks` 只含 1 项，幂等键 `<宿主 job.id>-<两位序号>`。
   *
   * 逐张提交是合作式取消的前提：一张完成后才提交下一张，取消时不再提交剩余张数。
   * daemon 的 jobId 只接受字母/数字/点/下划线/短横线且 ≤64 字符，这里的键满足该约束。
   */
  taskPayload(job, preset, index) {
    const params = job.params
    return {
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
  }

  /**
   * 逐张提交远端异步任务并轮询到完成（每张一个远端 job）。
   *
   * 轮询容错、失败退避、同幂等键重投、整体预算全部复用 `waitForJob`：
   * 重投时用同一张的 payload（同一 jobId），daemon 命中幂等键返回原 job，不重复出图。
   * 每完成一张：results.push、job.progress 更新、job.stage 保持旧语义（done+1 表示正在出第几张）。
   * 每张开始前检查 cancelRequested：已取消就跳出，不再提交剩余张数。
   *
   * 错误对象与文案固定：session_absent（连接不可用）/ empty_result（无图片）；
   * 远端任务的失败码（oom / load_failed / generation_failed …）原样透传。
   *
   * @param {object} job 已排队的任务（含 presetId / params / id / stage）
   * @returns {Promise<{ results: object[], modelId: string|null, cancelled: boolean }>}
   */
  async generate(job) {
    const { endpoint, token } = this.session.connection()
    if (!endpoint || !token) throw Object.assign(new Error('远端连接不可用'), { code: 'session_absent' })

    const preset = presetById(job.presetId)
    const params = job.params
    const total = params.count
    const results = []
    let modelId = null
    // 进入远端调用即给出 0/N 的结构化进度，客户端不用等第一次轮询才有进度数据。
    job.progress = { done: 0, total }
    // 整体预算：逐张提交只是把一批拆成 N 个远端 job，预算仍按整个宿主任务计算，
    // 避免「每张各自 10 分钟」把整体耗时放大 N 倍。
    const deadline = Date.now() + this.options.generateTimeoutMs

    for (let index = 0; index < total; index += 1) {
      // 合作式中止点：一张开始前检查取消标记，置位后剩余张数不再提交。
      if (job.cancelRequested || this.disposed) break

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw Object.assign(
          new Error(`等待远端生成超时（${Math.round(this.options.generateTimeoutMs / 1000)} 秒）`),
          { code: 'generate_failed' },
        )
      }

      job.progress = { done: results.length, total }
      job.stage = total > 1 ? `生成中 ${Math.min(results.length + 1, total)}/${total}` : '生成中'

      const payload = this.taskPayload(job, preset, index)
      const submitted = await submitGenerate(endpoint, token, payload, TIMEOUTS.remoteSubmitMs, this.ctx)
      job.remoteJobId = submitted.job_id

      const response = await waitForJob(endpoint, token, submitted.job_id, {
        timeoutMs: remainingMs,
        // 测试可把这些时序调小；生产不传时由 waitForJob 回落到 contract 默认值。
        pollMs: this.options.pollMs,
        failureGraceMs: this.options.pollFailureGraceMs,
        backoffMaxMs: this.options.pollBackoffMaxMs,
        resumeMaxAttempts: this.options.resumeMaxAttempts,
        ctx: this.ctx,
        // 隧道重建超过容忍窗口后，用同一张的幂等键重投：命中则接回原 job，不重复入队。
        resubmit: async () => {
          const resumed = await submitGenerate(endpoint, token, payload, TIMEOUTS.remoteSubmitMs, this.ctx)
          job.remoteJobId = resumed.job_id
          log.warn(`remote_resume jobId=${job.id} remoteJobId=${resumed.job_id} index=${index + 1}/${total}`)
          return resumed.job_id
        },
        onProgress: (snapshot) => {
          const remoteDone = Number(snapshot?.progress?.done)
          const withinImage = Number.isFinite(remoteDone) ? Math.max(0, Math.min(1, Math.round(remoteDone))) : 0
          const done = Math.min(total, results.length + withinImage)
          // stage 文本保持旧语义（done+1 表示「正在出第几张」），结构化 progress 给准确完成数。
          job.progress = { done, total }
          job.stage = total > 1 ? `生成中 ${Math.min(done + 1, total)}/${total}` : '生成中'
        },
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
    job.finishedAt = isoNow()
    job.seconds = Math.round((Date.now() - startedAt) / 100) / 10
    job.output = await saveJobOutput(this.ctx, job, results)
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
    if (completed.length > 0) {
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
    // 先唤醒等待者再返回：卸载不应该让 waitFor 调用方挂到超时。
    this.wakeAllWaiters()
  }
}
