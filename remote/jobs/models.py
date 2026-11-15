"""异步 job 的领域模型：状态、实体、幂等键与失败分类。

为什么从 daemon.py 拆出来：``Job`` 的字段同时被 HTTP 层（``/generate`` 入队、``/job`` 轮询）、
worker 与 ``/health`` 的队列统计读写，定义留在入口文件时"谁可以改哪个字段"没有边界。搬进
本模块后，``store`` 只依赖实体，``runner`` 只依赖实体与异常，三者不再互相 import。

约定：
- 状态只用 ``JOB_STATUS_*`` 四个常量，禁止在别处写裸字符串（Host 按字面值分支）；
- 字段可变、不加 ``__slots__``：单测会直接构造并断言（``Job(...)`` 后改 ``status``）；
- 本模块不持锁——并发一致性由 ``remote/jobs/store.py`` 的 ``JobStore`` 负责。
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field

from pipeline_loader import is_oom_error
from remote.errors import LoadError, RequestError
from remote.text import short

# 保留策略：已结束的 job 按结束时间 FIFO 最多留 JOB_MAX_FINISHED 个、且 TTL JOB_TTL_SEC 秒；
# 排队中/运行中的 job 不淘汰。结果里是 base64 图片，所以数量上限同时也是内存上限。
JOB_MAX_FINISHED = 8
JOB_TTL_SEC = 600.0
JOB_ID_MAX_CHARS = 64
JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_DONE = "done"
JOB_STATUS_FAILED = "failed"


@dataclass
class Job:
    """一次 /generate 提交（异步执行）。所有字段读写都在 JobStore 的锁内。"""

    job_id: str
    model_id: str
    pipeline: dict
    tasks: list
    # job 级参考图（M3 图生图）：提交期校验后归一成
    # ``{image_bytes, strength, width, height}``；None 表示文生图，路径与行为完全不变。
    reference: dict | None = None
    status: str = JOB_STATUS_QUEUED
    results: list = field(default_factory=list)
    error: dict | None = None
    load_seconds: float | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    @property
    def total(self) -> int:
        return len(self.tasks)


def iso_time(ts: float) -> str:
    """UTC ISO8601（带 Z）。Host 只做展示与排序，不解析时区。"""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def new_job_id() -> str:
    return f"job-{int(time.time() * 1000):x}-{os.urandom(4).hex()}"


def normalize_job_id(value) -> str | None:  # noqa: ANN001
    """请求体里的可选幂等键：缺省/空串返回 None，格式非法抛 RequestError（→400）。"""
    if value is None:
        return None
    if not isinstance(value, str):
        raise RequestError("jobId 必须是字符串")
    text = value.strip()
    if not text:
        return None
    if len(text) > JOB_ID_MAX_CHARS or not JOB_ID_RE.match(text):
        raise RequestError("jobId 只能是 1~64 位的字母、数字、点、下划线或短横线")
    return text


def classify_failure(exc: BaseException, default: str = "generation_failed") -> tuple[str, str]:
    """异常 → (错误码, 文案)。错误码进 ``/health.last_error_code`` 与 job.error，Host 按码分支。"""
    message = short(exc, 800)
    if is_oom_error(exc):
        return "oom", f"显存不足：{message}"
    if isinstance(exc, RequestError):
        return "invalid_request", message
    if isinstance(exc, LoadError):
        return "load_failed", message
    return default, message
