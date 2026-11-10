# 重构方案（讨论稿）

> 状态：**诊断与方案已完成（未回溯修改）。A 阶段（P0~P3）已执行完毕，执行记录见文末附录 A。**
> 基线：`npm test` 全绿、`node build.mjs --check` 通过（`client.js` 与 `src/` 同步）。
> 证据底稿：`docs/refactor/findings-{host,client,remote-test,metrics}.md`。

---

## 0. 一句话结论

代码的问题不是"到处都乱"，而是**四个热点集中了大部分复杂度**（`useStudio` 的 658 行单函数、`SessionManager` 703 行 10 类职责、`apply()` 470 行 15 条路由、`remote/daemon.py` 1216 行 55 个函数），**根因是契约没有机器可校验的单一来源 + 宿主端零日志**；模块依赖结构本身是干净的（0 循环、0 跨层违规）。因此建议的重构不是"重写"，而是：**先把契约和可观测性做出来（1 周内），再按批次给热点瘦身**，每批都保持 `npm test` 全绿。

---

## 1. 量化画像

| 维度 | 数据 |
| --- | --- |
| 手写代码 | ≈14,559 行（宿主 3,240 / 客户端 JS+JSX 4,456 / 远端 Python 1,345 / 测试 4,857 / 工具 661），另有 CSS 3,249 行、文档 1,538 行 |
| 仓库跟踪物 | 115 个文件 / 1,065,072 B；构建产物 `client.js` 248 KB 占 23.3% |
| 模块依赖 | import 179 条（内部 144）、**循环依赖 0**、`src↔lib` 跨层依赖 **0 / 0** |
| 函数/类规模 | Top4：`useStudio()` 658 行、`SessionManager` 703 行、`apply()` 470 行、`remote/daemon.py` 1,216 行 |
| 静默容错 | JS `catch` 52 个，其中吞噬型 24 个（46%）；Python `except` 59 个（daemon 39 个），`pass` 14 个 |
| 可观测性 | 宿主 3,240 行内日志调用 **0 条**；`session.js` 定时器用 `.catch(() => {})` 吞掉所有轮询异常 |
| 契约副本 | 15 条路由 → 113 处字符串 / 12 个文件；错误码 38 个（宿主 27 + 远端 4 + 客户端自造 7），字典仅 24 条文案；预设参数 6 处定义（2 处数值不一致）；daemon `/health` 字段 5 份副本 |
| 版本号 | 7 处定义、2 个值：插件/包/文档 0.3.0，远端 `daemon.py` 与 kernel 注入仍是 0.2.0 |
| 测试 | 4,857 行；`npm test` 只跑 8 个 JS 文件，`mock-daemon.py`/`smoke-daemon.py`/`tunnel-probe.py` 三个 Python 协议测试不在任何自动化入口 |

---

## 2. 判断校准：你说的三类问题，哪些成立、哪些不成立

这一节很重要——它决定我们该花力气在哪、不该花在哪。

| 你的判断 | 数据结论 | 说明 |
| --- | --- | --- |
| **过度防御** | **部分成立，且高度集中** | 24/52 的 JS catch 是"吞掉不报"；`lib/enhance.js`、`lib/intent.js`、`lib/remote.js` 的 catch 全部是吞噬型；`session.js` 的轮询定时器把所有异常吞成空操作。但组件层几乎不写 catch，`src/api.js` 已统一兜住网络错误——**不是全仓过度防御**。正确说法是"少数 lib 模块 + 零日志，导致静默范围不可见"。 |
| **低内聚高耦合** | **成立，但集中在单体内部** | `SessionManager` 一个类 10 类职责；`JobQueue` 直接持有 `SessionManager` 实例并读其内部标志（`jobs.js` 读 `stoppedByUser` 原始字段）；`useStudio` 一个 hook 14 类职责、72 个返回字段。**不是模块间网状乱耦合**（import 图无环、无跨层）。 |
| **意大利面条式代码** | **模块层面不成立，单函数层面成立** | 0 循环依赖、0 跨层违规、`src/logic/*` 15 个纯函数模块基本互不依赖，这部分结构健康。真正"面条"的是 4 个长函数：`pollTunnel` 91 行、`pollHealth` 88 行、`_start` 107 行、`runNext` 99 行——它们把超时策略、协议解析、状态写入、错误归因揉在一个方法里。 |
| **契约/文档混乱** | **成立，且是"改一处漏三处"的根因** | `docs/SPEC.md` 自称唯一真理源，但已漂移 9 类（缺 1 条路由、响应结构与状态值不符、工具参数名不符、10 个错误码未文档化、预设基准 5 处不一致…）；`remote/daemon.py` 与 `mock-daemon.py` 引用的 `docs/API.md` 根本不存在。 |
| **测试是阻力** | **不成立，测试是资产** | 4,857 行测试 + host-e2e 21 项是全项目最好的安全网。真正的阻塞是**客户端测试替身只实现 4 个 React hook**，导致"拆 hook / 上 reducer"无法被验证；以及 `session-race`/`session-reliability` 直接断言内部字段。 |
| **仓库卫生** | **基本健康，少数例外** | `.gitignore` 覆盖完整、无未跟踪垃圾；例外是 `client.js` 构建产物入库（可接受，但需 CI 校验）、`remote/worker.py` 129 行 0 引用、4 个死导出、缺 LICENSE。 |

