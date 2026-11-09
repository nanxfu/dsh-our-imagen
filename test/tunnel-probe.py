#!/usr/bin/env python3
"""隧道与握手探针（不加载模型、不占 GPU）。

用途：在不消耗 GPU 配额、不下载权重的前提下验证整条调度链路：
    kaggle kernels push → 容器内启动 HTTP → cloudflared 分配域名 → ntfy 上报 → Host 握手

它实现与 remote/daemon.py 相同的接口子集（/health、/logs、/generate、/shutdown），
其中 /generate 返回固定的 1×1 PNG，只用于验证协议形状。

配置注入方式与 daemon.py 一致：Host 会重写脚本里那行以 EMBEDDED_CONFIG_B64 开头的赋值。
"""

import base64
import json
import os
import re
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 由 Host 在打包时替换；本地调试可用环境变量 IMAGEN_CONFIG_B64 覆盖
EMBEDDED_CONFIG_B64 = ""

PORT = 7860
VERSION = "0.2.0-probe"
PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

STATE = {
    "started_at": time.time(),
    "last_active": time.time(),
    "jobs_done": 0,
    "token": "",
    "idle_timeout_sec": 900,
    "phase": "booting",
    "last_error": None,
    "logs": [],
}

LOG_LOCK = threading.Lock()


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


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log("[http]", fmt % args)

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        expected = STATE["token"]
        if not expected:
            return True
        if self.headers.get("Authorization", "") == "Bearer " + expected:
            return True
        self._send(401, {"error": {"code": "unauthorized", "message": "bad token"}})
        return False

    def do_GET(self):
        if not self._authorized():
            return
        if self.path.startswith("/health"):
            self._send(
                200,
                {
                    "status": "ok",
                    "phase": STATE["phase"],
                    "version": VERSION,
                    "model_id": "probe/no-model",
                    "loaded": [],
                    "device": "CPU (probe)",
                    "device_count": 0,
                    "uptime_seconds": round(time.time() - STATE["started_at"], 1),
                    "idle_seconds": round(time.time() - STATE["last_active"], 1),
                    "idle_timeout_sec": STATE["idle_timeout_sec"],
                    "jobs_done": STATE["jobs_done"],
                    "queue_depth": 0,
                    "last_error": STATE["last_error"],
                },
            )
            return
        if self.path.startswith("/logs"):
            since = 0
            match = re.search(r"since=(\d+)", self.path)
            if match:
                since = int(match.group(1))
            with LOG_LOCK:
                lines = STATE["logs"][max(0, since) :][-200:]
                next_index = max(0, since) + len(lines)
            self._send(200, {"lines": lines, "next": next_index})
            return
        self._send(404, {"error": {"code": "not_found", "message": self.path}})

    def do_POST(self):
        if not self._authorized():
            return
        if self.path == "/shutdown":
            self._send(200, {"status": "shutting_down"})
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
            return
        if self.path == "/generate":
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                spec = json.loads(raw.decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                self._send(400, {"error": {"code": "invalid_request", "message": str(exc)}})
                return
            STATE["last_active"] = time.time()
            tasks = spec.get("tasks") or []
            if not tasks:
                self._send(400, {"error": {"code": "invalid_request", "message": "tasks 为空"}})
                return
            results = []
            for task in tasks:
                results.append(
                    {
                        "name": task.get("name", "01"),
                        "seed": task.get("seed", 0),
                        "seconds": 0.01,
                        "width": task.get("width", 512),
                        "height": task.get("height", 512),
                        "steps": task.get("steps", 4),
                        "cfg": task.get("cfg", 0),
                        "png_bytes": len(base64.b64decode(PNG_1X1)),
                        "image_b64": PNG_1X1,
                    }
                )
            STATE["jobs_done"] += len(results)
            STATE["last_active"] = time.time()
            log(f"[probe] generate {len(results)} 张，pipeline={spec.get('pipeline', {}).get('loader')}")
            self._send(
                200,
                {
                    "status": "ok",
                    "model_id": spec.get("modelId", "probe"),
                    "load_seconds": 0.0,
                    "results": results,
                },
            )
            return
        self._send(404, {"error": {"code": "not_found", "message": self.path}})


def start_cloudflared():
    binary = "/tmp/cloudflared"
    if not os.path.exists(binary):
        log("[tunnel] 下载 cloudflared")
        urllib.request.urlretrieve(
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            binary,
        )
        os.chmod(binary, 0o755)

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
        for line in proc.stderr:
            if found["url"] is None:
                match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                if match:
                    found["url"] = match.group(0)
                    ready.set()

    threading.Thread(target=drain, daemon=True).start()
    if not ready.wait(timeout=120):
        raise RuntimeError("cloudflared 未在 120s 内分配 trycloudflare 域名")
    return found["url"]


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
    STATE["token"] = config.get("auth_token", "")
    STATE["idle_timeout_sec"] = int(config.get("idle_timeout_sec", 900))
    topic = config.get("ntfy_topic")

    log("[probe] 启动", VERSION, "topic=", topic)
    STATE["phase"] = "loading"
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"[probe] HTTP 监听 127.0.0.1:{PORT}")

    endpoint = start_cloudflared()
    log("[tunnel] 域名", endpoint)
    publish(
        topic,
        {
            "type": "ready",
            "endpoint": endpoint,
            "model_id": "probe/no-model",
            "device": "CPU (probe)",
        },
    )

    STATE["phase"] = "ready"
    STATE["last_active"] = time.time()
    while True:
        time.sleep(10)
        idle = time.time() - STATE["last_active"]
        if idle >= STATE["idle_timeout_sec"]:
            log(f"[probe] 空闲 {int(idle)}s 超过阈值，退出")
            os._exit(0)


if __name__ == "__main__":
    main()
