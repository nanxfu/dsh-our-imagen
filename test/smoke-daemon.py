#!/usr/bin/env python3
"""本地验收脚本：对着 test/mock-daemon.py 跑完整协议链路。

覆盖：
  1. Bearer 鉴权（无 token → 401）
  2. GET /health 的 phase 与字段
  3. POST /generate 返回的 base64 解码后是**合法 PNG**（magic + IHDR + 每个 chunk 的 CRC + 尺寸）
  4. GET /logs?since=N 的增量分页：next 单调、不重复、无新行时 lines 为空
  5. POST /shutdown 后进程退出
  6. warming 分支（--warm-seconds）
  7. 错误分类分支（--fail oom / load_failed / invalid_request / generation_failed）
  8. 契约边界：越界返回 400 invalid_request（P9 起 daemon 不再静默钳制）
  9. phase error 分支（--phase error）：/health status=error、/generate 503 load_failed
 10. --fail-generate 500 分支：/generate 返回 500 generation_failed

用法：
  python test/smoke-daemon.py
  python test/smoke-daemon.py --verbose
"""

from __future__ import annotations

import argparse
import base64
import json
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOCK = ROOT / "test" / "mock-daemon.py"
TOKEN = "test-token"


class CheckFailed(AssertionError):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def http_json(
    url: str,
    method: str = "GET",
    token: str | None = None,
    payload: dict | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict]:
    data = None
    headers: dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, {"raw": body}


def validate_png(data: bytes) -> tuple[int, int]:
    """严格校验 PNG：magic、chunk CRC、IHDR 参数、IDAT 解压后的行长度。"""
    check(data[:8] == b"\x89PNG\r\n\x1a\n", "PNG magic 不正确")
    pos = 8
    width = height = None
    depth = color = None
    idat = b""
    seen_iend = False
    while pos < len(data):
        check(pos + 8 <= len(data), "PNG chunk 头被截断")
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        end_payload = pos + 8 + length
        check(end_payload + 4 <= len(data), f"PNG chunk {tag!r} 数据被截断")
        chunk_payload = data[pos + 8 : end_payload]
        (crc,) = struct.unpack(">I", data[end_payload : end_payload + 4])
        check(
            (zlib.crc32(tag + chunk_payload) & 0xFFFFFFFF) == crc,
            f"PNG chunk {tag!r} 的 CRC 校验失败",
        )
        if tag == b"IHDR":
            width, height, depth, color, comp, filt, interlace = struct.unpack(
                ">IIBBBBB", chunk_payload
            )
            check(depth == 8, f"IHDR 位深应为 8，实际 {depth}")
            check(color == 2, f"IHDR 颜色类型应为 2(truecolor)，实际 {color}")
            check(comp == 0 and filt == 0 and interlace == 0, "IHDR 压缩/滤波/交错参数异常")
        elif tag == b"IDAT":
            idat += chunk_payload
        elif tag == b"IEND":
            seen_iend = True
        pos = end_payload + 4

    check(seen_iend, "PNG 缺少 IEND")
    check(width is not None and height is not None, "PNG 缺少 IHDR")
    check(len(idat) > 0, "PNG 缺少 IDAT")
    raw = zlib.decompress(idat)
    expected = height * (1 + width * 3)
    check(
        len(raw) == expected,
        f"IDAT 解压后长度 {len(raw)} 与 {width}x{height} 的期望 {expected} 不符",
    )
    return int(width), int(height)


