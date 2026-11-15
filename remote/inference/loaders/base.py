"""模型加载策略的公共骨架：加载上下文、预挂载前置与 keep_set 推导。

为什么单独成模块：``LoadContext`` 是 daemon 与策略实现之间的唯一契约。策略只认
``ctx.cache`` / ``ctx.log`` / ``ctx.error_cls`` / ``ctx.request_error_cls`` /
``ctx.release_gpu`` 五个入口，不 import daemon、也不读模块级全局——所以同一份策略能被
两条路径复用：

- daemon 的完整加载（预挂载解析 → 磁盘预检 → 预下载 → 构建）；
- ``pipeline_loader.load_diffusers_pipeline`` 的"权重已下载、只要构建"路径
  （``tools/payload/verify-model.py`` 用，见 ``DiffusersLoader.construct``）。

依赖：仅 ``cache_ops`` 的纯函数与标准库；torch / diffusers 一律在方法内延迟导入，
保证打包后模块顶层不会早引重库（架构规格 §5.1）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from cache_ops import pipeline_repos


@dataclass
class LoadContext:
    """一次加载所需的协作者。

    每次 ``build`` 时现取（不是模块级单例）：``cache`` / ``release_gpu`` 都指向 daemon 的
    模块全局，单测 ``mock.patch.object(d, "free_cuda_cache")`` 之后必须立刻生效。
    """

    cache: object
    log: Callable[..., object]
    error_cls: type[Exception]
    request_error_cls: type[Exception]
    release_gpu: Callable[[], None]


class ModelLoader:
    """模型家族策略：声明名字 / 垫图能力 / 依赖仓库 / 如何构建管线。

    子类只覆写有差异的部分。``name`` 必须与请求里的 ``pipeline.loader`` 完全一致——它同时
    是白名单文本、img2img 判定的键与 ``loaded`` 标识的前缀。
    """

    name = ""
    supports_img2img = False

    def required_repos(self, spec: dict) -> list[str]:
        """该 spec 依赖的 HF 仓库（切模型 keep_set 用）。

        默认按字段递归扫描；扫描覆盖不到的家族（例如运行时自己拼仓库名的 loader）覆写本方法
        **追加**仓库即可。只增不减是硬约束：漏一个仓库会让清理闸门把还要用的权重删掉。
        """
        return pipeline_repos(spec)

    def load(self, spec: dict, ctx: LoadContext):  # noqa: ANN201 - 返回 diffusers pipe 或 anima 运行时
        raise NotImplementedError(f"{type(self).__name__} 未实现 load()")

    # ---- 各家族共用的前置 ----

    def prepare_base(self, spec: dict, ctx: LoadContext) -> str:
        """预挂载解析 → 磁盘预检 → 预下载；返回实际加载源（本地目录或 repo id）。

        anima 只借用"预检 + 预下载"的副作用，不使用返回值：它的资产由
        ``ctx.cache.anima_local_assets()`` 按文件逐个解析，base 不是 diffusers 目录。
        """
        base = str(spec.get("base") or "")
        local_base = ctx.cache.resolve_local_model(base)
        ctx.cache.ensure_disk_capacity(spec)
        if local_base:
            ctx.log(f"[load] 使用预挂载权重加载底座：{base} → {local_base}")
        else:
            ctx.cache.prefetch_weights(base, spec.get("allowPatterns"))
        return local_base or base
