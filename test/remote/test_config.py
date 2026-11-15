"""配置与契约边界。

注入配置解析（精确键、未知键告警）、protocol_version 优先级、_limit_spec / _max_tasks 合并、可选注入项过滤。

拆分自 test/daemon-unit.py，运行：python test/remote/test_config.py
"""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import tempfile
from unittest import mock

from support import CONTRACT, CONTRACT_DOC, CONTRACT_VERSION, ROOT, DaemonUnitTest, d


class BuildConfigTest(DaemonUnitTest):
    def test_defaults(self) -> None:
        config = d.DaemonConfig()
        self.assertEqual(config.auth_token, "")
        self.assertEqual(config.ntfy_server, "https://ntfy.sh")
        self.assertEqual(config.idle_timeout_sec, 1800)
        self.assertEqual(config.port, d.DEFAULT_PORT)
        self.assertIsNone(config.preload)
        self.assertEqual(config.contract, {})
        self.assertFalse(config.allow_no_auth)

    def test_set_embedded_config_is_the_injection_hook(self) -> None:
        """启动器通过函数注入配置：搬家后仍指向真正的实现，不能变成只改模块属性。"""
        with mock.patch.object(d, "EMBEDDED_CONFIG_B64", ""):
            d.set_embedded_config("abc")
            self.assertEqual(d.EMBEDDED_CONFIG_B64, "abc")
            d.set_embedded_config("")
            self.assertEqual(d.EMBEDDED_CONFIG_B64, "")

    def test_full_snake_case_config(self) -> None:
        config = d._build_config(
            {
                "auth_token": "tok",
                "ntfy_topic": "topic-1",
                "ntfy_server": "https://ntfy.example/",
                "idle_timeout_sec": 600,
                "port": 8080,
                "preload": {"loader": "sdxl", "base": "org/base"},
                "preset_id": "sdxl-lightning",
                "log_level": "debug",
                "version": "0.4.1",
                "contract": CONTRACT,
                "allow_no_auth": True,
            }
        )
        self.assertEqual(config.auth_token, "tok")
        self.assertEqual(config.ntfy_topic, "topic-1")
        self.assertEqual(config.ntfy_server, "https://ntfy.example")
        self.assertEqual(config.idle_timeout_sec, 600)
        self.assertEqual(config.port, 8080)
        self.assertEqual(config.preload["loader"], "sdxl")
        self.assertEqual(config.preset_id, "sdxl-lightning")
        self.assertEqual(config.log_level, "debug")
        self.assertEqual(config.version, "0.4.1")
        self.assertEqual(config.contract["limits"]["width"]["max"], 1536)
        self.assertTrue(config.allow_no_auth)

    def test_known_config_keys_match_dataclass_fields(self) -> None:
        # 精确键表就是 DaemonConfig 的字段名：新增字段必须同步进 _KNOWN_CONFIG_KEYS，否则会被当成未知键。
        self.assertEqual(d._KNOWN_CONFIG_KEYS, set(d.DaemonConfig.__dataclass_fields__))

    def test_alias_style_keys_are_rejected(self) -> None:
        # 契约已收敛：只认 Host 实际下发的精确 snake_case 键，历史驼峰别名不再兜底。
        config = d._build_config(
            {
                "authToken": "tok2",
                "ntfyTopic": "topic-2",
                "idleTimeoutSec": "300",
                "presetId": "sdxl-turbo",
                "logLevel": "warn",
                "allowNoAuth": True,
                "pipeline": {"loader": "sdxl", "base": "org/base"},
            }
        )
        self.assertEqual(config.auth_token, "")
        self.assertEqual(config.ntfy_topic, "")
        self.assertEqual(config.idle_timeout_sec, 1800)
        self.assertIsNone(config.preset_id)
        self.assertEqual(config.log_level, "info")
        self.assertFalse(config.allow_no_auth)
        self.assertIsNone(config.preload)
        self.assertLogContains("未知配置键已忽略")
        self.assertLogContains("authToken")

    def test_invalid_values_fall_back(self) -> None:
        config = d._build_config(
            {
                "idle_timeout_sec": "not-a-number",
                "port": object(),
                "preload": "not-a-dict",
                "contract": ["not", "an", "object"],
            }
        )
        self.assertEqual(config.idle_timeout_sec, 1800)
        self.assertEqual(config.port, d.DEFAULT_PORT)
        self.assertIsNone(config.preload)
        self.assertEqual(config.contract, {})
        self.assertLogContains("preload 不是 pipeline 描述对象")
        self.assertLogContains("contract 不是 JSON 对象")

    def test_unknown_keys_are_reported(self) -> None:
        d._build_config({"auth_token": "tok", "mystery_key": 1, "another": True})
        self.assertLogContains("未知配置键已忽略")
        self.assertLogContains("mystery_key")

    def test_warns_when_contract_missing_and_allow_no_auth(self) -> None:
        d._build_config({"auth_token": "SECRET-TOKEN-VALUE", "allow_no_auth": True})
        self.assertLogContains("未收到 contract")
        self.assertLogContains("allow_no_auth=true")
        # 日志里不能出现 token 明文（配置项名可以出现）
        self.assertNotIn("SECRET-TOKEN-VALUE", self.logs())

    def test_load_config_reads_embedded_base64(self) -> None:
        payload = {"auth_token": "embedded-token", "ntfy_topic": "t", "contract": CONTRACT}
        encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
        with mock.patch.object(d, "EMBEDDED_CONFIG_B64", encoded):
            config = d.load_config()
        self.assertEqual(config.auth_token, "embedded-token")
        self.assertEqual(config.contract["version"], CONTRACT_VERSION)

    def test_load_config_without_payload_returns_defaults(self) -> None:
        with mock.patch.object(d, "EMBEDDED_CONFIG_B64", ""), mock.patch.dict(os.environ, {}, clear=True):
            config = d.load_config()
        self.assertEqual(config.auth_token, "")
        self.assertLogContains("allow_no_auth")

    def test_load_config_rejects_broken_payload(self) -> None:
        with mock.patch.object(d, "EMBEDDED_CONFIG_B64", "not-base64!!"):
            with self.assertRaises(SystemExit):
                d.load_config()
        bad_json = base64.b64encode(b"[1, 2, 3]").decode("ascii")
        with mock.patch.object(d, "EMBEDDED_CONFIG_B64", bad_json):
            with self.assertRaises(SystemExit):
                d.load_config()


