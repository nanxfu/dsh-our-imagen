# ─────────────────────────────────────────────────────────────────────────────
# cache_ops：本地预挂载解析、HF 缓存探针与 LRU 磁盘清理（单份源码）
#
# 维护约定：
# 1. 模块顶层只依赖标准库，不在模块加载期触发 huggingface_hub 等重库。
# 2. 不得使用 `from __future__ import annotations`（内联后会位于合并文件中间）。
# 3. 禁止与 daemon.py / log_ring.py / tunnel.py / pipeline_loader.py 顶层符号冲突。
# ─────────────────────────────────────────────────────────────────────────────

import os
import re
import shutil
import sys
import time

# 磁盘预检在估算值上留 15% 余量：下载缓存、解压临时文件也会占空间。
DISK_HEADROOM = 1.15

HF_CACHE_ENV_NAMES = ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE")
HF_TOKEN_ENV_NAMES = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN")
CACHE_PROBE_WORK_DIR = "/kaggle/working"
# 短于该长度的环境变量值不参与脱敏替换，避免误抹普通路径片段（真实 token 远长于此）。
_SECRET_MIN_CHARS = 4

HF_CACHE_REPO_PREFIX = "models--"
HF_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")


def _cache_short(exc: BaseException, limit: int = 600) -> str:
    text = f"{type(exc).__name__}: {exc}"
    return " ".join(text.split())[:limit]


def resolve_local_model_from(repo: str, local_models: dict, *, log=print) -> str | None:  # noqa: ANN001
    """repo 命中 local_models 且目录含 model_index.json 时返回本地目录。

    预挂载目录可能因为 Dataset 版本切换而缺少关键文件，此时不能硬用本地路径，
    必须回退在线加载，否则会把「权重没挂对」变成一次难排查的加载失败。
    """
    key = str(repo or "").strip()
    path = (local_models or {}).get(key)
    if not path:
        return None
    if os.path.isfile(os.path.join(path, "model_index.json")):
        return path
    log(f"[load] WARN 预挂载目录缺少 model_index.json，回退在线加载：{path}")
    return None


def resolve_local_weight_from(
    repo: str,
    weight_name: str,
    local_models: dict,
    *,
    log=print,  # noqa: ANN001
) -> str | None:
    """LoRA / 单文件权重仓库命中预挂载且文件存在时返回本地文件路径。"""
    key = str(repo or "").strip()
    name = str(weight_name or "").strip()
    path = (local_models or {}).get(key)
    if not path or not name:
        return None
    try:
        base = os.path.normpath(path)
        candidate = os.path.normpath(os.path.join(path, name))
        inside = os.path.commonpath([base, candidate]) == base
    except (ValueError, OSError):
        inside = False
    if not inside:
        log(f"[load] WARN LoRA 权重路径越出预挂载目录，已忽略：{name}")
        return None
    if os.path.isfile(candidate):
        return candidate
    log(f"[load] 预挂载目录未找到 LoRA 权重 {name}，回退在线下载：{path}")
    return None


def local_model_dir_from(repo: str, local_models: dict) -> str | None:
    """repo 命中 local_models 且目录存在时返回该目录（不要求 model_index.json）。"""
    path = (local_models or {}).get(str(repo or "").strip())
    if path and os.path.isdir(path):
        return path
    return None


