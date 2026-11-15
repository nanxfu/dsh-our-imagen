"""远端推理侧子包：模型加载注册表（registry + loaders）与参考图编解码。

分层约定：
- ``registry`` / ``loaders`` 只认 ``LoadContext`` 注入的协作者（cache / log / 错误类型 /
  显存回收），不 import daemon、不读模块级全局；
- ``reference_codec`` 是纯函数，边界值由调用方注入；
- 两者都不在模块加载期触发 torch / diffusers：延迟到具体构建方法里（架构规格 §5.1）。
"""
