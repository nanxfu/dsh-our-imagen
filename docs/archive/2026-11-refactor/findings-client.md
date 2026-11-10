# 客户端（src/**）诊断：过度防御、低内聚与平行实现

> 分析范围：`src/**`（55 个文件 / 7705 行，其中 CSS 3267 行）。只读核查，未修改任何源码，未运行构建与测试。
> 不包含：构建产物 `client.js`、`test/.build/`、宿主端 `index.js` 与 `lib/*`（仅按需 grep 做存在性对照，不展开分析）、`remote/*.py`。
> 行号以当前工作区为准。`useStudio.js` 实际 709 行，与任务描述一致。

---

## 1. 区域清单与量化

### 1.1 代码分布

| 区域 | 文件数 | 行数 | 职责 |
|---|---:|---:|---|
| `src/studio/` | 14 | 2642 | 工作台组件与 `useStudio` 数据编排 |
| `src/styles/` | 10 | 3267 | 9 个 CSS 模块 + manifest（CSS 占全 src 42%） |
| `src/logic/` | 16 | 740 | 号称纯逻辑的规则模块 |
| `src/dict/` | 3 | 517 | zh / en 两份手写字典（各 218 键） |
| `src/hooks/` | 2 | 89 | `useHostState`（轮询）、`useNow`（秒级时钟） |
| `src/api.js`、`i18n.js`、`theme.js`、`constants.js`、`index.js`、`runtime.js`、`styles.js`、`test-entry.js` | 8 | 286 | 请求出口、翻译、宿主 token、入口与测试出口 |
| `src/components/` | 2 | 164 | 对话页徽章、悬浮提示 |

组件行数：`useStudio.js` 709、`Rail.jsx` 311、`Gallery.jsx` 293、`ChatPanel.jsx` 278、`TopBar.jsx` 220、`icons.jsx` 207、`Studio.jsx` 175、`Stage.jsx` 157、`GuidanceCard.jsx` 96、`Filmstrip.jsx` 91、`capsules.js` 46、`ratios.js` 20、`Toast.jsx` 13。

### 1.2 `useStudio.js` 承担的职责域（14 个）

| # | 职责域 | 主要行号 | 状态/函数 |
|---|---|---|---|
| 1 | i18n 与宿主桥接 | 53-63 | `translator`、`isEn`、`useHostState`、派生 `session/presets/activeJob` |
| 2 | 表单与预设 | 65-76、114-131、234-236、448-459、597-613 | `form`、`patchForm`、`ratioId`、`styleSuffix`、预设同步 effect |
| 3 | 会话启停 | 279-297 | `startSession`、`stopSession`、`busy` |
| 4 | 生成与请求编排 | 307-332、416-446 | `generate`、`reroll`、`iterate`、`retryFocusedJob` |
| 5 | 对话与意图解析 | 97-99、156-192、338-398 | `messages`、`interpret`、线程同步、澄清卡、`generateIntent` |
| 6 | 历史与画廊 | 89-90、133-144、205-227 | `historyItems`、`loadHistory`、`gallery`、`batches`、`selected` |
| 7 | 收藏库 | 91、146-154、461-483 | `favorites`、`loadLibrary`、`isFavorite`、`toggleFavorite` |
| 8 | 剪贴板/导出/删除 | 256-277、485-505、549-569 | `copyText`、`copyPath`、`deleteImages`、`exportPaths` |
| 9 | 提示词润色 | 92-94、571-600 | `refineGroups`、`enhance`、`toggleRefine`、`useInspiration` |
| 10 | 环境探测与配额 | 83-84、513-547、635-638 | `probing`、`probeReport`、`runProbe`、`quota/probe` 透传 |
| 11 | Toast / 错误 / 指引 | 85-87、238-254、615-628 | `toast`、`error`、`dismissed`、`fail`、`guidance*` |
| 12 | 视图/缩放/折叠态 | 78-80、96、100、400-406 | `view`、`zoom`、`panelMode`、`advancedOpen`、`negativeOpen` |
| 13 | 一次性提示与去重 | 194-212 | `firstImageRef`、`lastSeenRef` |
| 14 | 异步竞态防护 | 99-111 | `messageSeq`、`pendingRef`、`interpretingRef`、`aliveRef` |

### 1.3 同一 hook 的量化

