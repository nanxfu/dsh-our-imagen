# ─────────────────────────────────────────────────────────────────────────────
# pipeline_loader：共享依赖安装、调度器、Diffusers 构建入口与签名过滤（单份源码）
#
# 维护约定：
# 1. 本模块随 remote/ 整包进 Kernel 源码包（Batch 0 起不再有 @@INLINE 拼接）；
#    daemon 与 tools/payload/verify-model.py 都以扁平导入 `from pipeline_loader import …`
#    取同一份实现——两条 sys.path（仓库根 + remote/）由启动器与单测共同满足。
# 2. 具体的 sdxl / sdxl-lora / flux2 分支在 `remote/inference/loaders/diffusers.py`；
#    本模块的 `load_diffusers_pipeline` 只是按名字分派的兼容入口（打包清单与验证脚本
#    按文件名钉住了它，见 test/check-verify-model.mjs）。
# 3. 模块顶层只 import 标准库（inspect / os / sys），不在模块加载期触发 torch /
#    diffusers 等重库，保证 daemon 与 payload 隔离导入自检可通过。
# 4. 禁止与 daemon.py / verify-model.py / anima_runtime.py 顶层符号冲突。
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


# ── 调度器配方表 ───────────────────────────────────────────────────────
#
# 每种 `pipeline.scheduler.type` 一条配方：diffusers 类名 + 由 spec 生成 kwargs 与日志正文。
# 改成表驱动是为了符合开闭原则：新增调度器只加一行，不用在五个分支后面继续 elif。
# 注意 `dpmpp-sde-karras` 映射的是 **Singlestep**（历史行为，与 2m 的 Multistep 不同），
# 这不是笔误，改动会让出图结果变化。

def _euler_recipe(spec: dict) -> tuple[dict, str]:
    spacing = str(spec.get("timestepSpacing") or "trailing")
    return {"timestep_spacing": spacing}, f"EulerDiscreteScheduler(timestep_spacing={spacing})"


def _constant_recipe(message: str, **kwargs):  # noqa: ANN003 - 参数即 from_config 的 kwargs
    """固定 kwargs 的配方：绝大多数调度器只会换类名，不读 spec。"""

    def build(_spec: dict) -> tuple[dict, str]:
        return dict(kwargs), message

    return build


_SCHEDULER_RECIPES = {
    "euler": ("EulerDiscreteScheduler", _euler_recipe),
    "euler-a": ("EulerAncestralDiscreteScheduler", _constant_recipe("EulerAncestralDiscreteScheduler")),
    "dpmpp-sde-karras": (
        "DPMSolverSinglestepScheduler",
        _constant_recipe(
            "DPMSolverSinglestepScheduler(use_karras_sigmas=True, algorithm_type=sde-dpmsolver++)",
            use_karras_sigmas=True,
            algorithm_type="sde-dpmsolver++",
        ),
    ),
    "dpmpp-2m-karras": (
        "DPMSolverMultistepScheduler",
        _constant_recipe(
            "DPMSolverMultistepScheduler(use_karras_sigmas=True)",
            use_karras_sigmas=True,
        ),
    ),
    "dpmpp-2m-sde-karras": (
        "DPMSolverMultistepScheduler",
        _constant_recipe(
            "DPMSolverMultistepScheduler(use_karras_sigmas=True, algorithm_type=sde-dpmsolver++)",
            use_karras_sigmas=True,
            algorithm_type="sde-dpmsolver++",
        ),
    ),
}


def _scheduler_class(name: str):  # noqa: ANN202 - 返回 diffusers 的调度器类
    """按名字取 diffusers 类；diffusers 仍是函数内延迟导入（Kernel 启动时先装依赖）。"""
    from diffusers import (
        DPMSolverMultistepScheduler,
        DPMSolverSinglestepScheduler,
        EulerAncestralDiscreteScheduler,
        EulerDiscreteScheduler,
    )

    mapping = {
        "EulerDiscreteScheduler": EulerDiscreteScheduler,
        "EulerAncestralDiscreteScheduler": EulerAncestralDiscreteScheduler,
        "DPMSolverSinglestepScheduler": DPMSolverSinglestepScheduler,
        "DPMSolverMultistepScheduler": DPMSolverMultistepScheduler,
    }
    return mapping[name]


def apply_scheduler(pipe, pipeline_spec: dict, default_type: str = "", *, log=print) -> None:  # noqa: ANN001
    """按 pipeline.scheduler 配置（或 default_type）替换管线调度器。"""
    scheduler_spec = pipeline_spec.get("scheduler")
    if not scheduler_spec and not default_type:
        return
    spec = scheduler_spec or {}
    scheduler_type = str(spec.get("type") or default_type).strip().lower()
    if not scheduler_type:
        return
    recipe = _SCHEDULER_RECIPES.get(scheduler_type)
    if recipe is None:
        log(f"[load] 未识别的 scheduler.type={scheduler_type}，沿用底座默认调度器")
        return
    class_name, build = recipe
    kwargs, message = build(spec)
    pipe.scheduler = _scheduler_class(class_name).from_config(pipe.scheduler.config, **kwargs)
    log(f"[load] 调度器 {message}")


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
    """按 loader 名分派到 ``remote/inference/loaders/`` 的策略实现（兼容入口）。

    只做"构建"、不做"准备"：调用方（``tools/payload/verify-model.py``）已自行下载权重，
    预挂载解析 / 磁盘预检 / 预下载属于 daemon 的完整加载路径（``ModelLoader.load``）。

    为什么保留本函数而不是让调用方直接 import 注册表：打包清单（``scripts/package.mjs``）
    与 ``test/check-verify-model.mjs`` 都按文件名钉住了它，payload 也从这里导入；换入口要
    同批改打包器与验证脚本，不混在加载器搬迁里做。
    """
    from remote.inference.registry import default_registry

    loader = default_registry().require_diffusers(
        pipeline_spec.get("loader"), error_cls=request_error_cls
    )
    return loader.construct(
        pipeline_spec,
        source=base_source or str(pipeline_spec.get("base") or ""),
        local_lora_weight=local_lora_weight,
        on_lora_download=on_lora_download,
        log=log,
        error_cls=error_cls,
        request_error_cls=request_error_cls,
    )


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
    """按 __call__ 签名过滤入参，并仅在支持 negative_prompt 且 CFG 有效时注入负向词。"""
    kwargs = dict(call_kwargs)
    uses_true_cfg = "true_cfg_scale" in sig_params and "guidance_scale" not in sig_params
    if uses_true_cfg and "guidance_scale" in kwargs:
        raw_cfg = kwargs.pop("guidance_scale")
        kwargs["true_cfg_scale"] = max(1.0, float(raw_cfg if raw_cfg is not None else 1.0))
    neg_threshold = 1.0 if uses_true_cfg else 0.0
    if (
        negative_prompt
        and "negative_prompt" in sig_params
        and cfg is not None
        and float(cfg) > neg_threshold
    ):
        kwargs["negative_prompt"] = negative_prompt
    if sig_params:
        kwargs = {k: v for k, v in kwargs.items() if k in sig_params}
    return kwargs
