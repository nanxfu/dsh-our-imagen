"""运行期可变状态：RuntimeState / BootState 与保护它们的锁。

为什么从 daemon.py 拆出来：状态对象和锁必须处在同一个边界内，否则任何函数都能绕过
边界直接改字段（原先 4 把锁散落在模块顶层，读写全靠自觉）。搬到这里后，daemon 只保留
模块级引用（``from remote.state import BOOT, STATE``）：阶段切换与错误记录只剩本模块的
:func:`set_phase` / :func:`record_error` 两个入口，其余字段仍由 daemon 在 ``STATE_LOCK`` /
``BOOT_LOCK`` 内读写——收成完整 store 语义方法属于 Batch 2 后续切片。

维护约定（对应 docs/REFACTOR_ARCHITECTURE_SPEC.md §5.9 / §5.10）：

1. **单例只在 import 时创建一次，之后只做原地更新**。禁止在别处写
   ``daemon.STATE = RuntimeState()`` 这类重新绑定：本模块的函数与注入出去的协作者读的
   都是 ``STATE`` 这个对象，重新绑定会让两边各自持有一份状态，而且不会报错
   （单测里表现为"断言测到旧对象"的假绿）。
2. **状态对象不加 ``__slots__``**：现有单测会动态挂 ``STATE.waiting`` 之类的历史字段，
   加 slots 会让这些用例直接报错——那是测试适配问题，不是本模块该管的。
3. **日志一律用扁平导入 ``from log_ring import log``**：daemon 就是这么导入的；
   写成 ``from remote.log_ring import log`` 会得到第二份环形缓冲，``/logs`` 会静默变空。
4. ``_START_TS`` 取自 log_ring：进程启动时刻只应有一个来源，否则 /health 的
   ``uptime`` 与日志里的 ``+Xs`` 会对不上。
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from log_ring import _START_TS, log


@dataclass
class RuntimeState:
    """运行期状态：生命周期、模型句柄与统计。"""

    phase: str = "booting"
    detail: str | None = "进程启动"
    model_id: str | None = None
    loaded: list = field(default_factory=list)
    device: str | None = None
    device_count: int = 0
    last_active: float = _START_TS
    jobs_done: int = 0
    last_error: str | None = None
    last_error_code: str | None = None
    started_at: float = _START_TS
    pipe: object | None = None
    pipeline_key: str | None = None
    sig_params: set = field(default_factory=set)
    # 图生图管线：首次用到时用 AutoPipelineForImage2Image.from_pipe(STATE.pipe) 惰性创建，
    # 与 txt2img 共用组件（不额外加载权重、不额外占显存）；切换/释放底座时一并清空。
    img2img_pipe: object | None = None
    img2img_sig_params: set = field(default_factory=set)
    # 局部重绘管线：同理用 AutoPipelineForInpainting.from_pipe(STATE.pipe) 惰性创建。
    # 与 img2img 只在各自缓存里存在一份，两者都指向同一批底座组件。
    inpaint_pipe: object | None = None
    inpaint_sig_params: set = field(default_factory=set)
    # 当前底座是否本身就是 inpaint 专用权重（9 通道）：此时 STATE.pipe 已经是 inpaint 管线，
    # 不需要再 from_pipe 派生，也不能跑文生图 / 纯图生图。
    native_inpaint: bool = False
    booted: bool = False
    shutting_down: bool = False


@dataclass
class TunnelAttempt:
    """单次隧道启动尝试的令牌：超时后失活，防止旧 drain 线程污染新尝试的 BOOT 状态。"""

    provider: str = ""
    active: bool = True


@dataclass
class BootState:
    """启动期会合状态：隧道与 ready 发布。"""

    tunnel_url: str | None = None
    tunnel_error: str | None = None
    cloudflared: object | None = None
    published_ready: bool = False
    # P0.2：隧道监管状态（/health 与 ready 事件对外上报）。
    tunnel_provider: str | None = None
    tunnel_state: str = "starting"
    tunnel_restarts: int = 0
    # 隧道失败把 phase 打成 error 时记下原阶段；隧道恢复后还原，避免 Host 一直看到 error。
    phase_before_error: str | None = None
    http_server: object | None = None
    current_attempt: TunnelAttempt | None = None
    # /shutdown 或信号置位后监管线程退出。整个进程只创建一个 Event。
    stop_event: threading.Event = field(default_factory=threading.Event)
    # 启动接管信号：任一通过 Bearer 鉴权的 Host 请求置位（见 transport/http_server.py）。
    # claim 看门狗在置位后不再触发；用 Event 而不是 bool，是为了跨线程读不持锁且幂等。
    claim_event: threading.Event = field(default_factory=threading.Event)


# 单例：全进程各一份，只原地更新（见模块头第 1 条）。
STATE = RuntimeState()
BOOT = BootState()
# 状态锁；不放状态对象里，避免状态复制时连带复制锁。
STATE_LOCK = threading.RLock()
BOOT_LOCK = threading.RLock()


def set_phase(phase: str, detail: str | None = None) -> None:
    """切换生命周期阶段（booting / installing / loading / ready / error）。"""
    with STATE_LOCK:
        STATE.phase = phase
        STATE.detail = detail
        # 启动阶段的进度也算"活动"，避免依赖安装还没结束就被空闲看门狗收走。
        STATE.last_active = time.time()
    log(f"[phase] {phase}" + (f" — {detail}" if detail else ""))


def record_error(code: str, message: str) -> None:
    """``/health.last_error`` 是字符串：Host 直接拼进 UI，对象会显示成 [object Object]。"""
    with STATE_LOCK:
        STATE.last_error = f"{code}: {message}"
        STATE.last_error_code = code
