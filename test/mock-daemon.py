#!/usr/bin/env python3
"""Host 端到端测试用的假 Daemon（不依赖 torch / diffusers / GPU）。

用途：Host 侧（index.js + lib/**）在没排到 Kaggle GPU 的时候也能跑通
「探测 /health → 拉 /logs → POST /generate → 落盘 PNG → POST /shutdown」全链路。

协议与 ``remote/daemon.py``（docs/SPEC.md）保持一致：
  GET  /health              phase 报告 booting/installing/loading/ready/error，
                            并带 tunnel_provider / tunnel_state / tunnel_restarts
  GET  /logs?since=N        {lines, next}，环形缓冲最多 400 行
  POST /generate            {status:"accepted", job_id, model_id, created_at}（202，入队即返回）
  GET  /job?id=<job_id>     {status:queued|running|done|failed, progress, results|error, ...}
  POST /shutdown            {"status": "shutting_down"} 后退出

0.5.0 起 /generate 是异步的：提交只做校验+入队，202 返回；后台 worker 线程串行执行，
Host 用 GET /job 轮询。这样同步长请求不会再被代理/隧道当成「响应空闲」掐断。

契约：启动时加载 ``remote/contract.json``（由 ``node tools/gen-contract-json.mjs`` 从
shared/contract.js 生成），参数边界与 daemon 注入的 ``config.contract`` 同源；文件缺失或损坏
时退回内置旧边界并 WARN。HTTP 路由是 daemon 协议的一部分，由本文件的 ROUTE_PATHS 固定。
越界请求返回 400 ``{"error": {"code": "invalid_request", ...}}``，
不再静默钳制（P9 起 daemon 已改为严格校验）。

失败注入分支（供 Host 的错误分支回归使用）：
  --phase installing|loading|error   /generate 返回 503（warming / load_failed）
  --fail oom|load_failed|...         固定错误码（提交时同步报错，旧错误分类分支）
  --fail-generate 400|500            固定 HTTP 状态码的错误响应（提交时同步报错）
  --fail-job oom|load_failed|...     入队成功、worker 执行时让 job 变成 failed

图片编码优先用 Pillow；没装 Pillow 时退回内置的最小 PNG 编码（zlib + CRC32），
保证任何环境都能返回合法 PNG。

示例：
  python test/mock-daemon.py --port 17860 --token test-token
  python test/mock-daemon.py --port 17860 --token test-token --delay 1.5
  python test/mock-daemon.py --port 17860 --token test-token --fail oom
  python test/mock-daemon.py --port 17860 --token test-token --fail-job oom
  python test/mock-daemon.py --port 17860 --token test-token --warm-seconds 20
  python test/mock-daemon.py --port 17860 --token test-token --phase error
  python test/mock-daemon.py --port 17860 --token test-token --fail-generate 500
"""

from __future__ import annotations

import argparse
import base64
import hmac
import io
import json
import os
import re
import struct
import sys
import threading
import time
import urllib.parse
import zlib
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:  # Pillow 可选：仅用于画出更像样的测试图
    from PIL import Image, ImageDraw

    _HAS_PILLOW = True
except Exception:  # pragma: no cover - 只在极简环境触发
    Image = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]
    _HAS_PILLOW = False

VERSION = "0.6.0-mock"
LOG_MAX_LINES = 400
SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2", "anima")
FAIL_CHOICES = ("none", "oom", "load_failed", "invalid_request", "generation_failed")
FAIL_GENERATE_CHOICES = ("none", "400", "500")
# --fail-job：入队成功、worker 执行阶段失败（用于 Host 的 job 失败分支回归）。
FAIL_JOB_CHOICES = ("none", "oom", "load_failed", "generation_failed")
# --phase 取值域：auto = 按 --warm-seconds 推导；其余与 remote/daemon.py 的 /health.phase 一致。
PHASE_CHOICES = ("auto", "ready", "installing", "loading", "error")

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "remote" / "contract.json"

