"""启动后等待 Host 接管的 claim 看门狗。

覆盖三块：配置键 claim_timeout_sec 的默认 / 自定义 / 非法回落；带正确 Bearer Token 的
请求置位 claim_event；无人接管时超时退出（退出码 0）且与空闲 / 信号退出路径收敛成一次退出。

设计约定：看门狗挂在 remote/app.py 的 ``DaemonApp._main_loop``，事件挂在 ``BootState``，
置位入口是 ``transport/http_server.py`` 的 ``_require_auth``（任何鉴权通过的请求都算接管）。

运行：python test/remote/test_claim.py
"""

from __future__ import annotations

import threading
import types
from unittest import mock

from support import AUTH_TOKEN, DaemonUnitTest, d, make_handler, remote_app, remote_config


class ClaimConfigTest(DaemonUnitTest):
    """claim_timeout_sec 的注入解析：默认 600，非法值回落默认并留 WARN。"""

    def test_default_is_600_seconds(self) -> None:
        # 与 shared/contract.js 的 TIMEOUTS.kernelClaimSec 同值（Python 侧无生成物，钉常量）。
        self.assertEqual(d.DaemonConfig().claim_timeout_sec, 600)
        self.assertEqual(remote_config.DEFAULT_CLAIM_TIMEOUT_SEC, 600)
        self.assertEqual(d._build_config({}).claim_timeout_sec, 600)

    def test_key_is_registered(self) -> None:
        # 键表就是 dataclass 字段名：漏登记会被当成未知键告警后静默丢弃。
        self.assertIn("claim_timeout_sec", d._KNOWN_CONFIG_KEYS)
        self.assertIn("claim_timeout_sec", d.DaemonConfig.__dataclass_fields__)

    def test_custom_value_is_used(self) -> None:
        config = d._build_config({"auth_token": "tok", "claim_timeout_sec": 120})
        self.assertEqual(config.claim_timeout_sec, 120)
        self.assertLogContains("claim_timeout=120s")

    def test_invalid_values_fall_back_with_warning(self) -> None:
        for bad in ("abc", 0, -5, True, 600.5, [600]):
            config = d._build_config({"claim_timeout_sec": bad})
            self.assertEqual(config.claim_timeout_sec, 600, f"应回落默认：{bad!r}")

    def test_invalid_value_logs_one_warning(self) -> None:
        d._build_config({"claim_timeout_sec": "not-a-number"})
        self.assertLogContains("WARN claim_timeout_sec 需为正整数秒")
        self.assertLogContains("回落默认 600s")

    def test_absent_key_uses_default_without_warning(self) -> None:
        # 旧 Host 不下发是正常兼容路径，不能打 WARN（否则每个旧会话都多一条误报）。
        d._build_config({"auth_token": "tok"})
        self.assertNotIn("claim_timeout_sec 需为", self.logs())
        self.assertLogContains("claim_timeout=600s")


class ClaimEventTest(DaemonUnitTest):
    """任何鉴权通过的 Host 请求都置位 claim_event（幂等、只打一条接管日志）。"""

    def test_correct_bearer_token_marks_claimed(self) -> None:
        d.CONFIG.auth_token = AUTH_TOKEN
        handler, sent = make_handler(f"Bearer {AUTH_TOKEN}")
        self.assertTrue(handler._require_auth())
        self.assertEqual(sent, [])
        self.assertTrue(d.BOOT.claim_event.is_set())
        self.assertLogContains("[claim] Host 已接管")

    def test_wrong_or_missing_token_does_not_claim(self) -> None:
        d.CONFIG.auth_token = AUTH_TOKEN
        for header in ("Bearer wrong", AUTH_TOKEN, "Basic abc", None):
            handler, _ = make_handler(header)
            self.assertFalse(handler._require_auth(), header)
        self.assertFalse(d.BOOT.claim_event.is_set())

    def test_allow_no_auth_local_debug_still_claims(self) -> None:
        # 本地调试没有 Token 可比，但请求确实到达了鉴权后的接口：同样取消看门狗，
        # 否则调试中的进程会在 claim_timeout_sec 后自行退出。
        d.CONFIG.allow_no_auth = True
        handler, _ = make_handler()
        self.assertTrue(handler._require_auth())
        self.assertTrue(d.BOOT.claim_event.is_set())

    def test_mark_claimed_is_idempotent_and_logs_once(self) -> None:
        self.assertTrue(callable(d.HTTP_API.mark_claimed))
        d.HTTP_API.mark_claimed()
        d.HTTP_API.mark_claimed()
        d.mark_claimed()
        self.assertTrue(d.BOOT.claim_event.is_set())
        self.assertEqual(self.logs().count("[claim] Host 已接管"), 1)


