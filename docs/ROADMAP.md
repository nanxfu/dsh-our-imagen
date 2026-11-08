# 阶段与验收（ROADMAP）

三个里程碑，每个以"可演示 + 可回滚"为完成条件。里程碑内部的顺序即实现顺序。

---

## M0 · 基线与清理（半天）

- 建立 git 基线（现有 Python CLI 形态）。
- 写入 `docs/` 全套规格与本文件。
- 冻结决策，不开新分支讨论架构。

**验收**：`git log` 有基线提交；文档评审通过；无未决问题。

---

## M1 · 骨架 + 引导 + 资源条（不出图）

目标：验证"加载即引导"这条最容易被低估的路径。

1. 插件包骨架：`package.json`、`cordis.patch.yml`、`index.js`、`client.js`、`locale/`、`icon.svg`。
2. Host：`ImagenService` 空壳 + `/imagen-api/state`、`/imagen-api/probe` 两个路由。
3. Client：面板注册（右侧面板 + 设置页退化）、引导四步、资源条占位。
4. 探测链路真实可用：`kaggle --version`、`kaggle quota` 的调用与解析、登录态判定。
5. 删除本地 Python 编排（`scripts/imagen.py`、`scripts/providers/**`），`remote/` 迁入包内。
6. 迁移 `configs/models.json` → `lib/presets.js`。

**验收**：

- 全新 profile 下加载插件，面板出现，引导第 1、2 步能真实反映本机环境（含"本地记录已登录但 API 未认证"这一分支）。
- 资源条显示真实配额或"配额未知（原文见诊断）"。
- 卸载插件后无残留进程与定时器。

---

## M2 · 工作台出图闭环

目标：v1 的核心价值成立——热态秒级出图。

1. `KaggleProvider`：推送、轮询、ntfy 握手、健康检查、关机。
2. 任务队列：串行、取消剩余、增量落盘、`meta.json`。
3. 图片路由 `/imagen-api/img`。
4. 模型卡（v1 四张）、参数区、图墙、生成中占位动画。
5. 六类错误态的文案与诊断区。
6. Agent tool：`imagen_generate`（立即返回 `jobId`）、`imagen_session`（启停/状态）。

**验收**：

- 从 `absent` 到第一张图全流程走通，记录总耗时分解（推送/调度/下载/加载/首图）。
- 连续三次出图不重启会话，第二次起耗时明显低于第一次。
- 一键关机后 `absent`，远端内核 60 秒内变为 `COMPLETE`。
- 对话中调用 tool 能拿到 `jobId` 与摘要，随后取到图片路径。

---

## M3 · 双卡、量化档与基准回填

1. `useSecondGpu` 开关接到底层（`device_map` 策略），未开启时行为不变。
2. 量化档：GGUF 加载分支（`GGUFQuantizationConfig`），默认折叠。
3. 跑完 [MODEL-CATALOG.md](MODEL-CATALOG.md) 的 B1~B6，回填表格。
4. 按实测结果调整默认档与"更多模型"门槛。

**验收**：

- 双卡开关切换后，`/health` 的 `devices` 长度随之变化。
- 量化档至少一张模型能出图并记录耗时与画质抽样。
- 模型目录的基准表格无 `待测` 残留（未收录的模型移出表格）。

---

## v1.1 候选（不进 v1）

- 权重缓存数据集引导（`dataset_sources`）。
- 图库与历史（按 jobId 浏览、参数回填）。
- 用户自定义预设（UI 增删）。
- 生成队列的多任务预排与"再来一张"。

---

## v2 候选

- ComfyUI 运行时（工作流 JSON 直通）。
- 第二个 Provider 实现（用 [PROVIDER-INTERFACE.md](PROVIDER-INTERFACE.md) 的验收清单把关）。
- 图像编辑（当前 `daemon.py` 只做文生图）。
