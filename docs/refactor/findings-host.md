# 宿主端诊断报告（index.js + lib/*.js）

- 分析对象：本仓库当前工作树（git 状态干净），仅宿主端。
- 方法：逐文件通读 + 静态统计（pwsh `Select-String` / `[regex]::Matches`）；未执行 `npm test`、未运行构建、未修改源码。
- 行号以当前文件实际内容为准（任务单里的行数与实测有小幅出入：index.js 实为 570 行、lib 合计 2670 行）。
- `src/` 仅用于"是否存在对应物"的对照，`remote/`、`test/` 只读到能判断"能否当安全网"为止。

---

## 1. 区域清单与量化

### 1.1 文件与职责

| 文件 | 行数 | 声明职责 | 实际承担 | 单一职责 |
| :--- | ---: | :--- | :--- | :--- |
| `index.js` | 570 | 插件装配、SPEC 记录的 14 条路由、3 个工具 | 装配 + **15** 条路由（`/jobs` 未进 SPEC）+ 3 个工具 + 状态聚合 + probe 缓存 + 模型可见文案（`describeJob`/`describeSession`）+ 唤起文件管理器 + 删除循环 | ✗（6 类，见 §1.2） |
| `lib/session.js` | 703 | 远端会话生命周期 | 状态机、启动编排、ntfy 会合解析、健康轮询、掉线恢复决策、Kernel 状态轮询、临时目录清理、代次（epoch）失效、关机通知、等待原语、用户文案 | ✗（10 类） |
| `lib/jobs.js` | 287 | 串行任务队列 | 入参校验、队列、任务状态机、会话等待、远端载荷构造、落盘调度、错误归因、对外字段投影 | ✗（6 类，但边界比上两者清楚） |
| `lib/kaggle.js` | 307 | kaggle CLI 适配 | CLI 运行、鉴权/配额/用户名探测、push/status/logs 包装、4 个输出解析/判定函数 | △（适配层内聚，解析器可拆） |
| `lib/enhance.js` | 197 | 提示词润色 | 提示词 + 模型调用管道 + 结果归一 + 本地兜底 | △（模型调用管道与 intent.js 重复） |
| `lib/intent.js` | 163 | 意图解析 | 同上，只是提示词与归一不同 | △（同上） |
| `lib/output.js` | 167 | 落盘、meta、历史扫描 | 落盘 + meta.json + 历史扫描 + 预览 URL | △（3 件相关事，可接受） |
| `lib/library.js` | 161 | 收藏/删除持久化 | 原子写 + 串行化 + 损坏备份 + 增删 | ✓（全仓最完整的一层） |
| `lib/presets.js` | 151 | 预设唯一数据源 | 数据 + 对外投影 `publicPresets` | ✓ |
| `lib/remote.js` | 142 | 远端 daemon HTTP 客户端 | health/generate/shutdown/logs + 端点可信校验 | △（不是唯一远端出口，见 2.2-6） |
| `lib/net.js` | 111 | fetch→curl 降级 | 两套通道 + 状态码还原 | ✓ |
| `lib/paths.js` | 94 | 路径解析与越界防护 | 工作区根、相对路径、真实路径包含性校验、content-type | ✓ |
| `lib/kernel.js` | 80 | 临时 Kernel 目录 | 目录构建 + 配置注入 + 清理 | ✓ |
| `lib/http.js` | 65 | HTTP 小工具 | JSON 响应、错误信封、读体 | ✓（`errorShape` 未被使用） |
| `lib/json.js` | 42 | 从模型输出抽 JSON | 花括号配对扫描 | ✓ |

合计 **3240 行**（index 570 + lib 2670）。分层是干净的：lib 内部 import 图无环（详见 §2.2-6）。

### 1.2 三个单体的量化

| 指标 | `apply()`（index.js:101-570） | `SessionManager`（session.js） | `JobQueue`（jobs.js） |
| :--- | :--- | :--- | :--- |
| 行数 | **470** 行单函数 | 703 行 / 25 个成员（含 2 个 getter） | 287 行 / 10 个成员 |
| 注册/入口 | 16 次 `ctx.effect`（15 路由 + 1 清理）、3 次 `tools.register` | 构造器 40 行（14 个 option + 14 个可变字段） | 构造器 15 行 |
| 重复样板 | 15 次 `if (req.method !== …)`、7 次 `readJsonBody`、13 次 `sendError` | 8 处手写 `isStale(epoch)` 校验 | 2 份手写 clamp + 13 字段手抄投影 |
| 分支/长度热点 | 路由区间 172-454 共 283 行（≈19 行/条） | `_start` 107 行、`pollTunnel` 91 行、`pollHealth` 88 行、`handleReadyHealthLoss` 47 行 | `runNext` 99 行、`submit` 47 行 |
| 静默容错点 | 7 | **15** | 0 |

