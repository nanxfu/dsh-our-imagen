# 工程架构解耦与代码组织重构规格 (REFACTOR_ARCHITECTURE_SPEC)

> **基线版本**：`0.10.0`（2026-11-15）
> **文档状态**：规划中（后续分批迭代落地）
> **适用范围**：`remote/`（Python 远端推理守护进程）、`lib/kernel.js`（Kernel 打包器）、`lib/jobs.js`、`lib/kaggle-oauth.js` 及配套测试套件
> **外部协议红线**：本重构只调整内部模块边界、依赖方向与打包形态；[`docs/SPEC.md`](SPEC.md) 定义的全部 HTTP 路由、`/health` / `/generate` / `/job` / `/logs` / `/shutdown` 报文、错误码、ntfy 事件及配置注入契约保持 **100% 向后兼容**。

---

## 1. 背景、体检结论与第一性原理约束

### 1.1 物理部署约束
Kaggle Kernel 的 `kernel-metadata.json` 只接受**单个 `code_file`**（`daemon.py`）。仓库此前为该约束在 [`lib/kernel.js`](../lib/kernel.js) 里引入了 `# @@INLINE:<模块>.py@@` 行替换（把模块全文拼进 `daemon.py` 的同一顶层命名空间），先后拆出 `log_ring.py`、`pipeline_loader.py`、`cache_ops.py`、`anima_runtime.py`、`tunnel.py` 五个模块。

**该机制已在 Batch 0 被归档打包取代**（见 §2.4）：`remote/` 作为标准 Python 包整体压成 ZIP 内嵌进启动器，文本拼接带来的命名空间、子目录与 `from __future__` 限制一并消失，五处 `@@INLINE` 标记已从源码移除。

### 1.2 全工程体量与耦合体检
截至 `0.10.0`，全仓大文件需区分「**真重构对象**」与「**无需强拆对象**」：

| 文件 | 行数 | 评估结论 | 说明 |
| :--- | ---: | :--- | :--- |
| `remote/daemon.py` | 2579 | **核心改造对象** | 混杂 7+ 职责、全局可变状态、~25 个胶水转发函数、多处 `if/elif` 分支 |
| `lib/jobs.js` | 948 | **建议拆分** | 尚未如 `lib/session/` 般模块化，参数校验、错误映射、队列状态机、落盘与长轮询混居 |
| `lib/kaggle-oauth.js` | 674 | **建议拆分** | `createKaggleLogin` 单函数约 390 行，耦合了 PKCE、本地回调 HTTP 服务、浏览器拉起与状态机 |
| `test/daemon-unit.py` | 3471 | **随远端重构分批拆解** | 当前直接读写 `daemon.STATE` / `daemon.BOOT` / `daemon.JOB_TABLE` 等全局属性 |
| `lib/session.js` | 961 | 暂不作为重点 | 核心协作者与纯逻辑已拆至 `lib/session/`（9 个子模块），当前主要是 `SessionManager` 编排层 |
| `remote/anima_runtime.py` | 1383 | 视节奏拆分 | 主体为 ComfyUI 直译 PyTorch 网络层；若拆分应按「网络模型 / 资产加载 / 运行时」三分，避免破坏上游对照 |
| `client.js` | 8566 | **无需改造** | 由 `node build.mjs` 从 `src/` 打包生成的构建产物；`src/` 本身已充分模块化 |

### 1.3 `remote/daemon.py` 的核心坏味道
1. **半模块化产生的胶水转发层**：`cache_ops.py` 与 `tunnel.py` 已抽为纯函数，但因为 `CONFIG` / `STATE` / `BOOT` 及锁仍是 `daemon.py` 顶层全局对象，`daemon.py` 不得不保留约 **25 个单行包装函数**（L966–L1079、L2228–L2376）手动绑定全局状态后转发调用。
2. **隐式全局状态与多锁混用**：`CONFIG`、`STATE`、`BOOT`、`JOB_QUEUE`、`JOB_TABLE`、`JOB_FINISHED_ORDER` 与 `STATE_LOCK`、`BOOT_LOCK`、`JOB_LOCK`、`GEN_LOCK` 分散在模块顶层，任何函数均可绕过边界直接读写状态。
3. **违反开闭原则（OCP）与局部重复**：
   - 模型 Loader 分支散落在 `SUPPORTED_LOADERS`、`SUPPORTED_IMG2IMG_LOADERS`、`build_pipeline`、`load_diffusers_pipeline`、`cache_ops.pipeline_repos`；
   - `apply_scheduler` 为 5 分支 `if/elif`；
   - `_stream_process` 与 `run_command_tail` 重复构造 pip 环境变量（`pipeline_loader.py` 已有 `pip_env()`）；
   - `short` / `_tunnel_short` / `_loader_short` 因全局命名空间冲突重复实现 3 份。
