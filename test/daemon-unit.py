#!/usr/bin/env python3
"""remote/daemon.py 的纯逻辑单测（不需要 torch / GPU / 网络 / 端口）。

定位：只覆盖"可以在本机直接 import 并调用"的部分，作为 daemon 重构的安全网；
真正的推理链路只能靠人工 gpu-live / kaggle-live 验证。

覆盖：
  1. 模块导入无副作用（无服务器、无隧道、无后台线程）
  2. load_config / _build_config：正常键、别名、未知键告警、contract / allow_no_auth
  3. protocol_version：契约 version → 注入 version → 文件常量
  4. validate_generate_spec：契约边界（尺寸 256-1536/8 对齐、steps 1-60、cfg 0-20、
     任务数 1-4、seed ≤2147483647、prompt ≤2000）、契约缺失回退、默认值
  5. _require_auth / auth_missing：无 token 401、allow_no_auth 放行、Bearer 校验
  6. fail_boot：phase=error + 错误记录 + 隧道原因，且不发布 ready
  7. classify_failure：oom / invalid_request / load_failed / generation_failed
  8. health_payload：字段齐全、phase=error → status=error、queue_depth 跟随 waiting
  9. log_since：绝对序号、增量分页、环形裁剪
 10. _limit_spec / _max_tasks：契约合并与兜底

运行：python test/daemon-unit.py
"""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
DAEMON_PATH = ROOT / "remote" / "daemon.py"