补充数据：`apply()` 闭包内同时存活着 6 个可变对象（`cache`、`session`、`queue`、`probes`、`toolParameters`、`textOutput`），全部以闭包共享方式被 15 个 handler 引用。

### 1.3 其他量化指标

| 指标 | 数量 | 口径 |
| :--- | ---: | :--- |
| 注册路由 | 15 | SPEC 只写了 14 条，`/imagen-api/jobs` 未进文档（§2.4-7） |
| 静默吞错点 | **53** | 31 个空 `catch {}` + 6 个 `.catch(() => {})` + 16 个 `.catch(() => null)`（session 15 / index 7 / library 5 / enhance 4 / intent 4 / paths 4 / remote 4 / output 3 / kaggle 3 / http·json·kernel·net 各 1） |
| 日志调用 | **0** | 3240 行宿主代码内 `console.*` / `ctx.logger` 命中数为 0 |
| 硬编码中文用户可见文案 | 122 行 | index 31、session 29、jobs 18、enhance 12、intent 10、kaggle 8、presets 5、remote 4、http 3、kernel 1、library 1（对照：客户端 `src/dict/zh.js` 236 条） |
| 命名常量以外的裸数字（超时/上限） | 30+ | 8 个文件：session 10、kaggle 9、remote 6、net 4、jobs 3、index 4、http 1、library 1 |
| lib 导出中无外部使用者的 | 7 | `localGroups`、`errorShape`、`copyMockDaemon`、`httpJson`、`fileUrl`、`toAbsolute`、`requestLogs` |
| 错误码 | 宿主发出 24 个 / 客户端字典 24 条 / 交集外各 6 条 | §2.4-4 |

---

## 2. 问题证据

分级：P0＝会直接导致缺陷或使重构无法推进；P1＝显著增加改动成本/认知负担；P2＝整洁度。

### 2.1 过度防御

- [P0] (2.1-1) **契约没有机器可校验的单一来源，文档这一个"真理源"自身已经漂移** —— `docs/SPEC.md:3` 自称"唯一规格真理源"，但至少 6 处与代码不符（明细见 §2.4-6）；同一份契约在代码里另有至少 4 处实体：`lib/jobs.js:113-135`（权威校验）、`index.js:458-481`（工具 JSON Schema）、`src/logic/generate.js:27-38`（客户端请求体）、`tools/preview.mjs:168-232`（预览 mock）。因此任何重构都无法判断"改完是否还符合契约"，这是"改一处漏三处"的根因。

- [P1] (2.1-2) **同一超时在三个文件各有一份默认值，而生效值覆盖了远端层判断** —— `lib/remote.js:16-17` 注释写明"首次生成可能要现下 6.6GB 权重，300s 不够"，因此该层给 600000；但 `index.js:126` 始终传入 `toInt(config.generateTimeoutSeconds, 300, 30, 1800) * 1000`＝**300000**，`lib/jobs.js:56` 的 600000 只对测试生效。同名值三处默认、两种语义，实际生效的是被注释否定的那个。

  ```js
  // lib/remote.js:16-17
  // 首次生成可能要现下 6.6GB 权重，300s 不够；有 preload 时通常几秒返回。
  const GENERATE_TIMEOUT_MS = 600000
  // index.js:126（永远覆盖上面这层）
  generateTimeoutMs: toInt(config.generateTimeoutSeconds, 300, 30, 1800) * 1000,
  ```

- [P1] (2.1-3) **轮询定时器把所有异常吞成空操作，故障既不改状态也不留痕** —— `lib/session.js:158-166` 的 `every()` 用 `.catch(() => {})` 包住每一次轮询；`pollTunnel`/`pollHealth` 内部还有 5 处空 `catch {}`。后果：轮询逻辑一旦抛错（字段改名、远端协议漂移、代码 bug），会话会**永久停在当前状态**，界面上表现为"在线但每张图都失败"，而没有任何日志可以定位。与 §1.3 的零日志叠加后，这是本次诊断中最接近 P0 的隐患（因暂未拿到真实故障复现，保守定为 P1）。

  ```js
  // lib/session.js:158-163
  every(fn, ms) {
    const id = setInterval(() => { Promise.resolve().then(fn).catch(() => {}) }, ms)
  ```

- [P1] (2.1-4) **健康检查把"任何异常"等价为"一次网络抖动"** —— `lib/session.js:473-475`：`fetchHealth` 抛错（含代码 bug、JSON 结构变化、鉴权失败）一律走 `healthMisses += 1`；ready 态下满 3 次就进入恢复决策（`session.js:479-484`），非 ready 态下满 5 次则清空 `endpointUrl`、回到 `connecting` 并重建定时器（`session.js:499-511`），后续只能靠会合超时或隧道超时收敛为 `health_failed`/`tunnel_timeout`。真实原因在归因链上被三层 `.catch(() => null)`（`session.js:565`、`610`、`618`）继续过滤，最终用户看到的是"隧道失联"。

