"""模型加载策略子包：每个模型家族一个 ``ModelLoader`` 实现。

分层约定：
- ``base`` 只有 ``LoadContext`` 与 ``ModelLoader`` 骨架（预挂载前置、keep_set 默认推导），
  不 import 任何具体家族；
- ``diffusers`` 放 sdxl / sdxl-lora / flux2 三个策略，共用 ``pipeline_loader`` 的工厂与调度器；
- ``anima`` 只做 ``anima_runtime`` 的适配，运行时实现仍只有 ``remote/anima_runtime.py`` 一份。

新增家族：加一个模块 + 在 ``remote/inference/registry.default_registry()`` 注册一行。
注册表是白名单、垫图能力、keep_set 推导与构建路径的唯一入口。
"""