class ProtocolVersionTest(DaemonUnitTest):
    def test_falls_back_to_file_version(self) -> None:
        self.assertEqual(d.protocol_version(), CONTRACT_VERSION)

    def test_prefers_injected_version(self) -> None:
        d.CONFIG.version = "0.3.1-injected"
        self.assertEqual(d.protocol_version(), "0.3.1-injected")

    def test_prefers_contract_version_over_injected(self) -> None:
        d.CONFIG.version = "0.3.1-injected"
        d.CONFIG.contract = {"version": "0.3.2-contract"}
        self.assertEqual(d.protocol_version(), "0.3.2-contract")

    def test_ignores_blank_versions(self) -> None:
        d.CONFIG.version = "   "
        d.CONFIG.contract = {"version": ""}
        self.assertEqual(d.protocol_version(), d.VERSION)


class LimitSpecTest(DaemonUnitTest):
    """契约合并与兜底：兜底一律是内置 remote/contract.json，没有第二份硬编码表。"""

    def test_partial_contract_is_merged_with_builtin(self) -> None:
        builtin = CONTRACT_DOC["limits"]["width"]
        d.CONFIG.contract = {"limits": {"width": {"max": 1024}}}
        spec = d._limit_spec("width")
        self.assertEqual(spec["min"], builtin["min"])
        self.assertEqual(spec["max"], 1024)
        self.assertEqual(spec["step"], builtin["step"])

    def test_ignores_non_numeric_contract_values(self) -> None:
        builtin = CONTRACT_DOC["limits"]["steps"]
        d.CONFIG.contract = {"limits": {"steps": {"min": "x", "max": None, "step": True}}}
        spec = d._limit_spec("steps")
        self.assertEqual(spec["min"], builtin["min"])
        self.assertEqual(spec["max"], builtin["max"])
        # True 是 bool，不应被当成数字覆盖 step；steps 本身也没有 step 兜底键
        self.assertNotIn("step", spec)

    def test_no_contract_reads_builtin_contract_json(self) -> None:
        """无注入契约（本地调试 / 旧 Host）时，边界就是随包分发的 contract.json。"""
        d.CONFIG.contract = {}
        self.assertEqual(d._limit_spec("width"), CONTRACT_DOC["limits"]["width"])
        self.assertEqual(d._limit_spec("steps"), CONTRACT_DOC["limits"]["steps"])
        self.assertEqual(d._limit_spec("cfg"), CONTRACT_DOC["limits"]["cfg"])
        self.assertEqual(d._max_tasks(), CONTRACT_DOC["limits"]["count"]["max"])
        # Batch 3 的行为变更：不再是 0.3.0 时代的 64–2048 / steps≤80 / cfg≤30 / 每批 8。
        self.assertEqual(d._limit_spec("width")["min"], 256)
        self.assertEqual(d._max_tasks(), 4)

    def test_count_limit_drives_max_tasks(self) -> None:
        d.CONFIG.contract = {"limits": {"count": {"min": 1, "max": 2}}}
        self.assertEqual(d._max_tasks(), 2)
        # max=0 / 非数字一律回退内置契约的张数上限（不是另一份常量）。
        d.CONFIG.contract = {"limits": {"count": {"max": 0}}}
        self.assertEqual(d._max_tasks(), CONTRACT_DOC["limits"]["count"]["max"])
        d.CONFIG.contract = {"limits": {"count": {"max": "many"}}}
        self.assertEqual(d._max_tasks(), CONTRACT_DOC["limits"]["count"]["max"])


