#!/usr/bin/env python3
"""远端守护进程单测的入口：按域发现 ``test/remote/test_*.py`` 并逐项执行。

拆分口径见 ``docs/REFACTOR_ARCHITECTURE_SPEC.md`` §4.1（切片⑥f）：原 ``test/daemon-unit.py``
一个 4000 行文件已无法定位"哪一域坏了"，按域拆开后每片独立可跑：

    python test/remote/run.py                  # 全部
    python test/remote/run.py -k tunnel        # 只跑某域（按模块名过滤）
    python test/remote/test_tunnel.py          # 单个文件，调试用
    python test/remote/test_tunnel.py -k drain # 单个用例

不引入 pytest：这些用例只依赖标准库 unittest，CI 与本机行为一致（Pillow 可选）。
"""

from __future__ import annotations

import argparse
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def build_suite(pattern: str) -> unittest.TestSuite:
    """按 ``test_*.py`` 发现用例；``support`` 不是测试模块，不会进套件。"""
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(ROOT))
    loader = unittest.TestLoader()
    return loader.discover(str(HERE), pattern=pattern, top_level_dir=str(HERE))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="按域运行远端守护进程单测")
    parser.add_argument("-k", "--pattern", default="test_*.py", help="模块名过滤（默认 test_*.py）")
    parser.add_argument("-v", "--verbose", action="store_true", help="逐条打印用例名")
    options = parser.parse_args(argv)
    pattern = options.pattern if options.pattern.startswith("test_") else f"test_*{options.pattern}*"
    suite = build_suite(pattern)
    result = unittest.TextTestRunner(verbosity=2 if options.verbose else 1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
