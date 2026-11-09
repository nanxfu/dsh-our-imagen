# UI 与交互文案设计规格 (UI_COPYWRITING)

> 本文档专供前端代码重构与文案替换使用。  
> 核心目标：彻底剔除机械化、工单式、机翻感的“AI味”，转换为自然、简洁、清晰易懂的现代桌面软件交互语言。

---

## 1. 文案替换对照表 (DICT 字典对齐)

针对 `client.js` 中的文案字典，给出直接替换规格：

| 键名 (`Key`) | 原文案 (AI 味浓重) | 建议替换文案 (自然人话) | 改进理由说明 |
| :--- | :--- | :--- | :--- |
| `page.subtitle` | 基于 Kaggle 免费 GPU 算力运行开源生图模型，支持秒级快速出图。 | 借用 Kaggle 免费算力跑开源生图模型，开机后单张仅需数秒。 | 摒弃“基于...算力运行”的汇报体，说人话。 |
| `chip.offline` | 生图未就绪 | 云端未连接 | “未就绪”像内部状态变量，用户心智是“连没连上”。 |
| `chip.online` | 生图就绪 | 云端就绪 / 云端在线 | 简练明了。 |
| `status.account` | 账号接入 | Kaggle 账号 | 桌面端不需要叫“接入”，直接指明账号对象。 |
| `status.quota` | GPU 配额 | 免费 GPU 配额 | 强调“免费”，让用户安心。 |
| `guide.title` | 接入引导 | 快速连接指引 | 比“接入引导”更具行动导向。 |
| `guide.step1` | 1 · 安装 kaggle CLI | 1. 安装 Kaggle 命令行 | 统一规范的中文标点序号。 |
| `guide.step2` | 2 · 写入 API token | 2. 配置账号 Token | 避免中英文混杂的僵硬感。 |
| `guide.step3` | 3 · 确认手机验证 | 3. 确认已绑定手机号 | 明确动作是“绑定”而不是抽象的“验证”。 |
| `guide.step4` | 4 · 启动 GPU | 4. 首次出图自动唤起 | 告知用户无需单独找开关，点出图就能自动起。 |
| `guide.hint3` | 未验证手机号时任务会静默降级到 CPU | ⚠️ 未绑定手机号的 Kaggle 账号无法使用 GPU | 标明警示等级，明确后果。 |
| `guide.hint4` | 排队可能十余分钟，热态后单张秒级 | 首次排队约 5~10 分钟；开机后单张只需 6 秒 | 避免行业黑话“热态”，给出确切预期时长。 |
| `models.title` | 模型卡 | 模型与硬件表现 | “模型卡”是 Model Card 机翻，用户只想看实际表现。 |
| `models.download`| 权重 | 需下载权重 | 补充谓语，含义完整。 |
| `models.gpus` | 所需卡数 | 显卡配置 | 比“所需卡数”更自然。 |
| `models.steady` | 稳态出图 | 单张耗时 | 坚决扔掉“稳态”这种学术评测词。 |
| `models.tier.fast` | 快档 | ⚡ 极速推荐 | 增加视觉感知，直观。 |
| `models.tier.usable`| 可用档 | 经典多步 | 贴合模型实际特征（如 SDXL Base 30步）。 |
| `workbench.subtitle`| 用 Kaggle 免费 GPU 跑开源生图模型：首次启动要排队，热态后 1024 出图只需数秒。 | 首次启动需要云端排队与下载模型，就绪后可连续秒级出图。 | 通俗易懂，讲清冷启动流程。 |
| `workbench.sessionHint` | 会话保持期间可连续出图；空闲超过上限会自动退出。 | 云端实例已保持连接，可随时出图；闲置 30 分钟会自动关机省额度。 | 讲清楚为什么自动退出（省额度），利害明确。 |
| `workbench.promptPlaceholder` | 描述画面内容，Ctrl+Enter 提交 | 描述你想看到的画面，按 Ctrl+Enter 立即生成 | 更有亲和力与沉浸感。 |
| `workbench.negativePlaceholder` | 要排除的内容，例如 blurry, low quality | 画面中要排除的内容（如模糊、畸变、文字） | 给更直观的中文举例。 |
| `workbench.galleryEmpty` | 提交提示词后，生成结果会显示在这里。 | 还没有生成过图片，在左侧输入描述开始吧。 | 友好的空状态引导。 |

---

## 2. 状态提示文案规格 (Phase & Detail)

在云端启动生命周期中，不要展示技术栈内部细节，而要向用户交代**“现在在干嘛、还要等多久”**：

- **排队阶段 (`provisioning / queue`)**：
  - *原 AI 味文案*：`provisioning: waiting for container`
  - *改进为人话*：`正在向 Kaggle 申请 GPU 机器（排队通常需 5~10 分钟，请稍候…）`
- **拉取与装载阶段 (`warming / warm`)**：
  - *原 AI 味文案*：`warming: installing diffusers & loading weights`
  - *改进为人话*：`云端机器已就绪，正在准备模型权重（即将完成）…`
- **生成进行中 (`generating`)**：
  - *原 AI 味文案*：`generating: job submitted to queue`
  - *改进为人话*：`正在绘制中…（首次生成约 11 秒，之后约 6 秒）`
- **关机状态 (`stopping`)**：
  - *原 AI 味文案*：`stopping session`
  - *改进为人话*：`正在安全关闭云端机器，释放 Kaggle 额度…`
