#!/usr/bin/env python3
"""Kaggle 侧启动器模板（占位符由 lib/kernel.js 填充，请勿直接执行）。

背景：`kernel-metadata.json` 只接受单个 `code_file`，而 `remote/` 是一个标准 Python 包。
打包时把整包压成 ZIP、Base64 内嵌到本模板，启动时解压到临时目录再把包根挂进 `sys.path`，
最后调用包内入口。这样远端源码可以正常分层、使用相对导入与 `from __future__ import
annotations`，不必再退回"全文拼接到单文件"的写法。

三个占位符：
  - ``@@CONFIG_B64@@``   Host 注入的会话配置（含 auth_token，只在临时目录里存在）
  - ``@@BUNDLE_B64@@``   源码包 ZIP 的 Base64
  - ``@@ENTRY_MODULE@@`` 入口模块名（daemon 用 remote.daemon，验证 payload 用 payload.verify_model）

本文件自身不参与打包（`lib/bundle.js` 在收集阶段排除 `_entry.py`）。
"""

import base64
import importlib
import io
import os
import sys
import tempfile
import traceback
import zipfile

# Host 注入点：整行字符串占位，避免 shell / JSON 转义问题。占位符未替换说明这是模板本身。
EMBEDDED_CONFIG_B64 = "@@CONFIG_B64@@"
BUNDLE_B64 = "@@BUNDLE_B64@@"
ENTRY_MODULE = "@@ENTRY_MODULE@@"
ENTRY_FUNCTION = "main"


def unpack() -> str:
    """把内嵌 ZIP 解到临时目录，返回可挂进 `sys.path` 的包根。

    用解压而不用 ``zipimport``：``__file__`` 指向真实文件，排错时栈里的路径可直接打开，
    ``contract.json`` 也能按普通文件读取。
    """
    if "@@" in BUNDLE_B64:
        raise RuntimeError(
            "这是启动器模板，未填充源码包。请通过 lib/kernel.js 的 buildKernelFolder() 打包后再执行。"
        )
    root = tempfile.mkdtemp(prefix="imagen-bundle-")
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(BUNDLE_B64))) as archive:
        try:
            archive.extractall(root, filter="data")
        except TypeError:  # Python < 3.11.4 没有 filter 参数
            archive.extractall(root)
    # 过渡期：remote/ 内的模块仍用扁平绝对 import（from log_ring import ...），所以把
    # remote/ 本身也放进 sys.path；迁到包内相对导入后这一行可删。
    sys.path.insert(0, os.path.join(root, "remote"))
    sys.path.insert(0, root)
    return root


def run() -> None:
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    root = unpack()
    print(f"[bundle] 源码包已解压：{root}（入口 {ENTRY_MODULE}.{ENTRY_FUNCTION}）", flush=True)
    module = importlib.import_module(ENTRY_MODULE)
    # 配置只走显式函数注入（不走源码文本替换）：入口模块搬家或再导出时，函数对象仍然
    # 指向真正的实现，不会出现"赋值改到了同名的影子变量"这种静默丢配置。
    setter = getattr(module, "set_embedded_config", None)
    if not callable(setter):
        raise RuntimeError(f"{ENTRY_MODULE} 缺少 set_embedded_config()，配置注入链路不完整")
    setter(EMBEDDED_CONFIG_B64)
    getattr(module, ENTRY_FUNCTION)()


if __name__ == "__main__":
    try:
        run()
    except SystemExit:
        raise
    except BaseException:  # noqa: BLE001 - 启动期任何异常都要在 Kaggle 日志里留全栈
        traceback.print_exc()
        sys.exit(1)
