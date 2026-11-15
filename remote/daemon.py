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
11. **0.8.0 切模型缓存清理**：Kaggle 20GB 磁盘放不下两个大模型的全量权重。切换
    pipeline 时先释放旧模型，再按「目标模型依赖 + 预挂载仓库」构建 keep_set，把
   HF 缓存里其余 ``models--*`` 按 mtime 旧→新删除；每次删完重读磁盘，够了就停，
   清完仍不足才抛「磁盘空间不足」。只读挂载目录永远不碰。
12. **0.8.0 无 GPU 明确报错**：Kaggle 账号未完成手机号验证时会静默降级成 CPU 容器。
   启动阶段检测到没 GPU 就立刻 ``fail_boot('gpu_unavailable', …)``，文案直接给出
   「手机号验证 + 启用 GPU 加速器」的下一步；``/health.last_error_code`` 与 ntfy
   ``error`` 事件都带该码，Host 据此出专用指引卡，不再用 CPU 硬跑。
13. **0.8.1 固定 cloudflared 版本**：下载地址从滚动的 ``/releases/latest/download/``
   改为固定 tag，并对 ``cloudflared-linux-amd64`` 做 SHA256 校验（``CLOUDFLARED_SHA256``）。
   上游发版或网络只传半截文件时不再留下坏二进制：校验不匹配会删掉重下一次，
   两次都失败就带着「期望 / 实际」校验和报错，Host 侧能看到明确原因并回退备用通道。
14. **图生图（垫图重绘）**：job spec 可选 ``reference: {image_b64, strength}``，一张参考图
    跑整批 count。提交期（``parse_reference_spec``）只读图片头做校验：loader 白名单
    （仅 SDXL 家族）、base64 与原始字节上限、PNG/JPEG、最小长边、strength 归一，
    不合法直接 400；执行期（``decode_reference_image``）完整解码恰好一次，长边超过
    ``contract.limits.reference.maxEdge`` 时等比 LANCZOS 缩小、转 RGB。图生图管线用
    ``AutoPipelineForImage2Image.from_pipe`` 复用已加载的 txt2img 底座，不重复加载、
    不额外占显存，随 ``STATE.pipeline_key`` 切换与 ``release_pipeline()`` 一起清理。
