"""JobStore：任务表、待执行队列与保留策略，锁与数据同笼。

为什么从 daemon.py 拆出来：``JOB_TABLE`` / ``JOB_QUEUE`` / ``JOB_FINISHED_ORDER`` 与
``JOB_LOCK`` / ``JOB_COND`` 原先散在模块顶层，任何函数都能绕过锁直接改表；``prune_jobs``
甚至要求"调用方必须持有 JOB_LOCK"——这条约定只能靠注释维持。搬进类之后：

- 锁与条件变量是私有成员，外部只能调语义方法（``submit`` / ``pop_next`` / ``finish`` …）
  或读只读视图（``queue_depth`` / ``payload``）；
- 保留策略（TTL + FIFO 上限）与容量拒绝（契约 ``limits.queue.maxPending``）只有一处实现；
- ``/health.queue_depth`` 从本对象取，不再从状态对象派生（架构规格 §5.9）。

**锁顺序（规格 §5.8，唯一方向 ``JOB_LOCK → STATE_LOCK``）**：本模块只碰自己的锁，绝不
在持锁时调用 daemon 的状态或锁；需要刷新 ``STATE.last_active`` 的收尾动作由调用方在
``finish()`` 返回之后做（见 daemon 的 ``_finish_job``）。
"""

from __future__ import annotations

import threading
import time
from collections import deque

from log_ring import log
from remote.errors import QueueFullError
from remote.jobs.models import (
    JOB_MAX_FINISHED,
    JOB_STATUS_DONE,
    JOB_STATUS_FAILED,
    JOB_STATUS_RUNNING,
    JOB_TTL_SEC,
    Job,
    iso_time,
    new_job_id,
)

# 允许排队的最大待执行 job 数（防止内存 DoS）；契约下发 limits.queue.maxPending 时以契约为准。
JOB_MAX_QUEUE_DEPTH = 16


