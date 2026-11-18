"""Diffusers 家族的三个加载策略：``sdxl`` / ``sdxl-lora`` / ``flux2``。

分支体从 ``pipeline_loader.load_diffusers_pipeline`` 的 if/elif 原样搬来（工厂选择、调度器
默认值、LoRA 挂载顺序、``device_map`` 口径都没动），只是把"用哪个工厂 / 要不要 LoRA / 要不要
device_map"变成子类差异。新增一个 diffusers 家族模型 = 新增一个子类 + 注册一行，不再动
if/elif。

``construct()`` 与 ``load()`` 分开是有原因的：``construct`` 只负责"给定已解析的 source 构建
管线"，``tools/payload/verify-model.py`` 自己下载完权重后直接调它（经
``pipeline_loader.load_diffusers_pipeline`` 这个兼容入口）；``load`` 才是 daemon 的完整路径
（预挂载解析 → 磁盘预检 → 预下载 → 构建），错误分类与显存回收也只在这一层。

阶段十六 Phase C 遗留收口新增两处能力（都不改旧资产路径）：

- ``flux2`` 支持可选 ``pipeline.lora``：预挂载优先 → ``hf_hub_download`` → ``load_lora_weights``，
  可选 ``scale`` 经 ``set_adapters`` 生效（见 :class:`Flux2Loader`）；
- ``pipeline.accel.cache`` 实验性 firstBlock 缓存探针：只对 ``pipe.transformer`` 生效，
  不支持时 WARN 跳过、不阻断出图（见 :func:`_apply_experimental_cache`）。

依赖：``pipeline_loader`` 的工厂与调度器实现（扁平导入，与 daemon 共用同一份模块实例）。
"""

from __future__ import annotations

import math
import os

from pipeline_loader import apply_scheduler, from_pretrained_with_variant_fallback
from remote.inference.loaders.base import LoadContext, ModelLoader
from remote.text import short

# 推理加速开关的远端镜像（阶段十五 Phase C1 脚手架）：键名必须与 shared/contract.js 的
# PIPELINE_ACCEL_KEYS 一致（daemon 无法 import JS，由 test/check-contract.mjs 校验两边同名）。
# 缺省 / 省略 = 全部关闭，代码路径与改造前逐字一致；只有真机 A/B 数据确认后才写进模型资产。
ACCEL_FLAGS = ("vaeTiling", "vaeSlicing", "channelsLast", "fuseQkv")

# 实验性缓存开关（pipeline.accel.cache）只是真机 A/B 探针：不进 PIPELINE_ACCEL_KEYS，也不写进
# 模型资产（MODEL_ASSET_SPEC §2.4 只登记上面四个稳定开关），失败一律 WARN + 跳过、不阻断出图。
CACHE_TYPES = ("firstBlock",)

# flux2 LoRA 的适配器名固定，便于按名字应用 lora.scale 与排障（PEFT 不传时默认 default_0）。
FLUX2_LORA_ADAPTER = "imagen-flux2-lora"

# firstBlock cache 的应用标记挂在 transformer 自身：``from_pipe`` 派生管线共享同一 transformer
# 时据此跳过重复应用（重复 apply 会叠加 hook），不依赖任何 daemon 全局状态。
FIRST_BLOCK_CACHE_ATTR = "_imagen_first_block_cache"


def _local_lora_weight(spec: dict, ctx: LoadContext) -> str | None:
    """命中预挂载的 LoRA 权重文件；配置缺失或不是对象时返回 None（报错留给 construct 分类）。"""
    lora = spec.get("lora")
    if not isinstance(lora, dict):
        return None
    repo = str(lora.get("repo") or "").strip()
    weight = str(lora.get("weight") or "").strip()
    if not repo or not weight:
        return None
    return ctx.cache.resolve_local_weight(repo, weight)


def _lora_config(spec: dict, request_error_cls) -> tuple[str, str, float] | None:  # noqa: ANN001
    """解析 ``pipeline.lora``：缺省返回 None；存在但字段/类型非法 → request_error。

    ``scale`` 是可选权重系数，缺省 1.0（不调用 ``set_adapters``）；只接受有限数字，
    非数字 / NaN / 布尔值都按请求错误处理——静默按 1.0 跑会让 LoRA 效果与请求不符。
    """
    raw = spec.get("lora")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise request_error_cls("flux2 的 lora 配置必须是对象")
    repo = str(raw.get("repo") or "").strip()
    weight = str(raw.get("weight") or "").strip()
    if not repo or not weight:
        raise request_error_cls("flux2 的 lora 配置需要 lora.repo 与 lora.weight")
    scale = raw.get("scale")
    if scale is None:
        # 资产模板里可选键常写 null（scheduler / variant / deviceMap 同款）：按缺省处理。
        return repo, weight, 1.0
    if isinstance(scale, bool) or not isinstance(scale, (int, float)):
        raise request_error_cls("flux2 的 lora.scale 必须是数字")
    scale_value = float(scale)
    if not math.isfinite(scale_value):
        raise request_error_cls("flux2 的 lora.scale 必须是有限数字")
    return repo, weight, scale_value