def anima_local_assets_from(
    pipeline_spec: dict,
    local_models: dict,
    *,
    resolve_weight_fn=None,  # noqa: ANN001
    local_dir_fn=None,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> dict[str, str]:
    """把 anima 的四个资产解析成预挂载路径；未命中的键留给在线下载。"""
    weight_lookup = resolve_weight_fn or (
        lambda repo, weight: resolve_local_weight_from(repo, weight, local_models, log=log)
    )
    dir_lookup = local_dir_fn or (lambda repo: local_model_dir_from(repo, local_models))
    assets: dict[str, str] = {}
    dit_weight = weight_lookup(
        str(pipeline_spec.get("base") or ""), str(pipeline_spec.get("weight") or "")
    )
    if dit_weight:
        assets["dit"] = dit_weight
    text_encoder = pipeline_spec.get("textEncoder") or {}
    te_weight = weight_lookup(
        str(text_encoder.get("repo") or ""), str(text_encoder.get("weight") or "")
    )
    if te_weight:
        assets["te"] = te_weight
    vae = pipeline_spec.get("vae") or {}
    raw_subfolder = str(vae.get("subfolder") or "").strip()
    vae_subfolder = raw_subfolder.strip("/")
    vae_parts = vae_subfolder.split("/") if vae_subfolder else []
    if raw_subfolder and (
        os.path.isabs(raw_subfolder)
        or "\\" in raw_subfolder
        or any(part in ("", ".", "..") for part in vae_parts)
    ):
        log(f"[load] WARN 非法 vae.subfolder 已忽略：{raw_subfolder!r}")
    else:
        vae_root = dir_lookup(str(vae.get("repo") or ""))
        if vae_root and os.path.isfile(os.path.join(vae_root, vae_subfolder or ".", "config.json")):
            assets["vae"] = vae_root
    tokenizers = pipeline_spec.get("tokenizers") or {}
    tokenizer_root = dir_lookup(str(tokenizers.get("repo") or ""))
    if tokenizer_root and os.path.isdir(os.path.join(tokenizer_root, "qwen25_tokenizer")):
        assets["tokenizers"] = tokenizer_root
    return assets


def _with_headroom(gb: float) -> float:
    """下载/清理判定统一叠加 DISK_HEADROOM 余量：缓存与解压临时文件也会占空间。"""
    return round(float(gb) * DISK_HEADROOM, 2)


def required_download_gb(pipeline_spec: dict) -> float | None:
    """按 pipeline spec 的 downloadGb 估算下载需求（含 15% 余量）；缺失/非法返回 None。"""
    raw = pipeline_spec.get("downloadGb")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw <= 0:
        return None
    return _with_headroom(raw)


def disk_usage_root() -> str:
    """Kaggle 容器里权重落在 /kaggle/working；其他环境（本地调试）退回当前目录。"""
    return "/kaggle/working" if os.path.isdir("/kaggle/working") else os.getcwd()


def hf_hub_cache_dir() -> str:
    """HF 实际缓存目录。

    顺序与 huggingface_hub 一致：HF_HUB_CACHE → HUGGINGFACE_HUB_CACHE → 已加载模块的
    constants.HF_HUB_CACHE → $HF_HOME/hub → ~/.cache/huggingface/hub。
    """
    for name in HF_CACHE_ENV_NAMES:
        value = (os.environ.get(name) or "").strip()
        if value:
            return os.path.abspath(os.path.expanduser(value))
    for module_name in ("huggingface_hub.constants", "huggingface_hub"):
        module = sys.modules.get(module_name)
        value = getattr(module, "HF_HUB_CACHE", "") if module is not None else ""
        if isinstance(value, str) and value.strip():
            return os.path.abspath(os.path.expanduser(value.strip()))
    hf_home = (os.environ.get("HF_HOME") or "").strip()
    if hf_home:
        return os.path.abspath(os.path.expanduser(os.path.join(hf_home, "hub")))
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def _decode_mount_path(raw: str) -> str:
    """还原 /proc/mounts 路径字段里的八进制转义（\\040 空格等）。"""
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), raw)


