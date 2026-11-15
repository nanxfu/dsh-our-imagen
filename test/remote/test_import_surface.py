"""导入面与单例身份。

模块导入无副作用，以及 CONFIG / STATE / BOOT / log_ring 的单例身份与扁平导入约束。

拆分自 test/daemon-unit.py，运行：python test/remote/test_import_surface.py
"""

from __future__ import annotations

import unittest
import base64
import json
import re
import sys
from unittest import mock
from pathlib import Path

from support import (
    ANIMA_RUNTIME_PATH,
    CONTRACT,
    CONTRACT_VERSION,
    DAEMON_PATH,
    DaemonUnitTest,
    ROOT,
    d,
    remote_anima_loader,
    remote_config,
    remote_health,
    remote_job_models,
    remote_process,
    remote_state,
    remote_text,
    reset_stateful_singletons,
)


class ImportSideEffectTest(unittest.TestCase):
    def test_module_state_objects_exist(self) -> None:
        self.assertIsInstance(d.CONFIG, d.DaemonConfig)
        self.assertIsInstance(d.STATE, d.RuntimeState)
        self.assertIsInstance(d.BOOT, d.BootState)
        self.assertEqual(d.VERSION, CONTRACT_VERSION)
        self.assertEqual(d.STATE.phase, "booting")
        self.assertIsNone(d.BOOT.tunnel_url)
        self.assertFalse(d.BOOT.published_ready)

    def test_no_dict_based_state_left(self) -> None:
        self.assertFalse(hasattr(d.STATE, "keys"))
        self.assertFalse(hasattr(d.BOOT, "keys"))
        self.assertFalse(hasattr(d.CONFIG, "get"))

    def test_default_limits_match_contract_shape(self) -> None:
        # 契约入口存在且可调用；默认值应与 0.3.0 之前的 daemon 行为一致（兜底）。
        self.assertEqual(d._limit_spec("width")["min"], 64)
        self.assertEqual(d._limit_spec("width")["max"], 2048)
        self.assertEqual(d._max_tasks(), 8)

    def test_anima_runtime_comes_from_single_source_module(self) -> None:
        """anima 运行时只有 remote/anima_runtime.py 一份；加载器只 import 不复制实现。

        切片⑥e 之后 import 点在 remote/inference/loaders/anima.py（daemon 只经注册表分派），
        断言的仍是同一条不变式：运行时实现落在 anima_runtime 模块里，谁都不许抄一份。
        """
        self.assertEqual(remote_anima_loader.load_anima_runtime.__module__, "anima_runtime")
        runtime_module = sys.modules.get("anima_runtime")
        self.assertIsNotNone(runtime_module, "anima 加载器应从同目录 anima_runtime 导入运行时")
        self.assertTrue(hasattr(runtime_module, "_anima_toolkit"))
        self.assertEqual(Path(runtime_module.__file__).resolve(), ANIMA_RUNTIME_PATH)
        source = DAEMON_PATH.read_text(encoding="utf-8")
        self.assertNotIn("def _anima_toolkit", source)
        self.assertNotIn("def load_anima_runtime", source)
        self.assertNotIn("@@INLINE", source, "内联标记已随源码包打包移除")
        loader_source = (ROOT / "remote" / "inference" / "loaders" / "anima.py").read_text(encoding="utf-8")
        self.assertIn("from anima_runtime import load_anima_runtime", loader_source)


