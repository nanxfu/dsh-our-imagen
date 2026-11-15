"""进程生命周期与启动失败。

DaemonApp 启动顺序与两条退出路径、fail_boot 的唯一出口、无 GPU 的 gpu_unavailable 归因。

拆分自 test/daemon-unit.py，运行：python test/remote/test_lifecycle.py
"""

from __future__ import annotations

import ast
import sys
import threading
import types
from unittest import mock

from support import DaemonUnitTest, ROOT, d, remote_app


class AppLifecycleBoundaryTest(DaemonUnitTest):
    """切片⑥：启动顺序 / 信号 / 看门狗搬进 remote/app.py，daemon 只做装配。"""

    def _make_app(self, *, auth_missing: bool = False, http_error: Exception | None = None):
        events: list[str] = []
        boot = types.SimpleNamespace(
            stop_event=threading.Event(),
            tunnel_url=None,
            tunnel_provider=None,
            published_ready=False,
            tunnel_state="",
            http_server=None,
        )
        # 预置停止信号：启动步骤照跑，主循环第一轮就退出（不真起隧道与运行时线程）。
        boot.stop_event.set()
        state = types.SimpleNamespace(started_at=0.0, last_active=0.0, phase="booting", jobs_done=0)

        def fake_http(port: int) -> None:
            events.append(f"http:{port}")
            if http_error is not None:
                raise http_error

        app = remote_app.DaemonApp(
            config=types.SimpleNamespace(port=7860, idle_timeout_sec=1800, preload=None),
            state=state,
            boot=boot,
            state_lock=threading.RLock(),
            boot_lock=threading.RLock(),
            gen_lock=threading.Lock(),
            load_config=lambda: events.append("load_config"),
            apply_hf_token=lambda: events.append("hf_token"),
            auth_missing=lambda: auth_missing,
            protocol_version=lambda: "0.0.0-test",
            install_stream_tee=lambda: events.append("tee"),
            install_dependencies=lambda: events.append("install"),
            ensure_pipeline=lambda spec: (object(), 0.0),
            classify_failure=lambda exc, default="generation_failed": (default, str(exc)),
            free_cuda_cache=lambda: None,
            set_phase=lambda phase, detail=None: events.append(f"phase:{phase}"),
            fail_boot=lambda code, message: events.append(f"fail:{code}"),
            publish_ready=lambda: events.append("ready"),
            active_job_count=lambda: 0,
            queue_depth=lambda: 0,
            start_http_server=fake_http,
            start_job_worker=lambda: events.append("worker"),
            tunnel_monitor=lambda port: events.append(f"tunnel:{port}"),
            cleanup_before_exit=lambda: events.append("cleanup"),
            announce_interval_sec=300,
            exit_fn=lambda code: events.append(f"exit:{code}"),
            thread_factory=lambda target, name: events.append(f"thread:{name}"),
        )
        # 信号处理器会改进程级 signal 表；单测只记录不安装。
        app.install_signal_handlers = lambda: events.append("signals")
        return app, events

    def test_boot_order_puts_http_before_tunnel_and_runtime(self) -> None:
        """HTTP 必须先起（装依赖期间 /health 仍可用），隧道与运行时各自后台跑。"""
        app, events = self._make_app()
        app.run()
        self.assertEqual(
            events,
            [
                "tee",
                "signals",
                "load_config",
                "hf_token",
                "http:7860",
                "worker",
                "thread:tunnel-monitor",
                "thread:runtime-boot",
                "cleanup",
            ],
        )

    def test_unauthorized_boot_exits_before_serving(self) -> None:
        app, events = self._make_app(auth_missing=True)
        app.run()
        self.assertIn("fail:unauthorized", events)
        self.assertEqual(events[-1], "exit:4")
        self.assertFalse(
            [item for item in events if item.startswith(("http:", "worker", "thread:"))],
            "无鉴权配置下不得开端口、不得起 worker",
        )

    def test_port_conflict_exits_with_code_3(self) -> None:
        app, events = self._make_app(http_error=OSError("address already in use"))
        app.run()
        self.assertEqual(events[-1], "exit:3")
        self.assertNotIn("worker", events)
        self.assertLogContains("监听失败")

    def test_daemon_exposes_the_composed_app(self) -> None:
        self.assertIsInstance(d.APP, remote_app.DaemonApp)
        self.assertIs(d.runtime_boot.__self__, d.APP)
        self.assertIs(d.tunnel_boot.__self__, d.APP)
        self.assertIs(d.main.__self__, d.APP)
        self.assertIs(d.GPU_UNAVAILABLE_MESSAGE, remote_app.GPU_UNAVAILABLE_MESSAGE)

    def test_app_never_imports_the_entry_module(self) -> None:
        """app.py 只接受注入：反向 import daemon 会成环，也把依赖来源藏进 import 语句。

        用 AST 看真正的 import 语句，而不是在源码里找字符串——模块头的说明文字里就写着
        「不 import daemon」，按字符串匹配会把文档当成违规。
        """
        tree = ast.parse((ROOT / "remote" / "app.py").read_text(encoding="utf-8"))
        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                modules.append(node.module or "")
        self.assertFalse([name for name in modules if "daemon" in name], modules)


