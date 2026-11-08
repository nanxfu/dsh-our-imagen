# 变更记录

格式参考 Keep a Changelog；版本遵循语义化版本。

## 未发布

### 新增

- v1 规格全集：`docs/SPEC.md`、`ARCHITECTURE.md`、`PROVIDER-INTERFACE.md`、`PROTOCOL.md`、`WORKBENCH-UI.md`、`MODEL-CATALOG.md`、`ROADMAP.md`、`CONTRIBUTING.md`。
- 七条决策记录（`docs/ADR/0001` ~ `0007`）。
- T4 准入基准脚本 `bench/bench.py` 与内核元数据。

### 变更

- `docs/SPEC.md` 由"未来接入 Harness GUI"的描述改写为 v1 总纲；分层、术语、硬约束、完成定义全部重写。
- 登录引导由"回到终端执行命令"改为"面板内托管 CLI 子进程、把一次性验证码写回其 stdin"，并保留终端命令兜底。
- 模型卡字段扩为七项（所需卡数 / 权重体积 / 峰值显存 / 量化类型 / 许可 / 是否 gated / 实测耗时），并补入 FLUX.3 Image Klein、MOSS-Image-SFT、Krea-2-Turbo 三个候选。
- 新增 `docs/EXPERIMENTS.md`：把实测结论、原始数据与对策从规格正文移出，规格文档只保留规范结论并引用编号。
- 账号接入主路径改为 Kaggle API token，OAuth 降为兜底（ADR-0008），原因见 EXPERIMENTS E10：OAuth token 约 3 小时过期且不自动续期。
- 空闲自动关机默认值由 15 分钟改为 30 分钟（重新拉起需排队 13~27 分钟）。
- 目标形态由 Python CLI skill 改为 Harness Web 插件（宿主 TypeScript 编排 + 保留远端 Python 运行时）。

### 已知限制

- 实现尚未开始，M1 待启动。
- 模型目录中的耗时与下载吞吐为 `待测`，需在 T4 上跑 `bench/bench.py` 回填。

## 0.0.0 — 2026-11-08

### 基线

- 现有 Python CLI 形态快照：`scripts/imagen.py`、`scripts/providers/**`、`configs/models.json`、`SKILL.md`、原 `docs/SPEC.md`。
- 该提交仅用于回滚与 diff，不作为 v1 交付内容。
