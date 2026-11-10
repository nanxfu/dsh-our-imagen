# 远端 Daemon 与测试/工具链诊断（findings-remote-test）

> 分析范围：`remote/**`、`test/**`、`tools/preview.mjs`、`build.mjs`、`lib/kernel.js`、`lib/remote.js`（远端契约相关）。
> 方法：全部为只读静态分析；行号取自文件物理行（与 `read` 工具一致，`Measure-Object -Line` 会漏空行，未采用）。统计用 `pwsh` 正则/缩进脚本完成，未执行 `remote/daemon.py`、未跑 `npm test` / `build`、未启动任何测试进程。
> 查询代码只返回 Host 侧；这里涉及 `lib/session.js`、`lib/jobs.js` 的行号仅用于证明"契约在哪一侧被消费"，其结构诊断不在本文件结论内。
> 标注"待验证"的条目是静态推理未能闭环、需要运行时确认的判断。

---

## 1. 区域清单与量化

### 1.1 文件与规模

| 文件 | 物理行 | 角色 | 运行入口 |
|---|---:|---|---|
| `remote/daemon.py` | 1216 | Kaggle 容器内常驻服务（HTTP + 隧道 + 依赖 + 模型 + 生成） | 由 `lib/kernel.js` 打包推送 |
| `remote/worker.py` | 129 | 一次性离线出图脚本（读 `job.json`/内嵌 JSON，写 `/kaggle/working`） | **无代码引用**（仅 `CHANGELOG.md:91` 提及，见 2.2） |
| `test/mock-daemon.py` | 524 | 假 Daemon（自实现协议，无 torch） | 手动 `python`；不在 `npm test` |
| `test/smoke-daemon.py` | 426 | 对着 mock 的黑盒协议验收 | 手动 `python`；不在 `npm test` |
| `test/tunnel-probe.py` | 264 | 真机调度探针（CPU，自实现协议子集 + 隧道 + ntfy） | `kaggle-live.mjs` 推送 |
| `test/host-e2e.mjs` | 559 | Host 端到端（进程内 node mock + 假 cordis ctx） | `npm test` |
| `test/session-reliability.mjs` | 433 | 会话可靠性（假 ntfy/假 health/假 deps） | `npm test` |
| `test/session-race.mjs` | 478 | 启动/停止竞态 | `npm test` |
| `test/library-atomic.mjs` | 358 | 本地库原子写 + kaggle CLI 探测 | `npm test` |
| `test/check-client-logic.mjs` | 536 | 纯逻辑/字典/常量 | `npm test` |
| `test/check-client-render.mjs` | 450 | 构建产物 + 假 React 渲染 + 结构哈希 | `npm test` |
| `test/check-client-locale.mjs` | 83 | 文案键静态扫描 + 产物同步 | `npm test` |
| `test/load-client.mjs` | 289 | 测试专用 bundle 加载器（含手写 React 替身） | 被 3 处复用，非测试 |
| `test/gpu-live.mjs` | 189 | 真机 GPU 出图验证 | 手动 `npm run test:gpu` |
| `test/kaggle-live.mjs` | 181 | 真机调度验证（推 tunnel-probe） | 手动 `npm run test:live` |
| `test/verify-loaded.mjs` | 87 | 已部署实例的探活 | 手动 |
| `tools/preview.mjs` | 553 | 设计预览：fixture + 渲染 + HTML + 截图 | 手动 |
| `build.mjs` | 108 | esbuild 打包（发布产物 + 测试产物） | `npm run build` / 被测试 import |
| `lib/kernel.js` | 80 | 生成 Kernel 目录并注入配置 | 由 `lib/session.js` 调用 |
| `lib/remote.js` | 142 | Host 侧 Daemon HTTP 客户端 | 由 `lib/session.js`、`lib/jobs.js` 调用 |

测试总量：`test/` 下 14 个 `.mjs/.py` 文件共 **4857 行**（Python 1214 行 / JS 3643 行），另有 `test/render-golden.json`（663 B）与 `test/.build/client.test.js`（251,477 B，构建产物）。

仓库卫生（`git ls-files` 共 115 个跟踪文件）：`test/` 只跟踪 15 个源文件 + `render-golden.json`，`tools/` 只跟踪 `preview.mjs`；`test/.build/client.test.js` 与 `tools/.preview/`（74 个文件／12.41 MB：16 个 html、30 个 png、17 个 json、8 个 err）**都被 `.gitignore` 忽略、`git status` 干净**——入库卫生没有问题。因此 §2.3 关于 `preview.mjs` 的 P2 只针对"工具职责与本地生成物管理"（每次运行全量重写 16 个 HTML + 30 张 PNG、浏览器路径硬编码），不是跟踪污染。
`package.json:16` 的 `test` 脚本只跑 8 个 JS 文件，**mock-daemon / smoke-daemon / tunnel-probe 三个 Python 协议测试不在任何自动化入口里**。

### 1.2 `remote/daemon.py` 关注点清单

| # | 关注点 | 行范围 | 约行数 | 触及的模块级状态 | 可否脱离整个进程测试 |
|---|---|---|---:|---|---|
| 1 | 日志环 + stdout/stderr 重定向 | 76–190 | 115 | `_LOG_*`、`_ORIG_*`、`_START_TS`、`sys.stdout/stderr` | 部分（`_ring_append`/`log_since` 本身纯函数） |
| 2 | 运行状态容器 + 两个异常类型 | 193–258 | 66 | `STATE`（23 键）、`BOOT`（4 键） | 否（状态即模块全局） |
| 3 | 注入配置解析（Base64/JSON/别名） | 260–316 | 57 | `EMBEDDED_CONFIG_B64`、`STATE` | 部分（`load_config` 依赖文件常量） |
| 4 | ntfy 会合（ready/error 广播） | 318–370 | 53 | `STATE`、`BOOT` | 否（联网） |
| 5 | 依赖安装（pip 卸载/安装） | 372–420 | 49 | 无 | 否（跑 pip） |
| 6 | 模型加载（白名单预拉、loader 分支、LoRA、调度器、释放） | 422–613 | 192 | `STATE["pipe"/"pipeline_key"/"sig_params"]` | 否（需 torch/diffusers/GPU/网络） |
| 7 | 请求校验 + 生成管线 + 错误分类 | 615–762 | 148 | `STATE["sig_params"]` | 校验/分类可测；生成否 |
| 8 | HTTP 服务与路由（含生成编排） | 764–967 | 204 | `STATE`、`BOOT` | 仅能进程级 |
| 9 | Cloudflare 隧道（下载/drain/等待） | 969–1071 | 103 | `BOOT` | 否 |
| 10 | 启动编排 + 空闲看门狗 + 信号 | 1073–1216 | 144 | `STATE`、`BOOT` | 否 |