"""

from __future__ import annotations

import base64
import binascii
import gc
import hashlib
import hmac
import importlib.metadata
import inspect
import io
import json
import math
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
# Host 注入点：推 Kaggle 时由启动器（remote/_entry.py）在 import 之后调用下面的
# set_embedded_config()；本地直接跑本文件时保持空串，走"无注入配置"的兜底路径。
# 不要改成环境变量或文件读取：配置里有 auth_token，只允许存在于内存与临时目录里。
# ─────────────────────────────────────────────────────────────────────────────
EMBEDDED_CONFIG_B64 = ""


def set_embedded_config(value: str) -> None:
    """写入本次会话的注入配置（启动器唯一的注入入口）。

    为什么是函数而不是让启动器直接改 `EMBEDDED_CONFIG_B64`：后续把配置相关代码搬进
    `remote/config.py` 时，只要入口模块继续 re-export 本函数，注入链路就自动跟着走；
    而直接赋值模块属性只改"名字"，搬家后会静默丢配置（表现为启动即 unauthorized 退出）。
    """
    global EMBEDDED_CONFIG_B64
    EMBEDDED_CONFIG_B64 = value or ""

VERSION = "0.10.0"

DEFAULT_PORT = 7860

# 依赖约束默认留空（0.4.1 修正）。0.4.0 曾内置「版本上限」做固化
# （diffusers<1.0 / transformers<5 / accelerate<2 / peft<1），实测与当前 diffusers
# 新版直接冲突：diffusers 0.42+ 依赖 huggingface-hub>=1.32，而 transformers 4.x
# 要求 huggingface-hub<1.0，pip 只能回溯到 2019 年的 transformers 4.12.2；在
# Kaggle 镜像存在预装包时解析直接失败（远端表现 load_failed: pip install 退出码 1）。
# 需要固定版本时用 Host 的 `pipConstraints` 显式钉一组自己验证过的组合；默认装
# 最新兼容组合，再用导入自检兜底。
PIP_CONSTRAINTS: dict[str, str] = {}
IMPORT_CHECK_MODULES = ("torch", "diffusers", "transformers", "accelerate", "peft")

SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2", "anima")
# 图生图（垫图重绘）首期只开放能整管复用 AutoPipelineForImage2Image 的 SDXL 家族。
# 这是提交期的最后一道兜底：模型资产里的 supportsImg2Img 由 Host/客户端使用，daemon 不信它。
SUPPORTED_IMG2IMG_LOADERS = ("sdxl", "sdxl-lora")
# 参考图允许的容器格式（PIL ``img.format``）：只接受无损 PNG 与常见照片 JPEG。
REFERENCE_IMAGE_FORMATS = ("PNG", "JPEG")

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
JOB_MAX_QUEUE_DEPTH = 16
JOB_TTL_SEC = 600.0
JOB_ID_MAX_CHARS = 64
JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_DONE = "done"
JOB_STATUS_FAILED = "failed"

# ─────────────────────────────────────────────────────────────────────────────
# 日志环（单份源码在 remote/log_ring.py，随源码包一起推送到 Kaggle）
# ─────────────────────────────────────────────────────────────────────────────

from log_ring import LOG_LINE_MAX_CHARS, LOG_MAX_LINES, _LOG_LINES, _LOG_LOCK, _LOG_SEQ, _NOISE_RE, _ORIG_STDERR, _ORIG_STDOUT, _START_TS, _StreamTee, _console, _elapsed, _ring_append, install_stream_tee, log, log_since, reset_log_ring  # noqa: E402


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
    # 图生图管线：首次用到时用 AutoPipelineForImage2Image.from_pipe(STATE.pipe) 惰性创建，
    # 与 txt2img 共用组件（不额外加载权重、不额外占显存）；切换/释放底座时一并清空。
    img2img_pipe: object | None = None
    img2img_sig_params: set = field(default_factory=set)
    booted: bool = False
    shutting_down: bool = False


@dataclass
class Job:
    """一次 /generate 提交（异步执行）。所有字段读写都在 JOB_LOCK 保护下。"""

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


@dataclass
class _TunnelAttempt:
    """单次隧道启动尝试的令牌：超时后失活，防止旧 drain 线程污染新尝试的 BOOT 状态。"""

    provider: str = ""
    active: bool = True


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
    http_server: object | None = None
    current_attempt: _TunnelAttempt | None = None
    # /shutdown 或信号置位后监管线程退出。整个进程只创建一个 Event。
    stop_event: threading.Event = field(default_factory=threading.Event)


CONFIG = DaemonConfig()
STATE = RuntimeState()
BOOT = BootState()
# 状态锁与生成串行锁；不放状态对象里，避免状态复制时复制锁。
STATE_LOCK = threading.RLock()
BOOT_LOCK = threading.RLock()
GEN_LOCK = threading.Lock()
_CLEANUP_LOCK = threading.Lock()
_CLEANUP_DONE = False

# 异步 job 表：队列（待执行）/ 全表（含运行中与已结束）/ 结束顺序（淘汰用）。
JOB_LOCK = threading.RLock()
JOB_QUEUE: deque = deque()
JOB_TABLE: dict[str, Job] = {}
JOB_FINISHED_ORDER: deque = deque()
JOB_COND = threading.Condition(JOB_LOCK)


class _JobWakeCompat:
    """兼容旧调用与单测里的 JOB_WAKE.set()/clear()，底层委托给 JOB_COND。"""

    def set(self) -> None:
        with JOB_COND:
            JOB_COND.notify_all()

    def clear(self) -> None:
        pass

    def wait(self, timeout: float | None = None) -> bool:
        with JOB_COND:
            return JOB_COND.wait(timeout=timeout)


JOB_WAKE = _JobWakeCompat()


class RequestError(ValueError):
    """请求本身不合法 → HTTP 400 invalid_request。"""


class LoadError(RuntimeError):
    """模型加载失败 → HTTP 500 load_failed。"""


class QueueFullError(RuntimeError):
    """任务队列达到上限 → HTTP 429 queue_full。"""


def short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    text = " ".join(text.split())
    return text[:limit]


def set_phase(phase: str, detail: str | None = None) -> None:
    with STATE_LOCK:
        STATE.phase = phase
        STATE.detail = detail
        # 启动阶段的进度也算"活动"，避免依赖安装还没结束就被空闲看门狗收走。
        STATE.last_active = time.time()
    log(f"[phase] {phase}" + (f" — {detail}" if detail else ""))


def record_error(code: str, message: str) -> None:
    """``/health.last_error`` 是字符串：Host 直接拼进 UI，对象会显示成 [object Object]。"""
    with STATE_LOCK:
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


def _max_queue_depth() -> int:
    """允许排队的最大待执行 job 数（防止内存 DoS）。"""
    limits = CONFIG.contract.get("limits") if isinstance(CONFIG.contract, dict) else None
    queue_cfg = limits.get("queue") if isinstance(limits, dict) else None
    raw = queue_cfg.get("maxPending") if isinstance(queue_cfg, dict) else None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and int(raw) > 0:
        return int(raw)
    return JOB_MAX_QUEUE_DEPTH


def submit_job(
    pipeline_spec: dict,
    model_id: str,
    tasks: list[dict],
    job_id: str | None = None,
    reference: dict | None = None,
):
    """入队；``job_id`` 命中已有 job 时原样返回（幂等，不重复入队）。

    ``reference`` 是提交期校验并归一过的参考图（见 ``parse_reference_spec``），
    文生图请求传 None。返回 ``(job, created)``：created=False 表示命中了幂等键。
    """
    with JOB_LOCK:
        prune_jobs()
        if job_id:
            existing = JOB_TABLE.get(job_id)
            if existing is not None:
                return existing, False
        max_depth = _max_queue_depth()
        if len(JOB_QUEUE) >= max_depth:
            raise QueueFullError(f"远端任务队列已满（最多 {max_depth} 个排队任务），请稍后重试")
        job = Job(
            job_id=job_id or new_job_id(),
            model_id=str(model_id),
            pipeline=dict(pipeline_spec),
            tasks=list(tasks),
            reference=dict(reference) if reference is not None else None,
        )
        JOB_TABLE[job.job_id] = job
        JOB_QUEUE.append(job)
        queue_len = len(JOB_QUEUE)
        JOB_COND.notify_all()
        log(
            f"[job] 入队 {job.job_id}（tasks={job.total}，排队 {queue_len}"
            f"{'，带参考图' if job.reference is not None else ''}）"
        )
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
        with BOOT_LOCK:
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
    with BOOT_LOCK:
        endpoint = BOOT.tunnel_url
        provider = BOOT.tunnel_provider
    with STATE_LOCK:
        model_id = STATE.model_id
        device = STATE.device
    payload = {
        "type": "ready",
        "endpoint": endpoint,
        # P2.2：Host 据此展示通道类型，并决定可信域校验策略。
        "provider": provider,
        "model_id": model_id,
        "device": device,
    }
    ntfy_publish(payload, "ready")


def publish_error(code: str, message: str) -> None:
    payload = {"type": "error", "code": code, "message": message[:800]}
    ntfy_publish(payload, f"error({code})")


def request_shutdown() -> None:
    """收到 /shutdown：标记停机并让隧道监管线程退出（进程随后由调用方安排退出）。"""
    with STATE_LOCK:
        STATE.shutting_down = True
    BOOT.stop_event.set()
    log("[shutdown] 收到 /shutdown，0.3s 后退出进程")


def _cleanup_before_exit() -> None:
    """进程退出前尽力关闭 HTTP 服务与隧道子进程（幂等，可重复调用）。"""
    global _CLEANUP_DONE
    with _CLEANUP_LOCK:
        if _CLEANUP_DONE:
            return
        _CLEANUP_DONE = True
    with STATE_LOCK:
        STATE.shutting_down = True
    BOOT.stop_event.set()
    with BOOT_LOCK:
        server = BOOT.http_server
        proc = BOOT.cloudflared
    if server is not None:
        try:
            shutdown = getattr(server, "shutdown", None)
            if callable(shutdown):
                shutdown()
        except Exception:
            pass
        try:
            server_close = getattr(server, "server_close", None)
            if callable(server_close):
                server_close()
        except Exception:
            pass
    if proc is not None:
        terminate_tunnel_process(proc)


# ─────────────────────────────────────────────────────────────────────────────
# 依赖安装与模型加载共享辅助（单份源码在 remote/pipeline_loader.py；
# 本地测试直接同目录 import，推 Kaggle 时随源码包一起内嵌）
# ─────────────────────────────────────────────────────────────────────────────

from pipeline_loader import PIP_INSTALL, PIP_UNINSTALL, filter_call_kwargs, from_pretrained_with_variant_fallback, is_oom_error, load_diffusers_pipeline, pip_install_argv, pip_uninstall_argv, pipe_signature_params  # noqa: E402


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
    run_streaming(pip_uninstall_argv(), "[pip]")
    constraints = merge_pip_constraints(CONFIG.pip_constraints)
    plain_argv = pip_install_argv()
    constraints_dir: str | None = None
    try:
        if constraints:
            constraints_dir = tempfile.mkdtemp(prefix="imagen-constraints-")
            constraints_path = write_constraints_file(constraints, directory=constraints_dir)
            # 约束本身不含敏感信息，完整打印便于对照「为什么装的是这个版本」。
            log(f"[pip] 依赖约束（Host 注入）：{' | '.join(constraints)}")
            install_argv = pip_install_argv(constraints_path)
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
    finally:
        if constraints_dir:
            shutil.rmtree(constraints_dir, ignore_errors=True)
    verify_dependencies()


# ─────────────────────────────────────────────────────────────────────────────
# 模型加载
# ─────────────────────────────────────────────────────────────────────────────


def _is_oom(exc: BaseException) -> bool:
    return is_oom_error(exc)


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


from cache_ops import CACHE_PROBE_WORK_DIR, DISK_HEADROOM, HF_CACHE_ENV_NAMES, HF_CACHE_REPO_PREFIX, HF_REPO_RE, HF_TOKEN_ENV_NAMES, _SECRET_MIN_CHARS, _cache_free_gib, _cache_path_protected, _decode_mount_path, _dir_size_gib, _existing_ancestor, _redact_secrets, _repo_key, _with_headroom, anima_local_assets_from, build_cache_probe_lines, cache_keep_repos_from, cache_model_dirs, cache_repo_candidates, disk_usage_root, disk_usage_target, disk_usage_text, ensure_cache_capacity_with, ensure_disk_capacity_with, evict_cache_dirs, hf_hub_cache_dir, local_model_dir_from, longest_mount_prefix, mount_point_of_path, pipeline_repos, prefetch_weights, probe_free_gib, read_mount_points, repo_from_cache_dir_name, required_download_gb, resolve_local_model_from, resolve_local_weight_from, run_disk_precheck  # noqa: E402

_CACHE_PROBE_DONE = False


def resolve_local_model(repo: str) -> str | None:
    """repo 命中 local_models 且目录含 model_index.json 时返回本地目录。"""
    return resolve_local_model_from(repo, CONFIG.local_models, log=log)


def resolve_local_weight(repo: str, weight_name: str) -> str | None:
    """LoRA 仓库命中预挂载且权重文件存在时返回本地文件路径。"""
    return resolve_local_weight_from(repo, weight_name, CONFIG.local_models, log=log)


def local_model_dir(repo: str) -> str | None:
    """repo 命中 local_models 且目录存在时返回该目录（不要求 model_index.json）。"""
    return local_model_dir_from(repo, CONFIG.local_models)


def anima_local_assets(pipeline_spec: dict) -> dict[str, str]:
    """把 anima 的四个资产解析成预挂载路径；未命中的键留给在线下载。"""
    return anima_local_assets_from(
        pipeline_spec,
        CONFIG.local_models,
        resolve_weight_fn=resolve_local_weight,
        local_dir_fn=local_model_dir,
        log=log,
    )


def mount_point_of(path: str) -> str:
    """path 所在挂载点：优先 /proc/mounts 最长前缀匹配，无该文件时降级到 st_dev。"""
    return mount_point_of_path(path, mount_reader=read_mount_points)


def cache_probe_lines() -> list[str]:
    """缓存 / 挂载点 / 剩余空间诊断行；任何失败都降级为 unknown，绝不抛异常。"""
    return build_cache_probe_lines(
        mount_fn=mount_point_of,
        free_fn=probe_free_gib,
        cache_dir_fn=hf_hub_cache_dir,
    )


def _log_cache_probe() -> None:
    """模型加载前打印一次缓存探针（进程内只打一次，避免刷屏）。"""
    global _CACHE_PROBE_DONE
    if _CACHE_PROBE_DONE:
        return
    _CACHE_PROBE_DONE = True
    try:
        for line in cache_probe_lines():
            log(line)
    except Exception:
        pass


def disk_precheck(pipeline_spec: dict, root: str | None = None, usage=None) -> dict | None:  # noqa: ANN001
    """磁盘预检：返回 ``{required_gb, free_gb, path, enough}``；没有体积信息时返回 None。"""
    return run_disk_precheck(
        pipeline_spec,
        root=root,
        usage=usage,
        target_fn=disk_usage_target,
        log=log,
    )


def ensure_disk_capacity(pipeline_spec: dict) -> None:
    """下载前磁盘预检：Flux.2 全量权重会撑爆 Kaggle 20GB 空间；预挂载时跳过。"""
    ensure_disk_capacity_with(
        pipeline_spec,
        resolve_model_fn=resolve_local_model,
        precheck_fn=disk_precheck,
        log=log,
        error_cls=LoadError,
    )


def cache_keep_repos(pipeline_spec) -> set[str]:  # noqa: ANN001
    """切模型清理的不可删仓库集合：目标 pipeline 全部依赖 + 所有预挂载仓库。"""
    return cache_keep_repos_from(pipeline_spec, CONFIG.local_models)


def evict_cache_for(required_gb, keep_repos=None, *, root: str | None = None, usage=None) -> dict:  # noqa: ANN001
    """按需清理 HF 缓存（LRU），返回 ``{required_gb, free_gb, path, evicted, enough}``。"""
    return evict_cache_dirs(
        required_gb,
        keep_repos,
        root=root,
        usage=usage,
        local_models=CONFIG.local_models,
        log=log,
        error_cls=LoadError,
    )


def ensure_cache_capacity(pipeline_spec: dict) -> None:
    """切模型前的缓存清理闸门：空间足够时不扫目录、不删文件，清完仍不足才报错。"""
    ensure_cache_capacity_with(
        pipeline_spec,
        resolve_model_fn=resolve_local_model,
        anima_assets_fn=anima_local_assets,
        keep_repos_fn=cache_keep_repos,
        evict_fn=evict_cache_for,
    )


def _prefetch_weights(base: str, allow_patterns) -> None:  # noqa: ANN001
    """按白名单预拉取，避免整仓下载把 /kaggle/working 的 20GB 配额写爆。"""
    prefetch_weights(base, allow_patterns, log=log)


def _from_pretrained(factory, base: str, kwargs: dict, loader: str):  # noqa: ANN001
    """fp16 变体缺失时回退到默认权重；OOM 不重试，直接抛给上层分类。"""
    return from_pretrained_with_variant_fallback(
        factory, base, kwargs, loader, log=log, error_cls=LoadError
    )


# ─────────────────────────────────────────────────────────────────────────────
# anima：Johnny-Z/Anima-Light-Lavender 运行时（单份源码在 remote/anima_runtime.py）
#
# 历史背景：本文件与 tools/payload/verify-model.py 曾各自维护一份约 1000 行、注释要求
# 「逐字同步」的运行时——那是对 Kaggle「只接受单个 code_file」的误解。现在运行时只有
# remote/anima_runtime.py 一份：本地直接同目录 import；推送时 lib/kernel.js 把整个 remote/
# 压成源码包内嵌进启动器，业务代码保持普通包结构。不要再往本文件复制实现。
# 模型结构、上游直译来源与日志注入约定见 remote/anima_runtime.py 顶部说明。
# ─────────────────────────────────────────────────────────────────────────────

from anima_runtime import load_anima_runtime  # noqa: E402


def build_pipeline(pipeline_spec: dict):
    """按 loader 分支加载；返回 (pipe, 人类可读的 loaded 标识)。"""
    loader = str(pipeline_spec["loader"])
    base = str(pipeline_spec["base"])
    allow_patterns = pipeline_spec.get("allowPatterns")

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

    if loader == "anima":
        # 单文件 ComfyUI checkpoint：DiT + Qwen3-0.6B + Qwen-Image VAE + 双分词器。
        # 运行时实现只在 remote/anima_runtime.py（打包时由 lib/kernel.js 内联）。
        try:
            runtime, _downloaded_bytes, _load_seconds = load_anima_runtime(
                pipeline_spec, log, local_paths=anima_assets
            )
        except Exception as exc:
            free_cuda_cache()
            if _is_oom(exc):
                raise
            raise LoadError(f"anima 加载失败：{short(exc)}") from exc
        return runtime, f"anima:{base}"

    local_lora_weight = None
    if loader == "sdxl-lora":
        lora = pipeline_spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if lora_repo and lora_weight:
            local_lora_weight = resolve_local_weight(lora_repo, lora_weight)

    try:
        pipe = load_diffusers_pipeline(
            pipeline_spec,
            base_source=base_source,
            local_lora_weight=local_lora_weight,
            log=log,
            error_cls=LoadError,
            request_error_cls=RequestError,
        )
    except RequestError:
        raise
    except Exception:
        free_cuda_cache()
        raise
    return pipe, f"{loader}:{base}"


def release_pipeline() -> None:
    with STATE_LOCK:
        pipe = STATE.pipe
        STATE.pipe = None
        STATE.pipeline_key = None
        STATE.model_id = None
        STATE.loaded = []
        STATE.sig_params = set()
        # 图生图管线与 txt2img 共用组件，这里只清引用；下面释放 pipe 后由 GC 一次性回收，
        # 不会重复卸载权重，也不会留下指向旧模型的悬空句柄。
        STATE.img2img_pipe = None
        STATE.img2img_sig_params = set()
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
    free_cuda_cache()


def ensure_pipeline(pipeline_spec: dict) -> tuple[object, float]:
    """同一个 pipeline 描述只加载一次；描述变了先卸旧模型再加载。"""
    key = json.dumps(pipeline_spec, sort_keys=True, ensure_ascii=False, default=str)
    with STATE_LOCK:
        if STATE.pipe is not None and STATE.pipeline_key == key:
            return STATE.pipe, 0.0
        has_existing = STATE.pipe is not None
        previous_phase = "ready" if STATE.phase == "ready" else STATE.phase

    if has_existing:
        log("[load] 请求的 pipeline 与已加载的不一致，先卸载旧模型")
        release_pipeline()

    set_phase("loading", f"加载 {pipeline_spec.get('base')}")
    # 只读诊断：首次加载前记下 HF 缓存与 /kaggle/working 的挂载点/剩余空间（进程内只打一次）。
    _log_cache_probe()
    started = time.time()
    try:
        # M4.1：真正下载/加载前按需清理旧模型缓存。切模型时 release_pipeline 已先执行
        # （其中含 gc.collect() 与 torch.cuda.empty_cache()），这里只删磁盘上的旧权重。
        ensure_cache_capacity(pipeline_spec)
        pipe, identity = build_pipeline(pipeline_spec)
    except RequestError:
        set_phase(previous_phase)
        raise
    except Exception as exc:
        free_cuda_cache()
        set_phase("error" if previous_phase != "ready" else "ready", f"模型加载失败：{short(exc, 200)}")
        raise

    elapsed = round(time.time() - started, 1)
    sig_params = pipe_signature_params(pipe)
    with STATE_LOCK:
        STATE.pipe = pipe
        STATE.pipeline_key = key
        STATE.model_id = str(pipeline_spec.get("base"))
        STATE.loaded = [identity]
        STATE.sig_params = sig_params
    set_phase("ready")
    log(f"[load] 模型就绪，用时 {elapsed}s（{identity}）")
    return pipe, elapsed


def ensure_img2img_pipeline():
    """惰性创建图生图管线：复用 STATE.pipe 的组件，不重复加载、不额外占显存。

    首次用到参考图时通过 ``AutoPipelineForImage2Image.from_pipe`` 生成，缓存到
    ``STATE.img2img_pipe``；``release_pipeline()`` 与切换底座时会清空（见该函数）。
    img2img 管线的 ``__call__`` 签名与 txt2img 不同，因此单独缓存 ``img2img_sig_params``。
    """
    with STATE_LOCK:
        pipe = STATE.img2img_pipe
        if pipe is not None:
            return pipe
        base_pipe = STATE.pipe
    if base_pipe is None:
        raise RequestError("图生图需要先加载模型底座")
    from diffusers import AutoPipelineForImage2Image

    log("[load] 首次图生图：从已加载底座复用组件创建 img2img 管线（不额外占显存）")
    try:
        pipe = AutoPipelineForImage2Image.from_pipe(base_pipe)
    except Exception as exc:
        if _is_oom(exc):
            raise
        raise LoadError(f"图生图管线创建失败：{short(exc)}") from exc
    sig_params = pipe_signature_params(pipe)
    with STATE_LOCK:
        STATE.img2img_pipe = pipe
        STATE.img2img_sig_params = sig_params
    log("[load] 图生图管线就绪")
    return pipe


# ─────────────────────────────────────────────────────────────────────────────
# 请求校验与生成
# ─────────────────────────────────────────────────────────────────────────────


def _int_param(value, field: str, low: int, high: int) -> int:  # noqa: ANN001
    if isinstance(value, bool):
        raise RequestError(f"{field} 必须是整数")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise RequestError(f"{field} 必须是整数") from None
    if number < low or number > high:
        raise RequestError(f"{field} 必须在 {low}..{high} 之间，收到 {number}")
    return number


_VALID_HF_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")


def _valid_pipeline_base(base: str) -> bool:
    text = base.strip()
    if not text or len(text) > 512 or any(ord(ch) < 32 for ch in text) or "\\" in text:
        return False
    if text.startswith("/"):
        parts = text.split("/")
        return any(parts[1:]) and not any(part in (".", "..") for part in parts[1:])
    if ".." in text:
        return False
    return bool(_VALID_HF_REPO_RE.match(text))


# 契约缺失时的兜底边界（兼容旧 Host / 本地调试）：保持 0.3.0 之前的 daemon 行为。
# 图生图（reference / strength）是新增能力：旧 Host 不会下发这两组边界，这里与当前契约
# 同值兜底，仅供契约缺项的本地调试；正常运行一律以注入契约的 limits 为准。
_FALLBACK_LIMITS: dict[str, dict] = {
    "width": {"min": 64, "max": 2048, "step": 8},
    "height": {"min": 64, "max": 2048, "step": 8},
    "steps": {"min": 1, "max": 80},
    "cfg": {"min": 0, "max": 30},
    "count": {"min": 1, "max": 8},
    "seed": {"max": 2**31 - 1},
    "prompt": {"maxChars": 2000},
    "negativePrompt": {"maxChars": 1000},
    "reference": {"maxBytes": 8 * 1024 * 1024, "maxEdge": 1536, "minEdge": 128},
    "strength": {"min": 0.2, "max": 0.9, "step": 0.05, "default": 0.6},
}
_MAX_TASKS_FALLBACK = 8
# 契约 limits 里可能出现的数值型键：合并兜底值时只认数字（bool 不算数字）。
_LIMIT_NUMERIC_KEYS = ("min", "max", "step", "maxChars", "default", "maxBytes", "maxEdge", "minEdge")


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
    for key in _LIMIT_NUMERIC_KEYS:
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


def _request_body_limit() -> int:
    """请求体字节上限：默认 8MB；契约下发参考图边界后按 base64 膨胀放宽。

    8MiB 原图 base64 后约 10.7MB，不下发 reference 的旧 Host 仍按 8MB 处理，
    保证文生图路径的请求体上限与改造前完全一致。
    """
    base = 8 * 1024 * 1024
    limits = CONFIG.contract.get("limits") if isinstance(CONFIG.contract, dict) else None
    reference = limits.get("reference") if isinstance(limits, dict) else None
    if not isinstance(reference, dict):
        return base
    max_bytes = reference.get("maxBytes")
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, (int, float)) or max_bytes <= 0:
        return base
    # base64 每 3 字节膨胀成 4 字符；再留 1MB 给 tasks / prompt / jobId 等 JSON 字段。
    return max(base, 4 * ((int(max_bytes) + 2) // 3) + 1024 * 1024)


def _coerce_strength(value) -> float:  # noqa: ANN001
    """重绘强度归一到 ``contract.limits.strength``：非法/缺失回退默认值，越界钳制。"""
    limits = _limit_spec("strength")
    low = float(limits.get("min", 0.0))
    high = float(limits.get("max", 1.0))
    default = float(limits.get("default", 0.6))
    if value is None or isinstance(value, bool):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    # 契约 step 目前是 0.05：保留 4 位小数，避免 0.6000000000000001 这类浮点噪声。
    return round(min(max(number, low), high), 4)


def _open_reference_image(image_bytes: bytes):  # noqa: ANN202
    """只读参考图头部：校验 PNG/JPEG 与最小长边，返回未 load 的 PIL Image。

    调用方负责 ``close()``。这里不解码像素，因此提交期就能把「看头部即可发现」的问题
    全部收敛成 400；真正的完整解码只在 execute_job 的 ``decode_reference_image`` 做一次。
    """
    from PIL import Image, UnidentifiedImageError

    min_edge = int(_limit_spec("reference").get("minEdge") or 0)
    bomb_error = getattr(Image, "DecompressionBombError", None)
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except UnidentifiedImageError:
        raise RequestError("参考图必须是 PNG 或 JPEG 图片") from None
    except Exception as exc:  # noqa: BLE001 - 任意解码库异常都收敛为请求非法
        if bomb_error is not None and isinstance(exc, bomb_error):
            raise RequestError("参考图分辨率过大，无法处理") from None
        raise RequestError(f"参考图无法解析：{type(exc).__name__}") from None
    image_format = str(getattr(image, "format", "") or "").upper()
    if image_format not in REFERENCE_IMAGE_FORMATS:
        image.close()
        raise RequestError(f"参考图必须是 PNG 或 JPEG（收到 {image_format or '未知格式'}）")
    width, height = image.size
    if min_edge > 0 and max(width, height) < min_edge:
        image.close()
        raise RequestError(f"参考图长边至少 {min_edge}px（收到 {width}x{height}）")
    return image


def parse_reference_spec(raw, pipeline_spec: dict) -> dict | None:  # noqa: ANN001
    """提交期校验 job 级参考图，归一成 ``{image_bytes, strength, width, height}``。

    只做「不需要完整解码」的检查：loader 白名单、base64 合法性、原始字节上限、
    PNG/JPEG、最小长边与 strength 钳制。返回 None 表示文生图请求（行为与改造前一致）。
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise RequestError("reference 必须是对象")
    loader = str(pipeline_spec.get("loader") or "").strip()
    if loader not in SUPPORTED_IMG2IMG_LOADERS:
        raise RequestError(
            f"该模型不支持垫图重绘（首期仅开放 SDXL 家族，当前 loader={loader or '未知'}）"
        )
    encoded = raw.get("image_b64")
    if not isinstance(encoded, str) or not encoded.strip():
        raise RequestError("reference.image_b64 必须是非空字符串")
    max_bytes = int(_limit_spec("reference").get("maxBytes") or 0)
    try:
        data = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError):
        raise RequestError("reference.image_b64 不是合法 base64") from None
    if not data:
        raise RequestError("reference.image_b64 解码后为空")
    if max_bytes > 0 and len(data) > max_bytes:
        raise RequestError(f"参考图体积 {len(data)} 字节，超过上限 {max_bytes} 字节")
    image = _open_reference_image(data)
    try:
        width, height = image.size
    finally:
        try:
            image.close()
        except Exception:  # pragma: no cover - close 失败不影响请求结果
            pass
    return {
        "image_bytes": data,
        "strength": _coerce_strength(raw.get("strength")),
        "width": int(width),
        "height": int(height),
    }


