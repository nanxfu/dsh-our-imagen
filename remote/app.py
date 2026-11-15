"""进程生命周期与组装：启动顺序、信号、退出清理与空闲看门狗。

为什么从 daemon.py 拆出来：daemon 的尾部（``main`` / ``runtime_boot`` / ``tunnel_boot`` /
信号处理 / 清理）是**进程编排**，与"怎么加载模型、怎么出图"无关；两者混在一起时，
调整启动顺序要读完整份守护进程，也无法在不拉起 torch 的前提下验证启动链路。

三段职责（对应 docs/REFACTOR_ARCHITECTURE_SPEC.md §2.1 的 ``app.py``）：

1. :meth:`DaemonApp.run` —— Composition Root 的执行体：读配置 → 安全闸门 → HTTP 先起 →
   worker → 隧道 → 运行时后台线程 → 主循环（会合点发布、周期重播、空闲看门狗）；
2. :meth:`DaemonApp.runtime_boot` —— GPU 探测 → 装依赖 → 可选预加载 → ``phase=ready``；
3. :meth:`DaemonApp.tunnel_boot` / :meth:`DaemonApp.install_signal_handlers` /
   模块级 :func:`log_environment` —— 只做"拉起与收尾"，不含业务分支。

**装配约定（为什么依赖全是 lambda）**：daemon.py 在文件末尾构造 :class:`DaemonApp`，
把本模块的符号作为依赖传进来。传 ``lambda: install_dependencies()`` 而不是
``install_dependencies`` 本身，是为了让单测的 ``mock.patch.object(daemon, ...)`` 在
调用点生效——直接传函数对象会把构造时刻的实现绑死在实例上，断言会静默测到旧对象
（架构规格 §1.3.6 / §5.10）。同理，本模块**不 import daemon**：反向导入会成环，
也会把"依赖哪来的"藏进 import 语句里。

**启动顺序不可调换**（每条都对应一次实测故障，见 daemon 顶部说明）：HTTP 必须早于
pip 安装与模型加载，否则 Kernel 排队 30 分钟后在装依赖期间完全不可观测；隧道与运行时
必须各自后台跑，主线程只负责会合点与看门狗。
"""

from __future__ import annotations

import os
import platform
import shutil
import threading
import time

from log_ring import log
from remote.text import short

# M3.3：Kaggle 未绑定手机号或未启用 GPU 加速器时会静默降级成 CPU 容器。这里必须立刻
# 给出可执行的下一步，而不是继续用 CPU 硬跑（那会表现为超时或模糊的 CUDA 报错）。
GPU_UNAVAILABLE_MESSAGE = (
    "未检测到可用 GPU（当前为 CPU 容器）。"
    "请检查 Kaggle 账号是否已完成手机号验证，并确认已启用 GPU 加速器"
    "（本插件推送 Kernel 时默认开启 2×Tesla T4）"
)


def log_environment() -> None:
    """启动期一次性环境诊断：Python / 平台 / 关键目录剩余空间。"""
    log(f"[env] python={platform.python_version()} platform={platform.platform()}")
    for path in ("/kaggle/working", "/tmp", os.getcwd()):
        try:
            usage = shutil.disk_usage(path)
            log(f"[env] disk {path}: free={usage.free / 2**30:.1f}GiB total={usage.total / 2**30:.1f}GiB")
        except Exception:
            continue


