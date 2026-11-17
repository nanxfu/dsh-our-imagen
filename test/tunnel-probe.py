#!/usr/bin/env python3
"""隧道与握手探针（不加载模型、不占 GPU）。

用途：在不消耗 GPU 配额、不下载权重的前提下验证整条调度链路：
    kaggle kernels push → 容器内启动 HTTP → cloudflared 分配域名 → ntfy 上报 → Host 握手

它实现与 remote/daemon.py 相同的接口子集（/health、/logs、/generate、/job、/shutdown），
其中 /generate 异步入队返回 202，后台 worker 产出固定的 1×1 PNG，只用于验证协议形状。

配置注入方式与 daemon.py 一致：Host 会重写脚本里那行以 EMBEDDED_CONFIG_B64 开头的赋值。
"""

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 由 Host 在打包时替换；本地调试可用环境变量 IMAGEN_CONFIG_B64 覆盖
EMBEDDED_CONFIG_B64 = ""

PORT = 7860
VERSION = "0.12.0-probe"
PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_1X1_BYTES = len(base64.b64decode(PNG_1X1))

CLOUDFLARED_PATH = "/tmp/cloudflared"
CLOUDFLARED_VERSION = "2026.11.0"
CLOUDFLARED_DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/download/2026.11.0/cloudflared-linux-amd64"
)
CLOUDFLARED_SHA256 = "51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd"
CLOUDFLARED_MAX_DOWNLOAD_BYTES = 120 * 2**20
CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC = 120
CLOUDFLARED_DOWNLOAD_ATTEMPTS = 2
CLOUDFLARED_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

TUNNEL_WAIT_SEC = 120.0
TUNNEL_RESTART_BASE_SEC = 2.0
TUNNEL_RESTART_MAX_SEC = 60.0

JOB_MAX_FINISHED = 8
JOB_MAX_QUEUE_DEPTH = 16
JOB_TTL_SEC = 600.0
JOB_ID_MAX_CHARS = 64
JOB_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

STATE = {
    "started_at": time.time(),
    "last_active": time.time(),
    "jobs_done": 0,
    "token": "",
    "idle_timeout_sec": 900,
    "phase": "booting",
    "last_error": None,
    "last_error_code": None,
    "tunnel_provider": None,
    "tunnel_state": "down",
    "tunnel_restarts": 0,
    "logs": [],
}

STATE_LOCK = threading.RLock()
LOG_LOCK = threading.Lock()
JOB_LOCK = threading.RLock()
JOB_QUEUE: deque = deque()
JOB_TABLE: dict[str, dict] = {}
JOB_FINISHED: deque = deque()
JOB_WAKE = threading.Event()
STOP_EVENT = threading.Event()
_WORKER_STARTED = False


def log(*args):
    line = " ".join(str(arg) for arg in args)
    print(line, flush=True)
    with LOG_LOCK:
        STATE["logs"].append(line)
        if len(STATE["logs"]) > 400:
            del STATE["logs"][: len(STATE["logs"]) - 400]


def load_config():
    raw = os.environ.get("IMAGEN_CONFIG_B64") or EMBEDDED_CONFIG_B64
    if not raw:
        return {
            "auth_token": os.environ.get("IMAGEN_TOKEN", ""),
            "ntfy_topic": os.environ.get("IMAGEN_TOPIC", ""),
            "idle_timeout_sec": 900,
        }
    return json.loads(base64.b64decode(raw.encode("ascii")).decode("utf-8"))