def decode_reference_image(reference: dict) -> object:
    """执行期完整解码参考图一次：转 RGB，长边超过 ``maxEdge`` 时等比 LANCZOS 缩小。

    返回可直接喂给图生图管线的 PIL Image；解码失败抛 ``RequestError``（job 收敛为
    invalid_request）。原始尺寸挂在 ``_imagen_source_size`` 上，供 run_task 打日志。
    """
    if not isinstance(reference, dict):
        raise RequestError("reference 必须是对象")
    data = reference.get("image_bytes")
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise RequestError("参考图数据缺失，无法解码")
    max_edge = int(_limit_spec("reference").get("maxEdge") or 0)
    image = _open_reference_image(bytes(data))
    source_size = image.size
    try:
        try:
            image.load()
        except Exception as exc:  # noqa: BLE001 - 截断/损坏图片按请求非法收敛
            raise RequestError(f"参考图无法解码：{type(exc).__name__}") from None
        if image.mode != "RGB":
            converted = image.convert("RGB")
            try:
                image.close()
            except Exception:  # pragma: no cover
                pass
            image = converted
        width, height = image.size
        long_edge = max(width, height)
        if max_edge > 0 and long_edge > max_edge:
            from PIL import Image

            scale = max_edge / float(long_edge)
            target = (max(1, round(width * scale)), max(1, round(height * scale)))
            resampling = getattr(Image, "Resampling", None)
            resample = getattr(resampling, "LANCZOS", None)
            if resample is None:  # pragma: no cover - Pillow < 9.1 的旧常量
                resample = getattr(Image, "LANCZOS")
            resized = image.resize(target, resample)
            try:
                image.close()
            except Exception:  # pragma: no cover
                pass
            image = resized
    except Exception:
        close_fn = getattr(image, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:  # pragma: no cover
                pass
        raise
    # 「参考图 WxH → 缩放后 WxH」的日志放在 run_task：原尺寸挂在图像对象上，
    # 这样 run_tasks / run_task 只需要多收一个 reference_image，不必再加元参数。
    try:
        image._imagen_source_size = source_size
    except Exception:  # pragma: no cover - PIL Image 允许挂属性，仅作防御
        pass
    return image


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
    if not _valid_pipeline_base(base):
        raise RequestError("pipeline.base 必须是 owner/name 仓库标识或绝对路径")

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
    neg_max = int(_limit_spec("negativePrompt").get("maxChars") or 0)
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
        neg_raw = raw.get("negative_prompt")
        if neg_raw is None:
            neg_prompt = ""
        elif not isinstance(neg_raw, str):
            raise RequestError(f"tasks[{index}].negative_prompt 必须是字符串")
        else:
            neg_prompt = neg_raw.strip()
        if neg_max > 0 and len(neg_prompt) > neg_max:
            raise RequestError(f"tasks[{index}].negative_prompt 最长 {neg_max} 个字符")
        width = _int_param(raw.get("width", 1024), f"tasks[{index}].width", width_min, width_max)
        height = _int_param(raw.get("height", 1024), f"tasks[{index}].height", height_min, height_max)
        steps = _int_param(raw.get("steps", 4), f"tasks[{index}].steps", steps_min, steps_max)
        raw_cfg = raw.get("cfg", 0.0)
        if isinstance(raw_cfg, bool):
            raise RequestError(f"tasks[{index}].cfg 必须是数字")
        try:
            cfg = float(raw_cfg)
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].cfg 必须是数字") from None
        if not math.isfinite(cfg):
            raise RequestError(f"tasks[{index}].cfg 必须是有限数字")
        if cfg < cfg_min or cfg > cfg_max:
            raise RequestError(f"tasks[{index}].cfg 必须在 {cfg_min}..{cfg_max} 之间")
        raw_seed = raw.get("seed", -1)
        if isinstance(raw_seed, bool):
            raise RequestError(f"tasks[{index}].seed 必须是整数")
        try:
            seed = int(raw_seed)
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
                "negative_prompt": neg_prompt,
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