### 1.3 模块级可变状态清单

| 名字 | 行 | 内容 | 问题 |
|---|---:|---|---|
| `EMBEDDED_CONFIG_B64` | 52 | 注入点空串，被 `lib/kernel.js` 整行替换 | 唯一"配置接口"是一个字符串字面量，无 schema |
| `_START_TS` / `_ORIG_STDOUT` / `_ORIG_STDERR` | 79–81 | 启动时间、原始流 | 导入即固定，日志前缀/tee 行为不可注入 |
| `_LOG_LOCK` / `_LOG_LINES` / `_LOG_SEQ` | 83–85 | 日志环 | `_LOG_SEQ` 需要 `global`（96）；单进程单环，无法并行多实例 |
| `STATE` | 197–222 | **23 键**：5 个配置（auth_token/ntfy_topic/ntfy_server/idle_timeout_sec/port）、1 个 preload、4 个运行期对象（pipe/pipeline_key/sig_params/gen_lock）、4 个计数（jobs_done/waiting/last_active/started_at）、5 个生命周期（phase/detail/shutting_down/loaded/model_id）、2 个结果（last_error/last_error_code）、2 个设备信息 | 配置、状态、资源、统计混在一个 dict；`gen_lock` 也在里面 → 状态本身不可序列化、不可复制、不可断言 |
| `BOOT` | 224–229 | tunnel_url / tunnel_error / cloudflared / published_ready | 隧道线程只用字典通信，无事件/对象边界 |
| 常量 12 个 | 54–73 | VERSION、LOG_MAX_LINES、端口、cloudflared 路径/URL/正则、TUNNEL_WAIT_SEC、pip 包表、SUPPORTED_LOADERS | 正常，但 `SUPPORTED_LOADERS` 与 `build_pipeline` 分支、`lib/presets.js` 三处各存一份（见 2.4） |

结论：daemon 的 41 个函数/类里**没有一个接收"状态对象"参数**（只有 `pipe`/`tasks`/`spec` 这类数据），所有行为都从 `STATE`/`BOOT` 读写。要在同一进程里构造两个隔离实例、或在单测里预置 `phase=error`，都做不到——这是"远端零自动化测试"的结构性原因。

### 1.4 函数长度与嵌套（缩进法统计）

物理行、起止行、最大缩进（4 空格 = 1 层）：

| 函数/类 | 行数 | 最大嵌套 | 位置 |
|---|---:|---:|---|
| `class DaemonHandler` | 166 | 5 | daemon.py:789–954 |
| `build_pipeline` | 68 | 4 | daemon.py:489–556 |
| `_handle_generate` | 65 | 5 | daemon.py:890–954 |
| `main` | 57 | 4 | daemon.py:1156–1212 |
| `validate_generate_spec` | 56 | 4 | daemon.py:630–685 |
| `runtime_boot` | 48 | 3 | daemon.py:1089–1136 |
| `run_tasks` | 47 | 4 | daemon.py:704–750 |
| `tunnel_boot` | 46 | 3 | daemon.py:1026–1071 |
| `class _StreamTee` | 41 | 5 | daemon.py:127–167 |
| `ensure_pipeline` | 34 | 2 | daemon.py:579–612 |

- 59 个 def/class 中 **9 个 ≥40 行、6 个嵌套 ≥5 层**；`try` 38 处、`except Exception` 29 处、`except …: pass` 10 处（正则统计，`remote/daemon.py`）。
- 同口径对比：`test/mock-daemon.py`（524 行、24 个 def）最长 165 行 `MockHandler`；`test/tunnel-probe.py`（264 行、12 个 def）最长 107 行 `Handler`；两者都复制了同一种"Handler 里塞业务"的形状。

### 1.5 协议实现副本清单（这是漂移的结构性来源）

| 实现点 | 行数 | 服务端路由 | `/health` 字段数 | 校验实现 | 备注 |
|---|---:|---|---:|---|---|
| `remote/daemon.py` | 1216 | 4 | 15 | 完整 | 唯一"真实现" |
| `test/mock-daemon.py` | 524 | 4 | 16（多 `mock:true`） | 完整但不一致 | 手动运行 |
| `test/tunnel-probe.py` | 264 | 4 | 13 | 仅 tasks | 真机推送 |
| `test/host-e2e.mjs`（内联 node mock） | 64（25–88） | 3（无 `/logs`） | 9 | 无 | 在 `npm test` 里 |
| `test/session-reliability.mjs`（假 health） | 29（94–122） | 1 | 12 | 无 | 在 `npm test` 里 |
| `lib/remote.js`（客户端） | 142 | — | 透传，Host 只消费 6 个 | 无 | 生产唯一客户端，但 `requestLogs` 无人调用（133–142） |

字段级副本：`image_b64`/`png_bytes` 出现在 7 个文件、`load_seconds` 5 个、`queue_depth` 4 个、`last_error_code` 3 个；1×1 PNG 的 base64 常量逐字符重复 2 份（`test/host-e2e.mjs:20-21`、`test/tunnel-probe.py:28-30`）；预设/fixture 字面量至少 4 份（见 2.4）。

### 1.6 测试职责矩阵

