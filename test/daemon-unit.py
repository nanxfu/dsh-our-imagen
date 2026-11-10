#!/usr/bin/env python3
"""remote/daemon.py 的纯逻辑单测（不需要 torch / GPU / 网络 / 端口）。

定位：只覆盖"可以在本机直接 import 并调用"的部分，作为 daemon 重构的安全网；
真正的推理链路只能靠人工 gpu-live / kaggle-live 验证。

覆盖：
  1. 模块导入无副作用（无服务器、无隧道、无后台线程）
  2. load_config / _build_config：精确键、未知键告警、contract / allow_no_auth
  3. protocol_version：契约 version → 注入 version → 文件常量
  4. validate_generate_spec：契约边界（尺寸 256-1536/8 对齐、steps 1-60、cfg 0-20、
     任务数 1-4、seed ≤2147483647、prompt ≤2000）、契约缺失回退、默认值
  5. _require_auth / auth_missing：无 token 401、allow_no_auth 放行、Bearer 校验
  6. fail_boot：phase=error + 错误记录 + 隧道原因，且不发布 ready
  7. classify_failure：oom / invalid_request / load_failed / generation_failed
  8. health_payload：字段齐全、phase=error → status=error、queue_depth 跟随 waiting、
     tunnel_provider / tunnel_state / tunnel_restarts 跟随 BOOT
  9. log_since：绝对序号、增量分页、环形裁剪
 10. _limit_spec / _max_tasks：契约合并与兜底
 11. 可选注入配置：hf_token / pip_constraints / fallback_tunnel_command /
     fallback_tunnel_url_regex / local_models 的解析、过滤与敏感值不落日志
 12. 冷启动加固：HF_TOKEN 环境变量、约束合并与 -c 文件、import 自检、磁盘预检
 13. 权重预挂载：local_models 命中判定、LoRA 权重解析与路径逃逸拒绝
 14. 隧道工具函数：命令规整、URL 提取、provider 计划、指数退避
 15. 隧道监管：输出读取（假 Popen/假 stream）、单通道尝试、备用通道回退、
     失败重拉与 ready 重播、/shutdown 停止监管
 16. ready payload 增加 provider，隧道恢复后清掉 tunnel_failed 错误态

运行：python test/daemon-unit.py
"""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import types
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

# 与 shared/contract.js 的 daemonContract() 同形：daemon 只消费 version 与 limits。
CONTRACT = {
    "version": "0.4.1",
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


class FakeProc:
    """subprocess.Popen 的最小替身：stderr 用可迭代序列，poll/wait 返回固定退出码。"""

    def __init__(self, lines=None, code: int = 0):
        self.stderr = iter(list(lines or []))
        self._code = code
        self.terminated = False
        self.killed = False

    def poll(self):  # noqa: ANN201
        return self._code

    def wait(self, timeout=None):  # noqa: ANN001, ANN201
        return self._code

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True


def fake_usage(free_gb: float):  # noqa: ANN201
    """返回一个 shutil.disk_usage 替身，free 固定为给定 GiB。"""

    def usage(_path):  # noqa: ANN001
        return types.SimpleNamespace(free=int(free_gb * 2**30), total=int(20 * 2**30))

    return usage


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
        self.assertEqual(d.VERSION, "0.4.1")
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
        self.assertEqual(config.contract["version"], "0.4.1")

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
        self.assertEqual(d.protocol_version(), "0.4.1")

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
        "tunnel_provider",
        "tunnel_state",
        "tunnel_restarts",
    }

    def test_fields_are_complete(self) -> None:
        payload = d.health_payload()
        self.assertEqual(set(payload), self.REQUIRED_KEYS)
        self.assertEqual(payload["phase"], "booting")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["version"], "0.4.1")
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


