#!/usr/bin/env python3
"""远端推理 Daemon（协议 v2）。

运行位置：Kaggle GPU Kernel 容器内，由 Host 通过 ``kaggle kernels push`` 拉起。
协议字段以 ``docs/SPEC.md`` 与本文档顶部说明为准，本文件是 Daemon 侧唯一实现。

设计要点（第 1–6 条各对应一次实测故障，第 7–9 条为 0.3.1 起的加固项）：

1. 模块顶层只依赖标准库。HTTP 服务必须**先**起来，pip 安装与模型加载放在后台线程里，
   否则排队 30 分钟才启动的 Kernel 在装依赖期间完全不可观测，Host 只能看到超时。
   ``/health`` 的 ``phase`` 字段（booting / installing / loading / ready / error）
   就是给 Host 区分 warming 与 ready 用的。
2. 日志环保留最近 ``LOG_MAX_LINES`` 行，pip 输出、模型加载输出、cloudflared stderr
   全部入环，Host 用 ``GET /logs?since=N`` 增量拉取，用户才能看到"正在装依赖"而不是干等。
3. cloudflared 的 stderr 必须由**独立线程持续读取**。拿到 trycloudflare 地址后如果停止读取，
   管道写满会让 cloudflared 卡死，隧道随后失效。
4. 向 ntfy 发布必须用 ``Content-Type: text/plain``、正文是 JSON 字符串。
   用 ``application/json`` 会被 ntfy 当成发布指令（publish 指令）解析并失败。
5. 生成持锁串行；错误按 oom / load_failed / invalid_request / generation_failed 分类，
   OOM 先 ``torch.cuda.empty_cache()`` 再回错，让 Host 可以原样重试。
6. 没有 ``auth_token`` 时不对外服务：``/health`` 等路由一律 401，启动阶段直接
   ``fail_boot('unauthorized')`` 并退出（不发布 ready）。本地调试必须显式配置
   ``allow_no_auth: true``，避免"配置注入失败 → 公网隧道变成无鉴权端点"。
7. 隧道只是会合通道，进程必须自愈：cloudflared 中途退出时 Host 想重连也没用，
   所以 daemon 内有常驻监管线程负责重拉、重播 ready，且每 ``TUNNEL_ANNOUNCE_SEC``
   秒重播一次；``/health`` 的 ``tunnel_state`` / ``tunnel_restarts`` 用于排障。
8. 冷启动失败要能归因：pip 装完必须做 import 自检（装成功 ≠ 能 import），
   依赖约束、HF_TOKEN 与磁盘预检都在下载/加载前完成，失败给出可读原因。
9. 权重可以来自预挂载的 Kaggle Dataset：``local_models`` 命中的仓库优先本地加载，
   既省冷启动下载时间，也彻底避开 HuggingFace 匿名限流。
10. **0.5.0 异步 job**：``POST /generate`` 只校验+入队，立即 202 返回 ``job_id``；
   常驻 worker 线程串行执行，Host 用 ``GET /job?id=`` 轮询。同步长请求在
   Cloudflare quick tunnel / 本地代理上会被判成响应空闲中途掐断（表现为
   cloudflared ``context canceled``），80s 级的模型必中；拆成短请求后，任何一层
   代理或隧道都不会再因为「长时间零字节」丢掉整次生成。
"""

from __future__ import annotations

import base64
import gc
import hmac
import inspect
import io
import json
import os
import platform
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 1024² 的 VAE 解码单次申请约 5 GiB 连续显存：必须在任何 torch / CUDA 初始化之前设置，
# 让分配器用可扩展段减少碎片（T4 14.56GiB 首跑正是在 VAE conv3d 处 OOM）。
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# ─────────────────────────────────────────────────────────────────────────────
# Host 注入点：推送 Kernel 前，Host 会按 "EMBEDDED_CONFIG_B64" 这个变量名的整行赋值做一次
# 精确字符串替换。这一行必须保持「变量名 = 空字符串」的原始形态，不要加类型注解、
# 不要换引号、不要拆行；本文件里只出现一次。
# ─────────────────────────────────────────────────────────────────────────────
EMBEDDED_CONFIG_B64 = ""

VERSION = "0.5.0"

# 日志环容量：Host 侧按 docs/SPEC.md 实现，最多 400 行。
LOG_MAX_LINES = 400
LOG_LINE_MAX_CHARS = 2000

DEFAULT_PORT = 7860
CLOUDFLARED_PATH = "/tmp/cloudflared"
CLOUDFLARED_DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
)
CLOUDFLARED_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
# 备用通道（自建 FRP / bore 等）默认从进程输出里抓 https 地址；Host 可用
# fallback_tunnel_url_regex 覆盖（例如自签名域名或带路径的地址）。
DEFAULT_CUSTOM_URL_RE = re.compile(r"https://[^\s\"'<>]+")
TUNNEL_WAIT_SEC = 120.0
# P0.2 隧道自愈：进程异常退出后按指数退避重拉（2s 起、60s 封顶），
# 并每 TUNNEL_ANNOUNCE_SEC 秒重播一次 ready，帮助 Host 在心跳丢失后重新会合。
TUNNEL_RESTART_BASE_SEC = 2.0
TUNNEL_RESTART_MAX_SEC = 60.0
TUNNEL_ANNOUNCE_SEC = 300.0
TUNNEL_PROVIDERS = ("cloudflare", "custom")

# 与 bench/lightning/run.py 完全一致：镜像自带 torchao 0.10.0 与新版 diffusers 冲突，
# 必须先卸载；随后升级这 4 个包。
PIP_UNINSTALL = ("torchao",)
PIP_INSTALL = ("diffusers", "transformers", "accelerate", "peft")

# 依赖约束默认留空（0.4.1 修正）。0.4.0 曾内置「版本上限」做固化
# （diffusers<1.0 / transformers<5 / accelerate<2 / peft<1），实测与当前 diffusers
# 新版直接冲突：diffusers 0.42+ 依赖 huggingface-hub>=1.32，而 transformers 4.x
# 要求 huggingface-hub<1.0，pip 只能回溯到 2019 年的 transformers 4.12.2；在
# Kaggle 镜像存在预装包时解析直接失败（远端表现 load_failed: pip install 退出码 1）。
# 需要固定版本时用 Host 的 `pipConstraints` 显式钉一组自己验证过的组合；默认装
# 最新兼容组合，再用导入自检兜底。
PIP_CONSTRAINTS: dict[str, str] = {}
IMPORT_CHECK_MODULES = ("torch", "diffusers", "transformers", "accelerate", "peft")
# 磁盘预检在估算值上留 15% 余量：下载缓存、解压临时文件也会占空间。
DISK_HEADROOM = 1.15

SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2", "anima")

# ─────────────────────────────────────────────────────────────────────────────
# 异步 job 协议（0.5.0）
#
# POST /generate 只做校验与入队，立即 202 返回；常驻 worker 线程串行执行，
# Host 用 GET /job?id= 轮询。原因：同步长请求在 Cloudflare quick tunnel /
# 本地代理链路上会被判成「响应空闲」中途掐断（cloudflared context canceled），
# 一张图 80s 以上的模型必中。拆成短请求 + 轮询后，任何一层都不会被长连接拖住。
#
# 保留策略：已结束的 job 按结束时间 FIFO 最多留 JOB_MAX_FINISHED 个、且 TTL
# JOB_TTL_SEC 秒；排队中/运行中的 job 不淘汰。结果里是 base64 图片，所以
# 数量上限同时也是内存上限。
# ─────────────────────────────────────────────────────────────────────────────
JOB_MAX_FINISHED = 8
JOB_TTL_SEC = 600.0
JOB_ID_MAX_CHARS = 64
JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_DONE = "done"
JOB_STATUS_FAILED = "failed"

# ─────────────────────────────────────────────────────────────────────────────
# 日志环
# ─────────────────────────────────────────────────────────────────────────────

_START_TS = time.time()
_ORIG_STDOUT = sys.stdout
_ORIG_STDERR = sys.stderr

_LOG_LOCK = threading.Lock()
_LOG_LINES: deque[str] = deque(maxlen=LOG_MAX_LINES)
_LOG_SEQ = 0  # 已写入的总行数；它同时就是 /logs 返回的 next

# tqdm / pip 的进度条用 \r 反复覆盖同一行，入环没有意义且会把有效信息挤掉。
_NOISE_RE = re.compile(r"(\d+%\|)|(\d+\.\d+\s*(?:it|s|B|KB|MB)/s)|(━{4,})|(B/s\])")


def _elapsed() -> float:
    return time.time() - _START_TS


def _ring_append(text: str) -> None:
    global _LOG_SEQ
    if not text:
        return
    if len(text) > LOG_LINE_MAX_CHARS:
        text = text[:LOG_LINE_MAX_CHARS] + " …(已截断)"
    with _LOG_LOCK:
        _LOG_LINES.append(text)
        _LOG_SEQ += 1


def _console(text: str) -> None:
    """只写 Kernel 控制台，不进日志环。"""
    try:
        _ORIG_STDOUT.write(text + "\n")
        _ORIG_STDOUT.flush()
    except Exception:
        pass


def log(*args) -> None:
    """同时进日志环与控制台。所有进度都要走这里，Host 才看得到。"""
    text = " ".join(str(a) for a in args)
    for piece in re.split(r"[\r\n]+", text):
        piece = piece.strip()
        if not piece or _NOISE_RE.search(piece):
            continue
        line = f"[{_elapsed():8.1f}s] {piece}"
        _ring_append(line)
        _console(line)


class _StreamTee:
    """把第三方库（tqdm、transformers、diffusers、huggingface_hub）的输出抄送到日志环。

    pip 是子进程，单独按行读取；这里处理的是同进程内库直接 print 的情况。
    """

    def __init__(self, original, name: str):
        self._original = original
        self._name = name

    def write(self, data):  # noqa: ANN001 - 兼容任意 file-like
        try:
            self._original.write(data)
            self._original.flush()
        except Exception:
            pass
        if data:
            for piece in re.split(r"[\r\n]+", str(data)):
                piece = piece.strip()
                if piece and not _NOISE_RE.search(piece):
                    _ring_append(f"[{_elapsed():8.1f}s] {piece}")
        return len(data) if data else 0

    def flush(self):
        try:
            self._original.flush()
        except Exception:
            pass

    def isatty(self) -> bool:
        try:
            return bool(self._original.isatty())
        except Exception:
            return False

    def writelines(self, lines):  # noqa: ANN001
        for line in lines:
            self.write(line)

    def __getattr__(self, name):
        return getattr(self._original, name)


def install_stream_tee() -> None:
    if not isinstance(sys.stdout, _StreamTee):
        sys.stdout = _StreamTee(_ORIG_STDOUT, "stdout")  # type: ignore[assignment]
    if not isinstance(sys.stderr, _StreamTee):
        sys.stderr = _StreamTee(_ORIG_STDERR, "stderr")  # type: ignore[assignment]


def log_since(since: int) -> tuple[list[str], int]:
    """返回序号 > since 的日志行与最新的 next。

    行序号从 1 开始；环形缓冲只保留最近 LOG_MAX_LINES 行。since 早于缓冲起点时
    直接返回当前全部内容（Host 侧按 next 继续拉即可，不会重复也不会丢尾）。
    """
    with _LOG_LOCK:
        total = _LOG_SEQ
        snapshot = list(_LOG_LINES)
    if not snapshot:
        return [], total
    first_seq = total - len(snapshot) + 1
    lines = [line for offset, line in enumerate(snapshot) if first_seq + offset > since]
    return lines, total


# ─────────────────────────────────────────────────────────────────────────────
# 显式状态对象
#
# 历史：配置、运行期资源、统计与生命周期原先塞在同一个模块级 dict 里（23 个键），
# 无法在单测里构造隔离实例。现在拆成三个 dataclass：
#   CONFIG —— Host 注入的配置，启动后只读；
#   STATE  —— 运行期状态（生命周期 / 模型 / 统计）；
#   BOOT   —— 启动期隧道会合状态；
# 生成串行锁单独成模块级 GEN_LOCK，避免"锁"混进可复制的状态对象。
# 约定：除本区块外全文件只用属性访问（STATE.phase / BOOT.tunnel_url / CONFIG.port）。
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class DaemonConfig:
    """Host 注入的配置。键名即字段名；ntfy_server / port / allow_no_auth 仅本地调试或旧 Host 使用。

    Host 实际下发的键由 lib/session/provisioner.js 的 buildKernelConfig 组装。
    """

    auth_token: str = ""
    ntfy_topic: str = ""
    ntfy_server: str = "https://ntfy.sh"
    idle_timeout_sec: int = 1800
    port: int = DEFAULT_PORT
    preload: dict | None = None
    preset_id: str | None = None
    log_level: str = "info"
    version: str = ""
    contract: dict = field(default_factory=dict)
    # 本地调试专用：显式允许无鉴权（默认 false；正常路径必须带 auth_token）。
    allow_no_auth: bool = False
    # 冷启动可靠性（P1.2）：HF Token 只写环境变量，值不落日志；pip 约束按包名合并。
    hf_token: str = ""
    pip_constraints: list = field(default_factory=list)
    # 备用隧道（P2.2）：argv 模板（{port} 占位）与地址提取正则。
    fallback_tunnel_command: list = field(default_factory=list)
    fallback_tunnel_url_regex: str = ""
    # 权重预挂载（P2.1）：HF 仓库 → 容器内本地目录（Kaggle Dataset 挂载路径）。
    local_models: dict = field(default_factory=dict)


@dataclass
class RuntimeState:
    """运行期状态：生命周期、模型句柄与统计。"""

    phase: str = "booting"
    detail: str | None = "进程启动"
    model_id: str | None = None
    loaded: list = field(default_factory=list)
    device: str | None = None
    device_count: int = 0
    last_active: float = _START_TS
    jobs_done: int = 0
    last_error: str | None = None
    last_error_code: str | None = None
    started_at: float = _START_TS
    pipe: object | None = None
    pipeline_key: str | None = None
    sig_params: set = field(default_factory=set)
    waiting: int = 0
    shutting_down: bool = False


@dataclass
class Job:
    """一次 /generate 提交（异步执行）。所有字段读写都在 JOB_LOCK 保护下。"""

    job_id: str
    model_id: str
    pipeline: dict
    tasks: list
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


@dataclass
class BootState:
    """启动期会合状态：隧道与 ready 发布。"""

    tunnel_url: str | None = None
    tunnel_error: str | None = None
    cloudflared: object | None = None
    published_ready: bool = False
    # P0.2：隧道监管状态（/health 与 ready 事件对外上报）。
    tunnel_provider: str | None = None
    tunnel_state: str = "starting"
    tunnel_restarts: int = 0
    # 隧道失败把 phase 打成 error 时记下原阶段；隧道恢复后还原，避免 Host 一直看到 error。
    phase_before_error: str | None = None
    # /shutdown 或信号置位后监管线程退出。整个进程只创建一个 Event。
    stop_event: threading.Event = field(default_factory=threading.Event)


CONFIG = DaemonConfig()
STATE = RuntimeState()
BOOT = BootState()
# 生成串行锁；不放状态对象里，避免状态复制时复制锁。
GEN_LOCK = threading.Lock()

# 异步 job 表：队列（待执行）/ 全表（含运行中与已结束）/ 结束顺序（淘汰用）。
JOB_LOCK = threading.RLock()
JOB_QUEUE: deque = deque()
JOB_TABLE: dict[str, Job] = {}
JOB_FINISHED_ORDER: deque = deque()
JOB_WAKE = threading.Event()


class RequestError(ValueError):
    """请求本身不合法 → HTTP 400 invalid_request。"""


class LoadError(RuntimeError):
    """模型加载失败 → HTTP 500 load_failed。"""


def short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    text = " ".join(text.split())
    return text[:limit]


def set_phase(phase: str, detail: str | None = None) -> None:
    STATE.phase = phase
    STATE.detail = detail
    # 启动阶段的进度也算"活动"，避免依赖安装还没结束就被空闲看门狗收走。
    STATE.last_active = time.time()
    log(f"[phase] {phase}" + (f" — {detail}" if detail else ""))


def record_error(code: str, message: str) -> None:
    """``/health.last_error`` 是字符串：Host 直接拼进 UI，对象会显示成 [object Object]。"""
    STATE.last_error = f"{code}: {message}"
    STATE.last_error_code = code


# ── 异步 job：表、队列与轮询视图（协议 0.5.0） ────────────────────────────────


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


def prune_jobs(now: float | None = None) -> None:
    """淘汰已结束 job：先 TTL，再数量上限 FIFO。调用方必须持有 JOB_LOCK。"""
    current = time.time() if now is None else now
    while JOB_FINISHED_ORDER:
        job_id = JOB_FINISHED_ORDER[0]
        job = JOB_TABLE.get(job_id)
        if job is None:
            JOB_FINISHED_ORDER.popleft()
            continue
        expired = job.finished_at is not None and current - job.finished_at >= JOB_TTL_SEC
        overflow = len(JOB_FINISHED_ORDER) > JOB_MAX_FINISHED
        if not expired and not overflow:
            break
        JOB_FINISHED_ORDER.popleft()
        JOB_TABLE.pop(job_id, None)


def submit_job(pipeline_spec: dict, model_id: str, tasks: list[dict], job_id: str | None = None):
    """入队；``job_id`` 命中已有 job 时原样返回（幂等，不重复入队）。

    返回 ``(job, created)``：created=False 表示命中了幂等键。
    """
    with JOB_LOCK:
        prune_jobs()
        if job_id:
            existing = JOB_TABLE.get(job_id)
            if existing is not None:
                return existing, False
        job = Job(
            job_id=job_id or new_job_id(),
            model_id=str(model_id),
            pipeline=dict(pipeline_spec),
            tasks=list(tasks),
        )
        JOB_TABLE[job.job_id] = job
        JOB_QUEUE.append(job)
        queue_len = len(JOB_QUEUE)
        JOB_WAKE.set()
        log(f"[job] 入队 {job.job_id}（tasks={job.total}，排队 {queue_len}）")
        return job, True


