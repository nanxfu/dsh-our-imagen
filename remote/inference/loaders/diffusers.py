"""Diffusers 家族的三个加载策略：``sdxl`` / ``sdxl-lora`` / ``flux2``。

分支体从 ``pipeline_loader.load_diffusers_pipeline`` 的 if/elif 原样搬来（工厂选择、调度器
默认值、LoRA 挂载顺序、``device_map`` 口径都没动），只是把"用哪个工厂 / 要不要 LoRA / 要不要
device_map"变成子类差异。新增一个 diffusers 家族模型 = 新增一个子类 + 注册一行，不再动
if/elif。

``construct()`` 与 ``load()`` 分开是有原因的：``construct`` 只负责"给定已解析的 source 构建
管线"，``tools/payload/verify-model.py`` 自己下载完权重后直接调它（经
``pipeline_loader.load_diffusers_pipeline`` 这个兼容入口）；``load`` 才是 daemon 的完整路径
（预挂载解析 → 磁盘预检 → 预下载 → 构建），错误分类与显存回收也只在这一层。

依赖：``pipeline_loader`` 的工厂与调度器实现（扁平导入，与 daemon 共用同一份模块实例）。
"""

from __future__ import annotations

import os

from pipeline_loader import apply_scheduler, from_pretrained_with_variant_fallback
from remote.inference.loaders.base import LoadContext, ModelLoader


class DiffusersLoader(ModelLoader):
    """Diffusers 家族模板：``load`` 负责前置与错误分类，子类只实现 ``construct``。"""

    def load(self, spec: dict, ctx: LoadContext):  # noqa: ANN201
        source = self.prepare_base(spec, ctx)
        try:
            return self.construct(
                spec,
                source=source,
                local_lora_weight=self.local_lora_weight(spec, ctx),
                log=ctx.log,
                error_cls=ctx.error_cls,
                request_error_cls=ctx.request_error_cls,
            )
        except Exception as exc:  # noqa: BLE001 - 分类后原样上抛，不吞异常
            # 请求非法（缺 lora 配置等）不清显存：它发生在加载之前，清了也没用。
            if isinstance(exc, ctx.request_error_cls):
                raise
            ctx.release_gpu()
            raise

    def local_lora_weight(self, spec: dict, ctx: LoadContext) -> str | None:
        """命中预挂载的 LoRA 权重文件；默认没有外部权重。"""
        return None

    def construct(
        self,
        spec: dict,
        *,
        source: str,
        local_lora_weight: str | None = None,
        on_lora_download=None,  # noqa: ANN001 - 下载回调，仅验证 payload 使用
        log=print,  # noqa: ANN001
        error_cls=RuntimeError,  # noqa: ANN001
        request_error_cls=ValueError,  # noqa: ANN001
    ):
        raise NotImplementedError(f"{type(self).__name__} 未实现 construct()")

    @staticmethod
    def _base_kwargs(spec: dict) -> dict:
        """``from_pretrained`` 的公共 kwargs：fp16 + safetensors，可选 fp16 变体。"""
        import torch

        kwargs: dict = {"torch_dtype": torch.float16, "use_safetensors": True}
        variant = spec.get("variant")
        if variant:
            kwargs["variant"] = str(variant)
        return kwargs


class SdxlLoader(DiffusersLoader):
    """SDXL 底座：``AutoPipelineForText2Image`` + 按 spec 替换调度器。

    ``spec.nativeInpaint`` 为真时改用 ``AutoPipelineForInpainting`` 加载专用 inpaint 权重
    （9 通道 UNet）：这类底座只能带蒙版出图，daemon 的 run_task 会按同一标记拦截文生图请求。
    """

    name = "sdxl"
    supports_img2img = True
    supports_inpaint = True

    def construct(  # noqa: ANN001, ANN201 - 签名与基类一致，参数不逐个标注
        self,
        spec,
        *,
        source,
        local_lora_weight=None,
        on_lora_download=None,
        log=print,
        error_cls=RuntimeError,
        request_error_cls=ValueError,
    ):
        native_inpaint = spec.get("nativeInpaint") is True
        if native_inpaint:
            from diffusers import AutoPipelineForInpainting

            factory = AutoPipelineForInpainting
            log("[load] sdxl 专用局部重绘底座：AutoPipelineForInpainting.from_pretrained")
        else:
            from diffusers import AutoPipelineForText2Image

            factory = AutoPipelineForText2Image
        pipe = from_pretrained_with_variant_fallback(
            factory, source, self._base_kwargs(spec), self.name, log=log, error_cls=error_cls
        )
        apply_scheduler(pipe, spec, log=log)
        return pipe.to("cuda")


class SdxlLoraLoader(DiffusersLoader):
    """SDXL + LoRA：调度器默认 ``euler``（与底座不同），权重优先用预挂载文件。"""

    name = "sdxl-lora"
    supports_img2img = True
    supports_inpaint = True

    def local_lora_weight(self, spec: dict, ctx: LoadContext) -> str | None:
        lora = spec.get("lora") or {}
        repo = str(lora.get("repo") or "").strip()
        weight = str(lora.get("weight") or "").strip()
        if not repo or not weight:
            return None
        return ctx.cache.resolve_local_weight(repo, weight)

    def construct(  # noqa: ANN001, ANN201 - 签名与基类一致，参数不逐个标注
        self,
        spec,
        *,
        source,
        local_lora_weight=None,
        on_lora_download=None,
        log=print,
        error_cls=RuntimeError,
        request_error_cls=ValueError,
    ):
        lora = spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if not lora_repo or not lora_weight:
            raise request_error_cls("sdxl-lora 需要 lora.repo 与 lora.weight")

        from diffusers import StableDiffusionXLPipeline

        pipe = from_pretrained_with_variant_fallback(
            StableDiffusionXLPipeline, source, self._base_kwargs(spec), self.name, log=log, error_cls=error_cls
        )
        apply_scheduler(pipe, spec, default_type="euler", log=log)
        if local_lora_weight:
            log(f"[load] 使用预挂载 LoRA 权重：{local_lora_weight}")
            pipe.load_lora_weights(
                os.path.dirname(local_lora_weight) or ".",
                weight_name=os.path.basename(local_lora_weight),
            )
        else:
            from huggingface_hub import hf_hub_download

            downloaded = hf_hub_download(lora_repo, lora_weight)
            log(f"[load] LoRA 权重就绪：{downloaded}")
            if on_lora_download is not None:
                on_lora_download(downloaded)
            pipe.load_lora_weights(lora_repo, weight_name=lora_weight)
        log(f"[load] LoRA 已挂载：{lora_repo}/{lora_weight}")
        return pipe.to("cuda")


class Flux2Loader(DiffusersLoader):
    """Flux.2：走 ``device_map`` 分层装载，不替换调度器、不做转设备。"""

    name = "flux2"

    def construct(  # noqa: ANN001, ANN201 - 签名与基类一致，参数不逐个标注
        self,
        spec,
        *,
        source,
        local_lora_weight=None,
        on_lora_download=None,
        log=print,
        error_cls=RuntimeError,
        request_error_cls=ValueError,
    ):
        from diffusers import AutoPipelineForText2Image

        kwargs = self._base_kwargs(spec)
        balanced = str(spec.get("deviceMap") or "balanced")
        kwargs["device_map"] = balanced
        log(f"[load] flux2 使用 device_map={balanced}")
        return from_pretrained_with_variant_fallback(
            AutoPipelineForText2Image, source, kwargs, self.name, log=log, error_cls=error_cls
        )