class DiskPrecheckTest(DaemonUnitTest):
    """P1.2 Flux.2 磁盘预检：×1.15 估算、充足/不足判定、预挂载跳过。"""

    def test_required_download_adds_headroom(self) -> None:
        self.assertEqual(d.required_download_gb({"downloadGb": 15.2}), 17.48)
        self.assertEqual(d.required_download_gb({"downloadGb": 6.78}), 7.8)
        for bad in ({}, {"downloadGb": None}, {"downloadGb": "6.5"}, {"downloadGb": True}, {"downloadGb": -1}):
            self.assertIsNone(d.required_download_gb(bad))

    def test_precheck_reports_gap(self) -> None:
        spec = {"base": "black-forest-labs/FLUX.2-klein-4B", "downloadGb": 15.2}
        result = d.disk_precheck(spec, root="/kaggle/working", usage=fake_usage(10.0))
        self.assertEqual(result["required_gb"], 17.48)
        self.assertEqual(result["free_gb"], 10.0)
        self.assertFalse(result["enough"])
        self.assertEqual(result["path"], "/kaggle/working")

    def test_insufficient_space_raises_readable_error(self) -> None:
        spec = {"base": "black-forest-labs/FLUX.2-klein-4B", "downloadGb": 15.2}
        result = d.disk_precheck(spec, root="/kaggle/working", usage=fake_usage(10.0))
        with mock.patch.object(d, "disk_precheck", return_value=result):
            with self.assertRaises(d.LoadError) as ctx:
                d.ensure_disk_capacity(spec)
        message = str(ctx.exception)
        self.assertIn("磁盘空间不足", message)
        self.assertIn("需 17.5 GiB", message)
        self.assertIn("可用 10.0 GiB", message)

    def test_sufficient_space_logs_and_passes(self) -> None:
        result = {"required_gb": 17.48, "free_gb": 19.0, "path": "/kaggle/working", "enough": True}
        with mock.patch.object(d, "disk_precheck", return_value=result):
            d.ensure_disk_capacity({"base": "org/model", "downloadGb": 15.2})
        self.assertLogContains("磁盘预检通过")

    def test_usage_error_skips_check(self) -> None:
        def broken(_path):
            raise OSError("denied")

        self.assertIsNone(d.disk_precheck({"base": "x", "downloadGb": 1}, root="R", usage=broken))
        self.assertLogContains("跳过预检")

    def test_mounted_weights_skip_check(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "model_index.json").write_text("{}", encoding="utf-8")
            d.CONFIG.local_models = {"org/base": directory}
            with mock.patch.object(d, "disk_precheck", side_effect=AssertionError("预挂载时不应做磁盘预检")):
                d.ensure_disk_capacity({"base": "org/base", "downloadGb": 15.2})
        self.assertLogContains("跳过磁盘预检")

    def test_usage_root_falls_back_to_cwd(self) -> None:
        with mock.patch.object(d.os.path, "isdir", return_value=False):
            self.assertEqual(d.disk_usage_root(), os.getcwd())


class LocalModelTest(DaemonUnitTest):
    """P2.1 权重预挂载：命中判定与路径安全。"""

    def test_resolve_local_model_requires_model_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            d.CONFIG.local_models = {"org/base": directory}
            self.assertIsNone(d.resolve_local_model("org/base"))
            self.assertLogContains("缺少 model_index.json")
            Path(directory, "model_index.json").write_text("{}", encoding="utf-8")
            self.assertEqual(d.resolve_local_model("org/base"), directory)
            self.assertIsNone(d.resolve_local_model("org/other"))
            self.assertIsNone(d.resolve_local_model(""))

    def test_resolve_local_weight_prefers_mounted_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            weight = Path(directory, "lora.safetensors")
            weight.write_bytes(b"stub")
            d.CONFIG.local_models = {"org/lora": directory}
            self.assertEqual(d.resolve_local_weight("org/lora", "lora.safetensors"), str(weight))
            self.assertIsNone(d.resolve_local_weight("org/lora", "missing.safetensors"))
            self.assertLogContains("回退在线下载")
            self.assertIsNone(d.resolve_local_weight("org/other", "lora.safetensors"))
            self.assertIsNone(d.resolve_local_weight("org/lora", ""))

    def test_resolve_local_weight_rejects_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            d.CONFIG.local_models = {"org/lora": directory}
            self.assertIsNone(d.resolve_local_weight("org/lora", os.path.join("..", "evil.safetensors")))
        self.assertLogContains("越出预挂载目录")


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
        with mock.patch.object(d, "_spawn_tunnel_process", return_value=proc):
            result = d.tunnel_attempt(item)
        self.assertEqual(result, ("cloudflare", proc))
        self.assertEqual(d.BOOT.tunnel_url, "https://x1.trycloudflare.com")

    def test_attempt_failure_terminates_process(self) -> None:
        proc = FakeProc(["boom"], code=2)
        item = {"provider": "custom", "argv": ["bore"], "url_re": d.DEFAULT_CUSTOM_URL_RE, "wait_sec": 0.2}
        with mock.patch.object(d, "_spawn_tunnel_process", return_value=proc):
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
        with mock.patch.object(d, "ensure_cloudflared", side_effect=RuntimeError("download blocked")), mock.patch.object(
            d, "_spawn_tunnel_process", return_value=proc
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

        with mock.patch.object(d, "start_tunnel", side_effect=lambda _port: outcomes.pop(0)), mock.patch.object(
            d, "tunnel_restart_delay", return_value=0.001
        ), mock.patch.object(d, "tunnel_wait_exit", side_effect=fake_wait), mock.patch.object(
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
        with mock.patch.object(d, "start_tunnel", side_effect=AssertionError("不应尝试启动隧道")):
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
        with mock.patch.object(d, "start_tunnel", side_effect=lambda _port: outcomes.pop(0)), mock.patch.object(
            d, "tunnel_restart_delay", return_value=0.001
        ), mock.patch.object(d, "tunnel_wait_exit", side_effect=fake_wait), mock.patch.object(
            d, "publish_ready", side_effect=lambda: published.append(True)
        ):
            d.tunnel_monitor(7860)
        self.assertEqual(d.STATE.phase, "ready", "隧道中途退出不应把 daemon 判成 error")
        self.assertEqual(len(published), 2, "每次隧道就绪都应重播 ready")
        self.assertEqual(d.BOOT.tunnel_restarts, 1)
        self.assertLogContains("进程退出（退出码 9）")


if __name__ == "__main__":
    unittest.main(verbosity=2)