def read_mount_points() -> list[str] | None:
    """读 /proc/mounts 得到挂载点列表（供最长前缀匹配）；没有该文件时返回 None。"""
    points: list[str] = []
    try:
        with open("/proc/mounts", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                fields = line.split()
                if len(fields) < 2:
                    continue
                mount = _decode_mount_path(fields[1])
                if mount.startswith("/"):
                    points.append(mount)
    except Exception:
        return None
    return points or None


def longest_mount_prefix(real_path: str, points: list[str]) -> str:
    """从挂载点列表里取 real_path 的最长前缀挂载点；没有匹配返回空串。"""
    best = ""
    for point in points:
        if real_path == point or real_path.startswith(point.rstrip("/") + "/"):
            if len(point) > len(best):
                best = point
    return best


def _existing_ancestor(path: str) -> str:
    """disk_usage / os.stat 只接受已存在的路径：向上找最近的存在祖先。"""
    current = os.path.abspath(os.path.expanduser(path))
    while not os.path.exists(current):
        parent = os.path.dirname(current)
        if parent == current:
            raise FileNotFoundError(path)
        current = parent
    return current


def disk_usage_target() -> str:
    """磁盘测量目标：HF 实际缓存目录（不存在时取最近存在祖先）。"""
    try:
        return _existing_ancestor(hf_hub_cache_dir())
    except Exception:
        return disk_usage_root()


def mount_point_of_path(path: str, *, mount_reader=None) -> str:  # noqa: ANN001
    """path 所在挂载点：优先 /proc/mounts 最长前缀匹配，无该文件时降级到 st_dev。"""
    real = os.path.realpath(os.path.abspath(os.path.expanduser(path)))
    points = (mount_reader or read_mount_points)()
    if points:
        best = longest_mount_prefix(real, points)
        if best:
            return best
    try:
        return f"dev={os.stat(_existing_ancestor(path)).st_dev}"
    except Exception:
        return "unknown"


def probe_free_gib(path: str) -> str:
    """剩余空间（GiB，一位小数）；目录尚不存在时按最近存在祖先的磁盘统计。"""
    try:
        return f"{shutil.disk_usage(_existing_ancestor(path)).free / 2**30:.1f}"
    except Exception:
        return "unknown"


def _redact_secrets(text: str) -> str:
    """把 token 环境变量的值从输出里替换掉（只做替换，不读取打印）。"""
    for name in HF_TOKEN_ENV_NAMES:
        value = (os.environ.get(name) or "").strip()
        if len(value) >= _SECRET_MIN_CHARS and value in text:
            text = text.replace(value, "***")
    return text


def build_cache_probe_lines(*, mount_fn=None, free_fn=None, cache_dir_fn=None) -> list[str]:  # noqa: ANN001
    """缓存 / 挂载点 / 剩余空间诊断行；任何失败都降级为 unknown，绝不抛异常。"""
    get_mount = mount_fn or mount_point_of_path
    get_free = free_fn or probe_free_gib
    get_cache_dir = cache_dir_fn or hf_hub_cache_dir
    try:
        cache_dir = get_cache_dir()
        parts = [
            f"HF_HUB_CACHE={cache_dir}",
            f"mount={get_mount(cache_dir)}",
            f"free={get_free(cache_dir)}GiB",
        ]
        if os.path.isdir(CACHE_PROBE_WORK_DIR):
            work_mount = get_mount(CACHE_PROBE_WORK_DIR)
            work_free = get_free(CACHE_PROBE_WORK_DIR)
            parts.append(f"{CACHE_PROBE_WORK_DIR} mount={work_mount} free={work_free}GiB")
        else:
            parts.append(f"{CACHE_PROBE_WORK_DIR} 不存在")
        return [_redact_secrets("[cache] " + " | ".join(parts))]
    except Exception as exc:
        # 探针只提供排障线索：失败也要安全返回，不能影响加载。
        return [f"[cache] 缓存探针失败：{type(exc).__name__}"]


def run_disk_precheck(
    pipeline_spec: dict,
    root: str | None = None,
    usage=None,  # noqa: ANN001
    *,
    target_fn=None,  # noqa: ANN001
    log=print,  # noqa: ANN001
) -> dict | None:
    """磁盘预检：返回 ``{required_gb, free_gb, path, enough}``；没有体积信息时返回 None。"""
    required = required_download_gb(pipeline_spec)
    if required is None:
        return None
    target = root or (target_fn or disk_usage_target)()
    read_usage = usage or shutil.disk_usage
    try:
        info = read_usage(target)
    except Exception as exc:
        # 读不到剩余空间不应该拦住加载，只留排障线索。
        log(f"[load] WARN 无法读取磁盘剩余空间（跳过预检）：{_cache_short(exc)}")
        return None
    free_gb = round(float(getattr(info, "free", 0)) / 2**30, 2)
    return {"required_gb": required, "free_gb": free_gb, "path": target, "enough": free_gb >= required}


def disk_usage_text(result: dict) -> str:
    return f"需 {result['required_gb']:.1f} GiB / 可用 {result['free_gb']:.1f} GiB"


def ensure_disk_capacity_with(
    pipeline_spec: dict,
    *,
    resolve_model_fn,  # noqa: ANN001
    precheck_fn,  # noqa: ANN001
    log=print,  # noqa: ANN001
    error_cls=RuntimeError,  # noqa: ANN001
) -> None:
    """下载前磁盘预检：Flux.2 全量权重会撑爆 Kaggle 20GB 空间；预挂载时跳过。"""
    if resolve_model_fn(str(pipeline_spec.get("base") or "")):
        log("[load] 底座已预挂载本地权重，跳过磁盘预检")
        return
    result = precheck_fn(pipeline_spec)
    if result is None:
        return
    if result["enough"]:
        log(f"[load] 磁盘预检通过：{disk_usage_text(result)}（{result['path']}）")
        return
    raise error_cls(
        f"磁盘空间不足（{pipeline_spec.get('base')}）：{disk_usage_text(result)}（{result['path']}）"
    )


def _repo_key(repo: str) -> str:
    """仓库 id 归一化（大小写与首尾斜杠无关），仅用于 keep_set 比较。"""
    return str(repo or "").strip().strip("/").lower()


def pipeline_repos(pipeline_spec) -> list[str]:  # noqa: ANN001
    """递归收集 pipeline 描述依赖的全部 HF repo id（去重、去空、保持出现顺序）。"""
    found: list[str] = []
    seen: set[str] = set()

    def visit(value) -> None:  # noqa: ANN001
        if isinstance(value, str):
            text = value.strip()
            if HF_REPO_RE.match(text):
                key = _repo_key(text)
                if key not in seen:
                    seen.add(key)
                    found.append(text)
            return
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                visit(item)

    visit(pipeline_spec)
    return found


def cache_keep_repos_from(pipeline_spec, local_models: dict | None) -> set[str]:  # noqa: ANN001
    """切模型清理的不可删仓库集合：目标 pipeline 全部依赖 + 所有预挂载仓库。"""
    keep = {repo for repo in pipeline_repos(pipeline_spec) if repo}
    keep.update(str(repo).strip() for repo in (local_models or {}) if str(repo).strip())
    return keep


def cache_repo_candidates(dir_name: str) -> set[str]:
    """缓存目录名 → 可能的 repo id 集合（``models--org--name`` → ``org/name``）。"""
    if not dir_name.startswith(HF_CACHE_REPO_PREFIX):
        return set()
    body = dir_name[len(HF_CACHE_REPO_PREFIX) :]
    if not body:
        return set()
    candidates = {body.replace("--", "/")}
    first, sep, rest = body.partition("--")
    if sep and first and rest:
        candidates.add(f"{first}/{rest}")
    head, sep, tail = body.rpartition("--")
    if sep and head and tail:
        candidates.add(f"{head}/{tail}")
    return {item for item in candidates if HF_REPO_RE.match(item)}


def repo_from_cache_dir_name(dir_name: str) -> str | None:
    """缓存目录名还原 repo id（供日志展示）；无法还原返回 None。"""
    body = dir_name[len(HF_CACHE_REPO_PREFIX) :] if dir_name.startswith(HF_CACHE_REPO_PREFIX) else ""
    first, sep, rest = body.partition("--")
    preferred = f"{first}/{rest}" if sep and first and rest else ""
    candidates = cache_repo_candidates(dir_name)
    if not candidates:
        return None
    return preferred if preferred in candidates else sorted(candidates)[0]


def cache_model_dirs(root: str | None = None) -> list[dict]:
    """枚举 HF 缓存目录下的 ``models--*`` 项，按最近修改时间从旧到新排序。"""
    target = root or hf_hub_cache_dir()
    try:
        names = os.listdir(target)
    except OSError:
        return []
    entries: list[dict] = []
    for name in names:
        if not name.startswith(HF_CACHE_REPO_PREFIX):
            continue
        repos = cache_repo_candidates(name)
        if not repos:
            continue
        path = os.path.join(target, name)
        try:
            if not os.path.isdir(path):
                continue
            info = os.stat(path)
        except OSError:
            continue
        entries.append(
            {
                "name": name,
                "path": path,
                "repos": repos,
                "mtime": float(getattr(info, "st_mtime", 0.0) or 0.0),
                "atime": float(getattr(info, "st_atime", 0.0) or 0.0),
            }
        )
    entries.sort(key=lambda item: (item["mtime"], item["atime"], item["name"]))
    return entries


def _cache_path_protected(path: str, local_models: dict | None) -> bool:
    """path 与任何 local_models 预挂载目录重叠时视为受保护（二次防线）。"""
    try:
        base = os.path.abspath(os.path.expanduser(path))
    except Exception:
        return True
    for mapped in (local_models or {}).values():
        try:
            other = os.path.abspath(os.path.expanduser(str(mapped)))
        except Exception:
            continue
        if not other:
            continue
        try:
            common = os.path.commonpath([base, other])
        except (ValueError, OSError):
            continue
        if common in (base, other):
            return True
    return False


def _cache_free_gib(path: str, usage=None, *, log=print) -> float | None:  # noqa: ANN001
    """读 path（不存在时取最近存在祖先）所在磁盘的剩余 GiB；失败返回 None。"""
    read_usage = usage or shutil.disk_usage
    try:
        info = read_usage(_existing_ancestor(path))
    except Exception as exc:
        log(f"[cache] WARN 无法读取磁盘剩余空间（跳过清理判定）：{_cache_short(exc)}")
        return None
    return round(float(getattr(info, "free", 0)) / 2**30, 2)


def _dir_size_gib(path: str) -> float:
    """目录占用 GiB（删除前统计，仅用于日志里的 freed=<X>GiB）。"""
    total = 0
    for base, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(base, name))
            except OSError:
                continue
    return round(total / 2**30, 2)