4. **`# @@INLINE` 文本拼接限制（已解除，留档）**：所有内联文件共享同一顶层命名空间，禁止 `from __future__ import annotations`，且无法支持子目录包与模块间自由相互导入。Batch 0 之后不再有此约束，`remote/` 可正常分层。
5. **契约边界仍有最后一份双写**：[`shared/contract.js`](../shared/contract.js) 已通过 [`tools/gen-contract-json.mjs`](../tools/gen-contract-json.mjs) 生成 `remote/contract.json`，但 `daemon.py` 仍维护了一份硬编码的 `_FALLBACK_LIMITS`。该文件现在已随源码包一起打进 Kernel（Batch 0），但**尚未被读取**——删除 `_FALLBACK_LIMITS` 会收紧"无注入契约"时的默认边界（64–2048 → 256–1536），属行为变更，安排在 Batch 2 与校验器单测一起改。
6. **测试用「替换模块级对象」模拟隔离**：`test/daemon-unit.py` 的基类在 `setUp` 里整体替换 `d.CONFIG` / `d.STATE` / `d.BOOT`（37 个测试类继承），另有 55 处 `mock.patch.object(d, <被内部调用的模块级函数>)`。这类断言对"函数改成持有实例"是**静默失效**而非报错（测到旧对象 → 假绿），所以测试迁移必须与模块搬迁同一批完成，不能靠兼容门面拖到下一批。

---

## 2. 远端目标架构（`remote/`）与设计模式

> 指导原则：把前端 `src/ → esbuild → client.js` 的工程化分层复制到远端：源码按**标准 Python 包 + 单向依赖分层**组织，打包层把部署形态（单文件）对业务代码完全透明化。

### 2.1 目标目录结构

```text
remote/
  __init__.py
  _entry.py                   # Kaggle 启动器模板（占位符由 lib/kernel.js 填充，不进源码包）
  contract.json               # 由 tools/gen-contract-json.mjs 生成，作为内置默认契约兜底
  text.py                     # short() 统一实现（合并 cache_ops/_tunnel_short/_loader_short 三份重复）
  app.py                      # Composition Root：读取配置、组装服务实例、安装信号、主循环与看门狗
  config.py                   # DaemonConfig 与 ContractLimits 解析（启动期构造一次）
  state.py                    # RuntimeStateStore / BootStateStore（锁与状态封装在同一边界内）
  observability/
    log_ring.py               # LogRing + StreamTee（日志环、控制台镜像与密钥脱敏）
    health.py                 # HealthSnapshotAssembler（汇总状态、依赖版本、显存快照）
  infra/
    process.py                # 子进程流式执行 + pip 约束合并、安装与 import 自检
    ntfy.py                   # NtfyClient（会合通知与重试策略）
    tunnel.py                 # TunnelProvider 策略（Cloudflare / Custom）与 TunnelSupervisor
    cache.py                  # CacheManager（磁盘预检、LRU 驱逐、预挂载目录解析）
  inference/
    registry.py               # LoaderRegistry（Strategy + Registry，注册表驱动）
    scheduler.py              # 表驱动调度器工厂（配置映射替代 if/elif）
    loaders/
      diffusers.py            # SDXL / SDXL-LoRA / Flux2 Loader 策略实现
      anima.py                # Anima Loader 适配层
    anima/                    # 原 anima_runtime.py 的拆分：model.py / loader.py / runtime.py
    pipeline_manager.py       # PipelineManager（底座缓存、from_pipe 惰性复用、显存释放）
    reference_codec.py        # ReferenceCodec（提交期读头校验 + 执行期一次性解码缩放）
    executor.py               # run_task / run_tasks / _encode_png / _sync_cuda（解码与推理执行）
  jobs/
    models.py                 # Job 实体与领域异常（RequestError / LoadError / QueueFullError）
    store.py                  # JobStore（独占 JOB_LOCK/JOB_COND、入队幂等、TTL/FIFO 淘汰）
    runner.py                 # JobRunner & WorkerLoop（串行取单、执行、错误分类与 OOM 清理）
  transport/
    http_server.py            # DaemonHandler（纯 HTTP 路由、Bearer 鉴权、异常→状态码映射）
    validator.py              # GenerateRequestValidator（校验请求体与生成参数，消费 ContractLimits）
  verify_cli.py               # 原 tools/payload/verify-model.py 入口，复用同包 Loader 与 Runtime
```