class FailBootTest(DaemonUnitTest):
    def test_sets_error_state(self) -> None:
        d.fail_boot("load_failed", "pip install 失败")
        self.assertEqual(d.STATE.phase, "error")
        self.assertEqual(d.STATE.detail, "pip install 失败")
        self.assertEqual(d.STATE.last_error_code, "load_failed")
        self.assertEqual(d.STATE.last_error, "load_failed: pip install 失败")
        self.assertFalse(d.BOOT.published_ready)
        self.assertIsNone(d.BOOT.tunnel_error)
        # 未配置 ntfy topic 时只记日志，不联网
        self.assertLogContains("未配置 topic")

    def test_tunnel_failure_records_reason(self) -> None:
        d.fail_boot("tunnel_failed", "cloudflared 未给出 trycloudflare 地址", tunnel=True)
        self.assertEqual(d.BOOT.tunnel_error, "cloudflared 未给出 trycloudflare 地址")
        self.assertEqual(d.STATE.phase, "error")
        self.assertEqual(d.STATE.last_error_code, "tunnel_failed")

    def test_unauthorized_boot_uses_contract_code(self) -> None:
        self.contract_config()
        d.fail_boot("unauthorized", "未配置 auth_token")
        self.assertEqual(d.STATE.last_error_code, "unauthorized")
        self.assertEqual(d.STATE.phase, "error")


class GpuUnavailableBootTest(DaemonUnitTest):
    """M3.3：CPU 容器必须立刻给出可执行报错码与文案，而不是继续硬跑。"""

    @staticmethod
    def fake_cpu_torch():
        return types.SimpleNamespace(
            __version__="2.8.0+cpu",
            version=types.SimpleNamespace(cuda=None),
            cuda=types.SimpleNamespace(is_available=lambda: False, device_count=lambda: 0),
        )

    def test_reports_gpu_unavailable_code_and_actionable_message(self) -> None:
        published: list[dict] = []
        with mock.patch.dict(sys.modules, {"torch": self.fake_cpu_torch()}), mock.patch.object(
            d, "ntfy_publish", side_effect=lambda payload, _label: published.append(payload) or True
        ):
            d.runtime_boot()
        self.assertEqual(d.STATE.phase, "error")
        self.assertEqual(d.STATE.last_error_code, "gpu_unavailable")
        self.assertIsNone(d.STATE.device)
        self.assertEqual(d.STATE.device_count, 0)
        detail = d.STATE.detail or ""
        self.assertIn("未检测到可用 GPU", detail)
        self.assertIn("手机号验证", detail)
        self.assertIn("GPU 加速器", detail)
        # /health 要把码透传给 Host（前端专用指引卡按 code 分支）。
        health = d.health_payload()
        self.assertEqual(health["status"], "error")
        self.assertEqual(health["phase"], "error")
        self.assertEqual(health["last_error_code"], "gpu_unavailable")
        self.assertIn("手机号验证", health["last_error"] or "")
        # ntfy error 事件同样带码，Host 会据此把错误写进会话。
        errors = [item for item in published if item.get("type") == "error"]
        self.assertEqual(len(errors), 1, published)
        self.assertEqual(errors[0]["code"], "gpu_unavailable")
        self.assertIn("GPU 加速器", errors[0]["message"])

    def test_gpu_available_keeps_boot_going(self) -> None:
        calls: list[str] = []

        def fake_install() -> None:
            calls.append("install")

        def fake_preload(_spec):  # noqa: ANN001
            calls.append("preload")
            return (object(), 0.0)

        torch_module = types.SimpleNamespace(
            __version__="2.8.0+cu128",
            version=types.SimpleNamespace(cuda="12.8"),
            cuda=types.SimpleNamespace(
                is_available=lambda: True,
                get_device_name=lambda _index: "Tesla T4",
                device_count=lambda: 2,
            ),
        )
        d.CONFIG.preload = {"loader": "sdxl", "base": "org/base"}
        with mock.patch.dict(sys.modules, {"torch": torch_module}), mock.patch.object(
            d, "install_dependencies", side_effect=fake_install
        ), mock.patch.object(d, "ensure_pipeline", side_effect=fake_preload):
            d.runtime_boot()
        self.assertEqual(d.STATE.phase, "ready")
        self.assertIsNone(d.STATE.last_error_code)
        self.assertEqual(d.STATE.device, "Tesla T4")
        self.assertEqual(d.STATE.device_count, 2)
        self.assertEqual(calls, ["install", "preload"])

    def test_torch_import_failure_stays_load_failed(self) -> None:
        # torch 都导入不了时无法断言「账号没开 GPU」，不能误报成 gpu_unavailable。
        d.CONFIG.ntfy_topic = ""
        with mock.patch.dict(sys.modules, {"torch": None}):
            d.runtime_boot()
        self.assertEqual(d.STATE.phase, "error")
        self.assertEqual(d.STATE.last_error_code, "load_failed")
        self.assertIn("无法确认 GPU 可用性", d.STATE.detail or "")


if __name__ == "__main__":
    import unittest

    unittest.main()