> 对外表述建议：**"四个热点单体 + 契约副本 + 零日志"**，比"全仓面条/全仓过度防御"更准确，也更容易定方案。

---

## 3. 根因

**R1｜契约没有机器可校验的单一来源。** 路由、错误码、参数边界、预设、daemon 协议各自在 3~6 个地方手写一份，且已经漂移（错误码 10 个无文案、seed 上界两端不一致、生成超时 300s/600s 自相矛盾、预设基准与 SPEC 不符）。只要没有单一来源，每层就只能"不信任上游、自己再校验一次"——这正是"过度防御"体感的来源。

**R2｜可观测性为零。** 宿主 0 条日志 + 24 处吞噬型 catch + 定时器吞异常，结果是：故障不会变成错误，只会变成"界面停在错误状态"。排障只能靠读代码和 e2e 复现，这也让任何重构的风险评估失准。

**R3｜复杂度集中在少数单体，且测试缝不是结构边界。** `deps` 字典是"为了让测试能替换而设"的，不是按外部依赖划分的（ntfy 轮询就绕过了它）；真正该拆的边界在单个类/函数内部。测试又直接断言内部字段，于是"想拆"和"能验证"互相卡住。

---

## 4. 重构原则（建议先统一，再动手）

1. **行为不变**：重构批次不夹带功能改动；功能需求另开分支。
2. **每批可独立回滚**：一批一个提交范围，回滚 = `git revert`，不依赖数据库/数据迁移（本项目只有 `library.json` 与产物目录，无迁移成本）。
3. **契约先行**：任何拆分之前先把契约抽成单一来源，否则拆完仍然"改一处漏三处"。
4. **测试即护栏**：每批结束必须 `npm test` 全绿 + `build --check` 通过；新增断言优先于删除断言。
5. **明确不做**：全量重写、全仓引入 store/reducer、无收益的目录搬家、为"整洁"改动公共响应信封（除非与客户端同批）。

---

## 5. 分领域候选方案

### 5.1 契约层（所有方案的共同前置）

| 选项 | 做法 | 评价 |
| --- | --- | --- |
| **C1｜JS 常量模块（推荐）** | 新增 `shared/contract.js`（纯数据 + 少量纯函数）：路由表、错误码→HTTP 状态、参数边界、预设（含 pipeline）、daemon 协议字段、版本号。`index.js`、`src/**`、`test/**` 直接 import；构建 kernel 时把同一份数据序列化成 `remote/contract.json` 随包推送，daemon 启动时读取（替换现在的 Base64 隐式约定）。配 `test/check-contract.mjs` 做一致性断言。 | 改动最小、单语言维护、两端可共享；缺点是 Python 端多一个 JSON 依赖（随 kernel 目录打包，成本可忽略）。 |
| C2｜JSON Schema 单一源 | 用 JSON Schema 描述请求/响应/协议，两侧各自校验并生成 TS/Python 类型 | 最严格，但要引入 schema 校验依赖与生成步骤；对 4 条 daemon 路由 + 15 条 host 路由而言偏重。 |
| C3｜文档生成 | 以代码为源生成 SPEC 表格 | 只解决文档漂移，不解决代码副本；可作为 C1 的附带产物。 |