def iso_time(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def new_job_id() -> str:
    return f"job-{int(time.time() * 1000):x}-{os.urandom(4).hex()}"


def normalize_job_id(value):
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
    while JOB_FINISHED:
        job_id = JOB_FINISHED[0]
        job = JOB_TABLE.get(job_id)
        if job is None:
            JOB_FINISHED.popleft()
            continue
        finished_at = job.get("finished_at")
        expired = finished_at is not None and current - finished_at >= JOB_TTL_SEC
        overflow = len(JOB_FINISHED) > JOB_MAX_FINISHED
        if not expired and not overflow:
            break
        JOB_FINISHED.popleft()
        JOB_TABLE.pop(job_id, None)


def queue_depth() -> int:
    with JOB_LOCK:
        return len(JOB_QUEUE)


def ensure_job_worker() -> None:
    global _WORKER_STARTED
    with JOB_LOCK:
        if _WORKER_STARTED:
            return
        _WORKER_STARTED = True
    threading.Thread(target=_job_worker_loop, name="probe-job-worker", daemon=True).start()


def submit_job(pipeline: dict, model_id: str, tasks: list, job_id: str | None = None):
    ensure_job_worker()
    with JOB_LOCK:
        prune_jobs()
        if job_id:
            existing = JOB_TABLE.get(job_id)
            if existing is not None:
                return existing, False
        if len(JOB_QUEUE) >= JOB_MAX_QUEUE_DEPTH:
            raise RuntimeError(f"远端任务队列已满（最多 {JOB_MAX_QUEUE_DEPTH} 个排队任务），请稍后重试")
        now = time.time()
        job = {
            "job_id": job_id or new_job_id(),
            "model_id": str(model_id),
            "pipeline": dict(pipeline) if isinstance(pipeline, dict) else {},
            "tasks": list(tasks),
            "status": "queued",
            "results": [],
            "error": None,
            "load_seconds": None,
            "created_at": now,
            "updated_at": now,
            "finished_at": None,
        }
        JOB_TABLE[job["job_id"]] = job
        JOB_QUEUE.append(job)
        JOB_WAKE.set()
        log(f"[job] 入队 {job['job_id']}（tasks={len(job['tasks'])}）")
        return job, True


def get_job(job_id: str):
    with JOB_LOCK:
        prune_jobs()
        return JOB_TABLE.get(job_id)


def job_payload(job: dict) -> dict:
    with JOB_LOCK:
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
    with JOB_LOCK:
        job["status"] = status
        job["error"] = error
        job["updated_at"] = now
        job["finished_at"] = now
        JOB_FINISHED.append(job["job_id"])
        prune_jobs(now)
    with STATE_LOCK:
        STATE["last_active"] = now


def _execute_job(job: dict) -> None:
    with JOB_LOCK:
        job["status"] = "running"
        job["updated_at"] = time.time()
    with STATE_LOCK:
        STATE["last_active"] = time.time()
    try:
        results = []
        for task in job["tasks"]:
            if not isinstance(task, dict):
                raise ValueError("task 必须是对象")
            results.append(
                {
                    "name": task.get("name", "01"),
                    "seed": task.get("seed", 0),
                    "seconds": 0.01,
                    "width": task.get("width", 512),
                    "height": task.get("height", 512),
                    "steps": task.get("steps", 4),
                    "cfg": task.get("cfg", 0),
                    "png_bytes": PNG_1X1_BYTES,
                    "image_b64": PNG_1X1,
                }
            )
            with JOB_LOCK:
                job["results"] = list(results)
                job["updated_at"] = time.time()
        with STATE_LOCK:
            STATE["jobs_done"] += len(results)
            STATE["last_active"] = time.time()
        with JOB_LOCK:
            job["results"] = list(results)
            job["load_seconds"] = 0.0
        _finish_job(job, "done")
        pipeline_loader = job.get("pipeline", {}).get("loader")
        log(f"[probe] job {job['job_id']} 完成 {len(results)} 张，pipeline={pipeline_loader}")
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        with STATE_LOCK:
            STATE["last_error"] = f"generation_failed: {message}"
            STATE["last_error_code"] = "generation_failed"
        _finish_job(job, "failed", {"code": "generation_failed", "message": message})
        log(f"[probe] job {job['job_id']} 失败：{message}")


def _job_worker_loop() -> None:
    log("[job] probe worker 启动，等待队列")
    while not STOP_EVENT.is_set():
        with JOB_LOCK:
            job = JOB_QUEUE.popleft() if JOB_QUEUE else None
        if job is None:
            JOB_WAKE.wait(timeout=0.5)
            JOB_WAKE.clear()
            continue
        _execute_job(job)


def health_payload() -> dict:
    with STATE_LOCK:
        now = time.time()
        phase = STATE["phase"]
        return {
            "status": "error" if phase == "error" else "ok",
            "phase": phase,
            "version": VERSION,
            "model_id": "probe/no-model",
            "loaded": [],
            "device": "CPU (probe)",
            "device_count": 0,
            "uptime_seconds": round(now - STATE["started_at"], 1),
            "idle_seconds": round(now - STATE["last_active"], 1),
            "idle_timeout_sec": STATE["idle_timeout_sec"],
            "jobs_done": STATE["jobs_done"],
            "queue_depth": queue_depth(),
            "last_error": STATE["last_error"],
            "last_error_code": STATE["last_error_code"],
            "tunnel_provider": STATE["tunnel_provider"],
            "tunnel_state": STATE["tunnel_state"],
            "tunnel_restarts": STATE["tunnel_restarts"],
        }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log("[http]", fmt % args)

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _send_error(self, code, error_code, message):
        self._send(code, {"error": {"code": error_code, "message": message}})

    def _authorized(self):
        with STATE_LOCK:
            expected = STATE["token"]
        if not expected:
            return True
        header = self.headers.get("Authorization", "") or ""
        if header.startswith("Bearer ") and hmac.compare_digest(
            header[len("Bearer ") :].strip(), expected
        ):
            return True
        self._send_error(401, "unauthorized", "bad token")
        return False

    def do_GET(self):
        if not self._authorized():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"
        query = urllib.parse.parse_qs(parts.query)

        if path == "/health":
            self._send(200, health_payload())
            return
        if path == "/logs":
            try:
                since = int((query.get("since") or ["0"])[0])
            except (TypeError, ValueError):
                since = 0
            since = max(0, since)
            with LOG_LOCK:
                lines = STATE["logs"][since:][-200:]
                next_index = since + len(lines)
            self._send(200, {"lines": lines, "next": next_index})
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
            self._send(200, job_payload(job))
            return
        self._send_error(404, "not_found", path)

    def do_POST(self):
        if not self._authorized():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"

        if path == "/shutdown":
            STOP_EVENT.set()
            JOB_WAKE.set()
            self._send(200, {"status": "shutting_down"})
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
            return
        if path == "/generate":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except (TypeError, ValueError):
                length = 0
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                spec = json.loads(raw.decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                self._send_error(400, "invalid_request", str(exc))
                return
            if not isinstance(spec, dict):
                self._send_error(400, "invalid_request", "请求体必须是 JSON 对象")
                return
            tasks = spec.get("tasks")
            if not isinstance(tasks, list) or not tasks:
                self._send_error(400, "invalid_request", "tasks 为空")
                return
            try:
                job_id = normalize_job_id(spec.get("jobId"))
            except ValueError as exc:
                self._send_error(400, "invalid_request", str(exc))
                return

            with STATE_LOCK:
                STATE["last_active"] = time.time()
            model_id = spec.get("modelId") or spec.get("model_id") or "probe"
            pipeline = spec.get("pipeline") if isinstance(spec.get("pipeline"), dict) else {}
            try:
                job, _created = submit_job(pipeline, str(model_id), tasks, job_id)
            except RuntimeError as exc:
                self._send_error(429, "queue_full", str(exc))
                return
            self._send(
                202,
                {
                    "status": "accepted",
                    "job_id": job["job_id"],
                    "model_id": job["model_id"],
                    "created_at": iso_time(job["created_at"]),
                },
            )
            return
        self._send_error(404, "not_found", path)


class _CloudflaredDownloadTooLarge(RuntimeError):
    """响应体超过大小上限：直接中止。"""


def _remove_file_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(1 << 16)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


def _download_cloudflared_once(partial: str) -> tuple[int, str]:
    total = 0
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(
            CLOUDFLARED_DOWNLOAD_URL, timeout=CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC
        ) as response, open(partial, "wb") as handle:
            while True:
                chunk = response.read(1 << 16)
                if not chunk:
                    break
                total += len(chunk)
                if total > CLOUDFLARED_MAX_DOWNLOAD_BYTES:
                    raise _CloudflaredDownloadTooLarge(
                        f"响应超过大小上限 {CLOUDFLARED_MAX_DOWNLOAD_BYTES} 字节，已中止"
                    )
                handle.write(chunk)
                digest.update(chunk)
    except BaseException:
        _remove_file_quietly(partial)
        raise
    return total, digest.hexdigest()


def ensure_cloudflared() -> str:
    expected = CLOUDFLARED_SHA256.strip().lower()
    if os.path.exists(CLOUDFLARED_PATH) and os.access(CLOUDFLARED_PATH, os.X_OK):
        existing_sha = _file_sha256(CLOUDFLARED_PATH)
        if existing_sha == expected:
            log("[tunnel] 复用已存在的 /tmp/cloudflared")
            return CLOUDFLARED_PATH
        log(
            f"[tunnel] WARN 已存在的 /tmp/cloudflared SHA256 校验失败"
            f"（期望 {expected[:16]}…，实际 {existing_sha[:16]}…），删除重下"
        )
        _remove_file_quietly(CLOUDFLARED_PATH)

    partial = CLOUDFLARED_PATH + ".part"
    last_reason = "未知原因"
    for attempt in range(1, CLOUDFLARED_DOWNLOAD_ATTEMPTS + 1):
        log(f"[tunnel] 下载 cloudflared {CLOUDFLARED_VERSION}（第 {attempt}/{CLOUDFLARED_DOWNLOAD_ATTEMPTS} 次）…")
        try:
            total, actual = _download_cloudflared_once(partial)
        except _CloudflaredDownloadTooLarge as exc:
            raise RuntimeError(f"cloudflared {CLOUDFLARED_VERSION} 下载失败：{exc}") from exc
        except Exception as exc:  # noqa: BLE001
            last_reason = f"下载异常：{exc}"
            log(f"[tunnel] WARN cloudflared {last_reason}（第 {attempt}/{CLOUDFLARED_DOWNLOAD_ATTEMPTS} 次）")
            continue
        if actual == expected:
            os.replace(partial, CLOUDFLARED_PATH)
            os.chmod(CLOUDFLARED_PATH, 0o755)
            log(
                f"[tunnel] cloudflared {CLOUDFLARED_VERSION} 就绪"
                f"（{round(total / 2**20, 1)} MB，SHA256 {actual[:12]}… 校验通过）"
            )
            return CLOUDFLARED_PATH
        _remove_file_quietly(partial)
        last_reason = f"SHA256 校验失败：期望 {expected[:16]}…，实际 {actual[:16]}…"
        log(f"[tunnel] WARN cloudflared {last_reason}（第 {attempt}/{CLOUDFLARED_DOWNLOAD_ATTEMPTS} 次）")
    raise RuntimeError(
        f"cloudflared {CLOUDFLARED_VERSION} 下载失败"
        f"（{CLOUDFLARED_DOWNLOAD_ATTEMPTS} 次尝试均未成功）：{last_reason}"
    )


def _terminate_proc(proc) -> None:
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


def _start_cloudflared_proc():
    with STATE_LOCK:
        STATE["tunnel_state"] = "starting"
    binary = ensure_cloudflared()
    proc = subprocess.Popen(
        [binary, "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--no-autoupdate"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    found = {"url": None}
    ready = threading.Event()

    def drain():
        try:
            for line in proc.stderr:
                if found["url"] is None:
                    match = CLOUDFLARED_URL_RE.search(line)
                    if match:
                        found["url"] = match.group(0)
                        ready.set()
        except Exception:
            pass
        finally:
            ready.set()

    threading.Thread(target=drain, daemon=True).start()
    if not ready.wait(timeout=TUNNEL_WAIT_SEC) or found["url"] is None:
        _terminate_proc(proc)
        with STATE_LOCK:
            STATE["tunnel_state"] = "down"
        raise RuntimeError(f"cloudflared 未在 {int(TUNNEL_WAIT_SEC)}s 内分配 trycloudflare 域名")
    with STATE_LOCK:
        STATE["tunnel_provider"] = "cloudflare"
        STATE["tunnel_state"] = "up"
        STATE["last_error"] = None
        STATE["last_error_code"] = None
    return found["url"], proc


def start_cloudflared() -> str:
    url, _proc = _start_cloudflared_proc()
    return url


def tunnel_restart_delay(attempt: int) -> float:
    exponent = max(0, int(attempt) - 1)
    return min(TUNNEL_RESTART_MAX_SEC, TUNNEL_RESTART_BASE_SEC * (2**exponent))


def tunnel_monitor(topic: str | None) -> None:
    attempt = 0
    while not STOP_EVENT.is_set():
        if attempt > 0:
            with STATE_LOCK:
                STATE["tunnel_restarts"] += 1
                restarts = STATE["tunnel_restarts"]
            delay = tunnel_restart_delay(attempt)
            log(f"[tunnel] {delay:.0f}s 后重拉隧道（累计重启 {restarts} 次）")
            if STOP_EVENT.wait(delay):
                break
        try:
            endpoint, proc = _start_cloudflared_proc()
        except Exception as exc:  # noqa: BLE001
            with STATE_LOCK:
                STATE["tunnel_state"] = "down"
                STATE["last_error"] = f"tunnel_failed: {exc}"
                STATE["last_error_code"] = "tunnel_failed"
            log(f"[tunnel] WARN 启动失败：{exc}")
            attempt += 1
            continue

        attempt = 0
        log("[tunnel] 域名", endpoint)
        if topic:
            try:
                publish(
                    topic,
                    {
                        "type": "ready",
                        "endpoint": endpoint,
                        "model_id": "probe/no-model",
                        "device": "CPU (probe)",
                    },
                )
            except Exception as exc:  # noqa: BLE001
                log(f"[ntfy] WARN 上报失败：{exc}")
        with STATE_LOCK:
            STATE["phase"] = "ready"
            STATE["last_active"] = time.time()

        while not STOP_EVENT.is_set():
            try:
                code = proc.poll()
            except Exception:
                code = None
            if code is not None:
                break
            time.sleep(1.0)
        if STOP_EVENT.is_set():
            _terminate_proc(proc)
            break
        log(f"[tunnel] WARN cloudflared 进程退出（退出码 {code}），准备重拉")
        with STATE_LOCK:
            STATE["tunnel_state"] = "down"
        attempt = 1


def publish(topic, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(5):
        try:
            request = urllib.request.Request(
                f"https://ntfy.sh/{topic}",
                data=body,
                headers={"Content-Type": "text/plain"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                response.read()
            log("[ntfy] 上报成功", topic)
            return
        except Exception as exc:  # noqa: BLE001
            log(f"[ntfy] 第 {attempt + 1} 次上报失败：{exc}")
            time.sleep(3)
    raise RuntimeError("ntfy 上报失败")


def main():
    config = load_config()
    with STATE_LOCK:
        STATE["token"] = config.get("auth_token", "")
        STATE["idle_timeout_sec"] = int(config.get("idle_timeout_sec", 900))
        STATE["phase"] = "loading"
        STATE["tunnel_state"] = "starting"
    topic = config.get("ntfy_topic")

    log("[probe] 启动", VERSION, "topic=", topic)
    ensure_job_worker()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"[probe] HTTP 监听 127.0.0.1:{PORT}")

    threading.Thread(target=tunnel_monitor, args=(topic,), name="tunnel-monitor", daemon=True).start()

    while not STOP_EVENT.is_set():
        time.sleep(10)
        with STATE_LOCK:
            idle = time.time() - STATE["last_active"]
            timeout_sec = STATE["idle_timeout_sec"]
        if idle >= timeout_sec:
            log(f"[probe] 空闲 {int(idle)}s 超过阈值，退出")
            STOP_EVENT.set()
            os._exit(0)


if __name__ == "__main__":
    main()