def _load_daemon():
    """按路径加载 daemon.py（模块级只定义常量/状态对象，不会启动任何东西）。

    必须先把自己注册进 sys.modules：dataclass 在 class 创建时要按 ``cls.__module__``
    回查模块命名空间，模块不在 sys.modules 里会抛 AttributeError。
    """
    spec = importlib.util.spec_from_file_location("imagen_daemon_under_test", DAEMON_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {DAEMON_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


d = _load_daemon()

AUTH_TOKEN = "test-token-0123456789"

# 与 shared/contract.js 的 daemonContract() 同形，只取 daemon 会消费的部分。
CONTRACT = {
    "version": "0.3.0",
    "healthPhases": ["booting", "installing", "loading", "ready", "error"],
    "ntfyEvents": ["ready", "error"],
    "limits": {
        "width": {"min": 256, "max": 1536, "step": 8},
        "height": {"min": 256, "max": 1536, "step": 8},
        "steps": {"min": 1, "max": 60},
        "cfg": {"min": 0, "max": 20},
        "count": {"min": 1, "max": 4},
        "seed": {"max": 2147483647},
        "prompt": {"maxChars": 2000},
    },
}


def make_pipeline(loader: str = "sdxl", base: str = "org/base-model") -> dict:
    return {"loader": loader, "base": base}


def make_spec(tasks=None, pipeline=None) -> dict:
    return {
        "pipeline": make_pipeline() if pipeline is None else pipeline,
        "tasks": [{"prompt": "雾中荷塘，工笔"}] if tasks is None else tasks,
    }


def make_handler(auth_header: str | None = None):
    """伪造一个不绑定 socket 的 DaemonHandler，用来单测 _require_auth。"""
    handler = object.__new__(d.DaemonHandler)
    handler.headers = {"Authorization": auth_header} if auth_header else {}
    sent: list[tuple[int, dict]] = []
    handler._send_json = lambda code, payload, extra_headers=None: sent.append((code, payload))
    return handler, sent


class DaemonUnitTest(unittest.TestCase):
    """公共夹具：每个用例一份独立 CONFIG/STATE/BOOT，并把日志导出到内存。"""

    def setUp(self) -> None:
        self._saved = (d.CONFIG, d.STATE, d.BOOT, d._ORIG_STDOUT)
        d.CONFIG = d.DaemonConfig()
        d.STATE = d.RuntimeState()
        d.BOOT = d.BootState()
        d._ORIG_STDOUT = io.StringIO()
        d._LOG_LINES.clear()
        d._LOG_SEQ = 0

    def tearDown(self) -> None:
        d.CONFIG, d.STATE, d.BOOT, d._ORIG_STDOUT = self._saved

    # ---- 断言辅助 ----

    def logs(self) -> str:
        return "\n".join(d._LOG_LINES)

    def assertLogContains(self, needle: str) -> None:
        self.assertIn(needle, self.logs())

    def contract_config(self) -> None:
        d.CONFIG.contract = json.loads(json.dumps(CONTRACT))
        d.CONFIG.auth_token = AUTH_TOKEN


class ImportSideEffectTest(unittest.TestCase):
    def test_module_state_objects_exist(self) -> None:
        self.assertIsInstance(d.CONFIG, d.DaemonConfig)
        self.assertIsInstance(d.STATE, d.RuntimeState)
        self.assertIsInstance(d.BOOT, d.BootState)
        self.assertEqual(d.VERSION, "0.3.0")
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
                "version": "0.3.0",
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
        self.assertEqual(config.version, "0.3.0")
        self.assertEqual(config.contract["limits"]["width"]["max"], 1536)
        self.assertTrue(config.allow_no_auth)

    def test_aliases_are_supported(self) -> None:
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
        self.assertEqual(config.auth_token, "tok2")
        self.assertEqual(config.ntfy_topic, "topic-2")
        self.assertEqual(config.idle_timeout_sec, 300)
        self.assertEqual(config.preset_id, "sdxl-turbo")
        self.assertEqual(config.log_level, "warn")
        self.assertTrue(config.allow_no_auth)
        self.assertEqual(config.preload["base"], "org/base")

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
        self.assertEqual(config.contract["version"], "0.3.0")

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
        self.assertEqual(d.protocol_version(), "0.3.0")

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


class AuthTest(DaemonUnitTest):
    def test_missing_token_returns_401_by_default(self) -> None:
        handler, sent = make_handler("Bearer anything")
        self.assertFalse(handler._require_auth())
        self.assertEqual(sent[0][0], 401)
        self.assertEqual(sent[0][1]["error"]["code"], "unauthorized")

    def test_missing_token_allowed_with_allow_no_auth(self) -> None:
        d.CONFIG.allow_no_auth = True
        handler, sent = make_handler()
        self.assertTrue(handler._require_auth())
        self.assertEqual(sent, [])

    def test_correct_bearer_token_passes(self) -> None:
        d.CONFIG.auth_token = AUTH_TOKEN
        handler, sent = make_handler(f"Bearer {AUTH_TOKEN}")
        self.assertTrue(handler._require_auth())
        self.assertEqual(sent, [])

    def test_wrong_bearer_token_returns_401(self) -> None:
        d.CONFIG.auth_token = AUTH_TOKEN
        for header in ("Bearer wrong", AUTH_TOKEN, "Basic abc"):
            handler, sent = make_handler(header)
            self.assertFalse(handler._require_auth(), header)
            self.assertEqual(sent[0][1]["error"]["code"], "unauthorized")

    def test_auth_missing_matrix(self) -> None:
        self.assertTrue(d.auth_missing())
        d.CONFIG.allow_no_auth = True
        self.assertFalse(d.auth_missing())
        d.CONFIG.allow_no_auth = False
        d.CONFIG.auth_token = AUTH_TOKEN
        self.assertFalse(d.auth_missing())


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


class ValidateSpecTest(DaemonUnitTest):
    def test_accepts_minimal_request_with_defaults(self) -> None:
        pipeline, model_id, tasks = d.validate_generate_spec(make_spec())
        self.assertEqual(pipeline["loader"], "sdxl")
        self.assertEqual(model_id, "org/base-model")
        task = tasks[0]
        self.assertEqual(task["name"], "01")
        self.assertEqual(task["width"], 1024)
        self.assertEqual(task["height"], 1024)
        self.assertEqual(task["steps"], 4)
        self.assertEqual(task["cfg"], 0.0)
        self.assertGreaterEqual(task["seed"], 0)
        self.assertEqual(task["negative_prompt"], "")

    def test_rejects_structurally_bad_requests(self) -> None:
        for bad in (
            None,
            [],
            {},
            {"pipeline": {"loader": "nope", "base": "b"}, "tasks": [{"prompt": "x"}]},
            {"pipeline": {"loader": "sdxl", "base": ""}, "tasks": [{"prompt": "x"}]},
            {"pipeline": make_pipeline(), "tasks": []},
            {"pipeline": make_pipeline(), "tasks": ["not-a-dict"]},
            {"pipeline": make_pipeline(), "tasks": [{"prompt": "   "}]},
        ):
            with self.assertRaises(d.RequestError):
                d.validate_generate_spec(bad)

    def test_explicit_name_and_seed_are_kept(self) -> None:
        _, _, tasks = d.validate_generate_spec(
            make_spec([{"name": "custom", "prompt": "p", "seed": 42, "width": 640, "height": 384}])
        )
        self.assertEqual(tasks[0]["name"], "custom")
        self.assertEqual(tasks[0]["seed"], 42)
        self.assertEqual(tasks[0]["width"], 640)
        self.assertEqual(tasks[0]["height"], 384)

    def test_contract_bounds_are_enforced(self) -> None:
        self.contract_config()
        cases = [
            ("width", 255),
            ("width", 1537),
            ("height", 255),
            ("height", 1537),
            ("steps", 0),
            ("steps", 61),
            ("seed", 2147483648),
        ]
        for field, value in cases:
            task = {"prompt": "p"}
            task[field] = value
            with self.assertRaises(d.RequestError, msg=f"{field}={value} 应被拒绝"):
                d.validate_generate_spec(make_spec([task]))

    def test_contract_accepts_inclusive_bounds(self) -> None:
        self.contract_config()
        for field, value in (("width", 256), ("width", 1536), ("height", 256), ("height", 1536)):
            _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", field: value}]))
            self.assertEqual(tasks[0][field], value)
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "steps": 60, "seed": 2147483647}]))
        self.assertEqual(tasks[0]["steps"], 60)
        self.assertEqual(tasks[0]["seed"], 2147483647)

    def test_contract_cfg_bounds(self) -> None:
        self.contract_config()
        for value in (-0.1, 20.1):
            with self.assertRaises(d.RequestError):
                d.validate_generate_spec(make_spec([{"prompt": "p", "cfg": value}]))
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "cfg": 20}]))
        self.assertEqual(tasks[0]["cfg"], 20.0)

    def test_contract_limits_task_count(self) -> None:
        self.contract_config()
        four = [{"prompt": f"p{i}"} for i in range(4)]
        self.assertEqual(len(d.validate_generate_spec(make_spec(four))[2]), 4)
        five = [{"prompt": f"p{i}"} for i in range(5)]
        with self.assertRaises(d.RequestError) as ctx:
            d.validate_generate_spec(make_spec(five))
        self.assertIn("最多 4 个任务", str(ctx.exception))

    def test_contract_prompt_length_limit(self) -> None:
        self.contract_config()
        long_prompt = "字" * 2001
        with self.assertRaises(d.RequestError) as ctx:
            d.validate_generate_spec(make_spec([{"prompt": long_prompt}]))
        self.assertIn("2000", str(ctx.exception))
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "字" * 2000}]))
        self.assertEqual(len(tasks[0]["prompt"]), 2000)

    def test_dimensions_are_floored_to_step(self) -> None:
        self.contract_config()
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "width": 1535, "height": 263}]))
        self.assertEqual(tasks[0]["width"] % 8, 0)
        self.assertEqual(tasks[0]["height"] % 8, 0)
        self.assertLessEqual(tasks[0]["width"], 1536)
        self.assertGreaterEqual(tasks[0]["height"], 256)

    def test_falls_back_without_contract(self) -> None:
        # 契约缺失 = 旧 Host / 本地调试：沿用 0.3.0 之前的边界。
        self.assertEqual(d._max_tasks(), 8)
        eight = [{"prompt": f"p{i}"} for i in range(8)]
        self.assertEqual(len(d.validate_generate_spec(make_spec(eight))[2]), 8)
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(make_spec([{"prompt": "p"}] * 9))
        _, _, tasks = d.validate_generate_spec(
            make_spec([{"prompt": "p", "width": 64, "height": 2048, "steps": 80, "cfg": 30}])
        )
        self.assertEqual(tasks[0]["width"], 64)
        self.assertEqual(tasks[0]["height"], 2048)
        self.assertEqual(tasks[0]["steps"], 80)
        self.assertEqual(tasks[0]["cfg"], 30.0)