**推荐 C1 + 生成 SPEC 的接口表格**。第一批落地内容：路由（方法/路径/请求形状/响应形状）、错误码（含所属层）、参数边界、预设、daemon 4 条路由与 ntfy 事件字段、版本号。检查脚本同时验证：① 代码里没有未登记的 `/imagen-api/` 字面量；② 宿主发出的每个错误码都有客户端文案；③ SPEC 中的路由/错误码表由脚本比对。

### 5.2 宿主端

| 选项 | 做法 | 收益 / 代价 |
| --- | --- | --- |
| **H1｜路由层拆文件（推荐）** | `apply()` 拆成 `routes/{session,jobs,library,prompts,files,tools}.js`，每文件导出 `register(ctx, deps)`；新增 `lib/route-kit.js` 统一"方法检查 + 读体 + 错误信封"。`index.js` 只做装配。 | `apply()` 470 → 约 120 行；新增路由从 ~20 行降到 ~3 行。风险低（host-e2e 只约束注册形状，不碰内部）。 |
| **H2｜`JobQueue` 去流水线化（推荐）** | `runNext` 拆成 `runJob`（取连接 + 构造远端任务 + 调用）+ `persistResult`（落盘 + 收尾）+ `describeJobError()` 纯函数；`submit` 的校验交给 contract。 | `runNext` 99 行 → 3 段 20~30 行；错误归因可离线断言。风险低，host-e2e 已覆盖。 |
| **H3｜`SessionManager` 拆分（推荐，但放后）** | 拆为 `state`（状态 + snapshot + epoch + timers）、`provisioner`（启动编排 + 临时目录）、`rendezvous`（ntfy 解析 + 端点校验，与 remote.js 合并为远端通道）、`health`（健康轮询 + 恢复决策 + Kernel 轮询）；`SessionManager` 只保留 `start/stop/dispose/snapshot/connection/ensureReady/isReady` 7 个成员——恰好是 `jobs.js` 与 UI 实际用到的集合。 | 226 行轮询逻辑与 107 行启动编排可独立测试；ntfy 解析不再需要真 HTTP 服务。代价：`session-race`/`session-reliability` 约 11 处内部断言要改（约 100 行）。风险中（epoch 语义跨对象后最易出"僵尸轮询"回归），建议先抽 `health` 验证模式。 |
| **H4｜日志端口（推荐，第一批）** | 新增 6 行 `lib/log.js`（默认 no-op，可从 ctx 注入）；把 `session.js` 15 处、`index.js` 7 处静默 catch 改成"记录 + 保持原行为"；`every()` 至少记 debug。 | 约 30 处一行改动。重构期回归第一次变得可定位。 |
| H5｜唯一远端出口 | `lib/remote.js` 吸收 ntfy 轮询与 generate 载荷构造；`jobs.js` 不再直接 `requestGenerate`，`session.js` 不再直接 `httpText`。 | 消除两条越层调用；依赖 H3 先抽 `rendezvous`。 |

### 5.3 客户端