- **hook 调用 38 次**：22 useState、6 useRef、8 useEffect、2 useCallback。
- **32 个函数声明**、**11 个 `await request(` 调用点**、**14 处 `aliveRef.current` 检查**。
- **返回对象 72 个字段**；唯一消费者 `Studio.jsx` 只用到 67 个，**5 个字段无消费者**（`preset`、`focusedJob`、`error`、`showToast`、`historyDone`，见 `useStudio.js:662/664/680/682/698`）。
- **7 个子组件共接收 94 个 props**：TopBar 18、Rail 21、ChatPanel 12、Gallery 11、Stage 12、Filmstrip 11、GuidanceCard 9；其中 `t` 重复传递 7 次。
- **0 个** `React.memo` / `useMemo` / `useReducer` / `useContext` / store（全 src 检索无命中）。
- **防御表达式（useStudio 单文件 709 行）**：15×`Array.isArray(`、13×`state && state.*`、10×`|| null`、5×`|| ''`、8×`typeof` 检查；src 全量对应为 23 / 19 / 23 / 21 / 66。

### 1.4 八个核查方向的结论速览

| 核查方向 | 结论 | 一句话 |
|---|---|---|
| useStudio 是否上帝 hook | 成立 | 14 个职责域、38 次 hook 调用、72 字段返回 |
| 组件是否被传整对象 | 部分成立 | 没有把 `studio` 整个下传，但等价地手工挑选了 94 个 props；无订阅粒度 |
| prop drilling 是否超过 2 层 | 不成立 | Studio 直接渲染全部子组件，深度为 1；问题是"宽"不是"深" |
| 重渲染边界是否失控 | 成立 | 无 memo/useMemo；顶层 `useNow` 每秒把整棵树重渲染一次 |
| `logic/*` 是否真纯逻辑 | 成立 | 不依赖 React/DOM，可离线 import；但业务逻辑仍散落在 6 个组件里 |
| `api.js` 与 hook 是否重复请求逻辑 | 成立且更严重 | `api.js` 只有通用 `request`，没有资源层；12 个端点、12 个调用点各自手写结果判断 |
| 无 store/reducer、ref 逃逸 | 成立 | 5 个 ref 在补"缺少事件/取消/派生"的洞，且竞态保护不一致 |
| 与宿主平行实现/漂移 | 成立 | 错误码缺 `generate_failed`、`session_error`；比例/风格常量两边各一份 |
| CSS 重复选择器/死选择器 | 基本不成立 | 179 个类名对 176 个 JS 引用，未发现死选择器；重复项都是同文件内的媒体查询覆盖 |
| dict 键漂移 | 键集合当前一致，风险成立 | 218 键×2 手写；69 个键只能运行时拼串访问，静态检查只能校验命名空间 |

---

## 2. 问题证据

格式：`[级别] 标题 —— 文件:行号（关键代码 ≤5 行）—— 为什么是问题`。
级别：P0=会直接导致缺陷或使重构无法推进；P1=显著增加改动成本/认知负担；P2=整洁度问题。

### A. 过度防御（以及它把失败静默成空界面）

- **[P0] 历史加载失败被当成"空历史"，错误状态无人消费** —— `src/studio/useStudio.js:133-140`（`if (result.ok && result.data && Array.isArray(result.data.items)) { ... }` / `setHistoryDone(true)`）；`src/hooks/useHostState.js:9,36-38` 把轮询失败写进 `error`，但 `useStudio` 只解构 `state`/`refresh`（`useStudio.js:55-57`），全 src 检索 `host.error` 为 0 次。
  —— 宿主重启或未就绪时，`historyItems` 保持 `[]`、`historyDone` 照常置真，画廊显示"暂无作品"（`Gallery.jsx:201-215`），顶栏显示离线，但用户看不到"加载失败"。且 `historyDone` 作为返回字段（`useStudio.js:698`）没有任何消费者，说明这条状态设计到一半就废弃了。
- **[P1] 一次失败有多套展示通道，没有统一错误模型** —— `useStudio.js:85-87`（`error`/`toast`）、`useStudio.js:531-545`（`setProbeReport` + `showToast` + `fail` 三个通道同时用）、`useStudio.js:493-501`（`showToast('已删除')` 与 `fail('delete_failed')` 并存）、`useHostState.js:9`（另一个 `error`，无人消费）。
  —— 探测失败会同时进入指引卡（`fail`）、顶栏弹层的 `probeReport`（`TopBar.jsx:54-56,153-158`）和 Toast；删除部分失败会同时弹成功 Toast 与失败指引卡。展示策略散在 hook 里逐处决定，无法保证"同一失败只出现一次"。
