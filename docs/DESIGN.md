# 系统设计 (DESIGN)

## 架构与数据流

插件由三部分组成：
1. **Client (Web)**：DSH Desktop 前端，提供控制面板、参数配置与图片预览。
2. **Host (Node.js)**：DSH 插件宿主进程，负责调用本地 `kaggle` CLI、管理远端会话生命周期、维护任务队列并保存图片。
3. **Remote Daemon (Python)**：运行在 Kaggle Kernel 容器内的常驻进程，负责加载模型并在 GPU 上执行推理。

```
[ DSH Client (Web) / Agent Tool ]
              │
              ▼ 本地请求
[ DSH Host (Node.js) ]
  ├── 状态管理 (单例会话)
  ├── 任务队列与产物落盘 (<workspace>/imagen-output/)
  └── kaggle CLI 子进程调用
              │
              │ 1. kaggle kernels push 启动
              ▼
[ Kaggle GPU Kernel (remote/daemon.py) ]
  ├── 启动 cloudflared (暴露本地 7860 端口)
  ├── 上报公网 URL 到会合点 (ntfy.sh/<topic>)
  ├── 加载 PyTorch / Diffusers 模型
  └── 监听 /health, /generate, /shutdown
              │
              │ 2. 隧道建立后，Host 直接调用 /generate
              ▼
        [ 返回图片 Base64 ]
```

## 会话保持机制

Kaggle GPU 实例的调度排队时间约为 10~30 分钟，但启动后模型单次推理仅需数秒。因此系统采用常驻 Daemon 方案：
- 启动时拉起一次 Kernel，容器内启动 `remote/daemon.py` 并保持监听。
- 后续出图请求直接通过隧道发送给运行中的 Daemon，避免每次出图重复排队。
- 守护进程内置空闲计时器（默认 30 分钟无请求自动调用 `os._exit(0)`），同时支持前端手动点击关机，防止消耗多余配额。

## 远端通信与握手

1. **推送**：Host 生成临时随机 Token 与 Topic 名，将参数注入配置并调用 `kaggle kernels push`。
2. **隧道上报**：
   - 远端下载并启动 `cloudflared`，获取随机公网域名（`https://*.trycloudflare.com`）。
   - 远端向 `https://ntfy.sh/<topic>` 发布该 URL。
3. **建立连接**：
   - Host 轮询 ntfy Topic 获得公网 URL。
   - Host 携带 Bearer Token 请求 `GET /health`，心跳响应正常后标记会话为 `ready`。

## 远端 HTTP 接口

所有请求需在 Header 携带 `Authorization: Bearer <authToken>`。

### GET /health
获取守护进程状态与资源使用情况。
- 响应：
  ```json
  {
    "status": "ok",
    "model_id": "ByteDance/SDXL-Lightning",
    "device": "Tesla T4",
    "idle_seconds": 15.0,
    "idle_timeout_sec": 1800,
    "gpu_mem_used_mb": 10300,
    "gpu_mem_total_mb": 15360
  }
  ```

### POST /generate
执行图像生成。
- 请求：
  ```json
  {
    "model_id": "ByteDance/SDXL-Lightning",
    "tasks": [
      {
        "name": "image_01",
        "prompt": "a landscape painting, oil on canvas",
        "negative_prompt": "blurry, low quality",
        "seed": 42,
        "width": 1024,
        "height": 1024,
        "steps": 4,
        "cfg": 1.0
      }
    ]
  }
  ```
- 响应：
  ```json
  {
    "status": "ok",
    "results": [
      {
        "name": "image_01",
        "seed": 42,
        "seconds": 6.2,
        "image_b64": "..."
      }
    ]
  }
  ```

### POST /shutdown
退出远端进程，释放 Kaggle 计算资源。
- 响应：`{"status": "shutting_down"}`
- 远端进程退出后，Kaggle Kernel 状态转为 `COMPLETE`，停止计费。
