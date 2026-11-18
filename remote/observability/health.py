"""健康快照：把状态对象、依赖版本与显存读数组装成 ``/health`` 的响应体。

为什么从 daemon.py 拆出来：``/health`` 是 Host 判断 phase、做故障归因的唯一入口，字段随版本
持续增长（0.5 队列深度、P0.2 隧道监管、M3 显存、M4.2 依赖版本），却和 HTTP 路由、Bearer 鉴权
挤在同一个类文件里，既难单测也难 review。拆开后分两层：

- :func:`snapshot_from`：持锁取样，返回**不可变**的 :class:`HealthSnapshot`，锁即取即放；
- :func:`build_payload`：纯函数，入参是快照 + 已取好的队列深度 / 版本 / 空闲阈值，不碰任何锁。

**锁顺序（架构规格 §5.8，唯一方向 ``JOB_LOCK → STATE_LOCK``）**：``queue_depth()`` 必须在
快照返回（``STATE_LOCK`` 已释放）之后调用，否则 ``/health`` 与 ``_finish_job`` 会形成反向嵌套
而死锁。这个结构由签名保证——``build_payload`` 只接受一个 ``int``，拿不到任何锁，函数体内也
没有任何加锁路径。
"""

from __future__ import annotations

import importlib.metadata
import platform
import re
import sys
import time
from dataclasses import dataclass, field

# M4.2：/health 的依赖版本快照。三项依次为「输出键名 / 已加载模块名 / PyPI 发行名」。
# 只输出纯版本号，绝不包含 token、路径或安装位置；取不到的键直接省略。
HEALTH_VERSION_MODULES = (
    ("torch", "torch", "torch"),
    ("diffusers", "diffusers", "diffusers"),
    ("transformers", "transformers", "transformers"),
    ("accelerate", "accelerate", "accelerate"),
    ("peft", "peft", "peft"),
    ("huggingface_hub", "huggingface_hub", "huggingface-hub"),
    ("safetensors", "safetensors", "safetensors"),
    ("pillow", "PIL", "pillow"),
)
VERSION_RE = re.compile(r"^[0-9][0-9A-Za-z.+!_-]{0,63}$")


def clean_version(value) -> str | None:  # noqa: ANN001
    """只接受纯版本号字符串（数字开头）；其他形态丢弃，避免把路径带进 /health。"""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or not VERSION_RE.match(text):
        return None
    return text


def dependency_versions() -> dict:
    """python + torch/diffusers/... 的版本快照；取不到就省略该键，绝不抛异常。

    优先读已加载模块的 ``__version__``（不额外 import 重库），回退到
    importlib.metadata；两种来源都做纯版本号校验。
    """
    versions: dict = {}
    python_version = clean_version(platform.python_version())
    if python_version:
        versions["python"] = python_version
    for key, module_name, dist_name in HEALTH_VERSION_MODULES:
        version = None
        module = sys.modules.get(module_name)
        if module is not None:
            version = clean_version(getattr(module, "__version__", None))
        if version is None:
            try:
                version = clean_version(importlib.metadata.version(dist_name))
            except Exception:
                version = None
        if version is not None:
            versions[key] = version
    return versions


