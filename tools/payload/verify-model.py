#!/usr/bin/env python3
"""模型验证采样 payload（由 tools/verify-model.mjs 打包推到 Kaggle 一次性执行）。

设计约束：
- 单文件、只依赖标准库启动：先装依赖，再 import torch/diffusers；
- 采样逻辑继承 bench/lightning/run.py：测量加载耗时、首图耗时、3 次出图（丢弃首张取中位数）、
  峰值显存与实际下载体积；
- 无论成功失败都写 verify-report.json 并退出 0：让编排端总能下载到结构化结果，
  真正的失败原因放在 report.status / error / traceback 里，不会被 Kaggle 判成 Kernel ERROR。
"""

import base64
import json
import os
import platform
import subprocess
import sys
import time
import traceback

# Host 注入点：lib/kernel.js 按行首赋值做精确替换。
EMBEDDED_CONFIG_B64 = ""

OUT_DIR = "/kaggle/working" if os.path.isdir("/kaggle/working") else "."
REPORT_NAME = "verify-report.json"
SAMPLE_NAME = "verify-sample.png"
SAMPLES = 3


def log(*args) -> None:
    print(*args, flush=True)


def short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    return " ".join(text.split())[:limit]


def dir_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def install_dependencies() -> None:
    """与 daemon/bench 同一条已验证路径：卸 torchao，装最新兼容组合（不钉版本）。"""
    log("[pip] 卸载 torchao")
    uninstall = subprocess.run(
        [sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao"],
        capture_output=True,
        text=True,
    )
    log(f"[pip] torchao 卸载退出码 {uninstall.returncode}")

    log("[pip] 安装 diffusers / transformers / accelerate / peft")
    env = dict(os.environ)
    env.setdefault("PIP_DISABLE_PIP_VERSION_CHECK", "1")
    env.setdefault("PIP_NO_INPUT", "1")
    install = subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-U",
            "--progress-bar",
            "off",
            "diffusers",
            "transformers",
            "accelerate",
            "peft",
        ],
        capture_output=True,
        text=True,
        env=env,
        timeout=1800,
    )
    if install.returncode != 0:
        output = f"{install.stdout or ''}\n{install.stderr or ''}".strip()
        tail = "\n".join([line for line in output.splitlines() if line.strip()][-40:])
        log("[pip] 安装失败，尾部输出：")
        log(tail)
        brief = " | ".join([line for line in tail.splitlines() if line.strip()][-4:])[:800]
        raise RuntimeError(f"pip install 退出码 {install.returncode}：{brief}")
    log("[pip] 依赖安装完成")


def load_pipe(spec: dict):
    """按 loader 分支加载 pipeline；返回 (pipe, 说明)。"""
    import torch
    from diffusers import AutoPipelineForText2Image, EulerDiscreteScheduler, StableDiffusionXLPipeline
    from huggingface_hub import snapshot_download

    loader = str(spec.get("loader") or "")
    base = str(spec.get("base") or "")
    if not base:
        raise ValueError("pipeline.base 为空")
    variant = spec.get("variant")
    allow_patterns = spec.get("allowPatterns")
    device_map = spec.get("deviceMap")

    download_started = time.time()
    download_bytes = 0
    if allow_patterns:
        log(f"[load] 预下载 {base}（白名单 {len(allow_patterns)} 条）…")
        snapshot = snapshot_download(base, allow_patterns=list(allow_patterns))
        download_bytes += dir_bytes(snapshot)
        log(f"[load] 预下载完成：{round((time.time() - download_started), 1)}s / {round(download_bytes / 2**30, 2)} GiB")
    else:
        log(f"[load] 未配置 allowPatterns，完整下载 {base} …")
        snapshot = snapshot_download(base)
        download_bytes += dir_bytes(snapshot)
        log(f"[load] 下载完成：{round((time.time() - download_started), 1)}s / {round(download_bytes / 2**30, 2)} GiB")

    kwargs = {"torch_dtype": torch.float16, "use_safetensors": True}
    if variant:
        kwargs["variant"] = str(variant)

    def from_pretrained(factory):
        attempts = [dict(kwargs)]
        if kwargs.get("variant"):
            attempts.append({key: value for key, value in kwargs.items() if key != "variant"})
        last = None
        for index, attempt in enumerate(attempts, start=1):
            try:
                log(f"[load] from_pretrained({base}) 第 {index} 次：variant={attempt.get('variant')}")
                return factory.from_pretrained(base, **attempt)
            except Exception as exc:  # noqa: BLE001
                last = exc
                log(f"[load] 第 {index} 次加载失败：{short(exc)}")
        raise RuntimeError(f"加载 {base} 失败：{short(last) if last else '未知原因'}")

    load_started = time.time()
    if loader == "sdxl":
        pipe = from_pretrained(AutoPipelineForText2Image).to("cuda")
    elif loader == "sdxl-lora":
        lora = spec.get("lora") or {}
        lora_repo = str(lora.get("repo") or "").strip()
        lora_weight = str(lora.get("weight") or "").strip()
        if not lora_repo or not lora_weight:
            raise ValueError("sdxl-lora 需要 lora.repo 与 lora.weight")
        pipe = from_pretrained(StableDiffusionXLPipeline)
        scheduler_spec = spec.get("scheduler") or {}
        scheduler_type = str(scheduler_spec.get("type") or "euler").lower()
        if scheduler_type == "euler":
            spacing = str(scheduler_spec.get("timestepSpacing") or "trailing")
            pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing=spacing)
            log(f"[load] 调度器 EulerDiscreteScheduler(timestep_spacing={spacing})")
        from huggingface_hub import hf_hub_download

        weight_path = hf_hub_download(lora_repo, lora_weight)
        download_bytes += os.path.getsize(weight_path)
        pipe.load_lora_weights(lora_repo, weight_name=lora_weight)
        log(f"[load] LoRA 已挂载：{lora_repo}/{lora_weight}")
        pipe = pipe.to("cuda")
    elif loader == "flux2":
        balanced = str(device_map or "balanced")
        kwargs["device_map"] = balanced
        log(f"[load] flux2 使用 device_map={balanced}")
        pipe = from_pretrained(AutoPipelineForText2Image)
    else:
        raise ValueError(f"未知 loader：{loader}")

    load_seconds = round(time.time() - load_started, 1)
    download_gb = round(download_bytes / 2**30, 2)
    log(f"[load] 模型就绪：{load_seconds}s，下载 {download_gb} GiB")
    return pipe, load_seconds, download_gb