def get_job(job_id: str) -> Job | None:
    with JOB_LOCK:
        prune_jobs()
        return JOB_TABLE.get(job_id)


def queue_depth() -> int:
    """``/health.queue_depth``：尚未开始执行的 job 数。"""
    with JOB_LOCK:
        return len(JOB_QUEUE)


def active_job_count() -> int:
    """排队 + 运行中的 job 数（空闲看门狗用它判断是否忙碌）。"""
    with JOB_LOCK:
        running = sum(1 for job in JOB_TABLE.values() if job.status == JOB_STATUS_RUNNING)
        return len(JOB_QUEUE) + running


def job_payload(job: Job) -> dict:
    """``GET /job`` 的响应体；results 只在 done 时给，其它状态为 null。"""
    with JOB_LOCK:
        done = len(job.results)
        return {
            "status": job.status,
            "job_id": job.job_id,
            "model_id": job.model_id,
            "progress": {"done": done, "total": job.total},
            "created_at": iso_time(job.created_at),
            "updated_at": iso_time(job.updated_at),
            "load_seconds": job.load_seconds,
            "results": list(job.results) if job.status == JOB_STATUS_DONE else None,
            "error": dict(job.error) if job.error else None,
        }


def fail_boot(code: str, message: str, *, tunnel: bool = False) -> None:
    """启动阶段失败的唯一出口：记录错误 → phase=error → 尽力通过 ntfy 告知 Host。

    收敛原先散落在 tunnel_boot / runtime_boot 的 6 处同构代码；调用方只给错误码与文案
    （错误码与文案逐字保持原样，Host 按 code 分支）。``tunnel=True`` 时额外记下
    隧道错误原因，供启动等待逻辑复用。
    """
    if tunnel:
        BOOT.tunnel_error = message
    record_error(code, message)
    set_phase("error", message)
    publish_error(code, message)


def protocol_version() -> str:
    """对外版本号：优先注入契约的 version，其次注入的 version，最后本文件的 VERSION。

    Host 的 check-contract 按 ``CONFIG.contract.version`` 对齐；本地调试没有注入时退回常量。
    """
    candidates = [CONFIG.contract.get("version") if isinstance(CONFIG.contract, dict) else None, CONFIG.version]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return VERSION


# ─────────────────────────────────────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────────────────────────────────────


# 注入配置的精确键名（= DaemonConfig 字段名）。Host 侧由 lib/session/provisioner.js 组装；
# ntfy_server / port / allow_no_auth 只给本地调试或旧 Host 使用。未登记的键只告警、不猜别名。
_KNOWN_CONFIG_KEYS = frozenset(
    {
        "auth_token",
        "ntfy_topic",
        "ntfy_server",
        "idle_timeout_sec",
        "port",
        "preload",
        "preset_id",
        "log_level",
        "version",
        "contract",
        "allow_no_auth",
        "hf_token",
        "pip_constraints",
        "fallback_tunnel_command",
        "fallback_tunnel_url_regex",
        "local_models",
    }
)


def normalize_pip_constraints(raw) -> list[str]:  # noqa: ANN001
    """Host 注入的 pip 约束：只保留非空字符串（数组或单个字符串）。"""
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        if raw is not None:
            log("[config] pip_constraints 不是数组，已忽略")
        return []
    constraints: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            constraints.append(item.strip())
        elif item is not None:
            log("[config] WARN pip_constraints 中的非字符串项已忽略")
    return constraints


def normalize_fallback_command(raw) -> list[str]:  # noqa: ANN001
    """Host 注入的备用隧道 argv 模板：逐项过滤空串/非字符串。"""
    if not isinstance(raw, (list, tuple)):
        if raw is not None:
            log("[config] fallback_tunnel_command 不是数组，已忽略")
        return []
    command: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            command.append(item)
        elif item is not None:
            log("[config] WARN fallback_tunnel_command 中的非字符串项已忽略")
    return command


def normalize_local_models(raw) -> dict[str, str]:  # noqa: ANN001
    """Host 注入的权重预挂载映射：repo → 容器内目录；非法项过滤并告警。"""
    if not isinstance(raw, dict):
        if raw is not None:
            log("[config] local_models 不是对象，已忽略")
        return {}
    models: dict[str, str] = {}
    for repo, path in raw.items():
        if isinstance(repo, str) and repo.strip() and isinstance(path, str) and path.strip():
            models[repo.strip()] = path.strip()
        else:
            log("[config] WARN local_models 中的非法映射已忽略（值应是目录字符串）")
    return models


def _build_config(cfg: dict) -> DaemonConfig:
    """注入 dict → DaemonConfig。未知键打日志（不再静默丢弃），敏感值不落日志。"""
    config = DaemonConfig()
    config.auth_token = str(cfg.get("auth_token") or "")
    config.ntfy_topic = str(cfg.get("ntfy_topic") or "")
    config.ntfy_server = str(cfg.get("ntfy_server") or "https://ntfy.sh").rstrip("/")
    try:
        config.idle_timeout_sec = int(cfg.get("idle_timeout_sec", 1800))
    except (TypeError, ValueError):
        config.idle_timeout_sec = 1800
    try:
        config.port = int(cfg.get("port", DEFAULT_PORT))
    except (TypeError, ValueError):
        config.port = DEFAULT_PORT
    preload = cfg.get("preload")
    # preload 必须是 /generate 里同形状的 pipeline 描述对象（含 loader/base）；
    # Daemon 不认识预设 id，Host 已经在注入前把预设展开成对象。
    config.preload = preload if isinstance(preload, dict) and preload.get("loader") else None
    if preload is not None and config.preload is None:
        log("[config] preload 不是 pipeline 描述对象，已忽略（Host 应下发 {loader, base, ...}）")
    config.preset_id = cfg.get("preset_id")
    config.log_level = str(cfg.get("log_level") or "info")
    config.version = str(cfg.get("version") or "")
    contract = cfg.get("contract")
    config.contract = contract if isinstance(contract, dict) else {}
    if contract is not None and not config.contract:
        log("[config] contract 不是 JSON 对象，已忽略")
    if not config.contract:
        log("[config] WARN 未收到 contract，参数边界回退到内置默认值（兼容旧 Host）")
    config.allow_no_auth = bool(cfg.get("allow_no_auth", False))
    if config.allow_no_auth:
        log("[config] WARN allow_no_auth=true：无 auth_token 也放行请求，仅限本地调试")
    # P1.2 / P2.1 / P2.2：可选注入项。令牌与权重路径都不进日志（只打开关与数量）。
    config.hf_token = str(cfg.get("hf_token") or "").strip()
    config.pip_constraints = normalize_pip_constraints(cfg.get("pip_constraints"))
    config.fallback_tunnel_command = normalize_fallback_command(cfg.get("fallback_tunnel_command"))
    config.fallback_tunnel_url_regex = str(cfg.get("fallback_tunnel_url_regex") or "").strip()
    config.local_models = normalize_local_models(cfg.get("local_models"))
    unknown = sorted(set(cfg) - _KNOWN_CONFIG_KEYS)
    if unknown:
        log(f"[config] WARN 未知配置键已忽略：{', '.join(unknown)}")
    # 配置项名可以打日志，值不行（含 token）。
    log(f"[config] 已加载配置项：{', '.join(sorted(cfg.keys())) or '(空)'}")
    log(
        f"[config] idle_timeout={config.idle_timeout_sec}s port={config.port} "
        f"ntfy={'on' if config.ntfy_topic else 'off'} auth={'on' if config.auth_token else 'off'} "
        f"preload={config.preload.get('loader') if config.preload else 'none'} "
        f"preset={config.preset_id or 'none'} log_level={config.log_level} "
        f"version={config.version or 'none'} contract={'on' if config.contract else 'off'} "
        f"allow_no_auth={'on' if config.allow_no_auth else 'off'} "
        f"hf_token={'on' if config.hf_token else 'off'} "
        f"pip_constraints={len(config.pip_constraints)} "
        f"fallback_tunnel={'on' if config.fallback_tunnel_command else 'off'} "
        f"local_models={len(config.local_models)}"
    )
    return config


def load_config() -> DaemonConfig:
    """读取 Host 注入的配置；环境变量 IMAGEN_CONFIG_B64 作为兜底（本地调试用）。"""
    raw_b64 = (EMBEDDED_CONFIG_B64 or os.environ.get("IMAGEN_CONFIG_B64") or "").strip()
    if not raw_b64:
        log("[config] 未收到注入配置；本地调试需显式配置 allow_no_auth=true，否则启动会拒绝服务")
        return DaemonConfig()
    try:
        raw = base64.b64decode(raw_b64.encode("ascii")).decode("utf-8")
        cfg = json.loads(raw)
    except Exception as exc:
        # 只报异常类型，绝不把配置内容写进日志（里面含 auth_token）。
        raise SystemExit(f"配置解析失败：{type(exc).__name__}: {exc}") from None
    if not isinstance(cfg, dict):
        raise SystemExit("配置必须是 JSON 对象")
    return _build_config(cfg)


def auth_missing() -> bool:
    """既没有 auth_token 又没显式允许无鉴权 —— 必须拒绝启动的危险配置。"""
    return not CONFIG.auth_token and not CONFIG.allow_no_auth


def apply_hf_token() -> bool:
    """把 hf_token 写进 HuggingFace 官方约定的两个环境变量（值不落日志）。

    gated 仓库与匿名限流都需要它；huggingface_hub 优先读环境变量，所以不需要
    把它传进每个下载调用。
    """
    token = (CONFIG.hf_token or "").strip()
    if not token:
        return False
    os.environ["HF_TOKEN"] = token
    os.environ["HUGGING_FACE_HUB_TOKEN"] = token
    log("[config] 已配置 HF_TOKEN / HUGGING_FACE_HUB_TOKEN（值不写入日志）")
    return True


# ─────────────────────────────────────────────────────────────────────────────
# ntfy 会合点
# ─────────────────────────────────────────────────────────────────────────────


def ntfy_publish(payload: dict, label: str) -> bool:
    """发布一条 JSON 字符串到 ntfy topic。

    关键：Content-Type 必须是 text/plain。ntfy 对 application/json 会走"发布指令"
    （publish directives）解析路径，普通 JSON 会被判成非法指令而失败（已实测）。
    """
    topic = CONFIG.ntfy_topic
    if not topic:
        log(f"[ntfy] 未配置 topic，跳过 {label} 发布")
        return False
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    url = f"{CONFIG.ntfy_server}/{urllib.parse.quote(topic)}"
    for attempt in range(1, 4):
        try:
            request = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "text/plain",
                    "User-Agent": f"imagen-daemon/{protocol_version()}",
                },
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                response.read()
            log(f"[ntfy] {label} 已发布（{len(body)} 字节）")
            return True
        except Exception as exc:
            log(f"[ntfy] {label} 第 {attempt} 次发布失败：{type(exc).__name__}: {exc}")
            time.sleep(2 * attempt)
    log(f"[ntfy] {label} 发布最终失败，Host 侧需要靠超时兜底")
    return False


def publish_ready() -> None:
    payload = {
        "type": "ready",
        "endpoint": BOOT.tunnel_url,
        # P2.2：Host 据此展示通道类型，并决定可信域校验策略。
        "provider": BOOT.tunnel_provider,
        "model_id": STATE.model_id,
        "device": STATE.device,
    }
    ntfy_publish(payload, "ready")


def publish_error(code: str, message: str) -> None:
    payload = {"type": "error", "code": code, "message": message[:800]}
    ntfy_publish(payload, f"error({code})")


def request_shutdown() -> None:
    """收到 /shutdown：标记停机并让隧道监管线程退出（进程随后由调用方安排退出）。"""
    STATE.shutting_down = True
    BOOT.stop_event.set()
    log("[shutdown] 收到 /shutdown，0.3s 后退出进程")


# ─────────────────────────────────────────────────────────────────────────────
# 依赖安装
# ─────────────────────────────────────────────────────────────────────────────


def _stream_process(argv: list[str], prefix: str, tail_lines: int = 0) -> tuple[int, list[str]]:
    """跑子进程并把每一行输出写进日志环；可选返回尾部若干行供错误文案使用。"""
    log(f"{prefix} $ {' '.join(argv)}")
    env = dict(os.environ)
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("PIP_NO_INPUT", "1")
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
    except Exception as exc:
        log(f"{prefix} 启动失败：{short(exc)}")
        return -1, []
    assert proc.stdout is not None
    tail: deque[str] = deque(maxlen=tail_lines) if tail_lines > 0 else deque(maxlen=0)
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        log(f"{prefix} {line}")
        if tail_lines > 0:
            tail.append(line)
    code = proc.wait()
    log(f"{prefix} 退出码 {code}")
    return code, list(tail)


def run_streaming(argv: list[str], prefix: str) -> int:
    """跑子进程并把每一行输出写进日志环（pip 必须可见，否则用户以为卡死）。"""
    return _stream_process(argv, prefix)[0]


def run_streaming_tail(argv: list[str], prefix: str, tail_lines: int = 12) -> tuple[int, list[str]]:
    """同 run_streaming，但额外返回末尾若干行输出，用于把失败原因带进错误文案。"""
    return _stream_process(argv, prefix, tail_lines)


def tail_summary(lines: list[str], limit: int = 560) -> str:
    """把子进程尾部输出压成一行，供 LoadError 文案；保留最后几条最有用的行。"""
    meaningful = [line.strip() for line in lines if isinstance(line, str) and line.strip()]
    if not meaningful:
        return "无输出"
    text = " | ".join(meaningful[-6:])
    return text if len(text) <= limit else "…" + text[-(limit - 1) :]


def package_name(spec: str) -> str:
    """从 pip 约束表达式取包名（``diffusers<1.0`` → ``diffusers``），按 PEP 503 归一化。"""
    match = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)", str(spec or ""))
    if not match:
        return ""
    return re.sub(r"[-_.]+", "-", match.group(1)).lower()


def merge_pip_constraints(injected) -> list[str]:  # noqa: ANN001
    """默认约束按包名合并 Host 注入项：同名覆盖（保持原位置），新包追加。"""
    specs = dict(PIP_CONSTRAINTS)
    for item in normalize_pip_constraints(injected):
        name = package_name(item)
        if name:
            specs[name] = item
        else:
            log(f"[pip] WARN 无法识别包名的约束已忽略：{item}")
    return list(specs.values())


def write_constraints_file(constraints: list[str], directory: str | None = None) -> str:
    """把最终约束写成 pip ``-c`` 文件；目录缺省时用系统临时目录。"""
    directory = directory or tempfile.mkdtemp(prefix="imagen-constraints-")
    path = os.path.join(directory, "constraints.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(constraints))
        handle.write("\n")
    return path


# 独立进程做 import 自检：pip 显示安装成功 ≠ 能 import（ABI 不匹配、依赖冲突都在这暴露）。
# 除模块本身外再导入一次 DiffusionPipeline：版本组合不兼容时，它往往在模块级就抛错。
IMPORT_CHECK_CODE = (
    "import importlib\n"
    "for name in ('torch', 'diffusers', 'transformers', 'accelerate', 'peft'):\n"
    "    module = importlib.import_module(name)\n"
    "    print(name + '==' + str(getattr(module, '__version__', 'unknown')))\n"
    "from diffusers import DiffusionPipeline\n"
    "print('DiffusionPipeline ok')\n"
)


def run_command_tail(argv: list[str], prefix: str, tail_lines: int = 20) -> tuple[int, list[str]]:
    """跑一次性子进程并把输出写进日志环，返回退出码与尾部若干行（供错误文案）。"""
    log(f"{prefix} $ {' '.join(argv)}")
    env = dict(os.environ)
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("PIP_NO_INPUT", "1")
    try:
        proc = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=600,
            env=env,
        )
    except Exception as exc:
        log(f"{prefix} 启动失败：{short(exc)}")
        return -1, [short(exc)]
    lines = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    for line in lines:
        log(f"{prefix} {line}")
    return proc.returncode, lines[-tail_lines:]


def verify_dependencies() -> None:
    """安装后导入自检；失败抛 LoadError（由 runtime_boot 转成 load_failed）。"""
    code, tail = run_command_tail([sys.executable, "-c", IMPORT_CHECK_CODE], "[verify]")
    if code != 0:
        detail = " / ".join(tail[-3:]) if tail else "无输出"
        raise LoadError(f"依赖导入自检失败（退出码 {code}）：{detail}")
    log("[verify] 依赖导入自检通过")


