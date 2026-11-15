# ─────────────────────────────────────────────────────────────────────────────
# tunnel：cloudflared 校验下载、隧道计划与常驻监管（单份源码）
#
# 维护约定：
# 1. 模块顶层只依赖标准库，不在模块加载期触发任何重库。
# 2. 不得使用 `from __future__ import annotations`（内联后会位于合并文件中间）。
# 3. 禁止与 daemon.py / log_ring.py / cache_ops.py / pipeline_loader.py 顶层符号冲突。
# ─────────────────────────────────────────────────────────────────────────────

import hashlib
import os
import re
import subprocess
import threading
import time
import urllib.request

CLOUDFLARED_PATH = "/tmp/cloudflared"
# 0.8.1（v0.9 M1）起固定 cloudflared 版本并校验 SHA256。此前用 /releases/latest/download/
# 滚动地址：上游一发版、或网络只传了半截文件，冷启动就会随机失败，而且从
# BOOT.tunnel_error 里看不出是哪一环。固定 tag 后同一份二进制可复现，校验不匹配
# 能明确报出「期望/实际」并重试一次。
CLOUDFLARED_VERSION = "2026.11.0"
CLOUDFLARED_DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/download/2026.11.0/cloudflared-linux-amd64"
)
# 校验和来源：cloudflared 2026.11.0 官方 Release 说明里的 SHA256 Checksums
# （GitHub Releases 页面 / releases.atom），并已用本机实际下载的
# cloudflared-linux-amd64（40,283,099 字节）复算 SHA256，与官方值逐位一致。
CLOUDFLARED_SHA256 = "51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd"
# 下载大小上限：官方 linux-amd64 约 38.4 MiB；120 MB 足以容纳异常响应，又不会把
# Kaggle 容器磁盘写满。单次下载超时 120s，下载异常或校验不匹配时共尝试 2 次。
CLOUDFLARED_MAX_DOWNLOAD_BYTES = 120 * 2**20
CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC = 120
CLOUDFLARED_DOWNLOAD_ATTEMPTS = 2
CLOUDFLARED_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
# 备用通道（自建 FRP / bore 等）默认从进程输出里抓 https 地址；Host 可用
# fallback_tunnel_url_regex 覆盖（例如自签名域名或带路径的地址）。
DEFAULT_CUSTOM_URL_RE = re.compile(r"https://[^\s\"'<>]+")
TUNNEL_WAIT_SEC = 120.0
# P0.2 隧道自愈：进程异常退出后按指数退避重拉（2s 起、60s 封顶），
# 并每 TUNNEL_ANNOUNCE_SEC 秒重播一次 ready，帮助 Host 在心跳丢失后重新会合。
TUNNEL_RESTART_BASE_SEC = 2.0
TUNNEL_RESTART_MAX_SEC = 60.0
TUNNEL_ANNOUNCE_SEC = 300.0
TUNNEL_PROVIDERS = ("cloudflare", "custom")


class _CloudflaredDownloadTooLarge(RuntimeError):
    """响应体超过大小上限：不是瞬时故障，重试没有意义，直接中止。"""


def _tunnel_short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    return " ".join(text.split())[:limit]


def _remove_file_quietly(path: str) -> None:
    """删除临时文件，失败只忽略（清理动作不能掩盖真正要抛的错误）。"""
    try:
        os.remove(path)
    except OSError:
        pass


def download_cloudflared_once_from(
    partial: str,
    *,
    download_url: str = CLOUDFLARED_DOWNLOAD_URL,
    timeout_sec: float = CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC,
    max_bytes: int = CLOUDFLARED_MAX_DOWNLOAD_BYTES,
) -> tuple[int, str]:
    """流式下载一次 cloudflared 到 ``partial``，边写边算 SHA256。

    返回 ``(字节数, sha256 十六进制小写)``。任何异常（网络、写盘、超大小上限）都先
    删掉半截文件再向上抛，保证重试时不会读到上一次的残留。
    """
    total = 0
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(download_url, timeout=timeout_sec) as response, open(partial, "wb") as handle:
            while True:
                chunk = response.read(1 << 16)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise _CloudflaredDownloadTooLarge(
                        f"响应超过大小上限 {max_bytes} 字节，已中止"
                    )
                handle.write(chunk)
                digest.update(chunk)
    except BaseException:
        _remove_file_quietly(partial)
        raise
    return total, digest.hexdigest()


