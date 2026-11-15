"""/health 快照。

字段齐全与状态映射、queue_depth 跟随队列、锁顺序（先取样后取队列深度）、依赖版本快照与显存快照。

拆分自 test/daemon-unit.py，运行：python test/remote/test_health.py
"""

from __future__ import annotations

import inspect
import json
import os
import sys
import types
from unittest import mock

from support import CONTRACT_VERSION, DaemonUnitTest, d, make_pipeline, remote_health


class HealthPayloadTest(DaemonUnitTest):
    REQUIRED_KEYS = {
        "status",
        "phase",
        "version",
        "versions",
        "model_id",
        "loaded",
        "device",
        "device_count",
        "idle_seconds",
        "idle_timeout_sec",
        "jobs_done",
        "queue_depth",
        "last_error",
        "last_error_code",
        "detail",
        "uptime_seconds",
        "tunnel_provider",
        "tunnel_state",
        "tunnel_restarts",
        "gpu_memory",
    }

    def test_fields_are_complete(self) -> None:
        payload = d.health_payload()
        self.assertEqual(set(payload), self.REQUIRED_KEYS)
        self.assertEqual(payload["phase"], "booting")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["version"], CONTRACT_VERSION)
        self.assertEqual(payload["idle_timeout_sec"], 1800)
        self.assertGreaterEqual(payload["idle_seconds"], 0)
        self.assertGreaterEqual(payload["uptime_seconds"], 0)
        self.assertIsInstance(payload["versions"], dict)
        self.assertIsInstance(payload["versions"].get("python"), str)
        # 单测环境没有加载 torch：显存快照必须是 null，不能因此影响 status/phase。
        with mock.patch.dict(sys.modules, {"torch": None}):
            payload = d.health_payload()
        self.assertIsNone(payload["gpu_memory"])
        self.assertEqual(payload["status"], "ok")

    def test_gpu_memory_reports_mib_snapshot(self) -> None:
        """torch 已加载且 CUDA 可用：显存三项按 MiB 取整上报，不影响 status/phase。"""
        mib = 1024 * 1024
        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(
            is_available=lambda: True,
            memory_allocated=lambda: 10347 * mib + 123456,
            memory_reserved=lambda: 12000 * mib,
            max_memory_allocated=lambda: 13000 * mib + 999,
        )
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            payload = d.health_payload()
        self.assertEqual(
            payload["gpu_memory"],
            {"allocated_mb": 10347, "reserved_mb": 12000, "max_allocated_mb": 13000},
        )
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["phase"], "booting")

    def test_gpu_memory_is_null_without_loaded_torch(self) -> None:
        with mock.patch.dict(sys.modules, {"torch": None}):
            self.assertIsNone(d.health_payload()["gpu_memory"])

    def test_gpu_memory_is_null_when_cuda_unavailable(self) -> None:
        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            self.assertIsNone(d.health_payload()["gpu_memory"])

    def test_gpu_memory_is_null_on_cuda_error(self) -> None:
        def boom():  # noqa: ANN202
            raise RuntimeError("CUDA driver 异常")

        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(is_available=boom)
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            payload = d.health_payload()
        self.assertIsNone(payload["gpu_memory"])
        self.assertEqual(payload["status"], "ok")

    def test_error_phase_flips_status(self) -> None:
        d.record_error("load_failed", "pip 失败")
        d.set_phase("error", "启动失败")
        payload = d.health_payload()
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["phase"], "error")
        self.assertEqual(payload["last_error_code"], "load_failed")
        self.assertEqual(payload["last_error"], "load_failed: pip 失败")
        self.assertEqual(payload["detail"], "启动失败")

    def test_queue_depth_follows_job_queue(self) -> None:
        d.STATE.waiting = 3  # 0.4.x 的旧字段不再参与统计
        self.assertEqual(d.health_payload()["queue_depth"], 0)
        d.JOB_STORE.submit(make_pipeline(), "org/base-model", [{"prompt": "x"}])
        self.assertEqual(d.health_payload()["queue_depth"], 1)

    def test_loaded_list_is_a_copy(self) -> None:
        d.STATE.loaded = ["sdxl:org/base"]
        payload = d.health_payload()
        self.assertEqual(payload["loaded"], ["sdxl:org/base"])
        self.assertIsNot(payload["loaded"], d.STATE.loaded)


