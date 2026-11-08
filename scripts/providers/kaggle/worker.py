#!/usr/bin/env python3
"""Remote worker script executed inside a Kaggle GPU kernel.

Reads task configuration from a Base64-encoded JSON payload or local job.json,
loads the specified HuggingFace Diffusers pipeline on CUDA, generates images,
and writes outputs + meta.json to /kaggle/working.
"""

import base64
import inspect
import json
import os
import time
from pathlib import Path

import torch
from diffusers import AutoPipelineForText2Image

OUT_DIR = Path("/kaggle/working")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Replaced at build time when bundled as a single script, or left empty to read job.json
EMBEDDED_JOB_B64 = ""


def load_job_spec() -> dict:
    if EMBEDDED_JOB_B64:
        raw = base64.b64decode(EMBEDDED_JOB_B64.encode("ascii")).decode("utf-8")
        return json.loads(raw)
    job_file = Path(__file__).resolve().parent / "job.json"
    if job_file.exists():
        return json.loads(job_file.read_text(encoding="utf-8"))
    raise RuntimeError("No job specification found (neither EMBEDDED_JOB_B64 nor job.json).")


def load_pipeline(model_id: str):
    t0 = time.time()
    dtype = torch.float16
    for variant in ("fp16", None):
        try:
            kwargs = {"torch_dtype": dtype, "use_safetensors": True}
            if variant:
                kwargs["variant"] = variant
            pipe = AutoPipelineForText2Image.from_pretrained(model_id, **kwargs)
            pipe = pipe.to("cuda")
            print(f"model loaded ({variant or 'default'}) in {round(time.time() - t0, 1)}s", flush=True)
            return pipe
        except Exception as exc:
            if variant == "fp16":
                print(f"fp16 variant unavailable, falling back to default weights: {exc}", flush=True)
            else:
                raise
    raise RuntimeError(f"Failed to load model: {model_id}")


def main():
    print("torch:", torch.__version__, flush=True)
    if not torch.cuda.is_available():
        raise RuntimeError(
            "No GPU detected (torch.cuda.is_available() is False). "
            "Kaggle silently fell back to CPU — ensure phone verification is enabled in Kaggle Settings."
        )

    print("device:", torch.cuda.get_device_name(0), flush=True)
    vram_gb = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)
    print("vram_gb:", vram_gb, flush=True)

    spec = load_job_spec()
    model_id = spec["model_id"]
    tasks = spec["tasks"]
    print("model:", model_id, flush=True)
    print("total_tasks:", len(tasks), flush=True)

    pipe = load_pipeline(model_id)
    sig_params = set(inspect.signature(pipe.__call__).parameters.keys())

    results = []
    for task in tasks:
        seed = int(task["seed"])
        width = int(task["width"])
        height = int(task["height"])
        steps = int(task["steps"])
        cfg = float(task["cfg"])
        prompt = task["prompt"]
        neg_prompt = task.get("negative_prompt", "").strip()

        generator = torch.Generator(device="cuda").manual_seed(seed)
        call_kwargs = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "guidance_scale": cfg,
            "width": width,
            "height": height,
            "generator": generator,
        }
        if neg_prompt and "negative_prompt" in sig_params and cfg > 0.0:
            call_kwargs["negative_prompt"] = neg_prompt

        begin = time.time()
        image = pipe(**call_kwargs).images[0]
        elapsed = round(time.time() - begin, 2)

        filename = f"{task['name']}_seed{seed}.png"
        out_path = OUT_DIR / filename
        image.save(out_path)

        record = {
            "name": task["name"],
            "file": filename,
            "prompt": prompt,
            "negative_prompt": neg_prompt if (neg_prompt and cfg > 0.0) else "",
            "seed": seed,
            "width": width,
            "height": height,
            "steps": steps,
            "cfg": cfg,
            "seconds": elapsed,
            "model_id": model_id,
        }
        results.append(record)
        print("saved", json.dumps(record, ensure_ascii=False), flush=True)

    meta_path = OUT_DIR / "meta.json"
    meta_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