- **[P2] 请求层已统一判定，调用方又逐处复判** —— `src/api.js:31-41` 已保证返回 `{ok,status,code,message}` 或 `{ok,data}`，但 12 个调用点各自再判：`useStudio.js:134`、`147`、`282`、`292`、`317`、`345`、`410`、`471`、`488`、`521`、`578`，`useHostState.js:29`。其中 `loadHistory` 与 `loadLibrary`（`133-154`）是同一模式的两次拷贝。
  —— 结果判断不可复用，新增端点就是再抄一遍；任何"结果约定"变更要改 12 处。
- **[P2] 兜底密度高，但没有兜住真正会空的地方** —— `useStudio.js:497`（`const removed = Array.isArray(result.data.removed) ? ... : []`，直接访问 `result.data`）对照同一文件 `476`（`if (result.ok && result.data && ...)`）；`api.js:25-29` 明确允许 `ok:true` 时 `data` 为 `null`（响应非 JSON）。
  —— 全文件 51 处防御表达式，偏偏删除路径漏了 `data` 判空：宿主返回 204/非 JSON 时 `result.data.removed` 抛 TypeError，`Gallery.confirmDelete` 的 `await onDelete(...)` 变成未处理拒绝，界面停留在确认删除态且没有错误提示。
- **[P2] 组件依赖 service 的返回协议，且用哨兵值表达失败** —— `src/studio/Gallery.jsx:93-102`（`const result = await onDelete(picked)` / `if (result && Array.isArray(result.failed) ...)`）；`useStudio.js:493-504` 失败时 `return null`。
  —— 注释说"删除失败时保留选择"，但整体失败时返回 `null`，条件不成立会走 `exitSelect()` 清空选择；只有"部分失败"才保留。协议（`{removed,failed}` / `null`）没有类型或文档，组件只能猜。
- **[P2] 空值链让"未知"与"未启动"不可区分** —— `useStudio.js:59`（`const session = (state && state.session) || null`）、`60`（`sessionState = ... || 'absent'`）、`196`、`206`、`227`、`391`、`475`。
  —— `state` 尚未加载、请求失败、宿主明确回 `session:null` 三种情况都折叠成 `absent`，UI 无法区分"还没拉到状态"和"确实没有会话"，这也是上一条静默的根因。

### B. 低内聚、高耦合

- **[P1] 72 字段 god hook + 22 个独立 state，没有任何边界** —— `src/studio/useStudio.js:65-100`（22 个 useState 连续排布）、`630-708`（72 字段返回）。
  —— 一次提示词输入（`patchForm`，`234-236`）触发 Studio 及其全部子组件重渲染：`TopBar`（含弹层与全局键盘/指针监听）、`Rail`（311 行、受控 textarea）、`Stage`、`Filmstrip`（最多 60 个批次）。没有选择器或分片，下游无法只订阅自己需要的部分。
- **[P1] props 宽而无边界，且含重复与死传参** —— `src/studio/Studio.jsx:82-101`（TopBar 18 个）、`52-74`（Rail 21 个）、`103-113`（GuidanceCard 9 个）、`156-168`（Filmstrip 传了 `now`）；`src/studio/Filmstrip.jsx:9-20` 未解构 `now`。
  —— 94 个 props 里 `t` 出现 7 次、`mode/setMode` 在两套面板各一份；Filmstrip 的 `now` 是死传递。任何子组件新增一个能力都要回到 Studio.jsx 加一行，组件签名无法独立演进。
- **[P1] 重渲染边界完全失控：无 memo、派生值每次重建、回调每次新建** —— `src/studio/Studio.jsx:29`（`useNow(Boolean(s.activeJob))` 在顶层，生成期间每秒重渲染整页）、`65`（`onGenerate={() => s.generate()}`）、`131-134`（内联 `onOpen`）、`167`（内联 `onOpenGallery`）；`useStudio.js:214-227`（`gallery`/`batches` 每次重算）、`648-651`（返回对象里的内联箭头）、`667`（`selectImage` 内联箭头）、`687-690`（`refineGroups` 每次 map 出新数组）。
  —— 即使以后加了 `React.memo`，这些 prop 也永远是新引用，memo 不生效；而每秒重渲染的粒度应该是 Filmstrip 的计时文本，不是整页。
