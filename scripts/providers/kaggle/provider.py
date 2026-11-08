"""Kaggle T4 GPU provider supporting both Batch (one-shot) and Session (persistent) modes."""

import base64
import json
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..base import JobSpec, ProviderBase

PROVIDER_DIR = Path(__file__).resolve().parent
SKILL_DIR = PROVIDER_DIR.parent.parent.parent
STATE_FILE = SKILL_DIR / ".state" / "session.json"

WORKER_TEMPLATE = PROVIDER_DIR / "worker.py"
DAEMON_TEMPLATE = PROVIDER_DIR / "daemon.py"

DEFAULT_BATCH_SLUG = "free-imagen-worker"
DEFAULT_SESSION_SLUG = "free-imagen-session"


class KaggleProvider(ProviderBase):
    name = "kaggle"

    def __init__(
        self,
        username: Optional[str] = None,
        kernel_slug: Optional[str] = None,
        title: Optional[str] = None,
        accelerator: str = "NvidiaTeslaT4",
        timeout_min: Optional[int] = None,
        max_wait_min: int = 30,
        idle_timeout_min: int = 15,
    ):
        self.username = username
        self.kernel_slug = kernel_slug
        self.title = title
        self.accelerator = accelerator
        self.timeout_min = timeout_min
        self.max_wait_min = max_wait_min
        self.idle_timeout_min = idle_timeout_min

    @staticmethod
    def _run_cli(cmd: List[str], timeout: int = 120) -> Optional[subprocess.CompletedProcess]:
        try:
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except FileNotFoundError:
            print("ERROR: `kaggle` CLI not found. Install it via: pip install -U kaggle", flush=True)
            sys.exit(3)
        except subprocess.TimeoutExpired:
            return None

    def _get_quota_output(self) -> str:
        proc = self._run_cli(["kaggle", "quota"], timeout=60)
        if proc is None or proc.returncode != 0:
            print(
                "ERROR: Kaggle authentication required.\n"
                "Ask the user to authenticate in their browser via: kaggle auth login",
                flush=True,
            )
            sys.exit(3)
        return (proc.stdout or "").strip()

    def _detect_username(self) -> str:
        if self.username:
            return self.username
        proc = self._run_cli(["kaggle", "auth", "login"], timeout=25)
        text = "" if proc is None else (proc.stdout or "") + (proc.stderr or "")
        match = re.search(r"logged-in to Kaggle as \[([^\]]+)\]", text)
        if match:
            return match.group(1)
        print(
            "ERROR: Could not detect Kaggle username.\n"
            "Run `kaggle auth login` to complete browser OAuth, or pass `--username <handle>`.",
            flush=True,
        )
        sys.exit(3)

    # -------------------------------------------------------------------------
    # Session State & Remote HTTP Client
    # -------------------------------------------------------------------------
    @staticmethod
    def _load_session_state() -> Optional[Dict[str, Any]]:
        if not STATE_FILE.exists():
            return None
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return None

    @staticmethod
    def _save_session_state(state: Dict[str, Any]):
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")

    @staticmethod
    def _clear_session_state():
        if STATE_FILE.exists():
            STATE_FILE.unlink(missing_ok=True)

    @staticmethod
    def _http_request(
        url: str, token: str, method: str = "GET", payload: Optional[dict] = None, timeout: int = 30
    ) -> Optional[dict]:
        headers = {"Authorization": f"Bearer {token}", "User-Agent": "our-free-imagen/1.0"}
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            return None

    def get_active_session(self) -> Optional[Dict[str, Any]]:
        state = self._load_session_state()
        if not state:
            return None
        health = self._http_request(
            f"{state['endpoint_url']}/health", state["auth_token"], method="GET", timeout=8
        )
        if health and health.get("status") == "ok":
            state["health"] = health
            return state
        self._clear_session_state()
        return None

    def check_status(self) -> int:
        quota_text = self._get_quota_output()
        user = self._detect_username()
        print(f"Provider: kaggle (account: {user})", flush=True)
        print(quota_text, flush=True)
        active = self.get_active_session()
        if active:
            h = active["health"]
            print(
                f"\nActive Session: ONLINE ({active['endpoint_url']})\n"
                f"  Loaded Model: {h.get('model_id')}\n"
                f"  Idle Timer:   {h.get('idle_seconds')}s / {h.get('idle_timeout_sec')}s",
                flush=True,
            )
        else:
            print("\nActive Session: NONE (Batch mode or start one with `--session start`)", flush=True)
        return 0

    def start_session(
        self,
        preload_model: str = "stabilityai/sdxl-turbo",
        workdir: Optional[Path] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        if not dry_run:
            active = self.get_active_session()
            if active:
                print(f"Session already active at {active['endpoint_url']}", flush=True)
                return active

        username = (self.username or "dry-run-user") if dry_run else self._detect_username()
        slug = self.kernel_slug or DEFAULT_SESSION_SLUG
        kernel_id = f"{username}/{slug}"

        auth_token = secrets.token_urlsafe(18)
        ntfy_topic = f"fimg-{secrets.token_hex(8)}"
        idle_timeout_sec = int(self.idle_timeout_min * 60)
        hard_timeout_min = self.timeout_min or 60

        cfg_payload = {
            "auth_token": auth_token,
            "ntfy_topic": ntfy_topic,
            "preload_model": preload_model,
            "idle_timeout_sec": idle_timeout_sec,
        }
        cfg_b64 = base64.b64encode(json.dumps(cfg_payload).encode("utf-8")).decode("ascii")

        target_dir = (
            workdir.resolve()
            if workdir
            else Path(tempfile.mkdtemp(prefix="free-imagen-session-"))
        )
        target_dir.mkdir(parents=True, exist_ok=True)

        daemon_code = DAEMON_TEMPLATE.read_text(encoding="utf-8").replace(
            'EMBEDDED_CONFIG_B64 = ""', f'EMBEDDED_CONFIG_B64 = "{cfg_b64}"', 1
        )
        (target_dir / "daemon.py").write_text(daemon_code, encoding="utf-8")

        meta = {
            "id": kernel_id,
            "title": self.title or slug.replace("-", " ").title(),
            "code_file": "daemon.py",
            "language": "python",
            "kernel_type": "script",
            "is_private": True,
            "enable_gpu": True,
            "enable_internet": True,
            "dataset_sources": [],
            "competition_sources": [],
            "kernel_sources": [],
            "model_sources": [],
        }
        (target_dir / "kernel-metadata.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        print(f"Starting persistent Kaggle GPU session: {kernel_id}", flush=True)
        print(f"  Preload Model:   {preload_model}", flush=True)
        print(f"  Auto-Idle Stop:  {self.idle_timeout_min} min without requests", flush=True)
        print(f"  Max Hard Limit:  {hard_timeout_min} min", flush=True)

        if dry_run:
            print(f"Dry run complete: session files written to {target_dir}", flush=True)
            return {"status": "DRY_RUN", "workdir": str(target_dir)}

        self.timeout_min = hard_timeout_min
        url = self._push_kernel(target_dir)
        if url:
            print(f"  Kernel URL:      {url}", flush=True)

        print("Waiting for GPU container and model preload (~2-3 min)...", flush=True)
        deadline = time.time() + self.max_wait_min * 60
        endpoint_info = None

        while time.time() < deadline:
            # 1. Poll ntfy topic for tunnel handshake
            try:
                req = urllib.request.Request(
                    f"https://ntfy.sh/{ntfy_topic}/json?poll=1&since=all",
                    headers={"User-Agent": "our-free-imagen/1.0"},
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    lines = resp.read().decode("utf-8").strip().splitlines()
                    for line in reversed(lines):
                        event = json.loads(line)
                        if event.get("event") == "message" and event.get("message"):
                            msg = json.loads(event["message"])
                            if "endpoint_url" in msg:
                                endpoint_info = msg
                                break
            except Exception:
                pass

            if endpoint_info:
                break

            # 2. Check kernel status in case it crashed early
            proc = self._run_cli(["kaggle", "kernels", "status", kernel_id], timeout=45)
            status_text = "" if proc is None else ((proc.stdout or "") + (proc.stderr or "")).strip()
            upper = status_text.upper()
            if "ERROR" in upper or "CANCEL" in upper or "COMPLETE" in upper:
                logs = self._fetch_logs(kernel_id)
                print(logs[-4000:], flush=True)
                self._diagnose_cpu_fallback(logs)
                print(f"ERROR: Session kernel exited unexpectedly ({status_text}).", flush=True)
                sys.exit(2)

            time.sleep(12)

        if not endpoint_info:
            print("ERROR: Timed out waiting for session tunnel handshake.", flush=True)
            sys.exit(4)

        state = {
            "provider": "kaggle",
            "kernel_id": kernel_id,
            "endpoint_url": endpoint_info["endpoint_url"],
            "auth_token": auth_token,
            "model_id": endpoint_info.get("model_id", preload_model),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "idle_timeout_sec": idle_timeout_sec,
        }
        self._save_session_state(state)
        print(f"Session ONLINE at {state['endpoint_url']} (state saved to {STATE_FILE})", flush=True)
        return state

    def stop_session(self) -> int:
        state = self._load_session_state()
        if not state:
            print("No active session state found.", flush=True)
            return 0
        print(f"Sending /shutdown to {state['endpoint_url']} ({state['kernel_id']})...", flush=True)
        res = self._http_request(
            f"{state['endpoint_url']}/shutdown", state["auth_token"], method="POST", timeout=10
        )
        self._clear_session_state()
        if res and res.get("status") == "shutting_down":
            print("Remote GPU session terminated immediately. Billing stopped.", flush=True)
        else:
            print("Local session state cleared (remote session was already unreachable/stopped).", flush=True)
        return 0

    def _run_via_session(self, session: Dict[str, Any], spec: JobSpec, out_dir: Path) -> Dict[str, Any]:
        start_time = time.time()
        print(
            f"Using active GPU session ({session['endpoint_url']}) | "
            f"Model: {spec.model_id} | Tasks: {len(spec.tasks)}",
            flush=True,
        )
        res = self._http_request(
            f"{session['endpoint_url']}/generate",
            session["auth_token"],
            method="POST",
            payload=spec.to_payload(),
            timeout=600,
        )
        if not res or res.get("status") != "ok":
            print(f"ERROR: Session generation failed: {res}", flush=True)
            sys.exit(2)

        out_dir = out_dir.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        saved_images = []
        meta_records = []
        for item in res.get("results", []):
            img_bytes = base64.b64decode(item.pop("image_b64").encode("ascii"))
            img_path = out_dir / item["file"]
            img_path.write_bytes(img_bytes)
            saved_images.append(str(img_path))
            meta_records.append(item)

        meta_path = out_dir / "meta.json"
        meta_path.write_text(json.dumps(meta_records, ensure_ascii=False, indent=2), encoding="utf-8")

        elapsed = round(time.time() - start_time, 2)
        print("\nGenerated Images (Session Mode):", flush=True)
        for img in saved_images:
            print(f"  {img}", flush=True)
        print(f"Meta:     {meta_path}", flush=True)
        print(f"Elapsed:  {elapsed}s", flush=True)
        return {
            "status": "COMPLETE",
            "mode": "session",
            "images": saved_images,
            "elapsed_seconds": elapsed,
        }

    # -------------------------------------------------------------------------
    # Batch Mode Implementation
    # -------------------------------------------------------------------------
    def _build_batch_workdir(
        self, spec: JobSpec, username: str, workdir: Optional[Path]
    ) -> tuple[str, Path]:
        slug = self.kernel_slug or DEFAULT_BATCH_SLUG
        if not re.fullmatch(r"[a-z0-9-]+", slug):
            print("ERROR: --kernel-slug must contain only lowercase letters, digits, and hyphens.", flush=True)
            sys.exit(1)

        if workdir:
            target_dir = workdir.resolve()
            target_dir.mkdir(parents=True, exist_ok=True)
        else:
            target_dir = Path(tempfile.mkdtemp(prefix="free-imagen-kaggle-"))

        payload_dict = spec.to_payload()
        payload_json = json.dumps(payload_dict, ensure_ascii=False, indent=2)
        payload_b64 = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        (target_dir / "job.json").write_text(payload_json, encoding="utf-8")

        worker_code = WORKER_TEMPLATE.read_text(encoding="utf-8").replace(
            'EMBEDDED_JOB_B64 = ""', f'EMBEDDED_JOB_B64 = "{payload_b64}"', 1
        )
        (target_dir / "worker.py").write_text(worker_code, encoding="utf-8")

        kernel_id = f"{username}/{slug}"
        meta = {
            "id": kernel_id,
            "title": self.title or slug.replace("-", " ").title(),
            "code_file": "worker.py",
            "language": "python",
            "kernel_type": "script",
            "is_private": True,
            "enable_gpu": True,
            "enable_internet": True,
            "dataset_sources": spec.extra.get("dataset_sources", []),
            "competition_sources": [],
            "kernel_sources": [],
            "model_sources": spec.extra.get("model_sources", []),
        }
        (target_dir / "kernel-metadata.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return kernel_id, target_dir

    def _push_kernel(self, target_dir: Path) -> str:
        cmd = [
            "kaggle",
            "kernels",
            "push",
            "-p",
            str(target_dir),
            "--accelerator",
            self.accelerator,
        ]
        if self.timeout_min:
            cmd += ["-t", str(int(self.timeout_min * 60))]
        proc = self._run_cli(cmd, timeout=300)
        if proc is None:
            print("ERROR: `kaggle kernels push` timed out.", flush=True)
            sys.exit(4)
        output = ((proc.stdout or "") + (proc.stderr or "")).strip()
        print(output, flush=True)
        if proc.returncode != 0:
            print("ERROR: `kaggle kernels push` failed.", flush=True)
            sys.exit(2)
        match = re.search(r"https://www\.kaggle\.com/code/\S+", output)
        return match.group(0) if match else ""

    def _wait_for_completion(self, kernel_id: str) -> str:
        deadline = time.time() + self.max_wait_min * 60
        last_status = None
        while time.time() < deadline:
            proc = self._run_cli(["kaggle", "kernels", "status", kernel_id], timeout=60)
            text = "" if proc is None else ((proc.stdout or "") + (proc.stderr or "")).strip()
            if text != last_status:
                print(text, flush=True)
                last_status = text
            upper = text.upper()
            if "COMPLETE" in upper:
                return "COMPLETE"
            if "ERROR" in upper or "CANCEL" in upper:
                return "ERROR"
            time.sleep(15)
        return "TIMEOUT"

    def _fetch_logs(self, kernel_id: str) -> str:
        proc = self._run_cli(["kaggle", "kernels", "logs", kernel_id], timeout=120)
        if proc is None:
            return ""
        raw = (proc.stdout or "").strip()
        try:
            entries = json.loads(raw)
            return "".join(entry.get("data", "") for entry in entries)
        except Exception:
            return raw

    @staticmethod
    def _summarize_logs(logs: str, limit: int = 4000) -> str:
        keys = ("device:", "vram_gb:", "model:", "model loaded", "saved", "DONE", "Traceback", "Error")
        lines = [line for line in logs.splitlines() if any(key in line for key in keys)]
        return "\n".join(lines[-40:])[-limit:]

    @staticmethod
    def _diagnose_cpu_fallback(logs: str):
        low = logs.lower()
        if "cuda available: false" in low or "+cpu" in low or "no gpu detected" in low:
            print(
                "\nDIAGNOSIS: Kaggle silently downgraded the kernel to CPU because the account "
                "has not completed phone verification. Complete phone verification in Kaggle Settings -> Phone Verification.",
                flush=True,
            )

    def _download_output(self, kernel_id: str, out_dir: Path) -> List[str]:
        out_dir = out_dir.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        proc = self._run_cli(["kaggle", "kernels", "output", kernel_id, "-p", str(out_dir)], timeout=900)
        output = "" if proc is None else ((proc.stdout or "") + (proc.stderr or ""))
        print(output.strip()[-2000:], flush=True)
        if proc is None or proc.returncode != 0:
            print("ERROR: Failed to download kernel output.", flush=True)
            sys.exit(2)
        return sorted(str(path.resolve()) for path in out_dir.rglob("*.png"))

    def run_job(
        self,
        spec: JobSpec,
        out_dir: Path,
        workdir: Optional[Path] = None,
        dry_run: bool = False,
        use_session: bool = False,
    ) -> Dict[str, Any]:
        # Automatically route through an existing live session, or start one if requested
        if not dry_run:
            active = self.get_active_session()
            if active:
                return self._run_via_session(active, spec, out_dir)
            if use_session:
                started = self.start_session(preload_model=spec.model_id, workdir=workdir)
                return self._run_via_session(started, spec, out_dir)

        start_time = time.time()
        if dry_run:
            username = self.username or "dry-run-user"
        else:
            print(self._get_quota_output(), flush=True)
            username = self._detect_username()

        kernel_id, built_dir = self._build_batch_workdir(spec, username, workdir)
        print(f"Provider: kaggle (Batch Mode)", flush=True)
        print(f"Account:  {username}", flush=True)
        print(f"Kernel:   {kernel_id}", flush=True)
        print(f"Model:    {spec.model_id} ({spec.width}x{spec.height}, steps={spec.steps}, cfg={spec.cfg})", flush=True)
        print(f"Tasks:    {len(spec.tasks)} image(s)", flush=True)
        print(f"Workdir:  {built_dir}", flush=True)

        if dry_run:
            print("Dry run complete: worker.py, job.json, and kernel-metadata.json generated.", flush=True)
            return {
                "status": "DRY_RUN",
                "kernel_id": kernel_id,
                "workdir": str(built_dir),
                "images": [],
            }

        url = self._push_kernel(built_dir)
        if url:
            print(f"URL:      {url}", flush=True)

        status = self._wait_for_completion(kernel_id)
        logs = self._fetch_logs(kernel_id)

        if status == "COMPLETE":
            print(self._summarize_logs(logs), flush=True)
            images = self._download_output(kernel_id, out_dir)
            if not images:
                print("ERROR: Kernel completed but no PNG outputs were found.", flush=True)
                sys.exit(2)
            elapsed = round(time.time() - start_time, 1)
            print("\nGenerated Images (Batch Mode):", flush=True)
            for img in images:
                print(f"  {img}", flush=True)
            print(f"Meta:     {(out_dir.resolve() / 'meta.json')}", flush=True)
            print(f"Elapsed:  {elapsed}s", flush=True)
            print("\nRemaining Quota:", flush=True)
            print(self._get_quota_output(), flush=True)
            return {
                "status": "COMPLETE",
                "mode": "batch",
                "kernel_id": kernel_id,
                "url": url,
                "images": images,
                "elapsed_seconds": elapsed,
            }

        print(logs[-6000:], flush=True)
        self._diagnose_cpu_fallback(logs)
        print(f"ERROR: Kernel finished with status {status}", flush=True)
        sys.exit(2)
