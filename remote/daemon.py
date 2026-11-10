#!/usr/bin/env python3
"""远端推理 Daemon（协议 v2）。

运行位置：Kaggle GPU Kernel 容器内，由 Host 通过 ``kaggle kernels push`` 拉起。
协议字段以 ``docs/SPEC.md`` 与本文档顶部说明为准，本文件是 Daemon 侧唯一实现。

设计要点（每一条都对应一次实测故障）：

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
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ─────────────────────────────────────────────────────────────────────────────
# Host 注入点：推送 Kernel 前，Host 会按 "EMBEDDED_CONFIG_B64" 这个变量名的整行赋值做一次
# 精确字符串替换。这一行必须保持「变量名 = 空字符串」的原始形态，不要加类型注解、
# 不要换引号、不要拆行；本文件里只出现一次。
# ─────────────────────────────────────────────────────────────────────────────
EMBEDDED_CONFIG_B64 = ""

VERSION = "0.2.0"

# 日志环容量：Host 侧按 docs/API.md 第 6 节实现，最多 400 行。
LOG_MAX_LINES = 400
LOG_LINE_MAX_CHARS = 2000

DEFAULT_PORT = 7860
CLOUDFLARED_PATH = "/tmp/cloudflared"
CLOUDFLARED_DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
)
CLOUDFLARED_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
TUNNEL_WAIT_SEC = 120.0

# 与 bench/lightning/run.py 完全一致：镜像自带 torchao 0.10.0 与新版 diffusers 冲突，
# 必须先卸载；随后升级这 4 个包。
PIP_UNINSTALL = ("torchao",)
PIP_INSTALL = ("diffusers", "transformers", "accelerate", "peft")

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
# 运行状态
# ─────────────────────────────────────────────────────────────────────────────

STATE: dict = {
    "phase": "booting",
    "detail": "进程启动",
    "model_id": None,
    "loaded": [],
    "device": None,
    "device_count": 0,
    "auth_token": "",
    "idle_timeout_sec": 1800,
    "last_active": _START_TS,
    "jobs_done": 0,
    "last_error": None,
    "last_error_code": None,
    "started_at": _START_TS,
    "port": DEFAULT_PORT,
    "ntfy_topic": "",
    "ntfy_server": "https://ntfy.sh",
    "preload": None,
    # 运行期对象
    "pipe": None,
    "pipeline_key": None,
    "sig_params": set(),
    "gen_lock": threading.Lock(),
    "waiting": 0,
    "shutting_down": False,
}

BOOT: dict = {
    "tunnel_url": None,
    "tunnel_error": None,
    "cloudflared": None,
    "published_ready": False,
}


class RequestError(ValueError):
    """请求本身不合法 → HTTP 400 invalid_request。"""


class LoadError(RuntimeError):
    """模型加载失败 → HTTP 500 load_failed。"""


def short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    text = " ".join(text.split())
    return text[:limit]


def set_phase(phase: str, detail: str | None = None) -> None:
    STATE["phase"] = phase
    STATE["detail"] = detail
    # 启动阶段的进度也算"活动"，避免依赖安装还没结束就被空闲看门狗收走。
    STATE["last_active"] = time.time()
    log(f"[phase] {phase}" + (f" — {detail}" if detail else ""))


def record_error(code: str, message: str) -> None:
    """``/health.last_error`` 是字符串：Host 直接拼进 UI，对象会显示成 [object Object]。"""
    STATE["last_error"] = f"{code}: {message}"
    STATE["last_error_code"] = code


# ─────────────────────────────────────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────────────────────────────────────


def _pick(cfg: dict, *names: str, default=None):
    for name in names:
        if name in cfg and cfg[name] is not None:
            return cfg[name]
    return default


def load_config() -> dict:
    """读取 Host 注入的配置；环境变量 IMAGEN_CONFIG_B64 作为兜底（本地调试用）。"""
    raw_b64 = (EMBEDDED_CONFIG_B64 or os.environ.get("IMAGEN_CONFIG_B64") or "").strip()
    if not raw_b64:
        log("[config] 未收到注入配置，按本地调试模式启动（无鉴权、无 ntfy）")
        return {}
    try:
        raw = base64.b64decode(raw_b64.encode("ascii")).decode("utf-8")
        cfg = json.loads(raw)
    except Exception as exc:
        # 只报异常类型，绝不把配置内容写进日志（里面含 auth_token）。
        raise SystemExit(f"配置解析失败：{type(exc).__name__}: {exc}") from None
    if not isinstance(cfg, dict):
        raise SystemExit("配置必须是 JSON 对象")
    return cfg


def apply_config(cfg: dict) -> None:
    STATE["auth_token"] = str(_pick(cfg, "auth_token", "authToken", "token", default="") or "")
    STATE["ntfy_topic"] = str(_pick(cfg, "ntfy_topic", "ntfyTopic", "topic", default="") or "")
    STATE["ntfy_server"] = str(
        _pick(cfg, "ntfy_server", "ntfyServer", default="https://ntfy.sh") or "https://ntfy.sh"
    ).rstrip("/")
    try:
        STATE["idle_timeout_sec"] = int(_pick(cfg, "idle_timeout_sec", "idleTimeoutSec", default=1800))
    except (TypeError, ValueError):
        STATE["idle_timeout_sec"] = 1800
    try:
        STATE["port"] = int(_pick(cfg, "port", default=DEFAULT_PORT))
    except (TypeError, ValueError):
        STATE["port"] = DEFAULT_PORT
    preload = _pick(cfg, "preload", "preloadPipeline", "pipeline", default=None)
    # preload 必须是 /generate 里同形状的 pipeline 描述对象（含 loader/base）；
    # Daemon 不认识预设 id，Host 已经在注入前把预设展开成对象。
    STATE["preload"] = preload if isinstance(preload, dict) and preload.get("loader") else None
    if preload is not None and STATE["preload"] is None:
        log("[config] preload 不是 pipeline 描述对象，已忽略（Host 应下发 {loader, base, ...}）")
    # 配置项名可以打日志，值不行（含 token）。
    log(f"[config] 已加载配置项：{', '.join(sorted(cfg.keys())) or '(空)'}")
    log(
        f"[config] idle_timeout={STATE['idle_timeout_sec']}s port={STATE['port']} "
        f"ntfy={'on' if STATE['ntfy_topic'] else 'off'} auth={'on' if STATE['auth_token'] else 'off'} "
        f"preload={STATE['preload'].get('loader') if STATE['preload'] else 'none'}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# ntfy 会合点
# ─────────────────────────────────────────────────────────────────────────────


def ntfy_publish(payload: dict, label: str) -> bool:
    """发布一条 JSON 字符串到 ntfy topic。

    关键：Content-Type 必须是 text/plain。ntfy 对 application/json 会走"发布指令"
    （publish directives）解析路径，普通 JSON 会被判成非法指令而失败（已实测）。
    """
    topic = STATE["ntfy_topic"]
    if not topic:
        log(f"[ntfy] 未配置 topic，跳过 {label} 发布")
        return False
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    url = f"{STATE['ntfy_server']}/{urllib.parse.quote(topic)}"
    for attempt in range(1, 4):
        try:
            request = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "text/plain",
                    "User-Agent": f"imagen-daemon/{VERSION}",
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
        "endpoint": BOOT["tunnel_url"],
        "model_id": STATE["model_id"],
        "device": STATE["device"],
    }
    ntfy_publish(payload, "ready")


def publish_error(code: str, message: str) -> None:
    payload = {"type": "error", "code": code, "message": message[:800]}
    ntfy_publish(payload, f"error({code})")


# ─────────────────────────────────────────────────────────────────────────────
# 依赖安装
# ─────────────────────────────────────────────────────────────────────────────


def run_streaming(argv: list[str], prefix: str) -> int:
    """跑子进程并把每一行输出写进日志环（pip 必须可见，否则用户以为卡死）。"""
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
        return -1
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            log(f"{prefix} {line}")
    code = proc.wait()
    log(f"{prefix} 退出码 {code}")
    return code


def install_dependencies() -> None:
    """按 bench/lightning/run.py 已验证过的顺序处理依赖。"""
    set_phase("installing", "卸载 torchao 并升级 diffusers 相关依赖")
    run_streaming(
        [sys.executable, "-m", "pip", "uninstall", "-y", "-q", *PIP_UNINSTALL],
        "[pip]",
    )
    code = run_streaming(
        # 不加 -q：Collecting / Downloading / Installing 这些行要留在日志环里，
        # 用户排队结束后才看得到"依赖还在装"，进度条本身由 _NOISE_RE 过滤。
        [sys.executable, "-m", "pip", "install", "-U", "--progress-bar", "off", *PIP_INSTALL],
        "[pip]",
    )
    if code != 0:
        raise LoadError(f"pip install 失败（退出码 {code}），请查看 /logs 的 [pip] 行")


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

    _prefetch_weights(base, allow_patterns)

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
        pipe = _from_pretrained(AutoPipelineForText2Image, base, kwargs, loader)
        pipe = pipe.to("cuda")
        return pipe, f"sdxl:{base}"

    if loader == "sdxl-lora":
        lora = pipeline_spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if not lora_repo or not lora_weight:
            raise RequestError("sdxl-lora 需要 lora.repo 与 lora.weight")

        pipe = _from_pretrained(StableDiffusionXLPipeline, base, kwargs, loader)

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

        # 与 bench/lightning/run.py 一致的 LoRA 加载方式：先按文件名下载，再按 repo+weight_name 载入。
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
        pipe = _from_pretrained(AutoPipelineForText2Image, base, kwargs, loader)
        return pipe, f"flux2:{base}"

    # 到这里说明 validate 漏了分支，按请求错误处理。
    raise RequestError(f"未知 loader：{loader}")


def release_pipeline() -> None:
    pipe = STATE.get("pipe")
    STATE["pipe"] = None
    STATE["pipeline_key"] = None
    STATE["loaded"] = []
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
    if STATE["pipe"] is not None and STATE["pipeline_key"] == key:
        return STATE["pipe"], 0.0

    if STATE["pipe"] is not None:
        log("[load] 请求的 pipeline 与已加载的不一致，先卸载旧模型")
        release_pipeline()

    previous_phase = "ready" if STATE["phase"] == "ready" else STATE["phase"]
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
    STATE["pipe"] = pipe
    STATE["pipeline_key"] = key
    STATE["model_id"] = str(pipeline_spec.get("base"))
    STATE["loaded"] = [identity]
    try:
        STATE["sig_params"] = set(inspect.signature(pipe.__call__).parameters.keys())
    except Exception:
        STATE["sig_params"] = set()
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
    if len(tasks_raw) > 8:
        raise RequestError("单次请求最多 8 个任务")

    model_id = spec.get("modelId") or spec.get("model_id") or base
    tasks: list[dict] = []
    for index, raw in enumerate(tasks_raw):
        if not isinstance(raw, dict):
            raise RequestError(f"tasks[{index}] 必须是对象")
        prompt = raw.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise RequestError(f"tasks[{index}].prompt 必填")
        width = _int_param(raw.get("width", 1024), f"tasks[{index}].width", 64, 2048)
        height = _int_param(raw.get("height", 1024), f"tasks[{index}].height", 64, 2048)
        steps = _int_param(raw.get("steps", 4), f"tasks[{index}].steps", 1, 80)
        try:
            cfg = float(raw.get("cfg", 0.0))
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].cfg 必须是数字") from None
        if cfg < 0 or cfg > 30:
            raise RequestError(f"tasks[{index}].cfg 必须在 0..30 之间")
        try:
            seed = int(raw.get("seed", -1))
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].seed 必须是整数") from None
        if seed < 0:
            seed = random.randint(0, 2**31 - 1)
        tasks.append(
            {
                "name": str(raw.get("name") or f"{index + 1:02d}"),
                "prompt": prompt.strip(),
                "negative_prompt": str(raw.get("negative_prompt") or "").strip(),
                "seed": seed,
                "width": width - width % 8,
                "height": height - height % 8,
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

    sig = STATE["sig_params"]
    generator_device = "cuda" if torch.cuda.is_available() else "cpu"
    results: list[dict] = []
    for task in tasks:
        STATE["last_active"] = time.time()
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
        "status": "error" if STATE["phase"] == "error" else "ok",
        "phase": STATE["phase"],
        "version": VERSION,
        "model_id": STATE["model_id"],
        "loaded": list(STATE["loaded"]),
        "device": STATE["device"],
        "device_count": STATE["device_count"],
        "idle_seconds": round(time.time() - STATE["last_active"], 1),
        "idle_timeout_sec": STATE["idle_timeout_sec"],
        "jobs_done": STATE["jobs_done"],
        "queue_depth": STATE["waiting"],
        "last_error": STATE["last_error"],
        "last_error_code": STATE["last_error_code"],
        "detail": STATE["detail"],
        "uptime_seconds": round(time.time() - STATE["started_at"], 1),
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
        expected = STATE["auth_token"]
        if not expected:
            return True
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
            log("[shutdown] 收到 /shutdown，0.3s 后退出进程")
            STATE["shutting_down"] = True
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
        phase = STATE["phase"]
        if phase != "ready":
            if phase == "error":
                message = STATE["last_error"] or "Daemon 启动失败"
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
        STATE["waiting"] += 1
        got_lock = STATE["gen_lock"].acquire()
        STATE["waiting"] = max(0, STATE["waiting"] - 1)
        if not got_lock:  # pragma: no cover - Lock.acquire() 不会返回 False
            self._send_error(503, "generation_failed", "生成锁获取失败")
            return

        try:
            started = time.time()
            pipe, load_seconds = ensure_pipeline(pipeline_spec)
            results = run_tasks(pipe, tasks)
            STATE["jobs_done"] += len(results)
            STATE["last_active"] = time.time()
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
            STATE["gen_lock"].release()
            STATE["last_active"] = time.time()


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
# Cloudflare 隧道
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


def _drain_cloudflared(proc: subprocess.Popen, url_event: threading.Event) -> None:
    """持续读取 stderr，直到进程退出。

    这一步是硬要求：拿到 URL 后如果不再读，管道缓冲区写满会阻塞 cloudflared 自身，
    隧道随后表现为"能拿到域名但连不上"。
    """
    found_url: str | None = None
    assert proc.stderr is not None
    try:
        for raw_line in proc.stderr:
            line = raw_line.rstrip()
            if not line:
                continue
            log(f"[cloudflared] {line}")
            if found_url is None:
                match = CLOUDFLARED_URL_RE.search(line)
                if match:
                    found_url = match.group(0)
                    BOOT["tunnel_url"] = found_url
                    url_event.set()
    except Exception as exc:
        log(f"[tunnel] 读取 cloudflared stderr 出错：{short(exc)}")
    finally:
        code = proc.poll()
        log(f"[tunnel] cloudflared stderr 结束（退出码 {code}，URL={found_url}）")
        if found_url is None:
            BOOT["tunnel_error"] = f"cloudflared 未给出 trycloudflare 地址（退出码 {code}）"
            url_event.set()


def tunnel_boot(port: int) -> None:
    try:
        binary = ensure_cloudflared()
    except Exception as exc:
        message = f"cloudflared 下载失败：{short(exc)}"
        BOOT["tunnel_error"] = message
        record_error("tunnel_failed", message)
        set_phase("error", message)
        publish_error("tunnel_failed", message)
        return

    log(f"[tunnel] 启动 cloudflared tunnel --url http://127.0.0.1:{port}")
    try:
        proc = subprocess.Popen(
            [binary, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        message = f"cloudflared 启动失败：{short(exc)}"
        BOOT["tunnel_error"] = message
        record_error("tunnel_failed", message)
        set_phase("error", message)
        publish_error("tunnel_failed", message)
        return

    BOOT["cloudflared"] = proc
    url_event = threading.Event()
    threading.Thread(
        target=_drain_cloudflared,
        args=(proc, url_event),
        name="cloudflared-drain",
        daemon=True,
    ).start()

    if url_event.wait(TUNNEL_WAIT_SEC) and BOOT["tunnel_url"]:
        log(f"[tunnel] 隧道就绪：{BOOT['tunnel_url']}")
        return

    message = BOOT["tunnel_error"] or f"cloudflared 在 {int(TUNNEL_WAIT_SEC)}s 内没有给出隧道地址"
    BOOT["tunnel_error"] = message
    record_error("tunnel_failed", message)
    set_phase("error", message)
    publish_error("tunnel_failed", message)


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
            STATE["device"] = torch.cuda.get_device_name(0)
            STATE["device_count"] = torch.cuda.device_count()
            log(f"[cuda] {STATE['device']} × {STATE['device_count']}，torch={torch.__version__}，cuda={torch.version.cuda}")
        else:
            STATE["device"] = None
            STATE["device_count"] = 0
    except Exception as exc:
        log(f"[cuda] 导入 torch 失败：{short(exc)}")

    if not STATE["device_count"]:
        message = (
            "未检测到可用 GPU（torch.cuda.is_available() 为 False）。"
            "Kaggle 静默降级到 CPU 时请检查设置里的手机号验证。"
        )
        record_error("load_failed", message)
        set_phase("error", message)
        publish_error("load_failed", message)
        return

    try:
        install_dependencies()
    except Exception as exc:
        message = short(exc)
        record_error("load_failed", message)
        set_phase("error", message)
        publish_error("load_failed", message)
        return

    preload = STATE["preload"]
    if preload:
        try:
            ensure_pipeline(preload)
        except Exception as exc:
            code, message = classify_failure(exc, default="load_failed")
            record_error(code, message)
            set_phase("error", message)
            publish_error(code, message)
            return

    if STATE["phase"] != "ready":
        set_phase("ready", "依赖已就绪，等待首个生成请求下发 pipeline")
    log("[boot] 运行时就绪，可以接单")


def _install_signal_handlers() -> None:
    try:
        import signal

        def _bye(signum, _frame):  # noqa: ANN001
            log(f"[signal] 收到信号 {signum}，退出进程")
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
    STATE["started_at"] = time.time()
    STATE["last_active"] = STATE["started_at"]

    log("=" * 72)
    log(f"imagen 远端 Daemon v{VERSION} 启动")
    try:
        cfg = load_config()
    except SystemExit as exc:
        log(f"[config] {exc}")
        os._exit(2)
        return
    apply_config(cfg)
    _log_environment()

    # 1) HTTP 先起来：Host 靠 /health 判断 phase，不依赖模型是否加载完。
    try:
        start_http_server(STATE["port"])
    except Exception as exc:
        log(f"[http] 端口 {STATE['port']} 监听失败：{short(exc)}")
        os._exit(3)
        return

    # 2) 隧道与运行时各自后台跑，互不阻塞。
    threading.Thread(target=tunnel_boot, args=(STATE["port"],), name="tunnel-boot", daemon=True).start()
    threading.Thread(target=runtime_boot, name="runtime-boot", daemon=True).start()

    # 3) 主线程：会合点发布 + 空闲看门狗。
    #    只要隧道地址到手就发布 ready，让 Host 立刻能建立 /health 心跳并从 phase
    #    看到 installing / loading 的进度；模型是否加载完由 /health 回答，不靠会合点。
    #    published_ready 保证只发一次；model_id / device 在此刻可能还是 null。
    last_report = 0.0
    while True:
        time.sleep(2.0)
        now = time.time()

        if BOOT["tunnel_url"] and not BOOT["published_ready"]:
            BOOT["published_ready"] = True
            publish_ready()

        idle = now - STATE["last_active"]
        busy = STATE["waiting"] > 0 or STATE["gen_lock"].locked()
        # 启动阶段（装依赖/预加载）不参与空闲退出：Host 可能把 idle_timeout 调得很短，
        # 但首轮加载本来就要几分钟。失败进入 error 后照样会被看门狗收走。
        bootstrapping = STATE["phase"] in ("booting", "installing", "loading")
        if not busy and not bootstrapping and idle >= STATE["idle_timeout_sec"]:
            log(f"[idle] 空闲 {int(idle)}s ≥ {STATE['idle_timeout_sec']}s，退出进程释放 GPU 配额")
            os._exit(0)

        if now - last_report >= 30:
            last_report = now
            log(
                f"[alive] phase={STATE['phase']} idle={int(idle)}s jobs={STATE['jobs_done']} "
                f"queue={STATE['waiting']} tunnel={'ok' if BOOT['tunnel_url'] else 'pending'}"
            )


if __name__ == "__main__":
    main()
