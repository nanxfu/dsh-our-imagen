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
  8. health_payload：字段齐全、phase=error → status=error、queue_depth 跟随 job 队列、
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
 17. 异步 job（0.5.0）：POST /generate 202 入队、jobId 幂等与格式校验、
     GET /job 的 queued/running/done/failed 视图、未知 id 404、保留/淘汰、
     worker 执行成功与失败、/health.queue_depth
  18. anima 运行时单份源码（remote/anima_runtime.py，daemon 只 import 一次）与
      run_task 回传实际出图尺寸（PIL image.size，而不是请求宽高）
  19. 缓存探针：[cache] 日志含 HF 缓存目录/挂载点/剩余空间，token 值不落日志（含路径
      里夹带 token 时的脱敏），读盘失败降级为 unknown，进程内只打一次
 20. M4.1 切模型 LRU 缓存清理：pipeline 依赖仓库递归收集、缓存目录名还原 repo id、
      keep_set（含 local_models 预挂载）、按 mtime 旧→新逐出、达标即停、空间不足
      抛 LoadError；盘空间默认按 HF 缓存目录测量
 21. M3.3 无 GPU：phase=error / last_error_code='gpu_unavailable'、文案含手机号验证与
      GPU 加速器、ntfy error 事件带码；torch 导入失败仍归 load_failed
 22. M4.2 /health.versions：依赖版本快照只含纯版本号，取不到省略，不含 token / 路径
 23. cloudflared 固定版本下载（v0.9 M1）：tag/URL/SHA256 常量一致、流式下载校验、
     下载异常与校验不匹配各重试一次、超大小上限中止、已存在可执行文件复用
     （假 urlopen / 假响应流，不联网）
 24. 图生图（v0.9 M3）：参考图提交期校验（loader 白名单 / base64 / 原始字节上限 /
     PNG-JPEG / 最小长边 / strength 钳制，边界取自注入契约）、执行期完整解码一次与
     等比 LANCZOS 缩放、from_pipe 惰性复用（只调用一次）与 release_pipeline 清理、
     run_task 的 img2img kwargs / 日志 / 结果字段、txt2img 分支不回归、
     请求体上限按契约参考图体积推导（假 PIL / 假 diffusers，不依赖 Pillow）
 25. /health.gpu_memory：只读显存快照（MiB 取整），torch 未加载 / CUDA 不可用 /
     读取异常时为 null，且不影响 status / phase 判定
 26. 状态与配置的模块边界（架构规格 §5.10）：CONFIG / STATE / BOOT 与 remote/config.py、
     remote/state.py 里的单例是**同一对象**，load_config() 原地回填，daemon 不得重新绑定；
     log_ring 只有一份（config / state 必须扁平导入，否则 /logs 会变空）
 27. 基础设施与观测层的模块边界：pip 环境只由 pipeline_loader.pip_env() 构造、
     IMPORT_CHECK_CODE 由模块清单生成、/health 的 queue_depth 必须在释放 STATE_LOCK
     之后取（§5.8 锁顺序，反向嵌套会与 _finish_job 死锁）