- [P1] (2.1-5) **同一个参数在三层各钳一次，且策略不一致** —— `waitSeconds`：路由 `index.js:244` 取 `Number(...)||0` → 工具 `index.js:503` `toInt(...,90,0,600)` → `lib/jobs.js:273` 再 `Math.min(600,...)`；`locale`：`index.js:398`/`423` 归一后 `lib/enhance.js:182`/`lib/intent.js:154` 再归一；`previousPrompt`：`index.js:422` 过滤后 `intent.js:155` 再过滤一次。三层都不知道另外两层已经做过，任何一层改边界都会静默改语义。

- [P1] (2.1-6) **数值边界有 4 份副本** —— `index.js:470-475`（工具描述文本"宽度 256-1536 / 1-60 / 0-20 / 1-4"）、`lib/jobs.js:33-38`+`131-134`（`normalizeDimension`/`clampInt`/`clampNumber`）、`src/logic/clamp.js:3-19`、`docs/SPEC.md:117-121`。四份当前一致，但没有任何机制保证一致。

- [P1] (2.1-7) **请求体解析策略不一致：6 条路由吞错、1 条路由报错** —— `index.js:206`、`342`、`359`、`396`、`416`、`440` 用 `readJsonBody(req).catch(() => ({}))` / `catch(() => null)`，非法 JSON 会被当成空对象继续走；只有 `/generate`（`index.js:236-241`）返回 `400 invalid_body`。同样一个坏请求，`/generate` 报错、`/enhance` 返回 200 并给本地建议。

- [P1] (2.1-8) **probe 的兜底会把探测代码的 bug 伪装成"环境检查未通过"** —— `index.js:152-161`：`catch` 里手工拼一个 `probe`，`errorCode: 'unknown'`、`notes: [message.slice(0,300)]`。真实异常（例如 `probeKaggle` 内部字段改名）只会表现为界面上一句截断的话。

- [P2] (2.1-9) **防御性类型自检到"句柄可能不存在"，但 `spawn` 失败实际上是抛异常** —— `index.js:65`：`handle && typeof handle.done?.then === 'function' ? … : Promise.resolve(null)`。这层兜底让"spawn 返回异常形状"静默变成"没有退出码"，也无法在测试里暴露。

- [P2] (2.1-10) **空值兜底密度过高** —— `lib/session.js` 内 `??` 23 次 + `?.` 31 次；`lib/output.js` `??` 24 次；`typeof x === 'object'` 守卫 6 处（`http.js:52`、`remote.js:74`、`library.js:44`、`output.js:129`、`enhance.js:76`、`intent.js:47`）。其中多数是必要的（远端不可信），但缺少"边界校验一次、内部直接信任"的分层，导致每层都要重判。

- [P2] (2.1-11) **用 try/catch 探测可选宿主服务** —— `lib/enhance.js:109-125`、`lib/intent.js:82-98` 各写一遍"试 `ctx.get('llm')`、失败当没有"；`kaggle.js:18-24`、`paths.js:14-20` 又开始试 `ctx.get('workingDirectory')`。依赖声明因此分裂：`inject` 里严格声明 3 个（`index.js:27`），另外 3 个靠异常探测。

### 2.2 低内聚高耦合

- [P1] (2.2-1) **`SessionManager` 一个类承担 10 项职责，重构必须先答"内聚边界在哪"** —— 703 行里并存：状态机与快照（`session.js:106-131`、`689-702`）、启动编排（`199-324`）、ntfy 会合协议解析（`408-453`，含 NDJSON 行解析 + 二次 JSON 解析 + 端点可信校验）、健康轮询（`463-550`）、掉线恢复决策（`558-604`）、Kernel 状态轮询（`606-628`）、临时目录生命周期（`326-349`）、代次失效（`146-156`）、关机通知（`184-195`、`698-700`）、给 UI 的中文文案（`231`、`240`、`286`、`313`、`539-546`）。这些职责的变更频率完全不同：状态机几乎不动，ntfy 协议和文案经常动，混在一个文件里使每次改动都要通读 700 行。

- [P1] (2.2-2) **`deps` 字典是"测试缝"而不是"边界"** —— `session.js:39-47` 注入 7 个模块函数，但真正的 I/O 并没有被同样对待：ntfy 轮询直接走 `httpText`（`session.js:408-412`），测试因此被迫启动一个真实的假 ntfy HTTP 服务（`test/session-reliability.mjs:83-92`、`test/session-race.mjs:67-76`）。也就是说"可注入集合"是按"测试方便"挑的，不是按"外部依赖"划分的；`DEFAULT_DEPS` 的存在让测试可以只覆盖一部分（`session-reliability` 就没提供 `requestShutdown`）。

  ```js
  // lib/session.js:39-47（7 项可替换）
  const DEFAULT_DEPS = { buildKernelFolder, removeKernelFolder, kaggleUsername,
    pushKernel, kernelStatus, kernelLogs, requestShutdown }
  // lib/session.js:409（同样外部，但不可替换，只能用 ntfyBase 指到假服务）
  const res = await httpText(this.ctx, url, { timeoutMs: 8000, … }).catch(() => null)
  ```