- **[P1] 状态归属不一致，切换视图/形态会丢状态** —— `useStudio.js:78-80,96,100` 把 `view/panelMode/zoom/advancedOpen` 放在 hook；`Gallery.jsx:46-51` 的搜索、预设过滤、只看收藏、批量选择、确认删除 6 个状态放在组件；`ChatPanel.jsx:56` 的 `draft` 放在组件。
  —— 切到表单模式再切回对话，草稿丢失；切到画廊再回创作，筛选与选择丢失。同一类"界面态"被拆到两处存放，没有原则。
- **[P1] 会话状态有两套映射，主界面用的是没人测的那套** —— `src/studio/TopBar.jsx:10-17`（`sessionPill` 自己把 state 映射成 ok/warn/error/idle 与文案）、`50-62`（配额与探测状态又映射一遍）；`src/logic/view.js:8-52` + `logic/status.js:6-31` + `logic/color.js:5-10` 是另一套，只被 44 行的 `StatusChip.js` 使用。
  —— 两套判断已经出现分歧：`view.js:13-15` 根据 `session.error.code` 区分 `session_ended`/`warming` 并改标题，`TopBar.sessionPill` 只看 `session.state`，所以"会话已结束"在对话页徽章和顶栏是两个说法。`logic/status.js` 与 `logic/view.js` 因此只服务一个次要挂载点，却在测试里被重点覆盖（`test/check-client-logic.mjs:113-170`）。
- **[P2] 业务映射留在组件里，且与 hook 的规则不一致** —— `TopBar.jsx:192-206`（下拉切预设时直接写 `width/height/steps/cfg`，不做钳制）对照 `useStudio.js:114-131`（同一动作在预设同步 effect 里用 `clampSize/clampInt/clampNumber`）。
  —— 两条路径落出的表单值可能不同；组件里的这条还绕过了 `logic/clamp.js` 的 SPEC 约束。同类还有 `Stage.jsx:16-18` 的提示词回退（与 `logic/recall.js:33-35` 重复）、`Gallery.jsx:30-36` 的尺寸回退（与 `recall.js:36-41` 重复）、`Gallery.jsx:16-22,56-71` 的分桶与过滤（本可放 `logic/` 直接单测）。
- **[P2] React 入口约定被违反** —— `src/runtime.js:1-6` 声明"组件模块统一从这里取 React"，实际 12 个文件 `import React from 'react'`，只有 `useHostState.js`、`useNow.js`、`StatusChip.js` 走 `runtime.js`。
  —— 该约定存在的意义是适配宿主冻结的共享模块表，现在等于没有约定；测试替身替换 React 时也是靠 bundle 的 module loader，不靠这个入口。
- **[P2] 死字段、死分支、死注释** —— `useStudio.js:662,664,680,682,698`（5 个无人使用的返回字段）；`ChatPanel.jsx:75`（`message.onOpen` 在 src 中没有生产者）；`logic/jobs.js:13`（`pickFocusedJob` 仅测试引用）；`logic/jobs.js:23-26`（注释描述已搬到 `view.js` 的会话区逻辑）；`constants.js:5-10`（"1. 文案字典"标题下没有任何字典常量）；`icons.jsx` 32 个图标中 `sun/dot/message/dots/plus` 5 个无引用；`Rail.jsx:59` 的 `ofs-panel--form` 在所有 CSS 中无定义。
  —— 小项不致命，但会误导后来者以为这些路径仍在使用。

### C. 意大利面条式流程

- **[P1] 一个用户动作要穿透 6 个副作用** —— `useStudio.js:307-332`（`generate`）：`setSending(true)` → `request` → `setSending(false)` → `pushMessages` → `refresh()` → `loadHistory()` → `showToast()`。
  —— 没有 action/意图概念，状态更新分散在 12 个 async 函数与 2 个异步 useCallback 里；成功路径平均 4~5 个 setState，失败路径再走 `fail()`。想加"提交后禁止切换视图"这类规则，需要改这里的所有路径。
- **[P1] 同 tick 双提交保护只加在一处，其余靠 state 标志** —— `useStudio.js:338-349`（`interpret` 用 `interpretingRef` 挡同一 tick 的第二次回车）；而 `useStudio.js:308`（`if (sending) return`）、`useStudio.js:280`（`startSession`）、`useStudio.js:290`（`stopSession`）、`useStudio.js:572`（`enhance`）只判断 state。
  —— state 在同一 tick 内不会更新，双击"立即生成"或双击意图卡的"按此生成"会发出两个 POST；宿主侧排队后产生两条重复任务与两条对话气泡。作者显然知道这个问题（`interpret` 修了），但没有统一机制。
