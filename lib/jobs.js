/**
 * 出图任务队列（协议见 docs/SPEC.md 第 2.2 节）。
 *
 * 远端是单张 GPU 的常驻进程，并发提交只会互相排队并放大 OOM 概率，
 * 因此 Host 侧固定串行：同一时刻最多一个 running job。
 */

import { randomBytes } from 'node:crypto'

import { LIMITS, TIMEOUTS } from '../shared/contract.js'
import { saveJobOutput } from './output.js'
import { presetById } from './presets.js'
import { submitGenerate, waitForJob } from './remote.js'

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

export class JobQueue {
  constructor({ ctx, session, defaultPreset, options = {} }) {
    this.ctx = ctx
    this.session = session
    this.defaultPreset = defaultPreset
    this.options = {
      sessionWaitMs: TIMEOUTS.sessionWaitMs,
      generateTimeoutMs: TIMEOUTS.remoteJobMs,
      ...options,
    }
    this.jobs = []
    this.pending = []
    this.running = null
    this.disposed = false
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
      if (job.status === 'done' || job.status === 'failed') return this.publicView(job)
    }
    return null
  }

  queueStats() {
    return { running: this.running?.id ?? null, pending: this.pending.length }
  }

  publicView(job) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
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
    if (prompt.length === 0) return { ok: false, code: 'invalid_prompt', message: 'prompt 不能为空' }
    if (prompt.length > LIMITS.prompt.maxChars) {
      return { ok: false, code: 'invalid_prompt', message: `prompt 超过 ${LIMITS.prompt.maxChars} 字符` }
    }
    if (this.pending.length >= LIMITS.queue.maxPending) {
      return { ok: false, code: 'queue_full', message: '队列已满，请等待当前任务完成' }
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

  // ---- 执行 ---------------------------------------------------------------

  /** 队列记账与串行占位：把任务交给 runJob，失败统一折叠成 job.error。 */
  async runNext() {
    if (this.disposed || this.running || this.pending.length === 0) return
    const job = this.pending.shift()
    this.running = job

    try {
      await this.runJob(job)
    } catch (error) {
      job.status = 'failed'
      job.stage = '失败'
      job.finishedAt = isoNow()
      job.error = describeJobError(error, this.session.snapshot(), {
        started: Boolean(job.startedAt),
        stoppedByUser: this.session.stoppedByUser === true,
      })
    } finally {
      this.running = null
      if (!this.disposed) void this.runNext()
    }
  }

  /** 会话等待 + 远端调用；成功路径的落盘与收尾交给 persistResult。 */
  async runJob(job) {
    if (this.session.isReady) {
      job.sessionState = 'ready'
    } else {
      job.status = 'waiting-session'
      job.stage = '准备远端会话'
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
      }
      job.sessionState = this.session.snapshot().state
      await this.session.ensureReady({
        timeoutMs: this.options.sessionWaitMs,
        onTick: (state) => {
          job.sessionState = state.state
          job.stage = SESSION_STAGE[state.state] ?? job.stage
        },
      })
    }

    const { endpoint, token } = this.session.connection()
    if (!endpoint || !token) throw Object.assign(new Error('远端连接不可用'), { code: 'session_absent' })

    const startedAt = Date.now()
    job.status = 'running'
    job.stage = '生成中'
    job.startedAt = isoNow()

    // 远端载荷构造与传输都在本队列的 generate 里，远端协议细节不进路由层。
    const { results, modelId } = await this.generate(job)

    await this.persistResult(job, results, { startedAt, modelId })
  }

  /**
   * 组装远端载荷、提交异步任务并轮询到完成。
   *
   * 远端 `POST /generate` 只做校验与入队（立即返回 job_id），长耗时的采样发生在远端
   * 队列里；Host 每 `TIMEOUTS.remoteJobPollMs` 查一次 `GET /job`，期间单次轮询失败
   * 会被容忍（隧道抖动不该把已算好的图判死）。整体预算由 `generateTimeoutMs` 控制。
   *
   * 错误对象与文案固定：session_absent（连接不可用）/ empty_result（无图片）；
   * 远端任务的失败码（oom / load_failed / generation_failed …）原样透传。
   *
   * @param {object} job 已排队的任务（含 presetId / params / id / stage）
   * @returns {Promise<{ results: object[], modelId: string }>}
   */
  async generate(job) {
    const { endpoint, token } = this.session.connection()
    if (!endpoint || !token) throw Object.assign(new Error('远端连接不可用'), { code: 'session_absent' })

    const preset = presetById(job.presetId)
    const params = job.params
    const tasks = Array.from({ length: params.count }, (_, index) => ({
      name: String(index + 1).padStart(2, '0'),
      prompt: params.prompt,
      negative_prompt: params.negativePrompt,
      // 同批多张按序号递增 seed；超过契约上界时环形回绕，避免远端按 seed>max 直接 400。
      seed: (params.seed + index) % LIMITS.seed.max,
      width: params.width,
      height: params.height,
      steps: params.steps,
      cfg: params.cfg,
    }))

    // job.id 作为幂等键：提交响应丢失后重试不会在远端产出重复任务。
    const submitted = await submitGenerate(
      endpoint,
      token,
      { pipeline: preset.pipeline, modelId: preset.repo, jobId: job.id, tasks },
      TIMEOUTS.remoteSubmitMs,
      this.ctx,
    )
    job.remoteJobId = submitted.job_id

    const response = await waitForJob(endpoint, token, submitted.job_id, {
      timeoutMs: this.options.generateTimeoutMs,
      ctx: this.ctx,
      onProgress: (snapshot) => {
        const done = Number(snapshot?.progress?.done)
        const total = Number(snapshot?.progress?.total) || params.count
        if (Number.isFinite(done) && total > 1) {
          job.stage = `生成中 ${Math.min(done + 1, total)}/${total}`
        } else {
          job.stage = '生成中'
        }
      },
    })
    return { results: response.results, modelId: response.model_id ?? preset.repo }
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

  /** 等待某个 job 结束；超时不抛错，返回当前快照。 */
  async waitFor(id, waitSeconds = 0) {
    const deadline = Date.now() + Math.max(0, Math.min(600, Number(waitSeconds) || 0)) * 1000
    let job = this.get(id)
    while (job && (job.status === 'queued' || job.status === 'waiting-session' || job.status === 'running')) {
      if (waitSeconds <= 0 || Date.now() >= deadline) return job
      await new Promise((resolve) => setTimeout(resolve, 700))
      job = this.get(id)
    }
    return job
  }

  dispose() {
    this.disposed = true
    this.pending = []
  }
}
