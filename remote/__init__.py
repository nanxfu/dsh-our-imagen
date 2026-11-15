"""远端源码包（Kaggle 容器内运行）。

`remote/` 在仓库里按标准 Python 包维护，本地开发可直接 `python -m remote.daemon`（需把
`remote/` 一并放进 `PYTHONPATH`，见 `test/daemon-unit.py` 的加载方式）。推 Kaggle 时由
`lib/kernel.js` 把整包压成 ZIP 内嵌进启动器，部署形态对业务代码完全透明。
"""
