"""远端守护进程单测的公共夹具（原 test/daemon-unit.py 的头部与替身定义）。

按域拆分后，每个 ``test_*.py`` 只 import 这里需要的东西：

- ``d``：按路径加载的 ``remote/daemon.py`` 模块（测试的观测对象）；
- ``DaemonUnitTest``：每个用例原地重置 CONFIG / STATE / BOOT、清空 JobStore 与缓存探针；
- ``reset_stateful_singletons``：原地重置三个单例（不重新绑定，见架构规格 §5.9）；
- 各类假替身（Popen / urlopen / PIL / torch.Generator）与请求构造器。

加载方式仍是 ``spec_from_file_location`` 按路径加载：daemon 是入口模块，启动器也按
``daemon.main`` / ``daemon.set_embedded_config`` 取符号，测试与部署保持同一条链路。
"""

from __future__ import annotations

import base64
import dataclasses
import importlib.util
import io
import json
import os
import sys
import types
import unittest
from pathlib import Path

try:  # 真实 Pillow 只用于可选集成用例；逻辑用例一律用下面的假 PIL 替身（CI 不装 Pillow 也能跑）。
    from PIL import Image as _RealPILImage

    HAS_PILLOW = True
except Exception:  # pragma: no cover - 极简环境
    _RealPILImage = None
    HAS_PILLOW = False

ROOT = Path(__file__).resolve().parent.parent.parent
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
import pipeline_loader as remote_pipeline_loader  # noqa: E402  # 扁平模块：verify payload 共用的构建入口
import remote.app as remote_app  # noqa: E402
import remote.config as remote_config  # noqa: E402
import remote.inference.loaders.anima as remote_anima_loader  # noqa: E402
import remote.inference.loaders.base as remote_loader_base  # noqa: E402
import remote.inference.registry as remote_registry  # noqa: E402
import remote.infra.cache as remote_cache  # noqa: E402
import remote.infra.process as remote_process  # noqa: E402
import remote.infra.tunnel as remote_tunnel  # noqa: E402
import remote.jobs.models as remote_job_models  # noqa: E402
import remote.jobs.store as remote_job_store  # noqa: E402
import remote.observability.health as remote_health  # noqa: E402
import remote.state as remote_state  # noqa: E402
import remote.text as remote_text  # noqa: E402
import remote.transport.http_server as remote_http  # noqa: E402

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
        # 局部重绘蒙版上限（与参考图一起下发；请求体上限公式也按它推导）。
        "mask": CONTRACT_DOC["limits"]["mask"],
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
    # 蒙版对齐用最近邻：二值图不能走插值，否则边界会出灰边。
    image_module.NEAREST = "NEAREST"
    image_module.Resampling = types.SimpleNamespace(LANCZOS="LANCZOS", NEAREST="NEAREST")
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


def fake_pil_sequence(items):  # noqa: ANN001, ANN201
    """按调用次序返回不同的假图 / 抛不同异常：局部重绘用例里第 1 张是参考图、第 2 张是蒙版。"""

    queue = list(items)

    def fake_open(_stream):  # noqa: ANN001, ANN202
        if not queue:
            raise AssertionError("PIL.open 调用次数超出用例预期")
        item = queue.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    return fake_pil_modules(fake_open)


def make_reference_b64(payload: bytes = b"fake-image-bytes") -> str:
    """参考图请求里的 image_b64：假 PIL 不真正解析内容，只关心 base64 是否合法。"""
    return base64.b64encode(payload).decode("ascii")


def make_reference(image_b64: str | None = None, strength=None, mask_b64: str | None = None) -> dict:  # noqa: ANN001
    """构造 job 级 reference 请求体；strength / mask_b64 缺省时不写对应键。"""
    payload = {"image_b64": make_reference_b64() if image_b64 is None else image_b64}
    if strength is not None:
        payload["strength"] = strength
    if mask_b64 is not None:
        payload["mask_b64"] = mask_b64
    return payload


def make_mask_b64(payload: bytes = b"fake-mask-bytes") -> str:
    """局部重绘蒙版请求里的 mask_b64：假 PIL 不真正解析内容，只关心 base64 是否合法。"""
    return base64.b64encode(payload).decode("ascii")


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
        # job 表是进程级状态（JobStore 单例），用例之间必须清干净。
        d.JOB_STORE.clear()
        # 缓存探针的"进程内只打一次"也是进程级状态：不复位的话，只有第一个用例能看到
        # 探针日志，后面的用例会在"以为打了、其实没打"的假象里做断言。
        d.CACHE.reset_probe()

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