# 契约文件缺失/损坏时的兜底：故意与 remote/daemon.py 的 _FALLBACK_LIMITS 保持一致（旧边界），
# 保证"没有 contract.json"时 mock 与 daemon 的退化行为相同。
FALLBACK_CONTRACT = {
    "version": "0.4.1",
    "limits": {
        "width": {"max": 2048, "min": 64, "step": 8},
        "height": {"max": 2048, "min": 64, "step": 8},
        "steps": {"max": 80, "min": 1},
        "cfg": {"max": 30, "min": 0},
        "count": {"max": 8, "min": 1},
        "seed": {"max": 2**31 - 1},
        "prompt": {"maxChars": 2000},
    },
}

CONTRACT: dict = {}
# HTTP 路由路径是 daemon 协议的一部分（与 remote/daemon.py 一致），不从契约文件读取。
ROUTE_PATHS = {
    "health": "/health",
    "logs": "/logs",
    "generate": "/generate",
    "job": "/job",
    "shutdown": "/shutdown",
}

_START_TS = time.time()
_ARGS: argparse.Namespace  # 在 main() 里赋值

_LOG_LOCK = threading.Lock()
_LOG_LINES: deque[str] = deque(maxlen=LOG_MAX_LINES)
_LOG_SEQ = 0


# ─────────────────────────────────────────────────────────────────────────────
# 日志环（语义与 remote/daemon.py 相同）
# ─────────────────────────────────────────────────────────────────────────────


def log(*parts) -> None:
    global _LOG_SEQ
    text = " ".join(str(p) for p in parts)
    for piece in text.replace("\r", "\n").split("\n"):
        piece = piece.strip()
        if not piece:
            continue
        line = f"[{time.time() - _START_TS:7.1f}s] {piece}"
        with _LOG_LOCK:
            _LOG_LINES.append(line[:2000])
            _LOG_SEQ += 1
        print(line, flush=True)


def log_since(since: int) -> tuple[list[str], int]:
    with _LOG_LOCK:
        total = _LOG_SEQ
        snapshot = list(_LOG_LINES)
    if not snapshot:
        return [], total
    first_seq = total - len(snapshot) + 1
    lines = [line for offset, line in enumerate(snapshot) if first_seq + offset > since]
    return lines, total


# ─────────────────────────────────────────────────────────────────────────────
# 契约（remote/contract.json，与 daemon 注入的 config.contract 同源）
# ─────────────────────────────────────────────────────────────────────────────


def load_contract() -> dict:
    """加载远端契约 JSON；缺失/损坏时回退内置兜底并 WARN，不让 mock 起不来。"""
    global CONTRACT
    try:
        data = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        CONTRACT = json.loads(json.dumps(FALLBACK_CONTRACT))
        log(f"[mock] WARN 未找到 {CONTRACT_PATH}，回退内置契约（旧边界）")
    except Exception as exc:  # noqa: BLE001 - 契约坏掉也要能起 mock
        CONTRACT = json.loads(json.dumps(FALLBACK_CONTRACT))
        log(f"[mock] WARN 契约解析失败（{type(exc).__name__}: {exc}），回退内置契约")
    else:
        if isinstance(data, dict):
            CONTRACT = data
        else:
            CONTRACT = json.loads(json.dumps(FALLBACK_CONTRACT))
            log("[mock] WARN 契约不是 JSON 对象，回退内置契约")
    log(
        f"[mock] 契约 version={CONTRACT.get('version')} "
        f"limits={','.join(sorted((CONTRACT.get('limits') or {}).keys())) or 'none'}"
    )
    return CONTRACT


def _limit(name: str) -> dict:
    """取参数边界：优先契约 limits，缺失项用内置兜底（合并口径与 daemon 的 _limit_spec 一致）。"""
    fallback = dict(FALLBACK_CONTRACT["limits"][name])
    limits = CONTRACT.get("limits") if isinstance(CONTRACT, dict) else None
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
    fallback = int(FALLBACK_CONTRACT["limits"]["count"]["max"])
    try:
        value = int(_limit("count").get("max"))
    except (TypeError, ValueError):
        return fallback
    return value if value > 0 else fallback


