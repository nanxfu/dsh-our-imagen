#!/usr/bin/env python3
"""Remote daemon script executed inside a Kaggle GPU kernel for Session mode.

Exposes a lightweight HTTP JSON API over a temporary Cloudflare Tunnel:
  - GET  /health    -> Returns current status, loaded model, and idle timer
  - POST /generate  -> Runs batch/single image generation on GPU and returns base64 PNGs
  - POST /shutdown  -> Immediately terminates the kernel process to stop GPU quota billing

Includes an automatic idle watchdog that exits the process when no requests
arrive within IDLE_TIMEOUT_SEC.
"""

import base64
import inspect
import io
import json
import os
import re
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from diffusers import AutoPipelineForText2Image

# Replaced at build time via Base64 config injection
EMBEDDED_CONFIG_B64 = ""

PORT = 7860
STATE = {
    "model_id": None,
    "pipe": None,
    "sig_params": set(),
    "lock": threading.Lock(),
    "last_active": time.time(),
    "auth_token": "",
    "idle_timeout_sec": 900,
}


def log(*args):
    print(*args, flush=True)


def load_config() -> dict:
    if EMBEDDED_CONFIG_B64:
        raw = base64.b64decode(EMBEDDED_CONFIG_B64.encode("ascii")).decode("utf-8")
        return json.loads(raw)
    raise RuntimeError("Missing EMBEDDED_CONFIG_B64 in daemon.py")


def ensure_pipeline(model_id: str):
    if STATE["pipe"] is not None and STATE["model_id"] == model_id:
        return STATE["pipe"]

    log(f"Loading model '{model_id}' onto CUDA...")
    t0 = time.time()
    if STATE["pipe"] is not None:
        del STATE["pipe"]
        torch.cuda.empty_cache()

    pipe = None
    for variant in ("fp16", None):
        try:
            kwargs = {"torch_dtype": torch.float16, "use_safetensors": True}
            if variant:
                kwargs["variant"] = variant
            pipe = AutoPipelineForText2Image.from_pretrained(model_id, **kwargs)
            pipe = pipe.to("cuda")
            break
        except Exception as exc:
            if variant == "fp16":
                log(f"fp16 variant unavailable, falling back to default weights: {exc}")
            else:
                raise

    STATE["pipe"] = pipe
    STATE["model_id"] = model_id
    STATE["sig_params"] = set(inspect.signature(pipe.__call__).parameters.keys())
    log(f"Model '{model_id}' ready in {round(time.time() - t0, 1)}s")
    return pipe


class SessionHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log(f"[HTTP] {self.address_string()} - {fmt % args}")

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_auth(self) -> bool:
        expected = STATE["auth_token"]
        if not expected:
            return True
        auth_header = self.headers.get("Authorization", "")
        if auth_header == f"Bearer {expected}":
            return True
        self._send_json(401, {"error": "Unauthorized"})
        return False

    def do_GET(self):
        if not self._check_auth():
            return
        if self.path == "/health":
            idle_sec = round(time.time() - STATE["last_active"], 1)
            self._send_json(
                200,
                {
                    "status": "ok",
                    "model_id": STATE["model_id"],
                    "device": torch.cuda.get_device_name(0),
                    "idle_seconds": idle_sec,
                    "idle_timeout_sec": STATE["idle_timeout_sec"],
                },
            )
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if not self._check_auth():
            return

        if self.path == "/shutdown":
            log("Received /shutdown request. Exiting process to stop GPU billing.")
            self._send_json(200, {"status": "shutting_down"})
            threading.Thread(target=lambda: (time.sleep(0.5), os._exit(0)), daemon=True).start()
            return

        if self.path == "/generate":
            STATE["last_active"] = time.time()
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8")
            try:
                spec = json.loads(raw_body)
                model_id = spec["model_id"]
                tasks = spec["tasks"]

                outputs = []
                with STATE["lock"]:
                    pipe = ensure_pipeline(model_id)
                    sig_params = STATE["sig_params"]

                    for task in tasks:
                        STATE["last_active"] = time.time()
                        seed = int(task["seed"])
                        width = int(task["width"])
                        height = int(task["height"])
                        steps = int(task["steps"])
                        cfg = float(task["cfg"])
                        prompt = task["prompt"]
                        neg_prompt = task.get("negative_prompt", "").strip()

                        generator = torch.Generator(device="cuda").manual_seed(seed)
                        call_kwargs = {
                            "prompt": prompt,
                            "num_inference_steps": steps,
                            "guidance_scale": cfg,
                            "width": width,
                            "height": height,
                            "generator": generator,
                        }
                        if neg_prompt and "negative_prompt" in sig_params and cfg > 0.0:
                            call_kwargs["negative_prompt"] = neg_prompt

                        t0 = time.time()
                        image = pipe(**call_kwargs).images[0]
                        elapsed = round(time.time() - t0, 2)

                        buf = io.BytesIO()
                        image.save(buf, format="PNG")
                        b64_png = base64.b64encode(buf.getvalue()).decode("ascii")

                        filename = f"{task['name']}_seed{seed}.png"
                        outputs.append(
                            {
                                "name": task["name"],
                                "file": filename,
                                "prompt": prompt,
                                "negative_prompt": neg_prompt if (neg_prompt and cfg > 0.0) else "",
                                "seed": seed,
                                "width": width,
                                "height": height,
                                "steps": steps,
                                "cfg": cfg,
                                "seconds": elapsed,
                                "model_id": model_id,
                                "image_b64": b64_png,
                            }
                        )
                        log(f"Generated {filename} in {elapsed}s")

                STATE["last_active"] = time.time()
                self._send_json(200, {"status": "ok", "results": outputs})
            except Exception as exc:
                log("Generation error:", exc)
                self._send_json(500, {"error": str(exc)})
            return

        self._send_json(404, {"error": "Not found"})


def start_cloudflared() -> str:
    bin_path = "/tmp/cloudflared"
    if not os.path.exists(bin_path):
        urllib.request.urlretrieve(
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            bin_path,
        )
        os.chmod(bin_path, 0o755)

    proc = subprocess.Popen(
        [bin_path, "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--no-autoupdate"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    for line in proc.stderr:
        match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
        if match:
            url = match.group(0)
            threading.Thread(
                target=lambda: [ None for _ in proc.stderr ],
                daemon=True,
            ).start()
            return url
    raise RuntimeError("cloudflared failed to allocate a *.trycloudflare.com URL")


def publish_ready(ntfy_topic: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                f"https://ntfy.sh/{ntfy_topic}",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=15).read()
            log("Published session endpoint to ntfy topic:", ntfy_topic)
            return
        except Exception as exc:
            log(f"ntfy publish attempt {attempt + 1} failed: {exc}")
            time.sleep(2)


def main():
    if not torch.cuda.is_available():
        raise RuntimeError(
            "No GPU detected (torch.cuda.is_available() is False). "
            "Kaggle silently fell back to CPU — ensure phone verification is enabled in Kaggle Settings."
        )

    cfg = load_config()
    STATE["auth_token"] = cfg["auth_token"]
    STATE["idle_timeout_sec"] = int(cfg.get("idle_timeout_sec", 900))
    preload_model = cfg.get("preload_model", "stabilityai/sdxl-turbo")
    ntfy_topic = cfg["ntfy_topic"]

    log("device:", torch.cuda.get_device_name(0))
    ensure_pipeline(preload_model)

    server = ThreadingHTTPServer(("127.0.0.1", PORT), SessionHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"HTTP server listening on 127.0.0.1:{PORT}")

    tunnel_url = start_cloudflared()
    log("Tunnel ready:", tunnel_url)

    STATE["last_active"] = time.time()
    publish_ready(
        ntfy_topic,
        {
            "endpoint_url": tunnel_url,
            "model_id": STATE["model_id"],
            "device": torch.cuda.get_device_name(0),
        },
    )

    while True:
        time.sleep(10)
        idle = time.time() - STATE["last_active"]
        if idle >= STATE["idle_timeout_sec"]:
            log(f"Idle timeout reached ({int(idle)}s >= {STATE['idle_timeout_sec']}s). Shutting down.")
            os._exit(0)


if __name__ == "__main__":
    main()