def _transformer_cache_unsupported(transformer) -> str | None:  # noqa: ANN001
    """静态预检 transformer 是否适合 firstBlock 缓存：不适合返回原因，无法判断返回 None。

    判定依据是 diffusers 自己的 block 登记表（``hooks/_helpers.TransformerBlockRegistry``）：

    1. 必须能按 ``apply_first_block_cache`` 的同一套容器名收集到 ≥2 个 block（它会 pop 首尾）；
    2. 所有 block 类必须已注册，否则 ``apply_first_block_cache`` 会在挂 hook 时报 ValueError，
       而且已经挂了前几个 hook（留下半套状态）；
    3. 所有 block 的输出形状必须一致（都返回 tensor 或都返回 (encoder, hidden) 元组）：
       firstBlock 用首块残差修正尾块，diffusers 0.43 的尾块分支遇到"首块 tuple、尾块 tensor"
       的混合堆栈会直接做 tensor - list。flux2 的双栈（``Flux2TransformerBlock`` 返回元组、
       ``Flux2SingleTransformerBlock`` 返回 tensor）正属于这种混合，实测前置证据即在此。

    拿不到 diffusers 私有登记表（版本差异）时返回 None：交给 ``apply_first_block_cache``
    自身报错兜底，不因预检失败误拦。
    """
    try:
        from diffusers.hooks._common import _ALL_TRANSFORMER_BLOCK_IDENTIFIERS
        from diffusers.hooks._helpers import TransformerBlockRegistry
    except Exception:  # noqa: BLE001 - 没有内部登记表就不预检
        return None
    try:
        blocks = []
        for name, container in transformer.named_children():
            if name in _ALL_TRANSFORMER_BLOCK_IDENTIFIERS and container is not None:
                blocks.extend(container)
    except Exception:  # noqa: BLE001 - 结构不像 nn.Module 时不预检
        return None
    if len(blocks) < 2:
        return f"可识别的 transformer block 不足 2 个（{len(blocks)} 个）"
    output_shapes = set()
    for block in blocks:
        try:
            metadata = TransformerBlockRegistry.get(type(block))
            output_shapes.add(metadata.return_encoder_hidden_states_index is not None)
        except ValueError:
            return f"block 类未注册：{type(block).__name__}"
        except Exception:  # noqa: BLE001 - 登记表自身加载失败时不预检，交给 apply 兜底
            return None
    if len(output_shapes) > 1:
        return "block 输出形状混合（tensor 与 (encoder, hidden) 元组并存），firstBlock 不支持"
    return None


