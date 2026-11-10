# 代码库“去AI味”与架构整洁化实施规格书 (CODE_REFACTOR_SPEC)

> **目标受众**：负责执行本次代码去 AI 味、消除伪解耦、拔除假防御与自嗨测试的代码开发 Agent。  
> **核心原则**：
> 1. **行为无损**：对外公开接口契约、UI 交互呈现与现有功能 100% 保持一致。
> 2. **真实性第一**：坚决剔除“为了面向假测试而污染源码”的假防御，测试只测生产逻辑，不搞套娃自嗨。
> 3. **高内聚、短路径**：坚决反对“把简单逻辑切成碎屑文件后靠跨层透传参数”的伪解耦。
> 4. **渐进提交**：每个 Phase 完成后必须执行对应的校验命令，确保全部绿灯后再进入下一阶段。

---

## 任务执行路线图 (Phase Overview)

| 阶段 | 关注领域 | 核心任务 | 优先级 | 影响文件 |
| :--- | :--- | :--- | :---: | :--- |
| **Phase 1** | 服务端缺陷 | 修复隐蔽运行时崩溃风险与种子越界 | **P0** | `index.js`, `lib/session/remote-port.js` |
| **Phase 2** | 契约与守护进程 | 契约去演戏（剔除未使用的 routes 等），Python 端简化别名 | **P0** | `shared/contract.js`, `remote/daemon.py`, `tools/gen-contract-json.mjs` |
| **Phase 3** | 前端测试桩与假防御 | 补齐 `load-client.mjs` DOM 替身，拔除生产组件中的 Node/SSR 假判空 | **P1** | `test/load-client.mjs`, `src/components/Tooltip.jsx`, `src/hooks/useHostState.js`, `src/studio/Stage.jsx` |
| **Phase 4** | 测试工程去自嗨 | 拔除源码测试探针 `HarnessProbe`，清理 `smoke-daemon`，收敛守护进程测试 | **P1** | `src/test-entry.js`, `test/check-client-render.mjs`, `test/smoke-daemon.py`, `package.json` |
| **Phase 5** | LLM 逻辑收敛 | 抽取统一的 `lib/llm.js`，消除 `enhance.js` 与 `intent.js` 100 行复制粘贴 | **P1** | `lib/llm.js`, `lib/enhance.js`, `lib/intent.js` |
| **Phase 6** | 会话层内聚化 | 治理 `SessionManager` 碎片化，收回侵入私有属性的微模块，废除空转代理 | **P2** | `lib/session.js`, `lib/session/*.js` |
| **Phase 7** | 前端 Hook 与 Props 收敛 | 治理 `useStudio` 73 属性超级铺平对象，收紧 `TopBar`/`Rail` 20+ Props 机械透传 | **P2** | `src/studio/useStudio.js`, `src/studio/Studio.jsx`, `src/studio/TopBar.jsx`, `src/studio/Rail.jsx` |
| **Phase 8** | 注释卫生清理 | 剔除源码中自我说教、议论式及幽灵注释 | **P3** | `src/constants.js`, `src/logic/jobs.js`, `src/studio/icons.jsx` 等 |

---

## Phase 1: 修复隐蔽运行时缺陷与参数溢出 (P0)

### 任务 1.1: 修复路由装配漏传 `log` 缺陷
- **问题文件**：`index.js:105`
- **缺陷现象**：
  在 `index.js` 中调用 `createJobRoutes({ ctx, queue })` 时漏传了 `log`。当客户端发送畸形 URL 时，`lib/route-kit.js:24` 内部 `catch` 会调用 `log.debug(...)`，由于 `log` 为 `undefined`，直接抛出 `TypeError: Cannot read properties of undefined (reading 'debug')` 引发未捕获 500。
- **改动代码**：
  ```javascript
  // Before (index.js:105):
  ...createJobRoutes({ ctx, queue }),

  // After:
  ...createJobRoutes({ ctx, queue, log }),
  ```

### 任务 1.2: 修复批量生图种子溢出导致远端 400 拦截
- **问题文件**：`lib/session/remote-port.js:36` 与 `lib/jobs.js`
- **缺陷现象**：
  当种子接近 `LIMITS.seed.max`（`2147483647`）且 `count > 1` 时，`params.seed + index` 算术溢出超过上限。远端 `daemon.py:834` 执行严格校验：`elif seed > seed_max: raise RequestError(...)`，导致合法参数被直接拦截抛出 400 失败。
- **改动代码**：
  ```javascript
  // Before (lib/session/remote-port.js:36):
  seed: typeof params.seed === 'number' ? params.seed + index : undefined,

  // After: 对超出的 seed 进行环形取模回绕，保证始终在合法范围
  seed: typeof params.seed === 'number'
    ? ((params.seed + index) % 2147483647)
    : undefined,
  ```
- **验证命令**：
  ```powershell
  npm run test:host
  ```

---

## Phase 2: 契约去演戏与协议精简 (P0)