> 与初版相比新增 `text.py` 与 `inference/executor.py`：审计发现 `short()` 有 4 份实现、`run_task`/`run_tasks` 在目标结构里无处安放，硬塞进 `pipeline_manager` 会把"管线生命周期"和"单次推理"混在一起。
>
> 落地进度（Batch 2 切片⑥ 之后）：`config` / `state` / `observability/health` / `infra/process` / `infra/cache` / `transport/{validator,http_server}` / `inference/reference_codec` / `jobs/*` / `app` 已就位；`observability/log_ring.py`（现为 `remote/log_ring.py`）、`infra/{tunnel,ntfy}.py`、`inference/{registry,scheduler,pipeline_manager,executor}.py`、`inference/loaders/`、`inference/anima/`、`verify_cli.py` 仍待推进，顺序与理由见 §4.1。

### 2.2 模块导入约定（审计结论）
远端包内**统一用绝对包导入**（`from remote.state import ...`），不用相对导入。原因：`test/daemon-unit.py` 用 `spec_from_file_location` 以任意模块名按路径加载 `daemon.py`，模块没有父包，`from .x import y` 会直接 `ImportError: no known parent package`；绝对导入只要求仓库根在 `sys.path`（启动器与测试都已满足），搬家后不需要再改加载方式。Batch 3 若把加载方式改成 `import remote.daemon`，可再统一转相对导入（非必须）。

### 2.3 核心设计模式与约束

1. **Composition Root + 显式依赖注入（消除胶水包装层）**
   - `app.py` 作为唯一组装点，构建 `config`、`log_ring`、`state_store`、`boot_store`、`cache_manager`、`pipeline_manager`、`job_store`、`tunnel_supervisor`，再注入各自协作者。
   - 协作者通过构造函数持有依赖，**彻底删除 `daemon.py` 中 ~25 个仅用于把全局参数塞给纯函数的转发包装器**。
2. **Encapsulated State Store（锁与数据同笼）**
   - `RuntimeStateStore`、`BootStateStore`、`JobStore` 内部私有持有各自 `RLock`/`Condition` 与可变字段。
   - 外部只能调用语义方法（如 `set_phase()`、`record_error()`、`submit()`）或读取只读快照（`snapshot()`），从结构上杜绝未加锁访问与锁顺序混乱。
3. **Strategy + Registry（模型加载与调度器符合开闭原则）**
   - 每个模型家族实现统一的 `ModelLoader` 协议（声明 `name`、`supports_img2img`、`required_repos(spec)`、`load(spec, cache, log)`）。
   - `LoaderRegistry` 统一提供校验白名单、缓存 `keep_set` 推导与管线构建；新增模型只需新增 Loader 模块并注册，不再散改多处 `if/elif`。
   - `scheduler.py` 使用配置映射表代替多分支 `if/elif`。
4. **Repository + Worker 分离（任务队列与推理执行解耦）**
   - `JobStore` 只管状态存储、幂等查重与容量/TTL 淘汰；`JobRunner` 只管持 `GEN_LOCK` 调解码与推理；`http_server.py` 只管 HTTP 编解码与异常映射。