class LimitSpecTest(DaemonUnitTest):
    def test_partial_contract_is_merged_with_fallback(self) -> None:
        d.CONFIG.contract = {"limits": {"width": {"max": 1024}}}
        spec = d._limit_spec("width")
        self.assertEqual(spec["min"], 64)
        self.assertEqual(spec["max"], 1024)
        self.assertEqual(spec["step"], 8)

    def test_ignores_non_numeric_contract_values(self) -> None:
        d.CONFIG.contract = {"limits": {"steps": {"min": "x", "max": None, "step": True}}}
        spec = d._limit_spec("steps")
        self.assertEqual(spec["min"], 1)
        self.assertEqual(spec["max"], 80)
        # True 是 bool，不应被当成数字覆盖 step；steps 本身也没有 step 兜底键
        self.assertNotIn("step", spec)

    def test_empty_contract_uses_fallback(self) -> None:
        d.CONFIG.contract = {}
        self.assertEqual(d._limit_spec("steps")["max"], 80)
        self.assertEqual(d._limit_spec("cfg")["max"], 30)
        self.assertEqual(d._max_tasks(), 8)

    def test_count_limit_drives_max_tasks(self) -> None:
        d.CONFIG.contract = {"limits": {"count": {"min": 1, "max": 4}}}
        self.assertEqual(d._max_tasks(), 4)
        d.CONFIG.contract = {"limits": {"count": {"max": 0}}}
        self.assertEqual(d._max_tasks(), d._MAX_TASKS_FALLBACK)