### 任务 2.1: 精简下发给守护进程的契约对象（消除 Contract Theater）
- **问题文件**：`shared/contract.js:350-375`、`tools/gen-contract-json.mjs`
- **问题现状**：
  `daemonContract()` 将全仓所有前端和宿主路由、错误码字典、会话 phase 全塞进 Base64 传递给远端 `daemon.py`。然而经全仓排查，`remote/daemon.py` 对 `routes`、`healthPhases`、`ntfyEvents`、`errorCodes` 的引用次数为 **0**，完全是“演戏代码”。
- **目标代码**：
  保留真正被使用的字段（`version`、`limits`、`model` 等必要配置），剔除纯宿主内部的错误码与路由列表。
  ```javascript
  // shared/contract.js
  export function daemonContract() {
    return {
      version: VERSION,
      limits: LIMITS,
      // 仅保留 Python 容器实际消费的元数据，不冗余注入 Node 专有路由与阶段
    }
  }
  ```
- **同步生成物**：
  运行 `node tools/gen-contract-json.mjs` 重新生成 `remote/contract.json`。
- **验证命令**：
  ```powershell
  npm run contract:check
  node test/check-contract.mjs
  ```

### 任务 2.2: 简化 `remote/daemon.py` 内部过度通用的别名映射
- **问题文件**：`remote/daemon.py:334-346` (`CONFIG_ALIASES`)
- **问题现状**：
  `daemon.py` 唯一调用者是本仓库的 `lib/kernel.js`，数据格式完全确定。无需在 Python 端维护驼峰与下划线的大量 fallback 别名字典，直接读取精准字段即可。
- **验证命令**：
  ```powershell
  python test/daemon-unit.py
  ```

---

## Phase 3: 前端测试环境补齐与假防御清理 (P1)

### 任务 3.1: 补齐 `test/load-client.mjs` 中的 DOM 替身
- **问题文件**：`test/load-client.mjs:270-310`
- **问题现状**：
  测试在 Node.js 中加载客户端代码，但 fake DOM 没有实现 `window` 对象以及 `closest`、`getBoundingClientRect` 等方法，导致 AI 在生产代码中到处堆砌 `typeof window === 'undefined'` 和 `typeof node.closest === 'function'`。
- **改造方案**：
  在 `test/load-client.mjs` 的沙箱环境中补齐标准的全局桩：
  ```javascript
  globalThis.window = globalThis
  globalThis.window.addEventListener = () => {}
  globalThis.window.removeEventListener = () => {}
  // 为 mock 节点原型补齐方法：
  fakeElementProto.getBoundingClientRect = () => ({ top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100 })
  fakeElementProto.closest = function(selector) { return this }
  fakeElementProto.contains = function() { return false }
  fakeElementProto.scrollTo = () => {}
  fakeElementProto.focus = () => {}
  ```

### 任务 3.2: 拔除生产代码中的假防御（还原纯净浏览器代码）
- **问题文件**：
  - `src/components/Tooltip.jsx:32-73`
  - `src/hooks/useHostState.js:30, 45, 59, 65`
  - `src/studio/Stage.jsx:28`
  - `src/studio/ChatPanel.jsx:66`
- **改造方案**：
  彻底删除对 `window`、`document`、`closest`、`getBoundingClientRect` 是否为函数的极端防御，简化为现代浏览器原生调用。
  在 `src/hooks/useHostState.js` 中移除 `stopped` 与 `aliveRef` 双重防重的冗余变量，只保留单一边界控制。
- **验证命令**：
  ```powershell
  npm run test:client
  ```

---

## Phase 4: 测试工程去自嗨与拔除源码探针 (P1)

### 任务 4.1: 从客户端源码中拔除 `HarnessProbe` 探针
- **问题文件**：`src/test-entry.js:44-65`
- **问题现状**：
  源码专门写了 `HarnessProbe` 探针组件来测测试桩自己写的 Mini-React 是否支持 `useReducer/useMemo`。
- **改造方案**：
  1. 彻底删除 `src/test-entry.js` 中的 `HarnessProbe` 与 `ProbeChild` 导出。
  2. 从 `test/check-client-render.mjs:443-466` 中移除对应自嗨测试用例。

### 任务 4.2: 废除 SHA-256 盲比快照，改为语义断言
- **问题文件**：`test/check-client-render.mjs:341-400`, `test/render-golden.json`
- **问题现状**：
  将渲染树序列化取 SHA-256 哈希，任何标签调整都会造成盲目报错，且看不到具体 diff。
- **改造方案**：
  移除无语义的十六进制哈希比对，改为检查各场景下是否正确渲染了核心 DOM 元素（如 `.ofs-stage`、`.ofs-rail`、错误提示文案是否在文档树中呈现）。

### 任务 4.3: 收敛 Python 测试，删除自嗨 `smoke-daemon.py`
- **问题文件**：`test/smoke-daemon.py`（544行）、`package.json`
- **问题现状**：
  `smoke-daemon.py` 纯粹在跑 `test/mock-daemon.py`，生产文件 `remote/daemon.py` 根本不参与。
