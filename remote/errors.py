"""领域异常：请求非法 / 模型加载失败 / 任务队列满。

为什么从 daemon.py 拆出来：这三种异常同时被请求校验（``remote/transport/validator.py``）、
参考图编解码（``remote/inference/reference_codec.py``）与 daemon 的 HTTP 层使用；定义在
独立模块里，被拆出去的子模块才不必反向 import 巨型入口文件（否则循环依赖）。

依赖：无。本模块只依赖标准库，也不读任何全局配置。
"""


class RequestError(ValueError):
    """请求本身不合法 → HTTP 400 invalid_request。"""


class LoadError(RuntimeError):
    """模型加载失败 → HTTP 500 load_failed。"""


class QueueFullError(RuntimeError):
    """任务队列达到上限 → HTTP 429 queue_full。"""