class ClassifyFailureTest(DaemonUnitTest):
    def test_oom_is_detected_by_message(self) -> None:
        code, message = d.classify_failure(RuntimeError("CUDA out of memory. Tried to allocate"))
        self.assertEqual(code, "oom")
        self.assertTrue(message.startswith("显存不足"))

    def test_request_error_maps_to_invalid_request(self) -> None:
        code, _ = d.classify_failure(d.RequestError("tasks 为空"))
        self.assertEqual(code, "invalid_request")

    def test_load_error_maps_to_load_failed(self) -> None:
        code, _ = d.classify_failure(d.LoadError("模型加载失败"))
        self.assertEqual(code, "load_failed")

    def test_unknown_error_uses_default(self) -> None:
        self.assertEqual(d.classify_failure(ValueError("boom"))[0], "generation_failed")
        self.assertEqual(d.classify_failure(ValueError("boom"), default="load_failed")[0], "load_failed")


class HealthPayloadTest(DaemonUnitTest):
    REQUIRED_KEYS = {
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
        "last_error_code",
        "detail",
        "uptime_seconds",
    }

    def test_fields_are_complete(self) -> None:
        payload = d.health_payload()
        self.assertEqual(set(payload), self.REQUIRED_KEYS)
        self.assertEqual(payload["phase"], "booting")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["version"], "0.3.0")
        self.assertEqual(payload["idle_timeout_sec"], 1800)
        self.assertGreaterEqual(payload["idle_seconds"], 0)
        self.assertGreaterEqual(payload["uptime_seconds"], 0)

    def test_error_phase_flips_status(self) -> None:
        d.record_error("load_failed", "pip 失败")
        d.set_phase("error", "启动失败")
        payload = d.health_payload()
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["phase"], "error")
        self.assertEqual(payload["last_error_code"], "load_failed")
        self.assertEqual(payload["last_error"], "load_failed: pip 失败")
        self.assertEqual(payload["detail"], "启动失败")

    def test_queue_depth_follows_waiting(self) -> None:
        d.STATE.waiting = 3
        self.assertEqual(d.health_payload()["queue_depth"], 3)

    def test_loaded_list_is_a_copy(self) -> None:
        d.STATE.loaded = ["sdxl:org/base"]
        payload = d.health_payload()
        self.assertEqual(payload["loaded"], ["sdxl:org/base"])
        self.assertIsNot(payload["loaded"], d.STATE.loaded)


class LogRingTest(DaemonUnitTest):
    def test_incremental_pagination(self) -> None:
        d._ring_append("line-1")
        self.assertEqual(d.log_since(0), (["line-1"], 1))
        self.assertEqual(d.log_since(1), ([], 1))
        d._ring_append("line-2")
        d._ring_append("line-3")
        self.assertEqual(d.log_since(1), (["line-2", "line-3"], 3))
        self.assertEqual(d.log_since(3), ([], 3))

    def test_ring_trimming_keeps_latest(self) -> None:
        total_lines = d.LOG_MAX_LINES + 10
        for index in range(total_lines):
            d._ring_append(f"line-{index}")
        lines, nxt = d.log_since(0)
        self.assertEqual(len(lines), d.LOG_MAX_LINES)
        self.assertEqual(nxt, total_lines)
        self.assertEqual(lines[-1], f"line-{total_lines - 1}")
        # since 大于总数时不应回绕
        self.assertEqual(d.log_since(total_lines + 5), ([], total_lines))

    def test_log_adds_timestamp_prefix(self) -> None:
        d.log("普通进度行")
        lines, _ = d.log_since(0)
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("["))
        self.assertIn("普通进度行", lines[0])


class LogNoiseTest(DaemonUnitTest):
    def test_tqdm_style_noise_is_filtered(self) -> None:
        d.log("  50%|█████     | 5/10")
        lines, _ = d.log_since(0)
        self.assertEqual(lines, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)