| 文件 | 行数 | 被测对象 | 绑定方式 | 自动化 |
|---|---:|---|---|:--:|
| mock-daemon.py | 524 | 远端协议（**自己实现的那一份**） | 独立进程 HTTP | ✗ |
| smoke-daemon.py | 426 | mock 协议 | 黑盒 HTTP + PNG 结构校验 | ✗ |
| tunnel-probe.py | 264 | 真机调度链路 | 被 `kaggle-live` 推送到 Kaggle | ✗（live） |
| host-e2e.mjs | 559 | `index.js` + `lib/**` | 进程内加载插件 + 自建 node mock + 假 ctx | ✓ |
| session-reliability.mjs | 433 | `lib/session.js`、`lib/jobs.js` | `import` 类 + 假 deps + 本地 HTTP | ✓ |
| session-race.mjs | 478 | `lib/session.js` 竞态 | `import` 类 + 改写 `deps` | ✓ |
| library-atomic.mjs | 358 | `lib/library.js`、`lib/kaggle.js` | `import` + 临时目录 + 假 subprocess | ✓ |
| check-client-logic.mjs | 536 | `src/logic`、字典、常量 | `import` ESM | ✓ |
| check-client-render.mjs | 450 | 构建产物 + 渲染结构 | 进程内 esbuild 构建 + 假 React + 结构哈希 | ✓ |
| check-client-locale.mjs | 83 | 源码文本 + `client.js` | 正则扫源码 | ✓ |
| load-client.mjs | 289 | 无（辅助） | 求值 bundle、替换 `globalThis` | — |
| gpu-live.mjs | 189 | 真机 GPU | `SessionManager` + `lib/remote.js` | ✗（live） |
| kaggle-live.mjs | 181 | 真机调度 | `SessionManager` + `lib/remote.js` | ✗（live） |
| verify-loaded.mjs | 87 | 已部署实例 | 纯 HTTP | ✗ |

---

## 2. 问题证据

### 2.1 过度防御

- [P1] 配置三别名 + 缺配置时静默降级 —— `remote/daemon.py:274`（`raw_b64 = (EMBEDDED_CONFIG_B64 or os.environ.get("IMAGEN_CONFIG_B64") or "").strip()` / `if not raw_b64:` / `log("[config] 未收到注入配置，按本地调试模式启动（无鉴权、无 ntfy）")` / `return {}`）—— 注入是 Host 的自动字符串替换（`lib/kernel.js:37`），一旦替换没命中，daemon 不失败而是**无鉴权、无 ntfy** 地对外起隧道；Host 侧症状是等满隧道超时，排查要跨两套机器。`_pick(cfg, "auth_token","authToken","token")`（290–291）把上游拼写错误变成静默默认值，同理。
- [P1] 未配置 token 即放行 —— `remote/daemon.py:819`（`expected = STATE["auth_token"]` / `if not expected:` / `return True`）—— 与上一条叠加：配置注入失败 + 公网 trycloudflare 域名 = 任何拿到域名的人可匿名 `POST /generate` 消耗 GPU 配额。这是"方便本地调试"的默认值泄漏到了生产路径。
- [P1] 按签名过滤推理参数，静默丢参 —— `remote/daemon.py:724`（`if sig:` / `call_kwargs = {k: v for k, v in call_kwargs.items() if k in sig}`）—— `width/height/steps/cfg` 若不在 `pipe.__call__` 签名里会被无声丢弃，出图尺寸与请求不符且日志无提示；把"loader 不兼容"这一应该报错的情况变成了静默错误结果。第 607 行用 `inspect.signature` 取签名同样只在 `try` 里吞异常。
- [P2] 明知不可达的防御分支写进业务路径 —— `remote/daemon.py:917`（`STATE["waiting"] = max(0, STATE["waiting"] - 1)` / `if not got_lock:  # pragma: no cover - Lock.acquire() 不会返回 False`）—— 作者自己标注了不会发生，仍然保留一个 503 分支；同类还有 `build_pipeline` 末尾的"validate 漏了分支"兜底（555–556），说明 loader 清单维护在两层。
- [P2] 加载失败后 phase 回落到 ready —— `remote/daemon.py:589`（`previous_phase = "ready" if STATE["phase"] == "ready" else STATE["phase"]`）与 `:598`（`set_phase("error" if previous_phase != "ready" else "ready", ...)`）—— 会话原本 ready、换 pipeline 失败时，`/health` 继续报 `ready` 但 `pipe` 为 None；Host 认为在线，下一次请求再失败。状态机语义被"尽量保持可用"的兜底破坏了。
- [P2] `/health` 15 个字段只有 6 个被消费 —— `remote/daemon.py:769–786`（`"queue_depth": STATE["waiting"]` / `"last_error_code": STATE["last_error_code"]` / `"detail": STATE["detail"]` …）—— Host 实际只读 `device / device_count / model_id / idle_timeout_sec / phase / last_error`（`lib/session.js:516-548`）；`status/version/loaded/idle_seconds/jobs_done/queue_depth/last_error_code/detail/uptime_seconds` 共 9 个字段在生产侧无消费者（`queue_depth` 甚至带注释说明用途，914），却要在 5 份 mock 里同步维护。
- [P2] mock 内手写 PNG 编码器 —— `test/mock-daemon.py:110–210`（`def _png_chunk(tag, payload)` / `def _encode_png_rgb(...)` / `def _render_fallback(...)`）—— 约 100 行 zlib+CRC+逐行扫描线代码，只为"Pillow 缺失时仍返回合法 PNG"；`smoke-daemon.py:81-123` 的 `validate_png` 才是真正需要的校验的一半。测试替身承担了产品级健壮性要求。
- [P2] 启动失败路径 6 处同构复制 —— `remote/daemon.py:1029-1035`（下载失败）、`1046-1052`（Popen 失败）、`1067-1071`（等待超时）、`1104-1112`（无 GPU）、`1114-1121`（pip 失败）、`1124-1132`（预加载失败），均为 `BOOT["tunnel_error"]/record_error(...) + set_phase("error", ...) + publish_error(...)` 四行 —— 每加一个启动步骤就要再抄一遍，错误码语义靠人工保持一致。

**判定为合理防御、不建议动的部分**（Kaggle 环境特有约束）：