class JobStore:
    """串行 job 的表与队列：入队幂等、容量拒绝、TTL/FIFO 淘汰、状态迁移。

    ``capacity`` 可以是整数或返回整数的回调：队列上限来自注入契约，而契约会在启动期
    被 ``load_config()`` 原地填充，所以用回调（``lambda: _max_queue_depth()``）每次取最新值。
    """

    def __init__(
        self,
        *,
        capacity=None,  # noqa: ANN001 - int | Callable[[], int] | None
        max_finished: int = JOB_MAX_FINISHED,
        ttl_sec: float = JOB_TTL_SEC,
        new_id=None,  # noqa: ANN001 - Callable[[], str] | None
        clock=time.time,
    ) -> None:
        self._lock = threading.RLock()
        self._cond = threading.Condition(self._lock)
        self._queue: deque[Job] = deque()
        self._jobs: dict[str, Job] = {}
        self._finished: deque[str] = deque()
        self._capacity = capacity
        self._max_finished = max_finished
        self._ttl_sec = ttl_sec
        self._new_id = new_id or new_job_id
        self._clock = clock

    # ---- 只读视图 ----

    def queue_depth(self) -> int:
        """``/health.queue_depth``：尚未开始执行的 job 数。"""
        with self._lock:
            return len(self._queue)

    def active_count(self) -> int:
        """排队 + 运行中的 job 数（空闲看门狗用它判断是否忙碌）。"""
        with self._lock:
            running = sum(1 for job in self._jobs.values() if job.status == JOB_STATUS_RUNNING)
            return len(self._queue) + running

    def count(self) -> int:
        """表内 job 总数（含已结束、未淘汰的），排障与单测用。"""
        with self._lock:
            return len(self._jobs)

    def get(self, job_id: str) -> Job | None:
        """按 id 取 job（顺带淘汰过期项）；未知 id 返回 None（→404）。"""
        with self._lock:
            self.prune()
            return self._jobs.get(job_id)

    def payload(self, job: Job) -> dict:
        """``GET /job`` 的响应体；results 只在 done 时给，其它状态为 null。"""
        with self._lock:
            done = len(job.results)
            return {
                "status": job.status,
                "job_id": job.job_id,
                "tool": job.tool,
                "model_id": job.model_id,
                "progress": {"done": done, "total": job.total},
                "created_at": iso_time(job.created_at),
                "updated_at": iso_time(job.updated_at),
                "load_seconds": job.load_seconds,
                "results": list(job.results) if job.status == JOB_STATUS_DONE else None,
                "error": dict(job.error) if job.error else None,
            }

    def is_finished(self, job: Job) -> bool:
        with self._lock:
            return job.status in (JOB_STATUS_DONE, JOB_STATUS_FAILED)

    def max_queue_depth(self) -> int:
        """当前生效的排队上限（契约可覆盖默认 16）。"""
        capacity = self._capacity
        if callable(capacity):
            capacity = capacity()
        if isinstance(capacity, int) and not isinstance(capacity, bool) and capacity > 0:
            return capacity
        return JOB_MAX_QUEUE_DEPTH

    # ---- 写入 ----

    def submit(
        self,
        pipeline_spec: dict,
        model_id: str,
        tasks: list[dict],
        job_id: str | None = None,
        reference: dict | None = None,
        tool: str = "generate",
        reference_images: dict | None = None,
    ):
        """入队；``job_id`` 命中已有 job 时原样返回（幂等，不重复入队）。

        ``reference`` 是提交期校验并归一过的参考图（见 ``parse_reference_spec``），
        文生图请求传 None；``tool`` 是请求工具（缺省 generate，upscale 走超分执行分支）。
        ``reference_images`` 是原生参考生图（supportsReference）的图片列表（见
        ``parse_reference_images``），与 ``reference`` 互斥；调用方（HTTP 层）负责先拦掉
        同时给出的请求，这里只存储，不做第二套语义判断。
        返回 ``(job, created)``：created=False 表示命中了幂等键（同一 jobId 无论 tool 如何，
        命中即返回原 job——幂等键语义不变）。
        """
        with self._cond:
            self.prune()
            if job_id:
                existing = self._jobs.get(job_id)
                if existing is not None:
                    return existing, False
            max_depth = self.max_queue_depth()
            if len(self._queue) >= max_depth:
                raise QueueFullError(f"远端任务队列已满（最多 {max_depth} 个排队任务），请稍后重试")
            job = Job(
                job_id=job_id or self._new_id(),
                model_id=str(model_id),
                pipeline=dict(pipeline_spec),
                tasks=list(tasks),
                tool=str(tool or "generate"),
                reference=dict(reference) if reference is not None else None,
                reference_images=(
                    dict(reference_images) if reference_images is not None else None
                ),
            )
            self._jobs[job.job_id] = job
            self._queue.append(job)
            queue_len = len(self._queue)
            self._cond.notify_all()
            reference_note = ""
            if job.reference is not None:
                reference_note = "，带参考图"
            elif job.reference_images is not None:
                count = len(job.reference_images.get("items") or [])
                reference_note = f"，带原生参考图 {count} 张"
            log(
                f"[job] 入队 {job.job_id}（tool={job.tool}，tasks={job.total}，排队 {queue_len}"
                f"{reference_note}）"
            )
            return job, True

    def pop_next(self, *, timeout: float = 0.5, should_stop=None):  # noqa: ANN001
        """取队首 job；队列空时循环等待，直到有任务或 ``should_stop()`` 为真（返回 None）。

        返回 None 而不是抛异常：worker 的退出信号（``/shutdown`` / SIGTERM）只需让循环
        条件变假，不必处理和空队列一样的"暂时没活"情形。

        ``timeout`` 是**单次等待的轮询间隔**，不是总预算：``timeout > 0`` 时每等满一个
        间隔就重新检查队列与停止信号，因此没有任务也不会返回（worker 靠它常驻，且
        ``/shutdown`` 最多迟一个间隔生效）；``timeout <= 0`` 只探一次、不阻塞（单测与
        "有没有活"的判断用它，避免空转）。
        """
        stop = should_stop or (lambda: False)
        with self._cond:
            while not self._queue:
                if stop() or timeout <= 0:
                    return None
                self._cond.wait(timeout=timeout)
            if stop():
                return None
            return self._queue.popleft()

    def mark_running(self, job: Job) -> None:
        """出队后置 running（worker 的唯一入口，保证状态与队列一致）。"""
        with self._lock:
            job.status = JOB_STATUS_RUNNING
            job.updated_at = self._clock()

    def update_progress(self, job: Job, partial: list[dict]) -> None:
        with self._lock:
            job.results = list(partial)
            job.updated_at = self._clock()

    def set_results(self, job: Job, results: list[dict]) -> None:
        with self._lock:
            job.results = list(results)

    def record_loaded(self, job: Job, load_seconds: float) -> None:
        with self._lock:
            job.load_seconds = load_seconds
            job.updated_at = self._clock()

    def clear_reference(self, job: Job) -> None:
        """解码完成后释放队列里保留的原始字节（job 公开视图不含参考图）。"""
        with self._lock:
            job.reference = None

    def clear_reference_images(self, job: Job) -> None:
        """原生参考图解码完成后释放原始字节（job 公开视图不含参考图）。"""
        with self._lock:
            job.reference_images = None

    def finish(self, job: Job, status: str, error: dict | None = None) -> float:
        """置终态、记结束时间、进淘汰队列并顺带淘汰；返回收尾时刻（供调用方刷新活动时间）。"""
        now = self._clock()
        with self._lock:
            job.status = status
            job.error = error
            job.updated_at = now
            job.finished_at = now
            self._finished.append(job.job_id)
            self.prune(now)
        return now

    def prune(self, now: float | None = None) -> None:
        """淘汰已结束 job：先 TTL，再数量上限 FIFO。排队/运行中的不淘汰。"""
        current = self._clock() if now is None else now
        while self._finished:
            job_id = self._finished[0]
            job = self._jobs.get(job_id)
            if job is None:
                self._finished.popleft()
                continue
            expired = job.finished_at is not None and current - job.finished_at >= self._ttl_sec
            overflow = len(self._finished) > self._max_finished
            if not expired and not overflow:
                break
            self._finished.popleft()
            self._jobs.pop(job_id, None)

    def notify(self) -> None:
        """唤醒等待中的 worker（入队与关停各调一次；条件变量是本类私有成员）。"""
        with self._cond:
            self._cond.notify_all()

    def wait_for_change(self, timeout: float | None = None) -> bool:
        with self._cond:
            return self._cond.wait(timeout=timeout)

    def clear(self) -> None:
        """清空队列与全表（单测夹具用：每个用例一份干净的表）。"""
        with self._lock:
            self._queue.clear()
            self._jobs.clear()
            self._finished.clear()
