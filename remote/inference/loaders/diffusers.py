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

# 推理加速开关的远端镜像（阶段十五 Phase C1 脚手架）：键名必须与 shared/contract.js 的
# PIPELINE_ACCEL_KEYS 一致（daemon 无法 import JS，由 test/check-contract.mjs 校验两边同名）。
# 缺省 / 省略 = 全部关闭，代码路径与改造前逐字一致；只有真机 A/B 数据确认后才写进模型资产。
ACCEL_FLAGS = ("vaeTiling", "vaeSlicing", "channelsLast", "fuseQkv")


class DiffusersLoader(ModelLoader):
    """Diffusers 家族模板：``load`` 负责前置与错误分类，子类只实现 ``construct``。"""

    def load(self, spec: dict, ctx: LoadContext):  # noqa: ANN201
        source = self.prepare_base(spec, ctx)
        try:
            pipe = self.construct(
                spec,
                source=source,
                local_lora_weight=self.local_lora_weight(spec, ctx),
                log=ctx.log,
                error_cls=ctx.error_cls,
                request_error_cls=ctx.request_error_cls,
            )
            # construct 成功后应用加速开关（可选、缺省不做任何事）。放在 try 内：
            # 显式开启的加速项失败要按加载失败上报，而不是留下半套配置静默跑。
            return self.apply_accel(pipe, spec, log=ctx.log)
        except Exception as exc:  # noqa: BLE001 - 分类后原样上抛，不吞异常
            # 请求非法（缺 lora 配置等）不清显存：它发生在加载之前，清了也没用。
            if isinstance(exc, ctx.request_error_cls):
                raise
            ctx.release_gpu()
            raise

    def apply_accel(self, pipe, spec: dict, *, log=print):  # noqa: ANN001, ANN201
        """应用 ``pipeline.accel``：VAE tiling/slicing 全家族通用，channels_last / fuse 只对 UNet。

        幂等设计（关键）：``AutoPipelineForImage2Image.from_pipe`` / ``from_pipe`` 派生管线复用
        同一个 UNet 对象，若在基础管线已经 fuse 过，这里必须**跳过而不是重复调用**——
        diffusers 的 ``fuse_qkv_projections()`` 二次调用会覆盖 ``original_attn_processors`` 并
        重新包装注意力处理器，既浪费也可能报错。判定看 UNet 自身的 ``original_attn_processors``
        （fuse 成功时 diffusers 会把它从 None 置为处理器映射），不依赖 daemon 的全局状态，
        因此单测安全重置、切模型、from_pipe 共享组件三种场景都成立。
        """
        accel = spec.get("accel")
        if not isinstance(accel, dict) or not accel:
            return pipe
        # 只认真值：资产校验已保证布尔，这里对注入配置被手改的情况做防御。
        active = [key for key in ACCEL_FLAGS if accel.get(key) is True]
        if not active:
            return pipe
        log(f"[accel] 应用推理加速开关：{', '.join(active)}")
        vae = getattr(pipe, "vae", None)
        for key, method_name, label in (
            ("vaeTiling", "enable_tiling", "VAE tiling"),
            ("vaeSlicing", "enable_slicing", "VAE slicing"),
        ):
            if accel.get(key) is not True:
                continue
            method = getattr(vae, method_name, None)
            if callable(method):
                method()
                log(f"[accel] {label} 已开启")
            else:
                log(f"[accel] WARN 管线没有 vae.{method_name}()，跳过 {key}")
        unet = getattr(pipe, "unet", None)
        if unet is None:
            if accel.get("channelsLast") is True or accel.get("fuseQkv") is True:
                log("[accel] WARN 该管线没有 unet，channelsLast / fuseQkv 不适用，已跳过")
            return pipe
        if accel.get("channelsLast") is True:
            import torch

            unet.to(memory_format=torch.channels_last)
            log("[accel] UNet channels_last 已切换")
        if accel.get("fuseQkv") is True:
            if getattr(unet, "original_attn_processors", None) is not None:
                log("[accel] UNet 已融合 Q/K/V 投影，跳过重复 fuse")
            else:
                fuse = getattr(unet, "fuse_qkv_projections", None)
                if callable(fuse):
                    fuse()
                    log("[accel] UNet Q/K/V 投影已融合")
                else:
                    log("[accel] WARN 该 UNet 没有 fuse_qkv_projections()，跳过 fuseQkv")
        return pipe

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
    """Flux.2：走 ``device_map`` 分层装载，不替换调度器、不做转设备。

    该家族的基础管线（``Flux2KleinPipeline``）原生接收 ``image=[PIL...]`` 参考条件：
    daemon 的 ``run_task`` 直接把解码后的参考图列表作为 ``image=`` kwargs 传入，
    **不需要** ``AutoPipelineForImage2Image.from_pipe``、也没有 strength 语义。

    原生局部重绘（本轮不接入，只留结论）：diffusers 0.43 的 ``AutoPipelineForInpainting``
    mapping 里没有 flux2-klein，必须按显式类 ``Flux2KleinInpaintPipeline`` 加载；且它的内部
    1 MP 面积上限会把画布静默缩小（如 1536×864 → 1360×768），出图尺寸与扩图接缝不可控，
    因此 Phase C1 不把它接进默认扩图路径（详见 docs/SPEC.md §2.2 的「原生局部重绘未接入」）。
    """

    name = "flux2"
    supports_reference = True

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
        # 单卡（Colab L4 / 单 T4）没有分片对象：传 balanced 只会让 accelerate 多一层包装。
        # device_count 未知（CPU 环境 / 测试替身）时仍按显式配置走，避免改变既有行为。
        try:
            import torch
            device_count = torch.cuda.device_count()
        except Exception:  # noqa: BLE001 - 没有 torch 时按未知处理
            device_count = 0
        if device_count == 1:
            log("[load] flux2 单卡（device_count=1），跳过 device_map 分片")
        else:
            kwargs["device_map"] = balanced
            log(f"[load] flux2 使用 device_map={balanced}（device_count={device_count}）")
        pipe = from_pretrained_with_variant_fallback(
            AutoPipelineForText2Image, source, kwargs, self.name, log=log, error_cls=error_cls
        )
        # 单卡不走 device_map 时必须显式搬上 GPU：否则 from_pretrained 会把权重留在 CPU，
        # 表现为"能加载、能出图，但 1024² 要十几分钟"（实测在 CPU 上跑满 600s 超时）。
        if device_count == 1:
            pipe = pipe.to("cuda")
            log(f"[load] flux2 单卡已移至 cuda（execution_device={getattr(pipe, '_execution_device', 'cuda')}）")
        return pipe