- HTTP 服务先起、依赖安装/模型加载放后台线程（`daemon.py:9–12`、`1173–1183`）：Kernel 排队 30 分钟后才启动，装依赖期间不可观测会让 Host 只能等超时。
- cloudflared stderr 持续 drain 线程（`996–1023`，设计说明 15–16）：停止读取会写满管道使隧道假死。
- ntfy 用 `Content-Type: text/plain` + 3 次重试（`323–354`，说明 17–18）：实测踩过 publish 指令解析的坑。
- 先卸载 torchao 再升级 diffusers 系（`68–71`、`405–419`）：镜像自带版本冲突，属已知必要步骤。
- OOM 时先 `empty_cache()` 再回错（`438–450`、`946–951`）：让 Host 重试有救。
- `fp16` 变体缺失回退默认权重（`468–486`）：不同仓库的 variant 提供情况确实不一致。
- 空闲超时自动退出（`1198–1205`）、生成串行锁（`915–920` 的锁本身）、白名单预拉权重（`451–465`）：都对应用户/配额的真实风险。

### 2.2 低内聚高耦合

- [P0] 全局 `STATE`/`BOOT` 使 daemon 无法被单元测试或复用 —— `remote/daemon.py:197`（`STATE: dict = {` / `"phase": "booting",` … / `"gen_lock": threading.Lock(),`）—— 顶层 41 个函数/类（外加 handler 方法）都从模块全局读写状态，没有一处接收"状态对象"参数；`/health`、`/generate`、启动编排、看门狗共享同一份可变字典。后果：远端实现只能整进程验证（需要真 torch/GPU/网络/Kaggle），**实际自动化测试覆盖的是 mock，不是产品**；任何"改状态字段名/拆状态"的动作都没有测试兜底。
- [P1] HTTP 层承担编排业务 —— `remote/daemon.py:890`（`def _handle_generate(self) -> None:` 65 行 / 嵌套 5 层，内含 `STATE["waiting"] += 1` / `self._send_json(200, {...})`）—— 路由、鉴权、读体上限、校验、排队计数、加锁、模型加载、生成、错误分类、日志、响应拼装全在一个 handler 方法里；协议字段一改，必然连带改业务代码（反之亦然），这是"改一处动全身"的直接来源。
- [P1] 启动顺序靠 4 个布尔/字典字段隐式会合 —— `remote/daemon.py:1182`（`threading.Thread(target=tunnel_boot, ...)` / `threading.Thread(target=runtime_boot, ...)` / 主线程 `while True: ... if BOOT["tunnel_url"] and not BOOT["published_ready"]:`）—— 没有显式的启动阶段对象/状态机，两个后台线程各自写 `STATE`/`BOOT`，主线程轮询字典判断；要断言"HTTP 先于 pip"这类顺序约束只能读代码。
- [P1] `lib/kernel.js` 与 `daemon.py` 靠字符串字面量约定 —— `lib/kernel.js:37`（`const marker = /^EMBEDDED_CONFIG_B64 = ""[ \t]*$/m` / `if (!marker.test(source)) throw ...` / `source.replace(marker, ...)`）对应 `remote/daemon.py:52`（`EMBEDDED_CONFIG_B64 = ""`）与 47–51 的注释约束"不要加类型注解、不要换引号" —— 无 schema、无版本号、**`lib/kernel.js` 没有被任何测试 import**（全仓 grep 只有 `lib/session.js:16` 引用）：marker 格式一旦被格式化工具改掉，注入静默失败，唯一表现是远端 45 分钟超时。同理 daemon 只认 `{loader, base, …}` 对象，Host 侧 `lib/session.js:265-274` 传的 7 个键中 `preset_id / log_level / version` 被 daemon 完全忽略（`apply_config` 只读 4 个），`lib/kernel.js:25` 的 JSDoc 还把 `log_level` 当有效配置写进文档。
- [P1] loader 清单分散、无编译期或测试保护 —— `remote/daemon.py:73`（`SUPPORTED_LOADERS = ("sdxl", "sdxl-lora", "flux2")`）与 `:510/:516/:547` 三个分支、`:556` 的"validate 漏了分支"兜底、`lib/presets.js:39-136` 的 4 份 pipeline 字面量、`test/mock-daemon.py:51` 的自造副本 —— 新增一个 loader 至少要改 4 个地方，漏改的表现是运行期 500。
- [P2] `remote/worker.py` 是第二套远端实现且无人调用 —— `remote/worker.py:36–53`（`def load_pipeline(model_id)` / `for variant in ("fp16", None):`）与 `daemon.py:468–514` 同构重复 —— 全仓 grep 无任何代码引用 `worker.py`（只有 `CHANGELOG.md:91` 的记录）；它保留了旧的"一次性脚本"形态（读 `job.json` 写 `/kaggle/working`），与 daemon 的 HTTP 形态是两条已分叉的路线，留着会让"哪份是新实现"变得不确定。
- [P2] 工具依赖测试辅助 —— `tools/preview.mjs:20`（`import { loadClient, TEST_ARTIFACT } from '../test/load-client.mjs'`）—— 预览工具通过测试加载器求值测试 bundle，并与 `check-client-render` 共享 golden 语义；`load-client.mjs` 一改，预览与三份客户端测试同时受影响。

### 2.3 意大利面

