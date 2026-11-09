#!/usr/bin/env python3
"""Host 端到端测试用的假 Daemon（不依赖 torch / diffusers / GPU）。

用途：Host 侧（index.js + lib/**）在没排到 Kaggle GPU 的时候也能跑通
「探测 /health → 拉 /logs → POST /generate → 落盘 PNG → POST /shutdown」全链路。

协议与 ``remote/daemon.py``（docs/API.md 第 6 节）保持一致：
  GET  /health              phase 报告 booting/installing/loading/ready/error
  GET  /logs?since=N        {lines, next}，环形缓冲最多 400 行
  POST /generate            {status, model_id, load_seconds, results[...]}
  POST /shutdown            {"status": "shutting_down"} 后退出

图片编码优先用 Pillow；没装 Pillow 时退回内置的最小 PNG 编码（zlib + CRC32），
保证任何环境都能返回合法 PNG。

示例：
  python test/mock-daemon.py --port 17860 --token test-token
  python test/mock-daemon.py --port 17860 --token test-token --delay 1.5
  python test/mock-daemon.py --port 17860 --token test-token --fail oom
  python test/mock-daemon.py --port 17860 --token test-token --warm-seconds 20
"""

from __future__ import annotations

import argparse
import base64
import hmac
import io
import json
import os
import struct
import sys
import threading
import time
import urllib.parse
import zlib
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:  # Pillow 可选：仅用于画出更像样的测试图
    from PIL import Image, ImageDraw

    _HAS_PILLOW = True
except Exception:  # pragma: no cover - 只在极简环境触发
    Image = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]
    _HAS_PILLOW = False

VERSION = "0.2.0-mock"
LOG_MAX_LINES = 400
SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2")
FAIL_CHOICES = ("none", "oom", "load_failed", "invalid_request", "generation_failed")

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
    warm = float(_ARGS.warm_seconds or 0.0)
    if warm > 0 and (time.time() - _START_TS) < warm:
        return "loading"
    return "ready"


def health_payload(extra: dict | None = None) -> dict:
    phase = _phase()
    payload = {
        "status": "ok",
        "phase": phase,
        "version": VERSION,
        "model_id": "mock/mock-model",
        "loaded": ["mock:mock-model"],
        "device": "Mock GPU",
        "device_count": 1,
        "idle_seconds": round(time.time() - _LAST_ACTIVE, 1),
        "idle_timeout_sec": int(_ARGS.idle_timeout),
        "jobs_done": _JOBS_DONE["count"],
        "queue_depth": 0,
        "last_error": _LAST_ERROR["value"],
        "last_error_code": _LAST_ERROR["code"],
        "detail": extra.get("detail") if extra else None,
        "uptime_seconds": round(time.time() - _START_TS, 1),
        "mock": True,
    }
    return payload


_LAST_ACTIVE = time.time()
_JOBS_DONE = {"count": 0}
# 与真实 daemon 契约一致：last_error 是字符串（Host 直接拼进 UI）
_LAST_ERROR = {"value": None, "code": None}
_AUTH_TOKEN = ""
_GEN_LOCK = threading.Lock()


def validate_spec(spec) -> tuple[dict, str, list[dict]]:  # noqa: ANN001
    """与 remote/daemon.py 相同的校验口径，让 Host 的错误分支能被真实触发。"""
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

    model_id = spec.get("modelId") or spec.get("model_id") or base
    tasks = []
    for index, raw in enumerate(tasks_raw):
        if not isinstance(raw, dict):
            raise ValueError(f"tasks[{index}] 必须是对象")
        prompt = raw.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"tasks[{index}].prompt 必填")
        width = int(raw.get("width", 512) or 512)
        height = int(raw.get("height", 512) or 512)
        width = min(2048, max(64, width - width % 8))
        height = min(2048, max(64, height - height % 8))
        steps = int(raw.get("steps", 4) or 4)
        cfg = float(raw.get("cfg", 0.0) or 0.0)
        seed = int(raw.get("seed", -1))
        if seed < 0:
            seed = int(time.time() * 1000) % (2**31 - 1)
        tasks.append(
            {
                "name": str(raw.get("name") or f"{index + 1:02d}"),
                "prompt": prompt.strip(),
                "negative_prompt": str(raw.get("negative_prompt") or "").strip(),
                "seed": seed,
                "width": width,
                "height": height,
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

        if path == "/health":
            # 与真实 daemon 一致：/health 轮询不写日志环，否则会把 /logs 分页搅乱。
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
            log("[http] 200 POST /shutdown（0.3s 后退出）")
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
        phase = _phase()
        if phase != "ready":
            log(f"[http] 503 /generate（phase={phase}）")
            self._send_error(
                503,
                "warming",
                f"mock 尚未就绪（phase={phase}），请稍后重试",
                {"Retry-After": "2"},
            )
            return

        try:
            spec = self._read_json()
            _pipeline, model_id, tasks = validate_spec(spec)
        except ValueError as exc:
            log(f"[http] 400 /generate 校验失败：{exc}")
            self._send_error(400, "invalid_request", str(exc))
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

        global _LAST_ACTIVE
        with _GEN_LOCK:
            _LAST_ACTIVE = time.time()
            started = time.time()
            results = []
            for task in tasks:
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
            _JOBS_DONE["count"] += len(results)
            elapsed = round(time.time() - started, 2)
            log(f"[http] 200 /generate tasks={len(results)} 总耗时 {elapsed}s")
            self._send_json(
                200,
                {
                    "status": "ok",
                    "model_id": model_id,
                    "load_seconds": 0.05,
                    "results": results,
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

    log("=" * 60)
    log(f"imagen mock daemon v{VERSION}（Pillow={'on' if _HAS_PILLOW else 'off'}）")
    log(
        f"host={_ARGS.host} port={_ARGS.port} auth={'on' if _AUTH_TOKEN else 'off'} "
        f"delay={_ARGS.delay}s fail={_ARGS.fail} warm={_ARGS.warm_seconds}s"
    )
    if _ARGS.warm_seconds and _ARGS.warm_seconds > 0:
        log(f"[mock] 模拟加载中：{_ARGS.warm_seconds}s 内 /health 报 phase=loading")

    try:
        server = ThreadingHTTPServer((_ARGS.host, _ARGS.port), MockHandler)
    except OSError as exc:
        log(f"[mock] 端口 {_ARGS.port} 监听失败：{exc}")
        return 2
    server.daemon_threads = True
    log(f"[mock] 监听 http://{_ARGS.host}:{_ARGS.port}")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        log("[mock] 收到 Ctrl-C，退出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