| 选项 | 做法 | 收益 / 代价 |
| --- | --- | --- |
| **K0｜测试替身加固（前置，必做）** | `test/load-client.mjs` 的 React 替身补齐 `useMemo/useReducer/useContext/useSyncExternalStore`，并让子组件在受控 hook 作用域内渲染；`check-client-render` 的整树哈希改为"关键 class + 文案 + 角色"的结构断言。 | 不做这一步，任何拆分都无法验证（现状拆了会以错误语义通过或直接抛错）。代价：2 个测试文件 + 重录 golden。 |
| **K1｜请求编排收回资源层（推荐）** | 新增 `src/api/`（每资源一个模块）：`state/history/library/session/generate/probe/enhance/intent/reveal/libraryFavorite/libraryDelete`；负责 URL、方法、请求体、`ok` 判定、响应形状校验与统一错误对象。`useStudio`/`useHostState` 不再出现字符串路径与 `result.data.*` 判断。 | 12 处端点路径与结果判断收成 1 处；错误码→文案/指引有唯一入口。风险低。 |
| **K2｜`useStudio` 按域拆 hook（推荐）** | 拆 5 个域：`useStudioForm`（表单/预设/风格/比例/润色）、`useSessionControl`（start/stop/probe/消费宿主状态）、`useWorkLibrary`（history/favorites/delete/export）、`useChatThread`（messages/interpret/clarify/意图生成）、`useStudioUi`（view/zoom/panelMode/toast/error/guidance）；跨域动作在组合层粘合，`buildBody()` 由 form 域导出。 | 709 行 → 5×120 行左右，各自可单测；死字段（`historyDone` 等）自然消失。代价：`Studio.jsx` 要组合 5 个 hook；跨域隐式顺序依赖（预设同步、意图生成）需小心。风险中。 |
| K3｜最小 store + 域对象 props（可选，最贵） | 22 个 useState 合并为 4 个 reducer slice，组件按域接收分组对象，`t` 注入一次。 | 重渲染边界显式、props 94 → 约 30。代价：全部组件签名改动 + 10 份快照重录 + 依赖 K0；宿主 React 版本是否支持 `useSyncExternalStore` 待验证。建议放到功能间歇期。 |
| **K4｜错误/提示统一（推荐，可随 K1）** | 单一错误模型 `{code, message, source}` 与单一展示策略；补 `error.code.generate_failed`/`session_error` 文案；`loadHistory/loadLibrary` 失败进入错误态而非空态；`TopBar` 与 `logic/view` 两套会话映射合并成一套。 | 消除"英文界面回落中文"和"加载失败显示暂无作品"两个用户可见缺陷；三处重复映射收敛。风险低。 |

### 5.4 远端与测试

| 选项 | 做法 | 收益 / 代价 |
| --- | --- | --- |
| **M1｜daemon 状态对象化（推荐）** | `STATE`/`BOOT` 两个模块级 dict（23 + 4 键）→ `DaemonConfig` / `AppState` / `Engine` 三个对象；配置走显式 schema（未知键告警，不再静默降级）；6 处同构的启动失败路径收敛成 1 个 `fail_boot(code, msg)`。 | `log_since`/`validate_generate_spec`/`classify_failure`/`health_payload` 变纯函数，可离线单测；顺带修"未配置 token 即放行"这个安全问题。代价：daemon 内部改动（无测试 import remote/，测试改动 0~3%）。风险中低。 |
| **M2｜协议契约化 + 契约驱动 mock（推荐）** | 按 5.1 的 contract 生成/驱动 `test/mock-daemon.py`：`--fail`/`--warm-seconds`/`--phase error` 变成"改字段值"而不是复制协议；`smoke-daemon.py` 的字段表从契约生成；`tunnel-probe.py` 直接复用 mock 的 handler（删掉一半）。 | 5 份 health 副本、3 份会合消息、2 种 `/logs` 分页语义一次收敛；补上现在完全测不到的 400/503 分支。代价：mock/probe 改写约 700~1100 行。风险中（测试改写量最大的一块）。 |
| M3｜daemon 拆文件（可选） | 拆成 `remote/imagen/{config,state,engine,tunnel,server,boot}.py`，发布时拼接成单文件 daemon.py（Kaggle 只允许一个 `code_file`）。 | 维护性提升，但需要新增 Python 合并构建 + 校验；`traceback` 行号会偏移。**建议只在 M1/M2 完成后、并且确实还要大规模改远端时再做。** |
| M4｜测试分层（推荐，随批次推进） | ① unit：daemon 纯函数 + 契约，Python `unittest`；② process：单进程 mock 覆盖全部路由与 phase；③ host：`host-e2e` 去掉内联 node mock、改起 mock-daemon 子进程；④ live：GPU/Kaggle 手跑。把 Python 测试接入 `npm test`（或 `npm run test:protocol`）。 | 删掉约 500~780 行重复实现；测试从"断言当前形状"转向"断言行为与契约"。风险：host-e2e 从零外部依赖变成需要 Python，需保留无 Python 降级路径。 |

---

## 6. 三条整体路线