### 2.4 打包器升级（Batch 0，已完成）
- **落地形态**：`lib/bundle.js` 用 `node:zlib` 的 `deflateRaw` + 手写 ZIP 头产出**确定性归档**（路径排序、时间戳固定为 2020-01-01、权限 0644），`lib/kernel.js` 把它 Base64 内嵌进 `remote/_entry.py` 模板；启动器解压到临时目录、把包根与 `remote/` 挂进 `sys.path`，再调用包内入口。
- **为什么不用 `zipimport`**：解压后 `__file__` 指向真实文件，Kaggle 日志里的栈可以直接对应源码行，`contract.json` 也能按普通文件读；解压 30 个文件的开销可忽略。
- **配置注入改为函数调用**：启动器不再做源码文本替换，而是调 `入口模块.set_embedded_config(b64)`。这样 `load_config` 后续搬进 `config.py` 时，只要入口模块 re-export 这个函数，注入链路自动跟着走（直接赋值模块属性会在搬家后静默丢配置）。**Batch 2 切片③ 落地时的实际口径**：注入串 `EMBEDDED_CONFIG_B64` 与 `set_embedded_config()` 留在 `daemon.py`，只把「解析 → 原地回填 `CONFIG`」搬进 `config.py`——因为 `test/kernel-package.mjs` 用 `daemon.EMBEDDED_CONFIG_B64` 验证注入是否落到底层，变量若跟着实现搬走会让这条观测链断掉。
- **契约入包**：`remote/contract.json` 已随源码包打进 Kernel。但 `_FALLBACK_LIMITS` **尚未删除**，见 §1.3 第 5 条（改动会收紧无注入契约时的默认边界，安排到 Batch 2 与校验器单测同批做）。
- **两种打包模式**：默认归档模式；传 `sourcePath` 时退化为"单文件脚本 + 只注入配置"，供真机探针（`test/tunnel-probe.py`）使用。
- **共用打包器**：`tools/verify-model.mjs` 用 `entryModule: 'payload.verify_model'` + `extraFiles` 把验证 payload 作为包内模块一起打进归档，与 `lib/session/provisioner.js` 共用 `buildKernelFolder`。
- **包发布清单**：`package.json` 的 `files` 已扩到 `remote/**/*.py` 与 `remote/contract.json`；`scripts/package.mjs` 的 `remote` 目录过滤同步放行 `.json`，并把 `_entry.py` / `__init__.py` / `contract.json` 列入必需文件。
- **验收**：`test/kernel-package.mjs` 16 项（含 CRC 标准向量、确定性、Python `zipfile.testzip()`、解包后 `import remote.daemon`、模板占位符唯一性、脚本模式）；`test/check-verify-model.mjs` 7 项。真机 `kaggle-live` / `gpu-live` 尚未在本批复跑（`remote/daemon.py` 业务逻辑零改动，仅移除内联标记）。

---

## 3. Host 侧对齐改造规范（Node.js）

> **状态：✅ 已完成（Batch 1）**。沿用已验证稳定的 `lib/session/` 拆分范式，收口剩余两个高体量单文件；外部继续保留原路径导出作为门面，导出名、函数签名、默认参数与日志 `scope` 全部不变，调用方零改动。

### 3.1 `lib/jobs.js`（948 行）→ `lib/jobs/`
- `lib/jobs/validator.js`（124 行）：任务参数钳制、`normalizeStrength`、`normalizeReference` 词法/魔数校验；
- `lib/jobs/errors.js`（64 行）：`JobCancelled`、`isCancellation`、`describeJobError` 错误归因表；
- `lib/jobs/reference-loader.js`（55 行）：工作区 `imagen-output/` 作品路径安全读取与 base64 编码；
- `lib/jobs/queue.js`（765 行）：`JobQueue` 队列状态机、串口执行、取消、产物持久化与 `waitFor` 长轮询通知；
- `lib/jobs.js`（16 行）：薄门面，聚合 re-export 保持对外导入路径不变。

### 3.2 `lib/kaggle-oauth.js`（674 行）→ `lib/kaggle/oauth/`
- `lib/kaggle/oauth/pkce.js`（104 行）：`quotePlus`、`codeChallengeOf`、`buildPkcePair`、`buildAuthorizeUrl`、`extractAuthorizationCode`；
- `lib/kaggle/oauth/browser.js`（83 行）：`canOpenBrowser`、`browserCommand`、`createDefaultBrowserOpener`；
- `lib/kaggle/oauth/callback-server.js`（153 行）：一次性 `127.0.0.1:8000~9000` 回环回调接收与超时销毁；
- `lib/kaggle/oauth/session.js`（414 行）：`createKaggleLogin` 登录状态机与令牌交换编排；
- `lib/kaggle/oauth/text.js`（22 行）：日志脱敏用小工具（拆分时发现 `sanitizeMessage` / `nonEmptyString` 被 pkce 与 session 共用，单列避免循环依赖）；
- `lib/kaggle-oauth.js`（23 行）：薄门面聚合导出。

