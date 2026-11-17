"""HTTP 传输层：路由分派、Bearer 鉴权与「异常 → 状态码」映射。

为什么从 daemon.py 拆出来：``DaemonHandler`` 是协议出口（``docs/SPEC.md`` 的每条路由都在
这里落成状态码），却和模型加载、缓存清理、进程生命周期挤在同一个 2k 行模块里——改一行
路由要先读懂整个守护进程。搬到独立模块后，本文件只做四件事：

1. 路径分派（``/health`` / ``/logs`` / ``/job`` / ``/generate`` / ``/shutdown``）；
2. Bearer 鉴权（``hmac.compare_digest``；无 token 时按 ``allow_no_auth`` 决定是否放行）；
   鉴权通过即通知生命周期层「Host 已接管」（``mark_claimed``，取消启动后的 claim 看门狗）；
3. 请求体解码与体积闸门（上限来自注入契约，见 ``config.request_body_limit``）；
4. ``/generate`` 按 ``tool`` 分派：``generate`` 校验 pipeline / loader 与 tasks（含 img2img /
   inpaint 的参考图），``upscale`` 只校验源图并合成 1 条任务——两条路都走同一个异步 job 协议；
5. 把 ``RequestError`` / ``QueueFullError`` 映射成 400 / 429，其余异常交给调用方分类。

**协作者一律从 :class:`HttpApi` 取，本模块不 import daemon**：daemon 反向依赖本模块，
再反向导入就是循环。更重要的是，按**模块属性**（lambda 延迟解析）取协作者而不是在
import 时绑死函数对象，才能让单测的 ``mock.patch.object(daemon, "submit_job")`` 生效
——构造时把实现绑死会让断言静默测到旧对象（架构规格 §1.3.6 点名的假绿陷阱）。
``HttpApi`` 的每个可调用字段都由 Composition Root 用 lambda 装配（见 ``daemon.HTTP_API``）。

**锁顺序（规格 §5.8）**：``/health`` 的「持锁取样 → 释放 → 取队列深度」由注入的
``health_payload`` 自己保证，本模块只负责调用；``/generate`` 读阶段与刷新活动时间都用
注入的 ``state_lock``，**不在持锁期间**调用 ``submit_job``（它内部要拿 JOB_LOCK，
反向嵌套会与 ``_finish_job`` 的 JOB_LOCK → STATE_LOCK 死锁）。任务表只经
``get_job`` / ``job_payload`` / ``submit_job`` 三个语义入口访问。
"""

from __future__ import annotations

import hmac
import json
import os
import threading
import time
import urllib.parse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from log_ring import _ORIG_STDERR, log
from remote.errors import QueueFullError, RequestError
from remote.text import short


@dataclass(frozen=True)
class HttpApi:
    """handler 需要的全部协作者（Composition Root 装配，handler 不持有任何全局）。

    ``config`` / ``state`` 是**活对象**而不是值的拷贝：单测在用例里就地改
    ``CONFIG.auth_token``、``STATE.phase``，handler 必须读到最新值。其余字段是
    可调用对象，调用时机由 handler 决定（鉴权在请求头解析后、体积闸门在读完
    Content-Length 后、入队在请求体校验通过后）。
    """

    config: Any
    state: Any
    state_lock: Any
    request_body_limit: Callable[[], int]
    health_payload: Callable[[], dict]
    log_since: Callable[[int], tuple[list[str], int]]
    get_job: Callable[[str], Any]
    job_payload: Callable[[Any], dict]
    submit_job: Callable[..., Any]
    validate_generate_spec: Callable[[Any], Any]
    parse_reference_spec: Callable[[Any, dict], Any]
    # tool=upscale 的源图校验与任务合成：upscale 不读 pipeline、不查 loader 白名单，
    # 任务要等源图头校验拿到宽高后才能拼出来（见 remote/transport/validator.py）。
    parse_upscale_reference: Callable[[Any], Any]
    build_upscale_task: Callable[[int, int], dict]
    normalize_job_id: Callable[[Any], Any]
    request_shutdown: Callable[[], None]
    cleanup_before_exit: Callable[[], None]
    # 鉴权通过时调用：标记 Host 已接管，取消启动后的 claim 看门狗（幂等）。
    mark_claimed: Callable[[], None]
    iso_time: Callable[[float], str]
    version: Callable[[], str]