- [P1] (2.2-3) **`JobQueue` 直接持有 `SessionManager` 实例并读它的内部标志** —— `jobs.js:50-52` 保存实例；`jobs.js:177-204` 依次读 `isReady`、`stoppedByUser`（原始字段，不是方法）、`start()`、`snapshot()`、`ensureReady()`；`jobs.js:203`、`239` 又调 `connection()`/`snapshot()`；`jobs.js:253-259` 再次读 `stoppedByUser` 来改写错误码。依赖面有 6 个成员，其中 `stoppedByUser` 是内部状态而非契约——队列实际上在参与会话的语义决策（"用户关机后不得自动拉起 Kernel"），这条规则横跨两个对象。

- [P1] (2.2-4) **宿主入口承载"给模型看"的文案与工具描述，和路由逻辑重复表述同一件事** —— `index.js:70-99` 共 30 行 `describeJob`/`describeSession`；`index.js:495-499`（生成）、`511-512`（会话）、`539`（历史）三段描述文本又在解释 `/session/start`、`/session/stop`、`/history` 的行为；`index.js:458-481` 的 `toolParameters` 与 `jobs.submit` 校验重复。改一次参数范围要同时改工具描述、校验、SPEC。

- [P1] (2.2-5) **路由内联业务逻辑：删除循环与进程编排直接在 handler 里** —— `index.js:364-379` 在 `/library/delete` 中串行 `resolveOutputPath` + `unlink` + 记失败码，再在 `index.js:380` 调 `recordDeleted`；`index.js:51-67` 的 `revealFolder` 直接操作 `ctx.subprocess`（含 1.5 秒超时语义）。这两块都需要独立测试（越权删除、文件管理器不存在），现在只能靠 e2e。

- [P1] (2.2-6) **越层调用：远端协议不是单一出口** —— import 图本身无环（`jobs→output,presets,remote`；`session→kaggle,kernel,net,presets,remote`；`remote→net`），但方向上是两个消费者各自直达底层：`jobs.js:223-229` 直接调 `requestGenerate` 并自己构造远端 `tasks` 载荷；`session.js:408-412` 直接调 `httpText` 并自己解析 ntfy 的 NDJSON。`lib/remote.js` 名义上是 daemon 客户端，实际只被用了一半（`requestLogs` 甚至无人使用）。

- [P2] (2.2-7) **宿主硬编码中文用户可见文案，与客户端字典形成 i18n 双份** —— `lib/session.js:539-546`（`detail` 的 4 级嵌套三元，全是中文）、`session.js:696`（`error.message`）、`lib/jobs.js:40-47`（`SESSION_STAGE` 中文阶段名）。客户端 `src/logic/view.js:26` 与 `src/logic/error.js:11` 会把宿主 `detail`/`error.message` 直接拼进界面，英文 locale 下会出现"英文标签 · 中文详情"混排。

- [P2] (2.2-8) **`ctx` 依赖声明分裂**：`index.js:27` 的 `inject` 严格声明 3 个服务，另有 3 个服务靠 `ctx.get` + try/catch 探测（见 §2.1-11）。同类依赖两种声明方式，读者无法从 `inject` 看清真实依赖面。

### 2.3 意大利面条（长函数 / 深分支 / 手工编排）

- [P1] (2.3-1) **`pollTunnel` 91 行：4 个提前返回 + 两层文本解析 + 状态写入混在一起** —— `session.js:364-454`。超时判断（`380`、`402`）、恢复超时（`369-379`）、ntfy 取数（`408-412`）、NDJSON 逐行 + `message` 二次 JSON（`416-431`）、`error` 事件归因（`432-439`）、`ready` 幂等与状态写入（`440-452`）在同一个方法里。任何一处要单独测都要构造整个方法的前置状态。

- [P1] (2.3-2) **`pollHealth` 88 行，5 级嵌套分支 + 4 层嵌套三元** —— `session.js:463-550`。失败路径里三套策略交织：ready 阶段查 Kernel（`476-484`）、恢复窗口计时（`486-498`）、连续失败阈值 5/3 两档（`499-511`）；成功路径里又用嵌套三元生成文案（`539-546`）：

  ```js
  this.session.detail =
    health?.phase === 'installing' ? '远端安装依赖'
      : health?.phase === 'loading' ? '远端加载模型'
        : health?.phase === 'error' ? `远端错误：${health?.last_error ?? '未知'}` : '远端启动中'
  ```

