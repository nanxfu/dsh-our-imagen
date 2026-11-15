"""TunnelSupervisor：cloudflared 二进制、通道计划与常驻隧道监管的唯一边界。

为什么从 daemon.py 拆出来：隧道路径原先有 11 个包装函数，每个都只是把 ``BOOT`` /
``BOOT_LOCK`` / ``STATE`` / ``STATE_LOCK`` / ``log`` 塞进 ``tunnel.py`` 的纯函数。这层
胶水有两个副作用：

1. **两个隐式调用环**（规格 §6.2 的第二个）藏在包装后面：
   ``monitor → start → attempt → drain`` 与 ``announce → recover → set_phase → publish``。
   它们决定了"隧道恢复后 /health 会不会一直停在 error"，却只能靠读 daemon 才能拼出来；
2. 二进制参数（路径 / URL / SHA256 / 大小上限）是模块常量，测试只能 patch
   ``daemon.CLOUDFLARED_*``——**patch 模块常量与真实调用点之间没有任何结构约束**，
   谁把常量改成构造期拷贝，测试就会静默失效。

所以这里做了两件事：

- :class:`TunnelBinary` 把二进制参数收成一个可替换的设置对象，``TunnelSupervisor``
  每次调用都读它的字段（不是构造期快照），测试替换 ``TUNNEL.binary.path`` 即命中真实路径；
- :class:`TunnelSupervisor` 持有 ``boot`` / ``state`` 与三把回调
  （``publish_fn`` / ``set_phase_fn`` / ``fail_boot_fn``），把两个隐式环变成显式参数。

**ready 发布不在这里**：``publish_ready`` / ``ntfy_publish`` 属会合通知（目标结构里的
``infra/ntfy.py``），本类只接收 ``publish_fn``。隧道生命周期管"进程在不在、地址有没有"，
通知重试策略管"消息发几次"——混在一起会让"隧道恢复但 ntfy 挂了"变成同一种失败。

维护约定（对应 docs/REFACTOR_ARCHITECTURE_SPEC.md §4.1）：

1. **纯函数仍在 ``remote/tunnel.py``**：``scripts/package.mjs`` 与
   ``test/kernel-package.mjs`` 按文件名把它列入必需项，折叠要与 ``cache_ops`` 同批做。
2. **配置 / 状态传活对象**：``config`` / ``boot`` / ``state`` 都是实例，不传快照——
   注入契约在启动期原地回填，测试也按 ``CONFIG.fallback_tunnel_command = [...]`` 就地改。
3. **日志用扁平导入** ``from log_ring import log``（理由见 ``remote/state.py`` 第 3 条）。
"""

from __future__ import annotations

from dataclasses import dataclass

from log_ring import log
from remote.state import TunnelAttempt
from tunnel import (
    CLOUDFLARED_DOWNLOAD_ATTEMPTS,
    CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC,
    CLOUDFLARED_DOWNLOAD_URL,
    CLOUDFLARED_MAX_DOWNLOAD_BYTES,
    CLOUDFLARED_PATH,
    CLOUDFLARED_SHA256,
    CLOUDFLARED_VERSION,
    DEFAULT_CUSTOM_URL_RE,
    build_tunnel_plan_for,
    download_cloudflared_once_from,
    drain_tunnel_output_for,
    run_announce_tunnel_ready,
    run_recover_tunnel_error,
    run_start_tunnel,
    run_tunnel_attempt,
    run_tunnel_monitor,
    spawn_tunnel_process_for,
    terminate_tunnel_process,
    tunnel_restart_delay,
    tunnel_url_regex_for,
    verify_or_download_cloudflared,
    wait_tunnel_exit,
)