class DaemonHandler(BaseHTTPRequestHandler):
    """协议出口：路由 + 鉴权 + 状态码映射。

    ``api`` 是类属性而不是构造参数：``ThreadingHTTPServer`` 会为每个连接新建 handler，
    实例上没有地方塞依赖；单测也用 ``object.__new__(DaemonHandler)`` 造裸实例，类属性
    同样可见（不必绑定真实 socket）。
    """

    api: HttpApi | None = None
    # 版本号在 configure() 里按入口模块的常量填；保持与改造前完全一致的 `Server:` 头。
    server_version = "imagen-daemon"
    sys_version = ""

    # ---- 元信息 ----

    @classmethod
    def _api(cls) -> HttpApi:
        api = cls.api
        if api is None:  # pragma: no cover - 装配漏了才会到这里
            raise RuntimeError("HTTP 层未装配：启动前必须调用 http_server.configure(HttpApi)")
        return api

    # 默认实现会把每行请求写 stderr；这里只写控制台，避免 /health 轮询把日志环刷满。
    def log_message(self, fmt, *args):  # noqa: ANN001
        try:
            _ORIG_STDERR.write(f"[http] {self.address_string()} - {fmt % args}\n")
            _ORIG_STDERR.flush()
        except Exception:
            pass

    # ---- 基础响应 ----

    def _send_json(self, code: int, payload: dict, extra_headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _send_error(self, code: int, error_code: str, message: str, headers: dict | None = None) -> None:
        self._send_json(code, {"error": {"code": error_code, "message": message}}, headers)

    def _require_auth(self) -> bool:
        api = self._api()
        config = api.config
        expected = config.auth_token
        if not expected:
            # 安全修复：没有 token 时默认不放行（本地调试需显式 allow_no_auth=true）。
            if config.allow_no_auth:
                # 本地调试没有 Token 可比，但请求确实到达了鉴权后的接口：同样算已接管，
                # 否则调试中的进程会在 claim_timeout_sec 后自行退出。
                api.mark_claimed()
                return True
            self._send_error(
                401,
                "unauthorized",
                "Daemon 未配置 auth_token，拒绝请求（本地调试请显式配置 allow_no_auth=true）",
            )
            return False
        header = self.headers.get("Authorization", "") or ""
        if header.startswith("Bearer "):
            provided = header[len("Bearer ") :].strip()
            if hmac.compare_digest(provided, expected):
                # 任何带正确 Bearer Token 的请求（/health、/shutdown、/generate、/job、/logs 等）
                # 都说明 Host 已经找到并接管了这个 Kernel：取消 claim 看门狗。
                api.mark_claimed()
                return True
        self._send_error(401, "unauthorized", "缺少或错误的 Bearer Token")
        return False

    def _read_json(self):  # noqa: ANN202
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return {}
        limit = self._api().request_body_limit()
        if length > limit:
            raise RequestError(f"请求体超过上限（{round(limit / 1024 / 1024, 1)}MB）")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RequestError(f"请求体不是合法 JSON：{type(exc).__name__}") from None

    # ---- 路由 ----

    def do_GET(self):  # noqa: N802
        if not self._require_auth():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"
        query = urllib.parse.parse_qs(parts.query)
        api = self._api()
        if path == "/health":
            self._send_json(200, api.health_payload())
            return
        if path == "/logs":
            try:
                since = int((query.get("since") or ["0"])[0])
            except (TypeError, ValueError):
                since = 0
            lines, nxt = api.log_since(since)
            self._send_json(200, {"lines": lines, "next": nxt})
            return
        if path == "/job":
            job_id = str((query.get("id") or [""])[0]).strip()
            if not job_id:
                self._send_error(400, "invalid_request", "缺少 job id（GET /job?id=...）")
                return
            job = api.get_job(job_id)
            if job is None:
                self._send_error(404, "unknown_job", "任务不存在或已过期")
                return
            self._send_json(200, api.job_payload(job))
            return
        self._send_error(404, "not_found", f"未知路径：{path}")

    def do_POST(self):  # noqa: N802
        if not self._require_auth():
            return
        parts = urllib.parse.urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"

        if path == "/shutdown":
            self._api().request_shutdown()
            self._send_json(200, {"status": "shutting_down"})
            threading.Thread(target=self._delayed_exit, daemon=True).start()
            return

        if path == "/generate":
            self._handle_generate()
            return

        self._send_error(404, "not_found", f"未知路径：{path}")

    def _delayed_exit(self) -> None:
        """先把 202/200 响应写回连接，再清理退出（0.3s 给内核刷缓冲）。"""
        api = self._api()
        time.sleep(0.3)
        api.cleanup_before_exit()
        os._exit(0)

    def _handle_generate(self) -> None:
        api = self._api()
        with api.state_lock:
            phase = api.state.phase
            last_error = api.state.last_error
            booted = api.state.booted
            shutting_down = api.state.shutting_down
        can_accept = not shutting_down and (phase == "ready" or (phase == "loading" and booted))
        if not can_accept:
            if phase == "error":
                message = last_error or "Daemon 启动失败"
                self._send_error(503, "load_failed", message)
            else:
                # Host 正常不会在 ready 之前调用；这里给它一个可重试的明确信号。
                self._send_error(
                    503,
                    "warming",
                    f"Daemon 尚未就绪（phase={phase}），请稍后重试",
                    {"Retry-After": "5"},
                )
            return

        spec = None
        try:
            spec = self._read_json()
            pipeline_spec, model_id, tasks, tool = api.validate_generate_spec(spec)
            if tool == "upscale":
                # 高清放大（INTERFACES §2.1）：源图只做头部校验，任务按源图宽高由 daemon
                # 合成 1 条；不读 pipeline、不查 loader 白名单（固定 Real-ESRGAN 权重）。
                reference = api.parse_upscale_reference(spec.get("reference"))
                tasks = [api.build_upscale_task(reference["width"], reference["height"])]
            else:
                # 图生图（M3）：参考图提交期只读图片头做校验，失败直接 400；
                # 没有 reference 时返回 None，文生图路径逐字不变。
                reference = api.parse_reference_spec(spec.get("reference"), pipeline_spec)
            job_id = api.normalize_job_id(spec.get("jobId"))
        except RequestError as exc:
            log(f"[gen] 请求非法（tool={spec.get('tool') if isinstance(spec, dict) else '-'}）：{exc}")
            self._send_error(400, "invalid_request", str(exc))
            return

        try:
            job, created = api.submit_job(
                pipeline_spec, model_id, tasks, job_id, reference, tool=tool
            )
        except QueueFullError as exc:
            log(f"[gen] 队列已满：{exc}")
            self._send_error(429, "queue_full", str(exc), {"Retry-After": "5"})
            return
        except Exception as exc:  # pragma: no cover - 入队本身不涉及 IO
            log(f"[gen] 入队失败：{short(exc)}")
            self._send_error(500, "generation_failed", short(exc))
            return

        with api.state_lock:
            api.state.last_active = time.time()
        if not created:
            log(f"[gen] 幂等命中 {job.job_id}（status={job.status}），不重复入队")
        self._send_json(
            202,
            {
                "status": "accepted",
                "job_id": job.job_id,
                "tool": job.tool,
                "model_id": job.model_id,
                "created_at": api.iso_time(job.created_at),
            },
        )


def configure(api: HttpApi) -> type[DaemonHandler]:
    """装配 handler 的依赖（启动前调用一次；重复调用等价于替换）。"""
    DaemonHandler.api = api
    DaemonHandler.server_version = f"imagen-daemon/{api.version()}"
    return DaemonHandler


def start_server(
    port: int,
    *,
    boot,  # noqa: ANN001 - BootState（活对象，只用于登记 server 句柄）
    boot_lock,  # noqa: ANN001
    host: str = "127.0.0.1",
    thread_name: str = "http-server",
) -> ThreadingHTTPServer:
    """监听并后台 serve；server 句柄写进 ``BOOT.http_server`` 供退出清理关闭。

    用线程而不是阻塞主线程：主线程要跑会合点发布与空闲看门狗（见 ``remote/app.py``）。
    """
    server = ThreadingHTTPServer((host, port), DaemonHandler)
    server.daemon_threads = True
    with boot_lock:
        boot.http_server = server
    threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.5},
        name=thread_name,
        daemon=True,
    ).start()
    log(f"[http] 监听 {host}:{port}")
    return server