- [P1] (2.3-3) **`_start` 107 行，8 处手工插入的代次校验** —— `session.js:218-324`，`isStale(epoch)` 出现在 `253`、`256`、`277`、`281`、`295`、`299`、`304`、`319`。这 8 处的位置正确性只能靠 `session-race` 的场景测试守住；增加一个新的 await 步骤时，"这里要不要再校验一次"没有任何结构性提示。

- [P1] (2.3-4) **`runNext` 99 行混合了 6 件事** —— `jobs.js:171-269`：串行位控制、会话就绪判断、`stoppedByUser` 语义、远端 `tasks` 载荷构造、落盘、错误码归因（`240-264` 用四个 `??` 串起 error/sessionError，再叠加"用户关机"特判）。这是全仓最典型的"一个函数承载一条流水线"。

- [P2] (2.3-5) **`stop()` 分阶段手工复位 12 个字段** —— `session.js:632-665`：`epoch/starting/startingEpoch/stoppedByUser/timers/livenessCheck/healthMisses/reconnectAttempts/recoveringFromReady/recoveryStartedAt/secret/session`。离散字段越多，漏复位一处就是一个僵尸轮询。

- [P2] (2.3-6) **15 份路由注册样板** —— `index.js:172-454` 区内每条路由都是 `ctx.effect(() => ctx.webServer.register({ kind:'exact', path, handler }), 'imagen:route-xxx')` + 方法检查 + 各自的错误返回；新增一条路由约 20 行。

### 2.4 重复与漂移

- [P1] (2.4-1) **模型调用管道被整段复制到两个文件** —— `lib/enhance.js:108-172` 与 `lib/intent.js:81-145`（各 65 行）逐行对应，只有 `maxTokens`（900/600）、`purpose` 字符串和提示词不同；`collectText`（`enhance.js:93-105` / `intent.js:66-78`）与两段 `prepareCall`→`stream` 降级 try/catch 完全同构。合计约 150 行重复逻辑，任何一处修复（例如流式分片拼接、超时）都要改两遍。

- [P1] (2.4-2) **clamp 家族三处四份** —— `index.js:39-43`（`toInt`）、`lib/jobs.js:21-38`（`clampInt`/`clampNumber`/`normalizeDimension`）、`src/logic/clamp.js:3-19`（`clampInt`/`clampNumber`/`clampSize`）。前两处逻辑逐字相同，第三处是同一规则的客户端副本。

- [P1] (2.4-3) **seed 语义已经漂移** —— 客户端 `src/logic/clamp.js:28` 上限 `4294967295`，宿主 `lib/jobs.js:121-124` 用 `Math.round(seedInput) % 2147483647`。用户输入 3000000000 时，界面显示 3000000000、实际使用的是 851688353；随后用任务参数"带回参数"不会复现同一张图。

- [P1] (2.4-4) **错误码没有单一来源，宿主与客户端各漂 6 条** —— 宿主实际发出 24 个码；`src/dict/zh.js:52-75` 有 24 条标签。宿主发出但界面无标签（会退化成裸 message）：`cli_timeout`、`invalid_body`、`output_missing`、`reveal_failed`、`too_many`、`unknown`；字典有标签但宿主从不发：`generation_failed`、`load_failed`、`need_prompt`、`oom`、`timeout`、`warming`（后 4 个来自远端 daemon 或客户端合成）。也就是说"错误码词表"实际是 宿主 ∪ daemon ∪ 客户端 三个来源的并集，却没有任何一处声明它。

- [P1] (2.4-5) **失败信号有两条通道：HTTP 状态码与体内 `ok`** —— `/library/delete` 用 `sendJson(res, 200, { ok: failed.length === 0, … })`（`index.js:381`），部分失败仍是 200；`/generate` 用 400（`index.js:243`）、`/job` 用 404（`index.js:261`）、`/reveal` 用 404/500（`index.js:442`、`449`）。客户端 `src/api.js:31` 只把 `!res.ok` 当失败，于是 200+`ok:false` 会流进成功分支，每个调用点必须记得再看一次 `data.ok`。同时响应信封有 5 种写法：裸对象（`/state`、`/job`）、`{ok,…}`（`/probe`、`/session/*`、`/reveal`）、`{jobs,queue}`（`/jobs`）、`{items}`（`/history`）、`{favorites,deleted}`（`/library`）。