- [P0] `daemon.py` 1216 行单文件 10 个关注点、59 个 def、29 处 `except Exception`、10 处 `except …: pass` —— `remote/daemon.py:615`（`# 请求校验与生成` 分节）… `:764`（`# HTTP 服务` 分节）… `:969`（`# Cloudflare 隧道`）—— 分节注释是唯一的模块边界；依赖安装、模型加载、HTTP、隧道、看门狗互相调用（`_handle_generate` 直接调 `ensure_pipeline`/`run_tasks`），任何改动都要理解全文。**注意**：单文件形态有一部分来自平台约束——Kaggle `kernel-metadata.json` 只能指定一个 `code_file`（`lib/kernel.js:48`），拆分必须同时引入构建合并步骤，不能只按"拆文件更干净"处理。
- [P1] `DaemonHandler` 166 行 / 9 个方法 / 最大嵌套 5 层 —— `remote/daemon.py:789`（`class DaemonHandler(BaseHTTPRequestHandler):`）到 `954` —— `_send_json` / `_require_auth` / `_read_json` / `do_GET` / `do_POST` / `_delayed_exit` / `_handle_generate` 全在一个类里，其中 `_send_json`/`_send_error`/`_require_auth`/`_read_json` 是通用 HTTP 辅助，`do_GET`/`do_POST`/`_handle_generate` 是路由与业务；`_handle_generate` 里 `ensure_pipeline(pipeline_spec)` 与 `run_tasks(pipe, tasks)` 是模块级函数却只被这个 handler 调用（模块级只是为了避免缩进）。
- [P1] 主循环混杂会合发布、空闲判定、存活日志 —— `remote/daemon.py:1189`（`last_report = 0.0` / `while True:` / `time.sleep(2.0)` / `if BOOT["tunnel_url"] and not BOOT["published_ready"]:` / `idle = now - STATE["last_active"]`）—— 一个 `while` 里做 3 件事，其中空闲判定还有 `busy`/`bootstrapping` 两层例外（1198–1205）；要改空闲策略必须同时理解隧道会合与日志节流。
- [P1] 客户端测试用 289 行手写 React 替身 —— `test/load-client.mjs:26`（`function createRenderer(now) {` / `const slots = []` / `useState(init) { … slots[index] = value; dirty = true }`）与 `:89–117` 的 `mount(component, props, maxPasses = 40)` 收敛循环（`:116` `throw new Error('渲染未在预期轮次内收敛')`）—— 它实现了 slot 化 `useState/useRef/useEffect/useCallback` 和 6 轮 microtask flush；语义与真实 React 的差异（无 key 复用、无并发、无 `useMemo/useReducer/useLayoutEffect`）由注释自行声明（第 8–9 行），任何 src 侧新增 hook 都会以"undefined is not a function"形式炸在所有客户端测试里。`src` 目前只用 4 个 hook（grep 无 `useMemo/useReducer/useLayoutEffect`），说明这是**尚未踩到的隐性天花板**，不是当下缺陷。
- [P1] 手写 HTML 序列化器与 React 替身各自实现一遍渲染语义 —— `tools/preview.mjs:236–297`（`function escapeHtml` / `function styleToText` / `function attrsOf` / `function toHtml(node)`）—— 函数组件展开、`children` 处理、`textarea` 特例、`void` 标签、`style` 对象→CSS 文本，都要与 `test/load-client.mjs:131-147` 的 `serializeTree` 保持"同一套正确语义"；两处对函数组件的展开方式（`node.type({...props, children})`）必须同时正确，否则预览和快照会互相矛盾。
- [P2] `tools/preview.mjs` 一文件 6 个职责 —— `tools/preview.mjs:34`（SVG 占位图生成 34–103）、`:105`（fixture 数据 105–232）、`:236`（HTML 序列化）、`:303`（`DARK_TOKENS` 303–324）、`:496`（`main`：构建产物 + 写 HTML 496–519）、`:521`（Edge 截图驱动 521–547）—— 改样式要碰 fixture，改 fixture 要碰渲染，截图失败与序列化错误混在同一个 stdout 里。

### 2.4 重复与漂移

