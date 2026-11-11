# 外部代码审计复核（2026-11-11）

> 复核对象：`CODEBASE_AUDIT_REPORT.md`（外部审计，不在本仓库内）。
> 复核基准：本仓库 HEAD `c8d2115`（0.5.0）与其后的 0.6.0 改动。
> 结论速览：**方向大体成立，但审计基于 0.5.0 开发中途的工作区快照**——行号、文件长度与远
> 端协议形态都已过时。逐条复核结果：10 条属实或部分属实（本轮已处理，见 [CHANGELOG](../CHANGELOG.md)
> 0.6.0）、5 条不成立或已被既有实现覆盖、3 类属风格建议（部分采纳）；另有 1 条（去 ntfy）
> 用实测数据论证后决定**不按原方案执行**。

## 1. 审计快照与当前代码的差异

| 审计描述 | 实际（本轮开工前，HEAD c8d2115） |
| :--- | :--- |
| `remote/daemon.py` 3221 行，`POST /generate` 同步返回 Base64 | 3478 行；0.5.0 起已是异步 job（`POST /generate` 202 入队 + `GET /job` 轮询），远端有常驻单 worker 与 `GEN_LOCK` |
| `lib/session.js:147`、`lib/jobs.js:324`、`remote/daemon.py:2261` 等行号 | 均有 30~160 行偏移（session.js 881→953 行、jobs.js 302→357 行、daemon.py 1717→3478 行） |
| 「41 处 catch」 | `lib/session.js` 实际 24 处 `catch`、`lib/` 全量 83 处（含 try/catch 与 `.catch()`） |
| 「全仓测试 79/79、44/44、21/21」 | 测试条目已变化（本轮开工前各套件合计 200+ 项），数字不可直接引用 |

因此下文对每一条结论都重新核验，而不是照单执行。

## 2. 逐条结论

### 2.1 属实并已修复

| # | 审计结论 | 核验 | 处理 |
| :---: | :--- | :--- | :--- |
| 1 | `JobQueue.waitFor` 用 700ms 轮询自己的内存数组 | 属实（`lib/jobs.js`）；Agent 工具默认等待 90s，纯浪费 | 改事件驱动唤醒（`test/jobs-wait.mjs` 8 项） |
| 2 | `every()` 用 `setInterval`，回调 Promise 未结束也会继续排下一拍 | 属实；`pollTunnel` 3s / `pollKernelStatus` 30s，后者每次拉起 `kaggle.exe`（注释自述 9~15s），网络慢时重叠 | 单飞自调度延时链 + 健康/Kernel 轮询去重 |
| 3 | 意图解析按 UI 语言输出 prompt，中文界面把中文发给英文模型 | 属实（`lib/intent.js` 旧第 31 行）；README 第 63 行却承诺「先翻译为规范的英文提示词」 | `/intent` 恒输出英文 prompt + 中文 `summary`；按预设 `promptStyle`/`qualityPrefix` 动态拼书写口径 |
| 4 | 润色按 UI 语言追加中文短语 | 属实（`lib/enhance.js` 中文词表直接进 prompt） | 每条建议拆 `text`（英文，进 prompt）与 `label`（界面语言） |
| 5 | `negativeHint` 全链路沉睡 | 属实：`models/*.json` 已配好，只有 `tools/verify-model.mjs` 与 `test/gpu-live.mjs` 读取，`src/`、`lib/` 零消费 | 切预设时按「用户没写过/仍是上一预设推荐值」自动回填 |
| 6 | 宽高被远端取整后，宿主仍记录请求值 | 属实：Anima `__call__` 把宽高向下取整到 16 的倍数（648→640），`run_task` 回传请求值 | `run_task` 统一回传 PIL 实际尺寸 |
| 7 | 产物裸 `writeFile`，中断留下半截文件 | 属实（`lib/output.js`），而同仓 `lib/library.js` 已有 tmp+rename | PNG 与 `meta.json` 改同目录 tmp+rename，meta 最后落 |
| 8 | `daemon.py` 与 `verify-model.py` 各维护一份 1000 行 Anima 运行时 | 属实，两处注释自述「必须逐字同步」；本质是误解 Kaggle 单 `code_file` 约束 | 抽 `remote/anima_runtime.py` 单份源码 + 打包期内联（daemon 3478→2360 行、payload 1442→315 行） |
| 9 | `STYLE_IDS` / `RATIO_IDS` 在 `lib/intent.js` 与前端各写一份 | 属实 | 收敛到 `shared/contract.js` |
| 10 | `ENHANCE`/`INTENT` 的模型调用无模型上下文 | 属实（`lib/intent.js` 静态 system prompt） | 已随第 3 条一并改为按预设注入书写口径 |

### 2.2 不成立或已被既有实现覆盖（本轮不改逻辑）

