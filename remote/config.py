"""Daemon 配置与契约边界解析：这次会话"允许做什么"的单一取数点。

为什么从 daemon.py 拆出来：``DaemonConfig``、注入配置的归一（未知键告警、可选注入项
过滤）与 ``contract.limits`` 取数本来就是同一件事——回答"本次会话的参数边界在哪"。
它们却散落在入口文件里，被二十多个函数顺手读全局。搬到独立模块后有两点收益：

- 取数只有一处：``CONFIG`` 单例 + :func:`limit_spec` / :func:`max_tasks` /
  :func:`request_body_limit`，不再到处写 ``CONFIG.contract.get("limits")``；
- 子模块不再反向依赖入口文件：请求校验与参考图编解码由调用方注入 ``limits_for``
  回调（见 ``remote/transport/validator.py``），边界来源仍是本模块。

维护约定（对应 docs/REFACTOR_ARCHITECTURE_SPEC.md §5.5 / §5.10）：

1. **``CONFIG`` 只在 import 时创建一次，之后只做原地更新**：:func:`load_config` 把解析
   结果逐字段写回同一个对象并返回它。禁止 ``CONFIG = load_config()`` 或
   ``daemon.CONFIG = DaemonConfig()``——daemon 与本模块共享同一引用，重新绑定会让两边
   各自持有一份配置，且不会报错（表现为"配置没生效"的假绿）。
2. **注入串与 setter 留在入口模块**：``EMBEDDED_CONFIG_B64`` / ``set_embedded_config()``
   属 daemon.py。启动器（``remote/_entry.py``）与打包测试都按
   ``daemon.EMBEDDED_CONFIG_B64`` 观测注入是否落地，搬到本模块会切断这条观测链路；
   本模块只负责"怎么把那段 Base64 变成 DaemonConfig"。
3. **契约兜底表 ``FALLBACK_LIMITS`` 是临时件**：Batch 3 会删掉它、改为消费内置
   ``remote/contract.json``（默认边界会从 64–2048 收紧到 256–1536，属行为变更）。
   在那之前，缺 ``contract`` 时保持旧 Host 的 64–2048 边界不变。
4. **日志用扁平导入 ``from log_ring import log``**（理由见 ``remote/state.py`` 第 3 条）。
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field, fields

from log_ring import log

DEFAULT_PORT = 7860


@dataclass
class DaemonConfig:
    """Host 注入的配置。键名即字段名；ntfy_server / port / allow_no_auth 仅本地调试或旧 Host 使用。

    Host 实际下发的键由 lib/session/provisioner.js 的 buildKernelConfig 组装。
    """

    auth_token: str = ""
    ntfy_topic: str = ""
    ntfy_server: str = "https://ntfy.sh"
    idle_timeout_sec: int = 1800
    port: int = DEFAULT_PORT
    preload: dict | None = None
    preset_id: str | None = None
    log_level: str = "info"
    version: str = ""
    contract: dict = field(default_factory=dict)
    # 本地调试专用：显式允许无鉴权（默认 false；正常路径必须带 auth_token）。
    allow_no_auth: bool = False
    # 冷启动可靠性（P1.2）：HF Token 只写环境变量，值不落日志；pip 约束按包名合并。
    hf_token: str = ""
    pip_constraints: list = field(default_factory=list)
    # 备用隧道（P2.2）：argv 模板（{port} 占位）与地址提取正则。
    fallback_tunnel_command: list = field(default_factory=list)
    fallback_tunnel_url_regex: str = ""
    # 权重预挂载（P2.1）：HF 仓库 → 容器内本地目录（Kaggle Dataset 挂载路径）。
    local_models: dict = field(default_factory=dict)


# 单例：启动期由 load_config() 原地填充，之后只读（见模块头第 1 条）。
CONFIG = DaemonConfig()


# 注入配置的精确键名（= DaemonConfig 字段名）。Host 侧由 lib/session/provisioner.js 组装；
# ntfy_server / port / allow_no_auth 只给本地调试或旧 Host 使用。未登记的键只告警、不猜别名。
KNOWN_CONFIG_KEYS = frozenset(
    {
        "auth_token",
        "ntfy_topic",
        "ntfy_server",
        "idle_timeout_sec",
        "port",
        "preload",
        "preset_id",
        "log_level",
        "version",
        "contract",
        "allow_no_auth",
        "hf_token",
        "pip_constraints",
        "fallback_tunnel_command",
        "fallback_tunnel_url_regex",
        "local_models",
    }
)


def normalize_pip_constraints(raw) -> list[str]:  # noqa: ANN001
    """Host 注入的 pip 约束：只保留非空字符串（数组或单个字符串）。"""
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        if raw is not None:
            log("[config] pip_constraints 不是数组，已忽略")
        return []
    constraints: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            constraints.append(item.strip())
        elif item is not None:
            log("[config] WARN pip_constraints 中的非字符串项已忽略")
    return constraints


def normalize_fallback_command(raw) -> list[str]:  # noqa: ANN001
    """Host 注入的备用隧道 argv 模板：逐项过滤空串/非字符串。"""
    if not isinstance(raw, (list, tuple)):
        if raw is not None:
            log("[config] fallback_tunnel_command 不是数组，已忽略")
        return []
    command: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            command.append(item)
        elif item is not None:
            log("[config] WARN fallback_tunnel_command 中的非字符串项已忽略")
    return command


def normalize_local_models(raw) -> dict[str, str]:  # noqa: ANN001
    """Host 注入的权重预挂载映射：repo → 容器内目录；非法项过滤并告警。"""
    if not isinstance(raw, dict):
        if raw is not None:
            log("[config] local_models 不是对象，已忽略")
        return {}
    models: dict[str, str] = {}
    for repo, path in raw.items():
        if isinstance(repo, str) and repo.strip() and isinstance(path, str) and path.strip():
            models[repo.strip()] = path.strip()
        else:
            log("[config] WARN local_models 中的非法映射已忽略（值应是目录字符串）")
    return models


def build_config(cfg: dict) -> DaemonConfig:
    """注入 dict → DaemonConfig。未知键打日志（不再静默丢弃），敏感值不落日志。"""
    config = DaemonConfig()
    config.auth_token = str(cfg.get("auth_token") or "")
    config.ntfy_topic = str(cfg.get("ntfy_topic") or "")
    config.ntfy_server = str(cfg.get("ntfy_server") or "https://ntfy.sh").rstrip("/")
    try:
        config.idle_timeout_sec = int(cfg.get("idle_timeout_sec", 1800))
    except (TypeError, ValueError):
        config.idle_timeout_sec = 1800
    try:
        config.port = int(cfg.get("port", DEFAULT_PORT))
    except (TypeError, ValueError):
        config.port = DEFAULT_PORT
    preload = cfg.get("preload")
    # preload 必须是 /generate 里同形状的 pipeline 描述对象（含 loader/base）；
    # Daemon 不认识预设 id，Host 已经在注入前把预设展开成对象。
    config.preload = preload if isinstance(preload, dict) and preload.get("loader") else None
    if preload is not None and config.preload is None:
        log("[config] preload 不是 pipeline 描述对象，已忽略（Host 应下发 {loader, base, ...}）")
    config.preset_id = cfg.get("preset_id")
    config.log_level = str(cfg.get("log_level") or "info")
    config.version = str(cfg.get("version") or "")
    contract = cfg.get("contract")
    config.contract = contract if isinstance(contract, dict) else {}
    if contract is not None and not config.contract:
        log("[config] contract 不是 JSON 对象，已忽略")
    if not config.contract:
        log("[config] WARN 未收到 contract，参数边界回退到内置默认值（兼容旧 Host）")
    config.allow_no_auth = bool(cfg.get("allow_no_auth", False))
    if config.allow_no_auth:
        log("[config] WARN allow_no_auth=true：无 auth_token 也放行请求，仅限本地调试")
    # P1.2 / P2.1 / P2.2：可选注入项。令牌与权重路径都不进日志（只打开关与数量）。
    config.hf_token = str(cfg.get("hf_token") or "").strip()
    config.pip_constraints = normalize_pip_constraints(cfg.get("pip_constraints"))
    config.fallback_tunnel_command = normalize_fallback_command(cfg.get("fallback_tunnel_command"))
    config.fallback_tunnel_url_regex = str(cfg.get("fallback_tunnel_url_regex") or "").strip()
    config.local_models = normalize_local_models(cfg.get("local_models"))
    unknown = sorted(set(cfg) - KNOWN_CONFIG_KEYS)
    if unknown:
        log(f"[config] WARN 未知配置键已忽略：{', '.join(unknown)}")
    # 配置项名可以打日志，值不行（含 token）。
    log(f"[config] 已加载配置项：{', '.join(sorted(cfg.keys())) or '(空)'}")
    log(
        f"[config] idle_timeout={config.idle_timeout_sec}s port={config.port} "
        f"ntfy={'on' if config.ntfy_topic else 'off'} auth={'on' if config.auth_token else 'off'} "
        f"preload={config.preload.get('loader') if config.preload else 'none'} "
        f"preset={config.preset_id or 'none'} log_level={config.log_level} "
        f"version={config.version or 'none'} contract={'on' if config.contract else 'off'} "
        f"allow_no_auth={'on' if config.allow_no_auth else 'off'} "
        f"hf_token={'on' if config.hf_token else 'off'} "
        f"pip_constraints={len(config.pip_constraints)} "
        f"fallback_tunnel={'on' if config.fallback_tunnel_command else 'off'} "
        f"local_models={len(config.local_models)}"
    )
    return config


def apply_config(target: DaemonConfig, source: DaemonConfig) -> DaemonConfig:
    """把 ``source`` 的字段逐个写回 ``target``（保持对象身份），返回 ``target``。

    单例只许原地更新的落地点：所有字段一次覆盖，等价于``target = source``，
    但 ``daemon.CONFIG`` / 注入出去的协作者看到的仍是同一个对象。
    """
    for item in fields(target):
        setattr(target, item.name, getattr(source, item.name))
    return target


def load_config(raw_b64: str = "", *, target: DaemonConfig | None = None) -> DaemonConfig:
    """解析注入配置并**原地**写入 ``target``（默认模块级 ``CONFIG``），返回同一个对象。

    ``raw_b64`` 由入口模块传入（它持有 ``EMBEDDED_CONFIG_B64``）；环境变量
    ``IMAGEN_CONFIG_B64`` 仍是本地调试的兜底。解析失败抛 ``SystemExit``：配置坏了
    不能带着半份配置起隧道（鉴权与契约边界都会静默失效）。
    """
    target = CONFIG if target is None else target
    raw = (raw_b64 or os.environ.get("IMAGEN_CONFIG_B64") or "").strip()
    if not raw:
        log("[config] 未收到注入配置；本地调试需显式配置 allow_no_auth=true，否则启动会拒绝服务")
        return apply_config(target, DaemonConfig())
    try:
        cfg = json.loads(base64.b64decode(raw.encode("ascii")).decode("utf-8"))
    except Exception as exc:
        # 只报异常类型，绝不把配置内容写进日志（里面含 auth_token）。
        raise SystemExit(f"配置解析失败：{type(exc).__name__}: {exc}") from None
    if not isinstance(cfg, dict):
        raise SystemExit("配置必须是 JSON 对象")
    return apply_config(target, build_config(cfg))


# ─────────────────────────────────────────────────────────────────────────────
# 契约边界：全部参数上下限的唯一取数点
# ─────────────────────────────────────────────────────────────────────────────

# 契约缺失时的兜底边界（兼容旧 Host / 本地调试）：保持 0.3.0 之前的 daemon 行为。
# 图生图（reference / strength）是新增能力：旧 Host 不会下发这两组边界，这里与当前契约
# 同值兜底，仅供契约缺项的本地调试；正常运行一律以注入契约的 limits 为准。
FALLBACK_LIMITS: dict[str, dict] = {
    "width": {"min": 64, "max": 2048, "step": 8},
    "height": {"min": 64, "max": 2048, "step": 8},
    "steps": {"min": 1, "max": 80},
    "cfg": {"min": 0, "max": 30},
    "count": {"min": 1, "max": 8},
    "seed": {"max": 2**31 - 1},
    "prompt": {"maxChars": 2000},
    "negativePrompt": {"maxChars": 1000},
    "reference": {"maxBytes": 8 * 1024 * 1024, "maxEdge": 1536, "minEdge": 128},
    "strength": {"min": 0.2, "max": 0.9, "step": 0.05, "default": 0.6},
}
MAX_TASKS_FALLBACK = 8
# 契约 limits 里可能出现的数值型键：合并兜底值时只认数字（bool 不算数字）。
LIMIT_NUMERIC_KEYS = ("min", "max", "step", "maxChars", "default", "maxBytes", "maxEdge", "minEdge")


def contract_limits() -> dict | None:
    """注入契约里的 ``limits`` 段；契约缺失或形状不对时返回 None。"""
    contract = CONFIG.contract
    limits = contract.get("limits") if isinstance(contract, dict) else None
    return limits if isinstance(limits, dict) else None


def limit_spec(name: str) -> dict:
    """取参数边界：优先注入契约 ``CONFIG.contract["limits"]``，缺失时退回内置兜底。"""
    fallback = dict(FALLBACK_LIMITS[name])
    limits = contract_limits()
    if limits is None:
        return fallback
    item = limits.get(name)
    if not isinstance(item, dict):
        return fallback
    merged = dict(fallback)
    for key in LIMIT_NUMERIC_KEYS:
        value = item.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            merged[key] = value
    return merged


def max_tasks() -> int:
    """单次请求任务上限：跟契约的 count 上限对齐（Host 的 count 就是每批张数）。"""
    try:
        value = int(limit_spec("count").get("max"))
    except (TypeError, ValueError):
        return MAX_TASKS_FALLBACK
    return value if value > 0 else MAX_TASKS_FALLBACK


def request_body_limit() -> int:
    """请求体字节上限：默认 8MB；契约下发参考图边界后按 base64 膨胀放宽。

    8MiB 原图 base64 后约 10.7MB，不下发 reference 的旧 Host 仍按 8MB 处理，
    保证文生图路径的请求体上限与改造前完全一致。
    """
    base = 8 * 1024 * 1024
    limits = contract_limits()
    reference = limits.get("reference") if limits else None
    if not isinstance(reference, dict):
        return base
    max_bytes = reference.get("maxBytes")
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, (int, float)) or max_bytes <= 0:
        return base
    # base64 每 3 字节膨胀成 4 字符；再留 1MB 给 tasks / prompt / jobId 等 JSON 字段。
    return max(base, 4 * ((int(max_bytes) + 2) // 3) + 1024 * 1024)
