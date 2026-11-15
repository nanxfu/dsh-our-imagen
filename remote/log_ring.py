# ─────────────────────────────────────────────────────────────────────────────
# log_ring：进程内日志环与 stdout/stderr 分流（单份源码，打包时由 lib/kernel.js 内联）
#
# 维护约定：
# 1. 模块顶层只依赖标准库，不在模块加载期触发任何重库。
# 2. 不得使用 `from __future__ import annotations`（内联后会位于合并文件中间）。
# ─────────────────────────────────────────────────────────────────────────────

import re
import sys
import threading
import time
from collections import deque

# 日志环容量：Host 侧按 docs/SPEC.md 实现，最多 400 行。
LOG_MAX_LINES = 400
LOG_LINE_MAX_CHARS = 2000

_START_TS = time.time()
_ORIG_STDOUT = sys.stdout
_ORIG_STDERR = sys.stderr

_LOG_LOCK = threading.Lock()
_LOG_LINES: deque[str] = deque(maxlen=LOG_MAX_LINES)
_LOG_SEQ = 0  # 已写入的总行数；它同时就是 /logs 返回的 next

# tqdm / pip 的进度条用 \r 反复覆盖同一行，入环没有意义且会把有效信息挤掉。
_NOISE_RE = re.compile(r"(\d+%\|)|(\d+\.\d+\s*(?:it|s|B|KB|MB)/s)|(━{4,})|(B/s\])")


def _elapsed() -> float:
    return time.time() - _START_TS


def _ring_append(text: str) -> None:
    global _LOG_SEQ
    if not text:
        return
    if len(text) > LOG_LINE_MAX_CHARS:
        text = text[:LOG_LINE_MAX_CHARS] + " …(已截断)"
    with _LOG_LOCK:
        _LOG_LINES.append(text)
        _LOG_SEQ += 1


def _console(text: str) -> None:
    """只写 Kernel 控制台，不进日志环。"""
    try:
        _ORIG_STDOUT.write(text + "\n")
        _ORIG_STDOUT.flush()
    except Exception:
        pass


def log(*args) -> None:
    """同时进日志环与控制台。所有进度都要走这里，Host 才看得到。"""
    text = " ".join(str(a) for a in args)
    for piece in re.split(r"[\r\n]+", text):
        piece = piece.strip()
        if not piece or _NOISE_RE.search(piece):
            continue
        line = f"[{_elapsed():8.1f}s] {piece}"
        _ring_append(line)
        _console(line)


class _StreamTee:
    """把第三方库（tqdm、transformers、diffusers、huggingface_hub）的输出抄送到日志环。

    pip 是子进程，单独按行读取；这里处理的是同进程内库直接 print 的情况。
    """

    def __init__(self, original, name: str):
        self._original = original
        self._name = name

    def write(self, data):  # noqa: ANN001 - 兼容任意 file-like
        try:
            self._original.write(data)
            self._original.flush()
        except Exception:
            pass
        if data:
            for piece in re.split(r"[\r\n]+", str(data)):
                piece = piece.strip()
                if piece and not _NOISE_RE.search(piece):
                    _ring_append(f"[{_elapsed():8.1f}s] {piece}")
        return len(data) if data else 0

    def flush(self):
        try:
            self._original.flush()
        except Exception:
            pass

    def isatty(self) -> bool:
        try:
            return bool(self._original.isatty())
        except Exception:
            return False

    def writelines(self, lines):  # noqa: ANN001
        for line in lines:
            self.write(line)

    def __getattr__(self, name):
        return getattr(self._original, name)


def install_stream_tee() -> None:
    if not isinstance(sys.stdout, _StreamTee):
        sys.stdout = _StreamTee(_ORIG_STDOUT, "stdout")  # type: ignore[assignment]
    if not isinstance(sys.stderr, _StreamTee):
        sys.stderr = _StreamTee(_ORIG_STDERR, "stderr")  # type: ignore[assignment]


def log_since(since: int) -> tuple[list[str], int]:
    """返回序号 > since 的日志行与最新的 next。

    行序号从 1 开始；环形缓冲只保留最近 LOG_MAX_LINES 行。since 早于缓冲起点时
    直接返回当前全部内容（Host 侧按 next 继续拉即可，不会重复也不会丢尾）。
    """
    with _LOG_LOCK:
        total = _LOG_SEQ
        snapshot = list(_LOG_LINES)
    if not snapshot:
        return [], total
    first_seq = total - len(snapshot) + 1
    lines = [line for offset, line in enumerate(snapshot) if first_seq + offset > since]
    return lines, total


def reset_log_ring(stdout=None):  # noqa: ANN001, ANN201
    """清空日志环并可选替换控制台输出流，返回原 ``_ORIG_STDOUT``（单测夹具用）。"""
    global _LOG_SEQ, _ORIG_STDOUT
    with _LOG_LOCK:
        _LOG_LINES.clear()
        _LOG_SEQ = 0
    previous = _ORIG_STDOUT
    if stdout is not None:
        _ORIG_STDOUT = stdout
    return previous