def gpu_memory_payload() -> dict | None:
    """只读显存快照（MiB 取整）；用于 M3 真机验收对比 txt2img → img2img 是否额外占显存。

    ``max_allocated_mb`` 的口径是"当前管线峰值"：daemon 在加载 / 切换管线成功后调用
    ``reset_peak_memory_stats()``（见 daemon.ensure_pipeline），否则读到的是进程累计最大值，
    真机 A/B 各档之间不可比（INFERENCE_ACCELERATION_RESEARCH §4.3.5 复测建议②）。

    只读已加载的 torch 模块（``sys.modules``），不在 /health 里触发重库 import：
    torch 尚未加载、CUDA 不可用或读取异常时一律返回 None，且不影响 status / phase 判定。
    """
    torch = sys.modules.get("torch")
    if torch is None:
        return None
    try:
        cuda = torch.cuda
        if not cuda.is_available():
            return None
        mib = 1024 * 1024
        return {
            "allocated_mb": int(cuda.memory_allocated() // mib),
            "reserved_mb": int(cuda.memory_reserved() // mib),
            "max_allocated_mb": int(cuda.max_memory_allocated() // mib),
        }
    except Exception:
        return None


@dataclass(frozen=True)
class HealthSnapshot:
    """一次 /health 的只读取样：全是标量或列表副本，不含锁、不含可变活对象。"""

    phase: str
    detail: str | None
    model_id: str | None
    loaded: list = field(default_factory=list)
    device: str | None = None
    device_count: int = 0
    last_active: float = 0.0
    jobs_done: int = 0
    last_error: str | None = None
    last_error_code: str | None = None
    started_at: float = 0.0
    tunnel_provider: str | None = None
    tunnel_state: str = "starting"
    tunnel_restarts: int = 0


def snapshot_from(runtime, boot, *, state_lock, boot_lock) -> HealthSnapshot:  # noqa: ANN001
    """持锁取样：只读字段并复制可变容器，返回后调用方无需再持任何锁。

    ``state_lock`` / ``boot_lock`` 由调用方传入（daemon 的 STATE_LOCK / BOOT_LOCK），本模块
    不 import 状态对象，避免包之间互相持有全局。
    """
    with state_lock:
        values = {
            "phase": runtime.phase,
            "detail": runtime.detail,
            "model_id": runtime.model_id,
            "loaded": list(runtime.loaded),
            "device": runtime.device,
            "device_count": runtime.device_count,
            "last_active": runtime.last_active,
            "jobs_done": runtime.jobs_done,
            "last_error": runtime.last_error,
            "last_error_code": runtime.last_error_code,
            "started_at": runtime.started_at,
        }
    with boot_lock:
        values["tunnel_provider"] = boot.tunnel_provider
        values["tunnel_state"] = boot.tunnel_state
        values["tunnel_restarts"] = boot.tunnel_restarts
    return HealthSnapshot(**values)


def build_payload(
    snapshot: HealthSnapshot,
    *,
    version: str,
    idle_timeout_sec: int,
    queue_depth: int,
    now: float | None = None,
) -> dict:
    """组 ``/health`` 响应体（字段顺序与 0.10.0 一致，Host 按名取用）。

    ``queue_depth`` 由调用方在**释放 STATE_LOCK 之后**取好再传进来（见模块头锁顺序说明），
    本函数不调用任何会加锁的协作者。
    """
    current = time.time() if now is None else now
    return {
        "status": "error" if snapshot.phase == "error" else "ok",
        "phase": snapshot.phase,
        "version": version,
        # M4.2：依赖版本快照（纯版本号，不含 token / 路径），用于 LKGR 基线与故障归因。
        "versions": dependency_versions(),
        "model_id": snapshot.model_id,
        "loaded": snapshot.loaded,
        "device": snapshot.device,
        "device_count": snapshot.device_count,
        "idle_seconds": round(current - snapshot.last_active, 1),
        "idle_timeout_sec": idle_timeout_sec,
        "jobs_done": snapshot.jobs_done,
        # 0.5.0：排队中（尚未开始执行）的 job 数；运行中的不算。
        "queue_depth": queue_depth,
        "last_error": snapshot.last_error,
        "last_error_code": snapshot.last_error_code,
        "detail": snapshot.detail,
        "uptime_seconds": round(current - snapshot.started_at, 1),
        # P0.2 / P2.2：隧道监管状态，Host 用于「重连中 / 通道类型」展示与故障归因。
        "tunnel_provider": snapshot.tunnel_provider,
        "tunnel_state": snapshot.tunnel_state,
        "tunnel_restarts": snapshot.tunnel_restarts,
        # M3 图生图验收：显存只读诊断（torch 未加载 / CUDA 不可用时为 null）。
        "gpu_memory": gpu_memory_payload(),
    }