- [P0] 没有单一契约文件，两份实现引用了一个不存在的文档 —— `remote/daemon.py:56`（`# 日志环容量：Host 侧按 docs/API.md 第 6 节实现，最多 400 行。`）与 `test/mock-daemon.py:7`（`协议与 ``remote/daemon.py``（docs/API.md 第 6 节）保持一致：`）—— 仓库 `docs/` 只有 ARCHITECTURE/ROADMAP/SPEC/STUDIO_SPEC/STUDIO_V2_SPEC/UI_COPYWRITING，**没有 `docs/API.md`**；`docs/SPEC.md` 的 4 个一级章节（会话状态与错误码、Host `/imagen-api/*` 路由、Agent 工具、模型基准）全是 Host 侧契约，没有任何一节定义 Daemon 的 `/health`、`/logs`、`/generate`、`/shutdown`、ntfy 事件。也就是说"Daemon 侧契约"唯一的事实来源是 5 份实现代码，改一处漏几处是结构性的，不是纪律问题。
- [P1] 参数校验口径三套不一致 —— `docs/SPEC.md:118-120`（`width`/`height` 8 的整数倍、256~1536；`steps` 1~60；`cfg` 0.0~20.0）、`remote/daemon.py:658-666`（`_int_param(raw.get("width", 1024), ..., 64, 2048)` / `steps 1,80` / `cfg 0..30`）、`test/mock-daemon.py:274-279`（`width = min(2048, max(64, ...))` / `steps = int(...)` / `cfg = float(...)` 无上下界）—— daemon 比文档宽、mock 比 daemon 更宽且**越界时钳制而不是 400**：mock 永远无法触发 daemon 会返回的 400，Host 的"远端非法请求"分支实际上没被测过；反向若按 SPEC 收紧 daemon 又会让 mock 先绿后红。
- [P1] mock 缺少"单次最多 8 个任务"限制 —— `remote/daemon.py:647`（`if len(tasks_raw) > 8:` / `raise RequestError("单次请求最多 8 个任务")`）对应 `test/mock-daemon.py:262-265`（只有非空检查）—— Host 的批量上限（`count` 最多 4）与远端上限不一致时无测试能发现。
- [P1] mock 没有 `phase=error/installing` 状态，daemon 的 503 分支不可测 —— `remote/daemon.py:891`（`phase = STATE["phase"]` / `if phase != "ready":` / `if phase == "error": … 503 load_failed`）对应 `test/mock-daemon.py:211-217`（`_phase()` 只返回 `loading` 或 `ready`）—— 最自然的 mock 路径测不到 `503 load_failed`，测试只能在 `session-reliability.mjs:103-116` 里手搓第四份 health 断言，覆盖重复且与 mock 无关。
- [P1] `/logs` 分页语义两种实现 —— `remote/daemon.py:184-190`（`total = _LOG_SEQ` / `first_seq = total - len(snapshot) + 1` / `lines = [... if first_seq + offset > since]`；`next = total`，绝对序号）对应 `test/tunnel-probe.py:112-120`（`lines = STATE["logs"][max(0, since):][-200:]` / `next_index = max(0, since) + len(lines)`，索引切片）—— probe 在"新增 >200 行"时会算出偏小的 `next`，下一次拉取会重复返回同一段；若将来 Host 接入日志抽屉并用 probe 验证，拿到的契约是错的。当前 Host 侧 `requestLogs` 无人调用（`lib/remote.js:133-142` 是死代码），所以尚未爆发。
- [P1] 鉴权实现不一致，测试工具比产品弱 —— `remote/daemon.py:826`（`if hmac.compare_digest(provided, expected):`）对应 `test/tunnel-probe.py:84`（`if self.headers.get("Authorization", "") == "Bearer " + expected:`）—— probe 用普通字符串比较，无法证明产品的常量时间比较/边界行为，且两份对 header 大小写、空 Bearer 的处理不同。
- [P1] 配置优先级相反 —— `remote/daemon.py:274`（`EMBEDDED_CONFIG_B64 or os.environ.get("IMAGEN_CONFIG_B64")`，注入优先）对应 `test/tunnel-probe.py:56`（`raw = os.environ.get("IMAGEN_CONFIG_B64") or EMBEDDED_CONFIG_B64`，环境变量优先）—— 用探针验证"注入链路"时，本机若有环境变量会盖掉注入值，验证结论会假绿/假红（待验证：需确认实际运行环境是否设置该变量）。
- [P1] 401 错误体形状不一致，反过来污染了生产客户端 —— `remote/daemon.py:817`（`self._send_json(code, {"error": {"code": error_code, "message": message}}, headers)`）对应 `test/host-e2e.mjs:34`（`if (auth !== \`Bearer ${DEV_TOKEN}\`) return send(401, { error: 'Unauthorized' })`，字符串）—— `lib/remote.js:96-99` 因此写成 `typeof remoteError === 'string' ? remoteError : remoteError?.message ?? ...` 同时兼容两种形状；生产客户端为测试 mock 的错误形状做了兜底，属典型的"测试反向定义契约"。
- [P1] 会合消息（ntfy）字段副本 3 份，其中一份还硬编码了 daemon 文案 —— `remote/daemon.py:357-364`（`{"type": "ready", "endpoint": BOOT["tunnel_url"], "model_id": STATE["model_id"], "device": STATE["device"]}`）、`test/tunnel-probe.py:243-251`（同四字段，硬编码 `https://ntfy.sh`、无 User-Agent、重试 5 次 vs daemon 3 次）、`test/session-reliability.mjs:187-192`（`ntfyMessage({ type: 'ready', endpoint, model_id: 'test/model', device: 'Fake T4' })`）与 `:249-253`（`{ type: 'error', code: 'tunnel_failed', message: 'cloudflared 未给出 trycloudflare 地址（退出码 1）' }`）—— 最后一处把 `remote/daemon.py:1022` 的错误文案整句复制进测试断言，改一个中文字符即碎。
- [P1] 预设/状态 fixture 副本 —— `tools/preview.mjs:115-131`（`const preset = { id: 'sdxl-lightning', label: '默认 · 1024 快档', params: '3.5B + LoRA', license: 'OpenRAIL++', …, steadySeconds: 6.2, tier: 'fast' }`）与 `test/check-client-render.mjs:29-43`（逐字段相同的 `preset`/`turbo` 字面量）—— 预设字段一改要改两处；同类还有 `test/smoke-daemon.py:196-212` 的 `make_spec` 字面量、`test/kaggle-live.mjs:139-153` 的内联请求体，以及 `lib/presets.js:39-136` 的 4 份 pipeline 描述。
- [P1] `/health` 字段副本 5 份 —— 见 1.5；其中 `test/host-e2e.mjs:36-49` 只写 9 个字段且不校验其余，`test/session-reliability.mjs:103-116` 写 12 个 —— 新增/改名一个字段要改 5 处，改漏时 Python 侧漂移不会被任何自动化测试发现（Python 测试不在 `npm test`）。
- [P2] 常量与退出路径复制 —— `LOG_MAX_LINES = 400` 在 `remote/daemon.py:57`、`test/mock-daemon.py:50`，`test/tunnel-probe.py:51` 再硬编码一次；`os._exit(0)`+"0.3s 延迟退出"出现在 `daemon.py:886-888`、`mock-daemon.py:394-397`、`tunnel-probe.py:127-129` 三处；`CLOUDFLARED_URL_RE`（`daemon.py:65`）在 `tunnel-probe.py:198` 重写一遍正则。
- [P2] mock 专用字段泄漏进契约 —— `test/mock-daemon.py:236`（`"mock": True,`）—— 生产 daemon 没有这个字段，mock 的 `/health` 因此与生产不完全同形，任何"完全比对 health 键集合"的测试都会被它绊住（当前没有这种测试，属潜在）。
- [P2] 死代码：`lib/kernel.js:78-80` 的 `copyMockDaemon`（全仓无调用）、`lib/remote.js:133-142` 的 `requestLogs`（全仓无调用）、`remote/worker.py` 整体（无调用）。

---

## 3. 测试对重构的约束

### 3.1 会碎 / 可保留

| 测试 | 行数 | 绑定层级 | daemon 内部拆分（协议不变） | 协议契约化 | `lib/` 内部结构重构 | 判定 |
|---|---:|---|---|---|---|---|
| mock-daemon.py | 524 | 协议副本 | 不动 | **重写 60–100%** | 不动 | 重构成本集中点 |
| smoke-daemon.py | 426 | 黑盒 + 字段表 | 不动 | 改 20–30%（期望字段/文案/PNG 断言可留） | 不动 | 半安全网 |
| tunnel-probe.py | 264 | 协议副本 + 隧道/ntfy | 不动 | 改 50–70% | 不动 | 与 mock 合并可删一半 |
| host-e2e.mjs | 559 | Host 黑盒 + 自建 mock | 不动 | 改 10–15%（内联 mock 换掉） | 改 20–30%（路由/存储/参数断言） | 主要行为安全网 |
| session-reliability.mjs | 433 | 内部字段 + 假 deps | 不动 | 改 ~10%（health fixture） | 改 30–40%（`kernelFolder`/`deps`/`options`） | 高价值但白盒 |
| session-race.mjs | 478 | 内部字段 + 假 deps | 不动 | 不动 | 改 40–60%（`session.deps` 直接赋值） | 高价值但最脆 |
| library-atomic.mjs | 358 | 内部布局 | 不动 | 不动 | 改 15–20%（`.imagen/library.json`） | 行为级为主 |
| gpu-live.mjs / kaggle-live.mjs | 370 | `SessionManager` 选项 + 客户端 | 不动 | 改 5–10% | 改 10–15%（options 键名） | 手工 live，不阻塞 |
| check-client-logic.mjs | 536 | src 内部导出 | 不动 | 不动 | 不动（除非 src 改） | 客户端安全网 |
| check-client-render.mjs | 450 | 产物形状 + 组件 + class + 哈希 | 不动 | 不动 | 不动（除非 src 改） | 结构强绑定 |
| check-client-locale.mjs | 83 | 源文本 + 产物文本 | 不动 | 不动 | 不动 | 便宜的安全网 |
| load-client.mjs | 289 | bundle 形状 + React API 子集 | 不动 | 不动 | 不动 | 隐性约束源 |
| verify-loaded.mjs | 87 | 纯 HTTP | 不动 | 不动 | 动 20%（若 `/imagen-api/state` 形状变） | 最稳的安全网 |

