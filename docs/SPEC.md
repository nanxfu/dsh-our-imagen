# Our Free Imagen 架构与演进规格说明 (SPEC)

本文档定义 `our-free-imagen` 的核心运行机制、通信协议与本地状态规范，作为后续演进为 **Harness 插件 / 独立生图 GUI / 远端 ComfyUI 算力底座** 的接口标准。

---

## 1. 核心设计哲学：算力租借与推理引擎解耦

系统分为三层：

1. **交互与编排层（Client / Agent / 未来的 Harness GUI）**：负责收集用户意图、润色 Prompt、管理历史图库，并通过本地标准 CLI 或本地状态文件与算力层通信。
2. **算力生命周期层（Provider Lease）**：负责向免费 GPU 平台（当前为 Kaggle T4，未来可扩展 SiliconFlow / Colab / Modal）申请算力、建立安全隧道、监控心跳，以及**空闲自动断电（Watchdog）**与**主动停机（`/shutdown`）**。
3. **远端运行时层（Remote Runtime）**：在租借到的 GPU 容器内实际运行的推理服务。
   * **当前实现**：内置轻量 Diffusers JSON Runtime（`worker.py` 对应 Batch 模式，`daemon.py` 对应 Session 模式）。
   * **未来扩展**：可无缝替换为 `ComfyUI Runtime`（在远端拉起无头 ComfyUI 实例并通过同一套安全隧道暴露给本地 Harness GUI）。

---

## 2. 双模式运行机制

| 维度 | 一次性批量模式 (`--mode batch`) | 长占会话模式 (`--mode session`) |
| :--- | :--- | :--- |
| **适用场景** | 明确知道要生什么图，生成完即走 | 连续微调 Prompt、多轮交互看图修改、GUI 实时生图 |
| **启动耗时** | 每次均需冷启动（约 2~4 分钟） | 首次冷启动 2~3 分钟；**后续每次出图仅需 1.5~3 秒** |
| **计费与回收** | 任务完成（`COMPLETE`）即刻停止扣配额 | 存活期间按墙钟时间扣费；支持**空闲 15 分钟自动退出**或执行 `--session stop` **秒级退出停费** |
| **模型切换** | 每次任务指定 `--preset` 或 `--model` | 支持在同一个活跃会话中动态切换不同模型（自动卸载旧模型并加载新模型） |

---

## 3. 本地会话状态规范 (`.state/session.json`)

当处于 `session` 模式且远端 GPU 在线时，本地状态固定写入 `<skill-dir>/.state/session.json`。未来的 Harness GUI 插件可直接监听或读取该文件，无需通过 CLI 轮询即可直接与远端 GPU 通信：

```json
{
  "provider": "kaggle",
  "kernel_id": "<username>/free-imagen-session",
  "endpoint_url": "https://xxxx.trycloudflare.com",
  "auth_token": "<url-safe-bearer-token>",
  "model_id": "stabilityai/sdxl-turbo",
  "started_at": "2026-11-08T09:30:00Z",
  "idle_timeout_sec": 900
}
```

---

## 4. 远端守护进程 HTTP 协议 (`daemon.py`)

所有请求均需携带 HTTP Header：`Authorization: Bearer <auth_token>`。

### 4.1 健康检查与空闲计时查询
* **请求**：`GET /health`
* **响应 (`200 OK`)**：
  ```json
  {
    "status": "ok",
    "model_id": "stabilityai/sdxl-turbo",
    "device": "Tesla T4",
    "idle_seconds": 14.2,
    "idle_timeout_sec": 900
  }
  ```

### 4.2 提交生图任务（支持单张、批量及动态切换模型）
* **请求**：`POST /generate`
* **请求体 (`application/json`)**：与 `JobSpec.to_payload()` 格式完全一致：
  ```json
  {
    "model_id": "Lykon/dreamshaper-xl-v2-turbo",
    "tasks": [
      {
        "name": "img01",
        "prompt": "A cyberpunk alleyway in heavy rain",
        "negative_prompt": "blurry, low quality",
        "seed": 42,
        "width": 1024,
        "height": 1024,
        "steps": 6,
        "cfg": 2.0
      }
    ]
  }
  ```
* **响应 (`200 OK`)**：返回每张图片的元数据及 Base64 编码的 PNG，客户端落盘后生成 `meta.json`。

### 4.3 主动断电停机（解决 Kaggle CLI 无 `stop` 命令问题）
* **请求**：`POST /shutdown`
* **行为**：远端守护进程返回 `{"status": "shutting_down"}` 后，在 0.5 秒内调用 `os._exit(0)` 终止进程。Kaggle 容器主进程退出后状态立即变为 `COMPLETE`，停止消耗每周 30 小时的免费 GPU 配额。

---

## 5. 未来演进路线（Harness 插件与 ComfyUI 集成预留）

1. **阶段一（当前）**：CLI 双模式（Batch + Session）+ `configs/models.json` 预设库。
2. **阶段二（Harness GUI 插件化）**：
   * 插件前端直接读取 `configs/models.json` 渲染模型选择器与参数滑块（宽高、步数、CFG、Seed）。
   * 插件前端读取 `.state/session.json` 展示顶部状态栏指示灯（`GPU 离线` / `GPU 启动中` / `GPU 在线：剩余空闲自动关机倒计时`）及一键关机按钮（调用 `POST /shutdown`）。
3. **阶段三（ComfyUI 后端接入）**：
   * 在 `daemon.py` 中增加 `--runtime comfyui` 分支：容器启动后拉起本地 `ComfyUI (127.0.0.1:8188)`，由 `daemon.py` 作为带 Bearer Token 鉴权与空闲计时器的反向代理暴露在 `endpoint_url` 下。
   * 本地 Harness GUI 直接将工作流 JSON 提交至 `<endpoint_url>/prompt`，实现零本地显卡开销的完整 ComfyUI 节点编排。
