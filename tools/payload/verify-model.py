#!/usr/bin/env python3
"""模型验证采样 payload（由 tools/verify-model.mjs 打包推到 Kaggle 一次性执行）。

设计约束：
- 与 daemon 共用同一份源码包：打包时本文件被放进 `payload/verify_model.py`，
  与 `remote/` 一起内嵌进启动器 ZIP，所以导入 Loader 与运行时不需要再复制实现；
- 只依赖标准库启动：先装依赖，再 import torch/diffusers；
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

# 1024² 的 VAE 解码单次申请约 5 GiB 连续显存：必须在任何 torch / CUDA 初始化之前设置，
# 让分配器用可扩展段减少碎片（T4 14.56GiB 首跑正是在 VAE conv3d 处 OOM）。
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# Host 注入点：启动器 remote/_entry.py 在 import 之后调用 set_embedded_config()。
EMBEDDED_CONFIG_B64 = ""


def set_embedded_config(value: str) -> None:
    """写入本次会话的注入配置（与 remote/daemon.py 同名同语义，供启动器统一调用）。"""
    global EMBEDDED_CONFIG_B64
    EMBEDDED_CONFIG_B64 = value or ""

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


from anima_runtime import load_anima_runtime  # noqa: E402
from pipeline_loader import PIP_INSTALL, PIP_UNINSTALL, filter_call_kwargs, load_diffusers_pipeline, pip_env, pip_install_argv, pip_uninstall_argv, pipe_signature_params  # noqa: E402


def install_dependencies() -> None:
    """与 daemon/bench 同一条已验证路径：卸 torchao，装最新兼容组合（不钉版本）。"""
    log(f"[pip] 卸载 {', '.join(PIP_UNINSTALL)}")
    uninstall = subprocess.run(
        pip_uninstall_argv(),
        capture_output=True,
        text=True,
    )
    log(f"[pip] torchao 卸载退出码 {uninstall.returncode}")

    log(f"[pip] 安装 {' / '.join(PIP_INSTALL)}")
    install = subprocess.run(
        pip_install_argv(),
        capture_output=True,
        text=True,
        env=pip_env(),
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
    """按 loader 分支加载 pipeline；返回 (pipe, load_seconds, download_gb)。"""
    from huggingface_hub import snapshot_download

    loader = str(spec.get("loader") or "")
    base = str(spec.get("base") or "")
    if not base:
        raise ValueError("pipeline.base 为空")
    if loader == "anima":
        # 单文件 ComfyUI checkpoint（DiT + Qwen3-0.6B + Qwen-Image VAE + 双分词器）：
        # 资产逐个下载并按实际文件累计体积；load_seconds 只算加载，不含下载。
        pipe, anima_bytes, load_seconds = load_anima_runtime(spec, log, dir_bytes)
        download_gb = round(anima_bytes / 2**30, 2)
        log(f"[load] anima 模型就绪：{load_seconds}s，下载 {download_gb} GiB")
        return pipe, load_seconds, download_gb

    allow_patterns = spec.get("allowPatterns")
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

    def _on_lora_download(weight_path: str) -> None:
        nonlocal download_bytes
        download_bytes += os.path.getsize(weight_path)

    load_started = time.time()
    pipe = load_diffusers_pipeline(
        spec,
        on_lora_download=_on_lora_download,
        log=log,
        error_cls=RuntimeError,
        request_error_cls=ValueError,
    )

    load_seconds = round(time.time() - load_started, 1)
    download_gb = round(download_bytes / 2**30, 2)
    log(f"[load] 模型就绪：{load_seconds}s，下载 {download_gb} GiB")
    return pipe, load_seconds, download_gb


def sample(pipe, config: dict, sample_path: str) -> dict:
    import torch

    size = int(config["size"])
    steps = int(config["steps"])
    cfg = config.get("cfg")
    prompt = str(config["prompt"])
    negative = str(config.get("negativeHint") or "")
    seed = int(config.get("seed") or 42)
    signature = pipe_signature_params(pipe)
    cfg_val = float(cfg) if cfg is not None else None

    runs = []
    peaks = []
    for index in range(SAMPLES):
        torch.cuda.reset_peak_memory_stats()
        raw_kwargs = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "width": size,
            "height": size,
            "generator": torch.Generator("cuda").manual_seed(seed + index),
        }
        if cfg_val is not None:
            raw_kwargs["guidance_scale"] = cfg_val
        call_kwargs = filter_call_kwargs(
            raw_kwargs,
            signature,
            negative_prompt=negative,
            cfg=cfg_val,
        )
        started = time.time()
        image = pipe(**call_kwargs).images[0]
        try:
            torch.cuda.synchronize()
            runs.append(round(time.time() - started, 2))
            peaks.append(round(torch.cuda.max_memory_allocated() / 2**20))
            log(f"[sample] 第 {index + 1}/{SAMPLES} 张：{runs[-1]}s，峰值 {peaks[-1]} MB")
            if index == 0:
                image.save(sample_path)
        finally:
            close_fn = getattr(image, "close", None)
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass

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
        # 受限仓库（如 FLUX.2 Klein 9B）的下载凭据：只写进进程环境变量，
        # 不写日志、不进 report。huggingface_hub 会自动读取 HF_TOKEN。
        hf_token = config.get("hf_token")
        if isinstance(hf_token, str) and hf_token.strip():
            os.environ["HF_TOKEN"] = hf_token.strip()
            os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token.strip()
            log("[auth] 已注入 HF Token（值不打印）")
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