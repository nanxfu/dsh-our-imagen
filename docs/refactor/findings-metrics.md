# 重构量化底稿（findings-metrics）

> 目的：为「过度防御 / 低内聚高耦合 / 意大利面条式代码」这一用户判断提供可复现的量化依据。
> 本文件**只做统计，不做重构**；所有结论都可按第 0 章的命令/口径重跑。
> 分析对象为当前工作树（HEAD `743b588`，package.json `0.3.0`），统计时间 2026-11-10。

## 0. 口径与复现方式

| 项目 | 说明 |
| --- | --- |
| 分析范围 | `index.js`、`lib/*.js`（15）、`src/**/*.js(x)`（46）、`remote/*.py`（2）、`test/*.{mjs,py}`（14）、`tools/preview.mjs`、`build.mjs`、`docs/*.md` |
| 排除 | `client.js`（构建产物，只统计文件大小/行数，不读内容）、`bench-results/`、`test/.build/`、`tools/.preview/`、`__pycache__/`、`node_modules/` |
| 脚本位置 | 全部临时脚本写在 `%TEMP%`（`fi-analyze.ps1` / `fi-report-*.ps1` / `fi-py-and-exports.ps1` / `fi-gen-md.ps1`），**未落入仓库** |
| 行数口径 | `(Get-Content <file>).Count`（含空行）。与 `wc -l`/`Measure-Object -Line` 有 ±空行数差异 |
| 非空行口径 | 去掉字符串/注释内容后仍有非空字符的行（掩码算法见 3.1 / 附录 A.1） |
| 估算标注 | 表中凡标「近似」的列都是启发式统计，不是编译级 AST 结果，详见 2.1 与附录 A |

复现要点（PowerShell 7，工作区根目录执行）：

```powershell
# 1) 依赖图 + 复杂度原始数据（脚本在 %TEMP%，见附录 A）
& "$env:TEMP\fi-analyze.ps1"          # -> %TEMP%\fi-analyze.json（63 文件 / 179 条 import）
& "$env:TEMP\fi-report-graph.ps1"     # fan-in/out + 环检测
& "$env:TEMP\fi-report-complex.ps1"   # 复杂度表
& "$env:TEMP\fi-py-and-exports.ps1"   # Python 指标 + 死导出扫描

# 2) 契约字符串
git grep -n "/imagen-api/"                     # 路由字面量
git grep -n "error\.code\.\|sendError("        # 错误码
git grep -n "sdxl-lightning\|flux2-klein-4b"   # 预设 id

# 3) 卫生
git ls-files | Measure-Object                  # 115 个文件
git check-ignore -v -- bench-results test/.build tools/.preview __pycache__
git ls-files --others --exclude-standard       # 应为空
```

## 1. 结论摘要（先看这一页）

| 指标 | 数值 | 含义 |
| --- | ---: | --- |
| 跟踪文件 / 总字节 | 115 / 1,065,072 B | `git ls-files` 合计 |
| 手写代码行（不含 CSS/文档/client.js） | ≈ 14,559 | 宿主 3,240 + 客户端 JS/JSX 4,456 + 远端 1,345 + 测试 4,857 + 工具 661 |
| CSS 行 / 文档行 / 构建产物行 | 3,249 / 1,538 / 3,633 | 文档 10 篇；client.js 3633 行、248,311 B（占仓库字节 23.3%） |
| import 语句（文件级去重后） | 179 条（144 内部 + 35 外部） | 内部边：src 118、lib 13、index→lib 10、tools 3 |
| **循环依赖** | **0** | DFS 全图检测（附录 A.2） |
| **跨层依赖 src→lib / lib→src** | **0 / 0** | 客户端与宿主代码零直接耦合（契约只通过 HTTP/JSON 字符串） |
| 最大单文件 | `src/studio/useStudio.js` 709 行 / `lib/session.js` 703 行 / `index.js` 570 行 | 三处占宿主+客户端代码量的 21.9% |
| 最大单函数 | `useStudio` **658 行**（占该文件 92.8%）；其后 `index.js` 的 `apply()` **470 行**、Rail 282、Gallery 250 |
| catch 总数（JS） | 52（另 31 个 `.catch()`） | 其中**吞掉型 24 个（46.2%）**：空 10 + 只 return 假值 14 |
| catch / except（Python） | 59 个 except（daemon.py 占 39） | 其中 `pass` 14 个、仅打日志 10 个 |
| 兜底链（`||`+`??`+`?:`，近似） | 806 条 | `||` 228、`??` 126、`?:` 452；useStudio 一个文件 95 条 |
| HTTP 路由字面量 | 15 条路由、**113 处字符串、12 个文件**（带 `/imagen-api/` 前缀 101 处 + 客户端相对路径 12 处） | 14/15 条路由在 ≥3 个文件重复；`/jobs` 仅 2 处 |
| 错误码（字符串级） | 38 个（宿主 27 + 远端新增 4 + 客户端自造 7） | 客户端字典只提供 **24** 个文案；SPEC 记录 23 个 |
| 预设参数定义点 | 6 处（canonical 1 处 + 测试/预览/bench/文档 5 处） | 其中 2 处数值与 canonical 不一致 |
| 版本号定义点 | 7 处、2 个值 | 插件/包/CHANGELOG = 0.3.0；`remote/daemon.py`、kernel 配置、mock/probe = 0.2.0 |
| 死导出 / 死文件 | 3 个死导出 + 1 个 129 行死文件 | `errorShape`、`copyMockDaemon`、`httpJson`；`remote/worker.py` 全仓 0 引用 |

**一句话**：数据支持的问题集中在 **3 个单体函数/类（useStudio、SessionManager、daemon.py）+ 契约字符串的多处副本**；数据**不支持**“全仓意大利面条”和“全仓过度防御”的说法（依赖图无环、无跨层违规，catch 高度集中在 12 个 lib 文件）。

---

## 2. import 依赖图

### 2.1 口径与方法

- 正则提取 ESM 静态 `import ... from '...'`、`export ... from '...'`、动态 `import('...')`，共 179 条语句；相对路径按文件所在目录解析成仓库相对路径，`node:*` 与裸包记外部依赖。
- fan-out = 该文件 import 的**去重目标数**（含外部依赖）；fan-in = 仓库内有多少文件 import 它。
- 环检测：建邻接表后 DFS 三色标记（附录 A.2）。**结果：0 个环。**
- 跨层统计：按 `index.js` / `lib/` / `src/` / `remote/` 前缀归类。

### 2.2 分层结构

```
index.js (11 imports) ──► lib/*.js (13 条 lib 内部边, 无环)
                             │  http/net/remote/session/kaggle/kernel/jobs/output/library/paths
                             ▼
                          remote/daemon.py（只通过「嵌入配置字符串 + HTTP + ntfy」通信，无 import 关系）

src/index.js ─┬─► src/studio/Studio.jsx ──► 11 个子组件
              ├─► src/hooks/useHostState.js ──► src/api.js（唯一 fetch 出口）
              └─► src/logic/*.js（15 个纯函数模块，经 src/logic/index.js 聚合）
src → lib 的 import 数 = 0；lib → src = 0。
```

### 2.3 fan-in / fan-out 全表（63 个文件，按分层排序）

> fan-out 计入外部包与 `node:` 内置模块；`index.js` 的 11 = 10 条内部（10 个 lib 模块）+ 1 条 `node:fs/promises`。