class DaemonApp:
    """守护进程的生命周期编排器：唯一持有"启动顺序"与"退出条件"的地方。

    构造函数即依赖清单——凡是跨模块协作者都以关键字传入，本类不读任何模块级全局。
    需要"每次都取最新实现"的协作者（安装依赖、加载管线、发布 ready……）由调用方包成
    lambda 传入，理由见模块头「装配约定」。
    """

    def __init__(
        self,
        *,
        config,  # noqa: ANN001 - DaemonConfig（活对象）
        state,  # noqa: ANN001 - RuntimeState
        boot,  # noqa: ANN001 - BootState
        state_lock,  # noqa: ANN001
        boot_lock,  # noqa: ANN001
        gen_lock,  # noqa: ANN001 - 生成串行锁：看门狗用它判断"正在出图"
        load_config,  # noqa: ANN001 - Callable[[], DaemonConfig]
        apply_hf_token,  # noqa: ANN001 - Callable[[], bool]
        auth_missing,  # noqa: ANN001 - Callable[[], bool]
        protocol_version,  # noqa: ANN001 - Callable[[], str]
        install_stream_tee,  # noqa: ANN001 - Callable[[], None]
        install_dependencies,  # noqa: ANN001 - Callable[[], None]
        ensure_pipeline,  # noqa: ANN001 - Callable[[dict], tuple]
        classify_failure,  # noqa: ANN001 - Callable[..., tuple[str, str]]
        free_cuda_cache,  # noqa: ANN001 - Callable[[], None]
        set_phase,  # noqa: ANN001 - Callable[[str, str | None], None]
        fail_boot,  # noqa: ANN001 - Callable[[str, str], None]
        publish_ready,  # noqa: ANN001 - Callable[[], None]
        active_job_count,  # noqa: ANN001 - Callable[[], int]
        queue_depth,  # noqa: ANN001 - Callable[[], int]
        start_http_server,  # noqa: ANN001 - Callable[[int], object]
        start_job_worker,  # noqa: ANN001 - Callable[[], object]
        tunnel_monitor,  # noqa: ANN001 - Callable[[int], None]
        cleanup_before_exit,  # noqa: ANN001 - Callable[[], None]
        announce_interval_sec: float,
        poll_interval_sec: float = 2.0,
        report_interval_sec: float = 30.0,
        exit_fn=os._exit,  # noqa: ANN001 - 单测替换成记录函数
        clock=time.time,  # noqa: ANN001
        thread_factory=None,  # noqa: ANN001 - Callable[[Callable, str], object] | None
    ) -> None:
        self._config = config
        self._state = state
        self._boot = boot
        self._state_lock = state_lock
        self._boot_lock = boot_lock
        self._gen_lock = gen_lock
        self._load_config = load_config
        self._apply_hf_token = apply_hf_token
        self._auth_missing = auth_missing
        self._protocol_version = protocol_version
        self._install_stream_tee = install_stream_tee
        self._install_dependencies = install_dependencies
        self._ensure_pipeline = ensure_pipeline
        self._classify_failure = classify_failure
        self._free_cuda_cache = free_cuda_cache
        self._set_phase = set_phase
        self._fail_boot = fail_boot
        self._publish_ready = publish_ready
        self._active_job_count = active_job_count
        self._queue_depth = queue_depth
        self._start_http_server = start_http_server
        self._start_job_worker = start_job_worker
        self._tunnel_monitor = tunnel_monitor
        self._cleanup_before_exit = cleanup_before_exit
        self._announce_interval_sec = announce_interval_sec
        self._poll_interval_sec = poll_interval_sec
        self._report_interval_sec = report_interval_sec
        self._exit_fn = exit_fn
        self._clock = clock
        self._thread_factory = thread_factory

    # ---- 线程 ----

    def _spawn(self, target, name: str):  # noqa: ANN001, ANN202
        """拉起后台线程；``thread_factory`` 存在时交给它（单测用来只记录不真跑）。"""
        factory = self._thread_factory
        if factory is not None:
            return factory(target, name)
        thread = threading.Thread(target=target, name=name, daemon=True)
        thread.start()
        return thread

    # ---- 组装入口：启动顺序 ----

    def run(self) -> None:
        """进程主入口：装配顺序即故障史（见模块头），返回时已完成退出清理。"""
        self._install_stream_tee()
        self.install_signal_handlers()
        with self._state_lock:
            self._state.started_at = self._clock()
            self._state.last_active = self._state.started_at

        log("=" * 72)
        log(f"imagen 远端 Daemon v{self._protocol_version()} 启动")
        try:
            # 原地回填模块级 CONFIG：不能写成 `CONFIG = load_config()`，各协作者读的是
            # 同一个对象，重新绑定会让它们继续看旧配置（架构规格 §5.9）。
            self._load_config()
        except SystemExit as exc:
            log(f"[config] {exc}")
            self._exit_fn(2)
            return
        log_environment()
        # P1.2：HF_TOKEN 必须在任何下载/加载之前写好（gated 仓库与匿名限流都依赖它）。
        self._apply_hf_token()

        # 0) 安全闸门：没有 auth_token 且没有显式允许无鉴权 → 拒绝对外服务（不发布 ready）。
        if self._auth_missing():
            message = "未配置 auth_token 且未开启 allow_no_auth，拒绝以无鉴权模式对外提供服务"
            log(f"[boot] {message}")
            self._fail_boot("unauthorized", message)
            self._exit_fn(4)
            return

        # 1) HTTP 先起来：Host 靠 /health 判断 phase，不依赖模型是否加载完。
        try:
            self._start_http_server(self._config.port)
        except Exception as exc:
            log(f"[http] 端口 {self._config.port} 监听失败：{short(exc)}")
            self._exit_fn(3)
            return

        # 1.5) 异步 job worker：常驻线程串行消费 /generate 入队的任务。
        #      放在 HTTP 之后启动，这样即使首图加载慢，Host 的 /health 也一直可用。
        self._start_job_worker()

        # 2) 隧道与运行时各自后台跑，互不阻塞（tunnel_boot 自己拉起监管线程）。
        self.tunnel_boot(self._config.port)
        self._spawn(self.runtime_boot, "runtime-boot")

        # 3) 主线程：会合点发布 + 周期性重播 + 空闲看门狗。
        self._main_loop()
        self._cleanup_before_exit()

    def _main_loop(self) -> None:
        """会合点发布与空闲看门狗，直到 ``BOOT.stop_event`` 被置位。"""
        last_report = 0.0
        last_announce = self._clock()
        while not self._boot.stop_event.wait(self._poll_interval_sec):
            now = self._clock()

            should_publish = False
            with self._boot_lock:
                if self._boot.tunnel_url and not self._boot.published_ready:
                    self._boot.published_ready = True
                    should_publish = True
                tunnel_url = self._boot.tunnel_url
                tunnel_provider = self._boot.tunnel_provider
            if should_publish:
                self._publish_ready()

            # P0.2：每 TUNNEL_ANNOUNCE_SEC 秒重播一次 ready，Host 心跳丢失后可重新会合。
            if tunnel_url and now - last_announce >= self._announce_interval_sec:
                last_announce = now
                log(
                    f"[tunnel] 周期重播 ready（通道 {tunnel_provider or 'unknown'}，"
                    f"间隔 {int(self._announce_interval_sec)}s）"
                )
                self._spawn(self._publish_ready, "announce-ready")

            with self._state_lock:
                last_active = self._state.last_active
                phase = self._state.phase
                jobs_done = self._state.jobs_done
            idle = now - last_active
            busy = self._active_job_count() > 0 or self._gen_lock.locked()
            # 启动阶段（装依赖/预加载）不参与空闲退出：Host 可能把 idle_timeout 调得很短，
            # 但首轮加载本来就要几分钟。失败进入 error 后照样会被看门狗收走。
            bootstrapping = phase in ("booting", "installing", "loading")
            if not busy and not bootstrapping and idle >= self._config.idle_timeout_sec:
                log(f"[idle] 空闲 {int(idle)}s ≥ {self._config.idle_timeout_sec}s，退出进程释放 GPU 配额")
                self._cleanup_before_exit()
                self._exit_fn(0)
                return

            if now - last_report >= self._report_interval_sec:
                last_report = now
                log(
                    f"[alive] phase={phase} idle={int(idle)}s jobs={jobs_done} "
                    f"queue={self._queue_depth()} tunnel={'ok' if tunnel_url else 'pending'}"
                )

    # ---- 运行时启动 ----

    def runtime_boot(self) -> None:
        """后台线程：探测 GPU → 装依赖 →（可选）预加载模型 → phase=ready。"""
        torch_error = ""
        device_name = None
        device_count = 0
        try:
            import torch

            if torch.cuda.is_available():
                device_name = torch.cuda.get_device_name(0)
                device_count = torch.cuda.device_count()
                log(f"[cuda] {device_name} × {device_count}，torch={torch.__version__}，cuda={torch.version.cuda}")
        except Exception as exc:
            torch_error = short(exc)
            log(f"[cuda] 导入 torch 失败：{torch_error}")

        with self._state_lock:
            self._state.device = device_name
            self._state.device_count = device_count

        if not device_count:
            if torch_error:
                # torch 都没能导入时无法确认 GPU 状态，保留 load_failed 以免误导成账号问题。
                self._fail_boot("load_failed", f"无法确认 GPU 可用性：{torch_error}")
            else:
                self._fail_boot("gpu_unavailable", GPU_UNAVAILABLE_MESSAGE)
            return

        try:
            self._install_dependencies()
        except Exception as exc:
            self._fail_boot("load_failed", short(exc))
            return

        preload = self._config.preload
        if preload:
            try:
                with self._gen_lock:
                    self._ensure_pipeline(preload)
            except Exception as exc:
                self._free_cuda_cache()
                code, message = self._classify_failure(exc, default="load_failed")
                self._fail_boot(code, message)
                return

        with self._state_lock:
            self._state.booted = True
            need_ready = self._state.phase != "ready"
        if need_ready:
            self._set_phase("ready", "依赖已就绪，等待首个生成请求下发 pipeline")
        log("[boot] 运行时就绪，可以接单")

    # ---- 隧道 ----

    def tunnel_boot(self, port: int) -> None:
        """启动常驻隧道监管线程（不阻塞 HTTP 服务与运行时启动）。"""
        with self._boot_lock:
            self._boot.tunnel_state = "starting"
        log("[tunnel] 启动隧道监管（cloudflared 优先，失败自动重拉）")
        self._spawn(lambda: self._tunnel_monitor(port), "tunnel-monitor")

    # ---- 信号 ----

    def install_signal_handlers(self) -> None:
        """SIGTERM / SIGINT 走与 /shutdown 相同的清理路径（幂等，可重复调用）。"""

        def _bye(signum, _frame):  # noqa: ANN001
            log(f"[signal] 收到信号 {signum}，退出进程")
            self._cleanup_before_exit()
            self._exit_fn(0)

        try:
            import signal

            for sig in (signal.SIGTERM, signal.SIGINT):
                try:
                    signal.signal(sig, _bye)
                except Exception:
                    pass
        except Exception:
            pass