- [P1] (2.4-6) **`docs/SPEC.md` 自称唯一真理源，但已漂移 ≥6 处** —— ① `SPEC.md:55-64` 说预设字段是 `name/width/height/steps/cfg`，实际 `publicPresets()` 输出 `label/size/…` 共 18 个字段（`lib/presets.js:149-151`）；② `SPEC.md:123-129` 说 `/generate` 返回 `{ok, jobId, status:"pending", job:{…}}`，实际返回裸 job 对象且 `status:"queued"`（`index.js:246`）；③ `SPEC.md:147` 说 `/library` 返回 `{ ok, favorites, deleted }`，实际没有 `ok`（`index.js:329` → `lib/library.js:115-126`）；④ `SPEC.md:206-207` 的工具参数写 `negative_prompt`/`preset`，实际是 `negativePrompt`/`presetId`（`index.js:464-465`）；⑤ `SPEC.md:229-231` 基准表 `sdxl-turbo` 是"1 步/0.0"、`sdxl-base` 是"30 步/5.0"，实际预设是 `steps:4,cfg:0` 和 `steps:25,cfg:7.5`（`lib/presets.js:63-64`、`92-93`）；⑥ `/imagen-api/jobs` 路由存在但 SPEC 未收录。

- [P1] (2.4-7) **两条路由对已发布 UI 是死代码，其中一条还只被测试引用** —— 客户端 `src/` 对 `/imagen-api/job` 与 `/imagen-api/jobs` 的引用数均为 0（`/state` 轮询已覆盖）；`/imagen-api/jobs` 只出现在 `test/host-e2e.mjs:210`，且不在 SPEC 中。它保留了第二套任务列表信封 `{jobs, queue}`。

- [P2] (2.4-8) **预览工具里的契约副本已经过期** —— `tools/preview.mjs:132` 注释"与真实 Host 的 /imagen-api/history 一致：不提供 params"，而真实 Host 从 `lib/output.js:161` 起就返回完整 `params`，`test/host-e2e.mjs:345` 还在断言它有；同一文件 `:130` 的 `sdxl-base` 文案是"经典 · 30 步精修"，`lib/presets.js:84` 是"标准 1024"。

- [P2] (2.4-9) **7 个导出没有外部使用者** —— `lib/enhance.js:50 localGroups`、`lib/http.js:62 errorShape`、`lib/kernel.js:78 copyMockDaemon`、`lib/net.js:99 httpJson`、`lib/output.js:24 fileUrl`（仅本文件用）、`lib/paths.js:27 toAbsolute`（仅本文件用）、`lib/remote.js:133 requestLogs`。其中 `errorShape` 与 `copyMockDaemon` 是"为将来准备"的死代码。

- [P2] (2.4-10) **小工具重复实现** —— `isoNow` 在 `session.js:53` 与 `jobs.js:17` 各一份；`sleep` 在 `session.js:49`、`kaggle.js:118` 各一份；`workspaceRoot`（`paths.js:14-20`）与 `originOf`（`kaggle.js:18-24`）是同一段"读工作目录、失败退回 `process.cwd()`"的两份实现。

- [P2] (2.4-11) **默认值双份，内层默认永远不生效** —— `session.js:72-74` 定义 `provisionTimeoutMs/tunnelTimeoutMs/healthyIntervalMs`，`index.js:115-116` 又给同名值；`jobs.js:55-56` 定义 `sessionWaitMs/generateTimeoutMs`，`index.js:125-126` 又给同名值。改内层默认值在产品路径上不会有任何效果（测试会用到，因此更难发现）。

- [P2] (2.4-12) **`state` 载荷与 `publicView` 里有客户端不读的字段** —— `index.js:130-141` 的 `version`、`probeAt`、`queue`、`devMode` 在 `src/` 中引用数为 0（`devMode` 仅被 `test/host-e2e.mjs:235` 断言）；`jobs.js:88-104` 手抄 13 个字段，其中 `stage`（中文阶段名，另有 `SESSION_STAGE` 映射 8 行）客户端与测试都不读，只由宿主写。

---

## 3. 现有安全网与阻塞点

### 3.1 安全网（按可用性排序）

| 测试 | 规模 | 覆盖方式 | 作为重构安全网的质量 |
| :--- | :--- | :--- | :--- |
| `test/host-e2e.mjs` | 559 行 / 21 项 | 真实 `apply()` + 假 `ctx` + 本地 HTTP + mock daemon，全链路（state→start→generate→落盘→history→file→工具→library→enhance/intent/reveal→stop） | **最好的一层**：只约束"注册形状"（`{kind:'exact',path,handler}`、`ctx.effect` 返回 disposer、`tools.register` 的 `{name,description,parameters,output,execute}` 与 `output.render`），不碰内部结构。路由层与 jobs 投影的重构可以靠它兜底。 |
| `test/session-race.mjs` | 478 行 / 42 项 | 直接 `new SessionManager({deps, options})` + 假 ntfy | 行为覆盖强（epoch 竞态、关机语义、临时目录），但**把内部结构写成断言**：`session.timers.size`（166、240）、`session.kernelFolder`（186）、`session.stoppedByUser`（228、301、316、346、384、387）、`session.deps.pushKernel`（190）、`session.fail()`、`options.*`。 |
| `test/session-reliability.mjs` | 433 行 / 25 项 | 同上 | 同上：`session.kernelFolder`（294）、`options.healthyIntervalMs/kernelPollMs/recoveryTimeoutMs`（173-177），假 ntfy 服务（83-92）。 |
| `test/library-atomic.mjs` | 358 行 / 13 项 | 模块级 API + 磁盘断言 | 钉住 `.imagen/library.json` 布局、`library.json.tmp-*` 前缀、`.corrupt-*` 备份命名；**磁盘格式本可不动**，但 `lib/library.js` 内部重构会撞这些断言。 |