- **改造方案**：
  1. 删除或归档 `test/smoke-daemon.py`；
  2. 将真正测试生产代码的 `python test/daemon-unit.py` 整合进 `npm test` 主命令。
- **验证命令**：
  ```powershell
  npm test
  ```

---

## Phase 5: 收敛 LLM 重复逻辑 (P1)

### 任务 5.1: 抽取通用的 `lib/llm.js` 统一处理流式文本
- **问题文件**：`lib/enhance.js:96-179`、`lib/intent.js:69-150`
- **问题现状**：
  两个文件逐行复制粘贴了近 100 行 `callModel`、`collectText`、`textOf`、`llm.prepareCall` 降级到 `llm.stream` 以及 IIFE try/catch 的容错样板。
- **改造方案**：
  在 `lib/llm.js` 中封装单一函数 `invokeLlm(ctx, { prompt, systemPrompt, log, timeoutMs })`：
  - 规范处理 Cordis 的 `ctx.get('llm')` 获取；
  - 统一处理流式文本收集与超时回退；
  - `lib/enhance.js` 与 `lib/intent.js` 仅保留各自的业务 Prompt 与结构化提取逻辑。
- **验证命令**：
  ```powershell
  npm run test:host
  ```

---

## Phase 6: 会话层内聚化与治理碎片化 (P2)

### 任务 6.1: 废除碎屑代理模块与回收私有状态
- **问题文件**：`lib/session.js`、`lib/session/timers.js`（31行）、`lib/session/remote-port.js`（53行）
- **问题现状**：
  外部模块函数以 `(host, ...)` 为参数，疯狂穿透并读写 `host.session`、`host.epoch`、`host.healthMisses` 等私有状态，`SessionManager` 内部沦为纯透传的代理委托。
- **改造方案**：
  1. 将 `timers.js` 内联收回 `SessionManager`（一个简单的 Set 管理无需独立文件）；
  2. 将 `remote-port.js` 的请求组装合并到 `JobQueue` 或 `SessionManager.prototype.generate`；
  3. 将 `provisioner.js`、`rendezvous.js`、`health.js` 中对 `host` 私有状态的侵入性修改，收敛为明确的类方法或由 `SessionManager` 统一调度，杜绝外部函数随意篡改宿主内部状态。
- **验证命令**：
  ```powershell
  npm run test:session-pure
  npm run test:host
  ```

---

## Phase 7: 前端 Hook 与 Props 管道收敛 (P2)

### 任务 7.1: 治理 `useStudio` 73 属性大杂烩
- **问题文件**：`src/studio/useStudio.js`、`src/studio/hooks/*`
- **问题现状**：
  拆出的 5 个 hook 之间需要互相透传 7~9 个参数，顶层又无脑展开成 73 个属性返回给组件层。异步操作处处机械性手动判断 `if (!aliveRef.current) return`。
- **改造方案**：
  1. 将紧密耦合的状态合并（例如表单与会话状态联动）；
  2. 废除每个 hook 都要求穿透传递 `aliveRef` 的老旧模式，利用标准请求取消机制或内聚在 API 请求层管理；
  3. 顶层不再扁平铺平 73 个属性，按领域组织成复合结构返回：`{ ui, session, form, chat, library }`。

### 任务 7.2: 消除组件 Props 机械穿透 (Prop Drilling)
- **问题文件**：`src/studio/TopBar.jsx`（17 props）、`src/studio/Rail.jsx`（21 props）
- **改造方案**：
  子组件直接接收所属领域的复合对象（例如 `TopBar` 接收 `{ session, view }`，`Rail` 接收 `{ form, actions }`），大幅减少手写解构与逐层转发样板。
- **验证命令**：
  ```powershell
  npm run test:client
  ```

---

## Phase 8: 清理自我辩白式与幽灵注释 (P3)

### 任务 8.1: 清理残留与幽灵 JSDoc
- **问题文件**：
  - `src/constants.js:5-10`：删去错位的“1. 文案字典”注释（文案字典早已移至 `src/dict/`）。
  - `src/logic/jobs.js:23-27`：删去没有对应函数的空头 JSDoc。
  - `src/studio/icons.jsx:3-5`：删去“这不是最典型的 AI 生成页面痕迹”等自我辩白式议论文注释。
  - 删去 `Rail.jsx`、`TopBar.jsx` 中说教式的注释（如“这不是需要按顺序完成的步骤”）。
- **验证命令**：
  ```powershell
  npm test
  ```

---

## 阶段验收与完成标准 (Acceptance Criteria)

代码开发 Agent 完成上述各阶段后，需满足以下硬性验收指标：
1. **测试全绿**：执行 `npm test`（含代码构建、契约校验、文案对齐、客户端纯逻辑、渲染测试与宿主 E2E）100% 通过。
2. **契约强绑定**：`npm run contract:check` 必须通过，无任何未同步或失效字段。
3. **真实覆盖率**：`python test/daemon-unit.py` 必须通过。
4. **代码清爽度**：无任何未使用的死代码（如 `pickFocusedJob`、`patch` 等），无源码级测试探针。