### 3.2 面积估算依据

按"测试行绑定对象"做互斥划分（合计 4857 行）：

| 类别 | 行数 | 占比 | 说明 |
|---|---:|---:|---|
| 协议副本实现（自写服务端） | 788 | 16.2% | mock-daemon 524 + tunnel-probe 264 |
| 行为级黑盒（接口不变即可保留） | 1072 | 22.1% | smoke 426 + host-e2e 559 + verify-loaded 87 |
| 内部实现绑定（import lib 私有/白盒字段/固定存储布局） | 1639 | 33.7% | session-reliability 433 + session-race 478 + library-atomic 358 + gpu-live 189 + kaggle-live 181 |
| 构建/客户端加载绑定 | 1358 | 28.0% | load-client 289 + check-client-render 450 + check-client-logic 536 + check-client-locale 83 |

由此给出四种重构路径的测试改写量（粗略，按"必须改才能绿"计，不含调试时间）：

- **daemon.py 内部拆分（HTTP 协议与 CLI 不变）**：约 **0–3%**（0–150 行）。依据：没有任何测试 `import` `remote/`（全仓 grep 只有注释提及）；Python 测试打的是 mock/probe 自身；唯一会跑真实现的是手动 `gpu-live`/`kaggle-live`（不进 `npm test`，且消耗 GPU 配额）；唯一风险是 `lib/kernel.js:37` 注入 marker 若随拆分消失，需要重写注入器并补一次 live 验证。
- **抽出单一协议契约（路径/字段/错误码/ntfy 事件），mock 与 probe 由契约驱动**：约 **15–23%**（700–1100 行）。依据：协议副本 788 行中 mock 几乎全改、probe 改一半；5 份 health 字段表与 3 份会合消息各改一次；其余测试只需跟一次字段增删。
- **`lib/session.js`/`lib/jobs.js` 结构重构（构造参数、内部字段、时序选项改形态）**：约 **12–17%**（580–830 行）；若只是移动文件/改私有名而不改对外形态，则降到 **3–5%**。依据：`session.kernelFolder` 直接断言 2 处（`session-race.mjs:186`、`session-reliability.mjs:294`），`session.deps.*` 直接改写 1 处（`session-race.mjs:190`），`session.options`/加速时钟键 7 个（`session-reliability.mjs:37,159-165,172-177`），`library-atomic.mjs:36-38` 固定 `.imagen/library.json`。
- **`src/` 组件结构重构**：约 **8–14%**（400–680 行）。依据：`check-client-render.mjs:360/383/414` 直接挂 `client.components.Gallery/Studio`、`:361/415` 用 `internals.i18n.fallbackTranslate`、`:392-394` 断言 `ofs-batch/ofs-tile/ofs-fieldset` 计数、`:431` 断言 `ofs-gallery-action` 类名；10 个场景结构哈希存在 `test/render-golden.json`，组件树一调整就要 `--update` 重建（快照过期风险由 `--update` 一键消除，属于可接受成本）。

### 3.3 哪些层是"改内部也不碎"的安全网（重构应围绕它们加固）

1. `test/verify-loaded.mjs`（87 行）：纯 HTTP + 只断言 6 个公开面（version / presets 不含 pipeline / session 字段 / jobs+queue / history / 空 prompt 400），是最像契约的测试，建议扩成"部署冒烟"主力。
2. `test/host-e2e.mjs` 的主体（约 480 行）：从 `apply()` 到路由、落盘、历史、文件路由、工具，全部走 HTTP + 文件系统断言，只要 Host 路由契约不变就能保留；需要重写的是它自带的内联 node mock（25–88）与写死的 13 条路由清单（201–219）。
3. `test/smoke-daemon.py` 的 `validate_png`（81–123）与 `/logs` 分页断言（291–321）：真正的协议级 oracle，只要目标是 mock 就能保留。
4. `test/session-reliability.mjs` / `session-race.mjs` 的**状态断言**（`snapshot().state` 与错误码，如 `session_ended/health_failed/tunnel_timeout/queue_timeout/push_failed`）：属可保留的行为契约；需要重写的是它们读内部字段（`kernelFolder`/`deps`/`options`）与硬编码文案的部分。
5. `test/check-client-logic.mjs` 的纯函数断言（参数钳制、种子、时长、错误文案顺序等）：不依赖 DOM，是客户端最稳的一层。

---

## 4. 候选重构方向

> 评价口径：收益 = 消除的具体漂移/缺陷风险；代价 = 一次性工作量 + 新增构建/依赖；风险 = 可能引入的新问题。

### 方向 A：daemon 关注点分层 + 显式状态/配置对象（**优先做"对象化"，不急于"拆文件"**）