- **[P1] 乐观更新没有并发语义** —— `useStudio.js:465-483`（先 `setFavorites` 翻转，再请求，成功后用返回列表覆盖，失败回滚）。
  —— 连续点两个收藏（或收藏后立刻取消）时两个请求都在飞，返回顺序不定；后到的旧列表会覆盖新状态。没有请求序号或"以最后一次操作为准"的收敛逻辑。
- **[P2] 用 effect 模拟"事件"** —— `useStudio.js:156-192`（任务状态同步进对话气泡，deps 只给 `threadJobKey` 却读 `messages.length` 和 `t`）、`194-203`（首图 Toast 用 `firstImageRef` 一次性标记）、`205-212`（任务完成后刷新历史，用 `lastSeenRef` 去重）。
  —— 三个"发生一次"的语义各配一个 ref 和一个 effect，依赖数组靠手工维护；这也是 6 个 ref 中有 3 个的来源。
- **[P2] 长函数与大组件** —— `useStudio.js` 709 行 / 32 个函数；`Rail.jsx` 311 行单组件渲染 5 个分区；`Gallery.jsx` 293 行同时做展示、过滤、选择与删除协议；`Studio.jsx` 175 行内 5 处内联回调。
  —— 阅读任一行为都要跨 2~3 个文件、跳转 10 次以上，认知负担已经超过文件体积本身。
- **[P2] 复制粘贴的结构与工具函数** —— `Rail.jsx:62-81` 与 `ChatPanel.jsx:162-181` 的模式切换 tab 20 行逐字重复；`useStudio.js:256-269`（`copyText`）与 `549-569`（`exportPaths`）各自实现一遍 `navigator.clipboard` 探测与降级。
  —— 改文案或改降级策略要同步两处，且没有测试覆盖剪贴板路径。

### D. 重复与漂移

- **[P0] 测试渲染器只实现 4 个 hook API，任何 store/reducer/memo 化重构都会在测试里失效** —— `test/load-client.mjs:51-80`（React 替身只有 `createElement/useState/useRef/useEffect/useCallback`，没有 `useReducer/useMemo/memo/useContext/useSyncExternalStore`）；`test/load-client.mjs:137`（`serializeTree` 把函数组件当普通函数调用）与 `230-232`（`collectText` 同理）。
  —— 现有渲染测试只让顶层 `Studio` 走真正的 hook 槽位，子组件是在序列化阶段被直接调用的，它们的 hooks 落到同一个全局 `slotIndex` 上（`TopBar/ChatPanel/Tooltip/Gallery` 都有 hooks）。这意味着：把 `useStudio` 拆成子组件里调用的多域 hook、或引入 reducer/context，测试要么直接抛错，要么在假语义下"通过"。重构前必须先升级这个替身，否则安全网失效。
- **[P0] 客户端缺宿主会发出的错误码文案** —— 宿主 `lib/jobs.js:249`（`let code = error?.code ?? sessionError?.code ?? 'generate_failed'`）、`lib/session.js:677`（`code: this.session.error?.code ?? 'session_error'`）；客户端字典只有 `error.code.generation_failed`（`src/dict/zh.js:66`），没有 `generate_failed` 与 `session_error`；`src/logic/error.js:9-13` 在查不到文案时直接回落到宿主 `message`。
  —— 宿主出图失败（最常见的失败路径）时，英文界面会显示宿主返回的中文 message；`logic/guidance.js:29-30` 又把 `generate_failed` 当作"可重试"码，说明客户端知道这个码存在，只是文案表没跟上。这是已经可观测的跨端漂移。
- **[P1] 客户端内部三套平行实现** ——
  1. 会话态：`TopBar.jsx:10-17` ↔ `logic/view.js:8-52`（见 B 组同名条目）；
  2. 尺寸/钳制：`src/studio/ratios.js:18-20`（`ratioToSize` 内部再调 `clampSize`）与 `logic/clamp.js:15-19` 各算一次；`TopBar.jsx:192-206` 完全绕过钳制；
  3. 预设应用：`useStudio.js:114-131` 与 `TopBar.jsx:192-206`（见 B 组）。
  —— 三处都是"同一业务规则写两遍、其中一遍没走约束"，后续加预设字段（例如新的 `tier`）必然漏一处。