| 文件 | fan-out | fan-in | 依赖目标（fan-out） |
| --- | ---: | ---: | --- |
| `index.js` | 11 | 0 | node:fs/promises, lib/http.js, lib/enhance.js, lib/intent.js, lib/jobs.js, lib/kaggle.js, lib/library.js, lib/output.js, lib/paths.js, lib/presets.js, lib/session.js |
| `lib/enhance.js` | 1 | 1 | lib/json.js |
| `lib/http.js` | 0 | 1 | |
| `lib/intent.js` | 1 | 1 | lib/json.js |
| `lib/jobs.js` | 4 | 1 | node:crypto, lib/output.js, lib/presets.js, lib/remote.js |
| `lib/json.js` | 0 | 2 | |
| `lib/kaggle.js` | 0 | 2 | |
| `lib/kernel.js` | 4 | 1 | node:fs/promises, node:os, node:path, node:url |
| `lib/library.js` | 3 | 1 | node:fs/promises, node:path, lib/paths.js |
| `lib/net.js` | 0 | 2 | |
| `lib/output.js` | 3 | 2 | node:fs/promises, node:path, lib/paths.js |
| `lib/paths.js` | 2 | 3 | node:fs/promises, node:path |
| `lib/presets.js` | 0 | 3 | |
| `lib/remote.js` | 1 | 2 | lib/net.js |
| `lib/session.js` | 6 | 1 | node:crypto, lib/kernel.js, lib/kaggle.js, lib/net.js, lib/presets.js, lib/remote.js |
| `src/api.js` | 0 | 3 | |
| `src/components/StatusChip.js` | 8 | 2 | src/runtime.js, src/theme.js, src/i18n.js, src/logic/status.js, src/logic/color.js, src/logic/jobs.js, src/logic/view.js, src/hooks/useHostState.js |
| `src/components/Tooltip.jsx` | 2 | 2 | react, src/logic/tooltip.js |
| `src/constants.js` | 0 | 5 | |
| `src/dict/en.js` | 0 | 1 | |
| `src/dict/index.js` | 2 | 3 | src/dict/zh.js, src/dict/en.js |
| `src/dict/zh.js` | 0 | 1 | |
| `src/hooks/useHostState.js` | 3 | 2 | src/runtime.js, src/api.js, src/logic/jobs.js |
| `src/hooks/useNow.js` | 1 | 1 | src/runtime.js |
| `src/i18n.js` | 1 | 5 | src/dict/index.js |
| `src/index.js` | 5 | 1 | src/constants.js, src/dict/index.js, src/components/StatusChip.js, src/studio/Studio.jsx, src/studio/StudioIcon.jsx |
| `src/logic/clamp.js` | 0 | 4 | |
| `src/logic/color.js` | 1 | 3 | src/theme.js |
| `src/logic/error.js` | 1 | 2 | src/i18n.js |
| `src/logic/format.js` | 0 | 5 | |
| `src/logic/generate.js` | 2 | 2 | src/logic/clamp.js, src/logic/prompt.js |
| `src/logic/guidance.js` | 0 | 2 | |
| `src/logic/index.js` | 15 | 1 | 15 个 logic 模块（桶文件，仅被 test-entry 使用） |
| `src/logic/intent.js` | 0 | 2 | |
| `src/logic/jobs.js` | 1 | 4 | src/constants.js |
| `src/logic/probe.js` | 1 | 3 | src/logic/guidance.js |
| `src/logic/prompt.js` | 0 | 3 | |
| `src/logic/recall.js` | 0 | 2 | |
| `src/logic/refine.js` | 0 | 2 | |
| `src/logic/status.js` | 2 | 3 | src/constants.js, src/i18n.js |
| `src/logic/tooltip.js` | 0 | 2 | |
| `src/logic/view.js` | 4 | 2 | src/constants.js, src/theme.js, src/logic/status.js, src/logic/color.js |
| `src/runtime.js` | 1 | 4 | react |
| `src/studio/capsules.js` | 0 | 3 | |
| `src/studio/ChatPanel.jsx` | 3 | 2 | react, src/studio/icons.jsx, src/studio/capsules.js |
| `src/studio/Filmstrip.jsx` | 3 | 2 | react, src/studio/icons.jsx, src/logic/format.js |
| `src/studio/Gallery.jsx` | 2 | 2 | react, src/studio/icons.jsx |
| `src/studio/GuidanceCard.jsx` | 2 | 1 | react, src/studio/icons.jsx |
| `src/studio/icons.jsx` | 0 | 7 | |
| `src/studio/Rail.jsx` | 5 | 2 | react, src/components/Tooltip.jsx, src/studio/icons.jsx, src/studio/capsules.js, src/studio/ratios.js |
| `src/studio/ratios.js` | 1 | 2 | src/logic/clamp.js |
| `src/studio/Stage.jsx` | 3 | 2 | react, src/studio/icons.jsx, src/logic/format.js |
| `src/studio/Studio.jsx` | 13 | 2 | react, src/styles.js, src/hooks/useNow.js, src/logic/format.js, 7 个子组件, useStudio |
| `src/studio/StudioIcon.jsx` | 1 | 3 | react |
| `src/studio/Toast.jsx` | 1 | 1 | react |
| `src/studio/TopBar.jsx` | 5 | 2 | react, src/components/Tooltip.jsx, src/studio/icons.jsx, src/studio/StudioIcon.jsx, src/logic/probe.js |
| `src/studio/useStudio.js` | 16 | 1 | react, src/api.js, src/hooks/useHostState.js, src/i18n.js, 10 个 src/logic/*, capsules, ratios |
| `src/styles.js` | 9 | 1 | 9 个 CSS 文件 |
| `src/styles/manifest.js` | 0 | 1 | |
| `src/test-entry.js` | 17 | 0 | 5 个 src 入口 + 10 个组件 + 2 个 logic 桶（测试用总出口） |
| `src/theme.js` | 0 | 4 | |
| `build.mjs` | 4 | 1 | node:fs/promises, node:path, node:url, esbuild |
| `tools/preview.mjs` | 8 | 0 | node:*, build.mjs, src/styles/manifest.js, test/load-client.mjs |

### 2.4 循环依赖

**0 个。** 检测方法：邻接表 + DFS 三色标记（脚本见附录 A.2）。手工复核的“近似环”只有两处，均不构成环：

- `src/logic/index.js` 是桶文件（fan-out 15、fan-in 1），但只有 `src/test-entry.js` 用它；生产组件都直接 import 具体模块 → 桶文件是测试专用层，不是循环源。
- `src/studio/Studio.jsx`（fan-out 13）与 `useStudio.js`（fan-out 16）是唯一的双向“高频对”：Studio 传入 hooks 返回值，useStudio import 组件常量（`capsules/ratios`）——方向单向，无环。

### 2.5 跨层依赖

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `src/` import `lib/` | **0** | 客户端不直接依赖宿主模块 |
| `lib/` import `src/` | **0** | |
| `index.js` → `lib/` | 10 个内部目标 | 宿主的组合根，正常 |
| `remote/*.py` 与宿主/客户端 import 关系 | **无 import** | 通信靠三样字符串契约：① `EMBEDDED_CONFIG_B64 = ""` 行注入（`lib/kernel.js:37-42`）；② daemon HTTP 4 端点；③ ntfy 的 `ready`/`error` JSON |
| 宿主↔远端“共享契约”载体 | 无共享代码/共享 schema 文件 | 只有 `docs/SPEC.md` 文档 + `remote/daemon.py` 顶部说明（两处都自称准绳，见 6.2） |
| 跨层重复的“逻辑契约” | 存在 | 见第 4 章：钳制规则、预设参数、比例/风格 id、错误码在两层各写一份 |

### 2.6 结构观察（有数据）

1. **入口文件很薄，但 `test-entry.js` 很厚**：`src/index.js` fan-out 5，只列 3 个组件（StatusChip / Studio / StudioIcon）；`src/test-entry.js` fan-out 17，直接列 10 个组件入口（含 `src/index.js`）——测试入口与生产入口各维护一份组件清单（3 vs 10）。
2. **两个超高 fan-out 节点**：`useStudio.js`（16）与 `Studio.jsx`（13）。`useStudio` 同时 import 了 10 个 logic 模块 + api + hook + 两个 studio 数据表，是客户端唯一的状态中枢。
3. **高 fan-in 的是数据/工具模块**：`icons.jsx` 7（纯 JSX 图标表）、`logic/format.js` / `i18n.js` / `constants.js` 各 5、`runtime.js` / `theme.js` / `logic/clamp.js` / `logic/jobs.js` 各 4——这些是真正被复用的稳定层，不是耦合问题。
4. **`src/logic/*` 的 15 个模块 fan-in 大多 2~5，且互相几乎不依赖**（只有 generate→clamp/prompt），这部分结构是健康的：独立性高的纯函数层。

## 3. 复杂度统计表

### 3.1 口径与方法局限（重要）

- 行数：`(Get-Content).Count`（含空行）；代码行 = 掩码后仍有非空字符的行（字符串内容、注释、模板字面量置为空格，换行保留）。
- **最大函数行数（近似）**：正则定位 `function name(...)`、`=> {`、类/对象方法 `name(...) {`，再用花括号配对求函数体结束行。局限：① 只统计带 `{}` 体的函数，单表达式箭头函数不计；② JSX 里的 `=> {` 可能被误判；③ 对象字面量方法可能漏计；④ 函数内嵌函数会重复计入（外层长度包含内层）。
- **最大花括号深度（近似）**：掩码后 `{`/`}` 计数的峰值。局限：对象字面量、JSX 表达式同样计入，因此 React 组件的“深度”偏大（`Gallery.jsx` 的 8 是 JSX 三元嵌套，不全是控制流）。
- **catch 统计**：`catch (...) {...}` 关键字块计为 catch；`.catch(...)` 回调单独统计。**吞噬型** = 块体为空，或只有 `return null/undefined/false/0/{}/[]`（不含 `return;` 之外的日志）。
- **兜底链（近似）**：`||`、`??`、`?:` 的文本计数。`||` 包含布尔条件里的逻辑或、`?:` 包含非三元用途（如可选链被排除），**高估**，只用于横向比较。

### 3.2 全表（63 个文件，按非空行降序；热点解读见 3.3）

> 说明：最大函数行数按**物理行**计，可能略大于本表“非空行”（多行字符串/JSX 文本行在掩码后按空行计），例如 useStudio 658 > 616。index.js 的 470 是 `apply()` 的物理行数。

| 文件 | 总行 | 非空行 | 最大函数行数 | 函数数 | 最大花括号深度 | catch | 吞噬型 catch | `||` | `??` | `?:` | 兜底链合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `src/studio/useStudio.js` | 709 | 616 | 658 | 52 | 6 | 2 | 2 | 45 | 5 | 45 | 95 |
| `lib/session.js` | 703 | 565 | 108 | 33 | 6 | 9 | 2 | 15 | 11 | 27 | 53 |
| `index.js` | 570 | 501 | 470 | 24 | 7 | 5 | 0 | 2 | 16 | 33 | 51 |
| `src/studio/Rail.jsx` | 311 | 290 | 282 | 3 | 5 | 0 | 0 | 2 | 0 | 17 | 19 |
| `src/studio/Gallery.jsx` | 293 | 259 | 250 | 11 | 8 | 0 | 0 | 15 | 1 | 23 | 39 |
| `src/studio/ChatPanel.jsx` | 278 | 244 | 239 | 12 | 6 | 0 | 0 | 9 | 0 | 16 | 25 |
| `lib/jobs.js` | 287 | 234 | 100 | 14 | 6 | 1 | 0 | 9 | 11 | 19 | 39 |
| `src/dict/zh.js` | 256 | 220 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/dict/en.js` | 256 | 220 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/studio/TopBar.jsx` | 220 | 202 | 202 | 8 | 5 | 0 | 0 | 11 | 2 | 29 | 42 |
| `lib/kaggle.js` | 307 | 200 | 64 | 13 | 6 | 4 | 1 | 7 | 13 | 26 | 46 |
| `src/studio/icons.jsx` | 207 | 192 | 23 | 1 | 2 | 0 | 0 | 2 | 0 | 1 | 3 |
| `tools/preview.mjs` | 553 | 189 | 70 | 1 | 4 | 0 | 0 | 0 | 0 | 1 | 1 |
| `src/studio/Studio.jsx` | 175 | 154 | 149 | 2 | 4 | 0 | 0 | 0 | 0 | 5 | 5 |
| `lib/enhance.js` | 197 | 153 | 65 | 9 | 5 | 4 | 4 | 5 | 2 | 15 | 22 |
| `src/studio/Stage.jsx` | 157 | 139 | 148 | 3 | 4 | 0 | 0 | 13 | 1 | 11 | 25 |
| `lib/presets.js` | 151 | 135 | 3 | 2 | 3 | 0 | 0 | 0 | 1 | 1 | 2 |
| `lib/output.js` | 167 | 133 | 65 | 6 | 4 | 3 | 1 | 0 | 24 | 26 | 50 |
| `lib/intent.js` | 163 | 130 | 65 | 10 | 5 | 4 | 4 | 5 | 2 | 16 | 23 |
| `lib/library.js` | 161 | 118 | 19 | 15 | 4 | 4 | 1 | 0 | 1 | 5 | 6 |
| `src/components/Tooltip.jsx` | 120 | 98 | 102 | 11 | 4 | 0 | 0 | 4 | 0 | 5 | 9 |
| `lib/remote.js` | 142 | 92 | 21 | 8 | 3 | 4 | 4 | 7 | 1 | 4 | 12 |
| `lib/net.js` | 111 | 88 | 40 | 5 | 4 | 3 | 0 | 2 | 4 | 7 | 13 |
| `src/logic/recall.js` | 120 | 88 | 23 | 7 | 2 | 0 | 0 | 14 | 7 | 12 | 33 |
| `src/studio/GuidanceCard.jsx` | 96 | 83 | 79 | 1 | 4 | 0 | 0 | 1 | 0 | 5 | 6 |
| `src/studio/Filmstrip.jsx` | 91 | 82 | 84 | 2 | 5 | 0 | 0 | 3 | 0 | 9 | 12 |
| `build.mjs` | 108 | 68 | 27 | 4 | 3 | 1 | 1 | 0 | 1 | 2 | 3 |
| `lib/paths.js` | 94 | 64 | 30 | 8 | 2 | 3 | 3 | 1 | 1 | 4 | 6 |
| `src/hooks/useHostState.js` | 76 | 64 | 70 | 11 | 5 | 0 | 0 | 1 | 0 | 2 | 3 |
| `src/logic/guidance.js` | 82 | 56 | 16 | 3 | 2 | 0 | 0 | 4 | 0 | 1 | 5 |
| `lib/http.js` | 65 | 53 | 34 | 9 | 5 | 1 | 0 | 1 | 3 | 4 | 8 |
| `lib/kernel.js` | 80 | 52 | 40 | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/index.js` | 71 | 52 | 49 | 2 | 3 | 1 | 0 | 0 | 0 | 0 | 0 |
| `src/logic/probe.js` | 72 | 49 | 12 | 7 | 2 | 0 | 0 | 5 | 0 | 8 | 13 |
| `src/logic/view.js` | 54 | 48 | 45 | 1 | 2 | 0 | 0 | 13 | 0 | 10 | 23 |
| `src/api.js` | 52 | 42 | 40 | 2 | 5 | 2 | 0 | 3 | 0 | 8 | 11 |
| `src/logic/refine.js` | 60 | 42 | 23 | 5 | 3 | 0 | 0 | 1 | 5 | 8 | 14 |
| `src/components/StatusChip.js` | 44 | 40 | 33 | 1 | 2 | 0 | 0 | 1 | 0 | 5 | 6 |
| `src/theme.js` | 48 | 38 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/studio/capsules.js` | 46 | 37 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/test-entry.js` | 46 | 37 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/logic/intent.js` | 51 | 35 | 16 | 3 | 3 | 0 | 0 | 1 | 0 | 5 | 6 |
| `lib/json.js` | 42 | 33 | 35 | 1 | 5 | 1 | 1 | 0 | 1 | 1 | 2 |
| `src/logic/generate.js` | 49 | 31 | 31 | 1 | 3 | 0 | 0 | 3 | 1 | 4 | 8 |
| `src/logic/format.js` | 31 | 27 | 13 | 3 | 2 | 0 | 0 | 1 | 5 | 7 | 13 |
| `src/logic/tooltip.js` | 47 | 26 | 28 | 1 | 2 | 0 | 0 | 9 | 0 | 7 | 16 |
| `src/logic/prompt.js` | 39 | 24 | 16 | 2 | 3 | 0 | 0 | 2 | 3 | 5 | 10 |
| `src/logic/clamp.js` | 29 | 24 | 9 | 4 | 1 | 0 | 0 | 0 | 1 | 1 | 2 |
| `src/studio/StudioIcon.jsx` | 26 | 23 | 22 | 1 | 2 | 0 | 0 | 1 | 0 | 0 | 1 |
| `src/logic/status.js` | 31 | 20 | 6 | 4 | 1 | 0 | 0 | 6 | 0 | 4 | 10 |
| `src/logic/jobs.js` | 26 | 16 | 9 | 3 | 1 | 0 | 0 | 0 | 1 | 2 | 3 |
| `src/logic/index.js` | 16 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/logic/color.js` | 18 | 14 | 7 | 2 | 1 | 0 | 0 | 4 | 0 | 0 | 4 |
| `src/i18n.js` | 18 | 13 | 4 | 3 | 1 | 0 | 0 | 0 | 2 | 5 | 7 |
| `src/logic/error.js` | 15 | 12 | 11 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 1 |
| `src/studio/ratios.js` | 20 | 11 | 3 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/styles/manifest.js` | 18 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/constants.js` | 22 | 10 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/studio/Toast.jsx` | 13 | 10 | 9 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/hooks/useNow.js` | 13 | 10 | 9 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/styles.js` | 17 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/runtime.js` | 12 | 3 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/dict/index.js` | 5 | 3 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |

### 3.3 前 10 名热点（按非空行）

| 排名 | 文件 | 非空行 | 占宿主+客户端代码量 | 主要问题（有数据） |
| ---: | --- | ---: | ---: | --- |
| 1 | `src/studio/useStudio.js` | 616 | 8.0% | 单函数 658 行；52 个内部函数；95 条兜底；16 个 import；同时管会话/队列/表单/画廊/对话/润色 6 件事 |
| 2 | `lib/session.js` | 565 | 7.3% | 9 个 catch；33 个方法；状态机 + 轮询 + 恢复 + 关机混在一个类（`_start` 108 行、`pollTunnel` 92、`pollHealth` 89） |
| 3 | `index.js` | 501 | 6.5% | 15 条路由各写一遍 `ctx.effect(() => webServer.register(...))`；24 个内部函数；`apply()` 单函数 **470 行**（L101-570，占文件 82%） |
| 4 | `src/studio/Rail.jsx` | 290 | 3.8% | 单组件 282 行，表单 + 灵感 + 润色 + 风格 + 比例 + 高级参数全在一个函数体 |
| 5 | `src/studio/Gallery.jsx` | 259 | 3.4% | 250 行组件；深度 8（JSX 嵌套），分桶/筛选/批量选择/操作菜单同体 |
| 6 | `src/studio/ChatPanel.jsx` | 244 | 3.2% | 239 行组件，对话流 + 意图卡 + 澄清卡 + 确认卡 + 润色面板 |
| 7 | `lib/jobs.js` | 234 | 3.0% | 串行队列 + 参数钳制 + 4 处默认值 + 错误归因；`runNext` 100 行 |
| 8 | `src/studio/TopBar.jsx` | 202 | 2.6% | 202 行组件，6 个下拉/菜单/状态块 |
| 9 | `lib/kaggle.js` | 200 | 2.6% | 46 条兜底链；13 个函数包 CLI 调用/探测/推送/日志/状态 |
| 10 | `src/studio/Studio.jsx` | 154 | 2.0% | 149 行组件；13 个 import 的“装配点” |

> 第 10 名之后值得单独点名：`lib/enhance.js` 与 `lib/intent.js` 各 4 个 catch **全部是吞噬型**；`lib/remote.js` 4 个 catch 也全部是 return 假值——这三个文件和“防御性过度”的判断最相关。

### 3.4 最长函数 top 15（近似）

| 排名 | 文件 | 函数/组件 | 类型 | 起止行 | 行数 |
| ---: | --- | --- | --- | --- | ---: |
| 1 | `src/studio/useStudio.js` | useStudio | function | 52–709 | 658 |
| 2 | `index.js` | `apply` | function | 101–570 | **470** |
| 3 | `src/studio/Rail.jsx` | Rail | function | 30–311 | 282 |
| 4 | `src/studio/Gallery.jsx` | Gallery | function | 44–293 | 250 |
| 5 | `src/studio/ChatPanel.jsx` | ChatPanel | function | 40–278 | 239 |
| 6 | `src/studio/TopBar.jsx` | TopBar | function | 19–220 | 202 |
| 7 | `src/studio/Studio.jsx` | Studio | function | 27–175 | 149 |
| 8 | `src/studio/Stage.jsx` | Stage | function | 10–157 | 148 |
| 9 | `lib/session.js` | `_start` | method | 217–324 | 108 |
| 10 | `src/components/Tooltip.jsx` | Tooltip | function | 19–120 | 102 |
| 11 | `lib/jobs.js` | `runNext` | method | 170–269 | 100 |
| 12 | `lib/session.js` | `pollTunnel` | method | 363–454 | 92 |
| 13 | `lib/session.js` | `pollHealth` | method | 462–550 | 89 |
| 14 | `src/studio/Filmstrip.jsx` | Filmstrip | function | 8–91 | 84 |
| 15 | `src/studio/GuidanceCard.jsx` | GuidanceCard | function | 18–96 | 79 |

`index.js` 的 `apply()` 占文件 82%（470/570），15 个路由注册 + 3 个工具注册 + 状态载荷都在这一个函数体内。

### 3.5 catch 与吞噬型 catch

| 统计项 | 数量 | 备注 |
| --- | ---: | --- |
| JS `catch` 块 | 52 | 12 个 lib 文件共 41 个 + `index.js` 5 个 + 3 个 src 文件共 5 个 + `build.mjs` 1 个 |
| 空 catch（`{}` / 只 `return;`） | 10 | `lib/enhance.js` 2、`lib/intent.js` 2、`lib/session.js` 2、`src/studio/useStudio.js` 2、`lib/kaggle.js` 1、`lib/paths.js` 1 |
| 只 return 假值 | 14 | `lib/remote.js` 4、`lib/enhance.js` 2、`lib/intent.js` 2、`lib/paths.js` 2、`lib/output.js` 1、`lib/library.js` 1、`lib/json.js` 1、`build.mjs` 1 |
| **吞噬型小计** | **24 / 52（46.2%）** | 其中约一半是刻意的 best-effort 降级（`lib/remote.js` 的 `requestShutdown`、`lib/json.js` 的 parse 兜底） |
| 只打日志的 catch | 0 | —— |
| `.catch(...)` 调用 | 31 | 6 个是空回调（`session.js` 3、`library.js` 2、`kernel.js` 1） |
| Python `except` | 59 | `daemon.py` 39、mock-daemon 8、smoke-daemon 6、bench 5、worker 1 |
| Python `except: pass` | 14 | `daemon.py` 10、mock-daemon 2、bench 1、diskprobe 1 |
| Python 仅打日志的 except | 10 | `daemon.py` 7、mock-daemon 3 |

> 口径提醒：“吞噬型”不等于 bug。`lib/paths.js`、`lib/json.js`、`lib/remote.js` 的吞噬是显式的“坏输入→安全默认值”策略。真正的问题是**静默范围不可见**：24 处吞掉后没有任何 `.catch` 计数/日志指标，读代码时无法区分“设计意图”与“忘了处理”。

### 3.6 兜底链（近似）

| 维度 | 数值 |
| --- | ---: |
| `\|\|` 总数 | 228 |
| `??` 总数 | 126 |
| `?:` 总数（含少量误计） | 452 |
| 合计 | 806（63 个文件平均 12.8 条） |
| 最集中的 5 个文件 | useStudio 95、session 53、index 51、output 50、kaggle 46 |
| 零兜底链的文件 | 16 个（dict 3、常量/样式/runtime 7、小组件 4、入口 2） |

### 3.7 魔法数字 top 20（字面量级，字符串内的数字已被掩码排除）

| 字面量 | 出现次数 | 主要语义（人工归类） | 分布（文件数） |
| --- | ---: | --- | ---: |
| `1024` | 35 | 尺寸默认值 + 字节单位混用 | 10 |
| `200` | 19 | 删除上限、HTTP 状态码、截断长度 | — |
| `60` | 19 | 步数上限、秒→分换算、轮询 | 11 |
| `1000` | 18 | 毫秒换算、文字截断 | — |
| `4` | 17 | 张数上限、预设步数、字节乘数 | 10 |
| `400` | 13 | 截断字符数、HTTP 状态 | — |
| `15` | 13 | 超时秒数、字号 | — |
| `2000` | 12 | 提示词长度上限、毫秒 | 9 |
| `16` | 12 | 位深/数值 | — |
| `1152` | 10 | 横向尺寸 | 3（presets/ratios/preview） |
| `30` | 10 | 历史条数、秒 | — |
| `8` | 9 | 尺寸对齐步长、字节 | 5 |
| `5` | 8 | 默认条数、秒 | — |
| `300` | 8 | 超时秒数、截断 | — |
| `20` | 8 | cfg 上限、队列上限 | 6 |
| `648` | 8 | 竖向尺寸 | 2（ratios/preview） |
| `13` | 7 | 字号 | — |
| `768` | 6 | 尺寸档 | 2（presets/ratios） |
| `600` | 6 | 超时秒数（waitSeconds/排队） | 4 |
| `30000` | 5 | Kernel 状态轮询毫秒 | 2（kaggle/session） |

`1024` 的 35 次里：26 次是画面尺寸（presets 7、preview 10、ratios 4、useStudio 4、clamp 1），9 次是字节单位（`index.js:60-61` 的 `4 * 1024`、`lib/http.js:24` 的 `256 * 1024`、`lib/kaggle.js:55-56` 的 `128 * 1024`、`lib/net.js` 2 处、`lib/remote.js:20` 的 `32 * 1024 * 1024`）——**同一字面量承载两种语义**，是最典型的魔数混用点。

需要单独记账的“超时/阈值常量散落”：

| 常量 | 值 | 定义处 | 重复处 |
| --- | --- | ---: | --- |
| 健康检查超时 | 4000ms | `lib/remote.js:15` | `lib/remote.js:133` 的 `requestLogs` 复用 |
| 生成超时 | 600000ms | `lib/remote.js:17`、`lib/jobs.js:57` | 2 处各写一遍 |
| 关机通知超时 | 3000ms | `lib/remote.js:18`、`lib/session.js:33` | 2 处各写一遍 |
| 轮询间隔 | 3000ms | `lib/session.js:24 TICK_MS` | `test/*` 自行传小值 |
| Kernel 状态轮询 | 30000ms | `lib/session.js:27 KERNEL_POLL_MS` | `lib/kaggle.js` 4 处 30000（CLI 超时同值不同义） |
| 会话恢复窗口 | 120000ms | `lib/session.js:76` | — |
| 关机等待 | 1500ms | `index.js:66` | — |
| 探针超时 | 45000ms | `src/studio/useStudio.js:518` | 客户端 45s vs 宿主 30s（`lib/kaggle.js` `30000`），无共享常量 |

### 3.8 Python 远端指标

| 文件 | 总行 | 非空行 | 最大缩进(级) | try / except | except: pass | 仅日志 | 函数数 | 最长函数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `remote/daemon.py` | 1,216 | 958 | 5 | 38 / 39 | 10 | 7 | 55 | `build_pipeline` 70 行（L489-558）、`_handle_generate` 67（L890-956）、`main` 59、`validate_generate_spec` 58、`runtime_boot` 50 |
| `remote/worker.py` | 129 | 105 | 4 | 1 / 1 | 0 | 0 | 3 | `main` 72 行（L56-127） |
| `test/mock-daemon.py` | 524 | 430 | 6 | 10 / 8 | 2 | 3 | 23 | `_handle_generate` 71、`validate_spec` 49 |
| `test/smoke-daemon.py` | 426 | 371 | 5 | 9 / 6 | 0 | 0 | 16 | `scenario_main` 119、`validate_png` 45 |
| `test/tunnel-probe.py` | 264 | 229 | 6 | 2 / 0 | 0 | 0 | 11 | `do_POST` 51 |
| `bench/bench.py` | 227 | 195 | 5 | 4 / 4 | 1 | 0 | 7 | `run_one` 52 |
| `bench/lightning/run.py` | 119 | 99 | 5 | 1 / 0 | 0 | 0 | 2 | `main` 79 |
| `bench/probe/diskprobe.py` | 90 | 73 | 6 | 3 / 1 | 1 | 0 | 3 | `main` 42 |

远端结论：`remote/daemon.py` 是第二个单体（1,216 行、55 函数、39 个 except、10 个 pass），但**测试侧重复更值得注意**——`test/mock-daemon.py` 用 524 行重实现了同一套 HTTP 协议与参数校验（`validate_spec` 49 行 ≈ daemon 的 `validate_generate_spec` 58 行），`test/smoke-daemon.py` 再用 426 行做字段断言，`test/tunnel-probe.py` 再写一版 3 端点 + ntfy 发布。

## 4. 重复与契约点（关键证据）

### 4.1 HTTP 路由路径字符串

- 宿主 `index.js` 注册 **15 条**路由；`docs/SPEC.md` 写 **14 条**；客户端实际调用 **12 条**（`src/studio/useStudio.js` 11 处 + `src/hooks/useHostState.js` 1 处）。
- 全仓带 `/imagen-api/` 前缀的字面量共 **101 处（10 个文件：index.js、SPEC、CHANGELOG、3 个测试、preview、2 处 src 注释、lib/output.js）**；客户端另有 12 处相对路径（`imagen-api/...`，2 个文件）→ 合计 **113 处 / 12 个文件**。

| 路由 | 总出现次数 | 涉及文件数 | index.js | 客户端 | 测试 | 文档/工具 |
| --- | ---: | ---: | :---: | :---: | ---: | --- |
| `/imagen-api/state` | 12 | 7 | 1 | 1 | 6（3 文件） | SPEC、CHANGELOG、preview×3 |
| `/imagen-api/history` | 16 | 8 | 1 | 1（`?limit=60`） | 7（3 文件） | SPEC、preview×4、CHANGELOG×2、recall 注释 |
| `/imagen-api/library` | 11 | 5 | 1 | 1 | 6（2 文件） | SPEC、preview×3 |
| `/imagen-api/generate` | 8 | 5 | 1 | 1 | 5（2 文件） | SPEC、generate 注释 |
| `/imagen-api/enhance` | 7 | 4 | 1 | 1 | 4（1 文件） | SPEC、CHANGELOG |
| `/imagen-api/file` | 6 | 5 | 1 | 0 | 3（2 文件） | SPEC、`lib/output.js` 拼 URL |
| `/imagen-api/library/delete` | 6 | 3 | 1 | 1 | 4（1 文件） | SPEC |
| `/imagen-api/library/favorite` | 6 | 3 | 1 | 1 | 4（1 文件） | SPEC |
| `/imagen-api/intent` | 5 | 4 | 1 | 1 | 2（1 文件） | SPEC、CHANGELOG |
| `/imagen-api/job` | 5 | 3 | 1 | 0 | 3（1 文件） | SPEC |
| `/imagen-api/probe` | 4 | 4 | 1 | 1 | 1（1 文件） | SPEC、CHANGELOG |
| `/imagen-api/reveal` | 4 | 4 | 1 | 1 | 1（1 文件） | SPEC、CHANGELOG |
| `/imagen-api/session/start` | 4 | 3 | 1 | 1 | 2（1 文件） | SPEC |
| `/imagen-api/session/stop` | 4 | 3 | 1 | 1 | 2（1 文件） | SPEC |
| `/imagen-api/jobs` | 3 | **2** | 1 | 0 | 2（1 文件） | **SPEC 缺** |

**14/15 条路由在 ≥3 个文件重复；唯一例外是 `/imagen-api/jobs`（宿主 + 测试两处，SPEC 完全没写）。**

两个容易漏掉的契约细节：

1. **客户端路由字符串不带前导斜杠**（`request('imagen-api/state')`，靠 `new URL(relative, document.baseURI)` 解析），宿主注册的是 `/imagen-api/state`（绝对路径）。可工作，但同一路由在两侧形态不同（12 处 vs 15 处），一旦 baseURI 带尾斜杠/子路径，解析结果会变，属于隐性契约。
2. **查询参数上限各写一套**：客户端硬编码 `history?limit=60`；宿主 `/history` 默认 30、上限 100；`/jobs` 默认 20、上限 100；`imagen_history` 工具默认 5、上限 30。同一个“条数”语义有 5 组数字。

### 4.2 错误码

按“谁产生、谁消费”拆开统计（字符串字面量级，不含注释）：

| 来源 | 数量 | 清单 |
| --- | ---: | --- |
| 宿主产生（index.js + lib） | **27** | invalid_body、not_found、invalid_request、too_many、output_missing、reveal_failed、internal_error、invalid_prompt、queue_full、stopped、session_absent、empty_result、generate_failed、invalid_path、auth_required、push_failed、health_failed、tunnel_timeout、queue_timeout、remote_error、session_ended、session_error、session_timeout、disposed、cli_missing、cli_timeout、unknown |
| 远端 daemon 新增 | **4** | unauthorized、load_failed、generation_failed、oom（`invalid_request`/`not_found` 与宿主重名） |
| 客户端自造 | **7** | warming（503 无码时）、timeout（Abort）、network（fetch 失败）、`http_<status>`、need_prompt、delete_failed、probe_failed |
| 客户端字典 `error.code.*` | **24** | need_prompt、cli_missing、auth_required、push_failed、queue_timeout、tunnel_timeout、health_failed、remote_error、stopped、session_ended、warming、oom、load_failed、invalid_request、generation_failed、timeout、invalid_prompt、queue_full、session_absent、empty_result、invalid_path、disposed、session_timeout、not_found |
| `docs/SPEC.md` §1 记录 | **23** | 即字典 24 去掉 `need_prompt` |
| 测试字符串中出现 | 30 | 含输入侧模拟码（tunnel_failed）与客户端本地码（need_prompt/delete_failed/probe_failed） |

**对不上的地方（有数据）：**

1. **宿主/远端产生的 31 个码里有 10 个没有任何界面文案**：`invalid_body`、`too_many`、`output_missing`、`reveal_failed`、`internal_error`、`session_error`、`generate_failed`、`cli_timeout`、`unknown`，外加远端 `unauthorized`。客户端 `errorText()` 的兜底是「code 无文案 → 显示原始 message 或 `error.http`」，所以这些错误会以英文/技术文案出现在界面。
2. **客户端指引表认识字典没有的码**：`src/logic/guidance.js` 的 `SESSION_CODES` 含 `session_error`、`GENERATION_CODES` 含 `generate_failed`，但字典里没有这两个键 → 卡片类型对了、标题文案缺失。
3. **同一码在不同层含义不同**：`timeout` 在宿主 `lib/kaggle.js` 指 CLI 进程超时（`failure: 'timeout'`），在客户端指 AbortController 用户取消/探测超时；`warming` 在 daemon 的 `/health.phase` 是正常状态，在客户端是错误码。
4. **`error.code.*` 共 24 个键在字典里**，但字典键名靠前缀约定，没有任何脚本校验“宿主抛出的码 ⊆ 字典键”（见 4.5 检查缺口）。
5. 测试覆盖：`host-e2e.mjs` 只显式断言 2 个错误码（`invalid_prompt`、`not_found`）；`invalid_body`/`too_many`/`output_missing`/`reveal_failed`/`internal_error`/`generate_failed` **在全部测试中没有字符串出现**。

### 4.3 presets / 预设参数

规范定义只有一处：`lib/presets.js`（4 个预设，含 `size/steps/cfg/sizeOptions/loadSeconds/steadySeconds/peakVramMb`）。另有 5 个位置重新声明或引用同一批 preset 参数：

| 位置 | 引用 id 次数 | 是否重定义参数 | 与 canonical 的一致性 |
| --- | ---: | --- | --- |
| `lib/presets.js` | 7 | canonical | — |
| `docs/SPEC.md` §4 基准表 | 12 | 是（steps/cfg/尺寸/VRAM） | **3 处参数不一致 + 2 处 VRAM 不一致**（见 6.4） |
| `test/check-client-logic.mjs` | 17 | 是（`{size,steps,cfg}` 三处 fixture） | 一致（4/0、25/7.5 与 canonical 相同） |
| `tools/preview.mjs` | 15 | 是（自带 preset 对象） | **不一致**：sdxl-base `steps: 30, cfg: 7`（canonical 25/7.5）；lightning `steadySeconds: 6.2` 一致 |
| `test/check-client-render.mjs` | 15 | 否（只作 fixture 的 presetId） | 一致 |
| `bench/bench.py` | 6 | 是（独立 `MODELS` 表） | 独立维护（turbo 4 步/512、base 25 步/1024） |

另外两处“语义重定义”：

- `lib/enhance.js:17` 硬编码 `FAST_PRESETS = ['sdxl-lightning', 'sdxl-turbo']`（按“快档”分组，canonical 里已有 `tier: 'fast'` 字段可判定）。
- `src/studio/ratios.js` 的比例表（1024×1024/1152×648/648×1152/1024×768/768×1024）与 `lib/intent.js:12` 的 `RATIO_IDS` 是两张独立表；`src/studio/capsules.js` 的 5 个风格 id 与 `lib/intent.js:13` 的 `STYLE_IDS` 也是两张独立表。**同一组 id 在宿主（LLM 提示词约束）与客户端（UI 数据表）各写一份。**

### 4.4 钳制常量（同一规则写几遍）

| 规则 | 代码实现处 | 文案/文档处 | 是否一致 |
| --- | --- | --- | --- |
| 尺寸 256–1536、8 的倍数 | `lib/jobs.js:33-38`、`src/logic/clamp.js:15-19` | `index.js:470-471`（工具描述）、`docs/SPEC.md` §2.2、`src/logic/generate.js` 注释、`src/studio/ratios.js` 注释 | 值一致，实现 2 份（宿主 clamp 先 round 再对齐，客户端先对齐再 clamp，边界行为有细微差别） |
| 步数 1–60 | `lib/jobs.js:131`、`src/logic/generate.js:32`、`src/studio/useStudio.js:127` | `index.js:472`、SPEC §2.2 | 值一致，**实现 3 份** |
| CFG 0–20 | `lib/jobs.js:132`、`src/logic/generate.js:33`、`src/studio/useStudio.js:128` | `index.js:473`、SPEC §2.2 | 值一致，**实现 3 份** |
| 张数 1–4 | `lib/jobs.js:134`、`src/logic/generate.js:35` | `index.js:475`、SPEC §2.2 | 值一致，实现 2 份 |
| waitSeconds 0–600（默认 90） | `index.js:503`（toInt）、`lib/jobs.js:273`（`Math.min(600, …)`） | `index.js:476-479`、工具描述 | 一致；客户端始终发 0 |
| 提示词 ≤2000 字符 | `lib/jobs.js:116`、`src/logic/generate.js:24-25` | `index.js:463` 工具描述、SPEC | 值一致，3 处 |
| 随机种子上界 | `lib/jobs.js:121-124` 用 `% 2147483647`；`src/logic/clamp.js:28` 用 2^32-1（4294967295） | — | **不一致**：客户端允许到 4294967295，宿主再取模 2147483647 → 用户填的 seed 会被静默改写 |
| 比例表 1:1/16:9/9:16/4:3/3:4 | `src/studio/ratios.js`（带像素） | `lib/intent.js:12`（仅 id 列表）+ SPEC §2.3 + 测试 + preview | id 集合一致，两张表 |

> 结论：钳制规则本身没有实现分叉（值都一致），问题在于**同一条规则在 2~3 个位置各写一次、改一处容易漏**，且 `index.js` 的工具文案与 `lib/jobs.js` 的真实钳制之间没有生成关系。

### 4.5 dict（`src/dict/zh.js` / `en.js`）

| 指标 | 数值 |
| --- | ---: |
| zh 键 / en 键 | **218 / 218**（脚本提取，集合完全相同；无重复键） |
| 顶层命名空间 | studio 156、error 26、session 17、job 5、unit 4、value 4、workbench 3、chip 2、action 1 |
| `error.code.*` 键 | 24（见 4.2） |
| 被 `t('字面量')` 静态引用 | 149（68.3%） |
| 仅通过模板字面量动态可达 | 45（`session.state.*` 7、`error.code.*` 23、`session.phase.*` 5、`session.hint.*` 5、`job.status.*` 5） |
| 通过变量间接引用（常量数组/表字段） | 24（`studio.style.*` 5 经 `capsules.labelKey`、`studio.inspire.*` 10 经 `INSPIRE_KEYS`/`${key}.label`、`studio.refine.*` 4 经模板、`studio.gallery.today/week/earlier` 3、`studio.toast.copied` 1、`studio.guidance.cli.copied` 1） |
| 无法从代码证明被使用的键 | 0（上述 69 个“未静态引用”的键都能被动态/间接路径解释） |

**`test/check-client-locale.mjs` 检查了什么**（83 行）：

1. zh/en 键集合双向一致（43-44 行）；
2. 静态 `t('…')` / `t(\"…\")` 引用必须存在于字典（56-65 行）；
3. 动态键命名空间必须已定义（58-60 行，只匹配单段前缀 `` `foo.${ ``）；
4. `client.js` 必须包含全部中文文案值（68-73 行）——这是“构建产物必须与源码同步”的替代校验；
5. `client.js` 里不能出现 `__test`（74 行）。

**它没有检查什么**（重构时要注意的盲区）：

- **多段动态键**：`session.state.${…}`、`job.status.${…}`、`session.phase.${…}`、`session.hint.${…}`、`error.code.${…}` 都不匹配其单段正则 → 这些键写错/删除不会被发现（45 个键仅靠这条路径可达）。
- **变量间接引用**：`t(key)`、`t(capsule.labelKey)`、`t(\`${key}.label\`)` 完全不校验（24 个键）。
- **反向检查**：没有“字典里有、代码从不引用”的清理检查（CHANGELOG 说 0.3.0 清理了 65 个死键，但当前没有守卫）。
- **错误码覆盖**：不检查宿主错误码是否都有文案（4.2 的 10 个缺口不会被这个测试拦住）。
- **中英文一致性**：只比键，不比值的占位符/长度/语义。
- **CHANGELOG 数字**：`CHANGELOG.md` 0.3.0 写“中英双语各 **220** 键”，实际 **218**（−2）。

### 4.6 ntfy / daemon 协议字段

真实实现与“协议模拟”共 **7 类、8 个文件**（其中 JS 测试 2 个文件共用同一套 ntfy 假服务器写法）：

| 文件 | 角色 | `type` | `endpoint` | `token` | `phase` | `last_error` | `ntfy` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `remote/daemon.py` | 真实发布者（`ready`/`error`） | 15 | 1 | 8 | **41** | 10 | 28 |
| `lib/session.js` | 真实消费者（ntfy 轮询 + health 状态机） | 4 | 23 | 20 | 15 | 2 | 8 |
| `lib/remote.js` | 真实 HTTP 客户端 | 7 | 12 | 14 | 0 | 0 | 0 |
| `test/mock-daemon.py` | HTTP 协议模拟（4 端点 + 参数校验） | 9 | 0 | 10 | 15 | 3 | 0 |
| `test/smoke-daemon.py` | 协议字段/PNG 断言 | 2 | 0 | 24 | 13 | 5 | 0 |
| `test/tunnel-probe.py` | 第三套隧道 + ntfy 发布 | — | — | — | — | — | 7 |
| `test/session-reliability.mjs` / `session-race.mjs` | JS 版 ntfy 假服务器（`ntfyMessage()`） | — | — | — | — | — | 46 / 48 |

协议内容本身（人工摘录）：

- ntfy 发布：`{type:'ready', endpoint, model_id, device}`（`daemon.py:357-364`）、`{type:'error', code, message}`（`daemon.py:367-369`）；必须 `Content-Type: text/plain`（`daemon.py:323-345`，ARCHITECTURE §2.4 同文）。
- daemon HTTP：`GET /health`、`GET /logs?since=N`、`POST /generate`、`POST /shutdown`；`/health` 的 `phase ∈ booting/installing/loading/ready/error`，`last_error` 是字符串。
- 注入配置键：`auth_token`、`ntfy_topic`、`idle_timeout_sec`、`preload`、`preset_id`、`log_level`、`version`（`lib/session.js:265-275` 与 `daemon.py:296-315` 各解析一遍）。
- 同一组字段名在 8 个实现/模拟文件里各出现十几次——**没有共享 schema、没有生成代码、没有跨语言契约测试**（JS 测试模拟 ntfy 的 JSON 结构，Python 测试断言 HTTP 字段，两边各自演化）。

## 5. 仓库卫生

### 5.1 跟踪物与生成物

| 检查项 | 结果 |
| --- | --- |
| 跟踪文件数 / 字节 | 115 / 1,065,072 |
| `client.js`（构建产物） | **已跟踪**，248,311 B、3,633 行，占仓库 23.3%；1 个生成器（`build.mjs`）；`check-client-locale.mjs` 用“文案必须出现在 client.js”来近似验证同步 |
| `test/render-golden.json` | 已跟踪，663 B；由 `check-client-render.mjs` 读取（golden 基准，**合理**） |
| `.impeccable/design.json` / `.impeccable/surfaces/*.md` | 已跟踪，45,740 B + 2,540 B；design/critique 工作产物，非运行时必需 |
| `bench-results/`、`test/.build/`、`tools/.preview/`、`__pycache__/`、`node_modules/` | **未跟踪且被 .gitignore 覆盖**（`git check-ignore` 全部命中） |
| 未跟踪且未忽略的文件 | 0（`git ls-files --others --exclude-standard` 为空） |
| 大文件（>100KB，跟踪） | 只有 `client.js`（248KB）；`remote/daemon.py` 48KB 次之 |
| LICENSE | **缺失**（ROADMAP §四.4 自己列了“补齐开源 License 文件”） |

`.gitignore` 与实际一致性：**一致**（生成目录都没入库）；但“`client.js` 是生成物却入库 + 破例跟踪 `.impeccable/`”是两条**有意为之但需要决策记录**的例外。`client.js` 入库的代价：248KB 二进制式 diff、每次源码改动必须 rebuild + commit、多人改 UI 必然冲突。

### 5.2 package.json 与 git 内容

- `files`：`index.js, client.js, lib/*.js, locale/*.json, icon.svg, cordis.patch.yml, remote/*.py` —— 全部已跟踪，无缺失；`src/`、`test/`、`docs/` 不发布（合理）。
- `exports` 4 项（`.` / `./client` / `./locale/*.json` / `./icon`）与 `files` 一致。
- 注意：`files` 里的 `remote/*.py` 会把**死文件 `remote/worker.py`** 一起发布。
- `devDependencies` 仅 `esbuild`；`package-lock.json` 14.5KB 已跟踪（可接受）。

### 5.3 版本号重复

| 位置 | 值 |
| --- | --- |
| `index.js:29` `const VERSION` | `0.3.0` |
| `package.json` `version` | `0.3.0` |
| `CHANGELOG.md` 最新条目 | `0.3.0` |
| `lib/session.js:273`（推送 Kernel 的 config.version） | **`0.2.0`** |
| `remote/daemon.py:54` `VERSION` | **`0.2.0`** |
| `test/mock-daemon.py:49` `VERSION` | `0.2.0-mock` |
| `test/tunnel-probe.py:27` `VERSION` | `0.2.0-probe` |
| `docs/SPEC.md` 响应示例 | `0.3.0` |

→ **插件/包/文档 0.3.0，远端层仍自称 0.2.0**。远端 `/health` 与 `User-Agent` 会返回 `imagen-daemon/0.2.0`，与插件版本不一致；`test/host-e2e.mjs:41` 的 fixture 也用 `version: '0.2.0'` 把旧值固化进测试。

### 5.4 未使用文件 / 导出（粗查）

扫描口径：全仓（排除 node_modules/.build/.preview/__pycache__/client.js/package-lock）统计每个导出名出现次数，`≤1` 视为确定死导出，`=2` 为疑似。

| 符号 | 定义 | 全仓出现 | 判定 |
| --- | --- | ---: | --- |
| `errorShape` | `lib/http.js:62` | 1 | **死导出**（协议错误归一函数，没人用） |
| `copyMockDaemon` | `lib/kernel.js:78` | 1 | **死导出**（注释说“保留给测试”，但测试没用） |
| `httpJson` | `lib/net.js` | 1 | **死导出** |
| `requestLogs` | `lib/remote.js:133` | 2（定义 + ROADMAP 提及） | **死代码**；ROADMAP §三.1 明确说“未对前端暴露” |
| `apiUrl` | `src/api.js:3` | 2 | 仅被同文件 `request()` 使用（可内联） |
| `localGroups` / `toAbsolute` | `lib/enhance.js` / `lib/paths.js` | 2 | 内部/单点使用 |
| `remote/worker.py` | 整个文件 129 行 | **0 处代码引用** | **死文件**（只有 CHANGELOG 提到“收敛至 daemon.py 与 worker.py”）；其 `load_pipeline` 与 `daemon.py:489-558` 的 fp16/variant 加载路径同构重复，是两套远端实现的残留 |

> 129 个导出符号中：3 个确定死导出 + 4 个仅出现 2 次（`requestLogs` 属死代码；`apiUrl`/`localGroups`/`toAbsolute` 为单点内部使用）。**“大面积死代码”没有数据支撑**，但死物集中在 lib 层且清理成本低。

## 6. 文档漂移

### 6.1 文档清单与分工

| 文档 | 行数 | 字节 | 它声称自己是什么 | 实际角色 |
| --- | ---: | ---: | --- | --- |
| `README.md` | 112 | 6,100 | 上手/使用说明 | **现状**（用户向），准确 |
| `CHANGELOG.md` | 91 | 13,237 | 版本变更 | **历史**；0.3.0 条目里有 1 处数字与实际不符（dict 220 vs 218） |
| `DESIGN.md` | 352 | 24,956 | 设计系统（YAML tokens + 叙述） | **现状**（UI 向）；前 ~152 行是可被脚本消费的 token YAML |
| `PRODUCT.md` | 54 | 3,758 | 产品定位/原则 | **设想 + 现状**混合（impeccable 工作流产物） |
| `docs/ARCHITECTURE.md` | 97 | 6,430 | 架构 + 踩坑 | **0.2.x 现状**：客户端仍写成“DSH 设置页 / 会话模型”，未覆盖 0.3.0 的独立整页工作台与 intent/reveal 等新路由 |
| `docs/SPEC.md` | 235 | 10,123 | “唯一规格真理源” | **契约**，但 9 类与代码不一致（见 6.3/6.4） |
| `docs/STUDIO_SPEC.md` | 179 | 11,867 | V1 工作台规格 | **历史**：文首有“已废弃”横幅 ✓ |
| `docs/STUDIO_V2_SPEC.md` | 273 | 18,915 | V2 规格（0.3.0 落地） | **现状 + 设想**混合；标题编号有 bug（`## 3` 出现两次，`### 2.1/2.2` 错位在 §3 下） |
| `docs/ROADMAP.md` | 88 | 7,512 | 路线图 | **设想**（P0/P1/P2），与代码可逐条核对（6.4） |
| `docs/UI_COPYWRITING.md` | 57 | 5,141 | 文案对照 | **历史**：文首有“历史文档”横幅 ✓ |

总量：文档 1,538 行 / 108,039 B（约 105.5 KB），对手写代码 14,559 行 ≈ 10.6%。**分工本身是清楚的**（README/CHANGELOG/DESIGN 现状，ROADMAP 设想，STUDIO_SPEC/UI_COPYWRITING 已标历史），主要问题不是“文档互相矛盾”，而是 **SPEC 与代码脱节 + 三份设计 token 各自演化**。

### 6.2 ARCHITECTURE 与 ROADMAP 是否一致

- 一致：ARCHITECTURE §1 说“ntfy 会合（daemon 开机上报一次隧道地址）”，ROADMAP §二.2 说“Host 已有重取隧道逻辑，但远端 daemon 只在开机上报一次，cloudflared 中途崩溃不会重拉”——**两者说的现状一致**，ROADMAP 的“隧道自愈”是未实现的设想。
- 代码可验证 ROADMAP 的表述：`remote/daemon.py:1186-1187` 注释明确“只要隧道地址到手就发布 ready”，没有 cloudflared 守护线程；`grep` 无 watchdog。→ ROADMAP 准确。
- ROADMAP §三.1 说的 `requestLogs` 未暴露 = `lib/remote.js:133` 死代码，准确。
- ROADMAP §二.1 的“会话本地持久化”：全仓 `grep session.json` **0 命中**，`.imagen/` 只被 .gitignore 提及。→ 未实现，准确。
- ARCHITECTURE 的失效点：`docs/ARCHITECTURE.md:12` 把 Client 描述为“DSH 设置页 / 会话模型”，而 0.3.0 已是独立整页工作台（STUDIO_V2_SPEC、README 均如此）；链路图只写 `/imagen-api/*` 泛化，未列 15 条路由中的 0.3.0 新增（intent/reveal/enhance/library*）。

### 6.3 SPEC 路由 vs index.js 实际注册（抽查）

- SPEC 记录 14 条，index.js 注册 15 条：**缺 `/imagen-api/jobs`**（`GET /imagen-api/jobs?limit=` → `{jobs, queue}`）。
- SPEC 有、代码没有的：0。
- 另有 5 处响应结构/参数与实现不一致（都在 SPEC §2）：

| SPEC 位置 | SPEC 写法 | 实现 | 判定 |
| --- | --- | --- | --- |
| SPEC:55-63 `/state` 的 `presets[]` | `{id, name, width, height, steps, cfg}` | `publicPresets()` 返回 `{id, label, repo, ..., size, sizeOptions, steps, cfg, ...}`（`lib/presets.js:149-150`） | 字段名 `name/width/height` **不存在** |
| SPEC:85 `/probe` 响应 | `{cli:true, auth:true, quota:true}` | `cli:{present,…}`、`auth:{ok,checkedAt,errorCode}`、`quota:{available,raw}`、`notes[]`（`lib/kaggle.js:130-155`） | 布尔 vs 对象，**结构不符** |
| SPEC:122-130 `/generate` 响应 | `{ok, jobId, status:'pending', job}` | 直接返回 job 对象，`id` 字段名、`status:'queued'`（`lib/jobs.js:139`、`index.js:246`） | 响应形状与状态值都不同 |
| SPEC:206-207 工具参数 | `negative_prompt`、`preset` | `negativePrompt`、`presetId`，且实际还有 width/height/steps/cfg/count/waitSeconds（`index.js:463-479`） | 参数名不符 + 漏 6 个参数 |
| SPEC:42 | “所有插件接口……响应格式固定为 application/json” | `/imagen-api/file` 返回图片二进制（`image/png`，`index.js:309-314`） | 自我矛盾 |

### 6.4 SPEC 的错误码与预设基准漂移

- 错误码：SPEC §1 列 23 个，宿主实际 27 个 + 远端 4 个 → **10 个码未文档化**（invalid_body、too_many、output_missing、reveal_failed、internal_error、session_error、generate_failed、cli_timeout、unknown、unauthorized）；另有：字典/SPEC/代码三方没有任何脚本做一致性校验。
- 预设基准表（SPEC §4 vs `lib/presets.js`）：

| 预设 | SPEC 步数/CFG | 代码步数/CFG | SPEC 显存 | 代码 peakVramMb |
| --- | --- | --- | --- | --- |
| sdxl-lightning | 4 / 1.0 | 4 / **0** | 10.3 GB | 10347 ✓ |
| sdxl-turbo | **1 / 0.0** | **4 / 0** | 7.2 GB | 7666（7.67）✗ |
| sdxl-base | **30 / 5.0** | **25 / 7.5** | 10.5 GB | 9966（9.97）✗ |
| flux2-klein-4b | 4 / 1.0 | 4 / 1.0 ✓ | >15 GB | 7929（loadSeconds 28.2） |

→ 3 个预设的步数/CFG 与实现不一致，2 个显存数字不一致。**代码与测试 fixture 一致（25/7.5、4/0），是 SPEC 与 preview 工具过期**，不是实现分叉。

### 6.5 设计 token 三份定义

| 文件 | 用途 | 不同 hex 值 | 交叉检查 |
| --- | --- | ---: | --- |
| `DESIGN.md`（YAML 部分） | 设计系统文档 | 28 | — |
| `.impeccable/design.json` | impeccable 机器可读设计稿 | 151（含渐变色阶） | — |
| `src/styles/tokens.css` | 实际生效的 CSS 变量 | 40 | **12 个不在 DESIGN.md**、**15 个不在 design.json**（如 `#101012`、`#fafafa`、`#58c08a`） |

`src/theme.js` 不含 hex，只引用宿主 CSS 变量（`--dsw-alias-*`），设计上是干净的；问题在于**文档 token 与真实 CSS token 没有生成/校验关系**，`tokens.css` 已偷偷长出自己的 12 个颜色。

### 6.6 其他文档问题（可直接引用）

- `remote/daemon.py:56` 与 `test/mock-daemon.py:7` 引用 **`docs/API.md`**，但仓库没有这个文件（现有的是 `docs/SPEC.md`）——2 处失效链接。
- `docs/STUDIO_V2_SPEC.md`：`## 3. 界面减负与悬浮提示规范` 下出现 `### 2.1`/`### 2.2`（编号错位），且 `## 3` 标题重复出现两次（55 行、74 行）。
- `README.md:92` 声称 host-e2e 有“21 项自动化断言”——实测 `check()` 调用 21 次（另有 1 处 `function check`），**准确**。
- `CHANGELOG.md` 0.3.0：“中英双语各 220 键”实际 218；“补齐 8 个宿主错误码文案”——字典里确实新增了错误码文案，但仍有 10 个宿主码无文案（4.2）。
- `docs/STUDIO_SPEC.md` / `docs/UI_COPYWRITING.md` 都带废弃横幅，是文档治理的正面样本（不是漂移）。

## 7. 量化结论：哪些有数据支撑，哪些只是感觉

### 7.1 有数据支撑（可直接写进重构方案）

1. **`useStudio` 是客户端的“上帝对象”**：709 行文件里 `useStudio()` 单函数 **658 行（92.8%）**、52 个内部函数、16 个 import、95 条兜底链、同时包装 6 类关注点（会话/队列/表单/画廊/对话/润色）。这是“低内聚”最硬的一组数。
2. **宿主有一个 703 行的 `SessionManager` 和一个 470 行的 `apply()`**：前者 9 个 catch、33 个方法（`_start` 108、`pollTunnel` 92、`pollHealth` 89）；后者一个函数内注册 15 条路由 + 3 个 Agent 工具，占 index.js 82%。
3. **契约字符串多副本是系统性的**：15 条路由 → 113 处字面量/12 个文件（14 条 ≥3 处）；38 个错误码散在宿主/远端/客户端 7 处、10 个无界面文案；预设参数 6 处定义且 2 处数值不一致；ntfy/daemon 协议在 7 个文件各自实现/模拟。
4. **防御性代码高度集中，不在全仓**：JS catch 52 个（24 个吞噬型）里，12 个 lib 文件占 41 个；46 个 `src/` 文件只有 3 个文件写了 catch（useStudio 2、api 2、src/index 1，共 5 个）。所以正确说法是“**少数 lib 模块过度防御**”，不是“全仓过度防御”。
5. **远端是第二个单体，且测试在复制协议**：`daemon.py` 1,216 行/55 函数/39 except；`mock-daemon.py` 524 行重实现协议与校验；`smoke-daemon.py` 426 行、`tunnel-probe.py` 264 行、两个 JS 测试各写一个 ntfy 假服务器。
6. **卫生问题可量化**：`client.js` 248KB 构建产物入库（23.3% 仓库字节）；`remote/worker.py` 129 行 0 引用；4 个死导出（errorShape/copyMockDaemon/httpJson/requestLogs）；7 处版本号 2 个值（远端仍是 0.2.0）；无 LICENSE。
7. **文档漂移集中在 SPEC**：9 类 SPEC↔代码不一致（路由缺 1、响应结构/总则 4 处、工具参数名 1、错误码缺 10、预设基准 5 处、失效文档引用 1）；`docs/API.md` 失效引用 2 处；设计 token 三份定义且 CSS 有 12 个颜色不在文档里。文档之间没有明显互相矛盾（STUDIO_SPEC/UI_COPYWRITING 已标历史）。

### 7.2 没有数据支撑 / 需要修正的说法（对 Lead 有用）

- **“意大利面条式代码”不成立（按依赖结构）**：import 图 0 循环、0 条 `src↛lib ↔ lib↛src` 违规、144 条内部边里没有重复边；`src/logic/*` 15 个纯函数模块基本互不依赖。真实问题是**三个大文件内部的过程式长度**，不是模块间网状的乱依赖。建议对外表述为“三个单体 + 契约副本”，不要说“面条”。
- **“全仓过度防御”不成立**：catch 集中在 lib 的少数文件；组件层几乎不写 catch（`src/api.js` 统一兜住）。需要区分“刻意 best-effort 降级”（remote/http/json/paths 的吞噬）与“真正的静默失败”。
- **“路由 3 处以上重复”成立但要加限定**：只有 `/jobs` 是 2 处（因为 SPEC 漏了它）；客户端已经收敛到 `src/api.js` 单一出口，15 条路由没有各写各的 fetch。真正的重复是**服务端注册/SPEC/测试/客户端调用点四份清单**，缺的是由一份常量生成的机制。
- **“文档互相矛盾”说重了**：多数文档有清晰分工和废弃横幅（STUDIO_SPEC、UI_COPYWRITING），矛盾只集中在 SPEC↔代码、版本号、设计 token 三处。
- **“测试是重构阻力”没有依据**：4,857 行测试与 21 项 host-e2e 断言是资产；代价是测试里也固化了契约副本（route/preset 字面量、`version:'0.2.0'` fixture），重构时需同步改这些常量。

### 7.3 建议的下一步（仅供参考，不在本轮范围）

1. 先抽 3 张“契约常量表”（路由/错误码/预设与钳制）到单一来源文件，再让 index.js、src、tests、docs 引用/生成——这是 4.1/4.2/4.3 的直接解药，风险最低。
2. 再拆 `useStudio`（按会话/队列/表单/画廊分 hook）与 `SessionManager`（状态机 vs 传输层）——需要先补行为测试，因为现有测试已覆盖 21+42+25 条断言，改造可回归。
3. 远端整理顺序：先删 `remote/worker.py` 与 4 个死导出（0 风险），再考虑把 `mock-daemon.py` 的协议校验与 daemon 统一到一份契约测试。
4. 版本号：把 `daemon.py:VERSION`、`session.js` 的 `config.version`、mock/probe 改为从 package.json 生成或注入（当前 0.2.0/0.3.0 并存）。

---

## 附录 A：方法与已知误差

### A.1 复杂度脚本核心（`%TEMP%\fi-analyze.ps1`）

1. `Mask-Code`：逐字符扫描，把 `//`、`/* */`、`'…'`、`"…"`、模板字符串内容替换为空格（保留换行），避免字符串里的花括号/数字/`||` 污染统计；
2. 函数起止：正则 `(?<![\w$.])function\s*\*?\s*[\w$]*\s*\(`、`=>\s*\{`、`^\s{0,12}(?:async\s+)?(?:get |set )?([\w$]+)\s*\([^;{}\r\n]*\)\s*\{` 定位起点，`Match-Brace` 配对求终点；
3. 嵌套深度：掩码全文 `{`/`}` 计数峰值；
4. catch：`\bcatch\s*(?:\([^)]*\))?\s*\{` 配对取体，归一空白后判空/`return null|undefined|false|0|{}|[]`；
5. 兜底链：`\|\|`、`\?\?`、`\?(?![?.:=])` 计数；
6. 数字：`(?<![\w$.])(\d+(?:\.\d+)?)(?![\w$.])`，字符串内已掩码，因此 `'256-1536'` 这类描述文本不计入；
7. 导出/未使用：`^\s*export\s+...` 提取 + 全仓 `\bname\b` 计数。

函数体定位先对参数表做括号配对（避免 `config = {}` 这类默认参数里的 `{` 被误当作函数体起点）；已知误差：正则字面量未被掩码（含 `{n}` 的 regex 会轻微影响深度）；TS 类型/装饰器不存在于本仓库；`return;` 未被计入吞噬型（保守）；单表达式箭头函数不计入函数长度；`Measure-Object -Line` 与 `(Get-Content).Count` 对空行计数不同，本文件统一用后者。

### A.2 环检测（`%TEMP%\fi-report-graph.ps1`）

邻接表（仅内部边）→ DFS 三色标记；遇到状态 1 的节点即输出“路径 → 回边”。本次 63 节点/144 内部边，输出 `no cycles detected`。PowerShell 递归深度在本图规模下无栈溢出风险。

### A.3 文件与数量的交叉核对

- `git ls-files`：115 个文件、1,065,072 B（与 `Get-Item` 求和一致）；
- 两套统计（`fi-analyze.json` 与 `fi-py.json`）对同一文件行数的差异仅来自空行口径；本文件表中 Python 行数用 `Get-Content` 计数，JS 表“总行”同样用 `Get-Content`；
- 路由/错误码/预设的字面量计数均为**字符串级**（`Select-String -AllMatches` / `[regex]::Matches`），注释里的出现也计入并已在文中标注（如 SPEC 文档、`src/logic/*` 注释各 1 处）。