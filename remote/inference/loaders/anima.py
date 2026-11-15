"""anima 加载策略：单文件 ComfyUI checkpoint（DiT + Qwen3 文本编码器 / Qwen-Image VAE / 双分词器）。

历史背景：daemon.py 与 ``tools/payload/verify-model.py`` 曾各自维护一份约 1000 行、注释要求
"逐字同步"的运行时——那是对 Kaggle "只接受单个 code_file" 的误解。现在运行时只有
``remote/anima_runtime.py`` 一份，本模块只负责把它接进加载注册表，**不要**在这里复制实现。

资产解析与其它家族不同：anima 的 base 是单文件权重（不是 diffusers 目录），所以走
``ctx.cache.anima_local_assets()`` 按"DiT / te / vae / tokenizers"四类资产逐个匹配预挂载；
DiT 命中时整仓预下载与磁盘预检都跳过，其余资产由运行时按需下载。
"""

from __future__ import annotations

from anima_runtime import load_anima_runtime
from pipeline_loader import is_oom_error
from remote.inference.loaders.base import LoadContext, ModelLoader
from remote.text import short


class AnimaLoader(ModelLoader):
    """anima 运行时：加载成功返回 runtime 对象（不是 diffusers pipe）。"""

    name = "anima"

    def load(self, spec: dict, ctx: LoadContext):  # noqa: ANN201
        assets = ctx.cache.anima_local_assets(spec)
        if assets.get("dit"):
            ctx.log(f"[load] 使用预挂载 anima DiT 权重：{assets['dit']}")
        else:
            # 只借 prepare_base 的"磁盘预检 + 预下载"；返回值（diffusers 加载源）对 anima 无意义。
            self.prepare_base(spec, ctx)

        try:
            runtime, _downloaded_bytes, _load_seconds = load_anima_runtime(
                spec, ctx.log, local_paths=assets
            )
        except Exception as exc:  # noqa: BLE001 - OOM 原样上抛，其余包成可读的 LoadError
            ctx.release_gpu()
            if is_oom_error(exc):
                raise
            raise ctx.error_cls(f"anima 加载失败：{short(exc)}") from exc
        return runtime