@dataclass
class TunnelBinary:
    """cloudflared 的固定版本与下载参数（默认值即生产口径，测试按字段替换）。

    非 frozen：单测用 ``mock.patch.object(TUNNEL.binary, "path", tmp)`` 就地替换，
    这比 patch 模块常量更接近真实调用点——字段是在**调用时**读的，不是构造时拷贝。
    """

    path: str = CLOUDFLARED_PATH
    url: str = CLOUDFLARED_DOWNLOAD_URL
    sha256: str = CLOUDFLARED_SHA256
    version: str = CLOUDFLARED_VERSION
    max_bytes: int = CLOUDFLARED_MAX_DOWNLOAD_BYTES
    timeout_sec: float = CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC
    attempts: int = CLOUDFLARED_DOWNLOAD_ATTEMPTS


class TunnelSupervisor:
    """隧道生命周期的唯一持有者：二进制、通道计划、单次尝试与常驻监管。"""

    def __init__(
        self,
        *,
        config,  # noqa: ANN001 - DaemonConfig（活对象：读 fallback_tunnel_*）
        boot,  # noqa: ANN001 - BootState
        boot_lock,  # noqa: ANN001
        state,  # noqa: ANN001 - RuntimeState（只读 shutting_down / phase）
        state_lock,  # noqa: ANN001
        publish_fn,  # noqa: ANN001 - Callable[[], None]：发布 ready（会合通知留在类外）
        set_phase_fn,  # noqa: ANN001 - Callable[[str, str | None], None]
        fail_boot_fn,  # noqa: ANN001 - Callable[..., None]：带 tunnel=True 的启动失败上报
        binary: TunnelBinary | None = None,
        log_fn=log,  # noqa: ANN001
        attempt_cls=TunnelAttempt,  # noqa: ANN001 - 单测替身可换
    ) -> None:
        self._config = config
        self._boot = boot
        self._boot_lock = boot_lock
        self._state = state
        self._state_lock = state_lock
        self._publish_fn = publish_fn
        self._set_phase_fn = set_phase_fn
        self._fail_boot_fn = fail_boot_fn
        self._log = log_fn
        self._attempt_cls = attempt_cls
        # 公开字段：测试与排障都从 `TUNNEL.binary` 取当前生效的二进制参数。
        self.binary = binary if binary is not None else TunnelBinary()

    # ---- cloudflared 二进制 ----

    def download_once(self, partial: str) -> tuple[int, str]:
        """流式下载一次到 ``partial``，边写边算 SHA256（参数每次从 ``self.binary`` 读）。"""
        binary = self.binary
        return download_cloudflared_once_from(
            partial,
            download_url=binary.url,
            timeout_sec=binary.timeout_sec,
            max_bytes=binary.max_bytes,
        )

    def ensure_cloudflared(self) -> str:
        """确保二进制可用：已就绪且 SHA256 一致则复用，否则按固定版本下载。"""
        binary = self.binary
        return verify_or_download_cloudflared(
            path=binary.path,
            download_url=binary.url,
            sha256=binary.sha256,
            version=binary.version,
            max_bytes=binary.max_bytes,
            timeout_sec=binary.timeout_sec,
            attempts=binary.attempts,
            download_once_fn=self.download_once,
            log=self._log,
        )

    # ---- 通道计划 ----

    def url_regex(self, pattern: str | None = None):  # noqa: ANN202 - 返回编译后的正则
        """备用通道的地址提取规则：配置优先，非法或缺省时回退内置 https 规则。"""
        return tunnel_url_regex_for(pattern, log=self._log)

    def build_plan(self, port: int) -> list[dict]:
        """按尝试顺序给出通道计划：cloudflare 优先，配置了备用命令再追加 custom。"""
        return build_tunnel_plan_for(
            port,
            cloudflared_path=self.binary.path,
            fallback_command=self._config.fallback_tunnel_command,
            fallback_regex=self._config.fallback_tunnel_url_regex,
            url_regex_fn=self.url_regex,
            log=self._log,
        )

    def should_stop(self) -> bool:
        """隧道监管是否该退出（/shutdown、信号或显式置位）。"""
        with self._state_lock:
            shutting_down = self._state.shutting_down
        return self._boot.stop_event.is_set() or shutting_down

    # ---- 单次尝试 ----

    def spawn(self, argv: list[str], provider: str = "cloudflare"):  # noqa: ANN202 - 返回 Popen 或 None
        """启动隧道子进程；失败只记录原因，交给下一个通道或下一轮重试。"""
        return spawn_tunnel_process_for(
            argv, provider, boot=self._boot, boot_lock=self._boot_lock, log=self._log
        )

    def drain(
        self,
        proc,
        provider: str,
        url_re,
        url_event,
        attempt=None,
    ) -> None:  # noqa: ANN001
        """持续读取隧道输出，首个地址写入 BOOT 并置位事件；必须读到进程退出为止。"""
        drain_tunnel_output_for(
            proc,
            provider,
            url_re,
            url_event,
            attempt,
            boot=self._boot,
            boot_lock=self._boot_lock,
            log=self._log,
        )

    def attempt(self, item: dict) -> tuple[str, object] | None:
        """启动一个通道并等待地址：成功返回 (provider, proc)，失败返回 None。"""
        return run_tunnel_attempt(
            item,
            boot=self._boot,
            boot_lock=self._boot_lock,
            attempt_cls=self._attempt_cls,
            spawn_fn=self.spawn,
            drain_fn=self.drain,
            terminate_fn=terminate_tunnel_process,
            log=self._log,
        )

    def start(self, port: int) -> tuple[str, object] | None:
        """按 provider 计划依次尝试；cloudflared 下载失败时仍会尝试备用通道。"""
        return run_start_tunnel(
            port,
            plan_fn=self.build_plan,
            should_stop_fn=self.should_stop,
            ensure_binary_fn=self.ensure_cloudflared,
            attempt_fn=self.attempt,
            boot=self._boot,
            boot_lock=self._boot_lock,
            log=self._log,
        )

    # ---- 恢复与重播 ----

    def recover_error(self) -> None:
        """隧道恢复后清掉 tunnel_failed 错误态，避免 Host 把 /health 当成致命错误。"""
        run_recover_tunnel_error(
            state=self._state,
            state_lock=self._state_lock,
            boot=self._boot,
            boot_lock=self._boot_lock,
            set_phase_fn=self._set_phase_fn,
            log=self._log,
        )

    def announce_ready(self, provider: str, *, restarted: bool = False) -> None:
        """隧道（重新）建立：记录通道类型、清隧道错误并重播 ready。"""
        run_announce_tunnel_ready(
            provider,
            restarted=restarted,
            boot=self._boot,
            boot_lock=self._boot_lock,
            recover_fn=self.recover_error,
            publish_fn=self._publish_fn,
            log=self._log,
        )

    def wait_exit(self, proc, poll_interval: float = 1.0):  # noqa: ANN001, ANN202
        """常驻等待隧道进程退出；收到停机信号时返回 None。"""
        return wait_tunnel_exit(proc, self.should_stop, poll_interval=poll_interval)

    def restart_delay(self, attempt: int) -> float:
        """重拉退避：2、4、8、16、32、60（封顶）。单独成方法便于单测压平等待。"""
        return tunnel_restart_delay(attempt)

    # ---- 常驻监管 ----

    def monitor(self, port: int) -> None:
        """常驻监管：拉起隧道 → 等进程退出 / 失败退避重拉；直到收到停机信号。"""
        run_tunnel_monitor(
            port,
            should_stop_fn=self.should_stop,
            start_tunnel_fn=self.start,
            restart_delay_fn=self.restart_delay,
            announce_fn=self.announce_ready,
            wait_exit_fn=self.wait_exit,
            terminate_fn=terminate_tunnel_process,
            fail_boot_fn=self._fail_boot_fn,
            state=self._state,
            state_lock=self._state_lock,
            boot=self._boot,
            boot_lock=self._boot_lock,
            log=self._log,
        )
