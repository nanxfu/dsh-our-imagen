"""文本小工具：把异常压成一行可读信息。

``short()`` 目前在本仓有 5 份同实现的副本（daemon / tunnel / pipeline_loader / cache_ops，
以及本次新增的 infra.process）。这里先落一份共享实现，供 infra.process 与 daemon 使用——
新模块不再增加第 6 份副本。

其余三处（``tunnel._tunnel_short`` / ``pipeline_loader._loader_short`` /
``cache_ops._cache_short``）按架构规格 §5.7 单列一批合并：那三处被 LoadError 文案直接
引用，合并要连带改断言，不混在模块搬迁里做。

依赖：仅标准库。
"""

from __future__ import annotations


def short(exc: BaseException, limit: int = 600) -> str:
    """``类型名: 消息``，连续空白压成单个空格，超长截断（日志与 UI 都按一行消费）。"""
    text = f"{type(exc).__name__}: {exc}"
    text = " ".join(text.split())
    return text[:limit]
