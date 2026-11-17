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
3. **契约兜底是内置 ``remote/contract.json``**（Batch 3 起）：没有注入契约（旧 Host / 本地调试）
   时，边界取自随源码包分发的 ``contract.json``，不再有硬编码的第二份表。默认边界因此比
   0.3.0 时代收紧（宽高 64–2048 → 256–1536、steps 80 → 60、cfg 30 → 20、每批张数 8 → 4），
   属**行为变更**；详见 docs/REFACTOR_ARCHITECTURE_SPEC.md §4 的 Batch 3。
4. **日志用扁平导入 ``from log_ring import log``**（理由见 ``remote/state.py`` 第 3 条）。
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass, field, fields
from pathlib import Path

from log_ring import log

DEFAULT_PORT = 7860
# 启动后等待 Host 接管的默认时限（秒）。与 shared/contract.js 的 TIMEOUTS.kernelClaimSec 同值；
# 旧 Host 不下发 claim_timeout_sec 时用这个值，避免孤儿 Kernel 空转到 idle_timeout_sec。
DEFAULT_CLAIM_TIMEOUT_SEC = 600


@dataclass
class DaemonConfig:
    """Host 注入的配置。键名即字段名；ntfy_server / port / allow_no_auth 仅本地调试或旧 Host 使用。

    Host 实际下发的键由 lib/session/provisioner.js 的 buildKernelConfig 组装。
    """

    auth_token: str = ""
    ntfy_topic: str = ""
    ntfy_server: str = "https://ntfy.sh"
    idle_timeout_sec: int = 1800
    # 启动后无人接管的退出时限（秒）：任一通过 Bearer 鉴权的 Host 请求即视为已接管。
    claim_timeout_sec: int = DEFAULT_CLAIM_TIMEOUT_SEC
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
    # 工作目录（Colab 用 /content；为空则沿用进程 cwd，即 Kaggle 的 /kaggle/working）。
    work_dir: str = ""
    # 会合落盘（Colab）：daemon 就绪后把地址写到这里，Host 经 Jupyter Contents 读取。
    endpoint_file: str = ""


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
        "claim_timeout_sec",
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
        "work_dir",
        "endpoint_file",
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