# ─────────────────────────────────────────────────────────────────────────────
# PNG 编码
# ─────────────────────────────────────────────────────────────────────────────


def _clamp8(value: int) -> int:
    return 0 if value < 0 else (255 if value > 255 else value)


def _seed_color(seed: int) -> tuple[int, int, int]:
    value = abs(int(seed))
    return (
        40 + (value * 37) % 180,
        40 + (value * 91) % 180,
        40 + (value * 53) % 180,
    )


def _png_chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def _encode_png_rgb(width: int, height: int, rows) -> bytes:  # noqa: ANN001
    """把逐行 RGB 字节拼成 PNG（truecolor 8bit，无滤波）。"""
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0
        raw.extend(row)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _png_chunk(b"IEND", b"")
    )


def _render_fallback(width: int, height: int, seed: int) -> bytes:
    """不依赖 Pillow 的最小渲染：竖向渐变 + 中央棋盘条，尺寸与请求一致。"""
    red, green, blue = _seed_color(seed)
    stripe_half = max(4, width // 16)
    x0 = max(0, width // 2 - stripe_half)
    x1 = min(width, width // 2 + stripe_half)
    stripe = b"\xff\xff\xff" * (x1 - x0)
    block = max(1, height // 32)

    rows = []
    for y in range(height):
        ratio = y / max(1, height - 1)
        pixel = bytes(
            (
                _clamp8(int(red * (0.35 + 0.65 * ratio))),
                _clamp8(int(green * (0.35 + 0.65 * ratio))),
                _clamp8(int(blue * (0.35 + 0.65 * ratio))),
            )
        )
        row = bytearray(pixel * width)
        if (y // block) % 2 == 0:
            row[3 * x0 : 3 * x1] = stripe
        rows.append(bytes(row))
    return _encode_png_rgb(width, height, rows)


def _render_pillow(width: int, height: int, seed: int) -> bytes:
    red, green, blue = _seed_color(seed)
    image = Image.new("RGB", (width, height), (red // 4, green // 4, blue // 4))
    draw = ImageDraw.Draw(image)

    bands = 24
    band_h = max(1, height // bands)
    for index in range(bands):
        top = index * band_h
        if top >= height:
            break
        color = (
            _clamp8(red + index * 4),
            _clamp8(green + index * 3),
            _clamp8(blue + index * 2),
        )
        draw.rectangle([0, top, width, min(height - 1, top + band_h - 1)], fill=color)

    size = max(16, min(width, height) // 5)
    offset = (abs(int(seed)) % 17 - 8) * max(1, width // 64)
    cx = min(width - size - 1, max(size + 1, width // 2 + offset))
    cy = max(size + 1, height // 2)
    draw.rectangle(
        [cx - size, cy - size, cx + size, cy + size],
        outline=(255, 255, 255),
        width=max(2, size // 16),
    )
    try:
        draw.text((6, 6), f"mock seed {seed} {width}x{height}", fill=(255, 255, 255))
    except Exception:
        pass

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_png(width: int, height: int, seed: int) -> bytes:
    if _HAS_PILLOW:
        try:
            return _render_pillow(width, height, seed)
        except Exception as exc:  # Pillow 万一不可用就退回内置编码
            log(f"[mock] Pillow 渲染失败，改用内置 PNG 编码：{type(exc).__name__}: {exc}")
    return _render_fallback(width, height, seed)


# ─────────────────────────────────────────────────────────────────────────────
# 状态与配置
# ─────────────────────────────────────────────────────────────────────────────


def _phase() -> str:
    """当前 phase：--phase 显式指定优先；auto 时按 --warm-seconds 模拟 loading。"""
    configured = str(getattr(_ARGS, "phase", "auto") or "auto")
    if configured != "auto":
        return configured
    warm = float(_ARGS.warm_seconds or 0.0)
    if warm > 0 and (time.time() - _START_TS) < warm:
        return "loading"
    return "ready"


def health_payload(extra: dict | None = None) -> dict:
    phase = _phase()
    payload = {
        "status": "error" if phase == "error" else "ok",
        "phase": phase,
        "version": VERSION,
        "model_id": "mock/mock-model",
        "loaded": ["mock:mock-model"],
        "device": "Mock GPU",
        "device_count": 1,
        "idle_seconds": round(time.time() - _LAST_ACTIVE, 1),
        "idle_timeout_sec": int(_ARGS.idle_timeout),
        "jobs_done": _JOBS_DONE["count"],
        "queue_depth": queue_depth(),
        "last_error": _LAST_ERROR["value"],
        "last_error_code": _LAST_ERROR["code"],
        "detail": (extra.get("detail") if extra else None)
        or (_LAST_ERROR["value"] if phase == "error" else None),
        "uptime_seconds": round(time.time() - _START_TS, 1),
        # P0.2 / P2.2：与真实 daemon 的 /health 新字段对齐（mock 常驻一条 cloudflare 通道）。
        "tunnel_provider": "cloudflare",
        "tunnel_state": "up",
        "tunnel_restarts": 0,
        "mock": True,
    }
    return payload


_LAST_ACTIVE = time.time()
_JOBS_DONE = {"count": 0}
# 与真实 daemon 契约一致：last_error 是字符串（Host 直接拼进 UI）
_LAST_ERROR = {"value": None, "code": None}
_AUTH_TOKEN = ""
_GEN_LOCK = threading.Lock()

# ── 异步 job（0.5.0）：与 remote/daemon.py 同名同形，语义一致 ────────────────
JOB_MAX_FINISHED = 8
JOB_TTL_SEC = 600.0
JOB_ID_MAX_CHARS = 64
JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_JOB_LOCK = threading.RLock()
_JOB_QUEUE: deque = deque()
_JOB_TABLE: dict[str, dict] = {}
_JOB_FINISHED: deque = deque()
_JOB_WAKE = threading.Event()


def iso_time(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def new_job_id() -> str:
    return f"job-{int(time.time() * 1000):x}-{os.urandom(4).hex()}"


def normalize_job_id(value):  # noqa: ANN001, ANN201
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("jobId 必须是字符串")
    text = value.strip()
    if not text:
        return None
    if len(text) > JOB_ID_MAX_CHARS or not JOB_ID_RE.match(text):
        raise ValueError("jobId 只能是 1~64 位的字母、数字、点、下划线或短横线")
    return text


def prune_jobs(now: float | None = None) -> None:
    current = time.time() if now is None else now
    while _JOB_FINISHED:
        job_id = _JOB_FINISHED[0]
        job = _JOB_TABLE.get(job_id)
        if job is None:
            _JOB_FINISHED.popleft()
            continue
        finished_at = job.get("finished_at")
        expired = finished_at is not None and current - finished_at >= JOB_TTL_SEC
        overflow = len(_JOB_FINISHED) > JOB_MAX_FINISHED
        if not expired and not overflow:
            break
        _JOB_FINISHED.popleft()
        _JOB_TABLE.pop(job_id, None)


def submit_job(pipeline: dict, model_id: str, tasks: list[dict], job_id=None):  # noqa: ANN001, ANN201
    with _JOB_LOCK:
        prune_jobs()
        if job_id:
            existing = _JOB_TABLE.get(job_id)
            if existing is not None:
                return existing, False
        job = {
            "job_id": job_id or new_job_id(),
            "model_id": str(model_id),
            "pipeline": dict(pipeline),
            "tasks": list(tasks),
            "status": "queued",
            "results": [],
            "error": None,
            "load_seconds": None,
            "created_at": time.time(),
            "updated_at": time.time(),
            "finished_at": None,
        }
        _JOB_TABLE[job["job_id"]] = job
        _JOB_QUEUE.append(job)
        queue_len = len(_JOB_QUEUE)
        _JOB_WAKE.set()
        log(f"[job] 入队 {job['job_id']}（tasks={len(job['tasks'])}，排队 {queue_len}）")
        return job, True


def get_job(job_id: str):  # noqa: ANN201
    with _JOB_LOCK:
        prune_jobs()
        return _JOB_TABLE.get(job_id)


def queue_depth() -> int:
    with _JOB_LOCK:
        return len(_JOB_QUEUE)


def job_payload(job: dict) -> dict:
    with _JOB_LOCK:
        return {
            "status": job["status"],
            "job_id": job["job_id"],
            "model_id": job["model_id"],
            "progress": {"done": len(job["results"]), "total": len(job["tasks"])},
            "created_at": iso_time(job["created_at"]),
            "updated_at": iso_time(job["updated_at"]),
            "load_seconds": job.get("load_seconds"),
            "results": list(job["results"]) if job["status"] == "done" else None,
            "error": dict(job["error"]) if job.get("error") else None,
        }


def _finish_job(job: dict, status: str, error: dict | None = None) -> None:
    now = time.time()
    with _JOB_LOCK:
        job["status"] = status
        job["error"] = error
        job["updated_at"] = now
        job["finished_at"] = now
        _JOB_FINISHED.append(job["job_id"])
        prune_jobs(now)


def _execute_job(job: dict) -> None:
    """mock 的 job 执行：按 --delay / --fail-job 模拟出图与失败。"""
    global _LAST_ACTIVE
    job["status"] = "running"
    job["updated_at"] = time.time()
    _LAST_ACTIVE = time.time()
    fail_job = str(getattr(_ARGS, "fail_job", "none") or "none")
    try:
        if fail_job != "none":
            raise RuntimeError(f"mock 按 --fail-job 注入的错误：{fail_job}")
        with _GEN_LOCK:
            results = []
            for task in job["tasks"]:
                delay = max(0.0, float(_ARGS.delay or 0.0))
                if delay:
                    time.sleep(delay)
                png = render_png(task["width"], task["height"], task["seed"])
                results.append(
                    {
                        "name": task["name"],
                        "seed": task["seed"],
                        "seconds": round(max(delay, 0.001), 2),
                        "width": task["width"],
                        "height": task["height"],
                        "steps": task["steps"],
                        "cfg": task["cfg"],
                        "png_bytes": len(png),
                        "image_b64": base64.b64encode(png).decode("ascii"),
                    }
                )
                log(
                    f"[mock] 生成 {task['name']} seed={task['seed']} "
                    f"{task['width']}x{task['height']} {len(png)} 字节"
                )
                with _JOB_LOCK:
                    job["results"] = list(results)
                    job["updated_at"] = time.time()
                _LAST_ACTIVE = time.time()
        _JOBS_DONE["count"] += len(results)
        with _JOB_LOCK:
            job["results"] = list(results)
            job["load_seconds"] = 0.05
        _finish_job(job, "done")
        log(f"[job] {job['job_id']} 完成 {len(results)} 张")
    except Exception as exc:  # noqa: BLE001 - mock 不区分错误类型，按注入值上报
        code = fail_job if fail_job != "none" else "generation_failed"
        message = str(exc)
        _LAST_ERROR["value"] = f"{code}: {message}"
        _LAST_ERROR["code"] = code
        _finish_job(job, "failed", {"code": code, "message": message})
        log(f"[job] {job['job_id']} 失败（{code}）：{message}")


def _job_worker_loop() -> None:
    log("[job] mock worker 启动，等待队列")
    while True:
        with _JOB_LOCK:
            job = _JOB_QUEUE.popleft() if _JOB_QUEUE else None
        if job is None:
            _JOB_WAKE.wait(timeout=0.5)
            _JOB_WAKE.clear()
            continue
        _execute_job(job)


def _int_param(value, field: str, low: int, high: int) -> int:  # noqa: ANN001
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} 必须是整数") from None
    if number < low or number > high:
        raise ValueError(f"{field} 必须在 {low}..{high} 之间，收到 {number}")
    return number


def validate_spec(spec) -> tuple[dict, str, list[dict]]:  # noqa: ANN001
    """与 remote/daemon.py 相同的校验口径（边界来自 contract.limits），越界返回 400。"""
    if not isinstance(spec, dict):
        raise ValueError("请求体必须是 JSON 对象")
    pipeline = spec.get("pipeline")
    if not isinstance(pipeline, dict):
        raise ValueError("缺少 pipeline 对象")
    loader = str(pipeline.get("loader") or "").strip()
    if loader not in SUPPORTED_LOADERS:
        raise ValueError(f"未知 loader：{loader!r}（支持 {', '.join(SUPPORTED_LOADERS)}）")
    base = pipeline.get("base")
    if not isinstance(base, str) or not base.strip():
        raise ValueError("pipeline.base 必须是非空字符串")
    tasks_raw = spec.get("tasks")
    if not isinstance(tasks_raw, list) or not tasks_raw:
        raise ValueError("tasks 必须是非空数组")
    max_tasks = _max_tasks()
    if len(tasks_raw) > max_tasks:
        raise ValueError(f"单次请求最多 {max_tasks} 个任务")

    width_limit = _limit("width")
    height_limit = _limit("height")
    steps_limit = _limit("steps")
    cfg_limit = _limit("cfg")
    seed_limit = _limit("seed")
    prompt_max = int(_limit("prompt").get("maxChars") or 0)
    width_min, width_max = int(width_limit["min"]), int(width_limit["max"])
    height_min, height_max = int(height_limit["min"]), int(height_limit["max"])
    width_step = int(width_limit.get("step") or 8)
    height_step = int(height_limit.get("step") or 8)
    steps_min, steps_max = int(steps_limit["min"]), int(steps_limit["max"])
    cfg_min, cfg_max = cfg_limit["min"], cfg_limit["max"]
    seed_max = int(seed_limit.get("max") or 2**31 - 1)

    model_id = spec.get("modelId") or spec.get("model_id") or base
    tasks = []
    for index, raw in enumerate(tasks_raw):
        if not isinstance(raw, dict):
            raise ValueError(f"tasks[{index}] 必须是对象")
        prompt = raw.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"tasks[{index}].prompt 必填")
        prompt = prompt.strip()
        if prompt_max > 0 and len(prompt) > prompt_max:
            raise ValueError(f"tasks[{index}].prompt 最长 {prompt_max} 个字符")
        width = _int_param(raw.get("width", 1024), f"tasks[{index}].width", width_min, width_max)
        height = _int_param(raw.get("height", 1024), f"tasks[{index}].height", height_min, height_max)
        steps = _int_param(raw.get("steps", 4), f"tasks[{index}].steps", steps_min, steps_max)
        try:
            cfg = float(raw.get("cfg", 0.0))
        except (TypeError, ValueError):
            raise ValueError(f"tasks[{index}].cfg 必须是数字") from None
        if cfg < cfg_min or cfg > cfg_max:
            raise ValueError(f"tasks[{index}].cfg 必须在 {cfg_min}..{cfg_max} 之间")
        try:
            seed = int(raw.get("seed", -1))
        except (TypeError, ValueError):
            raise ValueError(f"tasks[{index}].seed 必须是整数") from None
        if seed < 0:
            seed = int(time.time() * 1000) % seed_max
        elif seed > seed_max:
            raise ValueError(f"tasks[{index}].seed 必须不超过 {seed_max}")
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
    return pipeline, str(model_id), tasks


# ─────────────────────────────────────────────────────────────────────────────
# HTTP
# ─────────────────────────────────────────────────────────────────────────────


class MockHandler(BaseHTTPRequestHandler):
    server_version = f"imagen-mock/{VERSION}"
    sys_version = ""

    def log_message(self, fmt, *args):  # noqa: ANN001
        # 请求日志走日志环，Host 的 /logs 分页测试才有稳定的新行可拉。
        pass

    def _send_json(self, code: int, payload: dict, headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _send_error(self, code: int, error_code: str, message: str, headers: dict | None = None) -> None:
        self._send_json(code, {"error": {"code": error_code, "message": message}}, headers)

    def _require_auth(self) -> bool:
        if not _AUTH_TOKEN:
            return True
        header = self.headers.get("Authorization", "") or ""
        if header.startswith("Bearer ") and hmac.compare_digest(
            header[len("Bearer ") :].strip(), _AUTH_TOKEN
        ):
            return True
        log(f"[http] 401 {self.command} {self.path}")
        self._send_error(401, "unauthorized", "缺少或错误的 Bearer Token")
        return False

    def _read_json(self):  # noqa: ANN202
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"请求体不是合法 JSON：{type(exc).__name__}") from None

    def do_GET(self):  # noqa: N802
        if not self._require_auth():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"
        query = urllib.parse.parse_qs(parts.query)

        if path == ROUTE_PATHS.get("health", "/health"):
            # 与真实 daemon 一致：/health 轮询不写日志环，否则会把 /logs 分页搅乱。
            self._send_json(200, health_payload())
            return

        if path == ROUTE_PATHS.get("logs", "/logs"):
            try:
                since = int((query.get("since") or ["0"])[0])
            except (TypeError, ValueError):
                since = 0
            lines, nxt = log_since(since)
            self._send_json(200, {"lines": lines, "next": nxt})
            return

        if path == ROUTE_PATHS.get("job", "/job"):
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

        if path == ROUTE_PATHS.get("shutdown", "/shutdown"):
            log("[http] 200 POST /shutdown（0.3s 后退出）")
            self._send_json(200, {"status": "shutting_down"})
            threading.Thread(target=self._delayed_exit, daemon=True).start()
            return

        if path == ROUTE_PATHS.get("generate", "/generate"):
            self._handle_generate()
            return

        self._send_error(404, "not_found", f"未知路径：{path}")

    @staticmethod
    def _delayed_exit() -> None:
        time.sleep(0.3)
        os._exit(0)

    def _handle_generate(self) -> None:
        phase = _phase()
        if phase != "ready":
            if phase == "error":
                # 与 daemon 一致：启动失败时 /generate 返回 503 + load_failed（错误详情可读）。
                message = _LAST_ERROR["value"] or "mock 启动失败"
                log("[http] 503 /generate（phase=error）")
                self._send_error(503, "load_failed", message)
            else:
                log(f"[http] 503 /generate（phase={phase}）")
                self._send_error(
                    503,
                    "warming",
                    f"mock 尚未就绪（phase={phase}），请稍后重试",
                    {"Retry-After": "5"},
                )
            return

        try:
            spec = self._read_json()
            pipeline, model_id, tasks = validate_spec(spec)
            job_id = normalize_job_id(spec.get("jobId"))
        except ValueError as exc:
            log(f"[http] 400 /generate 校验失败：{exc}")
            self._send_error(400, "invalid_request", str(exc))
            return

        fail_generate = str(getattr(_ARGS, "fail_generate", "none") or "none")
        if fail_generate != "none":
            status = int(fail_generate)
            code = "invalid_request" if status == 400 else "generation_failed"
            message = f"mock 按 --fail-generate {status} 注入的错误：{code}"
            _LAST_ERROR["value"] = f"{code}: {message}"
            _LAST_ERROR["code"] = code
            log(f"[http] {status} /generate 注入错误 {code}（--fail-generate）")
            self._send_error(status, code, message)
            return

        if _ARGS.fail != "none":
            code = str(_ARGS.fail)
            status = 400 if code == "invalid_request" else 500
            message = f"mock 按 --fail 注入的错误：{code}"
            _LAST_ERROR["value"] = f"{code}: {message}"
            _LAST_ERROR["code"] = code
            log(f"[http] {status} /generate 注入错误 {code}")
            self._send_error(status, code, message)
            return

        job, created = submit_job(pipeline, model_id, tasks, job_id)
        if not created:
            log(f"[http] 202 /generate 幂等命中 {job['job_id']}（status={job['status']}）")
        self._send_json(
            202,
            {
                "status": "accepted",
                "job_id": job["job_id"],
                "model_id": job["model_id"],
                "created_at": iso_time(job["created_at"]),
            },
        )


def parse_args(argv=None):  # noqa: ANN001, ANN201
    parser = argparse.ArgumentParser(
        description="Host 端到端测试用的假 Daemon（不依赖 torch）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=7860, help="监听端口")
    parser.add_argument("--token", default="", help="Bearer Token；留空则不校验")
    parser.add_argument("--delay", type=float, default=0.0, help="每张图额外模拟的推理耗时（秒）")
    parser.add_argument(
        "--fail",
        choices=FAIL_CHOICES,
        default="none",
        help="让 /generate 返回指定错误码，用于测试 Host 的错误分支",
    )
    parser.add_argument(
        "--fail-generate",
        choices=FAIL_GENERATE_CHOICES,
        default="none",
        help="让 /generate 返回固定 HTTP 状态码的错误（400 invalid_request / 500 generation_failed）",
    )
    parser.add_argument(
        "--fail-job",
        choices=FAIL_JOB_CHOICES,
        default="none",
        help="入队成功、后台执行阶段让 job 失败（用于 Host 的 job 失败分支回归）",
    )
    parser.add_argument(
        "--phase",
        choices=PHASE_CHOICES,
        default="auto",
        help="固定 /health 的 phase；auto 表示按 --warm-seconds 推导",
    )
    parser.add_argument(
        "--warm-seconds",
        type=float,
        default=0.0,
        help="启动后多少秒内 /health 报 phase=loading（模拟 warming）",
    )
    parser.add_argument("--idle-timeout", type=int, default=1800, help="仅在 /health 里回显的字段")
    return parser.parse_args(argv)


def main(argv=None) -> int:  # noqa: ANN001
    global _ARGS, _AUTH_TOKEN
    _ARGS = parse_args(argv)
    _AUTH_TOKEN = str(_ARGS.token or "")
    load_contract()

    log("=" * 60)
    log(f"imagen mock daemon v{VERSION}（Pillow={'on' if _HAS_PILLOW else 'off'}）")
    log(
        f"host={_ARGS.host} port={_ARGS.port} auth={'on' if _AUTH_TOKEN else 'off'} "
        f"delay={_ARGS.delay}s fail={_ARGS.fail} fail_generate={_ARGS.fail_generate} "
        f"fail_job={_ARGS.fail_job} phase={_ARGS.phase} warm={_ARGS.warm_seconds}s"
    )
    if _ARGS.phase == "error":
        # 模拟 daemon 启动失败：/health status=error，/generate → 503 load_failed。
        _LAST_ERROR["value"] = "load_failed: mock 按 --phase error 注入的启动失败"
        _LAST_ERROR["code"] = "load_failed"
        log("[mock] 模拟启动失败：phase=error，/generate 将返回 503 load_failed")
    if _ARGS.warm_seconds and _ARGS.warm_seconds > 0:
        log(f"[mock] 模拟加载中：{_ARGS.warm_seconds}s 内 /health 报 phase=loading")

    try:
        server = ThreadingHTTPServer((_ARGS.host, _ARGS.port), MockHandler)
    except OSError as exc:
        log(f"[mock] 端口 {_ARGS.port} 监听失败：{exc}")
        return 2
    server.daemon_threads = True
    log(f"[mock] 监听 http://{_ARGS.host}:{_ARGS.port}")
    threading.Thread(target=_job_worker_loop, name="mock-job-worker", daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        log("[mock] 收到 Ctrl-C，退出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