- **[P1] 客户端与宿主的常量表各写一份** —— 宿主 `lib/intent.js:12`（`RATIO_IDS`）、`20-26`（风格 id 列表与约束）；客户端 `src/studio/ratios.js:10-16`（`DEFAULT_RATIOS`）、`src/studio/capsules.js:10-46`（5 个 `STYLE_CAPSULES`）。两边靠字符串 id 对齐，没有共享 schema 或生成步骤。
  —— 客户端新增一个比例或风格，宿主会静默归一化成空值（`lib/intent.js:61`），用户看到"已选风格但出图没带"；这是典型的双写漂移点。
- **[P1] 路由清单两端不一致，且客户端没有路由常量** —— 宿主 `index.js:176-437` 注册 15 条 `/imagen-api/*`；客户端只调用 12 条，`/imagen-api/job` 与 `/imagen-api/jobs` 无人使用；12 条路径以字符串字面量散落在 12 个调用点（`useStudio.js:134,147,282,292,317,345,410,471,488,521,578` 与 `useHostState.js:29`）。
  —— 路由改名只能靠全文搜索；也无从判断某个宿主路由是否还有客户端在用。
- **[P1] 字典双写 + 69 个动态键，静态检查只能校验命名空间** —— `src/dict/zh.js` 与 `en.js` 各 218 键、各约 14.6KB 手写，本次核对键顺序完全一致；其中 69 个键（32%）只能通过运行时拼串访问：`session.state.*`、`session.phase.*`、`session.hint.*`、`job.status.*`、`error.code.*`、`studio.style.*`、`studio.inspire.*`、`studio.gallery.{today,week,earlier}`、`studio.refine.*`。`test/check-client-locale.mjs:56-60` 只能检查静态 `t('...')` 与"动态键命名空间是否已定义"（`^\w+\.\$\{` 那一段），无法枚举实际取值。
  —— 宿主新增一个细化维度（如 `enhance` 新增 `mood` 维度，`lib/enhance.js:12` 当前是 4 个）或新增错误码时，界面会直接显示 `studio.refine.mood` 这样的原始键或宿主中文原文；这正是该检查脚本存在的理由，也说明当前结构无法自动发现。
- **[P2] 字典命名空间不统一** —— `studio.*` 占 156 键（72%），其余混用 `workbench.*`（3）、`session.*`、`job.*`、`action.*`、`chip.*`、`value.*`、`unit.*`、`error.*`；`zh.js:10-11` 有只剩注释的"连接指引"空节。
  —— 这些是旧工作台实现的遗留命名，增加了查找成本；"按功能分区"的注释块与实际前台（studio）不对应。
- **[P2] 样式层的小漂移，但不是主要矛盾** —— `.ofs-panel--form` 在 JSX 使用但无 CSS；`.ofs-tip--info`（`Tooltip` 默认 tone）无定义、依赖 `.ofs-tip` 默认样式；动态类名 `ofs-ratio-glyph--${id}`、`ofs-tip--${tone}`、`is-${capsule.id}` 无法静态校验。静态对照结果：CSS 中 179 个 `ofs-*` 类名、JS 中 176 个引用，6 个"仅 CSS 出现"的类名都可由上述动态拼串解释，3 个"仅 JS 出现"的类名是前缀片段或无样式钩子，**未发现真正的死选择器**；`gallery.css:496-557`、`responsive.css` 的重复选择器均为媒体查询覆盖，属正常写法。CSS 的问题是断点分散在 10 个文件里（每个 CSS 自带 `@media` 块 + 独立 `responsive.css`），而不是冗余。

---

## 3. 现有测试/文档提供的安全网与阻塞点

### 3.1 安全网（只读判断）

| 文件 | 规模 | 保护什么 | 局限 |
|---|---:|---|---|
| `test/check-client-logic.mjs` | 536 行 | `logic/*` 的行为：钳制、格式化、任务挑选、阶段提示、错误文案、会话视图、探测归一化、润色标签、意图映射、tooltip 定位 | 通过 `import * as logic from '../src/logic/index.js'` 全量导入，模块增删改名即失效；覆盖了 `pickFocusedJob`（生产无调用）与 `buildSessionView`（只服务 StatusChip），测试重心与实际热路径不一致 |
| `test/check-client-render.mjs` | 450 行 | 每次运行重新构建 test bundle（`:273`）；10 个场景的整树渲染哈希（`:376-398`）；关键文案与 class 数量断言（`:392-394`）；直接以 11 个 props 挂载 `Gallery`（`:360-372`）并触发三个动作回调（`:402-441`） | 快照粒度是整棵树，任何 DOM 结构、class、prop 名变化都会改变哈希，只能 `--update` 后人工肉眼复核；`Gallery` 的 prop 集合被测试硬编码 |
| `test/load-client.mjs` | 289 行 | 假 `window/React/fetch/定时器`，按 pathname 供响应，固定 `Date.now` | React 替身只有 4 个 hook（见 D 组 P0）；`:263-268` 仍导出 `Workbench`/`Lightbox`/`KEYFRAMES`，这些已在 `src/test-entry.js` 中不存在；`:8` 注释仍称"Workbench 持有全部 hook" |
| `test/check-client-locale.mjs` | 83 行 | zh/en 键集合一致、静态 `t()` 引用存在、动态键命名空间已定义；并要求 `client.js` 含全部中文文案（`:68-73`） | 无法校验动态键的实际取值；修改字典后必须重新构建产物，否则该检查失败 |
| `src/test-entry.js` | 46 行 | 测试专用出口，暴露 9 个组件、logic、api、i18n 等 | 任何组件改名/拆分都要同步这里 |