| # | 审计结论 | 核验结果 |
| :---: | :--- | :--- |
| A | 缺陷 5：远端多线程并发 `ensure_pipeline` 加载模型导致 CUDA OOM | **不成立**。0.5.0 起远端是单 worker 线程消费 job 队列，`execute_job` 全程持 `GEN_LOCK`；`/generate` 在 `phase≠ready` 时直接 503，Host 侧 `JobQueue` 也串行。审计引用的「并发 HTTP 直接进 `ensure_pipeline`」是旧同步协议的行为 |
| B | 缺陷 6：`useAlive` 让 `sending` 永久死锁，切到画廊后无法再生成 | **机制不成立**。`src/api.js` 的 `request()` 从不抛异常、只返回 `{ok:false}`；`alive()` 只在组件卸载后返回 null，此时 hook 状态已随组件销毁，不存在"闭包永久锁死"。仍补了 `try/finally` 作为防御（见 2.1 第 7 条的同类改动） |
| C | 缺陷 3：鉴权失效被 catch 吞掉，状态机空转 45 分钟才超时 | **因果链不成立**。`kaggleUsername` / `pushKernel` 失败会立刻 `fail('auth_required')`；远端隧道/依赖失败经 ntfy `error` 事件触发快速失败（`lib/session.js` 的 `mapRendezvousError`）。剩余 45 分钟只用于「Kernel 真在排队/容器已起但没回传地址」这两种合法等待，且超时文案会区分二者。catch 数量「41 处」也不实 |
| D | 「1152×648 导致图像非等比拉伸」 | **不成立**：1152/648 正好 16:9。真问题是它不是 SDXL 官方分桶，以及 Anima 取整造成的元数据漂移（后者已修） |
| E | 测试「只断言自己的 Mock 桩」 | 主观判断，**不采纳**。现有测试覆盖真实状态机（session-race / session-reliability / host-e2e 走真实 HTTP 与 mock daemon）、真实原子写与打包产物；本轮只增不减 |

### 2.3 风格类建议（部分采纳）

- 前端「碎屑文件」：`capsules.js` / `ratios.js` / `plates.jsx` / `recall.js` 已合并为 `src/studio/presets.js`、`Rail.jsx` 内联与 `src/logic/generate.js`。
- `capsules` / `plates` / `recall` 这类命名换成描述性名称；但不认同「把纯逻辑塞回 hook」——离线可测的纯函数仍留在 `src/logic/`。
- `scanHistory` 的 N+1 `stat`：量级有限（默认只看最近 30 个目录），且原子写之后半截目录已不会出现，**不做内存缓存**（收益不抵复杂度）。

## 3. 「去 ntfy 改用 kaggle kernels logs」的实测结论

审计建议：废除外部中间人 `ntfy.sh`，改为解析 `kaggle kernels logs` 获取隧道端点。这里用两个
Kaggle CPU Kernel 实测了真实延迟（CPU Kernel 不消耗 GPU 配额；探针每 5 秒打印一条带 UTC
墙钟的心跳，宿主侧按固定间隔轮询）。

### 3.1 实测数据（2026-11-11，Kaggle CLI 2.2.5，国内网络）

| 场景 | 结果 |
| :--- | :--- |
| 非 follow：`kaggle kernels logs <kernel>`（Kernel 运行中） | **运行期间完全拿不到日志**：5.5 分钟里 19 次轮询全部 0 行；Kernel 结束后 61 条心跳一次性出现 |
| follow：`kaggle kernels logs -f <kernel>`（Kernel 运行中） | 实时流式到达：61 条心跳全部在运行期收到，首块输出在 CLI 启动后 4.1s |
| follow 的单条日志延迟（容器打印 → 宿主收到） | 1.41s ~ 1.86s（中位约 1.42s），持续 5 分钟稳定 |
| 单次 CLI 调用开销 | `status` 中位 4.0s（3.2~5.7s）；`logs` 中位 4.1s（3.5~5.7s）；`kaggle.exe` 进程启动本身就占 3~4s |

### 3.2 阈值判断

- **延迟不是障碍**：会合（rendezvous）只需要在容器启动后拿到一次端点，现有 `provisionMs` 45 分钟、`tunnelMs` 15 分钟的预算下，秒级延迟绰绰有余。
- **可用性才是障碍**：`-f` 是一条长驻 Python 连接，需要覆盖最长 3 小时的 Kernel 生命周期（`kernelRunMaxSec`）；断线是否自动重连、Kaggle 是否限流都未经验证。如果按审计方案**废除** ntfy，只是把「公共 ntfy 单点」换成「kaggle CLI 单点」，可用性没有提升，反而把「远端能自主广播」退化成「宿主必须一直挂着 CLI」。
- 建议的判定线（若要把它作为会合通道）：单条延迟 > 30s、或首次端点可见 > 60s 即不可接受；`-f` 的 1.5s 满足延迟要求，但**不满足"唯一通道"的可用性要求**。

### 3.3 决策

**保留 ntfy 作为主会合通道，本轮不替换。** 若将来要提升会合可用性，正确的做法是把
`kaggle kernels logs -f` 做成**第二通道兜底**（ntfy 连续失败/超时后才启用并行解析），而不是
替换主通道；那需要长驻进程监管、重连退避与真机长跑验证，属于独立改动。本轮已在
`docs/ARCHITECTURE.md` 记录的现有链路之外补上本节数据，供后续决策使用。

## 4. 本轮未做的事（有意为之）

1. 不替换 ntfy（见第 3 节）。
2. 不为 `scanHistory` 加内存缓存（见 2.3）。
3. 不做「独立翻译按钮」：意图解析已经保证英文 prompt，工作台额外加翻译入口属于产品增量，等真实用户反馈再定。
4. 真机 GPU 未复跑：Anima 拆分只保证「本地运行与打包内联后是同一份源码 + 产物可编译可 import」，推理数值路径未变但未上真机。建议后续跑一次 `node tools/verify-model.mjs --config models/anima-light-lavender.json --dry-run` 与一次真机 `imagen_generate` 冒烟。