def _file_sha256(path: str) -> str:
    """计算本地文件 SHA256（小写十六进制）；读取失败返回空串触发重下。"""
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(1 << 16)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


def verify_or_download_cloudflared(
    *,
    path: str = CLOUDFLARED_PATH,
    download_url: str = CLOUDFLARED_DOWNLOAD_URL,
    sha256: str = CLOUDFLARED_SHA256,
    version: str = CLOUDFLARED_VERSION,
    max_bytes: int = CLOUDFLARED_MAX_DOWNLOAD_BYTES,
    timeout_sec: float = CLOUDFLARED_DOWNLOAD_TIMEOUT_SEC,
    attempts: int = CLOUDFLARED_DOWNLOAD_ATTEMPTS,
    download_once_fn=None,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> str:
    """确保 ``path`` 可用：已就绪且 SHA256 一致则复用，否则按固定版本下载。"""
    expected = sha256.strip().lower()
    if os.path.exists(path) and os.access(path, os.X_OK):
        existing_sha = _file_sha256(path)
        if existing_sha == expected:
            log("[tunnel] 复用已存在的 /tmp/cloudflared")
            return path
        log(
            f"[tunnel] WARN 已存在的 /tmp/cloudflared SHA256 校验失败"
            f"（期望 {expected[:16]}…，实际 {existing_sha[:16]}…），删除重下"
        )
        _remove_file_quietly(path)

    partial = path + ".part"
    last_reason = "未知原因"
    for attempt in range(1, attempts + 1):
        log(f"[tunnel] 下载 cloudflared {version}（第 {attempt}/{attempts} 次）…")
        try:
            if download_once_fn is not None:
                total, actual = download_once_fn(partial)
            else:
                total, actual = download_cloudflared_once_from(
                    partial,
                    download_url=download_url,
                    timeout_sec=timeout_sec,
                    max_bytes=max_bytes,
                )
        except _CloudflaredDownloadTooLarge as exc:
            raise RuntimeError(f"cloudflared {version} 下载失败：{exc}") from exc
        except Exception as exc:
            last_reason = f"下载异常：{_tunnel_short(exc)}"
            log(f"[tunnel] WARN cloudflared {last_reason}（第 {attempt}/{attempts} 次）")
            continue
        if actual == expected:
            os.replace(partial, path)
            os.chmod(path, 0o755)
            log(
                f"[tunnel] cloudflared {version} 就绪"
                f"（{round(total / 2**20, 1)} MB，SHA256 {actual[:12]}… 校验通过）"
            )
            return path
        _remove_file_quietly(partial)
        last_reason = f"SHA256 校验失败：期望 {expected[:16]}…，实际 {actual[:16]}…"
        log(f"[tunnel] WARN cloudflared {last_reason}（第 {attempt}/{attempts} 次）")
    raise RuntimeError(
        f"cloudflared {version} 下载失败（{attempts} 次尝试均未成功）：{last_reason}"
    )


def normalize_tunnel_command(command, port: int) -> list[str]:  # noqa: ANN001
    """argv 模板规整：过滤空项、替换 ``{port}``；没有任何占位符时把端口追加到末尾。"""
    if not isinstance(command, (list, tuple)):
        return []
    argv: list[str] = []
    has_placeholder = False
    for item in command:
        if not isinstance(item, str) or not item.strip():
            continue
        if "{port}" in item:
            has_placeholder = True
            argv.append(item.replace("{port}", str(port)))
        else:
            argv.append(item)
    if argv and not has_placeholder:
        argv.append(str(port))
    return argv


def extract_tunnel_url(line, pattern) -> str | None:  # noqa: ANN001
    """从一行输出里提取隧道地址（去掉句末标点）；匹配不到返回 None。"""
    if not isinstance(line, str) or not line:
        return None
    try:
        match = pattern.search(line)
    except Exception:
        return None
    if not match:
        return None
    return match.group(0).rstrip(".,;)")


def tunnel_url_regex_for(pattern: str | None = None, *, log=print):  # noqa: ANN001, ANN201
    """备用通道的地址提取规则：配置优先，非法或缺省时回退内置 https 规则。"""
    if isinstance(pattern, str) and pattern.strip():
        try:
            return re.compile(pattern)
        except re.error as exc:
            log(f"[tunnel] WARN fallback_tunnel_url_regex 非法（{exc}），改用默认规则")
    return DEFAULT_CUSTOM_URL_RE


def build_tunnel_plan_for(
    port: int,
    *,
    cloudflared_path: str = CLOUDFLARED_PATH,
    fallback_command=None,  # noqa: ANN001
    fallback_regex: str | None = None,
    url_regex_fn=None,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> list[dict]:
    """按尝试顺序给出通道计划：cloudflare 优先，配置了备用命令再追加 custom。"""
    plan = [
        {
            "provider": "cloudflare",
            "argv": [cloudflared_path, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            "url_re": CLOUDFLARED_URL_RE,
            "wait_sec": TUNNEL_WAIT_SEC,
        }
    ]
    custom = normalize_tunnel_command(fallback_command, port)
    if custom:
        resolve_regex = url_regex_fn or (lambda p: tunnel_url_regex_for(p, log=log))
        plan.append(
            {
                "provider": "custom",
                "argv": custom,
                "url_re": resolve_regex(fallback_regex),
                "wait_sec": TUNNEL_WAIT_SEC,
            }
        )
    return plan


def tunnel_restart_delay(attempt: int) -> float:
    """指数退避：2、4、8、16、32、60（封顶）；attempt 从 1 开始。"""
    exponent = max(0, int(attempt) - 1)
    return min(TUNNEL_RESTART_MAX_SEC, TUNNEL_RESTART_BASE_SEC * (2**exponent))


def spawn_tunnel_process_for(argv: list[str], provider: str = "cloudflare", *, boot, boot_lock, log=print):  # noqa: ANN001, ANN201
    """启动隧道子进程；失败只记录原因，交给下一个通道或下一轮重试。"""
    log(f"[tunnel] 启动隧道进程：{' '.join(argv)}")
    try:
        if provider == "cloudflare":
            return subprocess.Popen(
                argv,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        return subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        err = f"隧道命令启动失败：{_tunnel_short(exc)}"
        with boot_lock:
            boot.tunnel_error = err
        log(f"[tunnel] {err}")
        return None


def drain_tunnel_output_for(
    proc,
    provider: str,
    url_re,
    url_event: threading.Event,
    attempt=None,
    *,
    boot,
    boot_lock,
    log=print,
) -> None:  # noqa: ANN001
    """持续读取隧道输出，首个地址写入 boot 并置位事件；必须读到进程退出为止。"""
    prefix = "cloudflared" if provider == "cloudflare" else f"tunnel:{provider or 'custom'}"
    found_url: str | None = None
    try:
        stream = getattr(proc, "stderr", None)
        if stream is None:
            stream = getattr(proc, "stdout", None)
        if stream is not None:
            for raw_line in stream:
                line = str(raw_line).rstrip()
                if not line:
                    continue
                log(f"[{prefix}] {line}")
                if found_url is None:
                    candidate = extract_tunnel_url(line, url_re)
                    if candidate:
                        found_url = candidate
                        with boot_lock:
                            if attempt is None or (attempt.active and boot.current_attempt is attempt):
                                boot.tunnel_url = candidate
                                boot.tunnel_provider = provider
                        url_event.set()
    except Exception as exc:
        log(f"[tunnel] 读取 {prefix} 输出出错：{_tunnel_short(exc)}")
    finally:
        try:
            code = proc.poll()
        except Exception:
            code = None
        log(f"[tunnel] {prefix} 输出结束（退出码 {code}，地址={found_url}）")
        if found_url is None:
            with boot_lock:
                if attempt is None or (attempt.active and boot.current_attempt is attempt):
                    boot.tunnel_error = f"{prefix} 未给出隧道地址（退出码 {code}）"
            url_event.set()


def terminate_tunnel_process(proc) -> None:  # noqa: ANN001
    """尽力结束隧道子进程（超时/退出后换通道或停机时调用）。"""
    if proc is None:
        return
    try:
        proc.terminate()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
        return
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass


def run_tunnel_attempt(
    item: dict,
    *,
    boot,  # noqa: ANN001
    boot_lock,  # noqa: ANN001
    attempt_cls,  # noqa: ANN001
    spawn_fn,  # noqa: ANN001
    drain_fn,  # noqa: ANN001
    terminate_fn,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> tuple[str, object] | None:
    """启动一个通道并等待地址：成功返回 (provider, proc)，失败返回 None。"""
    provider = str(item.get("provider") or "")
    argv = list(item.get("argv") or [])
    if not argv:
        err = f"{provider or '隧道'} 通道命令为空"
        with boot_lock:
            boot.tunnel_error = err
        log(f"[tunnel] {err}")
        return None
    attempt = attempt_cls(provider=provider, active=True)
    with boot_lock:
        if boot.current_attempt is not None:
            boot.current_attempt.active = False
        boot.current_attempt = attempt
        boot.tunnel_url = None
        boot.tunnel_error = None
    proc = spawn_fn(argv, provider)
    if proc is None:
        with boot_lock:
            attempt.active = False
            if boot.current_attempt is attempt:
                boot.current_attempt = None
        return None
    with boot_lock:
        boot.cloudflared = proc
    url_event = threading.Event()
    threading.Thread(
        target=drain_fn,
        args=(proc, provider, item.get("url_re") or DEFAULT_CUSTOM_URL_RE, url_event, attempt),
        name=f"tunnel-drain-{provider or 'custom'}",
        daemon=True,
    ).start()
    wait_sec = float(item.get("wait_sec") or TUNNEL_WAIT_SEC)
    signaled = url_event.wait(wait_sec)
    with boot_lock:
        if signaled and boot.tunnel_url:
            return provider, proc
        if boot.tunnel_url and attempt.active and boot.current_attempt is attempt:
            return provider, proc
        attempt.active = False
        if boot.current_attempt is attempt:
            boot.current_attempt = None
        if boot.cloudflared is proc:
            boot.cloudflared = None
        if boot.tunnel_error is None:
            boot.tunnel_error = f"{provider or '隧道'} 在 {int(wait_sec)}s 内未给出隧道地址"
        err_msg = boot.tunnel_error
    log(f"[tunnel] WARN 通道 {provider or 'unknown'} 未建立：{err_msg}")
    terminate_fn(proc)
    return None


def run_start_tunnel(
    port: int,
    *,
    plan_fn,  # noqa: ANN001
    should_stop_fn,  # noqa: ANN001
    ensure_binary_fn,  # noqa: ANN001
    attempt_fn,  # noqa: ANN001
    boot,  # noqa: ANN001
    boot_lock,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> tuple[str, object] | None:
    """按 provider 计划依次尝试；cloudflared 下载失败时仍会尝试备用通道。"""
    for item in plan_fn(port):
        if should_stop_fn():
            return None
        if item["provider"] == "cloudflare":
            try:
                binary = ensure_binary_fn()
            except Exception as exc:
                err = f"cloudflared 下载失败：{_tunnel_short(exc)}"
                with boot_lock:
                    boot.tunnel_error = err
                log(f"[tunnel] WARN {err}，尝试下一个通道")
                continue
            item["argv"] = [binary, *item["argv"][1:]]
        result = attempt_fn(item)
        if result is not None:
            return result
    return None


def run_recover_tunnel_error(*, state, state_lock, boot, boot_lock, set_phase_fn, log=print) -> None:  # noqa: ANN001
    """隧道恢复后清掉 tunnel_failed 错误态，避免 Host 把 /health 当成致命错误。"""
    with state_lock:
        if state.last_error_code != "tunnel_failed":
            return
        state.last_error = None
        state.last_error_code = None
        current_phase = state.phase
    if current_phase == "error":
        with boot_lock:
            prior = boot.phase_before_error
        phase = prior if prior not in (None, "error") else "booting"
        set_phase_fn(phase, "隧道已恢复")
    else:
        log(f"[tunnel] 隧道恢复，清除残留错误记录（phase={current_phase}）")


def run_announce_tunnel_ready(
    provider: str,
    *,
    restarted: bool = False,
    boot,  # noqa: ANN001
    boot_lock,  # noqa: ANN001
    recover_fn,  # noqa: ANN001
    publish_fn,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> None:
    """隧道（重新）建立：记录通道类型、清隧道错误并重播 ready。"""
    with boot_lock:
        boot.tunnel_provider = provider
        boot.tunnel_state = "up"
        boot.tunnel_error = None
        tunnel_url = boot.tunnel_url
    suffix = "（重连后重播 ready）" if restarted else ""
    log(f"[tunnel] 通道 {provider} 就绪：{tunnel_url}{suffix}")
    recover_fn()
    should_publish = False
    with boot_lock:
        if not boot.published_ready:
            boot.published_ready = True
            should_publish = True
    if should_publish:
        publish_fn()


def wait_tunnel_exit(proc, should_stop_fn, poll_interval: float = 1.0):  # noqa: ANN001, ANN201
    """常驻等待隧道进程退出；收到停机信号时返回 None。"""
    while not should_stop_fn():
        try:
            code = proc.poll()
        except Exception:
            return None
        if code is not None:
            return code
        time.sleep(max(0.01, float(poll_interval)))
    return None


def run_tunnel_monitor(
    port: int,
    *,
    should_stop_fn,  # noqa: ANN001
    start_tunnel_fn,  # noqa: ANN001
    restart_delay_fn,  # noqa: ANN001
    announce_fn,  # noqa: ANN001
    wait_exit_fn,  # noqa: ANN001
    terminate_fn,  # noqa: ANN001
    fail_boot_fn,  # noqa: ANN001
    state,  # noqa: ANN001
    state_lock,  # noqa: ANN001
    boot,  # noqa: ANN001
    boot_lock,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> None:
    """常驻监管：拉起隧道 → 等进程退出 / 失败退避重拉；直到收到停机信号。"""
    attempt = 0
    ever_ready = False
    failure_reported = False
    while not should_stop_fn():
        if attempt > 0:
            with boot_lock:
                boot.tunnel_restarts += 1
                restarts = boot.tunnel_restarts
            delay = restart_delay_fn(attempt)
            log(f"[tunnel] {delay:.0f}s 后重拉隧道（累计重启 {restarts} 次）")
            if boot.stop_event.wait(delay):
                break
        with boot_lock:
            boot.tunnel_state = "starting"
        result = start_tunnel_fn(port)
        if result is None:
            if should_stop_fn():
                break
            with boot_lock:
                boot.tunnel_state = "down"
                message = boot.tunnel_error or "隧道未建立（所有通道均失败）"
            attempt += 1
            if not ever_ready and not failure_reported:
                with state_lock:
                    phase_before = state.phase
                with boot_lock:
                    boot.phase_before_error = phase_before
                fail_boot_fn("tunnel_failed", message, tunnel=True)
                failure_reported = True
            else:
                log(f"[tunnel] 重试仍失败：{message}")
            continue
        provider, proc = result
        attempt = 0
        ever_ready = True
        with boot_lock:
            restarted = boot.tunnel_restarts > 0
        announce_fn(provider, restarted=restarted)
        code = wait_exit_fn(proc)
        if should_stop_fn():
            log("[tunnel] 收到停机信号，结束隧道监管")
            terminate_fn(proc)
            break
        log(f"[tunnel] WARN 通道 {provider} 进程退出（退出码 {code}），准备重拉")
        with boot_lock:
            boot.tunnel_state = "down"
            boot.tunnel_url = None
            boot.published_ready = False
            boot.tunnel_error = f"{provider} 进程异常退出（退出码 {code}）"
            if boot.cloudflared is proc:
                boot.cloudflared = None
        attempt = 1