class HealthLockOrderTest(DaemonUnitTest):
    """规格 §5.8：锁顺序唯一方向 JOB_LOCK → STATE_LOCK，/health 不能反着取。"""

    def test_queue_depth_is_read_after_releasing_state_lock(self) -> None:
        events: list[str] = []

        class TrackingLock:
            """记录进出临界区：RLock 可重入，只有换掉锁才能观察到"仍在锁内"。"""

            inside = False
            def __enter__(self):
                self.inside = True
                events.append("enter")
                return self

            def __exit__(self, *exc):
                self.inside = False
                events.append("exit")
                return False

        lock = TrackingLock()

        def fake_queue_depth() -> int:
            events.append("queue")
            assert lock.inside is False, "取队列深度时不能仍持有 STATE_LOCK（会与 _finish_job 反向嵌套）"
            return 3

        with mock.patch.object(d, "STATE_LOCK", lock), mock.patch.object(d.JOB_STORE, "queue_depth", fake_queue_depth):
            payload = d.health_payload()

        self.assertEqual(payload["queue_depth"], 3)
        self.assertEqual(events[:2], ["enter", "exit"], "取样必须整段包在 STATE_LOCK 内")
        self.assertLess(events.index("exit"), events.index("queue"))

    def test_payload_builder_cannot_reach_locks(self) -> None:
        """组装层只接受快照与标量：没有任何参数能把锁或状态对象带进去（结构上无法反序）。"""
        params = inspect.signature(remote_health.build_payload).parameters
        self.assertEqual(
            set(params), {"snapshot", "version", "idle_timeout_sec", "queue_depth", "now"}
        )


class HealthVersionsTest(DaemonUnitTest):
    """M4.2：/health.versions 依赖快照只含纯版本号，不含 token / 路径。"""

    def test_versions_are_pure_version_strings(self) -> None:
        payload = d.health_payload()
        versions = payload["versions"]
        self.assertIsInstance(versions, dict)
        self.assertIn("python", versions)
        for key, value in versions.items():
            self.assertIsInstance(value, str, key)
            self.assertRegex(value, r"^[0-9][0-9A-Za-z.+!_-]*$", key)
            self.assertNotIn(os.sep, value)
            self.assertNotIn("/", value)

    def test_token_values_never_leak_into_versions(self) -> None:
        secret = "hf_SECRET_never_in_versions"
        d.CONFIG.hf_token = secret
        with mock.patch.dict(
            os.environ, {"HF_TOKEN": secret, "HUGGING_FACE_HUB_TOKEN": secret}, clear=False
        ):
            versions = d.health_payload()["versions"]
        self.assertNotIn(secret, json.dumps(versions, ensure_ascii=False))

    def test_invalid_versions_are_dropped_without_raising(self) -> None:
        # 同时放一条合法版本：否则"weird 不在结果里"在打桩失效时也会成立（假绿）。
        bad = types.SimpleNamespace(__version__="/home/kaggle/secret/path")
        good = types.SimpleNamespace(__version__="2.4.0")
        with mock.patch.dict(sys.modules, {"fake_weird_module": bad, "fake_good_module": good}):
            with mock.patch.object(
                remote_health,
                "HEALTH_VERSION_MODULES",
                (
                    ("weird", "fake_weird_module", "nonexistent-dist-xyz"),
                    ("good", "fake_good_module", "nonexistent-dist-xyz"),
                ),
            ):
                versions = d.dependency_versions()
        self.assertIn("python", versions)
        self.assertEqual(versions.get("good"), "2.4.0", "打桩的版本表必须真的被读到")
        self.assertNotIn("weird", versions)
        self.assertNotIn("secret", json.dumps(versions, ensure_ascii=False))

    def test_missing_packages_are_omitted(self) -> None:
        present = types.SimpleNamespace(__version__="1.2.3")
        with mock.patch.dict(sys.modules, {"fake_present_module": present}):
            with mock.patch.object(
                remote_health,
                "HEALTH_VERSION_MODULES",
                (
                    ("present", "fake_present_module", "nonexistent-dist-xyz"),
                    ("missing", "definitely_missing_module_xyz", "definitely-missing-dist-xyz"),
                ),
            ):
                versions = d.dependency_versions()
        self.assertEqual(versions.get("present"), "1.2.3", "打桩的版本表必须真的被读到")
        self.assertIsInstance(versions, dict)
        self.assertNotIn("missing", versions)
        self.assertIsInstance(d.health_payload()["versions"], dict)


if __name__ == "__main__":
    import unittest

    unittest.main()