运行：python test/daemon-unit.py
"""

from __future__ import annotations

import base64
import contextlib
import dataclasses
import hashlib
import importlib.util
import inspect
import io
import json
import os
import re
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

try:  # 真实 Pillow 只用于可选集成用例；逻辑用例一律用下面的假 PIL 替身（CI 不装 Pillow 也能跑）。
    from PIL import Image as _RealPILImage

    HAS_PILLOW = True
except Exception:  # pragma: no cover - 极简环境
    _RealPILImage = None
    HAS_PILLOW = False

ROOT = Path(__file__).resolve().parent.parent
DAEMON_PATH = ROOT / "remote" / "daemon.py"
ANIMA_RUNTIME_PATH = ROOT / "remote" / "anima_runtime.py"

# 版本号只在 shared/contract.js 维护：测试期望值从生成物 remote/contract.json 读取，
# 升版本时不必改这里的常量（npm run test:contract 会先校验生成物与契约一致）。
CONTRACT_DOC = json.loads((ROOT / "remote" / "contract.json").read_text(encoding="utf-8"))
CONTRACT_VERSION = CONTRACT_DOC["version"]


def _load_daemon():
    """按路径加载 daemon.py（模块级只定义常量/状态对象，不会启动任何东西）。

    必须先把自己注册进 sys.modules：dataclass 在 class 创建时要按 ``cls.__module__``
    回查模块命名空间，模块不在 sys.modules 里会抛 AttributeError。

    另外要把 remote/ 与仓库根一起放进 sys.path：daemon.py 用 ``from anima_runtime import ...``
    取同目录的 anima 运行时，拆出去的子模块用绝对包导入（``from remote.errors import ...``）
    取仓库根下的 ``remote`` 包；按路径加载时 sys.path 里两个都没有。推 Kaggle 时启动器
    会解包源码包并把同样的两个目录挂进 sys.path（见 remote/_entry.py 的 unpack），行为一致。
    """
    remote_dir = str(ROOT / "remote")
    if remote_dir not in sys.path:
        sys.path.insert(0, remote_dir)
    root_dir = str(ROOT)
    if root_dir not in sys.path:
        sys.path.insert(0, root_dir)
    spec = importlib.util.spec_from_file_location("imagen_daemon_under_test", DAEMON_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {DAEMON_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


d = _load_daemon()

# 单例与常量的真实宿主：daemon 只是 re-export，断言"两边是同一个对象"必须直接看这些模块。
import remote.config as remote_config  # noqa: E402
import remote.infra.process as remote_process  # noqa: E402
import remote.observability.health as remote_health  # noqa: E402
import remote.state as remote_state  # noqa: E402
import remote.text as remote_text  # noqa: E402

AUTH_TOKEN = "test-token-0123456789"

# 与 shared/contract.js 的 daemonContract() 同形：daemon 只消费 version 与 limits。
CONTRACT = {
    "version": CONTRACT_VERSION,
    "limits": {
        "width": {"min": 256, "max": 1536, "step": 8},
        "height": {"min": 256, "max": 1536, "step": 8},
        "steps": {"min": 1, "max": 60},
        "cfg": {"min": 0, "max": 20},
        "count": {"min": 1, "max": 4},
        "seed": {"max": 2147483647},
        "prompt": {"maxChars": 2000},
        # 图生图边界同样从生成物读取：用例一律以契约值为准，不写死数值。
        "reference": CONTRACT_DOC["limits"]["reference"],
        "strength": CONTRACT_DOC["limits"]["strength"],
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


def make_generate_handler(spec):
    """伪造 DaemonHandler：只桩掉 _handle_generate 用到的 _read_json / _send_*。"""
    handler = object.__new__(d.DaemonHandler)
    sent: list[tuple[int, dict]] = []
    handler._send_json = lambda code, payload, extra_headers=None: sent.append((code, payload))
    handler._send_error = lambda code, error_code, message, headers=None: sent.append(
        (code, {"error": {"code": error_code, "message": message}})
    )
    handler._read_json = lambda: spec
    return handler, sent


def make_get_handler(path: str):
    """伪造 DaemonHandler：只跑 do_GET 的路由分派（鉴权直接放行）。"""
    handler = object.__new__(d.DaemonHandler)
    handler.path = path
    handler._require_auth = lambda: True
    sent: list[tuple[int, dict]] = []
    handler._send_json = lambda code, payload, extra_headers=None: sent.append((code, payload))
    handler._send_error = lambda code, error_code, message, headers=None: sent.append(
        (code, {"error": {"code": error_code, "message": message}})
    )
    return handler, sent


# 一次合法的任务（字段与 validate_generate_spec 的输出一致，直接喂给 job 逻辑）。
TASKS = [
    {
        "name": "01",
        "prompt": "雾中荷塘，工笔",
        "negative_prompt": "",
        "seed": 42,
        "width": 256,
        "height": 256,
        "steps": 4,
        "cfg": 0.0,
    }
]


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


class FakeResponse:
    """urllib.request.urlopen 返回值的最小替身：read(n) 逐块返回，支持 with 语句。"""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self._index = 0

    def read(self, size=-1):  # noqa: ANN001, ANN201
        if self._index >= len(self._chunks):
            return b""
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *exc_info):  # noqa: ANN002, ANN204
        return False


def make_urlopen(responses, calls):  # noqa: ANN001, ANN201
    """urlopen 替身：按调用次序返回假响应；responses 项是 bytes 块列表、异常或假响应对象。"""

    queue = list(responses)

    def fake_urlopen(url, timeout=None):  # noqa: ANN001, ANN202
        calls.append(url)
        if not queue:
            raise AssertionError("urlopen 调用次数超出用例预期")
        item = queue.pop(0)
        if isinstance(item, BaseException):
            raise item
        if hasattr(item, "read"):
            return item
        return FakeResponse(item)

    return fake_urlopen


def fake_usage(free_gb: float):  # noqa: ANN201
    """返回一个 shutil.disk_usage 替身，free 固定为给定 GiB。"""

    def usage(_path):  # noqa: ANN001
        return types.SimpleNamespace(free=int(free_gb * 2**30), total=int(20 * 2**30))

    return usage


# ── 假 PIL：图生图参考图相关用例的替身 ────────────────────────────────────────
# daemon 里 PIL 是惰性 import（真实运行环境由 diffusers 依赖 Pillow 保证）；
# 单测注入假模块，既能覆盖分支，又不需要 CI 预装 Pillow。


class FakePILImage:
    """PIL Image 的最小替身：记录 load/resize/convert 调用，size/format/mode 可控。"""

    def __init__(self, size, fmt: str = "PNG", mode: str = "RGB"):
        self.size = (int(size[0]), int(size[1]))
        self.format = fmt
        self.mode = mode
        self.loaded = False
        self.closed = False
        self.resized = None
        self.converted = None
        self.load_error: Exception | None = None

    def load(self):  # noqa: ANN201
        if self.load_error is not None:
            raise self.load_error
        self.loaded = True
        return self

    def resize(self, size, resample=None):  # noqa: ANN001, ANN201
        self.resized = ((int(size[0]), int(size[1])), resample)
        clone = FakePILImage(size, self.format, self.mode)
        clone.resized = self.resized
        return clone

    def convert(self, mode):  # noqa: ANN001, ANN201
        self.converted = mode
        clone = FakePILImage(self.size, self.format, mode)
        clone.converted = mode
        return clone

    def close(self) -> None:
        self.closed = True


class FakeUnidentifiedImageError(OSError):
    """对应 PIL.UnidentifiedImageError（Pillow 里是 OSError 的子类）。"""


class FakeDecompressionBombError(Exception):
    """对应 PIL.Image.DecompressionBombError。"""


def fake_pil_modules(open_impl):  # noqa: ANN001, ANN201
    """构造可注入 sys.modules 的假 PIL 包（PIL / PIL.Image）。"""
    image_module = types.ModuleType("PIL.Image")
    image_module.LANCZOS = "LANCZOS"
    image_module.Resampling = types.SimpleNamespace(LANCZOS="LANCZOS")
    image_module.UnidentifiedImageError = FakeUnidentifiedImageError
    image_module.DecompressionBombError = FakeDecompressionBombError
    image_module.open = open_impl
    package = types.ModuleType("PIL")
    package.Image = image_module
    package.UnidentifiedImageError = FakeUnidentifiedImageError
    return {"PIL": package, "PIL.Image": image_module}


def fake_pil_for(image):  # noqa: ANN001, ANN201
    """固定返回同一个假图的 PIL 替身。"""

    def fake_open(_stream):  # noqa: ANN001, ANN202
        return image

    return fake_pil_modules(fake_open)


def fake_pil_raising(exc: Exception):  # noqa: ANN001, ANN201
    def fake_open(_stream):  # noqa: ANN001, ANN202
        raise exc

    return fake_pil_modules(fake_open)


def make_reference_b64(payload: bytes = b"fake-image-bytes") -> str:
    """参考图请求里的 image_b64：假 PIL 不真正解析内容，只关心 base64 是否合法。"""
    return base64.b64encode(payload).decode("ascii")


def make_reference(image_b64: str | None = None, strength=None) -> dict:  # noqa: ANN001
    """构造 job 级 reference 请求体；strength 缺省时不写该键（走契约默认值）。"""
    payload = {"image_b64": make_reference_b64() if image_b64 is None else image_b64}
    if strength is not None:
        payload["strength"] = strength
    return payload


class FakeTorchGenerator:
    """torch.Generator 的替身：记录 device 与 manual_seed 的取值。"""

    def __init__(self, device):
        self.device = device
        self.seed = None

    def manual_seed(self, seed):  # noqa: ANN001, ANN202
        self.seed = seed
        return self


def fake_torch_module():  # noqa: ANN201
    """run_task 只用 torch.Generator 与 torch.cuda；返回可注入的假模块。"""
    torch_module = types.ModuleType("torch")
    torch_module.cuda = types.SimpleNamespace(is_available=lambda: False, synchronize=lambda: None)
    torch_module.Generator = FakeTorchGenerator
    return torch_module


def reset_stateful_singletons() -> None:
    """把 CONFIG / STATE / BOOT 三个单例按 dataclass 默认值**原地**重置。

    为什么不能写 `d.CONFIG = d.DaemonConfig()`：实现在 remote/config.py 与
    remote/state.py，被测函数读的是那两个模块里的单例对象；在测试里重新绑定只改了
    `daemon` 命名空间里的名字，断言会静默测到旧对象（假绿，见架构规格 §5.10）。
    所以夹具统一走"逐字段覆盖默认值"，对象身份保持不变。

    动态挂上去的属性（如 `STATE.waiting = 3` 这种 0.4.x 历史字段）不在 dataclass 声明里，
    逐字段覆盖删不掉，必须显式 `delattr`，否则会跨用例残留。
    """
    for target, fresh in (
        (d.CONFIG, d.DaemonConfig()),
        (d.STATE, d.RuntimeState()),
        (d.BOOT, d.BootState()),
    ):
        declared = {item.name for item in dataclasses.fields(target)}
        for name in set(vars(target)) - declared:
            delattr(target, name)
        for item in dataclasses.fields(target):
            setattr(target, item.name, getattr(fresh, item.name))


class DaemonUnitTest(unittest.TestCase):
    """公共夹具：每个用例把 CONFIG/STATE/BOOT 重置为初始值，并把日志导出到内存。"""

    def setUp(self) -> None:
        self._prev_stdout = d.reset_log_ring(io.StringIO())
        reset_stateful_singletons()
        # 异步 job registry 是模块级可变状态，用例之间必须清干净。
        with d.JOB_LOCK:
            d.JOB_QUEUE.clear()
            d.JOB_TABLE.clear()
            d.JOB_FINISHED_ORDER.clear()
        d.JOB_WAKE.clear()

    def tearDown(self) -> None:
        # 同样原地重置：不重置的话，后运行的用例（如 ImportSideEffectTest）会看到上一个
        # 用例残留的 phase / 隧道状态。
        reset_stateful_singletons()
        d.reset_log_ring(self._prev_stdout)

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
        """anima 运行时只有 remote/anima_runtime.py 一份；daemon 只 import 不复制实现。"""
        self.assertEqual(d.load_anima_runtime.__module__, "anima_runtime")
        runtime_module = sys.modules.get("anima_runtime")
        self.assertIsNotNone(runtime_module, "daemon 应从同目录 anima_runtime 导入运行时")
        self.assertTrue(hasattr(runtime_module, "_anima_toolkit"))
        self.assertEqual(Path(runtime_module.__file__).resolve(), ANIMA_RUNTIME_PATH)
        source = DAEMON_PATH.read_text(encoding="utf-8")
        self.assertNotIn("def _anima_toolkit", source)
        self.assertNotIn("def load_anima_runtime", source)
        self.assertNotIn("@@INLINE", source, "内联标记已随源码包打包移除")
        self.assertIn("from anima_runtime import load_anima_runtime", source)


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


class RunTaskTest(DaemonUnitTest):
    """run_task：回传实际出图尺寸（PIL image.size），协议字段名保持不变。"""

    RESULT_KEYS = {
        "name",
        "seed",
        "seconds",
        "width",
        "height",
        "steps",
        "cfg",
        "png_bytes",
        "image_b64",
    }

    def make_pipe(self, image_size):  # noqa: ANN001, ANN202
        """假 pipe：记录本次调用参数，返回给定 PIL 尺寸的假图。"""

        class FakeImage:
            def __init__(self, size):
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-png")

        class FakePipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage(image_size)])

        return FakePipe()

    @staticmethod
    def fake_torch():
        """run_task 只用到 torch.Generator 与 torch.cuda，注入替身避免依赖真 torch。"""
        torch_module = types.ModuleType("torch")
        torch_module.cuda = types.SimpleNamespace(
            is_available=lambda: False, synchronize=lambda: None
        )
        torch_module.Generator = lambda device: types.SimpleNamespace(manual_seed=lambda seed: device)
        return torch_module

    def run_with(self, image_size, task):  # noqa: ANN001, ANN202
        pipe = self.make_pipe(image_size)
        with mock.patch.dict(sys.modules, {"torch": self.fake_torch()}):
            result = d.run_task(pipe, task)
        return pipe, result

    def test_reports_actual_image_size(self) -> None:
        # anima 会把 648 向下取整到 640：回传必须是 PIL 的实际尺寸，而不是请求值。
        pipe, result = self.run_with((640, 640), dict(TASKS[0], width=648, height=648))
        self.assertEqual(pipe.calls[0]["width"], 648)
        self.assertEqual(pipe.calls[0]["height"], 648)
        self.assertEqual((result["width"], result["height"]), (640, 640))
        self.assertIn("实际出图 640x640（请求 648x648）", self.logs())

    def test_size_tuple_is_width_height_order(self) -> None:
        # PIL Image.size 的顺序是 (width, height)，不能写反。
        _pipe, result = self.run_with((768, 512), dict(TASKS[0], width=768, height=512))
        self.assertEqual((result["width"], result["height"]), (768, 512))
        self.assertNotIn("实际出图", self.logs())

    def test_protocol_fields_unchanged(self) -> None:
        _pipe, result = self.run_with((256, 256), TASKS[0])
        self.assertEqual(set(result), self.RESULT_KEYS)
        self.assertEqual(result["name"], TASKS[0]["name"])
        self.assertEqual(result["png_bytes"], len(b"fake-png"))
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-png")


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
        d.submit_job(make_pipeline(), "org/base-model", [{"prompt": "x"}])
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

        with mock.patch.object(d, "STATE_LOCK", lock), mock.patch.object(d, "queue_depth", fake_queue_depth):
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


class JobProtocolTest(DaemonUnitTest):
    """0.5.0 异步 job：202 入队 + GET /job 轮询 + worker 执行与保留策略。"""

    def ready(self) -> None:
        d.STATE.phase = "ready"

    def submit(self, task_count: int = 1, job_id: str | None = None):
        tasks = [dict(TASKS[0], name=f"{index + 1:02d}") for index in range(task_count)]
        return d.submit_job(make_pipeline(), "org/base-model", tasks, job_id)

    # ---- POST /generate：入队即返回 ----

    def test_generate_returns_202_and_enqueues(self) -> None:
        self.ready()
        handler, sent = make_generate_handler(make_spec(tasks=TASKS))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 202)
        payload = sent[0][1]
        self.assertEqual(payload["status"], "accepted")
        self.assertEqual(payload["model_id"], "org/base-model")
        self.assertTrue(payload["job_id"])
        self.assertTrue(payload["created_at"].endswith("Z"))
        self.assertEqual(d.queue_depth(), 1)

    def test_generate_honours_job_id_and_is_idempotent(self) -> None:
        self.ready()
        spec = dict(make_spec(tasks=TASKS), jobId="host-job-1")
        handler, sent = make_generate_handler(spec)
        d.DaemonHandler._handle_generate(handler)
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual([item[0] for item in sent], [202, 202])
        self.assertEqual([item[1]["job_id"] for item in sent], ["host-job-1", "host-job-1"])
        self.assertEqual(d.queue_depth(), 1)
        self.assertLogContains("幂等命中")

    def test_generate_rejects_invalid_job_id(self) -> None:
        self.ready()
        handler, sent = make_generate_handler(dict(make_spec(tasks=TASKS), jobId="bad id!"))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
        self.assertEqual(d.queue_depth(), 0)

    def test_generate_warms_up_when_not_ready(self) -> None:
        handler, sent = make_generate_handler(make_spec(tasks=TASKS))
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 503)
        self.assertEqual(sent[0][1]["error"]["code"], "warming")

    def test_generate_rejects_invalid_spec_synchronously(self) -> None:
        self.ready()
        bad = {"pipeline": {"loader": "nope", "base": "x"}, "tasks": [{"prompt": "x"}]}
        handler, sent = make_generate_handler(bad)
        d.DaemonHandler._handle_generate(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")

    # ---- job_payload 三态 ----

    def test_queued_payload(self) -> None:
        job, created = self.submit(task_count=2)
        self.assertTrue(created)
        payload = d.job_payload(job)
        self.assertEqual(payload["status"], "queued")
        self.assertEqual(payload["progress"], {"done": 0, "total": 2})
        self.assertIsNone(payload["results"])
        self.assertIsNone(payload["error"])
        self.assertIsNone(payload["load_seconds"])
        self.assertEqual(payload["job_id"], job.job_id)

    def test_done_payload_carries_results(self) -> None:
        job, _ = self.submit()
        job.results = [{"name": "01", "image_b64": "x"}]
        d._finish_job(job, d.JOB_STATUS_DONE)
        payload = d.job_payload(job)
        self.assertEqual(payload["status"], "done")
        self.assertEqual(payload["progress"], {"done": 1, "total": 1})
        self.assertEqual(payload["results"], [{"name": "01", "image_b64": "x"}])
        self.assertIsNone(payload["error"])

    def test_failed_payload_carries_error(self) -> None:
        job, _ = self.submit()
        d._finish_job(job, d.JOB_STATUS_FAILED, {"code": "oom", "message": "显存不足"})
        payload = d.job_payload(job)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error"]["code"], "oom")
        self.assertIsNone(payload["results"])

    # ---- GET /job ----

    def test_get_job_returns_payload(self) -> None:
        job, _ = self.submit()
        handler, sent = make_get_handler(f"/job?id={job.job_id}")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 200)
        self.assertEqual(sent[0][1]["job_id"], job.job_id)
        self.assertEqual(sent[0][1]["status"], "queued")

    def test_unknown_job_returns_404(self) -> None:
        handler, sent = make_get_handler("/job?id=missing")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 404)
        self.assertEqual(sent[0][1]["error"]["code"], "unknown_job")

    def test_missing_job_id_returns_400(self) -> None:
        handler, sent = make_get_handler("/job")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")

    def test_unknown_path_stays_404(self) -> None:
        handler, sent = make_get_handler("/nope")
        d.DaemonHandler.do_GET(handler)
        self.assertEqual(sent[0][0], 404)
        self.assertEqual(sent[0][1]["error"]["code"], "not_found")

    # ---- 保留 / 淘汰 ----

    def test_prunes_oldest_finished_beyond_limit(self) -> None:
        for index in range(d.JOB_MAX_FINISHED + 3):
            job, _ = self.submit(job_id=f"job-{index}")
            d._finish_job(job, d.JOB_STATUS_DONE)
        with d.JOB_LOCK:
            d.prune_jobs()
            self.assertEqual(len(d.JOB_TABLE), d.JOB_MAX_FINISHED)
        self.assertIsNone(d.get_job("job-0"))
        self.assertIsNotNone(d.get_job(f"job-{d.JOB_MAX_FINISHED + 2}"))

    def test_prunes_ttl_expired_finished(self) -> None:
        job, _ = self.submit(job_id="ttl-job")
        d._finish_job(job, d.JOB_STATUS_DONE)
        with d.JOB_LOCK:
            job.finished_at = time.time() - d.JOB_TTL_SEC - 1
            d.prune_jobs()
        self.assertIsNone(d.get_job("ttl-job"))

    def test_active_jobs_are_never_pruned(self) -> None:
        self.submit(job_id="queued-job")
        running, _ = self.submit(job_id="running-job")
        with d.JOB_LOCK:
            running.status = d.JOB_STATUS_RUNNING
            d.prune_jobs(time.time() + d.JOB_TTL_SEC * 10)
            self.assertEqual(len(d.JOB_TABLE), 2)
        self.assertIsNotNone(d.get_job("queued-job"))

    # ---- worker 执行 ----

    def test_execute_job_success_updates_progress_and_state(self) -> None:
        job, _ = self.submit(task_count=2)

        def fake_run_tasks(pipe, tasks, on_progress=None):  # noqa: ANN001, ANN202
            results = []
            for task in tasks:
                results.append({"name": task["name"], "image_b64": "x"})
                if on_progress is not None:
                    on_progress(results)
            return results

        with mock.patch.object(d, "ensure_pipeline", return_value=("pipe", 1.25)), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertEqual(job.load_seconds, 1.25)
        self.assertEqual(len(job.results), 2)
        self.assertEqual(d.STATE.jobs_done, 2)
        self.assertIsNone(job.error)
        self.assertLogContains("完成：2 张")

    def test_execute_job_failure_records_error(self) -> None:
        job, _ = self.submit()
        with mock.patch.object(d, "ensure_pipeline", side_effect=d.LoadError("pip 失败")):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "load_failed")
        self.assertEqual(d.STATE.last_error_code, "load_failed")
        self.assertLogContains("失败（load_failed）")

    def test_queue_depth_ignores_running_job(self) -> None:
        job, _ = self.submit(job_id="running-only")
        with d.JOB_LOCK:
            d.JOB_QUEUE.clear()
            job.status = d.JOB_STATUS_RUNNING
        self.assertEqual(d.queue_depth(), 0)
        self.assertEqual(d.active_job_count(), 1)

    def test_worker_drains_queue(self) -> None:
        drained = threading.Event()

        def fake_run_tasks(pipe, tasks, on_progress=None):  # noqa: ANN001, ANN202
            return []

        with mock.patch.object(d, "ensure_pipeline", return_value=("pipe", 0.0)), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            self.submit(job_id="worker-job")
            d.BOOT.stop_event.clear()
            thread = d.start_job_worker()
            try:
                deadline = time.time() + 3
                while time.time() < deadline:
                    job = d.get_job("worker-job")
                    if job is not None and job.status == d.JOB_STATUS_DONE:
                        drained.set()
                        break
                    time.sleep(0.02)
            finally:
                d.BOOT.stop_event.set()
                d.JOB_WAKE.set()
                thread.join(timeout=2)
        self.assertTrue(drained.is_set(), "worker 未在 3s 内消费完 job")


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

    def test_default_target_is_hf_cache_dir(self) -> None:
        # M4.1：默认按 HF 实际缓存目录量盘，而不是只看 /kaggle/working。
        with tempfile.TemporaryDirectory() as directory:
            expected = os.path.abspath(directory)
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": directory}, clear=False):
                result = d.disk_precheck({"base": "org/model", "downloadGb": 1.0}, usage=fake_usage(10.0))
        self.assertEqual(result["path"], expected)
        self.assertEqual(result["free_gb"], 10.0)
        self.assertTrue(result["enough"])

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


class CacheProbeTest(DaemonUnitTest):
    """远端 HF 缓存探针：目录/挂载点/剩余空间摘要、token 脱敏、异常降级、只打一次。"""

    def setUp(self) -> None:
        super().setUp()
        d._CACHE_PROBE_DONE = False

    def tearDown(self) -> None:
        d._CACHE_PROBE_DONE = False
        super().tearDown()

    def test_cache_dir_env_priority(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            env = {"HF_HUB_CACHE": first, "HUGGINGFACE_HUB_CACHE": second}
            with mock.patch.dict(os.environ, env, clear=False):
                self.assertEqual(d.hf_hub_cache_dir(), os.path.abspath(first))
                os.environ.pop("HF_HUB_CACHE")
                self.assertEqual(d.hf_hub_cache_dir(), os.path.abspath(second))

    def test_cache_dir_falls_back_to_default(self) -> None:
        empty = {name: "" for name in (*d.HF_CACHE_ENV_NAMES, "HF_HOME")}
        with mock.patch.dict(sys.modules, {"huggingface_hub.constants": None, "huggingface_hub": None}):
            with mock.patch.dict(os.environ, empty, clear=False):
                path = d.hf_hub_cache_dir()
        self.assertTrue(path.endswith(os.path.join(".cache", "huggingface", "hub")), path)

    def test_line_contains_cache_dir_mount_and_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            expected = os.path.abspath(directory)
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": directory}, clear=False):
                lines = d.cache_probe_lines()
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertTrue(line.startswith("[cache] "), line)
        self.assertIn(f"HF_HUB_CACHE={expected}", line)
        self.assertIn("mount=", line)
        self.assertIn("free=", line)
        self.assertIn("GiB", line)

    def test_working_dir_section_reports_mount_and_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": directory}, clear=False):
                with mock.patch.object(d.os.path, "isdir", return_value=True):
                    with mock.patch.object(d, "mount_point_of", return_value="/kaggle/working"):
                        with mock.patch.object(d, "probe_free_gib", return_value="12.3"):
                            line = d.cache_probe_lines()[0]
        self.assertIn("/kaggle/working mount=/kaggle/working free=12.3GiB", line)

    def test_mount_point_uses_longest_prefix(self) -> None:
        points = ["/", "/kaggle", "/kaggle/working"]
        self.assertEqual(d.longest_mount_prefix("/kaggle/working/hf/hub", points), "/kaggle/working")
        self.assertEqual(d.longest_mount_prefix("/kaggle/other", points), "/kaggle")
        self.assertEqual(d.longest_mount_prefix("/tmp/x", points), "/")
        self.assertEqual(d.longest_mount_prefix("/elsewhere", ["/kaggle"]), "")

    def test_read_mount_points_parses_and_decodes(self) -> None:
        # /proc/mounts 的路径字段会把空格转义成 \040，需要还原后才能做前缀匹配。
        table = (
            "/dev/sda1 / ext4 rw,relatime 0 0\n"
            "tmpfs /kaggle/\\040working tmpfs rw 0 0\n"
            "proc /proc proc rw 0 0\n"
            "garbage-line\n"
        )
        with mock.patch("builtins.open", mock.mock_open(read_data=table)):
            points = d.read_mount_points()
        self.assertEqual(points, ["/", "/kaggle/ working", "/proc"])

    def test_token_values_never_logged(self) -> None:
        secret = "hf_TOKEN_VALUE_never_logged"
        env = {"HF_TOKEN": secret, "HUGGING_FACE_HUB_TOKEN": secret}
        with tempfile.TemporaryDirectory() as directory:
            env["HF_HUB_CACHE"] = directory
            with mock.patch.dict(os.environ, env, clear=False):
                d._log_cache_probe()
        logs = self.logs()
        self.assertIn("[cache]", logs)
        self.assertIn("HF_HUB_CACHE=", logs)
        self.assertNotIn(secret, logs)

    def test_token_inside_cache_path_is_redacted(self) -> None:
        secret = "hf_SECRET_TOKEN_in_path"
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = os.path.join(directory, secret, "hub")
            env = {"HF_HUB_CACHE": cache_dir, "HF_TOKEN": secret}
            with mock.patch.dict(os.environ, env, clear=False):
                line = d.cache_probe_lines()[0]
        self.assertNotIn(secret, line)
        self.assertIn("***", line)

    def test_probe_degrades_on_usage_error(self) -> None:
        with mock.patch.object(d.shutil, "disk_usage", side_effect=OSError("denied")):
            with mock.patch.object(d, "read_mount_points", return_value=None):
                with mock.patch.object(d.os, "stat", side_effect=OSError("denied")):
                    lines = d.cache_probe_lines()
        self.assertEqual(len(lines), 1)
        self.assertIn("mount=unknown", lines[0])
        self.assertIn("free=unknown", lines[0])

    def test_mount_point_never_raises(self) -> None:
        with mock.patch.object(d, "read_mount_points", return_value=None):
            with mock.patch.object(d.os, "stat", side_effect=OSError("denied")):
                self.assertEqual(d.mount_point_of("no/such/dir"), "unknown")

    def test_first_load_logs_probe_only_once(self) -> None:
        with mock.patch.object(d, "build_pipeline", return_value=(object(), "sdxl:org/base")):
            d.ensure_pipeline({"loader": "sdxl", "base": "org/base"})
            d.ensure_pipeline({"loader": "sdxl", "base": "org/other"})
        cache_lines = [line for line in self.logs().splitlines() if "[cache]" in line]
        self.assertEqual(len(cache_lines), 1, self.logs())


class PipelineReposTest(DaemonUnitTest):
    """M4.1：pipeline 依赖仓库收集与 keep_set（含 local_models 只读挂载）。"""

    def test_collects_nested_pipeline_repos(self) -> None:
        spec = {
            "loader": "sdxl-lora",
            "base": "stabilityai/stable-diffusion-xl-base-1.0",
            "lora": {"repo": "ByteDance/SDXL-Lightning", "weight": "sdxl_lightning_4step_lora.safetensors"},
            "scheduler": {"type": "euler", "timestepSpacing": "trailing"},
            "variant": "fp16",
            "downloadGb": 6.78,
            "allowPatterns": ["model_index.json", "**/config.json", "**/*.fp16.safetensors"],
        }
        self.assertEqual(
            d.pipeline_repos(spec),
            ["stabilityai/stable-diffusion-xl-base-1.0", "ByteDance/SDXL-Lightning"],
        )

    def test_collects_anima_assets_and_dedupes(self) -> None:
        spec = {
            "loader": "anima",
            "base": "Johnny-Z/Anima-Light-Lavender",
            "weight": "anima-light-lavender.safetensors",
            "textEncoder": {"repo": "circlestone-labs/Anima", "weight": "split_files/text_encoders/te.safetensors"},
            "vae": {"repo": "Qwen/Qwen-Image", "subfolder": "vae"},
            "tokenizers": {"repo": "hugging-apps/anima-light-lavender-demo", "repoType": "space"},
            "unused": {"repo": "Qwen/Qwen-Image"},
        }
        repos = d.pipeline_repos(spec)
        self.assertEqual(
            repos,
            [
                "Johnny-Z/Anima-Light-Lavender",
                "circlestone-labs/Anima",
                "Qwen/Qwen-Image",
                "hugging-apps/anima-light-lavender-demo",
            ],
        )
        # 大小写不同的同一仓库只保留首次出现。
        self.assertEqual(d.pipeline_repos({"a": "Org/Name", "b": "org/name"}), ["Org/Name"])

    def test_ignores_non_repo_strings(self) -> None:
        spec = {
            "base": "org/model",
            "weights": ["split_files/x/y.safetensors", "/kaggle/input/hub/x", "weight.safetensors"],
            "url": "https://huggingface.co/org/model",
            "numbers": [1, 2.5, None, True],
            "dicts": [{"nested": ["org/another-model", ""]}],
        }
        self.assertEqual(d.pipeline_repos(spec), ["org/model", "org/another-model"])

    def test_keep_set_adds_mounted_repos(self) -> None:
        d.CONFIG.local_models = {"Qwen/Qwen-Image": "/kaggle/input/qwen-image", "org/extra": "/kaggle/input/x"}
        keep = d.cache_keep_repos({"loader": "anima", "base": "org/base", "vae": {"repo": "Qwen/Qwen-Image"}})
        self.assertIn("org/base", keep)
        self.assertIn("Qwen/Qwen-Image", keep)
        self.assertIn("org/extra", keep)
        self.assertNotIn("", keep)

    def test_cache_dir_name_round_trip(self) -> None:
        self.assertEqual(d.repo_from_cache_dir_name("models--org--name"), "org/name")
        self.assertEqual(d.repo_from_cache_dir_name("models--stabilityai--stable-diffusion-xl-base-1.0"), "stabilityai/stable-diffusion-xl-base-1.0")
        # 仓库名自带 `--` 时不能被还原成多级路径。
        self.assertEqual(d.repo_from_cache_dir_name("models--org--name--v2"), "org/name--v2")
        self.assertIsNone(d.repo_from_cache_dir_name("models--garbage"))
        self.assertIsNone(d.repo_from_cache_dir_name("datasets--org--name"))
        self.assertEqual(d.cache_repo_candidates("models--org--name"), {"org/name"})


def make_cache_dir(root: str, name: str, mtime: float, size_bytes: int = 1024) -> str:
    """在缓存根下伪造一个 ``models--*`` 目录，并固定 mtime 供 LRU 排序断言。"""
    path = Path(root, name)
    path.mkdir(parents=True, exist_ok=True)
    Path(path, "blob.bin").write_bytes(b"x" * size_bytes)
    os.utime(path, (mtime, mtime))
    return str(path)


def dir_count_usage(root: str, base_free_gb: float, per_dir_gb: float = 1.0):  # noqa: ANN201
    """disk_usage 替身：每删掉一个 models--* 目录，可用空间 +per_dir_gb。"""
    initial = len([name for name in os.listdir(root) if name.startswith("models--")])

    def usage(_path):  # noqa: ANN001
        remaining = len([name for name in os.listdir(root) if name.startswith("models--")])
        free_gb = base_free_gb + (initial - remaining) * per_dir_gb
        return types.SimpleNamespace(free=int(free_gb * 2**30), total=int(20 * 2**30))

    return usage


class CacheEvictTest(DaemonUnitTest):
    """M4.1：LRU 缓存清理顺序、keep_set、预挂载保护、空间不足报错。"""

    def setUp(self) -> None:
        super().setUp()
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()
        super().tearDown()

    def evict(self, required_gb, keep_repos=None, usage=None, root=None):  # noqa: ANN001, ANN201
        return d.evict_cache_for(
            required_gb,
            keep_repos or (),
            root=self.root if root is None else root,
            usage=usage or dir_count_usage(self.root, 0.5),
        )

    def test_evicts_oldest_first_and_stops_when_enough(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)
        make_cache_dir(self.root, "models--org--mid", mtime=2000)
        make_cache_dir(self.root, "models--org--new", mtime=3000)
        # 需 2.0 × 1.15 = 2.30 GiB；基础可用 0.5，每删一个 +1.0 → 删两个后 2.5 达标。
        result = self.evict(2.0)
        self.assertTrue(result["enough"])
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/old", "org/mid"])
        self.assertEqual(result["free_gb"], 2.5)
        self.assertFalse(Path(self.root, "models--org--old").exists())
        self.assertFalse(Path(self.root, "models--org--mid").exists())
        self.assertTrue(Path(self.root, "models--org--new").exists(), "达标后不应继续删")
        logs = self.logs()
        self.assertIn("[cache] evicted org/old freed=", logs)
        self.assertIn("[cache] evicted org/mid freed=", logs)
        self.assertNotIn("evicted org/new", logs)

    def test_keep_set_is_never_evicted(self) -> None:
        # 当前模型的 base + vae + lora 全部在 keep_set 内。
        spec = {
            "loader": "sdxl-lora",
            "base": "org/base",
            "lora": {"repo": "org/lora"},
            "vae": {"repo": "org/vae"},
        }
        make_cache_dir(self.root, "models--org--base", mtime=1000)
        make_cache_dir(self.root, "models--org--lora", mtime=1001)
        make_cache_dir(self.root, "models--org--vae", mtime=1002)
        make_cache_dir(self.root, "models--org--stale", mtime=1003)
        result = self.evict(1.0, keep_repos=d.cache_keep_repos(spec), usage=dir_count_usage(self.root, 0.2))
        # 需 1.15 GiB：删掉 stale 后 1.2 GiB 即达标。
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/stale"])
        for name in ("models--org--base", "models--org--lora", "models--org--vae"):
            self.assertTrue(Path(self.root, name).exists(), name)
        self.assertLogContains("保留当前模型/预挂载缓存")

    def test_mounted_local_models_are_untouched(self) -> None:
        mount_dir = Path(self.root, "kaggle-input", "anima")
        mount_dir.mkdir(parents=True)
        Path(mount_dir, "model_index.json").write_text("{}", encoding="utf-8")
        d.CONFIG.local_models = {"org/mounted": str(mount_dir)}
        make_cache_dir(self.root, "models--org--mounted", mtime=1000)
        make_cache_dir(self.root, "models--org--stale", mtime=1001)
        result = self.evict(1.0, usage=dir_count_usage(self.root, 0.2))
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/stale"])
        self.assertTrue(Path(self.root, "models--org--mounted").exists(), "预挂载仓库的缓存目录不能删")
        self.assertTrue(Path(mount_dir, "model_index.json").exists(), "只读挂载目录不能删")

    def test_insufficient_space_raises_readable_load_error(self) -> None:
        make_cache_dir(self.root, "models--org--a", mtime=1000)
        make_cache_dir(self.root, "models--org--b", mtime=2000)
        with self.assertRaises(d.LoadError) as ctx:
            self.evict(10.0, usage=dir_count_usage(self.root, 0.5))
        message = str(ctx.exception)
        self.assertIn("磁盘空间不足", message)
        self.assertIn("需 11.50 GiB", message)
        self.assertIn("可用 2.50 GiB", message)
        # 可删项应全部清完，再判定失败。
        self.assertFalse(Path(self.root, "models--org--a").exists())
        self.assertFalse(Path(self.root, "models--org--b").exists())
        self.assertEqual(self.logs().count("[cache] evicted "), 2)

    def test_enough_space_does_not_scan_or_delete(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)
        result = self.evict(1.0, usage=dir_count_usage(self.root, 10.0))
        self.assertTrue(result["enough"])
        self.assertEqual(result["evicted"], [])
        self.assertTrue(Path(self.root, "models--org--old").exists())
        self.assertNotIn("[cache] evicted", self.logs())

    def test_default_root_follows_hf_hub_cache_dir(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)
        make_cache_dir(self.root, "models--org--new", mtime=2000)
        with mock.patch.dict(os.environ, {"HF_HUB_CACHE": self.root}, clear=False):
            result = d.evict_cache_for(0.5, (), usage=dir_count_usage(self.root, 0.0))
        self.assertEqual(result["path"], os.path.abspath(self.root))
        self.assertEqual([item["repo"] for item in result["evicted"]], ["org/old"])

    def test_usage_failure_degrades_without_deleting(self) -> None:
        make_cache_dir(self.root, "models--org--old", mtime=1000)

        def broken(_path):  # noqa: ANN001
            raise OSError("denied")

        result = self.evict(100.0, usage=broken)
        self.assertTrue(result["enough"])
        self.assertEqual(result["evicted"], [])
        self.assertTrue(Path(self.root, "models--org--old").exists())
        self.assertLogContains("无法读取磁盘剩余空间")

    def test_unrecognized_cache_dirs_are_skipped(self) -> None:
        Path(self.root, "models--garbage").mkdir()
        Path(self.root, "not-a-cache-dir").mkdir()
        self.assertEqual([entry["name"] for entry in d.cache_model_dirs(self.root)], [])
        with self.assertRaises(d.LoadError):
            self.evict(100.0, usage=dir_count_usage(self.root, 0.0))
        self.assertTrue(Path(self.root, "models--garbage").exists())


class CacheCapacityTest(DaemonUnitTest):
    """M4.1：ensure_pipeline 加载路径上的缓存清理闸门与跳过条件。"""

    def test_local_mounted_pipeline_skips_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "model_index.json").write_text("{}", encoding="utf-8")
            d.CONFIG.local_models = {"org/base": directory}
            with mock.patch.object(d, "evict_cache_for", side_effect=AssertionError("预挂载时不应清理缓存")):
                d.ensure_cache_capacity({"loader": "sdxl", "base": "org/base", "downloadGb": 15.2})

    def test_missing_download_gb_skips_eviction(self) -> None:
        with mock.patch.object(d, "evict_cache_for", side_effect=AssertionError("没有体积信息时不应清理")):
            d.ensure_cache_capacity({"loader": "sdxl", "base": "org/base"})

    def test_anima_local_dit_skips_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "anima.safetensors").write_bytes(b"stub")
            d.CONFIG.local_models = {"Johnny-Z/Anima": directory}
            spec = {
                "loader": "anima",
                "base": "Johnny-Z/Anima",
                "weight": "anima.safetensors",
                "downloadGb": 5.6,
            }
            with mock.patch.object(d, "evict_cache_for", side_effect=AssertionError("预挂载 DiT 时不应清理")):
                d.ensure_cache_capacity(spec)

    def test_calls_evict_with_pipeline_keep_set(self) -> None:
        calls: list[tuple] = []
        with mock.patch.object(d, "evict_cache_for", side_effect=lambda required, keep: calls.append((required, keep)) or {}):
            d.ensure_cache_capacity(
                {
                    "loader": "sdxl-lora",
                    "base": "org/base",
                    "lora": {"repo": "org/lora"},
                    "downloadGb": 6.78,
                }
            )
        self.assertEqual(calls[0][0], 6.78)
        self.assertIn("org/base", calls[0][1])
        self.assertIn("org/lora", calls[0][1])

    def test_ensure_pipeline_evicts_before_build(self) -> None:
        order: list[str] = []
        with tempfile.TemporaryDirectory() as root:
            make_cache_dir(root, "models--org--old", mtime=1000)
            make_cache_dir(root, "models--org--base", mtime=2000)
            spec = {"loader": "sdxl", "base": "org/base", "downloadGb": 0.5}

            def fake_build(_spec):  # noqa: ANN001
                order.append("build")
                return object(), "sdxl:org/base"

            with mock.patch.dict(os.environ, {"HF_HUB_CACHE": root}, clear=False):
                with mock.patch.object(d, "_log_cache_probe"), mock.patch.object(
                    d, "build_pipeline", side_effect=fake_build
                ), mock.patch.object(d.shutil, "disk_usage", dir_count_usage(root, 0.0)):
                    d.ensure_pipeline(spec)
            self.assertFalse(Path(root, "models--org--old").exists())
            self.assertTrue(Path(root, "models--org--base").exists())
            self.assertEqual(order, ["build"])
        self.assertLogContains("[cache] evicted org/old")


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
        """在隔离的临时路径 / 校验和 / urlopen 下调用 ensure_cloudflared。"""
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(d, "CLOUDFLARED_PATH", self.target))
            stack.enter_context(mock.patch.object(d, "CLOUDFLARED_DOWNLOAD_URL", self.URL_SENTINEL))
            stack.enter_context(
                mock.patch.object(
                    d, "CLOUDFLARED_SHA256", self.payload_sha if expected_sha is None else expected_sha
                )
            )
            if max_bytes is not None:
                stack.enter_context(mock.patch.object(d, "CLOUDFLARED_MAX_DOWNLOAD_BYTES", max_bytes))
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
        with mock.patch.object(d, "ensure_cloudflared", side_effect=RuntimeError(error)):
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


# ─────────────────────────────────────────────────────────────────────────────
# v0.9 M3：图生图（垫图重绘）
# ─────────────────────────────────────────────────────────────────────────────


class ReferenceLimitsTest(DaemonUnitTest):
    """参考图/重绘强度边界一律来自注入契约，不写死数值。"""

    def limits(self) -> dict:
        return CONTRACT["limits"]

    def test_reference_limits_come_from_contract(self) -> None:
        self.contract_config()
        spec = d._limit_spec("reference")
        reference = self.limits()["reference"]
        for key in ("maxBytes", "maxEdge", "minEdge"):
            self.assertEqual(spec[key], reference[key])

    def test_strength_limits_include_default_from_contract(self) -> None:
        self.contract_config()
        spec = d._limit_spec("strength")
        strength = self.limits()["strength"]
        for key in ("min", "max", "step", "default"):
            self.assertEqual(spec[key], strength[key])

    def test_strength_normalization_is_contract_driven(self) -> None:
        self.contract_config()
        strength = self.limits()["strength"]
        default = strength["default"]
        cases = [
            (None, default),
            (True, default),
            ("bad", default),
            (float("nan"), default),
            (float("inf"), default),
            (-5, strength["min"]),
            (99, strength["max"]),
            (0.55, 0.55),
            ("0.5", 0.5),
        ]
        for value, expected in cases:
            self.assertEqual(d._coerce_strength(value), expected, f"strength={value!r}")

    def test_custom_contract_values_are_honoured(self) -> None:
        d.CONFIG.contract = {
            "version": CONTRACT_VERSION,
            "limits": {
                **self.limits(),
                "reference": {"maxBytes": 4096, "maxEdge": 512, "minEdge": 64},
                "strength": {"min": 0.1, "max": 0.8, "step": 0.05, "default": 0.5},
            },
        }
        reference = d._limit_spec("reference")
        self.assertEqual(
            (reference["maxBytes"], reference["maxEdge"], reference["minEdge"]), (4096, 512, 64)
        )
        self.assertEqual(d._coerce_strength(-1), 0.1)
        self.assertEqual(d._coerce_strength(9), 0.8)
        self.assertEqual(d._coerce_strength("bad"), 0.5)

    def test_fallback_limits_without_contract(self) -> None:
        # 契约缺失（旧 Host / 本地调试）时仍能用内置兜底，数值与当前契约同量级。
        reference = d._limit_spec("reference")
        self.assertGreater(reference["maxBytes"], 0)
        self.assertGreater(reference["maxEdge"], reference["minEdge"])
        self.assertGreater(d._limit_spec("strength")["max"], d._limit_spec("strength")["min"])

    def test_request_body_limit_follows_contract_base64_size(self) -> None:
        self.contract_config()
        max_bytes = self.limits()["reference"]["maxBytes"]
        base64_size = 4 * ((max_bytes + 2) // 3)
        limit = d._request_body_limit()
        # 8MiB 原图 base64 后约 10.7MB：必须能通过，否则请求会先被体积上限拒掉。
        self.assertGreater(limit, base64_size)
        self.assertEqual(limit, max(8 * 1024 * 1024, base64_size + 1024 * 1024))

    def test_request_body_limit_keeps_8mb_without_reference_contract(self) -> None:
        d.CONFIG.contract = {"version": CONTRACT_VERSION, "limits": {"prompt": {"maxChars": 2000}}}
        self.assertEqual(d._request_body_limit(), 8 * 1024 * 1024)

    def test_read_json_rejects_body_over_limit(self) -> None:
        self.contract_config()
        handler = object.__new__(d.DaemonHandler)
        handler.headers = {"Content-Length": str(d._request_body_limit() + 1)}
        handler.rfile = io.BytesIO(b"")
        with self.assertRaises(d.RequestError) as ctx:
            handler._read_json()
        self.assertIn("请求体超过", str(ctx.exception))

    def test_read_json_parses_small_body(self) -> None:
        handler = object.__new__(d.DaemonHandler)
        handler.headers = {"Content-Length": "2"}
        handler.rfile = io.BytesIO(b"{}")
        self.assertEqual(handler._read_json(), {})


class ReferenceValidationTest(DaemonUnitTest):
    """提交期参考图校验：不需要完整解码，失败一律 RequestError（HTTP 400）。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        self.pipeline = make_pipeline()

    def parse(self, raw, pipeline=None):  # noqa: ANN001, ANN202
        return d.parse_reference_spec(raw, pipeline or self.pipeline)

    def test_missing_reference_means_text2img(self) -> None:
        self.assertIsNone(self.parse(None))

    def test_rejects_non_object(self) -> None:
        for raw in ("base64", [], 123):
            with self.assertRaises(d.RequestError):
                self.parse(raw)

    def test_rejects_unsupported_loader(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            for loader in ("flux2", "anima"):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(make_reference(), make_pipeline(loader))
                self.assertIn("该模型不支持垫图重绘", str(ctx.exception))

    def test_accepts_sdxl_and_sdxl_lora(self) -> None:
        for loader in ("sdxl", "sdxl-lora"):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((1024, 768)))):
                spec = self.parse(make_reference(), make_pipeline(loader))
            self.assertEqual((spec["width"], spec["height"]), (1024, 768))

    def test_rejects_missing_or_empty_image_b64(self) -> None:
        for raw in ({}, {"image_b64": ""}, {"image_b64": "   "}, {"image_b64": 123}):
            with self.assertRaises(d.RequestError):
                self.parse(raw)

    def test_rejects_invalid_base64(self) -> None:
        for encoded in ("not base64!!", "abc", "@@@", "a"):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse({"image_b64": encoded})
            self.assertIn("合法 base64", str(ctx.exception))

    def test_rejects_oversize_payload_using_contract_limit(self) -> None:
        # 用较小契约上限验证体积口径，同时证明边界来自契约而不是本文件常量。
        d.CONFIG.contract = {
            "limits": {
                **CONTRACT["limits"],
                "reference": {"maxBytes": 32, "maxEdge": 1024, "minEdge": 64},
            }
        }
        with self.assertRaises(d.RequestError) as ctx:
            self.parse({"image_b64": make_reference_b64(b"x" * 33)})
        self.assertIn("超过上限", str(ctx.exception))
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            spec = self.parse({"image_b64": make_reference_b64(b"x" * 32)})
        self.assertEqual(spec["width"], 512)

    def test_rejects_non_png_jpeg(self) -> None:
        for fmt in ("WEBP", "GIF", "BMP", ""):
            with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512), fmt=fmt))):
                with self.assertRaises(d.RequestError) as ctx:
                    self.parse(make_reference())
                self.assertIn("PNG 或 JPEG", str(ctx.exception))

    def test_rejects_unidentified_and_bomb_images(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_raising(FakeUnidentifiedImageError("x"))):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(make_reference())
            self.assertIn("PNG 或 JPEG", str(ctx.exception))
        with mock.patch.dict(sys.modules, fake_pil_raising(FakeDecompressionBombError("x"))):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(make_reference())
            self.assertIn("分辨率过大", str(ctx.exception))

    def test_rejects_too_small_image(self) -> None:
        min_edge = CONTRACT["limits"]["reference"]["minEdge"]
        with mock.patch.dict(
            sys.modules, fake_pil_for(FakePILImage((min_edge - 1, min_edge // 2)))
        ):
            with self.assertRaises(d.RequestError) as ctx:
                self.parse(make_reference())
            self.assertIn("长边至少", str(ctx.exception))

    def test_accepts_image_at_min_edge(self) -> None:
        min_edge = CONTRACT["limits"]["reference"]["minEdge"]
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((min_edge // 2, min_edge)))):
            spec = self.parse(make_reference())
        self.assertEqual((spec["width"], spec["height"]), (min_edge // 2, min_edge))

    def test_large_image_is_accepted_for_later_resize(self) -> None:
        # 提交期只校验最小边；超过 maxEdge 不拒绝，留给执行期等比缩小。
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        with mock.patch.dict(
            sys.modules, fake_pil_for(FakePILImage((max_edge * 2, max_edge)))
        ):
            spec = self.parse(make_reference())
        self.assertEqual((spec["width"], spec["height"]), (max_edge * 2, max_edge))

    def test_strength_is_clamped_to_contract(self) -> None:
        limits = CONTRACT["limits"]["strength"]
        cases = [
            (None, limits["default"]),  # 缺省
            ("bad", limits["default"]),
            (True, limits["default"]),
            (-5, limits["min"]),
            (99, limits["max"]),
            (0.55, 0.55),
        ]
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((512, 512)))):
            for raw_strength, expected in cases:
                raw = make_reference()
                if raw_strength is not None:
                    raw["strength"] = raw_strength
                spec = self.parse(raw)
                self.assertEqual(spec["strength"], expected, f"strength={raw_strength!r}")

    def test_returns_normalized_spec(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((800, 600)))):
            spec = self.parse(make_reference(strength=0.35))
        self.assertEqual(
            set(spec), {"image_bytes", "strength", "width", "height"}
        )
        self.assertIsInstance(spec["image_bytes"], bytes)
        self.assertEqual((spec["width"], spec["height"]), (800, 600))
        self.assertEqual(spec["strength"], 0.35)


class ReferenceDecodeTest(DaemonUnitTest):
    """执行期完整解码一次：等比 LANCZOS 缩小、转 RGB、损坏图片按请求非法收敛。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def reference(self) -> dict:
        return {"image_bytes": b"fake-image-bytes", "strength": 0.6, "width": 1, "height": 1}

    def decode(self, image):  # noqa: ANN001, ANN202
        with mock.patch.dict(sys.modules, fake_pil_for(image)):
            return d.decode_reference_image(self.reference())

    def test_downscales_long_edge_with_lanczos(self) -> None:
        source = FakePILImage((2048, 1024))
        image = self.decode(source)
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        self.assertEqual(image.size, (max_edge, max_edge // 2))
        self.assertEqual(source.resized[1], "LANCZOS")
        self.assertTrue(source.loaded)
        self.assertEqual(image._imagen_source_size, (2048, 1024))

    def test_does_not_upscale_small_image(self) -> None:
        source = FakePILImage((1024, 512))
        image = self.decode(source)
        self.assertEqual(image.size, (1024, 512))
        self.assertIsNone(source.resized)
        self.assertEqual(image._imagen_source_size, (1024, 512))

    def test_uses_contract_max_edge(self) -> None:
        d.CONFIG.contract = {
            "limits": {
                **CONTRACT["limits"],
                "reference": {"maxBytes": 1024, "maxEdge": 256, "minEdge": 64},
            }
        }
        source = FakePILImage((1024, 512))
        image = self.decode(source)
        self.assertEqual(image.size, (256, 128))

    def test_keeps_aspect_ratio_on_odd_sizes(self) -> None:
        source = FakePILImage((1537, 1001))
        image = self.decode(source)
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        self.assertEqual(image.size[0], max_edge)
        self.assertEqual(image.size[1], round(1001 * max_edge / 1537))

    def test_converts_to_rgb(self) -> None:
        source = FakePILImage((800, 600), fmt="JPEG", mode="RGBA")
        image = self.decode(source)
        self.assertEqual(source.converted, "RGB")
        self.assertEqual(image.mode, "RGB")

    def test_truncated_image_is_request_error(self) -> None:
        source = FakePILImage((512, 512))
        source.load_error = OSError("truncated")
        with mock.patch.dict(sys.modules, fake_pil_for(source)):
            with self.assertRaises(d.RequestError) as ctx:
                d.decode_reference_image(self.reference())
        self.assertIn("无法解码", str(ctx.exception))

    def test_missing_bytes_is_request_error(self) -> None:
        for reference in (None, {}, {"image_bytes": b""}, {"image_bytes": "str"}):
            with self.assertRaises(d.RequestError):
                d.decode_reference_image(reference)


@unittest.skipUnless(HAS_PILLOW, "需要 Pillow 做真实 PNG/JPEG 解码的集成用例")
class ReferencePillowIntegrationTest(DaemonUnitTest):
    """真实 Pillow 集成用例（CI 不装 Pillow 时跳过；本地与 Kaggle 环境会执行）。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    @staticmethod
    def encode(image_bytes_io, fmt: str) -> str:  # noqa: ANN001
        return base64.b64encode(image_bytes_io.getvalue()).decode("ascii")

    def png_b64(self, size, color=(200, 60, 40)) -> str:  # noqa: ANN001
        buffer = io.BytesIO()
        _RealPILImage.new("RGB", size, color).save(buffer, format="PNG")
        return self.encode(buffer, "PNG")

    def test_parse_real_png_and_clamp_strength(self) -> None:
        max_strength = CONTRACT["limits"]["strength"]["max"]
        spec = d.parse_reference_spec(
            {"image_b64": self.png_b64((300, 200)), "strength": 9}, make_pipeline()
        )
        self.assertEqual((spec["width"], spec["height"]), (300, 200))
        self.assertEqual(spec["strength"], max_strength)

    def test_decode_real_png_downscales_to_contract_max_edge(self) -> None:
        spec = d.parse_reference_spec({"image_b64": self.png_b64((1600, 800))}, make_pipeline())
        image = d.decode_reference_image(spec)
        max_edge = CONTRACT["limits"]["reference"]["maxEdge"]
        self.assertEqual(image.size, (max_edge, max_edge // 2))
        self.assertEqual(image.mode, "RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        self.assertGreater(len(buffer.getvalue()), 8)

    def test_accepts_real_jpeg(self) -> None:
        buffer = io.BytesIO()
        _RealPILImage.new("RGB", (256, 256), (10, 10, 10)).save(buffer, format="JPEG")
        spec = d.parse_reference_spec(
            {"image_b64": base64.b64encode(buffer.getvalue()).decode("ascii")}, make_pipeline()
        )
        self.assertEqual((spec["width"], spec["height"]), (256, 256))

    def test_rejects_real_bmp(self) -> None:
        buffer = io.BytesIO()
        _RealPILImage.new("RGB", (256, 256), (10, 10, 10)).save(buffer, format="BMP")
        with self.assertRaises(d.RequestError):
            d.parse_reference_spec(
                {"image_b64": base64.b64encode(buffer.getvalue()).decode("ascii")},
                make_pipeline(),
            )


class Img2ImgPipelineTest(DaemonUnitTest):
    """图生图管线：惰性 from_pipe 复用、只创建一次、随 release_pipeline 清空。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_fake_diffusers(self, fail=None):  # noqa: ANN001, ANN201
        calls = []

        class FakeImg2ImgPipe:
            def __call__(
                self,
                prompt=None,  # noqa: ANN001
                negative_prompt=None,  # noqa: ANN001
                image=None,  # noqa: ANN001
                strength=None,  # noqa: ANN001
                num_inference_steps=None,  # noqa: ANN001
                guidance_scale=None,  # noqa: ANN001
                generator=None,  # noqa: ANN001
            ):
                return types.SimpleNamespace(images=[])

        class FakeAutoPipelineForImage2Image:
            @staticmethod
            def from_pipe(pipe):  # noqa: ANN001, ANN205
                calls.append(pipe)
                if fail is not None:
                    raise fail
                return FakeImg2ImgPipe()

        module = types.ModuleType("diffusers")
        module.AutoPipelineForImage2Image = FakeAutoPipelineForImage2Image
        return module, calls

    def test_lazy_creation_is_cached(self) -> None:
        module, calls = self.make_fake_diffusers()
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            first = d.ensure_img2img_pipeline()
            second = d.ensure_img2img_pipeline()
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1, "from_pipe 只应在首次创建时调用一次")
        self.assertIs(d.STATE.img2img_pipe, first)
        self.assertIn("image", d.STATE.img2img_sig_params)
        self.assertIn("strength", d.STATE.img2img_sig_params)
        self.assertIn("首次图生图", self.logs())
        self.assertIn("图生图管线就绪", self.logs())

    def test_requires_loaded_base_pipeline(self) -> None:
        with self.assertRaises(d.RequestError):
            d.ensure_img2img_pipeline()

    def test_from_pipe_failure_is_load_error(self) -> None:
        module, _calls = self.make_fake_diffusers(fail=RuntimeError("组件不兼容"))
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            with self.assertRaises(d.LoadError) as ctx:
                d.ensure_img2img_pipeline()
        self.assertIn("图生图管线创建失败", str(ctx.exception))
        self.assertIsNone(d.STATE.img2img_pipe)

    def test_oom_is_not_wrapped_as_load_error(self) -> None:
        module, _calls = self.make_fake_diffusers(fail=RuntimeError("CUDA out of memory"))
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            with self.assertRaises(RuntimeError) as ctx:
                d.ensure_img2img_pipeline()
        self.assertNotIsInstance(ctx.exception, d.LoadError)

    def test_release_pipeline_clears_img2img_cache(self) -> None:
        module, _calls = self.make_fake_diffusers()
        d.STATE.pipe = object()
        d.STATE.pipeline_key = "pipeline-key"
        with mock.patch.dict(sys.modules, {"diffusers": module}):
            d.ensure_img2img_pipeline()
        self.assertIsNotNone(d.STATE.img2img_pipe)
        fake_torch = types.ModuleType("torch")
        fake_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            d.release_pipeline()
        self.assertIsNone(d.STATE.img2img_pipe)
        self.assertEqual(d.STATE.img2img_sig_params, set())
        self.assertIsNone(d.STATE.pipe)
        # 换底座后重新按需创建：缓存确实失效，会再次 from_pipe。
        module2, calls2 = self.make_fake_diffusers()
        d.STATE.pipe = object()
        with mock.patch.dict(sys.modules, {"diffusers": module2}):
            d.ensure_img2img_pipeline()
        self.assertEqual(len(calls2), 1)


class RunTaskImg2ImgTest(DaemonUnitTest):
    """run_task 的图生图分支：kwargs / 日志 / 结果字段正确，txt2img 分支不回归。"""

    IMG2IMG_SIG = {
        "prompt",
        "negative_prompt",
        "image",
        "strength",
        "num_inference_steps",
        "guidance_scale",
        "generator",
    }

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def make_img2img_pipe(self, image_size=(1536, 768)):  # noqa: ANN001, ANN202
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-img2img-png")

        class FakeImg2ImgPipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage(image_size)])

        return FakeImg2ImgPipe()

    def make_reference(self, size=(1536, 768), source=(2048, 1024)):  # noqa: ANN001, ANN202
        image = FakePILImage(size)
        image._imagen_source_size = source
        return image

    def run_img2img(  # noqa: ANN001, ANN202
        self,
        task=None,
        strength=0.55,
        sig=None,
        image_size=(1536, 768),
    ):
        task = dict(TASKS[0] if task is None else task)
        pipe = self.make_img2img_pipe(image_size)
        d.STATE.pipe = object()
        d.STATE.img2img_pipe = pipe
        d.STATE.img2img_sig_params = set(self.IMG2IMG_SIG if sig is None else sig)
        reference = self.make_reference()
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            result = d.run_task(
                object(), task, reference_image=reference, reference_strength=strength
            )
        return pipe, result, reference

    def test_call_kwargs_use_img2img_contract(self) -> None:
        pipe, _result, reference = self.run_img2img(strength=0.55)
        self.assertEqual(len(pipe.calls), 1)
        kwargs = pipe.calls[0]
        self.assertEqual(kwargs["prompt"], TASKS[0]["prompt"])
        self.assertIs(kwargs["image"], reference)
        self.assertEqual(kwargs["strength"], 0.55)
        self.assertEqual(kwargs["num_inference_steps"], TASKS[0]["steps"])
        self.assertEqual(kwargs["guidance_scale"], TASKS[0]["cfg"])
        # img2img 不传 width / height：输出尺寸跟随参考图。
        self.assertNotIn("width", kwargs)
        self.assertNotIn("height", kwargs)
        # cfg=0 时 negative_prompt 无意义，不传。
        self.assertNotIn("negative_prompt", kwargs)
        self.assertEqual(kwargs["generator"].seed, TASKS[0]["seed"])

    def test_negative_prompt_is_kept_when_cfg_positive(self) -> None:
        task = dict(TASKS[0], cfg=5.0, negative_prompt="blurry")
        pipe, _result, _reference = self.run_img2img(task=task)
        self.assertEqual(pipe.calls[0]["negative_prompt"], "blurry")

    def test_signature_filtering_drops_unknown_kwargs(self) -> None:
        pipe, _result, _reference = self.run_img2img(sig={"prompt", "image", "generator"})
        self.assertEqual(set(pipe.calls[0]), {"prompt", "image", "generator"})

    def test_default_strength_comes_from_contract(self) -> None:
        _pipe, result, _reference = self.run_img2img(strength=None)
        self.assertEqual(result["strength"], CONTRACT["limits"]["strength"]["default"])

    def test_logs_strength_and_resize(self) -> None:
        self.run_img2img(strength=0.55)
        self.assertIn("[gen] img2img 01 strength=0.55", self.logs())
        self.assertIn("参考图 2048x1024 → 1536x768", self.logs())

    def test_result_fields(self) -> None:
        _pipe, result, _reference = self.run_img2img(strength=0.55)
        self.assertEqual(
            set(result), RunTaskTest.RESULT_KEYS | {"strength", "referenceWidth", "referenceHeight"}
        )
        self.assertEqual(result["strength"], 0.55)
        self.assertEqual((result["referenceWidth"], result["referenceHeight"]), (1536, 768))
        self.assertEqual((result["width"], result["height"]), (1536, 768))
        self.assertEqual(base64.b64decode(result["image_b64"]), b"fake-img2img-png")

    def test_reports_actual_size_when_it_differs_from_reference(self) -> None:
        self.run_img2img(image_size=(1536, 760))
        self.assertIn("实际出图 1536x760（参考图 1536x768）", self.logs())

    def test_txt2img_path_is_unaffected(self) -> None:
        class FakeImage:
            def __init__(self, size):  # noqa: ANN001
                self.size = size

            def save(self, buffer, format=None):  # noqa: A002, ANN001
                buffer.write(b"fake-txt2img-png")

        class FakeTxt2ImgPipe:
            def __init__(self):
                self.calls = []

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                return types.SimpleNamespace(images=[FakeImage((256, 256))])

        pipe = FakeTxt2ImgPipe()
        d.STATE.sig_params = {
            "prompt",
            "negative_prompt",
            "num_inference_steps",
            "guidance_scale",
            "width",
            "height",
            "generator",
        }
        with mock.patch.dict(sys.modules, {"torch": fake_torch_module()}):
            result = d.run_task(pipe, dict(TASKS[0]))
        self.assertEqual(set(result), RunTaskTest.RESULT_KEYS)
        # negative_prompt 在 cfg=0 / 空提示时按既有逻辑不传，其余签名内的参数都应下传。
        expected_kwargs = set(d.STATE.sig_params) - {"negative_prompt"}
        self.assertEqual(set(pipe.calls[0]), expected_kwargs)
        self.assertEqual((pipe.calls[0]["width"], pipe.calls[0]["height"]), (256, 256))
        self.assertIn("[gen] 01 seed=42 256x256 steps=4 cfg=0.0", self.logs())


class ExecuteJobReferenceTest(DaemonUnitTest):
    """execute_job：参考图整批只解码一次，并透传给 run_tasks；失败不白加载模型。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()

    def submit_job_with(self, reference=None, task_count=1):  # noqa: ANN001, ANN202
        tasks = [dict(TASKS[0], name=f"{index + 1:02d}") for index in range(task_count)]
        return d.submit_job(
            make_pipeline(), "org/base-model", tasks, None, reference=reference
        )

    def test_decodes_reference_once_and_passes_to_run_tasks(self) -> None:
        reference = {"image_bytes": b"data", "strength": 0.55, "width": 10, "height": 10}
        job, _created = self.submit_job_with(reference, task_count=2)
        decoded = FakePILImage((1536, 768))
        captured: dict = {}

        def fake_run_tasks(  # noqa: ANN001, ANN202
            pipe, tasks, on_progress=None, reference_image=None, reference_strength=None
        ):
            captured.update(
                reference_image=reference_image,
                reference_strength=reference_strength,
                task_count=len(tasks),
            )
            return []

        with mock.patch.object(d, "decode_reference_image", return_value=decoded) as decode, mock.patch.object(
            d, "ensure_pipeline", return_value=("pipe", 0.0)
        ), mock.patch.object(d, "run_tasks", side_effect=fake_run_tasks):
            d.execute_job(job)
        self.assertEqual(decode.call_count, 1, "一张参考图跑整批，只应解码一次")
        self.assertIs(captured["reference_image"], decoded)
        self.assertEqual(captured["reference_strength"], 0.55)
        self.assertEqual(captured["task_count"], 2)
        self.assertEqual(job.status, d.JOB_STATUS_DONE)
        self.assertIsNone(job.reference, "解码后应释放队列里保留的原始字节")

    def test_text2img_still_calls_run_tasks_without_reference_kwargs(self) -> None:
        job, _created = self.submit_job_with(None)
        captured: dict = {}

        def fake_run_tasks(pipe, tasks, on_progress=None):  # noqa: ANN001, ANN202
            captured["pipe"] = pipe
            return []

        with mock.patch.object(d, "ensure_pipeline", return_value=("pipe", 0.0)), mock.patch.object(
            d, "run_tasks", side_effect=fake_run_tasks
        ):
            d.execute_job(job)
        self.assertEqual(captured["pipe"], "pipe")
        self.assertEqual(job.status, d.JOB_STATUS_DONE)

    def test_decode_failure_fails_job_without_loading_model(self) -> None:
        job, _created = self.submit_job_with(
            {"image_bytes": b"bad", "strength": 0.6, "width": 1, "height": 1}
        )
        with mock.patch.object(
            d, "decode_reference_image", side_effect=d.RequestError("参考图无法解码")
        ), mock.patch.object(d, "ensure_pipeline", side_effect=AssertionError("不应加载模型")):
            d.execute_job(job)
        self.assertEqual(job.status, d.JOB_STATUS_FAILED)
        self.assertEqual(job.error["code"], "invalid_request")
        self.assertIn("参考图无法解码", job.error["message"])

    def test_submit_job_keeps_reference_copy(self) -> None:
        reference = {"image_bytes": b"data", "strength": 0.6, "width": 10, "height": 10}
        job, _created = self.submit_job_with(reference)
        self.assertIsNotNone(job.reference)
        self.assertEqual(job.reference["strength"], 0.6)
        self.assertIsNot(job.reference, reference)


class GenerateWithReferenceTest(DaemonUnitTest):
    """POST /generate 的参考图路径：提交期 400 与入队后的规范化结果。"""

    def setUp(self) -> None:
        super().setUp()
        self.contract_config()
        d.STATE.phase = "ready"

    def generate(self, spec):  # noqa: ANN001, ANN202
        handler, sent = make_generate_handler(spec)
        d.DaemonHandler._handle_generate(handler)
        return sent

    def spec_with(self, reference=None, pipeline=None, loader=None):  # noqa: ANN001, ANN202
        pipeline = pipeline or make_pipeline(loader or "sdxl")
        spec = {"pipeline": pipeline, "tasks": [{"prompt": "p"}]}
        if reference is not None:
            spec["reference"] = reference
        return spec

    def test_unsupported_loader_returns_400(self) -> None:
        for loader in ("flux2", "anima"):
            sent = self.generate(self.spec_with(make_reference(), loader=loader))
            self.assertEqual(sent[0][0], 400)
            self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
            self.assertIn("该模型不支持垫图重绘", sent[0][1]["error"]["message"])
        self.assertEqual(d.queue_depth(), 0)

    def test_invalid_base64_returns_400(self) -> None:
        sent = self.generate(self.spec_with({"image_b64": "not base64!!"}))
        self.assertEqual(sent[0][0], 400)
        self.assertEqual(sent[0][1]["error"]["code"], "invalid_request")
        self.assertIn("合法 base64", sent[0][1]["error"]["message"])
        self.assertEqual(d.queue_depth(), 0)

    def test_valid_reference_is_enqueued_with_normalized_strength(self) -> None:
        with mock.patch.dict(sys.modules, fake_pil_for(FakePILImage((1024, 768)))):
            sent = self.generate(self.spec_with(make_reference(strength=9)))
        self.assertEqual(sent[0][0], 202)
        job = d.get_job(sent[0][1]["job_id"])
        self.assertIsNotNone(job.reference)
        self.assertEqual(job.reference["strength"], CONTRACT["limits"]["strength"]["max"])
        self.assertEqual((job.reference["width"], job.reference["height"]), (1024, 768))
        self.assertEqual(d.queue_depth(), 1)
        self.assertLogContains("带参考图")

    def test_text2img_spec_has_no_reference(self) -> None:
        sent = self.generate(self.spec_with(None))
        self.assertEqual(sent[0][0], 202)
        job = d.get_job(sent[0][1]["job_id"])
        self.assertIsNone(job.reference)
        self.assertNotIn("带参考图", self.logs())


class SchedulerSpecTest(DaemonUnitTest):
    """sdxl 与 sdxl-lora 对 pipeline.scheduler 的识别与替换。"""

    def _run_build(self, pipeline_spec: dict):
        scheduler_calls = []

        class FakeScheduler:
            def __init__(self, name: str, config: dict, kwargs: dict) -> None:
                self.name = name
                self.config = config
                self.kwargs = kwargs

        def make_scheduler_cls(name: str):
            class _Cls:
                @staticmethod
                def from_config(config, **kwargs):
                    scheduler_calls.append((name, kwargs))
                    return FakeScheduler(name, config, kwargs)

            return _Cls

        class FakePipe:
            def __init__(self) -> None:
                self.scheduler = types.SimpleNamespace(config={"num_train_timesteps": 1000})
                self.lora_loaded = []
                self.device = None

            def to(self, device: str):
                self.device = device
                return self

            def load_lora_weights(self, folder: str, weight_name: str = "") -> None:
                self.lora_loaded.append((folder, weight_name))

        class FakeFactory:
            @staticmethod
            def from_pretrained(source, **_kwargs):
                return FakePipe()

        fake_torch = types.ModuleType("torch")
        fake_torch.float16 = "float16"

        fake_diffusers = types.ModuleType("diffusers")
        fake_diffusers.AutoPipelineForText2Image = FakeFactory
        fake_diffusers.StableDiffusionXLPipeline = FakeFactory
        fake_diffusers.EulerDiscreteScheduler = make_scheduler_cls("euler")
        fake_diffusers.EulerAncestralDiscreteScheduler = make_scheduler_cls("euler-a")
        fake_diffusers.DPMSolverSinglestepScheduler = make_scheduler_cls("dpmpp-sde")
        fake_diffusers.DPMSolverMultistepScheduler = make_scheduler_cls("dpmpp-2m")

        with (
            mock.patch.dict(sys.modules, {"torch": fake_torch, "diffusers": fake_diffusers}),
            mock.patch.object(d, "resolve_local_model", return_value="/local/base"),
            mock.patch.object(d, "resolve_local_weight", return_value="/local/lora/w.safetensors"),
            mock.patch.object(d, "ensure_disk_capacity"),
        ):
            pipe, loaded = d.build_pipeline(pipeline_spec)
        return pipe, loaded, scheduler_calls

    def test_sdxl_applies_dpmpp_sde_karras(self) -> None:
        pipe, loaded, calls = self._run_build(
            {
                "loader": "sdxl",
                "base": "SG161222/RealVisXL_V5.0",
                "scheduler": {"type": "dpmpp-sde-karras"},
            }
        )
        self.assertEqual(loaded, "sdxl:SG161222/RealVisXL_V5.0")
        self.assertEqual(
            calls,
            [("dpmpp-sde", {"use_karras_sigmas": True, "algorithm_type": "sde-dpmsolver++"})],
        )
        self.assertEqual(pipe.scheduler.name, "dpmpp-sde")

    def test_sdxl_applies_dpmpp_2m_sde_karras(self) -> None:
        pipe, loaded, calls = self._run_build(
            {
                "loader": "sdxl",
                "base": "SG161222/RealVisXL_V5.0",
                "scheduler": {"type": "dpmpp-2m-sde-karras"},
            }
        )
        self.assertEqual(loaded, "sdxl:SG161222/RealVisXL_V5.0")
        self.assertEqual(
            calls,
            [("dpmpp-2m", {"use_karras_sigmas": True, "algorithm_type": "sde-dpmsolver++"})],
        )
        self.assertEqual(pipe.scheduler.name, "dpmpp-2m")

    def test_sdxl_without_scheduler_keeps_base_default(self) -> None:
        pipe, _loaded, calls = self._run_build(
            {
                "loader": "sdxl",
                "base": "stabilityai/sdxl-turbo",
                "scheduler": None,
            }
        )
        self.assertEqual(calls, [])
        self.assertFalse(hasattr(pipe.scheduler, "name"))

    def test_sdxl_lora_defaults_to_euler_trailing(self) -> None:
        pipe, loaded, calls = self._run_build(
            {
                "loader": "sdxl-lora",
                "base": "stabilityai/stable-diffusion-xl-base-1.0",
                "lora": {"repo": "ByteDance/SDXL-Lightning", "weight": "sdxl_lightning_4step_lora.safetensors"},
            }
        )
        self.assertEqual(loaded, "sdxl-lora:stabilityai/stable-diffusion-xl-base-1.0")
        self.assertEqual(calls, [("euler", {"timestep_spacing": "trailing"})])
        self.assertEqual(pipe.scheduler.name, "euler")


class HardeningRegressionTest(DaemonUnitTest):
    """P0/P1/P2/P3 加固回归测试：输入校验、队列上限、切模型清理、隧道令牌、资源回收与停机清理。"""

    def test_negative_prompt_type_and_length_enforced(self) -> None:
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(make_spec([{"prompt": "p", "negative_prompt": 123}]))
        with self.assertRaises(d.RequestError):
            d.validate_generate_spec(make_spec([{"prompt": "p", "negative_prompt": "x" * 1001}]))
        _, _, tasks = d.validate_generate_spec(make_spec([{"prompt": "p", "negative_prompt": "  bad hands  "}]))
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
            _, model_id, _ = d.validate_generate_spec(
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
        with mock.patch.object(d, "ensure_cache_capacity"), mock.patch.object(
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
            assets = d.anima_local_assets(
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
        d._drain_tunnel_output(proc, "cloudflare", d.CLOUDFLARED_URL_RE, ev, stale)
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
    unittest.main(verbosity=2)