class OptionalConfigTest(DaemonUnitTest):
    """P1.2 / P2.1 / P2.2 可选注入配置的解析与过滤。"""

    def test_new_fields_default_to_empty(self) -> None:
        config = d.DaemonConfig()
        self.assertEqual(config.hf_token, "")
        self.assertEqual(config.pip_constraints, [])
        self.assertEqual(config.fallback_tunnel_command, [])
        self.assertEqual(config.fallback_tunnel_url_regex, "")
        self.assertEqual(config.local_models, {})

    def test_parses_optional_injection(self) -> None:
        config = d._build_config(
            {
                "hf_token": "  hf_secret  ",
                "pip_constraints": ["diffusers<0.36", "", 42, "numpy<2"],
                "fallback_tunnel_command": ["bore", "local", "127.0.0.1:{port}", "", None],
                "fallback_tunnel_url_regex": r"https://[\w.-]+",
                "local_models": {"org/model": "/kaggle/input/model", "bad": 5},
            }
        )
        self.assertEqual(config.hf_token, "hf_secret")
        self.assertEqual(config.pip_constraints, ["diffusers<0.36", "numpy<2"])
        self.assertEqual(config.fallback_tunnel_command, ["bore", "local", "127.0.0.1:{port}"])
        self.assertEqual(config.fallback_tunnel_url_regex, r"https://[\w.-]+")
        self.assertEqual(config.local_models, {"org/model": "/kaggle/input/model"})
        self.assertLogContains("pip_constraints 中的非字符串项已忽略")
        self.assertLogContains("fallback_tunnel_command 中的非字符串项已忽略")
        self.assertLogContains("local_models 中的非法映射已忽略")

    def test_hf_token_value_never_logged(self) -> None:
        d._build_config({"hf_token": "hf_TOP_SECRET", "contract": CONTRACT})
        self.assertLogContains("hf_token=on")
        self.assertNotIn("hf_TOP_SECRET", self.logs())

    def test_invalid_optional_values_fall_back(self) -> None:
        config = d._build_config(
            {
                "pip_constraints": "diffusers<1",  # 单个字符串按一条约束处理
                "fallback_tunnel_command": "bore",  # 非数组 → 忽略
                "local_models": ["org/model"],  # 非对象 → 忽略
            }
        )
        self.assertEqual(config.pip_constraints, ["diffusers<1"])
        self.assertEqual(config.fallback_tunnel_command, [])
        self.assertEqual(config.local_models, {})
        self.assertLogContains("fallback_tunnel_command 不是数组")
        self.assertLogContains("local_models 不是对象")


