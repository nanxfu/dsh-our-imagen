#!/usr/bin/env python3
"""Unified CLI for our-free-imagen.

Supports two execution modes:
  1. Batch mode (default): One-shot kernel execution, exits immediately after completion.
  2. Session mode: Keeps a persistent GPU daemon alive for ~1.5s interactive generation,
     with automatic idle-timeout shutdown and instant `--session stop` termination.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SKILL_DIR = Path(__file__).resolve().parent.parent
MODELS_CONFIG_PATH = SKILL_DIR / "configs" / "models.json"

from providers import PROVIDERS, ImageTask, JobSpec


def die(msg: str, code: int = 1):
    print(f"ERROR: {msg}", flush=True)
    sys.exit(code)


def load_models_config() -> Dict[str, Any]:
    if not MODELS_CONFIG_PATH.exists():
        return {"default_preset": "sdxl-turbo", "presets": {}}
    return json.loads(MODELS_CONFIG_PATH.read_text(encoding="utf-8"))


def resolve_model_id(args: argparse.Namespace) -> str:
    cfg = load_models_config()
    presets = cfg.get("presets", {})
    preset_name = args.preset or cfg.get("default_preset", "sdxl-turbo")
    if args.model:
        return args.model
    if preset_name in presets:
        return presets[preset_name]["model_id"]
    return "stabilityai/sdxl-turbo"


def parse_seeds(value: str) -> List[int]:
    try:
        seeds = [int(item.strip()) for item in value.split(",") if item.strip()]
    except ValueError:
        die("--seeds must be comma-separated integers, e.g. 42,2026")
    if not seeds:
        die("--seeds cannot be empty")
    return seeds


def cmd_presets() -> int:
    cfg = load_models_config()
    default_name = cfg.get("default_preset", "")
    presets = cfg.get("presets", {})
    print(f"Available Model Presets (config: {MODELS_CONFIG_PATH}):\n")
    for name, info in presets.items():
        marker = " [default]" if name == default_name else ""
        print(f"  * {name}{marker}")
        print(f"      Model:   {info['model_id']}")
        print(f"      Params:  {info['width']}x{info['height']}, steps={info['steps']}, cfg={info['cfg']}")
        print(f"      License: {info.get('license', 'N/A')}")
        print(f"      Desc:    {info.get('description', '')}\n")
    return 0


def build_job_spec(args: argparse.Namespace) -> JobSpec:
    cfg = load_models_config()
    presets = cfg.get("presets", {})
    preset_name = args.preset or cfg.get("default_preset", "sdxl-turbo")

    if preset_name not in presets and not args.model:
        die(f"Unknown preset '{preset_name}'. Run with `--list-presets` or specify `--model <hf-id>`.")

    preset_info = presets.get(
        preset_name,
        {
            "model_id": args.model or "stabilityai/sdxl-turbo",
            "width": 512,
            "height": 512,
            "steps": 4,
            "cfg": 0.0,
        },
    )

    file_data: Dict[str, Any] = {}
    if args.job_file:
        job_path = Path(args.job_file).resolve()
        if not job_path.exists():
            die(f"Job file not found: {job_path}")
        try:
            file_data = json.loads(job_path.read_text(encoding="utf-8"))
        except Exception as exc:
            die(f"Failed to parse JSON job file '{job_path}': {exc}")

    model_id = args.model or file_data.get("model_id") or preset_info["model_id"]
    width = args.width if args.width is not None else file_data.get("width", preset_info["width"])
    height = args.height if args.height is not None else file_data.get("height", preset_info["height"])
    steps = args.steps if args.steps is not None else file_data.get("steps", preset_info["steps"])
    cfg_scale = args.cfg if args.cfg is not None else file_data.get("cfg", preset_info["cfg"])
    neg_prompt = (
        args.negative_prompt
        if args.negative_prompt is not None
        else file_data.get("negative_prompt", "")
    )

    if width < 256 or height < 256 or width % 64 != 0 or height % 64 != 0:
        die(f"Width ({width}) and height ({height}) must be >= 256 and multiples of 64.")
    if steps < 1 or steps > 100:
        die(f"Steps ({steps}) must be between 1 and 100.")
    if cfg_scale < 0.0 or cfg_scale > 30.0:
        die(f"CFG scale ({cfg_scale}) must be between 0.0 and 30.0.")

    seeds = parse_seeds(args.seeds)
    tasks: List[ImageTask] = []

    if "tasks" in file_data and isinstance(file_data["tasks"], list):
        for idx, item in enumerate(file_data["tasks"], 1):
            if isinstance(item, str):
                for s in seeds:
                    tasks.append(ImageTask(name=f"img{idx:02d}", prompt=item, seed=s))
            elif isinstance(item, dict):
                prompt_text = item.get("prompt", "").strip()
                if not prompt_text:
                    die(f"Task #{idx} in {args.job_file} is missing 'prompt'.")
                task_seeds = item.get("seeds") or ([item["seed"]] if "seed" in item else seeds)
                for s in task_seeds:
                    tasks.append(
                        ImageTask(
                            name=item.get("name", f"img{idx:02d}"),
                            prompt=prompt_text,
                            seed=int(s),
                            negative_prompt=item.get("negative_prompt", ""),
                            width=item.get("width"),
                            height=item.get("height"),
                            steps=item.get("steps"),
                            cfg=item.get("cfg"),
                        )
                    )

    if args.prompt:
        start_idx = len(tasks) + 1
        for offset, prompt_text in enumerate(args.prompt):
            idx = start_idx + offset
            for s in seeds:
                tasks.append(ImageTask(name=f"img{idx:02d}", prompt=prompt_text, seed=s))

    if not tasks:
        die("No prompts provided. Pass `--prompt \"...\"` or `--job-file <path.json>`.")

    return JobSpec(
        model_id=model_id,
        width=int(width),
        height=int(height),
        steps=int(steps),
        cfg=float(cfg_scale),
        negative_prompt=neg_prompt,
        tasks=tasks,
        extra=file_data.get("extra", {}),
    )


def main():
    parser = argparse.ArgumentParser(
        description="Unified Free Image Generation CLI (Batch & Persistent Session modes)."
    )
    parser.add_argument(
        "--provider",
        default="kaggle",
        choices=sorted(PROVIDERS.keys()),
        help="Compute provider backend (default: kaggle)",
    )
    parser.add_argument(
        "--mode",
        choices=["batch", "session"],
        default="batch",
        help="Execution mode: 'batch' (one-shot, stops immediately) or 'session' (keeps GPU warm for fast interactive runs)",
    )
    parser.add_argument(
        "--session",
        choices=["start", "stop", "status"],
        default=None,
        help="Manage persistent GPU session lifecycle directly (`start`, `stop`, `status`)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check provider authentication, remaining quota, and active session status",
    )
    parser.add_argument(
        "--list-presets",
        action="store_true",
        help="List all configured model presets in configs/models.json and exit",
    )

    # Model & generation parameters
    parser.add_argument("--preset", default=None, help="Model preset name from configs/models.json")
    parser.add_argument("--model", default=None, help="Override HuggingFace model ID")
    parser.add_argument("--prompt", action="append", help="Text prompt (repeatable)")
    parser.add_argument("--negative-prompt", default=None, help="Negative prompt (active when cfg > 0)")
    parser.add_argument("--job-file", default=None, help="Path to a JSON job file")
    parser.add_argument("--seeds", default="42", help="Comma-separated random seeds (default: 42)")
    parser.add_argument("--width", type=int, default=None, help="Override image width (multiple of 64)")
    parser.add_argument("--height", type=int, default=None, help="Override image height (multiple of 64)")
    parser.add_argument("--steps", type=int, default=None, help="Override inference steps (1-100)")
    parser.add_argument("--cfg", type=float, default=None, help="Override guidance_scale / CFG (0.0-30.0)")

    # Output & execution options
    parser.add_argument("--out", default="imagen-output", help="Local output directory")
    parser.add_argument("--workdir", default=None, help="Directory to stage provider build files")
    parser.add_argument("--dry-run", action="store_true", help="Build files locally without pushing")

    # Kaggle-specific provider options
    parser.add_argument("--username", default=None, help="[Kaggle] Override Kaggle username")
    parser.add_argument("--kernel-slug", default=None, help="[Kaggle] Custom kernel slug")
    parser.add_argument("--title", default=None, help="[Kaggle] Custom kernel title")
    parser.add_argument("--timeout-min", type=int, default=None, help="[Kaggle] Hard session timeout in minutes")
    parser.add_argument(
        "--idle-timeout-min",
        type=int,
        default=15,
        help="[Kaggle Session] Auto-shutdown after N idle minutes without requests (default: 15)",
    )
    parser.add_argument("--max-wait-min", type=int, default=30, help="[Kaggle] Max polling wait time in minutes")

    args = parser.parse_args()

    if args.list_presets:
        sys.exit(cmd_presets())

    provider_cls = PROVIDERS[args.provider]
    workdir = Path(args.workdir) if args.workdir else None

    if args.provider == "kaggle":
        provider = provider_cls(
            username=args.username,
            kernel_slug=args.kernel_slug,
            title=args.title,
            timeout_min=args.timeout_min,
            max_wait_min=args.max_wait_min,
            idle_timeout_min=args.idle_timeout_min,
        )
    else:
        provider = provider_cls()

    if args.check or args.session == "status":
        sys.exit(provider.check_status())

    if args.session == "stop":
        sys.exit(provider.stop_session())

    if args.session == "start":
        preload_model = resolve_model_id(args)
        provider.start_session(preload_model=preload_model, workdir=workdir, dry_run=args.dry_run)
        if not args.prompt and not args.job_file:
            return

    spec = build_job_spec(args)
    use_session = args.mode == "session" or args.session == "start"
    provider.run_job(
        spec=spec,
        out_dir=Path(args.out),
        workdir=workdir,
        dry_run=args.dry_run,
        use_session=use_session,
    )


if __name__ == "__main__":
    main()