### 方案 A｜低风险清理（约 1 周 / 5 人日）

范围：5.1(C1) + H4 + K4 的两个缺陷修复 + 卫生清理（删 `remote/worker.py` 与 4 个死导出、版本号单一来源、修 SPEC 漂移、补 LICENSE）。

- 解决：R1（契约副本）、R2（可观测性）、2 个用户可见缺陷、卫生债。
- 不解决：三个单体的复杂度，测试替身阻塞仍在。
- 适合：近期功能排期紧、只想先止损。
- 风险：低（不改变任何业务流程）。
- 验收：`check-contract` 通过；宿主发出的每个错误码都有文案；`npm test` 全绿；`gpu-live` 手跑一次确认远端仍可用。

### 方案 B｜分批结构化（约 4~6 周 / 20~26 人日，推荐）

顺序：**A 的全部 → H1/H2 → K0/K1 → H3 → K2 → M1 → M2 → M4**，每批独立提交、独立验收。详见 §7 批次表。

- 解决：R1、R2、R3 全部；三个单体瘦身；测试从"形状绑定"变为"行为 + 契约"。
- 代价：需要 4~6 周的间歇投入（可与其他功能并行，按批次交付）；`session-race`、`session-reliability`、mock/probe 会有一次集中改写（约 12%~23% 测试行）。
- 适合：项目还要持续迭代（ROADMAP 里还有 P0 会话持久化、隧道自愈等），需要更低的长期改动成本。
- 风险：中。最大风险在 H3（epoch 语义）与 M2（协议测试改写），两者都建议单独一批、单独验收。

### 方案 C｜垂直切片渐进（约 3~5 周 / 15~20 人日）

不按层拆，按用户价值链路一条条重写：先 `/generate` 全链路（客户端表单 → 资源层 → 路由 → 队列 → 会话 → daemon），旧链路切换后删除；再 `/history` + 画廊、`/library`、`/intent` + 对话。每条链路 2~5 人日。

- 优点：每完成一条就能交付；改动范围小、回滚容易；适合"边加功能边重构"。
- 缺点：过渡期新旧两套并存，需要明确"禁止在新代码里扩散旧模式"；对 `SessionManager` 这类跨链路的共享单体只能做局部调整，不能一次性拆完。
- 适合：产品侧近期有明确功能路线，希望重构跟着功能走。

### 方案 D｜大重写（不推荐）

理由：① 现有 4,857 行测试与 host-e2e 是真实资产，重写等于归零；② Kaggle 真机链路（依赖冲突、隧道、磁盘配额）的隐性知识大量沉淀在代码注释与兜底逻辑里，重写会重新踩坑；③ 三个单体的边界已经通过证据确认，拆分可控，没有重写的必要。

---

## 7. 推荐路线：方案 B 的批次表

> 估时是"一个熟悉本仓库的开发者"的粗估（人日），未含等待 Kaggle 排队与真机验证的挂钟时间。

