# ─────────────────────────────────────────────────────────────────────────────
# pipeline_loader：共享依赖安装、调度器、Diffusers 加载与签名过滤（单份源码）
#
# 维护约定：
# 1. remote/daemon.py 与 tools/payload/verify-model.py 通过一行带 @@INLINE 标记的
#    import 共用本模块：本地测试直接 import，推送 Kaggle 前由 lib/kernel.js 的
#    inlineMarkedModules 整行替换为本文件全文（保持单文件自包含）。
# 2. 模块顶层只 import 标准库（inspect / os / sys），不在模块加载期触发 torch /
#    diffusers 等重库，保证 daemon 与 payload 隔离导入自检可通过。
# 3. 禁止与 daemon.py / verify-model.py / anima_runtime.py 顶层符号冲突。
# ─────────────────────────────────────────────────────────────────────────────

import inspect
import os
import sys

# 与 bench/lightning/run.py 完全一致：镜像自带 torchao 0.10.0 与新版 diffusers 冲突，
# 必须先卸载；随后升级这 4 个包。
PIP_UNINSTALL = ("torchao",)
PIP_INSTALL = ("diffusers", "transformers", "accelerate", "peft")


def pip_env() -> dict[str, str]:
    """构建非交互 pip 子进程环境变量。"""
    env = dict(os.environ)
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("PIP_NO_INPUT", "1")
    return env


def pip_uninstall_argv() -> list[str]:
    """返回卸载冲突预装包（torchao）的 pip argv。"""
    return [sys.executable, "-m", "pip", "uninstall", "-y", "-q", *PIP_UNINSTALL]


def pip_install_argv(constraints_path: str | None = None) -> list[str]:
    """返回安装 diffusers 核心依赖的 pip argv；可选附加 -c 约束文件。"""
    argv = [sys.executable, "-m", "pip", "install", "-U", "--progress-bar", "off"]
    if constraints_path:
        argv.extend(["-c", constraints_path])
    argv.extend(PIP_INSTALL)
    return argv


def _loader_short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    return " ".join(text.split())[:limit]


def is_oom_error(exc: BaseException) -> bool:
    """判断异常是否属于显存/内存不足（OOM 不做 variant 回退重试，直接上抛）。"""
    name = type(exc).__name__
    text = f"{name}: {exc}".lower()
    return (
        name in ("OutOfMemoryError", "CudaOutOfMemoryError")
        or "out of memory" in text
        or "insufficient memory" in text
        or "cuda error: out of memory" in text
    )


def apply_scheduler(pipe, pipeline_spec: dict, default_type: str = "", *, log=print) -> None:  # noqa: ANN001
    """按 pipeline.scheduler 配置（或 default_type）替换管线调度器。"""
    from diffusers import (
        DPMSolverMultistepScheduler,
        DPMSolverSinglestepScheduler,
        EulerAncestralDiscreteScheduler,
        EulerDiscreteScheduler,
    )

    scheduler_spec = pipeline_spec.get("scheduler")
    if not scheduler_spec and not default_type:
        return
    spec = scheduler_spec or {}
    scheduler_type = str(spec.get("type") or default_type).strip().lower()
    if not scheduler_type:
        return
    if scheduler_type == "euler":
        spacing = str(spec.get("timestepSpacing") or "trailing")
        pipe.scheduler = EulerDiscreteScheduler.from_config(
            pipe.scheduler.config, timestep_spacing=spacing
        )
        log(f"[load] 调度器 EulerDiscreteScheduler(timestep_spacing={spacing})")
    elif scheduler_type == "euler-a":
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(
            pipe.scheduler.config
        )
        log("[load] 调度器 EulerAncestralDiscreteScheduler")
    elif scheduler_type == "dpmpp-sde-karras":
        pipe.scheduler = DPMSolverSinglestepScheduler.from_config(
            pipe.scheduler.config, use_karras_sigmas=True, algorithm_type="sde-dpmsolver++"
        )
        log("[load] 调度器 DPMSolverSinglestepScheduler(use_karras_sigmas=True, algorithm_type=sde-dpmsolver++)")
    elif scheduler_type == "dpmpp-2m-karras":
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(
            pipe.scheduler.config, use_karras_sigmas=True
        )
        log("[load] 调度器 DPMSolverMultistepScheduler(use_karras_sigmas=True)")
    elif scheduler_type == "dpmpp-2m-sde-karras":
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(
            pipe.scheduler.config, use_karras_sigmas=True, algorithm_type="sde-dpmsolver++"
        )
        log("[load] 调度器 DPMSolverMultistepScheduler(use_karras_sigmas=True, algorithm_type=sde-dpmsolver++)")
    else:
        log(f"[load] 未识别的 scheduler.type={scheduler_type}，沿用底座默认调度器")