class HfTokenTest(DaemonUnitTest):
    def test_sets_both_env_names_without_logging_value(self) -> None:
        d.CONFIG.hf_token = "hf_SECRET_TOKEN"
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertTrue(d.apply_hf_token())
            self.assertEqual(os.environ.get("HF_TOKEN"), "hf_SECRET_TOKEN")
            self.assertEqual(os.environ.get("HUGGING_FACE_HUB_TOKEN"), "hf_SECRET_TOKEN")
        self.assertNotIn("hf_SECRET_TOKEN", self.logs())
        self.assertLogContains("值不写入日志")

    def test_empty_token_is_noop(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(d.apply_hf_token())
            self.assertNotIn("HF_TOKEN", os.environ)


class PipConstraintsTest(DaemonUnitTest):
    def test_no_default_constraints(self) -> None:
        """0.4.1 修正：默认不钉版本。

        0.4.0 内置的 transformers<5 与 diffusers 新版要求的 huggingface-hub>=1.32
        无法同时满足，会让 pip 解析失败（远端 load_failed）。
        """
        self.assertEqual(d.PIP_CONSTRAINTS, {})
        self.assertEqual(d.merge_pip_constraints([]), [])

    def test_package_name_is_normalized(self) -> None:
        self.assertEqual(d.package_name("diffusers<1.0"), "diffusers")
        self.assertEqual(d.package_name("Diffusers >= 0.35"), "diffusers")
        self.assertEqual(d.package_name("accelerate[extra]==1.2"), "accelerate")
        self.assertEqual(d.package_name("--no-deps"), "")
        self.assertEqual(d.package_name(""), "")

    def test_injected_constraints_are_used(self) -> None:
        merged = d.merge_pip_constraints(["diffusers<0.36", "numpy<2"])
        self.assertEqual(merged, ["diffusers<0.36", "numpy<2"])
        # 包名归一化后同名覆盖：后写的值生效，不并列两条
        overridden = d.merge_pip_constraints(["Diffusers>=0.35", "diffusers<0.36"])
        self.assertEqual(overridden, ["diffusers<0.36"])

    def test_unrecognized_constraint_is_ignored(self) -> None:
        self.assertEqual(d.merge_pip_constraints(["==1.0"]), [])
        self.assertLogContains("无法识别包名")

    def test_write_constraints_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = d.write_constraints_file(["diffusers<1.0", "numpy<2"], directory)
            self.assertTrue(os.path.isfile(path))
            with open(path, encoding="utf-8") as handle:
                content = handle.read()
        self.assertEqual(content.splitlines(), ["diffusers<1.0", "numpy<2"])

    def test_install_dependencies_default_has_no_constraints(self) -> None:
        calls: list[list[str]] = []
        verified: list[bool] = []

        def fake_install(argv, _prefix, tail_lines=12):  # noqa: ANN001, ANN202
            calls.append(list(argv))
            return 0, ["ok"]

        with mock.patch.object(d, "run_streaming_tail", side_effect=fake_install), mock.patch.object(
            d, "run_streaming", return_value=0
        ), mock.patch.object(
            d, "write_constraints_file", side_effect=AssertionError("默认不应写约束文件")
        ), mock.patch.object(d, "verify_dependencies", side_effect=lambda: verified.append(True)):
            d.install_dependencies()
        install_argv = calls[-1]
        self.assertIn("install", install_argv)
        self.assertNotIn("-c", install_argv)
        self.assertIn("diffusers", install_argv)
        self.assertEqual(verified, [True])
        self.assertLogContains("未配置版本约束")

    def test_install_dependencies_passes_injected_constraints(self) -> None:
        calls: list[list[str]] = []
        verified: list[bool] = []
        constraints_path = os.path.join(tempfile.gettempdir(), "imagen-fake-constraints.txt")
        d.CONFIG.pip_constraints = ["diffusers==0.42.1", "numpy<2"]

        def fake_install(argv, _prefix, tail_lines=12):  # noqa: ANN001, ANN202
            calls.append(list(argv))
            return 0, []

        def fake_write(constraints, directory=None):  # noqa: ANN001, ANN202
            self.assertEqual(constraints, ["diffusers==0.42.1", "numpy<2"])
            return constraints_path

        with mock.patch.object(d, "run_streaming_tail", side_effect=fake_install), mock.patch.object(
            d, "run_streaming", return_value=0
        ), mock.patch.object(d, "write_constraints_file", side_effect=fake_write), mock.patch.object(
            d, "verify_dependencies", side_effect=lambda: verified.append(True)
        ):
            d.install_dependencies()
        install_argv = calls[-1]
        self.assertIn("-c", install_argv)
        self.assertEqual(install_argv[install_argv.index("-c") + 1], constraints_path)
        self.assertEqual(verified, [True])
        self.assertLogContains("依赖约束（Host 注入）")

    def test_constraint_failure_retries_without_constraints(self) -> None:
        d.CONFIG.pip_constraints = ["diffusers==9.9.9"]
        calls: list[list[str]] = []
        verified: list[bool] = []
        constraints_path = os.path.join(tempfile.gettempdir(), "imagen-fake-constraints.txt")

        def fake_install(argv, _prefix, tail_lines=12):  # noqa: ANN001, ANN202
            calls.append(list(argv))
            if "-c" in argv:
                return 1, ["ERROR: Could not find a version that satisfies the requirement"]
            return 0, []

        with mock.patch.object(d, "run_streaming_tail", side_effect=fake_install), mock.patch.object(
            d, "run_streaming", return_value=0
        ), mock.patch.object(d, "write_constraints_file", return_value=constraints_path), mock.patch.object(
            d, "verify_dependencies", side_effect=lambda: verified.append(True)
        ):
            d.install_dependencies()
        self.assertEqual(len(calls), 2)
        self.assertIn("-c", calls[0])
        self.assertNotIn("-c", calls[1])
        self.assertEqual(verified, [True])
        self.assertLogContains("去掉约束重试一次")

    def test_install_failure_carries_pip_tail(self) -> None:
        with mock.patch.object(
            d,
            "run_streaming_tail",
            return_value=(1, ["ERROR: Could not build wheels for tokenizers", "torchao ABI conflict"]),
        ), mock.patch.object(d, "run_streaming", return_value=0), mock.patch.object(
            d, "verify_dependencies", side_effect=AssertionError("不应继续自检")
        ):
            with self.assertRaises(d.LoadError) as ctx:
                d.install_dependencies()
        message = str(ctx.exception)
        self.assertIn("pip install 失败", message)
        self.assertIn("Could not build wheels", message)
        self.assertIn("退出码 1", message)

    def test_tail_summary_keeps_last_lines_and_truncates(self) -> None:
        self.assertEqual(d.tail_summary([]), "无输出")
        self.assertIn("last", d.tail_summary(["old\n", "", "last"]))
        long = d.tail_summary(["x" * 1000], limit=100)
        self.assertLessEqual(len(long), 100)
        self.assertTrue(long.startswith("…"))

    def test_import_check_covers_all_packages(self) -> None:
        for name in d.IMPORT_CHECK_MODULES:
            self.assertIn(name, d.IMPORT_CHECK_CODE)
        self.assertEqual(d.IMPORT_CHECK_MODULES, ("torch", "diffusers", "transformers", "accelerate", "peft"))
        # 0.4.1：版本组合不兼容时模块级导入未必报错，补一条 DiffusionPipeline 导入。
        self.assertIn("from diffusers import DiffusionPipeline", d.IMPORT_CHECK_CODE)

    def test_verify_dependencies_raises_with_tail(self) -> None:
        tail = ["Traceback (most recent call last):", "ModuleNotFoundError: No module named 'diffusers'"]
        with mock.patch.object(d, "run_command_tail", return_value=(1, tail)):
            with self.assertRaises(d.LoadError) as ctx:
                d.verify_dependencies()
        message = str(ctx.exception)
        self.assertIn("依赖导入自检失败", message)
        self.assertIn("退出码 1", message)
        self.assertIn("ModuleNotFoundError", message)

    def test_verify_dependencies_success(self) -> None:
        with mock.patch.object(d, "run_command_tail", return_value=(0, ["torch==2.4.0", "diffusers==0.35.0"])):
            d.verify_dependencies()
        self.assertLogContains("依赖导入自检通过")


class MockDaemonContractTest(DaemonUnitTest):
    """`test/mock-daemon.py` 的兜底边界必须与内置契约同值（Batch 3 的必带项）。

    为什么单独守：mock 是 host-e2e / jobs-wait 里的"远端"，它放行的请求真 daemon 不能拒、
    它拒的真 daemon 也不能放。此前 mock 的夹具抄的是 daemon 的 `_FALLBACK_LIMITS`（64–2048），
    daemon 改读 contract.json（256–1536）后两边就会静默漂移——测试全绿，真机 400。
    """

    def load_mock(self):  # noqa: ANN201
        mock_path = ROOT / "test" / "mock-daemon.py"
        spec = importlib.util.spec_from_file_location("mock_daemon_under_test", mock_path)
        self.assertIsNotNone(spec)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_fallback_copy_matches_contract_json(self) -> None:
        mock_module = self.load_mock()
        self.assertEqual(mock_module.FALLBACK_CONTRACT, CONTRACT_DOC)
        # 收紧后的默认边界（行为变更）：256–1536 / steps≤60 / cfg≤20 / 每批 ≤4。
        limits = mock_module.FALLBACK_CONTRACT["limits"]
        self.assertEqual(limits["width"]["min"], 256)
        self.assertEqual(limits["width"]["max"], 1536)
        self.assertEqual(limits["steps"]["max"], 60)
        self.assertEqual(limits["cfg"]["max"], 20)
        self.assertEqual(limits["count"]["max"], 4)

    def test_limit_merge_and_body_limit_match_daemon(self) -> None:
        """同一份注入契约下，mock 与 daemon 的取数结果逐键相等。"""
        mock_module = self.load_mock()
        for injected in ({}, {"limits": {"width": {"max": 1024}}}, {"limits": {"count": {"max": 2}}}):
            mock_module.CONTRACT = json.loads(json.dumps(injected))
            d.CONFIG.contract = json.loads(json.dumps(injected))
            for name in ("width", "height", "steps", "cfg", "count", "reference", "strength"):
                self.assertEqual(mock_module._limit(name), d._limit_spec(name), f"{injected} / {name}")
            self.assertEqual(mock_module._max_tasks(), d._max_tasks(), str(injected))
            self.assertEqual(mock_module._request_body_limit(), d._request_body_limit(), str(injected))


if __name__ == "__main__":
    import unittest

    unittest.main()