结论：现有安全网保护的是"当前形状"（DOM 结构、prop 名、字典键）多于"行为正确"（交互路径、竞态、失败态）。`generate` 的重复提交、`toggleFavorite` 的乱序、静默历史失败都没有测试覆盖。

### 3.2 阻塞点（重构前必须处理）

1. **[P0] 测试渲染器能力不足**（`test/load-client.mjs:51-80`）：没有 `useReducer/useMemo/memo/context/useSyncExternalStore`，且子组件在 `serializeTree/collectText` 中作为普通函数调用（`:137`、`:230-232`）。"拆成多个域 hook"或"引入 store/reducer"两类方案目前无法被测试验证，甚至会让测试以错误语义通过。
2. **[P1] 整树哈希快照**（`test/render-golden.json` 10 个场景 + `check-client-render.mjs:376-398`）：重构必然改动 DOM/class/prop，届时只能整份 `--update`，失去回归价值。需要在重构前把快照改为"关键结构 + 文案 + 角色"的断言。
3. **[P1] 测试对内部形状的直接依赖**：`check-client-render.mjs:360-372` 硬编码 `Gallery` 的 11 个 props；`src/test-entry.js:31-45` 硬编码组件导出名。拆分组件或改签名必须同步这两处。
4. **[P1] 构建产物参与文案检查**：`check-client-locale.mjs:68-73` 读 `client.js`，字典改动后必须先 `build.mjs` 才能通过检查（这是行为约定，不是缺陷，但会拉长每次改动循环）。

---

## 4. 候选重构方向

> 未给完整设计。每条只写清切哪些边界、收益、代价、风险。建议顺序：先 1，再 2，然后 3/5，最后视收益决定 4。

### 方向 1（前置）：升级测试替身与快照策略

- **切边界**：`test/load-client.mjs` 的 React 替身补齐 `useReducer/useMemo/useContext/memo/useSyncExternalStore`，并让子组件也在受控的 hook 作用域内渲染（或引入最小自定义渲染器）；`check-client-render.mjs` 的整树哈希改为"关键 class 列表 + 文案 + 可访问性角色"的结构断言，golden 文件按区域拆分。
- **收益**：后续所有拆分才有可能被验证；快照从"全量否决"变成"局部回归"。
- **代价**：改 2 个测试文件、重录 golden；假渲染器要逼近 React 语义，维护成本上升。
- **风险**：自研渲染器始终不是 React，复杂交互（受控输入、事件）覆盖有限；需明确"只验证静态结构，不验证交互"的分工，交互另测。

### 方向 2：请求编排收回 `src/api.js`（资源层）

- **切边界**：新增资源函数（或 `src/services/`）：`loadState/loadHistory/loadLibrary/startSession/stopSession/generate/probe/enhance/intent/reveal/libraryFavorite/libraryDelete`；每个函数负责 URL、方法、请求体、`ok` 判定、响应形状校验，并把失败统一成一种结果（`{ok:false,error}` 或抛 `AppError`）。`useStudio`/`useHostState` 不再出现字符串路径与 `result.data.*` 判断。
- **收益**：12 个端点的路径与结果判断从 12 处收成 1 处；错误码→文案/指引映射有唯一入口；宿主路由与客户端调用可一张表对照。
- **代价**：新增 1~2 个文件；`useStudio` 中所有请求调用（11 处 `await request`）都要改；需为资源层补少量单测（可复用现有 fetch 替身）。
- **风险**：低。URL 不变则 `load-client.mjs` 的 pathname 供数机制不受影响；风险在于不要把 UI 语义（toast、guidance）也塞进资源层。

