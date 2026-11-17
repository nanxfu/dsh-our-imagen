"""LoaderRegistry：模型家族的注册表（Strategy + Registry）。

改造前，「有哪些 loader、谁能垫图、每个 loader 依赖哪些仓库、怎么构建」散在五处：
``transport/validator.SUPPORTED_LOADERS``、``daemon.SUPPORTED_IMG2IMG_LOADERS``、
``daemon.build_pipeline``、``pipeline_loader.load_diffusers_pipeline`` 与
``cache_ops.pipeline_repos``。加一个模型家族要同时改五处，漏一处就是"提交期放行、加载期
未知 loader"或"缓存清理把要用的权重删了"。收进注册表后只有一条扩展路径：实现
:class:`~remote.inference.loaders.base.ModelLoader` 并注册一行，白名单、垫图判定、keep_set
推导与构建路径自动跟上。

行为口径（§5.7：搬迁不等于顺手合并）：

1. **顺序即文案**：``names()`` 按注册顺序拼接，直接进 ``未知 loader：'x'（支持 …）``。
2. **未知 loader 只有一种说法**：提交期（validator）与加载期（build）现在用同一句；
   改造前加载期只写 ``未知 loader：x``，既没有 repr 也没有白名单。
3. **不吞异常、不改写文案**：显存回收与 ``LoadError`` 包装仍由各策略自己决定，注册表只做
   分派与 ``loaded`` 标识拼装。
"""

from __future__ import annotations

from cache_ops import pipeline_repos
from remote.errors import RequestError
from remote.inference.loaders.anima import AnimaLoader
from remote.inference.loaders.base import LoadContext, ModelLoader
from remote.inference.loaders.diffusers import (
    DiffusersLoader,
    Flux2Loader,
    SdxlLoader,
    SdxlLoraLoader,
)


class LoaderRegistry:
    """名字 → 策略实例。注册顺序决定白名单顺序，重复/空名字当场报错。"""

    def __init__(self, loaders=()):  # noqa: ANN001 - 可迭代的 ModelLoader
        self._loaders: dict[str, ModelLoader] = {}
        for loader in loaders:
            self.register(loader)

    def register(self, loader: ModelLoader) -> ModelLoader:
        name = str(getattr(loader, "name", "") or "").strip()
        if not name:
            raise ValueError(f"{type(loader).__name__} 缺少 name，不能注册")
        if name in self._loaders:
            raise ValueError(f"loader 重复注册：{name}")
        self._loaders[name] = loader
        return loader

    def names(self) -> tuple[str, ...]:
        """全部 loader 名（注册顺序）；提交期白名单就是它。"""
        return tuple(self._loaders)

    def img2img_names(self) -> tuple[str, ...]:
        """支持垫图重绘的 loader 名（由策略的 ``supports_img2img`` 推导）。"""
        return tuple(name for name, loader in self._loaders.items() if loader.supports_img2img)

    def inpaint_names(self) -> tuple[str, ...]:
        """支持局部重绘（inpaint）的 loader 名（由策略的 ``supports_inpaint`` 推导）。

        与 ``img2img_names`` 相互独立：首期两者都只登记 SDXL 家族，但判定不共用一份名单，
        以后放开某个家族时不会顺带把另一个能力也放开。
        """
        return tuple(name for name, loader in self._loaders.items() if loader.supports_inpaint)

    def reference_names(self) -> tuple[str, ...]:
        """支持模型原生参考生图（``referenceImages``）的 loader 名。

        与 ``img2img_names`` / ``inpaint_names`` 三条能力各自独立判定：原生参考走基础管线的
        ``image=[PIL...]`` 条件（不 from_pipe、不吃 strength），首期只登记 ``flux2``。
        """
        return tuple(name for name, loader in self._loaders.items() if loader.supports_reference)

    def get(self, name, *, error_cls=RequestError) -> ModelLoader:  # noqa: ANN001
        key = str(name or "").strip()
        loader = self._loaders.get(key)
        if loader is None:
            raise error_cls(f"未知 loader：{key!r}（支持 {', '.join(self.names())}）")
        return loader

    def require_diffusers(self, name, *, error_cls=RequestError) -> DiffusersLoader:  # noqa: ANN001
        """按名字取 diffusers 家族策略；``anima`` 走自己的运行时，不能从这条入口构建。"""
        loader = self.get(name, error_cls=error_cls)
        if isinstance(loader, DiffusersLoader):
            return loader
        family = ", ".join(
            key for key, item in self._loaders.items() if isinstance(item, DiffusersLoader)
        )
        raise error_cls(f"loader={loader.name!r} 不是 diffusers 加载器（该入口只构建 {family}）")

    def required_repos(self, spec: dict) -> list[str]:
        """该 spec 依赖的 HF 仓库集合（切模型 keep_set 的推导入口）。

        未知 loader 回退到通用扫描：keep_set 只许多不许少，多留一个仓库不会误删。
        """
        loader = self._loaders.get(str(spec.get("loader") or "").strip())
        return loader.required_repos(spec) if loader is not None else pipeline_repos(spec)

    def build(self, spec: dict, ctx: LoadContext) -> tuple[object, str]:
        """按 ``spec['loader']`` 分派；返回 ``(pipe, "{loader}:{base}")``。"""
        loader = self.get(spec.get("loader"), error_cls=ctx.request_error_cls)
        pipe = loader.load(spec, ctx)
        return pipe, f"{loader.name}:{spec.get('base')}"

    def apply_accel(self, spec: dict, pipe, *, log=print):  # noqa: ANN001, ANN201
        """给已构建的管线应用 ``pipeline.accel`` 开关（幂等）。

        惰性派生的 img2img / inpaint 管线复用同一批底座组件，需要在 ``from_pipe`` 之后
        再调一次：VAE tiling/slicing 直接生效，UNet 的 channels_last / fuse 由策略内部
        按「是否已 fuse」幂等跳过（共享 UNet 时不会二次 fuse）。未知 loader 原样返回。
        """
        loader = self._loaders.get(str(spec.get("loader") or "").strip())
        if loader is None:
            return pipe
        return loader.apply_accel(pipe, spec, log=log)


_DEFAULT_REGISTRY: LoaderRegistry | None = None


def default_registry() -> LoaderRegistry:
    """生产注册表（进程内单例，daemon 与 ``pipeline_loader`` 共用同一份）。

    顺序与改造前 ``SUPPORTED_LOADERS`` 一致：``sdxl / sdxl-lora / flux2 / anima``。
    """
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = LoaderRegistry(
            (SdxlLoader(), SdxlLoraLoader(), Flux2Loader(), AnimaLoader())
        )
    return _DEFAULT_REGISTRY