def from_pretrained_with_variant_fallback(
    factory,
    base: str,
    kwargs: dict,
    loader: str,
    *,
    log=print,  # noqa: ANN001
    error_cls=RuntimeError,  # noqa: ANN001
):
    """fp16 变体缺失时回退到默认权重；OOM 不重试，直接抛给上层分类。"""
    attempts = [dict(kwargs)]
    if kwargs.get("variant"):
        attempts.append({k: v for k, v in kwargs.items() if k != "variant"})
    last: Exception | None = None
    for index, attempt in enumerate(attempts, start=1):
        try:
            log(
                f"[load] from_pretrained({base}) 第 {index} 次："
                f"variant={attempt.get('variant')} device_map={attempt.get('device_map')}"
            )
            return factory.from_pretrained(base, **attempt)
        except Exception as exc:  # noqa: BLE001
            last = exc
            if is_oom_error(exc):
                raise
            log(f"[load] 第 {index} 次加载失败：{_loader_short(exc)}")
    raise error_cls(f"{loader} 加载 {base} 失败：{_loader_short(last) if last else '未知原因'}")


def load_diffusers_pipeline(
    pipeline_spec: dict,
    *,
    base_source: str | None = None,
    local_lora_weight: str | None = None,
    on_lora_download=None,  # noqa: ANN001
    log=print,  # noqa: ANN001
    error_cls=RuntimeError,  # noqa: ANN001
    request_error_cls=ValueError,  # noqa: ANN001
):
    """按 sdxl / sdxl-lora / flux2 分支加载 Diffusers pipeline。"""
    import torch
    from diffusers import AutoPipelineForText2Image, StableDiffusionXLPipeline

    loader = str(pipeline_spec.get("loader") or "")
    base = str(pipeline_spec.get("base") or "")
    source = base_source or base
    variant = pipeline_spec.get("variant")
    device_map = pipeline_spec.get("deviceMap")

    kwargs: dict = {"torch_dtype": torch.float16, "use_safetensors": True}
    if variant:
        kwargs["variant"] = str(variant)

    if loader == "sdxl":
        pipe = from_pretrained_with_variant_fallback(
            AutoPipelineForText2Image, source, kwargs, loader, log=log, error_cls=error_cls
        )
        apply_scheduler(pipe, pipeline_spec, log=log)
        return pipe.to("cuda")

    if loader == "sdxl-lora":
        lora = pipeline_spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if not lora_repo or not lora_weight:
            raise request_error_cls("sdxl-lora 需要 lora.repo 与 lora.weight")

        pipe = from_pretrained_with_variant_fallback(
            StableDiffusionXLPipeline, source, kwargs, loader, log=log, error_cls=error_cls
        )
        apply_scheduler(pipe, pipeline_spec, default_type="euler", log=log)
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

    if loader == "flux2":
        balanced = str(device_map or "balanced")
        kwargs["device_map"] = balanced
        log(f"[load] flux2 使用 device_map={balanced}")
        return from_pretrained_with_variant_fallback(
            AutoPipelineForText2Image, source, kwargs, loader, log=log, error_cls=error_cls
        )

    raise request_error_cls(f"未知 loader：{loader}")


def pipe_signature_params(pipe) -> set[str]:  # noqa: ANN001
    """读取 pipe.__call__ 的形参集合；无法内省时返回空集合。"""
    try:
        return set(inspect.signature(pipe.__call__).parameters.keys())
    except Exception:
        return set()


def filter_call_kwargs(
    call_kwargs: dict,
    sig_params: set[str],
    *,
    negative_prompt: str = "",
    cfg: float | None = 0.0,
) -> dict:
    """按 __call__ 签名过滤入参，并仅在支持 negative_prompt 且 CFG > 0 时注入负向词。"""
    kwargs = dict(call_kwargs)
    if (
        negative_prompt
        and "negative_prompt" in sig_params
        and cfg is not None
        and float(cfg) > 0.0
    ):
        kwargs["negative_prompt"] = negative_prompt
    if sig_params:
        kwargs = {k: v for k, v in kwargs.items() if k in sig_params}
    return kwargs