- 切边界：`logring`（`_LOG_*`/`tee`/`log_since`）、`config`（`load_config`+`apply_config` → `DaemonConfig` dataclass，字段显式、未知键告警）、`state`（`STATE`/`BOOT` → `AppState`/`BootState` dataclass，`pipe`/`lock` 移出为 `Engine` 对象）、`engine`（`ensure_pipeline`/`build_pipeline`/`run_tasks`/`release_pipeline`）、`http`（handler 只做路由+序列化，调用 `engine.handle(spec)`）、`tunnel`、`boot`（启动编排/看门狗）。发布形态仍是单文件：开发期多文件 + 一个"拼接成 daemon.py"的构建步骤（`lib/kernel.js` 生成目录时执行）。
- 收益：`log_since`/`validate_generate_spec`/`classify_failure`/`health_payload` 变成纯函数，可当前就补单测（无需 torch）；6 处重复的启动失败路径收敛为 1 个 `fail_boot(code,msg)`；`/generate` 的 phase/错误分类可单测。
- 代价：新增 Python 合并构建 + 校验（防止拼接顺序/相对 import 出错），`lib/kernel.js` 注入逻辑要跟着改；`traceback` 行号会偏移，远端排查需保留源映射（至少保证合并是"逐文件原文顺序拼接"，行号可按文件偏移反查）。
- 风险：若团队不接受构建步骤，退化为"只抽对象、保留单文件"也能拿到 70% 收益（可单测 + 消除重复），建议分两步走。

### 方向 B：协议抽成单一契约文件（路径 / 字段 / 错误码 / ntfy 事件）

- 切边界：新增 `docs/protocol-daemon.json`（或 `remote/contract.py`）作为唯一事实来源，描述：4 条路由、方法、状态码、`/health` 字段（含"Host 已消费"标记，清理 9 个无消费者字段）、`/generate` 请求/响应、错误 code 表、ntfy `ready`/`error` 事件字段、`EMBEDDED_CONFIG_B64` 的配置 schema（含 `preset_id/log_level/version` 是"允许忽略"还是"删除"）。
- 收益：mock-daemon 由契约驱动（`--fail`/`--warm-seconds` 变成"改字段值"而非复制逻辑）、`smoke-daemon` 的字段表从契约生成、`lib/remote.js` 的字段访问集中、`tunnel-probe` 直接复用 mock 的 handler；**同时把 §2.4 的 6 类漂移一次性消掉**。新增 loader/字段时"改一处"。
- 代价：引入契约文件与两个消费端（Python/JS）的读取/校验代码（约 150–250 行），或一个最小生成脚本。
- 风险：只有 4 条路由，做重了就是过度工程。建议约束为"只固化稳定面（路径、方法、状态码、字段名、错误 code），不固化文案与日志格式"，并且**契约文件本身要有测试**（解析失败要红）。

### 方向 C：测试分四层并去重（unit / process-mock / host / live）

- 切边界：① unit：`daemon` 纯函数 + 契约文件（Python `unittest`，无需 torch）；② process：`mock-daemon` 单进程覆盖全部路由、全部 phase（新增 `--phase error|installing`、`--tasks-limit`、`--logs-flood`）；③ host：`host-e2e` 改为启动 `mock-daemon.py` 子进程，删掉内联 node mock；④ live：`gpu-live`/`kaggle-live`/`tunnel-probe` 只在手动入口。并把 Python 测试接入 `npm test`（或单独 `npm run test:protocol`，在 `package.json` 里显式列出）。
- 收益：删掉约 500–780 行重复实现（内联 node mock 64 行 + probe 与 mock 合并），补上当前完全测不到的 `503 load_failed`/`phase=error` 分支；mock 与 daemon 的校验口径不一致会被 unit 层直接暴露。
- 代价：`host-e2e` 从"零外部依赖"变成"需 python 可执行 + 端口/退出管理"；如果 CI/开发机没有 Python 环境，需要保留一条无 Python 的降级路径。
- 风险：进程级测试的稳定性（端口冲突、僵尸进程）——已有 `MockDaemon`（`smoke-daemon.py:126-193`）的成熟写法可以照搬。

### 方向 D：客户端测试加载器换成真实 React（或显式收紧替身）

- 切边界：把 `test/load-client.mjs:26-128` 的手写 React 替身替换为 devDependency 的真实 `react` + 轻量渲染器（或直接 `react-test-renderer`/`happy-dom`），只保留"求值 bundle + 注入假 fetch/计时器"的部分；`tools/preview.mjs` 不再 import 测试加载器，改 import 共享模块。
- 收益：删除 289 行语义漂移风险，`useMemo/useReducer` 等 hook 不再有隐性天花板；快照更接近真实渲染。
- 代价：新增依赖与加载路径（DSH 平台模块仍需 `require` 注入模拟），`test/render-golden.json` 的 10 个哈希要重建一次。
- 风险：测试启动时间上升；React 版本与宿主平台版本不一致会产生新的假红——需 pin 版本并在 CI 说明。
- 若不做：至少在 `load-client.mjs` 里对"未实现的 hook"给出明确报错（当前是 `undefined is not a function`），并在文档里写明 4 个 hook 的硬约束。

### 方向 E：工具与生成物边界 + 清理死代码（低成本）

- 切边界：`tools/preview.mjs` 拆成 `fixtures.mjs`（数据，与 `check-client-render` 共用一份）、`html.mjs`（序列化/样式）、`shot.mjs`（Edge 驱动，路径可配置：`--browser` 或 env，去掉 `C:\Program Files (x86)\…` 硬编码）；`tools/.preview/` 产物保留在 `.gitignore`（现状已忽略，无需入库）。
- 收益：去 128 行 fixture 重复；不装 Edge 的机器也能生成 HTML；截图失败与渲染错误可区分。
- 代价：文件移动 + import 调整，一次完成。
- 风险：低。
- 同批清理：`lib/kernel.js:78-80 copyMockDaemon`、`lib/remote.js:133-142 requestLogs`（确认无计划后删或标注 reserved）、`remote/worker.py`（移入 `bench/` 或删）。这些都是"读代码时多一次判断"的成本，不影响功能。

---

## 5. 一句话结论

daemon.py 的"单文件 + 全局 STATE + 五份协议副本"是真实问题（漂移已经造成 mock 测不到 daemon 的 400/503 分支、`docs/API.md` 引用了不存在的文档），但单文件形态部分由"Kaggle 只能推一个 code_file"决定，因此**收益最高的重构不是把文件拆小，而是先把协议固化成唯一契约文件、再把 daemon 的状态对象化以便补纯函数单测**；按此路径，测试改写量约 15–23%（主要集中在 mock/probe 与 5 份 health 字段表），而"拆 daemon 内部模块"本身几乎不碎测试（0–3%），属于低风险先行项。