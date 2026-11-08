#!/usr/bin/env python3
"""磁盘与持久化探针（CPU 内核，不需要 GPU）。

第一次运行：报告磁盘布局，写入标记文件。
第二次运行（CHECK=True）：检查标记是否跨会话存活。

结论直接决定"权重缓存"该放哪：/kaggle/working（随内核输出保留，有上限）
还是 /root/.cache（会话级临时盘，结束后丢弃）。
"""

import json
import os
import shutil
import subprocess
import time

CHECK = True  # 第一轮（写入）用 False；第二轮（检查）用 True

MARKERS = {
    "cache": "/root/.cache/_probe_marker.txt",
    "working": "/kaggle/working/_probe_marker.txt",
    "temp": "/kaggle/temp/_probe_marker.txt",
}


def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return (p.stdout or p.stderr or "").strip()
    except Exception as exc:  # noqa: BLE001
        return f"<failed: {exc}>"


def du(path):
    if not os.path.exists(path):
        return "absent"
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return f"{total / 2**30:.2f} GiB"


def main():
    out = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "check_mode": CHECK,
        "df_root": run(["df", "-h", "/"]),
        "df_paths": {},
        "du": {},
        "markers": {},
        "writable": {},
        "cache_listing": run(["bash", "-lc", "ls -la /root/.cache 2>&1 | head -20"]),
    }

    for name, path in MARKERS.items():
        parent = os.path.dirname(path)
        out["df_paths"][name] = run(["df", "-h", parent]) if os.path.exists(parent) else "parent absent"
        try:
            if CHECK:
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as fh:
                        out["markers"][name] = "PRESENT: " + fh.read().strip()
                else:
                    out["markers"][name] = "absent"
            else:
                os.makedirs(parent, exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(f"written at {out['ts']}")
                out["markers"][name] = "written"
                out["writable"][name] = True
        except Exception as exc:  # noqa: BLE001
            out["markers"][name] = f"error: {exc}"
            out["writable"][name] = False

    for path in ("/root/.cache/huggingface", "/kaggle/working", "/kaggle/temp"):
        out["du"][path] = du(path)

    print("DISK_JSON: " + json.dumps(out, ensure_ascii=False), flush=True)
    target = "/kaggle/working/disk.json" if os.path.isdir("/kaggle/working") else "disk.json"
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print("written:", target, flush=True)


if __name__ == "__main__":
    main()
