# 免费生图工作台（our-free-imagen）

把"免费 GPU 生图"做成 Harness 里的一个常驻工作台：借 Kaggle 免费额度（T4 ×2，30 小时/周）运行开源文生图模型，首次加载完成接入引导，之后在对话旁边以秒级往返出图。

当前状态：**v1 规格冻结，尚未开始实现**（M1 待启动）。

## 它解决什么

- 本机没有可用显卡，出图要靠远端免费算力；现有的命令行形态每次都要回到终端。
- 免费算力有两个隐性成本：冷启动时间与每周配额。工作台把两者都摆到明面上（资源条、会话计时、一键关机）。
- 同一份能力需要同时服务界面操作与对话指令，避免两套状态。

## 文档导航

| 文档 | 内容 |
| :--- | :--- |
| [docs/SPEC.md](docs/SPEC.md) | 总纲：目标、非目标、术语、硬约束 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 四层结构、进程边界、状态机 |
| [docs/PROVIDER-INTERFACE.md](docs/PROVIDER-INTERFACE.md) | Provider 契约与第二家接入清单 |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | 内核交付、隧道握手、远端 HTTP、错误码 |
| [docs/WORKBENCH-UI.md](docs/WORKBENCH-UI.md) | 落点、布局、引导分镜、状态矩阵 |
| [docs/MODEL-CATALOG.md](docs/MODEL-CATALOG.md) | 模型卡、量化档、T4 准入基准 |
| [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) | 实测记录：原始数据、结论、对策、待验证清单 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | M1~M3 与验收标准 |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | 分支、提交、版本、测试策略 |
| [docs/ADR/](docs/ADR/) | 七条关键决策记录 |

## 快速开始

M1 完成后补充。在此之前，现有形态是命令行脚本（见基线提交），不属于 v1 交付内容。

## 已知限制

- 只支持 Kaggle 一家 Provider。
- 只做文生图，不做编辑。
- 首次使用需要接入 Kaggle 账号：主路径是在 Kaggle 网页生成一次 API token 并写入 CLI 凭据位置，OAuth 仅作兜底；凭据不由插件保存。
- 模型权重每次冷启动从 Hugging Face 下载，缓存能力在 v1.1。

## 许可

插件代码待定；各模型权重遵循其自身许可，工作台会在模型卡上标注（见 [docs/MODEL-CATALOG.md](docs/MODEL-CATALOG.md)）。
