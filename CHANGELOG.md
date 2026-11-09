# 变更记录

## 0.2.0 — 2026-11-09

### 新增

- **远端会话生命周期**：`lib/session.js` 完整实现 push → 排队 → 隧道 → 握手 → ready 的状态机，带排队/隧道超时、Kernel 状态轮询与失败原因回传。空转视为 `absent`，重复调用幂等。
- **Kernel 打包与配置注入**：`lib/kernel.js` 每次会话生成一次性 Kernel 目录，把 Token、ntfy topic、预载模型描述以 Base64 注入脚本；`--accelerator NvidiaTeslaT4` 申请 2×T4。
- **出图任务队列**：`lib/jobs.js` 串行队列，参数校验与钳制（尺寸取 8 的倍数、步数 1–60、CFG 0–20、张数 1–4），同批多张使用递增 seed。
- **本地产物**：`lib/output.js` 把图片与 `meta.json` 落到 `<workspace>/imagen-output/<时间戳>-<jobId>/`，并提供历史扫描与预览 URL。
- **Host 路由**：新增 `session/start`、`session/stop`、`generate`、`job`、`jobs`、`history`、`file`，`state` 扩展为完整工作台数据源。
- **Agent 工具**：`imagen_generate`、`imagen_session`、`imagen_history`，对话中可直接出图与查询历史。
- **前端工作台**：`client.js` 重写设置页，包含会话控制、参数区、进度、图墙（点击放大、复制路径）与历史；对话页头部徽章显示会话与任务状态。
- **远端 Daemon v2**：`remote/daemon.py` 重写为常驻服务，包含依赖安装、模型加载分支（`sdxl` / `sdxl-lora` / `flux2`）、日志环、`/logs` 增量拉取、错误分级与空闲退出。
- **出站网络降级**：`lib/net.js` 在进程内 `fetch` 失败时改用本机 `curl`，保证代理环境下的 ntfy 访问。
- **测试**：`test/host-e2e.mjs`（mock daemon，15 项断言）、`test/kaggle-live.mjs`（真实 Kaggle 链路）、`test/tunnel-probe.py`（不占 GPU 的探针）、`test/mock-daemon.py`（本地联调）。

### 修复

- **插件整体加载失败**：cordis 的服务访问是严格的，`inject` 未声明 `tools` 时读取 `ctx.tools` 会直接抛错，导致 `apply` 中断、`/imagen-api/*` 全部 404。已把 `tools` 加入 `inject`，并提供 `test/verify-loaded.mjs` 做重启后的加载检查。
- **Kernel 配置注入失效**：占位符按字面量首次匹配，会命中脚本注释里的同名字符串，导致真实赋值行未注入。改为行首锚定的正则替换。
- **Kernel 失败信息不可读**：`kaggle kernels logs` 输出是 JSON 事件流且混有 notebook 转换噪音，直接截尾会把 `Traceback` 挤掉。改为还原文本、过滤噪音后取尾段。
- **ntfy 发布失败**：`Content-Type: application/json` 会被 ntfy 当作发布指令解析而返回 400，改为 `text/plain` 携带 JSON 字符串。
- **cloudflared 管道阻塞**：拿到域名后不再读取 stderr 会让子进程写满管道卡死，改为独立线程持续 drain。
- **Kaggle 镜像依赖冲突**：镜像自带 `torchao 0.10.0` 与新版 `diffusers` 冲突，daemon 启动时先卸载再升级 `diffusers/transformers/accelerate/peft`。
- **权重下载撑爆磁盘**：SDXL 按 `fp16` 白名单预拉取，避免整仓几十 GB 占满 20GB 工作目录。

### 文档

- 新增 `docs/API.md` 作为三端实现契约；`docs/DESIGN.md` 重写为当前架构；`README.md` 补充使用与测试方式。

## 0.1.0 — 2026-11-09

### 新增与重构

- **文档与工程体系精简**：
  - 清理冗余的规格文档、过度抽象的 Provider 接口及 ADR 记录，聚焦核心开发。
  - 整合输出核心设计 `docs/DESIGN.md` 与实测基准 `docs/MODELS_AND_BENCHMARKS.md`。
  - 明确技术演进路线 `docs/ROADMAP.md`。
- **DSH 插件骨架**：
  - Host 端：提供 `/imagen-api/state` 与 `/imagen-api/probe` 状态及探针路由。
  - Client 端：设置页与状态徽章，支持实时检查 Kaggle CLI、凭据有效性与 GPU 配额。
  - 远端运行环境：收敛至 `remote/daemon.py` 与 `remote/worker.py`。
