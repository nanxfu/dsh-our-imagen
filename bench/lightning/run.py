#!/usr/bin/env python3
"""SDXL-Lightning 单卡 1024² 基准：对比 4 步与 8 步蒸馏。

问题：1024² 能否在单卡 T4 上进入"快档（≤15 秒）"。
底座用白名单只取 fp16，避免整仓 50GB 把会话盘写爆（见 EXPERIMENTS E9）。
"""

import json
import subprocess
import sys
import time

# 镜像自带的 torchao 0.10.0 与 diffusers 要求（>0.16.0）冲突，且 SDXL 不需要它。
subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao"], capture_output=True)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "-U", "diffusers", "transformers", "accelerate", "peft"],
    capture_output=True,
)

import torch
from diffusers import EulerDiscreteScheduler, StableDiffusionXLPipeline
from huggingface_hub import hf_hub_download, snapshot_download

BASE = "stabilityai/stable-diffusion-xl-base-1.0"
LORA_REPO = "ByteDance/SDXL-Lightning"
ALLOW = ["model_index.json", "**/config.json", "**/*.json", "**/*.txt", "**/*.fp16.safetensors"]
PROMPT = (
    "A red-crowned crane standing in a misty lotus pond at dawn, "
    "Chinese ink painting, soft light, fine detail"
)
OUT = "/kaggle/working" if __import__("os").path.isdir("/kaggle/working") else "."
T0 = time.time()


def now():
    return round(time.time() - T0, 1)


def main():
    report = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    import platform
    report["env"] = {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "devices": [
            torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())
        ],
    }

    t = time.time()
    snapshot_download(BASE, allow_patterns=ALLOW)
    report["download_base_s"] = round(time.time() - t, 1)
    print(f"[{now()}s] base downloaded", flush=True)

    report["variants"] = {}
    for steps in (4, 8):
        entry = {"steps": steps}
        try:
            weight = f"sdxl_lightning_{steps}step_lora.safetensors"
            t = time.time()
            hf_hub_download(LORA_REPO, weight)
            entry["download_lora_s"] = round(time.time() - t, 1)

            t = time.time()
            pipe = StableDiffusionXLPipeline.from_pretrained(
                BASE, torch_dtype=torch.float16, variant="fp16", use_safetensors=True
            )
            pipe.scheduler = EulerDiscreteScheduler.from_config(
                pipe.scheduler.config, timestep_spacing="trailing"
            )
            pipe.load_lora_weights(LORA_REPO, weight_name=weight)
            pipe.to("cuda")
            entry["load_s"] = round(time.time() - t, 1)

            times = []
            peaks = []
            for i in range(3):
                torch.cuda.reset_peak_memory_stats()
                t = time.time()
                pipe(
                    prompt=PROMPT,
                    num_inference_steps=steps,
                    guidance_scale=0.0,
                    width=1024,
                    height=1024,
                    generator=torch.Generator("cuda").manual_seed(42 + i),
                ).images[0]
                torch.cuda.synchronize()
                times.append(round(time.time() - t, 2))
                peaks.append(round(torch.cuda.max_memory_allocated() / 2**20))
                print(f"[{now()}s] {steps}-step #{i + 1}: {times[-1]}s", flush=True)

            med = sorted(times[1:])[len(times[1:]) // 2]
            entry.update(
                status="ok",
                first_s=times[0],
                runs_s=times,
                steady_median_s=med,
                ms_per_step=round(med * 1000 / steps),
                peak_vram_mb=max(peaks),
            )
            del pipe
            torch.cuda.empty_cache()
        except Exception as exc:  # noqa: BLE001
            entry.update(status="failed", error=f"{type(exc).__name__}: {exc}"[:600])
        report["variants"][f"{steps}step"] = entry

    report["total_seconds"] = now()
    path = f"{OUT}/results.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("BENCH_JSON: " + json.dumps(report, ensure_ascii=False), flush=True)
    print("written:", path, flush=True)


if __name__ == "__main__":
    main()