合计 101 项断言、约 1828 行宿主测试。**没有单测覆盖的暗区**：`lib/kaggle.js` 的解析器（`parseQuota`/`simplifyKernelLog`/`cliVersionOf`/`looksUnauthenticated`）、`lib/remote.js:39-51 isTrustedEndpoint`、`lib/net.js` 的 curl 降级分支（注释称用一次性脚本验证过，`test/` 中无对应用例）、`lib/enhance.js`/`lib/intent.js` 的"模型可用"路径（e2e 只覆盖无模型兜底）、`lib/paths.js` 的符号链接场景。这些正是拆分 session/remote/enhance 时最容易踩的地方。

### 3.2 阻塞点

1. **契约无法机器校验**（§2.1-1）：重构期间没有任何"形状对不对"的自动判据，只能靠文档 + 4 份代码副本互相对照。
2. **测试的主要 seam 是内部字段与 `deps` 字典**：拆分 `SessionManager` 至少要改 `session-race`/`session-reliability` 里的 11 处内部断言和两处 `fakeDeps` 构造，改造过程中很容易把竞态断言一起丢掉——这是"安全网变成绊脚石"的典型形态，但规模可控（2 个文件、约 100 行改动）。
3. **零日志**：宿主 0 条日志输出，任何重构后的真实环境回归都只能复现为"SSoT 状态不对"，无法定位。这使第 1、2 条阻塞进一步放大。
4. **文档不能当回归判据**：SPEC 已漂移 6 处（§2.4-6），重构前必须先决定以代码为准并修文档，否则会"重构到文档的错误形状上"。

---

## 4. 候选重构方向

按"先低风险、后深水"排序；每条只写边界、收益、代价、风险。

### R1（先做）契约单一来源 + 注册助手：把 `apply()` 削薄
- **切边界**：新增 `lib/contract.js`（纯数据：路由表 = 方法+路径+请求/响应形状；参数边界；错误码→HTTP 状态映射；job/session 对外字段表）与 `lib/routes.js`（注册助手：方法检查、读体、错误信封、返回投影）。`index.js` 只保留装配 + 工具定义。
- **收益**：apply 的 470 行降到约 150 行（其中 104 行是工具定义本身）；新增路由从 ~20 行降到 ~3 行；4 份边界副本收敛成 1 份；错误信封从 5 种收敛成 1 种（需同步客户端）；`publicView`/`statePayload` 可由字段表生成。
- **代价**：一次中等规模迁移（15 条路由 + 3 个工具），客户端 `src/api.js` 需同步一句信封假设。
- **风险**：统一响应信封会改变部分端点的成功/失败语义（200+`ok:false`），必须与客户端同批改；建议第一步只提取"注册助手"，保持每个 handler 的响应原样，第二步再统一信封。

### R2 拆分 `SessionManager` 为组合，而不是继续加字段
- **切边界**：`session/state`（状态 + snapshot + epoch + timers，约 120 行）、`session/provisioner`（`_start`/`abandonStart`/`discardKernelFolder`，把 8 处手工 `isStale` 换成"在 epoch 作用域里执行"的一次性封装）、`session/rendezvous`（ntfy 解析 + 端点可信校验，与 `remote.js` 合并为远端通道）、`session/health`（健康轮询 + 恢复决策 + Kernel 状态轮询）。`SessionManager` 保留 `start/stop/dispose/snapshot/connection/ensureReady/isReady` 这 7 个成员，外加把 `stoppedByUser` 升级为 `wasStoppedByUser()`——并集恰好就是 `jobs.js` 与 UI 实际用到的集合。
- **收益**：`pollTunnel`/`pollHealth`/`handleReadyHealthLoss`（226 行）与 `_start`（107 行）可独立测试；ntfy 解析不再需要起真实 HTTP 服务；"要改的"（协议、文案）与"不动的"（状态机）分离。
- **代价**：`session-race`/`session-reliability` 的 `deps` 构造与 11 处内部断言要改；`stoppedByUser` 需升级为方法（`wasStoppedByUser()`）。
- **风险**：epoch 语义跨对象后最容易出"僵尸轮询"回归；建议先抽 `health`（最独立）验证模式，再抽 `provisioner`，最后才动状态容器，且每一步都跑现有 race 场景。