def normalize_claim_timeout(raw, *, explicit: bool) -> int:  # noqa: ANN001
    """启动后等待 Host 接管的时限（秒）：正整数，非法值回落默认并告警。

    ``explicit=False``（旧 Host 没下发该键）静默使用默认值——这是正常兼容路径，不算错误；
    真正下发了却类型不对 / <= 0 才是配置错误（``true`` / ``600.5`` 也不接受：bool 是
    int 子类，若放过 ``true`` 会变成 1 秒，正常会话会被误杀）。
    """
    if not explicit or raw is None:
        return DEFAULT_CLAIM_TIMEOUT_SEC
    if isinstance(raw, bool) or not isinstance(raw, int):
        log(
            f"[config] WARN claim_timeout_sec 需为正整数秒，收到 {type(raw).__name__}，"
            f"回落默认 {DEFAULT_CLAIM_TIMEOUT_SEC}s"
        )
        return DEFAULT_CLAIM_TIMEOUT_SEC
    if raw <= 0:
        log(f"[config] WARN claim_timeout_sec 需为正整数秒，收到 {raw}，回落默认 {DEFAULT_CLAIM_TIMEOUT_SEC}s")
        return DEFAULT_CLAIM_TIMEOUT_SEC
    return raw


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
    config.claim_timeout_sec = normalize_claim_timeout(
        cfg.get("claim_timeout_sec"), explicit="claim_timeout_sec" in cfg
    )
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
        log(
            "[config] WARN 未收到 contract，参数边界回退到内置 remote/contract.json"
            f"（version={BUILTIN_CONTRACT.get('version')}，兼容旧 Host）"
        )
    config.allow_no_auth = bool(cfg.get("allow_no_auth", False))
    if config.allow_no_auth:
        log("[config] WARN allow_no_auth=true：无 auth_token 也放行请求，仅限本地调试")
    # P1.2 / P2.1 / P2.2：可选注入项。令牌与权重路径都不进日志（只打开关与数量）。
    config.hf_token = str(cfg.get("hf_token") or "").strip()
    config.pip_constraints = normalize_pip_constraints(cfg.get("pip_constraints"))
    config.fallback_tunnel_command = normalize_fallback_command(cfg.get("fallback_tunnel_command"))
    config.fallback_tunnel_url_regex = str(cfg.get("fallback_tunnel_url_regex") or "").strip()
    config.local_models = normalize_local_models(cfg.get("local_models"))
    config.work_dir = str(cfg.get("work_dir") or "")
    config.endpoint_file = str(cfg.get("endpoint_file") or "")
    # Colab 的工作盘是 /content，而 Kernel 的 cwd 是 /：显式切换，避免相对路径写到根目录。
    if config.work_dir:
        if os.path.isdir(config.work_dir):
            os.chdir(config.work_dir)
            log(f"[config] 工作目录已切换到 {config.work_dir}")
        else:
            log(f"[config] WARN work_dir 不存在，沿用当前目录：{config.work_dir}")
    unknown = sorted(set(cfg) - KNOWN_CONFIG_KEYS)
    if unknown:
        log(f"[config] WARN 未知配置键已忽略：{', '.join(unknown)}")
    # 配置项名可以打日志，值不行（含 token）。
    log(f"[config] 已加载配置项：{', '.join(sorted(cfg.keys())) or '(空)'}")
    log(
        f"[config] idle_timeout={config.idle_timeout_sec}s claim_timeout={config.claim_timeout_sec}s "
        f"port={config.port} "
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
#
# 内置契约就是随源码包分发的 ``remote/contract.json``（由 tools/gen-contract-json.mjs 从
# shared/contract.js 生成，``npm run contract:check`` 校验它与源码一致）。Batch 3 之前这里
# 有一份硬编码的 ``FALLBACK_LIMITS``，与注入契约长期双写：改契约忘了改兜底，本地/旧 Host
# 就会按另一套边界运行，且不报错。现在没有第二份表。
# ─────────────────────────────────────────────────────────────────────────────

CONTRACT_PATH = Path(__file__).resolve().with_name("contract.json")


def _read_builtin_contract() -> dict:
    """读取内置契约（模块导入时一次）。

    读不到**直接抛**而不是退回硬编码：``scripts/package.mjs`` 把它列为必需文件、
    ``test/kernel-package.mjs`` 断言它进了 ZIP；这里静默降级只会把"打包漏文件"变成
    "远端按另一套边界跑"的线上怪象（错误码 400 满天飞，日志里却看不出原因）。
    """
    try:
        data = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - 缺文件 / 坏 JSON 都是打包问题
        raise RuntimeError(
            f"内置契约 {CONTRACT_PATH.name} 不可读（{type(exc).__name__}: {exc}）；"
            "它应随远程源码包一起分发，请检查打包与 files 清单"
        ) from None
    if not isinstance(data, dict) or not isinstance(data.get("limits"), dict):
        raise RuntimeError(f"内置契约 {CONTRACT_PATH.name} 缺少 limits 段")
    return data


BUILTIN_CONTRACT = _read_builtin_contract()
BUILTIN_LIMITS: dict[str, dict] = BUILTIN_CONTRACT["limits"]
# 契约 limits 里可能出现的数值型键：合并兜底值时只认数字（bool 不算数字）。
# 新参数（如局部重绘的 inpaintMax / mask.minCoverage）必须登记在这里，否则注入契约给了
# 新值也会被内置 contract.json 的兜底静默覆盖——「注入契约优先」的口径就不成立了。
LIMIT_NUMERIC_KEYS = (
    "min",
    "max",
    "step",
    "maxChars",
    "default",
    "maxBytes",
    "maxEdge",
    "minEdge",
    "maxCount",
    "inpaintMax",
    "minCoverage",
    # 高清放大（tool=upscale）：放大倍数与输入/输出长边上限，Host 与 daemon 共用同一份。
    "factor",
    "maxInputEdge",
    "maxOutputEdge",
)


def contract_limits() -> dict | None:
    """注入契约里的 ``limits`` 段；契约缺失或形状不对时返回 None。"""
    contract = CONFIG.contract
    limits = contract.get("limits") if isinstance(contract, dict) else None
    return limits if isinstance(limits, dict) else None


def limit_spec(name: str) -> dict:
    """取参数边界：注入契约优先，缺项 / 无注入时回退内置 ``contract.json`` 的同名项。

    合并粒度是**单个键**：注入契约只给了 ``max`` 时，``min`` / ``step`` 仍取内置值，
    这样早于某个参数出现的旧 Host 不会因为"少发一个键"而拿到半张表。
    """
    fallback = dict(BUILTIN_LIMITS[name])
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
        return int(BUILTIN_LIMITS["count"]["max"])
    return value if value > 0 else int(BUILTIN_LIMITS["count"]["max"])


def _limit_max_bytes(name: str) -> int:
    """取某个 limits 项的 ``maxBytes``；缺失 / 非正数按 0 处理（不参与上限推导）。"""
    value = limit_spec(name).get("maxBytes")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return 0
    return int(value)


def request_body_limit() -> int:
    """请求体字节上限：按「参考图 + 蒙版」与「原生参考图列表」两种形状的较大者推导，下限 8MB。

    两种形状互斥（``reference`` 单图垫图 / ``referenceImages`` 原生参考，见
    ``transport/validator.py`` 的 ``_validate_reference_shapes``），因此不用相加：

    - 垫图 + 局部重绘：8MiB 参考图 + ≤2MiB 蒙版，base64 后约 13.5MB；
    - 原生参考图：≤2 张 × 4MiB = 8MiB，base64 后约 10.7MB。

    取较大者并留 1MB 给 tasks / prompt / jobId 等 JSON 字段。上限**跟着契约走**，
    不是另一份手写数字：真机收紧 ``referenceImages.maxCount`` / ``maxBytes`` 后这里自动变小。
    不下发 ``referenceImages`` 的旧 Host 走同一个公式（旧形状的推导结果与改造前逐字一致），
    文生图请求（结构上远小于 1MB）不受影响。
    """
    base = 8 * 1024 * 1024
    reference_bytes = _limit_max_bytes("reference") + _limit_max_bytes("mask")
    images_limits = limit_spec("referenceImages")
    image_bytes = 0
    try:
        count = int(images_limits.get("maxCount") or 0)
        per_image = int(images_limits.get("maxBytes") or 0)
    except (TypeError, ValueError):
        count, per_image = 0, 0
    if count > 0 and per_image > 0:
        image_bytes = count * per_image
    shape_bytes = max(reference_bytes, image_bytes)
    if shape_bytes <= 0:
        return base
    # base64 每 3 字节膨胀成 4 字符；再留 1MB 给 tasks / prompt / jobId 等 JSON 字段。
    return max(base, 4 * ((int(shape_bytes) + 2) // 3) + 1024 * 1024)
