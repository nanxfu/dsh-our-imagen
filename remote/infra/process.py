"""子进程执行与 pip 依赖 plumbing：流式读行、约束合并、``-c`` 文件与 import 自检脚本。

为什么从 daemon.py 拆出来：pip 安装、卸载与 import 自检走的是同一套「拉起子进程 → 逐行
送进日志环 → 收退出码 / 尾部输出」，原先在入口文件里有两份几乎逐字相同的实现
（``_stream_process`` 与 ``run_command_tail``），各自又抄了一遍 pip 环境变量——而
``pipeline_loader.pip_env()`` 早就有这份环境构造（架构规格 §1.3 点名的重复）。搬到这里后：

- 环境构造只有 ``pip_env()`` 一处（含 ``PIP_NO_INPUT`` / 版本检查开关）；
- 约束表达式的包名归一（``package_name``）与合并规则（同名覆盖、新包追加）只有一份；
- ``IMPORT_CHECK_CODE`` 由 ``IMPORT_CHECK_MODULES`` 生成，模块清单与脚本不再各写一遍。

**不搬的部分**：``install_dependencies`` / ``verify_dependencies`` 留在 daemon.py。它们不是
plumbing 而是启动编排——要按 phase 切换、带约束失败后去掉重试、清理临时目录，并把失败映射
成 ``LoadError`` 文案；同时单测按 ``d.run_streaming_tail`` / ``d.run_command_tail`` 打桩，
编排留在原处才能继续被替换。等 Batch 2 切片⑥的 ``app.py`` 落地，再连同 phase 一起搬。

依赖方向：标准库 + ``log_ring``（扁平导入）+ ``remote.text.short`` + ``remote.config``
（注入约束的归一）。不读 ``CONFIG``，不碰 ``STATE`` / ``BOOT``。
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from collections import deque

from log_ring import log
from pipeline_loader import pip_env
from remote.config import normalize_pip_constraints
from remote.text import short

# 默认依赖约束留空（0.4.1 修正）。0.4.0 曾内置「版本上限」做固化
# （diffusers<1.0 / transformers<5 / accelerate<2 / peft<1），实测与当前 diffusers
# 新版直接冲突：diffusers 0.42+ 依赖 huggingface-hub>=1.32，而 transformers 4.x
# 要求 huggingface-hub<1.0，pip 只能回溯到 2019 年的 transformers 4.12.2；在
# Kaggle 镜像存在预装包时解析直接失败（远端表现 load_failed: pip install 退出码 1）。
# 需要固定版本时用 Host 的 `pipConstraints` 显式钉一组自己验证过的组合；默认装
# 最新兼容组合，再用导入自检兜底。
PIP_CONSTRAINTS: dict[str, str] = {}

# 独立进程做 import 自检：pip 显示安装成功 ≠ 能 import（ABI 不匹配、依赖冲突都在这暴露）。
# 除模块本身外再导入一次 DiffusionPipeline：版本组合不兼容时，它往往在模块级就抛错。
IMPORT_CHECK_MODULES = ("torch", "diffusers", "transformers", "accelerate", "peft")
IMPORT_CHECK_CODE = (
    "import importlib\n"
    f"for name in {IMPORT_CHECK_MODULES!r}:\n"
    "    module = importlib.import_module(name)\n"
    "    print(name + '==' + str(getattr(module, '__version__', 'unknown')))\n"
    "from diffusers import DiffusionPipeline\n"
    "print('DiffusionPipeline ok')\n"
)


def stream_process(argv: list[str], prefix: str, tail_lines: int = 0) -> tuple[int, list[str]]:
    """跑子进程并把每一行输出写进日志环；可选返回尾部若干行供错误文案使用。"""
    log(f"{prefix} $ {' '.join(argv)}")
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=pip_env(),
        )
    except Exception as exc:
        log(f"{prefix} 启动失败：{short(exc)}")
        return -1, []
    assert proc.stdout is not None
    tail: deque[str] = deque(maxlen=tail_lines) if tail_lines > 0 else deque(maxlen=0)
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        log(f"{prefix} {line}")
        if tail_lines > 0:
            tail.append(line)
    code = proc.wait()
    log(f"{prefix} 退出码 {code}")
    return code, list(tail)


def run_streaming(argv: list[str], prefix: str) -> int:
    """跑子进程并把每一行输出写进日志环（pip 必须可见，否则用户以为卡死）。"""
    return stream_process(argv, prefix)[0]


def run_streaming_tail(argv: list[str], prefix: str, tail_lines: int = 12) -> tuple[int, list[str]]:
    """同 run_streaming，但额外返回末尾若干行输出，用于把失败原因带进错误文案。"""
    return stream_process(argv, prefix, tail_lines)


def tail_summary(lines: list[str], limit: int = 560) -> str:
    """把子进程尾部输出压成一行，供 LoadError 文案；保留最后几条最有用的行。"""
    meaningful = [line.strip() for line in lines if isinstance(line, str) and line.strip()]
    if not meaningful:
        return "无输出"
    text = " | ".join(meaningful[-6:])
    return text if len(text) <= limit else "…" + text[-(limit - 1) :]


def package_name(spec: str) -> str:
    """从 pip 约束表达式取包名（``diffusers<1.0`` → ``diffusers``），按 PEP 503 归一化。"""
    match = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)", str(spec or ""))
    if not match:
        return ""
    return re.sub(r"[-_.]+", "-", match.group(1)).lower()


def merge_pip_constraints(injected, defaults: dict[str, str] | None = None) -> list[str]:  # noqa: ANN001
    """默认约束按包名合并 Host 注入项：同名覆盖（保持原位置），新包追加。

    ``defaults`` 缺省取本模块的 ``PIP_CONSTRAINTS``（默认为空）；daemon 显式传入自己的同名
    引用，保持「默认约束表挂在本模块上」的既有可替换性。
    """
    specs = dict(PIP_CONSTRAINTS if defaults is None else defaults)
    for item in normalize_pip_constraints(injected):
        name = package_name(item)
        if name:
            specs[name] = item
        else:
            log(f"[pip] WARN 无法识别包名的约束已忽略：{item}")
    return list(specs.values())


def write_constraints_file(constraints: list[str], directory: str | None = None) -> str:
    """把最终约束写成 pip ``-c`` 文件；目录缺省时用系统临时目录。"""
    directory = directory or tempfile.mkdtemp(prefix="imagen-constraints-")
    path = os.path.join(directory, "constraints.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(constraints))
        handle.write("\n")
    return path


def run_command_tail(argv: list[str], prefix: str, tail_lines: int = 20) -> tuple[int, list[str]]:
    """跑一次性子进程并把输出写进日志环，返回退出码与尾部若干行（供错误文案）。"""
    log(f"{prefix} $ {' '.join(argv)}")
    try:
        proc = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=600,
            env=pip_env(),
        )
    except Exception as exc:
        log(f"{prefix} 启动失败：{short(exc)}")
        return -1, [short(exc)]
    lines = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    for line in lines:
        log(f"{prefix} {line}")
    return proc.returncode, lines[-tail_lines:]
