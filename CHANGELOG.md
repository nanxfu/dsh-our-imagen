# 变更记录

## 0.1.0 — 2026-11-09

### 新增与重构
- **文档与工程体系精简**：
  - 彻底清理冗余的伪大厂规格文档、过度抽象的 Provider 接口及 ADR 记录，聚焦核心开发。
  - 整合输出核心设计 `docs/DESIGN.md` 与实测基准 `docs/MODELS_AND_BENCHMARKS.md`。
  - 明确技术演进路线 `docs/ROADMAP.md`（包含权重缓存、双卡扩展等高价值规划）。
- **DSH 插件骨架**：
  - Host 端：提供 `/imagen-api/state` 与 `/imagen-api/probe` 状态及探针路由。
  - Client 端：设置页与状态徽章，支持实时检查 Kaggle CLI、凭据有效性与 GPU 配额。
  - 远端运行环境：收敛至 `remote/daemon.py` 与 `remote/worker.py`。
