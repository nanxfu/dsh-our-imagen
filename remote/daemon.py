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

# ─────────────────────────────────────────────────────────────────────────────
# Host 注入点：推送 Kernel 前，Host 会按 "EMBEDDED_CONFIG_B64" 这个变量名的整行赋值做一次
# 精确字符串替换。这一行必须保持「变量名 = 空字符串」的原始形态，不要加类型注解、
# 不要换引号、不要拆行；本文件里只出现一次。
# ─────────────────────────────────────────────────────────────────────────────
EMBEDDED_CONFIG_B64 = ""

VERSION = "0.4.1"

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

SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2")

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


def build_pipeline(pipeline_spec: dict):
    """按 loader 分支加载；返回 (pipe, 人类可读的 loaded 标识)。"""
    loader = str(pipeline_spec["loader"])
    base = str(pipeline_spec["base"])
    variant = pipeline_spec.get("variant")
    allow_patterns = pipeline_spec.get("allowPatterns")
    device_map = pipeline_spec.get("deviceMap")

    # P2.1：命中预挂载目录时直接用本地权重（跳过下载与磁盘预检）。
    local_base = resolve_local_model(base)
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


def run_tasks(pipe, tasks: list[dict]) -> list[dict]:  # noqa: ANN001
    import torch

    sig = STATE.sig_params
    generator_device = "cuda" if torch.cuda.is_available() else "cpu"
    results: list[dict] = []
    for task in tasks:
        STATE.last_active = time.time()
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
        results.append(
            {
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
        )
        log(f"[gen] {task['name']} 完成，{seconds}s，{len(png)} 字节")
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
        "queue_depth": STATE.waiting,
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
        except RequestError as exc:
            log(f"[gen] 请求非法：{exc}")
            self._send_error(400, "invalid_request", str(exc))
            return

        # 等待计数用于 /health 的 queue_depth；拿到锁之后就不算在排队了。
        STATE.waiting += 1
        got_lock = GEN_LOCK.acquire()
        STATE.waiting = max(0, STATE.waiting - 1)
        if not got_lock:  # pragma: no cover - Lock.acquire() 不会返回 False
            self._send_error(503, "generation_failed", "生成锁获取失败")
            return

        try:
            started = time.time()
            pipe, load_seconds = ensure_pipeline(pipeline_spec)
            results = run_tasks(pipe, tasks)
            STATE.jobs_done += len(results)
            STATE.last_active = time.time()
            total = round(time.time() - started, 2)
            log(f"[gen] 请求完成：{len(results)} 张，总耗时 {total}s（加载 {load_seconds}s）")
            self._send_json(
                200,
                {
                    "status": "ok",
                    "model_id": model_id,
                    "load_seconds": load_seconds,
                    "results": results,
                },
            )
        except RequestError as exc:
            code, message = classify_failure(exc)
            record_error(code, message)
            log(f"[gen] 请求非法：{message}")
            self._send_error(400, code, message)
        except Exception as exc:
            code, message = classify_failure(exc)
            if code == "oom":
                free_cuda_cache()
            record_error(code, message)
            log(f"[gen] 失败（{code}）：{message}")
            log(traceback.format_exc())
            self._send_error(500, code, message)
        finally:
            GEN_LOCK.release()
            STATE.last_active = time.time()


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
        busy = STATE.waiting > 0 or GEN_LOCK.locked()
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
                f"queue={STATE.waiting} tunnel={'ok' if BOOT.tunnel_url else 'pending'}"
            )


if __name__ == "__main__":
    main()