### 方向 3：按域拆 `useStudio`（不开 store 也能做）

- **切边界**：拆 4~5 个 hook：`useStudioForm`（表单/预设/风格/比例/润色）、`useSessionControl`（start/stop/probe/busy + host 状态消费）、`useWorkLibrary`（history/favorites/delete/export）、`useChatThread`（messages/interpret/clarify/意图生成）、`useStudioUi`（view/zoom/panelMode/toast/error/guidance）。跨域依赖用显式参数传入（`generate` 需要 `form` 与 `styleSuffix`，由 form 域导出 `buildBody()`），不共享闭包。
- **收益**：709 行降到 5×120 行左右；每个域可独立单测；`historyDone`、`preset` 这类死字段在拆分时自然消失。
- **代价**：`Studio.jsx` 需要组合 5 个 hook；跨域动作（`iterate` 改 form + view + toast）要在组合层粘合；仍要手工挑 props 给子组件（除非同时做方向 4）。
- **风险**：中。hook 间存在隐式顺序依赖（presets 同步要在 form 初始化后、generateIntent 要读 messages），拆的时候容易把 effect 依赖弄错；必须先完成方向 1，否则测试无法验证拆分结果。

### 方向 4（可选，收益最大也最贵）：最小 store + 域对象 props

- **切边界**：把 22 个 useState 合并为 4 个 reducer slice（form / jobs+session / chat / ui），用 `useReducer` 或一个 30 行的 `useSyncExternalStore` store 持有；组件按域接收 4~6 个分组对象而非 12~21 个散 props；`t` 通过一次注入或模块级 translator 获取，不再逐层传。
- **收益**：重渲染边界显式（选择器）；props 从 94 降到约 30 且按域聚合；去掉 72 字段返回对象。
- **代价**：新抽象 + 测试替身改造（依赖方向 1）；全部组件签名改动，10 个渲染快照全部重录；需要确认宿主提供的 React 版本是否支持 `useSyncExternalStore`（`runtime.js` 只说由平台共享模块提供，版本待验证）。
- **风险**：中高。收益主要在性能和可维护性，不在功能；如果近期还有功能迭代，建议先做 2+3+5，把这个放到功能间歇期。

### 方向 5：错误/提示统一 + 组件业务逻辑回迁 `logic/`

- **切边界**：
  1. 定义单一错误模型（`{code,message,source:'local'|'session'|'job'|'probe'}`）与单一展示策略（指引卡 / Toast / 内联三选一），消除 `probeReport + error + toast + host.error` 四套并行；`loadHistory/loadLibrary` 失败进入错误态而非空态。
  2. 把 `applyPreset(form,preset)`、`bucketOf/时间分组`、`promptOf/sizeOf` 等映射移入 `logic/`；`Rail` 的数值输入改为经 `clamp*` 包装的受控值；`TopBar` 改为复用 `applyPreset`。
  3. 补齐 `error.code.generate_failed` / `error.code.session_error` 文案，并在客户端 `logic/` 里补一张与宿主错误码对齐的映射表（可作为方向 2 的产物）。
- **收益**：消除静默失败与双重提示；三处重复映射收敛；`logic/` 的单测覆盖面扩大（多数映射变成纯函数）。
- **代价**：动 `GuidanceCard`/`TopBar`/`Gallery`/`Stage`/`Rail` 五个组件，快照需更新；错误模型改动会触及对话气泡的错误展示。
- **风险**：低到中。可与方向 2 并行；主要风险是展示策略调整会改变现有测试断言的文案，需要同步 `check-client-render.mjs` 的 `expect/reject`。

---

## 5. 一句话结论

客户端能稳定运行，但没有真正的运行时缺陷级"烂摊子"——真正的债是**形状被焊死**：`useStudio` 用 22 个 state 和 72 个字段把 14 个职责域绑成一个对象，`Studio.jsx` 再把它手工拆成 94 个 props；而唯一的安全网是一个只支持 4 个 hook API 的假渲染器和 10 份整树哈希快照，任何拆分都会先撞上测试。建议的次序是：**先升级测试替身与快照（否则动不了）→ 把 12 处请求编排收回 `api.js` → 按域拆 hook → 最后再讨论 store 与错误模型统一**；其中"错误码 `generate_failed`/`session_error` 缺文案"和"历史加载失败静默成空界面"是当前就有用户可见影响的两处，可随方向 2/5 顺带修掉。