class ClaimWatchdogTest(DaemonUnitTest):
    """DaemonApp 主循环里的看门狗：超时退出、claim 后取消、与其它退出路径只退一次。"""

    def _make_app(
        self,
        *,
        claim_timeout_sec: int = 600,
        claimed: bool = False,
        last_active: float = 0.0,
        clock=None,
    ):
        events: list[str] = []
        cleanup_calls: list[bool] = []

        boot = types.SimpleNamespace(
            stop_event=threading.Event(),
            claim_event=threading.Event(),
            tunnel_url=None,
            tunnel_provider=None,
            published_ready=False,
        )
        if claimed:
            boot.claim_event.set()
        state = types.SimpleNamespace(
            started_at=0.0, last_active=last_active, phase="booting", jobs_done=0
        )

        def cleanup() -> None:
            # 与真实 _cleanup_before_exit 一样：重复调用只生效一次（_CLEANUP_LOCK 闸门）。
            if not cleanup_calls:
                cleanup_calls.append(True)
                events.append("cleanup")

        app = remote_app.DaemonApp(
            config=types.SimpleNamespace(
                port=7860,
                idle_timeout_sec=1800,
                claim_timeout_sec=claim_timeout_sec,
            ),
            state=state,
            boot=boot,
            state_lock=threading.RLock(),
            boot_lock=threading.RLock(),
            gen_lock=threading.Lock(),
            load_config=lambda: None,
            apply_hf_token=lambda: False,
            auth_missing=lambda: False,
            protocol_version=lambda: "0.0.0-test",
            install_stream_tee=lambda: None,
            install_dependencies=lambda: None,
            ensure_pipeline=lambda spec: (object(), 0.0),
            classify_failure=lambda exc, default="generation_failed": (default, str(exc)),
            free_cuda_cache=lambda: None,
            set_phase=lambda phase, detail=None: None,
            fail_boot=lambda code, message: events.append(f"fail:{code}"),
            publish_ready=lambda: None,
            active_job_count=lambda: 0,
            queue_depth=lambda: 0,
            start_http_server=lambda port: None,
            start_job_worker=lambda: None,
            tunnel_monitor=lambda port: None,
            cleanup_before_exit=cleanup,
            announce_interval_sec=300,
            poll_interval_sec=0.01,
            report_interval_sec=30,
            exit_fn=lambda code: events.append(f"exit:{code}"),
            clock=clock or (lambda: 601.0),
            thread_factory=lambda target, name: None,
        )
        return app, boot, state, events

    @staticmethod
    def _stop_after_rounds(boot, rounds: int = 2, now: float = 700.0):
        """假时钟：第 ``rounds`` 次取样时置 stop_event，让主循环有限次后返回。"""
        calls = {"n": 0}

        def clock() -> float:
            calls["n"] += 1
            if calls["n"] >= rounds:
                boot.stop_event.set()
            return now

        return clock

    def test_timeout_without_claim_exits_zero_after_cleanup(self) -> None:
        app, _, _, events = self._make_app(clock=lambda: 601.0)
        app._main_loop()
        self.assertEqual(events, ["cleanup", "exit:0"])
        self.assertLogContains("[claim]")
        self.assertLogContains("claim_timeout=600s")
        self.assertLogContains("未收到任何带 Token 的 Host 请求")

    def test_claimed_host_cancels_the_watchdog(self) -> None:
        app, boot, _, events = self._make_app(claimed=True, last_active=10000.0)
        app._clock = self._stop_after_rounds(boot, now=10000.0)
        app._main_loop()
        self.assertEqual(events, [])
        self.assertNotIn("[claim]", self.logs())

    def test_claim_after_some_seconds_still_cancels(self) -> None:
        """正常会话：Host 数秒内 /health 接管；即使之后空闲很久也不该被 claim 看门狗杀。"""
        app, boot, _, events = self._make_app(claimed=True, last_active=5000.0)
        app._clock = self._stop_after_rounds(boot, rounds=3, now=5000.0)
        app._main_loop()
        self.assertEqual(events, [])

    def test_zero_timeout_disables_the_watchdog(self) -> None:
        app, boot, _, events = self._make_app(claim_timeout_sec=0, last_active=10000.0)
        app._clock = self._stop_after_rounds(boot, now=10000.0)
        app._main_loop()
        self.assertEqual(events, [])

    def test_idle_watchdog_still_works_when_claim_disabled(self) -> None:
        app, _, state, events = self._make_app(claim_timeout_sec=0, clock=lambda: 1000.0)
        app._config.idle_timeout_sec = 10
        state.phase = "ready"  # bootstrapping 阶段不参与空闲退出，这里要看 idle 路径本身
        state.last_active = 0.0
        app._main_loop()
        self.assertEqual(events, ["cleanup", "exit:0"])
        self.assertLogContains("[idle]")

    def test_exit_gate_converges_repeated_terminations(self) -> None:
        app, _, _, events = self._make_app()
        app._terminate(0)
        app._terminate(1)
        app._terminate(0)
        self.assertEqual(events, ["exit:0"])

    def test_claim_timeout_after_another_path_already_exited_does_not_double_exit(self) -> None:
        """与信号 / 空闲路径的竞态：清理各做一次、exit_fn 只落一次。"""
        app, _, _, events = self._make_app(clock=lambda: 601.0)
        app._terminate(0)  # 另一条路径先退出（例如信号）
        app._main_loop()  # claim 看门狗随后到点
        self.assertEqual(events, ["exit:0", "cleanup"])
        self.assertEqual(sum(1 for item in events if item.startswith("exit:")), 1)

    def test_signal_and_claim_paths_share_the_exit_gate(self) -> None:
        app, _, _, events = self._make_app()
        handlers: list = []
        with mock.patch("signal.signal", side_effect=lambda signum, handler: handlers.append(handler)):
            app.install_signal_handlers()
        self.assertTrue(handlers, "应安装 SIGTERM / SIGINT 处理器")
        for handler in handlers:
            handler(15, None)
        self.assertEqual(events, ["cleanup", "exit:0"])
        self.assertLogContains("[signal]")


if __name__ == "__main__":
    import unittest

    unittest.main()
