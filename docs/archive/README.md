# 历史文档归档目录 (Archive)

本目录收纳历史版本演进、阶段性重构底稿与已废弃的产品设计规格。此处的文档**仅供追溯与技术复盘参考**，不作为当前代码实现与系统行为的现行标准。

---

## 目录索引

### 1. `2026-11-refactor/` (2026-11-10 阶段性重构底稿)
- **背景**：2026 年 11 月针对 `SessionManager`、`useStudio`、契约单一事实源及日志收敛实施的大规模重构。
- **包含文档**：
  - `findings-host.md` / `findings-client.md` / `findings-remote-test.md` / `findings-metrics.md`：重构前的各项问题诊断底稿与度量数据。
  - `REFACTOR_PROPOSAL.md`：A/B 阶段重构方案及完成记录。
  - `GPU_LIVE_VERIFICATION.md`：真机 GPU（2×T4）出图链路验证日志。
- **现行对应**：重构成果已全量合并入主干代码，最新架构与接口标准请以主干 `docs/ARCHITECTURE.md` 与 `docs/SPEC.md` 为准。

### 2. `legacy-specs/` (早期废弃设计规格)
- **`STUDIO_SPEC.md`**：0.2.x 早期关于极窄图标条、双侧栏、胶卷坞与焦点舞台的初始构想（已被单轨工作台取代）。
- **`UI_COPYWRITING.md`**：0.2.x 阶段旧版中英文案转换字典表（文案规范已统一收纳进 `docs/SPEC.md` 及前端代码 `src/dict/`）。
- **`STUDIO_V2_SPEC.md`**：前端工作台改版阶段的交互指导书（其有效规范已合并至 `docs/SPEC.md`）。