def install_dependencies() -> None:
    """按 bench/lightning/run.py 已验证过的顺序处理依赖。

    安装策略（0.4.1）：
      1. 默认不钉版本，装最新兼容组合 —— 硬编码版本上限会与 diffusers 新版的
         huggingface-hub 要求冲突（见 PIP_CONSTRAINTS 注释）；
      2. 用户在 Host 配置了 `pipConstraints` 时带 `-c` 安装；若带约束解析失败，
         自动去掉约束重试一次，并在日志里说明，避免一次错误配置把整个会话卡死；
      3. 安装失败时把 pip 输出的最后几行带进 LoadError，界面能直接看到原因。
    """
    set_phase("installing", "卸载 torchao 并升级 diffusers 相关依赖")
    run_streaming(
        [sys.executable, "-m", "pip", "uninstall", "-y", "-q", *PIP_UNINSTALL],
        "[pip]",
    )
    constraints = merge_pip_constraints(CONFIG.pip_constraints)
    plain_argv = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "-U",
        "--progress-bar",
        "off",
        *PIP_INSTALL,
    ]
    if constraints:
        constraints_path = write_constraints_file(constraints)
        # 约束本身不含敏感信息，完整打印便于对照「为什么装的是这个版本」。
        log(f"[pip] 依赖约束（Host 注入）：{' | '.join(constraints)}")
        install_argv = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-U",
            "--progress-bar",
            "off",
            "-c",
            constraints_path,
            *PIP_INSTALL,
        ]
    else:
        log("[pip] 未配置版本约束：安装最新兼容组合（需要复现时用 pipConstraints 钉死已验证版本）")
        install_argv = plain_argv

    code, tail = run_streaming_tail(install_argv, "[pip]", 12)
    if code != 0 and constraints:
        log(f"[pip] WARN 带约束安装失败（退出码 {code}）：{tail_summary(tail)}")
        log("[pip] 去掉约束重试一次；成功后本次会话按最新兼容组合运行")
        code, tail = run_streaming_tail(plain_argv, "[pip]", 12)
        if code == 0:
            log("[pip] WARN 未使用版本约束安装成功：如需固定版本，请修正 pipConstraints")
    if code != 0:
        raise LoadError(f"pip install 失败（退出码 {code}）：{tail_summary(tail)}")
    verify_dependencies()


# ─────────────────────────────────────────────────────────────────────────────
# 模型加载
# ─────────────────────────────────────────────────────────────────────────────


def _is_oom(exc: BaseException) -> bool:
    name = type(exc).__name__
    text = f"{name}: {exc}".lower()
    return (
        name in ("OutOfMemoryError", "CudaOutOfMemoryError")
        or "out of memory" in text
        or "insufficient memory" in text
        or "cuda error: out of memory" in text
    )


def free_cuda_cache() -> None:
    """OOM 之后先清缓存再回错，让 Host 的重试有救。"""
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            log("[cuda] 已执行 empty_cache()")
    except Exception as exc:  # torch 没装好也不该盖掉原始错误
        log(f"[cuda] empty_cache 失败：{short(exc)}")


def resolve_local_model(repo: str) -> str | None:
    """repo 命中 local_models 且目录含 model_index.json 时返回本地目录。

    预挂载目录可能因为 Dataset 版本切换而缺少关键文件，此时不能硬用本地路径，
    必须回退在线加载，否则会把「权重没挂对」变成一次难排查的加载失败。
    """
    key = str(repo or "").strip()
    path = CONFIG.local_models.get(key)
    if not path:
        return None
    if os.path.isfile(os.path.join(path, "model_index.json")):
        return path
    log(f"[load] WARN 预挂载目录缺少 model_index.json，回退在线加载：{path}")
    return None


def resolve_local_weight(repo: str, weight_name: str) -> str | None:
    """LoRA 仓库命中预挂载且权重文件存在时返回本地文件路径。"""
    key = str(repo or "").strip()
    name = str(weight_name or "").strip()
    path = CONFIG.local_models.get(key)
    if not path or not name:
        return None
    try:
        base = os.path.normpath(path)
        candidate = os.path.normpath(os.path.join(path, name))
        inside = os.path.commonpath([base, candidate]) == base
    except (ValueError, OSError):
        inside = False
    if not inside:
        log(f"[load] WARN LoRA 权重路径越出预挂载目录，已忽略：{name}")
        return None
    if os.path.isfile(candidate):
        return candidate
    log(f"[load] 预挂载目录未找到 LoRA 权重 {name}，回退在线下载：{path}")
    return None


def local_model_dir(repo: str) -> str | None:
    """repo 命中 local_models 且目录存在时返回该目录（不要求 model_index.json）。

    anima 这类「单文件权重 + 独立组件」的仓库在预挂载目录里没有 model_index.json，
    resolve_local_model 会判定未命中，这里补一个只看目录是否存在的判定。
    """
    path = CONFIG.local_models.get(str(repo or "").strip())
    if path and os.path.isdir(path):
        return path
    return None


def anima_local_assets(pipeline_spec: dict) -> dict[str, str]:
    """把 anima 的四个资产解析成预挂载路径；未命中的键留给在线下载。

    键：``dit`` / ``te`` 是单文件权重路径，``vae`` / ``tokenizers`` 是仓库根目录。
    """
    assets: dict[str, str] = {}
    dit_weight = resolve_local_weight(
        str(pipeline_spec.get("base") or ""), str(pipeline_spec.get("weight") or "")
    )
    if dit_weight:
        assets["dit"] = dit_weight
    text_encoder = pipeline_spec.get("textEncoder") or {}
    te_weight = resolve_local_weight(
        str(text_encoder.get("repo") or ""), str(text_encoder.get("weight") or "")
    )
    if te_weight:
        assets["te"] = te_weight
    vae = pipeline_spec.get("vae") or {}
    vae_subfolder = str(vae.get("subfolder") or "").strip().strip("/")
    vae_root = local_model_dir(str(vae.get("repo") or ""))
    if vae_root and os.path.isfile(os.path.join(vae_root, vae_subfolder or ".", "config.json")):
        assets["vae"] = vae_root
    tokenizers = pipeline_spec.get("tokenizers") or {}
    tokenizer_root = local_model_dir(str(tokenizers.get("repo") or ""))
    if tokenizer_root and os.path.isdir(os.path.join(tokenizer_root, "qwen25_tokenizer")):
        assets["tokenizers"] = tokenizer_root
    return assets


def required_download_gb(pipeline_spec: dict) -> float | None:
    """按 pipeline spec 的 downloadGb 估算下载需求（含 15% 余量）；缺失/非法返回 None。"""
    raw = pipeline_spec.get("downloadGb")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw <= 0:
        return None
    return round(float(raw) * DISK_HEADROOM, 2)


def disk_usage_root() -> str:
    """Kaggle 容器里权重落在 /kaggle/working；其他环境（本地调试）退回当前目录。"""
    return "/kaggle/working" if os.path.isdir("/kaggle/working") else os.getcwd()


def disk_precheck(pipeline_spec: dict, root: str | None = None, usage=None) -> dict | None:  # noqa: ANN001
    """磁盘预检：返回 ``{required_gb, free_gb, path, enough}``；没有体积信息时返回 None。"""
    required = required_download_gb(pipeline_spec)
    if required is None:
        return None
    target = root or disk_usage_root()
    read_usage = usage or shutil.disk_usage
    try:
        info = read_usage(target)
    except Exception as exc:
        # 读不到剩余空间不应该拦住加载，只留排障线索。
        log(f"[load] WARN 无法读取磁盘剩余空间（跳过预检）：{short(exc)}")
        return None
    free_gb = round(float(getattr(info, "free", 0)) / 2**30, 2)
    return {"required_gb": required, "free_gb": free_gb, "path": target, "enough": free_gb >= required}


def disk_usage_text(result: dict) -> str:
    return f"需 {result['required_gb']:.1f} GiB / 可用 {result['free_gb']:.1f} GiB"


def ensure_disk_capacity(pipeline_spec: dict) -> None:
    """下载前磁盘预检：Flux.2 全量权重会撑爆 Kaggle 20GB 空间；预挂载时跳过。"""
    if resolve_local_model(str(pipeline_spec.get("base") or "")):
        log("[load] 底座已预挂载本地权重，跳过磁盘预检")
        return
    result = disk_precheck(pipeline_spec)
    if result is None:
        return
    if result["enough"]:
        log(f"[load] 磁盘预检通过：{disk_usage_text(result)}（{result['path']}）")
        return
    raise LoadError(
        f"磁盘空间不足（{pipeline_spec.get('base')}）：{disk_usage_text(result)}（{result['path']}）"
    )


def _prefetch_weights(base: str, allow_patterns) -> None:  # noqa: ANN001
    """按白名单预拉取，避免整仓下载把 /kaggle/working 的 20GB 配额写爆。"""
    if not allow_patterns:
        log(f"[load] 未配置 allowPatterns，跳过预下载：{base}")
        return
    try:
        from huggingface_hub import snapshot_download

        started = time.time()
        log(f"[load] 预下载 {base}（白名单 {len(allow_patterns)} 条）…")
        snapshot_download(base, allow_patterns=list(allow_patterns))
        log(f"[load] 预下载完成，用时 {round(time.time() - started, 1)}s")
    except Exception as exc:
        # 预下载只是加速与控盘手段，失败后继续尝试直接 from_pretrained。
        log(f"[load] 预下载失败（继续直接加载）：{short(exc)}")


def _from_pretrained(factory, base: str, kwargs: dict, loader: str):  # noqa: ANN001
    """fp16 变体缺失时回退到默认权重；OOM 不重试，直接抛给上层分类。"""
    attempts = [dict(kwargs)]
    if kwargs.get("variant"):
        attempts.append({k: v for k, v in kwargs.items() if k != "variant"})
    last: Exception | None = None
    for index, attempt in enumerate(attempts, start=1):
        try:
            log(
                f"[load] from_pretrained({base}) 第 {index} 次："
                f"variant={attempt.get('variant')} device_map={attempt.get('device_map')}"
            )
            return factory.from_pretrained(base, **attempt)
        except Exception as exc:
            last = exc
            if _is_oom(exc):
                raise
            log(f"[load] 第 {index} 次加载失败：{short(exc)}")
    raise LoadError(f"{loader} 加载 {base} 失败：{short(last) if last else '未知原因'}")


# ─────────────────────────────────────────────────────────────────────────────
# anima：Johnny-Z/Anima-Light-Lavender 运行时（自包含实现，两处逐字同步）
#
# 目标模型是单文件 ComfyUI checkpoint：Cosmos-Predict2 MiniTrainDIT 2B（28 层、
# model_channels=2048、16 头、patch=2、in/out 16 通道、crossattn 1024、adaln 256）
# + Anima LLMAdapter（embed 32128→1024，6 层 16 头），权重 tensor 前缀 "net."；
# 文本编码器是 Qwen3-0.6B（权重前缀 "model."），VAE 是 Qwen-Image 的
# AutoencoderKLQwenImage，分词器是 demo Space 里的 Qwen2 + T5 两套。
#
# 本段是对上游 demo Space（hugging-apps/anima-light-lavender-demo）app.py 的直译，
# 对应 ComfyUI 的 comfy/ldm/cosmos/predict2.py、comfy/ldm/anima/model.py、
# comfy/model_sampling.py 与 CFGZeroStar；不需要 trust_remote_code，也不执行外部脚本。
#
# 维护约定（docs/MODEL_ASSET_SPEC.md 第 4 节）：remote/daemon.py 与
# tools/payload/verify-model.py 各有一份，必须逐字同步（Kaggle 只接受单个 code_file，
# 不能抽公共模块）。
# ─────────────────────────────────────────────────────────────────────────────


