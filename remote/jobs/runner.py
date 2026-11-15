"""JobRunner：串行 worker 循环与单 job 的错误兜底。

为什么从 daemon.py 拆出来：worker 循环（取单 → 执行 → 收尾 → 记日志）与出图执行是两件事，
前者只关心队列与停止信号，后者关心 pipeline、显存与图片。混在一起时"换掉执行方式"必须改
入口文件。拆开后循环只剩三步，且对执行细节一无所知。

**延迟解析约定**：``execute`` / ``should_stop`` / ``finish_job`` 都以回调形式注入，调用方
必须传 lambda（``lambda job: execute_job(job)``）而不是函数对象本身——`lambda` 在每次调用时
才解析模块属性，单测替换 ``daemon.execute_job`` 才能生效；直接传函数会把构造时刻的实现绑死
在实例上，断言会静默测到旧对象（架构规格 §5.10 的同一类坑）。

**锁顺序（§5.8）**：循环只通过 ``JobStore`` 的方法碰 ``JOB_LOCK``，不在此处嵌套 ``STATE_LOCK``；
收尾时的活动时间刷新由注入的 ``finish_job`` 负责（它先放 JOB 锁再取 STATE 锁）。
"""

from __future__ import annotations

import threading
import time

from log_ring import log
from remote.jobs.models import JOB_STATUS_FAILED
from remote.jobs.store import JobStore
from remote.text import short

# worker 空闲时的唤醒间隔：既是 /shutdown 的响应上限，也是队列空转的 CPU 上限。
WORKER_WAIT_SEC = 0.5


class JobRunner:
    """串行消费 ``JobStore`` 的队列；一次只跑一个 job（显存与生成锁决定的物理约束）。"""

    def __init__(
        self,
        store: JobStore,
        *,
        execute,  # noqa: ANN001 - Callable[[Job], None]
        should_stop,  # noqa: ANN001 - Callable[[], bool]
        finish_job,  # noqa: ANN001 - Callable[[Job, str, dict | None], None]
        wait_timeout: float = WORKER_WAIT_SEC,
        thread_name: str = "job-worker",
    ) -> None:
        self._store = store
        self._execute = execute
        self._should_stop = should_stop
        self._finish_job = finish_job
        self._wait_timeout = wait_timeout
        self._thread_name = thread_name

    def run_forever(self) -> None:
        """常驻循环：直到 ``should_stop()`` 为真才退出；单 job 异常绝不外泄。"""
        log("[job] worker 启动，等待队列")
        while not self._should_stop():
            job = self._store.pop_next(timeout=self._wait_timeout, should_stop=self._should_stop)
            if job is None:
                continue
            started = time.time()
            try:
                self._execute(job)
            except Exception as exc:  # pragma: no cover - execute 自身已兜底，这里是最后一道
                log(f"[job] worker 捕获异常：{short(exc)}")
                if not self._store.is_finished(job):
                    self._finish_job(job, JOB_STATUS_FAILED, {"code": "generation_failed", "message": short(exc)})
            log(f"[job] {job.job_id} 处理结束（{round(time.time() - started, 1)}s）")

    def start(self) -> threading.Thread:
        """拉起后台线程（daemon 常驻，不阻塞主循环）。"""
        thread = threading.Thread(target=self.run_forever, name=self._thread_name, daemon=True)
        thread.start()
        return thread