| 批次 | 内容 | 估时 | 风险 | 验收标准 | 回滚点 |
| --- | --- | --- | --- | --- | --- |
| **P0** | 修 4 个已知缺陷：生成超时 300s/600s 矛盾、seed 上界漂移、客户端缺 `generate_failed`/`session_error` 文案、历史加载失败静默成空 | 1 | 极低 | `npm test` 全绿 + 对应断言新增 | 单提交回滚 |
| **P1** | 契约单一来源 `shared/contract.js` + `test/check-contract.mjs` + SPEC 接口表由脚本比对 | 2~3 | 低 | 检查脚本通过；grep 无未登记路由字面量 | 保留旧常量，契约文件先并行 |
| **P2** | `lib/log.js` + 53 处吞错分级 + `every()` 记录 | 0.5~1 | 低 | 轮询异常能在日志中看到；无新增日志噪音 | 单提交回滚 |
| **P3** | 卫生清理：删 `worker.py`/4 个死导出、版本号单一来源、补 LICENSE、修 SPEC 其余漂移 | 0.5 | 极低 | `check-contract` 通过；`gpu-live` 可跑 | 单提交回滚 |
| **P4** | 宿主路由拆文件 + `route-kit`（H1）+ `JobQueue` 去流水线（H2） | 3~4 | 低 | host-e2e 21 项不减；路由逐条对齐 | 路由逐个迁移，可单条回滚 |
| **P5** | `SessionManager` 拆分（H3）+ 唯一远端出口（H5） | 3~4 | 中 | `session-race` / `session-reliability` 全绿（断言改为行为级）；连续 3 次 `gpu-live` 无僵尸轮询 | 先抽 `health`，再 `provisioner`，最后状态容器；每步独立提交 |
| **P6** | 客户端测试替身加固（K0）+ 结构断言替代整树哈希 | 2~3 | 中 | 10 个渲染场景改为结构断言后全部通过 | golden 重录前先并行保留旧断言 |
| **P7** | 客户端资源层（K1）+ 错误/提示统一（K4） | 3~4 | 低 | 客户端无字符串路径残留；错误码文案覆盖 100% | 单提交回滚 |
| **P8** | `useStudio` 拆域 hook（K2） | 3~4 | 中 | 5 个域 hook 各有单测；关键交互（双提交、收藏乱序）补断言 | 拆一个域一批，可分域回滚 |
| **P9** | daemon 状态对象化 + 启动失败路径收敛 + token 缺失安全修复（M1） | 3~4 | 中 | 纯函数单测（无需 torch）；`gpu-live` 通过 | 单提交回滚 |
| **P10** | 协议契约化 + 契约驱动 mock/probe（M2）+ 测试分层接入（M4） | 3~4 | 中 | mock 覆盖 `phase=error` 与 400/503；`npm run test:protocol` 进 CI | 保留旧 mock 一个版本作为对照 |

**总计约 22~29 人日。** 其中 P0~P3（约 5 人日）是低风险高杠杆部分，建议先做；P4 之后每批都可独立暂停。

**每批固定门禁**：`npm test` 全绿 → `node build.mjs --check` 通过 → `host-e2e` 断言数不减 → 涉及远端或会话的批次额外跑一次 `npm run test:gpu`（真机，约 10 分钟）。

**建议的"第一刀"**：`/generate` 垂直路径——它同时覆盖契约（参数边界/错误码）、路由样板、队列流水线、远端出口四类问题，而 `host-e2e` 的 21 项断言中有 7 项直接覆盖它。先在这条路径上验证"contract + logger + 拆分"的模式，再横向推广。

---

## 8. 待你决策的 4 个问题

1. **这次重构的目标优先级是什么？**（可多选）
   - A. 先止损：把契约漂移、静默失败、可排障性修掉，不动结构（→ 方案 A）
   - B. 为后续迭代降成本：把四个热点拆开（→ 方案 B）
   - C. 边加功能边重构：按链路推进（→ 方案 C）
   - D. 准备开源/发布：契约、LICENSE、文档、构建流程一起收（→ 方案 A + 卫生批次加强）

2. **可接受的时间窗口与节奏？**
   - 集中 1 周做 P0~P3，其余按批次穿插；
   - 还是每批 1~2 天、与功能需求交替进行（周期拉长但不停功能）。

3. **远端是否接受额外的构建步骤？**
   - 不接受：daemon 保持单文件，只做 M1/M2（状态对象化 + 契约驱动 mock），不做 M3；
   - 接受：可以拆成多文件 + 发布时拼接（多一个构建/校验步骤，换更好的维护性）。

4. **契约载体与测试替身的技术偏好？**
   - 契约：`shared/contract.js` 单语言维护（推荐） / JSON Schema 严格校验 / 只生成文档；
   - 客户端测试：加固现有假 React 替身（推荐，成本低） / 换成真实 React + 轻量渲染器（更接近真实，但新增依赖与启动时间）。

---

## 9. 附：证据索引