> `JobQueue` 仍是 765 行的单类。它是「串行队列 + 长轮询 + 落盘」三件事的状态机，再往下拆需要引入显式状态对象（`queued → running → done/failed/cancelled` 的迁移表），属于下一轮独立重构，不在本轮范围。

---

## 4. 分批渐进式迭代路线

为保证每一批改造都可独立合并、可随时跑全量回归，严禁一次性大爆炸重写。

> **顺序修正（2026-11-15）**：初版把「远端包化」排在「打包器升级」之前，两者互相矛盾——`remote/jobs/store.py`、`remote/inference/loaders/diffusers.py` 这类子目录包无法用 `# @@INLINE` 的全文拼接表达（拼接只共享一个顶层命名空间），Batch 1 若按初版执行只能退化成"平铺模块 + 拼接种"，等于白搬一次。因此把打包器升级提到最前（Batch 0），远端包化顺延（Batch 2），并把原 Batch 3「测试领域化」合并进来——原因是 `daemon.py` 的薄兼容门面与封装式 Store 语义互斥：单测通过整体替换 `d.STATE` / `d.CONFIG` 模拟隔离，门面一旦把状态搬进实例，这类断言会静默测到旧对象（假绿），必须与模块搬迁同批改。

| 批次 | 核心目标 | 状态与验收 |
| :--- | :--- | :--- |
| **Batch 0**<br/>打包器升级 | `lib/kernel.js` 改为内嵌 Base64 ZIP 自引导；配置注入改为 `set_embedded_config()` 函数调用；`remote/contract.json` 随包分发；`verify-model` 复用同一打包器；`package.json` `files` 与 `scripts/package.mjs` 同步 | ✅ **已完成**。`test/kernel-package.mjs` 16 项（含 Python `zipfile` 校验与解包后 `import remote.daemon`）、`test/check-verify-model.mjs` 7 项；`@@INLINE` 已从源码移除 |
| **Batch 1**<br/>Host 侧收口 | `lib/jobs.js`（948 行）→ `lib/jobs/`；`lib/kaggle-oauth.js`（674 行）→ `lib/kaggle/oauth/`；原路径保留聚合门面 | ✅ **已完成**。门面 16 / 23 行，实现分散到 5 + 5 个模块；`jobs-wait` 23 项、`kaggle-oauth` 14 项、`host-e2e` 46 项、`host-log(-events)` 20 项全绿 |
| **Batch 2**<br/>远端包化 + 测试领域化<br/>（原 Batch 1 + 3） | 按 §2.1 建包：`config` / `state` / `observability` / `infra` / `inference` / `jobs` / `transport` / `app`；删掉 25 个胶水转发；`LoaderRegistry` + 表驱动调度器；`JobStore` 封装锁；同步把 `test/daemon-unit.py` 按领域拆到 `test/remote/test_*.py`，改用实例化隔离 | ⏳ **进行中**，按域切片推进（每片独立可回归）：<br/>① `errors.py` + `transport/validator.py` + `inference/reference_codec.py` ✅（纯逻辑三模块，边界由 `limits_for` 注入，daemon 只留同名薄包装）；<br/>② `pipeline_loader` 调度器表驱动 ✅（5 条配方收成 `_SCHEDULER_RECIPES`，新增调度器只加一行）；<br/>③ `config.py` / `state.py`（单例对象原地更新，不重新绑定，避免测试静默测到旧对象） ✅（`DaemonConfig` + 注入解析 + 契约边界进 `remote/config.py`，`RuntimeState` / `BootState` / 两把状态锁 + `set_phase` / `record_error` 进 `remote/state.py`；daemon 只 re-export，2366 → 2121 行（−245），单测 248 → 252 项并新增单例身份守卫）；<br/>④ `infra/process.py` + `observability/health.py` ✅（流式执行与一次性命令共用 `pipeline_loader.pip_env()`，`IMPORT_CHECK_CODE` 由模块清单生成；`/health` 拆成「持锁取样 → 释放 → 取队列深度」，`build_payload` 签名里没有任何锁，锁顺序由结构保证）；<br/>⑤ `jobs/`（store + runner，`JOB_*` 全局收进 JobStore）✅（`models.py` 放实体与失败分类，`store.py` 独占 `JOB_LOCK`/`JOB_COND` 并提供语义方法，`runner.py` 只做「取单 → 调注入的执行函数 → 收尾」；daemon 只剩薄包装与 `execute_job`，锁顺序以 `JOB_STORE.finish()` 返回后再取 `STATE_LOCK` 固定）；<br/>⑥ `transport/http_server.py` + `app.py`（Composition Root），最后删门面并把 `test/daemon-unit.py` 按域拆分 ✅（本片按 §4.1 拆成 ⑥a–⑥f 六小片推进：⑥a / ⑥b 已落地，⑥c–⑥f 待做） |
| **Batch 3**<br/>契约收口与真机验证 | 删除 `_FALLBACK_LIMITS`，让无注入契约时消费内置 `contract.json`（行为变更：默认边界从 64–2048 收紧到 256–1536）；移除 `daemon.py` 门面；回填文档与 `CHANGELOG` | ⏳ 待开始。**必带项**：`test/mock-daemon.py` 的 limits 夹具当前与 `_FALLBACK_LIMITS` 同值（64–2048），删兜底后要同步改成契约值（256–1536），否则 mock 与真 daemon 的边界会静默漂移；建议同时加一条守卫测试。验收：`npm test` + `contract:check` 全绿，且**必须**跑一次真机 `kaggle-live` 与 `gpu-live`（这是唯一能验证启动器解包链路的关口） |

