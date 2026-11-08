# ADR-0006：单包仓库 + 本地 install_bundle 分发

- 状态：已采纳
- 日期：2026-11-08
- 相关：[CONTRIBUTING.md](../CONTRIBUTING.md)

## 背景

交付物只有一个插件包。未来会公开到 GitHub，但不打算为单个插件维护 npm 发布流水线。

## 决策

仓库根即插件包根；`files` 白名单控制发布内容；通过 `plugin_manager install_bundle` 指向仓库根完成安装。版本语义化，里程碑打 tag，`CHANGELOG.md` 记录变更。

## 后果

- 迭代链路最短：改完即装，无需打包发布。
- 仓库根同时承担"包"与"项目"两种身份，`docs/`、`bench/` 必须显式排除在发布内容之外。
- 将来若要拆分多个包（例如独立的 Provider 包），用 `git mv` 迁到 `packages/` 即可，成本很低。

## 备选与否决理由

- **monorepo 起步**：为尚不存在的第二个包预留结构，属于过早抽象。
- **发布到 npm**：单机自用场景下只会拖慢迭代。