def sample(pipe, config: dict, sample_path: str) -> dict:
    import inspect

    import torch

    size = int(config["size"])
    steps = int(config["steps"])
    cfg = config.get("cfg")
    prompt = str(config["prompt"])
    negative = str(config.get("negativeHint") or "")
    seed = int(config.get("seed") or 42)
    signature = set(inspect.signature(pipe.__call__).parameters)

    runs = []
    peaks = []
    for index in range(SAMPLES):
        torch.cuda.reset_peak_memory_stats()
        call_kwargs = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "width": size,
            "height": size,
            "generator": torch.Generator("cuda").manual_seed(seed + index),
        }
        if cfg is not None and "guidance_scale" in signature:
            call_kwargs["guidance_scale"] = float(cfg)
        if negative and "negative_prompt" in signature:
            call_kwargs["negative_prompt"] = negative
        started = time.time()
        image = pipe(**call_kwargs).images[0]
        torch.cuda.synchronize()
        runs.append(round(time.time() - started, 2))
        peaks.append(round(torch.cuda.max_memory_allocated() / 2**20))
        log(f"[sample] 第 {index + 1}/{SAMPLES} 张：{runs[-1]}s，峰值 {peaks[-1]} MB")
        if index == 0:
            image.save(sample_path)
            image.close()

    steady_pool = runs[1:] if len(runs) > 1 else runs
    steady_median = sorted(steady_pool)[len(steady_pool) // 2]
    return {
        "first_s": runs[0],
        "runs_s": runs,
        "steady_median_s": steady_median,
        "ms_per_step": round(steady_median * 1000 / max(1, steps)),
        "peak_vram_mb": max(peaks),
    }


def main() -> None:
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report = {
        "status": "failed",
        "id": None,
        "started_at": started_at,
        "error": None,
        "traceback": None,
    }
    try:
        if not EMBEDDED_CONFIG_B64.strip():
            raise RuntimeError("未收到注入配置：EMBEDDED_CONFIG_B64 为空")
        config = json.loads(base64.b64decode(EMBEDDED_CONFIG_B64).decode("utf-8"))
        report["id"] = config.get("id")
        report["pipeline"] = config.get("pipeline")
        report["size"] = config.get("size")
        report["steps"] = config.get("steps")
        report["cfg"] = config.get("cfg")
        report["samples"] = SAMPLES
        report["seed"] = config.get("seed")
        report["prompt"] = config.get("prompt")

        install_dependencies()

        import torch

        report["env"] = {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "device_count": torch.cuda.device_count(),
            "devices": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
        }
        if not torch.cuda.is_available():
            raise RuntimeError("未检测到可用 GPU（torch.cuda.is_available() 为 False）")

        pipe, load_seconds, download_gb = load_pipe(config["pipeline"])
        sample_path = os.path.join(OUT_DIR, SAMPLE_NAME)
        stats = sample(pipe, config, sample_path)
        if not os.path.isfile(sample_path) or os.path.getsize(sample_path) == 0:
            raise RuntimeError("样张没有落盘")

        report.update(stats)
        report["load_seconds"] = load_seconds
        report["download_gb"] = download_gb
        report["sample_bytes"] = os.path.getsize(sample_path)
        report["status"] = "ok"
        log(f"[done] 验证通过：peak={stats['peak_vram_mb']} MB steady={stats['steady_median_s']}s")
    except Exception as exc:  # noqa: BLE001
        report["error"] = short(exc, 1200)
        report["traceback"] = traceback.format_exc()[-4000:]
        log("[error] " + report["error"])
        log(report["traceback"])
    finally:
        report["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        report_path = os.path.join(OUT_DIR, REPORT_NAME)
        try:
            with open(report_path, "w", encoding="utf-8") as handle:
                json.dump(report, handle, ensure_ascii=False, indent=2)
            log(f"[report] 已写入 {report_path}")
        except Exception as exc:  # noqa: BLE001
            log(f"[report] 写入失败：{short(exc)}")
        log("VERIFY_JSON: " + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
    sys.exit(0)