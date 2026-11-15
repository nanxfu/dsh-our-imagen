"""请求校验：把 ``POST /generate`` 的 spec 归一成可执行的任务列表。

为什么从 daemon.py 拆出来：这段逻辑只依赖「参数边界表」与常量，不碰 HTTP、状态对象与
模型，是纯函数，拆成模块后可以单独导入与测试（daemon 只保留同名薄包装） 。

依赖注入：参数边界 ``limits_for(name) -> dict`` 与单批任务上限 ``max_tasks`` 全部由调用方
传入，本模块不读 daemon 的全局 ``CONFIG``，避免子模块反向依赖入口文件。
"""

from __future__ import annotations

import math
import random
import re

from remote.errors import RequestError

SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2", "anima")


def _int_param(value, field: str, low: int, high: int) -> int:  # noqa: ANN001
    if isinstance(value, bool):
        raise RequestError(f"{field} 必须是整数")
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise RequestError(f"{field} 必须是整数") from None
    if number < low or number > high:
        raise RequestError(f"{field} 必须在 {low}..{high} 之间，收到 {number}")
    return number


_VALID_HF_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")


def _valid_pipeline_base(base: str) -> bool:
    text = base.strip()
    if not text or len(text) > 512 or any(ord(ch) < 32 for ch in text) or "\\" in text:
        return False
    if text.startswith("/"):
        parts = text.split("/")
        return any(parts[1:]) and not any(part in (".", "..") for part in parts[1:])
    if ".." in text:
        return False
    return bool(_VALID_HF_REPO_RE.match(text))


def validate_generate_spec(spec, *, limits_for, max_tasks):  # noqa: ANN001
    if not isinstance(spec, dict):
        raise RequestError("请求体必须是 JSON 对象")

    pipeline_spec = spec.get("pipeline")
    if not isinstance(pipeline_spec, dict):
        raise RequestError("缺少 pipeline 对象")
    loader = str(pipeline_spec.get("loader") or "").strip()
    if loader not in SUPPORTED_LOADERS:
        raise RequestError(f"未知 loader：{loader!r}（支持 {', '.join(SUPPORTED_LOADERS)}）")
    base = pipeline_spec.get("base")
    if not isinstance(base, str) or not base.strip():
        raise RequestError("pipeline.base 必须是非空字符串")
    if not _valid_pipeline_base(base):
        raise RequestError("pipeline.base 必须是 owner/name 仓库标识或绝对路径")

    tasks_raw = spec.get("tasks")
    if not isinstance(tasks_raw, list) or not tasks_raw:
        raise RequestError("tasks 必须是非空数组")
    if len(tasks_raw) > max_tasks:
        raise RequestError(f"单次请求最多 {max_tasks} 个任务")

    width_limit = limits_for("width")
    height_limit = limits_for("height")
    steps_limit = limits_for("steps")
    cfg_limit = limits_for("cfg")
    seed_limit = limits_for("seed")
    prompt_max = int(limits_for("prompt").get("maxChars") or 0)
    neg_max = int(limits_for("negativePrompt").get("maxChars") or 0)
    width_min, width_max = int(width_limit["min"]), int(width_limit["max"])
    height_min, height_max = int(height_limit["min"]), int(height_limit["max"])
    width_step = int(width_limit.get("step") or 8)
    height_step = int(height_limit.get("step") or 8)
    steps_min, steps_max = int(steps_limit["min"]), int(steps_limit["max"])
    cfg_min, cfg_max = cfg_limit["min"], cfg_limit["max"]
    seed_max = int(seed_limit.get("max") or 2**31 - 1)

    model_id = spec.get("modelId") or spec.get("model_id") or base
    tasks: list[dict] = []
    for index, raw in enumerate(tasks_raw):
        if not isinstance(raw, dict):
            raise RequestError(f"tasks[{index}] 必须是对象")
        prompt = raw.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise RequestError(f"tasks[{index}].prompt 必填")
        prompt = prompt.strip()
        if prompt_max > 0 and len(prompt) > prompt_max:
            raise RequestError(f"tasks[{index}].prompt 最长 {prompt_max} 个字符")
        neg_raw = raw.get("negative_prompt")
        if neg_raw is None:
            neg_prompt = ""
        elif not isinstance(neg_raw, str):
            raise RequestError(f"tasks[{index}].negative_prompt 必须是字符串")
        else:
            neg_prompt = neg_raw.strip()
        if neg_max > 0 and len(neg_prompt) > neg_max:
            raise RequestError(f"tasks[{index}].negative_prompt 最长 {neg_max} 个字符")
        width = _int_param(raw.get("width", 1024), f"tasks[{index}].width", width_min, width_max)
        height = _int_param(raw.get("height", 1024), f"tasks[{index}].height", height_min, height_max)
        steps = _int_param(raw.get("steps", 4), f"tasks[{index}].steps", steps_min, steps_max)
        raw_cfg = raw.get("cfg", 0.0)
        if isinstance(raw_cfg, bool):
            raise RequestError(f"tasks[{index}].cfg 必须是数字")
        try:
            cfg = float(raw_cfg)
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].cfg 必须是数字") from None
        if not math.isfinite(cfg):
            raise RequestError(f"tasks[{index}].cfg 必须是有限数字")
        if cfg < cfg_min or cfg > cfg_max:
            raise RequestError(f"tasks[{index}].cfg 必须在 {cfg_min}..{cfg_max} 之间")
        raw_seed = raw.get("seed", -1)
        if isinstance(raw_seed, bool):
            raise RequestError(f"tasks[{index}].seed 必须是整数")
        try:
            seed = int(raw_seed)
        except (TypeError, ValueError):
            raise RequestError(f"tasks[{index}].seed 必须是整数") from None
        if seed < 0:
            seed = random.randint(0, seed_max)
        elif seed > seed_max:
            raise RequestError(f"tasks[{index}].seed 必须不超过 {seed_max}")
        tasks.append(
            {
                "name": str(raw.get("name") or f"{index + 1:02d}"),
                "prompt": prompt,
                "negative_prompt": neg_prompt,
                "seed": seed,
                "width": width - width % width_step,
                "height": height - height % height_step,
                "steps": steps,
                "cfg": cfg,
            }
        )
    return pipeline_spec, str(model_id), tasks