| 底稿 | 覆盖范围 | 关键结论 |
| --- | --- | --- |
| `docs/refactor/findings-host.md` | `index.js` + `lib/*.js`（264 行、37 条证据） | `apply()` 470 行 15 路由；`SessionManager` 10 类职责；53 处吞错 + 0 日志；SPEC 漂移 6 处；seed 与超时默认值冲突 |
| `docs/refactor/findings-client.md` | `src/**`（216 行、P0×3/P1×16/P2×12） | `useStudio` 72 字段 / 94 props；无 memo 导致整页每秒重渲染；测试替身只有 4 个 hook；缺 `generate_failed` 文案；历史加载静默 |
| `docs/refactor/findings-remote-test.md` | `remote/**` + `test/**` + `tools/`（278 行、30+ 条证据） | daemon 1216 行 / 全局 STATE；`docs/API.md` 不存在；health 字段 5 份副本；mock 造不出 400/503；测试改写量估算（daemon 拆分 0~3%、契约化 15~23%、lib 会话 12~17%、src 组件 8~14%） |
| `docs/refactor/findings-metrics.md` | 全仓量化（697 行） | 0 循环依赖 / 0 跨层违规；3 个单体占比 21.9%；路由 113 处字面量；错误码 38 个；预设 6 处定义；版本 7 处 2 值；仓库卫生与文档漂移清单 |

---

## 附录 A：A 阶段执行记录（2026-11-10）

### A.1 实际顺序（与 §7 的一处调整）

先落 **P1 契约**，再落 P0 缺陷修复：P0 里的超时与 seed 上界正是契约要收编的常量，反序会改两遍。
其余按 P0 → P2 → P3 执行。

### A.2 交付内容

| 批次 | 内容 | 结果 |
| --- | --- | --- |
| P1 | 新增 `shared/contract.js`：15 条路由、37 个错误码（host 27 / remote 4 / client 6）、参数边界 `LIMITS`、超时 `TIMEOUTS`、4 个预设（含 pipeline）、daemon 协议 `PROTOCOL`、版本号；`lib/presets.js` 改为引用它；新增 `test/check-contract.mjs`（9 项校验，已进 `npm test`） | ✅ 9/9 通过 |
| P0-1 | 生成超时 300s/600s 的矛盾消除：统一由 `TIMEOUTS.remoteGenerateMs`（300000）提供，生产行为不变，仅删除无人生效的 600000 默认值与误导注释 | ✅ |
| P0-2 | seed 上界统一为 `LIMITS.seed.max`（2147483647）：客户端此前允许到 4294967295，会被宿主静默取模改写 | ✅ |
| P0-3 | 客户端补齐 10 个缺失错误码文案，`hostErrorCodes()` 的 31 个码在 zh/en 均有文案 | ✅ 228 键对齐 |
| P0-4 | `loadHistory`/`loadLibrary` 失败不再静默成"暂无作品"，改走既有错误/指引通道且不清空列表；消费宿主状态轮询的 `error`（按 code+message 去重） | ✅ |
| P2 | 新增 `lib/log.js`（默认 no-op，`OUR_FREE_IMAGEN_LOG` 或注入 sink 开启）；宿主 35 处吞错按 debug/warn 分级，`every()` 轮询异常不再无声吞掉 | ✅ |
| P3 | 删除死文件 `remote/worker.py`（129 行）与 4 个死导出（`errorShape`/`httpJson`/`copyMockDaemon`，`requestLogs` 标 reserved）；版本号 7 处收敛到 contract（daemon/mock/probe 均 0.3.0）；修正 2 处指向不存在的 `docs/API.md`；重写 `docs/SPEC.md`（235→505 行，路由/错误码/响应/工具参数/预设表对齐实现）；`tools/preview.mjs` fixture 去重；`test/host-e2e.mjs` 与 `test/verify-loaded.mjs` 版本断言改引用 contract | ✅ |

附带完成（原计划外、成本低）：`lib/kaggle.js` 的 4 个 CLI 超时接入 contract；客户端轮询间隔、探测超时、提示词上限接入 `TIMEOUTS`/`LIMITS`；`docs/ARCHITECTURE.md` 更新客户端描述、契约来源与日志开关说明。

### A.3 验收

- `node test/check-contract.mjs`：9/9 通过。
- `npm test`：全绿（契约校验 + 客户端文案/逻辑/渲染 + host 端到端 + 本地库 + 会话可靠性 + 竞态）。
- `node build.mjs --check`：`client.js` 与源码一致（构建产物已重建）。
- 客户端渲染 13/13 通过，`test/render-golden.json` **未改动**（本批没有 DOM/class/prop 形状变化）。
- 行为不变声明：所有契约化的值与原实现逐一相等；唯一有意变化是"客户端 seed 上界从 4294967295 收紧到宿主实际使用的 2147483647"和"加载失败从静默变为可见提示"。