### R3 远端协议收成一个出口
- **切边界**：`lib/remote.js` 吸收 ntfy 轮询（`pollRendezvous`）与 generate 载荷构造；`jobs.js` 不再直接 `requestGenerate`，改为经 `session` 暴露的 `generate(job)`（或注入 `RemoteClient` 端口）；`session.js` 不再直接 `httpText`。
- **收益**：消除两条越层调用（§2.2-6）；协议改动集中一处；`JobQueue` 对 `SessionManager` 的依赖从 6 个成员收缩到 3 个。
- **代价**：中等；需要先做 R2 的 `rendezvous` 抽取。
- **风险**：多一层转发容易被写成"只做转发"的空壳；`remote.js` 的 curl 降级路径缺测试，搬迁时行为可能偏移。

### R4 `JobQueue` 去流水线化
- **切边界**：`submit` 只做"DTO → 校验 → 入队"（校验交给 R1 的 contract）；`runNext` 拆成 `runJob`（取连接 + 构造远端任务 + 调用）与 `persistResult`（落盘 + 状态收尾）；错误归因抽成 `describeJobError(error, sessionSnapshot)` 纯函数（`jobs.js:240-264` 的逻辑可离线断言）。
- **收益**：`runNext` 99 行 → 3 段 20~30 行；任务状态迁移集中到 1 个函数；`{ok,job|code,message}` 弱类型联合可以换成 `Result` 约定或直接抛带 `code` 的异常，调用方少一半分支。
- **代价**：小；`host-e2e` 已覆盖 generate 全链路。
- **风险**：`stoppedByUser` 特判（`jobs.js:253-259`）是刻意的产品语义，拆分时容易丢，需要保留对应断言（`session-race.mjs:368`）。

### R5（可与 R1 同批）可观测性：日志端口 + 吞错分级
- **切边界**：新增可选注入的 `logger`（默认 no-op），把 `session.js` 15 处、`index.js` 7 处静默 catch 改成"记录 + 保持现状"；`every()` 包装至少记一条；`net.js` 的 curl 降级、`library.js` 的损坏降级各记一条。
- **收益**：重构期回归第一次变成可定位；也是判断"哪些 catch 真的在保护、哪些在掩盖 bug"的唯一手段。
- **代价**：最小（约 30 处一行改动 + 一个 6 行模块）。
- **风险**：日志噪音；需要 `debug/warn/error` 三档并对轮询用 debug。

**推荐的"第一刀"**：用 `/imagen-api/generate` 这一条最长路径做垂直切片——路由只做 HTTP 解包 → `JobQueue.submit` 只做校验入队 → `runNext` 拆执行与落盘 → 远端经单一通道——同时接入 R1 的 contract 常量与 R5 的 logger。理由：这条路径被 `host-e2e` 的 21 项断言中的 7 项直接覆盖（生成、钳制、落盘、meta、任务查询、历史），是风险最低、同时触及全部 4 类问题的切口；模式验证后再横向推广到其余 14 条路由。

---

## 5. 一句话结论

宿主端的分层与写入安全（`lib/library.js`、`lib/paths.js`、无环 import 图）明显高于一般项目，病害并不弥漫：集中在**入口单体 `apply()`（470 行 / 15 路由）**、**最大对象 `SessionManager`（703 行 / 10 项职责）**、**契约与错误码没有单一来源**、以及**53 处静默容错 + 0 条日志**这四处；重构应先把契约与日志落地，再按"generate 垂直切片 → SessionManager 拆分 → 远端出口收敛"的顺序推进。

---

## 附录：统计口径与复现命令

```powershell
# 行数（read 工具口径，与 Measure-Object -Line 不同：后者忽略空行）
$files = @('index.js') + (Get-ChildItem lib -Filter *.js | ForEach-Object { "lib\" + $_.Name })
foreach ($f in $files) { "{0,-18} {1,5}" -f $f, (Get-Content $f).Count }

# 静默吞错点：31 空 catch + 6 .catch(()=>{}) + 16 .catch(()=>null)
$hostFiles = @('index.js') + (Get-ChildItem lib -Filter *.js | ForEach-Object { $_.FullName })
foreach ($f in $hostFiles) { $t = Get-Content $f -Raw
  "{0,-16} empty={1} noop={2} null={3}" -f (Split-Path $f -Leaf),
    ([regex]::Matches($t,'catch\s*\{')).Count,
    ([regex]::Matches($t,'\.catch\(\(\)\s*=>\s*\{\}\)')).Count,
    ([regex]::Matches($t,'\.catch\(\(\)\s*=>\s*null\)')).Count }

# 路由注册数（16 = 15 路由 + 1 dispose）
(Select-String -Path index.js -Pattern 'ctx\.effect\(').Count

# 宿主日志数（预期 0）
(Select-String -Path $hostFiles -Pattern 'console\.|ctx\.logger|logger\.').Count
```

