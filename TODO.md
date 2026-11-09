# 待办任务清单 (TODO)

供后续编码 Agent 接手执行。每个任务应保持独立、可验证。

---

## Task 1: 远端会话生命周期管理

### 目标
实现从本地拉起 Kaggle Kernel、获取穿透地址、到完成健康检查的完整流程。

### 详细步骤
1. **Kernel 打包与推送 (`lib/session.js`)**：
   - 生成一次性随机 Topic 名与 Bearer Token。
   - 准备临时目录，将 `remote/daemon.py` 中的 Topic 与 Token 占位符替换。
   - 生成 `kernel-metadata.json`（`enable_gpu: true`, `enable_internet: true`）。
   - 调用 `kaggle kernels push` 推送任务。
2. **隧道握手与连接探测**：
   - 轮询 `https://ntfy.sh/<topic>/json?poll=1&since=all`，解析出 `endpoint_url`（Cloudflare 临时域名）。
   - 使用 Bearer Token 循环探测 `GET /health`，连续成功后将本地状态置为 `ready`。
3. **路由对接 (`index.js`)**：
   - 增加 `POST /imagen-api/session/start`：启动会话。
   - 增加 `POST /imagen-api/session/stop`：调用远端 `POST /shutdown` 并重置本地状态为 `absent`。

### 验收标准
- 运行后本地状态能从 `absent` 转为 `provisioning`（排队/启动中），最终转为 `ready`。
- 调用 stop 能通知远端正常退出，Kernel 变为 `COMPLETE`。

---

## Task 2: 出图任务处理与图片本地落盘

### 目标
实现接收生图参数、调用远端 HTTP 接口、将 Base64 图像落盘至当前工作区。

### 详细步骤
1. **任务分发与 HTTP 调用**：
   - 构建 `POST /generate` 请求体（Prompt、尺寸、步数、Seed 等）。
   - 接收远端返回的 Base64 编码图片。
2. **本地落盘**：
   - 获取当前工作区路径，创建目标目录 `<workspace>/imagen-output/<jobId>/`。
   - 将 Base64 解码写入 `.png` 文件。
   - 生成伴随的 `meta.json`，记录完整的 prompt、seed、steps、cfg、model_id 及耗时。
3. **路由暴露**：
   - 增加 `POST /imagen-api/generate`：接收生成请求，加入串行任务队列，返回 jobId 与落盘文件路径。

### 验收标准
- 调用生成接口后，工作区对应目录下生成有效的 PNG 图片和 `meta.json`。
- 支持单任务排队，避免并发调用打崩远端 GPU 显存。

---

## Task 3: 前端交互完善 (`client.js`)

### 目标
在现有设置页面板中增加出图操作区与图墙展示。

### 详细步骤
1. **参数控制区**：
   - Prompt 多行输入框。
   - 步数与尺寸选择器（根据预设模型自动填充推荐值）。
   - “开始生成”按钮与“一键关机”按钮。
2. **状态与图墙呈现**：
   - 展示生成中的加载状态与耗时计时。
   - 渲染最近生成的图片缩略图，并提供打开本地文件所在目录的入口。

### 验收标准
- 用户在界面输入 Prompt 点击生成后，界面显示生成状态，完成后直接展示出图缩略图。

---

## Task 4: DSH Agent Tool 接入

### 目标
让 DSH 对话模型能够在聊天中自主调用生图能力。

### 详细步骤
1. 在 `index.js` 中使用 DSH 提供的 Tool 注册机制，声明 `imagen_generate` 工具：
   - 参数定义：`prompt` (string), `width` (number), `height` (number), `steps` (number)。
   - 实现体：直接复用 Task 2 的任务提交逻辑。
   - 返回值：生成成功后的本地图片绝对/相对路径及摘要信息。

### 验收标准
- 在对话中向 DSH 发送“帮我画一张...”时，模型能正确触发 Tool 调用并在回复中附带图片路径。
