"""隧道。

命令规整与地址提取、固定版本下载与 SHA256 校验、stderr 持续读取、单通道尝试与备用通道回退、常驻监管。

拆分自 test/daemon-unit.py，运行：python test/remote/test_tunnel.py
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import tempfile
import threading
from unittest import mock
from pathlib import Path

from support import (
    DAEMON_PATH,
    DaemonUnitTest,
    FakeProc,
    FakeResponse,
    d,
    make_urlopen,
    remote_tunnel,
)


class TunnelSupervisorBoundaryTest(DaemonUnitTest):
    """切片⑥d：隧道域收进 TUNNEL，二进制参数走 TunnelBinary 设置对象。"""

    def test_supervisor_is_the_single_owner(self) -> None:
        self.assertIsInstance(d.TUNNEL, remote_tunnel.TunnelSupervisor)
        self.assertIsInstance(d.TUNNEL.binary, remote_tunnel.TunnelBinary)
        # 常量仍是单一真源，binary 只是可替换的取数对象（生产口径必须同值）。
        self.assertEqual(d.TUNNEL.binary.path, d.CLOUDFLARED_PATH)
        self.assertEqual(d.TUNNEL.binary.url, d.CLOUDFLARED_DOWNLOAD_URL)
        self.assertEqual(d.TUNNEL.binary.sha256, d.CLOUDFLARED_SHA256)
        # 别名指向同一个方法对象，不是第二份实现。
        self.assertEqual(d.start_tunnel, d.TUNNEL.start)
        self.assertEqual(d.tunnel_monitor, d.TUNNEL.monitor)
        self.assertEqual(d.tunnel_restart_delay, d.TUNNEL.restart_delay)

    def test_daemon_no_longer_defines_the_wrappers(self) -> None:
        source = DAEMON_PATH.read_text(encoding="utf-8")
        for name in (
            "start_tunnel",
            "ensure_cloudflared",
            "tunnel_monitor",
            "build_tunnel_plan",
            "announce_tunnel_ready",
            "recover_tunnel_error",
            "tunnel_wait_exit",
        ):
            self.assertIsNone(
                re.search(rf"(?m)^def {name}\(", source),
                f"daemon.py 不应再定义 {name}（实现已归 TunnelSupervisor）",
            )
        # 这两个内部步骤也随实现搬走，别留成第二份。
        for name in ("_spawn_tunnel_process", "_download_cloudflared_once", "_drain_tunnel_output"):
            self.assertNotIn(f"def {name}(", source)

    def test_binary_fields_are_read_at_call_time(self) -> None:
        """替换 TUNNEL.binary 的字段必须影响真实路径：构造期拷贝会静默失效。"""
        self.assertEqual(d.build_tunnel_plan(7860)[0]["argv"][0], d.TUNNEL.binary.path)
        with mock.patch.object(d.TUNNEL.binary, "path", "/tmp/other-cloudflared"):
            self.assertEqual(d.build_tunnel_plan(7860)[0]["argv"][0], "/tmp/other-cloudflared")

    def test_restart_backoff_is_exposed_on_the_instance(self) -> None:
        """退避函数也走实例：monitor 内部是 `self.restart_delay`，替换才能压平等待。

        （`TunnelMonitorTest` 用它把 2s 退避压成 1ms；若内部改回模块级函数，那条用例会
        退化成真等 2 秒——不会报错，只是慢，所以这里再钉一次取值口径。）
        """
        self.assertEqual(d.TUNNEL.restart_delay(1), 2.0)
        self.assertEqual(d.TUNNEL.restart_delay(100), d.TUNNEL_RESTART_MAX_SEC)
        self.assertEqual(d.tunnel_restart_delay(0), 2.0)


class TunnelHelperTest(DaemonUnitTest):
    """P0.2 / P2.2 隧道纯函数：命令规整、URL 提取、provider 计划、退避。"""

    def test_normalize_command_substitutes_port(self) -> None:
        self.assertEqual(
            d.normalize_tunnel_command(["bore", "local", "127.0.0.1:{port}", "--to", "bore.pub"], 7860),
            ["bore", "local", "127.0.0.1:7860", "--to", "bore.pub"],
        )
        # 没有占位符时把端口追加到末尾
        self.assertEqual(
            d.normalize_tunnel_command(["frpc", "-c", "frpc.toml"], 7860),
            ["frpc", "-c", "frpc.toml", "7860"],
        )
        self.assertEqual(d.normalize_tunnel_command(["  ", "", None, 42], 7860), [])
        self.assertEqual(d.normalize_tunnel_command("bore", 7860), [])

    def test_extract_tunnel_url(self) -> None:
        self.assertEqual(
            d.extract_tunnel_url("INF +--- https://abc-def.trycloudflare.com ---+", d.CLOUDFLARED_URL_RE),
            "https://abc-def.trycloudflare.com",
        )
        self.assertIsNone(d.extract_tunnel_url("no url here", d.CLOUDFLARED_URL_RE))
        self.assertIsNone(d.extract_tunnel_url(None, d.CLOUDFLARED_URL_RE))
        self.assertEqual(
            d.extract_tunnel_url("started at https://frp.example.com/path).", d.DEFAULT_CUSTOM_URL_RE),
            "https://frp.example.com/path",
        )

    def test_tunnel_url_regex_falls_back_to_default(self) -> None:
        self.assertEqual(d.tunnel_url_regex("").pattern, d.DEFAULT_CUSTOM_URL_RE.pattern)
        self.assertEqual(d.tunnel_url_regex(r"https://[\w.-]+").pattern, r"https://[\w.-]+")
        self.assertEqual(d.tunnel_url_regex("([").pattern, d.DEFAULT_CUSTOM_URL_RE.pattern)
        self.assertLogContains("fallback_tunnel_url_regex 非法")

    def test_provider_plan_prefers_cloudflare_then_custom(self) -> None:
        plan = d.build_tunnel_plan(7860)
        self.assertEqual([item["provider"] for item in plan], ["cloudflare"])
        self.assertIn("http://127.0.0.1:7860", plan[0]["argv"])
        d.CONFIG.fallback_tunnel_command = ["bore", "local", "127.0.0.1:{port}"]
        plan = d.build_tunnel_plan(7860)
        self.assertEqual([item["provider"] for item in plan], ["cloudflare", "custom"])
        self.assertEqual(plan[1]["argv"], ["bore", "local", "127.0.0.1:7860"])
        # 与契约 PROTOCOL.daemon.tunnelProviders 保持同序
        self.assertEqual(d.TUNNEL_PROVIDERS, ("cloudflare", "custom"))

    def test_restart_backoff_caps_at_60s(self) -> None:
        self.assertEqual(
            [d.tunnel_restart_delay(index) for index in range(1, 8)],
            [2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0],
        )
        self.assertEqual(d.tunnel_restart_delay(0), 2.0)
        self.assertEqual(d.tunnel_restart_delay(100), d.TUNNEL_RESTART_MAX_SEC)

    def test_should_stop_follows_shutdown(self) -> None:
        self.assertFalse(d.tunnel_should_stop())
        d.STATE.shutting_down = True
        self.assertTrue(d.tunnel_should_stop())
        d.STATE.shutting_down = False
        d.BOOT.stop_event.set()
        self.assertTrue(d.tunnel_should_stop())


class CloudflaredDownloadTest(DaemonUnitTest):
    """v0.9 M1：cloudflared 固定版本下载 + SHA256 校验（假 urlopen / 假响应流，不联网）。"""

    PAYLOAD = b"fake-cloudflared-binary-for-unit-test"
    URL_SENTINEL = "https://example.invalid/cloudflared-linux-amd64"

    def setUp(self) -> None:
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.target = os.path.join(self._tmp.name, "cloudflared")
        self.partial = self.target + ".part"
        self.payload_sha = hashlib.sha256(self.PAYLOAD).hexdigest()
        self.calls: list[str] = []

    def download(self, responses, expected_sha=None, max_bytes=None):  # noqa: ANN001, ANN202
        """在隔离的临时路径 / 校验和 / urlopen 下调用 ensure_cloudflared。

        替换的是 `TUNNEL.binary` 的字段（真实调用点每次读取），而不是 `daemon.CLOUDFLARED_*`
        常量——后者只是同一份数值的只读副本，改了不会影响下载路径（切片⑥d 的边界约定）。
        """
        binary = d.TUNNEL.binary
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(binary, "path", self.target))
            stack.enter_context(mock.patch.object(binary, "url", self.URL_SENTINEL))
            stack.enter_context(
                mock.patch.object(
                    binary, "sha256", self.payload_sha if expected_sha is None else expected_sha
                )
            )
            if max_bytes is not None:
                stack.enter_context(mock.patch.object(binary, "max_bytes", max_bytes))
            stack.enter_context(mock.patch.object(d.urllib.request, "urlopen", make_urlopen(responses, self.calls)))
            return d.ensure_cloudflared()

    def test_pinned_version_url_and_checksum_are_consistent(self) -> None:
        self.assertRegex(d.CLOUDFLARED_VERSION, r"^\d{4}\.\d{1,2}\.\d+$")
        self.assertIn(f"/releases/download/{d.CLOUDFLARED_VERSION}/", d.CLOUDFLARED_DOWNLOAD_URL)
        self.assertNotIn("/latest/", d.CLOUDFLARED_DOWNLOAD_URL, "不应再使用滚动 latest 地址")
        self.assertTrue(d.CLOUDFLARED_DOWNLOAD_URL.endswith("/cloudflared-linux-amd64"))
        self.assertRegex(d.CLOUDFLARED_SHA256, r"^[0-9a-f]{64}$")
        self.assertEqual(d.CLOUDFLARED_SHA256, d.CLOUDFLARED_SHA256.strip().lower())

    def test_download_success_verifies_and_installs(self) -> None:
        chmod_calls: list[tuple[str, int]] = []
        real_chmod = os.chmod

        def record_chmod(path, mode):  # noqa: ANN001
            chmod_calls.append((path, mode))
            real_chmod(path, mode)

        with mock.patch.object(d.os, "chmod", record_chmod):
            result = self.download([[self.PAYLOAD[:7], self.PAYLOAD[7:]]])
        self.assertEqual(result, self.target)
        self.assertEqual(Path(self.target).read_bytes(), self.PAYLOAD)
        self.assertFalse(os.path.exists(self.partial), "落位后不应残留 .part")
        self.assertEqual(chmod_calls, [(self.target, 0o755)])
        self.assertEqual(self.calls, [self.URL_SENTINEL])
        self.assertLogContains(f"cloudflared {d.CLOUDFLARED_VERSION} 就绪")
        self.assertLogContains("校验通过")

    def test_reuse_existing_executable_skips_download(self) -> None:
        Path(self.target).write_bytes(self.PAYLOAD)
        os.chmod(self.target, 0o755)
        result = self.download([])
        self.assertEqual(result, self.target)
        self.assertEqual(self.calls, [], "校验一致的已存在可执行文件不应再下载")
        self.assertLogContains("复用已存在的 /tmp/cloudflared")

    def test_reuse_existing_executable_redownloads_on_hash_mismatch(self) -> None:
        Path(self.target).write_bytes(b"corrupted-or-stale-binary")
        os.chmod(self.target, 0o755)
        result = self.download([[self.PAYLOAD]])
        self.assertEqual(result, self.target)
        self.assertEqual(Path(self.target).read_bytes(), self.PAYLOAD)
        self.assertEqual(self.calls, [self.URL_SENTINEL], "SHA256 不一致应删除重下")
        self.assertLogContains("WARN 已存在的 /tmp/cloudflared SHA256 校验失败")

    def test_checksum_mismatch_retries_once_then_raises(self) -> None:
        tampered = b"tampered-download"
        with self.assertRaises(RuntimeError) as ctx:
            self.download([[tampered], [tampered]])
        message = str(ctx.exception)
        self.assertIn("下载失败", message)
        self.assertIn("SHA256 校验失败", message)
        self.assertIn(self.payload_sha[:16], message, "异常应带期望校验和前缀")
        self.assertIn(hashlib.sha256(tampered).hexdigest()[:16], message, "异常应带实际校验和前缀")
        self.assertEqual(len(self.calls), 2, "校验不匹配应只重试一次")
        self.assertFalse(os.path.exists(self.partial))
        self.assertFalse(os.path.exists(self.target))
        self.assertLogContains("WARN cloudflared SHA256 校验失败")

    def test_download_error_retries_once_then_raises(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            self.download([OSError("network down"), OSError("network down")])
        message = str(ctx.exception)
        self.assertIn("下载失败", message)
        self.assertIn("下载异常", message)
        self.assertIn("network down", message)
        self.assertEqual(len(self.calls), 2)
        self.assertFalse(os.path.exists(self.partial))
        self.assertFalse(os.path.exists(self.target))
        self.assertLogContains("WARN cloudflared 下载异常")

    def test_retry_recovers_after_first_download_error(self) -> None:
        result = self.download([OSError("flaky network"), [self.PAYLOAD]])
        self.assertEqual(result, self.target)
        self.assertEqual(Path(self.target).read_bytes(), self.PAYLOAD)
        self.assertEqual(len(self.calls), 2)
        self.assertLogContains("（第 2/2 次）")

    def test_stream_break_cleans_partial_file(self) -> None:
        class BrokenResponse(FakeResponse):
            """读到第二块时抛连接中断，模拟传输半截。"""

            def read(self, size=-1):  # noqa: ANN001, ANN201
                if self._index >= 1:
                    raise ConnectionResetError("connection reset by peer")
                return super().read(size)

        with self.assertRaises(RuntimeError) as ctx:
            self.download([BrokenResponse([b"first-chunk"]), BrokenResponse([b"second-chunk"])])
        self.assertIn("connection reset by peer", str(ctx.exception))
        self.assertEqual(len(self.calls), 2)
        self.assertFalse(os.path.exists(self.partial), "传输中断后不应留下半截文件")
        self.assertFalse(os.path.exists(self.target))

    def test_size_cap_aborts_without_retry(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            self.download([[b"x" * 2048]], max_bytes=1024)
        message = str(ctx.exception)
        self.assertIn("下载失败", message)
        self.assertIn("大小上限", message)
        self.assertEqual(len(self.calls), 1, "超大小上限不是瞬时故障，不应重试")
        self.assertFalse(os.path.exists(self.partial))
        self.assertFalse(os.path.exists(self.target))

    def test_start_tunnel_surfaces_download_error(self) -> None:
        error = "cloudflared 2026.11.0 下载失败（2 次尝试均未成功）：下载异常：boom"
        with mock.patch.object(d.TUNNEL, "ensure_cloudflared", side_effect=RuntimeError(error)):
            result = d.start_tunnel(7860)
        self.assertIsNone(result)
        self.assertIn("cloudflared 下载失败：", d.BOOT.tunnel_error or "")
        self.assertIn("boom", d.BOOT.tunnel_error or "")


class TunnelDrainTest(DaemonUnitTest):
    """假 Popen / 假 stream 覆盖隧道输出读取与单通道尝试（不联网、不启动进程）。"""

    def test_drain_records_url_and_provider(self) -> None:
        event = threading.Event()
        proc = FakeProc(["[INF] Registered tunnel", "INF | https://abc-def.trycloudflare.com |"], code=0)
        d._drain_tunnel_output(proc, "cloudflare", d.CLOUDFLARED_URL_RE, event)
        self.assertTrue(event.is_set())
        self.assertEqual(d.BOOT.tunnel_url, "https://abc-def.trycloudflare.com")
        self.assertEqual(d.BOOT.tunnel_provider, "cloudflare")
        self.assertIsNone(d.BOOT.tunnel_error)
        self.assertLogContains("[cloudflared]")

    def test_drain_without_url_records_exit_code(self) -> None:
        event = threading.Event()
        proc = FakeProc(["failed to connect"], code=3)
        d._drain_tunnel_output(proc, "custom", d.DEFAULT_CUSTOM_URL_RE, event)
        self.assertTrue(event.is_set())
        self.assertIsNone(d.BOOT.tunnel_url)
        self.assertIn("退出码 3", d.BOOT.tunnel_error or "")
        self.assertLogContains("tunnel:custom")

    def test_drain_reads_stdout_for_custom_channel(self) -> None:
        """自建通道常把地址打在 stdout：合并流后仍要能读到。"""

        class StdoutOnlyProc:
            def __init__(self) -> None:
                self.stdout = iter(["listening at https://bore.example.com"])
                self.stderr = None

            def poll(self):  # noqa: ANN201
                return 0

        event = threading.Event()
        d._drain_tunnel_output(StdoutOnlyProc(), "custom", d.DEFAULT_CUSTOM_URL_RE, event)
        self.assertTrue(event.is_set())
        self.assertEqual(d.BOOT.tunnel_url, "https://bore.example.com")
        self.assertEqual(d.BOOT.tunnel_provider, "custom")

    def test_spawn_merges_streams_for_custom_channel(self) -> None:
        captured: dict = {}

        class PopenRecorder:
            def __init__(self, argv, **kwargs) -> None:  # noqa: ANN001
                captured.update(kwargs)

        with mock.patch.object(d.subprocess, "Popen", PopenRecorder):
            proc = d._spawn_tunnel_process(["bore"], "custom")
        self.assertIsInstance(proc, PopenRecorder)
        self.assertIs(captured.get("stdout"), d.subprocess.PIPE)
        self.assertIs(captured.get("stderr"), d.subprocess.STDOUT)

    def test_spawn_keeps_cloudflared_stderr(self) -> None:
        captured: dict = {}

        class PopenRecorder:
            def __init__(self, argv, **kwargs) -> None:  # noqa: ANN001
                captured.update(kwargs)

        with mock.patch.object(d.subprocess, "Popen", PopenRecorder):
            d._spawn_tunnel_process(["cloudflared"], "cloudflare")
        self.assertIs(captured.get("stdout"), d.subprocess.DEVNULL)
        self.assertIs(captured.get("stderr"), d.subprocess.PIPE)

    def test_attempt_success_returns_provider_and_proc(self) -> None:
        proc = FakeProc(["https://x1.trycloudflare.com"], code=0)
        item = {"provider": "cloudflare", "argv": ["cloudflared"], "url_re": d.CLOUDFLARED_URL_RE, "wait_sec": 2.0}
        with mock.patch.object(d.TUNNEL, "spawn", return_value=proc):
            result = d.tunnel_attempt(item)
        self.assertEqual(result, ("cloudflare", proc))
        self.assertEqual(d.BOOT.tunnel_url, "https://x1.trycloudflare.com")

    def test_attempt_failure_terminates_process(self) -> None:
        proc = FakeProc(["boom"], code=2)
        item = {"provider": "custom", "argv": ["bore"], "url_re": d.DEFAULT_CUSTOM_URL_RE, "wait_sec": 0.2}
        with mock.patch.object(d.TUNNEL, "spawn", return_value=proc):
            result = d.tunnel_attempt(item)
        self.assertIsNone(result)
        self.assertTrue(proc.terminated)
        self.assertIn("未给出隧道地址", d.BOOT.tunnel_error or "")

    def test_attempt_empty_command(self) -> None:
        self.assertIsNone(d.tunnel_attempt({"provider": "custom", "argv": []}))
        self.assertLogContains("通道命令为空")

    def test_terminate_process_tolerates_errors(self) -> None:
        class StubbornProc:
            def __init__(self) -> None:
                self.killed = False

            def terminate(self) -> None:
                raise OSError("nope")

            def wait(self, timeout=None):  # noqa: ANN001
                raise TimeoutError("still alive")

            def kill(self) -> None:
                self.killed = True

        proc = StubbornProc()
        d.terminate_tunnel_process(proc)
        self.assertTrue(proc.killed)

    def test_start_tunnel_falls_back_to_custom(self) -> None:
        d.CONFIG.fallback_tunnel_command = ["bore", "local", "127.0.0.1:{port}"]
        proc = FakeProc(["listening at https://bore.example.com"], code=0)
        with mock.patch.object(d.TUNNEL, "ensure_cloudflared", side_effect=RuntimeError("download blocked")), mock.patch.object(
            d.TUNNEL, "spawn", return_value=proc
        ):
            result = d.start_tunnel(7860)
        self.assertEqual(result[0], "custom")
        self.assertEqual(d.BOOT.tunnel_provider, "custom")
        self.assertEqual(d.BOOT.tunnel_url, "https://bore.example.com")
        self.assertLogContains("尝试下一个通道")


class TunnelMonitorTest(DaemonUnitTest):
    """常驻监管：失败退避重拉、中途退出重播 ready、/shutdown 停止。"""

    def test_health_reports_tunnel_fields(self) -> None:
        payload = d.health_payload()
        self.assertIsNone(payload["tunnel_provider"])
        self.assertEqual(payload["tunnel_state"], "starting")
        self.assertEqual(payload["tunnel_restarts"], 0)
        d.BOOT.tunnel_provider = "custom"
        d.BOOT.tunnel_state = "up"
        d.BOOT.tunnel_restarts = 2
        payload = d.health_payload()
        self.assertEqual(payload["tunnel_provider"], "custom")
        self.assertEqual(payload["tunnel_state"], "up")
        self.assertEqual(payload["tunnel_restarts"], 2)

    def test_publish_ready_includes_provider(self) -> None:
        published: list[dict] = []
        d.BOOT.tunnel_url = "https://abc.trycloudflare.com"
        d.BOOT.tunnel_provider = "cloudflare"
        d.STATE.model_id = "sdxl:org/base"
        d.STATE.device = "Tesla T4"
        with mock.patch.object(d, "ntfy_publish", side_effect=lambda payload, _label: published.append(payload) or True):
            d.publish_ready()
        self.assertEqual(published[0]["type"], "ready")
        self.assertEqual(published[0]["endpoint"], "https://abc.trycloudflare.com")
        self.assertEqual(published[0]["provider"], "cloudflare")

    def test_announce_recovers_tunnel_error_phase(self) -> None:
        published: list[dict] = []
        d.STATE.phase = "error"
        d.STATE.detail = "隧道失败"
        d.STATE.last_error = "tunnel_failed: 超时"
        d.STATE.last_error_code = "tunnel_failed"
        d.BOOT.phase_before_error = "ready"
        d.BOOT.tunnel_url = "https://new.trycloudflare.com"
        with mock.patch.object(d, "ntfy_publish", side_effect=lambda payload, _label: published.append(payload) or True):
            d.announce_tunnel_ready("cloudflare", restarted=True)
        self.assertEqual(d.STATE.phase, "ready")
        self.assertIsNone(d.STATE.last_error)
        self.assertIsNone(d.STATE.last_error_code)
        self.assertTrue(d.BOOT.published_ready)
        self.assertEqual(d.BOOT.tunnel_state, "up")
        self.assertEqual(d.BOOT.tunnel_provider, "cloudflare")
        self.assertEqual(published[0]["provider"], "cloudflare")
        self.assertLogContains("重连后重播 ready")

    def test_recover_clears_leftover_error_without_touching_ready_phase(self) -> None:
        # runtime_boot 可能已经把 phase 覆盖成 ready，但 last_error 仍残留 tunnel_failed。
        d.STATE.phase = "ready"
        d.STATE.last_error = "tunnel_failed: 超时"
        d.STATE.last_error_code = "tunnel_failed"
        d.recover_tunnel_error()
        self.assertEqual(d.STATE.phase, "ready")
        self.assertIsNone(d.STATE.last_error)
        self.assertIsNone(d.STATE.last_error_code)
        self.assertLogContains("清除残留错误记录")

    def test_request_shutdown_stops_monitor(self) -> None:
        d.request_shutdown()
        self.assertTrue(d.STATE.shutting_down)
        self.assertTrue(d.BOOT.stop_event.is_set())
        self.assertTrue(d.tunnel_should_stop())
        self.assertLogContains("收到 /shutdown")

    def test_monitor_retries_after_initial_failure_and_recovers(self) -> None:
        d.CONFIG.fallback_tunnel_command = ["bore", "local", "127.0.0.1:{port}"]
        proc = FakeProc([], code=0)
        published: list[bool] = []
        outcomes = [None, ("custom", proc)]

        def fake_wait(_proc):
            d.BOOT.stop_event.set()
            return 7

        with mock.patch.object(d.TUNNEL, "start", side_effect=lambda _port: outcomes.pop(0)), mock.patch.object(
            d.TUNNEL, "restart_delay", return_value=0.001
        ), mock.patch.object(d.TUNNEL, "wait_exit", side_effect=fake_wait), mock.patch.object(
            d, "publish_ready", side_effect=lambda: published.append(True)
        ):
            d.tunnel_monitor(7860)
        self.assertEqual(d.BOOT.tunnel_restarts, 1)
        self.assertEqual(published, [True])
        self.assertNotEqual(d.STATE.phase, "error", "隧道恢复后不应停在 error")
        self.assertIsNone(d.STATE.last_error)
        self.assertTrue(d.BOOT.published_ready)
        self.assertEqual(d.BOOT.tunnel_state, "up")
        self.assertLogContains("累计重启 1 次")

    def test_monitor_exits_immediately_when_shutting_down(self) -> None:
        d.STATE.shutting_down = True
        with mock.patch.object(d.TUNNEL, "start", side_effect=AssertionError("不应尝试启动隧道")):
            d.tunnel_monitor(7860)
        self.assertEqual(d.BOOT.tunnel_restarts, 0)

    def test_monitor_relaunches_after_process_exit(self) -> None:
        d.CONFIG.fallback_tunnel_command = ["bore", "local", "127.0.0.1:{port}"]
        outcomes = [("custom", FakeProc([], code=0)), ("custom", FakeProc([], code=0))]
        published: list[bool] = []
        waits: list[object] = []

        def fake_wait(proc):
            waits.append(proc)
            if len(waits) == 1:
                return 9  # 第一次进程中途异常退出
            d.BOOT.stop_event.set()
            return 0

        d.STATE.phase = "ready"
        with mock.patch.object(d.TUNNEL, "start", side_effect=lambda _port: outcomes.pop(0)), mock.patch.object(
            d.TUNNEL, "restart_delay", return_value=0.001
        ), mock.patch.object(d.TUNNEL, "wait_exit", side_effect=fake_wait), mock.patch.object(
            d, "publish_ready", side_effect=lambda: published.append(True)
        ):
            d.tunnel_monitor(7860)
        self.assertEqual(d.STATE.phase, "ready", "隧道中途退出不应把 daemon 判成 error")
        self.assertEqual(len(published), 2, "每次隧道就绪都应重播 ready")
        self.assertEqual(d.BOOT.tunnel_restarts, 1)
        self.assertLogContains("进程退出（退出码 9）")


if __name__ == "__main__":
    import unittest

    unittest.main()
