# 待办任务清单 (TODO)

当前版本 0.2.0 的功能开发已收敛，剩余事项集中在真实 GPU 验证与体验增强。每项保持独立、可验证。

---

## 已完成（0.2.0）

| 事项 | 落点 | 验证方式 |
| --- | --- | --- |
| 远端会话生命周期（push → 排队 → 隧道 → 握手） | `lib/session.js`、`lib/kernel.js` | `node test/kaggle-live.mjs` 已跑通 |
| 出图任务串行队列与参数钳制 | `lib/jobs.js` | `node test/host-e2e.mjs` |
| 图片落盘、meta.json、历史扫描 | `lib/output.js` | `node test/host-e2e.mjs` |
| Host 路由（state/probe/session/generate/job/jobs/history/file） | `index.js` | `node test/host-e2e.mjs` |
| Agent 工具（imagen_generate / imagen_session / imagen_history） | `index.js` | `node test/host-e2e.mjs` |
| 前端工作台与状态徽章 | `client.js` | `node --check client.js` + DSH 设置页人工检查 |
| 远端 Daemon v2（依赖安装、加载分支、日志环、空闲退出） | `remote/daemon.py` | 待 GPU 实测（见 Task 1） |

---

## Task 1: 真实 GPU 端到端验证（已完成）

### 结果
`node test/gpu-live.mjs` 于 2026-11-09 跑通：Kernel `mogudd/imagen-101f2d4c`，2×Tesla T4，`sdxl-lightning` 1024²/4 步首张 11.65 秒，落盘 1.15MB PNG，关机后 Kernel 转为 `COMPLETE`。详见 `docs/MODELS_AND_BENCHMARKS.md` 的端到端实测小节与 `bench-results/gpu-live/2026-11-09T05-03-41/`。

### 原目标与步骤（留档）
用真实 Kaggle GPU 跑一次 `remote/daemon.py`，确认依赖安装、模型加载与出图耗时符合 `docs/MODELS_AND_BENCHMARKS.md` 的记录。

1. 运行 `node test/gpu-live.mjs`（默认 `sdxl-lightning`，1024²、4 步）。
2. 等待排队与模型加载，记录 `/health` 的 `device` 与 `loaded`。
3. 检查 `bench-results/gpu-live/<时间戳>/01.png` 是否有效，`report.json` 里的 `loadSeconds` 与 `imageSeconds`。
4. 把实测值与文档对比，偏差超过 50% 时更新 `docs/MODELS_AND_BENCHMARKS.md`。

### 验收标准
- 生成成功，图片可打开，`imageSeconds` 在 5–10 秒区间（Lightning 4 步）。
- Kernel 关机后 `kaggle kernels status` 变为 `COMPLETE`。

> 首张 11.65 秒高于 5–10 秒区间，原因是首张包含 CUDA 上下文与显存分配；稳态仍是 6.2 秒。前端已按"首张较慢"提示。

---

## Task 2: 生成历史回填与复用

### 目标
让历史产物可以一键回填参数，减少重复输入。

### 步骤
1. `GET /history` 已返回完整参数与 seed，前端在历史卡片上增加"以此参数再生成"按钮。
2. 点击后把 prompt、negativePrompt、尺寸、步数、CFG、seed 写回表单（seed 保留，便于复现）。
3. 需要的话在 `docs/API.md` 第 3 节补一句用法说明。

### 验收标准
- 从历史卡片回填后直接点生成，能复现同一张图（同 seed、同参数）。

---

## Task 3: Kernel 权重缓存（Kaggle Dataset 挂载）

### 目标
把常用权重打包成 Kaggle Dataset，Kernel 启动时挂载，跳过每次 40 秒左右的下载。

### 步骤
1. 把 SDXL base 的 fp16 文件整理成 Dataset 并上传（或复用社区公开 Dataset）。
2. `kernel-metadata.json` 增加 `dataset_sources`，daemon 从 `/kaggle/input/<dataset>` 读取本地路径。
3. `lib/presets.js` 增加 `datasetSource` 字段，`lib/kernel.js` 透传到 metadata。
4. 未配置来源时保持现有下载路径，作为回退。

### 验收标准
- 二次启动 Kernel 的模型加载时间明显低于首次（目标 < 20 秒）。
- 未配置 Dataset 的环境仍能正常加载。

---

## Task 4: FLUX.2 双卡路径验证

### 目标
确认 `loader: "flux2"` 在 2×T4 上能跑通，并补齐参数默认值。

### 步骤
1. 用 `node test/gpu-live.mjs --preset flux2-klein-4b` 跑一次。
2. 观察 `device_map="balanced"` 是否让两张卡都参与，记录显存峰值。
3. 若 diffusers 对 FLUX.2 的接口与 `AutoPipelineForText2Image` 不同，在 daemon 的 `build_pipeline` 增加对应分支。

### 验收标准
- 1024² 出图成功，不 OOM；耗时与文档记录（约 10 秒）偏差在合理范围。

---

## Task 5: 隧道备份通道

### 目标
`trycloudflare.com` 不可用时自动切换到备用通道。

### 步骤
1. 抽象 `start_tunnel(provider)`，先实现 `cloudflared`，再补一个备选（如 `bore` 或 ngrok，按可用性选择）。
2. 主通道在 90 秒内未拿到域名时切换备选，并在日志与 `/health` 里标明当前通道。
3. `lib/remote.js` 的 `isTrustedEndpoint` 需要按通道放行对应域名。

### 验收标准
- 人为阻断主通道时，会话仍能进入 ready。