---

### 4.1 Batch 2 切片⑥ 的拆分与剩余施工顺序（2026-11-15 实测结论）

规格原文把 ⑥ 写成一件事：`transport/http_server.py` + `app.py` + 删门面 + 测试按域拆分。
实测**不能一次做完**——门面的调用面（25 个薄包装）恰好就是三个尚未收口的领域对象；
"删包装"要先把它们收成实例，否则只是把全局换个名字（§6.2）。因此 ⑥ 拆成六小片，
每片独立可回归：

| 片 | 内容 | 状态 |
| :--- | :--- | :--- |
| ⑥a | `transport/http_server.py`：`DaemonHandler` + `HttpApi` + `start_server` | ✅ 已落地 |
| ⑥b | `app.py`：`DaemonApp`（启动顺序 / 信号 / 退出清理 / 空闲看门狗） | ✅ 已落地 |
| ⑥c | `infra/cache.py`：`CacheManager`（磁盘预检、LRU 驱逐、预挂载目录解析） | ✅ 已落地 |
| ⑥d | `infra/tunnel.py`：`TunnelSupervisor`（注入 `phase_setter` / `ready_publisher`） | ⏳ 待做（施工提示见下） |
| ⑥e | `inference/registry.py`：`LoaderRegistry`（Strategy + 注册表，替代 loader 分支） | ⏳ 待做 |
| ⑥f | 删 `daemon.py` 门面 + `test/daemon-unit.py` 按域拆到 `test/remote/` | ⏳ 与 Batch 3 合并 |

**⑥c / ⑥d / ⑥e 不是 ⑥a / ⑥b 的前置**：HTTP 与生命周期只通过语义入口
（`get_job` / `submit_job` / `queue_depth` / `tunnel_monitor` / `ensure_pipeline`）与领域对象
打交道，不碰三者的内部包装；三者收口要改的是 daemon **内部的调用图**与 8 处
`mock.patch.object(d, ...)` 的替换点，与 ⑥a / ⑥b 的文件边界正交。

**但不能跳过 ⑥c / ⑥d 直接删门面**：`ensure_pipeline → ensure_cache_capacity →
evict_cache_for` 与 `tunnel_monitor → announce → recover → set_phase/publish_ready`
这两个隐式环（§6.2）正是包装层存在的原因。回调注入没建立起来之前删包装，等于把
"隐式依赖"从注释里挪到构造函数外。