def _apply_experimental_cache(pipe, config, *, log=print) -> None:  # noqa: ANN001
    """应用 ``pipeline.accel.cache`` 的实验性特征缓存（仅 firstBlock），只对 ``pipe.transformer`` 生效。

    这是真机 A/B 探针：任何"不支持"都降级为 WARN 并跳过（不阻断出图）。但**应用成功后**的
    前向错误照常上报，不静默退回无缓存出图，否则 A/B 数据会失真。

    幂等：应用标记写在 transformer 上，``from_pipe`` 派生管线共享同一 transformer 时直接跳过。
    """

    def warn(reason: str) -> None:
        log(f"[accel] WARN cache 不适用：{reason}")

    if not isinstance(config, dict):
        warn("cache 配置必须是对象")
        return
    cache_type = str(config.get("type") or "").strip()
    if cache_type not in CACHE_TYPES:
        warn(f"不支持的 cache.type={cache_type!r}（仅支持 {' / '.join(CACHE_TYPES)}）")
        return
    threshold = config.get("threshold", 0.05)
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
        warn("cache.threshold 必须是数字")
        return
    threshold = float(threshold)
    if not math.isfinite(threshold):
        warn("cache.threshold 必须是有限数字")
        return
    transformer = getattr(pipe, "transformer", None)
    if transformer is None:
        warn("该管线没有 transformer（firstBlock 只对 DiT 管线生效）")
        return
    if getattr(transformer, FIRST_BLOCK_CACHE_ATTR, None) is not None:
        log("[accel] transformer 已应用 firstBlock cache，跳过重复应用")
        return
    unsupported = _transformer_cache_unsupported(transformer)
    if unsupported is not None:
        warn(unsupported)
        return
    try:
        from diffusers import FirstBlockCacheConfig, apply_first_block_cache
    except ImportError:
        warn("当前 diffusers 未导出 apply_first_block_cache / FirstBlockCacheConfig")
        return
    try:
        apply_first_block_cache(transformer, FirstBlockCacheConfig(threshold=threshold))
    except Exception as exc:  # noqa: BLE001 - 探针开关：应用失败只告警，不阻断出图
        warn(f"应用失败（{short(exc)}）")
        return
    setattr(transformer, FIRST_BLOCK_CACHE_ATTR, threshold)
    log(f"[accel] firstBlock cache 已应用（threshold={threshold}）")


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

        ``accel.cache`` 是实验性探针（见 :func:`_apply_experimental_cache`）：缺省不出现时本方法
        的行为与改造前逐字一致；出现时最后单独应用，失败只 WARN。
        """
        accel = spec.get("accel")
        if not isinstance(accel, dict) or not accel:
            return pipe
        # 只认真值：资产校验已保证布尔，这里对注入配置被手改的情况做防御。
        active = [key for key in ACCEL_FLAGS if accel.get(key) is True]
        cache_config = accel.get("cache")
        if not active and cache_config is None:
            return pipe
        if active:
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
        else:
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
        if cache_config is not None:
            _apply_experimental_cache(pipe, cache_config, log=log)
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
        """命中预挂载的 LoRA 权重文件；配置缺字段时返回 None，由 construct 归为请求错误。"""
        return _local_lora_weight(spec, ctx)

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

    可选 LoRA（``pipeline.lora = {repo, weight, scale?}``）：``Flux2KleinPipeline`` 自带
    ``Flux2LoraLoaderMixin``，与 ``sdxl-lora`` 同一套"预挂载优先 → hf_hub_download → 挂载"
    流程；区别是 LoRA 属于 flux2 底座的可选叠加项，不是独立 loader，缺省时行为不变。
    PEFT 格式（``base_model.model.*``）由 diffusers 0.43 的 ``Flux2LoraLoaderMixin`` 自行
    转成 ``diffusion_model.*``，这里只负责把权重交给它。

    原生局部重绘（本轮不接入，只留结论）：diffusers 0.43 的 ``AutoPipelineForInpainting``
    mapping 里没有 flux2-klein，必须按显式类 ``Flux2KleinInpaintPipeline`` 加载；且它的内部
    1 MP 面积上限会把画布静默缩小（如 1536×864 → 1360×768），出图尺寸与扩图接缝不可控，
    因此 Phase C1 不把它接进默认扩图路径（详见 docs/SPEC.md §2.2 的「原生局部重绘未接入」）。
    """

    name = "flux2"
    supports_reference = True

    def local_lora_weight(self, spec: dict, ctx: LoadContext) -> str | None:
        """命中预挂载的 LoRA 权重文件；配置缺字段时返回 None，由 construct 归为请求错误。"""
        return _local_lora_weight(spec, ctx)

    def _mount_lora(  # noqa: ANN001, ANN201 - lora 是 construct 解析后的三元组
        self,
        pipe,
        lora,
        *,
        local_lora_weight=None,
        on_lora_download=None,
        log=print,
        error_cls=RuntimeError,
    ):
        """挂载 flux2 LoRA（可选 scale）；任何挂载异常都归为加载失败，不静默出图不带 LoRA。"""
        repo, weight, scale = lora
        try:
            load_lora = getattr(pipe, "load_lora_weights", None)
            if not callable(load_lora):
                raise RuntimeError("该管线没有 load_lora_weights()，不能挂载 LoRA")
            if local_lora_weight:
                log(f"[load] 使用预挂载 LoRA 权重：{local_lora_weight}")
                load_lora(
                    os.path.dirname(local_lora_weight) or ".",
                    weight_name=os.path.basename(local_lora_weight),
                    adapter_name=FLUX2_LORA_ADAPTER,
                )
            else:
                from huggingface_hub import hf_hub_download

                downloaded = hf_hub_download(repo, weight)
                log(f"[load] LoRA 权重就绪：{downloaded}")
                if on_lora_download is not None:
                    on_lora_download(downloaded)
                load_lora(repo, weight_name=weight, adapter_name=FLUX2_LORA_ADAPTER)
            if scale != 1.0:
                set_adapters = getattr(pipe, "set_adapters", None)
                if not callable(set_adapters):
                    raise RuntimeError("该管线没有 set_adapters()，无法应用 lora.scale")
                set_adapters(FLUX2_LORA_ADAPTER, adapter_weights=scale)
        except Exception as exc:  # noqa: BLE001 - 分类后原样上抛，不吞异常
            if isinstance(exc, error_cls):
                raise
            raise error_cls(f"flux2 LoRA 挂载失败：{short(exc)}") from exc
        scale_text = f"（scale={scale}）" if scale != 1.0 else ""
        log(f"[load] flux2 LoRA 已挂载：{repo}/{weight}{scale_text}")

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
        # 先校验 LoRA 配置：缺字段是请求错误（400），不能等底座加载几十秒后才报。
        lora = _lora_config(spec, request_error_cls)
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
        # LoRA 在转设备前挂载：注入的适配器层跟随 pipe.to("cuda") 一起上卡；
        # device_map="balanced" 路径不转设备，直接挂在已分片的 transformer 上。
        if lora is not None:
            self._mount_lora(
                pipe,
                lora,
                local_lora_weight=local_lora_weight,
                on_lora_download=on_lora_download,
                log=log,
                error_cls=error_cls,
            )
        # 单卡不走 device_map 时必须显式搬上 GPU：否则 from_pretrained 会把权重留在 CPU，
        # 表现为"能加载、能出图，但 1024² 要十几分钟"（实测在 CPU 上跑满 600s 超时）。
        if device_count == 1:
            pipe = pipe.to("cuda")
            log(f"[load] flux2 单卡已移至 cuda（execution_device={getattr(pipe, '_execution_device', 'cuda')}）")
        return pipe
