# 协作与迭代（CONTRIBUTING）

面向"单人主导 + 未来公开到 GitHub"的仓库约定。目标是让每次改动可回滚、可解释、可演示。

---

## 1. 仓库形态

单包仓库：仓库根即插件包根。

```
package.json      # dsh.bundle.patch + dsh.client + files 白名单
cordis.patch.yml  # 插件行
index.js          # Host 入口
client.js         # Client 入口
lib/              # Host 内部模块
src/              # Client 组件
remote/           # 远端 Python 脚本（随包发布）
locale/           # 插件元数据文案
icon.svg
docs/             # 规格与决策记录（不随包发布）
bench/            # T4 准入基准（不随包发布）
```

`package.json` 的 `files` 必须显式列出运行期目录，禁止用 `.npmignore` 反向排除。

---

## 2. 分支与提交

- 主干开发（trunk-based）：`main` 始终可安装。超过一天的改动开短分支，合并前不允许遗留调试代码。
- 提交信息采用 Conventional Commits：`feat:`、`fix:`、`docs:`、`refactor:`、`chore:`、`test:`。
- **一次提交一个可演示的变更**。同一提交内不要混入无关格式化。
- 文档与实现同提交：改了协议就改 `docs/PROTOCOL.md`，不要留到"下次一起改"。

---

## 3. 版本与发布

- 语义化版本，v1 之前 `0.x`；每个里程碑结束打一个 tag（`v0.1.0`、`v0.2.0`、`v0.3.0`）。
- 发布方式：本地 `plugin_manager install_bundle` 指向仓库根；不发布到 npm。
- 每次发布更新 `CHANGELOG.md`，分段：新增 / 变更 / 修复 / 已知限制。
- 打 tag 前必须完成该里程碑在 [ROADMAP.md](ROADMAP.md) 里的验收项。

---

## 4. 文档策略

- `docs/` 是权威来源；代码里的注释只解释"为什么"，不复述"做什么"。
- 决策走 ADR：一次决策一个文件，写入后只增不改；决策被推翻时新开一条 ADR 并注明取代关系。
- 术语以 [SPEC.md](SPEC.md) 第 4 节为准，新增术语先加表再使用。
- 未实测的数字一律写 `待测`，不写估计值。

---

## 5. 测试策略

只对**纯逻辑**做自动化测试，GPU 与子进程路径靠真实出图验收。

| 对象 | 是否自动化 | 说明 |
| :--- | :--- | :--- |
| 配额文本解析 | 是 | 多种真实输出样本，含解析失败退化 |
| 错误码映射 | 是 | CLI 输出/日志片段 → 错误码 |
| 会话状态机 | 是 | 允许的转换与非法转换 |
| 模型卡筛选 | 是 | 许可证折叠规则、默认档选择 |
| 内核推送与隧道 | 否 | 真实启动一次，记录耗时分解 |
| 出图链路 | 否 | 真实出图，保留产物与 `meta.json` |

手工验收清单写在里程碑里，逐条勾选，不留"看起来没问题"。

---

## 6. 提交前自检

1. `node --check` 通过 `index.js` 与 `client.js`。
2. `package.json` 与 `cordis.patch.yml` 的 id、入口路径一致。
3. 新文件已列入 `files`（若属于运行期）。
4. 文档已同步；`待测` 未被误填成估计值。
5. 没有把 token、账号凭据、会话 endpoint 写进仓库或日志示例。

---

## 7. 已知的坑（来自实测）

- `kaggle auth login` 的"已登录"是本地回显，不代表 API 可用；判定以 `kaggle quota` 退出码为准。
- 未认证时 `kaggle quota` 退出码为 1，不是 3；旧文档写的 3 是脚本自己的退出码。
- T4 无 FP8 与原生 BF16；模型卡里不能照抄上游的 `bfloat16` 示例。
- Harness 插件没有"页面"概念，只有 slot；图片必须经宿主路由输出，客户端 URL 必须基于 `document.baseURI`。
