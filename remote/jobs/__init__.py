"""异步 job 子包：实体（models）、存储（store）与串行执行循环（runner）。

分层约定：
- ``models`` 只有纯数据与纯函数，不持锁、不 import store/runner；
- ``store`` 独占 ``JOB_LOCK`` / ``JOB_COND``，只操作自己的表与队列，不碰 daemon 状态；
- ``runner`` 只做「取单 → 调注入的执行函数 → 收尾」，对推理细节一无所知。

对外接口由 ``daemon.py`` 以同名薄包装 re-export（``submit_job`` / ``get_job`` /
``queue_depth`` / ``start_job_worker`` 等），HTTP 层与单测的调用面保持不变。
"""