def run_task(pipe, task: dict, reference_image=None, reference_strength=None) -> dict:  # noqa: ANN001
    """执行单个出图任务，返回与旧 ``/generate`` 完全一致的 results 项。

    ``width`` / ``height`` 一律回传 **实际出图尺寸**（PIL ``image.size``），不是请求值：
    anima 运行时会把宽高向下取整到 16 的倍数（如 648 → 640），其它 loader 也可能在内部
    做对齐；Host 的 meta.json 与图片尺寸必须一致。

    ``reference_image`` 非空时走图生图分支（M3）：用惰性复用的 img2img 管线与它自己的
    ``__call__`` 签名过滤参数，不再传 width / height（出图尺寸跟随参考图）。
    """
    import torch

    generator_device = "cuda" if torch.cuda.is_available() else "cpu"
    generator = torch.Generator(device=generator_device).manual_seed(task["seed"])
    use_reference = reference_image is not None
    if use_reference:
        target_pipe = ensure_img2img_pipeline()
        with STATE_LOCK:
            sig = set(STATE.img2img_sig_params)
        strength = _coerce_strength(reference_strength)
        call_kwargs = {
            "prompt": task["prompt"],
            "image": reference_image,
            "strength": strength,
            "num_inference_steps": task["steps"],
            "guidance_scale": task["cfg"],
            "generator": generator,
        }
    else:
        target_pipe = pipe
        with STATE_LOCK:
            sig = set(STATE.sig_params)
        call_kwargs = {
            "prompt": task["prompt"],
            "num_inference_steps": task["steps"],
            "guidance_scale": task["cfg"],
            "width": task["width"],
            "height": task["height"],
            "generator": generator,
        }
    # 只有底座支持 negative_prompt 且 CFG > 0 时才有意义（Lightning 的 cfg=0 会被忽略）。
    call_kwargs = filter_call_kwargs(
        call_kwargs,
        sig,
        negative_prompt=task["negative_prompt"],
        cfg=task["cfg"],
    )

    if use_reference:
        source = getattr(reference_image, "_imagen_source_size", reference_image.size)
        log(
            f"[gen] img2img {task['name']} strength={strength} seed={task['seed']} "
            f"steps={task['steps']} cfg={task['cfg']}"
        )
        log(
            f"[gen] img2img 参考图 {source[0]}x{source[1]} → "
            f"{reference_image.size[0]}x{reference_image.size[1]}"
        )
    else:
        log(
            f"[gen] {task['name']} seed={task['seed']} {task['width']}x{task['height']} "
            f"steps={task['steps']} cfg={task['cfg']}"
        )
    started = time.time()
    image = target_pipe(**call_kwargs).images[0]
    try:
        _sync_cuda()
        seconds = round(time.time() - started, 2)
        png = _encode_png(image)
        width, height = image.size
    finally:
        close_fn = getattr(image, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:
                pass
    if use_reference:
        expected = (reference_image.size[0], reference_image.size[1])
        if (width, height) != expected:
            log(f"[gen] {task['name']} 实际出图 {width}x{height}（参考图 {expected[0]}x{expected[1]}）")
    elif (width, height) != (task["width"], task["height"]):
        log(f"[gen] {task['name']} 实际出图 {width}x{height}（请求 {task['width']}x{task['height']}）")
    log(f"[gen] {task['name']} 完成，{seconds}s，{len(png)} 字节")
    result = {
        "name": task["name"],
        "seed": task["seed"],
        "seconds": seconds,
        "width": int(width),
        "height": int(height),
        "steps": task["steps"],
        "cfg": task["cfg"],
        "png_bytes": len(png),
        "image_b64": base64.b64encode(png).decode("ascii"),
    }
    if use_reference:
        # 图生图额外字段：strength 与缩放后实际送入模型的参考图尺寸（Host 可记录/透传；
        # 文生图 results 结构与改造前完全一致，不含这些键）。
        result["strength"] = strength
        result["referenceWidth"] = int(reference_image.size[0])
        result["referenceHeight"] = int(reference_image.size[1])
    return result


def run_tasks(
    pipe,
    tasks: list[dict],
    on_progress=None,  # noqa: ANN001
    reference_image=None,  # noqa: ANN001
    reference_strength=None,  # noqa: ANN001
) -> list[dict]:
    """串行跑完一批任务；``on_progress`` 拿到「已完成的结果列表」副本，用于刷新 job 进度。

    ``reference_image`` 非空时整批任务共用同一张参考图（job 级，execute_job 只解码一次）。
    """
    results: list[dict] = []
    for task in tasks:
        with STATE_LOCK:
            STATE.last_active = time.time()
        if reference_image is None:
            results.append(run_task(pipe, task))
        else:
            results.append(
                run_task(
                    pipe,
                    task,
                    reference_image=reference_image,
                    reference_strength=reference_strength,
                )
            )
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
    with STATE_LOCK:
        STATE.last_active = now


def execute_job(job: Job) -> None:
    """worker 里执行单个 job：加载 pipeline → 逐张出图 → 更新进度/终态。

    异常一律收在内部转成 job.error，绝不让 worker 线程退出。
    """
    with JOB_LOCK:
        job.status = JOB_STATUS_RUNNING
        job.updated_at = time.time()
    with STATE_LOCK:
        STATE.last_active = time.time()
    GEN_LOCK.acquire()
    reference_image = None
    try:
        started = time.time()
        reference_strength = None
        if job.reference is not None:
            # 图生图：参考图完整解码只做一次（整批 count 共用），且放在加载模型之前——
            # 图片本身损坏/截断时不必先下载、加载几十 GB 权重。
            reference_image = decode_reference_image(job.reference)
            reference_strength = _coerce_strength(job.reference.get("strength"))
            with JOB_LOCK:
                # 解码完成后释放队列里保留的原始字节（job 公开视图不含参考图）。
                job.reference = None
        pipe, load_seconds = ensure_pipeline(job.pipeline)
        with JOB_LOCK:
            job.load_seconds = load_seconds
            job.updated_at = time.time()
        with STATE_LOCK:
            STATE.last_active = time.time()
        if reference_image is None:
            results = run_tasks(
                pipe,
                job.tasks,
                on_progress=lambda partial: _update_job_progress(job, partial),
            )
        else:
            results = run_tasks(
                pipe,
                job.tasks,
                on_progress=lambda partial: _update_job_progress(job, partial),
                reference_image=reference_image,
                reference_strength=reference_strength,
            )
        with JOB_LOCK:
            job.results = list(results)
        with STATE_LOCK:
            STATE.jobs_done += len(results)
        total = round(time.time() - started, 2)
        log(
            f"[job] {job.job_id} 完成：{len(results)} 张，总耗时 {total}s"
            f"（加载 {load_seconds}s）"
        )
        _finish_job(job, JOB_STATUS_DONE)
    except Exception as exc:  # noqa: BLE001 - 后台线程必须收住所有常规异常
        code, message = classify_failure(exc)
        if code == "oom":
            free_cuda_cache()
        record_error(code, message)
        log(f"[job] {job.job_id} 失败（{code}）：{message}")
        log(traceback.format_exc())
        _finish_job(job, JOB_STATUS_FAILED, {"code": code, "message": message})
    finally:
        if reference_image is not None:
            close_fn = getattr(reference_image, "close", None)
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass
        try:
            GEN_LOCK.release()
        except RuntimeError:  # pragma: no cover - 理论上不会发生
            pass
        with STATE_LOCK:
            STATE.last_active = time.time()


def job_worker_loop() -> None:
    """常驻 worker：串行消费 JOB_QUEUE。"""
    log("[job] worker 启动，等待队列")
    while not BOOT.stop_event.is_set():
        with JOB_LOCK:
            while not BOOT.stop_event.is_set() and not JOB_QUEUE:
                JOB_COND.wait(timeout=0.5)
            if BOOT.stop_event.is_set():
                break
            job = JOB_QUEUE.popleft() if JOB_QUEUE else None
        if job is None:
            continue
        job_started = time.time()
        try:
            execute_job(job)
        except Exception as exc:  # pragma: no cover - execute_job 自身已兜底
            log(f"[job] worker 捕获异常：{short(exc)}")
            with JOB_LOCK:
                unfinished = job.status not in (JOB_STATUS_DONE, JOB_STATUS_FAILED)
            if unfinished:
                _finish_job(job, JOB_STATUS_FAILED, {"code": "generation_failed", "message": short(exc)})
        log(f"[job] {job.job_id} 处理结束（{round(time.time() - job_started, 1)}s）")


def start_job_worker() -> threading.Thread:
    thread = threading.Thread(target=job_worker_loop, name="job-worker", daemon=True)
    thread.start()
    return thread


# ─────────────────────────────────────────────────────────────────────────────
# HTTP 服务
# ─────────────────────────────────────────────────────────────────────────────

# M4.2：/health 的依赖版本快照。三项依次为「输出键名 / 已加载模块名 / PyPI 发行名」。
# 只输出纯版本号，绝不包含 token、路径或安装位置；取不到的键直接省略。
HEALTH_VERSION_MODULES = (
    ("torch", "torch", "torch"),
    ("diffusers", "diffusers", "diffusers"),
    ("transformers", "transformers", "transformers"),
    ("accelerate", "accelerate", "accelerate"),
    ("peft", "peft", "peft"),
    ("huggingface_hub", "huggingface_hub", "huggingface-hub"),
    ("safetensors", "safetensors", "safetensors"),
    ("pillow", "PIL", "pillow"),
)
_VERSION_RE = re.compile(r"^[0-9][0-9A-Za-z.+!_-]{0,63}$")


def _clean_version(value) -> str | None:  # noqa: ANN001
    """只接受纯版本号字符串（数字开头）；其他形态丢弃，避免把路径带进 /health。"""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or not _VERSION_RE.match(text):
        return None
    return text


def dependency_versions() -> dict:
    """python + torch/diffusers/... 的版本快照；取不到就省略该键，绝不抛异常。

    优先读已加载模块的 ``__version__``（不额外 import 重库），回退到
    importlib.metadata；两种来源都做纯版本号校验。
    """
    versions: dict = {}
    python_version = _clean_version(platform.python_version())
    if python_version:
        versions["python"] = python_version
    for key, module_name, dist_name in HEALTH_VERSION_MODULES:
        version = None
        module = sys.modules.get(module_name)
        if module is not None:
            version = _clean_version(getattr(module, "__version__", None))
        if version is None:
            try:
                version = _clean_version(importlib.metadata.version(dist_name))
            except Exception:
                version = None
        if version is not None:
            versions[key] = version
    return versions


def gpu_memory_payload() -> dict | None:
    """只读显存快照（MiB 取整）；用于 M3 真机验收对比 txt2img → img2img 是否额外占显存。

    只读已加载的 torch 模块（``sys.modules``），不在 /health 里触发重库 import：
    torch 尚未加载、CUDA 不可用或读取异常时一律返回 None，且不影响 status / phase 判定。
    """
    torch = sys.modules.get("torch")
    if torch is None:
        return None
    try:
        cuda = torch.cuda
        if not cuda.is_available():
            return None
        mib = 1024 * 1024
        return {
            "allocated_mb": int(cuda.memory_allocated() // mib),
            "reserved_mb": int(cuda.memory_reserved() // mib),
            "max_allocated_mb": int(cuda.max_memory_allocated() // mib),
        }
    except Exception:
        return None


def health_payload() -> dict:
    with STATE_LOCK:
        phase = STATE.phase
        model_id = STATE.model_id
        loaded = list(STATE.loaded)
        device = STATE.device
        device_count = STATE.device_count
        last_active = STATE.last_active
        jobs_done = STATE.jobs_done
        last_error = STATE.last_error
        last_error_code = STATE.last_error_code
        detail = STATE.detail
        started_at = STATE.started_at
    with BOOT_LOCK:
        tunnel_provider = BOOT.tunnel_provider
        tunnel_state = BOOT.tunnel_state
        tunnel_restarts = BOOT.tunnel_restarts
    now = time.time()
    return {
        "status": "error" if phase == "error" else "ok",
        "phase": phase,
        "version": protocol_version(),
        # M4.2：依赖版本快照（纯版本号，不含 token / 路径），用于 LKGR 基线与故障归因。
        "versions": dependency_versions(),
        "model_id": model_id,
        "loaded": loaded,
        "device": device,
        "device_count": device_count,
        "idle_seconds": round(now - last_active, 1),
        "idle_timeout_sec": CONFIG.idle_timeout_sec,
        "jobs_done": jobs_done,
        # 0.5.0：排队中（尚未开始执行）的 job 数；运行中的不算。
        "queue_depth": queue_depth(),
        "last_error": last_error,
        "last_error_code": last_error_code,
        "detail": detail,
        "uptime_seconds": round(now - started_at, 1),
        # P0.2 / P2.2：隧道监管状态，Host 用于「重连中 / 通道类型」展示与故障归因。
        "tunnel_provider": tunnel_provider,
        "tunnel_state": tunnel_state,
        "tunnel_restarts": tunnel_restarts,
        # M3 图生图验收：显存只读诊断（torch 未加载 / CUDA 不可用时为 null）。
        "gpu_memory": gpu_memory_payload(),
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
        limit = _request_body_limit()
        if length > limit:
            raise RequestError(f"请求体超过上限（{round(limit / 1024 / 1024, 1)}MB）")
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
        _cleanup_before_exit()
        os._exit(0)

    def _handle_generate(self) -> None:
        with STATE_LOCK:
            phase = STATE.phase
            last_error = STATE.last_error
            booted = STATE.booted
            shutting_down = STATE.shutting_down
        can_accept = not shutting_down and (phase == "ready" or (phase == "loading" and booted))
        if not can_accept:
            if phase == "error":
                message = last_error or "Daemon 启动失败"
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
            # 图生图（M3）：参考图提交期只读图片头做校验，失败直接 400；
            # 没有 reference 时返回 None，文生图路径逐字不变。
            reference = parse_reference_spec(spec.get("reference"), pipeline_spec)
            job_id = normalize_job_id(spec.get("jobId"))
        except RequestError as exc:
            log(f"[gen] 请求非法：{exc}")
            self._send_error(400, "invalid_request", str(exc))
            return

        try:
            job, created = submit_job(pipeline_spec, model_id, tasks, job_id, reference)
        except QueueFullError as exc:
            log(f"[gen] 队列已满：{exc}")
            self._send_error(429, "queue_full", str(exc), {"Retry-After": "5"})
            return
        except Exception as exc:  # pragma: no cover - 入队本身不涉及 IO
            log(f"[gen] 入队失败：{short(exc)}")
            self._send_error(500, "generation_failed", short(exc))
            return

        with STATE_LOCK:
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
    with BOOT_LOCK:
        BOOT.http_server = server
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


from tunnel import CLOUDFLARED_DOWNLOAD_ATTEMPTS, CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC, CLOUDFLARED_DOWNLOAD_URL, CLOUDFLARED_MAX_DOWNLOAD_BYTES, CLOUDFLARED_PATH, CLOUDFLARED_SHA256, CLOUDFLARED_URL_RE, CLOUDFLARED_VERSION, DEFAULT_CUSTOM_URL_RE, TUNNEL_ANNOUNCE_SEC, TUNNEL_PROVIDERS, TUNNEL_RESTART_BASE_SEC, TUNNEL_RESTART_MAX_SEC, TUNNEL_WAIT_SEC, _CloudflaredDownloadTooLarge, _file_sha256, _remove_file_quietly, build_tunnel_plan_for, download_cloudflared_once_from, drain_tunnel_output_for, extract_tunnel_url, normalize_tunnel_command, run_announce_tunnel_ready, run_recover_tunnel_error, run_start_tunnel, run_tunnel_attempt, run_tunnel_monitor, spawn_tunnel_process_for, terminate_tunnel_process, tunnel_restart_delay, tunnel_url_regex_for, verify_or_download_cloudflared, wait_tunnel_exit  # noqa: E402


def _download_cloudflared_once(partial: str) -> tuple[int, str]:
    """流式下载一次 cloudflared 到 ``partial``，边写边算 SHA256。"""
    return download_cloudflared_once_from(
        partial,
        download_url=CLOUDFLARED_DOWNLOAD_URL,
        timeout_sec=CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC,
        max_bytes=CLOUDFLARED_MAX_DOWNLOAD_BYTES,
    )


def ensure_cloudflared() -> str:
    """确保 ``CLOUDFLARED_PATH`` 可用：已就绪且 SHA256 一致则复用，否则按固定版本下载。"""
    return verify_or_download_cloudflared(
        path=CLOUDFLARED_PATH,
        download_url=CLOUDFLARED_DOWNLOAD_URL,
        sha256=CLOUDFLARED_SHA256,
        version=CLOUDFLARED_VERSION,
        max_bytes=CLOUDFLARED_MAX_DOWNLOAD_BYTES,
        timeout_sec=CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC,
        attempts=CLOUDFLARED_DOWNLOAD_ATTEMPTS,
        download_once_fn=_download_cloudflared_once,
        log=log,
    )


def tunnel_url_regex(pattern: str | None = None):  # noqa: ANN202 - 返回编译后的正则
    """备用通道的地址提取规则：配置优先，非法或缺省时回退内置 https 规则。"""
    return tunnel_url_regex_for(pattern, log=log)


def build_tunnel_plan(port: int) -> list[dict]:
    """按尝试顺序给出通道计划：cloudflare 优先，配置了备用命令再追加 custom。"""
    return build_tunnel_plan_for(
        port,
        cloudflared_path=CLOUDFLARED_PATH,
        fallback_command=CONFIG.fallback_tunnel_command,
        fallback_regex=CONFIG.fallback_tunnel_url_regex,
        url_regex_fn=tunnel_url_regex,
        log=log,
    )


def tunnel_should_stop() -> bool:
    """隧道监管是否该退出（/shutdown、信号或显式置位）。"""
    with STATE_LOCK:
        shutting_down = STATE.shutting_down
    return BOOT.stop_event.is_set() or shutting_down


def _spawn_tunnel_process(argv: list[str], provider: str = "cloudflare"):  # noqa: ANN202 - 返回 Popen 或 None
    """启动隧道子进程；失败只记录原因，交给下一个通道或下一轮重试。"""
    return spawn_tunnel_process_for(argv, provider, boot=BOOT, boot_lock=BOOT_LOCK, log=log)


def _drain_tunnel_output(
    proc,
    provider: str,
    url_re,
    url_event: threading.Event,
    attempt: _TunnelAttempt | None = None,
) -> None:  # noqa: ANN001
    """持续读取隧道输出，首个地址写入 BOOT 并置位事件；必须读到进程退出为止。"""
    drain_tunnel_output_for(
        proc,
        provider,
        url_re,
        url_event,
        attempt,
        boot=BOOT,
        boot_lock=BOOT_LOCK,
        log=log,
    )


def tunnel_attempt(item: dict) -> tuple[str, object] | None:
    """启动一个通道并等待地址：成功返回 (provider, proc)，失败返回 None。"""
    return run_tunnel_attempt(
        item,
        boot=BOOT,
        boot_lock=BOOT_LOCK,
        attempt_cls=_TunnelAttempt,
        spawn_fn=_spawn_tunnel_process,
        drain_fn=_drain_tunnel_output,
        terminate_fn=terminate_tunnel_process,
        log=log,
    )


def start_tunnel(port: int) -> tuple[str, object] | None:
    """按 provider 计划依次尝试；cloudflared 下载失败时仍会尝试备用通道。"""
    return run_start_tunnel(
        port,
        plan_fn=build_tunnel_plan,
        should_stop_fn=tunnel_should_stop,
        ensure_binary_fn=ensure_cloudflared,
        attempt_fn=tunnel_attempt,
        boot=BOOT,
        boot_lock=BOOT_LOCK,
        log=log,
    )


def recover_tunnel_error() -> None:
    """隧道恢复后清掉 tunnel_failed 错误态，避免 Host 把 /health 当成致命错误。"""
    run_recover_tunnel_error(
        state=STATE,
        state_lock=STATE_LOCK,
        boot=BOOT,
        boot_lock=BOOT_LOCK,
        set_phase_fn=set_phase,
        log=log,
    )


def announce_tunnel_ready(provider: str, *, restarted: bool = False) -> None:
    """隧道（重新）建立：记录通道类型、清隧道错误并重播 ready。"""
    run_announce_tunnel_ready(
        provider,
        restarted=restarted,
        boot=BOOT,
        boot_lock=BOOT_LOCK,
        recover_fn=recover_tunnel_error,
        publish_fn=publish_ready,
        log=log,
    )


def tunnel_wait_exit(proc, poll_interval: float = 1.0):  # noqa: ANN001, ANN202
    """常驻等待隧道进程退出；收到停机信号时返回 None。"""
    return wait_tunnel_exit(proc, tunnel_should_stop, poll_interval=poll_interval)


def tunnel_monitor(port: int) -> None:
    """常驻监管：拉起隧道 → 等进程退出 / 失败退避重拉；直到收到停机信号。"""
    run_tunnel_monitor(
        port,
        should_stop_fn=tunnel_should_stop,
        start_tunnel_fn=start_tunnel,
        restart_delay_fn=tunnel_restart_delay,
        announce_fn=announce_tunnel_ready,
        wait_exit_fn=tunnel_wait_exit,
        terminate_fn=terminate_tunnel_process,
        fail_boot_fn=fail_boot,
        state=STATE,
        state_lock=STATE_LOCK,
        boot=BOOT,
        boot_lock=BOOT_LOCK,
        log=log,
    )


def tunnel_boot(port: int) -> None:
    """启动常驻隧道监管线程（不阻塞 HTTP 服务与运行时启动）。"""
    with BOOT_LOCK:
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


# M3.3：Kaggle 未绑定手机号或未启用 GPU 加速器时会静默降级成 CPU 容器。这里必须立刻
# 给出可执行的下一步，而不是继续用 CPU 硬跑（那会表现为超时或模糊的 CUDA 报错）。
GPU_UNAVAILABLE_MESSAGE = (
    "未检测到可用 GPU（当前为 CPU 容器）。"
    "请检查 Kaggle 账号是否已完成手机号验证，并确认已启用 GPU 加速器"
    "（本插件推送 Kernel 时默认开启 2×Tesla T4）"
)


def runtime_boot() -> None:
    """后台线程：探测 GPU → 装依赖 →（可选）预加载模型 → phase=ready。"""
    torch_error = ""
    device_name = None
    device_count = 0
    try:
        import torch

        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            device_count = torch.cuda.device_count()
            log(f"[cuda] {device_name} × {device_count}，torch={torch.__version__}，cuda={torch.version.cuda}")
    except Exception as exc:
        torch_error = short(exc)
        log(f"[cuda] 导入 torch 失败：{torch_error}")

    with STATE_LOCK:
        STATE.device = device_name
        STATE.device_count = device_count

    if not device_count:
        if torch_error:
            # torch 都没能导入时无法确认 GPU 状态，保留 load_failed 以免误导成账号问题。
            fail_boot("load_failed", f"无法确认 GPU 可用性：{torch_error}")
        else:
            fail_boot("gpu_unavailable", GPU_UNAVAILABLE_MESSAGE)
        return

    try:
        install_dependencies()
    except Exception as exc:
        fail_boot("load_failed", short(exc))
        return

    preload = CONFIG.preload
    if preload:
        try:
            with GEN_LOCK:
                ensure_pipeline(preload)
        except Exception as exc:
            free_cuda_cache()
            code, message = classify_failure(exc, default="load_failed")
            fail_boot(code, message)
            return

    with STATE_LOCK:
        STATE.booted = True
        need_ready = STATE.phase != "ready"
    if need_ready:
        set_phase("ready", "依赖已就绪，等待首个生成请求下发 pipeline")
    log("[boot] 运行时就绪，可以接单")


def _install_signal_handlers() -> None:
    try:
        import signal

        def _bye(signum, _frame):  # noqa: ANN001
            log(f"[signal] 收到信号 {signum}，退出进程")
            _cleanup_before_exit()
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
    with STATE_LOCK:
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
    while not BOOT.stop_event.wait(2.0):
        now = time.time()

        should_publish = False
        with BOOT_LOCK:
            if BOOT.tunnel_url and not BOOT.published_ready:
                BOOT.published_ready = True
                should_publish = True
            tunnel_url = BOOT.tunnel_url
            tunnel_provider = BOOT.tunnel_provider
        if should_publish:
            publish_ready()

        # P0.2：每 TUNNEL_ANNOUNCE_SEC 秒重播一次 ready，Host 心跳丢失后可重新会合。
        if tunnel_url and now - last_announce >= TUNNEL_ANNOUNCE_SEC:
            last_announce = now
            log(
                f"[tunnel] 周期重播 ready（通道 {tunnel_provider or 'unknown'}，"
                f"间隔 {int(TUNNEL_ANNOUNCE_SEC)}s）"
            )
            threading.Thread(target=publish_ready, name="announce-ready", daemon=True).start()

        with STATE_LOCK:
            last_active = STATE.last_active
            phase = STATE.phase
            jobs_done = STATE.jobs_done
        idle = now - last_active
        busy = active_job_count() > 0 or GEN_LOCK.locked()
        # 启动阶段（装依赖/预加载）不参与空闲退出：Host 可能把 idle_timeout 调得很短，
        # 但首轮加载本来就要几分钟。失败进入 error 后照样会被看门狗收走。
        bootstrapping = phase in ("booting", "installing", "loading")
        if not busy and not bootstrapping and idle >= CONFIG.idle_timeout_sec:
            log(f"[idle] 空闲 {int(idle)}s ≥ {CONFIG.idle_timeout_sec}s，退出进程释放 GPU 配额")
            _cleanup_before_exit()
            os._exit(0)

        if now - last_report >= 30:
            last_report = now
            log(
                f"[alive] phase={phase} idle={int(idle)}s jobs={jobs_done} "
                f"queue={queue_depth()} tunnel={'ok' if tunnel_url else 'pending'}"
            )
    _cleanup_before_exit()


if __name__ == "__main__":
    main()
