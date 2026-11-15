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

    为什么留在入口模块而不是搬进 remote/config.py：启动器（remote/_entry.py）按
    `getattr(entry_module, "set_embedded_config")` 取这个函数，`test/kernel-package.mjs`
    也按 `daemon.EMBEDDED_CONFIG_B64` 验证注入是否落地。变量与 setter 同处本模块，
    "函数写进了另一个模块的变量"这种静默丢配置就不会发生；配置的解析与归一在
    remote/config.py，由 load_config() 转交。
    """
    global EMBEDDED_CONFIG_B64
    EMBEDDED_CONFIG_B64 = value or ""

VERSION = "0.10.0"

# 依赖约束默认留空（0.4.1 修正）。0.4.0 曾内置「版本上限」做固化
# （diffusers<1.0 / transformers<5 / accelerate<2 / peft<1），实测与当前 diffusers
# 新版直接冲突：diffusers 0.42+ 依赖 huggingface-hub>=1.32，而 transformers 4.x
# 要求 huggingface-hub<1.0，pip 只能回溯到 2019 年的 transformers 4.12.2；在
# Kaggle 镜像存在预装包时解析直接失败（远端表现 load_failed: pip install 退出码 1）。
# 需要固定版本时用 Host 的 `pipConstraints` 显式钉一组自己验证过的组合；默认装
# 最新兼容组合，再用导入自检兜底。
PIP_CONSTRAINTS: dict[str, str] = {}
IMPORT_CHECK_MODULES = ("torch", "diffusers", "transformers", "accelerate", "peft")

# 请求校验（remote/transport/validator.py）与参考图编解码（remote/inference/reference_codec.py）
# 的常量随子模块一起走；这里同名再导出，`d.SUPPORTED_LOADERS` / `d.REFERENCE_IMAGE_FORMATS`
# 这类外部引用保持不变。
from remote.inference.reference_codec import REFERENCE_IMAGE_FORMATS  # noqa: E402
from remote.transport.validator import SUPPORTED_LOADERS  # noqa: E402

# 图生图（垫图重绘）首期只开放能整管复用 AutoPipelineForImage2Image 的 SDXL 家族。
# 这是提交期的最后一道兜底：模型资产里的 supportsImg2Img 由 Host/客户端使用，daemon 不信它。
SUPPORTED_IMG2IMG_LOADERS = ("sdxl", "sdxl-lora")

# ─────────────────────────────────────────────────────────────────────────────
# 异步 job 协议（0.5.0）
#
# POST /generate 只做校验与入队，立即 202 返回；常驻 worker 线程串行执行，
# Host 用 GET /job?id= 轮询。原因：同步长请求在 Cloudflare quick tunnel /
# 本地代理链路上会被判成「响应空闲」中途掐断（cloudflared context canceled），
# 一张图 80s 以上的模型必中。拆成短请求 + 轮询后，任何一层都不会被长连接拖住。
#
# 保留策略（留多少个、TTL 多长）在 remote/jobs/models.py 的常量里，淘汰实现在
# remote/jobs/store.py；这里不再重复数字，避免改一处漏一处。
# ─────────────────────────────────────────────────────────────────────────────
# job 领域常量、实体与失败分类已搬到 remote/jobs/models.py；这里同名导入，
# `d.Job` / `d.JOB_STATUS_DONE` / `d.JOB_MAX_FINISHED` / `d.normalize_job_id` 等引用不变。
from remote.jobs.models import (  # noqa: E402
    JOB_ID_MAX_CHARS,
    JOB_ID_RE,
    JOB_MAX_FINISHED,
    JOB_STATUS_DONE,
    JOB_STATUS_FAILED,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_TTL_SEC,
    Job,
    classify_failure,
    iso_time,
    new_job_id,
    normalize_job_id,
)
from remote.jobs.runner import JobRunner  # noqa: E402
from remote.jobs.store import JOB_MAX_QUEUE_DEPTH, JobStore  # noqa: E402

# ─────────────────────────────────────────────────────────────────────────────
# 日志环（单份源码在 remote/log_ring.py，随源码包一起推送到 Kaggle）
# ─────────────────────────────────────────────────────────────────────────────

from log_ring import LOG_LINE_MAX_CHARS, LOG_MAX_LINES, _LOG_LINES, _LOG_LOCK, _LOG_SEQ, _NOISE_RE, _ORIG_STDERR, _ORIG_STDOUT, _START_TS, _StreamTee, _console, _elapsed, _ring_append, install_stream_tee, log, log_since, reset_log_ring  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# 状态与配置（单份源码在 remote/state.py、remote/config.py）
#
# 历史：配置、运行期资源、统计与生命周期原先塞在同一个模块级 dict 里（23 个键），
# 无法在单测里构造隔离实例；0.9 拆成三个 dataclass，但对象与锁仍留在本文件顶层，
# 于是每个函数都能绕过边界直接改字段（见架构规格 §1.3）。
#
# 现在：状态对象、锁、配置与契约边界各自搬进独立模块，本文件只做 re-export，
# 保住 `d.CONFIG` / `d.STATE` / `d.BOOT` / `d.DaemonConfig` 这些既有引用面。
#
# 约定（架构规格 §5.9 / §5.10）：
#   1. 三个单例**只在 import 时创建一次，之后只做原地更新**。禁止在本文件里写
#      `CONFIG = load_config()` 或 `STATE = RuntimeState()`——remote/state.py 与
#      remote/config.py 内部读的是同一个对象，重新绑定只会让两边各自持有一份状态，
#      且不报错（单测断言会静默测到旧对象，假绿）。
#   2. 全文件只用属性访问（STATE.phase / BOOT.tunnel_url / CONFIG.port）。
# ─────────────────────────────────────────────────────────────────────────────

from remote.config import (  # noqa: E402
    CONFIG,
    DEFAULT_PORT,
    FALLBACK_LIMITS as _FALLBACK_LIMITS,
    KNOWN_CONFIG_KEYS as _KNOWN_CONFIG_KEYS,
    MAX_TASKS_FALLBACK as _MAX_TASKS_FALLBACK,
    DaemonConfig,
    build_config as _build_config,
    contract_limits as _contract_limits,
    limit_spec as _limit_spec,
    load_config as load_config_impl,
    max_tasks as _max_tasks,
    normalize_fallback_command,
    normalize_local_models,
    normalize_pip_constraints,
    request_body_limit as _request_body_limit,
)
from remote.state import (  # noqa: E402, F401
    BOOT,
    BOOT_LOCK,
    STATE,
    STATE_LOCK,
    BootState,
    RuntimeState,
    TunnelAttempt as _TunnelAttempt,
    record_error,
    set_phase,
)


# 生成串行锁与清理闸门：只属于本进程，不塞进状态对象（状态复制时不该连带复制锁）。
GEN_LOCK = threading.Lock()
_CLEANUP_LOCK = threading.Lock()
_CLEANUP_DONE = False


def _max_queue_depth() -> int:
    """允许排队的最大待执行 job 数（防止内存 DoS）；契约下发 limits.queue.maxPending 时以契约为准。

    用回调交给 JobStore 而不是传一个数字：契约在 ``load_config()`` 里被原地填充，队列上限
    必须每次取最新值（启动期构造 store 时契约还是空的）。
    """
    limits = _contract_limits()
    queue_cfg = limits.get("queue") if limits else None
    raw = queue_cfg.get("maxPending") if isinstance(queue_cfg, dict) else None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and int(raw) > 0:
        return int(raw)
    return JOB_MAX_QUEUE_DEPTH


# 异步 job 的唯一存储：表、待执行队列、结束顺序与它们的两把锁都在 JobStore 内部
# （remote/jobs/store.py）。这里只保留一个实例 + 兼容旧调用面的薄包装。
JOB_STORE = JobStore(capacity=_max_queue_depth)


class _JobWakeCompat:
    """兼容旧调用与单测里的 JOB_WAKE.set()/clear()，底层委托给 JobStore 的条件变量。"""

    def set(self) -> None:
        JOB_STORE.notify()

    def clear(self) -> None:
        pass

    def wait(self, timeout: float | None = None) -> bool:
        return JOB_STORE.wait_for_change(timeout)


JOB_WAKE = _JobWakeCompat()

# worker 循环本身在 remote/jobs/runner.py；这里把三个协作者以 lambda 注入：
# 每次调用才解析模块属性，单测替换 d.execute_job / 关停 BOOT.stop_event 才能生效。
job_runner = JobRunner(
    JOB_STORE,
    execute=lambda job: execute_job(job),
    should_stop=lambda: BOOT.stop_event.is_set(),
    finish_job=lambda job, status, error=None: _finish_job(job, status, error),
)


# ─────────────────────────────────────────────────────────────────────────────
# 领域异常（单份源码在 remote/errors.py，随源码包一起推送到 Kaggle）
#
# 搬家的原因：请求校验与参考图编解码两个子模块都要抛这三种异常，定义留在 daemon.py
# 会让子模块反向依赖入口文件。这里同名导入，`d.RequestError` 等引用保持不变。
# ─────────────────────────────────────────────────────────────────────────────

from remote.errors import LoadError, QueueFullError, RequestError  # noqa: E402


# `short()` 的单份实现在 remote/text.py（infra.process 也要用同一份，避免第 6 份副本）。
# 其余三处（tunnel / pipeline_loader / cache_ops）按规格 §5.7 单列一批合并。
from remote.text import short  # noqa: E402


# `set_phase` / `record_error` 已随状态对象搬到 remote/state.py（锁与数据同笼），
# 这里按名字 re-export，`d.set_phase(...)` 与 `fail_boot` 的调用面不变。


# ── 异步 job：表、队列与轮询视图（协议 0.5.0） ────────────────────────────────
#
# 实体与状态常量在 remote/jobs/models.py，表 / 队列 / 淘汰策略在 remote/jobs/store.py，
# 两把锁与条件变量都是 JobStore 的私有成员。本文件只保留同名薄包装：HTTP 层与单测都按
# `d.submit_job` / `d.get_job` / `d.queue_depth` 这类模块属性调用，包装让「实现搬家 +
# 调用面不变」共存。`iso_time` / `new_job_id` / `normalize_job_id` 直接 re-export。


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
    return JOB_STORE.submit(pipeline_spec, model_id, tasks, job_id, reference)


def get_job(job_id: str) -> Job | None:
    return JOB_STORE.get(job_id)


def queue_depth() -> int:
    """``/health.queue_depth``：尚未开始执行的 job 数（来自 JobStore，不是状态对象）。"""
    return JOB_STORE.queue_depth()


def active_job_count() -> int:
    """排队 + 运行中的 job 数（空闲看门狗用它判断是否忙碌）。"""
    return JOB_STORE.active_count()


def job_payload(job: Job) -> dict:
    """``GET /job`` 的响应体；results 只在 done 时给，其它状态为 null。"""
    return JOB_STORE.payload(job)


def prune_jobs(now: float | None = None) -> None:
    """淘汰已结束 job（先 TTL、再数量上限 FIFO）；锁由 JobStore 自己持有。"""
    JOB_STORE.prune(now)


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
#
# DaemonConfig、注入键表、各注入项的归一与契约边界取数都在 remote/config.py
# （"本次会话允许什么"只有一个取数点）。本文件只剩两件事：
#   1. 注入串与 setter —— 启动器与打包测试按 `daemon.EMBEDDED_CONFIG_B64` 观测注入结果，
#      所以变量与函数必须留在入口模块；
#   2. load_config() 薄包装 —— 把注入串交给 config.load_config()，由后者**原地**回填 CONFIG。
# ─────────────────────────────────────────────────────────────────────────────


def load_config() -> DaemonConfig:
    """读取 Host 注入的配置；环境变量 IMAGEN_CONFIG_B64 作为兜底（本地调试用）。

    返回值就是模块级 ``CONFIG`` 本身（原地更新）。**不要写成 ``CONFIG = load_config()``**：
    remote/config.py 内部读的是它自己的那个单例，重新绑定只会让两边各持一份配置，
    而且不会报错（表现为"配置没生效"的假绿）。

    拆分边界：解析、归一、日志都在 config.load_config()；注入串留在这里，因为启动器
    （remote/_entry.py）与 test/kernel-package.mjs 都通过本模块的属性验证"注入已落地"。
    """
    return load_config_impl(EMBEDDED_CONFIG_B64, target=CONFIG)


# `build_config` / `normalize_pip_constraints` / `normalize_fallback_command` /
# `normalize_local_models` / `_KNOWN_CONFIG_KEYS` 已搬到 remote/config.py；本文件按上面的
# 导入块保留 `_build_config` / `_KNOWN_CONFIG_KEYS` 等同名引用（单测与内部调用面不变）。


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
# 依赖安装（pip plumbing 在 remote/infra/process.py）
#
# `stream_process`（原 `_stream_process`）/ `run_streaming*` / `run_command_tail` /
# `tail_summary` / `package_name` / `merge_pip_constraints` / `write_constraints_file` 与
# `IMPORT_CHECK_CODE` 已搬进 remote/infra/process.py：流式读行与 pip 环境只有一份实现
# （复用 pipeline_loader.pip_env()，不再各抄一遍环境变量），约束合并/包名归一也只有一处。
#
# 留在这里的是**启动编排**而不是 plumbing：install_dependencies 要按 phase 切换、带约束
# 失败后去掉重试、清理临时目录；verify_dependencies 要把自检失败映射成 LoadError 文案。
# 两者都按模块属性被单测打桩（`d.run_streaming_tail` / `d.run_command_tail`），编排留在
# 原处才能继续被替换。等切片⑥的 app.py 落地再连同 phase 一起搬。
# ─────────────────────────────────────────────────────────────────────────────

from pipeline_loader import PIP_INSTALL, PIP_UNINSTALL, filter_call_kwargs, from_pretrained_with_variant_fallback, is_oom_error, load_diffusers_pipeline, pip_install_argv, pip_uninstall_argv, pipe_signature_params  # noqa: E402
from remote.infra.process import (  # noqa: E402
    IMPORT_CHECK_CODE,
    IMPORT_CHECK_MODULES,
    PIP_CONSTRAINTS,
    merge_pip_constraints as merge_pip_constraints_impl,
    package_name,
    run_command_tail,
    run_streaming,
    run_streaming_tail,
    tail_summary,
    write_constraints_file,
)


def merge_pip_constraints(injected) -> list[str]:  # noqa: ANN001
    """默认约束按包名合并 Host 注入项：同名覆盖（保持原位置），新包追加。"""
    return merge_pip_constraints_impl(injected, PIP_CONSTRAINTS)


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


# `_int_param` / `_VALID_HF_REPO_RE` / `_valid_pipeline_base` 已随请求校验搬到
# remote/transport/validator.py（纯函数，参数边界由 limits_for 注入，无 daemon 全局依赖）。


# `_FALLBACK_LIMITS` / `_LIMIT_NUMERIC_KEYS` / `_limit_spec` / `_max_tasks` /
# `_request_body_limit` 已随契约边界解析搬到 remote/config.py（那里是 `CONFIG.contract`
# 的唯一取数点）。本文件只按导入块保留 `_limit_spec` / `_max_tasks` /
# `_request_body_limit` / `_MAX_TASKS_FALLBACK` / `_FALLBACK_LIMITS` 这些同名引用，
# 供 `validate_generate_spec` 等薄包装以 `limits_for=` 注入给纯函数，以及单测按
# `d._limit_spec(...)` 调用。


# ─────────────────────────────────────────────────────────────────────────────
# 薄包装：实现在 remote/inference/reference_codec.py 与 remote/transport/validator.py
#
# 为什么留同名包装而不是让调用方直接 import 子模块：`run_task` / `execute_job` 与单测都
# 按 daemon 的模块属性调用（`d.parse_reference_spec`、`mock.patch.object(d, …)`），包装让
# 「实现搬家 + 调用面不变」共存；边界来源仍由 daemon 掌握，用关键字参数注入给纯函数。
# ─────────────────────────────────────────────────────────────────────────────

from remote.inference.reference_codec import (  # noqa: E402
    _coerce_strength as _coerce_strength_impl,
    _open_reference_image as _open_reference_image_impl,
    decode_reference_image as decode_reference_image_impl,
    parse_reference_spec as parse_reference_spec_impl,
)
from remote.transport.validator import validate_generate_spec as validate_generate_spec_impl  # noqa: E402


def _coerce_strength(value) -> float:  # noqa: ANN001
    """重绘强度归一到 ``contract.limits.strength``：非法/缺失回退默认值，越界钳制。"""
    return _coerce_strength_impl(value, limits_for=_limit_spec)


def _open_reference_image(image_bytes: bytes):  # noqa: ANN202
    """只读参考图头部：校验 PNG/JPEG 与最小长边，返回未 load 的 PIL Image。"""
    return _open_reference_image_impl(image_bytes, limits_for=_limit_spec)


def parse_reference_spec(raw, pipeline_spec: dict) -> dict | None:  # noqa: ANN001
    """提交期校验 job 级参考图，归一成 ``{image_bytes, strength, width, height}``。"""
    return parse_reference_spec_impl(
        raw,
        pipeline_spec,
        limits_for=_limit_spec,
        img2img_loaders=SUPPORTED_IMG2IMG_LOADERS,
    )


def decode_reference_image(reference: dict) -> object:
    """执行期完整解码参考图一次：转 RGB，长边超过 ``maxEdge`` 时等比 LANCZOS 缩小。"""
    return decode_reference_image_impl(reference, limits_for=_limit_spec)


def validate_generate_spec(spec) -> tuple[dict, str, list[dict]]:  # noqa: ANN001
    """把请求体归一成 ``(pipeline_spec, model_id, tasks)``。"""
    return validate_generate_spec_impl(spec, limits_for=_limit_spec, max_tasks=_max_tasks())


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


# `classify_failure` 已随 job 领域模型搬到 remote/jobs/models.py（错误码/文案表与 job.error
# 同源）；这里按名字 re-export，`d.classify_failure(...)` 的调用面不变。


# ── 异步 job：worker 与执行 ──────────────────────────────────────────────────


def _update_job_progress(job: Job, partial: list[dict]) -> None:
    """每张出图后刷新进度（锁在 JobStore 内部）。"""
    JOB_STORE.update_progress(job, partial)


def _finish_job(job: Job, status: str, error: dict | None = None) -> None:
    """收尾：置终态、记结束时间、进淘汰队列，并刷新 last_active。

    锁顺序（§5.8）：``JOB_STORE.finish()`` 返回时 JOB_LOCK 已释放，之后才取 STATE_LOCK。
    反过来（持 JOB_LOCK 去取 STATE_LOCK 的同时，/health 持 STATE_LOCK 取队列深度）就会死锁。
    """
    now = JOB_STORE.finish(job, status, error)
    with STATE_LOCK:
        STATE.last_active = now


def execute_job(job: Job) -> None:
    """worker 里执行单个 job：加载 pipeline → 逐张出图 → 更新进度/终态。

    异常一律收在内部转成 job.error，绝不让 worker 线程退出。
    """
    JOB_STORE.mark_running(job)
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
            # 解码完成后释放队列里保留的原始字节（job 公开视图不含参考图）。
            JOB_STORE.clear_reference(job)
        pipe, load_seconds = ensure_pipeline(job.pipeline)
        JOB_STORE.record_loaded(job, load_seconds)
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
        JOB_STORE.set_results(job, results)
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
    """常驻 worker：串行消费 JobStore 的队列（循环实现在 remote/jobs/runner.py）。"""
    job_runner.run_forever()


def start_job_worker() -> threading.Thread:
    return job_runner.start()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP 服务
# ─────────────────────────────────────────────────────────────────────────────

# ── /health 快照（组装逻辑在 remote/observability/health.py） ─────────────────
#
# 字段组装、依赖版本快照与显存读取都搬进 observability/health.py；本文件只保留取样顺序：
# 先持 STATE_LOCK / BOOT_LOCK 取一份不可变快照（函数返回即释放），**再**取 queue_depth()。
# 顺序不能反：`_finish_job` 的方向是 JOB_LOCK → STATE_LOCK，/health 若在持 STATE_LOCK 时
# 去拿 JOB_LOCK 就是反向嵌套（架构规格 §5.8，会死锁）。

from remote.observability.health import (  # noqa: E402
    HEALTH_VERSION_MODULES,
    build_payload as health_build_payload,
    clean_version as _clean_version,
    dependency_versions,
    gpu_memory_payload,
    snapshot_from as health_snapshot_from,
)


def health_payload() -> dict:
    """``/health`` 响应体：先取样（锁即取即放），再取队列深度（见上面的锁顺序）。"""
    snapshot = health_snapshot_from(STATE, BOOT, state_lock=STATE_LOCK, boot_lock=BOOT_LOCK)
    return health_build_payload(
        snapshot,
        version=protocol_version(),
        idle_timeout_sec=CONFIG.idle_timeout_sec,
        queue_depth=queue_depth(),
    )


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
    install_stream_tee()
    _install_signal_handlers()
    with STATE_LOCK:
        STATE.started_at = time.time()
        STATE.last_active = STATE.started_at

    log("=" * 72)
    log(f"imagen 远端 Daemon v{protocol_version()} 启动")
    try:
        # 原地回填模块级 CONFIG：不能写成 `CONFIG = load_config()`，remote/config.py 与
        # 注入出去的协作者读的是同一个对象，重新绑定会让它们继续看旧配置（见架构规格 §5.10）。
        load_config()
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
