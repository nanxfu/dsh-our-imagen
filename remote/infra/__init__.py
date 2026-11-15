"""远端基础设施子包：外部进程执行、pip 依赖 plumbing 与磁盘缓存管理。

约定：子模块只做「跑命令 / 拼参数 / 落文件 / 量盘」，不读 daemon 的全局配置，也不决定
phase 与重试策略（那些属于启动编排，见 ``remote/app.py``）；需要策略时由调用方以参数或
回调注入——``CacheManager`` 持有的 ``config`` / ``log_fn`` / ``error_cls`` 就是这样传进来的。
"""
