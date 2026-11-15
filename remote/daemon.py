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

文件边界（Batch 2 切片⑥e 之后）：本文件只留**配置注入点、ntfy 会合、模型加载的装配与出图
执行、job 执行，以及各域的薄包装**。HTTP 传输层在 ``remote/transport/http_server.py``，进程
生命周期（启动顺序 / 信号 / 退出清理 / 空闲看门狗）在 ``remote/app.py``，模型家族的加载策略
（白名单、垫图能力、keep_set 推导、构建）在 ``remote/inference/{registry.py,loaders/}``——三者
都由本文件末尾的装配块接起来。本文件仍是入口模块，因为启动器按 ``daemon.main`` 与
``daemon.set_embedded_config`` 取符号。
"""

from __future__ import annotations

import base64
import binascii
import gc
import hashlib
import io
import json
import math
import os
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
# 只有 ThreadingHTTPServer 还留在本文件（start_http_server 的返回类型）；handler 本体与
# Bearer 鉴权的 hmac 比较随 transport/http_server.py 一起搬走了。
from http.server import ThreadingHTTPServer

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

# 参考图格式常量随 remote/inference/reference_codec.py 一起走，这里同名再导出
# （`d.REFERENCE_IMAGE_FORMATS` 这类外部引用保持不变）。loader 白名单与垫图能力不在这里
# 维护：唯一真源是 `remote/inference/registry.py`，见下面的 `LOADERS`。
from remote.inference.reference_codec import REFERENCE_IMAGE_FORMATS  # noqa: E402

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
    # 门面导出：旧调用点（单测）按 `d._TunnelAttempt` 造"过期的尝试令牌"，
    # 真实现已归 remote/infra/tunnel.py 使用（`TUNNEL.attempt` 内部构造）。
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

from pipeline_loader import filter_call_kwargs, is_oom_error, pip_install_argv, pip_uninstall_argv, pipe_signature_params  # noqa: E402
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

from remote.inference.registry import LoadContext, default_registry  # noqa: E402
from remote.infra.cache import CacheManager  # noqa: E402

# 模型加载注册表：白名单、垫图能力、keep_set 推导与管线构建的唯一入口。
# 先于 CACHE 构造——缓存闸门要用它的 required_repos 推导"切模型时哪些仓库不能删"。
LOADERS = default_registry()

# `d.SUPPORTED_LOADERS` / `d.SUPPORTED_IMG2IMG_LOADERS` 是注册表的只读投影（旧引用面）：
# 白名单与垫图能力不再在本文件维护，新增 loader 只改 remote/inference/registry.py。
SUPPORTED_LOADERS = LOADERS.names()
SUPPORTED_IMG2IMG_LOADERS = LOADERS.img2img_names()

# 磁盘与缓存的门面：构造一次；config 传活对象（注入契约在启动期原地回填，见 config.py）。
CACHE = CacheManager(
    config=CONFIG, log_fn=log, error_cls=LoadError, required_repos_fn=LOADERS.required_repos
)

# ── 门面别名（Batch 3 随 daemon 门面一起删） ──────────────────────────────────
#
# 实现已不在本文件：下面这些名字只是 `CACHE` 上同名方法的别名，供旧调用点与单测按模块
# 属性取值。**替换这里的名字不会改变内部行为**——内部调用一律走 `CACHE.*`。要观察或改变
# 内部行为（例如"闸门是否真的去清理缓存"），请替换 `CACHE` 上的同名方法；若哪天有人把实现
# 写回本文件，两处替换会分别命中不同对象，那就是 §1.3.6 的假绿形态。
resolve_local_model = CACHE.resolve_local_model
resolve_local_weight = CACHE.resolve_local_weight
local_model_dir = CACHE.local_model_dir
anima_local_assets = CACHE.anima_local_assets
mount_point_of = CACHE.mount_point_of
cache_probe_lines = CACHE.cache_probe_lines
disk_precheck = CACHE.disk_precheck
ensure_disk_capacity = CACHE.ensure_disk_capacity
cache_keep_repos = CACHE.cache_keep_repos
evict_cache_for = CACHE.evict_cache_for
ensure_cache_capacity = CACHE.ensure_cache_capacity


def _load_context() -> LoadContext:
    """每次加载现取协作者：`CACHE` / `free_cuda_cache` 都是模块全局，替换后要立刻生效。"""
    return LoadContext(
        cache=CACHE,
        log=log,
        error_cls=LoadError,
        request_error_cls=RequestError,
        release_gpu=free_cuda_cache,
    )


def build_pipeline(pipeline_spec: dict):
    """按 loader 分派到注册表里的策略；返回 (pipe, 人类可读的 loaded 标识)。

    具体家族（预挂载解析、磁盘预检、预下载、构建与错误分类）见
    ``remote/inference/loaders/``；本函数只保留"装配"这一件事，Batch 3 随门面一起删。
    """
    return LOADERS.build(pipeline_spec, _load_context())


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
    CACHE.log_probe_once()
    started = time.time()
    try:
        # M4.1：真正下载/加载前按需清理旧模型缓存。切模型时 release_pipeline 已先执行
        # （其中含 gc.collect() 与 torch.cuda.empty_cache()），这里只删磁盘上的旧权重。
        CACHE.ensure_cache_capacity(pipeline_spec)
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
    return validate_generate_spec_impl(
        spec, limits_for=_limit_spec, max_tasks=_max_tasks(), supported_loaders=SUPPORTED_LOADERS
    )


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


# ─────────────────────────────────────────────────────────────────────────────
# HTTP 传输层（实现在 remote/transport/http_server.py）
#
# 路由分派、Bearer 鉴权与「异常 → 状态码」映射都搬进 transport/http_server.py；本文件
# 只保留**装配**：把本模块的符号包成 lambda 交给 HttpApi，调用点才解析实现——这样单测
# 的 `mock.patch.object(d, "submit_job")` 之类的替换仍然生效（直接传函数对象会把构造
# 时刻的实现绑死，断言会静默测到旧对象，见架构规格 §1.3.6）。
#
# 为什么 /health 的取样留在本文件：它拥有锁顺序（先持 STATE_LOCK 取快照，释放后再取
# queue_depth），是规格 §5.8 唯一方向的守卫点；单测按 `d.STATE_LOCK` / `d.queue_depth`
# 观察它，搬进 transport 会让这两个替换点静默失效。
# ─────────────────────────────────────────────────────────────────────────────

from remote.transport.http_server import (  # noqa: E402
    DaemonHandler,
    HttpApi,
    configure as configure_http_api,
    start_server as start_http_server_impl,
)

HTTP_API = HttpApi(
    config=CONFIG,
    state=STATE,
    state_lock=STATE_LOCK,
    request_body_limit=lambda: _request_body_limit(),
    health_payload=lambda: health_payload(),
    log_since=lambda since: log_since(since),
    get_job=lambda job_id: get_job(job_id),
    job_payload=lambda job: job_payload(job),
    submit_job=lambda *args, **kwargs: submit_job(*args, **kwargs),
    validate_generate_spec=lambda spec: validate_generate_spec(spec),
    parse_reference_spec=lambda raw, pipeline_spec: parse_reference_spec(raw, pipeline_spec),
    normalize_job_id=lambda raw: normalize_job_id(raw),
    request_shutdown=lambda: request_shutdown(),
    cleanup_before_exit=lambda: _cleanup_before_exit(),
    iso_time=lambda ts: iso_time(ts),
    version=lambda: VERSION,
)
# 装配一次即可：handler 用类属性持有 api，之后每个连接读同一份（config / state 是活对象）。
configure_http_api(HTTP_API)


def start_http_server(port: int) -> ThreadingHTTPServer:
    """监听并后台 serve（实现在 transport/http_server.py），server 句柄登记进 BOOT。"""
    return start_http_server_impl(port, boot=BOOT, boot_lock=BOOT_LOCK)


# ─────────────────────────────────────────────────────────────────────────────
# 隧道（cloudflared quick tunnel + 可配置备用通道）
#
# 实现已搬到 remote/infra/tunnel.py 的 TunnelSupervisor（二进制设置、通道计划、单次
# 尝试、常驻监管与指数退避重拉）。本文件只保留纯函数再导出与门面别名：下面这行 import
# 是 `normalize_tunnel_command` / `extract_tunnel_url` / 版本常量等旧取数点的出口，
# 其余 `run_*` / `spawn_*` / 下载辅助都只在 infra/tunnel.py 内部使用。
# P2.2：cloudflared 失败或超时后按 provider 计划尝试备用命令，成功后 provider='custom'。
# ─────────────────────────────────────────────────────────────────────────────

from tunnel import (  # noqa: E402
    CLOUDFLARED_DOWNLOAD_URL,
    CLOUDFLARED_PATH,
    CLOUDFLARED_SHA256,
    CLOUDFLARED_URL_RE,
    CLOUDFLARED_VERSION,
    DEFAULT_CUSTOM_URL_RE,
    TUNNEL_ANNOUNCE_SEC,
    TUNNEL_PROVIDERS,
    TUNNEL_RESTART_MAX_SEC,
    extract_tunnel_url,
    normalize_tunnel_command,
    terminate_tunnel_process,
)

from remote.infra.tunnel import TunnelBinary, TunnelSupervisor  # noqa: E402, F401

# 隧道生命周期的门面：boot / state 传活对象；三个回调都用 lambda——单测替换
# `daemon.publish_ready` / `daemon.fail_boot` 时，调用点才解析实现（§1.3.6）。
TUNNEL = TunnelSupervisor(
    config=CONFIG,
    boot=BOOT,
    boot_lock=BOOT_LOCK,
    state=STATE,
    state_lock=STATE_LOCK,
    publish_fn=lambda: publish_ready(),
    set_phase_fn=lambda phase, detail=None: set_phase(phase, detail),
    fail_boot_fn=lambda code, message, tunnel=False: fail_boot(code, message, tunnel=tunnel),
)

# ── 门面别名（Batch 3 随 daemon 门面一起删） ──────────────────────────────────
#
# 与缓存域同一口径：实现已在 remote/infra/tunnel.py，下面只是 `TUNNEL` 上同名方法的
# 别名。**替换这些名字不会改变内部行为**——内部调用一律走 self.*。要替换二进制参数
# （路径 / URL / SHA256 / 大小上限），改 `TUNNEL.binary` 的字段；patch
# `daemon.CLOUDFLARED_*` 只是改同一份数值的只读副本，不会影响下载路径。
ensure_cloudflared = TUNNEL.ensure_cloudflared
tunnel_url_regex = TUNNEL.url_regex
build_tunnel_plan = TUNNEL.build_plan
tunnel_should_stop = TUNNEL.should_stop
_spawn_tunnel_process = TUNNEL.spawn
_drain_tunnel_output = TUNNEL.drain
tunnel_attempt = TUNNEL.attempt
start_tunnel = TUNNEL.start
recover_tunnel_error = TUNNEL.recover_error
announce_tunnel_ready = TUNNEL.announce_ready
tunnel_wait_exit = TUNNEL.wait_exit
tunnel_monitor = TUNNEL.monitor
tunnel_restart_delay = TUNNEL.restart_delay


# `tunnel_boot`（拉起常驻监管线程）随进程生命周期搬到 remote/app.py 的
# `DaemonApp.tunnel_boot`；本文件末尾按 `tunnel_boot = APP.tunnel_boot` 保留同名属性。


# ─────────────────────────────────────────────────────────────────────────────
# 进程生命周期（实现在 remote/app.py）
#
# 启动顺序、信号、退出清理与空闲看门狗搬进 remote/app.py 的 DaemonApp；本文件只保留
# **装配点**：把上面的符号以 lambda 传进去（不是函数对象），这样单测
# `mock.patch.object(d, "install_dependencies")` / "ensure_pipeline" 在调用点仍然生效
# ——直接传函数会把构造时刻的实现绑死在实例上（架构规格 §1.3.6 的假绿陷阱）。
#
# 装配留在本文件的原因：本文件仍是入口模块——启动器按 `daemon.main` /
# `daemon.set_embedded_config` 取符号，test/kernel-package.mjs 按
# `daemon.EMBEDDED_CONFIG_B64` 验证注入落地。Batch 3 移除门面时这两件事一起搬。
# ─────────────────────────────────────────────────────────────────────────────

from remote.app import GPU_UNAVAILABLE_MESSAGE, DaemonApp  # noqa: E402, F401

APP = DaemonApp(
    config=CONFIG,
    state=STATE,
    boot=BOOT,
    state_lock=STATE_LOCK,
    boot_lock=BOOT_LOCK,
    gen_lock=GEN_LOCK,
    load_config=lambda: load_config(),
    apply_hf_token=lambda: apply_hf_token(),
    auth_missing=lambda: auth_missing(),
    protocol_version=lambda: protocol_version(),
    install_stream_tee=lambda: install_stream_tee(),
    install_dependencies=lambda: install_dependencies(),
    ensure_pipeline=lambda spec: ensure_pipeline(spec),
    classify_failure=lambda exc, default="generation_failed": classify_failure(exc, default=default),
    free_cuda_cache=lambda: free_cuda_cache(),
    set_phase=lambda phase, detail=None: set_phase(phase, detail),
    fail_boot=lambda code, message: fail_boot(code, message),
    publish_ready=lambda: publish_ready(),
    active_job_count=lambda: active_job_count(),
    queue_depth=lambda: queue_depth(),
    start_http_server=lambda port: start_http_server(port),
    start_job_worker=lambda: start_job_worker(),
    tunnel_monitor=lambda port: tunnel_monitor(port),
    cleanup_before_exit=lambda: _cleanup_before_exit(),
    announce_interval_sec=TUNNEL_ANNOUNCE_SEC,
)

# 入口符号：启动器与 `python remote/daemon.py` 都按模块属性取（main 必须可调用）。
runtime_boot = APP.runtime_boot
tunnel_boot = APP.tunnel_boot
main = APP.run


if __name__ == "__main__":
    main()
