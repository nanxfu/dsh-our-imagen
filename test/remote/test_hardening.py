"""冷启动加固回归。

历史故障的回归护栏（退出清理幂等、环境变量与敏感值不落日志等）。

拆分自 test/daemon-unit.py，运行：python test/remote/test_hardening.py
"""

from __future__ import annotations

import io
import os
import tempfile
import threading
import types
from unittest import mock
from pathlib import Path

from support import DaemonUnitTest, d, make_generate_handler, make_spec


class HardeningRegressionTest(DaemonUnitTest):
    """P0/P1/P2/P3 加固回归测试：输入校验、队列上限、切模型清理、隧道令牌、资源回收与停机清理。"""

    def test_negative_prompt_type_and_length_enforced(self) -> None:
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(make_spec([{"prompt": "p", "negative_prompt": 123}]))
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(make_spec([{"prompt": "p", "negative_prompt": "x" * 1001}]))
        _, _, tasks, _ = d.validate_generate_spec(make_spec([{"prompt": "p", "negative_prompt": "  bad hands  "}]))
        self.assertEqual(tasks[0]["negative_prompt"], "bad hands")

    def test_bool_and_non_finite_numeric_params_rejected(self) -> None:
        for bad_task in (
            {"prompt": "p", "cfg": True},
            {"prompt": "p", "cfg": float("nan")},
            {"prompt": "p", "cfg": float("inf")},
            {"prompt": "p", "width": True},
            {"prompt": "p", "steps": False},
            {"prompt": "p", "seed": True},
        ):
            with self.assertRaises(d.RequestError, msg=f"应拒绝 {bad_task}"):
                d.validate_generate_spec(make_spec([bad_task]))

    def test_pipeline_base_format_validation(self) -> None:
        for valid_base in ("org/model", "black-forest-labs/FLUX.2-klein-4B", "/kaggle/input/sdxl-model"):
            _, model_id, _, _ = d.validate_generate_spec(
                {"pipeline": {"loader": "sdxl", "base": valid_base}, "tasks": [{"prompt": "p"}]}
            )
            self.assertEqual(model_id, valid_base)
        for bad_base in ("single", "http://evil.com/m", "../etc/passwd", "/kaggle/../etc", "org/a..b"):
            with self.assertRaises(d.RequestError, msg=f"应拒绝 pipeline.base={bad_base!r}"):
                d.validate_generate_spec(
                    {"pipeline": {"loader": "sdxl", "base": bad_base}, "tasks": [{"prompt": "p"}]}
                )

    def test_queue_full_returns_429_and_keeps_idempotency(self) -> None:
        d.STATE.phase = "ready"
        d.CONFIG.contract = {"limits": {"queue": {"maxPending": 2}}}
        for idx in range(2):
            handler, sent = make_generate_handler(dict(make_spec([{"prompt": f"p{idx}"}]), jobId=f"q-{idx}"))
            d.DaemonHandler._handle_generate(handler)
            self.assertEqual(sent[0][0], 202)
        # 队列已满：新 jobId 返回 429 queue_full
        handler, sent = make_generate_handler(dict(make_spec([{"prompt": "overflow"}]), jobId="q-overflow"))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 429)
        self.assertEqual(sent[0][1]["error"]["code"], "queue_full")
        # 队列已满时，既有幂等键仍可直接命中返回 202
        handler, sent = make_generate_handler(dict(make_spec([{"prompt": "p0"}]), jobId="q-0"))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 202)
        self.assertEqual(sent[0][1]["job_id"], "q-0")

    def test_runtime_model_switch_loading_allows_queue_when_booted(self) -> None:
        d.STATE.phase = "loading"
        d.STATE.booted = False
        handler, sent = make_generate_handler(make_spec([{"prompt": "p"}]))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 503)
        self.assertEqual(sent[0][1]["error"]["code"], "warming")

        d.STATE.booted = True
        handler, sent = make_generate_handler(make_spec([{"prompt": "p"}]))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 202)

    def test_failed_model_switch_clears_stale_model_id_and_frees_cache(self) -> None:
        d.STATE.pipe = object()
        d.STATE.pipeline_key = "old-key"
        d.STATE.model_id = "org/old-model"
        d.STATE.loaded = ["sdxl:org/old-model"]
        d.STATE.sig_params = {"prompt"}
        d.STATE.phase = "ready"
        freed: list[bool] = []
        with mock.patch.object(d.CACHE, "ensure_cache_capacity"), mock.patch.object(
            d, "build_pipeline", side_effect=d.LoadError("boom")
        ), mock.patch.object(d, "free_cuda_cache", side_effect=lambda: freed.append(True)):
            with self.assertRaises(d.LoadError):
                d.ensure_pipeline({"loader": "sdxl", "base": "org/new-model"})
        self.assertIsNone(d.STATE.pipe)
        self.assertIsNone(d.STATE.model_id)
        self.assertEqual(d.STATE.loaded, [])
        self.assertEqual(d.STATE.sig_params, set())
        self.assertEqual(d.STATE.phase, "ready")
        self.assertGreaterEqual(len(freed), 1)

    def test_anima_local_assets_rejects_vae_subfolder_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "vae-repo"
            (root / "secret").mkdir(parents=True)
            (root / "secret" / "config.json").write_text("{}", encoding="utf-8")
            d.CONFIG.local_models = {"Qwen/Qwen-Image": str(root)}
            assets = d.CACHE.anima_local_assets(
                {
                    "loader": "anima",
                    "base": "org/anima",
                    "vae": {"repo": "Qwen/Qwen-Image", "subfolder": "../vae-repo/secret"},
                }
            )
            self.assertNotIn("vae", assets)
            self.assertLogContains("非法 vae.subfolder")

    def test_inactive_tunnel_attempt_cannot_overwrite_newer_boot_state(self) -> None:
        stale = d._TunnelAttempt(provider="cloudflare", active=False)
        current = d._TunnelAttempt(provider="custom", active=True)
        d.BOOT.current_attempt = current
        d.BOOT.tunnel_url = "https://new-tunnel.example"
        d.BOOT.tunnel_provider = "custom"
        d.BOOT.tunnel_error = None
        proc = types.SimpleNamespace(
            stderr=io.StringIO("https://stale.trycloudflare.com\n"),
            stdout=None,
            poll=lambda: 0,
        )
        ev = threading.Event()
        d.TUNNEL.drain(proc, "cloudflare", d.CLOUDFLARED_URL_RE, ev, stale)
        self.assertEqual(d.BOOT.tunnel_url, "https://new-tunnel.example")
        self.assertEqual(d.BOOT.tunnel_provider, "custom")
        self.assertIsNone(d.BOOT.tunnel_error)

    def test_install_dependencies_cleans_temp_constraints_dir_on_failure(self) -> None:
        d.CONFIG.pip_constraints = ["diffusers==9.9.9"]
        created_dirs: list[str] = []
        real_mkdtemp = tempfile.mkdtemp

        def tracking_mkdtemp(*args, **kwargs):
            path = real_mkdtemp(*args, **kwargs)
            created_dirs.append(path)
            return path

        with mock.patch.object(d.tempfile, "mkdtemp", side_effect=tracking_mkdtemp), mock.patch.object(
            d, "run_streaming", return_value=0
        ), mock.patch.object(d, "run_streaming_tail", return_value=(1, ["boom"])):
            with self.assertRaises(d.LoadError):
                d.install_dependencies()
        self.assertEqual(len(created_dirs), 1)
        self.assertFalse(os.path.exists(created_dirs[0]))

    def test_cleanup_before_exit_is_idempotent_and_terminates_tunnel(self) -> None:
        prev_done = d._CLEANUP_DONE
        d._CLEANUP_DONE = False
        try:
            closed: list[str] = []
            terminated: list[object] = []
            d.BOOT.http_server = types.SimpleNamespace(
                shutdown=lambda: closed.append("shutdown"),
                server_close=lambda: closed.append("close"),
            )
            fake_proc = object()
            d.BOOT.cloudflared = fake_proc
            with mock.patch.object(d, "terminate_tunnel_process", side_effect=terminated.append):
                d._cleanup_before_exit()
                d._cleanup_before_exit()
            self.assertEqual(closed, ["shutdown", "close"])
            self.assertEqual(terminated, [fake_proc])
            self.assertTrue(d.STATE.shutting_down)
            self.assertTrue(d.BOOT.stop_event.is_set())
        finally:
            d._CLEANUP_DONE = prev_done


if __name__ == "__main__":
    import unittest

    unittest.main()