**为什么 ⑥c / ⑥d 必须连测试一起改**：`ensure_disk_capacity` / `ensure_cache_capacity` /
`evict_cache_for` / `disk_precheck` / `start_tunnel` / `ensure_cloudflared` /
`_spawn_tunnel_process` / `tunnel_wait_exit` 这 8 个名字都被 `mock.patch.object(d, ...)`
替换后断言"内部调用命中了替换"。收成实例方法后，替换只会改到 daemon 的同名影子属性，
内部调用走 `self.xxx` —— 断言仍在跑、仍绿，但测的是旧实现（§1.3.6 的静默假绿）。
⑥c 已按此口径把 4 个缓存替换点改成 `d.CACHE.<方法>`（共 14 处调用/替换），⑥d 的 4 个
隧道替换点同样处理。

**⑥e 与 §5.7 的关系**：`LoaderRegistry` 要合并 `SUPPORTED_LOADERS` /
`SUPPORTED_IMG2IMG_LOADERS` / `build_pipeline` / `load_diffusers_pipeline` /
`cache_ops.pipeline_repos` 五处分支，会改 `LoadError` 文案（直接进 UI 与 Host 分支），
属行为变更，必须单独一片并连带改断言。

**⑥c 落地记（2026-11-15）**：`CacheManager` 建在 `remote/infra/cache.py`（180 行），把
daemon 的 13 个包装收成实例方法，daemon 只留同名别名（Batch 3 删）。三处细节留档：

1. **纯函数仍留在 `remote/cache_ops.py`**：`scripts/package.mjs` 与
   `test/kernel-package.mjs` 按文件名把 `remote/cache_ops.py` 列入必需项，折进
   `infra/cache.py` 必须同批改打包清单（与 `log_ring → observability/` 一起做）；
   本切片只解决"谁持有配置与错误类型"。
2. **探针标志从模块级 global 收进实例**：删掉 `_CACHE_PROBE_DONE`，改为
   `CACHE.log_probe_once()` / `CACHE.reset_probe()`。影子全局被重绑定后行为不变，属
   §1.3.6 的假绿形态；现在"只打一次"只有一个入口。
3. **14 处测试替换点同批迁移**：`disk_precheck` / `mount_point_of` / `probe_free_gib` /
   `read_mount_points` / `evict_cache_for` / `resolve_local_model` /
   `resolve_local_weight` / `ensure_disk_capacity` / `ensure_cache_capacity` 的替换目标
   全部改为 `d.CACHE.<同名方法>`；新增 4 项边界用例（`CACHE` 是唯一持有者、daemon 不再
   定义这些包装、闸门替换命中实例、探针只打一次），单测 272 → 276。

**⑥d 施工提示（尚未开工，先定这两件事）**：

1. **二进制常量要收成设置对象**：`CloudflaredDownloadTest` 现在是 patch
   `d.CLOUDFLARED_PATH` / `_DOWNLOAD_URL` / `_SHA256` / `_MAX_DOWNLOAD_BYTES`，再调
   `d.ensure_cloudflared()`。如果 `TunnelSupervisor` 在构造时把常量**拷贝**成实例字段，
   这 4 个替换点会失效（测试会红，但连带要改 8 处）。建议构造时传一个
   `TunnelBinary(path=…, url=…, sha256=…, max_bytes=…, timeout_sec=…, attempts=…)`，
   测试替换 `d.TUNNEL.binary`（或其中的字段），语义比 patch 模块常量清楚得多。
2. **ready 发布留在类外**：`publish_ready` / `ntfy_publish` 属会合通知（目标结构里的
   `infra/ntfy.py`），`TunnelSupervisor` 只接收 `publish_fn` / `set_phase_fn` /
   `fail_boot_fn` 三个回调，别把 ntfy 的重试策略混进隧道生命周期。

**切片⑥ 落地时的两处权衡（留档）**：

1. **`/health` 的取样留在 `daemon.py`**：它拥有锁顺序（持 `STATE_LOCK` 取快照 → 释放 →
   取 `queue_depth`），而 `test/daemon-unit.py` 的 `HealthLockOrderTest` 是按
   `mock.patch.object(d, "STATE_LOCK")` + `mock.patch.object(d, "queue_depth")` 观察
   顺序的。搬进 `transport/` 后这两个替换点会静默失效，所以只有路由搬走、取样留原处，
   由 `HttpApi.health_payload` 作为回调注入。
