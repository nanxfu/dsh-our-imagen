#!/usr/bin/env python3
"""T4 准入基准 v5：diffusers 主线优先；多模型 × 多方案隔离执行。

父进程：环境、依赖、逐模型下载。
子进程：每个（模型, 方案）独立进程，避免 OOM 污染 CUDA 上下文。

子进程模式：python bench.py --model sdxl-base --variant single
"""

import json
import os
import subprocess
import sys
import time
import traceback

T0 = time.time()

MODELS = {
    "sdxl-base": {
        "repo": "stabilityai/stable-diffusion-xl-base-1.0",
        "steps": 25,
        "size": 1024,
        "variants": ("single",),
        "load_variant": "fp16",
        "allow": ["model_index.json", "**/config.json", "**/*.json", "**/*.txt",
                  "**/*.fp16.safetensors"],
    },
    "sdxl-turbo": {
        "repo": "stabilityai/sdxl-turbo",
        "steps": 4,
        "size": 512,
        "variants": ("single",),
        "load_variant": "fp16",
        "allow": ["model_index.json", "**/config.json", "**/*.json", "**/*.txt",
                  "**/*.fp16.safetensors"],
    },
}

RUN = ["sdxl-base", "sdxl-turbo"]
PROMPT = (
    "A red-crowned crane standing in a misty lotus pond at dawn, "
    "Chinese ink painting, soft light, fine detail"
)
OUT_DIR = "/kaggle/working" if os.path.isdir("/kaggle/working") else "."


def now():
    return round(time.time() - T0, 2)


def out_path(model, variant):
    return os.path.join(OUT_DIR, f"v_{model}_{variant}.json")


def run_one(model, variant):
    import torch
    from diffusers import DiffusionPipeline

    cfg = MODELS[model]
    result = {"model": model, "variant": variant, "repo": cfg["repo"],
              "steps": cfg["steps"], "size": cfg["size"]}
    try:
        kwargs = {"dtype": torch.float16, "use_safetensors": True}
        if cfg.get("trust_remote_code"):
            kwargs["trust_remote_code"] = True
        if cfg.get("load_variant"):
            kwargs["variant"] = cfg["load_variant"]
        if variant == "dual":
            kwargs["device_map"] = "balanced"
        t = time.time()
        pipe = DiffusionPipeline.from_pretrained(cfg["repo"], **kwargs)
        if variant == "single":
            pipe = pipe.to("cuda")
        elif variant == "offload":
            pipe.enable_model_cpu_offload()
        result["load_s"] = round(time.time() - t, 1)

        times = []
        for i in range(3):
            torch.cuda.reset_peak_memory_stats()
            t = time.time()
            pipe(
                prompt=PROMPT,
                num_inference_steps=cfg["steps"],
                width=cfg["size"],
                height=cfg["size"],
                generator=torch.Generator("cuda").manual_seed(42 + i),
            ).images[0]
            torch.cuda.synchronize()
            times.append(round(time.time() - t, 2))
            print(f"[{model}/{variant}] #{i + 1}: {times[-1]}s", flush=True)

        med = sorted(times[1:])[len(times[1:]) // 2]
        result.update(
            status="ok", first_s=times[0], runs_s=times, steady_median_s=med,
            ms_per_step=round(med * 1000 / cfg["steps"]),
            peak_vram_mb=round(torch.cuda.max_memory_allocated() / 2**20),
        )
    except Exception:
        result.update(status="failed", traceback=traceback.format_exc()[-1000:])
    with open(out_path(model, variant), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"[{model}/{variant}] -> {result['status']}", flush=True)
    return result


def phase_env():
    import platform
    import torch

    ids = list(range(torch.cuda.device_count()))
    props = [torch.cuda.get_device_properties(i) for i in ids]
    return {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "device_count": len(ids),
        "devices": [
            {"name": p.name, "total_mb": round(p.total_memory / 2**20), "cc": f"{p.major}.{p.minor}"}
            for p in props
        ],
    }


def phase_pip():
    """主线优先：MOSS / FLUX.3 这类新管线只在 diffusers main 里。"""
    out = {}
    t = time.time()
    git = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "-U", "--no-cache-dir",
         "git+https://github.com/huggingface/diffusers.git", "transformers",
         "accelerate", "safetensors"],
        capture_output=True, text=True,
    )
    out["git"] = {"seconds": round(time.time() - t, 1), "rc": git.returncode,
                  "tail": ((git.stderr or "") + (git.stdout or ""))[-300:]}
    if git.returncode != 0:
        t = time.time()
        pypi = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "-U", "diffusers",
             "transformers", "accelerate"],
            capture_output=True, text=True,
        )
        out["pypi"] = {"seconds": round(time.time() - t, 1), "rc": pypi.returncode}
    check = subprocess.run(
        [sys.executable, "-c",
         "import diffusers; print(diffusers.__version__); "
         "print(hasattr(diffusers, 'MOSSImagePipeline'), hasattr(diffusers, 'ZImagePipeline'))"],
        capture_output=True, text=True,
    )
    out["check"] = (check.stdout or check.stderr or "").strip()
    return out


def phase_download(model):
    from huggingface_hub import snapshot_download

    cfg = MODELS[model]
    t = time.time()
    if cfg.get("allow"):
        path = snapshot_download(cfg["repo"], allow_patterns=cfg["allow"])
    else:
        path = snapshot_download(cfg["repo"], ignore_patterns=cfg.get("ignore", []))
    seconds = round(time.time() - t, 1)
    size = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                size += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return {"seconds": seconds, "mb": round(size / 2**20, 1),
            "mbps": round(size / 2**20 / max(seconds, 1), 1), "path": path}


def main():
    if "--model" in sys.argv:
        run_one(sys.argv[sys.argv.index("--model") + 1],
                sys.argv[sys.argv.index("--variant") + 1])
        return

    report = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    report["env"] = phase_env()
    print(f"[{now():>7.2f}s] env: {report['env']['device_count']} gpu", flush=True)
    report["pip"] = phase_pip()
    print(f"[{now():>7.2f}s] pip: {report['pip']}", flush=True)

    report["models"] = {}
    for model in RUN:
        entry = {"download": None, "variants": {}}
        try:
            entry["download"] = phase_download(model)
            print(f"[{now():>7.2f}s] download {model}: {entry['download']['mb']}MB "
                  f"{entry['download']['seconds']}s", flush=True)
        except Exception:
            entry["download"] = {"error": traceback.format_exc()[-600:]}
            report["models"][model] = entry
            continue

        for variant in MODELS[model]["variants"]:
            t = time.time()
            proc = subprocess.run(
                [sys.executable, os.path.abspath(__file__), "--model", model,
                 "--variant", variant],
                capture_output=True, text=True,
            )
            tail = ((proc.stdout or "") + (proc.stderr or ""))[-400:]
            print(f"[{now():>7.2f}s] {model}/{variant} exit={proc.returncode}\n{tail}", flush=True)
            try:
                with open(out_path(model, variant), "r", encoding="utf-8") as fh:
                    entry["variants"][variant] = json.load(fh)
            except Exception:
                entry["variants"][variant] = {"status": "crashed", "exit": proc.returncode, "tail": tail}
            entry["variants"][variant]["wall_s"] = round(time.time() - t, 1)
        report["models"][model] = entry

    report["total_seconds"] = now()
    path = os.path.join(OUT_DIR, "results.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("BENCH_JSON: " + json.dumps(report, ensure_ascii=False), flush=True)
    print("written:", path, flush=True)


if __name__ == "__main__":
    main()