### A.4 遗留到 B 阶段

1. `index.js` 里 Agent 工具的参数描述文本仍是数字字面量 → 随 P4 route-kit 从 contract 派生。
2. `remote/daemon.py` 仍忽略注入的 `preset_id`/`log_level`/`version`/`contract`（已随 kernel 配置下发，但 daemon 未读取）→ P9（M1）。
3. `apply()` 470 行、`SessionManager` 703 行、`useStudio` 709 行、客户端测试替身只支持 4 个 hook → P4~P8。
4. 响应信封仍有 5 种写法（含 200+`ok:false`）→ 随 P4/P7 与客户端同批统一。

---

## 附录 B：B 阶段执行记录（进行中）

每批仍是"一次提交、独立验收、可单独回滚"。

| 批次 | 内容 | 结果 |
| --- | --- | --- |
| P4 | `apply()` 485→89 行（index.js 608→120）：新增 `lib/route-kit.js` + `lib/routes/{session,jobs,files,library,prompts}.js` + `lib/tools.js`；`JobQueue.runNext` 拆为 `runJob`/`persistResult`/纯函数 `describeJobError` | ✅ host-e2e 21/21、session-race 44/44、reliability 26/26、library 12/12 |
| P6 | 测试 React 替身补齐 `useReducer`/`useMemo`/`useLayoutEffect`/`memo`，未实现 API 明确报错；新增 hook 探针场景 | ✅ 渲染 13→14 项，golden 未改 |
| P7 | 新增 `src/api/resources.js`（12 个资源函数）；`useStudio` 11 处、`useHostState` 1 处调用收敛 | ✅ 客户端逻辑 24/24、渲染 14/14 |
| P9 | `remote/daemon.py` 1216→1378 行：`STATE`/`BOOT` 字典 → `DaemonConfig`/`RuntimeState`/`BootState` 对象；校验边界改读注入的契约（缺失回退）；6 处启动失败收敛 `fail_boot()`；新增 `test/daemon-unit.py`（50 用例） | ✅ 单测 50/50；真机链路待人工验证 |
| P5 | `lib/session.js` 703→282 行，拆出 `lib/session/{state,timers,provisioner,rendezvous,health,remote-port}.js`；health 嵌套三元改映射表；`JobQueue` 经 `remote-port` 出网 | ✅ 4 套宿主测试 + 新增 session-pure 19/19；测试文件零改动 |
| P8 | `useStudio.js` 727→259 行，拆出 `src/studio/hooks/{useStudioUi,useStudioForm,useSessionControl,useWorkLibrary,useChatThread}.js`；返回对象 72 键与拆分前一致、`Studio.jsx` 未改、golden 未变 | ✅ 渲染 14/14、逻辑 24/24、文案检查通过 |
| P10 | `tools/gen-contract-json.mjs` 生成 `remote/contract.json`（daemon 与 Python mock 共用契约）；`test/mock-daemon.py` 契约化并新增 `--phase`/`--fail-generate` 分支；smoke 6→9 场景；host-e2e 内联 mock 改对象错误信封；`lib/remote.js` 移除为测试而留的字符串兼容分支；check-contract 新增第 10 项（契约 JSON 同步） | ✅ 契约 10/10、host-e2e 21/21、smoke 9/9、daemon-unit 50/50 |

**唯一有意的行为变更**（P9）：远端 daemon 在未注入 `auth_token` 时不再放行匿名访问（401、不发布 ready），本地无鉴权调试需显式 `allow_no_auth: true`。其余批次均为行为不变重构。

**B 阶段状态**：P4~P10 全部完成；每批一个本地提交、可单独回滚。剩余仅"真机 GPU 链路验证"需在具备 Kaggle 额度的环境手动执行（`npm run test:gpu` / `npm run test:live`），离线侧已由 daemon-unit 50 项 + smoke 9 场景 + host-e2e 21 项覆盖。