class StateSingletonTest(DaemonUnitTest):
    """单例只许原地更新：重新绑定会让被测函数静默读到旧对象（架构规格 §5.10）。"""

    def test_daemon_reexports_the_same_objects(self) -> None:
        self.assertIs(d.CONFIG, remote_config.CONFIG)
        self.assertIs(d.STATE, remote_state.STATE)
        self.assertIs(d.BOOT, remote_state.BOOT)
        self.assertIs(d.STATE_LOCK, remote_state.STATE_LOCK)
        self.assertIs(d.BOOT_LOCK, remote_state.BOOT_LOCK)

    def test_load_config_updates_the_singleton_in_place(self) -> None:
        before = d.CONFIG
        payload = {"auth_token": "tok", "ntfy_topic": "t", "contract": CONTRACT}
        encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
        with mock.patch.object(d, "EMBEDDED_CONFIG_B64", encoded):
            loaded = d.load_config()
        self.assertIs(loaded, before, "load_config 必须原地回填，不能返回新对象")
        self.assertIs(loaded, remote_config.CONFIG)
        self.assertEqual(d.CONFIG.auth_token, "tok")
        self.assertEqual(d.CONFIG.ntfy_topic, "t")
        self.assertEqual(d.CONFIG.contract["version"], CONTRACT_VERSION)

    def test_daemon_never_rebinds_stateful_singletons(self) -> None:
        """`CONFIG = load_config()` / `STATE = RuntimeState()` 会让实现读旧对象且不报错。"""
        source = DAEMON_PATH.read_text(encoding="utf-8")
        self.assertNotIn("global CONFIG", source)
        for name in ("CONFIG", "STATE", "BOOT"):
            self.assertIsNone(
                re.search(rf"(?m)^\s*{name}\s*=", source),
                f"daemon.py 不得重新绑定 {name}（只允许 import 与原地更新）",
            )

    def test_logger_is_the_single_log_ring_module(self) -> None:
        """config / state 必须扁平导入 log_ring，否则 /logs 会拿到第二份空环。"""
        self.assertIs(d.log, remote_state.log)
        self.assertIs(d.log, remote_config.log)
        self.assertEqual(remote_state.log.__module__, "log_ring")

    def test_reset_drops_dynamically_attached_fields(self) -> None:
        """夹具重置要连非 dataclass 字段一起清（用例会挂 STATE.waiting 这类历史字段）。"""
        d.STATE.waiting = 3
        d.BOOT.legacy_marker = "x"
        d.CONFIG.legacy_marker = "y"
        reset_stateful_singletons()
        self.assertFalse(hasattr(d.STATE, "waiting"))
        self.assertFalse(hasattr(d.BOOT, "legacy_marker"))
        self.assertFalse(hasattr(d.CONFIG, "legacy_marker"))
        # 声明字段仍然按默认值恢复，对象身份不变。
        self.assertEqual(d.STATE.phase, "booting")
        self.assertIsNone(d.BOOT.tunnel_url)


class SharedModuleSurfaceTest(DaemonUnitTest):
    """跨模块共享的常量/函数必须是**同一对象**：否则打桩会打到影子变量上（假绿）。"""

    def test_daemon_reexports_the_owning_objects(self) -> None:
        self.assertIs(d.HEALTH_VERSION_MODULES, remote_health.HEALTH_VERSION_MODULES)
        self.assertIs(d.dependency_versions, remote_health.dependency_versions)
        self.assertIs(d.gpu_memory_payload, remote_health.gpu_memory_payload)
        self.assertIs(d.IMPORT_CHECK_CODE, remote_process.IMPORT_CHECK_CODE)
        self.assertIs(d.IMPORT_CHECK_MODULES, remote_process.IMPORT_CHECK_MODULES)
        self.assertIs(d.PIP_CONSTRAINTS, remote_process.PIP_CONSTRAINTS)
        self.assertIs(d.run_command_tail, remote_process.run_command_tail)
        self.assertIs(d.run_streaming_tail, remote_process.run_streaming_tail)
        self.assertIs(d.write_constraints_file, remote_process.write_constraints_file)
        self.assertIs(d.short, remote_text.short)
        self.assertIs(d.Job, remote_job_models.Job)
        self.assertIs(d.iso_time, remote_job_models.iso_time)
        self.assertIs(d.normalize_job_id, remote_job_models.normalize_job_id)
        self.assertIs(d.classify_failure, remote_job_models.classify_failure)
        self.assertIs(d.JOB_STATUS_FAILED, remote_job_models.JOB_STATUS_FAILED)

    def test_import_check_code_is_generated_from_the_module_list(self) -> None:
        """清单与自检脚本不能各写一遍：脚本里的元组必须由 IMPORT_CHECK_MODULES 生成。"""
        self.assertIn(repr(remote_process.IMPORT_CHECK_MODULES), remote_process.IMPORT_CHECK_CODE)
        for name in remote_process.IMPORT_CHECK_MODULES:
            self.assertIn(name, remote_process.IMPORT_CHECK_CODE)

    def test_pip_env_reuses_the_single_environment_builder(self) -> None:
        """流式执行与一次性命令必须共用 pipeline_loader.pip_env()（§1.3 点名的重复）。"""
        source = (ROOT / "remote" / "infra" / "process.py").read_text(encoding="utf-8")
        self.assertEqual(source.count("env=pip_env(),"), 2, "两处启动子进程都应走 pip_env()")
        self.assertNotIn("PIP_DISABLE_PIP_VERSION_CHECK", source, "环境变量只在 pipeline_loader 构造")
        self.assertNotIn("setdefault(", source, "process.py 不应自己补环境变量")


if __name__ == "__main__":
    unittest.main()