def evict_cache_dirs(
    required_gb,
    keep_repos=None,
    *,
    root: str | None = None,
    usage=None,
    local_models: dict | None = None,
    log=print,
    error_cls=RuntimeError,
) -> dict:  # noqa: ANN001
    """按需清理 HF 缓存（LRU），返回 ``{required_gb, free_gb, path, evicted, enough}``。"""
    required = _with_headroom(required_gb)
    target = root or hf_hub_cache_dir()
    result: dict = {"required_gb": required, "free_gb": None, "path": target, "evicted": [], "enough": True}
    free = _cache_free_gib(target, usage, log=log)
    if free is None:
        return result
    result["free_gb"] = free
    if free >= required:
        return result

    keep = {_repo_key(repo) for repo in (keep_repos or ()) if _repo_key(repo)}
    keep.update(_repo_key(repo) for repo in (local_models or {}) if _repo_key(repo))
    log(f"[cache] 可用空间不足：需 {required:.2f} GiB / 可用 {free:.2f} GiB，按 LRU 清理 {target}")
    for entry in cache_model_dirs(target):
        if free >= required:
            break
        if _cache_path_protected(entry["path"], local_models):
            log(f"[cache] 跳过预挂载目录：{entry['name']}")
            continue
        if {_repo_key(repo) for repo in entry["repos"]} & keep:
            log(f"[cache] 保留当前模型/预挂载缓存：{repo_from_cache_dir_name(entry['name'])}")
            continue
        repo = repo_from_cache_dir_name(entry["name"]) or entry["name"]
        freed = _dir_size_gib(entry["path"])
        try:
            shutil.rmtree(entry["path"])
        except OSError as exc:
            log(f"[cache] WARN 删除缓存失败（{repo}）：{_cache_short(exc)}")
            continue
        result["evicted"].append({"repo": repo, "path": entry["path"], "freed_gib": freed})
        log(f"[cache] evicted {repo} freed={freed:.2f}GiB")
        measured = _cache_free_gib(target, usage, log=log)
        if measured is None:
            result["free_gb"] = None
            return result
        free = measured
        result["free_gb"] = free

    if free < required:
        result["enough"] = False
        raise error_cls(f"磁盘空间不足：需 {required:.2f} GiB / 可用 {free:.2f} GiB")
    log(f"[cache] 清理完成：需 {required:.2f} GiB / 可用 {free:.2f} GiB")
    return result