class MockDaemon:
    """子进程托管：顺带把 mock 的 stdout 抽干，避免管道写满拖死被调方。"""

    def __init__(self, extra_args: list[str], token: str = TOKEN) -> None:
        self.port = free_port()
        self.token = token
        self.output: deque[str] = deque(maxlen=4000)
        self.proc = subprocess.Popen(
            [
                sys.executable,
                str(MOCK),
                "--port",
                str(self.port),
                "--token",
                token,
                *extra_args,
            ],
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self._reader = threading.Thread(target=self._drain, daemon=True)
        self._reader.start()

    def _drain(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            self.output.append(line.rstrip())

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def tail(self, limit: int = 25) -> str:
        return "\n".join(list(self.output)[-limit:])

    def wait_health(self, timeout: float = 25.0) -> dict:
        deadline = time.time() + timeout
        last_error = "无响应"
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise CheckFailed(f"mock 进程提前退出（code={self.proc.returncode}）：\n{self.tail()}")
            try:
                status, body = http_json(f"{self.base}/health", token=self.token, timeout=2.0)
                if status == 200:
                    return body
                last_error = f"HTTP {status}: {body}"
            except (urllib.error.URLError, OSError) as exc:
                last_error = str(exc)
            time.sleep(0.15)
        raise CheckFailed(f"/health 在 {timeout}s 内不可用：{last_error}\n{self.tail()}")

    def stop(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)

    def wait_exit(self, timeout: float = 10.0) -> int:
        try:
            return self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise CheckFailed(f"进程在 {timeout}s 内没有退出") from exc


def make_spec(tasks: list[dict]) -> dict:
    return {
        "pipeline": {
            "loader": "sdxl-lora",
            "base": "stabilityai/stable-diffusion-xl-base-1.0",
            "lora": {
                "repo": "ByteDance/SDXL-Lightning",
                "weight": "sdxl_lightning_4step_lora.safetensors",
            },
            "scheduler": {"type": "euler", "timestepSpacing": "trailing"},
            "variant": "fp16",
            "allowPatterns": ["model_index.json", "**/*.fp16.safetensors"],
            "deviceMap": None,
        },
        "modelId": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
        "tasks": tasks,
    }


def scenario_main(verbose: bool) -> list[str]:
    notes = []
    daemon = MockDaemon([])
    try:
        health = daemon.wait_health()
        check(health.get("phase") == "ready", f"phase 应为 ready，实际 {health.get('phase')!r}")
        for field in (
            "status",
            "phase",
            "version",
            "model_id",
            "loaded",
            "device",
            "device_count",
            "idle_seconds",
            "idle_timeout_sec",
            "jobs_done",
            "queue_depth",
            "last_error",
        ):
            check(field in health, f"/health 缺少字段 {field}")
        notes.append(f"/health 字段齐全：phase={health['phase']} device={health['device']}")

        # 鉴权
        status, body = http_json(f"{daemon.base}/health")
        check(status == 401, f"无 token 应返回 401，实际 {status}")
        check(body.get("error", {}).get("code") == "unauthorized", f"401 错误体异常：{body}")
        notes.append("Bearer 鉴权：无 token → 401 unauthorized")

        # 生成
        tasks = [
            {
                "name": "01",
                "prompt": "雾中荷塘，工笔",
                "negative_prompt": "blurry",
                "seed": 42,
                "width": 320,
                "height": 256,
                "steps": 4,
                "cfg": 0,
            },
            {
                "name": "02",
                "prompt": "雪山日出，油画",
                "negative_prompt": "",
                "seed": 43,
                "width": 256,
                "height": 256,
                "steps": 4,
                "cfg": 0,
            },
        ]
        status, body = http_json(
            f"{daemon.base}/generate", method="POST", token=TOKEN, payload=make_spec(tasks), timeout=90
        )
        check(status == 200, f"/generate 应返回 200，实际 {status}: {body}")
        check(body.get("status") == "ok", f"响应 status 异常：{body.get('status')!r}")
        check(isinstance(body.get("load_seconds"), (int, float)), "响应缺少 load_seconds")
        results = body.get("results") or []
        check(len(results) == 2, f"应返回 2 张图，实际 {len(results)}")
        for result, task in zip(results, tasks):
            check(result["name"] == task["name"], "结果 name 不匹配")
            check(result["seed"] == task["seed"], "结果 seed 不匹配")
            png = base64.b64decode(result["image_b64"], validate=True)
            check(len(png) == result["png_bytes"], "png_bytes 与实际字节数不一致")
            width, height = validate_png(png)
            check(
                (width, height) == (task["width"], task["height"]),
                f"PNG 尺寸 {width}x{height} 与请求 {task['width']}x{task['height']} 不一致",
            )
            notes.append(
                f"/generate {result['name']}：PNG 合法 {width}x{height}，{len(png)} 字节，seed={result['seed']}"
            )
        if verbose:
            print(json.dumps(body["results"][0], ensure_ascii=False)[:200])

        # /logs 分页
        status, page0 = http_json(f"{daemon.base}/logs?since=0", token=TOKEN)
        check(status == 200, f"/logs 应返回 200，实际 {status}")
        check(isinstance(page0.get("lines"), list) and isinstance(page0.get("next"), int), "/logs 响应结构异常")
        check(len(page0["lines"]) > 0, "/logs?since=0 应至少有一行")
        next0 = page0["next"]
        notes.append(f"/logs?since=0 → {len(page0['lines'])} 行，next={next0}")

        status, page_idle = http_json(f"{daemon.base}/logs?since={next0}", token=TOKEN)
        check(page_idle["lines"] == [], f"since=next 应返回空 lines，实际 {len(page_idle['lines'])} 行")
        check(page_idle["next"] == next0, "无新日志时 next 不应变化")
        notes.append(f"/logs?since={next0} → 0 行，next 保持 {next0}（分页稳定）")

        status, body = http_json(
            f"{daemon.base}/generate", method="POST", token=TOKEN, payload=make_spec([tasks[0]]), timeout=90
        )
        check(status == 200, f"第二次 /generate 应返回 200，实际 {status}")

        status, page1 = http_json(f"{daemon.base}/logs?since={next0}", token=TOKEN)
        check(len(page1["lines"]) > 0, "第二次生成后应能拉到新日志")
        check(page1["next"] > next0, "next 应单调递增")
        check(
            page1["lines"][0].startswith("[") and all(line.strip() for line in page1["lines"]),
            "日志行格式异常",
        )
        next1 = page1["next"]
        notes.append(f"/logs?since={next0} → {len(page1['lines'])} 行新日志，next={next1}")

        status, page_again = http_json(f"{daemon.base}/logs?since={next1}", token=TOKEN)
        check(page_again["lines"] == [], "同一 next 重复拉取应返回空，避免 Host 重复渲染")
        notes.append(f"/logs?since={next1} → 0 行（无重复）")

        # shutdown
        status, body = http_json(f"{daemon.base}/shutdown", method="POST", token=TOKEN)
        check(status == 200, f"/shutdown 应返回 200，实际 {status}")
        check(body.get("status") == "shutting_down", f"/shutdown 响应异常：{body}")
        code = daemon.wait_exit(10)
        notes.append(f"/shutdown 已退出（exit code={code}）")
    finally:
        daemon.stop()
    return notes


def scenario_warming() -> list[str]:
    daemon = MockDaemon(["--warm-seconds", "3", "--delay", "0.2"])
    try:
        health = daemon.wait_health()
        check(health["phase"] in ("loading", "booting"), f"预热期 phase 应为 loading，实际 {health['phase']!r}")
        status, body = http_json(
            f"{daemon.base}/generate",
            method="POST",
            token=TOKEN,
            payload=make_spec([{"name": "01", "prompt": "x", "seed": 1, "width": 256, "height": 256, "steps": 4, "cfg": 0}]),
        )
        check(status == 503, f"未 ready 时 /generate 应 503，实际 {status}")
        check(body.get("error", {}).get("code") == "warming", f"503 错误码应为 warming：{body}")

        deadline = time.time() + 15
        while time.time() < deadline:
            health = daemon.wait_health(timeout=3)
            if health["phase"] == "ready":
                break
            time.sleep(0.3)
        check(health["phase"] == "ready", "预热结束后 phase 应为 ready")

        status, body = http_json(
            f"{daemon.base}/generate",
            method="POST",
            token=TOKEN,
            payload=make_spec([{"name": "01", "prompt": "x", "seed": 1, "width": 256, "height": 256, "steps": 4, "cfg": 0}]),
            timeout=60,
        )
        check(status == 200, f"ready 后 /generate 应 200，实际 {status}: {body}")
        validate_png(base64.b64decode(body["results"][0]["image_b64"]))
        return ["warming 分支：loading → 503 warming → ready → 200"]
    finally:
        daemon.stop()


def scenario_failure(code: str) -> list[str]:
    daemon = MockDaemon(["--fail", code])
    try:
        daemon.wait_health()
        status, body = http_json(
            f"{daemon.base}/generate",
            method="POST",
            token=TOKEN,
            payload=make_spec([{"name": "01", "prompt": "x", "seed": 1, "width": 256, "height": 256, "steps": 4, "cfg": 0}]),
        )
        expected_status = 400 if code == "invalid_request" else 500
        check(status == expected_status, f"--fail {code} 应返回 {expected_status}，实际 {status}")
        check(body.get("error", {}).get("code") == code, f"错误码应为 {code}：{body}")
        return [f"错误分类 --fail {code} → HTTP {status} {{error.code={code}}}"]
    finally:
        daemon.stop()


def scenario_boundaries() -> list[str]:
    """契约边界：越界必须 400 invalid_request（P9 起 daemon 不再静默钳制）。"""
    daemon = MockDaemon([])
    notes: list[str] = []
    base_task = {"name": "01", "prompt": "边界测试", "seed": 1, "width": 256, "height": 256, "steps": 4, "cfg": 0}

    def expect_400(label: str, tasks: list[dict]) -> None:
        status, body = http_json(
            f"{daemon.base}/generate", method="POST", token=TOKEN, payload=make_spec(tasks)
        )
        check(status == 400, f"{label} 应返回 400，实际 {status}: {body}")
        check(
            body.get("error", {}).get("code") == "invalid_request",
            f"{label} 错误码应为 invalid_request：{body}",
        )
        notes.append(f"{label} → 400 invalid_request")

    try:
        daemon.wait_health()
        for field, value in (
            ("width", 255),
            ("width", 1537),
            ("height", 255),
            ("steps", 0),
            ("steps", 61),
            ("cfg", 20.5),
            ("seed", 2147483648),
        ):
            task = dict(base_task)
            task[field] = value
            expect_400(f"{field}={value}", [task])
        expect_400("tasks=5（契约 count.max=4）", [dict(base_task) for _ in range(5)])
        long_prompt = dict(base_task)
        long_prompt["prompt"] = "字" * 2001
        expect_400("prompt=2001 字符", [long_prompt])

        # 合法边界仍应接受：最小尺寸 + 最大步数 / 最大 cfg
        status, body = http_json(
            f"{daemon.base}/generate",
            method="POST",
            token=TOKEN,
            payload=make_spec(
                [
                    {
                        "name": "01",
                        "prompt": "边界合法值",
                        "seed": 1,
                        "width": 256,
                        "height": 256,
                        "steps": 60,
                        "cfg": 20,
                    }
                ]
            ),
            timeout=60,
        )
        check(status == 200, f"合法边界应返回 200，实际 {status}: {body}")
        validate_png(base64.b64decode(body["results"][0]["image_b64"]))
        notes.append("合法边界（256×256 / steps=60 / cfg=20）→ 200 且 PNG 合法")
        return notes
    finally:
        daemon.stop()


def scenario_phase_error() -> list[str]:
    """--phase error：/health status=error，/generate → 503 load_failed。"""
    daemon = MockDaemon(["--phase", "error"])
    try:
        health = daemon.wait_health()
        check(health.get("phase") == "error", f"phase 应为 error，实际 {health.get('phase')!r}")
        check(health.get("status") == "error", f"status 应为 error，实际 {health.get('status')!r}")
        check(health.get("last_error_code") == "load_failed", f"last_error_code 异常：{health}")
        check(isinstance(health.get("detail"), str) and bool(health["detail"]), "detail 应带失败原因")
        status, body = http_json(
            f"{daemon.base}/generate",
            method="POST",
            token=TOKEN,
            payload=make_spec([{"name": "01", "prompt": "x", "seed": 1, "width": 256, "height": 256, "steps": 4, "cfg": 0}]),
        )
        check(status == 503, f"phase=error 时 /generate 应 503，实际 {status}: {body}")
        check(body.get("error", {}).get("code") == "load_failed", f"503 错误码应为 load_failed：{body}")
        return ["--phase error → /health status=error + /generate 503 load_failed"]
    finally:
        daemon.stop()


def scenario_fail_generate() -> list[str]:
    """--fail-generate 400/500：/generate 返回固定状态码 + 对象 envelope。"""
    notes: list[str] = []
    for status_code, error_code in ((500, "generation_failed"), (400, "invalid_request")):
        daemon = MockDaemon(["--fail-generate", str(status_code)])
        try:
            daemon.wait_health()
            status, body = http_json(
                f"{daemon.base}/generate",
                method="POST",
                token=TOKEN,
                payload=make_spec([{"name": "01", "prompt": "x", "seed": 1, "width": 256, "height": 256, "steps": 4, "cfg": 0}]),
            )
            check(status == status_code, f"--fail-generate {status_code} 应返回 {status_code}，实际 {status}: {body}")
            check(
                body.get("error", {}).get("code") == error_code,
                f"--fail-generate {status_code} 错误码应为 {error_code}：{body}",
            )
            check(isinstance(body.get("error", {}).get("message"), str), "错误体应带 message")
            notes.append(f"--fail-generate {status_code} → {status_code} {error_code}（对象 envelope）")
        finally:
            daemon.stop()
    return notes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="mock daemon 协议验收")
    parser.add_argument("--verbose", action="store_true", help="打印部分原始响应")
    args = parser.parse_args(argv)

    scenarios = [
        ("主链路", lambda: scenario_main(args.verbose)),
        ("契约边界（越界 400）", scenario_boundaries),
        ("warming", scenario_warming),
        ("phase error（503 load_failed）", scenario_phase_error),
        ("--fail-generate 500", scenario_fail_generate),
        ("错误分类 oom", lambda: scenario_failure("oom")),
        ("错误分类 load_failed", lambda: scenario_failure("load_failed")),
        ("错误分类 invalid_request", lambda: scenario_failure("invalid_request")),
        ("错误分类 generation_failed", lambda: scenario_failure("generation_failed")),
    ]

    passed = 0
    failures = 0
    for title, runner in scenarios:
        print(f"\n── {title} " + "─" * (60 - len(title)))
        try:
            for note in runner():
                print(f"  ✓ {note}")
            passed += 1
        except CheckFailed as exc:
            failures += 1
            print(f"  ✗ 失败：{exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  ✗ 异常：{type(exc).__name__}: {exc}")

    print("\n" + "=" * 66)
    if failures:
        print(f"结果：{failures} 个场景失败，{passed} 个通过")
        return 1
    print(f"结果：{passed}/{len(scenarios)} 个场景全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