2. **装配点暂留 `daemon.py` 末尾**：`DaemonApp` 的构造函数（依赖清单）在 `app.py`，
   实例化在入口模块——因为启动器按 `daemon.main` / `daemon.set_embedded_config` 取符号，
   `test/kernel-package.mjs` 又按 `daemon.EMBEDDED_CONFIG_B64` 验证注入落地（§5.5）。
   Batch 3 移除门面时这三件事一起搬，`app.py` 才能真正成为唯一的 Composition Root。

---

## 5. 演进约束与不可妥协项

1. **打包后顶层仍不早引重库**：`remote/app.py` 入口在完成引导解压/加载及配置读取、启动 HTTP 服务与安装依赖之前，不得在模块顶层 `import torch / diffusers / PIL`。
2. **敏感信息零泄露**：任何拆分后的模块日志器均不得打印 `auth_token`、`hf_token` 或带 token 的文件路径；错误上报维持 `redact` / `short()` 脱敏口径。
3. **契约单一真源**：禁止在拆分过程中重新引入硬编码的尺寸/步数/强度边界；远端默认兜底统一消费生成的 `remote/contract.json`。
4. **每次 Batch 结束必须完整验证**：任一批次均需保证 `npm test` 与 `npm run contract:check` 全绿后方可封板进入下一批；涉及远端引导链路的批次须在发布前完成一次真机 `kaggle-live` / `gpu-live` 验证。
5. **配置注入只能走函数**：启动器调用 `set_embedded_config()`，禁止改回"赋值模块属性"。搬迁 `load_config` 时必须让入口模块继续 re-export 该函数，否则 Kernel 会以空配置启动并 `fail_boot('unauthorized')`（不会报错，只会"莫名连不上"）。
6. **远端包内统一绝对包导入**（`from remote.state import ...`），不用相对导入：`test/daemon-unit.py` 以任意模块名按路径加载 `daemon.py`，模块无父包，`from .x import y` 会 `ImportError: no known parent package`。
7. **搬迁不等于顺手合并**：`short()` 现有 4 份实现、`HF_REPO_RE` 与 `_VALID_HF_REPO_RE` 各一份、`pip_env()` 已存在但被绕过。合并会改错误文案（`LoadError` 的消息直接进 UI 与 Host 分支），属行为变更，必须单独一批并连带改断言。
8. **锁顺序唯一方向**：`JOB_LOCK → STATE_LOCK`。`_finish_job` / `execute_job` 已按此顺序取锁；`health_payload` 必须在释放 `STATE_LOCK` 之后再调 `queue_depth()`，否则反向嵌套会死锁。
9. **状态对象保持可动态挂属性**：现有单测会写 `STATE.waiting` / `STATE.loaded`，`RuntimeState` / `BootState` 不要加 `__slots__`；`/health` 的 `queue_depth` 必须来自 JobStore 而不是状态对象。

---

## 6. 远端迁移审计结论（Batch 2 的施工图）

完整审计（全局状态 14 项、胶水转发 25 个、职责→符号映射 20 个目标文件、测试耦合 39 个测试类、搬迁地雷 12 条）在 Batch 2 开工前重新生成，不落库以免与代码漂移。这里只留三条结论性判断：

1. **测试是这次重构的真正约束，不是 daemon.py**：37 个测试类在 `setUp` 里整体替换 `d.CONFIG/STATE/BOOT`，55 处 `patcher` 打的是"被内部调用的模块级函数"。搬到实例后这些断言**不报错**，只会测到旧对象。所以 Batch 2 的正确切法是"按域搬 + 同域改测试"，而不是先搬完再统一改。
2. **`ensure_pipeline → ensure_cache_capacity → evict_cache_for/anima_local_assets` 与 `tunnel_monitor → announce → recover → set_phase/publish_ready` 是两个隐式调用环**，也是"胶水层"存在的原因。消除它们要靠构造函数注入回调（`CacheManager` 持 `local_models` 解析器，`TunnelSupervisor` 持 `phase_setter` / `ready_publisher`），而不是把全局换个名字。
3. **`anima_runtime.py`（1383 行）只移动、不重写**：它是 ComfyUI 的直译网络层，拆错会破坏与上游的逐行对照。`remote/inference/anima/` 在 Batch 2 只做目录归位，内部三分（model/loader/runtime）单列 Backlog。