def _anima_toolkit(shift=3.0):
    """anima 的纯 PyTorch 模型定义与文本/采样工具（返回 dict，供 load_anima_runtime 使用）。

    只在函数内 import torch：daemon / verify payload 的模块顶层都必须只依赖标准库。
    ``shift`` 是 flow-matching 时间步 shift，调用方从 pipeline.shift 传入（默认 3.0）。
    """
    import json
    import math
    import re

    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    # Qwen-Image / Wan2.1 latent 统计量（comfy/latent_formats.py: Wan21）
    latents_mean = [
        -0.7571, -0.7089, -0.9113, 0.1075, -0.1745, 0.9653, -0.1517, 1.5508,
        0.4134, -0.0715, 0.5517, -0.3632, -0.1922, -0.9497, 0.2503, -0.2921,
    ]
    latents_std = [
        2.8184, 1.4541, 2.3275, 2.6558, 1.2196, 1.7708, 2.6052, 2.0743,
        3.2687, 2.1526, 2.8652, 1.5579, 1.6382, 1.1253, 2.8251, 1.9160,
    ]
    # flow-matching 时间步 shift 由参数传入（模型卡 / anima.json：simple 调度、shift=3.0）

    class _RMSNorm(nn.Module):
        """RMSNorm 等价实现：归一化在 float32 里算，乘 float32 权重后再转回输入 dtype。

        state_dict 与 nn.RMSNorm 完全一致（只有 weight，形状 [dim]）；fp16 下不会因为
        x.pow(2) 溢出/下溢把输出打成 inf/NaN。
        """

        def __init__(self, dim, eps=1e-6):
            super().__init__()
            self.eps = eps
            self.weight = nn.Parameter(torch.ones(dim))

        def forward(self, x):
            xf = x.float()
            normed = xf * torch.rsqrt(xf.pow(2).mean(dim=-1, keepdim=True) + self.eps)
            return (normed * self.weight.float()).to(x.dtype)

    class _LayerNormNoAffine(nn.Module):
        """LayerNorm(elementwise_affine=False) 等价实现：均值/方差都在 float32 里算。"""

        def __init__(self, dim, eps=1e-6):
            super().__init__()
            self.dim = dim
            self.eps = eps

        def forward(self, x):
            xf = x.float()
            mean = xf.mean(dim=-1, keepdim=True)
            var = (xf - mean).pow(2).mean(dim=-1, keepdim=True)
            return ((xf - mean) * torch.rsqrt(var + self.eps)).to(x.dtype)

    # ---- 结构化 Danbooru caption（comfyui-zako-pe DanbooruCaptionJSON）----
    literal_open = "\x00"
    literal_close = "\x01"
    paren_re = re.compile(r"\(([^()]*)\)")
    weight_re = re.compile(r"^.+:\s*[+-]?\d*\.?\d+\s*$")

    def escape_group(match):
        if weight_re.match(match.group(1)):
            return match.group(0)
        return "\\(" + match.group(1) + "\\)"

    def escape_prompt_text(text):
        """把普通括号转义成字面量，避免被下面的 ComfyUI 权重解析当成 (tag:1.1) 强调组。"""
        if "(" not in text:
            return text
        while True:
            masked = text.replace("\\(", literal_open).replace("\\)", literal_close)
            escaped = paren_re.sub(escape_group, masked)
            escaped = escaped.replace(literal_open, "\\(").replace(literal_close, "\\)")
            if escaped == text:
                return text
            text = escaped

    def build_caption(prompt):
        """自由文本 → 结构化 caption JSON（year 2025 / preference_level best）。"""
        document = {
            "year": 2025,
            "preference_level": "best",
            "image_description": str(prompt or "").strip(),
        }
        text = json.dumps(document, ensure_ascii=False, indent=2)
        text = text.replace("\\\\", "\\")
        return escape_prompt_text(text)

    # ---- ComfyUI prompt 权重解析（comfy/sd1_clip.py）----
    def parse_parentheses(string):
        result, current_item, nesting_level = [], "", 0
        for char in string:
            if char == "(":
                if nesting_level == 0:
                    if current_item:
                        result.append(current_item)
                    current_item = "("
                else:
                    current_item += char
                nesting_level += 1
            elif char == ")":
                nesting_level -= 1
                if nesting_level == 0:
                    result.append(current_item + ")")
                    current_item = ""
                else:
                    current_item += char
            else:
                current_item += char
        if current_item:
            result.append(current_item)
        return result

    def token_weights(string, current_weight):
        out = []
        for item in parse_parentheses(string):
            weight = current_weight
            if len(item) >= 2 and item[-1] == ")" and item[0] == "(":
                item = item[1:-1]
                split = item.rfind(":")
                weight *= 1.1
                if split > 0:
                    try:
                        weight = float(item[split + 1:])
                        item = item[:split]
                    except Exception:
                        pass
                out += token_weights(item, weight)
            else:
                out += [(item, current_weight)]
        return out

    def escape_important(text):
        return text.replace("\\)", "\0\1").replace("\\(", "\0\2")

    def unescape_important(text):
        return text.replace("\0\1", ")").replace("\0\2", "(")

    def tokenize(text, qwen_tokenizer, t5_tokenizer):
        """ComfyUI anima 文本编码：Qwen 词表 + T5 词表（同一段文本带权重标记）。"""
        parsed = token_weights(escape_important(str(text or "")), 1.0)
        qwen_ids, t5_ids, t5_weights = [], [], []
        for segment, weight in parsed:
            segment = unescape_important(segment)
            if segment == "":
                continue
            qwen_ids += qwen_tokenizer(segment)["input_ids"]
            tokens = t5_tokenizer(segment)["input_ids"][:-1]  # 去掉 T5 的 </s>
            t5_ids += tokens
            t5_weights += [weight] * len(tokens)
        if len(qwen_ids) == 0:
            qwen_ids = [151643]  # Qwen pad token，对齐 ComfyUI 的 min_length=1
        t5_ids.append(1)  # </s>
        t5_weights.append(1.0)
        return qwen_ids, t5_ids, t5_weights

    # ---- flow-matching 采样（comfy/model_sampling.py、comfy/samplers.py）----
    def time_snr_shift(alpha, timestep):
        return alpha * timestep / (1 + (alpha - 1) * timestep)

    all_sigmas = [
        float(value)
        for value in time_snr_shift(shift, torch.arange(1, 1001, dtype=torch.float32) / 1000)
    ]

    def simple_scheduler(steps):
        """simple 调度：在 shift 后的 sigma 网格上等距取 steps 个点，末尾补 0。"""
        counts = max(1, int(steps))
        stride = len(all_sigmas) / counts
        sigmas = [all_sigmas[-(1 + int(index * stride))] for index in range(counts)]
        return torch.tensor(sigmas + [0.0], dtype=torch.float32)

    # ---- Cosmos-Predict2 3D RoPE（comfy/ldm/cosmos/position_embedding.py）----
    def build_rope_3d(
        num_t, num_h, num_w, head_dim=128, h_ratio=4.0, w_ratio=4.0, t_ratio=1.0, device="cuda"
    ):
        dim_h = head_dim // 6 * 2
        dim_w = dim_h
        dim_t = head_dim - 2 * dim_h
        spatial_range = torch.arange(0, dim_h, 2, device=device)[: dim_h // 2].float() / dim_h
        temporal_range = torch.arange(0, dim_t, 2, device=device)[: dim_t // 2].float() / dim_t

        h_theta = 10000.0 * (h_ratio ** (dim_h / (dim_h - 2)))
        w_theta = 10000.0 * (w_ratio ** (dim_w / (dim_w - 2)))
        t_theta = 10000.0 * (t_ratio ** (dim_t / (dim_t - 2)))

        h_freqs = 1.0 / (h_theta ** spatial_range)
        w_freqs = 1.0 / (w_theta ** spatial_range)
        t_freqs = 1.0 / (t_theta ** temporal_range)

        seq = torch.arange(max(num_h, num_w, num_t), dtype=torch.float32, device=device)
        e_h = torch.outer(seq[:num_h], h_freqs)
        e_w = torch.outer(seq[:num_w], w_freqs)
        e_t = torch.outer(seq[:num_t], t_freqs)

        def pair(values):  # cos, -sin, sin, cos
            return torch.stack([values.cos(), -values.sin(), values.sin(), values.cos()], dim=-1)

        e_h, e_w, e_t = pair(e_h), pair(e_w), pair(e_t)
        embedding = torch.cat(
            [
                e_t[:, None, None].expand(num_t, num_h, num_w, e_t.shape[-2], 4),
                e_h[None, :, None].expand(num_t, num_h, num_w, e_h.shape[-2], 4),
                e_w[None, None, :].expand(num_t, num_h, num_w, e_w.shape[-2], 4),
            ],
            dim=-2,
        )
        embedding = embedding.reshape(num_t * num_h * num_w, head_dim // 2, 2, 2).float()
        return embedding.unsqueeze(1).unsqueeze(0)

    def apply_rope_split_half(x, rope):
        """x: (B, L, H, D)；rope: (1, L, 1, D/2, 2, 2)。"""
        x_dtype = x.dtype
        halves = x.reshape(*x.shape[:-1], 2, -1).movedim(-2, -1).unsqueeze(-2).to(rope.dtype)
        out = rope[..., 0] * halves[..., 0] + rope[..., 1] * halves[..., 1]
        return out.movedim(-1, -2).reshape(*x.shape[:-1], -1).to(x_dtype)

    # ---- Cosmos-Predict2 MiniTrainDIT（comfy/ldm/cosmos/predict2.py）----
    class CosmosAttention(nn.Module):
        def __init__(self, query_dim, context_dim, n_heads, head_dim):
            super().__init__()
            self.is_selfattn = context_dim is None
            context_dim = query_dim if context_dim is None else context_dim
            inner = n_heads * head_dim
            self.n_heads, self.head_dim = n_heads, head_dim
            self.q_proj = nn.Linear(query_dim, inner, bias=False)
            self.q_norm = _RMSNorm(head_dim, eps=1e-6)
            self.k_proj = nn.Linear(context_dim, inner, bias=False)
            self.k_norm = _RMSNorm(head_dim, eps=1e-6)
            self.v_proj = nn.Linear(context_dim, inner, bias=False)
            self.output_proj = nn.Linear(inner, query_dim, bias=False)

        def forward(self, x, context=None, rope=None):
            ctx = x if context is None else context
            batch, length_q, _ = x.shape
            length_k = ctx.shape[1]
            q = self.q_proj(x).view(batch, length_q, self.n_heads, self.head_dim)
            k = self.k_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
            v = self.v_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
            q = self.q_norm(q)
            k = self.k_norm(k)
            if self.is_selfattn and rope is not None:
                q = apply_rope_split_half(q, rope)
                k = apply_rope_split_half(k, rope)
            out = F.scaled_dot_product_attention(
                q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
            )
            out = out.transpose(1, 2).reshape(batch, length_q, -1)
            return self.output_proj(out)

    class GPT2FeedForward(nn.Module):
        def __init__(self, d_model, d_ff):
            super().__init__()
            self.activation = nn.GELU()
            self.layer1 = nn.Linear(d_model, d_ff, bias=False)
            self.layer2 = nn.Linear(d_ff, d_model, bias=False)

        def forward(self, x):
            return self.layer2(self.activation(self.layer1(x)))

    def adaln_modulation(x_dim, lora_dim, multiplier):
        return nn.Sequential(
            nn.SiLU(),
            nn.Linear(x_dim, lora_dim, bias=False),
            nn.Linear(lora_dim, multiplier * x_dim, bias=False),
        )

    class CosmosBlock(nn.Module):
        def __init__(self, x_dim, context_dim, num_heads, mlp_ratio=4.0, adaln_lora_dim=256):
            super().__init__()
            self.layer_norm_self_attn = _LayerNormNoAffine(x_dim, eps=1e-6)
            self.self_attn = CosmosAttention(x_dim, None, num_heads, x_dim // num_heads)
            self.layer_norm_cross_attn = _LayerNormNoAffine(x_dim, eps=1e-6)
            self.cross_attn = CosmosAttention(x_dim, context_dim, num_heads, x_dim // num_heads)
            self.layer_norm_mlp = _LayerNormNoAffine(x_dim, eps=1e-6)
            self.mlp = GPT2FeedForward(x_dim, int(x_dim * mlp_ratio))
            self.adaln_modulation_self_attn = adaln_modulation(x_dim, adaln_lora_dim, 3)
            self.adaln_modulation_cross_attn = adaln_modulation(x_dim, adaln_lora_dim, 3)
            self.adaln_modulation_mlp = adaln_modulation(x_dim, adaln_lora_dim, 3)

        def forward(self, x, emb, crossattn_emb, rope, adaln_lora):
            shift_s, scale_s, gate_s = (
                self.adaln_modulation_self_attn(emb) + adaln_lora
            ).chunk(3, dim=-1)
            shift_c, scale_c, gate_c = (
                self.adaln_modulation_cross_attn(emb) + adaln_lora
            ).chunk(3, dim=-1)
            shift_m, scale_m, gate_m = (self.adaln_modulation_mlp(emb) + adaln_lora).chunk(3, dim=-1)

            # 残差流用 float32：这套 28 层 DiT 的残差累积后 absmax 可达 ~5e4（真机权重实测
            # block 27 为 55712），fp16 上限 65504，后段会溢出成 inf/NaN。子层输入经 fp32
            # 归一化/调制后再转回 compute_dtype 做矩阵乘，子层输出也升回 fp32 再累加。
            compute_dtype = self.self_attn.q_proj.weight.dtype
            residual = x if x.dtype == torch.float32 else x.float()
            h = (
                self.layer_norm_self_attn(residual) * (1.0 + scale_s.float()) + shift_s.float()
            ).to(compute_dtype)
            residual = torch.addcmul(
                residual, gate_s.float(), self.self_attn(h, None, rope=rope).float()
            )

            h = (
                self.layer_norm_cross_attn(residual) * (1.0 + scale_c.float()) + shift_c.float()
            ).to(compute_dtype)
            residual = torch.addcmul(
                residual, gate_c.float(), self.cross_attn(h, crossattn_emb, rope=rope).float()
            )

            h = (self.layer_norm_mlp(residual) * (1.0 + scale_m.float()) + shift_m.float()).to(
                compute_dtype
            )
            residual = torch.addcmul(residual, gate_m.float(), self.mlp(h).float())
            return residual

    class Timesteps(nn.Module):
        def __init__(self, num_channels):
            super().__init__()
            self.num_channels = num_channels

        def forward(self, timesteps_b_t):
            timesteps = timesteps_b_t.flatten().float()
            half_dim = self.num_channels // 2
            exponent = -math.log(10000) * torch.arange(
                half_dim, dtype=torch.float32, device=timesteps.device
            ) / half_dim
            emb = timesteps[:, None] * torch.exp(exponent)[None, :]
            emb = torch.cat([torch.cos(emb), torch.sin(emb)], dim=-1)
            return emb.view(timesteps_b_t.shape[0], timesteps_b_t.shape[1], -1)

    class TimestepEmbedding(nn.Module):
        def __init__(self, in_features, out_features):
            super().__init__()
            self.linear_1 = nn.Linear(in_features, out_features, bias=False)
            self.activation = nn.SiLU()
            self.linear_2 = nn.Linear(out_features, 3 * out_features, bias=False)

        def forward(self, sample):
            return sample, self.linear_2(self.activation(self.linear_1(sample)))

    class PatchEmbed(nn.Module):
        def __init__(self, patch, in_channels, out_channels):
            super().__init__()
            self.patch = patch
            self.proj = nn.Sequential(
                nn.Identity(), nn.Linear(in_channels * patch * patch, out_channels, bias=False)
            )

        def forward(self, x):  # (B, C, T, H, W) -> (B, T, H/p, W/p, D)
            batch, channels, depth, height, width = x.shape
            patch = self.patch
            x = x.view(batch, channels, depth, 1, height // patch, patch, width // patch, patch)
            x = x.permute(0, 2, 4, 6, 1, 3, 5, 7).reshape(
                batch, depth, height // patch, width // patch, channels * patch * patch
            )
            return self.proj[1](x)

    class FinalLayer(nn.Module):
        def __init__(self, hidden_size, patch, out_channels, adaln_lora_dim=256):
            super().__init__()
            self.layer_norm = _LayerNormNoAffine(hidden_size, eps=1e-6)
            self.linear = nn.Linear(hidden_size, patch * patch * out_channels, bias=False)
            self.hidden_size = hidden_size
            self.adaln_modulation = adaln_modulation(hidden_size, adaln_lora_dim, 2)

        def forward(self, x, emb, adaln_lora):
            shift, scale = (
                self.adaln_modulation(emb) + adaln_lora[..., : 2 * self.hidden_size]
            ).chunk(2, dim=-1)
            h = (self.layer_norm(x) * (1.0 + scale.float()) + shift.float()).to(
                self.linear.weight.dtype
            )
            return self.linear(h)

    # ---- Anima LLM adapter（comfy/ldm/anima/model.py）----
    def rotate_half(x):
        x1 = x[..., : x.shape[-1] // 2]
        x2 = x[..., x.shape[-1] // 2:]
        return torch.cat((-x2, x1), dim=-1)

    def apply_rotary_pos_emb(x, cos, sin, unsqueeze_dim=1):
        cos = cos.unsqueeze(unsqueeze_dim)
        sin = sin.unsqueeze(unsqueeze_dim)
        return (x * cos) + (rotate_half(x) * sin)

    class AdapterRotaryEmbedding(nn.Module):
        def __init__(self, head_dim, rope_theta=10000):
            super().__init__()
            inv_freq = 1.0 / (
                rope_theta ** (torch.arange(0, head_dim, 2, dtype=torch.int64).float() / head_dim)
            )
            self.register_buffer("inv_freq", inv_freq, persistent=False)

        @torch.no_grad()
        def forward(self, x, position_ids):
            inv = self.inv_freq[None, :, None].float().expand(position_ids.shape[0], -1, 1)
            inv = inv.to(x.device)
            pos = position_ids[:, None, :].float()
            freqs = (inv @ pos).transpose(1, 2)
            emb = torch.cat((freqs, freqs), dim=-1)
            return emb.cos().to(x.dtype), emb.sin().to(x.dtype)

    class AdapterAttention(nn.Module):
        def __init__(self, query_dim, context_dim, n_heads, head_dim):
            super().__init__()
            inner = n_heads * head_dim
            self.n_heads, self.head_dim = n_heads, head_dim
            self.q_proj = nn.Linear(query_dim, inner, bias=False)
            self.q_norm = _RMSNorm(head_dim, eps=1e-6)
            self.k_proj = nn.Linear(context_dim, inner, bias=False)
            self.k_norm = _RMSNorm(head_dim, eps=1e-6)
            self.v_proj = nn.Linear(context_dim, inner, bias=False)
            self.o_proj = nn.Linear(inner, query_dim, bias=False)

        def forward(self, x, context=None, pe=None, pe_ctx=None):
            ctx = x if context is None else context
            batch, length_q, _ = x.shape
            length_k = ctx.shape[1]
            q = self.q_norm(self.q_proj(x).view(batch, length_q, self.n_heads, self.head_dim))
            k = self.k_norm(self.k_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim))
            v = self.v_proj(ctx).view(batch, length_k, self.n_heads, self.head_dim)
            q = q.transpose(1, 2)
            k = k.transpose(1, 2)
            v = v.transpose(1, 2)
            if pe is not None:
                q = apply_rotary_pos_emb(q, pe[0], pe[1])
                k = apply_rotary_pos_emb(k, pe_ctx[0], pe_ctx[1])
            out = F.scaled_dot_product_attention(q, k, v)
            return self.o_proj(out.transpose(1, 2).reshape(batch, length_q, -1))

    class AdapterBlock(nn.Module):
        def __init__(self, source_dim, model_dim, num_heads=16, mlp_ratio=4.0):
            super().__init__()
            self.norm_self_attn = _RMSNorm(model_dim, eps=1e-6)
            self.self_attn = AdapterAttention(model_dim, model_dim, num_heads, model_dim // num_heads)
            self.norm_cross_attn = _RMSNorm(model_dim, eps=1e-6)
            self.cross_attn = AdapterAttention(source_dim, source_dim, num_heads, model_dim // num_heads)
            self.norm_mlp = _RMSNorm(model_dim, eps=1e-6)
            inner = int(model_dim * mlp_ratio)
            self.mlp = nn.Sequential(
                nn.Linear(model_dim, inner), nn.GELU(), nn.Linear(inner, model_dim)
            )

        def forward(self, x, context, pe, pe_ctx):
            x = x + self.self_attn(self.norm_self_attn(x), None, pe=pe, pe_ctx=pe)
            x = x + self.cross_attn(self.norm_cross_attn(x), context, pe=pe, pe_ctx=pe_ctx)
            x = x + self.mlp(self.norm_mlp(x))
            return x

    class LLMAdapter(nn.Module):
        def __init__(self, source_dim=1024, target_dim=1024, model_dim=1024, num_layers=6, num_heads=16):
            super().__init__()
            self.embed = nn.Embedding(32128, target_dim)
            self.in_proj = nn.Identity()
            self.rotary_emb = AdapterRotaryEmbedding(model_dim // num_heads)
            self.blocks = nn.ModuleList(
                [AdapterBlock(source_dim, model_dim, num_heads) for _ in range(num_layers)]
            )
            self.out_proj = nn.Linear(model_dim, target_dim)
            self.norm = _RMSNorm(target_dim, eps=1e-6)

        def forward(self, source_hidden_states, target_input_ids):
            context = source_hidden_states
            x = self.in_proj(self.embed(target_input_ids).to(context.dtype))
            pos = torch.arange(x.shape[1], device=x.device).unsqueeze(0)
            pos_ctx = torch.arange(context.shape[1], device=x.device).unsqueeze(0)
            pe = self.rotary_emb(x, pos)
            pe_ctx = self.rotary_emb(x, pos_ctx)
            for block in self.blocks:
                x = block(x, context, pe, pe_ctx)
            return self.norm(self.out_proj(x))

    class Anima(nn.Module):
        """Cosmos-Predict2 MiniTrainDIT + Anima LLM adapter（2B，28 个 block）。"""

        def __init__(
            self,
            in_channels=16,
            out_channels=16,
            patch_spatial=2,
            model_channels=2048,
            num_blocks=28,
            num_heads=16,
            mlp_ratio=4.0,
            crossattn_emb_channels=1024,
            adaln_lora_dim=256,
        ):
            super().__init__()
            self.patch_spatial = patch_spatial
            self.num_heads = num_heads
            self.model_channels = model_channels
            self.t_embedder = nn.Sequential(
                Timesteps(model_channels), TimestepEmbedding(model_channels, model_channels)
            )
            self.x_embedder = PatchEmbed(patch_spatial, in_channels + 1, model_channels)
            self.blocks = nn.ModuleList(
                [
                    CosmosBlock(
                        model_channels, crossattn_emb_channels, num_heads, mlp_ratio, adaln_lora_dim
                    )
                    for _ in range(num_blocks)
                ]
            )
            self.final_layer = FinalLayer(model_channels, patch_spatial, out_channels, adaln_lora_dim)
            self.t_embedding_norm = _RMSNorm(model_channels, eps=1e-6)
            self.llm_adapter = LLMAdapter()

        def preprocess_text_embeds(self, text_embeds, text_ids, t5xxl_weights=None):
            out = self.llm_adapter(text_embeds, text_ids)
            if t5xxl_weights is not None:
                out = out * t5xxl_weights
            if out.shape[1] < 512:
                out = F.pad(out, (0, 0, 0, 512 - out.shape[1]))
            return out

        def forward(self, x, timesteps, context, rope):
            batch, _channels, depth, height, width = x.shape
            padding_mask = torch.zeros(batch, 1, height, width, dtype=x.dtype, device=x.device)
            x = torch.cat([x, padding_mask.unsqueeze(1).repeat(1, 1, depth, 1, 1)], dim=1)
            x = self.x_embedder(x)  # (B, T, H/p, W/p, D)
            _, frames, rows, cols, dim = x.shape

            if timesteps.ndim == 1:
                timesteps = timesteps.unsqueeze(1)
            emb, adaln_lora = self.t_embedder[1](self.t_embedder[0](timesteps).to(x.dtype))
            emb = self.t_embedding_norm(emb)

            # 残差流全程 float32（原因见 CosmosBlock.forward），子层内部仍用模型 dtype。
            residual = x.reshape(batch, frames * rows * cols, dim).float()
            for block in self.blocks:
                residual = block(residual, emb, context, rope, adaln_lora)
            x = self.final_layer(residual, emb, adaln_lora)

            patch = self.patch_spatial
            x = x.view(batch, frames, rows, cols, patch, patch, 1, -1)
            x = x.permute(0, 7, 1, 6, 2, 4, 3, 5).reshape(
                batch, -1, frames, rows * patch, cols * patch
            )
            return x

    def optimized_scale(positive, negative):
        """CFGZeroStar（comfy_extras/nodes_cfg.py）。"""
        pos = positive.reshape(positive.shape[0], -1)
        neg = negative.reshape(negative.shape[0], -1)
        ratio = torch.sum(pos * neg, dim=1, keepdim=True) / (
            torch.sum(neg ** 2, dim=1, keepdim=True) + 1e-8
        )
        return ratio.reshape([positive.shape[0]] + [1] * (positive.ndim - 1))

    return {
        "torch": torch,
        "Anima": Anima,
        "_RMSNorm": _RMSNorm,
        "_LayerNormNoAffine": _LayerNormNoAffine,
        "optimized_scale": optimized_scale,
        "build_caption": build_caption,
        "tokenize": tokenize,
        "simple_scheduler": simple_scheduler,
        "build_rope_3d": build_rope_3d,
        "latents_mean": latents_mean,
        "latents_std": latents_std,
        "shift": shift,
    }


def load_anima_runtime(spec, log=print, dir_bytes=None, local_paths=None):
    """下载并构建 Anima-Light-Lavender 运行时，返回 ``(runtime, downloaded_bytes, load_seconds)``。

    - ``downloaded_bytes`` 只统计本次真实下载的文件（DiT / 文本编码器 / VAE / 分词器）；
      命中 ``local_paths`` 的条目记 0（daemon 预挂载场景）。
    - ``load_seconds`` 只算构建与加载，不含下载耗时。
    - ``local_paths`` 键：``dit``（文件）、``te``（文件）、``vae``（仓库根目录）、
      ``tokenizers``（仓库根目录）；值为 None/缺失时走在线下载。
    """
    import gc

    import numpy as np
    import torch
    from PIL import Image
    from diffusers import AutoencoderKLQwenImage
    from huggingface_hub import hf_hub_download, snapshot_download
    from safetensors.torch import load_file
    from transformers import Qwen2Tokenizer, Qwen3Config, Qwen3Model, T5TokenizerFast

    local_paths = dict(local_paths or {})
    try:
        sampler_shift = float(spec.get("shift") or 3.0)
    except (TypeError, ValueError):
        sampler_shift = 3.0
    toolkit = _anima_toolkit(sampler_shift)
    Anima = toolkit["Anima"]
    optimized_scale = toolkit["optimized_scale"]
    build_caption = toolkit["build_caption"]
    tokenize = toolkit["tokenize"]
    simple_scheduler = toolkit["simple_scheduler"]
    build_rope_3d = toolkit["build_rope_3d"]
    latents_mean = toolkit["latents_mean"]
    latents_std = toolkit["latents_std"]

    def file_bytes(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0

    if dir_bytes is None:
        def dir_bytes(path):
            total = 0
            for root, _dirs, names in os.walk(path):
                for name in names:
                    total += file_bytes(os.path.join(root, name))
            return total

    base = str(spec.get("base") or "").strip()
    weight = str(spec.get("weight") or "").strip()
    if not base or not weight:
        raise ValueError("anima 需要 pipeline.base 与 pipeline.weight")
    text_encoder_spec = spec.get("textEncoder") or {}
    text_encoder_repo = str(text_encoder_spec.get("repo") or "").strip()
    text_encoder_weight = str(text_encoder_spec.get("weight") or "").strip()
    if not text_encoder_repo or not text_encoder_weight:
        raise ValueError("anima 需要 pipeline.textEncoder.repo 与 textEncoder.weight")
    vae_spec = spec.get("vae") or {}
    vae_repo = str(vae_spec.get("repo") or "").strip()
    vae_subfolder = str(vae_spec.get("subfolder") or "").strip().strip("/")
    if not vae_repo:
        raise ValueError("anima 需要 pipeline.vae.repo")
    tokenizer_spec = spec.get("tokenizers") or {}
    tokenizer_repo = str(tokenizer_spec.get("repo") or "").strip()
    tokenizer_repo_type = str(tokenizer_spec.get("repoType") or "").strip() or None
    if not tokenizer_repo:
        raise ValueError("anima 需要 pipeline.tokenizers.repo")

    if not torch.cuda.is_available():
        raise RuntimeError("anima 运行时需要 CUDA GPU（torch.cuda.is_available() 为 False）")
    device = torch.device("cuda")

    # ---- 下载四个资产（命中预挂载则跳过）----
    download_bytes = 0
    download_started = time.time()

    dit_path = local_paths.get("dit")
    if dit_path:
        log(f"[anima] DiT 使用预挂载权重：{dit_path}")
    else:
        log(f"[anima] 下载 DiT 权重 {base}/{weight} …")
        dit_path = hf_hub_download(base, filename=weight)
        download_bytes += file_bytes(dit_path)

    text_encoder_path = local_paths.get("te")
    if text_encoder_path:
        log(f"[anima] 文本编码器使用预挂载权重：{text_encoder_path}")
    else:
        log(f"[anima] 下载文本编码器 {text_encoder_repo}/{text_encoder_weight} …")
        text_encoder_path = hf_hub_download(text_encoder_repo, filename=text_encoder_weight)
        download_bytes += file_bytes(text_encoder_path)

    vae_root = local_paths.get("vae")
    if vae_root:
        log(f"[anima] VAE 使用预挂载目录：{vae_root}")
    elif vae_subfolder:
        log(f"[anima] 下载 VAE {vae_repo}/{vae_subfolder} …")
        patterns = [f"{vae_subfolder}/*", f"{vae_subfolder}/**/*"]
        vae_root = snapshot_download(vae_repo, allow_patterns=patterns)
        download_bytes += dir_bytes(vae_root)
    else:
        # 没有子目录描述时不能按白名单剪枝（会漏文件），交给 from_pretrained 整仓加载。
        log(f"[anima] WARN pipeline.vae.subfolder 为空，VAE 整仓加载：{vae_repo}")
        vae_root = ""

    tokenizer_root = local_paths.get("tokenizers")
    if tokenizer_root:
        log(f"[anima] 分词器使用预挂载目录：{tokenizer_root}")
    else:
        log(f"[anima] 下载分词器 {tokenizer_repo} …")
        tokenizer_root = snapshot_download(
            tokenizer_repo,
            repo_type=tokenizer_repo_type,
            allow_patterns=["qwen25_tokenizer/*", "t5_tokenizer/*"],
        )
        download_bytes += dir_bytes(tokenizer_root)

    download_seconds = round(time.time() - download_started, 1)
    log(f"[anima] 资产就绪：下载 {download_seconds}s / {round(download_bytes / 2**30, 2)} GiB")

    # ---- 精度选择：只有 sm_80+ 的原生 bf16 才用 bf16 ----
    # T4 是 sm_75：torch 2.11 + CUDA 13 的 is_bf16_supported() 仍返回 True，但 bf16 走
    # 模拟执行，实测 8.7s/次 DiT 前向（fp16 有 tensor core）；所以再按 compute capability 判一次。
    try:
        capability = torch.cuda.get_device_capability(device)
    except Exception:
        capability = (0, 0)
    capability_major = int(capability[0]) if capability else 0
    capability_minor = int(capability[1]) if capability and len(capability) > 1 else 0
    capability_label = f"sm_{capability_major}{capability_minor}"
    bf16_supported = bool(torch.cuda.is_bf16_supported())
    native_bf16 = bf16_supported and capability_major >= 8
    requested_dtype = str(spec.get("dtype") or "auto").strip().lower()
    if requested_dtype in ("", "auto", "default"):
        dit_dtype = torch.bfloat16 if native_bf16 else torch.float16
    elif requested_dtype in ("bf16", "bfloat16"):
        dit_dtype = torch.bfloat16
        if not native_bf16:
            log(
                f"[anima] WARN {capability_label} 没有原生 bf16（模拟执行会明显变慢），"
                "但 pipeline.dtype 显式要求 bf16"
            )
    elif requested_dtype in ("fp16", "float16", "half"):
        dit_dtype = torch.float16
    elif requested_dtype in ("fp32", "float32", "float"):
        dit_dtype = torch.float32
    else:
        raise ValueError(f"anima 不认识的 dtype：{requested_dtype}")
    # demo 的文本编码器用 fp32；fp16 卡降到 fp16（编码后 TE 还会整体挪到 CPU，不占采样显存）。
    text_encoder_dtype = torch.float32 if dit_dtype != torch.float16 else torch.float16
    vae_dtype = dit_dtype
    log(
        f"[anima] dtype：DiT/VAE={dit_dtype}，文本编码器={text_encoder_dtype}"
        f"（{capability_label}，bf16_supported={bf16_supported}，native_bf16={native_bf16}）"
    )

    load_started = time.time()

    # ---- DiT：单文件 ComfyUI checkpoint（前缀 "net."）----
    log("[anima] 构建 DiT（Cosmos-Predict2 MiniTrainDIT 2B，28 层）…")
    previous_dtype = torch.get_default_dtype()
    try:
        torch.set_default_dtype(dit_dtype)
        transformer = Anima()
    except Exception as exc:  # noqa: BLE001 - 少数环境不允许 fp16 做默认 dtype
        log(f"[anima] WARN 以 {dit_dtype} 构造 DiT 失败，回退 float32：{exc}")
        torch.set_default_dtype(torch.float32)
        transformer = Anima()
    finally:
        torch.set_default_dtype(previous_dtype)
    state = load_file(dit_path)
    state = {key[len("net."):]: value for key, value in state.items() if key.startswith("net.")}
    if not state:
        raise RuntimeError(f"DiT 权重里没有 net. 前缀的 tensor：{dit_path}")
    missing, unexpected = transformer.load_state_dict(state, strict=False)
    del state
    if missing:
        raise RuntimeError(
            f"DiT 权重缺 {len(missing)} 个 key（如 {missing[:5]}）：模型结构与 checkpoint 不匹配"
        )
    if unexpected:
        log(f"[anima] WARN DiT 有 {len(unexpected)} 个未使用 key（如 {unexpected[:5]}）")
    transformer = transformer.to(device=device, dtype=dit_dtype).eval()
    torch.cuda.empty_cache()

    # ---- 文本编码器：Qwen3-0.6B（demo 的 config，权重前缀 "model."）----
    log("[anima] 构建 Qwen3-0.6B 文本编码器 …")
    qwen_config = Qwen3Config(
        vocab_size=151936,
        hidden_size=1024,
        intermediate_size=3072,
        num_hidden_layers=28,
        num_attention_heads=16,
        num_key_value_heads=8,
        head_dim=128,
        max_position_embeddings=32768,
        rms_norm_eps=1e-6,
        rope_theta=1000000.0,
        attention_bias=False,
        tie_word_embeddings=True,
    )
    text_encoder = Qwen3Model(qwen_config)
    text_encoder_state = load_file(text_encoder_path)
    text_encoder_state = {
        (key[len("model."):] if key.startswith("model.") else key): value
        for key, value in text_encoder_state.items()
    }
    te_missing, te_unexpected = text_encoder.load_state_dict(text_encoder_state, strict=False)
    del text_encoder_state
    if te_missing:
        if any("embed_tokens" in key for key in te_missing):
            raise RuntimeError(
                f"文本编码器缺 embed_tokens（共 {len(te_missing)} 个 key）：权重与 Qwen3 结构不匹配"
            )
        log(f"[anima] WARN 文本编码器缺 {len(te_missing)} 个 key（如 {te_missing[:5]}）")
    if te_unexpected:
        log(f"[anima] WARN 文本编码器有 {len(te_unexpected)} 个未使用 key（如 {te_unexpected[:5]}）")
    text_encoder = text_encoder.to(device=device, dtype=text_encoder_dtype).eval()
    torch.cuda.empty_cache()

    # ---- VAE：Qwen-Image 的 AutoencoderKLQwenImage ----
    log("[anima] 构建 Qwen-Image VAE …")
    vae_dir = os.path.join(vae_root, vae_subfolder) if vae_subfolder else vae_root
    if os.path.isfile(os.path.join(vae_dir, "config.json")):
        vae = AutoencoderKLQwenImage.from_pretrained(vae_dir, torch_dtype=vae_dtype)
    elif vae_subfolder:
        vae = AutoencoderKLQwenImage.from_pretrained(
            vae_repo, subfolder=vae_subfolder, torch_dtype=vae_dtype
        )
    else:
        vae = AutoencoderKLQwenImage.from_pretrained(vae_repo, torch_dtype=vae_dtype)
    vae = vae.to(device).eval()
    torch.cuda.empty_cache()

    # ---- 分词器：demo Space 里的 Qwen2Tokenizer + T5TokenizerFast ----
    qwen_tokenizer_dir = os.path.join(tokenizer_root, "qwen25_tokenizer")
    t5_tokenizer_dir = os.path.join(tokenizer_root, "t5_tokenizer")
    log("[anima] 加载分词器（qwen25_tokenizer + t5_tokenizer）…")
    qwen_tokenizer = Qwen2Tokenizer.from_pretrained(qwen_tokenizer_dir)
    t5_tokenizer = T5TokenizerFast.from_pretrained(t5_tokenizer_dir)

    class AnimaOutput:
        """最小返回对象：只提供 .images，对齐 diffusers pipeline 的调用方约定。"""

        __slots__ = ("images",)

        def __init__(self, images):
            self.images = images

    class AnimaRuntime:
        """Anima-Light-Lavender 推理运行时（daemon 与 verify payload 共用同一实现）。"""

        def __init__(self, transformer, text_encoder, vae, qwen_tokenizer, t5_tokenizer, dtypes):
            self.transformer = transformer
            self.text_encoder = text_encoder
            self.vae = vae
            self.qwen_tokenizer = qwen_tokenizer
            self.t5_tokenizer = t5_tokenizer
            self.dit_dtype, self.text_encoder_dtype, self.vae_dtype = dtypes
            self.device = device
            self._text_encoder_on_gpu = True
            self._embedding_cache = {}
            self._embedding_cache_limit = 8
            self.latent_mean = torch.tensor(
                latents_mean, dtype=torch.float32, device=device
            ).view(1, 16, 1, 1, 1)
            self.latent_std = torch.tensor(
                latents_std, dtype=torch.float32, device=device
            ).view(1, 16, 1, 1, 1)

        def release(self):
            """清掉缓存（daemon 卸载 pipeline 时调用），让下次加载不残留旧 embedding。"""
            self._embedding_cache.clear()
            torch.cuda.empty_cache()

        def _move_text_encoder(self, on_gpu):
            """TE 只在编码时上 GPU：编码完挪回 CPU，把 1024² 解码要用的显存让出来。"""
            if on_gpu and not self._text_encoder_on_gpu:
                self.text_encoder = self.text_encoder.to(self.device)
                self._text_encoder_on_gpu = True
            elif not on_gpu and self._text_encoder_on_gpu:
                self.text_encoder = self.text_encoder.to("cpu")
                self._text_encoder_on_gpu = False
                log("[anima] 文本编码器已挪到 CPU，显存留给采样与 VAE 解码")

        def _text_hidden(self, ids):
            mask = torch.ones_like(ids)
            hidden = self.text_encoder(input_ids=ids, attention_mask=mask).last_hidden_state
            return hidden.float()

        @torch.no_grad()
        def _encode(self, text):
            """编码单段文本；按文本缓存 embedding（上限 8 条），命中即跳过 TE。"""
            key = str(text or "")
            cached = self._embedding_cache.get(key)
            if cached is not None:
                # 缓存按生成时的 dtype 存；切过精度后按当前 dtype 取出，避免 bf16/fp16 混用。
                return cached.to(device=self.device, dtype=self.dit_dtype)
            self._move_text_encoder(True)
            qwen_ids, t5_ids, t5_weights = tokenize(key, self.qwen_tokenizer, self.t5_tokenizer)
            ids = torch.tensor([qwen_ids], dtype=torch.long, device=self.device)
            hidden = self._text_hidden(ids)
            if not bool(torch.isfinite(hidden).all()):
                if self.text_encoder_dtype != torch.float32:
                    log("[anima] WARN 文本编码器输出非有限值，回退 float32 重试")
                    self.text_encoder = self.text_encoder.to(dtype=torch.float32)
                    self.text_encoder_dtype = torch.float32
                    hidden = self._text_hidden(ids)
                if not bool(torch.isfinite(hidden).all()):
                    raise RuntimeError("文本编码器输出含 NaN/Inf，请检查 Qwen3 权重与配置")
            t5 = torch.tensor([t5_ids], dtype=torch.long, device=self.device)
            weights = (
                torch.tensor(t5_weights, dtype=torch.float32, device=self.device)
                .unsqueeze(0)
                .unsqueeze(-1)
            )
            embedding = self.transformer.preprocess_text_embeds(
                hidden.to(self.dit_dtype), t5, t5xxl_weights=weights.to(self.dit_dtype)
            )
            if len(self._embedding_cache) >= self._embedding_cache_limit:
                self._embedding_cache.pop(next(iter(self._embedding_cache)))
            self._embedding_cache[key] = embedding.detach().to("cpu")
            return embedding

        @staticmethod
        def _to_image(output):
            image = ((output.float() + 1.0) / 2.0).clamp(0.0, 1.0)[0, :, 0]
            array = (image.permute(1, 2, 0).cpu().numpy() * 255.0).round().astype(np.uint8)
            return Image.fromarray(array)

        @torch.no_grad()
        def _decode_kernel(self, latent):
            """GPU 解码；NaN/Inf 时把 VAE 退 float32 再试一次。"""
            output = self.vae.decode(latent).sample
            if not bool(torch.isfinite(output).all()):
                if self.vae_dtype != torch.float32:
                    log("[anima] WARN VAE 解码出现 NaN/Inf，回退 float32 重试")
                    self.vae = self.vae.to(dtype=torch.float32)
                    self.vae_dtype = torch.float32
                    output = self.vae.decode(latent.float()).sample
                if not bool(torch.isfinite(output).all()):
                    if self.dit_dtype == torch.float16:
                        # 大概率是 DiT fp16 数值溢出：返回纯色占位图，让 __call__ 的
                        # fp16→bf16 兜底重跑整张，而不是直接判失败。
                        log("[anima] WARN 解码仍含 NaN/Inf，交给 fp16→bf16 兜底重跑")
                        return torch.full(
                            (1, 3, 1, latent.shape[-2] * 8, latent.shape[-1] * 8), -1.0
                        )
                    raise RuntimeError("VAE 解码输出含 NaN/Inf，请检查 VAE 权重")
            return output

        @torch.no_grad()
        def _decode_on_cpu(self, latent):
            """显存不够时的兜底：VAE 临时挪到 CPU 用 float32 解码（慢但能出图）。"""
            log("[anima] WARN VAE 解码显存不足，临时改用 CPU float32 解码（会明显变慢）")
            torch.cuda.empty_cache()
            restore_dtype = self.vae_dtype
            self.vae = self.vae.to(device="cpu", dtype=torch.float32)
            try:
                output = self.vae.decode(
                    latent.detach().to(device="cpu", dtype=torch.float32)
                ).sample
                return self._to_image(output)
            finally:
                # 临时挪动：解完放回 GPU，下一张还是先试 GPU 解码。
                self.vae = self.vae.to(device=self.device, dtype=restore_dtype)
                torch.cuda.empty_cache()

        @torch.no_grad()
        def _decode(self, latent):
            try:
                output = self._decode_kernel(latent)
            except torch.OutOfMemoryError:
                return self._decode_on_cpu(latent)
            return self._to_image(output)

        @staticmethod
        def _looks_flat(image):
            """近似纯色/黑图检测：8bit 灰度标准差 < 2 视为 fp16 数值崩掉。"""
            array = np.asarray(image, dtype=np.float32)
            return float(array.std()) < 2.0

        def _switch_dtype(self, dtype):
            log(f"[anima] DiT/VAE 精度切换为 {dtype}（后续采样沿用）")
            self.transformer = self.transformer.to(dtype=dtype)
            self.vae = self.vae.to(dtype=dtype)
            self.dit_dtype = dtype
            self.vae_dtype = dtype
            torch.cuda.empty_cache()

        def _sample_latent(self, prompt, negative_prompt, steps, width, height, cfg, generator):
            """编码 → euler + simple 采样 → 返回反归一化后的 latent（未解码）。"""
            caption = build_caption(prompt)
            use_cfg = cfg > 1.0
            try:
                cond = self._encode(caption)
                # 模型卡推荐空负向：空串按 demo 的方式编码成空 caption。
                uncond = self._encode(str(negative_prompt or "").strip()) if use_cfg else None
            finally:
                self._move_text_encoder(False)
            if not bool(torch.isfinite(cond).all()):
                raise RuntimeError("文本 embedding 含 NaN/Inf（TE 或 LLM adapter 精度问题）")
            if uncond is not None and not bool(torch.isfinite(uncond).all()):
                raise RuntimeError("负向文本 embedding 含 NaN/Inf（TE 或 LLM adapter 精度问题）")
            torch.cuda.empty_cache()
            batched = uncond is not None and cond.shape[1] == uncond.shape[1]
            context = torch.cat([cond, uncond], dim=0) if batched else None

            latent_height, latent_width = height // 8, width // 8
            rope = build_rope_3d(
                1, latent_height // 2, latent_width // 2, head_dim=2048 // 16, device=self.device
            )
            shape = (1, 16, 1, latent_height, latent_width)
            if generator is None:
                generator = torch.Generator(device=self.device).manual_seed(0)
            noise_device = getattr(generator, "device", self.device)
            latent = torch.randn(shape, dtype=torch.float32, generator=generator, device=noise_device)
            if latent.device != self.device:
                latent = latent.to(self.device)
            sigmas = simple_scheduler(steps).to(self.device)
            log(
                f"[anima] 采样 {width}x{height} steps={steps} cfg={cfg} "
                f"caption_tokens={cond.shape[1]} batched={batched}"
            )

            sampling_started = time.time()
            velocity_cond = None
            velocity_uncond = None
            for index in range(steps):
                sigma = sigmas[index]
                timestep = sigma.reshape(1).expand(1)
                if batched:
                    stacked = latent.to(self.dit_dtype).repeat(2, 1, 1, 1, 1)
                    output = self.transformer(stacked, timestep.expand(2), context, rope).float()
                    velocity_cond, velocity_uncond = output[0:1], output[1:2]
                else:
                    velocity_cond = self.transformer(
                        latent.to(self.dit_dtype), timestep, cond, rope
                    ).float()
                    velocity_uncond = None
                    if uncond is not None:
                        velocity_uncond = self.transformer(
                            latent.to(self.dit_dtype), timestep, uncond, rope
                        ).float()
                # 逐 step 有限性检查：一旦污染立即停，避免把脏 latent 带去解码白跑。
                bad_velocity = int((~torch.isfinite(velocity_cond)).sum())
                if velocity_uncond is not None:
                    bad_velocity += int((~torch.isfinite(velocity_uncond)).sum())
                if bad_velocity:
                    raise RuntimeError(
                        f"采样第 {index + 1}/{steps} 步 DiT 输出出现 {bad_velocity} 个非有限值"
                    )

                cond_denoised = latent - velocity_cond * sigma
                if velocity_uncond is None:
                    denoised = cond_denoised
                else:
                    uncond_denoised = latent - velocity_uncond * sigma
                    denoised = uncond_denoised + (cond_denoised - uncond_denoised) * cfg
                    # CFGZeroStar（comfy_extras/nodes_cfg.py）
                    alpha = optimized_scale(latent - cond_denoised, latent - uncond_denoised)
                    denoised = (
                        denoised
                        + uncond_denoised * (alpha - 1.0)
                        + cfg * uncond_denoised * (1.0 - alpha)
                    )
                derivative = (latent - denoised) / sigma
                latent = latent + derivative * (sigmas[index + 1] - sigma)
                if index == 0 or index == steps - 1:
                    log(
                        f"[anima] step {index + 1}/{steps}: latent absmax="
                        f"{float(latent.abs().max()):.4g}"
                    )
                if not bool(torch.isfinite(latent).all()):
                    raise RuntimeError(
                        f"采样第 {index + 1}/{steps} 步 latent 出现非有限值，已中止（避免解码白跑）"
                    )
            sampling_seconds = round(time.time() - sampling_started, 1)
            log(
                f"[anima] 采样完成：{steps} 步 {sampling_seconds}s"
                f"（{round(sampling_seconds / steps, 2)} s/step），准备解码"
            )
            return (latent * self.latent_std + self.latent_mean).to(self.vae_dtype)

        @torch.inference_mode()
        def __call__(
            self,
            prompt,
            negative_prompt="",
            num_inference_steps=25,
            width=1024,
            height=1024,
            guidance_scale=4.0,
            generator=None,
        ):
            steps = max(1, int(num_inference_steps))
            width = max(16, int(width) - int(width) % 16)
            height = max(16, int(height) - int(height) % 16)
            cfg = float(guidance_scale)
            if cfg != cfg:  # NaN 兜底
                cfg = 4.0
            seed = None
            if generator is not None:
                try:
                    seed = int(generator.initial_seed())
                except Exception:
                    seed = None

            latent = self._sample_latent(
                prompt, negative_prompt, steps, width, height, cfg, generator
            )
            # 采样中间张量随 _sample_latent 返回已释放；再回收缓存块，给 1024² 解码腾连续显存。
            gc.collect()
            torch.cuda.empty_cache()
            decode_started = time.time()
            image = self._decode(latent)
            log(f"[anima] 解码完成：{round(time.time() - decode_started, 1)}s")

            if self.dit_dtype == torch.float16 and self._looks_flat(image):
                log("[anima] WARN fp16 出图近似纯色，切 bf16 重跑当前这张（会明显变慢）")
                self._switch_dtype(torch.bfloat16)
                if generator is not None and seed is not None:
                    generator.manual_seed(seed)
                latent = self._sample_latent(
                    prompt, negative_prompt, steps, width, height, cfg, generator
                )
                gc.collect()
                torch.cuda.empty_cache()
                image = self._decode(latent)
            return AnimaOutput([image])

    runtime = AnimaRuntime(
        transformer,
        text_encoder,
        vae,
        qwen_tokenizer,
        t5_tokenizer,
        (dit_dtype, text_encoder_dtype, vae_dtype),
    )
    load_seconds = round(time.time() - load_started, 1)
    try:
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        log(
            f"[anima] 显存：已分配 {round(torch.cuda.memory_allocated() / 2**20)} MB，"
            f"空闲 {round(free_bytes / 2**30, 1)} GiB / 总 {round(total_bytes / 2**30, 1)} GiB"
        )
    except Exception:
        pass
    log(
        f"[anima] 就绪：load={load_seconds}s，下载 {round(download_bytes / 2**30, 2)} GiB，"
        f"shift={toolkit['shift']}（TE 编码后移到 CPU；DiT 残差流 fp32；解码 OOM 时 VAE 退 CPU float32）"
    )
    return runtime, download_bytes, load_seconds


def build_pipeline(pipeline_spec: dict):
    """按 loader 分支加载；返回 (pipe, 人类可读的 loaded 标识)。"""
    loader = str(pipeline_spec["loader"])
    base = str(pipeline_spec["base"])
    variant = pipeline_spec.get("variant")
    allow_patterns = pipeline_spec.get("allowPatterns")
    device_map = pipeline_spec.get("deviceMap")

    # P2.1：命中预挂载目录时直接用本地权重（跳过下载与磁盘预检）。
    local_base = resolve_local_model(base)
    # anima 是「单文件 DiT + 独立文本编码器 / VAE / 分词器」，预挂载时按文件与子目录判断；
    # DiT 命中本地时跳过整仓预下载与磁盘预检（其余资产按需下载）。
    anima_assets = anima_local_assets(pipeline_spec) if loader == "anima" else {}
    if anima_assets.get("dit"):
        log(f"[load] 使用预挂载 anima DiT 权重：{anima_assets['dit']}")
    else:
        ensure_disk_capacity(pipeline_spec)
        if local_base:
            log(f"[load] 使用预挂载权重加载底座：{base} → {local_base}")
        else:
            _prefetch_weights(base, allow_patterns)
    base_source = local_base or base

    import torch
    from diffusers import (
        AutoPipelineForText2Image,
        EulerDiscreteScheduler,
        StableDiffusionXLPipeline,
    )

    kwargs: dict = {"torch_dtype": torch.float16, "use_safetensors": True}
    if variant:
        kwargs["variant"] = str(variant)

    if loader == "anima":
        # 单文件 ComfyUI checkpoint：DiT + Qwen3-0.6B + Qwen-Image VAE + 双分词器。
        # 运行时实现与 tools/payload/verify-model.py 的 load_anima_runtime 逐字一致。
        try:
            runtime, _downloaded_bytes, _load_seconds = load_anima_runtime(
                pipeline_spec, log, local_paths=anima_assets
            )
        except Exception as exc:
            if _is_oom(exc):
                raise
            raise LoadError(f"anima 加载失败：{short(exc)}") from exc
        return runtime, f"anima:{base}"

    if loader == "sdxl":
        # 整管直出：turbo / base 都走这里
        pipe = _from_pretrained(AutoPipelineForText2Image, base_source, kwargs, loader)
        pipe = pipe.to("cuda")
        return pipe, f"sdxl:{base}"

    if loader == "sdxl-lora":
        lora = pipeline_spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if not lora_repo or not lora_weight:
            raise RequestError("sdxl-lora 需要 lora.repo 与 lora.weight")

        pipe = _from_pretrained(StableDiffusionXLPipeline, base_source, kwargs, loader)

        scheduler_spec = pipeline_spec.get("scheduler") or {}
        scheduler_type = str(scheduler_spec.get("type") or "euler").lower()
        if scheduler_type == "euler":
            spacing = str(scheduler_spec.get("timestepSpacing") or "trailing")
            pipe.scheduler = EulerDiscreteScheduler.from_config(
                pipe.scheduler.config, timestep_spacing=spacing
            )
            log(f"[load] 调度器 EulerDiscreteScheduler(timestep_spacing={spacing})")
        else:
            log(f"[load] 未识别的 scheduler.type={scheduler_type}，沿用底座默认调度器")

        # P2.1：LoRA 仓库预挂载时优先用本地权重文件；否则按文件名下载再按 repo+weight_name 载入
        # （与 bench/lightning/run.py 一致）。
        local_weight = resolve_local_weight(lora_repo, lora_weight)
        if local_weight:
            log(f"[load] 使用预挂载 LoRA 权重：{local_weight}")
            pipe.load_lora_weights(os.path.dirname(local_weight) or ".", weight_name=os.path.basename(local_weight))
        else:
            from huggingface_hub import hf_hub_download

            downloaded = hf_hub_download(lora_repo, lora_weight)
            log(f"[load] LoRA 权重就绪：{downloaded}")
            pipe.load_lora_weights(lora_repo, weight_name=lora_weight)
        log(f"[load] LoRA 已挂载：{lora_repo}/{lora_weight}")

        pipe = pipe.to("cuda")
        return pipe, f"sdxl-lora:{base}"

    if loader == "flux2":
        # FLUX.2 klein 整管单卡放不下（>14.5GB），必须 device_map="balanced" 走双卡。
        balanced = str(device_map or "balanced")
        kwargs["device_map"] = balanced
        log(f"[load] flux2 使用 device_map={balanced}")
        pipe = _from_pretrained(AutoPipelineForText2Image, base_source, kwargs, loader)
        return pipe, f"flux2:{base}"

    # 到这里说明 validate 漏了分支，按请求错误处理。
    raise RequestError(f"未知 loader：{loader}")


def release_pipeline() -> None:
    pipe = STATE.pipe
    STATE.pipe = None
    STATE.pipeline_key = None
    STATE.loaded = []
    if pipe is not None:
        # anima 运行时持有文本 embedding 缓存，卸载前先显式清掉。
        release = getattr(pipe, "release", None)
        if callable(release):
            try:
                release()
            except Exception as exc:
                log(f"[load] 清理 pipeline 缓存失败：{short(exc)}")
        try:
            del pipe
        except Exception:
            pass
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def ensure_pipeline(pipeline_spec: dict) -> tuple[object, float]:
    """同一个 pipeline 描述只加载一次；描述变了先卸旧模型再加载。"""
    key = json.dumps(pipeline_spec, sort_keys=True, ensure_ascii=False, default=str)
    if STATE.pipe is not None and STATE.pipeline_key == key:
        return STATE.pipe, 0.0

    if STATE.pipe is not None:
        log("[load] 请求的 pipeline 与已加载的不一致，先卸载旧模型")
        release_pipeline()

    previous_phase = "ready" if STATE.phase == "ready" else STATE.phase
    set_phase("loading", f"加载 {pipeline_spec.get('base')}")
    started = time.time()
    try:
        pipe, identity = build_pipeline(pipeline_spec)
    except RequestError:
        set_phase(previous_phase)
        raise
    except Exception as exc:
        set_phase("error" if previous_phase != "ready" else "ready", f"模型加载失败：{short(exc, 200)}")
        raise

    elapsed = round(time.time() - started, 1)
    STATE.pipe = pipe
    STATE.pipeline_key = key
    STATE.model_id = str(pipeline_spec.get("base"))
    STATE.loaded = [identity]
    try:
        STATE.sig_params = set(inspect.signature(pipe.__call__).parameters.keys())
    except Exception:
        STATE.sig_params = set()
    set_phase("ready")
    log(f"[load] 模型就绪，用时 {elapsed}s（{identity}）")
    return pipe, elapsed


# ─────────────────────────────────────────────────────────────────────────────
# 请求校验与生成
# ─────────────────────────────────────────────────────────────────────────────


def _int_param(value, field: str, low: int, high: int) -> int:  # noqa: ANN001
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise RequestError(f"{field} 必须是整数") from None
    if number < low or number > high:
        raise RequestError(f"{field} 必须在 {low}..{high} 之间，收到 {number}")
    return number


# 契约缺失时的兜底边界（兼容旧 Host / 本地调试）：保持 0.3.0 之前的 daemon 行为。
_FALLBACK_LIMITS: dict[str, dict] = {
    "width": {"min": 64, "max": 2048, "step": 8},
    "height": {"min": 64, "max": 2048, "step": 8},
    "steps": {"min": 1, "max": 80},
    "cfg": {"min": 0, "max": 30},
    "count": {"min": 1, "max": 8},
    "seed": {"max": 2**31 - 1},
    "prompt": {"maxChars": 2000},
}
_MAX_TASKS_FALLBACK = 8


def _limit_spec(name: str) -> dict:
    """取参数边界：优先注入契约 ``CONFIG.contract["limits"]``，缺失时退回内置兜底。"""
    fallback = dict(_FALLBACK_LIMITS[name])
    limits = CONFIG.contract.get("limits") if isinstance(CONFIG.contract, dict) else None
    if not isinstance(limits, dict):
        return fallback
    item = limits.get(name)
    if not isinstance(item, dict):
        return fallback
    merged = dict(fallback)
    for key in ("min", "max", "step", "maxChars"):
        value = item.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            merged[key] = value
    return merged


def _max_tasks() -> int:
    """单次请求任务上限：跟契约的 count 上限对齐（Host 的 count 就是每批张数）。"""
    try:
        value = int(_limit_spec("count").get("max"))
    except (TypeError, ValueError):
        return _MAX_TASKS_FALLBACK
    return value if value > 0 else _MAX_TASKS_FALLBACK


def validate_generate_spec(spec) -> tuple[dict, str, list[dict]]:  # noqa: ANN001
    if not isinstance(spec, dict):
        raise RequestError("请求体必须是 JSON 对象")

    pipeline_spec = spec.get("pipeline")
    if not isinstance(pipeline_spec, dict):
        raise RequestError("缺少 pipeline 对象")
    loader = str(pipeline_spec.get("loader") or "").strip()
    if loader not in SUPPORTED_LOADERS:
        raise RequestError(f"未知 loader：{loader!r}（支持 {', '.join(SUPPORTED_LOADERS)}）")
    base = pipeline_spec.get("base")
    if not isinstance(base, str) or not base.strip():
        raise RequestError("pipeline.base 必须是非空字符串")

    tasks_raw = spec.get("tasks")
    if not isinstance(tasks_raw, list) or not tasks_raw:
        raise RequestError("tasks 必须是非空数组")
    max_tasks = _max_tasks()
    if len(tasks_raw) > max_tasks:
        raise RequestError(f"单次请求最多 {max_tasks} 个任务")

    width_limit = _limit_spec("width")
    height_limit = _limit_spec("height")
    steps_limit = _limit_spec("steps")
    cfg_limit = _limit_spec("cfg")
    seed_limit = _limit_spec("seed")
    prompt_max = int(_limit_spec("prompt").get("maxChars") or 0)
    width_min, width_max = int(width_limit["min"]), int(width_limit["max"])
    height_min, height_max = int(height_limit["min"]), int(height_limit["max"])
    width_step = int(width_limit.get("step") or 8)
    height_step = int(height_limit.get("step") or 8)
    steps_min, steps_max = int(steps_limit["min"]), int(steps_limit["max"])
    cfg_min, cfg_max = cfg_limit["min"], cfg_limit["max"]
    seed_max = int(seed_limit.get("max") or 2**31 - 1)

    model_id = spec.get("modelId") or spec.get("model_id") or base
    tasks: list[dict] = []
    for index, raw in enumerate(tasks_raw):
        if not isinstance(raw, dict):
            raise RequestError(f"tasks[{index}] 必须是对象")
        prompt = raw.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise RequestError(f"tasks[{index}].prompt 必填")
        prompt = prompt.strip()
        if prompt_max > 0 and len(prompt) > prompt_max:
            raise RequestError(f"tasks[{index}].prompt 最长 {prompt_max} 个字符")
        width = _int_param(raw.get("width", 1024), f"tasks[{index}].width", width_min, width_max)
        height = _int_param(raw.get("height", 1024), f"tasks[{index}].height", height_min, height_max)
        steps = _int_param(raw.get("steps", 4), f"tasks[{index}].steps", steps_min, steps_max)
        try:
            cfg = float(raw.get("cfg", 0.0))
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].cfg 必须是数字") from None
        if cfg < cfg_min or cfg > cfg_max:
            raise RequestError(f"tasks[{index}].cfg 必须在 {cfg_min}..{cfg_max} 之间")
        try:
            seed = int(raw.get("seed", -1))
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].seed 必须是整数") from None
        if seed < 0:
            seed = random.randint(0, seed_max)
        elif seed > seed_max:
            raise RequestError(f"tasks[{index}].seed 必须不超过 {seed_max}")
        tasks.append(
            {
                "name": str(raw.get("name") or f"{index + 1:02d}"),
                "prompt": prompt,
                "negative_prompt": str(raw.get("negative_prompt") or "").strip(),
                "seed": seed,
                "width": width - width % width_step,
                "height": height - height % height_step,
                "steps": steps,
                "cfg": cfg,
            }
        )
    return pipeline_spec, str(model_id), tasks


def _encode_png(image) -> bytes:  # noqa: ANN001
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _sync_cuda() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()
    except Exception:
        pass


def run_task(pipe, task: dict) -> dict:  # noqa: ANN001
    """执行单个出图任务，返回与旧 ``/generate`` 完全一致的 results 项。"""
    import torch

    sig = STATE.sig_params
    generator_device = "cuda" if torch.cuda.is_available() else "cpu"
    generator = torch.Generator(device=generator_device).manual_seed(task["seed"])
    call_kwargs = {
        "prompt": task["prompt"],
        "num_inference_steps": task["steps"],
        "guidance_scale": task["cfg"],
        "width": task["width"],
        "height": task["height"],
        "generator": generator,
    }
    # 只有底座支持 negative_prompt 且 CFG > 0 时才有意义（Lightning 的 cfg=0 会被忽略）。
    if task["negative_prompt"] and "negative_prompt" in sig and task["cfg"] > 0.0:
        call_kwargs["negative_prompt"] = task["negative_prompt"]
    if sig:
        call_kwargs = {k: v for k, v in call_kwargs.items() if k in sig}

    log(
        f"[gen] {task['name']} seed={task['seed']} {task['width']}x{task['height']} "
        f"steps={task['steps']} cfg={task['cfg']}"
    )
    started = time.time()
    image = pipe(**call_kwargs).images[0]
    _sync_cuda()
    seconds = round(time.time() - started, 2)
    png = _encode_png(image)
    log(f"[gen] {task['name']} 完成，{seconds}s，{len(png)} 字节")
    return {
        "name": task["name"],
        "seed": task["seed"],
        "seconds": seconds,
        "width": task["width"],
        "height": task["height"],
        "steps": task["steps"],
        "cfg": task["cfg"],
        "png_bytes": len(png),
        "image_b64": base64.b64encode(png).decode("ascii"),
    }


def run_tasks(pipe, tasks: list[dict], on_progress=None) -> list[dict]:  # noqa: ANN001
    """串行跑完一批任务；``on_progress`` 拿到「已完成的结果列表」副本，用于刷新 job 进度。"""
    results: list[dict] = []
    for task in tasks:
        STATE.last_active = time.time()
        results.append(run_task(pipe, task))
        if on_progress is not None:
            try:
                on_progress(results)
            except Exception as exc:  # pragma: no cover - 进度回调不应影响出图
                log(f"[job] WARN 进度回调失败：{short(exc)}")
    return results


def classify_failure(exc: BaseException, default: str = "generation_failed") -> tuple[str, str]:
    message = short(exc, 800)
    if _is_oom(exc):
        return "oom", f"显存不足：{message}"
    if isinstance(exc, RequestError):
        return "invalid_request", message
    if isinstance(exc, LoadError):
        return "load_failed", message
    return default, message


# ── 异步 job：worker 与执行 ──────────────────────────────────────────────────


def _update_job_progress(job: Job, partial: list[dict]) -> None:
    with JOB_LOCK:
        job.results = list(partial)
        job.updated_at = time.time()


def _finish_job(job: Job, status: str, error: dict | None = None) -> None:
    """收尾：置终态、记结束时间、进淘汰队列，并刷新 last_active。"""
    now = time.time()
    with JOB_LOCK:
        job.status = status
        job.error = error
        job.updated_at = now
        job.finished_at = now
        JOB_FINISHED_ORDER.append(job.job_id)
        prune_jobs(now)
    STATE.last_active = now


def execute_job(job: Job) -> None:
    """worker 里执行单个 job：加载 pipeline → 逐张出图 → 更新进度/终态。

    异常一律收在内部转成 job.error，绝不让 worker 线程退出。
    """
    with JOB_LOCK:
        job.status = JOB_STATUS_RUNNING
        job.updated_at = time.time()
    STATE.last_active = time.time()
    GEN_LOCK.acquire()
    try:
        started = time.time()
        pipe, load_seconds = ensure_pipeline(job.pipeline)
        with JOB_LOCK:
            job.load_seconds = load_seconds
            job.updated_at = time.time()
        STATE.last_active = time.time()
        results = run_tasks(
            pipe,
            job.tasks,
            on_progress=lambda partial: _update_job_progress(job, partial),
        )
        with JOB_LOCK:
            job.results = list(results)
        STATE.jobs_done += len(results)
        total = round(time.time() - started, 2)
        log(
            f"[job] {job.job_id} 完成：{len(results)} 张，总耗时 {total}s"
            f"（加载 {load_seconds}s）"
        )
        _finish_job(job, JOB_STATUS_DONE)
    except BaseException as exc:  # noqa: BLE001 - 后台线程必须收住所有异常
        code, message = classify_failure(exc)
        if code == "oom":
            free_cuda_cache()
        record_error(code, message)
        log(f"[job] {job.job_id} 失败（{code}）：{message}")
        log(traceback.format_exc())
        _finish_job(job, JOB_STATUS_FAILED, {"code": code, "message": message})
    finally:
        try:
            GEN_LOCK.release()
        except RuntimeError:  # pragma: no cover - 理论上不会发生
            pass
        STATE.last_active = time.time()


def job_worker_loop() -> None:
    """常驻 worker：串行消费 JOB_QUEUE。"""
    log("[job] worker 启动，等待队列")
    while not BOOT.stop_event.is_set():
        with JOB_LOCK:
            job = JOB_QUEUE.popleft() if JOB_QUEUE else None
        if job is None:
            JOB_WAKE.wait(timeout=0.5)
            JOB_WAKE.clear()
            continue
        job_started = time.time()
        try:
            execute_job(job)
        except BaseException as exc:  # pragma: no cover - execute_job 自身已兜底
            log(f"[job] worker 捕获异常：{short(exc)}")
            if job.status not in (JOB_STATUS_DONE, JOB_STATUS_FAILED):
                _finish_job(job, JOB_STATUS_FAILED, {"code": "generation_failed", "message": short(exc)})
        log(f"[job] {job.job_id} 处理结束（{round(time.time() - job_started, 1)}s）")


def start_job_worker() -> threading.Thread:
    thread = threading.Thread(target=job_worker_loop, name="job-worker", daemon=True)
    thread.start()
    return thread


# ─────────────────────────────────────────────────────────────────────────────
# HTTP 服务
# ─────────────────────────────────────────────────────────────────────────────


def health_payload() -> dict:
    return {
        "status": "error" if STATE.phase == "error" else "ok",
        "phase": STATE.phase,
        "version": protocol_version(),
        "model_id": STATE.model_id,
        "loaded": list(STATE.loaded),
        "device": STATE.device,
        "device_count": STATE.device_count,
        "idle_seconds": round(time.time() - STATE.last_active, 1),
        "idle_timeout_sec": CONFIG.idle_timeout_sec,
        "jobs_done": STATE.jobs_done,
        # 0.5.0：排队中（尚未开始执行）的 job 数；运行中的不算。
        "queue_depth": queue_depth(),
        "last_error": STATE.last_error,
        "last_error_code": STATE.last_error_code,
        "detail": STATE.detail,
        "uptime_seconds": round(time.time() - STATE.started_at, 1),
        # P0.2 / P2.2：隧道监管状态，Host 用于「重连中 / 通道类型」展示与故障归因。
        "tunnel_provider": BOOT.tunnel_provider,
        "tunnel_state": BOOT.tunnel_state,
        "tunnel_restarts": BOOT.tunnel_restarts,
    }


class DaemonHandler(BaseHTTPRequestHandler):
    server_version = f"imagen-daemon/{VERSION}"
    sys_version = ""

    # 默认实现会把每行请求写 stderr；这里只写控制台，避免 /health 轮询把日志环刷满。
    def log_message(self, fmt, *args):  # noqa: ANN001
        try:
            _ORIG_STDERR.write(f"[http] {self.address_string()} - {fmt % args}\n")
            _ORIG_STDERR.flush()
        except Exception:
            pass

    # ---- 基础响应 ----
    def _send_json(self, code: int, payload: dict, extra_headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _send_error(self, code: int, error_code: str, message: str, headers: dict | None = None) -> None:
        self._send_json(code, {"error": {"code": error_code, "message": message}}, headers)

    def _require_auth(self) -> bool:
        expected = CONFIG.auth_token
        if not expected:
            # 安全修复：没有 token 时默认不放行（本地调试需显式 allow_no_auth=true）。
            if CONFIG.allow_no_auth:
                return True
            self._send_error(
                401,
                "unauthorized",
                "Daemon 未配置 auth_token，拒绝请求（本地调试请显式配置 allow_no_auth=true）",
            )
            return False
        header = self.headers.get("Authorization", "") or ""
        if header.startswith("Bearer "):
            provided = header[len("Bearer ") :].strip()
            if hmac.compare_digest(provided, expected):
                return True
        self._send_error(401, "unauthorized", "缺少或错误的 Bearer Token")
        return False

    def _read_json(self):  # noqa: ANN202
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return {}
        if length > 8 * 1024 * 1024:
            raise RequestError("请求体超过 8MB")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RequestError(f"请求体不是合法 JSON：{type(exc).__name__}") from None

    # ---- 路由 ----
    def do_GET(self):  # noqa: N802
        if not self._require_auth():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"
        query = urllib.parse.parse_qs(parts.query)
        if path == "/health":
            self._send_json(200, health_payload())
            return
        if path == "/logs":
            try:
                since = int((query.get("since") or ["0"])[0])
            except (TypeError, ValueError):
                since = 0
            lines, nxt = log_since(since)
            self._send_json(200, {"lines": lines, "next": nxt})
            return
        if path == "/job":
            job_id = str((query.get("id") or [""])[0]).strip()
            if not job_id:
                self._send_error(400, "invalid_request", "缺少 job id（GET /job?id=...）")
                return
            job = get_job(job_id)
            if job is None:
                self._send_error(404, "unknown_job", "任务不存在或已过期")
                return
            self._send_json(200, job_payload(job))
            return
        self._send_error(404, "not_found", f"未知路径：{path}")

    def do_POST(self):  # noqa: N802
        if not self._require_auth():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"

        if path == "/shutdown":
            request_shutdown()
            self._send_json(200, {"status": "shutting_down"})
            threading.Thread(target=self._delayed_exit, daemon=True).start()
            return

        if path == "/generate":
            self._handle_generate()
            return

        self._send_error(404, "not_found", f"未知路径：{path}")

    @staticmethod
    def _delayed_exit() -> None:
        time.sleep(0.3)
        os._exit(0)

    def _handle_generate(self) -> None:
        phase = STATE.phase
        if phase != "ready":
            if phase == "error":
                message = STATE.last_error or "Daemon 启动失败"
                self._send_error(503, "load_failed", message)
            else:
                # Host 正常不会在 ready 之前调用；这里给它一个可重试的明确信号。
                self._send_error(
                    503,
                    "warming",
                    f"Daemon 尚未就绪（phase={phase}），请稍后重试",
                    {"Retry-After": "5"},
                )
            return

        try:
            spec = self._read_json()
            pipeline_spec, model_id, tasks = validate_generate_spec(spec)
            job_id = normalize_job_id(spec.get("jobId"))
        except RequestError as exc:
            log(f"[gen] 请求非法：{exc}")
            self._send_error(400, "invalid_request", str(exc))
            return

        try:
            job, created = submit_job(pipeline_spec, model_id, tasks, job_id)
        except Exception as exc:  # pragma: no cover - 入队本身不涉及 IO
            log(f"[gen] 入队失败：{short(exc)}")
            self._send_error(500, "generation_failed", short(exc))
            return

        STATE.last_active = time.time()
        if not created:
            log(f"[gen] 幂等命中 {job.job_id}（status={job.status}），不重复入队")
        self._send_json(
            202,
            {
                "status": "accepted",
                "job_id": job.job_id,
                "model_id": job.model_id,
                "created_at": iso_time(job.created_at),
            },
        )


def start_http_server(port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), DaemonHandler)
    server.daemon_threads = True
    threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.5},
        name="http-server",
        daemon=True,
    ).start()
    log(f"[http] 监听 127.0.0.1:{port}")
    return server


# ─────────────────────────────────────────────────────────────────────────────
# 隧道（cloudflared quick tunnel + 可配置备用通道）
#
# P0.2：隧道启动/监管拆成小而纯的函数，子进程与输出读取用替身即可离线覆盖：
#   normalize_tunnel_command / extract_tunnel_url / tunnel_url_regex / build_tunnel_plan /
#   tunnel_attempt（单通道尝试）/ tunnel_monitor（常驻监管与指数退避重拉）。
# P2.2：cloudflared 失败或超时后按 provider 计划尝试备用命令，成功后 provider='custom'。
# ─────────────────────────────────────────────────────────────────────────────


def ensure_cloudflared() -> str:
    if os.path.exists(CLOUDFLARED_PATH) and os.access(CLOUDFLARED_PATH, os.X_OK):
        log("[tunnel] 复用已存在的 /tmp/cloudflared")
        return CLOUDFLARED_PATH

    log("[tunnel] 下载 cloudflared 到 /tmp …")
    partial = CLOUDFLARED_PATH + ".part"
    total = 0
    with urllib.request.urlopen(CLOUDFLARED_DOWNLOAD_URL, timeout=120) as response, open(partial, "wb") as handle:
        while True:
            chunk = response.read(1 << 16)
            if not chunk:
                break
            handle.write(chunk)
            total += len(chunk)
    os.replace(partial, CLOUDFLARED_PATH)
    os.chmod(CLOUDFLARED_PATH, 0o755)
    log(f"[tunnel] cloudflared 就绪（{round(total / 2**20, 1)} MB）")
    return CLOUDFLARED_PATH


def normalize_tunnel_command(command, port: int) -> list[str]:  # noqa: ANN001
    """argv 模板规整：过滤空项、替换 ``{port}``；没有任何占位符时把端口追加到末尾。"""
    if not isinstance(command, (list, tuple)):
        return []
    argv: list[str] = []
    has_placeholder = False
    for item in command:
        if not isinstance(item, str) or not item.strip():
            continue
        if "{port}" in item:
            has_placeholder = True
            argv.append(item.replace("{port}", str(port)))
        else:
            argv.append(item)
    if argv and not has_placeholder:
        argv.append(str(port))
    return argv


def extract_tunnel_url(line, pattern) -> str | None:  # noqa: ANN001
    """从一行输出里提取隧道地址（去掉句末标点）；匹配不到返回 None。"""
    if not isinstance(line, str) or not line:
        return None
    try:
        match = pattern.search(line)
    except Exception:
        return None
    if not match:
        return None
    return match.group(0).rstrip(".,;)")


def tunnel_url_regex(pattern: str | None = None):  # noqa: ANN202 - 返回编译后的正则
    """备用通道的地址提取规则：配置优先，非法或缺省时回退内置 https 规则。"""
    if isinstance(pattern, str) and pattern.strip():
        try:
            return re.compile(pattern)
        except re.error as exc:
            log(f"[tunnel] WARN fallback_tunnel_url_regex 非法（{exc}），改用默认规则")
    return DEFAULT_CUSTOM_URL_RE


def build_tunnel_plan(port: int) -> list[dict]:
    """按尝试顺序给出通道计划：cloudflare 优先，配置了备用命令再追加 custom。"""
    plan = [
        {
            "provider": "cloudflare",
            "argv": [CLOUDFLARED_PATH, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            "url_re": CLOUDFLARED_URL_RE,
            "wait_sec": TUNNEL_WAIT_SEC,
        }
    ]
    custom = normalize_tunnel_command(CONFIG.fallback_tunnel_command, port)
    if custom:
        plan.append(
            {
                "provider": "custom",
                "argv": custom,
                "url_re": tunnel_url_regex(CONFIG.fallback_tunnel_url_regex),
                "wait_sec": TUNNEL_WAIT_SEC,
            }
        )
    return plan


def tunnel_restart_delay(attempt: int) -> float:
    """指数退避：2、4、8、16、32、60（封顶）；attempt 从 1 开始。"""
    exponent = max(0, int(attempt) - 1)
    return min(TUNNEL_RESTART_MAX_SEC, TUNNEL_RESTART_BASE_SEC * (2**exponent))


def tunnel_should_stop() -> bool:
    """隧道监管是否该退出（/shutdown、信号或显式置位）。"""
    return BOOT.stop_event.is_set() or STATE.shutting_down


def _spawn_tunnel_process(argv: list[str], provider: str = "cloudflare"):  # noqa: ANN202 - 返回 Popen 或 None
    """启动隧道子进程；失败只记录原因，交给下一个通道或下一轮重试。

    cloudflared 把地址打在 stderr；自建通道（bore / frpc 等）通常打在 stdout，
    因此对 custom 合并两个流，避免「进程活着但永远读不到地址」。
    """
    log(f"[tunnel] 启动隧道进程：{' '.join(argv)}")
    try:
        if provider == "cloudflare":
            return subprocess.Popen(
                argv,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        return subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        BOOT.tunnel_error = f"隧道命令启动失败：{short(exc)}"
        log(f"[tunnel] {BOOT.tunnel_error}")
        return None


def _drain_tunnel_output(proc, provider: str, url_re, url_event: threading.Event) -> None:  # noqa: ANN001
    """持续读取隧道输出，首个地址写入 BOOT 并置位事件；必须读到进程退出为止。

    拿到地址后停止读取会让管道写满、隧道卡死（实测过的故障），所以这里不提前返回。
    """
    prefix = "cloudflared" if provider == "cloudflare" else f"tunnel:{provider or 'custom'}"
    found_url: str | None = None
    try:
        # cloudflared 用 stderr，自建通道合并到 stdout；两者取其一即可。
        stream = getattr(proc, "stderr", None)
        if stream is None:
            stream = getattr(proc, "stdout", None)
        if stream is not None:
            for raw_line in stream:
                line = str(raw_line).rstrip()
                if not line:
                    continue
                log(f"[{prefix}] {line}")
                if found_url is None:
                    candidate = extract_tunnel_url(line, url_re)
                    if candidate:
                        found_url = candidate
                        BOOT.tunnel_url = candidate
                        BOOT.tunnel_provider = provider
                        url_event.set()
    except Exception as exc:
        log(f"[tunnel] 读取 {prefix} 输出出错：{short(exc)}")
    finally:
        try:
            code = proc.poll()
        except Exception:
            code = None
        log(f"[tunnel] {prefix} 输出结束（退出码 {code}，地址={found_url}）")
        if found_url is None:
            BOOT.tunnel_error = f"{prefix} 未给出隧道地址（退出码 {code}）"
            url_event.set()


def terminate_tunnel_process(proc) -> None:  # noqa: ANN001
    """尽力结束隧道子进程（超时/退出后换通道或停机时调用）。"""
    if proc is None:
        return
    try:
        proc.terminate()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
        return
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass


def tunnel_attempt(item: dict) -> tuple[str, object] | None:
    """启动一个通道并等待地址：成功返回 (provider, proc)，失败返回 None。"""
    provider = str(item.get("provider") or "")
    argv = list(item.get("argv") or [])
    if not argv:
        BOOT.tunnel_error = f"{provider or '隧道'} 通道命令为空"
        log(f"[tunnel] {BOOT.tunnel_error}")
        return None
    BOOT.tunnel_url = None
    BOOT.tunnel_error = None
    proc = _spawn_tunnel_process(argv, provider)
    if proc is None:
        return None
    BOOT.cloudflared = proc
    url_event = threading.Event()
    threading.Thread(
        target=_drain_tunnel_output,
        args=(proc, provider, item.get("url_re") or DEFAULT_CUSTOM_URL_RE, url_event),
        name=f"tunnel-drain-{provider or 'custom'}",
        daemon=True,
    ).start()
    wait_sec = float(item.get("wait_sec") or TUNNEL_WAIT_SEC)
    if url_event.wait(wait_sec) and BOOT.tunnel_url:
        return provider, proc
    if BOOT.tunnel_error is None:
        BOOT.tunnel_error = f"{provider or '隧道'} 在 {int(wait_sec)}s 内未给出隧道地址"
    log(f"[tunnel] WARN 通道 {provider or 'unknown'} 未建立：{BOOT.tunnel_error}")
    terminate_tunnel_process(proc)
    return None


def start_tunnel(port: int) -> tuple[str, object] | None:
    """按 provider 计划依次尝试；cloudflared 下载失败时仍会尝试备用通道。"""
    for item in build_tunnel_plan(port):
        if tunnel_should_stop():
            return None
        if item["provider"] == "cloudflare":
            try:
                binary = ensure_cloudflared()
            except Exception as exc:
                BOOT.tunnel_error = f"cloudflared 下载失败：{short(exc)}"
                log(f"[tunnel] WARN {BOOT.tunnel_error}，尝试下一个通道")
                continue
            item["argv"] = [binary, *item["argv"][1:]]
        result = tunnel_attempt(item)
        if result is not None:
            return result
    return None


def recover_tunnel_error() -> None:
    """隧道恢复后清掉 tunnel_failed 错误态，避免 Host 把 /health 当成致命错误。

    即使错误被运行时的 phase 覆盖过（runtime_boot 末尾会写 ready），last_error
    也会残留给 Host 拼 UI，所以这里一并清掉。
    """
    if STATE.last_error_code != "tunnel_failed":
        return
    STATE.last_error = None
    STATE.last_error_code = None
    if STATE.phase == "error":
        phase = BOOT.phase_before_error if BOOT.phase_before_error not in (None, "error") else "booting"
        set_phase(phase, "隧道已恢复")
    else:
        log(f"[tunnel] 隧道恢复，清除残留错误记录（phase={STATE.phase}）")


def announce_tunnel_ready(provider: str, *, restarted: bool = False) -> None:
    """隧道（重新）建立：记录通道类型、清隧道错误并重播 ready。"""
    BOOT.tunnel_provider = provider
    BOOT.tunnel_state = "up"
    BOOT.tunnel_error = None
    suffix = "（重连后重播 ready）" if restarted else ""
    log(f"[tunnel] 通道 {provider} 就绪：{BOOT.tunnel_url}{suffix}")
    recover_tunnel_error()
    BOOT.published_ready = True
    publish_ready()


def tunnel_wait_exit(proc, poll_interval: float = 1.0):  # noqa: ANN001, ANN202
    """常驻等待隧道进程退出；收到停机信号时返回 None。"""
    while not tunnel_should_stop():
        try:
            code = proc.poll()
        except Exception:
            return None
        if code is not None:
            return code
        time.sleep(max(0.01, float(poll_interval)))
    return None


def tunnel_monitor(port: int) -> None:
    """常驻监管：拉起隧道 → 等进程退出 / 失败退避重拉；直到收到停机信号。

    语义：
      - 首次就失败：保留旧行为 ``fail_boot('tunnel_failed')`` 并继续在后台重试；
      - 已就绪后进程中途退出：只记录 warn 并重拉（不把整个 daemon 判成 error）；
      - 任何一次成功都重播 ready，让 Host 在心跳丢失后重新会合。
    """
    attempt = 0
    ever_ready = False
    failure_reported = False
    while not tunnel_should_stop():
        if attempt > 0:
            BOOT.tunnel_restarts += 1
            delay = tunnel_restart_delay(attempt)
            log(f"[tunnel] {delay:.0f}s 后重拉隧道（累计重启 {BOOT.tunnel_restarts} 次）")
            if BOOT.stop_event.wait(delay):
                break
        BOOT.tunnel_state = "starting"
        result = start_tunnel(port)
        if result is None:
            if tunnel_should_stop():
                break
            BOOT.tunnel_state = "down"
            attempt += 1
            message = BOOT.tunnel_error or "隧道未建立（所有通道均失败）"
            if not ever_ready and not failure_reported:
                BOOT.phase_before_error = STATE.phase
                fail_boot("tunnel_failed", message, tunnel=True)
                failure_reported = True
            else:
                log(f"[tunnel] 重试仍失败：{message}")
            continue
        provider, proc = result
        attempt = 0
        ever_ready = True
        announce_tunnel_ready(provider, restarted=BOOT.tunnel_restarts > 0)
        code = tunnel_wait_exit(proc)
        if tunnel_should_stop():
            log("[tunnel] 收到停机信号，结束隧道监管")
            terminate_tunnel_process(proc)
            break
        log(f"[tunnel] WARN 通道 {provider} 进程退出（退出码 {code}），准备重拉")
        BOOT.tunnel_state = "down"
        BOOT.tunnel_url = None
        BOOT.published_ready = False
        BOOT.tunnel_error = f"{provider} 进程异常退出（退出码 {code}）"
        attempt = 1


def tunnel_boot(port: int) -> None:
    """启动常驻隧道监管线程（不阻塞 HTTP 服务与运行时启动）。"""
    BOOT.tunnel_state = "starting"
    log("[tunnel] 启动隧道监管（cloudflared 优先，失败自动重拉）")
    threading.Thread(target=tunnel_monitor, args=(port,), name="tunnel-monitor", daemon=True).start()


# ─────────────────────────────────────────────────────────────────────────────
# 启动流程
# ─────────────────────────────────────────────────────────────────────────────


def _log_environment() -> None:
    log(f"[env] python={platform.python_version()} platform={platform.platform()}")
    for path in ("/kaggle/working", "/tmp", os.getcwd()):
        try:
            usage = shutil.disk_usage(path)
            log(f"[env] disk {path}: free={usage.free / 2**30:.1f}GiB total={usage.total / 2**30:.1f}GiB")
        except Exception:
            continue


def runtime_boot() -> None:
    """后台线程：探测 GPU → 装依赖 →（可选）预加载模型 → phase=ready。"""
    try:
        import torch

        if torch.cuda.is_available():
            STATE.device = torch.cuda.get_device_name(0)
            STATE.device_count = torch.cuda.device_count()
            log(f"[cuda] {STATE.device} × {STATE.device_count}，torch={torch.__version__}，cuda={torch.version.cuda}")
        else:
            STATE.device = None
            STATE.device_count = 0
    except Exception as exc:
        log(f"[cuda] 导入 torch 失败：{short(exc)}")

    if not STATE.device_count:
        message = (
            "未检测到可用 GPU（torch.cuda.is_available() 为 False）。"
            "Kaggle 静默降级到 CPU 时请检查设置里的手机号验证。"
        )
        fail_boot("load_failed", message)
        return

    try:
        install_dependencies()
    except Exception as exc:
        fail_boot("load_failed", short(exc))
        return

    preload = CONFIG.preload
    if preload:
        try:
            ensure_pipeline(preload)
        except Exception as exc:
            code, message = classify_failure(exc, default="load_failed")
            fail_boot(code, message)
            return

    if STATE.phase != "ready":
        set_phase("ready", "依赖已就绪，等待首个生成请求下发 pipeline")
    log("[boot] 运行时就绪，可以接单")


def _install_signal_handlers() -> None:
    try:
        import signal

        def _bye(signum, _frame):  # noqa: ANN001
            log(f"[signal] 收到信号 {signum}，退出进程")
            BOOT.stop_event.set()
            os._exit(0)

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                signal.signal(sig, _bye)
            except Exception:
                pass
    except Exception:
        pass


def main() -> None:
    global CONFIG

    install_stream_tee()
    _install_signal_handlers()
    STATE.started_at = time.time()
    STATE.last_active = STATE.started_at

    log("=" * 72)
    log(f"imagen 远端 Daemon v{protocol_version()} 启动")
    try:
        CONFIG = load_config()
    except SystemExit as exc:
        log(f"[config] {exc}")
        os._exit(2)
        return
    _log_environment()
    # P1.2：HF_TOKEN 必须在任何下载/加载之前写好（gated 仓库与匿名限流都依赖它）。
    apply_hf_token()

    # 0) 安全闸门：没有 auth_token 且没有显式允许无鉴权 → 拒绝对外服务（不发布 ready）。
    if auth_missing():
        message = "未配置 auth_token 且未开启 allow_no_auth，拒绝以无鉴权模式对外提供服务"
        log(f"[boot] {message}")
        fail_boot("unauthorized", message)
        os._exit(4)
        return

    # 1) HTTP 先起来：Host 靠 /health 判断 phase，不依赖模型是否加载完。
    try:
        start_http_server(CONFIG.port)
    except Exception as exc:
        log(f"[http] 端口 {CONFIG.port} 监听失败：{short(exc)}")
        os._exit(3)
        return

    # 1.5) 异步 job worker：常驻线程串行消费 /generate 入队的任务。
    #      放在 HTTP 之后启动，这样即使首图加载慢，Host 的 /health 也一直可用。
    start_job_worker()

    # 2) 隧道与运行时各自后台跑，互不阻塞（tunnel_boot 自己拉起监管线程）。
    tunnel_boot(CONFIG.port)
    threading.Thread(target=runtime_boot, name="runtime-boot", daemon=True).start()

    # 3) 主线程：会合点发布 + 周期性重播 + 空闲看门狗。
    #    只要隧道地址到手就发布 ready，让 Host 立刻能建立 /health 心跳并从 phase
    #    看到 installing / loading 的进度；模型是否加载完由 /health 回答，不靠会合点。
    #    隧道监管线程负责中途重拉后的重播，这里只兜底首次发布与周期重播。
    last_report = 0.0
    last_announce = time.time()
    while True:
        time.sleep(2.0)
        now = time.time()

        if BOOT.tunnel_url and not BOOT.published_ready:
            BOOT.published_ready = True
            publish_ready()

        # P0.2：每 TUNNEL_ANNOUNCE_SEC 秒重播一次 ready，Host 心跳丢失后可重新会合。
        if BOOT.tunnel_url and now - last_announce >= TUNNEL_ANNOUNCE_SEC:
            last_announce = now
            log(
                f"[tunnel] 周期重播 ready（通道 {BOOT.tunnel_provider or 'unknown'}，"
                f"间隔 {int(TUNNEL_ANNOUNCE_SEC)}s）"
            )
            threading.Thread(target=publish_ready, name="announce-ready", daemon=True).start()

        idle = now - STATE.last_active
        busy = active_job_count() > 0 or GEN_LOCK.locked()
        # 启动阶段（装依赖/预加载）不参与空闲退出：Host 可能把 idle_timeout 调得很短，
        # 但首轮加载本来就要几分钟。失败进入 error 后照样会被看门狗收走。
        bootstrapping = STATE.phase in ("booting", "installing", "loading")
        if not busy and not bootstrapping and idle >= CONFIG.idle_timeout_sec:
            log(f"[idle] 空闲 {int(idle)}s ≥ {CONFIG.idle_timeout_sec}s，退出进程释放 GPU 配额")
            os._exit(0)

        if now - last_report >= 30:
            last_report = now
            log(
                f"[alive] phase={STATE.phase} idle={int(idle)}s jobs={STATE.jobs_done} "
                f"queue={queue_depth()} tunnel={'ok' if BOOT.tunnel_url else 'pending'}"
            )


if __name__ == "__main__":
    main()