def ensure_cache_capacity_with(
    pipeline_spec: dict,
    *,
    resolve_model_fn,  # noqa: ANN001
    anima_assets_fn,  # noqa: ANN001
    keep_repos_fn,  # noqa: ANN001
    evict_fn,  # noqa: ANN001
) -> None:
    """切模型前的缓存清理闸门：空间足够时不扫目录、不删文件，清完仍不足才报错。"""
    base = str(pipeline_spec.get("base") or "")
    if resolve_model_fn(base):
        return
    if str(pipeline_spec.get("loader") or "") == "anima" and anima_assets_fn(pipeline_spec).get("dit"):
        return
    raw = pipeline_spec.get("downloadGb")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw <= 0:
        return
    evict_fn(raw, keep_repos_fn(pipeline_spec))


def prefetch_weights(base: str, allow_patterns, *, log=print) -> None:  # noqa: ANN001
    """按白名单预拉取，避免整仓下载把 /kaggle/working 的 20GB 配额写爆。"""
    if not allow_patterns:
        log(f"[load] 未配置 allowPatterns，跳过预下载：{base}")
        return
    try:
        from huggingface_hub import snapshot_download

        started = time.time()
        log(f"[load] 预下载 {base}（白名单 {len(allow_patterns)} 条）…")
        snapshot_download(base, allow_patterns=list(allow_patterns))
        log(f"[load] 预下载完成，用时 {round(time.time() - started, 1)}s")
    except Exception as exc:
        # 预下载只是加速与控盘手段，失败后继续尝试直接 from_pretrained。
        log(f"[load] 预下载失败（继续直接加载）：{_cache_short(exc)}")
